import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { RankedMode, Team } from './map.ts'

/**
 * `ban` → `draw` → `launch` → `live` → `done`. `aborted` é saída de qualquer
 * ponto (dodge, ninguém apareceu, servidor recusou).
 */
export type LobbyEstado = 'ban' | 'draw' | 'launch' | 'live' | 'done' | 'aborted'

/**
 * A sala de bans que existe entre o pareamento e a partida.
 *
 * O turno tem prazo em coluna, e não em timer na memória: um restart da API no
 * meio de um turno não pode travar o lobby para sempre. Estourou o prazo, o
 * tick do lobby bane um mapa aleatório e segue.
 */
@Entity('lobbies')
// O tick varre por estado e prazo; as reservas de sala (/internal/ranked/rooms)
// varrem por estado também.
@Index('idx_lobbies_estado_turnoPrazo', ['estado', 'turnoPrazo'])
export class Lobby {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  seasonId!: string

  @Column({ type: 'varchar', length: 8 })
  mode!: RankedMode

  @Column({ type: 'varchar', length: 16, default: 'ban' })
  estado!: LobbyEstado

  /** De quem é a vez de banir. Nulo fora da fase de bans. */
  @Column({ type: 'varchar', length: 1, nullable: true })
  turnoTime!: Team | null

  @Column({ type: 'timestamptz', nullable: true })
  turnoPrazo!: Date | null

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  mapasBanidos!: string[]

  @Column({ type: 'uuid', nullable: true })
  mapaEscolhidoId!: string | null

  // Sala reservada no servidor dedicado. Só existe a partir do 'launch'.
  @Column({ type: 'varchar', length: 45, nullable: true })
  serverIp!: string | null

  @Column({ type: 'int', nullable: true })
  serverPort!: number | null

  /** Índice da sala no servidor: o protocolo do KaM não sabe criar sala por nome. */
  @Column({ type: 'int', nullable: true })
  roomIndex!: number | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  roomSenha!: string | null

  /** Atalho de leitura. O lado autoritativo do vínculo é `matches.lobbyId`. */
  @Column({ type: 'uuid', nullable: true })
  matchId!: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  criadoEm!: Date
}
