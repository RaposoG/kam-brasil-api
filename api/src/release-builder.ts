import { mkdir, rm, stat } from 'node:fs/promises'
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
  ['Docs/Readme', 'Readme'],
]

const FROM_GAME_FILES = [
  'bass.dll',
  'ogg.dll',
  'vorbis.dll',
  'vorbisfile.dll',
  'libzplay.dll',
  'LICENSE.txt',
  'Changelog.txt',
]

/**
 * De `data/defines` vão só os arquivos do projeto. `houses.dat` e `unit.dat`
 * são do Knights and Merchants original e são gerados na máquina do jogador.
 */
const FROM_GAME_DEFINES = ['mapelem.dat', 'tiles.json', 'interp.dat']

const FROM_MAPS = ['Maps', 'MapsMP', 'Campaigns', 'Tutorials']

/** Sprites da comunidade que o RXXPacker consome, por índice de RX. */
const SPRITE_FOLDERS = ['2', '3', '4', '5', '7']

/** Binários vindos dos anexos da GitHub Release, e onde ficam na árvore. */
const BINARIES: [string, string][] = [
  ['KaM_Remake.exe', 'KaM_Remake.exe'],
  ['RXXPacker.exe', 'Utils/RXXPacker/RXXPacker.exe'],
]

export type Progress = (message: string) => void

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function run(cmd: string[], cwd?: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} falhou (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`)
  }
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
  await Bun.write(dest, await response.arrayBuffer())
}

/**
 * Monta a árvore completa e devolve o caminho.
 *
 * O que **não** entra: sprites, sons, músicas e os `.dat` de unidades e casas.
 * Vêm do jogo original e são gerados na máquina do jogador.
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

  // Uma montagem errada falha em silencio: a release sairia sem o jogo dentro.
  // Conferir o essencial transforma isso em erro.
  const required = ['KaM_Remake.exe', 'Utils/RXXPacker/RXXPacker.exe', 'data/text', 'Maps', 'SpriteResource/7']
  const missing: string[] = []
  for (const path of required) if (!(await exists(join(out, path)))) missing.push(path)
  if (missing.length > 0) {
    throw new Error(`montagem incompleta, faltou: ${missing.join(', ')}`)
  }

  return out
}
