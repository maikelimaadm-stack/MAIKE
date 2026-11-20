/**
 * D-PROD-266 (etapa 1) — "Cancelar registro" no Histórico da área (DetalhesArea → aba Histórico → AbaRegistrosDaArea):
 * o MESMO cancelamento do apontamento do Lançamento de Atividades, no pé do cartão da LinhaDoTempo (`acoes`), com as
 * mesmas condições (ação extra `cancelar_apontamento`, fuso, atividade ABERTA, apontamento CONFIRMADO com `versao`),
 * diálogo de motivo (DialogoAcao), só online, e releitura do histórico e do mapa. Testes de tela (mock de serviço).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const atividades = vi.hoisted(() => ({
  acoes: {},
  fuso: { fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-18" },
  resumo: vi.fn(),
  registros: vi.fn(),
  tipos: vi.fn(),
  obterAtividade: vi.fn(),
  obterApontamento: vi.fn(),
  cancelarApontamento: vi.fn(),
}));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ...atividades.acoes, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: (empresaId) => (empresaId ? atividades.fuso : { fuso: null, fusoOk: false, semFuso: false, hoje: "" }),
}));
const avisos = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), notifyWarning: avisos.warning }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "c-1", user: { id: "u-1" } }) }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  obterResumoDaArea: atividades.resumo,
  listarRegistrosDaArea: atividades.registros,
  listarTiposAtividade: atividades.tipos,
  obterAtividade: atividades.obterAtividade,
  obterApontamento: atividades.obterApontamento,
  cancelarApontamento: atividades.cancelarApontamento,
}));
vi.mock("@/services/loteManejoService", () => ({
  listarHistoricoMovimentacoesPagina: vi.fn(async () => ({ items: [], next_cursor: null, has_more: false, total: 0, limit: 100 })),
}));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async () => [],
  getMapaCacheSnapshot: async () => ({ items: [], atualizadoEm: null }),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1", administrador_fazenda: false }),
  ehAdministrador: (u) => u?.administrador_fazenda === true,
}));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/mapa/HistoricoAbateCurral", () => ({ default: () => <div /> }));

const { default: DetalhesArea } = await import("@/components/mapa/DetalhesArea");

const TODAS = { ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true };
const PASTO = { id: "area-A", nome: "P1 — PASTO 01", tipo_cultura: "Pastagem", tamanho_hectares: 22 };
const REGISTROS = {
  items: [
    { id: "ap-2", data_operacional: "2026-11-17", atividade_id: "at-1", atividade_nome: "Gradeação · nov/26", tipo_atividade_id: "t-grad", tipo_atividade_nome: "Gradeação", area_executada_dia: "7.0000", operador_nome: "José Silva", observacao: null, maquinas: [], produtos: [], mao_obra: [], servicos: [] },
    { id: "ap-1", data_operacional: "2026-11-12", atividade_id: "at-2", atividade_nome: "Aplicação · nov/26", tipo_atividade_id: "t-apl", tipo_atividade_nome: "Aplicação / Pulverização", area_executada_dia: "22.0000", operador_nome: "Pedro Rocha", observacao: null, maquinas: [], produtos: [{ produto_nome: "Glifosato", quantidade: "44.0000", unidade: "L", dose_ha: "2.0000" }], mao_obra: [], servicos: [] },
  ],
  next_cursor: null,
};
const ATIVIDADES = { "at-1": { id: "at-1", status: "ABERTA", versao: 4 }, "at-2": { id: "at-2", status: "CONCLUIDA", versao: 9 } };

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DetalhesArea area={PASTO} permissions={{ visualizar_historico_movimentacoes_lote: true }} setorNome="RETIRO" />
    </QueryClientProvider>,
  );
};

/** Abre a aba Histórico e espera os cartões. */
const abrirHistorico = async () => {
  renderizar();
  fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
  await screen.findByText("José Silva");
};

/** O cartão (li.mk-dp-tl__card) do registro de título `titulo`. @param {string} titulo */
const cartao = (titulo) => {
  const card = [...document.querySelectorAll(".mk-dp-tl__card")].find((li) => li.querySelector(".mk-dp-tl__titulo")?.textContent === titulo);
  if (!card) throw new Error(`cartão ${titulo} não encontrado`);
  return /** @type {HTMLElement} */ (card);
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  atividades.acoes = { ...TODAS };
  atividades.fuso = { fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-18" };
  atividades.resumo.mockImplementation(async () => ({ area_id: "area-A", mes: "2026-11", atividades: [], custos: null }));
  atividades.registros.mockImplementation(async () => REGISTROS);
  atividades.tipos.mockImplementation(async () => []);
  atividades.obterAtividade.mockImplementation(async (id) => ATIVIDADES[id]);
  atividades.obterApontamento.mockImplementation(async (_atividadeId, id) => ({ id, status: "CONFIRMADO", versao: 3, data_operacional: "2026-11-17" }));
  atividades.cancelarApontamento.mockImplementation(async (_a, id) => ({ apontamento: { id, status: "CANCELADO", versao: 4 }, atividade: { id: "at-1" }, alertas: [] }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Histórico da área — Cancelar registro (D-PROD-266)", () => {
  it("atividade ABERTA: o botão no pé do cartão; CONCLUIDA: desligado com o motivo (reabrir)", async () => {
    await abrirHistorico();
    const aberto = within(cartao("Gradeação"));
    const botao = await aberto.findByRole("button", { name: /^Cancelar registro/ });
    expect(botao).not.toBeDisabled();
    expect(botao.closest(".mk-dp-tl__acoes")).toBeTruthy();
    expect(botao.closest("[data-estado-exclusao]")?.getAttribute("data-estado-exclusao")).toBe("elegivel");

    const concluido = within(cartao("Aplicação / Pulverização"));
    expect(await concluido.findByText(/Atividade concluída: para cancelar este registro, reabra a atividade/)).toBeTruthy();
    const desligado = concluido.getByRole("button", { name: "Cancelar registro: Aplicação / Pulverização de 12/11/2026" });
    expect(desligado).toBeDisabled();
    // O motivo de estar desligado está ligado ao botão (leitor de tela ouve o porquê).
    expect(desligado).toHaveAccessibleDescription(/Atividade concluída: para cancelar este registro, reabra a atividade/);
    // Cada botão diz de qual registro se trata.
    expect(botao).toHaveAccessibleName("Cancelar registro: Gradeação de 17/11/2026");
    expect(botao).not.toHaveAttribute("aria-describedby");
    // Uma leitura por atividade, na mesma chave do detalhe da tela de atividades.
    expect(atividades.obterAtividade).toHaveBeenCalledTimes(2);
  });

  it("cancela pelo serviço existente, com a versao relida e o motivo; depois: chip Cancelado, sem ação, histórico e mapa relidos", async () => {
    const mapa = vi.fn();
    window.addEventListener("atualizar-mapa", mapa);
    try {
      await abrirHistorico();
      fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ }));
      const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
      expect(atividades.obterApontamento).toHaveBeenCalledWith("at-1", "ap-2");
      expect(within(dialogo).getByText(/Cancela só o registro desta área/)).toBeTruthy();
      const enviar = within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar");
      expect(enviar).toBeDisabled(); // motivo obrigatório
      fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-registro-area-motivo"), { target: { value: "Lançado na área errada" } });
      const chamadasAntes = atividades.registros.mock.calls.length;
      fireEvent.click(enviar);

      await waitFor(() => expect(atividades.cancelarApontamento).toHaveBeenCalledWith("at-1", "ap-2", { versao: 3, motivo: "Lançado na área errada" }));
      await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull());
      const card = cartao("Gradeação");
      expect(card.classList.contains("is-cancelado")).toBe(true);
      expect(within(card).getByText("Cancelado")).toBeTruthy();
      expect(within(card).queryByRole("button", { name: /^Cancelar registro/ })).toBeNull();
      expect(card.querySelector(".mk-dp-tl__acoes")).toBeNull();
      expect(mapa).toHaveBeenCalled();
      await waitFor(() => expect(atividades.registros.mock.calls.length).toBeGreaterThan(chamadasAntes));
    } finally {
      window.removeEventListener("atualizar-mapa", mapa);
    }
  });

  it("registro que o servidor já mostra cancelado: chip Cancelado, nenhuma ação, nenhum diálogo nem envio", async () => {
    atividades.obterApontamento.mockImplementation(async (_a, id) => ({ id, status: "CANCELADO", versao: 5 }));
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ }));
    await waitFor(() => expect(cartao("Gradeação").classList.contains("is-cancelado")).toBe(true));
    expect(within(cartao("Gradeação")).getByText("Cancelado")).toBeTruthy();
    expect(within(cartao("Gradeação")).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull();
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
  });

  it("sem a permissão cancelar_apontamento: cartões como antes (sem pé de ações) e nenhuma leitura de atividade", async () => {
    atividades.acoes = { ...TODAS, cancelarApontamento: false };
    await abrirHistorico();
    expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(2);
    expect(document.querySelector(".mk-dp-tl__acoes")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancelar registro/ })).toBeNull();
    expect(atividades.obterAtividade).not.toHaveBeenCalled();
  });

  it("sem conexão: o botão fica desligado com o aviso; nada é relido nem enviado (nada vai para fila offline)", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    await abrirHistorico();
    const card = within(cartao("Gradeação"));
    const botao = card.getByRole("button", { name: /^Cancelar registro/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAccessibleDescription(/Sem conexão: o cancelamento só é feito online/);
    expect(atividades.obterApontamento).not.toHaveBeenCalled();
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
  });

  it("a conexão cai com o cartão liberado: o botão desliga na hora e nada é lido nem enviado; volta, religa", async () => {
    await abrirHistorico();
    const botao = await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ });
    expect(botao).not.toBeDisabled();
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    const desligado = within(cartao("Gradeação")).getByRole("button", { name: /^Cancelar registro/ });
    expect(desligado).toBeDisabled();
    expect(within(cartao("Gradeação")).getByText(/Sem conexão: o cancelamento só é feito online/)).toBeTruthy();
    fireEvent.click(desligado);
    expect(atividades.obterApontamento).not.toHaveBeenCalled();
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull();

    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(within(cartao("Gradeação")).getByRole("button", { name: /^Cancelar registro/ })).not.toBeDisabled();
  });

  it("caiu a conexão com o diálogo aberto: o envio é recusado na hora, sem chamar o servidor", async () => {
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-registro-area-motivo"), { target: { value: "Teste offline" } });
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar")).not.toBeDisabled());
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
    expect(screen.getByTestId("dialogo-cancelar-registro-area")).toBeTruthy();
  });

  it("fazenda sem fuso: desligado com o aviso do fuso (o servidor recusa sem ele)", async () => {
    atividades.fuso = { fuso: null, fusoOk: false, semFuso: true, hoje: "" };
    await abrirHistorico();
    const card = within(cartao("Gradeação"));
    expect(card.getByRole("button", { name: /^Cancelar registro/ })).toBeDisabled();
    expect(card.getByText(/Configure o fuso horário da fazenda/)).toBeTruthy();
    expect(atividades.obterAtividade).not.toHaveBeenCalled();
  });

  it("recusa do servidor (versão mudou): fecha o diálogo com o aviso, relê histórico e atividade; reabrir relê a versao nova", async () => {
    let tentativas = 0;
    atividades.cancelarApontamento.mockImplementation(async (_a, id, { versao }) => {
      tentativas += 1;
      if (versao === 3) throw Object.assign(new Error("conflito"), { status: 409, code: "ATIVIDADE_VERSAO_CONFLITO", details: {} });
      return { apontamento: { id, status: "CANCELADO", versao: versao + 1 }, atividade: { id: "at-1" }, alertas: [] };
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-registro-area-motivo"), { target: { value: "Motivo válido" } });
    const registrosAntes = atividades.registros.mock.calls.length;
    const atividadeAntes = atividades.obterAtividade.mock.calls.length;
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(atividades.cancelarApontamento).toHaveBeenCalledTimes(1));
    // O diálogo com a versao velha fecha (repetir daria a mesma recusa) e o aviso diz para abrir de novo.
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull());
    expect(avisos.warning).toHaveBeenCalledWith("O registro mudou", expect.stringMatching(/Nada foi cancelado\. Abra o cancelamento de novo para conferir\.$/));
    expect(cartao("Gradeação").classList.contains("is-cancelado")).toBe(false);
    // A recusa pede releitura: o histórico da área e o status da atividade são relidos.
    await waitFor(() => expect(atividades.registros.mock.calls.length).toBeGreaterThan(registrosAntes));
    await waitFor(() => expect(atividades.obterAtividade.mock.calls.length).toBeGreaterThan(atividadeAntes));

    // Reabrir relê o apontamento e manda a versao nova.
    atividades.obterApontamento.mockImplementation(async (_a, id) => ({ id, status: "CONFIRMADO", versao: 7 }));
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ }));
    const novo = await screen.findByTestId("dialogo-cancelar-registro-area");
    fireEvent.change(within(novo).getByTestId("dialogo-cancelar-registro-area-motivo"), { target: { value: "Motivo válido" } });
    fireEvent.click(within(novo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(atividades.cancelarApontamento).toHaveBeenLastCalledWith("at-1", "ap-2", { versao: 7, motivo: "Motivo válido" }));
    expect(tentativas).toBe(2);
    await waitFor(() => expect(cartao("Gradeação").classList.contains("is-cancelado")).toBe(true));
  });

  it("recusa definitiva que não pede releitura: o diálogo continua aberto e mostra o erro do servidor", async () => {
    atividades.cancelarApontamento.mockImplementation(async () => {
      throw Object.assign(new Error("Sem permissão para cancelar."), { status: 403, code: "FORBIDDEN", details: {} });
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Cancelar registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-registro-area-motivo"), { target: { value: "Motivo válido" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    expect(await within(dialogo).findByTestId("erro-envio")).toBeTruthy();
    expect(screen.getByTestId("dialogo-cancelar-registro-area")).toBeTruthy();
    expect(cartao("Gradeação").classList.contains("is-cancelado")).toBe(false);
  });
});
