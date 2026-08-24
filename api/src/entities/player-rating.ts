import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm'

/**
 * Tier derivado de `c = mu - 2*sigma`. Guardado em minúsculas sem acento; o
 * nome bonito ("Bárbaro") é assunto da interface.
 *
 * `comandante` é o apex por vaga (top 5 entre os bárbaros com >= 20 partidas
 * na temporada), não uma faixa de `c`.
 */
export type Tier = 'recruta' | 'miliciano' | 'machadeiro' | 'espadachim' | 'besteiro' | 'barbaro' | 'comandante'

/** Escala nativa do OpenSkill. O piso de sigma é o parâmetro mais fácil de esquecer. */
export const MU_INICIAL = 25
export const SIGMA_INICIAL = 25 / 3
export const SIGMA_MIN = 2.5

/**
 * O rating de uma conta **em uma temporada**. Um par (mu, sigma) só, usado
 * igual em 1x1, 2x2, 3x3 e 4x4 — o modelo já dilui o crédito em times grandes
 * por construção.
 *
 * `mu` e `sigma` nunca saem para o cliente: o jogador vê apenas o tier.
 */
@Entity('player_ratings')
@Unique('uq_player_ratings_account_season', ['accountId', 'seasonId'])
// Leaderboard e faixa de pareamento são sempre "dentro da temporada, por mu".
@Index('idx_player_ratings_season_mu', ['seasonId', 'mu'])
export class PlayerRating {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  accountId!: string

  @Column({ type: 'uuid' })
  seasonId!: string

  @Column({ type: 'double precision', default: MU_INICIAL })
  mu!: number

  @Column({ type: 'double precision', default: SIGMA_INICIAL })
  sigma!: number

  /** Partidas válidas na temporada. Partida inválida ou curta demais não conta. */
  @Column({ type: 'int', default: 0 })
  rankedMatches!: number

  /** True a partir da 10ª partida de colocação — até lá não há tier a exibir. */
  @Column({ type: 'boolean', default: false })
  placementDone!: boolean

  @Column({ type: 'varchar', length: 24, nullable: true })
  tier!: Tier | null

  @Column({ type: 'timestamptz', nullable: true })
  tierSince!: Date | null

  /**
   * Partidas consecutivas abaixo de `limiar - 1.0`. Rebaixa só na segunda —
   * uma derrota azarada nunca tira ninguém de tier.
   */
  @Column({ type: 'int', default: 0 })
  demotionStrikes!: number

  /** Para marcar "Inativo" após 45 dias. Inatividade nunca mexe em `mu`. */
  @Column({ type: 'timestamptz', nullable: true })
  lastRankedAt!: Date | null

  /** Admin que semeou o `mu` inicial (30–33) de um jogador já conhecido. */
  @Column({ type: 'uuid', nullable: true })
  seededBy!: string | null
}
