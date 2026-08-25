import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/** O jogador escolhe na abertura — é o que separa a fila de bug da caixa de ideias. */
export type ChamadoTipo = 'problema' | 'sugestao' | 'ajuda'

/**
 * `aberto` = a bola está com a equipe. `respondido` = a bola está com o
 * jogador. `fechado` = encerrado (por qualquer um dos lados).
 *
 * Mensagem nova de um lado devolve a bola para o outro — inclusive num chamado
 * fechado, que reabre. É o que dispensa uma tabela de "não lido": a fila do
 * admin é `estado = 'aberto'`, o aviso do jogador é `estado = 'respondido'`.
 */
export type ChamadoEstado = 'aberto' | 'respondido' | 'fechado'

/**
 * Um chamado de suporte: reporte de problema, sugestão ou pedido de ajuda.
 *
 * Não confundir com `Report` (denúncia contra jogador, alimenta a moderação)
 * nem com `PlayTicket` (credencial de partida). Chamado é conversa entre um
 * jogador e a equipe, com começo, meio e fim.
 */
@Entity('chamados')
// A fila do painel é "os abertos, mexidos há menos tempo primeiro".
@Index('idx_chamados_estado_atividade', ['estado', 'ultimaMensagemEm'])
// "Meus chamados" do jogador.
@Index('idx_chamados_autor', ['accountId'])
export class Chamado {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  accountId!: string

  @Column({ type: 'varchar', length: 16 })
  tipo!: ChamadoTipo

  @Column({ type: 'varchar', length: 120 })
  titulo!: string

  @Column({ type: 'varchar', length: 16, default: 'aberto' })
  estado!: ChamadoEstado

  /**
   * Atualizada a cada mensagem, dos dois lados. É a ordem natural das duas
   * listas: conversa parada afunda, conversa viva sobe.
   */
  @Column({ type: 'timestamptz' })
  ultimaMensagemEm!: Date

  @CreateDateColumn({ type: 'timestamptz' })
  criadoEm!: Date
}
