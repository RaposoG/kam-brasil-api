import { describe, expect, test } from "bun:test";

import { impedimentoParaFila } from "./install";
import type { Acao } from "./install";

describe("quem pode entrar na fila ranqueada", () => {
  test("só passa quem já poderia abrir o jogo", () => {
    expect(impedimentoParaFila("jogar")).toBe("");
  });

  test("todo estado que não é 'jogar' barra, com motivo", () => {
    // O motivo importa tanto quanto o bloqueio: botão apagado sem explicação é
    // o jogador achando que o launcher quebrou.
    const barrados: Acao[] = ["original", "instalar", "preparar", "esperar", "semVersao"];
    for (const acao of barrados) {
      const motivo = impedimentoParaFila(acao);
      expect(motivo.length, `${acao} deveria barrar`).toBeGreaterThan(0);
      expect(motivo, `${acao} deveria dizer onde resolver`).toContain("JOGAR");
    }
  });
});

describe("versão desatualizada barra a fila", () => {
  test("launcher velho barra, mesmo com o jogo pronto", () => {
    // Versão diferente entre jogadores é desync, e desync em ranqueada é rating
    // perdido de quem não fez nada errado.
    const motivo = impedimentoParaFila("jogar", "1.5.0");
    expect(motivo).toContain("1.5.0");
    expect(motivo).toContain("launcher");
  });

  test("launcher atual não barra", () => {
    expect(impedimentoParaFila("jogar", null)).toBe("");
  });

  test("launcher velho tem precedência sobre o motivo do jogo", () => {
    // Mostrar "instale o jogo" para quem também precisa atualizar o launcher
    // faria o jogador resolver o segundo problema e continuar barrado.
    expect(impedimentoParaFila("instalar", "1.5.0")).toContain("launcher");
  });
});
