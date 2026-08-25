<script setup lang="ts">
/**
 * Caixa de entrada de chamados do painel.
 *
 * A fila de trabalho é o filtro ABERTOS: é onde a bola está com a equipe.
 * Responder devolve a bola ao jogador ('respondido'); a resposta aparece para
 * ele como EQUIPE KAM BRASIL — o jogador fala com o projeto, não com um
 * moderador específico. O email do autor está aqui porque é o canal de
 * contato se ele sumir do launcher.
 */
import { onMounted, ref } from "vue";
import type { ChamadoEstado, ChamadoMensagem } from "../api";
import {
  type ChamadoDoPainel,
  dataHora,
  fecharChamado,
  listarChamados,
  responderChamado,
  verChamado,
} from "../admin";

const ESTADOS: { id: ChamadoEstado | ""; label: string }[] = [
  { id: "aberto", label: "ABERTOS" },
  { id: "respondido", label: "RESPONDIDOS" },
  { id: "fechado", label: "FECHADOS" },
  { id: "", label: "TODOS" },
];

const RÓTULO: Record<string, string> = { aberto: "ABERTO", respondido: "RESPONDIDO", fechado: "FECHADO" };
const TIPO: Record<string, string> = { problema: "PROBLEMA", sugestao: "SUGESTÃO", ajuda: "AJUDA" };

const chamados = ref<ChamadoDoPainel[]>([]);
const estado = ref<ChamadoEstado | "">("aberto");
const ocupado = ref(false);
const erro = ref("");

const aberto = ref<ChamadoDoPainel | null>(null);
const autor = ref<{ nickname: string; email: string } | null>(null);
const mensagens = ref<ChamadoMensagem[]>([]);
const resposta = ref("");

async function tentar(acao: () => Promise<void>) {
  erro.value = "";
  ocupado.value = true;
  try {
    await acao();
  } catch (e) {
    erro.value = String(e);
  } finally {
    ocupado.value = false;
  }
}

const recarregar = () =>
  tentar(async () => {
    chamados.value = await listarChamados(estado.value || undefined);
  });

onMounted(recarregar);

function filtrar(novo: ChamadoEstado | "") {
  estado.value = novo;
  aberto.value = null;
  recarregar();
}

const entrar = (c: ChamadoDoPainel) =>
  tentar(async () => {
    const detalhe = await verChamado(c.id);
    aberto.value = { ...c, ...detalhe.chamado };
    autor.value = detalhe.autor;
    mensagens.value = detalhe.mensagens;
    resposta.value = "";
  });

const responder = () =>
  tentar(async () => {
    if (!aberto.value) return;
    const corpo = resposta.value.trim();
    if (corpo.length < 2) return;
    const r = await responderChamado(aberto.value.id, corpo);
    mensagens.value = [...mensagens.value, r.mensagem];
    aberto.value = { ...aberto.value, estado: r.estado };
    resposta.value = "";
    recarregar();
  });

const fechar = () =>
  tentar(async () => {
    if (!aberto.value) return;
    await fecharChamado(aberto.value.id);
    aberto.value = { ...aberto.value, estado: "fechado" };
    recarregar();
  });
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Chamados</h1>
        <p class="sub-tela">{{ chamados.length }} na lista — abertos são a fila de trabalho</p>
      </div>
      <div class="filtros">
        <button
          v-for="e in ESTADOS"
          :key="e.id"
          class="filtro"
          :class="{ ativo: estado === e.id }"
          @click="filtrar(e.id)"
        >
          {{ e.label }}
        </button>
      </div>
    </div>

    <p v-if="erro" class="erro recado">{{ erro }}</p>
    <p v-if="!chamados.length && !ocupado" class="vazio">Nada nesta fila.</p>

    <div class="colunas">
      <div class="lista">
        <button
          v-for="c in chamados"
          :key="c.id"
          class="painel caso"
          :class="{ selecionado: aberto?.id === c.id }"
          @click="entrar(c)"
        >
          <div class="caso-topo">
            <span class="selo mono" :class="{ destaque: c.estado === 'aberto' }">{{ RÓTULO[c.estado] }}</span>
            <span class="rotulo">{{ TIPO[c.tipo] ?? c.tipo }}</span>
            <span class="quando mono">{{ dataHora(c.ultimaMensagemEm) }}</span>
          </div>
          <div class="caso-titulo">{{ c.titulo }}</div>
          <div class="caso-autor mono">{{ c.autor }} · {{ c.autorEmail }}</div>
        </button>
      </div>

      <div v-if="aberto" class="painel conversa">
        <div class="conversa-cabeca">
          <div>
            <div class="caso-titulo">{{ aberto.titulo }}</div>
            <div class="caso-autor mono">
              {{ autor?.nickname ?? "?" }} · {{ autor?.email ?? "?" }} · aberto em {{ dataHora(aberto.criadoEm) }}
            </div>
          </div>
          <button v-if="aberto.estado !== 'fechado'" class="btn-contorno perigo" :disabled="ocupado" @click="fechar">
            FECHAR
          </button>
        </div>

        <div class="mensagens">
          <div v-for="m in mensagens" :key="m.id" class="fala" :class="{ equipe: m.daEquipe }">
            <div class="autor-linha">
              <span class="autor" :class="{ 'autor-equipe': m.daEquipe }">
                {{ m.daEquipe ? `EQUIPE (${m.deQuem})` : m.deQuem }}
              </span>
              <span class="hora mono">{{ dataHora(m.em) }}</span>
            </div>
            <div class="texto">{{ m.body }}</div>
          </div>
        </div>

        <div class="responder">
          <textarea
            v-model="resposta"
            class="campo caixa-resposta"
            maxlength="2000"
            placeholder="responder como EQUIPE KAM BRASIL…"
            @keydown.ctrl.enter="responder"
          />
          <button class="btn-ouro" :disabled="resposta.trim().length < 2 || ocupado" @click="responder">
            RESPONDER
          </button>
        </div>
      </div>
      <p v-else-if="chamados.length" class="vazio escolha">Escolha um chamado ao lado.</p>
    </div>
  </div>
</template>

<style scoped>
.recado {
  margin-bottom: 14px;
}
.filtros {
  display: flex;
  gap: 8px;
}
.colunas {
  display: grid;
  grid-template-columns: minmax(280px, 380px) 1fr;
  gap: 14px;
  align-items: start;
}
.lista {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 70vh;
  overflow-y: auto;
}
.caso {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--linha);
  transition: border-color 0.15s;
}
.caso:hover {
  border-color: var(--bronze);
}
.caso.selecionado {
  border-color: var(--ouro);
}
.caso-topo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quando {
  margin-left: auto;
  font-size: 8.5px;
  color: var(--calado-4);
}
.caso-titulo {
  margin-top: 7px;
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
  overflow-wrap: anywhere;
}
.caso-autor {
  margin-top: 4px;
  font-size: 9px;
  color: var(--calado-3);
  overflow-wrap: anywhere;
}
.conversa-cabeca {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--linha-fraca);
  margin-bottom: 12px;
}
.mensagens {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 44vh;
  overflow-y: auto;
  margin-bottom: 12px;
}
.fala.equipe {
  border-left: 2px solid var(--ouro);
  padding-left: 12px;
}
.autor-linha {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.autor {
  font-family: var(--display);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--tenue);
}
.autor-equipe {
  color: var(--ouro-claro);
}
.hora {
  font-size: 8.5px;
  color: var(--calado-4);
}
.texto {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--pergaminho);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.responder {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.caixa-resposta {
  flex: 1;
  min-height: 60px;
  resize: vertical;
}
.escolha {
  padding-top: 30px;
}
</style>
