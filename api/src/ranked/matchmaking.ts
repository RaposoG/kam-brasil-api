/**
 * Pareamento do ranqueado — funções puras: sem banco, sem relógio, sem random.
 *
 * A chave de comparação é **`mu`**, nunca `c = mu − 2σ`: usar `c` na fila
 * penalizaria a incerteza duas vezes (uma no rating, outra no pareamento) e
 * afundaria todo jogador novo.
 *
 * Parâmetros do Anexo do PLANO-RANQUEADA, seção "pareamento". A regra que mais
 * importa não é numérica: a faixa **nunca** passa de 9.0. Fila vazia é espera,
 * não partida injusta — numa comunidade pequena o "só dessa vez" é o precedente
 * que mata a credibilidade do ranqueado inteiro.
 */

import { predictWin } from 'openskill'
import type { RankedMode, Team } from '../entities/map.ts'
import type { Tier } from '../entities/player-rating.ts'
import { BETA, TIERS, TIER_APEX } from './rating.ts'

/** Jogadores por time. O total do lobby é o dobro disto. */
export const JOGADORES_POR_TIME: Record<RankedMode, number> = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4 }

/** Do menor para o maior: com fila curta, fechar um 1x1 é melhor que segurar todo mundo esperando um 4x4. */
export const MODOS: readonly RankedMode[] = ['1v1', '2v2', '3v3', '4v4']

/** Ordem de força, com o apex no topo — é a escala da trava de tiers. */
const ORDEM_TIERS: readonly string[] = [...TIERS, TIER_APEX]

/** `[até quantos segundos de fila, |Δmu| máximo]`. Acima da última linha, o teto. */
const FAIXA_POR_ESPERA: readonly (readonly [number, number])[] = [
  [30, 2.0],
  [60, 3.5],
  [120, 5.0],
  [240, 7.0],
]

/** Teto duro. Nenhuma espera, nenhum modo e nenhum feriado abrem além disto. */
export const FAIXA_TETO = 9.0

/** Em colocação a faixa já nasce larga: σ alto significa que o sistema realmente não sabe. */
export const FAIXA_COLOCACAO = 6.0

/** Spread do lobby em modos de time: `mu_max − mu_min`. Sem isto, um Bárbaro e um Recruta na mesma sala. */
export const SPREAD_LOBBY = 8.0
export const SPREAD_LOBBY_RELAXADO = 11.0
export const SPREAD_RELAXA_APOS_SEG = 240

/** Requisito do dono: nunca parear com mais de 2 tiers nomeados de diferença. */
export const MAX_TIERS_DIFERENCA = 2

/** `|Σmu_A − Σmu_B| ≤ 1.5 × N`. */
export const DESEQUILIBRIO_POR_JOGADOR = 1.5

/** Gate final: se um lado favorito passa disto, devolve todo mundo para a fila. */
export const PREDICT_WIN_MAX = 0.85

/**
 * Anti-repetição é **preferência, nunca bloqueio**: com 8 pessoas online,
 * proibir revanche esvazia a fila. Entra como custo na escolha do parceiro.
 */
export const PENALIDADE_REPETICAO = 3.0

export type Candidato = {
  accountId: string
  nickname: string
  mu: number
  sigma: number
  /** `null` enquanto não terminou a colocação — quem não tem tier não sofre a trava. */
  tier: Tier | null
  emColocacao: boolean
  modos: readonly RankedMode[]
  esperaSeg: number
  /** Contas enfrentadas nas últimas 2 partidas. Só desempata, não bloqueia. */
  oponentesRecentes?: readonly string[]
}

export type Times = Record<Team, Candidato[]>
export type Partida = { mode: RankedMode; times: Times }
export type ResultadoPareamento = { partidas: Partida[]; restantes: Candidato[] }

/** `|Δmu|` aceito para quem esperou `esperaSeg`. Abre com o tempo, trava em 9.0. */
export function faixaDeltaMu(esperaSeg: number, emColocacao = false): number {
  const daTabela = FAIXA_POR_ESPERA.find(([ate]) => esperaSeg < ate)?.[1] ?? FAIXA_TETO
  return Math.min(emColocacao ? Math.max(daTabela, FAIXA_COLOCACAO) : daTabela, FAIXA_TETO)
}

export function spreadMaximo(esperaSeg: number): number {
  return esperaSeg >= SPREAD_RELAXA_APOS_SEG ? SPREAD_LOBBY_RELAXADO : SPREAD_LOBBY
}

/**
 * Trava absoluta de tier. Vale em qualquer tempo de fila — não é custo, é bloqueio.
 * Bárbaro contra Recruta são 5 tiers de distância, então já cai aqui: não precisa
 * de regra separada.
 */
export function tiersCompativeis(a: Tier | null, b: Tier | null): boolean {
  if (a === null || b === null) return true
  const ia = ORDEM_TIERS.indexOf(a)
  const ib = ORDEM_TIERS.indexOf(b)
  if (ia < 0 || ib < 0) return true
  return Math.abs(ia - ib) <= MAX_TIERS_DIFERENCA
}

/**
 * Dois jogadores podem dividir o mesmo lobby?
 *
 * No 1x1 a faixa é a distância entre os dois — é literalmente a tabela do plano.
 * Nos modos de time quem manda entre dois jogadores quaisquer é o spread do
 * lobby; a faixa passa a valer contra a **média** do grupo (ver `grupoValido`),
 * que é como o plano define o agrupamento de 2N jogadores.
 */
export function compativel(a: Candidato, b: Candidato, mode: RankedMode): boolean {
  if (!tiersCompativeis(a.tier, b.tier)) return false

  const espera = Math.max(a.esperaSeg, b.esperaSeg)
  const distancia = Math.abs(a.mu - b.mu)

  return mode === '1v1'
    ? distancia <= faixaDeltaMu(espera, a.emColocacao || b.emColocacao)
    : distancia <= spreadMaximo(espera)
}

/** Grupo de 2N jogadores fechado: todos compatíveis entre si e perto da média. */
export function grupoValido(grupo: readonly Candidato[], mode: RankedMode): boolean {
  const total = 2 * JOGADORES_POR_TIME[mode]
  if (grupo.length !== total) return false

  for (let i = 0; i < grupo.length; i++) {
    for (let j = i + 1; j < grupo.length; j++) {
      if (!compativel(grupo[i]!, grupo[j]!, mode)) return false
    }
  }

  if (mode === '1v1') return true

  const espera = Math.max(...grupo.map((j) => j.esperaSeg))
  const emColocacao = grupo.some((j) => j.emColocacao)
  const faixa = faixaDeltaMu(espera, emColocacao)
  const media = grupo.reduce((soma, j) => soma + j.mu, 0) / grupo.length

  return grupo.every((j) => Math.abs(j.mu - media) <= faixa)
}

export function desequilibrio(times: Times): number {
  const soma = (time: readonly Candidato[]) => time.reduce((total, j) => total + j.mu, 0)
  return Math.abs(soma(times.A) - soma(times.B))
}

/**
 * Snake draft por `mu` (A B B A A B B A) e **um** passe de troca de pares.
 * Greedy resolve; escrever otimizador aqui é gastar semana para ganhar decimal.
 */
export function montarTimes(jogadores: readonly Candidato[]): Times {
  const ordenados = [...jogadores].sort((x, y) => y.mu - x.mu)
  const times: Times = { A: [], B: [] }

  ordenados.forEach((jogador, i) => times[((i + 1) >> 1) % 2 === 0 ? 'A' : 'B'].push(jogador))

  for (let i = 0; i < times.A.length; i++) {
    for (let j = 0; j < times.B.length; j++) {
      const atual = desequilibrio(times)
      const a = times.A[i]!
      const b = times.B[j]!
      times.A[i] = b
      times.B[j] = a
      // 1e-9: sem a folga, ruído de ponto flutuante faz trocas que não melhoram nada.
      if (desequilibrio(times) >= atual - 1e-9) {
        times.A[i] = a
        times.B[j] = b
      }
    }
  }

  return times
}

/** Gate final antes de fechar o lobby: equilíbrio na soma **e** na probabilidade. */
export function partidaAceitavel(times: Times): boolean {
  const n = times.A.length
  if (n === 0 || times.B.length !== n) return false

  // `1.5 × N` é regra de montagem de time: no 1x1 ela seria uma segunda faixa,
  // mais apertada que a tabela de espera, e o teto de 9.0 nunca valeria nada.
  if (n > 1 && desequilibrio(times) > DESEQUILIBRIO_POR_JOGADOR * n) return false

  const paraOpenSkill = (time: readonly Candidato[]) => time.map((j) => ({ mu: j.mu, sigma: j.sigma }))
  const [chanceA, chanceB] = predictWin([paraOpenSkill(times.A), paraOpenSkill(times.B)], { beta: BETA })

  return Math.max(chanceA ?? 1, chanceB ?? 1) <= PREDICT_WIN_MAX
}

/** Custo de escolher `outro` como companheiro de lobby de `seed`. Menor é melhor. */
function custo(seed: Candidato, outro: Candidato): number {
  const repetiu = seed.oponentesRecentes?.includes(outro.accountId) ?? false
  return Math.abs(seed.mu - outro.mu) + (repetiu ? PENALIDADE_REPETICAO : 0)
}

function montarGrupo(
  seed: Candidato,
  fila: readonly Candidato[],
  usados: ReadonlySet<string>,
  mode: RankedMode,
): Candidato[] | null {
  const faltam = 2 * JOGADORES_POR_TIME[mode] - 1

  const escolhidos = fila
    .filter(
      (j) =>
        j.accountId !== seed.accountId &&
        !usados.has(j.accountId) &&
        j.modos.includes(mode) &&
        compativel(seed, j, mode),
    )
    // Perto de `mu` primeiro; empatou, quem está há mais tempo na fila entra.
    .sort((x, y) => custo(seed, x) - custo(seed, y) || y.esperaSeg - x.esperaSeg)
    .slice(0, faltam)

  if (escolhidos.length < faltam) return null

  const grupo = [seed, ...escolhidos]
  return grupoValido(grupo, mode) ? grupo : null
}

/**
 * Varre a fila e devolve as partidas que dá para fechar agora.
 *
 * Guloso e determinístico: quem está há mais tempo na fila é atendido primeiro
 * (prioridade por espera), e quem não fecha partida **continua na fila** — nunca
 * se afrouxa uma trava para não deixar ninguém esperando.
 */
export function parear(candidatos: readonly Candidato[]): ResultadoPareamento {
  const fila = [...candidatos].sort((a, b) => b.esperaSeg - a.esperaSeg)
  const usados = new Set<string>()
  const partidas: Partida[] = []

  for (const seed of fila) {
    if (usados.has(seed.accountId)) continue

    for (const mode of MODOS) {
      if (!seed.modos.includes(mode)) continue

      const grupo = montarGrupo(seed, fila, usados, mode)
      if (!grupo) continue

      const times = montarTimes(grupo)
      if (!partidaAceitavel(times)) continue

      partidas.push({ mode, times })
      for (const jogador of grupo) usados.add(jogador.accountId)
      break
    }
  }

  return { partidas, restantes: fila.filter((j) => !usados.has(j.accountId)) }
}
