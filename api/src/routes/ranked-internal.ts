import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { In } from 'typeorm'
import { z } from 'zod'
import { config } from '../config.ts'
// Repositórios pela indireção de ranked/repos.ts — ver o comentário lá.
import {
  accounts,
  lobbies,
  lobbyPlayers,
  maps,
  matchPlayers,
  matches,
  playerRatings,
  seasons,
} from '../ranked/repos.ts'
import type { Account } from '../entities/account.ts'
import type { Match } from '../entities/match.ts'
import type { Team } from '../entities/map.ts'
import type { PlayerRating } from '../entities/player-rating.ts'
import type { CortesTier } from '../entities/season.ts'
import { origemPermitida } from '../allowlist.ts'
import { peerIp } from '../peer-ip.ts'
import {
  CORTES_SEMENTE,
  PARTIDAS_COLOCACAO,
  TIER_APEX,
  type Tier,
  atualizarPartida,
  pontuacaoOculta,
  ratingInicial,
  tierComHisterese,
} from '../ranked/rating.ts'

/**
 * Rotas internas do ranqueado — quem chama é o `KaM_DedicatedServer`.
 *
 * Mesmas restrições de `routes/verify.ts`, e pelo mesmo motivo: o cliente HTTP
 * do Pascal (`TKMHTTPClient`) só faz **GET, sem TLS, sem header customizado e
 * sem parser de JSON**. Daí segredo na querystring, resposta em texto puro de
 * uma linha e allowlist pelo endereço do socket.
 *
 * O servidor dedicado roda na mesma máquina que a API e chama por loopback —
 * o segredo trafega em claro, e fora do loopback isso seria inaceitável. Por
 * isso o allowlist é o mesmo `VERIFY_ALLOWED_IPS`: é o mesmo binário, na mesma
 * máquina, chamando as duas rotas. Uma segunda variável que tem que ser sempre
 * igual à primeira é configuração para um valor que nunca muda.
 */

/**
 * Peacetime (min) e velocidade da sala ranqueada. Fixos: sala travada não
 * negocia opção, e o servidor dedicado valida o `mkGameOptions` contra isto.
 *
 * ponytail: constantes. Viram coluna da temporada se um dia variarem por modo.
 */
const PEACETIME_MINUTOS = 15
const VELOCIDADE = 1

/**
 * Suspensão da fila por abandono, por ocorrência (Decisões do dono, §3):
 * 15 min, 1 h, 6 h, 24 h, 7 dias. Da 5ª em diante fica no teto.
 */
const SUSPENSAO_MINUTOS = [15, 60, 360, 1440, 10_080] as const

/**
 * 15 dias **sem nenhuma ocorrência** zeram a ficha inteira — não é cada
 * abandono que expira um a um.
 */
const PERDAO_DIAS = 15

/** Opções comuns: nada de log, porque a querystring carrega o segredo. */
const interno = { logLevel: 'silent' as const, config: { disableRequestLogging: true } }

function str(request: FastifyRequest, chave: string): string {
  const valor = (request.query as Record<string, unknown>)[chave]
  return typeof valor === 'string' ? valor : ''
}

/** `p=` repetido vira array no parser do Fastify; com um só, vira string. */
function lista(request: FastifyRequest, chave: string): string[] {
  const valor = (request.query as Record<string, unknown>)[chave]
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string')
  return typeof valor === 'string' ? [valor] : []
}

function inteiro(request: FastifyRequest, chave: string): number | null {
  const n = Number.parseInt(str(request, chave), 10)
  return Number.isFinite(n) ? n : null
}

const uuid = z.uuid()
const timeValido = z.enum(['A', 'B'])

/**
 * Comparação em tempo constante. O sha256 dos dois lados existe porque
 * `timingSafeEqual` exige buffers do mesmo tamanho, e comparar o tamanho antes
 * vazaria o tamanho do segredo.
 */
function segredoConfere(recebido: string): boolean {
  // Segredo não configurado = rotas internas desligadas. É o padrão seguro:
  // sem isso no ambiente, ninguém reporta nada.
  if (config.RANKED_INTERNAL_SECRET.length === 0) return false
  const a = createHash('sha256').update(recebido).digest()
  const b = createHash('sha256').update(config.RANKED_INTERNAL_SECRET).digest()
  return timingSafeEqual(a, b)
}

type JogadorReportado = {
  nickname: string
  time: Team | null
  wonOrLost: 'won' | 'lost' | 'none'
  abandonou: boolean
}

/**
 * `p=nick:A:won`. O terceiro campo aceita `abandon` além de `won`/`lost`/`none`:
 * abandono é derrota **e** ficha na conta, e no formato do contrato não sobra
 * outro lugar para dizer isso sem inventar um segundo parâmetro.
 */
function parseJogador(token: string): JogadorReportado | null {
  const [nickname, timeBruto, resultado] = token.split(':')
  if (!nickname) return null

  const abandonou = resultado === 'abandon'
  const parsed = timeValido.safeParse(timeBruto)

  return {
    // O nickname vem do `client.AuthNickname` do servidor, mas a coluna é
    // varchar(16): cortar aqui evita um 500 por overflow em reporte torto.
    nickname: nickname.slice(0, 16),
    time: parsed.success ? parsed.data : null,
    wonOrLost: resultado === 'won' ? 'won' : abandonou || resultado === 'lost' ? 'lost' : 'none',
    abandonou,
  }
}

/** Os cortes congelados da temporada, ou os cortes-semente se ela sumiu. */
function cortesDe(cortes: CortesTier | null | undefined): readonly number[] {
  if (!cortes) return CORTES_SEMENTE
  return [cortes.miliciano, cortes.machadeiro, cortes.espadachim, cortes.besteiro, cortes.barbaro]
}

type Par = { nickname: string; conta: Account }
type MuSigma = { mu: number; sigma: number }

/**
 * Lê os ratings atuais, chama o motor e grava o resultado em `player_ratings`.
 * Devolve antes/depois por nickname — quem grava em `match_players` é a rota,
 * porque lá entram também os jogadores sem conta.
 */
async function aplicarRating(
  seasonId: string,
  vencedores: Par[],
  perdedores: Par[],
  agora: Date,
): Promise<Map<string, { antes: MuSigma; depois: MuSigma }>> {
  const ordem = [...vencedores, ...perdedores]

  const existentes = await playerRatings().find({
    where: { seasonId, accountId: In(ordem.map((p) => p.conta.id)) },
  })

  // Materializado uma vez só: as mesmas linhas que alimentam o motor são as
  // que serão salvas. Recriar a linha ausente a cada acesso jogaria fora o
  // cálculo de quem entrou na temporada nesta partida.
  const linhas: PlayerRating[] = ordem.map(
    (p) =>
      existentes.find((r) => r.accountId === p.conta.id) ??
      playerRatings().create({
        accountId: p.conta.id,
        seasonId,
        ...ratingInicial(),
        rankedMatches: 0,
        placementDone: false,
        tier: null,
        tierSince: null,
        demotionStrikes: 0,
        lastRankedAt: null,
        seededBy: null,
      }),
  )

  const paraOMotor = (lado: PlayerRating[]) =>
    lado.map((r) => ({
      mu: r.mu,
      sigma: r.sigma,
      // Colocação é estado de jogador, não da partida: novato e veterano
      // dividem a mesma sala e cada um leva o seu τ.
      emColocacao: r.rankedMatches < PARTIDAS_COLOCACAO,
    }))

  // Vencedores primeiro — é assim que o motor lê a ordem de chegada.
  const novos = atualizarPartida([
    paraOMotor(linhas.slice(0, vencedores.length)),
    paraOMotor(linhas.slice(vencedores.length)),
  ])
  const depoisDeTodos = [...novos[0]!, ...novos[1]!]

  const temporada = await seasons().findOne({ where: { id: seasonId } })
  const cortes = cortesDe(temporada?.cortesTier)

  const saida = new Map<string, { antes: MuSigma; depois: MuSigma }>()

  for (const [i, linha] of linhas.entries()) {
    const antes = { mu: linha.mu, sigma: linha.sigma }
    const depois = depoisDeTodos[i]!

    linha.mu = depois.mu
    linha.sigma = depois.sigma
    linha.rankedMatches += 1
    linha.placementDone = linha.rankedMatches >= PARTIDAS_COLOCACAO
    linha.lastRankedAt = agora

    // Antes do fim da colocação não existe tier a exibir — e o primeiro sai
    // deliberadamente conservador, com σ ainda alto.
    if (linha.placementDone) {
      // `comandante` é vaga do leaderboard, não faixa de `c`: para a histerese
      // ele é um bárbaro. Sem isto o índice do tier seria -1 e o apex seria
      // tratado como quem nunca teve tier.
      const base = linha.tier === TIER_APEX ? 'barbaro' : (linha.tier as Tier | null)
      const estado = tierComHisterese(
        { tier: base, strikes: linha.demotionStrikes },
        pontuacaoOculta(depois.mu, depois.sigma),
        cortes,
      )
      if (estado.tier !== linha.tier) {
        linha.tier = estado.tier
        linha.tierSince = agora
      }
      linha.demotionStrikes = estado.strikes
    }

    saida.set(ordem[i]!.nickname, { antes, depois })
  }

  await playerRatings().save(linhas)

  return saida
}

/** Suspensão escalonada da fila ranqueada (não do jogo). */
async function punirAbandono(conta: Account, agora: Date): Promise<void> {
  // `new Date(...)` e não `Date.parse` montando a string: a coluna é `date` e
  // chega como 'AAAA-MM-DD', mas um driver que devolvesse Date faria a soma
  // virar NaN — e NaN aqui perdoaria a ficha em silêncio.
  const ultima = conta.queueBanDia ? new Date(conta.queueBanDia).getTime() : Number.NaN
  const perdoado = !Number.isFinite(ultima) || agora.getTime() - ultima > PERDAO_DIAS * 86_400_000

  const ocorrencia = perdoado ? 1 : conta.queueBanCount + 1
  const minutos = SUSPENSAO_MINUTOS[Math.min(ocorrencia, SUSPENSAO_MINUTOS.length) - 1]!

  await accounts().update(
    { id: conta.id },
    {
      queueBanCount: ocorrencia,
      queueBanDia: agora.toISOString().slice(0, 10),
      queueBanUntil: new Date(agora.getTime() + minutos * 60_000),
    },
  )
}

export default async function rankedInternalRoutes(app: FastifyInstance) {
  /**
   * Porta de entrada única do escopo. Vem antes de qualquer leitura de banco.
   *
   * `app.log`, e não `request.log`: o log da rota é `silent` (a querystring
   * carrega o segredo), e uma recusa é justamente o que precisa aparecer.
   * Só o IP vai para o log — nunca a query.
   */
  app.addHook('onRequest', async (request, reply) => {
    reply.type('text/plain')

    // peerIp, nao request.ip: ver peer-ip.ts. X-Forwarded-For e escrito pelo
    // cliente, e um allowlist que confie nele nao protege nada.
    const origem = peerIp(request)
    if (!origemPermitida(origem, config.verifyAllowedIps)) {
      app.log.warn({ origem, rota: request.routeOptions.url }, 'rota interna recusada: origem fora do allowlist')
      return reply.code(403).send('forbidden')
    }

    if (!segredoConfere(str(request, 'secret'))) {
      app.log.warn({ origem, rota: request.routeOptions.url }, 'rota interna recusada: segredo inválido')
      return reply.code(403).send('forbidden')
    }
  })

  /**
   * As salas reservadas, uma por linha. O servidor dedicado puxa isto a cada
   * 3 s e usa para recusar join de estranho e validar o que o host difunde.
   *
   * ponytail: só os lobbies em `launch`. Depois do `started` a partida já
   * rodou e ninguém entra numa sala em jogo.
   */
  app.get('/internal/ranked/rooms', interno, async (_request, reply) => {
    const reservas = (await lobbies().find({ where: { estado: 'launch' } })).filter(
      (l) => l.roomIndex !== null && l.matchId !== null,
    )
    if (reservas.length === 0) return reply.send('')

    const partidas = await matches().find({ where: { id: In(reservas.map((l) => l.matchId!)) } })
    const slots = await lobbyPlayers().find({ where: { lobbyId: In(reservas.map((l) => l.id)) } })

    // O nome do mapa, não só o CRC: é com ele que o servidor dedicado difunde o
    // `mkMapSelect` e impõe o mapa na sala (KM_NetServer.pas, ImposeConfig, só
    // manda o pacote quando `MapName <> ''`). Sem o nome, o CRC vira apenas um
    // guarda que recusa tudo até o host acertar o mapa na mão — e a sala
    // travada deixa de travar exatamente onde deveria.
    const idsDeMapa = partidas.map((p) => p.mapId).filter((id): id is string => id !== null)
    const mapas = idsDeMapa.length > 0 ? await maps().find({ where: { id: In(idsDeMapa) } }) : []

    const linhas = reservas.flatMap((lobby) => {
      const partida = partidas.find((m) => m.id === lobby.matchId)
      if (!partida) return []

      const jogadores = slots
        .filter((s) => s.lobbyId === lobby.id)
        .sort((a, b) => a.startLocation - b.startLocation)
        .map((s) => `p=${s.nickname}:${s.time}:${s.startLocation}`)

      const mapa = mapas.find((m) => m.id === partida.mapId)

      return [
        [
          `room=${lobby.roomIndex}`,
          `match=${partida.id}`,
          `mapcrc=${partida.mapCrc}`,
          // `;` e quebra de linha são os dois separadores do formato: um nome de
          // mapa que os contivesse partiria a reserva em duas linhas tortas.
          ...(mapa ? [`map=${mapa.nome.replace(/[\s;]+/g, ' ').trim()}`] : []),
          `pt=${PEACETIME_MINUTOS}`,
          `spd=${VELOCIDADE}`,
          'lock=1',
          ...jogadores,
        ].join(';'),
      ]
    })

    return reply.send(linhas.join('\n'))
  })

  /** A partida começou de fato: guarda a semente e tira a sala da lista. */
  app.get('/internal/ranked/started', interno, async (request, reply) => {
    const id = uuid.safeParse(str(request, 'match'))
    if (!id.success) return reply.code(400).send('invalid match')

    const partida = await matches().findOne({ where: { id: id.data } })
    if (!partida) return reply.code(404).send('unknown match')
    // Reenvio depois do fim não reabre partida encerrada.
    if (partida.status !== 'pending') return reply.send('ok')

    // ponytail: `tick` chega junto e não tem coluna. O que importa da largada é
    // a semente (auditoria de replay); criar coluna para o tick é migration por
    // nada até alguém precisar dele.
    await matches().update({ id: id.data, status: 'pending' }, { randomSeed: inteiro(request, 'seed') })
    await lobbies().update({ matchId: id.data }, { estado: 'live' })

    return reply.send('ok')
  })

  /**
   * O resultado autoritativo. **Idempotente por partida**: o servidor dedicado
   * reenvia, e a segunda chamada não pode recalcular rating nenhum.
   *
   * A idempotência é o próprio UPDATE condicional (`status = 'pending'`), e não
   * um "leu, checou, gravou": dois reenvios simultâneos bloqueiam na mesma
   * linha e só um sai com `affected = 1`.
   */
  app.get('/internal/ranked/report', interno, async (request, reply) => {
    const id = uuid.safeParse(str(request, 'match'))
    if (!id.success) return reply.code(400).send('invalid match')

    const vencedor = timeValido.safeParse(str(request, 'winner'))
    const ticks = inteiro(request, 'ticks')
    const reportados = lista(request, 'p')
      .map(parseJogador)
      .filter((j): j is JogadorReportado => j !== null)
      // Nickname repetido só sai de reporte torto — o servidor dedicado
      // autentica cada cliente e não existe homônimo. Sem cortar aqui, a mesma
      // conta entraria duas vezes no motor e levaria o dobro de rating.
      .filter(
        (j, i, todos) =>
          todos.findIndex((o) => o.nickname.toLowerCase() === j.nickname.toLowerCase()) === i,
      )

    const partida = await matches().findOne({ where: { id: id.data } })
    if (!partida) return reply.code(404).send('unknown match')

    const agora = new Date()
    const fechou = await matches().update(
      { id: id.data, status: 'pending' },
      {
        status: 'valid',
        timeVencedor: vencedor.success ? vencedor.data : null,
        duracaoTicks: ticks,
        encerradoEm: agora,
      },
    )
    if (fechou.affected === 0) {
      app.log.info({ match: id.data }, 'reporte repetido: partida já encerrada, nada a recalcular')
      return reply.send('ok')
    }

    await lobbies().update({ matchId: id.data }, { estado: 'done' })

    // Nickname é a única identidade que o servidor dedicado tem para reportar —
    // e é o nickname autenticado dele, não o que o cliente declarou. Quem não
    // casa com conta nenhuma (partida casual) entra no histórico sem rating.
    const contas =
      reportados.length === 0
        ? []
        : await accounts().find({ where: { nickname: In(reportados.map((j) => j.nickname)) } })
    const contaDe = (nickname: string) =>
      contas.find((c) => c.nickname.toLowerCase() === nickname.toLowerCase()) ?? null

    const vencedores: Par[] = []
    const perdedores: Par[] = []
    if (vencedor.success && partida.seasonId !== null && partida.fonte === 'dedicated') {
      for (const jogador of reportados) {
        const conta = contaDe(jogador.nickname)
        if (!conta || jogador.time === null) {
          // Em partida ranqueada isto é sintoma, não rotina: nickname que não
          // casa com conta nenhuma é rating que some em silêncio. Fica no log
          // para virar bug do lado do Pascal, e não mistério do jogador.
          app.log.warn(
            { match: id.data, nickname: jogador.nickname },
            'participante sem conta ou sem time: fora do rating',
          )
          continue
        }
        ;(jogador.time === vencedor.data ? vencedores : perdedores).push({
          nickname: jogador.nickname,
          conta,
        })
      }
    }

    // Time vazio de um dos lados = não há partida para o motor ler. Acontece em
    // casual, em partida com nickname sem conta, e em reporte torto.
    const ratings =
      vencedores.length > 0 && perdedores.length > 0
        ? await aplicarRating(partida.seasonId!, vencedores, perdedores, agora)
        : new Map<string, { antes: MuSigma; depois: MuSigma }>()

    await gravarParticipantes(partida, reportados, contas, ratings)

    if (partida.seasonId !== null) {
      for (const jogador of reportados.filter((j) => j.abandonou)) {
        const conta = contaDe(jogador.nickname)
        if (conta) await punirAbandono(conta, agora)
      }
    }

    return reply.send('ok')
  })

  /**
   * Partida inválida (desync, build divergente, `mkStart` fora da reserva).
   * **Não mexe em rating** — nem para tirar, nem para pôr.
   */
  app.get('/internal/ranked/void', interno, async (request, reply) => {
    const id = uuid.safeParse(str(request, 'match'))
    if (!id.success) return reply.code(400).send('invalid match')

    const motivo = str(request, 'reason').slice(0, 200) || 'desconhecido'

    const invalidou = await matches().update(
      { id: id.data, status: 'pending' },
      { status: 'invalid', invalidMotivo: motivo, encerradoEm: new Date() },
    )

    if (invalidou.affected === 0) {
      // Reverter rating já aplicado é decisão de admin, não de rota automática:
      // o `mu` dos dois lados já circulou e desfazer no escuro estraga mais do
      // que conserta. Fica o aviso para a análise manual.
      app.log.warn({ match: id.data, motivo }, 'void de partida já encerrada: rating aplicado não é revertido aqui')
      return reply.send('ok')
    }

    await lobbies().update({ matchId: id.data }, { estado: 'aborted' })

    return reply.send('ok')
  })

  /**
   * CRC do executável do cliente. É **obstáculo, não segurança**: um cliente
   * modificado mente o CRC. Serve para pegar build divergente da comunidade,
   * que é a causa real de desync neste fork (`ALLOW_MP_MODS = True`).
   *
   * ponytail: lista por variável de ambiente. Vira coluna em `client_releases`
   * quando o build passar a publicar o CRC junto do manifesto.
   */
  app.get('/internal/ranked/build', interno, async (request, reply) => {
    // Lista vazia = aceita qualquer build. Só aceitável em desenvolvimento.
    if (config.rankedAllowedExeCrcs.length === 0) return reply.send('ok')

    const crc = str(request, 'crc').trim().toUpperCase()
    if (config.rankedAllowedExeCrcs.includes(crc)) return reply.send('ok')

    app.log.warn({ crc }, 'build recusada: CRC fora da lista')
    return reply.send('deny')
  })
}

/**
 * Uma linha por participante, com mu/sigma antes e depois quando a partida
 * moveu rating. Guardar o antes e o depois é a única forma de auditar uma
 * reclamação, recalcular a temporada se um parâmetro mudar e detectar
 * win-trading depois do fato.
 */
async function gravarParticipantes(
  partida: Match,
  reportados: JogadorReportado[],
  contas: Account[],
  ratings: Map<string, { antes: MuSigma; depois: MuSigma }>,
): Promise<void> {
  if (reportados.length === 0) return

  const existentes = await matchPlayers().find({ where: { matchId: partida.id } })

  // O contrato do reporte não carrega o handIndex, mas ele é metade da chave
  // primária. Reaproveita o do jogador que já estiver na partida; para os
  // demais, o primeiro índice livre.
  const usados = new Set(existentes.map((p) => p.handIndex))
  let proximo = 0
  const indiceLivre = () => {
    while (usados.has(proximo)) proximo += 1
    usados.add(proximo)
    return proximo
  }

  const linhas = reportados.map((jogador) => {
    const anterior = existentes.find((p) => p.nickname.toLowerCase() === jogador.nickname.toLowerCase())
    const rating = ratings.get(jogador.nickname)
    const conta = contas.find((c) => c.nickname.toLowerCase() === jogador.nickname.toLowerCase())

    return {
      matchId: partida.id,
      handIndex: anterior?.handIndex ?? indiceLivre(),
      accountId: conta?.id ?? null,
      nickname: jogador.nickname,
      time: jogador.time,
      wonOrLost: jogador.wonOrLost,
      muBefore: rating?.antes.mu ?? null,
      sigmaBefore: rating?.antes.sigma ?? null,
      muAfter: rating?.depois.mu ?? null,
      sigmaAfter: rating?.depois.sigma ?? null,
      abandonou: jogador.abandonou,
    }
  })

  await matchPlayers().save(linhas)
}
