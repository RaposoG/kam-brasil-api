<script setup lang="ts">
/**
 * Temporadas: criar, virar, fechar — e montar o pool de mapas de cada uma.
 *
 * O pool é o que o lobby de bans sorteia. Sem mapa no pool a ranqueada não tem
 * o que banir nem o que sortear, e até aqui isso só se fazia com SQL na mão.
 *
 * A API guarda **um** pool por temporada (a ordem do array é a ordem), e não um
 * pool por modo: quem diz em que modo cada mapa vale é o próprio mapa
 * (`modos`). O filtro por modo desta tela é para escolher, não para separar.
 */
import { computed, onMounted, ref } from "vue";
import type { RankedMode } from "../api";
import {
  MODOS,
  type MapaDoCatalogo,
  type Temporada,
  ativarTemporada,
  criarTemporada,
  dataCurta,
  fecharTemporada,
  gravarPoolDaTemporada,
  listarMapas,
  listarPoolDaTemporada,
  listarTemporadas,
} from "../admin";

/** Teto do pool na API: 6 bans alternados + sorteio entre os 4 que sobram. */
const MAX_POOL = 10;

const temporadas = ref<Temporada[]>([]);
const mapas = ref<MapaDoCatalogo[]>([]);
const pool = ref<MapaDoCatalogo[]>([]);

const escolhida = ref("");
const filtroModo = ref<RankedMode | "todos">("todos");
const ocupado = ref(false);
const erro = ref("");
const aviso = ref("");

const nova = ref({ numero: 1, nome: "", inicioEm: "", fimEm: "" });

const temporadaEscolhida = computed(() => temporadas.value.find((t) => t.id === escolhida.value));

const disponiveis = computed(() =>
  mapas.value.filter(
    (m) =>
      !pool.value.some((p) => p.id === m.id) &&
      (filtroModo.value === "todos" || m.modos.includes(filtroModo.value)),
  ),
);

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

async function carregarPool(id: string) {
  escolhida.value = id;
  pool.value = [];
  if (!id) return;
  await tentar(async () => {
    pool.value = await listarPoolDaTemporada(id);
  });
}

async function recarregar() {
  await tentar(async () => {
    [temporadas.value, mapas.value] = await Promise.all([listarTemporadas(), listarMapas()]);
    // Sugere o próximo número: temporada com número repetido volta 409.
    nova.value.numero = Math.max(0, ...temporadas.value.map((t) => t.numero)) + 1;
    const alvo = escolhida.value || temporadas.value.find((t) => t.ativa)?.id || "";
    if (alvo) await carregarPool(alvo);
  });
}

onMounted(recarregar);

const criar = () =>
  tentar(async () => {
    if (!nova.value.nome.trim()) throw new Error("dê um nome à temporada");
    const criada = await criarTemporada({
      nome: nova.value.nome.trim(),
      numero: nova.value.numero,
      inicioEm: nova.value.inicioEm || undefined,
      fimEm: nova.value.fimEm || null,
    });
    aviso.value = `Temporada ${criada.numero} criada. Ela ainda NÃO está ativa — virar a temporada é o botão ATIVAR.`;
    nova.value.nome = "";
    nova.value.inicioEm = "";
    nova.value.fimEm = "";
    await recarregar();
  });

const ativar = (t: Temporada) =>
  tentar(async () => {
    await ativarTemporada(t.id);
    aviso.value = `Temporada ${t.numero} está ativa. A anterior foi desligada na mesma transação.`;
    await recarregar();
  });

const fechar = (t: Temporada) =>
  tentar(async () => {
    await fecharTemporada(t.id);
    aviso.value = `Temporada ${t.numero} fechada agora.`;
    await recarregar();
  });

function adicionar(mapa: MapaDoCatalogo) {
  if (pool.value.length >= MAX_POOL) {
    erro.value = `o pool aceita no máximo ${MAX_POOL} mapas`;
    return;
  }
  erro.value = "";
  pool.value = [...pool.value, mapa];
}

const tirar = (id: string) => (pool.value = pool.value.filter((m) => m.id !== id));

function mover(indice: number, passo: number) {
  const destino = indice + passo;
  if (destino < 0 || destino >= pool.value.length) return;
  const copia = [...pool.value];
  [copia[indice], copia[destino]] = [copia[destino]!, copia[indice]!];
  pool.value = copia;
}

const salvarPool = () =>
  tentar(async () => {
    if (!escolhida.value) throw new Error("escolha uma temporada");
    if (!pool.value.length) throw new Error("o pool precisa de ao menos um mapa");
    const { total } = await gravarPoolDaTemporada(
      escolhida.value,
      pool.value.map((m) => m.id),
    );
    aviso.value = `Pool gravado com ${total} mapas, nesta ordem.`;
    await carregarPool(escolhida.value);
  });

const periodo = (t: Temporada) =>
  t.fimEm ? `${dataCurta(t.inicioEm)} a ${dataCurta(t.fimEm)}` : `desde ${dataCurta(t.inicioEm)}`;
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Temporadas</h1>
        <p class="sub-tela">o ciclo do rank e o pool de mapas que o lobby sorteia</p>
      </div>
      <button class="btn-contorno" :disabled="ocupado" @click="recarregar()">ATUALIZAR</button>
    </div>

    <p v-if="erro" class="erro recado">{{ erro }}</p>
    <p v-if="aviso" class="aviso recado">{{ aviso }}</p>

    <div class="painel bloco">
      <span class="rotulo">NOVA TEMPORADA</span>
      <div class="formulario">
        <label class="rotulo-campo numero">
          NÚMERO
          <input v-model.number="nova.numero" class="campo mono" type="number" min="1" />
        </label>
        <label class="rotulo-campo cresce">
          NOME
          <input v-model="nova.nome" class="campo" maxlength="60" placeholder="Temporada de Inverno" />
        </label>
        <label class="rotulo-campo">
          INÍCIO (OPCIONAL)
          <input v-model="nova.inicioEm" class="campo" type="date" />
        </label>
        <label class="rotulo-campo">
          FIM (OPCIONAL)
          <input v-model="nova.fimEm" class="campo" type="date" />
        </label>
        <button class="btn-contorno" :disabled="ocupado" @click="criar()">CRIAR</button>
      </div>
      <p class="dica">
        Criar não ativa: a temporada nasce desligada e os cortes de tier entram com os valores-semente
        (13 / 16,5 / 20 / 23,5 / 27). Virar a temporada é um ato à parte.
      </p>
    </div>

    <table v-if="temporadas.length" class="tabela bloco">
      <thead>
        <tr>
          <th>Nº</th>
          <th>NOME</th>
          <th>PERÍODO</th>
          <th>ESTADO</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in temporadas" :key="t.id" :class="{ selecionada: t.id === escolhida }">
          <td class="num">{{ t.numero }}</td>
          <td>
            <button class="link-nome" @click="carregarPool(t.id)">{{ t.nome }}</button>
          </td>
          <td class="sub-linha">{{ periodo(t) }}</td>
          <td>
            <span class="selo mono" :class="{ destaque: t.ativa }">{{
              t.ativa ? "ATIVA" : t.fimEm ? "ENCERRADA" : "PARADA"
            }}</span>
          </td>
          <td>
            <div class="acoes">
              <button class="btn-contorno" :disabled="ocupado || t.ativa" @click="ativar(t)">
                ATIVAR
              </button>
              <button class="btn-contorno" :disabled="ocupado" @click="fechar(t)">FECHAR</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-else class="vazio">Nenhuma temporada ainda — crie a primeira acima.</p>

    <div v-if="temporadaEscolhida" class="painel bloco">
      <div class="linha-topo">
        <span class="rotulo">
          POOL DA TEMPORADA {{ temporadaEscolhida.numero }} · {{ pool.length }}/{{ MAX_POOL }}
        </span>
        <div class="filtros">
          <button
            class="filtro"
            :class="{ ativo: filtroModo === 'todos' }"
            @click="filtroModo = 'todos'"
          >
            TODOS
          </button>
          <button
            v-for="m in MODOS"
            :key="m"
            class="filtro"
            :class="{ ativo: filtroModo === m }"
            @click="filtroModo = m"
          >
            {{ m.toUpperCase() }}
          </button>
        </div>
      </div>

      <div class="duas-colunas">
        <div class="coluna">
          <span class="rotulo">CATÁLOGO</span>
          <ul class="lista">
            <li v-for="m in disponiveis" :key="m.id">
              <div class="min-zero">
                <div class="nome-linha">{{ m.nome }}</div>
                <div class="sub-linha">{{ m.modos.join(" · ") }}{{ m.ativo ? "" : " · INATIVO" }}</div>
              </div>
              <button class="btn-contorno" @click="adicionar(m)">ADICIONAR</button>
            </li>
          </ul>
          <p v-if="!disponiveis.length" class="dica">
            Nenhum mapa disponível neste filtro. O catálogo se alimenta na tela de Mapas.
          </p>
        </div>

        <div class="coluna">
          <span class="rotulo">NO POOL (A ORDEM É A DO SORTEIO)</span>
          <ul class="lista">
            <li v-for="(m, i) in pool" :key="m.id">
              <div class="min-zero">
                <div class="nome-linha">{{ i + 1 }}. {{ m.nome }}</div>
                <div class="sub-linha">{{ m.modos.join(" · ") }}</div>
              </div>
              <div class="acoes">
                <button class="btn-contorno" :disabled="i === 0" @click="mover(i, -1)">↑</button>
                <button class="btn-contorno" :disabled="i === pool.length - 1" @click="mover(i, 1)">
                  ↓
                </button>
                <button class="btn-contorno perigo" @click="tirar(m.id)">TIRAR</button>
              </div>
            </li>
          </ul>
          <p v-if="!pool.length" class="dica">
            Pool vazio: o lobby de bans não teria o que sortear nesta temporada.
          </p>
          <button class="btn-contorno ativo salvar" :disabled="ocupado" @click="salvarPool()">
            GRAVAR O POOL
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bloco {
  margin-top: 20px;
}
.recado {
  margin-top: 16px;
}
.formulario {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.numero {
  width: 88px;
}
.cresce {
  flex: 1;
  min-width: 180px;
}
.dica {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--calado-2);
  text-wrap: pretty;
}
.link-nome {
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
}
.link-nome:hover {
  color: var(--ouro);
}
tr.selecionada td {
  background: rgba(212, 162, 74, 0.06);
}
.sub-linha {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
}
.linha-topo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.filtros {
  display: flex;
  gap: 2px;
}
.duas-colunas {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 16px;
}
.coluna {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lista {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--linha-tenue);
}
.lista li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--linha-tenue);
}
.lista li:last-child {
  border-bottom: none;
}
.min-zero {
  min-width: 0;
}
.nome-linha {
  font-family: var(--display);
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.salvar {
  align-self: flex-start;
}
</style>
