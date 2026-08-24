import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/** `aberta` é a fila de trabalho do admin. `rejeitada` também é uma resolução. */
export type ReportEstado = 'aberta' | 'resolvida' | 'rejeitada'

/**
 * Uma denúncia de um jogador contra outro.
 *
 * É a única defesa que existe contra maphack e revelar fog: eles não alteram o
 * estado simulado, não dessincronizam e não mudam quem venceu — não há detecção
 * técnica possível nesta engine. A resposta é replay + denúncia + análise
 * manual, e é por isso que a denúncia aponta para a partida: o replay dela é a
 * prova que o admin vai olhar.
 */
@Entity('reports')
// A fila do painel é sempre "as abertas, mais recentes primeiro".
@Index('idx_reports_estado_criadoEm', ['estado', 'criadoEm'])
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  denuncianteId!: string

  @Column({ type: 'uuid' })
  denunciadoId!: string

  /** Nulo quando a queixa não é sobre uma partida específica (conduta no chat). */
  @Column({ type: 'uuid', nullable: true })
  matchId!: string | null

  @Column({ type: 'text' })
  motivo!: string

  @Column({ type: 'varchar', length: 16, default: 'aberta' })
  estado!: ReportEstado

  /** O que o admin decidiu e por quê — fica no registro, não só no Discord. */
  @Column({ type: 'text', nullable: true })
  resolucao!: string | null

  @Column({ type: 'uuid', nullable: true })
  resolvidoPor!: string | null

  @Column({ type: 'timestamptz', nullable: true })
  resolvidoEm!: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  criadoEm!: Date
}
