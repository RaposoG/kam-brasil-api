import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { config } from './config.ts'
import { Account } from './entities/account.ts'
import { Session } from './entities/session.ts'
import { GameServer } from './entities/game-server.ts'
import { ClientRelease } from './entities/client-release.ts'
import { PlayTicket } from './entities/play-ticket.ts'
import { NewsPost } from './entities/news-post.ts'
import { MatchReport } from './entities/match-report.ts'
import { Friendship } from './entities/friendship.ts'
import { ChatMessage } from './entities/chat-message.ts'
import { Season } from './entities/season.ts'
import { GameMap } from './entities/map.ts'
import { SeasonMap } from './entities/season-map.ts'
import { PlayerRating } from './entities/player-rating.ts'
import { QueueEntry } from './entities/queue-entry.ts'
import { Lobby } from './entities/lobby.ts'
import { LobbyPlayer } from './entities/lobby-player.ts'
import { Match } from './entities/match.ts'
import { MatchPlayer } from './entities/match-player.ts'
import { Report } from './entities/report.ts'
import { Init1785018600000 } from './migrations/1785018600000-init.ts'
import { ClientReleases1785040800000 } from './migrations/1785040800000-client-releases.ts'
import { PlayTickets1785060000000 } from './migrations/1785060000000-play-tickets.ts'
import { ReleaseManifest1785070000000 } from './migrations/1785070000000-release-manifest.ts'
import { News1786000000000 } from './migrations/1786000000000-news.ts'
import { MatchReports1786000000001 } from './migrations/1786000000001-match-reports.ts'
import { Social1786000000002 } from './migrations/1786000000002-social.ts'
import { Ranked1786000000003 } from './migrations/1786000000003-ranked.ts'
import { Reports1786000000004 } from './migrations/1786000000004-reports.ts'

export const dataSource = new DataSource({
  type: 'postgres',
  url: config.DATABASE_URL,
  entities: [
    Account,
    Session,
    GameServer,
    ClientRelease,
    PlayTicket,
    NewsPost,
    MatchReport,
    Friendship,
    ChatMessage,
    Season,
    GameMap,
    SeasonMap,
    PlayerRating,
    QueueEntry,
    Lobby,
    LobbyPlayer,
    Match,
    MatchPlayer,
    Report,
  ],
  // Nunca true: o schema é versionado por migration, inclusive em desenvolvimento.
  synchronize: false,
  migrations: [
    Init1785018600000,
    ClientReleases1785040800000,
    PlayTickets1785060000000,
    ReleaseManifest1785070000000,
    News1786000000000,
    MatchReports1786000000001,
    Social1786000000002,
    Ranked1786000000003,
    Reports1786000000004,
  ],
  logging: config.isDev ? ['error', 'warn'] : ['error'],
})

export const accounts = () => dataSource.getRepository(Account)
export const sessions = () => dataSource.getRepository(Session)
export const gameServers = () => dataSource.getRepository(GameServer)
export const clientReleases = () => dataSource.getRepository(ClientRelease)
export const playTickets = () => dataSource.getRepository(PlayTicket)
export const newsPosts = () => dataSource.getRepository(NewsPost)
export const matchReports = () => dataSource.getRepository(MatchReport)
export const friendships = () => dataSource.getRepository(Friendship)
export const chatMessages = () => dataSource.getRepository(ChatMessage)
export const seasons = () => dataSource.getRepository(Season)
export const maps = () => dataSource.getRepository(GameMap)
export const seasonMaps = () => dataSource.getRepository(SeasonMap)
export const playerRatings = () => dataSource.getRepository(PlayerRating)
export const queueEntries = () => dataSource.getRepository(QueueEntry)
export const lobbies = () => dataSource.getRepository(Lobby)
export const lobbyPlayers = () => dataSource.getRepository(LobbyPlayer)
export const matches = () => dataSource.getRepository(Match)
export const matchPlayers = () => dataSource.getRepository(MatchPlayer)
export const reports = () => dataSource.getRepository(Report)
