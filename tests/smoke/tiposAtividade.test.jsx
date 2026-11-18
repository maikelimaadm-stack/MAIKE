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

describe("TA-FORM — formulário de tipo de atividade", () => {
  it("TA-FORM-1 — três seções, nesta ordem (Identificação, Apropriação, Como funciona), com os campos de cada uma", async () => {
    const { form } = await montar();
    const titulos = ["Identificação", "Apropriação", "Como funciona"];
    expect([...form.querySelectorAll(".b1-grupo__titulo")].map((h) => h.textContent.trim())).toEqual(titulos);
    const secoes = ["identificacao", "apropriacao", "como-funciona"].map((s) =>
      within(form).getByTestId(`tipo-atividade-secao-${s}`),
    );
    // Na ordem do DOM, cada seção logo depois do seu título.
    secoes.reduce((anterior, secao) => {
      expect(anterior.compareDocumentPosition(secao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return secao;
    });
    expect(secoes.map((s) => s.previousElementSibling.textContent.trim())).toEqual(titulos);
    expect(rotulos(secoes[0])).toEqual(ROTULOS_IDENTIFICACAO);
    expect(rotulos(secoes[1])).toEqual(ROTULOS_APROPRIACAO);
    expect(rotulos(secoes[2])).toEqual(ROTULOS_COMO_FUNCIONA);
    expect(rotulos(form)).toEqual(ROTULOS_DO_FORMULARIO);
    expect(form.textContent).not.toMatch(/Pode ter/i);
    expect(screen.getByText("Novo Tipo de Atividade")).toBeTruthy();
  });

  it("TA-FORM-2 — o seletor oferece só os grupos ativos", async () => {
    const { form } = await montar();
    const opcoes = (await abrirGrupo(form)).map((o) => o.textContent.trim());
    // "SELECIONE" é o marcador de vazio, como no tipo de tarefa.
    expect(opcoes).toEqual(["SELECIONE", "PASTAGEM", "AGUADAS"]);
    expect(screen.queryByRole("option", { name: /CERCAS/ })).toBeNull();
  });

  it("TA-FORM-2b — editar tipo de grupo já inativado mantém esse grupo selecionável (INATIVO), sem oferecer outros inativos", async () => {
    const grupos = [...GRUPOS, { id: "g4", nome_grupo: "Antigo", ativo: false }];
    const { form } = await montar({
      grupos,
      isEditing: true,
      initialData: { id: "t1", grupo_atividade_id: "g2", grupo_atividade_nome: "CERCAS", nome_tipo: "REPARO", ativo: true },
    });
    const opcoes = (await abrirGrupo(form)).map((o) => o.textContent.trim());
    expect(opcoes).toEqual(["SELECIONE", "PASTAGEM", "CERCAS (INATIVO)", "AGUADAS"]);
  });

  it("TA-FORM-3 — grupo e nome são obrigatórios", async () => {
    const { form, onSubmit } = await montar();
    enviar();
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(notify.notifyWarning).toHaveBeenCalledTimes(1);
  });

  it("TA-FORM-4 — o envio do novo leva os campos do contrato: nome e descrição em maiúsculas, padrões nulos e as 8 flags false", async () => {
    const { form, onSubmit } = await montar();
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
    expect(payload).toEqual({
      grupo_atividade_id: "g1",
      nome_tipo: "ROÇADA MANUAL",
      descricao: "BEIRA DE CERCA",
      ativo: true,
      categoria: null,
      centro_custo_padrao_id: null,
      centro_resultado_padrao_id: null,
      unidade_producao_id: null,
      coeficiente_padrao: null,
      ...SEM_FLAGS,
    });
    expect(Object.keys(payload).filter((k) => k.startsWith("pode_ter_"))).toEqual([]);
  });

  it("TA-FORM-5 — editar carrega os padrões e as flags gravados e os envia de volta; dados extras do registro não vão", async () => {
    const { form, onSubmit } = await montar({
      isEditing: true,
      initialData: { ...SALVO, pode_ter_produto: true, created_date: "2027-01-01T00:00:00.000Z" },
    });
    expect(valorDe(form, "Categoria")).toBe("Aplicação");
    expect(valorDe(form, "Centro de custo padrão")).toBe("1 — Pecuária de corte");
    expect(valorDe(form, "Centro de resultado padrão")).toBe("7 — Recria 2026");
    expect(valorDe(form, "Unidade de produção")).toBe("HA - Hectare");
    expect(within(form).getByTestId("tipo-atividade-coeficiente")).toHaveValue("1,5");
    for (const f of FLAGS) expect(flag(f).checked, f).toBe(SALVO[f]);
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      grupo_atividade_id: "g1",
      nome_tipo: "APLICAÇÃO DE HERBICIDA",
      descricao: "",
      ativo: true,
      categoria: "APLICACAO",
      centro_custo_padrao_id: "cc1",
      centro_resultado_padrao_id: "cr1",
      unidade_producao_id: "u-ha",
      coeficiente_padrao: "1.5",
      exige_area: true,
      exige_safra: false,
      exige_maquina: true,
      permite_implemento: true,
      permite_produto: true,
      permite_servico: false,
      permite_mao_obra: false,
      exige_producao: false,
    });
  });

  it("TA-FORM-6 — em leitura, grupo já inativado aparece pelo nome em cache", async () => {
    const { form } = await montar({
      readOnly: true,
      grupos: [],
      initialData: { id: "ta1", nome_tipo: "X", grupo_atividade_id: "g2", grupo_atividade_nome: "Cercas" },
    });
    expect(within(form).getByDisplayValue("CERCAS")).toBeTruthy();
  });

  it("TA-FORM-7 — Categoria oferece as 9 com o rótulo legível, envia o código e pode ser limpa (null)", async () => {
    const { form, onSubmit } = await montar({ isEditing: true, initialData: { ...SALVO, categoria: null } });
    expect(await opcoesDe(form, "Categoria")).toEqual([
      "Preparo de solo",
      "Plantio",
      "Trato cultural",
      "Aplicação",
      "Colheita",
      "Pastagem",
      "Benfeitoria",
      "Manejo animal",
      "Outros",
    ]);
    await escolher(form, "Categoria", "Trato cultural");
    enviar();
    expect(onSubmit.mock.calls.at(-1)[0].categoria).toBe("TRATO_CULTURAL");
    await limpar(form, "Categoria");
    enviar();
    expect(onSubmit.mock.calls.at(-1)[0].categoria).toBeNull();
  });

  it("TA-FORM-8 — as 8 flags são caixas de marcar, na ordem do contrato, nascem desmarcadas e vão como booleanos", async () => {
    const { form, onSubmit } = await montar();
    const secao = within(form).getByTestId("tipo-atividade-secao-como-funciona");
    const ids = [...secao.querySelectorAll('[data-testid^="tipo-atividade-flag-"]')].map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(FLAGS.map((f) => `tipo-atividade-flag-${f}`));
    // Cada caixa tem o rótulo fixo como nome acessível (o rótulo do campo aponta para ela).
    FLAGS.forEach((f, i) => {
      expect(flag(f)).toHaveAttribute("type", "checkbox");
      expect(within(secao).getByRole("checkbox", { name: ROTULOS_FLAGS[i] })).toBe(flag(f));
    });
    for (const f of FLAGS) expect(flag(f)).not.toBeChecked();
    await preencherObrigatorios(form);
    fireEvent.click(flag("exige_maquina"));
    // Clicar no rótulo também marca.
    fireEvent.click(within(secao).getByText("Permite produto"));
    expect(flag("exige_maquina")).toBeChecked();
    expect(flag("permite_produto")).toBeChecked();
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    for (const f of FLAGS) expect(typeof payload[f]).toBe("boolean");
    expect(Object.fromEntries(FLAGS.map((f) => [f, payload[f]]))).toEqual({
      ...SEM_FLAGS,
      exige_maquina: true,
      permite_produto: true,
    });
  });

  it("TA-FORM-9 — Coeficiente padrão: '1,5' vai como '1.5'; inválido ou zero bloqueia o envio com a mensagem do campo", async () => {
    const { form, onSubmit } = await montar({ isEditing: true, initialData: { ...SALVO, coeficiente_padrao: null } });
    const campo = within(form).getByTestId("tipo-atividade-coeficiente");
    const recusas = [
      ["abc", "Coeficiente inválido: use o formato 1,5."],
      ["-1", "Coeficiente inválido: use o formato 1,5."],
      ["0", "Informe um coeficiente maior que zero."],
      ["0,0000", "Informe um coeficiente maior que zero."],
      ["1,23456", "Use no máximo 4 casas decimais."],
      ["12345678901", "Coeficiente acima do limite permitido."],
    ];
    for (const [digitado, mensagem] of recusas) {
      fireEvent.change(campo, { target: { value: digitado } });
      enviar();
      expect(await within(form).findByText(mensagem)).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    }
    expect(notify.notifyWarning).toHaveBeenLastCalledWith("Atenção", "Revise os campos destacados.");
    // Corrigir o campo tira o erro; o formato local vira a string canônica da API.
    fireEvent.change(campo, { target: { value: "1,5" } });
    expect(within(form).queryByText("Coeficiente acima do limite permitido.")).toBeNull();
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].coeficiente_padrao).toBe("1.5");
    fireEvent.change(campo, { target: { value: "1.234,5" } });
    enviar();
    expect(onSubmit.mock.calls.at(-1)[0].coeficiente_padrao).toBe("1234.5");
    fireEvent.change(campo, { target: { value: "" } });
    enviar();
    expect(onSubmit.mock.calls.at(-1)[0].coeficiente_padrao).toBeNull();
  });

  it("TA-FORM-10 — os centros padrão são os ATIVOS da fazenda selecionada (pedidos com o empresa_id); o escolhido vai pelo id", async () => {
    const { form, onSubmit } = await montar({ isEditing: true, initialData: { ...SALVO, centro_custo_padrao_id: null, centro_custo_padrao: null, centro_resultado_padrao_id: null, centro_resultado_padrao: null } });
    expect(servico.listarCentrosDaFazenda).toHaveBeenCalledWith("centros-custo", "emp-1");
    expect(servico.listarCentrosDaFazenda).toHaveBeenCalledWith("centros-resultado", "emp-1");
    expect(screen.queryByTestId("tipo-atividade-sem-fazenda")).toBeNull();
    expect(await opcoesDe(form, "Centro de custo padrão")).toEqual(["1 — Pecuária de corte", "2 — Lavoura"]);
    expect(await opcoesDe(form, "Centro de resultado padrão")).toEqual(["7 — Recria 2026"]);
    await escolher(form, "Centro de custo padrão", "2 — Lavoura");
    await escolher(form, "Centro de resultado padrão", "7 — Recria 2026");
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ centro_custo_padrao_id: "cc2", centro_resultado_padrao_id: "cr1" });
  });

  it("TA-FORM-11 — sem fazenda selecionada: o aviso, os centros só leitura (o gravado continua visível) e nenhuma lista de centros pedida", async () => {
    const { form, onSubmit } = await montar({ isEditing: true, initialData: SALVO, empresaId: null });
    expect(within(form).getByTestId("tipo-atividade-sem-fazenda")).toHaveTextContent(/Selecione uma fazenda/);
    for (const campo of ROTULOS_APROPRIACAO) {
      expect(combobox(form, campo)).toBeDisabled();
      expect(within(combobox(form, campo).closest(".mg-field")).queryByRole("button", { name: "Limpar" })).toBeNull();
    }
    expect(valorDe(form, "Centro de custo padrão")).toBe("1 — Pecuária de corte");
    expect(servico.listarCentrosDaFazenda).not.toHaveBeenCalled();
    // O resto do formulário segue editável.
    expect(combobox(form, "Categoria")).not.toBeDisabled();
    expect(combobox(form, "Unidade de produção")).not.toBeDisabled();
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ centro_custo_padrao_id: "cc1", centro_resultado_padrao_id: "cr1" });
  });

  it("TA-FORM-12 — padrão gravado de outra fazenda ou inativo aparece marcado, continua na lista e pode ser limpo (vai null)", async () => {
    const { form, onSubmit } = await montar({
      isEditing: true,
      initialData: {
        ...SALVO,
        centro_custo_padrao_id: "cc9",
        centro_custo_padrao: { id: "cc9", numero: "9", nome: "Cria", empresa_id: "emp-2", ativo: true },
        centro_resultado_padrao_id: "cr4",
        centro_resultado_padrao: { id: "cr4", numero: "4", nome: "Engorda 2025", empresa_id: "emp-1", ativo: false },
      },
    });
    expect(valorDe(form, "Centro de custo padrão")).toBe("9 — Cria (OUTRA FAZENDA)");
    expect(valorDe(form, "Centro de resultado padrão")).toBe("4 — Engorda 2025 (INATIVO)");
    expect(await opcoesDe(form, "Centro de custo padrão")).toEqual([
      "9 — Cria (OUTRA FAZENDA)",
      "1 — Pecuária de corte",
      "2 — Lavoura",
    ]);
    await limpar(form, "Centro de custo padrão");
    await limpar(form, "Centro de resultado padrão");
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ centro_custo_padrao_id: null, centro_resultado_padrao_id: null });
  });

  it("TA-FORM-13 — Unidade de produção: as unidades ativas e a gravada (marcada INATIVA); a escolhida vai pelo id", async () => {
    const { form, onSubmit } = await montar({
      isEditing: true,
      initialData: {
        ...SALVO,
        unidade_producao_id: "u-alq",
        unidade_producao: { id: "u-alq", sigla: "ALQ", descricao: "Alqueire", ativo: false },
      },
    });
    expect(servico.listarUnidadesDeMedida).toHaveBeenCalled();
    expect(valorDe(form, "Unidade de produção")).toBe("ALQ - Alqueire (INATIVA)");
    expect(await opcoesDe(form, "Unidade de produção")).toEqual(["ALQ - Alqueire (INATIVA)", "HA - Hectare", "H - Hora"]);
    await escolher(form, "Unidade de produção", "H - Hora");
    enviar();
    expect(onSubmit.mock.calls[0][0].unidade_producao_id).toBe("u-h");
  });

  it("TA-FORM-14 — em leitura, mostra os padrões (marcados) e as flags gravados sem pedir as listas", async () => {
    const { form } = await montar({
      readOnly: true,
      initialData: {
        ...SALVO,
        centro_resultado_padrao_id: "cr4",
        centro_resultado_padrao: { id: "cr4", numero: "4", nome: "Engorda", empresa_id: "emp-2", ativo: false },
      },
    });
    expect(valorDe(form, "Categoria")).toBe("Aplicação");
    expect(valorDe(form, "Centro de custo padrão")).toBe("1 — Pecuária de corte");
    expect(valorDe(form, "Centro de resultado padrão")).toBe("4 — Engorda (INATIVO, OUTRA FAZENDA)");
    expect(valorDe(form, "Unidade de produção")).toBe("HA - Hectare");
    expect(within(form).getByTestId("tipo-atividade-coeficiente")).toHaveValue("1,5");
    expect(flag("exige_maquina")).toBeChecked();
    expect(flag("exige_safra")).not.toBeChecked();
    for (const f of FLAGS) expect(flag(f)).toBeDisabled();
    expect(servico.listarCentrosDaFazenda).not.toHaveBeenCalled();
    expect(servico.listarUnidadesDeMedida).not.toHaveBeenCalled();
    expect(screen.queryByTestId("tipo-atividade-sem-fazenda")).toBeNull();
  });

  it("TA-FORM-15 — trocar a fazenda com o formulário aberto pede os centros da nova e devolve a escolha ao gravado", async () => {
    const { form, onSubmit, remontar } = await montar({ isEditing: true, initialData: SALVO });
    await escolher(form, "Centro de custo padrão", "2 — Lavoura");
    await remontar({ empresaId: "emp-2" });
    expect(servico.listarCentrosDaFazenda).toHaveBeenCalledWith("centros-custo", "emp-2");
    // O gravado (da emp-1) continua visível, agora marcado como de outra fazenda.
    expect(valorDe(form, "Centro de custo padrão")).toBe("1 — Pecuária de corte (OUTRA FAZENDA)");
    expect(await opcoesDe(form, "Centro de custo padrão")).toEqual(["1 — Pecuária de corte (OUTRA FAZENDA)", "8 — Cria"]);
    enviar();
    expect(onSubmit.mock.calls.at(-1)[0].centro_custo_padrao_id).toBe("cc1");
  });
});

describe("TA-PAGE — tela de tipos de atividade", () => {
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

  it("TA-PAGE-1 — lista os tipos e abre o formulário de três seções no Novo, com os centros da fazenda selecionada", async () => {
    servico.listarGruposSimples.mockResolvedValue(GRUPOS);
    servico.listarTiposAtividade.mockResolvedValue([
      { id: "ta1", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true },
    ]);
    await montarTela();
    await waitFor(() => expect(screen.getByText("ROÇADA")).toBeTruthy());
    const form = await abrirNovo();
    expect(rotulos(form)).toEqual(ROTULOS_DO_FORMULARIO);
    expect(servico.listarCentrosDaFazenda).toHaveBeenCalledWith("centros-custo", "emp-1");
    expect(servico.listarCentrosDaFazenda).toHaveBeenCalledWith("centros-resultado", "emp-1");
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(within(form).getAllByText("Obrigatório")).toHaveLength(2));
    expect(servico.criarTipoAtividade).not.toHaveBeenCalled();
  });

  it("TA-GRADE-1 — a chave das preferências mudou (_v2) e Categoria entra visível por padrão, depois do tipo", async () => {
    const { TIPOS_ATIVIDADE_STORAGE_KEY, TIPOS_ATIVIDADE_COLUNAS, getTipoAtividadeFieldValue } = await import(
      "@/components/tipos-atividade/TabelaTiposAtividade"
    );
    expect(TIPOS_ATIVIDADE_STORAGE_KEY).toBe("colunas_largura_tipos_atividade_v3");
    expect(TIPOS_ATIVIDADE_COLUNAS.filter((c) => c.default).map((c) => c.id)).toEqual([
      "grupo_atividade_nome",
      "nome_tipo",
      "categoria",
      "pode_registrar",
      "descricao",
      "ativo",
      "updated_date",
    ]);
    expect(TIPOS_ATIVIDADE_COLUNAS.find((c) => c.id === "categoria")?.label).toBe("Categoria");
    expect(getTipoAtividadeFieldValue({ categoria: "MANEJO_ANIMAL" }, "categoria")).toBe("Manejo animal");
    expect(getTipoAtividadeFieldValue({ categoria: null }, "categoria")).toBe("");
  });

  it("TA-PAGE-2 — a tabela mostra a coluna Categoria com o rótulo legível, mesmo com preferência de colunas salva na chave antiga", async () => {
    // Formato real gravado pela grade (persistCadastroBase1ColumnPrefs) na tela da D-PROD-182, sem Categoria.
    localStorage.setItem(
      "colunas_largura_tipos_atividade_prefs",
      JSON.stringify({
        version: 1,
        columns: {
          widths: { grupo_atividade_nome: 220, nome_tipo: 240, descricao: 260, ativo: 100 },
          order: ["grupo_atividade_nome", "nome_tipo", "descricao", "ativo", "created_date", "updated_date"],
          visible: ["grupo_atividade_nome", "nome_tipo", "descricao", "ativo"],
          frozen: 0,
          autoFit: [],
        },
      }),
    );
    servico.listarGruposSimples.mockResolvedValue(GRUPOS);
    servico.listarTiposAtividade.mockResolvedValue([
      { id: "ta1", nome_tipo: "PULVERIZAÇÃO", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: "APLICACAO" },
      { id: "ta2", nome_tipo: "CAPINA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: "TRATO_CULTURAL" },
      { id: "ta3", nome_tipo: "VISTORIA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true, categoria: null },
    ]);
    await montarTela();
    await waitFor(() => expect(screen.getByText("PULVERIZAÇÃO")).toBeTruthy());
    expect(screen.getByRole("columnheader", { name: /Categoria/ })).toBeTruthy();
    expect(screen.getByText("Aplicação")).toBeTruthy();
    expect(screen.getByText("Trato cultural")).toBeTruthy();
    expect(screen.queryByText("APLICACAO")).toBeNull();
  });

  it("TA-PAGE-3 — salvar o Novo leva padrões e flags ao service; a recusa de padrão mostra o texto do motivo", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    servico.listarGruposSimples.mockResolvedValue(GRUPOS);
    servico.listarTiposAtividade.mockResolvedValue([]);
    // Como o cliente nativo entrega o 422: o código preservado, campo e motivo em `details`.
    servico.criarTipoAtividade.mockRejectedValue(
      new ApiError(API_ERROR_CODES.TIPO_ATIVIDADE_PADRAO_INVALIDO, {
        details: { field: "centro_custo_padrao_id", reason: "inativo", requestId: "req-9" },
      }),
    );
    await montarTela();
    const form = await abrirNovo();
    await preencherObrigatorios(form);
    await escolher(form, "Categoria", "Plantio");
    await escolher(form, "Centro de custo padrão", "1 — Pecuária de corte");
    await escolher(form, "Unidade de produção", "HA - Hectare");
    fireEvent.change(within(form).getByTestId("tipo-atividade-coeficiente"), { target: { value: "2,25" } });
    fireEvent.click(flag("exige_area"));
    fireEvent.click(flag("exige_producao"));
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.criarTipoAtividade).toHaveBeenCalledTimes(1));
    expect(servico.criarTipoAtividade.mock.calls[0][0]).toEqual({
      grupo_atividade_id: "g1",
      nome_tipo: "PLANTIO DIRETO",
      descricao: "",
      ativo: true,
      categoria: "PLANTIO",
      centro_custo_padrao_id: "cc1",
      centro_resultado_padrao_id: null,
      unidade_producao_id: "u-ha",
      coeficiente_padrao: "2.25",
      ...SEM_FLAGS,
      exige_area: true,
      exige_producao: true,
    });
    await waitFor(() =>
      expect(notify.notifyWarning).toHaveBeenCalledWith(
        "Atenção",
        "O centro de custo padrão está inativo. Escolha um centro ativo ou deixe o campo vazio. Nada foi gravado.",
      ),
    );
  });

  it("TA-PAGE-4 — cancelar a edição descarta o rascunho: a leitura volta ao gravado e o próximo Salvar não leva o que foi desfeito (revisão F1-1)", async () => {
    servico.listarGruposSimples.mockResolvedValue(GRUPOS);
    servico.listarTiposAtividade.mockResolvedValue([{ ...SALVO }]);
    servico.atualizarTipoAtividade.mockImplementation(async ({ id, dados }) => ({ ...SALVO, ...dados, id }));
    await montarTela();
    await waitFor(() => expect(screen.getByText("APLICAÇÃO DE HERBICIDA")).toBeTruthy());
    fireEvent.doubleClick(screen.getByText("APLICAÇÃO DE HERBICIDA").closest('[data-testid="b1-row"]'));
    await screen.findByTestId("b1-form-tipo-atividade");
    await assentar();
    expect(flag("exige_maquina").checked).toBe(true);

    // Edita (limpa o centro de custo padrão e desmarca "Exige máquina") e CANCELA.
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/ }));
    await assentar();
    const campoCentro = () => within(screen.getByTestId("b1-form-tipo-atividade")).getByRole("combobox", { name: "Centro de custo padrão" });
    fireEvent.click(within(campoCentro().closest(".mg-field")).getByRole("button", { name: "Limpar" }));
    await waitFor(() => expect(campoCentro().hasAttribute("data-placeholder")).toBe(true));
    fireEvent.click(flag("exige_maquina"));
    expect(flag("exige_maquina").checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await assentar();

    // A leitura volta ao gravado.
    expect(campoCentro().hasAttribute("data-placeholder")).toBe(false);
    expect(flag("exige_maquina").checked).toBe(true);

    // Editar de novo e mudar só a descrição: o PATCH leva o gravado, não o rascunho descartado.
    fireEvent.click(screen.getByRole("button", { name: /^Editar$/ }));
    await assentar();
    fireEvent.change(within(screen.getByTestId("b1-form-tipo-atividade")).getByLabelText(/Descrição/), { target: { value: "só a descrição" } });
    fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.atualizarTipoAtividade).toHaveBeenCalledTimes(1));
    const { dados } = servico.atualizarTipoAtividade.mock.calls[0][0];
    expect(dados.centro_custo_padrao_id).toBe("cc1");
    expect(dados.exige_maquina).toBe(true);
  });
});

describe("TA-PORTA — porta, API e service do tipo (D-PROD-197)", () => {
  it("TA-PORTA-1 — o corpo leva só as chaves do contrato: flags só booleanas, coeficiente só texto (vazio = null)", async () => {
    const { operacoesNativas, CAMPOS_DE_CRIACAO, FLAGS_TIPO_ATIVIDADE } = await import("@/apis/atividades/tipoAtividadePort.js");
    const { FLAGS_DO_FORMULARIO } = await import("@/components/tipos-atividade/FormularioTipoAtividade");
    // A tela e a porta falam das mesmas 8 flags, na mesma ordem.
    expect(FLAGS_TIPO_ATIVIDADE).toEqual(FLAGS);
    expect(FLAGS_DO_FORMULARIO.map((f) => f.campo)).toEqual(FLAGS);
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
