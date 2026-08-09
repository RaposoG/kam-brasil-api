<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  type ChatMessage,
  type FriendsList,
  chatFetch,
  chatSend,
  fetchStats,
  friendAdd,
  friendRespond,
  friendsList,
  tempoRelativo,
} from "./api";

// --- camaradas ---

const lista = ref<FriendsList>({ friends: [], incoming: [], outgoing: [] });
const falando = ref<number | null>(null);
const convite = ref("");
const erroConvite = ref("");
const convidando = ref(false);

const onlineCount = computed(() => lista.value.friends.filter((f) => f.online).length);
const semNinguem = computed(
  () => !lista.value.friends.length && !lista.value.incoming.length && !lista.value.outgoing.length,
);

// Falha de rede não derruba o dock: fica o último estado conhecido na tela.
async function pollAmigos() {
  try {
    lista.value = await friendsList();
  } catch {}
  try {
    falando.value = (await fetchStats()).launcherOnline;
  } catch {}
}

async function convidar() {
  const nick = convite.value.trim();
  if (!nick || convidando.value) return;
  convidando.value = true;
  erroConvite.value = "";
  try {
    await friendAdd(nick);
    convite.value = "";
    await pollAmigos();
  } catch (e) {
    erroConvite.value = String(e);
  } finally {
    convidando.value = false;
  }
}

async function responder(friendshipId: string, aceitar: boolean) {
  erroConvite.value = "";
  try {
    await friendRespond(friendshipId, aceitar);
  } catch (e) {
    erroConvite.value = String(e);
  }
  await pollAmigos();
}

const inicialDe = (nome: string) => nome.charAt(0).toUpperCase();

const estadoDe = (f: FriendsList["friends"][number]) =>
  f.online ? "ONLINE" : f.lastSeenAt ? `visto ${tempoRelativo(f.lastSeenAt)}` : "nunca visto";

// --- taverna ---

const mensagens = ref<ChatMessage[]>([]);
const texto = ref("");
const erroChat = ref("");
const enviando = ref(false);
const caixaMsgs = ref<HTMLElement | null>(null);

// Cursor do poll: só pedimos o que ainda não vimos. O id é bigserial na API.
let cursor: number | null = null;

// Os polls são SERIALIZADOS: o interval de 5 s e o poll pós-envio podiam se
// sobrepor com o mesmo cursor (ele só avança quando a resposta chega), e as
// duas respostas traziam conjuntos repetidos — mensagem duplicada na tela e
// :key duplicada no v-for. Enfileirar em vez de pular mantém o pós-envio
// trazendo a própria mensagem na hora.
let fila: Promise<void> = Promise.resolve();
function pollChat(forcarScroll = false): Promise<void> {
  fila = fila.then(() => pollChatAgora(forcarScroll)).catch(() => {});
  return fila;
}

async function pollChatAgora(forcarScroll: boolean) {
  let recebidas: ChatMessage[];
  try {
    recebidas = await chatFetch(cursor ?? undefined);
  } catch {
    return;
  }
  // Cinto além da fila: nunca aplicar o que já está na tela nem regredir o cursor.
  const novas = cursor === null ? recebidas : recebidas.filter((m) => m.id > (cursor as number));
  if (!novas.length) return;
  cursor = Math.max(cursor ?? 0, novas[novas.length - 1].id);

  // Só arrastamos a rolagem se o jogador já estava no fim — quem subiu para
  // ler o histórico não pode ser puxado de volta a cada mensagem nova.
  const el = caixaMsgs.value;
  const estavaNoFim = forcarScroll || !el || el.scrollHeight - el.scrollTop - el.clientHeight < 32;

  // ponytail: cap de 200 no cliente; histórico completo fica no servidor
  mensagens.value = [...mensagens.value, ...novas].slice(-200);

  if (estavaNoFim) {
    await nextTick();
    caixaMsgs.value?.scrollTo({ top: caixaMsgs.value.scrollHeight });
  }
}

async function enviar() {
  const corpo = texto.value.trim();
  if (!corpo || enviando.value) return;
  enviando.value = true;
  erroChat.value = "";
  try {
    await chatSend(corpo);
    texto.value = "";
    // O poll traz a própria mensagem (e o que chegou junto dela) já com id.
    await pollChat(true);
  } catch (e) {
    erroChat.value = String(e);
  } finally {
    enviando.value = false;
  }
}

const horaFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const hora = (iso: string) => horaFmt.format(new Date(iso));

// --- ciclo de vida ---

let tAmigos = 0;
let tChat = 0;

onMounted(() => {
  pollAmigos();
  pollChat(true);
  tAmigos = window.setInterval(pollAmigos, 30_000);
  tChat = window.setInterval(() => pollChat(), 5_000);
});

onUnmounted(() => {
  clearInterval(tAmigos);
  clearInterval(tChat);
});
</script>

<template>
  <aside class="dock">
    <div class="cabeca">
      <span class="titulo-dock">CAMARADAS</span>
      <span class="contagem">{{ onlineCount }} DE {{ lista.friends.length }} ONLINE</span>
    </div>

    <div class="amigos">
      <div v-if="semNinguem" class="vazio">
        nenhum camarada ainda — convide alguém pelo apelido, logo abaixo.
      </div>

      <div v-for="p in lista.incoming" :key="p.friendshipId" class="amigo">
        <div class="escudo cara"><span>{{ inicialDe(p.nickname) }}</span></div>
        <div class="quem">
          <div class="amigo-nome">{{ p.nickname }}</div>
          <div class="amigo-estado pendente">QUER SER SEU CAMARADA</div>
        </div>
        <button class="acao aceitar" title="aceitar" @click="responder(p.friendshipId, true)">✓</button>
        <button class="acao recusar" title="recusar" @click="responder(p.friendshipId, false)">✕</button>
      </div>

      <div v-for="a in lista.friends" :key="a.friendshipId" class="amigo">
        <div class="escudo cara"><span>{{ inicialDe(a.nickname) }}</span></div>
        <div class="quem">
          <div class="amigo-nome">{{ a.nickname }}</div>
          <div class="amigo-estado" :class="a.online ? 'on' : 'off'">
            <i v-if="a.online" class="ponto" />{{ estadoDe(a) }}
          </div>
        </div>
      </div>

      <div v-for="p in lista.outgoing" :key="p.friendshipId" class="amigo">
        <div class="escudo cara"><span>{{ inicialDe(p.nickname) }}</span></div>
        <div class="quem">
          <div class="amigo-nome">{{ p.nickname }}</div>
          <div class="amigo-estado pendente">AGUARDANDO RESPOSTA</div>
        </div>
      </div>
    </div>

    <div class="convidar">
      <div class="entrada">
        <span class="chevron">+</span>
        <input
          v-model="convite"
          placeholder="convidar por apelido…"
          @keydown.enter="convidar"
        />
        <button class="mandar" :disabled="convidando" @click="convidar">CONVIDAR</button>
      </div>
      <p v-if="erroConvite" class="erro erro-dock">{{ erroConvite }}</p>
    </div>

    <div class="taverna">
      <div class="cabeca compacta">
        <span class="titulo-dock">TAVERNA</span>
        <span class="falando">● {{ falando ?? "—" }} FALANDO</span>
      </div>

      <div ref="caixaMsgs" class="mensagens">
        <div v-if="!mensagens.length" class="vazio">
          a taverna está silenciosa… puxe o primeiro assunto.
        </div>
        <div v-for="c in mensagens" :key="c.id">
          <div class="autor-linha">
            <span class="autor">{{ c.nickname }}</span>
            <span class="hora">{{ hora(c.at) }}</span>
          </div>
          <div class="texto">{{ c.body }}</div>
        </div>
      </div>

      <div class="caixa">
        <div class="entrada">
          <span class="chevron">›</span>
          <input
            v-model="texto"
            placeholder="dizer algo na taverna…"
            :disabled="enviando"
            @keydown.enter="enviar"
          />
          <button class="mandar" :disabled="enviando" @click="enviar">›</button>
        </div>
        <p v-if="erroChat" class="erro erro-dock">{{ erroChat }}</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.dock {
  display: flex;
  flex-direction: column;
  background: var(--lateral);
  border-left: 1px solid var(--linha);
  min-height: 0;
}
.cabeca {
  padding: 16px 18px 13px;
  border-bottom: 1px solid var(--linha-fraca);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.cabeca.compacta {
  padding: 13px 18px 9px;
  border-bottom: none;
}
.titulo-dock {
  font-family: var(--display);
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--pergaminho);
}
.contagem {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--calado-3);
}
.falando {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--verde);
  animation: kbpulse 2.4s ease-in-out infinite;
}

.vazio {
  padding: 14px 18px;
  font-size: 12px;
  font-style: italic;
  color: var(--calado-2);
  text-wrap: pretty;
}

.amigos {
  max-height: 296px;
  overflow-y: auto;
}
.amigo {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--linha-tenue);
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
  min-width: 0;
  flex: 1;
}
.amigo-nome {
  font-size: 12.5px;
  color: var(--pergaminho);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.amigo-estado {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 5px;
}
.amigo-estado.on {
  color: var(--verde);
}
.amigo-estado.off {
  color: var(--calado-2);
}
.amigo-estado.pendente {
  color: var(--ouro-medio);
}
.ponto {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--verde);
  flex: none;
}
.acao {
  flex: none;
  width: 22px;
  height: 22px;
  border: 1px solid var(--linha);
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
}
.acao.aceitar {
  color: var(--verde);
}
.acao.aceitar:hover {
  border-color: var(--verde-fundo);
  background: rgba(148, 185, 111, 0.08);
}
.acao.recusar {
  color: var(--vermelho);
}
.acao.recusar:hover {
  border-color: var(--vermelho-fundo);
  background: rgba(208, 130, 114, 0.08);
}

.convidar {
  padding: 10px 18px 12px;
  border-bottom: 1px solid var(--linha-fraca);
}

.taverna {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--linha);
}
.mensagens {
  flex: 1;
  overflow-y: auto;
  padding: 0 18px 10px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-height: 0;
}
.autor-linha {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.autor {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ouro-claro);
}
.hora {
  font-family: var(--mono);
  font-size: 8.5px;
  color: var(--calado-4);
}
.texto {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--tenue);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.caixa {
  padding: 11px 18px 14px;
  border-top: 1px solid var(--linha-fraca);
}
.entrada {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 11px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--linha);
}
.chevron {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--calado-4);
}
.entrada input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 12.5px;
  color: var(--pergaminho);
}
.entrada input::placeholder {
  color: var(--calado-3);
  font-style: italic;
}
.entrada input:focus {
  outline: none;
}
.mandar {
  flex: none;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ouro-medio);
}
.mandar:hover:not(:disabled) {
  color: var(--ouro-claro);
}
.mandar:disabled {
  opacity: 0.5;
}
.erro-dock {
  margin-top: 7px;
  font-size: 11.5px;
}
</style>
