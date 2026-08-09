<script setup lang="ts">
import { computed, inject } from "vue";
import type { Account } from "../api";
import { DIVISOES, JOGADOR, LEADERBOARD, MAPAS_TOP, PARTIDAS_DIA, PATENTE, STATS_GLOBAIS } from "../mock";

const account = inject<Account>("account");

// A linha do jogador no quadro usa o apelido real da conta — o resto da tabela
// é fictício, mas ver o nome de outra pessoa no próprio lugar seria estranho.
const quadro = computed(() =>
  LEADERBOARD.map((p) => (p.nome === JOGADOR ? { ...p, nome: account?.nickname ?? p.nome } : p)),
);
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Ordem do Reino</h1>
        <p class="sub-tela">Temporada III · encerra em 22 dias</p>
      </div>
      <div class="globais">
        <div v-for="g in STATS_GLOBAIS" :key="g.label" class="global">
          <div class="global-valor">{{ g.valor }}</div>
          <div class="global-label">{{ g.label }}</div>
        </div>
      </div>
    </div>

    <div class="painel divisoes">
      <div class="divisoes-cabeca">
        <span class="rotulo">AS OITO DIVISÕES · DISTRIBUIÇÃO DA COMUNIDADE</span>
        <span class="voce-esta">você está em {{ PATENTE.titulo }}</span>
      </div>
      <div class="colunas">
        <div v-for="d in DIVISOES" :key="d.n" class="divisao">
          <span class="pct" :style="{ color: d.corTexto }">{{ d.pct }}%</span>
          <div class="torre" :style="{ height: d.altura + 'px', background: d.fundo, borderColor: d.borda }" />
          <div class="escudo brasao" :style="{ borderColor: d.borda }">
            <span :style="{ color: d.corTexto }">{{ d.n }}</span>
          </div>
          <span class="divisao-nome" :style="{ color: d.corTexto }">{{ d.nome }}</span>
          <span class="divisao-marca">{{ d.marca }}</span>
        </div>
      </div>
    </div>

    <div class="duas">
      <div class="carta quadro">
        <div class="quadro-cabeca">
          <span class="quadro-titulo">Os mais ilustres</span>
          <span class="quadro-nota">GLOBAL · 1V1</span>
        </div>
        <div v-for="p in quadro" :key="p.pos" class="linha" :style="{ background: p.fundo }">
          <span class="pos">{{ p.pos }}</span>
          <span class="jogador">{{ p.nome }}</span>
          <span class="divisao-txt">{{ p.divisao }}</span>
          <span class="registro">{{ p.registro }}</span>
          <span class="forma" :style="{ color: p.corForma }">{{ p.forma }}</span>
        </div>
      </div>

      <div class="lado">
        <div class="painel">
          <div class="rotulo espaco">MAPAS MAIS JOGADOS</div>
          <div v-for="m in MAPAS_TOP" :key="m.nome" class="mapa">
            <span class="mapa-nome">{{ m.nome }}</span>
            <div class="fita"><i :style="{ width: m.pct + '%' }" /></div>
            <span class="mapa-qtd">{{ m.qtd }}</span>
          </div>
        </div>

        <div class="painel cresce">
          <div class="rotulo espaco-curto">PARTIDAS POR DIA · 14 DIAS</div>
          <div class="dias">
            <div v-for="(b, i) in PARTIDAS_DIA" :key="i" class="dia" :style="{ height: b.pct + '%' }" />
          </div>
          <div class="dias-legenda">
            <span>27 JUL</span><span>média 288/dia</span><span>HOJE</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.globais {
  display: flex;
  gap: 24px;
  flex: none;
}
.global {
  text-align: right;
}
.global-valor {
  font-family: var(--display);
  font-size: 21px;
  font-weight: 600;
  color: var(--ouro);
}
.global-label {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.14em;
  color: var(--calado-3);
}

.divisoes {
  padding: 22px 24px;
  margin-top: 22px;
}
.divisoes-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 18px;
}
.voce-esta {
  font-size: 11.5px;
  color: var(--calado-2);
  font-style: italic;
}
.colunas {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.divisao {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
}
.pct {
  font-family: var(--mono);
  font-size: 9.5px;
}
.torre {
  width: 100%;
  border: 1px solid;
}
.brasao {
  width: 30px;
  height: 34px;
  flex: none;
}
.brasao span {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.02em;
}
.divisao-nome {
  font-family: var(--display);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-align: center;
}
.divisao-marca {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.12em;
  color: var(--ouro-claro);
  margin-top: -4px;
  min-height: 10px;
}

.duas {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 20px;
  margin-top: 20px;
  align-items: start;
}

.quadro {
  padding: 20px 0 8px;
}
.quadro-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 22px 14px;
  border-bottom: 1px solid rgba(90, 72, 48, 0.35);
}
.quadro-titulo {
  font-family: var(--display);
  font-size: 15px;
  letter-spacing: 0.08em;
}
.quadro-nota {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--carta-calado);
}
.linha {
  display: grid;
  grid-template-columns: 34px 1fr 96px 62px 54px;
  align-items: center;
  gap: 10px;
  padding: 9px 22px;
  border-bottom: 1px solid rgba(90, 72, 48, 0.16);
}
.pos {
  font-family: var(--display);
  font-size: 14px;
  font-weight: 600;
  color: var(--carta-calado);
}
.jogador {
  font-family: var(--display);
  font-size: 13.5px;
  color: var(--carta-tinta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.divisao-txt {
  font-size: 12px;
  font-style: italic;
  color: var(--carta-tinta-3);
}
.registro {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--carta-tinta-3);
}
.forma {
  font-family: var(--mono);
  font-size: 10.5px;
  text-align: right;
}

.lado {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.espaco {
  display: block;
  margin-bottom: 14px;
}
.espaco-curto {
  display: block;
  margin-bottom: 12px;
}
.mapa {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.mapa-nome {
  width: 112px;
  flex: none;
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fita {
  flex: 1;
  height: 9px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--linha);
}
.fita i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--ouro-fundo), var(--ouro));
}
.mapa-qtd {
  width: 34px;
  text-align: right;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--calado);
}

.cresce {
  flex: 1;
}
.dias {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 96px;
}
.dia {
  flex: 1;
  background: linear-gradient(180deg, var(--ouro), var(--ouro-fundo));
}
.dia:hover {
  background: var(--ouro-claro);
}
.dias-legenda {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--calado-3);
}
</style>
