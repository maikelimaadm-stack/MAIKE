/**
 * Apontamentos de Atividade (D-PROD-190, Fatia C) — a EXECUÇÃO de um Tipo de
 * Atividade. A TAREFA é a demanda; a ATIVIDADE é a operação feita.
 *
 * Cobre:
 *  - a ordem EXATA dos campos (tipo + grupo, data, máquina → implemento,
 *    operador, área, hora início/fim, produção, observação) e, depois, os
 *    centros;
 *  - tipos só ativos (o tipo gravado e inativo aparece "(INATIVO)") e o grupo
 *    só leitura, vindo do tipo;
 *  - implemento só com máquina, nunca igual a ela; trocar a máquina o limpa;
 *  - quantidade e unidade da produção andam juntas;
 *  - centros (regra acordada com o proprietário): no apontamento NOVO o
 *    centro de custo vem preenchido com o centro (ativo) do bem escolhido, o
 *    usuário troca antes de salvar e a escolha manual dele não é sobrescrita
 *    por troca de máquina; na EDIÇÃO ele é snapshot e nunca é relido do bem; o
 *    centro de resultado é sempre escolha do usuário, nunca vem do bem;
 *  - apontamento CANCELADO abre só leitura (nem editar nem cancelar de novo);
 *  - o corpo enviado sai pela allowlist (porta nativa) e a hora vai com o fuso
 *    da fazenda;
 *  - tela: rota, menu logo abaixo de Tipos de Atividade, ícone, manifesto e a
 *    paridade módulo × tela com o servidor;
 *  - D-PROD-193 (Fatia D, itens): a seção Itens nos 4 estados (novo, edição,
 *    consulta do confirmado, cancelado); nenhum botão de item sem as ações
 *    editar/cancelar; corpo do item só com as chaves da allowlist do TIPO; o
 *    mesmo `operation_id` na retentativa (e no cancelamento do apontamento,
 *    D-2); regras puras (`validarItem`, `corpoDoItem`, `totalDoItem` com
 *    '1' × '1.00005' = '1.0001' e '1' × '2.00025' = '2.0003', sem float);
 *    mensagens dos códigos novos (saldo em L e em kg); detalhe gravado no cache
 *    sem nova leitura depois de lançar e cancelar, e relido no REPLAY e depois
 *    de recusa; local único escolhido sozinho; data travada com item de
 *    Produto e enquanto os itens não chegam (D-1), editável sem Produto
 *    confirmado; D-3 na tela (editar × cancelar); mesmo `operation_id` na
 *    retentativa com o service REAL (só o HTTP falso); "Cancelar apontamento"
 *    só com os itens conhecidos e a devolução ao estoque decidida pela
 *    resposta; sem fuso, nada de cancelar; card sem texto cortado; aviso
 *    "incerto" sem estoque no Serviço e no Outro custo.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import * as lucide from "lucide-react";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifyWarning: notify.notifyWarning,
  notifySuccess: notify.notifySuccess,
  notifyInfo: notify.notifyInfo,
}));

const servico = vi.hoisted(() => ({
  listarOpcoesApontamento: vi.fn(),
  listarApontamentosPagina: vi.fn(),
  detalharApontamento: vi.fn(),
  criarApontamento: vi.fn(),
  atualizarApontamento: vi.fn(),
  cancelarApontamento: vi.fn(),
  listarAreasDoApontamento: vi.fn(),
  listarTiposAtividade: vi.fn(),
  // D-PROD-193 — itens.
  listarLocaisDoProduto: vi.fn(),
  adicionarItemApontamento: vi.fn(),
  cancelarItemApontamento: vi.fn(),
  limparPendenciaDoApontamento: vi.fn(),
  ACAO_CANCELAR: "cancelar",
  alvoDoItem: (id) => `item:${id}`,
}));
vi.mock("@/services/apontamentoAtividadeService", () => servico);
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "cli-1", user: { id: "u1" } }) }));
// O refresh FORÇADO do cache do Mapa (estoque) é conferido depois da devolução ao estoque.
const mapa = vi.hoisted(() => ({ refreshMapaCacheEntry: vi.fn(async () => []) }));
vi.mock("@/services/mapaCacheService", () => mapa);

const sessao = vi.hoisted(() => ({
  acoes: { ver: true, criar: true, editar: true, cancelar: true, carregando: false, login: "gerente" },
  // Empresa selecionada (um teste troca de empresa com um envio em curso).
  empresaId: "emp-1",
}));
vi.mock("@/hooks/useApontamentoAtividadeSessao", () => ({
  useEmpresaRealSelecionadaId: () => sessao.empresaId,
  useAcoesTelaApontamento: () => sessao.acoes,
}));
// Fuso da fazenda (o "hoje" e o estorno): um teste o tira para provar os botões fechados sem ele.
const empresas = vi.hoisted(() => ({ fuso: /** @type {string|null} */ ("America/Cuiaba") }));
vi.mock("@/services/empresaService", () => ({
  listEmpresas: vi.fn(async () => [{ id: "emp-1", nome: "FAZENDA", fuso_horario: empresas.fuso }]),
}));

const http = vi.hoisted(() => ({ nativeRequest: vi.fn(async () => ({})) }));
vi.mock("@/apis/_core/nativeHttpClient.js", () => ({ nativeRequest: http.nativeRequest }));

const { default: FormularioApontamentoAtividade, FORMULARIO_APONTAMENTO_ATIVIDADE_ID } = await import(
  "@/components/apontamentos-atividade/FormularioApontamentoAtividade"
);

const HOJE = "2026-11-13";
const FUSO = "America/Cuiaba";

const TIPOS = [
  { id: "t1", nome_tipo: "ROÇADA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: true },
  { id: "t2", nome_tipo: "PLANTIO", grupo_atividade_id: "g2", grupo_atividade_nome: "LAVOURA", ativo: true },
  { id: "t3", nome_tipo: "GRADAGEM", grupo_atividade_id: "g2", grupo_atividade_nome: "LAVOURA", ativo: false },
  { id: "t4", nome_tipo: "ANTIGA", grupo_atividade_id: "g1", grupo_atividade_nome: "PASTAGEM", ativo: false },
];
const AREAS = [
  { id: "a1", nome: "Piquete 1", numero_area: "01", empresa_id: "emp-1", ativo: true },
  { id: "a2", nome: "Piquete 2", numero_area: "02", empresa_id: "emp-1", ativo: true },
];

/**
 * Opções dos seletores próprios da tela. A opção de bem traz `centro_custo`
 * ({ id, numero, nome }) só quando o bem tem centro de custo ATIVO; senão null
 * (a Moto). Nenhum bem traz centro de resultado.
 */
const CC_TRATOR = { id: "cc1", numero: "1", nome: "Pecuária de corte" };
const CC_CAMINHONETE = { id: "cc2", numero: "2", nome: "Frota leve" };
const opcoesFalsas = async (recurso, _empresaId, opts = {}) => {
  const pagina = (itens) => ({ itens, has_more: false, next_cursor: null });
  if (recurso === "bens" && (opts.natureza ?? []).includes("IMPLEMENTO")) {
    // O servidor não sabe qual é a máquina escolhida: a tela tira a própria máquina da lista.
    return pagina([
      { id: "b1", numero: "1", codigo_frota: "TP-01", nome: "Trator", natureza: "MAQUINA" },
      { id: "i1", numero: "3", codigo_frota: "GR-01", nome: "Grade aradora", natureza: "IMPLEMENTO" },
    ]);
  }
  if (recurso === "bens") {
    return pagina([
      { id: "b1", numero: "1", codigo_frota: "TP-01", nome: "Trator", natureza: "MAQUINA", centro_custo: CC_TRATOR },
      { id: "b2", numero: "2", codigo_frota: "CM-02", nome: "Caminhonete", natureza: "VEICULO", centro_custo: CC_CAMINHONETE },
      { id: "b4", numero: "4", codigo_frota: "MT-04", nome: "Moto", natureza: "VEICULO", centro_custo: null },
    ]);
  }
  if (recurso === "operadores") return pagina([{ id: "u1", nome: "João Vaqueiro" }]);
  if (recurso === "produtos") {
    return pagina([
      { id: "p1", numero: "1", nome: "Herbicida X", unidade_principal_estoque: "L", estoque_atual: "100.0000" },
      { id: "p2", numero: "2", nome: "Adubo NPK", unidade_principal_estoque: "SACO", peso_por_saco_kg: "50.0000", estoque_atual: "500.0000" },
      { id: "p3", numero: "3", nome: "Brinco", unidade_principal_estoque: "UN", estoque_atual: "10.0000" },
    ]);
  }
  if (recurso === "centros-custo") return pagina([CC_TRATOR, CC_CAMINHONETE, { id: "cc3", numero: "3", nome: "Administração" }]);
  if (recurso === "centros-resultado") return pagina([{ id: "cr1", numero: "7", nome: "Recria 2026" }]);
  return pagina([]);
};

const REGISTRO = {
  id: "ap1",
  empresa_id: "emp-1",
  numero: "15",
  status: "CONFIRMADO",
  versao: 2,
  data_operacional: "2026-11-10",
  hora_inicio: "2026-11-10T11:30:00.000Z",
  hora_fim: "2026-11-10T15:15:00.000Z",
  tipo_atividade_id: "t3",
  tipo_atividade_nome: "GRADAGEM",
  grupo_atividade_id: "g2",
  grupo_atividade_nome: "LAVOURA",
  bem_id: "b1",
  bem: { id: "b1", numero: "1", codigo_frota: "TP-01", nome: "Trator", natureza: "MAQUINA" },
  implemento_bem_id: "i1",
  implemento: { id: "i1", numero: "3", codigo_frota: "GR-01", nome: "Grade aradora", natureza: "IMPLEMENTO" },
  operador_usuario_id: "u1",
  operador: { id: "u1", nome: "João Vaqueiro" },
  area_id: "a1",
  area: { id: "a1", numero_area: "01", nome: "Piquete 1" },
  centro_custo_id: "cc1",
  centro_custo: { id: "cc1", numero: "1", nome: "Pecuária de corte" },
  centro_resultado_id: null,
  centro_resultado: null,
  quantidade_produzida: "12.5000",
  unidade_producao: "HA",
  observacao: "Talhão norte",
  cancelamento: null,
};
const CANCELADO = {
  ...REGISTRO,
  id: "ap2",
  numero: "16",
  status: "CANCELADO",
  versao: 3,
  cancelamento: { cancelado_em: "2026-11-11T12:00:00.000Z", cancelado_por: { id: "u9", nome: "Gerente" }, motivo: "Lançado em duplicidade" },
};

// ─── Itens (D-PROD-193) ──────────────────────────────────────────────────
const ITEM_PRODUTO_GRAVADO = {
  id: "it1",
  ordem: 1,
  tipo: "PRODUTO",
  status: "CONFIRMADO",
  descricao: null,
  produto: { id: "p1", nome: "Herbicida X", unidade_principal_estoque: "L" },
  local_estoque: { id: "l1", nome: "Depósito central" },
  quantidade: "12.5000",
  unidade: "L",
  valor_unitario: "5.312500",
  valor_total: "66.4063",
  movimento: { id: "m1", numero: "101" },
  movimento_estorno: null,
  consumos: [
    { ordem: 1, lote_id: "lo1", quantidade: "10.0000", custo_unitario: "5.0000" },
    { ordem: 2, lote_id: "lo2", quantidade: "2.5000", custo_unitario: "6.5625" },
  ],
  criado_por: { id: "u1", nome: "Gerente" },
  criado_em: "2026-11-12T12:00:00.000Z",
  cancelamento: null,
};
const ITEM_SERVICO_CANCELADO = {
  id: "it2",
  ordem: 2,
  tipo: "SERVICO",
  status: "CANCELADO",
  descricao: "Frete do herbicida",
  produto: null,
  local_estoque: null,
  quantidade: "1.0000",
  unidade: null,
  valor_unitario: "150.000000",
  valor_total: "150.0000",
  movimento: null,
  movimento_estorno: null,
  consumos: [],
  criado_por: { id: "u1", nome: "Gerente" },
  criado_em: "2026-11-12T12:05:00.000Z",
  cancelamento: { cancelado_em: "2026-11-12T13:00:00.000Z", cancelado_por: { id: "u1", nome: "Gerente" }, motivo: "Lançado errado", origem: "ITEM" },
};
const CUSTO_ITENS = { total: "66.4063", produto: "66.4063", servico: "0.0000", outro: "0.0000", itens_confirmados: 1 };
const REGISTRO_COM_ITENS = { ...REGISTRO, itens: [ITEM_PRODUTO_GRAVADO, ITEM_SERVICO_CANCELADO], custo_itens: CUSTO_ITENS };
const CANCELADO_COM_ITENS = {
  ...CANCELADO,
  itens: [{ ...ITEM_PRODUTO_GRAVADO, id: "it9", status: "CANCELADO", movimento_estorno: { id: "m9", numero: "109" }, cancelamento: { ...ITEM_SERVICO_CANCELADO.cancelamento, origem: "APONTAMENTO" } }],
  custo_itens: { total: "0.0000", produto: "0.0000", servico: "0.0000", outro: "0.0000", itens_confirmados: 0 },
};
const CUSTO_ZERO = { total: "0.0000", produto: "0.0000", servico: "0.0000", outro: "0.0000", itens_confirmados: 0 };
/** O ap1 como o servidor devolve depois de cancelado: o item de Produto foi cancelado JUNTO (origem APONTAMENTO) e voltou ao estoque. */
const AP1_CANCELADO = { ...CANCELADO_COM_ITENS, id: "ap1", numero: "15", versao: 3 };
/** O ap1 lido com itens conhecidos e nenhum item lançado. */
const AP1_SEM_ITENS = { ...REGISTRO, itens: [], custo_itens: CUSTO_ZERO };
/** Locais com saldo (A7): o Herbicida (L) em dois locais; o Adubo (SACO, estoque em kg) em um só. */
const locaisFalsos = async (_empresaId, produtoId) =>
  produtoId === "p1"
    ? {
        itens: [
          { local_estoque_id: "l1", local_nome: "Depósito central", disponivel: "80.0000", unidade: "L", unidade_principal_estoque: "L" },
          { local_estoque_id: "l2", local_nome: "Galpão 2", disponivel: "5.0000", unidade: "L", unidade_principal_estoque: "L" },
        ],
        has_more: false,
        next_cursor: null,
      }
    : { itens: [{ local_estoque_id: "l3", local_nome: "Armazém", disponivel: "250.0000", unidade: "KG", unidade_principal_estoque: "SACO" }], has_more: false, next_cursor: null };

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const montar = (props = {}) => {
  const onSubmit = vi.fn();
  const onCancelar = vi.fn();
  render(
    <QueryClientProvider client={novoCliente()}>
      <FormularioApontamentoAtividade
        empresaId="emp-1"
        tipos={TIPOS}
        areas={AREAS}
        hoje={HOJE}
        fuso={FUSO}
        onSubmit={onSubmit}
        onCancelar={onCancelar}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSubmit, onCancelar, form: screen.getByTestId("b1-form-apontamento-atividade") };
};

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_APONTAMENTO_ATIVIDADE_ID));

/** Rótulos dos campos, na ordem do DOM. */
const rotulos = (form) => [...form.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());

const escolherTipo = async (form, nome) => {
  await act(async () => fireEvent.click(within(form).getByRole("combobox", { name: /Tipo de atividade/ })));
  await act(async () => fireEvent.click(await screen.findByRole("option", { name: nome })));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};

const opcoesDoTipo = async (form) => {
  await act(async () => fireEvent.click(within(form).getByRole("combobox", { name: /Tipo de atividade/ })));
  const nomes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
  await act(async () => fireEvent.click(within(form).getByRole("combobox", { name: /Tipo de atividade/ })));
  return nomes;
};

const escolherNoSeletor = async (form, testId, nome) => {
  await waitFor(() => expect(within(form).getByTestId(testId)).not.toBeDisabled());
  fireEvent.click(within(form).getByTestId(testId));
  fireEvent.click(await screen.findByRole("option", { name: nome }));
  await waitFor(() => expect(screen.queryByTestId(`${testId}-painel`)).toBeNull());
};

const valorDoSeletor = (form, testId) => within(form).getByTestId(testId).getAttribute("aria-label");

const limparSeletor = async (form, testId) => {
  fireEvent.click(within(within(form).getByTestId(testId).closest(".mg-field")).getByRole("button", { name: "Limpar" }));
  await waitFor(() => expect(within(form).getByTestId(testId).hasAttribute("data-placeholder")).toBe(true));
};

const CENTRO_CUSTO_VAZIO = "Centro de custo";
const CENTRO_RESULTADO_VAZIO = "Centro de resultado";

beforeEach(() => {
  servico.listarOpcoesApontamento.mockImplementation(opcoesFalsas);
  servico.listarLocaisDoProduto.mockImplementation(locaisFalsos);
  empresas.fuso = FUSO;
  sessao.empresaId = "emp-1";
  // A pendência de `operation_id` do service REAL mora no storage do navegador: nenhum teste herda a de outro.
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage: nada guardado */
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ORDEM = [
  "Tipo de atividade",
  "Grupo de atividade",
  "Data",
  "Máquina/veículo",
  "Implemento",
  "Operador",
  "Área",
  "Hora início",
  "Hora fim",
  "Quantidade produzida",
  "Unidade",
  "Observação",
  "Centro de custo",
  "Centro de resultado",
];

describe("AP-FORM — formulário do apontamento de atividade", () => {
  it("AP-FORM-1 — campos na ordem exata: tipo (+grupo), data, máquina → implemento, operador, área, horas, produção, observação; centros por último", () => {
    const { form } = montar();
    expect(rotulos(form)).toEqual(ORDEM);
    // Nada das flags de exigência do antigo Tipo de Tarefa, nem itens de custo.
    expect(form.textContent).not.toMatch(/Exige área|Pode ter|Custo unitário|Itens de custo/i);
  });

  it("AP-FORM-2 — o seletor de tipo oferece só os ativos; o grupo é só leitura e vem do tipo escolhido", async () => {
    const { form } = montar();
    expect(await opcoesDoTipo(form)).toEqual(["SELECIONE", "ROÇADA", "PLANTIO"]);
    const grupo = within(form).getByTestId("apontamento-grupo");
    expect(grupo.readOnly).toBe(true);
    expect(grupo.value).toBe("");
    await escolherTipo(form, "PLANTIO");
    expect(within(form).getByTestId("apontamento-grupo").value).toBe("LAVOURA");
  });

  it("AP-FORM-3 — editar apontamento de tipo já inativado mantém esse tipo (INATIVO), sem oferecer outros inativos", async () => {
    const { form } = montar({ initialData: REGISTRO });
    expect(await opcoesDoTipo(form)).toEqual(["SELECIONE", "ROÇADA", "PLANTIO", "GRADAGEM (INATIVO)"]);
    expect(within(form).getByTestId("apontamento-grupo").value).toBe("LAVOURA");
  });

  it("AP-FORM-4 — implemento só com máquina, nunca a própria máquina; trocar a máquina limpa o implemento", async () => {
    const { form } = montar();
    expect(within(form).getByTestId("apontamento-implemento")).toBeDisabled();
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    await waitFor(() => expect(within(form).getByTestId("apontamento-implemento")).not.toBeDisabled());
    fireEvent.click(within(form).getByTestId("apontamento-implemento"));
    await screen.findByRole("option", { name: /Grade aradora/ });
    // O Trator é a máquina: não aparece como implemento.
    expect(screen.queryByRole("option", { name: /Trator/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Grade aradora/ }));
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-implemento")).toMatch(/Grade aradora/));
    expect(servico.listarOpcoesApontamento).toHaveBeenCalledWith("bens", "emp-1", expect.objectContaining({ natureza: ["IMPLEMENTO"] }));
    await escolherNoSeletor(form, "apontamento-bem", /Caminhonete/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-implemento")).toBe("Implemento"));
  });

  it("AP-FORM-5 — quantidade e unidade da produção andam juntas", async () => {
    const { form, onSubmit } = montar();
    await escolherTipo(form, "ROÇADA");
    fireEvent.change(within(form).getByTestId("apontamento-quantidade"), { target: { value: "12,5" } });
    enviar();
    expect(await within(form).findByText("Escolha a unidade da quantidade produzida.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByTestId("apontamento-quantidade"), { target: { value: "" } });
    await act(async () => fireEvent.click(within(form).getByRole("combobox", { name: "Unidade" })));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: /HECTARE/i })));
    enviar();
    expect(await within(form).findByText("Informe a quantidade produzida da unidade escolhida.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByTestId("apontamento-quantidade"), { target: { value: "12,5" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ quantidade_produzida: "12.5", unidade_producao: "HA" });
  });

  it("AP-FORM-6 — novo: o centro de custo vem preenchido do bem (rótulo dos centros), o usuário troca antes de salvar e o corpo leva o escolhido; o de resultado nunca vem do bem", async () => {
    const { form, onSubmit } = montar();
    for (const testId of ["apontamento-centro-custo", "apontamento-centro-resultado"]) {
      expect(within(form).getByTestId(testId)).not.toBeDisabled();
    }
    await escolherTipo(form, "ROÇADA");
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    // O centro de custo do bem preenche o campo, com o mesmo rótulo do seletor de centros.
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    // O centro de resultado continua vazio: nunca vem do bem.
    expect(valorDoSeletor(form, "apontamento-centro-resultado")).toBe(CENTRO_RESULTADO_VAZIO);
    expect(servico.listarOpcoesApontamento).not.toHaveBeenCalledWith("centros-resultado", expect.anything(), expect.anything());
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: "b1", centro_custo_id: "cc1", centro_resultado_id: null });
    // A origem do centro é só estado da tela: não vai no corpo.
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("centro_custo_origem");
    // Continua um seletor normal: o usuário troca o centro de custo e escolhe o de resultado antes de salvar.
    await escolherNoSeletor(form, "apontamento-centro-custo", /Administração/);
    await escolherNoSeletor(form, "apontamento-centro-resultado", /Recria 2026/);
    expect(servico.listarOpcoesApontamento).toHaveBeenCalledWith("centros-resultado", "emp-1", expect.anything());
    enviar();
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ bem_id: "b1", centro_custo_id: "cc3", centro_resultado_id: "cr1" });
  });

  it("AP-FORM-12 — novo: a escolha manual do centro de custo não é sobrescrita ao trocar nem ao limpar a máquina", async () => {
    let { form, onSubmit } = montar();
    await escolherTipo(form, "ROÇADA");
    // Escolhido à mão DEPOIS do centro vindo do bem: trocar e limpar a máquina não o mexem.
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    await escolherNoSeletor(form, "apontamento-centro-custo", /Administração/);
    await escolherNoSeletor(form, "apontamento-bem", /Caminhonete/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 3 — Administração");
    await escolherNoSeletor(form, "apontamento-bem", /Moto/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 3 — Administração");
    await limparSeletor(form, "apontamento-bem");
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 3 — Administração");
    expect(valorDoSeletor(form, "apontamento-centro-resultado")).toBe(CENTRO_RESULTADO_VAZIO);
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: null, centro_custo_id: "cc3", centro_resultado_id: null });
    cleanup();

    // Escolhido à mão ANTES da máquina: escolher a máquina não o troca.
    ({ form, onSubmit } = montar());
    await escolherTipo(form, "ROÇADA");
    await escolherNoSeletor(form, "apontamento-centro-custo", /Frota leve/);
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 2 — Frota leve");
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: "b1", centro_custo_id: "cc2", centro_resultado_id: null });
  });

  it("AP-FORM-13 — novo: o centro vindo do bem acompanha a troca e a limpeza da máquina; bem sem centro (null) deixa vazio", async () => {
    const { form, onSubmit } = montar();
    await escolherTipo(form, "ROÇADA");
    // Bem sem centro de custo (ou com centro inativo: o servidor manda null) deixa o campo vazio.
    await escolherNoSeletor(form, "apontamento-bem", /Moto/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO);
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: "b4", centro_custo_id: null, centro_resultado_id: null });
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    await escolherNoSeletor(form, "apontamento-bem", /Caminhonete/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 2 — Frota leve"));
    enviar();
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ bem_id: "b2", centro_custo_id: "cc2", centro_resultado_id: null });
    // Troca para um bem sem centro: o centro que veio do bem sai junto.
    await escolherNoSeletor(form, "apontamento-bem", /Moto/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO));
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    // Limpar a máquina limpa o centro que veio dela.
    await limparSeletor(form, "apontamento-bem");
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO);
    expect(valorDoSeletor(form, "apontamento-centro-resultado")).toBe(CENTRO_RESULTADO_VAZIO);
    enviar();
    expect(onSubmit.mock.calls[2][0]).toMatchObject({ bem_id: null, centro_custo_id: null, centro_resultado_id: null });
  });

  it("AP-FORM-15 — novo: limpar o centro de custo com máquina de centro ativo traz de volta o do bem (a tela nunca mostra vazio o que o servidor grava); sem máquina, limpa; na edição, limpa", async () => {
    const clicarLimpar = (form, testId) =>
      fireEvent.click(within(within(form).getByTestId(testId).closest(".mg-field")).getByRole("button", { name: "Limpar" }));
    let { form, onSubmit } = montar();
    await escolherTipo(form, "ROÇADA");
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    clicarLimpar(form, "apontamento-centro-custo");
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: "b1", centro_custo_id: "cc1" });
    // Escolha manual e depois limpar: volta ao do bem escolhido.
    await escolherNoSeletor(form, "apontamento-centro-custo", /Administração/);
    clicarLimpar(form, "apontamento-centro-custo");
    await waitFor(() => expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte"));
    // Sem máquina (ou máquina sem centro), limpar deixa vazio.
    await limparSeletor(form, "apontamento-bem");
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO);
    await escolherNoSeletor(form, "apontamento-centro-custo", /Frota leve/);
    await limparSeletor(form, "apontamento-centro-custo");
    enviar();
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ bem_id: null, centro_custo_id: null });
    cleanup();

    // Edição: limpar o centro limpa de verdade (o servidor nunca relê o bem).
    ({ form, onSubmit } = montar({ initialData: REGISTRO }));
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte");
    await limparSeletor(form, "apontamento-centro-custo");
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ centro_custo_id: null });
  });

  it("AP-FORM-14 — edição: o centro de custo é snapshot; trocar ou limpar a máquina nunca o preenche nem o troca", async () => {
    // Registro COM centro gravado: a troca de máquina não relê o centro do novo bem.
    let { form, onSubmit } = montar({ initialData: REGISTRO });
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte");
    await escolherNoSeletor(form, "apontamento-bem", /Caminhonete/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte");
    await escolherNoSeletor(form, "apontamento-bem", /Moto/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte");
    await limparSeletor(form, "apontamento-bem");
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe("Centro de custo: 1 — Pecuária de corte");
    expect(valorDoSeletor(form, "apontamento-centro-resultado")).toBe(CENTRO_RESULTADO_VAZIO);
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: null, centro_custo_id: "cc1", centro_resultado_id: null });
    cleanup();

    // Registro SEM centro gravado: escolher um bem com centro não o preenche.
    ({ form, onSubmit } = montar({ initialData: { ...REGISTRO, centro_custo_id: null, centro_custo: null } }));
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO);
    await escolherNoSeletor(form, "apontamento-bem", /Caminhonete/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO);
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toBe(CENTRO_CUSTO_VAZIO);
    enviar();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ bem_id: "b1", centro_custo_id: null, centro_resultado_id: null });
    // Na edição o centro só muda se o usuário escolher.
    await escolherNoSeletor(form, "apontamento-centro-custo", /Administração/);
    enviar();
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ bem_id: "b1", centro_custo_id: "cc3" });
  });

  it("AP-FORM-7 — o envio leva só as colunas do formulário (allowlist), com a hora no fuso da fazenda", async () => {
    const { form, onSubmit } = montar();
    await escolherTipo(form, "ROÇADA");
    await escolherNoSeletor(form, "apontamento-bem", /Trator/);
    fireEvent.change(within(form).getByLabelText("Hora início"), { target: { value: "07:30" } });
    fireEvent.change(within(form).getByLabelText("Hora fim"), { target: { value: "11:15" } });
    enviar();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const corpo = onSubmit.mock.calls[0][0];
    expect(Object.keys(corpo).sort()).toEqual([
      "area_id",
      "bem_id",
      "centro_custo_id",
      "centro_resultado_id",
      "data_operacional",
      "hora_fim",
      "hora_inicio",
      "implemento_bem_id",
      "observacao",
      "operador_usuario_id",
      "quantidade_produzida",
      "tipo_atividade_id",
      "unidade_producao",
    ]);
    expect(corpo).toMatchObject({
      tipo_atividade_id: "t1",
      data_operacional: HOJE,
      bem_id: "b1",
      implemento_bem_id: null,
      hora_inicio: `${HOJE}T07:30:00-04:00`,
      hora_fim: `${HOJE}T11:15:00-04:00`,
    });
  });

  it("AP-FORM-8 — hora de fim antes da de início e data futura são recusadas antes do envio", async () => {
    const { form, onSubmit } = montar();
    await escolherTipo(form, "ROÇADA");
    fireEvent.change(within(form).getByLabelText("Hora início"), { target: { value: "10:00" } });
    fireEvent.change(within(form).getByLabelText("Hora fim"), { target: { value: "09:00" } });
    fireEvent.change(within(form).getByTestId("apontamento-data"), { target: { value: "2026-11-14" } });
    enviar();
    expect(await within(form).findByText("A hora de fim é anterior à hora de início.")).toBeTruthy();
    expect(within(form).getByText(/não pode ser posterior a hoje/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("AP-FORM-9 — apontamento CANCELADO abre só leitura, mesmo pedido em edição, e não oferece novo cancelamento", async () => {
    const { form, onSubmit } = montar({ initialData: CANCELADO, readOnly: false, podeCancelar: true });
    expect(form.hasAttribute("data-somente-leitura")).toBe(true);
    expect(within(form).getByTestId("apontamento-cancelado").textContent).toMatch(/Lançado em duplicidade/);
    expect(within(form).queryByRole("combobox", { name: /Tipo de atividade/ })).toBeNull();
    expect(within(form).getByTestId("apontamento-tipo-leitura").value).toBe("GRADAGEM");
    for (const testId of ["apontamento-bem", "apontamento-implemento", "apontamento-operador", "apontamento-centro-custo", "apontamento-centro-resultado"]) {
      expect(within(form).getByTestId(testId)).toBeDisabled();
    }
    expect(within(form).getByTestId("apontamento-quantidade").readOnly).toBe(true);
    expect(within(form).queryByTestId("apontamento-cancelar")).toBeNull();
    enviar();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("AP-FORM-10 — confirmado em leitura oferece Cancelar apontamento (quem pode) e mostra o gravado, com a hora da fazenda", () => {
    const { form, onCancelar } = montar({ initialData: REGISTRO, readOnly: true, podeCancelar: true });
    expect(within(form).getByLabelText("Hora início").value).toBe("07:30");
    expect(within(form).getByLabelText("Hora fim").value).toBe("11:15");
    expect(within(form).getByTestId("apontamento-quantidade").value).toBe("12,5");
    expect(valorDoSeletor(form, "apontamento-centro-custo")).toMatch(/Pecuária de corte/);
    fireEvent.click(within(form).getByTestId("apontamento-cancelar"));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it("AP-FORM-11 — sem permissão de cancelar, o botão não aparece", () => {
    const { form } = montar({ initialData: REGISTRO, readOnly: true, podeCancelar: false });
    expect(within(form).queryByTestId("apontamento-cancelar")).toBeNull();
  });
});

describe("AP-REGRAS — regras puras", () => {
  it("AP-REGRAS-1 — hora no fuso da fazenda (ida e volta) e PATCH mínimo", async () => {
    const { instanteNoFuso, horaNoFuso, camposAlteradosDoApontamento, validarFormulario, formularioVazio } = await import(
      "@/lib/apontamentoAtividadeRegras"
    );
    expect(instanteNoFuso("2026-11-10", "07:30", "America/Cuiaba")).toBe("2026-11-10T07:30:00-04:00");
    expect(instanteNoFuso("2026-11-10", "07:30", "America/Sao_Paulo")).toBe("2026-11-10T07:30:00-03:00");
    expect(instanteNoFuso("2026-11-10", "07:30", null)).toBeNull();
    expect(horaNoFuso("2026-11-10T11:30:00.000Z", "America/Cuiaba")).toBe("07:30");
    // Mesma hora em outra grafia, mesma quantidade com outra escala: nada a enviar.
    expect(
      camposAlteradosDoApontamento(REGISTRO, {
        hora_inicio: "2026-11-10T07:30:00-04:00",
        quantidade_produzida: "12.5",
        observacao: "Talhão norte ",
        bem_id: "b1",
        centro_resultado_id: null,
      }),
    ).toEqual({});
    expect(camposAlteradosDoApontamento(REGISTRO, { centro_resultado_id: "cr1", area_id: null })).toEqual({ centro_resultado_id: "cr1", area_id: null });
    // Hora sem fuso nunca some em silêncio; implemento igual à máquina é recusado.
    const form = { ...formularioVazio(HOJE), tipo_atividade_id: "t1", hora_inicio: "07:00", bem: { id: "b1", rotulo: "x" }, implemento: { id: "b1", rotulo: "x" } };
    const erros = validarFormulario(form, { hoje: HOJE, fuso: null });
    expect(erros.hora_inicio).toMatch(/fuso/);
    expect(erros.implemento).toMatch(/não pode ser a própria máquina/);
  });

  it("AP-REGRAS-2 — centro de custo do bem: só no novo, sem sobrescrever a escolha manual; nunca na edição; resultado nunca", async () => {
    const { mudancaAoEscolherBem, mudancaAoEscolherCentroCusto, centroCustoDoBem, formularioVazio, formularioDoRegistro, corpoDoFormulario } =
      await import("@/lib/apontamentoAtividadeRegras");
    const trator = { id: "b1", numero: "1", codigo_frota: "TP-01", nome: "Trator", natureza: "MAQUINA", centro_custo: CC_TRATOR };
    const moto = { id: "b4", numero: "4", nome: "Moto", natureza: "VEICULO", centro_custo: null };
    const doTrator = { id: "cc1", rotulo: "1 — Pecuária de corte" };
    expect(centroCustoDoBem(trator)).toEqual(doTrator);
    expect(centroCustoDoBem(moto)).toBeNull();
    expect(centroCustoDoBem({ id: "b9" })).toBeNull();
    expect(centroCustoDoBem(null)).toBeNull();

    const vazio = formularioVazio(HOJE);
    expect(vazio.centro_custo_origem).toBeNull();
    // Novo, sem escolha manual: o centro acompanha o bem (ou some com ele).
    const comTrator = { ...vazio, ...mudancaAoEscolherBem(vazio, trator, { novo: true }) };
    expect(comTrator).toMatchObject({ bem: { id: "b1" }, implemento: null, centro_custo: doTrator, centro_custo_origem: "bem", centro_resultado: null });
    expect(mudancaAoEscolherBem(comTrator, moto, { novo: true })).toMatchObject({ centro_custo: null, centro_custo_origem: null });
    expect(mudancaAoEscolherBem(comTrator, null, { novo: true })).toEqual({ bem: null, implemento: null, centro_custo: null, centro_custo_origem: null, centro_custo_do_bem: null });
    // Novo com máquina de centro ativo: limpar o centro traz de volta o do bem (o servidor o copiaria).
    expect(mudancaAoEscolherCentroCusto(null, comTrator, { novo: true })).toEqual({ centro_custo: doTrator, centro_custo_origem: "bem" });
    // Escolha manual: a máquina nunca a sobrescreve.
    const manual = { ...comTrator, ...mudancaAoEscolherCentroCusto({ id: "cc3", numero: "3", nome: "Administração" }) };
    expect(manual).toMatchObject({ centro_custo: { id: "cc3", rotulo: "3 — Administração" }, centro_custo_origem: "usuario" });
    expect(mudancaAoEscolherBem(manual, moto, { novo: true })).not.toHaveProperty("centro_custo");
    expect(mudancaAoEscolherBem(manual, null, { novo: true })).not.toHaveProperty("centro_custo");
    expect(mudancaAoEscolherCentroCusto(null)).toEqual({ centro_custo: null, centro_custo_origem: null });
    // A escolha manual guarda o centro do bem novo: limpar volta a ele, não ao do bem anterior.
    const manualMoto = { ...manual, ...mudancaAoEscolherBem(manual, moto, { novo: true }) };
    expect(manualMoto).toMatchObject({ centro_custo: { id: "cc3" }, centro_custo_origem: "usuario", centro_custo_do_bem: null });
    expect(mudancaAoEscolherCentroCusto(null, manualMoto, { novo: true })).toEqual({ centro_custo: null, centro_custo_origem: null });
    expect(mudancaAoEscolherCentroCusto(null, manual, { novo: true })).toEqual({ centro_custo: doTrator, centro_custo_origem: "bem" });
    // Edição: snapshot, nunca relido do bem (com ou sem centro gravado).
    const gravado = formularioDoRegistro(REGISTRO, FUSO);
    expect(mudancaAoEscolherBem(gravado, moto, { novo: false })).toEqual({ bem: { id: "b4", rotulo: expect.any(String) }, implemento: null });
    const semCentro = formularioDoRegistro({ ...REGISTRO, centro_custo_id: null, centro_custo: null }, FUSO);
    expect(mudancaAoEscolherBem(semCentro, trator, { novo: false })).not.toHaveProperty("centro_custo");
    // Edição: limpar o centro limpa (o servidor nunca relê o bem).
    expect(mudancaAoEscolherCentroCusto(null, { ...gravado, centro_custo_do_bem: doTrator }, { novo: false })).toEqual({ centro_custo: null, centro_custo_origem: null });
    // A origem não vai no corpo.
    expect(corpoDoFormulario({ ...comTrator, tipo_atividade_id: "t1" }, FUSO)).toMatchObject({ bem_id: "b1", centro_custo_id: "cc1", centro_resultado_id: null });
    expect(corpoDoFormulario({ ...comTrator, tipo_atividade_id: "t1" }, FUSO)).not.toHaveProperty("centro_custo_origem");
    expect(corpoDoFormulario({ ...comTrator, tipo_atividade_id: "t1" }, FUSO)).not.toHaveProperty("centro_custo_do_bem");
  });

  it("AP-REGRAS-3 — horário recusado pelo servidor: a frase segue o reason (fim antes do início, hora futura, fora do dia) e destaca a hora certa", async () => {
    const { mensagemErroApontamento, campoDoErroApontamento } = await import("@/lib/apontamentoAtividadeRegras");
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const CODE = "APONTAMENTO_ATIVIDADE_HORARIO_INVALIDO";
    // Como o cliente nativo entrega: o corpo do servidor (field/reason no topo e em details) em `cause`.
    const recusa = (field, reason, extra = {}) =>
      new ApiError(API_ERROR_CODES[CODE], { cause: { code: CODE, field, reason, details: { ...extra, field, reason } } });
    const casos = [
      ["hora_fim", "fim_antes_do_inicio", {}, "A hora de fim é anterior à hora de início. Nada foi gravado."],
      ["hora_inicio", "hora_futura", { agora: "2026-11-13T18:00:00.000Z" }, "A hora de início é posterior a agora na fazenda: só se aponta atividade já executada. Nada foi gravado."],
      ["hora_fim", "hora_futura", { agora: "2026-11-13T18:00:00.000Z" }, "A hora de fim é posterior a agora na fazenda: só se aponta atividade já executada. Nada foi gravado."],
      ["hora_inicio", "hora_fora_do_dia", { data: "2026-11-10", dia: "2026-11-09", fuso: FUSO }, "A hora de início tem de cair na data da atividade (no fuso da fazenda). Nada foi gravado."],
      ["hora_fim", "hora_fora_do_dia", { data: "2026-11-10", dia: "2026-11-12", fuso: FUSO }, "A hora de fim tem de cair na data da atividade (no fuso da fazenda). Nada foi gravado."],
    ];
    for (const [field, reason, extra, frase] of casos) {
      const erro = recusa(field, reason, extra);
      expect(mensagemErroApontamento(erro, "fallback")).toBe(frase);
      expect(campoDoErroApontamento(erro)).toBe(field);
    }
    // Reason desconhecido: a frase genérica do catálogo, que não afirma "fim antes do início".
    const generica = mensagemErroApontamento(recusa("hora_fim", "outro"), "fallback");
    expect(generica).toMatch(/horário foi recusado/);
    expect(generica).not.toMatch(/anterior à hora de início/);
  });
});

describe("AP-PORTA — corpo pela allowlist da porta nativa", () => {
  it("AP-PORTA-1 — criar, editar e cancelar levam só as chaves do contrato", async () => {
    const { operacoesNativas, montarCaminhoListagem, montarCaminhoOpcoes } = await import("@/apis/atividades/apontamentoAtividadePort.js");
    const sujo = {
      empresa_id: "emp-1",
      tipo_atividade_id: "t1",
      data_operacional: HOJE,
      centro_resultado_id: "cr1",
      observacao: "  ",
      cliente_id: "outro-tenant",
      numero: "99",
      status: "CANCELADO",
      tipo_atividade_nome: "FORJADO",
      grupo_atividade_id: "g9",
      grupo_atividade_nome: "FORJADO",
      exige_area: true,
      pode_ter_maquina: true,
      criado_por_usuario_id: "u9",
      versao: 4,
      motivo: "x",
    };
    await operacoesNativas.create(sujo);
    expect(http.nativeRequest).toHaveBeenLastCalledWith(
      "/apontamentos-atividade",
      expect.objectContaining({
        method: "POST",
        body: { empresa_id: "emp-1", tipo_atividade_id: "t1", data_operacional: HOJE, centro_resultado_id: "cr1", observacao: null },
      }),
      expect.anything(),
    );
    await operacoesNativas.update("ap1", sujo);
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/apontamentos-atividade/ap1");
    expect(Object.keys(http.nativeRequest.mock.calls.at(-1)[1].body).sort()).toEqual(
      ["centro_resultado_id", "data_operacional", "empresa_id", "observacao", "tipo_atividade_id", "versao"],
    );
    await operacoesNativas.cancelar("ap1", sujo);
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/apontamentos-atividade/ap1/cancelar");
    expect(http.nativeRequest.mock.calls.at(-1)[1].body).toEqual({ empresa_id: "emp-1", versao: 4, motivo: "x" });
    // D-PROD-193 (D-2): o cancelamento leva o `operation_id` do recibo.
    await operacoesNativas.cancelar("ap1", { ...sujo, operation_id: "op-cancelar-1" });
    expect(http.nativeRequest.mock.calls.at(-1)[1].body).toEqual({ empresa_id: "emp-1", versao: 4, motivo: "x", operation_id: "op-cancelar-1" });
    // Sem DELETE físico.
    expect(operacoesNativas).not.toHaveProperty("delete");
    expect(montarCaminhoListagem({ empresa_id: "emp-1", status: "CONFIRMADO", data_de: "2026-11-01", cliente_id: "x" })).toBe(
      "/apontamentos-atividade?empresa_id=emp-1&data_de=2026-11-01&status=CONFIRMADO",
    );
    expect(montarCaminhoOpcoes("bens", { empresa_id: "emp-1", natureza: ["MAQUINA", "VEICULO"] })).toBe(
      "/apontamentos-atividade-opcoes/bens?empresa_id=emp-1&natureza=MAQUINA&natureza=VEICULO",
    );
  });
});

describe("AP-PAGE — tela de apontamentos de atividade", () => {
  const montarTela = async () => {
    servico.listarTiposAtividade.mockResolvedValue(TIPOS);
    servico.listarAreasDoApontamento.mockResolvedValue(AREAS);
    servico.listarApontamentosPagina.mockResolvedValue({ items: [REGISTRO, CANCELADO], next_cursor: null, has_more: false, total: 2, limit: 100 });
    // D-PROD-193: o registro aberto é o DETALHE (com itens), não a linha da lista.
    servico.detalharApontamento.mockImplementation(async (_emp, id) => (id === "ap1" ? REGISTRO_COM_ITENS : CANCELADO_COM_ITENS));
    const { default: ApontamentosAtividade } = await import("@/pages/ApontamentosAtividade");
    render(
      <QueryClientProvider client={novoCliente()}>
        <ApontamentosAtividade />
      </QueryClientProvider>,
    );
    await screen.findByTestId("apontamento-numero-ap1");
  };

  it("AP-PAGE-1 — lista e abre o formulário do Novo na ordem exata", async () => {
    await montarTela();
    expect(servico.listarApontamentosPagina).toHaveBeenCalledWith("emp-1", expect.objectContaining({ limit: expect.any(Number) }));
    fireEvent.click(await screen.findByRole("button", { name: "Novo apontamento" }));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    expect(rotulos(form)).toEqual(ORDEM);
    fireEvent.submit(document.getElementById(FORMULARIO_APONTAMENTO_ATIVIDADE_ID));
    expect(await within(form).findByText("Escolha o tipo de atividade.")).toBeTruthy();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
  });

  it("AP-PAGE-2 — cancelado abre só leitura, sem Editar nem Cancelar", async () => {
    await montarTela();
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap2"));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    expect(form.hasAttribute("data-somente-leitura")).toBe(true);
    expect(within(form).getByTestId("apontamento-cancelado")).toBeTruthy();
    expect(screen.queryByTestId("apontamento-cancelar")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Editar$/ })).toBeNull();
  });

  it("AP-PAGE-3 — confirmado: Cancelar apontamento pede motivo e envia com a versão lida", async () => {
    servico.cancelarApontamento.mockResolvedValue({ ...REGISTRO, status: "CANCELADO", versao: 3, cancelamento: { motivo: "Erro de digitação" } });
    await montarTela();
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    fireEvent.click(await screen.findByTestId("apontamento-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
    expect(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")).toBeDisabled();
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "Erro de digitação" } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
    await waitFor(() => expect(servico.cancelarApontamento).toHaveBeenCalledTimes(1));
    // D-PROD-193 (D-2): o envio leva o escopo da pendência de `operation_id` (cliente:login) e diz se é retentativa.
    expect(servico.cancelarApontamento).toHaveBeenCalledWith(
      "emp-1",
      expect.objectContaining({ id: "ap1", versao: 2 }),
      "Erro de digitação",
      { escopo: "cli-1:gerente", retentativa: false },
    );
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Apontamento cancelado", expect.stringMatching(/nº 15/));
  });

  it("AP-PAGE-5 — confirmado: Editar abre os campos e salvar manda o formulário com o registro lido (PATCH mínimo no service)", async () => {
    servico.atualizarApontamento.mockResolvedValue({ alterado: true, registro: { ...REGISTRO, versao: 3, centro_resultado_id: "cr1" } });
    await montarTela();
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    await screen.findByTestId("b1-form-apontamento-atividade");
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/ }));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    await waitFor(() => expect(form.hasAttribute("data-somente-leitura")).toBe(false));
    // A hora gravada (UTC) aparece no relógio da fazenda.
    expect(within(form).getByLabelText("Hora início").value).toBe("07:30");
    await escolherNoSeletor(form, "apontamento-centro-resultado", /Recria 2026/);
    fireEvent.submit(document.getElementById(FORMULARIO_APONTAMENTO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.atualizarApontamento).toHaveBeenCalledTimes(1));
    const [emp, original, corpo] = servico.atualizarApontamento.mock.calls[0];
    expect(emp).toBe("emp-1");
    expect(original).toMatchObject({ id: "ap1", versao: 2 });
    expect(corpo).toMatchObject({ tipo_atividade_id: "t3", centro_resultado_id: "cr1", centro_custo_id: "cc1", hora_inicio: "2026-11-10T07:30:00-04:00" });
  });

  it("AP-PAGE-6 — hora recusada pelo servidor (hora futura): o aviso diz qual hora e por quê, não \"fim antes do início\"", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const CODE = "APONTAMENTO_ATIVIDADE_HORARIO_INVALIDO";
    const detalhes = { field: "hora_fim", reason: "hora_futura", agora: "2026-11-13T18:00:00.000Z" };
    servico.atualizarApontamento.mockRejectedValueOnce(
      new ApiError(API_ERROR_CODES[CODE], { cause: { code: CODE, field: "hora_fim", reason: "hora_futura", details: detalhes } }),
    );
    notify.notifyWarning.mockClear();
    await montarTela();
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    await screen.findByTestId("b1-form-apontamento-atividade");
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/ }));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    await waitFor(() => expect(form.hasAttribute("data-somente-leitura")).toBe(false));
    await escolherNoSeletor(form, "apontamento-centro-resultado", /Recria 2026/);
    fireEvent.submit(document.getElementById(FORMULARIO_APONTAMENTO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.atualizarApontamento).toHaveBeenCalledTimes(1));
    const frase = "A hora de fim é posterior a agora na fazenda: só se aponta atividade já executada. Nada foi gravado.";
    await waitFor(() => expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", frase));
    expect(notify.notifyWarning).not.toHaveBeenCalledWith("Atenção", expect.stringMatching(/anterior à hora de início/));
    expect(await within(form).findByText(frase)).toBeTruthy();
  });

  it("AP-PAGE-4 — sem a ação de cancelar (excluir da tela), o botão não aparece", async () => {
    sessao.acoes = { ...sessao.acoes, cancelar: false };
    try {
      await montarTela();
      fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
      await screen.findByTestId("b1-form-apontamento-atividade");
      expect(screen.queryByTestId("apontamento-cancelar")).toBeNull();
    } finally {
      sessao.acoes = { ...sessao.acoes, cancelar: true };
    }
  });
});

describe("AP-ITENS — itens do apontamento (D-PROD-193)", () => {
  const cards = (form) => [...form.querySelectorAll('[data-testid^="apontamento-item-"][data-status]')].map((el) => el.getAttribute("data-testid"));
  const rascunho = () => screen.getByTestId("apontamento-item-rascunho");

  it("AP-ITENS-1 — seção Itens nos 4 estados: novo (só aviso), edição (só leitura), consulta do confirmado (ações), cancelado (só leitura)", async () => {
    // Novo: só o aviso; nenhum item, nenhuma ação.
    let { form } = montar({ podeLancarItens: true, podeCancelarItens: true, onAdicionarItem: vi.fn(), onCancelarItem: vi.fn() });
    expect(within(form).getByTestId("apontamento-itens-novo").textContent).toMatch(/Os itens entram depois de salvar o apontamento/);
    expect(within(form).queryByTestId("apontamento-itens-acoes")).toBeNull();
    cleanup();

    // Edição do cabeçalho: itens só leitura (nada de lançar nem cancelar) e a data travada (D-1).
    ({ form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: false, podeLancarItens: true, podeCancelarItens: true, onAdicionarItem: vi.fn(), onCancelarItem: vi.fn() }));
    expect(cards(form)).toEqual(["apontamento-item-1", "apontamento-item-2"]);
    expect(within(form).queryByTestId("apontamento-itens-acoes")).toBeNull();
    expect(within(form).queryByTestId("apontamento-item-cancelar-1")).toBeNull();
    expect(within(form).getByTestId("apontamento-itens-edicao")).toBeTruthy();
    expect(within(form).getByTestId("apontamento-data").readOnly).toBe(true);
    expect(within(form).getByTestId("apontamento-data-travada").textContent).toMatch(/item de Produto/);
    cleanup();

    // Consulta do confirmado: itens gravados, custo (só confirmados), + Produto/Serviço/Outro custo e Cancelar item só no confirmado.
    const onCancelarItem = vi.fn();
    ({ form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, podeCancelarItens: true, onAdicionarItem: vi.fn(), onCancelarItem }));
    expect(within(form).getByTestId("apontamento-item-total-1").textContent).toMatch(/66,4063/);
    expect(within(form).getByTestId("apontamento-item-quantidade-1").textContent).toBe("12,5 L");
    expect(within(form).getByTestId("apontamento-item-2").getAttribute("data-status")).toBe("CANCELADO");
    expect(within(form).getByTestId("apontamento-item-cancelamento-2").textContent).toMatch(/Motivo: Lançado errado/);
    expect(within(form).getByTestId("apontamento-itens-custo").textContent).toMatch(/66,4063/);
    expect(within(form).getByTestId("apontamento-item-novo-produto").textContent).toMatch(/\+ Produto/);
    expect(within(form).getByTestId("apontamento-item-novo-servico").textContent).toMatch(/\+ Serviço/);
    expect(within(form).getByTestId("apontamento-item-novo-outro").textContent).toMatch(/\+ Outro custo/);
    expect(within(form).queryByTestId("apontamento-item-cancelar-2")).toBeNull();
    fireEvent.click(within(form).getByTestId("apontamento-item-cancelar-1"));
    expect(onCancelarItem).toHaveBeenCalledWith(expect.objectContaining({ id: "it1" }));
    // Os lotes consumidos ficam recolhidos em "Detalhes do estoque".
    expect(within(form).queryByTestId("apontamento-item-fatias-1")).toBeNull();
    fireEvent.click(within(form).getByTestId("apontamento-item-detalhes-1"));
    expect(within(form).getByTestId("apontamento-item-fatias-1").querySelectorAll("tbody tr")).toHaveLength(2);
    cleanup();

    // Cancelado: só leitura; o item aparece "Cancelado junto com o apontamento".
    ({ form } = montar({ initialData: CANCELADO_COM_ITENS, readOnly: false, podeLancarItens: true, podeCancelarItens: true, onAdicionarItem: vi.fn(), onCancelarItem: vi.fn() }));
    expect(within(form).getByTestId("apontamento-item-cancelamento-1").textContent).toMatch(/Cancelado junto com o apontamento/);
    expect(within(form).queryByTestId("apontamento-itens-acoes")).toBeNull();
    expect(within(form).queryByTestId("apontamento-item-cancelar-1")).toBeNull();
  });

  it("AP-ITENS-2 — nenhum botão de item sem as ações editar (lançar) e cancelar (cancelar item)", () => {
    let { form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: false, podeCancelarItens: false, onAdicionarItem: vi.fn(), onCancelarItem: vi.fn() });
    expect(cards(form)).toHaveLength(2);
    expect(within(form).queryByTestId("apontamento-itens-acoes")).toBeNull();
    expect(within(form).queryByTestId("apontamento-item-cancelar-1")).toBeNull();
    cleanup();
    // Só cancelar: cancela item, não lança.
    ({ form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: false, podeCancelarItens: true, onAdicionarItem: vi.fn(), onCancelarItem: vi.fn() }));
    expect(within(form).queryByTestId("apontamento-itens-acoes")).toBeNull();
    expect(within(form).getByTestId("apontamento-item-cancelar-1")).toBeTruthy();
    cleanup();
    // Só editar: lança, não cancela item.
    ({ form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, podeCancelarItens: false, onAdicionarItem: vi.fn(), onCancelarItem: vi.fn() }));
    expect(within(form).getByTestId("apontamento-itens-acoes")).toBeTruthy();
    expect(within(form).queryByTestId("apontamento-item-cancelar-1")).toBeNull();
  });

  it("AP-ITENS-3 — Serviço: total exibido HALF_UP em 4 casas ('1' × '1,00005' = 1,0001) e o corpo leva só as chaves do tipo, em texto", async () => {
    const onAdicionarItem = vi.fn(async () => ({}));
    const { form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, onAdicionarItem });
    fireEvent.click(within(form).getByTestId("apontamento-item-novo-servico"));
    const card = rascunho();
    expect(card.getAttribute("data-tipo")).toBe("SERVICO");
    // Um rascunho por vez.
    expect(within(form).getByTestId("apontamento-item-novo-produto")).toBeDisabled();
    // Sem descrição nem valor: recusado ANTES do envio.
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    expect(await within(card).findByText("Descreva o item.")).toBeTruthy();
    expect(onAdicionarItem).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "  Mão de obra terceirizada  " } });
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "1,00005" } });
    expect(within(card).getByTestId("apontamento-item-total").textContent).toMatch(/1,0001/);
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await waitFor(() => expect(onAdicionarItem).toHaveBeenCalledTimes(1));
    expect(onAdicionarItem.mock.calls[0][0]).toEqual({ tipo: "SERVICO", descricao: "Mão de obra terceirizada", quantidade: "1", valor_unitario: "1.00005" });
    expect(onAdicionarItem.mock.calls[0][1]).toEqual({ retentativa: false });
  });

  it("AP-ITENS-4 — Produto: unidade do estoque (SACO digita kg, com a dica), local único escolhido sozinho e corpo sem chave de serviço", async () => {
    const onAdicionarItem = vi.fn(async () => ({}));
    const { form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, onAdicionarItem });
    fireEvent.click(within(form).getByTestId("apontamento-item-novo-produto"));
    const card = rascunho();
    await escolherNoSeletor(card, "apontamento-item-produto", /Adubo NPK/);
    expect(servico.listarOpcoesApontamento).toHaveBeenCalledWith("produtos", "emp-1", expect.anything());
    // Um só local com saldo: já vem escolhido.
    expect((await within(card).findByTestId("apontamento-item-local-auto")).textContent).toMatch(/Armazém.*250 kg/);
    expect(servico.listarLocaisDoProduto).toHaveBeenCalledWith("emp-1", "p2");
    expect(within(card).getByTestId("apontamento-item-dica-kg").textContent).toMatch(/digite kg, não sacos/);
    expect(within(card).getByText(/Quantidade \(kg\)/)).toBeTruthy();
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "12,5" } });
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await waitFor(() => expect(onAdicionarItem).toHaveBeenCalledTimes(1));
    expect(onAdicionarItem.mock.calls[0][0]).toEqual({ tipo: "PRODUTO", produto_id: "p2", local_estoque_id: "l3", quantidade: "12.5" });
  });

  it("AP-ITENS-5 — Produto em L com dois locais: escolher o local; passar do saldo é aviso, não bloqueio; Produto sem L/KG/SACO é recusado na tela", async () => {
    const onAdicionarItem = vi.fn(async () => ({}));
    const { form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, onAdicionarItem });
    fireEvent.click(within(form).getByTestId("apontamento-item-novo-produto"));
    const card = rascunho();
    await escolherNoSeletor(card, "apontamento-item-produto", /Brinco/);
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    expect(await within(card).findByText(/não pode ser lançado como item/)).toBeTruthy();
    expect(servico.listarLocaisDoProduto).not.toHaveBeenCalled();
    await escolherNoSeletor(card, "apontamento-item-produto", /Herbicida X/);
    await waitFor(() => expect(servico.listarLocaisDoProduto).toHaveBeenCalledWith("emp-1", "p1"));
    expect(within(card).queryByTestId("apontamento-item-dica-kg")).toBeNull();
    const seletorDoLocal = await within(card).findByRole("combobox", { name: /De qual local do estoque/ });
    await act(async () => fireEvent.click(seletorDoLocal));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: /GALPÃO 2/i })));
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "6" } });
    expect(within(card).getByTestId("apontamento-item-aviso-saldo").textContent).toMatch(/disponível 5 L/);
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await waitFor(() => expect(onAdicionarItem).toHaveBeenCalledTimes(1));
    expect(onAdicionarItem.mock.calls[0][0]).toEqual({ tipo: "PRODUTO", produto_id: "p1", local_estoque_id: "l2", quantidade: "6" });
  });

  it("AP-ITENS-6 — sem resposta: resultado incerto (nunca sucesso) e a retentativa vai marcada; recusa do servidor fica no card com a unidade do item", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const onAdicionarItem = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {}))
      .mockRejectedValueOnce(
        new ApiError(API_ERROR_CODES.OPERATION_FAILED, {
          cause: { code: "ESTOQUE_SALDO_INSUFICIENTE", field: "quantidade", reason: "saldo_lote_insuficiente", details: { disponivel: "5.0000", solicitado: "6.0000" } },
        }),
      );
    const onConsultarItem = vi.fn(async () => "O item ainda não aparece gravado. Repita o mesmo envio: ele não duplica.");
    const { form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, onAdicionarItem, onConsultarItem });
    fireEvent.click(within(form).getByTestId("apontamento-item-novo-produto"));
    const card = rascunho();
    await escolherNoSeletor(card, "apontamento-item-produto", /Herbicida X/);
    const seletorDoLocal = await within(card).findByRole("combobox", { name: /De qual local do estoque/ });
    await act(async () => fireEvent.click(seletorDoLocal));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: /GALPÃO 2/i })));
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "6" } });
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    // Produto mexe no estoque: o aviso diz que repetir não baixa o estoque duas vezes.
    expect((await within(card).findByTestId("resultado-incerto")).textContent).toMatch(/o estoque não é\s+baixado duas vezes/);
    expect(within(card).getByTestId("apontamento-item-lancar").textContent).toBe("Repetir o mesmo envio");
    fireEvent.click(within(card).getByTestId("botao-consultar-resultado"));
    expect(await within(card).findByTestId("consulta-resultado")).toBeTruthy();
    expect(onConsultarItem).toHaveBeenCalledWith(2);
    fireEvent.click(within(card).getByTestId("botao-repetir-envio"));
    await waitFor(() => expect(onAdicionarItem).toHaveBeenCalledTimes(2));
    expect(onAdicionarItem.mock.calls[1][0]).toEqual(onAdicionarItem.mock.calls[0][0]);
    expect(onAdicionarItem.mock.calls[0][1]).toEqual({ retentativa: false });
    expect(onAdicionarItem.mock.calls[1][1]).toEqual({ retentativa: true });
    expect((await within(card).findByTestId("erro-envio")).textContent).toBe(
      "Saldo insuficiente deste Produto neste local: disponível 5 L, pedido 6 L. Nada foi gravado.",
    );
  });

  it("AP-ITENS-7 — regras puras: validarItem, corpoDoItem, totalDoItem e custoDosItens (só confirmados), sem float", async () => {
    const { validarItem, corpoDoItem, totalDoItem, custoDosItens, itemVazio, cancelamentoDevolveuProduto, MAX_ITENS_APONTAMENTO } = await import(
      "@/lib/apontamentoAtividadeRegras"
    );
    expect(MAX_ITENS_APONTAMENTO).toBe(200);
    expect(totalDoItem("1", "1.00005")).toBe("1.0001");
    // Sem float: 2.00025 em binário é 2.000249999…, e a conta em Number arredondaria para 2.0002.
    expect(totalDoItem("1", "2.00025")).toBe("2.0003");
    expect(totalDoItem("0.1", "3")).toBe("0.3000");
    expect(totalDoItem("3", "0.1")).toBe("0.3000");
    expect(totalDoItem("x", "1")).toBeNull();
    // SERVIÇO/OUTRO: descrição, quantidade > 0, valor com até 6 casas e total > 0.
    expect(validarItem(itemVazio("OUTRO")).erros).toMatchObject({ descricao: expect.any(String), quantidade: expect.any(String), valor_unitario: expect.any(String) });
    const zero = { ...itemVazio("SERVICO"), descricao: "Frete", quantidade: "0,0001", valor_unitario: "0,1" };
    expect(validarItem(zero).erros.valor_unitario).toMatch(/deu zero/);
    expect(validarItem({ ...zero, quantidade: "0" }).erros.quantidade).toMatch(/maior que zero/);
    expect(validarItem({ ...zero, valor_unitario: "1,1234567" }).erros.valor_unitario).toMatch(/6 casas/);
    expect(validarItem({ ...zero, descricao: "x".repeat(256) }).erros.descricao).toMatch(/255/);
    expect(validarItem({ ...zero, descricao: "<b>frete</b>" }).erros.descricao).toMatch(/< e >/);
    // PRODUTO: produto, local e quantidade; passar do saldo é AVISO, não erro.
    const prod = { ...itemVazio("PRODUTO"), produto: { id: "p1", rotulo: "Herbicida X", unidade_principal_estoque: "L" }, local_estoque_id: "l1", quantidade: "90" };
    const v = validarItem(prod, { unidade: "L", disponivel: "80.0000" });
    expect(v.erros).toEqual({});
    expect(v.aviso).toMatch(/disponível 80 L/);
    expect(validarItem({ ...prod, local_estoque_id: null }).erros.local_estoque_id).toBeTruthy();
    expect(validarItem({ ...prod, produto: { ...prod.produto, unidade_principal_estoque: "UN" } }).erros.produto).toMatch(/não pode ser lançado/);
    // Corpo: só as chaves do TIPO, decimais canônicos, nunca null.
    expect(corpoDoItem({ ...prod, descricao: "não vai", valor_unitario: "9" })).toEqual({ tipo: "PRODUTO", produto_id: "p1", local_estoque_id: "l1", quantidade: "90" });
    expect(corpoDoItem({ ...itemVazio("OUTRO"), descricao: " Pedágio ", quantidade: "1.234,5", valor_unitario: "2,50", produto: prod.produto, local_estoque_id: "l1" })).toEqual({
      tipo: "OUTRO",
      descricao: "Pedágio",
      quantidade: "1234.5",
      valor_unitario: "2.5",
    });
    // Custo: só CONFIRMADO, 4 casas.
    expect(custoDosItens(REGISTRO_COM_ITENS.itens)).toEqual({ total: "66.4063", produto: "66.4063", servico: "0.0000", outro: "0.0000", itens_confirmados: 1 });
    expect(custoDosItens([])).toMatchObject({ total: "0.0000", itens_confirmados: 0 });
    // Devolução ao estoque no cancelamento do apontamento: só item de PRODUTO cancelado JUNTO (origem APONTAMENTO).
    expect(cancelamentoDevolveuProduto(AP1_CANCELADO)).toBe(true);
    expect(cancelamentoDevolveuProduto({ itens: [{ ...ITEM_PRODUTO_GRAVADO, status: "CANCELADO", cancelamento: { origem: "ITEM" } }] })).toBe(false);
    expect(cancelamentoDevolveuProduto({ itens: [{ ...ITEM_SERVICO_CANCELADO, cancelamento: { origem: "APONTAMENTO" } }] })).toBe(false);
    expect(cancelamentoDevolveuProduto(REGISTRO_COM_ITENS)).toBe(false);
    expect(cancelamentoDevolveuProduto(REGISTRO)).toBe(false);
    expect(cancelamentoDevolveuProduto(null)).toBe(false);
  });

  it("AP-ITENS-8 — mensagens dos códigos novos (saldo em L e em kg, estorno bloqueado com o item, combustível) e o espelho do servidor", async () => {
    const { mensagemErroApontamento, CODIGOS_RELER_APONTAMENTO } = await import("@/lib/apontamentoAtividadeRegras");
    const { ApiError, API_ERROR_CODES, getApiErrorMessage } = await import("@/apis/_core/ApiError.js");
    const recusa = (code, extra = {}) => new ApiError(API_ERROR_CODES[code] ?? API_ERROR_CODES.OPERATION_FAILED, { cause: { code, ...extra } });
    const NOVOS = [
      "APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND",
      "APONTAMENTO_ATIVIDADE_ITEM_INVALIDO",
      "APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO",
      "APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS",
      "APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO",
      "APONTAMENTO_ATIVIDADE_DATA_COM_ITENS",
    ];
    const cliente = readFileSync("src/apis/_core/nativeHttpClient.js", "utf8");
    for (const code of NOVOS) {
      expect(API_ERROR_CODES[code]).toBe(code);
      expect(getApiErrorMessage(new ApiError(code), "fallback")).not.toBe("fallback");
      expect(cliente).toContain(`${code}: API_ERROR_CODES.${code}`);
    }
    const saldo = (unidade) =>
      mensagemErroApontamento(
        recusa("ESTOQUE_SALDO_INSUFICIENTE", { field: "quantidade", reason: "saldo_lote_insuficiente", details: { disponivel: "3.5000", solicitado: "5.0000" } }),
        "fallback",
        { unidade },
      );
    expect(saldo("L")).toBe("Saldo insuficiente deste Produto neste local: disponível 3,5 L, pedido 5 L. Nada foi gravado.");
    expect(saldo("KG")).toBe("Saldo insuficiente deste Produto neste local: disponível 3,5 kg, pedido 5 kg. Nada foi gravado.");
    expect(
      mensagemErroApontamento(
        recusa("ESTOQUE_SALDO_INSUFICIENTE", { field: "quantidade", reason: "estoque_atual_insuficiente", details: { estoque_atual: "2.0000", solicitado: "5.0000" } }),
        "fallback",
        { unidade: "KG" },
      ),
    ).toBe("O estoque atual do Produto é menor que o pedido: atual 2 kg, pedido 5 kg. Nada foi gravado.");
    const invalido = (field, reason) => mensagemErroApontamento(recusa("APONTAMENTO_ATIVIDADE_ITEM_INVALIDO", { field, reason, details: { field, reason } }), "fallback");
    expect(invalido("produto_id", "combustivel_no_abastecimento")).toMatch(/combustível se lança no Abastecimento.*Nada foi gravado\.$/);
    expect(invalido("produto_id", "outra_empresa")).toBe("O Produto é de outra fazenda. Nada foi gravado.");
    expect(invalido("local_estoque_id", "inativo")).toBe("O local de estoque está inativo. Nada foi gravado.");
    expect(invalido("valor_unitario", "total_zero")).toMatch(/deu zero/);
    expect(
      mensagemErroApontamento(
        recusa("APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO", { field: "item_id", reason: "lote_indisponivel_para_devolucao", details: { item_id: "it1", item_ordem: 2 } }),
        "fallback",
      ),
    ).toBe("O estorno exato do estoque não é seguro agora no item 2: um lote de origem foi estornado ou removido. Nada foi alterado.");
    // Vínculo e camada (do motor): a frase diz O QUE diverge.
    const estorno = (reason) =>
      mensagemErroApontamento(recusa("APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO", { field: "item_id", reason, details: { item_id: "it1", item_ordem: 1 } }), "fallback");
    expect(estorno("vinculo_divergente")).toBe(
      "O estorno exato do estoque não é seguro agora no item 1: o movimento de saída do item é de outro Produto ou de outra fazenda. Nada foi alterado.",
    );
    expect(estorno("camada_divergente")).toBe(
      "O estorno exato do estoque não é seguro agora no item 1: um lote de origem é de outro Produto, fazenda ou local. Nada foi alterado.",
    );
    // O motor manda `quantidade_estoque_zero` (não `quantidade_nao_positiva`) ou `valor_excede_limite_estoque`.
    const motor = (reason) =>
      mensagemErroApontamento(recusa("OPERACAO_VALORES_INVALIDOS", { field: "quantidade", reason, details: { field: "quantidade", reason } }), "fallback", { unidade: "L" });
    expect(motor("quantidade_estoque_zero")).toBe("Informe uma quantidade maior que zero. Nada foi gravado.");
    expect(motor("valor_excede_limite_estoque")).toBe("Quantidade ou custo acima do limite do estoque. Nada foi gravado.");
    expect(mensagemErroApontamento(recusa("APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO", { details: { status: "CANCELADO" } }), "fallback")).toBe(
      "Este item já foi cancelado. Nada foi alterado.",
    );
    expect(mensagemErroApontamento(recusa("APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS", { details: { limite: 200 } }), "fallback")).toMatch(/já tem 200 itens/);
    expect(mensagemErroApontamento(recusa("APONTAMENTO_ATIVIDADE_DATA_COM_ITENS"), "fallback")).toMatch(/data não pode mudar/);
    expect(mensagemErroApontamento(recusa("CONCURRENCY_CONFLICT"), "fallback", { comandoIdempotente: true })).toMatch(/Repita o mesmo envio: não duplica/);
    // Item sumido, já cancelado, limite e data com item: a tela relê o detalhe.
    for (const code of ["APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND", "APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO", "APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS", "APONTAMENTO_ATIVIDADE_DATA_COM_ITENS"]) {
      expect(CODIGOS_RELER_APONTAMENTO).toContain(code);
    }
  });

  it("AP-ITENS-9 — porta: item e cancelamento do item por allowlist, sem null e sem cliente_id; locais só com empresa e produto", async () => {
    const { operacoesNativas, montarCaminhoOpcoes, CAMPOS_DE_ITEM } = await import("@/apis/atividades/apontamentoAtividadePort.js");
    expect([...CAMPOS_DE_ITEM].sort()).toEqual(
      ["descricao", "empresa_id", "local_estoque_id", "operation_id", "produto_id", "quantidade", "tipo", "valor_unitario", "versao"].sort(),
    );
    await operacoesNativas.adicionarItem("ap1", {
      empresa_id: "emp-1",
      versao: 2,
      operation_id: "lanc-0001-abcd",
      tipo: "SERVICO",
      descricao: "Frete",
      quantidade: "1",
      valor_unitario: "150",
      produto_id: null,
      local_estoque_id: "",
      cliente_id: "outro-tenant",
      status: "CONFIRMADO",
      valor_total: "1",
    });
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/apontamentos-atividade/ap1/itens");
    expect(http.nativeRequest.mock.calls.at(-1)[1]).toMatchObject({ method: "POST" });
    expect(http.nativeRequest.mock.calls.at(-1)[1].body).toEqual({
      empresa_id: "emp-1",
      versao: 2,
      operation_id: "lanc-0001-abcd",
      tipo: "SERVICO",
      descricao: "Frete",
      quantidade: "1",
      valor_unitario: "150",
    });
    await operacoesNativas.cancelarItem("ap1", "it 1", { empresa_id: "emp-1", versao: 3, operation_id: "lanc-0002-abcd", motivo: "Errado", tipo: "PRODUTO", cliente_id: "x" });
    expect(http.nativeRequest.mock.calls.at(-1)[0]).toBe("/apontamentos-atividade/ap1/itens/it%201/cancelar");
    expect(http.nativeRequest.mock.calls.at(-1)[1].body).toEqual({ empresa_id: "emp-1", versao: 3, operation_id: "lanc-0002-abcd", motivo: "Errado" });
    // Sem PATCH/DELETE de item.
    expect(Object.keys(operacoesNativas).filter((k) => /item/i.test(k)).sort()).toEqual(["adicionarItem", "cancelarItem"]);
    expect(montarCaminhoOpcoes("locais", { empresa_id: "emp-1", produto_id: "p1", q: "x", limit: 50 })).toBe(
      "/apontamentos-atividade-opcoes/locais?empresa_id=emp-1&produto_id=p1",
    );
    expect(montarCaminhoOpcoes("produtos", { empresa_id: "emp-1", q: "herb", limit: 50, produto_id: "p1" })).toBe(
      "/apontamentos-atividade-opcoes/produtos?empresa_id=emp-1&q=herb&limit=50",
    );
  });

  it("AP-ITENS-10 — service: o MESMO operation_id na retentativa (item e cancelamentos), chave nova depois da resposta definitiva", async () => {
    const real = await vi.importActual("@/services/apontamentoAtividadeService");
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const guardado = new Map();
    const storage = {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, v),
      removeItem: (k) => guardado.delete(k),
    };
    const registro = { id: "ap1", versao: 2 };
    const corpo = { tipo: "SERVICO", descricao: "Frete", quantidade: "1", valor_unitario: "150" };
    const c = { escopo: "cli-1:gerente", storage, confirmarDescarte: vi.fn(async () => false), confirmarNovoEnvio: vi.fn(async () => true) };
    http.nativeRequest.mockReset();
    http.nativeRequest.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {})).mockResolvedValueOnce({ id: "ap1", itens: [], replay: true });
    await expect(real.adicionarItemApontamento("emp-1", registro, corpo, { ...c, retentativa: false })).rejects.toMatchObject({ code: API_ERROR_CODES.PROVIDER_UNAVAILABLE });
    await real.adicionarItemApontamento("emp-1", registro, corpo, { ...c, retentativa: true });
    const [primeiro, segundo] = http.nativeRequest.mock.calls;
    expect(primeiro[0]).toBe("/apontamentos-atividade/ap1/itens");
    expect(primeiro[1].body).toEqual({ ...corpo, empresa_id: "emp-1", versao: 2, operation_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/) });
    expect(segundo[1].body.operation_id).toBe(primeiro[1].body.operation_id);
    // Respondido: a pendência saiu; o próximo item igual é um envio NOVO (outra chave).
    http.nativeRequest.mockResolvedValueOnce({ id: "ap1", itens: [] });
    await real.adicionarItemApontamento("emp-1", registro, corpo, { ...c, retentativa: false });
    expect(http.nativeRequest.mock.calls[2][1].body.operation_id).not.toBe(primeiro[1].body.operation_id);
    expect(c.confirmarNovoEnvio).not.toHaveBeenCalled();

    // Cancelar o item e o apontamento: mesma chave na retentativa; motivo curto não sai.
    http.nativeRequest.mockReset();
    http.nativeRequest
      .mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {}))
      .mockResolvedValueOnce({ id: "ap1" })
      .mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {}))
      .mockResolvedValueOnce({ id: "ap1" });
    await expect(real.cancelarItemApontamento("emp-1", registro, { id: "it1" }, "Errado", { ...c, retentativa: false })).rejects.toBeTruthy();
    await real.cancelarItemApontamento("emp-1", registro, { id: "it1" }, "Errado", { ...c, retentativa: true });
    await expect(real.cancelarApontamento("emp-1", registro, "Duplicado", { ...c, retentativa: false })).rejects.toBeTruthy();
    await real.cancelarApontamento("emp-1", registro, "Duplicado", { ...c, retentativa: true });
    const chamadas = http.nativeRequest.mock.calls;
    expect(chamadas[0][0]).toBe("/apontamentos-atividade/ap1/itens/it1/cancelar");
    expect(chamadas[0][1].body).toEqual({ empresa_id: "emp-1", versao: 2, motivo: "Errado", operation_id: expect.any(String) });
    expect(chamadas[1][1].body.operation_id).toBe(chamadas[0][1].body.operation_id);
    expect(chamadas[2][0]).toBe("/apontamentos-atividade/ap1/cancelar");
    expect(chamadas[2][1].body).toEqual({ empresa_id: "emp-1", versao: 2, motivo: "Duplicado", operation_id: expect.any(String) });
    expect(chamadas[3][1].body.operation_id).toBe(chamadas[2][1].body.operation_id);
    expect(chamadas[2][1].body.operation_id).not.toBe(chamadas[0][1].body.operation_id);
    await expect(real.cancelarItemApontamento("emp-1", registro, { id: "it1" }, " x ", c)).rejects.toMatchObject({ code: API_ERROR_CODES.INVALID_ARGUMENT });
    expect(http.nativeRequest).toHaveBeenCalledTimes(4);
  });

  it("AP-ITENS-11 — tela: lançar item envia com a versão lida, grava o detalhe da resposta no cache e relê a lista", async () => {
    await montarTelaItens();
    const pedidosDaLista = servico.listarApontamentosPagina.mock.calls.length;
    const novoItem = { ...ITEM_SERVICO_CANCELADO, id: "it3", ordem: 3, status: "CONFIRMADO", descricao: "Diária do tratorista", valor_unitario: "200.000000", valor_total: "200.0000", cancelamento: null };
    servico.adicionarItemApontamento.mockResolvedValue({
      ...REGISTRO_COM_ITENS,
      versao: 3,
      itens: [...REGISTRO_COM_ITENS.itens, novoItem],
      custo_itens: { ...CUSTO_ITENS, total: "266.4063", servico: "200.0000", itens_confirmados: 2 },
      item_id: "it3",
      replay: false,
    });
    const form = await abrirAp1();
    fireEvent.click(await within(form).findByTestId("apontamento-item-novo-servico"));
    const card = rascunho();
    fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "Diária do tratorista" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "200" } });
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await waitFor(() => expect(servico.adicionarItemApontamento).toHaveBeenCalledTimes(1));
    expect(servico.adicionarItemApontamento).toHaveBeenCalledWith(
      "emp-1",
      expect.objectContaining({ id: "ap1", versao: 2 }),
      { tipo: "SERVICO", descricao: "Diária do tratorista", quantidade: "1", valor_unitario: "200" },
      { escopo: "cli-1:gerente", retentativa: false },
    );
    // O detalhe da resposta vira o registro aberto (sem nova leitura) e o rascunho fecha.
    const atualizado = await screen.findByTestId("apontamento-item-3");
    expect(within(atualizado).getByTestId("apontamento-item-total-3").textContent).toMatch(/200,00/);
    expect(screen.queryByTestId("apontamento-item-rascunho")).toBeNull();
    expect(screen.getByTestId("apontamento-itens-custo").textContent).toMatch(/266,4063/);
    await waitFor(() => expect(servico.listarApontamentosPagina.mock.calls.length).toBeGreaterThan(pedidosDaLista));
    expect(notify.notifySuccess).toHaveBeenCalledWith("Item lançado", expect.stringMatching(/item 3.*nº 15/));
    // Sem nova leitura: a resposta (não replay) foi gravada no cache do detalhe; o detalhe foi lido só ao abrir.
    expect(servico.detalharApontamento).toHaveBeenCalledTimes(1);
  });

  it("AP-ITENS-12 — tela: cancelar item pede motivo, envia com a versão lida e mostra o item cancelado; cancelar o apontamento avisa que os itens voltam", async () => {
    await montarTelaItens();
    servico.cancelarItemApontamento.mockResolvedValue({
      ...REGISTRO_COM_ITENS,
      versao: 3,
      itens: [
        {
          ...ITEM_PRODUTO_GRAVADO,
          status: "CANCELADO",
          movimento_estorno: { id: "m2", numero: "102" },
          cancelamento: { cancelado_em: "2026-11-13T12:00:00.000Z", cancelado_por: { id: "u1", nome: "Gerente" }, motivo: "Produto errado", origem: "ITEM" },
        },
        ITEM_SERVICO_CANCELADO,
      ],
      custo_itens: { total: "0.0000", produto: "0.0000", servico: "0.0000", outro: "0.0000", itens_confirmados: 0 },
      replay: false,
    });
    const form = await abrirAp1();
    fireEvent.click(await within(form).findByTestId("apontamento-item-cancelar-1"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-item");
    expect(dialogo.textContent).toMatch(/12,5 L de Herbicida X voltam exatamente aos lotes de origem/);
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-item-motivo"), { target: { value: "Produto errado" } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-item-enviar")));
    await waitFor(() => expect(servico.cancelarItemApontamento).toHaveBeenCalledTimes(1));
    expect(servico.cancelarItemApontamento).toHaveBeenCalledWith(
      "emp-1",
      expect.objectContaining({ id: "ap1", versao: 2 }),
      expect.objectContaining({ id: "it1" }),
      "Produto errado",
      { escopo: "cli-1:gerente", retentativa: false },
    );
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-item")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("apontamento-item-1").getAttribute("data-status")).toBe("CANCELADO"));
    expect(screen.getByTestId("apontamento-item-cancelamento-1").textContent).toMatch(/voltou aos lotes de origem/);
    expect(screen.queryByTestId("apontamento-item-cancelar-1")).toBeNull();
    expect(notify.notifySuccess).toHaveBeenCalledWith("Item cancelado", expect.stringMatching(/12,5 L devolvidos aos lotes de origem/));
  });

  it("AP-ITENS-13 — tela: estorno bloqueado no cancelamento do apontamento diz o motivo e o item (nada muda); depois, o detalhe cancelado vira o registro aberto", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const CODE = "APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO";
    servico.cancelarApontamento
      .mockRejectedValueOnce(
        new ApiError(API_ERROR_CODES[CODE], { cause: { code: CODE, field: "item_id", reason: "unidade_mudou", details: { item_id: "it1", item_ordem: 1, field: "item_id", reason: "unidade_mudou" } } }),
      )
      .mockResolvedValueOnce({ ...CANCELADO_COM_ITENS, id: "ap1", numero: "15", versao: 3, replay: false });
    await montarTelaItens();
    await abrirAp1();
    fireEvent.click(await screen.findByTestId("apontamento-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
    expect(dialogo.textContent).toMatch(/os itens de produto voltam ao estoque/);
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "Lançado em duplicidade" } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
    await waitFor(() =>
      expect(notify.notifyWarning).toHaveBeenCalledWith(
        "Atenção",
        "O estorno exato do estoque não é seguro agora no item 1: a unidade de estoque do Produto mudou desde o lançamento. Nada foi alterado.",
      ),
    );
    expect(within(dialogo).getByTestId("erro-envio").textContent).toMatch(/estorno exato do estoque não é seguro/);
    expect(screen.getByTestId("dialogo-cancelar-apontamento")).toBeTruthy();
    expect(notify.notifySuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("apontamento-item-1").getAttribute("data-status")).toBe("CONFIRMADO");

    // Resolvido o bloqueio, o cancelamento passa: a resposta (o detalhe) vira o registro aberto, só leitura.
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    expect(servico.cancelarApontamento.mock.calls[1][3]).toEqual({ escopo: "cli-1:gerente", retentativa: false });
    expect(await screen.findByTestId("apontamento-cancelado")).toBeTruthy();
    expect(screen.getByTestId("apontamento-item-cancelamento-1").textContent).toMatch(/Cancelado junto com o apontamento/);
    expect(notify.notifySuccess).toHaveBeenCalledWith("Apontamento cancelado", expect.stringMatching(/nº 15.*voltaram aos lotes de origem/));
  });

  it("AP-ITENS-14 — Serviço e Outro custo sem resposta: o aviso de resultado incerto não fala em estoque; consultar e repetir continuam", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const onAdicionarItem = vi.fn().mockRejectedValue(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {}));
    const onConsultarItem = vi.fn(async () => "O item ainda não aparece gravado. Repita o mesmo envio: ele não duplica.");
    const { form } = montar({ initialData: REGISTRO_COM_ITENS, readOnly: true, podeLancarItens: true, onAdicionarItem, onConsultarItem });
    for (const [botao, tipo] of [
      ["apontamento-item-novo-servico", "SERVICO"],
      ["apontamento-item-novo-outro", "OUTRO"],
    ]) {
      fireEvent.click(within(form).getByTestId(botao));
      const card = rascunho();
      expect(card.getAttribute("data-tipo")).toBe(tipo);
      fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "Frete" } });
      fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
      fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "150" } });
      const chamadas = onAdicionarItem.mock.calls.length;
      fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
      const aviso = await within(card).findByTestId("resultado-incerto");
      expect(aviso.textContent).toMatch(/o item PODE ter sido gravado/);
      expect(aviso.textContent).toMatch(/o item não é\s+lançado duas vezes/);
      expect(aviso.textContent).not.toMatch(/estoque/i);
      // O bloco repetido tem o "Consultar" e o "Repetir o mesmo envio" (a retentativa reaproveita a chave).
      fireEvent.click(within(aviso).getByTestId("botao-consultar-resultado"));
      expect((await within(card).findByTestId("consulta-resultado")).textContent).toMatch(/ainda não aparece gravado/);
      expect(onConsultarItem).toHaveBeenLastCalledWith(2);
      fireEvent.click(within(card).getByTestId("botao-repetir-envio"));
      await waitFor(() => expect(onAdicionarItem).toHaveBeenCalledTimes(chamadas + 2));
      expect(onAdicionarItem.mock.calls[chamadas][1]).toEqual({ retentativa: false });
      expect(onAdicionarItem.mock.calls[chamadas + 1][1]).toEqual({ retentativa: true });
      expect(onAdicionarItem.mock.calls[chamadas + 1][0]).toEqual(onAdicionarItem.mock.calls[chamadas][0]);
      await within(card).findByTestId("resultado-incerto");
      await waitFor(() => expect(within(card).getByTestId("apontamento-item-descartar")).not.toBeDisabled());
      fireEvent.click(within(card).getByTestId("apontamento-item-descartar"));
      await waitFor(() => expect(screen.queryByTestId("apontamento-item-rascunho")).toBeNull());
    }
  });

  it("AP-ITENS-15 — card do item gravado: descrição, Produto e local aparecem inteiros, quebrando linha (nada cortado)", () => {
    const produtoLongo = "Herbicida seletivo pós-emergente para pastagens de braquiária e capim-mombaça, galão de vinte litros";
    const localLongo = "Depósito central de defensivos agrícolas da sede, prateleira três, ao lado do galpão de máquinas";
    const descricaoLonga = `Mão de obra terceirizada da roçada ${"no talhão norte e no talhão sul ".repeat(5)}com o trator da fazenda vizinha`;
    expect(descricaoLonga.length).toBeLessThanOrEqual(255);
    const registro = {
      ...REGISTRO_COM_ITENS,
      itens: [
        { ...ITEM_PRODUTO_GRAVADO, produto: { ...ITEM_PRODUTO_GRAVADO.produto, nome: produtoLongo }, local_estoque: { id: "l1", nome: localLongo } },
        { ...ITEM_SERVICO_CANCELADO, descricao: descricaoLonga },
      ],
    };
    const { form } = montar({ initialData: registro, readOnly: true });
    for (const texto of [produtoLongo, localLongo, descricaoLonga]) {
      const el = within(form).getByText(texto);
      // O texto inteiro, num bloco que quebra linha; nenhum ancestral com truncate (o do ValorCalculado).
      expect(el.textContent).toBe(texto);
      expect(el.closest(".truncate")).toBeNull();
      expect(el.closest(".break-words")).not.toBeNull();
    }
    expect(within(form).getByTestId("apontamento-item-produto-1").textContent).toBe(`Produto: ${produtoLongo}`);
    expect(within(form).getByTestId("apontamento-item-local-1").textContent).toBe(`Local do estoque: ${localLongo}`);
    expect(within(form).getByTestId("apontamento-item-descricao-2").textContent).toBe(`Descrição: ${descricaoLonga}`);
  });

  it("AP-ITENS-16 — D-1, caso negativo: em edição só com Serviço, ou com o item de Produto já cancelado, a data fica editável e vai no corpo", () => {
    const servicoConfirmado = { ...ITEM_SERVICO_CANCELADO, status: "CONFIRMADO", cancelamento: null };
    const produtoCancelado = {
      ...ITEM_PRODUTO_GRAVADO,
      status: "CANCELADO",
      movimento_estorno: { id: "m2", numero: "102" },
      cancelamento: { cancelado_em: "2026-11-12T13:00:00.000Z", cancelado_por: { id: "u1", nome: "Gerente" }, motivo: "Produto errado", origem: "ITEM" },
    };
    for (const itens of [[servicoConfirmado], [produtoCancelado], [produtoCancelado, servicoConfirmado]]) {
      const { form, onSubmit } = montar({ initialData: { ...REGISTRO, itens, custo_itens: CUSTO_ZERO }, readOnly: false });
      const data = within(form).getByTestId("apontamento-data");
      expect(data.readOnly).toBe(false);
      expect(within(form).queryByTestId("apontamento-data-travada")).toBeNull();
      fireEvent.change(data, { target: { value: "2026-11-09" } });
      expect(within(form).getByTestId("apontamento-data").value).toBe("2026-11-09");
      enviar();
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ data_operacional: "2026-11-09" });
      cleanup();
    }
  });

  it("AP-ITENS-17 — D-3 na tela: sem editar e com cancelar, só cancela (item e apontamento); com editar e sem cancelar, só lança", async () => {
    const original = sessao.acoes;
    try {
      sessao.acoes = { ...original, editar: false, cancelar: true };
      await montarTelaItens();
      let form = await abrirAp1();
      // Cancelar item e Cancelar apontamento aparecem (o fuso e os itens já chegaram); nada de lançar nem de Editar.
      expect(await within(form).findByTestId("apontamento-item-cancelar-1")).toBeTruthy();
      expect(within(form).getByTestId("apontamento-cancelar")).toBeTruthy();
      expect(within(form).queryByTestId("apontamento-itens-acoes")).toBeNull();
      expect(within(form).queryByTestId("apontamento-item-novo-produto")).toBeNull();
      expect(within(form).queryByTestId("apontamento-item-novo-servico")).toBeNull();
      expect(within(form).queryByTestId("apontamento-item-novo-outro")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Editar$/ })).toBeNull();
      cleanup();

      sessao.acoes = { ...original, editar: true, cancelar: false };
      await montarTelaItens();
      form = await abrirAp1();
      // Editar aparece (o fuso chegou): a falta dos botões de cancelar é só da ação.
      expect(await screen.findByRole("button", { name: /^Editar$/ })).toBeTruthy();
      expect(within(form).getByTestId("apontamento-itens-acoes")).toBeTruthy();
      expect(within(form).getByTestId("apontamento-item-novo-produto")).toBeTruthy();
      expect(within(form).getByTestId("apontamento-item-novo-servico")).toBeTruthy();
      expect(within(form).getByTestId("apontamento-item-novo-outro")).toBeTruthy();
      expect(within(form).queryByTestId("apontamento-item-cancelar-1")).toBeNull();
      expect(within(form).queryByTestId("apontamento-cancelar")).toBeNull();
    } finally {
      sessao.acoes = original;
    }
  });

  it("AP-ITENS-18 — tela + service REAL (só o HTTP falso): item sem resposta → 'Repetir o mesmo envio' manda o MESMO operation_id, sem perguntar nada", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const real = await vi.importActual("@/services/apontamentoAtividadeService");
    servico.adicionarItemApontamento.mockImplementation(real.adicionarItemApontamento);
    // Sem o host de avisos, `confirmar` cai no window.confirm: qualquer pergunta ("Enviar como novo"?) apareceria aqui.
    const pergunta = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const item3 = { ...ITEM_SERVICO_CANCELADO, id: "it3", ordem: 3, status: "CONFIRMADO", descricao: "Frete", cancelamento: null };
    const v3 = { ...REGISTRO_COM_ITENS, versao: 3, itens: [...REGISTRO_COM_ITENS.itens, item3], custo_itens: { ...CUSTO_ITENS, total: "216.4063", servico: "150.0000", itens_confirmados: 2 } };
    http.nativeRequest.mockReset();
    http.nativeRequest.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {})).mockResolvedValueOnce({ ...v3, item_id: "it3", replay: true });
    await montarTelaItens();
    const form = await abrirAp1();
    servico.detalharApontamento.mockResolvedValue(v3);
    fireEvent.click(await within(form).findByTestId("apontamento-item-novo-servico"));
    const card = rascunho();
    fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "Frete" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "150" } });
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await within(card).findByTestId("resultado-incerto");
    fireEvent.click(within(card).getByTestId("botao-repetir-envio"));
    await waitFor(() => expect(http.nativeRequest).toHaveBeenCalledTimes(2));
    const [primeiro, segundo] = http.nativeRequest.mock.calls;
    expect(primeiro[0]).toBe("/apontamentos-atividade/ap1/itens");
    expect(primeiro[1]).toMatchObject({ method: "POST" });
    expect(primeiro[1].body).toEqual({
      tipo: "SERVICO",
      descricao: "Frete",
      quantidade: "1",
      valor_unitario: "150",
      empresa_id: "emp-1",
      versao: 2,
      operation_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/),
    });
    expect(segundo[0]).toBe(primeiro[0]);
    expect(segundo[1].body).toEqual(primeiro[1].body);
    expect(pergunta).not.toHaveBeenCalled();
    expect(await screen.findByTestId("apontamento-item-3")).toBeTruthy();
    expect(notify.notifySuccess).toHaveBeenCalledWith("Item lançado", expect.stringMatching(/envio repetido: nada foi duplicado/));
  });

  it("AP-ITENS-19 — tela + service REAL: cancelar o apontamento sem resposta → repetir manda o MESMO operation_id (D-2)", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const real = await vi.importActual("@/services/apontamentoAtividadeService");
    servico.cancelarApontamento.mockImplementation(real.cancelarApontamento);
    const pergunta = vi.spyOn(window, "confirm").mockImplementation(() => true);
    http.nativeRequest.mockReset();
    http.nativeRequest.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {})).mockResolvedValueOnce({ ...AP1_CANCELADO, replay: true });
    await montarTelaItens();
    await abrirAp1();
    servico.detalharApontamento.mockResolvedValue(AP1_CANCELADO);
    fireEvent.click(await screen.findByTestId("apontamento-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "Lançado em duplicidade" } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
    await within(dialogo).findByTestId("resultado-incerto");
    expect(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar").textContent).toMatch(/Repetir o mesmo envio/);
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
    await waitFor(() => expect(http.nativeRequest).toHaveBeenCalledTimes(2));
    const [primeiro, segundo] = http.nativeRequest.mock.calls;
    expect(primeiro[0]).toBe("/apontamentos-atividade/ap1/cancelar");
    expect(primeiro[1].body).toEqual({ empresa_id: "emp-1", versao: 2, motivo: "Lançado em duplicidade", operation_id: expect.stringMatching(/^[A-Za-z0-9_.:-]{8,128}$/) });
    expect(segundo[1].body).toEqual(primeiro[1].body);
    expect(pergunta).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Apontamento cancelado", expect.stringMatching(/voltaram aos lotes de origem.*envio repetido: nada foi duplicado/));
  });

  it("AP-ITENS-20 — recusa ITEM_STATUS_INVALIDO (cancelar item) e VERSAO_CONFLITO (lançar item): a tela relê o detalhe", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const recusa = (code, extra = {}) => new ApiError(API_ERROR_CODES[code] ?? API_ERROR_CODES.OPERATION_FAILED, { cause: { code, ...extra } });
    servico.cancelarItemApontamento.mockRejectedValueOnce(recusa("APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO", { details: { status: "CANCELADO" } }));
    servico.adicionarItemApontamento.mockRejectedValueOnce(recusa("APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO", { details: { versao_atual: 3, versao_enviada: 2 } }));
    await montarTelaItens();
    const form = await abrirAp1();
    expect(servico.detalharApontamento).toHaveBeenCalledTimes(1);

    // O item já foi cancelado por outra pessoa: recusa definitiva, e o detalhe é relido.
    fireEvent.click(await within(form).findByTestId("apontamento-item-cancelar-1"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-item");
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-item-motivo"), { target: { value: "Produto errado" } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-item-enviar")));
    await waitFor(() => expect(servico.detalharApontamento).toHaveBeenCalledTimes(2));
    expect(servico.detalharApontamento).toHaveBeenLastCalledWith("emp-1", "ap1");
    expect((await within(dialogo).findByTestId("erro-envio")).textContent).toMatch(/Este item já foi cancelado/);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-item")).toBeNull());

    // Lançar com a versão velha: o servidor recusa o CAS e o detalhe é relido de novo.
    fireEvent.click(await screen.findByTestId("apontamento-item-novo-servico"));
    const card = rascunho();
    fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "Frete" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "150" } });
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await waitFor(() => expect(servico.detalharApontamento).toHaveBeenCalledTimes(3));
    expect(servico.adicionarItemApontamento).toHaveBeenCalledTimes(1);
  });

  it("AP-ITENS-21 — replay: a resposta é o recibo gravado (pode ser mais velho que o servidor); a tela relê o detalhe em vez de gravar o recibo no cache", async () => {
    await montarTelaItens();
    const form = await abrirAp1();
    expect(servico.detalharApontamento).toHaveBeenCalledTimes(1);
    // O recibo (v3) traz o item 3; depois dele outra pessoa cancelou o item 1 (v4, o que o servidor tem agora).
    const item3 = { ...ITEM_SERVICO_CANCELADO, id: "it3", ordem: 3, status: "CONFIRMADO", descricao: "Diária do tratorista", valor_unitario: "200.000000", valor_total: "200.0000", cancelamento: null };
    const recibo = {
      ...REGISTRO_COM_ITENS,
      versao: 3,
      itens: [...REGISTRO_COM_ITENS.itens, item3],
      custo_itens: { ...CUSTO_ITENS, total: "266.4063", servico: "200.0000", itens_confirmados: 2 },
      item_id: "it3",
      replay: true,
    };
    const v4 = {
      ...REGISTRO_COM_ITENS,
      versao: 4,
      itens: [
        { ...ITEM_PRODUTO_GRAVADO, status: "CANCELADO", movimento_estorno: { id: "m2", numero: "102" }, cancelamento: { ...ITEM_SERVICO_CANCELADO.cancelamento, motivo: "Produto errado" } },
        ITEM_SERVICO_CANCELADO,
        item3,
      ],
      custo_itens: { total: "200.0000", produto: "0.0000", servico: "200.0000", outro: "0.0000", itens_confirmados: 1 },
    };
    servico.detalharApontamento.mockResolvedValue(v4);
    servico.adicionarItemApontamento.mockResolvedValue(recibo);
    fireEvent.click(await within(form).findByTestId("apontamento-item-novo-servico"));
    const card = rascunho();
    fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "Diária do tratorista" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
    fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "200" } });
    fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
    await waitFor(() => expect(servico.adicionarItemApontamento).toHaveBeenCalledTimes(1));
    // O detalhe É relido, e a tela mostra o que o servidor tem agora (item 1 cancelado), não o recibo.
    await waitFor(() => expect(servico.detalharApontamento).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("apontamento-item-1").getAttribute("data-status")).toBe("CANCELADO"));
    expect(screen.getByTestId("apontamento-item-3")).toBeTruthy();
    expect(screen.getByTestId("apontamento-itens-custo").textContent).toMatch(/R\$\s*200,00/);
    expect(notify.notifySuccess).toHaveBeenCalledWith("Item lançado", expect.stringMatching(/item 3.*envio repetido: nada foi duplicado/));
  });

  it("AP-ITENS-22 — detalhe ainda não chegou: sem 'Cancelar apontamento'; quando chega, o botão aparece, o diálogo avisa dos itens e a devolução relê estoque e Mapa", async () => {
    await montarTelaItens();
    let entregar = () => {};
    servico.detalharApontamento.mockImplementation(
      () =>
        new Promise((resolve) => {
          entregar = () => resolve(REGISTRO_COM_ITENS);
        }),
    );
    servico.cancelarApontamento.mockResolvedValue({ ...AP1_CANCELADO, replay: false });
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    await within(form).findByTestId("apontamento-itens-carregando");
    // O fuso chegou (Editar aparece): a falta do botão é só dos itens desconhecidos.
    expect(await screen.findByRole("button", { name: /^Editar$/ })).toBeTruthy();
    expect(screen.queryByTestId("apontamento-cancelar")).toBeNull();
    await act(async () => entregar());
    fireEvent.click(await screen.findByTestId("apontamento-cancelar"));
    const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
    expect(dialogo.textContent).toMatch(/Os itens são cancelados junto: os itens de produto voltam ao estoque/);
    fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "Lançado em duplicidade" } });
    await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Apontamento cancelado", expect.stringMatching(/voltaram aos lotes de origem/));
    expect(mapa.refreshMapaCacheEntry).toHaveBeenCalledWith("estoqueLotes", "emp-1", { force: true });
    expect(mapa.refreshMapaCacheEntry).toHaveBeenCalledWith("movimentacaoEstoque", "emp-1", { force: true });
  });

  it("AP-ITENS-23 — detalhe com erro: sem 'Cancelar apontamento'; 'Tentar novamente' lê o detalhe e o botão volta", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    await montarTelaItens();
    servico.detalharApontamento.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {}));
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    const erro = await within(form).findByTestId("apontamento-itens-erro");
    expect(await screen.findByRole("button", { name: /^Editar$/ })).toBeTruthy();
    expect(screen.queryByTestId("apontamento-cancelar")).toBeNull();
    fireEvent.click(within(erro).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByTestId("apontamento-cancelar")).toBeTruthy();
    expect(screen.getByTestId("apontamento-item-1")).toBeTruthy();
    expect(servico.detalharApontamento).toHaveBeenCalledTimes(2);
  });

  it("AP-ITENS-24 — a devolução ao estoque é decidida pela RESPOSTA do cancelamento e, no 'Consultar', pelo detalhe relido", async () => {
    const { ApiError, API_ERROR_CODES } = await import("@/apis/_core/ApiError.js");
    const cancelarAp1 = async () => {
      fireEvent.click(await screen.findByTestId("apontamento-cancelar"));
      const dialogo = await screen.findByTestId("dialogo-cancelar-apontamento");
      // Itens conhecidos e nenhum confirmado: o diálogo não promete devolução.
      expect(dialogo.textContent).not.toMatch(/voltam ao estoque/);
      fireEvent.change(within(dialogo).getByTestId("dialogo-cancelar-apontamento-motivo"), { target: { value: "Lançado em duplicidade" } });
      await act(async () => fireEvent.click(within(dialogo).getByTestId("dialogo-cancelar-apontamento-enviar")));
      return dialogo;
    };

    // Envio respondido: o registro aberto não tinha Produto, mas a resposta tem Produto devolvido (origem APONTAMENTO).
    await montarTelaItens();
    servico.detalharApontamento.mockResolvedValue(AP1_SEM_ITENS);
    servico.cancelarApontamento.mockResolvedValueOnce({ ...AP1_CANCELADO, replay: false });
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    await screen.findByTestId("apontamento-itens-vazio");
    await cancelarAp1();
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Apontamento cancelado", expect.stringMatching(/voltaram aos lotes de origem/));
    expect(mapa.refreshMapaCacheEntry).toHaveBeenCalledWith("estoqueLotes", "emp-1", { force: true });
    cleanup();
    notify.notifySuccess.mockClear();
    mapa.refreshMapaCacheEntry.mockClear();

    // Envio sem resposta + "Consultar": o detalhe relido (CANCELADO, com o Produto devolvido) decide.
    await montarTelaItens();
    servico.detalharApontamento.mockResolvedValue(AP1_SEM_ITENS);
    servico.cancelarApontamento.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {}));
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    await screen.findByTestId("apontamento-itens-vazio");
    const dialogo = await cancelarAp1();
    await within(dialogo).findByTestId("resultado-incerto");
    expect(mapa.refreshMapaCacheEntry).not.toHaveBeenCalled();
    servico.detalharApontamento.mockResolvedValue(AP1_CANCELADO);
    await act(async () => fireEvent.click(within(dialogo).getByTestId("botao-consultar-resultado")));
    await waitFor(() => expect(screen.queryByTestId("dialogo-cancelar-apontamento")).toBeNull());
    expect(servico.limparPendenciaDoApontamento).toHaveBeenCalledWith("cli-1:gerente", "cancelar", "emp-1", "ap1");
    expect(notify.notifySuccess).toHaveBeenCalledWith("Apontamento cancelado", expect.stringMatching(/voltaram aos lotes de origem/));
    expect(mapa.refreshMapaCacheEntry).toHaveBeenCalledWith("estoqueLotes", "emp-1", { force: true });
  });

  it("AP-ITENS-25 — D-1 antes de o detalhe chegar: a edição abre com a data travada na gravada (nenhuma mudança entra); com o detalhe, segue travada e o PATCH leva a data gravada", async () => {
    await montarTelaItens();
    let entregar = () => {};
    servico.detalharApontamento.mockImplementation(
      () =>
        new Promise((resolve) => {
          entregar = () => resolve(REGISTRO_COM_ITENS);
        }),
    );
    servico.atualizarApontamento.mockResolvedValue({ alterado: true, registro: { ...REGISTRO, versao: 3 } });
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    await screen.findByTestId("b1-form-apontamento-atividade");
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/ }));
    let form = await screen.findByTestId("b1-form-apontamento-atividade");
    await waitFor(() => expect(form.hasAttribute("data-somente-leitura")).toBe(false));
    expect(within(form).getByTestId("apontamento-itens-carregando")).toBeTruthy();
    const data = within(form).getByTestId("apontamento-data");
    expect(data.readOnly).toBe(true);
    expect(within(form).getByTestId("apontamento-data-travada").textContent).toMatch(/até os itens do apontamento serem lidos/);
    // Mesmo um evento de mudança que chegue ao campo não muda a data.
    fireEvent.change(data, { target: { value: "2026-11-09" } });
    expect(within(form).getByTestId("apontamento-data").value).toBe("2026-11-10");
    await act(async () => entregar());
    form = screen.getByTestId("b1-form-apontamento-atividade");
    await waitFor(() => expect(within(form).getByTestId("apontamento-data-travada").textContent).toMatch(/item de Produto lançado/));
    expect(within(form).getByTestId("apontamento-data").readOnly).toBe(true);
    expect(within(form).getByTestId("apontamento-data").value).toBe("2026-11-10");
    fireEvent.submit(document.getElementById(FORMULARIO_APONTAMENTO_ATIVIDADE_ID));
    await waitFor(() => expect(servico.atualizarApontamento).toHaveBeenCalledTimes(1));
    expect(servico.atualizarApontamento.mock.calls[0][2]).toMatchObject({ data_operacional: "2026-11-10" });
  });

  it("AP-ITENS-26 — sem fuso da fazenda: nem Editar, nem Cancelar apontamento, nem Cancelar item (o servidor exige o fuso para estornar); o aviso cita o cancelamento", async () => {
    empresas.fuso = null;
    await montarTelaItens();
    expect((await screen.findByTestId("apontamento-sem-fuso")).textContent).toMatch(/lançar, editar ou cancelar apontamentos e de cancelar itens/);
    const form = await abrirAp1();
    // Lançar item não usa o "hoje" da fazenda (o servidor não exige o fuso): continua.
    expect(within(form).getByTestId("apontamento-itens-acoes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Editar$/ })).toBeNull();
    expect(within(form).queryByTestId("apontamento-cancelar")).toBeNull();
    expect(within(form).queryByTestId("apontamento-item-cancelar-1")).toBeNull();
  });

  it("AP-ITENS-27 — resposta que chega depois de trocar de empresa: vai para o cache do detalhe da empresa anterior; no replay, o detalhe só é invalidado (o recibo não o sobrescreve)", async () => {
    const chave = ["apontamentos-atividade", "detalhe", "emp-1", "ap1"];
    const item3 = { ...ITEM_SERVICO_CANCELADO, id: "it3", ordem: 3, status: "CONFIRMADO", descricao: "Frete", cancelamento: null };
    const v3 = { ...REGISTRO_COM_ITENS, versao: 3, itens: [...REGISTRO_COM_ITENS.itens, item3], item_id: "it3" };
    try {
      for (const replay of [false, true]) {
        servico.adicionarItemApontamento.mockClear();
        notify.notifySuccess.mockClear();
        sessao.empresaId = "emp-1";
        let responder = () => {};
        servico.adicionarItemApontamento.mockImplementation(
          () =>
            new Promise((resolve) => {
              responder = () => resolve({ ...v3, replay });
            }),
        );
        const { cliente, redesenhar } = await montarTelaItens();
        const form = await abrirAp1();
        fireEvent.click(await within(form).findByTestId("apontamento-item-novo-servico"));
        const card = rascunho();
        fireEvent.change(within(card).getByLabelText(/Descrição/), { target: { value: "Frete" } });
        fireEvent.change(within(card).getByTestId("apontamento-item-quantidade"), { target: { value: "1" } });
        fireEvent.change(within(card).getByTestId("apontamento-item-valor-unitario"), { target: { value: "150" } });
        fireEvent.click(within(card).getByTestId("apontamento-item-lancar"));
        await waitFor(() => expect(servico.adicionarItemApontamento).toHaveBeenCalledTimes(1));
        // Troca de empresa com o envio em curso: o registro da empresa anterior fecha.
        sessao.empresaId = "emp-2";
        redesenhar();
        await waitFor(() => expect(screen.queryByTestId("b1-form-apontamento-atividade")).toBeNull());
        await act(async () => responder());
        await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Item lançado", expect.stringMatching(/nº 15/)));
        if (replay) {
          // O recibo (gravado no servidor) pode ser mais velho: o cache da empresa anterior fica como estava, marcado para reler.
          expect(cliente.getQueryData(chave)).toEqual(REGISTRO_COM_ITENS);
          expect(cliente.getQueryState(chave)?.isInvalidated).toBe(true);
        } else {
          expect(cliente.getQueryData(chave)).toEqual({ ...v3, replay: false });
          expect(cliente.getQueryState(chave)?.isInvalidated).toBe(false);
        }
        // Nada da empresa anterior aparece na empresa nova.
        expect(screen.queryByTestId("apontamento-item-3")).toBeNull();
        cleanup();
      }
    } finally {
      sessao.empresaId = "emp-1";
    }
  });

  /** Tela com o detalhe (itens) do ap1. Devolve o QueryClient (para ler o cache) e o `rerender`. */
  async function montarTelaItens() {
    servico.listarTiposAtividade.mockResolvedValue(TIPOS);
    servico.listarAreasDoApontamento.mockResolvedValue(AREAS);
    servico.listarApontamentosPagina.mockResolvedValue({ items: [REGISTRO, CANCELADO], next_cursor: null, has_more: false, total: 2, limit: 100 });
    servico.detalharApontamento.mockImplementation(async (_emp, id) => (id === "ap1" ? REGISTRO_COM_ITENS : CANCELADO_COM_ITENS));
    const { default: ApontamentosAtividade } = await import("@/pages/ApontamentosAtividade");
    const cliente = novoCliente();
    const arvore = () => (
      <QueryClientProvider client={cliente}>
        <ApontamentosAtividade />
      </QueryClientProvider>
    );
    const { rerender } = render(arvore());
    await screen.findByTestId("apontamento-numero-ap1");
    return { cliente, redesenhar: () => rerender(arvore()) };
  }

  /** Abre o ap1 e espera os itens do DETALHE. */
  async function abrirAp1() {
    fireEvent.doubleClick(screen.getByTestId("apontamento-numero-ap1"));
    const form = await screen.findByTestId("b1-form-apontamento-atividade");
    await within(form).findByTestId("apontamento-item-1");
    expect(servico.detalharApontamento).toHaveBeenCalledWith("emp-1", "ap1");
    return form;
  }
});

describe("AP-MENU — rota, menu, ícone, manifesto e paridade com o servidor", () => {
  it("AP-MENU-1 — página registrada, no manifesto e no menu logo abaixo de Tipos de Atividade", async () => {
    const { PAGES } = await import("@/pages.config.js");
    const { DEFAULT_MENU, findMenuItemByUrl } = await import("@/lib/menuConfig");
    const { ICONE_TELA } = await import("@/components/navigation/MobileModulesView");
    expect(PAGES.ApontamentosAtividade).toBeTruthy();
    const scope = JSON.parse(readFileSync("config/mapa-manejo-scope.json", "utf8"));
    expect(scope.allowedPages).toContain("ApontamentosAtividade");
    const item = findMenuItemByUrl(DEFAULT_MENU, "ApontamentosAtividade");
    expect(item?.id).toBe("op-apontamentos-atividade");
    const grupo = DEFAULT_MENU.find((m) => m.id === item.moduleId);
    const ids = grupo.submenu.map((s) => s.id);
    expect(ids.indexOf("op-apontamentos-atividade")).toBe(ids.indexOf("sup-tipos-atividade") + 1);
    expect(ICONE_TELA.ApontamentosAtividade).toBe(lucide.ClipboardCheck);
    expect(ICONE_TELA.ApontamentosAtividade).not.toBe(ICONE_TELA.TiposAtividade);
  });

  it("AP-MENU-2 — o par módulo × tela do menu é o mesmo que o servidor confere (TELAS em autorizacaoTela.js)", async () => {
    const { MODULO_APONTAMENTOS_ATIVIDADE, TELA_APONTAMENTOS_ATIVIDADE } = await import("@/lib/apontamentoAtividadePermissions");
    const servidor = readFileSync("backend/src/shared/auth/autorizacaoTela.js", "utf8");
    const linha = servidor.split("\n").find((l) => l.includes(`tela: '${TELA_APONTAMENTOS_ATIVIDADE}'`));
    expect(linha, "tela op-apontamentos-atividade ausente em autorizacaoTela.js").toBeTruthy();
    expect(linha).toContain(`modulo: '${MODULO_APONTAMENTOS_ATIVIDADE}'`);
  });

  it("AP-MENU-3 — ações da tela espelham os guardas do servidor (cancelar = excluir)", async () => {
    const { acoesDaTelaApontamento, MODULO_APONTAMENTOS_ATIVIDADE, TELA_APONTAMENTOS_ATIVIDADE } = await import(
      "@/lib/apontamentoAtividadePermissions"
    );
    const registro = (acoes) => ({
      user_email: "vaqueiro",
      is_admin: false,
      modulos_permitidos: [MODULO_APONTAMENTOS_ATIVIDADE],
      permissoes_telas: [{ modulo_id: MODULO_APONTAMENTOS_ATIVIDADE, tela_id: TELA_APONTAMENTOS_ATIVIDADE, visualizar: true, ...acoes }],
    });
    expect(acoesDaTelaApontamento(null)).toEqual({ ver: false, criar: false, editar: false, cancelar: false });
    expect(acoesDaTelaApontamento(registro({}))).toEqual({ ver: true, criar: false, editar: false, cancelar: false });
    expect(acoesDaTelaApontamento(registro({ salvar: true }))).toEqual({ ver: true, criar: true, editar: true, cancelar: false });
    expect(acoesDaTelaApontamento(registro({ excluir: true })).cancelar).toBe(true);
    expect(acoesDaTelaApontamento({ user_email: "x", is_admin: true })).toEqual({ ver: true, criar: true, editar: true, cancelar: true });
    const guardas = readFileSync("backend/src/shared/auth/guardasRotas.js", "utf8");
    expect(guardas).toMatch(/cancelar: cadastro\(T\.APONTAMENTOS_ATIVIDADE\)\.excluir/);
  });
});
