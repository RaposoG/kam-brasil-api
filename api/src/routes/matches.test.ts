// O que este teste protege, e por que ele existe:
//
// 1. **Vazamento de pontuação.** O dono foi explícito: o jogador nunca vê mu,
//    sigma nem c. `match_players` guarda mu/sigma antes e depois de TODA
//    partida (para auditoria e recálculo), então o histórico é o lugar mais
//    provável de um vazamento acidental — basta alguém trocar as consultas por
//    `select *`. Os dublês abaixo devolvem de propósito linhas cheias desses
//    campos, e o teste ainda confere que a própria SQL não os pede.
// 2. **Partida inválida aparece, marcada.** Esconder confunde quem jogou.
// 3. **Partida inválida não entra em agregado nenhum.** Nem vitória, nem
//    derrota, nem aproveitamento, nem mapa mais jogado.
// 4. **Cursor.** Página cheia devolve `proximoCursor`; página curta encerra a
//    rolagem. E `before` tem que chegar na SQL, senão a paginação repete tudo.
//
// O banco não participa: as rotas recebem a consulta por opção do plugin.

import { beforeEach, expect, test } from 'bun:test'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

// `config.ts` é o de verdade (ele lê o ambiente no import), então o ambiente
// precisa existir antes de qualquer import que chegue nele.
process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const EU = '33333333-3333-4333-8333-333333333333'
const RIVAL = '44444444-4444-4444-8444-444444444444'
const NINGUEM = '55555555-5555-4555-8555-555555555555'
const PARTIDA_VALIDA = '66666666-6666-4666-8666-666666666666'
const PARTIDA_INVALIDA = '77777777-7777-4777-8777-777777777777'

/** Números distintos de qualquer outro campo: se aparecerem, vazou. */
const MU = 26.123456
const SIGMA = 3.987654
const C = MU - 2 * SIGMA

/** Como o banco devolveria os participantes — de propósito com rating junto. */
function jogadores(vencedor: 'A' | 'B') {
  return [
    {
      accountId: EU,
      nickname: 'eu',
      time: 'A',
      wonOrLost: vencedor === 'A' ? 'won' : 'lost',
      abandonou: false,
      muBefore: MU,
      sigmaBefore: SIGMA,
      muAfter: MU + 1,
      sigmaAfter: SIGMA - 0.5,
      peso: 1,
    },
    {
      accountId: RIVAL,
      nickname: 'rival',
      time: 'B',
      wonOrLost: vencedor === 'A' ? 'lost' : 'won',
      abandonou: false,
      muBefore: MU,
      sigmaBefore: SIGMA,
      muAfter: MU - 1,
      sigmaAfter: SIGMA - 0.5,
      peso: 1,
    },
  ]
}

const LISTA = [
  {
    id: PARTIDA_INVALIDA,
    mode: '1v1',
    seasonId: '11111111-1111-4111-8111-111111111111',
    mapCrc: 'A1B2C3D4',
    mapaNome: 'Cursed Ravine',
    iniciadoEm: new Date('2026-08-20T22:00:00.000Z'),
    encerradoEm: new Date('2026-08-20T22:31:00.000Z'),
    duracaoTicks: 18_600,
    status: 'invalid',
    invalidMotivo: 'desync',
    timeVencedor: null,
    replayCrc: null,
    jogadores: jogadores('A'),
  },
  {
    id: PARTIDA_VALIDA,
    mode: '2v2',
    seasonId: null,
    mapCrc: 'FFEEDDCC',
    mapaNome: null,
    iniciadoEm: new Date('2026-08-20T20:00:00.000Z'),
    encerradoEm: new Date('2026-08-20T20:30:00.000Z'),
    duracaoTicks: 18_240,
    status: 'valid',
    invalidMotivo: null,
    timeVencedor: 'A',
    replayCrc: 'DEADBEEF',
    jogadores: jogadores('A'),
  },
]

/** O relatório traz `stats` por jogador; a lista, não. */
const RELATORIO = {
  ...LISTA[1],
  jogadores: jogadores('A').map((j) => ({ ...j, stats: { casas: 12, exercito: 40 } })),
}

/** 3 válidas (2V/1D) + 1 inválida que não pode entrar em conta nenhuma. */
const RESUMO = { nickname: 'eu', partidas: 3, vitorias: 2, derrotas: 1 }
const MAPAS = [
  { mapa: 'Cursed Ravine', partidas: 2 },
  { mapa: 'FFEEDDCC', partidas: 1 },
]
const ULTIMOS = [{ wonOrLost: 'won' }, { wonOrLost: 'lost' }, { wonOrLost: 'won' }]

/** A linha inteira do rating, com a pontuação: só o tier pode sair daqui. */
const RATING = { tier: 'espadachim', placementDone: true, mu: MU, sigma: SIGMA }

let executadas: { sql: string; params: unknown[] }[] = []
let contaExiste = true
let lista = LISTA

/** Roteia por trecho da SQL — cada rota emite um fragmento inconfundível. */
const consultaFake = {
  query: async (sql: string, params: unknown[] = []) => {
    executadas.push({ sql, params })
    if (sql.includes('from "accounts" a')) return contaExiste ? [RESUMO] : []
    if (sql.includes('"player_ratings"')) return [RATING]
    if (sql.includes('coalesce(mapa."nome"')) return MAPAS
    if (sql.includes('select mp."wonOrLost"')) return ULTIMOS
    if (sql.includes('json_agg')) {
      return sql.includes('m."id" = $1') ? (lista.length > 0 ? [RELATORIO] : []) : lista
    }
    return []
  },
}

const { default: matchesRoutes, vistaDasEstatisticas } = await import('./matches.ts')

function buildApp(): FastifyInstance {
  const app = Fastify()
  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      instance.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
        request.account = { id: EU } as never
      })
    }),
  )
  app.register(matchesRoutes, { consulta: consultaFake })
  return app
}

beforeEach(() => {
  executadas = []
  contaExiste = true
  lista = LISTA
})

/** Toda chave da resposta que cheira a pontuação, em qualquer profundidade. */
const PROIBIDAS =
  /^(mu|sigma|c|score|pontuacao|rating|ordinal|peso|muBefore|muAfter|sigmaBefore|sigmaAfter|muNoPareamento)$/i

function chavesProibidas(valor: unknown, caminho = ''): string[] {
  if (Array.isArray(valor)) return valor.flatMap((item, i) => chavesProibidas(item, `${caminho}[${i}]`))
  if (valor === null || typeof valor !== 'object') return []

  return Object.entries(valor).flatMap(([chave, sub]) => [
    ...(PROIBIDAS.test(chave) ? [`${caminho}.${chave}`] : []),
    ...chavesProibidas(sub, `${caminho}.${chave}`),
  ])
}

function semVazamento(payload: string) {
  expect(chavesProibidas(JSON.parse(payload))).toEqual([])
  // Nem pelo valor: um campo renomeado ("pontos", "n") continuaria vazando.
  expect(payload).not.toContain(String(MU))
  expect(payload).not.toContain(String(SIGMA))
  expect(payload).not.toContain(String(C))
}

test('nenhuma rota de jogador devolve mu, sigma nem c', async () => {
  const app = buildApp()

  for (const url of [
    '/matches',
    `/matches/${PARTIDA_VALIDA}`,
    `/accounts/${EU}/matches`,
    `/accounts/${EU}/stats`,
  ]) {
    const res = await app.inject({ method: 'GET', url })
    expect(res.statusCode).toBe(200)
    semVazamento(res.payload)
  }

  // E a pontuação nem sai do banco: nenhuma consulta pede as colunas de rating.
  expect(executadas.map((e) => e.sql).join('\n')).not.toMatch(/"(mu|sigma)(Before|After)?"/)

  await app.close()
})

test('GET /matches mostra a partida inválida, marcada — não a esconde', async () => {
  const app = buildApp()

  const res = await app.inject({ method: 'GET', url: '/matches' })
  const { partidas } = res.json()

  expect(partidas).toHaveLength(2)
  expect(partidas[0]).toMatchObject({
    id: PARTIDA_INVALIDA,
    status: 'invalid',
    invalidMotivo: 'desync',
    timeVencedor: null,
  })
  // 18 600 ticks a 10 por segundo = 31 minutos de simulação.
  expect(partidas[0].duracaoSeg).toBe(1_860)
  expect(partidas[0].mapa).toEqual({ nome: 'Cursed Ravine', crc: 'A1B2C3D4' })
  expect(partidas[0].jogadores.map((j: { nickname: string }) => j.nickname)).toEqual(['eu', 'rival'])

  // Partida sem temporada é casual, e o mapa fora do catálogo vem sem nome.
  expect(partidas[1]).toMatchObject({ ranqueada: false })
  expect(partidas[1].mapa).toEqual({ nome: null, crc: 'FFEEDDCC' })

  // Replay: as duas partes, porque uma sem a outra não roda. Sem CRC gravado
  // não há arquivo em disco — e prometer um link que dá 404 é pior que nada.
  expect(partidas[1].replay).toEqual({
    crc: 'DEADBEEF',
    bas: `/matches/${PARTIDA_VALIDA}/replay?parte=bas`,
    rpl: `/matches/${PARTIDA_VALIDA}/replay?parte=rpl`,
  })
  expect(partidas[0].replay).toBeNull()

  // A lista não carrega `stats`: é jsonb do cliente, e ninguém lê 20 de uma vez.
  expect(partidas[0].jogadores[0]).not.toHaveProperty('stats')

  await app.close()
})

test('GET /matches pagina por cursor: página cheia devolve o próximo, curta não', async () => {
  const app = buildApp()

  const cheia = await app.inject({ method: 'GET', url: '/matches?limit=2' })
  expect(cheia.json().proximoCursor).toBe(LISTA[1]!.iniciadoEm.toISOString())

  const curta = await app.inject({ method: 'GET', url: '/matches?limit=20' })
  expect(curta.json().proximoCursor).toBeNull()

  // `before` precisa virar filtro de verdade — sem isso a rolagem repete tudo.
  executadas = []
  const pagina2 = await app.inject({
    method: 'GET',
    url: `/accounts/${EU}/matches?limit=2&before=2026-08-20T20:00:00.000Z`,
  })
  expect(pagina2.statusCode).toBe(200)

  const consulta = executadas[0]!
  expect(consulta.sql).toContain('m."iniciadoEm" < $2')
  expect(consulta.params[0]).toBe(EU)
  expect(consulta.params[1]).toEqual(new Date('2026-08-20T20:00:00.000Z'))

  await app.close()
})

test('GET /matches/:id traz o relatório com stats, e 404 quando não existe', async () => {
  const app = buildApp()

  const res = await app.inject({ method: 'GET', url: `/matches/${PARTIDA_VALIDA}` })
  expect(res.json().jogadores[0].stats).toEqual({ casas: 12, exercito: 40 })
  expect(res.json().timeVencedor).toBe('A')

  lista = []
  const ausente = await app.inject({ method: 'GET', url: `/matches/${NINGUEM}` })
  expect(ausente.statusCode).toBe(404)

  const invalido = await app.inject({ method: 'GET', url: '/matches/nao-e-uuid' })
  expect(invalido.statusCode).toBe(400)

  await app.close()
})

test('GET /accounts/:id/stats agrega e responde 404 para conta inexistente', async () => {
  const app = buildApp()

  const res = await app.inject({ method: 'GET', url: `/accounts/${EU}/stats` })
  expect(res.json<unknown>()).toEqual({
    accountId: EU,
    nickname: 'eu',
    partidas: 3,
    vitorias: 2,
    derrotas: 1,
    aproveitamento: 0.6667,
    mapasMaisJogados: MAPAS,
    ultimos10: ['V', 'D', 'V'],
    tier: 'espadachim',
  })

  contaExiste = false
  const ausente = await app.inject({ method: 'GET', url: `/accounts/${NINGUEM}/stats` })
  expect(ausente.statusCode).toBe(404)

  await app.close()
})

test('a inválida fica de fora do agregado — a SQL do resumo filtra por status', async () => {
  const app = buildApp()
  await app.inject({ method: 'GET', url: `/accounts/${EU}/stats` })

  const resumo = executadas.find((e) => e.sql.includes('from "accounts" a'))!.sql
  // O filtro tem que estar em cada `count`, não no join: no join, o left join
  // preservaria a linha da partida inválida e ela contaria como vitória.
  expect(resumo).toContain(`count(*) filter (where m."status" = 'valid' and mp."wonOrLost" = 'won')`)
  expect(resumo).not.toContain(`on m."id" = mp."matchId" and m."status"`)

  for (const chave of ['coalesce(mapa."nome"', 'select mp."wonOrLost"']) {
    const sql = executadas.find((e) => e.sql.includes(chave))!.sql
    expect(sql).toContain(`m."status" = 'valid'`)
  }

  await app.close()
})

test('partida sem lado decidido não vira derrota nos últimos 10', async () => {
  const app = buildApp()
  await app.inject({ method: 'GET', url: `/accounts/${EU}/stats` })

  // 'none' é o que `ranked-internal.ts` grava quando a partida acabou sem
  // decidir o lado do jogador. Como a tela só tem V e D, a exclusão tem que
  // acontecer na consulta — no mapeamento ela viraria 'D'.
  const sql = executadas.find((e) => e.sql.includes('select mp."wonOrLost"'))!.sql
  expect(sql).toContain(`mp."wonOrLost" <> 'none'`)

  await app.close()
})

test('sem partida decidida o aproveitamento é nulo, não zero', () => {
  const vista = vistaDasEstatisticas(EU, { nickname: 'novato', partidas: 0, vitorias: 0, derrotas: 0 }, [], [], null)

  expect(vista.aproveitamento).toBeNull()
  // Ainda em colocação (ou sem rating nenhum): não há tier a exibir.
  expect(vista.tier).toBeNull()
  expect(vista.ultimos10).toEqual([])
})
