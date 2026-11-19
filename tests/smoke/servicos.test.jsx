/**
 * Cadastro de Serviços da fazenda (D-PROD-207, Fatia 4 do Lançamento de
 * Atividades). O cadastro próprio de Funcionários saiu na D-PROD-208: o
 * funcionário é papel do parceiro (ver gestaoParceiros.test.jsx).
 *
 * Serviço: Nome, Unidade de medida (só as ativas do cadastro de Unidades e a
 * gravada), Centro de custo padrão (os ativos da fazenda) e Valor de referência.
 * Sem campo de fazenda (vem do topo) nem de situação editável: inativar e
 * reativar são ações da tela. A lista é da fazenda selecionada e avisa quando
 * nenhuma está selecionada.
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

const { default: FormularioServico, FORMULARIO_SERVICO_ID } = await import("@/components/servicos/FormularioServico");
const { getServicoFieldValue, compararDecimaisParaOrdenar } = await import("@/components/servicos/TabelaServicos");

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

  it("SER-FORM-1 — quatro campos, nesta ordem, e a situação só em leitura; a unidade oferece só as ATIVAS do cadastro de unidades", async () => {
    const { form } = montar();
    // Desde a #339 a chave "Ativo" aparece também no Novo, ligada e desabilitada: a situação não é editável no formulário.
    expect(rotulos(form)).toEqual(["Nome", "Unidade de medida", "Centro de custo padrão", "Valor de referência (R$)", "Ativo"]);
    const ativo = within(form).getByRole("switch", { name: "Serviço ativo" });
    expect(ativo).toBeDisabled();
    expect(ativo).toHaveAttribute("aria-checked", "true");
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

describe("SER-GRADE — valores da lista", () => {
  it("valor de referência em reais (sem float) e ordenado pelo valor, nunca pelo texto", () => {
    expect(compararDecimaisParaOrdenar({ valor_referencia: "100.0000" }, { valor_referencia: "25.0000" }, "valor_referencia")).toBeGreaterThan(0);
    expect(compararDecimaisParaOrdenar({ valor_referencia: "1.0000" }, {}, "valor_referencia")).toBe(-1);
    expect(compararDecimaisParaOrdenar({}, {}, "nome")).toBeNull();
    const s = { unidade_medida: { sigla: "HA" }, centro_custo_padrao: { numero: "3", nome: "LAVOURA" }, valor_referencia: "85.9000" };
    expect(getServicoFieldValue(s, "unidade")).toBe("HA");
    expect(getServicoFieldValue(s, "centro_custo_padrao")).toBe("3 — LAVOURA");
    expect(getServicoFieldValue(s, "valor_referencia")).toMatch(/85,90/);
  });
});

describe("SER-PAGE — tela", () => {
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
    const { default: Servicos } = await import("@/pages/Servicos");
    comQuery(<Servicos />);
    expect(await screen.findByTestId("servicos-sem-fazenda")).toBeTruthy();
    expect(servicos.listarServicosPagina).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo" })).toBeNull();
  });
});
