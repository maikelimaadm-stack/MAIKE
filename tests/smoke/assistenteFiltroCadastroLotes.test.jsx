/**
 * D-PROD-230 — Cadastro de Lotes prepara a lista antes de aplicar o filtro do Assistente:
 * fecha o lote aberto (editando: só se o usuário aceitar descartar), tira a pesquisa e a
 * sugestão (que estreitariam a lista) e consome o pedido (reabrir a lista não o refaz).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { avisarFiltroDoAssistente } from "@/domain/assistente/filtroTela";

const serviceMock = vi.hoisted(() => ({ listarLotes: vi.fn() }));
const avisos = vi.hoisted(() => ({ sucesso: [], alerta: [] }));

vi.mock("@/services/loteCadastroService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listarLotes: (...a) => serviceMock.listarLotes(...a),
    listarIdsDeLotesComRegistros: async () => new Set(),
    criarLote: vi.fn(),
    atualizarLote: vi.fn(),
    excluirLotes: vi.fn(),
    listarAreasAtivas: async () => [],
  };
});
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/services/mapaCacheService", () => ({ refreshMapaCacheEntry: async () => undefined }));
vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: (m) => avisos.sucesso.push(m),
  notifyWarning: (m) => avisos.alerta.push(m),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));
vi.mock("@/components/common/RegistroAnexosDialog", () => ({ default: () => null }));
vi.mock("@/components/lotes/FormularioLote", () => ({
  default: () => <div data-testid="form-lote">formulário</div>,
  FORMULARIO_LOTE_ID: "form-lote",
}));

const gradeProps = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradeProps(props);
    return <div data-testid="grade-lotes">grade</div>;
  },
}));

const LOTES = [
  { id: "l1", numero_lote: "1", nome: "LOTE A", quantidade_entrada: 50, quantidade_cabecas: 50, sexo: "Macho", empresa_id: "emp-1", status: "Ativo" },
  { id: "l2", numero_lote: "2", nome: "LOTE B", quantidade_entrada: 20, quantidade_cabecas: 20, sexo: "Fêmea", empresa_id: "emp-1", status: "Ativo" },
];

const pedirFiltro = async (filtros) => {
  window.history.pushState(null, "", `/cadastrolotes?af=${encodeURIComponent(JSON.stringify(filtros))}`);
  await act(async () => avisarFiltroDoAssistente());
};
const ultimaGrade = () => gradeProps.mock.calls.at(-1)?.[0];

const abrirPagina = async () => {
  const { default: CadastroLotes } = await import("@/pages/CadastroLotes");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CadastroLotes />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ultimaGrade()?.rows?.length).toBe(2));
};

beforeEach(() => {
  serviceMock.listarLotes.mockResolvedValue(LOTES);
  gradeProps.mockReset();
  avisos.sucesso.length = 0;
  avisos.alerta.length = 0;
  window.history.replaceState(null, "", "/cadastrolotes");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cadastro de Lotes — filtro do Assistente", () => {
  it("lote aberto (só vendo): volta para a lista e aplica", async () => {
    await abrirPagina();
    await act(async () => ultimaGrade().onOpen(LOTES[0]));
    await waitFor(() => expect(screen.getByTestId("form-lote")).toBeTruthy());
    gradeProps.mockClear();
    await pedirFiltro({ sexos: ["macho"] });
    await waitFor(() => expect(ultimaGrade()?.filtrosExternos?.filtros?.sexo).toBeTruthy());
    expect([...ultimaGrade().filtrosExternos.filtros.sexo.valores]).toEqual(["Macho"]);
    expect(screen.queryByTestId("form-lote")).toBeNull();
    expect(avisos.sucesso).toContain("Filtro do assistente aplicado na lista");
  });

  it("lote em edição e o usuário não aceita descartar: fica no lote e não aplica", async () => {
    await abrirPagina();
    await act(async () => ultimaGrade().onOpen(LOTES[0]));
    await waitFor(() => expect(screen.getByTestId("form-lote")).toBeTruthy());
    const editar = screen.getAllByRole("button").find((b) => /editar/i.test(b.getAttribute("aria-label") || b.textContent || ""));
    expect(editar).toBeTruthy();
    await act(async () => fireEvent.click(editar));
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    gradeProps.mockClear();
    await pedirFiltro({ sexos: ["Macho"] });
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("form-lote")).toBeTruthy();
    expect(avisos.alerta.join(" ")).toMatch(/não aplicado/);
    expect(avisos.sucesso).toEqual([]);
  });

  it("pesquisa ativa é limpa antes: o filtro casa com a lista inteira", async () => {
    await abrirPagina();
    fireEvent.click(screen.getByLabelText("Abrir pesquisa"));
    const campo = await screen.findByPlaceholderText("Buscar lotes…");
    fireEvent.change(campo, { target: { value: "LOTE A" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await waitFor(() => expect(ultimaGrade().rows.length).toBe(1));
    await pedirFiltro({ sexos: ["Fêmea"] });
    await waitFor(() => expect(ultimaGrade()?.filtrosExternos?.filtros?.sexo).toBeTruthy());
    expect([...ultimaGrade().filtrosExternos.filtros.sexo.valores]).toEqual(["Fêmea"]);
    expect(ultimaGrade().rows.length).toBe(2);
    expect(avisos.alerta).toEqual([]);

    // "Limpar" também tira a pesquisa.
    fireEvent.change(await screen.findByPlaceholderText("Buscar lotes…"), { target: { value: "LOTE B" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Buscar lotes…"), { key: "Enter" });
    await waitFor(() => expect(ultimaGrade().rows.length).toBe(1));
    await pedirFiltro({});
    await waitFor(() => expect(ultimaGrade().rows.length).toBe(2));
    expect(avisos.sucesso).toContain("Filtros da lista limpos");
  });

  it("aplicado, o pedido é consumido: abrir um lote e voltar não refaz o filtro", async () => {
    await abrirPagina();
    await pedirFiltro({ sexos: ["Macho"] });
    await waitFor(() => expect(avisos.sucesso).toContain("Filtro do assistente aplicado na lista"));
    await act(async () => ultimaGrade().onOpen(LOTES[1]));
    await waitFor(() => expect(screen.getByTestId("form-lote")).toBeTruthy());
    const voltar = screen.getAllByRole("button").find((b) => (b.getAttribute("aria-label") || b.textContent || "") === "Tabela");
    expect(voltar).toBeTruthy();
    gradeProps.mockClear();
    await act(async () => fireEvent.click(voltar));
    await waitFor(() => expect(screen.getByTestId("grade-lotes")).toBeTruthy());
    expect(ultimaGrade().filtrosExternos ?? null).toBeNull();
    expect(avisos.sucesso.filter((m) => m === "Filtro do assistente aplicado na lista")).toHaveLength(1);
  });
});
