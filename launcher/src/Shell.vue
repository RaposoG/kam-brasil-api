<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref } from "vue";
import { type Account, presenceHeartbeat } from "./api";
import { iniciar } from "./install";
import Dock from "./Dock.vue";
import Home from "./screens/Home.vue";
import Perfil from "./screens/Perfil.vue";
import Ranqueada from "./screens/Ranqueada.vue";
import Lobby from "./screens/Lobby.vue";
import Ranking from "./screens/Ranking.vue";
import Partidas from "./screens/Partidas.vue";
import Replays from "./screens/Replays.vue";
import Mapas from "./screens/Mapas.vue";
import Temporada from "./screens/Temporada.vue";
import Conquistas from "./screens/Conquistas.vue";
import Noticias from "./screens/Noticias.vue";
import Config from "./screens/Config.vue";

const props = defineProps<{ account: Account }>();
defineEmits<{ sair: [] }>();

// Só três telas precisam da conta. Passar por prop atravessaria o
// `<component :is>`, que a repassaria como atributo solto no DOM.
// Valor cru, não ref: o Shell só existe logado, e sai de cena inteiro no logout.
provide("account", props.account);

type Tela =
  | "home" | "ranqueada" | "lobby" | "perfil" | "ranking" | "partidas" | "replays"
  | "mapas" | "temporada" | "conquistas" | "noticias" | "config";

// `lobby` não tem item de menu: chega-se a ele pelo pareamento, e um menu para
// uma sala que quase nunca existe seria botão morto na lateral.
const TELAS = {
  home: Home, ranqueada: Ranqueada, lobby: Lobby, perfil: Perfil, ranking: Ranking,
  partidas: Partidas, replays: Replays, mapas: Mapas, temporada: Temporada,
  conquistas: Conquistas, noticias: Noticias, config: Config,
};

const tela = ref<Tela>("home");
const dock = ref(true);
const conteudo = ref<HTMLElement | null>(null);

// Sem tags de contagem: eram números fictícios do mock, e badge mentindo é
// pior que badge nenhuma. Voltam quando cada tela tiver número real a exibir.
const GRUPOS: { titulo: string; itens: { id: Tela; label: string; tag: string }[] }[] = [
  {
    titulo: "JOGO",
    itens: [
      { id: "home", label: "JOGAR", tag: "" },
      { id: "ranqueada", label: "RANQUEADA", tag: "" },
      { id: "partidas", label: "PARTIDAS", tag: "" },
      { id: "replays", label: "REPLAYS", tag: "" },
      { id: "mapas", label: "MAPAS", tag: "" },
    ],
  },
  {
    titulo: "PROGRESSO",
    itens: [
      { id: "perfil", label: "PERFIL", tag: "" },
      { id: "ranking", label: "RANKING", tag: "" },
      { id: "temporada", label: "TEMPORADA", tag: "" },
      { id: "conquistas", label: "CONQUISTAS", tag: "" },
    ],
  },
  { titulo: "COMUNIDADE", itens: [{ id: "noticias", label: "NOTÍCIAS", tag: "" }] },
];

const inicial = computed(() => props.account.nickname.charAt(0).toUpperCase());

const membroDesde = computed(() => {
  const c = props.account.createdAt;
  if (!c) return "";
  const quando = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(c));
  return `membro desde ${quando}`;
});

function ir(id: string) {
  tela.value = id as Tela;
  // Cada tela recomeça do topo: abrir uma lista longa na altura em que a
  // anterior estava rolada deixa a navegação sem chão.
  conteudo.value?.scrollTo({ top: 0 });
}

// Presença: a API considera online quem bateu nos últimos 2 min; batemos a
// cada 60 s com folga. Falha é silenciosa — sem rede, você só aparece offline.
let heartbeat = 0;

onMounted(() => {
  iniciar();
  const bater = () => presenceHeartbeat().catch(() => {});
  bater();
  heartbeat = window.setInterval(bater, 60_000);
});

onUnmounted(() => clearInterval(heartbeat));
</script>

<template>
  <div class="corpo" :class="{ 'sem-dock': !dock }">
    <nav class="lateral">
      <div class="conta">
        <div class="linha-conta">
          <div class="escudo brasao"><span>{{ inicial }}</span></div>
          <div class="quem">
            <div class="apelido">{{ account.nickname }}</div>
            <div class="patente">{{ membroDesde }}</div>
          </div>
        </div>
        <div class="prep-nota">divisões em preparação</div>
      </div>

      <div class="menu">
        <div v-for="g in GRUPOS" :key="g.titulo" class="grupo">
          <div class="grupo-titulo">{{ g.titulo }}</div>
          <button
            v-for="item in g.itens"
            :key="item.id"
            class="item"
            :class="{ ativo: tela === item.id }"
            @click="ir(item.id)"
          >
            <span>{{ item.label }}</span>
            <span class="item-tag">{{ item.tag }}</span>
          </button>
        </div>
      </div>

      <div class="rodape-lateral">
        <button class="link-lateral" :class="{ ativo: tela === 'config' }" @click="ir('config')">
          CONFIGURAÇÕES
        </button>
        <button class="link-dock" @click="dock = !dock">DOCK</button>
      </div>
    </nav>

    <main ref="conteudo" class="conteudo">
      <component :is="TELAS[tela]" @ir="ir" @sair="$emit('sair')" />
    </main>

    <Dock v-if="dock" />
  </div>
</template>

<style scoped>
.corpo {
  height: 100%;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 296px;
  min-height: 0;
}
.corpo.sem-dock {
  grid-template-columns: 220px minmax(0, 1fr);
}

.lateral {
  display: flex;
  flex-direction: column;
  background: var(--lateral);
  border-right: 1px solid var(--linha);
  min-height: 0;
}
.conta {
  padding: 22px 20px 18px;
  border-bottom: 1px solid var(--linha-fraca);
}
.linha-conta {
  display: flex;
  align-items: center;
  gap: 11px;
}
.brasao {
  width: 34px;
  height: 38px;
  flex: none;
}
.brasao span {
  font-family: var(--display);
  font-size: 14px;
  font-weight: 700;
  color: var(--ouro);
}
.quem {
  min-width: 0;
}
.apelido {
  font-family: var(--display);
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.patente {
  font-size: 11px;
  color: var(--calado);
  font-style: italic;
}
.prep-nota {
  margin-top: 11px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--calado-4);
}

.menu {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0 8px;
  min-height: 0;
}
.grupo {
  margin-bottom: 18px;
}
.grupo-titulo {
  padding: 0 20px 8px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--calado-3);
}
.item {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 20px 8px 21px;
  font-family: var(--display);
  font-size: 12px;
  letter-spacing: 0.1em;
  color: var(--calado);
  text-align: left;
}
.item:hover {
  color: var(--pergaminho);
  background: rgba(212, 162, 74, 0.05);
}
.item.ativo {
  color: var(--ouro);
}
/* Filete à esquerda marca a tela aberta — sem preencher o item inteiro, que
   competiria com o dourado do botão JOGAR. */
.item.ativo::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--ouro);
}
.item-tag {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0;
  color: #8f7a5e;
}

.rodape-lateral {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--linha-fraca);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.link-lateral {
  font-family: var(--display);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--calado);
}
.link-lateral:hover,
.link-lateral.ativo {
  color: var(--ouro);
}
.link-dock {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
}
.link-dock:hover {
  color: var(--ouro);
}

.conteudo {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
