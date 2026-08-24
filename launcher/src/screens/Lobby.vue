<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import {
  type Account,
  type LobbyView,
  type Team,
  NOME_DO_TIER,
  downloadMap,
  launchGame,
  lobbyBan,
  lobbyFetch,
  mapReady,
  queueStatus,
  rotuloModo,
} from "../api";
import { useTempoReal } from "../tempo-real";

/**
 * O lobby ranqueado: banimento alternado dos 10 mapas da temporada, sorteio
 * entre os que sobram e a abertura do jogo já dentro da sala reservada.
 *
 * O id do lobby vem do `queue/status` em vez de uma store: a entrada da fila
 * guarda o `lobbyId` no banco, então ela é o ponteiro que sobrevive a fechar o
 * launcher no meio dos bans — uma store em memória não sobreviveria.
 */

const emit = defineEmits<{ ir: [tela: string] }>();
const account = inject<Account>("account");

const lobbyId = ref<string | null>(null);
const view = ref<LobbyView | null>(null);
const erro = ref("");
const banindo = ref(false);
const pronto = ref(false);

// Cronômetro do turno: o prazo é absoluto (ISO) e a contagem é local, então
// um poll perdido não congela o relógio na tela.
const agora = ref(Date.now());

const meuTime = computed<Team | null>(
  () => view.value?.times.find((j) => j.nickname === account?.nickname)?.time ?? null,
);

const minhaVez = computed(
  () => view.value?.estado === "ban" && !!meuTime.value && view.value.turnoTime === meuTime.value,
);

const restamSeg = computed(() => {
  const prazo = view.value?.turnoPrazo;
  if (!prazo) return 0;
  return Math.max(0, Math.ceil((Date.parse(prazo) - agora.value) / 1000));
});

const times = computed(() =>
  (["A", "B"] as const).map((time) => ({
    time,
    jogadores: (view.value?.times ?? []).filter((j) => j.time === time).sort((a, b) => a.loc - b.loc),
  })),
);

const banidos = computed(() => view.value?.mapas.filter((m) => m.estado === "banido").length ?? 0);

// Normalmente 6, dos 10 da temporada. Derivado do pool, e não fixo, porque uma
// temporada publicada com menos mapas baniria até sobrar um só.
const bansTotais = computed(() => Math.min(6, Math.max((view.value?.mapas.length ?? 0) - 1, 0)));

const ESTADOS: Record<LobbyView["estado"], string> = {
  ban: "FASE DE BANIMENTO",
  draw: "MAPA SORTEADO",
  launch: "ABRINDO O JOGO",
  live: "PARTIDA EM ANDAMENTO",
  done: "PARTIDA ENCERRADA",
  aborted: "LOBBY CANCELADO",
};

const acabou = computed(() => view.value?.estado === "done" || view.value?.estado === "aborted");

// O jogo é aberto uma vez só: o poll continua rodando depois do `launch`, e
// sem esta trava ele reabriria o jogo a cada 1,5 s.
let abriu = false;

/**
 * O mapa da partida precisa estar no disco ANTES de o jogo abrir.
 *
 * Numa sala ranqueada o servidor impõe o setup e recusa o repasse do host — e
 * o download de mapa do jogo passa justamente pelo host. Quem entra sem o mapa
 * fica com a barra em 0 kb para sempre, e nem sair da tela consegue.
 */
const mapaEstado = ref<"conferindo" | "baixando" | "pronto" | "faltando" | null>(null);

async function conferirMapa(nome: string): Promise<boolean> {
  mapaEstado.value = "conferindo";
  try {
    if (!(await mapReady(nome))) {
      mapaEstado.value = "baixando";
      await downloadMap(nome);
    }
    mapaEstado.value = "pronto";
    return true;
  } catch (e) {
    mapaEstado.value = "faltando";
    erro.value = String(e);
    return false;
  }
}

// Uma vez só por lobby: o poll passa por aqui a cada 1,5 s.
let mapaPronto: Promise<boolean> | null = null;

const garantirMapa = (nome: string) => (mapaPronto ??= conferirMapa(nome));

/** O jogador precisa saber por que está esperando — ou por que não abriu. */
const recadoMapa = computed(() => {
  const nome = view.value?.mapaEscolhido?.nome ?? "";
  switch (mapaEstado.value) {
    case "conferindo":
      return `Conferindo “${nome}” na sua instalação…`;
    case "baixando":
      return `Baixando “${nome}” — só na primeira vez, e o jogo só abre depois.`;
    case "pronto":
      return `Mapa “${nome}” conferido na sua instalação.`;
    case "faltando":
      return `“${nome}” não está na sua instalação e não foi possível baixá-lo — por isso o jogo não abriu.`;
    default:
      return "";
  }
});

async function abrirJogo() {
  abriu = true;
  const nome = view.value?.mapaEscolhido?.nome;
  // Botão "ABRIR DE NOVO" depois de falhar: tenta o download de novo em vez de
  // devolver na hora o mesmo erro guardado.
  if (mapaEstado.value === "faltando") mapaPronto = null;

  // Abrir sem o mapa é esconder o problema: o jogo trava no lobby com um
  // download que nunca anda. Melhor não abrir e dizer o que falta.
  if (nome && !(await garantirMapa(nome))) return;

  try {
    // Sem `launch` o jogo abre no menu — é o que sobra para o botão "ABRIR DE
    // NOVO" enquanto a reserva não chega.
    await launchGame(view.value?.launch);
  } catch (e) {
    erro.value = String(e);
  }
}

/** O que a tela faz com um lobby — venha ele do socket ou do poll. */
function aplicar(novo: LobbyView) {
  view.value = novo;
  // Já no sorteio, antes da reserva ficar pronta: o download acontece enquanto
  // o servidor prepara a sala, e no `launch` normalmente já está tudo no disco.
  if (novo.mapaEscolhido) garantirMapa(novo.mapaEscolhido.nome);
  if (novo.estado === "launch" && novo.launch && !abriu) abrirJogo();
}

// Mesmo formato do poll, montado pela mesma vista no servidor. O evento `fila`
// traz o `lobbyId` junto: reabrir o launcher no meio dos bans não depende do
// poll ter respondido primeiro.
const ligado = useTempoReal((e) => {
  if (e.tipo === "fila") lobbyId.value = e.lobbyId ?? lobbyId.value;
  else if (e.id === lobbyId.value) aplicar(e);
});

watch(ligado, (vivo) => {
  if (!vivo) poll();
});

async function poll() {
  if (!lobbyId.value) return;
  try {
    aplicar(await lobbyFetch(lobbyId.value));
  } catch (e) {
    // Mesmo trato do dock: queda de rede deixa o último estado conhecido na
    // tela em vez de apagar o lobby. E `erro` fica livre para o que o jogador
    // fez — um 409 de ban não pode ser varrido pelo poll 1,5 s depois.
    if (!view.value) erro.value = String(e);
  }
}

async function banir(mapId: string) {
  if (!lobbyId.value || !minhaVez.value || banindo.value) return;
  banindo.value = true;
  erro.value = "";
  try {
    await lobbyBan(lobbyId.value, mapId);
  } catch (e) {
    // 409 é o caso normal de corrida: o prazo estourou e o sistema baniu antes.
    erro.value = String(e);
  } finally {
    banindo.value = false;
  }
  await poll();
}

let tPoll = 0;
let tRelogio = 0;

onMounted(async () => {
  try {
    lobbyId.value = (await queueStatus()).lobbyId ?? null;
  } catch (e) {
    erro.value = String(e);
  }

  if (lobbyId.value) await poll();
  pronto.value = true;

  tPoll = window.setInterval(() => {
    // Encerrado não muda mais: continuar batendo de 1,5 s seria poll por nada.
    // Com o socket de pé, também não: ele é o caminho rápido, o poll é a reserva.
    if (acabou.value || ligado.value) return;
    poll();
  }, 1_500);
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
        <h1 class="titulo-tela">Lobby ranqueado</h1>
        <p class="sub-tela">
          <template v-if="view">{{ rotuloModo(view.mode) }} · {{ banidos }} de {{ bansTotais }} mapas banidos</template>
          <template v-else>a sala entre o pareamento e a batalha</template>
        </p>
      </div>
      <div v-if="view" class="selo destaque">{{ ESTADOS[view.estado] }}</div>
    </div>

    <p v-if="erro" class="erro faixa-erro">{{ erro }}</p>

    <div v-if="pronto && !lobbyId" class="painel vazio-bloco">
      <div class="acao-titulo">Nenhum lobby aberto</div>
      <p class="acao-sub">Entre na fila para ser pareado — o lobby abre sozinho quando houver partida.</p>
      <button class="btn-contorno voltar" @click="emit('ir', 'ranqueada')">IR PARA A FILA</button>
    </div>

    <template v-if="view">
      <!-- Faixa de estado: o que a tela pede do jogador AGORA. -->
      <div class="painel faixa" :class="{ vez: minhaVez }">
        <template v-if="view.estado === 'ban'">
          <div>
            <div class="faixa-titulo">{{ minhaVez ? "Sua vez de banir" : "Vez do outro time" }}</div>
            <p class="acao-sub">
              {{
                minhaVez
                  ? "Escolha um mapa para tirar da mesa. Se o prazo estourar, o sistema bane por você."
                  : "Aguarde o banimento do outro time — o turno tem prazo e não trava."
              }}
            </p>
          </div>
          <div class="relogio" :class="{ urgente: restamSeg <= 5 }">{{ restamSeg }}s</div>
        </template>

        <template v-else-if="view.estado === 'draw'">
          <div>
            <div class="faixa-titulo">Mapa sorteado: {{ view.mapaEscolhido?.nome ?? "—" }}</div>
            <p class="acao-sub">Sorteado entre os mapas que sobraram dos bans. A sala está sendo reservada.</p>
            <p v-if="recadoMapa" class="acao-sub mapa-status" :class="mapaEstado">{{ recadoMapa }}</p>
          </div>
        </template>

        <template v-else-if="view.estado === 'launch'">
          <div>
            <div class="faixa-titulo">
              {{ mapaEstado === "faltando" ? "O jogo não pôde abrir" : "Abrindo o jogo…" }}
            </div>
            <p v-if="recadoMapa" class="acao-sub mapa-status" :class="mapaEstado">{{ recadoMapa }}</p>
            <p class="acao-sub">
              <template v-if="view.launch">
                Servidor {{ view.launch.ip }}<template v-if="view.launch.porta">:{{ view.launch.porta }}</template>
                · sala {{ view.launch.sala }}<template v-if="view.launch.senha"> · senha {{ view.launch.senha }}</template>
              </template>
              <template v-else>Aguardando a reserva da sala no servidor dedicado.</template>
            </p>
          </div>
          <button class="btn-contorno" :disabled="mapaEstado === 'baixando'" @click="abrirJogo">
            {{ mapaEstado === "faltando" ? "TENTAR DE NOVO" : "ABRIR DE NOVO" }}
          </button>
        </template>

        <template v-else-if="view.estado === 'live'">
          <div>
            <div class="faixa-titulo">Partida em andamento</div>
            <p class="acao-sub">O resultado é reportado pelo servidor dedicado quando a partida encerrar.</p>
          </div>
        </template>

        <template v-else>
          <div>
            <div class="faixa-titulo">
              {{ view.estado === "done" ? "Partida encerrada" : "Lobby cancelado" }}
            </div>
            <p class="acao-sub">
              {{
                view.estado === "done"
                  ? "O resultado já foi para a crônica de batalhas."
                  : "O lobby foi desfeito antes da partida começar."
              }}
            </p>
          </div>
          <button class="btn-contorno" @click="emit('ir', 'ranqueada')">VOLTAR À FILA</button>
        </template>
      </div>

      <div class="times">
        <div v-for="t in times" :key="t.time" class="painel time" :class="{ meu: t.time === meuTime }">
          <div class="time-cabeca">
            <span class="rotulo">TIME {{ t.time }}</span>
            <span v-if="t.time === meuTime" class="mono seu">SEU TIME</span>
          </div>
          <div v-for="j in t.jogadores" :key="j.nickname" class="jogador">
            <div class="escudo cara"><span>{{ j.nickname.charAt(0).toUpperCase() }}</span></div>
            <div class="quem">
              <div class="jogador-nome">{{ j.nickname }}</div>
              <!-- Só o nome do tier. Nunca pontuação — nem quando a API mandar. -->
              <div class="jogador-tier">{{ j.tier ? NOME_DO_TIER[j.tier] : "em colocação" }}</div>
            </div>
            <span class="loc">POS {{ j.loc + 1 }}</span>
          </div>
        </div>
      </div>

      <div class="mapas-bloco">
        <div class="rotulo espaco">MAPAS DA TEMPORADA</div>
        <div class="mapas">
          <button
            v-for="m in view.mapas"
            :key="m.id"
            class="mapa"
            :class="{
              banido: m.estado === 'banido',
              escolhido: m.id === view.mapaEscolhido?.id,
              clicavel: minhaVez && m.estado === 'livre',
            }"
            :disabled="!minhaVez || m.estado === 'banido' || banindo"
            @click="banir(m.id)"
          >
            <span class="mapa-nome">{{ m.nome }}</span>
            <span class="mapa-estado">
              {{ m.id === view.mapaEscolhido?.id ? "SORTEADO" : m.estado === "banido" ? "BANIDO" : "LIVRE" }}
            </span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.faixa-erro {
  margin-top: 16px;
}

.vazio-bloco {
  margin-top: 22px;
}
.voltar {
  margin-top: 14px;
}

.faixa {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 22px;
  padding: 20px 24px;
}
/* Só o turno de quem está olhando ganha a borda dourada: o resto da tela não
   pode competir com a única decisão que o jogador tem para tomar aqui. */
.faixa.vez {
  border-color: var(--bronze);
  background: linear-gradient(180deg, rgba(212, 162, 74, 0.09), transparent);
}
.faixa-titulo {
  font-family: var(--display);
  font-size: 17px;
  letter-spacing: 0.05em;
  color: var(--pergaminho);
}
.acao-titulo {
  font-family: var(--display);
  font-size: 17px;
  letter-spacing: 0.05em;
  color: var(--pergaminho);
}
.acao-sub {
  margin: 6px 0 0;
  font-size: 12.5px;
  color: var(--calado);
  text-wrap: pretty;
  max-width: 66ch;
}
/* O jogador tem que saber por que está esperando: sem isto, "Abrindo o jogo…"
   fica na tela durante um download de minutos sem explicar nada. */
.mapa-status {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.mapa-status.conferindo,
.mapa-status.baixando {
  color: var(--ouro-medio);
}
.mapa-status.faltando {
  color: var(--vermelho);
}

.relogio {
  flex: none;
  font-family: var(--display);
  font-size: 30px;
  font-weight: 700;
  color: var(--ouro);
  line-height: 1;
}
.relogio.urgente {
  color: var(--vermelho);
  animation: kbpulse 1s ease-in-out infinite;
}

.times {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 20px;
}
.time.meu {
  border-color: var(--bronze);
}
.time-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.seu {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ouro-medio);
}
.jogador {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 0;
  border-bottom: 1px solid var(--linha-tenue);
}
.jogador:last-child {
  border-bottom: none;
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
  flex: 1;
  min-width: 0;
}
.jogador-nome {
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jogador-tier {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--ouro-medio);
}
.loc {
  flex: none;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--calado-3);
}

.mapas-bloco {
  margin-top: 22px;
}
.espaco {
  display: block;
  margin-bottom: 12px;
}
.mapas {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
.mapa {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  padding: 13px 14px;
  background: var(--painel);
  border: 1px solid var(--linha);
  text-align: left;
}
.mapa.clicavel:hover {
  border-color: var(--vermelho-fundo);
  background: rgba(208, 130, 114, 0.08);
}
.mapa.banido {
  opacity: 0.42;
}
.mapa.banido .mapa-nome {
  text-decoration: line-through;
}
.mapa.escolhido {
  opacity: 1;
  border-color: var(--bronze);
  background: rgba(212, 162, 74, 0.1);
}
.mapa-nome {
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.mapa-estado {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--calado-3);
}
.mapa.escolhido .mapa-estado {
  color: var(--ouro);
}
</style>
