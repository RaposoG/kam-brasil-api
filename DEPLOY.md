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

A API deriva mais duas pastas do lado dessa: `mapas/` (catálogo global de mapas,
o que o admin sobe pelo painel) e `replays/`. A pasta dos mapas **também precisa
de volume** — os arquivos só existem lá, e um rebuild sem volume apaga o acervo
curado sem de onde recuperar. No `docker-compose.yml` isso já é o volume
`mapas:/app/mapas`.

## Migrations

Rodam sozinhas no boot. Um deploy nunca sobe com schema defasado, e não há passo
manual entre o push e a API no ar.

## Os dois servidores de jogo sobem junto

São dois serviços do compose, da **mesma imagem**, com papéis diferentes:

| Serviço | Porta | Papel |
|---|---|---|
| `gameserver` | `SERVER_PORT` (56789) | Casual. Sala aberta na mão, como sempre foi. Sem ranqueada nenhuma. |
| `gameserver-ranked` | `RANKED_SERVER_PORT` (56790) | Só ranqueada. O único que fala `/internal/ranked/*` e o único onde a API reserva sala. |

A imagem **compila o `KaM_DedicatedServer` a partir do repositório do jogo** —
nenhum binário é versionado aqui, e `GAME_REF` diz de qual commit. FPC compila o
servidor mas não o cliente (18 arquivos usam inline vars do Delphi 10.3+), por
isso só esta metade cabe num Dockerfile.

O `.ini` é escrito a cada boot a partir do ambiente: mudar nome ou porta é editar
a env e reiniciar, sem rebuildar.

### Os gameservers saíram de dentro da API

Até a versão anterior o servidor dividia o namespace de rede da API
(`network_mode: "service:api"`), e o efeito colateral era caro: **todo deploy da
API derrubava partida em andamento**, porque recriar a API recriava o container
do jogo junto.

Agora cada um tem o próprio container e a própria porta, todos na rede `default`
do compose. Nenhum serviço declara `networks:` — de propósito.

**Por que nenhuma rede declarada.** O Dokploy reescreve essa chave ao injetar a
rede do Traefik: em todas as stacks desta máquina ele grava exatamente
`[dokploy-network, default]` no serviço que tem domínio. Declarar uma rede nossa
seria apostar que ele *acrescenta* em vez de *substituir* — e nenhum repo aqui
tem essa chave, então não há caso que prove o comportamento. Se ele substituir,
os gameservers ficam sem rota até a API e **ninguém entra em servidor nenhum**,
nem no casual, enquanto a plataforma segue de pé fingindo que está tudo bem.
Deixando a chave ausente, o Dokploy faz o que já faz hoje.

**Como a API reconhece os gameservers, então.** `ANNOUNCE_ALLOWED_IPS` e
`VERIFY_ALLOWED_IPS` aceitam **nome de serviço**, não só IP: valem
`gameserver,gameserver-ranked`. Os nomes são resolvidos pelo DNS embutido do
Docker, que só conhece os serviços deste projeto — ninguém na internet faz
`gameserver` apontar para a própria máquina. IP fixo exigiria subnet própria, e
subnet própria exigiria declarar `networks:`, que é justamente o que não dá.

A resolução acontece num laço de fundo (`allowlist.ts`), não por requisição. Não
é otimização: um `await` dentro do hook `onRequest` faz o Fastify sob o Bun mandar
o cabeçalho duas vezes, e a recusa de 403 vira erro 500. Roda uma vez antes de a
porta abrir e a cada 30 s depois — container reiniciado troca de IP.

**Falha fechada.** Nome que não resolve não libera ninguém: sem nada resolvido,
`serveradd.php` e `/auth/verify` respondem 403 e o boot loga o aviso. O contrário
transformaria um DNS fora do ar em "aceita todo mundo".

E **listar faixa não funciona nem seria seguro**: não há suporte a CIDR, e o
Traefik também é container em faixa privada — liberar `172.16.0.0/12` deixaria
passar requisição vinda da internet, proxiada por ele.

O que continua valendo do desenho antigo: o tráfego não sai da máquina. O ticket
vai **na query string, em texto claro** — o cliente HTTP do Pascal
(`KM_HTTPClient`) só faz GET, sem TLS e sem headers — e uma bridge local do
Docker não é a internet.

Ganho de contenção: o servidor casual — o mais exposto, porque qualquer um entra
numa sala aberta — não monta o volume do segredo da ranqueada.

### `RANKED_SERVER_PORT` é o que distingue os dois

Os dois anunciam como `dedicated`. Sem essa variável a API pegaria "o dedicado que
anunciou por último" — sorteio, com metade das ranqueadas caindo no servidor
casual. A mesma variável alimenta a env da API e o `SERVER_PORT` do container de
ranqueada: um valor só, impossível de dessincronizar.

Vazio ou `0` = qualquer dedicado, que é o comportamento certo para quem roda um
servidor só.

### `GAME_SERVER_PUBLIC_ADDRESS` não é obrigatório, mas sem ele ninguém conecta

O master original guardava o IP de quem anunciou, porque cada servidor era uma
máquina pública anunciando de fora. O nosso anuncia de dentro do Docker — o IP de
origem é interno, e publicá-lo mandaria todos os jogadores discarem para um
endereço que não existe fora da máquina.

**Um valor serve para os dois servidores**: rodam na mesma máquina, no mesmo IP
público, e o que os separa é a porta, que cada um manda no próprio anúncio — a
identidade na tabela `game_servers` é o par `(ip, port)`.

Já foi obrigatório (`${...:?}`) e **isso derrubou a plataforma inteira**: sem a
variável o compose recusava subir, e conta, login e download caíam junto por causa
de um endereço que só afeta a lista de servidores. Hoje a API sobe assim mesmo e
avisa no log.

### Allowlist compara o socket, não o `X-Forwarded-For`

`request.ip` obedece ao `X-Forwarded-For` quando `TRUST_PROXY=true` — e esse
cabeçalho é escrito pelo cliente. Um allowlist que confiasse nele seria burlável
por qualquer um mandando `X-Forwarded-For: 127.0.0.1`: daria para injetar
servidores falsos na lista e chamar `/auth/verify` da internet.

Por isso `serveradd.php` e `/auth/verify` usam `peerIp()`
([api/src/peer-ip.ts](api/src/peer-ip.ts)), que lê o endereço do socket. Está
coberto por teste — não troque por `request.ip`.

**Allowlist vazio recusa todo mundo em produção** (em desenvolvimento continua
aberto). Antes vazio aceitava qualquer origem, e o preço de errar a variável era a
lista de servidores sequestrada: a chave é `(ip, port)` e o `ip` gravado é o
`GAME_SERVER_PUBLIC_ADDRESS`, então de fora dava para reescrever a linha do
servidor real e plantar um `dedicated` mais recente. Cuidado com valores que
**parecem** preenchidos e viram lista vazia: `" "` (só espaço) e `","`. O boot
loga `error` quando isso acontece.

## Publicando uma release

São dois comandos, e você nunca envia meio giga.

**1. Anexe os binários a uma GitHub Release** (no repositório público do jogo):

```bash
gh release create v1.0.0 \
  KaM_Remake.exe "Utils/RXXPacker/RXXPacker.exe" assets.zip \
  --repo RaposoG/kam_brasil --title "Kam Brasil 1.0.0" --notes "Primeira versão"
```

Os anexos precisam se chamar exatamente `KaM_Remake.exe`, `RXXPacker.exe` e
`assets.zip`.

#### O `assets.zip`

Sprites, som, música e paletas **prontos** — o jogador não precisa mais ter o
Knights and Merchants de 1998 nem converter nada na própria máquina.

A árvore de dentro do zip já é a posição final na release:

```
data/Sprites/   .rxx (base) e .rxa (camada HD)
data/sfx/       sounds.dat + speech.eng/
Music/          as 15 faixas
data/gfx/       as paletas (pal0.bbm é a única lida em runtime)
```

Gere os sprites com o `RXXPacker` a partir de uma cópia do original, uma vez:

```bash
RXXPacker.exe srx <recursos>/SpriteResource/ sint <recursos>/SpriteInterp/Output/ \
              d data/Sprites/ rxa all
```

O `rxa all` é o que produz os `.rxa`. Não pule: é a camada de alta resolução que
o engine **prefere** quando as sombras alpha estão ligadas, e é a ausência dela
que fazia a comunidade reclamar de sprite feio.

Cuidados que já custaram caro:

- **Só `speech.eng`.** Os outros idiomas são peso morto (94 MB cada um).
  `TKMResSounds.Create` monta `speech.<idioma>` com fallback do `locales.txt`, e
  `ptb` não declara fallback — cai em `eng`. Uma pasta `speech` sem sufixo é a
  mesma coisa duplicada: não mande as duas.
- **Maiúsculas importam.** A API roda em Linux e confere caminho por caminho:
  é `data/Sprites/`, com S maiúsculo.
- **A voz do besteiro.** O original guarda `CROSSBOW/` e o engine procura
  `crossbowman/` — renomeie, ou ela nunca toca.

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
| sprites, som, música, paletas | anexo `assets.zip` da mesma release |
| textos, fontes, cursores, DLLs | `RaposoG/kam_brasil` |
| mapas, campanhas, tutoriais | `reyandme/kam_remake_maps` |
| sprites da comunidade | `reyandme/kam_remake_resources` |

Depois calcula o sha256 de cada arquivo — sempre lendo do disco, nunca de algo
informado — e escreve o manifesto.

Antes de gravar qualquer coisa ela confere a montagem: os `.rxx`, o
`sounds.dat`, o `pal0.bbm`, a `speech.eng` não-vazia e o `Music` não-vazio, além
do que já era exigido. Faltando qualquer um, a rota responde 400 e **nada é
publicado** — release quebrada só aparecia quando o jogador abria o jogo.

Os clones ficam em cache no volume `sources`; da segunda release em diante é
`fetch`, não clone. E são rasos: o histórico do KaM tem 16 mil commits que não
servem para nada aqui.

**Por que assim:** o que muda a cada build são ~26 MB de binários. Mapas e
campanhas são 417 MB e nunca mudam por causa de um build. Enviar tudo a cada
versão seria pagar meio giga para trocar 26 MB.

Efeito colateral bem-vindo: quando a comunidade publica mapas novos no upstream,
a próxima release os inclui sem ninguém fazer nada.

**Sprites, sons e músicas entram na release, prontos.** Antes eram gerados na
máquina de cada jogador a partir da cópia dele do Knights and Merchants — que é
como cada instalação acabava diferente da outra. Agora quem converte é quem
empacota, uma vez só: o jogador baixa e joga.

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
