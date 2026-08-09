<script setup lang="ts">
import { CONQUISTAS } from "../mock";
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Feitos e honrarias</h1>
        <p class="sub-tela">23 de 60 conquistadas</p>
      </div>
      <span class="percentual">38%</span>
    </div>

    <div class="grade">
      <div v-for="c in CONQUISTAS" :key="c.sigla" class="conquista">
        <div class="escudo medalha" :style="{ background: c.fundo, borderColor: c.borda }">
          <span :style="{ color: c.cor }">{{ c.sigla }}</span>
        </div>
        <div class="corpo">
          <div class="nome" :style="{ color: c.cor }">{{ c.nome }}</div>
          <div class="desc">{{ c.desc }}</div>
          <div class="progresso">
            <div class="fita"><i :style="{ width: c.pct + '%' }" /></div>
            <span class="contagem">{{ c.progresso }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.percentual {
  font-family: var(--display);
  font-size: 20px;
  color: var(--ouro);
  flex: none;
}
.grade {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  margin-top: 20px;
}
.conquista {
  display: flex;
  gap: 16px;
  background: var(--painel);
  border: 1px solid var(--linha);
  padding: 16px 18px;
}
.conquista:hover {
  border-color: var(--bronze);
}
.medalha {
  width: 38px;
  height: 43px;
  flex: none;
  border: 1px solid;
}
.medalha span {
  font-family: var(--display);
  font-size: 13px;
  font-weight: 700;
}
.corpo {
  min-width: 0;
  flex: 1;
}
.nome {
  font-family: var(--display);
  font-size: 13.5px;
  letter-spacing: 0.04em;
}
.desc {
  font-size: 12px;
  color: var(--calado);
  line-height: 1.4;
  text-wrap: pretty;
}
.progresso {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 9px;
}
.fita {
  flex: 1;
  height: 5px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--linha);
}
.fita i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--ouro-fundo), var(--ouro));
}
.contagem {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-2);
}
</style>
