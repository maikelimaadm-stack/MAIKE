/**
 * D-PROD-90 R1 — criação manual de área depois da regra compartilhada:
 * o formulário não calcula `numero_area` (nem lista áreas para isso) e não
 * envia `setor_nome`; a numeração é do servidor.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
const svc = {
  criarArea: vi.fn(async (d) => ({ id: "nova", ...d })),
  atualizarArea: vi.fn(),
  listarTodasAreas: vi.fn(async () => [{ numero_area: "41" }]),
};
vi.mock("@/services/mapaService", () => ({
  listarSetoresAtivos: async () => [{ id: "s1", nome: "NORTE", empresa_id: "emp-1", ativo: true }],
  criarArea: (...a) => svc.criarArea(...a),
  atualizarArea: (...a) => svc.atualizarArea(...a),
  listarTodasAreas: (...a) => svc.listarTodasAreas(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const QUADRADO = [
  { lat: -15.6, lng: -56.1 },
  { lat: -15.6, lng: -56.091 },
  { lat: -15.609, lng: -56.091 },
  { lat: -15.609, lng: -56.1 },
];

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => cleanup());

const escolher = async (rotulo, opcao) => {
  const campo = screen.getByText(rotulo, { selector: "label" }).parentElement;
  await act(async () => {
    fireEvent.click(within(/** @type {HTMLElement} */ (campo)).getByRole("combobox"));
  });
  await act(async () => {
    fireEvent.click(within(/** @type {HTMLElement} */ (document.querySelector('[role="listbox"]'))).getByRole("option", { name: opcao }));
  });
};

describe("FormularioArea — criação manual", () => {
  it("cria sem numero_area/setor_nome calculados no cliente e sem listar todas as áreas", async () => {
    const { default: FormularioArea } = await import("@/components/mapa/FormularioArea");
    const onSave = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FormularioArea coordenadas={QUADRADO} onSave={onSave} onCancel={() => {}} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Setor", { selector: "label" })).toBeInTheDocument());
    await act(async () => {});
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "50" } }); // pastejada
    fireEvent.change(screen.getAllByRole("textbox")[2], { target: { value: "Pasto manual" } }); // nome
    await escolher("Setor", "NORTE");
    await escolher("Tipo de cultura", "Marandu");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    await waitFor(() => expect(svc.criarArea).toHaveBeenCalledTimes(1));
    const enviado = svc.criarArea.mock.calls[0][0];
    expect(enviado).not.toHaveProperty("numero_area");
    expect(enviado).not.toHaveProperty("setor_nome");
    expect(enviado).toMatchObject({ nome: "PASTO MANUAL", setor_id: "s1", tipo_cultura: "Pastagem", tipo_pastagem: "Marandu", area_pastejada: 50 });
    expect(svc.listarTodasAreas).not.toHaveBeenCalled();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it("pastejada maior que a área total é recusada (regra compartilhada)", async () => {
    const { default: FormularioArea } = await import("@/components/mapa/FormularioArea");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FormularioArea coordenadas={QUADRADO} onSave={() => {}} onCancel={() => {}} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText("Setor", { selector: "label" })).toBeInTheDocument());
    await act(async () => {});
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "5000" } });
    fireEvent.change(screen.getAllByRole("textbox")[2], { target: { value: "Pasto" } });
    await escolher("Setor", "NORTE");
    await escolher("Tipo de cultura", "Marandu");
    svc.criarArea.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    expect(svc.criarArea).not.toHaveBeenCalled();
  });
});
