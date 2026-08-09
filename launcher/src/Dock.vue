<script setup lang="ts">
import { AMIGOS, CHAT } from "./mock";
</script>

<template>
  <aside class="dock">
    <div class="cabeca">
      <span class="titulo-dock">CAMARADAS</span>
      <span class="contagem">6 DE 24 ONLINE</span>
    </div>

    <div class="amigos">
      <div v-for="a in AMIGOS" :key="a.nome" class="amigo">
        <div class="escudo cara"><span>{{ a.inicial }}</span></div>
        <div class="quem">
          <div class="amigo-nome">{{ a.nome }}</div>
          <div class="amigo-estado" :style="{ color: a.cor }">{{ a.estado }}</div>
        </div>
        <span class="amigo-div">{{ a.divisao }}</span>
      </div>
    </div>

    <div class="taverna">
      <div class="cabeca compacta">
        <span class="titulo-dock">TAVERNA</span>
        <span class="falando">● 41 FALANDO</span>
      </div>

      <div class="mensagens">
        <div v-for="(c, i) in CHAT" :key="i">
          <div class="autor-linha">
            <span class="autor" :style="{ color: c.cor }">{{ c.autor }}</span>
            <span class="hora">{{ c.hora }}</span>
          </div>
          <div class="texto">{{ c.texto }}</div>
        </div>
      </div>

      <div class="caixa">
        <div class="entrada">
          <span class="chevron">›</span>
          <!-- Desabilitado de verdade, não decorativo: a taverna ainda não
               existe na API, e um campo que aceita texto e engole tudo seria
               pior que um campo visivelmente fechado. -->
          <input disabled placeholder="dizer algo na taverna…" title="a taverna ainda não está ligada à API" />
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  background: var(--lateral);
  border-left: 1px solid var(--linha);
  min-height: 0;
}
.cabeca {
  padding: 16px 18px 13px;
  border-bottom: 1px solid var(--linha-fraca);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.cabeca.compacta {
  padding: 13px 18px 9px;
  border-bottom: none;
}
.titulo-dock {
  font-family: var(--display);
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--pergaminho);
}
.contagem {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
}
.falando {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--verde);
  animation: kbpulse 2.4s ease-in-out infinite;
}

.amigos {
  max-height: 296px;
  overflow-y: auto;
}
.amigo {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--linha-tenue);
  cursor: pointer;
}
.amigo:hover {
  background: rgba(212, 162, 74, 0.05);
}
.cara {
  width: 26px;
  height: 30px;
  flex: none;
  border-color: #4a3a28;
}
.cara span {
  font-family: var(--display);
  font-size: 10px;
  color: var(--calado);
}
.quem {
  min-width: 0;
  flex: 1;
}
.amigo-nome {
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amigo-estado {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.04em;
}
.amigo-div {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--calado-3);
}

.taverna {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--linha);
}
.mensagens {
  flex: 1;
  overflow-y: auto;
  padding: 0 18px 10px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-height: 0;
}
.autor-linha {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.autor {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: 0.04em;
}
.hora {
  font-family: var(--mono);
  font-size: 8.5px;
  color: var(--calado-4);
}
.texto {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--tenue);
  text-wrap: pretty;
}

.caixa {
  padding: 11px 18px 14px;
  border-top: 1px solid var(--linha-fraca);
}
.entrada {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 11px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--linha);
}
.chevron {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--calado-4);
}
.entrada input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 12.5px;
  color: var(--pergaminho);
}
.entrada input::placeholder {
  color: var(--calado-3);
  font-style: italic;
}
.entrada input:disabled {
  cursor: not-allowed;
}
</style>
