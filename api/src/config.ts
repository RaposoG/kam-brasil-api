import { z } from 'zod'

import { resolverSegredoInterno } from './ranked-secret.ts'

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL não definida — copie brasil/.env.example para brasil/.env'),

  // 32 chars é o piso para um segredo HS256 não ser o elo fraco.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres (openssl rand -hex 32)'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * Validade do ticket que o launcher entrega ao jogo.
   *
   * Curto porque ele passa por um arquivo temporário, mas não curto demais: o
   * cliente reenvia a mesma credencial ao reconectar depois de uma queda, e um
   * ticket vencido deixaria o jogador fora da própria partida.
   */
  PLAY_TICKET_TTL_MINUTES: z.coerce.number().int().positive().default(720),

  /**
   * IPs autorizados a anunciar servidor, separados por vírgula.
   *
   * O jogo não manda credencial nenhuma no serveradd.php — os parâmetros são fixos
   * no Pascal (KM_NetServerLocator.AnnounceServer). Então a única forma de garantir
   * "só o nosso servidor aparece" sem mexer no cliente é filtrar pela origem.
   *
   * Vazio = aceita qualquer origem. Use assim só em desenvolvimento.
   */
  ANNOUNCE_ALLOWED_IPS: z.string().default(''),

  /**
   * Endereço público do servidor de jogo — o que vai para a lista e para onde os
   * jogadores discam.
   *
   * Precisa ser configurado porque o servidor roda em container: o anúncio chega
   * de um IP interno do Docker, e publicá-lo mandaria todo mundo conectar em
   * 127.0.0.1. Aceita IP ou hostname.
   *
   * Vazio = usa o IP de quem anunciou, que é o comportamento do master original
   * (cada servidor era uma máquina pública anunciando de fora).
   */
  GAME_SERVER_PUBLIC_ADDRESS: z.string().default(''),

  /** Mensagem exibida na aba multiplayer (announcements.php). */
  MOTD: z.string().default('Bem-vindo ao Kam Brasil!'),

  /**
   * Necessário para publicar releases do cliente. Vazio desabilita a rota —
   * é o padrão seguro: sem isso configurado, ninguém publica.
   */
  ADMIN_TOKEN: z.string().default(''),

  /**
   * E-mails com acesso ao painel administrativo, separados por vírgula.
   *
   * O papel vem daqui e não de um UPDATE no banco: assim conceder e revogar
   * acesso é uma mudança versionada no deploy, auditável, e não depende de
   * alguém lembrar de rodar SQL na mão numa madrugada. A conta precisa existir
   * — o admin se registra pelo launcher como qualquer jogador, e o e-mail
   * casando aqui é o que o promove no próximo login.
   *
   * Vazio = ninguém é admin, e o painel inteiro responde 403. É o padrão seguro.
   */
  ADMIN_EMAILS: z.string().default(''),

  /** Pasta com os binários das releases, servida em /downloads/. */
  RELEASES_DIR: z.string().default('./releases'),

  /**
   * Cache dos repositórios que a API clona para montar uma release. Deve ser
   * volume: sem ele, cada deploy reclona centenas de MB.
   */
  SOURCES_DIR: z.string().default('./sources'),

  /** Repositório cujas GitHub Releases carregam os binários compilados. */
  BINARIES_REPO: z.string().default('RaposoG/kam_brasil'),

  /**
   * Só necessário se BINARIES_REPO for privado. Anexos de repositório público
   * baixam sem autenticação.
   */
  GITHUB_TOKEN: z.string().default(''),

  /**
   * IPs autorizados a verificar tokens (`GET /auth/verify`), separados por vírgula.
   *
   * Quem consome essa rota é o servidor de jogo, que roda ao lado da API. O
   * token trafega em claro na query — limitação do cliente HTTP do Pascal — então
   * o padrão é loopback e alterar isso exige saber o que está fazendo.
   */
  VERIFY_ALLOWED_IPS: z.string().default('127.0.0.1'),

  /**
   * Liga a ranqueada. Ligada por padrão: é recurso principal da plataforma, e
   * exigir uma variável para ativar já custou uma noite de "por que a fila não
   * anda" — o sintoma de desligada é idêntico ao de quebrada.
   *
   * `RANKED_ENABLED=false` desliga a fila, o pareador e o canal de tempo real.
   * As rotas internas seguem registradas de propósito: sem pareador ninguém
   * cria lobby, então `/internal/ranked/rooms` responde vazio por conta própria
   * e o servidor dedicado continua perguntando sem tomar 404 a cada 3s.
   *
   * Histórico, replay e perfil continuam de pé: são leitura do que já
   * aconteceu, e derrubá-los quebraria telas que nada têm a ver com a fila.
   */
  RANKED_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Segredo compartilhado das rotas internas do ranqueado
   * (`/internal/ranked/*`), chamadas pelo servidor dedicado.
   *
   * Vazio desliga as rotas — padrão seguro, igual ao ADMIN_TOKEN: sem isso
   * configurado, ninguém reporta resultado. O allowlist de IP dessas rotas é o
   * mesmo VERIFY_ALLOWED_IPS: é o mesmo binário, na mesma máquina, chamando as
   * duas coisas.
   */
  RANKED_INTERNAL_SECRET: z.string().default(''),

  /**
   * Arquivo onde o segredo interno mora quando ninguém o definiu à mão.
   *
   * A API cria na primeira subida, com 32 bytes aleatórios, e o entrypoint do
   * gameserver lê o mesmo arquivo — é assim que os dois lados combinam sem
   * ninguém configurar nada. O volume é compartilhado só entre eles.
   *
   * Não reaproveitamos o JWT_SECRET para isto: este segredo viaja na
   * querystring (o cliente HTTP do Pascal só faz GET) e querystring entra no
   * log de acesso. Um segredo próprio vazado custa partidas falsas; o JWT
   * vazado custa todas as contas.
   */
  RANKED_SECRET_FILE: z.string().default(''),

  /**
   * CRCs de executável aceitos em partida ranqueada, separados por vírgula
   * (`/internal/ranked/build`). Vazio = aceita qualquer build; só use assim em
   * desenvolvimento.
   *
   * É obstáculo, não segurança — um cliente modificado mente o CRC. Serve para
   * pegar build divergente na comunidade, que é a causa real de desync neste
   * fork (ALLOW_MP_MODS = True).
   */
  RANKED_ALLOWED_EXE_CRCS: z.string().default(''),

  /**
   * Intervalo do laço que pareia a fila e cobra os turnos de ban vencidos.
   *
   * 0 desliga o laço — é assim que um processo que não deve rodar matchmaking
   * (script, migração, um segundo nó) sobe sem duplicar partida.
   */
  RANKED_TICK_MS: z.coerce.number().int().nonnegative().default(3_000),

  /**
   * Prazo de cada turno de ban. Estourou, o sistema bane pelo time que não
   * votou: um jogador ausente não pode travar a partida dos outros sete.
   */
  RANKED_BAN_TURNO_SEG: z.coerce.number().int().positive().default(25),

  /**
   * Bloco de salas do servidor dedicado reservado para o ranqueado.
   *
   * O protocolo do KaM não sabe criar sala por nome: sala é índice, e quem
   * entra primeiro vira host. Então a API é dona da alocação — reserva um
   * bloco e nunca entrega o mesmo índice a dois lobbies vivos.
   *
   * O padrão é a metade de cima do `MAX_ROOMS=16` do gameserver: as salas 0–7
   * seguem livres para partida casual. Mexer aqui exige mexer no MAX_ROOMS
   * junto — um índice fora do máximo é sala que não existe.
   */
  RANKED_ROOM_FIRST: z.coerce.number().int().nonnegative().default(8),
  RANKED_ROOM_COUNT: z.coerce.number().int().positive().default(8),

  /**
   * Ligue em produção quando a API estiver atrás de nginx/Cloudflare.
   * Sem isso, request.ip devolve o IP do proxy — e o ANNOUNCE_ALLOWED_IPS
   * passaria a comparar sempre contra o mesmo endereço, virando inútil.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Configuração inválida:\n${issues}`)
}

export const config = {
  ...parsed.data,
  RANKED_INTERNAL_SECRET: resolverSegredoInterno(
    parsed.data.RANKED_INTERNAL_SECRET,
    parsed.data.RANKED_SECRET_FILE,
  ),
  isDev: parsed.data.NODE_ENV === 'development',
  announceAllowedIps: parsed.data.ANNOUNCE_ALLOWED_IPS.split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
  verifyAllowedIps: parsed.data.VERIFY_ALLOWED_IPS.split(',')
    .map((ip) => ip.trim())
    .filter(Boolean),
  adminEmails: parsed.data.ADMIN_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  rankedAllowedExeCrcs: parsed.data.RANKED_ALLOWED_EXE_CRCS.split(',')
    .map((crc) => crc.trim().toUpperCase())
    .filter(Boolean),
}

/**
 * O e-mail está na allowlist do painel? Comparação em minúsculas dos dois lados
 * porque `accounts.email` é sempre gravado assim (ver routes/auth.ts) e ninguém
 * deve perder o acesso por ter digitado o `.env` com maiúscula.
 */
export function isAdminEmail(email: string): boolean {
  return config.adminEmails.includes(email.trim().toLowerCase())
}
