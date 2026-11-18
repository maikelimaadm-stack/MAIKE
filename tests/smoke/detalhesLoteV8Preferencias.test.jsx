// @vitest-environment jsdom
/**
 * Detalhes do Lote — preferências e memória da aba Lotes. Era o teste do v8
 * (seções do "Filtrar" por usuário, "sempre Resumo"); no v12 (D-PROD-218):
 *  1. as COLUNAS da Lista (Configurar tabela) são preferência do usuário
 *     (fazenda + conta + empresa, D-PROD-135), padrão Alertas + Lotação + Pesagem;
 *  2. sem as três partes do escopo, vale o padrão e nada é gravado;
 *  3. a vista começa na Lista no desktop/tablet e no Resumo no celular (D5) e
 *     fica lembrada POR ÁREA na sessão; a posição do lote na vista Lote também.
 * Componentes REAIS na casca de teste; sem rede.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { CascaDeTeste, modeloV12 } from "./fixtures/pastoV12.jsx";
import { chavePreferencias } from "@/components/mapa/detalhes-lote/preferencias";
import { COLUNAS_PADRAO } from "@/components/mapa/detalhes-lote/catalogo";
import { esquecerEstadoLotes } from "@/components/mapa/detalhes-lote/useEstadoLotes";

const ANA = { clienteId: "c-1", login: "ana", empresaId: "emp-1" };
const BRUNO = { clienteId: "c-1", login: "bruno", empresaId: "emp-1" };
const modelo = modeloV12();

const clicar = (el) => act(async () => { fireEvent.click(el); });
const vistaAtiva = () => ["Resumo", "Lote", "Lista"].find((v) => screen.getByRole("button", { name: v, exact: true }).getAttribute("aria-pressed") === "true");
const colunas = () => screen.getAllByRole("columnheader").filter((th) => th.querySelector("button")).map((th) => th.querySelector("button span").textContent).slice(1);
const salvo = (escopo) => JSON.parse(window.localStorage.getItem(chavePreferencias(escopo)) || "null");
const abrirConfigurar = () => clicar(screen.getByRole("button", { name: "Configurar tabela" }));

beforeEach(() => {
  window.localStorage.clear();
  esquecerEstadoLotes();
});
afterEach(() => cleanup());

describe("Detalhes do Lote v12: colunas da Lista por usuário", () => {
  it("sem preferência salva: Alertas + Lotação + Pesagem; Identificação desligada", async () => {
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    expect(vistaAtiva()).toBe("Lista");
    expect(colunas()).toHaveLength(COLUNAS_PADRAO.length);
    expect(colunas()).toEqual(expect.arrayContaining(["Situação", "Cab.", "Peso projetado (kg)", "Última", "Origem"]));
    for (const c of ["Sexo", "Sist. Rep.", "Identificador", "Sigla", "Entrada", "Cat. de manejo"]) expect(colunas()).not.toContain(c);
    await abrirConfigurar();
    const contadores = [...document.querySelectorAll(".mk-dp-grupo__n")].map((n) => n.textContent);
    expect(contadores).toEqual(["3/3", "10/10", "15/15", "0/6"]);
  });

  it("o que o usuário aplica fica salvo para ELE e volta na próxima abertura; outro usuário começa no padrão", async () => {
    const primeira = render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    await abrirConfigurar();
    await clicar(screen.getByRole("checkbox", { name: /Identificação/ }));
    await clicar(screen.getByRole("checkbox", { name: "Situação" }));
    await clicar(screen.getByRole("button", { name: "Aplicar" }));

    const esperado = [...COLUNAS_PADRAO.filter((k) => k !== "alNivel"), "sexo", "sist", "ident", "sigla", "entrada", "manejo"];
    expect(salvo(ANA)).toEqual({ colunasLote: esperado });
    expect(colunas()).toContain("Sexo");
    expect(colunas()).not.toContain("Situação");
    primeira.unmount();

    // Mesma conta: a preferência volta.
    const segunda = render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    expect(colunas()).toHaveLength(esperado.length);
    expect(colunas()[0]).toBe("Tipo de alerta");
    segunda.unmount();

    // Outra conta no mesmo aparelho: não herda.
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={BRUNO} />);
    expect(colunas()).toHaveLength(COLUNAS_PADRAO.length);
    expect(colunas()[0]).toBe("Situação");
  });

  it("a Lista que ficou montada por baixo da tela empilhada troca as colunas ao Aplicar (sem remontar)", async () => {
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} manterPasto />);
    const tabela = screen.getByRole("table");
    await abrirConfigurar();
    await clicar(screen.getByRole("checkbox", { name: /Alertas/ }));
    await clicar(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByRole("table")).toBe(tabela);
    expect(colunas()[0]).toBe("Cab.");
  });

  it("lista vazia é escolha do usuário: só a coluna do nome", async () => {
    window.localStorage.setItem(chavePreferencias(ANA), JSON.stringify({ colunasLote: [] }));
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    expect(colunas()).toEqual([]);
    expect(screen.getAllByRole("rowheader").map((c) => c.textContent).at(-1)).toBe("Total da área");
  });

  it("preferência antiga do v8 (seções) não vale; chave desconhecida é ignorada; JSON quebrado → padrão", () => {
    window.localStorage.setItem(chavePreferencias(ANA), JSON.stringify({ secoesLote: ["Identificação"], secoesArea: ["Área"] }));
    const um = render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    expect(colunas()).toHaveLength(COLUNAS_PADRAO.length);
    um.unmount();

    window.localStorage.setItem(chavePreferencias(ANA), JSON.stringify({ colunasLote: ["sexo", "raca", "cab", "sexo"] }));
    const dois = render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    expect(colunas()).toEqual(["Cab.", "Sexo"]);
    dois.unmount();

    window.localStorage.setItem(chavePreferencias(ANA), "{quebrado");
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    expect(colunas()).toHaveLength(COLUNAS_PADRAO.length);
  });
});

describe("Detalhes do Lote v12: vista e posição lembradas por área na sessão", () => {
  it("vista inicial por modo: Lista no desktop e no tablet, Resumo no celular", () => {
    for (const [modo, vista] of [["desktop", "Lista"], ["tablet", "Lista"], ["celular", "Resumo"]]) {
      esquecerEstadoLotes();
      const r = render(<CascaDeTeste modelo={modelo} modo={modo} />);
      expect(vistaAtiva(), modo).toBe(vista);
      r.unmount();
    }
  });

  it("a vista escolhida volta ao reabrir o MESMO pasto (e ao sair e voltar para a aba); outro pasto abre no padrão", async () => {
    const primeira = render(<CascaDeTeste modelo={modelo} />);
    await clicar(screen.getByRole("button", { name: "Resumo", exact: true }));
    await clicar(screen.getByRole("tab", { name: "Detalhes" }));
    await clicar(screen.getByRole("tab", { name: /^Lotes/ }));
    expect(vistaAtiva()).toBe("Resumo");
    primeira.unmount();

    const segunda = render(<CascaDeTeste modelo={modelo} />);
    expect(vistaAtiva()).toBe("Resumo");
    segunda.unmount();

    render(<CascaDeTeste modelo={modelo} areaId="outro-pasto" />);
    expect(vistaAtiva()).toBe("Lista");
  });

  it("a posição do lote na vista Lote também volta ao reabrir o pasto", async () => {
    const primeira = render(<CascaDeTeste modelo={modelo} />);
    await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
    await clicar(screen.getByRole("button", { name: "Próximo lote" }));
    await clicar(screen.getByRole("button", { name: "Próximo lote" }));
    expect(document.querySelector(".mk-dp-nav__sub").textContent).toBe("3 de 6");
    primeira.unmount();

    render(<CascaDeTeste modelo={modelo} />);
    expect(vistaAtiva()).toBe("Lote");
    expect(document.querySelector(".mk-dp-nav__titulo").textContent).toBe("L-2026-019");
    expect(document.querySelector(".mk-dp-nav__sub").textContent).toBe("3 de 6");
  });

  it("nada disso vai para o localStorage", async () => {
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={ANA} />);
    await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
    await clicar(screen.getByRole("button", { name: "Próximo lote" }));
    expect(window.localStorage.length).toBe(0);
  });
});

// Por último: a escolha sem escopo vale só na sessão (memória do módulo).
describe("Detalhes do Lote v12: sem escopo do usuário (conta ainda carregando)", () => {
  it("padrão e nada é gravado", async () => {
    render(<CascaDeTeste modelo={modelo} escopoPreferencias={null} />);
    expect(colunas()).toHaveLength(COLUNAS_PADRAO.length);
    await abrirConfigurar();
    await clicar(screen.getByRole("checkbox", { name: /Pesagem/ }));
    await clicar(screen.getByRole("button", { name: "Aplicar" }));
    expect(colunas()).toHaveLength(13);
    expect(window.localStorage.length).toBe(0);
  });
});
