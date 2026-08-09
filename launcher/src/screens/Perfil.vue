<script setup lang="ts">
import { computed, inject } from "vue";
import EmBreve from "../EmBreve.vue";
import type { Account } from "../api";

const account = inject<Account>("account");

// "março de 2025" — o Intl já devolve com o "de", não precisa montar na mão.
const desde = computed(() => {
  if (!account?.createdAt) return null;
  return new Date(account.createdAt).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
});

const inicial = computed(() => account?.nickname.charAt(0).toUpperCase() ?? "?");
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div class="identidade">
        <div class="escudo grande"><span>{{ inicial }}</span></div>
        <div>
          <h1 class="nome">{{ account?.nickname }}</h1>
          <p v-if="desde" class="sub-tela">na comunidade desde {{ desde }}</p>
        </div>
      </div>
    </div>

    <div class="duas">
      <EmBreve
        titulo="A sua crônica"
        descricao="Estatística pessoal precisa de resultado de partida — e nenhum chega à API ainda: o jogo só reporta o início de cada lobby. Quando o servidor dedicado aprender a reportar o fim (Fase 1b), tudo isto passa a se escrever sozinho, partida a partida."
        :itens="[
          'Vitórias, derrotas e histórico completo',
          'Economia média por partida',
          'Exército treinado e abates',
          'Hábitos de jogo: aberturas, horários, ritmo',
          'Desempenho por mapa',
        ]"
      />

      <div class="painel conta">
        <div class="rotulo espaco">CONTA</div>
        <div class="campo">
          <span class="campo-nome">Email</span>
          <span class="campo-valor">{{ account?.email }}</span>
        </div>
        <div v-if="desde" class="campo">
          <span class="campo-nome">Membro desde</span>
          <span class="campo-valor">{{ desde }}</span>
        </div>
        <div class="campo">
          <span class="campo-nome">Nickname</span>
          <span class="campo-valor">{{ account?.nickname }}</span>
        </div>
        <p class="nota">
          O nickname é sincronizado no jogo antes de cada partida — dentro do KaM
          você já aparece com este nome.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.identidade {
  display: flex;
  align-items: center;
  gap: 20px;
}
.grande {
  width: 76px;
  height: 86px;
  flex: none;
  background: linear-gradient(175deg, #4a3a28, var(--madeira));
  border-color: #8f6a2e;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
}
.grande span {
  font-family: var(--display);
  font-size: 26px;
  font-weight: 700;
  color: var(--ouro);
}
.nome {
  margin: 0;
  font-family: var(--display);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--pergaminho);
}

.duas {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 20px;
  margin-top: 22px;
  align-items: start;
}

.espaco {
  display: block;
  margin-bottom: 14px;
}
.campo {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
  padding: 11px 0;
  border-bottom: 1px solid var(--linha-fraca);
}
.campo-nome {
  flex: none;
  font-size: 12.5px;
  color: var(--calado);
}
.campo-valor {
  min-width: 0;
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nota {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--calado-2);
  font-style: italic;
  line-height: 1.45;
}
</style>
