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

// --- jogo original ---

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
  endsAt: string
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
