import { describe, it, expect } from "vitest";
import {
  SELETOR_CAMADA_ANINHADA_DO_FILTRO,
  deveFecharFiltroPorFora,
  ehCamadaAninhadaDoFiltro,
  haCamadaAninhadaDoFiltroAberta,
  ponteiroSobreCamadaAninhada,
} from "@/components/cadastro/base1/cadastroColunaFiltroCamada";

function alvoComCamadaAninhada() {
  const el = document.createElement("div");
  el.setAttribute("data-filtro-camada", "");
  return el;
}

function alvoSemCamadaAninhada() {
  return document.createElement("span");
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
        alvo: alvoSemCamadaAninhada(),
        ponto: { clientX: 10, clientY: 10 },
        shell,
        doc: { querySelector: () => null },
      }),
    ).toBe(true);
  });

  it("não trata .b1-dp-filtro fechado como camada aninhada aberta", () => {
    const doc = {
      querySelector: (sel) => {
        if (sel.includes("b1-dp-filtro")) return document.createElement("div");
        if (sel.includes("data-state='open'")) return null;
        return null;
      },
    };
    expect(haCamadaAninhadaDoFiltroAberta(doc)).toBe(false);
    expect(SELETOR_CAMADA_ANINHADA_DO_FILTRO).not.toContain(".b1-dp-filtro");
  });

  it("bloqueia dismiss quando o ponteiro está sobre o calendário aberto", () => {
    const painel = document.createElement("div");
    painel.className = "mg-dp-panel";
    painel.setAttribute("data-state", "open");
    painel.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
    const doc = {
      querySelector: (sel) => (sel.includes("data-state='open'") ? painel : null),
      querySelectorAll: (sel) => (sel.includes("data-state='open'") ? [painel] : []),
    };
    const shell = {
      contains: () => false,
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 200 }),
    };
    expect(
      deveFecharFiltroPorFora({
        alvo: document.createElement("span"),
        ponto: { clientX: 10, clientY: 10 },
        shell,
        doc,
      }),
    ).toBe(false);
    expect(ponteiroSobreCamadaAninhada({ clientX: 10, clientY: 10 }, doc)).toBe(true);
  });

  it("não fecha quando o alvo é camada do operador", () => {
    const shell = {
      contains: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    };
    const alvo = alvoComCamadaAninhada();
    expect(
      deveFecharFiltroPorFora({
        alvo,
        ponto: { clientX: 10, clientY: 10 },
        shell,
        doc: { querySelector: () => null, querySelectorAll: () => [] },
      }),
    ).toBe(false);
    expect(ehCamadaAninhadaDoFiltro(alvo)).toBe(true);
  });

  it("fecha com clique fora mesmo se houver cmd-panel fechado na página", () => {
    const fechado = document.createElement("div");
    fechado.className = "cmd-panel";
    fechado.setAttribute("data-state", "closed");
    document.body.appendChild(fechado);
    try {
      expect(haCamadaAninhadaDoFiltroAberta(document)).toBe(false);
      expect(
        deveFecharFiltroPorFora({
          alvo: alvoSemCamadaAninhada(),
          ponto: { clientX: 10, clientY: 10 },
          shell: {
            contains: () => false,
            getBoundingClientRect: () => ({ left: 100, top: 100, right: 300, bottom: 400 }),
          },
          doc: document,
        }),
      ).toBe(true);
    } finally {
      fechado.remove();
    }
  });
});
