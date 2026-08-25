<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { listLocalMaps } from "../api";
import { recadoDaSincronia, sincronizando, sincronizarMapas } from "../mapas";

// Mapas instalados na pasta do jogo (Maps/ e MapsMP/), lidos pelo Rust.
// Contagem de jogadores exigiria parsear o .dat binário — fica de fora.
const mapas = ref<Awaited<ReturnType<typeof listLocalMaps>>>([]);

const recarregar = async () => (mapas.value = await listLocalMaps());

onMounted(recarregar);

// A sincronia baixa e apaga pasta: a lista na tela precisa refletir isso assim
// que ela termina, senão fica anunciando mapa que já não existe.
watch(sincronizando, (rodando) => {
  if (!rodando) recarregar();
});

const filtro = ref<"todos" | "SP" | "MP">("todos");
const FILTROS = [
  { id: "todos", label: "TODOS" },
  { id: "SP", label: "SP" },
  { id: "MP", label: "MP" },
] as const;

const lista = computed(() =>
  mapas.value.filter((m) => filtro.value === "todos" || m.mode === filtro.value),
);

const data = (ms: number) => new Date(ms).toLocaleDateString("pt-BR");
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Cartografia</h1>
        <p class="sub-tela">{{ mapas.length }} mapas instalados na sua pasta do jogo</p>
      </div>
      <div class="filtros">
        <button
          v-for="f in FILTROS"
          :key="f.id"
          class="filtro"
          :class="{ ativo: filtro === f.id }"
          @click="filtro = f.id"
        >
          {{ f.label }}
        </button>
        <button class="filtro sincronizar" :disabled="sincronizando" @click="sincronizarMapas()">
          {{ sincronizando ? "SINCRONIZANDO…" : "SINCRONIZAR" }}
        </button>
      </div>
    </div>

    <!-- Mapa baixando sem barra é jogador achando que travou: o que a sincronia
         está fazendo aparece aqui, inclusive quando ela foi adiada. -->
    <p v-if="recadoDaSincronia" class="sincronia">{{ recadoDaSincronia }}</p>

    <p v-if="!lista.length" class="vazio">
      Nenhum mapa encontrado — instale o jogo pela tela principal e eles aparecem aqui.
    </p>

    <div v-else class="grade">
      <div v-for="m in lista" :key="m.mode + m.name" class="cartao">
        <div class="topo">
          <div class="nome">{{ m.name }}</div>
          <span class="chip">{{ m.mode }}</span>
        </div>
        <div class="meta">{{ data(m.modifiedMs) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: 2px;
  flex: none;
}
.sincronizar {
  margin-left: 10px;
}
.sincronizar:disabled {
  opacity: 0.6;
  cursor: default;
}
.sincronia {
  margin-top: 14px;
  padding: 8px 12px;
  border: 1px solid var(--linha);
  background: var(--painel);
  font-size: 12px;
  color: var(--pergaminho-fraco, var(--pergaminho));
}
.grade {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 20px;
}
.cartao {
  background: var(--painel);
  border: 1px solid var(--linha);
  padding: 12px 14px;
}
.cartao:hover {
  border-color: var(--bronze);
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
  font-size: 13px;
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
  margin-top: 7px;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--calado-3);
}
.vazio {
  margin: 20px 0 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
}
</style>
