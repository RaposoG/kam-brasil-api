import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Um pedido de redefinição de senha em aberto.
 *
 * Guarda o HASH do código, nunca o código: quem ler o banco não redefine a
 * senha de ninguém. A força do esquema não é o hash em si (6 dígitos são
 * enumeráveis offline) — é o conjunto: 15 minutos de validade, 5 tentativas,
 * e o código só existe na caixa de email do dono.
 *
 * No máximo uma linha por conta: pedir de novo substitui a anterior.
 */
@Entity('redefinicoes_senha')
@Index('idx_redefinicoes_senha_conta', ['accountId'])
export class RedefinicaoSenha {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  accountId!: string

  /** sha256 hex do código de 6 dígitos. */
  @Column({ type: 'varchar', length: 64 })
  codigoHash!: string

  @Column({ type: 'int', default: 0 })
  tentativas!: number

  @Column({ type: 'timestamptz' })
  expiraEm!: Date

  @CreateDateColumn({ type: 'timestamptz' })
  criadoEm!: Date
}
