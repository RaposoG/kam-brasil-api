/**
 * Os repositórios que a fila e o lobby de bans usam — só um re-export de
 * `data-source.ts`. Em produção é transparente.
 *
 * Sim, é a segunda indireção destas (ver `ranked/repos.ts`), e a duplicação é
 * obrigatória, não preguiça: no `bun test` todos os arquivos dividem o mesmo
 * registro de módulos e **só o primeiro `mock.module` de um módulo vale** — o
 * segundo não consegue nem acrescentar um export que o primeiro não declarou
 * (`SyntaxError: Export named 'x' not found`). Como `routes/ranked-internal.ts`
 * já troca `ranked/repos.ts` no teste dele, um seam compartilhado congelaria a
 * lista de exports no formato de quem rodasse primeiro. Um ponto de troca por
 * arquivo de teste é o preço.
 */
export {
  dataSource,
  gameServers,
  lobbies,
  lobbyPlayers,
  maps,
  playerRatings,
  queueEntries,
  seasons,
} from '../data-source.ts'
