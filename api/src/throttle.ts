/**
 * Rate-limit e cache em memória.
 *
 * Em memória de propósito: a API roda em instância única, então um Map local é
 * correto E é o que não derruba nada às 3 da manhã. Se um dia houver réplica,
 * isto vira Redis — e este arquivo é o único lugar a trocar.
 *
 * As classes recebem `now` opcional em cada chamada para os testes injetarem o
 * relógio, sem fake timers.
 */

/** Uma ação por janela, por chave (IP, id de conta...). */
export class RateLimiter {
  private readonly last = new Map<string, number>()

  constructor(private readonly windowMs: number) {}

  /** true = pode agir agora (e a janela recomeça); false = ainda dentro da janela. */
  allow(key: string, now = Date.now()): boolean {
    const prev = this.last.get(key)
    if (prev !== undefined && now - prev < this.windowMs) return false

    // Poda oportunista: sem isto o Map guardaria para sempre cada IP/conta que
    // já apareceu. Só varre quando cresce — o caso comum é O(1).
    if (this.last.size >= 10_000) {
      for (const [k, at] of this.last) {
        if (now - at >= this.windowMs) this.last.delete(k)
      }
    }

    this.last.set(key, now)
    return true
  }
}

/** Cache de um valor só, com validade — o suficiente para o overview de 15 s. */
export class TtlCache<T> {
  private value: T | undefined
  private at = Number.NEGATIVE_INFINITY

  constructor(private readonly ttlMs: number) {}

  get(now = Date.now()): T | undefined {
    return now - this.at < this.ttlMs ? this.value : undefined
  }

  set(value: T, now = Date.now()): void {
    this.value = value
    this.at = now
  }
}
