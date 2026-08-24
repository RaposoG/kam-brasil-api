// O casamento save↔partida é o único pedaço de `api.ts` que decide alguma
// coisa: errar aqui faz o launcher oferecer "enviar replay" apontando para a
// partida errada — e o replay de uma batalha iria parar na crônica de outra.

import { expect, test } from 'bun:test'
import { type Partida, type ReplaySave, partidaDoSave } from './api'

const HORA = 60 * 60 * 1000

const partida = (id: string, iniciadoEm: string): Partida =>
  ({ id, iniciadoEm }) as Partida

const save = (modifiedMs: number, mode: 'SP' | 'MP' = 'MP'): ReplaySave => ({
  name: 'partida',
  mode,
  modifiedMs,
  sizeBytes: 0,
  hasReplay: true,
})

const INICIO = Date.parse('2026-08-24T20:00:00.000Z')

test('o save fica com a partida que estava rodando quando ele foi escrito', () => {
  const partidas = [
    partida('velha', new Date(INICIO - 3 * HORA).toISOString()),
    partida('certa', new Date(INICIO).toISOString()),
  ]

  // Meia hora depois do início: a partida ainda era essa.
  expect(partidaDoSave(save(INICIO + HORA / 2), partidas)?.id).toBe('certa')
})

test('save de antes da partida não é dela', () => {
  const partidas = [partida('certa', new Date(INICIO).toISOString())]
  expect(partidaDoSave(save(INICIO - 1), partidas)).toBeNull()
})

test('save velho demais não é casado por acidente', () => {
  const partidas = [partida('certa', new Date(INICIO).toISOString())]
  // Sem a janela, o save de amanhã acharia a partida de hoje só porque veio
  // depois dela — e ela seria a mais recente da lista.
  expect(partidaDoSave(save(INICIO + 7 * HORA), partidas)).toBeNull()
})

test('save de campanha nunca vira partida da crônica', () => {
  const partidas = [partida('certa', new Date(INICIO).toISOString())]
  expect(partidaDoSave(save(INICIO + HORA, 'SP'), partidas)).toBeNull()
})
