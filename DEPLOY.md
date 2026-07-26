# Deploy da API

A API vive em `https://kam-api.melhorzin.com`, com rebuild automático a cada push
no GitHub.

## O que precisa existir no ambiente

Copie [.env.example](.env.example) e preencha. Os que **não** podem ficar no padrão:

| Variável | Por quê |
|---|---|
| `JWT_SECRET` | mínimo 32 caracteres. `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | senha real, e `sslmode=require` se o banco for remoto |
| `ADMIN_TOKEN` | sem ele a publicação de releases fica desabilitada (503) |
| `TRUST_PROXY=true` | **obrigatório** atrás de nginx/Cloudflare |
| `ANNOUNCE_ALLOWED_IPS` | IP do servidor dedicado |
| `NODE_ENV=production` | desliga o log formatado e o modo verboso |

### `TRUST_PROXY` não é detalhe

Sem ele, `request.ip` devolve o IP do proxy. Como `ANNOUNCE_ALLOWED_IPS` e
`VERIFY_ALLOWED_IPS` comparam contra esse valor, todo request pareceria vir do
mesmo endereço — os dois allowlists viram enfeite.

## ⚠️ `RELEASES_DIR` precisa ser volume persistente

Uma release ocupa centenas de MB e mora em disco, não no banco. Com rebuild
automático a cada push, uma pasta dentro do container é **apagada a cada
deploy** — e todos os jogadores perdem a origem do download.

Monte um volume e aponte `RELEASES_DIR` para ele.

## Migrations

Rodam sozinhas no boot. Um deploy nunca sobe com schema defasado, e não há passo
manual entre o push e a API no ar.

## O servidor de jogo sobe junto

O serviço `gameserver` do compose. Ele **compila o `KaM_DedicatedServer` a partir
do repositório do jogo** — nenhum binário é versionado aqui, e `GAME_REF` diz de
qual commit. FPC compila o servidor mas não o cliente (18 arquivos usam inline
vars do Delphi 10.3+), por isso só esta metade cabe num Dockerfile.

O `.ini` é escrito a cada boot a partir do ambiente: mudar nome ou porta é editar
a env e reiniciar, sem rebuildar.

### `network_mode: "service:api"` não é economia

O servidor divide o namespace de rede da API. Isso resolve duas coisas de uma vez:

- Ele alcança `/auth/verify` em `127.0.0.1`. O ticket vai **na query string, em
  texto claro** — o cliente HTTP do Pascal (`KM_HTTPClient`) só faz GET, sem TLS
  e sem headers — então não pode sair da máquina.
- O anúncio chega de um endereço que ninguém de fora forja, o que faz
  `ANNOUNCE_ALLOWED_IPS=127.0.0.1` significar alguma coisa.

Efeitos colaterais: a porta do jogo se publica no serviço `api`, e reiniciar a
API exige reiniciar o gameserver junto.

### `GAME_SERVER_PUBLIC_ADDRESS` é obrigatório

O master original guardava o IP de quem anunciou, porque cada servidor era uma
máquina pública anunciando de fora. O nosso anuncia de dentro do Docker — o IP de
origem é interno, e publicá-lo mandaria todos os jogadores discarem para
`127.0.0.1`. Sem essa variável o compose nem sobe.

### Allowlist compara o socket, não o `X-Forwarded-For`

`request.ip` obedece ao `X-Forwarded-For` quando `TRUST_PROXY=true` — e esse
cabeçalho é escrito pelo cliente. Um allowlist que confiasse nele seria burlável
por qualquer um mandando `X-Forwarded-For: 127.0.0.1`: daria para injetar
servidores falsos na lista e chamar `/auth/verify` da internet.

Por isso `serveradd.php` e `/auth/verify` usam `peerIp()`
([api/src/peer-ip.ts](api/src/peer-ip.ts)), que lê o endereço do socket. Está
coberto por teste — não troque por `request.ip`.

## Publicando uma release

São dois comandos, e você nunca envia meio giga.

**1. Anexe os binários a uma GitHub Release** (no repositório público do jogo):

```bash
gh release create v1.0.0 \
  KaM_Remake.exe "Utils/RXXPacker/RXXPacker.exe" \
  --repo RaposoG/kam_brasil --title "Kam Brasil 1.0.0" --notes "Primeira versão"
```

Os anexos precisam se chamar exatamente `KaM_Remake.exe` e `RXXPacker.exe`.

**2. Publique:**

```bash
curl -X POST https://kam-api.melhorzin.com/client/releases \
  -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"version":"1.0.0","gameRevision":"r16155","binariesTag":"v1.0.0"}'
```

### O que a API faz sozinha

Ela monta a árvore no servidor, buscando cada parte da fonte natural:

| Parte | Origem |
|---|---|
| `KaM_Remake.exe`, `RXXPacker.exe` | anexos da release informada |
| textos, fontes, cursores, DLLs | `RaposoG/kam_brasil` |
| mapas, campanhas, tutoriais | `reyandme/kam_remake_maps` |
| sprites da comunidade | `reyandme/kam_remake_resources` |

Depois calcula o sha256 de cada arquivo — sempre lendo do disco, nunca de algo
informado — e escreve o manifesto.

Os clones ficam em cache no volume `sources`; da segunda release em diante é
`fetch`, não clone. E são rasos: o histórico do KaM tem 16 mil commits que não
servem para nada aqui.

**Por que assim:** o que muda a cada build são ~26 MB de binários. Mapas e
campanhas são 417 MB e nunca mudam por causa de um build. Enviar tudo a cada
versão seria pagar meio giga para trocar 26 MB.

Efeito colateral bem-vindo: quando a comunidade publica mapas novos no upstream,
a próxima release os inclui sem ninguém fazer nada.

**Nunca entram:** sprites, sons, músicas, `houses.dat` e `unit.dat`. Vêm do
Knights and Merchants original e são gerados na máquina do jogador.

### Espaço em disco

A montagem clona três repositórios (~640 MB somados, rasos) e escreve a árvore
montada. Some a release publicada e reserve **uns 2 GB** para o volume.

## Checklist pós-deploy

```bash
curl https://kam-api.melhorzin.com/health          # {"status":"ok","database":"connected"}
curl https://kam-api.melhorzin.com/client/latest   # a release publicada
curl "https://kam-api.melhorzin.com/serverquery.php?rev=r16000"   # o servidor na lista
```

E confira que `GET /auth/verify` responde **403** de fora da máquina. Se
responder outra coisa, o allowlist não está valendo — provavelmente falta
`TRUST_PROXY=true`.
