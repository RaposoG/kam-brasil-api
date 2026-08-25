/**
 * Ponte com as rotas `/admin/*` da API.
 *
 * Mesma regra do resto do launcher: nada de `fetch` autenticado aqui. Tudo
 * passa pelo comando `admin_call` (`src-tauri/src/admin.rs`), que é quem tem o
 * token — ele nunca chega à webview. O comando só alcança caminhos que começam
 * em `/admin/`, e quem concede o acesso é o `requireAdmin` da API.
 *
 * Mostrar ou esconder o menu do painel é conforto, não segurança: um `isAdmin`
 * forjado no cliente abriria as telas e receberia 403 em cada botão.
 */

import { invoke } from "@tauri-apps/api/core";
import type { RankedMode, Team } from "./api";

/** O que a API responde quando a rota não existe — ver `chamar` abaixo. */
const ROTA_AUSENTE = "Not Found";

/**
 * O painel do launcher e as rotas da API andam em versões diferentes: uma build
 * nova do launcher pode chamar rota que a API em produção ainda não tem. Um
 * "Not Found" cru mandaria o admin procurar o problema no lugar errado.
 */
function comRotaNomeada(e: unknown, method: string, path: string): Error {
  if (String(e) === ROTA_AUSENTE) return new Error(`esta API ainda não tem a rota ${method} ${path}`);
  return e instanceof Error ? e : new Error(String(e));
}

async function chamar<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await invoke<T>("admin_call", { method, path, body: body ?? null });
  } catch (e) {
    throw comRotaNomeada(e, method, path);
  }
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") q.set(chave, String(valor));
  }
  const texto = q.toString();
  return texto ? `?${texto}` : "";
};

// --- temporadas ---

export interface CortesTier {
  miliciano: number;
  machadeiro: number;
  espadachim: number;
  besteiro: number;
  barbaro: number;
}

export interface Temporada {
  id: string;
  nome: string;
  numero: number;
  inicioEm: string;
  /** `null` = temporada aberta sem data de fim marcada. */
  fimEm: string | null;
  ativa: boolean;
  cortesTier: CortesTier;
  criadoEm: string;
}

export const listarTemporadas = async () =>
  (await chamar<{ seasons: Temporada[] }>("GET", "/admin/seasons")).seasons;

/** Criar nunca ativa: virar a temporada é um ato separado (e explícito). */
export const criarTemporada = async (dados: {
  nome: string;
  numero: number;
  inicioEm?: string;
  fimEm?: string | null;
}) => (await chamar<{ season: Temporada }>("POST", "/admin/seasons", dados)).season;

export const ativarTemporada = (id: string) =>
  chamar<{ ok: boolean }>("POST", `/admin/seasons/${id}/activate`, {});

export const fecharTemporada = (id: string, fimEm?: string) =>
  chamar<{ ok: boolean; fimEm: string }>("POST", `/admin/seasons/${id}/close`, fimEm ? { fimEm } : {});

// --- catálogo de mapas ---

/** Um arquivo do mapa guardado no catálogo global. */
export interface ArquivoMapa {
  /** Relativo à pasta do jogo: `MapsMP/<mapa>/<arquivo>`. */
  path: string;
  sha256: string;
  size: number;
}

export interface MapaDoCatalogo {
  id: string;
  nome: string;
  /** Hex de 8 dígitos. É o CRC que o jogo difunde no `mkMapSelect`. */
  mapCrc: string;
  modos: RankedMode[];
  ativo: boolean;
  /**
   * O CRC foi lido do `.mi` da pasta (`true`) ou digitado (`false`)? Digitado
   * errado, o servidor anuncia um mapa que o cliente recusa. `undefined` = API
   * anterior ao catálogo de arquivos, e aí a tela não afirma nada.
   */
  crcVerificado?: boolean;
  /** Vazio = mapa só cadastrado: vale no pool, mas ninguém consegue baixá-lo. */
  arquivos?: ArquivoMapa[];
}

export const listarMapas = async () =>
  (await chamar<{ maps: MapaDoCatalogo[] }>("GET", "/admin/maps")).maps;

/**
 * Cadastra o mapa **só com o CRC**, sem arquivo nenhum.
 *
 * Serve para o mapa que já vai dentro da release do jogo. Para um mapa novo, o
 * caminho é `enviarPastaDeMapa`: sem os arquivos no servidor, quem não tiver o
 * mapa entra na sala e não consegue baixá-lo.
 */
export const criarMapa = async (dados: {
  nome: string;
  mapCrc: string;
  modos: RankedMode[];
  ativo?: boolean;
}) => (await chamar<{ map: MapaDoCatalogo }>("POST", "/admin/maps", dados)).map;

/**
 * Muda o que dá para mudar sem mexer nos bytes: modos e ativo/inativo.
 *
 * `nome` só é aceito em mapa sem arquivos — o nome é o nome da pasta, e
 * renomear um mapa distribuído é reenviar a pasta com o nome novo.
 */
export const editarMapa = (id: string, patch: { nome?: string; modos?: RankedMode[]; ativo?: boolean }) =>
  chamar<{ map: MapaDoCatalogo }>("PUT", `/admin/maps/${id}`, patch);

/**
 * Tira o mapa do catálogo e apaga os arquivos do servidor.
 *
 * `historico: true` = o mapa já apareceu em partida, então a linha ficou (só
 * inativa e sem arquivos): apagá-la levaria junto o nome do mapa do histórico
 * de quem jogou.
 */
export const removerMapa = (id: string) =>
  chamar<{ ok: boolean; historico: boolean; partidas: number; assinatura: string }>(
    "DELETE",
    `/admin/maps/${id}`,
  );

// --- pasta de mapa no disco (lida e empacotada pelo Rust) ---

export interface ArquivoDoMapa {
  /** Relativo à pasta do mapa, com barra normal. */
  caminho: string;
  bytes: number;
}

export interface PastaDeMapa {
  /** O nome do mapa **é** o nome da pasta: é assim que o jogo o encontra. */
  nome: string;
  pasta: string;
  /** `null` = a pasta não tem `.mi`, e aí o CRC vai ter que ser digitado. */
  crc: string | null;
  arquivos: ArquivoDoMapa[];
  totalBytes: number;
}

/** Lê a pasta sem tocar na rede: nome, CRC do `.mi` e a lista de arquivos. */
export const lerPastaDeMapa = (pasta: string): Promise<PastaDeMapa> =>
  invoke("admin_map_folder", { pasta });

/** O que `POST /admin/maps/upload` devolve. Reenviar o mesmo nome atualiza. */
export interface EnvioDeMapa {
  map: MapaDoCatalogo;
  arquivos: number;
  bytes: number;
  /** `false` = a pasta não trouxe `.mi` e valeu o CRC digitado. */
  crcVerificado: boolean;
  /** O que o servidor quer que o admin leia — CRC não conferido, divergente. */
  avisos: string[];
  assinatura: string;
}

/**
 * Sobe a pasta do mapa para o catálogo global.
 *
 * Contrato com `api/src/routes/mapas.ts`: `multipart/form-data` com o campo de
 * texto `nome` (posto pelo Rust, é o nome da pasta), os arquivos em partes
 * repetidas chamadas `arquivos` e, opcionalmente, `modos` e `mapCrc`. O CRC
 * lido do `.mi` tem precedência sobre o digitado do outro lado — o digitado só
 * é usado quando a pasta não tem cache.
 */
export async function enviarPastaDeMapa(
  pasta: string,
  modos: RankedMode[],
  mapCrc?: string,
): Promise<EnvioDeMapa> {
  const rota = "/admin/maps/upload";
  try {
    return await invoke("admin_map_upload", {
      pasta,
      campos: { modos: JSON.stringify(modos), ...(mapCrc ? { mapCrc } : {}) },
      rota,
    });
  } catch (e) {
    throw comRotaNomeada(e, "POST", rota);
  }
}

// --- pool da temporada ---

export interface MapaDoPool extends MapaDoCatalogo {
  /** A posição no pool. A ordem do array **é** a ordem — não há campo solto. */
  ordem: number;
}

export const listarPoolDaTemporada = async (id: string) =>
  (await chamar<{ maps: MapaDoPool[] }>("GET", `/admin/seasons/${id}/maps`)).maps;

/** Substitui o pool inteiro, na ordem do array. De 1 a 10 mapas. */
export const gravarPoolDaTemporada = (id: string, mapIds: string[]) =>
  chamar<{ ok: boolean; total: number }>("PUT", `/admin/seasons/${id}/maps`, { mapIds });

// --- jogadores ---

/** O rating real. Só o painel vê `mu`, `sigma` e `c` — o jogador vê o tier. */
export interface JogadorAdmin {
  id: string;
  nickname: string;
  email: string;
  isAdmin: boolean;
  lastSeenAt: string | null;
  queueBanUntil: string | null;
  queueBanCount: number;
  queueBanDia: string | null;
  seasonId: string | null;
  mu: number | null;
  sigma: number | null;
  c: number | null;
  tier: string | null;
  tierSince: string | null;
  rankedMatches: number | null;
  placementDone: boolean | null;
  demotionStrikes: number | null;
  lastRankedAt: string | null;
  seededBy: string | null;
}

export const listarJogadores = (filtro: {
  q?: string;
  seasonId?: string;
  limit?: number;
  offset?: number;
}) =>
  chamar<{ seasonId: string | null; players: JogadorAdmin[] }>(
    "GET",
    `/admin/players${query(filtro)}`,
  );

// --- punições ---

export interface Punicao {
  id: string;
  nickname: string;
  email: string;
  queueBanUntil: string | null;
  queueBanCount: number;
  queueBanDia: string | null;
  suspensoAgora: boolean;
  abandonos: number;
}

export const listarPunicoes = async () =>
  (await chamar<{ punicoes: Punicao[] }>("GET", "/admin/punishments")).punicoes;

/** Suspende a **fila ranqueada** (não o jogo). Teto de 30 dias na API. */
export const suspenderFila = (accountId: string, minutos: number, ocorrencias?: number) =>
  chamar<{ ok: boolean; queueBanUntil: string }>("PUT", `/admin/accounts/${accountId}/queue-ban`, {
    minutos,
    ...(ocorrencias === undefined ? {} : { ocorrencias }),
  });

/** Perdoa: tira a suspensão **e** zera a ficha de reincidência. */
export const perdoarFila = (accountId: string) =>
  chamar<{ ok: boolean }>("DELETE", `/admin/accounts/${accountId}/queue-ban`);

// --- partidas ---

export interface PartidaAdmin {
  id: string;
  lobbyId: string | null;
  seasonId: string | null;
  mode: RankedMode;
  mapId: string | null;
  mapCrc: string;
  randomSeed: number | null;
  gameRevision: string;
  exeCrc: string;
  iniciadoEm: string;
  encerradoEm: string | null;
  duracaoTicks: number | null;
  status: "pending" | "valid" | "invalid";
  invalidMotivo: string | null;
  timeVencedor: Team | null;
  fonte: "dedicated" | "manual";
  replayCrc: string | null;
  jogadores: string[];
}

export interface JogadorDaPartida {
  matchId: string;
  handIndex: number;
  accountId: string | null;
  nickname: string;
  time: Team | null;
  wonOrLost: "won" | "lost" | "none";
  muBefore: number | null;
  sigmaBefore: number | null;
  muAfter: number | null;
  sigmaAfter: number | null;
  peso: number;
  statsJson: Record<string, unknown> | null;
  abandonou: boolean;
}

export const listarPartidas = async (filtro: {
  status?: string;
  seasonId?: string;
  accountId?: string;
  before?: string;
  limit?: number;
}) => (await chamar<{ matches: PartidaAdmin[] }>("GET", `/admin/matches${query(filtro)}`)).matches;

export const verPartida = (id: string) =>
  chamar<{ match: PartidaAdmin; players: JogadorDaPartida[] }>("GET", `/admin/matches/${id}`);

// --- denúncias ---

export interface Denuncia {
  id: string;
  denuncianteId: string;
  denunciadoId: string;
  denuncianteNickname: string;
  denunciadoNickname: string;
  matchId: string | null;
  motivo: string;
  estado: "aberta" | "resolvida" | "rejeitada";
  resolucao: string | null;
  resolvidoPor: string | null;
  resolvidoEm: string | null;
  criadoEm: string;
  matchStatus: string | null;
  replayCrc: string | null;
  matchIniciadoEm: string | null;
}

export const listarDenuncias = async (filtro: { estado?: string; limit?: number }) =>
  (await chamar<{ denuncias: Denuncia[] }>("GET", `/admin/reports${query(filtro)}`)).denuncias;

/** Rejeitar também é resolver. A API só aceita uma vez: a segunda dá 404. */
export const resolverDenuncia = (id: string, estado: "resolvida" | "rejeitada", resolucao: string) =>
  chamar<{ ok: boolean }>("POST", `/admin/reports/${id}/resolve`, {
    estado,
    ...(resolucao.trim() ? { resolucao: resolucao.trim() } : {}),
  });

// --- formatação comum às telas do painel ---

export const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

/** Duas casas, ou travessão. `null` em mu/sigma é jogador sem rating na temporada. */
export const numero = (valor: number | null | undefined, casas = 2) =>
  valor === null || valor === undefined ? "—" : valor.toFixed(casas);

export const tamanho = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const MODOS: RankedMode[] = ["1v1", "2v2", "3v3", "4v4"];
