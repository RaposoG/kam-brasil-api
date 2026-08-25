/**
 * Sincronia dos mapas do catálogo global.
 *
 * Estado num módulo com refs no topo, pelo mesmo motivo de `install.ts`: a
 * janela é uma só, e quem dispara a sincronia (o Shell, no boot e no aviso do
 * socket) não é quem mostra o progresso (a tela de Cartografia).
 *
 * O trabalho é todo do Rust (`src-tauri/src/mapas.rs`). Aqui só ficam o gatilho,
 * o progresso e a nova tentativa quando a sincronia é adiada.
 */

import { computed, ref } from "vue";
import { type InstallProgress, type ResumoMapas, mapasSync, onMapasProgress } from "./api";

export const sincronizando = ref(false);
export const progressoMapas = ref<InstallProgress | null>(null);
export const resumoMapas = ref<ResumoMapas | null>(null);
export const erroMapas = ref("");

/** Uma assinatura só para a vida do launcher, na primeira sincronia. */
let ouvindo: Promise<unknown> | null = null;

let retentativa = 0;

/**
 * O Rust adia quando o jogo está aberto (e quando o jogo ainda nem foi
 * instalado). Meia hora é o intervalo de uma partida de KaM — insistir de
 * minuto em minuto só gastaria `tasklist` para receber a mesma resposta.
 */
const ESPERA_PARA_TENTAR_DE_NOVO = 30 * 60_000;

/** A última assinatura que esta sessão já pôs no disco. */
let assinaturaSincronizada = "";

/**
 * @param assinatura a que veio no aviso do canal. Igual à já sincronizada, não
 * há o que fazer — e é esse atalho que deixa a API empurrar o aviso na conexão
 * sem custar uma conferência de centenas de arquivos a cada reconexão.
 */
export async function sincronizarMapas(assinatura = "") {
  if (assinatura && assinatura === assinaturaSincronizada) return;

  // O boot dispara, e o aviso do socket pode chegar no mesmo segundo. O Rust
  // também se defende disso, mas aqui a tela não pisca duas barras.
  if (sincronizando.value) return;

  ouvindo ??= onMapasProgress((p) => (progressoMapas.value = p));

  sincronizando.value = true;
  erroMapas.value = "";
  clearTimeout(retentativa);

  try {
    const resumo = await mapasSync();
    resumoMapas.value = resumo;
    // Só depois de o disco estar de acordo. Marcar antes faria uma sincronia
    // que falhou no meio passar por feita, e o aviso seguinte seria ignorado.
    if (!resumo.adiado) assinaturaSincronizada = resumo.assinatura;
    // Adiado não é erro nem fim: o jogo fecha, a instalação termina, e aí a
    // sincronia acontece sem o jogador precisar reabrir o launcher.
    else retentativa = window.setTimeout(() => sincronizarMapas(), ESPERA_PARA_TENTAR_DE_NOVO);
  } catch (e) {
    erroMapas.value = String(e);
  } finally {
    sincronizando.value = false;
    progressoMapas.value = null;
  }
}

/** Uma linha para a tela, ou vazio quando não há o que dizer. */
export const recadoDaSincronia = computed(() => {
  if (erroMapas.value) return `Não foi possível sincronizar os mapas: ${erroMapas.value}`;

  const p = progressoMapas.value;
  if (sincronizando.value && p?.phase === "baixando")
    return `Baixando mapas do catálogo — ${p.files_done} de ${p.files_total} arquivos.`;
  if (sincronizando.value && p?.phase === "verificando")
    return "Conferindo os mapas do catálogo na sua instalação…";
  if (sincronizando.value) return "Sincronizando os mapas do catálogo…";

  const r = resumoMapas.value;
  if (!r) return "";
  if (r.adiado) return `Sincronia de mapas adiada: ${r.motivo}. Tentaremos de novo sozinhos.`;
  if (r.baixados || r.apagados)
    return `Catálogo sincronizado: ${r.baixados} arquivo(s) baixado(s), ${r.apagados} removido(s).`;
  return `Catálogo em dia — ${r.total} mapas.`;
});
