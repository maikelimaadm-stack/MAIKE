/**
 * R2A (D-PROD-95) — UI do cancelamento server-side, curral e renomeação.
 * Dados sintéticos; serviço mockado (a prova de banco está em
 * backend/tests/movimentacaoCancelamentoR2A.test.mjs).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  cancelarMovimentacaoMapa: vi.fn(),
  consultarCancelamentoMovimentacao: vi.fn(),
  listarTodasMovimentacoes: vi.fn(),
  atualizarLote: vi.fn(),
  criarMovimentacao: vi.fn(),
}));
const sessao = vi.hoisted(() => ({ usuario: { administrador_fazenda: true } }));

const cache = vi.hoisted(() => ({ refreshMapaCacheEntry: vi.fn(async () => []) }));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => sessao.usuario,
  ehAdministrador: (u) => u?.administrador_fazenda === true,
}));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const { default: CancelarMovimentacao } = await import("@/components/lotes/CancelarMovimentacao");
const { default: HistoricoAbateCurral } = await import("@/components/mapa/HistoricoAbateCurral");
const { default: RenomearLoteForm } = await import("@/components/lotes/RenomearLoteForm");

// Criado pelo comando do servidor (R2A-R1): carrega a proveniência causal.
const EFEITO_SERVIDOR = { comando: "manejo_mapa_lote", operation_id: "manejo-x", efeitos: [{ lote_id: "l1" }] };
const MORTE = { id: "mv-1", empresa_id: "emp-1", tipo: "Morte", lote: "NELORE", lote_id: "l1", quantidade_animais: 50, area_origem_id: "a1", efeito_servidor: EFEITO_SERVIDOR };
const LEGADO = { ...MORTE, id: "mv-legado", efeito_servidor: undefined };
const ELEGIVEL = {
  elegivel: true,
  codigo: null,
  efeitos: [{ lote_id: "l1", antes: { quantidade_cabecas: 450, status: "Ativo" }, depois: { quantidade_cabecas: 500, status: "Ativo" } }],
  pode_cancelar: true,
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
  servico.cancelarMovimentacaoMapa.mockReset();
  sessao.usuario = { administrador_fazenda: true };
  servico.consultarCancelamentoMovimentacao.mockImplementation(async () => ELEGIVEL);
  servico.cancelarMovimentacaoMapa.mockImplementation(async () => ({ movimentacao: { ...MORTE, situacao: "cancelado" } }));
});
/** Deixa promessas e atualizações pendentes assentarem dentro do act. */
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

afterEach(async () => {
  await assentar();
  cleanup();
});

const abrirEConfirmar = async (motivo = "lançado por engano") => {
  await clicar(await screen.findByRole("button", { name: "Cancelar movimentação" }));
  expect(await screen.findByText("450 → 500 cab")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: motivo } });
  await clicar(screen.getByRole("button", { name: /Confirmar cancelamento|Tentar de novo/ }));
};

describe("CancelarMovimentacao", () => {
  it("admin: confere elegibilidade, mostra o efeito e envia só operation_id + motivo", async () => {
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await abrirEConfirmar();
    await waitFor(() => expect(servico.cancelarMovimentacaoMapa).toHaveBeenCalledTimes(1));
    const [id, corpo] = servico.cancelarMovimentacaoMapa.mock.calls[0];
    expect(id).toBe("mv-1");
    expect(Object.keys(corpo).sort()).toEqual(["motivo", "operation_id"]);
    expect(corpo.operation_id).toMatch(/^cancel-/);
  });

  it("resultado desconhecido (rede): avisa e reenvia com a MESMA operation_id", async () => {
    servico.cancelarMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("rede"), { code: "API_PROVIDER_UNAVAILABLE" });
    });
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await abrirEConfirmar();
    expect(await screen.findByText(/pode ou não ter sido concluído/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(servico.cancelarMovimentacaoMapa).toHaveBeenCalledTimes(2));
    const [c1, c2] = servico.cancelarMovimentacaoMapa.mock.calls.map((c) => c[1]);
    expect(c2.operation_id).toBe(c1.operation_id);
    expect(c2.motivo).toBe(c1.motivo);
  });

  it("recusa definitiva do servidor: mensagem clara e chave nova na próxima tentativa", async () => {
    servico.cancelarMovimentacaoMapa.mockImplementationOnce(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "CANCELAMENTO_DEPENDENCIA_POSTERIOR" } });
    });
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await abrirEConfirmar();
    expect(await screen.findByText(/Há registros posteriores/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(() => expect(servico.cancelarMovimentacaoMapa).toHaveBeenCalledTimes(2));
    const [c1, c2] = servico.cancelarMovimentacaoMapa.mock.calls.map((c) => c[1]);
    expect(c2.operation_id).not.toBe(c1.operation_id);
  });

  it("não elegível: explica e não oferece confirmação", async () => {
    servico.consultarCancelamentoMovimentacao.mockImplementation(async () => ({ elegivel: false, codigo: "CANCELAMENTO_VINCULO_AMBIGUO" }));
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await clicar(await screen.findByRole("button", { name: "Cancelar movimentação" }));
    expect(await screen.findByText(/sem vínculo comprovado/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar cancelamento" })).toBeNull();
  });

  it("usuário comum: sem ação; offline: desabilitado; tipo sem suporte: sem ação", async () => {
    sessao.usuario = { administrador_fazenda: false };
    const { unmount } = await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await assentar();
    expect(screen.queryByRole("button", { name: "Cancelar movimentação" })).toBeNull();
    unmount();

    sessao.usuario = { administrador_fazenda: true };
    online(false);
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    expect((await screen.findByRole("button", { name: "Cancelar movimentação" })).hasAttribute("disabled")).toBe(true);
    cleanup();
    online(true);

    await renderizar(<CancelarMovimentacao movimento={{ ...MORTE, tipo: "Pesagem" }} />);
    await assentar();
    expect(screen.queryByRole("button", { name: "Cancelar movimentação" })).toBeNull();
  });
});

describe("CancelarMovimentacao — chave pendente (R2A-R1 P1-A)", () => {
  const falhaDeRede = () => Object.assign(new Error("rede"), { code: "API_PROVIDER_UNAVAILABLE" });

  it("timeout depois do commit: fechar pede confirmação; reabrir reusa a MESMA chave e o MESMO motivo", async () => {
    servico.cancelarMovimentacaoMapa.mockImplementationOnce(async () => { throw falhaDeRede(); });
    const confirmSpy = vi.spyOn(window, "confirm");
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await abrirEConfirmar("lançado em duplicidade");
    expect(await screen.findByText(/pode ou não ter sido concluído/)).toBeTruthy();
    const c1 = servico.cancelarMovimentacaoMapa.mock.calls[0][1];

    // Recusa o abandono: o diálogo continua aberto.
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" }); await new Promise((r) => setTimeout(r, 30)); });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();

    // Aceita fechar: a operação continua guardada.
    confirmSpy.mockReturnValueOnce(true);
    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" }); await new Promise((r) => setTimeout(r, 30)); });
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();

    // Reabre: mesma chave e motivo, sem gerar outra.
    await clicar(await screen.findByRole("button", { name: "Cancelar movimentação" }));
    expect(screen.getByLabelText("Motivo do cancelamento").value).toBe("lançado em duplicidade");
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(servico.cancelarMovimentacaoMapa).toHaveBeenCalledTimes(2));
    const c2 = servico.cancelarMovimentacaoMapa.mock.calls[1][1];
    expect(c2).toEqual(c1);
    // Resposta definitiva (replay 200): a pendência sai.
    expect(window.localStorage.getItem("maike_cancelamento_pendente:mv-1")).toBeNull();
    confirmSpy.mockRestore();
  });

  it("refresh/remount: a pendência do localStorage volta com a mesma chave", async () => {
    servico.cancelarMovimentacaoMapa.mockImplementationOnce(async () => { throw falhaDeRede(); });
    const { unmount } = await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await abrirEConfirmar("erro de digitação");
    await screen.findByText(/pode ou não ter sido concluído/);
    const c1 = servico.cancelarMovimentacaoMapa.mock.calls[0][1];
    unmount(); // simula recarregar a página

    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await clicar(await screen.findByRole("button", { name: "Cancelar movimentação" }));
    expect(screen.getByLabelText("Motivo do cancelamento").value).toBe("erro de digitação");
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(servico.cancelarMovimentacaoMapa).toHaveBeenCalledTimes(2));
    expect(servico.cancelarMovimentacaoMapa.mock.calls[1][1]).toEqual(c1);
  });

  it("sucesso atualiza a cópia offline do histórico (força refresh de movimentacoesHistorico)", async () => {
    cache.refreshMapaCacheEntry.mockClear();
    await renderizar(<CancelarMovimentacao movimento={MORTE} />);
    await abrirEConfirmar();
    await waitFor(() => expect(cache.refreshMapaCacheEntry).toHaveBeenCalledWith("movimentacoesHistorico", "emp-1", { force: true }));
  });

  it("domínio: legado mostra a mensagem exata; comando do servidor libera; tipos diferidos seguem bloqueados", async () => {
    const dom = await import("@/domain/lotes/situacaoMovimento");
    expect(dom.motivoSemCancelamento(LEGADO)).toBe(
      "Registro antigo sem comprovação individual de efeito — cancelamento temporariamente indisponível"
    );
    expect(dom.tipoTemCancelamento(LEGADO)).toBe(false);
    expect(dom.tipoTemCancelamento(MORTE)).toBe(true);
    for (const tipo of ["Pesagem", "Nascimento", "Desmama", "Compra", "Venda", "Entrada"]) {
      expect(dom.tipoTemCancelamento({ ...MORTE, tipo }), tipo).toBe(false);
    }
    expect(dom.tipoTemCancelamento({ ...MORTE, motivo: "Renomear Lote" })).toBe(false);
  });

  it("registro antigo sem comprovação: nenhuma ação de cancelar", async () => {
    await renderizar(<CancelarMovimentacao movimento={LEGADO} />);
    await assentar();
    expect(screen.queryByRole("button", { name: "Cancelar movimentação" })).toBeNull();
  });
});

describe("Histórico de Abate do Curral", () => {
  it("sem 'Excluir'; cancelado aparece marcado; ativo oferece o comando do servidor", async () => {
    servico.listarTodasMovimentacoes.mockImplementation(async () => [
      { ...MORTE, id: "ab-1", tipo: "Abate", area_origem_id: "curral" },
      { ...MORTE, id: "ab-2", tipo: "Abate", area_origem_id: "curral", situacao: "cancelado", cancelamento: { por_login: "admin", motivo: "duplicado" } },
    ]);
    await renderizar(<HistoricoAbateCurral areaId="curral" />);
    expect(await screen.findByText("Histórico de Abate (2)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.getByText(/Cancelado por admin — Motivo: duplicado/)).toBeTruthy();
    expect(await screen.findAllByRole("button", { name: "Cancelar movimentação" })).toHaveLength(1);
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

describe("varredura: nenhum caminho de DELETE/PATCH de movimento do mapa no navegador", () => {
  it("o serviço não exporta mais excluir/atualizar movimentação; nenhum componente chama", () => {
    const servicoFonte = readFileSync(resolve(process.cwd(), "src/services/loteManejoService.js"), "utf8");
    expect(servicoFonte).not.toMatch(/export const excluirMovimentacao\b/);
    expect(servicoFonte).not.toMatch(/export const atualizarMovimentacao\b/);
    const usos = execSync(
      "grep -rlE \"excluirMovimentacao|deleteMovimentacaoMapaNativa|updateMovimentacaoMapaNativa|reverseMovementOnDelete\" src --include=*.js --include=*.jsx || true",
      { cwd: process.cwd() }
    ).toString().trim().split("\n").filter(Boolean).sort();
    // Só a camada de API mantém os verbos genéricos (o servidor recusa com 409).
    expect(usos).toEqual(["src/apis/lotes/lotesApi.js", "src/apis/movimentacoes-mapa/index.js", "src/apis/movimentacoes-mapa/movimentacoesMapaApi.js"]);
  });
});
