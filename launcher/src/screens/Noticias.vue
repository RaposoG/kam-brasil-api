<script setup lang="ts">
import { MOTD, NOTICIAS, NUMEROS_REINO } from "../mock";
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
        <article v-for="n in NOTICIAS" :key="n.titulo" class="carta nota">
          <div class="nota-cabeca">
            <span class="tag">{{ n.tag }}</span>
            <span class="data">{{ n.data }}</span>
          </div>
          <h2 class="nota-titulo">{{ n.titulo }}</h2>
          <p class="nota-corpo">{{ n.corpo }}</p>
        </article>
      </div>

      <div class="coluna">
        <div class="painel compacto">
          <div class="rotulo espaco">O REINO EM NÚMEROS</div>
          <div v-for="x in NUMEROS_REINO" :key="x.label" class="numero">
            <span>{{ x.label }}</span><span class="numero-valor">{{ x.valor }}</span>
          </div>
        </div>

        <div class="painel compacto">
          <div class="rotulo espaco-curto">MOTD DO SERVIDOR</div>
          <p class="motd">{{ MOTD }}</p>
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
</style>
