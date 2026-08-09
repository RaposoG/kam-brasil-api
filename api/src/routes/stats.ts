import type { FastifyInstance } from 'fastify'
import { dataSource } from '../data-source.ts'
import { TtlCache } from '../throttle.ts'

/**
 * Números reais para as telas do launcher, num endpoint só.
 *
 * Público e barato de propósito: o launcher de cada jogador consulta isto, e
 * com o cache de 15 s o banco vê no máximo 4 consultas por minuto, não importa
 * quantos launchers estejam abertos.
 */

interface Overview {
  onlinePlayers: number
  openServers: number
  launcherOnline: number
  accountsTotal: number
  matchesToday: number
  matchesPerDay: { day: string; count: number }[]
  topMaps: { map: string; count: number }[]
  recentMatches: { map: string; playerCount: number; reportedAt: Date }[]
}

// Instância única em memória — correta enquanto a API for uma instância só
// (ver throttle.ts). O TTL de 15 s é o combinado com o frontend.
const cache = new TtlCache<Overview>(15_000)

// en-CA formata como YYYY-MM-DD; o fuso é o da comunidade. "Hoje" para um
// jogador brasileiro é o dia em São Paulo, não em UTC — sem isto, partidas
// depois das 21h cairiam no dia seguinte.
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })

/** Os 14 rótulos de dia, do mais antigo até hoje. */
export function last14Days(now: Date): string[] {
  const days: string[] = []
  for (let i = 13; i >= 0; i--) {
    days.push(dayFormat.format(new Date(now.getTime() - i * 86_400_000)))
  }
  return days
}

async function buildOverview(): Promise<Overview> {
  const [serverAgg] = (await dataSource.query(
    `select coalesce(sum("playerCount"), 0)::int as "onlinePlayers", count(*)::int as "openServers"
     from "game_servers" where "expiresAt" > now()`,
  )) as [{ onlinePlayers: number; openServers: number }]

  const [accountAgg] = (await dataSource.query(
    `select count(*)::int as "accountsTotal",
            (count(*) filter (where "lastSeenAt" > now() - interval '2 minutes'))::int as "launcherOnline"
     from "accounts"`,
  )) as [{ accountsTotal: number; launcherOnline: number }]

  // 15 dias de margem para não perder a fronteira do dia entre UTC e São Paulo.
  const perDayRows = (await dataSource.query(
    `select to_char("createdAt" at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as day, count(*)::int as count
     from "match_reports" where "createdAt" > now() - interval '15 days'
     group by 1`,
  )) as { day: string; count: number }[]

  const topMaps = (await dataSource.query(
    `select "map", count(*)::int as count from "match_reports"
     group by "map" order by count desc, "map" asc limit 5`,
  )) as { map: string; count: number }[]

  const recent = (await dataSource.query(
    `select "map", "playerCount", "createdAt" from "match_reports"
     order by "createdAt" desc limit 20`,
  )) as { map: string; playerCount: number; createdAt: Date }[]

  const countByDay = new Map(perDayRows.map((r) => [r.day, r.count]))
  const matchesPerDay = last14Days(new Date()).map((day) => ({ day, count: countByDay.get(day) ?? 0 }))

  return {
    ...serverAgg,
    ...accountAgg,
    matchesToday: matchesPerDay[matchesPerDay.length - 1]?.count ?? 0,
    matchesPerDay,
    topMaps,
    recentMatches: recent.map((r) => ({ map: r.map, playerCount: r.playerCount, reportedAt: r.createdAt })),
  }
}

export default async function statsRoutes(app: FastifyInstance) {
  app.get('/stats/overview', async () => {
    const cached = cache.get()
    if (cached) return cached

    const overview = await buildOverview()
    cache.set(overview)
    return overview
  })
}
