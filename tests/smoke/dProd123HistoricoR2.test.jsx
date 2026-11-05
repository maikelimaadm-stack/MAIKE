/**
 * D-PROD-123 — complemento PR191-R2. Dados sintéticos.
 *
 * R2-A: o reinício por `HISTORICO_CURSOR_INVALIDO` vale por INCIDENTE
 *   (consulta + paginação), não uma vez por montagem; outras falhas nunca
 *   viram reinício; o reset atinge só a consulta atual; sem laço.
 * R2-B: a chave offline usa só o que o aparelho comprova (dia literal da data
 *   gravada; `created_date` como registro), em paridade com a política do
 *   servidor para vínculo não comprovado; `historico_*` só vale vindo do
 *   endpoint H2; o aviso offline não promete equivalência.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ESCOPO_AREA, chaveDoMovimento, compararChavesDesc, filtrarMovimentacoes } from "@/domain/lotes/historicoMovimentacoes";

const EMP = "emp-1";
const EMP_B = "emp-2";

// ── R2-B: domínio ───────────────────────────────────────────────────────

describe("R2-B — chave offline só com dados comprováveis no aparelho", () => {
  // Mesmo dia; `created_date` e `efeito_servidor.registrado_em` contraditórios.
  // Sem o EventoRebanho no cache, o vínculo não é comprovável: o servidor usa
  // `createdAt` (política do JOIN inequívoco) → B (criado depois) vem antes.
  const a = { id: "mov-a", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2026-05-10", created_date: "2026-05-10T08:00:00.000Z", efeito_servidor: { evento_id: "ev-x", registrado_em: "2026-05-10T23:00:00.000Z" } };
  const b = { id: "mov-b", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2026-05-10", created_date: "2026-05-10T09:00:00.000Z" };
  const ctx = { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "A", lotes: [] };

  it("efeito_servidor.registrado_em do JSON não é autoridade: offline ordena como o servidor (createdAt)", () => {
    // O que o endpoint H2 devolveria para os mesmos fatos (vínculo não comprovado):
    const servidor = [
      { ...a, historico_ocorrencia: "2026-05-10", historico_registrado_em: a.created_date },
      { ...b, historico_ocorrencia: "2026-05-10", historico_registrado_em: b.created_date },
    ];
    const ordemServidor = [...servidor].sort((x, y) => compararChavesDesc(chaveDoMovimento(x, { doServidor: true }), chaveDoMovimento(y, { doServidor: true }))).map((m) => m.id);
    expect(ordemServidor).toEqual(["mov-b", "mov-a"]);
    expect(filtrarMovimentacoes([a, b], ctx).map((m) => m.id)).toEqual(ordemServidor);
    expect(chaveDoMovimento(a).reg).toBe(a.created_date);
  });

  it("historico_* plantado em dados (lista genérica do cache) é ignorado fora do endpoint H2", () => {
    const plantado = { id: "mov-p", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2026-01-01", created_date: "2026-01-01T10:00:00.000Z", historico_ocorrencia: "2099-12-31", historico_registrado_em: "2099-12-31T00:00:00.000Z" };
    expect(chaveDoMovimento(plantado)).toEqual({ oc: "2026-01-01", reg: "2026-01-01T10:00:00.000Z", criado: "2026-01-01T10:00:00.000Z", id: "mov-p" });
    expect(filtrarMovimentacoes([plantado, b], ctx).map((m) => m.id)).toEqual(["mov-b", "mov-p"]);
  });

  it("vindo do endpoint H2, historico_* calculado pelo servidor manda (inclusive ocorrência null)", () => {
    const srv = { id: "m1", created_date: "2026-02-01T10:00:00.000Z", data_movimentacao: "2020-01-01", historico_ocorrencia: null, historico_registrado_em: "2026-02-01T09:59:55.000Z" };
    expect(chaveDoMovimento(srv, { doServidor: true })).toEqual({ oc: null, reg: "2026-02-01T09:59:55.000Z", criado: "2026-02-01T10:00:00.000Z", id: "m1" });
  });

  it("legado sem data e mesmo dia com horários distintos: dia literal, sem inventar dia", () => {
    const semData = { id: "s", empresa_id: EMP, area_origem_id: "A", created_date: "2026-06-01T00:00:00.000Z" };
    const cedo = { id: "c", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2026-05-10T06:00:00-04:00", created_date: "2026-05-11T00:00:00.000Z" };
    const tarde = { id: "t", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2026-05-10T22:00:00-04:00", created_date: "2026-05-10T12:00:00.000Z" };
    expect(chaveDoMovimento(tarde).oc).toBe("2026-05-10");
    expect(filtrarMovimentacoes([semData, tarde, cedo], ctx).map((m) => m.id)).toEqual(["c", "t", "s"]);
  });
});

// ── Componente ──────────────────────────────────────────────────────────

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  buscarLoteDoHistorico: vi.fn(async () => null),
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(async () => 0),
  pendenciasOfflineDaMovimentacao: vi.fn(async () => []),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(),
  getMapaCacheSnapshot: vi.fn(),
  refreshMapaCacheEntry: vi.fn(),
  updateMapaCachedData: vi.fn(async () => []),
}));
const empresa = vi.hoisted(() => ({ atual: "emp-1" }));

vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ administrador_fazenda: false }), ehAdministrador: () => false }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => empresa.atual }));

const { default: HistoricoMovimentacoes } = await import("@/components/lotes/HistoricoMovimentacoes");

const mov = (id, oc, reg, extra = {}) => ({
  id, empresa_id: empresa.atual, tipo: "Pesagem", lote: "TESTE", lote_id: "lote-1", quantidade_animais: 10, area_origem_id: "area-A",
  data_movimentacao: oc ?? undefined, created_date: reg, historico_ocorrencia: oc, historico_ocorrencia_origem: oc ? "data_movimentacao" : null, historico_registrado_em: reg, ...extra,
});
const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2", ...extra });
/** Erro do cliente HTTP nativo: o corpo do servidor fica em `cause` (ApiError). */
const erroDoServidor = (code, status = 400) => Object.assign(new Error(code), { status, cause: { code } });
const erroDeRede = () => Object.assign(new Error("Failed to fetch"), { code: "PROVIDER_UNAVAILABLE" });

const P1 = (cursor) => pagina([mov("m1", "2026-10-01", "2026-10-01T10:00:00.000Z")], { total: 2, has_more: true, next_cursor: cursor });
const P2 = () => pagina([mov("m2", "2026-03-01", "2026-03-01T10:00:00.000Z")], { total: 2 });

/**
 * Servidor roteirizado: página 1 devolve o cursor da vez; cursores na lista
 * `recusados` → 400 HISTORICO_CURSOR_INVALIDO; `falhas[cursor]` → outro erro.
 */
const servidor = ({ cursores = ["c1"], recusados = [], recusar = (c) => recusados.includes(c), falhas = {} } = {}) => {
  let pagina1 = 0;
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async ({ cursor }) => {
    if (!cursor) return P1(cursores[Math.min(pagina1++, cursores.length - 1)]);
    if (falhas[cursor]) throw falhas[cursor]();
    if (recusar(cursor)) throw erroDoServidor("HISTORICO_CURSOR_INVALIDO");
    return P2();
  });
};
const chamadas = () => servico.listarHistoricoMovimentacoesPagina.mock.calls.map((c) => c[0].cursor ?? null);

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const resetSpy = vi.spyOn(client, "resetQueries");
  const arvore = (lotes) => (
    <QueryClientProvider client={client}>
      <HistoricoMovimentacoes lotes={lotes} areaId="area-A" />
    </QueryClientProvider>
  );
  const lotes = [{ id: "lote-1", nome: "TESTE", area_atual_id: "area-A" }];
  const utils = render(arvore(lotes));
  return { ...utils, client, resetSpy, rerenderEmpresa: () => utils.rerender(arvore([...lotes])) };
};
const carregarMais = async () => fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  empresa.atual = EMP;
  servico.listarHistoricoMovimentacoesPagina.mockReset();
  cache.refreshMapaCacheEntry.mockImplementation(async (chave) => (chave === "areas" ? [{ id: "area-A", nome: "TESTE", empresa_id: empresa.atual }] : []));
  cache.getMapaCachedData.mockImplementation(async () => []);
  cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: [], atualizadoEm: null }));
});
afterEach(() => cleanup());

describe("R2-A — reinício por cursor inválido vale por incidente", () => {
  it("dois incidentes na MESMA montagem: cada um reinicia (a ref não fica consumida)", async () => {
    servidor({ cursores: ["c1", "c2", "c3"], recusados: ["c1", "c2"] });
    const { resetSpy } = renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(chamadas()).toEqual([null, "c1", null]));
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(chamadas()).toEqual([null, "c1", null, "c2", null]));
    await carregarMais();
    expect(await screen.findByText("Movimentações: 2 de 2")).toBeTruthy();
    expect(chamadas()).toEqual([null, "c1", null, "c2", null, "c3"]);
    expect(resetSpy).toHaveBeenCalledTimes(2);
  });

  it("o mesmo cursor recusado de novo após o reinício NÃO entra em laço: erro visível, requisições contadas", async () => {
    servidor({ cursores: ["c1"], recusados: ["c1"] });
    const { resetSpy } = renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(chamadas()).toEqual([null, "c1", null]));
    await carregarMais();
    expect(await screen.findByText(/Não foi possível carregar a próxima página/)).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(chamadas()).toEqual([null, "c1", null, "c1"]);
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["401", () => erroDoServidor("AUTH_REQUIRED", 401)],
    ["403", () => erroDoServidor("TENANT_SCOPE_VIOLATION", 403)],
    ["500", () => erroDoServidor("INTERNAL_ERROR", 500)],
    ["400 genérico", () => erroDoServidor("REQUEST_VALIDATION_FAILED", 400)],
    ["rede", erroDeRede],
  ])("falha %s na próxima página continua visível e nunca vira reinício", async (_n, falha) => {
    servidor({ cursores: ["c1"], falhas: { c1: falha } });
    const { resetSpy } = renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    expect(await screen.findByText(/Não foi possível carregar a próxima página/)).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(chamadas()).toEqual([null, "c1"]);
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("alternar Área → Lotes atuais: incidente em cada escopo reinicia o próprio escopo", async () => {
    // Página 1 global: área c1 (recusado) → reinício c2; lotes c3 (recusado) → reinício c4.
    servidor({ cursores: ["c1", "c2", "c3", "c4"], recusados: ["c1", "c3"] });
    const { resetSpy } = renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Lotes atuais" }));
    await waitFor(() => expect(servico.listarHistoricoMovimentacoesPagina.mock.lastCall[0].loteIds).toEqual(["lote-1"]));
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(2));
    const [, segunda] = resetSpy.mock.calls;
    expect(segunda[0].queryKey).toContain("lotes");
    expect(segunda[0].exact).toBe(true);
  });

  it("empresa A → B → A: reset só da consulta atual; o cache da outra empresa fica intacto", async () => {
    // Todo cursor recusado (ex.: AUTH_SECRET trocado): cada consulta tem o próprio incidente.
    servidor({ cursores: ["c1", "c2", "c3", "c4", "c5", "c6"], recusar: () => true });
    const { client, resetSpy, rerenderEmpresa } = renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    empresa.atual = EMP_B;
    rerenderEmpresa();
    await waitFor(() => expect(servico.listarHistoricoMovimentacoesPagina.mock.lastCall[0].empresaId).toBe(EMP_B));
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
    expect(resetSpy.mock.calls[0][0]).toEqual({ queryKey: expect.arrayContaining([EMP_B]), exact: true });
    const daEmpresaA = client.getQueryCache().findAll({ queryKey: ["historico-movimentacoes", EMP] });
    expect(daEmpresaA).toHaveLength(1);
    expect(daEmpresaA[0].state.data?.pages?.length).toBe(1);
    empresa.atual = EMP;
    rerenderEmpresa();
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(2));
    expect(resetSpy.mock.calls[1][0]).toEqual({ queryKey: expect.arrayContaining([EMP]), exact: true });
  });

  it("invalidação após manejo/exclusão ('atualizar-mapa') e novo incidente: reinicia de novo", async () => {
    servidor({ cursores: ["c1", "c2", "c3", "c4"], recusados: ["c1", "c3"] });
    const { resetSpy } = renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    await carregarMais();
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
    await screen.findByText("Movimentações: 1 de 2"); // c2
    act(() => { window.dispatchEvent(new CustomEvent("atualizar-mapa")); });
    await waitFor(() => expect(chamadas().filter((c) => c === null).length).toBe(3)); // refetch → c3
    await carregarMais();
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(2));
    await carregarMais(); // c4 aceito
    expect(await screen.findByText("Movimentações: 2 de 2")).toBeTruthy();
  });
});

describe("R2-B — aviso offline sem prometer equivalência", () => {
  it("cache: 'cópia parcial ordenada pelas datas disponíveis no aparelho', com data e limite de 500", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    const doCache = (i) => ({ id: `c${i}`, empresa_id: EMP, tipo: "Pesagem", lote: "TESTE", lote_id: "lote-1", area_origem_id: "area-A", data_movimentacao: "2026-05-10", created_date: new Date(Date.UTC(2026, 4, 10, 0, 0, i)).toISOString() });
    cache.getMapaCacheSnapshot.mockImplementation(async (chave) =>
      chave === "movimentacoesHistorico" ? { items: Array.from({ length: 500 }, (_, i) => doCache(i)), atualizadoEm: "2026-11-01T11:00:00.000Z" } : { items: [], atualizadoEm: null }
    );
    renderizar();
    const status = (await screen.findByText("Histórico offline parcial")).closest('[role="status"]');
    expect(status.textContent).toMatch(/cópia parcial ordenada pelas datas disponíveis no aparelho/);
    expect(status.textContent).toMatch(/atualizado em 01\/11\/2026/);
    expect(status.textContent).toMatch(/limitadas às 500 mais recentes/);
    expect(status.textContent).not.toMatch(/mesma ordem/);
  });

  it("fallback após erro de rede com cache: mesma ordem local (createdAt), sem confiar em efeito_servidor.registrado_em", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => { throw erroDeRede(); });
    const base = { empresa_id: EMP, tipo: "Pesagem", lote: "TESTE", lote_id: "lote-1", area_origem_id: "area-A", data_movimentacao: "2026-05-10" };
    cache.getMapaCacheSnapshot.mockImplementation(async (chave) =>
      chave === "movimentacoesHistorico"
        ? {
            items: [
              { ...base, id: "mov-a", observacoes: "A", created_date: "2026-05-10T08:00:00.000Z", efeito_servidor: { evento_id: "ev", registrado_em: "2026-05-10T23:00:00.000Z" } },
              { ...base, id: "mov-b", observacoes: "B", created_date: "2026-05-10T09:00:00.000Z" },
            ],
            atualizadoEm: "2026-11-01T11:00:00.000Z",
          }
        : { items: [], atualizadoEm: null }
    );
    renderizar();
    await screen.findByText("Movimentações em cache: 2");
    const cards = screen.getAllByTestId("ocorrencia").map((el) => el.closest(".border"));
    expect(within(cards[0]).getByText("Detalhes:").parentElement.textContent).toBe("Detalhes: B");
    expect(within(cards[1]).getByText("Detalhes:").parentElement.textContent).toBe("Detalhes: A");
  });
});
