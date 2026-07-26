import type { FastifyRequest } from 'fastify'

/** `::ffff:127.0.0.1` e `::1` viram formas comparáveis com o allowlist. */
export function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice(7)
  if (ip === '::1') return '127.0.0.1'
  return ip
}

/**
 * Endereço real do peer TCP, ignorando `X-Forwarded-For`.
 *
 * **Não troque isto por `request.ip`.** Com `TRUST_PROXY=true` — obrigatório
 * atrás do Cloudflare — `request.ip` sai do `X-Forwarded-For`, e esse cabeçalho
 * é escrito pelo cliente. Qualquer um na internet manda
 * `X-Forwarded-For: 127.0.0.1` e passa por um allowlist que confie nele: daria
 * para anunciar servidores falsos na lista e chamar `/auth/verify` de fora.
 *
 * Para decidir "isto veio de dentro?" só o endereço do socket serve — é o que o
 * kernel viu, não o que o cliente afirmou. Requisição vinda do proxy chega com o
 * IP do proxy, que não está no allowlist; requisição do servidor de jogo, que
 * divide o namespace de rede com a API, chega como `127.0.0.1`.
 *
 * `request.ip` continua certo para log e rate-limit — só não para autorização.
 */
export function peerIp(request: FastifyRequest): string {
  return normalizeIp(request.socket.remoteAddress ?? '')
}
