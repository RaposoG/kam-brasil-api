<script setup lang="ts">
/**
 * Suporte: o jogador reporta um problema, manda uma sugestão ou pede ajuda, e
 * conversa com a equipe sem sair do launcher.
 *
 * Uma tela, três vistas por estado interno (lista → novo → conversa) — sem
 * rota própria, igual às outras telas. A conversa reusa a mecânica da Taverna
 * (poll serializado + auto-scroll), mas com bolha própria para a EQUIPE: numa
 * conversa de suporte, saber QUEM falou é metade da informação.
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  type Chamado,
  type ChamadoMensagem,
  type ChamadoTipo,
  chamadoAbrir,
  chamadoFechar,
  chamadoResponder,
  chamadoVer,
  chamadosList,
  tempoRelativo,
} from "../api";

const TIPOS: { id: ChamadoTipo; label: string; dica: string }[] = [
  { id: "problema", label: "PROBLEMA", dica: "algo quebrou ou não funciona" },
  { id: "sugestao", label: "SUGESTÃO", dica: "uma ideia para o projeto" },
  { id: "ajuda", label: "AJUDA", dica: "não sei fazer algo" },
];

const RÓTULO_ESTADO: Record<string, string> = {
  aberto: "AGUARDANDO EQUIPE",
  respondido: "RESPONDIDO",
  fechado: "FECHADO",
};

const chamados = ref<Chamado[]>([]);
const vista = ref<"lista" | "novo" | "conversa">("lista");
const ocupado = ref(false);
const erro = ref("");

// formulário de abertura
const tipo = ref<ChamadoTipo>("problema");
const titulo = ref("");
const mensagemNova = ref("");

// conversa aberta
const aberto = ref<Chamado | null>(null);
const mensagens = ref<ChamadoMensagem[]>([]);
const resposta = ref("");
const caixaMsgs = ref<HTMLElement | null>(null);

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
    chamados.value = (await chamadosList()).chamados;
  });

onMounted(recarregar);

// A lista avisa "RESPONDIDO" — é a caixa de entrada do jogador.
const temResposta = computed(() => chamados.value.some((c) => c.estado === "respondido"));

function novo() {
  tipo.value = "problema";
  titulo.value = "";
  mensagemNova.value = "";
  vista.value = "novo";
}

const abrir = () =>
  tentar(async () => {
    const criado = await chamadoAbrir(tipo.value, titulo.value.trim(), mensagemNova.value);
    chamados.value = [criado.chamado, ...chamados.value];
    await entrar(criado.chamado);
  });

async function rolarParaOFim() {
  await nextTick();
  caixaMsgs.value?.scrollTo({ top: caixaMsgs.value.scrollHeight });
}

async function entrar(c: Chamado) {
  aberto.value = c;
  mensagens.value = [];
  vista.value = "conversa";
  await tentar(async () => {
    const detalhe = await chamadoVer(c.id);
    aberto.value = detalhe.chamado;
    mensagens.value = detalhe.mensagens;
    await rolarParaOFim();
  });
}

function voltar() {
  vista.value = "lista";
  aberto.value = null;
  recarregar();
}

const responder = () =>
  tentar(async () => {
    if (!aberto.value) return;
    const corpo = resposta.value.trim();
    if (corpo.length < 2) return;
    const r = await chamadoResponder(aberto.value.id, corpo);
    mensagens.value = [...mensagens.value, r.mensagem];
    aberto.value = { ...aberto.value, estado: r.estado };
    resposta.value = "";
    await rolarParaOFim();
  });

const fechar = () =>
  tentar(async () => {
    if (!aberto.value) return;
    await chamadoFechar(aberto.value.id);
    aberto.value = { ...aberto.value, estado: "fechado" };
  });

// Poll da conversa aberta: a resposta da equipe aparece sem F5. 8s é o meio
// termo entre "parece vivo" e não martelar a API com a tela parada.
let intervalo: number | undefined;
onMounted(() => {
  intervalo = window.setInterval(async () => {
    if (vista.value !== "conversa" || !aberto.value || ocupado.value) return;
    try {
      const detalhe = await chamadoVer(aberto.value.id);
      const noFim =
        !!caixaMsgs.value &&
        caixaMsgs.value.scrollHeight - caixaMsgs.value.scrollTop - caixaMsgs.value.clientHeight < 32;
      const cresceu = detalhe.mensagens.length > mensagens.value.length;
      aberto.value = detalhe.chamado;
      mensagens.value = detalhe.mensagens;
      if (cresceu && noFim) await rolarParaOFim();
    } catch {
      // Poll silencioso: falha transitória não vira banner de erro.
    }
  }, 8_000);
});
onUnmounted(() => clearInterval(intervalo));

const hora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

const rotuloTipo = (t: ChamadoTipo) => TIPOS.find((x) => x.id === t)?.label ?? t;
const podeAbrir = computed(() => titulo.value.trim().length >= 3 && mensagemNova.value.trim().length >= 2);
</script>

<template>
  <div class="tela">
    <!-- ===== LISTA ===== -->
    <template v-if="vista === 'lista'">
      <div class="cabecalho-tela">
        <div>
          <h1 class="titulo-tela">Suporte</h1>
          <p class="sub-tela">
            {{
              temResposta
                ? "a equipe respondeu — abra a conversa marcada"
                : "reporte um problema, mande uma sugestão ou peça ajuda"
            }}
          </p>
        </div>
        <button class="btn-ouro" @click="novo">NOVO CHAMADO</button>
      </div>

      <p v-if="erro" class="erro recado">{{ erro }}</p>
      <p v-if="!chamados.length && !ocupado" class="vazio">
        Nenhum chamado ainda. Encontrou um bug, teve uma ideia ou travou em algo? A equipe lê tudo.
      </p>

      <button v-for="c in chamados" :key="c.id" class="painel caso" @click="entrar(c)">
        <div class="caso-topo">
          <span class="selo mono" :class="{ destaque: c.estado === 'respondido' }">
            {{ RÓTULO_ESTADO[c.estado] }}
          </span>
          <span class="rotulo">{{ rotuloTipo(c.tipo) }}</span>
          <span class="quando mono">{{ tempoRelativo(c.ultimaMensagemEm) }}</span>
        </div>
        <div class="caso-titulo">{{ c.titulo }}</div>
      </button>
    </template>

    <!-- ===== NOVO ===== -->
    <template v-else-if="vista === 'novo'">
      <div class="cabecalho-tela">
        <div>
          <h1 class="titulo-tela">Novo chamado</h1>
          <p class="sub-tela">quanto mais detalhe, mais rápido a equipe resolve</p>
        </div>
        <button class="btn-contorno" @click="vista = 'lista'">VOLTAR</button>
      </div>

      <p v-if="erro" class="erro recado">{{ erro }}</p>

      <div class="painel formulario">
        <span class="rotulo-campo">SOBRE O QUÊ?</span>
        <div class="tipos">
          <button
            v-for="t in TIPOS"
            :key="t.id"
            class="filtro"
            :class="{ ativo: tipo === t.id }"
            :title="t.dica"
            @click="tipo = t.id"
          >
            {{ t.label }}
          </button>
        </div>

        <span class="rotulo-campo">TÍTULO</span>
        <input v-model="titulo" class="campo" maxlength="120" placeholder="ex.: o jogo fecha sozinho no 4v4" />

        <span class="rotulo-campo">DESCREVA</span>
        <textarea
          v-model="mensagemNova"
          class="campo descricao"
          maxlength="2000"
          placeholder="o que aconteceu, quando, e o que você esperava que acontecesse…"
        />

        <div class="acoes-form">
          <button class="btn-ouro" :disabled="!podeAbrir || ocupado" @click="abrir">ENVIAR</button>
        </div>
      </div>
    </template>

    <!-- ===== CONVERSA ===== -->
    <template v-else-if="aberto">
      <div class="cabecalho-tela">
        <div>
          <h1 class="titulo-tela conversa-titulo">{{ aberto.titulo }}</h1>
          <p class="sub-tela">
            <span class="selo mono" :class="{ destaque: aberto.estado === 'respondido' }">
              {{ RÓTULO_ESTADO[aberto.estado] }}
            </span>
            <span class="rotulo tipo-inline">{{ rotuloTipo(aberto.tipo) }}</span>
          </p>
        </div>
        <div class="acoes-conversa">
          <button v-if="aberto.estado !== 'fechado'" class="btn-contorno perigo" :disabled="ocupado" @click="fechar">
            FECHAR CHAMADO
          </button>
          <button class="btn-contorno" @click="voltar">VOLTAR</button>
        </div>
      </div>

      <p v-if="erro" class="erro recado">{{ erro }}</p>

      <div ref="caixaMsgs" class="painel mensagens">
        <div v-for="m in mensagens" :key="m.id" class="fala" :class="{ equipe: m.daEquipe }">
          <div class="autor-linha">
            <span class="autor" :class="{ 'autor-equipe': m.daEquipe }">
              {{ m.daEquipe ? "EQUIPE KAM BRASIL" : m.deQuem }}
            </span>
            <span class="hora mono">{{ hora(m.em) }}</span>
          </div>
          <div class="texto">{{ m.body }}</div>
        </div>
      </div>

      <div class="painel responder">
        <textarea
          v-model="resposta"
          class="campo caixa-resposta"
          maxlength="2000"
          :placeholder="aberto.estado === 'fechado' ? 'escrever aqui reabre o chamado…' : 'responder…'"
          @keydown.ctrl.enter="responder"
        />
        <button class="btn-ouro" :disabled="resposta.trim().length < 2 || ocupado" @click="responder">ENVIAR</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.recado {
  margin-bottom: 14px;
}

/* lista */
.caso {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--linha);
  margin-bottom: 10px;
  transition: border-color 0.15s;
}
.caso:hover {
  border-color: var(--bronze);
}
.caso-topo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.quando {
  margin-left: auto;
  font-size: 9px;
  color: var(--calado-4);
}
.caso-titulo {
  margin-top: 8px;
  font-family: var(--display);
  font-size: 14px;
  color: var(--pergaminho);
}

/* formulário */
.formulario {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 640px;
}
.tipos {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.descricao {
  min-height: 140px;
  resize: vertical;
}
.acoes-form {
  margin-top: 8px;
}

/* conversa */
.conversa-titulo {
  max-width: 560px;
  overflow-wrap: anywhere;
}
.tipo-inline {
  margin-left: 10px;
}
.acoes-conversa {
  display: flex;
  gap: 8px;
}
.mensagens {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 52vh;
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
  min-height: 64px;
  resize: vertical;
}
</style>
