import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { INTERVALO_MS, atualizarNomes, nomesDe } from './allowlist.ts'
import { config } from './config.ts'
import { dataSource, seasons } from './data-source.ts'
import authPlugin from './plugins/auth.ts'
import authRoutes from './routes/auth.ts'
import masterRoutes from './routes/master.ts'
import clientRoutes from './routes/client.ts'
import verifyRoutes from './routes/verify.ts'
import statsRoutes from './routes/stats.ts'
import newsRoutes from './routes/news.ts'
import socialRoutes from './routes/social.ts'
import catalogRoutes from './routes/catalog.ts'
import adminRoutes from './routes/admin.ts'
import rankedInternalRoutes from './routes/ranked-internal.ts'
import rankedRoutes from './routes/ranked.ts'
import matchesRoutes from './routes/matches.ts'
import replayRoutes from './routes/replay.ts'
import reportsRoutes from './routes/reports.ts'
import tempoRealRoutes from './ranked/tempo-real.ts'

const app = Fastify({
  trustProxy: config.TRUST_PROXY,
  logger: config.isDev
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : true,
})

// Sem isto, um POST sem corpo (ex.: /auth/logout) responde 415 por não ter
// Content-Type. O parser de JSON continua tendo precedência sobre este curinga.
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
  if (body.length === 0) return done(null, {})
  done(new Error('Content-Type não suportado — use application/json'))
})

await app.register(cors, { origin: true })

// Binários das releases. Em produção o ideal é deixar o nginx servir isso
// direto — mas ter a API servindo mantém o ambiente local autossuficiente.
const releasesDir = resolve(config.RELEASES_DIR)
await mkdir(releasesDir, { recursive: true })
await app.register(fastifyStatic, { root: releasesDir, prefix: '/downloads/' })

// octet-stream em tudo que sai de /downloads/: aqui não se renderiza nada, só se
// baixa bytes. Não é preciosismo — o Cloudflare reescreve respostas `text/html`
// em trânsito (injeta Speculation Rules), e os Readme_*.html chegavam ao jogador
// 1,7 KB maiores do que o sha256 do manifesto. Sem tipo pra mexer, ele repassa
// os bytes intactos.
//
// Via hook, não via `setHeaders` do @fastify/static: aquele recebe um `res` cru
// que sob o Bun não tem `setHeader`, e derrubava o processo a cada download.
app.addHook('onSend', async (request, reply) => {
  if (request.url.startsWith('/downloads/')) {
    reply.header('content-type', 'application/octet-stream')
    // Conteúdo de release é imutável: cada versão mora na própria pasta e
    // republicar a mesma versão é recusado com 409. O @fastify/static manda
    // `max-age=0`, que faz cada jogador rebaixar tudo e o CDN nunca segurar nada.
    reply.header('cache-control', 'public, max-age=31536000, immutable')
  }
})

await app.register(authPlugin)
await app.register(authRoutes)
await app.register(masterRoutes)
await app.register(clientRoutes)
await app.register(verifyRoutes)
await app.register(statsRoutes)
await app.register(newsRoutes)
await app.register(socialRoutes)
await app.register(catalogRoutes)
await app.register(adminRoutes)
// Sempre registradas, mesmo com a ranqueada desligada: sem pareador ninguém
// cria lobby, então elas respondem vazio por conta própria. É o que deixa o
// servidor dedicado seguir perguntando sem tomar 404 a cada 3 segundos.
await app.register(rankedInternalRoutes)
if (config.RANKED_ENABLED) {
  // Registra as rotas da fila E liga o laço de pareamento (RANKED_TICK_MS).
  await app.register(rankedRoutes)
}
// Fora do `if`: histórico e perfil são leitura do que já aconteceu, e desligar
// a fila não pode apagar o passado nem quebrar a tela de Partidas.
await app.register(matchesRoutes)
// Upload/download de replay e statsJson. Registra num escopo próprio: o plugin
// instala um parser de multipart que não pode vazar para as outras rotas.
await app.register(replayRoutes)
await app.register(reportsRoutes)
// O socket que o launcher abre em `ranked_ws.rs` (`wss://.../ranked/tempo-real`).
// Sem este registro o canal não existe e a falha é silenciosa: a tela cai no
// poll e ninguém percebe que o tempo real nunca subiu.
if (config.RANKED_ENABLED) {
  await app.register(tempoRealRoutes)
}

app.get('/health', async () => {
  // Confirma que a API está de pé E que ela enxerga o banco — teste de fumaça
  // depois de qualquer mudança de infra.
  let database = 'disconnected'
  try {
    await dataSource.query('select 1')
    database = 'connected'
  } catch (error) {
    app.log.error({ error }, 'health check: banco inacessível')
  }

  return { status: 'ok', database }
})

await dataSource.initialize()
app.log.info('TypeORM conectado')

// Migrations rodam no boot: um deploy nunca sobe com schema defasado.
const executed = await dataSource.runMigrations()
if (executed.length > 0) {
  app.log.info({ migrations: executed.map((m) => m.name) }, 'migrations aplicadas')
}

if (config.adminEmails.length === 0) {
  // Sem isto, o painel responde 403 para todo mundo e ninguém entende por quê:
  // o sintoma (403) não sugere em nada que a variável é que está vazia.
  app.log.warn('ADMIN_EMAILS vazio: ninguém tem acesso ao painel administrativo.')
}

if (config.announceAllowedIps.length === 0) {
  if (config.isDev) {
    app.log.warn('ANNOUNCE_ALLOWED_IPS vazio: em desenvolvimento qualquer origem pode anunciar servidor.')
  } else {
    // Fecha, não abre: ver isAnnounceAllowed em routes/master.ts. O sintoma é o
    // servidor sumir da lista, e o log tem que dizer o porquê — senão vira meia
    // hora de "o servidor não aparece" olhando para o container errado.
    app.log.error(
      'ANNOUNCE_ALLOWED_IPS vazio em produção: NENHUM servidor consegue se anunciar e a lista ficará vazia. ' +
        'Defina os IPs dos gameservers. Atenção a valores que parecem preenchidos mas viram lista vazia: " " ou ",".',
    )
  }
}

if (!config.RANKED_ENABLED) {
  // Estado escolhido, não acidente — mas tem que aparecer no log, senão vira a
  // próxima meia hora de "por que a fila não anda".
  app.log.warn('RANKED_ENABLED=false: fila, pareamento e tempo real desligados.')
} else if (!config.RANKED_SECRET_FILE && !process.env.RANKED_INTERNAL_SECRET) {
  // Segredo aleatório em memória: as rotas internas existem mas nenhum
  // gameserver sabe o segredo, então na prática estão fechadas. Só acontece
  // fora do compose, que sempre define RANKED_SECRET_FILE.
  app.log.warn(
    'Sem RANKED_SECRET_FILE nem RANKED_INTERNAL_SECRET: segredo interno é aleatório desta subida, ' +
      'e o servidor dedicado não conseguirá reservar sala nem reportar resultado.',
  )
}

if (config.RANKED_ENABLED && (await seasons().countBy({ ativa: true })) === 0) {
  // Ligar a ranqueada não cria temporada, e sem temporada aberta /ranked/me,
  // /ranked/leaderboard e a entrada na fila respondem 503 para todo mundo.
  // Nenhuma migration semeia uma — quem cria é o painel administrativo.
  app.log.warn('Nenhuma temporada aberta: a fila ranqueada responde 503. Crie uma em /admin.')
}

if (!config.GAME_SERVER_PUBLIC_ADDRESS) {
  // Aviso, não erro: derrubar login e download por causa disto seria trocar um
  // problema pequeno por um grande.
  app.log.warn(
    'GAME_SERVER_PUBLIC_ADDRESS vazio: a lista publicará o IP de quem anunciou. ' +
      'Vindo de container isso é um endereço interno, e ninguém consegue conectar.',
  )
}

// Os allowlists aceitam nome de serviço, não só IP: desde que os gameservers
// saíram de dentro da API eles têm IP dinâmico na rede do compose. Resolvemos
// antes de abrir a porta — se ficasse para o primeiro tique de fundo, haveria
// uma janela em que anúncio e /auth/verify recusariam servidor legítimo.
const nomesDoAllowlist = [...new Set([...nomesDe(config.announceAllowedIps), ...nomesDe(config.verifyAllowedIps)])]
if (nomesDoAllowlist.length > 0) {
  const ips = await atualizarNomes(nomesDoAllowlist)
  if (ips.size === 0) {
    // Fecha em vez de abrir, então o sintoma é "nenhum servidor na lista" e não
    // "qualquer um anuncia". Costuma ser o gameserver ainda subindo; o laço
    // abaixo reconsulta e conserta sozinho.
    app.log.warn({ nomes: nomesDoAllowlist }, 'nenhum nome do allowlist resolveu ainda: anúncio e /auth/verify recusam até resolver')
  } else {
    app.log.info({ nomes: nomesDoAllowlist, ips: [...ips] }, 'allowlist por nome resolvido')
  }

  // Container reiniciado troca de IP, e o allowlist tem que acompanhar sem
  // exigir restart da API.
  const laco = setInterval(() => {
    atualizarNomes(nomesDoAllowlist).catch((error) => app.log.error({ error }, 'falha ao reconsultar allowlist'))
  }, INTERVALO_MS)
  laco.unref()
}

await app.listen({ port: config.API_PORT, host: config.API_HOST })
