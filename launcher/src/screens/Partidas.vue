<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import EmBreve from "../EmBreve.vue";
import { fetchStats } from "../api";

// O feed vem do mesmo overview do Ranking: o master server só sabe do início
// das partidas (maps.php), então mapa + jogadores + quando é tudo que existe.
const stats = ref<Awaited<ReturnType<typeof fetchStats>> | null>(null);

onMounted(async () => {
  try {
    stats.value = await fetchStats();
  } catch {
    // Sem rede a lista fica vazia — o estado vazio já explica o resto.
  }
});

const quando = (iso: string) => {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
};

const partidas = computed(() =>
  (stats.value?.recentMatches ?? []).map((m) => ({
    mapa: m.map,
    jogadores: m.playerCount === 1 ? "1 jogador" : `${m.playerCount} jogadores`,
    quando: quando(m.reportedAt),
  })),
);
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela sozinho">
      <div>
        <h1 class="titulo-tela">Crônica de batalhas</h1>
        <p class="sub-tela">partidas da comunidade, reportadas pelos lobbies ao master server</p>
      </div>
    </div>

    <div class="duas">
      <div class="lista">
        <div class="lista-rotulo rotulo">ÚLTIMAS PARTIDAS</div>
        <div v-for="(p, i) in partidas" :key="i" class="item">
          <div class="item-topo">
            <span class="item-mapa">{{ p.mapa }}</span>
            <span class="item-quando">{{ p.quando }}</span>
          </div>
          <div class="item-det">{{ p.jogadores }}</div>
        </div>
        <p v-if="!partidas.length" class="vazio">
          Nenhuma partida reportada ainda — abra um lobby!
        </p>
      </div>

      <EmBreve
        titulo="Relatório de batalha"
        descricao="O relatório completo — quem venceu, quanto durou, o que cada um produziu — depende de o servidor dedicado reportar o fim da partida ao master server. Hoje só o início chega. É a Fase 1b: trabalho em Pascal no servidor, e esta carta ganha vida."
        :itens="[
          'Comparativo por jogador: recursos, casas, soldados, abates',
          'Curvas de população e exército ao longo do tempo',
          'Timeline dos momentos decisivos',
          'Minimapa com a posição de cada vila',
        ]"
      />
    </div>
  </div>
</template>

<style scoped>
.sozinho {
  display: block;
}
.duas {
  display: grid;
  grid-template-columns: 288px minmax(0, 1fr);
  gap: 18px;
  margin-top: 20px;
  align-items: start;
}

.lista {
  background: var(--painel);
  border: 1px solid var(--linha);
}
.lista-rotulo {
  display: block;
  padding: 13px 16px 10px;
  border-bottom: 1px solid var(--linha-fraca);
}
.item {
  padding: 11px 16px;
  border-bottom: 1px solid var(--linha-fraca);
}
.item:last-of-type {
  border-bottom: none;
}
.item-topo {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.item-mapa {
  min-width: 0;
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-quando {
  flex: none;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-3);
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
</style>
