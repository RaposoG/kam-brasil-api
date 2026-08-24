import type { FastifyInstance } from 'fastify'
import { seasons } from '../data-source.ts'
import type { Season } from '../entities/season.ts'

/**
 * Catálogo da temporada e das conquistas.
 *
 * Nome, número e datas vêm da tabela `seasons` — a mesma que a ranqueada lê.
 * Eram duas verdades sobre a mesma coisa: o admin abria a "Temporada 2" no
 * painel e esta tela continuava anunciando a 1.
 *
 * O que continua constante: as recompensas (não há coluna para elas) e as
 * conquistas. Constante no código da API de propósito — mudar conteúdo aqui é
 * um deploy da API; mudar no launcher seria uma release assinada na mão (as
 * Actions estão fora do ar). Progresso por jogador depende de estatística que o
 * jogo ainda não reporta (Fase 1b).
 */

const RECOMPENSAS = [
  { nivel: '5', nome: 'Selo de temporada' },
  { nivel: '10', nome: 'Moldura de perfil' },
  { nivel: '20', nome: 'Estandarte do vale' },
  { nivel: '35', nome: 'Título: Guardião' },
  { nivel: '50', nome: 'Coroa da temporada' },
]

/**
 * A temporada no formato que o launcher lê.
 *
 * `endsAt` sai `null` enquanto o admin não fechar a data de fim — a coluna é
 * nullable e o painel deixa criar temporada sem ela. Inventar uma data aqui
 * faria a tela mostrar um "faltam N dias" que não existe, e uma contagem
 * regressiva mentirosa é pior do que nenhuma.
 *
 * O launcher ainda não trata esse `null`: `Season.endsAt` é `string` em
 * `launcher/src/api.ts` e `Temporada.vue` formata o campo sem guarda. Enquanto
 * ninguém ajustar os dois, uma temporada sem data de fim aparece como
 * "1 de janeiro" e "faltam 0 dias" na tela.
 */
function vistaDaTemporada(season: Season) {
  return {
    number: season.numero,
    name: season.nome,
    startsAt: season.inicioEm,
    endsAt: season.fimEm,
    rewards: RECOMPENSAS,
  }
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
  app.get('/seasons/current', async () => {
    // A API sobe antes de existir temporada nenhuma: sem ativa é `null`, não erro.
    const season = await seasons().findOne({ where: { ativa: true } })
    return { season: season ? vistaDaTemporada(season) : null }
  })

  app.get('/achievements', async () => ({ achievements: ACHIEVEMENTS }))
}
