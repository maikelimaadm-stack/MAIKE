// @vitest-environment jsdom
/**
 * UI-DETALHES-LOTE-V8 — pedido do dono depois do teste no preview:
 *  1. o que fica marcado no "Filtrar" (Lotes) e no "Mostrar informações" (Área)
 *     é PREFERÊNCIA DO USUÁRIO (fazenda + conta + empresa), como os filtros do mapa;
 *  2. sem preferência, começa SEM FILTRO (tudo marcado, todos os lotes);
 *  3. entrar em Lotes abre sempre no Resumo (também no desktop).
 * Painel REAL com o modelo do catálogo; sem rede.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import PainelDetalhesLote from "@/components/mapa/detalhes-lote/PainelDetalhesLote";
import { montarModeloDetalhes } from "@/components/mapa/detalhes-lote/catalogo";
import { chavePreferencias } from "@/components/mapa/detalhes-lote/preferencias";

const lote = (id, extra = {}) => ({
  id, posicao_id: id, __posicao: true, nome: `LOTE ${id}`, categoria: "BOI MAGRO", sexo: "Macho", quantidade_cabecas: 20,
  peso_medio_kg: 380, area_atual_id: "a1", status: "Ativo", data_entrada: "2026-06-01", ...extra,
});
const modelo = montarModeloDetalhes({
  area: { id: "a1", nome: "PASTO A", tamanho_hectares: 50, tipo_pastagem: "Brachiaria", tipo_cultura: "Pastagem" },
  lotes: [lote("p1"), lote("p2")], lotesDaArea: [], movimentacoes: [], categoriasManejo: [], hoje: new Date(2026, 10, 9),
});
const ANA = { clienteId: "c-1", login: "ana", empresaId: "emp-1" };
const BRUNO = { clienteId: "c-1", login: "bruno", empresaId: "emp-1" };

const abrir = (escopo) => render(<PainelDetalhesLote modelo={modelo} suplementacao={null} acoes={null} escopoPreferencias={escopo} />);
const clicar = (el) => act(async () => { fireEvent.click(el); });
const aba = (nome) => clicar(screen.getByRole("tab", { name: new RegExp(`^${nome}`) }));
const vistaAtiva = () => ["Resumo", "Lote", "Lista"].find((v) => screen.getByRole("button", { name: v, exact: true }).getAttribute("aria-pressed") === "true");
const abrirFiltrar = () => clicar(screen.getByRole("combobox", { name: "Filtrar" }));
const marcada = (nome) => within(screen.getByRole("listbox", { name: "Informações" })).getByRole("option", { name: nome }).getAttribute("aria-selected") === "true";

beforeEach(() => {
  window.localStorage.clear();
  // Desktop: antes desta mudança o desktop abria na Lista.
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width: 1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => cleanup());

describe("Detalhes do Lote v8: preferências por usuário, sem filtro de início, Resumo ao entrar em Lotes", () => {
  it("sem preferência salva: tudo marcado (sem filtro), todos os lotes e vista Resumo — também no desktop", async () => {
    abrir(ANA);
    await aba("Lotes");
    expect(vistaAtiva()).toBe("Resumo");
    expect(screen.getByRole("combobox", { name: "Filtrar" }).textContent).toContain("Todas");
    await abrirFiltrar();
    for (const s of ["Todas", "Alertas", "Lotação", "Pesagem", "Identificação"]) expect(marcada(s), s).toBe(true);
    const alertas = within(screen.getByRole("listbox", { name: "Alertas" }));
    expect(alertas.getByRole("option", { name: /Todos os lotes/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("o que o usuário desmarca fica salvo para ELE e volta na próxima abertura; outro usuário começa sem filtro", async () => {
    const primeira = abrir(ANA);
    await aba("Lotes");
    await abrirFiltrar();
    await clicar(within(screen.getByRole("listbox", { name: "Informações" })).getByRole("option", { name: "Identificação" }));
    expect(JSON.parse(window.localStorage.getItem(chavePreferencias(ANA)) || "{}").secoesLote).toEqual(["Alertas", "Lotação", "Pesagem"]);
    primeira.unmount();

    // Mesma conta: a preferência volta.
    const segunda = abrir(ANA);
    await aba("Lotes");
    expect(screen.getByRole("combobox", { name: "Filtrar" }).textContent).toContain("3 selecionadas");
    segunda.unmount();

    // Outra conta no mesmo aparelho: não herda — começa sem filtro.
    abrir(BRUNO);
    await aba("Lotes");
    expect(screen.getByRole("combobox", { name: "Filtrar" }).textContent).toContain("Todas");
  });

  it("aba Área: o 'Mostrar informações' também é preferência do usuário", async () => {
    const primeira = abrir(ANA);
    await aba("Área");
    await clicar(screen.getByRole("combobox", { name: "Mostrar informações" }));
    await clicar(within(screen.getByRole("listbox", { name: "Mostrar informações" })).getByRole("option", { name: "Categorias" }));
    expect(JSON.parse(window.localStorage.getItem(chavePreferencias(ANA)) || "{}").secoesArea).toEqual(["Área", "Lotação"]);
    primeira.unmount();
    abrir(ANA);
    await aba("Área");
    expect(screen.getByRole("combobox", { name: "Mostrar informações" }).textContent).toContain("2 selecionadas");
  });

  it("sem escopo do usuário (conta ainda carregando): padrão sem filtro e nada é gravado", async () => {
    abrir(null);
    await aba("Lotes");
    await abrirFiltrar();
    await clicar(within(screen.getByRole("listbox", { name: "Informações" })).getByRole("option", { name: "Pesagem" }));
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it("sair de Lotes na Lista e voltar: abre de novo no Resumo", async () => {
    abrir(ANA);
    await aba("Lotes");
    await clicar(screen.getByRole("button", { name: "Lista", exact: true }));
    expect(vistaAtiva()).toBe("Lista");
    await aba("Área");
    await aba("Lotes");
    expect(vistaAtiva()).toBe("Resumo");
  });
});
