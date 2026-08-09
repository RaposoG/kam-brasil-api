<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { Account } from "../api";
import { type AbaPerfil, KPIS, MAPAS_PERFIL, PAINEIS, PATENTE } from "../mock";

const account = inject<Account>("account");
const aba = ref<AbaPerfil>("geral");
const painel = computed(() => PAINEIS[aba.value]);

const ABAS: { id: AbaPerfil; label: string }[] = [
  { id: "geral", label: "VISÃO GERAL" },
  { id: "economia", label: "ECONOMIA" },
  { id: "guerra", label: "GUERRA" },
];

const TRILHA = ["MILÍCIA I", "LANCEIRO III", "BESTEIRO II", "ESPADACHIM II"];
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div class="identidade">
        <div class="escudo grande"><span>II</span></div>
        <div>
          <h1 class="nome">{{ account?.nickname }}</h1>
          <p class="sub-tela">{{ PATENTE.titulo }} · na comunidade desde março de 2025</p>
          <div class="selos">
            <span class="selo">FUNDADOR</span>
            <span class="selo">TEMP. I–III</span>
            <span class="selo destaque">TOP 5%</span>
          </div>
        </div>
      </div>

      <div class="abas">
        <button
          v-for="a in ABAS"
          :key="a.id"
          class="btn-contorno"
          :class="{ ativo: aba === a.id }"
          @click="aba = a.id"
        >
          {{ a.label }}
        </button>
      </div>
    </div>

    <div class="kpis">
      <div v-for="k in KPIS" :key="k.label" class="kpi">
        <div class="kpi-valor">{{ k.valor }}</div>
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-delta">{{ k.delta }}</div>
      </div>
    </div>

    <div class="duas">
      <div class="carta progresso">
        <div class="carta-cabeca">
          <span class="carta-titulo">Progresso na temporada</span>
          <span class="carta-nota">ÚLTIMAS 30 PARTIDAS</span>
        </div>
        <svg viewBox="0 0 620 190" preserveAspectRatio="none" class="curva">
          <line x1="0" y1="47" x2="620" y2="47" stroke="rgba(90,72,48,.25)" stroke-width="1" />
          <line x1="0" y1="95" x2="620" y2="95" stroke="rgba(90,72,48,.25)" stroke-width="1" />
          <line x1="0" y1="143" x2="620" y2="143" stroke="rgba(90,72,48,.25)" stroke-width="1" />
          <polyline
            points="0,168 41,160 82,164 124,141 165,146 207,128 248,131 290,112 331,118 372,96 414,88 455,94 497,70 538,58 580,42 620,36"
            fill="none"
            stroke="#8f6a2e"
            stroke-width="2.5"
          />
          <circle cx="620" cy="36" r="4" fill="#3d6b2a" />
        </svg>
        <div class="trilha-legenda">
          <span v-for="t in TRILHA" :key="t">{{ t }}</span>
        </div>
      </div>

      <div class="painel">
        <div class="rotulo">DESEMPENHO POR MAPA</div>
        <div v-for="m in MAPAS_PERFIL" :key="m.nome" class="mapa">
          <div class="mapa-linha">
            <span>{{ m.nome }}</span>
            <span class="mapa-registro">{{ m.registro }}</span>
          </div>
          <div class="fita"><i :style="{ width: m.pct + '%' }" /></div>
        </div>
      </div>
    </div>

    <div class="tres">
      <div class="painel">
        <div class="rotulo espaco">{{ painel.tituloEco }}</div>
        <div v-for="r in painel.eco" :key="r.nome" class="recurso">
          <span class="recurso-nome">{{ r.nome }}</span>
          <div class="calha"><i :style="{ width: r.pct + '%' }" /></div>
          <span class="recurso-valor">{{ r.valor }}</span>
        </div>
      </div>

      <div class="painel">
        <div class="rotulo espaco">{{ painel.tituloExercito }}</div>
        <div class="colunas">
          <div v-for="e in painel.exe" :key="e.nome" class="coluna">
            <span class="coluna-valor">{{ e.valor }}</span>
            <div class="coluna-barra" :style="{ height: e.pct + '%' }" />
          </div>
        </div>
        <div class="colunas-legenda">
          <span v-for="e in painel.exe" :key="e.nome">{{ e.nome }}</span>
        </div>
        <div class="rodape-painel">
          <span>{{ painel.rodapeLabel }}</span>
          <span class="rodape-valor">{{ painel.rodapeValor }}</span>
        </div>
      </div>

      <div class="painel">
        <div class="rotulo espaco">{{ painel.tituloHabitos }}</div>
        <div v-for="h in painel.hab" :key="h.nome" class="habito">
          <div class="habito-linha">
            <span class="habito-nome">{{ h.nome }}</span>
            <span class="habito-valor">{{ h.valor }}</span>
          </div>
          <div class="habito-nota">{{ h.nota }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.identidade {
  display: flex;
  align-items: center;
  gap: 20px;
}
.grande {
  width: 76px;
  height: 86px;
  flex: none;
  background: linear-gradient(175deg, #4a3a28, var(--madeira));
  border-color: #8f6a2e;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
}
.grande span {
  font-family: var(--display);
  font-size: 26px;
  font-weight: 700;
  color: var(--ouro);
}
.nome {
  margin: 0;
  font-family: var(--display);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--pergaminho);
}
.selos {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.abas {
  display: flex;
  gap: 2px;
  flex: none;
}

/* Grade de KPI com gap de 1px sobre fundo de borda: as divisórias saem do
   próprio grid, sem borda em cada célula. */
.kpis {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1px;
  margin-top: 22px;
  background: var(--linha);
  border: 1px solid var(--linha);
}
.kpi {
  background: var(--painel);
  padding: 15px 16px;
}
.kpi-valor {
  font-family: var(--display);
  font-size: 25px;
  font-weight: 600;
  color: var(--pergaminho);
  line-height: 1;
}
.kpi-label {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.14em;
  color: var(--calado-3);
  margin-top: 7px;
}
.kpi-delta {
  font-size: 11px;
  color: var(--verde);
  margin-top: 4px;
}

.duas {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 20px;
  margin-top: 20px;
}
.progresso {
  padding: 20px 22px 16px;
}
.carta-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.carta-titulo {
  font-family: var(--display);
  font-size: 14px;
  letter-spacing: 0.08em;
}
.carta-nota {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--carta-calado);
}
.curva {
  width: 100%;
  height: 190px;
  margin-top: 14px;
  display: block;
}
.trilha-legenda {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--carta-calado);
  border-top: 1px solid rgba(90, 72, 48, 0.3);
  padding-top: 8px;
}

.mapa {
  margin-top: 14px;
}
.mapa-linha {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--pergaminho);
  margin-bottom: 5px;
}
.mapa-registro {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--calado);
}
.fita {
  height: 6px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--linha);
}
.fita i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--ouro-medio), var(--ouro-claro));
}

.tres {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-top: 20px;
}
.espaco {
  display: block;
  margin-bottom: 14px;
}
.recurso {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
}
.recurso-nome {
  width: 74px;
  flex: none;
  font-size: 12px;
  color: var(--calado);
}
.calha {
  flex: 1;
  height: 14px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--linha);
}
/* Listrado, não sólido: lembra a barra de estoque do KaM. */
.calha i {
  display: block;
  height: 100%;
  background: repeating-linear-gradient(90deg, var(--ouro-medio) 0 6px, var(--ouro-fundo) 6px 8px);
}
.recurso-valor {
  width: 42px;
  text-align: right;
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
}

.colunas {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 104px;
  border-bottom: 1px solid var(--linha);
  padding-bottom: 2px;
}
.coluna {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 5px;
  height: 100%;
}
.coluna-valor {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--calado);
}
.coluna-barra {
  width: 100%;
  background: linear-gradient(180deg, var(--ouro), var(--ouro-fundo));
}
.colunas-legenda {
  display: flex;
  gap: 6px;
  margin-top: 7px;
}
.colunas-legenda span {
  flex: 1;
  text-align: center;
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.04em;
  color: var(--calado-3);
}
.rodape-painel {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--linha-fraca);
  font-size: 12px;
  color: var(--calado);
}
.rodape-valor {
  font-family: var(--display);
  font-size: 14px;
  color: var(--pergaminho);
}

.habito {
  padding: 11px 0;
  border-bottom: 1px solid var(--linha-fraca);
}
.habito:last-child {
  border-bottom: none;
}
.habito-linha {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.habito-nome {
  font-size: 12.5px;
  color: var(--pergaminho);
}
.habito-valor {
  font-family: var(--display);
  font-size: 15px;
  color: var(--ouro);
}
.habito-nota {
  font-size: 11.5px;
  color: var(--calado-2);
  font-style: italic;
}
</style>
