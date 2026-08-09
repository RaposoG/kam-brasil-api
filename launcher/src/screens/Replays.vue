<script setup lang="ts">
import { REPLAYS } from "../mock";
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Arquivo de replays</h1>
        <p class="sub-tela">Guardados 90 dias · favoritos ficam para sempre</p>
      </div>
      <button class="btn-contorno ativo">IMPORTAR ARQUIVO</button>
    </div>

    <div class="grade">
      <div v-for="r in REPLAYS" :key="r.mapa" class="cartao">
        <div class="capa">
          <span class="capa-nota">[ preview do mapa ]</span>
          <span class="veredito" :style="{ color: r.cor }">{{ r.resultado }}</span>
        </div>
        <div class="corpo">
          <div class="mapa">{{ r.mapa }}</div>
          <div class="contra">{{ r.contra }}</div>
          <div class="meta">
            <span>{{ r.meta }}</span>
            <button class="baixar">BAIXAR</button>
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
  overflow: hidden;
}
.cartao:hover {
  border-color: var(--bronze);
}
.capa {
  height: 104px;
  background: repeating-linear-gradient(135deg, rgba(232, 220, 200, 0.05) 0 2px, transparent 2px 9px);
  border-bottom: 1px solid var(--linha);
  position: relative;
}
.capa-nota {
  position: absolute;
  bottom: 7px;
  left: 10px;
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: rgba(232, 220, 200, 0.4);
}
.veredito {
  position: absolute;
  top: 8px;
  right: 9px;
  padding: 3px 7px;
  background: rgba(20, 16, 13, 0.8);
  font-family: var(--mono);
  font-size: 9px;
}
.corpo {
  padding: 13px 15px;
}
.mapa {
  font-family: var(--display);
  font-size: 13.5px;
  color: var(--pergaminho);
}
.contra {
  font-size: 12px;
  color: var(--calado);
  font-style: italic;
}
.meta {
  display: flex;
  justify-content: space-between;
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px solid var(--linha-fraca);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
}
.baixar {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--ouro-medio);
}
.baixar:hover {
  color: var(--ouro-claro);
}
</style>
