<script setup lang="ts">
/**
 * Fila de denúncias.
 *
 * É a única defesa que existe contra maphack e revelar fog: nada disso muda a
 * simulação, então não há detecção técnica possível nesta engine. A resposta é
 * replay + denúncia + olho humano — daí a denúncia apontar para a partida, e
 * esta tela dar o replay dela na mão.
 *
 * Resolver é definitivo do lado da API: a rota só aceita denúncia `aberta`, e a
 * segunda tentativa responde 404. Isso é o que impede dois admins
 * sobrescreverem a decisão um do outro em silêncio.
 */
import { onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { urlDoReplay } from "../api";
import { type Denuncia, dataHora, listarDenuncias, resolverDenuncia } from "../admin";

const ESTADOS = [
  { id: "aberta", label: "ABERTAS" },
  { id: "resolvida", label: "RESOLVIDAS" },
  { id: "rejeitada", label: "REJEITADAS" },
  { id: "", label: "TODAS" },
];

const denuncias = ref<Denuncia[]>([]);
const estado = ref("aberta");
const ocupado = ref(false);
const erro = ref("");
const aviso = ref("");

/** O texto da decisão, por denúncia — ele fica no registro, não só no Discord. */
const resolucoes = ref<Record<string, string>>({});

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

const recarregar = () =>
  tentar(async () => {
    denuncias.value = await listarDenuncias({ estado: estado.value || undefined, limit: 100 });
  });

onMounted(recarregar);

function filtrar(novo: string) {
  estado.value = novo;
  recarregar();
}

const resolver = (d: Denuncia, decisao: "resolvida" | "rejeitada") =>
  tentar(async () => {
    await resolverDenuncia(d.id, decisao, resolucoes.value[d.id] ?? "");
    aviso.value = `Denúncia contra ${d.denunciadoNickname} marcada como ${decisao}.`;
    delete resolucoes.value[d.id];
    await recarregar();
  });

/** Abre no navegador: a rota do replay é pública e não leva token nenhum. */
const abrirReplay = (matchId: string, parte: "rpl" | "bas") =>
  tentar(async () => {
    await openUrl(await urlDoReplay(matchId, parte));
  });
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Denúncias</h1>
        <p class="sub-tela">{{ denuncias.length }} na lista — as abertas vêm primeiro</p>
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
    <p v-if="aviso" class="aviso recado">{{ aviso }}</p>

    <p v-if="!denuncias.length" class="vazio">Nada nesta fila.</p>

    <div v-for="d in denuncias" :key="d.id" class="painel caso">
      <div class="cabeca">
        <div>
          <div class="quem">
            <span class="alvo">{{ d.denunciadoNickname }}</span>
            <span class="por">denunciado por {{ d.denuncianteNickname }}</span>
          </div>
          <div class="sub-linha">{{ dataHora(d.criadoEm) }}</div>
        </div>
        <span class="selo mono" :class="{ destaque: d.estado === 'aberta' }">
          {{ d.estado.toUpperCase() }}
        </span>
      </div>

      <p class="motivo">{{ d.motivo }}</p>

      <div class="partida">
        <template v-if="d.matchId">
          <span class="rotulo">PARTIDA {{ d.matchStatus?.toUpperCase() }}</span>
          <span class="sub-linha mono">{{ d.matchId }}</span>
          <span class="sub-linha">{{ dataHora(d.matchIniciadoEm) }}</span>
          <template v-if="d.replayCrc">
            <button class="btn-contorno" @click="abrirReplay(d.matchId, 'rpl')">
              BAIXAR O REPLAY (.rpl)
            </button>
            <button class="btn-contorno" @click="abrirReplay(d.matchId, 'bas')">
              E O SAVE INICIAL (.bas)
            </button>
          </template>
          <span v-else class="sub-linha">nenhum jogador enviou o replay desta partida</span>
        </template>
        <span v-else class="sub-linha">queixa sem partida: é conduta, não jogo.</span>
      </div>

      <div v-if="d.estado === 'aberta'" class="decisao">
        <textarea
          v-model="resolucoes[d.id]"
          class="campo"
          maxlength="2000"
          placeholder="o que você decidiu e por quê — fica no registro"
        />
        <div class="acoes-caso">
          <button class="btn-contorno ativo" :disabled="ocupado" @click="resolver(d, 'resolvida')">
            PROCEDE
          </button>
          <button class="btn-contorno" :disabled="ocupado" @click="resolver(d, 'rejeitada')">
            NÃO PROCEDE
          </button>
        </div>
      </div>

      <div v-else class="resolvida">
        <span class="rotulo">RESOLVIDA EM {{ dataHora(d.resolvidoEm) }}</span>
        <p class="motivo">{{ d.resolucao || "sem observação registrada." }}</p>
      </div>
    </div>
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
.caso {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cabeca {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.quem {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.alvo {
  font-family: var(--display);
  font-size: 16px;
  color: var(--pergaminho);
}
.por {
  font-size: 12.5px;
  font-style: italic;
  color: var(--calado-2);
}
.sub-linha {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
}
.motivo {
  margin: 0;
  font-size: 13px;
  color: var(--tenue);
  text-wrap: pretty;
  white-space: pre-wrap;
}
.partida {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 0;
  border-top: 1px solid var(--linha-tenue);
  border-bottom: 1px solid var(--linha-tenue);
}
.decisao {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.acoes-caso {
  display: flex;
  gap: 8px;
}
.resolvida {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
