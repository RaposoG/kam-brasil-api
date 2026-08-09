<script setup lang="ts">
import { onMounted, ref } from "vue";
import { type Account, apiBase, login, register } from "./api";

const emit = defineEmits<{ entrou: [conta: Account] }>();

type Modo = "login" | "registro";

const modo = ref<Modo>("login");
const ocupado = ref(false);
const erro = ref("");
const aviso = ref("");
const base = ref("");
const form = ref({ login: "", email: "", nickname: "", senha: "" });

onMounted(async () => (base.value = await apiBase()));

function trocar(para: Modo) {
  modo.value = para;
  erro.value = "";
  aviso.value = "";
}

async function enviar() {
  erro.value = "";
  aviso.value = "";
  ocupado.value = true;
  try {
    if (modo.value === "login") {
      emit("entrou", await login(form.value.login, form.value.senha));
    } else {
      await register(form.value.email, form.value.nickname, form.value.senha);
      aviso.value = "Conta criada! Agora é só entrar.";
      form.value.login = form.value.nickname;
      modo.value = "login";
    }
    form.value.senha = "";
  } catch (e) {
    erro.value = String(e);
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <div class="portao">
    <div class="brasao-grande">
      <div class="escudo selo"><span>KB</span></div>
      <h1 class="lema">Kam Brasil</h1>
      <p class="tagline">COMUNIDADE BRASILEIRA · KNIGHTS AND MERCHANTS</p>
      <p v-if="base.includes('localhost')" class="dev">API local · {{ base }}</p>
    </div>

    <div class="painel cartao">
      <nav class="abas">
        <button class="btn-contorno" :class="{ ativo: modo === 'login' }" @click="trocar('login')">
          ENTRAR
        </button>
        <button class="btn-contorno" :class="{ ativo: modo === 'registro' }" @click="trocar('registro')">
          CRIAR CONTA
        </button>
      </nav>

      <form @submit.prevent="enviar">
        <label v-if="modo === 'login'">
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
            v-model="form.senha"
            type="password"
            required
            minlength="8"
            :autocomplete="modo === 'login' ? 'current-password' : 'new-password'"
          />
        </label>

        <p v-if="erro" class="erro">{{ erro }}</p>
        <p v-if="aviso" class="aviso">{{ aviso }}</p>

        <button class="btn-ouro entrar" type="submit" :disabled="ocupado">
          {{ ocupado ? "AGUARDE" : modo === "login" ? "ENTRAR" : "CRIAR CONTA" }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.portao {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  padding: 2rem;
  overflow-y: auto;
}

.brasao-grande {
  text-align: center;
}
.selo {
  width: 62px;
  height: 70px;
  margin: 0 auto 16px;
  border-color: #8f6a2e;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
}
.selo span {
  font-family: var(--display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ouro);
}
.lema {
  margin: 0;
  font-family: var(--display);
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ouro);
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
}
/* Filetes ladeando o título, no lugar de um brasão que exigiria imagem. */
.lema::before,
.lema::after {
  content: "";
  display: inline-block;
  width: 2.4rem;
  height: 1px;
  vertical-align: middle;
  margin: 0 1rem;
  background: linear-gradient(90deg, transparent, var(--ouro-medio), transparent);
}
.tagline {
  margin: 10px 0 0;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.24em;
  color: var(--calado);
}
.dev {
  margin: 6px 0 0;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ouro-medio);
}

.cartao {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.6rem;
  box-shadow:
    inset 0 1px 0 rgba(212, 162, 74, 0.12),
    0 10px 30px rgba(0, 0, 0, 0.45);
}
.abas {
  display: flex;
  gap: 2px;
}
.abas button {
  flex: 1;
  text-align: center;
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
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--calado-3);
}
input {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--linha);
  font-family: var(--corpo);
  font-size: 14px;
  letter-spacing: normal;
  text-transform: none;
  color: var(--pergaminho);
  background: rgba(0, 0, 0, 0.3);
}
input:focus {
  outline: none;
  border-color: var(--bronze);
  box-shadow: 0 0 0 2px rgba(212, 162, 74, 0.18);
}
.entrar {
  margin-top: 0.3rem;
  padding: 13px;
  font-size: 15px;
  letter-spacing: 0.16em;
}
</style>
