<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type Account,
  type JogadorNaPartida,
  type Partida,
  type Team,
  historicoDePartidas,
  rotuloModo,
  tempoRelativo,
  urlDoReplay,
} from "../api";

/**
 * A crônica de batalhas: o histórico real, vindo de `GET /matches`.
 *
 * Nenhum número de rating aparece aqui — e não é só uma escolha de layout: a
 * API não manda `mu`/`sigma`, e o que a tela lê é só o que está tipado em
 * `api.ts`. Vitória, derrota e mapa; a conta por trás disso é assunto do
 * servidor.
 */

const account = inject<Account>("account");

const partidas = ref<Partida[]>([]);
/** ISO da próxima página. `null` = chegou ao fim da rolagem. */
const cursor = ref<string | null>(null);
const carregando = ref(false);
const erro = ref("");

/** `null` = feed da comunidade. Com valor, o histórico de uma conta só. */
const filtro = ref<{ id: string; nome: string } | null>(null);

/** Trocar de filtro com uma busca em voo: a resposta velha não pode entrar na
 *  lista nova — ela é a crônica de outra conta. */
let pedido = 0;

async function carregar(mais = false) {
  const meu = ++pedido;
  carregando.value = true;
  try {
    const pagina = await historicoDePartidas({
      accountId: filtro.value?.id,
      before: mais ? (cursor.value ?? undefined) : undefined,
    });
    if (meu !== pedido) return;
    // Acumula na paginação e substitui na troca de filtro: são duas listas
    // diferentes, e concatenar a segunda na primeira misturaria as crônicas.
    partidas.value = mais ? [...partidas.value, ...pagina.partidas] : pagina.partidas;
    cursor.value = pagina.proximoCursor;
    erro.value = "";
  } catch (e) {
    if (meu === pedido) erro.value = String(e);
  } finally {
    if (meu === pedido) carregando.value = false;
  }
}

function filtrarPor(conta: { id: string; nome: string } | null) {
  filtro.value = conta;
  partidas.value = [];
  cursor.value = null;
  carregar();
}

/** Clicar no nome de quem jogou puxa a crônica daquela conta. */
function filtrarJogador(j: JogadorNaPartida) {
  if (j.accountId) filtrarPor({ id: j.accountId, nome: j.nickname });
}

const meu = computed(() => !!account && filtro.value?.id === account.id);

onMounted(carregar);

const TIMES: Team[] = ["A", "B"];

function agrupar(jogadores: JogadorNaPartida[]) {
  const grupos: { time: Team | null; jogadores: JogadorNaPartida[] }[] = TIMES.map((time) => ({
    time,
    jogadores: jogadores.filter((j) => j.time === time),
  }));

  // Partida casual pode vir sem times: forçar A/B inventaria uma aliança que
  // não existiu.
  const soltos = jogadores.filter((j) => j.time === null);
  if (soltos.length) grupos.push({ time: null, jogadores: soltos });

  return grupos.filter((g) => g.jogadores.length);
}

const duracao = (seg: number | null) => {
  if (seg === null) return "";
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}`;
};

const RESULTADO: Record<JogadorNaPartida["wonOrLost"], string> = {
  won: "V",
  lost: "D",
  none: "",
};

const lista = computed(() =>
  partidas.value.map((p) => ({
    ...p,
    times: agrupar(p.jogadores),
    quando: tempoRelativo(p.iniciadoEm),
    duracao: duracao(p.duracaoSeg),
  })),
);

/** Rota pública: o navegador do sistema baixa sem token nenhum. */
async function baixar(id: string, parte: "rpl" | "bas") {
  await openUrl(await urlDoReplay(id, parte));
}
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Crônica de batalhas</h1>
        <p class="sub-tela">
          <template v-if="filtro">as partidas de {{ filtro.nome }}</template>
          <template v-else>as partidas da comunidade, do fim para o começo</template>
        </p>
      </div>
      <div class="filtros">
        <button class="filtro" :class="{ ativo: !filtro }" @click="filtrarPor(null)">TODAS</button>
        <button
          v-if="account"
          class="filtro"
          :class="{ ativo: meu }"
          @click="filtrarPor({ id: account.id, nome: account.nickname })"
        >
          MINHAS
        </button>
        <!-- Filtro de terceiro nasce de um clique no nome: sem este botão não
             haveria como voltar a ver a própria crônica. -->
        <button v-if="filtro && !meu" class="filtro ativo" @click="filtrarPor(null)">
          {{ filtro.nome.toUpperCase() }} ✕
        </button>
      </div>
    </div>

    <p v-if="erro" class="erro faixa-erro">{{ erro }}</p>

    <p v-if="!lista.length && !carregando" class="vazio">
      {{
        filtro
          ? "Nenhuma partida por aqui ainda — entre na fila ranqueada."
          : "Nenhuma partida reportada ainda. A primeira batalha abre a crônica."
      }}
    </p>

    <div class="cronica">
      <article
        v-for="p in lista"
        :key="p.id"
        class="painel partida"
        :class="{ anulada: p.status === 'invalid' }"
      >
        <div class="partida-cabeca">
          <div class="minw">
            <div class="mapa">{{ p.mapa.nome ?? "Mapa fora do catálogo" }}</div>
            <div class="meta mono">
              {{ rotuloModo(p.mode) }} · {{ p.ranqueada ? "RANQUEADA" : "AMISTOSA" }} ·
              {{ p.quando }}<template v-if="p.duracao"> · {{ p.duracao }}</template>
            </div>
          </div>
          <span v-if="p.status === 'pending'" class="selo">EM ANDAMENTO</span>
          <span v-else-if="p.status === 'invalid'" class="selo perigo">ANULADA</span>
        </div>

        <!-- Partida anulada continua na crônica, e dizendo por quê: sumir com
             ela deixaria o jogador achando que a partida nunca aconteceu. -->
        <p v-if="p.status === 'invalid'" class="nota-anulada">
          Anulada{{ p.invalidMotivo ? ` — ${p.invalidMotivo}` : "" }}. Não conta para o rank nem
          para as estatísticas.
        </p>

        <div class="times">
          <div
            v-for="t in p.times"
            :key="t.time ?? 'sem'"
            class="time"
            :class="{ venceu: t.time !== null && t.time === p.timeVencedor }"
          >
            <div class="time-cabeca">
              <span class="rotulo">{{ t.time ? `TIME ${t.time}` : "SEM TIME" }}</span>
              <span v-if="t.time !== null && t.time === p.timeVencedor" class="mono venceu-selo">
                VENCEU
              </span>
            </div>
            <button
              v-for="j in t.jogadores"
              :key="j.nickname"
              class="jogador"
              :class="{ clicavel: !!j.accountId }"
              :disabled="!j.accountId"
              @click="filtrarJogador(j)"
            >
              <span class="jogador-nome">{{ j.nickname }}</span>
              <span v-if="j.abandonou" class="jogador-nota mono abandonou">ABANDONOU</span>
              <span v-else class="jogador-nota mono">{{ RESULTADO[j.wonOrLost] }}</span>
            </button>
          </div>
        </div>

        <div v-if="p.replay" class="replay">
          <span class="rotulo">REPLAY · CRC {{ p.replay.crc }}</span>
          <div class="replay-botoes">
            <!-- As duas partes, porque assistir exige as duas: o .rpl são os
                 comandos e o .bas é o estado inicial sobre o qual eles rodam. -->
            <button class="btn-contorno mini" @click="baixar(p.id, 'rpl')">BAIXAR .RPL</button>
            <button class="btn-contorno mini" @click="baixar(p.id, 'bas')">BAIXAR .BAS</button>
          </div>
        </div>
      </article>
    </div>

    <div v-if="cursor" class="mais">
      <button class="btn-contorno" :disabled="carregando" @click="carregar(true)">
        {{ carregando ? "CARREGANDO…" : "CARREGAR MAIS" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: 8px;
  flex: none;
}

.cronica {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 20px;
}
.partida {
  padding: 16px 18px;
}
/* A anulada não some nem grita: fica presente e visivelmente fora da conta. */
.partida.anulada {
  border-color: rgba(208, 130, 114, 0.4);
  opacity: 0.86;
}
.partida-cabeca {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.minw {
  min-width: 0;
}
.mapa {
  font-family: var(--display);
  font-size: 15px;
  letter-spacing: 0.04em;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  margin-top: 4px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--calado-3);
}
.selo.perigo {
  border-color: rgba(208, 130, 114, 0.5);
  color: var(--vermelho);
}
.nota-anulada {
  margin: 10px 0 0;
  font-size: 12px;
  font-style: italic;
  color: var(--vermelho);
  text-wrap: pretty;
}

.times {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}
.time {
  padding: 10px 12px;
  border: 1px solid var(--linha-fraca);
}
.time.venceu {
  border-color: var(--bronze);
  background: rgba(212, 162, 74, 0.06);
}
.time-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.venceu-selo {
  font-size: 8.5px;
  letter-spacing: 0.12em;
  color: var(--ouro);
}
.jogador {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 0;
  text-align: left;
}
.jogador.clicavel:hover .jogador-nome {
  color: var(--ouro);
}
.jogador-nome {
  min-width: 0;
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jogador-nota {
  flex: none;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--calado-2);
}
.jogador-nota.abandonou {
  color: var(--vermelho);
}

.replay {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--linha-tenue);
}
.replay-botoes {
  display: flex;
  gap: 8px;
}
.mini {
  padding: 5px 12px;
  font-size: 9.5px;
}

.faixa-erro {
  margin-top: 16px;
}
.vazio {
  margin: 20px 0 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
}
.mais {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}
</style>
