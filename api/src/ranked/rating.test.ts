// Testes do motor de rating. Tudo é função pura: nenhum banco, nenhum relógio,
// nenhum mock — só aritmética determinística.
//
// O foco é o que quebra o ladder de verdade: o piso de σ (sem ele o veterano
// congela), a histerese (sem ela o tier oscila a cada partida) e a direção dos
// deltas. Não testamos os números exatos do OpenSkill — isso seria testar a lib.

import { expect, test } from 'bun:test'
import {
  atualizarPartida,
  CORTES_SEMENTE,
  MU_INICIAL,
  pontuacaoOculta,
  ratingInicial,
  SIGMA_INICIAL,
  SIGMA_MIN,
  tierComHisterese,
  tierDe,
  type EstadoTier,
  type JogadorDaPartida,
  type Rating,
} from './rating.ts'

/** 1x1: devolve [vencedor, perdedor] já atualizados. */
function duelo(vencedor: JogadorDaPartida, perdedor: JogadorDaPartida): [Rating, Rating] {
  const [a, b] = atualizarPartida([[vencedor], [perdedor]])
  return [a![0]!, b![0]!]
}

const c = (r: Rating) => pontuacaoOculta(r.mu, r.sigma)

test('ratingInicial: média da escala nativa, e seed de admin só mexe em mu', () => {
  expect(ratingInicial()).toEqual({ mu: MU_INICIAL, sigma: SIGMA_INICIAL })
  expect(ratingInicial(32)).toEqual({ mu: 32, sigma: SIGMA_INICIAL })
})

test('piso de σ segura em 2.5 mesmo depois de 100 vitórias seguidas', () => {
  let veterano = ratingInicial()

  for (let i = 0; i < 100; i++) {
    const anterior = veterano.sigma
    // Adversário pareado — é o que o matchmaking entrega de verdade, e é o
    // cenário que mais encolhe σ.
    ;[veterano] = duelo(veterano, { mu: veterano.mu, sigma: SIGMA_MIN })

    expect(veterano.sigma).toBeGreaterThanOrEqual(SIGMA_MIN)
    expect(veterano.sigma).toBeLessThanOrEqual(anterior) // σ nunca cresce por jogar
  }

  expect(veterano.sigma).toBe(SIGMA_MIN)

  // O ponto do piso: o veterano continua se movendo para sempre.
  const antes = veterano.mu
  const [depois] = duelo(veterano, { mu: veterano.mu, sigma: SIGMA_MIN })
  expect(depois.mu - antes).toBeGreaterThan(0.1)
})

test('sem o piso o veterano congela: σ=1.2 se move ~4x menos que σ=2.5', () => {
  const ganho = (sigma: number) => duelo({ mu: 30, sigma }, { mu: 30, sigma: SIGMA_MIN })[0].mu - 30

  expect(ganho(SIGMA_MIN)).toBeGreaterThan(3 * ganho(1.2))
})

test('vencer sobe o c, perder desce — em 1x1 e em time', () => {
  const antes: Rating = { mu: 25, sigma: 3 }

  const [venceu, perdeu] = duelo(antes, { mu: 25, sigma: 3 })
  expect(c(venceu)).toBeGreaterThan(c(antes))
  expect(c(perdeu)).toBeLessThan(c(antes))

  const time = [antes, antes, antes, antes]
  const [campeoes, derrotados] = atualizarPartida([time, time])
  expect(c(campeoes![0]!)).toBeGreaterThan(c(antes))
  expect(c(derrotados![0]!)).toBeLessThan(c(antes))
})

test('azarão que vence ganha bem mais que o favorito que confirma', () => {
  const deltaAzarao = duelo({ mu: 20, sigma: SIGMA_MIN }, { mu: 30, sigma: SIGMA_MIN })[0].mu - 20
  const deltaFavorito = duelo({ mu: 30, sigma: SIGMA_MIN }, { mu: 20, sigma: SIGMA_MIN })[0].mu - 30

  expect(deltaAzarao).toBeGreaterThan(2 * deltaFavorito)
})

test('tierDe: os pontos de calibração do plano caem onde deviam', () => {
  expect(pontuacaoOculta(25, 2.5)).toBe(20)

  expect(tierDe(12.9)).toBe('recruta')
  expect(tierDe(13)).toBe('miliciano') // limite é inclusivo por baixo
  expect(tierDe(16)).toBe('miliciano') // recém-colocado médio
  expect(tierDe(20)).toBe('espadachim') // mu 25 com σ no piso
  expect(tierDe(28)).toBe('barbaro') // mu 33 com σ no piso
  expect(tierDe(20, [10, 12, 14, 16, 18])).toBe('barbaro') // cortes da temporada
})

test('as 10 colocações reduzem σ substancialmente e nascem conservadoras', () => {
  let novato = ratingInicial()

  for (let i = 0; i < 10; i++) {
    const assentado: Rating = { mu: 25, sigma: SIGMA_MIN }
    // 5 vitórias e 5 derrotas: jogador realmente médio.
    novato =
      i % 2 === 0
        ? duelo({ ...novato, emColocacao: true }, assentado)[0]
        : duelo(assentado, { ...novato, emColocacao: true })[1]
  }

  expect(novato.sigma).toBeLessThan(6) // saiu de 8.33
  expect(novato.sigma).toBeGreaterThan(SIGMA_MIN) // e ainda não está calibrado

  // Colocação deliberadamente conservadora: σ ainda alto puxa o c para baixo, o
  // jogador nasce um tier abaixo do que vai virar e sobe conforme σ encolhe.
  expect(c(novato)).toBeLessThan(pontuacaoOculta(novato.mu, SIGMA_MIN) - 4)
})

test('τ da colocação mantém mais incerteza e move mais mu que o τ normal', () => {
  let emColocacao = ratingInicial()
  let normal = ratingInicial()

  for (let i = 0; i < 10; i++) {
    const assentado: Rating = { mu: 25, sigma: SIGMA_MIN }
    emColocacao = duelo({ ...emColocacao, emColocacao: true }, assentado)[0]
    normal = duelo(normal, assentado)[0]
  }

  expect(emColocacao.sigma).toBeGreaterThan(normal.sigma)
  expect(emColocacao.mu).toBeGreaterThan(normal.mu)
})

test('histerese: resultado alternado no limiar não oscila o tier', () => {
  // mu 25 / σ no piso = c 20 = exatamente o limiar do Espadachim: o pior caso.
  let jogador: Rating = { mu: MU_INICIAL, sigma: SIGMA_MIN }
  let estado: EstadoTier = { tier: 'espadachim', strikes: 0 }
  let caiuSemHisterese = false

  for (let i = 0; i < 200; i++) {
    const oponente: Rating = { mu: MU_INICIAL, sigma: SIGMA_MIN }
    jogador = i % 2 === 0 ? duelo(jogador, oponente)[0] : duelo(oponente, jogador)[1]

    estado = tierComHisterese(estado, c(jogador))
    if (tierDe(c(jogador)) !== 'espadachim') caiuSemHisterese = true

    expect(estado.tier).toBe('espadachim')
  }

  // Sem histerese o tier teria trocado — o teste acima não passou por sorte.
  expect(caiuSemHisterese).toBe(true)
})

test('histerese: uma derrota não rebaixa, duas consecutivas abaixo da banda sim', () => {
  const limiar = CORTES_SEMENTE[2]! // 20 — piso do Espadachim
  const dentroDaBanda = limiar - 0.9
  const abaixo = limiar - 1.1

  const inicial: EstadoTier = { tier: 'espadachim', strikes: 0 }

  // Dentro da banda morta: não conta nem strike.
  expect(tierComHisterese(inicial, dentroDaBanda)).toEqual({ tier: 'espadachim', strikes: 0 })

  const umStrike = tierComHisterese(inicial, abaixo)
  expect(umStrike).toEqual({ tier: 'espadachim', strikes: 1 })

  // Uma partida de volta para a banda zera a contagem: a confirmação exige
  // partidas *consecutivas*.
  expect(tierComHisterese(umStrike, dentroDaBanda).strikes).toBe(0)

  expect(tierComHisterese(umStrike, abaixo)).toEqual({ tier: 'machadeiro', strikes: 0 })
})

test('histerese: promoção é imediata e o primeiro tier não espera nada', () => {
  expect(tierComHisterese({ tier: 'espadachim', strikes: 1 }, 23.5)).toEqual({
    tier: 'besteiro',
    strikes: 0, // subir também limpa a contagem de rebaixamento
  })

  // Saindo da colocação (tier null) o jogador entra direto no tier do seu c.
  expect(tierComHisterese({ tier: null, strikes: 0 }, 14)).toEqual({
    tier: 'miliciano',
    strikes: 0,
  })

  // Recruta não tem para onde cair.
  expect(tierComHisterese({ tier: 'recruta', strikes: 1 }, -50)).toEqual({
    tier: 'recruta',
    strikes: 0,
  })
})
