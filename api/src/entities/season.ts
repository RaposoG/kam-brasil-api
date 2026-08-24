import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Cortes de `c = mu - 2*sigma` que separam os tiers. Só 5 números: abaixo do
 * primeiro é Recruta, acima do último é Bárbaro. O apex (Comandante do Rei) é
 * vaga (top 5), não faixa — por isso não aparece aqui.
 */
export type CortesTier = {
  miliciano: number
  machadeiro: number
  espadachim: number
  besteiro: number
  barbaro: number
}

/**
 * Cortes iniciais. Valem enquanto a temporada anterior não tiver 30 jogadores
 * ativos para recalibrar — com amostra menor, recalibrar só injeta ruído.
 */
export const CORTES_SEMENTE: CortesTier = {
  miliciano: 13,
  machadeiro: 16.5,
  espadachim: 20,
  besteiro: 23.5,
  barbaro: 27,
}

/**
 * Uma temporada do ranqueado.
 *
 * Os cortes de tier ficam **congelados** aqui no início da temporada, e não são
 * recalculados por percentil ao vivo: senão o tier de um jogador mudaria porque
 * *outra pessoa* jogou, e isso é indefensável.
 */
@Entity('seasons')
export class Season {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 60 })
  nome!: string

  /** Sequencial e único: "Temporada 1", "Temporada 2"... */
  @Column({ type: 'int' })
  numero!: number

  @Column({ type: 'timestamptz' })
  inicioEm!: Date

  /** Nulo enquanto a temporada não tem data de fim definida. */
  @Column({ type: 'timestamptz', nullable: true })
  fimEm!: Date | null

  /** Só uma pode ser true — garantido por índice unique parcial. */
  @Index()
  @Column({ type: 'boolean', default: false })
  ativa!: boolean

  @Column({ type: 'jsonb' })
  cortesTier!: CortesTier

  @CreateDateColumn({ type: 'timestamptz' })
  criadoEm!: Date
}
