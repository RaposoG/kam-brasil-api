<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { type Account, apiBase } from "../api";
import {
  atualizarLauncher,
  busy,
  check,
  checking,
  erro,
  escolherOriginal,
  launcherNova,
  original,
  pastaJogo,
  prepararAssets,
  procurarLauncher,
  refresh,
  versaoInstalada,
} from "../install";

const account = inject<Account>("account");
defineEmits<{ sair: [] }>();

const base = ref("");
const versaoLauncher = ref("");

onMounted(async () => {
  base.value = await apiBase();
  versaoLauncher.value = await getVersion();
});

async function abrirPasta() {
  if (!pastaJogo.value) return;
  try {
    await revealItemInDir(pastaJogo.value);
  } catch (e) {
    erro.value = String(e);
  }
}

/**
 * Cada linha aponta para um comando que existe de verdade. O design trazia
 * "MUDAR" na pasta do jogo e um seletor de canal de atualização — nenhum dos
 * dois tem backend hoje, e botão que não faz nada é pior que botão ausente.
 */
const linhas = computed(() => [
  {
    nome: "Pasta do jogo",
    valor: pastaJogo.value || "—",
    acao: "ABRIR",
    ocupado: false,
    executar: abrirPasta,
  },
  {
    nome: "Instalação do KaM Remake",
    valor: original.value ? `${original.value.path} (${original.value.source})` : "não encontrada",
    acao: "REVER",
    ocupado: false,
    executar: escolherOriginal,
  },
  {
    nome: "Verificar arquivos",
    valor: check.value?.needsUpdate
      ? `atualização disponível: ${check.value.latest?.version}`
      : versaoInstalada.value
        ? `versão ${versaoInstalada.value} instalada`
        : "jogo ainda não instalado",
    acao: checking.value ? "…" : "VERIFICAR",
    ocupado: checking.value,
    executar: refresh,
  },
  {
    nome: "Atualizações do launcher",
    valor: launcherNova.value
      ? `nova versão disponível: ${launcherNova.value}`
      : `${versaoLauncher.value} · você está na mais recente`,
    acao: launcherNova.value ? "ATUALIZAR" : "VERIFICAR",
    ocupado: false,
    executar: launcherNova.value ? atualizarLauncher : procurarLauncher,
  },
  {
    nome: "Recopiar arquivos do KaM Remake",
    valor: original.value ? "leva alguns segundos" : "precisa do KaM Remake primeiro",
    acao: "REGERAR",
    ocupado: busy.value || !original.value,
    executar: prepararAssets,
  },
]);
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela sozinho">
      <div>
        <h1 class="titulo-tela">Configurações</h1>
        <p class="sub-tela">
          launcher {{ versaoLauncher }} ·
          jogo {{ versaoInstalada ? "v" + versaoInstalada : "não instalado" }} ·
          API {{ base.replace(/^https?:\/\//, "") }}
        </p>
      </div>
    </div>

    <p v-if="erro" class="erro margem">{{ erro }}</p>

    <div class="duas">
      <div class="painel">
        <div class="rotulo">INSTALAÇÃO</div>
        <div v-for="l in linhas" :key="l.nome" class="linha">
          <div class="quem">
            <div class="nome">{{ l.nome }}</div>
            <div class="valor">{{ l.valor }}</div>
          </div>
          <button class="btn-contorno curto" :disabled="l.ocupado" @click="l.executar()">
            {{ l.acao }}
          </button>
        </div>
      </div>

      <div class="painel">
        <div class="rotulo">CONTA</div>
        <div class="linha">
          <div class="quem">
            <div class="nome">{{ account?.nickname }}</div>
            <div class="valor">{{ account?.email }}</div>
          </div>
        </div>
        <div class="linha simples">
          <span>Nickname no jogo</span><span class="lado">sincronizado</span>
        </div>
        <div class="linha simples sem-borda">
          <span>Sessão</span><span class="lado">guardada no cofre do sistema</span>
        </div>
        <button class="btn-contorno perigo sair" @click="$emit('sair')">SAIR DA CONTA</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sozinho {
  display: block;
}
.margem {
  margin-top: 16px;
}
.duas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 20px;
  align-items: start;
}
.linha {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 0;
  border-bottom: 1px solid var(--linha-fraca);
}
.linha:last-of-type {
  border-bottom: none;
}
.linha.simples {
  font-size: 13px;
  color: var(--pergaminho);
}
.linha.sem-borda {
  border-bottom: none;
}
.quem {
  min-width: 0;
}
.nome {
  font-size: 13px;
  color: var(--pergaminho);
}
.valor {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--calado-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lado {
  color: var(--calado);
}
.curto {
  flex: none;
  padding: 6px 12px;
  font-size: 10.5px;
  letter-spacing: 0.1em;
}
.sair {
  margin-top: 14px;
}
</style>
