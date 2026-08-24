// O que este teste protege:
//
// 1. **Não-autoritatividade.** É a razão de o arquivo existir. Nenhuma rota de
//    replay/stats pode escrever resultado, e o teste confere isso pelo lado que
//    importa: quais colunas o UPDATE carrega.
// 2. **Só participante.** Quem não jogou não envia, e nem descobre que a
//    partida existe (404, não 403).
// 3. **Idempotência.** Reenviar o mesmo replay não duplica nem quebra; reenviar
//    um `.bas` diferente é 409 e **não** apaga o que já estava lá.
// 4. **Campo que cheira a resultado é recusado** na entrada das stats.
//
// Sem banco e sem mock.module: os repositórios entram por parâmetro de
// registro (ver `OpcoesReplay`). O disco é uma pasta temporária de verdade —
// escrever arquivo é metade do que a rota faz, e dublar isso testaria o dublê.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'bun:test'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Match } from '../entities/match.ts'
import type { MatchPlayer } from '../entities/match-player.ts'

process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const { default: replayRoutes, crc32Hex } = await import('./replay.ts')
type OpcoesReplay = import('./replay.ts').OpcoesReplay

const MATCH_ID = '66666666-6666-4666-8666-666666666666'
const EU = '77777777-7777-4777-8777-777777777777'
const ESTRANHO = '88888888-8888-4888-8888-888888888888'

const BAS = new Uint8Array([1, 2, 3, 4, 5])
const RPL = new Uint8Array([9, 9])

const pastas: string[] = []
afterAll(async () => {
  for (const p of pastas) await rm(p, { recursive: true, force: true })
})

/** Toda coluna que qualquer UPDATE deste arquivo tocou, para o teste 1. */
let colunasEscritas: string[] = []

type Ambiente = {
  app: FastifyInstance
  pasta: string
  partida: Match
  jogador: MatchPlayer
}

async function montar(contaId = EU, partidaPatch: Partial<Match> = {}): Promise<Ambiente> {
  const pasta = await mkdtemp(join(tmpdir(), 'kambrasil-replay-'))
  pastas.push(pasta)
  colunasEscritas = []

  const partida = { id: MATCH_ID, status: 'valid', timeVencedor: 'A', replayCrc: null, ...partidaPatch } as Match
  const jogador = {
    matchId: MATCH_ID,
    handIndex: 2,
    accountId: EU,
    nickname: 'eu',
    time: 'A',
    wonOrLost: 'won',
    statsJson: null,
  } as MatchPlayer

  const app = Fastify()

  // O mesmo curinga que `server.ts` instala na raiz. Está aqui porque ele é
  // justamente o que quebraria o upload em produção com o teste verde: se o
  // parser de multipart do plugin não tiver precedência sobre ele, todo POST de
  // replay vira 415 e ninguém descobre antes do deploy.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    if (body.length === 0) return done(null, {})
    done(new Error('Content-Type não suportado — use application/json'))
  })

  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      instance.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
        request.account = { id: contaId } as never
      })
    }),
  )
  const opcoes: OpcoesReplay = {
    pasta,
    partidas: () => ({
      findOne: async ({ where }) => (where.id === partida.id ? partida : null),
      update: async (_criterio, patch) => {
        colunasEscritas.push(...Object.keys(patch))
        Object.assign(partida, patch)
        return {}
      },
    }),
    jogadores: () => ({
      findOne: async ({ where }) =>
        where.matchId === jogador.matchId && where.accountId === jogador.accountId ? jogador : null,
      update: async (_criterio, patch) => {
        colunasEscritas.push(...Object.keys(patch))
        Object.assign(jogador, patch)
        return {}
      },
    }),
  }
  app.register(replayRoutes, opcoes)

  return { app, pasta, partida, jogador }
}

/** Multipart montado na mão: é exatamente o que o launcher envia. */
function multipart(partes: Record<string, Uint8Array>): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----kambrasil-teste'
  const pedacos: Uint8Array[] = []

  for (const [nome, bytes] of Object.entries(partes)) {
    pedacos.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${nome}"; filename="${nome}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      bytes,
      Buffer.from('\r\n'),
    )
  }
  pedacos.push(Buffer.from(`--${boundary}--\r\n`))

  return {
    payload: Buffer.concat(pedacos),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

test('upload grava os dois arquivos e só a coluna replayCrc', async () => {
  const { app, pasta, partida } = await montar()

  const res = await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/replay`, ...multipart({ bas: BAS, rpl: RPL }) })

  expect(res.statusCode).toBe(201)
  expect(res.json<{ crc: string; jaExistia: boolean }>()).toEqual({ crc: crc32Hex(BAS), jaExistia: false })
  expect(partida.replayCrc).toBe(crc32Hex(BAS))

  // A trava que dá nome ao arquivo: resultado não se toca por upload de cliente.
  expect(colunasEscritas).toEqual(['replayCrc'])
  expect(partida.status).toBe('valid')
  expect(partida.timeVencedor).toBe('A')

  expect(new Uint8Array(await readFile(join(pasta, `${MATCH_ID}.bas`)))).toEqual(BAS)
  expect(new Uint8Array(await readFile(join(pasta, `${MATCH_ID}.rpl`)))).toEqual(RPL)

  await app.close()
})

test('reenvio do mesmo replay é idempotente; .bas diferente é 409 e preserva o que já estava', async () => {
  const { app, pasta, partida } = await montar()

  await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/replay`, ...multipart({ bas: BAS, rpl: RPL }) })
  colunasEscritas = []

  const dedup = await app.inject({
    method: 'POST',
    url: `/matches/${MATCH_ID}/replay`,
    ...multipart({ bas: BAS, rpl: RPL }),
  })
  expect(dedup.statusCode).toBe(200)
  expect(dedup.json<{ jaExistia: boolean }>().jaExistia).toBe(true)
  // Nada a atualizar: o CRC já é esse.
  expect(colunasEscritas).toEqual([])

  const divergente = await app.inject({
    method: 'POST',
    url: `/matches/${MATCH_ID}/replay`,
    ...multipart({ bas: new Uint8Array([7, 7, 7]), rpl: RPL }),
  })
  expect(divergente.statusCode).toBe(409)

  // Divergência não pode ser um botão de anular a partida nem de sobrescrever
  // o replay do adversário.
  expect(partida.replayCrc).toBe(crc32Hex(BAS))
  expect(partida.status).toBe('valid')
  expect(new Uint8Array(await readFile(join(pasta, `${MATCH_ID}.bas`)))).toEqual(BAS)

  // ...mas também não pode apagar a prova. O slot é primeiro-a-chegar-leva, então
  // sem esta cópia o acusado subia 1 byte de lixo assim que a partida fechasse e
  // o replay verdadeiro tomava 409 para sempre — matando a análise manual, que é
  // a única defesa contra maphack que a engine comporta.
  expect(new Uint8Array(await readFile(join(pasta, `${MATCH_ID}.${EU}.bas`)))).toEqual(new Uint8Array([7, 7, 7]))
  expect(new Uint8Array(await readFile(join(pasta, `${MATCH_ID}.${EU}.rpl`)))).toEqual(RPL)

  await app.close()
})

test('quem não jogou a partida recebe 404, não 403', async () => {
  const { app, pasta } = await montar(ESTRANHO)

  const res = await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/replay`, ...multipart({ bas: BAS, rpl: RPL }) })
  expect(res.statusCode).toBe(404)

  const stats = await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/stats`, payload: { casas: 3 } })
  expect(stats.statusCode).toBe(404)

  expect(await Bun.file(join(pasta, `${MATCH_ID}.bas`)).exists()).toBe(false)
  expect(colunasEscritas).toEqual([])

  await app.close()
})

test('parte faltando é 400', async () => {
  const { app } = await montar()

  const res = await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/replay`, ...multipart({ rpl: RPL }) })
  expect(res.statusCode).toBe(400)
  expect(res.json<{ error: string }>().error).toContain('bas')

  await app.close()
})

test('GET devolve o .rpl por padrão e o .bas sob demanda; sem replay é 404', async () => {
  const { app } = await montar()

  const vazio = await app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/replay` })
  expect(vazio.statusCode).toBe(404)

  await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/replay`, ...multipart({ bas: BAS, rpl: RPL }) })

  const rpl = await app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/replay` })
  expect(rpl.statusCode).toBe(200)
  expect(new Uint8Array(rpl.rawPayload)).toEqual(RPL)

  const bas = await app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/replay?parte=bas` })
  expect(new Uint8Array(bas.rawPayload)).toEqual(BAS)

  const invalida = await app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/replay?parte=exe` })
  expect(invalida.statusCode).toBe(400)

  await app.close()
})

test('stats grava só statsJson e recusa qualquer campo que cheire a resultado', async () => {
  const { app, jogador } = await montar()

  const ok = await app.inject({
    method: 'POST',
    url: `/matches/${MATCH_ID}/stats`,
    payload: { casasConstruidas: 12, soldadosPerdidos: 30 },
  })
  expect(ok.statusCode).toBe(200)
  expect(jogador.statsJson).toEqual({ casasConstruidas: 12, soldadosPerdidos: 30 })
  expect(colunasEscritas).toEqual(['statsJson'])

  // O que não passa. Cada um destes já foi, em algum sistema, o campo que
  // alguém leu como se fosse placar oficial.
  for (const corpo of [
    { won: 1 },
    { vencedor: 1 },
    { mu: 26 },
    { sigmaAfter: 3 },
    { tier: 5 },
    { peso: 1 },
    // Valor que não é número não entra: string e objeto são o que carregariam
    // resultado disfarçado.
    { casas: 'ganhei' },
    { casas: { total: 1 } },
    { casas: null },
  ]) {
    const res = await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/stats`, payload: corpo })
    expect([res.statusCode, JSON.stringify(corpo)]).toEqual([400, JSON.stringify(corpo)])
  }

  // E a linha continua com o que passou, sem resultado nenhum encostado nela.
  expect(jogador.statsJson).toEqual({ casasConstruidas: 12, soldadosPerdidos: 30 })
  expect(jogador.wonOrLost).toBe('won')

  await app.close()
})

test('mais campos que o teto é 400 — statsJson não é depósito', async () => {
  const { app } = await montar()

  const gigante = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`campo${i}`, i]))
  const res = await app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/stats`, payload: gigante })

  expect(res.statusCode).toBe(400)

  await app.close()
})
