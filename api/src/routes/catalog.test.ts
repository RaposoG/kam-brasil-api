// O que este teste protege:
//
// 1. **A API sobe antes de existir temporada nenhuma.** Sem ativa no banco,
//    `/seasons/current` responde `{season: null}` — o launcher já trata esse
//    caso (Temporada.vue mostra "Nenhuma temporada ativa"). Estourar aqui
//    derrubaria uma rota pública por causa de uma tabela vazia.
// 2. **`endsAt` passa `null` adiante em vez de virar data inventada.** A coluna
//    `fimEm` é nullable e o painel deixa abrir temporada sem data de fim; uma
//    contagem regressiva mentirosa é pior do que nenhuma.

import { expect, mock, test } from 'bun:test'
import Fastify from 'fastify'

const SEASON_ID = '11111111-1111-4111-8111-111111111111'

/** Trocável por teste: é o que decide `{season: ...}` ou `{season: null}`. */
let ativa: Record<string, unknown> | null = null

// O primeiro `mock.module` de um módulo congela a LISTA de exports dele para o
// processo inteiro do `bun test`: um dublê estreito faz o import de outro
// arquivo de teste estourar com "Export named 'accounts' not found". Por isso o
// que reports.ts busca em data-source também aparece aqui, sem uso.
await mock.module('../data-source.ts', () => ({
  seasons: () => ({ findOne: async () => ativa }),
  dataSource: { query: async () => [] },
  accounts: () => ({}),
  reports: () => ({}),
}))

// Dinâmico e depois do mock: um import estático seria içado para antes dele.
const { default: catalogRoutes } = await import('./catalog.ts')

async function buildApp() {
  const app = Fastify()
  await app.register(catalogRoutes)
  return app
}

test('sem temporada ativa no banco, /seasons/current responde season: null', async () => {
  ativa = null
  const app = await buildApp()

  const res = await app.inject({ method: 'GET', url: '/seasons/current' })
  expect(res.statusCode).toBe(200)
  expect(res.json().season).toBeNull()

  await app.close()
})

test('a temporada vem do banco, e endsAt sem data de fim é null', async () => {
  ativa = {
    id: SEASON_ID,
    nome: 'Muralhas de Ferro',
    numero: 2,
    inicioEm: new Date('2026-09-01T03:00:00Z'),
    fimEm: null,
    ativa: true,
  }
  const app = await buildApp()

  const season = (await app.inject({ method: 'GET', url: '/seasons/current' })).json().season

  // O painel abriu a Temporada 2: a tela não pode continuar anunciando a 1.
  expect(season.number).toBe(2)
  expect(season.name).toBe('Muralhas de Ferro')
  expect(season.startsAt).toBe('2026-09-01T03:00:00.000Z')
  expect(season.endsAt).toBeNull()

  // As recompensas seguem constantes: não há coluna para elas em `seasons`.
  expect(season.rewards).toHaveLength(5)

  await app.close()
})
