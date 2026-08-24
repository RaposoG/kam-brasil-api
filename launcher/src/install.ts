/**
 * Estado real da instalação, compartilhado entre a Home (barra de status e o
 * botão JOGAR) e as Configurações. Módulo com refs no topo em vez de provide/
 * inject: a janela é uma só, e duas telas lendo o mesmo `check_update` seria
 * pedir à API a mesma coisa duas vezes.
 */

import { computed, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type AssetProgress,
  type InstallProgress,
  type OriginalGame,
  type UpdateCheck,
  assetsStatus,
  checkOriginalGame,
  checkUpdate,
  findOriginalGame,
  generateAssets,
  installUpdate,
  launchGame,
  launcherUpdateAvailable,
  onAssetProgress,
  onInstallProgress,
  updateLauncher,
} from "./api";

export const busy = ref(false);
export const checking = ref(false);
export const erro = ref("");
export const check = ref<UpdateCheck | null>(null);
export const original = ref<OriginalGame | null>(null);
export const assetsOk = ref(false);
export const download = ref<InstallProgress | null>(null);
export const assetStep = ref<AssetProgress | null>(null);
export const verificadoEm = ref<number | null>(null);

export const launcherNova = ref<string | null>(null);
export const atualizandoLauncher = ref(false);
export const launcherPercent = ref(0);

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

const pct = (feito: number, total: number) =>
  total === 0 ? 0 : Math.min(100, Math.round((feito / total) * 100));

const velocidade = (bps: number) =>
  bps > 1024 * 1024
    ? `${(bps / 1024 / 1024).toFixed(1).replace(".", ",")} MB/s`
    : `${Math.round(bps / 1024)} KB/s`;

const restante = (p: InstallProgress) => {
  if (!p.bytes_per_second) return "";
  const secs = Math.round((p.bytes_total - p.bytes_done) / p.bytes_per_second);
  return secs < 60 ? `${secs}s restantes` : `${Math.floor(secs / 60)}min restantes`;
};

const desdeVerificacao = () => {
  if (!verificadoEm.value) return "ainda não verificado";
  const min = Math.floor((Date.now() - verificadoEm.value) / 60000);
  if (min < 1) return "verificado agora";
  return min === 1 ? "verificado há 1 minuto" : `verificado há ${min} minutos`;
};

/** Ação principal da Home, na ordem em que o fluxo exige. */
export type Acao = "original" | "instalar" | "preparar" | "jogar" | "esperar" | "semVersao";

/**
 * A barra de status e o botão herói leem daqui. Um estado só, derivado — a tela
 * nunca mostra um botão que ainda não funciona.
 */
export const status = computed(() => {
  const d = download.value;
  const c = check.value;

  if (busy.value && d?.phase === "verificando")
    return {
      acao: "esperar" as Acao,
      titulo: "Verificando arquivos já instalados",
      detalhe: `${d.files_done} / ${d.files_total} arquivos conferidos`,
      curto: "conferindo instalação",
      pct: pct(d.files_done, d.files_total),
      indeterminado: false,
    };

  if (busy.value && d?.phase === "extraindo")
    return {
      acao: "esperar" as Acao,
      titulo: "Instalando os arquivos",
      detalhe: `${d.files_done} / ${d.files_total} · ${d.current_file}`,
      curto: "instalando",
      pct: pct(d.files_done, d.files_total),
      indeterminado: false,
    };

  if (busy.value && d)
    return {
      acao: "esperar" as Acao,
      titulo: "Baixando o cliente",
      detalhe: `${mb(d.bytes_done)} / ${mb(d.bytes_total)} MB · ${velocidade(d.bytes_per_second)} · ${restante(d)}`,
      curto: "baixando o cliente",
      pct: pct(d.bytes_done, d.bytes_total),
      indeterminado: false,
    };

  if (busy.value && assetStep.value)
    return {
      acao: "esperar" as Acao,
      titulo: assetStep.value.step,
      detalhe: assetStep.value.detail,
      curto: "preparando assets",
      pct: 0,
      indeterminado: true,
    };

  if (busy.value)
    return {
      acao: "esperar" as Acao,
      titulo: "Trabalhando…",
      detalhe: "",
      curto: "ocupado",
      pct: 0,
      indeterminado: true,
    };

  if (!original.value)
    return {
      acao: "original" as Acao,
      titulo: "Precisamos do Knights and Merchants original",
      detalhe: "escolher a pasta manualmente",
      curto: "aguardando cópia original",
      pct: 0,
      indeterminado: false,
    };

  if (c?.needsUpdate && c.latest)
    return {
      acao: "instalar" as Acao,
      titulo: c.installedVersion
        ? `Atualização disponível: ${c.latest.version}`
        : "O jogo ainda não está instalado",
      detalhe: `${mb(c.latest.totalBytes)} MB · ${c.latest.fileCount} arquivos`,
      curto: c.installedVersion ? "atualização pendente" : "instalação pendente",
      pct: 0,
      indeterminado: false,
    };

  if (c && !c.latest)
    return {
      acao: "semVersao" as Acao,
      titulo: "Nenhuma versão publicada na API ainda",
      detalhe: "nada a baixar por enquanto",
      curto: "sem versão publicada",
      pct: 0,
      indeterminado: false,
    };

  if (!assetsOk.value)
    return {
      acao: "preparar" as Acao,
      titulo: "Falta preparar os arquivos do jogo",
      detalhe: "converte gráficos e sons da sua cópia original · leva alguns minutos",
      curto: "assets pendentes",
      pct: 0,
      indeterminado: false,
    };

  return {
    acao: "jogar" as Acao,
    titulo: "Tudo pronto para a batalha",
    detalhe: desdeVerificacao(),
    curto: "instalação verificada",
    pct: 100,
    indeterminado: false,
  };
});

/** Rótulo do botão herói, na ordem do fluxo. */
export const rotuloAcao = computed(() => {
  switch (status.value.acao) {
    case "original":
      return "ESCOLHER PASTA";
    case "instalar":
      return check.value?.installedVersion ? "ATUALIZAR" : "INSTALAR";
    case "preparar":
      return "PREPARAR";
    case "semVersao":
      return "JOGAR";
    case "esperar":
      return "AGUARDE";
    default:
      return "JOGAR";
  }
});

export const versaoInstalada = computed(() => check.value?.installedVersion ?? null);
export const pastaJogo = computed(() => check.value?.path ?? "");

// --- ações ---

export async function refresh() {
  erro.value = "";
  checking.value = true;
  try {
    // Em paralelo, não em série: são três perguntas independentes, e uma delas
    // vai à rede. Encadeadas, o jogador esperava a soma das três antes de a
    // tela assentar.
    const [c, a, o] = await Promise.all([
      checkUpdate(),
      assetsStatus(),
      original.value ? Promise.resolve(original.value) : findOriginalGame(),
    ]);
    check.value = c;
    assetsOk.value = a;
    original.value = o;
    verificadoEm.value = Date.now();
  } catch (e) {
    erro.value = String(e);
  } finally {
    checking.value = false;
  }
}

export async function escolherOriginal() {
  erro.value = "";
  try {
    // O open() fica DENTRO do try: quando faltava `dialog:allow-open` nas
    // capabilities a exceção subia sem ninguém ver, e o botão parecia morto.
    const escolhida = await open({ directory: true, title: "Onde está o Knights and Merchants?" });
    if (typeof escolhida !== "string") return;
    original.value = await checkOriginalGame(escolhida);
    await refresh();
  } catch (e) {
    erro.value = String(e);
  }
}

export async function instalar() {
  const release = check.value?.latest;
  if (!release) return;
  busy.value = true;
  erro.value = "";
  try {
    await installUpdate(release);
    await refresh();
  } catch (e) {
    erro.value = String(e);
  } finally {
    busy.value = false;
    download.value = null;
  }
}

export async function prepararAssets() {
  if (!original.value) return;
  busy.value = true;
  erro.value = "";
  try {
    await generateAssets(original.value.path);
    assetsOk.value = await assetsStatus();
  } catch (e) {
    erro.value = String(e);
  } finally {
    busy.value = false;
    assetStep.value = null;
  }
}

export async function jogar() {
  erro.value = "";
  try {
    await launchGame();
  } catch (e) {
    erro.value = String(e);
  }
}

/** Executa o que o estado atual pede. É o clique do botão herói. */
export function acaoPrincipal() {
  switch (status.value.acao) {
    case "original":
      return escolherOriginal();
    case "instalar":
      return instalar();
    case "preparar":
      return prepararAssets();
    case "jogar":
      return jogar();
    default:
      return Promise.resolve();
  }
}

export async function atualizarLauncher() {
  atualizandoLauncher.value = true;
  erro.value = "";
  try {
    await updateLauncher((baixado, total) => {
      launcherPercent.value = total ? Math.round((baixado / total) * 100) : 0;
    });
    // No Windows o instalador reinicia o launcher; se chegamos aqui, não houve.
    launcherNova.value = null;
  } catch (e) {
    erro.value = String(e);
  } finally {
    atualizandoLauncher.value = false;
  }
}

export async function procurarLauncher() {
  try {
    launcherNova.value = await launcherUpdateAvailable();
  } catch {
    launcherNova.value = null;
  }
}

let iniciado = false;

/** Assina os eventos de progresso e faz a primeira verificação. Idempotente. */
export async function iniciar() {
  if (iniciado) return;
  iniciado = true;
  onInstallProgress((p) => (download.value = p));
  onAssetProgress((p) => (assetStep.value = p));

  await refresh();

  // Sem `await`: a consulta ao GitHub leva ~700 ms, e é a pergunta menos urgente
  // do boot -- "existe launcher novo?". Aguardá-la deixava a tela travada por
  // quase um segundo depois de tudo o mais já estar pronto. O aviso aparece
  // quando a resposta chegar; até lá, dá para jogar.
  void procurarLauncher();
}
