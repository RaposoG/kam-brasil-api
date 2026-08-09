// RateLimiter e TtlCache recebem `now` injetado — nada de sleep nem fake
// timers, o relógio é um número que o teste controla.

import { expect, test } from 'bun:test'
import { RateLimiter, TtlCache } from './throttle.ts'

test('RateLimiter: nega dentro da janela, libera depois dela', () => {
  const limiter = new RateLimiter(10_000)

  expect(limiter.allow('ip-1', 0)).toBe(true)
  expect(limiter.allow('ip-1', 5_000)).toBe(false)
  expect(limiter.allow('ip-1', 9_999)).toBe(false)
  expect(limiter.allow('ip-1', 10_000)).toBe(true)
})

test('RateLimiter: chaves diferentes não se atrapalham', () => {
  const limiter = new RateLimiter(2_000)

  expect(limiter.allow('conta-a', 0)).toBe(true)
  expect(limiter.allow('conta-b', 0)).toBe(true)
  expect(limiter.allow('conta-a', 1_000)).toBe(false)
  expect(limiter.allow('conta-b', 1_000)).toBe(false)
  expect(limiter.allow('conta-a', 2_500)).toBe(true)
})

test('RateLimiter: pedido negado não reinicia a janela', () => {
  const limiter = new RateLimiter(10_000)

  expect(limiter.allow('ip-1', 0)).toBe(true)
  expect(limiter.allow('ip-1', 9_000)).toBe(false)
  // Se o negado de 9s tivesse reiniciado a janela, 10s ainda seria negado.
  expect(limiter.allow('ip-1', 10_000)).toBe(true)
})

test('TtlCache: devolve o valor dentro do TTL e expira depois', () => {
  const cache = new TtlCache<string>(15_000)

  expect(cache.get(0)).toBeUndefined()

  cache.set('overview', 0)
  expect(cache.get(1)).toBe('overview')
  expect(cache.get(14_999)).toBe('overview')
  expect(cache.get(15_000)).toBeUndefined()
})

test('TtlCache: set renova a validade', () => {
  const cache = new TtlCache<number>(15_000)

  cache.set(1, 0)
  cache.set(2, 20_000)
  expect(cache.get(30_000)).toBe(2)
})
