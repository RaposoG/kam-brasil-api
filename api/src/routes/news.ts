import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../config.ts'
import { newsPosts } from '../data-source.ts'
import { toPublicPost } from '../entities/news-post.ts'

/**
 * Notícias do launcher. Leitura pública; publicar/apagar usa o x-admin-token,
 * mesmo padrão de POST /client/releases — publicar notícia não exige release.
 */

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const createSchema = z.object({
  tag: z.string().max(32).default(''),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  /** Opcional para datar um post retroativamente; ausente = agora. */
  publishedAt: z.coerce.date().optional(),
})

const idSchema = z.object({ id: z.uuid() })

/** true = pode seguir. Igual a client.ts: sem token configurado, ninguém publica. */
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.ADMIN_TOKEN) {
    void reply.code(503).send({ error: 'publicação desabilitada: ADMIN_TOKEN não configurado' })
    return false
  }
  if (request.headers['x-admin-token'] !== config.ADMIN_TOKEN) {
    void reply.code(401).send({ error: 'token administrativo inválido' })
    return false
  }
  return true
}

export default async function newsRoutes(app: FastifyInstance) {
  app.get('/news', async (request, reply) => {
    const parsed = listSchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'limit inválido' })

    const posts = await newsPosts().find({
      order: { publishedAt: 'DESC' },
      take: parsed.data.limit,
    })

    return { posts: posts.map(toPublicPost) }
  })

  app.post('/news', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const post = await newsPosts().save(
      newsPosts().create({
        tag: parsed.data.tag,
        title: parsed.data.title,
        body: parsed.data.body,
        publishedAt: parsed.data.publishedAt ?? new Date(),
      }),
    )

    return reply.code(201).send({ post: toPublicPost(post) })
  })

  app.delete('/news/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    const parsed = idSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

    const result = await newsPosts().delete({ id: parsed.data.id })
    if (!result.affected) return reply.code(404).send({ error: 'notícia não encontrada' })

    return { ok: true }
  })
}
