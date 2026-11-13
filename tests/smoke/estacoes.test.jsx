/**
 * Cadastro de Estações da fazenda (D-PROD-188), tabela CADESTACOES.
 *
 * Formulário: Nome, Tipo (ÁGUAS / TRANSIÇÃO / SECA), Data de início, Data de
 * fim, Ativo e Observações, nesta ordem. O envio leva só esses seis campos,
 * com as datas como texto AAAA-MM-DD e nome/observações em maiúsculas; a
 * fazenda não é campo do formulário (vem do topo da tela). A tela lista as
 * estações da fazenda selecionada e avisa quando nenhuma está selecionada.
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
  listarEstacoes: vi.fn(),
  criarEstacao: vi.fn(),
  atualizarEstacao: vi.fn(),
  excluirEstacoes: vi.fn(),
}));
vi.mock("@/services/estacaoCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  ...servico,
}));

const sessao = vi.hoisted(() => ({ empresaId: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => sessao.empresaId,
}));

const { default: FormularioEstacao, FORMULARIO_ESTACAO_ID } = await import("@/components/estacoes/FormularioEstacao");
const { getEstacaoFieldValue, compararEstacoesParaOrdenar, duracaoEstacaoEmDias } = await import(
  "@/components/estacoes/TabelaEstacoes"
);

const ROTULOS = ["Nome", "Tipo", "Data de início", "Data de fim", "Ativo", "Observações"];

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  render(<FormularioEstacao onSubmit={onSubmit} toolbarActions {...props} />);
  const form = screen.getByTestId("b1-form-estacao");
  return { onSubmit, form };
};

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_ESTACAO_ID));

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (form) =>
  [...form.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const escolherTipo = async (form, rotulo) => {
  fireEvent.click(within(form).getByRole("combobox", { name: /Tipo/ }));
  await screen.findAllByRole("option");
  fireEvent.click(screen.getByRole("option", { name: rotulo }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessao.empresaId = "emp-1";
});

describe("EST-FORM — formulário de estação", () => {
  it("EST-FORM-1 — seis campos, nesta ordem; sem campo de fazenda", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(ROTULOS);
    expect(form.textContent).not.toMatch(/Fazenda|Empresa|Lote|Curva/i);
    expect(screen.getByText("Nova Estação")).toBeTruthy();
  });

  it("EST-FORM-2 — o tipo oferece exatamente ÁGUAS, TRANSIÇÃO e SECA", async () => {
    const { form } = montar();
    fireEvent.click(within(form).getByRole("combobox", { name: /Tipo/ }));
    const opcoes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    expect(opcoes).toEqual(["SELECIONE", "ÁGUAS", "TRANSIÇÃO", "SECA"]);
  });

  it("EST-FORM-3 — nome, tipo e as duas datas são obrigatórios", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(4));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledTimes(1);
  });

  it("EST-FORM-4 — o envio leva os seis campos: datas AAAA-MM-DD, nome e observações em maiúsculas", async () => {
    const { form, onSubmit } = montar();
    fireEvent.change(within(form).getByPlaceholderText(/ÁGUAS 2026/), { target: { value: "águas 2026/2027" } });
    await escolherTipo(form, "ÁGUAS");
    fireEvent.change(screen.getByTestId("estacao-data-inicio"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByTestId("estacao-data-fim"), { target: { value: "2027-04-30" } });
    fireEvent.change(within(form).getByPlaceholderText(/OBSERVAÇÕES/), { target: { value: "chuva cedo" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      nome: "ÁGUAS 2026/2027",
      tipo: "AGUAS",
      data_inicio: "2026-11-01",
      data_fim: "2027-04-30",
      observacoes: "CHUVA CEDO",
      ativo: true,
    });
  });

  it("EST-FORM-5 — fim antes do início não envia; observação vazia vai como null", async () => {
    const { form, onSubmit } = montar({
      isEditing: true,
      initialData: { id: "e1", nome: "SECA", tipo: "SECA", data_inicio: "2026-06-01", data_fim: "2026-05-01", ativo: false },
    });
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", "A data de fim não pode ser anterior à data de início.");
    fireEvent.change(screen.getByTestId("estacao-data-fim"), { target: { value: "2026-09-30" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      nome: "SECA",
      tipo: "SECA",
      data_inicio: "2026-06-01",
      data_fim: "2026-09-30",
      observacoes: null,
      ativo: false,
    });
    expect(screen.getByText("Editar Estação")).toBeTruthy();
    expect(form).toBeTruthy();
  });

  it("EST-FORM-5b — ano fora de 1900–2100 não envia e avisa a faixa (o servidor recusaria)", () => {
    const { onSubmit } = montar({
      initialData: { nome: "X", tipo: "SECA", data_inicio: "1899-12-31", data_fim: "2026-01-31" },
    });
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", "As datas precisam estar entre os anos 1900 e 2100.");
  });

  it("EST-FORM-6 — em leitura, o tipo aparece pelo rótulo", () => {
    const { form } = montar({
      readOnly: true,
      initialData: { id: "e1", nome: "X", tipo: "TRANSICAO", data_inicio: "2027-04-01", data_fim: "2027-05-15" },
    });
    expect(within(form).getByDisplayValue("TRANSIÇÃO")).toBeTruthy();
  });
});

describe("EST-GRADE — valores e ordenação da lista", () => {
  const item = { nome: "SECA 2026", tipo: "SECA", data_inicio: "2026-05-16", data_fim: "2026-09-30", ativo: true };

  it("EST-GRADE-1 — datas dd/mm/aaaa sem deslocar o dia, tipo pelo rótulo e duração contando os dois extremos", () => {
    expect(getEstacaoFieldValue(item, "data_inicio")).toBe("16/05/2026");
    expect(getEstacaoFieldValue(item, "data_fim")).toBe("30/09/2026");
    expect(getEstacaoFieldValue(item, "tipo")).toBe("SECA");
    expect(getEstacaoFieldValue(item, "duracao_dias")).toBe("138");
    expect(duracaoEstacaoEmDias({ data_inicio: "2026-11-01", data_fim: "2026-11-01" })).toBe(1);
    expect(duracaoEstacaoEmDias({ data_inicio: "2026-11-02", data_fim: "2026-11-01" })).toBeNull();
  });

  it("EST-GRADE-2 — datas ordenam pelo valor canônico, não pelo texto formatado", () => {
    const a = { data_inicio: "2026-12-01" };
    const b = { data_inicio: "2027-01-15" };
    // Pelo texto "01/12/2026" > "15/01/2027" seria falso; pelo dia, a vem antes.
    expect(compararEstacoesParaOrdenar(a, b, "data_inicio")).toBeLessThan(0);
    expect(compararEstacoesParaOrdenar(a, {}, "data_inicio")).toBe(-1);
    expect(compararEstacoesParaOrdenar(a, b, "nome")).toBeNull();
    // "Criado em" pelo instante ISO, não pelo texto "dd/mm/aaaa hh:mm".
    const velho = { created_date: "2026-12-01T10:00:00.000Z" };
    const novo = { created_date: "2027-01-15T09:00:00.000Z" };
    expect(compararEstacoesParaOrdenar(velho, novo, "created_date")).toBeLessThan(0);
    expect(compararEstacoesParaOrdenar(novo, velho, "updated_date")).toBe(0);
  });
});

describe("EST-PAGE — tela de estações", () => {
  const renderizar = async () => {
    const { default: Estacoes } = await import("@/pages/Estacoes");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Estacoes />
      </QueryClientProvider>,
    );
  };

  it("EST-PAGE-1 — lista as estações da fazenda selecionada e abre o formulário no Novo", async () => {
    servico.listarEstacoes.mockResolvedValue([
      { id: "e1", nome: "ÁGUAS 2026/2027", tipo: "AGUAS", data_inicio: "2026-11-01", data_fim: "2027-04-30", ativo: true },
    ]);
    await renderizar();
    await waitFor(() => expect(screen.getByText("ÁGUAS 2026/2027")).toBeTruthy());
    expect(servico.listarEstacoes).toHaveBeenCalledWith("emp-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-estacao");
    expect(rotulos(form)).toEqual(ROTULOS);
    fireEvent.submit(document.getElementById(FORMULARIO_ESTACAO_ID));
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(4));
    expect(servico.criarEstacao).not.toHaveBeenCalled();
  });

  it("EST-PAGE-1b — trocar de fazenda relê a lista da fazenda nova e fecha o registro aberto", async () => {
    servico.listarEstacoes.mockImplementation(async (empresa) =>
      empresa === "emp-1"
        ? [{ id: "e1", nome: "ÁGUAS FAZENDA 1", tipo: "AGUAS", data_inicio: "2026-11-01", data_fim: "2027-04-30", ativo: true }]
        : [{ id: "e2", nome: "SECA FAZENDA 2", tipo: "SECA", data_inicio: "2026-05-01", data_fim: "2026-09-30", ativo: true }],
    );
    const { default: Estacoes } = await import("@/pages/Estacoes");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const arvore = () => (
      <QueryClientProvider client={queryClient}>
        <Estacoes />
      </QueryClientProvider>
    );
    const { rerender } = render(arvore());
    await waitFor(() => expect(screen.getByText("ÁGUAS FAZENDA 1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    await screen.findByTestId("b1-form-estacao");
    sessao.empresaId = "emp-2";
    rerender(arvore());
    await waitFor(() => expect(screen.getByText("SECA FAZENDA 2")).toBeTruthy());
    expect(servico.listarEstacoes).toHaveBeenCalledWith("emp-2");
    expect(screen.queryByText("ÁGUAS FAZENDA 1")).toBeNull();
    expect(screen.queryByTestId("b1-form-estacao")).toBeNull();
  });

  it("EST-PAGE-2 — sem fazenda selecionada: aviso, nenhuma consulta e sem botão Novo", async () => {
    sessao.empresaId = null;
    servico.listarEstacoes.mockResolvedValue([]);
    await renderizar();
    expect(await screen.findByTestId("estacoes-sem-fazenda")).toBeTruthy();
    expect(servico.listarEstacoes).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo" })).toBeNull();
  });
});
