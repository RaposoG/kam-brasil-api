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

Os dados de exemplo que o design carrega viveram um tempo em um `mock.ts` no
código — ele **não existe mais**. As telas hoje leem da API e do disco, e o que
ainda não tem como existir (tudo que depende de resultado de partida) aparece
marcado como "em preparação" na própria interface. O inventário do que é real,
do que passou a ser real e do que espera a Fase 1b está em
[`../FUNCIONALIDADES.md`](../FUNCIONALIDADES.md).
