// O que este teste protege, e por que ele existe:
//
// 1. A rota NÃO pode virar verificador de "esse email joga Kam Brasil?":
//    /esqueci responde o MESMO 200 com e sem conta, e /redefinir responde a
//    MESMA recusa para conta inexistente, código errado, expirado e estourado.
// 2. O ciclo do código: uso único, 5 tentativas, validade — e redefinir revoga
//    TODAS as sessões (se a senha vazou, quem estava dentro cai junto).
// 3. Sem Resend configurado a rota avisa 503 na hora, em vez de aceitar o
//    pedido e deixar o jogador olhando para uma caixa de email vazia.
//
// O banco e o Resend não participam: tudo entra por opção do plugin
// (OpcoesSenha) — `mock.module` não, pelo motivo documentado em OpcoesMapas.

import { expect, test } from 'bun:test'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Account } from '../entities/account.ts'
import type { RedefinicaoSenha } from '../entities/redefinicao-senha.ts'

// senha.ts puxa data-source.ts e email.ts, que puxam config.ts — e o config
// valida a env na carga. Rodando este arquivo sozinho, as linhas abaixo são
// dele; import dinâmico porque o estático seria içado para antes.
process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const { default: senhaRoutes } = await import('./senha.ts')
type OpcoesSenha = import('./senha.ts').OpcoesSenha

const CONTA_ID = '11111111-1111-4111-8111-111111111111'

let conta: Account
let pedidos: RedefinicaoSenha[] = []
let enviados: { para: string; texto: string }[] = []
let revogadas: string[] = []
let relogio = new Date('2026-08-25T12:00:00Z')

function reset() {
  conta = {
    id: CONTA_ID,
    email: 'raposo@teste.com.br',
    nickname: 'Raposo',
    passwordHash: 'hash-antigo',
    isAdmin: false,
  } as Account
  pedidos = []
  enviados = []
  revogadas = []
  relogio = new Date('2026-08-25T12:00:00Z')
}

/** O código de verdade sai só no email — o teste o pesca de lá, como o jogador. */
const codigoEnviado = () => /\d{6}/.exec(enviados.at(-1)?.texto ?? '')?.[0] ?? ''

function opcoes(habilitado = true): OpcoesSenha {
  return {
    // Sempre liberado nos testes de fluxo: o limiter de verdade usa relógio
    // REAL e a mesma chave de email colidiria entre testes. Ele tem teste
    // próprio no fim do arquivo.
    podePedir: () => true,
    contas: () => ({
      findOne: async ({ where }) => (where.email === conta.email ? conta : null),
      save: async (c) => c,
    }),
    redefinicoes: () => ({
      findOne: async ({ where }) => pedidos.find((p) => p.accountId === where.accountId) ?? null,
      delete: async ({ accountId }) => {
        pedidos = pedidos.filter((p) => p.accountId !== accountId)
      },
      create: (valores) => valores as RedefinicaoSenha,
      save: async (p) => {
        if (!pedidos.includes(p)) pedidos.push(p)
        return p
      },
    }),
    enviar: async (para, _assunto, texto) => {
      enviados.push({ para, texto })
    },
    habilitado: () => habilitado,
    revogarSessoes: async (id) => {
      revogadas.push(id)
    },
    agora: () => relogio,
  }
}

async function buildApp(habilitado = true): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(senhaRoutes, opcoes(habilitado))
  return app
}

const esqueci = (app: FastifyInstance, email: string) =>
  app.inject({ method: 'POST', url: '/auth/esqueci', payload: { email } })

const redefinir = (app: FastifyInstance, codigo: string, senha = 'senha-nova-123', email = 'raposo@teste.com.br') =>
  app.inject({ method: 'POST', url: '/auth/redefinir', payload: { email, codigo, senha } })

// ---- os testes ----

test('esqueci responde o mesmo 200 com e sem conta — e só a real recebe email', async () => {
  reset()
  const app = await buildApp()
  const real = await esqueci(app, 'raposo@teste.com.br')
  const falso = await esqueci(app, 'ninguem@teste.com.br')
  expect(real.statusCode).toBe(200)
  expect(falso.statusCode).toBe(200)
  expect(real.body).toBe(falso.body)
  expect(enviados.length).toBe(1)
  expect(enviados[0]!.para).toBe('raposo@teste.com.br')
  expect(codigoEnviado()).toMatch(/^\d{6}$/)
  await app.close()
})

test('código certo troca a senha, revoga as sessões e é de uso único', async () => {
  reset()
  const app = await buildApp()
  await esqueci(app, 'raposo@teste.com.br')
  const codigo = codigoEnviado()

  const ok = await redefinir(app, codigo)
  expect(ok.statusCode).toBe(200)
  expect(conta.passwordHash).not.toBe('hash-antigo')
  expect(revogadas).toEqual([CONTA_ID])

  // o mesmo código de novo é recusado — uso único
  const denovo = await redefinir(app, codigo)
  expect(denovo.statusCode).toBe(400)
  await app.close()
})

test('código errado consome tentativa; a sexta queima o pedido — e o certo já não vale', async () => {
  reset()
  const app = await buildApp()
  await esqueci(app, 'raposo@teste.com.br')
  const codigo = codigoEnviado()
  const errado = codigo === '000000' ? '000001' : '000000'

  for (let i = 0; i < 5; i++) expect((await redefinir(app, errado)).statusCode).toBe(400)
  // tentativas estouradas: nem o código correto passa mais
  expect((await redefinir(app, codigo)).statusCode).toBe(400)
  expect(conta.passwordHash).toBe('hash-antigo')
  await app.close()
})

test('código expira em 15 minutos', async () => {
  reset()
  const app = await buildApp()
  await esqueci(app, 'raposo@teste.com.br')
  const codigo = codigoEnviado()

  relogio = new Date(relogio.getTime() + 16 * 60_000)
  expect((await redefinir(app, codigo)).statusCode).toBe(400)
  expect(conta.passwordHash).toBe('hash-antigo')
  await app.close()
})

test('a recusa é a mesma para conta inexistente e para código errado', async () => {
  reset()
  const app = await buildApp()
  await esqueci(app, 'raposo@teste.com.br')
  const semConta = await redefinir(app, '123456', 'senha-nova-123', 'ninguem@teste.com.br')
  const codigoErrado = await redefinir(app, codigoEnviado() === '999999' ? '999998' : '999999')
  expect(semConta.statusCode).toBe(400)
  expect(semConta.body).toBe(codigoErrado.body)
  await app.close()
})

test('pedir de novo substitui o código anterior — nunca há dois válidos', async () => {
  reset()
  const app = await buildApp()
  await esqueci(app, 'raposo@teste.com.br')
  const primeiro = codigoEnviado()

  await esqueci(app, 'raposo@teste.com.br')
  const segundo = codigoEnviado()

  expect(pedidos.length).toBe(1)
  // o código antigo morreu junto com o pedido antigo
  if (primeiro !== segundo) {
    expect((await redefinir(app, primeiro)).statusCode).toBe(400)
  }
  expect((await redefinir(app, segundo)).statusCode).toBe(200)
  await app.close()
})

test('o limiter de verdade segura o segundo pedido no mesmo minuto', async () => {
  reset()
  const semLimiterInjetado = { ...opcoes(), podePedir: undefined }
  const app = Fastify()
  await app.register(senhaRoutes, semLimiterInjetado)
  conta.email = 'limite@teste.com.br' // chave exclusiva: o limiter é singleton real
  expect((await esqueci(app, 'limite@teste.com.br')).statusCode).toBe(200)
  expect((await esqueci(app, 'limite@teste.com.br')).statusCode).toBe(429)
  await app.close()
})

test('sem Resend configurado avisa 503 na hora', async () => {
  reset()
  const app = await buildApp(false)
  const res = await esqueci(app, 'raposo@teste.com.br')
  expect(res.statusCode).toBe(503)
  expect(enviados.length).toBe(0)
  await app.close()
})
