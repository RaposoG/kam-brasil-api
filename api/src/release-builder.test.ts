// O que estes testes protegem, os dois na montagem do `assets.zip` (sprites,
// som, musica e paletas que a release passou a entregar prontos):
//
// 1. **Caminho de zip que sai do destino.** O `unzip` recusa por conta propria,
//    mas em silencio: pula a entrada, avisa no stderr e sai com codigo 0. A
//    release sairia sem o arquivo e ninguem saberia. A conferencia previa e o
//    que transforma isso em erro — mesmo papel do `enclosed_name()` no
//    launcher (`src-tauri/src/install.rs`).
// 2. **`run()` devolvendo stdout sem travar.** A listagem do zip tem centenas
//    de linhas. Ler o pipe so DEPOIS do `await proc.exited` trava para sempre
//    quando a saida enche o buffer do sistema (uns 64 KB): o filho fica
//    esperando alguem consumir, e o `exited` nunca resolve. Como o `run()` e o
//    mesmo que monta o `full.zip` em routes/client.ts, um travamento aqui
//    pendura a publicacao inteira.

import { expect, test } from 'bun:test'

// Importar release-builder.ts puxa config.ts, que valida o ambiente na carga do
// modulo. `??=` e nao `=`: `bun test` roda tudo num processo so e outro arquivo
// pode ter chegado antes. Os valores nao importam aqui — nada do que se testa
// abaixo le config.
process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const { entradaDeZipInsegura, run } = await import('./release-builder.ts')
const { isExcluded } = await import('./routes/client.ts')

test('entrada de zip que sai do destino e reprovada', () => {
  const inseguras = [
    '../fora.txt',
    'data/../../fora.txt',
    'data/Sprites/../../../etc/passwd',
    '..',
    '/etc/passwd',
    '//servidor/compartilhado/fora.txt',
    'C:/Windows/System32/drivers/etc/hosts',
    'c:fora.txt',
    '..\\fora.txt',
    'data\\..\\..\\fora.txt',
  ]

  for (const nome of inseguras) {
    expect(entradaDeZipInsegura(nome)).toBe(true)
  }
})

test('os caminhos de verdade do assets.zip passam', () => {
  const legitimas = [
    'data/Sprites/',
    'data/Sprites/Houses.rxx',
    'data/Sprites/Trees.rxa',
    'data/Sprites/GUIMain_a.rxx',
    'data/sfx/sounds.dat',
    'data/sfx/speech.eng/crossbowman/0.wav',
    'data/gfx/pal0.bbm',
    'Music/Track 1.mp3',
    // Ponto no nome nao e travessia: `..` so vale como componente inteiro, e
    // reprovar isto tiraria arquivo legitimo da release em silencio.
    'Music/faixa..final.ogg',
    'data/sfx/..sobra/a.wav',
  ]

  for (const nome of legitimas) {
    expect(entradaDeZipInsegura(nome)).toBe(false)
  }
})

test('run devolve stdout inteiro mesmo maior que o buffer do pipe', async () => {
  // 200 KB: bem acima dos ~64 KB em que o pipe enche e o filho para de escrever.
  const script = 'process.stdout.write("x".repeat(200000))'
  const saida = await run(['bun', '-e', script])

  expect(saida.length).toBe(200_000)
})

test('run estoura com a mensagem do comando quando ele falha', async () => {
  const script = 'process.stderr.write("deu ruim"); process.exit(3)'

  expect(run(['bun', '-e', script])).rejects.toThrow(/falhou \(3\).*deu ruim/)
})

// Este teste mora aqui, e nao ao lado do routes/client.ts, de proposito: o que
// ele tranca e um ACORDO ENTRE OS DOIS ARQUIVOS. O release-builder poe sprites,
// som, musica e paletas na arvore; o `isExcluded` do client.ts decide o que
// dessa arvore chega ao manifesto. Enquanto as duas listas discordarem, a
// release sai sem o conteudo e ninguem ve — o unico sintoma e o `skipped` da
// resposta deixar de ser zero, e isso ja escondeu arquivo sumindo em silencio
// neste projeto. Separar em dois arquivos deixaria alguem "consertar" um lado
// sem enxergar o outro.
test('o que o assets.zip traz chega ao manifesto — skipped continua zero', () => {
  const daRelease = [
    'data/Sprites/Houses.rxx',
    'data/Sprites/Trees.rxx',
    'data/Sprites/Units.rxx',
    'data/Sprites/GUI.rxx',
    'data/Sprites/GUIMain.rxx',
    'data/Sprites/Tileset.rxx',
    'data/Sprites/Custom.rxx',
    // A camada HD que ninguem gerava, e a razao de a comunidade reclamar de
    // sprite feio. Se ela for descartada aqui, o bug volta inteiro.
    'data/Sprites/Houses.rxa',
    'data/Sprites/Trees.rxa',
    'data/Sprites/Units_a.rxx',
    'data/sfx/sounds.dat',
    'data/sfx/speech.eng/crossbowman/0.wav',
    'data/gfx/pal0.bbm',
    'data/gfx/pal1.bbm',
    'data/gfx/setup.lbm',
    'Music/Track 1.mp3',
    'Music/menu.ogg',
    // O que ja vinha antes e nao pode ter sido derrubado junto.
    'KaM_Remake.exe',
    'data/defines/houses.dat',
    'data/defines/unit.dat',
    'data/locales.txt',
    'data/gfx/fonts/antiqua.fnt',
    'lib/vlc/libvlccore.dll',
    'Sounds/UI/ButtonClick.wav',
    'MapsMP/Arena/Arena.map',
    'Readme/Readme_pol.html',
    'Utils/RXXPacker/RXXPacker.exe',
  ]

  expect(daRelease.filter(isExcluded)).toEqual([])
})

test('lixo de build e estado local do jogador seguem fora', () => {
  const fora = [
    'logs/KaM 2026-08-25.log',
    'Saves/save1.sav',
    'SavesMP/save1.sav',
    'brasil/api/src/server.ts',
    '.git/HEAD',
    'kambrasil.json',
    'src/KM_Game.dcu',
    'src/KM_Game.o',
  ]

  for (const path of fora) expect(isExcluded(path)).toBe(true)
})
