// O allowlist de /serveradd.php e /auth/verify decide "isto veio de dentro?".
// Enquanto usava request.ip, qualquer um na internet mandava
// `X-Forwarded-For: 127.0.0.1` e passava — TRUST_PROXY=true faz o Fastify
// acreditar no cabeçalho, e o cabeçalho é escrito pelo cliente.

import { expect, test } from 'bun:test'
import Fastify from 'fastify'
import { normalizeIp, peerIp } from './peer-ip.ts'

const SPOOF = '203.0.113.99'

async function ips(headers: Record<string, string>) {
  const app = Fastify({ trustProxy: true })
  app.get('/', async (request) => ({ requestIp: request.ip, peer: peerIp(request) }))
  const res = await app.inject({ method: 'GET', url: '/', headers })
  await app.close()
  return JSON.parse(res.body) as { requestIp: string; peer: string }
}

test('X-Forwarded-For não muda o endereço usado para autorizar', async () => {
  const { requestIp, peer } = await ips({ 'x-forwarded-for': SPOOF })

  // A premissa: com trustProxy o request.ip realmente obedece ao cabeçalho.
  // Se algum dia isso deixar de valer, este teste avisa que o motivo mudou.
  expect(requestIp).toBe(SPOOF)

  // E o que importa: peerIp ignora o cabeçalho.
  expect(peer).not.toBe(SPOOF)
  expect(peer).toBe('127.0.0.1')
})

test('sem cabeçalho nenhum os dois concordam', async () => {
  const { requestIp, peer } = await ips({})
  expect(peer).toBe(requestIp)
})

test('formas IPv6 de loopback viram 127.0.0.1', () => {
  // O socket entrega ::ffff:127.0.0.1 em dual-stack; sem normalizar, o
  // allowlist de 127.0.0.1 recusaria o próprio servidor de jogo.
  expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
  expect(normalizeIp('::1')).toBe('127.0.0.1')
  expect(normalizeIp('10.0.1.5')).toBe('10.0.1.5')
})
