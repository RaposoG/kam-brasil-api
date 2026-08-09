// O que estas funções protegem: maps.php é rota pública sem credencial (os
// parâmetros são fixos no Pascal), e o chat exibe texto de um jogador na tela
// dos outros. Controle/vírgula/pipe quebrariam os formatos texto-puro do KaM.

import { expect, test } from 'bun:test'
import { clampPlayerCount, cleanChatBody, sanitizeMapName } from './sanitize.ts'

const NL = String.fromCharCode(10)
const BEL = String.fromCharCode(7)
const NUL = String.fromCharCode(0)

test('sanitizeMapName: controle, vírgula e pipe viram espaço', () => {
  expect(sanitizeMapName(`Cursed${NL}Ravine`)).toBe('Cursed Ravine')
  expect(sanitizeMapName('A,B|C')).toBe('A B C')
  expect(sanitizeMapName(`${NUL}${BEL}Golden Cliffs`)).toBe('Golden Cliffs')
})

test('sanitizeMapName: apara as pontas e corta em 120', () => {
  expect(sanitizeMapName('  Across the Desert  ')).toBe('Across the Desert')

  const long = 'x'.repeat(200)
  expect(sanitizeMapName(long).length).toBe(120)

  // O corte em 120 não pode deixar espaço sobrando na ponta.
  const cutOnSpace = `${'x'.repeat(119)} ${'y'.repeat(50)}`
  expect(sanitizeMapName(cutOnSpace)).toBe('x'.repeat(119))
})

test('sanitizeMapName: só lixo vira vazio (e o report não é gravado)', () => {
  expect(sanitizeMapName('')).toBe('')
  expect(sanitizeMapName('  ,,, ||| ')).toBe('')
})

test('clampPlayerCount: 0 a 16, lixo vira 0', () => {
  expect(clampPlayerCount(4)).toBe(4)
  expect(clampPlayerCount(-3)).toBe(0)
  expect(clampPlayerCount(999)).toBe(16)
  expect(clampPlayerCount(Number.NaN)).toBe(0)
  expect(clampPlayerCount(3.9)).toBe(3)
})

test('cleanChatBody: apara, remove controle e colapsa espaços', () => {
  expect(cleanChatBody('  olá  taverna  ')).toBe('olá taverna')
  expect(cleanChatBody(`boa${NL}noite${BEL}!`)).toBe('boa noite !')
})

test('cleanChatBody: vazio ou só espaço é inválido', () => {
  expect(cleanChatBody('')).toBeNull()
  expect(cleanChatBody('   ')).toBeNull()
  expect(cleanChatBody(NL + BEL)).toBeNull()
})

test('cleanChatBody: 280 passa, 281 não', () => {
  expect(cleanChatBody('x'.repeat(280))).toBe('x'.repeat(280))
  expect(cleanChatBody('x'.repeat(281))).toBeNull()
})
