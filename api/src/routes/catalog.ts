import type { FastifyInstance } from 'fastify'

/**
 * Catálogo estático de temporada e conquistas.
 *
 * Constantes no código da API de propósito: mudar conteúdo aqui é um deploy da
 * API; mudar no launcher seria uma release assinada manual (as Actions estão
 * fora do ar). Sem tabela e sem progresso — progresso por jogador depende de
 * estatística que o jogo ainda não reporta (Fase 1b).
 */

const SEASON = {
  number: 1,
  name: 'Primeiros Muros',
  startsAt: '2026-09-01T00:00:00-03:00',
  endsAt: '2026-11-30T23:59:59-03:00',
  rewards: [
    { nivel: '5', nome: 'Selo de temporada' },
    { nivel: '10', nome: 'Moldura de perfil' },
    { nivel: '20', nome: 'Estandarte do vale' },
    { nivel: '35', nome: 'Título: Guardião' },
    { nivel: '50', nome: 'Coroa da temporada' },
  ],
}

const ACHIEVEMENTS = [
  {
    id: 'pedra-fundamental',
    sigla: 'I',
    nome: 'Pedra Fundamental',
    desc: 'Construa sua primeira edificação em uma partida.',
  },
  {
    id: 'celeiro-cheio',
    sigla: 'II',
    nome: 'Celeiro Cheio',
    desc: 'Complete a cadeia do pão: fazenda, moinho e padaria produzindo juntos.',
  },
  {
    id: 'forja-acesa',
    sigla: 'III',
    nome: 'Forja Acesa',
    desc: 'Produza armas de ferro: da mina à forja, sem parar a fundição.',
  },
  {
    id: 'vila-prospera',
    sigla: 'IV',
    nome: 'Vila Próspera',
    desc: 'Tenha 30 edificações concluídas em uma única partida.',
  },
  {
    id: 'primeira-vitoria',
    sigla: 'V',
    nome: 'Primeira Vitória',
    desc: 'Vença sua primeira partida multiplayer.',
  },
  {
    id: 'senhor-da-guerra',
    sigla: 'VI',
    nome: 'Senhor da Guerra',
    desc: 'Acumule 10 vitórias multiplayer.',
  },
  {
    id: 'cartografo',
    sigla: 'VII',
    nome: 'Cartógrafo',
    desc: 'Jogue partidas em 15 mapas diferentes.',
  },
  {
    id: 'veterano-do-reino',
    sigla: 'VIII',
    nome: 'Veterano do Reino',
    desc: 'Complete um ano na comunidade com pelo menos 100 partidas jogadas.',
  },
]

export default async function catalogRoutes(app: FastifyInstance) {
  /** `season: null` é o formato para "sem temporada ativa" — o launcher trata. */
  app.get('/seasons/current', async () => ({ season: SEASON }))

  app.get('/achievements', async () => ({ achievements: ACHIEVEMENTS }))
}
