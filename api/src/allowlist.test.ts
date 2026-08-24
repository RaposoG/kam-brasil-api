import { beforeEach, describe, expect, test } from 'bun:test'

import { atualizarNomes, definirResolvidos, nomesDe, origemPermitida } from './allowlist.ts'

describe('allowlist de origem', () => {
  beforeEach(() => definirResolvidos([]))

  test('IP exato casa, e só ele', () => {
    expect(origemPermitida('10.0.0.7', ['10.0.0.7'])).toBe(true)
    expect(origemPermitida('10.0.0.8', ['10.0.0.7'])).toBe(false)
  })

  test('lista vazia recusa — quem quiser abrir em dev decide no chamador', () => {
    expect(origemPermitida('10.0.0.7', [])).toBe(false)
  })

  test('endereço vazio nunca passa', () => {
    // socket.remoteAddress pode vir undefined e peerIp devolve ''. Sem esta
    // guarda, uma entrada '' na lista casaria com ele.
    expect(origemPermitida('', ['', 'gameserver'])).toBe(false)
  })

  test('nome só libera o IP que ele resolveu', () => {
    definirResolvidos(['172.19.0.4'])
    expect(origemPermitida('172.19.0.4', ['gameserver'])).toBe(true)
    expect(origemPermitida('172.19.0.9', ['gameserver'])).toBe(false)
  })

  test('sem nada resolvido, nome nenhum libera', () => {
    // É o estado do boot e o de um DNS fora do ar. Tem que FECHAR: o contrário
    // transformaria uma falha de infraestrutura em "aceita todo mundo".
    expect(origemPermitida('172.19.0.4', ['gameserver'])).toBe(false)
  })

  test('faixa CIDR não libera nada — é entrada que nunca casa', () => {
    // Escrever 172.16.0.0/12 pareceria liberar a rede interna; deixaria passar
    // o Traefik junto, ou seja, a internet. Não é suportado de propósito.
    definirResolvidos(['172.16.0.5'])
    expect(origemPermitida('172.16.0.5', ['172.16.0.0/12'])).toBe(true)
    // ^ passou pelo NOME (a faixa vira "nome" e o IP está resolvido), não pela
    // faixa. Sem nada resolvido, não passa:
    definirResolvidos([])
    expect(origemPermitida('172.16.0.5', ['172.16.0.0/12'])).toBe(false)
  })

  test('nomesDe separa nome de endereço', () => {
    expect(nomesDe(['gameserver', '10.0.0.7', 'gameserver-ranked', '::1'])).toEqual([
      'gameserver',
      'gameserver-ranked',
    ])
  })

  test('atualizarNomes resolve de verdade, e nome inválido não abre', async () => {
    // localhost é o único nome que resolve igual em qualquer máquina; em
    // produção são `gameserver` e `gameserver-ranked`, pelo DNS do Docker.
    const ips = await atualizarNomes(['localhost'])
    expect(ips.has('127.0.0.1') || ips.has('::1')).toBe(true)

    const vazio = await atualizarNomes(['nao-existe.invalid'])
    expect(vazio.size).toBe(0)
    expect(origemPermitida('10.0.0.7', ['nao-existe.invalid'])).toBe(false)
  })
})
