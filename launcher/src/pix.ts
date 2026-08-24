/**
 * Monta o "BR Code" do Pix — o texto que vira QR e que também serve para
 * copiar e colar no aplicativo do banco.
 *
 * O formato é EMV®: uma sequência de campos `IDTAMANHOVALOR`, onde ID e tamanho
 * têm dois dígitos. Campos podem conter outros campos (26 e 62 contêm). O último
 * é sempre o CRC16, calculado sobre tudo que veio antes, incluindo o próprio
 * cabeçalho `6304`.
 *
 * Escrito à mão em vez de trazer uma biblioteca: são 40 linhas, o formato está
 * congelado pelo Banco Central, e uma dependência a mais para isso seria
 * desproporcional. Mas é dinheiro — então tem teste contra caso conhecido.
 */

/** `IDTAMANHOVALOR`, com o tamanho em dois dígitos. */
function campo(id: string, valor: string): string {
  return id + String(valor.length).padStart(2, '0') + valor
}

/**
 * CRC16/CCITT-FALSE: polinômio 0x1021, valor inicial 0xFFFF, sem inversão.
 *
 * É o que a especificação do Pix exige. Trocar por outra variante de CRC16
 * produz um código que o aplicativo do banco recusa sem explicar por quê.
 */
export function crc16(texto: string): string {
  let crc = 0xffff
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Remove acento e o que não for imprimível em ASCII.
 *
 * Nome e cidade viajam no código, e caractere fora do ASCII faz alguns bancos
 * recusarem a leitura. "São Paulo" vira "Sao Paulo".
 */
function ascii(texto: string, limite: number): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, limite)
}

export interface DadosPix {
  chave: string
  nome: string
  cidade: string
  /** Em reais. Ausente = quem paga escolhe o valor no banco. */
  valor?: number
  /** Identificador da transação. `***` quando não há. */
  txid?: string
}

export function montarPix({ chave, nome, cidade, valor, txid = '***' }: DadosPix): string {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave)

  const partes = [
    campo('00', '01'), // versão do formato
    // 12 = estático e reutilizável. Com valor definido continua reutilizável;
    // 11 (uso único) faria o banco recusar a segunda leitura do mesmo código.
    campo('01', '12'),
    campo('26', conta),
    campo('52', '0000'), // categoria do estabelecimento: não se aplica
    campo('53', '986'), // real brasileiro
    ...(valor && valor > 0 ? [campo('54', valor.toFixed(2))] : []),
    campo('58', 'BR'),
    campo('59', ascii(nome, 25)),
    campo('60', ascii(cidade, 15)),
    campo('62', campo('05', txid)),
  ]

  // O CRC entra sobre o texto JÁ com "6304" no fim — a especificação inclui o
  // próprio cabeçalho do campo no cálculo.
  const semCrc = partes.join('') + '6304'
  return semCrc + crc16(semCrc)
}
