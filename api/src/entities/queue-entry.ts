import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { RankedMode } from './map.ts'

/**
 * Um jogador esperando na fila.
 *
 * Fica no banco, e não em `Map` na memória, porque push na API é deploy em
 * produção: fila em memória evaporaria a cada deploy, no meio da noite de
 * ranqueada. O matchmaker é um `setInterval` de 3 s no próprio processo.
 */
@Entity('queue_entries')
@Index('uq_queue_entries_accountId', ['accountId'], { unique: true })
// O matchmaker varre a cada 3 s: quem está 'waiting', mais antigo primeiro.
@Index('idx_queue_entries_estado_entrouEm', ['estado', 'entrouEm'])
export class QueueEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  /** Único: uma conta não pode estar duas vezes na fila. */
  @Column({ type: 'uuid' })
  accountId!: string

  /** Fila única com marcação de modos — filas separadas fragmentam a população. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  modos!: RankedMode[]

  @Column({ type: 'uuid' })
  seasonId!: string

  /** Define a prioridade e a abertura da faixa de pareamento (2.0 → 9.0 de |Δmu|). */
  @CreateDateColumn({ type: 'timestamptz' })
  entrouEm!: Date

  /** Heartbeat: sem batida, a entrada é varrida e o jogador sai da fila. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date

  @Column({ type: 'varchar', length: 16, default: 'waiting' })
  estado!: 'waiting' | 'matched'

  @Column({ type: 'uuid', nullable: true })
  lobbyId!: string | null
}
