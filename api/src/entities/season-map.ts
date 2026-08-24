import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * Os 10 mapas escolhidos para uma temporada — o pool de onde saem os bans.
 *
 * Chave composta em vez de id próprio: o par (temporada, mapa) já é a
 * identidade, e a chave impede o mesmo mapa entrar duas vezes no pool.
 */
@Entity('season_maps')
export class SeasonMap {
  @PrimaryColumn({ type: 'uuid' })
  seasonId!: string

  @PrimaryColumn({ type: 'uuid' })
  mapId!: string

  /** Ordem de exibição no lobby de bans. */
  @Column({ type: 'int', default: 0 })
  ordem!: number
}
