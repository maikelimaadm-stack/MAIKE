/**
 * Cadastro de Curvas de Ganho de Peso da fazenda (D-PROD-189; mensal desde a
 * D-PROD-194), tabela CADCURVAGANHO.
 *
 * Formulário: Nome, os 12 GMD mensais (Jan a Dez), Ativo e Observações, nesta
 * ordem. GMD em kg/dia com vírgula ou ponto, sinal de menos (perda de peso) e
 * até 3 casas, de -2 a 3; o envio leva números, não texto. Embaixo de cada mês,
 * o ganho do mês com os dias reais; atalho "repetir →" copia o valor até
 * dezembro; resumo com ganho no ano, média ponderada e gráfico. Nada de
 * estação, fazenda, categoria ou lote no formulário. A tela lista as curvas da
 * fazenda selecionada e avisa quando nenhuma está selecionada.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyWarning: notify.notifyWarning,
  notifyError: notify.notifyError,
}));

const servico = vi.hoisted(() => ({
  listarCurvasGanho: vi.fn(),
  criarCurvaGanho: vi.fn(),
  atualizarCurvaGanho: vi.fn(),
  excluirCurvasGanho: vi.fn(),
}));
vi.mock("@/services/curvaGanhoCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  ...servico,
}));

const sessao = vi.hoisted(() => ({ empresaId: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => sessao.empresaId,
}));

const { default: FormularioCurvaGanho, FORMULARIO_CURVA_GANHO_ID } = await import("@/components/curvas-ganho/FormularioCurvaGanho");
const { getCurvaGanhoFieldValue, compararCurvasParaOrdenar, CURVAS_GANHO_COLUNAS, CURVAS_GANHO_STORAGE_KEY } = await import(
  "@/components/curvas-ganho/TabelaCurvasGanho"
);
const { lerGmd, formatarGmd, formatarKg, ganhoNoMes, resumoDaCurva, MESES, CAMPOS_GMD } = await import(
  "@/services/curvaGanhoCadastroService"
);

const CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const ROTULOS = ["Nome", ...CURTOS, "Ativo", "Observações"];
/** Curva típica: águas boas, seca com perda em agosto. */
const CURVA = [0.7, 0.75, 0.7, 0.55, 0.35, 0.2, 0.1, -0.05, 0.05, 0.3, 0.55, 0.65];
const CAMPOS = CURTOS.map((c) => `gmd_${c.toLowerCase()}`);
const mesesDe = (valores) => Object.fromEntries(CAMPOS.map((c, i) => [c, valores[i]]));
/** Ganho no ano da CURVA, conta feita à mão: Σ GMD × dias do mês (ano comum). */
const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const GRAMAS_ANO = CURVA.reduce((s, v, i) => s + Math.round(v * 1000) * DIAS[i], 0);
const GANHO_ANO = Math.round(GRAMAS_ANO / 100) / 10;

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  render(<FormularioCurvaGanho onSubmit={onSubmit} toolbarActions {...props} />);
  const form = screen.getByTestId("b1-form-curva-ganho");
  return { onSubmit, form };
};

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_CURVA_GANHO_ID));

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (form) =>
  [...form.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const digitar = (testId, valor) => fireEvent.change(screen.getByTestId(testId), { target: { value: valor } });
const preencherMeses = (valores) => valores.forEach((v, i) => digitar(`curva-${CAMPOS[i]}`, String(v).replace(".", ",")));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessao.empresaId = "emp-1";
});

describe("CG-GMD — leitura e formato do GMD", () => {
  it("CG-GMD-1 — aceita vírgula, ponto, sinal e até 3 casas, na faixa -2..3", () => {
    expect(lerGmd("0,65")).toBe(0.65);
    expect(lerGmd("0.650")).toBe(0.65);
    expect(lerGmd("-0,15")).toBe(-0.15);
    expect(lerGmd("3")).toBe(3);
    expect(lerGmd("-2")).toBe(-2);
    for (const ruim of ["", "abc", "0,6543", "3,001", "-2,5", "1,2,3", ",5", "+0,5"]) expect(lerGmd(ruim), ruim).toBeNull();
  });

  it("CG-GMD-2 — exibe com vírgula, sem casas sobrando; kg com 1 casa", () => {
    expect(formatarGmd(0.65)).toBe("0,65");
    expect(formatarGmd(-0.15)).toBe("-0,15");
    expect(formatarGmd(0.65, { casasMin: 2 })).toBe("0,65");
    expect(formatarGmd(1, { casasMin: 2 })).toBe("1,00");
    expect(formatarGmd(undefined)).toBe("");
    expect(formatarKg(21.7)).toBe("21,7");
    expect(formatarKg(-1.55)).toMatch(/^-1,[56]$/);
    expect(formatarKg(null)).toBe("");
    // -0 (arredondamento de um ganho negativo minúsculo) nunca aparece como "-0".
    expect(ganhoNoMes(-0.001, 31)).toBe(-0);
    expect(formatarKg(ganhoNoMes(-0.001, 31))).toBe("0,0");
    expect(formatarGmd(-0, { casasMin: 3 })).toBe("0,000");
  });

  it("CG-GMD-3 — os 12 meses na ordem do calendário, com os dias reais (fevereiro 28); campos gmd_jan … gmd_dez", () => {
    expect(MESES.map((m) => m.curto)).toEqual(CURTOS);
    expect(MESES.map((m) => m.dias)).toEqual(DIAS);
    expect(DIAS.reduce((a, b) => a + b, 0)).toBe(365);
    expect(CAMPOS_GMD).toEqual(CAMPOS);
  });

  it("CG-GMD-4 — ganho do mês usa os dias do mês; resumo: ganho no ano (Σ GMD × dias) e média ponderada (÷ 365); falta um mês → sem resumo", () => {
    expect(ganhoNoMes(0.7, 31)).toBe(21.7);
    expect(ganhoNoMes(0.7, 28)).toBe(19.6);
    expect(ganhoNoMes(-0.05, 31)).toBe(-1.6);
    const r = resumoDaCurva(CURVA);
    expect(r.ganhoAno).toBe(GANHO_ANO);
    expect(r.mediaDia).toBe(Math.round(GRAMAS_ANO / 365) / 1000);
    expect(GRAMAS_ANO).toBeGreaterThan(0);
    expect(ganhoNoMes(0.05, 31)).toBe(1.6);
    expect(ganhoNoMes(-2, 31)).toBe(-62);
    expect(resumoDaCurva(Array(12).fill(0.5))).toEqual({ ganhoAno: 182.5, mediaDia: 0.5 });
    expect(resumoDaCurva([...CURVA.slice(0, 11), null])).toBeNull();
    expect(resumoDaCurva(CURVA.slice(0, 3))).toBeNull();
  });
});

describe("CG-FORM — formulário de curva de ganho", () => {
  it("CG-FORM-1 — Nome, os 12 meses, Ativo e Observações, nesta ordem; sem estação, fazenda, categoria ou lote", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(ROTULOS);
    expect(form.textContent).not.toMatch(/Fazenda|Empresa|Categoria|Lote|Águas|Transição|Seca|Estaç/i);
    expect(screen.getByText("Nova Curva de Ganho")).toBeTruthy();
    expect(screen.getByText("GMD por mês (kg/dia)")).toBeTruthy();
    expect(screen.getByTestId("curva-gmd_jan").getAttribute("aria-label")).toBe("GMD de Janeiro (kg/dia)");
  });

  it("CG-FORM-2 — nome e os 12 GMD são obrigatórios; GMD fora da faixa ou com 4 casas não envia", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText(/Obrigatório|Inválido/)).toHaveLength(13));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalled();
    fireEvent.change(within(form).getByPlaceholderText(/RECRIA A PASTO/), { target: { value: "x" } });
    preencherMeses(CURVA);
    digitar("curva-gmd_mar", "3,5");
    digitar("curva-gmd_out", "0,4567");
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(form).getAllByText("Inválido")).toHaveLength(2);
  });

  it("CG-FORM-3 — o envio leva os 12 números (inclusive negativo), cada um no seu mês, e nome/observações em maiúsculas", () => {
    const { form, onSubmit } = montar();
    fireEvent.change(within(form).getByPlaceholderText(/RECRIA A PASTO/), { target: { value: "recria pasto" } });
    preencherMeses(CURVA);
    fireEvent.change(within(form).getByPlaceholderText(/OBSERVAÇÕES/), { target: { value: "proteinado" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({ nome: "RECRIA PASTO", ...mesesDe(CURVA), observacoes: "PROTEINADO", ativo: true });
  });

  it("CG-FORM-4 — a dica de cada mês mostra o ganho com os dias reais; o resumo mostra ganho no ano, média e o gráfico com barra negativa", () => {
    montar();
    expect(screen.queryByTestId("grafico-curva-ganho")).toBeNull();
    expect(screen.getByTestId("curva-ganho-ano").textContent).toBe("–");
    digitar("curva-gmd_jan", "0,7");
    digitar("curva-gmd_fev", "0,7");
    expect(screen.getByTestId("dica-gmd_jan").textContent).toContain("≈ 21,7 kg no mês");
    expect(screen.getByTestId("dica-gmd_fev").textContent).toContain("≈ 19,6 kg no mês");
    expect(screen.getByTestId("grafico-curva-ganho")).toBeTruthy();
    preencherMeses(CURVA);
    expect(screen.getByTestId("curva-ganho-ano").textContent).toBe(`${formatarKg(GANHO_ANO)} kg`);
    expect(screen.getByTestId("curva-media-dia").textContent).toMatch(/^0,\d{1,3} kg\/dia$/);
    expect(screen.getAllByTestId(/^barra-gmd_/)).toHaveLength(12);
    expect(screen.getByTestId("barra-gmd_ago").getAttribute("fill")).not.toBe(screen.getByTestId("barra-gmd_jan").getAttribute("fill"));
  });

  it("CG-FORM-5 — \"repetir →\" copia o GMD do mês para todos os seguintes até dezembro, sem tocar nos anteriores; dezembro não tem o atalho", () => {
    montar();
    digitar("curva-gmd_jan", "0,8");
    digitar("curva-gmd_mai", "0,3");
    expect(screen.queryByTestId("repetir-gmd_fev")).toBeNull();
    fireEvent.click(screen.getByTestId("repetir-gmd_mai"));
    expect(CAMPOS.map((c) => screen.getByTestId(`curva-${c}`).value)).toEqual(["0,8", "", "", "", "0,3", "0,3", "0,3", "0,3", "0,3", "0,3", "0,3", "0,3"]);
    expect(screen.queryByTestId("repetir-gmd_dez")).toBeNull();
  });

  it("CG-FORM-6 — editar abre com os 12 valores e envia igual", () => {
    const { onSubmit } = montar({
      isEditing: true,
      initialData: { id: "c1", nome: "ENGORDA", ...mesesDe(CURVA), ativo: false },
    });
    expect(screen.getByTestId("curva-gmd_jan").value).toBe("0,7");
    expect(screen.getByTestId("curva-gmd_ago").value).toBe("-0,05");
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({ nome: "ENGORDA", ...mesesDe(CURVA), observacoes: null, ativo: false });
    expect(screen.getByText("Editar Curva de Ganho")).toBeTruthy();
  });

  it("CG-FORM-7 — somente leitura: sem atalho de repetir e sem dicas", () => {
    montar({ readOnly: true, initialData: { id: "c1", nome: "ENGORDA", ...mesesDe(CURVA), ativo: true } });
    expect(screen.queryByTestId("repetir-gmd_jan")).toBeNull();
    expect(screen.queryByTestId("dica-gmd_jan")).toBeNull();
    expect(screen.getByTestId("curva-ganho-ano").textContent).toBe(`${formatarKg(GANHO_ANO)} kg`);
  });
});

describe("CG-GRADE — valores e ordenação da lista", () => {
  it("CG-GRADE-1 — GMD do mês com vírgula e duas casas; média e ganho no ano calculados; ordena pelo número, não pelo texto", () => {
    expect(getCurvaGanhoFieldValue({ gmd_ago: -0.05 }, "gmd_ago")).toBe("-0,05");
    expect(getCurvaGanhoFieldValue({ gmd_jan: 1 }, "gmd_jan")).toBe("1,00");
    const curva = mesesDe(CURVA);
    expect(getCurvaGanhoFieldValue(curva, "ganho_ano")).toBe(formatarKg(GANHO_ANO));
    expect(getCurvaGanhoFieldValue(mesesDe(Array(12).fill(0.5)), "media_dia")).toBe("0,500");
    expect(getCurvaGanhoFieldValue({ gmd_jan: 1 }, "ganho_ano")).toBe("");
    expect(compararCurvasParaOrdenar({ gmd_ago: -0.15 }, { gmd_ago: 0.1 }, "gmd_ago")).toBeLessThan(0);
    expect(compararCurvasParaOrdenar({ gmd_ago: 0.1 }, {}, "gmd_ago")).toBe(-1);
    expect(compararCurvasParaOrdenar(mesesDe(Array(12).fill(0.2)), mesesDe(Array(12).fill(1)), "ganho_ano")).toBeLessThan(0);
    expect(compararCurvasParaOrdenar(mesesDe(Array(12).fill(1)), mesesDe(Array(12).fill(-0.5)), "media_dia")).toBeGreaterThan(0);
    expect(compararCurvasParaOrdenar({ nome: "A" }, { nome: "B" }, "nome")).toBeNull();
  });
});

describe("CG-GRADE-PREFS — preferências de colunas da versão por estação", () => {
  it("CG-GRADE-2 — a chave mudou (_v2) e as colunas visíveis por padrão são Nome, Média, Ganho no ano e Ativo", () => {
    expect(CURVAS_GANHO_STORAGE_KEY).toBe("colunas_largura_curvas_ganho_v2");
    expect(CURVAS_GANHO_COLUNAS.filter((c) => c.default).map((c) => c.id)).toEqual(["nome", "media_dia", "ganho_ano", "ativo"]);
  });

  it("CG-GRADE-3 — preferência salva na D-PROD-189 (chave antiga, só Nome, 3 GMD e Ativo) não esconde Média e Ganho no ano", async () => {
    window.localStorage.setItem(
      "colunas_largura_curvas_ganho_prefs",
      // Formato real gravado pela grade (persistCadastroBase1ColumnPrefs) na tela da D-PROD-189.
      JSON.stringify({
        version: 1,
        columns: {
          widths: { nome: 240, gmd_aguas: 150, gmd_transicao: 170, gmd_seca: 150, ativo: 100 },
          order: ["nome", "gmd_aguas", "gmd_transicao", "gmd_seca", "observacoes", "ativo", "created_date", "updated_date"],
          visible: ["nome", "gmd_aguas", "gmd_transicao", "gmd_seca", "ativo"],
          frozen: 0,
          autoFit: [],
        },
      }),
    );
    try {
      servico.listarCurvasGanho.mockResolvedValue([{ id: "c1", nome: "RECRIA PASTO", ...mesesDe(CURVA), ativo: true }]);
      const { default: CurvasGanho } = await import("@/pages/CurvasGanho");
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <CurvasGanho />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(screen.getByText("RECRIA PASTO")).toBeTruthy());
      expect(screen.getByText(formatarKg(GANHO_ANO))).toBeTruthy();
    } finally {
      window.localStorage.removeItem("colunas_largura_curvas_ganho_prefs");
    }
  });
});

describe("CG-PAGE — tela de curvas de ganho", () => {
  const renderizar = async () => {
    const { default: CurvasGanho } = await import("@/pages/CurvasGanho");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CurvasGanho />
      </QueryClientProvider>,
    );
  };

  it("CG-PAGE-1 — lista as curvas da fazenda selecionada (com o ganho no ano) e abre o formulário no Novo", async () => {
    servico.listarCurvasGanho.mockResolvedValue([{ id: "c1", nome: "RECRIA PASTO", ...mesesDe(CURVA), ativo: true }]);
    await renderizar();
    await waitFor(() => expect(screen.getByText("RECRIA PASTO")).toBeTruthy());
    expect(screen.getByText(formatarKg(GANHO_ANO))).toBeTruthy();
    expect(servico.listarCurvasGanho).toHaveBeenCalledWith("emp-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-curva-ganho");
    expect(rotulos(form)).toEqual(ROTULOS);
    fireEvent.submit(document.getElementById(FORMULARIO_CURVA_GANHO_ID));
    await waitFor(() => expect(within(form).getAllByText(/Obrigatório|Inválido/)).toHaveLength(13));
    expect(servico.criarCurvaGanho).not.toHaveBeenCalled();
  });

  it("CG-PAGE-2 — sem fazenda selecionada: aviso, nenhuma consulta e sem botão Novo", async () => {
    sessao.empresaId = null;
    servico.listarCurvasGanho.mockResolvedValue([]);
    await renderizar();
    expect(await screen.findByTestId("curvas-ganho-sem-fazenda")).toBeTruthy();
    expect(servico.listarCurvasGanho).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo" })).toBeNull();
  });

  it("CG-PAGE-3 — D-PROD-195: excluir curva ligada a categoria de manejo avisa quantas categorias a usam", async () => {
    servico.listarCurvasGanho.mockResolvedValue([{ id: "c1", nome: "RECRIA PASTO", ...mesesDe(CURVA), ativo: true }]);
    servico.excluirCurvasGanho.mockResolvedValue({ excluidos: [], bloqueados: [{ id: "c1", code: "CURVA_GANHO_EM_USO", categorias: 3 }] });
    await renderizar();
    await waitFor(() => expect(screen.getByText("RECRIA PASTO")).toBeTruthy());
    fireEvent.doubleClick(screen.getByText("RECRIA PASTO"));
    await screen.findByTestId("b1-form-curva-ganho");
    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir" }));
    await waitFor(() =>
      expect(notify.notifyError).toHaveBeenCalledWith(
        "Atenção",
        "Esta curva está ligada a 3 categoria(s) de manejo e não pode ser excluída.",
      ),
    );
    expect(servico.excluirCurvasGanho).toHaveBeenCalledWith(["c1"], { empresaId: "emp-1" });
  });
});
