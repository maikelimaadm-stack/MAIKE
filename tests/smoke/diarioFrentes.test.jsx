/**
 * D-PROD-348 — o Diário das atividades no modelo de FRENTES (uma atividade por pasto e tipo, máquinas dentro), com o service
 * mockado e um "servidor" em memória (`store`): o envio grava na atividade e a leitura devolve o que foi gravado.
 *  (a) "Em andamento neste pasto": um cartão por ATIVIDADE, com "2 máquinas em campo";
 *  (b) o passo `atividade`: um cartão por frente (implemento, operador, horímetro inicial) e "Adicionar máquina";
 *  (c) "Adicionar máquina": título, POST com `bem_id` e a tag da abertura, volta ao passo `atividade`; a mesma máquina com o
 *      mesmo implemento bloqueia sem POST, aberta (c2) ou encerrada (c3);
 *  (d) tocar numa frente abre o serviço dela, e "Lançado hoje" mostra só os lançamentos dela;
 *  (e) "Encerrar serviço": horímetro final vazio ou menor que o inicial mostra o erro e não envia (e1); válido grava a tag
 *      `[encerramento-servico …]`, volta ao passo, a frente fica "Encerrado" e não toca, a outra segue aberta (e2);
 *  (f) "Encerrar atividade" com duas frentes abertas: exige os dois horímetros, grava um encerramento por frente e conclui com
 *      `versao` e `data_conclusao` de hoje (f1); falha no concluir: aviso, e tentar de novo não repete os encerramentos (f2);
 *  (g) atividade antiga sem nenhuma frente: aviso, "Adicionar máquina" e "Encerrar atividade" sem pedir horímetro;
 *  (h) duplo clique em "Encerrar serviço" envia um só POST;
 *  (a) "Encerrar atividade" exige EDITAR a atividade (o concluir do backend é `g.editar`): sem ela, desabilitado e sem POST;
 *      "Encerrar serviço" segue com lançar apontamento. Os encerramentos não mandam `operador_usuario_id` (o operador é opcional).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";

/** A permissão da sessão: `editar` é a que o "Encerrar atividade" exige (o concluir do backend é `g.editar`). */
const permissoes = vi.hoisted(() => ({ editar: true, lancar: true }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ hoje: "2026-11-26", fuso: "America/Sao_Paulo", semFuso: false, fusoOk: true }),
  useAcoesTelaAtividades: () => ({ lancarApontamento: permissoes.lancar, editar: permissoes.editar, login: "operador", permissaoEfetiva: { is_admin: false } }),
}));
vi.mock("@/hooks/usePatrimonioSessao", () => ({
  // D-PROD-359: a opção Abastecimento do serviço exige a permissão de criar abastecimento (por padrão, concedida aqui).
  useAcoesTelaAbastecimento: () => ({ ver: true, criar: true, cancelar: false }),
  useAcoesTelaPatrimonio: () => ({ ver: false }),
}));
vi.mock("@/services/abastecimentoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarAbastecimentosPagina: vi.fn(async () => ({ items: [], has_more: false, next_cursor: null })),
}));
vi.mock("@/lib/AuthContext", async (importOriginal) => ({ ...(await importOriginal()), useAuth: () => ({ clienteId: "c1" }) }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));
vi.mock("@/services/culturaCadastroService", () => ({ listarCulturas: vi.fn() }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarOpcoesBens: vi.fn(),
  listarOpcoesImplementos: vi.fn(),
  listarOpcoesOperadores: vi.fn(),
  obterMedidorDoBem: vi.fn(),
  registrarCampo: vi.fn(),
  obterAtividade: vi.fn(),
  listarApontamentos: vi.fn(),
  criarApontamento: vi.fn(),
  concluirAtividade: vi.fn(),
  adicionarLinha: vi.fn(),
}));

import DiarioDasAtividades from "@/components/lancamento-atividades/DiarioDasAtividades";
import { mesCurto } from "@/components/lancamento-atividades/AtividadeComFrentes";
import { lerAbertura, marcadorDaAbertura, marcadorDoEncerramento } from "@/lib/aberturaServicoRegras";
import * as servico from "@/services/lancamentoAtividadesService";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";

const MSG_FRENTE_DUPLICADA = "Esta máquina com este implemento já tem serviço aberto neste pasto. Toque nele na lista para continuar.";
const MSG_FRENTE_ENCERRADA = "Esta máquina com este implemento já encerrou o serviço nesta atividade.";

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500" };
const OPERACAO_APLICACAO = { id: "op-1", nome_tipo: "Aplicação de defensivo", categoria: "APLICACAO", ativo: true };
const OPERACAO_GRADAGEM = { id: "op-g", nome_tipo: "Gradagem", categoria: "PREPARO_SOLO", ativo: true };
const TIPOS = [OPERACAO_APLICACAO, OPERACAO_GRADAGEM];
const BENS = {
  itens: [
    { id: "bem-7", nome: "Trator 12" },
    { id: "bem-8", nome: "Trator 08" },
    { id: "bem-10", nome: "Trator 10" },
  ],
  has_more: false,
  next_cursor: null,
};
const IMPLEMENTOS = { itens: [{ id: "imp-2", nome: "Pulverizador 2.000 L" }], has_more: false, next_cursor: null };
const OPERADORES = {
  itens: [
    { id: "usr-3", nome: "João Pereira" },
    { id: "usr-4", nome: "Maria Souza" },
  ],
  has_more: false,
  next_cursor: null,
};

/** As atividades do pasto (a lista) e o detalhe de cada uma (o que `obterAtividade`/`lerAtividade` devolvem). */
const ATIVIDADE_APLICACAO = {
  atividade_id: "at-1",
  numero: 10,
  nome: "Aplicação · nov/26",
  tipo_atividade_id: "op-1",
  tipo_atividade_nome: "Aplicação de defensivo",
  status: "ABERTA",
  area_status: "EM_ANDAMENTO",
  data_inicio: "2026-11-02",
};
const ATIVIDADE_SEM_FRENTE = {
  atividade_id: "at-2",
  numero: 11,
  nome: "Gradagem · nov/26",
  tipo_atividade_id: "op-g",
  tipo_atividade_nome: "Gradagem",
  status: "ABERTA",
  area_status: "PLANEJADA",
  data_inicio: "2026-11-20",
};
const DETALHE = {
  "at-1": { id: "at-1", tipo_atividade_id: "op-1", tipo_atividade_nome: "Aplicação de defensivo", nome: "Aplicação · nov/26", data_inicio: "2026-11-02", versao: 7 },
  "at-2": { id: "at-2", tipo_atividade_id: "op-g", tipo_atividade_nome: "Gradagem", nome: "Gradagem · nov/26", data_inicio: "2026-11-20", versao: 3 },
};

/** A abertura de uma máquina (com ou sem implemento) como a linha da observação. */
const abertura = ({ bem, bemNome, impl = "", implNome = "", hor, resp = "usr-3", respNome = "João Pereira" }) =>
  marcadorDaAbertura({ bemId: bem, bemNome, implementoId: impl, implementoNome: implNome, horimetro: hor, responsavelId: resp, responsavelNome: respNome });
const TRATOR_12 = abertura({ bem: "bem-7", bemNome: "Trator 12", impl: "imp-2", implNome: "Pulverizador 2.000 L", hor: "1000.0" });
const TRATOR_08 = abertura({ bem: "bem-8", bemNome: "Trator 08", hor: "900.0", resp: "usr-4", respNome: "Maria Souza" });
/** Uma linha de produto CONFIRMADA (a carga). */
const linhaProduto = (id, nome, quantidade, unidade, jato, observacao = null) => ({ id, status: "CONFIRMADO", produto_id: id, produto: { nome }, quantidade, unidade, jato, observacao, createdAt: "2026-11-26T09:10:00.000Z" });
/** Um apontamento CONFIRMADO de um dia, com a observação e as linhas dadas. */
const ap = (id, dia, observacao, produtos = []) => ({ id, data_operacional: dia, status: "CONFIRMADO", versao: 2, createdAt: `${dia}T09:00:00.000Z`, observacao, produtos, maquinas: [], mao_obra: [], servicos: [] });

/**
 * O "servidor": os apontamentos de cada atividade. Começa com duas frentes ABERTAS na at-1 (Trator 12 + Pulverizador, com
 * Glifosato hoje; Trator 08 sem implemento, com Ureia hoje). A at-2 não tem nenhum.
 */
let store;
const comecoDoServidor = () => ({
  "at-1": [
    ap("ap-1", "2026-11-02", TRATOR_12),
    ap("ap-1h", "2026-11-26", TRATOR_12, [linhaProduto("pl-1", "Glifosato", "10.0000", "L", 1, "[carga hor=1100.0]")]),
    ap("ap-2", "2026-11-20", TRATOR_08),
    ap("ap-2h", "2026-11-26", TRATOR_08, [linhaProduto("pl-2", "Ureia", "500.0000", "kg", 1)]),
  ],
  "at-2": [],
});

/** @param {{ atividadesAbertas?: any[], atividade?: any, detalhe?: Record<string, unknown> }} [props] */
const renderizar = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  const onGravou = vi.fn();
  const lerAtividade = vi.fn(async (id) => ({ ...DETALHE[/** @type {"at-1" | "at-2"} */ (id)], ...(props.detalhe ?? {}) }));
  render(
    <QueryClientProvider client={queryClient}>
      <DiarioDasAtividades
        area={AREA}
        tipos={TIPOS}
        atividadesAbertas={props.atividadesAbertas ?? []}
        atividade={props.atividade ?? null}
        lerAtividade={lerAtividade}
        onFechar={onFechar}
        onGravou={onGravou}
      />
    </QueryClientProvider>,
  );
  return { onFechar, onGravou, lerAtividade };
};

/** Escolhe uma opção de um campo de escolha Base1 (o botão combobox abre a lista; a opção é clicada). */
const escolherOpcao = async (combobox, rotulo) => {
  await act(async () => fireEvent.click(combobox));
  const opcao = await screen.findByRole("option", { name: rotulo });
  await act(async () => fireEvent.click(opcao));
};

/** Do passo "Em andamento neste pasto", toca a atividade do pasto e espera as frentes (o passo `atividade`). */
const abrirAtividade = async (id = "at-1") => {
  fireEvent.click(screen.getByTestId(`diario-atividade-aberta-${id}`));
  return screen.findByTestId("atividade-passo");
};
/** No passo `atividade`, toca a frente da chave (espera a leitura) e espera o serviço dela. */
const abrirFrente = async (chave, atividadeId = "at-1") => {
  fireEvent.click(await screen.findByTestId(`frente-${atividadeId}-${encodeURIComponent(chave)}`));
  return screen.findByTestId("abertura-iniciado");
};
/** No passo `atividade`, "Adicionar máquina" → o formulário de abertura do tipo da atividade. */
const adicionarMaquina = async () => {
  fireEvent.click(await screen.findByTestId("atividade-adicionar-maquina"));
  return screen.findByTestId("abertura-form");
};

beforeEach(() => {
  permissoes.editar = true;
  permissoes.lancar = true;
  store = comecoDoServidor();
  servico.listarOpcoesBens.mockResolvedValue(BENS);
  servico.listarOpcoesImplementos.mockResolvedValue(IMPLEMENTOS);
  servico.listarOpcoesOperadores.mockResolvedValue(OPERADORES);
  servico.obterMedidorDoBem.mockResolvedValue({ medidor_tipo: "HORIMETRO", medidor_unidade: "h", leitura_vigente: null });
  servico.obterAtividade.mockImplementation(async (id) => ({ ...DETALHE[/** @type {"at-1" | "at-2"} */ (id)] }));
  servico.listarApontamentos.mockImplementation(async (id) => ({ items: [...(store[id] ?? [])] }));
  // O servidor grava o envio: a abertura entra na atividade do tipo (at-1) e a leitura seguinte a traz.
  servico.registrarCampo.mockImplementation(async (dados) => {
    const id = "at-1";
    const linha = ap(`ap-novo-${store[id].length}`, dados.data_operacional, dados.observacao);
    store[id].push(linha);
    return { atividade: { id, tipo_atividade_id: dados.tipo_atividade_id }, apontamento: { id: linha.id } };
  });
  servico.criarApontamento.mockImplementation(async (atividadeId, dados) => {
    const linha = ap(`ap-enc-${store[atividadeId].length}`, dados.data_operacional, dados.observacao);
    store[atividadeId].push(linha);
    return { apontamento: { id: linha.id, versao: 1 }, atividade: null, alertas: [] };
  });
  servico.concluirAtividade.mockResolvedValue({ id: "at-1", status: "CONCLUIDA" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("D-PROD-348 — o passo \"Em andamento neste pasto\" (a) e o passo da atividade (b)", () => {
  it("(a) um cartão por ATIVIDADE, com \"2 máquinas em campo\" (e nenhum cartão por máquina)", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Em andamento neste pasto");
    const cartao = screen.getByTestId("diario-atividade-aberta-at-1");
    await waitFor(() => expect(cartao).toHaveTextContent("2 máquinas em campo"));
    expect(cartao).toHaveTextContent("Aplicação de defensivo · nov/26");
    expect(cartao).toHaveTextContent("Início 02/11");
    expect(within(cartao).getByTestId("diario-atividade-aberta-etiqueta-at-1")).toHaveTextContent("Em andamento");
    expect(screen.getAllByTestId(/^diario-atividade-aberta-at-/)).toHaveLength(1);
    expect(screen.queryByText("Trator 12")).toBeNull();
  });

  it("(b) o passo da atividade: dois cartões de frente (implemento, operador, horímetro inicial, Hoje) e \"Adicionar máquina\"", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
    const lista = await screen.findByRole("list", { name: "Máquinas em campo" });
    await waitFor(() => expect(within(lista).getAllByRole("listitem")).toHaveLength(2));
    const trator12 = screen.getByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(within(trator12).getByText("Trator 12")).toBeInTheDocument();
    expect(within(trator12).getByText("Pulverizador 2.000 L")).toBeInTheDocument();
    expect(within(trator12).getByText("João Pereira")).toBeInTheDocument();
    expect(within(trator12).getByText("1.000,0")).toBeInTheDocument();
    // D-PROD-348 (item 1): "Hoje" são as horas do dia: a carga de Glifosato leu 1.100,0 h; a abertura, 1.000,0 h → 100 h.
    expect(within(trator12).getByTestId("frente-hoje")).toHaveTextContent("100 h");
    expect(within(trator12).getByTestId("frente-hoje")).not.toHaveTextContent("lançamento");
    const trator08 = screen.getByTestId("frente-at-1-bem-8%7C");
    expect(within(trator08).getByText("Maria Souza")).toBeInTheDocument();
    expect(within(trator08).getByText("900,0")).toBeInTheDocument();
    expect(within(trator08).getByText("—")).toBeInTheDocument();
    // Ureia hoje sem horímetro na observação: sem leitura do dia, "Nada hoje" (dado ausente).
    expect(within(trator08).getByTestId("frente-hoje")).toHaveTextContent("Nada hoje");
    expect(screen.getByTestId("atividade-adicionar-maquina")).toHaveTextContent("Adicionar máquina");
    expect(screen.getByTestId("atividade-encerrar")).toHaveTextContent("Encerrar atividade");
  });
});

describe("D-PROD-348 — Adicionar máquina e a trava de frente duplicada (c)", () => {
  it("(c1) título \"Adicionar máquina\"; o POST leva bem_id e a tag da abertura; volta ao passo e a máquina nova vira frente", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await adicionarMaquina();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Adicionar máquina");
    // D-PROD-348 (item 1): a operação é a da atividade — sem o campo "Operação" e sem a frase "Já existe …" (só vale no tipo).
    expect(screen.queryByTestId("abertura-operacao")).toBeNull();
    expect(screen.queryByTestId("abertura-ja-existe")).toBeNull();
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 10");
    fireEvent.change(screen.getByTestId("abertura-horimetro"), { target: { value: "900" } });
    await escolherOpcao(screen.getByRole("combobox", { name: "Responsável" }), "Maria Souza");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));

    expect(await screen.findByTestId("atividade-passo")).toBeInTheDocument();
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
    const [dados] = servico.registrarCampo.mock.calls[0];
    expect(dados).toMatchObject({ area_id: "area-A", tipo_atividade_id: "op-1", data_operacional: "2026-11-26", bem_id: "bem-10", operador_usuario_id: "usr-4" });
    expect(dados.maquinas).toBeUndefined();
    expect(dados.observacao).toMatch(/^\[abertura-servico bem=bem-10/);
    expect(lerAbertura(dados.observacao)).toMatchObject({ bemId: "bem-10", horimetro: "900.0", responsavelId: "usr-4" });
    // A máquina nova entra no passo como mais uma frente (sem implemento: "bem-10|").
    expect(await screen.findByTestId("frente-at-1-bem-10%7C")).toHaveTextContent("Trator 10");
    const lista = screen.getByRole("list", { name: "Máquinas em campo" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(3);
  });

  it("(c2) a mesma máquina com o mesmo implemento já ABERTA no pasto: trava, botão desabilitado e nada é enviado", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await adicionarMaquina();
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolherOpcao(screen.getByRole("combobox", { name: "Implemento" }), "Pulverizador 2.000 L");
    expect(await screen.findByTestId("abertura-trava")).toHaveTextContent(MSG_FRENTE_DUPLICADA);
    expect(screen.getByRole("button", { name: "Iniciar serviço" })).toBeDisabled();
    fireEvent.submit(screen.getByTestId("abertura-form"));
    expect(notifyWarning).toHaveBeenCalledWith("Não foi possível iniciar o serviço", MSG_FRENTE_DUPLICADA);
    expect(servico.registrarCampo).not.toHaveBeenCalled();
  });

  it("(c3) a mesma máquina (sem implemento) já ENCERRADA nesta atividade: trava com a frase de encerrada, e nada é enviado", async () => {
    // O Trator 08 (sem implemento) foi encerrado em 26/11, depois da abertura dele (20/11): a frente está encerrada.
    store["at-1"].push(ap("ap-enc-08", "2026-11-26", marcadorDoEncerramento({ bemId: "bem-8", horimetro: "950.0", bemNome: "Trator 08" })));
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await adicionarMaquina();
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 08");
    expect(await screen.findByTestId("abertura-trava")).toHaveTextContent(MSG_FRENTE_ENCERRADA);
    expect(screen.queryByText(/serviço aberto neste pasto/)).toBeNull();
    expect(screen.getByRole("button", { name: "Iniciar serviço" })).toBeDisabled();
    fireEvent.submit(screen.getByTestId("abertura-form"));
    expect(notifyWarning).toHaveBeenCalledWith("Não foi possível iniciar o serviço", MSG_FRENTE_ENCERRADA);
    expect(servico.registrarCampo).not.toHaveBeenCalled();
  });
});

describe("D-PROD-348 — o serviço de uma frente (d) e o encerramento dela (e)", () => {
  it("(d) tocar numa frente abre só o serviço dela: o cabeçalho e o \"Lançado hoje\" são os dela", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    const cabecalho = await abrirFrente("bem-8|");
    expect(within(cabecalho).getByText("Trator 08")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Maria Souza")).toBeInTheDocument();
    expect(within(cabecalho).queryByText("Trator 12")).toBeNull();
    const lancados = await screen.findAllByTestId("servico-lancado-item");
    expect(lancados).toHaveLength(1);
    expect(lancados[0]).toHaveTextContent("Ureia");
    expect(screen.queryByText(/Glifosato/)).toBeNull();
  });

  it("(e1) horímetro final vazio, ou menor que o inicial: mostra o erro e NÃO envia", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await abrirFrente("bem-7|imp-2");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    fireEvent.click(screen.getByTestId("servico-encerrar-confirmar"));
    expect(await screen.findByText("Informe o horímetro final.")).toBeInTheDocument();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("encerrar-horimetro"), { target: { value: "900" } });
    fireEvent.click(screen.getByTestId("servico-encerrar-confirmar"));
    expect(await screen.findByText("O horímetro final não pode ser menor que o inicial (1.000,0).")).toBeInTheDocument();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith("Atenção", "Revise os campos destacados.");
  });

  it("(e2) horímetro válido: grava a tag [encerramento-servico …], volta ao passo; a frente fica Encerrado e não toca; a outra segue aberta", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await abrirFrente("bem-7|imp-2");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    fireEvent.change(screen.getByTestId("encerrar-horimetro"), { target: { value: "1.200,5" } });
    fireEvent.click(screen.getByTestId("servico-encerrar-confirmar"));

    expect(await screen.findByTestId("atividade-passo")).toBeInTheDocument();
    expect(servico.criarApontamento).toHaveBeenCalledTimes(1);
    const [atividadeId, dados] = servico.criarApontamento.mock.calls[0];
    expect(atividadeId).toBe("at-1");
    expect(dados).toMatchObject({ data_operacional: "2026-11-26" });
    // Sem operador no encerramento: o responsável da abertura pode estar desativado (o servidor recusaria).
    expect(dados).not.toHaveProperty("operador_usuario_id");
    expect(dados.observacao).toMatch(/^\[encerramento-servico bem=bem-7 impl=imp-2 hor=1200\.5 /);
    const encerrada = await screen.findByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(encerrada).toBeDisabled();
    expect(within(encerrada).getByText("● Encerrado")).toBeInTheDocument();
    expect(within(encerrada).getByText("1.200,5")).toBeInTheDocument();
    const aberta = screen.getByTestId("frente-at-1-bem-8%7C");
    expect(aberta).toBeEnabled();
    expect(within(aberta).getByText("● Aberto")).toBeInTheDocument();
    expect(notifySuccess).toHaveBeenCalledWith("Sucesso", "Serviço encerrado.");
    // A atividade continua com uma máquina em campo.
    await waitFor(() => expect(screen.getByTestId("atividade-topo")).toHaveTextContent("1 máquina em campo"));
  });
});

describe("D-PROD-348 — Encerrar atividade (f) e a atividade sem frente (g)", () => {
  it("(f1) com duas frentes abertas: exige os dois horímetros, grava um encerramento por frente e conclui com versao e data_conclusao de hoje", async () => {
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await screen.findByTestId("frente-at-1-bem-8%7C");
    fireEvent.click(screen.getByTestId("atividade-encerrar"));
    const campoTrator12 = screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-7|imp-2")}`);
    const campoTrator08 = screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-8|")}`);

    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    expect(await screen.findAllByText("Informe o horímetro final.")).toHaveLength(2);
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(servico.concluirAtividade).not.toHaveBeenCalled();

    fireEvent.change(campoTrator12, { target: { value: "1.200,5" } });
    fireEvent.change(campoTrator08, { target: { value: "950" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));

    // Um encerramento por frente aberta, na ordem do início (Trator 12, depois Trator 08), e só então a conclusão.
    expect(servico.criarApontamento).toHaveBeenCalledTimes(2);
    const [primeiro, segundo] = servico.criarApontamento.mock.calls;
    expect(primeiro[0]).toBe("at-1");
    expect(primeiro[1].observacao).toMatch(/^\[encerramento-servico bem=bem-7 impl=imp-2 hor=1200\.5 /);
    expect(segundo[1].observacao).toMatch(/^\[encerramento-servico bem=bem-8 hor=950\.0 /);
    expect(primeiro[1]).not.toHaveProperty("operador_usuario_id");
    expect(segundo[1]).not.toHaveProperty("operador_usuario_id");
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(1);
    expect(servico.concluirAtividade).toHaveBeenCalledWith("at-1", { versao: 7, data_conclusao: "2026-11-26" });
    expect(notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade encerrada.");
  });

  it("(f2) falha no concluir: mostra o aviso, e tentar de novo conclui SEM repetir os encerramentos das máquinas", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(new Error("rede"));
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await screen.findByTestId("frente-at-1-bem-8%7C");
    fireEvent.click(screen.getByTestId("atividade-encerrar"));
    fireEvent.change(screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-7|imp-2")}`), { target: { value: "1.200,5" } });
    fireEvent.change(screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-8|")}`), { target: { value: "950" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));

    await waitFor(() =>
      expect(notifyWarning).toHaveBeenCalledWith(
        "Não foi possível encerrar a atividade",
        "As máquinas foram encerradas, mas não foi possível encerrar a atividade. Tente de novo.",
      ),
    );
    expect(servico.criarApontamento).toHaveBeenCalledTimes(2);
    expect(onFechar).not.toHaveBeenCalled();

    // As duas frentes já estão encerradas: o painel vira a confirmação, sem campo de horímetro.
    await waitFor(() => expect(screen.getByTestId("atividade-encerrar-painel")).toHaveTextContent("neste pasto?"));
    expect(screen.queryByTestId(/^atividade-encerrar-horimetro-/)).toBeNull();
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(servico.criarApontamento).toHaveBeenCalledTimes(2);
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(2);
    expect(servico.concluirAtividade.mock.calls[1]).toEqual(["at-1", { versao: 7, data_conclusao: "2026-11-26" }]);
  });

  it("(g) atividade antiga sem nenhuma frente: aviso, \"Adicionar máquina\" e \"Encerrar atividade\" sem pedir horímetro", async () => {
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_SEM_FRENTE] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-2"));
    expect(await screen.findByTestId("atividade-sem-maquina")).toHaveTextContent("Esta atividade não tem máquina em campo.");
    expect(screen.getByTestId("atividade-adicionar-maquina")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("atividade-encerrar"));
    expect(screen.getByTestId("atividade-encerrar-painel")).toHaveTextContent("Encerrar a atividade Gradagem neste pasto?");
    expect(screen.queryByTestId(/^atividade-encerrar-horimetro-/)).toBeNull();
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(servico.concluirAtividade).toHaveBeenCalledWith("at-2", { versao: 3, data_conclusao: "2026-11-26" });
  });
});

describe("D-PROD-348 — permissão de editar para Encerrar atividade (a)", () => {
  it("(a1) sem EDITAR a atividade: \"Encerrar atividade\" fica desabilitado, com o aviso; clicar não abre o painel e nada é enviado", async () => {
    permissoes.editar = false;
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await screen.findByTestId("frente-at-1-bem-8%7C");
    const botao = screen.getByTestId("atividade-encerrar");
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", "Você não tem permissão para encerrar a atividade.");
    expect(screen.getByTestId("atividade-encerrar-sem-permissao")).toHaveTextContent("Você não tem permissão para encerrar a atividade.");
    fireEvent.click(botao);
    expect(screen.queryByTestId("atividade-encerrar-painel")).toBeNull();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(servico.concluirAtividade).not.toHaveBeenCalled();
    expect(servico.obterAtividade).not.toHaveBeenCalled();
  });

  it("(a2) sem EDITAR, \"Encerrar serviço\" de uma frente segue liberado (só exige lançar apontamento) e grava o encerramento da frente", async () => {
    permissoes.editar = false;
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await abrirFrente("bem-7|imp-2");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    fireEvent.change(screen.getByTestId("encerrar-horimetro"), { target: { value: "1.200,5" } });
    expect(screen.getByTestId("servico-encerrar-confirmar")).toBeEnabled();
    fireEvent.click(screen.getByTestId("servico-encerrar-confirmar"));
    expect(await screen.findByTestId("atividade-passo")).toBeInTheDocument();
    expect(servico.criarApontamento).toHaveBeenCalledTimes(1);
    expect(servico.concluirAtividade).not.toHaveBeenCalled();
  });

  it("(a3) com EDITAR, o botão fica liberado e não há aviso de permissão", async () => {
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await screen.findByTestId("frente-at-1-bem-8%7C");
    expect(screen.getByTestId("atividade-encerrar")).toBeEnabled();
    expect(screen.getByTestId("atividade-encerrar")).not.toHaveAttribute("title");
    expect(screen.queryByTestId("atividade-encerrar-sem-permissao")).toBeNull();
  });
});

describe("D-PROD-348 — duplo clique (h)", () => {
  it("(h) duplo clique em \"Encerrar serviço\" envia UM só encerramento", async () => {
    /** @type {() => void} */
    let liberar = () => {};
    servico.criarApontamento.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          liberar = () => resolve({ apontamento: { id: "ap-enc", versao: 1 }, atividade: null, alertas: [] });
        }),
    );
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await abrirFrente("bem-7|imp-2");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    fireEvent.change(screen.getByTestId("encerrar-horimetro"), { target: { value: "1.200,5" } });
    const confirmar = screen.getByTestId("servico-encerrar-confirmar");
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    await waitFor(() => expect(servico.criarApontamento).toHaveBeenCalledTimes(1));
    liberar();
    expect(await screen.findByTestId("atividade-passo")).toBeInTheDocument();
    expect(servico.criarApontamento).toHaveBeenCalledTimes(1);
  });
});

describe("D-PROD-348 — acertos de rótulo, cartão e encerramento (itens 2, 3 e 5)", () => {
  it("(r1) o cabeçalho do serviço e o \"Encerrar serviço\" usam o NOME DO TIPO da atividade (Gradeação), não o tipo fixo (Preparo do solo)", async () => {
    renderizar({ atividade: { id: "at-1", tipo_atividade_id: "op-g", tipo_atividade_nome: "Gradeação", nome: "Gradeação · nov/26", data_inicio: "2026-11-20", versao: 7 } });
    expect(await screen.findByTestId("atividade-passo")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Gradeação");
    const iniciado = await abrirFrente("bem-7|imp-2");
    expect(within(iniciado).getByText("Gradeação")).toBeInTheDocument();
    expect(within(iniciado).queryByText("Preparo do solo")).toBeNull();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Gradeação · Hoje · 26/11");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    expect(screen.getByTestId("servico-encerrar-painel")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Gradeação · Hoje · 26/11");
    expect(screen.getByTestId("diario-atividades-titulo")).not.toHaveTextContent("Preparo do solo");
  });

  it("(r2) o cartão da atividade no pasto: \"Gradeação · nov/26\" (tipo e mês de início); sem tipo, o nome da atividade", () => {
    renderizar({
      atividadesAbertas: [
        { ...ATIVIDADE_SEM_FRENTE, tipo_atividade_nome: "Gradeação", nome: "Gradagem · nov/26" },
        { atividade_id: "at-3", nome: "Pasto de inverno", tipo_atividade_id: "op-g", data_inicio: "2026-05-03", area_status: "PLANEJADA" },
      ],
    });
    expect(screen.getByTestId("diario-atividade-aberta-at-2")).toHaveTextContent("Gradeação · nov/26");
    expect(screen.getByTestId("diario-atividade-aberta-at-2")).not.toHaveTextContent("Gradagem");
    expect(screen.getByTestId("diario-atividade-aberta-at-3")).toHaveTextContent("Pasto de inverno");
  });

  it("(r3) o mês do cartão é mmm/aa em pt-BR minúsculo, a partir de data_inicio", () => {
    expect(mesCurto("2026-11-20")).toBe("nov/26");
    expect(mesCurto("2026-05-03")).toBe("mai/26");
    expect(mesCurto("2026-08-01")).toBe("ago/26");
    expect(mesCurto("")).toBe("");
    expect(mesCurto("2026-13-01")).toBe("");
  });

  it("(i) \"Encerrar atividade\" fica DESABILITADO enquanto as frentes são lidas; lidas, o painel traz os horímetros", async () => {
    let liberar = () => {};
    const gate = new Promise((r) => {
      liberar = r;
    });
    servico.listarApontamentos.mockImplementation(async (id) => {
      await gate;
      return { items: [...(store[id] ?? [])] };
    });
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
    await screen.findByTestId("atividade-passo");
    expect(screen.getByTestId("atividade-carregando")).toBeInTheDocument();
    expect(screen.getByTestId("atividade-encerrar")).toBeDisabled();
    fireEvent.click(screen.getByTestId("atividade-encerrar"));
    expect(screen.queryByTestId("atividade-encerrar-painel")).toBeNull();

    await act(async () => liberar());
    await waitFor(() => expect(screen.getByTestId("atividade-encerrar")).toBeEnabled());
    fireEvent.click(screen.getByTestId("atividade-encerrar"));
    expect(screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-7|imp-2")}`)).toBeInTheDocument();
    expect(screen.getByTestId("atividade-encerrar-confirmar")).toBeEnabled();
  });

  it("(j) falha ao ler as frentes: o painel pede para TENTAR DE NOVO, confirmar fica desabilitado, e só depois de ler os horímetros entram", async () => {
    let falha = true;
    servico.listarApontamentos.mockImplementation(async (id) => {
      if (falha) throw new Error("rede");
      return { items: [...(store[id] ?? [])] };
    });
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
    await screen.findByTestId("atividade-erro-leitura");
    fireEvent.click(screen.getByTestId("atividade-encerrar"));
    expect(screen.getByTestId("atividade-encerrar-erro-leitura")).toHaveTextContent("Tente de novo");
    expect(screen.queryByTestId(/^atividade-encerrar-horimetro-/)).toBeNull();
    expect(screen.getByTestId("atividade-encerrar-confirmar")).toBeDisabled();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(servico.concluirAtividade).not.toHaveBeenCalled();

    falha = false;
    fireEvent.click(screen.getByTestId("atividade-encerrar-tentar"));
    await waitFor(() => expect(screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-7|imp-2")}`)).toBeInTheDocument());
    expect(screen.queryByTestId("atividade-encerrar-erro-leitura")).toBeNull();
    expect(screen.getByTestId("atividade-encerrar-confirmar")).toBeEnabled();
  });
});

// ─── D-PROD-348 (item 4): reabrir uma frente encerrada ─────

/** Põe no "servidor" o encerramento do Trator 12 + Pulverizador (dia 26, horímetro 1.100,0): a frente fica encerrada. */
const encerrarNoServidor = (id = "at-1") =>
  store[id].push(
    ap("ap-enc-trator12", "2026-11-26", marcadorDoEncerramento({ bemId: "bem-7", implementoId: "imp-2", horimetro: "1100.0", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L" })),
  );

describe("D-PROD-348 — reabrir uma frente encerrada (item 4)", () => {
  it("(q1) \"Reabrir\" envia a linha [reabertura-servico bem= impl=] (sem operador, sem linhas), relê e a frente volta a Aberto com o horímetro inicial original; não conta como lançamento do dia", async () => {
    encerrarNoServidor();
    const { onGravou } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    const encerrada = await screen.findByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(encerrada).toBeDisabled();
    expect(within(encerrada).getByText("● Encerrado")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("frente-reabrir-at-1-bem-7%7Cimp-2"));
    await waitFor(() => expect(servico.criarApontamento).toHaveBeenCalledTimes(1));
    expect(servico.criarApontamento.mock.calls[0]).toEqual(["at-1", { data_operacional: "2026-11-26", observacao: "[reabertura-servico bem=bem-7 impl=imp-2]" }]);
    expect(servico.criarApontamento.mock.calls[0][1]).not.toHaveProperty("operador_usuario_id");
    expect(servico.criarApontamento.mock.calls[0][1]).not.toHaveProperty("produtos");
    expect(servico.criarApontamento.mock.calls[0][1]).not.toHaveProperty("maquinas");
    await waitFor(() => expect(screen.getByTestId("frente-at-1-bem-7%7Cimp-2")).toBeEnabled());
    const reaberta = screen.getByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(within(reaberta).getByText("● Aberto")).toBeInTheDocument();
    expect(within(reaberta).getByText("1.000,0")).toBeInTheDocument();
    expect(within(reaberta).getByTestId("frente-hoje")).toBeInTheDocument();
    expect(screen.queryByTestId("frente-reabrir-at-1-bem-7%7Cimp-2")).toBeNull();
    expect(onGravou).not.toHaveBeenCalled();
    expect(notifySuccess).toHaveBeenCalledWith("Sucesso", "Serviço reaberto.");
  });

  it("(q2) sem permissão de lançar apontamento, a frente encerrada NÃO mostra \"Reabrir\"", async () => {
    permissoes.lancar = false;
    encerrarNoServidor();
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    await screen.findByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(screen.queryByTestId("frente-reabrir-at-1-bem-7%7Cimp-2")).toBeNull();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
  });

  it("(q3) atividade CONCLUÍDA: a frente encerrada NÃO mostra \"Reabrir\"", async () => {
    encerrarNoServidor();
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO], detalhe: { status: "CONCLUIDA" } });
    await abrirAtividade();
    await screen.findByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(screen.queryByTestId("frente-reabrir-at-1-bem-7%7Cimp-2")).toBeNull();
  });

  it("(q4) encerra → reabre → encerra de novo: a frente volta a Encerrado com o horímetro final do último encerramento", async () => {
    encerrarNoServidor();
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await abrirAtividade();
    fireEvent.click(await screen.findByTestId("frente-reabrir-at-1-bem-7%7Cimp-2"));
    await waitFor(() => expect(screen.getByTestId("frente-at-1-bem-7%7Cimp-2")).toBeEnabled());
    await abrirFrente("bem-7|imp-2");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    fireEvent.change(screen.getByTestId("encerrar-horimetro"), { target: { value: "1.150" } });
    fireEvent.click(screen.getByTestId("servico-encerrar-confirmar"));
    expect(await screen.findByTestId("atividade-passo")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("frente-at-1-bem-7%7Cimp-2")).toBeDisabled());
    const encerradaDeNovo = screen.getByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(within(encerradaDeNovo).getByText("1.150,0")).toBeInTheDocument();
    expect(within(encerradaDeNovo).getByText("1.000,0")).toBeInTheDocument();
    expect(screen.getByTestId("frente-reabrir-at-1-bem-7%7Cimp-2")).toBeInTheDocument();
    const observacoes = servico.criarApontamento.mock.calls.map((c) => c[1].observacao);
    expect(observacoes[0]).toBe("[reabertura-servico bem=bem-7 impl=imp-2]");
    expect(observacoes[1]).toMatch(/^\[encerramento-servico bem=bem-7 impl=imp-2 hor=1150\.0 /);
  });
});

// ─── D-PROD-348 (item 5): o tipo exige produção ─────

/** A recusa do concluir por produção, como o transporte a entrega (código no topo, campo e motivo em `details`). */
const erroDeProducao = () =>
  Object.assign(new Error("recusado"), { code: "ATIVIDADE_EXIGIDA_PELO_TIPO", details: { entidade: "atividade", field: "quantidade_produzida", reason: "exige_producao" } });
const TEXTO_PRODUCAO = "Este tipo de atividade exige informar a produção. Informe a quantidade produzida para encerrar.";
/** D-PROD-352 (item 2): a observação da produção, uma só linha `[producao-encerramento chave=…]`. */
const CHAVE_DA_PRODUCAO = /^\[producao-encerramento chave=[^\s\]]+\]$/;
/** As chamadas de criarApontamento que são a PRODUÇÃO (o encerramento não leva quantidade_produzida_dia). */
const chamadasDeProducao = () => servico.criarApontamento.mock.calls.filter(([, d]) => d.quantidade_produzida_dia !== undefined);

/** Na atividade com as duas frentes abertas: "Encerrar atividade", os dois horímetros finais e "Encerrar atividade" (confirmar). */
const encerrarAtividadeComDuasFrentes = async () => {
  await abrirAtividade();
  await screen.findByTestId("frente-at-1-bem-8%7C");
  fireEvent.click(screen.getByTestId("atividade-encerrar"));
  fireEvent.change(screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-7|imp-2")}`), { target: { value: "1.200,5" } });
  fireEvent.change(screen.getByTestId(`atividade-encerrar-horimetro-${encodeURIComponent("bem-8|")}`), { target: { value: "950" } });
  fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
};

describe("D-PROD-348 — o tipo exige produção: a recusa do concluir (item 5)", () => {
  it("(p1) o concluir recusa por produção: a mensagem clara aparece no painel, a atividade fica aberta, as frentes seguem encerradas e o campo de produção aparece", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();

    expect(await screen.findByTestId("atividade-encerrar-producao-exigida")).toHaveTextContent(TEXTO_PRODUCAO);
    expect(screen.queryByText(/ATIVIDADE_EXIGIDA_PELO_TIPO|Nada foi gravado/)).toBeNull();
    expect(screen.getByTestId("atividade-encerrar-producao")).toBeInTheDocument();
    expect(screen.getByTestId("atividade-encerrar-painel")).toHaveTextContent("Quantidade produzida");
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(1);
    expect(onFechar).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalledWith("Sucesso", "Atividade encerrada.");
    // Nada reaberto nem perdido: as duas frentes seguem encerradas (o cabeçalho não tem máquina aberta e os dois
    // encerramentos desta tentativa ficaram gravados; nenhuma reabertura foi enviada).
    expect(screen.getByTestId("atividade-topo")).toHaveTextContent("Sem máquina em campo");
    expect(servico.criarApontamento).toHaveBeenCalledTimes(2);
    expect(servico.criarApontamento.mock.calls.some((c) => String(c[1].observacao).startsWith("[reabertura-servico"))).toBe(false);
    expect(servico.criarApontamento.mock.calls.every((c) => c[1].observacao?.startsWith("[encerramento-servico "))).toBe(true);
  });

  it("(p2) com a unidade da atividade, o rótulo leva a sigla: \"Quantidade produzida (KM)\"", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO], detalhe: { unidade_producao_sigla: "KM" } });
    await encerrarAtividadeComDuasFrentes();
    expect(await screen.findByTestId("atividade-encerrar-producao")).toBeInTheDocument();
    expect(screen.getByTestId("atividade-encerrar-painel")).toHaveTextContent("Quantidade produzida (KM)");
  });

  it("(p3) \"Encerrar atividade\" sem a quantidade (ou com zero): erro no campo, nada é enviado", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    await screen.findByTestId("atividade-encerrar-producao");
    const criacoes = servico.criarApontamento.mock.calls.length;

    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    expect(await screen.findByText("Informe a quantidade produzida, maior que zero.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("atividade-encerrar-producao"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    expect(await screen.findByText("Informe a quantidade produzida, maior que zero.")).toBeInTheDocument();
    expect(servico.criarApontamento).toHaveBeenCalledTimes(criacoes);
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(1);
  });

  it("(p4) quantidade informada: grava o apontamento com quantidade_produzida_dia de hoje e a chave da tentativa, e conclui de novo com a versão atual", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    fireEvent.change(await screen.findByTestId("atividade-encerrar-producao"), { target: { value: "1.250,5" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));

    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    const producao = servico.criarApontamento.mock.calls[2];
    expect(producao).toEqual(["at-1", { data_operacional: "2026-11-26", quantidade_produzida_dia: "1250.5", observacao: expect.stringMatching(CHAVE_DA_PRODUCAO) }]);
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(2);
    expect(servico.concluirAtividade.mock.calls[1]).toEqual(["at-1", { versao: 7, data_conclusao: "2026-11-26" }]);
    expect(notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade encerrada.");
  });

  it("(p5) falha de rede no concluir DEPOIS de gravar a produção: tentar de novo não grava a produção outra vez", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao()).mockRejectedValueOnce(new Error("rede"));
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    fireEvent.change(await screen.findByTestId("atividade-encerrar-producao"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(servico.concluirAtividade).toHaveBeenCalledTimes(2));
    expect(onFechar).not.toHaveBeenCalled();
    expect(servico.criarApontamento).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(servico.criarApontamento).toHaveBeenCalledTimes(3);
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(3);
  });

  it("(p6) sem a recusa de produção, o encerramento segue igual: nenhum campo de produção aparece", async () => {
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("atividade-encerrar-producao")).toBeNull();
    expect(servico.criarApontamento).toHaveBeenCalledTimes(2);
  });

  // D-PROD-352 (item 2): a produção leva a chave da tentativa, e uma nova tentativa não a grava em dobro.
  it("(p7a) a 1ª gravação da produção leva a observação [producao-encerramento chave=…], uma linha só", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    fireEvent.change(await screen.findByTestId("atividade-encerrar-producao"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));

    const producoes = chamadasDeProducao();
    expect(producoes).toHaveLength(1);
    expect(producoes[0][1].observacao).toMatch(CHAVE_DA_PRODUCAO);
    expect(producoes[0][1].observacao.split("\n")).toHaveLength(1);
  });

  it("(p7b) a resposta do POST da produção se perdeu (o servidor JÁ gravou): a nova tentativa NÃO grava de novo e conclui", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    const gravaDeVerdade = servico.criarApontamento.getMockImplementation();
    servico.criarApontamento.mockImplementation(async (atividadeId, dados) => {
      if (dados.quantidade_produzida_dia === undefined) return gravaDeVerdade(atividadeId, dados);
      // O servidor grava, mas a resposta se perde: o POST rejeita e a lista seguinte já traz o apontamento com a chave.
      store[atividadeId].push(ap(`ap-prod-${store[atividadeId].length}`, dados.data_operacional, dados.observacao));
      throw new Error("rede");
    });
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    fireEvent.change(await screen.findByTestId("atividade-encerrar-producao"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith("Não foi possível encerrar a atividade", expect.stringContaining("A produção não foi lançada")));
    expect(onFechar).not.toHaveBeenCalled();
    expect(chamadasDeProducao()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    // Nenhum POST de produção a mais: a releitura achou a chave e a produção conta como gravada.
    expect(chamadasDeProducao()).toHaveLength(1);
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(2);
    expect(notifySuccess).toHaveBeenCalledWith("Sucesso", "Atividade encerrada.");
  });

  it("(p7c) a falha que NÃO gravou: a nova tentativa grava de novo, com a MESMA chave", async () => {
    servico.concluirAtividade.mockRejectedValueOnce(erroDeProducao());
    const gravaDeVerdade = servico.criarApontamento.getMockImplementation();
    let falhou = false;
    servico.criarApontamento.mockImplementation(async (atividadeId, dados) => {
      if (dados.quantidade_produzida_dia !== undefined && !falhou) {
        falhou = true;
        throw new Error("rede");
      }
      return gravaDeVerdade(atividadeId, dados);
    });
    const { onFechar } = renderizar({ atividadesAbertas: [ATIVIDADE_APLICACAO] });
    await encerrarAtividadeComDuasFrentes();
    fireEvent.change(await screen.findByTestId("atividade-encerrar-producao"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith("Não foi possível encerrar a atividade", expect.stringContaining("A produção não foi lançada")));
    expect(onFechar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("atividade-encerrar-confirmar"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    const producoes = chamadasDeProducao();
    expect(producoes).toHaveLength(2);
    // As duas tentativas (a que falhou e a que gravou) usam a mesma chave.
    expect(producoes[1][1].observacao).toMatch(CHAVE_DA_PRODUCAO);
    expect(producoes[1][1].observacao).toBe(producoes[0][1].observacao);
    expect(servico.concluirAtividade).toHaveBeenCalledTimes(2);
  });
});
