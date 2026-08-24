import type { FastifyInstance, FastifyRequest } from 'fastify'
import { LessThanOrEqual, MoreThan } from 'typeorm'
import { config } from '../config.ts'
import { gameServers, matchReports } from '../data-source.ts'
import { origemPermitida } from '../allowlist.ts'
import { peerIp } from '../peer-ip.ts'
import { clampPlayerCount, sanitizeMapName } from '../sanitize.ts'
import { RateLimiter } from '../throttle.ts'

/**
 * Compatibilidade com o master server original (os PHPs em Utils/MasterServer/).
 *
 * O cliente monta estas URLs em KM_NetServerLocator.pas e elas são fixas no
 * Pascal — mudar qualquer nome de rota ou formato de resposta exigiria
 * recompilar o jogo. Por isso mantemos o sufixo .php e o texto puro.
 *
 * Todas respondem text/plain. O cliente ignora o corpo de serveradd e maps.
 */

/** O TTL vem do cliente; limitamos para ninguém fixar um servidor fantasma na lista. */
const MAX_TTL_SECONDS = 3600

/**
 * maps.php é público e sem credencial — qualquer um na internet gravaria
 * estatística falsa à vontade. 1 report a cada 10 s por IP segura o grosso.
 * Em memória e instância única (ver throttle.ts).
 */
const mapReportLimiter = new RateLimiter(10_000)

/**
 * O parser do cliente (TKMServerList.AddFromText) faz split por vírgula e
 * exige exatamente 5 campos — uma vírgula no nome gera 6 e a linha é
 * DESCARTADA EM SILÊNCIO. `|` é quebra de linha na interface do KaM.
 */
function sanitizeServerName(raw: string): string {
  return raw.replace(/[,\r\n|]/g, ' ').trim().slice(0, 60)
}

/**
 * Lista vazia FECHA em produção, e só abre em desenvolvimento.
 *
 * Antes abria em qualquer ambiente, e o custo de errar a variável era alto
 * demais para um `return true`: a chave do anúncio é `(ip, port)` e o `ip`
 * gravado é o `GAME_SERVER_PUBLIC_ADDRESS`, não a origem. Então qualquer um na
 * internet reanunciava a linha do servidor de verdade — trocando nome, zerando
 * `expiresAt`, sumindo com ele da lista — e, escolhendo outra porta, plantava
 * um `dedicated=1` mais recente, que é exatamente o que `reservarSalas`
 * (routes/ranked.ts) elege para hospedar as partidas ranqueadas.
 *
 * Falhar fechado troca isso por um sintoma barulhento e reversível: o servidor
 * some da lista até a variável ser corrigida.
 *
 * Os parâmetros têm default para o teste conseguir variar a lista sem mexer no
 * `config`, que é singleton de processo. O chamador passa só o IP.
 */
export function isAnnounceAllowed(
  ip: string,
  allowlist: readonly string[] = config.announceAllowedIps,
  isDev: boolean = config.isDev,
): boolean {
  if (allowlist.length === 0) return isDev
  return origemPermitida(ip, allowlist)
}

function str(request: FastifyRequest, key: string): string {
  const value = (request.query as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function int(request: FastifyRequest, key: string, fallback = 0): number {
  const parsed = Number.parseInt(str(request, key), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export default async function masterRoutes(app: FastifyInstance) {
  /** Um servidor se anuncia. Chamado periodicamente (a cada MasterAnnounceInterval). */
  app.get('/serveradd.php', async (request, reply) => {
    reply.type('text/plain')

    // peerIp, nao request.ip: ver peer-ip.ts. Com X-Forwarded-For qualquer um
    // se passaria por interno e injetaria servidores falsos na lista.
    const origin = peerIp(request)

    if (!isAnnounceAllowed(origin)) {
      request.log.warn({ ip: origin }, 'anuncio de servidor recusado: origem fora do allowlist')
      // Texto qualquer: o cliente descarta a resposta. Serve para o log/curl.
      return reply.code(403).send('forbidden')
    }

    // O endereco que vai para a lista NAO e o de quem anunciou.
    //
    // O master original guardava o REMOTE_ADDR porque cada servidor era uma
    // maquina publica anunciando de fora. O nosso roda em container, ao lado da
    // API: o anuncio chega de um IP interno, e publica-lo mandaria todo mundo
    // discar para 127.0.0.1. Por isso o endereco publico e configurado.
    const ip = config.GAME_SERVER_PUBLIC_ADDRESS || origin

    const port = int(request, 'port')
    if (port < 1 || port > 65535) return reply.code(400).send('invalid port')

    const name = sanitizeServerName(str(request, 'name'))
    if (!name) return reply.code(400).send('invalid name')

    const netRevision = str(request, 'rev')
    if (!netRevision) return reply.code(400).send('invalid revision')

    const ttl = Math.min(Math.max(int(request, 'ttl', 1), 1), MAX_TTL_SECONDS)

    // O master original usava REPLACE INTO com chave (IP, Port): reanunciar
    // sobrescreve em vez de duplicar. Mantemos a mesma semântica.
    await gameServers()
      .createQueryBuilder()
      .insert()
      .values({
        name,
        ip,
        port,
        playerCount: int(request, 'playercount'),
        dedicated: int(request, 'dedicated') !== 0,
        os: str(request, 'os').slice(0, 16),
        netRevision: netRevision.slice(0, 16),
        gameRevision: str(request, 'coderev').slice(0, 32),
        expiresAt: new Date(Date.now() + ttl * 1000),
      })
      .orUpdate(
        ['name', 'playerCount', 'dedicated', 'os', 'netRevision', 'gameRevision', 'expiresAt', 'updatedAt'],
        ['ip', 'port'],
      )
      .execute()

    return reply.send('success')
  })

  /**
   * Lista de servidores. Formato exigido pelo parser do cliente:
   *   Name,IP,Port,Dedicated,OS\n
   * Linhas que não tiverem 5 campos são ignoradas pelo jogo.
   */
  app.get('/serverquery.php', async (request, reply) => {
    reply.type('text/plain')

    const netRevision = str(request, 'rev')
    if (!netRevision) return reply.code(400).send('Invalid revision')

    // Só servidores do mesmo protocolo: builds diferentes não conseguem jogar juntas.
    const servers = await gameServers().find({
      where: { netRevision, expiresAt: MoreThan(new Date()) },
      order: { playerCount: 'DESC', name: 'ASC' },
    })

    const body = servers
      .map((s) => `${s.name},${s.ip},${s.port},${s.dedicated ? 1 : 0},${s.os}`)
      .join('\n')

    // Lista vazia responde corpo vazio — o cliente lida com isso normalmente.
    return reply.send(body ? `${body}\n` : '')
  })

  /** Mensagem exibida na aba multiplayer. O cliente interpreta como UTF-8. */
  app.get('/announcements.php', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8')
    return reply.send(config.MOTD)
  })

  /**
   * O cliente avisa que uma partida COMEÇOU (é só isso que ele reporta — sem
   * resultado nem duração). Gravamos em match_reports para as estatísticas.
   *
   * A resposta é SEMPRE `success` 200: o cliente Pascal ignora o corpo e não
   * tem como exibir erro — falhar aqui só sujaria o log do jogador.
   */
  app.get('/maps.php', async (request, reply) => {
    reply.type('text/plain')

    try {
      // Nome vazio depois da sanitização = report sem conteúdo, não grava.
      // A checagem vem antes do rate-limit para lixo não queimar a janela.
      const map = sanitizeMapName(str(request, 'map'))
      const mapCrc = str(request, 'mapcrc').slice(0, 32)

      // A chave do rate-limit inclui o mapa: quem reporta é o CLIENTE host, e
      // dois jogadores atrás do mesmo IP público (CGNAT é o normal nos
      // provedores brasileiros) hospedando partidas quase juntos são tráfego
      // legítimo — só IP puniria o segundo. O que queremos barrar é script
      // martelando o mesmo report, e esse repete mapa e crc.
      const chave = `${peerIp(request)}|${map}|${mapCrc}`
      if (map && mapReportLimiter.allow(chave)) {
        await matchReports().insert({
          map,
          mapCrc,
          playerCount: clampPlayerCount(int(request, 'playercount')),
          netRevision: str(request, 'rev').slice(0, 16),
          gameRevision: str(request, 'coderev').slice(0, 32),
        })
      } else if (map) {
        // Descarte silencioso para o cliente, mas nunca para nós: subcontagem
        // sem rastro em matchesPerDay seria indepurável.
        request.log.info({ map, ip: peerIp(request) }, 'report de partida descartado pelo rate-limit')
      }
    } catch (error) {
      request.log.error({ error }, 'falha ao gravar report de partida')
    }

    return reply.send('success')
  })

  /** Limpeza dos anúncios vencidos. Não é crítico: a listagem já filtra por expiresAt. */
  app.post('/internal/prune-servers', async () => {
    const result = await gameServers().delete({ expiresAt: LessThanOrEqual(new Date()) })
    return { removed: result.affected ?? 0 }
  })
}
