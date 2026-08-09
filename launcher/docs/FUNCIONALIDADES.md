# Funcionalidades do launcher — o que tem, o que falta, o que é possível

Este documento é o inventário que separa a interface em três camadas: o que já
funciona de verdade, o que **passa a funcionar agora** (esta rodada de
implementação), e o que **não tem como funcionar** enquanto o jogo não reportar
mais dados — com o porquê técnico de cada limite.

A referência de fato: o cliente do jogo só fala com o master server pelas quatro
rotas fixas em `KM_NetServerLocator.pas`, e a única coisa que ele reporta sobre
partidas é o **início** delas — `maps.php?map=&mapcrc=&playercount=`. Sem
resultado, sem duração, sem nomes de quem jogou. Todo o resto do design
(vitórias, elo, APM, relatório por jogador) depende de ensinar o servidor
dedicado a reportar o fim da partida, e isso é trabalho em Pascal — a Fase 1b.

## Camada 1 — já funcionava antes desta rodada

| Funcionalidade | Onde |
|---|---|
| Login, registro, restaurar sessão (cofre do sistema), logout | `auth.rs` ↔ `POST /auth/*` |
| Instalar / atualizar o jogo por manifesto (diff + sha256) | `install.rs` ↔ `/client/latest` |
| Achar o KaM original, gerar assets derivados | `original.rs`, `assets.rs` |
| Abrir o jogo autenticado (ticket de partida) | `game.rs` ↔ `POST /auth/ticket` |
| Auto-update do próprio launcher (assinado) | plugin updater |
| Tela de Configurações (pasta, original, verificação, regerar) | `install.ts` |
| MOTD servido ao jogo | `GET /announcements.php` |

## Camada 2 — passa a ser real nesta rodada

### API (novos módulos)

**`GET /stats/overview`** (público, cache de 15 s em memória) — um endpoint só
para tudo que as telas mostram de número real:

```json
{
  "onlinePlayers": 0,        // soma de playerCount dos servidores não expirados
  "openServers": 0,          // quantos servidores vivos
  "launcherOnline": 0,       // contas com lastSeenAt nos últimos 2 min
  "accountsTotal": 0,
  "matchesToday": 0,         // partidas reportadas hoje (dia em America/Sao_Paulo)
  "matchesPerDay": [{ "day": "2026-08-09", "count": 0 }],   // 14 dias
  "topMaps": [{ "map": "Cursed Ravine", "count": 0 }],      // top 5
  "recentMatches": [{ "map": "...", "playerCount": 4, "reportedAt": "ISO" }] // 20
}
```

**Partidas persistidas** — `maps.php` deixa de só logar e grava em
`match_reports` (mapa, crc, playercount, revisões, quando). Rota pública que o
jogo chama sem credencial ⇒ nome sanitizado (controle/`,`/`|` fora, 120 chars),
playercount 0–16, e rate-limit em memória de 1 report/10 s **por IP+mapa+crc** —
quem reporta é o cliente host, e dois jogadores atrás do mesmo IP público (CGNAT
é o normal no Brasil) são tráfego legítimo; o que se barra é o mesmo report
martelado. Descartes vão para o log. A resposta continua `success` sempre — o
cliente Pascal ignora o corpo e não pode ver erro.

**Notícias** — tabela `news_posts` + `GET /news?limit=` (público) e
`POST /news` / `DELETE /news/:id` com `x-admin-token` (mesmo padrão de
`/client/releases`). Publicar notícia não exige release do launcher.

**Presença** — coluna `lastSeenAt` em `accounts` + `POST /presence`
(autenticado). O launcher bate a cada 60 s enquanto aberto. Online = visto há
menos de 2 min.

**Camaradas** — tabela `friendships` (requester, addressee,
`pending|accepted`, único por par) + rotas autenticadas:
`GET /friends` (aceitos com online/lastSeenAt + pendentes nas duas direções),
`POST /friends {nickname}` (convite; se existir convite reverso, vira aceitação),
`POST /friends/:id/accept`, `DELETE /friends/:id` (recusa, cancela ou desfaz —
qualquer lado). *Sem* estado "em partida": o servidor não reporta fim de jogo,
então seria chute — fica para a Fase 1b.

**Taverna (chat)** — tabela `chat_messages` (id `bigserial` como cursor,
nickname desnormalizado, corpo ≤ 280) + rotas autenticadas:
`GET /chat?after=<id>&limit=50` e `POST /chat {body}` (sanitiza espaços e
caracteres de controle, rate-limit 1 msg/2 s por conta). O launcher faz poll de
5 s com cursor. O "N falando" do cabeçalho é o `launcherOnline` do overview.

**Temporada e conquistas (catálogo)** — `GET /seasons/current` e
`GET /achievements` servem um catálogo **estático definido no código da API**
(nome, datas, recompensas, descrições). Sem progresso — progresso depende de
estatística por jogador (Camada 3). Catálogo no servidor para mudar conteúdo
sem assinar release do launcher (as Actions estão fora do ar; release é manual).

### Launcher (Rust)

Comandos autenticados novos, no padrão de `auth.rs` (o token nunca chega ao
JavaScript): `friends_list`, `friend_add(nickname)`,
`friend_respond(id, accept)`, `chat_fetch(after)`, `chat_send(body)`,
`presence_heartbeat`.

Comandos locais (leem a instalação do jogo, sem rede):
- `list_replays` — varre `Saves/` e `SavesMP/` da pasta do jogo (`.sav`; tem
  replay quando existe o `.rpl` de mesmo nome — `EXT_SAVE_REPLAY` no
  KM_Defaults). Nome, modo SP/MP, data, tamanho.
- `list_local_maps` — varre `Maps/` e `MapsMP/`. Nome do diretório, modo, data.
  (Contagem de jogadores exigiria parsear o `.dat` binário — fora do escopo.)

O struct `Account` ganha `createdAt` (a API já devolvia; o Rust descartava) —
é o "na comunidade desde" do Perfil.

Leituras **públicas** (news, stats, catálogos, MOTD) o frontend busca com
`fetch` direto na API — a CSP já libera o host, e não envolvem token.

### Frontend (telas religadas)

| Tela | Passa a mostrar |
|---|---|
| **Home** | Online agora / partidas abertas reais (overview); notícias reais; "última partida" = save MP local mais recente (mapa + quando), sem números inventados |
| **Dock** | Camaradas reais (poll 30 s) com convidar/aceitar/recusar; taverna real (poll 5 s) com envio habilitado; "N falando" real |
| **Notícias** | Posts reais, MOTD real (`announcements.php`), reino em números real |
| **Ranking** | Números do topo, mapas mais jogados e partidas/dia reais; divisões e leaderboard → estado "em preparação" (Camada 3) |
| **Partidas** | Feed real da comunidade (mapa, jogadores, quando) vindo de `recentMatches`; relatório detalhado → "em preparação" |
| **Replays** | Saves/replays locais reais + abrir a pasta |
| **Mapas** | Mapas instalados reais (nome, modo, data) |
| **Perfil** | Identidade real (nickname, email, membro desde); estatísticas → "em preparação" |
| **Temporada** | Catálogo real da temporada (nome, datas, trilha) com progresso marcado indisponível |
| **Conquistas** | Catálogo real com progresso marcado indisponível |

O `mock.ts` **deixa de existir**. Estados vazios e os painéis "em preparação"
são componentes de verdade (`EmBreve.vue`), no tema, dizendo o que falta e de
onde virá.

## Camada 3 — impossível sem mexer no jogo (Fase 1b)

Tudo aqui esbarra no mesmo fato: **nenhum resultado de partida chega à API**.

| Funcionalidade | O que exige do jogo |
|---|---|
| Vitória/derrota, duração, encerramento | servidor dedicado reportar fim de partida |
| Histórico pessoal, leaderboard, divisões/elo | idem + vincular jogadores (o ticket de `/auth/verify` já identifica a conta no join — a metade da ponte existe) |
| Recursos, exército, APM, timeline, comparativo | telemetria que hoje só existe dentro do replay local |
| Progresso de temporada, missões, conquistas | estatística por jogador acumulada |
| Estado "em partida" dos amigos | fim de partida reportado |
| Preview/minimapa nas cartas de mapa e replay | renderizar minimapa fora do jogo |

Quando a Fase 1b acontecer, o caminho natural é o servidor dedicado (que já
valida ticket no join e sabe quem é quem) mandar um POST autenticado por IP de
loopback no fim da partida — mesma confiança do `/auth/verify`.

## Notas de operação

- **Push na API = deploy em produção.** Migrations rodam no boot. Testar local
  antes (`docker compose up -d` + `cd api && bun run dev`).
- Rate-limits e caches novos são **em memória** — corretos para a instância
  única de hoje; revisitar se um dia houver réplica.
- Para os jogadores receberem o frontend novo: release manual assinada do
  launcher (ver `docs/design/README.md` e o processo em memória — tag deve
  bater com `tauri.conf.json`, `latest.json` na mão).
