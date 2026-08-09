# Design de origem da interface

Estes arquivos são o **projeto de design que originou a interface atual** do
launcher, exportado do claude.ai/design antes de o projeto de lá ser apagado.
Guardados aqui porque não existe mais outra cópia.

| Arquivo | O que é |
|---|---|
| `Launcher Kam Brasil.dc.html` | o design em si — dez telas, dock e taverna, com os dados de exemplo |
| `support.js` | runtime que renderiza o `.dc.html`; sem ele o arquivo abre em branco |
| `github.md` | notas de sincronia: o que foi lido do launcher e da API para desenhar |
| `thumbnail.png` | miniatura do projeto |

Para ver o design como ele era, abra o `.dc.html` num navegador com o
`support.js` ao lado. É um protótipo React, **não** o código que roda — o que
roda é o Vue em [`../../src`](../../src).

## O que virou código e o que continua ficção

O design foi desenhado sabendo que boa parte dos dados ainda não existe (está
escrito no próprio `github.md`: *"estatísticas e elo são feature nova"*).

- **Ligado ao backend de verdade:** login e conta, barra de status da instalação,
  botão principal (escolher original → instalar → preparar → jogar), versão do
  launcher e do jogo, e a tela de Configurações.
- **Ainda ficção, em [`../../src/mock.ts`](../../src/mock.ts):** perfil, ranking,
  partidas, replays, mapas, temporada, conquistas, notícias, camaradas e taverna.

A API hoje tem contas, tickets de partida, lista de servidores e releases.
`GET /maps.php` recebe a partida jogada mas não persiste nada — enquanto isso não
mudar, as telas de progresso leem do `mock.ts`.
