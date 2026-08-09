<script setup lang="ts">
import { MISSOES, RECOMPENSAS, TEMPORADAS } from "../mock";
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela sozinho">
      <div>
        <h1 class="titulo-tela">Temporada III · O Cerco de Inverno</h1>
        <p class="sub-tela">1º de junho a 31 de agosto · faltam 22 dias</p>
      </div>
    </div>

    <div class="painel trilha-bloco">
      <div class="trilha-cabeca">
        <span class="rotulo">TRILHA DE RECOMPENSAS</span>
        <span class="nivel">nível 12 · 68%</span>
      </div>
      <div class="linha">
        <div class="preenchido" />
      </div>
      <div class="marcos">
        <div v-for="r in RECOMPENSAS" :key="r.nivel" class="marco">
          <div class="losango" :style="{ background: r.fundo, borderColor: r.borda }">
            <span :style="{ color: r.cor }">{{ r.nivel }}</span>
          </div>
          <div class="marco-texto">
            <div class="marco-nome" :style="{ color: r.cor }">{{ r.nome }}</div>
            <div class="marco-estado">{{ r.estado }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="duas">
      <div class="carta missoes">
        <div class="missoes-titulo">Missões da semana</div>
        <div class="missoes-nota">renovam domingo às 21h</div>
        <div v-for="m in MISSOES" :key="m.nome" class="missao">
          <div class="missao-linha">
            <span>{{ m.nome }}</span>
            <span class="missao-prog">{{ m.progresso }}</span>
          </div>
          <div class="missao-barra"><i :style="{ width: m.pct + '%' }" /></div>
        </div>
      </div>

      <div class="painel">
        <div class="rotulo espaco">HISTÓRICO DE TEMPORADAS</div>
        <div v-for="t in TEMPORADAS" :key="t.nome" class="temporada">
          <div>
            <div class="temp-nome">{{ t.nome }}</div>
            <div class="temp-periodo">{{ t.periodo }}</div>
          </div>
          <div class="temp-fim">
            <div class="temp-divisao">{{ t.divisao }}</div>
            <div class="temp-posicao">{{ t.posicao }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sozinho {
  display: block;
}

.trilha-bloco {
  padding: 26px 28px;
  margin-top: 22px;
}
.trilha-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 22px;
}
.nivel {
  font-family: var(--display);
  font-size: 14px;
  color: var(--ouro);
}
/* A linha fica atrás dos losangos e as recompensas cavalgam sobre ela — daí a
   margem negativa no bloco de marcos. */
.linha {
  position: relative;
  height: 3px;
  background: var(--linha);
  margin: 0 22px;
}
.preenchido {
  position: absolute;
  inset: 0 auto 0 0;
  width: 62%;
  background: linear-gradient(90deg, var(--ouro-fundo), var(--ouro-claro));
}
.marcos {
  display: flex;
  justify-content: space-between;
  margin-top: -24px;
}
.marco {
  width: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
}
.losango {
  width: 44px;
  height: 44px;
  border: 1px solid;
  transform: rotate(45deg);
  display: grid;
  place-items: center;
}
.losango span {
  font-family: var(--display);
  font-size: 13px;
  font-weight: 700;
  transform: rotate(-45deg);
}
.marco-texto {
  text-align: center;
}
.marco-nome {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  text-wrap: pretty;
}
.marco-estado {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
  margin-top: 3px;
}

.duas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 20px;
  align-items: start;
}
.missoes {
  padding: 20px 22px;
}
.missoes-titulo {
  font-family: var(--display);
  font-size: 15px;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.missoes-nota {
  font-size: 12px;
  color: var(--carta-calado);
  font-style: italic;
  margin-bottom: 14px;
}
.missao {
  padding: 11px 0;
  border-top: 1px solid rgba(90, 72, 48, 0.25);
}
.missao-linha {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
}
.missao-prog {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--carta-calado);
}
.missao-barra {
  height: 5px;
  background: rgba(90, 72, 48, 0.16);
  margin-top: 7px;
}
.missao-barra i {
  display: block;
  height: 100%;
  background: var(--ouro-fundo);
}

.espaco {
  display: block;
  margin-bottom: 14px;
}
.temporada {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 0;
  border-bottom: 1px solid var(--linha-fraca);
}
.temporada:last-child {
  border-bottom: none;
}
.temp-nome {
  font-family: var(--display);
  font-size: 13.5px;
  color: var(--pergaminho);
}
.temp-periodo {
  font-size: 11.5px;
  color: var(--calado-2);
  font-style: italic;
}
.temp-fim {
  text-align: right;
}
.temp-divisao {
  font-family: var(--display);
  font-size: 13px;
  color: var(--ouro);
}
.temp-posicao {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-3);
}
</style>
