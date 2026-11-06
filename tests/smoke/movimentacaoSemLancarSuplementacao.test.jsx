// @vitest-environment jsdom
/**
 * PR #199 / R4 — o formulário de MOVER não oferece fechar consumo nem
 * aproveitar sobra a quem não tem "Lançar suplementação" (o servidor recusa
 * com 403). Avisa que o consumo continua aberto e segue para a movimentação.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

const EVENTO_ABERTO = { id: "ev-1", empresa_id: "emp-1", area_id: "area-a", dias_periodo: null, ponto_suplementacao_id: "p1", quantidade_total_kg: 100, sobra_kg: 0, data_lancamento: "2026-10-26" };
const fechar = vi.hoisted(() => vi.fn());

vi.mock("@/services/mapaService", () => ({
  listarIconesDaEmpresa: vi.fn(async () => []),
  listarTodosPontosSuplementacao: vi.fn(async () => [{ id: "p1", nome_ponto: "COCHO 1" }]),
}));
vi.mock("@/services/loteManejoService", () => ({
  listarTodosLotes: vi.fn(async () => []),
  listarEventosSuplementacao: vi.fn(async () => [EVENTO_ABERTO]),
}));
vi.mock("@/services/suplementacaoService", () => ({ fecharPeriodoSuplementacao: fechar }));
// Referências estáveis (um array novo a cada render faria os efeitos do formulário rodarem sem parar).
const SETOR_AREAS = vi.hoisted(() => ({ setores: [], areas: [{ id: "area-a", nome: "PASTO A" }, { id: "area-b", nome: "PASTO B" }], getAreasBySetor: () => [] }));
vi.mock("@/hooks/useSetorAreas", () => ({ default: () => SETOR_AREAS }));

import FormularioMovimentacaoLote from "@/components/lotes/FormularioMovimentacaoLote";

const AREA_ORIGEM = { id: "area-a", nome: "PASTO A" };
const LOTE = { id: "l1", nome: "BASE", categoria: "BOI", quantidade_cabecas: 10, area_atual_id: "area-a", status: "Ativo" };
const LOTES = [LOTE];
const montar = (props) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FormularioMovimentacaoLote lotesOriginais={LOTES} areaOrigem={AREA_ORIGEM} onSubmit={vi.fn()} onCancel={vi.fn()} {...props} />
    </QueryClientProvider>
  );

beforeEach(() => {
  localStorage.setItem("empresa_selecionada_id", "emp-1");
  fechar.mockReset();
});
afterEach(cleanup);

describe("R4 — mover sem permissão de lançar suplementação", () => {
  it("sem a permissão: não pergunta se fecha o consumo, avisa que continua aberto e vai direto para a movimentação", async () => {
    montar({ podeLancarSuplementacao: false });
    expect(await screen.findByTestId("consumo-aberto-sem-permissao")).toBeTruthy();
    expect(screen.getByText(/Há 1 consumo\(s\) de suplementação em aberto/)).toBeTruthy();
    expect(screen.queryByText(/Deseja fechar o consumo antes de mover/)).toBeNull();
    expect(screen.queryByText("Fechar consumo")).toBeNull();
    expect(screen.getByText("Data da Movimentação")).toBeTruthy();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("a chave de mover o lote inteiro alterna a edição parcial sem mudar o fluxo de consumo", async () => {
    montar({ podeLancarSuplementacao: false });
    const chave = await screen.findByRole("switch", { name: "Movimentar todo o lote?" });
    expect(chave.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Categoria 1")).toBeNull();
    fireEvent.click(chave);
    expect(chave.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Categoria 1")).toBeTruthy();
    fireEvent.click(chave);
    expect(chave.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Categoria 1")).toBeNull();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("sem a prop (padrão): o lado seguro — também não oferece fechamento", async () => {
    montar({});
    expect(await screen.findByTestId("consumo-aberto-sem-permissao")).toBeTruthy();
  });

  it("com a permissão: o fluxo de sempre — pergunta se fecha o consumo", async () => {
    montar({ podeLancarSuplementacao: true });
    await waitFor(() => expect(screen.getByText(/Deseja fechar o consumo antes de mover/)).toBeTruthy());
    expect(screen.queryByTestId("consumo-aberto-sem-permissao")).toBeNull();
  });

  it("Detalhes do Lote passa a permissão real do mapa (=== true) e a sobra do destino só é oferecida com ela", () => {
    expect(readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8")).toContain("(permissions).lancar_suplementacao === true}");
    expect(readFileSync("src/components/lotes/FormularioMovimentacaoLote.jsx", "utf8")).toContain("if (!sobraDestinoDecidida && podeLancarSuplementacao)");
  });
});
