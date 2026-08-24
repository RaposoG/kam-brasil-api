// O que este teste protege, e por que ele existe:
//
// 1. **Empurrar só o que mudou.** O pulso relê o estado a cada 500 ms; se cada
//    pulso virasse mensagem, o canal seria um poll mais caro do lado do
//    servidor. E o caso perigoso é o `esperaSeg`, que muda *todo* segundo
//    sozinho — ele fica de fora da assinatura de propósito.
// 2. **Conexão sem sessão é recusada.** O canal carrega o lobby inteiro; entrar
//    nele sem token não pode ser possível.
// 3. **O payload é o mesmo do poll.** O evento de lobby é montado pela mesma
//    `vistaDoLobby` das rotas — inclusive o `launch`, que é o "pode abrir o
//    jogo". Se divergir, cair para o poll troca o formato no meio do lobby.
// 4. **Reconectar não assume nada.** Assinatura zerada devolve o estado inteiro,
//    e é isso que o `sync` do cliente faz.
//
// O banco não participa: o leitor é injetado.

import { expect, test } from 'bun:test'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import type { Lobby } from '../entities/lobby.ts'
import type { LobbyPlayer } from '../entities/lobby-player.ts'

// `config.ts` lê o ambiente uma vez, no import, e no `bun test` o processo é um
// só: quem importar config primeiro congela o ambiente para todos os arquivos.
// Este roda antes de `routes/ranked-internal.test.ts` (o caminho `ranked/`
// ordena antes de `routes/`), então as duas linhas de baixo são as *dele* —
// sem elas as rotas internas responderiam `forbidden` no teste dele, e o
// sintoma apareceria a quilômetros daqui.
process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)
process.env.VERIFY_ALLOWED_IPS ??= '127.0.0.1'
process.env.RANKED_INTERNAL_SECRET ??= 'segredo-de-teste'

// Dinâmico e depois do ambiente: um import estático seria içado para antes dele.
const { default: tempoRealRoutes, eventosPara, NADA_ENVIADO } = await import('./tempo-real.ts')
const { vistaDoLobby } = await import('../routes/ranked.ts')
type EstadoRanqueado = import('./tempo-real.ts').EstadoRanqueado

const EU = '33333333-3333-4333-8333-333333333333'
const LOBBY_ID = '22222222-2222-4222-8222-222222222222'
const SEASON_ID = '11111111-1111-4111-8111-111111111111'

const POOL = Array.from({ length: 10 }, (_, i) => ({
  id: `0000000${i}-0000-4000-8000-000000000000`,
  nome: `Mapa ${i + 1}`,
}))

const AGUARDANDO: EstadoRanqueado['aguardando'] = { '1v1': 2, '2v2': 0, '3v3': 0, '4v4': 0 }

function estadoDaFila(esperaSeg: number, aguardando = AGUARDANDO): EstadoRanqueado {
  return {
    fila: new Map([[EU, { estado: 'waiting', esperaSeg, modos: ['1v1'] }]]),
    lobbies: new Map(),
    aguardando: { ...aguardando },
  }
}

function vista(patch: Partial<Lobby> = {}) {
  const lobby = {
    id: LOBBY_ID,
    seasonId: SEASON_ID,
    mode: '1v1',
    estado: 'ban',
    turnoTime: 'A',
    turnoPrazo: new Date('2026-08-24T12:00:25Z'),
    mapasBanidos: [],
    mapaEscolhidoId: null,
    serverIp: null,
    serverPort: null,
    roomIndex: null,
    roomSenha: null,
    matchId: null,
    criadoEm: new Date(),
    ...patch,
  } as Lobby

  const jogadores = [
    { nickname: 'eu', time: 'A', startLocation: 1, tier: 'espadachim' },
    { nickname: 'rival', time: 'B', startLocation: 2, tier: null },
  ] as (Pick<LobbyPlayer, 'nickname' | 'time' | 'startLocation'> & { tier: null })[]

  return vistaDoLobby(lobby, jogadores, POOL)
}

function estadoComLobby(lobby = vista()): EstadoRanqueado {
  return {
    fila: new Map([[EU, { estado: 'matched', esperaSeg: 40, modos: ['1v1'], lobbyId: LOBBY_ID }]]),
    lobbies: new Map([[LOBBY_ID, lobby]]),
    aguardando: { ...AGUARDANDO },
  }
}

// --- a regra de "só o que mudou" -------------------------------------------

test('a primeira leitura entrega o estado; a segunda, igual, não entrega nada', () => {
  const primeira = eventosPara(EU, estadoDaFila(3), NADA_ENVIADO)
  expect(primeira.eventos).toHaveLength(1)
  expect(primeira.eventos[0]).toMatchObject({ tipo: 'fila', estado: 'waiting', aguardando: AGUARDANDO })

  expect(eventosPara(EU, estadoDaFila(3), primeira.assinatura).eventos).toEqual([])
})

test('o relógio da espera andando sozinho não vira mensagem', () => {
  const { assinatura } = eventosPara(EU, estadoDaFila(3), NADA_ENVIADO)
  // 30 segundos depois, nada mudou de verdade: só o cronômetro, que a tela
  // conta sozinha. Se isto empurrasse, o canal seria um poll de 500 ms.
  expect(eventosPara(EU, estadoDaFila(33), assinatura).eventos).toEqual([])
})

test('mudou quantos aguardam num modo: empurra', () => {
  const { assinatura } = eventosPara(EU, estadoDaFila(3), NADA_ENVIADO)
  const depois = eventosPara(EU, estadoDaFila(4, { ...AGUARDANDO, '2v2': 1 }), assinatura)
  expect(depois.eventos).toHaveLength(1)
})

test('quem não está na fila recebe estado "fora", e uma vez só', () => {
  const vazio: EstadoRanqueado = { fila: new Map(), lobbies: new Map(), aguardando: { ...AGUARDANDO } }
  const primeira = eventosPara(EU, vazio, NADA_ENVIADO)
  expect(primeira.eventos[0]).toMatchObject({ tipo: 'fila', estado: 'fora', modos: [] })
  expect(eventosPara(EU, vazio, primeira.assinatura).eventos).toEqual([])
})

test('o lobby começa, cada ban, o sorteio e o "pode abrir o jogo" viram evento', () => {
  // Começou: a fila muda para `matched` e o lobby vem junto.
  const inicio = eventosPara(EU, estadoComLobby(), NADA_ENVIADO)
  expect(inicio.eventos).toHaveLength(2)
  expect(inicio.eventos[1]).toMatchObject({ tipo: 'lobby', id: LOBBY_ID, estado: 'ban', turnoTime: 'A' })

  // Um ban: muda o mapa banido e o turno, e a fila não se mexe.
  const banido = vista({ mapasBanidos: [POOL[0]!.id], turnoTime: 'B', turnoPrazo: new Date('2026-08-24T12:00:50Z') })
  const aposBan = eventosPara(EU, estadoComLobby(banido), inicio.assinatura)
  expect(aposBan.eventos).toHaveLength(1)
  expect(aposBan.eventos[0]).toMatchObject({ tipo: 'lobby', turnoTime: 'B' })
  expect((aposBan.eventos[0] as { mapas: { estado: string }[] }).mapas[0]!.estado).toBe('banido')

  // Sorteio.
  const sorteado = vista({ estado: 'draw', turnoTime: null, turnoPrazo: null, mapaEscolhidoId: POOL[3]!.id })
  const aposSorteio = eventosPara(EU, estadoComLobby(sorteado), aposBan.assinatura)
  expect(aposSorteio.eventos[0]).toMatchObject({ estado: 'draw', mapaEscolhido: POOL[3] })

  // Sala reservada: é este evento que libera o botão de abrir o jogo.
  const pronto = vista({ estado: 'launch', serverIp: '1.2.3.4', serverPort: 56000, roomIndex: 8 })
  const aposReserva = eventosPara(EU, estadoComLobby(pronto), aposSorteio.assinatura)
  expect(aposReserva.eventos[0]).toMatchObject({
    estado: 'launch',
    launch: { ip: '1.2.3.4', porta: 56000, sala: 8, senha: null },
  })
})

test('assinatura zerada devolve tudo — é o que o "sync" da reconexão faz', () => {
  const { assinatura } = eventosPara(EU, estadoComLobby(), NADA_ENVIADO)
  expect(eventosPara(EU, estadoComLobby(), assinatura).eventos).toEqual([])
  expect(eventosPara(EU, estadoComLobby(), NADA_ENVIADO).eventos).toHaveLength(2)
})

// --- o socket ---------------------------------------------------------------

function buildApp(
  conta: string | null,
  ler: () => Promise<EstadoRanqueado>,
  pingMs?: number,
): FastifyInstance {
  const app = Fastify()
  app.register(
    fp(async (instance) => {
      instance.decorateRequest('account')
      instance.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!conta) return reply.code(401).send({ error: 'token ausente ou inválido' })
        request.account = { id: conta } as never
      })
    }),
  )
  app.register(tempoRealRoutes, { pulsoMs: 5, pingMs, ler })
  return app
}

async function ate(condicao: () => boolean, limiteMs = 2_000): Promise<void> {
  const fim = Date.now() + limiteMs
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('esperei demais pelo evento')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/**
 * Socket de verdade, sobre uma porta de verdade. O `injectWS` do plugin seria
 * mais curto, mas não provaria o que interessa aqui: que o upgrade HTTP
 * funciona no runtime em que a API roda.
 */
async function conectar(app: FastifyInstance): Promise<WebSocket> {
  const endereco = await app.listen({ port: 0, host: '127.0.0.1' })
  return new WebSocket(`${endereco.replace('http://', 'ws://')}/ranked/tempo-real`)
}

async function recusou(ws: WebSocket): Promise<boolean> {
  return new Promise((resolve) => {
    ws.addEventListener('open', () => resolve(false))
    ws.addEventListener('error', () => resolve(true))
    ws.addEventListener('close', () => resolve(true))
  })
}

test('conexão sem sessão é recusada', async () => {
  const app = buildApp(null, async () => estadoDaFila(1))
  const ws = await conectar(app)

  expect(await recusou(ws)).toBe(true)
  ws.close()
  await app.close()
})

test('e é o `authenticate` de verdade que recusa, com 401, antes do upgrade', async () => {
  // Sem `Authorization` o `jwtVerify` falha antes de qualquer consulta — o
  // banco não participa. O que este teste guarda é o encanamento: a rota do
  // socket passa pelo mesmo `onRequest` das rotas normais, e o 401 sai antes
  // de o socket existir. Reparar no *código*, e não só na conexão fechada,
  // separa "recusado" de "o handler explodiu".
  const { default: authPlugin } = await import('../plugins/auth.ts')

  const app = Fastify()
  await app.register(authPlugin)
  await app.register(tempoRealRoutes, { pulsoMs: 0, ler: async () => estadoDaFila(1) })

  // Handshake de verdade, por HTTP: o upgrade é um GET com cabeçalhos: quando o
  // `onRequest` recusa, a resposta é uma resposta HTTP comum, e dá para ler o
  // código. (`inject` não serve aqui: a resposta falsa do light-my-request se
  // atropela em rota de socket.)
  const endereco = await app.listen({ port: 0, host: '127.0.0.1' })
  const res = await fetch(`${endereco}/ranked/tempo-real`, {
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
    },
  })

  expect(res.status).toBe(401)
  await app.close()
})

test('conectado: recebe o estado atual, depois só as mudanças, e o sync repete tudo', async () => {
  let estado = estadoDaFila(1)
  const app = buildApp(EU, async () => estado)

  const ws = await conectar(app)
  const recebidas: { tipo: string }[] = []
  ws.addEventListener('message', (evento) => recebidas.push(JSON.parse(String(evento.data))))

  // Sem pedir nada: o primeiro pulso entrega o estado atual.
  await ate(() => recebidas.length >= 1)
  expect(recebidas[0]).toMatchObject({ tipo: 'fila', estado: 'waiting' })

  // Uns pulsos sem mudança nenhuma não podem virar mensagem.
  await new Promise((r) => setTimeout(r, 50))
  expect(recebidas).toHaveLength(1)

  // Pareou: chega a fila nova e o lobby.
  estado = estadoComLobby()
  await ate(() => recebidas.length >= 3)
  expect(recebidas[1]).toMatchObject({ tipo: 'fila', estado: 'matched', lobbyId: LOBBY_ID })
  expect(recebidas[2]).toMatchObject({ tipo: 'lobby', id: LOBBY_ID })

  // `sync`: a webview recarregou e não sabe de nada. O canal repete o estado.
  ws.send('sync')
  await ate(() => recebidas.length >= 5)
  expect(recebidas[3]).toMatchObject({ tipo: 'fila' })
  expect(recebidas[4]).toMatchObject({ tipo: 'lobby' })

  ws.close()
  await app.close()
})

// --- peer morto -------------------------------------------------------------
//
// Por que isto importa mais do que parece: enquanto uma conexão está no
// conjunto, o pulso renova o `lastSeenAt` da fila daquela conta (ver
// `lerDoBanco`). Um peer que some sem fechar — wifi caiu, notebook fechou —
// escapa da varredura de 30 s de `parearFila`, é pareado, e o adversário fica
// sozinho na sala esperando alguém que não vem. O pong é a única prova de que
// ainda tem gente do outro lado.

test('quem responde ao ping continua conectado — e recebendo', async () => {
  // O caso perigoso da regra é o falso positivo: derrubar jogador vivo a cada
  // ciclo de ping seria muito pior que o fantasma que ela veio consertar.
  let estado = estadoDaFila(1)
  // 200 ms, e não 10: o servidor derruba quem não respondeu ao ping ANTERIOR, e
  // com intervalo curto qualquer engasgo do event loop (GC, máquina carregada,
  // Docker rodando ao lado) atrasa o pong o bastante para o ping seguinte achar
  // que o peer morreu. Falhava ~1 em 15 com 10 ms, e ainda falhou uma vez com
  // 50 — sempre nesta linha, nunca por bug de produção.
  //
  // Um teste que fica vermelho por carga é pior que teste nenhum: treina a
  // gente a ignorar vermelho. O que ele prova continua igual — vários ciclos de
  // ping e a conexão viva —, só com margem que a máquina não derruba.
  const app = buildApp(EU, async () => estado, 200)

  const ws = await conectar(app)
  const recebidas: unknown[] = []
  ws.addEventListener('message', (evento) => recebidas.push(JSON.parse(String(evento.data))))
  await ate(() => recebidas.length >= 1)

  // ~6 ciclos de ping. O cliente responde pong sozinho.
  await new Promise((r) => setTimeout(r, 1_200))
  expect(ws.readyState).toBe(WebSocket.OPEN)

  // E o canal continua servindo: seguir aberto sem entregar nada não valeria.
  estado = estadoComLobby()
  await ate(() => recebidas.length >= 3)

  ws.close()
  await app.close()
})

test('quem para de responder ao ping é derrubado', async () => {
  const app = buildApp(EU, async () => estadoDaFila(1), 10)
  const endereco = await app.listen({ port: 0, host: '127.0.0.1' })
  const porta = Number(new URL(endereco).port)

  // Handshake na mão: o WebSocket do runtime responde pong sozinho, e é
  // justamente o silêncio que precisamos simular aqui.
  let fechou = false
  let recebeu = 0
  const cru = await Bun.connect({
    hostname: '127.0.0.1',
    port: porta,
    socket: {
      data: (_s, d) => {
        recebeu += d.length
      },
      close: () => {
        fechou = true
      },
      error: () => {
        fechou = true
      },
    },
  })
  cru.write(
    `GET /ranked/tempo-real HTTP/1.1\r\nHost: 127.0.0.1:${porta}\r\n` +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
  )

  // Abriu de verdade (101 + primeiro evento) antes de ficar mudo.
  await ate(() => recebeu > 0)
  expect(fechou).toBe(false)

  // Dois ciclos de ping sem pong: o servidor desiste.
  await ate(() => fechou, 2_000)

  cru.end()
  await app.close()
})
