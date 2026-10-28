/**
 * MOTORBASE1-CATEGORIAS-HIERARCHY-FIX-01 — projeção hierárquica sem double-filter na grade.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import {
  projectCategoriasGradeRows,
  getCategoriasListFooterMetrics,
} from "@/components/categorias-produto/TabelaCategoriasProduto.jsx";
import TabelaCategoriasProduto from "@/components/categorias-produto/TabelaCategoriasProduto.jsx";

const ARVORE = [
  { id: "raiz", nome: "Raiz", ordem: 1, ativo: true },
  { id: "filha", nome: "Filha", categoria_pai_id: "raiz", ordem: 1, ativo: true },
  { id: "neta", nome: "Neta", categoria_pai_id: "filha", ordem: 1, ativo: true },
  { id: "outra", nome: "Outra raiz", ordem: 2, ativo: true },
];

/** @type {object[]} */
let gridRows = [];

vi.mock("@/components/cadastro/base1/Base1Grid", () => ({
  default: function MockBase1Grid(props) {
    gridRows = props.rows ?? [];
    return (
      <div data-testid="mock-base1-grid" data-row-ids={gridRows.map((r) => r.id).join(",")} />
    );
  },
}));

vi.mock("@/components/cadastro/base1/Base1Cards", () => ({
  Base1Cards: () => <div data-testid="mock-base1-cards" />,
}));

describe("projectCategoriasGradeRows — projeção pura", () => {
  it("busca por descendente inclui ancestrais na projeção", () => {
    const rows = projectCategoriasGradeRows(ARVORE, { appliedSearch: "neta" });
    expect(rows.map((r) => r.id)).toEqual(["raiz", "filha", "neta", "outra"]);
  });

  it("rodapé listados acompanha projeção (sem expand manual)", () => {
    const metrics = getCategoriasListFooterMetrics(ARVORE, {
      appliedSearch: "neta",
      searchPickId: null,
      matchCount: 1,
      revealRowId: null,
    });
    expect(metrics.filtrados).toBe(1);
    expect(metrics.totais).toBe(4);
    expect(metrics.listados).toBe(4);
  });
});

describe("TabelaCategoriasProduto + CadastroBase1Grade real — sem double-filter", () => {
  beforeEach(() => {
    gridRows = [];
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("grade recebe ancestrais visíveis quando busca aponta para folha", async () => {
    const matchesSearch = (item, q) => {
      const hay = [item.nome, item.descricao].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    };

    render(
      <TabelaCategoriasProduto
        categorias={ARVORE}
        searchQuery="neta"
        matchesSearch={matchesSearch}
        onEdit={() => {}}
        viewMode="table"
      />,
    );

    await waitFor(() => {
      expect(gridRows.length).toBeGreaterThan(0);
    });

    expect(gridRows.map((r) => r.id)).toEqual(["raiz", "filha", "neta", "outra"]);
  });
});
