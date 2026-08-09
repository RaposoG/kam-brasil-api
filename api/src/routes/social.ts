import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { accounts, chatMessages, dataSource, friendships } from '../data-source.ts'
import type { ChatMessage } from '../entities/chat-message.ts'
import { cleanChatBody } from '../sanitize.ts'
import { RateLimiter } from '../throttle.ts'

/**
 * Presença, camaradas e taverna — tudo que é social e autenticado.
 *
 * "Online" aqui é presença de launcher, não de partida: o jogo não reporta fim
 * de jogo (Fase 1b), então o que dá para afirmar é "o launcher dele bateu o
 * heartbeat há menos de 2 min".
 */

const ONLINE_WINDOW = "interval '2 minutes'"

// Instância única em memória (ver throttle.ts): 1 mensagem a cada 2 s por conta.
const chatLimiter = new RateLimiter(2_000)

const addFriendSchema = z.object({ nickname: z.string().min(1).max(16) })
const idParamSchema = z.object({ id: z.uuid() })
const chatQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
})
// Maior que 280 de propósito: o corte fino é do cleanChatBody, que colapsa
// espaços antes de medir. Aqui só barramos abuso grosseiro.
const chatBodySchema = z.object({ body: z.string().max(2_000) })

const UNIQUE_VIOLATION = '23505'

/** bigint chega como string do driver; o contrato entrega number (ver chat-message.ts). */
function toPublicMessage(message: ChatMessage) {
  return {
    id: Number(message.id),
    nickname: message.nickname,
    body: message.body,
    at: message.createdAt,
  }
}

export default async function socialRoutes(app: FastifyInstance) {
  /** Heartbeat do launcher (a cada 60 s enquanto aberto). */
  app.post('/presence', { onRequest: [app.authenticate] }, async (request) => {
    await accounts().update({ id: request.account.id }, { lastSeenAt: new Date() })
    return { ok: true }
  })

  app.get('/friends', { onRequest: [app.authenticate] }, async (request) => {
    const me = request.account.id

    // Uma consulta só: cada linha em que participo, com os dados do OUTRO lado
    // (o case escolhe o lado que não sou eu) e o online já calculado no banco.
    const rows = (await dataSource.query(
      `select f."id" as "friendshipId", f."status", f."requesterId",
              a."id" as "accountId", a."nickname", a."lastSeenAt",
              (a."lastSeenAt" > now() - ${ONLINE_WINDOW}) is true as "online"
       from "friendships" f
       join "accounts" a
         on a."id" = case when f."requesterId" = $1 then f."addresseeId" else f."requesterId" end
       where f."requesterId" = $1 or f."addresseeId" = $1
       order by a."nickname" asc`,
      [me],
    )) as {
      friendshipId: string
      status: string
      requesterId: string
      accountId: string
      nickname: string
      lastSeenAt: Date | null
      online: boolean
    }[]

    const friends = []
    const incoming = []
    const outgoing = []

    for (const row of rows) {
      if (row.status === 'accepted') {
        friends.push({
          friendshipId: row.friendshipId,
          accountId: row.accountId,
          nickname: row.nickname,
          online: row.online,
          lastSeenAt: row.lastSeenAt,
        })
      } else if (row.requesterId === me) {
        outgoing.push({ friendshipId: row.friendshipId, nickname: row.nickname })
      } else {
        incoming.push({ friendshipId: row.friendshipId, nickname: row.nickname })
      }
    }

    return { friends, incoming, outgoing }
  })

  app.post('/friends', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = addFriendSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'nickname inválido' })

    const target = await accounts()
      .createQueryBuilder('a')
      .where('lower(a.nickname) = lower(:nickname)', { nickname: parsed.data.nickname })
      .getOne()

    if (!target) return reply.code(404).send({ error: 'jogador não encontrado' })
    if (target.id === request.account.id) {
      return reply.code(400).send({ error: 'não dá para convidar a si mesmo' })
    }

    const existing = await friendships().findOne({
      where: [
        { requesterId: request.account.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: request.account.id },
      ],
    })

    if (existing) {
      // Convite reverso pendente: os dois se querem, vira amizade direto.
      if (existing.status === 'pending' && existing.addresseeId === request.account.id) {
        existing.status = 'accepted'
        existing.respondedAt = new Date()
        await friendships().save(existing)
        return reply.code(201).send({ status: 'accepted' })
      }
      return reply.code(409).send({ error: 'convite ou amizade já existe' })
    }

    try {
      await friendships().save(
        friendships().create({
          requesterId: request.account.id,
          addresseeId: target.id,
          status: 'pending',
          respondedAt: null,
        }),
      )
    } catch (error) {
      // Corrida entre o SELECT e o INSERT (dois convites simultâneos): o índice
      // único decide, como em auth.ts.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return reply.code(409).send({ error: 'convite ou amizade já existe' })
      }
      throw error
    }

    return reply.code(201).send({ status: 'pending' })
  })

  app.post('/friends/:id/accept', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    // Só o addressee aceita — o filtro no where já garante isso.
    const friendship = await friendships().findOne({
      where: { id: parsed.data.id, addresseeId: request.account.id, status: 'pending' },
    })
    if (!friendship) return reply.code(404).send({ error: 'convite não encontrado' })

    friendship.status = 'accepted'
    friendship.respondedAt = new Date()
    await friendships().save(friendship)

    return { ok: true }
  })

  /** Recusa, cancela ou desfaz — qualquer um dos dois lados pode. */
  app.delete('/friends/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = idParamSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const me = request.account.id
    const result = await friendships()
      .createQueryBuilder()
      .delete()
      .where('id = :id and ("requesterId" = :me or "addresseeId" = :me)', { id: parsed.data.id, me })
      .execute()

    if (!result.affected) return reply.code(404).send({ error: 'convite ou amizade não encontrada' })

    return { ok: true }
  })

  app.get('/chat', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = chatQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

    const { after, limit } = parsed.data

    // Com cursor: tudo depois dele, ascendente. Sem cursor: as últimas N — que
    // se buscam descendente e se invertem, para a resposta ser sempre ascendente.
    const messages =
      after !== undefined
        ? await chatMessages()
            .createQueryBuilder('m')
            .where('m.id > :after', { after })
            .orderBy('m.id', 'ASC')
            .take(limit)
            .getMany()
        : (await chatMessages().find({ order: { id: 'DESC' }, take: limit })).reverse()

    return { messages: messages.map(toPublicMessage) }
  })

  app.post('/chat', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'mensagem inválida' })

    const body = cleanChatBody(parsed.data.body)
    if (body === null) return reply.code(400).send({ error: 'mensagem vazia ou longa demais' })

    // Depois da validação de propósito: mensagem inválida não queima a janela.
    if (!chatLimiter.allow(request.account.id)) {
      return reply.code(429).send({ error: 'calma — 1 mensagem a cada 2 segundos' })
    }

    // Nickname da CONTA autenticada, nunca do corpo: senão qualquer um falaria
    // em nome de qualquer um.
    const message = await chatMessages().save(
      chatMessages().create({
        accountId: request.account.id,
        nickname: request.account.nickname,
        body,
      }),
    )

    return reply.code(201).send({ message: toPublicMessage(message) })
  })
}
