import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Chamados de suporte: reporte de problema, sugestão ou pedido de ajuda, com
 * conversa entre o jogador e a equipe.
 *
 * As FKs têm cascade: conta apagada leva os chamados junto (é o histórico de
 * suporte DELA), e chamado apagado leva as mensagens. Não há delete de chamado
 * na API — fechar é o fim de linha — mas se um dia houver limpeza manual, ela
 * não pode deixar mensagens órfãs.
 */
export class Chamados1786000000006 implements MigrationInterface {
  name = 'Chamados1786000000006'

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`create table "chamados" (
      "id" uuid primary key default gen_random_uuid(),
      "accountId" uuid not null references "accounts" ("id") on delete cascade,
      "tipo" varchar(16) not null,
      "titulo" varchar(120) not null,
      "estado" varchar(16) not null default 'aberto',
      "ultimaMensagemEm" timestamptz not null,
      "criadoEm" timestamptz not null default now()
    )`)
    await qr.query(
      `create index "idx_chamados_estado_atividade" on "chamados" ("estado", "ultimaMensagemEm")`,
    )
    await qr.query(`create index "idx_chamados_autor" on "chamados" ("accountId")`)

    await qr.query(`create table "chamado_mensagens" (
      "id" bigserial primary key,
      "chamadoId" uuid not null references "chamados" ("id") on delete cascade,
      "accountId" uuid not null references "accounts" ("id") on delete cascade,
      "nickname" varchar(16) not null,
      "daEquipe" boolean not null default false,
      "body" varchar(2000) not null,
      "criadoEm" timestamptz not null default now()
    )`)
    await qr.query(
      `create index "idx_chamado_mensagens_chamado" on "chamado_mensagens" ("chamadoId")`,
    )
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`drop table "chamado_mensagens"`)
    await qr.query(`drop table "chamados"`)
  }
}
