import type { MigrationInterface, QueryRunner } from 'typeorm'

export class Social1786000000002 implements MigrationInterface {
  name = 'Social1786000000002'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Uma linha por par, na direção do convite. O unique impede convite
    // duplicado na mesma direção; o reverso é tratado na rota (vira aceitação).
    await queryRunner.query(`
      create table "friendships" (
        "id"          uuid primary key default gen_random_uuid(),
        "requesterId" uuid not null references "accounts"("id") on delete cascade,
        "addresseeId" uuid not null references "accounts"("id") on delete cascade,
        "status"      varchar(16) not null default 'pending',
        "respondedAt" timestamptz,
        "createdAt"   timestamptz not null default now(),
        constraint "uq_friendships_pair" unique ("requesterId", "addresseeId")
      )
    `)
    await queryRunner.query(`create index "idx_friendships_requesterId" on "friendships" ("requesterId")`)
    await queryRunner.query(`create index "idx_friendships_addresseeId" on "friendships" ("addresseeId")`)

    // bigserial: o id é o cursor do poll do launcher (GET /chat?after=<id>).
    await queryRunner.query(`
      create table "chat_messages" (
        "id"        bigserial primary key,
        "accountId" uuid not null references "accounts"("id") on delete cascade,
        "nickname"  varchar(16)  not null,
        "body"      varchar(280) not null,
        "createdAt" timestamptz  not null default now()
      )
    `)
    await queryRunner.query(`create index "idx_chat_messages_createdAt" on "chat_messages" ("createdAt")`)

    // Presença do launcher: batida a cada 60 s, online = visto há menos de 2 min.
    await queryRunner.query(`alter table "accounts" add column "lastSeenAt" timestamptz`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table "accounts" drop column "lastSeenAt"`)
    await queryRunner.query(`drop table "chat_messages"`)
    await queryRunner.query(`drop table "friendships"`)
  }
}
