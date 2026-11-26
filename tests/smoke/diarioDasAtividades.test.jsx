/**
 * D-PROD-325 — o "Diário das atividades" (só a abertura) com o service mockado:
 *  (a) 7 cartões; "Continuar" só com um tipo escolhido;
 *  (b) Aplicação → campos na ordem Máquina, Implemento, Horímetro inicial, Responsável; sem "Hora de início";
 *  (c) escolher a máquina preenche o horímetro com a leitura dela (editável);
 *  (d) confirmar vazio mostra os erros e não envia;
 *  (e) confirmar envia `registrarCampo` uma vez, com a abertura na observação, e mostra o cabeçalho "Aberto";
 *  (f) aberto com uma atividade existente, começa direto no cabeçalho (lido dos apontamentos);
 *  (g) com duas operações do tipo, a Operação vem primeiro e é obrigatória.
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
import { notifyWarning } from "@/lib/maikeNotify";

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500" };
const OPERACAO_APLICACAO = { id: "op-1", nome_tipo: "Aplicação de defensivo", categoria: "APLICACAO", ativo: true };
const OPERACAO_APLICACAO_2 = { id: "op-2", nome_tipo: "Aplicação de adubo foliar", categoria: "APLICACAO", ativo: true };
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

/** Escolhe o tipo Aplicação e vai ao passo da abertura. */
const irAbertura = async () => {
  fireEvent.click(screen.getByTestId("abertura-tipo-APLICACAO"));
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
    expect(onGravou).toHaveBeenCalledTimes(1);

    const cabecalho = screen.getByTestId("abertura-iniciado");
    expect(within(cabecalho).getByText("Trator 12")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Pulverizador 2.000 L")).toBeInTheDocument();
    expect(within(cabecalho).getByText("João Pereira")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Pasto 04")).toBeInTheDocument();
    expect(within(cabecalho).getByText("Horímetro inicial 1.250,5")).toBeInTheDocument();
    expect(within(cabecalho).getByText("● Aberto")).toBeInTheDocument();
    expect(screen.getByTestId("abertura-em-breve")).toHaveTextContent("Encher implemento, Trocar pasto, Trocar implemento, Mais e Encerrar o dia chegam nas próximas etapas.");
    expect(screen.getByTestId("abertura-fechar")).toHaveTextContent("Fechar");
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
});
