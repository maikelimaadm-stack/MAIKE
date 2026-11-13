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
 *    paridade módulo × tela com o servidor.
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
}));
vi.mock("@/services/apontamentoAtividadeService", () => servico);

const sessao = vi.hoisted(() => ({
  acoes: { ver: true, criar: true, editar: true, cancelar: true, carregando: false, login: "gerente" },
}));
vi.mock("@/hooks/useApontamentoAtividadeSessao", () => ({
  useEmpresaRealSelecionadaId: () => "emp-1",
  useAcoesTelaApontamento: () => sessao.acoes,
}));
vi.mock("@/services/empresaService", () => ({
  listEmpresas: vi.fn(async () => [{ id: "emp-1", nome: "FAZENDA", fuso_horario: "America/Cuiaba" }]),
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
    expect(servico.cancelarApontamento).toHaveBeenCalledWith("emp-1", expect.objectContaining({ id: "ap1", versao: 2 }), "Erro de digitação");
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
