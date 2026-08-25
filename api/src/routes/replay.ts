import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.ts'
import { matchPlayers, matches } from '../data-source.ts'
import type { Match } from '../entities/match.ts'
import type { MatchPlayer } from '../entities/match-player.ts'

/**
 * Replay e estatísticas — o que o **cliente** manda depois da partida.
 *
 * Tudo neste arquivo é enriquecimento, e nunca fonte de verdade. Quem decide
 * resultado e rating é o servidor dedicado (`routes/ranked-internal.ts`): é a
 * única peça do sistema que conhece a identidade autenticada de cada jogador e
 * a única que não tem interesse em quem ganha. O cliente é jogador — ele tem.
 *
 * Isso não é um princípio abstrato, é o contrato inteiro deste arquivo: as
 * únicas colunas que ele escreve são `matches.replayCrc` e
 * `match_players.statsJson`. Nada aqui toca `status`, `timeVencedor`,
 * `wonOrLost`, mu/sigma ou peso — nem indiretamente. Se um dia alguém precisar
 * mudar resultado a partir de upload de cliente, a resposta é não.
 */

/**
 * Teto do upload, aplicado pelo próprio Fastify antes de bufferizar o corpo.
 *
 * Generoso porque o `.bas` é o savegame inicial da partida (alguns MB) e o
 * jogador não tem como diminuí-lo; finito porque a rota é autenticada mas
 * qualquer participante pode chamá-la, e disco cheio derruba a API inteira.
 */
export const LIMITE_BYTES = 32 * 1024 * 1024

/** `.bas` é o savegame inicial; `.rpl` é a lista de comandos. Um sem o outro não roda. */
const PARTES = ['bas', 'rpl'] as const
type Parte = (typeof PARTES)[number]

const idParamSchema = z.object({ id: z.uuid() })
const parteQuerySchema = z.object({ parte: z.enum(PARTES).default('rpl') })

/**
 * O que `statsJson` aceita: um mapa raso de contadores numéricos.
 *
 * Números não conseguem carregar resultado. Essa é a defesa de verdade — mais
 * forte que qualquer lista de campos proibidos, porque não depende de a lista
 * estar completa. O `CHEIRA_A_RESULTADO` abaixo é a segunda trava, e existe por
 * um motivo humano: um campo chamado `vencedor` dentro do JSON do cliente vira,
 * seis meses depois, alguém exibindo `statsJson.vencedor` na tela como se fosse
 * placar oficial.
 *
 * ponytail: mapa raso de números. Vira schema por campo se a tela de relatório
 * passar a depender de estrutura (por recurso, por período) — aí o formato
 * deixa de ser "o que o cliente juntou" e passa a ter consumidor definido.
 */
const MAX_CAMPOS = 64

const CHEIRA_A_RESULTADO =
  /won|lost|win|lose|vencedor|vitoria|derrota|result|status|rating|sigma|elo|score|pontos|tier|peso|weight|abandon|valid|team|^mu$|^time$/i

const statsSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, 'nome de campo inválido'),
    // z.number() no zod 4 já recusa NaN e Infinity — nenhum deles sobrevive a
    // um round-trip por jsonb, e os dois viram `null` silencioso no Postgres.
    z.number(),
  )
  .refine((s) => Object.keys(s).length <= MAX_CAMPOS, `no máximo ${MAX_CAMPOS} campos`)
  .refine(
    (s) => !Object.keys(s).some((chave) => CHEIRA_A_RESULTADO.test(chave)),
    'campo de resultado não é aceito aqui: resultado vem do servidor dedicado',
  )

/**
 * Onde os replays moram: ao lado das releases.
 *
 * ponytail: derivado de `RELEASES_DIR` em vez de variável de ambiente nova.
 * Em produção aquilo é um volume, e replay precisa sobreviver a deploy pelo
 * mesmo motivo que binário de release. Vira config própria no dia em que
 * alguém quiser os dois em discos diferentes.
 */
function pastaPadrao(): string {
  return resolve(config.RELEASES_DIR, '..', 'replays')
}

/** Só o que este arquivo usa — ver o comentário de `OpcoesReplay`. */
interface RepoPartidas {
  findOne(opcoes: { where: { id: string } }): Promise<Match | null>
  update(criterio: { id: string }, patch: Partial<Match>): Promise<unknown>
}

interface RepoJogadores {
  findOne(opcoes: { where: { matchId: string; accountId: string } }): Promise<MatchPlayer | null>
  update(criterio: { matchId: string; handIndex: number }, patch: Partial<MatchPlayer>): Promise<unknown>
}

export type OpcoesReplay = {
  /**
   * Injetados pelo teste. Não é `mock.module` de propósito: no `bun test` todos
   * os arquivos dividem o mesmo registro de módulos e só o **primeiro** mock de
   * um módulo vale no processo inteiro — `data-source.ts` já é trocado por
   * `routes/admin.test.ts` (o mesmo motivo que criou `ranked/repos.ts`).
   * Parâmetro de registro não tem esse problema e não precisa de arquivo novo.
   */
  partidas?: () => RepoPartidas
  jogadores?: () => RepoJogadores
  pasta?: string
}

/**
 * CRC32 em hex maiúsculo de 8 dígitos — o mesmo formato dos outros CRCs que já
 * viajam no Pascal (`mapCrc`, `exeCrc`), para poderem ser comparados a olho num
 * log sem ninguém ter que converter nada.
 */
export function crc32Hex(bytes: Uint8Array): string {
  return Bun.hash.crc32(bytes).toString(16).toUpperCase().padStart(8, '0')
}

/**
 * Multipart sem plugin: o `Response` do Bun já sabe parsear
 * `multipart/form-data` — é a mesma implementação que o `fetch` usa. Uma
 * dependência a menos para dois arquivos por upload.
 *
 * `null` em vez de exceção porque corpo malformado é entrada do usuário, não
 * defeito: a resposta certa é 400, não 500.
 */
export async function lerMultipart(bruto: Buffer, contentType: string) {
  try {
    return await new Response(bruto, { headers: { 'content-type': contentType } }).formData()
  } catch {
    return null
  }
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho)
    return true
  } catch {
    return false
  }
}

export default async function replayRoutes(app: FastifyInstance, opcoes: OpcoesReplay = {}) {
  const partidas = opcoes.partidas ?? matches
  const jogadores = opcoes.jogadores ?? matchPlayers
  const pasta = opcoes.pasta ?? pastaPadrao()

  /**
   * `de` guarda a cópia de um remetente específico, fora do slot canônico.
   *
   * Existe por causa do upload divergente: recusar o segundo `.bas` mantinha o
   * primeiro no lugar, mas **jogava os bytes do segundo fora**. Como o slot é
   * primeiro-a-chegar-leva, qualquer participante — inclusive o acusado — podia
   * subir lixo assim que a partida fechasse e o replay verdadeiro passava a
   * tomar 409 para sempre. Isso derruba justamente o único processo anti-cheat
   * que a engine comporta (`reports.ts`: maphack não tem detecção técnica, a
   * resposta é replay + denúncia + análise manual).
   *
   * Guardar por remetente não escolhe quem tem razão — continua sendo o
   * primeiro upload que vira o replay público, e ninguém ganha um botão de
   * anular a própria derrota. Só garante que a prova não some: o `log.warn` da
   * divergência já traz `matchId` e `accountId`, que são exatamente o nome do
   * arquivo.
   */
  const arquivoDe = (matchId: string, parte: Parte, de?: string) =>
    join(pasta, de ? `${matchId}.${de}.${parte}` : `${matchId}.${parte}`)

  /**
   * O Fastify só entrega o corpo cru; quem parseia é `lerMultipart`. O parser
   * é encapsulado neste plugin, então não afeta as outras rotas — a raiz
   * recusa qualquer Content-Type que não seja JSON (`server.ts`).
   */
  app.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })

  app.post(
    '/matches/:id/replay',
    { onRequest: [app.authenticate], bodyLimit: LIMITE_BYTES },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ error: 'id inválido' })

      const bruto = request.body
      if (!Buffer.isBuffer(bruto)) {
        return reply.code(415).send({ error: 'envie multipart/form-data com as partes bas e rpl' })
      }

      const partida = await partidas().findOne({ where: { id: params.data.id } })
      if (!partida) return reply.code(404).send({ error: 'partida não encontrada' })

      // Partida inexistente e partida de outra gente respondem igual, de
      // propósito: quem não jogou não descobre nem que ela existe.
      const eu = await jogadores().findOne({
        where: { matchId: partida.id, accountId: request.account.id },
      })
      if (!eu) return reply.code(404).send({ error: 'partida não encontrada' })

      const formulario = await lerMultipart(bruto, request.headers['content-type'] ?? '')
      if (!formulario) return reply.code(400).send({ error: 'multipart malformado' })

      const conteudo = new Map<Parte, Uint8Array>()
      for (const parte of PARTES) {
        const campo = formulario.get(parte)
        if (!(campo instanceof Blob) || campo.size === 0) {
          return reply.code(400).send({ error: `parte "${parte}" ausente ou vazia` })
        }
        conteudo.set(parte, new Uint8Array(await campo.arrayBuffer()))
      }

      // O CRC é o do `.bas`, e só dele: o savegame MP é gerado byte-idêntico em
      // todos os clientes de propósito (KM_Game.pas:2042), então ele é a única
      // parte que dois participantes têm como produzir igual. O `.rpl` depende
      // de quando cada um saiu e nunca bateria.
      const crc = crc32Hex(conteudo.get('bas')!)

      if (partida.replayCrc && partida.replayCrc !== crc) {
        // Divergência é desync ou fraude — mas quem decide isso é gente, não
        // esta rota. Recusar o segundo upload preserva o primeiro e deixa o
        // caso visível no log; invalidar a partida daqui entregaria a qualquer
        // participante um botão de anular a própria derrota.
        //
        // O que a recusa **não** pode fazer é apagar a prova: os bytes vão para
        // o arquivo do remetente antes do 409. Sem isso, quem subisse primeiro
        // — o acusado, inclusive — decidia sozinho qual replay existe.
        await mkdir(pasta, { recursive: true })
        for (const [parte, bytes] of conteudo) {
          await writeFile(arquivoDe(partida.id, parte, request.account.id), bytes)
        }

        request.log.warn(
          { matchId: partida.id, accountId: request.account.id, crcGravado: partida.replayCrc, crcEnviado: crc },
          'replay divergente: dois participantes enviaram .bas diferentes (cópia guardada por remetente)',
        )
        return reply.code(409).send({ error: 'replay divergente do já registrado', crc: partida.replayCrc })
      }

      await mkdir(pasta, { recursive: true })
      // Caminho determinístico por partida é o que torna o reenvio idempotente:
      // o segundo upload do mesmo replay sobrescreve os mesmos dois arquivos.
      for (const [parte, bytes] of conteudo) await writeFile(arquivoDe(partida.id, parte), bytes)

      const jaExistia = partida.replayCrc === crc
      // ponytail: sem trava entre o SELECT e o UPDATE. Dois participantes
      // subindo ao mesmo tempo gravam o mesmo `.bas` byte a byte (é o ponto do
      // save MP determinístico), então a corrida é entre dois valores iguais.
      // Vira `update ... where replayCrc is null` no dia em que houver caso
      // real de divergência simultânea para separar.
      if (!jaExistia) await partidas().update({ id: partida.id }, { replayCrc: crc })

      return reply.code(jaExistia ? 200 : 201).send({ crc, jaExistia })
    },
  )

  /**
   * Aberto: replay é o registro público de uma partida da comunidade, é o que
   * sustenta denúncia com prova, e não carrega nada de ninguém além do que
   * aconteceu em jogo. O id é um uuid — não se enumera.
   */
  app.get('/matches/:id/replay', async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'id inválido' })

    const query = parteQuerySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: 'parte deve ser bas ou rpl' })

    // Assistir exige as duas partes: o `.rpl` é a lista de comandos e o `.bas`
    // é o estado inicial sobre o qual eles rodam. Dois GETs em vez de um zip —
    // ponytail: zipar exigiria dependência nova dos dois lados para poupar uma
    // ida-e-volta de arquivo estático.
    const caminho = arquivoDe(params.data.id, query.data.parte)
    if (!(await existe(caminho))) return reply.code(404).send({ error: 'replay não encontrado' })

    return reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename="${params.data.id}.${query.data.parte}"`)
      .send(createReadStream(caminho))
  })

  /**
   * Estatísticas por jogador, **não-autoritativas**. Só o cliente tem
   * `TKMHandStats`, então o detalhamento só pode vir dele — e por isso ele
   * entra numa coluna que não alimenta nada: nem resultado, nem rating, nem
   * validade da partida. Quem quiser exibir isso na tela exibe como "relatado
   * pelo jogador", porque é o que é.
   */
  app.post('/matches/:id/stats', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'id inválido' })

    const corpo = statsSchema.safeParse(request.body)
    if (!corpo.success) {
      return reply.code(400).send({ error: corpo.error.issues[0]?.message ?? 'estatísticas inválidas' })
    }

    const eu = await jogadores().findOne({
      where: { matchId: params.data.id, accountId: request.account.id },
    })
    if (!eu) return reply.code(404).send({ error: 'partida não encontrada' })

    // Cada um sobrescreve só a própria linha, e só esta coluna. Reenvio
    // substitui em vez de acumular: o cliente manda o total da partida, não
    // um incremento.
    await jogadores().update({ matchId: eu.matchId, handIndex: eu.handIndex }, { statsJson: corpo.data })

    return { ok: true }
  })
}
