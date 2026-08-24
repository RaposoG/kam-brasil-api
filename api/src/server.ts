import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { config } from './config.ts'
import { dataSource } from './data-source.ts'
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
await app.register(rankedInternalRoutes)
// Registra as rotas da fila E liga o laço de pareamento (RANKED_TICK_MS).
await app.register(rankedRoutes)

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
  app.log.warn('ANNOUNCE_ALLOWED_IPS vazio: qualquer origem pode anunciar servidor. Não use assim em produção.')
}

if (!config.RANKED_INTERNAL_SECRET) {
  // Sem isto todo /internal/ranked/* responde 403, e o servidor dedicado não
  // consegue nem reservar sala nem reportar resultado. Avisar aqui evita
  // debugar isso no meio de uma noite de ranqueada.
  app.log.warn('RANKED_INTERNAL_SECRET vazio: as rotas internas do ranqueado estão desligadas.')
}

if (!config.GAME_SERVER_PUBLIC_ADDRESS) {
  // Aviso, não erro: derrubar login e download por causa disto seria trocar um
  // problema pequeno por um grande.
  app.log.warn(
    'GAME_SERVER_PUBLIC_ADDRESS vazio: a lista publicará o IP de quem anunciou. ' +
      'Vindo de container isso é um endereço interno, e ninguém consegue conectar.',
  )
}

await app.listen({ port: config.API_PORT, host: config.API_HOST })
