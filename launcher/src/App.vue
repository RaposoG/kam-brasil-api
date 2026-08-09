<script setup lang="ts">
import { onMounted, ref } from "vue";
import { type Account, logout, restoreSession } from "./api";
import TitleBar from "./TitleBar.vue";
import Login from "./Login.vue";
import Shell from "./Shell.vue";

const conta = ref<Account | null>(null);
const abrindo = ref(true);
const erro = ref("");

onMounted(async () => {
  try {
    conta.value = await restoreSession();
  } catch (e) {
    // API fora do ar na abertura não deve travar o launcher numa tela de erro:
    // cai para o formulário e o usuário tenta quando quiser.
    erro.value = String(e);
  } finally {
    abrindo.value = false;
  }
});

async function sair() {
  await logout();
  conta.value = null;
}
</script>

<template>
  <div class="janela textura">
    <TitleBar />

    <div class="palco">
      <div v-if="abrindo" class="abrindo">
        <p class="restaurando">Restaurando sessão…</p>
      </div>

      <Shell v-else-if="conta" :account="conta" @sair="sair" />

      <template v-else>
        <Login @entrou="(c) => (conta = c)" />
        <p v-if="erro" class="erro rodape-erro">{{ erro }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.janela {
  height: 100%;
  display: grid;
  grid-template-rows: 34px 1fr;
  overflow: hidden;
}
.palco {
  position: relative;
  min-height: 0;
}
.abrindo {
  height: 100%;
  display: grid;
  place-items: center;
}
.restaurando {
  font-family: var(--display);
  font-size: 14px;
  letter-spacing: 0.14em;
  color: var(--calado);
}
.rodape-erro {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 16px;
  text-align: center;
}
</style>
