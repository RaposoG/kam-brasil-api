// O que este teste protege, e por que ele existe:
//
// 1. Nenhuma rota do painel pode escapar do guarda. São 16 rotas; a tabela
//    abaixo passa por todas com uma conta comum e exige 403 em cada uma. Se
//    alguém acrescentar uma rota e esquecer de listá-la aqui, o teste não
//    reclama — por isso o guarda é um hook do plugin inteiro (routes/admin.ts)
//    e não uma opção por rota: a proteção não depende de lembrar.
// 2. A listagem de jogadores do admin tem que trazer mu/sigma/c de verdade.
//    É o único lugar da API onde isso é correto, e é fácil alguém "consertar"
//    achando que é vazamento de pontuação.
//
// O banco não participa: `../data-source.ts` é trocado por dublês. O que está
// sob teste é autorização e forma da resposta, não SQL.

import { expect, mock, test } from 'bun:test'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type HookHandlerDoneFunction,
} from 'fastify'
import fp from 'fastify-plugin'

const SEASON_ID = '11111111-1111-4111-8111-111111111111'
const MAP_ID = '22222222-2222-4222-8222-222222222222'
const MATCH_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'
const REPORT_ID = '55555555-5555-4555-8555-555555555555'

/** O que o banco devolveria para a listagem de jogadores do admin. */
const LINHA_JOGADOR = {
  id: ACCOUNT_ID,
  nickname: 'tano',
  mu: 27.5,
  sigma: 3.1,
  c: 21.3,
  tier: 'espadachim',
  rankedMatches: 12,
}

/** Toda SQL que a rota emitiu — usada para provar que o `c` vem do banco. */
const sqlEmitida: string[] = []

function repoFake(rows: unknown[] = []) {
  return {
    find: async () => rows,
    findOne: async () => rows[0] ?? null,
    create: (valor: unknown) => valor,
    save: async (valor: unknown) => ({ id: SEASON_ID, ...(valor as object) }),
    update: async () => ({ affected: 1 }),
    delete: async () => ({ affected: 1 }),
  }
}

await mock.module('../data-source.ts', () => ({
  chamados: () => ({}),
  redefinicoesSenha: () => ({}),
  chamadoMensagens: () => ({}),
  dataSource: {
    query: async (sql: string) => {
      sqlEmitida.push(sql)
      return sql.includes('player_ratings') ? [LINHA_JOGADOR] : []
    },
    transaction: async (fn: (manager: unknown) => Promise<unknown>) =>
      fn({ update: async () => ({}), delete: async () => ({}), insert: async () => ({}) }),
  },
  accounts: () => repoFake(),
  maps: () => repoFake(),
  matches: () => repoFake([{ id: MATCH_ID, status: 'invalid' }]),
  matchPlayers: () => repoFake(),
  reports: () => repoFake(),
  seasons: () => repoFake([{ id: SEASON_ID, ativa: true }]),
}))

// Dinâmico e depois do mock: um import estático seria içado para antes dele.
const { default: adminRoutes } = await import('./admin.ts')

type Conta = { id: string; isAdmin: boolean }

/**
 * `authenticate` aqui é dublê: o que está sob teste é o guarda de admin, e a
 * validade da sessão já é assunto do plugin de auth. Em estilo callback pelo
 * mesmo motivo do `requireAdmin` — sob o `app.inject` do Bun, um hook async que
 * responde e retorna não impede o handler da rota de rodar em seguida.
 */
function buildApp(conta: Conta | null): FastifyInstance {
  const app = Fastify()

  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      // Cast porque o tipo declarado do `authenticate` é o async da produção;
      // aqui o dublê é callback, de propósito (ver comentário acima).
      const stub = (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        if (!conta) {
          reply.code(401).send({ error: 'token ausente ou inválido' })
          return
        }
        request.account = conta as never
        done()
      }
      instance.decorate('authenticate', stub as unknown as FastifyInstance['authenticate'])
    }),
  )
  app.register(adminRoutes)

  return app
}

/** Toda rota do painel, com um corpo válido — o 403 não pode depender do corpo. */
const ROTAS: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: Record<string, unknown> }[] = [
  { method: 'GET', url: '/admin/seasons' },
  { method: 'POST', url: '/admin/seasons', payload: { nome: 'Temporada 1', numero: 1 } },
  { method: 'POST', url: `/admin/seasons/${SEASON_ID}/activate` },
  { method: 'POST', url: `/admin/seasons/${SEASON_ID}/close`, payload: {} },
  { method: 'GET', url: '/admin/maps' },
  { method: 'POST', url: '/admin/maps', payload: { nome: 'Cursed Ravine', mapCrc: 'a1b2c3d4', modos: ['1v1'] } },
  { method: 'GET', url: `/admin/seasons/${SEASON_ID}/maps` },
  { method: 'PUT', url: `/admin/seasons/${SEASON_ID}/maps`, payload: { mapIds: [MAP_ID] } },
  { method: 'GET', url: '/admin/players' },
  { method: 'GET', url: '/admin/punishments' },
  { method: 'PUT', url: `/admin/accounts/${ACCOUNT_ID}/queue-ban`, payload: { minutos: 15 } },
  { method: 'DELETE', url: `/admin/accounts/${ACCOUNT_ID}/queue-ban` },
  { method: 'GET', url: '/admin/matches' },
  { method: 'GET', url: `/admin/matches/${MATCH_ID}` },
  { method: 'GET', url: '/admin/reports' },
  { method: 'POST', url: `/admin/reports/${REPORT_ID}/resolve`, payload: { estado: 'resolvida' } },
]

test('conta comum leva 403 em todas as rotas do painel', async () => {
  const app = buildApp({ id: ACCOUNT_ID, isAdmin: false })

  for (const rota of ROTAS) {
    const res = await app.inject(rota)
    expect(`${rota.method} ${rota.url} -> ${res.statusCode}`).toBe(`${rota.method} ${rota.url} -> 403`)
  }

  await app.close()
})

test('sem sessão leva 401, e não 403 — o guarda roda depois do authenticate', async () => {
  const app = buildApp(null)

  const res = await app.inject(ROTAS[0]!)
  expect(res.statusCode).toBe(401)

  await app.close()
})

test('conta admin passa em todas as rotas do painel', async () => {
  const app = buildApp({ id: ACCOUNT_ID, isAdmin: true })

  for (const rota of ROTAS) {
    const res = await app.inject(rota)
    // 200 ou 201 em todas: os corpos da tabela são válidos, então nada aqui
    // pode cair em 400 de validação nem em 500 de SQL malformada.
    expect(`${rota.method} ${rota.url} -> ${res.statusCode}`).toMatch(/-> 20[01]$/)
  }

  await app.close()
})

test('POST /admin/seasons e /admin/maps criam com 201', async () => {
  const app = buildApp({ id: ACCOUNT_ID, isAdmin: true })

  const season = await app.inject({ method: 'POST', url: '/admin/seasons', payload: { nome: 'T1', numero: 1 } })
  expect(season.statusCode).toBe(201)
  // Criar não ativa: virar a temporada é um ato separado.
  expect(season.json().season.ativa).toBe(false)

  const map = await app.inject({
    method: 'POST',
    url: '/admin/maps',
    payload: { nome: 'Cursed Ravine', mapCrc: 'a1b2c3d4', modos: ['1v1'] },
  })
  expect(map.statusCode).toBe(201)
  // CRC normalizado: o índice único não pode deixar o mesmo mapa entrar duas
  // vezes só por diferença de caixa.
  expect(map.json().map.mapCrc).toBe('A1B2C3D4')

  await app.close()
})

test('a listagem de jogadores do admin traz mu, sigma e c de verdade', async () => {
  const app = buildApp({ id: ACCOUNT_ID, isAdmin: true })
  sqlEmitida.length = 0

  const res = await app.inject({ method: 'GET', url: '/admin/players' })
  expect(res.statusCode).toBe(200)

  const jogador = res.json().players[0]
  expect(jogador.mu).toBe(27.5)
  expect(jogador.sigma).toBe(3.1)
  expect(jogador.c).toBe(21.3)

  // E o `c` é calculado no banco a partir de mu e sigma, não inventado pela
  // rota — é a pontuação oculta real, a mesma que decide o tier.
  const sql = sqlEmitida.find((s) => s.includes('player_ratings'))
  expect(sql).toContain('2 * r."sigma"')

  await app.close()
})

test('a listagem de partidas do admin não filtra as inválidas', async () => {
  const app = buildApp({ id: ACCOUNT_ID, isAdmin: true })
  sqlEmitida.length = 0

  await app.inject({ method: 'GET', url: '/admin/matches' })

  // Sem cláusula de status: o painel precisa enxergar desync e fraude, que são
  // exatamente as partidas que as rotas públicas escondem.
  const sql = sqlEmitida.find((s) => s.includes('from "matches"'))
  expect(sql).not.toContain('"status" =')

  // Já a inspeção de uma partida específica devolve a inválida sem reclamar.
  const uma = await app.inject({ method: 'GET', url: `/admin/matches/${MATCH_ID}` })
  expect(uma.json().match.status).toBe('invalid')

  await app.close()
})
