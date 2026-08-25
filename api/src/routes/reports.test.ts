// O que este teste protege, e por que ele existe:
//
// 1. **A denúncia é de quem está logado.** `denuncianteId` sai da sessão, nunca
//    do corpo — senão qualquer um denuncia em nome de qualquer um.
// 2. **Nem si mesmo, nem duas vezes a mesma partida.** As duas recusas que
//    mantêm a fila do admin trabalhável.
// 3. **`resolucao` não vaza para o denunciante.** É o parecer interno da
//    moderação sobre um terceiro; o que ele precisa ver é o estado.
//
// O banco não participa: `../data-source.ts` é trocado por dublês. O que está
// sob teste é a regra da rota e a forma da resposta, não SQL.

import { expect, mock, test } from 'bun:test'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type HookHandlerDoneFunction,
} from 'fastify'
import fp from 'fastify-plugin'

const EU = '11111111-1111-4111-8111-111111111111'
const ALVO = '22222222-2222-4222-8222-222222222222'
const MATCH_ID = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'
const OUTRA_CONTA = '55555555-5555-4555-8555-555555555555'

const MOTIVO = 'usou maphack: sabia onde estava minha tropa antes de qualquer scout'

/** Trocáveis por teste — é o que decide 404, 409 e o que /meus devolve. */
let contaEncontrada: { id: string; nickname: string } | null = { id: ALVO, nickname: 'tano' }
let denunciaAberta: unknown = null
let linhasDeMeus: unknown[] = []

/** O que a rota mandou gravar. */
const gravadas: Record<string, unknown>[] = []

// O primeiro `mock.module` de um módulo congela a LISTA de exports dele para o
// processo inteiro do `bun test`: um dublê estreito faz o import de outro
// arquivo de teste estourar com "Export named 'seasons' not found". Daí o
// `seasons` aqui, que catalog.ts busca e este teste não usa.
await mock.module('../data-source.ts', () => ({
  chamados: () => ({}),
  chamadoMensagens: () => ({}),
  dataSource: {
    query: async () => linhasDeMeus,
  },
  seasons: () => ({ findOne: async () => null }),
  accounts: () => ({
    createQueryBuilder: () => ({
      where: () => ({ getOne: async () => contaEncontrada }),
    }),
  }),
  reports: () => ({
    findOne: async () => denunciaAberta,
    create: (valor: Record<string, unknown>) => valor,
    save: async (valor: Record<string, unknown>) => {
      gravadas.push(valor)
      return { id: REPORT_ID, ...valor }
    },
  }),
}))

// Dinâmico e depois do mock: um import estático seria içado para antes dele.
const { default: reportsRoutes } = await import('./reports.ts')

/**
 * `authenticate` aqui é dublê — a validade da sessão já é assunto do plugin de
 * auth. Em estilo callback pelo mesmo motivo de admin.test.ts: sob o
 * `app.inject` do Bun, um hook async que responde e retorna não impede o
 * handler da rota de rodar em seguida.
 */
function buildApp(contaId: string | null): FastifyInstance {
  const app = Fastify()

  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      const stub = (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
        if (!contaId) {
          reply.code(401).send({ error: 'token ausente ou inválido' })
          return
        }
        request.account = { id: contaId, nickname: 'eu' } as never
        done()
      }
      instance.decorate('authenticate', stub as unknown as FastifyInstance['authenticate'])
    }),
  )
  app.register(reportsRoutes)

  return app
}

/** Estado limpo: cada teste declara o seu. O rate-limit é por conta, não global. */
function reset() {
  contaEncontrada = { id: ALVO, nickname: 'tano' }
  denunciaAberta = null
  linhasDeMeus = []
  gravadas.length = 0
}

test('POST /reports cria a denúncia com o denunciante vindo da sessão', async () => {
  reset()
  const app = buildApp(EU)

  const res = await app.inject({
    method: 'POST',
    url: '/reports',
    // `denuncianteId` no corpo de propósito: tem que ser ignorado.
    payload: { nickname: 'tano', matchId: MATCH_ID, motivo: MOTIVO, denuncianteId: OUTRA_CONTA },
  })

  expect(res.statusCode).toBe(201)
  expect(res.json().denuncia.estado).toBe('aberta')

  const gravada = gravadas[0]!
  expect(gravada.denuncianteId).toBe(EU)
  expect(gravada.denunciadoId).toBe(ALVO)
  expect(gravada.matchId).toBe(MATCH_ID)
  // Nasce aberta e sem parecer: resolver é ato do admin, em outra rota.
  expect(gravada.estado).toBe('aberta')
  expect(gravada.resolucao).toBeNull()

  await app.close()
})

test('denunciar a si mesmo é 400, e nada é gravado', async () => {
  reset()
  contaEncontrada = { id: EU, nickname: 'eu' }
  const app = buildApp(EU)

  const res = await app.inject({
    method: 'POST',
    url: '/reports',
    payload: { nickname: 'eu', motivo: MOTIVO },
  })

  expect(res.statusCode).toBe(400)
  expect(gravadas).toHaveLength(0)

  await app.close()
})

test('segunda denúncia aberta sobre a mesma partida é 409', async () => {
  reset()
  denunciaAberta = { id: REPORT_ID, estado: 'aberta' }
  const app = buildApp(EU)

  const res = await app.inject({
    method: 'POST',
    url: '/reports',
    payload: { nickname: 'tano', matchId: MATCH_ID, motivo: MOTIVO },
  })

  expect(res.statusCode).toBe(409)
  expect(gravadas).toHaveLength(0)

  await app.close()
})

test('nickname que não existe é 404, e motivo curto demais é 400', async () => {
  reset()
  const app = buildApp(EU)

  contaEncontrada = null
  const semAlvo = await app.inject({
    method: 'POST',
    url: '/reports',
    payload: { nickname: 'ninguem', motivo: MOTIVO },
  })
  expect(semAlvo.statusCode).toBe(404)

  contaEncontrada = { id: ALVO, nickname: 'tano' }
  const semMotivo = await app.inject({
    method: 'POST',
    url: '/reports',
    payload: { nickname: 'tano', motivo: 'cheat' },
  })
  expect(semMotivo.statusCode).toBe(400)

  expect(gravadas).toHaveLength(0)

  await app.close()
})

test('a segunda denúncia válida seguida cai no rate-limit', async () => {
  reset()
  // Conta própria deste teste: a janela do limiter é por conta e as outras
  // provas já queimaram a de EU.
  const app = buildApp(OUTRA_CONTA)

  const payload = { nickname: 'tano', motivo: MOTIVO }
  expect((await app.inject({ method: 'POST', url: '/reports', payload })).statusCode).toBe(201)
  expect((await app.inject({ method: 'POST', url: '/reports', payload })).statusCode).toBe(429)

  // A recusada não gravou nada.
  expect(gravadas).toHaveLength(1)

  await app.close()
})

test('as duas rotas exigem sessão', async () => {
  reset()
  const app = buildApp(null)

  const post = await app.inject({ method: 'POST', url: '/reports', payload: { nickname: 'tano', motivo: MOTIVO } })
  expect(post.statusCode).toBe(401)

  const get = await app.inject({ method: 'GET', url: '/reports/meus' })
  expect(get.statusCode).toBe(401)

  await app.close()
})

test('GET /reports/meus mostra o estado e não o parecer do admin', async () => {
  reset()
  linhasDeMeus = [
    {
      id: REPORT_ID,
      denunciado: 'tano',
      matchId: MATCH_ID,
      motivo: MOTIVO,
      estado: 'rejeitada',
      criadoEm: new Date('2026-08-01T00:00:00Z'),
      resolvidoEm: new Date('2026-08-02T00:00:00Z'),
    },
  ]
  const app = buildApp(EU)

  const res = await app.inject({ method: 'GET', url: '/reports/meus' })
  expect(res.statusCode).toBe(200)

  const denuncia = res.json().denuncias[0]
  expect(denuncia.estado).toBe('rejeitada')
  expect(denuncia.denunciado).toBe('tano')
  // O parecer é registro interno da moderação sobre um terceiro.
  expect(denuncia).not.toHaveProperty('resolucao')
  expect(denuncia).not.toHaveProperty('resolvidoPor')

  await app.close()
})
