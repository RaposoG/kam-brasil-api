import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * O modelo de dados do ranqueado: temporada, mapas, rating, fila, lobby e o
 * histórico de partidas.
 *
 * `match_reports` fica intocada de propósito — é telemetria de popularidade de
 * mapa reportada pelo cliente no meio da partida, não tem resultado e não
 * atrapalha ninguém. `matches` nasce ao lado.
 */
export class Ranked1786000000003 implements MigrationInterface {
  name = 'Ranked1786000000003'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table "seasons" (
        "id"         uuid primary key default gen_random_uuid(),
        "nome"       varchar(60) not null,
        "numero"     int         not null,
        "inicioEm"   timestamptz not null,
        "fimEm"      timestamptz,
        "ativa"      boolean     not null default false,
        "cortesTier" jsonb       not null,
        "criadoEm"   timestamptz not null default now()
      )
    `)
    await queryRunner.query(`create unique index "uq_seasons_numero" on "seasons" ("numero")`)
    // Unique parcial: garante no banco que só existe uma temporada ativa. Sem
    // isso, dois deploys concorrentes poderiam abrir duas e o rank ficaria
    // dividido em silêncio.
    await queryRunner.query(`create unique index "uq_seasons_ativa" on "seasons" ("ativa") where "ativa"`)

    await queryRunner.query(`
      create table "maps" (
        "id"     uuid primary key default gen_random_uuid(),
        "nome"   varchar(120) not null,
        "mapCrc" varchar(32)  not null,
        "modos"  text[]       not null default '{}',
        "ativo"  boolean      not null default true
      )
    `)
    // O CRC é a chave real do mapa: é por ele que o servidor dedicado valida.
    await queryRunner.query(`create unique index "uq_maps_mapCrc" on "maps" ("mapCrc")`)

    await queryRunner.query(`
      create table "season_maps" (
        "seasonId" uuid not null references "seasons"("id") on delete cascade,
        "mapId"    uuid not null references "maps"("id")    on delete cascade,
        "ordem"    int  not null default 0,
        primary key ("seasonId", "mapId")
      )
    `)

    await queryRunner.query(`
      create table "player_ratings" (
        "id"              uuid primary key default gen_random_uuid(),
        "accountId"       uuid not null references "accounts"("id") on delete cascade,
        "seasonId"        uuid not null references "seasons"("id")  on delete cascade,
        "mu"              double precision not null default 25,
        "sigma"           double precision not null default 8.333333333333334,
        "rankedMatches"   int              not null default 0,
        "placementDone"   boolean          not null default false,
        "tier"            varchar(24),
        "tierSince"       timestamptz,
        "demotionStrikes" int              not null default 0,
        "lastRankedAt"    timestamptz,
        "seededBy"        uuid references "accounts"("id") on delete set null,
        constraint "uq_player_ratings_account_season" unique ("accountId", "seasonId")
      )
    `)
    // Leaderboard e faixa de pareamento são sempre "dentro da temporada, por mu".
    await queryRunner.query(`create index "idx_player_ratings_season_mu" on "player_ratings" ("seasonId", "mu")`)

    await queryRunner.query(`
      create table "lobbies" (
        "id"              uuid primary key default gen_random_uuid(),
        "seasonId"        uuid        not null references "seasons"("id") on delete cascade,
        "mode"            varchar(8)  not null,
        "estado"          varchar(16) not null default 'ban',
        "turnoTime"       varchar(1),
        "turnoPrazo"      timestamptz,
        "mapasBanidos"    uuid[]      not null default '{}',
        "mapaEscolhidoId" uuid references "maps"("id") on delete set null,
        "serverIp"        varchar(45),
        "serverPort"      int,
        "roomIndex"       int,
        "roomSenha"       varchar(32),
        "matchId"         uuid,
        "criadoEm"        timestamptz not null default now()
      )
    `)
    // O tick do lobby varre por estado + prazo estourado; as reservas de sala
    // (/internal/ranked/rooms) varrem por estado.
    await queryRunner.query(`create index "idx_lobbies_estado_turnoPrazo" on "lobbies" ("estado", "turnoPrazo")`)

    await queryRunner.query(`
      create table "lobby_players" (
        "lobbyId"         uuid not null references "lobbies"("id")  on delete cascade,
        "accountId"       uuid not null references "accounts"("id") on delete cascade,
        "nickname"        varchar(16) not null,
        "time"            varchar(1)  not null,
        "startLocation"   int         not null default 0,
        "status"          varchar(16) not null default 'ok',
        "muNoPareamento"  double precision not null,
        primary key ("lobbyId", "accountId")
      )
    `)

    await queryRunner.query(`
      create table "matches" (
        "id"             uuid primary key default gen_random_uuid(),
        "lobbyId"        uuid references "lobbies"("id") on delete set null,
        "seasonId"       uuid references "seasons"("id") on delete set null,
        "mode"           varchar(8)  not null,
        "mapId"          uuid references "maps"("id")    on delete set null,
        "mapCrc"         varchar(32) not null default '',
        "randomSeed"     int,
        "gameRevision"   varchar(32) not null default '',
        "exeCrc"         varchar(32) not null default '',
        "iniciadoEm"     timestamptz not null default now(),
        "encerradoEm"    timestamptz,
        "duracaoTicks"   int,
        "status"         varchar(16) not null default 'pending',
        "invalidMotivo"  text,
        "timeVencedor"   varchar(1),
        "fonte"          varchar(16) not null default 'dedicated',
        "replayCrc"      varchar(32)
      )
    `)
    // Histórico paginado por cursor, sempre "mais recentes primeiro".
    await queryRunner.query(`create index "idx_matches_iniciadoEm" on "matches" ("iniciadoEm")`)
    // Um lobby gera no máximo uma partida. Vários NULL convivem no unique do PG,
    // então partida casual (sem lobby) não conflita.
    await queryRunner.query(`create unique index "uq_matches_lobbyId" on "matches" ("lobbyId")`)

    await queryRunner.query(`
      create table "match_players" (
        "matchId"     uuid not null references "matches"("id")  on delete cascade,
        "handIndex"   int  not null,
        "accountId"   uuid references "accounts"("id") on delete set null,
        "nickname"    varchar(16) not null,
        "time"        varchar(1),
        "wonOrLost"   varchar(8)  not null default 'none',
        "muBefore"    double precision,
        "sigmaBefore" double precision,
        "muAfter"     double precision,
        "sigmaAfter"  double precision,
        "peso"        double precision not null default 1,
        "statsJson"   jsonb,
        "abandonou"   boolean not null default false,
        primary key ("matchId", "handIndex")
      )
    `)
    // "Minhas partidas": filtra por conta, ordena juntando com matches.iniciadoEm.
    await queryRunner.query(`create index "idx_match_players_accountId" on "match_players" ("accountId")`)

    await queryRunner.query(`
      create table "queue_entries" (
        "id"         uuid primary key default gen_random_uuid(),
        "accountId"  uuid not null references "accounts"("id") on delete cascade,
        "modos"      text[]      not null default '{}',
        "seasonId"   uuid not null references "seasons"("id")  on delete cascade,
        "entrouEm"   timestamptz not null default now(),
        "lastSeenAt" timestamptz not null default now(),
        "estado"     varchar(16) not null default 'waiting',
        "lobbyId"    uuid references "lobbies"("id") on delete set null
      )
    `)
    // Uma conta não pode estar duas vezes na fila.
    await queryRunner.query(`create unique index "uq_queue_entries_accountId" on "queue_entries" ("accountId")`)
    // O matchmaker roda a cada 3 s: quem está 'waiting', mais antigo primeiro.
    await queryRunner.query(
      `create index "idx_queue_entries_estado_entrouEm" on "queue_entries" ("estado", "entrouEm")`,
    )

    // Admin (espelho de ADMIN_EMAILS) e a ficha de abandono da fila ranqueada.
    await queryRunner.query(`alter table "accounts" add column "isAdmin" boolean not null default false`)
    await queryRunner.query(`alter table "accounts" add column "queueBanUntil" timestamptz`)
    await queryRunner.query(`alter table "accounts" add column "queueBanCount" int not null default 0`)
    await queryRunner.query(`alter table "accounts" add column "queueBanDia" date`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`alter table "accounts" drop column "queueBanDia"`)
    await queryRunner.query(`alter table "accounts" drop column "queueBanCount"`)
    await queryRunner.query(`alter table "accounts" drop column "queueBanUntil"`)
    await queryRunner.query(`alter table "accounts" drop column "isAdmin"`)
    await queryRunner.query(`drop table "queue_entries"`)
    await queryRunner.query(`drop table "match_players"`)
    await queryRunner.query(`drop table "matches"`)
    await queryRunner.query(`drop table "lobby_players"`)
    await queryRunner.query(`drop table "lobbies"`)
    await queryRunner.query(`drop table "player_ratings"`)
    await queryRunner.query(`drop table "season_maps"`)
    await queryRunner.query(`drop table "maps"`)
    await queryRunner.query(`drop table "seasons"`)
  }
}
