/**
 * Sanitização de texto vindo de fora.
 *
 * `maps.php` é rota pública sem credencial — os parâmetros são fixos no Pascal
 * e qualquer um na internet pode chamá-la. E o chat exibe texto de jogador na
 * interface de outros jogadores. Nos dois casos, caractere de controle, vírgula
 * e `|` são veneno: o KaM usa `|` como quebra de linha e vírgula como separador
 * de campos nos formatos de texto puro.
 */

const CONTROL_COMMA_PIPE = /[\u0000-\u001f\u007f,|]/g
const CONTROL = /[\u0000-\u001f\u007f]/g

/**
 * Nome de mapa para persistir em match_reports: controle/vírgula/pipe viram
 * espaço, aparas nas pontas, máximo 120. Vazio = o report não é gravado.
 */
export function sanitizeMapName(raw: string): string {
  return raw.replace(CONTROL_COMMA_PIPE, ' ').trim().slice(0, 120).trim()
}

/** playercount do report: 0 a 16 (o máximo de jogadores do KaM Remake). */
export function clampPlayerCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.trunc(value), 0), 16)
}

/**
 * Corpo de mensagem da taverna: controle vira espaço, espaços em sequência
 * colapsam, aparas nas pontas. `null` = inválido (vazio ou acima de 280) e a
 * rota responde 400.
 */
export function cleanChatBody(raw: string): string | null {
  const body = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  if (body.length === 0 || body.length > 280) return null
  return body
}
