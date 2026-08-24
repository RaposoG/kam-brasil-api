import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolverSegredoInterno } from './ranked-secret.ts'

const pasta = () => mkdtempSync(join(tmpdir(), 'kb-segredo-'))

describe('segredo interno da ranqueada', () => {
  test('o definido à mão tem precedência sobre o arquivo', () => {
    const arquivo = join(pasta(), 'segredo')
    writeFileSync(arquivo, 'do-arquivo\n')
    expect(resolverSegredoInterno('na-mao', arquivo)).toBe('na-mao')
  })

  test('cria o arquivo na primeira vez e o reusa depois', () => {
    // É o contrato que faz API e gameserver combinarem: se a segunda chamada
    // sorteasse de novo, o servidor dedicado levaria 403 após todo restart.
    const arquivo = join(pasta(), 'sub', 'segredo')
    const primeiro = resolverSegredoInterno('', arquivo)
    expect(primeiro).toMatch(/^[0-9a-f]{64}$/)
    expect(resolverSegredoInterno('', arquivo)).toBe(primeiro)
    expect(readFileSync(arquivo, 'utf8').trim()).toBe(primeiro)
  })

  test('o arquivo criado é legível por outro usuário', () => {
    // O gameserver roda como `kam` (não-root) e lê este arquivo por um volume
    // `:ro`; a API roda como root. Com 0600 ele tomava EACCES, o entrypoint
    // entendia "sem segredo" e desligava a ranqueada em silêncio.
    //
    // Só morde em POSIX — no Windows o modo não distingue dono de "outros".
    const arquivo = join(pasta(), 'segredo')
    resolverSegredoInterno('', arquivo)
    expect(statSync(arquivo).mode & 0o044).toBe(0o044)
  })

  test('sem arquivo configurado, sorteia em memória e não repete', () => {
    // Fecha as rotas internas na prática, que é o certo fora do compose.
    expect(resolverSegredoInterno('', '')).not.toBe(resolverSegredoInterno('', ''))
  })

  test('arquivo restritivo antigo continua legível e vira 0644', () => {
    // Uma versão anterior gravava 0600 e o gameserver (outro usuário, volume
    // :ro) tomava EACCES — ranqueada morta em silêncio. O volume sobrevive ao
    // deploy, então o conserto tem que alcançar o arquivo que já existe.
    const arquivo = join(pasta(), 'segredo')
    writeFileSync(arquivo, 'segredo-antigo\n', { mode: 0o600 })

    expect(resolverSegredoInterno('', arquivo)).toBe('segredo-antigo')

    // No Windows o bit de grupo/outros não existe; só dá para exigir isto onde
    // o modo é real.
    if (process.platform !== 'win32') {
      expect(statSync(arquivo).mode & 0o777).toBe(0o644)
    }
  })

  test('arquivo vazio é tratado como inexistente', () => {
    // Um arquivo truncado por disco cheio devolveria '' e abriria as rotas
    // internas para quem chutasse segredo vazio.
    const arquivo = join(pasta(), 'segredo')
    writeFileSync(arquivo, '   \n')
    expect(resolverSegredoInterno('', arquivo)).toMatch(/^[0-9a-f]{64}$/)
  })
})
