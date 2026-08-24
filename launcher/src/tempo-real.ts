import { onMounted, onUnmounted, ref } from 'vue'
import { type EventoRanqueado, onTempoReal, tempoRealStart, tempoRealStop } from './api'

/**
 * Assina o canal de tempo real da ranqueada nas telas de fila e lobby.
 *
 * Devolve `ligado` — e é essa a razão de existir do composable. A tela NÃO
 * larga o poll: ela o suspende enquanto `ligado` for verdadeiro e volta a
 * consultar assim que o socket cair. Quem está numa fila ranqueada não pode
 * ficar cego porque a rede oscilou dez segundos.
 *
 * O socket em si vive no Rust (é autenticado com o token de sessão); aqui só
 * contamos quantas telas ainda precisam dele.
 */

let assinantes = 0
let desligamento = 0

/** `conexao` não chega ao chamador: ele já sai por `ligado`. */
type EventoDeEstado = Exclude<EventoRanqueado, { tipo: 'conexao' }>

export function useTempoReal(aoEvento: (e: EventoDeEstado) => void) {
  const ligado = ref(false)
  let vivo = true
  let parar: (() => void) | null = null

  onMounted(async () => {
    assinantes++
    // Trocar de fila para lobby não pode derrubar o canal no meio do caminho.
    clearTimeout(desligamento)

    const desassinar = await onTempoReal((e) => {
      if (e.tipo === 'conexao') ligado.value = e.ligado
      else aoEvento(e)
    })

    // A tela pode ter saído enquanto o `listen` resolvia.
    if (!vivo) return desassinar()
    parar = desassinar

    // Falhar aqui não derruba nada: sem socket, o poll continua sendo a tela.
    tempoRealStart().catch(() => (ligado.value = false))
  })

  onUnmounted(() => {
    vivo = false
    parar?.()
    if (--assinantes > 0) return

    // ponytail: carência em vez de refcount exato. Ao trocar de tela o Vue
    // desmonta a antiga antes de montar a nova, e sem a folga o canal cairia e
    // subiria de novo a cada navegação — um handshake TLS por clique.
    desligamento = window.setTimeout(() => {
      if (assinantes === 0) tempoRealStop().catch(() => {})
    }, 5_000)
  })

  return ligado
}
