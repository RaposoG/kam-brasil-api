<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import EmBreve from "../EmBreve.vue";
import { fetchStats } from "../api";

// Inferimos o tipo da própria função em vez de importar o nome do tipo:
// menos um acoplamento para quebrar se o contrato ganhar campos novos.
const stats = ref<Awaited<ReturnType<typeof fetchStats>> | null>(null);

onMounted(async () => {
  try {
    stats.value = await fetchStats();
  } catch {
    // Sem rede o cabeçalho fica nos traços — a tela continua de pé.
  }
});

// Milhar com espaço, não ponto: é como o design sempre exibiu números grandes.
const num = (n: number) => n.toLocaleString("pt-BR").replace(/\./g, " ");

const globais = computed(() => {
  const s = stats.value;
  return [
    { valor: s ? num(s.onlinePlayers) : "—", label: "ONLINE AGORA" },
    { valor: s ? num(s.matchesToday) : "—", label: "PARTIDAS HOJE" },
    { valor: s ? num(s.openServers) : "—", label: "SERVIDORES" },
    { valor: s ? num(s.accountsTotal) : "—", label: "CONTAS" },
  ];
});

const mapasTop = computed(() => {
  const top = stats.value?.topMaps ?? [];
  const maior = Math.max(...top.map((m) => m.count), 1);
  return top.map((m) => ({
    nome: m.map,
    qtd: num(m.count),
    pct: Math.round((m.count / maior) * 100),
  }));
});

const porDia = computed(() => {
  const dias = stats.value?.matchesPerDay ?? [];
  const maior = Math.max(...dias.map((d) => d.count), 1);
  return dias.map((d) => ({ pct: Math.round((d.count / maior) * 100) }));
});

const MESES = "JAN FEV MAR ABR MAI JUN JUL AGO SET OUT NOV DEZ".split(" ");
const diaCurto = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
};

const legendaInicio = computed(() => {
  const primeiro = stats.value?.matchesPerDay[0];
  return primeiro ? diaCurto(primeiro.day) : "";
});

const media = computed(() => {
  const dias = stats.value?.matchesPerDay ?? [];
  if (!dias.length) return "";
  const total = dias.reduce((a, d) => a + d.count, 0);
  return `média ${num(Math.round(total / dias.length))}/dia`;
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Ordem do Reino</h1>
        <p class="sub-tela">os números do reino, direto do master server</p>
      </div>
      <div class="globais">
        <div v-for="g in globais" :key="g.label" class="global">
          <div class="global-valor">{{ g.valor }}</div>
          <div class="global-label">{{ g.label }}</div>
        </div>
      </div>
    </div>

    <div class="bloco">
      <EmBreve
        titulo="As oito divisões"
        descricao="A distribuição da comunidade por divisão depende de o servidor dedicado reportar o resultado das partidas — hoje só o início chega ao master server. É a Fase 1b: quando o fim de jogo for reportado, cada vitória e derrota vira elo, e o elo vira divisão."
      />
    </div>

    <div class="duas">
      <EmBreve
        titulo="Os mais ilustres"
        descricao="O quadro de honra precisa de histórico de vitórias por jogador, e nenhum resultado de partida chega à API ainda. Assim que o servidor reportar o fim das partidas (Fase 1b), o leaderboard nasce aqui — de verdade, sem nomes inventados."
      />

      <div class="lado">
        <div class="painel">
          <div class="rotulo espaco">MAPAS MAIS JOGADOS</div>
          <div v-for="m in mapasTop" :key="m.nome" class="mapa">
            <span class="mapa-nome">{{ m.nome }}</span>
            <div class="fita"><i :style="{ width: m.pct + '%' }" /></div>
            <span class="mapa-qtd">{{ m.qtd }}</span>
          </div>
          <p v-if="stats && !mapasTop.length" class="vazio">Nenhuma partida reportada ainda.</p>
        </div>

        <div class="painel cresce">
          <div class="rotulo espaco-curto">PARTIDAS POR DIA · 14 DIAS</div>
          <div class="dias">
            <div v-for="(b, i) in porDia" :key="i" class="dia" :style="{ height: b.pct + '%' }" />
          </div>
          <div class="dias-legenda">
            <span>{{ legendaInicio }}</span><span>{{ media }}</span><span>HOJE</span>
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

.bloco {
  margin-top: 22px;
}

.duas {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 20px;
  margin-top: 20px;
  align-items: start;
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
.vazio {
  margin: 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
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
