/**
 * D-PROD-332 — o "Diário das atividades" (só a abertura) com o service mockado:
 *  (a) 7 cartões; "Continuar" só com um tipo escolhido;
 *  (b) Aplicação → campos na ordem Máquina, Implemento, Horímetro inicial, Responsável; sem "Hora de início";
 *  (c) escolher a máquina preenche o horímetro com a leitura dela (editável);
 *  (d) confirmar vazio mostra os erros e não envia;
 *  (e) confirmar envia `registrarCampo` uma vez, com a abertura na observação, e mostra o cabeçalho "Aberto";
 *  (f) aberto com uma atividade existente, começa direto no cabeçalho (lido dos apontamentos);
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
}));

import DiarioDasAtividades from "@/components/lancamento-atividades/DiarioDasAtividades";
import { lerAbertura, marcadorDaAbertura } from "@/lib/aberturaServicoRegras";
import * as servico from "@/services/lancamentoAtividadesService";
import * as culturas from "@/services/culturaCadastroService";
import { notifyWarning } from "@/lib/maikeNotify";

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
  servico.listarApontamentos.mockResolvedValue({ items: [] });
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

  it("(f2) sem abertura gravada na atividade, o cabeçalho diz que não foi registrada", async () => {
    servico.listarApontamentos.mockResolvedValue({ items: [{ id: "ap-1", data_operacional: "2026-11-26", observacao: "Só texto" }] });
    renderizar({ atividade: { id: "atv-9", tipo_atividade_id: "op-1" } });
    expect(await screen.findByText("Abertura não registrada neste serviço.")).toBeInTheDocument();
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
      ["insumo", "Insumo", "Produto ou mistura no implemento (jatos, L, kg ou sacos)"],
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
    expect(linhas[0]).toHaveTextContent("Insumo · Jato 1");
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
