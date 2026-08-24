import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { RankedMode, Team } from './map.ts'

/**
 * `pending` até o servidor dedicado reportar o fim. `invalid` é desync, build
 * divergente ou `mkStart` que não bate com a reserva — inválida não pune
 * ninguém e não conta para rating nem para as 10 colocações.
 */
export type MatchStatus = 'pending' | 'valid' | 'invalid'

/**
 * Uma partida multiplayer no servidor do Kam Brasil.
 *
 * A fonte de verdade é o **servidor dedicado**: ele é a única peça que sabe
 * quem é quem de verdade (autentica cada cliente na API) e não tem interesse no
 * resultado. O host é jogador, então nunca reporta.
 *
 * Nem toda partida é ranqueada: partida casual entra aqui com `seasonId` e
 * `lobbyId` nulos, e mapa que pode nem estar cadastrado (daí `mapId` nulo com
 * `mapCrc` sempre preenchido).
 */
@Entity('matches')
// Histórico paginado por cursor: sempre "mais recentes primeiro".
@Index('idx_matches_iniciadoEm', ['iniciadoEm'])
export class Match {
  /** Gerado pela API na reserva da sala: é o `match=<uuid>` que viaja no Pascal. */
  @PrimaryGeneratedColumn('uuid')
  id!: string

  /** Nulo em partida casual. Único: um lobby gera no máximo uma partida. */
  @Column({ type: 'uuid', nullable: true })
  lobbyId!: string | null

  @Column({ type: 'uuid', nullable: true })
  seasonId!: string | null

  @Column({ type: 'varchar', length: 8 })
  mode!: RankedMode

  @Column({ type: 'uuid', nullable: true })
  mapId!: string | null

  @Column({ type: 'varchar', length: 32, default: '' })
  mapCrc!: string

  /** Semente da simulação lockstep. Chega no reporte de início. */
  @Column({ type: 'int', nullable: true })
  randomSeed!: number | null

  @Column({ type: 'varchar', length: 32, default: '' })
  gameRevision!: string

  /** CRC do executável. É obstáculo, não segurança — um cliente modificado mente. */
  @Column({ type: 'varchar', length: 32, default: '' })
  exeCrc!: string

  @CreateDateColumn({ type: 'timestamptz' })
  iniciadoEm!: Date

  @Column({ type: 'timestamptz', nullable: true })
  encerradoEm!: Date | null

  /** Duração em ticks da simulação, não em segundos: é o relógio determinístico. */
  @Column({ type: 'int', nullable: true })
  duracaoTicks!: number | null

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: MatchStatus

  @Column({ type: 'text', nullable: true })
  invalidMotivo!: string | null

  /** Nulo enquanto pendente. Empate não existe: o servidor sempre define um lado. */
  @Column({ type: 'varchar', length: 1, nullable: true })
  timeVencedor!: Team | null

  /** `manual` é partida lançada na mão por admin — nunca vale para rating. */
  @Column({ type: 'varchar', length: 16, default: 'dedicated' })
  fonte!: 'dedicated' | 'manual'

  /**
   * O save MP é byte-idêntico em todos os clientes de propósito. CRC divergente
   * entre participantes = desync ou fraude, e a partida vira inválida.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  replayCrc!: string | null
}
