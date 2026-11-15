/**
 * Cadastro de Formulações de suplemento da fazenda (D-PROD-203), tabelas
 * CADFORMULACAO, CADFORMULACAOINGREDIENTE e CADFORMULACAOREGRA.
 *
 *  FO-SV. leitura de decimal pt-BR, total da batida e % de cada ingrediente,
 *         validação espelhando o servidor (forma, faixas, repetições) e o corpo;
 *  FO-FORM. formulário: Tipo troca a seção de ingredientes (só na BATELADA), total
 *         e % ao vivo, regras por categoria (Consome? liga o %PV), envio;
 *  FO-GRADE. colunas e valores da lista;
 *  FO-PAGE. tela: lista da fazenda, aviso sem fazenda e o 409 FORMULACAO_EM_USO;
 *  FO-API. porta nativa: rotas e `empresa_id`.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyWarning: notify.notifyWarning,
  notifyError: notify.notifyError,
}));

const servico = vi.hoisted(() => ({
  listarFormulacoes: vi.fn(),
  criarFormulacao: vi.fn(),
  atualizarFormulacao: vi.fn(),
  excluirFormulacoes: vi.fn(),
}));
vi.mock("@/services/formulacaoCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  ...servico,
}));
vi.mock("@/services/produtoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarProdutosDaEmpresa: vi.fn(async () => PRODUTOS),
}));
vi.mock("@/services/categoriaManejoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarCategoriasManejoDaEmpresa: vi.fn(async () => CATEGORIAS),
}));

const nativeRequest = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: (...a) => nativeRequest(...a) }));

const sessao = vi.hoisted(() => ({ empresaId: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => sessao.empresaId,
}));

const PRODUTOS = vi.hoisted(() => [
  { id: "p-sal", nome_produto: "SAL MINERAL 80", ativo: true },
  { id: "p-mix", nome_produto: "PROTEINADO DA FAZENDA", ativo: true },
  { id: "p-milho", nome_produto: "MILHO GRAO", ativo: true },
  { id: "p-farelo", nome_produto: "FARELO DE SOJA", ativo: true },
  { id: "p-nucleo", nome_produto: "NUCLEO MINERAL", ativo: true },
  { id: "p-velho", nome_produto: "SAL VELHO", ativo: false },
]);
const CATEGORIAS = vi.hoisted(() => [
  { id: "c-bez", nome: "BEZERRO MAMANDO", ativo: true },
  { id: "c-vaca", nome: "VACA LEITEIRA", ativo: true },
]);

const { default: FormularioFormulacao, FORMULARIO_FORMULACAO_ID, formularioDoRegistro } = await import("@/components/formulacoes/FormularioFormulacao");
const { getFormulacaoFieldValue, compararFormulacoesParaOrdenar, FORMULACOES_COLUNAS } = await import("@/components/formulacoes/TabelaFormulacoes");
const { lerPercentualPV, lerKg, lerGramas, resumoDaBatida, validarFormulacao, mensagemExclusaoBloqueada, QUERY_FORMULACOES_LANCAMENTO } = await import(
  "@/services/formulacaoCadastroService"
);

/** Escolhe `nome` no B1Select de rótulo `rotulo`. */
const escolher = async (rotulo, nome) => {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    if (!screen.queryByRole("option", { name: nome })) {
      await act(async () => {
        fireEvent.click(screen.getByLabelText(rotulo));
      });
    }
    const opcao = await screen.findByRole("option", { name: nome }, { timeout: 400 }).catch(() => null);
    if (opcao) {
      await act(async () => {
        fireEvent.click(opcao);
      });
      return;
    }
  }
  throw new Error(`opção ${nome} não apareceu em ${rotulo}`);
};

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  render(<FormularioFormulacao onSubmit={onSubmit} toolbarActions produtos={PRODUTOS} categorias={CATEGORIAS} {...props} />);
  return { onSubmit, form: screen.getByTestId("b1-form-formulacao") };
};
const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_FORMULACAO_ID));
const digitar = (rotulo, valor) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });

const BATELADA = {
  id: "f-2", nome: "PROTEINADO SECA", tipo: "BATELADA", produto_id: "p-mix", produto_nome: "PROTEINADO DA FAZENDA", produto_ativo: true,
  percentual_pv_padrao: 0.2, consumo_objetivo_g_cab_dia: 800, observacoes: null, ativo: true, total_batida_kg: 1000,
  ingredientes: [
    { id: "i1", produto_id: "p-milho", produto_nome: "MILHO GRAO", quantidade_kg: 600, percentual: 60, ordem: 0 },
    { id: "i2", produto_id: "p-farelo", produto_nome: "FARELO DE SOJA", quantidade_kg: 300, percentual: 30, ordem: 1 },
    { id: "i3", produto_id: "p-nucleo", produto_nome: "NUCLEO MINERAL", quantidade_kg: 100, percentual: 10, ordem: 2 },
  ],
  regras: [
    { id: "r1", categoria_manejo_id: "c-bez", categoria_manejo_nome: "BEZERRO MAMANDO", consome: false, percentual_pv: null },
    { id: "r2", categoria_manejo_id: "c-vaca", categoria_manejo_nome: "VACA LEITEIRA", consome: true, percentual_pv: 0.15 },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessao.empresaId = "emp-1";
});

describe("FO-SV — leitura, batida e validação", () => {
  it("FO-SV-1 — %PV com vírgula, de (0, 5] e até 4 casas; kg até 3 casas; gramas até 2; vazio é undefined", () => {
    expect([lerPercentualPV("0,15"), lerPercentualPV("0.1"), lerPercentualPV("5"), lerPercentualPV("0,0001")]).toEqual([0.15, 0.1, 5, 0.0001]);
    expect([lerPercentualPV("0"), lerPercentualPV("5,01"), lerPercentualPV("0,12345"), lerPercentualPV("abc"), lerPercentualPV("-1")]).toEqual([null, null, null, null, null]);
    expect(lerPercentualPV("")).toBeUndefined();
    expect([lerKg("600"), lerKg("100,5"), lerKg("0,001"), lerKg("1,0001"), lerKg("0")]).toEqual([600, 100.5, 0.001, null, null]);
    // milhar pt-BR: "1.000" na batida são mil quilos, não 1 kg
    expect([lerKg("1.000"), lerKg("1.250,5"), lerKg("12.500")]).toEqual([1000, 1250.5, 12500]);
    expect([lerGramas("800"), lerGramas("1,234"), lerGramas(" ")]).toEqual([800, null, undefined]);
  });

  it("FO-SV-2 — total da batida e o % de cada ingrediente (milho 600, farelo 300, núcleo 100 → 1.000 kg, 60/30/10)", () => {
    expect(resumoDaBatida([{ quantidade_kg: "600" }, { quantidade_kg: "300" }, { quantidade_kg: "100" }])).toEqual({ totalKg: 1000, percentuais: [60, 30, 10] });
    expect(resumoDaBatida([{ quantidade_kg: "0,1" }, { quantidade_kg: "0,2" }])).toEqual({ totalKg: 0.3, percentuais: [33.33, 66.67] });
    expect(resumoDaBatida([{ quantidade_kg: "" }, { quantidade_kg: "50" }])).toEqual({ totalKg: 50, percentuais: [null, 100] });
    expect(resumoDaBatida([])).toEqual({ totalKg: 0, percentuais: [] });
  });

  it("FO-SV-3 — validação: PRONTO não leva ingredientes; BATELADA exige 1, sem repetir e sem o próprio produto; regras sem repetir; consome exige %PV", () => {
    const base = formularioDoRegistro(BATELADA);
    const ok = validarFormulacao(base);
    expect(ok.erros).toEqual({});
    expect(ok.corpo).toEqual({
      nome: "PROTEINADO SECA", tipo: "BATELADA", produto_id: "p-mix", percentual_pv_padrao: 0.2, consumo_objetivo_g_cab_dia: 800,
      faixa_tolerancia_percentual: null, observacoes: null, ativo: true,
      ingredientes: [{ produto_id: "p-milho", quantidade_kg: 600 }, { produto_id: "p-farelo", quantidade_kg: 300 }, { produto_id: "p-nucleo", quantidade_kg: 100 }],
      regras: [{ categoria_manejo_id: "c-bez", consome: false, percentual_pv: null }, { categoria_manejo_id: "c-vaca", consome: true, percentual_pv: 0.15 }],
    });
    // PRONTO: os ingredientes do formulário não vão (a troca esvazia a lista no servidor).
    expect(validarFormulacao({ ...base, tipo: "PRONTO" }).corpo?.ingredientes).toEqual([]);
    expect(validarFormulacao({ ...base, ingredientes: [] }).erros.ingredientes).toMatch(/pelo menos 1/);
    expect(validarFormulacao({ ...base, ingredientes: [...base.ingredientes, { produto_id: "p-milho", quantidade_kg: "1" }] }).erros["ingredientes.3.produto_id"]).toBe("Produto repetido");
    expect(validarFormulacao({ ...base, ingredientes: [{ produto_id: "p-mix", quantidade_kg: "1" }] }).erros["ingredientes.0.produto_id"]).toMatch(/próprio produto/);
    expect(validarFormulacao({ ...base, ingredientes: [{ produto_id: "p-milho", quantidade_kg: "0" }] }).erros["ingredientes.0.quantidade_kg"]).toBeTruthy();
    expect(validarFormulacao({ ...base, regras: [...base.regras, { categoria_manejo_id: "c-bez", consome: false, percentual_pv: "" }] }).erros["regras.2.categoria_manejo_id"]).toBe("Categoria repetida");
    expect(validarFormulacao({ ...base, regras: [{ categoria_manejo_id: "c-vaca", consome: true, percentual_pv: "" }] }).erros["regras.0.percentual_pv"]).toBeTruthy();
    expect(validarFormulacao({ ...base, percentual_pv_padrao: "6" }).erros.percentual_pv_padrao).toBeTruthy();
    expect(validarFormulacao({ ...base, nome: " ", produto_id: "" }).erros).toMatchObject({ nome: "Obrigatório", produto_id: "Obrigatório" });
    // D-PROD-206: faixa de tolerância — vírgula aceita, vazio = null (15%), fora de (0, 100] ou 3 casas → erro.
    expect(validarFormulacao({ ...base, faixa_tolerancia_percentual: "12,5" }).corpo?.faixa_tolerancia_percentual).toBe(12.5);
    expect(validarFormulacao({ ...base, faixa_tolerancia_percentual: "" }).corpo?.faixa_tolerancia_percentual).toBeNull();
    for (const ruim of ["0", "100,5", "15,123", "abc"]) {
      expect(validarFormulacao({ ...base, faixa_tolerancia_percentual: ruim }).erros.faixa_tolerancia_percentual, ruim).toMatch(/De 0 a 100%/);
    }
    // Não consome: o %PV digitado antes não vai.
    expect(validarFormulacao({ ...base, regras: [{ categoria_manejo_id: "c-bez", consome: false, percentual_pv: "0,2" }] }).corpo?.regras).toEqual([{ categoria_manejo_id: "c-bez", consome: false, percentual_pv: null }]);
  });

  it("FO-SV-4 — aviso de exclusão bloqueada: em uso manda inativar; a chave das opções do lançamento é própria", () => {
    expect(mensagemExclusaoBloqueada([{ id: "f", code: "FORMULACAO_EM_USO", lancamentos: 3 }])).toBe(
      "Esta formulação já foi usada em 3 lançamento(s) de suplementação e não pode ser excluída. Inative-a.",
    );
    expect(mensagemExclusaoBloqueada([{ id: "a", code: "FORMULACAO_EM_USO", lancamentos: 1 }, { id: "b", code: "OUTRO" }])).toMatch(/2 formulações não puderam ser excluídas\. 1 já foi usada/);
    expect(QUERY_FORMULACOES_LANCAMENTO).toBe("formulacoes-opcoes-lancamento");
  });
});

describe("FO-FORM — formulário de formulação", () => {
  it("FO-FORM-1 — PRONTO (padrão): sem seção de ingredientes; trocar para Batelada mostra a seção, total e % ao vivo; voltar esconde", async () => {
    montar();
    expect(screen.queryByTestId("formulacao-ingredientes")).toBeNull();
    expect(screen.getByTestId("formulacao-sem-regras")).toBeTruthy();
    await escolher(/^Tipo/, "Batelada");
    expect(screen.getByTestId("formulacao-ingredientes")).toBeTruthy();
    fireEvent.click(screen.getByTestId("formulacao-ingrediente-adicionar"));
    fireEvent.click(screen.getByTestId("formulacao-ingrediente-adicionar"));
    digitar("kg do ingrediente 1", "600");
    digitar("kg do ingrediente 2", "400");
    expect(screen.getByTestId("formulacao-total-batida").textContent).toBe("1.000 kg");
    expect(screen.getByTestId("formulacao-ingrediente-0-percentual").textContent).toBe("60%");
    expect(screen.getByTestId("formulacao-ingrediente-1-percentual").textContent).toBe("40%");
    fireEvent.click(screen.getByLabelText("Remover ingrediente 2"));
    expect(screen.getByTestId("formulacao-total-batida").textContent).toBe("600 kg");
    await escolher(/^Tipo/, "Produto pronto");
    expect(screen.queryByTestId("formulacao-ingredientes")).toBeNull();
  });

  it("FO-FORM-2 — PRONTO completo envia números, regras (não consome e %PV próprio) e ingredientes vazios", async () => {
    const { onSubmit } = montar();
    fireEvent.change(screen.getByPlaceholderText(/EX\.: SAL MINERAL/), { target: { value: "sal 80" } });
    await escolher(/^Produto \(vai ao cocho\)/, "SAL MINERAL 80");
    digitar("Percentual do peso vivo padrão", "0,1");
    fireEvent.click(screen.getByTestId("formulacao-regra-adicionar"));
    fireEvent.click(screen.getByTestId("formulacao-regra-adicionar"));
    await escolher("Categoria da regra 1", "BEZERRO MAMANDO");
    await escolher("Categoria da regra 2", "VACA LEITEIRA");
    // Regra nova nasce "não consome": sem campo de %PV até ligar o Consome?.
    expect(screen.queryByLabelText("Percentual do peso vivo da regra 2")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Consome (regra 2)" }));
    digitar("Percentual do peso vivo da regra 2", "0,15");
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      nome: "SAL 80", tipo: "PRONTO", produto_id: "p-sal", percentual_pv_padrao: 0.1, consumo_objetivo_g_cab_dia: null,
      faixa_tolerancia_percentual: null, observacoes: null, ativo: true, ingredientes: [],
      regras: [{ categoria_manejo_id: "c-bez", consome: false, percentual_pv: null }, { categoria_manejo_id: "c-vaca", consome: true, percentual_pv: 0.15 }],
    });
  });

  it("FO-FORM-2b — D-PROD-206: faixa de tolerância com placeholder 15 (padrão); digitada vai no corpo; editar abre com a gravada", async () => {
    const { onSubmit } = montar();
    const campo = /** @type {HTMLInputElement} */ (screen.getByLabelText("Faixa de tolerância do consumo, em porcentagem do esperado"));
    expect(campo.placeholder).toBe("15");
    fireEvent.change(screen.getByPlaceholderText(/EX\.: SAL MINERAL/), { target: { value: "sal 80" } });
    await escolher(/^Produto \(vai ao cocho\)/, "SAL MINERAL 80");
    digitar("Percentual do peso vivo padrão", "0,1");
    digitar("Faixa de tolerância do consumo, em porcentagem do esperado", "20");
    enviar();
    expect(onSubmit.mock.calls[0][0].faixa_tolerancia_percentual).toBe(20);
    cleanup();
    montar({ initialData: { ...BATELADA, faixa_tolerancia_percentual: 12.5 }, isEditing: true });
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText("Faixa de tolerância do consumo, em porcentagem do esperado")).value).toBe("12,5");
  });

  it("FO-FORM-3 — obrigatórios e regra que consome sem %PV não enviam e marcam os campos", () => {
    const { onSubmit, form } = montar();
    fireEvent.click(screen.getByTestId("formulacao-regra-adicionar"));
    fireEvent.click(screen.getByRole("switch", { name: "Consome (regra 1)" }));
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalled();
    // Nome, Produto, %PV padrão, a categoria da regra e o %PV da regra.
    expect(within(form).getAllByText("Obrigatório").length).toBeGreaterThanOrEqual(4);
    expect(within(form).getAllByText(/De 0 a 5%/).length).toBe(1);
  });

  it("FO-FORM-4 — editar BATELADA abre com ingredientes (60/30/10, total 1.000 kg) e regras; envia igual", () => {
    const { onSubmit } = montar({ initialData: BATELADA, isEditing: true });
    expect(screen.getByTestId("formulacao-total-batida").textContent).toBe("1.000 kg");
    expect(["0", "1", "2"].map((n) => screen.getByTestId(`formulacao-ingrediente-${n}-percentual`).textContent)).toEqual(["60%", "30%", "10%"]);
    expect(/** @type {HTMLInputElement} */ (screen.getByLabelText("Percentual do peso vivo da regra 2")).value).toBe("0,15");
    enviar();
    expect(onSubmit.mock.calls[0][0]).toEqual(validarFormulacao(formularioDoRegistro(BATELADA)).corpo);
  });

  it("FO-FORM-5 — somente leitura: sem botões de adicionar/remover; produto inativo gravado aparece marcado", () => {
    montar({ initialData: { ...BATELADA, produto_id: "p-velho", produto_nome: "SAL VELHO" }, readOnly: true });
    expect(screen.queryByTestId("formulacao-regra-adicionar")).toBeNull();
    expect(screen.queryByTestId("formulacao-ingrediente-adicionar")).toBeNull();
    expect(screen.getByDisplayValue("SAL VELHO (INATIVO)")).toBeTruthy();
  });
});

describe("FO-GRADE — colunas e valores", () => {
  it("FO-GRADE-1 — Nome, Tipo, Produto, %PV, nº de regras, ingredientes/total e Ativo visíveis; ordena %PV pelo número", () => {
    expect(FORMULACOES_COLUNAS.filter((c) => c.default).map((c) => c.label)).toEqual(["Nome", "Tipo", "Produto", "% PV padrão", "Regras", "Ingredientes / batida", "Ativo"]);
    expect(["tipo", "produto_nome", "percentual_pv_padrao", "regras", "ingredientes"].map((c) => getFormulacaoFieldValue(BATELADA, c))).toEqual(["Batelada", "PROTEINADO DA FAZENDA", "0,2%", "2", "3 / 1.000 kg"]);
    expect(getFormulacaoFieldValue({ tipo: "PRONTO", ingredientes: [], regras: [] }, "ingredientes")).toBe("–");
    expect(compararFormulacoesParaOrdenar({ percentual_pv_padrao: 0.15 }, { percentual_pv_padrao: 1.2 }, "percentual_pv_padrao")).toBeLessThan(0);
    expect(compararFormulacoesParaOrdenar({ nome: "a" }, { nome: "b" }, "nome")).toBeNull();
  });
});

describe("FO-PAGE — tela de formulações", () => {
  const renderizar = async () => {
    const { default: Formulacoes } = await import("@/pages/Formulacoes");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Formulacoes />
      </QueryClientProvider>,
    );
  };

  it("FO-PAGE-1 — lista as formulações da fazenda selecionada e abre o formulário no Novo", async () => {
    servico.listarFormulacoes.mockResolvedValue([BATELADA]);
    await renderizar();
    await waitFor(() => expect(screen.getByText("PROTEINADO SECA")).toBeTruthy());
    expect(screen.getByText("3 / 1.000 kg")).toBeTruthy();
    expect(servico.listarFormulacoes).toHaveBeenCalledWith("emp-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    await screen.findByTestId("b1-form-formulacao");
    fireEvent.submit(document.getElementById(FORMULARIO_FORMULACAO_ID));
    expect(servico.criarFormulacao).not.toHaveBeenCalled();
  });

  it("FO-PAGE-2 — sem fazenda selecionada: aviso, nenhuma consulta e sem botão Novo", async () => {
    sessao.empresaId = null;
    servico.listarFormulacoes.mockResolvedValue([]);
    await renderizar();
    expect(await screen.findByTestId("formulacoes-sem-fazenda")).toBeTruthy();
    expect(servico.listarFormulacoes).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo" })).toBeNull();
  });

  it("FO-PAGE-3 — excluir formulação já usada em lançamento avisa para inativar", async () => {
    servico.listarFormulacoes.mockResolvedValue([BATELADA]);
    servico.excluirFormulacoes.mockResolvedValue({ excluidos: [], bloqueados: [{ id: "f-2", code: "FORMULACAO_EM_USO", lancamentos: 2 }] });
    await renderizar();
    await waitFor(() => expect(screen.getByText("PROTEINADO SECA")).toBeTruthy());
    fireEvent.doubleClick(screen.getByText("PROTEINADO SECA"));
    await screen.findByTestId("b1-form-formulacao");
    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir" }));
    await waitFor(() =>
      expect(notify.notifyError).toHaveBeenCalledWith("Atenção", "Esta formulação já foi usada em 2 lançamento(s) de suplementação e não pode ser excluída. Inative-a."),
    );
    expect(servico.excluirFormulacoes).toHaveBeenCalledWith(["f-2"], { empresaId: "emp-1" });
  });
});

describe("FO-API — porta nativa", () => {
  it("FO-API-1 — lista, opções do lançamento e exclusão levam empresa_id na query; escrita no corpo", async () => {
    const api = await import("@/apis/formulacoes");
    await api.listFormulacoes("emp-1");
    await api.listFormulacoesOpcoesLancamento("emp-1");
    await api.deleteFormulacao("f 1", "emp-1");
    await api.createFormulacao({ empresa_id: "emp-1", nome: "X" });
    const caminhos = nativeRequest.mock.calls.map((c) => [c[0], c[1]?.method ?? "GET"]);
    expect(caminhos).toEqual([
      ["/formulacoes?empresa_id=emp-1", "GET"],
      ["/formulacoes/opcoes-lancamento?empresa_id=emp-1", "GET"],
      ["/formulacoes/f%201?empresa_id=emp-1", "DELETE"],
      ["/formulacoes", "POST"],
    ]);
  });
});
