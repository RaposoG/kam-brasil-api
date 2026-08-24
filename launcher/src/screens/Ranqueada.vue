<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { type QueueStatus, type RankedMode, queueJoin, queueLeave, queueStatus, rotuloModo } from "../api";
import { useTempoReal } from "../tempo-real";

/**
 * A fila ranqueada.
 *
 * Fila ÚNICA com marcação de modos: o jogador marca tudo que aceita e espera
 * uma vez só. Fila por modo fragmenta uma comunidade pequena — é o erro
 * clássico de ladder de comunidade, e a contagem por modo existe justamente
 * para que um modo vazio seja informação em vez de frustração.
 */

const emit = defineEmits<{ ir: [tela: string] }>();

const MODOS: { id: RankedMode; nota: string }[] = [
  { id: "1v1", nota: "duelo" },
  { id: "2v2", nota: "dupla" },
  { id: "3v3", nota: "trio" },
  { id: "4v4", nota: "esquadrão" },
];

const status = ref<QueueStatus | null>(null);
const escolhidos = ref<RankedMode[]>(["1v1"]);
const erro = ref("");
const ocupado = ref(false);

// O servidor manda a espera total a cada poll de 3 s; entre um poll e outro
// contamos localmente, senão o cronômetro anda aos saltos.
const agora = ref(Date.now());
let base = { seg: 0, em: Date.now() };

const esperando = computed(() => status.value?.estado === "waiting");
const pareado = computed(() => status.value?.estado === "matched" && !!status.value.lobbyId);

const esperaSeg = computed(() =>
  esperando.value ? base.seg + Math.floor((agora.value - base.em) / 1000) : 0,
);

const mmss = computed(() => {
  const s = esperaSeg.value;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
});

const naFila = (modo: RankedMode) => status.value?.aguardando[modo] ?? 0;

// Só "tem ou não tem gente": somar as contagens contaria duas vezes quem marcou
// dois modos, e o número por modo já está no cartão de cada um.
const alguemNaFila = computed(() => MODOS.some((m) => naFila(m.id) > 0));

// Só levamos para o lobby quem foi pareado com a tela aberta. Pular sozinho
// para lá na montagem faria laço eterno se a entrada `matched` ficasse presa
// depois da partida — melhor um cartão com botão do que uma tela que não solta.
let viEsperando = false;

/** O que a tela faz com um estado de fila — venha ele do socket ou do poll. */
function aplicar(novo: QueueStatus) {
  if (novo.estado === "waiting") base = { seg: novo.esperaSeg, em: Date.now() };
  // Enquanto ninguém mexeu na marcação, a tela reflete o que o servidor tem.
  if (novo.estado !== "fora" && novo.modos.length) escolhidos.value = novo.modos;
  status.value = novo;

  if (novo.estado === "waiting") viEsperando = true;
  else if (novo.estado === "matched" && novo.lobbyId && viEsperando) emit("ir", "lobby");
}

// O canal de tempo real entrega o MESMO formato do poll, de propósito: cair de
// um para o outro não pode trocar o contrato no meio da fila.
const ligado = useTempoReal((e) => {
  if (e.tipo === "fila") aplicar(e);
});

// O socket caiu: consulta na hora em vez de esperar o próximo tique de 3 s.
watch(ligado, (vivo) => {
  if (!vivo) poll();
});

async function poll() {
  try {
    aplicar(await queueStatus());
  } catch (e) {
    // Sem rede fica o último estado conhecido — o mesmo trato do dock. Só a
    // primeira carga fala, senão o poll de 3 s apagaria o erro de uma ação.
    if (!status.value) erro.value = String(e);
  }
}

async function mudar(fn: () => Promise<unknown>) {
  if (ocupado.value) return;
  ocupado.value = true;
  erro.value = "";
  try {
    await fn();
    await poll();
  } catch (e) {
    erro.value = String(e);
  } finally {
    ocupado.value = false;
  }
}

/** Marcar/desmarcar. Na fila, a marcação nova vai junto — sem perder a espera. */
function alternar(modo: RankedMode) {
  const marcados = escolhidos.value.includes(modo)
    ? escolhidos.value.filter((m) => m !== modo)
    : [...escolhidos.value, modo];

  // Fila sem nenhum modo não existe: sair é uma decisão explícita, com botão.
  if (!marcados.length) return;

  escolhidos.value = marcados;
  if (esperando.value) mudar(() => queueJoin(marcados));
}

const entrar = () => mudar(() => queueJoin(escolhidos.value));
const sair = () => mudar(() => queueLeave());

let tPoll = 0;
let tRelogio = 0;

onMounted(() => {
  poll();
  // O poll não morre, vira reserva: com o socket de pé ele fica calado, e volta
  // sozinho no instante em que a conexão cair.
  tPoll = window.setInterval(() => {
    if (!ocupado.value && !ligado.value) poll();
  }, 3_000);
  tRelogio = window.setInterval(() => (agora.value = Date.now()), 1_000);
});

onUnmounted(() => {
  clearInterval(tPoll);
  clearInterval(tRelogio);
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Ranqueada</h1>
        <p class="sub-tela">marque os modos que você aceita — a fila é uma só</p>
      </div>
      <div class="selo" :class="{ destaque: esperando }">
        {{ esperando ? "NA FILA" : pareado ? "PAREADO" : "FORA DA FILA" }}
      </div>
    </div>

    <p v-if="erro" class="erro faixa-erro">{{ erro }}</p>

    <div class="modos">
      <button
        v-for="m in MODOS"
        :key="m.id"
        class="modo"
        :class="{ ativo: escolhidos.includes(m.id) }"
        :disabled="ocupado || pareado"
        @click="alternar(m.id)"
      >
        <span class="modo-nome">{{ rotuloModo(m.id) }}</span>
        <span class="modo-nota">{{ m.nota }}</span>
        <span class="modo-fila">
          <template v-if="status">{{ naFila(m.id) }} aguardando</template>
          <template v-else>—</template>
        </span>
      </button>
    </div>

    <div class="painel acao">
      <template v-if="pareado">
        <div class="acao-texto">
          <div class="acao-titulo">Partida encontrada</div>
          <p class="acao-sub">O lobby está aberto: é hora de banir os mapas.</p>
        </div>
        <button class="btn-ouro" @click="emit('ir', 'lobby')">ABRIR O LOBBY</button>
      </template>

      <template v-else-if="esperando">
        <div class="acao-texto">
          <div class="relogio">{{ mmss }}</div>
          <p class="acao-sub">
            procurando adversários em
            {{ escolhidos.map(rotuloModo).join(", ") }} — a faixa de pareamento abre com a espera.
          </p>
        </div>
        <button class="btn-contorno perigo" :disabled="ocupado" @click="sair">SAIR DA FILA</button>
      </template>

      <template v-else>
        <div class="acao-texto">
          <div class="acao-titulo">Pronto para a batalha?</div>
          <p class="acao-sub">
            {{ alguemNaFila ? "Já tem gente esperando." : "Ninguém na fila agora." }}
            Você é pareado com quem está por perto no rank, nunca com mais de dois tiers de
            diferença.
          </p>
        </div>
        <button class="btn-ouro" :disabled="ocupado || !escolhidos.length" @click="entrar">
          ENTRAR NA FILA
        </button>
      </template>
    </div>

    <div class="painel regras">
      <div class="rotulo espaco">COMO FUNCIONA</div>
      <ul class="lista-regras">
        <li>Pareado, o lobby abre com os 10 mapas da temporada: 6 bans alternados e sorteio entre os 4 que sobram.</li>
        <li>Cada turno de banimento tem prazo. Estourou, o sistema bane por você e o lobby segue.</li>
        <li>O jogo abre travado na sala certa — mapa, times e posições já definidos.</li>
        <li>Sair depois do pareamento conta derrota e suspende a fila por um tempo, que cresce a cada reincidência.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.faixa-erro {
  margin-top: 16px;
}

.modos {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-top: 22px;
}
.modo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 16px 18px;
  background: var(--painel);
  border: 1px solid var(--linha);
  text-align: left;
}
.modo:hover:not(:disabled) {
  border-color: var(--bronze);
}
.modo.ativo {
  border-color: var(--bronze);
  background: rgba(212, 162, 74, 0.08);
}
.modo:disabled {
  opacity: 0.55;
}
.modo-nome {
  font-family: var(--display);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--calado);
}
.modo.ativo .modo-nome {
  color: var(--ouro);
}
.modo-nota {
  font-size: 12px;
  font-style: italic;
  color: var(--calado-2);
}
.modo-fila {
  margin-top: 7px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--calado-3);
}

.acao {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  margin-top: 20px;
  padding: 24px 26px;
}
.acao-texto {
  min-width: 0;
}
.acao-titulo {
  font-family: var(--display);
  font-size: 17px;
  letter-spacing: 0.05em;
  color: var(--pergaminho);
}
.relogio {
  font-family: var(--display);
  font-size: 34px;
  font-weight: 700;
  color: var(--ouro);
  line-height: 1;
}
.acao-sub {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--calado);
  text-wrap: pretty;
  max-width: 62ch;
}

.regras {
  margin-top: 20px;
}
.espaco {
  display: block;
  margin-bottom: 12px;
}
.lista-regras {
  margin: 0;
  padding: 0;
  list-style: none;
}
.lista-regras li {
  position: relative;
  padding: 6px 0 6px 16px;
  font-size: 12.5px;
  color: var(--tenue);
  border-bottom: 1px solid var(--linha-tenue);
  text-wrap: pretty;
}
.lista-regras li:last-child {
  border-bottom: none;
}
.lista-regras li::before {
  content: "◆";
  position: absolute;
  left: 0;
  top: 9px;
  font-size: 8px;
  color: var(--ouro-medio);
}
</style>
