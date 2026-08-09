import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Um início de partida reportado pelo cliente via `maps.php`.
 *
 * É TUDO que o jogo reporta sobre partidas: mapa, crc, quantos jogadores e
 * quando. Sem resultado, sem duração, sem quem jogou — isso depende do servidor
 * dedicado reportar o fim da partida (Fase 1b, trabalho em Pascal).
 */
@Entity('match_reports')
export class MatchReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  /** Nome sanitizado (sem controle/vírgula/pipe) — a rota é pública e sem credencial. */
  @Index()
  @Column({ type: 'varchar', length: 120 })
  map!: string

  @Column({ type: 'varchar', length: 32, default: '' })
  mapCrc!: string

  @Column({ type: 'int', default: 0 })
  playerCount!: number

  @Column({ type: 'varchar', length: 16, default: '' })
  netRevision!: string

  @Column({ type: 'varchar', length: 32, default: '' })
  gameRevision!: string

  /** O "quando" das estatísticas: matchesPerDay e recentMatches agregam por aqui. */
  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
