<script setup lang="ts">
/**
 * Painel "em preparação" — o lugar honesto para o que o design promete mas a
 * API ainda não sustenta (quase tudo depende do jogo reportar fim de partida;
 * ver docs/FUNCIONALIDADES.md, Camada 3). Melhor um aviso digno no tema do que
 * números inventados fingindo ser progresso.
 */
defineProps<{
  titulo: string
  descricao: string
  /** O que exatamente falta e de onde virá, item a item. */
  itens?: string[]
}>()
</script>

<template>
  <div class="painel embreve">
    <div class="rotulo selo-prep">⚒ EM PREPARAÇÃO</div>
    <h2 class="embreve-titulo">{{ titulo }}</h2>
    <div class="risco" />
    <p class="embreve-desc">{{ descricao }}</p>
    <ul v-if="itens?.length" class="embreve-itens">
      <li v-for="i in itens" :key="i">{{ i }}</li>
    </ul>
  </div>
</template>

<style scoped>
.embreve {
  position: relative;
  overflow: hidden;
}
/* Hachura sutil de "obra": o mesmo truque do herói sem arte. */
.embreve::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(135deg, rgba(212, 162, 74, 0.03) 0 2px, transparent 2px 12px);
}
.selo-prep {
  color: var(--ouro-medio);
}
.embreve-titulo {
  margin: 8px 0 0;
  font-family: var(--display);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--pergaminho);
}
.risco {
  height: 1px;
  background: linear-gradient(90deg, var(--linha), transparent);
  margin: 12px 0;
}
.embreve-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--calado);
  font-style: italic;
  text-wrap: pretty;
}
.embreve-itens {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.embreve-itens li {
  position: relative;
  padding: 5px 0 5px 16px;
  font-size: 12.5px;
  color: var(--tenue);
  border-bottom: 1px solid var(--linha-tenue);
}
.embreve-itens li:last-child {
  border-bottom: none;
}
.embreve-itens li::before {
  content: "◆";
  position: absolute;
  left: 0;
  font-size: 8px;
  color: var(--ouro-medio);
  top: 9px;
}
</style>
