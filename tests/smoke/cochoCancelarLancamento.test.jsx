/**
 * D-PROD-268 — "Excluir lançamento" do cocho na tela (por baixo, o mesmo comando seguro de
 * cancelamento com estorno do servidor; na tela o usuário só vê EXCLUSÃO).
 *
 * C1. quem vê: só admin real, `is_admin` ou a chave `cancelar_lancamentos_estoque` (sem a chave,
 *     nem botão nem consulta);
 * C2. a elegibilidade (ensaio no servidor) vem ANTES de habilitar; recusa mostra a frase do
 *     `reason`; efeitos do ensaio no diálogo; sem campo de motivo (D-PROD-270: a tela envia o
 *     texto fixo `MOTIVO_EXCLUSAO_MAPA`; a pendência antiga reenvia o motivo guardado);
 * C3. a `operation_id` nasce ao abrir e é REUSADA no "tentar de novo" (resultado desconhecido),
 *     guardada no aparelho; recusa definitiva troca a chave;
 * C4. só online: offline não consulta nem envia;
 * C5. histórico do cocho: a ação só no lançamento mais recente, sem o aviso de suspenso;
 * C6. histórico do pasto: o cartão de suplementação mais recente de cada cocho ganha a ação; o
 *     lançamento sem cocho (legado) nunca ganha (nem consulta o servidor);
 * C7. 403 da guarda no ensaio: frase de permissão (sem "Verificar de novo") e a permissão efetiva relida.
 * C8. só exclusão na tela: botão, diálogo, efeitos, toast e recusas falam "excluir" (nada de
 *     "cancelar", "cancelado", "cancelamento" ou "estorno"); o "Voltar" só fecha.
 * Serviço mockado; a prova de banco está em backend/tests/suplementacaoCancelamentoCocho.test.mjs.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  consultarElegibilidadeCancelamentoCocho: vi.fn(),
  cancelarLancamentoCocho: vi.fn(),
  cancelarLancamentoCochoSemInternet: vi.fn(async () => ({ estado: 'aguardando', operationId: 'op-x' })),
}));
const sessao = vi.hoisted(() => ({ usuario: null, permissao: null }));
const cache = vi.hoisted(() => ({ dados: {}, refresh: vi.fn(async () => []), update: vi.fn(async () => []) }));
const invalidar = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/services/suplementacaoCancelamentoService", () => servico);
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => sessao.usuario,
  ehAdministrador: (u) => u?.administrador_fazenda === true,
  carregarPermissaoEfetiva: async () => sessao.permissao,
}));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async (chave) => cache.dados[chave] || [],
  refreshMapaCacheEntry: (...a) => cache.refresh(...a),
  updateMapaCachedData: (...a) => cache.update(...a),
}));
vi.mock("@/components/mapa/invalidarCachesMapa", () => ({ invalidarCachesDoMapa: invalidar, aposEscritaNoRebanho: vi.fn(async () => {}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const { default: CancelarLancamentoCocho, MENSAGENS_REASON, MENSAGENS_CODIGO, mensagemDoCancelamento, descreverEfeitos } = await import("@/components/suplementacao/CancelarLancamentoCocho");
const { default: HistoricoSuplementacaoPonto } = await import("@/components/suplementacao/HistoricoSuplementacaoPonto");
const { comAcaoDeCancelarCocho } = await import("@/components/mapa/detalhes-lote/AbaHistorico");
const { cartaoDaSuplementacao, eventoDoPasto, agruparPorDia } = await import("@/components/mapa/detalhes-lote/historicoDoPasto");
const { CANCELAMENTO_COCHO_HABILITADO, CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO } = await import("@/domain/estornos/politicaEstorno");
const { MOTIVO_EXCLUSAO_MAPA } = await import("@/domain/mapa/motivoExclusaoMapa");
const { toast } = await import("sonner");
/** Linguagem que não pode aparecer na tela destas ações (o usuário só tem exclusão). */
const LINGUAGEM_DE_CANCELAMENTO = /cancel|estorn/i;

const EMP = "emp-1";
const EVENTO = { id: "ev-2", empresa_id: EMP, ponto_suplementacao_id: "cocho-1", ponto_nome: "COCHO 1", produto: "SAL MINERAL", data_lancamento: "2026-10-31", created_date: "2026-10-31T10:00:00.000Z", area_id: "area-A" };
const ELEGIVEL = {
  elegivel: true, pode_cancelar_permissao: true, codigo: null, reason: null,
  efeitos: { estorno: { quantidade: "20.0000", valor_total: "40", local_nome: "Galpão", produto_nome: "Sal mineral" }, periodo_reaberto: { evento_id: "ev-1", data_lancamento: "2026-10-30", sobra_inicial_restaurada_kg: 10 }, lotes_a_cancelar: 2 },
};
const OPERADOR = { id: "u-2", cliente_id: "c-1", login: "vaqueiro", administrador_fazenda: false };
const permissao = (mapa, { isAdmin = false } = {}) => ({
  user_email: "vaqueiro", is_admin: isAdmin, modulos_permitidos: ["mapa"],
  permissoes_telas: [{ modulo_id: "mapa", tela_id: "pec-mapa-geral", visualizar: true }], mapa_geral_permissoes: mapa,
});
const erroDoServidor = (code, reason) => Object.assign(new Error(code), { cause: { code, reason } });

const assentar = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const renderizar = async (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  await assentar();
  return { ...utils, client };
};
const botaoCancelar = () => screen.getByRole("button", { name: /Excluir lançamento/i });
/** D-PROD-270: o diálogo não tem campo nem ajuda de motivo. */
const semCampoDeMotivo = (dialogo) => {
  expect(within(dialogo).queryByLabelText(/Motivo/i)).toBeNull();
  expect(within(dialogo).queryByRole("textbox")).toBeNull();
  expect(dialogo.textContent).not.toMatch(/motivo/i);
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("empresa_selecionada_id", EMP);
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  servico.consultarElegibilidadeCancelamentoCocho.mockReset();
  servico.consultarElegibilidadeCancelamentoCocho.mockImplementation(async () => ELEGIVEL);
  servico.cancelarLancamentoCocho.mockReset();
  servico.cancelarLancamentoCocho.mockImplementation(async () => ({ committed: true, replay: false }));
  sessao.usuario = OPERADOR;
  sessao.permissao = permissao({ cancelar_lancamentos_estoque: true });
  cache.refresh.mockClear();
  cache.update.mockClear();
  invalidar.mockClear();
  cache.dados = {};
});
afterEach(async () => {
  await assentar();
  cleanup();
});

describe("D-PROD-268 — política", () => {
  it("o cocho fica habilitado; a transferência de depósito não é desta frente", () => {
    expect(CANCELAMENTO_COCHO_HABILITADO).toBe(true);
    expect(typeof CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO).toBe("boolean");
  });
});

describe("C1 — quem vê", () => {
  it("operador sem a chave: nada aparece e o servidor não é consultado", async () => {
    sessao.permissao = permissao({ lancar_suplementacao: true });
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(screen.queryByRole("button", { name: /Excluir lançamento/i })).toBeNull();
    expect(servico.consultarElegibilidadeCancelamentoCocho).not.toHaveBeenCalled();
  });

  it("chave ligada, is_admin ou administrador real: aparece", async () => {
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(botaoCancelar()).toBeTruthy();
    cleanup();
    sessao.permissao = permissao({}, { isAdmin: true });
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(botaoCancelar()).toBeTruthy();
    cleanup();
    sessao.usuario = { ...OPERADOR, administrador_fazenda: true };
    sessao.permissao = null;
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(botaoCancelar()).toBeTruthy();
  });

  it("evento já cancelado (cópia antiga) não mostra a ação", async () => {
    await renderizar(<CancelarLancamentoCocho evento={{ ...EVENTO, situacao: "cancelado" }} />);
    expect(screen.queryByRole("button", { name: /Excluir lançamento/i })).toBeNull();
  });
});

describe("C2 — elegibilidade antes de habilitar, efeitos e motivo fixo", () => {
  it("recusa do ensaio: botão desabilitado com a frase do reason", async () => {
    servico.consultarElegibilidadeCancelamentoCocho.mockImplementation(async () => ({ elegivel: false, codigo: "SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO", reason: "movimento_posterior_no_deposito", efeitos: {} }));
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(botaoCancelar().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(MENSAGENS_REASON.movimento_posterior_no_deposito)).toBeTruthy();
  });

  it("todas as razões do desenho têm frase em português; código sem reason cai no catálogo", () => {
    for (const r of ["lancamento_posterior", "periodo_fechado", "gado_movimentado", "sem_recibo", "rateio_divergente", "saida_nao_comprovada", "saida_sem_fatias", "movimento_posterior_no_deposito",
      "periodo_anterior_nao_comprovado", "periodo_anterior_alterado", "lote_periodo_anterior_nao_comprovado", "movimento_estornado", "lote_indisponivel_para_devolucao", "devolucao_excede_entrada",
      "fatias_inconsistentes", "vinculo_divergente", "camada_divergente", "estoque_excede_limite"]) {
      expect(mensagemDoCancelamento("SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO", r)).toBe(MENSAGENS_REASON[r]);
    }
    expect(mensagemDoCancelamento("CANCELAMENTO_JA_REALIZADO", null)).toBe("Este lançamento já foi excluído.");
    expect(mensagemDoCancelamento("XYZ", null)).toMatch(/Nada foi alterado/);
  });

  it("elegível: o diálogo mostra os efeitos do servidor, não pede motivo e envia o motivo fixo", async () => {
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    fireEvent.click(botaoCancelar());
    await assentar();
    const dialogo = screen.getByRole("dialog");
    const efeitos = descreverEfeitos(ELEGIVEL.efeitos);
    const itens = within(dialogo).getByRole("list", { name: "O que a exclusão faz" });
    expect(within(itens).getAllByRole("listitem").map((li) => li.textContent)).toEqual(efeitos);
    expect(efeitos[0]).toMatch(/Devolve 20 kg de Sal mineral ao Galpão/);
    expect(efeitos[1]).toMatch(/Reabre o período de 30\/10\/2026 com sobra inicial de 10 kg/);
    semCampoDeMotivo(dialogo);
    // Elegível e online: habilita sem digitar nada.
    const enviar = within(dialogo).getByRole("button", { name: "Excluir lançamento" });
    expect(enviar.hasAttribute("disabled")).toBe(false);
    fireEvent.click(enviar);
    await assentar();
    expect(servico.cancelarLancamentoCocho).toHaveBeenCalledTimes(1);
    const [arg] = servico.cancelarLancamentoCocho.mock.calls[0];
    expect(arg.motivo).toBe(MOTIVO_EXCLUSAO_MAPA);
    expect(arg.evento.id).toBe("ev-2");
    expect(arg.operationId).toMatch(/^cancelar-cocho-/);
    // Recarga do mapa e dos caches de suplementação/estoque.
    expect(cache.refresh.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["eventosSuplementacao", "suplementacaoLote", "movimentacaoEstoque", "estoqueLotes"]));
    expect(invalidar).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Excluir lançamento/i })).toBeNull();
  });
});

describe("C3 — operation_id persistida", () => {
  it("resultado desconhecido: 'Tentar de novo' reenvia a MESMA chave, guardada no aparelho; recusa definitiva troca a chave", async () => {
    servico.cancelarLancamentoCocho.mockImplementationOnce(async () => { throw new Error("rede caiu"); });
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    fireEvent.click(botaoCancelar());
    await assentar();
    const dialogo = screen.getByRole("dialog");
    semCampoDeMotivo(dialogo);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir lançamento" }));
    await assentar();
    const chave1 = servico.cancelarLancamentoCocho.mock.calls[0][0].operationId;
    expect(servico.cancelarLancamentoCocho.mock.calls[0][0].motivo).toBe(MOTIVO_EXCLUSAO_MAPA);
    // A pendência nova grava o motivo fixo (mesmo fingerprint no reenvio).
    const guardada = JSON.parse(localStorage.getItem(`maike_cancelamento_cocho_pendente:c-1:u-2:ev-2`));
    expect(guardada).toMatchObject({ operation_id: chave1, motivo: MOTIVO_EXCLUSAO_MAPA });
    expect(within(dialogo).getByText(/Sem confirmação do servidor/)).toBeTruthy();

    servico.cancelarLancamentoCocho.mockImplementationOnce(async () => { throw erroDoServidor("SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO", "lancamento_posterior"); });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Tentar de novo" }));
    await assentar();
    expect(servico.cancelarLancamentoCocho.mock.calls[1][0]).toMatchObject({ operationId: chave1, motivo: MOTIVO_EXCLUSAO_MAPA });
    expect(within(dialogo).getByText(MENSAGENS_REASON.lancamento_posterior)).toBeTruthy();
    expect(localStorage.getItem(`maike_cancelamento_cocho_pendente:c-1:u-2:ev-2`)).toBeNull();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir lançamento" }));
    await assentar();
    expect(servico.cancelarLancamentoCocho.mock.calls[2][0].operationId).not.toBe(chave1);
    expect(servico.cancelarLancamentoCocho.mock.calls[2][0].motivo).toBe(MOTIVO_EXCLUSAO_MAPA);
  });

  it("reabrir com pendência guardada reusa a chave e o motivo GUARDADO (não o fixo)", async () => {
    localStorage.setItem(`maike_cancelamento_cocho_pendente:c-1:u-2:ev-2`, JSON.stringify({ operation_id: "cancelar-cocho-antiga", motivo: "motivo antigo" }));
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    fireEvent.click(botaoCancelar());
    await assentar();
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Tentar de novo" }));
    await assentar();
    expect(servico.cancelarLancamentoCocho.mock.calls[0][0]).toMatchObject({ operationId: "cancelar-cocho-antiga", motivo: "motivo antigo" });
    expect(servico.cancelarLancamentoCocho.mock.calls[0][0].motivo).not.toBe(MOTIVO_EXCLUSAO_MAPA);
  });
});

describe("C4 — sem internet (D-PROD-297)", () => {
  it("offline: não consulta o servidor; confirma e guarda a exclusão para subir depois (motivo fixo)", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    const confirmarOriginal = window.confirm;
    window.confirm = () => true;
    try {
      await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
      expect(botaoCancelar().hasAttribute("disabled")).toBe(false);
      expect(screen.getByText(/Sem internet: a exclusão fica no celular/)).toBeTruthy();
      await act(async () => { fireEvent.click(botaoCancelar()); });
      await waitFor(() => expect(servico.cancelarLancamentoCochoSemInternet).toHaveBeenCalledTimes(1));
      expect(servico.cancelarLancamentoCochoSemInternet.mock.calls[0][0]).toMatchObject({ evento: EVENTO, motivo: MOTIVO_EXCLUSAO_MAPA, operationId: expect.any(String) });
      expect(servico.consultarElegibilidadeCancelamentoCocho).not.toHaveBeenCalled();
      expect(servico.cancelarLancamentoCocho).not.toHaveBeenCalled();
    } finally {
      window.confirm = confirmarOriginal;
    }
  });
});

describe("C5 — histórico do cocho", () => {
  it("a ação só no lançamento mais recente; sem o aviso de cancelamento suspenso; o excluído some", async () => {
    cache.dados = {
      eventosSuplementacao: [
        // Cópia antiga do aparelho com um lançamento já excluído (situacao "cancelado"): não aparece.
        { ...EVENTO, id: "ev-3", data_lancamento: "2026-11-01", created_date: "2026-11-01T10:00:00.000Z", produto: "PROTEINADO EXCLUIDO", situacao: "cancelado" },
        EVENTO,
        { id: "ev-1", empresa_id: EMP, ponto_suplementacao_id: "cocho-1", produto: "SAL MINERAL", data_lancamento: "2026-10-30", created_date: "2026-10-30T10:00:00.000Z", area_id: "area-A", dias_periodo: 1 },
      ],
      movimentacoes: [],
    };
    await renderizar(<HistoricoSuplementacaoPonto pontoId="cocho-1" pontoNome="COCHO 1" ponto={{ id: "cocho-1" }} />);
    expect(await screen.findByText("Histórico do Cocho (2)")).toBeTruthy();
    expect(screen.queryByText("PROTEINADO EXCLUIDO")).toBeNull();
    expect(screen.queryByText(/Cancelado|Estornado/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /Excluir lançamento/i })).toHaveLength(1);
    expect(screen.queryByRole("note")).toBeNull();
    expect(servico.consultarElegibilidadeCancelamentoCocho).toHaveBeenCalledTimes(1);
    expect(servico.consultarElegibilidadeCancelamentoCocho.mock.calls[0][0].evento.id).toBe("ev-2");
  });
});

describe("C6 — histórico do pasto", () => {
  it("o cartão de suplementação mais recente de cada cocho ganha a ação; cancelado some", () => {
    const eventos = [
      { ...EVENTO, id: "a2", ponto_suplementacao_id: "c1", data_lancamento: "2026-10-31" },
      { ...EVENTO, id: "a1", ponto_suplementacao_id: "c1", data_lancamento: "2026-10-20" },
      { ...EVENTO, id: "b1", ponto_suplementacao_id: "c2", data_lancamento: "2026-10-25" },
      { ...EVENTO, id: "x", ponto_suplementacao_id: "c1", data_lancamento: "2026-11-01", situacao: "cancelado" },
      { ...EVENTO, id: "leg1", ponto_suplementacao_id: null, data_lancamento: "2026-10-28" },
      { ...EVENTO, id: "leg2", ponto_suplementacao_id: undefined, data_lancamento: "2026-10-27" },
    ];
    const visiveis = eventos.filter((e) => eventoDoPasto(e, "area-A", EMP));
    expect(visiveis.map((e) => e.id)).toEqual(["a2", "a1", "b1", "leg1", "leg2"]);
    const cartoes = visiveis.map(cartaoDaSuplementacao).sort((a, b) => String(b.ordem.oc).localeCompare(String(a.ordem.oc)));
    const dias = comAcaoDeCancelarCocho(agruparPorDia(cartoes));
    const comAcao = dias.flatMap((d) => d.cartoes).filter((c) => c.acoes).map((c) => c.evento.id).sort();
    expect(comAcao).toEqual(["a2", "b1"]);
  });
});

describe("C7 — 403 da guarda no ensaio da elegibilidade", () => {
  it("mostra a frase de permissão, sem 'Verificar de novo', e relê a permissão efetiva", async () => {
    servico.consultarElegibilidadeCancelamentoCocho.mockImplementation(async () => { throw erroDoServidor("ACAO_NAO_PERMITIDA"); });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const espiao = vi.spyOn(client, "invalidateQueries");
    render(<QueryClientProvider client={client}><CancelarLancamentoCocho evento={EVENTO} /></QueryClientProvider>);
    await assentar();
    expect(screen.getByText(MENSAGENS_CODIGO.ACAO_NAO_PERMITIDA)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Verificar de novo/i })).toBeNull();
    expect(screen.queryByText(/Não foi possível verificar no servidor/)).toBeNull();
    expect(espiao.mock.calls.some(([f]) => Array.isArray(f?.queryKey) && f.queryKey[0] === "permissao-efetiva")).toBe(true);
  });

  it("falha de rede no ensaio continua com 'Verificar de novo' (não é permissão)", async () => {
    servico.consultarElegibilidadeCancelamentoCocho.mockImplementation(async () => { throw new Error("Failed to fetch"); });
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(screen.getByRole("button", { name: /Verificar de novo/i })).toBeTruthy();
  });
});

describe("C8 — na tela só há exclusão", () => {
  it("botão, diálogo, efeitos, confirmação e toast falam em excluir (sem campo de motivo); 'Voltar' só fecha", async () => {
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(botaoCancelar().textContent).toBe("Excluir lançamento");
    fireEvent.click(botaoCancelar());
    await assentar();
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Excluir lançamento do cocho" })).toBeTruthy();
    expect(dialogo.textContent).not.toMatch(LINGUAGEM_DE_CANCELAMENTO);
    expect(dialogo.textContent).toMatch(/o estoque volta ao depósito/);
    semCampoDeMotivo(dialogo);
    for (const b of within(dialogo).getAllByRole("button")) expect(b.textContent).not.toMatch(LINGUAGEM_DE_CANCELAMENTO);
    expect(within(dialogo).getByRole("button", { name: "Voltar" })).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir lançamento" }));
    await assentar();
    expect(toast.success).toHaveBeenLastCalledWith("Lançamento excluído.");
  });

  it("recusas, efeitos e avisos sem 'cancelar' nem 'estorno'", () => {
    for (const frase of [...Object.values(MENSAGENS_REASON), ...Object.values(MENSAGENS_CODIGO)]) expect(frase).not.toMatch(LINGUAGEM_DE_CANCELAMENTO);
    expect(mensagemDoCancelamento("SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO", "desconhecida")).toBe("O lançamento não pode ser excluído com segurança agora. Nada foi alterado.");
    expect(mensagemDoCancelamento("XYZ", null)).toBe("Não foi possível excluir. Nada foi alterado.");
    expect(MENSAGENS_REASON.sem_recibo).toMatch(/não pode ser excluído/);
    expect(MENSAGENS_REASON.lancamento_posterior).toMatch(/Exclua primeiro o mais recente/);
    expect(MENSAGENS_CODIGO.ACAO_NAO_PERMITIDA).toBe("Você não tem permissão para excluir lançamentos.");
    for (const linha of descreverEfeitos(ELEGIVEL.efeitos)) expect(linha).not.toMatch(LINGUAGEM_DE_CANCELAMENTO);
    expect(descreverEfeitos(ELEGIVEL.efeitos).at(-1)).toBe("Tira o lançamento do rateio de 2 lotes.");
  });

  it("recusa do ensaio e pendência sem confirmação também falam em exclusão", async () => {
    localStorage.setItem(`maike_cancelamento_cocho_pendente:c-1:u-2:ev-2`, JSON.stringify({ operation_id: "cancelar-cocho-antiga", motivo: "motivo antigo" }));
    await renderizar(<CancelarLancamentoCocho evento={EVENTO} />);
    expect(screen.getByText("Exclusão anterior sem confirmação do servidor: abra para reenviar a mesma operação.")).toBeTruthy();
    fireEvent.click(botaoCancelar());
    await assentar();
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText(/A exclusão pode ou não ter sido concluída/)).toBeTruthy();
    expect(dialogo.textContent).not.toMatch(LINGUAGEM_DE_CANCELAMENTO);
  });
});
