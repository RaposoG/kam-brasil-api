<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import EmBreve from "../EmBreve.vue";
import { type RankedMe, NOME_DO_TIER, fetchSeason, rankedMe } from "../api";

// O catálogo da temporada vive na API (constante no código de lá) para mudar
// conteúdo sem assinar release do launcher. Aqui só renderizamos.
const season = ref<Awaited<ReturnType<typeof fetchSeason>>>(null);
const pronto = ref(false);

// O rank da temporada corrente. `null` = sem temporada aberta na API, sem
// rede, ou ninguém jogou ainda — os três casos têm o mesmo remédio na tela.
const eu = ref<RankedMe | null>(null);

onMounted(async () => {
  // Independente do catálogo: a trilha de recompensas não pode sumir porque a
  // rota do rank respondeu 503.
  rankedMe().then((m) => (eu.value = m)).catch(() => {});

  try {
    season.value = await fetchSeason();
  } catch {
    // Sem rede tratamos como "sem temporada": o EmBreve explica.
  } finally {
    pronto.value = true;
  }
});

const emColocacao = computed(() => !!eu.value && !eu.value.tier);

const tierDesde = computed(() => {
  const quando = eu.value?.tierDesde;
  return quando
    ? new Date(quando).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })
    : "";
});

const dataLonga = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

// Temporada sem data de fim é normal: o admin pode abrir a temporada e só
// depois decidir quando fecha. Sem guarda, `new Date(null)` vira a epoch e a
// tela anuncia "1 de janeiro" e "faltam 0 dias" — contagem regressiva mentirosa
// é pior do que contagem nenhuma.
const periodo = computed(() => {
  if (!season.value) return "";
  const inicio = dataLonga(season.value.startsAt);
  return season.value.endsAt ? `${inicio} a ${dataLonga(season.value.endsAt)}` : `desde ${inicio}`;
});

/** `null` = sem data de fim, e aí a contagem regressiva não aparece. */
const restam = computed(() => {
  const fim = season.value?.endsAt;
  if (!fim) return null;
  return Math.max(0, Math.ceil((new Date(fim).getTime() - Date.now()) / 86_400_000));
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela sozinho">
      <div v-if="season">
        <h1 class="titulo-tela">Temporada {{ season.number }} · {{ season.name }}</h1>
        <p class="sub-tela">{{ periodo }}<template v-if="restam !== null"> · faltam {{ restam }} dias</template></p>
      </div>
      <div v-else>
        <h1 class="titulo-tela">Temporada</h1>
        <p class="sub-tela">o ciclo de recompensas do reino</p>
      </div>
    </div>

    <template v-if="season">
      <div class="painel trilha-bloco">
        <div class="trilha-cabeca">
          <span class="rotulo">TRILHA DE RECOMPENSAS</span>
          <span class="nivel">EM PREPARAÇÃO</span>
        </div>
        <!-- Barra deliberadamente zerada: progresso exige estatística por
             jogador, que só existe depois da Fase 1b. Sem % fictício. -->
        <div class="linha" />
        <div class="marcos">
          <div v-for="r in season.rewards" :key="r.nivel" class="marco">
            <div class="losango"><span>{{ r.nivel }}</span></div>
            <div class="marco-texto">
              <div class="marco-nome">{{ r.nome }}</div>
              <div class="marco-estado">EM PREPARAÇÃO</div>
            </div>
          </div>
        </div>
      </div>

      <div class="painel bloco">
        <div class="trilha-cabeca">
          <span class="rotulo">SUA CAMPANHA RANQUEADA</span>
          <span class="nivel">{{ eu ? `${eu.partidas} PARTIDAS` : "—" }}</span>
        </div>

        <div v-if="eu" class="campanha">
          <div class="campanha-marca">
            <div class="campanha-valor">
              <template v-if="emColocacao">{{ eu.colocacao.feitas }}/{{ eu.colocacao.total }}</template>
              <template v-else>{{ NOME_DO_TIER[eu.tier!] }}</template>
            </div>
            <div class="campanha-label">
              <template v-if="emColocacao">PARTIDAS DE COLOCAÇÃO</template>
              <template v-else-if="tierDesde">NESTA DIVISÃO DESDE {{ tierDesde }}</template>
              <template v-else>SUA DIVISÃO</template>
            </div>
          </div>

          <div class="ultimos">
            <div class="rotulo">ÚLTIMOS RESULTADOS</div>
            <div class="fichas">
              <!-- V/D no lugar de barra de progresso: informação real, e sem
                   número que dê para engenharia reversa da pontuação. -->
              <span v-for="(r, i) in eu.ultimos10" :key="i" class="ficha" :class="r === 'V' ? 'v' : 'd'">
                {{ r }}
              </span>
              <span v-if="!eu.ultimos10.length" class="sem-fichas">
                nenhuma partida ranqueada nesta temporada ainda.
              </span>
            </div>
          </div>
        </div>

        <p v-else class="sem-fichas bloco-sem">
          O rank da temporada aparece aqui assim que você entrar na fila e a primeira partida for
          registrada.
        </p>
      </div>
    </template>

    <div v-else-if="pronto" class="bloco">
      <EmBreve
        titulo="Nenhuma temporada ativa"
        descricao="A API não anuncia temporada em andamento agora. Quando a próxima abrir, o nome, as datas e a trilha de recompensas aparecem aqui sozinhos — o catálogo vive no servidor, sem precisar de release nova do launcher."
      />
    </div>
  </div>
</template>

<style scoped>
.sozinho {
  display: block;
}
.bloco {
  margin-top: 20px;
}

.trilha-bloco {
  padding: 26px 28px;
  margin-top: 22px;
}

.campanha {
  display: flex;
  align-items: center;
  gap: 34px;
  margin-top: 16px;
}
.campanha-marca {
  flex: none;
}
.campanha-valor {
  font-family: var(--display);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ouro);
  line-height: 1.1;
}
.campanha-label {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.12em;
  color: var(--calado-3);
  margin-top: 3px;
}
.ultimos {
  min-width: 0;
}
.fichas {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
}
.ficha {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--linha);
  font-family: var(--mono);
  font-size: 10px;
}
.ficha.v {
  border-color: var(--verde-fundo);
  background: rgba(148, 185, 111, 0.1);
  color: var(--verde);
}
.ficha.d {
  border-color: var(--vermelho-fundo);
  background: rgba(208, 130, 114, 0.09);
  color: var(--vermelho);
}
.sem-fichas {
  font-size: 12.5px;
  font-style: italic;
  color: var(--calado-2);
  text-wrap: pretty;
}
.bloco-sem {
  margin: 14px 0 0;
}
.trilha-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 22px;
}
.nivel {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--calado-2);
}
/* A linha fica atrás dos losangos e as recompensas cavalgam sobre ela — daí a
   margem negativa no bloco de marcos. */
.linha {
  position: relative;
  height: 3px;
  background: var(--linha);
  margin: 0 22px;
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
  background: var(--madeira);
  border: 1px solid var(--bronze);
  transform: rotate(45deg);
  display: grid;
  place-items: center;
}
.losango span {
  font-family: var(--display);
  font-size: 13px;
  font-weight: 700;
  color: var(--ouro);
  transform: rotate(-45deg);
}
.marco-texto {
  text-align: center;
}
.marco-nome {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  color: var(--pergaminho);
  text-wrap: pretty;
}
.marco-estado {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
  margin-top: 3px;
}
</style>
