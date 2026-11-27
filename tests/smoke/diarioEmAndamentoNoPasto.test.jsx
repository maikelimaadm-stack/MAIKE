/**
 * D-PROD-341 — o "Diário das atividades" com atividades abertas no pasto (service mockado):
 *  (1) com 2 abertas: a 1ª tela é "Em andamento neste pasto" com as 2 e "Nova atividade"; cada uma com a etiqueta da abertura;
 *  (2) sem nenhuma aberta: abre direto no tipo, sem "Voltar" para a lista;
 *  (3) "Nova atividade" leva ao tipo; do tipo, o Voltar volta à lista;
 *  (4) tocar a aberta COM abertura: lê a atividade (`lerAtividade`) e vai ao cabeçalho do serviço;
 *  (5) tocar a aberta SEM abertura: formulário de abertura com o tipo e a operação dela já definidos;
 *  (6) falha ao ler: aviso (notifyWarning) e fica na lista;
 *  (7) tipo com atividade aberta no pasto: "Já existe … entra nela como mais uma frente." (só aviso); outro tipo, sem o aviso.
 * D-PROD-341 (emenda, frentes) e D-PROD-342 (modelo de frentes): a lista tem UM cartão por atividade (máquinas em campo); (b) tocar
 *  a atividade mostra um cartão por frente (máquina, implemento, operador, horímetro inicial), em ordem de início; (c) tocar uma
 *  frente abre só ela; (e) Nova atividade do mesmo tipo com outra máquina envia; (f)/(f2) mesma máquina+implemento não envia (ou
 *  envia, com outro implemento); (g)/(g2) continuar com duas abertas do mesmo tipo não envia (P1), com uma só envia. A atividade
 *  sem frente (5) mostra o aviso e "Adicionar máquina".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";

vi.mock("@/hooks/useLancamentoAtividadesSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ hoje: "2026-11-26", fuso: "America/Sao_Paulo", semFuso: false, fusoOk: true }),
  useAcoesTelaAtividades: () => ({ lancarApontamento: true, login: "operador", permissaoEfetiva: { is_admin: false } }),
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
}));

import DiarioDasAtividades from "@/components/lancamento-atividades/DiarioDasAtividades";
import { lerAbertura, marcadorDaAbertura } from "@/lib/aberturaServicoRegras";
import * as servico from "@/services/lancamentoAtividadesService";
import * as culturas from "@/services/culturaCadastroService";
import { notifyWarning } from "@/lib/maikeNotify";

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500" };
const OPERACAO_APLICACAO = { id: "op-1", nome_tipo: "Aplicação de defensivo", categoria: "APLICACAO", ativo: true };
const OPERACAO_GRADAGEM = { id: "op-g", nome_tipo: "Gradagem", categoria: "PREPARO_SOLO", ativo: true };
const TIPOS = [OPERACAO_APLICACAO, OPERACAO_GRADAGEM];

/** Duas atividades abertas no pasto: uma COM abertura (aplicação, em andamento) e uma SEM (gradagem, planejada). */
const ABERTA_COM_ABERTURA = {
  atividade_id: "at-1",
  numero: 10,
  nome: "Aplicação · nov/26",
  tipo_atividade_id: "op-1",
  tipo_atividade_nome: "Aplicação de defensivo",
  status: "ABERTA",
  area_status: "EM_ANDAMENTO",
  data_inicio: "2026-11-02",
};
const ABERTA_SEM_ABERTURA = {
  atividade_id: "at-2",
  numero: 11,
  nome: "Gradagem · nov/26",
  tipo_atividade_id: "op-g",
  tipo_atividade_nome: "Gradagem",
  status: "ABERTA",
  area_status: "PLANEJADA",
  data_inicio: "2026-11-20",
};
const APONTAMENTO_COM_ABERTURA = {
  id: "ap-1",
  data_operacional: "2026-11-02",
  status: "CONFIRMADO",
  observacao: marcadorDaAbertura({ bemId: "bem-7", implementoId: "", horimetro: "1245.0", responsavelId: "usr-3", bemNome: "Trator 12", implementoNome: "", responsavelNome: "João Pereira" }),
};
const BENS = { itens: [{ id: "bem-7", nome: "Trator 12" }], has_more: false, next_cursor: null };
const OPERADORES = { itens: [{ id: "usr-3", nome: "João Pereira" }], has_more: false, next_cursor: null };

/**
 * @param {{ atividadesAbertas?: any[], tipos?: any[], lerAtividade?: (id: string) => Promise<any> }} [props]
 */
const renderizar = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  const lerAtividade = props.lerAtividade ?? vi.fn(async (id) => ({ id, versao: 3, tipo_atividade_id: id === "at-1" ? "op-1" : "op-g" }));
  render(
    <QueryClientProvider client={queryClient}>
      <DiarioDasAtividades
        area={AREA}
        tipos={props.tipos ?? TIPOS}
        atividadesAbertas={props.atividadesAbertas ?? []}
        lerAtividade={lerAtividade}
        onFechar={onFechar}
      />
    </QueryClientProvider>,
  );
  return { onFechar, lerAtividade };
};

beforeEach(() => {
  servico.listarOpcoesBens.mockResolvedValue(BENS);
  servico.listarOpcoesImplementos.mockResolvedValue({ itens: [], has_more: false, next_cursor: null });
  servico.listarOpcoesOperadores.mockResolvedValue(OPERADORES);
  servico.obterMedidorDoBem.mockResolvedValue({ medidor_tipo: "HORIMETRO", medidor_unidade: "h", leitura_vigente: null });
  servico.registrarCampo.mockResolvedValue({ atividade: { id: "at-1" }, apontamento: { id: "ap-9" } });
  servico.obterAtividade.mockResolvedValue({ id: "at-1" });
  // Por atividade: a 1ª tem a linha de abertura; a 2ª só uma observação de texto (o fluxo antigo).
  servico.listarApontamentos.mockImplementation(async (id) =>
    id === "at-1" ? { items: [APONTAMENTO_COM_ABERTURA] } : { items: [{ id: "ap-2", data_operacional: "2026-11-20", status: "CONFIRMADO", observacao: "Só texto" }] },
  );
  culturas.listarCulturas.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Diário das atividades — Em andamento neste pasto (D-PROD-341)", () => {
  it("(1) com 2 abertas, a 1ª tela é a lista delas, com a etiqueta de cada abertura e o botão Nova atividade", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA] });
    expect(screen.getByTestId("diario-atividades-escolher")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Em andamento neste pasto");
    expect(screen.queryByTestId("diario-atividades-tipos")).toBeNull();
    // D-PROD-342: um cartão por ATIVIDADE. A com frente mostra as máquinas em campo; a planejada, "Sem máquina em campo".
    const primeira = await screen.findByTestId("diario-atividade-aberta-at-1");
    expect(primeira).toHaveTextContent("Aplicação · nov/26");
    expect(primeira).toHaveTextContent("Início 02/11");
    expect(within(primeira).getByTestId("diario-atividade-aberta-etiqueta-at-1")).toHaveTextContent("Em andamento");
    await waitFor(() => expect(primeira).toHaveTextContent("1 máquina em campo"));
    const segunda = screen.getByTestId("diario-atividade-aberta-at-2");
    expect(segunda).toHaveTextContent("Gradagem · nov/26");
    expect(segunda).toHaveTextContent("Início 20/11");
    expect(within(segunda).getByTestId("diario-atividade-aberta-etiqueta-at-2")).toHaveTextContent("Aberta");
    expect(screen.queryByTestId(/^diario-frente-/)).toBeNull();
    expect(screen.getByTestId("diario-nova-atividade")).toHaveTextContent("Nova atividade");
  });

  it("(2) sem atividade aberta, abre direto no tipo, sem o Voltar para a lista", () => {
    renderizar({ atividadesAbertas: [] });
    expect(screen.getByTestId("diario-atividades-tipos")).toBeInTheDocument();
    expect(screen.queryByTestId("diario-atividades-escolher")).toBeNull();
    expect(screen.queryByTestId("diario-voltar-lista")).toBeNull();
    expect(screen.queryByTestId("diario-nova-atividade")).toBeNull();
  });

  it("(3) Nova atividade leva ao tipo; do tipo, o Voltar volta à lista", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA] });
    fireEvent.click(screen.getByTestId("diario-nova-atividade"));
    expect(screen.getByTestId("diario-atividades-tipos")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Nova atividade");
    expect(screen.queryByTestId("diario-atividades-escolher")).toBeNull();
    fireEvent.click(screen.getByTestId("diario-voltar-lista"));
    expect(screen.getByTestId("diario-atividades-escolher")).toBeInTheDocument();
    expect(screen.queryByTestId("diario-atividades-tipos")).toBeNull();
  });

  it("(4) tocar a atividade COM abertura lê a atividade e vai ao cabeçalho do serviço", async () => {
    const { lerAtividade } = renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
    expect(lerAtividade).toHaveBeenCalledWith("at-1");
    // D-PROD-342: tocar a atividade vai às frentes dela; a frente (máquina sem implemento: "bem-7|") leva ao serviço.
    fireEvent.click(await screen.findByTestId("frente-at-1-bem-7%7C"));
    expect(await screen.findByTestId("abertura-iniciado")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Diário das atividades");
    expect(screen.getByTestId("servico-encerrar")).toBeInTheDocument();
    expect(await screen.findByText("Horímetro inicial 1.245,0")).toBeInTheDocument();
  });

  it("(5) tocar a atividade SEM frente vai ao passo da atividade (aviso); \"Adicionar máquina\" abre o formulário com o tipo e a operação dela já escolhidos", async () => {
    const { lerAtividade } = renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-2"));
    expect(await screen.findByTestId("atividade-sem-maquina")).toHaveTextContent("Esta atividade não tem máquina em campo.");
    expect(lerAtividade).toHaveBeenCalledWith("at-2");
    fireEvent.click(screen.getByTestId("atividade-adicionar-maquina"));
    expect(await screen.findByTestId("abertura-form")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Adicionar máquina");
    expect(screen.getByTestId("abertura-servico-existente")).toHaveTextContent("Este pasto já tem o serviço Gradagem em andamento, sem abertura. Preencha para iniciar.");
    expect(screen.queryByTestId("abertura-iniciado")).toBeNull();
    expect(screen.queryByTestId("abertura-operacao")).toBeNull();
  });

  it("(6) falha ao ler a atividade: aviso e a lista continua na tela", async () => {
    const lerAtividade = vi.fn(async () => {
      throw new Error("rede");
    });
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA], lerAtividade });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith("Não foi possível abrir o serviço", expect.any(String)));
    expect(screen.getByTestId("diario-atividades-escolher")).toBeInTheDocument();
    expect(screen.queryByTestId("abertura-iniciado")).toBeNull();
  });

  it("(7) o tipo com atividade aberta no pasto mostra o aviso \"Já existe …\"; outro tipo, não", () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA] });
    fireEvent.click(screen.getByTestId("diario-nova-atividade"));
    fireEvent.click(screen.getByTestId("abertura-tipo-APLICACAO"));
    expect(screen.getByTestId("abertura-ja-existe")).toHaveTextContent(
      "Já existe Aplicação · nov/26 aberta neste pasto: este serviço entra nela como mais uma frente (outra máquina ou implemento).",
    );
    fireEvent.click(screen.getByTestId("abertura-tipo-PLANTIO"));
    expect(screen.queryByTestId("abertura-ja-existe")).toBeNull();
  });
});

// ─── D-PROD-341 (emenda): uma abertura por máquina + implemento (frentes) ─────

const MSG_FRENTE_DUPLICADA = "Esta máquina com este implemento já tem serviço aberto neste pasto. Toque nele na lista para continuar.";
const MSG_TIPO_AMBIGUO = "Há mais de uma atividade deste tipo aberta neste pasto, e o servidor não deixa escolher qual recebe a abertura. Conclua uma delas e tente de novo.";

/** Quatro máquinas: três já têm frente na atividade at-1 (Trator 12, 08 e 09); o Trator 10 não tem nenhuma. */
const BENS_TRES = {
  itens: [
    { id: "bem-7", nome: "Trator 12" },
    { id: "bem-8", nome: "Trator 08" },
    { id: "bem-9", nome: "Trator 09" },
    { id: "bem-10", nome: "Trator 10" },
  ],
  has_more: false,
  next_cursor: null,
};
const IMPLEMENTOS_UM = { itens: [{ id: "imp-2", nome: "Pulverizador 2.000 L" }], has_more: false, next_cursor: null };
const OPERADORES_DUAS = {
  itens: [
    { id: "usr-3", nome: "João Pereira" },
    { id: "usr-4", nome: "Maria Souza" },
  ],
  has_more: false,
  next_cursor: null,
};
/** Um apontamento CONFIRMADO de um dia, com a observação e as linhas de produto dadas. */
const apontamento = (id, dia, observacao, produtos = []) => ({ id, data_operacional: dia, status: "CONFIRMADO", versao: 2, createdAt: `${dia}T09:00:00.000Z`, observacao, produtos, maquinas: [], mao_obra: [], servicos: [] });
/** Uma linha de produto CONFIRMADA (a carga `jato`). */
const linhaProduto = (id, nome, quantidade, unidade, jato) => ({ id, status: "CONFIRMADO", produto_id: id, produto: { nome }, quantidade, unidade, jato, createdAt: "2026-11-26T09:10:00.000Z" });
const abertura3 = (bemId, bemNome, responsavelId, responsavelNome, implementoId = "", implementoNome = "") =>
  marcadorDaAbertura({ bemId, bemNome, implementoId, implementoNome, horimetro: "1000.0", responsavelId, responsavelNome });
/**
 * A atividade at-1 com TRÊS máquinas, em dias diferentes: Trator 12 + Pulverizador (início 02/11, com Glifosato hoje), Trator 08
 * sem implemento (início 20/11, com Ureia hoje) e Trator 09 + Pulverizador (início 10/11, sem nada hoje).
 */
const FRENTES_DO_PASTO = [
  apontamento("ap-1", "2026-11-02", abertura3("bem-7", "Trator 12", "usr-3", "João Pereira", "imp-2", "Pulverizador 2.000 L")),
  apontamento("ap-1h", "2026-11-26", abertura3("bem-7", "Trator 12", "usr-3", "João Pereira", "imp-2", "Pulverizador 2.000 L"), [linhaProduto("pl-1", "Glifosato", "10.0000", "L", 1)]),
  apontamento("ap-2", "2026-11-20", abertura3("bem-8", "Trator 08", "usr-4", "Maria Souza")),
  apontamento("ap-2h", "2026-11-26", abertura3("bem-8", "Trator 08", "usr-4", "Maria Souza"), [linhaProduto("pl-2", "Ureia", "500.0000", "kg", 1)]),
  apontamento("ap-3", "2026-11-10", abertura3("bem-9", "Trator 09", "usr-3", "João Pereira", "imp-2", "Pulverizador 2.000 L")),
];

/** Escolhe uma opção de um campo de escolha Base1 (o botão combobox abre a lista; a opção é clicada). */
const escolherOpcao = async (combobox, rotulo) => {
  await act(async () => fireEvent.click(combobox));
  const opcao = await screen.findByRole("option", { name: rotulo });
  await act(async () => fireEvent.click(opcao));
};

/** Abre "Nova atividade" do tipo Aplicação e chega ao formulário de abertura (com a atividade aberta do pasto na lista). */
const novaAplicacao = async () => {
  fireEvent.click(await screen.findByTestId("diario-nova-atividade"));
  fireEvent.click(screen.getByTestId("abertura-tipo-APLICACAO"));
  fireEvent.click(screen.getByTestId("abertura-continuar"));
  await screen.findByTestId("abertura-form");
};

describe("Diário das atividades — frentes: uma abertura por máquina + implemento (D-PROD-341, emenda)", () => {
  beforeEach(() => {
    servico.listarOpcoesBens.mockResolvedValue(BENS_TRES);
    servico.listarOpcoesOperadores.mockResolvedValue(OPERADORES_DUAS);
    servico.listarOpcoesImplementos.mockResolvedValue(IMPLEMENTOS_UM);
    servico.listarApontamentos.mockImplementation(async (id) => (id === "at-1" ? { items: FRENTES_DO_PASTO } : { items: [apontamento("ap-x", "2026-11-02", "Só texto")] }));
  });

  it("(b) a lista mostra UMA atividade com \"3 máquinas em campo\"; tocá-la mostra um cartão por frente, em ordem de início", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA] });
    const card = await screen.findByTestId("diario-atividade-aberta-at-1");
    await waitFor(() => expect(card).toHaveTextContent("3 máquinas em campo"));
    fireEvent.click(card);
    const lista = await screen.findByRole("list", { name: "Máquinas em campo" });
    // Três cartões de frente (um por máquina+implemento), na ordem do início: 02/11, 10/11, 20/11.
    const ordem = Array.from(lista.querySelectorAll('[data-testid^="frente-at-1-"]')).map((el) => el.getAttribute("data-testid"));
    expect(ordem).toEqual(["frente-at-1-bem-7%7Cimp-2", "frente-at-1-bem-9%7Cimp-2", "frente-at-1-bem-8%7C"]);
    const trator12 = screen.getByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(trator12).toHaveTextContent("Trator 12");
    expect(trator12).toHaveTextContent("Pulverizador 2.000 L");
    expect(trator12).toHaveTextContent("Operador");
    expect(trator12).toHaveTextContent("João Pereira");
    expect(trator12).toHaveTextContent("1.000,0");
    const trator08 = screen.getByTestId("frente-at-1-bem-8%7C");
    expect(trator08).toHaveTextContent("Trator 08");
    expect(trator08.textContent).not.toContain(" + ");
    expect(trator08).toHaveTextContent("Maria Souza");
    expect(screen.getByTestId("frente-at-1-bem-9%7Cimp-2")).toHaveTextContent("Trator 09");
    expect(screen.getByTestId("frente-at-1-bem-9%7Cimp-2")).toHaveTextContent("Pulverizador 2.000 L");
    expect(screen.getByTestId("atividade-adicionar-maquina")).toBeInTheDocument();
  });

  it("(c) tocar numa frente abre só o serviço dela: o cabeçalho e o \"Lançado hoje\" são os dela", async () => {
    const { lerAtividade } = renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA] });
    fireEvent.click(await screen.findByTestId("diario-atividade-aberta-at-1"));
    fireEvent.click(await screen.findByTestId("frente-at-1-bem-8%7C"));
    const cabecalho = await screen.findByTestId("abertura-iniciado");
    expect(lerAtividade).toHaveBeenCalledWith("at-1");
    expect(within(cabecalho).getByText("Trator 08")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Maria Souza")).toBeInTheDocument();
    expect(within(cabecalho).queryByText("Trator 12")).toBeNull();
    const lancados = await screen.findAllByTestId("servico-lancado-item");
    expect(lancados).toHaveLength(1);
    expect(lancados[0]).toHaveTextContent("Ureia");
    expect(screen.queryByText(/Glifosato/)).toBeNull();
  });

  it("(e) \"Nova atividade\" do mesmo tipo com outra máquina envia registrarCampo normalmente e avisa que entra como mais uma frente", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA] });
    await novaAplicacao();
    expect(screen.getByTestId("abertura-ja-existe")).toHaveTextContent("Já existe Aplicação · nov/26 aberta neste pasto: este serviço entra nela como mais uma frente");
    // Trator 10: uma máquina sem frente no pasto (a Trator 08 já tem uma, e seria duplicidade).
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 10");
    fireEvent.change(screen.getByTestId("abertura-horimetro"), { target: { value: "900" } });
    await escolherOpcao(screen.getByRole("combobox", { name: "Responsável" }), "Maria Souza");
    expect(screen.queryByTestId("abertura-trava")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    // Volta ao passo da atividade (as frentes) depois de gravar.
    await screen.findByTestId("atividade-passo");
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
    const [dados] = servico.registrarCampo.mock.calls[0];
    expect(dados).toMatchObject({ tipo_atividade_id: "op-1", bem_id: "bem-10", operador_usuario_id: "usr-4" });
    expect(lerAbertura(dados.observacao)).toMatchObject({ bemId: "bem-10", responsavelId: "usr-4" });
    expect(notifyWarning).not.toHaveBeenCalled();
  });

  it("(f) a mesma máquina com o mesmo implemento já aberta no pasto: não envia, mostra a ajuda e desabilita Iniciar serviço", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA] });
    await novaAplicacao();
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolherOpcao(screen.getByRole("combobox", { name: "Implemento" }), "Pulverizador 2.000 L");
    expect(await screen.findByTestId("abertura-trava")).toHaveTextContent(MSG_FRENTE_DUPLICADA);
    expect(screen.getByRole("button", { name: "Iniciar serviço" })).toBeDisabled();
    // Mesmo pelo envio (Enter no formulário): não manda, e avisa com a mesma frase.
    fireEvent.submit(screen.getByTestId("abertura-form"));
    expect(notifyWarning).toHaveBeenCalledWith("Não foi possível iniciar o serviço", MSG_FRENTE_DUPLICADA);
    expect(servico.registrarCampo).not.toHaveBeenCalled();
  });

  it("(f2) a mesma máquina com OUTRO implemento (ou sem) não é duplicidade: envia", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA] });
    await novaAplicacao();
    // Trator 12 SEM implemento: a chave é "bem-7|", diferente de "bem-7|imp-2" já aberta.
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    expect(screen.queryByTestId("abertura-trava")).toBeNull();
    expect(screen.getByRole("button", { name: "Iniciar serviço" })).not.toBeDisabled();
  });

  it("(g) continuar a atividade SEM abertura com DUAS abertas do mesmo tipo: aviso, botão desabilitado e sem envio (P1)", async () => {
    const segundaSemAbertura = { ...ABERTA_SEM_ABERTURA, atividade_id: "at-3", numero: 12, nome: "Gradagem · dez/26", data_inicio: "2026-11-05" };
    renderizar({ atividadesAbertas: [ABERTA_SEM_ABERTURA, segundaSemAbertura] });
    fireEvent.click(await screen.findByTestId("diario-atividade-aberta-at-2"));
    fireEvent.click(await screen.findByTestId("atividade-adicionar-maquina"));
    await screen.findByTestId("abertura-form");
    expect(screen.getByTestId("abertura-trava")).toHaveTextContent(MSG_TIPO_AMBIGUO);
    expect(screen.getByRole("button", { name: "Iniciar serviço" })).toBeDisabled();
    fireEvent.submit(screen.getByTestId("abertura-form"));
    expect(notifyWarning).toHaveBeenCalledWith("Não foi possível iniciar o serviço", MSG_TIPO_AMBIGUO);
    expect(servico.registrarCampo).not.toHaveBeenCalled();
  });

  it("(g2) continuar a atividade SEM abertura com uma só do tipo: envia normalmente", async () => {
    renderizar({ atividadesAbertas: [ABERTA_SEM_ABERTURA] });
    fireEvent.click(await screen.findByTestId("diario-atividade-aberta-at-2"));
    fireEvent.click(await screen.findByTestId("atividade-adicionar-maquina"));
    await screen.findByTestId("abertura-form");
    expect(screen.queryByTestId("abertura-trava")).toBeNull();
    await escolherOpcao(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    fireEvent.change(screen.getByTestId("abertura-horimetro"), { target: { value: "1200" } });
    await escolherOpcao(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("atividade-passo");
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
    expect(servico.registrarCampo.mock.calls[0][0]).toMatchObject({ tipo_atividade_id: "op-g", bem_id: "bem-7" });
  });
});
