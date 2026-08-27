import { config } from './config.ts'

/**
 * Email transacional via Resend.
 *
 * É um POST HTTPS com um JSON — de propósito sem o SDK deles: uma dependência
 * inteira para uma chamada de rede seria peso morto, e o formato da API é
 * estável e público (https://resend.com/docs/api-reference/emails/send-email).
 */

/** Os dois envs juntos ligam o envio; ver o comentário deles em config.ts. */
export function emailHabilitado(): boolean {
  return config.RESEND_API_KEY.length > 0 && config.RESEND_FROM.length > 0
}

export async function enviarEmail(para: string, assunto: string, texto: string, html: string): Promise<void> {
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: config.RESEND_FROM, to: [para], subject: assunto, text: texto, html }),
  })

  if (!resposta.ok) {
    // O corpo do Resend diz o motivo (domínio não verificado, key inválida…) —
    // vai para o log, nunca para o jogador.
    const corpo = await resposta.text().catch(() => '')
    throw new Error(`Resend respondeu ${resposta.status}: ${corpo.slice(0, 300)}`)
  }
}
