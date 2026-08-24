import type { FastifyInstance } from 'fastify'
import { IsNull } from 'typeorm'
import { z } from 'zod'
import { accounts, dataSource, reports } from '../data-source.ts'
import { RateLimiter } from '../throttle.ts'

/**
 * Denúncias de jogador contra jogador.
 *
 * É a entrada do único processo anti-cheat que esta engine comporta: maphack e
 * revelar fog não alteram o estado simulado, não dessincronizam e não mudam
 * quem venceu — não há detecção técnica possível. A resposta é replay +
 * denúncia + análise manual, e é por isso que a denúncia aponta para a partida:
 * o replay dela é a prova. Sem estas rotas a fila do painel nasce vazia.
 */

// Instância única em memória (ver throttle.ts): 1 denúncia por minuto por conta.
// Fila enterrada em queixa em massa é fila que ninguém trabalha — e é justamente
// a fila que decide banimento.
const limiter = new RateLimiter(60_000)

/** Teto de "minhas denúncias". Não há paginação porque ninguém denuncia 50 vezes. */
const MEUS_LIMITE = 50

const FOREIGN_KEY_VIOLATION = '23503'

const criarSchema = z.object({
  /** Por nickname e não por id: é o que o jogador enxerga, no jogo e no lobby. */
  nickname: z.string().min(1).max(16),
  /** Ausente quando a queixa é de conduta (chat) e não de uma partida. */
  matchId: z.uuid().optional(),
  // Mínimo de 10: "trapaceiro" não é denúncia. Quem vai assistir ao replay
  // precisa saber o que procurar e mais ou menos quando.
  motivo: z.string().trim().min(10).max(2_000),
})

export default async function reportsRoutes(app: FastifyInstance) {
  app.post('/reports', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = criarSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    const { nickname, matchId, motivo } = parsed.data

    const alvo = await accounts()
      .createQueryBuilder('a')
      .where('lower(a.nickname) = lower(:nickname)', { nickname })
      .getOne()

    if (!alvo) return reply.code(404).send({ error: 'jogador não encontrado' })
    if (alvo.id === request.account.id) {
      return reply.code(400).send({ error: 'não dá para denunciar a si mesmo' })
    }

    // Duplicata só conta entre as ABERTAS: uma segunda queixa sobre a mesma
    // partida é a mesma prova e só duplica trabalho, mas depois que o admin
    // decidiu, reincidência é queixa nova e precisa caber na fila de novo.
    const jaAberta = await reports().findOne({
      where: {
        denuncianteId: request.account.id,
        denunciadoId: alvo.id,
        // `matchId: undefined` seria ignorado pelo TypeORM e casaria com
        // qualquer partida — IsNull() é o que representa "queixa sem partida".
        matchId: matchId ?? IsNull(),
        estado: 'aberta',
      },
    })
    if (jaAberta) {
      return reply.code(409).send({ error: 'você já tem uma denúncia aberta sobre isso' })
    }

    // Depois das validações de propósito (mesmo motivo do chat em social.ts):
    // denúncia recusada não queima a janela de quem escreveu errado.
    if (!limiter.allow(request.account.id)) {
      return reply.code(429).send({ error: 'calma — 1 denúncia por minuto' })
    }

    try {
      // `denuncianteId` da SESSÃO, nunca do corpo: senão qualquer um denunciaria
      // em nome de qualquer um.
      const denuncia = await reports().save(
        reports().create({
          denuncianteId: request.account.id,
          denunciadoId: alvo.id,
          matchId: matchId ?? null,
          motivo,
          estado: 'aberta',
          resolucao: null,
          resolvidoPor: null,
          resolvidoEm: null,
        }),
      )

      return reply.code(201).send({ denuncia: { id: denuncia.id, estado: denuncia.estado } })
    } catch (error) {
      // matchId inexistente: quem decide é a chave estrangeira, sem um SELECT a
      // mais no caminho feliz.
      if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
        return reply.code(404).send({ error: 'partida não encontrada' })
      }
      throw error
    }
  })

  app.get('/reports/meus', { onRequest: [app.authenticate] }, async (request) => {
    // Sem `resolucao` e sem `resolvidoPor`: o parecer é registro interno da
    // moderação (o que foi decidido sobre um terceiro, e por quem). O que o
    // denunciante precisa saber é se a queixa dele já foi analisada.
    const denuncias = await dataSource.query(
      `select r."id", alvo."nickname" as "denunciado", r."matchId", r."motivo",
              r."estado", r."criadoEm", r."resolvidoEm"
         from "reports" r
         join "accounts" alvo on alvo."id" = r."denunciadoId"
        where r."denuncianteId" = $1
        order by r."criadoEm" desc
        limit $2`,
      [request.account.id, MEUS_LIMITE],
    )

    return { denuncias }
  })
}
