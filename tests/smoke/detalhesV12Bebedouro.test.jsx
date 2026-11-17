// @vitest-environment jsdom
/**
 * D-PROD-220 — detalhe do bebedouro no desenho do Detalhes do Lote v12 (tela
 * `telaBebedouro`): raiz `.mk-dp` filha do `.mk-ll` do diálogo, título/sub
 * publicados no cabeçalho do diálogo, blocos na ordem do v12 (cartão, aviso,
 * Resumo operacional, Último registro, Informações, Histórico), rodapé
 * Lançar · Histórico pela regra do servidor (D-PROD-137) e as telas empilhadas
 * (Histórico com a linha do tempo de hoje e o "Excluir"; Lançamento com o
 * formulário de hoje), com ‹ Voltar e Esc. Fora do diálogo: a tela Bebedouros
 * (barra do registro) fica sem o cabeçalho próprio.
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
    servico.criados.push(dados);
    return { id: "novo", ...dados };
  }),
  excluirHistorico: vi.fn(async (id) => {
    servico.excluidos.push(id);
    return null;
  }),
}));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ full_name: "João" }) }));
vi.mock("@/lib/maikeConfirmar", () => ({ confirmarExclusao: async () => true }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import DetalhesBebedouro from "@/components/bebedouros/DetalhesBebedouro";

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
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = original;
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

const tituloDoDialogo = () => document.querySelector(".mk-ll-dlg__titulo")?.textContent;
const subDoDialogo = () => document.querySelector(".mk-ll-dlg__lotes")?.textContent ?? null;
const pilulas = () => [...document.querySelectorAll(".mk-dp-pilula")].map((b) => b.textContent);
const corpo = () => /** @type {HTMLElement} */ (document.querySelector(".mk-dp__corpo"));
const grupo = (nome) => screen.getByRole("group", { name: nome });
/** Valor da célula (dt → dd) dentro de um grupo. */
const celula = (g, rotulo) => within(g).getByText(rotulo, { selector: "dt" }).nextElementSibling?.textContent;
const esc = () => act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: "Escape", code: "Escape" }); });
const clicar = (el) => act(async () => { fireEvent.click(el); });

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
    expect([...corpo().querySelectorAll(".mk-dp-titulo__h")].map((h) => h.textContent)).toEqual([
      "Resumo operacional",
      "Último registro",
      "Informações do bebedouro",
      "Histórico do bebedouro",
    ]);
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

  it("Histórico do bebedouro: os 5 mais recentes pela data, um ícone por tipo e só as linhas que o lançamento tem; 'Ver tudo' abre o histórico completo", async () => {
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
    const cartoes = [...lista.querySelectorAll(".mk-dp-tl__card")];
    expect(cartoes.map((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent)).toEqual(["Inspeção", "Limpeza", "Limpeza", "Manutenção", "Abastecimento"]);
    expect(cartoes.map((c) => [...c.querySelector("svg")?.classList ?? []].find((k) => k.startsWith("lucide-")))).toEqual([
      "lucide-eye",
      "lucide-sparkles",
      "lucide-sparkles",
      "lucide-wrench",
      "lucide-droplet",
    ]);
    const linhas = (c) => [...c.querySelectorAll(".mk-dp-tl__row")].map((r) => `${r.querySelector("dt")?.textContent}: ${r.querySelector("dd")?.textContent}`);
    expect(linhas(cartoes[0])).toEqual(["Descrição: Nível bom, boia funcionando.", "Registrado por: João", "Qualidade da água: Boa", "Escore da água: 4,5"]);
    expect(linhas(cartoes[2])).toEqual(["Descrição: Limpeza completa.", "Registrado por: João", "Custo: R$ 1.240,00", "Produto: CLORO", "Quantidade: 2"]);
    expect(linhas(cartoes[3])).toEqual(["Descrição: boia presa", "Status: Pendente"]);
    expect(linhas(cartoes[4])).toEqual(["Descrição: —"]);
    // nada de "Excluir" no resumo: só na linha do tempo completa
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();

    await clicar(screen.getByRole("button", { name: "Ver tudo" }));
    expect(tituloDoDialogo()).toBe("Histórico do bebedouro");
    expect(screen.getByText("Lançamentos (7)")).toBeTruthy();
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

describe("Telas empilhadas na mesma janela", () => {
  it("Histórico: título e sub no diálogo, ‹ Voltar, a linha do tempo de hoje (contagem e Excluir por podeExcluir); o Esc volta ao resumo", async () => {
    largura(1280);
    noDialogo({ podeLancar: true, podeExcluir: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(tituloDoDialogo()).toBe("Histórico do bebedouro");
    expect(subDoDialogo()).toBe("Bebedouro 01");
    expect(screen.getByRole("button", { name: "Voltar" })).toBeTruthy();
    expect(corpo().className).toContain("mk-dp-anim--empurrar");
    expect(document.querySelector(".mk-dp__rodape")?.childElementCount).toBe(0);
    expect(screen.getByText("Lançamentos (2)")).toBeTruthy();
    const excluir = screen.getAllByRole("button", { name: "Excluir" });
    expect(excluir).toHaveLength(2);
    expect(excluir[0]).not.toBeDisabled();
    expect(excluir[1], "só o mais recente (ordem do servidor) é excluível").toBeDisabled();
    await clicar(excluir[0]);
    await waitFor(() => expect(servico.excluidos).toEqual(["h2"]));

    await esc();
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(subDoDialogo()).toBe("Bebedouro");
    expect(corpo().className).toContain("mk-dp-anim--voltar");
    expect(pilulas()).toEqual(["Lançar", "Histórico"]);
  });

  it("Histórico sem permissão de excluir: sem Excluir; o ‹ Voltar do diálogo volta", async () => {
    largura(820);
    noDialogo({});
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(screen.getByText("Lançamentos (2)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    await clicar(screen.getByRole("button", { name: "Voltar" }));
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
  });

  it("Histórico completo no desenho v12: os cartões do resumo com a hora, na ordem do servidor, sem rolagem própria; Excluir no pé do cartão", async () => {
    largura(1280);
    // Ordem do servidor (criação desc.): um lançamento retroativo (10/10) entrou depois do de 01/11.
    estado.historico = [HISTORICO[0], { id: "h-retro", tipo_lancamento: "Manutenção", status: "Pendente", data_lancamento: "2026-10-10", descricao: "boia presa" }, HISTORICO[1]];
    noDialogo({ podeExcluir: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    const lista = screen.getByRole("list", { name: "Lançamentos do bebedouro" });
    expect([...lista.querySelectorAll(".mk-dp-tl__dia")].map((d) => d.textContent)).toEqual(["10 NOV. 2026", "10 OUT. 2026", "01 NOV. 2026"]);
    const cartoes = [...lista.querySelectorAll(".mk-dp-tl__card")];
    expect(cartoes.map((c) => c.querySelector(".mk-dp-tl__titulo")?.textContent)).toEqual(["Inspeção", "Manutenção", "Limpeza"]);
    const linhas = (c) => [...c.querySelectorAll(".mk-dp-tl__row")].map((r) => `${r.querySelector("dt")?.textContent}: ${r.querySelector("dd")?.textContent}`);
    expect(linhas(cartoes[0])).toEqual(["Hora: 08:30", "Descrição: Nível bom, boia funcionando.", "Registrado por: João", "Qualidade da água: Boa", "Escore da água: 4,5"]);
    expect(linhas(cartoes[1])).toEqual(["Descrição: boia presa", "Status: Pendente"]);
    // O "Excluir" fica no pé de cada cartão; só o mais recente (índice 0 do servidor) liga.
    const pes = cartoes.map((c) => c.querySelector(".mk-dp-tl__acoes button"));
    expect(pes.map((b) => b?.textContent)).toEqual(["Excluir", "Excluir", "Excluir"]);
    expect(pes.map((b) => b?.disabled)).toEqual([false, true, true]);
    expect(pes[1]?.getAttribute("title")).toBe("Só o lançamento mais recente pode ser excluído.");
    expect(pes[0]?.closest("[data-permissao-explicita]")).toBeTruthy();
    // Nada do desenho antigo: sem cartão com cabeçalho próprio nem rolagem de 60vh dentro do corpo.
    expect(corpo().querySelector('[class*="max-h-"]')).toBeNull();
    expect(corpo().querySelector(".mk-dp-tl")).toBe(lista);
  });

  it("Lançar: o Esc no formulário não apaga o que foi digitado (o ‹ Voltar continua); no Histórico o Esc segue voltando", async () => {
    for (const w of [1280, 390]) {
      largura(w);
      noDialogo({ podeLancar: true });
      await screen.findByText("189 cab");
      await clicar(screen.getByRole("button", { name: "Lançar" }));
      const obs = screen.getByLabelText("Observação");
      fireEvent.change(obs, { target: { value: "BOIA VAZANDO" } });
      obs.focus();
      await esc();
      expect(tituloDoDialogo(), `Esc a ${w}px`).toBe("Lançamento no Bebedouro");
      expect(/** @type {HTMLTextAreaElement} */ (screen.getByLabelText("Observação")).value).toBe("BOIA VAZANDO");
      expect(screen.getByRole("button", { name: "Voltar" })).toBeTruthy();
      await clicar(screen.getByRole("button", { name: "Voltar" }));
      expect(tituloDoDialogo()).toBe("Bebedouro 01");
      cleanup();
    }
  });

  it("Lançar: o formulário de hoje; Cancelar e Salvar voltam ao resumo; permissão revogada com o formulário aberto volta ao resumo", async () => {
    largura(1280);
    const { refazer } = noDialogo({ podeLancar: true });
    await screen.findByText("189 cab");
    await clicar(screen.getByRole("button", { name: "Lançar" }));
    expect(tituloDoDialogo()).toBe("Lançamento no Bebedouro");
    expect(subDoDialogo()).toBe("Bebedouro 01");
    expect(corpo().className).toContain("mk-dp-anim--empurrar");
    // o formulário do Base1 fica sob `.cadastro-b1`, como na tela Bebedouros
    expect(screen.getByRole("button", { name: /Salvar lançamento/ }).closest(".mk-dp-bebedouro__form .cadastro-b1")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: /Cancelar/ }));
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(screen.queryByRole("button", { name: /Salvar lançamento/ })).toBeNull();

    await clicar(screen.getByRole("button", { name: "Lançar" }));
    await clicar(screen.getByRole("button", { name: /Salvar lançamento/ }));
    await waitFor(() => expect(tituloDoDialogo()).toBe("Bebedouro 01"));
    expect(servico.criados).toHaveLength(1);
    expect(servico.criados[0]).toMatchObject({ empresa_id: EMPRESA, bebedouro_id: "beb-1", tipo_lancamento: "Inspeção" });

    await clicar(screen.getByRole("button", { name: "Lançar" }));
    expect(tituloDoDialogo()).toBe("Lançamento no Bebedouro");
    await act(async () => { refazer({ podeLancar: false }); });
    expect(tituloDoDialogo()).toBe("Bebedouro 01");
    expect(screen.queryByRole("button", { name: /Salvar lançamento/ })).toBeNull();
    expect(pilulas()).toEqual(["Histórico"]);
  });
});

describe("Fora do diálogo", () => {
  it("tela Bebedouros (barra do registro): sem o cabeçalho próprio; onSubFlowChange e 'Voltar ao resumo' como antes", async () => {
    largura(1280);
    const subFluxo = vi.fn();
    const barra = vi.fn();
    render(
      <QueryClientProvider client={novoCliente()}>
        <DetalhesBebedouro bebedouro={BEBEDOURO} podeLancar onSubFlowChange={subFluxo} onRecordToolbarChange={barra} />
      </QueryClientProvider>,
    );
    await screen.findByText("189 cab");
    expect(document.querySelector(".mk-dp")).toBeTruthy();
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    expect(subFluxo).toHaveBeenLastCalledWith(false);
    expect(barra).toHaveBeenLastCalledWith(null);

    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(subFluxo).toHaveBeenLastCalledWith(true);
    expect(document.querySelector(".mk-dp-cab")).toBeNull();
    const voltar = barra.mock.calls.at(-1)?.[0];
    expect(voltar).toBeTruthy();
    const { getByRole } = render(voltar);
    await clicar(getByRole("button", { name: /Voltar ao resumo/ }));
    expect(subFluxo).toHaveBeenLastCalledWith(false);
    expect(barra).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("group", { name: "Resumo operacional" })).toBeTruthy();
  });

  it("sem a barra do registro: cabeçalho próprio com o nome; na tela empilhada, ‹ Voltar", async () => {
    largura(390);
    render(
      <QueryClientProvider client={novoCliente()}>
        <DetalhesBebedouro bebedouro={BEBEDOURO} />
      </QueryClientProvider>,
    );
    await screen.findByText("189 cab");
    expect(screen.getByRole("heading", { name: "Bebedouro 01" })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(screen.getByRole("heading", { name: "Histórico do bebedouro" })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Voltar" }));
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
    expect(screen.getByRole("status").textContent).toBe("Carregando histórico...");
    expect(screen.queryByText("Nenhum lançamento encontrado.")).toBeNull();
  });

  it("erro sem dados: o aviso 'Não foi possível carregar o histórico.' no resumo e na tela Histórico", async () => {
    largura(1280);
    estado.historico = [];
    estado.consulta = { isError: true };
    noDialogo({});
    await screen.findByText("189 cab");
    expect(screen.getByRole("alert").textContent).toBe("Não foi possível carregar o histórico.");
    expect(celula(grupo("Resumo operacional"), "Custo acumulado")).toBe("—");
    expect(screen.queryByText("Nenhum lançamento ainda.")).toBeNull();
    await clicar(screen.getByRole("button", { name: "Histórico" }));
    expect(screen.getByRole("alert").textContent).toBe("Não foi possível carregar o histórico.");
  });

  it("erro com a lista já lida: mostra a lista (o erro não apaga o que já se sabe)", async () => {
    largura(1280);
    estado.consulta = { isError: true };
    noDialogo({});
    await screen.findByText("189 cab");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("list", { name: "Registros do bebedouro" })).toBeTruthy();
  });
});
