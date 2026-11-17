// @vitest-environment jsdom
/**
 * D-PROD-217 — casca do Detalhes do Lote v12 (`PainelPasto`) e o que ela pede
 * ao diálogo (`LancLoteDialogo`: `popupDesde`, `setCabecalho`, ‹ Voltar, Esc).
 *
 * As abas e as telas são de outras peças: aqui elas são trocadas por versões de
 * teste que só usam o contexto da casca (`usePasto`), para provar a casca sozinha:
 * pilha e ‹, Esc, cabeçalho publicado, alvo dos manejos (tela do lote › marcados
 * › todos), rodapé por permissão (e desabilitado sem lote), rodapé próprio,
 * abas por permissão, aba inicial Lotes e o popup a partir do tablet.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Abas e telas de teste (só o contexto da casca) ──────────────────────────
vi.mock("@/components/mapa/detalhes-lote/AbaLotes", async () => {
  const { createElement: h } = await import("react");
  const { usePasto } = await import("@/components/mapa/detalhes-lote/pastoContexto");
  return {
    default: function AbaLotesDeTeste() {
      const { modelo, empurrar, alternarSelecao, selecao } = usePasto();
      return h(
        "div",
        { "data-testid": "aba-lotes" },
        ...modelo.lotes.map((l) =>
          h(
            "div",
            { key: l.id },
            h("button", { type: "button", onClick: () => empurrar({ tipo: "lote", loteId: l.id }) }, `Abrir ${l.nome}`),
            h("button", { type: "button", "aria-pressed": selecao.has(l.id), onClick: () => alternarSelecao(l.id) }, `Marcar ${l.nome}`),
          ),
        ),
        h("button", { type: "button", onClick: () => empurrar({ tipo: "configurarTabela" }) }, "Configurar tabela"),
      );
    },
  };
});
vi.mock("@/components/mapa/detalhes-lote/AbaDetalhes", async () => {
  const { createElement: h } = await import("react");
  return { default: () => h("div", { "data-testid": "aba-detalhes" }) };
});
vi.mock("@/components/mapa/detalhes-lote/AbaHistorico", async () => {
  const { createElement: h } = await import("react");
  return { default: () => h("div", { "data-testid": "aba-historico" }) };
});
vi.mock("@/components/mapa/detalhes-lote/AbaSuplementacao", async () => {
  const { createElement: h } = await import("react");
  const { createPortal } = await import("react-dom");
  const { usePasto, useRodapeProprio } = await import("@/components/mapa/detalhes-lote/pastoContexto");
  return {
    default: function AbaSuplDeTeste() {
      const { slotRodape } = usePasto();
      useRodapeProprio(true);
      return h("div", { "data-testid": "aba-supl" }, slotRodape ? createPortal(h("button", { type: "button" }, "Lançar"), slotRodape) : null);
    },
  };
});
vi.mock("@/components/mapa/detalhes-lote/TelaLote", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ loteId }) => h("div", { "data-testid": "tela-lote" }, loteId) };
});
vi.mock("@/components/mapa/detalhes-lote/TelaConfigurarTabela", async () => {
  const { createElement: h } = await import("react");
  return { default: () => h("div", { "data-testid": "tela-config" }) };
});

// ── Bordas do DetalhesLote real (rede, sessão, toast, formulários) ──────────
const servico = vi.hoisted(() => ({
  listarProdutosDaEmpresa: vi.fn(async () => []),
  criarEventoSuplementacao: vi.fn(),
  registrarSuplementacaoEmLote: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
/** Formulário de teste: mostra os nomes dos lotes que recebeu (o alvo do manejo). */
const formulario = vi.hoisted(() => (nome) => async () => {
  const { createElement } = await import("react");
  return {
    default: (props) =>
      createElement("div", { "data-testid": `form-${nome}` }, (props.lotesOriginais || props.lote || props.lotes || []).map((l) => l.nome).join(",")),
  };
});
const cache = vi.hoisted(() => ({ getMapaCachedData: vi.fn(async () => []), refreshMapaCacheEntry: vi.fn(async () => []) }));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/mapaService", () => ({ listarIconesPorTipoEntidade: async () => [] }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1" }) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/lotes/ExcluirMovimentacao", () => ({ escopoDoUsuario: () => "c-1:u-1" }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/lotes/FormularioMovimentacaoLote", formulario("mover"));
vi.mock("@/components/lotes/FormularioMorte", formulario("morte"));
vi.mock("@/components/lotes/FormularioNascimento", formulario("nascimento"));
vi.mock("@/components/lotes/FormularioAbate", formulario("abate"));
vi.mock("@/components/lotes/FormularioMudancaCategoria", formulario("mudanca"));
vi.mock("@/components/lotes/FormularioPesagem", formulario("pesagem"));
vi.mock("@/components/lotes/HistoricoMovimentacoes", formulario("historico"));
vi.mock("@/components/suplementacao/HistoricoSuplementacaoLote", formulario("historico-supl"));
vi.mock("@/components/lotes/RenomearLoteForm", formulario("renomear"));

const { default: PainelPasto } = await import("@/components/mapa/detalhes-lote/PainelPasto");
const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");
const { LancLoteDialogo } = await import("@/components/lotes/LancamentoLoteUi");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");

// ── Dados de exemplo (como o v12: Pasto 07, setor Retiro) ───────────────────
const posicao = (id, nome, categoria, cab) => ({
  id, nome, categoria, quantidade_cabecas: cab, peso_medio_kg: 400, area_atual_id: "a1", area_atual_nome: "Pasto 07", status: "Ativo", __posicao: true,
});
const LOTES = [posicao("p8", "L-2026-008", "VACA", 38), posicao("p14", "L-2026-014", "BOI MAGRO", 86)];
const modeloDe = (lotes = LOTES) => montarModeloDetalhes({ area: { id: "a1", nome: "Pasto 07", tamanho_hectares: 109.3 }, lotes, hoje: new Date("2026-11-15T12:00:00") });
const TODAS = { mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true };
const DADOS = { areaId: "a1", areaNome: "Pasto 07", setorNome: "Retiro" };

/** Largura da tela para os `matchMedia` (desktop 1280, tablet 820, celular 390). */
const largura = (w) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};

const montarPainel = (props = {}) => render(<PainelPasto modelo={modeloDe()} permissoes={TODAS} dados={DADOS} manejos={<div data-testid="grade-manejos" />} {...props} />);
const montarNoDialogo = ({ popupDesde = "tablet", onOpenChange = () => {}, ...props } = {}) =>
  render(
    <LancLoteDialogo open onOpenChange={onOpenChange} titulo="Pasto 07" lotes={[{ nome: "Retiro" }]} largo somenteLeitura popupDesde={popupDesde}>
      <PainelPasto modelo={modeloDe()} permissoes={TODAS} dados={DADOS} manejos={<div data-testid="grade-manejos" />} {...props} />
    </LancLoteDialogo>,
  );
const clicar = (el) => act(async () => { fireEvent.click(el); });
const botao = (nome) => screen.getByRole("button", { name: nome });
const esc = () => act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" }); });
const tituloDoDialogo = () => document.querySelector(".mk-ll-dlg__titulo")?.textContent;
const subDoDialogo = () => document.querySelector(".mk-ll-dlg__lotes")?.textContent ?? null;

const original = window.matchMedia;
beforeEach(() => largura(1280));
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

describe("abas (D3)", () => {
  it("Detalhes · Lotes (badge) · Histórico · Suplementação; abre em Lotes", () => {
    montarPainel();
    const abas = screen.getAllByRole("tab");
    expect(abas.map((a) => a.textContent)).toEqual(["Detalhes", "Lotes 2", "Histórico", "Suplementação"]);
    expect(screen.getByRole("tab", { name: /Lotes/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("aba-lotes")).toBeTruthy();
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("desktop");
  });

  it("sem permissão a aba some; celular: \"Supl.\" e sem badge; sem lote, sem badge", () => {
    montarPainel({ permissoes: { ...TODAS, historico: false, supl: false } });
    expect(screen.getAllByRole("tab").map((a) => a.textContent)).toEqual(["Detalhes", "Lotes 2"]);
    cleanup();
    largura(390);
    montarPainel();
    expect(screen.getAllByRole("tab").map((a) => a.textContent)).toEqual(["Detalhes", "Lotes", "Histórico", "Supl."]);
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("celular");
    cleanup();
    largura(1280);
    render(<PainelPasto modelo={modeloDe([])} permissoes={TODAS} dados={DADOS} />);
    expect(screen.getByRole("tab", { name: "Lotes" }).querySelector(".mk-dp-aba__badge")).toBeNull();
  });

  it("aba inicial pedida; só a aba ativa monta; a troca anima na direção da aba", async () => {
    montarPainel({ abaInicial: "detalhes" });
    expect(screen.getByTestId("aba-detalhes")).toBeTruthy();
    expect(screen.queryByTestId("aba-lotes")).toBeNull();
    await clicar(screen.getByRole("tab", { name: "Histórico" }));
    expect(screen.getByTestId("aba-historico")).toBeTruthy();
    expect(screen.queryByTestId("aba-detalhes")).toBeNull();
    const corpo = document.querySelector(".mk-dp__corpo");
    expect(corpo?.getAttribute("role")).toBe("tabpanel");
    expect(corpo?.classList.contains("mk-dp-anim--aba-dir")).toBe(true);
    await clicar(screen.getByRole("tab", { name: "Detalhes" }));
    expect(document.querySelector(".mk-dp__corpo")?.classList.contains("mk-dp-anim--aba-esq")).toBe(true);
  });

  it("aba inicial sem permissão cai em Lotes", () => {
    montarPainel({ abaInicial: "historico", permissoes: { ...TODAS, historico: false } });
    expect(screen.getByRole("tab", { name: /Lotes/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("pilha e ‹ Voltar (sem diálogo: cabeçalho próprio)", () => {
  it("tela do lote, manejos e configurar tabela empilham; ‹ volta um nível; corpo lista nas duas últimas", async () => {
    montarPainel();
    expect(screen.getByRole("heading", { name: "Pasto 07" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();

    await clicar(botao("Abrir L-2026-008"));
    expect(screen.getByTestId("tela-lote").textContent).toBe("p8");
    expect(screen.getByRole("heading", { name: "L-2026-008" })).toBeTruthy();
    expect(screen.getByText("VACA · Pasto 07")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(document.querySelector(".mk-dp__corpo")?.classList.contains("mk-dp-anim--empurrar")).toBe(true);
    expect(document.querySelector(".mk-dp__corpo--cards")).not.toBeNull();

    await clicar(botao("Manejos"));
    expect(screen.getByRole("heading", { name: "Manejos e históricos" })).toBeTruthy();
    expect(screen.getByText("Lote L-2026-008")).toBeTruthy();
    expect(screen.getByTestId("grade-manejos")).toBeTruthy();
    expect(document.querySelector(".mk-dp__corpo--lista")).not.toBeNull();

    await clicar(botao("Voltar"));
    expect(screen.getByTestId("tela-lote")).toBeTruthy();
    expect(document.querySelector(".mk-dp__corpo")?.classList.contains("mk-dp-anim--voltar")).toBe(true);
    await clicar(botao("Voltar"));
    expect(screen.getByTestId("aba-lotes")).toBeTruthy();
    expect(screen.getByRole("tablist")).toBeTruthy();

    await clicar(botao("Configurar tabela"));
    expect(screen.getByRole("heading", { name: "Configurar tabela" })).toBeTruthy();
    expect(screen.getByTestId("tela-config")).toBeTruthy();
    expect(document.querySelector(".mk-dp__corpo--lista")).not.toBeNull();
    await clicar(botao("Voltar"));
    expect(screen.getByTestId("aba-lotes")).toBeTruthy();
  });

  it("Manejos vindo do pasto: sub é o nome do pasto", async () => {
    montarPainel();
    await clicar(botao("Manejos"));
    expect(screen.getByRole("heading", { name: "Manejos e históricos" })).toBeTruthy();
    expect(screen.getByText("Pasto 07")).toBeTruthy();
  });
});

describe("rodapé padrão (§E)", () => {
  const rodape = () => document.querySelector(".mk-dp__rodape");

  it("pasto: Mover lotes · Pesar · Manejos; tela do lote: Mover · Pesar · Manejos; manejos e configurar tabela: sem rodapé", async () => {
    montarPainel();
    expect(within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mover lotes", "Pesar", "Manejos"]);
    await clicar(botao("Abrir L-2026-014"));
    const doLote = within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button");
    expect(doLote.map((b) => b.textContent)).toEqual(["Mover", "Pesar", "Manejos"]);
    expect(doLote.every((b) => !b.hasAttribute("disabled"))).toBe(true);
    await clicar(botao("Manejos"));
    expect(rodape()?.childElementCount).toBe(0);
    await clicar(botao("Voltar"));
    await clicar(botao("Voltar"));
    await clicar(botao("Configurar tabela"));
    expect(rodape()?.childElementCount).toBe(0);
  });

  it("sem permissão a pílula some; sem lote as três ficam desabilitadas", () => {
    montarPainel({ permissoes: { ...TODAS, mover: false } });
    expect(within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button").map((b) => b.textContent)).toEqual(["Pesar", "Manejos"]);
    cleanup();
    montarPainel({ permissoes: { ...TODAS, pesar: false } });
    expect(within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mover lotes", "Manejos"]);
    cleanup();
    render(<PainelPasto modelo={modeloDe([])} permissoes={TODAS} dados={DADOS} />);
    const pilulas = within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button");
    expect(pilulas).toHaveLength(3);
    expect(pilulas.every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("Mover lotes e Pesar chamam as ações do DetalhesLote", async () => {
    const onMover = vi.fn();
    const onPesar = vi.fn();
    montarPainel({ onMover, onPesar });
    await clicar(botao("Mover lotes"));
    await clicar(botao("Pesar"));
    expect(onMover).toHaveBeenCalledTimes(1);
    expect(onPesar).toHaveBeenCalledTimes(1);
  });

  it("rodapé próprio de uma aba (useRodapeProprio + portal) esconde o padrão; ao sair, o padrão volta", async () => {
    montarPainel();
    await clicar(screen.getByRole("tab", { name: "Suplementação" }));
    const botoes = within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["Lançar"]);
    await clicar(screen.getByRole("tab", { name: /Lotes/ }));
    expect(within(/** @type {HTMLElement} */ (rodape())).getAllByRole("button").map((b) => b.textContent)).toEqual(["Mover lotes", "Pesar", "Manejos"]);
  });
});

describe("alvo dos manejos (D7): tela do lote › marcados › todos", () => {
  it("avisa só quando muda", async () => {
    const onAlvo = vi.fn();
    montarPainel({ onAlvo });
    expect(onAlvo).not.toHaveBeenCalled();
    await clicar(botao("Marcar L-2026-014"));
    expect(onAlvo).toHaveBeenLastCalledWith(["p14"]);
    await clicar(botao("Abrir L-2026-008"));
    expect(onAlvo).toHaveBeenLastCalledWith(["p8"]);
    await clicar(botao("Manejos"));
    expect(onAlvo).toHaveBeenCalledTimes(2); // manejos do lote: o mesmo alvo
    await clicar(botao("Voltar"));
    await clicar(botao("Voltar"));
    expect(onAlvo).toHaveBeenLastCalledWith(["p14"]);
    await clicar(botao("Marcar L-2026-008"));
    expect(onAlvo).toHaveBeenLastCalledWith(["p14", "p8"]);
    await clicar(botao("Marcar L-2026-014"));
    await clicar(botao("Marcar L-2026-008"));
    expect(onAlvo).toHaveBeenLastCalledWith(null);
  });
});

describe("no LancLoteDialogo: cabeçalho publicado, ‹ e Esc (D2, D10)", () => {
  it("raiz usa o título e o sub do diálogo; telas empilhadas publicam o seu, com ‹ antes do título e ✕ à direita", async () => {
    montarNoDialogo();
    expect(document.querySelector(".mk-ll-dlg")?.classList.contains("is-desktop")).toBe(true);
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    expect(tituloDoDialogo()).toBe("Pasto 07");
    expect(subDoDialogo()).toBe("Retiro");
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();

    await clicar(botao("Abrir L-2026-008"));
    expect(tituloDoDialogo()).toBe("L-2026-008");
    expect(subDoDialogo()).toBe("VACA · Pasto 07");
    const voltar = botao("Voltar");
    expect(voltar.className).toContain("mk-ll-dlg__voltar");
    expect(voltar.nextElementSibling?.classList.contains("mk-ll-dlg__txt")).toBe(true);
    expect(botao("Fechar")).toBeTruthy();

    await clicar(botao("Manejos"));
    expect(tituloDoDialogo()).toBe("Manejos e históricos");
    expect(subDoDialogo()).toBe("Lote L-2026-008");

    await clicar(botao("Voltar"));
    await clicar(botao("Voltar"));
    expect(tituloDoDialogo()).toBe("Pasto 07");
    expect(subDoDialogo()).toBe("Retiro");

    await clicar(botao("Configurar tabela"));
    expect(tituloDoDialogo()).toBe("Configurar tabela");
    expect(subDoDialogo()).toBeNull();
    expect(document.querySelector(".mk-ll-dlg__txt .sr-only")?.textContent).toBe("Configurar tabela");
  });

  it("popup: Esc numa tela empilhada volta um nível; na raiz não fecha (só pelo ✕)", async () => {
    const onOpenChange = vi.fn();
    montarNoDialogo({ onOpenChange });
    await clicar(botao("Abrir L-2026-014"));
    await clicar(botao("Manejos"));
    await esc();
    expect(tituloDoDialogo()).toBe("L-2026-014");
    await esc();
    expect(tituloDoDialogo()).toBe("Pasto 07");
    expect(screen.getByRole("tablist")).toBeTruthy();
    await esc();
    expect(onOpenChange).not.toHaveBeenCalled();
    await clicar(botao("Fechar"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("celular (tela cheia): ‹ no lugar do ✕ nas empilhadas; Esc volta; Esc na raiz fecha", async () => {
    largura(390);
    const onOpenChange = vi.fn();
    montarNoDialogo({ onOpenChange });
    expect(document.querySelector(".mk-ll-dlg")?.classList.contains("is-tela")).toBe(true);
    expect(botao("Fechar").closest(".mk-ll-dlg__head")).not.toBeNull();
    await clicar(botao("Abrir L-2026-008"));
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
    expect(botao("Voltar").classList.contains("mk-ll-dlg__redondo")).toBe(true);
    await esc();
    expect(tituloDoDialogo()).toBe("Pasto 07");
    expect(onOpenChange).not.toHaveBeenCalled();
    await esc();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("LancLoteDialogo: popupDesde (D1)", () => {
  it("tablet: popup com popupDesde=\"tablet\"; sem a prop, tela cheia como antes", () => {
    largura(820);
    montarNoDialogo();
    expect(document.querySelector(".mk-ll-dlg")?.classList.contains("is-desktop")).toBe(true);
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("tablet");
    expect(botao("Fechar").closest(".mk-ll-dlg__acoes")).not.toBeNull();
    cleanup();
    render(
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Pasto 07" lotes={[{ nome: "Retiro" }]} largo somenteLeitura>
        <PainelPasto modelo={modeloDe()} permissoes={TODAS} dados={DADOS} />
      </LancLoteDialogo>,
    );
    expect(document.querySelector(".mk-ll-dlg")?.classList.contains("is-tela")).toBe(true);
    expect(botao("Fechar").closest(".mk-ll-dlg__acoes")).toBeNull();
  });

  it("sem cabeçalho publicado o diálogo é o de sempre: título e lotes dos props", () => {
    render(
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Histórico de Movimentação" lotes={[{ nome: "L-1" }, { nome: "L-2" }]} somenteLeitura>
        <p>conteúdo</p>
      </LancLoteDialogo>,
    );
    expect(tituloDoDialogo()).toBe("Histórico de Movimentação");
    expect(subDoDialogo()).toBe("L-1 · L-2");
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
  });
});

describe("DetalhesLote: os manejos levam o alvo da casca (lotes do manejo)", () => {
  const GRUPOS = [posicao("p1", "GRUPO 1", "BOI", 10), posicao("p2", "GRUPO 2", "BOI", 12), posicao("p3", "GRUPO 3", "VACA", 8)];
  const renderizar = async (permissions = {}) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DetalhesLote lotes={GRUPOS} onClose={() => {}} permissions={permissions} setorNome="Retiro" />
      </QueryClientProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  };

  it("sem marcação, Mover lotes leva o pasto inteiro", async () => {
    await renderizar();
    await clicar(botao("Mover lotes"));
    expect(screen.getByTestId("form-mover").textContent).toBe("GRUPO 1,GRUPO 2,GRUPO 3");
  });

  it("marcados: Mover lotes e Pesar levam só os marcados", async () => {
    await renderizar();
    await clicar(botao("Marcar GRUPO 2"));
    await clicar(botao("Marcar GRUPO 3"));
    await clicar(botao("Pesar"));
    expect(screen.getByTestId("form-pesagem").textContent).toBe("GRUPO 2,GRUPO 3");
  });

  it("tela do lote: Mover e o quadro de Manejos levam só aquele lote", async () => {
    await renderizar();
    await clicar(botao("Marcar GRUPO 1"));
    await clicar(botao("Abrir GRUPO 3"));
    await clicar(botao("Manejos"));
    expect(screen.getByRole("heading", { name: "Manejos e históricos" })).toBeTruthy();
    expect(screen.getByText("Lote GRUPO 3")).toBeTruthy();
    await clicar(botao("Morte"));
    expect(screen.getByTestId("form-morte").textContent).toBe("GRUPO 3");
  });

  it("subtítulo do pasto e permissões da casca vêm do DetalhesLote", async () => {
    await renderizar({ visualizar_historico_movimentacoes_lote: false, mover_lotes: false });
    expect(screen.getByText("Retiro")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Histórico" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mover lotes" })).toBeNull();
    expect(botao("Pesar")).toBeTruthy();
  });
});
