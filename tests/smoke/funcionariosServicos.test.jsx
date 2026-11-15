/**
 * Cadastros de Funcionários e Serviços da fazenda (D-PROD-203, Fatia 4 do
 * Lançamento de Atividades).
 *
 * Funcionário: Nome, Cargo, Tipo (Mensalista / Diarista / Tarefeiro), Custo por
 * hora e Custo por diária; os custos vão como TEXTO canônico (nunca número),
 * vazio = null. Serviço: Nome, Unidade de medida (só as ativas do cadastro de
 * Unidades e a gravada), Centro de custo padrão (os ativos da fazenda) e Valor de
 * referência. Nenhum dos dois tem campo de fazenda (vem do topo) nem de situação
 * editável: inativar e reativar são ações da tela. A lista é da fazenda
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

const funcionarios = vi.hoisted(() => ({
  listarFuncionariosPagina: vi.fn(),
  criarFuncionario: vi.fn(),
  atualizarFuncionario: vi.fn(),
  inativarFuncionarios: vi.fn(),
  alterarSituacaoFuncionario: vi.fn(),
}));
vi.mock("@/services/funcionarioCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  ...funcionarios,
}));

const servicos = vi.hoisted(() => ({
  listarServicosPagina: vi.fn(),
  criarServico: vi.fn(),
  atualizarServico: vi.fn(),
  inativarServicos: vi.fn(),
  alterarSituacaoServico: vi.fn(),
  listarUnidadesDoServico: vi.fn(),
  listarCentrosCustoDoServico: vi.fn(),
}));
vi.mock("@/services/servicoCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  ...servicos,
}));

const sessao = vi.hoisted(() => ({ empresaId: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => sessao.empresaId,
}));

const { default: FormularioFuncionario, FORMULARIO_FUNCIONARIO_ID } = await import("@/components/funcionarios/FormularioFuncionario");
const { default: FormularioServico, FORMULARIO_SERVICO_ID } = await import("@/components/servicos/FormularioServico");
const { getFuncionarioFieldValue, compararDecimaisParaOrdenar } = await import("@/components/funcionarios/TabelaFuncionarios");
const { getServicoFieldValue } = await import("@/components/servicos/TabelaServicos");

const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (form) =>
  [...form.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const escolher = async (form, campo, rotulo) => {
  fireEvent.click(within(form).getByRole("combobox", { name: new RegExp(campo) }));
  await screen.findAllByRole("option");
  fireEvent.click(screen.getByRole("option", { name: rotulo }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};

const comQuery = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessao.empresaId = "emp-1";
});

describe("FUN-FORM — formulário de funcionário", () => {
  const montar = (props = {}) => {
    const onSubmit = vi.fn();
    render(<FormularioFuncionario onSubmit={onSubmit} {...props} />);
    return { onSubmit, form: screen.getByTestId("b1-form-funcionario") };
  };
  const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_FUNCIONARIO_ID));

  it("FUN-FORM-1 — cinco campos, nesta ordem; sem fazenda, salário ou situação editável no Novo", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(["Nome", "Cargo", "Tipo", "Custo por hora (R$)", "Custo por diária (R$)"]);
    expect(form.textContent).not.toMatch(/Fazenda|Empresa|Salário|Encargo|Ponto|Fornecedor/i);
  });

  it("FUN-FORM-2 — o tipo oferece exatamente MENSALISTA, DIARISTA e TAREFEIRO", async () => {
    const { form } = montar();
    fireEvent.click(within(form).getByRole("combobox", { name: /Tipo/ }));
    const opcoes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    expect(opcoes).toEqual(["MENSALISTA", "DIARISTA", "TAREFEIRO"]);
  });

  it("FUN-FORM-3 — nome e tipo obrigatórios; custo com sinal não envia", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByPlaceholderText("NOME"), { target: { value: "ana" } });
    await escolher(form, "Tipo", "DIARISTA");
    fireEvent.change(screen.getByTestId("funcionario-custo-hora"), { target: { value: "-5" } });
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("FUN-FORM-4 — o envio leva texto canônico nos custos (vírgula → ponto), maiúsculas e null no vazio", async () => {
    const { form, onSubmit } = montar();
    fireEvent.change(within(form).getByPlaceholderText("NOME"), { target: { value: "joão da silva" } });
    fireEvent.change(within(form).getByPlaceholderText(/TRATORISTA/), { target: { value: "tratorista" } });
    await escolher(form, "Tipo", "MENSALISTA");
    fireEvent.change(screen.getByTestId("funcionario-custo-hora"), { target: { value: "1.234,5" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      nome: "JOÃO DA SILVA",
      cargo: "TRATORISTA",
      tipo: "MENSALISTA",
      custo_hora: "1234.5",
      custo_diaria: null,
    });
  });

  it("FUN-FORM-5 — na edição mostra a situação, travada (muda pelas ações Inativar/Reativar)", () => {
    const { form } = montar({ readOnly: true, initialData: { id: "f1", nome: "X", tipo: "TAREFEIRO", custo_diaria: "150.2500", ativo: false } });
    expect(rotulos(form)).toContain("Ativo");
    expect(screen.getByTestId("funcionario-custo-diaria").value).toBe("150,25");
  });
});

describe("SER-FORM — formulário de serviço", () => {
  const unidades = [
    { id: "u1", sigla: "HA", descricao: "HECTARE", ativo: true },
    { id: "u2", sigla: "SC", descricao: "SACO", ativo: false },
  ];
  const montar = (props = {}) => {
    servicos.listarUnidadesDoServico.mockResolvedValue(unidades);
    servicos.listarCentrosCustoDoServico.mockResolvedValue([{ id: "c1", numero: "1", nome: "LAVOURA" }]);
    const onSubmit = vi.fn();
    comQuery(<FormularioServico onSubmit={onSubmit} empresaId="emp-1" {...props} />);
    return { onSubmit, form: screen.getByTestId("b1-form-servico") };
  };
  const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_SERVICO_ID));

  it("SER-FORM-1 — quatro campos, nesta ordem; a unidade oferece só as ATIVAS do cadastro de unidades", async () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(["Nome", "Unidade de medida", "Centro de custo padrão", "Valor de referência (R$)"]);
    expect(form.textContent).not.toMatch(/Fornecedor/i);
    await waitFor(() => expect(servicos.listarUnidadesDoServico).toHaveBeenCalled());
    fireEvent.click(within(form).getByRole("combobox", { name: /Unidade de medida/ }));
    await waitFor(() => expect(screen.getAllByRole("option").map((o) => o.textContent.trim())).toEqual(["HA - HECTARE"]));
    expect(servicos.listarCentrosCustoDoServico).toHaveBeenCalledWith("emp-1");
  });

  it("SER-FORM-2 — nome e unidade obrigatórios; o envio leva ids, centro null quando vazio e valor como texto", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByPlaceholderText(/APLICAÇÃO/), { target: { value: "aplicação aérea" } });
    await waitFor(() => expect(servicos.listarUnidadesDoServico).toHaveBeenCalled());
    await escolher(form, "Unidade de medida", "HA - HECTARE");
    fireEvent.change(screen.getByTestId("servico-valor-referencia"), { target: { value: "85,9" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      nome: "APLICAÇÃO AÉREA",
      unidade_medida_id: "u1",
      centro_custo_padrao_id: null,
      valor_referencia: "85.9",
    });
  });

  it("SER-FORM-3 — a unidade gravada que ficou inativa continua visível, marcada", async () => {
    const { form } = montar({
      initialData: { id: "s1", nome: "FRETE", unidade_medida_id: "u2", unidade_medida: { id: "u2", sigla: "SC", descricao: "SACO", ativo: false }, ativo: true },
    });
    await waitFor(() => expect(servicos.listarUnidadesDoServico).toHaveBeenCalled());
    fireEvent.click(within(form).getByRole("combobox", { name: /Unidade de medida/ }));
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent.trim())).toEqual(["SC - SACO (INATIVA)", "HA - HECTARE"]),
    );
  });
});

describe("FUN/SER-GRADE — valores da lista", () => {
  it("custos e valor de referência em reais (sem float) e ordenados pelo valor, nunca pelo texto", () => {
    expect(getFuncionarioFieldValue({ tipo: "DIARISTA" }, "tipo")).toBe("DIARISTA");
    expect(getFuncionarioFieldValue({ custo_hora: "25.5000" }, "custo_hora")).toMatch(/25,50/);
    expect(getFuncionarioFieldValue({ custo_hora: null }, "custo_hora")).toBe("");
    expect(compararDecimaisParaOrdenar({ custo_hora: "100.0000" }, { custo_hora: "25.0000" }, "custo_hora")).toBeGreaterThan(0);
    expect(compararDecimaisParaOrdenar({ custo_hora: "1.0000" }, {}, "custo_hora")).toBe(-1);
    expect(compararDecimaisParaOrdenar({}, {}, "nome")).toBeNull();
    const s = { unidade_medida: { sigla: "HA" }, centro_custo_padrao: { numero: "3", nome: "LAVOURA" }, valor_referencia: "85.9000" };
    expect(getServicoFieldValue(s, "unidade")).toBe("HA");
    expect(getServicoFieldValue(s, "centro_custo_padrao")).toBe("3 — LAVOURA");
    expect(getServicoFieldValue(s, "valor_referencia")).toMatch(/85,90/);
  });
});

describe("FUN/SER-PAGE — telas", () => {
  it("Funcionários: lista a fazenda selecionada (só ativos por padrão) e abre o formulário no Novo", async () => {
    funcionarios.listarFuncionariosPagina.mockResolvedValue(pagina([{ id: "f1", numero: "1", nome: "JOÃO DA SILVA", tipo: "DIARISTA", ativo: true }]));
    const { default: Funcionarios } = await import("@/pages/Funcionarios");
    comQuery(<Funcionarios />);
    await waitFor(() => expect(screen.getByText("JOÃO DA SILVA")).toBeTruthy());
    expect(funcionarios.listarFuncionariosPagina).toHaveBeenCalledWith("emp-1", expect.objectContaining({ ativo: true }));
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    expect(await screen.findByTestId("b1-form-funcionario")).toBeTruthy();
  });

  it("Serviços: lista a fazenda selecionada e abre o formulário no Novo", async () => {
    servicos.listarServicosPagina.mockResolvedValue(pagina([{ id: "s1", numero: "1", nome: "APLICAÇÃO AÉREA", unidade_medida: { sigla: "HA" }, ativo: true }]));
    servicos.listarUnidadesDoServico.mockResolvedValue([]);
    servicos.listarCentrosCustoDoServico.mockResolvedValue([]);
    const { default: Servicos } = await import("@/pages/Servicos");
    comQuery(<Servicos />);
    await waitFor(() => expect(screen.getByText("APLICAÇÃO AÉREA")).toBeTruthy());
    expect(servicos.listarServicosPagina).toHaveBeenCalledWith("emp-1", expect.objectContaining({ ativo: true }));
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    expect(await screen.findByTestId("b1-form-servico")).toBeTruthy();
  });

  it("sem fazenda selecionada: aviso, nenhuma consulta e sem botão Novo", async () => {
    sessao.empresaId = null;
    const { default: Funcionarios } = await import("@/pages/Funcionarios");
    const { default: Servicos } = await import("@/pages/Servicos");
    comQuery(<Funcionarios />);
    expect(await screen.findByTestId("funcionarios-sem-fazenda")).toBeTruthy();
    cleanup();
    comQuery(<Servicos />);
    expect(await screen.findByTestId("servicos-sem-fazenda")).toBeTruthy();
    expect(funcionarios.listarFuncionariosPagina).not.toHaveBeenCalled();
    expect(servicos.listarServicosPagina).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo" })).toBeNull();
  });
});
