import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.ts'
import { maps, matches } from '../data-source.ts'
import type { ArquivoMapa, GameMap, RankedMode } from '../entities/map.ts'
import {
  CatalogoInvalido,
  LIMITE_UPLOAD_BYTES,
  PREFIXO,
  assinaturaDoCatalogo,
  crcDoMi,
  montarPastaDeMapa,
  nomeSeguro,
  normalizarCrc,
  sha256Hex,
} from '../mapas/catalogo.ts'
import { avisarCatalogoDeMapas } from '../ranked/tempo-real.ts'
import { requireAdmin } from './admin.ts'
import { lerMultipart } from './replay.ts'

/**
 * Catálogo global de mapas: o admin sobe uma pasta de mapa, e todo jogador a
 * recebe sem release nova do jogo.
 *
 * Antes disto os mapas só chegavam dentro do pacote do cliente
 * (`release-builder.ts`), e acrescentar um exigia publicar uma release inteira.
 * Aqui os bytes ficam em disco, num volume próprio, e o launcher decide o que
 * baixar comparando sha256 (`launcher/src-tauri/src/mapas.rs`).
 *
 * O que o launcher espera, e por isso não muda sem mexer nos dois lados:
 * - `GET /catalog/mapas` devolve `{ baseUrl, mapas: [{ nome, arquivos }] }`;
 * - cada `path` começa em `MapsMP/` e a URL do arquivo é `{baseUrl}/{path}`.
 */

/**
 * Onde os arquivos moram: ao lado das releases, em pasta própria.
 *
 * ponytail: derivado de `RELEASES_DIR`, como o de replay, em vez de variável de
 * ambiente nova. Precisa ser volume no compose pelo mesmo motivo das releases —
 * sem ele um rebuild apaga o acervo inteiro do dono. Vira config própria no dia
 * em que alguém quiser mapas e releases em discos diferentes.
 */
function pastaPadrao(): string {
  return resolve(config.RELEASES_DIR, '..', 'mapas')
}

/** Só o que este arquivo usa — mesmo motivo do `RepoPartidas` de replay.ts. */
interface RepoMapas {
  find(opcoes: { where?: { ativo: boolean }; order?: { nome: 'ASC' } }): Promise<GameMap[]>
  findOne(opcoes: { where: { id: string } | { nome: string } | { mapCrc: string } }): Promise<GameMap | null>
  save(valor: Partial<GameMap>): Promise<GameMap>
  update(criterio: { id: string }, patch: Partial<GameMap>): Promise<unknown>
  delete(criterio: { id: string }): Promise<unknown>
}

interface RepoPartidas {
  countBy(criterio: { mapId: string }): Promise<number>
}

export type OpcoesMapas = {
  /**
   * Injetados pelo teste. Não é `mock.module` de propósito: no `bun test` todos
   * os arquivos dividem o mesmo registro de módulos e só o **primeiro** mock de
   * um módulo vale no processo inteiro — ver o comentário de `OpcoesReplay`.
   */
  mapas?: () => RepoMapas
  partidas?: () => RepoPartidas
  pasta?: string
  avisar?: (assinatura: string) => void
}

const MODOS: readonly RankedMode[] = ['1v1', '2v2', '3v3', '4v4']

const idParam = z.object({ id: z.uuid() })

const edicaoBody = z.object({
  nome: z.string().min(1).max(120).optional(),
  modos: z.array(z.enum(['1v1', '2v2', '3v3', '4v4'])).optional(),
  ativo: z.boolean().optional(),
})

/**
 * `modos` chega como texto porque o launcher manda um mapa de strings
 * (`admin.rs: campos: BTreeMap<String, String>`). Aceita JSON (`["1v1"]`) e
 * lista separada por vírgula — a tela que escolher, e nenhuma das duas é
 * ambígua. `null` = veio coisa que não é modo.
 */
function lerModos(bruto: string | null): RankedMode[] | null {
  const texto = (bruto ?? '').trim()
  if (texto === '') return []

  let lista: unknown[]
  if (texto.startsWith('[')) {
    try {
      lista = JSON.parse(texto)
    } catch {
      return null
    }
    if (!Array.isArray(lista)) return null
  } else {
    lista = texto.split(',')
  }

  const limpos = lista.map((m) => String(m).trim()).filter(Boolean)
  if (!limpos.every((m) => (MODOS as readonly string[]).includes(m))) return null
  return [...new Set(limpos)] as RankedMode[]
}

/** O que `lerMultipart` devolve quando dá certo. */
type Formulario = NonNullable<Awaited<ReturnType<typeof lerMultipart>>>

const campoTexto = (form: Formulario, nome: string): string | null => {
  const valor = form.get(nome)
  return typeof valor === 'string' ? valor : null
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho)
    return true
  } catch {
    return false
  }
}

export default async function mapasRoutes(app: FastifyInstance, opcoes: OpcoesMapas = {}) {
  const repo = opcoes.mapas ?? maps
  const partidas = opcoes.partidas ?? matches
  const pasta = opcoes.pasta ?? pastaPadrao()
  const avisar = opcoes.avisar ?? avisarCatalogoDeMapas

  /** `MapsMP/Arena/Arena.dat` → caminho em disco, ou `null` se o caminho é torto. */
  function noDisco(path: string): string | null {
    const partes = path.split('/')
    if (partes.length < 3 || partes[0] !== PREFIXO || !partes.every(nomeSeguro)) return null

    const caminho = join(pasta, ...partes)
    // Cinto e suspensório: `nomeSeguro` já recusa `..` e separador, mas quem
    // grava e quem apaga arquivo confere o resultado, não a intenção.
    return resolve(caminho).startsWith(resolve(pasta) + sep) ? caminho : null
  }

  const pastaDoMapa = (nome: string) => (nomeSeguro(nome) ? join(pasta, PREFIXO, nome) : null)

  /** Os mapas que o launcher deve ter: ativos e com arquivos. */
  async function catalogo(): Promise<GameMap[]> {
    const linhas = await repo().find({ where: { ativo: true }, order: { nome: 'ASC' } })
    return linhas.filter((m) => (m.arquivos?.length ?? 0) > 0)
  }

  /**
   * Recalcula a assinatura e avisa quem estiver com o launcher aberto.
   *
   * Chamado também no `onReady`, e não só nas mudanças: quem estava offline
   * quando o admin mexeu no catálogo precisa receber o aviso ao conectar, e é o
   * `avisarCatalogoDeMapas` que guarda a última assinatura para isso.
   */
  async function republicar(): Promise<string> {
    const assinatura = assinaturaDoCatalogo(await catalogo())
    avisar(assinatura)
    return assinatura
  }

  /**
   * Resposta de erro daqui não pode ser cacheada.
   *
   * O hook de `/downloads/` em server.ts marca TUDO que sai com aquele prefixo
   * como `immutable` por um ano — inclusive um 404. Um jogador que sincronize no
   * meio de um upload pediria um arquivo que ainda não existe, e o CDN guardaria
   * o 404 no lugar dele: o mapa ficaria inalcançável muito depois de estar em
   * disco, e o sintoma seria uma sincronia que nunca completa. Este hook roda
   * depois do da raiz (ordem de registro) e é encapsulado neste plugin.
   */
  app.addHook('onSend', async (_request, reply) => {
    if (reply.statusCode >= 400) reply.header('cache-control', 'no-store')
  })

  app.addHook('onReady', async () => {
    try {
      await republicar()
    } catch (error) {
      // Não derruba a subida: catálogo é conteúdo, e uma API de pé sem aviso de
      // mapas é muito melhor do que uma API que não sobe.
      app.log.error({ error }, 'não foi possível publicar a assinatura inicial do catálogo de mapas')
    }
  })

  // ---------- Painel ----------

  await app.register(async (admin) => {
    // Hooks do escopo, e não opção por rota: rota nova aqui dentro nasce
    // protegida. Mesmo raciocínio de routes/admin.ts.
    admin.addHook('onRequest', admin.authenticate)
    admin.addHook('onRequest', requireAdmin)

    /**
     * O Fastify só entrega o corpo cru; quem parseia é `lerMultipart`. Fica
     * neste escopo de propósito — a raiz recusa qualquer Content-Type que não
     * seja JSON (`server.ts`), e esse parser não pode vazar para as outras rotas.
     */
    admin.addContentTypeParser('multipart/form-data', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body)
    })

    /**
     * Sobe (ou atualiza) um mapa do catálogo.
     *
     * Formato: a parte `arquivos` repetida — uma por arquivo da pasta, com
     * `filename` —, mais os campos de texto `modos`, `ativo`, `mapCrc` e `nome`,
     * todos opcionais. É o que o launcher monta em `admin.rs: corpo_multipart`.
     *
     * `nome` é opcional porque o launcher não o manda: ele fica do lado de lá,
     * como nome da pasta escolhida. Sem ele, o nome sai do par `<X>.dat` +
     * `<X>.map` do próprio envio — o mesmo par que o jogo procura, então a
     * pasta no cliente nasce com o nome certo por construção.
     */
    admin.post('/admin/maps/upload', { bodyLimit: LIMITE_UPLOAD_BYTES }, async (request, reply) => {
      const bruto = request.body
      if (!Buffer.isBuffer(bruto)) {
        return reply.code(415).send({ error: 'envie multipart/form-data com a pasta do mapa' })
      }

      const form = await lerMultipart(bruto, request.headers['content-type'] ?? '')
      if (!form) return reply.code(400).send({ error: 'multipart malformado' })

      const modos = lerModos(campoTexto(form, 'modos'))
      if (!modos) return reply.code(400).send({ error: 'modos inválidos: use 1v1, 2v2, 3v3 ou 4v4' })

      // Ausente = ativo. Subir um mapa é querer publicá-lo; desativar é um ato
      // separado, e quem manda `ativo=false` está dizendo isso de propósito.
      const ativo = (campoTexto(form, 'ativo') ?? 'true').trim().toLowerCase() !== 'false'

      const enviados: { nome: string; bytes: Uint8Array }[] = []
      for (const campo of form.getAll('arquivos')) {
        // Parte sem `filename` chega como string — é campo de texto, não arquivo.
        if (typeof campo === 'string') continue
        enviados.push({ nome: campo.name, bytes: new Uint8Array(await campo.arrayBuffer()) })
      }

      let conteudo: ReturnType<typeof montarPastaDeMapa>
      try {
        conteudo = montarPastaDeMapa(campoTexto(form, 'nome'), enviados)
      } catch (error) {
        if (error instanceof CatalogoInvalido) return reply.code(400).send({ error: error.message })
        throw error
      }

      const nome = conteudo.nome

      // O CRC LIDO tem precedência sobre o digitado, sempre. Ver `crcDoMi`: é
      // este número que casa a sala, e digitá-lo errado manda o jogador para um
      // download que nunca termina.
      const lido = conteudo.mi ? crcDoMi(conteudo.mi) : null
      const digitadoBruto = campoTexto(form, 'mapCrc')
      const digitado = digitadoBruto ? normalizarCrc(digitadoBruto) : null
      if (digitadoBruto && !digitado) {
        return reply.code(400).send({ error: 'mapCrc deve ser hexadecimal de até 8 dígitos' })
      }

      const mapCrc = lido ?? digitado
      if (!mapCrc) {
        return reply.code(400).send({
          error: `a pasta não tem "${nome}.mi" e nenhum CRC foi informado — abra o mapa uma vez no jogo para o cache ser gerado, ou informe mapCrc`,
        })
      }

      const avisos: string[] = []
      if (!lido) {
        avisos.push(
          'não foi possível CONFERIR o CRC: a pasta não trouxe o cache .mi, então vale o que foi digitado. ' +
            'Se estiver errado, o servidor vai recusar o mapa na sala e o jogador cai num download que nunca termina.',
        )
      } else if (digitado && digitado !== lido) {
        avisos.push(`o CRC informado (${digitado}) não é o do arquivo (${lido}); vale o do arquivo`)
      }

      // Colisão de CRC conferida aqui, e não só pelo índice único, porque o
      // 409 tem que vir ANTES de mexer nos arquivos em disco.
      const donoDoCrc = await repo().findOne({ where: { mapCrc } })
      const existente = await repo().findOne({ where: { nome } })
      if (donoDoCrc && donoDoCrc.id !== existente?.id) {
        return reply.code(409).send({ error: `o CRC ${mapCrc} já é do mapa "${donoDoCrc.nome}"` })
      }

      const destino = pastaDoMapa(nome)
      if (!destino) return reply.code(400).send({ error: `"${nome}" não serve como nome de pasta` })
      await mkdir(destino, { recursive: true })

      const arquivos: ArquivoMapa[] = []
      for (const arquivo of conteudo.arquivos) {
        const caminho = noDisco(arquivo.path)
        if (!caminho) return reply.code(400).send({ error: `caminho recusado: ${arquivo.path}` })
        await writeFile(caminho, arquivo.bytes)
        arquivos.push({ path: arquivo.path, sha256: sha256Hex(arquivo.bytes), size: arquivo.bytes.length })
      }

      // Fotografado ANTES do save: com o TypeORM `existente` é um objeto solto,
      // mas depender disso para saber o que apagar é a diferença entre a faxina
      // acontecer e não acontecer — e o sintoma seria arquivo órfão servido para
      // sempre, que ninguém procura.
      const anteriores = existente?.arquivos ?? []

      // ponytail: grava os arquivos antes da linha. Uma falha entre os dois
      // deixa arquivo a mais em disco (inofensivo, o manifesto não o cita) em
      // vez de linha apontando para arquivo que não existe — que viraria 404 em
      // download e sincronia travada. A ordem inversa é que seria o problema.
      const map = await repo().save({
        ...(existente ? { id: existente.id } : {}),
        nome,
        mapCrc,
        // Não zera os modos de um mapa já cadastrado quando o envio não os traz.
        modos: modos.length > 0 ? modos : (existente?.modos ?? []),
        ativo,
        arquivos,
        crcVerificado: lido !== null,
      })

      // Faxina do que saiu da pasta nesta versão: arquivo órfão continuaria
      // sendo servido e ocupando disco para sempre.
      const atuais = new Set(arquivos.map((a) => a.path))
      for (const antigo of anteriores) {
        if (atuais.has(antigo.path)) continue
        const caminho = noDisco(antigo.path)
        if (caminho) await rm(caminho, { force: true })
      }

      const assinatura = await republicar()
      request.log.info({ mapa: nome, mapCrc, arquivos: arquivos.length, crcVerificado: lido !== null }, 'catálogo de mapas atualizado')

      return reply.code(existente ? 200 : 201).send({
        map,
        arquivos: arquivos.length,
        bytes: conteudo.totalBytes,
        crcVerificado: lido !== null,
        avisos,
        assinatura,
      })
    })

    /**
     * Edita o que dá para editar sem mexer nos bytes: modos e ativo/inativo.
     *
     * Fora do task original, mas a tela já chama (`AdminMapas.vue`: alternar
     * ativo e trocar modos) e `ativo` decide o que o catálogo distribui — sem
     * isto o botão de desativar não faz nada. Mora aqui, e não em
     * routes/admin.ts, porque é o `republicar()` que dá sentido a ele.
     *
     * `nome` só muda em mapa SEM arquivos: o nome é o nome da pasta, e renomear
     * um mapa distribuído significaria mover a pasta em disco e reescrever todo
     * caminho do manifesto. Quem quer renomear reenvia a pasta com o nome novo,
     * que é uma operação que já existe e já funciona.
     */
    admin.put('/admin/maps/:id', async (request, reply) => {
      const parsedId = idParam.safeParse(request.params)
      if (!parsedId.success) return reply.code(400).send({ error: 'id inválido' })

      const parsed = edicaoBody.safeParse(request.body ?? {})
      if (!parsed.success) {
        return reply.code(400).send({ error: 'dados inválidos', issues: z.treeifyError(parsed.error) })
      }

      const mapa = await repo().findOne({ where: { id: parsedId.data.id } })
      if (!mapa) return reply.code(404).send({ error: 'mapa não encontrado' })

      const { nome, modos, ativo } = parsed.data
      if (nome !== undefined && nome !== mapa.nome) {
        if (mapa.arquivos.length > 0) {
          return reply.code(409).send({
            error: 'o nome de um mapa com arquivos é o nome da pasta: reenvie a pasta com o nome novo',
          })
        }
        if (!nomeSeguro(nome)) return reply.code(400).send({ error: `"${nome}" não serve como nome de pasta` })
      }

      await repo().update(
        { id: mapa.id },
        {
          ...(nome === undefined ? {} : { nome }),
          ...(modos === undefined ? {} : { modos }),
          ...(ativo === undefined ? {} : { ativo }),
        },
      )

      const assinatura = await republicar()
      return { map: { ...mapa, nome: nome ?? mapa.nome, modos: modos ?? mapa.modos, ativo: ativo ?? mapa.ativo }, assinatura }
    })

    /**
     * Tira o mapa do catálogo.
     *
     * Se ele já apareceu em partida, a linha fica: `matches.mapId` é
     * `on delete set null`, e apagar levaria junto o nome do mapa do histórico
     * de quem jogou. Inativo some do manifesto do mesmo jeito, e o launcher
     * apaga a pasta no cliente — que é o que o admin pediu.
     */
    admin.delete('/admin/maps/:id', async (request, reply) => {
      const parsed = idParam.safeParse(request.params)
      if (!parsed.success) return reply.code(400).send({ error: 'id inválido' })

      const mapa = await repo().findOne({ where: { id: parsed.data.id } })
      if (!mapa) return reply.code(404).send({ error: 'mapa não encontrado' })

      const emPartidas = await partidas().countBy({ mapId: mapa.id })
      if (emPartidas > 0) {
        await repo().update({ id: mapa.id }, { ativo: false, arquivos: [] })
      } else {
        await repo().delete({ id: mapa.id })
      }

      const destino = pastaDoMapa(mapa.nome)
      if (destino) await rm(destino, { recursive: true, force: true })

      const assinatura = await republicar()
      return { ok: true, historico: emPartidas > 0, partidas: emPartidas, assinatura }
    })
  })

  // ---------- Cliente ----------

  /**
   * O manifesto que o launcher lê para decidir o que baixar, atualizar e apagar.
   *
   * Aberto, como o download: mapa não é segredo, os bytes já saem por
   * `/downloads/` sem token, e exigir sessão aqui só faria a sincronia depender
   * de o jogador estar logado — ela roda antes disso.
   *
   * A `assinatura` na `baseUrl` não é enfeite. O hook de `/downloads/` marca
   * tudo como `immutable` por um ano, e isso só é verdade quando a URL muda
   * junto com o conteúdo: sem ela, um mapa CORRIGIDO continuaria sendo servido
   * pelo CDN com os bytes velhos, o sha256 nunca bateria e a sincronia
   * repetiria o download para sempre. Com ela, cada versão do catálogo tem
   * espaço de URL próprio — o mesmo raciocínio da pasta por versão da release.
   */
  app.get('/catalog/mapas', async (request) => {
    const lista = await catalogo()
    const assinatura = assinaturaDoCatalogo(lista)

    return {
      assinatura,
      baseUrl: `${request.protocol}://${request.host}/downloads/mapas/${assinatura}`,
      mapas: lista.map((m) => ({
        id: m.id,
        nome: m.nome,
        mapCrc: m.mapCrc,
        modos: m.modos,
        crcVerificado: m.crcVerificado,
        arquivos: m.arquivos,
      })),
    }
  })

  /**
   * Os bytes. A assinatura da URL é ignorada de propósito: ela existe para
   * separar os caches, não para achar o arquivo — um cliente que ainda esteja
   * com um manifesto anterior recebe o conteúdo atual, confere o sha256, não
   * bate, e busca o manifesto novo. Que é o comportamento certo.
   */
  app.get('/downloads/mapas/:assinatura/*', async (request, reply) => {
    const caminho = noDisco((request.params as Record<string, string>)['*'] ?? '')
    if (!caminho || !(await existe(caminho))) {
      return reply.code(404).send({ error: 'arquivo não encontrado' })
    }

    // O hook de `/downloads/` em server.ts já força octet-stream e cache
    // imutável; aqui é para a rota também estar certa fora dele.
    return reply.type('application/octet-stream').send(createReadStream(caminho))
  })
}
