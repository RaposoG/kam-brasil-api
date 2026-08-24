<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type Account,
  type Partida,
  type ReplaySave,
  enviarReplay,
  gameStatus,
  historicoDePartidas,
  listReplays,
  partidaDoSave,
  tempoRelativo,
  urlDoReplay,
} from "../api";

/**
 * Os saves da instalação, cruzados com as suas partidas.
 *
 * O replay é enriquecimento, nunca resultado: quem diz quem ganhou é o servidor
 * dedicado. O que sobe daqui é o par `.bas` + `.rpl` para quem quiser assistir.
 */

const account = inject<Account>("account");

const saves = ref<ReplaySave[]>([]);
const minhas = ref<Partida[]>([]);
const instalado = ref(true);
const pastaJogo = ref("");
/** Nome do save em envio — o botão do cartão certo é que fica ocupado. */
const enviando = ref("");
const aviso = ref("");
const erro = ref("");

async function recarregarPartidas() {
  if (!account) return;
  minhas.value = (await historicoDePartidas({ accountId: account.id, limit: 20 })).partidas;
}

onMounted(async () => {
  const st = await gameStatus();
  instalado.value = st.installed;
  pastaJogo.value = st.path;
  if (st.installed) saves.value = await listReplays();

  // Sem rede a tela continua sendo o arquivo local — é o que ela sempre foi.
  recarregarPartidas().catch(() => {});
});

const mb = (bytes: number) =>
  (bytes / 1_048_576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB";

const cartas = computed(() =>
  saves.value.map((r) => {
    const partida = partidaDoSave(r, minhas.value);
    return {
      nome: r.name,
      modo: r.mode,
      quando: tempoRelativo(r.modifiedMs),
      tamanho: mb(r.sizeBytes),
      temReplay: r.hasReplay,
      partida,
      mapa: partida?.mapa.nome ?? null,
      // Só faz sentido oferecer o envio do que ainda não está lá e do que tem
      // `.rpl`: sem ele não há o que assistir.
      podeEnviar: !!partida && !partida.replay && r.hasReplay,
    };
  }),
);

async function enviar(nome: string, matchId: string) {
  enviando.value = nome;
  erro.value = "";
  aviso.value = "";
  try {
    const r = await enviarReplay(matchId, nome);
    aviso.value = r.jaExistia
      ? "Alguém da partida já tinha enviado este replay — obrigado assim mesmo."
      : "Replay enviado: agora qualquer um pode assistir a esta partida.";
    // Sem recarregar, o cartão continuaria oferecendo o envio que já foi feito.
    await recarregarPartidas();
  } catch (e) {
    erro.value = String(e);
  } finally {
    enviando.value = "";
  }
}

/** Rota pública: o navegador do sistema baixa sem token nenhum. */
async function baixar(id: string, parte: "rpl" | "bas") {
  await openUrl(await urlDoReplay(id, parte));
}

// Abre a pasta dos saves multiplayer no Explorer — a permissão do plugin-opener
// já existe no capabilities do Tauri.
async function abrirPasta() {
  await revealItemInDir(pastaJogo.value + "\\SavesMP");
}
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Arquivo de replays</h1>
        <p class="sub-tela">os saves da sua instalação — e o que já está na crônica</p>
      </div>
      <button class="btn-contorno ativo" :disabled="!instalado" @click="abrirPasta">
        ABRIR PASTA
      </button>
    </div>

    <p v-if="erro" class="erro faixa">{{ erro }}</p>
    <p v-else-if="aviso" class="aviso faixa">{{ aviso }}</p>

    <p v-if="!instalado" class="vazio">
      O jogo ainda não está instalado — instale pela tela principal e os saves aparecem aqui.
    </p>
    <p v-else-if="!cartas.length" class="vazio">
      Nenhum save encontrado. Jogue uma partida e volte aqui.
    </p>

    <div v-else class="grade">
      <div v-for="r in cartas" :key="r.modo + r.nome" class="cartao">
        <div class="corpo">
          <div class="topo">
            <div class="nome">{{ r.nome }}</div>
            <span class="chip">{{ r.modo }}</span>
          </div>

          <div v-if="r.mapa" class="mapa">{{ r.mapa }}</div>

          <div class="meta">
            <span>{{ r.quando }} · {{ r.tamanho }}</span>
            <span v-if="r.temReplay" class="selo-replay">REPLAY</span>
          </div>

          <!-- O envio só aparece quando existe partida para receber: botão que
               não tem o que fazer é pior que botão nenhum. -->
          <div v-if="r.partida" class="acoes">
            <template v-if="r.partida.replay">
              <span class="na-cronica mono">NA CRÔNICA</span>
              <button class="btn-contorno mini" @click="baixar(r.partida.id, 'rpl')">
                BAIXAR .RPL
              </button>
              <button class="btn-contorno mini" @click="baixar(r.partida.id, 'bas')">
                BAIXAR .BAS
              </button>
            </template>
            <button
              v-else-if="r.podeEnviar"
              class="btn-contorno mini ativo"
              :disabled="!!enviando"
              @click="enviar(r.nome, r.partida.id)"
            >
              {{ enviando === r.nome ? "ENVIANDO…" : "ENVIAR REPLAY" }}
            </button>
            <span v-else class="sem-rpl mono">SEM .RPL PARA ENVIAR</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grade {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 20px;
}
.cartao {
  background: var(--painel);
  border: 1px solid var(--linha);
}
.cartao:hover {
  border-color: var(--bronze);
}
.corpo {
  padding: 13px 15px;
}
.topo {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.nome {
  min-width: 0;
  font-family: var(--display);
  font-size: 13.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip {
  flex: none;
  padding: 2px 7px;
  border: 1px solid var(--bronze);
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--ouro);
}
.mapa {
  margin-top: 6px;
  font-size: 12px;
  color: var(--calado);
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid var(--linha-fraca);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
}
.selo-replay {
  color: var(--verde);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 11px;
}
.mini {
  padding: 5px 11px;
  font-size: 9px;
}
.na-cronica {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--verde);
}
.sem-rpl {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--calado-3);
}
.faixa {
  margin-top: 16px;
}
.vazio {
  margin: 20px 0 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
}
</style>
