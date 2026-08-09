repo: RaposoG/kam-brasil-api
branch: master
path: launcher/

## Last sync
date: 2026-08-09T04:34:00Z

### Updated in this project
- Leitura do launcher atual (Tauri + Vue): App.vue, Play.vue, api.ts, tauri.conf.json
- Leitura da API (entidades, rotas master/client) para saber quais dados existem hoje
- Base para o novo design do launcher (dashboard + estatísticas + ranking)

## Contexto lido
- Launcher: `launcher/src/App.vue` (login/registro + paleta global), `launcher/src/Play.vue` (fluxo instalar/atualizar/preparar assets/jogar), `launcher/src/api.ts` (ponte Tauri), `launcher/src-tauri/tauri.conf.json` (janela 900×620, não redimensionável)
- Paleta atual: stone #1a1512, wood #241d17, border #4a3a28, gold #d4a24a, gold-dim #a87f38, parchment #e8dcc8, muted #a3927a, danger #d08272, success #94b96f; serifada Georgia + Segoe UI
- API hoje: contas/sessões, tickets de partida, servidores (nome, ip, porta, playerCount, dedicated, os, revisões), releases do cliente. `GET /maps.php` recebe a partida jogada mas **ainda não persiste** — estatísticas e elo são feature nova.

## Screen map
| Tela | Arquivos de origem |
|---|---|
| (a definir) | launcher/src/App.vue, launcher/src/Play.vue, launcher/src/api.ts |
