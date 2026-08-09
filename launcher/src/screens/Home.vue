<script setup lang="ts">
import { computed } from "vue";
import {
  acaoPrincipal,
  atualizandoLauncher,
  atualizarLauncher,
  busy,
  check,
  erro,
  launcherNova,
  launcherPercent,
  rotuloAcao,
  status,
  versaoInstalada,
} from "../install";
import { NOTICIAS_CURTAS, ONLINE, PARTIDAS, montarRelatorio } from "../mock";

const emit = defineEmits<{ ir: [tela: string] }>();

const revisao = computed(() => {
  const v = versaoInstalada.value;
  if (!v) return "jogo ainda não instalado";
  const rev = check.value?.latest?.gameRevision;
  return rev ? `v${v} · ${rev}` : `v${v}`;
});

// Números da última partida derivados do mesmo relatório que a tela de
// Partidas mostra — cravar valores diferentes aqui faria a Home mentir.
const ultima = PARTIDAS[0];
const rel = montarRelatorio(ultima.id);
const resumo = ["recursos", "casas", "perdas", "apm"].map((id) => {
  const m = rel.comparativo.find((c) => c.id === id)!;
  return { valor: m.voce, label: m.rotulo === "PERDAS" ? "MORTES" : m.rotulo };
});
</script>

<template>
  <div>
    <!-- Atualização do próprio launcher acima de tudo: quem está com uma versão
         velha pode estar com um bug já corrigido. -->
    <section v-if="launcherNova" class="faixa-launcher">
      <template v-if="atualizandoLauncher">
        <strong>Atualizando o launcher…</strong>
        <div class="barra-prog cresce"><i :style="{ width: launcherPercent + '%' }" /></div>
        <span class="nota">Ele vai reiniciar sozinho ao terminar.</span>
      </template>
      <template v-else>
        <strong>Nova versão do launcher: {{ launcherNova }}</strong>
        <button class="btn-contorno" @click="atualizarLauncher">ATUALIZAR AGORA</button>
      </template>
    </section>

    <div class="heroi">
      <div class="veu" />
      <div class="marca-arte">[ arte / screenshot do jogo ]</div>

      <div class="frente">
        <div>
          <div class="sobre-titulo">COMUNIDADE BRASILEIRA · KNIGHTS AND MERCHANTS</div>
          <h1 class="lema">A Rebelião<br /><span>dos Camponeses</span></h1>
          <div class="linha-acao">
            <button class="btn-ouro" :disabled="busy || status.acao === 'semVersao'" @click="acaoPrincipal()">
              {{ rotuloAcao }}
            </button>
            <div class="estado">
              <span class="estado-curto">● {{ status.curto }}</span>
              <span class="estado-rev">{{ revisao }}</span>
            </div>
          </div>
        </div>

        <div class="online">
          <div class="rotulo">ONLINE AGORA</div>
          <div class="online-num">
            <span class="numero">{{ ONLINE.jogadores }}</span>
            <span class="unidade">jogadores</span>
          </div>
          <div class="risco" />
          <div class="online-linha"><span>Partidas abertas</span><span>{{ ONLINE.abertas }}</span></div>
          <div class="online-linha"><span>Em disputa</span><span>{{ ONLINE.disputa }}</span></div>
        </div>
      </div>
    </div>

    <div class="faixa-status">
      <span class="status-titulo">{{ status.titulo }}</span>
      <div class="barra-prog cresce" :class="{ indeterminada: status.indeterminado }">
        <i :style="{ width: status.indeterminado ? undefined : status.pct + '%' }" />
      </div>
      <span class="status-detalhe">{{ status.detalhe }}</span>
    </div>

    <p v-if="erro" class="erro faixa-erro">{{ erro }}</p>

    <div class="grade">
      <div class="carta ultima">
        <div class="canto" />
        <div class="rotulo carta-rotulo">ÚLTIMA PARTIDA</div>
        <div class="ultima-cabeca">
          <span class="veredito" :style="{ color: rel.partidaCor }">
            {{ ultima.venceu ? "VITÓRIA" : "DERROTA" }}
          </span>
          <span class="quando">{{ ultima.quando }}</span>
        </div>
        <div class="ultima-sub">{{ ultima.mapa }} · {{ ultima.modo }} · {{ ultima.dur }}</div>

        <div class="numeros">
          <div v-for="r in resumo" :key="r.label">
            <div class="numero-valor">{{ r.valor }}</div>
            <div class="numero-label">{{ r.label }}</div>
          </div>
        </div>

        <button class="btn-carta relatorio" @click="emit('ir', 'partidas')">
          VER RELATÓRIO COMPLETO
        </button>
      </div>

      <div class="painel">
        <div class="noticias-cabeca">
          <span class="rotulo">NOTÍCIAS DO REINO</span>
          <button class="todas" @click="emit('ir', 'noticias')">TODAS →</button>
        </div>
        <div v-for="n in NOTICIAS_CURTAS" :key="n.titulo" class="noticia">
          <div class="noticia-data">{{ n.data }}</div>
          <div class="noticia-corpo">
            <div class="noticia-titulo">{{ n.titulo }}</div>
            <div class="noticia-resumo">{{ n.resumo }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.faixa-launcher {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 24px;
  border-bottom: 1px solid var(--bronze);
  background: rgba(212, 162, 74, 0.08);
  font-size: 12.5px;
}
.faixa-launcher strong {
  font-weight: 600;
  color: var(--pergaminho);
}
.faixa-launcher .nota {
  color: var(--calado);
  font-size: 12px;
}
.cresce {
  flex: 1;
}

/* --- herói --- */
.heroi {
  position: relative;
  height: 344px;
  border-bottom: 1px solid var(--linha);
  background: var(--heroi);
  /* Hachura diagonal no lugar de imagem: a arte definitiva entra trocando este
     background por um <img>, sem mexer no resto do bloco. */
  background-image: repeating-linear-gradient(135deg, rgba(232, 220, 200, 0.045) 0 2px, transparent 2px 9px);
  overflow: hidden;
}
.veu {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(20, 16, 13, 0.15) 0%,
    rgba(20, 16, 13, 0.55) 55%,
    rgba(20, 16, 13, 0.95) 100%
  );
}
.marca-arte {
  position: absolute;
  top: 16px;
  left: 20px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: rgba(232, 220, 200, 0.4);
}
.frente {
  position: absolute;
  left: 40px;
  bottom: 38px;
  right: 40px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
}
.sobre-titulo {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.24em;
  color: var(--calado);
  margin-bottom: 10px;
}
.lema {
  margin: 0;
  font-family: var(--display);
  font-size: 44px;
  line-height: 1;
  font-weight: 700;
  color: var(--pergaminho);
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
}
.lema span {
  color: var(--ouro);
}
.linha-acao {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 18px;
}
.estado {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}
.estado-curto {
  color: var(--verde);
}
.estado-rev {
  color: var(--calado-2);
}

.online {
  width: 236px;
  flex: none;
  padding: 16px;
  background: rgba(24, 19, 16, 0.86);
  border: 1px solid var(--linha);
  box-shadow: inset 0 1px 0 rgba(212, 162, 74, 0.1);
}
.online-num {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 12px;
}
.numero {
  font-family: var(--display);
  font-size: 34px;
  font-weight: 700;
  color: var(--ouro);
}
.unidade {
  font-size: 12px;
  color: var(--calado);
}
.risco {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--linha), transparent);
  margin: 13px 0;
}
.online-linha {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--calado);
  margin-bottom: 6px;
}
.online-linha:last-child {
  margin-bottom: 0;
}
.online-linha span:last-child {
  color: var(--pergaminho);
}

/* --- faixa de status --- */
.faixa-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 11px 24px;
  background: var(--barra);
  border-bottom: 1px solid var(--linha);
}
.status-titulo {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: 0.14em;
  color: var(--pergaminho);
  flex: none;
}
.status-detalhe {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--calado);
  flex: none;
}
.faixa-erro {
  padding: 10px 24px;
  border-bottom: 1px solid var(--linha);
}

/* --- grade inferior --- */
.grade {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  padding: 24px;
}

.ultima {
  position: relative;
  padding: 20px 22px;
  box-shadow:
    0 10px 26px rgba(0, 0, 0, 0.45),
    inset 0 0 60px rgba(150, 120, 70, 0.14);
}
.canto {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 6px;
  height: 6px;
  background: var(--carta-borda);
  transform: rotate(45deg);
}
.carta-rotulo {
  color: var(--carta-calado);
}
.ultima-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 9px;
}
.veredito {
  font-family: var(--display);
  font-size: 23px;
  font-weight: 700;
}
.quando {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--carta-calado);
}
.ultima-sub {
  font-size: 13px;
  color: var(--carta-tinta-3);
  font-style: italic;
  margin-top: 2px;
}
.numeros {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(90, 72, 48, 0.3);
}
.numero-valor {
  font-family: var(--display);
  font-size: 18px;
  font-weight: 600;
}
.numero-label {
  font-family: var(--mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--carta-calado);
}
.relatorio {
  margin-top: 16px;
}

.noticias-cabeca {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.todas {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ouro-medio);
}
.todas:hover {
  color: var(--ouro-claro);
}
.noticia {
  display: flex;
  gap: 14px;
  padding: 13px 0;
  border-bottom: 1px solid var(--linha-fraca);
}
.noticia:last-child {
  border-bottom: none;
}
.noticia-data {
  width: 44px;
  flex: none;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--calado-3);
  padding-top: 3px;
}
.noticia-corpo {
  min-width: 0;
}
.noticia-titulo {
  font-family: var(--display);
  font-size: 13px;
  color: var(--pergaminho);
}
.noticia-resumo {
  font-size: 12.5px;
  color: var(--calado);
  line-height: 1.45;
  text-wrap: pretty;
}
</style>
