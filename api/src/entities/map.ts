import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

/** Modos do ranqueado. Fila única com marcação de modos — nunca uma fila por modo. */
export type RankedMode = '1v1' | '2v2' | '3v3' | '4v4'

/** Lado do jogador. Não existe FFA no ranqueado: sempre dois times. */
export type Team = 'A' | 'B'

/**
 * Um arquivo do mapa no catálogo global, do jeito que o launcher precisa para
 * decidir o que baixar, o que atualizar e o que apagar.
 *
 * `path` é relativo à **pasta do jogo** e sempre começa em `MapsMP/` — é o que
 * `mapas.rs: caminho_seguro` exige do outro lado.
 */
export interface ArquivoMapa {
  path: string
  sha256: string
  size: number
}

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

  /**
   * Os arquivos do mapa no catálogo global. Vazio = mapa só cadastrado (nome e
   * CRC na mão), que continua valendo para o pool da temporada mas não é
   * distribuído a ninguém.
   *
   * `jsonb` e não tabela própria de propósito: a lista é escrita inteira no
   * upload e lida inteira no manifesto, e nenhuma consulta filtra por arquivo.
   * Uma tabela seria um join a mais para responder exatamente a mesma coisa.
   * Os bytes ficam em disco — ver routes/mapas.ts.
   */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  arquivos!: ArquivoMapa[]

  /**
   * O CRC foi **lido** do `.mi` da pasta, ou foi digitado?
   *
   * Digitado errado, o servidor manda um `mkMapSelect` que o cliente recusa e o
   * jogador cai num download que nunca termina — falha silenciosa, do lado
   * dele. O aviso da resposta do upload some na hora; esta coluna é o que deixa
   * o painel marcar o mapa como não conferido para sempre.
   */
  @Column({ type: 'boolean', default: false })
  crcVerificado!: boolean
}
