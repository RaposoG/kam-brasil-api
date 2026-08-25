<script setup lang="ts">
/**
 * Catálogo global de mapas — a tela que decide o que TODO mundo baixa.
 *
 * O que entra aqui vira aviso no canal de tempo real e sincronia na pasta de
 * cada jogador (`src/mapas.ts`). Por isso o caminho normal é mandar a PASTA do
 * mapa: sem os arquivos no servidor, quem não tiver o mapa entra na sala
 * ranqueada e fica olhando uma barra de download em 0 kb — o servidor impõe o
 * mapa e bloqueia o repasse do host.
 *
 * O CRC nunca é digitado quando dá para lê-lo: são os primeiros 4 bytes do
 * `.mi` que o jogo escreve na pasta do mapa. CRC errado no catálogo faz o
 * servidor anunciar um número que o cliente recusa.
 */
import { computed, onMounted, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import type { RankedMode } from "../api";
import {
  MODOS,
  type MapaDoCatalogo,
  type PastaDeMapa,
  criarMapa,
  editarMapa,
  enviarPastaDeMapa,
  lerPastaDeMapa,
  listarMapas,
  removerMapa,
  tamanho,
} from "../admin";
import { pastaJogo } from "../install";

const mapas = ref<MapaDoCatalogo[]>([]);
const carregando = ref(false);
const ocupado = ref(false);
const erro = ref("");
const aviso = ref("");

/** A pasta escolhida no disco, já lida pelo Rust. `null` = nenhuma. */
const pasta = ref<PastaDeMapa | null>(null);
const crcDigitado = ref("");
const modosNovos = ref<RankedMode[]>(["1v1"]);
/** O que o servidor devolveu no último envio — CRC não conferido, divergente. */
const avisos = ref<string[]>([]);

/** Remover é em dois cliques: o primeiro arma, o segundo executa. */
const confirmando = ref("");

const crcEscolhido = computed(() =>
  (pasta.value?.crc ?? crcDigitado.value).trim().toUpperCase(),
);

const crcValido = computed(() => /^[0-9A-F]{8}$/.test(crcEscolhido.value));

async function recarregar() {
  carregando.value = true;
  try {
    mapas.value = await listarMapas();
  } catch (e) {
    erro.value = String(e);
  } finally {
    carregando.value = false;
  }
}

onMounted(recarregar);

/** Toda ação do painel passa por aqui: ou aparece o resultado, ou o erro. */
async function tentar(acao: () => Promise<void>) {
  erro.value = "";
  aviso.value = "";
  avisos.value = [];
  ocupado.value = true;
  try {
    await acao();
  } catch (e) {
    erro.value = String(e);
  } finally {
    ocupado.value = false;
  }
}

async function escolherPasta() {
  const escolha = await open({
    directory: true,
    multiple: false,
    title: "Escolha a pasta do mapa",
    // Começa em MapsMP: é onde estão os mapas que o jogo já reconhece, e onde
    // o `.mi` com o CRC existe de verdade.
    defaultPath: pastaJogo.value ? `${pastaJogo.value}\\MapsMP` : undefined,
  });
  if (typeof escolha !== "string") return;

  await tentar(async () => {
    pasta.value = await lerPastaDeMapa(escolha);
    crcDigitado.value = "";
  });
}

function alternarModoNovo(modo: RankedMode) {
  modosNovos.value = modosNovos.value.includes(modo)
    ? modosNovos.value.filter((m) => m !== modo)
    : MODOS.filter((m) => m === modo || modosNovos.value.includes(m));
}

const enviarTudo = () =>
  tentar(async () => {
    const alvo = pasta.value;
    if (!alvo) return;
    if (!modosNovos.value.length) throw new Error("marque ao menos um modo para o mapa");
    if (!alvo.crc && !crcValido.value) {
      throw new Error("sem o cache .mi na pasta, o CRC precisa ser digitado (8 dígitos hexadecimais)");
    }

    // O CRC digitado só é usado quando a pasta não tem `.mi`: do outro lado, o
    // lido sempre tem precedência, e é assim que tem que ser.
    const envio = await enviarPastaDeMapa(
      alvo.pasta,
      modosNovos.value,
      alvo.crc ? undefined : crcEscolhido.value,
    );
    aviso.value = `"${alvo.nome}" entrou no catálogo com ${envio.arquivos} arquivo(s), CRC ${envio.map.mapCrc}. Os launchers abertos recebem o aviso e baixam sozinhos.`;
    avisos.value = envio.avisos ?? [];
    pasta.value = null;
    await recarregar();
  });

/**
 * Cadastra só a linha do catálogo, sem arquivo nenhum.
 *
 * Vale para o mapa que já viaja dentro da release do jogo — todo mundo já o
 * tem no disco. Para um mapa novo isto não basta, e a tela avisa.
 */
const cadastrarSoCrc = () =>
  tentar(async () => {
    const alvo = pasta.value;
    if (!alvo) return;
    if (!modosNovos.value.length) throw new Error("marque ao menos um modo para o mapa");
    if (!crcValido.value) throw new Error("o CRC tem 8 dígitos hexadecimais (exemplo: 80059674)");

    await criarMapa({ nome: alvo.nome, mapCrc: crcEscolhido.value, modos: modosNovos.value });
    aviso.value = `"${alvo.nome}" entrou no catálogo só com o CRC — nenhum arquivo subiu, então isto só funciona para quem já tem o mapa.`;
    pasta.value = null;
    await recarregar();
  });

const alternarModo = (mapa: MapaDoCatalogo, modo: RankedMode) =>
  tentar(async () => {
    const modos = mapa.modos.includes(modo)
      ? mapa.modos.filter((m) => m !== modo)
      : MODOS.filter((m) => m === modo || mapa.modos.includes(m));
    if (!modos.length) throw new Error("um mapa precisa valer em pelo menos um modo");

    await editarMapa(mapa.id, { modos });
    await recarregar();
  });

const alternarAtivo = (mapa: MapaDoCatalogo) =>
  tentar(async () => {
    await editarMapa(mapa.id, { ativo: !mapa.ativo });
    await recarregar();
  });

function remover(mapa: MapaDoCatalogo) {
  if (confirmando.value !== mapa.id) {
    confirmando.value = mapa.id;
    return;
  }
  confirmando.value = "";
  tentar(async () => {
    const saida = await removerMapa(mapa.id);
    aviso.value = saida.historico
      ? `"${mapa.nome}" saiu do catálogo, mas a linha ficou: ele já apareceu em ${saida.partidas} partida(s) e apagá-la levaria o nome do mapa do histórico junto.`
      : `"${mapa.nome}" saiu do catálogo. Quem o tiver instalado por aqui vai perdê-lo na próxima sincronia.`;
    await recarregar();
  });
}

const origem = (mapa: MapaDoCatalogo) =>
  mapa.crcVerificado === undefined ? "—" : mapa.crcVerificado ? "lido do .mi" : "digitado";

const quantosArquivos = (mapa: MapaDoCatalogo) => mapa.arquivos?.length;
</script>

<template>
  <div class="tela">
    <div class="cabecalho-tela">
      <div>
        <h1 class="titulo-tela">Catálogo de mapas</h1>
        <p class="sub-tela">
          {{ mapas.length }} mapas — o que está aqui é o que todos os jogadores recebem
        </p>
      </div>
      <button class="btn-contorno" :disabled="carregando" @click="recarregar()">ATUALIZAR</button>
    </div>

    <div class="painel adicionar">
      <div class="linha-topo">
        <span class="rotulo">ADICIONAR MAPA</span>
        <button class="btn-contorno" :disabled="ocupado" @click="escolherPasta()">
          ESCOLHER A PASTA DO MAPA
        </button>
      </div>

      <p v-if="!pasta" class="dica">
        Escolha a pasta do mapa (a pasta inteira, com o <span class="mono">.dat</span> e o
        <span class="mono">.map</span> dentro). O nome do mapa é o nome da pasta, e o CRC sai do
        <span class="mono">.mi</span> que o jogo gera — ninguém precisa digitar número nenhum.
      </p>

      <div v-else class="escolhida">
        <div class="cabeca-mapa">
          <div>
            <div class="nome-mapa">{{ pasta.nome }}</div>
            <div class="caminho mono">{{ pasta.pasta }}</div>
          </div>
          <div class="crc-bloco">
            <span v-if="pasta.crc" class="selo destaque mono">CRC {{ pasta.crc }}</span>
            <span v-else class="selo mono">SEM .mi</span>
            <span class="crc-nota">{{
              pasta.crc
                ? "lido do cache do jogo"
                : "abra o mapa no jogo uma vez para gerar o cache, ou digite o CRC"
            }}</span>
          </div>
        </div>

        <label v-if="!pasta.crc" class="rotulo-campo crc-manual">
          CRC DO MAPA (8 DÍGITOS HEXADECIMAIS)
          <input v-model="crcDigitado" class="campo mono" maxlength="8" placeholder="80059674" />
        </label>

        <div class="opcoes">
          <div class="grupo-opcao">
            <span class="rotulo">MODOS</span>
            <div class="modos">
              <button
                v-for="m in MODOS"
                :key="m"
                class="filtro"
                :class="{ ativo: modosNovos.includes(m) }"
                @click="alternarModoNovo(m)"
              >
                {{ m.toUpperCase() }}
              </button>
            </div>
          </div>
        </div>

        <div class="arquivos">
          <span class="rotulo">
            {{ pasta.arquivos.length }} ARQUIVOS · {{ tamanho(pasta.totalBytes) }}
          </span>
          <ul>
            <li v-for="a in pasta.arquivos" :key="a.caminho">
              <span class="mono">{{ a.caminho }}</span>
              <span class="bytes mono">{{ tamanho(a.bytes) }}</span>
            </li>
          </ul>
        </div>

        <div class="botoes">
          <button class="btn-contorno ativo" :disabled="ocupado" @click="enviarTudo()">
            ENVIAR A PASTA E CADASTRAR
          </button>
          <button class="btn-contorno" :disabled="ocupado || !crcValido" @click="cadastrarSoCrc()">
            CADASTRAR SÓ O CRC
          </button>
          <button class="btn-contorno" :disabled="ocupado" @click="pasta = null">CANCELAR</button>
        </div>
        <p class="dica">
          "Só o CRC" não sobe arquivo nenhum: serve para o mapa que já vem dentro da release do
          jogo. Mapa novo precisa da pasta, senão quem não tem o mapa não consegue baixá-lo.
          Reenviar a mesma pasta atualiza o mapa no catálogo, e o mapa nasce ativo.
        </p>
      </div>

      <p v-if="erro" class="erro">{{ erro }}</p>
      <p v-if="aviso" class="aviso">{{ aviso }}</p>
      <p v-for="(a, i) in avisos" :key="i" class="erro">{{ a }}</p>
    </div>

    <p v-if="!mapas.length && !carregando" class="vazio">
      Nenhum mapa no catálogo ainda. O primeiro que entrar aqui já vai para todo mundo.
    </p>

    <table v-else class="tabela catalogo">
      <thead>
        <tr>
          <th>MAPA</th>
          <th>CRC</th>
          <th>ORIGEM DO CRC</th>
          <th>MODOS</th>
          <th>ESTADO</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in mapas" :key="m.id">
          <td>
            <div class="nome-linha">{{ m.nome }}</div>
            <div v-if="quantosArquivos(m) === 0" class="alerta-linha">
              sem arquivos no servidor — só quem já tem o mapa consegue jogar
            </div>
            <div v-else-if="quantosArquivos(m)" class="sub-linha">
              {{ quantosArquivos(m) }} arquivos
            </div>
          </td>
          <td class="mono">{{ m.mapCrc }}</td>
          <td class="sub-linha">{{ origem(m) }}</td>
          <td>
            <div class="modos">
              <button
                v-for="modo in MODOS"
                :key="modo"
                class="filtro"
                :class="{ ativo: m.modos.includes(modo) }"
                :disabled="ocupado"
                @click="alternarModo(m, modo)"
              >
                {{ modo.toUpperCase() }}
              </button>
            </div>
          </td>
          <td>
            <button
              class="filtro"
              :class="{ ativo: m.ativo }"
              :disabled="ocupado"
              @click="alternarAtivo(m)"
            >
              {{ m.ativo ? "ATIVO" : "INATIVO" }}
            </button>
          </td>
          <td>
            <div class="acoes">
              <button
                class="btn-contorno perigo"
                :disabled="ocupado"
                @click="remover(m)"
                @blur="confirmando = ''"
              >
                {{ confirmando === m.id ? "CONFIRMAR?" : "REMOVER" }}
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.adicionar {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.linha-topo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.dica {
  margin: 0;
  font-size: 12.5px;
  color: var(--calado-2);
  text-wrap: pretty;
}
.escolhida {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--linha-fraca);
}
.cabeca-mapa {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.nome-mapa {
  font-family: var(--display);
  font-size: 16px;
  color: var(--pergaminho);
}
.caminho {
  font-size: 10px;
  color: var(--calado-3);
  margin-top: 3px;
  word-break: break-all;
}
.crc-bloco {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}
.crc-nota {
  font-size: 10.5px;
  font-style: italic;
  color: var(--calado-2);
}
.crc-manual {
  max-width: 260px;
}
.opcoes {
  display: flex;
  gap: 28px;
}
.grupo-opcao {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.modos {
  display: flex;
  gap: 2px;
}
.arquivos ul {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  max-height: 160px;
  overflow-y: auto;
}
.arquivos li {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 3px 0;
  font-size: 11px;
  color: var(--calado);
}
.bytes {
  flex: none;
  color: var(--calado-3);
}
.botoes {
  display: flex;
  gap: 8px;
}
.catalogo {
  margin-top: 22px;
}
.nome-linha {
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
}
.sub-linha {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
}
.alerta-linha {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--vermelho);
}
</style>
