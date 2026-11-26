/**
 * D-PROD-276 (MAIKE-ENTREGA3) — a REFORMA DE PASTAGEM na tela:
 *  - as regras puras (nome sugerido, recuperação × renovação, as reformas do registro, o "Faz parte de", a pergunta da
 *    troca do capim, o "Em reforma desde");
 *  - "Faz parte de" na Nova realização: uma reforma aberta já marcada (vai `planejamento_id`), o "tirar" (não vai), duas
 *    reformas (a escolha é obrigatória; "Não faz parte" não manda nada), o serviço que continua e já está numa reforma, o
 *    serviço sem área (nada) e a recusa do servidor no lugar certo;
 *  - o "Planejar" da reforma (4 campos, o nome sugerido, a natureza, o corpo que sai, a recusa antes da rede);
 *  - a lista: o "Planejar" pergunta o que planejar; a pílula "Reforma" filtra pelo servidor e mostra a barra do custo
 *    (total, R$/ha, por tipo e os serviços); "Concluir reforma" pergunta "Trocar o capim da área para MOMBAÇA?" e manda
 *    `trocar_capim` conforme a resposta (sem a permissão do Cadastro do Mapa, só o "Não, só concluir");
 *  - o mapa: "Em reforma desde 10/09" no Detalhes da área.
 *
 * Componentes, service, API, porta e `nativeHttpClient` reais; mocks só da borda (rede, sessão e cadastros vizinhos).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { API_FAKE, envelope, erroServidor, escolherOpcao, instalarBackendFake } from "./fixtures/gestaoBackendFake.js";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));
const sessao = vi.hoisted(() => ({ acoes: /** @type {Record<string, any>} */ ({}) }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => sessao.acoes,
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-28" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "cli-1", user: { id: "u1" } }) }));
// Diário da máquina (Fase 2): este teste confere o custo da reforma; o usuário é administrador (vê R$).
vi.mock("@/lib/verCustoRegras", async (importOriginal) => ({ ...(await importOriginal()), podeVerCusto: () => true }));
const confirmacao = vi.hoisted(() => ({ confirmar: vi.fn(async () => true) }));
vi.mock("@/lib/maikeConfirmar", () => confirmacao);
const cadastros = vi.hoisted(() => ({ tipos: /** @type {any[]} */ ([]), areas: /** @type {any[]} */ ([]) }));
vi.mock("@/services/tipoAtividadeCadastroService", () => ({
  listarGruposSimples: vi.fn(async () => []),
  listarTiposAtividade: vi.fn(async () => cadastros.tipos),
  criarTipoAtividade: vi.fn(),
  atualizarTipoAtividade: vi.fn(),
  excluirTiposAtividade: vi.fn(),
  listarCentrosDaFazenda: vi.fn(async () => []),
  listarUnidadesDeMedida: vi.fn(async () => []),
}));
vi.mock("@/services/mapaService", async (importOriginal) => ({ ...(await importOriginal()), listarAreasAtivas: vi.fn(async () => cadastros.areas) }));

const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");
const { default: FormularioReforma } = await import("@/components/lancamento-atividades/FormularioReforma");
const { default: AbaDetalhesDaArea } = await import("@/components/mapa/detalhes-area/AbaDetalhesDaArea");
const { default: LancamentoAtividades } = await import("@/pages/LancamentoAtividades");
const regras = await import("@/lib/reformaRegras");

const OPERACOES = [
  { id: "t-grade", nome_tipo: "GRADAGEM", categoria: "PREPARO_SOLO", ativo: true },
  { id: "t-calc", nome_tipo: "CALAGEM", categoria: "TRATO_CULTURAL", ativo: true },
  { id: "t-cerca", nome_tipo: "REFORMA DE CERCA", categoria: "BENFEITORIA", ativo: true },
];
const AROEIRA = { id: "area-aroeira", nome: "PASTO DA AROEIRA", tamanho_hectares: 40, empresa_id: "emp-1", ativo: true, cultura_id: "c-braq", tipo_cultura: "Pastagem" };
const SEDE = { id: "area-sede", nome: "PASTO DA SEDE", tamanho_hectares: 12, empresa_id: "emp-1", ativo: true, cultura_id: "c-mom", tipo_cultura: "Pastagem" };
const AREAS = [AROEIRA, SEDE];
const CULTURAS = [
  { id: "c-mom", codigo: "007", tipo: "PASTAGEM", nome: "MOMBAÇA", especie: "Megathyrsus maximus", cultivar: "Mombaça", ativo: true },
  { id: "c-braq", codigo: "002", tipo: "PASTAGEM", nome: "BRAQUIARINHA", especie: "Urochloa decumbens", cultivar: null, ativo: true },
];
/** As reformas abertas (como o resumo da área devolve). */
const REF_A = { id: "ref-a", numero: "1", nome: "Reforma · PASTO DA AROEIRA · 2026/27", tipo: "REFORMA", data_inicio: "2026-09-10", cultura_alvo_id: "c-mom", cultura_alvo: { id: "c-mom", nome: "MOMBAÇA" }, area_ids: ["area-aroeira"], hectares_na_area: "40.0000" };
const REF_B = { id: "ref-b", numero: "2", nome: "Formação · PASTO DA AROEIRA · 2026/27", tipo: "FORMACAO", data_inicio: "2026-11-01", cultura_alvo_id: null, cultura_alvo: null, area_ids: ["area-aroeira", "area-sede"], hectares_na_area: "40.0000" };

/** A reforma como `GET /planejamentos/:id` devolve: números coerentes (R$ 18.240,00 ÷ 40 ha = R$ 456,00/ha). */
const DETALHE_A = Object.freeze({
  id: "ref-a", empresa_id: "emp-1", numero: "1", nome: REF_A.nome, tipo: "REFORMA", safra_ciclo: "2026/27", cultura_alvo_id: "c-mom",
  cultura_alvo: { id: "c-mom", codigo: "007", nome: "MOMBAÇA", especie: "Megathyrsus maximus", cultivar: "Mombaça" },
  data_inicio: "2026-09-10", status: "ABERTO", data_conclusao: null, versao: 3, hectares: "40.0000",
  areas: [{ area_id: "area-aroeira", nome: "PASTO DA AROEIRA", hectares: "40.0000", tamanho_hectares: "40.0000", cultura_id: "c-braq", cultura: { id: "c-braq", nome: "BRAQUIARINHA" } }],
  custo: {
    custo_total: "18240.0000", hectares: "40.0000", custo_por_ha: "456.0000",
    por_tipo: [
      { tipo_fixo: "PREPARO_SOLO", rotulo: "Preparo do solo", custo_total: "6400.0000", servicos: 1 },
      { tipo_fixo: "PLANTIO", rotulo: "Plantio de pastagem", custo_total: "3000.0000", servicos: 1 },
      { tipo_fixo: "TRATO_CULTURAL", rotulo: "Fertilização", custo_total: "7240.0000", servicos: 1 },
      { tipo_fixo: "APLICACAO", rotulo: "Aplicação", custo_total: "1600.0000", servicos: 1 },
    ],
    servicos: [
      { atividade_id: "a-form", numero: "21", nome: "Formicida · PASTO DA AROEIRA · set/26", tipo_atividade_nome: "ISCA FORMICIDA", tipo_fixo: "APLICACAO", status: "CONCLUIDA", situacao: "CONCLUIDA", data_inicio: "2026-09-03", primeiro_dia: "2026-09-03", ultimo_dia: "2026-09-03", data_conclusao: "2026-09-03", custo_total: "1600.0000", conta_no_custo: true },
      { atividade_id: "a-calc", numero: "22", nome: "Calagem · PASTO DA AROEIRA · set/26", tipo_atividade_nome: "CALAGEM", tipo_fixo: "TRATO_CULTURAL", status: "CONCLUIDA", situacao: "CONCLUIDA", data_inicio: "2026-09-12", primeiro_dia: "2026-09-12", ultimo_dia: "2026-09-14", data_conclusao: "2026-09-14", custo_total: "7240.0000", conta_no_custo: true },
      { atividade_id: "a-grade", numero: "25", nome: "Gradagem · PASTO DA AROEIRA · out/26", tipo_atividade_nome: "GRADAGEM", tipo_fixo: "PREPARO_SOLO", status: "CONCLUIDA", situacao: "CONCLUIDA", data_inicio: "2026-10-20", primeiro_dia: "2026-10-20", ultimo_dia: "2026-10-23", data_conclusao: "2026-10-23", custo_total: "6400.0000", conta_no_custo: true },
      { atividade_id: "a-plant", numero: "30", nome: "Plantio · PASTO DA AROEIRA · nov/26", tipo_atividade_nome: "SEMEADURA DE CAPIM", tipo_fixo: "PLANTIO", status: "ABERTA", situacao: "EM_ANDAMENTO", data_inicio: "2026-11-25", primeiro_dia: "2026-11-25", ultimo_dia: "2026-11-27", data_conclusao: null, custo_total: "3000.0000", conta_no_custo: true },
    ],
  },
});

/** @type {{ chamadas: Array<{ method: string, path: string, query: Record<string, string>, body: any }> }} */
let backend;
/** O que o resumo de cada área devolve (as reformas abertas e as atividades). */
let resumoDe = /** @type {Record<string, { planejamentos: any[], atividades?: any[] }>} */ ({});
/** A resposta de `POST /atividades/registrar` (para a recusa). */
let respostaDoRegistro = /** @type {any} */ (null);

const rotear = async (/** @type {{ method: string, path: string, query: URLSearchParams, body: any }} */ { method, path, body }) => {
  const partes = path.split("/").filter(Boolean);
  if (path === "/areas-pastagem" && method === "GET") return { status: 200, body: AREAS };
  if (path === "/culturas" && method === "GET") return { status: 200, body: CULTURAS };
  if (partes[0] === "atividades-opcoes" && method === "GET") return { status: 200, body: { itens: [], has_more: false, next_cursor: null } };
  if (partes[0] === "atividades-por-area" && method === "GET") {
    const r = resumoDe[partes[1]] ?? { planejamentos: [] };
    return { status: 200, body: { area_id: partes[1], mes: "2026-11", atividades: r.atividades ?? [], custos: null, planejamentos: r.planejamentos } };
  }
  if (path === "/atividades/registrar" && method === "POST") {
    if (respostaDoRegistro) return respostaDoRegistro;
    return { status: 201, body: { apontamento: { id: "ap-1" }, apontamentos: [{ id: "ap-1" }], atividade: { id: "at-9" }, alertas: [], registro: { atividade_criada: true, atividade_id: "at-9", planejamento_id: body?.planejamento_id ?? null }, replay: false } };
  }
  if (path === "/atividades" && method === "GET") return { status: 200, body: envelope([]) };
  if (path === "/planejamentos" && method === "GET") return { status: 200, body: { items: [{ ...DETALHE_A, custo: undefined }] } };
  if (path === "/planejamentos" && method === "POST") return { status: 201, body: { ...DETALHE_A, id: "ref-nova", nome: "Reforma · PASTO DA AROEIRA · 2026/27", versao: 1 } };
  if (path === "/planejamentos/ref-a" && method === "GET") return { status: 200, body: DETALHE_A };
  if (path === "/planejamentos/ref-a/concluir" && method === "POST") {
    return { status: 200, body: { ...DETALHE_A, status: "CONCLUIDO", data_conclusao: body.data_conclusao, versao: 4, capim_trocado_nas_areas: body.trocar_capim ? ["area-aroeira"] : [] } };
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
  sessao.acoes = { ver: true, criar: true, editar: true, cancelar: true, lancarApontamento: true, trocarCapimDaArea: true, carregando: false, login: "operador" };
  cadastros.tipos = OPERACOES;
  cadastros.areas = AREAS;
  resumoDe = {};
  respostaDoRegistro = null;
  backend = instalarBackendFake(rotear);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const registros = () => backend.chamadas.filter((c) => c.method === "POST" && c.path === "/atividades/registrar");
/** @param {Record<string, any>} [props] */
const montarRegistro = async (props = {}) => {
  render(
    <QueryClientProvider client={cliente()}>
      <JanelaRegistroDeCampo tipos={OPERACOES} areas={AREAS} onFechar={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
  return screen.findByTestId("janela-registro-de-campo");
};
const escolherTipo = async (/** @type {HTMLElement} */ janela, /** @type {string} */ nome) => {
  fireEvent.click(within(janela).getByRole("button", { name: nome }));
  await within(janela).findByTestId("registro-de-campo-form");
};
const escolher = async (/** @type {HTMLElement} */ raiz, /** @type {RegExp} */ rotulo, /** @type {string|RegExp} */ opcao) => {
  fireEvent.click(within(raiz).getByRole("combobox", { name: rotulo }));
  fireEvent.click(await screen.findByRole("option", { name: opcao }));
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
};
const marcarArea = async (/** @type {HTMLElement} */ raiz, /** @type {string} */ id) => {
  fireEvent.click(within(raiz).getByTestId("registro-areas-campo"));
  fireEvent.click(await screen.findByTestId(`registro-areas-opcao-${id}`));
  fireEvent.click(within(raiz).getByTestId("registro-areas-campo"));
  await waitFor(() => expect(screen.queryByTestId("registro-areas-lista")).toBeNull());
};
const salvar = (/** @type {HTMLElement} */ janela) => fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));

// ═════════════════════════════════════════════════════════════════════════
describe("as regras puras (reformaRegras)", () => {
  it("o nome sugerido é o do servidor; a natureza compara o capim que vai ficar com o capim de hoje de cada área", () => {
    expect(regras.nomeSugeridoDaReforma("REFORMA", ["PASTO DA AROEIRA"], "2026-09-10")).toBe("Reforma · PASTO DA AROEIRA · 2026/27");
    expect(regras.nomeSugeridoDaReforma("FORMACAO", ["PASTO NOVO", "B"], "2027-07-01")).toBe("Formação · PASTO NOVO +1 · 2027/28");
    expect(regras.nomeSugeridoDaReforma("REFORMA", [], "2026-09-10")).toBe("");
    expect(regras.naturezaDaReforma({ capimAlvoId: "c-mom", capimAtualId: "c-mom" })).toBe("recuperacao");
    expect(regras.naturezaDaReforma({ capimAlvoId: "c-mom", capimAtualId: "c-braq" })).toBe("renovacao");
    expect(regras.naturezaDaReforma({ capimAlvoId: "c-mom", capimAtualId: null })).toBe("capim_novo");
    expect(regras.naturezaDaReforma({ capimAlvoId: null, capimAtualId: "c-mom" })).toBeNull();
    expect(regras.textosDaNatureza("c-mom", [{ nome: "A", cultura_id: "c-braq" }])).toEqual(["(renovação: troca de capim)"]);
    expect(regras.textosDaNatureza("c-mom", [{ nome: "A", cultura_id: "c-mom" }, { nome: "B", cultura_id: "c-mom" }])).toEqual(["(recuperação: mesmo capim)"]);
    expect(regras.textosDaNatureza("c-mom", [{ nome: "A", cultura_id: "c-mom" }, { nome: "B", cultura_id: "c-braq" }])).toEqual([
      "A: recuperação: mesmo capim",
      "B: renovação: troca de capim",
    ]);
  });

  it("as reformas do registro têm TODAS as áreas dele; o 'Faz parte de' marca uma, pede a escolha com duas e respeita a ligação do serviço que continua", () => {
    const resumos = [{ planejamentos: [REF_A, REF_B] }, { planejamentos: [REF_B] }];
    expect(regras.reformasDoRegistro({ areaIds: ["area-aroeira"], resumos: [resumos[0]] }).map((p) => p.id)).toEqual(["ref-a", "ref-b"]);
    expect(regras.reformasDoRegistro({ areaIds: ["area-aroeira", "area-sede"], resumos }).map((p) => p.id)).toEqual(["ref-b"]);
    expect(regras.reformasDoRegistro({ areaIds: ["area-aroeira"], resumos: [null] })).toBeNull();
    expect(regras.fazParteDe({ candidatas: [REF_A] })).toMatchObject({ modo: "uma", enviar: "ref-a", falta: false });
    expect(regras.fazParteDe({ candidatas: [REF_A], tirada: true })).toMatchObject({ modo: "tirada", enviar: null });
    expect(regras.fazParteDe({ candidatas: [REF_A, REF_B] })).toMatchObject({ modo: "escolher", enviar: null, falta: true });
    expect(regras.fazParteDe({ candidatas: [REF_A, REF_B], escolhaId: "ref-b" })).toMatchObject({ modo: "escolher", enviar: "ref-b", falta: false });
    expect(regras.fazParteDe({ candidatas: [REF_A, REF_B], escolhaId: regras.NAO_FAZ_PARTE })).toMatchObject({ enviar: null, falta: false });
    expect(regras.fazParteDe({ candidatas: [REF_A], ligadaId: "ref-x", ligadaNome: "Reforma · X" })).toMatchObject({ modo: "ja_ligada", enviar: null, reforma: { nome: "Reforma · X" } });
    expect(regras.fazParteDe({ candidatas: [] })).toMatchObject({ modo: "nenhuma" });
  });

  it("a pergunta da troca do capim só aparece com troca a fazer; o 'Em reforma desde' do mapa", () => {
    expect(regras.perguntaDaTrocaDeCapim(DETALHE_A)).toBe("Trocar o capim da área para MOMBAÇA?");
    expect(regras.perguntaDaTrocaDeCapim({ ...DETALHE_A, areas: [{ ...DETALHE_A.areas[0], cultura_id: "c-mom" }] })).toBe("");
    expect(regras.perguntaDaTrocaDeCapim({ ...DETALHE_A, cultura_alvo_id: null, cultura_alvo: null })).toBe("");
    expect(regras.textoDaReformaNaArea([REF_A], "2026-11-28")).toBe("Em reforma desde 10/09");
    expect(regras.textoDaReformaNaArea([{ ...REF_A, data_inicio: "2026-12-05" }], "2026-11-28")).toBe("Reforma prevista para 05/12");
    expect(regras.textoDaReformaNaArea([], "2026-11-28")).toBe("");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('"Faz parte de" na Nova realização', () => {
  it("com uma reforma aberta na área, a linha já vem marcada e o corpo leva planejamento_id; o 'tirar' (uma cerca, por exemplo) não manda nada", async () => {
    resumoDe = { "area-aroeira": { planejamentos: [REF_A] } };
    const janela = await montarRegistro();
    await escolherTipo(janela, "Preparo do solo");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "GRADAGEM");
    const linha = await within(janela).findByTestId("registro-de-campo-faz-parte");
    expect(linha.textContent).toContain("Faz parte de: Reforma · PASTO DA AROEIRA · 2026/27 ✓");
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.planejamento_id).toBe("ref-a");
  });

  it("'tirar' tira a ligação (e 'pôr de volta' devolve)", async () => {
    resumoDe = { "area-aroeira": { planejamentos: [REF_A] } };
    const janela = await montarRegistro();
    await escolherTipo(janela, "Preparo do solo");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "GRADAGEM");
    fireEvent.click(await within(janela).findByTestId("registro-de-campo-faz-parte-tirar"));
    expect(within(janela).getByTestId("registro-de-campo-faz-parte").textContent).toContain("Não faz parte da Reforma · PASTO DA AROEIRA · 2026/27");
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body).not.toHaveProperty("planejamento_id");
  });

  it("duas reformas abertas: uma lista; salvar sem escolher não sai; a escolhida vai; 'Não faz parte de reforma' não manda nada", async () => {
    resumoDe = { "area-aroeira": { planejamentos: [REF_A, REF_B] } };
    const janela = await montarRegistro();
    await escolherTipo(janela, "Preparo do solo");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "GRADAGEM");
    const lista = await within(janela).findByTestId("registro-de-campo-faz-parte");
    expect(within(lista).getAllByRole("radio").map((r) => r.textContent.trim())).toEqual([REF_A.nome, REF_B.nome, "Não faz parte de reforma"]);
    salvar(janela);
    expect(await within(janela).findByTestId("registro-de-campo-faz-parte-erro")).toHaveTextContent("Escolha de qual reforma este serviço faz parte");
    expect(registros()).toHaveLength(0);
    fireEvent.click(within(janela).getByTestId("registro-de-campo-faz-parte-opcao-ref-b"));
    expect(within(janela).queryByTestId("registro-de-campo-faz-parte-erro")).toBeNull();
    salvar(janela);
    await waitFor(() => expect(registros()).toHaveLength(1));
    expect(registros()[0].body.planejamento_id).toBe("ref-b");
  });

  it("o serviço que continua e já faz parte de uma reforma mostra a dela (o servidor nunca troca) e não manda o campo", async () => {
    resumoDe = { "area-aroeira": { planejamentos: [REF_A] } };
    const continuar = {
      id: "at-5", numero: "5", nome: "Gradagem · PASTO DA AROEIRA · nov/26", status: "ABERTA", versao: 2, tipo_atividade_id: "t-grade", tipo_atividade_nome: "GRADAGEM",
      areas: [{ id: "aa-1", area_id: "area-aroeira", status: "EM_ANDAMENTO", area: { id: "area-aroeira", nome: "PASTO DA AROEIRA" } }],
      andamento: { tipo_fixo: "PREPARO_SOLO", situacao: "EM_ANDAMENTO", areas: [{ atividade_area_id: "aa-1", area_id: "area-aroeira", status: "EM_ANDAMENTO" }] },
      planejamento_id: "ref-antiga", planejamento: { id: "ref-antiga", numero: "9", nome: "Reforma · PASTO DA AROEIRA · 2025/26", status: "CONCLUIDO" },
    };
    const janela = await montarRegistro({ continuar });
    // D-PROD-281: o "Novo lançamento" abre curto; o "Faz parte de" fica no formulário inteiro ("Mudar").
    fireEvent.click(await within(janela).findByTestId("registro-de-campo-mudar"));
    await within(janela).findByTestId("registro-de-campo-form");
    const linha = await within(janela).findByTestId("registro-de-campo-faz-parte");
    expect(linha.textContent).toContain("Faz parte de: Reforma · PASTO DA AROEIRA · 2025/26 ✓");
    expect(linha.textContent).toContain("o serviço já está nesta reforma");
    expect(within(janela).queryByTestId("registro-de-campo-faz-parte-tirar")).toBeNull();
  });

  it("Manutenção sem área (com o local) não tem 'Faz parte de'; a recusa do servidor (reforma fechada) fica embaixo da linha", async () => {
    resumoDe = { "area-aroeira": { planejamentos: [REF_A] } };
    const janela = await montarRegistro();
    await escolherTipo(janela, "Manutenção");
    expect(within(janela).queryByTestId("registro-de-campo-faz-parte")).toBeNull();
    fireEvent.click(within(janela).getByTestId("registro-de-campo-trocar-tipo"));
    await escolherTipo(janela, "Preparo do solo");
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Operação/, "GRADAGEM");
    await within(janela).findByTestId("registro-de-campo-faz-parte");
    respostaDoRegistro = erroServidor(422, "ATIVIDADE_REFERENCIA_INVALIDA", { field: "planejamento_id", reason: "fechado", details: { field: "planejamento_id", reason: "fechado" } });
    salvar(janela);
    expect(await within(janela).findByTestId("registro-de-campo-faz-parte-erro")).toHaveTextContent("A reforma já foi concluída ou cancelada");
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("Planejar a reforma (FormularioReforma)", () => {
  it("4 campos (Áreas, Tipo, Capim que vai ficar, Início previsto), a renovação ao lado do capim, o nome sugerido; o corpo só com o que o servidor aceita", async () => {
    const onCriada = vi.fn();
    render(
      <QueryClientProvider client={cliente()}>
        <FormularioReforma areas={AREAS} hoje="2026-11-28" onFechar={vi.fn()} onCriada={onCriada} />
      </QueryClientProvider>,
    );
    const janela = await screen.findByTestId("formulario-reforma");
    const rotulos = [...janela.querySelectorAll(".mg-field__label")].map((el) => el.textContent.replace(/\s*\*\s*$/, "").trim());
    expect(rotulos).toEqual(["Áreas", "Tipo", "Capim que vai ficar", "Início previsto", "Safra"]);
    // Sem área nada sai.
    fireEvent.click(within(janela).getByTestId("formulario-reforma-salvar"));
    expect(await within(janela).findByText("Escolha a área.")).toBeTruthy();
    expect(backend.chamadas.filter((c) => c.method === "POST")).toHaveLength(0);
    await marcarArea(janela, "area-aroeira");
    await escolher(janela, /Capim que vai ficar/, "MOMBAÇA");
    expect(within(janela).getByTestId("formulario-reforma-natureza")).toHaveTextContent("(renovação: troca de capim)");
    fireEvent.change(within(janela).getByTestId("formulario-reforma-inicio"), { target: { value: "2026-09-10" } });
    expect(within(janela).getByTestId("formulario-reforma-nome")).toHaveTextContent("Reforma · PASTO DA AROEIRA · 2026/27");
    expect(within(janela).getByTestId("formulario-reforma-safra")).toHaveTextContent("2026/27");
    fireEvent.click(within(janela).getByTestId("formulario-reforma-salvar"));
    await waitFor(() => expect(onCriada).toHaveBeenCalled());
    const post = backend.chamadas.find((c) => c.method === "POST" && c.path === "/planejamentos");
    expect(post.body).toEqual({ empresa_id: "emp-1", tipo: "REFORMA", areas: [{ area_id: "area-aroeira", hectares: "40" }], cultura_alvo_id: "c-mom", data_inicio: "2026-09-10" });
  });

  it("com o mesmo capim de hoje, '(recuperação: mesmo capim)'; Formação sem capim não manda cultura_alvo_id", async () => {
    render(
      <QueryClientProvider client={cliente()}>
        <FormularioReforma areas={AREAS} hoje="2026-11-28" onFechar={vi.fn()} onCriada={vi.fn()} />
      </QueryClientProvider>,
    );
    const janela = await screen.findByTestId("formulario-reforma");
    await marcarArea(janela, "area-sede");
    await escolher(janela, /Capim que vai ficar/, "MOMBAÇA");
    expect(within(janela).getByTestId("formulario-reforma-natureza")).toHaveTextContent("(recuperação: mesmo capim)");
    // O capim é opcional: o ✕ "Limpar" do campo tira a escolha.
    const campoCapim = /** @type {HTMLElement} */ (within(janela).getByRole("combobox", { name: /Capim que vai ficar/ }).closest(".mg-field"));
    fireEvent.click(within(campoCapim).getByRole("button", { name: "Limpar" }));
    expect(within(janela).queryByTestId("formulario-reforma-natureza")).toBeNull();
    await escolher(janela, /^Tipo/, "Formação de pasto novo");
    fireEvent.click(within(janela).getByTestId("formulario-reforma-salvar"));
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === "POST" && c.path === "/planejamentos")).toBe(true));
    const post = backend.chamadas.find((c) => c.method === "POST" && c.path === "/planejamentos");
    expect(post.body).toEqual({ empresa_id: "emp-1", tipo: "FORMACAO", areas: [{ area_id: "area-sede", hectares: "12" }], data_inicio: "2026-11-28" });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("a lista: Planejar, o filtro Reforma, a barra do custo e a conclusão", () => {
  const montarLista = async () => {
    render(
      <QueryClientProvider client={cliente()}>
        <LancamentoAtividades />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === "/planejamentos")).toBe(true));
  };
  const escolherReforma = async () => {
    await escolherOpcao(await screen.findByRole("combobox", { name: "Filtrar por reforma" }), new RegExp(REF_A.nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    return screen.findByTestId("barra-reforma");
  };

  it("'Planejar' pergunta o que planejar e 'Reforma de pastagem' abre o formulário da reforma", async () => {
    await montarLista();
    fireEvent.click(screen.getByRole("button", { name: "Planejar" }));
    const escolha = await screen.findByTestId("janela-planejar");
    expect(within(escolha).getByTestId("janela-planejar-servico")).toHaveTextContent("Um serviço");
    fireEvent.click(within(escolha).getByTestId("janela-planejar-reforma"));
    expect(await screen.findByTestId("formulario-reforma")).toBeTruthy();
  });

  it("a pílula Reforma filtra no servidor (planejamento_id) e mostra a barra: custo total, R$/ha, por tipo e os serviços em ordem de data", async () => {
    await montarLista();
    const barra = await escolherReforma();
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === "/atividades" && c.query.planejamento_id === "ref-a")).toBe(true));
    expect(within(barra).getByTestId("barra-reforma-nome")).toHaveTextContent(REF_A.nome);
    expect(within(barra).getByTestId("barra-reforma-custo-total").textContent).toMatch(/R\$\s?18\.240,00/);
    expect(within(barra).getByTestId("barra-reforma-custo-ha").textContent).toMatch(/R\$\s?456,00/);
    expect(within(barra).getByTestId("barra-reforma-hectares")).toHaveTextContent("40 ha");
    expect(within(barra).getByTestId("barra-reforma-capim")).toHaveTextContent("MOMBAÇA (renovação: troca de capim)");
    const tipos = within(within(barra).getByTestId("barra-reforma-por-tipo")).getAllByRole("listitem").map((li) => li.textContent);
    expect(tipos.map((t) => t.replace(/\s+/g, " "))).toEqual([
      expect.stringMatching(/^Preparo do solo\s?R\$\s?6\.400,00$/),
      expect.stringMatching(/^Plantio de pastagem\s?R\$\s?3\.000,00$/),
      expect.stringMatching(/^Fertilização\s?R\$\s?7\.240,00$/),
      expect.stringMatching(/^Aplicação\s?R\$\s?1\.600,00$/),
    ]);
    const servicos = within(within(barra).getByTestId("barra-reforma-servicos")).getAllByRole("listitem").map((li) => li.textContent);
    expect(servicos[0]).toContain("03/09");
    expect(servicos[0]).toContain("Finalizada");
    expect(servicos[3]).toContain("Em andamento");
  });

  it("'Concluir reforma' pergunta 'Trocar o capim da área para MOMBAÇA?'; 'Sim' manda trocar_capim: true; 'Não, só concluir', false", async () => {
    await montarLista();
    const barra = await escolherReforma();
    fireEvent.click(within(barra).getByTestId("barra-reforma-concluir"));
    let dialogo = await screen.findByTestId("dialogo-concluir-reforma");
    expect(within(dialogo).getByTestId("dialogo-concluir-reforma-pergunta")).toHaveTextContent("Trocar o capim da área para MOMBAÇA?");
    expect(within(dialogo).getByTestId("dialogo-concluir-reforma-pergunta")).toHaveTextContent("PASTO DA AROEIRA: BRAQUIARINHA → MOMBAÇA");
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-reforma-trocar"));
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === "/planejamentos/ref-a/concluir")).toBe(true));
    const sim = backend.chamadas.find((c) => c.path === "/planejamentos/ref-a/concluir");
    expect(sim.body).toEqual({ empresa_id: "emp-1", versao: 3, data_conclusao: "2026-11-28", trocar_capim: true });
    await waitFor(() => expect(screen.queryByTestId("dialogo-concluir-reforma")).toBeNull());
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", expect.stringContaining("O capim de 1 área passou a ser MOMBAÇA"));
    fireEvent.click(within(await screen.findByTestId("barra-reforma")).getByTestId("barra-reforma-concluir"));
    dialogo = await screen.findByTestId("dialogo-concluir-reforma");
    fireEvent.click(within(dialogo).getByTestId("dialogo-concluir-reforma-so-concluir"));
    await waitFor(() => expect(backend.chamadas.filter((c) => c.path === "/planejamentos/ref-a/concluir")).toHaveLength(2));
    expect(backend.chamadas.filter((c) => c.path === "/planejamentos/ref-a/concluir")[1].body.trocar_capim).toBe(false);
  });

  it("sem a permissão do Cadastro do Mapa, a troca do capim fica desligada (e diz por quê); concluir sem trocar continua", async () => {
    sessao.acoes = { ...sessao.acoes, trocarCapimDaArea: false };
    await montarLista();
    const barra = await escolherReforma();
    fireEvent.click(within(barra).getByTestId("barra-reforma-concluir"));
    const dialogo = await screen.findByTestId("dialogo-concluir-reforma");
    expect(within(dialogo).getByTestId("dialogo-concluir-reforma-trocar")).toBeDisabled();
    expect(within(dialogo).getByTestId("dialogo-concluir-reforma-sem-permissao")).toHaveTextContent("permissão de editar o Cadastro do Mapa");
    expect(within(dialogo).getByTestId("dialogo-concluir-reforma-so-concluir")).not.toBeDisabled();
  });

  it("sem editar nem cancelar, a barra não tem os botões da reforma", async () => {
    sessao.acoes = { ...sessao.acoes, editar: false, cancelar: false };
    await montarLista();
    const barra = await escolherReforma();
    expect(within(barra).queryByTestId("barra-reforma-concluir")).toBeNull();
    expect(within(barra).queryByTestId("barra-reforma-cancelar")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe("o mapa: Detalhes da área", () => {
  it("com uma reforma aberta, 'Em reforma desde 10/09' e o nome dela; sem reforma, nada", async () => {
    resumoDe = { "area-aroeira": { planejamentos: [REF_A] } };
    render(
      <QueryClientProvider client={cliente()}>
        <AbaDetalhesDaArea area={AROEIRA} verAtividades forragem={false} />
      </QueryClientProvider>,
    );
    const cel = await screen.findByTestId("detalhes-area-em-reforma");
    expect(cel).toHaveTextContent("Em reforma desde 10/09");
    expect(cel).toHaveTextContent(REF_A.nome);
    cleanup();
    render(
      <QueryClientProvider client={cliente()}>
        <AbaDetalhesDaArea area={SEDE} verAtividades forragem={false} />
      </QueryClientProvider>,
    );
    await screen.findByText("Nenhuma atividade agora");
    expect(screen.queryByTestId("detalhes-area-em-reforma")).toBeNull();
  });
});
