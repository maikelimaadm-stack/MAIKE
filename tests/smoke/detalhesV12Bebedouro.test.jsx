// @vitest-environment jsdom
/**
 * D-PROD-220 — detalhe do bebedouro no desenho do Detalhes do Lote v12 (tela
 * `telaBebedouro`): raiz `.mk-dp` filha do `.mk-ll` do diálogo, título/sub
 * publicados no cabeçalho do diálogo, blocos na ordem do v12 (cartão, aviso,
 * Resumo operacional, Último registro, Informações, Histórico) e o rodapé
 * Lançar · Histórico pela regra do servidor (D-PROD-137).
 *
 * D-PROD-222 — "Lançar" e "Histórico" abrem como os manejos do lote: num
 * `LancLoteDialogo` POR CIMA do detalhe (título = a ação, subtítulo = o
 * bebedouro; popup no desktop, tela cheia no celular), sem telas empilhadas.
 * O lançamento no desenho do manejo (`LancLoteForm` + `LancField`; o ✕ e o ✓
 * do cabeçalho), com os mesmos campos, padrões, envio, mensagens e
 * invalidações; o histórico completo nos cartões do manejo (`CartaoHistorico`),
 * na ordem do servidor, com o "Excluir" e todas as regras de antes. Fora do
 * diálogo: a tela Bebedouros (que passa `semCabecalho`) fica sem o cabeçalho próprio,
 * e os diálogos abrem por cima dela também.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const estado = vi.hoisted(() => ({
  historico: /** @type {any[]} */ ([]),
  /** Campos extras da consulta do histórico (ex.: `isPlaceholderData`, `isError`). */
  consulta: /** @type {Record<string, any>} */ ({}),
  lotes: /** @type {any[]} */ ([]),
  pontos: /** @type {any[]} */ ([]),
  icones: /** @type {any[]} */ ([]),
}));
const servico = vi.hoisted(() => ({
  criados: /** @type {any[]} */ ([]),
  excluidos: /** @type {string[]} */ ([]),
  /** Recusa do servidor no POST / no DELETE (null: aceita). */
  erroAoCriar: /** @type {any} */ (null),
  erroAoExcluir: /** @type {any} */ (null),
}));

vi.mock("@/hooks/useBebedouroHistorico", () => ({
  useBebedouroHistorico: (_empresaId, bebedouroId) => ({ data: bebedouroId ? estado.historico : [], ...estado.consulta }),
}));
vi.mock("@/services/mapaService", () => ({
  listarIconesPorTipoEntidade: async () => estado.icones,
  listarPontosDaEmpresa: async () => estado.pontos,
}));
vi.mock("@/services/loteManejoService", () => ({ listarTodosLotes: async () => estado.lotes }));
vi.mock("@/services/bebedouroDataService", () => ({
  criarHistorico: vi.fn(async (dados) => {
    if (servico.erroAoCriar) throw servico.erroAoCriar;
    servico.criados.push(dados);
    return { id: "novo", ...dados };
  }),
  excluirHistorico: vi.fn(async (id) => {
    if (servico.erroAoExcluir) throw servico.erroAoExcluir;
    servico.excluidos.push(id);
    return null;
  }),
}));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ full_name: "João" }) }));
vi.mock("@/lib/maikeConfirmar", () => ({ confirmarExclusao: vi.fn(async () => true) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import CartaoHistorico, { LinhaHistorico, SeloHistorico } from "@/components/lotes/CartaoHistorico";
import DetalhesBebedouro from "@/components/bebedouros/DetalhesBebedouro";
import { diaDoLancamento } from "@/components/bebedouros/cartoesDoBebedouro";

/** Largura da tela para os `matchMedia` (desktop 1280, tablet 820, celular 390). */
const largura = (w) => {
  window.matchMedia = /** @type {any} */ ((q) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    const matches = (!min || w >= Number(min[1])) && (!max || w <= Number(max[1]));
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
};
const original = window.matchMedia;
const brasil = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
const SO_O_ULTIMO = "Só o primeiro da lista (o último lançado no sistema) pode ser excluído.";

const EMPRESA = "emp-1";
const BEBEDOURO = {
  id: "beb-1",
  empresa_id: EMPRESA,
  nome: "Bebedouro 01",
  tipo: "Australiano",
  capacidade_litros: 20000,
  origem_agua: "Poço artesiano",
  status: "Ativo",
  area_vinculada_ids: ["a-p01", "a-p02"],
  area_vinculada_nomes: ["Pasto 01", "Pasto 02"],
  periodicidade_limpeza: "Quinzenal",
  periodicidade_inspecao: "Semanal",
  observacoes: "Boia trocada em out/2026.",
  codigo_interno: "BB-01",
  ponto_referencia_id: "p-1",
};
// Ordem do servidor: criação desc.
const HISTORICO = [
  { id: "h2", tipo_lancamento: "Inspeção", status: "Concluído", data_lancamento: "2026-11-10", hora_lancamento: "08:30", descricao: "Nível bom, boia funcionando.", responsavel: "João", qualidade_agua: "Boa", escore_agua: 4.5 },
  { id: "h1", tipo_lancamento: "Limpeza", status: "Concluído", data_lancamento: "2026-11-01", hora_lancamento: "07:00", descricao: "Limpeza completa.", responsavel: "João", custo: 1240, produto_utilizado: "CLORO", quantidade_utilizada: 2 },
];
const LOTES = [
  { id: "l1", empresa_id: EMPRESA, status: "Ativo", area_atual_id: "a-p01", quantidade_cabecas: 120 },
  { id: "l2", empresa_id: EMPRESA, status: "Ativo", area_atual_id: "a-p02", quantidade_cabecas: 69 },
  { id: "l3", empresa_id: EMPRESA, status: "Ativo", area_atual_id: "a-p09", quantidade_cabecas: 50 },
  { id: "l4", empresa_id: EMPRESA, status: "Inativo", area_atual_id: "a-p01", quantidade_cabecas: 30 },
];

beforeEach(() => {
  localStorage.setItem("empresa_selecionada_id", EMPRESA);
  estado.historico = HISTORICO;
  estado.consulta = {};
  estado.lotes = LOTES;
  estado.pontos = [{ id: "p-1", nome: "Bebedouro 01", numero_ponto: "BB-01", ativo: true }];
  estado.icones = [];
  servico.criados = [];
  servico.excluidos = [];
  servico.erroAoCriar = null;
  servico.erroAoExcluir = null;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = original;
  vi.useRealTimers();
});

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Como o MapaGeral monta: `LancLoteDialogo` largo, só leitura, popup a partir do tablet. */
function noDialogo(props, cliente = novoCliente()) {
  const arvore = (p) => (
    <QueryClientProvider client={cliente}>
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Bebedouro" largo somenteLeitura popupDesde="tablet">
        <DetalhesBebedouro bebedouro={BEBEDOURO} {...p} />
      </LancLoteDialogo>
    </QueryClientProvider>
  );
  const r = render(arvore(props));
  return { ...r, refazer: (p) => r.rerender(arvore(p)) };
}

/** O diálogo do detalhe (o primeiro do documento): título e sub. */
const tituloDoDialogo = () => document.querySelector(".mk-ll-dlg__titulo")?.textContent;
const subDoDialogo = () => document.querySelector(".mk-ll-dlg__lotes")?.textContent ?? null;
/** Os diálogos abertos, na ordem do documento: o que abre por cima vem por último. */
const dialogos = () => /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".mk-ll-dlg")]);
const ultimoDialogo = () => /** @type {HTMLElement} */ (dialogos().at(-1));
const tituloDe = (d) => d?.querySelector(".mk-ll-dlg__titulo")?.textContent ?? null;
const subDe = (d) => d?.querySelector(".mk-ll-dlg__lotes")?.textContent ?? null;
const pilulas = () => [...document.querySelectorAll(".mk-dp-pilula")].map((b) => b.textContent);
const corpo = () => /** @type {HTMLElement} */ (document.querySelector(".mk-dp__corpo"));
const grupo = (nome) => screen.getByRole("group", { name: nome });
/** Valor da célula (dt → dd) dentro de um grupo. */
const celula = (g, rotulo) => within(g).getByText(rotulo, { selector: "dt" }).nextElementSibling?.textContent;
const esc = () => act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" }); });
const clicar = (el) => act(async () => { fireEvent.click(el); });

/** Os cartões do histórico completo (`CartaoHistorico`), na ordem da tela. */
const cartoes = () => /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-testid="lancamento-bebedouro"]')]);
/** Partes do `CartaoHistorico`: a fileira de selos, o título em negrito, as linhas e o rodapé. */
const partes = (c) => {
  const coluna = /** @type {HTMLElement} */ (c.firstElementChild?.firstElementChild);
  const [fileira, titulo, linhas] = /** @type {HTMLElement[]} */ ([...coluna.children]);
  const rodape = c.lastElementChild !== c.firstElementChild ? /** @type {HTMLElement} */ (c.lastElementChild) : null;
  return { fileira, titulo, linhas, rodape };
};
const selos = (c) => [...partes(c).fileira.children].map((s) => s.textContent);
const linhas = (c) => [...partes(c).linhas.children].map((l) => l.textContent);
const excluirDe = (c) => /** @type {HTMLButtonElement | null} */ (partes(c).rodape?.querySelector("button") ?? null);

describe("Detalhe do bebedouro v12 no diálogo do mapa", () => {
  it("raiz .mk-dp filha do .mk-ll; título = nome e sub 'Bebedouro' no cabeçalho do diálogo; blocos na ordem do v12", async () => {
    largura(1280);
    noDialogo({ podeLancar: true, podeExcluir: true });
    await screen.findByText("189 cab");
    const raiz = document.querySelector(".mk-ll > .mk-dp");
    expect(raiz).toBeTruthy();
    expect(raiz?.getAttribute("data-modo")).toBe("desktop");
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(subDoDialogo()).toBe("Bebedouro");
    // dentro do diálogo quem desenha o cabeçalho é o diálogo
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    const blocos = [...corpo().children].map((el) => el.className.split(" ")[0]);
    expect(blocos).toEqual(["mk-dp-cartao", "mk-dp-titulo", "mk-dp-cartao", "mk-dp-titulo", "mk-dp-cartao", "mk-dp-titulo", "mk-dp-cartao", "mk-dp-titulo", "mk-dp-tl"]);
    // Os pares do popup (D-PROD-226) contam com o corpo como filho direto da raiz `.mk-dp.mk-dp-bebedouro`.
    expect(corpo().parentElement).toBe(raiz);
    expect(raiz?.classList.contains("mk-dp-bebedouro")).toBe(true);
    expect([...corpo().querySelectorAll(".mk-dp-titulo__h")].map((h) => h.textContent)).toEqual([
      "Resumo operacional",
      "Último registro",
      "Informações do bebedouro",
      "Histórico do bebedouro",
    ]);
    // Fechado, nenhum diálogo por cima.
    expect(dialogos()).toHaveLength(1);
  });

  it("cartão do cabeçalho: gota sem ícone configurado, tipo · capacidade e o status (Ativo = em dia); subícone configurado no lugar da gota", async () => {
    largura(820);
    const { unmount } = noDialogo({});
    await screen.findByText("189 cab");
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("tablet");
    const cab = /** @type {HTMLElement} */ (document.querySelector(".mk-dp-cartao__cab"));
    expect(cab.querySelector("svg.mk-dp-cartao__ic.lucide-droplet")).toBeTruthy();
    expect(within(cab).getByText("Bebedouro 01").className).toBe("mk-dp-cartao__titulo");
    expect(within(cab).getByText("Australiano · 20.000 L").className).toBe("mk-dp-cartao__sub");
    expect(within(cab).getByText("Ativo").className).toContain("mk-dp-chip--ok");
    unmount();

    estado.icones = [{ categoria: "BEBEDOURO", sub_icone_url: "/icones/bebedouro.png", ativo: true }];
    noDialogo({ bebedouro: { ...BEBEDOURO, status: "Em manutenção" } });
    await waitFor(() => expect(document.querySelector(".mk-dp-cartao__img")?.getAttribute("style")).toContain("/icones/bebedouro.png"));
    expect(document.querySelector(".mk-dp-cartao__ic")).toBeNull();
    expect(screen.getByText("Em manutenção", { selector: ".mk-dp-chip" }).className).toContain("mk-dp-chip--atencao");
  });

  it("Resumo operacional e Informações do bebedouro em grade (dt → dd); Observações em linha que quebra", async () => {
    largura(1280);
    noDialogo({});
    await screen.findByText("189 cab");
    const resumo = grupo("Resumo operacional");
    // 120 + 69 dos lotes ativos nos pastos atendidos (o do Pasto 09 e o inativo ficam fora)
    expect(celula(resumo, "Animais consumindo água")).toBe("189 cab");
    // Limpeza 01/11 + quinzenal; inspeção 10/11 + semanal
    expect(celula(resumo, "Próxima limpeza")).toBe(brasil("2026-11-16"));
    expect(celula(resumo, "Próxima inspeção")).toBe(brasil("2026-11-17"));
    expect(celula(resumo, "Custo acumulado")).toBe("R$ 1.240,00");

    const info = grupo("Informações do bebedouro");
    await waitFor(() => expect(celula(info, "Número")).toBe("BB-01"));
    expect(celula(info, "Tipo")).toBe("Australiano");
    expect(celula(info, "Status")).toBe("Ativo");
    expect(celula(info, "Capacidade")).toBe("20.000 L");
    expect(celula(info, "Origem da água")).toBe("Poço artesiano");
    expect(celula(info, "Pastos atendidos")).toBe("Pasto 01, Pasto 02");
    expect(celula(info, "Rotina limpeza")).toBe("Quinzenal");
    expect(celula(info, "Rotina inspeção")).toBe("Semanal");
    const obs = within(info).getByText("Observações").closest(".mk-dp-linha");
    expect(obs?.className).toContain("mk-dp-linha--quebra");
    expect(obs?.querySelector(".mk-dp-linha__val")?.textContent).toBe("Boia trocada em out/2026.");
  });

  it("Último registro pela data do lançamento: tipo, descrição e data · hora · quem registrou", async () => {
    largura(1280);
    // O retroativo (01/11) foi criado por último e vem primeiro do servidor: não é o "último registro".
    estado.historico = [
      { id: "h3", tipo_lancamento: "Limpeza", status: "Concluído", data_lancamento: "2026-11-01", hora_lancamento: "09:00", descricao: "retroativa" },
      ...HISTORICO,
    ];
    noDialogo({});
    await screen.findByText("189 cab");
    const ultimo = grupo("Último registro");
    expect(ultimo.querySelector(".mk-dp-linha__rot")?.textContent).toBe("Inspeção");
    expect(ultimo.querySelector(".mk-dp-linha__sub")?.textContent).toBe("Nível bom, boia funcionando.");
    expect(ultimo.querySelector(".mk-dp-linha__val")?.textContent).toBe(`${brasil("2026-11-10")} · 08:30 · João`);
  });

  it("Histórico do bebedouro: os 5 mais recentes pela data, um ícone por tipo e só as linhas que o lançamento tem; 'Ver tudo' abre o diálogo do Histórico por cima", async () => {
    largura(1280);
    estado.historico = [
      ...HISTORICO,
      { id: "h0", tipo_lancamento: "Manutenção", status: "Pendente", data_lancamento: "2026-10-20", descricao: "boia presa" },
      { id: "h-1", tipo_lancamento: "Abastecimento", status: "Concluído", data_lancamento: "2026-10-18" },
      { id: "h-2", tipo_lancamento: "Outro", status: "Concluído", data_lancamento: "2026-10-15" },
      { id: "h-3", tipo_lancamento: "Limpeza", status: "Concluído", data_lancamento: "2026-10-01" },
      { id: "h-4", tipo_lancamento: "Limpeza", status: "Concluído", data_lancamento: "2026-11-10", hora_lancamento: "07:00" },
    ];
    noDialogo({ podeExcluir: true });
    await screen.findByText("189 cab");
    const lista = screen.getByRole("list", { name: "Registros do bebedouro" });
    expect([...lista.querySelectorAll(".mk-dp-tl__dia")].map((d) => d.textContent)).toEqual(["10 NOV. 2026", "01 NOV. 2026", "20 OUT. 2026", "18 OUT. 2026"]);
    const tl = [...lista.querySelectorAll(".mk-dp-tl__card")];
    expect(tl.map((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent)).toEqual(["Inspeção", "Limpeza", "Limpeza", "Manutenção", "Abastecimento"]);
    expect(tl.map((c) => [...c.querySelector("svg")?.classList ?? []].find((k) => k.startsWith("lucide-")))).toEqual([
      "lucide-eye",
      "lucide-sparkles",
      "lucide-sparkles",
      "lucide-wrench",
      "lucide-droplet",
    ]);
    const linhasTl = (c) => [...c.querySelectorAll(".mk-dp-tl__row")].map((r) => `${r.querySelector("dt")?.textContent}: ${r.querySelector("dd")?.textContent}`);
    expect(linhasTl(tl[0])).toEqual(["Descrição: Nível bom, boia funcionando.", "Registrado por: João", "Qualidade da água: Boa", "Escore da água: 4,5"]);
    expect(linhasTl(tl[2])).toEqual(["Descrição: Limpeza completa.", "Registrado por: João", "Custo: R$ 1.240,00", "Produto: CLORO", "Quantidade: 2"]);
    expect(linhasTl(tl[3])).toEqual(["Descrição: boia presa", "Status: Pendente"]);
    expect(linhasTl(tl[4])).toEqual(["Descrição: —"]);
    // nada de "Excluir" no resumo: só no histórico completo
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();

    await clicar(screen.getByRole("button", { name: "Ver tudo" }));
    // D-PROD-222: o MESMO diálogo do Histórico, por cima do detalhe (que fica como estava).
    expect(dialogos()).toHaveLength(2);
    expect(tituloDe(ultimoDialogo())).toBe("Histórico do Bebedouro (7)");
    expect(cartoes()).toHaveLength(7);
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
  });

  it("sem lançamento: 'Nenhum lançamento ainda.' no último registro e a linha do tempo vazia; sem 'Ver tudo'", async () => {
    largura(390);
    estado.historico = [];
    noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    expect(document.querySelector(".mk-dp")?.getAttribute("data-modo")).toBe("celular");
    const ultimo = grupo("Último registro");
    expect(within(ultimo).getByText("Nenhum lançamento ainda.").closest(".mk-dp-linha")?.className).toContain("mk-dp-bebedouro__fraco");
    expect(celula(grupo("Resumo operacional"), "Próxima limpeza")).toBe("—");
    expect(celula(grupo("Resumo operacional"), "Custo acumulado")).toBe("R$ 0,00");
    expect(screen.queryByRole("list", { name: "Registros do bebedouro" })).toBeNull();
    expect(screen.getByText("Nenhum registro.").closest(".mk-dp-vazio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver tudo" })).toBeNull();
  });
});

describe("Rodapé Lançar · Histórico pela regra do servidor (D-PROD-137)", () => {
  it("com permissão: Lançar (+) e Histórico; o Lançar fica fora da heurística de texto do Layout", async () => {
    largura(1280);
    noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    expect(pilulas()).toEqual(["Lançar", "Histórico"]);
    const lancar = screen.getByRole("button", { name: "Lançar" });
    expect(lancar.querySelector("svg.lucide-plus")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Histórico" }).querySelector("svg.lucide-history")).toBeTruthy();
    expect(lancar.closest("[data-permissao-explicita]")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("sem permissão de lançar (padrão false): só Histórico", async () => {
    largura(1280);
    noDialogo({});
    await screen.findByText("189 cab");
    expect(pilulas()).toEqual(["Histórico"]);
    expect(screen.queryByRole("button", { name: "Lançar" })).toBeNull();
  });

  it("ponto sem cadastro (BEB-03): aviso logo depois do cartão e sem Lançar, mesmo com a permissão", async () => {
    largura(1280);
    const semCadastro = { ...BEBEDOURO, id: undefined, nome: "BEBEDOURO NORTE" };
    noDialogo({ bebedouro: semCadastro, podeLancar: true });
    await screen.findByText("189 cab");
    const aviso = screen.getByRole("note");
    expect(aviso.textContent).toBe("Ponto sem cadastro de bebedouro: cadastre-o no Mapa Cadastro para registrar lançamentos.");
    expect(aviso.className).toContain("mk-dp-aviso--atencao");
    expect(aviso.previousElementSibling?.className).toContain("mk-dp-cartao");
    expect(pilulas()).toEqual(["Histórico"]);
    expect(tituloDoDialogo()).toBe("BEBEDOURO NORTE");
  });
});

describe("Foco ao abrir e ao fechar o Lançar e o Histórico (D-PROD-222)", () => {
  it("Lançar: abre no ✕ e, fechado, o foco volta à pílula 'Lançar'; Histórico: abre no próprio diálogo (não no ✕ nem na pílula escondida) e volta à pílula 'Histórico'", async () => {
    largura(1280);
    noDialogo({ podeLancar: true, podeExcluir: true });
    await screen.findByText("189 cab");
    const lancar = screen.getByRole("button", { name: "Lançar" });
    lancar.focus();
    await clicar(lancar);
    const lanc = ultimoDialogo();
    await waitFor(() => expect(lanc.contains(document.activeElement)).toBe(true));
    await clicar(within(lanc).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(dialogos()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Lançar" })));

    const historico = screen.getByRole("button", { name: "Histórico" });
    historico.focus();
    await clicar(historico);
    const hist = ultimoDialogo();
    await waitFor(() => expect(document.activeElement).toBe(hist));
    await clicar(within(hist).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(dialogos()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Histórico" })));
  });
});

describe("Histórico por cima do detalhe, nos cartões do manejo (D-PROD-222)", () => {
  it("abre num LancLoteDialogo largo e só de leitura POR CIMA: título com a contagem, o bebedouro no subtítulo, só o ✕; o detalhe fica por baixo; no popup o Esc não fecha e o ✕ fecha", async () => {
    largura(1280);
    noDialogo({ podeLancar: true, podeExcluir: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(dialogos()).toHaveLength(2);
    const hist = ultimoDialogo();
    expect(tituloDe(hist)).toBe("Histórico do Bebedouro (2)");
    expect(subDe(hist)).toBe("Bebedouro 01");
    expect(hist.className).toContain("mk-ll-dlg--largo");
    expect(hist.className).toContain("is-desktop");
    // Só leitura: só o ✕; sem ✓ e sem o ‹ Voltar das telas empilhadas.
    expect(within(hist).getByRole("button", { name: "Fechar" })).toBeTruthy();
    expect(hist.querySelector(".mg-act-salvar, .mk-ll-dlg__redondo--salvar")).toBeNull();
    expect(within(hist).queryByRole("button", { name: "Voltar" })).toBeNull();
    // A moldura dos históricos do manejo, sem a linha do tempo v12 nem o "Lançamentos (N)".
    expect(hist.querySelector(".mk-ll > .mk-hist > .mk-hist__corpo > .mk-hist__lista")?.children).toHaveLength(2);
    expect(hist.querySelector(".mk-dp, .mk-dp-tl")).toBeNull();
    expect(within(hist).queryByText(/^Lançamentos \(/)).toBeNull();
    // O detalhe continua por baixo, como estava.
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(subDoDialogo()).toBe("Bebedouro");
    expect(corpo().className).not.toMatch(/mk-dp-anim--/);
    // Popup (D-PROD-125): o Esc não fecha; o ✕ fecha e devolve o detalhe.
    await esc();
    expect(dialogos()).toHaveLength(2);
    await clicar(within(hist).getByRole("button", { name: "Fechar" }));
    expect(dialogos()).toHaveLength(1);
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(pilulas()).toEqual(["Lançar", "Histórico"]);
  });

  it("sem permissão de excluir: sem Excluir; abaixo de 1024 px abre em tela cheia, com o ✕ redondo, que fecha", async () => {
    largura(820);
    noDialogo({});
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const hist = ultimoDialogo();
    expect(hist.className).toContain("is-tela");
    expect(tituloDe(hist)).toBe("Histórico do Bebedouro (2)");
    expect(cartoes()).toHaveLength(2);
    expect(within(hist).queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(cartoes().map((c) => partes(c).rodape)).toEqual([null, null]);
    const fechar = within(hist).getByRole("button", { name: "Fechar" });
    expect(fechar.className).toContain("mk-ll-dlg__redondo");
    await clicar(fechar);
    expect(dialogos()).toHaveLength(1);
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
  });

  it("um CartaoHistorico por lançamento, NA ORDEM DO SERVIDOR: selos de data (dd/mm/aaaa), tipo e status fora do normal; o bebedouro em negrito; as linhas de hoje (a Hora quando gravada); Excluir no rodapé, só o índice 0 ligado", async () => {
    largura(1280);
    // Ordem do servidor (criação desc.): um retroativo (10/10) entrou depois do de 01/11.
    estado.historico = [
      HISTORICO[0],
      { id: "h-retro", tipo_lancamento: "Manutenção", status: "Pendente", data_lancamento: "2026-10-10", descricao: "boia presa" },
      HISTORICO[1],
      { id: "h-urg", tipo_lancamento: "Vazamento", status: "Emergencial", data_lancamento: "2026-10-05T00:00:00.000Z" },
    ];
    noDialogo({ podeExcluir: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(tituloDe(ultimoDialogo())).toBe("Histórico do Bebedouro (4)");
    const cs = cartoes();
    expect(cs.map(selos)).toEqual([
      ["10/11/2026", "Inspeção"],
      ["10/10/2026", "Manutenção", "Pendente"],
      ["01/11/2026", "Limpeza"],
      ["05/10/2026", "Vazamento", "Emergencial"],
    ]);
    expect(cs.map((c) => partes(c).titulo.textContent)).toEqual(["Bebedouro 01", "Bebedouro 01", "Bebedouro 01", "Bebedouro 01"]);
    expect(linhas(cs[0])).toEqual(["Hora: 08:30", "Descrição: Nível bom, boia funcionando.", "Registrado por: João", "Qualidade da água: Boa", "Escore da água: 4,5"]);
    // Sem hora gravada, sem a linha Hora; o status fora do normal é selo, não linha.
    expect(linhas(cs[1])).toEqual(["Descrição: boia presa"]);
    expect(linhas(cs[2])).toEqual(["Hora: 07:00", "Descrição: Limpeza completa.", "Registrado por: João", "Custo: R$ 1.240,00", "Produto: CLORO", "Quantidade: 2"]);
    expect(linhas(cs[3])).toEqual(["Descrição: —"]);
    // Tom do selo do status: pendente em âmbar, emergencial em vermelho (como os selos do manejo).
    expect(partes(cs[1]).fileira.children[2].className).toContain("text-amber-800");
    expect(partes(cs[3]).fileira.children[2].className).toContain("text-red-800");
    // O "Excluir" no rodapé de cada cartão; só o mais recente (índice 0 do servidor) liga.
    const pes = cs.map(excluirDe);
    expect(pes.map((b) => b?.textContent)).toEqual(["Excluir", "Excluir", "Excluir", "Excluir"]);
    expect(pes.map((b) => b?.disabled)).toEqual([false, true, true, true]);
    expect(pes.map((b) => b?.getAttribute("title") ?? null)).toEqual([null, SO_O_ULTIMO, SO_O_ULTIMO, SO_O_ULTIMO]);
    expect(pes.every((b) => b?.closest("[data-permissao-explicita]"))).toBe(true);
    expect(pes[0]?.className).toContain("text-red-700");
    // Sem rolagem própria: o diálogo é quem rola.
    expect(ultimoDialogo().querySelector('[class*="max-h-"]')).toBeNull();
  });

  it("o retroativo lançado por último é o 1º da lista e o único com Excluir; o 'Último registro' (pela data) fica desligado, com a regra no title", async () => {
    largura(1280);
    // Ordem do servidor (criação desc.): a Limpeza de 01/11 foi lançada depois da Inspeção de 10/11.
    estado.historico = [
      { id: "h3", tipo_lancamento: "Limpeza", status: "Concluído", data_lancamento: "2026-11-01", hora_lancamento: "09:00", descricao: "retroativa" },
      ...HISTORICO,
    ];
    noDialogo({ podeExcluir: true });
    await screen.findByText("189 cab");
    expect(grupo("Último registro").querySelector(".mk-dp-linha__rot")?.textContent).toBe("Inspeção");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const cs = cartoes();
    expect(cs.map((c) => selos(c)[1])).toEqual(["Limpeza", "Inspeção", "Limpeza"]);
    const pes = cs.map(excluirDe);
    expect(pes.map((b) => b?.disabled)).toEqual([false, true, true]);
    expect(pes[0]?.getAttribute("title")).toBeNull();
    // A Inspeção de 10/11 é o "Último registro" do resumo: o title não diz que ela "não é a mais recente".
    expect(pes[1]?.getAttribute("title")).toBe(SO_O_ULTIMO);
  });

  it("Excluir: a mesma confirmação; apaga o índice 0 e relê as duas listas; o 409 e a recusa viram as mensagens de antes", async () => {
    largura(1280);
    const cliente = novoCliente();
    const invalidar = vi.spyOn(cliente, "invalidateQueries");
    const chaves = () => invalidar.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    noDialogo({ podeExcluir: true }, cliente);
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const excluir = () => within(ultimoDialogo()).getAllByRole("button", { name: "Excluir" });

    // Confirmação recusada: nada apagado.
    vi.mocked(confirmarExclusao).mockResolvedValueOnce(false);
    await clicar(excluir()[0]);
    expect(confirmarExclusao).toHaveBeenLastCalledWith("Excluir este lançamento do bebedouro?");
    expect(servico.excluidos).toEqual([]);

    // Confirmado: apaga o último lançado no sistema (índice 0) e relê as duas chaves.
    await clicar(excluir()[0]);
    await waitFor(() => expect(servico.excluidos).toEqual(["h2"]));
    await waitFor(() => expect(chaves()).toEqual(expect.arrayContaining([JSON.stringify(["bebedouro-historico"]), JSON.stringify(["bebedouro-historico-all"])])));
    expect(toast.error).not.toHaveBeenCalled();

    // 409 (entrou um lançamento mais novo): a mensagem de antes, nada apagado, e relê.
    invalidar.mockClear();
    servico.erroAoExcluir = Object.assign(new Error("409"), { cause: { code: "BEBEDOUROHISTORICO_SOMENTE_ULTIMO" } });
    await clicar(excluir()[0]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenLastCalledWith("Há um lançamento mais recente deste bebedouro: só o último pode ser excluído. Nada foi apagado; a lista foi atualizada."),
    );
    expect(chaves()).toEqual(expect.arrayContaining([JSON.stringify(["bebedouro-historico"]), JSON.stringify(["bebedouro-historico-all"])]));

    // Outra recusa: a mensagem geral; o botão volta a funcionar.
    servico.erroAoExcluir = new Error("rede");
    await clicar(excluir()[0]);
    await waitFor(() => expect(toast.error).toHaveBeenLastCalledWith("Não foi possível excluir o lançamento. Nada foi apagado."));
    await waitFor(() => expect(excluir()[0]).not.toBeDisabled());
    expect(servico.excluidos).toEqual(["h2"]);

    // O desligado não chama nada.
    const chamadas = vi.mocked(confirmarExclusao).mock.calls.length;
    await clicar(excluir()[1]);
    expect(vi.mocked(confirmarExclusao).mock.calls.length).toBe(chamadas);
  });

  it("o cartão é o CartaoHistorico (o do Histórico de Movimentação do manejo): mesmas classes na raiz, nos selos, no título, nas linhas e no rodapé", async () => {
    largura(1280);
    noDialogo({ podeExcluir: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const classes = (c) => {
      const p = partes(c);
      return {
        cartao: c.className,
        fileira: p.fileira.className,
        data: p.fileira.children[0].className,
        selo: p.fileira.children[1].className,
        titulo: p.titulo.className,
        linhas: p.linhas.className,
        rodape: p.rodape?.className ?? null,
        lista: c.parentElement?.className,
      };
    };
    const doBebedouro = classes(cartoes()[0]);
    cleanup();

    render(
      <div className="mk-hist__lista">
        <CartaoHistorico
          data-testid="lancamento-bebedouro"
          selos={
            <>
              <SeloHistorico tom="data">10/11/2026</SeloHistorico>
              <SeloHistorico>Inspeção</SeloHistorico>
            </>
          }
          titulo="Bebedouro 01"
          rodape={<button type="button">Excluir</button>}
        >
          <LinhaHistorico rotulo="Descrição">x</LinhaHistorico>
        </CartaoHistorico>
      </div>,
    );
    expect(doBebedouro).toEqual(classes(cartoes()[0]));
  });
});

describe("Lançar por cima do detalhe, no desenho do manejo (D-PROD-222)", () => {
  it("abre num LancLoteDialogo por cima: 'Lançamento no Bebedouro', o bebedouro no subtítulo, ✕ e ✓ no cabeçalho; os campos em LancField (rótulo dentro); sem cartão, faixa de título nem botões no pé", async () => {
    largura(1280);
    noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    expect(dialogos()).toHaveLength(2);
    const lanc = ultimoDialogo();
    expect(tituloDe(lanc)).toBe("Lançamento no Bebedouro");
    expect(subDe(lanc)).toBe("Bebedouro 01");
    // Popup no desktop, do tamanho dos manejos (não o largo dos históricos).
    expect(lanc.className).toContain("is-desktop");
    expect(lanc.className).not.toContain("mk-ll-dlg--largo");
    // O detalhe continua por baixo.
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    // O <form> do diálogo (LancLoteForm) e o ✓ do cabeçalho que o envia.
    const form = /** @type {HTMLFormElement} */ (within(lanc).getByTestId("form-lancamento-bebedouro"));
    expect(form.tagName).toBe("FORM");
    expect(form.classList.contains("mk-ll")).toBe(true);
    const ok = within(lanc).getByRole("button", { name: "Registrar Lançamento" });
    expect(ok.closest(".mk-ll-dlg__head")).toBeTruthy();
    expect(ok.getAttribute("type")).toBe("submit");
    expect(ok.getAttribute("form")).toBe(form.id);
    expect(within(lanc).getByRole("button", { name: "Cancelar" }).closest(".mk-ll-dlg__head")).toBeTruthy();
    // Os rótulos dentro das caixas (LancField), com o * dos obrigatórios; Inspeção pede a qualidade da água.
    expect([...form.querySelectorAll(".mk-lanc .mg-field__label")].map((l) => l.textContent)).toEqual([
      "Data *",
      "Hora",
      "Tipo *",
      "Status *",
      "Escore da água",
      "Qualidade da água",
      "Observação",
    ]);
    // Campos lado a lado na grade do manejo.
    expect(form.querySelector(".mk-ll__grade")?.children).toHaveLength(4);
    // Tipo, Status e Qualidade da água são o campo de escolha dos manejos (B1Select, como Categoria e
    // Causa), não o Select do Radix: o botão do B1Select, e a lista abre no painel das listas do sistema.
    const escolhas = /** @type {HTMLElement[]} */ ([...form.querySelectorAll('button[role="combobox"]')]);
    expect(escolhas.map((b) => b.closest(".mg-field")?.querySelector("label")?.textContent)).toEqual(["Tipo *", "Status *", "Qualidade da água"]);
    for (const b of escolhas) {
      expect(b.classList.contains("b1-select-btn")).toBe(true);
      expect(b.hasAttribute("aria-autocomplete")).toBe(false);
    }
    await clicar(escolhas[0]);
    const painel = await screen.findByRole("listbox", { name: "opções" });
    expect(painel.classList.contains("mk-sel-lista")).toBe(true);
    expect(within(painel).getByRole("option", { name: "Inspeção" }).getAttribute("aria-selected")).toBe("true");
    // Nada do desenho antigo: sem cartão, faixa de título, caixa interna, rodapé de botões nem "Salvar lançamento".
    expect(form.querySelector(".mk-ll__rodape, .tb-btn, .rounded-md.border")).toBeNull();
    expect(within(lanc).queryByRole("button", { name: /Salvar lançamento/ })).toBeNull();
    expect(within(lanc).queryByText("Lançamento do bebedouro")).toBeNull();
    expect(within(lanc).queryByRole("button", { name: "Voltar" })).toBeNull();
    expect(document.querySelector(".mk-dp-bebedouro__form")).toBeNull();
  });

  it("no celular: tela cheia, com o ✕ à esquerda, o título no meio e o ✓ à direita", async () => {
    largura(390);
    noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    const lanc = ultimoDialogo();
    expect(lanc.className).toContain("is-tela");
    const cab = /** @type {HTMLElement} */ (lanc.querySelector(".mk-ll-dlg__head"));
    const [esquerda, meio, direita] = [...cab.children];
    expect(esquerda.getAttribute("aria-label")).toBe("Cancelar");
    expect(meio.querySelector(".mk-ll-dlg__titulo")?.textContent).toBe("Lançamento no Bebedouro");
    expect(direita.getAttribute("aria-label")).toBe("Registrar Lançamento");
    // As listas do Tipo, Status e Qualidade são a folha dos manejos, DENTRO deste diálogo (D-PROD-161).
    await clicar(within(lanc).getByRole("combobox", { name: /^Status/ }));
    const opcao = await screen.findByRole("option", { name: "Pendente" });
    expect(opcao.closest(".mk-sheet")).toBeTruthy();
    expect(opcao.closest(".mk-ll-dlg")).toBe(lanc);
    await clicar(opcao);
    expect(within(lanc).getByRole("combobox", { name: /^Status/ })).toHaveTextContent("Pendente");

    // Com a lista aberta, o Esc fecha só a lista (o Lançar fica, com o que foi escolhido); o segundo
    // Esc fecha o Lançar, como nos demais manejos (D-PROD-161: a regra é do LancLoteDialogo).
    await clicar(within(lanc).getByRole("combobox", { name: /^Tipo/ }));
    expect(await screen.findByRole("option", { name: "Limpeza" })).toBeTruthy();
    await esc();
    await waitFor(() => expect(screen.queryByRole("option", { name: "Limpeza" })).toBeNull());
    expect(lanc.isConnected).toBe(true);
    expect(dialogos()).toHaveLength(2);
    expect(within(lanc).getByRole("combobox", { name: /^Status/ })).toHaveTextContent("Pendente");
    await esc();
    await waitFor(() => expect(dialogos()).toHaveLength(1));
    expect(servico.criados).toEqual([]);
  });

  it("o ✓ do cabeçalho envia os campos e padrões de antes (Data hoje, Hora agora, Inspeção, Concluído, Qualidade Boa; texto em maiúsculas); mensagem de sucesso, as duas invalidações, e o diálogo fecha", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));
    const hoje = new Date().toISOString().split("T")[0];
    const agora = new Date().toTimeString().slice(0, 5);
    largura(1280);
    const cliente = novoCliente();
    const invalidar = vi.spyOn(cliente, "invalidateQueries");
    noDialogo({ podeLancar: true }, cliente);
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    const lanc = ultimoDialogo();
    expect(within(lanc).getByLabelText(/^Data/)).toHaveValue(hoje);
    expect(within(lanc).getByLabelText(/^Hora/)).toHaveValue(agora);
    expect(within(lanc).getByRole("combobox", { name: /^Tipo/ })).toHaveTextContent("Inspeção");
    expect(within(lanc).getByRole("combobox", { name: /^Status/ })).toHaveTextContent("Concluído");
    expect(within(lanc).getByRole("combobox", { name: /^Qualidade da água/ })).toHaveTextContent("Boa");
    fireEvent.change(within(lanc).getByLabelText("Escore da água"), { target: { value: "4.5" } });
    fireEvent.change(within(lanc).getByLabelText("Observação"), { target: { value: "boia ok" } });

    await clicar(within(lanc).getByRole("button", { name: "Registrar Lançamento" }));
    await waitFor(() => expect(dialogos()).toHaveLength(1));
    expect(servico.criados).toEqual([
      {
        empresa_id: EMPRESA,
        bebedouro_id: "beb-1",
        bebedouro_nome: "Bebedouro 01",
        data_lancamento: hoje,
        hora_lancamento: agora,
        responsavel: "João",
        tipo_lancamento: "Inspeção",
        descricao: "BOIA OK",
        status: "Concluído",
        escore_agua: 4.5,
        qualidade_agua: "Boa",
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Lançamento registrado.");
    const chaves = invalidar.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(chaves).toEqual(expect.arrayContaining([JSON.stringify(["bebedouro-historico", EMPRESA, "beb-1"]), JSON.stringify(["bebedouro-historico-all", EMPRESA])]));
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
  });

  it("trocar o Tipo mostra e esconde os campos como antes; a Qualidade da água remonta com o valor e o rótulo em cima; o envio leva só os campos do tipo", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    largura(1280);
    noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    const lanc = ultimoDialogo();
    const rotulos = () => [...lanc.querySelectorAll("form .mk-lanc .mg-field__label")].map((l) => l.textContent);
    const tipo = async (valor) => {
      await clicar(within(lanc).getByRole("combobox", { name: /^Tipo/ }));
      await clicar(screen.getByRole("option", { name: valor }));
    };

    await tipo("Limpeza");
    expect(rotulos()).toEqual(["Data *", "Hora", "Tipo *", "Status *", "Produto utilizado", "Quantidade", "Custo", "Observação"]);
    await tipo("Manutenção");
    expect(rotulos()).toEqual(["Data *", "Hora", "Tipo *", "Status *", "Custo", "Observação"]);
    await tipo("Inspeção");
    expect(rotulos()).toEqual(["Data *", "Hora", "Tipo *", "Status *", "Escore da água", "Qualidade da água", "Observação"]);
    // A Qualidade voltou (remontou) com o valor de antes e o rótulo em cima do valor (D-PROD-220).
    const qualidade = within(lanc).getByRole("combobox", { name: /^Qualidade da água/ });
    expect(qualidade).toHaveTextContent("Boa");
    expect(qualidade.closest(".mg-field")).toHaveClass("mg-has-value");

    await tipo("Limpeza");
    fireEvent.change(within(lanc).getByLabelText("Produto utilizado"), { target: { value: "cloro" } });
    fireEvent.change(within(lanc).getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(within(lanc).getByLabelText("Custo"), { target: { value: "1240" } });
    await clicar(within(lanc).getByRole("button", { name: "Registrar Lançamento" }));
    await waitFor(() => expect(servico.criados).toHaveLength(1));
    const enviado = servico.criados[0];
    expect(enviado).toMatchObject({ tipo_lancamento: "Limpeza", produto_utilizado: "CLORO", quantidade_utilizada: 2, custo: 1240 });
    expect(enviado).not.toHaveProperty("escore_agua");
    expect(enviado).not.toHaveProperty("qualidade_agua");
  });

  it("✕ fecha sem enviar; a recusa do servidor vira mensagem e o diálogo fica aberto; permissão revogada com o formulário aberto fecha o diálogo e tira o Lançar", async () => {
    largura(1280);
    const { refazer } = noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    await clicar(within(ultimoDialogo()).getByRole("button", { name: "Cancelar" }));
    expect(dialogos()).toHaveLength(1);
    expect(servico.criados).toEqual([]);

    servico.erroAoCriar = new Error("recusado");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    await clicar(within(ultimoDialogo()).getByRole("button", { name: "Registrar Lançamento" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Não foi possível registrar o lançamento. Nada foi gravado."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(dialogos()).toHaveLength(2);
    expect(within(ultimoDialogo()).getByRole("button", { name: "Registrar Lançamento" })).not.toBeDisabled();

    await act(async () => { refazer({ podeLancar: false }); });
    expect(dialogos()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Registrar Lançamento" })).toBeNull();
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(pilulas()).toEqual(["Histórico"]);
  });

  it("no popup, o Esc não fecha o formulário nem apaga o que foi digitado (D-PROD-125, como nos manejos)", async () => {
    largura(1280);
    noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    const obs = within(ultimoDialogo()).getByLabelText("Observação");
    fireEvent.change(obs, { target: { value: "BOIA VAZANDO" } });
    obs.focus();
    await esc();
    expect(dialogos()).toHaveLength(2);
    expect(tituloDe(ultimoDialogo())).toBe("Lançamento no Bebedouro");
    expect(/** @type {HTMLTextAreaElement} */ (within(ultimoDialogo()).getByLabelText("Observação")).value).toBe("BOIA VAZANDO");
  });
});

describe("Fora do diálogo", () => {
  it("tela Bebedouros (semCabecalho): sem o cabeçalho próprio; Lançar e Histórico abrem por cima da página; onSubFlowChange trava a navegação enquanto um deles está aberto", async () => {
    largura(1280);
    const subFluxo = vi.fn();
    render(
      <QueryClientProvider client={novoCliente()}>
        <DetalhesBebedouro bebedouro={BEBEDOURO} podeLancar onSubFlowChange={subFluxo} semCabecalho />
      </QueryClientProvider>,
    );
    await screen.findByText("189 cab");
    expect(document.querySelector(".mk-dp")).toBeTruthy();
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    expect(subFluxo).toHaveBeenLastCalledWith(false);
    expect(dialogos()).toHaveLength(0);

    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(dialogos()).toHaveLength(1);
    expect(tituloDe(ultimoDialogo())).toBe("Histórico do Bebedouro (2)");
    expect(subDe(ultimoDialogo())).toBe("Bebedouro 01");
    expect(subFluxo).toHaveBeenLastCalledWith(true);
    // Sem "Voltar ao resumo": o resumo continua na página, por baixo do diálogo.
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    await clicar(within(ultimoDialogo()).getByRole("button", { name: "Fechar" }));
    expect(dialogos()).toHaveLength(0);
    expect(subFluxo).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("group", { name: "Resumo operacional" })).toBeTruthy();

    await clicar(screen.getByRole("button", { name: "Lançar" }));
    expect(tituloDe(ultimoDialogo())).toBe("Lançamento no Bebedouro");
    expect(subFluxo).toHaveBeenLastCalledWith(true);
    await clicar(within(ultimoDialogo()).getByRole("button", { name: "Cancelar" }));
    expect(dialogos()).toHaveLength(0);
    expect(subFluxo).toHaveBeenLastCalledWith(false);
    expect(servico.criados).toEqual([]);
  });

  it("sem semCabecalho (padrão): cabeçalho próprio com o nome; o Histórico abre por cima (tela cheia no celular) e o ✕ devolve o detalhe", async () => {
    largura(390);
    render(
      <QueryClientProvider client={novoCliente()}>
        <DetalhesBebedouro bebedouro={BEBEDOURO} />
      </QueryClientProvider>,
    );
    await screen.findByText("189 cab");
    expect(screen.getByRole("heading", { name: "Bebedouro 01" })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const hist = ultimoDialogo();
    expect(hist.className).toContain("is-tela");
    expect(within(hist).getByRole("heading", { name: "Histórico do Bebedouro (2)" })).toBeTruthy();
    expect(within(hist).queryByRole("button", { name: "Voltar" })).toBeNull();
    await clicar(within(hist).getByRole("button", { name: "Fechar" }));
    expect(dialogos()).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Bebedouro 01" })).toBeTruthy();
  });
});

describe("Histórico carregando ou com erro", () => {
  it("carregando: o detalhe diz que está carregando, sem 'Nenhum lançamento ainda.' nem custo R$ 0,00", async () => {
    largura(1280);
    estado.historico = [];
    estado.consulta = { isPlaceholderData: true };
    noDialogo({ podeExcluir: true });
    await screen.findByText("189 cab");
    expect(within(grupo("Último registro")).getByText("Carregando...")).toBeTruthy();
    expect(screen.queryByText("Nenhum lançamento ainda.")).toBeNull();
    expect(celula(grupo("Resumo operacional"), "Custo acumulado")).toBe("—");
    expect(screen.getByRole("status").textContent).toBe("Carregando histórico...");
    expect(screen.queryByText("Nenhum registro.")).toBeNull();
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    // No diálogo do Histórico: o estado do manejo, sem contagem e sem "Nenhum lançamento encontrado.".
    const hist = ultimoDialogo();
    expect(within(hist).getByRole("status").textContent).toBe("Carregando histórico...");
    expect(tituloDe(hist)).toBe("Histórico do Bebedouro");
    expect(within(hist).queryByText("Nenhum lançamento encontrado.")).toBeNull();
  });

  it("erro sem dados: o aviso 'Não foi possível carregar o histórico.' no resumo e no diálogo do Histórico", async () => {
    largura(1280);
    estado.historico = [];
    const tentarDeNovo = vi.fn();
    estado.consulta = { isError: true, error: new Error("Sem conexão com o servidor."), refetch: tentarDeNovo };
    noDialogo({});
    await screen.findByText("189 cab");
    expect(screen.getByRole("alert").textContent).toBe("Não foi possível carregar o histórico.");
    expect(celula(grupo("Resumo operacional"), "Custo acumulado")).toBe("—");
    expect(screen.queryByText("Nenhum lançamento ainda.")).toBeNull();
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const hist = ultimoDialogo();
    // O estado de erro do Histórico de Movimentação: a frase, o motivo e o "Tentar novamente" (D-PROD-222).
    const alerta = within(hist).getByRole("alert");
    // Um erro que não é do servidor não mostra a mensagem crua: o texto padrão, como na referência.
    expect([...alerta.children].map((c) => c.textContent)).toEqual(["Não foi possível carregar o histórico.", "Tente novamente em instantes.", "Tentar novamente"]);
    await clicar(within(alerta).getByRole("button", { name: "Tentar novamente" }));
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
    expect(tituloDe(hist)).toBe("Histórico do Bebedouro");
    expect(within(hist).queryByText("Nenhum lançamento encontrado.")).toBeNull();
  });

  it("erro com a lista já lida: mostra a lista (o erro não apaga o que já se sabe)", async () => {
    largura(1280);
    estado.consulta = { isError: true };
    noDialogo({});
    await screen.findByText("189 cab");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("list", { name: "Registros do bebedouro" })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(cartoes()).toHaveLength(2);
    expect(tituloDe(ultimoDialogo())).toBe("Histórico do Bebedouro (2)");
  });

  it("sem lançamento: o diálogo do Histórico diz 'Nenhum lançamento encontrado.', sem contagem", async () => {
    largura(1280);
    estado.historico = [];
    noDialogo({});
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const hist = ultimoDialogo();
    expect(within(hist).getByText("Nenhum lançamento encontrado.")).toBeTruthy();
    expect(tituloDe(hist)).toBe("Histórico do Bebedouro");
    expect(cartoes()).toHaveLength(0);
  });
});

describe("Selo de data dos cartões do Histórico (diaDoLancamento)", () => {
  it("sem data (ausente, vazia ou só espaços): 'Sem data'", () => {
    expect([undefined, null, "", "   "].map(diaDoLancamento)).toEqual(["Sem data", "Sem data", "Sem data", "Sem data"]);
  });

  it("AAAA-MM-DD ou ISO: dd/mm/aaaa pelo dia gravado, sem passar por fuso", () => {
    expect(diaDoLancamento("2026-11-10")).toBe("10/11/2026");
    expect(diaDoLancamento(" 2026-11-10 ")).toBe("10/11/2026");
    // 23:30 em Brasília já é dia 06 em UTC: o selo mostra o dia gravado.
    expect(diaDoLancamento("2026-10-05T23:30:00-03:00")).toBe("05/10/2026");
  });

  it("outro formato: a data que o navegador lê, em dd/mm/aaaa; o que não for data aparece como foi gravado", () => {
    expect(diaDoLancamento("2026/11/10")).toBe("10/11/2026");
    expect(diaDoLancamento("ontem")).toBe("ontem");
  });
});
