import type { MigrationInterface, QueryRunner } from 'typeorm'

export class News1786000000000 implements MigrationInterface {
  name = 'News1786000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table "news_posts" (
        "id"          uuid primary key default gen_random_uuid(),
        "tag"         varchar(32)  not null default '',
        "title"       varchar(200) not null,
        "body"        text         not null,
        "publishedAt" timestamptz  not null default now(),
        "createdAt"   timestamptz  not null default now()
      )
    `)
    // A listagem é sempre "mais recentes primeiro" por publishedAt.
    await queryRunner.query(`create index "idx_news_posts_publishedAt" on "news_posts" ("publishedAt")`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table "news_posts"`)
  }
}
