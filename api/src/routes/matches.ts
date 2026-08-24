import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { dataSource } from '../data-source.ts'
import type { RankedMode, Team } from '../entities/map.ts'
import type { MatchStatus } from '../entities/match.ts'
import type { Tier } from '../entities/player-rating.ts'

/**
 * Histórico de partidas e estatísticas de perfil — o que a aba "Partidas", a
 * carta "Última partida" da Home e o perfil do launcher leem.
 *
 * **Regra que não se negocia (a mesma de `ranked.ts`):** nada daqui carrega
 * `mu`, `sigma` nem `c`. Essas colunas existem em `match_players` para auditar
 * reclamação e recalcular temporada — e é justamente por isso que as consultas
 * abaixo listam coluna por coluna em vez de `select *`, e ainda passam por uma
 * `vista*`. Duas barreiras porque uma delas vai ser esquecida algum dia.
 *
 * **Partida inválida aparece, marcada.** `status: 'invalid'` é desync ou build
 * divergente: ela sai de todo agregado (não pune nem premia ninguém), mas fica
 * no histórico — quem jogou aquela partida lembra dela, e sumir com ela faz o
 * jogador achar que o sistema perdeu o resultado dele.
 */

/** 10 ticks por segundo, como o próprio engine converte (`TickToTimeStr`). */
export const TICKS_POR_SEGUNDO = 10

/** Página do histórico. Teto baixo de propósito: é lista de tela, não relatório. */
const HISTORICO_LIMITE_MAX = 50
const MAPAS_MAIS_JOGADOS = 5
const ULTIMOS_RESULTADOS = 10

const historicoQuery = z.object({
  accountId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(HISTORICO_LIMITE_MAX).default(20),
  /** Cursor: só partidas iniciadas antes disto. Vem do `proximoCursor` anterior. */
  before: z.coerce.date().optional(),
})

const idParam = z.object({ id: z.uuid() })

/**
 * O mínimo que estas rotas precisam do banco — e o ponto de troca do teste.
 *
 * Injeção por opção do plugin, e não um módulo-costura como `ranked/repos.ts`:
 * no `bun test` só o primeiro `mock.module` de um módulo vale no processo
 * inteiro, então cada arquivo de teste precisaria da própria costura. Um
 * parâmetro opcional custa uma linha e não entra nessa fila.
 */
export type Consulta = { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }

// ---------------------------------------------------------------------------
// Vistas — o único lugar por onde partida sai para o cliente
// ---------------------------------------------------------------------------

export type JogadorNaPartida = {
  accountId: string | null
  nickname: string
  time: Team | null
  wonOrLost: 'won' | 'lost' | 'none'
  abandonou: boolean
  /** Enriquecimento do cliente. Ausente na lista, presente no relatório. */
  stats?: unknown
}

export type LinhaDePartida = {
  id: string
  mode: RankedMode
  seasonId: string | null
  mapaNome: string | null
  mapCrc: string
  iniciadoEm: Date
  encerradoEm: Date | null
  duracaoTicks: number | null
  status: MatchStatus
  invalidMotivo: string | null
  timeVencedor: Team | null
  replayCrc: string | null
  jogadores: JogadorNaPartida[]
}

export function vistaDaPartida(linha: LinhaDePartida) {
  return {
    id: linha.id,
    mode: linha.mode,
    // Partida casual não tem temporada: entra no histórico, fora do rank.
    ranqueada: linha.seasonId !== null,
    // `nome` nulo é mapa que não está no catálogo — o CRC sempre está.
    mapa: { nome: linha.mapaNome, crc: linha.mapCrc },
    iniciadoEm: linha.iniciadoEm,
    encerradoEm: linha.encerradoEm,
    // Ticks são relógio de simulação; quem lê isto quer minutos na tela.
    duracaoSeg: linha.duracaoTicks === null ? null : Math.round(linha.duracaoTicks / TICKS_POR_SEGUNDO),
    status: linha.status,
    invalidMotivo: linha.invalidMotivo,
    timeVencedor: linha.timeVencedor,
    jogadores: linha.jogadores.map((j) => ({
      accountId: j.accountId,
      nickname: j.nickname,
      time: j.time,
      wonOrLost: j.wonOrLost,
      abandonou: j.abandonou,
      // `muBefore`/`muAfter` moram na mesma linha do banco e param aqui.
      ...(j.stats === undefined ? {} : { stats: j.stats }),
    })),
    // `replayCrc` só é gravado junto com os arquivos (`routes/replay.ts`), então
    // ele preenchido é a própria garantia de que o download existe. Duas partes
    // porque assistir exige as duas: o `.rpl` é a lista de comandos e o `.bas` é
    // o estado inicial sobre o qual eles rodam.
    replay:
      linha.replayCrc === null
        ? null
        : {
            crc: linha.replayCrc,
            bas: `/matches/${linha.id}/replay?parte=bas`,
            rpl: `/matches/${linha.id}/replay?parte=rpl`,
          },
  }
}

export type ResultadoRecente = 'V' | 'D'

export type ResumoDaConta = {
  nickname: string
  partidas: number
  vitorias: number
  derrotas: number
}

export type MapaJogado = { mapa: string; partidas: number }

/** Só o que o perfil mostra. A linha de rating chega inteira e sai só o tier. */
export function vistaDasEstatisticas(
  accountId: string,
  resumo: ResumoDaConta,
  mapas: readonly MapaJogado[],
  ultimos: readonly { wonOrLost: string }[],
  rating: { tier: Tier | null; placementDone: boolean } | null,
) {
  const decididas = resumo.vitorias + resumo.derrotas

  return {
    accountId,
    nickname: resumo.nickname,
    partidas: resumo.partidas,
    vitorias: resumo.vitorias,
    derrotas: resumo.derrotas,
    // `null`, não zero: quem nunca teve partida decidida não tem 0% de
    // aproveitamento, tem aproveitamento nenhum — e a tela mostra "—".
    aproveitamento: decididas === 0 ? null : Math.round((resumo.vitorias / decididas) * 10_000) / 10_000,
    mapasMaisJogados: mapas.map((m) => ({ mapa: m.mapa, partidas: m.partidas })),
    // A consulta já descarta `wonOrLost = 'none'` (partida válida que não
    // decidiu o lado deste jogador): chamar isso de derrota seria a tela
    // afirmar uma coisa que o servidor dedicado nunca afirmou.
    ultimos10: ultimos.map((u): ResultadoRecente => (u.wonOrLost === 'won' ? 'V' : 'D')),
    // Sem colocação fechada não há tier a exibir — e nunca há pontuação.
    tier: rating?.placementDone ? rating.tier : null,
  }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Coluna por coluna: um `m.*` aqui arrastaria rating para dentro da vista. */
const COLUNAS_DA_PARTIDA = `m."id", m."mode", m."seasonId", m."mapCrc",
          m."iniciadoEm", m."encerradoEm", m."duracaoTicks", m."status",
          m."invalidMotivo", m."timeVencedor", m."replayCrc",
          mapa."nome" as "mapaNome"`

/**
 * Uma partida com os participantes agregados numa linha só.
 *
 * `comStats` fica de fora da lista de propósito: `statsJson` é jsonb do cliente
 * (casas, exército, gráficos) e não tem por que viajar 20 vezes numa tela que
 * mostra placar. Só o relatório de uma partida carrega isso.
 */
function sqlDePartidas(onde: string, comStats: boolean, fim: string): string {
  return `select ${COLUNAS_DA_PARTIDA},
            coalesce(
              json_agg(json_build_object(
                'accountId', p."accountId",
                'nickname',  p."nickname",
                'time',      p."time",
                'wonOrLost', p."wonOrLost",
                'abandonou', p."abandonou"${comStats ? `,\n                'stats',     p."statsJson"` : ''}
              ) order by p."handIndex") filter (where p."nickname" is not null),
              '[]'::json
            ) as "jogadores"
       from "matches" m
       left join "maps" mapa on mapa."id" = m."mapId"
       left join "match_players" p on p."matchId" = m."id"
      where ${onde}
      group by m."id", mapa."nome"
      ${fim}`
}

export type FiltroDoHistorico = { accountId?: string; limit: number; before?: Date }

async function historico(db: Consulta, filtro: FiltroDoHistorico) {
  const filtros: string[] = ['true']
  const params: unknown[] = []

  if (filtro.accountId) {
    params.push(filtro.accountId)
    // `exists` e não join: o join duplicaria a partida por participante e
    // estragaria o `limit` da página.
    filtros.push(
      `exists (select 1 from "match_players" mp
                where mp."matchId" = m."id" and mp."accountId" = $${params.length}::uuid)`,
    )
  }
  if (filtro.before) {
    params.push(filtro.before)
    filtros.push(`m."iniciadoEm" < $${params.length}`)
  }
  params.push(filtro.limit)

  const linhas = (await db.query(
    sqlDePartidas(filtros.join(' and '), false, `order by m."iniciadoEm" desc limit $${params.length}`),
    params,
  )) as LinhaDePartida[]

  return {
    partidas: linhas.map(vistaDaPartida),
    // Página cheia é "provavelmente tem mais". Página curta encerra a rolagem.
    //
    // ponytail: cursor só por `iniciadoEm`. Duas partidas no mesmo microssegundo
    // pulariam uma; se um dia acontecer, desempatar por `id`.
    proximoCursor: linhas.length === filtro.limit ? (linhas[linhas.length - 1]?.iniciadoEm ?? null) : null,
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

/** `consulta` sobrepõe o banco real — é como o teste roda sem Postgres. */
export type OpcoesMatches = { consulta?: Consulta }

export default async function matchesRoutes(app: FastifyInstance, opcoes: OpcoesMatches = {}) {
  const db: Consulta = opcoes.consulta ?? dataSource

  app.get('/matches', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = historicoQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

    return historico(db, parsed.data)
  })

  /** O mesmo histórico, por conta. É o que o perfil chama. */
  app.get('/accounts/:id/matches', { onRequest: [app.authenticate] }, async (request, reply) => {
    const conta = idParam.safeParse(request.params)
    if (!conta.success) return reply.code(400).send({ error: 'id inválido' })

    const parsed = historicoQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

    return historico(db, { ...parsed.data, accountId: conta.data.id })
  })

  /** Relatório de uma partida: mapa, duração, times, vencedor, stats, replay. */
  app.get('/matches/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = idParam.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const [linha] = (await db.query(sqlDePartidas('m."id" = $1::uuid', true, ''), [
      parsed.data.id,
    ])) as LinhaDePartida[]
    if (!linha) return reply.code(404).send({ error: 'partida não encontrada' })

    return vistaDaPartida(linha)
  })

  /** O agregado do perfil. Partida inválida não entra em nada disto. */
  app.get('/accounts/:id/stats', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = idParam.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const id = parsed.data.id

    // Conta primeiro, e por `left join`: conta nova sem partida nenhuma tem que
    // responder 200 com zeros, e id inexistente tem que responder 404 — sem a
    // conta na consulta os dois casos ficariam idênticos.
    //
    // O `status = 'valid'` mora em cada `filter`, não no join: no join ele
    // deixaria a linha da partida inválida entrar mesmo assim (o left join a
    // preserva) e ela contaria como vitória.
    const [resumo] = (await db.query(
      `select a."nickname",
              count(*) filter (where m."status" = 'valid')::int as "partidas",
              count(*) filter (where m."status" = 'valid' and mp."wonOrLost" = 'won')::int as "vitorias",
              count(*) filter (where m."status" = 'valid' and mp."wonOrLost" = 'lost')::int as "derrotas"
         from "accounts" a
         left join "match_players" mp on mp."accountId" = a."id"
         left join "matches" m on m."id" = mp."matchId"
        where a."id" = $1::uuid
        group by a."nickname"`,
      [id],
    )) as ResumoDaConta[]

    if (!resumo) return reply.code(404).send({ error: 'conta não encontrada' })

    const mapas = (await db.query(
      `select coalesce(mapa."nome", m."mapCrc") as "mapa", count(*)::int as "partidas"
         from "match_players" mp
         join "matches" m on m."id" = mp."matchId"
         left join "maps" mapa on mapa."id" = m."mapId"
        where mp."accountId" = $1::uuid and m."status" = 'valid'
        group by 1
        order by "partidas" desc, "mapa" asc
        limit ${MAPAS_MAIS_JOGADOS}`,
      [id],
    )) as MapaJogado[]

    // `<> 'none'` porque são os últimos 10 **resultados**, não as últimas 10
    // partidas: `ranked-internal.ts` grava 'none' quando a partida acabou sem
    // decidir o lado deste jogador, e uma V/D binária transformaria isso numa
    // derrota que ninguém tomou.
    const ultimos = (await db.query(
      `select mp."wonOrLost"
         from "match_players" mp
         join "matches" m on m."id" = mp."matchId"
        where mp."accountId" = $1::uuid and m."status" = 'valid' and mp."wonOrLost" <> 'none'
        order by m."iniciadoEm" desc
        limit ${ULTIMOS_RESULTADOS}`,
      [id],
    )) as { wonOrLost: string }[]

    // Duas colunas e nada mais: `mu` e `sigma` estão na mesma linha e não têm
    // por que sair do banco numa rota de jogador.
    const [rating] = (await db.query(
      `select r."tier", r."placementDone"
         from "player_ratings" r
         join "seasons" s on s."id" = r."seasonId" and s."ativa"
        where r."accountId" = $1::uuid`,
      [id],
    )) as { tier: Tier | null; placementDone: boolean }[]

    return vistaDasEstatisticas(id, resumo, mapas, ultimos, rating ?? null)
  })
}
