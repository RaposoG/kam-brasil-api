<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import EmBreve from "../EmBreve.vue";
import { fetchSeason } from "../api";

// O catálogo da temporada vive na API (constante no código de lá) para mudar
// conteúdo sem assinar release do launcher. Aqui só renderizamos.
const season = ref<Awaited<ReturnType<typeof fetchSeason>>>(null);
const pronto = ref(false);

onMounted(async () => {
  try {
    season.value = await fetchSeason();
  } catch {
    // Sem rede tratamos como "sem temporada": o EmBreve explica.
  } finally {
    pronto.value = true;
  }
});

const dataLonga = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });

const periodo = computed(() =>
  season.value ? `${dataLonga(season.value.startsAt)} a ${dataLonga(season.value.endsAt)}` : "",
);

const restam = computed(() => {
  if (!season.value) return 0;
  return Math.max(0, Math.ceil((new Date(season.value.endsAt).getTime() - Date.now()) / 86_400_000));
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela sozinho">
      <div v-if="season">
        <h1 class="titulo-tela">Temporada {{ season.number }} · {{ season.name }}</h1>
        <p class="sub-tela">{{ periodo }} · faltam {{ restam }} dias</p>
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

      <div class="bloco">
        <EmBreve
          titulo="Missões da semana"
          descricao="As missões dependem de progresso por jogador — e progresso depende de o servidor reportar o resultado das partidas (Fase 1b). A trilha acima já é o catálogo real da temporada; as missões chegam junto com a contagem."
        />
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
