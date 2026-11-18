// @vitest-environment jsdom
/**
 * D-PROD-250 — Detalhes do pasto REAL: depois de uma transferência para o pasto
 * (KM - P. 01 recebeu 2 cab de KM-06), reabrir na hora mostra o saldo novo, sem
 * esperar o staleTime das consultas próprias do Detalhes (`mapa-lotes`,
 * `mapa-areas`). Mocks só na borda (cache do mapa, serviços, toast).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const formulario = vi.hoisted(() => (nome) => async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-testid": `form-${nome}` }) };
});
const servidor = vi.hoisted(() => ({ areas: [], lotes: [], movimentacoes: [] }));
const local = vi.hoisted(() => ({ areas: [], lotes: [], movimentacoes: [] }));
const cache = vi.hoisted(() => {
  const c = {
    getMapaCachedData: vi.fn(async (chave) => local[chave] ?? []),
    // comum (< 60 s) devolve o IndexedDB; forçada vai ao "servidor" e grava o IndexedDB
    refreshMapaCacheEntry: vi.fn(async (chave, _e, opcoes) => {
      if (opcoes?.force && chave in servidor) local[chave] = servidor[chave];
      return local[chave] ?? [];
    }),
  };
  c.refreshMapaCacheEntryDetalhado = vi.fn(async (k, e, o) => ({ dados: await c.refreshMapaCacheEntry(k, e, o), origem: "rede", erro: null }));
  return c;
});

vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/loteManejoService", () => ({ listarProdutosDaEmpresa: vi.fn(async () => []), criarEventoSuplementacao: vi.fn(), registrarSuplementacaoEmLote: vi.fn() }));
vi.mock("@/services/mapaService", () => ({ listarIconesPorTipoEntidade: async () => [] }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1" }) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/lotes/ExcluirMovimentacao", () => ({ escopoDoUsuario: () => "c-1:u-1" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/lotes/HistoricoMovimentacoes", formulario("historico"));
vi.mock("@/components/suplementacao/HistoricoSuplementacaoLote", formulario("historico-supl"));

const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");
const { aposEscritaNoRebanho } = await import("@/components/mapa/invalidarCachesMapa");
const { esquecerEstadoLotes } = await import("@/components/mapa/detalhes-lote/useEstadoLotes");

const pos = (id, cab, nome) => ({
  id, posicao_id: id, __posicao: true, nome, categoria: "BEZERRO 0 A 12 MESES", sexo: "Macho", quantidade_cabecas: cab,
  peso_medio_kg: 200, area_atual_id: "p01", area_atual_nome: "KM - P. 01", status: "Ativo", categoria_manejo_nome: "BEZERRO 09 A 12 MESES",
});

const abrir = async (client, lotes) => {
  const utils = render(
    <QueryClientProvider client={client}>
      <DetalhesLote lotes={lotes} onClose={() => {}} permissions={{}} />
    </QueryClientProvider>
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return utils;
};

beforeEach(() => {
  esquecerEstadoLotes();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width: 1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  const area = { id: "p01", nome: "KM - P. 01", tamanho_hectares: 10, tipo_cultura: "Pastagem", quantidade_atual: 20 };
  servidor.areas = [area];
  servidor.lotes = [pos("lote75", 20, "BEZERRO 0 A 12 MESES")];
  local.areas = servidor.areas;
  local.lotes = servidor.lotes;
  local.movimentacoes = servidor.movimentacoes = [];
});
afterEach(() => cleanup());

describe("Detalhes do pasto depois de transferir para ele", () => {
  it("reabrir logo depois mostra 22 cab (20 + 2 transferidas), sem esperar 1–5 min", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const primeira = await abrir(client, [pos("lote75", 20, "BEZERRO 0 A 12 MESES")]);
    expect(client.getQueryData(["mapa-lotes", "emp-1"])).toHaveLength(1);
    primeira.unmount();

    // A transferência gravou no servidor (KM-06 → KM - P. 01, 2 cab).
    servidor.lotes = [pos("lote75", 20, "BEZERRO 0 A 12 MESES"), pos("lote73", 2, "BEZERRO 0 A 12 MESES")];
    servidor.areas = [{ ...servidor.areas[0], quantidade_atual: 22 }];
    await act(async () => { await aposEscritaNoRebanho(client, "emp-1"); });

    // Reabre segundos depois, no MESMO QueryClient do app.
    await abrir(client, servidor.lotes);
    const lotes = /** @type {any[]} */ (client.getQueryData(["mapa-lotes", "emp-1"]));
    expect(lotes.reduce((t, l) => t + l.quantidade_cabecas, 0)).toBe(22);
    expect(/** @type {any[]} */ (client.getQueryData(["mapa-areas", "emp-1"]))[0].quantidade_atual).toBe(22);
    expect(cache.refreshMapaCacheEntry).toHaveBeenCalledWith("areas", "emp-1", { force: true });
  });
});
