<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { type NewsPost, type StatsOverview, fetchMotd, fetchNews, fetchStats } from "../api";

const posts = ref<NewsPost[]>([]);
const motd = ref("");
const stats = ref<StatsOverview | null>(null);
const carregando = ref(true);
const erroPosts = ref("");

onMounted(async () => {
  // MOTD e números falham em silêncio (têm fallback visual); a coluna de
  // posts é o assunto da tela, então lá o erro aparece por extenso.
  fetchMotd().then((t) => (motd.value = t)).catch(() => {});
  fetchStats().then((s) => (stats.value = s)).catch(() => {});
  try {
    posts.value = await fetchNews(20);
  } catch {
    erroPosts.value = "não foi possível alcançar o arauto — a API está fora do ar ou você está sem rede.";
  } finally {
    carregando.value = false;
  }
});

const dataLonga = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" }).format(new Date(iso));

const numeros = computed(() => {
  const s = stats.value;
  if (!s) return [];
  const n = (x: number) => x.toLocaleString("pt-BR");
  return [
    { label: "Contas registradas", valor: n(s.accountsTotal) },
    { label: "Partidas hoje", valor: n(s.matchesToday) },
    { label: "No launcher agora", valor: n(s.launcherOnline) },
    { label: "Servidores no ar", valor: n(s.openServers) },
  ];
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela sozinho">
      <div>
        <h1 class="titulo-tela">Proclamações</h1>
        <p class="sub-tela">notas de versão e avisos da comunidade</p>
      </div>
    </div>

    <div class="duas">
      <div class="coluna">
        <p v-if="carregando" class="estado-lista">consultando o arauto…</p>
        <p v-else-if="erroPosts" class="estado-lista erro">{{ erroPosts }}</p>
        <p v-else-if="!posts.length" class="estado-lista">
          nenhuma proclamação publicada ainda — o mural estreia com a primeira notícia.
        </p>
        <article v-for="n in posts" :key="n.id" class="carta nota">
          <div class="nota-cabeca">
            <span class="tag">{{ n.tag }}</span>
            <span class="data">{{ dataLonga(n.publishedAt) }}</span>
          </div>
          <h2 class="nota-titulo">{{ n.title }}</h2>
          <p class="nota-corpo">{{ n.body }}</p>
        </article>
      </div>

      <div class="coluna">
        <div class="painel compacto">
          <div class="rotulo espaco">O REINO EM NÚMEROS</div>
          <p v-if="!numeros.length" class="estado-mini">contando as bandeiras…</p>
          <div v-for="x in numeros" :key="x.label" class="numero">
            <span>{{ x.label }}</span><span class="numero-valor">{{ x.valor }}</span>
          </div>
        </div>

        <div class="painel compacto">
          <div class="rotulo espaco-curto">MOTD DO SERVIDOR</div>
          <p class="motd">{{ motd || "o servidor não deixou recado hoje." }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sozinho {
  display: block;
}
.duas {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 22px;
  margin-top: 20px;
  align-items: start;
}
.coluna {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.nota {
  padding: 20px 24px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
}
.nota-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.tag {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--carta-calado);
}
.data {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--carta-calado);
}
.nota-titulo {
  margin: 7px 0 0;
  font-family: var(--display);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.nota-corpo {
  margin: 7px 0 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--carta-tinta-2);
  text-wrap: pretty;
}

.compacto {
  padding: 18px 20px;
}
.espaco {
  display: block;
  margin-bottom: 12px;
}
.espaco-curto {
  display: block;
  margin-bottom: 10px;
}
.numero {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--linha-fraca);
  font-size: 12.5px;
  color: var(--calado);
}
.numero:last-child {
  border-bottom: none;
}
.numero-valor {
  font-family: var(--display);
  font-size: 13.5px;
  color: var(--pergaminho);
}
.motd {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--pergaminho);
  font-style: italic;
  text-wrap: pretty;
}
.estado-lista {
  margin: 0;
  padding: 18px 2px;
  font-size: 13px;
  font-style: italic;
  color: var(--calado-2);
}
.estado-mini {
  margin: 0;
  font-size: 12px;
  font-style: italic;
  color: var(--calado-2);
}
</style>
