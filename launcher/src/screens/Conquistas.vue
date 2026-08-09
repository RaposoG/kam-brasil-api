<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchAchievements } from "../api";

// Catálogo real vindo da API; o progresso não existe ainda — depende de
// estatística por jogador, que só nasce quando o servidor reportar resultados.
const conquistas = ref<Awaited<ReturnType<typeof fetchAchievements>>>([]);

onMounted(async () => {
  try {
    conquistas.value = await fetchAchievements();
  } catch {
    // Sem rede a grade fica vazia; a nota do cabeçalho já situa o jogador.
  }
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Feitos e honrarias</h1>
        <p class="sub-tela">0 de {{ conquistas.length }} conquistadas</p>
      </div>
      <span class="nota">o progresso chega com a Fase 1b, quando o servidor reportar resultados</span>
    </div>

    <div class="grade">
      <div v-for="c in conquistas" :key="c.id" class="conquista">
        <div class="escudo medalha"><span>{{ c.sigla }}</span></div>
        <div class="corpo">
          <div class="nome">{{ c.nome }}</div>
          <div class="desc">{{ c.desc }}</div>
          <div class="progresso">
            <div class="fita"><i style="width: 0" /></div>
            <span class="contagem">—</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nota {
  flex: none;
  max-width: 300px;
  text-align: right;
  font-size: 11.5px;
  color: var(--calado-2);
  font-style: italic;
}
.grade {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  margin-top: 20px;
}
.conquista {
  display: flex;
  gap: 16px;
  background: var(--painel);
  border: 1px solid var(--linha);
  padding: 16px 18px;
}
.conquista:hover {
  border-color: var(--bronze);
}
.medalha {
  width: 38px;
  height: 43px;
  flex: none;
}
.medalha span {
  font-family: var(--display);
  font-size: 13px;
  font-weight: 700;
  color: var(--calado);
}
.corpo {
  min-width: 0;
  flex: 1;
}
.nome {
  font-family: var(--display);
  font-size: 13.5px;
  letter-spacing: 0.04em;
  color: var(--pergaminho);
}
.desc {
  font-size: 12px;
  color: var(--calado);
  line-height: 1.4;
  text-wrap: pretty;
}
.progresso {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 9px;
}
.fita {
  flex: 1;
  height: 5px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--linha);
}
.fita i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--ouro-fundo), var(--ouro));
}
.contagem {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-2);
}
</style>
