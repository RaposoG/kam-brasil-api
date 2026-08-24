<script setup lang="ts">
import { computed, ref } from "vue";
import qrcode from "qrcode-generator";
import { montarPix } from "../pix";

/**
 * Tela de doação por Pix.
 *
 * O QR é gerado aqui, no cliente, a partir da chave. Nada de imagem pronta:
 * uma imagem teria que ser refeita à mão a cada troca de chave ou de valor, e
 * ninguém lembraria. Assim a chave está num lugar só, e o código sempre a
 * reflete.
 */

const CHAVE = "4fe5f6a8-7ad9-45ec-b88b-caeb8dcdbb29";
const NOME = "Gabriel Raposo";
const CIDADE = "Sao Paulo";

/** Sugestões, não obrigação — o campo livre é o que manda. */
const SUGESTOES = [10, 25, 50, 100];

const valor = ref<number | null>(null);
const livre = ref("");
const copiado = ref(false);

/** Vírgula é o separador natural em português; o Pix quer ponto. */
const valorEscolhido = computed(() => {
  if (valor.value) return valor.value;
  const n = Number(livre.value.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
});

const codigo = computed(() =>
  montarPix({ chave: CHAVE, nome: NOME, cidade: CIDADE, valor: valorEscolhido.value }),
);

/**
 * O QR como SVG, desenhado em caminhos.
 *
 * SVG e não imagem: escala sem borrar, herda a cor do tema, e não vira um
 * arquivo binário no repositório. O nível de correção "M" tolera ~15% de dano —
 * suficiente para leitura de tela, onde não há sujeira nem amassado.
 */
const svgQr = computed(() => {
  const qr = qrcode(0, "M");
  qr.addData(codigo.value);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
});

function escolher(v: number) {
  valor.value = valor.value === v ? null : v;
  livre.value = "";
}

function digitarLivre() {
  valor.value = null;
}

async function copiar() {
  try {
    await navigator.clipboard.writeText(codigo.value);
    copiado.value = true;
    setTimeout(() => (copiado.value = false), 2500);
  } catch {
    // Área de transferência bloqueada: o código está visível na tela, dá para
    // selecionar à mão. Silenciar é melhor que um erro que não ajuda em nada.
  }
}
</script>

<template>
  <!-- `tela` é a margem que todas as outras telas usam (theme.css). Sem ela,
       esta ficava colada na borda esquerda. -->
  <div class="tela doacoes">
    <header class="cabeca">
      <h2>Ajude o Kam Brasil a continuar</h2>
      <p>
        Este projeto é feito por gosto, nas horas vagas, e mantido por uma pessoa só. O servidor,
        o domínio e o tempo saem do bolso. Se o Kam Brasil te devolveu algumas boas partidas,
        qualquer valor ajuda a manter tudo de pé — e nada aqui é obrigatório: o jogo é e continua
        inteiro e gratuito para todo mundo.
      </p>
    </header>

    <div class="conteudo">
      <div class="qr-lado">
        <div class="qr" v-html="svgQr" />
        <p class="legenda">Aponte a câmera do seu banco</p>
      </div>

      <div class="controles">
        <p class="rotulo">Escolha um valor</p>
        <div class="valores">
          <button
            v-for="v in SUGESTOES"
            :key="v"
            class="valor"
            :class="{ ativo: valor === v }"
            @click="escolher(v)"
          >
            R$ {{ v }}
          </button>
        </div>

        <label class="campo">
          <span>ou digite o quanto quiser</span>
          <input
            v-model="livre"
            inputmode="decimal"
            placeholder="0,00"
            @input="digitarLivre"
          />
        </label>

        <p class="nota">
          Sem valor escolhido, o QR abre em branco e você digita direto no aplicativo do banco.
        </p>

        <div class="copiar">
          <p class="rotulo">Ou use o Pix copia e cola</p>
          <code class="codigo">{{ codigo }}</code>
          <button class="btn-copiar" @click="copiar">
            {{ copiado ? "Copiado!" : "Copiar código" }}
          </button>
        </div>

        <p class="chave">
          Chave Pix (aleatória): <code>{{ CHAVE }}</code>
        </p>
      </div>
    </div>

    <footer class="rodape">
      <p>
        Obrigado por jogar. De verdade — ver o servidor cheio já é o melhor retorno que este
        projeto podia ter.
      </p>
    </footer>
  </div>
</template>

<style scoped>
.doacoes {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 900px;
}

.cabeca h2 {
  margin: 0 0 0.6rem;
  font-family: var(--serif);
  font-size: 1.6rem;
  color: var(--gold);
}
.cabeca p {
  margin: 0;
  max-width: 62ch;
  line-height: 1.6;
  color: var(--parchment);
}

.conteudo {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  flex-wrap: wrap;
}

.qr-lado {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
}
/* Fundo branco não é escolha estética: leitor de QR precisa de contraste real,
   e código dourado sobre madeira falha em boa parte dos celulares. */
.qr {
  width: 220px;
  height: 220px;
  padding: 0.7rem;
  border-radius: 4px;
  background: #fff;
  border: 1px solid var(--gold-dim);
}
.qr :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.legenda {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.controles {
  flex: 1;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.rotulo {
  margin: 0;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.valores {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.valor {
  padding: 0.55rem 1rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--parchment);
  font: inherit;
  cursor: pointer;
}
.valor:hover {
  border-color: var(--gold-dim);
}
.valor.ativo {
  border-color: var(--gold);
  background: rgba(212, 162, 74, 0.14);
  color: var(--gold);
}

.campo {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.campo input {
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.25);
  color: var(--parchment);
  font: inherit;
  text-transform: none;
  letter-spacing: normal;
}
.campo input:focus {
  outline: none;
  border-color: var(--gold-dim);
}

.nota {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.copiar {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border);
}
.codigo {
  display: block;
  max-height: 4.5rem;
  overflow-y: auto;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.3);
  font-size: 0.68rem;
  line-height: 1.4;
  word-break: break-all;
  color: var(--muted);
}
.btn-copiar {
  align-self: flex-start;
  padding: 0.5rem 1rem;
  border: 1px solid var(--gold-dim);
  border-radius: 3px;
  background: transparent;
  color: var(--gold);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.btn-copiar:hover {
  background: rgba(212, 162, 74, 0.12);
}

.chave {
  margin: 0;
  font-size: 0.72rem;
  color: var(--muted);
}
.chave code {
  color: var(--parchment);
}

.rodape {
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.rodape p {
  margin: 0;
  font-size: 0.85rem;
  font-style: italic;
  color: var(--muted);
}
</style>
