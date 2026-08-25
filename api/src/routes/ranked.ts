import type { FastifyInstance } from 'fastify'
import { In, LessThan, LessThanOrEqual, MoreThan, Not, type EntityManager } from 'typeorm'
import { z } from 'zod'
import { config } from '../config.ts'
// Repositórios pela indireção de ranked/fila-repos.ts — ver o comentário lá.
import {
  clientReleases,
  dataSource,
  gameServers,
  lobbies,
  lobbyPlayers,
  maps,
  playerRatings,
  queueEntries,
  seasons,
} from '../ranked/fila-repos.ts'
import { Lobby } from '../entities/lobby.ts'
import { LobbyPlayer } from '../entities/lobby-player.ts'
import { Match } from '../entities/match.ts'
import { QueueEntry } from '../entities/queue-entry.ts'
import type { RankedMode, Team } from '../entities/map.ts'
import type { PlayerRating, Tier } from '../entities/player-rating.ts'
import { JOGADORES_POR_TIME, parear, type Candidato, type Partida } from '../ranked/matchmaking.ts'
import { MU_INICIAL, PARTIDAS_COLOCACAO, SIGMA_INICIAL, TIER_APEX } from '../ranked/rating.ts'

/**
 * Fila, lobby de bans e vitrine do rank — tudo que o launcher chama autenticado.
 *
 * **Regra que não se negocia:** nenhuma resposta daqui carrega `mu`, `sigma` ou
 * `c`. O jogador vê o nome do tier e nada mais; ver a pontuação é o começo de
 * tentar manipulá-la. As três `vista*` abaixo existem para que esse contrato
 * tenha um lugar só, e um teste que falha se alguém vazar um campo.
 */

/** O pool da temporada: 10 mapas, 6 bans alternados, sorteio entre os 4 que sobram. */
export const MAPAS_DA_TEMPORADA = 10
export const BANS_TOTAIS = 6

/** Sem batida do launcher por este tempo, a entrada é varrida da fila. */
const FILA_TIMEOUT_SEG = 30

/** Apex por vaga (não por faixa de `c`): top 5 entre bárbaros com >= 20 partidas. */
const VAGAS_APEX = 5
const PARTIDAS_PARA_APEX = 20

const UNIQUE_VIOLATION = '23505'

/** Lobby inexistente e lobby de outra gente respondem igual — de propósito. */
const NAO_ENCONTRADO = { erro: 404, motivo: 'lobby não encontrado' }

const modoSchema = z.enum(['1v1', '2v2', '3v3', '4v4'])
const entrarSchema = z.object({
  modes: z.array(modoSchema).min(1).max(4),
  /**
   * Versão do jogo e do launcher que o jogador está rodando.
   *
   * Opcionais para não quebrar um launcher antigo no dia do deploy — mas quem
   * não manda a do jogo é recusado logo abaixo: numa ranqueada, versão diferente
   * entre jogadores é desync, e desync é rating perdido de gente que não fez
   * nada errado.
   */
  gameVersion: z.string().max(32).optional(),
  launcherVersion: z.string().max(32).optional(),
})
const idParamSchema = z.object({ id: z.uuid() })
const banSchema = z.object({ mapId: z.uuid() })

// ---------------------------------------------------------------------------
// Máquina de estados dos bans — pura: sem banco, sem relógio, sem random.
// ---------------------------------------------------------------------------

export type EstadoBans = Pick<Lobby, 'estado' | 'turnoTime' | 'turnoPrazo' | 'mapasBanidos' | 'mapaEscolhidoId'>

export type ErroBan = 'lobby-fechado' | 'fora-do-turno' | 'mapa-desconhecido' | 'mapa-ja-banido'

/** O contrato do plano: banir fora do turno é 409, não 403. */
export const HTTP_DO_ERRO: Record<ErroBan, number> = {
  'lobby-fechado': 409,
  'fora-do-turno': 409,
  'mapa-desconhecido': 400,
  'mapa-ja-banido': 409,
}

/** Injetável para o teste poder ser determinístico. */
export type Sorteio = (ids: readonly string[]) => string

const sorteioAleatorio: Sorteio = (ids) => ids[Math.floor(Math.random() * ids.length)]!

/**
 * Quantos bans esta temporada comporta. Normalmente 6 — mas se um admin
 * publicar uma temporada com menos mapas, banir 6 deixaria zero para sortear.
 */
function bansDe(pool: readonly string[]): number {
  return Math.min(BANS_TOTAIS, Math.max(pool.length - 1, 0))
}

/** Times alternam de 1 em 1, e o A começa. O turno é derivado da contagem. */
function turnoApos(banidos: number): Team {
  return banidos % 2 === 0 ? 'A' : 'B'
}

function aposBanir(
  banidos: string[],
  pool: readonly string[],
  agora: Date,
  prazoSeg: number,
  sorteio: Sorteio,
): EstadoBans {
  const livres = pool.filter((id) => !banidos.includes(id))

  if (banidos.length >= bansDe(pool)) {
    // O sorteio acontece no mesmo instante do 6º ban: um estado 'draw' que
    // ainda precisasse de outro tique seria uma tela de espera sem motivo.
    return {
      estado: 'draw',
      turnoTime: null,
      turnoPrazo: null,
      mapasBanidos: banidos,
      mapaEscolhidoId: sorteio(livres),
    }
  }

  return {
    estado: 'ban',
    turnoTime: turnoApos(banidos.length),
    turnoPrazo: new Date(agora.getTime() + prazoSeg * 1_000),
    mapasBanidos: banidos,
    mapaEscolhidoId: null,
  }
}

export type ResultadoBan = { ok: true; estado: EstadoBans } | { ok: false; erro: ErroBan }

/** Ban pedido por um jogador. `pool` são os ids dos mapas da temporada, em ordem. */
export function aplicarBan(
  lobby: EstadoBans,
  time: Team,
  mapId: string,
  pool: readonly string[],
  agora: Date,
  prazoSeg: number,
  sorteio: Sorteio = sorteioAleatorio,
): ResultadoBan {
  if (lobby.estado !== 'ban') return { ok: false, erro: 'lobby-fechado' }
  if (lobby.turnoTime !== time) return { ok: false, erro: 'fora-do-turno' }
  if (!pool.includes(mapId)) return { ok: false, erro: 'mapa-desconhecido' }
  if (lobby.mapasBanidos.includes(mapId)) return { ok: false, erro: 'mapa-ja-banido' }

  return { ok: true, estado: aposBanir([...lobby.mapasBanidos, mapId], pool, agora, prazoSeg, sorteio) }
}

/**
 * Prazo estourado: o sistema bane pelo time que não votou.
 *
 * É o que impede um jogador ausente de travar a partida dos outros sete — e o
 * motivo de o prazo morar em coluna, não em timer na memória: restart da API no
 * meio de um turno não pode congelar o lobby para sempre.
 *
 * Devolve `null` quando não há nada a fazer.
 */
export function tickDeBans(
  lobby: EstadoBans,
  pool: readonly string[],
  agora: Date,
  prazoSeg: number,
  sorteio: Sorteio = sorteioAleatorio,
): EstadoBans | null {
  if (lobby.estado !== 'ban' || lobby.turnoPrazo === null || agora < lobby.turnoPrazo) return null

  const livres = pool.filter((id) => !lobby.mapasBanidos.includes(id))
  if (livres.length <= 1) return null

  return aposBanir([...lobby.mapasBanidos, sorteio(livres)], pool, agora, prazoSeg, sorteio)
}

// ---------------------------------------------------------------------------
// Vistas — o único lugar por onde dado de rating sai para o cliente.
// ---------------------------------------------------------------------------

export type MapaDoPool = { id: string; nome: string }
export type JogadorDoLobby = Pick<LobbyPlayer, 'nickname' | 'time' | 'startLocation'> & { tier: Tier | null }

export function vistaDoLobby(lobby: Lobby, jogadores: readonly JogadorDoLobby[], pool: readonly MapaDoPool[]) {
  const escolhido = pool.find((m) => m.id === lobby.mapaEscolhidoId)

  return {
    estado: lobby.estado,
    mode: lobby.mode,
    // `muNoPareamento` fica de fora: é dado de auditoria, não de tela.
    times: jogadores.map((j) => ({ nickname: j.nickname, tier: j.tier, time: j.time, loc: j.startLocation })),
    mapas: pool.map((m) => ({
      id: m.id,
      nome: m.nome,
      estado: lobby.mapasBanidos.includes(m.id) ? 'banido' : 'livre',
    })),
    turnoTime: lobby.turnoTime,
    turnoPrazo: lobby.turnoPrazo,
    mapaEscolhido: escolhido,
    // Só existe depois que o servidor dedicado confirma a reserva da sala.
    launch:
      lobby.serverIp && lobby.roomIndex !== null
        ? { ip: lobby.serverIp, porta: lobby.serverPort, sala: lobby.roomIndex, senha: lobby.roomSenha }
        : undefined,
  }
}

export type ResultadoRecente = 'V' | 'D'

export function vistaDeMe(rating: PlayerRating | null, ultimos10: readonly ResultadoRecente[]) {
  const partidas = rating?.rankedMatches ?? 0

  return {
    // Sem colocação fechada não há tier a exibir — e nunca há pontuação.
    tier: rating?.placementDone ? rating.tier : null,
    tierDesde: rating?.tierSince ?? null,
    colocacao: { feitas: Math.min(partidas, PARTIDAS_COLOCACAO), total: PARTIDAS_COLOCACAO },
    ultimos10,
    partidas,
  }
}

export function vistaDoLeaderboard(linhas: readonly { nickname: string }[]) {
  // O leaderboard é só o apex: posição e nome. A ordem já é a única informação
  // ordinal que o jogador pode ver, e ela é pública por natureza.
  return linhas.map((linha, i) => ({ posicao: i + 1, nickname: linha.nickname, tier: TIER_APEX }))
}

// ---------------------------------------------------------------------------
// Consultas compartilhadas
// ---------------------------------------------------------------------------

async function temporadaAtiva() {
  return seasons().findOne({ where: { ativa: true } })
}

/**
 * Os mapas da temporada que servem para ESTE modo.
 *
 * O filtro por modo não é preferência, é o que impede o jogo de estourar: um
 * mapa de 2 lugares sorteado para um 2v2 manda o quarto jogador para um local
 * que não existe, e o cliente morre com EAccessViolation ao ler o `.dat`.
 * Aconteceu num teste ao vivo, com Dangerous Strait num 2v2.
 *
 * A coluna `modos` existia desde o começo e nunca era consultada — o sorteio
 * pegava qualquer mapa da temporada.
 */
async function poolDaTemporada(
  seasonId: string,
  mode: RankedMode,
  m: EntityManager = dataSource.manager,
): Promise<MapaDoPool[]> {
  return (await m.query(
    `select m."id", m."nome"
       from "season_maps" sm
       join "maps" m on m."id" = sm."mapId"
      where sm."seasonId" = $1
        and m."ativo"
        and $2 = any(m."modos")
      order by sm."ordem" asc, m."nome" asc`,
    [seasonId, mode],
  )) as MapaDoPool[]
}

/** Tier por conta, para o lobby. Quem não fechou a colocação aparece sem tier. */
async function tiersDaTemporada(seasonId: string, contas: readonly string[]): Promise<Map<string, Tier | null>> {
  if (contas.length === 0) return new Map()

  const linhas = await playerRatings().find({ where: { seasonId, accountId: In([...contas]) } })
  return new Map(linhas.map((r) => [r.accountId, r.placementDone ? r.tier : null]))
}

// ---------------------------------------------------------------------------
// O laço: pareia a fila e cobra os turnos vencidos
// ---------------------------------------------------------------------------

/** Sinaliza rollback: alguém saiu da fila entre a leitura e a criação do lobby. */
class FilaMudou extends Error {}

async function cobrarTurnosVencidos(app: FastifyInstance) {
  const vencidos = await lobbies().find({ where: { estado: 'ban', turnoPrazo: LessThanOrEqual(new Date()) } })

  for (const aberto of vencidos) {
    await dataSource.transaction(async (m) => {
      // Relê sob lock: o jogador pode estar banindo neste exato instante, e dois
      // bans no mesmo turno estragariam a contagem.
      const lobby = await m.findOne(Lobby, { where: { id: aberto.id }, lock: { mode: 'pessimistic_write' } })
      if (!lobby) return

      const pool = await poolDaTemporada(lobby.seasonId, lobby.mode, m)
      const novo = tickDeBans(lobby, pool.map((p) => p.id), new Date(), config.RANKED_BAN_TURNO_SEG)
      if (!novo) return

      await m.update(Lobby, { id: lobby.id }, novo)
      app.log.info({ lobbyId: lobby.id, bans: novo.mapasBanidos.length }, 'ban automático por prazo estourado')
    })
  }
}

type LinhaDaFila = {
  accountId: string
  nickname: string
  modos: RankedMode[]
  esperaSeg: number
  mu: number | null
  sigma: number | null
  tier: Tier | null
  placementDone: boolean | null
}

/**
 * Oponentes das últimas 2 partidas de cada um. Só desempata a escolha do
 * parceiro — repetir adversário é preferência, nunca bloqueio: com 8 pessoas
 * online, proibir revanche esvazia a fila.
 */
async function oponentesRecentes(seasonId: string, contas: readonly string[]): Promise<Map<string, string[]>> {
  if (contas.length === 0) return new Map()

  const linhas = (await dataSource.query(
    `select t."accountId", t."oponente" from (
       select mp."accountId", outro."accountId" as "oponente",
              dense_rank() over (partition by mp."accountId" order by ma."iniciadoEm" desc) as "recencia"
         from "match_players" mp
         join "matches" ma on ma."id" = mp."matchId"
         join "match_players" outro
           on outro."matchId" = mp."matchId" and outro."accountId" <> mp."accountId"
        where mp."accountId" = any($1::uuid[]) and ma."seasonId" = $2
     ) t
     where t."recencia" <= 2`,
    [[...contas], seasonId],
  )) as { accountId: string; oponente: string }[]

  const mapa = new Map<string, string[]>()
  for (const linha of linhas) {
    const lista = mapa.get(linha.accountId) ?? []
    lista.push(linha.oponente)
    mapa.set(linha.accountId, lista)
  }
  return mapa
}

async function criarLobby(seasonId: string, partida: Partida, app: FastifyInstance) {
  const grupo = [...partida.times.A, ...partida.times.B]
  const contas = grupo.map((j) => j.accountId)
  const porTime = JOGADORES_POR_TIME[partida.mode]

  try {
    await dataSource.transaction(async (m) => {
      const lobby = await m.save(
        m.create(Lobby, {
          seasonId,
          mode: partida.mode,
          estado: 'ban',
          turnoTime: 'A',
          turnoPrazo: new Date(Date.now() + config.RANKED_BAN_TURNO_SEG * 1_000),
          mapasBanidos: [],
          mapaEscolhidoId: null,
        }),
      )

      // Locs fixados aqui: o time A ocupa 0..N-1 e o B, N..2N-1. A reserva da
      // sala repassa isso ao servidor dedicado, e ninguém troca de posição.
      await m.save(
        (['A', 'B'] as const).flatMap((time, iTime) =>
          partida.times[time].map((jogador, i) =>
            m.create(LobbyPlayer, {
              lobbyId: lobby.id,
              accountId: jogador.accountId,
              nickname: jogador.nickname,
              time,
              // 1-based: no engine, `StartLocation = 0` é LOC_RANDOM
              // (KM_Defaults.pas:454), e a reserva lida pelo servidor dedicado
              // trata 0 como "a API não exigiu local" (KM_NetServer.pas:916).
              // Com locs a partir de 0, o primeiro jogador de cada partida
              // cairia num local sorteado — e o travamento da sala vazaria
              // justamente onde ele mais importa.
              startLocation: iTime * porTime + i + 1,
              status: 'ok',
              muNoPareamento: jogador.mu,
            }),
          ),
        ),
      )

      const marcadas = await m.update(
        QueueEntry,
        { accountId: In(contas), estado: 'waiting' },
        { estado: 'matched', lobbyId: lobby.id },
      )

      // Um lobby com cadeira vazia é partida que nunca começa — e trava todo
      // mundo. Melhor desfazer e parear de novo no próximo tique.
      if (marcadas.affected !== contas.length) throw new FilaMudou()

      app.log.info({ lobbyId: lobby.id, mode: partida.mode }, 'lobby ranqueado criado')
    })
  } catch (erro) {
    if (erro instanceof FilaMudou) return
    throw erro
  }
}

/** Primeiro índice livre do bloco reservado, ou `null` se o bloco estiver cheio. */
export function primeiraSalaLivre(emUso: ReadonlySet<number>): number | null {
  for (let i = 0; i < config.RANKED_ROOM_COUNT; i += 1) {
    const sala = config.RANKED_ROOM_FIRST + i
    if (!emUso.has(sala)) return sala
  }
  return null
}

/**
 * `draw` → `launch`: reserva a sala no servidor dedicado e cria a partida.
 *
 * É o elo entre as duas metades do sistema, e sem ele nada fecha: o lobby de
 * bans termina em `draw`, e `/internal/ranked/rooms` só publica lobby que já
 * está em `launch`, com `roomIndex` e `matchId`. O `matchId` criado aqui é o
 * mesmo uuid que viaja no Pascal e volta em `/internal/ranked/report`.
 */
async function reservarSalas(app: FastifyInstance) {
  // Mais antigo primeiro: com o bloco de salas cheio, quem sorteou antes espera
  // menos — e a ordem não pode depender do que o Postgres devolver.
  const sorteados = await lobbies().find({ where: { estado: 'draw' }, order: { criadoEm: 'ASC' } })
  if (sorteados.length === 0) return

  // O endereço vem do anúncio vivo (`serveradd.php`), não de variável nova: é
  // o próprio servidor dizendo onde atende, e já é o endereço que a lista
  // publica para todo mundo.
  //
  // A porta, sim, vem da config: o servidor casual também anuncia como
  // `dedicated`, e sem o filtro o `order by updatedAt` viraria sorteio entre os
  // dois — metade das ranqueadas indo parar na sala aberta que qualquer um
  // entra. Porta 0 = um servidor só, comportamento de antes.
  const porta = config.RANKED_SERVER_PORT
  const servidor = await gameServers().findOne({
    where: { dedicated: true, expiresAt: MoreThan(new Date()), ...(porta > 0 && { port: porta }) },
    order: { updatedAt: 'DESC' },
  })
  if (!servidor) {
    // Duas mensagens porque são dois problemas diferentes: "nenhum servidor" se
    // resolve subindo o gameserver; "nenhum servidor NESTA porta" quase sempre é
    // RANKED_SERVER_PORT apontando para uma porta que ninguém anuncia — e um log
    // genérico aí custa uma hora de gente procurando no lugar errado.
    if (porta > 0) {
      app.log.warn(
        { lobbies: sorteados.length, porta },
        `nenhum servidor dedicado anunciado na porta ${porta} (RANKED_SERVER_PORT): reserva adiada`,
      )
    } else {
      app.log.warn(
        { lobbies: sorteados.length },
        'lobby sorteado sem servidor dedicado anunciado: reserva adiada para o próximo tique',
      )
    }
    return
  }

  // Uma sala por lobby vivo. `live` conta junto: a partida está rodando lá.
  const emUso = new Set(
    (await lobbies().find({ where: { estado: In(['launch', 'live']) } }))
      .map((l) => l.roomIndex)
      .filter((n): n is number => n !== null),
  )

  for (const lobby of sorteados) {
    const mapa = lobby.mapaEscolhidoId ? await maps().findOne({ where: { id: lobby.mapaEscolhidoId } }) : null
    if (!mapa) {
      // O sorteio saiu de um mapa que o admin tirou da temporada no meio do
      // lobby. Sem mapa não há sala a reservar, e deixar em `draw` para sempre
      // é pior do que devolver todo mundo para a fila.
      app.log.error({ lobbyId: lobby.id }, 'lobby sorteado sem mapa válido: abortado')
      await lobbies().update({ id: lobby.id, estado: 'draw' }, { estado: 'aborted' })
      continue
    }

    const sala = primeiraSalaLivre(emUso)
    if (sala === null) {
      // Bloco cheio é fila de espera, não erro: o próximo tique tenta de novo,
      // e a ordem de `find` mantém quem sorteou primeiro na frente.
      app.log.warn({ lobbyId: lobby.id }, 'bloco de salas ranqueadas cheio: reserva adiada')
      return
    }
    emUso.add(sala)

    try {
      await dataSource.transaction(async (m) => {
        const partida = await m.save(
          m.create(Match, {
            lobbyId: lobby.id,
            seasonId: lobby.seasonId,
            mode: lobby.mode,
            mapId: mapa.id,
            mapCrc: mapa.mapCrc,
            gameRevision: servidor.gameRevision,
            status: 'pending',
            fonte: 'dedicated',
          }),
        )

        // Condicional em `estado: 'draw'` pelo mesmo motivo do reporte
        // idempotente: dois processos com o laço ligado (um deploy sobrepondo o
        // anterior) não podem reservar duas salas para o mesmo lobby.
        //
        // ponytail: `roomSenha` fica nula. Quem barra estranho é o allowlist da
        // reserva no servidor dedicado, não a senha da sala; uma senha só faria
        // sentido se o join deixasse de ser validado contra a lista.
        const reservou = await m.update(
          Lobby,
          { id: lobby.id, estado: 'draw' },
          {
            estado: 'launch',
            serverIp: servidor.ip,
            serverPort: servidor.port,
            roomIndex: sala,
            matchId: partida.id,
          },
        )
        if (reservou.affected === 0) throw new FilaMudou()

        app.log.info({ lobbyId: lobby.id, matchId: partida.id, sala }, 'sala ranqueada reservada')
      })
    } catch (erro) {
      if (!(erro instanceof FilaMudou)) throw erro
      // Outro processo reservou primeiro: a sala que separamos volta ao bloco.
      emUso.delete(sala)
    }
  }
}

/**
 * Quanto tempo um lobby pode ficar entre o sorteio e o `live` antes de virar
 * `aborted`. Cobre o servidor dedicado subindo, o jogo carregando e os dois
 * lados entrando na sala — com folga, porque abortar cedo demais cancela
 * partida que ia acontecer.
 */
const PRAZO_LANCAMENTO_SEG = 180

/**
 * Aborta lobby que sorteou o mapa e nunca virou partida.
 *
 * `ban` tem prazo (`cobrarTurnosVencidos`) e `live`/`done` têm o reporte do
 * servidor dedicado — mas `draw` e `launch` não tinham saída **nenhuma**, e as
 * duas travas eram permanentes:
 *
 * - `draw`: sem servidor dedicado anunciado, `reservarSalas` só loga "reserva
 *   adiada" e volta no tique seguinte, para sempre. Uma janela do gameserver
 *   fora do ar trancava as contas pareadas nela.
 * - `launch`: quem foi pareado e simplesmente não abre o jogo deixa a reserva
 *   viva. `/internal/ranked/rooms` publica aquela sala eternamente e
 *   `reservarSalas` conta ela em `emUso` — com `RANKED_ROOM_COUNT` dodges o
 *   bloco inteiro fica ocupado e nenhum lobby novo reserva sala de novo.
 *
 * Nos dois casos a entrada de fila fica `matched` e `POST /ranked/queue`
 * responde 409 "você já está em um lobby" para sempre, porque `DELETE
 * /ranked/queue` só alcança `waiting`. Abortar devolve os três de uma vez: a
 * varredura de `soltarQuemSaiuDoLobby` (logo abaixo) já solta entrada de lobby
 * `aborted`, e a sala sai de `emUso` no mesmo tique.
 *
 * O relógio é `criadoEm` + o teto da fase de bans, e **não** uma coluna nova:
 * a fase de bans tem duração máxima conhecida (`BANS_TOTAIS` turnos de
 * `RANKED_BAN_TURNO_SEG`), então somá-la ao prazo dá o mesmo resultado que um
 * `sorteadoEm` sem custar migration. `live` fica de fora de propósito —
 * partida em andamento não tem prazo, e quem a encerra é o reporte.
 *
 * Uma instrução só (CTE que altera dados) porque as duas escritas precisam ser
 * atômicas: um lobby abortado com a partida ainda `pending` reaparece no feed
 * de `/matches` como partida fantasma, sem jogadores e sem vencedor.
 *
 * ponytail: sem punição por no-show. Suspender quem não abriu o jogo é decisão
 * de produto (o `Lobby.vue` ainda deixa entrar na sala na mão, então "não abriu
 * o launcher" e "dodge" não são distinguíveis aqui) — o que não é decisão de
 * produto é a conta ficar trancada para sempre, e é só isso que esta varredura
 * conserta. `punirAbandono` continua só no caminho do reporte.
 */
async function abortarLobbiesTravados(app: FastifyInstance) {
  const tetoDosBans = BANS_TOTAIS * config.RANKED_BAN_TURNO_SEG
  const limite = new Date(Date.now() - (tetoDosBans + PRAZO_LANCAMENTO_SEG) * 1_000)

  const travados = (await dataSource.query(
    `with morto as (
       update "lobbies" set "estado" = 'aborted'
        where "estado" in ('draw', 'launch') and "criadoEm" < $1
       returning "id", "estado", "matchId", "roomIndex"
     ), fantasma as (
       update "matches"
          set "status" = 'invalid',
              "invalidMotivo" = 'lobby expirou sem virar partida',
              "encerradoEm" = now()
        where "id" in (select "matchId" from morto where "matchId" is not null)
          and "status" = 'pending'
       returning "id"
     )
     select "id", "matchId", "roomIndex" from morto`,
    [limite],
  )) as { id: string; matchId: string | null; roomIndex: number | null }[]

  for (const lobby of travados) {
    app.log.warn(lobby, 'lobby expirou sem virar partida: abortado, sala e fila liberadas')
  }
}

/**
 * Solta quem ficou preso numa entrada de fila apontando para lobby encerrado.
 *
 * `criarLobby` marca a entrada como `matched` e **nada nunca a apagava**: o
 * `delete` do timeout e o `DELETE /ranked/queue` só alcançam `waiting`. Efeito
 * com dado real: terminada a primeira partida, `POST /ranked/queue` respondia
 * 409 "você já está em um lobby" para sempre, `GET /ranked/queue/status`
 * continuava dizendo `matched` com o lobby morto e o tempo real reempurrava
 * aquele lobby — uma ranqueada por conta e por temporada.
 *
 * A varredura mora aqui, e não em cada rota que fecha lobby (`/report`,
 * `/void`, o aborto por mapa sumido), porque são três produtores do mesmo
 * estado: uma varredura conserta os três e o quarto que aparecer.
 */
async function soltarQuemSaiuDoLobby() {
  await dataSource.query(
    `delete from "queue_entries" q
      using "lobbies" l
     where q."lobbyId" = l."id" and l."estado" in ('done', 'aborted')`,
  )
}

async function parearFila(app: FastifyInstance) {
  const season = await temporadaAtiva()
  if (!season) return

  // Entrada sem batida é launcher fechado; entrada de outra temporada é lixo de
  // virada. Nenhuma das duas pode segurar vaga de quem está esperando de verdade.
  const semBatidaDesde = new Date(Date.now() - FILA_TIMEOUT_SEG * 1_000)
  await queueEntries().delete({ estado: 'waiting', lastSeenAt: LessThan(semBatidaDesde) })
  await queueEntries().delete({ seasonId: Not(season.id) })

  const linhas = (await dataSource.query(
    `select q."accountId", q."modos",
            extract(epoch from (now() - q."entrouEm"))::int as "esperaSeg",
            a."nickname", r."mu", r."sigma", r."tier", r."placementDone"
       from "queue_entries" q
       join "accounts" a on a."id" = q."accountId"
       left join "player_ratings" r on r."accountId" = q."accountId" and r."seasonId" = q."seasonId"
      where q."estado" = 'waiting' and q."seasonId" = $1
      order by q."entrouEm" asc`,
    [season.id],
  )) as LinhaDaFila[]

  if (linhas.length < 2) return

  const recentes = await oponentesRecentes(
    season.id,
    linhas.map((l) => l.accountId),
  )

  const candidatos: Candidato[] = linhas.map((linha) => ({
    accountId: linha.accountId,
    nickname: linha.nickname,
    // Sem linha de rating ainda: entra na média da escala, em colocação.
    mu: linha.mu ?? MU_INICIAL,
    sigma: linha.sigma ?? SIGMA_INICIAL,
    tier: linha.placementDone ? linha.tier : null,
    emColocacao: !linha.placementDone,
    modos: linha.modos,
    esperaSeg: linha.esperaSeg,
    oponentesRecentes: recentes.get(linha.accountId) ?? [],
  }))

  for (const partida of parear(candidatos).partidas) {
    await criarLobby(season.id, partida, app)
  }
}

/**
 * Um laço só, no próprio processo do Fastify — sem Redis e sem worker separado:
 * a fila mora no banco justamente para sobreviver a deploy.
 *
 * `RANKED_TICK_MS = 0` desliga (teste, script, segundo nó).
 */
export function iniciarLacoRanqueado(app: FastifyInstance, intervaloMs = config.RANKED_TICK_MS) {
  if (intervaloMs <= 0) {
    app.log.warn('RANKED_TICK_MS = 0: pareamento desligado neste processo')
    return
  }

  let rodando = false

  const timer = setInterval(async () => {
    // Tique mais lento que o intervalo não pode se sobrepor: dois pareamentos
    // simultâneos leriam a mesma fila e criariam a mesma partida duas vezes.
    if (rodando) return
    // O laço nasce no registro do plugin, que roda **antes** do
    // `dataSource.initialize()` (ver a ordem em server.ts). Sem esta guarda,
    // todo boot em que conectar + migrar demora mais que RANKED_TICK_MS cospe
    // um "tique do ranqueado falhou" por tique até o banco subir — e erro de
    // rotina no boot é justamente o que esconde erro de verdade.
    if (!dataSource.isInitialized) return
    rodando = true
    try {
      // Antes de soltar a fila: abortar aqui faz a entrada `matched` do lobby
      // travado ser varrida no mesmo tique, e não só no próximo.
      await abortarLobbiesTravados(app)
      await soltarQuemSaiuDoLobby()
      await cobrarTurnosVencidos(app)
      await reservarSalas(app)
      await parearFila(app)
    } catch (erro) {
      app.log.error({ erro }, 'tique do ranqueado falhou')
    } finally {
      rodando = false
    }
  }, intervaloMs)

  app.addHook('onClose', async () => clearInterval(timer))
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

/** `tickMs` sobrepõe `RANKED_TICK_MS` — 0 registra as rotas sem ligar o laço. */
export type OpcoesRanqueado = { tickMs?: number }

export default async function rankedRoutes(app: FastifyInstance, opcoes: OpcoesRanqueado = {}) {
  app.post('/ranked/queue', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = entrarSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'modos inválidos' })

    const season = await temporadaAtiva()
    if (!season) return reply.code(503).send({ error: 'nenhuma temporada aberta' })

    // Versão do jogo: a API é dona dessa verdade, então ela decide. O launcher
    // já bloqueia o botão, mas bloqueio de tela é acordo, não regra -- e o custo
    // de deixar passar não é do trapaceiro, é do adversário dele.
    const releaseAtual = await clientReleases().findOne({ where: { published: true }, order: { createdAt: 'DESC' } })
    if (releaseAtual && parsed.data.gameVersion !== releaseAtual.version) {
      return reply.code(409).send({
        error: `atualize o jogo para a versão ${releaseAtual.version} antes de entrar na fila`,
        versaoEsperada: releaseAtual.version,
        versaoEnviada: parsed.data.gameVersion ?? null,
      })
    }

    const conta = request.account
    if (conta.queueBanUntil && conta.queueBanUntil > new Date()) {
      return reply.code(403).send({ error: 'fila suspensa por abandono', ate: conta.queueBanUntil })
    }

    const atual = await queueEntries().findOne({ where: { accountId: conta.id } })
    if (atual?.estado === 'matched') {
      return reply.code(409).send({ error: 'você já está em um lobby', lobbyId: atual.lobbyId })
    }

    if (atual) {
      // Trocar de modos não zera `entrouEm`: a espera acumulada é o que abre a
      // faixa de pareamento, e perdê-la puniria quem só marcou mais um modo.
      await queueEntries().update(
        { id: atual.id },
        { modos: parsed.data.modes, seasonId: season.id, lastSeenAt: new Date() },
      )
      return reply.code(202).send({ estado: 'waiting' })
    }

    try {
      await queueEntries().save(
        queueEntries().create({
          accountId: conta.id,
          modos: parsed.data.modes,
          seasonId: season.id,
          estado: 'waiting',
          lobbyId: null,
        }),
      )
    } catch (erro) {
      // Corrida entre o SELECT e o INSERT: o índice único decide.
      if ((erro as { code?: string }).code === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: 'você já está na fila' })
      }
      throw erro
    }

    return reply.code(202).send({ estado: 'waiting' })
  })

  app.delete('/ranked/queue', { onRequest: [app.authenticate] }, async (request, reply) => {
    // Só quem ainda espera. Sair depois de pareado é dodge, e quem trata isso é
    // o lobby (com suspensão), não um DELETE silencioso.
    await queueEntries().delete({ accountId: request.account.id, estado: 'waiting' })
    return reply.code(204).send()
  })

  /** Poll de 3 s do launcher — e o heartbeat que mantém a entrada viva. */
  app.get('/ranked/queue/status', { onRequest: [app.authenticate] }, async (request) => {
    const entrada = await queueEntries().findOne({ where: { accountId: request.account.id } })
    if (entrada) await queueEntries().update({ id: entrada.id }, { lastSeenAt: new Date() })

    const contagem = (await dataSource.query(
      `select modo, count(*)::int as total
         from (select unnest("modos") as modo from "queue_entries" where "estado" = 'waiting') s
        group by modo`,
    )) as { modo: RankedMode; total: number }[]

    // Modo vazio precisa aparecer como zero: é informação, não frustração.
    const aguardando: Record<RankedMode, number> = { '1v1': 0, '2v2': 0, '3v3': 0, '4v4': 0 }
    for (const linha of contagem) aguardando[linha.modo] = linha.total

    return {
      estado: entrada?.estado ?? 'fora',
      esperaSeg: entrada ? Math.max(0, Math.floor((Date.now() - entrada.entrouEm.getTime()) / 1_000)) : 0,
      modos: entrada?.modos ?? [],
      lobbyId: entrada?.lobbyId ?? undefined,
      aguardando,
    }
  })

  /** Poll de 1,5 s enquanto o lobby está aberto. */
  app.get('/ranked/lobby/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const lobby = await lobbies().findOne({ where: { id: parsed.data.id } })
    if (!lobby) return reply.code(404).send({ error: 'lobby não encontrado' })

    const jogadores = await lobbyPlayers().find({ where: { lobbyId: lobby.id } })
    // Quem não joga aqui nem fica sabendo que o lobby existe.
    if (!jogadores.some((j) => j.accountId === request.account.id)) {
      return reply.code(404).send({ error: 'lobby não encontrado' })
    }

    const tiers = await tiersDaTemporada(
      lobby.seasonId,
      jogadores.map((j) => j.accountId),
    )
    const pool = await poolDaTemporada(lobby.seasonId, lobby.mode)

    return vistaDoLobby(
      lobby,
      jogadores.map((j) => ({ ...j, tier: tiers.get(j.accountId) ?? null })),
      pool,
    )
  })

  app.post('/ranked/lobby/:id/ban', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'id inválido' })

    const body = banSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'mapId inválido' })

    const resultado = await dataSource.transaction(async (m) => {
      // Lock pessimista pelo mesmo motivo do tique: o prazo pode estourar no
      // exato instante do clique, e um dos dois bans teria que ser descartado.
      const lobby = await m.findOne(Lobby, { where: { id: params.data.id }, lock: { mode: 'pessimistic_write' } })
      if (!lobby) return NAO_ENCONTRADO

      // Quem não joga aqui não banir nem descobre que o lobby existe.
      const eu = await m.findOne(LobbyPlayer, { where: { lobbyId: lobby.id, accountId: request.account.id } })
      if (!eu) return NAO_ENCONTRADO

      const pool = await poolDaTemporada(lobby.seasonId, lobby.mode, m)
      const ban = aplicarBan(
        lobby,
        eu.time,
        body.data.mapId,
        pool.map((p) => p.id),
        new Date(),
        config.RANKED_BAN_TURNO_SEG,
      )
      if (!ban.ok) return { erro: HTTP_DO_ERRO[ban.erro], motivo: ban.erro }

      await m.update(Lobby, { id: lobby.id }, ban.estado)
      return { estado: ban.estado }
    })

    if ('erro' in resultado) return reply.code(resultado.erro).send({ error: resultado.motivo })

    return {
      estado: resultado.estado.estado,
      turnoTime: resultado.estado.turnoTime,
      turnoPrazo: resultado.estado.turnoPrazo,
      mapasBanidos: resultado.estado.mapasBanidos,
      mapaEscolhidoId: resultado.estado.mapaEscolhidoId,
    }
  })

  app.get('/ranked/me', { onRequest: [app.authenticate] }, async (request, reply) => {
    const season = await temporadaAtiva()
    if (!season) return reply.code(503).send({ error: 'nenhuma temporada aberta' })

    const rating = await playerRatings().findOne({
      where: { accountId: request.account.id, seasonId: season.id },
    })

    // `<> 'none'`: `ranked-internal.ts` grava 'none' quando a partida acabou sem
    // decidir o lado deste jogador, e a lista é binária (V/D) — sem o filtro,
    // 'none' virava derrota. Mesma regra de `/accounts/:id/stats`
    // (`matches.ts`), que preenche o **mesmo** campo `ultimos10` na outra tela:
    // com regras diferentes, as duas telas contradiziam uma à outra.
    const historico = (await dataSource.query(
      `select mp."wonOrLost"
         from "match_players" mp
         join "matches" ma on ma."id" = mp."matchId"
        where mp."accountId" = $1 and ma."seasonId" = $2 and ma."status" = 'valid'
          and mp."wonOrLost" <> 'none'
        order by ma."iniciadoEm" desc
        limit 10`,
      [request.account.id, season.id],
    )) as { wonOrLost: string }[]

    return vistaDeMe(
      rating,
      historico.map((h): ResultadoRecente => (h.wonOrLost === 'won' ? 'V' : 'D')),
    )
  })

  app.get('/ranked/leaderboard', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const season = await temporadaAtiva()
    if (!season) return reply.code(503).send({ error: 'nenhuma temporada aberta' })

    // `mu - 2*sigma` só ordena — não sai daqui. É o que faz o apex ser vaga
    // (top 5) e não faixa: um ladder pequeno precisa ter topo sempre ocupado.
    const linhas = (await dataSource.query(
      `select a."nickname"
         from "player_ratings" r
         join "accounts" a on a."id" = r."accountId"
        where r."seasonId" = $1
          and r."tier" in ('barbaro', '${TIER_APEX}')
          and r."rankedMatches" >= $2
        order by (r."mu" - 2 * r."sigma") desc
        limit $3`,
      [season.id, PARTIDAS_PARA_APEX, VAGAS_APEX],
    )) as { nickname: string }[]

    return vistaDoLeaderboard(linhas)
  })

  iniciarLacoRanqueado(app, opcoes.tickMs ?? config.RANKED_TICK_MS)
}
