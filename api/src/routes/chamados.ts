import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { chamadoMensagens, chamados, dataSource } from '../data-source.ts'
import type { Chamado } from '../entities/chamado.ts'
import type { ChamadoMensagem } from '../entities/chamado-mensagem.ts'
import { RateLimiter } from '../throttle.ts'
import { requireAdmin } from './admin.ts'

/**
 * Chamados de suporte: o jogador reporta um problema, manda uma sugestão ou
 * pede ajuda, e conversa com a equipe dentro do próprio launcher.
 *
 * O estado é a caixa de entrada dos dois lados: `aberto` é a fila da equipe,
 * `respondido` é o aviso do jogador. Mensagem nova devolve a bola — inclusive
 * reabrindo chamado fechado, porque "fechou mas o problema voltou" é a mesma
 * conversa, não uma nova.
 */

// 1 abertura por minuto: um jogador irritado abrindo 20 chamados iguais
// enterra a fila que a equipe precisa trabalhar.
const limiterAbrir = new RateLimiter(60_000)
// Mensagem segue o ritmo do chat: 1 a cada 2 segundos segura flood sem
// atrapalhar quem digita rápido.
const limiterMensagem = new RateLimiter(2_000)

/** Teto de "meus chamados" — ninguém legítimo tem 50 conversas com o suporte. */
const MEUS_LIMITE = 50
/** Teto da fila do painel por página de estado. */
const PAINEL_LIMITE = 200
/** Teto de mensagens devolvidas por chamado. */
const MENSAGENS_LIMITE = 500

const abrirSchema = z.object({
  tipo: z.enum(['problema', 'sugestao', 'ajuda']),
  titulo: z.string().trim().min(3).max(120),
  mensagem: z.string().min(2).max(2_000),
})

const mensagemSchema = z.object({
  mensagem: z.string().min(2).max(2_000),
})

const idParam = z.object({ id: z.uuid() })

const filtroPainel = z.object({
  estado: z.enum(['aberto', 'respondido', 'fechado']).optional(),
})

/**
 * Normaliza texto multi-linha do jogador: CRLF vira LF, caracteres de controle
 * somem (menos a própria quebra de linha — chamado não é chat, descrever um bug
 * pede parágrafos), e espaço das pontas cai. `null` = não sobrou conteúdo.
 *
 * Não reusa o `cleanChatBody` porque ele achata quebras de linha e corta em 280.
 */
function limparTexto(raw: string): string | null {
  const texto = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
  if (texto.length < 2 || texto.length > 2_000) return null
  return texto
}

/** O que o jogador (e o painel) veem de um chamado. */
function publico(c: Chamado) {
  return {
    id: c.id,
    tipo: c.tipo,
    titulo: c.titulo,
    estado: c.estado,
    criadoEm: c.criadoEm,
    ultimaMensagemEm: c.ultimaMensagemEm,
  }
}

/** Converte o bigint-string do driver e esconde o accountId de quem falou. */
function mensagemPublica(m: ChamadoMensagem) {
  return {
    id: Number(m.id),
    deQuem: m.nickname,
    daEquipe: m.daEquipe,
    body: m.body,
    em: m.criadoEm,
  }
}

// Interfaces estruturais dos dublês — só o que as rotas realmente usam.
export interface RepoChamados {
  findOne(opts: { where: Partial<Chamado> }): Promise<Chamado | null>
  find(opts: {
    where: Partial<Chamado>
    order: Record<string, 'ASC' | 'DESC'>
    take: number
  }): Promise<Chamado[]>
  create(valores: Partial<Chamado>): Chamado
  save(chamado: Chamado): Promise<Chamado>
}

export interface RepoMensagens {
  find(opts: {
    where: Partial<ChamadoMensagem>
    order: Record<string, 'ASC' | 'DESC'>
    take: number
  }): Promise<ChamadoMensagem[]>
  create(valores: Partial<ChamadoMensagem>): ChamadoMensagem
  save(mensagem: ChamadoMensagem): Promise<ChamadoMensagem>
}

export type OpcoesChamados = {
  /**
   * Injetados pelo teste. Não é `mock.module` de propósito: no `bun test` todos
   * os arquivos dividem o mesmo registro de módulos e só o **primeiro** mock de
   * um módulo vale no processo inteiro — ver `OpcoesMapas` em mapas.ts.
   */
  chamados?: () => RepoChamados
  mensagens?: () => RepoMensagens
  /** SQL crua da fila do painel (join com accounts). */
  query?: (sql: string, params?: unknown[]) => Promise<unknown[]>
}

export default async function chamadosRoutes(app: FastifyInstance, opcoes: OpcoesChamados = {}) {
  const repo = opcoes.chamados ?? (chamados as () => RepoChamados)
  const mensagens = opcoes.mensagens ?? (chamadoMensagens as () => RepoMensagens)
  const query = opcoes.query ?? ((sql: string, params?: unknown[]) => dataSource.query(sql, params))

  /** Grava uma fala e devolve a bola para o outro lado. */
  async function falar(chamado: Chamado, autor: { id: string; nickname: string }, corpo: string, daEquipe: boolean) {
    const mensagem = await mensagens().save(
      mensagens().create({
        chamadoId: chamado.id,
        accountId: autor.id,
        nickname: autor.nickname,
        daEquipe,
        body: corpo,
      }),
    )
    chamado.estado = daEquipe ? 'respondido' : 'aberto'
    chamado.ultimaMensagemEm = new Date()
    await repo().save(chamado)
    return mensagem
  }

  // ---- lado do jogador ----

  app.post('/chamados', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = abrirSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const corpo = limparTexto(parsed.data.mensagem)
    if (!corpo) return reply.code(400).send({ error: 'mensagem inválida' })

    // Depois das validações: chamado recusado não queima a janela de quem
    // escreveu errado (mesmo motivo de reports.ts).
    if (!limiterAbrir.allow(request.account.id)) {
      return reply.code(429).send({ error: 'calma — 1 chamado por minuto' })
    }

    // `accountId` da SESSÃO, nunca do corpo.
    const chamado = await repo().save(
      repo().create({
        accountId: request.account.id,
        tipo: parsed.data.tipo,
        titulo: parsed.data.titulo,
        estado: 'aberto',
        ultimaMensagemEm: new Date(),
      }),
    )
    const mensagem = await falar(chamado, request.account, corpo, false)

    return reply.code(201).send({ chamado: publico(chamado), mensagem: mensagemPublica(mensagem) })
  })

  app.get('/chamados', { onRequest: [app.authenticate] }, async (request) => {
    const meus = await repo().find({
      where: { accountId: request.account.id },
      order: { ultimaMensagemEm: 'DESC' },
      take: MEUS_LIMITE,
    })
    return { chamados: meus.map(publico) }
  })

  /**
   * Acha o chamado do PRÓPRIO jogador. Chamado alheio responde o mesmo 404 de
   * chamado inexistente — não vazamos nem a existência.
   */
  async function meuChamado(id: string, accountId: string) {
    return repo().findOne({ where: { id, accountId } })
  }

  app.get('/chamados/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParam.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'id inválido' })

    const chamado = await meuChamado(params.data.id, request.account.id)
    if (!chamado) return reply.code(404).send({ error: 'chamado não encontrado' })

    const falas = await mensagens().find({
      where: { chamadoId: chamado.id },
      order: { id: 'ASC' },
      take: MENSAGENS_LIMITE,
    })
    return { chamado: publico(chamado), mensagens: falas.map(mensagemPublica) }
  })

  app.post('/chamados/:id/mensagens', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParam.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'id inválido' })

    const parsed = mensagemSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }
    const corpo = limparTexto(parsed.data.mensagem)
    if (!corpo) return reply.code(400).send({ error: 'mensagem inválida' })

    const chamado = await meuChamado(params.data.id, request.account.id)
    if (!chamado) return reply.code(404).send({ error: 'chamado não encontrado' })

    if (!limiterMensagem.allow(request.account.id)) {
      return reply.code(429).send({ error: 'calma — uma mensagem a cada 2 segundos' })
    }

    const mensagem = await falar(chamado, request.account, corpo, false)
    return reply.code(201).send({ mensagem: mensagemPublica(mensagem), estado: chamado.estado })
  })

  app.post('/chamados/:id/fechar', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParam.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'id inválido' })

    const chamado = await meuChamado(params.data.id, request.account.id)
    if (!chamado) return reply.code(404).send({ error: 'chamado não encontrado' })

    chamado.estado = 'fechado'
    await repo().save(chamado)
    return { ok: true }
  })

  // ---- lado do painel ----
  //
  // Sub-escopo com o mesmo guarda de admin.ts (padrão de mapas.ts): as rotas
  // PRECISAM viver sob /admin/ porque o admin_call do launcher recusa qualquer
  // caminho fora dele.

  await app.register(async (admin) => {
    admin.addHook('onRequest', admin.authenticate)
    admin.addHook('onRequest', requireAdmin)

    admin.get('/admin/chamados', async (request, reply) => {
      const filtro = filtroPainel.safeParse(request.query)
      if (!filtro.success) return reply.code(400).send({ error: 'parâmetros inválidos' })

      // Join com accounts porque o painel precisa saber com QUEM está falando —
      // o email é o canal de contato se o jogador sumir do launcher.
      const condicao = filtro.data.estado ? `where c."estado" = $1` : ''
      const params = filtro.data.estado ? [filtro.data.estado, PAINEL_LIMITE] : [PAINEL_LIMITE]
      const lista = await query(
        `select c."id", c."tipo", c."titulo", c."estado", c."criadoEm", c."ultimaMensagemEm",
                a."nickname" as "autor", a."email" as "autorEmail"
           from "chamados" c
           join "accounts" a on a."id" = c."accountId"
          ${condicao}
          order by (c."estado" = 'aberto') desc, c."ultimaMensagemEm" desc
          limit $${params.length}`,
        params,
      )
      return { chamados: lista }
    })

    admin.get('/admin/chamados/:id', async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ error: 'id inválido' })

      const chamado = await repo().findOne({ where: { id: params.data.id } })
      if (!chamado) return reply.code(404).send({ error: 'chamado não encontrado' })

      const [autor] = (await query(
        `select "nickname", "email" from "accounts" where "id" = $1`,
        [chamado.accountId],
      )) as { nickname: string; email: string }[]

      const falas = await mensagens().find({
        where: { chamadoId: chamado.id },
        order: { id: 'ASC' },
        take: MENSAGENS_LIMITE,
      })
      return {
        chamado: publico(chamado),
        autor: autor ?? null,
        mensagens: falas.map(mensagemPublica),
      }
    })

    admin.post('/admin/chamados/:id/mensagens', async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ error: 'id inválido' })

      const parsed = mensagemSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
      }
      const corpo = limparTexto(parsed.data.mensagem)
      if (!corpo) return reply.code(400).send({ error: 'mensagem inválida' })

      const chamado = await repo().findOne({ where: { id: params.data.id } })
      if (!chamado) return reply.code(404).send({ error: 'chamado não encontrado' })

      const mensagem = await falar(chamado, request.account, corpo, true)
      return reply.code(201).send({ mensagem: mensagemPublica(mensagem), estado: chamado.estado })
    })

    admin.post('/admin/chamados/:id/fechar', async (request, reply) => {
      const params = idParam.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ error: 'id inválido' })

      const chamado = await repo().findOne({ where: { id: params.data.id } })
      if (!chamado) return reply.code(404).send({ error: 'chamado não encontrado' })

      chamado.estado = 'fechado'
      await repo().save(chamado)
      return { ok: true }
    })
  })
}
