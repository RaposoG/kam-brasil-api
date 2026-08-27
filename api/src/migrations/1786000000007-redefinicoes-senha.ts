import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Pedidos de redefinição de senha (código por email). */
export class RedefinicoesSenha1786000000007 implements MigrationInterface {
  name = 'RedefinicoesSenha1786000000007'

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`create table "redefinicoes_senha" (
      "id" uuid primary key default gen_random_uuid(),
      "accountId" uuid not null references "accounts" ("id") on delete cascade,
      "codigoHash" varchar(64) not null,
      "tentativas" int not null default 0,
      "expiraEm" timestamptz not null,
      "criadoEm" timestamptz not null default now()
    )`)
    await qr.query(`create index "idx_redefinicoes_senha_conta" on "redefinicoes_senha" ("accountId")`)
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`drop table "redefinicoes_senha"`)
  }
}
