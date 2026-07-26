# Servidor dedicado do Kam Brasil.
#
# O binário não é versionado aqui: ele é compilado a partir do repositório do
# jogo, do mesmo jeito que o release-builder monta a árvore de uma release. Um
# `.exe` commitado numa imagem envelhece em silêncio e ninguém sabe de que
# commit veio; assim a procedência é o `GAME_REF`.
#
# FPC compila o servidor, mas **não** o cliente: 18 arquivos usam inline vars do
# Delphi 10.3+. Por isso só esta metade mora aqui.

FROM debian:bookworm-slim AS build

# lcl-nogui: o KaM_DedicatedServer.dpr usa a unit `Interfaces` sob FPC, que vem
# do widgetset da LCL. `nogui` é a variante sem X11 — é um servidor de console.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fpc lcl-nogui lcl-units git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG GAME_REPO=https://github.com/RaposoG/kam_brasil.git
ARG GAME_REF=master

WORKDIR /src
RUN git clone --depth 1 --branch "$GAME_REF" "$GAME_REPO" .

WORKDIR /src/Utils/DedicatedServer

# Os caminhos da LCL são derivados da própria unit que precisamos, não chutados:
# a versão do Lazarus está no meio do caminho (`/usr/lib/lazarus/2.2.6/...`) e um
# upgrade do pacote mudaria todos eles de uma vez.
#
# Os `-Fu/-Fi` saem da árvore em vez de uma lista fixa: as units estão em
# subpastas aninhadas (`src/utils/io/`) e enumerar à mão é iterar num erro de
# "unit não encontrada" por vez. `unused` fica de fora de propósito — tem um
# `KM_PerfLog.pas` que sombrearia o de `src/perflog/`.
#
# -dNO_RNG_SPY é obrigatório: sem ele KM_CommonUtils puxa KM_RandomChecks, que
# usa KM_GameSettings, que tem inline vars que o FPC não compila.
RUN NOGUI=$(dirname "$(find /usr/lib/lazarus -name interfaces.ppu -path '*/nogui/*' | head -1)") \
 && LCL=$(dirname "$NOGUI") \
 && LAZUTILS=$(dirname "$(find /usr/lib/lazarus -name lazutf8.ppu | head -1)") \
 && echo "LCL em $LCL, lazutils em $LAZUTILS" \
 && SRC="-Fi../.. -Fu../.." \
 && for d in $(find ../../src -type d -not -path '*/unused*'); do SRC="$SRC -Fi$d -Fu$d"; done \
 && fpc -Px86_64 -Mdelphi -O3 -dNO_RNG_SPY \
      -Fu$NOGUI -Fu$LCL -Fu$LAZUTILS \
      $SRC \
      -oKaM_DedicatedServer \
      KaM_DedicatedServer.dpr

# Uma falha de link deixaria o passo acima passar sem produzir binário.
RUN test -x KaM_DedicatedServer


FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --create-home --home-dir /app kam

WORKDIR /app
COPY --from=build /src/Utils/DedicatedServer/KaM_DedicatedServer /app/
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh /app/KaM_DedicatedServer && chown -R kam:kam /app

USER kam
ENTRYPOINT ["/app/entrypoint.sh"]
