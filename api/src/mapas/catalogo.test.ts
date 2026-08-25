// O que este teste protege:
//
// 1. **O CRC sai dos 4 primeiros bytes do `.mi`, em little-endian.** É o número
//    que casa a sala: o servidor dedicado compara o `mkMapSelect` do host com o
//    CRC da reserva e recusa o que não bate. Ler errado aqui manda o jogador
//    para um download que nunca termina — e a falha é silenciosa, do lado dele.
//    Por isso os bytes do teste são os de um mapa real do acervo.
// 2. **Nome de arquivo é fronteira de confiança.** O caminho que sai daqui é
//    gravado em disco nos DOIS lados (API e launcher). `..`, barra e caractere
//    de controle não passam.
// 3. **O par .dat + .map é obrigatório**, e o `.mi` não é distribuído.
// 4. **A assinatura muda quando qualquer coisa muda** — é com uma comparação
//    dela que o cliente decide se precisa sincronizar.

import { expect, test } from 'bun:test'
import {
  CatalogoInvalido,
  PREFIXO,
  assinaturaDoCatalogo,
  crcDoMi,
  inferirNome,
  montarPastaDeMapa,
  nomeSeguro,
  normalizarCrc,
  sha256Hex,
} from './catalogo.ts'

const bytes = (...b: number[]) => new Uint8Array(b)

/** Os 4 primeiros bytes do `.mi` de "A Clash of Kings" nesta máquina. */
const MI_REAL = bytes(0x74, 0x96, 0x05, 0x80, 0xc7, 0x4c, 0xaa, 0xdd)

const DAT = bytes(1, 2, 3)
const MAP = bytes(4, 5, 6, 7)

function pasta(nome: string, extras: { nome: string; bytes: Uint8Array }[] = []) {
  return montarPastaDeMapa(nome, [
    { nome: `${nome}.dat`, bytes: DAT },
    { nome: `${nome}.map`, bytes: MAP },
    ...extras,
  ])
}

test('o CRC são os 4 primeiros bytes do .mi, Cardinal little-endian', () => {
  // 74 96 05 80 lidos em little-endian = 0x80059674.
  expect(crcDoMi(MI_REAL)).toBe('80059674')
  // Padding de 8 dígitos: o resto do Pascal escreve IntToHex(x, 8).
  expect(crcDoMi(bytes(0x01, 0x00, 0x00, 0x00))).toBe('00000001')
  expect(crcDoMi(bytes(0, 0, 0, 0))).toBe('00000000')
  expect(crcDoMi(bytes(0xff, 0xff, 0xff, 0xff))).toBe('FFFFFFFF')
  // Cache truncado não vira CRC inventado: sem número, quem chama avisa.
  expect(crcDoMi(bytes(1, 2, 3))).toBeNull()
})

test('CRC digitado é normalizado, e lixo é recusado', () => {
  expect(normalizarCrc(' a1b2c3d4 ')).toBe('A1B2C3D4')
  expect(normalizarCrc('0x1f')).toBe('0000001F')
  expect(normalizarCrc('zzz')).toBeNull()
  expect(normalizarCrc('123456789')).toBeNull()
  expect(normalizarCrc('')).toBeNull()
})

test('nome com escape, separador ou controle não passa', () => {
  expect(nomeSeguro('A Clash of Kings')).toBe(true)
  expect(nomeSeguro("A Midwinter's Day.dat")).toBe(true)

  for (const torto of ['..', '.', '../fora', 'a/b', 'a\\b', 'C:', 'a<b', 'a|b', 'a\nb', '', 'termina.', 'espaço ']) {
    expect(`${JSON.stringify(torto)} -> ${nomeSeguro(torto)}`).toBe(`${JSON.stringify(torto)} -> false`)
  }

  // `#` e `%` são legais no Windows e mesmo assim entram na lista: este nome
  // vira caminho no manifesto e o caminho vira URL de download. Conferido com
  // a mesma normalização WHATWG que o reqwest aplica:
  //   new URL('http://api/x/Rota#1/Rota#1.dat').pathname === '/x/Rota'
  //   decodeURIComponent('/x/Vale%2050%/...')            -> URIError
  // Ou seja: um nome desses derruba a sincronia do catálogo INTEIRO, para
  // todos os jogadores, e o sintoma não aponta para o nome da pasta.
  for (const url of ['Rota#1', 'Vale 50%', 'a#b.dat', '100%.map']) {
    expect(`${JSON.stringify(url)} -> ${nomeSeguro(url)}`).toBe(`${JSON.stringify(url)} -> false`)
  }

  // Estes continuam passando: são literais em caminho de URL e existem em
  // nome de mapa de verdade.
  expect(nomeSeguro('Pão & Circo')).toBe(true)
  expect(nomeSeguro('Mapa+1')).toBe(true)
})

test('a pasta vira caminhos sob MapsMP, ordenados, e o .mi fica de fora', () => {
  const montada = pasta('Arena', [
    { nome: 'Arena.mi', bytes: MI_REAL },
    { nome: 'Arena.txt', bytes: bytes(8) },
  ])

  expect(montada.arquivos.map((a) => a.path)).toEqual([
    `${PREFIXO}/Arena/Arena.dat`,
    `${PREFIXO}/Arena/Arena.map`,
    `${PREFIXO}/Arena/Arena.txt`,
  ])
  // O `.mi` é lido (é dele que sai o CRC) mas não é distribuído: o jogo o
  // reescreve com a revisão dele, e o hash deixaria de bater para sempre.
  expect(montada.arquivos.some((a) => a.path.endsWith('.mi'))).toBe(false)
  expect(montada.mi).toEqual(MI_REAL)
  expect(montada.totalBytes).toBe(DAT.length + MAP.length + MI_REAL.length + 1)
})

test('o nome sai do par .dat + .map quando o envio não o traz', () => {
  // O launcher não manda o nome (`admin.rs` só manda arquivos e campos de
  // texto). Deduzir do par é o que faz a pasta no cliente nascer com o nome que
  // o jogo procura, sem depender de alguém digitar igual.
  const montada = montarPastaDeMapa(null, [
    { nome: 'A Clash of Kings.dat', bytes: DAT },
    { nome: 'A Clash of Kings.map', bytes: MAP },
    { nome: 'A Clash of Kings.mi', bytes: MI_REAL },
  ])
  expect(montada.nome).toBe('A Clash of Kings')
  expect(montada.arquivos[0]!.path).toBe(`${PREFIXO}/A Clash of Kings/A Clash of Kings.dat`)

  // Dois pares no mesmo envio são dois mapas: escolher um em silêncio
  // publicaria o mapa errado, com o nome do outro.
  expect(
    inferirNome([
      { nome: 'A.dat', bytes: DAT },
      { nome: 'A.map', bytes: MAP },
      { nome: 'B.dat', bytes: DAT },
      { nome: 'B.map', bytes: MAP },
    ]),
  ).toBeNull()
  expect(() => montarPastaDeMapa(null, [{ nome: 'A.dat', bytes: DAT }])).toThrow(CatalogoInvalido)
})

test('pasta sem o par .dat + .map não é mapa', () => {
  expect(() => montarPastaDeMapa('Arena', [{ nome: 'Arena.dat', bytes: DAT }])).toThrow(CatalogoInvalido)
  expect(() => montarPastaDeMapa('Arena', [{ nome: 'Arena.map', bytes: MAP }])).toThrow(CatalogoInvalido)
  // O par tem que ser do MAPA, não de qualquer arquivo com essas extensões.
  expect(() =>
    montarPastaDeMapa('Arena', [
      { nome: 'Outro.dat', bytes: DAT },
      { nome: 'Outro.map', bytes: MAP },
    ]),
  ).toThrow(CatalogoInvalido)
})

test('arquivo que não é conteúdo de mapa não entra no catálogo', () => {
  // O launcher grava e EXECUTA a pasta do jogo. Um .exe aqui viraria
  // distribuição de binário para todo mundo, assinada pelo painel.
  expect(() => pasta('Arena', [{ nome: 'jogo.exe', bytes: bytes(0x4d, 0x5a) }])).toThrow(CatalogoInvalido)
  expect(() => pasta('Arena', [{ nome: 'x.dll', bytes: bytes(1) }])).toThrow(CatalogoInvalido)
  expect(() => pasta('Arena', [{ nome: '../../fora.dat', bytes: DAT }])).toThrow(CatalogoInvalido)
})

test('o mesmo arquivo em duas caixas é recusado', () => {
  // No Windows os dois seriam o mesmo arquivo, com dois hashes no manifesto —
  // e um deles eternamente "desatualizado".
  expect(() => pasta('Arena', [{ nome: 'ARENA.DAT', bytes: bytes(9) }])).toThrow(CatalogoInvalido)
})

test('a assinatura muda com nome, CRC, caminho, hash ou tamanho', () => {
  const arquivo = { path: `${PREFIXO}/Arena/Arena.dat`, sha256: sha256Hex(DAT), size: DAT.length }
  const base = [{ nome: 'Arena', mapCrc: 'A1B2C3D4', arquivos: [arquivo] }]
  const assinatura = assinaturaDoCatalogo(base)

  // Estável: a ordem da lista não pode mexer na assinatura, senão o cliente
  // sincronizaria de novo a cada consulta.
  const outro = { nome: 'Bravo', mapCrc: '00000001', arquivos: [] }
  expect(assinaturaDoCatalogo([...base, outro])).toBe(assinaturaDoCatalogo([outro, ...base]))

  for (const mudado of [
    [{ ...base[0]!, nome: 'Arena 2' }],
    [{ ...base[0]!, mapCrc: 'A1B2C3D5' }],
    [{ ...base[0]!, arquivos: [{ ...arquivo, sha256: sha256Hex(MAP) }] }],
    [{ ...base[0]!, arquivos: [{ ...arquivo, size: 999 }] }],
    [{ ...base[0]!, arquivos: [{ ...arquivo, path: `${PREFIXO}/Arena/Arena.map` }] }],
    [{ ...base[0]!, arquivos: [] }],
  ]) {
    expect(assinaturaDoCatalogo(mudado)).not.toBe(assinatura)
  }
})
