import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * Ponte com o Rust. Repare que não existe função para "pegar o token": ele
 * nunca chega até aqui de propósito. Todo request autenticado é feito do lado
 * Rust, que é quem guarda a sessão. Ver src-tauri/src/auth.rs.
 */

export interface Account {
  id: string
  email: string
  nickname: string
  /** ISO. É o "na comunidade desde" do perfil — a API sempre devolve, mas
   *  sessões restauradas de versões antigas do launcher podem não ter. */
  createdAt?: string
}

export interface LatestRelease {
  version: string
  gameRevision: string
  manifestUrl: string
  baseUrl: string
  totalBytes: number
  fileCount: number
  notes: string
}

export interface UpdateCheck {
  path: string
  installedVersion: string | null
  latest: LatestRelease | null
  needsUpdate: boolean
}

export interface GameStatus {
  path: string
  installed: boolean
  version: string | null
  assetsReady: boolean
}

export interface OriginalGame {
  path: string
  source: string
}

export interface InstallProgress {
  phase: 'verificando' | 'baixando' | 'extraindo' | 'assets' | 'pronto'
  current_file: string
  files_done: number
  files_total: number
  bytes_done: number
  bytes_total: number
  bytes_per_second: number
}

export interface AssetProgress {
  step: string
  detail: string
}

// --- contas ---

export const register = (email: string, nickname: string, password: string): Promise<Account> =>
  invoke('register', { email, nickname, password })

export const login = (login: string, password: string): Promise<Account> =>
  invoke('login', { login, password })

export const logout = (): Promise<void> => invoke('logout')

/** Reaproveita a sessão guardada no cofre do sistema. `null` = precisa logar. */
export const restoreSession = (): Promise<Account | null> => invoke('restore_session')

export const apiBase = (): Promise<string> => invoke('api_base')

// --- KaM Remake (origem dos arquivos que não distribuímos) ---

/** `null` = não achamos; a UI precisa pedir a pasta ao jogador. */
export const findOriginalGame = (): Promise<OriginalGame | null> => invoke('find_original_game')

export const checkOriginalGame = (path: string): Promise<OriginalGame> =>
  invoke('check_original_game', { path })

// --- instalação ---

export const checkUpdate = (): Promise<UpdateCheck> => invoke('check_update')

export const installUpdate = (release: LatestRelease): Promise<void> =>
  invoke('install_update', { release })

export const gameStatus = (): Promise<GameStatus> => invoke('game_status')

export const assetsStatus = (): Promise<boolean> => invoke('assets_status')

export const generateAssets = (originalPath: string): Promise<void> =>
  invoke('generate_assets', { originalPath })

export const launchGame = (): Promise<void> => invoke('launch_game')

// --- atualização do próprio launcher ---

/**
 * Procura uma versão nova **do launcher** (não do jogo) e instala.
 *
 * Só o Windows reinicia o processo sozinho ao terminar, então tratamos como se
 * nunca reiniciasse: `onDone` avisa a interface antes.
 *
 * O pacote é verificado contra a chave pública embutida no binário. Um endpoint
 * comprometido não consegue instalar nada — a assinatura não bateria.
 */
export async function updateLauncher(
  onProgress?: (baixado: number, total: number) => void,
): Promise<boolean> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return false

  let baixado = 0
  let total = 0
  await update.downloadAndInstall((e) => {
    if (e.event === 'Started') total = e.data.contentLength ?? 0
    else if (e.event === 'Progress') {
      baixado += e.data.chunkLength
      onProgress?.(baixado, total)
    }
  })
  return true
}

/** Versão nova disponível do launcher, sem instalar. */
export async function launcherUpdateAvailable(): Promise<string | null> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  return update ? update.version : null
}

// --- camaradas / taverna / presença (autenticados, via Rust) ---

export interface Friend {
  friendshipId: string
  accountId: string
  nickname: string
  online: boolean
  lastSeenAt: string | null
}

export interface FriendRequest {
  friendshipId: string
  nickname: string
}

export interface FriendsList {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

export interface ChatMessage {
  id: number
  nickname: string
  body: string
  at: string
}

export const friendsList = (): Promise<FriendsList> => invoke('friends_list')

/** Devolve o "status" da API: "pending" (convite) ou "accepted" (convite reverso existia). */
export const friendAdd = (nickname: string): Promise<string> => invoke('friend_add', { nickname })

/** accept=false recusa/cancela/desfaz — a API aceita DELETE de qualquer lado. */
export const friendRespond = (friendshipId: string, accept: boolean): Promise<void> =>
  invoke('friend_respond', { friendshipId, accept })

/** Sem `after` = últimas 50; com `after` = só o que chegou depois do cursor. Sempre ascendente. */
export const chatFetch = (after?: number): Promise<ChatMessage[]> =>
  invoke('chat_fetch', { after: after ?? null })

export const chatSend = (body: string): Promise<ChatMessage> => invoke('chat_send', { body })

/** "Estou aberto" — alimenta o lastSeenAt que faz o online dos amigos existir. */
export const presenceHeartbeat = (): Promise<void> => invoke('presence_heartbeat')

// --- ranqueada (autenticada, via Rust) ---

/** Fila única com marcação de modos — nunca uma fila por modo. */
export type RankedMode = '1v1' | '2v2' | '3v3' | '4v4'

export type Team = 'A' | 'B'

/**
 * O tier é a ÚNICA informação de rank que o jogador pode ver. `mu`, `sigma` e
 * `c` não vêm da API — e se um dia vierem, esta camada não os repassa.
 */
export type Tier = 'recruta' | 'miliciano' | 'machadeiro' | 'espadachim' | 'besteiro' | 'barbaro' | 'comandante'

/** Em ordem crescente. `comandante` é vaga (top 5), não faixa — daí vir por último. */
export const TIERS: Tier[] = [
  'recruta',
  'miliciano',
  'machadeiro',
  'espadachim',
  'besteiro',
  'barbaro',
  'comandante',
]

/** O slug é minúsculo e sem acento no banco; o nome bonito é assunto daqui. */
export const NOME_DO_TIER: Record<Tier, string> = {
  recruta: 'Recruta',
  miliciano: 'Miliciano',
  machadeiro: 'Machadeiro',
  espadachim: 'Espadachim',
  besteiro: 'Besteiro',
  barbaro: 'Bárbaro',
  comandante: 'Comandante do Rei',
}

export const rotuloModo = (m: RankedMode) => m.replace('v', ' × ')

export interface QueueStatus {
  /** `fora` = não está na fila. `matched` = já tem lobby (ver `lobbyId`). */
  estado: 'fora' | 'waiting' | 'matched'
  esperaSeg: number
  modos: RankedMode[]
  lobbyId?: string
  /** Quantos aguardam em cada modo. Modo vazio vem zero, de propósito. */
  aguardando: Record<RankedMode, number>
}

export interface LobbyJogador {
  nickname: string
  /** `null` = ainda em colocação. Nunca há pontuação junto. */
  tier: Tier | null
  time: Team
  loc: number
}

export interface LobbyMapa {
  id: string
  nome: string
  estado: 'livre' | 'banido'
}

/** A sala reservada no servidor dedicado. Só existe a partir do estado `launch`. */
export interface LobbyLaunch {
  ip: string
  porta: number | null
  sala: number
  senha: string | null
}

export interface LobbyView {
  estado: 'ban' | 'draw' | 'launch' | 'live' | 'done' | 'aborted'
  mode: RankedMode
  times: LobbyJogador[]
  mapas: LobbyMapa[]
  turnoTime: Team | null
  /** ISO. O cronômetro do turno é a diferença para agora. */
  turnoPrazo: string | null
  mapaEscolhido?: { id: string; nome: string }
  launch?: LobbyLaunch
}

export interface RankedMe {
  /** `null` enquanto a colocação não fecha — até lá não existe tier a exibir. */
  tier: Tier | null
  tierDesde: string | null
  colocacao: { feitas: number; total: number }
  ultimos10: ('V' | 'D')[]
  partidas: number
}

export interface LeaderboardRow {
  posicao: number
  nickname: string
  tier: Tier
}

/** Reenviar com outros modos troca a marcação sem zerar a espera acumulada. */
export const queueJoin = (modes: RankedMode[]): Promise<{ estado: string }> =>
  invoke('ranked_queue_join', { modes })

export const queueLeave = (): Promise<void> => invoke('ranked_queue_leave')

export const queueStatus = (): Promise<QueueStatus> => invoke('ranked_queue_status')

export const lobbyFetch = (lobbyId: string): Promise<LobbyView> => invoke('ranked_lobby', { lobbyId })

/** 409 = não é o seu turno (ou o lobby já saiu da fase de bans). */
export const lobbyBan = (lobbyId: string, mapId: string): Promise<unknown> =>
  invoke('ranked_ban', { lobbyId, mapId })

export const rankedMe = (): Promise<RankedMe> => invoke('ranked_me')

export const rankedLeaderboard = (): Promise<LeaderboardRow[]> => invoke('ranked_leaderboard')

// --- tempo real da fila e do lobby ---

/**
 * O canal vive no Rust (`src-tauri/src/ranked_ws.rs`) porque é autenticado com
 * o token de sessão. Aqui só chegam os eventos, no MESMO formato do poll — é o
 * que permite a tela cair para o poll sem trocar de contrato no meio do lobby.
 *
 * `conexao` é o evento que diz à tela quando o poll de reserva precisa voltar.
 */
export type EventoRanqueado =
  | ({ tipo: 'fila' } & QueueStatus)
  | ({ tipo: 'lobby'; id: string } & LobbyView)
  | { tipo: 'conexao'; ligado: boolean }

/** Idempotente: chamar com o socket vivo não abre um segundo. */
export const tempoRealStart = (): Promise<void> => invoke('ranked_ws_start')

export const tempoRealStop = (): Promise<void> => invoke('ranked_ws_stop')

export const onTempoReal = (handler: (e: EventoRanqueado) => void) =>
  listen<EventoRanqueado>('ranked://tempo-real', (e) => handler(e.payload))

// --- histórico de partidas e estatísticas (autenticados, via Rust) ---

/** `pending` = sala reservada, partida ainda não reportada. `invalid` = desync. */
export type StatusDaPartida = 'pending' | 'valid' | 'invalid'

export interface JogadorNaPartida {
  accountId: string | null
  nickname: string
  time: Team | null
  wonOrLost: 'won' | 'lost' | 'none'
  abandonou: boolean
  /** Relatado pelo cliente, não pelo servidor dedicado. Só vem no relatório. */
  stats?: Record<string, number>
}

export interface Partida {
  id: string
  mode: RankedMode
  /** Falso = partida casual: entra no histórico, fora do rank. */
  ranqueada: boolean
  /** `nome` nulo é mapa fora do catálogo — o CRC sempre existe. */
  mapa: { nome: string | null; crc: string }
  iniciadoEm: string
  encerradoEm: string | null
  duracaoSeg: number | null
  status: StatusDaPartida
  invalidMotivo: string | null
  timeVencedor: Team | null
  jogadores: JogadorNaPartida[]
  /** Só o CRC: o arquivo se baixa por `urlDoReplay`. */
  replay: { crc: string } | null
}

export interface PaginaDePartidas {
  partidas: Partida[]
  /** ISO. `null` = acabou a rolagem. Vira o `before` da próxima página. */
  proximoCursor: string | null
}

/**
 * O que o perfil mostra. Não existe pontuação aqui — e se a API um dia mandar,
 * esta camada não a declara e as telas não a leem.
 */
export interface EstatisticasDaConta {
  accountId: string
  nickname: string
  partidas: number
  vitorias: number
  derrotas: number
  /** 0–1. `null` = nenhuma partida decidida ainda; zero seria mentira. */
  aproveitamento: number | null
  mapasMaisJogados: { mapa: string; partidas: number }[]
  ultimos10: ('V' | 'D')[]
  tier: Tier | null
}

/** Sem `accountId` é o feed da comunidade; com ele, o histórico de uma conta. */
export const historicoDePartidas = (
  filtro: { accountId?: string; limit?: number; before?: string } = {},
): Promise<PaginaDePartidas> =>
  invoke('matches_history', {
    accountId: filtro.accountId ?? null,
    limit: filtro.limit ?? null,
    before: filtro.before ?? null,
  })

export const estatisticasDaConta = (accountId: string): Promise<EstatisticasDaConta> =>
  invoke('account_stats', { accountId })

/**
 * Sobe o par `.bas` + `.rpl` do save local `nome` para a partida.
 *
 * Isto é enriquecimento, nunca resultado: quem diz quem ganhou é o servidor
 * dedicado. `jaExistia` = alguém do outro time já tinha mandado o mesmo replay.
 */
export const enviarReplay = (matchId: string, nome: string): Promise<{ crc: string; jaExistia: boolean }> =>
  invoke('upload_replay', { matchId, nome })

/** Rota pública: dá para abrir no navegador sem token nenhum. */
export async function urlDoReplay(matchId: string, parte: 'rpl' | 'bas' = 'rpl'): Promise<string> {
  return `${await apiBase()}/matches/${matchId}/replay?parte=${parte}`
}

// --- arquivos locais do jogo ---

export interface ReplaySave {
  name: string
  mode: 'SP' | 'MP'
  modifiedMs: number
  sizeBytes: number
  hasReplay: boolean
}

export interface LocalMap {
  name: string
  mode: 'SP' | 'MP'
  modifiedMs: number
}

export const listReplays = (): Promise<ReplaySave[]> => invoke('list_replays')

export const listLocalMaps = (): Promise<LocalMap[]> => invoke('list_local_maps')

/** Um save escrito mais de 6h depois do início não é daquela partida. */
const JANELA_DO_SAVE_MS = 6 * 60 * 60 * 1000

/**
 * De qual partida saiu este save — a ponte entre a pasta do jogo e a crônica.
 *
 * ponytail: casamento por janela de tempo porque não existe chave. O KaM nomeia
 * o save pela data (`SavesMP/<data>/`), não pelo id da partida. No dia em que o
 * servidor dedicado gravar o id no save, isto vira uma igualdade e a tela não
 * muda uma linha.
 */
export function partidaDoSave(save: ReplaySave, partidas: readonly Partida[]): Partida | null {
  // Save de campanha nunca é partida da crônica.
  if (save.mode !== 'MP') return null

  let melhor: Partida | null = null
  for (const p of partidas) {
    const inicio = Date.parse(p.iniciadoEm)
    // O save é escrito durante ou depois da partida, nunca antes dela.
    if (inicio > save.modifiedMs || save.modifiedMs - inicio > JANELA_DO_SAVE_MS) continue
    // Empate não existe na prática, mas se houver fica a mais recente: é a que
    // ainda estava rodando quando o arquivo foi escrito.
    if (!melhor || inicio > Date.parse(melhor.iniciadoEm)) melhor = p
  }
  return melhor
}

// --- leituras públicas (fetch direto: sem token envolvido, a CSP libera o host) ---

export interface StatsOverview {
  onlinePlayers: number
  openServers: number
  launcherOnline: number
  accountsTotal: number
  matchesToday: number
  matchesPerDay: { day: string; count: number }[]
  topMaps: { map: string; count: number }[]
  recentMatches: { map: string; playerCount: number; reportedAt: string }[]
}

export interface NewsPost {
  id: string
  tag: string
  title: string
  body: string
  publishedAt: string
}

export interface Season {
  number: number
  name: string
  startsAt: string
  /** `null` enquanto o admin não fechar a data de fim — a coluna é nullable. */
  endsAt: string | null
  rewards: { nivel: string; nome: string }[]
}

export interface Achievement {
  id: string
  sigla: string
  nome: string
  desc: string
}

async function publico<T>(rota: string): Promise<T> {
  const base = await apiBase()
  const resp = await fetch(base + rota)
  if (!resp.ok) throw new Error(`A API respondeu ${resp.status} em ${rota}`)
  return resp.json()
}

export const fetchStats = (): Promise<StatsOverview> => publico('/stats/overview')

export const fetchNews = async (limit = 20): Promise<NewsPost[]> =>
  (await publico<{ posts: NewsPost[] }>(`/news?limit=${limit}`)).posts

export const fetchSeason = async (): Promise<Season | null> =>
  (await publico<{ season: Season | null }>('/seasons/current')).season

export const fetchAchievements = async (): Promise<Achievement[]> =>
  (await publico<{ achievements: Achievement[] }>('/achievements')).achievements

/** O mesmo texto puro que o jogo recebe — sem JSON. */
export async function fetchMotd(): Promise<string> {
  const base = await apiBase()
  const resp = await fetch(base + '/announcements.php')
  if (!resp.ok) throw new Error(`A API respondeu ${resp.status} no MOTD`)
  return (await resp.text()).trim()
}

// --- utilidades de data ---

/** "agora", "há 5min", "há 2h", "ontem", "há 3 dias" — para saves e presença. */
export function tempoRelativo(quando: number | string): string {
  const t = typeof quando === 'number' ? quando : Date.parse(quando)
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'agora'
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

// --- eventos ---

export const onInstallProgress = (handler: (p: InstallProgress) => void) =>
  listen<InstallProgress>('install-progress', (e) => handler(e.payload))

export const onAssetProgress = (handler: (p: AssetProgress) => void) =>
  listen<AssetProgress>('asset-progress', (e) => handler(e.payload))
