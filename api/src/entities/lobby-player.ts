import { Column, Entity, PrimaryColumn } from 'typeorm'
import type { Team } from './map.ts'

/**
 * Um participante do lobby, com o slot que ele vai ocupar na sala travada.
 *
 * Chave composta (lobby, conta): é a identidade real, e é a checagem que a rota
 * `GET /ranked/lobby/:id` faz a cada 1,5 s para saber se quem pergunta joga ali.
 */
@Entity('lobby_players')
export class LobbyPlayer {
  @PrimaryColumn({ type: 'uuid' })
  lobbyId!: string

  @PrimaryColumn({ type: 'uuid' })
  accountId!: string

  /** Desnormalizado: é o nickname que o servidor dedicado vai exigir no join. */
  @Column({ type: 'varchar', length: 16 })
  nickname!: string

  @Column({ type: 'varchar', length: 1 })
  time!: Team

  /** Loc na missão. Fixado pela reserva — ninguém troca de posição na sala. */
  @Column({ type: 'int', default: 0 })
  startLocation!: number

  @Column({ type: 'varchar', length: 16, default: 'ok' })
  status!: 'ok' | 'dodged'

  /** `mu` no instante do pareamento — para auditar uma reclamação de match injusto. */
  @Column({ type: 'double precision' })
  muNoPareamento!: number
}
