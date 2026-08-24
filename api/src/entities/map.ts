import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/** Modos do ranqueado. Fila única com marcação de modos — nunca uma fila por modo. */
export type RankedMode = '1v1' | '2v2' | '3v3' | '4v4'

/** Lado do jogador. Não existe FFA no ranqueado: sempre dois times. */
export type Team = 'A' | 'B'

/**
 * Um mapa elegível para o ranqueado.
 *
 * A classe se chama `GameMap` e não `Map` de propósito: `Map` sombrearia o
 * global do JS em qualquer arquivo que importasse a entidade.
 */
@Entity('maps')
export class GameMap {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 120 })
  nome!: string

  /** Chave real do mapa: é o que o jogo difunde e o servidor dedicado valida. */
  @Column({ type: 'varchar', length: 32 })
  mapCrc!: string

  /** Em quais modos este mapa vale — um mapa de 1x1 não serve para 4x4. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  modos!: RankedMode[]

  @Column({ type: 'boolean', default: true })
  ativo!: boolean
}
