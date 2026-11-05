/**
 * R1 — correção da ENTRADA original pelo Cadastro de Lotes (navegador).
 * A elegibilidade é do servidor; o formulário só calcula o que mudou e envia
 * pelo comando de correção (nunca pelo PATCH genérico). Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import * as correcaoEntrada from "@/domain/lotes/correcaoEntrada";
import { camposDaCorrecaoDeEntrada, camposAdministrativosAlterados, somenteCamposAlterados, CAMPOS_FORA_DO_PATCH, mensagemDoMotivoCorrecao } from "@/domain/lotes/correcaoEntrada";

const ENTRADA = Object.freeze({
  id: "l9", numero_lote: "9", nome: "NOVO", origem: "COMPRA", motivo_entrada: "Compra", empresa_id: "emp-1", status: "Ativo",
  quantidade_entrada: 40, quantidade_cabecas: 40, peso_entrada_kg: 300, peso_medio_kg: 300, data_entrada: "2026-10-25",
  categoria: "BOI", categoria_entrada: "BOI", sexo: "Macho", setor_id: "s1", area_entrada_id: "a1", area_atual_id: "a1",
  updated_date: "2026-11-05T10:00:00.000Z",
});

describe("R1 domínio — o que a correção muda", () => {
  it("só os campos da entrada que mudaram; vazio = sem valor", () => {
    const form = { quantidade_cabecas: "40", peso_medio_kg: "300", data_entrada: "2026-10-25", categoria: "BOI", sexo: "Macho", setor_id: "s1", area_entrada_id: "a1" };
    expect(camposDaCorrecaoDeEntrada(ENTRADA, form)).toEqual({});
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, quantidade_cabecas: "120", peso_medio_kg: "310", data_entrada: "2026-10-20", area_entrada_id: "a2" })).toEqual({
      quantidade: 120, peso_entrada_kg: 310, data_entrada: "2026-10-20", area_entrada_id: "a2",
    });
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, peso_medio_kg: "" })).toEqual({ peso_entrada_kg: null });
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, categoria: "VACA", sexo: "Fêmea" })).toEqual({ categoria: "VACA", sexo: "Fêmea" });
  });

  it("PATCH de edição: só o que mudou e NUNCA campo da entrada/saldo (nem status igual)", () => {
    const p = somenteCamposAlterados(ENTRADA, { ...ENTRADA, nome: "NOVO NOME", quantidade_cabecas: 99, data_entrada: "2026-01-01", status: "Ativo" });
    expect(p).toEqual({ nome: "NOVO NOME" });
    for (const c of CAMPOS_FORA_DO_PATCH) expect(p).not.toHaveProperty(c);
    expect(somenteCamposAlterados(ENTRADA, { ...ENTRADA, status: "Inativo" })).toEqual({ status: "Inativo" });
  });

  it("R1-R2: administrativos alterados sem diferença espúria (vazio ≠ 0, texto aparado, tipos canônicos)", () => {
    const lote = { ...ENTRADA, raca_predominante: "NELORE", idade_media_meses: null, valor_total_compra: null, observacoes: null, campos_personalizados: { a: 1 } };
    const dados = { nome: "NOVO", raca_predominante: " NELORE ", idade_media_meses: 0, valor_total_compra: 0, observacoes: "", campos_personalizados: { a: 1 } };
    expect(camposAdministrativosAlterados(lote, dados, { idade_media_meses: "", valor_total_compra: "" })).toEqual({});
    expect(camposAdministrativosAlterados(lote, { ...dados, raca_predominante: "ANGUS", observacoes: "X" }, { idade_media_meses: "12", valor_total_compra: "1500.5" })).toEqual({
      raca_predominante: "ANGUS", observacoes: "X", idade_media_meses: 12, valor_total_compra: 1500.5,
    });
  });

  it("R3: quantidade digitada nunca é truncada — 100.5 / 100abc / 0 / vazio são inválidos; inteiros válidos passam", () => {
    const form = { quantidade_cabecas: "40", peso_medio_kg: "300", data_entrada: "2026-10-25", categoria: "BOI", sexo: "Macho", setor_id: "s1", area_entrada_id: "a1" };
    for (const ruim of ["100.5", "100abc", "0", "", "  ", "-5", "1e2", "100,0"]) {
      expect(() => camposDaCorrecaoDeEntrada(ENTRADA, { ...form, quantidade_cabecas: ruim }), ruim).toThrow(/inteiro positivo/);
    }
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, quantidade_cabecas: " 120 " })).toEqual({ quantidade: 120 });
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, quantidade_cabecas: 120 })).toEqual({ quantidade: 120 });
    expect(correcaoEntrada.inteiroPositivoDigitado?.("100.5")).toBeNaN();
    expect(correcaoEntrada.errosNumericosDaEntrada?.({ quantidade_cabecas: "100abc", peso_medio_kg: "300" })).toEqual(["quantidade_cabecas"]);
  });

  it("R3: peso com lixo (300abc, 1.2.3) é inválido — nunca vira null em silêncio; vazio = sem peso; vírgula aceita", () => {
    const form = { quantidade_cabecas: "40", peso_medio_kg: "300", data_entrada: "2026-10-25", categoria: "BOI", sexo: "Macho", setor_id: "s1", area_entrada_id: "a1" };
    for (const ruim of ["300abc", "1.2.3", "abc", "-1"]) {
      expect(() => camposDaCorrecaoDeEntrada(ENTRADA, { ...form, peso_medio_kg: ruim }), ruim).toThrow(/peso/);
    }
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, peso_medio_kg: "310,5" })).toEqual({ peso_entrada_kg: 310.5 });
    expect(camposDaCorrecaoDeEntrada(ENTRADA, { ...form, peso_medio_kg: "" })).toEqual({ peso_entrada_kg: null });
    expect(correcaoEntrada.errosNumericosDaEntrada?.({ quantidade_cabecas: "10", peso_medio_kg: "300abc" })).toEqual(["peso_medio_kg"]);
  });

  it("motivos estáveis do servidor viram texto (sem mensagem genérica muda)", () => {
    expect(mensagemDoMotivoCorrecao("movimentacao_cancelada")).toMatch(/mesmo cancelada/);
    expect(mensagemDoMotivoCorrecao("entrada_por_ativacao_agregada")).toMatch(/ativação/);
    expect(mensagemDoMotivoCorrecao("desconhecido")).toMatch(/registro dependente/);
  });
});

// ── Página ──────────────────────────────────────────────────────────────

const serviceMock = {
  listarLotes: vi.fn(),
  listarIdsDeLotesComRegistros: vi.fn(),
  criarLote: vi.fn(),
  atualizarLote: vi.fn(),
  excluirLotes: vi.fn(),
  consultarExclusaoDeLotes: vi.fn(),
  consultarCorrecaoEntrada: vi.fn(),
  corrigirEntradaDoLote: vi.fn(),
  listarAreasAtivas: vi.fn(),
  listarCategoriasManejoAtivas: vi.fn(),
  listarFornecedores: vi.fn(),
};
vi.mock("@/services/loteCadastroService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ...Object.fromEntries(Object.keys(serviceMock).map((k) => [k, (...a) => serviceMock[k](...a)])),
  };
});
vi.mock("@/services/loteManejoService", () => new Proxy({}, { get: () => vi.fn() }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
const mapaCache = vi.hoisted(() => ({ refreshMapaCacheEntry: vi.fn() }));
vi.mock("@/services/mapaCacheService", () => mapaCache);
const notify = vi.hoisted(() => ({ notifySuccess: vi.fn(), notifyWarning: vi.fn(), notifyError: vi.fn(), notifyExclusoesEmpilhadas: vi.fn() }));
vi.mock("@/lib/maikeNotify", () => notify);
vi.mock("@/components/common/RegistroAnexosDialog", () => ({ default: () => null }));
const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-lotes">{props.rows.map((r) => r.numero_lote).join(",")}</div>;
  },
}));
vi.mock("@/hooks/useSetorAreas", () => ({
  default: () => ({
    setores: [{ id: "s1", nome: "SETOR 1" }],
    areas: [{ id: "a1", nome: "PASTO A", setor_id: "s1" }, { id: "a2", nome: "PASTO B", setor_id: "s1" }],
    getAreasBySetor: () => [{ id: "a1", nome: "PASTO A", setor_id: "s1" }, { id: "a2", nome: "PASTO B", setor_id: "s1" }],
  }),
}));

const renderPagina = async () => {
  const { default: CadastroLotes } = await import("@/pages/CadastroLotes");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CadastroLotes />
    </QueryClientProvider>,
  );
  return queryClient;
};
const abrirEdicao = async () => {
  await waitFor(() => expect(gradePropsSpy).toHaveBeenCalled());
  await act(async () => gradePropsSpy.mock.calls.at(-1)[0].onSelectionChange(["l9"]));
  fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
};
const aviso = () => screen.findByTestId("correcao-entrada-aviso");
const campoQtd = () => screen.getByText("Qtd. Cabeças (entrada)").closest(".mg-field").querySelector("input");
const salvar = () => fireEvent.submit(document.getElementById("formulario-lote-base1"));
const erroDoServidor = (code, details = {}) => Object.assign(new Error(code), { cause: { code, details } });

beforeEach(() => {
  for (const fn of Object.values(serviceMock)) fn.mockReset();
  for (const fn of Object.values(notify)) fn.mockReset();
  mapaCache.refreshMapaCacheEntry.mockReset().mockResolvedValue(undefined);
  gradePropsSpy.mockClear();
  localStorage.removeItem("cadastro_lotes_form_layout_config");
  serviceMock.listarIdsDeLotesComRegistros.mockResolvedValue(new Set());
  for (const k of ["listarAreasAtivas", "listarCategoriasManejoAtivas", "listarFornecedores"]) serviceMock[k].mockResolvedValue([]);
  serviceMock.listarLotes.mockResolvedValue([ENTRADA]);
  serviceMock.atualizarLote.mockImplementation(async (id, dados) => ({ ...ENTRADA, ...dados }));
});
afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("R1 página — elegibilidade do servidor", () => {
  it("consultando → elegível: campos da entrada ficam editáveis (quantidade da ENTRADA, não saldo)", async () => {
    let liberar;
    serviceMock.consultarCorrecaoEntrada.mockImplementation(() => new Promise((r) => { liberar = r; }));
    await renderPagina();
    await abrirEdicao();
    expect((await aviso()).dataset.estado).toBe("consultando");
    expect(screen.getByTestId("lote-quantidades")).toBeTruthy(); // só leitura enquanto consulta
    await act(async () => liberar({ lote_id: "l9", elegivel: true, motivo: null, updated_date: ENTRADA.updated_date }));
    await waitFor(async () => expect((await aviso()).dataset.estado).toBe("elegivel"));
    expect(serviceMock.consultarCorrecaoEntrada).toHaveBeenCalledWith("l9");
    expect(campoQtd().value).toBe("40");
    expect(campoQtd().readOnly || campoQtd().disabled).toBe(false);
    expect(screen.getByLabelText("Motivo da correção")).toBeTruthy();
  });

  it("bloqueado: explica a dependência e mantém os campos da entrada só leitura", async () => {
    serviceMock.consultarCorrecaoEntrada.mockResolvedValue({ lote_id: "l9", elegivel: false, motivo: "movimentacao_cancelada", detalhes: {} });
    await renderPagina();
    await abrirEdicao();
    await waitFor(async () => expect((await aviso()).dataset.estado).toBe("bloqueado"));
    expect((await aviso()).textContent).toMatch(/mesmo cancelada/);
    expect(screen.getByTestId("lote-quantidades").querySelector("input")).toBeNull();
    expect(screen.queryByLabelText("Motivo da correção")).toBeNull();
  });

  it("erro na consulta: aviso específico, campos da entrada bloqueados", async () => {
    serviceMock.consultarCorrecaoEntrada.mockRejectedValue(new Error("rede"));
    await renderPagina();
    await abrirEdicao();
    await waitFor(async () => expect((await aviso()).dataset.estado).toBe("erro"));
    expect(screen.getByTestId("lote-quantidades").querySelector("input")).toBeNull();
  });
});

describe("R1 página — enviar a correção", () => {
  beforeEach(() => {
    serviceMock.consultarCorrecaoEntrada.mockResolvedValue({ lote_id: "l9", elegivel: true, motivo: null, updated_date: ENTRADA.updated_date });
  });
  const editarQuantidade = async (valor) => {
    await renderPagina();
    await abrirEdicao();
    await waitFor(async () => expect((await aviso()).dataset.estado).toBe("elegivel"));
    fireEvent.change(campoQtd(), { target: { value: valor } });
  };

  it("sem motivo: não envia nada e pede o motivo", async () => {
    await editarQuantidade("120");
    salvar();
    await waitFor(() => expect(screen.getByText("Informe o motivo da correção da entrada antes de salvar.")).toBeTruthy());
    expect(serviceMock.corrigirEntradaDoLote).not.toHaveBeenCalled();
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();
  });

  it("com motivo: comando de correção com os campos que mudaram e a leitura do formulário (CAS); PATCH nunca leva campo da entrada; caches do mapa atualizados", async () => {
    serviceMock.corrigirEntradaDoLote.mockResolvedValue({ lote_id: "l9", lote: { ...ENTRADA, quantidade_entrada: 120, quantidade_cabecas: 120, updated_date: "2026-11-05T11:00:00.000Z" } });
    await editarQuantidade("120");
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "digitação errada" } });
    salvar();
    salvar(); // duplo clique
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Entrada do lote corrigida"));
    expect(serviceMock.corrigirEntradaDoLote).toHaveBeenCalledTimes(1);
    expect(serviceMock.corrigirEntradaDoLote).toHaveBeenCalledWith("l9", { campos: { quantidade: 120 }, motivo: "digitação errada", updatedDate: ENTRADA.updated_date });
    for (const chamada of serviceMock.atualizarLote.mock.calls) {
      for (const c of [...CAMPOS_FORA_DO_PATCH, "status"]) expect(chamada[1]).not.toHaveProperty(c);
    }
    expect(mapaCache.refreshMapaCacheEntry).toHaveBeenCalledWith("lotes", "emp-1", { force: true });
  });

  it("R1-R2: quantidade + raça no MESMO clique → UMA requisição (comando), nenhum PATCH", async () => {
    serviceMock.corrigirEntradaDoLote.mockResolvedValue({ lote_id: "l9", lote: { ...ENTRADA, quantidade_entrada: 120, raca_predominante: "NELORE" } });
    await editarQuantidade("120");
    fireEvent.change(screen.getByText("Raça Predominante").closest(".mg-field").querySelector("input"), { target: { value: "nelore" } });
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "lançamento errado" } });
    salvar();
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Entrada do lote corrigida"));
    expect(serviceMock.corrigirEntradaDoLote).toHaveBeenCalledTimes(1);
    const [, enviado] = serviceMock.corrigirEntradaDoLote.mock.calls[0];
    expect(enviado.campos).toMatchObject({ quantidade: 120 });
    expect(String(enviado.campos.raca_predominante).toUpperCase()).toBe("NELORE");
    expect(Object.keys(enviado.campos).sort()).toEqual(["quantidade", "raca_predominante"]);
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();
  });

  it("R1-R2: só administrativo com a entrada elegível também vai pelo comando (com motivo), sem PATCH", async () => {
    serviceMock.corrigirEntradaDoLote.mockResolvedValue({ lote_id: "l9", lote: { ...ENTRADA, raca_predominante: "ANGUS" } });
    await renderPagina();
    await abrirEdicao();
    await waitFor(async () => expect((await aviso()).dataset.estado).toBe("elegivel"));
    fireEvent.change(screen.getByText("Raça Predominante").closest(".mg-field").querySelector("input"), { target: { value: "ANGUS" } });
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "raça errada" } });
    salvar();
    await waitFor(() => expect(serviceMock.corrigirEntradaDoLote).toHaveBeenCalledTimes(1));
    expect(Object.keys(serviceMock.corrigirEntradaDoLote.mock.calls[0][1].campos)).toEqual(["raca_predominante"]);
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();
  });

  it.each(["100.5", "100abc", "0", ""])("R3: quantidade %j na edição elegível → erro no campo, texto preservado, ZERO requisição", async (ruim) => {
    await editarQuantidade(ruim);
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "digitação" } });
    salvar();
    await waitFor(() => expect(screen.getByText(/Nada foi salvo|Preencha os campos obrigatórios/)).toBeTruthy());
    expect(campoQtd().value).toBe(ruim);
    expect(serviceMock.corrigirEntradaDoLote).not.toHaveBeenCalled();
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();
  });

  it("R3: peso '300abc' na edição elegível → erro, texto preservado, ZERO requisição", async () => {
    await editarQuantidade("40");
    const peso = screen.getByText("Peso Médio (kg)").closest(".mg-field").querySelector("input");
    fireEvent.change(peso, { target: { value: "300abc" } });
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "digitação" } });
    salvar();
    await waitFor(() => expect(screen.getByText(/Nada foi salvo/)).toBeTruthy());
    expect(peso.value).toBe("300abc");
    expect(serviceMock.corrigirEntradaDoLote).not.toHaveBeenCalled();
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();
  });

  it("servidor recusa (dependência ou leitura obsoleta): avisa o motivo e o formulário fica com o que foi digitado", async () => {
    serviceMock.corrigirEntradaDoLote.mockRejectedValueOnce(erroDoServidor("LOTE_CORRECAO_ENTRADA_BLOQUEADA", { motivo: "movimentacao_ativa" }));
    await editarQuantidade("120");
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "digitação errada" } });
    salvar();
    await waitFor(() => expect(notify.notifyWarning).toHaveBeenCalledWith("Correção recusada", expect.stringMatching(/movimentação do mapa/)));
    expect(campoQtd()?.value ?? "").toBe("120");
    expect(serviceMock.atualizarLote).not.toHaveBeenCalled();

    serviceMock.corrigirEntradaDoLote.mockRejectedValueOnce(erroDoServidor("LOTE_ESTADO_CONFLITO"));
    serviceMock.consultarCorrecaoEntrada.mockResolvedValue({ lote_id: "l9", elegivel: true, motivo: null, updated_date: ENTRADA.updated_date });
    await waitFor(async () => expect((await aviso()).dataset.estado).toBe("elegivel"));
    salvar();
    await waitFor(() => expect(notify.notifyWarning).toHaveBeenCalledWith("Lote alterado", expect.stringMatching(/Recarregue/)));
  });
});

describe("R3 — formulário de CRIAÇÃO usa a mesma validação estrita", () => {
  it.each(["100.5", "100abc", "0"])("quantidade %j no cadastro novo → erro no campo, texto preservado, onSubmit NÃO chamado", async (ruim) => {
    const { default: FormularioLote } = await import("@/components/lotes/FormularioLote.jsx");
    const onSubmit = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FormularioLote visualVariant="base1" variant="embedded" toolbarActions readOnly={false} onSubmit={onSubmit} onCancel={() => {}} initialData={null} isEditing={false} />
      </QueryClientProvider>,
    );
    const qtd = screen.getByLabelText("Qtd. Cabeças (entrada)");
    fireEvent.change(qtd, { target: { value: ruim } });
    salvar();
    await waitFor(() => expect(screen.getByText(/Nada foi salvo/)).toBeTruthy());
    expect(qtd.value).toBe(ruim);
    expect(qtd.getAttribute("aria-invalid")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
