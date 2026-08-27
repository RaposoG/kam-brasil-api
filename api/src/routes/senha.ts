import { createHash, randomInt } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { hash } from '@node-rs/argon2'
import { z } from 'zod'
import { accounts, redefinicoesSenha, sessions } from '../data-source.ts'
import { emailHabilitado, enviarEmail } from '../email.ts'
import type { Account } from '../entities/account.ts'
import type { RedefinicaoSenha } from '../entities/redefinicao-senha.ts'
import { RateLimiter } from '../throttle.ts'

/**
 * Esqueci a senha: um código de 6 dígitos vai por email, o jogador digita no
 * launcher junto da senha nova. Sem página web — o launcher É a interface.
 *
 * A regra de ouro das duas rotas é não vazar se um email tem conta: /esqueci
 * responde o MESMO 200 exista a conta ou não, e /redefinir responde o MESMO
 * "código inválido ou expirado" para conta inexistente, código errado, expirado
 * ou estourado de tentativas.
 */

/** O código vale 15 minutos: sobra para abrir o email, falta para esquecer aberto. */
const VALIDADE_MIN = 15
/** 5 erros queimam o código — com 6 dígitos, chute deixa de ser estratégia. */
const MAX_TENTATIVAS = 5

// 1 pedido por minuto POR EMAIL: segura tanto o flood no Resend (que cobra)
// quanto o uso da rota para spammar a caixa de entrada de terceiros.
const limiterPedido = new RateLimiter(60_000)

const esqueciSchema = z.object({
  email: z.email().max(254),
})

const redefinirSchema = z.object({
  email: z.email().max(254),
  codigo: z.string().regex(/^\d{6}$/, 'código de 6 dígitos'),
  // Mesmas regras do registro: uma senha aceitável para criar conta é
  // aceitável para redefinir.
  senha: z.string().min(8, 'a senha precisa de pelo menos 8 caracteres').max(200),
})

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex')

/** 000000–999999, do CSPRNG — `Math.random` não serve para segredo. */
const gerarCodigo = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

function corpoDoEmail(codigo: string) {
  const texto = [
    `Seu código para redefinir a senha no Kam Brasil: ${codigo}`,
    '',
    `Ele vale por ${VALIDADE_MIN} minutos. Digite no launcher, junto da senha nova.`,
    '',
    'Se não foi você que pediu, ignore este email — sua senha continua a mesma.',
  ].join('\n')
  const html = `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;color:#2a2118">
  <h2 style="color:#8f6a2e;letter-spacing:.04em">KAM BRASIL</h2>
  <p>Seu código para redefinir a senha:</p>
  <p style="font-size:32px;letter-spacing:.35em;font-weight:bold;color:#8f6a2e">${codigo}</p>
  <p>Ele vale por ${VALIDADE_MIN} minutos. Digite no launcher, junto da senha nova.</p>
  <p style="color:#7a6a55;font-size:13px">Se não foi você que pediu, ignore este email — sua senha continua a mesma.</p>
</div>`
  return { texto, html }
}

// Interfaces estruturais dos dublês — só o que as rotas usam.
export interface RepoContas {
  findOne(opts: { where: { email: string } }): Promise<Account | null>
  save(conta: Account): Promise<Account>
}

export interface RepoRedefinicoes {
  findOne(opts: { where: { accountId: string } }): Promise<RedefinicaoSenha | null>
  delete(criterio: { accountId: string }): Promise<unknown>
  create(valores: Partial<RedefinicaoSenha>): RedefinicaoSenha
  save(pedido: RedefinicaoSenha): Promise<RedefinicaoSenha>
}

export type OpcoesSenha = {
  /**
   * Injetados pelo teste — opção de plugin, não `mock.module`, pelo motivo de
   * sempre (ver OpcoesMapas): só o primeiro mock de um módulo vale no processo
   * inteiro do bun test.
   */
  contas?: () => RepoContas
  redefinicoes?: () => RepoRedefinicoes
  enviar?: (para: string, assunto: string, texto: string, html: string) => Promise<void>
  habilitado?: () => boolean
  /** A janela de 1 pedido/minuto por email — injetável porque usa relógio real. */
  podePedir?: (email: string) => boolean
  /** Revoga TODAS as sessões da conta — quem souber a senha velha cai junto. */
  revogarSessoes?: (accountId: string) => Promise<void>
  agora?: () => Date
}

export default async function senhaRoutes(app: FastifyInstance, opcoes: OpcoesSenha = {}) {
  const contas = opcoes.contas ?? (accounts as () => RepoContas)
  const redefinicoes = opcoes.redefinicoes ?? (redefinicoesSenha as () => RepoRedefinicoes)
  const enviar = opcoes.enviar ?? enviarEmail
  const habilitado = opcoes.habilitado ?? emailHabilitado
  const podePedir = opcoes.podePedir ?? ((email: string) => limiterPedido.allow(email))
  const agora = opcoes.agora ?? (() => new Date())
  const revogarSessoes =
    opcoes.revogarSessoes ??
    (async (accountId: string) => {
      await sessions().update({ accountId }, { revokedAt: new Date() })
    })

  app.post('/auth/esqueci', async (request, reply) => {
    const parsed = esqueciSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'email inválido' })

    if (!habilitado()) {
      // Sem Resend configurado é melhor dizer NA HORA do que aceitar o pedido
      // e deixar o jogador olhando para uma caixa de entrada vazia.
      return reply.code(503).send({ error: 'recuperação de senha indisponível no momento — chame a equipe no suporte' })
    }

    const email = parsed.data.email.trim().toLowerCase()
    if (!podePedir(email)) {
      return reply.code(429).send({ error: 'calma — espere 1 minuto para pedir outro código' })
    }

    // A resposta não muda daqui em diante: 200 com ou sem conta. É o que
    // impede a rota de virar um verificador de "esse email joga Kam Brasil?".
    const generica = { ok: true, aviso: 'se este email tiver conta, o código chega em instantes' }

    const conta = await contas().findOne({ where: { email } })
    if (!conta) return generica

    const codigo = gerarCodigo()
    // Pedir de novo substitui o código anterior — nunca há dois válidos.
    await redefinicoes().delete({ accountId: conta.id })
    await redefinicoes().save(
      redefinicoes().create({
        accountId: conta.id,
        codigoHash: sha256(codigo),
        tentativas: 0,
        expiraEm: new Date(agora().getTime() + VALIDADE_MIN * 60_000),
      }),
    )

    const { texto, html } = corpoDoEmail(codigo)
    try {
      await enviar(conta.email, 'Seu código para redefinir a senha — Kam Brasil', texto, html)
    } catch (error) {
      request.log.error({ err: error }, 'Resend falhou ao enviar código de redefinição')
      return reply.code(502).send({ error: 'não foi possível enviar o email agora — tente de novo em instantes' })
    }

    return generica
  })

  app.post('/auth/redefinir', async (request, reply) => {
    const parsed = redefinirSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
    }

    // Uma recusa só, para todos os caminhos: conta inexistente, sem pedido,
    // expirado, tentativas estouradas ou código errado. Distinguir seria dar
    // um oráculo de enumeração de contas.
    const recusa = () => reply.code(400).send({ error: 'código inválido ou expirado — peça um novo' })

    const email = parsed.data.email.trim().toLowerCase()
    const conta = await contas().findOne({ where: { email } })
    if (!conta) return recusa()

    const pedido = await redefinicoes().findOne({ where: { accountId: conta.id } })
    if (!pedido) return recusa()

    if (agora() > pedido.expiraEm || pedido.tentativas >= MAX_TENTATIVAS) {
      await redefinicoes().delete({ accountId: conta.id })
      return recusa()
    }

    if (sha256(parsed.data.codigo) !== pedido.codigoHash) {
      pedido.tentativas += 1
      await redefinicoes().save(pedido)
      return recusa()
    }

    conta.passwordHash = await hash(parsed.data.senha)
    await contas().save(conta)
    // Código é de uso único, e as sessões antigas caem: se a senha vazou, quem
    // estava dentro com ela sai agora.
    await redefinicoes().delete({ accountId: conta.id })
    await revogarSessoes(conta.id)

    return { ok: true }
  })
}
