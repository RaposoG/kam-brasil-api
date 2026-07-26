// O bug que este teste existe para não repetir: os Readme_*.html saíam como
// `text/html`, o Cloudflare os reescrevia em trânsito e eles chegavam ao jogador
// maiores do que o sha256 do manifesto — abortando a instalação no fim.
//
// A primeira correção usou a opção `setHeaders` do @fastify/static, que recebe
// um `res` cru sem `setHeader` sob o Bun e derrubava o processo a cada download.
// Por isso o HEAD é testado: era ele que estourava.

import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'

const HTML = '<!DOCTYPE html>\n<html><body>olá ção</body></html>\n'

async function buildApp() {
  const root = join(tmpdir(), 'kb-downloads-test')
  await mkdir(join(root, 'Readme'), { recursive: true })
  await writeFile(join(root, 'Readme', 'Readme_pol.html'), HTML)
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: '1.0.0' }))

  const app = Fastify()
  await app.register(fastifyStatic, { root, prefix: '/downloads/' })
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/downloads/')) {
      reply.header('content-type', 'application/octet-stream')
    }
  })
  app.get('/health', async () => ({ status: 'ok' }))
  return app
}

test('html em /downloads/ sai como octet-stream, sem tipo para o CDN reescrever', async () => {
  const app = await buildApp()
  const res = await app.inject({ method: 'GET', url: '/downloads/Readme/Readme_pol.html' })

  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toBe('application/octet-stream')
  expect(res.body).toBe(HTML)

  await app.close()
})

test('HEAD em /downloads/ responde sem derrubar o processo', async () => {
  const app = await buildApp()
  const res = await app.inject({ method: 'HEAD', url: '/downloads/Readme/Readme_pol.html' })

  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toBe('application/octet-stream')

  await app.close()
})

test('o manifesto continua sendo lido como JSON pelo launcher', async () => {
  const app = await buildApp()
  const res = await app.inject({ method: 'GET', url: '/downloads/manifest.json' })

  expect(JSON.parse(res.body).version).toBe('1.0.0')

  await app.close()
})

test('rotas normais da API não são afetadas', async () => {
  const app = await buildApp()
  const res = await app.inject({ method: 'GET', url: '/health' })

  expect(res.headers['content-type']).toBe('application/json; charset=utf-8')

  await app.close()
})
