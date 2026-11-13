/**
 * Cadastro de Tipos de Atividade (D-PROD-182).
 *
 * O formulário tem exatamente quatro campos, nesta ordem: Grupo de atividade,
 * Nome do tipo de atividade, Descrição e Ativo. O seletor oferece só grupos
 * ativos e o envio leva só esses quatro campos — nada das flags legadas de
 * TipoTarefa.
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
  listarGruposSimples: vi.fn(),
  listarTiposAtividade: vi.fn(),
  criarTipoAtividade: vi.fn(),
  atualizarTipoAtividade: vi.fn(),
  excluirTiposAtividade: vi.fn(),
}));
vi.mock("@/services/tipoAtividadeCadastroService", () => servico);

const { default: FormularioTipoAtividade, FORMULARIO_TIPO_ATIVIDADE_ID } = await import(
  "@/components/tipos-atividade/FormularioTipoAtividade"
);

const GRUPOS = [
  { id: "g1", nome_grupo: "Pastagem", ativo: true },
  { id: "g2", nome_grupo: "Cercas", ativo: false },
  { id: "g3", nome_grupo: "Aguadas" },
];

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  render(<FormularioTipoAtividade grupos={GRUPOS} onSubmit={onSubmit} toolbarActions {...props} />);
  const form = screen.getByTestId("b1-form-tipo-atividade");
  return { onSubmit, form };
};

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (form) =>
  [...form.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const abrirGrupo = async (form) => {
  fireEvent.click(within(form).getByRole("combobox", { name: /Grupo de atividade/ }));
  return screen.findAllByRole("option");
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TA-FORM — formulário de tipo de atividade", () => {
  it("TA-FORM-1 — exatamente quatro campos, na ordem grupo, nome, descrição, ativo", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(["Grupo de atividade", "Nome do tipo de atividade", "Descrição", "Ativo"]);
    expect(form.textContent).not.toMatch(/Exige área|Pode ter/i);
    expect(screen.getByText("Novo Tipo de Atividade")).toBeTruthy();
  });

  it("TA-FORM-2 — o seletor oferece só os grupos ativos", async () => {
    const { form } = montar();
    const opcoes = (await abrirGrupo(form)).map((o) => o.textContent.trim());
    // "SELECIONE" é o marcador de vazio, como no tipo de tarefa.
    expect(opcoes).toEqual(["SELECIONE", "PASTAGEM", "AGUADAS"]);
    expect(screen.queryByRole("option", { name: /CERCAS/ })).toBeNull();
  });

  it("TA-FORM-2b — editar tipo de grupo já inativado mantém esse grupo selecionável (INATIVO), sem oferecer outros inativos", async () => {
    const grupos = [...GRUPOS, { id: "g4", nome_grupo: "Antigo", ativo: false }];
    const { form } = montar({
      grupos,
      isEditing: true,
      initialData: { id: "t1", grupo_atividade_id: "g2", grupo_atividade_nome: "CERCAS", nome_tipo: "REPARO", ativo: true },
    });
    const opcoes = (await abrirGrupo(form)).map((o) => o.textContent.trim());
    expect(opcoes).toEqual(["SELECIONE", "PASTAGEM", "CERCAS (INATIVO)", "AGUADAS"]);
  });

  it("TA-FORM-3 — grupo e nome são obrigatórios", async () => {
    const { form, onSubmit } = montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledTimes(1);
  });

  it("TA-FORM-4 — o envio leva só os quatro campos, com nome e descrição em maiúsculas", async () => {
    const { form, onSubmit } = montar();
    await abrirGrupo(form);
    fireEvent.click(screen.getByRole("option", { name: "PASTAGEM" }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    fireEvent.change(within(form).getByLabelText(/Nome do tipo de atividade/), {
      target: { value: "roçada manual" },
    });
    fireEvent.change(within(form).getByLabelText(/Descrição/), { target: { value: "beira de cerca" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(["ativo", "descricao", "grupo_atividade_id", "nome_tipo"]);
    expect(payload).toEqual({
      grupo_atividade_id: "g1",
      nome_tipo: "ROÇADA MANUAL",
      descricao: "BEIRA DE CERCA",
      ativo: true,
    });
  });

  it("TA-FORM-5 — editar preserva o envio de quatro campos, mesmo com dados extras no registro", () => {
    const { onSubmit } = montar({
      isEditing: true,
      initialData: {
        id: "ta1",
        nome_tipo: "ROÇADA",
        grupo_atividade_id: "g1",
        grupo_atividade_nome: "PASTAGEM",
        ativo: false,
        descricao: null,
        exige_area: true,
        created_date: "2027-01-01T00:00:00.000Z",
      },
    });
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      grupo_atividade_id: "g1",
      nome_tipo: "ROÇADA",
      descricao: "",
      ativo: false,
    });
  });

  it("TA-FORM-6 — em leitura, grupo já inativado aparece pelo nome em cache", () => {
    const { form } = montar({
      readOnly: true,
      grupos: [],
      initialData: { id: "ta1", nome_tipo: "X", grupo_atividade_id: "g2", grupo_atividade_nome: "Cercas" },
    });
    expect(within(form).getByDisplayValue("CERCAS")).toBeTruthy();
  });
});

describe("TA-PAGE — tela de tipos de atividade", () => {
  it("TA-PAGE-1 — lista os tipos e abre o formulário de quatro campos no Novo", async () => {
    servico.listarGruposSimples.mockResolvedValue(GRUPOS);
    servico.listarTiposAtividade.mockResolvedValue([
      { id: "ta1", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true },
    ]);
    const { default: TiposAtividade } = await import("@/pages/TiposAtividade");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TiposAtividade />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("ROÇADA")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-tipo-atividade");
    expect(rotulos(form)).toEqual(["Grupo de atividade", "Nome do tipo de atividade", "Descrição", "Ativo"]);
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(servico.criarTipoAtividade).not.toHaveBeenCalled();
  });
});
