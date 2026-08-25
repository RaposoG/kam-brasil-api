import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * O catálogo global de mapas ganha arquivos.
 *
 * Até aqui `maps` guardava só nome, CRC e modos, e os mapas chegavam ao jogador
 * dentro da release do jogo — acrescentar um exigia publicar release nova. Com
 * estas duas colunas o admin adiciona um mapa e o launcher o busca sozinho.
 *
 * Os bytes **não** entram no banco: mapa tem dezenas de MB e vive em disco, no
 * volume `mapas` do compose. O que está aqui é o índice deles.
 */
export class MapCatalog1786000000005 implements MigrationInterface {
  name = 'MapCatalog1786000000005'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table "maps"
        add column "arquivos"      jsonb   not null default '[]'::jsonb,
        -- false para as linhas que já existem, e está certo: o CRC delas foi
        -- digitado à mão, que é exatamente o que esta coluna marca.
        add column "crcVerificado" boolean not null default false
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table "maps" drop column "crcVerificado", drop column "arquivos"`)
  }
}
