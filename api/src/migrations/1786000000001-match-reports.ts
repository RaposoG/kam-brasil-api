import type { MigrationInterface, QueryRunner } from 'typeorm'

export class MatchReports1786000000001 implements MigrationInterface {
  name = 'MatchReports1786000000001'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table "match_reports" (
        "id"           uuid primary key default gen_random_uuid(),
        "map"          varchar(120) not null,
        "mapCrc"       varchar(32)  not null default '',
        "playerCount"  int          not null default 0,
        "netRevision"  varchar(16)  not null default '',
        "gameRevision" varchar(32)  not null default '',
        "createdAt"    timestamptz  not null default now()
      )
    `)
    // createdAt: matchesPerDay/recentMatches. map: o group by dos topMaps.
    await queryRunner.query(`create index "idx_match_reports_createdAt" on "match_reports" ("createdAt")`)
    await queryRunner.query(`create index "idx_match_reports_map" on "match_reports" ("map")`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`drop table "match_reports"`)
  }
}
