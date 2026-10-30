/**
 * Cadastro de Lotes = lançamento da ENTRADA no rebanho (D-PROD-85).
 *
 * Caso real: lote 1 (AJUSTE) entrou com 500 e tem 450; o lote 2 foi gerado
 * pela transferência de 50 no mapa (origem MOVIMENTAÇÃO). A lista padrão traz
 * só a entrada; o lote 2 aparece apenas como consulta. O resumo mostra
 * entradas 500 e rebanho atual 500. Abrir e alternar a lista não escreve nada.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const serviceMock = {
  listarLotes: vi.fn(),
  criarLote: vi.fn(),
  atualizarLote: vi.fn(),
  excluirLotes: vi.fn(),
};

vi.mock("@/services/loteCadastroService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listarLotes: (...a) => serviceMock.listarLotes(...a),
    criarLote: (...a) => serviceMock.criarLote(...a),
    atualizarLote: (...a) => serviceMock.atualizarLote(...a),
    excluirLotes: (...a) => serviceMock.excluirLotes(...a),
    listarAreasAtivas: vi.fn().mockResolvedValue([]),
  };
});

const manejoMock = vi.fn();
vi.mock("@/services/loteManejoService", () => new Proxy({}, { get: () => manejoMock }));

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/services/mapaCacheService", () => ({ refreshMapaCacheEntry: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));
vi.mock("@/components/common/RegistroAnexosDialog", () => ({ default: () => null }));

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-lotes">{props.rows.map((r) => r.numero_lote).join(",")}</div>;
  },
}));

const LOTE_1 = { id: "l1", numero_lote: "1", nome: "TESTE", origem: "AJUSTE", empresa_id: "emp-1", status: "Ativo", quantidade_entrada: 500, quantidade_cabecas: 450 };
const LOTE_2 = { id: "l2", numero_lote: "2", nome: "TESTE", origem: "MOVIMENTAÇÃO", empresa_id: "emp-1", status: "Ativo", quantidade_entrada: 50, quantidade_cabecas: 50 };
const NASC = { id: "l3", numero_lote: "3", nome: "BEZERROS", origem: "Nascimento", empresa_id: "emp-1", status: "Ativo", quantidade_entrada: 3, quantidade_cabecas: 3 };

const renderPagina = async () => {
  const { default: CadastroLotes } = await import("@/pages/CadastroLotes");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CadastroLotes />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  for (const fn of Object.values(serviceMock)) fn.mockReset();
  manejoMock.mockReset();
  gradePropsSpy.mockClear();
  serviceMock.listarLotes.mockResolvedValue([LOTE_1, LOTE_2]);
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("Cadastro de Lotes — entradas, consulta e resumo", () => {
  it("lista padrão: só entradas no rebanho (lote 1); lote gerado por manejo fica de fora", async () => {
    await renderPagina();
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent).toBe("1"));
    expect(serviceMock.listarLotes.mock.calls[0][0]).toEqual(expect.objectContaining({ empresaId: "emp-1", incluirSistema: true }));
  });

  it("nascimento é entrada e aparece na lista padrão", async () => {
    serviceMock.listarLotes.mockResolvedValue([LOTE_1, LOTE_2, NASC]);
    await renderPagina();
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent.split(",").sort()).toEqual(["1", "3"]));
    expect(screen.getByTestId("resumo-rebanho").textContent).toMatch(/Entradas: 503 cab\..*Rebanho atual: 503 cab\./);
  });

  it("resumo de leitura: Entradas 500 · Rebanho atual 500 (o saldo do lote derivado não some)", async () => {
    await renderPagina();
    await waitFor(() => expect(screen.getByTestId("resumo-rebanho").textContent).toMatch(/Entradas: 500 cab\..*Rebanho atual: 500 cab\./));
    expect(screen.getByTestId("resumo-rebanho").textContent).not.toMatch(/550|450/);
  });

  it("consulta: o botão mostra/oculta os lotes gerados por manejo, sem mudar o resumo", async () => {
    await renderPagina();
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent).toBe("1"));
    const botao = screen.getByRole("button", { name: "Mostrar lotes gerados por manejo" });
    expect(botao.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(botao);
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent).toBe("1,2"));
    expect(screen.getByRole("button", { name: "Ocultar lotes gerados por manejo" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("resumo-rebanho").textContent).toMatch(/Entradas: 500 cab\..*Rebanho atual: 500 cab\./);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar lotes gerados por manejo" }));
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent).toBe("1"));
  });

  it("abrir e alternar a lista não escreve nada: sem criar/editar/excluir lote nem manejo", async () => {
    await renderPagina();
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar lotes gerados por manejo" }));
    await waitFor(() => expect(screen.getByTestId("grade-lotes").textContent).toBe("1,2"));
    expect(serviceMock.criarLote).not.toHaveBeenCalled();
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();
    expect(serviceMock.excluirLotes).not.toHaveBeenCalled();
    expect(manejoMock).not.toHaveBeenCalled();
  });

  it("a tela de Cadastro não mostra coluna nem texto de movimentações", async () => {
    await renderPagina();
    await waitFor(() => expect(gradePropsSpy).toHaveBeenCalled());
    const colunas = gradePropsSpy.mock.calls.at(-1)[0].columns.map((c) => `${c.id}:${c.label}`);
    expect(colunas.join("|")).not.toMatch(/moviment/i);
    expect(screen.queryByText(/Movimentações \(±\)/)).toBeNull();
  });
});
