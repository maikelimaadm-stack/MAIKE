/**
 * Cadastro de Curvas de Ganho de Peso da fazenda (D-PROD-189), tabela
 * CADCURVAGANHO.
 *
 * Formulário: Nome, GMD nas Águas, GMD na Transição, GMD na Seca, Ativo e
 * Observações, nesta ordem. GMD em kg/dia com vírgula ou ponto, sinal de menos
 * (perda de peso) e até 3 casas, de -2 a 3; o envio leva números, não texto. A
 * fazenda não é campo (vem do topo). A tela lista as curvas da fazenda
 * selecionada e avisa quando nenhuma está selecionada.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyWarning: notify.notifyWarning,
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
const { getCurvaGanhoFieldValue, compararCurvasParaOrdenar } = await import("@/components/curvas-ganho/TabelaCurvasGanho");
const { lerGmd, formatarGmd } = await import("@/services/curvaGanhoCadastroService");

const ROTULOS = ["Nome", "GMD nas Águas", "GMD na Transição", "GMD na Seca", "Ativo", "Observações"];

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

  it("CG-GMD-2 — exibe com vírgula, sem casas sobrando", () => {
    expect(formatarGmd(0.65)).toBe("0,65");
    expect(formatarGmd(-0.15)).toBe("-0,15");
    expect(formatarGmd(0.65, { casasMin: 2 })).toBe("0,65");
    expect(formatarGmd(1, { casasMin: 2 })).toBe("1,00");
    expect(formatarGmd(undefined)).toBe("");
  });
});

describe("CG-FORM — formulário de curva de ganho", () => {
  it("CG-FORM-1 — seis campos, nesta ordem; sem fazenda, categoria ou mês", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(ROTULOS);
    expect(form.textContent).not.toMatch(/Fazenda|Empresa|Categoria|Lote|Janeiro/i);
    expect(screen.getByText("Nova Curva de Ganho")).toBeTruthy();
  });

  it("CG-FORM-2 — nome e os três GMD são obrigatórios; GMD fora da faixa ou com 4 casas não envia", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText(/Obrigatório|GMD inválido/)).toHaveLength(4));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByPlaceholderText(/RECRIA A PASTO/), { target: { value: "x" } });
    digitar("curva-gmd_aguas", "3,5");
    digitar("curva-gmd_transicao", "0,4567");
    digitar("curva-gmd_seca", "0,2");
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(form).getAllByText("GMD inválido")).toHaveLength(2);
  });

  it("CG-FORM-3 — o envio leva números (inclusive negativo) e nome/observações em maiúsculas", () => {
    const { form, onSubmit } = montar();
    fireEvent.change(within(form).getByPlaceholderText(/RECRIA A PASTO/), { target: { value: "recria pasto" } });
    digitar("curva-gmd_aguas", "0,65");
    digitar("curva-gmd_transicao", "0.4");
    digitar("curva-gmd_seca", "-0,15");
    fireEvent.change(within(form).getByPlaceholderText(/OBSERVAÇÕES/), { target: { value: "proteinado" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      nome: "RECRIA PASTO",
      gmd_aguas: 0.65,
      gmd_transicao: 0.4,
      gmd_seca: -0.15,
      observacoes: "PROTEINADO",
      ativo: true,
    });
  });

  it("CG-FORM-4 — a dica mostra o equivalente por mês (30 dias); editar abre com os valores e envia igual", () => {
    const { onSubmit } = montar({
      isEditing: true,
      initialData: { id: "c1", nome: "ENGORDA", gmd_aguas: 0.9, gmd_transicao: 0.6, gmd_seca: 0.3, ativo: false },
    });
    expect(screen.getByText("≈ 27 kg/mês (30 dias)")).toBeTruthy();
    expect(screen.getByTestId("curva-gmd_aguas").value).toBe("0,9");
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({ nome: "ENGORDA", gmd_aguas: 0.9, gmd_transicao: 0.6, gmd_seca: 0.3, observacoes: null, ativo: false });
    expect(screen.getByText("Editar Curva de Ganho")).toBeTruthy();
  });
});

describe("CG-GRADE — valores e ordenação da lista", () => {
  it("CG-GRADE-1 — GMD com vírgula e duas casas; ordena pelo número, não pelo texto", () => {
    expect(getCurvaGanhoFieldValue({ gmd_seca: -0.15 }, "gmd_seca")).toBe("-0,15");
    expect(getCurvaGanhoFieldValue({ gmd_aguas: 1 }, "gmd_aguas")).toBe("1,00");
    expect(compararCurvasParaOrdenar({ gmd_seca: -0.15 }, { gmd_seca: 0.1 }, "gmd_seca")).toBeLessThan(0);
    expect(compararCurvasParaOrdenar({ gmd_seca: 0.1 }, {}, "gmd_seca")).toBe(-1);
    expect(compararCurvasParaOrdenar({ nome: "A" }, { nome: "B" }, "nome")).toBeNull();
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

  it("CG-PAGE-1 — lista as curvas da fazenda selecionada e abre o formulário no Novo", async () => {
    servico.listarCurvasGanho.mockResolvedValue([
      { id: "c1", nome: "RECRIA PASTO", gmd_aguas: 0.65, gmd_transicao: 0.4, gmd_seca: 0.2, ativo: true },
    ]);
    await renderizar();
    await waitFor(() => expect(screen.getByText("RECRIA PASTO")).toBeTruthy());
    expect(servico.listarCurvasGanho).toHaveBeenCalledWith("emp-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-curva-ganho");
    expect(rotulos(form)).toEqual(ROTULOS);
    fireEvent.submit(document.getElementById(FORMULARIO_CURVA_GANHO_ID));
    await waitFor(() => expect(within(form).getAllByText(/Obrigatório|GMD inválido/)).toHaveLength(4));
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
});
