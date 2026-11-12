/**
 * D-PROD-164 — faixa de filtros rápidos do motor Base1.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FiltrosRapidos, {
  FiltrosRapidosSlotContext,
  filtrosRapidosAutomaticos,
  opcoesDeOrdenacao,
} from "@/components/cadastro/base1/FiltrosRapidos";

const COLS = [
  { id: "nome", label: "Nome" },
  { id: "sexo", label: "Sexo" },
  { id: "peso", label: "Peso", filterKind: /** @type {'num'} */ ("num") },
  { id: "ativo", label: "Ativo", cellKind: "ativo-badge" },
];
const ROWS = [
  { id: "1", nome: "A", sexo: "Macho", peso: "10", ativo: "Ativo" },
  { id: "2", nome: "B", sexo: "Fêmea", peso: "20", ativo: "Ativo" },
  { id: "3", nome: "C", sexo: "Macho", peso: "30", ativo: "Inativo" },
];
const valor = (l, id) => l[id];

function Tela({ onFilterChange = () => {}, onSortChange = () => {}, filters = {}, comSlot = true }) {
  const [slot, setSlot] = React.useState(null);
  return (
    <FiltrosRapidosSlotContext.Provider value={comSlot ? slot : null}>
      <div ref={setSlot} />
      <FiltrosRapidos
        columns={COLS}
        rows={ROWS}
        getFieldValue={valor}
        filters={filters}
        onFilterChange={onFilterChange}
        onClearFilters={() => {}}
        sort={{ key: "nome", direction: "asc" }}
        onSortChange={onSortChange}
        storageKey="teste_fr"
        defaultIds={["sexo"]}
      />
    </FiltrosRapidosSlotContext.Provider>
  );
}

beforeEach(() => localStorage.removeItem("teste_fr_filtrosRapidos"));
afterEach(() => {
  cleanup();
  localStorage.removeItem("teste_fr_filtrosRapidos");
});

describe("FiltrosRapidos", () => {
  it("sem lugar oferecido pelo chrome não desenha nada", () => {
    render(<Tela comSlot={false} />);
    expect(screen.queryByTestId("b1-filtros-rapidos")).toBeNull();
  });

  it("marca uma opção e aplica no ✓ com a forma de filtro do motor", () => {
    const onFilterChange = vi.fn();
    render(<Tela onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Sexo/ }));
    fireEvent.click(screen.getByRole("option", { name: /Macho/ }));
    expect(onFilterChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    const [col, filtro] = onFilterChange.mock.calls[0];
    expect(col).toBe("sexo");
    expect([...filtro.valores]).toEqual(["Macho"]);
    expect(filtro.op).toBe("");
  });

  it("pílula ativa mostra o valor e o ✕ tira o filtro", () => {
    const onFilterChange = vi.fn();
    render(<Tela onFilterChange={onFilterChange} filters={{ sexo: { op: "", v1: "", v2: "", valores: new Set(["Macho"]) } }} />);
    expect(screen.getByText("Macho")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tirar filtro de Sexo" }));
    expect(onFilterChange).toHaveBeenCalledWith("sexo", null);
  });

  it("coluna filtrada por outro caminho também ganha pílula, com a condição em palavras", () => {
    render(<Tela filters={{ peso: { op: "mai", v1: "15", v2: "", valores: null } }} />);
    expect(screen.getByText("é maior do que 15")).toBeTruthy();
  });

  it("a condição fica dentro da janela do filtro: escolher, digitar e aplicar (D-PROD-164)", () => {
    const onFilterChange = vi.fn();
    render(<Tela onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ou tirar filtros" }));
    fireEvent.click(screen.getByRole("option", { name: "Peso" }));
    fireEvent.click(screen.getByRole("button", { name: /^Peso/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Condição" }));
    fireEvent.click(screen.getByRole("option", { name: "É maior do que" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pesquisar" }), { target: { value: "15" } });
    expect(screen.getByText("2 de 3 registros")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    const [col, filtro] = onFilterChange.mock.calls[0];
    expect(col).toBe("peso");
    expect(filtro.op).toBe("mai");
    expect(filtro.v1).toBe("15");
    expect(filtro.valores).toBeNull();
  });

  it("Ordenar troca a ordem em palavras simples", () => {
    const onSortChange = vi.fn();
    render(<Tela onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Ordenar" }));
    fireEvent.click(screen.getByRole("option", { name: "Peso (maior primeiro)" }));
    expect(onSortChange).toHaveBeenCalledWith("peso", "desc");
  });

  it("+ Filtro põe um campo na faixa e guarda a escolha", () => {
    render(<Tela />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ou tirar filtros" }));
    fireEvent.click(screen.getByRole("option", { name: "Nome" }));
    expect(JSON.parse(localStorage.getItem("teste_fr_filtrosRapidos"))).toEqual(["sexo", "nome"]);
  });

  it("deriva filtros e ordens das colunas quando a tela não escolhe", () => {
    expect(filtrosRapidosAutomaticos(COLS, ROWS, valor)).toEqual(["ativo", "sexo"]);
    expect(opcoesDeOrdenacao(COLS).map((o) => o.label)).toContain("Nome (A → Z)");
  });
});
