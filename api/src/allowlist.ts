// Quem pode chamar as rotas internas: anúncio de servidor (`serveradd.php`),
// `/auth/verify` e `/internal/ranked/*`.
//
// A entrada pode ser um IP exato ou um NOME DE SERVIÇO do compose. O nome é o
// que se usa desde que os gameservers saíram de dentro da API: eles ganham IP
// dinâmico na rede do compose, e fixar endereço exigiria declarar subnet
// própria — que o Dokploy reescreve ao injetar a rede do Traefik.
//
// Resolver o nome é seguro porque quem responde é o DNS embutido do Docker
// (127.0.0.11), que só conhece os serviços deste projeto. Não há como um
// jogador na internet fazer `gameserver` apontar para a máquina dele.
//
// O que isto NÃO é: uma faixa. Liberar 172.16.0.0/12 pareceria equivalente e
// seria um furo — o Traefik também é um container em faixa privada, então
// requisição vinda da internet, proxiada por ele, passaria no allowlist.
//
// A resolução acontece FORA da requisição, num laço de fundo. Não é otimização:
// um `await` dentro do hook `onRequest` faz o Fastify sob o Bun mandar o
// cabeçalho duas vezes ("Cannot writeHead headers after they are sent"), e a
// recusa de 403 vira erro 500. A checagem por requisição é síncrona, como
// sempre foi.

import { lookup } from 'node:dns/promises'

/** De quanto em quanto tempo os nomes são reconsultados. */
export const INTERVALO_MS = 30_000

/** IPs conhecidos dos nomes configurados. Vazio = ninguém entra por nome. */
let resolvidos = new Set<string>()

function pareceEndereco(entrada: string): boolean {
  // IPv4 (quatro octetos) ou IPv6 (tem dois-pontos). O resto é nome.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(entrada) || entrada.includes(':')
}

/** Os nomes (não-IPs) de uma lista de allowlist. */
export function nomesDe(entradas: readonly string[]): string[] {
  return entradas.filter((e) => e.length > 0 && !pareceEndereco(e))
}

/**
 * Reconsulta todos os nomes e troca o conjunto de uma vez.
 *
 * Troca atômica de propósito: mutar o conjunto no lugar deixaria uma janela em
 * que ele está pela metade, e uma requisição legítima levaria 403 no meio de
 * uma atualização de rotina.
 */
export async function atualizarNomes(nomes: readonly string[]): Promise<Set<string>> {
  const novo = new Set<string>()
  for (const nome of nomes) {
    try {
      for (const achado of await lookup(nome, { all: true })) novo.add(achado.address)
    } catch {
      // Falha FECHADA: um nome que não resolve não libera ninguém. O contrário
      // transformaria um DNS fora do ar em "aceita todo mundo".
    }
  }
  resolvidos = novo
  return novo
}

/** Só para os testes. */
export function definirResolvidos(ips: readonly string[]) {
  resolvidos = new Set(ips)
}

/**
 * O endereço do socket está autorizado? Síncrono — ver o comentário do topo.
 *
 * Lista vazia devolve `false`: quem quiser tratar isso como "aberto em
 * desenvolvimento" decide no chamador, à vista, e não por omissão aqui.
 */
export function origemPermitida(ip: string, entradas: readonly string[]): boolean {
  if (entradas.length === 0 || ip.length === 0) return false

  for (const entrada of entradas) {
    if (pareceEndereco(entrada)) {
      if (entrada === ip) return true
    } else if (resolvidos.has(ip)) {
      return true
    }
  }
  return false
}
