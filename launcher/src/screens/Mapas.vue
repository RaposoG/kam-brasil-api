<script setup lang="ts">
import { ref } from "vue";
import { MAPAS } from "../mock";

const filtro = ref("populares");
const FILTROS = [
  { id: "populares", label: "POPULARES" },
  { id: "novos", label: "NOVOS" },
  { id: "favoritos", label: "SEUS FAVORITOS" },
];
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Cartografia</h1>
        <p class="sub-tela">62 mapas instalados · 8 da comunidade brasileira</p>
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
      </div>
    </div>

    <div class="grade">
      <div v-for="m in MAPAS" :key="m.nome" class="cartao">
        <div class="capa">
          <span class="jogadores">{{ m.jogadores }}</span>
          <span class="capa-nota">[ minimapa ]</span>
        </div>
        <div class="corpo">
          <div class="nome">{{ m.nome }}</div>
          <div class="meta">
            <span>{{ m.partidas }}</span><span class="winrate">{{ m.winrate }}</span>
          </div>
        </div>
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
.grade {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
.capa {
  aspect-ratio: 1.35;
  background: repeating-linear-gradient(45deg, rgba(232, 220, 200, 0.05) 0 2px, transparent 2px 9px);
  border-bottom: 1px solid var(--linha);
  position: relative;
}
.capa-nota {
  position: absolute;
  bottom: 7px;
  left: 9px;
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.06em;
  color: rgba(232, 220, 200, 0.35);
}
.jogadores {
  position: absolute;
  top: 7px;
  left: 9px;
  padding: 2px 6px;
  background: rgba(20, 16, 13, 0.75);
  font-family: var(--mono);
  font-size: 8.5px;
  color: var(--ouro);
}
.corpo {
  padding: 12px 14px;
}
.nome {
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--calado-3);
}
.winrate {
  color: var(--calado);
}
</style>
