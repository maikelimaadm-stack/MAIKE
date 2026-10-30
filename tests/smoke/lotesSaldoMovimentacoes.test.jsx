/**
 * Lotes: Cadastro = lançamento da ENTRADA; saldo atual só informativo;
 * movimentações ficam no Mapa Geral (D-PROD-84, D-PROD-85).
 *
 * Caso real de produção (30/10/2026, só leitura): lote 1 entrou com 500 em
 * TESTE; uma transferência parcial levou 50 para TET, criando o lote 2 (origem
 * MOVIMENTAÇÃO). Banco: lote 1 entrada 500 / cabeças 450; lote 2 cabeças 50.
 *
 * Aceite: Cadastro lista o lote 1 (Qtd. entrada 500, saldo 450); o lote 2 só
 * aparece como consulta, sem contar como entrada; entradas = 500 e rebanho
 * atual = 500 (nunca 550 nem 450). Nenhuma coluna ou texto de "movimentações"
 * no Cadastro.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  ehEntradaNoRebanho,
  ehLoteDerivadoDeManejo,
  entradaHistoricaDoLote,
  quantidadeDeCabecas,
  resumoDeCabecas,
  saldoAtualDoLote,
} from "@/domain/lotes/saldoLote";
import * as saldoLote from "@/domain/lotes/saldoLote";
import { nomeDaAreaDoMovimento, areaPorId } from "@/domain/lotes/movimentacaoLote";
import campoEngine from "@/services/campoEngine";

const LOTE_1 = Object.freeze({
  id: "cmvve89ny0002l808lh34ice3",
  empresa_id: "emp-1",
  numero_lote: "1",
  nome: "TESTE",
  origem: "AJUSTE",
  motivo_entrada: "Ajuste",
  motivo_ajuste: "TESTE",
  status: "Ativo",
  quantidade_entrada: 500,
  quantidade_cabecas: 450,
  area_entrada_id: "area-teste",
  setor_id: "s1",
  setor_nome: "SETOR 1",
  area_entrada_nome: "TESTE",
  area_atual_id: "area-teste",
  area_atual_nome: "TESTE",
});
const LOTE_2 = Object.freeze({
  id: "cmvved55m0002ju08dyje7kkd",
  empresa_id: "emp-1",
  numero_lote: "2",
  nome: "TESTE",
  origem: "MOVIMENTAÇÃO",
  motivo_entrada: "Outros",
  motivo_outros: "Movimentação parcial",
  status: "Ativo",
  quantidade_entrada: 50,
  quantidade_cabecas: 50,
  area_entrada_id: "area-tet",
  setor_id: "s1",
  setor_nome: "SETOR 1",
  area_entrada_nome: "TET",
  area_atual_id: "area-tet",
  area_atual_nome: "TET",
});

afterEach(() => cleanup());

describe("domain/lotes/saldoLote — entrada × saldo atual (caso real 500 → 450 + 50)", () => {
  it("lote 1: entrada 500, saldo atual 450; é entrada no rebanho", () => {
    expect(entradaHistoricaDoLote(LOTE_1)).toBe(500);
    expect(saldoAtualDoLote(LOTE_1)).toBe(450);
    expect(ehEntradaNoRebanho(LOTE_1)).toBe(true);
  });

  it("lote 2 (gerado por movimentação): não é entrada; saldo 50", () => {
    expect(ehLoteDerivadoDeManejo(LOTE_2)).toBe(true);
    expect(ehEntradaNoRebanho(LOTE_2)).toBe(false);
    expect(entradaHistoricaDoLote(LOTE_2)).toBe(0);
    expect(saldoAtualDoLote(LOTE_2)).toBe(50);
  });

  it("entradas 500 e rebanho atual 500 (nem 550, nem 450)", () => {
    const r = resumoDeCabecas([LOTE_1, LOTE_2]);
    expect(r).toEqual({ lotes: 2, entradas: 500, saldoAtual: 500 });
    expect(LOTE_1.quantidade_entrada + LOTE_2.quantidade_entrada).toBe(550); // a soma ingênua
    expect(resumoDeCabecas([LOTE_1])).toEqual({ lotes: 1, entradas: 500, saldoAtual: 450 }); // só entradas: saldo parcial
  });

  it("o domínio não expõe mais 'movimentação líquida' (saldo − entrada não é evento)", () => {
    expect(saldoLote).not.toHaveProperty("movimentacaoLiquidaDoLote");
    expect(saldoLote).not.toHaveProperty("formatarVariacao");
  });

  it("nascimento soma ao rebanho; transferência e mudança de categoria não; saída definitiva reduz", () => {
    const compra = { origem: "COMPRA", quantidade_entrada: 100, quantidade_cabecas: 100 };
    const nasc = { origem: "Nascimento", quantidade_entrada: 3, quantidade_cabecas: 3 };
    expect(resumoDeCabecas([compra, nasc])).toEqual({ lotes: 2, entradas: 103, saldoAtual: 103 });
    // transferência parcial de 30: origem 70 + lote derivado 30
    const transf = [{ ...compra, quantidade_cabecas: 70 }, { origem: "MOVIMENTAÇÃO", quantidade_entrada: 30, quantidade_cabecas: 30 }];
    expect(resumoDeCabecas(transf)).toEqual({ lotes: 2, entradas: 100, saldoAtual: 100 });
    // mudança de categoria de 10: origem 90 + lote derivado 10
    const cat = [{ ...compra, quantidade_cabecas: 90 }, { origem: "Mudança de Categoria", quantidade_entrada: 10, quantidade_cabecas: 10 }];
    expect(resumoDeCabecas(cat)).toEqual({ lotes: 2, entradas: 100, saldoAtual: 100 });
    // abate/morte de 5: só o saldo cai
    expect(resumoDeCabecas([{ ...compra, quantidade_cabecas: 95 }])).toEqual({ lotes: 1, entradas: 100, saldoAtual: 95 });
  });

  it("strings, zeros e vazios: legado importado não quebra a conta", () => {
    expect(quantidadeDeCabecas("450")).toBe(450);
    expect(quantidadeDeCabecas(" 50 ")).toBe(50);
    expect(quantidadeDeCabecas(0)).toBe(0);
    expect(quantidadeDeCabecas("")).toBe(0);
    expect(quantidadeDeCabecas(null)).toBe(0);
    expect(quantidadeDeCabecas(undefined)).toBe(0);
    expect(quantidadeDeCabecas("abc")).toBe(0);
    const zerado = { ...LOTE_1, quantidade_entrada: "500", quantidade_cabecas: "0", status: "Inativo" };
    expect([entradaHistoricaDoLote(zerado), saldoAtualDoLote(zerado)]).toEqual([500, 0]);
  });

  it("origem comparada sem acento/caixa; nascimento é entrada de verdade", () => {
    for (const origem of ["MOVIMENTAÇÃO", "Movimentacao", " movimentação ", "REVERSÃO MOVIMENTAÇÃO", "Mudança de Categoria", "MUDANCA DE CATEGORIA", "EDIÇÃO MOVIMENTAÇÃO"]) {
      expect(ehLoteDerivadoDeManejo({ origem }), origem).toBe(true);
    }
    for (const origem of ["COMPRA", "AJUSTE", "INVENTÁRIO", "Nascimento", "NASCIMENTO", "", null, undefined]) {
      expect(ehLoteDerivadoDeManejo({ origem }), String(origem)).toBe(false);
    }
  });
});

describe("campoEngine — 'entrada' e 'cabecas' (saldo); sem campo de movimentação", () => {
  it("valores brutos e agregação", () => {
    expect(campoEngine.getValorBruto(LOTE_1, { id: "cabecas" })).toBe(450);
    expect(campoEngine.getValorBruto(LOTE_1, { id: "entrada" })).toBe(500);
    expect(campoEngine.getValorBruto(LOTE_2, { id: "entrada" })).toBe(0);
    expect(campoEngine.getValorBruto(LOTE_1, { id: "movimentacoes" })).toBe(""); // não existe mais
    expect(campoEngine.calcularAgregacoes([LOTE_1, LOTE_2], [{ id: "entrada", agregacao_tipo: "sum" }])).toEqual({ entrada: 500 });
  });

  it("fórmula: cabecas/saldo_atual = saldo; entrada separada; 'movimentacoes' não existe", () => {
    expect(campoEngine.calcularCampo(LOTE_1, { formula: "cabecas" })).toBe(450);
    expect(campoEngine.calcularCampo(LOTE_1, { formula: "saldo_atual" })).toBe(450);
    expect(campoEngine.calcularCampo(LOTE_1, { formula: "entrada" })).toBe(500);
    expect(campoEngine.calcularCampo(LOTE_1, { formula: "movimentacoes" })).toBe(0);
  });
});

describe("TabelaLotes — grade e exportação do Cadastro", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("colunas: Qtd. entrada e Saldo atual (informativo); nenhuma coluna de movimentação", async () => {
    const { COLUNAS_DISPONIVEIS } = await import("@/components/lotes/TabelaLotes");
    const ids = COLUNAS_DISPONIVEIS.map((c) => c.id);
    expect(ids).not.toContain("movimentacoes");
    expect(COLUNAS_DISPONIVEIS.some((c) => /moviment/i.test(c.label))).toBe(false);
    const rotulo = (id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id).label;
    expect([rotulo("entrada"), rotulo("cabecas")]).toEqual(["Qtd. entrada", "Saldo atual (informativo)"]);
    expect(ids.indexOf("entrada")).toBeLessThan(ids.indexOf("cabecas"));
  });

  it("exportação: números crus de entrada e saldo", async () => {
    const { getLoteFieldValue } = await import("@/components/lotes/TabelaLotes");
    expect(["entrada", "cabecas"].map((c) => getLoteFieldValue(LOTE_1, c))).toEqual(["500", "450"]);
    expect(["entrada", "cabecas"].map((c) => getLoteFieldValue(LOTE_2, c))).toEqual(["0", "50"]);
  });

  it("grade real: Totais só da Qtd. entrada (500); saldo sem total; sem '-50'/'+50'; derivado com '—'", async () => {
    const { default: TabelaLotes } = await import("@/components/lotes/TabelaLotes");
    render(
      <TabelaLotes
        lotes={[LOTE_1, LOTE_2]}
        searchQuery=""
        resetFiltersKey={0}
        onSelectionChange={() => {}}
        onFiltersActiveChange={() => {}}
        viewMode="table"
        showConfigColunas={false}
        setShowConfigColunas={() => {}}
      />,
    );
    const totais = (await screen.findByText("Totais")).closest("tr");
    const celulas = within(totais).getAllByRole("cell").map((td) => td.textContent);
    expect(celulas).toContain("500");
    expect(celulas).not.toContain("550");
    expect(celulas.filter((t) => t === "500")).toHaveLength(1); // só a coluna de entrada é somada
    expect(screen.queryByText("-50")).toBeNull();
    expect(screen.queryByText("+50")).toBeNull();
    expect(screen.queryByText(/Movimenta/)).toBeNull();
    expect(screen.getAllByTitle("Gerado por manejo: as cabeças já existiam no lote de origem").length).toBeGreaterThan(0);
  });

  it("layout salvo antigo: 'Qtd. entrada' entra antes do saldo uma vez; id antigo 'movimentacoes' é descartado na leitura", async () => {
    const { migrarColunasSaldoLotes } = await import("@/components/lotes/TabelaLotes");
    const { loadCadastroBase1ColumnPrefs } = await import("@/lib/cadastroBase1ColumnPrefs");
    const { COLUNAS_DISPONIVEIS } = await import("@/components/lotes/TabelaLotes");
    localStorage.setItem(
      "colunas_cadastro_lotes_prefs",
      JSON.stringify({ version: 1, columns: { order: ["codigo", "nome", "cabecas", "status"], visible: ["nome", "cabecas"], widths: {}, frozen: 0, autoFit: [] } }),
    );
    migrarColunasSaldoLotes(localStorage);
    const prefs = JSON.parse(localStorage.getItem("colunas_cadastro_lotes_prefs"));
    expect(prefs.columns.order).toEqual(["codigo", "nome", "entrada", "cabecas", "status"]);
    expect(prefs.columns.visible).toEqual(["nome", "entrada", "cabecas"]);
    // Layout de quem já tinha a coluna antiga de movimentações.
    localStorage.setItem(
      "colunas_cadastro_lotes_prefs",
      JSON.stringify({ version: 1, columns: { order: ["nome", "entrada", "movimentacoes", "cabecas"], visible: ["nome", "entrada", "movimentacoes", "cabecas"], widths: {}, frozen: 0, autoFit: [] } }),
    );
    const lidas = loadCadastroBase1ColumnPrefs("colunas_cadastro_lotes", COLUNAS_DISPONIVEIS);
    expect(lidas.colunasVisiveis).toEqual(["nome", "entrada", "cabecas"]);
    expect(lidas.colunasOrdem).not.toContain("movimentacoes");
  });

  it("storage quebrado não derruba a tela", async () => {
    const { migrarColunasSaldoLotes } = await import("@/components/lotes/TabelaLotes");
    const quebrado = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(() => migrarColunasSaldoLotes(/** @type {any} */ (quebrado))).not.toThrow();
  });
});

describe("loteCadastroService — lote gerado por manejo não é apagado pelo cadastro", () => {
  it("bloqueia sem chamar a API de exclusão", async () => {
    vi.resetModules();
    const deleteLote = vi.fn();
    vi.doMock("@/apis/lotes", () => ({
      listLotes: vi.fn(), createLote: vi.fn(), updateLote: vi.fn(), deleteLote,
      listMovimentacoes: vi.fn(async () => []), listMovimentacoesPecuarias: vi.fn(async () => []),
      listTodasMovimentacoes: vi.fn(async () => []), listFornecedores: vi.fn(), listCategoriasManejo: vi.fn(),
      sincronizarReferenciasLote: vi.fn(), listSuplementacaoLotes: vi.fn(async () => []),
    }));
    const { excluirLotes } = await import("@/services/loteCadastroService");
    const { API_ERROR_CODES } = await import("@/apis/_core/ApiError");
    const r = await excluirLotes([LOTE_2.id], { lotes: [LOTE_2] });
    expect(r.excluidos).toEqual([]);
    expect(r.bloqueados).toEqual([{ id: LOTE_2.id, code: API_ERROR_CODES.LOTE_DELETE_BLOCKED }]);
    expect(deleteLote).not.toHaveBeenCalled();
    vi.doUnmock("@/apis/lotes");
  });
});

describe("FormularioLote — edição não regrava quantidade nem desfaz movimentação", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
    vi.doMock("@/hooks/useSetorAreas", () => ({
      default: () => ({
        setores: [{ id: "s1", nome: "SETOR 1" }, { id: "s2", nome: "SETOR 2" }],
        areas: [
          { id: "area-teste", nome: "TESTE", setor_id: "s1" },
          { id: "area-tet", nome: "TET", setor_id: "s1" },
          { id: "area-outra", nome: "OUTRA", setor_id: "s2" },
        ],
        getAreasBySetor: (setorId) =>
          [
            { id: "area-teste", nome: "TESTE", setor_id: "s1" },
            { id: "area-tet", nome: "TET", setor_id: "s1" },
            { id: "area-outra", nome: "OUTRA", setor_id: "s2" },
          ].filter((a) => a.setor_id === setorId),
      }),
    }));
    vi.doMock("@/services/loteCadastroService", async (importOriginal) => ({
      ...(await importOriginal()),
      listarCategoriasManejoAtivas: vi.fn(async () => []),
      listarFornecedores: vi.fn(async () => []),
    }));
    localStorage.removeItem("cadastro_lotes_form_layout_config");
  });

  const renderForm = async (props) => {
    const { default: FormularioLote } = await import("@/components/lotes/FormularioLote.jsx");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSubmit = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <FormularioLote visualVariant="base1" variant="embedded" toolbarActions readOnly={false} onSubmit={onSubmit} onCancel={() => {}} {...props} />
      </QueryClientProvider>,
    );
    return { onSubmit };
  };
  const submeter = async (onSubmit) => {
    fireEvent.submit(document.getElementById("formulario-lote-base1"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    return onSubmit.mock.calls[0][0];
  };

  it("lote 1: mostra Qtd. entrada 500 e Saldo atual (informativo) 450, sem campo editável e sem movimentações", async () => {
    await renderForm({ initialData: LOTE_1, isEditing: true });
    const caixa = screen.getByTestId("lote-quantidades");
    expect(caixa.textContent).toContain("Qtd. entrada: 500");
    expect(caixa.textContent).toContain("Saldo atual (informativo): 450");
    expect(caixa.textContent).not.toMatch(/Moviment|-50/);
    expect(caixa.querySelector("input")).toBeNull();
  });

  it("salvar edição do lote 1 não reenvia quantidade (as 50 cabeças que saíram não voltam)", async () => {
    const { onSubmit } = await renderForm({ initialData: LOTE_1, isEditing: true });
    const payload = await submeter(onSubmit);
    expect(payload).not.toHaveProperty("quantidade_cabecas");
    expect(payload).not.toHaveProperty("quantidade_entrada");
    // Já movimentou (saldo ≠ entrada): a área atual não é reescrita pela de entrada.
    expect(payload).not.toHaveProperty("area_atual_id");
  });

  it("lote 2 gerado por manejo: Qtd. entrada '—' (não é entrada), saldo 50; salvar não troca a origem", async () => {
    const { onSubmit } = await renderForm({ initialData: LOTE_2, isEditing: true });
    const caixa = screen.getByTestId("lote-quantidades");
    expect(caixa.textContent).toContain("Qtd. entrada: — (gerado por manejo, não é entrada)");
    expect(caixa.textContent).toContain("Saldo atual (informativo): 50");
    expect(caixa.textContent).not.toMatch(/Moviment|\+50/);
    const payload = await submeter(onSubmit);
    expect(payload).not.toHaveProperty("origem");
    expect(payload).not.toHaveProperty("quantidade_cabecas");
    expect(payload).not.toHaveProperty("area_atual_id");
  });

  it("lote zerado (saiu inteiro) pode ser editado: quantidade 0 não bloqueia o salvar", async () => {
    const { onSubmit } = await renderForm({ initialData: { ...LOTE_1, quantidade_cabecas: 0, status: "Inativo" }, isEditing: true });
    const payload = await submeter(onSubmit);
    expect(payload.nome).toBe("TESTE");
  });

  it("R2 — lote que SAIU E VOLTOU (mesma área, mesmo saldo): edição não move a área atual", async () => {
    // Saldo líquido zero e área igual não provam que o lote nunca movimentou.
    // Antes (R1) este caso reenviava area_atual_id = área de entrada do form,
    // e o port nativo descarta area_entrada_id no PATCH: "editar a área de
    // entrada" só movia o lote fisicamente, sem movimentação.
    const saiuEVoltou = { ...LOTE_1, quantidade_cabecas: 500 };
    const { onSubmit } = await renderForm({ initialData: saiuEVoltou, isEditing: true });
    const payload = await submeter(onSubmit);
    expect(payload).not.toHaveProperty("area_atual_id");
    expect(payload).not.toHaveProperty("area_atual_nome");
    expect(payload).not.toHaveProperty("quantidade_cabecas");
  });

  it("R2 — área de entrada fica só leitura na edição (registro histórico); em lote novo é editável", async () => {
    await renderForm({ initialData: LOTE_1, isEditing: true });
    const campoDe = () => screen.getByText("Área de Entrada").closest(".mg-field");
    const campo = campoDe();
    expect(campo).toBeTruthy();
    const controles = [...campo.querySelectorAll("input, button")];
    expect(controles.length).toBeGreaterThan(0);
    expect(controles.every((el) => el.disabled || el.readOnly)).toBe(true);
    cleanup();
    await renderForm({ initialData: null, isEditing: false });
    const novo = campoDe();
    expect([...novo.querySelectorAll("input")].some((el) => !el.disabled && !el.readOnly)).toBe(true);
  });

  it("R2 — lote derivado e lote zerado: edição nunca leva área atual", async () => {
    for (const initialData of [LOTE_2, { ...LOTE_1, quantidade_cabecas: 0, status: "Inativo" }]) {
      const { onSubmit } = await renderForm({ initialData, isEditing: true });
      const payload = await submeter(onSubmit);
      expect(payload).not.toHaveProperty("area_atual_id");
      cleanup();
    }
  });

  // R3 — Setor também é histórico na edição. Interação pelo AutocompleteGenerico
  // real (foco, seta para baixo, Enter), sem mock do componente.
  const campoSetor = () => screen.getByText("Setor").closest(".mg-field");
  const tentarTrocarSetor = () => {
    const input = campoSetor().querySelector("input");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    return input;
  };
  const CAMPOS_HISTORICOS = ["setor_id", "setor_nome", "area_entrada_id", "area_entrada_nome", "area_atual_id", "area_atual_nome", "quantidade_cabecas", "quantidade_entrada"];

  for (const [rotulo, lote] of [
    ["manual", LOTE_1],
    ["derivado", LOTE_2],
    ["que saiu e voltou", { ...LOTE_1, quantidade_cabecas: 500 }],
  ]) {
    it(`R3 — lote ${rotulo}: Setor travado; tentar trocar não zera a Área de Entrada; payload sem campos históricos; outros metadados salvam`, async () => {
      const { onSubmit } = await renderForm({ initialData: lote, isEditing: true });
      const input = tentarTrocarSetor();
      expect(input.disabled || input.readOnly).toBe(true);
      expect(campoSetor().querySelector("button")).toBeNull(); // sem o "x" de limpar
      // Área de Entrada continua preenchida (o valor exibido é o nome da área).
      const area = screen.getByText("Área de Entrada").closest(".mg-field").querySelector("input");
      expect(area.value).toBe(lote.area_entrada_nome);
      fireEvent.change(screen.getByPlaceholderText("NOME DO LOTE"), { target: { value: "TESTE RENOMEADO" } });
      const payload = await submeter(onSubmit);
      expect(payload.nome).toBe("TESTE RENOMEADO");
      for (const campo of CAMPOS_HISTORICOS) expect(payload, campo).not.toHaveProperty(campo);
    });
  }

  it("R3 — lote novo (duplicado = POST): Setor editável e payload leva setor, áreas e quantidade", async () => {
    const { onSubmit } = await renderForm({ initialData: { ...LOTE_1, id: undefined, _isDuplicate: true }, isEditing: true });
    const input = campoSetor().querySelector("input");
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    const payload = await submeter(onSubmit);
    expect(payload.setor_id).toBe("s1");
    expect(payload.area_entrada_id).toBe("area-teste");
    expect(payload.area_atual_id).toBe("area-teste");
    expect(payload.quantidade_cabecas).toBe(450);
  });

  it("R3 — lote novo: trocar o Setor pelo Autocomplete funciona e limpa a área (regra de cadastro mantida)", async () => {
    await renderForm({ initialData: null, isEditing: false });
    const input = tentarTrocarSetor();
    expect(input.disabled).toBe(false);
    await waitFor(() => expect(input.value).not.toBe(""));
  });

  it("novo lote: um campo de quantidade que vale para entrada e saldo", async () => {
    await renderForm({ initialData: null, isEditing: false });
    expect(screen.queryByTestId("lote-quantidades")).toBeNull();
    expect(screen.getByText("Qtd. Cabeças (entrada)")).toBeTruthy();
  });
});

describe("área da movimentação pelo ID (destino com nome vazio)", () => {
  const areas = [{ id: "cmvvecagl000hk107i2c853nu", nome: "TET" }];
  it("nome vazio gravado → nome da área pelo id", () => {
    expect(nomeDaAreaDoMovimento("", "cmvvecagl000hk107i2c853nu", areas)).toBe("TET");
    expect(nomeDaAreaDoMovimento("   ", "cmvvecagl000hk107i2c853nu", areas)).toBe("TET");
  });
  it("nome gravado prevalece (retrato histórico)", () => {
    expect(nomeDaAreaDoMovimento("TESTE", "cmvvecagl000hk107i2c853nu", areas)).toBe("TESTE");
  });
  it("área fora do cache → rótulo curto pelo id, nunca '-' mudo", () => {
    expect(nomeDaAreaDoMovimento("", "cmvvecagl000hk107i2c853nu", [])).toBe("Área …c853nu");
    expect(nomeDaAreaDoMovimento("", null, areas)).toBe("");
    expect(areaPorId(areas, "nao-existe")).toBeNull();
  });
});
