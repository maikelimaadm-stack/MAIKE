/**
 * D-PROD-110 — UI da exclusão definitiva segura de movimentação (substitui o
 * "Cancelar" nos históricos), curral e renomeação. Dados sintéticos; serviço
 * mockado (a prova de banco está em backend/tests/exclusaoMovimentacaoLedger.test.mjs).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(async () => 1),
  pendenciasOfflineDaMovimentacao: vi.fn(async () => []),
  eventoMudancaFilaOffline: () => "offline-entity-queue-updated",
  listarTodasMovimentacoes: vi.fn(),
  atualizarLote: vi.fn(),
  criarMovimentacao: vi.fn(),
}));
const sessao = vi.hoisted(() => ({ usuario: { id: "u-1", cliente_id: "c-1", administrador_fazenda: true } }));

const cache = vi.hoisted(() => ({ refreshMapaCacheEntry: vi.fn(async () => []), updateMapaCachedData: vi.fn(async () => []) }));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => sessao.usuario,
  ehAdministrador: (u) => u?.administrador_fazenda === true,
}));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const { default: ExcluirMovimentacao } = await import("@/components/lotes/ExcluirMovimentacao");
const { default: HistoricoAbateCurral } = await import("@/components/mapa/HistoricoAbateCurral");
const { default: RenomearLoteForm } = await import("@/components/lotes/RenomearLoteForm");

// Movimento do ledger: a prova é o evento + a operação idempotente (servidor confere).
const EFEITO_SERVIDOR = { comando: "rebanho_ledger", evento_id: "ev-1", operation_id: "manejo-x" };
const TRANSF = { id: "mv-1", empresa_id: "emp-1", tipo: "Transferência de Área", lote: "NELORE", lote_id: "l1", quantidade_animais: 3, data_movimentacao: "2026-10-10", efeito_servidor: EFEITO_SERVIDOR };
const LEGADO = { ...TRANSF, id: "mv-legado", efeito_servidor: { comando: "manejo_mapa_lote", efeitos: [{ lote_id: "l1", auditoria_id: "a" }] } };
const ELEGIVEL = {
  elegivel: true,
  codigo: null,
  pode_excluir: true,
  efeitos: [
    { posicao_id: "pA", nome: "NELORE", area_nome: "PASTO A", delta_desfeito: 3, quantidade_depois: 10, peso_revertido: false, removida: false },
    { posicao_id: "pB", nome: "NELORE", area_nome: "PASTO B", delta_desfeito: -3, quantidade_depois: 0, peso_revertido: true, peso_depois_kg: null, removida: true },
  ],
};

const renderizar = async (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return utils;
};
/** Clique cujo efeito é assíncrono: a continuação assenta dentro do act. */
const clicar = (el) => act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 30)); });
const online = (v) => Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });

beforeEach(() => {
  online(true);
  window.localStorage.clear();
  servico.excluirMovimentacaoMapa.mockReset();
  servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => []);
  servico.removerMovimentacaoExcluidaDoCacheOffline.mockClear();
  cache.updateMapaCachedData.mockClear();
  cache.refreshMapaCacheEntry.mockClear();
  sessao.usuario = { id: "u-1", cliente_id: "c-1", administrador_fazenda: true };
  servico.consultarExclusaoMovimentacao.mockImplementation(async () => ELEGIVEL);
  servico.excluirMovimentacaoMapa.mockImplementation(async () => ({ excluida: true, movimentacao_id: "mv-1", replay: false }));
});
/** Deixa promessas e atualizações pendentes assentarem dentro do act. */
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

afterEach(async () => {
  await assentar();
  cleanup();
});

const abrirEConfirmar = async (motivo = "lançado por engano") => {
  await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
  expect(await screen.findByText(/PASTO A: \+3 cab \(fica 10\)/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Motivo da exclusão"), { target: { value: motivo } });
  const caixa = screen.queryByRole("checkbox");
  if (caixa && !caixa.checked) fireEvent.click(caixa);
  await clicar(screen.getByRole("button", { name: /Excluir definitivamente|Tentar de novo/ }));
};

describe("ExcluirMovimentacao", () => {
  it("admin: confere elegibilidade, mostra efeito/posição removida, exige confirmação explícita e envia só operation_id + motivo", async () => {
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
    expect(await screen.findByText(/PASTO B: -3 cab \(fica 0\) · peso volta a desconhecido · posição criada por este registro deixa de existir/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motivo da exclusão"), { target: { value: "lançado errado" } });
    expect(screen.getByRole("button", { name: "Excluir definitivamente" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    await clicar(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(servico.excluirMovimentacaoMapa).toHaveBeenCalledTimes(1));
    const [id, corpo] = servico.excluirMovimentacaoMapa.mock.calls[0];
    expect(id).toBe("mv-1");
    expect(Object.keys(corpo).sort()).toEqual(["motivo", "operation_id"]);
    expect(corpo.operation_id).toMatch(/^excluir-/);
  });

  it("sucesso: some das cópias offline (tenant), das listas do mapa da EMPRESA e força refresh — sem ressurreição", async () => {
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await abrirEConfirmar();
    await waitFor(() => expect(servico.removerMovimentacaoExcluidaDoCacheOffline).toHaveBeenCalledWith("mv-1"));
    for (const chave of ["movimentacoes", "movimentacoesHistorico"]) {
      const chamada = cache.updateMapaCachedData.mock.calls.find((c) => c[0] === chave);
      expect(chamada?.[1]).toBe("emp-1");
      expect(chamada[2]([{ id: "mv-1" }, { id: "mv-2" }])).toEqual([{ id: "mv-2" }]);
      expect(cache.refreshMapaCacheEntry).toHaveBeenCalledWith(chave, "emp-1", { force: true });
    }
  });

  it("resultado desconhecido (rede): avisa e reenvia com a MESMA operation_id", async () => {
    servico.excluirMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("rede"), { code: "API_PROVIDER_UNAVAILABLE" });
    });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await abrirEConfirmar();
    expect(await screen.findByText(/pode ou não ter sido concluída/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(servico.excluirMovimentacaoMapa).toHaveBeenCalledTimes(2));
    const [c1, c2] = servico.excluirMovimentacaoMapa.mock.calls.map((c) => c[1]);
    expect(c2).toEqual(c1);
  });

  it("refresh/remount: a pendência volta com a mesma chave e o mesmo motivo; isolada por tenant+usuário", async () => {
    servico.excluirMovimentacaoMapa.mockImplementationOnce(async () => { throw Object.assign(new Error("rede"), { code: "API_PROVIDER_UNAVAILABLE" }); });
    const { unmount } = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await abrirEConfirmar("erro de digitação");
    await screen.findByText(/pode ou não ter sido concluída/);
    const c1 = servico.excluirMovimentacaoMapa.mock.calls[0][1];
    expect(window.localStorage.getItem("maike_exclusao_movimentacao_pendente:c-1:u-1:mv-1")).toBeTruthy();
    unmount();

    const r = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
    expect(screen.getByLabelText("Motivo da exclusão").value).toBe("erro de digitação");
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(servico.excluirMovimentacaoMapa).toHaveBeenCalledTimes(2));
    expect(servico.excluirMovimentacaoMapa.mock.calls[1][1]).toEqual(c1);
    expect(window.localStorage.getItem("maike_exclusao_movimentacao_pendente:c-1:u-1:mv-1")).toBeNull();
    r.unmount();

    window.localStorage.setItem("maike_exclusao_movimentacao_pendente:c-1:u-1:mv-1", JSON.stringify({ operation_id: "excluir-A", motivo: "do A" }));
    sessao.usuario = { id: "u-2", cliente_id: "c-1", administrador_fazenda: true };
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
    expect((await screen.findByLabelText("Motivo da exclusão")).value).toBe("");
  });

  it("recusa definitiva: mensagem com o bloqueador, nada mudou, chave nova na próxima tentativa", async () => {
    servico.excluirMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "CANCELAMENTO_SALDO_HISTORICO_NEGATIVO" }, details: { data: "2026-10-12", area_nome: "PASTO B" } });
    });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await abrirEConfirmar();
    const alerta = await screen.findByText(/saldo negativo em PASTO B no dia 12\/10\/2026/);
    expect(alerta.textContent).toMatch(/Nada foi alterado/);
    await clicar(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(servico.excluirMovimentacaoMapa).toHaveBeenCalledTimes(2));
    const [c1, c2] = servico.excluirMovimentacaoMapa.mock.calls.map((c) => c[1]);
    expect(c2.operation_id).not.toBe(c1.operation_id);
  });

  it("já excluída por outra sessão: tira das telas/caches em vez de mostrar erro", async () => {
    servico.excluirMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "EXCLUSAO_JA_REALIZADA" } });
    });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await abrirEConfirmar();
    await waitFor(() => expect(servico.removerMovimentacaoExcluidaDoCacheOffline).toHaveBeenCalledWith("mv-1"));
  });

  it("domínio: só movimento ativo do ledger oferece exclusão; todos os manejos do ledger", async () => {
    const dom = await import("@/domain/lotes/situacaoMovimento");
    for (const tipo of ["Transferência de Área", "Morte", "Abate", "Nascimento", "Pesagem", "Mudança de Categoria", "Junção de Lotes"]) {
      expect(dom.tipoTemExclusao({ ...TRANSF, tipo, lote_ids: ["a", "b"] }), tipo).toBe(true);
    }
    expect(dom.tipoTemExclusao(LEGADO)).toBe(false);
    expect(dom.tipoTemExclusao({ ...TRANSF, situacao: "cancelado" })).toBe(false);
    expect(dom.tipoTemExclusao({ ...TRANSF, tipo: "Entrada" })).toBe(false);
  });
});

describe("Pré-validação no card (MAIKE-POS178-UX) — estado ANTES do clique", () => {
  const estadoDoCard = (c) => c.querySelector("[data-estado-exclusao]")?.getAttribute("data-estado-exclusao");

  it("1) consultando: controle neutro desabilitado 'Verificando exclusão…' (nunca habilitado por padrão)", async () => {
    let soltar;
    servico.consultarExclusaoMovimentacao.mockImplementation(() => new Promise((r) => { soltar = () => r(ELEGIVEL); }));
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const b = await screen.findByRole("button", { name: "Verificando exclusão…" });
    expect(b.hasAttribute("disabled")).toBe(true);
    await act(async () => { soltar(); await new Promise((r) => setTimeout(r, 30)); });
    expect((await screen.findByRole("button", { name: "Excluir movimentação" })).hasAttribute("disabled")).toBe(false);
  });

  it("2) elegível + pode_excluir: 'Excluir movimentação' habilitado sem clique prévio", async () => {
    const { container } = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Excluir movimentação" })).hasAttribute("disabled")).toBe(false);
    expect(estadoDoCard(container)).toBe("elegivel");
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledWith("mv-1");
  });

  it("3) bloqueada por pesagem posterior: 'Exclusão bloqueada' desabilitado, motivo com tipo/data/área no card, sem abrir diálogo", async () => {
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({
      elegivel: false, pode_excluir: true, codigo: "REBANHO_DEPENDENCIA_FATO_SEM_SALDO",
      detalhes: { tipo: "PESAGEM", data: "2026-10-12", area_id: "aB", area_nome: "PASTO B" },
    }));
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const b = await screen.findByRole("button", { name: "Exclusão bloqueada" });
    expect(b.hasAttribute("disabled")).toBe(true);
    const motivo = screen.getByText(/Existe pesagem\/manejo posterior dependente; exclua o lançamento dependente primeiro\. Bloqueador: pesagem em 12\/10\/2026 \(PASTO B\)\./);
    expect(b.getAttribute("aria-describedby")).toBe(motivo.id);
    fireEvent.click(b);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir movimentação" })).toBeNull();
  });

  it("3b) vínculo de outro módulo: motivo do servidor com tipo e data", async () => {
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({
      elegivel: false, codigo: "REBANHO_CANCELAMENTO_VINCULO_POSTERIOR",
      detalhes: { bloqueadores: [{ tipo: "LancamentoTarefa", id: "t1", data: "2026-10-15" }] },
    }));
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/LancamentoTarefa de 15\/10\/2026/)).toBeTruthy();
  });

  it("4) erro de rede/API: 'Não foi possível verificar' desabilitado + 'Verificar de novo' só reconsulta (não exclui)", async () => {
    servico.consultarExclusaoMovimentacao.mockImplementationOnce(async () => { throw Object.assign(new Error("rede"), { code: "API_PROVIDER_UNAVAILABLE" }); });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Não foi possível verificar" })).hasAttribute("disabled")).toBe(true);
    await clicar(screen.getByRole("button", { name: "Verificar de novo" }));
    expect((await screen.findByRole("button", { name: "Excluir movimentação" })).hasAttribute("disabled")).toBe(false);
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(2);
    expect(servico.excluirMovimentacaoMapa).not.toHaveBeenCalled();
  });

  it("5) offline: controle desabilitado com motivo e NENHUMA consulta", async () => {
    online(false);
    servico.consultarExclusaoMovimentacao.mockClear();
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão indisponível" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Sem conexão: a exclusão só é feita online/)).toBeTruthy();
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
  });

  it("6) pendência offline do registro: 'Exclusão bloqueada' com motivo (falha fechada)", async () => {
    servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => ["update"]);
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/operação offline ainda não sincronizada/)).toBeTruthy();
  });

  it("sem autorização, legado e cancelado: nenhuma ação e nenhuma consulta", async () => {
    servico.consultarExclusaoMovimentacao.mockClear();
    sessao.usuario = { administrador_fazenda: false };
    let r = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await assentar();
    expect(screen.queryByRole("button")).toBeNull();
    r.unmount();
    sessao.usuario = { id: "u-1", cliente_id: "c-1", administrador_fazenda: true };
    for (const mov of [LEGADO, { ...TRANSF, situacao: "cancelado" }, { ...TRANSF, efeito_servidor: { comando: "rebanho_ledger" } }]) {
      r = await renderizar(<ExcluirMovimentacao movimento={mov} />);
      await assentar();
      expect(screen.queryByRole("button")).toBeNull();
      r.unmount();
    }
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
  });

  it("pode_excluir=false (admin revogado no servidor): bloqueada, não habilita", async () => {
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({ ...ELEGIVEL, pode_excluir: false }));
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
  });

  it("abrir revalida no servidor: se ficou bloqueada entre o card e o clique, o diálogo não oferece confirmar", async () => {
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const b = await screen.findByRole("button", { name: "Excluir movimentação" });
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({ elegivel: false, codigo: "CANCELAMENTO_SALDO_HISTORICO_NEGATIVO", detalhes: { data: "2026-10-12", area_nome: "PASTO B" } }));
    await clicar(b);
    await assentar();
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  });

  it("corrida GET→POST: servidor responde 409 no POST → mensagem, nada local muda, card reconsulta", async () => {
    servico.excluirMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "REBANHO_DEPENDENCIA_FATO_SEM_SALDO" }, details: { tipo: "PESAGEM", data: "2026-10-12" } });
    });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const antes = servico.consultarExclusaoMovimentacao.mock.calls.length;
    await abrirEConfirmar();
    expect(await screen.findByText(/pesagem do dia 12\/10\/2026/)).toBeTruthy();
    expect(servico.removerMovimentacaoExcluidaDoCacheOffline).not.toHaveBeenCalled();
    expect(cache.updateMapaCachedData).not.toHaveBeenCalled();
    await waitFor(() => expect(servico.consultarExclusaoMovimentacao.mock.calls.length).toBeGreaterThan(antes + 1));
  });

  it("escopo: outro tenant/empresa/usuário não reaproveita a resposta (chave por tenant+usuário+empresa+id)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (mov) => <QueryClientProvider client={client}><ExcluirMovimentacao movimento={mov} /></QueryClientProvider>;
    const r = render(ui(TRANSF));
    await screen.findByRole("button", { name: "Excluir movimentação" });
    r.unmount();
    servico.consultarExclusaoMovimentacao.mockClear();
    render(ui({ ...TRANSF, empresa_id: "emp-2" }));
    await screen.findByRole("button", { name: "Excluir movimentação" });
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(1);
    const chaves = client.getQueryCache().findAll({ queryKey: ["elegibilidade-exclusao-movimentacao"] }).map((q) => q.queryKey);
    expect(chaves).toEqual(expect.arrayContaining([
      ["elegibilidade-exclusao-movimentacao", "c-1", "u-1", "emp-1", "mv-1"],
      ["elegibilidade-exclusao-movimentacao", "c-1", "u-1", "emp-2", "mv-1"],
    ]));
  });
});

describe("Pré-validação — escala (100 movimentos)", () => {
  it("100 cards visíveis: no máximo 2 GETs simultâneos, um por card, sem laço", async () => {
    let emVoo = 0, maximo = 0;
    servico.consultarExclusaoMovimentacao.mockClear();
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => {
      emVoo += 1; maximo = Math.max(maximo, emVoo);
      await new Promise((r) => setTimeout(r, 1));
      emVoo -= 1;
      return ELEGIVEL;
    });
    const movs = Array.from({ length: 100 }, (_, i) => ({ ...TRANSF, id: `mv-${i}` }));
    await renderizar(<div>{movs.map((m) => <ExcluirMovimentacao key={m.id} movimento={m} />)}</div>);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Excluir movimentação" })).toHaveLength(100), { timeout: 30000 });
    await assentar();
    expect(maximo).toBeLessThanOrEqual(2);
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(100);
  }, 40000);

  it("com IntersectionObserver: só os cards na área visível consultam (viewport inicial)", async () => {
    const original = globalThis.IntersectionObserver;
    let ordem = 0;
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; this.n = ordem++; }
      observe(el) { this.cb([{ target: el, isIntersecting: this.n < 6 }]); }
      disconnect() {}
    };
    try {
      servico.consultarExclusaoMovimentacao.mockClear();
      servico.consultarExclusaoMovimentacao.mockImplementation(async () => ELEGIVEL);
      const movs = Array.from({ length: 100 }, (_, i) => ({ ...TRANSF, id: `mv-v${i}` }));
      await renderizar(<div>{movs.map((m) => <ExcluirMovimentacao key={m.id} movimento={m} />)}</div>);
      await waitFor(() => expect(screen.getAllByRole("button", { name: "Excluir movimentação" })).toHaveLength(6));
      await assentar();
      expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(6);
      expect(screen.getAllByRole("button", { name: "Verificando exclusão…" })).toHaveLength(94);
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });
});

describe("PR180-R2 — fail-closed: fila offline e elegibilidade precisam de resultado confiável", () => {
  const adiado = () => { let resolver, rejeitar; const promessa = new Promise((r, j) => { resolver = r; rejeitar = j; }); return { promessa, resolver, rejeitar }; };
  // `hidden: true`: com o diálogo aberto, o card fica sob aria-hidden — ainda assim não pode estar habilitado.
  const botaoExcluir = () => screen.queryByRole("button", { name: "Excluir movimentação", hidden: true });

  it("A) GET elegível já respondeu, fila offline ainda pendente → 'Verificando…' desabilitado; só habilita quando a fila devolve []", async () => {
    const fila = adiado();
    servico.pendenciasOfflineDaMovimentacao.mockImplementation(() => fila.promessa);
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await waitFor(() => expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalled());
    await assentar();
    expect((await screen.findByRole("button", { name: "Verificando exclusão…" })).hasAttribute("disabled")).toBe(true);
    expect(botaoExcluir()).toBeNull();
    await act(async () => { fila.resolver([]); await new Promise((r) => setTimeout(r, 30)); });
    expect((await screen.findByRole("button", { name: "Excluir movimentação" })).hasAttribute("disabled")).toBe(false);
  });

  it("B) leitura da fila REJEITA → 'Não foi possível verificar', nenhum POST; 'Verificar de novo' relê a fila e, com [], habilita", async () => {
    servico.pendenciasOfflineDaMovimentacao.mockImplementationOnce(async () => { throw new Error("IndexedDB indisponível"); });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const b = await screen.findByRole("button", { name: "Não foi possível verificar" });
    expect(b.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Não foi possível ler a fila offline/)).toBeTruthy();
    expect(botaoExcluir()).toBeNull();
    fireEvent.click(b);
    expect(servico.excluirMovimentacaoMapa).not.toHaveBeenCalled();
    const chamadasFila = servico.pendenciasOfflineDaMovimentacao.mock.calls.length;
    await clicar(screen.getByRole("button", { name: "Verificar de novo" }));
    await waitFor(() => expect(servico.pendenciasOfflineDaMovimentacao.mock.calls.length).toBeGreaterThan(chamadasFila));
    expect((await screen.findByRole("button", { name: "Excluir movimentação" })).hasAttribute("disabled")).toBe(false);
    expect(servico.excluirMovimentacaoMapa).not.toHaveBeenCalled();
  });

  it("C) fila devolve formato inválido (undefined/null/objeto) → falha fechada, nunca habilita", async () => {
    for (const invalido of [undefined, null, { length: 0 }]) {
      servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => invalido);
      const r = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
      expect((await screen.findByRole("button", { name: "Não foi possível verificar" })).hasAttribute("disabled")).toBe(true);
      expect(botaoExcluir()).toBeNull();
      r.unmount();
    }
  });

  it("D) releitura em voo ou com erro após resposta elegível → nenhum botão habilitado com o dado antigo (card e diálogo)", async () => {
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const b = await screen.findByRole("button", { name: "Excluir movimentação" });
    const releitura = adiado();
    servico.consultarExclusaoMovimentacao.mockImplementation(() => releitura.promessa);
    await clicar(b); // abrir → revalida
    expect(screen.getAllByRole("button", { name: "Verificando exclusão…", hidden: true }).length).toBeGreaterThan(0);
    expect(botaoExcluir()).toBeNull();
    const confirmar = screen.queryByRole("button", { name: "Excluir definitivamente" });
    if (confirmar) {
      fireEvent.change(screen.getByLabelText("Motivo da exclusão"), { target: { value: "lançado errado" } });
      fireEvent.click(screen.getByRole("checkbox"));
      expect(confirmar.hasAttribute("disabled")).toBe(true);
      fireEvent.click(confirmar);
    }
    await act(async () => { releitura.rejeitar(Object.assign(new Error("rede"), { code: "API_PROVIDER_UNAVAILABLE" })); await new Promise((r) => setTimeout(r, 30)); });
    expect(botaoExcluir()).toBeNull();
    const confirmar2 = screen.queryByRole("button", { name: "Excluir definitivamente" });
    if (confirmar2) expect(confirmar2.hasAttribute("disabled")).toBe(true);
    expect(servico.excluirMovimentacaoMapa).not.toHaveBeenCalled();
  });

  it("E) pendência real na fila bloqueia card e diálogo mesmo com GET elegível; retry de resultado desconhecido usa a MESMA chave só com a fila confirmada vazia", async () => {
    servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => ["update"]);
    window.localStorage.setItem("maike_exclusao_movimentacao_pendente:c-1:u-1:mv-1", JSON.stringify({ operation_id: "excluir-original", motivo: "motivo original" }));
    let r = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
    expect(botaoExcluir()).toBeNull();
    r.unmount();

    // Fila sincronizada (vazia): o retry legítimo volta, com a mesma operação e motivo.
    servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => []);
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => { throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "MOVIMENTACAOMAPA_NOT_FOUND" } }); });
    servico.excluirMovimentacaoMapa.mockImplementation(async () => ({ excluida: true, movimentacao_id: "mv-1", replay: true }));
    r = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
    expect(screen.getByLabelText("Motivo da exclusão").value).toBe("motivo original");
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(servico.excluirMovimentacaoMapa).toHaveBeenCalledTimes(1));
    expect(servico.excluirMovimentacaoMapa.mock.calls[0][1]).toEqual({ operation_id: "excluir-original", motivo: "motivo original" });
  });
});

describe("D-PROD-113 — bugs de UX reproduzidos (RED → GREEN)", () => {
  const adiado = () => { let resolver; const promessa = new Promise((r) => { resolver = r; }); return { promessa, resolver }; };

  it("UX-1: fila offline sincroniza com o histórico aberto → o card sai de 'Exclusão bloqueada' sem precisar remontar", async () => {
    let pendentes = ["update"];
    servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => pendentes);
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
    pendentes = [];
    await act(async () => { window.dispatchEvent(new CustomEvent("offline-entity-queue-updated")); await new Promise((r) => setTimeout(r, 30)); });
    expect((await screen.findByRole("button", { name: "Excluir movimentação" })).hasAttribute("disabled")).toBe(false);
  });

  it("UX-2: cards desmontados (sair da tela/fechar o histórico) não disparam as consultas que estavam na fila", async () => {
    const pendentes = [];
    servico.consultarExclusaoMovimentacao.mockClear();
    servico.consultarExclusaoMovimentacao.mockImplementation(() => { const d = adiado(); pendentes.push(d); return d.promessa; });
    const movs = Array.from({ length: 10 }, (_, i) => ({ ...TRANSF, id: `mv-u${i}` }));
    const r = await renderizar(<div>{movs.map((m) => <ExcluirMovimentacao key={m.id} movimento={m} />)}</div>);
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(2);
    r.unmount();
    await act(async () => { for (const d of pendentes.splice(0)) d.resolver(ELEGIVEL); await new Promise((res) => setTimeout(res, 50)); });
    await act(async () => { for (const d of pendentes.splice(0)) d.resolver(ELEGIVEL); await new Promise((res) => setTimeout(res, 50)); });
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(2);
  });

  it("UX-3: consulta que nunca responde não segura a vaga do limite para sempre (libera e falha fechado)", async () => {
    const mod = await import("@/components/lotes/ExcluirMovimentacao");
    vi.useFakeTimers();
    try {
      const pendurada = mod.comLimiteDeConsultas(() => new Promise(() => {}));
      const pendurada2 = mod.comLimiteDeConsultas(() => new Promise(() => {}));
      let terceira = null;
      const p3 = mod.comLimiteDeConsultas(async () => { terceira = "rodou"; return "ok"; });
      const falhas = [pendurada.catch((e) => e), pendurada2.catch((e) => e)];
      await vi.advanceTimersByTimeAsync(mod.LIMITE_CONSULTA_MS + 10);
      const [e1, e2] = await Promise.all(falhas);
      expect(e1).toBeInstanceOf(Error);
      expect(e2).toBeInstanceOf(Error);
      expect(await p3).toBe("ok");
      expect(terceira).toBe("rodou");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Histórico de Abate do Curral", () => {
  it("cancelado antigo aparece marcado (sem limpeza retroativa); ativo do ledger oferece 'Excluir movimentação'; nenhum 'Cancelar'", async () => {
    servico.listarTodasMovimentacoes.mockImplementation(async () => [
      { ...TRANSF, id: "ab-1", tipo: "Abate", area_origem_id: "curral" },
      { ...TRANSF, id: "ab-2", tipo: "Abate", area_origem_id: "curral", situacao: "cancelado", cancelamento: { por_login: "admin", motivo: "duplicado" } },
    ]);
    await renderizar(<HistoricoAbateCurral areaId="curral" />);
    expect(await screen.findByText("Histórico de Abate (2)")).toBeTruthy();
    expect(screen.getByText(/Cancelado por admin — Motivo: duplicado/)).toBeTruthy();
    expect(await screen.findAllByRole("button", { name: "Excluir movimentação" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancelar movimentação" })).toBeNull();
    expect(servico.atualizarLote).not.toHaveBeenCalled();
  });
});

describe("Renomear Lote", () => {
  it("'Usar nome original' só preenche; salvar cria renomeação nova e nada é apagado", async () => {
    servico.listarTodasMovimentacoes.mockImplementation(async () => [
      { id: "r1", empresa_id: "emp-1", lote_id: "l1", motivo: "Renomear Lote", observacoes: 'Renomear Lote: "ORIGINAL" → "MEIO"', data_movimentacao: "2026-10-01T12:00:00Z" },
    ]);
    servico.atualizarLote.mockResolvedValue({});
    servico.criarMovimentacao.mockResolvedValue({});
    const mudancas = [];
    const Wrapper = () => {
      const [nome, setNome] = React.useState("");
      return (
        <RenomearLoteForm
          lote={{ id: "l1", nome: "ATUAL", quantidade_cabecas: 10, area_atual_id: "a1" }}
          novoNome={nome}
          onNovoNomeChange={(v) => { mudancas.push(v); setNome(v); }}
          empresaSelecionadaId="emp-1"
          areas={[{ id: "a1", nome: "PASTO" }]}
          onClose={() => {}}
          onCancel={() => {}}
        />
      );
    };
    await renderizar(<Wrapper />);
    fireEvent.click(await screen.findByRole("button", { name: /Usar nome original/ }));
    expect(mudancas).toEqual(["ORIGINAL"]);
    expect(screen.queryByRole("button", { name: /Reverter para nome original/ })).toBeNull();
    await clicar(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(servico.criarMovimentacao).toHaveBeenCalledTimes(1));
    expect(servico.atualizarLote).toHaveBeenCalledWith("l1", { nome: "ORIGINAL" });
    expect(servico.criarMovimentacao.mock.calls[0][0].observacoes).toBe('Renomear Lote: "ATUAL" → "ORIGINAL"');
  });
});

describe("varredura: correção de movimento só pelo contrato oficial de exclusão", () => {
  it("nenhum componente usa DELETE/PATCH genéricos nem edita movimento confirmado; a UI não oferece 'Cancelar'", () => {
    const servicoFonte = readFileSync(resolve(process.cwd(), "src/services/loteManejoService.js"), "utf8");
    expect(servicoFonte).not.toMatch(/export const atualizarMovimentacao\b/);
    expect(servicoFonte).not.toMatch(/deleteMovimentacao\(/);
    const usos = execSync(
      "grep -rlE \"deleteMovimentacaoMapaNativa|updateMovimentacaoMapaNativa|reverseMovementOnDelete\" src --include=*.js --include=*.jsx || true",
      { cwd: process.cwd() }
    ).toString().trim().split("\n").filter(Boolean).sort();
    // Só a camada de API mantém os verbos genéricos (o servidor recusa com 409).
    expect(usos).toEqual(["src/apis/lotes/lotesApi.js", "src/apis/movimentacoes-mapa/index.js", "src/apis/movimentacoes-mapa/movimentacoesMapaApi.js"]);
    const cancelarNaUi = execSync("grep -rlE \"Cancelar movimentação|cancelarMovimentacaoMapa\\(\" src/components src/pages || true", { cwd: process.cwd() }).toString().trim();
    expect(cancelarNaUi).toBe("");
    const port = readFileSync(resolve(process.cwd(), "src/apis/movimentacoes-mapa/movimentacaoMapaNativePort.js"), "utf8");
    expect(port).toMatch(/\/exclusao`/);
    expect(port).toMatch(/\/elegibilidade-exclusao`/);
  });
});
