/**
 * Dados fictícios das telas de progresso.
 *
 * ⚠️ Nada aqui vem da API. Hoje ela tem contas, tickets de partida, lista de
 * servidores e releases — estatística, elo, replays e temporada são feature
 * nova. `GET /maps.php` recebe a partida jogada mas **não persiste**.
 *
 * O design foi feito sabendo disso. Este arquivo existe para a interface ficar
 * de pé inteira agora e a troca por dados reais ser um arquivo só: cada função
 * daqui vira uma chamada de API sem a tela mudar de forma.
 */

export const JOGADOR = "RaposoG";

const num = (n: number) => Math.round(n).toLocaleString("pt-BR").replace(/\./g, " ");

const hash = (s: string) => {
  let x = 7;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 997;
  return x;
};

// --- partidas ---

interface Jogador {
  nome: string;
  div: string;
  /** Fator de rendimento. Todos os números do relatório derivam dele, então o
   *  total de uma equipe sempre fecha com a soma dos jogadores. */
  f: number;
  eu?: boolean;
}

export interface Partida {
  id: string;
  mapa: string;
  modo: string;
  min: number;
  dur: string;
  quando: string;
  data: string;
  venceu: boolean;
  fim: string;
  pts: string;
  meu: Jogador[];
  deles: Jogador[];
  eventos: [string, string][];
}

const eu = (f: number): Jogador => ({ nome: JOGADOR, div: "Espadachim II", f, eu: true });

export const PARTIDAS: Partida[] = [
  {
    id: "m1", mapa: "Cursed Ravine", modo: "1v1", min: 34, dur: "34min 12s", quando: "há 2h",
    data: "8 de agosto, 21h04", venceu: true, fim: "POR RENDIÇÃO", pts: "+1 nível",
    meu: [eu(1)], deles: [{ nome: "Mestre_Lucas", div: "Cavaleiro I", f: 0.87 }],
    eventos: [
      ["03:12", "Primeira serraria de pé"],
      ["08:41", "Quartel erguido, milícia em treino"],
      ["14:05", "Primeiro ataque dele repelido no vale"],
      ["19:38", "Mina de ouro perdida por 6 minutos"],
      ["26:20", "Cerco à padaria dele, economia trava"],
      ["31:47", "Investida de cavalaria no vale norte"],
      ["34:12", "Rendição do oponente"],
    ],
  },
  {
    id: "m2", mapa: "Across the Desert", modo: "1v1", min: 41, dur: "41min 08s", quando: "há 5h",
    data: "8 de agosto, 16h22", venceu: false, fim: "POR ANIQUILAÇÃO", pts: "−18 pts",
    meu: [eu(0.82)], deles: [{ nome: "Bandeirante", div: "Rei", f: 1.06 }],
    eventos: [
      ["04:02", "Serraria tardia — dois minutos perdidos"],
      ["11:20", "Ele abre a segunda mina de ferro"],
      ["17:44", "Perde a pedreira do norte"],
      ["25:10", "Contra-ataque de besteiros falha"],
      ["33:52", "Quartel destruído"],
      ["41:08", "Vila tomada"],
    ],
  },
  {
    id: "m3", mapa: "Golden Cliffs", modo: "2v2", min: 28, dur: "28min 40s", quando: "ontem",
    data: "7 de agosto, 22h10", venceu: true, fim: "POR RENDIÇÃO DUPLA", pts: "+22 pts",
    meu: [eu(1.04), { nome: "Vilarejo", div: "Espadachim II", f: 0.9 }],
    deles: [
      { nome: "Dom_Bruno", div: "Cavaleiro III", f: 0.95 },
      { nome: "Ferreiro_Zé", div: "Espadachim I", f: 0.78 },
    ],
    eventos: [
      ["02:50", "Vilarejo assume a linha de pedra"],
      ["09:15", "Você troca madeira por ferro com o aliado"],
      ["15:30", "Ataque conjunto no penhasco leste"],
      ["21:05", "Dom_Bruno perde as duas minas"],
      ["25:12", "Ferreiro_Zé é cercado sozinho"],
      ["28:40", "Rendição dos dois"],
    ],
  },
  {
    id: "m4", mapa: "Lakeland", modo: "1v1", min: 52, dur: "52min 31s", quando: "ontem",
    data: "7 de agosto, 19h48", venceu: true, fim: "POR ANIQUILAÇÃO", pts: "+26 pts",
    meu: [eu(1.12)], deles: [{ nome: "Dom_Bruno", div: "Cavaleiro III", f: 0.98 }],
    eventos: [
      ["03:40", "Abertura padrão de duas serrarias"],
      ["12:10", "Cerco longo no istmo, 11 minutos"],
      ["24:35", "Primeira vantagem de exército"],
      ["38:20", "Ele reconstrói a armaria"],
      ["47:02", "Cavalaria varre a vila sul"],
      ["52:31", "Aniquilação"],
    ],
  },
  {
    id: "m5", mapa: "Serra do Mar", modo: "3v3", min: 47, dur: "47min 19s", quando: "2 dias",
    data: "6 de agosto, 21h30", venceu: false, fim: "POR RENDIÇÃO DA EQUIPE", pts: "−11 pts",
    meu: [
      eu(0.96),
      { nome: "Ana_Serralheira", div: "Cavaleiro I", f: 1.02 },
      { nome: "TupãBR", div: "Cavaleiro II", f: 0.71 },
    ],
    deles: [
      { nome: "Mestre_Lucas", div: "Rei", f: 1.08 },
      { nome: "Bandeirante", div: "Rei", f: 1.01 },
      { nome: "Vilarejo", div: "Espadachim II", f: 0.88 },
    ],
    eventos: [
      ["05:20", "TupãBR abre longe da equipe"],
      ["13:45", "Ana segura o corredor central"],
      ["22:10", "TupãBR cai, flanco aberto"],
      ["31:00", "Você assume o front dele"],
      ["39:25", "Mestre_Lucas rompe a linha"],
      ["47:19", "Equipe se rende"],
    ],
  },
  {
    id: "m6", mapa: "Wolfsberg", modo: "4v4", min: 61, dur: "61min 04s", quando: "4 dias",
    data: "4 de agosto, 20h15", venceu: true, fim: "POR ANIQUILAÇÃO", pts: "+20 pts",
    meu: [
      eu(1.06),
      { nome: "Ana_Serralheira", div: "Cavaleiro I", f: 0.99 },
      { nome: "Vilarejo", div: "Espadachim II", f: 0.86 },
      { nome: "Ferreiro_Zé", div: "Espadachim I", f: 0.74 },
    ],
    deles: [
      { nome: "Bandeirante", div: "Rei", f: 1.03 },
      { nome: "TupãBR", div: "Cavaleiro II", f: 0.82 },
      { nome: "Dom_Bruno", div: "Cavaleiro III", f: 0.91 },
      { nome: "Pedreiro_Val", div: "Besteiro III", f: 0.63 },
    ],
    eventos: [
      ["06:10", "Quatro vilas fecham o vale oeste"],
      ["16:30", "Ferreiro_Zé perde a pedreira"],
      ["27:45", "Ana abastece a equipe com ferro"],
      ["36:20", "Pedreiro_Val é eliminado"],
      ["44:50", "Push conjunto na colina central"],
      ["54:12", "Bandeirante fica sozinho"],
      ["61:04", "Aniquilação"],
    ],
  },
];

interface Metrica {
  id: string;
  rotulo: string;
  base: number;
  nota: string;
  media?: boolean;
  itens: [string, number][];
}

const METRICAS: Metrica[] = [
  { id: "recursos", rotulo: "RECURSOS", base: 1800, nota: "UNIDADES PRODUZIDAS NO TOTAL",
    itens: [["Madeira", 0.21], ["Tábuas", 0.07], ["Pedra", 0.17], ["Carvão", 0.1], ["Ferro", 0.08], ["Ouro", 0.07], ["Farinha", 0.06], ["Pão", 0.13], ["Vinho", 0.06], ["Couro", 0.05]] },
  { id: "casas", rotulo: "CASAS", base: 36, nota: "EDIFÍCIOS CONCLUÍDOS",
    itens: [["Serraria", 0.08], ["Pedreira", 0.08], ["Fazenda", 0.11], ["Moinho", 0.05], ["Padaria", 0.05], ["Mina de ferro", 0.05], ["Mina de ouro", 0.05], ["Forja", 0.08], ["Armaria", 0.05], ["Quartel", 0.05], ["Torre", 0.19], ["Armazém", 0.16]] },
  { id: "soldados", rotulo: "SOLDADOS", base: 86, nota: "TROPAS TREINADAS",
    itens: [["Milícia", 0.21], ["Lanceiro", 0.23], ["Besteiro", 0.14], ["Espadachim", 0.25], ["Cavalaria", 0.13], ["Bárbaro", 0.04]] },
  { id: "abates", rotulo: "ABATES", base: 62, nota: "MORTES POR TIPO DE ATACANTE",
    itens: [["Espadachim", 0.38], ["Cavalaria", 0.3], ["Besteiro", 0.19], ["Lanceiro", 0.09], ["Milícia", 0.04]] },
  { id: "perdas", rotulo: "PERDAS", base: 46, nota: "UNIDADES PERDIDAS POR TIPO",
    itens: [["Milícia", 0.3], ["Lanceiro", 0.23], ["Besteiro", 0.13], ["Espadachim", 0.19], ["Cavalaria", 0.11], ["Operários", 0.04]] },
  { id: "apm", rotulo: "APM", base: 41, nota: "AÇÕES POR MINUTO, POR CATEGORIA", media: true,
    itens: [["Movimento", 0.34], ["Construção", 0.22], ["Recrutamento", 0.17], ["Distribuição", 0.15], ["Câmera", 0.12]] },
  { id: "pop", rotulo: "POP. MÁXIMA", base: 210, nota: "COMPOSIÇÃO NO PICO",
    itens: [["Servos", 0.16], ["Operários", 0.24], ["Recrutas", 0.11], ["Soldados", 0.41], ["Em treino", 0.08]] },
];

const ORDEM: Record<string, number> = {
  Camponês: 1, Recruta: 2, Milícia: 3, Lanceiro: 4,
  Besteiro: 5, Espadachim: 6, Cavaleiro: 7, Rei: 8,
};

const corTier = (o: number) => (o >= 7 ? "#8a6a22" : o >= 5 ? "#6f5c43" : o >= 3 ? "#7d6a50" : "#8d8070");

/** Perdas e abates invertem o viés: quem venceu perde menos e mata mais. */
const vies = (id: string, ladoVenceu: boolean) => {
  if (id === "perdas") return ladoVenceu ? 0.78 : 1.28;
  if (id === "abates") return ladoVenceu ? 1.2 : 0.82;
  return 1;
};

/**
 * Relatório completo de uma partida, comparando **dois jogadores escolhidos** —
 * nunca somas de equipe, que escondem quem carregou e quem foi carregado.
 */
export function montarRelatorio(partidaId: string, iAlvo = 0, iFoe = 0, metricaAberta = "recursos") {
  const spec = PARTIDAS.find((p) => p.id === partidaId) ?? PARTIDAS[0];
  const dur = spec.min / 35;
  const iA = Math.min(iAlvo, spec.meu.length - 1);
  const iB = Math.min(iFoe, spec.deles.length - 1);
  const temTime = spec.meu.length > 1;

  const valorJogador = (m: Metrica, j: Jogador, ladoVenceu: boolean) => {
    const escalaDur = m.media ? 1 : dur;
    return m.base * j.f * escalaDur * vies(m.id, ladoVenceu) * (1 + ((hash(j.nome + m.id) % 15) - 7) / 100);
  };

  const itensDe = (m: Metrica, total: number, seed: string): [string, number][] => {
    const brutos = m.itens.map(([nome, r], i): [string, number] => [
      nome,
      total * r * (1 + ((hash(seed + nome + i) % 23) - 11) / 100),
    ]);
    const soma = brutos.reduce((a, [, v]) => a + v, 0) || 1;
    return brutos.map(([nome, v]): [string, number] => [nome, (v * total) / soma]);
  };

  const comparativo = METRICAS.map((m) => {
    const meus = spec.meu.map((j) => ({ j, v: valorJogador(m, j, spec.venceu) }));
    const seus = spec.deles.map((j) => ({ j, v: valorJogador(m, j, !spec.venceu) }));
    const vA = meus[iA].v;
    const vB = seus[iB].v;
    const maior = Math.max(vA, vB) || 1;

    const itA = itensDe(m, vA, spec.id + "a" + iA);
    const itB = itensDe(m, vB, spec.id + "b" + iB);
    const maxItem = Math.max(...itA.map(([, v]) => v), ...itB.map(([, v]) => v)) || 1;
    const maxJog = Math.max(...meus.map((x) => x.v), ...seus.map((x) => x.v)) || 1;
    const aberto = m.id === metricaAberta;

    const todos = [
      ...meus.map((x, i) => ({ x, meu: true, sel: i === iA })),
      ...seus.map((x, i) => ({ x, meu: false, sel: i === iB })),
    ].sort((a, b) => b.x.v - a.x.v);

    return {
      id: m.id,
      rotulo: m.rotulo,
      voce: num(vA),
      foe: num(vB),
      pctVoce: Math.round((vA / maior) * 100),
      pctFoe: Math.round((vB / maior) * 100),
      aberto,
      corLabel: aberto ? "#3a2e21" : "#6f5c43",
      tituloDetalhe: m.rotulo + " · DETALHADO",
      notaDetalhe: m.nota,
      temTime,
      detalhes: itA.map(([nome, v], i) => ({
        nome,
        voce: num(v),
        foe: num(itB[i][1]),
        pctVoce: Math.round((v / maxItem) * 100),
        pctFoe: Math.round((itB[i][1] / maxItem) * 100),
      })),
      todosJogadores: todos.map((t, pos) => ({
        pos: pos + 1 + "º",
        nome: t.x.j.nome,
        valor: num(t.x.v),
        pct: Math.round((t.x.v / maxJog) * 100),
        lado: t.meu ? "ALIADO" : "ADVERSÁRIO",
        cor: t.sel ? "#2a2017" : "#5c4c38",
        barra: t.meu ? (t.sel ? "#8f6a2e" : "#b09563") : t.sel ? "#a8442f" : "#c08a7c",
        marca: t.sel ? "◆" : "",
      })),
    };
  });

  const mAberta = METRICAS.find((m) => m.id === metricaAberta) ?? METRICAS[0];

  const ficha = (j: Jogador, i: number, meuLado: boolean) => {
    const partes = j.div.split(" ");
    const ordem = ORDEM[partes[0]] ?? 1;
    const sel = meuLado ? i === iA : i === iB;
    return {
      indice: i,
      nome: j.nome,
      rank: partes[1] ? partes[0] + " " + partes[1] : partes[0],
      ordem: String(ordem),
      corTier: corTier(ordem),
      cor: sel ? "#2a2017" : "#4a3c2c",
      bg: sel ? "rgba(143,106,46,.15)" : "transparent",
      borda: sel ? (meuLado ? "#8f6a2e" : "#a8442f") : "rgba(90,72,48,.22)",
      marca: sel ? (meuLado ? "VOCÊ COMPARA" : "CONTRA") : "",
      destaque:
        num(valorJogador(mAberta, j, meuLado ? spec.venceu : !spec.venceu)) +
        " " + mAberta.rotulo.toLowerCase(),
    };
  };

  // Curva de crescimento: raiz suavizada até o alvo, com colapso na segunda
  // metade para o lado que perdeu — o gráfico conta a virada sem legenda.
  const curva = (alvo: number, colapso: number, seed: number) => {
    const p: string[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      let v = Math.pow(t, 0.72) * alvo;
      if (colapso && t > 0.55) v *= 1 - (t - 0.55) * 1.5 * colapso;
      v *= 1 + (((seed * (i + 3)) % 19) - 9) / 200;
      p.push(i * 64 + "," + Math.round(172 - Math.max(3, v)));
    }
    return p.join(" ");
  };

  const s = hash(spec.id);
  const marcas =
    ({
      2: [[18, 66], [78, 20]],
      4: [[14, 72], [30, 56], [70, 24], [86, 42]],
      6: [[12, 74], [26, 58], [42, 80], [60, 20], [76, 36], [88, 22]],
      8: [[10, 72], [22, 56], [36, 80], [14, 42], [62, 18], [76, 34], [88, 20], [66, 46]],
    } as Record<number, number[][]>)[spec.meu.length * 2] ?? [[18, 66], [78, 20]];

  const todos = [...spec.meu, ...spec.deles];
  const passo = Math.max(1, Math.round(spec.min / 4));

  return {
    partidaTitulo: (spec.venceu ? "VITÓRIA " : "DERROTA ") + spec.fim,
    partidaCor: spec.venceu ? "#3d6b2a" : "#a8442f",
    partidaSub: spec.mapa + " · " + spec.modo + " · " + spec.dur + " · " + spec.data,
    partidaPts: spec.pts,
    temTime,
    ladoEsq: spec.meu[iA].nome.toUpperCase() + " · " + spec.meu[iA].div.toUpperCase(),
    ladoDir: spec.deles[iB].nome.toUpperCase() + " · " + spec.deles[iB].div.toUpperCase(),
    rotuloEquipeMeu: temTime ? "SUA EQUIPE · " + spec.meu.length + " JOGADORES" : "VOCÊ",
    rotuloEquipeSeu: temTime ? "ADVERSÁRIOS · " + spec.deles.length + " JOGADORES" : "OPONENTE",
    metricaAberta: mAberta.rotulo,
    rosterMeu: spec.meu.map((j, i) => ficha(j, i, true)),
    rosterSeu: spec.deles.map((j, i) => ficha(j, i, false)),
    comparativo,
    curvaMinha: curva(spec.venceu ? 142 : 112, spec.venceu ? 0 : 0.55, s),
    curvaDele: curva(spec.venceu ? 108 : 138, spec.venceu ? 0.5 : 0, s + 3),
    curvaPerdas: curva(spec.venceu ? 62 : 96, 0, s + 7),
    eixoTempo: [0, 1, 2, 3]
      .map((i) => String(i * passo).padStart(2, "0") + ":00")
      .concat(spec.dur.slice(0, 2) + ":" + spec.dur.slice(-3, -1)),
    marcadores: todos.map((j, i) => ({
      nome: j.nome.slice(0, 7).toUpperCase(),
      esq: marcas[i][0] + "%",
      topo: marcas[i][1] + "%",
      cor: i < spec.meu.length ? (j.eu ? "#8f6a2e" : "#b39a5e") : "#a8442f",
    })),
    timeline: spec.eventos.map(([tempo, evento]) => ({ tempo, evento })),
  };
}

export type Relatorio = ReturnType<typeof montarRelatorio>;

/** Lista lateral da tela de partidas. */
export const listaPartidas = () =>
  PARTIDAS.map((p) => ({
    id: p.id,
    resultado: p.venceu ? "VITÓRIA" : "DERROTA",
    mapa: p.mapa,
    detalhe: p.modo + " · " + p.min + "min · " + p.pts,
    quando: p.quando,
    cor: p.venceu ? "#94b96f" : "#d08272",
  }));

// --- perfil ---

const bar = (nome: string, valor: string, pct: number) => ({ nome, valor, pct });

export const PAINEIS = {
  geral: {
    tituloEco: "ECONOMIA MÉDIA POR PARTIDA",
    eco: [bar("Madeira", "612", 92), bar("Pedra", "488", 74), bar("Pão", "355", 54), bar("Ferro", "241", 37), bar("Ouro", "196", 30), bar("Vinho", "128", 20)],
    tituloExercito: "EXÉRCITO TREINADO",
    exe: [bar("MILÍCIA", "24", 46), bar("LANCEIRO", "31", 60), bar("BESTEIRO", "18", 35), bar("ESPADA", "42", 82), bar("CAVALO", "51", 100), bar("BÁRBARO", "9", 18)],
    tituloHabitos: "HÁBITOS",
    hab: [
      { nome: "Primeiro quartel", valor: "08:41", nota: "3min mais cedo que a média da sua divisão" },
      { nome: "Pico de população", valor: "min 27", nota: "você cresce tarde e vence tarde" },
      { nome: "Ataque de abertura", valor: "min 19", nota: "raramente pressiona antes disso" },
      { nome: "Horário favorito", valor: "21h–00h", nota: "68% das suas partidas" },
    ],
    rodapeLabel: "Abates / perdas",
    rodapeValor: "1,42",
  },
  economia: {
    tituloEco: "PRODUÇÃO POR HORA DE JOGO",
    eco: [bar("Madeira", "318", 100), bar("Pedra", "254", 80), bar("Pão", "186", 58), bar("Ferro", "124", 39), bar("Ouro", "98", 31), bar("Vinho", "64", 20)],
    tituloExercito: "MÃO DE OBRA",
    exe: [bar("SERVO", "17", 100), bar("LENHADOR", "12", 70), bar("MINEIRO", "11", 64), bar("PEDREIRO", "9", 52), bar("FERREIRO", "7", 41), bar("PADEIRO", "6", 35)],
    tituloHabitos: "HÁBITOS ECONÔMICOS",
    hab: [
      { nome: "Primeira serraria", valor: "03:12", nota: "cedo e consistente — top 10% da divisão" },
      { nome: "Segunda mina", valor: "12:40", nota: "tarde para quem quer chegar a Cavaleiro" },
      { nome: "Pico de servos", valor: "34", nota: "acima do necessário em mapas pequenos" },
      { nome: "Ócio de operários", valor: "8%", nota: "média da divisão: 13%" },
    ],
    rodapeLabel: "Recursos por minuto",
    rodapeValor: "48,4",
  },
  guerra: {
    tituloEco: "ABATES POR TIPO DE TROPA",
    eco: [bar("Espadachim", "24", 100), bar("Cavalaria", "19", 79), bar("Besteiro", "12", 50), bar("Lanceiro", "8", 33), bar("Milícia", "5", 21), bar("Bárbaro", "2", 8)],
    tituloExercito: "PERDAS POR TIPO",
    exe: [bar("CAVALO", "24", 100), bar("MILÍCIA", "14", 58), bar("LANCEIRO", "11", 46), bar("ESPADA", "9", 37), bar("BESTEIRO", "6", 25), bar("BÁRBARO", "3", 12)],
    tituloHabitos: "HÁBITOS DE COMBATE",
    hab: [
      { nome: "Primeiro ataque", valor: "min 19", nota: "raramente pressiona antes disso" },
      { nome: "Vitórias por rendição", valor: "62%", nota: "o resto por aniquilação" },
      { nome: "Recuo bem-sucedido", valor: "71%", nota: "sabe cortar perdas na hora certa" },
      { nome: "Cerco mais longo", valor: "11min", nota: "no Lakeland, temporada II" },
    ],
    rodapeLabel: "Abates / perdas",
    rodapeValor: "1,42",
  },
};

export type AbaPerfil = keyof typeof PAINEIS;

export const KPIS = [
  { valor: "184", label: "PARTIDAS", delta: "+7 esta semana" },
  { valor: "61%", label: "VITÓRIAS", delta: "+3 pts no mês" },
  { valor: "38min", label: "DURAÇÃO MÉDIA", delta: "−2min" },
  { valor: "44", label: "APM MÉDIO", delta: "+5" },
  { valor: "6º", label: "NO RANKING", delta: "subiu 2" },
  { valor: "121h", label: "EM CAMPO", delta: "+4h" },
];

export const MAPAS_PERFIL = [
  { nome: "Cursed Ravine", registro: "18–6", pct: 75 },
  { nome: "Lakeland", registro: "14–7", pct: 67 },
  { nome: "Golden Cliffs", registro: "11–8", pct: 58 },
  { nome: "Across the Desert", registro: "9–12", pct: 43 },
  { nome: "Coastal Encounter", registro: "6–9", pct: 40 },
];

// --- ranking ---

export const STATS_GLOBAIS = [
  { valor: "148", label: "ONLINE AGORA" },
  { valor: "312", label: "PARTIDAS HOJE" },
  { valor: "24min", label: "DURAÇÃO MÉDIA" },
  { valor: "2 914", label: "CONTAS ATIVAS" },
];

export const DIVISOES = (
  [
    ["Camponês", "1", 22], ["Recruta", "2", 19], ["Milícia", "3", 16], ["Lanceiro", "4", 14],
    ["Besteiro", "5", 11], ["Espadachim", "6", 9], ["Cavaleiro", "7", 6], ["Rei", "8", 3],
  ] as [string, string, number][]
).map(([nome, n, pct]) => {
  const meu = nome === "Espadachim";
  return {
    nome, n, pct,
    altura: 26 + pct * 3.6,
    marca: meu ? "VOCÊ · GRAU II" : "",
    fundo: meu ? "linear-gradient(180deg,#eec476,#a87f38)" : "linear-gradient(180deg,#3a2d20,#26201a)",
    borda: meu ? "#eec476" : "#4a3a28",
    corTexto: meu ? "#eec476" : "#a3927a",
  };
});

export const LEADERBOARD = (
  [
    ["1", "Mestre_Lucas", "Rei", "142–39", "+7", "#3d6b2a"],
    ["2", "Bandeirante", "Rei", "128–44", "+4", "#3d6b2a"],
    ["3", "Dom_Bruno", "Cavaleiro III", "119–51", "−2", "#a8442f"],
    ["4", "TupãBR", "Cavaleiro II", "104–48", "+3", "#3d6b2a"],
    ["5", "Ana_Serralheira", "Cavaleiro I", "98–52", "+1", "#3d6b2a"],
    ["6", JOGADOR, "Espadachim II", "112–71", "+5", "#3d6b2a"],
    ["7", "Vilarejo", "Espadachim II", "87–58", "−4", "#a8442f"],
    ["8", "Ferreiro_Zé", "Espadachim I", "81–60", "+2", "#3d6b2a"],
  ] as [string, string, string, string, string, string][]
).map(([pos, nome, divisao, registro, forma, corForma]) => ({
  pos, nome, divisao, registro, forma, corForma,
  fundo: nome === JOGADOR ? "rgba(143,106,46,.15)" : "transparent",
}));

export const MAPAS_TOP = [
  { nome: "Cursed Ravine", qtd: "418", pct: 100 },
  { nome: "Across the Desert", qtd: "366", pct: 88 },
  { nome: "Golden Cliffs", qtd: "301", pct: 72 },
  { nome: "Lakeland", qtd: "264", pct: 63 },
  { nome: "Coastal Encounter", qtd: "197", pct: 47 },
];

const dias = [212, 268, 301, 254, 330, 388, 412, 276, 244, 318, 356, 402, 371, 344];
const maxDia = Math.max(...dias);
export const PARTIDAS_DIA = dias.map((x) => ({ pct: Math.round((x / maxDia) * 100) }));

// --- replays / mapas ---

export const REPLAYS = [
  { mapa: "Cursed Ravine", contra: "contra Mestre_Lucas", resultado: "VITÓRIA", cor: "#94b96f", meta: "34min · 2,1 MB · v0.15.2" },
  { mapa: "Across the Desert", contra: "contra Bandeirante", resultado: "DERROTA", cor: "#d08272", meta: "41min · 2,6 MB · v0.15.2" },
  { mapa: "Golden Cliffs", contra: "com Vilarejo · 2v2", resultado: "VITÓRIA", cor: "#94b96f", meta: "28min · 1,8 MB · v0.15.1" },
  { mapa: "Lakeland", contra: "contra Dom_Bruno", resultado: "VITÓRIA", cor: "#94b96f", meta: "52min · 3,4 MB · v0.15.1" },
  { mapa: "Coastal Encounter", contra: "FFA · 4 jogadores", resultado: "DERROTA", cor: "#d08272", meta: "39min · 3,0 MB · v0.15.1" },
  { mapa: "Valley of Ashes", contra: "contra TupãBR", resultado: "VITÓRIA", cor: "#94b96f", meta: "22min · 1,4 MB · v0.15.0" },
];

export const MAPAS = [
  { nome: "Cursed Ravine", jogadores: "2P", partidas: "418 partidas", winrate: "75%" },
  { nome: "Across the Desert", jogadores: "2P", partidas: "366 partidas", winrate: "43%" },
  { nome: "Golden Cliffs", jogadores: "4P", partidas: "301 partidas", winrate: "58%" },
  { nome: "Lakeland", jogadores: "2P", partidas: "264 partidas", winrate: "67%" },
  { nome: "Coastal Encounter", jogadores: "4P", partidas: "197 partidas", winrate: "40%" },
  { nome: "Valley of Ashes", jogadores: "2P", partidas: "154 partidas", winrate: "62%" },
  { nome: "Serra do Mar", jogadores: "6P", partidas: "121 partidas", winrate: "—" },
  { nome: "Wolfsberg", jogadores: "4P", partidas: "98 partidas", winrate: "55%" },
];

// --- temporada / conquistas ---

export const RECOMPENSAS = [
  { nivel: "5", nome: "Selo de temporada", estado: "RESGATADO", fundo: "linear-gradient(180deg,#eec476,#a87f38)", borda: "#eec476", cor: "#241d17" },
  { nivel: "10", nome: "Moldura de perfil", estado: "RESGATADO", fundo: "linear-gradient(180deg,#eec476,#a87f38)", borda: "#eec476", cor: "#241d17" },
  { nivel: "15", nome: "Estandarte do vale", estado: "FALTAM 3 NÍVEIS", fundo: "#241d17", borda: "#6b5330", cor: "#d4a24a" },
  { nivel: "25", nome: "Título: Guardião", estado: "BLOQUEADO", fundo: "#1e1813", borda: "#3a2d20", cor: "#7d6b53" },
  { nivel: "40", nome: "Brasão dourado", estado: "BLOQUEADO", fundo: "#1e1813", borda: "#3a2d20", cor: "#7d6b53" },
  { nivel: "50", nome: "Coroa da temporada", estado: "BLOQUEADO", fundo: "#1e1813", borda: "#3a2d20", cor: "#7d6b53" },
];

export const MISSOES = [
  { nome: "Vencer 5 partidas ranqueadas", progresso: "3 / 5", pct: 60 },
  { nome: "Produzir 4 000 recursos no total", progresso: "3 120 / 4 000", pct: 78 },
  { nome: "Treinar 100 soldados", progresso: "64 / 100", pct: 64 },
  { nome: "Jogar 3 mapas diferentes", progresso: "2 / 3", pct: 67 },
];

export const TEMPORADAS = [
  { nome: "Temporada II · A Grande Colheita", periodo: "mar – mai 2026", divisao: "Besteiro III", posicao: "14º de 2 108" },
  { nome: "Temporada I · Primeiros Muros", periodo: "dez 2025 – fev 2026", divisao: "Lanceiro I", posicao: "63º de 1 447" },
  { nome: "Pré-temporada", periodo: "out – nov 2025", divisao: "sem divisão", posicao: "—" },
];

export const CONQUISTAS = [
  { sigla: "I", nome: "Primeira Pedra", desc: "Ganhe sua primeira partida ranqueada.", progresso: "1 / 1", pct: 100, fundo: "linear-gradient(180deg,#eec476,#a87f38)", borda: "#eec476", cor: "#eec476" },
  { sigla: "II", nome: "Mestre Serralheiro", desc: "Produza 100 espadas em uma única partida.", progresso: "100 / 100", pct: 100, fundo: "linear-gradient(180deg,#eec476,#a87f38)", borda: "#eec476", cor: "#eec476" },
  { sigla: "III", nome: "Cerco Perfeito", desc: "Vença sem perder uma única unidade.", progresso: "0 / 1", pct: 0, fundo: "#241d17", borda: "#4a3a28", cor: "#a3927a" },
  { sigla: "IV", nome: "Celeiro Cheio", desc: "Alcance 300 de população em uma partida.", progresso: "214 / 300", pct: 71, fundo: "#241d17", borda: "#6b5330", cor: "#d4a24a" },
  { sigla: "V", nome: "Veterano do Vale", desc: "Jogue 250 partidas ranqueadas.", progresso: "184 / 250", pct: 74, fundo: "#241d17", borda: "#6b5330", cor: "#d4a24a" },
  { sigla: "VI", nome: "Cartógrafo", desc: "Vença ao menos uma vez em 20 mapas distintos.", progresso: "13 / 20", pct: 65, fundo: "#241d17", borda: "#6b5330", cor: "#d4a24a" },
  { sigla: "VII", nome: "Rei do Inverno", desc: "Termine uma temporada na divisão Rei.", progresso: "0 / 1", pct: 0, fundo: "#241d17", borda: "#4a3a28", cor: "#a3927a" },
  { sigla: "VIII", nome: "Anfitrião", desc: "Suba um servidor e receba 50 partidas.", progresso: "12 / 50", pct: 24, fundo: "#241d17", borda: "#4a3a28", cor: "#a3927a" },
];

// --- notícias ---

export const NOTICIAS_CURTAS = [
  { data: "08 AGO", titulo: "Temporada III entra na reta final", resumo: "Últimos 22 dias para garantir a divisão. Recompensas trancam à meia-noite do dia 31." },
  { data: "05 AGO", titulo: "v0.15.2 · correções de dessincronia", resumo: "Corrigido o travamento ao carregar mapas com mais de quatro jogadores." },
  { data: "01 AGO", titulo: "Oito mapas brasileiros no rodízio", resumo: "Serra do Mar e Vale do Café entram nas partidas ranqueadas." },
];

export const NOTICIAS = [
  { tag: "TEMPORADA", data: "08 de agosto", titulo: "Temporada III entra na reta final", corpo: "Faltam 22 dias. Quem terminar em Cavaleiro ou acima leva o brasão dourado e a moldura da temporada. O reset é parcial: você começa a IV três divisões abaixo de onde parar." },
  { tag: "VERSÃO 0.15.2", data: "05 de agosto", titulo: "Correções de dessincronia e desempenho", corpo: "Corrigido o travamento ao carregar mapas com mais de quatro jogadores. A lista de servidores agora atualiza sem recarregar a aba. Replays antigos continuam compatíveis." },
  { tag: "MAPAS", data: "1º de agosto", titulo: "Oito mapas brasileiros no rodízio ranqueado", corpo: "Serra do Mar, Vale do Café e mais seis mapas da comunidade entram no sorteio. O rodízio muda a cada duas semanas, sempre com voto aberto na taverna." },
  { tag: "TORNEIO", data: "28 de julho", titulo: "Copa da Colheita: inscrições na sexta", corpo: "Chaves de 16, melhor de três, mapas sorteados entre os cinco mais jogados. Premiação em títulos exclusivos e a coroa da temporada." },
];

export const NUMEROS_REINO = [
  { label: "Contas registradas", valor: "2 914" },
  { label: "Partidas nesta temporada", valor: "18 402" },
  { label: "Horas em campo", valor: "11 730" },
  { label: "Replays guardados", valor: "6 118" },
];

export const MOTD =
  "Torneio da Colheita abre inscrições sexta. Chaves de 16, melhor de três, mapas sorteados entre os cinco mais jogados.";

// --- dock ---

export const AMIGOS = [
  { inicial: "L", nome: "Mestre_Lucas", estado: "EM PARTIDA · CURSED RAVINE", cor: "#d4a24a", divisao: "REI" },
  { inicial: "V", nome: "Vilarejo", estado: "NO LOBBY · AGUARDANDO", cor: "#94b96f", divisao: "ESP II" },
  { inicial: "A", nome: "Ana_Serralheira", estado: "ONLINE", cor: "#94b96f", divisao: "CAV I" },
  { inicial: "T", nome: "TupãBR", estado: "EM PARTIDA · LAKELAND", cor: "#d4a24a", divisao: "CAV II" },
  { inicial: "Z", nome: "Ferreiro_Zé", estado: "ONLINE", cor: "#94b96f", divisao: "ESP I" },
  { inicial: "B", nome: "Dom_Bruno", estado: "AUSENTE HÁ 12MIN", cor: "#7d6b53", divisao: "CAV III" },
];

export const CHAT = [
  { autor: "Vilarejo", hora: "21:02", texto: "alguém para 2v2 no Golden Cliffs? falta um", cor: "#d4a24a" },
  { autor: "Ana_Serralheira", hora: "21:03", texto: "entro, mas só depois de terminar essa aqui", cor: "#94b96f" },
  { autor: "Mestre_Lucas", hora: "21:05", texto: "raposo, boa aquela virada no vale norte", cor: "#eec476" },
  { autor: "Ferreiro_Zé", hora: "21:06", texto: "o novo rodízio de mapas ficou muito bom", cor: "#a3927a" },
  { autor: "TupãBR", hora: "21:08", texto: "quem vai na copa da colheita?", cor: "#a3927a" },
];

/** Números do herói e da barra lateral. */
export const ONLINE = { jogadores: "148", abertas: "9", disputa: "23" };
export const PATENTE = { titulo: "Espadachim II", temporada: "TEMPORADA III", pct: 68 };
