/**
 * D-PROD-332 — o "Diário das atividades" (só a abertura) com o service mockado:
 *  (a) 7 cartões; "Continuar" só com um tipo escolhido;
 *  (b) Aplicação → campos na ordem Máquina, Implemento, Horímetro inicial, Responsável; sem "Hora de início";
 *  (c) escolher a máquina preenche o horímetro com a leitura dela (editável);
 *  (d) confirmar vazio mostra os erros e não envia;
 *  (e) confirmar envia `registrarCampo` uma vez, com a abertura na observação, e mostra o cabeçalho "Aberto";
 *  (f) aberto com uma atividade existente COM abertura, começa no cabeçalho (lido dos apontamentos);
 *  (f2)/(f3) D-PROD-335: a atividade existente SEM abertura (o fluxo antigo) vai ao formulário de abertura, com o tipo e a
 *      operação dela já definidos; "Iniciar serviço" leva o `tipo_atividade_id` da atividade existente;
 *  (1) enquanto a abertura carrega, só "Carregando…" (sem cabeçalho nem menu); (3) falha na leitura: cabeçalho como antes;
 *  (g) com duas operações do tipo, a Operação vem primeiro e é obrigatória;
 *  (h) D-PROD-332 emenda (tela 05): 7 opções com títulos; "Nada lançado ainda"; "Lançado hoje" com as linhas de hoje
 *      na ordem do horário e sem R$; tocar uma opção ou "Encerrar serviço" mostra o painel "Em breve" e "Voltar" volta.
 *  (i) D-PROD-332 emenda: Plantio de pastagem mostra "Capim" depois do Responsável (só nele); sem capim, erro e não envia;
 *      com o capim, `plantio: { cultura_id }` + `bem_id`;
 *  (j) a máquina vai em `bem_id` e NÃO em `maquinas` (e: `bem_id` é o da máquina escolhida);
 *  (k) as opções de máquina vêm de TODAS as páginas (a 2ª página entra na lista);
 *  (l) fallback: o servidor recusa `bem_id` (campo desconhecido) → UMA nova tentativa sem `bem_id`, e a tela chega ao cabeçalho.
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
vi.mock("@/services/culturaCadastroService", () => ({
  listarCulturas: vi.fn(),
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
  listarOpcoesProdutos: vi.fn(),
  listarLocaisDoProduto: vi.fn(),
  adicionarLinha: vi.fn(),
  criarApontamento: vi.fn(),
}));

import DiarioDasAtividades from "@/components/lancamento-atividades/DiarioDasAtividades";
import { lerAbertura, marcadorDaAbertura } from "@/lib/aberturaServicoRegras";
import * as servico from "@/services/lancamentoAtividadesService";
import * as culturas from "@/services/culturaCadastroService";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500" };
const OPERACAO_APLICACAO = { id: "op-1", nome_tipo: "Aplicação de defensivo", categoria: "APLICACAO", ativo: true };
const OPERACAO_APLICACAO_2 = { id: "op-2", nome_tipo: "Aplicação de adubo foliar", categoria: "APLICACAO", ativo: true };
const OPERACAO_PLANTIO = { id: "op-p", nome_tipo: "Plantio de pastagem", categoria: "PLANTIO", ativo: true };
const CAPINS = [
  { id: "cul-1", nome: "Brachiaria Marandu", tipo: "PASTAGEM", ativo: true, codigo: "1" },
  { id: "cul-9", nome: "Capim Mombaça", tipo: "PASTAGEM", ativo: true, codigo: "2" },
  { id: "cul-5", nome: "Soja", tipo: "GRAO", ativo: true, codigo: "3" },
];
const BENS = { itens: [{ id: "bem-7", nome: "Trator 12" }, { id: "bem-8", nome: "Trator 08" }], has_more: false, next_cursor: null };
const IMPLEMENTOS = { itens: [{ id: "imp-2", nome: "Pulverizador 2.000 L" }], has_more: false, next_cursor: null };
const OPERADORES = { itens: [{ id: "usr-3", nome: "João Pereira" }], has_more: false, next_cursor: null };
const MEDIDOR_TRATOR_12 = { medidor_tipo: "HORIMETRO", medidor_unidade: "h", leitura_vigente: { leitura: "1245.0", data: "2026-11-20", origem: "ATIVIDADE" } };
/** Um apontamento CONFIRMADO de hoje com a abertura na observação (a atividade já tem o serviço aberto). */
const APONTAMENTO_COM_ABERTURA = {
  id: "ap-1",
  data_operacional: "2026-11-26",
  status: "CONFIRMADO",
  observacao: marcadorDaAbertura({ bemId: "bem-7", implementoId: "imp-2", horimetro: "1245.0", responsavelId: "usr-3", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L", responsavelNome: "João Pereira" }),
};

/** Escolhe uma opção de um campo de escolha Base1 (o botão combobox abre a lista; a opção é clicada). */
const escolher = async (combobox, rotulo) => {
  await act(async () => fireEvent.click(combobox));
  const opcao = await screen.findByRole("option", { name: rotulo });
  await act(async () => fireEvent.click(opcao));
};

/** @param {{ tipos?: any[], atividade?: any }} [props] */
const renderizar = (props = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  const onGravou = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <DiarioDasAtividades area={AREA} tipos={props.tipos ?? [OPERACAO_APLICACAO]} atividade={props.atividade ?? null} onFechar={onFechar} onGravou={onGravou} />
    </QueryClientProvider>,
  );
  return { onFechar, onGravou };
};

/** Escolhe o tipo (Aplicação, por padrão) e vai ao passo da abertura. */
const irAbertura = async (tipo = "APLICACAO") => {
  fireEvent.click(screen.getByTestId(`abertura-tipo-${tipo}`));
  fireEvent.click(screen.getByTestId("abertura-continuar"));
  await screen.findByTestId("abertura-form");
};

beforeEach(() => {
  servico.listarOpcoesBens.mockResolvedValue(BENS);
  servico.listarOpcoesImplementos.mockResolvedValue(IMPLEMENTOS);
  servico.listarOpcoesOperadores.mockResolvedValue(OPERADORES);
  servico.obterMedidorDoBem.mockResolvedValue(MEDIDOR_TRATOR_12);
  servico.registrarCampo.mockResolvedValue({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" }, apontamento: { id: "ap-1" } });
  servico.obterAtividade.mockResolvedValue({ id: "atv-9", tipo_atividade_id: "op-1" });
  servico.listarApontamentos.mockResolvedValue({ items: [APONTAMENTO_COM_ABERTURA] });
  culturas.listarCulturas.mockResolvedValue(CAPINS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Diário das atividades — abertura", () => {
  it("(a) mostra os 7 tipos fixos e só deixa Continuar com um escolhido", async () => {
    renderizar();
    const cartoes = within(screen.getByTestId("diario-atividades-tipos")).getAllByRole("button");
    expect(cartoes).toHaveLength(7);
    expect(screen.getByTestId("abertura-tipo-PREPARO_SOLO")).toHaveTextContent("Gradeação, calagem");
    expect(screen.getByTestId("abertura-continuar")).toBeDisabled();
    fireEvent.click(screen.getByTestId("abertura-tipo-APLICACAO"));
    expect(screen.getByTestId("abertura-tipo-APLICACAO")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("abertura-continuar")).toBeEnabled();
  });

  it("(b) Aplicação: campos na ordem Máquina, Implemento, Horímetro inicial, Responsável; sem hora de início", async () => {
    renderizar();
    await irAbertura();
    expect(screen.getByText("Nova atividade de Aplicação")).toBeInTheDocument();
    expect(screen.queryByTestId("abertura-operacao")).toBeNull();
    const ordem = ["abertura-maquina", "abertura-implemento", "abertura-horimetro", "abertura-responsavel"].map((id) => screen.getByTestId(id));
    for (let i = 0; i < ordem.length - 1; i++) {
      expect(ordem[i].compareDocumentPosition(ordem[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText(/hora de in[ií]cio/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Iniciar serviço" })).toBeInTheDocument();
  });

  it("(c) escolher a máquina preenche o horímetro com a leitura dela, e a pessoa pode mexer", async () => {
    renderizar();
    await irAbertura();
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await waitFor(() => expect(screen.getByTestId("abertura-horimetro")).toHaveValue("1.245,0"));
    expect(servico.obterMedidorDoBem).toHaveBeenCalledWith("bem-7", "2026-11-26");
    expect(screen.getByText(/Última leitura: 1\.245 h/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("abertura-horimetro"), { target: { value: "1.250,5" } });
    expect(screen.getByTestId("abertura-horimetro")).toHaveValue("1.250,5");
    // Trocar de máquina volta a preencher, mesmo com o campo mexido.
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 08");
    await waitFor(() => expect(servico.obterMedidorDoBem).toHaveBeenCalledWith("bem-8", "2026-11-26"));
  });

  it("(d) confirmar vazio mostra os erros dos campos e não envia", async () => {
    renderizar();
    await irAbertura();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    expect(await screen.findByText("Escolha a máquina.")).toBeInTheDocument();
    expect(screen.getByText("Informe o horímetro inicial.")).toBeInTheDocument();
    expect(screen.getByText("Escolha o responsável.")).toBeInTheDocument();
    expect(screen.queryByText("Escolha a operação.")).toBeNull();
    expect(servico.registrarCampo).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith("Atenção", "Revise os campos destacados.");
  });

  it("(e) confirmar envia registrarCampo uma vez com a abertura na observação e mostra o cabeçalho", async () => {
    const { onGravou } = renderizar();
    await irAbertura();
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Implemento" }), "Pulverizador 2.000 L");
    fireEvent.change(screen.getByTestId("abertura-horimetro"), { target: { value: "1.250,5" } });
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));

    await screen.findByTestId("abertura-iniciado");
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
    const [dados] = servico.registrarCampo.mock.calls[0];
    expect(dados).toMatchObject({
      area_id: "area-A",
      tipo_atividade_id: "op-1",
      data_operacional: "2026-11-26",
      operador_usuario_id: "usr-3",
    });
    expect(lerAbertura(dados.observacao)).toEqual({
      bemId: "bem-7",
      implementoId: "imp-2",
      horimetro: "1250.5",
      responsavelId: "usr-3",
      bemNome: "Trator 12",
      implementoNome: "Pulverizador 2.000 L",
      responsavelNome: "João Pereira",
    });
    // D-PROD-332 (emenda): a máquina vai em `bem_id`, e NÃO é uma linha de uso (`maquinas` não é enviado).
    expect(dados.bem_id).toBe("bem-7");
    expect(dados.maquinas).toBeUndefined();
    expect(dados.plantio).toBeUndefined();
    expect(onGravou).toHaveBeenCalledTimes(1);

    const cabecalho = screen.getByTestId("abertura-iniciado");
    expect(within(cabecalho).getByText("Trator 12")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Pulverizador 2.000 L")).toBeInTheDocument();
    expect(within(cabecalho).getByText("João Pereira")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Pasto 04")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Horímetro inicial 1.250,5")).toBeInTheDocument();
    expect(within(cabecalho).getByText("● Aberto")).toBeInTheDocument();
    // A tela 05: as 7 opções, "Nada lançado ainda" (sem linhas) e o "Encerrar serviço" no rodapé; sem o "Fechar" antigo.
    expect(screen.getByTestId("servico-nada-lancado")).toHaveTextContent("Nada lançado ainda");
    expect(screen.getByTestId("servico-encerrar")).toHaveTextContent("Encerrar serviço");
    expect(screen.queryByTestId("abertura-fechar")).toBeNull();
    expect(screen.queryByTestId("abertura-em-breve")).toBeNull();
  });

  it("(f) aberto com uma atividade existente, começa no cabeçalho com a abertura lida dos apontamentos", async () => {
    servico.listarApontamentos.mockResolvedValue({
      items: [{ id: "ap-1", data_operacional: "2026-11-26", status: "CONFIRMADO", observacao: marcadorDaAbertura({ bemId: "bem-7", implementoId: "imp-2", horimetro: "1245.0", responsavelId: "usr-3", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L", responsavelNome: "João Pereira" }) }],
    });
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    const cabecalho = await screen.findByTestId("abertura-iniciado");
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Diário das atividades");
    expect(within(cabecalho).getByText("Aplicação")).toBeInTheDocument();
    // A abertura vem da consulta dos apontamentos: espera o valor chegar.
    expect(await within(cabecalho).findByText("Horímetro inicial 1.245,0")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Trator 12")).toBeInTheDocument();
    expect(screen.queryByTestId("diario-atividades-tipos")).toBeNull();
    expect(screen.getByTestId("servico-encerrar")).toBeInTheDocument();
  });

  it("(f2) D-PROD-335: serviço aberto SEM abertura gravada → formulário de abertura, com o tipo e a operação dele já definidos", async () => {
    servico.listarApontamentos.mockResolvedValue({ items: [{ id: "ap-1", data_operacional: "2026-11-26", status: "CONFIRMADO", observacao: "Só texto" }] });
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    await screen.findByTestId("abertura-form");
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Nova atividade de Aplicação");
    expect(screen.getByTestId("abertura-servico-existente")).toHaveTextContent("Este pasto já tem o serviço Aplicação de defensivo em andamento, sem abertura. Preencha para iniciar.");
    // Sem a tela de tipo, sem o cabeçalho e sem o menu do serviço; a operação é só uma, então não aparece o campo.
    expect(screen.queryByTestId("diario-atividades-tipos")).toBeNull();
    expect(screen.queryByTestId("abertura-iniciado")).toBeNull();
    expect(screen.queryByTestId("abertura-operacao")).toBeNull();
    expect(screen.queryByText("Abertura não registrada neste serviço.")).toBeNull();

    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("abertura-iniciado");
    // O servidor reaproveita a atividade aberta do mesmo tipo: o envio leva o tipo_atividade_id dela.
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
    const [dados] = servico.registrarCampo.mock.calls[0];
    expect(dados).toMatchObject({ area_id: "area-A", tipo_atividade_id: "op-1", bem_id: "bem-7", operador_usuario_id: "usr-3" });
    expect(lerAbertura(dados.observacao)).toMatchObject({ bemId: "bem-7", responsavelId: "usr-3", horimetro: "1245.0" });
  });

  it("(f3) D-PROD-335: com duas operações do tipo, a Operação já vem com a do serviço aberto (e o envio leva o id dela)", async () => {
    servico.listarApontamentos.mockResolvedValue({ items: [{ id: "ap-1", data_operacional: "2026-11-26", status: "CONFIRMADO", observacao: "Só texto" }] });
    renderizar({ tipos: [OPERACAO_APLICACAO, OPERACAO_APLICACAO_2], atividade: { id: "atv-9", tipo_atividade_id: "op-2" } });
    await screen.findByTestId("abertura-form");
    expect(screen.getByTestId("abertura-operacao")).toBeInTheDocument();
    expect(screen.getByTestId("abertura-servico-existente")).toHaveTextContent("Aplicação de adubo foliar");
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("abertura-iniciado");
    expect(servico.registrarCampo.mock.calls[0][0].tipo_atividade_id).toBe("op-2");
    expect(screen.queryByText("Escolha a operação.")).toBeNull();
  });

  it("(1) enquanto a abertura carrega, não mostra o cabeçalho nem o menu do serviço, só \"Carregando…\"", async () => {
    servico.listarApontamentos.mockReturnValue(new Promise(() => {}));
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    expect(await screen.findByTestId("abertura-carregando")).toHaveTextContent("Carregando…");
    expect(screen.queryByTestId("abertura-iniciado")).toBeNull();
    expect(screen.queryByTestId("servico-encerrar")).toBeNull();
    expect(screen.queryByTestId("abertura-form")).toBeNull();
    expect(screen.queryByTestId("diario-atividades-tipos")).toBeNull();
    expect(screen.queryByText("Abertura não registrada neste serviço.")).toBeNull();
  });

  it("(3) se a leitura da abertura falha, o cabeçalho aparece como antes (sem levar ao formulário)", async () => {
    servico.listarApontamentos.mockRejectedValue(new Error("sem rede"));
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    await screen.findByTestId("abertura-iniciado");
    expect(screen.queryByTestId("abertura-carregando")).toBeNull();
    expect(screen.queryByTestId("abertura-form")).toBeNull();
    expect(screen.queryByTestId("abertura-servico-existente")).toBeNull();
    expect(screen.getByTestId("servico-encerrar")).toBeInTheDocument();
  });

  it("(g) com duas operações do tipo, a Operação vem primeiro e é obrigatória", async () => {
    renderizar({ tipos: [OPERACAO_APLICACAO, OPERACAO_APLICACAO_2] });
    await irAbertura();
    const operacao = screen.getByTestId("abertura-operacao");
    const maquina = screen.getByTestId("abertura-maquina");
    expect(operacao.compareDocumentPosition(maquina) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    expect(await screen.findByText("Escolha a operação.")).toBeInTheDocument();
    expect(servico.registrarCampo).not.toHaveBeenCalled();
  });

  it("(h1) a tela 05 mostra as 7 opções, cada uma com o título e a linha de apoio da maquete", async () => {
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    await screen.findByTestId("abertura-iniciado");
    const esperado = [
      ["insumo", "Insumo", "Produto ou mistura no implemento, por carga"],
      ["maquina", "Máquina", "Trocar implemento, problema ou parada, corrigir horímetro"],
      ["abastecimento", "Abastecimento", "Diesel, litros e horímetro"],
      ["trocar-pasto", "Trocar pasto", "Horímetro de saída e de chegada"],
      ["mao-de-obra", "Mão de obra", "Quem ajudou e as horas"],
      ["servico-terceiro", "Serviço de terceiro", "Conserto, frete, aplicação contratada"],
      ["outros-custos", "Outros custos", "Qualquer outro gasto deste serviço"],
    ];
    for (const [chave, titulo, sub] of esperado) {
      const cartao = screen.getByTestId(`servico-opcao-${chave}`);
      expect(cartao.tagName).toBe("BUTTON");
      expect(cartao).toHaveAttribute("type", "button");
      expect(within(cartao).getByText(titulo)).toBeInTheDocument();
      expect(within(cartao).getByText(sub)).toBeInTheDocument();
    }
    expect(screen.getByText("Lançado hoje")).toBeInTheDocument();
  });

  it("(h2) Lançado hoje: as linhas de hoje na ordem do horário (fuso da fazenda), sem R$ e sem as canceladas", async () => {
    servico.listarApontamentos.mockResolvedValue({
      items: [
        {
          id: "ap-1",
          data_operacional: "2026-11-26",
          status: "CONFIRMADO",
          createdAt: "2026-11-26T10:00:00.000Z",
          observacao: marcadorDaAbertura({ bemId: "bem-7", implementoId: "imp-2", horimetro: "1245.0", responsavelId: "usr-3", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L", responsavelNome: "João Pereira" }),
          produtos: [{ id: "pl-1", status: "CONFIRMADO", produto: { nome: "Glifosato" }, quantidade: "1000.0000", unidade: "L", jato: 1, custo_total: "250.0000", createdAt: "2026-11-26T10:45:00.000Z" }],
          maquinas: [],
          mao_obra: [
            { id: "mo-1", status: "CONFIRMADO", parceiro: { nome: "Pedro Ajudante" }, tipo_medida: "HORA", quantidade: "8.0000", custo_total: "400.0000", createdAt: "2026-11-26T12:20:00.000Z" },
            { id: "mo-2", status: "CANCELADO", parceiro: { nome: "Linha cancelada" }, tipo_medida: "HORA", quantidade: "2.0000", createdAt: "2026-11-26T11:00:00.000Z" },
          ],
          servicos: [],
        },
        // Um apontamento CANCELADO não aparece, mesmo com linhas confirmadas.
        { id: "ap-2", data_operacional: "2026-11-26", status: "CANCELADO", createdAt: "2026-11-26T10:00:00.000Z", produtos: [{ id: "pl-9", status: "CONFIRMADO", produto: { nome: "Outro" }, quantidade: "5.0000", unidade: "L", createdAt: "2026-11-26T10:05:00.000Z" }], maquinas: [], mao_obra: [], servicos: [] },
        // Outro dia: não entra em "Lançado hoje".
        { id: "ap-3", data_operacional: "2026-11-25", status: "CONFIRMADO", createdAt: "2026-11-25T10:00:00.000Z", produtos: [{ id: "pl-7", status: "CONFIRMADO", produto: { nome: "Ontem" }, quantidade: "1.0000", unidade: "L", createdAt: "2026-11-25T10:05:00.000Z" }], maquinas: [], mao_obra: [], servicos: [] },
      ],
    });
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    const linhas = await screen.findAllByTestId("servico-lancado-item");
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toHaveTextContent("07:45");
    expect(linhas[0]).toHaveTextContent("Insumo · Carga 1");
    expect(linhas[0]).toHaveTextContent("Glifosato");
    expect(linhas[0]).toHaveTextContent("1.000 L");
    expect(linhas[1]).toHaveTextContent("09:20");
    expect(linhas[1]).toHaveTextContent("Mão de obra");
    expect(linhas[1]).toHaveTextContent("Pedro Ajudante");
    expect(linhas[1]).toHaveTextContent("8 h");
    expect(document.body.textContent).not.toContain("R$");
    expect(screen.queryByTestId("servico-nada-lancado")).toBeNull();
  });

  it("(h3) tocar uma opção mostra o painel \"Em breve\" na mesma janela; Voltar ao serviço volta", async () => {
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    await screen.findByTestId("abertura-iniciado");
    fireEvent.click(screen.getByTestId("servico-opcao-maquina"));
    const painel = screen.getByTestId("servico-em-breve");
    expect(within(painel).getByText("Máquina")).toBeInTheDocument();
    expect(within(painel).getByText("Em breve: esta parte ainda vai ser feita.")).toBeInTheDocument();
    // Com o painel aberto, as opções somem e o rodapé só tem "Voltar ao serviço".
    expect(screen.queryByTestId("servico-opcao-insumo")).toBeNull();
    expect(screen.queryByTestId("servico-encerrar")).toBeNull();
    expect(screen.getByTestId("servico-voltar")).toHaveTextContent("Voltar ao serviço");
    fireEvent.click(screen.getByTestId("servico-voltar"));
    expect(screen.queryByTestId("servico-em-breve")).toBeNull();
    expect(screen.getByTestId("servico-opcao-maquina")).toBeInTheDocument();
    expect(screen.getByTestId("servico-encerrar")).toBeInTheDocument();
  });

  it("(h4) Encerrar serviço mostra o painel \"Em breve\" com o título dele", async () => {
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    await screen.findByTestId("abertura-iniciado");
    fireEvent.click(screen.getByTestId("servico-encerrar"));
    const painel = screen.getByTestId("servico-em-breve");
    expect(within(painel).getByText("Encerrar serviço")).toBeInTheDocument();
    expect(within(painel).getByText("Em breve: esta parte ainda vai ser feita.")).toBeInTheDocument();
    expect(screen.getByTestId("servico-voltar")).toBeInTheDocument();
  });

  it("(i1) Plantio de pastagem mostra \"Capim\" depois do Responsável; Aplicação não mostra", async () => {
    renderizar({ tipos: [OPERACAO_PLANTIO, OPERACAO_APLICACAO] });
    await irAbertura("PLANTIO");
    const responsavel = screen.getByTestId("abertura-responsavel");
    const capim = await screen.findByTestId("abertura-capim");
    expect(responsavel.compareDocumentPosition(capim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Capim" })).toBeInTheDocument();
    cleanup();
    vi.clearAllMocks();
    culturas.listarCulturas.mockResolvedValue(CAPINS);
    renderizar({ tipos: [OPERACAO_PLANTIO, OPERACAO_APLICACAO] });
    await irAbertura("APLICACAO");
    expect(screen.queryByTestId("abertura-capim")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Capim" })).toBeNull();
  });

  it("(i2) Plantio sem capim: mostra o erro \"Escolha o capim.\" e não envia", async () => {
    renderizar({ tipos: [OPERACAO_PLANTIO] });
    await irAbertura("PLANTIO");
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    expect(await screen.findByText("Escolha o capim.")).toBeInTheDocument();
    expect(servico.registrarCampo).not.toHaveBeenCalled();
  });

  it("(i3) Plantio com o capim: envia plantio: { cultura_id } e bem_id; o capim não entra na observação", async () => {
    renderizar({ tipos: [OPERACAO_PLANTIO] });
    await irAbertura("PLANTIO");
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    await escolher(await screen.findByRole("combobox", { name: "Capim" }), "Brachiaria Marandu");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("abertura-iniciado");
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
    const [dados] = servico.registrarCampo.mock.calls[0];
    expect(dados.plantio).toEqual({ cultura_id: "cul-1" });
    expect(dados.bem_id).toBe("bem-7");
    expect(dados.maquinas).toBeUndefined();
    expect(dados.observacao).not.toContain("cul-1");
    expect(dados.observacao).not.toContain("Brachiaria");
    expect(culturas.listarCulturas).toHaveBeenCalledWith("emp-1");
  });

  it("(i4) em Aplicação o envio não leva plantio", async () => {
    renderizar();
    await irAbertura();
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("abertura-iniciado");
    const [dados] = servico.registrarCampo.mock.calls[0];
    expect(dados.plantio).toBeUndefined();
    expect(dados.bem_id).toBe("bem-7");
  });

  it("(k) as opções de máquina vêm de todas as páginas: a 2ª página entra na lista e pode ser escolhida", async () => {
    servico.listarOpcoesBens.mockImplementation(async (opts) =>
      opts?.cursor === "pagina-2"
        ? { itens: [{ id: "bem-9", nome: "Trator 09" }], has_more: false, next_cursor: null }
        : { itens: [{ id: "bem-7", nome: "Trator 12" }], has_more: true, next_cursor: "pagina-2" },
    );
    servico.obterMedidorDoBem.mockResolvedValue({ medidor_tipo: "HORIMETRO", medidor_unidade: "h", leitura_vigente: null });
    renderizar();
    await irAbertura();
    const maquina = screen.getByRole("combobox", { name: "Máquina" });
    await act(async () => fireEvent.click(maquina));
    expect(await screen.findByRole("option", { name: "Trator 09" })).toBeInTheDocument();
    expect(servico.listarOpcoesBens.mock.calls.map((c) => c[0])).toEqual([{}, { cursor: "pagina-2" }]);
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "Trator 09" })));
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.change(screen.getByTestId("abertura-horimetro"), { target: { value: "10,0" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("abertura-iniciado");
    expect(servico.registrarCampo.mock.calls[0][0].bem_id).toBe("bem-9");
  });

  it("(l) fallback: o servidor recusa bem_id (campo desconhecido) → UMA nova tentativa sem bem_id, e chega ao cabeçalho", async () => {
    servico.registrarCampo.mockRejectedValueOnce({ name: "ApiError", code: "REQUEST_VALIDATION_FAILED", details: { field: "bem_id", reason: "unknown_field" } });
    renderizar();
    await irAbertura();
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await screen.findByTestId("abertura-iniciado");
    expect(servico.registrarCampo).toHaveBeenCalledTimes(2);
    const [primeira] = servico.registrarCampo.mock.calls[0];
    const [segunda] = servico.registrarCampo.mock.calls[1];
    expect(primeira.bem_id).toBe("bem-7");
    expect(segunda).not.toHaveProperty("bem_id");
    expect(segunda.observacao).toBe(primeira.observacao);
    expect(segunda.operador_usuario_id).toBe("usr-3");
    expect(notifyWarning).not.toHaveBeenCalled();
    expect(within(screen.getByTestId("abertura-iniciado")).getByText("Trator 12")).toBeInTheDocument();
  });

  it("(l2) outro erro (não é o campo bem_id) não repete o envio: mostra o aviso como antes", async () => {
    servico.registrarCampo.mockRejectedValueOnce({ name: "ApiError", code: "ATIVIDADE_REFERENCIA_INVALIDA", details: { field: "bem_id", reason: "inexistente" } });
    renderizar();
    await irAbertura();
    await escolher(screen.getByRole("combobox", { name: "Máquina" }), "Trator 12");
    await escolher(screen.getByRole("combobox", { name: "Responsável" }), "João Pereira");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar serviço" }));
    await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith("Não foi possível iniciar o serviço", expect.any(String)));
    expect(servico.registrarCampo).toHaveBeenCalledTimes(1);
  });
});

/**
 * D-PROD-334 — a opção Insumo abre a "Carga de insumo" na MESMA janela (sem popup): título "Insumo", "Carga N" (a próxima
 * do dia), Produto | Mistura, unidade do cadastro ao lado da quantidade, gravação pelas rotas existentes e as recusas.
 */
const PRODUTOS_INSUMO = {
  itens: [
    { id: "p-gli", nome: "Glifosato", unidade_principal_estoque: "L" },
    { id: "p-ure", nome: "Ureia", unidade_principal_estoque: "KG" },
  ],
  has_more: false,
  next_cursor: null,
};
const LOCAIS_DO_PRODUTO = {
  "p-gli": { itens: [{ local_estoque_id: "l-dep", local_nome: "Depósito", disponivel: "8500.0000", unidade: "L" }], has_more: false, next_cursor: null },
  "p-ure": {
    itens: [
      { local_estoque_id: "l-a", local_nome: "Galpão", disponivel: "100.0000", unidade: "KG" },
      { local_estoque_id: "l-b", local_nome: "Depósito", disponivel: "900.0000", unidade: "KG" },
    ],
    has_more: false,
    next_cursor: null,
  },
};
const ESCOPO = "c1:operador";

/** O apontamento de hoje com a abertura (o cabeçalho do serviço) e as linhas dadas. */
const apontamentoDeHoje = (produtos = []) => ({
  id: "ap-1",
  data_operacional: "2026-11-26",
  status: "CONFIRMADO",
  versao: 3,
  createdAt: "2026-11-26T09:00:00.000Z",
  observacao: marcadorDaAbertura({ bemId: "bem-7", implementoId: "imp-2", horimetro: "1245.0", responsavelId: "usr-3", bemNome: "Trator 12", implementoNome: "Pulverizador 2.000 L", responsavelNome: "João Pereira" }),
  produtos,
  maquinas: [],
  mao_obra: [],
  servicos: [],
});

/** Abre o serviço aberto (com a lista dada) e vai à Carga de insumo pela opção Insumo. */
const abrirInsumo = async (apontamentos = [apontamentoDeHoje()]) => {
  servico.listarApontamentos.mockResolvedValue({ items: apontamentos });
  renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
  await screen.findByTestId("abertura-iniciado");
  fireEvent.click(screen.getByTestId("servico-opcao-insumo"));
  await screen.findByTestId("carga-form");
};

/**
 * Escolhe um produto no seletor paginado do bloco `i` (o botão abre a lista; a opção é clicada). A lista é um popover no
 * body (desktop), que o diálogo Radix marca como `aria-hidden`: por isso `hidden: true` na busca da opção.
 */
const escolherProduto = async (i, nome) => {
  fireEvent.click(screen.getByTestId(`carga-item-${i}-produto`));
  const opcao = await screen.findByRole("option", { name: new RegExp(`^${nome}`), hidden: true });
  fireEvent.click(opcao);
  // O saldo do produto chega depois (o local com saldo é escolhido ao chegar): espera a nota do bloco.
  await screen.findByTestId(`carga-item-${i}-disponivel`);
};

beforeEach(() => {
  servico.listarOpcoesProdutos.mockResolvedValue(PRODUTOS_INSUMO);
  servico.listarLocaisDoProduto.mockImplementation(async (produtoId) => LOCAIS_DO_PRODUTO[produtoId] ?? { itens: [], has_more: false, next_cursor: null });
});

describe("Diário das atividades — Insumo (carga, D-PROD-334)", () => {
  it("(a) a opção Insumo abre a Carga na mesma janela: título \"Insumo\", \"Carga N\" (a próxima do dia), o alternador e nenhum \"jato\"", async () => {
    // Já há uma carga de hoje (jato 1): a próxima é a 2.
    await abrirInsumo([apontamentoDeHoje([{ id: "pl-1", status: "CONFIRMADO", produto_id: "p-gli", produto: { nome: "Glifosato" }, quantidade: "1000.0000", unidade: "L", jato: 1, createdAt: "2026-11-26T09:10:00.000Z" }])]);
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Insumo");
    expect(screen.getByTestId("carga-cabecalho")).toHaveTextContent("Carga 2");
    expect(screen.getByTestId("carga-cabecalho")).toHaveTextContent("Encher o Pulverizador 2.000 L");
    expect(screen.getByTestId("carga-modo-produto")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("carga-modo-mistura")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("carga-voltar")).toHaveAttribute("aria-label", "Voltar ao serviço");
    expect(screen.getByTestId("carga-salvar")).toHaveTextContent("Salvar carga");
    expect(document.body.textContent).not.toMatch(/jato/i);
  });

  it("(b) escolher o produto mostra a unidade do cadastro ao lado da quantidade e o disponível do local", async () => {
    await abrirInsumo();
    await escolherProduto(0, "Glifosato");
    expect(await screen.findByTestId("carga-item-0-disponivel")).toHaveTextContent("Disponível neste local: 8.500 L · Depósito");
    expect(screen.getByTestId("carga-item-0-unidade")).toHaveTextContent("L");
    await escolherProduto(0, "Ureia");
    expect(await screen.findByTestId("carga-item-0-disponivel")).toHaveTextContent("Disponível neste local: 900 kg · Depósito");
    expect(screen.getByTestId("carga-item-0-unidade")).toHaveTextContent("kg");
    // Dois locais com saldo: o de maior disponível entra sozinho, e aparece o campo "Local do estoque".
    expect(screen.getByRole("combobox", { name: "Local do estoque" })).toHaveTextContent("Depósito");
  });

  it("(c) salvar com apontamento de hoje chama adicionarLinha com jato, quantidade e local; volta ao serviço com a linha em \"Lançado hoje\"", async () => {
    // A consulta dos apontamentos dispara já na montagem: o mock vem ANTES do render.
    let gravado = false;
    servico.listarApontamentos.mockImplementation(async () => ({ items: [apontamentoDeHoje(gravado ? [{ id: "pl-1", status: "CONFIRMADO", produto_id: "p-gli", produto: { nome: "Glifosato" }, quantidade: "25.0000", unidade: "L", jato: 1, createdAt: "2026-11-26T09:10:00.000Z" }] : [])] }));
    servico.adicionarLinha.mockImplementation(async () => {
      gravado = true;
      return { apontamento: { id: "ap-1", versao: 4 }, atividade: null, alertas: [] };
    });
    const { onGravou } = renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    await screen.findByTestId("abertura-iniciado");
    fireEvent.click(screen.getByTestId("servico-opcao-insumo"));
    await screen.findByTestId("carga-form");
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await waitFor(() => expect(servico.adicionarLinha).toHaveBeenCalledTimes(1));
    const [tipo, atividadeId, apontamento, corpo, opcoes] = servico.adicionarLinha.mock.calls[0];
    expect({ tipo, atividadeId, apontamento }).toEqual({ tipo: "produtos", atividadeId: "atv-9", apontamento: { id: "ap-1", versao: 3 } });
    expect(corpo).toMatchObject({ produto_id: "p-gli", local_estoque_id: "l-dep", quantidade: "25", jato: "1" });
    expect(corpo.observacao).toBeNull();
    expect(opcoes).toMatchObject({ escopo: ESCOPO, retentativa: false });
    expect(servico.criarApontamento).not.toHaveBeenCalled();
    // Volta ao serviço (sem a Carga) com a linha em "Lançado hoje".
    await screen.findByTestId("servico-opcao-insumo");
    expect(screen.queryByTestId("carga-form")).toBeNull();
    expect(await screen.findByText("Insumo · Carga 1")).toBeInTheDocument();
    expect(notifySuccess).toHaveBeenCalledWith("Sucesso", "Carga 1 lançada.");
    expect(onGravou).toHaveBeenCalled();
  });

  it("(d) sem apontamento de hoje, a primeira carga cria o apontamento com criarApontamento e produtos[]", async () => {
    servico.criarApontamento.mockResolvedValue({ apontamento: { id: "ap-novo", versao: 1 }, atividade: null, alertas: [] });
    // O serviço foi aberto ontem (a abertura está no apontamento de ontem); hoje ainda não há apontamento. D-PROD-335: sem
    // nenhum apontamento com abertura o diário iria ao formulário de abertura, não ao serviço aberto.
    await abrirInsumo([{ ...apontamentoDeHoje(), id: "ap-0", data_operacional: "2026-11-25", createdAt: "2026-11-25T09:00:00.000Z" }]);
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await waitFor(() => expect(servico.criarApontamento).toHaveBeenCalledTimes(1));
    const [atividadeId, dados, opcoes] = servico.criarApontamento.mock.calls[0];
    expect(atividadeId).toBe("atv-9");
    expect(dados).toMatchObject({ data_operacional: "2026-11-26", produtos: [expect.objectContaining({ produto_id: "p-gli", local_estoque_id: "l-dep", quantidade: "25", jato: "1" })] });
    expect(dados).not.toHaveProperty("atividade_area_id");
    expect(opcoes).toMatchObject({ escopo: ESCOPO, retentativa: false });
    expect(servico.adicionarLinha).not.toHaveBeenCalled();
  });

  it("(e) Mistura com dois produtos grava duas linhas com o MESMO jato, em sequência (a versão da 1ª vai para a 2ª)", async () => {
    servico.adicionarLinha
      .mockResolvedValueOnce({ apontamento: { id: "ap-1", versao: 5 }, atividade: null, alertas: [] })
      .mockResolvedValueOnce({ apontamento: { id: "ap-1", versao: 6 }, atividade: null, alertas: [] });
    await abrirInsumo();
    fireEvent.click(screen.getByTestId("carga-modo-mistura"));
    expect(screen.getByTestId("carga-item-1")).toBeInTheDocument();
    await escolherProduto(0, "Glifosato");
    await escolherProduto(1, "Ureia");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "25" } });
    fireEvent.change(screen.getByTestId("carga-item-1-quantidade"), { target: { value: "40" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await waitFor(() => expect(servico.adicionarLinha).toHaveBeenCalledTimes(2));
    const [primeira, segunda] = servico.adicionarLinha.mock.calls;
    expect(primeira[3]).toMatchObject({ produto_id: "p-gli", jato: "1" });
    expect(segunda[3]).toMatchObject({ produto_id: "p-ure", local_estoque_id: "l-b", quantidade: "40", jato: "1" });
    expect(segunda[2]).toEqual({ id: "ap-1", versao: 5 });
  });

  it("(f) ESTOQUE_SALDO_INSUFICIENTE mostra a mensagem e a janela NÃO volta ao serviço", async () => {
    servico.adicionarLinha.mockRejectedValueOnce({
      name: "ApiError",
      code: "ESTOQUE_SALDO_INSUFICIENTE",
      details: { disponivel: "8500.0000", solicitado: "9000.0000" },
    });
    await abrirInsumo();
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "9000" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    expect(await screen.findByText(/Saldo insuficiente deste produto no local escolhido/)).toBeInTheDocument();
    expect(screen.getByTestId("carga-form")).toBeInTheDocument();
    expect(screen.queryByTestId("servico-opcao-insumo")).toBeNull();
    expect(servico.adicionarLinha).toHaveBeenCalledTimes(1);
  });

  it("(g) horímetro inválido barra o envio", async () => {
    await abrirInsumo();
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "25" } });
    fireEvent.change(screen.getByTestId("carga-horimetro"), { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    expect(await screen.findByText("Horímetro inválido.")).toBeInTheDocument();
    expect(servico.adicionarLinha).not.toHaveBeenCalled();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
  });

  it("(h) a seta \"Voltar ao serviço\" volta sem gravar", async () => {
    await abrirInsumo();
    await escolherProduto(0, "Glifosato");
    fireEvent.click(screen.getByTestId("carga-voltar"));
    expect(screen.queryByTestId("carga-form")).toBeNull();
    expect(screen.getByTestId("servico-opcao-insumo")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Diário das atividades");
    expect(servico.adicionarLinha).not.toHaveBeenCalled();
    expect(servico.criarApontamento).not.toHaveBeenCalled();
  });
  it("(i) atividade com várias áreas: a carga NÃO entra no apontamento de hoje de OUTRO pasto; cria o deste pasto com atividade_area_id", async () => {
    const outroPasto = { ...apontamentoDeHoje(), atividade_area_id: "aa-1" };
    servico.listarApontamentos.mockResolvedValue({ items: [outroPasto] });
    servico.criarApontamento.mockResolvedValue({ apontamento: { id: "ap-9", versao: 1 }, atividade: null, alertas: [] });
    const atividade = { id: "atv-9", tipo_atividade_id: "op-1", areas: [{ id: "aa-1", ordem: 1, area_id: "area-B" }, { id: "aa-2", ordem: 2, area_id: "area-A" }] };
    renderizar({ atividade });
    await screen.findByTestId("abertura-iniciado");
    fireEvent.click(screen.getByTestId("servico-opcao-insumo"));
    await screen.findByTestId("carga-form");
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await waitFor(() => expect(servico.criarApontamento).toHaveBeenCalledTimes(1));
    expect(servico.criarApontamento.mock.calls[0][1]).toMatchObject({ data_operacional: "2026-11-26", atividade_area_id: "aa-2" });
    expect(servico.adicionarLinha).not.toHaveBeenCalled();
  });

  it("(j) depois de uma falha, mexer na quantidade manda o conteúdo NOVO (o envio guardado é esquecido)", async () => {
    servico.adicionarLinha.mockRejectedValueOnce({ name: "ApiError", code: "ESTOQUE_SALDO_INSUFICIENTE", details: { disponivel: "8500.0000", solicitado: "9000.0000" } });
    servico.adicionarLinha.mockResolvedValueOnce({ apontamento: { id: "ap-1", versao: 4 }, atividade: null, alertas: [] });
    await abrirInsumo();
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "9000" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await screen.findByText(/Saldo insuficiente deste produto no local escolhido/);
    fireEvent.change(screen.getByTestId("carga-item-0-quantidade"), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await waitFor(() => expect(servico.adicionarLinha).toHaveBeenCalledTimes(2));
    expect(servico.adicionarLinha.mock.calls[1][3]).toMatchObject({ produto_id: "p-gli", quantidade: "30" });
  });

  it("(k) enquanto a carga está sendo enviada, o voltar fica desabilitado", async () => {
    /** @type {(v: any) => void} */
    let liberar = () => {};
    servico.adicionarLinha.mockImplementation(() => new Promise((resolve) => { liberar = resolve; }));
    await abrirInsumo();
    await escolherProduto(0, "Glifosato");
    fireEvent.change(await screen.findByTestId("carga-item-0-quantidade"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("carga-salvar"));
    await waitFor(() => expect(servico.adicionarLinha).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("carga-voltar")).toBeDisabled();
    liberar({ apontamento: { id: "ap-1", versao: 4 }, atividade: null, alertas: [] });
    await screen.findByTestId("servico-opcao-insumo");
  });
});
