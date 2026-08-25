<script setup lang="ts">
/**
 * Jogadores e punições.
 *
 * Esta é a única tela do launcher que mostra `mu`, `sigma` e o score oculto
 * `c = mu - 2*sigma`. Eles não saem por nenhuma rota pública de propósito: o
 * jogador vê o nome do tier e nada mais, e é isso que impede engenharia
 * reversa da fila. O que aparece aqui não pode virar tela de jogador.
 *
 * A suspensão é da FILA ranqueada, não do jogo: o jogador continua entrando em
 * sala normal. É a punição de abandono, que a API escalona sozinha
 * (15 min → 1 h → 6 h → 24 h → 7 dias) e perdoa após 15 dias limpos.
 */
import { onMounted, ref } from "vue";
import {
  type JogadorAdmin,
  type Punicao,
  type Temporada,
  dataHora,
  listarJogadores,
  listarPunicoes,
  listarTemporadas,
  numero,
  perdoarFila,
  suspenderFila,
} from "../admin";

/** Os degraus que a API aplica sozinha — aqui viram atalho, não regra nova. */
const PENAS = [
  { minutos: 15, label: "15 MIN" },
  { minutos: 60, label: "1 H" },
  { minutos: 360, label: "6 H" },
  { minutos: 1440, label: "24 H" },
  { minutos: 10080, label: "7 DIAS" },
];

const PAGINA = 50;

const jogadores = ref<JogadorAdmin[]>([]);
const punicoes = ref<Punicao[]>([]);
const temporadas = ref<Temporada[]>([]);

const busca = ref("");
const temporada = ref("");
const offset = ref(0);
const temMais = ref(false);
const ocupado = ref(false);
const erro = ref("");
const aviso = ref("");

/** Qual linha está com o painel de suspensão aberto. */
const punindo = ref("");
const minutos = ref(15);

async function tentar(acao: () => Promise<void>) {
  erro.value = "";
  aviso.value = "";
  ocupado.value = true;
  try {
    await acao();
  } catch (e) {
    erro.value = String(e);
  } finally {
    ocupado.value = false;
  }
}

const buscar = (deslocamento = 0) =>
  tentar(async () => {
    offset.value = deslocamento;
    const resposta = await listarJogadores({
      q: busca.value.trim() || undefined,
      seasonId: temporada.value || undefined,
      limit: PAGINA,
      offset: deslocamento,
    });
    jogadores.value = deslocamento ? [...jogadores.value, ...resposta.players] : resposta.players;
    // A API não devolve total; página cheia é o sinal de que pode haver mais.
    temMais.value = resposta.players.length === PAGINA;
  });

const recarregarPunicoes = () =>
  tentar(async () => {
    punicoes.value = await listarPunicoes();
  });

onMounted(async () => {
  await tentar(async () => {
    temporadas.value = await listarTemporadas();
  });
  await buscar();
  await recarregarPunicoes();
});

const suspender = (id: string, nickname: string) =>
  tentar(async () => {
    const { queueBanUntil } = await suspenderFila(id, minutos.value);
    aviso.value = `${nickname} está fora da fila até ${dataHora(queueBanUntil)}.`;
    punindo.value = "";
    await Promise.all([buscar(), recarregarPunicoes()]);
  });

const perdoar = (id: string, nickname: string) =>
  tentar(async () => {
    await perdoarFila(id);
    aviso.value = `${nickname} voltou à fila, e a ficha de reincidência foi zerada.`;
    await Promise.all([buscar(), recarregarPunicoes()]);
  });

const suspensoAte = (j: JogadorAdmin) =>
  j.queueBanUntil && new Date(j.queueBanUntil) > new Date() ? dataHora(j.queueBanUntil) : "";
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Jogadores</h1>
        <p class="sub-tela">rating real da temporada — o jogador só vê o nome do tier</p>
      </div>
      <div class="filtros">
        <input
          v-model="busca"
          class="campo"
          placeholder="buscar por nickname"
          maxlength="16"
          @keyup.enter="buscar()"
        />
        <select v-model="temporada" class="campo" @change="buscar()">
          <option value="">temporada ativa</option>
          <option v-for="t in temporadas" :key="t.id" :value="t.id">
            {{ t.numero }} · {{ t.nome }}
          </option>
        </select>
        <button class="btn-contorno" :disabled="ocupado" @click="buscar()">BUSCAR</button>
      </div>
    </div>

    <p v-if="erro" class="erro recado">{{ erro }}</p>
    <p v-if="aviso" class="aviso recado">{{ aviso }}</p>

    <table v-if="jogadores.length" class="tabela bloco">
      <thead>
        <tr>
          <th>JOGADOR</th>
          <th>TIER</th>
          <th class="num">MU</th>
          <th class="num">SIGMA</th>
          <th class="num">C</th>
          <th class="num">PARTIDAS</th>
          <th>VISTO</th>
          <th>FILA</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <template v-for="j in jogadores" :key="j.id">
          <tr>
            <td>
              <div class="nome-linha">
                {{ j.nickname }}
                <span v-if="j.isAdmin" class="selo mono">ADMIN</span>
              </div>
              <div class="sub-linha">{{ j.email }}</div>
            </td>
            <td>
              <span v-if="j.tier" class="selo mono destaque">{{ j.tier.toUpperCase() }}</span>
              <span v-else class="sub-linha">{{
                j.placementDone === false ? "em colocação" : "sem rating"
              }}</span>
            </td>
            <td class="num">{{ numero(j.mu) }}</td>
            <td class="num">{{ numero(j.sigma) }}</td>
            <td class="num">{{ numero(j.c) }}</td>
            <td class="num">{{ j.rankedMatches ?? 0 }}</td>
            <td class="sub-linha">{{ dataHora(j.lastSeenAt) }}</td>
            <td>
              <span v-if="suspensoAte(j)" class="selo mono suspenso">
                até {{ suspensoAte(j) }}
              </span>
              <span v-else class="sub-linha">livre{{ j.queueBanCount ? ` · ${j.queueBanCount} ocorrência(s)` : "" }}</span>
            </td>
            <td>
              <div class="acoes">
                <button
                  class="btn-contorno"
                  :disabled="ocupado"
                  @click="punindo = punindo === j.id ? '' : j.id"
                >
                  SUSPENDER
                </button>
                <button
                  v-if="suspensoAte(j) || j.queueBanCount"
                  class="btn-contorno"
                  :disabled="ocupado"
                  @click="perdoar(j.id, j.nickname)"
                >
                  PERDOAR
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="punindo === j.id">
            <td colspan="9">
              <div class="pena">
                <span class="rotulo">SUSPENDER {{ j.nickname.toUpperCase() }} DA FILA POR</span>
                <button
                  v-for="p in PENAS"
                  :key="p.minutos"
                  class="filtro"
                  :class="{ ativo: minutos === p.minutos }"
                  @click="minutos = p.minutos"
                >
                  {{ p.label }}
                </button>
                <input v-model.number="minutos" class="campo mono minutos" type="number" min="1" max="43200" />
                <span class="sub-linha">minutos</span>
                <button class="btn-contorno perigo" :disabled="ocupado" @click="suspender(j.id, j.nickname)">
                  APLICAR
                </button>
                <button class="btn-contorno" @click="punindo = ''">CANCELAR</button>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <p v-else class="vazio">Nenhum jogador encontrado com esse filtro.</p>

    <button v-if="temMais" class="btn-contorno mais" :disabled="ocupado" @click="buscar(offset + PAGINA)">
      CARREGAR MAIS
    </button>

    <div class="cabecalho-tela bloco-largo">
      <div>
        <h1 class="titulo-tela menor">Punições</h1>
        <p class="sub-tela">quem tem ficha de abandono, suspenso agora ou não</p>
      </div>
      <button class="btn-contorno" :disabled="ocupado" @click="recarregarPunicoes()">ATUALIZAR</button>
    </div>

    <table v-if="punicoes.length" class="tabela bloco">
      <thead>
        <tr>
          <th>JOGADOR</th>
          <th>ESTADO</th>
          <th>ATÉ</th>
          <th class="num">OCORRÊNCIAS</th>
          <th class="num">ABANDONOS</th>
          <th>ÚLTIMA</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in punicoes" :key="p.id">
          <td>
            <div class="nome-linha">{{ p.nickname }}</div>
            <div class="sub-linha">{{ p.email }}</div>
          </td>
          <td>
            <span class="selo mono" :class="{ suspenso: p.suspensoAgora }">
              {{ p.suspensoAgora ? "SUSPENSO" : "LIVRE" }}
            </span>
          </td>
          <td class="sub-linha">{{ dataHora(p.queueBanUntil) }}</td>
          <td class="num">{{ p.queueBanCount }}</td>
          <td class="num">{{ p.abandonos }}</td>
          <td class="sub-linha">{{ p.queueBanDia ?? "—" }}</td>
          <td>
            <div class="acoes">
              <button class="btn-contorno" :disabled="ocupado" @click="perdoar(p.id, p.nickname)">
                PERDOAR
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-else class="vazio">Ninguém com ficha de punição — o que é uma boa notícia.</p>
  </div>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: 8px;
  flex: none;
}
.recado {
  margin-top: 16px;
}
.bloco {
  margin-top: 18px;
}
.bloco-largo {
  margin-top: 34px;
}
.titulo-tela.menor {
  font-size: 20px;
}
.nome-linha {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
}
.sub-linha {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
}
.selo.suspenso {
  border-color: rgba(208, 130, 114, 0.5);
  background: rgba(208, 130, 114, 0.09);
  color: var(--vermelho);
}
.pena {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
}
.minutos {
  width: 92px;
}
.mais {
  margin-top: 14px;
}
</style>
