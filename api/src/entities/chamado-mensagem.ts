import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Uma fala dentro de um chamado — do jogador ou da equipe.
 *
 * O id é bigserial de propósito, como no chat da taverna: serve de cursor para
 * o poll da tela ("me dá o que veio depois do id X") sem depender de relógio.
 */
@Entity('chamado_mensagens')
@Index('idx_chamado_mensagens_chamado', ['chamadoId'])
export class ChamadoMensagem {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string

  @Column({ type: 'uuid' })
  chamadoId!: string

  @Column({ type: 'uuid' })
  accountId!: string

  /** Desnormalizado: preserva o nome de quem falou na época, como no chat. */
  @Column({ type: 'varchar', length: 16 })
  nickname!: string

  /**
   * Mensagem da equipe. É a conta do admin que responde, mas a tela mostra
   * "EQUIPE" — o jogador fala com o projeto, não com um moderador específico.
   */
  @Column({ type: 'boolean', default: false })
  daEquipe!: boolean

  @Column({ type: 'varchar', length: 2000 })
  body!: string

  @CreateDateColumn({ type: 'timestamptz' })
  criadoEm!: Date
}
