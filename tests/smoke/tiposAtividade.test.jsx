/**
 * Cadastro de Tipos de Atividade (D-PROD-182; padrões e flags, D-PROD-197).
 *
 * O formulário tem três seções, nesta ordem: Identificação (Grupo de atividade,
 * Nome do tipo de atividade, Categoria, Descrição, Ativo), Apropriação (Centro
 * de custo padrão e Centro de resultado padrão, da fazenda SELECIONADA) e Como
 * funciona (Unidade de produção, Coeficiente padrão e as 8 flags, caixas de
 * marcar). O seletor de grupo oferece só grupos ativos; nada das flags legadas
 * de TipoTarefa (`pode_ter_*`). A porta, a API, o service e o transporte nativo
 * rodam de verdade sobre o `fetch`/`nativeRequest` falso (TA-PORTA, TA-ERRO).
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";

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
  // D-PROD-197: opções do formulário (consulta nunca devolve `undefined`).
  listarCentrosDaFazenda: vi.fn(async () => []),
  listarUnidadesDeMedida: vi.fn(async () => []),
}));
vi.mock("@/services/tipoAtividadeCadastroService", () => servico);

// A fazenda selecionada na sessão (a mesma empresa real do Apontamento de Atividade).
const sessao = vi.hoisted(() => ({ empresaId: /** @type {string|null} */ ("emp-1") }));
vi.mock("@/hooks/useGestaoSessao", () => ({ useEmpresaRealSelecionadaId: () => sessao.empresaId }));

// TA-PORTA: porta, API e service reais sobre o transporte falso.
const http = vi.hoisted(() => ({ nativeRequest: vi.fn() }));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: http.nativeRequest }));

const { default: FormularioTipoAtividade, FORMULARIO_TIPO_ATIVIDADE_ID } = await import(
  "@/components/tipos-atividade/FormularioTipoAtividade"
);

const GRUPOS = [
  { id: "g1", nome_grupo: "Pastagem", ativo: true },
  { id: "g2", nome_grupo: "Cercas", ativo: false },
  { id: "g3", nome_grupo: "Aguadas" },
];

const FLAGS = [
  "exige_area",
  "exige_safra",
  "exige_maquina",
  "permite_implemento",
  "permite_produto",
  "permite_servico",
  "permite_mao_obra",
  "exige_producao",
];
const ROTULOS_FLAGS = [
  "Exige área",
  "Exige safra",
  "Exige máquina",
  "Permite implemento",
  "Permite produto",
  "Permite serviço",
  "Permite mão de obra",
  "Exige produção",
];
const SEM_FLAGS = Object.fromEntries(FLAGS.map((f) => [f, false]));

const ROTULOS_IDENTIFICACAO = ["Grupo de atividade", "Nome do tipo de atividade", "Categoria", "Descrição", "Ativo"];
const ROTULOS_APROPRIACAO = ["Centro de custo padrão", "Centro de resultado padrão"];
const ROTULOS_COMO_FUNCIONA = ["Unidade de produção", "Coeficiente padrão", ...ROTULOS_FLAGS];
const ROTULOS_DO_FORMULARIO = [...ROTULOS_IDENTIFICACAO, ...ROTULOS_APROPRIACAO, ...ROTULOS_COMO_FUNCIONA];

/** Centros ATIVOS por fazenda, como a rota `/tipos-atividade/opcoes/…` devolve (`itens`). */
const CENTROS = {
  "emp-1": {
    "centros-custo": [
      { id: "cc1", numero: "1", nome: "Pecuária de corte" },
      { id: "cc2", numero: "2", nome: "Lavoura" },
    ],
    "centros-resultado": [{ id: "cr1", numero: "7", nome: "Recria 2026" }],
  },
  "emp-2": {
    "centros-custo": [{ id: "cc8", numero: "8", nome: "Cria" }],
    "centros-resultado": [],
  },
};
const centrosFalsos = async (recurso, empresaId) => CENTROS[empresaId]?.[recurso] ?? [];

const UNIDADES = [
  { id: "u-ha", sigla: "HA", descricao: "Hectare", ativo: true },
  { id: "u-h", sigla: "H", descricao: "Hora", ativo: true },
  { id: "u-alq", sigla: "ALQ", descricao: "Alqueire", ativo: false },
];

/** Um tipo gravado com padrões da fazenda emp-1 (como o servidor devolve, com os objetos incluídos). */
const SALVO = {
  id: "ta1",
  nome_tipo: "APLICAÇÃO DE HERBICIDA",
  grupo_atividade_id: "g1",
  grupo_atividade_nome: "PASTAGEM",
  ativo: true,
  descricao: null,
  categoria: "APLICACAO",
  centro_custo_padrao_id: "cc1",
  centro_custo_padrao: { id: "cc1", numero: "1", nome: "Pecuária de corte", empresa_id: "emp-1", ativo: true },
  centro_resultado_padrao_id: "cr1",
  centro_resultado_padrao: { id: "cr1", numero: "7", nome: "Recria 2026", empresa_id: "emp-1", ativo: true },
  unidade_producao_id: "u-ha",
  unidade_producao: { id: "u-ha", sigla: "HA", descricao: "Hectare", ativo: true },
  coeficiente_padrao: "1.5000",
  exige_area: true,
  exige_safra: false,
  exige_maquina: true,
  permite_implemento: true,
  permite_produto: true,
  permite_servico: false,
  permite_mao_obra: false,
  exige_producao: false,
};

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Deixa as consultas do formulário responderem dentro do `act`. */
const assentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

const formulario = (props = {}) => (
  <FormularioTipoAtividade grupos={GRUPOS} empresaId="emp-1" onSubmit={() => {}} toolbarActions {...props} />
);

const montar = async (props = {}) => {
  const onSubmit = vi.fn();
  const cliente = novoCliente();
  const resultado = render(<QueryClientProvider client={cliente}>{formulario({ onSubmit, ...props })}</QueryClientProvider>);
  await assentar();
  const form = screen.getByTestId("b1-form-tipo-atividade");
  /** @param {Record<string, unknown>} novos */
  const remontar = async (novos) => {
    resultado.rerender(<QueryClientProvider client={cliente}>{formulario({ onSubmit, ...props, ...novos })}</QueryClientProvider>);
    await assentar();
  };
  return { onSubmit, form, remontar };
};

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (raiz) =>
  [...raiz.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const abrirGrupo = async (form) => {
  fireEvent.click(within(form).getByRole("combobox", { name: /Grupo de atividade/ }));
  return screen.findAllByRole("option");
};

const combobox = (form, campo) => within(form).getByRole("combobox", { name: campo });
const valorDe = (form, campo) => combobox(form, campo).textContent.trim();

const opcoesDe = async (form, campo) => {
  fireEvent.click(combobox(form, campo));
  const nomes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
  fireEvent.click(combobox(form, campo));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  return nomes;
};

const escolher = async (form, campo, opcao) => {
  fireEvent.click(combobox(form, campo));
  fireEvent.click(await screen.findByRole("option", { name: opcao }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};

const limpar = async (form, campo) => {
  fireEvent.click(within(combobox(form, campo).closest(".mg-field")).getByRole("button", { name: "Limpar" }));
  await waitFor(() => expect(combobox(form, campo).hasAttribute("data-placeholder")).toBe(true));
};

/** A caixa de marcar da flag (o `data-testid` fica no próprio `<input type="checkbox">`). */
const flag = (nome) => screen.getByTestId(`tipo-atividade-flag-${nome}`);

const preencherObrigatorios = async (form) => {
  await abrirGrupo(form);
  fireEvent.click(screen.getByRole("option", { name: "PASTAGEM" }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  fireEvent.change(within(form).getByLabelText(/Nome do tipo de atividade/), { target: { value: "plantio direto" } });
};

beforeEach(() => {
  sessao.empresaId = "emp-1";
  servico.listarCentrosDaFazenda.mockImplementation(centrosFalsos);
  servico.listarUnidadesDeMedida.mockResolvedValue(UNIDADES);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("TA-FORM — formulário da operação (D-PROD-257): tipo fixo + nome + ativo", () => {
  it("TA-FORM-1 — só três campos: Tipo, Nome da operação e Ativo; Grupo, centros, unidade, coeficiente e as 8 chaves saíram", async () => {
    const { form } = await montar();
    expect(rotulos(form)).toEqual(["Tipo", "Nome da operação", "Ativo"]);
    for (const nome of ["Grupo de atividade", "Categoria", "Descrição", "Centro de custo padrão", "Unidade de produção", "Coeficiente padrão", ...ROTULOS_FLAGS]) {
      expect(within(form).queryByText(nome)).toBeNull();
    }
    // Sem as listas de apoio: o formulário não pede centros nem unidades.
    expect(servico.listarCentrosDaFazenda).not.toHaveBeenCalled();
    expect(servico.listarUnidadesDeMedida).not.toHaveBeenCalled();
  });

  it("TA-FORM-2 — Tipo oferece os 7 tipos fixos, nesta ordem, sem Colheita nem Manejo animal", async () => {
    const { form } = await montar();
    expect(await opcoesDe(form, "Tipo")).toEqual([
      "Preparo do solo",
      "Formação de pastagem (plantio)",
      "Fertilização",
      "Aplicação",
      "Roçada e tratos",
      "Manutenção",
      "Outros",
    ]);
  });

  it("TA-FORM-3 — tipo e nome são obrigatórios: sem eles não envia", async () => {
    const { form, onSubmit } = await montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    await escolher(form, "Tipo", "Aplicação");
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("TA-FORM-4 — o envio leva só categoria, nome em maiúsculas e ativo (sem grupo nem chaves: o servidor dá o padrão)", async () => {
    const { form, onSubmit } = await montar();
    await escolher(form, "Tipo", "Preparo do solo");
    fireEvent.change(within(form).getByLabelText(/Nome da operação/), { target: { value: "  gradeação leve " } });
    enviar();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ categoria: "PREPARO_SOLO", nome_tipo: "GRADEAÇÃO LEVE", ativo: true });
  });

  it("TA-FORM-5 — editar carrega tipo, nome e ativo gravados; dados extras do registro (grupo, chaves, centros) não vão de volta", async () => {
    const { form, onSubmit } = await montar({ initialData: { ...SALVO, categoria: "TRATO_CULTURAL" }, isEditing: true });
    expect(valorDe(form, "Tipo")).toBe("Fertilização");
    expect(within(form).getByLabelText(/Nome da operação/).value).toBe("APLICAÇÃO DE HERBICIDA");
    fireEvent.click(within(form).getByRole("switch", { name: "Operação ativa" }));
    enviar();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({ categoria: "TRATO_CULTURAL", nome_tipo: "APLICAÇÃO DE HERBICIDA", ativo: false });
  });

  it("TA-FORM-6 — operação antiga sem tipo fixo (sem categoria ou COLHEITA) abre pedindo o tipo, e não envia sem ele", async () => {
    for (const categoria of [null, "COLHEITA", "MANEJO_ANIMAL"]) {
      const { form, onSubmit } = await montar({ initialData: { ...SALVO, categoria }, isEditing: true });
      expect(combobox(form, "Tipo").hasAttribute("data-placeholder")).toBe(true);
      enviar();
      await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(1));
      expect(onSubmit).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("TA-FORM-7 — em leitura, mostra o tipo e o nome sem permitir mudar", async () => {
    const { form } = await montar({ initialData: SALVO, isEditing: true, readOnly: true });
    expect(valorDe(form, "Tipo")).toBe("Aplicação");
    expect(within(form).getByLabelText(/Nome da operação/).readOnly).toBe(true);
  });
});

describe("TA-PAGE — tela de operações (D-PROD-257)", () => {
  const montarTela = async () => {
    const { default: TiposAtividade } = await import("@/pages/TiposAtividade");
    render(
      <QueryClientProvider client={novoCliente()}>
        <TiposAtividade />
      </QueryClientProvider>,
    );
    await assentar();
  };

  const abrirNovo = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = await screen.findByTestId("b1-form-tipo-atividade");
    await assentar();
    return form;
  };

  it("TA-PAGE-1 — lista as operações e abre o formulário de três campos no Novo; sem tipo e nome não grava", async () => {
    servico.listarTiposAtividade.mockResolvedValue([
      { id: "ta1", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: "PASTAGEM" },
    ]);
    await montarTela();
    await waitFor(() => expect(screen.getByText("ROÇADA")).toBeTruthy());
    const form = await abrirNovo();
    expect(rotulos(form)).toEqual(["Tipo", "Nome da operação", "Ativo"]);
    expect(servico.listarCentrosDaFazenda).not.toHaveBeenCalled();
    expect(servico.listarGruposSimples).not.toHaveBeenCalled();
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(servico.criarTipoAtividade).not.toHaveBeenCalled();
  });

  it("TA-GRADE-1 — a chave das preferências mudou (_v4); colunas Tipo, Operação, Ativo; categoria antiga lê como Outros", async () => {
    const { TIPOS_ATIVIDADE_STORAGE_KEY, TIPOS_ATIVIDADE_COLUNAS, getTipoAtividadeFieldValue } = await import(
      "@/components/tipos-atividade/TabelaTiposAtividade"
    );
    expect(TIPOS_ATIVIDADE_STORAGE_KEY).toBe("colunas_largura_tipos_atividade_v4");
    expect(TIPOS_ATIVIDADE_COLUNAS.filter((c) => c.default).map((c) => c.id)).toEqual(["categoria", "nome_tipo", "ativo", "updated_date"]);
    expect(TIPOS_ATIVIDADE_COLUNAS.find((c) => c.id === "categoria")?.label).toBe("Tipo");
    expect(TIPOS_ATIVIDADE_COLUNAS.find((c) => c.id === "nome_tipo")?.label).toBe("Operação");
    expect(getTipoAtividadeFieldValue({ categoria: "PASTAGEM" }, "categoria")).toBe("Roçada e tratos");
    expect(getTipoAtividadeFieldValue({ categoria: "TRATO_CULTURAL" }, "categoria")).toBe("Fertilização");
    expect(getTipoAtividadeFieldValue({ categoria: "MANEJO_ANIMAL" }, "categoria")).toBe("Outros");
    expect(getTipoAtividadeFieldValue({ categoria: null }, "categoria")).toBe("Outros");
  });

  it("TA-PAGE-2 — a tabela mostra o Tipo com o rótulo legível e não mostra Grupo nem 'O que pode registrar'", async () => {
    servico.listarTiposAtividade.mockResolvedValue([
      { id: "ta1", nome_tipo: "PULVERIZAÇÃO", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: "APLICACAO", permite_produto: true },
      { id: "ta2", nome_tipo: "ADUBAÇÃO", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: "TRATO_CULTURAL" },
      { id: "ta3", nome_tipo: "CERCA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: null },
    ]);
    await montarTela();
    await waitFor(() => expect(screen.getByText("PULVERIZAÇÃO")).toBeTruthy());
    expect(screen.getByRole("columnheader", { name: /^Tipo/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Operação/ })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: /Grupo/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /O que pode registrar/ })).toBeNull();
    expect(screen.getByText("Aplicação")).toBeTruthy();
    expect(screen.getByText("Fertilização")).toBeTruthy();
    expect(screen.getByText("Outros")).toBeTruthy();
    expect(screen.queryByText("APLICACAO")).toBeNull();
    expect(screen.queryByText("PASTAGEM")).toBeNull();
  });

  it("TA-PAGE-3 — salvar o Novo leva só categoria, nome e ativo ao service", async () => {
    servico.listarTiposAtividade.mockResolvedValue([]);
    servico.criarTipoAtividade.mockResolvedValue({ ...SALVO, id: "novo", nome_tipo: "PLANTIO DIRETO", categoria: "PLANTIO" });
    await montarTela();
    const form = await abrirNovo();
    await escolher(form, "Tipo", "Formação de pastagem (plantio)");
    fireEvent.change(within(form).getByLabelText(/Nome da operação/), { target: { value: "plantio direto" } });
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.criarTipoAtividade).toHaveBeenCalledTimes(1));
    expect(servico.criarTipoAtividade.mock.calls[0][0]).toEqual({ categoria: "PLANTIO", nome_tipo: "PLANTIO DIRETO", ativo: true });
  });

  it("TA-PAGE-4 — cancelar a edição descarta o rascunho: o próximo Salvar leva o gravado, não o que foi desfeito", async () => {
    servico.listarTiposAtividade.mockResolvedValue([{ ...SALVO }]);
    servico.atualizarTipoAtividade.mockImplementation(async ({ id, dados }) => ({ ...SALVO, ...dados, id }));
    await montarTela();
    await waitFor(() => expect(screen.getByText("APLICAÇÃO DE HERBICIDA")).toBeTruthy());
    fireEvent.doubleClick(screen.getByText("APLICAÇÃO DE HERBICIDA").closest('[data-testid="b1-row"]'));
    await screen.findByTestId("b1-form-tipo-atividade");
    await assentar();
    const campo = () => within(screen.getByTestId("b1-form-tipo-atividade"));

    // Edita o nome e CANCELA.
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/ }));
    await assentar();
    fireEvent.change(campo().getByLabelText(/Nome da operação/), { target: { value: "rascunho" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await assentar();
    expect(campo().getByLabelText(/Nome da operação/).value).toBe("APLICAÇÃO DE HERBICIDA");

    // Editar de novo e trocar só o tipo: o PATCH leva o nome gravado.
    fireEvent.click(screen.getByRole("button", { name: /^Editar$/ }));
    await assentar();
    await escolher(screen.getByTestId("b1-form-tipo-atividade"), "Tipo", "Fertilização");
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.atualizarTipoAtividade).toHaveBeenCalledTimes(1));
    const { dados } = servico.atualizarTipoAtividade.mock.calls[0][0];
    expect(dados).toEqual({ categoria: "TRATO_CULTURAL", nome_tipo: "APLICAÇÃO DE HERBICIDA", ativo: true });
  });
});

describe("TA-PORTA — porta, API e service do tipo (D-PROD-197)", () => {
  it("TA-PORTA-1 — o corpo leva só as chaves do contrato: flags só booleanas, coeficiente só texto (vazio = null)", async () => {
    const { operacoesNativas, CAMPOS_DE_CRIACAO, FLAGS_TIPO_ATIVIDADE } = await import("@/apis/atividades/tipoAtividadePort.js");
    // A tela e a porta falam das mesmas 8 flags, na mesma ordem.
    expect(FLAGS_TIPO_ATIVIDADE).toEqual(FLAGS);
    expect(CAMPOS_DE_CRIACAO.filter((c) => c.startsWith("pode_ter_"))).toEqual([]);
    http.nativeRequest.mockResolvedValue({});
    await operacoesNativas.create({
      nome_tipo: "GRADAGEM",
      grupo_atividade_id: "g1",
      ativo: true,
      descricao: "  ",
      categoria: "PREPARO_SOLO",
      centro_custo_padrao_id: "cc1",
      centro_resultado_padrao_id: "",
      unidade_producao_id: "u-ha",
      coeficiente_padrao: " 1.5 ",
      exige_area: true,
      exige_safra: false,
      // Flag que não é booleano de verdade não sai (o servidor recusaria com 400).
      exige_maquina: "true",
      permite_implemento: 1,
      permite_produto: null,
      // Fora do contrato.
      pode_ter_produto: true,
      pode_ter_maquina: true,
      pode_ter_implemento: true,
      cliente_id: "outro-tenant",
      id: "forjado",
      centro_custo_padrao: { id: "cc1" },
      unidade_producao: { id: "u-ha" },
      grupo_atividade_nome: "PASTAGEM",
      created_date: "2026-01-01T00:00:00.000Z",
    });
    const [caminho, opcoes] = http.nativeRequest.mock.calls.at(-1);
    expect(caminho).toBe("/tipos-atividade");
    expect(opcoes).toMatchObject({ method: "POST", autenticado: true });
    expect(opcoes.body).toEqual({
      nome_tipo: "GRADAGEM",
      grupo_atividade_id: "g1",
      ativo: true,
      descricao: null,
      categoria: "PREPARO_SOLO",
      centro_custo_padrao_id: "cc1",
      centro_resultado_padrao_id: null,
      unidade_producao_id: "u-ha",
      coeficiente_padrao: "1.5",
      exige_area: true,
      exige_safra: false,
    });
    // Número JSON no coeficiente não sai; `null` limpa o padrão.
    await operacoesNativas.update("ta1", { coeficiente_padrao: 1.5, exige_producao: false });
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/tipos-atividade/ta1");
    expect(http.nativeRequest.mock.calls.at(-1)[1]).toMatchObject({ method: "PATCH", body: { exige_producao: false } });
    expect(http.nativeRequest.mock.calls.at(-1)[1].body).not.toHaveProperty("coeficiente_padrao");
    await operacoesNativas.update("ta1", { coeficiente_padrao: null, categoria: null, centro_custo_padrao_id: null });
    expect(http.nativeRequest.mock.calls.at(-1)[1].body).toEqual({ coeficiente_padrao: null, categoria: null, centro_custo_padrao_id: null });
  });

  it("TA-PORTA-2 — a resposta chega com os padrões, os objetos incluídos e as 8 flags booleanas (registro antigo lê false/null)", async () => {
    const { getTipoAtividade, listTiposAtividade, createTipoAtividade, updateTipoAtividade } = await import("@/apis/atividades");
    const doServidor = { ...SALVO, created_date: "2026-11-14T10:00:00.000Z" };
    http.nativeRequest.mockResolvedValueOnce(doServidor);
    expect(await getTipoAtividade("ta1")).toEqual(doServidor);
    http.nativeRequest.mockResolvedValueOnce(doServidor);
    expect(await createTipoAtividade({ nome_tipo: "X", grupo_atividade_id: "g1" })).toEqual(doServidor);
    http.nativeRequest.mockResolvedValueOnce(doServidor);
    expect(await updateTipoAtividade("ta1", { exige_area: true })).toEqual(doServidor);
    // Registro sem as colunas novas (ex.: o cache offline anterior a elas).
    http.nativeRequest.mockResolvedValueOnce([{ id: "ta2", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", ativo: true }]);
    const [antigo] = await listTiposAtividade();
    expect(antigo).toEqual({
      id: "ta2",
      nome_tipo: "ROÇADA",
      grupo_atividade_id: "g1",
      ativo: true,
      categoria: null,
      centro_custo_padrao_id: null,
      centro_custo_padrao: null,
      centro_resultado_padrao_id: null,
      centro_resultado_padrao: null,
      unidade_producao_id: null,
      unidade_producao: null,
      coeficiente_padrao: null,
      ...SEM_FLAGS,
    });
  });

  it("TA-PORTA-3 — centros pela rota do tipo, com a fazenda na query; recurso ou fazenda ausente falha antes da rede", async () => {
    const { listOpcoesTipoAtividade } = await import("@/apis/atividades");
    const { API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    http.nativeRequest.mockResolvedValueOnce({ itens: [{ id: "cc1", numero: "1", nome: "Pecuária de corte" }, null, { nome: "sem id" }] });
    expect(await listOpcoesTipoAtividade("centros-custo", "emp-1")).toEqual({ itens: [{ id: "cc1", numero: "1", nome: "Pecuária de corte" }] });
    expect(http.nativeRequest).toHaveBeenLastCalledWith(
      "/tipos-atividade/opcoes/centros-custo?empresa_id=emp-1",
      { autenticado: true },
      expect.objectContaining({ resource: "TipoAtividade" }),
    );
    http.nativeRequest.mockResolvedValueOnce({ itens: [] });
    expect(await listOpcoesTipoAtividade("centros-resultado", "emp-1")).toEqual({ itens: [] });
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/tipos-atividade/opcoes/centros-resultado?empresa_id=emp-1");
    const chamadas = http.nativeRequest.mock.calls.length;
    await expect(listOpcoesTipoAtividade("centros-custo", "")).rejects.toMatchObject({ code: API_ERROR_CODES.INVALID_ARGUMENT });
    await expect(listOpcoesTipoAtividade("bens", "emp-1")).rejects.toMatchObject({ code: API_ERROR_CODES.INVALID_ARGUMENT });
    expect(http.nativeRequest.mock.calls.length).toBe(chamadas);
  });

  it("TA-PORTA-4 — o service devolve os itens dos centros e lê as unidades de GET /unidades-medida (a API do cadastro de unidades)", async () => {
    const real = await vi.importActual("@/services/tipoAtividadeCadastroService");
    http.nativeRequest.mockResolvedValueOnce({ itens: [{ id: "cr1", numero: "7", nome: "Recria 2026" }] });
    expect(await real.listarCentrosDaFazenda("centros-resultado", "emp-1")).toEqual([{ id: "cr1", numero: "7", nome: "Recria 2026" }]);
    http.nativeRequest.mockResolvedValueOnce(UNIDADES);
    expect(await real.listarUnidadesDeMedida()).toEqual(UNIDADES);
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/unidades-medida");
  });
});

describe("TA-ERRO — mensagem de TIPO_ATIVIDADE_PADRAO_INVALIDO por motivo", () => {
  it("TA-ERRO-1 — cada campo e motivo tem texto próprio; motivo desconhecido fica com a frase geral", async () => {
    const { ApiError, API_ERROR_CODES, getApiErrorMessage } = await import("@/apis/_core/ApiError.js");
    const CODE = "TIPO_ATIVIDADE_PADRAO_INVALIDO";
    expect(API_ERROR_CODES[CODE]).toBe(CODE);
    const recusa = (field, reason) => new ApiError(API_ERROR_CODES[CODE], { details: { field, reason, requestId: "req-1" } });
    const casos = [
      ["centro_custo_padrao_id", "nao_encontrado", /^O centro de custo padrão não foi encontrado\./],
      ["centro_custo_padrao_id", "inativo", /^O centro de custo padrão está inativo\./],
      ["centro_resultado_padrao_id", "nao_encontrado", /^O centro de resultado padrão não foi encontrado\./],
      ["centro_resultado_padrao_id", "inativo", /^O centro de resultado padrão está inativo\./],
      ["centro_resultado_padrao_id", "empresas_diferentes", /são de fazendas diferentes/],
      ["unidade_producao_id", "nao_encontrado", /^A unidade de produção não foi encontrada\./],
      ["unidade_producao_id", "inativo", /^A unidade de produção está inativa\./],
      ["coeficiente_padrao", "nao_positivo", /^O coeficiente padrão precisa ser maior que zero\./],
    ];
    for (const [field, reason, frase] of casos) {
      const texto = getApiErrorMessage(recusa(field, reason), "fallback");
      expect(texto).toMatch(frase);
      expect(texto).toMatch(/Nada foi gravado\.$/);
    }
    // Motivo desconhecido: a frase geral do catálogo, que não afirma motivo nenhum.
    const geral = new ApiError(API_ERROR_CODES[CODE]).message;
    expect(geral).toMatch(/padrões do tipo de atividade/);
    expect(getApiErrorMessage(recusa("centro_custo_padrao_id", "outro"), "fallback")).toBe(geral);
    // O mesmo `details` em outro código não vira recusa de padrão.
    const outro = new ApiError(API_ERROR_CODES.OPERATION_FAILED, { details: { field: "coeficiente_padrao", reason: "nao_positivo" } });
    expect(getApiErrorMessage(outro, "fallback")).toBe("Não foi possível concluir a operação.");
  });

  it("TA-ERRO-2 — o transporte nativo preserva TIPO_ATIVIDADE_PADRAO_INVALIDO e UNIDADE_MEDIDA_DELETE_BLOCKED, com field/reason em details", async () => {
    const { nativeRequest } = await vi.importActual("@/apis/_core/nativeHttpClient.js");
    const { API_ERROR_CODES, getApiErrorMessage } = await import("@/apis/_core/ApiError.js");
    vi.stubEnv("VITE_MAIKE_API_URL", "https://backend.exemplo.invalido");
    /** O corpo como o errorHandler do servidor monta: field/reason no topo, o resto em `details`. */
    const responder = (status, corpo) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, text: async () => JSON.stringify(corpo) })));
    const CTX = { operation: "createTipoAtividade", resource: "TipoAtividade" };

    responder(422, {
      code: "TIPO_ATIVIDADE_PADRAO_INVALIDO",
      message: "texto do servidor que nunca vai para a tela",
      request_id: "req-7",
      field: "unidade_producao_id",
      reason: "inativo",
    });
    const recusa = await nativeRequest("/tipos-atividade", { method: "POST", body: { nome_tipo: "X" } }, CTX).catch((e) => e);
    expect(recusa.code).toBe(API_ERROR_CODES.TIPO_ATIVIDADE_PADRAO_INVALIDO);
    expect(recusa.details).toMatchObject({ field: "unidade_producao_id", reason: "inativo", requestId: "req-7" });
    expect(getApiErrorMessage(recusa, "fallback")).toBe(
      "A unidade de produção está inativa. Escolha uma unidade ativa ou deixe o campo vazio. Nada foi gravado.",
    );

    // Unidade usada como unidade de produção padrão (FK RESTRICT): 409 com o vínculo.
    responder(409, {
      code: "UNIDADE_MEDIDA_DELETE_BLOCKED",
      message: "texto do servidor",
      request_id: "req-8",
      details: { vinculo: "tipo_atividade" },
    });
    const bloqueio = await nativeRequest("/unidades-medida/u-ha", { method: "DELETE" }, { operation: "deleteUnidade", resource: "UnidadeMedida" }).catch(
      (e) => e,
    );
    expect(bloqueio.code).toBe(API_ERROR_CODES.UNIDADE_MEDIDA_DELETE_BLOCKED);
    expect(bloqueio.details).toMatchObject({ vinculo: "tipo_atividade", requestId: "req-8" });
    expect(getApiErrorMessage(bloqueio, "fallback")).toBe("Não é possível excluir a unidade de medida: existem registros vinculados.");
  });
});
