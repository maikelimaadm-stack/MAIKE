/**
 * Cadastro de Culturas (D-PROD-215), tabela CADCULTURAS.
 *
 * Formulário: Código (vazio no novo = o servidor numera), Nome, Tipo
 * (PASTAGEM / CAPINEIRA / LAVOURA / SILAGEM), Espécie, Cultivar, alturas de
 * entrada e de saída em cm (pt-BR, 1 casa, saída < entrada), Ativo e
 * Observações. A fazenda não é campo (vem do topo). A tela lista as culturas
 * da fazenda, avisa sem fazenda e oferece "Incluir lista de referência", que
 * chama o comando idempotente do servidor.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyWarning: notify.notifyWarning,
  notifySuccess: notify.notifySuccess,
  notifyInfo: notify.notifyInfo,
}));

const servico = vi.hoisted(() => ({
  listarCulturas: vi.fn(),
  criarCultura: vi.fn(),
  atualizarCultura: vi.fn(),
  excluirCulturas: vi.fn(),
  incluirListaReferencia: vi.fn(),
}));
vi.mock("@/services/culturaCadastroService", async (importOriginal) => ({
  ...(await importOriginal()),
  ...servico,
}));

const sessao = vi.hoisted(() => ({ empresaId: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => sessao.empresaId,
}));

const { default: FormularioCultura, FORMULARIO_CULTURA_ID } = await import("@/components/culturas/FormularioCultura");
const { getCulturaFieldValue, compararCulturasParaOrdenar } = await import("@/components/culturas/TabelaCulturas");
const { lerAlturaCm, formatarAlturaCm } = await import("@/services/culturaCadastroService");

const ROTULOS = [
  "Código",
  "Nome",
  "Tipo",
  "Espécie",
  "Cultivar",
  "Altura de entrada (cm)",
  "Altura de saída (cm)",
  "Ativo",
  "Observações",
];

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  render(<FormularioCultura onSubmit={onSubmit} toolbarActions {...props} />);
  const form = screen.getByTestId("b1-form-cultura");
  return { onSubmit, form };
};

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_CULTURA_ID));

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (form) =>
  [...form.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const escolherTipo = async (form, rotulo) => {
  fireEvent.click(within(form).getByRole("combobox", { name: /Tipo/ }));
  await screen.findAllByRole("option");
  fireEvent.click(screen.getByRole("option", { name: rotulo }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};

const MARANDU = {
  id: "c1",
  codigo: "001",
  nome: "BRACHIARIA BRIZANTHA CV. MARANDU",
  tipo: "PASTAGEM",
  especie: "Urochloa brizantha",
  cultivar: "Marandu",
  altura_entrada_cm: 25,
  altura_saida_cm: 15,
  observacoes: "Valor de referência (manejo rotacionado). Ajuste para a fazenda.",
  ativo: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessao.empresaId = "emp-1";
});

describe("CULT-FORM — formulário de cultura", () => {
  it("CULT-FORM-1 — nove campos, nesta ordem; sem campo de fazenda, área ou lote", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(ROTULOS);
    expect(form.textContent).not.toMatch(/Fazenda|Empresa|Lote|Área/i);
    expect(screen.getByText("Nova Cultura")).toBeTruthy();
    expect(within(form).getByPlaceholderText("AUTOMÁTICO")).toBeTruthy();
  });

  it("CULT-FORM-2 — o tipo oferece exatamente PASTAGEM, CAPINEIRA, LAVOURA e SILAGEM", async () => {
    const { form } = montar();
    fireEvent.click(within(form).getByRole("combobox", { name: /Tipo/ }));
    const opcoes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    expect(opcoes).toEqual(["SELECIONE", "PASTAGEM", "CAPINEIRA", "LAVOURA", "SILAGEM"]);
  });

  it("CULT-FORM-3 — no novo, só nome e tipo são obrigatórios (o código é automático)", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledTimes(1);
  });

  it("CULT-FORM-4 — envio: nome em maiúsculas, sem código no novo, alturas pt-BR como texto, opcionais vazios como null", async () => {
    const { form, onSubmit } = montar();
    fireEvent.change(within(form).getByLabelText("Nome da cultura"), { target: { value: "capim da baixada" } });
    await escolherTipo(form, "CAPINEIRA");
    fireEvent.change(within(form).getByLabelText("Altura de entrada (cm)"), { target: { value: "25,5" } });
    fireEvent.change(within(form).getByLabelText("Altura de saída (cm)"), { target: { value: "15" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      nome: "CAPIM DA BAIXADA",
      tipo: "CAPINEIRA",
      especie: null,
      cultivar: null,
      altura_entrada_cm: "25.5",
      altura_saida_cm: "15",
      observacoes: null,
      ativo: true,
    });
  });

  it("CULT-FORM-5 — saída maior ou igual à entrada, altura com 2 casas ou zero não enviam", async () => {
    const { form, onSubmit } = montar({ initialData: { nome: "X", tipo: "PASTAGEM" } });
    const entrada = within(form).getByLabelText("Altura de entrada (cm)");
    const saida = within(form).getByLabelText("Altura de saída (cm)");
    fireEvent.change(entrada, { target: { value: "20" } });
    fireEvent.change(saida, { target: { value: "20" } });
    enviar();
    expect(notify.notifyWarning).toHaveBeenLastCalledWith("Atenção", "A altura de saída precisa ser menor que a altura de entrada.");
    fireEvent.change(saida, { target: { value: "10,25" } });
    enviar();
    fireEvent.change(saida, { target: { value: "0" } });
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledTimes(3);
  });

  it("CULT-FORM-6 — editando: mostra o código e as alturas em pt-BR; código vazio não envia", async () => {
    const { form, onSubmit } = montar({ isEditing: true, initialData: { ...MARANDU, altura_entrada_cm: 25.5 } });
    expect(screen.getByText("Editar Cultura")).toBeTruthy();
    expect(within(form).getByDisplayValue("001")).toBeTruthy();
    expect(within(form).getByDisplayValue("25,5")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Código da cultura"), { target: { value: "" } });
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Código da cultura"), { target: { value: "p-10" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ codigo: "P-10", altura_entrada_cm: "25.5", altura_saida_cm: "15" }));
  });

  it("CULT-FORM-7 — em leitura, o tipo aparece pelo rótulo", () => {
    const { form } = montar({ readOnly: true, initialData: { ...MARANDU, tipo: "SILAGEM" } });
    expect(within(form).getByDisplayValue("SILAGEM")).toBeTruthy();
  });
});

describe("CULT-GRADE — valores, ordenação e leitura das alturas", () => {
  it("CULT-GRADE-1 — alturas em pt-BR, tipo pelo rótulo", () => {
    expect(getCulturaFieldValue({ ...MARANDU, altura_entrada_cm: 25.5 }, "altura_entrada_cm")).toBe("25,5");
    expect(getCulturaFieldValue(MARANDU, "altura_saida_cm")).toBe("15");
    expect(getCulturaFieldValue({ ...MARANDU, altura_saida_cm: null }, "altura_saida_cm")).toBe("");
    expect(getCulturaFieldValue(MARANDU, "tipo")).toBe("PASTAGEM");
    expect(getCulturaFieldValue(MARANDU, "codigo")).toBe("001");
  });

  it("CULT-GRADE-2 — alturas ordenam pelo número (100 depois de 25), vazio por último", () => {
    expect(compararCulturasParaOrdenar({ altura_entrada_cm: 25 }, { altura_entrada_cm: 100 }, "altura_entrada_cm")).toBeLessThan(0);
    expect(compararCulturasParaOrdenar({ altura_entrada_cm: 25 }, {}, "altura_entrada_cm")).toBe(-1);
    expect(compararCulturasParaOrdenar({}, {}, "nome")).toBeNull();
  });

  it("CULT-GRADE-3 — lerAlturaCm aceita vírgula ou ponto, 1 casa, > 0 e até 1000", () => {
    expect(lerAlturaCm("25,5")).toBe(25.5);
    expect(lerAlturaCm("25.5")).toBe(25.5);
    expect(lerAlturaCm("")).toBeNull();
    for (const ruim of ["0", "-1", "10,25", "abc", "1001"]) expect(lerAlturaCm(ruim)).toBeUndefined();
    expect(formatarAlturaCm(90)).toBe("90");
  });
});

describe("CULT-PAGE — tela de culturas", () => {
  const renderizar = async () => {
    const { default: Culturas } = await import("@/pages/Culturas");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Culturas />
      </QueryClientProvider>,
    );
  };

  it("CULT-PAGE-1 — lista as culturas da fazenda selecionada e abre o formulário no Novo", async () => {
    servico.listarCulturas.mockResolvedValue([MARANDU]);
    await renderizar();
    await waitFor(() => expect(screen.getByText("BRACHIARIA BRIZANTHA CV. MARANDU")).toBeTruthy());
    expect(servico.listarCulturas).toHaveBeenCalledWith("emp-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-cultura");
    expect(rotulos(form)).toEqual(ROTULOS);
    expect(screen.queryByTestId("culturas-lista-referencia")).toBeNull();
  });

  it("CULT-PAGE-2 — \"Incluir lista de referência\" chama o comando da fazenda e avisa quantas entraram", async () => {
    servico.listarCulturas.mockResolvedValue([]);
    servico.incluirListaReferencia.mockResolvedValue({ criadas: 11, ja_existiam: 0, culturas: [] });
    await renderizar();
    fireEvent.click(await screen.findByTestId("culturas-lista-referencia"));
    await waitFor(() => expect(servico.incluirListaReferencia).toHaveBeenCalledWith("emp-1"));
    await waitFor(() =>
      expect(notify.notifySuccess).toHaveBeenCalledWith("Lista de referência incluída", "11 culturas incluídas."),
    );
    servico.incluirListaReferencia.mockResolvedValue({ criadas: 0, ja_existiam: 11, culturas: [] });
    fireEvent.click(screen.getByTestId("culturas-lista-referencia"));
    await waitFor(() =>
      expect(notify.notifyInfo).toHaveBeenCalledWith("Nada a incluir", "As 11 culturas de referência já estavam cadastradas."),
    );
  });

  it("CULT-PAGE-3 — sem fazenda selecionada: aviso, nenhuma consulta, sem Novo e sem lista de referência", async () => {
    sessao.empresaId = null;
    servico.listarCulturas.mockResolvedValue([]);
    await renderizar();
    expect(await screen.findByTestId("culturas-sem-fazenda")).toBeTruthy();
    expect(servico.listarCulturas).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Novo" })).toBeNull();
    expect(screen.queryByTestId("culturas-lista-referencia")).toBeNull();
  });
});
