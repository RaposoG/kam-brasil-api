/**
 * Os repositórios que as rotas internas do ranqueado usam — só um re-export de
 * `data-source.ts`.
 *
 * Existe por um motivo de teste, e vale dizer qual porque a indireção não é
 * óbvia: no `bun test` todos os arquivos dividem o mesmo registro de módulos, e
 * **só o primeiro `mock.module` de um módulo vale** — o segundo não consegue
 * nem acrescentar um export que o primeiro não declarou (`SyntaxError: Export
 * named 'x' not found`). `data-source.ts` já é trocado por fakes em
 * `routes/admin.test.ts`, então mockar lá de novo derrubaria os dois testes.
 *
 * Este arquivo é o ponto de troca exclusivo do ranqueado. Em produção ele é
 * transparente.
 */
export {
  accounts,
  lobbies,
  lobbyPlayers,
  maps,
  matchPlayers,
  matches,
  playerRatings,
  seasons,
} from '../data-source.ts'
