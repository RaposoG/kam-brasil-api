import { createHash } from 'node:crypto'
import type { ArquivoMapa } from '../entities/map.ts'

/**
 * Regras do catálogo global de mapas: o que é uma pasta de mapa válida, de onde
 * sai o CRC, e como o cliente sabe com **uma** comparação que o catálogo mudou.
 *
 * Tudo aqui é função pura sobre bytes — nada de disco, nada de banco. É o que
 * permite testar o que dói (CRC errado, nome de arquivo que escapa da pasta)
 * com bytes conhecidos, sem subir nada.
 */

/** Erro de conteúdo do upload — vira 400, nunca 500. */
export class CatalogoInvalido extends Error {}

/**
 * Onde os mapas multiplayer moram dentro da pasta do jogo. Todo caminho do
 * catálogo começa aqui, e o launcher **exige** esse prefixo
 * (`mapas.rs: caminho_seguro`): é o que impede o catálogo de mandar o cliente
 * escrever — ou pior, apagar — arquivo em qualquer outro lugar do disco.
 */
export const PREFIXO = 'MapsMP'

/**
 * Teto do upload.
 *
 * O maior mapa do acervo tem 26 MB (CiW 2x2). O launcher já recusa pasta acima
 * de 32 MB (`admin.rs: LIMITE_BYTES`); a folga daqui cobre o cabeçalho de cada
 * parte do multipart, que não conta lá e contaria aqui — o sintoma seria um 413
 * sem explicação numa pasta que o launcher considerou dentro do limite.
 */
export const LIMITE_UPLOAD_BYTES = 40 * 1024 * 1024

/**
 * O que pode existir dentro de uma pasta de mapa. Levantado do acervo real
 * (211 mapas MP): mapa, missão, textos, script, tilesets e mídia de script.
 *
 * Lista de inclusão, não de exclusão: um `.exe` ou uma `.dll` que passasse
 * daqui seria distribuído a todos os jogadores pelo próprio launcher.
 */
const EXTENSOES = new Set(['dat', 'map', 'mi', 'txt', 'libx', 'script', 'tiles', 'wav', 'ogg', 'mp3', 'pdf'])

/**
 * O `.mi` é lido — é dele que sai o CRC — mas **não** é distribuído.
 *
 * Ele é cache, e carrega a revisão do jogo que o gerou: os mesmos bytes de mapa
 * dão `.mi` diferente em r16155 e em r16168 (conferido nas duas cópias da mesma
 * pasta nesta máquina). Distribuí-lo faria o jogo reescrevê-lo no primeiro
 * scan, o sha256 deixar de bater com o manifesto, e o launcher anunciar "mapas
 * desatualizados" para sempre. O jogo regenera o cache sozinho quando ele falta
 * (`KM_Maps.pas`: `SaveToFile(fDir + fName + '.mi')`).
 */
const EXTENSAO_CACHE = 'mi'

/**
 * Proibidos em nome de arquivo no Windows — e é lá que o launcher grava.
 *
 * Espaço não entra na lista de propósito: "A Clash of Kings" é nome de mapa de
 * verdade. Caractere de controle é barrado logo abaixo, fora da expressão.
 *
 * `#` e `%` não são proibidos pelo Windows: estão aqui porque este nome vira
 * **caminho no manifesto** e o caminho vira **URL** em `install.rs:
 * download_one` (`{baseUrl}/{path}`). O `#` corta a URL ali — "Rota#1" pede
 * `.../MapsMP/Rota` e leva 404 — e o `%` solto quebra o decode do caminho no
 * servidor. Nos dois casos o download falha, `mapas_sync` devolve erro, e a
 * sincronia do catálogo inteiro para para TODOS os jogadores por causa do nome
 * de uma pasta. Barrar no upload é o único ponto em que isso ainda é um recado
 * para o admin, e não um mistério na máquina dos outros.
 */
const NOME_PROIBIDO = /[<>:"|?*\\/#%]/

/**
 * Um nome de arquivo ou de pasta seguro.
 *
 * O precedente é `install.rs`, que usa `enclosed_name()` do crate zip pelo mesmo
 * motivo: caminho com `..` ou raiz absoluta escreve fora da pasta de destino.
 * Aqui o servidor grava com estes nomes **e** o launcher também — então quem
 * recusa é este lado, antes de o caminho entrar no manifesto.
 */
export function nomeSeguro(nome: string): boolean {
  if (nome.length === 0 || nome.length > 120) return false
  if (nome === '.' || nome === '..') return false
  if (NOME_PROIBIDO.test(nome)) return false
  // Caractere de controle: uma quebra de linha no `filename` corta o cabeçalho
  // da parte do multipart, e nome cortado no meio vira mapa incompleto.
  for (const c of nome) if ((c.codePointAt(0) ?? 0) < 0x20) return false
  // O Windows corta ponto e espaço no fim do nome: "mapa ." vira "mapa", e dois
  // arquivos diferentes colidiriam num só no disco do jogador.
  if (nome !== nome.trim() || nome.endsWith('.')) return false
  return true
}

const extensaoDe = (nome: string) => (nome.includes('.') ? nome.slice(nome.lastIndexOf('.') + 1).toLowerCase() : '')

/** Uma parte de arquivo do upload: o `filename` do multipart e os bytes. */
export interface ArquivoEnviado {
  nome: string
  bytes: Uint8Array
}

/**
 * Descobre o nome do mapa pelo par `<X>.dat` + `<X>.map`.
 *
 * Existe porque o nome NÃO viaja no envio: o launcher manda os arquivos e os
 * campos de texto (`admin.rs: corpo_multipart`), e o nome da pasta fica só do
 * lado dele. Deduzir do conteúdo é melhor do que exigir que ele mande: é o
 * mesmo par que o jogo procura, então o nome sai batendo com a pasta por
 * construção, em vez de por alguém ter digitado igual.
 *
 * `null` quando não há exatamente um candidato — dois pares no mesmo envio
 * seriam dois mapas, e escolher um deles em silêncio publicaria o mapa errado.
 */
export function inferirNome(enviados: ArquivoEnviado[]): string | null {
  const bases = new Map<string, { nome: string; exts: Set<string> }>()

  for (const enviado of enviados) {
    const corte = enviado.nome.lastIndexOf('.')
    if (corte <= 0) continue
    const base = enviado.nome.slice(0, corte)
    const chave = base.toLowerCase()
    const alvo = bases.get(chave) ?? { nome: base, exts: new Set<string>() }
    alvo.exts.add(enviado.nome.slice(corte + 1).toLowerCase())
    bases.set(chave, alvo)
  }

  const candidatos = [...bases.values()].filter((b) => b.exts.has('dat') && b.exts.has('map'))
  return candidatos.length === 1 ? candidatos[0]!.nome : null
}

export interface PastaDeMapa {
  /** O nome do mapa, que é o nome da pasta. */
  nome: string
  /** Já com `MapsMP/<mapa>/` na frente, ordenados, e sem o `.mi`. */
  arquivos: { path: string; bytes: Uint8Array }[]
  /** Bytes do `.mi`, quando a pasta tinha um. É de onde sai o CRC. */
  mi: Uint8Array | null
  totalBytes: number
}

/**
 * Valida o que chegou no upload e devolve a pasta pronta para gravar.
 *
 * O nome do mapa é o nome da **pasta**, e o jogo procura o mapa exatamente por
 * ele (`TKMMapInfo.Create(nome, ...)`) — por isso ele não é um rótulo à parte
 * que pudesse divergir do conteúdo. Quando `informado` vem vazio (é o caso do
 * launcher, que não manda o nome), ele sai do próprio par `.dat` + `.map`.
 *
 * ponytail: só arquivos soltos, sem subpasta. É o que o launcher consegue
 * enviar (`admin.rs` recusa `/` no filename e não desce em subpasta) e cobre
 * 209 dos 211 mapas do acervo; os dois com `Scripts/` ficam de fora. Vira
 * caminho relativo de um nível no dia em que alguém precisar de um deles.
 */
export function montarPastaDeMapa(informado: string | null, enviados: ArquivoEnviado[]): PastaDeMapa {
  if (enviados.length === 0) throw new CatalogoInvalido('nenhum arquivo enviado')

  const nome = (informado ?? '').trim() || inferirNome(enviados)
  if (!nome) {
    throw new CatalogoInvalido(
      'não achei um par <mapa>.dat + <mapa>.map: envie a pasta de UM mapa, com os dois arquivos',
    )
  }
  if (!nomeSeguro(nome)) throw new CatalogoInvalido(`"${nome}" não serve como nome de pasta de mapa`)

  const arquivos: { path: string; bytes: Uint8Array }[] = []
  const vistos = new Set<string>()
  let mi: Uint8Array | null = null
  let totalBytes = 0

  for (const enviado of enviados) {
    if (!nomeSeguro(enviado.nome)) {
      throw new CatalogoInvalido(`nome de arquivo não aceito: "${enviado.nome}"`)
    }

    const ext = extensaoDe(enviado.nome)
    if (!EXTENSOES.has(ext)) {
      throw new CatalogoInvalido(`"${enviado.nome}" não é conteúdo de mapa (extensão .${ext || '?'} não aceita)`)
    }

    // O Windows não distingue caixa: "Mapa.dat" e "mapa.DAT" seriam o mesmo
    // arquivo no disco do jogador, com dois hashes no manifesto e um deles
    // eternamente "desatualizado".
    const chave = enviado.nome.toLowerCase()
    if (vistos.has(chave)) throw new CatalogoInvalido(`"${enviado.nome}" veio duas vezes no envio`)
    vistos.add(chave)

    totalBytes += enviado.bytes.length
    if (totalBytes > LIMITE_UPLOAD_BYTES) {
      throw new CatalogoInvalido(`a pasta passa de ${LIMITE_UPLOAD_BYTES} bytes`)
    }

    if (ext === EXTENSAO_CACHE) {
      if (chave === `${nome.toLowerCase()}.mi`) mi = enviado.bytes
      continue
    }

    arquivos.push({ path: `${PREFIXO}/${nome}/${enviado.nome}`, bytes: enviado.bytes })
  }

  // O par .dat + .map é o que faz o mapa existir para o jogo. Pasta com um só
  // dos dois é o pior caso conhecido (o mesmo que `install.rs` documenta): o
  // jogo entra na sala sem o mapa, tenta baixar do host, o servidor ranqueado
  // bloqueia o host, e a barra fica em 0 kb para sempre.
  for (const ext of ['dat', 'map']) {
    if (!vistos.has(`${nome.toLowerCase()}.${ext}`)) {
      throw new CatalogoInvalido(`isto não parece uma pasta de mapa — falta "${nome}.${ext}"`)
    }
  }

  arquivos.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { nome, arquivos, mi, totalBytes }
}

/**
 * O CRC que o jogo difunde no `mkMapSelect`, lido dos **primeiros 4 bytes** do
 * `.mi` (Cardinal little-endian).
 *
 * É o primeiro campo que `TKMMapInfo.SaveToFile` grava (`S.Write(fCRC)`,
 * KM_Maps.pas:776), e `fCRC` é exatamente o que `SendMapOrSave` manda
 * (KM_Networking.pas:543) e o que o servidor dedicado compara com a reserva
 * (`KM_NetServer.pas`, `RankedRelayAllowed`). Os 4 bytes seguintes são o
 * `fDatCRC` e os outros 4 o `fMapAndDatCRC` — nenhum dos dois casa sala.
 *
 * Ler daqui em vez de aceitar digitado é o ponto de tudo isto: CRC errado no
 * catálogo faz o servidor mandar um `mkMapSelect` que o cliente recusa, e o
 * jogador cai num download que nunca termina. Falha silenciosa, do lado dele.
 */
export function crcDoMi(mi: Uint8Array): string | null {
  if (mi.length < 4) return null
  const crc = new DataView(mi.buffer, mi.byteOffset, mi.byteLength).getUint32(0, true)
  return crc.toString(16).toUpperCase().padStart(8, '0')
}

/** Mesmo formato do resto do Pascal: hex maiúsculo de 8 dígitos. */
export function normalizarCrc(crc: string): string | null {
  const limpo = crc.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{1,8}$/.test(limpo)) return null
  return limpo.toUpperCase().padStart(8, '0')
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Assinatura do catálogo inteiro: um hash dos hashes.
 *
 * Com ela o launcher decide com uma comparação se precisa sequer olhar a lista
 * de arquivos, e o canal de tempo real difunde a mudança sem carregar o
 * catálogo junto (`ranked/tempo-real.ts`: `avisarCatalogoDeMapas`).
 *
 * Cobre nome, CRC e cada arquivo: renomear um mapa, corrigir um CRC ou trocar
 * um byte de qualquer arquivo muda a assinatura. Ela também vai na URL de
 * download — ver `baseUrl` em routes/mapas.ts.
 */
export function assinaturaDoCatalogo(
  mapas: { nome: string; mapCrc: string; arquivos: ArquivoMapa[] }[],
): string {
  const hash = createHash('sha256')
  for (const mapa of [...mapas].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))) {
    hash.update(`${mapa.nome}\n${mapa.mapCrc}\n`)
    for (const arquivo of [...mapa.arquivos].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      hash.update(`${arquivo.path}\t${arquivo.sha256}\t${arquivo.size}\n`)
    }
  }
  return hash.digest('hex')
}
