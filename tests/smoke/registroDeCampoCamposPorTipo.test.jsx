/**
 * D-PROD-273 (MAIKE-ENTREGA2) — os CAMPOS DE CADA TIPO na "Nova realização de <Tipo>":
 *  - Plantio de pastagem: o capim (obrigatório, do Cadastro de Culturas; espécie e cultivar embaixo), a Safra só leitura
 *    preenchida pela data, forma, semente incrustada, cobertura e consórcio (opcionais, só vão quando escolhidos), o aviso
 *    "sem semente" e o VC % na linha da semente (pontos de VC/ha);
 *  - Fertilização: a Safra só leitura;
 *  - Aplicação: o alvo da operação (só leitura), o nº do receituário (opcional) e o "Pasto liberado em" (término +
 *    carência do produto);
 *  - Manutenção e Outros: a área opcional, o Local obrigatório sem área, a quantidade feita e a unidade (Manutenção);
 *  - a data no celular não sobe por cima do rótulo (o campo cresce para 48px na Nova realização);
 *  - os cadastros: o alvo na operação (Aplicação) e a carência no produto.
 *
 * A janela montada de verdade (`JanelaRegistroDeCampo`, service, API, porta e `nativeHttpClient` reais); mocks só da borda.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { API_FAKE, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ver: true, lancarApontamento: true, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-28" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "cli-1", user: { id: "u1" } }) }));
const confirmacao = vi.hoisted(() => ({ confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/maikeConfirmar", () => confirmacao);

const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");
const regras = await import("@/lib/registroDeCampoRegras");
const tipo = await import("@/lib/camposPorTipo");

const OPERACOES = [
  { id: "t-sem", nome_tipo: "SEMEADURA DE CAPIM", categoria: "PLANTIO", ativo: true },
  { id: "t-adub", nome_tipo: "ADUBAÇÃO DE COBERTURA", categoria: "TRATO_CULTURAL", ativo: true },
  { id: "t-cig", nome_tipo: "COMBATE CONTRA CIGARRINHA", categoria: "APLICACAO", ativo: true, alvo: "CIGARRINHA" },
  { id: "t-herb", nome_tipo: "HERBICIDA", categoria: "APLICACAO", ativo: true },
  { id: "t-cerca", nome_tipo: "REFORMA DE CERCA", categoria: "BENFEITORIA", ativo: true },
  { id: "t-transp", nome_tipo: "TRANSPORTE DE MOURÕES", categoria: "OUTROS", ativo: true },
];
const AROEIRA = { id: "area-aroeira", nome: "PASTO DA AROEIRA", tamanho_hectares: 40, empresa_id: "emp-1", ativo: true };
const AREAS = [AROEIRA];
const CULTURAS = [
  { id: "c-mom", codigo: "007", tipo: "PASTAGEM", nome: "PANICUM CV. MOMBAÇA", especie: "Megathyrsus maximus", cultivar: "Mombaça", ativo: true },
  { id: "c-mar", codigo: "001", tipo: "PASTAGEM", nome: "BRACHIARIA BRIZANTHA CV. MARANDU", especie: "Urochloa brizantha", cultivar: "Marandu", ativo: true },
  { id: "c-milho", codigo: "020", tipo: "LAVOURA", nome: "MILHO", especie: null, cultivar: null, ativo: true },
  { id: "c-velho", codigo: "030", tipo: "PASTAGEM", nome: "CAPIM ANTIGO", ativo: false },
];
const PRODUTOS = [
  { id: "p-sem", nome: "Semente Mombaça", unidade: "KG", unidade_principal_estoque: "KG", carencia_dias: null },
  { id: "p-ins", nome: "Inseticida Tiametoxam", unidade: "L", unidade_principal_estoque: "L", carencia_dias: 21 },
];
const LOCAIS = {
  "p-sem": [{ local_estoque_id: "l1", local_nome: "Depósito Central", disponivel: "900.0000", unidade: "KG" }],
  "p-ins": [{ local_estoque_id: "l1", local_nome: "Depósito Central", disponivel: "60.0000", unidade: "L" }],
};

/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** D-PROD-273: os serviços abertos sem área que `GET /atividades?local=…` devolve (a prévia sem área). @type {any[]} */
let servicosAbertos;
/** D-PROD-273: o `registro.pasto_liberado_em` da resposta do registro (o servidor calcula). @type {string|null} */
let liberadoNaResposta;

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  const partes = path.split("/").filter(Boolean);
  if (path === "/areas-pastagem" && method === "GET") return { status: 200, body: AREAS };
  if (path === "/culturas" && method === "GET") return { status: 200, body: CULTURAS };
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    if (partes[1] === "locais") return { status: 200, body: { itens: LOCAIS[/** @type {"p-sem"} */ (String(query.get("produto_id")))] ?? [] } };
    return { status: 200, body: { itens: partes[1] === "produtos" ? PRODUTOS : [], has_more: false, next_cursor: null } };
  }
  if (partes[0] === "atividades-por-area" && method === "GET") return { status: 200, body: { area_id: partes[1], mes: "2026-11", atividades: [], custos: null } };
  // D-PROD-273: a lista filtrada pelo local (o serviço aberto sem área), como o servidor.
  if (path === "/atividades" && method === "GET") {
    const items = servicosAbertos.filter(
      (a) => a.local === query.get("local") && a.tipo_atividade_id === query.get("tipo_atividade_id") && (!query.get("status") || a.status === query.get("status")),
    );
    return { status: 200, body: { items, next_cursor: null, has_more: false, total: items.length, limit: Number(query.get("limit") ?? 100) } };
  }
  if (path === "/atividades/registrar" && method === "POST") {
    return {
      status: 201,
      body: {
        apontamento: { id: "ap-1" }, apontamentos: [{ id: "ap-1" }], atividade: { id: "at-9" }, alertas: [],
        registro: { atividade_criada: true, atividade_id: "at-9", pasto_liberado_em: liberadoNaResposta, carencia_dias: liberadoNaResposta ? 21 : null }, replay: false,
      },
    };
  }
  return undefined;
};

beforeEach(async () => {
  vi.stubEnv("VITE_MAIKE_API_URL", API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("empresa_selecionada_id", "emp-1");
  window.localStorage.setItem("empresa_selecionada_cliente_id", "cli-1");
  const { setNativeToken } = await import("@/lib/auth/nativeTokenStorage");
  setNativeToken("jwt.teste");
  confirmacao.confirmar.mockResolvedValue(true);
  servicosAbertos = [];
  liberadoNaResposta = null;
  backend = instalarBackendFake(rotear);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────
/** @param {Record<string, any>} [props] */
const montar = async (props = {}) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <JanelaRegistroDeCampo tipos={OPERACOES} areas={AREAS} onFechar={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
  return screen.findByTestId("janela-registro-de-campo");
};
const registros = () => backend.chamadas.filter((c) => c.method === "POST" && c.path === "/atividades/registrar");
const escolherTipo = async (/** @type {HTMLElement} */ janela, /** @type {string} */ nome) => {
  fireEvent.click(within(janela).getByRole("button", { name: nome }));
  await within(janela).findByTestId("registro-de-campo-form");
};
/** Escolhe a opção de um campo de escolha (combobox) pelo rótulo. */
const escolher = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ rotulo, /** @type {string|RegExp} */ opcao) => {
  fireEvent.click(within(janela).getByRole("combobox", { name: rotulo }));
  fireEvent.click(await screen.findByRole("option", { name: opcao }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};
const marcarArea = async (/** @type {HTMLElement} */ janela, /** @type {string} */ id) => {
  fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
  fireEvent.click(await screen.findByTestId(`registro-areas-opcao-${id}`));
  fireEvent.click(within(janela).getByTestId("registro-areas-campo"));
  await waitFor(() => expect(screen.queryByTestId("registro-areas-lista")).toBeNull());
};
const incluirInsumo = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ produto, /** @type {string} */ quantidade, /** @type {string} */ vc = "") => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
  const editor = within(janela).getByTestId("registro-insumo-editor");
  await waitFor(() => expect(within(editor).getByTestId("registro-produto-produto")).not.toBeDisabled());
  fireEvent.click(within(editor).getByTestId("registro-produto-produto"));
  fireEvent.click(await screen.findByRole("option", { name: produto }));
  await waitFor(() => expect(within(editor).getByRole("combobox", { name: /Local do estoque/ })).toHaveTextContent("Depósito"));
  fireEvent.change(within(editor).getByTestId("registro-produto-quantidade"), { target: { value: quantidade } });
  if (vc) fireEvent.change(within(editor).getByLabelText(/VC % \(semente\)/), { target: { value: vc } });
  fireEvent.click(within(editor).getByTestId("registro-insumo-editor-incluir"));
  await waitFor(() => expect(within(janela).queryByTestId("registro-insumo-editor")).toBeNull());
};
const salvar = async (/** @type {HTMLElement} */ janela) => {
  fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
};
const valorDe = (/** @type {HTMLElement} */ janela, /** @type {string} */ testId) => within(janela).getByTestId(testId).textContent.trim();

describe("Plantio de pastagem (D-PROD-273)", () => {
  it("o rótulo do tipo é \"Plantio de pastagem\"; o capim é obrigatório (nada sai sem ele) e a lista é dos capins ativos do cadastro", async () => {
    const janela = await montar();
    expect(within(janela).getByRole("list", { name: "Tipos de serviço" }).textContent).toContain("Plantio de pastagem");
    await escolherTipo(janela, "Plantio de pastagem");
    expect(within(janela).getByTestId("registro-de-campo-titulo").textContent).toContain("Nova realização de Plantio de pastagem");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "SEMEADURA DE CAPIM");
    await salvar(janela);
    expect(await within(janela).findByText("Escolha o capim plantado.")).toBeTruthy();
    expect(registros()).toHaveLength(0);
    fireEvent.click(within(janela).getByRole("combobox", { name: /Capim plantado/ }));
    const nomes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    expect(nomes).toEqual(["BRACHIARIA BRIZANTHA CV. MARANDU", "PANICUM CV. MOMBAÇA"]);
    fireEvent.click(screen.getByRole("option", { name: "PANICUM CV. MOMBAÇA" }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    expect(valorDe(janela, "registro-de-campo-capim-dica")).toBe("Megathyrsus maximus cv. Mombaça · do cadastro de culturas");
    // A safra é só leitura, preenchida pela data (28/11/2026 → 2026/27), e não vai no corpo (o servidor calcula).
    expect(valorDe(janela, "registro-de-campo-safra")).toBe("2026/27");
    expect(within(janela).getByTestId("registro-de-campo-sem-semente").textContent).toBe("Sem semente, não dá para calcular kg/ha.");
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    const corpo = registros()[0].body;
    expect(corpo.plantio).toEqual({ cultura_id: "c-mom" });
    expect(corpo.safra_ciclo).toBeUndefined();
    expect(corpo.areas).toEqual([{ area_id: "area-aroeira", hectares: "40" }]);
  });

  it("os opcionais só vão quando escolhidos; o consórcio é outra cultura (sem o capim); o VC na linha da semente mostra os pontos de VC/ha e vai em texto", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Plantio de pastagem");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "SEMEADURA DE CAPIM");
    await escolher(janela, /Capim plantado/, "PANICUM CV. MOMBAÇA");
    await escolher(janela, /Forma de plantio/, /a lanço/i);
    fireEvent.click(within(janela).getByRole("switch", { name: "Plantio de cobertura" }));
    fireEvent.click(within(janela).getByRole("combobox", { name: /Junto com/ }));
    const consorcios = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    expect(consorcios).not.toContain("PANICUM CV. MOMBAÇA");
    fireEvent.click(screen.getByRole("option", { name: "MILHO" }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    // D-PROD-273 (ajuste do teste de ponta a ponta): a prévia diz o capim.
    await waitFor(() =>
      expect(within(janela).getByTestId("registro-de-campo-destino").textContent).toBe(
        "Nova atividade será criada: SEMEADURA DE CAPIM · PASTO DA AROEIRA · nov/26 · capim PANICUM CV. MOMBAÇA",
      ),
    );
    await incluirInsumo(janela, /Semente Mombaça/, "400", "50");
    // 400 kg em 40 ha = 10 kg/ha; × VC 50 = 500 pontos de VC/ha.
    expect(within(janela).getByTestId("registro-insumo-linha-1-vc").textContent).toBe("VC 50% · 500 pontos de VC/ha");
    expect(within(janela).queryByTestId("registro-de-campo-sem-semente")).toBeNull();
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    const corpo = registros()[0].body;
    expect(corpo.plantio).toEqual({ cultura_id: "c-mom", forma_plantio: "A_LANCO", cobertura: true, consorcio_cultura_id: "c-milho" });
    expect(corpo.produtos).toEqual([{ produto_id: "p-sem", local_estoque_id: "l1", quantidade: "400", vc_percentual: "50" }]);
  });

  it("VC inválido fica no editor (nada sai); sem VC a linha é a de sempre", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Plantio de pastagem");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "SEMEADURA DE CAPIM");
    await escolher(janela, /Capim plantado/, "BRACHIARIA BRIZANTHA CV. MARANDU");
    fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
    const editor = within(janela).getByTestId("registro-insumo-editor");
    await waitFor(() => expect(within(editor).getByTestId("registro-produto-produto")).not.toBeDisabled());
    fireEvent.click(within(editor).getByTestId("registro-produto-produto"));
    fireEvent.click(await screen.findByRole("option", { name: /Semente Mombaça/ }));
    await waitFor(() => expect(within(editor).getByRole("combobox", { name: /Local do estoque/ })).toHaveTextContent("Depósito"));
    fireEvent.change(within(editor).getByTestId("registro-produto-quantidade"), { target: { value: "320" } });
    fireEvent.change(within(editor).getByLabelText(/VC % \(semente\)/), { target: { value: "120" } });
    fireEvent.click(within(editor).getByTestId("registro-insumo-editor-incluir"));
    expect((await within(editor).findAllByText("O VC é de mais de 0 até 100%.")).length).toBeGreaterThan(0);
    fireEvent.change(within(editor).getByLabelText(/VC % \(semente\)/), { target: { value: "" } });
    fireEvent.click(within(editor).getByTestId("registro-insumo-editor-incluir"));
    await waitFor(() => expect(within(janela).queryByTestId("registro-insumo-editor")).toBeNull());
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.produtos).toEqual([{ produto_id: "p-sem", local_estoque_id: "l1", quantidade: "320" }]);
  });
});

describe("Fertilização e Aplicação (D-PROD-273)", () => {
  it("Fertilização: a Safra só leitura (preenchida pela data); nada de plantio no corpo", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Fertilização");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "ADUBAÇÃO DE COBERTURA");
    expect(valorDe(janela, "registro-de-campo-safra")).toBe("2026/27");
    expect(within(janela).queryByRole("combobox", { name: /Capim plantado/ })).toBeNull();
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.plantio).toBeUndefined();
    expect(registros()[0].body.safra_ciclo).toBeUndefined();
  });

  it("Aplicação: o alvo vem da operação (só leitura); o receituário vai quando preenchido; o pasto liberado = término + a carência do produto", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Aplicação");
    await marcarArea(janela, "area-aroeira");
    expect(valorDe(janela, "registro-de-campo-pasto-liberado")).toBe("—");
    await escolher(janela, /Operação/, "COMBATE CONTRA CIGARRINHA");
    expect(valorDe(janela, "registro-de-campo-alvo")).toBe("CIGARRINHA");
    expect(within(janela).queryByTestId("registro-de-campo-safra")).toBeNull();
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data"), { target: { value: "2026-11-10" } });
    fireEvent.change(within(janela).getByTestId("registro-de-campo-data-termino"), { target: { value: "2026-11-12" } });
    fireEvent.change(within(janela).getByTestId("registro-de-campo-receituario"), { target: { value: "0187/2026" } });
    await incluirInsumo(janela, /Inseticida Tiametoxam/, "10");
    expect(valorDe(janela, "registro-de-campo-pasto-liberado")).toBe("03/12/2026");
    expect(valorDe(janela, "registro-de-campo-pasto-liberado-nota")).toBe("término + carência do produto (21 dias)");
    liberadoNaResposta = "2026-12-03";
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    const corpo = registros()[0].body;
    expect(corpo.numero_receituario).toBe("0187/2026");
    expect(corpo.pasto_liberado_em).toBeUndefined();
    // D-PROD-273 (ajuste do teste de ponta a ponta): o aviso de sucesso diz o "Pasto liberado em" da resposta.
    await waitFor(() =>
      expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "COMBATE CONTRA CIGARRINHA registrada em PASTO DA AROEIRA. Pasto liberado em 03/12/2026."),
    );
  });

  it("Aplicação sem carência na resposta: o aviso de sucesso é o de sempre (nada inventado)", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Aplicação");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "HERBICIDA");
    await salvar(janela);
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "HERBICIDA registrada em PASTO DA AROEIRA."));
  });

  it("Aplicação sem alvo na operação diz onde cadastrar; sem receituário, o campo não vai", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Aplicação");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "HERBICIDA");
    expect(valorDe(janela, "registro-de-campo-alvo")).toBe("—");
    expect(janela.textContent).toContain("sem alvo no cadastro da operação");
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(Object.prototype.hasOwnProperty.call(registros()[0].body, "numero_receituario")).toBe(false);
  });
});

describe("Manutenção e Outros sem área (D-PROD-273)", () => {
  it("Manutenção: a área é opcional (Nenhuma área); sem área, o Local é obrigatório; o corpo leva o local, a quantidade feita e a unidade, sem áreas", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Manutenção");
    expect(within(janela).getByTestId("registro-areas-campo").textContent).toContain("Nenhuma área");
    await escolher(janela, /Operação/, "REFORMA DE CERCA");
    expect(within(janela).getByRole("button", { name: "Salvar" })).not.toBeDisabled();
    await salvar(janela);
    expect(await within(janela).findByText("Sem área, informe o local do serviço.")).toBeTruthy();
    expect(registros()).toHaveLength(0);
    fireEvent.change(within(janela).getByTestId("registro-de-campo-local"), { target: { value: "divisa  norte" } });
    fireEvent.change(within(janela).getByTestId("registro-de-campo-quantidade-feita"), { target: { value: "1,2" } });
    await salvar(janela);
    expect(await within(janela).findByText("Escolha a unidade.")).toBeTruthy();
    await escolher(janela, /^Unidade/, "KM");
    expect(within(janela).getByTestId("registro-de-campo-destino").textContent).toContain("REFORMA DE CERCA · DIVISA NORTE · nov/26");
    // D-PROD-273: a prévia lê o serviço aberto do local (nenhum aqui) e diz que cria um.
    await waitFor(() => expect(within(janela).getByTestId("registro-de-campo-destino").textContent).toBe("Nova atividade será criada: REFORMA DE CERCA · DIVISA NORTE · nov/26"));
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    const corpo = registros()[0].body;
    expect(corpo.local).toBe("DIVISA NORTE");
    expect(corpo.areas).toBeUndefined();
    expect(corpo.area_id).toBeUndefined();
    expect(corpo.quantidade_produzida_dia).toBe("1.2");
    expect(corpo.unidade_producao_sigla).toBe("KM");
    // O aviso de sucesso diz o local (sem área não há `areas` no corpo) e a janela segue o fluxo de sempre.
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "REFORMA DE CERCA registrada em DIVISA NORTE."));
  });

  it("com área, o Local some e o corpo é o de sempre (áreas, sem local)", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Manutenção");
    await marcarArea(janela, "area-aroeira");
    expect(within(janela).queryByTestId("registro-de-campo-local")).toBeNull();
    await escolher(janela, /Operação/, "REFORMA DE CERCA");
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.local).toBeUndefined();
    expect(registros()[0].body.areas).toEqual([{ area_id: "area-aroeira", hectares: "40" }]);
  });

  it("Outros: o mesmo Local sem área; sem a quantidade feita", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Outros");
    await escolher(janela, /Operação/, "TRANSPORTE DE MOURÕES");
    expect(within(janela).queryByTestId("registro-de-campo-quantidade-feita")).toBeNull();
    fireEvent.change(within(janela).getByTestId("registro-de-campo-local"), { target: { value: "sede" } });
    await salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.local).toBe("SEDE");
    expect(registros()[0].body.unidade_producao_sigla).toBeUndefined();
    await waitFor(() => expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "TRANSPORTE DE MOURÕES registrada em SEDE."));
  });

  it("a prévia sem área acha o serviço ABERTO da operação no mesmo local (a busca do servidor): \"Entra em …\" com a quantidade feita", async () => {
    servicosAbertos = [
      {
        id: "at-21", nome: "REFORMA DE CERCA · DIVISA NORTE · nov/26", status: "ABERTA", tipo_atividade_id: "t-cerca", local: "DIVISA NORTE", areas: [],
        quantidade_produzida: "1.2000", unidade_producao_sigla: "KM", andamento: { situacao: "EM_ANDAMENTO", lancamentos: 1, ultimo_dia: "2026-11-26" },
      },
    ];
    const janela = await montar();
    await escolherTipo(janela, "Manutenção");
    await escolher(janela, /Operação/, "REFORMA DE CERCA");
    fireEvent.change(within(janela).getByTestId("registro-de-campo-local"), { target: { value: "divisa  norte" } });
    await waitFor(() => expect(within(janela).getByTestId("registro-de-campo-destino").textContent).toBe("Entra em REFORMA DE CERCA · DIVISA NORTE · nov/26 (em andamento, 1,2 km)"));
    // A consulta é a do servidor: a operação, ABERTA, o local como ele grava.
    const consulta = backend.chamadas.filter((c) => c.method === "GET" && c.path === "/atividades").at(-1);
    expect(consulta?.query).toMatchObject({ empresa_id: "emp-1", status: "ABERTA", tipo_atividade_id: "t-cerca", local: "DIVISA NORTE" });
    // Outro local: nenhum aberto → cria.
    fireEvent.change(within(janela).getByTestId("registro-de-campo-local"), { target: { value: "curral" } });
    await waitFor(() => expect(within(janela).getByTestId("registro-de-campo-destino").textContent).toBe("Nova atividade será criada: REFORMA DE CERCA · CURRAL · nov/26"));
  });

  it("os outros tipos continuam com a área obrigatória (Roçada sem área não sai)", async () => {
    const janela = await montar();
    await escolherTipo(janela, "Roçada e tratos");
    expect(within(janela).queryByTestId("registro-de-campo-local")).toBeNull();
    expect(within(janela).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });
});

describe("as regras puras e o celular (D-PROD-273)", () => {
  it("safra do dia, pasto liberado, VC, pontos de VC e o corpo do plantio", () => {
    expect(["2026-11-28", "2027-01-15", "2027-06-30", "2027-07-01", ""].map(tipo.safraDoDia)).toEqual(["2026/27", "2026/27", "2026/27", "2027/28", ""]);
    expect(tipo.pastoLiberadoEm("2026-11-12", [21, null, 3])).toEqual({ dia: "2026-12-03", carencia: 21 });
    expect(tipo.pastoLiberadoEm("2026-11-12", [null])).toEqual({ dia: null, carencia: null });
    expect([tipo.lerVc("50"), tipo.lerVc("62,5"), tipo.lerVc(""), tipo.lerVc("0").erro, tipo.lerVc("abc").erro]).toEqual([
      { valor: "50", erro: null }, { valor: "62.5", erro: null }, { valor: null, erro: null }, "O VC é de mais de 0 até 100%.", "O VC está em formato inválido: use 50 ou 62,5.",
    ]);
    expect(tipo.pontosDeVc("8", "50")).toEqual({ pontos: 400, kgSpv: 4 });
    expect(tipo.corpoDoPlantio({ culturaId: "c1", forma: "", incrustada: null, cobertura: false, consorcioId: "" })).toEqual({ cultura_id: "c1", cobertura: false });
    expect(tipo.camposDoTipo("BENFEITORIA")).toEqual({ plantio: false, safra: false, aplicacao: false, areaOpcional: true, quantidadeFeita: true });
    expect(tipo.camposDoTipo("PASTAGEM", { exige_safra: true }).safra).toBe(true);
  });

  it("a prévia \"Entra em…\" usa o capim: a atividade de outro capim não é a deste registro", () => {
    const resumo = { atividades: [{ atividade_id: "at-1", nome: "SEMEADURA · AROEIRA · nov/26", tipo_atividade_id: "t-sem", status: "ABERTA", area_status: "EM_ANDAMENTO", plantio_cultura_id: "c-mar" }] };
    const base = { tipo: OPERACOES[0], areas: [{ id: "area-aroeira", nome: "PASTO DA AROEIRA" }], dia: "2026-11-28", resumos: [resumo] };
    expect(regras.destinoDoRegistro({ ...base, culturaId: "c-mar" })).toMatch(/^Entra em SEMEADURA/);
    expect(regras.destinoDoRegistro({ ...base, culturaId: "c-mom" })).toMatch(/^Nova atividade será criada/);
    // D-PROD-273 (ajuste do teste de ponta a ponta): a frase diz o capim (dois plantios na mesma área têm o mesmo nome).
    expect(regras.destinoDoRegistro({ ...base, culturaId: "c-mar", capim: "BRACHIARIA BRIZANTHA CV. MARANDU" })).toBe(
      "Entra em SEMEADURA · AROEIRA · nov/26 · capim BRACHIARIA BRIZANTHA CV. MARANDU (planejada)",
    );
    expect(regras.destinoDoRegistro({ ...base, culturaId: "c-mom", capim: "PANICUM CV. MOMBAÇA" })).toBe(
      "Nova atividade será criada: SEMEADURA DE CAPIM · PASTO DA AROEIRA · nov/26 · capim PANICUM CV. MOMBAÇA",
    );
  });

  it("a prévia sem área (regra pura): sem a leitura, as duas possibilidades; com ela, \"Entra em …\" ou \"Nova atividade será criada\"; parada há mais de 30 dias, avisa", () => {
    const tipoCerca = OPERACOES[4];
    const base = { tipo: tipoCerca, local: " divisa  norte ", dia: "2026-11-28" };
    const aberta = { id: "at-21", nome: "REFORMA DE CERCA · DIVISA NORTE · nov/26", status: "ABERTA", tipo_atividade_id: "t-cerca", local: "DIVISA NORTE", areas: [], quantidade_produzida: null, andamento: { lancamentos: 1, ultimo_dia: "2026-11-20" } };
    expect(regras.destinoSemArea({ ...base, abertas: null })).toBe(
      "Se já houver REFORMA DE CERCA aberta em DIVISA NORTE, entra nela; senão, nova atividade será criada: REFORMA DE CERCA · DIVISA NORTE · nov/26",
    );
    expect(regras.destinoSemArea({ ...base, abertas: [] })).toBe("Nova atividade será criada: REFORMA DE CERCA · DIVISA NORTE · nov/26");
    expect(regras.destinoSemArea({ ...base, abertas: [aberta] })).toBe("Entra em REFORMA DE CERCA · DIVISA NORTE · nov/26 (em andamento)");
    expect(regras.destinoSemArea({ ...base, abertas: [{ ...aberta, andamento: { lancamentos: 0, ultimo_dia: null } }] })).toBe("Entra em REFORMA DE CERCA · DIVISA NORTE · nov/26 (planejada)");
    // Outro local ou outra operação na lista não contam (a tela confere a mesma regra do servidor).
    expect(regras.destinoSemArea({ ...base, abertas: [{ ...aberta, local: "CURRAL" }, { ...aberta, tipo_atividade_id: "t-transp" }] })).toBe("Nova atividade será criada: REFORMA DE CERCA · DIVISA NORTE · nov/26");
    expect(regras.destinoSemArea({ ...base, dia: "2027-01-10", abertas: [aberta] })).toBe(
      "Entra em REFORMA DE CERCA · DIVISA NORTE · nov/26 (em andamento). Parada desde 20/11: ao salvar, vamos perguntar se é continuação",
    );
    expect(regras.destinoSemArea({ ...base, abertas: [aberta, { ...aberta, id: "at-22" }] })).toBe("Entra em uma das atividades de REFORMA DE CERCA abertas em DIVISA NORTE");
  });

  it("no celular, o campo da Nova realização cresce para 48px (a data não sobe por cima do rótulo); no desktop, nada muda", () => {
    const css = readFileSync("src/styles/cadastro-base1.css", "utf8");
    const bloco = css.slice(css.indexOf(".b1-realizacao__cartao {\n    min-height: 96px;"));
    const media = css.slice(0, css.indexOf(".b1-realizacao__cartao {\n    min-height: 96px;")).lastIndexOf("@media (max-width: 767px)");
    expect(media).toBeGreaterThan(-1);
    expect(bloco).toMatch(/\.b1-realizacao \.b1-form-embutido \{\s*--mg-field-h: 48px;\s*\}/);
    // Fora da media query, nenhuma regra mexe na altura do campo da realização.
    expect(css.match(/\.b1-realizacao[^{]*\{[^}]*--mg-field-h/g)).toHaveLength(1);
  });
});

describe("os cadastros: o alvo da operação e a carência do produto (D-PROD-273)", () => {
  it("a operação de Aplicação tem o Alvo (lista curta + Outro), que vai no corpo; as outras não", async () => {
    const { default: FormularioTipoAtividade } = await import("@/components/tipos-atividade/FormularioTipoAtividade");
    const onSubmit = vi.fn();
    render(<FormularioTipoAtividade initialData={{ id: "t1", nome_tipo: "COMBATE", categoria: "APLICACAO", ativo: true, alvo: "CARRAPATO" }} onSubmit={onSubmit} />);
    const form = screen.getByTestId("b1-form-tipo-atividade");
    expect(within(form).getByRole("combobox", { name: /^Alvo/ }).textContent).toContain("OUTRO");
    expect(within(form).getByTestId("tipo-atividade-alvo-outro").value).toBe("CARRAPATO");
    fireEvent.click(within(form).getByRole("combobox", { name: /^Alvo/ }));
    fireEvent.click(await screen.findByRole("option", { name: "CIGARRINHA" }));
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledWith({ categoria: "APLICACAO", nome_tipo: "COMBATE", ativo: true, alvo: "CIGARRINHA" });
    cleanup();
    const outro = vi.fn();
    render(<FormularioTipoAtividade initialData={{ id: "t2", nome_tipo: "ROÇADA", categoria: "PASTAGEM", ativo: true }} onSubmit={outro} />);
    expect(screen.queryByRole("combobox", { name: /^Alvo/ })).toBeNull();
    fireEvent.submit(screen.getByTestId("b1-form-tipo-atividade"));
    expect(outro).toHaveBeenCalledWith({ categoria: "PASTAGEM", nome_tipo: "ROÇADA", ativo: true });
  });

  it("a carência do produto vai como número inteiro (vazio = null, limpa) e a porta a deixa passar", async () => {
    const { normalizarProduto } = await import("@/services/produtoService");
    expect(normalizarProduto({ nome_produto: "x", carencia_dias: "21" }).carencia_dias).toBe(21);
    expect(normalizarProduto({ nome_produto: "x", carencia_dias: "" }).carencia_dias).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(normalizarProduto({ nome_produto: "x" }), "carencia_dias")).toBe(false);
    const porta = readFileSync("src/apis/produtos/produtoNativePort.js", "utf8");
    expect(porta).toContain("'carencia_dias'");
  });
});
