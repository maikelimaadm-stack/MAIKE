import { describe, it, expect } from "vitest";
import {
  SELETOR_CAMADA_ANINHADA_DO_FILTRO,
  deveFecharFiltroPorFora,
  ehCamadaAninhadaDoFiltro,
} from "@/components/cadastro/base1/cadastroColunaFiltroCamada";

function alvoComClosest(resposta) {
  return {
    closest: (sel) => (sel === SELETOR_CAMADA_ANINHADA_DO_FILTRO ? resposta : null),
  };
}

describe("cadastroColunaFiltroCamada — paridade CDE 357–360", () => {
  it("seletor não inclui popover genérico da grade/toolbar", () => {
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).not.toContain("mg-b1-glass-pop");
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).not.toContain("data-radix-popover-content");
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).toContain("data-filtro-camada");
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).toContain(".foperadores");
  });

  it("fecha com fora real sem camada aninhada", () => {
    const shell = {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 300, bottom: 400 }),
      contains: () => false,
    };
    expect(
      deveFecharFiltroPorFora({
        alvo: alvoComClosest(null),
        ponto: { clientX: 10, clientY: 10 },
        shell,
        doc: { querySelector: () => null },
      }),
    ).toBe(true);
  });

  it("não fecha quando o alvo é camada do operador", () => {
    const shell = {
      contains: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    };
    expect(
      deveFecharFiltroPorFora({
        alvo: alvoComClosest({}),
        ponto: { clientX: 10, clientY: 10 },
        shell,
        doc: { querySelector: () => null },
      }),
    ).toBe(false);
    expect(ehCamadaAninhadaDoFiltro(alvoComClosest({}))).toBe(true);
  });
});
