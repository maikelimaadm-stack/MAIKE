/**
 * D-PROD-266 (etapa 1) — "Excluir registro" no Histórico da área (DetalhesArea → aba Histórico → AbaRegistrosDaArea):
 * por baixo, o MESMO cancelamento do apontamento do Lançamento de Atividades, no pé do cartão da LinhaDoTempo (`acoes`),
 * com as mesmas condições (ação extra `cancelar_apontamento`, fuso, atividade ABERTA, apontamento CONFIRMADO com
 * `versao`), diálogo de exclusão (DialogoAcao, sem campo de motivo desde a D-PROD-270: vai o texto fixo
 * `MOTIVO_EXCLUSAO_MAPA`), só online, e releitura do histórico e do mapa. No mapa a pessoa só vê
 * EXCLUSÃO (pedido do proprietário): textos de excluir e o registro excluído some do histórico. Testes de tela.
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
const avisos = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), notifyWarning: avisos.warning, notifySuccess: avisos.success, notifyInfo: avisos.info }));
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
const { mensagemDeErroDaExclusao, mensagemDoErroNoDialogo, textoSemCancelamento } = await import("@/components/mapa/detalhes-area/CancelarRegistroDaArea");
const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError");
const { MOTIVO_EXCLUSAO_MAPA } = await import("@/domain/mapa/motivoExclusaoMapa");

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
  fireEvent.click(screen.getByRole("tab", { name: "Manejos" }));
  await screen.findByText("José Silva");
};

/** O cartão (li.mk-dp-tl__card) do registro de título `titulo`, ou null. @param {string} titulo */
const buscarCartao = (titulo) =>
  /** @type {HTMLElement|null} */ ([...document.querySelectorAll(".mk-dp-tl__card")].find((li) => li.querySelector(".mk-dp-tl__titulo")?.textContent === titulo) ?? null);

/** O cartão (li.mk-dp-tl__card) do registro de título `titulo`. @param {string} titulo */
const cartao = (titulo) => {
  const card = buscarCartao(titulo);
  if (!card) throw new Error(`cartão ${titulo} não encontrado`);
  return card;
};

/** Nenhum texto de cancelamento/estorno visível (o mapa só fala em exclusão). @param {HTMLElement} el */
const semVocabularioDeCancelamento = (el) => {
  expect(el.textContent ?? "").not.toMatch(/cancel|estorn/i);
  for (const n of el.querySelectorAll("[aria-label]")) expect(n.getAttribute("aria-label") ?? "").not.toMatch(/cancel|estorn/i);
};

/** D-PROD-270: o diálogo não tem campo nem texto de motivo. @param {HTMLElement} dialogo */
const semCampoDeMotivo = (dialogo) => {
  expect(within(dialogo).queryByTestId("dialogo-cancelar-registro-area-motivo")).toBeNull();
  expect(within(dialogo).queryByLabelText(/Motivo/i)).toBeNull();
  expect(within(dialogo).queryByRole("textbox")).toBeNull();
  expect(dialogo.textContent ?? "").not.toMatch(/motivo/i);
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

describe("Histórico da área — Excluir registro (D-PROD-266)", () => {
  it("atividade ABERTA: o botão no pé do cartão; CONCLUIDA: desligado com o motivo (reabrir)", async () => {
    await abrirHistorico();
    const aberto = within(cartao("Gradeação"));
    const botao = await aberto.findByRole("button", { name: /^Excluir registro/ });
    expect(botao).not.toBeDisabled();
    expect(botao.closest(".mk-dp-tl__acoes")).toBeTruthy();
    expect(botao.closest("[data-estado-exclusao]")?.getAttribute("data-estado-exclusao")).toBe("elegivel");

    const concluido = within(cartao("Aplicação / Pulverização"));
    expect(await concluido.findByText(/Atividade concluída: para excluir este registro, reabra a atividade/)).toBeTruthy();
    const desligado = concluido.getByRole("button", { name: "Excluir registro: Aplicação / Pulverização de 12/11/2026" });
    expect(desligado).toBeDisabled();
    // O motivo de estar desligado está ligado ao botão (leitor de tela ouve o porquê).
    expect(desligado).toHaveAccessibleDescription(/Atividade concluída: para excluir este registro, reabra a atividade/);
    // Cada botão diz de qual registro se trata.
    expect(botao).toHaveAccessibleName("Excluir registro: Gradeação de 17/11/2026");
    expect(botao).toHaveTextContent("Excluir registro");
    // Nada de "cancelar" no histórico do mapa.
    semVocabularioDeCancelamento(screen.getByTestId("area-registros"));
    expect(botao).not.toHaveAttribute("aria-describedby");
    // Uma leitura por atividade, na mesma chave do detalhe da tela de atividades.
    expect(atividades.obterAtividade).toHaveBeenCalledTimes(2);
  });

  it("exclui pelo serviço existente, com a versao relida e o motivo fixo (sem campo); depois: o registro SOME do histórico, histórico e mapa relidos", async () => {
    const mapa = vi.fn();
    window.addEventListener("atualizar-mapa", mapa);
    try {
      await abrirHistorico();
      fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
      const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
      expect(atividades.obterApontamento).toHaveBeenCalledWith("at-1", "ap-2");
      expect(within(dialogo).getByText(/Exclui só o registro desta área/)).toBeTruthy();
      expect(within(dialogo).getByText("Excluir registro: Gradeação de 17/11/2026")).toBeTruthy();
      semCampoDeMotivo(dialogo);
      const enviar = within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar");
      expect(enviar).toHaveTextContent("Excluir registro");
      // O botão que só fecha o diálogo é "Voltar" (não "Cancelar", que confundiria com a ação).
      expect(within(dialogo).getByTestId("dialogo-cancelar-registro-area-voltar")).toHaveTextContent("Voltar");
      expect(within(dialogo).queryByRole("button", { name: /^Cancelar/ })).toBeNull();
      semVocabularioDeCancelamento(dialogo);
      // Sem campo de motivo: online e liberado, o botão já habilita sem digitar nada.
      expect(enviar).not.toBeDisabled();
      const chamadasAntes = atividades.registros.mock.calls.length;
      // O envio fica pendente até o teste soltar: durante ele, o botão diz "Excluindo..." (nunca "Enviando…").
      /** @type {(v?: unknown) => void} */
      let soltar = () => {};
      atividades.cancelarApontamento.mockImplementationOnce(
        (_a, id) =>
          new Promise((resolve) => {
            soltar = () => resolve({ apontamento: { id, status: "CANCELADO", versao: 4 }, atividade: { id: "at-1" }, alertas: [] });
          }),
      );
      fireEvent.click(enviar);
      await waitFor(() => expect(enviar).toHaveTextContent("Excluindo..."));
      expect(enviar).toBeDisabled();
      expect(enviar).not.toHaveTextContent(/Enviando/);
      semVocabularioDeCancelamento(dialogo);
      await act(async () => {
        soltar();
      });

      await waitFor(() => expect(atividades.cancelarApontamento).toHaveBeenCalledWith("at-1", "ap-2", { versao: 3, motivo: MOTIVO_EXCLUSAO_MAPA }));
      await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull());
      // O excluído some na hora: sem cartão, sem chip "Cancelado"; o outro registro continua.
      expect(buscarCartao("Gradeação")).toBeNull();
      expect(screen.queryByText("José Silva")).toBeNull();
      expect(screen.queryByText("Cancelado")).toBeNull();
      expect(document.querySelector(".is-cancelado")).toBeNull();
      expect(buscarCartao("Aplicação / Pulverização")).toBeTruthy();
      expect(avisos.success).toHaveBeenCalledWith("Registro excluído", "Gradeação de 17/11/2026 excluído deste histórico.");
      expect(mapa).toHaveBeenCalled();
      await waitFor(() => expect(atividades.registros.mock.calls.length).toBeGreaterThan(chamadasAntes));
      // A releitura (o mock ainda devolve o registro) não o traz de volta.
      expect(buscarCartao("Gradeação")).toBeNull();
      semVocabularioDeCancelamento(screen.getByTestId("area-registros"));
    } finally {
      window.removeEventListener("atualizar-mapa", mapa);
    }
  });

  it("registro que o servidor já mostra excluído: some do histórico, aviso \"Já excluído\", nenhum diálogo nem envio", async () => {
    atividades.obterApontamento.mockImplementation(async (_a, id) => ({ id, status: "CANCELADO", versao: 5 }));
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    await waitFor(() => expect(buscarCartao("Gradeação")).toBeNull());
    expect(screen.queryByText("Cancelado")).toBeNull();
    expect(avisos.info).toHaveBeenCalledWith("Já excluído", "Este registro já foi excluído. Nada foi alterado.");
    expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull();
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
  });

  it("registro que a listagem traz já excluído (status CANCELADO): não vira cartão nem chip", async () => {
    atividades.registros.mockImplementation(async () => ({ ...REGISTROS, items: REGISTROS.items.map((r) => (r.id === "ap-2" ? { ...r, status: "CANCELADO" } : r)) }));
    renderizar();
    fireEvent.click(screen.getByRole("tab", { name: "Manejos" }));
    await screen.findByText("Pedro Rocha");
    expect(buscarCartao("Gradeação")).toBeNull();
    expect(screen.queryByText("José Silva")).toBeNull();
    expect(screen.queryByText("Cancelado")).toBeNull();
    expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(1);
  });

  it("sem a permissão cancelar_apontamento: cartões como antes (sem pé de ações) e nenhuma leitura de atividade", async () => {
    atividades.acoes = { ...TODAS, cancelarApontamento: false };
    await abrirHistorico();
    expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(2);
    expect(document.querySelector(".mk-dp-tl__acoes")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Excluir registro/ })).toBeNull();
    expect(atividades.obterAtividade).not.toHaveBeenCalled();
  });

  it("sem conexão: o botão fica desligado com o aviso; nada é relido nem enviado (nada vai para fila offline)", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    await abrirHistorico();
    const card = within(cartao("Gradeação"));
    const botao = card.getByRole("button", { name: /^Excluir registro/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAccessibleDescription(/Sem conexão: a exclusão só é feita online/);
    expect(atividades.obterApontamento).not.toHaveBeenCalled();
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
  });

  it("a conexão cai com o cartão liberado: o botão desliga na hora e nada é lido nem enviado; volta, religa", async () => {
    await abrirHistorico();
    const botao = await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ });
    expect(botao).not.toBeDisabled();
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    const desligado = within(cartao("Gradeação")).getByRole("button", { name: /^Excluir registro/ });
    expect(desligado).toBeDisabled();
    expect(within(cartao("Gradeação")).getByText(/Sem conexão: a exclusão só é feita online/)).toBeTruthy();
    fireEvent.click(desligado);
    expect(atividades.obterApontamento).not.toHaveBeenCalled();
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull();

    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(within(cartao("Gradeação")).getByRole("button", { name: /^Excluir registro/ })).not.toBeDisabled();
  });

  it("caiu a conexão com o diálogo aberto: o envio é recusado na hora, sem chamar o servidor", async () => {
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    expect(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar")).not.toBeDisabled();
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar")).not.toBeDisabled());
    expect(atividades.cancelarApontamento).not.toHaveBeenCalled();
    // O erro dentro do diálogo diz que caiu a conexão (e fala em exclusão).
    expect(within(dialogo).getByTestId("erro-envio")).toHaveTextContent(/Sem conexão: a exclusão só é feita online/);
    semVocabularioDeCancelamento(dialogo);
    expect(screen.getByTestId("dialogo-cancelar-registro-area")).toBeTruthy();
  });

  it("fazenda sem fuso: desligado com o aviso do fuso (o servidor recusa sem ele)", async () => {
    atividades.fuso = { fuso: null, fusoOk: false, semFuso: true, hoje: "" };
    await abrirHistorico();
    const card = within(cartao("Gradeação"));
    expect(card.getByRole("button", { name: /^Excluir registro/ })).toBeDisabled();
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
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    const registrosAntes = atividades.registros.mock.calls.length;
    const atividadeAntes = atividades.obterAtividade.mock.calls.length;
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(atividades.cancelarApontamento).toHaveBeenCalledTimes(1));
    // O diálogo com a versao velha fecha (repetir daria a mesma recusa) e o aviso diz para abrir de novo.
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull());
    expect(avisos.warning).toHaveBeenCalledWith("O registro mudou", expect.stringMatching(/Nada foi excluído\. Abra a exclusão de novo para conferir\.$/));
    expect(avisos.warning.mock.calls.at(-1)?.[1]).not.toMatch(/cancel/i);
    expect(buscarCartao("Gradeação")).toBeTruthy();
    // A recusa pede releitura: o histórico da área e o status da atividade são relidos.
    await waitFor(() => expect(atividades.registros.mock.calls.length).toBeGreaterThan(registrosAntes));
    await waitFor(() => expect(atividades.obterAtividade.mock.calls.length).toBeGreaterThan(atividadeAntes));

    // Reabrir relê o apontamento e manda a versao nova.
    atividades.obterApontamento.mockImplementation(async (_a, id) => ({ id, status: "CONFIRMADO", versao: 7 }));
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const novo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(novo);
    fireEvent.click(within(novo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(atividades.cancelarApontamento).toHaveBeenLastCalledWith("at-1", "ap-2", { versao: 7, motivo: MOTIVO_EXCLUSAO_MAPA }));
    expect(tentativas).toBe(2);
    await waitFor(() => expect(buscarCartao("Gradeação")).toBeNull());
  });

  it("recusa de status (apontamento já excluído no servidor): o aviso fala em exclusão, nunca em cancelamento", async () => {
    atividades.cancelarApontamento.mockImplementation(async () => {
      throw Object.assign(new Error("status"), { status: 409, code: "ATIVIDADE_STATUS_INVALIDO", details: { entidade: "apontamento", status: "CANCELADO", acao: "cancelar" } });
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    // Já excluído: sai do histórico na hora (sem esperar a releitura), com um aviso só, sem mandar abrir a exclusão de novo.
    await waitFor(() => expect(avisos.info).toHaveBeenCalledWith("Já excluído", "Este registro já foi excluído. Nada foi alterado."));
    expect(buscarCartao("Gradeação")).toBeNull();
    expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull();
    expect(avisos.warning).not.toHaveBeenCalled();
    for (const [, texto] of avisos.info.mock.calls) {
      expect(String(texto)).not.toMatch(/cancel|estorn/i);
      expect(String(texto)).not.toMatch(/Abra a exclusão de novo/);
    }
    // A releitura (o mock ainda devolve o registro) não o traz de volta.
    await waitFor(() => expect(atividades.registros.mock.calls.length).toBeGreaterThan(1));
    expect(buscarCartao("Gradeação")).toBeNull();
  });

  it("recusa de status da atividade (ex.: ABERTA não aceita, status desconhecido): aviso de exclusão, sem \"cancel\" nem \"abra de novo\"; o cartão fica", async () => {
    atividades.cancelarApontamento.mockImplementation(async () => {
      throw Object.assign(new Error("status"), { status: 409, code: "ATIVIDADE_STATUS_INVALIDO", details: { entidade: "atividade", status: "ABERTA", acao: "cancelar" } });
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(avisos.warning).toHaveBeenCalledWith("Não foi possível excluir", "Este registro não pode ser excluído no status atual. Nada foi alterado."));
    expect(buscarCartao("Gradeação")).toBeTruthy();
    expect(screen.queryByTestId("dialogo-cancelar-registro-area")).toBeNull();
  });

  it("recusa ATIVIDADE_ESTORNO_BLOQUEADO (ApiError real, frase do catálogo com \"estorno\"): aviso e erro do diálogo dizem \"não pode ser excluído\"; o cartão fica", async () => {
    const recusa = new ApiError(API_ERROR_CODES.ATIVIDADE_ESTORNO_BLOQUEADO, { operation: "cancelar", resource: "AtividadeApontamento" });
    // Premissa do teste: a frase pública do catálogo fala em estorno (é ela que o mapa não pode mostrar).
    expect(recusa.message).toMatch(/estorno/i);
    atividades.cancelarApontamento.mockImplementation(async () => {
      throw recusa;
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    await waitFor(() => expect(avisos.warning).toHaveBeenCalled());
    const texto = String(avisos.warning.mock.calls.at(-1)?.[1] ?? "");
    expect(texto).toMatch(/não pode ser excluído porque o lote de onde o produto saiu/);
    expect(texto).not.toMatch(/cancel|estorn/i);
    // A recusa não pede releitura: o diálogo fica aberto e mostra o erro DENTRO dele, no vocabulário da exclusão.
    const erroEnvio = await within(dialogo).findByTestId("erro-envio");
    expect(erroEnvio).toHaveTextContent(/não pode ser excluído porque o lote de onde o produto saiu/);
    expect(erroEnvio.textContent ?? "").not.toMatch(/cancel|estorn/i);
    expect(erroEnvio.textContent ?? "").not.toContain(recusa.message);
    semVocabularioDeCancelamento(dialogo);
    expect(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar")).toHaveTextContent("Excluir registro");
    expect(buscarCartao("Gradeação")).toBeTruthy();
  });

  it("recusa genérica cuja frase do catálogo fala em cancelar (ApiError ATIVIDADE_DATA_COM_LINHAS): aviso e erro do diálogo sem \"cancel\"", async () => {
    const recusa = new ApiError(API_ERROR_CODES.ATIVIDADE_DATA_COM_LINHAS, { operation: "cancelar", resource: "AtividadeApontamento" });
    expect(recusa.message).toMatch(/cancel/i);
    atividades.cancelarApontamento.mockImplementation(async () => {
      throw recusa;
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    const erroEnvio = await within(dialogo).findByTestId("erro-envio");
    expect(erroEnvio).toHaveTextContent("Não foi possível excluir o registro. Nada foi alterado.");
    semVocabularioDeCancelamento(dialogo);
    expect(avisos.warning).toHaveBeenCalledWith("Atenção", "Não foi possível excluir o registro. Nada foi alterado.");
    expect(buscarCartao("Gradeação")).toBeTruthy();
  });

  it("recusa definitiva que não pede releitura: o diálogo continua aberto e mostra o erro do servidor", async () => {
    atividades.cancelarApontamento.mockImplementation(async () => {
      throw Object.assign(new Error("Sem permissão para cancelar."), { status: 403, code: "FORBIDDEN", details: {} });
    });
    await abrirHistorico();
    fireEvent.click(await within(cartao("Gradeação")).findByRole("button", { name: /^Excluir registro/ }));
    const dialogo = await screen.findByTestId("dialogo-cancelar-registro-area");
    semCampoDeMotivo(dialogo);
    fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-registro-area-enviar"));
    expect(await within(dialogo).findByTestId("erro-envio")).toBeTruthy();
    expect(screen.getByTestId("dialogo-cancelar-registro-area")).toBeTruthy();
    // A mensagem crua do servidor (fora do catálogo) traz "cancelar": dentro do diálogo ela vira a frase da exclusão.
    expect(within(dialogo).getByTestId("erro-envio")).toHaveTextContent("Não foi possível excluir o registro. Nada foi alterado.");
    expect(within(dialogo).getByTestId("erro-envio").textContent).not.toContain("Sem permissão para cancelar");
    semVocabularioDeCancelamento(dialogo);
    expect(String(avisos.warning.mock.calls.at(-1)?.[1] ?? "")).not.toMatch(/cancel|estorn/i);
    expect(buscarCartao("Gradeação")).toBeTruthy();
  });
});

describe("mensagemDeErroDaExclusao — toda recusa no vocabulário da exclusão", () => {
  const erro = (code, details = {}) => Object.assign(new Error(code), { status: 409, code, details });
  const FALLBACK = "Não foi possível excluir o registro. Nada foi alterado.";

  it.each([
    ["apontamento CANCELADO", erro("ATIVIDADE_STATUS_INVALIDO", { entidade: "apontamento", status: "CANCELADO" }), /já foi excluído/],
    ["atividade CONCLUIDA", erro("ATIVIDADE_STATUS_INVALIDO", { entidade: "atividade", status: "CONCLUIDA", acao: "cancelar" }), /para excluir este registro, reabra/],
    ["atividade CANCELADA", erro("ATIVIDADE_STATUS_INVALIDO", { entidade: "atividade", status: "CANCELADA" }), /não pode ser excluído porque a atividade/],
    ["atividade sem status", erro("ATIVIDADE_STATUS_INVALIDO", {}), /não pode ser excluído porque a atividade não está aberta/],
    ["atividade ABERTA", erro("ATIVIDADE_STATUS_INVALIDO", { status: "ABERTA", acao: "cancelar" }), /não pode ser excluído no status atual/],
    ["área com status desconhecido", erro("ATIVIDADE_STATUS_INVALIDO", { entidade: "area", status: "EM_PAUSA" }), /não pode ser excluído no status atual/],
    ["área CONCLUIDA (frase comum, sem cancelar)", erro("ATIVIDADE_STATUS_INVALIDO", { entidade: "area", status: "CONCLUIDA" }), /Esta área já está concluída/],
    ["estorno bloqueado", erro("ATIVIDADE_ESTORNO_BLOQUEADO"), /não pode ser excluído porque o lote/],
  ])("%s", (_nome, e, esperado) => {
    const texto = mensagemDeErroDaExclusao(e, FALLBACK);
    expect(texto).toMatch(esperado);
    expect(texto).not.toMatch(/cancel|estorn/i);
  });

  it("a recusa dentro do diálogo (ApiError real do catálogo) nunca fala em cancelamento/estorno; sem conexão diz isso", () => {
    for (const code of Object.values(API_ERROR_CODES)) {
      const texto = mensagemDoErroNoDialogo(new ApiError(code, { resource: "AtividadeApontamento" }));
      expect(texto, code).not.toMatch(/cancel|estorn/i);
      expect(texto.trim(), code).not.toBe("");
    }
    expect(mensagemDoErroNoDialogo(Object.assign(new Error("x"), { code: "SEM_CONEXAO" }))).toMatch(/^Sem conexão: a exclusão só é feita online/);
  });

  it("textoSemCancelamento: troca pelo fallback só o texto que fala em cancelar/estorno", () => {
    expect(textoSemCancelamento("Tente de novo.", "F")).toBe("Tente de novo.");
    expect(textoSemCancelamento("O estorno exato não é seguro.", "F")).toBe("F");
    expect(textoSemCancelamento("Cancele o apontamento.", "F")).toBe("F");
  });

  it("o fallback que falasse em cancelamento também vira exclusão", () => {
    const texto = mensagemDeErroDaExclusao(erro("ATIVIDADE_STATUS_INVALIDO", { status: "ABERTA" }), "Não foi possível cancelar.");
    expect(texto).not.toMatch(/cancel|estorn/i);
  });
});
