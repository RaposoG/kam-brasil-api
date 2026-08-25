import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.ts'

/**
 * Monta a árvore de uma release no próprio servidor.
 *
 * O que muda a cada build são os binários — uns 26 MB. Mapas e campanhas são
 * 417 MB e **nunca mudam por causa de um build**: vêm do upstream da
 * comunidade. Fazer o publicador enviar tudo a cada versão seria pagar meio
 * giga para trocar 26 MB.
 *
 * Então a API busca cada parte da sua fonte natural:
 *
 * | Parte | Origem |
 * |---|---|
 * | `KaM_Remake.exe`, `RXXPacker.exe` | anexos de uma GitHub Release |
 * | sprites, som, música, paletas | anexo `assets.zip` da mesma Release |
 * | textos, fontes, cursores, DLLs | repositório do jogo |
 * | mapas, campanhas, tutoriais | `reyandme/kam_remake_maps` |
 * | sprites da comunidade | `reyandme/kam_remake_resources` |
 *
 * Os clones ficam em cache num volume: da segunda release em diante é `fetch`,
 * não clone. E são rasos (`--depth 1`) — o histórico do KaM sozinho tem 16 mil
 * commits que não servem para nada aqui.
 *
 * Efeito colateral bem-vindo: quando a comunidade publica mapas novos no
 * upstream, a próxima release os inclui sem ninguém fazer nada.
 */

interface Source {
  name: string
  url: string
}

const SOURCES: Record<string, Source> = {
  game: { name: 'game', url: 'https://github.com/RaposoG/kam_brasil.git' },
  maps: { name: 'maps', url: 'https://github.com/reyandme/kam_remake_maps.git' },
  resources: { name: 'resources', url: 'https://github.com/reyandme/kam_remake_resources.git' },
}

/** Do repositório do jogo: [origem, destino na release]. */
const FROM_GAME_DIRS: [string, string][] = [
  ['data/text', 'data/text'],
  ['data/gfx/fonts', 'data/gfx/fonts'],
  ['data/cursors', 'data/cursors'],
  // O engine carrega `lib\vlc\libvlccore.dll` por caminho fixo (KM_VLC.pas:10)
  // e aborta a abertura sem ele. É a biblioteca dos vídeos de campanha.
  ['lib/vlc', 'lib/vlc'],
  // Efeitos de interface que não vêm do jogo original: clique, chat, farol,
  // vitória, derrota (KM_ResSound.pas, NEW_SFX_FOLDER).
  ['Sounds', 'Sounds'],
  ['Docs/Readme', 'Readme'],
]

const FROM_GAME_FILES = [
  'bass.dll',
  'ogg.dll',
  'vorbis.dll',
  'vorbisfile.dll',
  'libzplay.dll',
  // Lido em KM_Resource.pas:212. Sem ele o jogo morre com EAssertionFailed
  // antes de desenhar qualquer coisa.
  'data/locales.txt',
  'LICENSE.txt',
  'Changelog.txt',
]

// houses.dat e unit.dat entram aqui desde que descobrimos que eram a causa dos
// desyncs: eles definem as regras de casas e unidades e alimentam o calculo
// deterministico da simulacao. Vindo da copia original de cada jogador, edicoes
// diferentes do KaM davam regras diferentes e as partidas divergiam no meio.
//
// Sao os do KaM Remake, que rebalanceou as tabelas -- diferentes das de 1998.
const FROM_GAME_DEFINES = ['mapelem.dat', 'tiles.json', 'interp.dat', 'houses.dat', 'unit.dat']

const FROM_MAPS = ['Maps', 'MapsMP', 'Campaigns', 'Tutorials']

/** Sprites da comunidade que o RXXPacker consome, por índice de RX. */
const SPRITE_FOLDERS = ['2', '3', '4', '5', '7']

/** Binários vindos dos anexos da GitHub Release, e onde ficam na árvore. */
const BINARIES: [string, string][] = [
  ['KaM_Remake.exe', 'KaM_Remake.exe'],
  ['RXXPacker.exe', 'Utils/RXXPacker/RXXPacker.exe'],
]

/**
 * Anexo da mesma GitHub Release com sprites, som, música e paletas prontos —
 * `data/Sprites/`, `data/sfx/`, `Music/`, `data/gfx/` já na posição final.
 *
 * Isto existe porque o KaM Remake Beta nunca pediu o jogo original: ele **já
 * vem** com os sprites empacotados, e quem precisa do original é quem compila,
 * não quem joga. Nós fazíamos o contrário — cada jogador tinha que ter uma
 * cópia do KaM de 1998 e converter na própria máquina. Isso explicava as
 * reclamações todas de uma vez: sprites sem a camada HD (`.rxa`, que o engine
 * prefere com sombras alpha e que ninguém gerava), ícone da mina de ferro
 * errado, som e música diferentes de pessoa para pessoa.
 *
 * Anexo e não repositório: são centenas de MB de binário que mudam junto com o
 * executável, e git não serve para isso. Publicar continua sendo "anexe os
 * arquivos na Release, chame a rota" — sem passo manual novo no servidor.
 */
const ASSETS_ZIP = 'assets.zip'

export type Progress = (message: string) => void

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Roda um comando e devolve o que ele escreveu em stdout. */
export async function run(cmd: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  // Consumir os dois canais em paralelo com o `exited`, e nao depois dele: um
  // comando que enche o buffer do pipe fica bloqueado esperando alguem ler, e
  // o `await proc.exited` nunca voltaria. A listagem do zip tem centenas de
  // linhas e passa perto desse limite.
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    throw new Error(`${cmd.join(' ')} falhou (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`)
  }
  return out
}

/** Clona raso, ou atualiza se já existir. */
async function syncSource(source: Source, log: Progress): Promise<string> {
  const dir = join(config.SOURCES_DIR, source.name)

  if (await exists(join(dir, '.git'))) {
    log(`atualizando ${source.name}`)
    await run(['git', 'fetch', '--depth', '1', 'origin', 'HEAD'], dir)
    await run(['git', 'reset', '--hard', 'FETCH_HEAD'], dir)
    // Arquivos que sairam do upstream ficariam para tras sem isto.
    await run(['git', 'clean', '-fd'], dir)
  } else {
    log(`clonando ${source.name}`)
    await mkdir(config.SOURCES_DIR, { recursive: true })
    await run(['git', 'clone', '--depth', '1', source.url, dir])
  }

  return dir
}

async function copyDir(from: string, to: string, log: Progress) {
  if (!(await exists(from))) {
    log(`  aviso: nao encontrado, pulado: ${from}`)
    return
  }
  await mkdir(join(to, '..'), { recursive: true })
  await run(['cp', '-r', from, to])
}

async function copyFile(from: string, to: string, log: Progress) {
  if (!(await exists(from))) {
    log(`  aviso: nao encontrado, pulado: ${from}`)
    return
  }
  await mkdir(join(to, '..'), { recursive: true })
  await Bun.write(to, Bun.file(from))
}

/** Baixa um anexo de release do GitHub. */
async function downloadAsset(tag: string, asset: string, dest: string, log: Progress) {
  const url = `https://github.com/${config.BINARIES_REPO}/releases/download/${tag}/${asset}`
  log(`baixando ${asset}`)

  const headers: Record<string, string> = {}
  // Repositorio privado precisa de token; publico funciona sem.
  if (config.GITHUB_TOKEN) headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`

  const response = await fetch(url, { headers, redirect: 'follow' })
  if (!response.ok) {
    throw new Error(
      `nao foi possivel baixar ${asset} da release ${tag} de ${config.BINARIES_REPO} (${response.status}). ` +
        `Confira se a release existe e se o anexo tem exatamente esse nome.`,
    )
  }

  await mkdir(join(dest, '..'), { recursive: true })
  // A `Response` direto, e nao `await response.arrayBuffer()`: o assets.zip tem
  // centenas de MB e o arrayBuffer traria tudo para a memoria de uma vez.
  await Bun.write(dest, response)
}

/**
 * Entrada de zip que escaparia do diretório de destino.
 *
 * O `unzip` recusa isto por conta própria, mas **em silêncio**: ele pula a
 * entrada, avisa no stderr e sai com código 0 — a release sairia sem aquele
 * arquivo e ninguém ficaria sabendo. Conferir antes é o que transforma o
 * silêncio em erro. Mesmo motivo do `enclosed_name()` no launcher
 * (`src-tauri/src/install.rs`).
 *
 * Barra invertida também reprova: nenhum arquivo do jogo tem `\` no nome, e no
 * Linux o `unzip` a trataria como letra comum — `..\..\etc` viraria um arquivo
 * de nome esquisito em vez do que o zip pedia.
 */
export function entradaDeZipInsegura(nome: string): boolean {
  if (nome.startsWith('/')) return true // absoluto, e UNC `//servidor/...`
  if (/^[a-zA-Z]:/.test(nome)) return true // `C:\...`
  return nome.replace(/\\/g, '/').split('/').includes('..')
}

/**
 * Baixa o `assets.zip` da Release e o abre em cima da árvore.
 *
 * Roda **depois** das cópias de propósito: `copyDir` usa `cp -r`, e `cp -r orig
 * dest` com `dest` já existente copia para *dentro* dele (viraria
 * `data/gfx/fonts/fonts`). O `unzip` não tem essa mania — funde com o que já
 * está lá —, então extrair por último é a ordem que não depende de sorte.
 */
async function extractAssets(tag: string, out: string, log: Progress) {
  const zipPath = join(config.SOURCES_DIR, '_assets.zip')
  await downloadAsset(tag, ASSETS_ZIP, zipPath, log)

  try {
    const entries = (await run(['unzip', '-Z1', zipPath])).split('\n').filter(Boolean)
    const inseguras = entries.filter(entradaDeZipInsegura)
    if (inseguras.length > 0) {
      throw new Error(`${ASSETS_ZIP} tem caminho que sai do destino: ${inseguras.slice(0, 5).join(', ')}`)
    }

    log(`extraindo ${ASSETS_ZIP} (${entries.length} entradas)`)
    await run(['unzip', '-q', '-o', zipPath, '-d', out])
  } finally {
    // Sao centenas de MB no volume de cache; publicar e raro, rebaixar e barato.
    await rm(zipPath, { force: true })
  }
}

/** Existe e tem algo dentro? */
async function naoVazia(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0
  } catch {
    return false
  }
}

/**
 * Monta a árvore completa e devolve o caminho.
 *
 * Sprites, som, música e paletas ENTRAM, prontos, vindos do `assets.zip`. O
 * jogador não precisa mais ter o Knights and Merchants de 1998 nem converter
 * nada na própria máquina — era de lá que vinham os sprites sem HD, o ícone
 * errado da mina de ferro e o som diferente para cada pessoa.
 *
 * Os `.dat` de casas e unidades ENTRAM pelo mesmo motivo de sempre: sao regras
 * de simulacao e precisam ser identicos para todos, senao as partidas
 * desincronizam.
 */
export async function buildReleaseTree(binariesTag: string, log: Progress): Promise<string> {
  const out = join(config.SOURCES_DIR, '_tree')
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })

  const game = await syncSource(SOURCES.game!, log)
  const maps = await syncSource(SOURCES.maps!, log)
  const resources = await syncSource(SOURCES.resources!, log)

  log('binarios')
  for (const [asset, target] of BINARIES) {
    await downloadAsset(binariesTag, asset, join(out, target), log)
  }

  log('dados do jogo')
  for (const file of FROM_GAME_FILES) await copyFile(join(game, file), join(out, file), log)
  for (const [from, to] of FROM_GAME_DIRS) await copyDir(join(game, from), join(out, to), log)
  for (const file of FROM_GAME_DEFINES) {
    await copyFile(join(game, 'data/defines', file), join(out, 'data/defines', file), log)
  }

  log('mapas e campanhas')
  for (const dir of FROM_MAPS) await copyDir(join(maps, dir), join(out, dir), log)

  log('sprites da comunidade')
  for (const folder of SPRITE_FOLDERS) {
    await copyDir(join(resources, 'SpriteResource', folder), join(out, 'SpriteResource', folder), log)
  }

  log('sprites, som, musica e paletas prontos')
  await extractAssets(binariesTag, out, log)

  // Uma montagem errada falha em silencio: a release sairia sem o jogo dentro,
  // e o jogador so descobriria ao abrir. Conferir transforma isso em erro aqui.
  //
  // A lista abaixo e o que o engine le por caminho fixo e sem o que ele nao
  // abre. Cada entrada esta aqui porque faltou de verdade em alguma montagem,
  // ou porque falta dela seria fatal do mesmo jeito. Ao incluir dados novos,
  // acrescente aqui tambem -- e o unico ponto que impede uma release quebrada
  // de chegar aos jogadores.
  const required = [
    'KaM_Remake.exe',
    'Utils/RXXPacker/RXXPacker.exe',
    'bass.dll',
    'data/text',
    'data/locales.txt', // KM_Resource.pas:212 — EAssertionFailed sem ele
    'data/defines/mapelem.dat',
    // Sem estes dois identicos para todos, as partidas desincronizam no meio.
    'data/defines/houses.dat',
    'data/defines/unit.dat',
    'data/cursors',
    'data/gfx/fonts',
    'lib/vlc/libvlccore.dll', // KM_VLC.pas:10 — VLC_PATH fixo
    'Sounds/UI/ButtonClick.wav', // KM_ResSound.pas — NEW_SFX_FOLDER
    'Maps',
    'MapsMP',
    'Campaigns',
    'SpriteResource/7',
    // Vindos do assets.zip. Antes desta lista, uma release sem eles era release
    // sem jogo dentro -- e so aparecia quando o jogador abria.
    //
    // Os `.rxx` sao a base obrigatoria: sem o arquivo, LoadSprites faz `Exit` e
    // aquele conjunto inteiro de sprites nao existe (KM_ResSprites.pas:2039).
    // O `_a.rxx` e o `.rxa` sao camadas preferidas quando ha sombras alpha, mas
    // caem de volta no `.rxx` — por isso nao entram aqui. `Custom` tambem nao:
    // e `ruCustom`, ninguem o carrega sozinho.
    'data/Sprites/Trees.rxx',
    'data/Sprites/Houses.rxx',
    'data/Sprites/Units.rxx',
    'data/Sprites/GUI.rxx',
    'data/Sprites/GUIMain.rxx',
    'data/Sprites/Tileset.rxx',
    'data/sfx/sounds.dat', // KM_ResSound.pas:319
    // Em runtime o engine carrega UMA paleta, e e esta (KM_Resource.pas:161).
    'data/gfx/pal0.bbm',
  ]

  // Pasta existir nao basta nestas duas: vazia e exatamente o que sobra quando
  // o conteudo nao entrou no zip, e o jogo abre mudo sem reclamar de nada.
  //
  // `speech.eng` e a fala de todo mundo, inclusive de quem joga em ptb:
  // TKMResSounds.Create monta "speech.<idioma>" com fallback do locales.txt
  // (KM_ResSound.pas:299) e ptb nao declara fallback -- cai em eng.
  const requiredNonEmpty = ['data/sfx/speech.eng', 'Music']

  const missing: string[] = []
  for (const path of required) if (!(await exists(join(out, path)))) missing.push(path)
  for (const path of requiredNonEmpty) if (!(await naoVazia(join(out, path)))) missing.push(`${path} (vazia)`)
  if (missing.length > 0) {
    throw new Error(`montagem incompleta, faltou: ${missing.join(', ')}`)
  }

  return out
}
