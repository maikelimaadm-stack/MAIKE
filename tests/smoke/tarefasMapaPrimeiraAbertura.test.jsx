/**
 * D-PROD-217 — a Gestão de Tarefas (aberta pela barra do mapa, segmento
 * "Tarefas") busca a lista já na primeira abertura. Antes, `initialData: []`
 * com `staleTime` fazia o React Query tratar a lista vazia como dado novo e
 * não buscar: o painel abria vazio com tarefas no mapa.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listarTarefasDaEmpresa = vi.fn(async () => [
  { id: "t1", titulo: "Consertar cerca", status: "Pendente", prioridade: "Alta", area_id: "a1", area_nome: "PASTO 04" },
]);
vi.mock("@/services/tarefasMapaService", () => ({
  listarTarefasDaEmpresa: (...a) => listarTarefasDaEmpresa(...a),
  listarIconesPorTipo: vi.fn(async () => []),
  criarTarefa: vi.fn(),
  atualizarTarefa: vi.fn(),
  excluirTarefa: vi.fn(),
  enviarAnexo: vi.fn(),
}));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/offline/IndexedDBManager", () => ({ saveTarefaOffline: vi.fn(), saveTarefaImageOffline: vi.fn() }));

import TarefasMapaPanel from "@/components/mapa/TarefasMapaPanel";

describe("Gestão de Tarefas: primeira abertura (D-PROD-217)", () => {
  it("busca as tarefas ao montar e mostra a lista, sem abrir vazia", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><TarefasMapaPanel onClose={() => {}} /></QueryClientProvider>);
    await waitFor(() => expect(listarTarefasDaEmpresa).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Consertar cerca")).toBeTruthy();
  });
});
