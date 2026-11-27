/**
 * D-PROD-359 — o Abastecimento DENTRO da frente do Diário das atividades (a tela real, na mesma janela do serviço, como a
 * Carga de insumo). O fluxo de gravação é o que já existe (`useFluxoAbastecimento`); aqui os serviços de abastecimento e de
 * atividade são mocks finos: o corpo enviado é montado pelos construtores REAIS (`montarCorpoPrevia` e
 * `montarCorpoConfirmacao`), e a lista de "Lançado hoje" lê o que foi gravado.
 *  (a) a opção "Abastecimento" abre a tela (não mais "Em breve"), com os dois botões de origem e "Salvar abastecimento";
 *  (b) tanque da fazenda: um Produto e um local já vêm escolhidos, "Disponível neste local" com a unidade do cadastro;
 *      "Salvar" pede a prévia e confirma DIRETO; o corpo leva apontamento_id (o registro de hoje da frente), bem, produto,
 *      local, quantidade e medidor_leitura, e nenhum campo de posto externo; a revisão não aparece;
 *  (c) sem registro de hoje na frente, cria o registro do dia (vazio, com a abertura na observação) UMA vez, mesmo que a
 *      primeira tentativa falhe;
 *  (d) posto externo: exige o valor da nota, não tem local, e o corpo vai com origem EXTERNO e custo_total;
 *  (e) prévia com bloqueio (saldo insuficiente): a revisão aparece na MESMA tela, sem confirmar e sem popup;
 *  (f) o abastecimento gravado aparece em "Lançado hoje" com "80 L" e sem o cancelado;
 *  (g) sem a permissão de criar abastecimento a opção não aparece;
 *  (h) a frente encerrada não abre o abastecimento (a opção some).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import { lerAbertura, marcadorDaAbertura, marcadorDoEncerramento } from "@/lib/aberturaServicoRegras";

/** A permissão de lançar apontamento e de editar a atividade (o cenário das outras telas do Diário). */
const permissoes = vi.hoisted(() => ({ editar: true, lancar: true }));
/** A permissão da tela Abastecimentos (criar e ver). */
const permissaoAbastecimento = vi.hoisted(() => ({ criar: true, ver: true }));
/**
 * O "servidor" dos abastecimentos: o que as chamadas gravam (corpos, registros) e as respostas que os testes preparam.
 * Os dados do bem e do Produto são os do cadastro de um trator com medidor de horímetro.
 */
const servidor = vi.hoisted(() => ({
  /** Quantas prévias falham (rede) antes de responder. */
  previaFalhas: 0,
  /** Bloqueios que a prévia devolve (vazio = sem bloqueio). */
  previaBloqueios: /** @type {any[]} */ ([]),
  previas: /** @type {any[]} */ ([]),
  confirmacoes: /** @type {any[]} */ ([]),
  /** Os abastecimentos da máquina (a lista lê daqui, filtrando pelo status pedido). */
  abastecimentos: /** @type {any[]} */ ([]),
  /** O produto do bem (um só, como o cadastro do trator): o tanque que aceita o diesel. */
  produtosDoBem: {
    bem: {
      id: "bem-7",
      nome: "Trator 12",
      codigo_frota: null,
      natureza: "MAQUINA",
      ativo: true,
      medidor: { tipo: "HORIMETRO", unidade: "h" },
      leitura_vigente: { leitura: "1100.0000", data: "2026-11-20", origem: "ATIVIDADE", numero: null },
    },
    itens: [
      {
        produto: { id: "p1", nome: "Óleo diesel S10", unidade_principal_estoque: "L" },
        tanques: [{ id: "tq1", identificador: "Tanque principal", capacidade_litros: "180.0000" }],
        pronto: true,
      },
    ],
    has_more: false,
    next_cursor: null,
    resumo: null,
  },
  /** Os locais com saldo do Produto: um só, com 8.420 L (o cadastro do tanque da sede). */
  locais: {
    itens: [{ local_estoque_id: "l1", local_nome: "Tanque diesel sede", disponivel: "8420.0000", unidade: "L", unidade_principal_estoque: "L" }],
    has_more: false,
    next_cursor: null,
  },
}));

vi.mock("@/hooks/useLancamentoAtividadesSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ hoje: "2026-11-26", fuso: "America/Sao_Paulo", semFuso: false, fusoOk: true }),
  useAcoesTelaAtividades: () => ({ lancarApontamento: permissoes.lancar, editar: permissoes.editar, login: "operador", permissaoEfetiva: { is_admin: false } }),
}));
vi.mock("@/hooks/usePatrimonioSessao", () => ({
  useAcoesTelaAbastecimento: () => ({ ver: permissaoAbastecimento.ver, criar: permissaoAbastecimento.criar, cancelar: false, login: "operador" }),
  useAcoesTelaPatrimonio: () => ({ ver: false }),
}));
vi.mock("@/lib/AuthContext", async (importOriginal) => ({ ...(await importOriginal()), useAuth: () => ({ clienteId: "c1", user: { id: "u1" } }) }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({
  ...(await importOriginal()),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));
vi.mock("@/services/mapaCacheService", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));
vi.mock("@/services/culturaCadastroService", () => ({ listarCulturas: vi.fn() }));
vi.mock("@/services/abastecimentoService", async (importOriginal) => {
  const real = await importOriginal();
  const regras = await import("@/lib/abastecimentoRegras");
  return {
    ...real,
    listarProdutosDoBem: vi.fn(async () => servidor.produtosDoBem),
    listarOpcoesAbastecimento: vi.fn(async (recurso) => (recurso === "locais" ? servidor.locais : { itens: [], has_more: false, next_cursor: null })),
    previaDoAbastecimento: vi.fn(async (emp, form) => {
      const corpo = regras.montarCorpoPrevia(emp, form);
      servidor.previas.push(corpo);
      if (servidor.previaFalhas > 0) {
        servidor.previaFalhas -= 1;
        throw new TypeError("Failed to fetch");
      }
      return { plano: planoDe(corpo, form), bloqueios: servidor.previaBloqueios };
    }),
    confirmarAbastecimento: vi.fn(async (emp, form, plano) => {
      const corpo = regras.montarCorpoConfirmacao(emp, form, plano);
      servidor.confirmacoes.push(corpo);
      const registro = {
        id: `ab-${servidor.abastecimentos.length + 1}`,
        numero: servidor.abastecimentos.length + 1,
        status: "CONFIRMADO",
        versao: 1,
        bem: { id: "bem-7", nome: "Trator 12" },
        produto: { id: "p1", nome: "Óleo diesel S10" },
        local_estoque: corpo.origem === "EXTERNO" ? null : { id: "l1", nome: "Tanque diesel sede" },
        origem: corpo.origem ?? "ESTOQUE",
        quantidade: `${corpo.quantidade}`,
        unidade: "L",
        data_operacional: corpo.data_operacional,
        created_date: "2026-11-26T10:20:00.000Z",
      };
      servidor.abastecimentos.push(registro);
      return registro;
    }),
    listarAbastecimentosPagina: vi.fn(async (_emp, opts = {}) => ({
      items: servidor.abastecimentos.filter((a) => (!opts.status || a.status === opts.status) && (!opts.bemId || a.bem.id === opts.bemId)),
      has_more: false,
      next_cursor: null,
    })),
  };
});
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
import * as servico from "@/services/lancamentoAtividadesService";
import * as abastecimentoServico from "@/services/abastecimentoService";
import { notifyWarning } from "@/lib/maikeNotify";

/** A função do plano que a prévia devolve (o que a revisão lê): máquina, Produto, quantidade, local e medidor. */
function planoDe(corpo, form) {
  return {
    bem: form.bem,
    produto: { nome: form.produto?.nome ?? "", unidade_principal_estoque: form.produto?.unidade_principal_estoque ?? "L" },
    unidade: "L",
    quantidade: corpo.quantidade,
    data_operacional: corpo.data_operacional,
    tanque_cheio: false,
    local_estoque: corpo.origem === "EXTERNO" ? null : { id: "l1", nome: "Tanque diesel sede" },
    custo_total: corpo.custo_total ?? null,
    origem: corpo.origem ?? "ESTOQUE",
    medidor: corpo.medidor_leitura ? { tipo: "HORIMETRO", leitura: corpo.medidor_leitura } : null,
    fifo: null,
  };
}

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500" };
const OPERACAO_APLICACAO = { id: "op-1", nome_tipo: "Aplicação de defensivo", categoria: "APLICACAO", ativo: true };
const OPERACAO_GRADAGEM = { id: "op-g", nome_tipo: "Gradagem", categoria: "PREPARO_SOLO", ativo: true };
const TIPOS = [OPERACAO_APLICACAO, OPERACAO_GRADAGEM];
const BENS = { itens: [{ id: "bem-7", nome: "Trator 12" }], has_more: false, next_cursor: null };
const IMPLEMENTOS = { itens: [{ id: "imp-2", nome: "Pulverizador 2.000 L" }], has_more: false, next_cursor: null };
const OPERADORES = { itens: [{ id: "usr-3", nome: "João Pereira" }], has_more: false, next_cursor: null };
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
const DETALHE = { "at-1": { id: "at-1", tipo_atividade_id: "op-1", tipo_atividade_nome: "Aplicação de defensivo", nome: "Aplicação · nov/26", data_inicio: "2026-11-02", versao: 7 } };

/** A abertura da frente Trator 12 + Pulverizador (o registro de abertura, com a linha na observação). */
const TRATOR_12 = marcadorDaAbertura({ bemId: "bem-7", bemNome: "Trator 12", implementoId: "imp-2", implementoNome: "Pulverizador 2.000 L", horimetro: "1000.0", responsavelId: "usr-3", responsavelNome: "João Pereira" });
const TRATOR_08 = marcadorDaAbertura({ bemId: "bem-8", bemNome: "Trator 08", horimetro: "900.0", responsavelId: "usr-3", responsavelNome: "João Pereira" });
const ap = (id, dia, observacao, extra = {}) => ({ id, data_operacional: dia, status: "CONFIRMADO", versao: 2, createdAt: `${dia}T09:00:00.000Z`, observacao, produtos: [], maquinas: [], mao_obra: [], servicos: [], ...extra });

/** O servidor de atividades: a frente Trator 12 (aberta), com o registro de hoje (ap-1h). */
let store;
const comecoDoServidor = () => ({
  "at-1": [ap("ap-1", "2026-11-02", TRATOR_12), ap("ap-1h", "2026-11-26", TRATOR_12), ap("ap-2", "2026-11-20", TRATOR_08)],
  "at-2": [],
});

/** @param {{ atividadesAbertas?: any[] }} [props] */
const renderizar = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  const onGravou = vi.fn();
  const lerAtividade = vi.fn(async (id) => ({ ...DETALHE[/** @type {"at-1"} */ (id)] }));
  render(
    <QueryClientProvider client={queryClient}>
      <DiarioDasAtividades
        area={AREA}
        tipos={TIPOS}
        atividadesAbertas={props.atividadesAbertas ?? [ATIVIDADE_APLICACAO]}
        lerAtividade={lerAtividade}
        onFechar={onFechar}
        onGravou={onGravou}
      />
    </QueryClientProvider>,
  );
  return { onFechar, onGravou };
};

/** Do passo "Em andamento", toca a atividade e a frente Trator 12 (o serviço da frente). */
const abrirFrente = async (chave = "bem-7|imp-2") => {
  fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
  await screen.findByTestId("atividade-passo");
  fireEvent.click(await screen.findByTestId(`frente-at-1-${encodeURIComponent(chave)}`));
  return screen.findByTestId("abertura-iniciado");
};
/** No serviço da frente, toca "Abastecimento" e espera o formulário. */
const abrirAbastecimento = async () => {
  fireEvent.click(await screen.findByTestId("servico-opcao-abastecimento"));
  return screen.findByTestId("abastecimento-frente-form");
};
/** Preenche a quantidade e o horímetro (o que um operador digita). */
const preencherEstoque = ({ quantidade = "80", horimetro = "1131,5" } = {}) => {
  fireEvent.change(screen.getByTestId("abastecimento-frente-quantidade"), { target: { value: quantidade } });
  fireEvent.change(screen.getByTestId("abastecimento-frente-horimetro"), { target: { value: horimetro } });
};

beforeEach(() => {
  permissoes.editar = true;
  permissoes.lancar = true;
  permissaoAbastecimento.criar = true;
  permissaoAbastecimento.ver = true;
  servidor.previaFalhas = 0;
  servidor.previaBloqueios = [];
  servidor.previas = [];
  servidor.confirmacoes = [];
  servidor.abastecimentos = [];
  store = comecoDoServidor();
  servico.listarOpcoesBens.mockResolvedValue(BENS);
  servico.listarOpcoesImplementos.mockResolvedValue(IMPLEMENTOS);
  servico.listarOpcoesOperadores.mockResolvedValue(OPERADORES);
  servico.obterMedidorDoBem.mockResolvedValue({ medidor_tipo: "HORIMETRO", medidor_unidade: "h", leitura_vigente: null });
  servico.obterAtividade.mockImplementation(async (id) => ({ ...DETALHE[/** @type {"at-1"} */ (id)] }));
  servico.listarApontamentos.mockImplementation(async (id) => ({ items: [...(store[id] ?? [])] }));
  // O registro do dia criado pelo abastecimento NÃO entra na lista aqui: a tentativa seguinte acha o id guardado (não cria outro).
  servico.criarApontamento.mockImplementation(async (atividadeId, dados) => {
    const linha = ap(`ap-dia-${servico.criarApontamento.mock.calls.length}`, dados.data_operacional, dados.observacao);
    return { apontamento: { id: linha.id, versao: 1 }, atividade: null, alertas: [] };
  });
  servico.concluirAtividade.mockResolvedValue({ id: "at-1", status: "CONCLUIDA" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("D-PROD-359 — a opção Abastecimento abre a tela real (a)", () => {
  it("(a) a opção abre \"Abastecimento\" (não \"Em breve\"), com a origem Tanque da fazenda ou Posto externo e o botão Salvar abastecimento", async () => {
    renderizar();
    await abrirFrente();
    await abrirAbastecimento();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Abastecimento");
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Aplicação de defensivo · Trator 12");
    expect(screen.queryByTestId("servico-em-breve")).toBeNull();
    const origens = screen.getByRole("group", { name: "Origem do abastecimento" });
    expect(within(origens).getByRole("button", { name: "Tanque da fazenda" })).toHaveAttribute("aria-pressed", "true");
    expect(within(origens).getByRole("button", { name: "Posto externo" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("abastecimento-salvar")).toHaveTextContent("Salvar abastecimento");
    expect(screen.getByTestId("abastecimento-voltar")).toBeInTheDocument();
  });
});

describe("D-PROD-359 — tanque da fazenda (b)", () => {
  it("(b) um Produto e um local já vêm escolhidos, \"Disponível neste local\" com a unidade do cadastro; Salvar confirma direto e o corpo vai certo", async () => {
    renderizar();
    await abrirFrente();
    await abrirAbastecimento();
    // Um só Produto e um só local: já escolhidos (o Produto aparece pelo nome real do estoque).
    expect(await screen.findByTestId("abastecimento-frente-produto")).toHaveTextContent("Óleo diesel S10");
    expect(screen.getByTestId("abastecimento-frente-disponivel")).toHaveTextContent("Disponível neste local: 8.420 L · Tanque diesel sede");
    // Um tanque só: a pergunta do tanque não aparece.
    expect(screen.queryByTestId("abastecimento-frente-tanque")).toBeNull();
    // Contador: o rótulo vem do medidor da máquina, e a última leitura vem do cadastro (1.100,0).
    expect(screen.getByTestId("abastecimento-frente-ultima-leitura")).toHaveTextContent("Último horímetro desta máquina: 1.100,0");
    expect(screen.getByTestId("abastecimento-frente-unidade")).toHaveTextContent("L");
    expect(screen.getByTestId("abastecimento-frente-responsavel")).toHaveValue("João Pereira");
    expect(screen.getByTestId("abastecimento-frente-responsavel")).toHaveAttribute("readonly");

    preencherEstoque();
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    await waitFor(() => expect(servidor.confirmacoes).toHaveLength(1));

    // A prévia e a confirmação levam o MESMO corpo, com o registro de hoje da frente (ap-1h, o de Glifosato).
    const corpo = servidor.confirmacoes[0];
    expect(servidor.previas).toHaveLength(1);
    expect(servidor.previas[0]).toEqual(corpo);
    expect(corpo).toMatchObject({
      apontamento_id: "ap-1h",
      bem_id: "bem-7",
      tanque_id: "tq1",
      produto_id: "p1",
      local_estoque_id: "l1",
      quantidade: "80",
      medidor_leitura: "1131.5",
    });
    // Estoque: sem campos de posto externo (a origem padrão do servidor é ESTOQUE).
    expect(corpo.origem ?? "ESTOQUE").toBe("ESTOQUE");
    expect(corpo).not.toHaveProperty("custo_total");
    // Sem bloqueio, não há revisão: a janela volta ao serviço (e o "Lançado hoje" é relido).
    expect(screen.queryByTestId("abastecimento-frente-revisao")).toBeNull();
    await screen.findByTestId("abertura-iniciado");
  });
});

describe("D-PROD-359 — o registro do dia (c)", () => {
  it("(c) sem registro de hoje na frente, cria o registro do dia (vazio, com a abertura na observação) UMA vez, mesmo que a 1ª tentativa falhe", async () => {
    // A frente só tem um registro de OUTRO dia: o abastecimento de hoje precisa de um registro novo.
    store["at-1"] = [ap("ap-1", "2026-11-02", TRATOR_12)];
    servidor.previaFalhas = 1;
    renderizar();
    await abrirFrente();
    await abrirAbastecimento();
    await screen.findByTestId("abastecimento-frente-produto");
    preencherEstoque();
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalled());
    expect(servidor.confirmacoes).toHaveLength(0);

    // Tenta de novo: o registro criado na 1ª tentativa é reaproveitado (nenhum segundo registro é criado).
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    await waitFor(() => expect(servidor.confirmacoes).toHaveLength(1));
    expect(servico.criarApontamento).toHaveBeenCalledTimes(1);
    const [atividadeId, dados] = servico.criarApontamento.mock.calls[0];
    expect(atividadeId).toBe("at-1");
    expect(dados).toMatchObject({ data_operacional: "2026-11-26" });
    // A observação é a abertura DESTA frente (a linha que a frente reconhece).
    expect(lerAbertura(dados.observacao)).toMatchObject({ bemId: "bem-7", implementoId: "imp-2" });
    expect(dados).not.toHaveProperty("produtos");
    expect(servidor.confirmacoes[0].apontamento_id).toBe("ap-dia-1");
  });
});

describe("D-PROD-359 — posto externo (d)", () => {
  it("(d) no posto externo não há local, o valor da nota é obrigatório e o corpo vai com origem EXTERNO e custo_total", async () => {
    renderizar();
    await abrirFrente();
    await abrirAbastecimento();
    await screen.findByTestId("abastecimento-frente-produto");
    fireEvent.click(screen.getByRole("button", { name: "Posto externo" }));
    expect(screen.getByRole("button", { name: "Posto externo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("abastecimento-frente-local")).toBeNull();
    expect(screen.queryByTestId("abastecimento-frente-disponivel")).toBeNull();
    expect(screen.getByTestId("abastecimento-frente-valor")).toBeInTheDocument();

    // Sem o valor da nota (nem a quantidade), nada é enviado e a tela diz o que falta.
    preencherEstoque({ quantidade: "120" });
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    await screen.findByText("Informe o valor total da nota do posto.");
    expect(servidor.previas).toHaveLength(0);
    expect(servico.criarApontamento).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("abastecimento-frente-valor"), { target: { value: "756,00" } });
    fireEvent.change(screen.getByTestId("abastecimento-frente-nota"), { target: { value: "48213" } });
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    await waitFor(() => expect(servidor.confirmacoes).toHaveLength(1));
    const corpo = servidor.confirmacoes[0];
    expect(corpo).toMatchObject({ origem: "EXTERNO", produto_id: "p1", quantidade: "120", apontamento_id: "ap-1h", referencia_externa: "48213" });
    expect(Number(corpo.custo_total)).toBe(756);
    expect(corpo).not.toHaveProperty("local_estoque_id");
  });
});

describe("D-PROD-359 — revisão com bloqueio na mesma tela (e)", () => {
  it("(e) a prévia com saldo insuficiente mostra a revisão NA MESMA tela, sem o botão de confirmar e sem confirmar", async () => {
    servidor.previaBloqueios = [{ code: "ESTOQUE_SALDO_INSUFICIENTE", field: "quantidade", reason: "saldo_lote_insuficiente", disponivel: "50.0000", solicitado: "80.0000", unidade: "L" }];
    renderizar();
    await abrirFrente();
    await abrirAbastecimento();
    await screen.findByTestId("abastecimento-frente-produto");
    preencherEstoque();
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    const revisao = await screen.findByTestId("abastecimento-frente-revisao");
    expect(revisao).toHaveTextContent("Confira antes de confirmar");
    expect(screen.queryByTestId("abastecimento-confirmar")).toBeNull();
    expect(screen.getByTestId("abastecimento-corrigir")).toHaveTextContent("Corrigir os dados");
    expect(servidor.confirmacoes).toHaveLength(0);
    // Sem popup: a janela do Diário é a única caixa de diálogo aberta.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    // Corrigir volta ao formulário, com o que foi digitado.
    fireEvent.click(screen.getByTestId("abastecimento-corrigir"));
    expect(screen.queryByTestId("abastecimento-frente-revisao")).toBeNull();
    expect(screen.getByTestId("abastecimento-frente-quantidade")).toHaveValue("80");
  });
});

describe("D-PROD-359 — \"Lançado hoje\" com o abastecimento (f)", () => {
  it("(f) o abastecimento gravado aparece em \"Lançado hoje\" com \"80 L\"; o cancelado não aparece", async () => {
    servidor.abastecimentos = [{ id: "ab-cancelado", numero: 0, status: "CANCELADO", bem: { id: "bem-7" }, produto: { nome: "Óleo diesel S10" }, local_estoque: null, origem: "ESTOQUE", quantidade: "15", unidade: "L", created_date: "2026-11-26T09:00:00.000Z" }];
    renderizar();
    await abrirFrente();
    // Antes de abastecer, a lista não traz o cancelado.
    expect(await screen.findByText("Nada lançado ainda")).toBeInTheDocument();
    await abrirAbastecimento();
    await screen.findByTestId("abastecimento-frente-produto");
    preencherEstoque();
    fireEvent.click(screen.getByTestId("abastecimento-salvar"));
    await waitFor(() => expect(servidor.confirmacoes).toHaveLength(1));
    await screen.findByTestId("abertura-iniciado");
    const lista = await screen.findByRole("list", { name: "Lançado hoje" });
    const linha = await within(lista).findByText("Abastecimento");
    const item = linha.closest("li");
    expect(item).toHaveTextContent("Óleo diesel S10 · Tanque diesel sede");
    expect(item).toHaveTextContent("80 L");
    // A hora é a do registro, no fuso da fazenda (10:20 UTC = 07:20 em São Paulo).
    expect(item).toHaveTextContent("07:20");
    expect(within(lista).getAllByTestId("servico-lancado-item")).toHaveLength(1);
    expect(lista).not.toHaveTextContent("15 L");
  });
});

describe("D-PROD-359 — permissão e frente encerrada (g, h)", () => {
  it("(g) sem a permissão de criar abastecimento, a opção Abastecimento não aparece", async () => {
    permissaoAbastecimento.criar = false;
    renderizar();
    await abrirFrente();
    expect(screen.queryByTestId("servico-opcao-abastecimento")).toBeNull();
    expect(screen.getByTestId("servico-opcao-maquina")).toBeInTheDocument();
  });

  it("(h) a frente encerrada não abre: o cartão fica desabilitado (sem serviço, sem abastecimento)", async () => {
    store["at-1"] = [...store["at-1"], ap("ap-enc", "2026-11-26", marcadorDoEncerramento({ bemId: "bem-7", implementoId: "imp-2", horimetro: "1100.0", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L" }))];
    renderizar();
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
    await screen.findByTestId("atividade-passo");
    const frente = await screen.findByTestId("frente-at-1-bem-7%7Cimp-2");
    expect(frente).toBeDisabled();
    expect(frente).toHaveTextContent("● Encerrado");
  });
});
