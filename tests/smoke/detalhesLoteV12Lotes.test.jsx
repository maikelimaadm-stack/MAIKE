// @vitest-environment jsdom
/**
 * Detalhes do Lote v12 (D-PROD-218) — abas Detalhes e Lotes, tela do lote e
 * "Configurar tabela", com os componentes REAIS dentro de uma casca de teste
 * (mesmo contrato do `PainelPasto`: `PastoCtx` completo, `.mk-dp`, abas, corpo e
 * o rodapé que serve de `slotRodape`). Dados do v12: Pasto 07, Retiro, 6 lotes.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { CascaDeTeste, modeloV12, movimentacoesV12, AREA_V12 } from "./fixtures/pastoV12.jsx";
import { esquecerEstadoLotes } from "@/components/mapa/detalhes-lote/useEstadoLotes";
import { urlSubiconeLote } from "@/assets/icones/lotes";

const clicar = (el) => act(async () => { fireEvent.click(el); });
const vistaAtiva = () => ["Resumo", "Lote", "Lista"].find((v) => screen.getByRole("button", { name: v, exact: true }).getAttribute("aria-pressed") === "true");
/** Textos das células de cabeçalho da tabela (sem a seta). */
const cabecalhos = () => screen.getAllByRole("columnheader").filter((th) => th.querySelector("button")).map((th) => th.querySelector("button span").textContent);
/** Nomes dos lotes na ordem das linhas da tabela. */
const nomesNaTabela = () => screen.getAllByRole("rowheader").map((c) => c.querySelector("strong")?.textContent).filter(Boolean);
/** Células (nome + valores) de uma linha da tabela. @param {HTMLElement} linha */
const celulasDa = (linha) => [...linha.querySelectorAll('[role="rowheader"], [role="cell"]')];
/** Célula da tabela na linha do lote e na coluna do rótulo. */
const celula = (lote, rotulo) => {
  const ths = screen.getAllByRole("columnheader").filter((th) => th.querySelector("button"));
  const i = ths.findIndex((th) => th.querySelector("button span").textContent === rotulo);
  const linha = screen.getAllByRole("row").find((r) => within(r).queryByText(lote, { selector: "strong" }));
  return celulasDa(/** @type {HTMLElement} */ (linha))[i];
};
/** Rótulo → valor das células de uma grade. @param {HTMLElement} raiz */
const grade = (raiz) => Object.fromEntries([...raiz.querySelectorAll(".mk-dp-cel")].map((c) => [c.querySelector("dt").textContent, c.querySelector(".mk-dp-cel__val").textContent]));

beforeEach(() => {
  esquecerEstadoLotes();
  window.localStorage.clear();
});
afterEach(() => cleanup());

// ── Aba Detalhes ────────────────────────────────────────────────────────────

describe("aba Detalhes", () => {
  it("cartão da área, aviso de capacidade, Lotação e Categorias com os números do v12", () => {
    render(<CascaDeTeste modelo={modeloV12()} abaInicial="detalhes" />);
    const painel = screen.getByRole("tabpanel");
    const [cartaoArea, cartaoLotacao, cartaoCategorias] = painel.querySelectorAll(".mk-dp-cartao");

    expect(within(cartaoArea).getByText("Pasto 07")).toBeTruthy();
    expect(within(cartaoArea).getByText("Pastagem / Braquiária Brizantha")).toBeTruthy();
    expect(cartaoArea.querySelector("svg.mk-dp-cartao__ic")).toBeTruthy(); // broto
    expect(grade(cartaoArea)).toEqual({
      "Área (ha)": "109,30",
      "Área pastejada (ha)": "102,70",
      Status: "OCUPADO",
      "Dias pastejo": "26",
    });

    expect(painel.querySelector(".mk-dp-aviso--atencao").textContent).toBe("Lotação de 2,24 UA/ha acima da capacidade cadastrada (2,20 UA/ha).");

    expect(grade(cartaoLotacao)).toEqual({
      "Qtd. Lotes": "6",
      "Qtd. Cabeças": "314",
      "UA total": "230,09",
      "UA/ha": "2,24",
      "Capacidade (UA/ha)": "2,20",
      "% da capacidade": "102%",
      "kg PV/ha": "1.008",
      "Cab/ha": "3,06",
      "Peso médio geral (kg)": "329,75",
    });
    const ua = [...cartaoLotacao.querySelectorAll(".mk-dp-cel")].find((c) => c.querySelector("dt").textContent === "UA/ha");
    expect(ua.querySelector(".mk-dp-bolinha").style.background).toBe("rgb(245, 158, 11)"); // faixa Alta
    expect(ua.querySelector(".mk-dp-cel__sub").textContent).toBe("Alta (1,8 - 2,4 UA/ha)");
    const cap = [...cartaoLotacao.querySelectorAll(".mk-dp-cel")].find((c) => c.querySelector("dt").textContent === "% da capacidade");
    expect(cap.querySelector(".mk-dp-cel__val").style.color).toBe("rgb(180, 83, 9)");
    expect(cap.querySelector(".mk-dp-cel__barra > span").style.background).toBe("rgb(245, 158, 11)");

    expect(screen.getByRole("heading", { name: "Categorias" })).toBeTruthy();
    const linhas = [...cartaoCategorias.querySelectorAll(".mk-dp-linha")].map((l) => [
      l.querySelector(".mk-dp-linha__rot").textContent,
      l.querySelector(".mk-dp-linha__sub").textContent,
      l.querySelector(".mk-dp-linha__val").textContent,
    ]);
    expect(linhas).toEqual([
      ["BEZERRO", "20% do pasto · peso 196 kg", "62 cab"],
      ["BOI MAGRO", "40% do pasto · peso 377 kg", "127 cab"],
      ["NOVILHA", "28% do pasto · peso 304 kg", "87 cab"],
      ["VACA", "12% do pasto · peso 450 kg", "38 cab"],
    ]);
    // Subícone do código (D-PROD-191), 26 px na densidade compacta (D-PROD-224).
    const imgs = [...cartaoCategorias.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(imgs).toEqual(["macho-0-8", "macho-25-36", "femea-13-24", "femea-37-mais"].map((f) => urlSubiconeLote(f, 26)));
  });

  it("pasto vazio: VAZIO · descanso desde a última saída (mesma regra do mapa), Sem gado e o aviso de nenhum lote", () => {
    const modelo = modeloV12({ qtd: 0 });
    const movs = movimentacoesV12({ qtd: 0, saidaEm: "2026-10-25" });
    render(<CascaDeTeste modelo={modelo} abaInicial="detalhes" movimentacoes={movs} setorNome="" />);
    const painel = screen.getByRole("tabpanel");
    const [cartaoArea, cartaoLotacao] = painel.querySelectorAll(".mk-dp-cartao");
    const area = grade(cartaoArea);
    expect(area.Setor).toBeUndefined();
    expect(area.Status).toBe("VAZIO · descanso há 21 dias");
    expect(area["Dias pastejo"]).toBe("—");
    const status = [...cartaoArea.querySelectorAll(".mk-dp-cel")].find((c) => c.querySelector("dt").textContent === "Status");
    expect(status.querySelector(".mk-dp-cel__val").style.color).toBe("rgb(100, 116, 139)");

    const lot = grade(cartaoLotacao);
    expect(lot).toMatchObject({ "Qtd. Lotes": "0", "Qtd. Cabeças": "0", "UA total": "0,00", "UA/ha": "—", "% da capacidade": "—", "kg PV/ha": "—", "Cab/ha": "—", "Peso médio geral (kg)": "—" });
    expect(cartaoLotacao.textContent).toContain("Sem gado");
    expect(painel.querySelector(".mk-dp-aviso")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Categorias" })).toBeNull();
    expect(painel.querySelector(".mk-dp-vazio").textContent).toBe("Nenhum lote neste pasto agora.");
  });

  it("vazio sem saída registrada: só VAZIO", () => {
    render(<CascaDeTeste modelo={modeloV12({ qtd: 0 })} abaInicial="detalhes" movimentacoes={[]} />);
    expect(grade(screen.getByRole("tabpanel").querySelector(".mk-dp-cartao")).Status).toBe("VAZIO");
  });
});

// ── Aba Lotes ───────────────────────────────────────────────────────────────

describe("aba Lotes: vistas", () => {
  it("desktop e tablet abrem na Lista; celular no Resumo", () => {
    const um = render(<CascaDeTeste modelo={modeloV12()} modo="desktop" />);
    expect(vistaAtiva()).toBe("Lista");
    um.unmount();
    const dois = render(<CascaDeTeste modelo={modeloV12()} modo="tablet" />);
    expect(vistaAtiva()).toBe("Lista");
    dois.unmount();
    render(<CascaDeTeste modelo={modeloV12()} modo="celular" />);
    expect(vistaAtiva()).toBe("Resumo");
  });

  it("sem lotes: só o aviso, sem o seletor de vista", () => {
    render(<CascaDeTeste modelo={modeloV12({ qtd: 0 })} />);
    expect(screen.getByRole("tabpanel").textContent).toBe("Nenhum lote neste pasto agora.");
    expect(screen.queryByRole("button", { name: "Resumo", exact: true })).toBeNull();
  });
});

describe("aba Lotes › Resumo", () => {
  it("4 números, cabeçalho do pasto e os lotes por nome com subícone 30 px (D-PROD-224), cor do lote, meta, peso e situação", () => {
    render(<CascaDeTeste modelo={modeloV12()} modo="celular" />);
    const kpis = [...document.querySelectorAll(".mk-dp-kpi")].map((k) => [k.querySelector("dt").textContent, k.querySelector(".mk-dp-kpi__val").textContent]);
    expect(kpis).toEqual([["Peso médio (kg)", "329,7"], ["Cabeças", "314"], ["UA/ha", "2,24"], ["kg PV/ha", "1.008"]]);
    expect(document.querySelector(".mk-dp-itens__titulo").textContent).toBe("Pasto 07 (314)");

    const itens = [...document.querySelectorAll(".mk-dp-item")];
    expect(itens.map((i) => i.querySelector(".mk-dp-item__nome").textContent)).toEqual(["L-2026-008", "L-2026-014", "L-2026-019", "L-2026-022", "L-2026-025", "L-2026-027"]);
    const primeiro = itens[0];
    expect(primeiro.querySelector(".mk-dp-item__meta").textContent).toBe("38 cb · 38,0 UA · VACA · 449,5 kg");
    expect(primeiro.querySelector(".mk-dp-item__sub")).toBeNull();
    expect(primeiro.querySelector(".mk-dp-quad").style.background).toBe("rgb(239, 68, 68)");
    expect(primeiro.querySelector(".mk-dp-chip--atencao").textContent).toBe("Atenção");
    expect(itens[1].querySelector(".mk-dp-chip--ok").textContent).toBe("Em dia");
    expect(primeiro.querySelector("img").getAttribute("src")).toBe(urlSubiconeLote("femea-37-mais", 30));
    expect(primeiro.querySelector(".mk-dp-chev")).toBeTruthy();
  });

  it("Resumo sem caixas de seleção, mantendo o acesso aos manejos", () => {
    render(<CascaDeTeste modelo={modeloV12()} modo="celular" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Mover lotes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pesar" })).toBeTruthy();
  });

  it("tocar no lote abre a tela do lote (empilha), e a caixa não abre", async () => {
    const aoEmpurrar = vi.fn();
    render(<CascaDeTeste modelo={modeloV12()} modo="celular" aoEmpurrar={aoEmpurrar} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(aoEmpurrar).not.toHaveBeenCalled();
    await clicar(screen.getByText("L-2026-019"));
    expect(aoEmpurrar).toHaveBeenCalledWith({ tipo: "lote", loteId: "p-b" });
    // A casca de teste mostra a tela do lote empilhada.
    expect(screen.getByRole("heading", { name: "L-2026-019" })).toBeTruthy();
  });
});

describe("aba Lotes › Lote", () => {
  it("um único lote usa só o cabeçalho de identidade, sem faixa 1 de 1 ou setas desativadas", async () => {
    const modelo = modeloV12({ qtd: 1 });
    render(<CascaDeTeste modelo={modelo} />);
    await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
    expect(document.querySelector(".mk-dp-nav")).toBeNull();
    expect(document.querySelector(".mk-dp-lote-organizado .mk-dp-cartao__titulo").textContent).toBe(modelo.lotes[0].nome);
    expect(screen.getByRole("heading", { name: "Lotação" })).toBeTruthy();
  });

  it("navega pelos lotes por nome: ‹ desligado no primeiro, › no último", async () => {
    render(<CascaDeTeste modelo={modeloV12()} />);
    await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
    const nav = document.querySelector(".mk-dp-nav");
    expect(nav.querySelector(".mk-dp-nav__titulo").textContent).toBe("L-2026-008");
    expect(nav.querySelector(".mk-dp-nav__sub").textContent).toBe("1 de 6");
    expect(screen.getByRole("button", { name: "Lote anterior" }).disabled).toBe(true);
    for (let i = 0; i < 5; i += 1) await clicar(screen.getByRole("button", { name: "Próximo lote" }));
    expect(nav.querySelector(".mk-dp-nav__titulo").textContent).toBe("L-2026-027");
    expect(nav.querySelector(".mk-dp-nav__sub").textContent).toBe("6 de 6");
    expect(screen.getByRole("button", { name: "Próximo lote" }).disabled).toBe(true);
  });

  it("cartão do lote (36 px na densidade compacta, D-PROD-224; 'VACA · FÊMEA · Pasto 07', Atenção), avisos e as 3 seções; dica só nos campos de projeção", async () => {
    render(<CascaDeTeste modelo={modeloV12()} />);
    await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
    const painel = screen.getByRole("tabpanel");
    const cartao = painel.querySelector(".mk-dp-cartao");
    expect(cartao.querySelector(".mk-dp-cartao__titulo")).toBeNull();
    expect(screen.getAllByText("L-2026-008")).toHaveLength(1);
    expect(cartao.querySelector(".mk-dp-cartao__sub").textContent).toBe("VACA · FÊMEA");
    expect(cartao.querySelector(".mk-dp-chip--atencao").textContent).toBe("Atenção");
    expect(cartao.querySelector("img").getAttribute("src")).toBe(urlSubiconeLote("femea-37-mais", 36));
    expect([...painel.querySelectorAll(".mk-dp-aviso--atencao")].map((a) => a.textContent)).toEqual(["Faz 82 dias sem pesar"]);
    expect(within(painel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Lotação", "Pesagem", "Projeção de peso", "Identificação"]);

    const [, lotacao, pesagem, projecao, ident] = painel.querySelectorAll(".mk-dp-cartao");
    expect(grade(lotacao)).toEqual({
      "Cab.": "38", "% das cabeças do pasto": "12%", UA: "37,96", "% da UA do pasto": "16%",
      "UA/ha": "0,37", "kg PV/ha": "166", "Dias pastejo": "56", "Peso total (kg)": "17.081", "Ocupação (UA × dias)": "2.126",
    });
    expect(lotacao.querySelectorAll(".mk-dp-cel__barra")).toHaveLength(2);
    expect(lotacao.querySelectorAll(".mk-dp-cel__sub")).toHaveLength(0);

    expect(grade(pesagem)).toMatchObject({ "Peso médio (kg)": "449,5", "Última": "25/08/2026", Origem: "MEDIDO" });
    expect(within(pesagem).queryByText("Peso projetado (kg)")).toBeNull();
    expect(grade(projecao)).toMatchObject({ "Peso projetado (kg)": "465,9", "@ projetadas": "15,53", "GMD do mês (kg/dia)": "0,200", "Base da projeção": "PESAGEM 25/08", "Peso objetivo (kg)": "480", "Atinge o objetivo": "25/01/2027 (71 d)", "Pesado × previsto": "98,7% do previsto" });
    const mensal = projecao.querySelector(".mk-dp-projecao-mensal");
    expect(within(mensal).getByRole("heading", { name: "Projeção de fim de mês" })).toBeTruthy();
    expect(grade(mensal)).toEqual({ "30/11": "469 kg", "31/12": "475 kg", "31/01": "481 kg" });
    expect(projecao.textContent).not.toContain("último peso +");
    expect(projecao.textContent).not.toContain("peso projetado ÷ 30");
    expect(within(projecao).queryByText("Peso médio (kg)")).toBeNull();
    expect(within(painel).getAllByText("Peso médio (kg)")).toHaveLength(1);
    expect(within(painel).queryByText("Sexo", { exact: true })).toBeNull();
    expect(within(painel).queryByText("Categoria", { exact: true })).toBeNull();
    expect(Object.keys(grade(ident))).toEqual(["Sist. Rep.", "Identificador", "Sigla", "Entrada", "Cat. de manejo"]);
    expect(grade(ident)).toMatchObject({ Identificador: "VERMELHO", "Cat. de manejo": "CRIA" });
    const identificador = [...ident.querySelectorAll(".mk-dp-cel")].find((c) => c.querySelector("dt").textContent === "Identificador");
    expect(identificador.querySelector(".mk-dp-bolinha").style.background).toBe("rgb(239, 68, 68)");
    expect(ident.querySelectorAll(".mk-dp-cel__sub")).toHaveLength(0);
  });

  it("alerta de nível 1 (intervalo curto) aparece como aviso de informação e não muda a situação", async () => {
    const posicoes = modeloV12().lotes.map((l) => l.raw);
    const curto = { ...posicoes[0], id: "p-x", posicao_id: "p-x", nome: "L-CURTO" };
    const movs = [
      { id: "m1", tipo: "Pesagem", data_movimentacao: "2026-10-20", linhas: [{ posicao_id: "p-x", peso_novo_kg: 370 }] },
      { id: "m2", tipo: "Pesagem", data_movimentacao: "2026-11-01", linhas: [{ posicao_id: "p-x", peso_novo_kg: 382.5 }] },
    ];
    const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");
    const modelo = montarModeloDetalhes({ area: AREA_V12, lotes: [curto], movimentacoes: movs, hoje: new Date(2026, 10, 15) });
    render(<CascaDeTeste modelo={modelo} pilhaInicial={[{ tipo: "lote", loteId: "p-x" }]} />);
    expect(document.querySelector(".mk-dp-aviso--neutro").textContent).toBe("Pesagens muito próximas (12 dias)");
    expect(document.querySelector(".mk-dp-aviso--atencao")).toBeNull();
    expect(document.querySelector(".mk-dp-chip--ok").textContent).toBe("Em dia");
  });
});

describe("aba Lotes › Lista", () => {
  it("título, link Configurar tabela, grupos e colunas padrão (Alertas + Lotação + Pesagem)", async () => {
    const aoEmpurrar = vi.fn();
    render(<CascaDeTeste modelo={modeloV12()} aoEmpurrar={aoEmpurrar} />);
    expect(screen.getByRole("heading", { name: "6 lotes · 314 cab" })).toBeTruthy();
    const grupos = screen.getAllByRole("columnheader").filter((th) => th.classList.contains("mk-dp-tabela__g")).map((g) => [g.textContent, g.getAttribute("aria-colspan")]);
    expect(grupos).toEqual([["Lote", null], ["Alertas", "3"], ["Lotação", "10"], ["Pesagem", "15"]]);
    const cols = cabecalhos();
    expect(cols.slice(0, 5)).toEqual(["Nome", "Situação", "Tipo de alerta", "Valor do alerta (dias)", "Cab."]);
    expect(cols).toHaveLength(29);
    expect(cols).toContain("Última");
    expect(cols).not.toContain("Sexo");
    await clicar(screen.getByRole("button", { name: "Configurar tabela" }));
    expect(aoEmpurrar).toHaveBeenCalledWith({ tipo: "configurarTabela" });
  });

  it("células com cor, bolinha e mini barra; Total da área", () => {
    render(<CascaDeTeste modelo={modeloV12()} />);
    const situacao = celula("L-2026-008", "Situação");
    expect(situacao.textContent).toBe("ATENÇÃO");
    expect(situacao.style.color).toBe("rgb(180, 83, 9)");
    expect(situacao.querySelector(".mk-dp-tabela__bolinha--p")).toBeTruthy();
    expect(celula("L-2026-008", "Tipo de alerta").textContent).toBe("Pesagem atrasada");
    expect(celula("L-2026-008", "Valor do alerta (dias)").textContent).toBe("82");
    expect(celula("L-2026-014", "Tipo de alerta").style.color).toBe("rgb(100, 116, 139)");
    expect(celula("L-2026-008", "% área").querySelector(".mk-dp-tabela__mini > span").style.width).toBe("12%");
    expect(celula("L-2026-022", "Origem").textContent).toBe("DERIVADO");
    expect(celula("L-2026-008", "Projeção (fim do mês)").classList.contains("is-quebra")).toBe(true);

    const total = screen.getAllByRole("row").at(-1);
    const totais = celulasDa(total).map((c) => c.textContent);
    expect(totais.slice(0, 15)).toEqual(["Total da área", "", "", "", "314", "329,7", "100%", "230,09", "100%", "2,24", "1.008", "26", "103.540", "6.457", "342,6"]);
  });

  it("Tab num cabeçalho só em parte visível rola a tabela até ele aparecer inteiro (à esquerda, a coluna presa Nome conta como borda)", () => {
    render(<CascaDeTeste modelo={modeloV12()} />);
    const rolo = /** @type {HTMLElement} */ (document.querySelector(".mk-dp-tabela__rolo"));
    const ths = screen.getAllByRole("columnheader").filter((th) => th.querySelector("button"));
    const caixa = (/** @type {Element} */ el, esquerda, direita) => {
      el.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: esquerda, right: direita, top: 0, bottom: 30, width: direita - esquerda, height: 30, x: esquerda, y: 0, toJSON() {} });
    };
    caixa(rolo, 0, 400);
    caixa(ths[0], 0, 120); // Nome, presa à esquerda
    // Cortado na borda direita: rola o que falta (44 px).
    caixa(ths[4], 360, 444);
    act(() => ths[4].querySelector("button").focus());
    expect(rolo.scrollLeft).toBe(44);
    // Escondido em parte embaixo da coluna presa: volta o que falta (40 px).
    caixa(ths[2], 80, 164);
    act(() => ths[2].querySelector("button").focus());
    expect(rolo.scrollLeft).toBe(4);
    // Inteiro à vista: não rola.
    caixa(ths[3], 200, 300);
    act(() => ths[3].querySelector("button").focus());
    expect(rolo.scrollLeft).toBe(4);
    // A própria coluna presa nunca rola a tabela.
    act(() => ths[0].querySelector("button").focus());
    expect(rolo.scrollLeft).toBe(4);
  });

  it("ordenação: Nome ▲ no começo; coluna nova crescente, a mesma inverte, vazios no fim", async () => {
    render(<CascaDeTeste modelo={modeloV12()} />);
    const nome = screen.getAllByRole("columnheader").find((th) => th.textContent.startsWith("Nome"));
    expect(nome.getAttribute("aria-sort")).toBe("ascending");
    expect(nome.textContent).toBe("Nome▲");
    expect(nomesNaTabela()).toEqual(["L-2026-008", "L-2026-014", "L-2026-019", "L-2026-022", "L-2026-025", "L-2026-027"]);

    await clicar(screen.getByRole("button", { name: /^Cab\./ }));
    expect(nomesNaTabela()).toEqual(["L-2026-027", "L-2026-008", "L-2026-022", "L-2026-019", "L-2026-025", "L-2026-014"]);
    expect(screen.getAllByRole("columnheader").find((th) => th.textContent.startsWith("Cab.")).getAttribute("aria-sort")).toBe("ascending");
    await clicar(screen.getByRole("button", { name: /^Cab\./ }));
    expect(nomesNaTabela()[0]).toBe("L-2026-014");

    // "Valor do alerta": só o L-2026-008 tem; os vazios ficam no fim nos dois sentidos.
    await clicar(screen.getByRole("button", { name: /^Valor do alerta/ }));
    expect(nomesNaTabela()[0]).toBe("L-2026-008");
    await clicar(screen.getByRole("button", { name: /^Valor do alerta/ }));
    expect(nomesNaTabela()[0]).toBe("L-2026-008");
  });

  it("tocar no nome abre a tela do lote; a ordem escolhida volta ao reabrir na sessão", async () => {
    const aoEmpurrar = vi.fn();
    const um = render(<CascaDeTeste modelo={modeloV12()} aoEmpurrar={aoEmpurrar} />);
    await clicar(screen.getByRole("button", { name: /^Cab\./ }));
    await clicar(screen.getByRole("button", { name: /^L-2026-025/ }));
    expect(aoEmpurrar).toHaveBeenCalledWith({ tipo: "lote", loteId: "p-e" });
    um.unmount();
    render(<CascaDeTeste modelo={modeloV12()} />);
    expect(nomesNaTabela()[0]).toBe("L-2026-027");
  });

  it("ordenada por uma coluna que saiu da tabela: volta a valer o nome (e a escolha volta com a coluna)", async () => {
    const escopo = { clienteId: "c-1", login: "ana", empresaId: "emp-1" };
    render(<CascaDeTeste modelo={modeloV12()} escopoPreferencias={escopo} />);
    await clicar(screen.getByRole("button", { name: /^Cab\./ }));
    expect(nomesNaTabela()[0]).toBe("L-2026-027");
    await clicar(screen.getByRole("button", { name: "Configurar tabela" }));
    await clicar(screen.getByRole("checkbox", { name: "Cab." }));
    await clicar(screen.getByRole("button", { name: "Aplicar" }));
    expect(nomesNaTabela()[0]).toBe("L-2026-008");
    expect(screen.getAllByRole("columnheader").find((th) => th.textContent.startsWith("Nome")).getAttribute("aria-sort")).toBe("ascending");
    await clicar(screen.getByRole("button", { name: "Configurar tabela" }));
    await clicar(screen.getByRole("checkbox", { name: "Cab." }));
    await clicar(screen.getByRole("button", { name: "Aplicar" }));
    expect(nomesNaTabela()[0]).toBe("L-2026-027");
  });

  it("um lote: '1 lote · 86 cab' (singular)", () => {
    render(<CascaDeTeste modelo={modeloV12({ qtd: 1 })} />);
    expect(screen.getByRole("heading", { name: "1 lote · 86 cab" })).toBeTruthy();
  });

  it("celular: coluna do nome com 138 px; desktop 170 px", () => {
    const um = render(<CascaDeTeste modelo={modeloV12()} modo="celular" />);
    fireEvent.click(screen.getByRole("button", { name: "Lista", exact: true }));
    expect(screen.getByRole("table").style.gridTemplateColumns.startsWith("138px ")).toBe(true);
    um.unmount();
    render(<CascaDeTeste modelo={modeloV12()} />);
    expect(screen.getByRole("table").style.gridTemplateColumns.startsWith("170px minmax(84px, auto) 128px ")).toBe(true);
  });
});

// ── Telas empilhadas ────────────────────────────────────────────────────────

describe("tela do lote", () => {
  it("mostra os blocos do lote pedido, sem a navegação ‹ ›; o rodapé é da casca", () => {
    render(<CascaDeTeste modelo={modeloV12()} pilhaInicial={[{ tipo: "lote", loteId: "p-e" }]} />);
    expect(document.querySelector(".mk-dp-nav")).toBeNull();
    expect(document.querySelector(".mk-dp-cartao__titulo")).toBeNull();
    expect(screen.getAllByText("L-2026-025")).toHaveLength(1);
    expect(screen.getAllByText(/BEZERRO/)).toHaveLength(1);
    expect(document.querySelector(".mk-dp-cartao__sub").textContent).toBe("MACHO");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Lotação", "Pesagem", "Projeção de peso", "Identificação"]);
    expect(screen.getByRole("group", { name: "Ações" }).textContent).toBe("MoverPesarManejos");
  });

  it("lote que saiu do pasto: aviso, sem quebrar", () => {
    render(<CascaDeTeste modelo={modeloV12()} pilhaInicial={[{ tipo: "lote", loteId: "nao-existe" }]} />);
    expect(document.querySelector(".mk-dp-vazio").textContent).toBe("Este lote não está mais neste pasto.");
  });
});

describe("Configurar tabela", () => {
  it("info, busca, grupos com n/N e o rodapé próprio Redefinir · Aplicar no lugar do padrão", () => {
    render(<CascaDeTeste modelo={modeloV12()} pilhaInicial={[{ tipo: "configurarTabela" }]} />);
    expect(document.querySelector(".mk-dp-info").textContent).toBe("Marque as colunas que a tabela mostra.As colunas ficam agrupadas por seção: Alertas, Lotação, Pesagem e Identificação.");
    expect(screen.getByRole("searchbox", { name: "Filtrar colunas" }).getAttribute("placeholder")).toBe("Filtrar");
    const grupos = [...document.querySelectorAll(".mk-dp-grupo")].map((g) => [g.getAttribute("aria-label"), g.querySelector(".mk-dp-grupo__n").textContent]);
    expect(grupos).toEqual([["Alertas", "3/3"], ["Lotação", "10/10"], ["Pesagem", "15/15"], ["Identificação", "0/6"]]);
    const rodape = document.querySelector(".mk-dp__rodape");
    expect([...rodape.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Redefinir", "Aplicar"]);
    expect(rodape.querySelector(".mk-dp-rodape--pilulas")).toBeNull();
    expect(rodape.querySelector(".mk-dp-botao--verde").textContent).toBe("Aplicar");
  });

  it("a busca filtra por nome (sem acento também), some com grupos vazios e o grupo marca só o que aparece", async () => {
    render(<CascaDeTeste modelo={modeloV12()} pilhaInicial={[{ tipo: "configurarTabela" }]} />);
    const busca = screen.getByRole("searchbox", { name: "Filtrar colunas" });
    await act(async () => { fireEvent.change(busca, { target: { value: "peso" } }); });
    const grupos = () => [...document.querySelectorAll(".mk-dp-grupo")].map((g) => [g.getAttribute("aria-label"), g.querySelector(".mk-dp-grupo__n").textContent]);
    expect(grupos()).toEqual([["Lotação", "2/2"], ["Pesagem", "3/3"]]);
    // Caixa do grupo Lotação: desmarca só "Peso médio (kg)" e "Peso total (kg)".
    await clicar(screen.getByRole("checkbox", { name: /Lotação/ }));
    expect(grupos()[0]).toEqual(["Lotação", "0/2"]);
    await act(async () => { fireEvent.change(busca, { target: { value: "" } }); });
    expect(grupos()[1]).toEqual(["Lotação", "8/10"]);
    await act(async () => { fireEvent.change(busca, { target: { value: "lotacao" } }); });
    // "lotacao" acha "% lotação" (que continuou marcada).
    expect(grupos()).toEqual([["Lotação", "1/1"]]);
  });

  it("Redefinir volta o rascunho ao padrão e fica na tela; Aplicar grava e volta; ‹ sem Aplicar não grava", async () => {
    const escopo = { clienteId: "c-1", login: "ana", empresaId: "emp-1" };
    const aoVoltar = vi.fn();
    const um = render(<CascaDeTeste modelo={modeloV12()} escopoPreferencias={escopo} pilhaInicial={[{ tipo: "configurarTabela" }]} aoVoltar={aoVoltar} />);
    await clicar(screen.getByRole("checkbox", { name: "Situação" }));
    await clicar(screen.getByRole("button", { name: "Voltar" }));
    expect(window.localStorage.length).toBe(0);
    um.unmount();

    render(<CascaDeTeste modelo={modeloV12()} escopoPreferencias={escopo} pilhaInicial={[{ tipo: "configurarTabela" }]} aoVoltar={aoVoltar} />);
    expect(screen.getByRole("checkbox", { name: "Situação" }).getAttribute("aria-checked")).toBe("true");
    await clicar(screen.getByRole("checkbox", { name: /Identificação/ }));
    await clicar(screen.getByRole("button", { name: "Redefinir" }));
    expect(screen.getByRole("checkbox", { name: /Identificação/ }).getAttribute("aria-checked")).toBe("false");
    expect(aoVoltar).toHaveBeenCalledTimes(1);

    await clicar(screen.getByRole("checkbox", { name: "Sexo" }));
    await clicar(screen.getByRole("button", { name: "Aplicar" }));
    expect(aoVoltar).toHaveBeenCalledTimes(2);
    // Voltou para a Lista, já com a coluna nova.
    expect(cabecalhos()).toContain("Sexo");
  });
});

it("não confunde peso atual com projeção quando os números coincidem", async () => {
  const m = modeloV12();
  const lote = m.lotes.find((l) => l.nome === "L-2026-008");
  lote.valores.projetado = { ...lote.valores.projetado, texto: lote.valores.peso.texto };
  render(<CascaDeTeste modelo={m} />);
  await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
  const atual = screen.getByRole("region", { name: "Pesagem" });
  const projecao = screen.getByRole("region", { name: "Projeção de peso" });
  expect(grade(atual)["Peso médio (kg)"]).toBe("449,5");
  expect(grade(projecao)["Peso projetado (kg)"]).toBe("449,5");
});

it("mantém o campo Sexo quando ele está sem informação no cabeçalho", async () => {
  const m = modeloV12();
  const lote = m.lotes.find((l) => l.nome === "L-2026-008");
  lote.sexo = "—";
  lote.valores.sexo = { ...lote.valores.sexo, texto: "—" };
  render(<CascaDeTeste modelo={m} />);
  await clicar(screen.getByRole("button", { name: "Lote", exact: true }));
  const identificacao = screen.getByRole("region", { name: "Identificação" });
  expect(grade(identificacao).Sexo).toBe("—");
});
