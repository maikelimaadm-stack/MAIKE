/**
 * D-PROD-266 (etapa 1) — a aba Histórico do pasto com o `ExcluirMovimentacao`
 * REAL, dentro da casca real (`PainelPasto`), num pasto VAZIO (sem lote: o
 * caso típico de quem quer desfazer uma saída ou transferência).
 *
 * Prova: a aba Histórico abre com o pasto vazio (a pílula Manejos fica
 * desabilitada, mas a ação está na própria aba); a elegibilidade é consultada
 * uma vez por MOVIMENTO (nunca por cartão) e no máximo 2 em voo; a exclusão
 * mostra os efeitos do servidor (todas as posições do movimento), envia o
 * comando do servidor e a aba relê o histórico sem o movimento.
 * Rede, sessão e cache trocados por dublês. Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  buscarLoteDoHistorico: vi.fn(async () => null),
  consultarExclusaoMovimentacao: vi.fn(),
  excluirMovimentacaoMapa: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(async () => {}),
  pendenciasOfflineDaMovimentacao: vi.fn(async () => []),
  eventoMudancaFilaOffline: vi.fn(() => "fila-offline-mudou-teste"),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async () => []),
  getMapaCacheSnapshot: vi.fn(async () => ({ items: [], atualizadoEm: null })),
  refreshMapaCacheEntry: vi.fn(async () => []),
  refreshMapaCacheEntryDetalhado: vi.fn(async () => ({ origem: "rede", items: [] })),
  updateMapaCachedData: vi.fn(async () => {}),
}));
const sessao = vi.hoisted(() => ({
  usuario: /** @type {any} */ ({ id: "u-1", cliente_id: "c-1", login: "adm@teste.local", administrador_fazenda: true }),
  /** Permissão efetiva do Mapa Geral devolvida pela sessão (formato real). */
  permissao: /** @type {any} */ (null),
}));
vi.mock("@/services/loteManejoService", async (original) => ({ ...(await original()), ...servico }));
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", async (original) => ({
  ...(await original()),
  getCurrentUser: async () => sessao.usuario,
  carregarPermissaoEfetiva: async () => sessao.permissao,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const { default: PainelPasto } = await import("@/components/mapa/detalhes-lote/PainelPasto");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");

const EMP = "emp-1";
const AREA = { id: "a-p07", empresa_id: EMP, nome: "Pasto 07", tamanho_hectares: 109.3, ativo: true };
const doLedger = (id, dia, reg) => ({
  empresa_id: EMP,
  efeito_servidor: { comando: "rebanho_ledger", evento_id: `ev-${id}`, operation_id: `op-${id}`, registrado_em: reg },
  created_date: reg,
  data_movimentacao: `${dia}T12:00:00.000Z`,
  historico_ocorrencia: dia,
  historico_registrado_em: reg,
});
const transferencia = (id, dia, de, para, lote, cab) => ({
  id,
  tipo: "Transferência de Área",
  lote,
  quantidade_animais: cab,
  area_origem_id: de.id,
  area_origem_nome: de.nome,
  area_destino_id: para.id,
  area_destino_nome: para.nome,
  linhas: [{ quantidade: cab, area_origem_id: de.id, area_origem_nome: de.nome, nome: lote }],
  ...doLedger(id, dia, `${dia}T10:00:00.000Z`),
});
const P07 = { id: AREA.id, nome: "Pasto 07" };
const P04 = { id: "a-p04", nome: "Pasto 04" };
const P08 = { id: "a-p08", nome: "Pasto 08" };
const SAIDA = transferencia("mv-saida", "2026-11-10", P07, P08, "L-2026-004", 72);
/** Um movimento, dois cartões. */
const PESAGEM = {
  id: "mv-pesagem",
  tipo: "Pesagem",
  lote: "L-2026-008",
  quantidade_animais: 0,
  area_origem_id: AREA.id,
  linhas: [
    { lote_id: "p8", lote_nome: "L-2026-008", quantidade_cabecas: 38, peso_anterior_kg: 440, peso_novo_kg: 449.5 },
    { lote_id: "p14", lote_nome: "L-2026-014", quantidade_cabecas: 86, peso_anterior_kg: 370, peso_novo_kg: 382.5 },
  ],
  ...doLedger("pesagem", "2026-11-03", "2026-11-03T18:00:00.000Z"),
};
const ENTRADA = transferencia("mv-entrada", "2026-10-20", P04, P07, "L-2026-004", 72);

const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2" });
const ELEGIVEL_PESAGEM = {
  elegivel: true,
  pode_excluir: true,
  codigo: null,
  efeitos: [
    { posicao_id: "p8", nome: "L-2026-008", area_nome: "Pasto 07", delta_desfeito: 0, peso_revertido: true, peso_depois_kg: 440 },
    { posicao_id: "p14", nome: "L-2026-014", area_nome: "Pasto 07", delta_desfeito: 0, peso_revertido: true, peso_depois_kg: 370 },
  ],
};

/** Operador (não administrador) com a tela do Mapa Geral e as chaves do mapa dadas. */
const OPERADOR = { id: "u-3", cliente_id: "c-1", login: "vaqueiro@teste.local", administrador_fazenda: false };
const permissaoDoOperador = (mapa, { isAdmin = false } = {}) => ({
  user_email: OPERADOR.login,
  is_admin: isAdmin,
  modulos_permitidos: ["mapa"],
  permissoes_telas: [{ modulo_id: "mapa", tela_id: "pec-mapa-geral", visualizar: true }],
  mapa_geral_permissoes: mapa,
});
const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

const TODAS = { mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true };
const montar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const modelo = montarModeloDetalhes({ area: AREA, lotes: [], lotesDaArea: [], hoje: new Date("2026-11-15T12:00:00") });
  const dados = { areaId: AREA.id, areaNome: AREA.nome, setorNome: "Retiro", lotesDoPasto: [], empresaId: EMP, suplementacao: { pontos: [], eventos: [], hoje: "2026-11-15" } };
  return render(
    <QueryClientProvider client={client}>
      <PainelPasto modelo={modelo} permissoes={TODAS} dados={dados} abaInicial="historico" manejos={<div />} />
    </QueryClientProvider>,
  );
};

let original;
beforeEach(() => {
  original = window.matchMedia;
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  sessao.usuario = { id: "u-1", cliente_id: "c-1", login: "adm@teste.local", administrador_fazenda: true };
  sessao.permissao = null;
  for (const f of Object.values(servico)) f.mockClear();
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([SAIDA, PESAGEM, ENTRADA]));
  servico.consultarExclusaoMovimentacao.mockImplementation(async (id) => (id === PESAGEM.id ? ELEGIVEL_PESAGEM : { elegivel: true, pode_excluir: true, efeitos: [] }));
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

describe("pasto vazio: a aba Histórico continua acessível e traz a ação", () => {
  it("aba Histórico ativa sem lote; Manejos desabilitada; um botão por movimento (3 movimentos, 4 cartões)", async () => {
    montar();
    expect(screen.getByRole("tab", { name: "Histórico" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Manejos" }).hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(4));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Excluir movimentação" }).length).toBe(3));
    // Os 2 cartões da pesagem: só o primeiro tem o pé, com o aviso do alcance.
    const pesagens = [...document.querySelectorAll(".mk-dp-tl__card")].filter((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent === "Pesagem");
    expect(pesagens.length).toBe(2);
    expect(within(/** @type {HTMLElement} */ (pesagens[0])).getByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
    expect(pesagens[0].querySelector(".mk-dp-hist__alcance")?.textContent).toMatch(/os 2 cartões deste registro saem juntos/);
    expect(pesagens[1].querySelector(".mk-dp-tl__acoes")).toBeNull();
  });
});

describe("elegibilidade: uma consulta por movimento, no máximo 2 em voo", () => {
  it("3 movimentos (4 cartões) → 3 GETs, nunca mais de 2 ao mesmo tempo", async () => {
    let emVoo = 0;
    let pico = 0;
    /** @type {Array<() => void>} */
    const pendentes = [];
    servico.consultarExclusaoMovimentacao.mockImplementation(
      () =>
        new Promise((resolve) => {
          emVoo += 1;
          pico = Math.max(pico, emVoo);
          pendentes.push(() => {
            emVoo -= 1;
            resolve({ elegivel: true, pode_excluir: true, efeitos: [] });
          });
        }),
    );
    montar();
    await waitFor(() => expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(2);
    while (pendentes.length) {
      await act(async () => {
        pendentes.shift()?.();
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    await waitFor(() => expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(3));
    await act(async () => {
      while (pendentes.length) pendentes.shift()?.();
    });
    expect(pico).toBeLessThanOrEqual(2);
    expect(servico.consultarExclusaoMovimentacao.mock.calls.map((c) => c[0]).sort()).toEqual(["mv-entrada", "mv-pesagem", "mv-saida"]);
  });

  it("sem permissão (operador comum): nenhum botão, nenhum aviso, nenhuma consulta", async () => {
    sessao.usuario = { id: "u-2", cliente_id: "c-1", login: "op@teste.local", administrador_fazenda: false };
    montar();
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(4));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
    expect(document.querySelectorAll(".mk-dp-hist__alcance").length).toBe(0);
    expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
  });
});

describe("D-PROD-266 (1): operador com a permissão nova do mapa, na aba Histórico", () => {
  it("`excluir_movimentacoes_lote === true`: vê o botão nos 3 movimentos e a elegibilidade é consultada 3 vezes", async () => {
    sessao.usuario = OPERADOR;
    sessao.permissao = permissaoDoOperador({ historico: true, excluir_movimentacoes_lote: true });
    montar();
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(4));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Excluir movimentação" }).length).toBe(3));
    await waitFor(() => expect(servico.consultarExclusaoMovimentacao).toHaveBeenCalledTimes(3));
    // O aviso só cita outro pasto quando o registro envolve outro pasto.
    const avisos = [...document.querySelectorAll(".mk-dp-hist__alcance")].map((n) => n.textContent);
    expect(avisos).toContain("Exclui o registro inteiro, com todos os lotes dele, não só este cartão. Desfaz também o que ele mudou no outro pasto do registro.");
    expect(avisos).toContain("Exclui o registro inteiro: os 2 cartões deste registro saem juntos, com todos os lotes dele.");
  });

  it("`is_admin` na concessão: vê o botão mesmo sem a chave do mapa", async () => {
    sessao.usuario = OPERADOR;
    sessao.permissao = permissaoDoOperador({ historico: true }, { isAdmin: true });
    montar();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Excluir movimentação" }).length).toBe(3));
  });

  it.each([["'true' (texto)", "true"], ["1", 1], ["false", false], ["ausente", undefined]])(
    "chave com valor %s (gravadora: só `=== true` liga): nenhum botão, nenhuma consulta",
    async (_rotulo, valor) => {
      sessao.usuario = OPERADOR;
      sessao.permissao = permissaoDoOperador({ historico: true, ...(valor === undefined ? {} : { excluir_movimentacoes_lote: valor }) });
      montar();
      await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(4));
      await assentar();
      await assentar();
      expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
      expect(document.querySelectorAll(".mk-dp-hist__alcance").length).toBe(0);
      expect(servico.consultarExclusaoMovimentacao).not.toHaveBeenCalled();
    },
  );
});

describe("excluir a pesagem pela aba", () => {
  it("diálogo com os efeitos do servidor (as 2 posições), comando do servidor, a aba relê sem o movimento", async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(4));
    const pesagem = /** @type {HTMLElement} */ ([...document.querySelectorAll(".mk-dp-tl__card")].find((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent === "Pesagem"));
    const botao = await waitFor(() => {
      const b = within(pesagem).getByRole("button", { name: "Excluir movimentação" });
      expect(b.hasAttribute("disabled")).toBe(false);
      return b;
    });
    await act(async () => {
      fireEvent.click(botao);
    });
    const dialogo = await screen.findByRole("dialog", { name: "Excluir movimentação" });
    await waitFor(() => expect(within(dialogo).getByText(/L-2026-008 · Pasto 07: peso volta a 440 kg/)).toBeTruthy());
    expect(within(dialogo).getByText(/L-2026-014 · Pasto 07: peso volta a 370 kg/)).toBeTruthy();
    fireEvent.change(within(dialogo).getByLabelText("Motivo da exclusão"), { target: { value: "Pesagem lançada no dia errado" } });
    fireEvent.click(within(dialogo).getByRole("checkbox"));
    servico.excluirMovimentacaoMapa.mockResolvedValue({ ok: true });
    const chamadasAntes = servico.listarHistoricoMovimentacoesPagina.mock.calls.length;
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([SAIDA, ENTRADA]));
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));
    });
    await waitFor(() => expect(servico.excluirMovimentacaoMapa).toHaveBeenCalledTimes(1));
    const [id, corpo] = servico.excluirMovimentacaoMapa.mock.calls[0];
    expect(id).toBe("mv-pesagem");
    expect(corpo.motivo).toBe("Pesagem lançada no dia errado");
    expect(typeof corpo.operation_id).toBe("string");
    await waitFor(() => expect(servico.listarHistoricoMovimentacoesPagina.mock.calls.length).toBeGreaterThan(chamadasAntes));
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(2));
    expect([...document.querySelectorAll(".mk-dp-tl__titulo")].map((n) => n.textContent)).not.toContain("Pesagem");
  });
});
