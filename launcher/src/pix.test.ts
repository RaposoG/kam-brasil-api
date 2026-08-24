// É dinheiro: um payload errado significa doação que não chega, ou pior, que
// chega no lugar errado. Por isso o CRC e conferido contra o vetor canonico da
// variante, e nao so contra o que o nosso proprio codigo produz.

import { expect, test } from 'bun:test'
import { crc16, montarPix } from './pix'

/**
 * Vetor de verificação canônico do CRC16/CCITT-FALSE: a string "123456789"
 * produz 0x29B1. É o teste que toda implementação dessa variante deve passar.
 *
 * Uso este e não um payload Pix de exemplo de propósito: eu teria que copiar o
 * payload de algum lugar, e um caractere errado transformaria o teste numa
 * afirmação sobre a minha digitação em vez de sobre o algoritmo.
 */
test('CRC16 bate com o vetor canônico da variante CCITT-FALSE', () => {
  expect(crc16('123456789')).toBe('29B1')
})

test('o código carrega a chave, e a chave é a nossa', () => {
  const chave = '4fe5f6a8-7ad9-45ec-b88b-caeb8dcdbb29'
  const codigo = montarPix({ chave, nome: 'Kam Brasil', cidade: 'Sao Paulo' })

  expect(codigo).toContain(chave)
  expect(codigo).toContain('br.gov.bcb.pix')
  // 36 caracteres da chave: o campo 01 dentro do 26 precisa declarar o tamanho.
  expect(codigo).toContain(`0136${chave}`)
})

test('o CRC do que produzimos confere consigo mesmo', () => {
  const codigo = montarPix({ chave: 'x', nome: 'Kam Brasil', cidade: 'Sao Paulo' })
  const corpo = codigo.slice(0, -4)
  expect(codigo.slice(-4)).toBe(crc16(corpo))
  expect(corpo.endsWith('6304')).toBe(true)
})

test('sem valor, quem doa escolhe no banco', () => {
  const codigo = montarPix({ chave: 'x', nome: 'Kam Brasil', cidade: 'Sao Paulo' })
  // 54 é o campo de valor; ausente significa "o pagador digita".
  expect(codigo).not.toContain('54')
})

test('com valor, ele entra com duas casas', () => {
  const codigo = montarPix({ chave: 'x', nome: 'Kam Brasil', cidade: 'Sao Paulo', valor: 25 })
  expect(codigo).toContain('540525.00')
})

test('acento sai do nome e da cidade', () => {
  // Alguns bancos recusam a leitura quando o código traz byte fora do ASCII.
  const codigo = montarPix({ chave: 'x', nome: 'Ração Ámêndoa', cidade: 'São Paulo' })
  expect(codigo).toContain('Racao Amendoa')
  expect(codigo).toContain('Sao Paulo')
  expect(codigo).not.toMatch(/[^\x20-\x7E]/)
})

test('valor zero é tratado como sem valor', () => {
  // Um QR com "0.00" é recusado pelo banco; o certo é omitir o campo.
  expect(montarPix({ chave: 'x', nome: 'K', cidade: 'C', valor: 0 })).not.toContain('5404')
})
