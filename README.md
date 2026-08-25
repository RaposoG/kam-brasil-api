# Kam Brasil — plataforma

A infraestrutura online da comunidade brasileira de **Knights and Merchants**:
contas, lista de servidores, distribuição do jogo e o launcher que amarra tudo.

A engine do jogo não mora aqui — ela vive em
[RaposoG/kam_brasil](https://github.com/RaposoG/kam_brasil), um fork do
[KaM Remake](https://github.com/reyandme/kam_remake).

```
api/           Fastify + TypeORM   contas, tickets, master server, releases
launcher/      Tauri + Vue         login, instalação e atualização do jogo
gameserver/    Dockerfile          compila e roda o KaM_DedicatedServer
```

## Como as peças conversam

O jogador instala **só o launcher**. Ele cria a conta, baixa o jogo da API —
completo, sem depender de nenhum outro jogo na máquina — e abre já autenticado.

```
launcher  ──HTTPS──▶  API          conta, releases, download
   │
   └─ abre o jogo com um ticket curto
                          │
        jogo  ──HTTP───▶  API      lista de servidores
                          ▲
        servidor dedicado ─┘       valida o ticket em 127.0.0.1
```

Duas assimetrias explicam quase todas as decisões do projeto:

**O cliente do jogo não fala TLS.** O `KM_HTTPClientOverbyte` usa o `THTTPCli` do
ICS sem `SslContext` — não existe uma linha de SSL nele. Por isso a lista de
servidores trafega em HTTP puro, o ticket de partida vai na query string, e a
rota que o valida só aceita `127.0.0.1`.

**O que veio do jogo comercial é empacotado uma vez, não em cada máquina.**
Sprites, sons, músicas e os `.dat` de casas e unidades entram na release já
prontos — é o mesmo que o instalador do KaM Remake faz. Quem precisa do Knights
and Merchants original é quem monta a release, não quem joga. Enquanto era o
contrário, cada jogador convertia na própria máquina e cada instalação saía
diferente da outra: sprites sem a camada de alta resolução, ícones errados, som e
música variando de pessoa para pessoa.

## Rodando local

Precisa de [Bun](https://bun.sh) e [Docker](https://docker.com). Para o launcher,
também [Rust](https://rustup.rs) com as MSVC Build Tools.

```bash
cp .env.example .env   # só JWT_SECRET é obrigatório
docker compose up -d
```

O `docker-compose.override.yml` publica a porta 3000 em desenvolvimento; o
Compose o carrega sozinho quando você roda sem `-f`.

```bash
cd api && bun run dev
cd launcher && bun run tauri dev
```

Testes:

```bash
cd api && bun test
cd launcher/src-tauri && cargo test --lib
```

Por padrão o launcher fala com a API de produção. Para apontar à local, compile
com `KAMBRASIL_API=http://localhost:3000`.

## Endpoints do master server

Estas rotas existem para o **cliente do jogo**, que monta as URLs em
`KM_NetServerLocator.pas`. Os nomes e o formato são fixos no Pascal — mudar
qualquer coisa aqui exigiria recompilar o jogo. Respondem texto puro.

| Rota | Resposta |
|---|---|
| `GET /serveradd.php` | `success` — registra ou atualiza um servidor |
| `GET /serverquery.php?rev=` | uma linha por servidor: `Nome,IP,Porta,Dedicado,SO` |
| `GET /announcements.php` | o `MOTD`, exibido na aba multijogador |
| `GET /maps.php` | `success` — o cliente reporta a partida jogada |

⚠️ **O parser do cliente exige exatamente 5 campos por linha** e faz split por
vírgula. Uma vírgula no nome do servidor gera 6 campos e a linha é **descartada
em silêncio** — por isso `serveradd` remove `,`, `|` e quebras de linha do nome.

A listagem filtra por `rev`, que é o `NET_PROTOCOL_REVISON` e **não** a revisão do
jogo. São números diferentes: builds de protocolos distintos não se enxergam, que
é o certo — elas não conseguiriam jogar juntas mesmo.

## Publicando

**Uma versão do jogo** é montada pela própria API: você anexa os binários
compilados a uma GitHub Release do repositório do jogo e chama
`POST /client/releases`. Ela clona os repositórios de conteúdo, monta a árvore,
calcula os hashes lendo do disco e gera o pacote. Detalhes em [DEPLOY.md](DEPLOY.md).

**Uma versão do launcher** sai de uma tag:

```bash
git tag launcher-v1.2.3 && git push origin launcher-v1.2.3
```

A Action builda no Windows, roda os testes, assina e publica a release com o
`latest.json` que o updater consulta. Quem já tem o launcher instalado recebe a
atualização sozinho.

## Créditos

O jogo é o **KaM Remake**, de [reyandme](https://github.com/reyandme/kam_remake) e
colaboradores. Este projeto acrescenta uma camada de contas e servidores para a
comunidade brasileira; o mérito da engine é inteiramente deles.

*Knights and Merchants* é propriedade de seus respectivos detentores. Os
arquivos do jogo que acompanham a release (sprites, sons e músicas) vêm dele.
