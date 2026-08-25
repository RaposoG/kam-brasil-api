# Ícones do launcher

Gerados com `bun tauri icon src/assets/marca.png`, a partir da marca do projeto.

A marca é o mesmo losango da barra de título (`src/TitleBar.vue`): um quadrado em
`--ouro` (`#d4a24a`) girado 45 graus, com halo da mesma cor a 12% de opacidade,
sobre `--barra` (`#1a1410`). O SVG em `src/assets/marca.svg` é a fonte editável;
o PNG ao lado é o que o gerador consome.

Para regerar depois de mexer na marca:

```bash
cd launcher && bun tauri icon src/assets/marca.png
```

Isso reescreve todos os tamanhos, o `.ico` (Windows) e o `.icns` (macOS). **Não
edite os PNGs de tamanho fixo na mão** — eles voltam a ser sobrescritos na
próxima geração, e a diferença só apareceria no instalador de alguém.

O losango da barra de título continua sendo CSS, não este SVG: em 9 pixels um
quadrado girado sai mais nítido que qualquer imagem redimensionada.
