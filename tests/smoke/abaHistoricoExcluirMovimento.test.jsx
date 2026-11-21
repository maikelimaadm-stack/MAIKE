/**
 * D-PROD-266 (etapa 1) — "Excluir movimentação" na aba Histórico do pasto
 * (Detalhes do Lote v12: PainelPasto → AbaHistorico → LinhaDoTempo).
 *
 * Aqui o `ExcluirMovimentacao` é um dublê que registra as props: prova QUAIS
 * cartões levam a ação (um por movimento, só no primeiro cartão; só dados do
 * servidor; nunca legado ou suplementação; o registro excluído some), o aviso do alcance, a
 * releitura do histórico ao excluir e o slot `acoes` da LinhaDoTempo (cartão
 * sem `acoes` idêntico ao de antes). O componente real (elegibilidade, limite
 * de consultas, diálogo) está em abaHistoricoExcluirMovimentoReal.test.jsx.
 * Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
/** Dublê do ExcluirMovimentacao: `visivel` decide se ele desenha algo (como a permissão no real). */
const dubl = vi.hoisted(() => ({ props: /** @type {any[]} */ ([]), visivel: true }));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/components/lotes/ExcluirMovimentacao", async () => {
  const { createElement: h } = await import("react");
  return {
    default: function ExcluirMovimentacaoDeTeste(props) {
      dubl.props.push(props);
      if (!dubl.visivel) return null;
      return h(
        "div",
        { "data-estado-exclusao": "elegivel" },
        h("button", { type: "button", "data-mov": props.movimento?.id, onClick: () => props.onExcluido?.() }, "Excluir movimentação"),
      );
    },
  };
});

const { PastoCtx } = await import("@/components/mapa/detalhes-lote/pastoContexto");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");
const { default: AbaHistorico, comAcaoDeExcluir, textoDoAlcance, outrosPastosDoMovimento } = await import("@/components/mapa/detalhes-lote/AbaHistorico");
const { default: LinhaDoTempo } = await import("@/components/mapa/detalhes-lote/LinhaDoTempo");
const { cartoesDaMovimentacao, montarHistoricoDoPasto } = await import("@/components/mapa/detalhes-lote/historicoDoPasto");

const EMP = "emp-1";
const AREA = { id: "a-p07", empresa_id: EMP, nome: "Pasto 07", setor_nome: "Retiro", ativo: true };
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
/** Um movimento, dois cartões (um por lote pesado). */
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
const CANCELADO = {
  id: "mv-cancelado",
  tipo: "Morte",
  lote: "L-2026-031",
  quantidade_animais: 1,
  area_origem_id: AREA.id,
  situacao: "cancelado",
  cancelamento: { motivo: "Lançado no pasto errado" },
  linhas: [{ categoria: "Bezerro", quantidade: 1, causa_morte: "Doença", distribuicao: [{ lote_id: "p31", nome: "L-2026-031", quantidade: 1 }] }],
  ...doLedger("cancelado", "2026-11-02", "2026-11-02T09:00:00.000Z"),
};
/** Registro anterior ao ledger: sem `efeito_servidor` do rebanho → sem exclusão. */
const LEGADO = {
  id: "mv-legado",
  tipo: "Transferência de Área",
  lote: "LOTE VELHO",
  quantidade_animais: 40,
  area_origem_id: "a-p04",
  area_origem_nome: "Pasto 04",
  area_destino_id: AREA.id,
  area_destino_nome: "Pasto 07",
  empresa_id: EMP,
  created_date: "2026-10-01T10:00:00.000Z",
  data_movimentacao: "2026-10-01T12:00:00.000Z",
  historico_ocorrencia: "2026-10-01",
  historico_registrado_em: "2026-10-01T10:00:00.000Z",
};
const SUPL = {
  id: "ev-1",
  empresa_id: EMP,
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

const pagina = (items, extra = {}) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2", ...extra });

function Casca({ eventos = [SUPL] }) {
  const modelo = React.useMemo(() => montarModeloDetalhes({ area: AREA, lotes: [], lotesDaArea: [], hoje: new Date("2026-11-15T12:00:00") }), []);
  const valor = {
    modo: "desktop",
    modelo,
    dados: {
      areaId: AREA.id,
      areaNome: AREA.nome,
      setorNome: "Retiro",
      lotesDoPasto: [],
      movimentacoes: [],
      empresaId: EMP,
      suplementacao: { pontos: [], eventos, hoje: "2026-11-15" },
      onAbrirCocho: null,
    },
    permissoes: { mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true },
    escopoPreferencias: null,
    empurrar: () => {},
    voltar: () => {},
    selecao: new Set(),
    alternarSelecao: () => {},
    definirSelecao: () => {},
    slotRodape: null,
    marcarRodapeProprio: () => {},
  };
  return (
    <PastoCtx.Provider value={valor}>
      <div className="mk-dp" data-modo="desktop">
        <AbaHistorico />
      </div>
    </PastoCtx.Provider>
  );
}

const montar = (ui = <Casca />) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
};

/** Cartões na ordem da tela: título e se tem pé de ações. */
const cartoes = () =>
  [...document.querySelectorAll(".mk-dp-tl__card")].map((c) => ({
    titulo: c.querySelector(".mk-dp-tl__titulo")?.textContent,
    lote: c.querySelector(".mk-dp-tl__row dd")?.textContent,
    acao: c.querySelector(".mk-dp-tl__acoes [data-mov]")?.getAttribute("data-mov") ?? null,
    pe: Boolean(c.querySelector(".mk-dp-tl__acoes")),
    alcance: c.querySelector(".mk-dp-hist__alcance")?.textContent ?? null,
  }));

beforeEach(() => {
  dubl.props = [];
  dubl.visivel = true;
  servico.listarHistoricoMovimentacoesPagina.mockReset();
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([ENTRADA, PESAGEM, CANCELADO, LEGADO]));
  cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: [], atualizadoEm: null }));
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

describe("historicoDoPasto: o cartão de movimentação leva o movimento cru", () => {
  it("todos os cartões de um movimento levam o MESMO `mov`; a suplementação não leva", () => {
    const [a, b] = cartoesDaMovimentacao(PESAGEM, { areaId: AREA.id, areaNome: AREA.nome }, { doServidor: true });
    expect(a.mov).toBe(PESAGEM);
    expect(b.mov).toBe(PESAGEM);
    const { dias } = montarHistoricoDoPasto({ movimentacoes: [], eventos: [SUPL], areaId: AREA.id, filtro: "sup" });
    expect(dias[0].cartoes[0].mov).toBeUndefined();
  });
});

describe("aba Histórico: Excluir movimentação no pé do cartão", () => {
  it("uma ação por movimento, no primeiro cartão dele; o excluído some; legado e suplementação ficam sem pé", async () => {
    montar();
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(5));
    expect(cartoes()).toEqual([
      { titulo: "Suplementação", lote: "Cocho 07", acao: null, pe: false, alcance: null },
      { titulo: "Movimentação · entrada", lote: "L-2026-027", acao: "mv-entrada", pe: true, alcance: textoDoAlcance(1, 1) },
      { titulo: "Pesagem", lote: "L-2026-008", acao: "mv-pesagem", pe: true, alcance: textoDoAlcance(2, 0) },
      { titulo: "Pesagem", lote: "L-2026-014", acao: null, pe: false, alcance: null },
      { titulo: "Movimentação · entrada", lote: "LOTE VELHO", acao: null, pe: false, alcance: null },
    ]);
    // O registro excluído (situacao "cancelado" no servidor) não vira cartão nem chip "Cancelado".
    expect(screen.queryByText("Morte")).toBeNull();
    expect(screen.queryByText("Cancelado")).toBeNull();
    expect(screen.queryByText("Lançado no pasto errado")).toBeNull();
    // A ação recebe o movimento cru inteiro (o mesmo objeto do servidor) — nunca um cartão.
    const recebidos = new Map(dubl.props.map((p) => [p.movimento.id, p.movimento]));
    expect([...recebidos.keys()].sort()).toEqual(["mv-entrada", "mv-pesagem"]);
    expect(recebidos.get("mv-pesagem")).toEqual(PESAGEM);
    expect(typeof dubl.props[0].onExcluido).toBe("function");
  });

  it("o aviso diz que o registro inteiro sai; só cita outro pasto quando o registro envolve outro pasto", () => {
    expect(textoDoAlcance(2)).toMatch(/registro inteiro/);
    expect(textoDoAlcance(2)).toMatch(/os 2 cartões deste registro saem juntos, com todos os lotes dele\.$/);
    expect(textoDoAlcance(1)).toBe("Exclui o registro inteiro, com todos os lotes dele, não só este cartão.");
    expect(textoDoAlcance(1, 1)).toMatch(/Desfaz também o que ele mudou no outro pasto do registro\.$/);
    expect(textoDoAlcance(2, 2)).toMatch(/nos outros pastos do registro\.$/);
    // Pesagem de um pasto só: nenhuma menção a outro pasto.
    expect(outrosPastosDoMovimento(PESAGEM, AREA.id)).toBe(0);
    expect(textoDoAlcance(2, outrosPastosDoMovimento(PESAGEM, AREA.id))).not.toMatch(/pasto/);
    // Entrada vinda do Pasto 04: um outro pasto (origem da linha e do registro contam uma vez).
    expect(outrosPastosDoMovimento(ENTRADA, AREA.id)).toBe(1);
    // Sem ids gravados: não afirma nada sobre outros pastos.
    expect(outrosPastosDoMovimento({ id: "x", tipo: "Morte" }, AREA.id)).toBe(0);
  });

  it("leitor de tela: com o botão, o pé é um grupo nomeado pelo aviso do alcance", async () => {
    montar();
    await waitFor(() => expect(document.querySelector('[data-mov="mv-pesagem"]')).toBeTruthy());
    const grupo = await screen.findByRole("group", { name: textoDoAlcance(2, 0) });
    expect(within(grupo).getByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
    const alcance = /** @type {HTMLElement} */ (grupo.querySelector(".mk-dp-hist__alcance"));
    expect(grupo.getAttribute("aria-labelledby")).toBe(alcance.id);
  });

  it("sem o botão (o componente não desenha: sem permissão), o aviso do alcance também não aparece", async () => {
    dubl.visivel = false;
    montar();
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBe(5));
    expect(document.querySelectorAll(".mk-dp-hist__alcance").length).toBe(0);
    // O pé fica com a caixa vazia (o CSS a oculta: `.mk-dp-hist__excluir:empty`).
    for (const caixa of document.querySelectorAll(".mk-dp-hist__excluir")) {
      expect(caixa.childElementCount).toBe(0);
      expect(caixa.getAttribute("role")).toBeNull();
    }
  });

  it("CSS: o pé vazio fica com 0 px sem depender de `:has()` (WebView antigo)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/mk-dp-tl-acoes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/:has\(/);
    const regra = (seletor) => {
      const i = css.indexOf(`${seletor} {`);
      expect(i).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf("}", i));
    };
    // O contêiner não tem recuo nem divisória: quem recebe é o filho NÃO vazio.
    expect(regra(".mk-dp .mk-dp-tl__acoes")).toMatch(/padding: 0;/);
    expect(regra(".mk-dp .mk-dp-tl__acoes")).toMatch(/border: 0;/);
    expect(regra(".mk-dp .mk-dp-tl__acoes > :not(:empty)")).toMatch(/border-top: 1px solid #f0f1f3;/);
    expect(css).toMatch(/\.mk-dp \.mk-dp-tl__acoes > :empty\s*\{\s*display: none;/);
  });

  it("com o filtro Pesagens a pesagem continua com UMA ação", () => {
    const { dias } = montarHistoricoDoPasto({
      movimentacoes: [ENTRADA, PESAGEM],
      areaId: AREA.id,
      areaNome: AREA.nome,
      doServidor: true,
      filtro: "pes",
    });
    const comAcao = comAcaoDeExcluir(dias, { doServidor: true }).flatMap((d) => d.cartoes);
    expect(comAcao.map((c) => Boolean(c.acoes))).toEqual([true, false]);
  });

  it("cópia do aparelho (offline): nenhuma ação, só leitura", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    cache.getMapaCacheSnapshot.mockImplementation(async () => ({ items: [ENTRADA, PESAGEM], atualizadoEm: "2026-11-15T10:00:00.000Z" }));
    montar();
    await waitFor(() => expect(document.querySelectorAll(".mk-dp-tl__card").length).toBeGreaterThan(0));
    expect(screen.getByText(/Histórico offline parcial/)).toBeTruthy();
    expect(document.querySelectorAll(".mk-dp-tl__acoes").length).toBe(0);
    expect(dubl.props.length).toBe(0);
    expect(comAcaoDeExcluir([{ chave: "d", rotulo: "d", cartoes: [{ chave: "c", mov: PESAGEM }] }], { doServidor: false })[0].cartoes[0].acoes).toBeUndefined();
  });

  it("ao excluir, o histórico da aba é consultado de novo e o movimento sai", async () => {
    montar();
    await waitFor(() => expect(document.querySelector('[data-mov="mv-pesagem"]')).toBeTruthy());
    const antes = servico.listarHistoricoMovimentacoesPagina.mock.calls.length;
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([ENTRADA, CANCELADO, LEGADO]));
    await act(async () => {
      fireEvent.click(/** @type {HTMLElement} */ (document.querySelector('[data-mov="mv-pesagem"]')));
    });
    await waitFor(() => expect(servico.listarHistoricoMovimentacoesPagina.mock.calls.length).toBeGreaterThan(antes));
    await waitFor(() => expect(cartoes().some((c) => c.titulo === "Pesagem")).toBe(false));
    expect(cartoes().some((c) => c.titulo === "Morte")).toBe(false);
  });
});

describe("LinhaDoTempo: slot opcional `acoes` (contrato entre frentes)", () => {
  const DIA = (acoes) => [
    {
      chave: "2026-11-09",
      rotulo: "09 NOV. 2026",
      cartoes: [{ chave: "c1", icone: "pesagem", titulo: "Pesagem", cancelado: false, linhas: [{ rotulo: "Lote", valor: "L-1" }], ...(acoes === undefined ? {} : { acoes }) }],
    },
  ];

  it("cartão sem `acoes` (ou com null) fica idêntico ao de hoje: sem pé", () => {
    const { container: sem } = render(<LinhaDoTempo dias={DIA(undefined)} />);
    const html = sem.innerHTML;
    expect(sem.querySelector(".mk-dp-tl__acoes")).toBeNull();
    cleanup();
    const { container: nulo } = render(<LinhaDoTempo dias={DIA(null)} />);
    expect(nulo.innerHTML).toBe(html);
  });

  it("com `acoes`: o pé vem depois das linhas, dentro do cartão", () => {
    render(<LinhaDoTempo dias={DIA(<button type="button">Ação</button>)} />);
    const card = /** @type {HTMLElement} */ (document.querySelector(".mk-dp-tl__card"));
    const ultimo = card.lastElementChild;
    expect(ultimo?.className).toBe("mk-dp-tl__acoes");
    expect(ultimo?.previousElementSibling?.tagName).toBe("DL");
    expect(screen.getByRole("button", { name: "Ação" }).closest(".mk-dp-tl__card")).toBe(card);
  });
});
