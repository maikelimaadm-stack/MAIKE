// @vitest-environment jsdom
/** D-PROD-133 — Tarefas do mapa em cards, no padrão dos cadastros (sem a tabela antiga). */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import TarefasCardsMapa from "@/components/tarefas/TarefasCardsMapa";

beforeAll(() => {
  // jsdom não tem scrollIntoView (os cards rolam até o selecionado).
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const TAREFAS = [
  { id: "t1", titulo: "Consertar cerca", status: "Pendente", prioridade: "Alta", area_nome: "PASTO A", responsavel: "João", data_prevista: "2026-11-08" },
  { id: "t2", titulo: "Limpar bebedouro", status: "Em Andamento", prioridade: "Média", area_nome: "PASTO B", responsavel: "Pedro", data_prevista: "2026-11-06" },
];

describe("Tarefas em cards (D-PROD-133)", () => {
  it("o painel usa os cards e a tabela antiga saiu", () => {
    const painel = readFileSync("src/components/mapa/TarefasMapaPanel.jsx", "utf8");
    expect(painel).toMatch(/<TarefasCardsMapa/);
    expect(painel).not.toMatch(/TabelaLancamentosTarefas/);
    expect(existsSync("src/components/tarefas/TabelaLancamentosTarefas.jsx")).toBe(false);
  });

  it("mostra um card por tarefa, com título, status e prazo formatado", () => {
    render(<TarefasCardsMapa tarefas={TAREFAS} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />);
    const cards = screen.getAllByTestId("b1-card");
    expect(cards).toHaveLength(2);
    const cerca = cards.find((c) => c.textContent.includes("Consertar cerca"));
    expect(cerca).toBeTruthy();
    expect(within(/** @type {HTMLElement} */ (cerca)).getByText("Pendente")).toBeTruthy();
    expect(cerca?.textContent).toContain("08/11/2026");
    expect(screen.getByText("Totais: 2")).toBeTruthy();
  });

  it("+ cria nova tarefa; selecionar e editar abre a tarefa escolhida", () => {
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    render(<TarefasCardsMapa tarefas={TAREFAS} onAdd={onAdd} onEdit={onEdit} onDelete={() => {}} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Nova tarefa/ })[0]);
    expect(onAdd).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Limpar bebedouro" }));
    expect(screen.getByText("Selecionados: 1")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /^Editar/ })[0]);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));
  });
});
