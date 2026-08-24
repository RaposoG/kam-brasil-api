// O que este teste protege, e por que ele existe:
//
// 1. **Vazamento de pontuação.** O dono foi explícito: o jogador nunca vê mu,
//    sigma nem c — quem vê a pontuação tenta manipulá-la. Os dublês abaixo
//    devolvem de propósito linhas *cheias* desses campos; se alguém trocar uma
//    `vista*` por um `return linha` "para simplificar", o teste quebra na hora.
// 2. **Banir fora do turno é 409.** É contrato de rota, não detalhe interno.
// 3. **Prazo estourado bane sozinho.** Um jogador ausente não pode congelar a
//    partida dos outros sete.
// 4. **Sobra exatamente 1 mapa.** 10 da temporada, 6 bans, sorteio entre 4.
//
// O banco não participa: `../data-source.ts` e `../config.ts` são dublês.

import { expect, mock, test } from 'bun:test'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { Lobby } from '../entities/lobby.ts'
import { LobbyPlayer } from '../entities/lobby-player.ts'

// `config.ts` é o de verdade (ele lê o ambiente no import): trocá-lo por dublê
// derrubaria quem já o importou neste mesmo processo de teste.
process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const SEASON_ID = '11111111-1111-4111-8111-111111111111'
const LOBBY_ID = '22222222-2222-4222-8222-222222222222'
const EU = '33333333-3333-4333-8333-333333333333'
const OUTRO = '44444444-4444-4444-8444-444444444444'
const ESTRANHO = '55555555-5555-4555-8555-555555555555'

/** Os 10 mapas da temporada. Ids válidos porque a rota valida `mapId` com zod. */
const POOL = Array.from({ length: 10 }, (_, i) => ({
  id: `0000000${i}-0000-4000-8000-000000000000`,
  nome: `Mapa ${i + 1}`,
}))
const POOL_IDS = POOL.map((m) => m.id)

/** Números distintos de qualquer outro campo: se aparecerem na resposta, vazou. */
const MU = 26.123456
const SIGMA = 3.987654
const C = MU - 2 * SIGMA

/** O que o banco devolveria — de propósito com a pontuação junto. */
const RATING = {
  accountId: EU,
  seasonId: SEASON_ID,
  mu: MU,
  sigma: SIGMA,
  rankedMatches: 14,
  placementDone: true,
  tier: 'espadachim',
  tierSince: new Date('2026-08-01T00:00:00Z'),
  demotionStrikes: 0,
}

/** O rival ainda está em colocação: tem rating, mas não tem tier a exibir. */
const RATING_RIVAL = {
  accountId: OUTRO,
  seasonId: SEASON_ID,
  mu: 24.5,
  sigma: 6.5,
  rankedMatches: 3,
  placementDone: false,
  tier: null,
  tierSince: null,
  demotionStrikes: 0,
}

const LINHA_APEX = { nickname: 'tano', mu: MU, sigma: SIGMA, c: C }

let lobbyAtual: Lobby
let jogadoresDoLobby: LobbyPlayer[]

function repoFake(rows: unknown[] = []) {
  return {
    find: async () => rows,
    findOne: async () => rows[0] ?? null,
    create: (valor: unknown) => valor,
    save: async (valor: unknown) => valor,
    update: async () => ({ affected: 1 }),
    delete: async () => ({ affected: 1 }),
  }
}

/** Roteia por trecho da SQL, na ordem em que as rotas as emitem. */
async function queryFake(sql: string) {
  if (sql.includes('season_maps')) return POOL
  if (sql.includes('match_players')) return [{ wonOrLost: 'won' }, { wonOrLost: 'lost' }]
  if (sql.includes('player_ratings')) return [LINHA_APEX]
  return []
}

// A troca é em `ranked/fila-repos.ts`, e não em `data-source.ts`: no `bun test`
// só o primeiro mock de um módulo vale no processo inteiro, e `data-source.ts`
// já é trocado por `admin.test.ts`. Ver o comentário em fila-repos.ts.
await mock.module('../ranked/fila-repos.ts', () => ({
  dataSource: {
    query: queryFake,
    manager: { query: queryFake },
    transaction: async (fn: (manager: unknown) => Promise<unknown>) =>
      fn({
        query: queryFake,
        findOne: async (entidade: unknown, opcoes: { where: { accountId?: string } }) =>
          entidade === Lobby
            ? lobbyAtual
            : (jogadoresDoLobby.find((j) => j.accountId === opcoes.where.accountId) ?? null),
        update: async (_entidade: unknown, _onde: unknown, patch: Partial<Lobby>) => {
          Object.assign(lobbyAtual, patch)
          return { affected: 1 }
        },
        create: (_entidade: unknown, valor: unknown) => valor,
        save: async (valor: unknown) => valor,
      }),
  },
  seasons: () => repoFake([{ id: SEASON_ID, ativa: true }]),
  playerRatings: () => repoFake([RATING, RATING_RIVAL]),
  queueEntries: () => repoFake(),
  lobbies: () => ({ ...repoFake(), findOne: async () => lobbyAtual }),
  lobbyPlayers: () => ({ ...repoFake(), find: async () => jogadoresDoLobby }),
  // Só o laço de reserva de sala usa estes dois, e o teste sobe com tickMs = 0.
  maps: () => repoFake(),
  gameServers: () => repoFake(),
}))

// Dinâmico e depois dos mocks: um import estático seria içado para antes deles.
const {
  aplicarBan,
  tickDeBans,
  primeiraSalaLivre,
  BANS_TOTAIS,
  MAPAS_DA_TEMPORADA,
  HTTP_DO_ERRO,
  default: rankedRoutes,
} = await import('./ranked.ts')

function novoLobby(patch: Partial<Lobby> = {}): Lobby {
  return {
    id: LOBBY_ID,
    seasonId: SEASON_ID,
    mode: '1v1',
    estado: 'ban',
    turnoTime: 'A',
    turnoPrazo: new Date(Date.now() + 25_000),
    mapasBanidos: [],
    mapaEscolhidoId: null,
    serverIp: null,
    serverPort: null,
    roomIndex: null,
    roomSenha: null,
    matchId: null,
    criadoEm: new Date(),
    ...patch,
  } as Lobby
}

function novosJogadores(): LobbyPlayer[] {
  return [
    { lobbyId: LOBBY_ID, accountId: EU, nickname: 'eu', time: 'A', startLocation: 0, status: 'ok', muNoPareamento: MU },
    {
      lobbyId: LOBBY_ID,
      accountId: OUTRO,
      nickname: 'rival',
      time: 'B',
      startLocation: 1,
      status: 'ok',
      muNoPareamento: SIGMA,
    },
  ] as LobbyPlayer[]
}

function buildApp(contaId = EU): FastifyInstance {
  lobbyAtual = novoLobby()
  jogadoresDoLobby = novosJogadores()

  const app = Fastify()
  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      instance.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
        request.account = { id: contaId, queueBanUntil: null } as never
      })
    }),
  )
  // tickMs 0: o teste exercita as rotas, não o setInterval.
  app.register(rankedRoutes, { tickMs: 0 })
  return app
}

/** Toda chave da resposta que cheira a pontuação, em qualquer profundidade. */
const PROIBIDAS =
  /^(mu|sigma|c|score|pontuacao|rating|ordinal|muNoPareamento|muBefore|muAfter|sigmaBefore|sigmaAfter)$/i

function chavesProibidas(valor: unknown, caminho = ''): string[] {
  if (Array.isArray(valor)) return valor.flatMap((item, i) => chavesProibidas(item, `${caminho}[${i}]`))
  if (valor === null || typeof valor !== 'object') return []

  return Object.entries(valor).flatMap(([chave, sub]) => [
    ...(PROIBIDAS.test(chave) ? [`${caminho}.${chave}`] : []),
    ...chavesProibidas(sub, `${caminho}.${chave}`),
  ])
}

test('GET /ranked/me não devolve mu, sigma nem c — só o nome do tier', async () => {
  const app = buildApp()

  const res = await app.inject({ method: 'GET', url: '/ranked/me' })
  expect(res.statusCode).toBe(200)

  expect(chavesProibidas(res.json())).toEqual([])
  // Nem pelo valor: um campo renomeado ("pontos", "n") continuaria vazando.
  expect(res.payload).not.toContain(String(MU))
  expect(res.payload).not.toContain(String(SIGMA))
  expect(res.payload).not.toContain(String(C))

  // E o que ele devolve continua sendo útil.
  expect(res.json().tier).toBe('espadachim')
  expect(res.json().ultimos10).toEqual(['V', 'D'])
  expect(res.json().colocacao).toEqual({ feitas: 10, total: 10 })

  await app.close()
})

test('GET /ranked/leaderboard devolve posição e nome, nunca pontuação', async () => {
  const app = buildApp()

  const res = await app.inject({ method: 'GET', url: '/ranked/leaderboard' })
  expect(res.statusCode).toBe(200)

  expect(chavesProibidas(res.json())).toEqual([])
  expect(res.payload).not.toContain(String(MU))
  expect(res.payload).not.toContain(String(SIGMA))
  expect(res.payload).not.toContain(String(C))

  expect(res.json()[0]).toEqual({ posicao: 1, nickname: 'tano', tier: 'comandante' })

  await app.close()
})

test('GET /ranked/lobby/:id não vaza o mu usado no pareamento', async () => {
  const app = buildApp()

  const res = await app.inject({ method: 'GET', url: `/ranked/lobby/${LOBBY_ID}` })
  expect(res.statusCode).toBe(200)

  expect(chavesProibidas(res.json())).toEqual([])
  expect(res.payload).not.toContain(String(MU))

  expect(res.json().mapas).toHaveLength(MAPAS_DA_TEMPORADA)
  expect(res.json().times).toEqual([
    { nickname: 'eu', tier: 'espadachim', time: 'A', loc: 0 },
    // Em colocação: aparece sem tier, e sem nenhuma pista de onde ele está.
    { nickname: 'rival', tier: null, time: 'B', loc: 1 },
  ])

  await app.close()
})

test('quem não joga no lobby recebe 404, e não a lista de mapas', async () => {
  const app = buildApp(ESTRANHO)

  const lobby = await app.inject({ method: 'GET', url: `/ranked/lobby/${LOBBY_ID}` })
  expect(lobby.statusCode).toBe(404)

  const ban = await app.inject({
    method: 'POST',
    url: `/ranked/lobby/${LOBBY_ID}/ban`,
    payload: { mapId: POOL_IDS[0] },
  })
  expect(ban.statusCode).toBe(404)

  await app.close()
})

test('banir fora do turno responde 409 e não consome o ban do outro time', async () => {
  const app = buildApp()
  lobbyAtual.turnoTime = 'B' // eu sou do time A

  const res = await app.inject({
    method: 'POST',
    url: `/ranked/lobby/${LOBBY_ID}/ban`,
    payload: { mapId: POOL_IDS[0] },
  })

  expect(res.statusCode).toBe(409)
  expect(lobbyAtual.mapasBanidos).toEqual([])

  await app.close()
})

test('banir no turno grava o ban e passa a vez para o outro time', async () => {
  const app = buildApp()

  const res = await app.inject({
    method: 'POST',
    url: `/ranked/lobby/${LOBBY_ID}/ban`,
    payload: { mapId: POOL_IDS[0] },
  })

  expect(res.statusCode).toBe(200)
  expect(res.json().turnoTime).toBe('B')
  expect(lobbyAtual.mapasBanidos).toEqual([POOL_IDS[0]!])
  // Turno novo, prazo novo: ninguém herda o relógio do adversário.
  expect(new Date(res.json().turnoPrazo).getTime()).toBeGreaterThan(Date.now())

  await app.close()
})

test('mapa já banido é 409; mapa fora do pool é 400', async () => {
  const app = buildApp()
  lobbyAtual.mapasBanidos = [POOL_IDS[0]!]
  lobbyAtual.turnoTime = 'A'

  const repetido = await app.inject({
    method: 'POST',
    url: `/ranked/lobby/${LOBBY_ID}/ban`,
    payload: { mapId: POOL_IDS[0] },
  })
  expect(repetido.statusCode).toBe(409)

  const forade = await app.inject({
    method: 'POST',
    url: `/ranked/lobby/${LOBBY_ID}/ban`,
    payload: { mapId: '99999999-9999-4999-8999-999999999999' },
  })
  expect(forade.statusCode).toBe(400)

  await app.close()
})

test('lobby que já saiu da fase de bans recusa novo ban com 409', async () => {
  const app = buildApp()
  lobbyAtual.estado = 'live'

  const res = await app.inject({
    method: 'POST',
    url: `/ranked/lobby/${LOBBY_ID}/ban`,
    payload: { mapId: POOL_IDS[0] },
  })

  expect(res.statusCode).toBe(409)
  expect(HTTP_DO_ERRO['lobby-fechado']).toBe(409)
  expect(HTTP_DO_ERRO['fora-do-turno']).toBe(409)

  await app.close()
})

test('prazo estourado: o sistema bane por quem não votou e a vez passa', () => {
  const lobby = novoLobby({ turnoTime: 'A', turnoPrazo: new Date('2026-08-01T00:00:00Z') })
  const agora = new Date('2026-08-01T00:00:30Z')

  const novo = tickDeBans(lobby, POOL_IDS, agora, 25, (ids) => ids[0]!)

  expect(novo).not.toBeNull()
  expect(novo!.mapasBanidos).toEqual([POOL_IDS[0]!])
  expect(novo!.turnoTime).toBe('B')
  expect(novo!.turnoPrazo!.getTime()).toBe(agora.getTime() + 25_000)
})

test('dentro do prazo o tique não faz nada — quem bane é o jogador', () => {
  const lobby = novoLobby({ turnoPrazo: new Date('2026-08-01T00:01:00Z') })
  const agora = new Date('2026-08-01T00:00:30Z')

  expect(tickDeBans(lobby, POOL_IDS, agora, 25, (ids) => ids[0]!)).toBeNull()
})

test('6 bans alternados deixam 4 livres, e o sorteio deixa exatamente 1 mapa', () => {
  let estado = novoLobby()
  const agora = new Date('2026-08-01T00:00:00Z')
  // Sorteio determinístico: o teste é sobre a contagem, não sobre o acaso.
  const sorteio = (ids: readonly string[]) => ids[0]!

  for (let i = 0; i < BANS_TOTAIS; i++) {
    const time = i % 2 === 0 ? 'A' : 'B'
    expect(estado.turnoTime).toBe(time)

    const resultado = aplicarBan(estado, time, POOL_IDS[i]!, POOL_IDS, agora, 25, sorteio)
    expect(resultado.ok).toBe(true)
    estado = { ...estado, ...(resultado as { estado: object }).estado }
  }

  expect(estado.mapasBanidos).toHaveLength(BANS_TOTAIS)

  const livres = POOL_IDS.filter((id) => !estado.mapasBanidos.includes(id))
  expect(livres).toHaveLength(MAPAS_DA_TEMPORADA - BANS_TOTAIS)

  // Sorteado no mesmo instante do 6º ban: sobra 1 mapa, e ele saiu dos livres.
  expect(estado.estado).toBe('draw')
  expect(estado.turnoTime).toBeNull()
  expect(livres).toContain(estado.mapaEscolhidoId!)

  // E o lobby fechado não aceita mais ban nenhum.
  expect(aplicarBan(estado, 'A', POOL_IDS[9]!, POOL_IDS, agora, 25, sorteio)).toEqual({
    ok: false,
    erro: 'lobby-fechado',
  })
})

test('o prazo estourado sozinho leva o lobby até o mapa final', () => {
  let estado = novoLobby({ turnoPrazo: new Date('2026-08-01T00:00:00Z') })
  const agora = new Date('2026-08-01T00:10:00Z')

  // Ninguém votou em nenhum turno: o lobby não pode ficar preso por isso.
  for (let i = 0; i < BANS_TOTAIS; i++) {
    const novo = tickDeBans(estado, POOL_IDS, agora, 25, (ids) => ids[0]!)
    expect(novo).not.toBeNull()
    estado = { ...estado, ...novo! }
    // Depois do primeiro tique o prazo é futuro; o teste força o vencimento.
    estado.turnoPrazo = estado.turnoPrazo === null ? null : new Date('2026-08-01T00:00:00Z')
  }

  expect(estado.estado).toBe('draw')
  expect(estado.mapasBanidos).toHaveLength(BANS_TOTAIS)
  expect(estado.mapaEscolhidoId).not.toBeNull()
  expect(tickDeBans(estado, POOL_IDS, agora, 25, (ids) => ids[0]!)).toBeNull()
})

test('a sala reservada sai do bloco, e bloco cheio devolve null em vez de repetir índice', () => {
  // Duas salas no mesmo índice seriam duas partidas ranqueadas dividindo a
  // mesma sala do servidor dedicado — e nenhuma das duas começaria.
  const PRIMEIRA = 8
  const TOTAL = 8

  expect(primeiraSalaLivre(new Set())).toBe(PRIMEIRA)
  expect(primeiraSalaLivre(new Set([PRIMEIRA]))).toBe(PRIMEIRA + 1)
  // Buraco no meio é reaproveitado: o lobby que terminou liberou a sala.
  expect(primeiraSalaLivre(new Set([PRIMEIRA, PRIMEIRA + 2]))).toBe(PRIMEIRA + 1)
  // Sala fora do bloco não conta como ocupada — o bloco é só nosso.
  expect(primeiraSalaLivre(new Set([0, 1, 2]))).toBe(PRIMEIRA)

  const cheio = new Set(Array.from({ length: TOTAL }, (_, i) => PRIMEIRA + i))
  expect(primeiraSalaLivre(cheio)).toBeNull()
})
