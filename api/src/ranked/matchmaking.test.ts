// Testes do pareamento. Tudo puro: sem banco, sem relógio, sem mock.
//
// O foco é o que destrói um ladder de comunidade pequena: faixa que abre demais
// ("só dessa vez"), Bárbaro caindo contra Recruta, e time montado desequilibrado
// porque a soma bateu. Os números do OpenSkill não são testados aqui — isso
// seria testar a lib.

import { expect, test } from 'bun:test'
import type { RankedMode } from '../entities/map.ts'
import type { Tier } from '../entities/player-rating.ts'
import {
  compativel,
  desequilibrio,
  DESEQUILIBRIO_POR_JOGADOR,
  faixaDeltaMu,
  FAIXA_COLOCACAO,
  FAIXA_TETO,
  montarTimes,
  parear,
  partidaAceitavel,
  spreadMaximo,
  SPREAD_LOBBY,
  SPREAD_LOBBY_RELAXADO,
  tiersCompativeis,
  type Candidato,
} from './matchmaking.ts'
import { SIGMA_MIN } from './rating.ts'

const TODOS: RankedMode[] = ['1v1', '2v2', '3v3', '4v4']

let proximo = 0

function jogador(dados: Partial<Candidato> & { mu: number }): Candidato {
  proximo += 1
  return {
    accountId: `conta-${proximo}`,
    nickname: `jogador${proximo}`,
    sigma: SIGMA_MIN,
    tier: 'espadachim',
    emColocacao: false,
    modos: TODOS,
    esperaSeg: 0,
    ...dados,
  }
}

test('a faixa abre com o tempo de fila e trava em 9.0 para sempre', () => {
  expect(faixaDeltaMu(0)).toBe(2.0)
  expect(faixaDeltaMu(29)).toBe(2.0)
  expect(faixaDeltaMu(30)).toBe(3.5)
  expect(faixaDeltaMu(59)).toBe(3.5)
  expect(faixaDeltaMu(60)).toBe(5.0)
  expect(faixaDeltaMu(119)).toBe(5.0)
  expect(faixaDeltaMu(120)).toBe(7.0)
  expect(faixaDeltaMu(239)).toBe(7.0)
  expect(faixaDeltaMu(240)).toBe(FAIXA_TETO)

  // O teto é duro: uma hora de fila não compra uma partida injusta.
  expect(faixaDeltaMu(3_600)).toBe(FAIXA_TETO)
  expect(faixaDeltaMu(86_400, true)).toBe(FAIXA_TETO)
})

test('em colocação a faixa já nasce larga, mas nunca ultrapassa o teto', () => {
  expect(faixaDeltaMu(0, true)).toBe(FAIXA_COLOCACAO)
  expect(faixaDeltaMu(59, true)).toBe(FAIXA_COLOCACAO)
  // Passou da faixa de colocação, quem manda é a tabela.
  expect(faixaDeltaMu(120, true)).toBe(7.0)
})

test('spread do lobby relaxa uma vez, depois de 4 min', () => {
  expect(spreadMaximo(0)).toBe(SPREAD_LOBBY)
  expect(spreadMaximo(239)).toBe(SPREAD_LOBBY)
  expect(spreadMaximo(240)).toBe(SPREAD_LOBBY_RELAXADO)
})

test('trava de tier: 2 de diferença passa, 3 não — e Bárbaro nunca vê Recruta', () => {
  expect(tiersCompativeis('recruta', 'machadeiro')).toBe(true)
  expect(tiersCompativeis('recruta', 'espadachim')).toBe(false)
  expect(tiersCompativeis('barbaro', 'recruta')).toBe(false)
  expect(tiersCompativeis('comandante', 'recruta')).toBe(false)
  expect(tiersCompativeis('comandante', 'besteiro')).toBe(true)
  expect(tiersCompativeis('comandante', 'espadachim')).toBe(false)

  // Quem ainda está em colocação não tem tier nomeado: nada a travar.
  expect(tiersCompativeis(null, 'barbaro')).toBe(true)
  expect(tiersCompativeis('recruta', null)).toBe(true)
})

test('a trava de tier vale mesmo com fila infinita', () => {
  const barbaro = jogador({ mu: 33, tier: 'barbaro', esperaSeg: 99_999 })
  const recruta = jogador({ mu: 30, tier: 'recruta', esperaSeg: 99_999 })

  // Os mu até caberiam na faixa aberta — a trava é bloqueio, não custo.
  expect(Math.abs(barbaro.mu - recruta.mu)).toBeLessThan(FAIXA_TETO)
  expect(compativel(barbaro, recruta, '1v1')).toBe(false)
  expect(parear([barbaro, recruta]).partidas).toHaveLength(0)
})

test('1x1 não fecha fora da faixa, e fecha assim que a espera abre', () => {
  const a = () => jogador({ mu: 28, tier: 'besteiro' })
  const b = () => jogador({ mu: 31, tier: 'besteiro' })

  // |Δmu| = 3.0: acima da faixa de 2.0 dos primeiros 30 s.
  expect(parear([a(), b()]).partidas).toHaveLength(0)

  const esperando = [jogador({ mu: 28, tier: 'besteiro', esperaSeg: 45 }), b()]
  expect(parear(esperando).partidas).toHaveLength(1)
})

test('quem não fecha partida continua na fila, não é forçado a jogar', () => {
  const { partidas, restantes } = parear([
    jogador({ mu: 25, tier: 'espadachim' }),
    jogador({ mu: 25.5, tier: 'espadachim' }),
    jogador({ mu: 40, tier: 'barbaro' }),
  ])

  expect(partidas).toHaveLength(1)
  expect(restantes).toHaveLength(1)
  expect(restantes[0]!.mu).toBe(40)
})

test('prioridade por espera: quem chegou primeiro é pareado primeiro', () => {
  const antigo = jogador({ mu: 25, esperaSeg: 300, modos: ['1v1'] })
  const opcaoA = jogador({ mu: 25.1, esperaSeg: 200, modos: ['1v1'] })
  const opcaoB = jogador({ mu: 25.1, esperaSeg: 10, modos: ['1v1'] })

  const { partidas, restantes } = parear([opcaoB, antigo, opcaoA])

  expect(partidas).toHaveLength(1)
  const escolhidos = [...partidas[0]!.times.A, ...partidas[0]!.times.B].map((j) => j.accountId)
  expect(escolhidos).toContain(antigo.accountId)
  // Empate de mu: leva quem está esperando há mais tempo.
  expect(escolhidos).toContain(opcaoA.accountId)
  expect(restantes[0]!.accountId).toBe(opcaoB.accountId)
})

test('anti-repetição é preferência, nunca bloqueio', () => {
  const eu = jogador({ mu: 25, esperaSeg: 300, modos: ['1v1'], oponentesRecentes: [] })
  const ontem = jogador({ mu: 25, modos: ['1v1'] })
  const novo = jogador({ mu: 25.4, modos: ['1v1'] })
  eu.oponentesRecentes = [ontem.accountId]

  // Havendo alternativa, evita a revanche mesmo com mu um pouco pior.
  const comAlternativa = parear([eu, ontem, novo]).partidas[0]!
  const escolhidos = [...comAlternativa.times.A, ...comAlternativa.times.B].map((j) => j.accountId)
  expect(escolhidos).toContain(novo.accountId)

  // Sem alternativa, a revanche acontece: bloquear esvaziaria a fila.
  const sozinhos = parear([eu, ontem]).partidas
  expect(sozinhos).toHaveLength(1)
})

test('snake draft equilibra o 2x2 melhor que a ordem de chegada', () => {
  const times = montarTimes([
    jogador({ mu: 30 }),
    jogador({ mu: 28 }),
    jogador({ mu: 24 }),
    jogador({ mu: 22 }),
  ])

  expect(times.A).toHaveLength(2)
  expect(times.B).toHaveLength(2)
  // 30+22 contra 28+24: o pior arranjo (30+28 vs 24+22) daria 12.
  expect(desequilibrio(times)).toBeLessThanOrEqual(DESEQUILIBRIO_POR_JOGADOR * 2)
})

test('4x4 fecha com 8 pessoas e respeita o limite de desequilíbrio', () => {
  const oito = [30, 29.5, 29, 28.5, 28, 27.5, 27, 26.5].map((mu) =>
    jogador({ mu, tier: 'besteiro', modos: ['4v4'] }),
  )

  const { partidas, restantes } = parear(oito)

  expect(partidas).toHaveLength(1)
  expect(restantes).toHaveLength(0)
  expect(partidas[0]!.mode).toBe('4v4')
  expect(partidas[0]!.times.A).toHaveLength(4)
  expect(desequilibrio(partidas[0]!.times)).toBeLessThanOrEqual(DESEQUILIBRIO_POR_JOGADOR * 4)
})

test('lobby de time com spread grande demais não fecha, mesmo com a soma batendo', () => {
  // Somas quase iguais (36 vs 36), mas um Bárbaro e dois quase-Recrutas juntos.
  const quatro = [
    jogador({ mu: 36, tier: 'besteiro', modos: ['2v2'] }),
    jogador({ mu: 18, tier: 'miliciano', modos: ['2v2'] }),
    jogador({ mu: 27, tier: 'espadachim', modos: ['2v2'] }),
    jogador({ mu: 27, tier: 'espadachim', modos: ['2v2'] }),
  ]

  expect(parear(quatro).partidas).toHaveLength(0)
})

test('gate de predictWin barra o favorito acima de 85%', () => {
  // Dentro da faixa de 9.0 e dentro de 2 tiers — mas σ no piso dos dois lados
  // torna o resultado quase certo. É exatamente o que o gate existe para pegar.
  const forte = jogador({ mu: 34, tier: 'barbaro', sigma: SIGMA_MIN })
  const fraco = jogador({ mu: 25.5, tier: 'espadachim', sigma: SIGMA_MIN })

  expect(tiersCompativeis(forte.tier, fraco.tier)).toBe(true)
  expect(partidaAceitavel({ A: [forte], B: [fraco] })).toBe(false)
})

test('partida parelha passa nos dois gates', () => {
  const a = jogador({ mu: 25, sigma: SIGMA_MIN })
  const b = jogador({ mu: 25.5, sigma: SIGMA_MIN })

  expect(partidaAceitavel({ A: [a], B: [b] })).toBe(true)
})

test('ninguém é pareado duas vezes no mesmo tique', () => {
  const seis = Array.from({ length: 6 }, () => jogador({ mu: 25, modos: ['1v1'] }))

  const { partidas, restantes } = parear(seis)

  const escolhidos = partidas.flatMap((p) => [...p.times.A, ...p.times.B].map((j) => j.accountId))
  expect(new Set(escolhidos).size).toBe(escolhidos.length)
  expect(escolhidos.length + restantes.length).toBe(6)
})

test('o modo menor fecha primeiro: 1x1 sai antes de segurar todo mundo por um 4x4', () => {
  const dois = [jogador({ mu: 25 }), jogador({ mu: 25.2 })]

  const { partidas } = parear(dois)

  expect(partidas).toHaveLength(1)
  expect(partidas[0]!.mode).toBe('1v1')
})

test('jogador só entra em modo que marcou', () => {
  const so2v2 = jogador({ mu: 25, modos: ['2v2'] })
  const so1v1 = jogador({ mu: 25, modos: ['1v1'] })

  expect(parear([so2v2, so1v1]).partidas).toHaveLength(0)
})
