import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm'
import { Account } from './account.ts'

/**
 * Convite/amizade entre duas contas. Uma linha por par, na direção do convite:
 * requester convidou, addressee decide. Aceitar não cria linha nova — muda o
 * status da existente, e o unique no par impede convites duplicados.
 */
@Entity('friendships')
@Unique('uq_friendships_pair', ['requesterId', 'addresseeId'])
export class Friendship {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Index()
  @Column({ type: 'uuid' })
  requesterId!: string

  @Index()
  @Column({ type: 'uuid' })
  addresseeId!: string

  // Unidirecional como em Session: a relação inversa em Account criaria import
  // circular, e com emitDecoratorMetadata o tipo é avaliado na carga do módulo.
  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterId' })
  requester!: Account

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addresseeId' })
  addressee!: Account

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'accepted'

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt!: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
