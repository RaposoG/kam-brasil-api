// O allowlist de anúncio é a única credencial do /serveradd.php — o jogo não
// manda nenhuma outra, os parâmetros são fixos no Pascal
// (KM_NetServerLocator.AnnounceServer).
//
// O que este teste tranca: lista vazia NÃO pode significar "aceita todo mundo"
// em produção. Uma env com espaço, ou com uma vírgula solta, atravessa o
// `${VAR:-default}` do compose e chega aqui como lista vazia depois do
// `filter(Boolean)` do config.ts.

import { expect, test } from 'bun:test'

// Importar master.ts puxa config.ts, que valida o ambiente na carga do módulo.
// `??=` e não `=`: `bun test` roda tudo num processo só e outro arquivo pode ter
// chegado antes. Os valores não importam — o teste passa o allowlist na mão,
// justamente para não depender do config, que é singleton de processo.
process.env.DATABASE_URL ??= 'postgres://kb:kb@127.0.0.1:5432/kb-test'
process.env.JWT_SECRET ??= 'x'.repeat(32)

const { isAnnounceAllowed } = await import('./master.ts')

const DENTRO = '10.89.7.20'
const FORA = '203.0.113.99'

test('lista vazia recusa em produção', () => {
  expect(isAnnounceAllowed(FORA, [], false)).toBe(false)
  // Nem o endereço "certo" passa: sem lista não há nada contra o que conferir.
  expect(isAnnounceAllowed(DENTRO, [], false)).toBe(false)
})

test('lista vazia segue aberta em desenvolvimento', () => {
  expect(isAnnounceAllowed(FORA, [], true)).toBe(true)
})

test('lista preenchida aceita só quem está nela', () => {
  expect(isAnnounceAllowed(DENTRO, [DENTRO, '10.89.7.21'], false)).toBe(true)
  expect(isAnnounceAllowed(FORA, [DENTRO], false)).toBe(false)
})

test('a comparação é exata: não existe CIDR nem prefixo', () => {
  // Se um dia alguém escrever uma faixa na variável achando que funciona, este
  // teste é o que diz que não funciona. Ver peer-ip.ts.
  expect(isAnnounceAllowed('10.89.7.20', ['10.89.7.0/24'], false)).toBe(false)
  expect(isAnnounceAllowed('10.89.7.200', ['10.89.7.20'], false)).toBe(false)
})
