import type { FastifyInstance, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'
import { z } from 'zod'
import { accounts, dataSource, maps, matchPlayers, matches, reports, seasons } from '../data-source.ts'
import { CORTES_SEMENTE, Season } from '../entities/season.ts'
import { SeasonMap } from '../entities/season-map.ts'

/**
 * Painel administrativo: temporadas, mapas, jogadores, punições, partidas e
 * denúncias.
 *
 * É o único lugar da API onde `mu`, `sigma` e `c = mu - 2*sigma` saem para um
 * cliente. Nenhuma rota pública pode devolver esses números — o jogador vê o
 * nome do tier e nada mais, e é isso que impede engenharia reversa da fila e
 * torna o rank inexplorável. Quem mexer aqui, mexa sabendo disso.
 */

/**
 * Guarda do painel. Roda **depois** de `authenticate`, então `request.account`
 * já existe.
 *
 * O papel vem de `ADMIN_EMAILS` e é gravado em `accounts.isAdmin` no
 * registro/login (ver routes/auth.ts). Teto conhecido: uma sessão aberta
 * carrega o `isAdmin` que tinha quando foi criada, então tirar alguém da
 * variável só surte efeito no próximo login dele. Se a revogação for urgente,
 * revogue as sessões da conta — é o mesmo caminho do logout.
 *
 * Estilo callback (`done`) e não `async`: para interromper a requisição, um
 * hook async precisa que o Fastify enxergue `res.writableEnded`, e sob o Bun
 * isso não é confiável em todo transporte (o `app.inject` não marca) — o handler
 * da rota chegou a rodar depois do 403. Não chamar `done` para a cadeia sem
 * depender de nada disso.
 */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
  if (!request.account?.isAdmin) {
    reply.code(403).send({ error: 'acesso restrito a administradores' })
    return
  }
  done()
}

const idParam = z.object({ id: z.uuid() })

const modoSchema = z.enum(['1v1', '2v2', '3v3', '4v4'])

const cortesSchema = z.object({
  miliciano: z.number(),
  machadeiro: z.number(),
  espadachim: z.number(),
  besteiro: z.number(),
  barbaro: z.number(),
})

const seasonBody = z.object({
  nome: z.string().min(1).max(60),
  numero: z.number().int().positive(),
  inicioEm: z.coerce.date().optional(),
  fimEm: z.coerce.date().nullish(),
  cortesTier: cortesSchema.optional(),
})

const closeBody = z.object({ fimEm: z.coerce.date().optional() })

const mapBody = z.object({
  nome: z.string().min(1).max(120),
  mapCrc: z.string().min(1).max(32),
  modos: z.array(modoSchema).min(1),
  ativo: z.boolean().optional(),
})

/**
 * Os mapas da temporada, na ordem em que vêm no array — a posição **é** a
 * ordem, e não um campo separado que poderia divergir dela.
 *
 * Teto de 10 porque é o pool que o lobby de bans espera (6 bans alternados,
 * sorteio entre os 4 restantes). Menos que 10 é aceito de propósito: o admin
 * monta a temporada aos poucos, e travar em "exatamente 10" só atrapalharia.
 */
const seasonMapsBody = z.object({ mapIds: z.array(z.uuid()).min(1).max(10) })

const playersQuery = z.object({
  seasonId: z.uuid().optional(),
  q: z.string().max(16).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const queueBanBody = z.object({
  /** Teto de 30 dias: acima disso é banimento de conta, não suspensão de fila. */
  minutos: z.number().int().min(1).max(43_200),
  /** Ajuste manual da ficha de reincidência (a que escalona 15 min → 7 dias). */
  ocorrencias: z.number().int().min(0).max(99).optional(),
})

const matchesQuery = z.object({
  status: z.enum(['pending', 'valid', 'invalid']).optional(),
  seasonId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const reportsQuery = z.object({
  estado: z.enum(['aberta', 'resolvida', 'rejeitada']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const resolveBody = z.object({
  estado: z.enum(['resolvida', 'rejeitada']),
  resolucao: z.string().max(2_000).optional(),
})

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

/** `%` e `_` são curingas do ILIKE: escapados para a busca ser literal. */
const escapeLike = (texto: string) => texto.replace(/[\\%_]/g, '\\$&')

/**
 * Dia corrente no fuso da comunidade, no formato da coluna `date`. "Hoje" para
 * um jogador brasileiro é o dia em São Paulo — sem isto, uma punição aplicada
 * às 22h cairia no dia seguinte e bagunçaria a janela de perdão de 15 dias.
 */
const diaSaoPaulo = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

export default async function adminRoutes(app: FastifyInstance) {
  // Hooks no contexto do plugin em vez de opção por rota: rota nova nasce
  // protegida. Esquecer o guarda deixa de ser possível, que é a única forma
  // segura de escrever um painel com 16 rotas.
  app.addHook('onRequest', app.authenticate)
  app.addHook('onRequest', requireAdmin)

  // ---------- Temporadas ----------

  app.get('/admin/seasons', async () => {
    return { seasons: await seasons().find({ order: { numero: 'DESC' } }) }
  })

  app.post('/admin/seasons', async (request, reply) => {
    const parsed = seasonBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const { nome, numero, inicioEm, fimEm, cortesTier } = parsed.data

    try {
      const season = await seasons().save(
        seasons().create({
          nome,
          numero,
          inicioEm: inicioEm ?? new Date(),
          fimEm: fimEm ?? null,
          // Cortes-semente até o admin recalibrar. Congelados no início da
          // temporada de propósito: percentil ao vivo faria o tier de alguém
          // mudar porque *outra pessoa* jogou.
          cortesTier: cortesTier ?? { ...CORTES_SEMENTE },
          // Criar nunca ativa: virar a temporada é um ato separado e explícito.
          ativa: false,
        }),
      )
      return reply.code(201).send({ season })
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: 'já existe uma temporada com esse número' })
      }
      throw error
    }
  })

  app.post('/admin/seasons/:id/activate', async (request, reply) => {
    const parsed = idParam.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const season = await seasons().findOne({ where: { id: parsed.data.id } })
    if (!season) return reply.code(404).send({ error: 'temporada não encontrada' })

    await dataSource.transaction(async (manager) => {
      // Duas UPDATEs nesta ordem, e não um `set ativa = (id = $1)`: o índice
      // unique parcial de `ativa` é checado linha a linha, então ligar a nova
      // antes de desligar a antiga estouraria a restrição no meio do statement.
      await manager.update(Season, { ativa: true }, { ativa: false })
      await manager.update(Season, { id: parsed.data.id }, { ativa: true })
    })

    return { ok: true }
  })

  app.post('/admin/seasons/:id/close', async (request, reply) => {
    const parsedId = idParam.safeParse(request.params)
    if (!parsedId.success) return reply.code(400).send({ error: 'id inválido' })

    const parsed = closeBody.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'dados inválidos' })

    const fimEm = parsed.data.fimEm ?? new Date()
    const result = await seasons().update({ id: parsedId.data.id }, { ativa: false, fimEm })
    if (!result.affected) return reply.code(404).send({ error: 'temporada não encontrada' })

    return { ok: true, fimEm }
  })

  // ---------- Mapas ----------

  app.get('/admin/maps', async () => {
    return { maps: await maps().find({ order: { nome: 'ASC' } }) }
  })

  app.post('/admin/maps', async (request, reply) => {
    const parsed = mapBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const { nome, modos, ativo } = parsed.data
    // O CRC é hexadecimal e é a chave real do mapa. Normalizado em maiúsculas
    // para o índice único não deixar o mesmo mapa entrar duas vezes só por
    // diferença de caixa — quem comparar contra o que o jogo difunde
    // (KM_NetServer) precisa normalizar do mesmo jeito.
    const mapCrc = parsed.data.mapCrc.trim().toUpperCase()

    try {
      const map = await maps().save(maps().create({ nome, mapCrc, modos, ativo: ativo ?? true }))
      return reply.code(201).send({ map })
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: 'já existe um mapa com esse CRC' })
      }
      throw error
    }
  })

  app.get('/admin/seasons/:id/maps', async (request, reply) => {
    const parsed = idParam.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const pool = await dataSource.query(
      `select sm."ordem", m."id", m."nome", m."mapCrc", m."modos", m."ativo"
       from "season_maps" sm
       join "maps" m on m."id" = sm."mapId"
       where sm."seasonId" = $1
       order by sm."ordem" asc`,
      [parsed.data.id],
    )

    return { maps: pool }
  })

  app.put('/admin/seasons/:id/maps', async (request, reply) => {
    const parsedId = idParam.safeParse(request.params)
    if (!parsedId.success) return reply.code(400).send({ error: 'id inválido' })

    const parsed = seasonMapsBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const { mapIds } = parsed.data
    if (new Set(mapIds).size !== mapIds.length) {
      return reply.code(400).send({ error: 'mapa repetido no pool da temporada' })
    }

    const seasonId = parsedId.data.id

    try {
      await dataSource.transaction(async (manager) => {
        // Substitui o pool inteiro. Em transação porque meia troca (apagou e
        // não inseriu) deixaria a temporada sem mapas e o lobby de bans sem o
        // que sortear.
        await manager.delete(SeasonMap, { seasonId })
        await manager.insert(
          SeasonMap,
          mapIds.map((mapId, ordem) => ({ seasonId, mapId, ordem })),
        )
      })
    } catch (error) {
      if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        return reply.code(400).send({ error: 'temporada ou mapa inexistente' })
      }
      throw error
    }

    return { ok: true, total: mapIds.length }
  })

  // ---------- Jogadores ----------

  /**
   * A lista de jogadores com o rating **real**: `mu`, `sigma` e o score oculto
   * `c = mu - 2*sigma`. Este é o único endpoint da API que os expõe, e por isso
   * ele mora atrás do guarda de admin — o jogador vê apenas o nome do tier.
   */
  app.get('/admin/players', async (request, reply) => {
    const parsed = playersQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

    const { q, limit, offset } = parsed.data
    // Sem seasonId explícito, a temporada ativa. Se não houver nenhuma, o join
    // não casa e todo mundo aparece sem rating — que é a verdade.
    const seasonId = parsed.data.seasonId ?? (await seasons().findOne({ where: { ativa: true } }))?.id ?? null

    const players = await dataSource.query(
      `select a."id", a."nickname", a."email", a."isAdmin", a."lastSeenAt",
              a."queueBanUntil", a."queueBanCount", a."queueBanDia",
              r."seasonId", r."mu", r."sigma", (r."mu" - 2 * r."sigma") as "c",
              r."tier", r."tierSince", r."rankedMatches", r."placementDone",
              r."demotionStrikes", r."lastRankedAt", r."seededBy"
       from "accounts" a
       left join "player_ratings" r
         on r."accountId" = a."id" and r."seasonId" = $1::uuid
       where $2::text is null or a."nickname" ilike '%' || $2 || '%'
       order by r."mu" desc nulls last, a."nickname" asc
       limit $3 offset $4`,
      [seasonId, q ? escapeLike(q) : null, limit, offset],
    )

    return { seasonId, players }
  })

  // ---------- Punições ----------

  app.get('/admin/punishments', async () => {
    const punicoes = await dataSource.query(
      `select a."id", a."nickname", a."email",
              a."queueBanUntil", a."queueBanCount", a."queueBanDia",
              (a."queueBanUntil" > now()) is true as "suspensoAgora",
              (select count(*) from "match_players" mp
                where mp."accountId" = a."id" and mp."abandonou")::int as "abandonos"
       from "accounts" a
       where a."queueBanUntil" is not null or a."queueBanCount" > 0
       order by a."queueBanUntil" desc nulls last`,
    )

    return { punicoes }
  })

  app.put('/admin/accounts/:id/queue-ban', async (request, reply) => {
    const parsedId = idParam.safeParse(request.params)
    if (!parsedId.success) return reply.code(400).send({ error: 'id inválido' })

    const parsed = queueBanBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const { minutos, ocorrencias } = parsed.data
    const queueBanUntil = new Date(Date.now() + minutos * 60_000)

    const result = await accounts().update(
      { id: parsedId.data.id },
      {
        queueBanUntil,
        // Marca o dia: a janela de perdão de 15 dias conta a partir da última
        // ocorrência, e uma punição aplicada na mão é uma ocorrência.
        queueBanDia: diaSaoPaulo(),
        ...(ocorrencias === undefined ? {} : { queueBanCount: ocorrencias }),
      },
    )
    if (!result.affected) return reply.code(404).send({ error: 'conta não encontrada' })

    return { ok: true, queueBanUntil }
  })

  app.delete('/admin/accounts/:id/queue-ban', async (request, reply) => {
    const parsed = idParam.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    // Remover a suspensão limpa a ficha inteira: o jogador volta ao estado de
    // quem nunca abandonou. É o mesmo perdão dos 15 dias limpos, antecipado
    // pelo admin — deixar o contador de pé faria a próxima ocorrência dele
    // pular direto para uma punição pesada.
    const result = await accounts().update(
      { id: parsed.data.id },
      { queueBanUntil: null, queueBanCount: 0, queueBanDia: null },
    )
    if (!result.affected) return reply.code(404).send({ error: 'conta não encontrada' })

    return { ok: true }
  })

  // ---------- Partidas ----------

  /** Sem filtro de status por padrão — o painel precisa ver as inválidas. */
  app.get('/admin/matches', async (request, reply) => {
    const parsed = matchesQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

    const { status, seasonId, accountId, before, limit } = parsed.data
    const filtros: string[] = []
    const params: unknown[] = []

    if (status) {
      params.push(status)
      filtros.push(`m."status" = $${params.length}`)
    }
    if (seasonId) {
      params.push(seasonId)
      filtros.push(`m."seasonId" = $${params.length}::uuid`)
    }
    if (before) {
      params.push(before)
      filtros.push(`m."iniciadoEm" < $${params.length}`)
    }
    if (accountId) {
      params.push(accountId)
      filtros.push(
        `exists (select 1 from "match_players" mp
                  where mp."matchId" = m."id" and mp."accountId" = $${params.length}::uuid)`,
      )
    }
    params.push(limit)

    const partidas = await dataSource.query(
      `select m.*,
              coalesce(
                array_agg(p."nickname" order by p."handIndex") filter (where p."nickname" is not null),
                '{}'::text[]
              ) as "jogadores"
       from "matches" m
       left join "match_players" p on p."matchId" = m."id"
       ${filtros.length ? `where ${filtros.join(' and ')}` : ''}
       group by m."id"
       order by m."iniciadoEm" desc
       limit $${params.length}`,
      params,
    )

    return { matches: partidas }
  })

  app.get('/admin/matches/:id', async (request, reply) => {
    const parsed = idParam.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const match = await matches().findOne({ where: { id: parsed.data.id } })
    if (!match) return reply.code(404).send({ error: 'partida não encontrada' })

    // As linhas cruas, com mu/sigma antes e depois: é o que permite auditar uma
    // reclamação de "esse resultado não podia ter mexido tanto no meu rank".
    const players = await matchPlayers().find({
      where: { matchId: parsed.data.id },
      order: { handIndex: 'ASC' },
    })

    return { match, players }
  })

  // ---------- Denúncias ----------

  app.get('/admin/reports', async (request, reply) => {
    const parsed = reportsQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

    const denuncias = await dataSource.query(
      `select r.*,
              den."nickname"  as "denuncianteNickname",
              alvo."nickname" as "denunciadoNickname",
              m."status" as "matchStatus", m."replayCrc", m."iniciadoEm" as "matchIniciadoEm"
       from "reports" r
       join "accounts" den  on den."id"  = r."denuncianteId"
       join "accounts" alvo on alvo."id" = r."denunciadoId"
       left join "matches" m on m."id" = r."matchId"
       where $1::text is null or r."estado" = $1
       -- Abertas primeiro: esta é uma fila para trabalhar, não um arquivo.
       order by (r."estado" = 'aberta') desc, r."criadoEm" desc
       limit $2`,
      [parsed.data.estado ?? null, parsed.data.limit],
    )

    return { denuncias }
  })

  app.post('/admin/reports/:id/resolve', async (request, reply) => {
    const parsedId = idParam.safeParse(request.params)
    if (!parsedId.success) return reply.code(400).send({ error: 'id inválido' })

    const parsed = resolveBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    // O `estado: 'aberta'` no critério é o que torna a resolução idempotente e
    // impede dois admins sobrescreverem a decisão um do outro em silêncio.
    const result = await reports().update(
      { id: parsedId.data.id, estado: 'aberta' },
      {
        estado: parsed.data.estado,
        resolucao: parsed.data.resolucao ?? null,
        resolvidoPor: request.account.id,
        resolvidoEm: new Date(),
      },
    )
    if (!result.affected) {
      return reply.code(404).send({ error: 'denúncia não encontrada ou já resolvida' })
    }

    return { ok: true }
  })
}
