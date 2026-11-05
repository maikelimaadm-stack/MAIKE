/**
 * D-PROD-123 (H2) — histórico cronológico por OCORRÊNCIA no navegador.
 * Dados sintéticos. A ordem do servidor é a fonte; o navegador só a reproduz
 * (mesma tupla) e a aplica ao cache offline e às outras fontes carregadas.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  ESCOPO_AREA,
  chaveDeRegistro,
  chaveDoMovimento,
  compararChavesDesc,
  diaLiteral,
  filtrarMovimentacoes,
  ordenarItensDoHistorico,
  recortarPelaFronteira,
} from "@/domain/lotes/historicoMovimentacoes";

const EMP = "emp-1";

describe("H2 domínio — dia literal (paridade com o SQL do servidor)", () => {
  it("aceita 'YYYY-MM-DD' e 'YYYY-MM-DDT…' sem converter fuso; recusa inválidas", () => {
    expect(diaLiteral("2026-03-03")).toBe("2026-03-03");
    expect(diaLiteral("2026-03-03T23:30:00-04:00")).toBe("2026-03-03");
    expect(diaLiteral("2026-03-03T02:00:00.000Z")).toBe("2026-03-03");
    for (const v of ["2026-02-30", "abc", "", "31/12/2025", 20260101, null, undefined, "0000-01-01", "2026-3-3", "2026-03-03 10:00"]) {
      expect(diaLiteral(v)).toBeNull();
    }
  });
});

describe("H2 domínio — tupla (tem_ocorrência, ocorrência, registrado, criado, id) DESC", () => {
  const k = (oc, reg, criado, id) => ({ oc, reg, criado, id });
  it("ocorrência manda; sem ocorrência vai para o fim; empates por registrado, criado e id binário", () => {
    const lista = [
      k(null, "2026-12-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "semdata"),
      k("2024-01-02", "2026-12-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", "retroativo-tardio"),
      k("2031-12-31", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "futuro-legado"),
      k("2026-04-04", "2026-05-05T05:05:05.505Z", "2026-05-05T05:05:05.505Z", "a"),
      k("2026-04-04", "2026-05-05T05:05:05.505Z", "2026-05-05T05:05:05.505Z", "B"),
      k("2026-04-04", "2026-05-06T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "reg-mais-novo"),
    ];
    expect([...lista].sort(compararChavesDesc).map((x) => x.id)).toEqual([
      "futuro-legado",
      "reg-mais-novo",
      "a",
      "B", // 'B' (0x42) < 'a' (0x61): ordem binária, igual ao COLLATE "C"
      "retroativo-tardio",
      "semdata",
    ]);
  });

  it("chave do movimento: do endpoint H2 usa historico_*; do cache só o comprovável (PR191-R2)", () => {
    const doServidor = { id: "m1", created_date: "2026-02-01T10:00:00.000Z", data_movimentacao: "2020-01-01", historico_ocorrencia: "2026-01-01", historico_registrado_em: "2026-02-01T09:59:55.000Z" };
    expect(chaveDoMovimento(doServidor, { doServidor: true })).toEqual({ oc: "2026-01-01", reg: "2026-02-01T09:59:55.000Z", criado: "2026-02-01T10:00:00.000Z", id: "m1" });
    expect(chaveDoMovimento({ ...doServidor, historico_ocorrencia: null }, { doServidor: true }).oc).toBeNull();
    // Cache: efeito_servidor.registrado_em não é autoridade (vínculo não comprovável) → created_date.
    const doCache = { id: "m2", created_date: "2026-02-01T10:00:00.000Z", data_movimentacao: "2026-01-15T12:00:00.000Z", efeito_servidor: { registrado_em: "2026-02-01T09:00:00.000Z" } };
    expect(chaveDoMovimento(doCache)).toEqual({ oc: "2026-01-15", reg: "2026-02-01T10:00:00.000Z", criado: "2026-02-01T10:00:00.000Z", id: "m2" });
  });

  it("offline: o snapshot é filtrado e ordenado por ocorrência (não por cadastro)", () => {
    const movs = [
      { id: "novo-cadastro-fato-antigo", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2025-01-01", created_date: "2026-10-31T00:00:00.000Z" },
      { id: "fato-recente", empresa_id: EMP, area_origem_id: "A", data_movimentacao: "2026-10-01", created_date: "2026-10-01T00:00:00.000Z" },
      { id: "sem-data", empresa_id: EMP, area_origem_id: "A", created_date: "2026-11-01T00:00:00.000Z" },
    ];
    const r = filtrarMovimentacoes(movs, { empresaId: EMP, escopo: ESCOPO_AREA, areaId: "A", lotes: [] });
    expect(r.map((m) => m.id)).toEqual(["fato-recente", "novo-cadastro-fato-antigo", "sem-data"]);
  });

  it("outras fontes: só entram até o último movimento carregado enquanto houver páginas", () => {
    const fronteira = { oc: "2026-06-01", reg: "2026-06-01T00:00:00.000Z", criado: "2026-06-01T00:00:00.000Z", id: "mov-ultimo" };
    const outros = [
      { ordem: chaveDeRegistro("2026-07-01", "2026-07-01T00:00:00.000Z", "supl-1") },
      { ordem: chaveDeRegistro("2026-05-01", "2026-05-01T00:00:00.000Z", "med-1") },
      { ordem: chaveDeRegistro(null, "2026-05-01T00:00:00.000Z", "san-sem-data") },
    ];
    expect(recortarPelaFronteira(outros, fronteira)).toEqual({ visiveis: [outros[0]], adiados: 2 });
    expect(recortarPelaFronteira(outros, null)).toEqual({ visiveis: outros, adiados: 0 });
    expect(ordenarItensDoHistorico(outros).map((x) => x.ordem.id)).toEqual(["supl-1", "med-1", "san-sem-data"]);
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

vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ administrador_fazenda: false }), ehAdministrador: () => false }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => EMP }));

const { default: HistoricoMovimentacoes } = await import("@/components/lotes/HistoricoMovimentacoes");

const mov = (id, ocorrencia, registrado, extra = {}) => ({
  id,
  empresa_id: EMP,
  tipo: "Pesagem",
  lote: "TESTE",
  lote_id: "lote-1",
  quantidade_animais: 10,
  area_origem_id: "area-A",
  data_movimentacao: ocorrencia ?? undefined,
  created_date: registrado,
  historico_ocorrencia: ocorrencia,
  historico_ocorrencia_origem: ocorrencia ? "data_movimentacao" : null,
  historico_registrado_em: registrado,
  ...extra,
});
const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2", ...extra });

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HistoricoMovimentacoes lotes={[{ id: "lote-1", nome: "TESTE", area_atual_id: "area-A" }]} areaId="area-A" />
    </QueryClientProvider>
  );
};
const cards = () => screen.getAllByTestId("ocorrencia").map((el) => el.closest(".border"));
const erroDoServidor = (code) => Object.assign(new Error(code), { cause: { code } });

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  servico.listarHistoricoMovimentacoesPagina.mockReset();
  cache.refreshMapaCacheEntry.mockImplementation(async (chave) => (chave === "areas" ? [{ id: "area-A", nome: "TESTE", empresa_id: EMP }] : []));
  cache.getMapaCachedData.mockImplementation(async () => []);
  cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: [], atualizadoEm: null }));
});
afterEach(() => cleanup());

describe("H2 componente — Ocorrência × Registrado em", () => {
  it("mostra as duas datas, a ausência explícita e mantém a ordem do servidor", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () =>
      pagina([
        mov("m-recente", "2026-10-30", "2026-10-30T15:00:00.000Z"),
        mov("m-retroativo", "2026-01-05", "2026-10-31T18:00:00.000Z"),
        mov("m-sem-data", null, "2026-11-01T08:00:00.000Z"),
      ])
    );
    renderizar();
    expect(await screen.findByText("Movimentações: 3 de 3")).toBeTruthy();
    const lista = cards();
    expect(within(lista[0]).getByTestId("ocorrencia").textContent).toBe("Ocorrência: 30/10/2026");
    expect(within(lista[1]).getByTestId("ocorrencia").textContent).toBe("Ocorrência: 05/01/2026");
    expect(within(lista[1]).getByTestId("registrado-em").textContent).toMatch(/^Registrado em: 31\/10\/2026/);
    expect(within(lista[2]).getByTestId("ocorrencia").textContent).toBe("Ocorrência: Data da ocorrência não informada");
    expect(within(lista[2]).getByText("Sem data")).toBeTruthy();
  });

  it("outras fontes: aviso de cobertura e registro mais antigo que a fronteira espera a próxima página", async () => {
    servico.listarHistoricoMovimentacoesPagina
      .mockImplementationOnce(async () => pagina([mov("m1", "2026-10-01", "2026-10-01T10:00:00.000Z")], { total: 2, has_more: true, next_cursor: "v2-c1" }))
      .mockImplementationOnce(async () => pagina([mov("m2", "2026-03-01", "2026-03-01T10:00:00.000Z")], { total: 2 }));
    cache.refreshMapaCacheEntry.mockImplementation(async (chave) => {
      if (chave === "areas") return [{ id: "area-A", nome: "TESTE", empresa_id: EMP }];
      if (chave === "aplicacaoMedicamento")
        return [
          { id: "med-novo", empresa_id: EMP, lote_id: "lote-1", lote_nome: "TESTE", data_aplicacao: "2026-10-15", created_date: "2026-10-15T09:00:00.000Z" },
          { id: "med-antigo", empresa_id: EMP, lote_id: "lote-1", lote_nome: "TESTE", data_aplicacao: "2026-02-01", created_date: "2026-02-01T09:00:00.000Z" },
        ];
      return [];
    });
    renderizar();
    const aviso = await screen.findByTestId("aviso-cobertura");
    await waitFor(() => expect(aviso.textContent).toMatch(/1 registro mais antigo aparece ao carregar mais/));
    expect(cards().map((c) => within(c).getByTestId("ocorrencia").textContent)).toEqual(["Ocorrência: 15/10/2026", "Ocorrência: 01/10/2026"]);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await screen.findByText("Movimentações: 2 de 2");
    await waitFor(() =>
      expect(cards().map((c) => within(c).getByTestId("ocorrencia").textContent)).toEqual([
        "Ocorrência: 15/10/2026",
        "Ocorrência: 01/10/2026",
        "Ocorrência: 01/03/2026",
        "Ocorrência: 01/02/2026",
      ])
    );
    expect(screen.getByTestId("aviso-cobertura").textContent).not.toMatch(/aparece/);
  });
});

describe("H2 componente — cursor recusado", () => {
  it("HISTORICO_CURSOR_INVALIDO na próxima página → recomeça da primeira (cursor null), uma vez", async () => {
    servico.listarHistoricoMovimentacoesPagina
      .mockImplementationOnce(async () => pagina([mov("m1", "2026-10-01", "2026-10-01T10:00:00.000Z")], { total: 2, has_more: true, next_cursor: "cursor-velho" }))
      .mockImplementationOnce(async () => {
        throw erroDoServidor("HISTORICO_CURSOR_INVALIDO");
      })
      .mockImplementation(async () => pagina([mov("m1", "2026-10-01", "2026-10-01T10:00:00.000Z"), mov("m2", "2026-03-01", "2026-03-01T10:00:00.000Z")]));
    renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Movimentações: 2 de 2")).toBeTruthy();
    const chamadas = servico.listarHistoricoMovimentacoesPagina.mock.calls.map((c) => c[0].cursor);
    expect(chamadas).toEqual([null, "cursor-velho", null]);
  });

  it("outra falha na próxima página NÃO reinicia: fica visível como erro", async () => {
    servico.listarHistoricoMovimentacoesPagina
      .mockImplementationOnce(async () => pagina([mov("m1", "2026-10-01", "2026-10-01T10:00:00.000Z")], { total: 2, has_more: true, next_cursor: "c1" }))
      .mockImplementation(async () => {
        throw erroDoServidor("PROVIDER_UNAVAILABLE");
      });
    renderizar();
    await screen.findByText("Movimentações: 1 de 2");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText(/Não foi possível carregar a próxima página/)).toBeTruthy();
    expect(servico.listarHistoricoMovimentacoesPagina.mock.calls.map((c) => c[0].cursor)).toEqual([null, "c1"]);
  });
});

describe("H2 componente — offline parcial", () => {
  it("snapshot do aparelho ordenado por ocorrência, rotulado 'Histórico offline parcial' com data e contagem", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    const doCache = (id, dataMov, criado) => ({ id, empresa_id: EMP, tipo: "Pesagem", lote: "TESTE", lote_id: "lote-1", area_origem_id: "area-A", data_movimentacao: dataMov, created_date: criado });
    cache.getMapaCacheSnapshot.mockImplementation(async (chave) =>
      chave === "movimentacoesHistorico"
        ? {
            items: [doCache("c-retro", "2025-12-01", "2026-10-31T10:00:00.000Z"), doCache("c-recente", "2026-10-20", "2026-10-20T10:00:00.000Z"), doCache("c-sem", "", "2026-11-01T10:00:00.000Z")],
            atualizadoEm: "2026-11-01T11:00:00.000Z",
          }
        : { items: [], atualizadoEm: null }
    );
    renderizar();
    expect(await screen.findByText("Movimentações em cache: 3")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Histórico offline parcial: 3 movimentações salvas neste aparelho, atualizado em 01\/11\/2026/);
    expect(cards().map((c) => within(c).getByTestId("ocorrencia").textContent)).toEqual([
      "Ocorrência: 20/10/2026",
      "Ocorrência: 01/12/2025",
      "Ocorrência: Data da ocorrência não informada",
    ]);
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
  });
});
