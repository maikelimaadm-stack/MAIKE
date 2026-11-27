/**
 * D-PROD-365 — a opção "Máquina" do serviço (só as HORAS DO DIA) na mesma janela do Diário das atividades. O fluxo de
 * gravação é o que já existe (`adicionarLinha` com o apontamento de hoje; `criarApontamento` com `maquinas[]` quando não há);
 * o serviço é mock fino, e o "servidor" guarda o que foi enviado, para o "Lançado hoje" e o "Hoje" do cartão serem relidos.
 *  (a) a tela: cabeçalho "Máquina" + "Lançar as horas do Trator 12"; o inicial é SÓ LEITURA com a base; o final é obrigatório;
 *      as horas trabalhadas são calculadas; o Responsável é só leitura;
 *  (b) sem apontamento de hoje: `criarApontamento` com `maquinas[0]` (bem, implemento, leituras) e a abertura na observação;
 *  (c) com apontamento de hoje: `adicionarLinha(LINHA_MAQUINA)` com a versão dele e SEM `criarApontamento`; o inicial da
 *      2ª linha do dia parte da última leitura da frente (não da vigente de antes);
 *  (d) final menor que a inicial: erro de campo, nada enviado;
 *  (e) salto: a recusa do servidor pede a justificativa e o envio repete com ela;
 *  (f) "Lançado hoje" com "3.127,0 → 3.131,5" e "4,5 h", e o "Hoje" do cartão da frente com "4,5 h";
 *  (g) sem a permissão de lançar apontamento a opção não aparece;
 *  (h) máquina sem medidor: o campo "Horas trabalhadas" (uso) e nenhuma leitura.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { lerAbertura, marcadorDaAbertura } from "@/lib/aberturaServicoRegras";
import { LINHA_MAQUINA } from "@/lib/atividadeLinhasRegras";

/** A permissão de lançar apontamento e de editar a atividade (o cenário das outras telas do Diário). */
const permissoes = vi.hoisted(() => ({ editar: true, lancar: true }));

vi.mock("@/hooks/useLancamentoAtividadesSessao", async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ hoje: "2026-11-26", fuso: "America/Sao_Paulo", semFuso: false, fusoOk: true }),
  useAcoesTelaAtividades: () => ({ lancarApontamento: permissoes.lancar, editar: permissoes.editar, login: "operador", permissaoEfetiva: { is_admin: false } }),
}));
vi.mock("@/hooks/usePatrimonioSessao", () => ({
  // Sem permissão de abastecimento: o Diário não consulta abastecimentos nesta tela.
  useAcoesTelaAbastecimento: () => ({ ver: false, criar: false, cancelar: false, login: "operador" }),
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
vi.mock("@/services/abastecimentoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarAbastecimentosPagina: vi.fn(async () => ({ items: [], has_more: false, next_cursor: null })),
}));
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
import { notifyWarning } from "@/lib/maikeNotify";

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500" };
const OPERACAO_APLICACAO = { id: "op-1", nome_tipo: "Aplicação de defensivo", categoria: "APLICACAO", ativo: true };
const TIPOS = [OPERACAO_APLICACAO, { id: "op-g", nome_tipo: "Gradagem", categoria: "PREPARO_SOLO", ativo: true }];
const BENS = { itens: [{ id: "bem-7", nome: "Trator 12" }], has_more: false, next_cursor: null };
const IMPLEMENTOS = { itens: [{ id: "imp-2", nome: "Pulverizador 2.000 L" }], has_more: false, next_cursor: null };
const OPERADORES = { itens: [{ id: "usr-3", nome: "João Pereira" }], has_more: false, next_cursor: null };
const ATIVIDADE = {
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

/** A abertura do Trator 12 + Pulverizador (o horímetro inicial do serviço é 3127,0; o responsável, João Pereira). */
const ABERTURA = { bemId: "bem-7", bemNome: "Trator 12", implementoId: "imp-2", implementoNome: "Pulverizador 2.000 L", horimetro: "3127.0", responsavelId: "usr-3", responsavelNome: "João Pereira" };
const MARCA_ABERTURA = marcadorDaAbertura(ABERTURA);
const ap = (id, dia, observacao, extra = {}) => ({ id, data_operacional: dia, status: "CONFIRMADO", versao: 2, createdAt: `${dia}T09:00:00.000Z`, observacao, produtos: [], maquinas: [], mao_obra: [], servicos: [], ...extra });

/** Uma linha de máquina gravada (o que o servidor devolve): as leituras e o uso calculado (final − inicial). */
const linhaGravada = (id, { bemId = "bem-7", inicial, final, uso = null, sem = false }) => ({
  id,
  status: "CONFIRMADO",
  bem_id: bemId,
  bem: { id: bemId, nome: "Trator 12" },
  implemento: { id: "imp-2", nome: "Pulverizador 2.000 L" },
  sem_medidor: sem,
  leitura_inicial: inicial,
  leitura_final: final,
  quantidade_uso: sem ? uso : (Number(final) - Number(inicial)).toFixed(4),
  medidor_unidade: "h",
  createdAt: "2026-11-26T12:30:00.000Z",
});

/** O "servidor" de atividades: a lista de apontamentos por atividade. Os envios de máquina entram nela (o "Lançado hoje" lê daqui). */
let store;
const comecoDoServidor = () => ({
  "at-1": [ap("ap-1", "2026-11-20", MARCA_ABERTURA)],
});
/** @param {any} dados */
const apontamentoDoDia = (id, dados) => ({
  ...ap(id, dados.data_operacional, dados.observacao ?? null),
  maquinas: (dados.maquinas ?? []).map((m, i) => linhaGravada(`${id}-m${i}`, { inicial: m.leitura_inicial, final: m.leitura_final, uso: m.quantidade_uso, sem: m.sem_medidor })),
});

/** @param {{ atividadesAbertas?: any[] }} [props] */
const renderizar = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  const onGravou = vi.fn();
  const lerAtividade = vi.fn(async (id) => ({ ...DETALHE[/** @type {"at-1"} */ (id)] }));
  render(
    <QueryClientProvider client={queryClient}>
      <DiarioDasAtividades area={AREA} tipos={TIPOS} atividadesAbertas={props.atividadesAbertas ?? [ATIVIDADE]} lerAtividade={lerAtividade} onFechar={onFechar} onGravou={onGravou} />
    </QueryClientProvider>,
  );
  return { onFechar, onGravou };
};

/** Do passo "Em andamento", toca a atividade e a frente Trator 12 (o serviço da frente). */
const abrirFrente = async () => {
  fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-1"));
  await screen.findByTestId("atividade-passo");
  fireEvent.click(await screen.findByTestId(`frente-at-1-${encodeURIComponent("bem-7|imp-2")}`));
  return screen.findByTestId("abertura-iniciado");
};
/** No serviço da frente, toca "Máquina" e espera o formulário (o medidor e a base chegam antes do formulário). */
const abrirMaquina = async () => {
  fireEvent.click(await screen.findByTestId("servico-opcao-maquina"));
  return screen.findByTestId("maquina-form");
};

beforeEach(() => {
  permissoes.editar = true;
  permissoes.lancar = true;
  store = comecoDoServidor();
  servico.listarOpcoesBens.mockResolvedValue(BENS);
  servico.listarOpcoesImplementos.mockResolvedValue(IMPLEMENTOS);
  servico.listarOpcoesOperadores.mockResolvedValue(OPERADORES);
  servico.obterMedidorDoBem.mockResolvedValue({
    medidor_tipo: "HORIMETRO",
    medidor_unidade: "h",
    leitura_vigente: { leitura: "3127.0", data: "2026-11-20", origem: "ATIVIDADE", numero: null },
    salto_maximo: "200.0000",
  });
  servico.obterAtividade.mockImplementation(async (id) => ({ ...DETALHE[/** @type {"at-1"} */ (id)] }));
  servico.listarApontamentos.mockImplementation(async (id) => ({ items: [...(store[id] ?? [])] }));
  servico.criarApontamento.mockImplementation(async (atividadeId, dados) => {
    const id = `ap-dia-${servico.criarApontamento.mock.calls.length}`;
    store[atividadeId] = [...(store[atividadeId] ?? []), apontamentoDoDia(id, dados)];
    return { apontamento: { id, versao: 1 }, atividade: null, alertas: [] };
  });
  servico.adicionarLinha.mockImplementation(async (tipo, atividadeId, apontamento, corpo) => {
    const lista = store[atividadeId] ?? [];
    const alvo = lista.find((a) => a.id === apontamento.id);
    const linha = linhaGravada(`${apontamento.id}-m${alvo?.maquinas.length ?? 0}`, { inicial: corpo.leitura_inicial, final: corpo.leitura_final, uso: corpo.quantidade_uso, sem: corpo.sem_medidor });
    if (alvo) alvo.maquinas = [...alvo.maquinas, linha];
    return { apontamento: { id: apontamento.id, versao: (apontamento.versao ?? 0) + 1 }, atividade: null, alertas: [] };
  });
  servico.concluirAtividade.mockResolvedValue({ id: "at-1", status: "CONCLUIDA" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("D-PROD-365 — a tela Máquina (a)", () => {
  it("(a) cabeçalho \"Máquina\", inicial só leitura com a base, final obrigatório, horas calculadas e responsável só leitura", async () => {
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Máquina");
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Aplicação de defensivo · Trator 12");
    expect(screen.getByTestId("maquina-cabecalho")).toHaveTextContent("Lançar as horas do Trator 12");

    const inicial = screen.getByTestId("maquina-horimetro-inicial");
    expect(inicial).toHaveValue("3.127,0");
    expect(inicial).toHaveAttribute("readonly");
    expect(screen.getByTestId("maquina-ultima-leitura")).toHaveTextContent("Último horímetro lido: 3.127,0 (abertura do serviço)");

    // O final é obrigatório: sem ele, nada é enviado e o campo é destacado.
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalled());
    expect(screen.getByTestId("maquina-horimetro-final")).toBeInTheDocument();
    expect(servico.criarApontamento).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("maquina-horimetro-final"), { target: { value: "3.131,5" } });
    expect(screen.getByTestId("maquina-horas")).toHaveTextContent("Horas trabalhadas: 4,5 h (3.131,5 - 3.127,0)");

    const responsavel = screen.getByTestId("maquina-responsavel");
    expect(responsavel).toHaveValue("João Pereira");
    expect(responsavel).toHaveAttribute("readonly");
    expect(screen.getByTestId("maquina-salvar")).toHaveTextContent("Salvar horas");
    // Só as horas do dia: sem abas, sem parada, sem trocar implemento.
    expect(screen.queryByText("Parada")).toBeNull();
    expect(screen.queryByText("Horas do dia")).toBeNull();
  });
});

describe("D-PROD-365 — o envio (b, c)", () => {
  it("(b) sem apontamento de hoje: `criarApontamento` com `maquinas[0]` (bem, implemento, leituras) e a abertura na observação", async () => {
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    fireEvent.change(screen.getByTestId("maquina-horimetro-final"), { target: { value: "3.131,5" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    await screen.findByTestId("abertura-iniciado");

    expect(servico.criarApontamento).toHaveBeenCalledTimes(1);
    const [atividadeId, dados] = servico.criarApontamento.mock.calls[0];
    expect(atividadeId).toBe("at-1");
    expect(dados).toMatchObject({ data_operacional: "2026-11-26" });
    expect(dados).not.toHaveProperty("produtos");
    expect(dados.maquinas).toHaveLength(1);
    expect(dados.maquinas[0]).toMatchObject({ bem_id: "bem-7", implemento_bem_id: "imp-2", sem_medidor: false, quantidade_uso: null });
    expect(Number(dados.maquinas[0].leitura_inicial)).toBe(3127);
    expect(Number(dados.maquinas[0].leitura_final)).toBe(3131.5);
    // A observação é a abertura DESTA frente (a linha que a frente reconhece).
    expect(lerAbertura(dados.observacao)).toMatchObject({ bemId: "bem-7", implementoId: "imp-2" });
    expect(servico.adicionarLinha).not.toHaveBeenCalled();
  });

  it("(c) com apontamento de hoje: `adicionarLinha` com a versão dele e sem `criarApontamento`; a 2ª linha do dia parte da última leitura da frente", async () => {
    store["at-1"] = [...store["at-1"], ap("ap-1h", "2026-11-26", MARCA_ABERTURA, { versao: 3, maquinas: [linhaGravada("ap-1h-m0", { inicial: "3127.0", final: "3131.5" })] })];
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    // A base de hoje é a leitura final da linha que já está gravada (3.131,5), não a da abertura.
    expect(screen.getByTestId("maquina-horimetro-inicial")).toHaveValue("3.131,5");
    expect(screen.getByTestId("maquina-ultima-leitura")).toHaveTextContent("Último horímetro lido: 3.131,5 (último lançamento)");
    fireEvent.change(screen.getByTestId("maquina-horimetro-final"), { target: { value: "3.135,0" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    await screen.findByTestId("abertura-iniciado");

    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(servico.adicionarLinha).toHaveBeenCalledTimes(1);
    const [tipo, atividadeId, apontamento, corpo, opcoes] = servico.adicionarLinha.mock.calls[0];
    expect(tipo).toBe(LINHA_MAQUINA);
    expect(atividadeId).toBe("at-1");
    expect(apontamento).toEqual({ id: "ap-1h", versao: 3 });
    expect(corpo).toMatchObject({ bem_id: "bem-7", implemento_bem_id: "imp-2", sem_medidor: false });
    expect(Number(corpo.leitura_inicial)).toBe(3131.5);
    expect(Number(corpo.leitura_final)).toBe(3135);
    expect(opcoes).toMatchObject({ retentativa: false });
  });
});

describe("D-PROD-365 — validação e salto (d, e)", () => {
  it("(d) final menor que a inicial: erro de campo, nada enviado", async () => {
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    fireEvent.change(screen.getByTestId("maquina-horimetro-final"), { target: { value: "3.100,0" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    expect(await screen.findByText("A leitura final é menor que a inicial: o medidor não anda para trás.")).toBeInTheDocument();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    expect(servico.adicionarLinha).not.toHaveBeenCalled();
  });

  it("(e) a recusa do servidor por salto pede a justificativa, na própria janela, e o envio repete com ela", async () => {
    const erroSalto = Object.assign(new Error("x"), {
      code: "API_OPERATION_FAILED",
      cause: {
        code: "ATIVIDADE_SALTO_MEDIDOR",
        field: "justificativa_salto",
        reason: "salto_acima_do_teto",
        details: { entidade: "linha_maquina", quantidade_uso: "4.5000", salto_maximo: "2.0000", medidor_unidade: "h" },
      },
    });
    servico.criarApontamento.mockImplementationOnce(async () => {
      throw erroSalto;
    });
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    fireEvent.change(screen.getByTestId("maquina-horimetro-final"), { target: { value: "3.131,5" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));

    // A justificativa aparece, com a frase da recusa; nenhum popup.
    expect(await screen.findByTestId("maquina-justificativa")).toBeInTheDocument();
    expect(screen.getByText(/O uso da máquina \(4,5 h\) passa do teto de salto do medidor \(2 h\)\. Informe a justificativa/)).toBeInTheDocument();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(servico.criarApontamento).toHaveBeenCalledTimes(1);
    expect(servico.criarApontamento.mock.calls[0][1].maquinas[0].justificativa_salto).toBeNull();

    fireEvent.change(screen.getByTestId("maquina-justificativa"), { target: { value: "Pasto alagado, a máquina atolou" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    await screen.findByTestId("abertura-iniciado");
    expect(servico.criarApontamento).toHaveBeenCalledTimes(2);
    expect(servico.criarApontamento.mock.calls[1][1].maquinas[0].justificativa_salto).toBe("Pasto alagado, a máquina atolou");
  });
});

describe("D-PROD-365 — \"Lançado hoje\" e o \"Hoje\" do cartão (f)", () => {
  it("(f) \"Lançado hoje\" mostra \"3.127,0 → 3.131,5\" e \"4,5 h\"; o cartão da frente mostra \"Hoje 4,5 h\"", async () => {
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    fireEvent.change(screen.getByTestId("maquina-horimetro-final"), { target: { value: "3.131,5" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    await screen.findByTestId("abertura-iniciado");

    const lista = await screen.findByRole("list", { name: "Lançado hoje" });
    const item = (await within(lista).findByText("Máquina")).closest("li");
    expect(item).toHaveTextContent("3.127,0 → 3.131,5");
    expect(item).toHaveTextContent("4,5 h");
    expect(item).not.toHaveTextContent("Trator 12");

    // Volta à atividade: a frente mostra o "Hoje" com as horas da linha nova.
    fireEvent.click(screen.getByTestId("servico-voltar-atividade"));
    const cartao = await screen.findByTestId(`frente-at-1-${encodeURIComponent("bem-7|imp-2")}`);
    expect(cartao).toHaveTextContent("Hoje");
    expect(cartao).toHaveTextContent("4,5 h");
  });
});

describe("D-PROD-365 — permissão e máquina sem medidor (g, h)", () => {
  it("(g) sem a permissão de lançar apontamento, a opção Máquina não aparece", async () => {
    permissoes.lancar = false;
    renderizar();
    await abrirFrente();
    expect(screen.queryByTestId("servico-opcao-maquina")).toBeNull();
  });

  it("(h) máquina sem medidor: campo \"Horas trabalhadas\" (uso > 0), sem leituras, com `sem_medidor`", async () => {
    servico.obterMedidorDoBem.mockResolvedValue({ medidor_tipo: null, medidor_unidade: null, leitura_vigente: null });
    renderizar();
    await abrirFrente();
    await abrirMaquina();
    expect(screen.queryByTestId("maquina-horimetro-inicial")).toBeNull();
    expect(screen.queryByTestId("maquina-horimetro-final")).toBeNull();
    expect(screen.getByTestId("maquina-sem-medidor")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("maquina-horas-uso"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("maquina-salvar"));
    await screen.findByTestId("abertura-iniciado");
    const [, dados] = servico.criarApontamento.mock.calls[0];
    expect(dados.maquinas[0]).toMatchObject({ bem_id: "bem-7", sem_medidor: true, leitura_inicial: null, leitura_final: null });
    expect(Number(dados.maquinas[0].quantidade_uso)).toBe(5);
  });
});
