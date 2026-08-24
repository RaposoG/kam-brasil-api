# Plano de implementação — Sistema Ranqueado do Kam Brasil

## 1. O problema em uma página

Hoje o jogo **sabe** quem ganhou e **não conta pra ninguém**.

O dado canônico existe e é confiável: `TWonOrLost` (`KM_CommonTypes.pas:81`), gravado em `TKMHandAI.fWonOrLost` (`KM_AI.pas:25`), decidido por `CheckGoals` (`KM_AI.pas:180-268`) dentro do tick da simulação e **salvo no savegame** (`KM_AI.pas:468-496`). Como o KaM Remake é lockstep determinístico, todos os clientes honestos calculam o mesmo resultado, no mesmo tick. Não é chute: é estado de simulação.

O que falta são quatro elos, nesta ordem de gravidade:

1. **Não existe "a partida acabou".** Em `gmMulti`, `PlayerVictory`/`PlayerDefeat` (`KM_Game.pas:1191`/`1239`) só abrem o painel "continuar jogando / sair". Cada jogador sai quando quer. Não há um instante único, igual para todos, em que a partida se declara encerrada.
2. **O resultado não sai da máquina.** A única coisa que o jogo reporta é `maps.php?map=&mapcrc=&playercount=` (`KM_NetServerLocator.pas:146`), disparada uma vez pelo host **no meio** da partida (tick 30 min / 2 min, `KM_Defaults.pas:440-441`). É telemetria de popularidade de mapa. Não tem jogador, nem vencedor, nem fim.
3. **A API não tem onde guardar.** Zero entidades de partida, participante, rank, temporada persistida, fila ou lobby. `match_reports` não tem nem `accountId`.
4. **Desconexão suja não derrota ninguém.** Saída limpa vira `gicGamePlayerDefeat` corretamente (`KM_Networking.pas:1439` → `KM_GameInputProcess.pas:1112-1115`), mas queda de rede / alt+F4 (`mkClientLost`, `KM_Networking.pas:1943-1978`) e drop do host (`DropPlayers`, `:444-471`) só tiram o cara da sala — a hand fica viva na simulação e **a partida nunca termina sozinha**.

**O que muda.** O servidor dedicado — que já autentica cada cliente contra a API (`KM_NetServer.pas:454`, `GET /auth/verify`) e é a única peça do sistema que sabe *quem é quem de verdade* — passa a ser o dono da partida ranqueada: ele recebe a reserva da sala da API, valida o que o host difunde, e reporta o resultado final. O jogo ganha um encerramento determinístico no tick. A API ganha histórico real, rating, fila e lobby. O launcher ganha duas telas e um botão que abre o jogo já dentro da sala certa.

**O que continua impossível e é melhor dizer agora:**

- **"Dono = servidor" no sentido literal não existe.** O `TKMNetServer` é um relay: o host é sempre um cliente, o primeiro a entrar na sala (`KM_NetServer.pas:791-799`). A alternativa "host-bot" exige rodar um cliente KaM completo (OpenGL, sem modo headless) no servidor — caro e frágil. O que vamos entregar é **um host sem poder nenhum**: continua sendo um jogador, mas tudo que ele difunde é validado pelo servidor contra a reserva, e o que não bate é rejeitado ou invalida a partida.
- **"Tempo" travado = peacetime e velocidade.** O engine não tem limite de duração de partida (`TKMGameOptions` só tem `Peacetime`, `SpeedPT`, `SpeedAfterPT`, `RandomSeed`, `MissionDifficulty`). Não vamos inventar um cronômetro de partida — seria mexer na condição de vitória, que é o coração do determinismo.
- **Estatística detalhada por jogador é "melhor esforço".** Só o cliente tem `TKMHandStats`. O servidor sabe quem ganhou; o detalhamento (casas, exército, gráficos) vem do cliente e nunca vale como fonte de rank.

---

## 2. Decisões de arquitetura

### 2.1 Rating: OpenSkill (Weng-Lin / Plackett-Luce), lib `openskill` npm

`bun add openskill` — MIT, tipos TS nativos. Um par `(mu, sigma)` por jogador, o mesmo para 1x1, 2x2, 3x3 e 4x4.

**Porquê:** o requisito "um rating só para todos os modos" é nativo — `rate([[a,b,c,d],[e,f,g,h]])` devolve rating individual a partir do resultado do time. Com Elo ou Glicko-2 você teria que inventar a agregação de time e a distribuição do delta, e é exatamente essa parte inventada que quebra ladder de comunidade. O `sigma` também resolve de graça as 10 colocações (incerteza alta → move rápido → trava sozinha) e o pareamento seguro de quem não tem histórico.

**Descartados:**
- **Glicko-2** — sem modelo de time nativo, e trabalha por *período de rating* (Glickman recomenda período com 10–15 jogos por jogador; com dezenas de pessoas isso vira período mensal, ou seja, rank que atualiza uma vez por mês).
- **Elo** — sem incerteza. Ou K baixo (rank preso por meses) ou K alto (oscila toda partida). Colocação de 10 partidas fica arbitrária.
- **TrueSkill** — a patente-mãe expirou, mas há continuações e "TrueSkill" é **marca registrada** da Microsoft. Custo de dúvida jurídica por zero benefício técnico sobre OpenSkill. Se um dia usarem qualquer implementação dessa família, **não chamem de TrueSkill na interface**.

**Parâmetros (escala nativa, não mexer):** `mu=25`, `sigma=25/3`, `beta=25/6`, `kappa=0.0001`, `preventSigmaIncrease=true`, `tau=0.25` nas 10 colocações e `25/300` depois. **Piso manual de `sigma` = 2.5 aplicado após cada update** — é o parâmetro mais importante e o mais fácil de esquecer: sem ele o veterano chega a σ≈1.2 e congela (melhora e não sobe), e `c = mu − 2σ` infla o tier de todo mundo sem ninguém jogar melhor.

**Score interno:** `c = mu − 2σ`. Nunca sai para o cliente. Nunca.

**Tiers — 6 faixas + 1 apex por vaga.** Nada de divisões I/II/III: 6×3 = 18 caixas para ~60 pessoas é rank que não significa nada.

| Tier | `c` | alvo |
|---|---|---|
| Recruta | `< 13` | ~10% |
| Miliciano | `13–16.5` | ~20% |
| Machadeiro | `16.5–20` | ~25% |
| Espadachim | `20–23.5` | ~22% |
| Besteiro | `23.5–27` | ~15% |
| Bárbaro | `≥ 27` | ~8% |
| **Comandante do Rei** | **vaga**: top 5 entre Bárbaros com ≥20 partidas na temporada | — |

Estabilidade: histerese de 1.0 ponto (rebaixa só abaixo de `limiar − 1.0`) + confirmação em 2 partidas consecutivas + piso de σ. Resultado: tier muda a cada ~3–5 partidas, não a cada partida. Cortes recalibrados **só no início de cada temporada** e congelados — nunca percentil ao vivo, senão o tier de alguém muda porque *outra pessoa* jogou, e isso é indefensável no Discord. Menos de 30 jogadores ativos: não recalibrar, manter os cortes-semente.

**Exibição:** só nome do tier + ícone. Sem barra de progresso dentro do tier (é vazamento de pontos disfarçado). Se o dono pedir progresso, oferecer os últimos 10 resultados (V/D) — informação real, não explorável.

### 2.2 Fonte de verdade do resultado: o servidor dedicado

Ordem de confiabilidade, do melhor pro pior:

| Fonte | Sabe quem é quem? | Tem interesse no resultado? | Veredito |
|---|---|---|---|
| **Servidor dedicado** | **Sim** (`client.AuthNickname`, `KM_NetServer.pas:535`) | Não | **Escolhido** |
| Quorum de todos os clientes | Não (só nickname declarado) | Sim | Reserva / detecção de fraude |
| Só o host | Não | **Sim, é jogador** | Nunca |

O servidor dedicado já tem tudo: `fRoomInfo[room].GameInfo` com `Players[].WonOrLost`, `Team`, `Name`, `GameTime` (`KM_NetServer.pas:1188-1192`); já tem cliente HTTP com fila (`AuthProcessQueue`, `:404-560`); e já sabe a identidade autenticada de cada cliente — que o host **não** sabe.

Falta um pré-requisito de duas linhas: `TKMGame.PlayerVictory`/`PlayerDefeat` precisam chamar `gNetworking.OnMPGameInfoChanged`. Hoje esse callback só dispara em mudança de lista de jogadores / troca de estado (`KM_Networking.pas:863, 1066, 1358, 2533, 2578`), então o servidor **quase nunca vê o resultado final**. Duas linhas resolvem metade do problema.

**O cliente pode mentir?** Dentro da partida, não: `WonOrLost` é estado de simulação lockstep; um cliente modificado que se declare vencedor apenas dessincroniza de si mesmo, e os cheats de debug (`gicTempVictory`/`gicTempDefeat`) estão bloqueados em release (`KM_GameInputProcess.pas:1076-1079`, com `DEBUG_CHEATS`/`MULTIPLAYER_CHEATS` = False em `KM_Defaults.pas:315-316`). Fora da partida, sim — por isso **o relatório nunca vem do cliente**. O cliente só envia enriquecimento (stats, replay), marcado como não-autoritativo.

### 2.3 Transporte: GET para o resultado, POST só do launcher

`TKMHTTPClient` só expõe `GetURL`; o wrapper Overbyte descarta qualquer `RqType <> httpGET` (`KM_HTTPClientOverbyte.pas:63`). Implementar `PostURL` no Pascal é trabalho real com ICS assíncrono.

Não vamos implementar. O resultado autoritativo é pequeno e cabe em querystring:

```
ranked/report?secret=...&match=<uuid>&winner=A&ticks=18240&p=<nick>:0:1&p=<nick>:1:2...
```

O detalhe pesado (stats por jogador, replay) sobe pelo **launcher**, que tem `reqwest` completo, já autentica no Rust e já sabe onde estão os saves. Isso é enriquecimento, não fonte de verdade.

`// ponytail: sem PostURL no Pascal — o resultado cabe em querystring. Implementar POST só se o payload autoritativo crescer.`

**Autenticação do reporte:** segredo compartilhado na querystring + allowlist de IP, exatamente o padrão que já está em produção em `VERIFY_ALLOWED_IPS` (`routes/verify.ts`). O gameserver e a API rodam no mesmo host — loopback resolve. HMAC em Pascal seria escrever criptografia à mão para ganhar nada nesse cenário.

### 2.4 Direção do canal API ↔ servidor dedicado: o servidor puxa

O protocolo do KaM não tem "criar sala com senha". Salas existem por índice, e quem entra primeiro vira host.

Então: **a API é dona da alocação de salas ranqueadas** (reserva um bloco de índices) e o servidor dedicado **puxa** as reservas por polling GET a cada 3s, usando a mesma fila HTTP que já existe para o auth:

```
GET /internal/ranked/rooms?secret=...
→ room=3;match=<uuid>;mapcrc=A1B2C3D4;pt=15;speed=1;lock=1;p=nick:team:loc;p=...
```

Texto puro, linha por sala — mesmo formato de `serverquery.php`, que o Pascal já sabe parsear. Nada de JSON no Pascal.

Com a reserva em mãos, o servidor dedicado: (a) recusa join de quem não está na lista; (b) valida `mkPlayersList` / `mkGameOptions` / `mkStart` contra ela; (c) manda o bloco travado dentro do `TKMPGameFilter`, que **já viaja** no `mkConnectedToRoom` (`KM_NetServer.pas:811-814`).

### 2.5 Sem tempo real. Polling.

Fila e votação de ban precisam de turno e ordem — mas não de milissegundos. O launcher já tem o padrão maduro pronto: `Dock.vue` faz poll de 5s com cursor e fila de promises serializada.

- Fila: `GET /ranked/queue/status` a cada 3s
- Lobby de bans: `GET /ranked/lobby/:id` a cada 1.5s, turno com deadline de 25s (estourou = ban aleatório automático)

**Descartado (por ora): WebSocket.** Exigiria dependência nova na API, mexer na CSP do Tauri (`connect-src` não libera `ws:`), e um segundo caminho de estado. Um ban a cada 25s por polling de 1.5s é indistinguível de push para o usuário.

`// ponytail: polling. Trocar por SSE se a fila passar de ~50 pessoas simultâneas ou o poll pesar no banco.`

### 2.6 Estado da fila no banco, não em memória

`throttle.ts` usa `Map` em memória e está certo para instância única — mas **push na API é deploy em produção**, e fila em memória evapora a cada deploy, no meio da noite de ranqueada. Fila vira tabela (`queue_entries`) com heartbeat; o matchmaker é um `setInterval` de 3s dentro do próprio processo Fastify. Sem Redis, sem worker separado, sobrevive a restart.

---

## 3. Fases de entrega

Ordenadas por **risco decrescente**: o que pode dar errado no Pascal vem primeiro, porque é o que pode matar o projeto inteiro. Rating é a última coisa incerta (é uma lib npm).

---

### Fase 0 — "A partida acaba, e a API sabe quem ganhou"

**Risco: máximo.** Se essa fase não fechar, nada do resto existe.

**Entrega sozinha:** histórico de partidas real no launcher e no perfil — quem jogou, quem venceu, quanto durou. Mata os placeholders de Partidas, Perfil e "Última partida" da Home. **Sem rank, sem fila, sem lobby.** Vale para qualquer partida MP no servidor do Kam Brasil, não só ranqueada.

**Pascal:**
- `src/game/KM_Game.pas:1191/1239` — `PlayerVictory`/`PlayerDefeat` chamam `gNetworking.OnMPGameInfoChanged`.
- `src/game/KM_Game.pas:3063+` (`UpdateGame`, junto do bloco do `AnnounceGame`) — check de encerramento: se toda hand humana tem `WonOrLost <> wolNone`, ou só resta um time com hands vivas, a partida se conclui **no mesmo tick em todas as máquinas**.
- `src/net/KM_Networking.pas` — **um** método novo `PlayerLostConnection(aHand)` que emite `gicGamePlayerDefeat`, chamado pelos três caminhos de saída: `HandleMessagePlayerDisconnected` (`:1410`, já funciona), `mkClientLost` (`:1943-1978`, hoje não derrota) e `DropPlayers` (`:444-471`, hoje não derrota). Fix na função compartilhada, não em cada chamador.
- `src/net/KM_NetServer.pas` — ao ver `GameInfo` com todos os `WonOrLost` definidos (ou sala esvaziada), monta e enfileira o GET de reporte na fila HTTP que já existe.
- `src/net/KM_NetServerLocator.pas` — nova URL de reporte, ao lado das 4 existentes.

**API:**
- Entidades `matches` e `match_players` + migration.
- `GET /internal/ranked/report` (segredo + allowlist de IP), idempotente por `matchId`.
- `GET /matches`, `GET /matches/:id`, `GET /accounts/:id/matches`.

**Launcher:** `Partidas.vue` e a carta "Última partida" da Home passam a ler partida de verdade em vez de save do disco.

**Como se verifica:**
1. Duas máquinas, 1x1 no servidor de teste. A perde por goal → linha em `matches` com `winnerTeam` correto e dois `match_players` com o `wonOrLost` certo.
2. Repetir matando o processo do perdedor com o gerenciador de tarefas (desconexão suja). Antes: partida trava para sempre. Depois: derrota registrada, partida encerra, linha no banco.
3. Repetir com o host saindo primeiro.
4. Teste na API: reporte com segredo errado → 403; reporte duplicado do mesmo `matchId` → 200 sem duplicar linha.

---

### Fase 1 — "O launcher abre o jogo já dentro da sala certa, e travada"

**Risco: alto.** Segundo maior desconhecido: auto-join e travamento.

**Entrega sozinha:** partida organizada — um admin (ou um botão "jogar com amigo") cria a sala pela API, os dois clicam, os dois caem na mesma sala com mapa/time/loc definidos, sem poder mudar nada. Ainda sem fila e sem rank.

**Pascal:**
- `src/net/KM_NetTypes.pas:240-266` — `TKMPGameFilter` ganha `Locked`, `MatchId`, e a atribuição slot→nickname→team→loc. `Save`/`Load` já existem (`:320-341`) e o transporte já acontece no join.
- `src/net/KM_KamBrasilAuth.pas` — ler `KAMBRASIL_MATCH_FILE` (mesmo padrão do `KAMBRASIL_TOKEN_FILE`: env var → arquivo temp → lê uma vez → apaga). Conteúdo: `ip;porta;sala;senha;matchid`.
- `src/KM_GameApp.pas` / menu — se a env var existir, pular o menu principal e conectar direto na sala.
- `src/gui/pages_menu/KM_GUIMenuLobby.pas` — `and not Locked` em `canEdit`/`hostCanEdit` (`:1866-1884`), `UpdateGameOptionsUI` (`:2606-2618`), lista de mapas (`:2027+`) e `Button_Start` (start vem do servidor).
- `src/gui/KM_InterfaceGamePlay.pas:1114` — esconder `Button_NetDropPlayers` em sala travada; `KM_Networking.pas:1122` — bloquear `VoteReturnToLobby` (é porta de fuga: em ranqueada, quem está perdendo vota pra voltar ao lobby).
- `src/net/KM_NetServer.pas` — polling das reservas (`GET /internal/ranked/rooms`); recusar join fora da lista; validar `mkPlayersList`/`mkGameOptions`/`mkStart` contra a reserva (mesmo padrão de `CheckAskToJoinNickname`, `:463-514`).
- `src/net/KM_Networking.pas:1471` — passar a **chamar** `CalculateGameCRC` (hoje declarado e sem nenhum chamador) e enviar o CRC do EXE junto do `mkAuthToken`. O servidor compara com a lista de builds válidas da API.

**Launcher:** `launch_game` em `src-tauri/src/game.rs` aceita parâmetro opcional de partida e escreve o `KAMBRASIL_MATCH_FILE` do mesmo jeito que já escreve o token.

**Como se verifica:**
1. Dois launchers, botão de entrar; os dois abrem o jogo direto na sala 3 com mapa X, times e locs corretos.
2. No cliente host: todos os dropdowns cinzas, lista de mapas com um item só, sem botão de start, sem voto de voltar ao lobby, sem botão de drop.
3. Cliente modificado (build de teste com a UI destravada na mão) tentando trocar o mapa: o servidor rejeita o `mkGameOptions` e a partida não inicia.
4. Uma terceira conta tentando entrar na sala pelo servidor normal: recusada.

**Honestidade:** travar a UI só impede o jogador honesto. O que impede o desonesto é a validação server-side do passo acima — e ela precisa cobrir `mkPlayersList`, `mkGameOptions` e `mkStart`, senão sobra brecha. Se um `mkStart` chegar divergente da reserva, a partida nasce marcada `invalid` e não conta.

---

### Fase 2 — "Fila e lobby de bans: ranqueado jogável ponta a ponta"

**Risco: médio.** É código de API e Vue, terreno conhecido.

**Entrega sozinha:** o ciclo completo — entrar na fila, ser pareado, banir mapa alternado, sorteio, jogo abre travado, resultado volta. **Ainda sem rating**: todo mundo com `mu=25`, pareamento por ordem de chegada. O ranqueado está jogável e o rank é a única peça faltando.

**Somente 1x1 e 2x2 no lançamento.** 4x4 exige 8 pessoas simultâneas na fila; abrir os quatro modos de cara garante fila vazia em três deles e a sensação de sistema morto. 3x3 e 4x4 entram quando a fila de 2x2 estiver enchendo sozinha.

**API:** entidades `seasons`, `maps`, `season_maps`, `queue_entries`, `lobbies`, `lobby_players`; matchmaker em `setInterval` de 3s; máquina de estados do lobby (`ban → draw → launch → live → done`) com deadline por turno; alocação de salas ranqueadas.

**Launcher:** duas telas novas no registro `TELAS` do `Shell.vue` (FILA, LOBBY) — uma linha cada. O estado da fila segue o molde de `install.ts` (store de módulo + `status` computed + dispatcher). O CSS já existe em `theme.css`.

**Como se verifica:**
1. Duas contas entram na fila 1x1 → lobby em segundos → 6 bans alternados 1 por vez → sorteio entre 4 → jogo abre → partida registrada com `lobbyId`.
2. Ficar parado no turno de ban por 25s → ban aleatório automático, o lobby não trava.
3. Fechar o launcher depois do sorteio (dodge) → ban de fila de 5 min, e 15 min na segunda vez no mesmo dia.
4. Um dos dois sai da fila antes do pareamento → o outro continua na fila, sem lobby órfão.

---

### Fase 3 — "O rank aparece"

**Risco: baixo.** `bun add openskill` e aritmética.

**Entrega:** rating, MD10, tiers nomeados, temporada persistida, leaderboard do apex, "Colocação 4/10" no launcher. Como as partidas da Fase 2 já ficaram gravadas com `mode` e times, **dá para rodar o rating retroativo sobre o histórico** e a temporada começa com todo mundo já calibrado.

**API:** entidade `player_ratings`; `applyMatchResult` (30 linhas, incluindo o piso de σ); tiers com histerese; recalibração de cortes por temporada; `GET /ranked/me`, `GET /ranked/leaderboard`.

**Launcher:** `Ranking.vue` (troca os dois `EmBreve` por divisões reais + leaderboard), badge de tier no `Shell.vue`, tier no lobby, últimos 10 V/D no perfil.

**Como se verifica:**
1. Teste unitário: 10 partidas simuladas de um jogador que ganha tudo → sai da colocação em tier alto; que perde tudo → tier baixo; σ termina acima de 2.5 e abaixo de 8.34 sempre.
2. Teste: 200 updates seguidos com σ no piso → `c` não deriva sozinho.
3. Teste de histerese: jogador exatamente no limiar perde uma partida → **não** rebaixa; perde duas seguidas abaixo de `limiar − 1.0` → rebaixa.
4. Conferir no cliente que nenhuma resposta da API contém `mu`, `sigma` ou `c` (teste de contrato sobre o schema das rotas públicas).

---

### Fase 4 — "Crônica: replay e relatório"

**Entrega:** replay guardado no perfil, relatório detalhado da partida, estatísticas por jogador.

- Pascal: `KM_GameApp.pas:620-626` — hoje o autosave de fim de partida está **desligado por padrão** (`AutosaveAtGameEnd`, `KM_GameSettings.pas:420`) e ainda por cima só roda com `GameResult in [grWin, grDefeat]`. Em ranqueada, salvar incondicionalmente com nome determinístico = `matchId`, e `WaitForSaveToBeDone` antes de liberar.
- Launcher: sobe `.bas` + `.rpl` (o `.rpl` é pequeno; o `.bas` é o savegame inicial, alguns MB) por POST autenticado. Dispensar `.sav` e `.spt`.
- Verificação de graça: o save MP é gerado **byte-idêntico em todos os clientes** de propósito (`KM_Game.pas:2042`, comentário em `:2185-2189`). CRC divergente entre participantes = fraude ou desync, e a partida é marcada inválida.
- Stats: reaproveitar o que `TKMHandsCollection.ExportGameStatsToCSV` (`KM_HandsCollection.pas:1276-1350`) **já monta hoje** e ninguém usa — hoje só é chamado por um item de menu de debug (`KM_FormMain.pas:1031`). É o esqueleto do relatório, pronto.

**Como se verifica:** jogar uma ranqueada, abrir o replay do perfil no cliente e ele reproduzir até o fim; CRC dos dois `.bas` batendo.

---

### Fase 5 — Anti-fraude econômico

- Teto por par por dia: 3 primeiras partidas contra o mesmo adversário valem cheio, da 4ª em diante peso 0.25.
- Flag automática: >40% das partidas da temporada contra o mesmo oponente → revisão manual.
- Duração mínima: partida com menos de 5 min não conta para rating nem para as 10 colocações.
- Papel de admin nas contas (hoje é `x-admin-token` global) + seed manual de `mu` inicial (30–33) para jogadores que a comunidade já sabe que são fortes, registrando quem fez o seed.

---

## 4. Modelo de dados

**Novas entidades** (TypeORM, `synchronize: false`, migration por fase):

```
seasons          id, nome, numero, inicioEm, fimEm, ativa,
                 cortesTier jsonb (congelados no início), criadoEm

maps             id, nome, mapCrc (unique), modos text[], ativo

season_maps      seasonId, mapId, ordem            -- os 10 da temporada

player_ratings   accountId, seasonId,  (unique juntos)
                 mu double, sigma double,
                 rankedMatches int, placementDone bool,
                 tier text, tierSince, demotionStrikes int,
                 lastRankedAt, seededBy uuid null

queue_entries    id, accountId (unique), modos text[], seasonId,
                 entrouEm, lastSeenAt, estado ('waiting'|'matched'),
                 lobbyId null

lobbies          id, seasonId, mode, estado ('ban'|'draw'|'launch'|'live'|'done'|'aborted'),
                 turnoTime ('A'|'B'), turnoPrazo timestamptz,
                 mapasBanidos uuid[], mapaEscolhidoId,
                 serverIp, serverPort, roomIndex, roomSenha,
                 matchId null, criadoEm

lobby_players    lobbyId, accountId, nickname, time ('A'|'B'), startLocation,
                 status ('ok'|'dodged'), muNoPareamento double

matches          id, lobbyId null, seasonId, mode,
                 mapId, mapCrc, randomSeed, gameRevision, exeCrc,
                 iniciadoEm, encerradoEm, duracaoTicks,
                 status ('pending'|'valid'|'invalid'),
                 invalidMotivo null, timeVencedor ('A'|'B'|null),
                 fonte ('dedicated'|'manual'), replayCrc null

match_players    matchId, accountId, nickname, handIndex, time,
                 wonOrLost ('won'|'lost'|'none'),
                 muBefore, sigmaBefore, muAfter, sigmaAfter, peso,
                 statsJson jsonb null,      -- enriquecimento do cliente
                 abandonou bool
```

**Alteradas:**

- `accounts` — `+ isAdmin bool default false`, `+ queueBanUntil timestamptz null`, `+ queueBanCount int default 0`, `+ queueBanDia date null`.
- `match_reports` — **fica como está**, é telemetria de mapa e não atrapalha ninguém. Não vamos migrar nem apagar.
- `catalog.ts` — a constante `SEASON` hard-coded passa a ler de `seasons`; `ACHIEVEMENTS` continua constante (progresso é Fase 4+).

**Por que guardar `mu_before`/`mu_after` em toda partida:** é a única forma de auditar uma reclamação, de recalcular a temporada inteira se um parâmetro mudar, e de detectar win-trading depois do fato. E guardar `mode` mesmo com rating único deixa a porta aberta para separar modos no futuro sem jogar o histórico fora. Custo: duas colunas.

---

## 5. Contrato das rotas

**Públicas / autenticadas (launcher):**

| Método | Caminho | Formato |
|---|---|---|
| `POST` | `/ranked/queue` | `{modes:["1v1","2v2"]}` → `202 {estado:"waiting"}` |
| `DELETE` | `/ranked/queue` | `204` |
| `GET` | `/ranked/queue/status` | `{estado, esperaSeg, modos, lobbyId?}` — poll 3s |
| `GET` | `/ranked/lobby/:id` | `{estado, mode, times:[{nickname,tier,time,loc}], mapas:[{id,nome,estado:"livre"\|"banido"}], turnoTime, turnoPrazo, mapaEscolhido?, launch?:{ip,porta,sala,senha}}` — poll 1.5s |
| `POST` | `/ranked/lobby/:id/ban` | `{mapId}` → `200` \| `409` (não é seu turno) |
| `GET` | `/ranked/me` | `{tier, tierDesde, colocacao:{feitas,total}, ultimos10:["V","D",...], partidas}` — **nunca mu/sigma/c** |
| `GET` | `/ranked/leaderboard` | `[{posicao, nickname, tier}]` — só o apex |
| `GET` | `/matches?accountId=&limit=&before=` | histórico paginado por cursor |
| `GET` | `/matches/:id` | relatório: mapa, duração, times, vencedor, stats se houver, replay se houver |
| `POST` | `/matches/:id/replay` | multipart `.bas` + `.rpl`, autenticado, só participante, não-autoritativo |

**Internas (servidor dedicado — segredo na querystring + allowlist de IP, `logLevel: silent`, resposta texto puro, mesmo padrão de `/auth/verify`):**

| Método | Caminho | Formato |
|---|---|---|
| `GET` | `/internal/ranked/rooms?secret=` | texto, uma linha por sala reservada: `room=3;match=<uuid>;mapcrc=A1B2C3D4;pt=15;spd=1;lock=1;p=nick:A:0;p=nick:B:1` |
| `GET` | `/internal/ranked/started?secret=&match=&seed=&tick=` | `ok` — a partida iniciou de fato |
| `GET` | `/internal/ranked/report?secret=&match=&winner=A&ticks=18240&p=nick:A:won&p=nick:B:lost` | `ok` — **idempotente por match**; segunda chamada não recalcula rating |
| `GET` | `/internal/ranked/void?secret=&match=&reason=desync` | `ok` — invalida a partida |
| `GET` | `/internal/ranked/build?secret=&crc=` | `ok` \| `deny` — validação do CRC do EXE |

Todas as internas respondem texto puro porque o `TKMHTTPClient` do jogo é um GET assíncrono simples e parsear JSON no Pascal seria trabalho por nada.

---

## 6. O que muda no Pascal

Por arquivo, com o motivo:

**`src/game/KM_Game.pas`**
- `:1191` `PlayerVictory` e `:1239` `PlayerDefeat` — chamar `gNetworking.OnMPGameInfoChanged`. *Duas linhas que fazem o servidor finalmente ver o resultado.*
- `:3063-3092` `UpdateGame` — bloco de encerramento determinístico (mesmo lugar onde hoje mora o `AnnounceGame`). Todas as hands humanas com `WonOrLost` definido, ou um único time vivo → conclui a partida, no mesmo tick para todos.
- `:2345-2450` `Save` / `:2309` `WaitForSaveToBeDone` — em ranqueada, salvar com nome = `matchId` e esperar o worker terminar antes de liberar o upload.

**`src/net/KM_Networking.pas`**
- **Novo** `PlayerLostConnection(aHand)` emitindo `gicGamePlayerDefeat` — chamado por `HandleMessagePlayerDisconnected` (`:1410`, já correto), `mkClientLost` (`:1943-1978`, **hoje não derrota**) e `DropPlayers` (`:444-471`, **hoje não derrota**). Um ponto, três chamadores, comportamento idêntico nos três casos de saída.
- `:1122` `VoteReturnToLobby` — bloqueado se `NetGameFilter.Locked`.
- `:1471` `CalculateGameCRC` — **passar a chamar** (hoje é código órfão) e enviar junto do `mkAuthToken`.
- `:2583-2648` `AnnounceGameInfo` — já serializa `WonOrLost` (`:2632-2637`); nada a mudar além do gatilho acima.

**`src/net/KM_NetTypes.pas:240-266`** — `TKMPGameFilter` ganha `Locked`, `MatchId` e a atribuição slot→nickname→team→loc. `Save`/`Load` (`:320-341`) já existem e o objeto já viaja no join.

**`src/net/KM_NetServer.pas`**
- `:404-560` — reaproveitar a fila HTTP do auth para: polling das reservas, reporte de início, reporte de resultado, invalidação. Lembrar das duas lições já pagas e documentadas: `TKMHTTPClient` atende **uma requisição por vez**, e no FPC o cliente só avança quando bombeado de `UpdateStateIdle` (`:688-691`).
- `:463-514` `CheckAskToJoinNickname` — estender: em sala reservada, só entra quem está na lista.
- `:811-814` `mkConnectedToRoom` — mandar o `GameFilter` com o bloco travado.
- `:1100-1360` — validar `mkPlayersList`, `mkGameOptions` e `mkStart` contra a reserva antes de repassar. É aqui que o travamento deixa de ser cosmético.
- `:1188-1192` `mkSetGameInfo` — detectar resultado completo e disparar o reporte.

**`src/net/KM_KamBrasilAuth.pas`** — ler `KAMBRASIL_MATCH_FILE` (mesmo padrão do token: env var → arquivo → lê uma vez → apaga o arquivo).

**`src/net/KM_NetServerLocator.pas`** — as rotas internas, ao lado das 4 existentes. Só GET, resposta ignorada (exceto a de reservas e a de build).

**`src/gui/pages_menu/KM_GUIMenuLobby.pas`** — `and not Locked` em `canEdit`/`hostCanEdit` (`:1866-1884`), `UpdateGameOptionsUI` (`:2606-2618`), `UpdateMapList` (`:2027+`) e `Button_Start` (`:661`). O clamp de PT/velocidade pelo filtro (`:1666-1672`) já existe e passa a receber faixa de um valor só.

**`src/gui/KM_InterfaceGamePlay.pas`** — `:1114` esconder `Button_NetDropPlayers` em sala travada; `:2758` o painel "continuar jogando" some (a partida encerra sozinha).

**`src/game/gip/KM_GameInputProcess_Multi.pas:323-357`** — `DoRandomCheck`: hoje um desync faz `raise Exception` e derruba tudo sem registrar nada. Em ranqueada, avisar o servidor (`/internal/ranked/void`) **antes** de morrer. Nunca deixar desync virar derrota de quem crashou.

**`src/settings/KM_ServerSettings.pas`** — config das novas URLs internas e do segredo, ao lado de `KamBrasilAuthVerifyUrl` (`:182`).

---

## 7. Riscos e o que fazer com eles

**Abandono (saída limpa) — resolvido, já funciona.** `PrepageStopGame` → `mkDisconnect` → host emite `gicGamePlayerDefeat`, executado em todos os clientes de forma determinística. Quem abandona fica `wolLost`. Adicionar: ban de fila escalonado no mesmo dia (5/15/60 min), sem exceção — senão sair vira a saída padrão de toda partida perdida. Durante a colocação, abandono conta como derrota cheia e consome uma das 10.

**Desconexão suja — é o buraco, e é a Fase 0.** Alt+F4, queda de rede, kill do processo: `mkClientLost` não emite derrota, a hand fica viva com casas e exército parados, e ninguém consegue satisfazer o goal de vitória até destruir tudo fisicamente. Rage-quit matando o processo = partida que não termina nunca. Corrigido pelo `PlayerLostConnection` compartilhado. Janela de reconexão (`AttemptReconnection`, `KM_Networking.pas:1755`): 90 segundos decididos pelo **servidor**, não pelo host no olho.

**Desync — invalidar, nunca punir.** Cliente que dessincroniza avisa o servidor e a partida vira `invalid`: não conta para rating nem para as 10 colocações. Agravante conhecido e documentado deste fork: `ALLOW_MP_MODS = True` significa que `.dat` divergentes causam desync esperado contra clientes oficiais. Em sala ranqueada, exigir o CRC do EXE conferido (Fase 1) fecha isso por construção. Se as partidas inválidas passarem de ~5%, o problema é build divergente na comunidade e o conserto é distribuição, não código.

**Cliente modificado — piso forte, teto honesto.** O piso: lockstep determinístico significa que `WonOrLost` não pode ser falsificado *dentro* da partida, e os cheats de debug estão desligados em release. O teto: **este fork desligou as três verificações de integridade** — `DBG_SKIP_SECURE_AUTH` faz `ValidateSolution` retornar sempre `True` (`KM_NetAuthUnsecure.pas:31-38`), `CalculateGameCRC` está sem chamador, e `ALLOW_MP_MODS` está forçado a `True`. Hoje não há nenhuma verificação de que o cliente é o oficial. A Fase 1 reintroduz a mais barata (CRC do EXE junto do `mkAuthToken`), e é preciso dizer com todas as letras: **isso é obstáculo, não segurança** — um cliente modificado pode mentir o CRC. A defesa real é a soma de três coisas: o resultado vem do servidor, o determinismo impede mentir durante a partida, e os replays de todos os participantes têm que bater. **Maphack e revelar fog continuam indetectáveis** — não alteram o estado simulado, não dessincronizam, não mudam quem venceu, só mudam quem *merecia* vencer. Isso não tem solução técnica nessa engine; tem solução social (banimento por denúncia com replay).

**Win-trading — o maior risco real numa comunidade de dezenas.** Com 60 pessoas, dois combinados manipulam o topo em uma semana. Teto por par por dia, flag automática em >40% das partidas contra o mesmo oponente, duração mínima de 5 min, e todo resultado autoritativo do servidor. Fase 5, mas o dado para detectar (`mu_before`/`mu_after`/`mode` em toda partida) começa a ser gravado na Fase 0.

**Comunidade pequena demais — o risco mais provável de todos.** Um sistema perfeito com fila vazia é um sistema morto. Medidas: **fila única com marcação de modos** (filas separadas por modo fragmentam uma população que já é pequena — é o erro clássico e fatal de ladder de comunidade); **abrir só com 1x1 e 2x2**; janelas de fila anunciadas no Discord; faixa de pareamento que abre com o tempo de espera (2.0 → 9.0 de `|Δmu|`) mas **nunca passa de 9.0**, e nunca fura o bloqueio de 2 tiers de diferença. Se em 5 minutos não sai partida, o problema é população, não parâmetro — e alargar a faixa "só dessa vez" abre o precedente que mata a credibilidade do ranqueado inteiro. É o único item desta lista cuja mitigação principal não é código.

**Inflação e rating preso — mesmo remédio.** `c = mu − 2σ` sobe sozinho enquanto σ encolhe; sem o piso de σ = 2.5 todo mundo infla de tier sem jogar melhor, e o veterano com σ≈1.2 congela. O piso resolve os dois. Deflação: **não decair `mu` por inatividade** — só marcar "Inativo" no perfil após 45 dias. Decair `mu` criaria o incentivo perverso de esperar o rival sumir para farmar a diferença.

**O host ainda é um jogador.** Mitigado, não eliminado. A validação server-side tira o poder dele; o voto de voltar ao lobby e o botão de drop são desligados. Se um `mkStart` chegar divergente da reserva, a partida nasce inválida. É o melhor que dá sem host-bot.

---

## 8. O que NÃO vamos fazer agora

- **WebSocket / SSE.** Dependência nova, mudança na CSP do Tauri, segundo caminho de estado. Polling de 1.5s num turno de ban de 25s é indistinguível de push. *Reavaliar se a fila passar de ~50 simultâneos.*
- **Host-bot headless no servidor.** Único jeito de "dono = servidor" literal, e exigiria rodar um cliente KaM gráfico completo por partida numa VM. Custo e fragilidade altos para fechar uma brecha que a validação server-side já fecha na prática.
- **`PostURL` no cliente HTTP do Pascal.** O resultado autoritativo cabe em querystring; o payload pesado sobe pelo launcher, que já tem HTTP completo e autenticado.
- **3x3 e 4x4 no lançamento.** Exigem 6 e 8 pessoas simultâneas. Entram quando a fila de 2x2 estiver enchendo sozinha. O código não muda — é uma flag na temporada.
- **Peso por modo no rating.** O Weng-Lin já dilui o crédito em times grandes por construção (delta ∝ `σ_i²/σ_time²`). Ligar um peso antes de ter uma temporada de dados é otimizar contra um problema imaginário — e sem a temporada de referência não dá para saber se melhorou. Fica como flag de config desligada.
- **Divisões I/II/III dentro do tier.** 18 caixas para ~60 pessoas é rank que não significa nada.
- **Barra de progresso dentro do tier.** É vazamento de pontos disfarçado, e o requisito explícito é que o jogador nunca veja pontuação. Substituto: últimos 10 resultados V/D.
- **Progresso de conquistas e missões semanais.** Dependem de estatística por jogador, que só chega na Fase 4. Os `EmBreve` de Conquistas e Temporada ficam onde estão.
- **Grupos / party na fila.** Complica pareamento e é vetor de win-trading. Depois de uma temporada.
- **Anti-cheat de memória / detecção de maphack.** Não existe caminho viável nesta engine. A resposta é replay + denúncia + banimento manual.
- **Migrar ou apagar `match_reports` e o `maps.php`.** Funcionam, são telemetria de mapa, não custam nada e não atrapalham. `matches` nasce ao lado.
- **Redis / fila distribuída / segunda instância.** A API é instância única por design; `queue_entries` numa tabela com `setInterval` de 3s cobre a comunidade inteira com folga de duas ordens de grandeza.

---

**Comece pela Fase 0.** Ela é a única que pode revelar que o plano inteiro não fecha, e é a única que entrega valor real mesmo se todo o resto for cancelado: histórico de partidas de verdade, para qualquer partida MP, com quem jogou e quem ganhou.

---

## Anexo — parâmetros do sistema de rating

### recomendacao

**OpenSkill (Weng-Lin), modelo Plackett-Luce**, via a lib npm `openskill` (v5.0.1, licença MIT, tipos TypeScript nativos — `bun add openskill`).

Um único par `(mu, sigma)` por jogador, usado igualmente em 1x1, 2x2, 3x3 e 4x4. Atualização **online por partida** (não há "período de rating"). O jogador nunca vê `mu`/`sigma`; vê só o tier derivado de `c = mu − 2σ`.

Descartados: TrueSkill (patente/marca — detalhe em `riscos`/`alternativas`), Glicko-2 (não tem modelo de time nativo e exige período de rating com 10–15 jogos por jogador, inviável aqui), Elo (sem incerteza → colocação de 10 partidas e pareamento seguro ficam ruins).

### porque

1. **É o único dos quatro que resolve o requisito central sem gambiarra.** O requisito "um rating só para 1x1, 2x2, 3x3 e 4x4" é nativo no Weng-Lin: `rate([[a,b,c,d],[e,f,g,h]])` devolve rating individual atualizado a partir do resultado do time. Com Glicko-2 ou Elo você teria que inventar uma média de time e distribuir o delta na mão — e essa parte inventada é exatamente onde ladders de comunidade quebram.

2. **Incerteza explícita (σ) resolve as 10 colocações de graça.** Um jogador novo entra com σ alto, se move muito nas primeiras partidas e vai travando sozinho. Não precisa de K-factor decrescente feito à mão, nem de "modo colocação" separado no cálculo. Também é o que permite parear com segurança um jogador sem histórico.

3. **Comunidade pequena = poucas amostras = a incerteza precisa estar no modelo, não no chute.** Com dezenas de jogadores, um Elo simples fica ou lento demais (K baixo, rank preso por meses) ou barulhento demais (K alto, oscila a cada partida). O σ resolve isso automaticamente: rápido no começo, estável depois.

4. **Atualização por partida, não por período.** Glickman recomenda período de rating com 10–15 jogos por jogador. Numa comunidade de dezenas de pessoas isso significaria período mensal — o rank atualizaria uma vez por mês. Inaceitável para um ladder que precisa parecer vivo.

5. **Licença sem dúvida nenhuma.** MIT, sem patente, sem marca. O OpenSkill foi criado literalmente para ser a alternativa livre ao TrueSkill, e o paper mostra acurácia de predição competitiva com ele (e ~1 ordem de grandeza mais rápido, irrelevante nessa escala, mas não atrapalha).

6. **Já existe em TypeScript.** A API (Fastify + TypeORM + Bun) consome direto: `rating()`, `rate()`, `ordinal()`, `predictWin()`. Zero código de matemática Bayesiana escrito por você = zero bug de matemática Bayesiana escrito por você.

### parametros

## Valores (escala nativa do OpenSkill, não mexer na escala)

| Parâmetro | Valor | Observação |
|---|---|---|
| `model` | `plackettLuce` | padrão da lib; usar para **todos** os modos |
| `mu` inicial | `25.0` | |
| `sigma` inicial | `25/3 = 8.3333` | |
| `beta` | `25/6 = 4.1667` | padrão; **não mexer** — define a "largura de uma classe de skill" |
| `kappa` | `0.0001` | padrão |
| `tau` (colocação) | `0.25` | primeiras 10 partidas → convergência ~3x mais rápida |
| `tau` (normal) | `25/300 = 0.08333` | da 11ª partida em diante |
| `preventSigmaIncrease` | `true` | σ nunca passa de 8.3333 |
| **piso de σ** | `2.5` | aplicado na mão após cada update — **o parâmetro mais importante da lista** |
| Período de rating | a própria partida | atualização online |
| Score interno | `c = mu − 2σ` | nunca exibido; usado só para tier |
| Empates | **não existem** | sempre passar `rank: [0,1]` ou `[1,0]` |

**Por que o piso de σ = 2.5 é crítico:** sem ele, um veterano chega a σ ≈ 1.2 e fica congelado — não sobe mesmo melhorando, não desce mesmo enferrujando. Numa comunidade pequena isso mata o ladder. O piso mantém todo mundo móvel para sempre, e de quebra trava a deriva de `c` (ver `tiers`).

## Código de atualização (é isso, inteiro)

```ts
import { rating, rate, ordinal, predictWin } from 'openskill'

const SIGMA_MIN = 2.5, SIGMA_MAX = 25 / 3

const clamp = (r: {mu: number, sigma: number}) => ({
  mu: r.mu,
  sigma: Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, r.sigma)),
})

// vencedores primeiro; funciona igual para 1x1 e 4x4
function aplicarResultado(vencedores: Rating[], perdedores: Rating[], emColocacao: boolean) {
  const [v, p] = rate([vencedores, perdedores], {
    tau: emColocacao ? 0.25 : 25 / 300,
    preventSigmaIncrease: true,
  })
  return [v.map(clamp), p.map(clamp)]
}

// score interno para tier (nunca vai para o cliente)
const score = (r: Rating) => r.mu - 2 * r.sigma   // === ordinal(r, { z: 2 })
```

## Persistência

- `players`: `mu double`, `sigma double`, `ranked_matches int`, `placement_done bool`, `tier text`, `tier_since timestamptz`, `last_ranked_at timestamptz`, `season_id`.
- `match_players`: `mu_before`, `sigma_before`, `mu_after`, `sigma_after`, `weight`, `mode` (`1v1`/`2v2`/`3v3`/`4v4`), `team`, `won`.

Guardar o **antes e depois de cada partida** não é luxo: é a única forma de auditar uma reclamação, recalcular a temporada inteira se você mudar um parâmetro, e detectar win-trading depois. Guardar `mode` mesmo com rating único deixa a porta aberta para separar modos no futuro sem perder dados.

## Inatividade

- +`0.35` de σ a cada 30 dias sem partida ranqueada, teto `6.0`. **Nunca mexer em `mu`.**
- 45 dias sem jogar → rank marcado como "Inativo" no perfil (não some, não decai).

## Reset de temporada (soft reset)

```
mu'    = 25 + 0.75 * (mu - 25)     // puxa 25% para o centro
sigma' = max(sigma, 5.5)
```
3 partidas de recolocação para reexibir o rank (não 10 — o histórico não foi jogado fora).

### colocacao

**10 partidas, rating atualizando desde a partida 1.** Não existe "acumular e calcular no fim" — isso joga informação fora e faz o jogador ser pareado às cegas 10 vezes seguidas.

- **`tau = 0.25`** nessas 10 partidas (vs `0.0833` normal). Isso mantém a incerteza alta e faz cada resultado mover bem mais `mu`. Efeito prático: um jogador realmente forte sai da média em ~4–5 partidas, não em 30.
- **Launcher mostra "Colocação 4/10"**, nunca um rank, nunca pontos, nem sequer "você está indo bem". Zero sinal.
- **Pareamento durante a colocação:** faixa inicial larga (`|Δmu| ≤ 6.0` já a partir de 0s, porque σ alto significa que o sistema realmente não sabe). Preferir, quando houver, outros jogadores em colocação — dois σ altos se resolvem rápido e ninguém "estraga" a partida de um ranqueado.
- **Rank inicial** calculado ao fim da 10ª com `c = mu − 2σ`. Como σ ainda está em ~4.0–5.0, `c` fica ~5 pontos abaixo do valor de equilíbrio → **a colocação é deliberadamente conservadora**. O jogador nasce um tier abaixo do que "merece" e sobe nas ~15 partidas seguintes conforme σ encolhe até o piso.

  Isso é escolha de design, não bug: subir é sensação boa e não gera rebaixamento; começar alto demais e cair é a pior experiência possível num ladder pequeno onde todo mundo se conhece.
- **Seed manual por admin:** permitir setar `mu` inicial entre 30 e 33 (σ fica 8.3333) para jogadores notoriamente fortes que a comunidade já conhece. Numa comunidade de dezenas de pessoas isso é informação real e gratuita — usar é mais honesto do que fingir que todo mundo é média. Registrar quem fez o seed.
- **Abandono durante a colocação** conta como derrota cheia e consome uma das 10.

### pareamento

A chave de comparação é **`mu`**, não `c`. Usar `c` na fila penalizaria a incerteza duas vezes (uma no rating, outra no pareamento) e afundaria todo jogador novo.

## 1x1 — faixa que abre com o tempo de fila

| Tempo na fila | `|Δmu|` máx. | ≈ prob. do favorito |
|---|---|---|
| 0–30s | 2.0 | ~62% |
| 30–60s | 3.5 | ~70% |
| 60–120s | 5.0 | ~77% |
| 120–240s | 7.0 | ~85% |
| > 240s | **9.0 (teto duro)** | ~90% |

A faixa **nunca** passa de 9.0. Fila vazia = espera, não partida injusta. Numa comunidade pequena, a tentação de "só dessa vez" abre o precedente que mata a credibilidade do ranqueado.

## Travas absolutas (valem em qualquer tempo de fila)

- **Nunca parear com mais de 2 tiers nomeados de diferença.** Este é o requisito do dono ("impedindo ranks muito distintos") e ele é um bloqueio duro, não um custo na função de match.
- **Nunca** parear Bárbaro/Comandante com Recruta, em hipótese nenhuma.
- Gate final antes de fechar o lobby: `predictWin([timeA, timeB])` — se algum lado passar de `0.85`, rejeita e devolve para a fila.

## 2x2 / 3x3 / 4x4

1. Junta `2N` jogadores cuja **média de `mu`** cabe na faixa da tabela acima.
2. **Spread do lobby:** `mu_max − mu_min ≤ 8.0` (relaxa para `11.0` após 4 min). Sem isso você monta um 4x4 com um Bárbaro e um Recruta na mesma sala, times "equilibrados" na soma e desequilibrados na prática.
3. **Montagem dos times:** ordena por `mu` e faz snake draft (1º→A, 2º→B, 3º→B, 4º→A...), depois 1 passe de troca de pares tentando reduzir `|Σmu_A − Σmu_B|`. Greedy resolve; não vale escrever otimizador.
4. **Aceita o lobby só se** `|Σmu_A − Σmu_B| ≤ 1.5 × N`.

## Regras de qualidade de fila (comunidade pequena)

- **Prioridade por tempo de espera**: quem está há mais tempo entra primeiro quando há empate de opções.
- **Anti-repetição (preferência, nunca bloqueio):** evitar repetir a mesma dupla/composição das últimas 2 partidas *se houver alternativa*. Com 8 pessoas online, bloquear repetição esvazia a fila.
- **Fila única com marcação de modos:** o jogador marca quais modos aceita (1x1, 2x2, 3x3, 4x4) e entra numa fila só. Filas separadas fragmentam uma população que já é pequena — esse é o erro clássico e fatal de ladder de comunidade.
- **Dodge (sair depois do sorteio de mapa):** ban de fila escalonado no mesmo dia — 5 min, 15 min, 60 min.

### times

**Não precisa de peso por modo. O modelo já faz isso sozinho.**

No Weng-Lin o delta individual é proporcional a `σ_i² / σ_time²`. Num 4x4, cada jogador absorve ~1/4 do movimento do time; num 1x1, 100%. Ou seja: a diluição do crédito em times grandes já está embutida, e um resultado de 4x4 naturalmente mexe menos no seu rating do que um 1x1. É exatamente o comportamento que você quer para um rating compartilhado, e vem de graça.

## Implementação

```ts
// idêntico para todos os modos — vencedores primeiro
rate([[a, b, c, d], [e, f, g, h]], { tau, preventSigmaIncrease: true })
```

Sem `partial play`, sem `weights`, sem empate (KaM ranqueado sempre termina com vencedor definido pelo servidor), sem `score` — só a ordem dos times.

## Knob que fica desligado

Se depois de **uma temporada inteira** os dados mostrarem que o 4x4 está injetando ruído (ex.: jogadores oscilando de tier só depois de noites de 4x4), ligue um peso por modo:

```ts
const W = { '1v1': 1.0, '2v2': 0.85, '3v3': 0.75, '4v4': 0.65 }
mu_final = mu + W[mode] * (mu_novo - mu)   // σ segue o modelo, sem peso
```

Deixe como flag de config **desligada no início**. Ligar isso antes de ter dados é otimizar contra um problema imaginário — e você não vai conseguir saber se melhorou, porque não terá a temporada de referência.

## O que registrar para poder mudar de ideia

Gravar `mode` em `match_players` mesmo com rating único. Se um dia o dono decidir separar 1x1 de team games, você recalcula as duas escalas a partir do histórico completo em vez de começar do zero. Custo: uma coluna.

### tiers

## 6 tiers + 1 apex por vaga

Com dezenas de jogadores, **não use divisões (I/II/III)** — 6 tiers × 3 divisões = 18 caixas para 60 pessoas = 3 pessoas por caixa = o rank não significa nada.

Score de tier: `c = mu − 2σ`, com σ preso em `[2.5, 8.3333]`.

| Tier (tema KaM) | Faixa de `c` | Alvo da população |
|---|---|---|
| Recruta | `c < 13` | ~10% |
| Miliciano | `13 ≤ c < 16.5` | ~20% |
| Machadeiro | `16.5 ≤ c < 20` | ~25% |
| Espadachim | `20 ≤ c < 23.5` | ~22% |
| Besteiro | `23.5 ≤ c < 27` | ~15% |
| Bárbaro | `c ≥ 27` | ~8% |
| **Comandante do Rei** | **vaga, não faixa** | top 5 do ladder entre os Bárbaros com ≥ 20 partidas na temporada |

Calibração de referência: jogador médio estabilizado (`mu = 25`, `σ = 2.5`) → `c = 20` → Espadachim baixo. Recém-colocado médio (`σ ≈ 4.5`) → `c ≈ 16` → Miliciano. Jogador forte (`mu = 33`, `σ = 2.5`) → `c = 28` → Bárbaro.

O tier apex por **vaga** (top N) em vez de faixa é o que faz um ladder pequeno ter topo: sempre existe exatamente um punhado de Comandantes, independente da escala ter inflado ou não.

## Estabilidade — as 3 regras que impedem oscilação

1. **Histerese:** promove quando `c ≥ limiar`. Rebaixa só quando `c < limiar − 1.0`. A banda morta de 1.0 ponto (≈ 28% da largura de um tier) absorve o vai-e-vem normal.
2. **Confirmação:** o rebaixamento exige **2 partidas consecutivas** abaixo de `limiar − 1.0`. Uma derrota azarada nunca rebaixa ninguém.
3. **Piso de σ = 2.5:** sem ele, `c = mu − 2σ` sobe sozinho conforme σ encolhe, e todo mundo inflaciona de tier sem jogar melhor. Com o piso, a deriva total de σ é limitada ao trecho colocação→equilíbrio (~4 pontos de `c`, uma única vez na vida do jogador) e depois para.

Resultado prático: o tier muda no máximo a cada ~3–5 partidas, não a cada partida.

## Recalibração por temporada (e só por temporada)

**No início** de cada temporada, recalcular os 5 cortes para bater com a distribuição alvo acima, usando os `c` finais dos jogadores com ≥ 10 partidas na temporada anterior. **Congelar os cortes pelo resto da temporada.**

- **Se houver menos de 30 jogadores ativos, não recalibrar** — a amostra é pequena demais e você só vai injetar ruído. Mantenha os cortes-semente da tabela.
- **Nunca use percentil ao vivo.** Com dezenas de jogadores, o tier de alguém mudaria porque *outra pessoa* jogou. É a receita mais rápida para o jogador perder a fé no sistema, e é indefensável no Discord.

## Exibição

- Perfil e lobby mostram **só o nome do tier + ícone**. Nada de "faltam X pontos", nada de barra de progresso, nada de posição numérica — exceto o leaderboard do apex (top 5), que é público por natureza.
- Barra de progresso dentro do tier é um vazamento de pontos disfarçado. Se o dono pedir, ofereça no lugar: os últimos 10 resultados (V/D) — informação real, sem número explorável.

### riscos

## 1. Win-trading / farm entre amigos — **o maior risco real numa comunidade de dezenas**

Com 60 pessoas, duas combinadas conseguem manipular o topo em uma semana. Mitigações (todas baratas):

- **Teto por par por dia:** as 3 primeiras partidas contra o mesmo adversário valem peso cheio; da 4ª em diante, peso `0.25`. Aplique via `mu_final = mu + 0.25 * (mu_novo − mu)`.
- **Flag automática:** se > 40% das partidas ranqueadas de um jogador na temporada forem contra o mesmo oponente, sinalizar para revisão manual do admin.
- **Duração mínima:** partida com menos de 5 minutos ou sem atividade mínima (ex.: nenhuma unidade produzida) **não conta** para rating nem para as 10 colocações.
- **Resultado sempre autoritativo do servidor** (fim de jogo + replay guardado). Nunca aceitar resultado reportado pelo cliente — o launcher pode enviar, o servidor confirma contra o replay.

## 2. Smurf

`mu` inicial 25 = média, então um smurf forte atropela iniciantes nas 10 colocações.

- 1 conta ranqueada por pessoa (vínculo Discord + binding no launcher).
- `tau = 0.25` na colocação faz o smurf sair da média em ~4–5 partidas — a janela de dano é curta.
- Preferir parear quem está em colocação com outros em colocação.
- **Seed manual de admin** para jogadores conhecidos: numa comunidade pequena, "todo mundo sabe quem é forte" é informação real e legítima.

## 3. Comunidade pequena — o risco não é o rating, é a fila vazia

Um sistema perfeito com fila vazia é um sistema morto. Fila única com marcação de modos (não filas separadas), janelas de fila anunciadas no Discord, e teto de espera com abertura progressiva. Se em 5 minutos não há partida, o problema é população, não parâmetro — não conserte alargando a faixa.

## 4. Inflação

`c = mu − 2σ` sobe sozinho enquanto σ encolhe. **Resolvido pelo piso de σ = 2.5** + cortes recalibrados por temporada. Já `mu` no Weng-Lin é aproximadamente conservado (o que um time ganha o outro perde), então não há inflação real da escala — diferente de Elo com bônus de vitória ou pontos por participação, que **não devem existir aqui em hipótese nenhuma**.

## 5. Deflação

Se os melhores param de jogar, os pontos deles congelam fora de circulação. Por isso **não decair `mu` por inatividade** — só esconder o rank. Decair `mu` criaria o incentivo perverso de esperar o rival sumir para "farmar" a diferença.

## 6. Rating preso

Sem piso de σ, um veterano com σ ≈ 1.2 fica congelado: melhora e não sobe. Com piso 2.5 o sistema continua respondendo para sempre. **É o parâmetro mais importante de toda a configuração e o mais fácil de esquecer.**

## 7. Abandono / rage quit

Derrota cheia + ban de fila escalonado (5/15/60 min no mesmo dia). Sem exceção, senão vira a saída padrão de toda partida perdida.

## 8. Engenharia reversa dos pontos

Esconder os pontos ajuda contra manipulação, mas o jogador vai inferir seu rating pelo pareamento ("só pego Besteiro, então sou Besteiro"). Isso é aceitável e inevitável — e é justamente por isso que o gate de 2 tiers de diferença tem que ser respeitado: ele é a única coisa que o jogador consegue verificar sozinho, e uma violação visível queima a confiança no sistema inteiro.

## 9. Patente TrueSkill — resposta direta

**Não é um problema real para vocês, mas também não é motivo para usar TrueSkill.**

A patente-mãe (US 7.376.474, "Bayesian scoring", prioridade em jan/2005) já expirou pelo prazo de 20 anos. Porém existem continuações posteriores da mesma família ("Seeding in a skill scoring framework", US 8.175.726 e US 8.583.266) com prazos mais longos, e **"TrueSkill" é marca registrada da Microsoft**. A Microsoft historicamente nunca acionou projeto de hobby — o risco prático de um fork comunitário gratuito de KaM é essencialmente nulo.

Mas: como o OpenSkill é MIT, tem lib TypeScript mantida e acurácia de predição competitiva, **usar TrueSkill significaria pagar um custo de dúvida jurídica por zero benefício técnico**. Se algum dia usarem qualquer implementação da família, **não chamem de "TrueSkill" na interface** — o problema de marca é mais concreto que o de patente.

### alternativas

## Glicko-2 — segunda opção, e só para 1x1

Melhor que Elo com poucos dados, mas dois problemas fatais aqui: **(a)** não tem modelo de time nativo — você teria que inventar a agregação, e "rating único de 1x1 a 4x4" é requisito, não detalhe; **(b)** trabalha por período de rating, e o próprio Glickman recomenda período grande o bastante para conter 10–15 jogos por jogador — com dezenas de jogadores isso vira período mensal, ou seja, rank atualizando 1x por mês.

Se um dia criarem um **ladder separado só de 1x1**, os valores:

| Parâmetro | Valor | Motivo |
|---|---|---|
| Rating inicial | 1500 | |
| RD inicial | 350 | |
| Volatilidade (σ) inicial | 0.06 | padrão |
| **τ (tau)** | **0.3** | Glickman recomenda 0.3–1.2, e explicitamente valores **baixos** quando o sistema vai ver combinações improváveis de resultados — que é exatamente o caso de pool pequeno. `0.5` (o default comum) já é solto demais aqui. |
| Período de rating | 1 semana | compromisso: menor que o recomendado, mas mensal é inaceitável na prática |
| RD máximo (inatividade) | 350 | |
| Constante `c` de inatividade | ≈ 34 | leva RD de 50 a 350 em ~2 anos parado |
| Tiers | mesmos 6, cortes recalibrados sobre `rating − 2·RD` | |

## Elo puro — só se a lib virar problema

K = 32 nas 10 primeiras, 20 depois, 12 acima de 2100. Time = média do time tratada como um jogador; delta aplicado igual a todos. Funciona, é 20 linhas, e é o que o Voobly usa há anos no AoE2 (inclusive uma variante "Elo Fair" com escala por tamanho de time). Mas perde a incerteza: colocação de 10 partidas fica arbitrária e o pareamento não sabe distinguir "1500 confiável" de "1500 chutado". **Não recomendo** — o OpenSkill não custa mais trabalho que isso.

## Outros modelos do próprio OpenSkill

- **Bradley-Terry Full:** matematicamente equivalente ao Plackett-Luce quando há só 2 times, que é sempre o caso de vocês. Não erra, mas obriga a manter dois caminhos de código se um dia entrar FFA. **Plackett-Luce cobre os dois com um código só.**
- **Thurstone-Mosteller Full:** comportamento mais parecido com TrueSkill (probit em vez de logit). Diferença imperceptível nessa escala. Não compensa.
- **Variantes "Part":** mais rápidas, menos precisas. Com dezenas de jogadores, performance nunca será o gargalo. Ignorar.

## TrueSkill 2

Melhor precisão do estado da arte (usa duração de partida, estatísticas individuais, tendência de abandono). **Descartar:** não há implementação pública utilizável, e ainda por cima é do lado errado da questão de patente/marca.

## O que fazer com os dados enquanto isso

Como você vai gravar `mu_before`/`mu_after`/`mode` em toda partida (ver `parametros`), **ao fim da primeira temporada dá para reprocessar o histórico inteiro com qualquer um desses sistemas e comparar acurácia de predição real** (log-loss em `predictWin` contra os resultados). É a única forma honesta de decidir se algum knob vale a pena. Trocar de sistema antes de ter essa temporada é chute com passos extras.

