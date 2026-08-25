/**
 * Estado real da instalação, compartilhado entre a Home (barra de status e o
 * botão JOGAR) e as Configurações. Módulo com refs no topo em vez de provide/
 * inject: a janela é uma só, e duas telas lendo o mesmo `check_update` seria
 * pedir à API a mesma coisa duas vezes.
 *
 * Instalar é UM passo: baixar. Sprites, sons e músicas vêm prontos na release,
 * como no instalador do KaM Remake — quem precisa do jogo de 1998 é quem
 * empacota, não quem joga. Enquanto era o contrário, cada jogador convertia na
 * própria máquina e cada máquina saía com um resultado diferente.
 */

import { computed, ref } from "vue";
import {
  type InstallProgress,
  type UpdateCheck,
  checkUpdate,
  installUpdate,
  launchGame,
  launcherUpdateAvailable,
  onInstallProgress,
  updateLauncher,
} from "./api";
import { sincronizarMapas } from "./mapas";

export const busy = ref(false);
export const checking = ref(false);
export const erro = ref("");
export const check = ref<UpdateCheck | null>(null);
export const download = ref<InstallProgress | null>(null);
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
export type Acao = "instalar" | "jogar" | "esperar" | "semVersao";

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
      titulo: "Baixando o jogo",
      detalhe: `${mb(d.bytes_done)} / ${mb(d.bytes_total)} MB · ${velocidade(d.bytes_per_second)} · ${restante(d)}`,
      curto: "baixando o jogo",
      pct: pct(d.bytes_done, d.bytes_total),
      indeterminado: false,
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

  if (c?.needsUpdate && c.latest)
    return {
      acao: "instalar" as Acao,
      titulo: c.installedVersion
        ? `Atualização disponível: ${c.latest.version}`
        : "O jogo ainda não está instalado",
      detalhe: `${mb(c.latest.totalBytes)} MB · ${c.latest.fileCount} arquivos · nada mais é preciso`,
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

  // Sem resposta da verificação, NÃO se diz que está tudo pronto.
  //
  // Enquanto existiam os estados `original` e `preparar`, eles barravam este
  // caso por acidente. Ao removê-los, o `jogar` virou o fim de linha de tudo —
  // inclusive de "a verificação falhou e eu não sei em que versão você está".
  //
  // O sintoma foi real: instalação parada na 1.0.4, release 1.3.0 publicada, e o
  // botão dizendo JOGAR. O jogador abriria um executável de um mês atrás
  // achando que estava atualizado.
  if (!c)
    return {
      acao: "esperar" as Acao,
      titulo: erro.value ? "Não foi possível verificar a versão" : "Verificando a instalação",
      detalhe: erro.value || "consultando a API",
      curto: erro.value ? "verificação falhou" : "verificando",
      pct: 0,
      indeterminado: true,
    };

  return {
    acao: "jogar" as Acao,
    titulo: "Tudo pronto para a batalha",
    // Quando o manifesto não respondeu, o que se sabe é o que o arquivo de
    // versão afirma — e é justamente ele que já mentiu uma vez. Dizer de onde
    // vem a confiança é mais honesto que esconder.
    detalhe:
      c?.sentinela === "nao conferida"
        ? "sem conexão para conferir os arquivos — abrindo a versão que está no disco"
        : desdeVerificacao(),
    curto: "instalação verificada",
    pct: 100,
    indeterminado: false,
  };
});

/** Rótulo do botão herói, na ordem do fluxo. */
export const rotuloAcao = computed(() => {
  switch (status.value.acao) {
    case "instalar":
      return check.value?.installedVersion ? "ATUALIZAR" : "INSTALAR";
    case "semVersao":
      return "JOGAR";
    case "esperar":
      return "AGUARDE";
    default:
      return "JOGAR";
  }
});

/**
 * Por que este jogador não pode entrar na fila ranqueada. Vazio = pode.
 *
 * Entrar na fila exige o MESMO que abrir o jogo exige. Sem isso o jogador é
 * pareado sem o jogo pronto e a partida trava para o adversário também — que
 * fez tudo certo e fica esperando alguém que não consegue abrir. Um botão
 * desabilitado é barato; uma sala perdida com outra pessoa dentro, não.
 *
 * Mora aqui, e não na tela da ranqueada, para não existirem duas definições de
 * "pronto" que possam discordar.
 */
export function impedimentoParaFila(acao: Acao, versaoNovaDoLauncher: string | null = null): string {
  // Launcher velho barra ANTES de tudo: quem está com o launcher desatualizado
  // pode estar sem uma correção que muda o protocolo da ranqueada, e o sintoma
  // apareceria como partida travada para os dois, não como "atualize".
  //
  // Vale para o jogo também, por outro caminho: jogo desatualizado vira
  // `needsUpdate`, que a máquina de estados acima já traduz em `instalar`.
  // Versão diferente entre jogadores é desync, e desync em ranqueada é rating
  // perdido de gente que não fez nada errado.
  if (versaoNovaDoLauncher)
    return `Atualize o launcher para a versão ${versaoNovaDoLauncher} antes de entrar na fila — a aba JOGAR tem o botão.`;

  switch (acao) {
    case "jogar":
      return "";
    case "instalar":
    case "semVersao":
      return "Instale ou atualize o jogo na aba JOGAR antes de entrar na fila.";
    case "esperar":
      return "Aguarde o download terminar — a aba JOGAR mostra o progresso.";
  }
}

export const versaoInstalada = computed(() => check.value?.installedVersion ?? null);
export const pastaJogo = computed(() => check.value?.path ?? "");

// --- ações ---

export async function refresh() {
  erro.value = "";
  checking.value = true;
  try {
    check.value = await checkUpdate();
    verificadoEm.value = Date.now();
  } catch (e) {
    erro.value = String(e);
  } finally {
    checking.value = false;
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
    // A sincronia do boot desiste enquanto o jogo não está instalado — este é o
    // momento em que ela passa a ter onde trabalhar.
    sincronizarMapas();
  } catch (e) {
    erro.value = String(e);
  } finally {
    busy.value = false;
    download.value = null;
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
    case "instalar":
      return instalar();
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

/**
 * De quanto em quanto tempo revalidar ao voltar para a janela.
 *
 * Alt-tab é constante; consultar a API a cada um seria abuso. Um minuto é curto
 * o bastante para não deixar a tela mentir por muito tempo e longo o bastante
 * para o uso normal não gerar tráfego nenhum.
 */
const REVALIDAR_APOS_MS = 60_000;

let iniciado = false;

/** Assina os eventos de progresso e faz a primeira verificação. Idempotente. */
export async function iniciar() {
  if (iniciado) return;
  iniciado = true;
  onInstallProgress((p) => (download.value = p));

  await refresh();

  // A tela não pode ficar apostando em estado de horas atrás.
  //
  // O launcher fica aberto o dia inteiro. Sem isto, uma release publicada
  // depois do boot só apareceria no próximo reinício — e, pior, uma instalação
  // que quebrou nesse meio-tempo continuaria se apresentando como pronta.
  window.addEventListener("focus", () => {
    if (busy.value || checking.value) return;
    if (verificadoEm.value && Date.now() - verificadoEm.value < REVALIDAR_APOS_MS) return;
    void refresh();
    void procurarLauncher();
  });

  // Sem `await`: a consulta ao GitHub leva ~700 ms, e é a pergunta menos urgente
  // do boot -- "existe launcher novo?". Aguardá-la deixava a tela travada por
  // quase um segundo depois de tudo o mais já estar pronto. O aviso aparece
  // quando a resposta chegar; até lá, dá para jogar.
  void procurarLauncher();
}
