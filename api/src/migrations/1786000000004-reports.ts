import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Denúncias de jogador contra jogador — a fila que o painel administrativo
 * trabalha. Anti-cheat aqui é manual por decisão do dono (replay + análise), e
 * esta tabela é a entrada desse processo.
 */
export class Reports1786000000004 implements MigrationInterface {
  name = 'Reports1786000000004'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table "reports" (
        "id"            uuid primary key default gen_random_uuid(),
        "denuncianteId" uuid        not null references "accounts"("id") on delete cascade,
        "denunciadoId"  uuid        not null references "accounts"("id") on delete cascade,
        -- set null e não cascade: apagar uma partida não pode apagar a queixa.
        "matchId"       uuid references "matches"("id") on delete set null,
        "motivo"        text        not null,
        "estado"        varchar(16) not null default 'aberta',
        "resolucao"     text,
        "resolvidoPor"  uuid references "accounts"("id") on delete set null,
        "resolvidoEm"   timestamptz,
        "criadoEm"      timestamptz not null default now()
      )
    `)
    // A fila do painel é sempre "as abertas, mais recentes primeiro".
    await queryRunner.query(`create index "idx_reports_estado_criadoEm" on "reports" ("estado", "criadoEm")`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table "reports"`)
  }
}
