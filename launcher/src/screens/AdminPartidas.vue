<script setup lang="ts">
/**
 * Partidas, com o relatório completo de cada uma.
 *
 * É aqui que se audita "esse resultado não podia ter mexido tanto no meu rank":
 * cada linha de jogador guarda mu/sigma **antes e depois** e o peso aplicado.
 * Quem escreveu esses números foi o servidor dedicado — o cliente só enriquece
 * o `statsJson`, e nada aqui é editável de propósito.
 */
import { onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { urlDoReplay } from "../api";
import {
  type JogadorDaPartida,
  type PartidaAdmin,
  dataHora,
  listarPartidas,
  numero,
  verPartida,
} from "../admin";

const FILTROS = [
  { id: "", label: "TODAS" },
  { id: "pending", label: "PENDENTES" },
  { id: "valid", label: "VÁLIDAS" },
  { id: "invalid", label: "INVÁLIDAS" },
];

const partidas = ref<PartidaAdmin[]>([]);
const status = ref("");
const ocupado = ref(false);
const erro = ref("");

/** A partida aberta, com as linhas cruas dos jogadores. */
const aberta = ref<{ match: PartidaAdmin; players: JogadorDaPartida[] } | null>(null);

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
    partidas.value = await listarPartidas({ status: status.value || undefined, limit: 100 });
  });

onMounted(recarregar);

function filtrar(novo: string) {
  status.value = novo;
  aberta.value = null;
  recarregar();
}

const abrir = (p: PartidaAdmin) =>
  tentar(async () => {
    if (aberta.value?.match.id === p.id) {
      aberta.value = null;
      return;
    }
    aberta.value = await verPartida(p.id);
  });

const abrirReplay = (matchId: string, parte: "rpl" | "bas") =>
  tentar(async () => {
    await openUrl(await urlDoReplay(matchId, parte));
  });

/**
 * Ticks, não segundos: o relógio da partida é o da simulação determinística.
 * A 10 ticks por segundo (`gGameApp`), 6000 ticks = 10 minutos.
 */
const duracao = (ticks: number | null) =>
  ticks === null ? "—" : `${Math.floor(ticks / 600)}min (${ticks} ticks)`;

const delta = (antes: number | null, depois: number | null) =>
  antes === null || depois === null ? "—" : `${depois - antes >= 0 ? "+" : ""}${(depois - antes).toFixed(2)}`;
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Partidas</h1>
        <p class="sub-tela">{{ partidas.length }} partidas — clique em uma para ver o relatório</p>
      </div>
      <div class="filtros">
        <button
          v-for="f in FILTROS"
          :key="f.id"
          class="filtro"
          :class="{ ativo: status === f.id }"
          @click="filtrar(f.id)"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <p v-if="erro" class="erro recado">{{ erro }}</p>
    <p v-if="!partidas.length && !ocupado" class="vazio">Nenhuma partida com esse filtro.</p>

    <table v-else class="tabela bloco">
      <thead>
        <tr>
          <th>INÍCIO</th>
          <th>MODO</th>
          <th>MAPA (CRC)</th>
          <th>JOGADORES</th>
          <th>ESTADO</th>
          <th>VENCEDOR</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <template v-for="p in partidas" :key="p.id">
          <tr :class="{ selecionada: aberta?.match.id === p.id }">
            <td class="sub-linha">{{ dataHora(p.iniciadoEm) }}</td>
            <td>
              <span class="selo mono">{{ p.mode.toUpperCase() }}</span>
              <span v-if="!p.seasonId" class="sub-linha casual">casual</span>
            </td>
            <td class="mono">{{ p.mapCrc || "—" }}</td>
            <td class="jogadores">{{ p.jogadores.join(", ") || "—" }}</td>
            <td>
              <span class="selo mono" :class="{ invalida: p.status === 'invalid' }">
                {{ p.status.toUpperCase() }}
              </span>
            </td>
            <td>{{ p.timeVencedor ? `TIME ${p.timeVencedor}` : "—" }}</td>
            <td>
              <div class="acoes">
                <button class="btn-contorno" :disabled="ocupado" @click="abrir(p)">
                  {{ aberta?.match.id === p.id ? "FECHAR" : "RELATÓRIO" }}
                </button>
              </div>
            </td>
          </tr>

          <tr v-if="aberta?.match.id === p.id">
            <td colspan="7">
              <div class="relatorio">
                <div class="ficha">
                  <div><span class="rotulo">ID</span><span class="mono valor">{{ aberta.match.id }}</span></div>
                  <div><span class="rotulo">DURAÇÃO</span><span class="valor">{{ duracao(aberta.match.duracaoTicks) }}</span></div>
                  <div><span class="rotulo">ENCERRADA</span><span class="valor">{{ dataHora(aberta.match.encerradoEm) }}</span></div>
                  <div><span class="rotulo">REVISÃO</span><span class="mono valor">{{ aberta.match.gameRevision || "—" }}</span></div>
                  <div><span class="rotulo">CRC DO EXE</span><span class="mono valor">{{ aberta.match.exeCrc || "—" }}</span></div>
                  <div><span class="rotulo">SEMENTE</span><span class="mono valor">{{ aberta.match.randomSeed ?? "—" }}</span></div>
                  <div><span class="rotulo">FONTE</span><span class="valor">{{ aberta.match.fonte }}</span></div>
                  <div v-if="aberta.match.invalidMotivo" class="largo">
                    <span class="rotulo">MOTIVO DA INVALIDAÇÃO</span>
                    <span class="valor alerta">{{ aberta.match.invalidMotivo }}</span>
                  </div>
                </div>

                <div v-if="aberta.match.replayCrc" class="replay">
                  <span class="rotulo">REPLAY {{ aberta.match.replayCrc }}</span>
                  <button class="btn-contorno" @click="abrirReplay(aberta.match.id, 'rpl')">.RPL</button>
                  <button class="btn-contorno" @click="abrirReplay(aberta.match.id, 'bas')">.BAS</button>
                </div>
                <p v-else class="sub-linha">nenhum jogador enviou o replay desta partida.</p>

                <table class="tabela interna">
                  <thead>
                    <tr>
                      <th>HAND</th>
                      <th>JOGADOR</th>
                      <th>TIME</th>
                      <th>RESULTADO</th>
                      <th class="num">MU ANTES</th>
                      <th class="num">MU DEPOIS</th>
                      <th class="num">Δ MU</th>
                      <th class="num">SIGMA</th>
                      <th class="num">PESO</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="j in aberta.players" :key="j.handIndex">
                      <td class="num">{{ j.handIndex }}</td>
                      <td>
                        <div class="nome-linha">{{ j.nickname }}</div>
                        <div v-if="!j.accountId" class="sub-linha">sem conta casada</div>
                      </td>
                      <td>{{ j.time ?? "—" }}</td>
                      <td>
                        <span class="selo mono" :class="{ invalida: j.abandonou }">
                          {{ j.abandonou ? "ABANDONOU" : j.wonOrLost.toUpperCase() }}
                        </span>
                      </td>
                      <td class="num">{{ numero(j.muBefore) }}</td>
                      <td class="num">{{ numero(j.muAfter) }}</td>
                      <td class="num">{{ delta(j.muBefore, j.muAfter) }}</td>
                      <td class="num">{{ numero(j.sigmaBefore) }} → {{ numero(j.sigmaAfter) }}</td>
                      <td class="num">{{ numero(j.peso) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: 2px;
  flex: none;
}
.recado {
  margin-top: 16px;
}
.bloco {
  margin-top: 18px;
}
.sub-linha {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
}
.casual {
  margin-left: 8px;
}
.jogadores {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selo.invalida {
  border-color: rgba(208, 130, 114, 0.5);
  background: rgba(208, 130, 114, 0.09);
  color: var(--vermelho);
}
tr.selecionada td {
  background: rgba(212, 162, 74, 0.06);
}
.relatorio {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 0 14px;
}
.ficha {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 20px;
}
.ficha > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ficha .largo {
  grid-column: 1 / -1;
}
.valor {
  font-size: 12px;
  color: var(--tenue);
  word-break: break-all;
}
.valor.alerta {
  color: var(--vermelho);
}
.replay {
  display: flex;
  align-items: center;
  gap: 10px;
}
.interna {
  border: 1px solid var(--linha-tenue);
}
.interna th,
.interna td {
  padding-left: 10px;
  padding-right: 10px;
}
.interna th {
  padding-top: 8px;
}
.nome-linha {
  font-family: var(--display);
  font-size: 12.5px;
  color: var(--pergaminho);
}
</style>
