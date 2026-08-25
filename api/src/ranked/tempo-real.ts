import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import { In } from 'typeorm'
import type { RankedMode } from '../entities/map.ts'
import { vistaDoLobby, type MapaDoPool } from '../routes/ranked.ts'
// Repositórios pela indireção de ranked/fila-repos.ts — ver o comentário lá.
import { dataSource, lobbies, lobbyPlayers, playerRatings, queueEntries } from './fila-repos.ts'

/**
 * O canal de tempo real da **sessão**. Enquanto o launcher está aberto e
 * logado, ele fica de pé — não importa em que tela o jogador esteja.
 *
 * Nasceu só para a fila e o lobby de bans (no lugar do poll de 3 s / 1,5 s,
 * "Decisões do dono", item 4) e por isso o arquivo mora em `ranked/`. Não é
 * mais só disso: hoje ele também carrega o aviso de que o catálogo de mapas
 * mudou, que precisa chegar a quem está parado na Home. O caminho passou a ser
 * `/tempo-real`; `/ranked/tempo-real` continua atendendo (ver CAMINHO_ANTIGO).
 *
 * O arquivo ficou onde estava de propósito: `bun test` compartilha um processo
 * e `config.ts` congela o ambiente no primeiro import, então a posição deste
 * teste na ordem de execução é carga viva para `routes/ranked-internal.test.ts`
 * (ver o comentário no topo do teste daqui). Mover o arquivo mudaria essa ordem
 * — e o sintoma apareceria em outro teste, sem relação aparente.
 *
 * Três coisas que não são óbvias e explicam o formato deste arquivo:
 *
 * 1. **O poll não morre; vira reserva.** As rotas de `routes/ranked.ts` seguem
 *    intactas e a interface volta a consultá-las enquanto o socket estiver
 *    caído. Quem está numa fila de ranqueada não pode ficar cego porque a rede
 *    oscilou por dez segundos.
 * 2. **O payload é o mesmo do poll**, montado pela mesma `vistaDoLobby`. Se
 *    divergisse, cair do socket para o poll trocaria o formato no meio do lobby
 *    — e a reserva seria pior que a falha.
 * 3. **Um pulso só, compartilhado.** Emitir evento no ponto exato da mudança
 *    exigiria tocar `routes/ranked.ts` (o laço de pareamento e a rota de ban
 *    moram lá). Em vez disso o pulso relê o estado de quem está conectado e
 *    empurra só o que mudou — uma leitura para todos os sockets, não uma por
 *    jogador como no poll.
 */

/**
 * ponytail: o pulso relê o banco em vez de ser acordado pela mudança. Teto: uma
 * consulta a cada 500 ms enquanto houver alguém conectado, mais três por lobby
 * vivo. Se pesar, o upgrade é `pg_notify` no `UPDATE` do lobby, ou uma chamada
 * direta daqui feita por `routes/ranked.ts` — o resto do arquivo não muda.
 */
const PULSO_MS = 500

/** O que o cliente manda para pedir o estado atual. É o único comando aceito. */
const PEDIDO_DE_SYNC = 'sync'

/** O canal é da sessão inteira, não da fila. */
const CAMINHO = '/tempo-real'

/**
 * O caminho antigo, mantido vivo de propósito.
 *
 * O launcher 1.4.x abre `wss://.../ranked/tempo-real` (`ranked_ws.rs`), e um
 * cliente já instalado não tem como saber que o endereço mudou. Tirar isto
 * antes de a base atualizar deixaria a fila e o lobby cegos justamente para
 * quem demora a atualizar — e no lobby de bans ficar cego é perder a partida
 * por WO. Sai quando não houver mais launcher antigo em campo.
 */
const CAMINHO_ANTIGO = '/ranked/tempo-real'

/**
 * Ping periódico, e a única prova de que o outro lado ainda existe.
 *
 * Fila parada não gera mensagem nenhuma, e um socket calado é um socket que o
 * nginx (60 s de `proxy_read_timeout`) e o Cloudflare fecham sozinhos — o
 * jogador veria o canal piscando de minuto em minuto sem nenhuma causa
 * aparente. O pong de volta é o que separa "calado" de "morto": quem não
 * responde ao ping é derrubado no ping seguinte.
 *
 * ponytail: um ciclo de tolerância, não um relógio próprio. Teto: um peer que
 * some sem fechar continua segurando a fila por até 2×PING_MS + os 30 s da
 * varredura de `parearFila`. Se for pouco, o upgrade é encurtar este intervalo
 * — não inventar um segundo timer.
 */
const PING_MS = 25_000

/** Mesmo formato de `GET /ranked/queue/status`. */
export type VistaDaFila = {
  estado: 'fora' | 'waiting' | 'matched'
  esperaSeg: number
  modos: RankedMode[]
  lobbyId?: string
  aguardando: Record<RankedMode, number>
}

type NaFila = Omit<VistaDaFila, 'aguardando'>
type VistaDoLobby = ReturnType<typeof vistaDoLobby>

export type EstadoRanqueado = {
  /** Por conta. Conta ausente = fora da fila. */
  fila: Map<string, NaFila>
  /** Por lobby, já no formato de `GET /ranked/lobby/:id`. */
  lobbies: Map<string, VistaDoLobby>
  /** Quantos aguardam em cada modo — modo vazio vem zero, de propósito. */
  aguardando: Record<RankedMode, number>
}

/** Injetável para o teste não precisar de banco. */
export type Leitor = (contas: readonly string[]) => Promise<EstadoRanqueado>

/** O que esta conexão já recebeu. Vazio = ainda não recebeu nada. */
export type Assinatura = { fila: string; lobby: string }

export const NADA_ENVIADO: Assinatura = { fila: '', lobby: '' }

const FORA_DA_FILA: NaFila = { estado: 'fora', esperaSeg: 0, modos: [] }

/**
 * `esperaSeg` fica de fora da assinatura de propósito: ele muda a cada segundo
 * e faria o canal reempurrar a fila inteira o tempo todo. O relógio da tela
 * anda sozinho entre um evento e outro — é o que o poll já faz hoje.
 */
function assinaturaDaFila(vista: VistaDaFila): string {
  return JSON.stringify([vista.estado, vista.modos, vista.lobbyId ?? null, vista.aguardando])
}

/**
 * O que empurrar para uma conta, dado o que ela já recebeu.
 *
 * Puro: sem banco, sem relógio, sem socket. É aqui que mora a regra de "só o
 * que mudou", e é o que o teste exercita.
 */
export function eventosPara(
  conta: string,
  estado: EstadoRanqueado,
  anterior: Assinatura,
): { eventos: unknown[]; assinatura: Assinatura } {
  const naFila = estado.fila.get(conta) ?? FORA_DA_FILA
  const fila: VistaDaFila = { ...naFila, aguardando: estado.aguardando }

  const eventos: unknown[] = []
  const assinatura: Assinatura = { fila: assinaturaDaFila(fila), lobby: '' }
  if (assinatura.fila !== anterior.fila) eventos.push({ tipo: 'fila', ...fila })

  const lobby = naFila.lobbyId ? estado.lobbies.get(naFila.lobbyId) : undefined
  if (lobby) {
    // O `id` viaja junto porque o cliente pode receber o lobby antes de ter
    // pedido qualquer coisa — o evento precisa se identificar sozinho.
    const evento = { tipo: 'lobby', id: naFila.lobbyId, ...lobby }
    assinatura.lobby = JSON.stringify(evento)
    if (assinatura.lobby !== anterior.lobby) eventos.push(evento)
  }

  return { eventos, assinatura }
}

/** Mesma consulta de `routes/ranked.ts`: o pool da temporada, na ordem do admin. */
async function poolDaTemporada(seasonId: string): Promise<MapaDoPool[]> {
  return (await dataSource.query(
    `select m."id", m."nome"
       from "season_maps" sm
       join "maps" m on m."id" = sm."mapId"
      where sm."seasonId" = $1
      order by sm."ordem" asc, m."nome" asc`,
    [seasonId],
  )) as MapaDoPool[]
}

const lerDoBanco: Leitor = async (contas) => {
  // Socket de pé é prova de presença melhor que o poll. Sem esta batida, a
  // varredura de `parearFila` (30 s sem `lastSeenAt`) tiraria da fila justamente
  // quem parou de consultar porque o tempo real está funcionando.
  await queueEntries().update({ accountId: In([...contas]), estado: 'waiting' }, { lastSeenAt: new Date() })

  const contagem = (await dataSource.query(
    `select modo, count(*)::int as total
       from (select unnest("modos") as modo from "queue_entries" where "estado" = 'waiting') s
      group by modo`,
  )) as { modo: RankedMode; total: number }[]

  const aguardando: Record<RankedMode, number> = { '1v1': 0, '2v2': 0, '3v3': 0, '4v4': 0 }
  for (const linha of contagem) aguardando[linha.modo] = linha.total

  const entradas = await queueEntries().find({ where: { accountId: In([...contas]) } })

  const fila = new Map<string, NaFila>(
    entradas.map((entrada) => [
      entrada.accountId,
      {
        estado: entrada.estado,
        esperaSeg: Math.max(0, Math.floor((Date.now() - entrada.entrouEm.getTime()) / 1_000)),
        modos: entrada.modos,
        lobbyId: entrada.lobbyId ?? undefined,
      },
    ]),
  )

  const vistas = new Map<string, VistaDoLobby>()
  // Um pool por temporada, não por lobby: dois lobbies simultâneos leem os
  // mesmos 10 mapas.
  const pools = new Map<string, MapaDoPool[]>()

  for (const id of new Set(entradas.map((e) => e.lobbyId).filter((id): id is string => id !== null))) {
    const lobby = await lobbies().findOne({ where: { id } })
    if (!lobby) continue

    const jogadores = await lobbyPlayers().find({ where: { lobbyId: lobby.id } })
    const ratings = await playerRatings().find({
      where: { seasonId: lobby.seasonId, accountId: In(jogadores.map((j) => j.accountId)) },
    })
    // Quem não fechou a colocação aparece sem tier — nunca com pontuação.
    const tiers = new Map(ratings.map((r) => [r.accountId, r.placementDone ? r.tier : null]))

    const pool = pools.get(lobby.seasonId) ?? (await poolDaTemporada(lobby.seasonId))
    pools.set(lobby.seasonId, pool)

    vistas.set(
      lobby.id,
      vistaDoLobby(
        lobby,
        jogadores.map((j) => ({ ...j, tier: tiers.get(j.accountId) ?? null })),
        pool,
      ),
    )
  }

  return { fila, lobbies: vistas, aguardando }
}

// ---------------------------------------------------------------------------
// Catálogo de mapas
// ---------------------------------------------------------------------------

/**
 * O evento leva a **assinatura** do catálogo, não o catálogo.
 *
 * Difundir a lista inteira para todo mundo a cada mudança do admin seria
 * mandar o mesmo payload N vezes para quem já o tem, e ainda congelaria o
 * formato do manifesto dentro deste canal — mudar um campo lá passaria a
 * quebrar aqui. O cliente compara a assinatura com a que ele tem e só busca o
 * manifesto quando difere.
 */
export type EventoDeMapas = { tipo: 'mapas'; assinatura: string }

/**
 * Quem avisar quando a assinatura mudar. Um por registro do plugin (na prática,
 * um só) — conjunto, e não variável, porque no teste vários apps sobem no mesmo
 * processo e um `app.close()` não pode calar o app do vizinho.
 */
const difusores = new Set<(assinatura: string) => void>()

/**
 * A última assinatura conhecida. Existe para o caso que mais importa: quem
 * estava **offline** quando o admin mexeu no catálogo. Sem ela, o jogador que
 * abre o launcher depois da mudança só saberia na mudança seguinte — ou seja,
 * nunca. Guardada aqui, ela é empurrada no instante em que ele conecta.
 *
 * `null` = ninguém publicou ainda nesta subida da API. Nesse estado o canal não
 * manda evento nenhum, e o cliente cai no que já faz ao abrir: buscar o
 * manifesto. Por isso o módulo do catálogo deve chamar `avisarCatalogoDeMapas`
 * também ao registrar, e não só nas mudanças.
 */
let assinaturaDoCatalogo: string | null = null

/**
 * O gancho que o módulo do catálogo de mapas chama — ao subir e a cada
 * adição, atualização ou remoção de mapa.
 *
 * Idempotente: assinatura repetida não difunde nada. É de propósito, para que
 * chamar demais seja barato e seguro (do handler que já calculou a assinatura,
 * por exemplo) e chamar de menos seja o único erro possível.
 *
 * ponytail: o aviso é de processo. Teto: com mais de uma réplica da API, a
 * mudança sai pela réplica que atendeu o admin e as outras não avisam os
 * sockets delas. Hoje é uma réplica só. Se virarem várias, o upgrade é
 * `pg_notify` no `UPDATE` do catálogo com cada réplica chamando esta mesma
 * função ao receber — o resto do arquivo não muda.
 */
export function avisarCatalogoDeMapas(assinatura: string): void {
  if (assinatura === assinaturaDoCatalogo) return
  assinaturaDoCatalogo = assinatura
  for (const difundir of difusores) difundir(assinatura)
}

/** `pulsoMs = 0` registra a rota sem ligar o pulso; `ler` troca o banco no teste. */
export type OpcoesTempoReal = { pulsoMs?: number; pingMs?: number; ler?: Leitor }

export default async function tempoRealRoutes(app: FastifyInstance, opcoes: OpcoesTempoReal = {}) {
  const ler = opcoes.ler ?? lerDoBanco
  const pulsoMs = opcoes.pulsoMs ?? PULSO_MS
  const pingMs = opcoes.pingMs ?? PING_MS

  await app.register(websocket)

  type Conexao = {
    enviar: (dado: string) => void
    pingar: () => void
    encerrar: () => void
    conta: string
    assinatura: Assinatura
    pediuEstado: boolean
    /** Respondeu ao último ping? Ainda falso no ping seguinte = peer morto. */
    respondeu: boolean
  }
  const conexoes = new Set<Conexao>()

  /**
   * A assinatura atual do catálogo, para uma conexão só.
   *
   * Chamada ao conectar e no `sync` — e é isso que fecha o buraco de quem
   * estava offline na hora da mudança: ele não precisa de evento nenhum, só de
   * conectar. Fora do pulso de propósito: o aviso de mapas tem que funcionar
   * com a ranqueada desligada, e nesse modo o pulso nem existe.
   */
  const enviarMapas = (conexao: Conexao) => {
    if (assinaturaDoCatalogo === null) return
    conexao.enviar(JSON.stringify({ tipo: 'mapas', assinatura: assinaturaDoCatalogo } satisfies EventoDeMapas))
  }

  const difundirMapas = (assinatura: string) => {
    const dado = JSON.stringify({ tipo: 'mapas', assinatura } satisfies EventoDeMapas)
    for (const conexao of conexoes) {
      // Quem dispara isto é o handler do admin, dentro da requisição dele. Um
      // socket que morreu entre um ping e outro não pode virar 500 numa
      // resposta que já salvou o mapa: o aviso é consequência da mudança, não
      // a mudança.
      try {
        conexao.enviar(dado)
      } catch {
        conexoes.delete(conexao)
      }
    }
  }
  difusores.add(difundirMapas)

  // Mesmo `authenticate` das rotas normais: sem token válido não há upgrade, e
  // o cliente recebe o 401 antes de o socket existir.
  //
  // ponytail: a sessão é conferida uma vez, no handshake — um socket já aberto
  // sobrevive a um logout até cair sozinho. Quem fecha o canal ao sair é o
  // launcher (`ranked_ws_stop`), e o que trafega até lá é o estado de quem
  // acabou de sair, para ele mesmo. Se precisar ser exato: guardar o `jti` da
  // conexão e varrer `sessions` junto com o ping.
  for (const caminho of [CAMINHO, CAMINHO_ANTIGO]) {
    app.get(caminho, { websocket: true, onRequest: [app.authenticate] }, (socket, request) => {
      const conexao: Conexao = {
        enviar: (dado) => socket.send(dado),
        pingar: () => socket.ping(),
        encerrar: () => socket.terminate(),
        conta: request.account.id,
        // Assinatura vazia: o primeiro pulso entrega o estado inteiro. É isso que
        // faz reconectar não depender de lembrar do que veio antes.
        assinatura: NADA_ENVIADO,
        pediuEstado: false,
        respondeu: true,
      }
      conexoes.add(conexao)

      // Antes de qualquer outra coisa: conectar já é conferir o catálogo.
      enviarMapas(conexao)

      socket.on('close', () => conexoes.delete(conexao))
      socket.on('error', () => conexoes.delete(conexao))
      socket.on('pong', () => (conexao.respondeu = true))

      // Único comando aceito: "me manda o estado atual de novo". Serve à webview
      // recarregada — o socket vive no processo do launcher e sobrevive a ela, e
      // sem isto a tela nova ficaria vazia até a próxima mudança.
      socket.on('message', (dado: { toString(): string }) => {
        if (dado.toString().trim() !== PEDIDO_DE_SYNC) return
        conexao.pediuEstado = true
        // O catálogo não passa pelo pulso, então o `pediuEstado` não o alcança.
        enviarMapas(conexao)
      })
    })
  }

  // O ping vem antes de qualquer `return`: sem ranqueada o canal continua de pé
  // para o aviso de mapas, e conexão morta segurando lugar é problema deste
  // canal, não da fila.
  const ping = setInterval(() => {
    for (const conexao of conexoes) {
      // Não respondeu ao ping anterior: o peer sumiu sem fechar — wifi caiu,
      // notebook fechou, NAT reciclou. Enquanto a conexão morta ficar aqui, o
      // pulso segue renovando o `lastSeenAt` da fila dela, e a varredura de
      // 30 s de `parearFila` — que existe justamente para tirar quem sumiu —
      // nunca a alcança: o fantasma é pareado e o adversário fica sozinho na
      // sala. Tirar do conjunto é o que solta a fila; o `terminate` é só a
      // limpeza do que sobrou do socket.
      if (!conexao.respondeu) {
        conexoes.delete(conexao)
        conexao.encerrar()
        continue
      }
      conexao.respondeu = false
      conexao.pingar()
    }
  }, pingMs)

  let rodando = false

  const timer = pulsoMs <= 0 ? null : setInterval(async () => {
    // Ninguém conectado é ninguém para avisar: nem consulta o banco.
    if (rodando || conexoes.size === 0) return
    rodando = true
    try {
      const contas = [...new Set([...conexoes].map((c) => c.conta))]
      const estado = await ler(contas)

      for (const conexao of conexoes) {
        // O pedido de `sync` pode ter chegado durante a leitura acima. Zerar a
        // assinatura aqui, e não no `on('message')`, é o que impede este pulso
        // de sobrescrever o pedido — e de deixar a tela vazia até a próxima
        // mudança de verdade, que é justamente o que o `sync` existe para evitar.
        if (conexao.pediuEstado) {
          conexao.assinatura = NADA_ENVIADO
          conexao.pediuEstado = false
        }

        const { eventos, assinatura } = eventosPara(conexao.conta, estado, conexao.assinatura)
        conexao.assinatura = assinatura
        for (const evento of eventos) conexao.enviar(JSON.stringify(evento))
      }
    } catch (erro) {
      app.log.error({ erro }, 'pulso do tempo real falhou')
    } finally {
      rodando = false
    }
  }, pulsoMs)

  if (timer === null) {
    app.log.warn('pulso do tempo real desligado: a fila e o lobby ficam só no poll (o aviso de mapas segue de pé)')
  }

  app.addHook('onClose', async () => {
    difusores.delete(difundirMapas)
    if (timer) clearInterval(timer)
    clearInterval(ping)
  })
}
