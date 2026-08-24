<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import {
  type Account,
  type EstatisticasDaConta,
  NOME_DO_TIER,
  estatisticasDaConta,
} from "../api";

/**
 * A crônica pessoal.
 *
 * O que aparece aqui é resultado — partidas, vitórias, aproveitamento, divisão.
 * A pontuação por trás da divisão não é exibida nem para o dono da conta: quem
 * enxerga o número passa a jogar para o número (e a evitar partida difícil).
 * A API não a manda, `api.ts` não a declara, e esta tela não a procura.
 */

const account = inject<Account>("account");
const emit = defineEmits<{ ir: [string] }>();

const stats = ref<EstatisticasDaConta | null>(null);
const erro = ref("");

onMounted(async () => {
  if (!account) return;
  try {
    stats.value = await estatisticasDaConta(account.id);
  } catch (e) {
    // Sem rede o cartão da conta continua de pé — ele não depende da API.
    erro.value = String(e);
  }
});

// "março de 2025" — o Intl já devolve com o "de", não precisa montar na mão.
const desde = computed(() => {
  if (!account?.createdAt) return null;
  return new Date(account.createdAt).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
});

const inicial = computed(() => account?.nickname.charAt(0).toUpperCase() ?? "?");

/** `null` = nenhuma partida decidida. Zero seria mentira, e "—" é a verdade. */
const aproveitamento = computed(() => {
  const a = stats.value?.aproveitamento;
  return a === null || a === undefined ? "—" : `${Math.round(a * 100)}%`;
});

const numeros = computed(() => {
  const s = stats.value;
  return [
    { valor: s ? String(s.partidas) : "—", label: "PARTIDAS" },
    { valor: s ? String(s.vitorias) : "—", label: "VITÓRIAS" },
    { valor: s ? String(s.derrotas) : "—", label: "DERROTAS" },
    { valor: s ? aproveitamento.value : "—", label: "APROVEITAMENTO" },
  ];
});

const divisao = computed(() => {
  const s = stats.value;
  if (!s) return "—";
  if (s.tier) return NOME_DO_TIER[s.tier];
  // Sem tier há dois motivos bem diferentes, e trocar um pelo outro faria a
  // tela dizer "em colocação" a quem nunca entrou na fila.
  return s.partidas ? "em colocação" : "sem partidas ranqueadas";
});

const mapas = computed(() => {
  const top = stats.value?.mapasMaisJogados ?? [];
  const maior = Math.max(...top.map((m) => m.partidas), 1);
  return top.map((m) => ({
    nome: m.mapa,
    qtd: String(m.partidas),
    pct: Math.round((m.partidas / maior) * 100),
  }));
});
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div class="identidade">
        <div class="escudo grande"><span>{{ inicial }}</span></div>
        <div>
          <h1 class="nome">{{ account?.nickname }}</h1>
          <p v-if="desde" class="sub-tela">na comunidade desde {{ desde }}</p>
        </div>
      </div>
      <div class="divisao-topo">
        <div class="divisao-valor">{{ divisao }}</div>
        <div class="divisao-label">DIVISÃO</div>
      </div>
    </div>

    <div class="duas">
      <div class="coluna">
        <div class="painel">
          <div class="bloco-cabeca">
            <span class="rotulo">A SUA CRÔNICA</span>
            <button class="btn-contorno mini" @click="emit('ir', 'partidas')">
              VER PARTIDAS
            </button>
          </div>

          <div class="numeros">
            <div v-for="n in numeros" :key="n.label" class="numero">
              <div class="numero-valor">{{ n.valor }}</div>
              <div class="numero-label">{{ n.label }}</div>
            </div>
          </div>

          <div class="rotulo espaco-topo">ÚLTIMOS RESULTADOS</div>
          <div v-if="stats?.ultimos10.length" class="ultimos">
            <span
              v-for="(r, i) in stats.ultimos10"
              :key="i"
              class="resultado"
              :class="r === 'V' ? 'vitoria' : 'derrota'"
            >
              {{ r }}
            </span>
          </div>
          <p v-else class="vazio">
            Nenhuma partida decidida ainda — partida anulada e abandono sem lado definido
            não entram aqui.
          </p>

          <p class="nota-rank">
            A divisão sobe e desce com o resultado das partidas ranqueadas. A pontuação por trás
            dela não é exibida — nem para você.
          </p>
        </div>

        <div class="painel">
          <div class="rotulo espaco">SEUS MAPAS</div>
          <div v-for="m in mapas" :key="m.nome" class="mapa">
            <span class="mapa-nome">{{ m.nome }}</span>
            <div class="fita"><i :style="{ width: m.pct + '%' }" /></div>
            <span class="mapa-qtd">{{ m.qtd }}</span>
          </div>
          <p v-if="stats && !mapas.length" class="vazio">
            Nenhuma partida no histórico ainda.
          </p>
        </div>
      </div>

      <div class="painel conta">
        <div class="rotulo espaco">CONTA</div>
        <div class="campo">
          <span class="campo-nome">Email</span>
          <span class="campo-valor">{{ account?.email }}</span>
        </div>
        <div v-if="desde" class="campo">
          <span class="campo-nome">Membro desde</span>
          <span class="campo-valor">{{ desde }}</span>
        </div>
        <div class="campo">
          <span class="campo-nome">Nickname</span>
          <span class="campo-valor">{{ account?.nickname }}</span>
        </div>
        <p class="nota">
          O nickname é sincronizado no jogo antes de cada partida — dentro do KaM
          você já aparece com este nome.
        </p>
        <p v-if="erro" class="erro nota-erro">{{ erro }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.identidade {
  display: flex;
  align-items: center;
  gap: 20px;
}
.grande {
  width: 76px;
  height: 86px;
  flex: none;
  background: linear-gradient(175deg, #4a3a28, var(--madeira));
  border-color: #8f6a2e;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
}
.grande span {
  font-family: var(--display);
  font-size: 26px;
  font-weight: 700;
  color: var(--ouro);
}
.nome {
  margin: 0;
  font-family: var(--display);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--pergaminho);
}
.divisao-topo {
  flex: none;
  text-align: right;
}
.divisao-valor {
  font-family: var(--display);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ouro);
}
.divisao-label {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.14em;
  color: var(--calado-3);
}

.duas {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 20px;
  margin-top: 22px;
  align-items: start;
}
.coluna {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bloco-cabeca {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.mini {
  padding: 5px 12px;
  font-size: 9.5px;
}

/* Quatro colunas iguais: são leituras do mesmo peso, e uma maior que a outra
   sugeriria que aproveitamento vale mais que vitória. */
.numeros {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.numero {
  padding: 12px 8px;
  border: 1px solid var(--linha-fraca);
  text-align: center;
}
.numero-valor {
  font-family: var(--display);
  font-size: 22px;
  font-weight: 600;
  color: var(--ouro);
}
.numero-label {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.12em;
  color: var(--calado-3);
}

.espaco-topo {
  display: block;
  margin: 18px 0 10px;
}
.ultimos {
  display: flex;
  gap: 6px;
}
.resultado {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--linha);
  font-family: var(--display);
  font-size: 12px;
  font-weight: 700;
}
.resultado.vitoria {
  border-color: rgba(148, 185, 111, 0.45);
  background: rgba(148, 185, 111, 0.1);
  color: var(--verde);
}
.resultado.derrota {
  border-color: rgba(208, 130, 114, 0.4);
  background: rgba(208, 130, 114, 0.08);
  color: var(--vermelho);
}
.nota-rank {
  margin: 16px 0 0;
  font-size: 12px;
  font-style: italic;
  color: var(--calado-2);
  text-wrap: pretty;
}

.espaco {
  display: block;
  margin-bottom: 14px;
}
.mapa {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.mapa-nome {
  width: 112px;
  flex: none;
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fita {
  flex: 1;
  height: 9px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--linha);
}
.fita i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--ouro-fundo), var(--ouro));
}
.mapa-qtd {
  width: 34px;
  text-align: right;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--calado);
}

.campo {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
  padding: 11px 0;
  border-bottom: 1px solid var(--linha-fraca);
}
.campo-nome {
  flex: none;
  font-size: 12.5px;
  color: var(--calado);
}
.campo-valor {
  min-width: 0;
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nota {
  margin: 12px 0 0;
  font-size: 11.5px;
  color: var(--calado-2);
  font-style: italic;
  line-height: 1.45;
}
.nota-erro {
  margin-top: 10px;
}
.vazio {
  margin: 0;
  font-size: 12.5px;
  color: var(--calado-2);
  font-style: italic;
  text-wrap: pretty;
}
</style>
