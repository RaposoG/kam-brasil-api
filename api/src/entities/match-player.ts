import { Column, Entity, Index, PrimaryColumn } from 'typeorm'
import type { Team } from './map.ts'

/**
 * A participação de um jogador numa partida.
 *
 * Chave composta (partida, hand): é o que torna o reporte idempotente — o
 * servidor dedicado pode reenviar o mesmo `GET /internal/ranked/report` e a
 * segunda chamada não duplica linha nem recalcula rating.
 *
 * Guardar mu/sigma antes e depois em **toda** partida não é luxo: é a única
 * forma de auditar uma reclamação, de recalcular a temporada inteira se um
 * parâmetro mudar, e de detectar win-trading depois do fato.
 */
@Entity('match_players')
// "Minhas partidas": filtra por conta, ordena juntando com matches.iniciadoEm.
@Index('idx_match_players_accountId', ['accountId'])
export class MatchPlayer {
  @PrimaryColumn({ type: 'uuid' })
  matchId!: string

  /** Índice da hand na simulação. Identifica o jogador dentro da partida. */
  @PrimaryColumn({ type: 'int' })
  handIndex!: number

  /** Nulo quando o nickname reportado não bate com nenhuma conta (partida casual). */
  @Column({ type: 'uuid', nullable: true })
  accountId!: string | null

  /** Nome de quem jogou **na época**. É por ele que o servidor dedicado reporta. */
  @Column({ type: 'varchar', length: 16 })
  nickname!: string

  @Column({ type: 'varchar', length: 1, nullable: true })
  time!: Team | null

  /** Espelha `TWonOrLost` do engine: estado de simulação, não opinião do cliente. */
  @Column({ type: 'varchar', length: 8, default: 'none' })
  wonOrLost!: 'won' | 'lost' | 'none'

  // Nulos em partida que não move rating (casual, inválida, curta demais).
  @Column({ type: 'double precision', nullable: true })
  muBefore!: number | null

  @Column({ type: 'double precision', nullable: true })
  sigmaBefore!: number | null

  @Column({ type: 'double precision', nullable: true })
  muAfter!: number | null

  @Column({ type: 'double precision', nullable: true })
  sigmaAfter!: number | null

  /** 1.0 normal; 0.25 da 4ª partida contra o mesmo adversário no mesmo dia. */
  @Column({ type: 'double precision', default: 1 })
  peso!: number

  /** Enriquecimento do cliente (casas, exército). Nunca vale como fonte de rank. */
  @Column({ type: 'jsonb', nullable: true })
  statsJson!: Record<string, unknown> | null

  /** Saiu e não voltou em 3 min. Conta derrota cheia e suspende a fila. */
  @Column({ type: 'boolean', default: false })
  abandonou!: boolean
}
