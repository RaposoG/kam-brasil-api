/**
 * Motor de rating do ranqueado — OpenSkill (Weng-Lin, Plackett-Luce).
 *
 * Funções puras: nada de banco, nada de relógio. Quem persiste é a rota.
 * Os valores são os do Anexo do PLANO-RANQUEADA (escala nativa do OpenSkill —
 * não mexer na escala, os cortes de tier foram calibrados sobre ela).
 *
 * O jogador nunca vê `mu`/`sigma`/`c`: só o nome do tier.
 */

import { rate, type Rating } from 'openskill'

export type { Rating }

export const MU_INICIAL = 25
export const SIGMA_INICIAL = 25 / 3

/**
 * Piso de σ — o parâmetro mais importante da configuração e o mais fácil de
 * esquecer. Sem ele o veterano desce a σ≈1.2 e congela: melhora e não sobe,
 * enferruja e não desce, porque o delta de mu é proporcional a σ². De quebra,
 * `c = mu − 2σ` pararia de subir sozinho só quando σ parasse de encolher —
 * com o piso, essa deriva acaba no fim da colocação e nunca mais volta.
 */
export const SIGMA_MIN = 2.5
export const SIGMA_MAX = 25 / 3

export const BETA = 25 / 6
export const KAPPA = 0.0001

/** Colocação: τ alto mantém a incerteza viva → converge em ~4–5 partidas. */
export const TAU_COLOCACAO = 0.25
export const TAU_NORMAL = 25 / 300
export const PARTIDAS_COLOCACAO = 10

/** Banda morta do tier: rebaixa só abaixo de `limiar − 1.0`. */
export const HISTERESE = 1.0
/** Rebaixar exige 2 partidas consecutivas abaixo da banda. Azar não rebaixa. */
export const PARTIDAS_PARA_REBAIXAR = 2

/**
 * Em ordem crescente de `c`. Slug minúsculo sem acento, igual ao que a entidade
 * `PlayerRating` grava — o nome bonito ("Bárbaro") é assunto da interface.
 */
export const TIERS = [
  'recruta',
  'miliciano',
  'machadeiro',
  'espadachim',
  'besteiro',
  'barbaro',
] as const
export type Tier = (typeof TIERS)[number]

/**
 * Tier apex: é **vaga** (top 5 entre bárbaros com ≥20 partidas na temporada),
 * não faixa de `c` — por isso não sai de `tierDe`, sai do leaderboard.
 */
export const TIER_APEX = 'comandante'

/** Cortes-semente. A temporada pode recalibrar e congelar os seus próprios. */
export const CORTES_SEMENTE = [13, 16.5, 20, 23.5, 27] as const

export function ratingInicial(mu: number = MU_INICIAL): Rating {
  // `mu` é parâmetro por causa do seed manual de admin (30–33) para jogadores
  // que a comunidade já sabe que são fortes. σ continua o inicial.
  return { mu, sigma: SIGMA_INICIAL }
}

export type JogadorDaPartida = Rating & {
  /** Nas 10 primeiras partidas ranqueadas — τ maior só para este jogador. */
  emColocacao?: boolean
}

/**
 * Aplica o resultado de uma partida. `times` vem **na ordem de chegada, vencedor
 * primeiro** (o ranqueado não tem empate: o servidor sempre define um vencedor).
 * Serve igual para 1x1 e 4x4 — a diluição do crédito em times grandes já é
 * nativa do modelo (σᵢ²/σ_time²), não precisa de peso por modo.
 *
 * Devolve os ratings novos na mesma forma da entrada.
 */
export function atualizarPartida(
  times: readonly (readonly JogadorDaPartida[])[],
): Rating[][] {
  // `tau` no OpenSkill é opção da partida inteira, mas colocação é estado de
  // *jogador*: um novato cai na mesma sala que um veterano. Então inflamos σ na
  // mão, jogador a jogador (é literalmente o que a lib faz com tau), e chamamos
  // rate() com tau = 0.
  const inflados = times.map((time) =>
    time.map((j) => ({
      mu: j.mu,
      sigma: Math.hypot(j.sigma, j.emColocacao ? TAU_COLOCACAO : TAU_NORMAL),
    })),
  )

  const saida = rate(inflados, { tau: 0, beta: BETA, kappa: KAPPA })

  return saida.map((time, i) =>
    time.map((novo, j) => ({
      mu: novo.mu,
      // Três limites, nesta ordem: piso de 2.5, teto do σ que o jogador já
      // tinha (equivale ao `limitSigma` da lib, que não roda com tau = 0 — σ
      // nunca cresce por jogar) e o teto absoluto.
      sigma: Math.min(Math.max(novo.sigma, SIGMA_MIN), times[i]![j]!.sigma, SIGMA_MAX),
    })),
  )
}

/**
 * Score interno do tier. **Nunca vai para o cliente** — nenhuma rota pública
 * pode devolver mu, sigma ou c. Equivale a `ordinal(r, { z: 2 })`.
 */
export function pontuacaoOculta(mu: number, sigma: number): number {
  return mu - 2 * sigma
}

/** Tier bruto de um `c`, sem histerese. `cortes` em ordem crescente. */
export function tierDe(c: number, cortes: readonly number[] = CORTES_SEMENTE): Tier {
  const acima = cortes.filter((corte) => c >= corte).length
  return TIERS[Math.min(acima, TIERS.length - 1)]!
}

export type EstadoTier = {
  /** `null` = ainda sem tier (não terminou a colocação). */
  tier: Tier | null
  /** Partidas consecutivas abaixo de `limiar − 1.0` (o `demotionStrikes`). */
  strikes: number
}

/**
 * Tier estável: promove na hora, rebaixa devagar. Sem isto o tier oscila a cada
 * partida e o jogador para de acreditar no sistema; com isto muda a cada ~3–5.
 */
export function tierComHisterese(
  estado: EstadoTier,
  c: number,
  cortes: readonly number[] = CORTES_SEMENTE,
): EstadoTier {
  const natural = tierDe(c, cortes)
  const atual = estado.tier === null ? -1 : TIERS.indexOf(estado.tier)

  // Primeiro tier da vida (fim da colocação): nada a segurar.
  if (atual < 0) return { tier: natural, strikes: 0 }

  // Subir é imediato: passou do limiar de cima, subiu. Só a queda é lenta.
  if (TIERS.indexOf(natural) > atual) return { tier: natural, strikes: 0 }

  const limiar = cortes[atual - 1]
  // Recruta não tem para onde cair; dentro da banda morta, também não cai — e a
  // contagem zera, porque a confirmação exige partidas *consecutivas*.
  if (limiar === undefined || c >= limiar - HISTERESE) {
    return { tier: estado.tier, strikes: 0 }
  }

  const strikes = estado.strikes + 1
  if (strikes < PARTIDAS_PARA_REBAIXAR) return { tier: estado.tier, strikes }
  return { tier: natural, strikes: 0 }
}
