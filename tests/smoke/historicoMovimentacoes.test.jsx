/**
 * Histórico de Movimentações do Mapa — leitura restaurada (MAIKE-MAPA-
 * HISTORICO-MOVIMENTACOES-R1, D-PROD-94). Dados sintéticos.
 *
 * Fixture equivalente às três movimentações reais (31/10/2026, leitura
 * agregada): três transferências, todas com `lote_id`, origem, destino e data,
 * com `empresa_id` só na coluna — que agora volta na leitura.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  ESCOPO_AREA,
  ESCOPO_LOTES,
  entradasNaArea,
  filtrarMovimentacoes,
  filtrarRegistrosDeLote,
  fluxoNaArea,
  vinculoComLotes,
} from "@/domain/lotes/historicoMovimentacoes";

const EMP = "emp-1";
const OUTRA_EMP = "emp-2";

const transf = (id, extra = {}) => ({
  id,
  empresa_id: EMP,
  tipo: "Transferência de Área",
  lote: "TESTE",
  lote_id: "lote-1",
  quantidade_animais: 50,
  area_origem_id: "area-A",
  area_origem_nome: "TESTE",
  area_destino_id: "area-B",
  area_destino_nome: "TET",
  data_movimentacao: "2026-10-30T12:00:00.000Z",
  created_date: "2026-10-30T15:00:00.000Z",
  ...extra,
});

// ── Domínio ─────────────────────────────────────────────────────────────

describe("domínio — escopo da área × escopo do lote", () => {
  const movs = [
    transf("m1", { quantidade_animais: 50, created_date: "2026-02-01T10:00:00.000Z" }),
    { id: "m2", empresa_id: EMP, tipo: "Pesagem", lote: "TESTE", lote_id: "lote-1", quantidade_animais: 450, area_origem_id: "area-A", created_date: "2026-02-02T10:00:00.000Z" },
    transf("m3", { quantidade_animais: 450, created_date: "2026-02-03T10:00:00.000Z" }),
    transf("m4", { empresa_id: OUTRA_EMP, created_date: "2026-02-04T10:00:00.000Z" }),
  ];

  it("500 cabeças: A mostra saídas 50+450 e a pesagem; B mostra entradas 50+450; nada duplica", () => {
    const a = filtrarMovimentacoes(movs, { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "area-A", lotes: [] });
    const b = filtrarMovimentacoes(movs, { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "area-B", lotes: [] });
    expect(a.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
    expect(b.map((m) => m.id)).toEqual(["m3", "m1"]);
    const soma = (lista, fluxo, area) => lista.filter((m) => fluxoNaArea(m, area) === fluxo).reduce((s, m) => s + m.quantidade_animais, 0);
    expect(soma(a, "Saída", "area-A")).toBe(500);
    expect(soma(b, "Entrada", "area-B")).toBe(500);
    expect(soma(b, "Saída", "area-B")).toBe(0);
  });

  it("área vazia hoje (sem lotes) não perde eventos; outra empresa nunca entra", () => {
    const a = filtrarMovimentacoes(movs, { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "area-A", lotes: [] });
    expect(a).toHaveLength(3);
    expect(a.every((m) => m.empresa_id === EMP)).toBe(true);
  });

  it("vínculo de lote: id vence; homônimo com outro id não casa; legado sem id casa pelo nome", () => {
    const lotes = [{ id: "lote-1", nome: "Nelore" }];
    expect(vinculoComLotes("lote-1", "Qualquer", lotes)).toBe("id");
    expect(vinculoComLotes("lote-homonimo", "NELORE", lotes)).toBeNull();
    expect(vinculoComLotes(undefined, " nelóre ", lotes)).toBe("nome");
  });

  it("escopo dos lotes: trajetória pelo id em qualquer área, sem homônimo", () => {
    const comHomonimo = [...movs, { id: "m5", empresa_id: EMP, tipo: "Pesagem", lote: "TESTE", lote_id: "lote-outro", area_origem_id: "area-C" }];
    const r = filtrarMovimentacoes(comHomonimo, { empresaId: EMP, escopo: ESCOPO_LOTES, lotes: [{ id: "lote-1", nome: "TESTE" }] });
    expect(r.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
  });

  it("registro sem área (medicamento) entra só depois que o lote entrou na área; com área explícita entra sempre", () => {
    const lotes = [{ id: "lote-1", nome: "TESTE" }];
    const contexto = { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "area-B", lotes };
    const entradas = entradasNaArea(movs.filter((m) => m.empresa_id === EMP), contexto);
    expect(entradas.get("lote-1")).toBe(Date.parse("2026-02-03T10:00:00.000Z"));
    const registros = [
      { id: "r-antes", empresa_id: EMP, lote_id: "lote-1", created_date: "2026-01-15T00:00:00.000Z" },
      { id: "r-depois", empresa_id: EMP, lote_id: "lote-1", created_date: "2026-02-10T00:00:00.000Z" },
      { id: "r-outro-lote-na-area", empresa_id: EMP, lote_id: "lote-x", area: "area-B", created_date: "2026-01-01T00:00:00.000Z" },
    ];
    const r = filtrarRegistrosDeLote({
      registros,
      loteId: (x) => x.lote_id,
      loteNome: () => undefined,
      criadoEm: (x) => x.created_date,
      tocaArea: (x) => (x.area ? x.area === "area-B" : null),
      contexto,
      entradas,
    });
    expect(r.map((x) => x.registro.id)).toEqual(["r-depois", "r-outro-lote-na-area"]);
    expect(r[1].vinculo).toBe("area");
  });

  it("lote derivado (movimentação parcial) usa a própria entrada na área quando não há transferência pelo id dele", () => {
    const derivado = { id: "lote-2", nome: "TESTE", area_entrada_id: "area-B", created_date: "2026-02-01T10:00:05.000Z" };
    const entradas = entradasNaArea(movs, { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "area-B", lotes: [derivado] });
    expect(entradas.get("lote-2")).toBe(Date.parse("2026-02-01T10:00:05.000Z"));
  });
});

// ── Componente ──────────────────────────────────────────────────────────

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  buscarLoteDoHistorico: vi.fn(async () => null),
  cancelarMovimentacaoMapa: vi.fn(),
  consultarCancelamentoMovimentacao: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(),
  getMapaCacheSnapshot: vi.fn(),
  refreshMapaCacheEntry: vi.fn(),
}));
const empresa = vi.hoisted(() => ({ atual: "emp-1" }));

vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ administrador_fazenda: false }), ehAdministrador: (u) => u?.administrador_fazenda === true }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => empresa.atual }));

const { default: HistoricoMovimentacoes } = await import("@/components/lotes/HistoricoMovimentacoes");

const TRES_REAIS = [
  transf("mv-3", { quantidade_animais: 100, created_date: "2026-10-31T10:00:00.000Z", area_origem_id: "area-B", area_origem_nome: "TET", area_destino_id: "area-A", area_destino_nome: "TESTE" }),
  transf("mv-2", { quantidade_animais: 50, created_date: "2026-10-30T16:00:00.000Z" }),
  transf("mv-1", { quantidade_animais: 50, lote_id: "lote-2", created_date: "2026-10-30T15:00:00.000Z" }),
];

const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ...extra });

const renderizar = (props = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <HistoricoMovimentacoes lotes={[{ id: "lote-1", nome: "TESTE", area_atual_id: "area-A" }]} areaId="area-A" {...props} />
    </QueryClientProvider>
  );
  return { ...utils, client };
};

const ficarOffline = () => Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
const ficarOnline = () => Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });

beforeEach(() => {
  ficarOnline();
  empresa.atual = EMP;
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina(TRES_REAIS));
  cache.refreshMapaCacheEntry.mockImplementation(async (chave) => (chave === "areas" ? [{ id: "area-A", nome: "TESTE", empresa_id: EMP }] : []));
  cache.getMapaCachedData.mockImplementation(async () => []);
  cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: [], atualizadoEm: null }));
});

afterEach(() => {
  cleanup();
  ficarOnline();
});

describe("HistoricoMovimentacoes — leitura online", () => {
  it("as três movimentações aparecem (antes: 'Nenhum lançamento encontrado'), com total e sem botão Excluir", async () => {
    renderizar();
    expect(await screen.findByText("Movimentações: 3 de 3")).toBeTruthy();
    expect(screen.getAllByText("Transferência de Área").length).toBe(3);
    expect(screen.getByText("Histórico da Área TESTE (3)")).toBeTruthy();
    expect(screen.getAllByText("Saída")).toHaveLength(2);
    expect(screen.getAllByText("Entrada")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.getAllByText("Ativo")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Cancelar movimentação" })).toBeNull(); // usuário comum
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledWith(
      expect.objectContaining({ empresaId: EMP, areaId: "area-A", cursor: null, limit: 100 })
    );
  });

  it("520 movimentos: mostra 100 de 520 e 'Carregar mais' pede a próxima página pelo cursor", async () => {
    const lote = Array.from({ length: 100 }, (_, i) => transf(`p1-${i}`, { created_date: new Date(Date.UTC(2026, 9, 30, 0, 0, 520 - i)).toISOString() }));
    const lote2 = Array.from({ length: 100 }, (_, i) => transf(`p2-${i}`, { created_date: new Date(Date.UTC(2026, 9, 29, 0, 0, 420 - i)).toISOString() }));
    servico.listarHistoricoMovimentacoesPagina
      .mockImplementationOnce(async () => pagina(lote, { total: 520, has_more: true, next_cursor: "c1" }))
      .mockImplementationOnce(async () => pagina(lote2, { total: 520, has_more: true, next_cursor: "c2" }));
    renderizar();
    expect(await screen.findByText("Movimentações: 100 de 520")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Movimentações: 200 de 520")).toBeTruthy();
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c1" }));
  });

  it("vazio legítimo: 'Nenhum lançamento encontrado' sem aviso de erro", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([]));
    renderizar();
    expect(await screen.findByText("Nenhum lançamento encontrado")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falha do servidor sem cache: estado de erro com 'Tentar novamente' (não confunde com vazio)", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => {
      throw Object.assign(new Error("falhou"), { code: "PROVIDER_UNAVAILABLE" });
    });
    renderizar();
    expect(await screen.findByText("Não foi possível carregar o histórico.")).toBeTruthy();
    expect(screen.queryByText("Nenhum lançamento encontrado")).toBeNull();
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina(TRES_REAIS));
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Movimentações: 3 de 3")).toBeTruthy();
  });

  it("escopo 'Lotes atuais' consulta pelo id dos lotes, não pela área", async () => {
    renderizar();
    await screen.findByText("Movimentações: 3 de 3");
    fireEvent.click(screen.getByRole("button", { name: "Lotes atuais" }));
    await waitFor(() =>
      expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenLastCalledWith(
        expect.objectContaining({ loteIds: ["lote-1"], loteNomes: ["TESTE"] })
      )
    );
    expect(servico.listarHistoricoMovimentacoesPagina.mock.lastCall[0].areaId).toBeUndefined();
  });

  it("evento 'atualizar-mapa' (nova movimentação) refaz a consulta — sem loop de revalidação", async () => {
    renderizar();
    await screen.findByText("Movimentações: 3 de 3");
    const chamadas = servico.listarHistoricoMovimentacoesPagina.mock.calls.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(servico.listarHistoricoMovimentacoesPagina.mock.calls.length).toBe(chamadas);
    act(() => {
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
    });
    await waitFor(() => expect(servico.listarHistoricoMovimentacoesPagina.mock.calls.length).toBe(chamadas + 1));
  });
});

describe("HistoricoMovimentacoes — troca de empresa e offline", () => {
  it("trocar de empresa com o histórico aberto consulta a nova empresa e não mostra a anterior", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async ({ empresaId }) =>
      empresaId === EMP ? pagina(TRES_REAIS) : pagina([])
    );
    const { rerender, client } = renderizar();
    await screen.findByText("Movimentações: 3 de 3");
    empresa.atual = OUTRA_EMP;
    rerender(
      <QueryClientProvider client={client}>
        <HistoricoMovimentacoes lotes={[{ id: "lote-9", nome: "OUTRO", area_atual_id: "area-A" }]} areaId="area-A" />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Nenhum lançamento encontrado")).toBeTruthy();
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: OUTRA_EMP }));
    expect(screen.queryByText("Movimentações: 3 de 3")).toBeNull();
  });

  it("offline: lê o cache, avisa que é cache com data, filtra outra empresa e não chama o servidor", async () => {
    ficarOffline();
    cache.getMapaCacheSnapshot.mockImplementation(async () => ({
      items: [...TRES_REAIS, transf("de-outra-empresa", { empresa_id: OUTRA_EMP })],
      atualizadoEm: "2026-10-31T09:30:00.000Z",
    }));
    renderizar();
    expect(await screen.findByText("Movimentações em cache: 3")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Sem conexão\. Exibindo movimentações salvas neste aparelho em 31\/10\/2026/);
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("R2A-R1 P1-B: online ativo → cancelado → offline o histórico ainda mostra o cancelado com motivo e autor", async () => {
    const ativo = transf("mv-c", { quantidade_animais: 40, created_date: "2026-10-31T11:00:00.000Z" });
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([ativo]));
    const { unmount } = renderizar();
    await screen.findByText("Movimentações: 1 de 1");
    expect(screen.getByText("Ativo")).toBeTruthy();
    unmount();

    ficarOffline();
    const cancelado = { ...ativo, situacao: "cancelado", cancelamento: { em: "2026-10-31T12:00:00.000Z", por_login: "admin.teste", motivo: "lançado em duplicidade" } };
    cache.getMapaCacheSnapshot.mockImplementation(async (chave) =>
      chave === "movimentacoesHistorico" ? { items: [cancelado], atualizadoEm: "2026-10-31T12:01:00.000Z" } : { items: [], atualizadoEm: null }
    );
    renderizar();
    expect(await screen.findByText("Movimentações em cache: 1")).toBeTruthy();
    expect(cache.getMapaCacheSnapshot).toHaveBeenCalledWith("movimentacoesHistorico", EMP);
    expect(screen.getAllByText("Cancelado").length).toBeGreaterThan(0);
    expect(screen.getByText(/por admin\.teste — Motivo: lançado em duplicidade/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar movimentação" })).toBeNull();
  });

  it("MAIKE-LOTES-R1: movimento cancelado de lote excluído do cadastro mostra o indicador (sem erro de lote não encontrado)", async () => {
    const cancelado = transf("mv-x", {
      quantidade_animais: 10,
      lote_id: "lote-excluido",
      situacao: "cancelado",
      cancelamento: { em: "2026-11-01T10:00:00.000Z", por_login: "admin.teste", motivo: "engano" },
    });
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([cancelado]));
    servico.buscarLoteDoHistorico.mockImplementation(async (id) => (id === "lote-excluido" ? { id, excluido_em: "2026-11-01T11:00:00.000Z" } : null));
    renderizar();
    expect(await screen.findByText(/Lote excluído do Cadastro — registro mantido para auditoria/)).toBeTruthy();
    expect(screen.getByText(/Motivo: engano/)).toBeTruthy();
    expect(screen.queryByText(/não encontrado/i)).toBeNull();
    expect(servico.buscarLoteDoHistorico).toHaveBeenCalledWith("lote-excluido");
  });

  it("offline sem nada salvo no aparelho: diz isso, em vez de 'Nenhum lançamento encontrado'", async () => {
    ficarOffline();
    renderizar();
    expect(await screen.findByText(/Este aparelho ainda não tem movimentações salvas/)).toBeTruthy();
    expect(screen.queryByText("Nenhum lançamento encontrado")).toBeNull();
  });

  it("online com sucesso guarda cópia do cache para offline (sem await, sem reinvalidar)", async () => {
    renderizar();
    await screen.findByText("Movimentações: 3 de 3");
    expect(cache.refreshMapaCacheEntry).toHaveBeenCalledWith("movimentacoesHistorico", EMP);
    expect(cache.refreshMapaCacheEntry).not.toHaveBeenCalledWith("movimentacoes", EMP);
  });

  it("servidor fora com cache disponível: mostra o cache e diz que o servidor falhou", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => {
      throw Object.assign(new Error("x"), { code: "PROVIDER_UNAVAILABLE" });
    });
    cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: TRES_REAIS, atualizadoEm: null }));
    renderizar();
    expect(await screen.findByText("Movimentações em cache: 3")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Não foi possível consultar o servidor/);
  });
});
