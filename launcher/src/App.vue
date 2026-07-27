<script setup lang="ts">
import { onMounted, ref } from "vue";
import Play from "./Play.vue";
import { type Account, apiBase, login, logout, register, restoreSession } from "./api";

type Mode = "login" | "register";

const account = ref<Account | null>(null);
const mode = ref<Mode>("login");
const busy = ref(false);
const booting = ref(true);
const error = ref("");
const notice = ref("");
const base = ref("");

const form = ref({ login: "", email: "", nickname: "", password: "" });

onMounted(async () => {
  base.value = await apiBase();
  try {
    account.value = await restoreSession();
  } catch (e) {
    // API fora do ar na abertura nao deve travar o launcher numa tela de erro:
    // cai para o formulario e o usuario tenta quando quiser.
    error.value = String(e);
  } finally {
    booting.value = false;
  }
});

function switchMode(to: Mode) {
  mode.value = to;
  error.value = "";
  notice.value = "";
}

async function onSubmit() {
  error.value = "";
  notice.value = "";
  busy.value = true;
  try {
    if (mode.value === "login") {
      // O componente Play monta depois do login e verifica tudo sozinho.
      account.value = await login(form.value.login, form.value.password);
    } else {
      await register(form.value.email, form.value.nickname, form.value.password);
      notice.value = "Conta criada! Agora e so entrar.";
      form.value.login = form.value.nickname;
      mode.value = "login";
    }
    form.value.password = "";
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onLogout() {
  busy.value = true;
  try {
    await logout();
    account.value = null;
    form.value = { login: "", email: "", nickname: "", password: "" };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="app">
    <header class="brand">
      <h1>Kam Brasil</h1>
      <p class="tagline">Knights and Merchants · comunidade brasileira</p>
      <p v-if="base.includes('localhost')" class="dev">API local · {{ base }}</p>
    </header>

    <section v-if="booting" class="card center">
      <p class="muted">Restaurando sessão…</p>
    </section>

    <section v-else-if="account" class="card wide">
      <div class="account">
        <div>
          <p class="welcome">{{ account.nickname }}</p>
          <p class="muted small">{{ account.email }}</p>
        </div>
        <button class="link" :disabled="busy" @click="onLogout">Sair</button>
      </div>

      <hr />

      <Play />
    </section>

    <section v-else class="card">
      <nav class="tabs">
        <button :class="{ active: mode === 'login' }" @click="switchMode('login')">Entrar</button>
        <button :class="{ active: mode === 'register' }" @click="switchMode('register')">Criar conta</button>
      </nav>

      <form @submit.prevent="onSubmit">
        <label v-if="mode === 'login'">
          Email ou nickname
          <input v-model="form.login" required autocomplete="username" />
        </label>

        <template v-else>
          <label>
            Email
            <input v-model="form.email" type="email" required autocomplete="email" />
          </label>
          <label>
            Nickname
            <input
              v-model="form.nickname"
              required
              minlength="3"
              maxlength="16"
              pattern="[A-Za-z0-9_\-]+"
              title="3 a 16 caracteres: letras, números, _ e -"
              autocomplete="nickname"
            />
          </label>
        </template>

        <label>
          Senha
          <input
            v-model="form.password"
            type="password"
            required
            minlength="8"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          />
        </label>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="notice" class="notice">{{ notice }}</p>

        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta" }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.app {
  /* box-sizing global (abaixo) evita que o padding some ao 100vh e crie rolagem */
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.6rem;
  padding: 2rem;
}

.brand {
  text-align: center;
}
.brand h1 {
  margin: 0;
  font-family: var(--serif);
  font-size: 2.9rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--gold);
  /* Relevo sutil: o dourado sozinho fica chapado sobre a pedra. */
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}
/* Filetes ladeando o título, no lugar de um brasão que exigiria imagem. */
.brand h1::before,
.brand h1::after {
  content: "";
  display: inline-block;
  width: 2.2rem;
  height: 1px;
  vertical-align: middle;
  margin: 0 0.9rem;
  background: linear-gradient(90deg, transparent, var(--gold-dim), transparent);
}
.tagline {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
}
.dev {
  margin: 0.4rem 0 0;
  font-size: 0.72rem;
  color: var(--gold-dim);
}

.card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.6rem;
  background: var(--wood);
  border: 1px solid var(--border);
  border-radius: 4px;
  /* Luz vinda de cima, como um painel de madeira encerada. */
  box-shadow:
    inset 0 1px 0 rgba(212, 162, 74, 0.12),
    0 10px 30px rgba(0, 0, 0, 0.45);
}
.card.wide {
  max-width: 470px;
}
.card.center {
  align-items: center;
}

hr {
  width: 100%;
  height: 1px;
  margin: 0.2rem 0;
  border: none;
  background: linear-gradient(90deg, transparent, var(--border), transparent);
}

.account {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.tabs {
  display: flex;
  gap: 0.5rem;
}
.tabs button {
  flex: 1;
  padding: 0.55rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  color: var(--muted);
  box-shadow: none;
  transition: color 0.15s, border-color 0.15s;
}
.tabs button:hover {
  color: var(--parchment);
}
.tabs button.active {
  color: var(--gold);
  border-color: var(--gold-dim);
  background: rgba(212, 162, 74, 0.07);
}

form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
}
input {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  font: inherit;
  text-transform: none;
  letter-spacing: normal;
  color: var(--parchment);
  background: rgba(0, 0, 0, 0.25);
  box-shadow: none;
}
input:focus {
  outline: none;
  border-color: var(--gold-dim);
  box-shadow: 0 0 0 2px rgba(212, 162, 74, 0.18);
}

.welcome {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.35rem;
  color: var(--gold);
}
</style>

<style>
:root {
  --stone: #1a1512;
  --wood: #241d17;
  --border: #4a3a28;
  --gold: #d4a24a;
  --gold-dim: #a87f38;
  --parchment: #e8dcc8;
  --muted: #a3927a;
  --danger: #d08272;
  --success: #94b96f;
  --serif: Georgia, "Palatino Linotype", "Book Antiqua", serif;

  font-family: "Segoe UI", Inter, system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;

  color: var(--parchment);
  /* Sem prefers-color-scheme: o tema e escuro de proposito. Uma versao clara
     desta paleta nao existe -- pedra e madeira em fundo branco viram lama. */
  background-color: var(--stone);

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Textura de pedra: duas camadas de gradiente, sem imagem nenhuma -- a CSP do
   Tauri bloqueia recurso externo, e embutir bitmap engordaria o binario. */
body {
  margin: 0;
  overflow: hidden;
  min-height: 100vh;
  background-color: var(--stone);
  background-image:
    radial-gradient(ellipse at 50% -20%, rgba(212, 162, 74, 0.07), transparent 60%),
    repeating-linear-gradient(
      115deg,
      rgba(255, 255, 255, 0.012) 0px,
      rgba(255, 255, 255, 0.012) 1px,
      transparent 1px,
      transparent 7px
    );
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

/* Compartilhados entre App e Play. */
.muted {
  color: var(--muted);
  margin: 0;
}
.small {
  font-size: 0.78rem;
}
.center {
  text-align: center;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.85rem;
}
.notice {
  margin: 0;
  color: var(--success);
  font-size: 0.85rem;
}

button.primary {
  padding: 0.7rem;
  border: 1px solid var(--gold-dim);
  border-radius: 3px;
  font: inherit;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  color: #241d17;
  background: linear-gradient(180deg, #e0b45f, var(--gold-dim));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
button.primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #eec476, #b98d3f);
}
button.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button.ghost {
  padding: 0.55rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--parchment);
  font: inherit;
  cursor: pointer;
  box-shadow: none;
}
button.ghost:hover {
  border-color: var(--gold-dim);
  color: var(--gold);
}

button.link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--muted);
  cursor: pointer;
  text-decoration: underline;
  box-shadow: none;
}
button.link:hover:not(:disabled) {
  color: var(--gold);
}
button.link:disabled {
  cursor: default;
  text-decoration: none;
}
</style>
