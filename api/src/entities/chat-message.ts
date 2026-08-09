import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Mensagem da taverna (chat global do launcher).
 *
 * O id é `bigserial` de propósito: serve de cursor para o poll do launcher
 * (`GET /chat?after=<id>`) — monotônico e sem depender de timestamp, que pode
 * empatar. O driver do Postgres entrega bigint como string; a rota converte
 * para number ao serializar (bigserial não chega perto de 2^53 aqui).
 */
@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string

  @Column({ type: 'uuid' })
  accountId!: string

  /**
   * Desnormalizado de propósito: exibir o chat não precisa de join, e a
   * mensagem preserva o nome de quem falou na época.
   */
  @Column({ type: 'varchar', length: 16 })
  nickname!: string

  @Column({ type: 'varchar', length: 280 })
  body!: string

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
