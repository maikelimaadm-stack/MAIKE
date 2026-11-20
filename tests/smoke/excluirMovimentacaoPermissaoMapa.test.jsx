/**
 * D-PROD-266 — quem vê "Excluir movimentação": administrador real da fazenda,
 * a concessão `is_admin` ou a NOVA chave do Mapa Geral `excluir_movimentacoes_lote`
 * (gravadora: só `=== true`, nasce desligada). Mesma permissão efetiva do mapa
 * (`carregarPermissaoEfetiva`, chave de cache `["permissao-efetiva", ...]`).
 * Serviço mockado; a prova de banco da guarda está em
 * backend/tests/exclusaoMovimentacaoPermissaoMapa.test.mjs.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(async () => 1),
  pendenciasOfflineDaMovimentacao: vi.fn(async () => []),
  eventoMudancaFilaOffline: () => "offline-entity-queue-updated",
}));
const sessao = vi.hoisted(() => ({ usuario: null, permissao: null, carregar: null }));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => ({ updateMapaCachedData: vi.fn(async () => []), refreshMapaCacheEntry: vi.fn(async () => []) }));
vi.mock("@/components/mapa/invalidarCachesMapa", () => ({ aposEscritaNoRebanho: vi.fn(async () => {}) }));
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => sessao.usuario,
  ehAdministrador: (u) => u?.administrador_fazenda === true,
  carregarPermissaoEfetiva: (u) => sessao.carregar(u),
}));

const { default: ExcluirMovimentacao, MENSAGENS_RECUSA } = await import("@/components/lotes/ExcluirMovimentacao");
const {
  podeExcluirMovimentacoesDoLote,
  normalizeMapaGeralPermissions,
  DEFAULT_MAPA_GERAL_PERMISSIONS,
  MAPA_GERAL_ACOES_GRAVADORAS,
  MAPA_GERAL_PERMISSION_GROUPS,
  MAPA_GERAL_ACESSO_TOTAL,
} = await import("@/lib/mapaGeralPermissions");

const TRANSF = {
  id: "mv-1", empresa_id: "emp-1", tipo: "Transferência de Área", lote: "NELORE", lote_id: "l1", quantidade_animais: 3,
  data_movimentacao: "2026-10-10", efeito_servidor: { comando: "rebanho_ledger", evento_id: "ev-1", operation_id: "manejo-x" },
};
const ELEGIVEL = { elegivel: true, codigo: null, pode_excluir: true, efeitos: [] };

const linhaMapa = (visualizar = true) => ({ modulo_id: "mapa", tela_id: "pec-mapa-geral", visualizar });
/** Operador com a tela do Mapa Geral e as chaves do mapa informadas. */
const operador = (mapa, { tela = true, isAdmin = false } = {}) => ({
  user_email: "vaqueiro",
  is_admin: isAdmin,
  modulos_permitidos: ["mapa"],
  permissoes_telas: [linhaMapa(tela)],
  mapa_geral_permissoes: mapa,
});
const USUARIO_OPERADOR = { id: "u-2", cliente_id: "c-1", login: "vaqueiro", administrador_fazenda: false };

const renderizar = async (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return { ...utils, client };
};
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.localStorage.clear();
  servico.consultarExclusaoMovimentacao.mockReset();
  servico.consultarExclusaoMovimentacao.mockImplementation(async () => ELEGIVEL);
  sessao.usuario = USUARIO_OPERADOR;
  sessao.permissao = null;
  sessao.carregar = vi.fn(async () => sessao.permissao);
});
afterEach(async () => {
  await assentar();
  cleanup();
});

describe("D-PROD-266 — catálogo da permissão excluir_movimentacoes_lote", () => {
  it("existe no padrão, no grupo 'Lotes de gado' com o rótulo do proprietário e é gravadora", () => {
    expect(Object.keys(DEFAULT_MAPA_GERAL_PERMISSIONS)).toContain("excluir_movimentacoes_lote");
    const grupo = MAPA_GERAL_PERMISSION_GROUPS.find((g) => g.title === "Lotes de gado");
    expect(grupo.items).toContainEqual({ key: "excluir_movimentacoes_lote", label: "Excluir movimentações do lote" });
    expect(MAPA_GERAL_ACOES_GRAVADORAS).toContain("excluir_movimentacoes_lote");
    expect(MAPA_GERAL_ACESSO_TOTAL.excluir_movimentacoes_lote).toBe(true);
  });

  it("nasce desligada: ausente, objeto ausente ou valor não booleano → false; só === true liga", () => {
    expect(normalizeMapaGeralPermissions(null, true).excluir_movimentacoes_lote).toBe(false);
    expect(normalizeMapaGeralPermissions({ mover_lotes: true }, true).excluir_movimentacoes_lote).toBe(false);
    expect(normalizeMapaGeralPermissions({ excluir_movimentacoes_lote: "true" }, true).excluir_movimentacoes_lote).toBe(false);
    expect(normalizeMapaGeralPermissions({ excluir_movimentacoes_lote: true }, true).excluir_movimentacoes_lote).toBe(true);
    expect(normalizeMapaGeralPermissions({ excluir_movimentacoes_lote: true }, false).excluir_movimentacoes_lote).toBe(false);
  });

  it("podeExcluirMovimentacoesDoLote: admin real, is_admin ou a chave com a tela do mapa", () => {
    expect(podeExcluirMovimentacoesDoLote({ administrador_fazenda: true }, null)).toBe(true);
    expect(podeExcluirMovimentacoesDoLote(USUARIO_OPERADOR, { is_admin: true })).toBe(true);
    expect(podeExcluirMovimentacoesDoLote(USUARIO_OPERADOR, operador({ excluir_movimentacoes_lote: true }))).toBe(true);
    expect(podeExcluirMovimentacoesDoLote(USUARIO_OPERADOR, operador({ excluir_movimentacoes_lote: true }, { tela: false })), "sem a tela do mapa").toBe(false);
    expect(podeExcluirMovimentacoesDoLote(USUARIO_OPERADOR, operador({ mover_lotes: true })), "chave ausente").toBe(false);
    expect(podeExcluirMovimentacoesDoLote(USUARIO_OPERADOR, null)).toBe(false);
    expect(podeExcluirMovimentacoesDoLote({ role: "admin" }, null), "role do navegador não vale").toBe(false);
  });
});

describe("D-PROD-266 — visibilidade de ExcluirMovimentacao", () => {
  it("operador SEM a chave: nenhuma ação e nenhuma consulta de elegibilidade (sem carga no servidor)", async () => {
    sessao.permissao = operador({ mover_lotes: true, visualizar_historico_movimentacoes_lote: true });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await assentar();
    expect(sessao.carregar).toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
  });

  it("operador com a chave mas sem a tela do Mapa Geral: nada", async () => {
    sessao.permissao = operador({ excluir_movimentacoes_lote: true }, { tela: false });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await assentar();
    expect(screen.queryByRole("button")).toBeNull();
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
  });

  it("operador COM a chave: vê a ação e confere a elegibilidade", async () => {
    sessao.permissao = operador({ excluir_movimentacoes_lote: true });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect(await screen.findByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledWith("mv-1", expect.anything());
  });

  it("concessão is_admin: vê a ação", async () => {
    sessao.permissao = operador({}, { isAdmin: true });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect(await screen.findByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
  });

  it("administrador real: vê a ação sem precisar ler a permissão", async () => {
    sessao.usuario = { id: "u-1", cliente_id: "c-1", login: "dono", administrador_fazenda: true };
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect(await screen.findByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
    expect(sessao.carregar).not.toHaveBeenCalled();
  });

  it("falha ao ler a permissão: fecha (nenhuma ação)", async () => {
    sessao.carregar = vi.fn(async () => { throw new Error("rede"); });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await assentar();
    expect(screen.queryByRole("button")).toBeNull();
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
  });

  it("servidor diz pode_excluir=false: bloqueada com a mensagem nova de permissão", async () => {
    sessao.permissao = operador({ excluir_movimentacoes_lote: true });
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({ ...ELEGIVEL, pode_excluir: false }));
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Você não tem permissão para excluir movimentações.")).toBeTruthy();
  });

  it("GET da elegibilidade responde 403 ACAO_NAO_PERMITIDA (revogada com a tela aberta): bloqueada com a mensagem de permissão, sem 'Verificar de novo', e relê a permissão", async () => {
    sessao.permissao = operador({ excluir_movimentacoes_lote: true });
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "ACAO_NAO_PERMITIDA" } });
    });
    const { client } = await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect((await screen.findByRole("button", { name: "Exclusão bloqueada" })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Você não tem permissão para excluir movimentações.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verificar de novo" })).toBeNull();
    expect(screen.queryByText("A conferência no servidor falhou. Nada foi alterado.")).toBeNull();
    // A permissão foi revogada no banco: a releitura (mesma chave do Mapa Geral) faz o card sumir.
    sessao.permissao = operador({ excluir_movimentacoes_lote: false });
    await act(async () => { await client.invalidateQueries({ queryKey: ["permissao-efetiva"] }); });
    await assentar();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("o próprio componente invalida ['permissao-efetiva'] ao receber o 403 de permissão", async () => {
    sessao.permissao = operador({ excluir_movimentacoes_lote: true });
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => {
      throw Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "ACAO_NAO_PERMITIDA" } });
    });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    await screen.findByRole("button", { name: "Exclusão bloqueada" });
    await assentar();
    // 1ª leitura na montagem + releitura disparada pelo 403 (sem foco nem intervalo no teste).
    expect(sessao.carregar.mock.calls.length, "permissão relida depois do 403").toBeGreaterThanOrEqual(2);
  });

  it("falha comum do GET (rede) continua 'Não foi possível verificar' com 'Verificar de novo'", async () => {
    sessao.permissao = operador({ excluir_movimentacoes_lote: true });
    servico.consultarExclusaoMovimentacao.mockImplementation(async () => { throw new Error("rede"); });
    await renderizar(<ExcluirMovimentacao movimento={TRANSF} />);
    expect(await screen.findByRole("button", { name: "Não foi possível verificar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verificar de novo" })).toBeTruthy();
  });

  it("mensagens TENANT_ADMIN_REQUIRED e ACAO_NAO_PERMITIDA (recusas definitivas)", () => {
    expect(MENSAGENS_RECUSA.TENANT_ADMIN_REQUIRED).toBe("Você não tem permissão para excluir movimentações.");
    expect(MENSAGENS_RECUSA.ACAO_NAO_PERMITIDA).toBe("Você não tem permissão para excluir movimentações.");
  });
});
