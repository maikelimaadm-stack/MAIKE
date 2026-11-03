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

  it("não elegível (dependência/vínculo): explica com tipo e data, sem botão de confirmar", async () => {
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({
      elegivel: false,
      codigo: "REBANHO_CANCELAMENTO_VINCULO_POSTERIOR",
      detalhes: { bloqueadores: [{ tipo: "LancamentoTarefa", id: "t1", data: "2026-10-15" }] },
    }));
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
    expect(await screen.findByText(/LancamentoTarefa de 15\/10\/2026/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  });

  it("já excluída por outra sessão: tira das telas/caches em vez de mostrar erro", async () => {
    servico.excluirMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "EXCLUSAO_JA_REALIZADA" } });
    });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await abrirEConfirmar();
    await waitFor(() => expect(servico.removerMovimentacaoExcluidaDoCacheOffline).toHaveBeenCalledWith("mv-1"));
  });

  it("operação na fila offline para o registro: bloqueia e explica (falha fechada)", async () => {
    servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => ["update"]);
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await clicar(await screen.findByRole("button", { name: "Excluir movimentação" }));
    expect(await screen.findByText(/operação offline ainda não sincronizada/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motivo da exclusão"), { target: { value: "lançado errado" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Excluir definitivamente" }).hasAttribute("disabled")).toBe(true);
  });

  it("usuário comum: sem ação; offline: desabilitado com motivo e sem chamada; legado e cancelado: sem ação", async () => {
    sessao.usuario = { administrador_fazenda: false };
    const { unmount } = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await assentar();
    expect(screen.queryByRole("button", { name: "Excluir movimentação" })).toBeNull();
    unmount();

    sessao.usuario = { id: "u-1", cliente_id: "c-1", administrador_fazenda: true };
    online(false);
    const off = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    const botao = await screen.findByRole("button", { name: "Excluir movimentação" });
    expect(botao.hasAttribute("disabled")).toBe(true);
    expect(botao.getAttribute("title")).toMatch(/só com conexão/);
    expect(screen.getByText("Exclusão só com conexão")).toBeTruthy();
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalledWith("mv-1-offline");
    off.unmount();
    online(true);

    for (const mov of [LEGADO, { ...TRANSF, situacao: "cancelado" }, { ...TRANSF, efeito_servidor: { comando: "rebanho_ledger" } }]) {
      const r = await renderizar(<ExcluirMovimentacao movimento={mov} />);
      await assentar();
      expect(screen.queryByRole("button", { name: "Excluir movimentação" })).toBeNull();
      r.unmount();
    }
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
