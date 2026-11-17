/**
 * D-PROD-218 (número definitivo no PR) — aba Suplementação do Detalhes do Lote
 * v12 (`AbaSuplementacao` + `AcoesCochoPasto`), renderizada numa CASCA DE TESTE
 * (a casca real, `PainelPasto`, chega na integração): `PastoCtx.Provider` com
 * o valor completo, `div.mk-dp` com `Abas`, corpo e o rodapé com o slot.
 *
 *  AS-1. um cocho: KPIs, Fornecimento, Consumo e "Cochos do pasto" com os
 *        números reais; ícone do marcador e farol; rodapé próprio no slot
 *        (Lançar · Leitura · Histórico) no lugar do padrão;
 *  AS-2. dois cochos: títulos com o nome do primeiro e a lista por nome;
 *  AS-3. nenhum cocho (ou sem dados): vazio e rodapé padrão;
 *  AS-4. rodapé por permissão (lancarSupl; historicoCocho; nenhuma → padrão);
 *  AS-5. toque no cocho abre o detalhe do cocho só com detalhesCocho;
 *  AS-6. Lançar / Leitura / Histórico abrem os MESMOS formulários e histórico
 *        do detalhe do cocho, com o mesmo refresh depois de salvar;
 *  AS-7. sair da aba devolve o rodapé padrão (o rodapé próprio se desregistra).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const espiao = vi.hoisted(() => ({
  lancamento: /** @type {any[]} */ ([]),
  leitura: /** @type {any[]} */ ([]),
  historico: /** @type {any[]} */ ([]),
  leiturasDoCache: /** @type {any[]} */ ([]),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async () => espiao.leiturasDoCache),
  refreshMapaCacheEntry: vi.fn(async () => []),
  updateMapaCachedData: vi.fn(async () => []),
}));

vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
// O SVG real do cocho tem parênteses que o CSS do jsdom recusa em `url(...)`; o
// desenho é conferido no teste puro e na captura — aqui, só QUAL ícone (nível e moldura).
vi.mock("@/assets/icones/cocho-descoberto", () => ({
  urlIconeCocho: (fracao, marcador) => `data:image/svg+xml,cocho-${fracao}-${marcador ? "marcador" : "subicone"}`,
}));
vi.mock("@/components/suplementacao/FormularioLancamentoSuplementacao", async () => {
  const { createElement } = await import("react");
  return {
    default: (props) => {
      espiao.lancamento.push(props);
      return createElement(
        "div",
        { "data-testid": "form-lancamento", "data-ponto": props.ponto?.id, "data-compartilhado": String(props.cicloCompartilhado) },
        createElement("button", { type: "button", onClick: props.onCancel }, "Sair do lançamento"),
      );
    },
  };
});
vi.mock("@/components/suplementacao/FormularioLeituraCocho", async () => {
  const { createElement } = await import("react");
  return {
    default: (props) => {
      espiao.leitura.push(props);
      return createElement(
        "div",
        { "data-testid": "form-leitura", "data-ponto": props.ponto?.id, "data-hoje": props.hoje },
        createElement("button", { type: "button", onClick: props.onCancel }, "Desistir da leitura"),
        createElement("button", { type: "button", onClick: () => props.onSaved?.({ id: "nova" }) }, "Gravar leitura"),
      );
    },
  };
});
vi.mock("@/components/suplementacao/HistoricoSuplementacaoPonto", async () => {
  const { createElement } = await import("react");
  return {
    default: (props) => {
      espiao.historico.push(props);
      return createElement("div", { "data-testid": "historico-ponto", "data-ponto": props.pontoId, "data-nome": props.pontoNome });
    },
  };
});

const { default: AbaSuplementacao } = await import("@/components/mapa/detalhes-lote/AbaSuplementacao");
const { PastoCtx } = await import("@/components/mapa/detalhes-lote/pastoContexto");
const { Abas, RodapePilulas, idsDaAba } = await import("@/components/mapa/detalhes-lote/blocos");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");
const { AREA, HOJE, cocho, exemploV12, lancamento, leitura } = await import("./fixtures/suplementacaoPasto");

const AREA_V12 = { id: AREA, nome: "Pasto 07", setor_nome: "Retiro", tipo_cultura: "Pastagem", tipo_pastagem: "Braquiária Brizantha", tamanho_hectares: 109.3 };
const LOTES_V12 = [
  { id: "d", nome: "L-2026-008", quantidade_cabecas: 38, peso_medio_kg: 449.5, categoria: "VACA", sexo: "Fêmea", area_atual_id: AREA, data_entrada: "2026-09-20" },
  { id: "a", nome: "L-2026-014", quantidade_cabecas: 86, peso_medio_kg: 382.5, categoria: "BOI MAGRO", sexo: "Macho", area_atual_id: AREA, data_entrada: "2026-10-12" },
];
const MODELO = montarModeloDetalhes({ area: AREA_V12, lotes: LOTES_V12, hoje: new Date(2026, 10, 15) });

const TODAS = Object.freeze({ mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true });
const noop = () => {};

/**
 * Casca de teste: o mesmo desenho da casca real (`div.mk-dp` › Abas › corpo ›
 * rodapé com o slot), com o rodapé padrão escondido enquanto houver rodapé próprio.
 */
function CascaDeTeste({ dados, permissoes, children }) {
  const [slot, setSlot] = React.useState(/** @type {HTMLElement | null} */ (null));
  const [proprios, setProprios] = React.useState(0);
  const marcarRodapeProprio = React.useCallback((delta) => setProprios((n) => n + delta), []);
  const selecao = React.useMemo(() => new Set(), []);
  const valor = React.useMemo(
    () => ({
      modo: /** @type {"desktop"} */ ("desktop"),
      modelo: MODELO,
      dados,
      permissoes,
      escopoPreferencias: null,
      empurrar: noop,
      voltar: noop,
      selecao,
      alternarSelecao: noop,
      definirSelecao: noop,
      slotRodape: slot,
      marcarRodapeProprio,
    }),
    [dados, permissoes, selecao, slot, marcarRodapeProprio],
  );
  const ids = idsDaAba("pasto", "supl");
  return (
    <PastoCtx.Provider value={valor}>
      <div className="mk-dp" data-modo="desktop">
        <Abas
          abas={[
            { id: "detalhes", rotulo: "Detalhes" },
            { id: "lotes", rotulo: "Lotes", ...(MODELO.lotes.length ? { badge: MODELO.lotes.length } : {}) },
            { id: "historico", rotulo: "Histórico" },
            { id: "supl", rotulo: "Suplementação" },
          ]}
          ativa="supl"
          onMudar={noop}
          idBase="pasto"
        />
        <div className="mk-dp__corpo mk-dp__corpo--cards" role="tabpanel" id={ids.painel} aria-labelledby={ids.aba}>
          {children}
        </div>
        <div className="mk-dp__rodape" data-testid="rodape">
          <div ref={setSlot} data-testid="slot-rodape" />
          {proprios > 0 ? null : (
            <RodapePilulas
              rotulo="Ações do pasto"
              itens={[
                { rotulo: "Mover lotes", onClick: noop },
                { rotulo: "Pesar", onClick: noop },
                { rotulo: "Manejos", onClick: noop },
              ]}
            />
          )}
        </div>
      </div>
    </PastoCtx.Provider>
  );
}

/** @type {QueryClient} */
let qc;
/** @type {any[]} */
let eventosMapa;
const ouvirMapa = (e) => eventosMapa.push(e);

beforeEach(() => {
  espiao.lancamento.length = 0;
  espiao.leitura.length = 0;
  espiao.historico.length = 0;
  espiao.leiturasDoCache = [];
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  eventosMapa = [];
  window.addEventListener("atualizar-mapa", ouvirMapa);
});

afterEach(() => {
  window.removeEventListener("atualizar-mapa", ouvirMapa);
  cleanup();
});

/**
 * @param {{ suplementacao?: any, permissoes?: Partial<typeof TODAS>, onAbrirCocho?: any }} [p]
 */
const renderizar = ({ suplementacao = exemploV12(), permissoes = {}, onAbrirCocho = vi.fn() } = {}) => {
  const dados = {
    areaId: AREA,
    areaNome: "Pasto 07",
    setorNome: "Retiro",
    lotesDoPasto: LOTES_V12,
    movimentacoes: [],
    empresaId: "emp-1",
    suplementacao: suplementacao ? { pontos: suplementacao.pontos, eventos: suplementacao.eventos, hoje: suplementacao.hoje } : null,
    onAbrirCocho,
  };
  const r = render(
    <QueryClientProvider client={qc}>
      <CascaDeTeste dados={dados} permissoes={{ ...TODAS, ...permissoes }}>
        <AbaSuplementacao />
      </CascaDeTeste>
    </QueryClientProvider>,
  );
  return { ...r, onAbrirCocho };
};

const corpo = () => screen.getByRole("tabpanel");
const slot = () => screen.getByTestId("slot-rodape");
const titulos = () => within(corpo()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
/** Valor (dd) da célula/KPI pelo rótulo (dt). */
const valorDe = (rotulo) => within(corpo()).getByText(rotulo, { selector: "dt" }).nextElementSibling;

describe("AS-1 — um cocho", () => {
  it("KPIs, Fornecimento e Consumo com os números reais do primeiro cocho", () => {
    renderizar();
    expect(titulos()).toEqual(["Fornecimento", "Consumo esperado / real", "Cochos do pasto"]);
    expect(valorDe("Por cabeça (g/cab/dia)").textContent).toBe("75");
    expect(valorDe("Por cabeça (g/cab/dia)").nextElementSibling.textContent).toBe("esperado 75 g");
    expect(valorDe("Desvio da meta (%)").textContent).toBe("-0,6");
    const nota = valorDe("Desvio da meta (%)").nextElementSibling;
    expect(nota.textContent).toBe("dentro de ±20%");
    expect(nota.getAttribute("style")).toMatch(/rgb\(22, 163, 74\)|#16a34a/i);
    expect(valorDe("Produto").textContent).toBe("SAL MINERAL 80");
    expect(valorDe("Total fornecido (kg)").textContent).toBe("400,00");
    expect(valorDe("Total consumido (kg)").textContent).toBe("140,40");
    expect(valorDe("Sobra (resta) (kg)").textContent).toBe("259,60");
    expect(valorDe("Consumo do pasto (kg/dia)").textContent).toBe("23,40");
    expect(valorDe("Esperado/cab/dia (kg)").textContent).toBe("0,075");
    expect(valorDe("Realizado/cab/dia (kg)").textContent).toBe("0,075");
    const pv = valorDe("%PV real × esperado");
    expect(pv.textContent).toBe("0,034% × 0,035%");
    expect(pv.querySelector(".mk-dp-bolinha")?.getAttribute("style")).toMatch(/rgb\(22, 163, 74\)|#16a34a/i);
  });

  it("item do cocho: ícone do marcador com o nível, linha do saldo, produto e farol da leitura", () => {
    renderizar();
    const lista = within(corpo()).getByRole("list", { name: "Cochos do pasto" });
    const itens = within(lista).getAllByRole("listitem");
    expect(itens).toHaveLength(1);
    const item = itens[0];
    expect(item.querySelector(".mk-dp-item__nome").textContent).toBe("Cocho 07");
    expect(item.querySelector(".mk-dp-item__meta").textContent).toBe("65% · restam 260 kg");
    expect(item.querySelector(".mk-dp-item__sub").textContent).toBe("SAL MINERAL 80 · Leitura: Cocho adequado");
    expect(item.querySelector(".mk-dp-item__sub .sr-only").textContent).toBe(" · Leitura: Cocho adequado");
    const img = /** @type {HTMLElement} */ (item.querySelector(".mk-dp-item__img"));
    expect(img.style.backgroundImage).toBe('url("data:image/svg+xml,cocho-0.65-marcador")');
    expect(item.querySelector(".mk-dp-bolinha--g")?.getAttribute("style")).toMatch(/rgb\(22, 163, 74\)|#16a34a/i);
    expect(item.querySelector(".mk-dp-chev")).not.toBeNull();
  });

  it("rodapé próprio no slot (Lançar · Leitura · Histórico) e o padrão escondido; formulários só ao abrir", () => {
    renderizar();
    const pilulas = within(slot()).getAllByRole("button").map((b) => b.textContent);
    expect(pilulas).toEqual(["Lançar", "Leitura", "Histórico"]);
    expect(within(slot()).getByRole("group", { name: "Ações do cocho" })).toBeTruthy();
    expect(within(slot()).getByRole("button", { name: "Lançar" }).getAttribute("title")).toBe("Lançar suplementação: Cocho 07");
    expect(screen.queryByRole("button", { name: "Mover lotes" })).toBeNull();
    expect(screen.queryByTestId("form-lancamento")).toBeNull();
    expect(screen.queryByTestId("form-leitura")).toBeNull();
    expect(screen.queryByTestId("historico-ponto")).toBeNull();
  });
});

describe("AS-2 — dois cochos", () => {
  it("títulos com o nome do cocho dos números (o primeiro por nome) e a lista por nome", () => {
    const supl = exemploV12({
      pontos: [cocho("k09", "Cocho 09", { produto_padrao: "CREEP 22" })],
      eventos: [lancamento("e-k09", "k09", { produto: "CREEP 22", produto_id: "p-creep", quantidade_total_kg: 150, consumo_esperado_pv_kg: 6, data_lancamento: "2026-11-10" })],
      leituras: [leitura("l-k09", "k09", "2026-11-14", "CHEIO")],
    });
    // A ordem do cache não importa: o primeiro é o primeiro por nome.
    supl.pontos.reverse();
    renderizar({ suplementacao: supl });
    expect(titulos()).toEqual(["Fornecimento · Cocho 07", "Consumo esperado / real · Cocho 07", "Cochos do pasto"]);
    const nomes = [...corpo().querySelectorAll(".mk-dp-item__nome")].map((n) => n.textContent);
    expect(nomes).toEqual(["Cocho 07", "Cocho 09"]);
    expect(valorDe("Produto").textContent).toBe("SAL MINERAL 80");
    expect(within(slot()).getByRole("button", { name: "Histórico" }).getAttribute("title")).toBe("Histórico de Suplementação: Cocho 07");
  });
});

describe("AS-3 — nenhum cocho", () => {
  it("vazio 'Nenhum cocho neste pasto.' e o rodapé padrão do pasto", () => {
    const supl = exemploV12();
    renderizar({ suplementacao: { ...supl, pontos: supl.pontos.map((p) => ({ ...p, area_vinculada_ids: ["a-p01"], area_vinculada_id: "a-p01" })) } });
    expect(within(corpo()).getByText("Nenhum cocho neste pasto.")).toBeTruthy();
    expect(corpo().querySelector(".mk-dp-vazio svg")).not.toBeNull();
    expect(within(corpo()).queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mover lotes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lançar" })).toBeNull();
    expect(slot().childElementCount).toBe(0);
  });

  it("sem dados de suplementação (DetalhesLote sem a prop): o mesmo vazio", () => {
    renderizar({ suplementacao: null });
    expect(within(corpo()).getByText("Nenhum cocho neste pasto.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pesar" })).toBeTruthy();
  });
});

describe("AS-4 — rodapé por permissão", () => {
  it("sem lancarSupl: só Histórico; sem historicoCocho: Lançar e Leitura", () => {
    renderizar({ permissoes: { lancarSupl: false } });
    expect(within(slot()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Histórico"]);
    cleanup();
    renderizar({ permissoes: { historicoCocho: false } });
    expect(within(slot()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançar", "Leitura"]);
  });

  it("sem nenhuma das duas: fica o rodapé padrão (a aba continua mostrando os números)", () => {
    renderizar({ permissoes: { lancarSupl: false, historicoCocho: false } });
    expect(slot().childElementCount).toBe(0);
    expect(screen.getByRole("button", { name: "Mover lotes" })).toBeTruthy();
    expect(valorDe("Total fornecido (kg)").textContent).toBe("400,00");
  });
});

describe("AS-5 — toque no cocho", () => {
  it("com detalhesCocho abre o detalhe do cocho que já existe, com o ponto decorado", () => {
    const supl = exemploV12();
    const { onAbrirCocho } = renderizar({ suplementacao: supl });
    const item = within(corpo()).getAllByRole("listitem")[0];
    fireEvent.click(within(item).getByRole("button"));
    expect(onAbrirCocho).toHaveBeenCalledTimes(1);
    expect(onAbrirCocho).toHaveBeenCalledWith(supl.pontos[0]);
    expect(onAbrirCocho.mock.calls[0][0].nivel_suplementacao.rotuloCurto).toBe("65%");
  });

  it("sem detalhesCocho (ou sem onAbrirCocho) o item não abre nada nem mostra o chevron", () => {
    const { onAbrirCocho } = renderizar({ permissoes: { detalhesCocho: false } });
    const item = within(corpo()).getAllByRole("listitem")[0];
    expect(within(item).queryByRole("button")).toBeNull();
    expect(item.querySelector(".mk-dp-chev")).toBeNull();
    fireEvent.click(item);
    expect(onAbrirCocho).not.toHaveBeenCalled();
    cleanup();
    renderizar({ onAbrirCocho: null });
    expect(within(within(corpo()).getAllByRole("listitem")[0]).queryByRole("button")).toBeNull();
  });
});

describe("AS-6 — mesmos formulários e histórico do detalhe do cocho", () => {
  it("Lançar: FormularioLancamentoSuplementacao do 1º cocho; ao sair invalida as consultas e atualiza o mapa", async () => {
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    renderizar();
    fireEvent.click(within(slot()).getByRole("button", { name: "Lançar" }));
    // D-PROD-221: o LancLoteDialogo do lançamento de manejo — título = a ação, subtítulo = o cocho, largo.
    const dialogo = await screen.findByRole("dialog", { name: "Lançar Suplementação", description: "Cocho 07" });
    const form = within(dialogo).getByTestId("form-lancamento");
    expect(form.getAttribute("data-ponto")).toBe("k07");
    expect(form.getAttribute("data-compartilhado")).toBe("false");
    expect(dialogo.className).toContain("mk-ll-dlg");
    expect(dialogo.className).toContain("mk-ll-dlg--largo");
    expect(dialogo.querySelector(".mk-ll-dlg__titulo")?.textContent).toBe("Lançar Suplementação");
    expect(dialogo.querySelector(".mk-ll-dlg__lotes")?.textContent).toBe("Cocho 07");
    expect(eventosMapa).toHaveLength(0);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Sair do lançamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Lançar Suplementação" })).toBeNull());
    expect(eventosMapa).toHaveLength(1);
    expect(eventosMapa[0].detail).toBeNull();
    expect(invalidar).toHaveBeenCalledTimes(1);
    const { predicate } = invalidar.mock.calls[0][0];
    expect(predicate({ queryKey: ["mapa-eventos-supl"] })).toBe(true);
    expect(predicate({ queryKey: ["pontos-suplementacao", "emp-1"] })).toBe(true);
    expect(predicate({ queryKey: ["lotes"] })).toBe(false);
  });

  it("cocho compartilhado: o formulário recebe cicloCompartilhado (D-PROD-206)", async () => {
    const supl = exemploV12();
    supl.pontos[0] = { ...supl.pontos[0], nivel_suplementacao: { ...supl.pontos[0].nivel_suplementacao, confiabilidade: "compartilhada" } };
    renderizar({ suplementacao: supl });
    fireEvent.click(within(slot()).getByRole("button", { name: "Lançar" }));
    expect((await screen.findByTestId("form-lancamento")).getAttribute("data-compartilhado")).toBe("true");
  });

  it("Leitura: 'Leitura de Cocho' com o dia da fazenda; depois de gravar relê o cache de leituras e atualiza o farol", async () => {
    espiao.leiturasDoCache = [leitura("l-nova", "k07", HOJE, "CHEIO")];
    const gravar = vi.spyOn(qc, "setQueryData");
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    renderizar();
    fireEvent.click(within(slot()).getByRole("button", { name: "Leitura" }));
    const dialogo = await screen.findByRole("dialog", { name: "Leitura de Cocho" });
    const form = within(dialogo).getByTestId("form-leitura");
    expect(form.getAttribute("data-ponto")).toBe("k07");
    expect(form.getAttribute("data-hoje")).toBe(HOJE);

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Gravar leitura" }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Leitura de Cocho" })).toBeNull());
    expect(cache.getMapaCachedData).toHaveBeenCalledWith("leiturasCocho", "emp-1");
    expect(gravar).toHaveBeenCalledWith(["mapa-cache", "leiturasCocho", "emp-1", "default"], espiao.leiturasDoCache);
    const { predicate } = invalidar.mock.calls.at(-1)[0];
    expect(predicate({ queryKey: ["mapa-cache", "leiturasCocho", "emp-1", "default"] })).toBe(true);
    expect(predicate({ queryKey: ["mapa-cache", "eventosSuplementacao", "emp-1", "default"] })).toBe(false);
    expect(eventosMapa).toHaveLength(1);
    expect(eventosMapa[0].detail).toEqual({ cacheKeys: ["leiturasCocho"] });
  });

  it("Leitura: desistir só fecha (nada é relido)", async () => {
    renderizar();
    fireEvent.click(within(slot()).getByRole("button", { name: "Leitura" }));
    const dialogo = await screen.findByRole("dialog", { name: "Leitura de Cocho" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Desistir da leitura" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Leitura de Cocho" })).toBeNull());
    expect(cache.getMapaCachedData).not.toHaveBeenCalled();
    expect(eventosMapa).toHaveLength(0);
  });

  it("Histórico: 'Histórico de Suplementação' (só leitura) com o cocho e o nível do SSOT", async () => {
    const supl = exemploV12();
    renderizar({ suplementacao: supl });
    fireEvent.click(within(slot()).getByRole("button", { name: "Histórico" }));
    const dialogo = await screen.findByRole("dialog", { name: "Histórico de Suplementação" });
    const hist = within(dialogo).getByTestId("historico-ponto");
    expect(hist.getAttribute("data-ponto")).toBe("k07");
    expect(hist.getAttribute("data-nome")).toBe("Cocho 07");
    const props = espiao.historico.at(-1);
    expect(props.ponto.id).toBe("k07");
    expect(props.nivel).toBe(supl.pontos[0].nivel_suplementacao);
    // Só leitura: sem ✓ de salvar no cabeçalho.
    expect(within(dialogo).queryByRole("button", { name: /Salvar/ })).toBeNull();
  });
});

describe("AS-7 — troca de aba", () => {
  it("ao sair da aba o rodapé próprio some e o padrão volta; ao voltar, o do cocho de novo", () => {
    const dados = {
      areaId: AREA,
      areaNome: "Pasto 07",
      setorNome: "Retiro",
      lotesDoPasto: LOTES_V12,
      movimentacoes: [],
      empresaId: "emp-1",
      suplementacao: exemploV12(),
      onAbrirCocho: vi.fn(),
    };
    function ComTroca() {
      const [naAba, setNaAba] = React.useState(true);
      return (
        <QueryClientProvider client={qc}>
          <button type="button" onClick={() => setNaAba((v) => !v)}>
            trocar
          </button>
          <CascaDeTeste dados={dados} permissoes={TODAS}>
            {naAba ? <AbaSuplementacao /> : <p>outra aba</p>}
          </CascaDeTeste>
        </QueryClientProvider>
      );
    }
    render(<ComTroca />);
    expect(within(slot()).getByRole("button", { name: "Lançar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mover lotes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "trocar" }));
    expect(slot().childElementCount).toBe(0);
    expect(screen.getByRole("button", { name: "Mover lotes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "trocar" }));
    expect(within(slot()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Lançar", "Leitura", "Histórico"]);
    expect(screen.queryByRole("button", { name: "Mover lotes" })).toBeNull();
  });
});
