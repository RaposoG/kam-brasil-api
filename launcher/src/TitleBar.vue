<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";

// A janela é sem decoração do sistema (`decorations: false`), então esta barra
// é a única forma de mover, maximizar e fechar — ela precisa existir também na
// tela de login, senão dá para abrir o launcher e não conseguir fechá-lo.
const janela = getCurrentWindow();
const versao = ref("");

onMounted(async () => (versao.value = await getVersion()));
</script>

<template>
  <div class="titulo" data-tauri-drag-region>
    <div class="marca" data-tauri-drag-region>
      <img class="brasao" src="./assets/marca.png" alt="" draggable="false" data-tauri-drag-region />
      <span class="nome">KAM BRASIL</span>
      <span class="versao">launcher {{ versao }}</span>
    </div>
    <div class="controles">
      <button class="ctrl" title="Minimizar" @click="janela.minimize()"><i class="traco" /></button>
      <button class="ctrl" title="Maximizar" @click="janela.toggleMaximize()"><i class="quadro" /></button>
      <button class="ctrl fechar" title="Fechar" @click="janela.close()"><i class="xis" /></button>
    </div>
  </div>
</template>

<style scoped>
.titulo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  background: var(--barra);
  border-bottom: 1px solid var(--linha);
  box-shadow: inset 0 1px 0 rgba(212, 162, 74, 0.08);
}
.marca {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brasao {
  /* 18px e nao 9: o brasao tem desenho dentro (monograma, coroa, pergaminho) e
     some se ficar do tamanho do losango que ele substituiu. */
  width: 18px;
  height: 18px;
  object-fit: contain;
  /* A barra e area de arrastar a janela; sem isto o cursor muda em cima da
     imagem e o arrasto falha justamente onde o usuario tende a clicar. */
  pointer-events: none;
  user-select: none;
}
.nome {
  font-family: var(--display);
  font-weight: 700;
  font-size: 11.5px;
  letter-spacing: 0.28em;
  color: var(--ouro);
}
.versao {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--calado-2);
}
.controles {
  display: flex;
  gap: 6px;
}
.ctrl {
  width: 30px;
  height: 22px;
  display: grid;
  place-items: center;
}
.ctrl:hover {
  background: rgba(212, 162, 74, 0.1);
}
.ctrl.fechar:hover {
  background: rgba(208, 130, 114, 0.18);
}
.traco {
  width: 10px;
  height: 1px;
  background: var(--calado);
}
.quadro {
  width: 9px;
  height: 9px;
  border: 1px solid var(--calado);
}
/* O X sai das duas pseudo-bordas do próprio elemento: dois nós a menos. */
.xis {
  position: relative;
  width: 11px;
  height: 11px;
}
.xis::before,
.xis::after {
  content: "";
  position: absolute;
  top: 5px;
  left: 0;
  width: 11px;
  height: 1px;
  background: var(--calado);
}
.xis::before {
  transform: rotate(45deg);
}
.xis::after {
  transform: rotate(-45deg);
}
</style>
