/**
 * D-PROD-262 — "Registrar serviço" com VÁRIAS linhas por seção (fase 2 da D-PROD-258), no desenho da maquete "Nova
 * realização": Insumos, Máquinas, Equipe e Serviço de terceiro são tabelas; "+ Incluir …" abre um editor dentro da seção
 * (um por seção, sem segunda janela) com os campos das janelas da linha; "Incluir" valida e o item vira linha da tabela.
 *
 * A janela montada de verdade (`JanelaRegistroDeCampo`, editores, service, API, porta e `nativeHttpClient` reais); mocks só
 * da borda: `fetch` (um backend falso no formato do contrato), a sessão da tela (ações, fazenda, fuso), o aviso e a
 * confirmação do envio pendente.
 *
 * Cobre:
 *  - 2 insumos + 2 máquinas + 2 pessoas + 2 serviços → UM POST em /atividades/registrar com arrays de 2, na ordem das tabelas;
 *  - o que cada tabela mostra (dose/ha pelos hectares de agora, total, uso, medida, prestador, valor);
 *  - editor vazio não vai; editor preenchido entra sozinho ao salvar; preenchido e inválido segura o envio;
 *  - editar (clicar na linha → Atualizar no lugar; Cancelar não muda) e remover (✕ renumera);
 *  - recusa do servidor pelo índice no array enviado (`linha_indice` da máquina; `colecao`/`indice` do produto) na linha
 *    certa, com o editor aberto nela e o campo apontado, e o reenvio corrigido;
 *  - operação antiga que exige máquina: basta UMA máquina na tabela;
 *  - "Salvar e novo" esvazia as tabelas; o "+ Incluir" some no 20º item; celular em cartões;
 *  - o limite de 20 é o mesmo do servidor; `itemDaRecusa` (puro).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { API_FAKE, erroServidor, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ver: true, lancarApontamento: true, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-18" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "cli-1", user: { id: "u1" } }) }));
// "Envio igual sem resposta?": a pergunta do mecanismo de pendência é respondida pelo teste.
const confirmacao = vi.hoisted(() => ({ confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/maikeConfirmar", () => confirmacao);

const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");

const HOJE = "2026-11-18";

// ─── Cadastros (as opções da tela, como o servidor devolve) ─────────────
const OPERACAO = { id: "t-roc", nome_tipo: "Roçada", categoria: "PASTAGEM", ativo: true };
/** Operação antiga (cadastro de antes da D-PROD-258) que exige máquina. */
const OPERACAO_COM_MAQUINA = { id: "t-grad", nome_tipo: "Gradeação", categoria: "PREPARO_SOLO", ativo: true, exige_maquina: true };
const PASTO = { id: "area-A", nome: "PASTO 01", tamanho_hectares: 22 };
const TRATOR = { id: "b1", numero: "2", codigo_frota: "TP-02", nome: "Trator", natureza: "MAQUINA" };
const PULVERIZADOR = { id: "b3", numero: "4", codigo_frota: "PL-01", nome: "Pulverizador", natureza: "MAQUINA" };
const GRADE = { id: "i1", numero: "9", codigo_frota: "GR-01", nome: "Grade", natureza: "IMPLEMENTO" };
const MEDIDORES = /** @type {Record<string, any>} */ ({
  b1: { medidor_tipo: "HORIMETRO", medidor_unidade: "h", sem_medidor: false, leitura_vigente: { leitura: "1550.0000", data: "2026-11-12", origem: "ATIVIDADE" }, salto_maximo_medidor: null },
  b3: { medidor_tipo: "HORIMETRO", medidor_unidade: "h", sem_medidor: false, leitura_vigente: { leitura: "300.0000", data: "2026-11-10", origem: "CADASTRO" }, salto_maximo_medidor: null },
});
const PRODUTOS = [
  { id: "p1", nome: "Glifosato", unidade: "L", unidade_principal_estoque: "L" },
  { id: "p2", nome: "Ureia", unidade: "KG", unidade_principal_estoque: "KG" },
];
const LOCAIS = /** @type {Record<string, any[]>} */ ({
  p1: [{ local_estoque_id: "l1", local_nome: "Galpão", disponivel: "300.0000", unidade: "L" }],
  p2: [{ local_estoque_id: "l2", local_nome: "Silo", disponivel: "900.0000", unidade: "KG" }],
});
const MAO_OBRA = [
  { id: "f1", nome: "José Silva", origem: "FUNCIONARIO", funcionario_tipo: "MENSALISTA", funcionario_custo_hora: "20.0000", funcionario_custo_diaria: "160.0000" },
  { id: "f3", nome: "Pedro Lima", origem: "FUNCIONARIO", funcionario_tipo: "DIARISTA", funcionario_custo_hora: null, funcionario_custo_diaria: "150.0000" },
];
const SERVICOS = [
  { id: "s1", numero: "1", nome: "Frete", unidade: "KM", valor_referencia: "5.0000" },
  { id: "s2", numero: "2", nome: "Roçada terceirizada", unidade: "HA", valor_referencia: "80.0000" },
];
const PARCEIROS = [{ id: "pp1", nome: "Transportes Silva" }];

// ─── Backend falso (só a borda de rede) ─────────────────────────────────
/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** Resposta injetada no PRÓXIMO registro. @type {{ status: number, body?: unknown } | null} */
let proxima;
/** O PRÓXIMO registro grava e a resposta se perde na rede (resultado incerto). */
let perderResposta = false;
/** operation_id → resposta gravada (o reenvio igual devolve o gravado, sem gravar outra vez). @type {Map<string, any>} */
let gravados;
let proximoId = 0;

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, query, body }) => {
  const partes = path.split("/").filter(Boolean);
  if (partes[0] === "atividades-opcoes" && method === "GET") {
    const recurso = partes[1];
    if (recurso === "medidor") return { status: 200, body: MEDIDORES[String(query.get("bem_id"))] ?? {} };
    if (recurso === "locais") return { status: 200, body: { itens: LOCAIS[String(query.get("produto_id"))] ?? [] } };
    const porRecurso = /** @type {Record<string, any[]>} */ ({
      bens: [TRATOR, PULVERIZADOR],
      implementos: [GRADE],
      produtos: PRODUTOS,
      "mao-obra": MAO_OBRA,
      servicos: SERVICOS,
      "parceiros-servico": PARCEIROS,
      operadores: [],
    });
    return { status: 200, body: { itens: porRecurso[recurso] ?? [], has_more: false, next_cursor: null } };
  }
  if (partes[0] === "atividades-por-area" && method === "GET") return { status: 200, body: { area_id: partes[1], mes: "2026-11", atividades: [], custos: null } };
  if (path === "/atividades/registrar" && method === "POST") {
    if (proxima) {
      const r = proxima;
      proxima = null;
      return r;
    }
    if (gravados.has(body.operation_id)) return { status: 200, body: { ...gravados.get(body.operation_id), replay: true } };
    proximoId += 1;
    const gravado = { apontamento: { id: `apr${proximoId}`, data_operacional: body.data_operacional }, atividade: { id: "at-9" }, alertas: [], registro: { atividade_criada: true, atividade_id: "at-9" }, replay: false };
    gravados.set(body.operation_id, gravado);
    if (perderResposta) {
      perderResposta = false;
      throw new TypeError("Failed to fetch");
    }
    return { status: 201, body: gravado };
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
  proxima = null;
  perderResposta = false;
  gravados = new Map();
  proximoId = 0;
  confirmacao.confirmar.mockResolvedValue(true);
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
  const onFechar = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <JanelaRegistroDeCampo tipo={OPERACAO} area={PASTO} onFechar={onFechar} {...props} />
    </QueryClientProvider>,
  );
  const janela = await screen.findByTestId("janela-registro-de-campo");
  return { janela, onFechar };
};
const registros = () => backend.chamadas.filter((c) => c.method === "POST" && c.path === "/atividades/registrar");
const escolherNoSeletor = async (/** @type {HTMLElement} */ raiz, /** @type {string} */ testId, /** @type {RegExp|string} */ nome) => {
  await waitFor(() => expect(within(raiz).getByTestId(testId)).not.toBeDisabled());
  fireEvent.click(within(raiz).getByTestId(testId));
  fireEvent.click(await screen.findByRole("option", { name: nome }));
  await waitFor(() => expect(screen.queryByTestId(`${testId}-painel`)).toBeNull());
};
/** O editor aberto da seção (`insumo`, `maquina`, `pessoa`, `servico`). @param {HTMLElement} janela @param {string} secao */
const editorDe = (janela, secao) => within(janela).getByTestId(`registro-${secao}-editor`);
/** "Incluir" / "Atualizar" do editor e espera ele fechar. @param {HTMLElement} janela @param {string} secao */
const confirmarEditor = async (janela, secao) => {
  fireEvent.click(within(editorDe(janela, secao)).getByTestId(`registro-${secao}-editor-incluir`));
  await waitFor(() => expect(within(janela).queryByTestId(`registro-${secao}-editor`)).toBeNull());
};
/** Abre o editor de insumo, escolhe o produto (o único local vem escolhido) e digita a quantidade. */
const preencherInsumo = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ produto, /** @type {string} */ local, /** @type {string} */ quantidade) => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
  const editor = editorDe(janela, "insumo");
  await escolherNoSeletor(editor, "registro-produto-produto", produto);
  await waitFor(() => expect(within(editor).getByRole("combobox", { name: /Local do estoque/ })).toHaveTextContent(local));
  fireEvent.change(within(editor).getByTestId("registro-produto-quantidade"), { target: { value: quantidade } });
  return editor;
};
const incluirInsumo = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ produto, /** @type {string} */ local, /** @type {string} */ quantidade) => {
  await preencherInsumo(janela, produto, local, quantidade);
  await confirmarEditor(janela, "insumo");
};
/** Abre o editor de máquina, escolhe o bem (a leitura inicial vem da vigente) e digita a leitura final. */
const preencherMaquina = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ bem, /** @type {string} */ inicialSugerida, /** @type {string} */ final, /** @type {RegExp|null} */ implemento = null) => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-maquina"));
  const editor = editorDe(janela, "maquina");
  await escolherNoSeletor(editor, "registro-maquina-bem", bem);
  if (implemento) await escolherNoSeletor(editor, "registro-maquina-implemento", implemento);
  await waitFor(() => expect(within(editor).getByTestId("registro-maquina-leitura-inicial")).toHaveValue(inicialSugerida));
  fireEvent.change(within(editor).getByTestId("registro-maquina-leitura-final"), { target: { value: final } });
  return editor;
};
const incluirMaquina = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ bem, /** @type {string} */ inicialSugerida, /** @type {string} */ final, /** @type {RegExp|null} */ implemento = null) => {
  await preencherMaquina(janela, bem, inicialSugerida, final, implemento);
  await confirmarEditor(janela, "maquina");
};
const preencherPessoa = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ pessoa, /** @type {string} */ quantidade) => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-pessoa"));
  const editor = editorDe(janela, "pessoa");
  await escolherNoSeletor(editor, "registro-mao-obra-parceiro", pessoa);
  fireEvent.change(within(editor).getByTestId("registro-mao-obra-quantidade"), { target: { value: quantidade } });
  return editor;
};
const incluirPessoa = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ pessoa, /** @type {string} */ quantidade) => {
  await preencherPessoa(janela, pessoa, quantidade);
  await confirmarEditor(janela, "pessoa");
};
const incluirServico = async (/** @type {HTMLElement} */ janela, /** @type {RegExp} */ servico, /** @type {string} */ quantidade, /** @type {RegExp|null} */ prestador = null) => {
  fireEvent.click(within(janela).getByTestId("registro-incluir-servico"));
  const editor = editorDe(janela, "servico");
  await escolherNoSeletor(editor, "registro-servico-servico", servico);
  if (prestador) await escolherNoSeletor(editor, "registro-servico-parceiro", prestador);
  fireEvent.change(within(editor).getByTestId("registro-servico-quantidade"), { target: { value: quantidade } });
  await confirmarEditor(janela, "servico");
};
/** Os textos das células de uma linha da tabela (sem a coluna do ✕). @param {HTMLElement} linha */
const celulas = (linha) => [...linha.querySelectorAll("td")].slice(0, -1).map((td) => td.textContent.replace(/\s+/g, " ").trim());
/** As linhas (data-testid) de uma tabela. @param {HTMLElement} janela @param {string} plural */
const linhasDaTabela = (janela, plural) => [...within(janela).getByTestId(`registro-${plural}-tabela`).querySelectorAll("tbody > tr[data-testid]")];
const salvar = (/** @type {HTMLElement} */ janela) => fireEvent.click(within(janela).getByTestId("registro-de-campo-salvar"));

// ═════════════════════════════════════════════════════════════════════════
describe("RV-ENVIO — várias linhas num envio só", () => {
  it("RV-ENVIO-1 — 2 insumos + 2 máquinas + 2 pessoas + 2 serviços: as tabelas mostram os itens e vai UM POST com arrays de 2, na ordem das tabelas", async () => {
    const { janela, onFechar } = await montar();
    // Seções vazias: só o "+ Incluir …", sem tabela.
    for (const plural of ["insumos", "maquinas", "pessoas", "servicos"]) expect(within(janela).queryByTestId(`registro-${plural}-tabela`)).toBeNull();
    expect(within(janela).getByRole("button", { name: "Incluir insumo" })).toBeTruthy();

    await incluirInsumo(janela, /Glifosato/, "Galpão", "44");
    await incluirInsumo(janela, /Ureia/, "Silo", "100");
    await incluirMaquina(janela, /TP-02/, "1.550", "1556,5", /GR-01/);
    await incluirMaquina(janela, /PL-01/, "300", "303");
    await incluirPessoa(janela, /José Silva/, "8");
    await incluirPessoa(janela, /Pedro Lima/, "1");
    await incluirServico(janela, /Frete/, "10", /Transportes Silva/);
    await incluirServico(janela, /Roçada terceirizada/, "22");
    fireEvent.change(within(janela).getByTestId("registro-de-campo-hectares"), { target: { value: "22" } });

    // O que cada tabela mostra (os cabeçalhos da maquete).
    const cabecalhos = (/** @type {string} */ plural) => [...within(janela).getByTestId(`registro-${plural}-tabela`).querySelectorAll("thead th")].map((th) => th.textContent.trim());
    expect(cabecalhos("insumos")).toEqual(["Insumo", "Local de estoque", "Dose/ha", "Total", "Remover"]);
    expect(cabecalhos("maquinas")).toEqual(["Máquina", "Implemento", "Uso", "Remover"]);
    expect(cabecalhos("pessoas")).toEqual(["Pessoa", "Medida", "Quantidade", "Remover"]);
    expect(cabecalhos("servicos")).toEqual(["Serviço", "Prestador", "Quantidade", "Total", "Remover"]);
    expect(linhasDaTabela(janela, "insumos").map(celulas)).toEqual([
      ["Glifosato", "Galpão", "2 L/ha", "44 L"],
      ["Ureia", "Silo", "4,5455 kg/ha", "100 kg"],
    ]);
    expect(linhasDaTabela(janela, "maquinas").map(celulas)).toEqual([
      ["TP-02 — Trator", "GR-01 — Grade", "6,5 h"],
      ["PL-01 — Pulverizador", "—", "3 h"],
    ]);
    expect(linhasDaTabela(janela, "pessoas").map(celulas)).toEqual([
      ["José Silva", "Hora", "8 h"],
      ["Pedro Lima", "Diária", "1 diária(s)"],
    ]);
    const servicos = linhasDaTabela(janela, "servicos").map(celulas);
    expect(servicos[0].slice(0, 3)).toEqual(["Frete", "Transportes Silva", "10 KM"]);
    expect(servicos[0][3]).toMatch(/^R\$\s50,00$/);
    expect(servicos[1].slice(0, 3)).toEqual(["Roçada terceirizada", "—", "22 HA"]);
    expect(servicos[1][3]).toMatch(/^R\$\s1\.760,00$/);
    expect(within(janela).getByRole("button", { name: "Remover serviço 2" })).toBeTruthy();

    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toEqual({
      empresa_id: "emp-1",
      area_id: "area-A",
      tipo_atividade_id: "t-roc",
      data_operacional: HOJE,
      area_executada_dia: "22",
      operation_id: expect.any(String),
      maquinas: [
        { bem_id: "b1", implemento_bem_id: "i1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1556.5" },
        { bem_id: "b3", sem_medidor: false, leitura_inicial: "300", leitura_final: "303" },
      ],
      produtos: [
        { produto_id: "p1", local_estoque_id: "l1", quantidade: "44" },
        { produto_id: "p2", local_estoque_id: "l2", quantidade: "100" },
      ],
      mao_obra: [
        { parceiro_id: "f1", tipo_medida: "HORA", quantidade: "8" },
        { parceiro_id: "f3", tipo_medida: "DIARIA", quantidade: "1" },
      ],
      servicos: [
        { servico_id: "s1", fornecedor_parceiro_id: "pp1", quantidade: "10", valor_unitario: "5" },
        { servico_id: "s2", quantidade: "22", valor_unitario: "80" },
      ],
    });
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "Roçada registrada em PASTO 01.");
  });

  it("RV-ENVIO-2 — editor vazio não vai; editor preenchido entra sozinho ao salvar (vira linha da tabela)", async () => {
    const { janela } = await montar();
    await incluirMaquina(janela, /TP-02/, "1.550", "1554");
    // Insumo: editor aberto e vazio (sem produto) — não conta.
    fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
    expect(editorDe(janela, "insumo")).toBeTruthy();
    // Pessoa: preenchida, sem clicar em "Incluir".
    await preencherPessoa(janela, /José Silva/, "8");
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    const { body } = registros()[0];
    expect(body.maquinas).toEqual([{ bem_id: "b1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1554" }]);
    expect(body.mao_obra).toEqual([{ parceiro_id: "f1", tipo_medida: "HORA", quantidade: "8" }]);
    expect(body).not.toHaveProperty("produtos");
    expect(body).not.toHaveProperty("servicos");
  });

  it("RV-ENVIO-3 — editor preenchido e inválido segura o envio e mostra os erros nele; corrigido, vai", async () => {
    const { janela } = await montar();
    fireEvent.click(within(janela).getByTestId("registro-incluir-servico"));
    const editor = editorDe(janela, "servico");
    await escolherNoSeletor(editor, "registro-servico-servico", /Frete/);
    salvar(janela);
    expect(await within(editor).findByText("Informe a quantidade.")).toBeTruthy();
    expect(registros()).toHaveLength(0);
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", "Revise os campos destacados.");
    // "Incluir" sem o campo-chave aponta só ele.
    fireEvent.click(within(janela).getByTestId("registro-incluir-pessoa"));
    fireEvent.click(within(editorDe(janela, "pessoa")).getByTestId("registro-pessoa-editor-incluir"));
    expect(await within(editorDe(janela, "pessoa")).findByText("Escolha o funcionário ou terceiro.")).toBeTruthy();
    fireEvent.change(within(editor).getByTestId("registro-servico-quantidade"), { target: { value: "3" } });
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.servicos).toEqual([{ servico_id: "s1", quantidade: "3", valor_unitario: "5" }]);
    expect(registros()[0].body).not.toHaveProperty("mao_obra");
  });

  it("RV-ENVIO-4 — sem resposta, \"Repetir o mesmo envio\" reenvia o MESMO corpo com a MESMA chave (nada é gravado duas vezes)", async () => {
    const { janela, onFechar } = await montar();
    await incluirInsumo(janela, /Glifosato/, "Galpão", "44");
    await incluirServico(janela, /Frete/, "10");
    await incluirServico(janela, /Roçada terceirizada/, "22");
    perderResposta = true;
    salvar(janela);
    expect(await within(janela).findByTestId("resultado-incerto")).toBeTruthy();
    expect(within(janela).getByTestId("registro-de-campo-salvar")).toHaveTextContent("Repetir o mesmo envio");
    // Sem resposta não há recusa para pôr numa linha.
    expect(janela.querySelector("[data-recusada]")).toBeNull();
    salvar(janela);
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    const [primeiro, segundo] = registros();
    expect(registros()).toHaveLength(2);
    expect(segundo.body).toEqual(primeiro.body);
    expect(segundo.body.operation_id).toBe(primeiro.body.operation_id);
    expect(segundo.body.servicos).toHaveLength(2);
    expect(proximoId).toBe(1);
    expect(confirmacao.confirmar).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("RV-TABELA — editar, remover e recalcular", () => {
  it("RV-TABELA-1 — clicar na linha abre o editor nela (Atualizar troca no lugar); com o editor preenchido as outras linhas não abrem; Cancelar não muda", async () => {
    const { janela } = await montar();
    await incluirPessoa(janela, /José Silva/, "8");
    await incluirPessoa(janela, /Pedro Lima/, "2");
    fireEvent.click(within(janela).getByTestId("registro-pessoa-linha-1"));
    const editor = editorDe(janela, "pessoa");
    expect(editor).toHaveAttribute("aria-label", "Editar pessoa 1");
    expect(within(editor).getByTestId("registro-pessoa-editor-incluir")).toHaveTextContent("Atualizar");
    expect(within(editor).getByTestId("registro-mao-obra-quantidade")).toHaveValue("8");
    // Um editor por seção: sem o "+ Incluir pessoa" e sem abrir a outra linha por cima do que está sendo editado.
    expect(within(janela).queryByTestId("registro-incluir-pessoa")).toBeNull();
    expect(within(janela).getByTestId("registro-pessoa-linha-2-abrir")).toBeDisabled();
    expect(within(janela).getByTestId("registro-pessoa-linha-1")).toHaveAttribute("aria-current", "true");
    fireEvent.change(within(editor).getByTestId("registro-mao-obra-quantidade"), { target: { value: "6" } });
    await confirmarEditor(janela, "pessoa");
    expect(linhasDaTabela(janela, "pessoas").map(celulas)).toEqual([
      ["José Silva", "Hora", "6 h"],
      ["Pedro Lima", "Diária", "2 diária(s)"],
    ]);
    // Cancelar descarta o que foi mexido.
    fireEvent.click(within(janela).getByTestId("registro-pessoa-linha-2-abrir"));
    fireEvent.change(within(editorDe(janela, "pessoa")).getByTestId("registro-mao-obra-quantidade"), { target: { value: "9" } });
    fireEvent.click(within(editorDe(janela, "pessoa")).getByTestId("registro-pessoa-editor-cancelar"));
    expect(within(janela).queryByTestId("registro-pessoa-editor")).toBeNull();
    expect(celulas(within(janela).getByTestId("registro-pessoa-linha-2"))).toEqual(["Pedro Lima", "Diária", "2 diária(s)"]);
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.mao_obra).toEqual([
      { parceiro_id: "f1", tipo_medida: "HORA", quantidade: "6" },
      { parceiro_id: "f3", tipo_medida: "DIARIA", quantidade: "2" },
    ]);
  });

  it("RV-TABELA-2 — ✕ tira a linha e renumera; sem itens a tabela some", async () => {
    const { janela } = await montar();
    await incluirServico(janela, /Frete/, "10");
    await incluirServico(janela, /Roçada terceirizada/, "22");
    fireEvent.click(within(janela).getByRole("button", { name: "Remover serviço 1" }));
    expect(linhasDaTabela(janela, "servicos")).toHaveLength(1);
    expect(celulas(within(janela).getByTestId("registro-servico-linha-1"))[0]).toBe("Roçada terceirizada");
    expect(within(janela).queryByTestId("registro-servico-linha-2")).toBeNull();
    expect(within(janela).queryByRole("button", { name: "Remover serviço 2" })).toBeNull();
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.servicos).toEqual([{ servico_id: "s2", quantidade: "22", valor_unitario: "80" }]);
  });

  it("RV-TABELA-3 — a dose/ha dos insumos acompanha os Hectares feitos de agora (sem hectares, o tamanho da área)", async () => {
    const { janela } = await montar();
    await incluirInsumo(janela, /Glifosato/, "Galpão", "44");
    // Sem hectares feitos: a dose usa o tamanho da área (22 ha).
    expect(celulas(within(janela).getByTestId("registro-insumo-linha-1"))).toEqual(["Glifosato", "Galpão", "2 L/ha", "44 L"]);
    fireEvent.change(within(janela).getByTestId("registro-de-campo-hectares"), { target: { value: "11" } });
    expect(celulas(within(janela).getByTestId("registro-insumo-linha-1"))).toEqual(["Glifosato", "Galpão", "4 L/ha", "44 L"]);
  });

  it("RV-TABELA-4 — o \"+ Incluir\" some no 20º item (o máximo do servidor por coleção) e volta ao tirar um", async () => {
    const { janela } = await montar();
    for (let i = 1; i <= 20; i += 1) {
      expect(within(janela).getByTestId("registro-incluir-servico")).toBeTruthy();
      await incluirServico(janela, /Frete/, String(i));
    }
    expect(linhasDaTabela(janela, "servicos")).toHaveLength(20);
    expect(within(janela).queryByTestId("registro-incluir-servico")).toBeNull();
    // As outras seções continuam com o botão.
    expect(within(janela).getByTestId("registro-incluir-insumo")).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: "Remover serviço 20" }));
    expect(within(janela).getByTestId("registro-incluir-servico")).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("RV-RECUSA — a recusa do servidor na linha certa (índice no array enviado)", () => {
  it("RV-RECUSA-1 — salto com linha_indice 1: erro na máquina 2, editor aberto nela com a justificativa; corrigido, o reenvio leva a justificativa só nela", async () => {
    const { janela } = await montar();
    await incluirMaquina(janela, /TP-02/, "1.550", "1556");
    await incluirMaquina(janela, /PL-01/, "300", "350");
    // Um editor de máquina aberto e vazio no envio: não vai e não desloca o índice.
    fireEvent.click(within(janela).getByTestId("registro-incluir-maquina"));
    proxima = erroServidor(422, "ATIVIDADE_SALTO_MEDIDOR", {
      field: "justificativa_salto",
      reason: "salto_acima_do_teto",
      details: { entidade: "linha_maquina", linha_indice: 1, quantidade_uso: "50.0000", salto_maximo: "24.0000", medidor_unidade: "h" },
    });
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.maquinas).toHaveLength(2);
    const mensagem = "O uso da máquina (50 h) passa do teto de salto do medidor (24 h). Informe a justificativa (3 a 500 caracteres) e envie de novo. Nada foi gravado.";
    expect(await within(janela).findByTestId("registro-maquina-linha-2-erro")).toHaveTextContent(mensagem);
    expect(within(janela).getByTestId("registro-maquina-linha-2")).toHaveAttribute("data-recusada");
    // A marca visual da linha recusada (e não a de "em edição", embora o editor esteja nela).
    expect(within(janela).getByTestId("registro-maquina-linha-2")).toHaveClass("is-recusada");
    expect(within(janela).queryByTestId("registro-maquina-linha-1-erro")).toBeNull();
    expect(within(janela).getByTestId("registro-maquina-linha-1")).not.toHaveAttribute("data-recusada");
    // O editor abriu na máquina 2 (no lugar do vazio), com o aviso do salto e a justificativa apontada.
    const editor = editorDe(janela, "maquina");
    expect(editor).toHaveAttribute("aria-label", "Editar máquina 2");
    expect(within(editor).getByTestId("registro-maquina-bem").getAttribute("aria-label")).toMatch(/PL-01/);
    expect(await within(editor).findByTestId("registro-maquina-salto")).toBeTruthy();
    expect(within(editor).getByText(mensagem)).toBeTruthy();
    expect(notify.notifyWarning).toHaveBeenCalledWith("Atenção", mensagem);
    // Sem a justificativa, "Atualizar" não passa.
    fireEvent.click(within(editor).getByTestId("registro-maquina-editor-incluir"));
    expect(await within(editor).findByText(/Informe a justificativa do salto/)).toBeTruthy();
    fireEvent.change(within(editor).getByLabelText(/Justificativa do salto/), { target: { value: "horímetro trocado" } });
    await confirmarEditor(janela, "maquina");
    expect(within(janela).queryByTestId("registro-maquina-linha-2-erro")).toBeNull();
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(2));
    const [primeira, segunda] = registros()[1].body.maquinas;
    expect(primeira).toEqual({ bem_id: "b1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1556" });
    expect(segunda).toEqual({ bem_id: "b3", sem_medidor: false, leitura_inicial: "300", leitura_final: "350", justificativa_salto: "horímetro trocado" });
  });

  it("RV-RECUSA-2 — saldo com colecao 'produtos' e indice 1: erro no insumo 2, editor aberto nele com a quantidade apontada", async () => {
    const { janela } = await montar();
    await incluirInsumo(janela, /Glifosato/, "Galpão", "44");
    await incluirInsumo(janela, /Ureia/, "Silo", "100");
    // Um editor de insumo aberto e vazio no envio: não vai e não desloca o índice.
    fireEvent.click(within(janela).getByTestId("registro-incluir-insumo"));
    proxima = erroServidor(422, "ESTOQUE_SALDO_INSUFICIENTE", {
      field: "quantidade",
      details: { colecao: "produtos", indice: 1, produto_id: "p2", local_estoque_id: "l2", disponivel: "80.0000", solicitado: "100.0000", unidade: "KG" },
    });
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.produtos.map((/** @type {any} */ p) => p.produto_id)).toEqual(["p1", "p2"]);
    const mensagem = "Saldo insuficiente deste produto no local escolhido: disponível 80 kg, pedido 100 kg. Nada foi gravado.";
    expect(await within(janela).findByTestId("registro-insumo-linha-2-erro")).toHaveTextContent(mensagem);
    expect(within(janela).queryByTestId("registro-insumo-linha-1-erro")).toBeNull();
    const editor = editorDe(janela, "insumo");
    expect(editor).toHaveAttribute("aria-label", "Editar insumo 2");
    expect(within(editor).getByTestId("registro-produto-quantidade")).toHaveValue("100");
    expect(within(editor).getByText(mensagem)).toBeTruthy();
    // Corrigida a quantidade, a linha fica certa e o reenvio leva o novo valor.
    fireEvent.change(within(editor).getByTestId("registro-produto-quantidade"), { target: { value: "80" } });
    await confirmarEditor(janela, "insumo");
    expect(within(janela).queryByTestId("registro-insumo-linha-2-erro")).toBeNull();
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(2));
    expect(registros()[1].body.produtos).toEqual([
      { produto_id: "p1", local_estoque_id: "l1", quantidade: "44" },
      { produto_id: "p2", local_estoque_id: "l2", quantidade: "80" },
    ]);
  });

  it("RV-RECUSA-3 — pessoa e serviço também: linha_indice com a entidade da linha", async () => {
    const { janela } = await montar();
    await incluirPessoa(janela, /José Silva/, "8");
    await incluirPessoa(janela, /Pedro Lima/, "1");
    proxima = erroServidor(422, "ATIVIDADE_LINHA_INVALIDA", {
      field: "parceiro_id",
      reason: "parceiro_invalido",
      details: { entidade: "linha_mao_obra", linha_indice: 1, field: "parceiro_id", reason: "parceiro_invalido" },
    });
    salvar(janela);
    expect(await within(janela).findByTestId("registro-pessoa-linha-2-erro")).toHaveTextContent("O funcionário ou terceiro escolhido não pode ser usado");
    expect(editorDe(janela, "pessoa")).toHaveAttribute("aria-label", "Editar pessoa 2");
    expect(within(janela).queryByTestId("registro-pessoa-linha-1-erro")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("RV-REGRAS — exige máquina, Salvar e novo, celular e o limite do servidor", () => {
  it("RV-REGRAS-1 — operação antiga que exige máquina: sem máquina, o editor abre apontando o campo; com UMA máquina, vai", async () => {
    const { janela } = await montar({ tipo: OPERACAO_COM_MAQUINA });
    salvar(janela);
    const editor = editorDe(janela, "maquina");
    expect(await within(editor).findByText("Escolha a máquina.")).toBeTruthy();
    expect(registros()).toHaveLength(0);
    await escolherNoSeletor(editor, "registro-maquina-bem", /TP-02/);
    await waitFor(() => expect(within(editor).getByTestId("registro-maquina-leitura-inicial")).toHaveValue("1.550"));
    fireEvent.change(within(editor).getByTestId("registro-maquina-leitura-final"), { target: { value: "1552" } });
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toMatchObject({ tipo_atividade_id: "t-grad", maquinas: [{ bem_id: "b1", leitura_inicial: "1550", leitura_final: "1552" }] });
  });

  it("RV-REGRAS-2 — \"Salvar e novo\" grava e deixa as tabelas vazias, sem editor aberto", async () => {
    const { janela, onFechar } = await montar();
    await incluirInsumo(janela, /Glifosato/, "Galpão", "44");
    await incluirMaquina(janela, /TP-02/, "1.550", "1556");
    fireEvent.click(within(janela).getByTestId("registro-incluir-servico"));
    fireEvent.change(within(janela).getByTestId("registro-de-campo-hectares"), { target: { value: "5" } });
    fireEvent.click(within(janela).getByTestId("registro-de-campo-salvar-novo"));
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).toMatchObject({ produtos: [{ produto_id: "p1" }], maquinas: [{ bem_id: "b1" }] });
    await waitFor(() => expect(within(janela).queryByTestId("registro-insumos-tabela")).toBeNull());
    expect(onFechar).not.toHaveBeenCalled();
    for (const plural of ["insumos", "maquinas", "pessoas", "servicos"]) expect(within(janela).queryByTestId(`registro-${plural}-tabela`)).toBeNull();
    for (const secao of ["insumo", "maquina", "pessoa", "servico"]) {
      expect(within(janela).queryByTestId(`registro-${secao}-editor`)).toBeNull();
      expect(within(janela).getByTestId(`registro-incluir-${secao}`)).toBeTruthy();
    }
    expect(within(janela).getByTestId("registro-de-campo-hectares")).toHaveValue("");
  });

  it("RV-REGRAS-3 — no celular a seção é uma pilha de cartões (sem tabela), com o mesmo Incluir, editor e ✕", async () => {
    vi.stubGlobal("matchMedia", (/** @type {string} */ query) => ({ matches: query.includes("max-width: 639px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
    const { janela } = await montar();
    expect(janela.querySelector(".b1-janela--tela-cheia")).toBeTruthy();
    await incluirInsumo(janela, /Glifosato/, "Galpão", "44");
    await incluirMaquina(janela, /TP-02/, "1.550", "1556,5");
    expect(janela.querySelector("table")).toBeNull();
    const insumos = within(janela).getByTestId("registro-insumos-tabela");
    expect(insumos.tagName).toBe("UL");
    const cartao = within(janela).getByTestId("registro-insumo-linha-1");
    expect(cartao).toHaveClass("b1-tipo-card");
    expect(cartao).toHaveTextContent("Glifosato");
    expect(cartao).toHaveTextContent("Local de estoque: Galpão · Dose/ha: 2 L/ha · Total: 44 L");
    expect(within(janela).getByTestId("registro-maquina-linha-1")).toHaveTextContent("Uso: 6,5 h");
    // O cartão abre o editor; o ✕ tira o item.
    fireEvent.click(within(janela).getByTestId("registro-maquina-linha-1-abrir"));
    expect(editorDe(janela, "maquina")).toHaveAttribute("aria-label", "Editar máquina 1");
    fireEvent.click(within(editorDe(janela, "maquina")).getByTestId("registro-maquina-editor-cancelar"));
    fireEvent.click(within(janela).getByRole("button", { name: "Remover insumo 1" }));
    expect(within(janela).queryByTestId("registro-insumos-tabela")).toBeNull();
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.maquinas).toEqual([{ bem_id: "b1", sem_medidor: false, leitura_inicial: "1550", leitura_final: "1556.5" }]);
    expect(registros()[0].body).not.toHaveProperty("produtos");
  });

  it("RV-REGRAS-4 — o máximo de linhas por coleção é o mesmo do servidor (LINHAS_NO_LANCAMENTO_MAXIMO)", async () => {
    const { LINHAS_NO_LANCAMENTO_MAXIMO } = await import("@/lib/atividadeLinhasRegras");
    const fonte = readFileSync("backend/src/modules/atividades/atividadeComum.js", "utf8");
    const doServidor = Number(/export const LINHAS_NO_LANCAMENTO_MAXIMO = (\d+);/.exec(fonte)?.[1]);
    expect(doServidor).toBe(20);
    expect(LINHAS_NO_LANCAMENTO_MAXIMO).toBe(doServidor);
  });

  it("RV-REGRAS-5 — itemDaRecusa: o índice aponta o item enviado; sem índice, só o caso sem dúvida; sem resposta, nada", async () => {
    const { itemDaRecusa, itensVaziosDoRegistro } = await import("@/lib/registroDeCampoRegras");
    const item = (/** @type {string} */ chave) => ({ chave, form: {} });
    const enviados = { ...itensVaziosDoRegistro(), maquinas: [item("m1"), item("m2")], produtos: [item("p1"), item("p2")], mao_obra: [item("o1")], servicos: [item("s1"), item("s2")] };
    /** A recusa como `lerErroGestao` a lê (o código e os detalhes do servidor). @param {string} code @param {{ field?: string, details?: Record<string, unknown> }} [extra] */
    const recusa = (code, extra = {}) => ({ code, details: { ...(extra.details ?? {}), ...(extra.field ? { field: extra.field } : {}) } });
    expect(itemDaRecusa(recusa("ATIVIDADE_SALTO_MEDIDOR", { details: { entidade: "linha_maquina", linha_indice: 1 } }), enviados)).toMatchObject({ colecao: "maquinas", numero: 2, item: { chave: "m2" } });
    expect(itemDaRecusa(recusa("ESTOQUE_SALDO_INSUFICIENTE", { details: { colecao: "produtos", indice: 0 } }), enviados)).toMatchObject({ colecao: "produtos", numero: 1, item: { chave: "p1" } });
    expect(itemDaRecusa(recusa("ATIVIDADE_LINHA_INVALIDA", { field: "servico_id", details: { entidade: "linha_servico", linha_indice: 1 } }), enviados)).toMatchObject({ colecao: "servicos", item: { chave: "s2" } });
    // Índice fora do enviado: nenhum.
    expect(itemDaRecusa(recusa("ATIVIDADE_SALTO_MEDIDOR", { details: { entidade: "linha_maquina", linha_indice: 5 } }), enviados)).toBeNull();
    // Sem índice e com dúvida (várias linhas): nenhum; com uma só, ela.
    expect(itemDaRecusa(recusa("ATIVIDADE_LINHA_INVALIDA", { field: "quantidade" }), enviados)).toBeNull();
    const umSo = { ...itensVaziosDoRegistro(), servicos: [item("s9")] };
    expect(itemDaRecusa(recusa("ATIVIDADE_LINHA_INVALIDA", { field: "quantidade" }), umSo)).toMatchObject({ colecao: "servicos", item: { chave: "s9" } });
    expect(itemDaRecusa(recusa("ATIVIDADE_SALTO_MEDIDOR"), { ...enviados, maquinas: [item("m1")] })).toMatchObject({ colecao: "maquinas", item: { chave: "m1" } });
    // Sem resposta do servidor ou recusa do dia: nenhuma linha.
    expect(itemDaRecusa(new TypeError("Failed to fetch"), umSo)).toBeNull();
    expect(itemDaRecusa(recusa("ATIVIDADE_DATA_FUTURA", { field: "data_operacional" }), umSo)).toBeNull();
    expect(itemDaRecusa(recusa("ATIVIDADE_SALTO_MEDIDOR"), null)).toBeNull();
  });
});
