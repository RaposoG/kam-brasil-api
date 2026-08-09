<script setup lang="ts">
import { computed, ref } from "vue";
import { listaPartidas, montarRelatorio } from "../mock";

const partida = ref("m1");
const jogA = ref(0);
const jogB = ref(0);
const metrica = ref("recursos");
const filtro = ref("todas");

const FILTROS = [
  { id: "todas", label: "TODAS" },
  { id: "1v1", label: "1V1" },
  { id: "2v2", label: "2V2" },
  // O design pedia FFA; nenhuma partida do histórico é FFA, e um filtro que
  // sempre volta vazio é um botão morto. Equipes cobre 3v3 e 4v4.
  { id: "equipes", label: "EQUIPES" },
];

const todas = listaPartidas();

const lista = computed(() =>
  todas.filter((p) => {
    if (filtro.value === "todas") return true;
    if (filtro.value === "equipes") return !["1v1", "2v2"].includes(p.detalhe.split(" · ")[0]);
    return p.detalhe.startsWith(filtro.value);
  }),
);

const rel = computed(() => montarRelatorio(partida.value, jogA.value, jogB.value, metrica.value));

function abrir(id: string) {
  partida.value = id;
  jogA.value = 0;
  jogB.value = 0;
}

function alternar(id: string) {
  metrica.value = metrica.value === id ? "" : id;
}
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Crônica de batalhas</h1>
        <p class="sub-tela">184 partidas registradas · 61% de vitórias</p>
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

    <div class="duas">
      <div class="lista">
        <button
          v-for="p in lista"
          :key="p.id"
          class="item"
          :class="{ atual: p.id === partida }"
          @click="abrir(p.id)"
        >
          <div class="risca" :style="{ background: p.cor }" />
          <div class="item-corpo">
            <div class="item-topo">
              <span class="item-res" :style="{ color: p.cor }">{{ p.resultado }}</span>
              <span class="item-quando">{{ p.quando }}</span>
            </div>
            <div class="item-mapa">{{ p.mapa }}</div>
            <div class="item-det">{{ p.detalhe }}</div>
          </div>
        </button>
        <p v-if="!lista.length" class="vazio">Nenhuma partida neste filtro.</p>
      </div>

      <div class="carta relatorio">
        <div class="rel-cabeca">
          <div class="rel-quem">
            <div class="rel-titulo" :style="{ color: rel.partidaCor }">{{ rel.partidaTitulo }}</div>
            <div class="rel-sub">{{ rel.partidaSub }} · {{ rel.partidaPts }}</div>
          </div>
          <div class="rel-acoes">
            <button class="btn-carta">BAIXAR REPLAY</button>
            <button class="btn-carta assistir">ASSISTIR</button>
          </div>
        </div>

        <div class="rel-corpo">
          <div class="escala-cabeca">
            <span>ESCALAÇÃO · CLIQUE PARA ESCOLHER QUEM COMPARAR</span>
            <span class="flex-none">VALORES EM {{ rel.metricaAberta }}</span>
          </div>

          <div class="rosters">
            <div>
              <div class="roster-rotulo">{{ rel.rotuloEquipeMeu }}</div>
              <button
                v-for="j in rel.rosterMeu"
                :key="j.nome"
                class="ficha"
                :style="{ background: j.bg, borderColor: j.borda }"
                @click="jogA = j.indice"
              >
                <div class="escudo tier" :style="{ borderColor: j.corTier }">
                  <span :style="{ color: j.corTier }">{{ j.ordem }}</span>
                </div>
                <div class="ficha-corpo">
                  <div class="ficha-topo">
                    <span class="ficha-nome" :style="{ color: j.cor }">{{ j.nome }}</span>
                    <span class="ficha-marca">{{ j.marca }}</span>
                  </div>
                  <div class="ficha-rank" :style="{ color: j.corTier }">{{ j.rank }}</div>
                  <div class="ficha-destaque">{{ j.destaque }}</div>
                </div>
              </button>
            </div>

            <div>
              <div class="roster-rotulo direita">{{ rel.rotuloEquipeSeu }}</div>
              <button
                v-for="j in rel.rosterSeu"
                :key="j.nome"
                class="ficha"
                :style="{ background: j.bg, borderColor: j.borda }"
                @click="jogB = j.indice"
              >
                <div class="ficha-corpo direita">
                  <div class="ficha-topo fim">
                    <span class="ficha-marca inimigo">{{ j.marca }}</span>
                    <span class="ficha-nome" :style="{ color: j.cor }">{{ j.nome }}</span>
                  </div>
                  <div class="ficha-rank" :style="{ color: j.corTier }">{{ j.rank }}</div>
                  <div class="ficha-destaque">{{ j.destaque }}</div>
                </div>
                <div class="escudo tier" :style="{ borderColor: j.corTier }">
                  <span :style="{ color: j.corTier }">{{ j.ordem }}</span>
                </div>
              </button>
            </div>
          </div>

          <div class="lados">
            <span>{{ rel.ladoEsq }}</span>
            <span class="direita">{{ rel.ladoDir }}</span>
          </div>

          <div v-for="c in rel.comparativo" :key="c.id" class="metrica">
            <button class="metrica-linha" @click="alternar(c.id)">
              <span class="v-esq">{{ c.voce }}</span>
              <div class="calha esq"><i :style="{ width: c.pctVoce + '%' }" /></div>
              <span class="metrica-rotulo" :style="{ color: c.corLabel }">{{ c.rotulo }}</span>
              <div class="calha dir"><i class="foe" :style="{ width: c.pctFoe + '%' }" /></div>
              <span class="v-dir">{{ c.foe }}</span>
            </button>

            <div v-if="c.aberto" class="detalhe">
              <div class="detalhe-cabeca">
                <span>{{ c.tituloDetalhe }}</span><span>{{ c.notaDetalhe }}</span>
              </div>

              <div v-if="c.temTime" class="por-jogador">
                <div class="detalhe-rotulo">TODOS OS JOGADORES, INDIVIDUALMENTE</div>
                <div v-for="j in c.todosJogadores" :key="j.nome" class="jogador-linha">
                  <span class="j-pos">{{ j.pos }}</span>
                  <span class="j-nome" :style="{ color: j.cor }">{{ j.nome }}</span>
                  <span class="j-marca">{{ j.marca }}</span>
                  <div class="j-calha"><i :style="{ width: j.pct + '%', background: j.barra }" /></div>
                  <span class="j-valor" :style="{ color: j.cor }">{{ j.valor }}</span>
                  <span class="j-lado">{{ j.lado }}</span>
                </div>
              </div>
              <div v-if="c.temTime" class="detalhe-rotulo">POR TIPO · SOMENTE OS DOIS SELECIONADOS</div>

              <div v-for="d in c.detalhes" :key="d.nome" class="tipo-linha">
                <span class="t-esq">{{ d.voce }}</span>
                <div class="t-calha esq"><i :style="{ width: d.pctVoce + '%' }" /></div>
                <span class="t-nome">{{ d.nome }}</span>
                <div class="t-calha dir"><i class="foe" :style="{ width: d.pctFoe + '%' }" /></div>
                <span class="t-dir">{{ d.foe }}</span>
              </div>
            </div>
          </div>

          <div class="secao">
            <div class="secao-cabeca">
              <span class="secao-titulo">População e exército no tempo</span>
              <span class="secao-legenda">
                — {{ rel.rotuloEquipeMeu }} · ┄ {{ rel.rotuloEquipeSeu }} · ─ PERDAS
              </span>
            </div>
            <svg viewBox="0 0 640 172" preserveAspectRatio="none" class="grafico">
              <line x1="0" y1="43" x2="640" y2="43" stroke="rgba(90,72,48,.2)" />
              <line x1="0" y1="86" x2="640" y2="86" stroke="rgba(90,72,48,.2)" />
              <line x1="0" y1="129" x2="640" y2="129" stroke="rgba(90,72,48,.2)" />
              <polyline :points="rel.curvaMinha" fill="none" stroke="#8f6a2e" stroke-width="2.5" />
              <polyline :points="rel.curvaDele" fill="none" stroke="#6f5c43" stroke-width="2" stroke-dasharray="5 4" />
              <polyline :points="rel.curvaPerdas" fill="none" stroke="#a8442f" stroke-width="1.8" />
            </svg>
            <div class="eixo">
              <span v-for="(t, i) in rel.eixoTempo" :key="i">{{ t }}</span>
            </div>
          </div>

          <div class="secao mapa-timeline">
            <div>
              <div class="secao-rotulo">MINIMAPA</div>
              <div class="minimapa">
                <div
                  v-for="m in rel.marcadores"
                  :key="m.nome"
                  class="marcador"
                  :style="{ left: m.esq, top: m.topo }"
                >
                  <div class="ponto" :style="{ background: m.cor }" />
                  <span class="marcador-nome">{{ m.nome }}</span>
                </div>
                <span class="minimapa-nota">[ minimapa ]</span>
              </div>
            </div>
            <div class="min-zero">
              <div class="secao-rotulo">TIMELINE</div>
              <div v-for="(t, i) in rel.timeline" :key="i" class="evento">
                <span class="evento-tempo">{{ t.tempo }}</span>
                <span class="evento-texto">{{ t.evento }}</span>
              </div>
            </div>
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
.duas {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: 18px;
  margin-top: 20px;
  align-items: start;
}

.lista {
  background: var(--painel);
  border: 1px solid var(--linha);
}
.item {
  width: 100%;
  display: flex;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--linha-fraca);
  text-align: left;
}
.item:hover {
  background: rgba(212, 162, 74, 0.06);
}
.item.atual {
  background: rgba(212, 162, 74, 0.1);
}
.risca {
  width: 3px;
  flex: none;
}
.item-corpo {
  min-width: 0;
  flex: 1;
}
.item-topo {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.item-res {
  font-family: var(--display);
  font-size: 12.5px;
  letter-spacing: 0.1em;
}
.item-quando {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-3);
}
.item-mapa {
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-det {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-2);
  margin-top: 2px;
}
.vazio {
  padding: 18px 16px;
  margin: 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
}

/* --- relatório --- */
.relatorio {
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
}
.rel-cabeca {
  padding: 18px 22px 15px;
  border-bottom: 1px solid rgba(90, 72, 48, 0.35);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 20px;
}
.rel-quem {
  min-width: 0;
}
.rel-titulo {
  font-family: var(--display);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-wrap: pretty;
}
.rel-sub {
  font-size: 13px;
  color: var(--carta-tinta-3);
  font-style: italic;
  margin-top: 2px;
}
.rel-acoes {
  display: flex;
  gap: 8px;
}
.btn-carta {
  padding: 7px 14px;
  font-size: 10.5px;
}
.assistir {
  background: rgba(61, 107, 42, 0.12);
}
.assistir:hover {
  background: rgba(61, 107, 42, 0.22);
}
.rel-corpo {
  padding: 18px 22px 20px;
}

.escala-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.18em;
  color: var(--carta-borda);
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(90, 72, 48, 0.28);
  margin-bottom: 9px;
}
.flex-none {
  flex: none;
}

.rosters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  margin-bottom: 6px;
}
.roster-rotulo {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.18em;
  color: var(--carta-borda);
  margin-bottom: 7px;
}
.direita {
  text-align: right;
}
.ficha {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  margin-bottom: 5px;
  border: 1px solid;
  text-align: left;
}
.ficha:hover {
  background: rgba(90, 72, 48, 0.1) !important;
}
.tier {
  width: 24px;
  height: 28px;
  flex: none;
  background: rgba(90, 72, 48, 0.14);
}
.tier span {
  font-family: var(--mono);
  font-size: 9px;
}
.ficha-corpo {
  min-width: 0;
  flex: 1;
}
.ficha-topo {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.ficha-topo.fim {
  justify-content: flex-end;
}
.ficha-nome {
  min-width: 0;
  font-family: var(--display);
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ficha-marca {
  flex: none;
  font-family: var(--mono);
  font-size: 7.5px;
  letter-spacing: 0.12em;
  color: var(--ouro-fundo);
}
.ficha-marca.inimigo {
  color: var(--vermelho-fundo);
}
.ficha-rank,
.ficha-destaque {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ficha-rank {
  font-size: 11px;
  font-style: italic;
}
.ficha-destaque {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--carta-calado);
}

.lados {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--carta-calado);
  margin: 14px 0 11px;
  padding-top: 11px;
  border-top: 1px solid rgba(90, 72, 48, 0.28);
}
.lados span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Barras espelhadas a partir do centro: a comparação se lê sem legenda. */
.metrica {
  margin-bottom: 9px;
}
.metrica-linha {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 5px;
  margin: 0 -5px;
}
.metrica-linha:hover {
  background: rgba(90, 72, 48, 0.1);
}
.v-esq,
.v-dir {
  width: 44px;
  flex: none;
  font-family: var(--display);
  font-size: 13.5px;
  font-weight: 600;
}
.v-esq {
  text-align: right;
}
.calha {
  flex: 1;
  min-width: 60px;
  display: flex;
  height: 11px;
  background: rgba(90, 72, 48, 0.13);
}
.calha.esq {
  justify-content: flex-end;
}
.calha i {
  display: block;
  height: 100%;
  background: var(--ouro-fundo);
}
.calha i.foe {
  background: var(--carta-calado);
}
.metrica-rotulo {
  width: 92px;
  flex: none;
  text-align: center;
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.08em;
  border-bottom: 1px dotted rgba(90, 72, 48, 0.45);
  padding-bottom: 2px;
}

.detalhe {
  margin: 9px 0 15px;
  padding: 12px 14px 10px;
  background: rgba(90, 72, 48, 0.08);
  border-left: 2px solid var(--ouro-fundo);
}
.detalhe-cabeca {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.16em;
  color: var(--carta-borda);
  margin-bottom: 9px;
}
.detalhe-rotulo {
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.16em;
  color: var(--carta-borda);
  margin-bottom: 8px;
}
.por-jogador {
  padding-bottom: 11px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(90, 72, 48, 0.2);
}
.jogador-linha {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 3px 0;
}
.j-pos {
  width: 20px;
  flex: none;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--carta-borda);
}
.j-nome {
  width: 108px;
  flex: none;
  font-family: var(--display);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.j-marca {
  width: 9px;
  flex: none;
  font-size: 8px;
  color: var(--ouro-fundo);
}
.j-calha {
  flex: 1;
  min-width: 40px;
  height: 7px;
  background: rgba(90, 72, 48, 0.12);
}
.j-calha i {
  display: block;
  height: 100%;
}
.j-valor {
  width: 44px;
  flex: none;
  text-align: right;
  font-family: var(--mono);
  font-size: 10.5px;
}
.j-lado {
  width: 66px;
  flex: none;
  font-family: var(--mono);
  font-size: 8px;
  letter-spacing: 0.1em;
  color: var(--carta-borda);
}

.tipo-linha {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2.5px 0;
}
.t-esq,
.t-dir {
  width: 44px;
  flex: none;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--carta-tinta-2);
}
.t-esq {
  text-align: right;
}
.t-calha {
  flex: 1;
  min-width: 40px;
  display: flex;
  height: 6px;
  background: rgba(90, 72, 48, 0.12);
}
.t-calha.esq {
  justify-content: flex-end;
}
.t-calha i {
  display: block;
  height: 100%;
  background: #a8823c;
}
.t-calha i.foe {
  background: #7d6a50;
}
.t-nome {
  width: 92px;
  flex: none;
  text-align: center;
  font-size: 11px;
  color: var(--carta-tinta-3);
}

.secao {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(90, 72, 48, 0.3);
}
.secao-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.secao-titulo {
  font-family: var(--display);
  font-size: 13.5px;
  letter-spacing: 0.06em;
}
.secao-legenda {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--carta-calado);
}
.grafico {
  width: 100%;
  height: 172px;
  display: block;
}
.eixo {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--carta-calado);
  border-top: 1px solid rgba(90, 72, 48, 0.3);
  padding-top: 7px;
}

.mapa-timeline {
  display: grid;
  grid-template-columns: 186px minmax(0, 1fr);
  gap: 20px;
}
.secao-rotulo {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--carta-calado);
  margin-bottom: 8px;
}
.minimapa {
  position: relative;
  aspect-ratio: 1;
  background: repeating-linear-gradient(45deg, rgba(90, 72, 48, 0.14) 0 3px, transparent 3px 10px);
  border: 1px solid rgba(90, 72, 48, 0.4);
}
.marcador {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.ponto {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(90, 72, 48, 0.18);
}
.marcador-nome {
  font-family: var(--mono);
  font-size: 7.5px;
  color: var(--carta-tinta-3);
  white-space: nowrap;
}
.minimapa-nota {
  position: absolute;
  bottom: 5px;
  left: 7px;
  font-family: var(--mono);
  font-size: 7.5px;
  color: rgba(74, 60, 44, 0.65);
}
.min-zero {
  min-width: 0;
}
.evento {
  display: flex;
  gap: 9px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(90, 72, 48, 0.16);
}
.evento-tempo {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--carta-calado);
  flex: none;
}
.evento-texto {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--carta-tinta-2);
  text-wrap: pretty;
}
</style>
