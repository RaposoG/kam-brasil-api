<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { gameStatus, listReplays } from "../api";

// Tudo local: o Rust varre Saves/ e SavesMP/ da instalação. Nada vem da rede.
const saves = ref<Awaited<ReturnType<typeof listReplays>>>([]);
const instalado = ref(true);
const pastaJogo = ref("");

onMounted(async () => {
  const st = await gameStatus();
  instalado.value = st.installed;
  pastaJogo.value = st.path;
  if (st.installed) saves.value = await listReplays();
});

const quando = (ms: number) => {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
};

const mb = (bytes: number) =>
  (bytes / 1_048_576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB";

const cartas = computed(() =>
  saves.value.map((r) => ({
    nome: r.name,
    modo: r.mode,
    quando: quando(r.modifiedMs),
    tamanho: mb(r.sizeBytes),
    temReplay: r.hasReplay,
  })),
);

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
        <p class="sub-tela">os saves da sua instalação — com selo quando o replay existe</p>
      </div>
      <button class="btn-contorno ativo" :disabled="!instalado" @click="abrirPasta">
        ABRIR PASTA
      </button>
    </div>

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
          <div class="meta">
            <span>{{ r.quando }} · {{ r.tamanho }}</span>
            <span v-if="r.temReplay" class="selo-replay">REPLAY</span>
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
.vazio {
  margin: 20px 0 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
}
</style>
