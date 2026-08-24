// Resolve o segredo das rotas internas da ranqueada.
//
// Mora fora do config.ts de proposito: importar o config dispara o parse do
// ambiente inteiro e fixa o modulo em cache. Um teste que so quer exercitar
// esta funcao envenenaria os outros arquivos de teste ao faze-lo.

import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// 0644, e não 0600: a API roda como root, o gameserver roda como o usuário
// `kam` (uid 999, ver gameserver/Dockerfile) e lê este mesmo arquivo por um
// volume `:ro`. Com 0600 ele tomava EACCES, o entrypoint entendia "sem segredo"
// e desligava a ranqueada em silêncio — verificado em container.
//
// O volume só existe para estes dois; dentro do container da API não há outro
// usuário de quem esconder o segredo.
const MODO = 0o644

/**
 * Segredo das rotas internas: o que foi definido à mão, senão o do arquivo
 * compartilhado, criando-o se ainda não existir.
 *
 * Sem arquivo configurado sobra um aleatório em memória — o que fecha as rotas
 * internas na prática, e é o certo: nesse caso não há gameserver do outro lado
 * para combinar segredo nenhum.
 */
export function resolverSegredoInterno(explicito: string, arquivo: string): string {
  if (explicito.length > 0) return explicito
  if (arquivo.length === 0) return randomBytes(32).toString('hex')

  try {
    const guardado = readFileSync(arquivo, 'utf8').trim()
    if (guardado.length > 0) {
      // Reajusta o modo a cada subida em vez de só na criação. Uma versão
      // anterior gravava 0600, e um volume criado por ela sobrevive ao deploy:
      // sem isto, o arquivo velho continuaria ilegível para o gameserver e a
      // ranqueada nasceria morta em silêncio, exigindo apagar volume na mão.
      try {
        chmodSync(arquivo, MODO)
      } catch {
        // Só falha se não formos donos do arquivo — e aí o modo dele não é
        // problema nosso. O segredo já foi lido, que é o que importa.
      }
      return guardado
    }
  } catch {
    // Não existe ainda: somos o primeiro a subir, e criamos abaixo.
  }

  const novo = randomBytes(32).toString('hex')
  mkdirSync(dirname(arquivo), { recursive: true })
  // Grava e renomeia: o gameserver lê este arquivo, e um reinício da API no
  // meio de uma escrita direta o entregaria pela metade.
  const temp = `${arquivo}.${process.pid}.tmp`
  writeFileSync(temp, `${novo}\n`, { mode: MODO })
  renameSync(temp, arquivo)
  return novo
}
