/**
 * Detalhes do Lote v12 — aba Histórico do pasto (D-PROD-218; número
 * definitivo no PR). Renderiza a aba REAL dentro de uma casca de teste (o
 * `PastoCtx` com todas as chaves, `div.mk-dp` com as Abas, o corpo e o
 * rodapé), com o serviço do histórico e o cache do mapa trocados por dublês.
 *
 * Prova: consulta só com a aba ativa; linha do tempo por dia com cartões por
 * tipo; "Mostrar" com a lista do sistema (painel no desktop/tablet, folha de
 * baixo no celular, dentro do diálogo — Esc fecha só a folha); filtro global
 * na sessão; "Carregar mais"; aviso offline; vazio; erro; cancelado.
 * Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  buscarLoteDoHistorico: vi.fn(async () => null),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async () => []),
  getMapaCacheSnapshot: vi.fn(),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);

const { PastoCtx } = await import("@/components/mapa/detalhes-lote/pastoContexto");
const { Abas, idsDaAba } = await import("@/components/mapa/detalhes-lote/blocos");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");
const { LancLoteDialogo } = await import("@/components/lotes/LancamentoLoteUi");
const { default: AbaHistorico } = await import("@/components/mapa/detalhes-lote/AbaHistorico");

const EMP = "emp-1";
const AREA = {
  id: "a-p07",
  empresa_id: EMP,
  nome: "Pasto 07",
  setor_nome: "Retiro",
  tamanho_hectares: 109.3,
  area_pastejada: 98,
  tipo_cultura: "Pastagem",
  tipo_pastagem: "Braquiária Brizantha",
  capacidade_maxima: 240,
  ativo: true,
};
const posicao = (id, nome, categoria, sexo, cab, peso, cor) => ({
  id,
  __posicao: true,
  empresa_id: EMP,
  nome,
  categoria,
  sexo,
  quantidade_cabecas: cab,
  peso_medio_kg: peso,
  data_entrada: "2026-10-12",
  area_atual_id: AREA.id,
  area_atual_nome: AREA.nome,
  status: "Ativo",
  identificador_cor: cor,
});
/** Pasto 07, setor Retiro, 6 lotes, 314 cab (como o v12). */
const POSICOES = [
  posicao("p8", "L-2026-008", "VACA", "Fêmea", 38, 449.5, "#ef4444"),
  posicao("p14", "L-2026-014", "BOI MAGRO", "Macho", 86, 382.5, "#f59e0b"),
  posicao("p19", "L-2026-019", "NOVILHA", "Fêmea", 54, 300, "#3b82f6"),
  posicao("p27", "L-2026-027", "BOI MAGRO", "Macho", 33, 312.8, "#22c55e"),
  posicao("p31", "L-2026-031", "BEZERRO", "Macho", 62, 196, "#8b5cf6"),
  posicao("p33", "L-2026-033", "GARROTE", "Macho", 41, 330, "#14b8a6"),
];
const HOJE = new Date("2026-11-15T12:00:00");

const doLedger = (id, dia, reg) => ({
  empresa_id: EMP,
  efeito_servidor: { comando: "rebanho_ledger", evento_id: `ev-${id}`, operation_id: `op-${id}`, registrado_em: reg },
  created_date: reg,
  data_movimentacao: `${dia}T12:00:00.000Z`,
  historico_ocorrencia: dia,
  historico_registrado_em: reg,
});
const ENTRADA = {
  id: "mv-entrada",
  tipo: "Transferência de Área",
  lote: "L-2026-027",
  quantidade_animais: 33,
  area_origem_id: "a-p04",
  area_origem_nome: "Pasto 04",
  area_destino_id: AREA.id,
  area_destino_nome: "Pasto 07",
  linhas: [{ quantidade: 33, area_origem_id: "a-p04", area_origem_nome: "Pasto 04", nome: "L-2026-027" }],
  ...doLedger("entrada", "2026-11-05", "2026-11-05T15:10:00.000Z"),
};
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
const MORTE = {
  id: "mv-morte",
  tipo: "Morte",
  lote: "L-2026-031",
  quantidade_animais: 1,
  area_origem_id: AREA.id,
  linhas: [{ categoria: "Bezerro 0 a 12 meses", quantidade: 1, causa_morte: "Doença", distribuicao: [{ lote_id: "p31", nome: "L-2026-031", quantidade: 1 }] }],
  ...doLedger("morte", "2026-11-03", "2026-11-03T09:00:00.000Z"),
};
const NASCIMENTO = {
  id: "mv-nasc",
  tipo: "Nascimento",
  lote: "NASCIDOS BEZERRO 0 A 12 MESES",
  quantidade_animais: 3,
  area_origem_id: AREA.id,
  linhas: [{ sexo: "Macho", categoria_mae: "Vaca + 36 meses", categoria_filhote: "Bezerro 0 a 12 meses", quantidade: 3, peso_medio_kg: 32, posicao_id: "pn" }],
  ...doLedger("nasc", "2026-10-28", "2026-10-28T11:00:00.000Z"),
};
const SAIDA = {
  id: "mv-saida",
  tipo: "Transferência de Área",
  lote: "L-2026-004",
  quantidade_animais: 72,
  area_origem_id: AREA.id,
  area_origem_nome: "Pasto 07",
  area_destino_id: "a-p08",
  area_destino_nome: "Pasto 08",
  linhas: [{ quantidade: 72, area_origem_id: AREA.id, area_origem_nome: "Pasto 07", nome: "L-2026-004" }],
  ...doLedger("saida", "2026-09-02", "2026-09-02T10:00:00.000Z"),
};
const SUPL = {
  id: "ev-1",
  empresa_id: EMP,
  ponto_suplementacao_id: "k07",
  ponto_nome: "Cocho 07",
  area_id: AREA.id,
  area_ids: [AREA.id],
  data_lancamento: "2026-11-09",
  produto: "SAL MINERAL 80",
  quantidade_total_kg: 400,
  quantidade_sacos: 16,
  peso_por_saco_kg: 25,
  created_date: "2026-11-09T14:00:00.000Z",
};
const SUPL_OUTRO_PASTO = { ...SUPL, id: "ev-2", area_id: "a-p01", area_ids: ["a-p01"], ponto_nome: "Cocho 01" };

const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2", ...extra });

/**
 * Casca de teste (a casca real, `PainelPasto`, chega na integração): o mesmo
 * contrato — `PastoCtx` completo, raiz `.mk-dp[data-modo]`, Abas, corpo com o
 * painel da aba ativa e o rodapé em `slotRodape`.
 */
function CascaDeTeste({ modo = "desktop", abaInicial = "historico", eventos = [SUPL, SUPL_OUTRO_PASTO] }) {
  const [aba, setAba] = React.useState(abaInicial);
  const [slotRodape, setSlotRodape] = React.useState(/** @type {HTMLElement | null} */ (null));
  const modelo = React.useMemo(() => montarModeloDetalhes({ area: AREA, lotes: POSICOES, lotesDaArea: POSICOES, hoje: HOJE }), []);
  const valor = {
    modo,
    modelo,
    dados: {
      areaId: AREA.id,
      areaNome: AREA.nome,
      setorNome: "Retiro",
      lotesDoPasto: POSICOES,
      movimentacoes: [],
      empresaId: EMP,
      suplementacao: { pontos: [], eventos, hoje: "2026-11-15" },
      onAbrirCocho: null,
    },
    permissoes: { mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true },
    escopoPreferencias: { clienteId: "cli-1", login: "teste@maike.local", empresaId: EMP },
    empurrar: () => {},
    voltar: () => {},
    selecao: new Set(),
    alternarSelecao: () => {},
    definirSelecao: () => {},
    slotRodape,
    marcarRodapeProprio: () => {},
  };
  const nLotes = modelo.lotes.length;
  const abas = [
    { id: "detalhes", rotulo: "Detalhes" },
    { id: "lotes", rotulo: "Lotes", ...(modo !== "celular" && nLotes > 0 ? { badge: nLotes } : {}) },
    { id: "historico", rotulo: "Histórico" },
    { id: "supl", rotulo: modo === "celular" ? "Supl." : "Suplementação" },
  ];
  const ids = idsDaAba("pasto", aba);
  return (
    <PastoCtx.Provider value={valor}>
      <div className="mk-dp" data-modo={modo} translate="no">
        <Abas abas={abas} ativa={aba} onMudar={setAba} idBase="pasto" />
        <div className="mk-dp__corpo mk-dp__corpo--cards" role="tabpanel" id={ids.painel} aria-labelledby={ids.aba}>
          {aba === "historico" ? <AbaHistorico /> : <p>Outra aba</p>}
        </div>
        <div className="mk-dp__rodape" ref={setSlotRodape} />
      </div>
    </PastoCtx.Provider>
  );
}

/** Como no mapa: dentro do `LancLoteDialogo` real (título = pasto, sub = setor). */
function NoDialogo(props) {
  const [aberto, setAberto] = React.useState(true);
  return (
    <LancLoteDialogo open={aberto} onOpenChange={setAberto} titulo="Pasto 07" lotes={[{ nome: "Retiro" }]} largo somenteLeitura>
      <CascaDeTeste {...props} />
    </LancLoteDialogo>
  );
}

const montar = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...utils, client };
};

/** Títulos dos cartões, na ordem da tela. */
const titulos = () => [...document.querySelectorAll(".mk-dp-tl__titulo")].map((n) => n.textContent);
const dias = () => [...document.querySelectorAll(".mk-dp-tl__dia")].map((n) => n.textContent);
const botaoMostrar = () => screen.getByRole("button", { name: /^Mostrar:/ });

/** Celular (< 640 px, como o B1Select): folha de baixo; o diálogo abre em tela cheia. */
const celular = () => {
  window.matchMedia = /** @type {any} */ (
    (q) => ({ matches: /max-width:\s*639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  );
};
const ficarOffline = () => Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });

/** O filtro é global na sessão: cada teste que muda volta para "Todos os registros". */
const voltarParaTodos = async () => {
  if (botaoMostrar().textContent === "Todos os registros") return;
  await act(async () => {
    fireEvent.click(botaoMostrar());
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("option", { name: "Todos os registros" }));
  });
};

let matchMediaOriginal;
beforeEach(() => {
  matchMediaOriginal = window.matchMedia;
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([ENTRADA, PESAGEM, MORTE, NASCIMENTO, SAIDA]));
  cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: [], atualizadoEm: null }));
  cache.refreshMapaCacheEntry.mockImplementation(async () => []);
});
afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

describe("aba Histórico do pasto — dados", () => {
  it("só consulta com a aba ativa: em Lotes nada é pedido; ao abrir Histórico, a área vem do contexto", async () => {
    montar(<CascaDeTeste abaInicial="lotes" />);
    expect(screen.getByRole("tab", { name: /Lotes/ }).textContent).toContain("6");
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    });
    await screen.findByText("Movimentação · entrada");
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledWith({ empresaId: EMP, areaId: AREA.id, cursor: null, limit: 100 });
    expect(screen.getByRole("tab", { name: "Histórico" }).getAttribute("aria-selected")).toBe("true");
  });

  it("linha do tempo por dia (mais recente primeiro), cartões por tipo, nota no fim; sem 'Registrado por'", async () => {
    montar(<CascaDeTeste />);
    await screen.findByText("Movimentação · entrada");
    expect(dias()).toEqual(["09 NOV. 2026", "05 NOV. 2026", "03 NOV. 2026", "28 OUT. 2026", "02 SET. 2026"]);
    expect(titulos()).toEqual(["Suplementação", "Movimentação · entrada", "Pesagem", "Pesagem", "Morte", "Nascimento", "Movimentação · saída"]);
    const linhaDoTempo = screen.getByRole("list", { name: "Registros do pasto" });
    const entrada = within(linhaDoTempo).getByText("Movimentação · entrada").closest("li");
    expect([...entrada.querySelectorAll("dt")].map((n) => n.textContent)).toEqual(["Lote", "Cabeças", "De", "Até"]);
    expect([...entrada.querySelectorAll("dd")].map((n) => n.textContent)).toEqual(["L-2026-027", "33", "Pasto 04", "Pasto 07"]);
    const supl = within(linhaDoTempo).getByText("Suplementação").closest("li");
    expect([...supl.querySelectorAll("dd")].map((n) => n.textContent)).toEqual(["Cocho 07", "SAL MINERAL 80", "400,00", "16,00"]);
    expect(screen.queryByText("Cocho 01")).toBeNull();
    expect(screen.queryByText("Registrado por")).toBeNull();
    const aba = document.querySelector(".mk-dp-hist");
    expect(aba.lastElementChild.textContent).toBe("Registros de todas as movimentações, pesagens e manejos que passaram por este pasto.");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("cancelado aparece com o chip 'Cancelado' (e o motivo gravado)", async () => {
    const cancelada = { ...ENTRADA, situacao: "cancelado", cancelamento: { motivo: "Lançado no pasto errado" } };
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([cancelada]));
    montar(<CascaDeTeste eventos={[]} />);
    const titulo = await screen.findByText("Movimentação · entrada");
    const cartao = titulo.closest("li");
    expect(cartao.classList.contains("is-cancelado")).toBe(true);
    expect(within(cartao).getByText("Cancelado").className).toContain("mk-dp-chip");
    expect(within(cartao).getByText("Lançado no pasto errado")).toBeTruthy();
  });

  it("'Carregar mais' pede a próxima página pelo cursor; evento mais antigo espera a página dele", async () => {
    const antigo = { ...SUPL, id: "ev-antigo", ponto_nome: "Cocho 07B", data_lancamento: "2026-10-01", created_date: "2026-10-01T10:00:00.000Z" };
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async ({ cursor }) =>
      cursor === "c1" ? pagina([SAIDA], { total: 3 }) : pagina([ENTRADA, PESAGEM], { has_more: true, next_cursor: "c1", total: 3 })
    );
    montar(<CascaDeTeste eventos={[SUPL, antigo]} />);
    await screen.findByText("Movimentação · entrada");
    expect(screen.getByText(/Movimentações: 2 de 3/).textContent).toContain("1 registro mais antigo aparece ao carregar mais");
    expect(screen.queryByText("Cocho 07B")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    });
    await screen.findByText("Movimentação · saída");
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenLastCalledWith({ empresaId: EMP, areaId: AREA.id, cursor: "c1", limit: 100 });
    expect(screen.getByText("Cocho 07B")).toBeTruthy();
    expect(dias().slice(-2)).toEqual(["01 OUT. 2026", "02 SET. 2026"]);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("offline: cópia do aparelho, com o aviso do histórico de hoje e sem 'Carregar mais'", async () => {
    ficarOffline();
    cache.getMapaCacheSnapshot.mockImplementation(async () => ({
      items: [{ ...ENTRADA, historico_ocorrencia: undefined }, { ...ENTRADA, id: "outra-area", area_destino_id: "a-p09", area_origem_id: "a-p04" }],
      atualizadoEm: "2026-11-10T10:00:00.000Z",
    }));
    montar(<CascaDeTeste eventos={[]} />);
    await screen.findByText("Movimentação · entrada");
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
    const aviso = screen.getByRole("status");
    expect(aviso.textContent).toMatch(/^Sem conexão\. Histórico offline parcial: 1 movimentação salva neste aparelho, atualizado em /);
    expect(aviso.textContent).toContain("cópia parcial ordenada pelas datas disponíveis no aparelho");
    expect(titulos()).toEqual(["Movimentação · entrada"]);
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("offline sem cópia no aparelho: diz isso, sem fingir que o pasto não tem registro", async () => {
    ficarOffline();
    montar(<CascaDeTeste eventos={[]} />);
    expect(await screen.findByText("Este aparelho ainda não tem movimentações salvas para consulta sem conexão.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("sem data de atualização");
  });

  it("servidor fora e sem cópia: erro visível e 'Tentar novamente' refaz a consulta", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockRejectedValueOnce(new Error("Servidor fora do ar"));
    montar(<CascaDeTeste eventos={[]} />);
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("Não foi possível carregar o histórico.");
    await act(async () => {
      fireEvent.click(within(alerta).getByRole("button", { name: "Tentar novamente" }));
    });
    await screen.findByText("Movimentação · entrada");
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledTimes(2);
  });

  it("manejo salvo (evento 'atualizar-mapa'): o histórico é refeito", async () => {
    montar(<CascaDeTeste />);
    await screen.findByText("Movimentação · entrada");
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("atualizar-mapa"));
    });
    await waitFor(() => expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledTimes(2));
  });
});

describe("aba Histórico do pasto — 'Mostrar'", () => {
  it("desktop/tablet: o painel de seleção do sistema, preso ao botão; escolher filtra; o filtro vale para a sessão", async () => {
    const { unmount } = montar(<CascaDeTeste />);
    await screen.findByText("Movimentação · entrada");
    expect(botaoMostrar().textContent).toBe("Todos os registros");
    expect(botaoMostrar().getAttribute("aria-haspopup")).toBe("listbox");
    await act(async () => {
      fireEvent.click(botaoMostrar());
    });
    const lista = await screen.findByRole("listbox", { name: "Mostrar" });
    expect(lista.closest(".mk-sel-pop")).toBeTruthy();
    expect(botaoMostrar().getAttribute("aria-expanded")).toBe("true");
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos os registros", "Movimentações", "Pesagens", "Manejos", "Suplementação"]);
    expect(within(lista).getByRole("option", { name: "Todos os registros" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      fireEvent.click(within(lista).getByRole("option", { name: "Pesagens" }));
    });
    expect(screen.queryByRole("listbox", { name: "Mostrar" })).toBeNull();
    expect(botaoMostrar().textContent).toBe("Pesagens");
    expect(titulos()).toEqual(["Pesagem", "Pesagem"]);

    // Outro pasto/abertura na mesma sessão: o filtro continua.
    unmount();
    montar(<CascaDeTeste />);
    await screen.findAllByText("Pesagem");
    expect(botaoMostrar().textContent).toBe("Pesagens");
    expect(titulos()).toEqual(["Pesagem", "Pesagem"]);

    await act(async () => {
      fireEvent.click(botaoMostrar());
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Manejos" }));
    });
    expect(titulos()).toEqual(["Morte", "Nascimento"]);
    await voltarParaTodos();
    expect(titulos()).toHaveLength(7);
  });

  it("filtro sem registro: vazio 'Nenhum registro deste tipo neste pasto.' (a nota continua)", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([ENTRADA]));
    montar(<CascaDeTeste eventos={[]} />);
    await screen.findByText("Movimentação · entrada");
    await act(async () => {
      fireEvent.click(botaoMostrar());
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Suplementação" }));
    });
    expect(screen.getByText("Nenhum registro deste tipo neste pasto.").closest(".mk-dp-vazio")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Registros do pasto" })).toBeNull();
    expect(screen.getByText(/^Registros de todas as movimentações/)).toBeTruthy();
    await voltarParaTodos();
  });

  it("teclado no desktop: Enter abre, ↓ e Enter escolhem, Esc fecha só a lista", async () => {
    montar(<NoDialogo />);
    await screen.findByText("Movimentação · entrada");
    const botao = botaoMostrar();
    act(() => botao.focus());
    await act(async () => {
      fireEvent.keyDown(botao, { key: "Enter" });
    });
    expect(await screen.findByRole("listbox", { name: "Mostrar" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(botao, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox", { name: "Mostrar" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Pasto 07" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(botao, { key: "ArrowDown" });
    });
    await screen.findByRole("listbox", { name: "Mostrar" });
    await act(async () => {
      fireEvent.keyDown(botao, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(botao, { key: "Enter" });
    });
    expect(screen.queryByRole("listbox", { name: "Mostrar" })).toBeNull();
    expect(botaoMostrar().textContent).toBe("Movimentações");
    expect(titulos()).toEqual(["Movimentação · entrada", "Movimentação · saída"]);
    await voltarParaTodos();
  });

  it("celular: a folha de baixo do sistema, DENTRO do diálogo do Detalhes; Esc fecha só a folha", async () => {
    celular();
    montar(<NoDialogo modo="celular" />);
    await screen.findByText("Movimentação · entrada");
    expect(screen.getByRole("tab", { name: "Supl." })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Lotes" }).querySelector(".mk-dp-aba__badge")).toBeNull();
    await act(async () => {
      fireEvent.click(botaoMostrar());
    });
    const folha = screen.getByRole("dialog", { name: "Mostrar" });
    expect(folha.classList.contains("mk-sheet")).toBe(true);
    expect(folha.closest(".mk-ll-dlg")).toBeTruthy();
    expect(within(folha).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos os registros", "Movimentações", "Pesagens", "Manejos", "Suplementação"]);

    await act(async () => {
      fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Mostrar" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Pasto 07" })).toBeTruthy();
    expect(document.activeElement).toBe(botaoMostrar());

    await act(async () => {
      fireEvent.click(botaoMostrar());
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog", { name: "Mostrar" })).getByRole("option", { name: "Suplementação" }));
    });
    expect(screen.queryByRole("dialog", { name: "Mostrar" })).toBeNull();
    expect(titulos()).toEqual(["Suplementação"]);
    await act(async () => {
      fireEvent.click(botaoMostrar());
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog", { name: "Mostrar" })).getByRole("option", { name: "Todos os registros" }));
    });
    expect(titulos()).toHaveLength(7);

    // Sem folha aberta, o Esc volta a ser do diálogo (no celular, fecha — como hoje).
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Pasto 07" })).toBeNull();
  });
});
