/**
 * As rotas internas do ranqueado, sem banco.
 *
 * O que estes testes existem para não deixar quebrar:
 *
 * 1. O segredo e o allowlist de IP são a única credencial dessas rotas — quem
 *    passar por elas reescreve o rank da comunidade inteira.
 * 2. O reporte é **idempotente por partida**. O servidor dedicado reenvia (fila
 *    HTTP do Pascal, reconexão, restart), e uma segunda aplicação de rating
 *    seria invisível no log e permanente no banco.
 * 3. Partida invalidada não mexe em rating, nem para tirar nem para pôr.
 */

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'
import { FindOperator } from 'typeorm'

process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.VERIFY_ALLOWED_IPS = '127.0.0.1'
process.env.RANKED_INTERNAL_SECRET = 'segredo-de-teste'
process.env.RANKED_ALLOWED_EXE_CRCS = ''

const SEGREDO = 'segredo-de-teste'
const TEMPORADA = '11111111-1111-4111-8111-111111111111'
const PARTIDA = '22222222-2222-4222-8222-222222222222'
const CONTA_A = '33333333-3333-4333-8333-333333333333'
const CONTA_B = '44444444-4444-4444-8444-444444444444'
const MAPA = '55555555-5555-4555-8555-555555555555'

type Linha = Record<string, unknown>

/**
 * Repositório TypeORM de mentira: só o suficiente para as rotas — igualdade e
 * `In(...)` no where. Um Postgres de verdade num teste unitário seria infra
 * para exercitar aritmética que não depende do banco.
 */
function repo(chave: string[], linhas: Linha[] = []) {
  const casa = (linha: Linha, where: Linha) =>
    Object.entries(where).every(([campo, valor]) =>
      valor instanceof FindOperator
        ? (valor.value as unknown[]).includes(linha[campo])
        : linha[campo] === valor,
    )

  return {
    linhas,
    create: (dados: Linha) => ({ ...dados }),
    async find(opcoes: { where?: Linha } = {}) {
      return linhas.filter((l) => casa(l, opcoes.where ?? {}))
    },
    async findOne(opcoes: { where?: Linha }) {
      return linhas.find((l) => casa(l, opcoes.where ?? {})) ?? null
    },
    async update(where: Linha, patch: Linha) {
      const alvo = linhas.filter((l) => casa(l, where))
      for (const l of alvo) Object.assign(l, patch)
      return { affected: alvo.length }
    },
    async save(entrada: Linha | Linha[]) {
      for (const item of Array.isArray(entrada) ? entrada : [entrada]) {
        const existente = linhas.find((l) => chave.every((k) => l[k] === item[k]))
        if (existente) Object.assign(existente, item)
        else linhas.push({ ...item })
      }
      return entrada
    },
  }
}

function bancoNovo() {
  return {
    accounts: repo(['id'], [
      { id: CONTA_A, nickname: 'Alfa', queueBanUntil: null, queueBanCount: 0, queueBanDia: null },
      { id: CONTA_B, nickname: 'Beta', queueBanUntil: null, queueBanCount: 0, queueBanDia: null },
    ]),
    seasons: repo(['id'], [{ id: TEMPORADA, cortesTier: null }]),
    lobbies: repo(['id']),
    lobbyPlayers: repo(['lobbyId', 'accountId']),
    maps: repo(['id'], [{ id: MAPA, nome: 'Cursed Ravine', mapCrc: 'A1B2C3D4', modos: ['1v1'], ativo: true }]),
    matches: repo(['id'], [
      {
        id: PARTIDA,
        lobbyId: null,
        seasonId: TEMPORADA,
        mode: '1v1',
        mapId: MAPA,
        mapCrc: 'A1B2C3D4',
        status: 'pending',
        timeVencedor: null,
        duracaoTicks: null,
        encerradoEm: null,
        invalidMotivo: null,
        fonte: 'dedicated',
      },
    ]),
    matchPlayers: repo(['matchId', 'handIndex']),
    playerRatings: repo(['accountId', 'seasonId'], [
      { id: 'r-a', accountId: CONTA_A, seasonId: TEMPORADA, mu: 25, sigma: 25 / 3, rankedMatches: 3, placementDone: false, tier: null, tierSince: null, demotionStrikes: 0, lastRankedAt: null },
      { id: 'r-b', accountId: CONTA_B, seasonId: TEMPORADA, mu: 25, sigma: 25 / 3, rankedMatches: 3, placementDone: false, tier: null, tierSince: null, demotionStrikes: 0, lastRankedAt: null },
    ]),
  }
}

let db = bancoNovo()

// A troca é em `ranked/repos.ts`, não em `data-source.ts`: no `bun test` só o
// primeiro mock de um módulo vale no processo inteiro, e `data-source.ts` já é
// mockado por `admin.test.ts` — os dois testes se derrubavam. Ver repos.ts.
mock.module('../ranked/repos.ts', () => ({
  accounts: () => db.accounts,
  seasons: () => db.seasons,
  lobbies: () => db.lobbies,
  lobbyPlayers: () => db.lobbyPlayers,
  maps: () => db.maps,
  matches: () => db.matches,
  matchPlayers: () => db.matchPlayers,
  playerRatings: () => db.playerRatings,
}))

const { default: rankedInternalRoutes } = await import('./ranked-internal.ts')

let app: ReturnType<typeof Fastify>

beforeEach(async () => {
  db = bancoNovo()
  app = Fastify({ logger: false })
  await app.register(rankedInternalRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/** Um reporte 1x1 completo: Alfa (time A) vence Beta (time B). */
const REPORTE = `/internal/ranked/report?secret=${SEGREDO}&match=${PARTIDA}&winner=A&ticks=18240&p=Alfa:A:won&p=Beta:B:lost`

test('segredo errado é 403, e nada é gravado', async () => {
  const res = await app.inject({ url: REPORTE.replace(SEGREDO, 'chute') })

  expect(res.statusCode).toBe(403)
  expect(res.body).toBe('forbidden')
  expect(res.headers['content-type']).toStartWith('text/plain')
  expect(db.matches.linhas[0]!.status).toBe('pending')
  expect(db.matchPlayers.linhas).toHaveLength(0)
})

test('segredo vazio é 403 — rota não pode virar pública por descuido', async () => {
  const res = await app.inject({ url: `/internal/ranked/rooms` })

  expect(res.statusCode).toBe(403)
})

test('IP fora do allowlist é 403 mesmo com o segredo certo', async () => {
  // O endereço do socket, não X-Forwarded-For: o cabeçalho é escrito pelo
  // cliente e um allowlist que confie nele não protege nada.
  const res = await app.inject({
    url: REPORTE,
    remoteAddress: '203.0.113.7',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  })

  expect(res.statusCode).toBe(403)
  expect(db.matches.linhas[0]!.status).toBe('pending')
})

test('reporte duplicado não duplica linha nem recalcula rating', async () => {
  const primeira = await app.inject({ url: REPORTE })

  expect(primeira.statusCode).toBe(200)
  expect(primeira.body).toBe('ok')

  const partida = db.matches.linhas[0]!
  expect(partida.status).toBe('valid')
  expect(partida.timeVencedor).toBe('A')
  expect(partida.duracaoTicks).toBe(18240)

  expect(db.matchPlayers.linhas).toHaveLength(2)
  const alfa = db.matchPlayers.linhas.find((p) => p.nickname === 'Alfa')!
  expect(alfa.accountId).toBe(CONTA_A)
  expect(alfa.wonOrLost).toBe('won')
  expect(alfa.muBefore).toBe(25)
  expect(alfa.muAfter as number).toBeGreaterThan(25)

  const ratingA = db.playerRatings.linhas.find((r) => r.accountId === CONTA_A)!
  const ratingB = db.playerRatings.linhas.find((r) => r.accountId === CONTA_B)!
  expect(ratingA.mu as number).toBeGreaterThan(25)
  expect(ratingB.mu as number).toBeLessThan(25)
  expect(ratingA.rankedMatches).toBe(4)

  const depoisDaPrimeira = JSON.stringify(db.playerRatings.linhas)

  const segunda = await app.inject({ url: REPORTE })

  expect(segunda.statusCode).toBe(200)
  expect(segunda.body).toBe('ok')
  // Nem rating novo, nem participante duplicado, nem contador andando.
  expect(JSON.stringify(db.playerRatings.linhas)).toBe(depoisDaPrimeira)
  expect(db.matchPlayers.linhas).toHaveLength(2)
  expect(db.playerRatings.linhas.find((r) => r.accountId === CONTA_A)!.rankedMatches).toBe(4)
})

test('void invalida a partida e não mexe em rating', async () => {
  const antes = JSON.stringify(db.playerRatings.linhas)

  const res = await app.inject({
    url: `/internal/ranked/void?secret=${SEGREDO}&match=${PARTIDA}&reason=desync`,
  })

  expect(res.statusCode).toBe(200)
  expect(res.body).toBe('ok')
  expect(db.matches.linhas[0]!.status).toBe('invalid')
  expect(db.matches.linhas[0]!.invalidMotivo).toBe('desync')
  expect(JSON.stringify(db.playerRatings.linhas)).toBe(antes)
  expect(db.matchPlayers.linhas).toHaveLength(0)
})

test('reporte de partida já invalidada não aplica rating', async () => {
  await app.inject({ url: `/internal/ranked/void?secret=${SEGREDO}&match=${PARTIDA}&reason=desync` })
  const antes = JSON.stringify(db.playerRatings.linhas)

  const res = await app.inject({ url: REPORTE })

  expect(res.body).toBe('ok')
  expect(db.matches.linhas[0]!.status).toBe('invalid')
  expect(JSON.stringify(db.playerRatings.linhas)).toBe(antes)
})

test('abandono vira derrota e suspende a fila de forma escalonada', async () => {
  const res = await app.inject({
    url: `/internal/ranked/report?secret=${SEGREDO}&match=${PARTIDA}&winner=A&ticks=900&p=Alfa:A:won&p=Beta:B:abandon`,
  })

  expect(res.body).toBe('ok')

  const beta = db.matchPlayers.linhas.find((p) => p.nickname === 'Beta')!
  expect(beta.wonOrLost).toBe('lost')
  expect(beta.abandonou).toBe(true)

  const conta = db.accounts.linhas.find((c) => c.id === CONTA_B)!
  expect(conta.queueBanCount).toBe(1)
  // Primeira ocorrência: 15 minutos.
  expect(Math.round(((conta.queueBanUntil as Date).getTime() - Date.now()) / 60_000)).toBe(15)
})

test('reincidência escala, e 15 dias limpos perdoam a ficha inteira', async () => {
  const abandono = `/internal/ranked/report?secret=${SEGREDO}&match=${PARTIDA}&winner=A&ticks=900&p=Alfa:A:won&p=Beta:B:abandon`
  const beta = db.accounts.linhas.find((c) => c.id === CONTA_B)!
  const emMinutos = () => Math.round(((beta.queueBanUntil as Date).getTime() - Date.now()) / 60_000)

  // Terceira ocorrência dentro da janela: 6 horas.
  beta.queueBanCount = 2
  beta.queueBanDia = new Date().toISOString().slice(0, 10)
  await app.inject({ url: abandono })
  expect(beta.queueBanCount).toBe(3)
  expect(emMinutos()).toBe(360)

  // Mesma conta, mas a última ocorrência já passou dos 15 dias: volta à
  // primeira. Não é cada abandono que expira — é a ficha inteira.
  db = bancoNovo()
  const limpo = db.accounts.linhas.find((c) => c.id === CONTA_B)!
  limpo.queueBanCount = 4
  limpo.queueBanDia = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)
  await app.inject({ url: abandono })
  expect(limpo.queueBanCount).toBe(1)
  expect(Math.round(((limpo.queueBanUntil as Date).getTime() - Date.now()) / 60_000)).toBe(15)
})

test('rooms devolve uma linha por sala reservada, no formato que o Pascal parseia', async () => {
  db.lobbies.linhas.push({
    id: 'lobby-1',
    estado: 'launch',
    roomIndex: 3,
    matchId: PARTIDA,
  })
  // Locs 1-based: no engine `StartLocation = 0` é LOC_RANDOM, e a reserva lida
  // pelo servidor dedicado trata 0 como "a API não exigiu local".
  db.lobbyPlayers.linhas.push(
    { lobbyId: 'lobby-1', accountId: CONTA_B, nickname: 'Beta', time: 'B', startLocation: 2 },
    { lobbyId: 'lobby-1', accountId: CONTA_A, nickname: 'Alfa', time: 'A', startLocation: 1 },
  )

  const res = await app.inject({ url: `/internal/ranked/rooms?secret=${SEGREDO}` })

  // `map=` junto do `mapcrc=`: sem o nome do arquivo o servidor dedicado não
  // difunde o mkMapSelect, e a sala travada abre no mapa que o host escolher.
  expect(res.body).toBe(
    `room=3;match=${PARTIDA};mapcrc=A1B2C3D4;map=Cursed Ravine;pt=15;spd=1;lock=1;p=Alfa:A:1;p=Beta:B:2`,
  )
})

test('nome de mapa com ";" não parte a reserva em duas linhas tortas', async () => {
  db.maps.linhas[0]!.nome = 'Vale; do Rei'
  db.lobbies.linhas.push({ id: 'lobby-1', estado: 'launch', roomIndex: 3, matchId: PARTIDA })
  db.lobbyPlayers.linhas.push({
    lobbyId: 'lobby-1',
    accountId: CONTA_A,
    nickname: 'Alfa',
    time: 'A',
    startLocation: 1,
  })

  const res = await app.inject({ url: `/internal/ranked/rooms?secret=${SEGREDO}` })

  expect(res.body).toContain('map=Vale do Rei;')
  expect(res.body.split('\n')).toHaveLength(1)
})

test('build sem allowlist configurado aceita qualquer CRC', async () => {
  const res = await app.inject({ url: `/internal/ranked/build?secret=${SEGREDO}&crc=DEADBEEF` })

  expect(res.body).toBe('ok')
})
