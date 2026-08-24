import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  /** Sempre gravado em minúsculas. A unicidade real é garantida por índice em lower(email). */
  @Column({ type: 'varchar', length: 254 })
  email!: string

  /** Exibido no jogo. Unicidade case-insensitive via índice em lower(nickname). */
  @Column({ type: 'varchar', length: 16 })
  nickname!: string

  /** argon2id. Nunca sai da API — veja Account.toPublic(). */
  @Column({ type: 'text' })
  passwordHash!: string

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null

  /**
   * Painel administrativo. O papel é concedido por `ADMIN_EMAILS` no deploy e
   * refletido aqui — assim o acesso é auditável e não depende de alguém lembrar
   * de rodar um SQL na mão.
   */
  @Column({ type: 'boolean', default: false })
  isAdmin!: boolean

  /**
   * Suspensão da **fila ranqueada** (não do jogo) por abandono. Escalona a cada
   * reincidência: 15 min, 1 h, 6 h, 24 h, 7 dias.
   */
  @Column({ type: 'timestamptz', nullable: true })
  queueBanUntil!: Date | null

  /** Ocorrências na janela atual. 15 dias limpos zeram a ficha inteira. */
  @Column({ type: 'int', default: 0 })
  queueBanCount!: number

  /** Dia da última ocorrência — é o que faz os 15 dias de perdão serem contáveis. */
  @Column({ type: 'date', nullable: true })
  queueBanDia!: string | null

  /** Batida do launcher (POST /presence, a cada 60 s). Online = visto há menos de 2 min. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}

/** Formato seguro para devolver ao cliente. */
export function toPublicAccount(account: Account) {
  return {
    id: account.id,
    email: account.email,
    nickname: account.nickname,
    createdAt: account.createdAt,
  }
}
