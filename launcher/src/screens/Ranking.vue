<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  type LeaderboardRow,
  type RankedMe,
  NOME_DO_TIER,
  TIERS,
  fetchStats,
  rankedLeaderboard,
  rankedMe,
} from "../api";

// Inferimos o tipo da própria função em vez de importar o nome do tipo:
// menos um acoplamento para quebrar se o contrato ganhar campos novos.
const stats = ref<Awaited<ReturnType<typeof fetchStats>> | null>(null);
const eu = ref<RankedMe | null>(null);
const apex = ref<LeaderboardRow[]>([]);
// Sem temporada aberta a API responde 503 nas duas rotas — não é erro de rede,
// e a tela precisa dizer isso em vez de ficar em branco.
const semTemporada = ref(false);

onMounted(() => {
  // Buscas independentes: as divisões não podem sumir porque o overview caiu.
  fetchStats().then((s) => (stats.value = s)).catch(() => {});
  rankedMe()
    .then((m) => (eu.value = m))
    .catch(() => (semTemporada.value = true));
  rankedLeaderboard().then((l) => (apex.value = l)).catch(() => {});
});

/**
 * As divisões, da base ao apex. O jogador vê o NOME e nada mais: pontuação,
 * faixa e distância para a próxima são vazamento disfarçado — quem sabe o
 * número tenta manipulá-lo.
 */
const divisoes = computed(() =>
  TIERS.map((t) => ({
    tier: t,
    nome: NOME_DO_TIER[t],
    minha: eu.value?.tier === t,
    apex: t === "comandante",
  })),
);

const emColocacao = computed(() => !!eu.value && !eu.value.tier);

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

    <div class="painel bloco">
      <div class="bloco-cabeca">
        <span class="rotulo">AS DIVISÕES DO REINO</span>
        <span class="minha-nota">
          <template v-if="semTemporada">nenhuma temporada aberta</template>
          <template v-else-if="emColocacao">
            COLOCAÇÃO {{ eu?.colocacao.feitas }}/{{ eu?.colocacao.total }}
          </template>
          <template v-else-if="eu?.tier">SUA DIVISÃO · {{ NOME_DO_TIER[eu.tier] }}</template>
          <template v-else>—</template>
        </span>
      </div>

      <div class="divisoes">
        <div v-for="d in divisoes" :key="d.tier" class="divisao" :class="{ minha: d.minha, apex: d.apex }">
          <div class="escudo insignia"><span>{{ d.nome.charAt(0) }}</span></div>
          <div class="divisao-nome">{{ d.nome }}</div>
          <div class="divisao-nota">{{ d.apex ? "top 5 da temporada" : d.minha ? "você está aqui" : "" }}</div>
        </div>
      </div>

      <p class="rodape-divisoes">
        A divisão sobe e desce com o resultado das partidas ranqueadas. A pontuação por trás dela não é
        exibida — nem para você.
      </p>
    </div>

    <div class="duas">
      <div class="painel">
        <div class="bloco-cabeca">
          <span class="rotulo">OS MAIS ILUSTRES</span>
          <span class="minha-nota">COMANDANTES DO REI</span>
        </div>
        <div v-for="linha in apex" :key="linha.posicao" class="ilustre">
          <span class="posicao">{{ linha.posicao }}</span>
          <span class="ilustre-nome">{{ linha.nickname }}</span>
          <span class="ilustre-tier">{{ NOME_DO_TIER[linha.tier] }}</span>
        </div>
        <p v-if="!apex.length" class="vazio">
          {{
            semTemporada
              ? "Nenhuma temporada aberta — o quadro de honra volta com a próxima."
              : "Ainda não há Comandantes: a vaga exige 20 partidas ranqueadas na temporada."
          }}
        </p>
      </div>

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
.bloco-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.minha-nota {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--ouro-medio);
}

/* Sete colunas de largura igual: a fila de insígnias é uma régua, e uma
   divisão mais larga que a outra sugeriria hierarquia onde não há. */
.divisoes {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 10px;
}
.divisao {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 14px 8px;
  border: 1px solid transparent;
  text-align: center;
}
.divisao.minha {
  border-color: var(--bronze);
  background: rgba(212, 162, 74, 0.08);
}
.insignia {
  width: 34px;
  height: 38px;
}
.insignia span {
  font-family: var(--display);
  font-size: 13px;
  font-weight: 700;
  color: var(--calado);
}
.divisao.minha .insignia span,
.divisao.apex .insignia span {
  color: var(--ouro);
}
.divisao-nome {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: 0.05em;
  color: var(--tenue);
  text-wrap: pretty;
}
.divisao.minha .divisao-nome {
  color: var(--pergaminho);
}
.divisao-nota {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
  min-height: 11px;
}
.rodape-divisoes {
  margin: 16px 0 0;
  font-size: 12px;
  font-style: italic;
  color: var(--calado-2);
  text-wrap: pretty;
}

.ilustre {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--linha-tenue);
}
.ilustre:last-of-type {
  border-bottom: none;
}
.posicao {
  width: 20px;
  flex: none;
  font-family: var(--display);
  font-size: 15px;
  font-weight: 700;
  color: var(--ouro);
}
.ilustre-nome {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ilustre-tier {
  flex: none;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--ouro-medio);
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
