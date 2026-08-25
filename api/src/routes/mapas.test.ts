// O que este teste protege:
//
// 1. **O painel é fechado.** Upload e remoção do catálogo escrevem no disco da
//    API e mudam o que TODO jogador baixa. Conta comum leva 403, sem sessão 401.
// 2. **O CRC vem do arquivo, não do que digitaram.** E quando não dá para
//    conferir, a resposta AVISA e a linha fica marcada — CRC errado é o bug do
//    download eterno, e ele falha em silêncio do lado do jogador.
// 3. **Nome de arquivo é fronteira.** Um `..` no `filename` do multipart não
//    pode gravar fora da pasta do catálogo.
// 4. **O manifesto descreve o que está em disco**, e a URL de download carrega a
//    assinatura — é o que torna verdadeiro o `immutable` do hook de /downloads/.
// 5. **Remover não apaga histórico**: mapa que já jogou vira inativo.
//
// Sem banco: os repositórios entram por parâmetro de registro (`OpcoesMapas`),
// como em replay.ts. O disco é pasta temporária de verdade — gravar arquivo é
// metade do que a rota faz, e dublar isso testaria o dublê.

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'bun:test'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type HookHandlerDoneFunction,
} from 'fastify'
import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import type { GameMap } from '../entities/map.ts'

process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const { default: mapasRoutes } = await import('./mapas.ts')
type OpcoesMapas = import('./mapas.ts').OpcoesMapas

const ADMIN = '11111111-1111-4111-8111-111111111111'
const MAPA = 'A Clash of Kings'

const DAT = new Uint8Array([1, 2, 3])
const MAPFILE = new Uint8Array([4, 5, 6, 7])
/** 74 96 05 80 em little-endian = 0x80059674 — o `.mi` real deste mapa. */
const MI = new Uint8Array([0x74, 0x96, 0x05, 0x80, 0xc7, 0x4c, 0xaa, 0xdd])
const CRC = '80059674'
/** Outro mapa, outro CRC: o índice único não deixa dois mapas com o mesmo. */
const MI_ARENA = new Uint8Array([0x01, 0x02, 0x03, 0x04])

const pastas: string[] = []
afterAll(async () => {
  for (const p of pastas) await rm(p, { recursive: true, force: true })
})

type Ambiente = {
  app: FastifyInstance
  pasta: string
  linhas: GameMap[]
  avisos: string[]
  partidasPorMapa: Record<string, number>
}

async function montar(conta: { id: string; isAdmin: boolean } | null = { id: ADMIN, isAdmin: true }): Promise<Ambiente> {
  const pasta = await mkdtemp(join(tmpdir(), 'kambrasil-mapas-'))
  pastas.push(pasta)

  const linhas: GameMap[] = []
  const avisos: string[] = []
  const partidasPorMapa: Record<string, number> = {}
  // uuid de verdade: as rotas do painel validam o parâmetro com `z.uuid()`.
  const novoId = () => crypto.randomUUID()

  const app = Fastify()

  // O mesmo curinga que `server.ts` instala na raiz: se o parser de multipart
  // do escopo não tiver precedência sobre ele, todo upload vira 415 em produção
  // com o teste verde.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    if (body.length === 0) return done(null, {})
    done(new Error('Content-Type não suportado — use application/json'))
  })

  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      // Estilo callback pelo mesmo motivo de admin.test.ts: sob o `inject` do
      // Bun, um hook async que responde e retorna não impede o handler de rodar.
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

  const opcoes: OpcoesMapas = {
    pasta,
    avisar: (assinatura) => avisos.push(assinatura),
    partidas: () => ({ countBy: async ({ mapId }) => partidasPorMapa[mapId] ?? 0 }),
    mapas: () => ({
      find: async ({ where }) =>
        linhas
          .filter((l) => where === undefined || l.ativo === where.ativo)
          .sort((a, b) => (a.nome < b.nome ? -1 : 1)),
      findOne: async ({ where }) =>
        linhas.find((l) => Object.entries(where).every(([k, v]) => l[k as keyof GameMap] === v)) ?? null,
      save: async (valor) => {
        const existente = valor.id ? linhas.find((l) => l.id === valor.id) : undefined
        if (existente) {
          // Cópia, como o TypeORM faria: `save` não muta o objeto que um
          // `findOne` anterior devolveu.
          const atualizado = { ...existente, ...valor } as GameMap
          linhas[linhas.indexOf(existente)] = atualizado
          return atualizado
        }
        const novo = { id: novoId(), ...valor } as GameMap
        linhas.push(novo)
        return novo
      },
      update: async ({ id }, patch) => {
        const alvo = linhas.find((l) => l.id === id)
        if (alvo) Object.assign(alvo, patch)
        return {}
      },
      delete: async ({ id }) => {
        const i = linhas.findIndex((l) => l.id === id)
        if (i >= 0) linhas.splice(i, 1)
        return {}
      },
    }),
  }
  app.register(mapasRoutes, opcoes)
  await app.ready()

  return { app, pasta, linhas, avisos, partidasPorMapa }
}

/**
 * O multipart montado byte a byte como `admin.rs: corpo_multipart` monta: campo
 * de texto sem `filename`, arquivo com. Se os dois formatos divergirem, o
 * upload real quebra com o teste verde.
 */
function multipart(
  campos: Record<string, string>,
  arquivos: [string, Uint8Array][],
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----kambrasil-teste'
  const pedacos: Uint8Array[] = []

  for (const [nome, valor] of Object.entries(campos)) {
    pedacos.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`))
  }
  for (const [nome, bytes] of arquivos) {
    pedacos.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="arquivos"; filename="${nome}"\r\n` +
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

const pastaCompleta = (nome = MAPA, mi = true): [string, Uint8Array][] => [
  [`${nome}.dat`, DAT],
  [`${nome}.map`, MAPFILE],
  ...(mi ? ([[`${nome}.mi`, nome === MAPA ? MI : MI_ARENA]] as [string, Uint8Array][]) : []),
]

const subir = (app: FastifyInstance, campos: Record<string, string>, arquivos: [string, Uint8Array][]) =>
  app.inject({ method: 'POST', url: '/admin/maps/upload', ...multipart(campos, arquivos) })

test('conta comum não sobe nem remove mapa, e sem sessão é 401', async () => {
  const comum = await montar({ id: ADMIN, isAdmin: false })
  expect((await subir(comum.app, {}, pastaCompleta())).statusCode).toBe(403)
  expect(
    (await comum.app.inject({ method: 'DELETE', url: `/admin/maps/${ADMIN}` })).statusCode,
  ).toBe(403)
  await comum.app.close()

  const anonimo = await montar(null)
  expect((await subir(anonimo.app, {}, pastaCompleta())).statusCode).toBe(401)
  // O manifesto e o download seguem abertos: a sincronia roda antes do login.
  expect((await anonimo.app.inject({ method: 'GET', url: '/catalog/mapas' })).statusCode).toBe(200)
  await anonimo.app.close()
})

test('o upload grava os arquivos, lê o CRC do .mi e publica o manifesto', async () => {
  const { app, pasta, linhas, avisos } = await montar()

  const res = await subir(app, { modos: '1v1,2v2' }, pastaCompleta())
  expect(res.statusCode).toBe(201)

  const corpo = res.json()
  // O CRC saiu do arquivo, não de campo digitado: nem foi enviado um.
  expect(corpo.map.mapCrc).toBe(CRC)
  expect(corpo.crcVerificado).toBe(true)
  expect(corpo.avisos).toEqual([])
  expect(corpo.map.modos).toEqual(['1v1', '2v2'])

  // Os bytes estão em disco, sob MapsMP/, e o `.mi` NÃO foi distribuído.
  expect(new Uint8Array(await readFile(join(pasta, 'MapsMP', MAPA, `${MAPA}.dat`)))).toEqual(DAT)
  await expect(stat(join(pasta, 'MapsMP', MAPA, `${MAPA}.mi`))).rejects.toThrow()

  const manifesto = (await app.inject({ method: 'GET', url: '/catalog/mapas' })).json()
  expect(manifesto.mapas).toHaveLength(1)
  expect(manifesto.mapas[0].arquivos.map((a: { path: string }) => a.path)).toEqual([
    `MapsMP/${MAPA}/${MAPA}.dat`,
    `MapsMP/${MAPA}/${MAPA}.map`,
  ])
  expect(manifesto.mapas[0].arquivos[0].size).toBe(DAT.length)
  expect(manifesto.mapas[0].arquivos[0].sha256).toMatch(/^[0-9a-f]{64}$/)

  // A assinatura vai na baseUrl: é ela que faz o `immutable` de /downloads/ ser
  // verdade, porque corrigir um mapa muda a URL de todos os arquivos.
  expect(manifesto.baseUrl.endsWith(`/downloads/mapas/${manifesto.assinatura}`)).toBe(true)
  // E foi difundida para quem está com o launcher aberto.
  expect(avisos.at(-1)).toBe(manifesto.assinatura)

  // O download entrega os mesmos bytes que o manifesto descreve.
  const arquivo = await app.inject({
    method: 'GET',
    url: encodeURI(`/downloads/mapas/${manifesto.assinatura}/MapsMP/${MAPA}/${MAPA}.map`),
  })
  expect(arquivo.statusCode).toBe(200)
  expect(new Uint8Array(arquivo.rawPayload)).toEqual(MAPFILE)

  expect(linhas[0]!.crcVerificado).toBe(true)
  await app.close()
})

test('sem .mi o CRC digitado vale, mas a resposta avisa e a linha fica marcada', async () => {
  const { app, linhas } = await montar()

  const res = await subir(app, { mapCrc: 'a1b2c3d4' }, pastaCompleta(MAPA, false))
  expect(res.statusCode).toBe(201)
  expect(res.json().map.mapCrc).toBe('A1B2C3D4')
  expect(res.json().crcVerificado).toBe(false)
  // O aviso é a única coisa que separa "CRC certo" de "download eterno".
  expect(res.json().avisos[0]).toContain('CONFERIR')
  expect(linhas[0]!.crcVerificado).toBe(false)

  await app.close()
})

test('sem .mi e sem CRC digitado o upload é recusado', async () => {
  const { app, linhas } = await montar()
  const res = await subir(app, {}, pastaCompleta(MAPA, false))

  expect(res.statusCode).toBe(400)
  expect(linhas).toHaveLength(0)
  await app.close()
})

test('o CRC do arquivo tem precedência sobre o digitado, e a divergência é avisada', async () => {
  const { app } = await montar()
  const res = await subir(app, { mapCrc: 'DEADBEEF' }, pastaCompleta())

  expect(res.json().map.mapCrc).toBe(CRC)
  expect(res.json().avisos[0]).toContain('DEADBEEF')
  await app.close()
})

test('filename com escape não grava nada, nem dentro nem fora da pasta', async () => {
  const { app, pasta, linhas } = await montar()

  const res = await subir(app, {}, [...pastaCompleta(), ['../../fora.dat', DAT]])

  expect(res.statusCode).toBe(400)
  expect(linhas).toHaveLength(0)
  await expect(stat(join(pasta, '..', '..', 'fora.dat'))).rejects.toThrow()
  // E nem os arquivos legítimos do mesmo envio entraram: ou sobe a pasta
  // inteira, ou não sobe nada.
  await expect(stat(join(pasta, 'MapsMP'))).rejects.toThrow()
  await app.close()
})

test('arquivo que não é conteúdo de mapa não sobe', async () => {
  const { app } = await montar()
  const res = await subir(app, {}, [...pastaCompleta(), ['patch.exe', DAT]])

  expect(res.statusCode).toBe(400)
  expect(res.json().error).toContain('patch.exe')
  await app.close()
})

test('reenvio substitui os arquivos e apaga o que saiu da pasta', async () => {
  const { app, pasta, linhas } = await montar()

  await subir(app, { modos: '1v1' }, [...pastaCompleta(), [`${MAPA}.txt`, new Uint8Array([9])]])
  const antes = (await app.inject({ method: 'GET', url: '/catalog/mapas' })).json().assinatura

  const res = await subir(app, {}, pastaCompleta())
  // 200, não 201: é o mesmo mapa, atualizado.
  expect(res.statusCode).toBe(200)
  expect(linhas).toHaveLength(1)
  // Envio sem `modos` não zera os modos de um mapa já cadastrado.
  expect(linhas[0]!.modos).toEqual(['1v1'])

  // O .txt saiu da pasta e saiu do disco: órfão continuaria sendo servido.
  await expect(stat(join(pasta, 'MapsMP', MAPA, `${MAPA}.txt`))).rejects.toThrow()

  const depois = (await app.inject({ method: 'GET', url: '/catalog/mapas' })).json().assinatura
  expect(depois).not.toBe(antes)
  await app.close()
})

test('remover mapa que já jogou preserva a linha; mapa novo sai de vez', async () => {
  const { app, pasta, linhas, partidasPorMapa } = await montar()

  await subir(app, {}, pastaCompleta())
  const id = linhas[0]!.id
  // `matches.mapId` é `on delete set null`: apagar a linha levaria junto o nome
  // do mapa do histórico de quem jogou nele.
  partidasPorMapa[id] = 3

  const res = await app.inject({ method: 'DELETE', url: `/admin/maps/${id}` })
  expect(res.statusCode).toBe(200)
  expect(res.json().historico).toBe(true)
  expect(linhas).toHaveLength(1)
  expect(linhas[0]!.ativo).toBe(false)
  expect(linhas[0]!.arquivos).toEqual([])

  // Sumiu do manifesto e do disco: é assim que o launcher sabe que tem que
  // apagar a pasta no cliente.
  expect((await app.inject({ method: 'GET', url: '/catalog/mapas' })).json().mapas).toHaveLength(0)
  await expect(stat(join(pasta, 'MapsMP', MAPA))).rejects.toThrow()

  // Um mapa que nunca apareceu em partida não deixa rastro nenhum. Outro CRC de
  // propósito: a linha inativa acima continua dona do dela.
  expect((await subir(app, {}, pastaCompleta('Arena'))).statusCode).toBe(201)
  const novo = linhas.find((l) => l.nome === 'Arena')!
  const fora = await app.inject({ method: 'DELETE', url: `/admin/maps/${novo.id}` })
  expect(fora.json().historico).toBe(false)
  expect(linhas.some((l) => l.nome === 'Arena')).toBe(false)

  await app.close()
})

test('download fora de MapsMP é 404', async () => {
  const { app } = await montar()
  await subir(app, {}, pastaCompleta())

  for (const caminho of ['segredo.txt', 'MapsMP/../segredo.txt', 'MapsMP/nao-existe/x.dat']) {
    const res = await app.inject({ method: 'GET', url: encodeURI(`/downloads/mapas/qualquer/${caminho}`) })
    expect(`${caminho} -> ${res.statusCode}`).toBe(`${caminho} -> 404`)
  }
  await app.close()
})

test('mapa sem arquivos não entra no manifesto', async () => {
  // É o mapa cadastrado à mão pelo POST /admin/maps antigo: continua valendo
  // para o pool da temporada, mas não há o que o launcher baixe.
  const { app, linhas } = await montar()
  linhas.push({ id: crypto.randomUUID(), nome: 'Só Cadastro', mapCrc: '00000001', modos: [], ativo: true, arquivos: [], crcVerificado: false } as GameMap)

  const manifesto = (await app.inject({ method: 'GET', url: '/catalog/mapas' })).json()
  expect(manifesto.mapas).toHaveLength(0)
  await app.close()
})

test('a rota dos mapas convive com o @fastify/static de /downloads/', async () => {
  // Em produção o `@fastify/static` registra o curinga `/downloads/*` para as
  // releases, e o hook da raiz marca tudo que sai dali como octet-stream e
  // imutável. Este teste monta os três juntos: se o curinga engolir a rota dos
  // mapas, nenhum jogador baixa mapa nenhum — e nada no teste anterior pegaria.
  const { app, pasta } = await montar()
  const releases = await mkdtemp(join(tmpdir(), 'kambrasil-releases-'))
  pastas.push(releases)
  await writeFile(join(releases, 'manifest.json'), '{"version":"1.0.0"}')

  const tudo = Fastify()
  await tudo.register(fastifyStatic, { root: releases, prefix: '/downloads/' })
  tudo.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/downloads/')) {
      reply.header('content-type', 'application/octet-stream')
      reply.header('cache-control', 'public, max-age=31536000, immutable')
    }
  })
  tudo.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      instance.decorate('authenticate', ((request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) => {
        request.account = { id: ADMIN, isAdmin: true } as never
        done()
      }) as unknown as FastifyInstance['authenticate'])
    }),
  )
  // Repositório vazio: o que está sob teste aqui é o roteamento, não o banco.
  const vazio: OpcoesMapas = {
    pasta,
    avisar: () => {},
    partidas: () => ({ countBy: async () => 0 }),
    mapas: () => ({
      find: async () => [],
      findOne: async () => null,
      save: async (valor) => valor as never,
      update: async () => ({}),
      delete: async () => ({}),
    }),
  }
  tudo.register(mapasRoutes, vazio)
  await tudo.ready()

  // A release continua servida pelo curinga.
  const release = await tudo.inject({ method: 'GET', url: '/downloads/manifest.json' })
  expect(release.statusCode).toBe(200)

  // O arquivo do mapa (gravado pelo `montar` acima) sai pela rota nova.
  await subir(app, {}, pastaCompleta())
  const mapa = await tudo.inject({
    method: 'GET',
    url: encodeURI(`/downloads/mapas/qualquer/MapsMP/${MAPA}/${MAPA}.dat`),
  })
  expect(mapa.statusCode).toBe(200)
  expect(new Uint8Array(mapa.rawPayload)).toEqual(DAT)
  expect(mapa.headers['cache-control']).toBe('public, max-age=31536000, immutable')

  // E um 404 NÃO é guardado por um ano: seria o mapa sumindo do CDN depois de
  // uma sincronia que passou no meio do upload.
  const faltando = await tudo.inject({ method: 'GET', url: '/downloads/mapas/qualquer/MapsMP/Nada/Nada.dat' })
  expect(faltando.statusCode).toBe(404)
  expect(faltando.headers['cache-control']).toBe('no-store')

  await tudo.close()
  await app.close()
})

test('desativar tira o mapa do manifesto e republica a assinatura', async () => {
  // É o botão "ativo" do painel (`AdminMapas.vue`). Se ele não republicasse, o
  // admin desativaria o mapa e ninguém no cliente ficaria sabendo.
  const { app, linhas, avisos } = await montar()
  await subir(app, { modos: '1v1' }, pastaCompleta())
  const id = linhas[0]!.id
  const antes = avisos.at(-1)

  const res = await app.inject({ method: 'PUT', url: `/admin/maps/${id}`, payload: { ativo: false } })
  expect(res.statusCode).toBe(200)
  expect(linhas[0]!.ativo).toBe(false)
  expect((await app.inject({ method: 'GET', url: '/catalog/mapas' })).json().mapas).toHaveLength(0)
  expect(avisos.at(-1)).not.toBe(antes)

  // Renomear um mapa distribuído é mover pasta e reescrever todo caminho do
  // manifesto: reenviar a pasta com o nome novo é o caminho, e é recusado aqui.
  const renome = await app.inject({ method: 'PUT', url: `/admin/maps/${id}`, payload: { nome: 'Outro' } })
  expect(renome.statusCode).toBe(409)

  // E `ativo=false` no envio também vale: subir sem publicar é caso legítimo.
  const inativo = await subir(app, { ativo: 'false' }, pastaCompleta('Arena'))
  expect(inativo.json().map.ativo).toBe(false)

  await app.close()
})
