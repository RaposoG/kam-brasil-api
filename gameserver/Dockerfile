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
ARG GAME_API=https://api.github.com/repos/RaposoG/kam_brasil/commits

WORKDIR /src

# Este ADD existe só para invalidar o cache do clone abaixo.
#
# `git clone` é uma camada como qualquer outra: o Docker olha o texto do comando,
# vê que não mudou e reaproveita o clone antigo — para sempre. O servidor
# continuaria sendo compilado de um commit velho, em silêncio, e foi exatamente
# o que aconteceu: um deploy falhou compilando código que já estava corrigido no
# repositório havia horas.
#
# A resposta desta URL muda quando GAME_REF aponta para outro commit, então a
# camada muda junto e o clone roda de novo.
ADD ${GAME_API}/${GAME_REF} /tmp/game-commit.json

RUN git clone --depth 1 --branch "$GAME_REF" "$GAME_REPO" . \
 && echo "compilando de $(git rev-parse --short HEAD)"

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
# Sem nenhum `-d`: o RNG spy virou opt-in no KaM_Remake.inc, e era ele que
# impedia o FPC — puxava KM_RandomChecks → KM_GameSettings, cheio de inline vars
# do Delphi 10.3+. Se voltar a ser preciso desligar algo, o flag vem neste RUN.
RUN NOGUI=$(dirname "$(find /usr/lib/lazarus -name interfaces.ppu -path '*/nogui/*' | head -1)") \
 && LCL=$(dirname "$NOGUI") \
 && LAZUTILS=$(dirname "$(find /usr/lib/lazarus -name lazutf8.ppu | head -1)") \
 && echo "LCL em $LCL, lazutils em $LAZUTILS" \
 && SRC="-Fi../.. -Fu../.." \
 && for d in $(find ../../src -type d -not -path '*/unused*'); do SRC="$SRC -Fi$d -Fu$d"; done \
 && fpc -Px86_64 -Mdelphi -O3 \
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
