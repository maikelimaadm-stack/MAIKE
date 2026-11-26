/**
 * Diário da máquina — a janela (DiarioDaMaquina) com o service mockado:
 *  - degradação: sem a rota nova no servidor, o aviso + "Lançamento de hoje" (e o fluxo que já existe);
 *  - Passo 1: a quantidade vem pré-preenchida com a quantidade padrão do produto e o corpo vai certo;
 *  - Passo 2 parcial: manda a sobra (e o que foi ao pasto aparece antes de gravar);
 *  - Trocar pasto com perda: exige o motivo; com o motivo, grava a sobra como PERDA;
 *  - Trocar pasto sem sobra: os horímetros vão no trajeto (sem sobra e sem estoque) — D-PROD-324;
 *  - Resumo: sem R$ para o operador; com R$ para o administrador (só quando o servidor manda custo); volume em L e kg à parte;
 *  - Abastecer (seção própria, D-PROD-324): máquina do contexto, litros e horímetro; grava pelo caminho da tela Abastecimentos;
 *    rota ausente no servidor cai no formulário antigo.
 *
 * A busca paginada de produto (SeletorPaginadoGestao) é trocada por um botão de teste: o que se testa aqui é a janela.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const PRODUTO_PADRAO = vi.hoisted(() => ({
  id: "p1",
  nome: "Herbicida glifosato",
  unidade_principal_estoque: "L",
  quantidade_padrao: "4.0000",
  quantidade_padrao_unidade: "L",
}));

vi.mock("@/components/financeiroGestao/SeletorPaginadoGestao", () => ({
  default: ({ testId, onChange }) => (
    <button type="button" data-testid={testId} onClick={() => onChange(PRODUTO_PADRAO)}>
      Escolher produto
    </button>
  ),
}));
vi.mock("@/components/lancamento-atividades/RegistroDeCampo", () => ({
  default: () => <div data-testid="registro-de-campo-stub">Lançamento de hoje</div>,
}));
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
vi.mock("@/services/diarioMaquinaService", () => ({
  diarioDisponivel: vi.fn(),
  listarMisturas: vi.fn(),
  criarMistura: vi.fn(),
  aplicarMistura: vi.fn(),
  registrarSobra: vi.fn(),
  registrarTrajeto: vi.fn(),
  garantirDiaDoDiario: vi.fn(),
  apontamentoDoDia: vi.fn(),
  lerResumoDoDia: vi.fn(),
}));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarOpcoesImplementos: vi.fn(),
  listarLocaisDoProduto: vi.fn(),
  listarOpcoesProdutos: vi.fn(),
  obterMedidorDoBem: vi.fn(),
  concluirAtividade: vi.fn(),
}));
vi.mock("@/services/abastecimentoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarProdutosDoBem: vi.fn(),
  previaDoAbastecimento: vi.fn(),
  confirmarAbastecimento: vi.fn(),
}));
vi.mock("@/components/lancamento-atividades/JanelaLancamentoPorTipo", () => ({
  default: () => <div data-testid="janela-antiga-stub">Formulário antigo</div>,
}));

import DiarioDaMaquina from "@/components/lancamento-atividades/DiarioDaMaquina";
import { VerCustoContext } from "@/components/lancamento-atividades/VerCusto";
import * as diario from "@/services/diarioMaquinaService";
import * as atividadeService from "@/services/lancamentoAtividadesService";
import * as abastecimento from "@/services/abastecimentoService";

const ATIVIDADE = {
  id: "atv-1",
  versao: 3,
  tipo_atividade_id: "t1",
  bem_id: "bem-1",
  bem: { nome: "Trator 12" },
  areas: [
    { id: "aa-1", area_id: "area-1", ordem: 1, status: "EM_ANDAMENTO", area: { id: "area-1", nome: "Pasto 01", numero_area: "01" } },
    { id: "aa-2", area_id: "area-2", ordem: 2, status: "EM_ANDAMENTO", area: { id: "area-2", nome: "Pasto 02", numero_area: "02" } },
  ],
};
const IMPLEMENTO = { id: "imp1", nome: "Pulverizador 2.000 L", capacidade: "2000", capacidade_unidade: "L" };
const LOCAL = { local_estoque_id: "l1", local_nome: "Depósito", disponivel: "500" };
const RESUMO = {
  areas: [
    {
      area_id: "area-1",
      area_nome: "Pasto 01",
      implementos_cheios: 2,
      volumes_aplicados: [{ unidade: "L", volume: "4000" }],
      produtos: [{ produto_id: "p1", produto_nome: "Herbicida glifosato", quantidade: "8", unidade: "L" }],
      horas_maquina: "3.5",
      sobra: [],
      custo_total: "1234.5",
    },
  ],
  custo_total: "1234.5",
};

/** Um Produto do bem (diesel, em L) com um tanque. */
const OPCAO_DIESEL = {
  produto: { id: "d1", nome: "Diesel S10", unidade_principal_estoque: "L" },
  tanques: [{ id: "t1", identificador: "Tanque principal", capacidade_litros: "180" }],
  pronto: true,
};

/** Uma mistura ABERTA com saldo: 2.000 L de capacidade, 2.000 L no implemento, herbicida 4 L por implemento. */
const MISTURA_ABERTA = {
  id: "m1",
  numero: 1,
  implemento_bem_id: "imp1",
  area_id: "area-1",
  capacidade: "2000",
  unidade: "L",
  saldo: "2000",
  status: "ABERTA",
  // A forma que o servidor manda (comoMisturaPublica): o nome e a unidade do produto vêm planos.
  itens: [{ produto_id: "p1", produto_nome: "Herbicida glifosato", produto_unidade: "L", local_estoque_id: "l1", local_nome: "Depósito", quantidade: "4" }],
};

const renderizar = ({ admin = false, props = {} } = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <VerCustoContext.Provider value={admin}>
        <DiarioDaMaquina atividade={ATIVIDADE} areaId="area-1" areaNome="Pasto 01" tipos={[]} onFechar={onFechar} {...props} />
      </VerCustoContext.Provider>
    </QueryClientProvider>,
  );
  return { onFechar };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(diario.diarioDisponivel).mockResolvedValue(true);
  vi.mocked(diario.listarMisturas).mockResolvedValue([]);
  vi.mocked(diario.apontamentoDoDia).mockResolvedValue(null);
  vi.mocked(diario.criarMistura).mockResolvedValue({});
  vi.mocked(diario.aplicarMistura).mockResolvedValue({});
  vi.mocked(diario.registrarSobra).mockResolvedValue({});
  vi.mocked(diario.lerResumoDoDia).mockResolvedValue(RESUMO);
  vi.mocked(diario.registrarTrajeto).mockResolvedValue({});
  vi.mocked(diario.garantirDiaDoDiario).mockResolvedValue({ id: "ap-9" });
  vi.mocked(atividadeService.listarOpcoesImplementos).mockResolvedValue({ itens: [IMPLEMENTO] });
  vi.mocked(atividadeService.listarLocaisDoProduto).mockResolvedValue({ itens: [LOCAL] });
  vi.mocked(atividadeService.obterMedidorDoBem).mockResolvedValue({ medidor_tipo: "HORIMETRO", leitura_vigente: "1250.5000" });
  vi.mocked(abastecimento.listarProdutosDoBem).mockResolvedValue({ itens: [OPCAO_DIESEL], has_more: false, next_cursor: null });
  vi.mocked(abastecimento.previaDoAbastecimento).mockResolvedValue({ plano: { ok: true }, bloqueios: [] });
  vi.mocked(abastecimento.confirmarAbastecimento).mockResolvedValue({ numero: 1, quantidade: "80", unidade: "L" });
});

afterEach(() => {
  cleanup();
});

describe("Diário da máquina — degradação", () => {
  it("sem a rota nova no servidor: o aviso discreto e o Lançamento de hoje, que abre o fluxo que já existe", async () => {
    vi.mocked(diario.diarioDisponivel).mockResolvedValue(false);
    renderizar();

    expect(await screen.findByText("Diário da máquina ainda não está ligado no servidor. Use o lançamento de hoje.")).toBeTruthy();
    expect(diario.listarMisturas).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("diario-lancamento-de-hoje"));
    expect(await screen.findByTestId("registro-de-campo-stub")).toBeTruthy();
  });
});

describe("Diário da máquina — Passo 1 (mistura no implemento)", () => {
  it("pré-preenche a quantidade padrão do produto e manda o corpo certo (sem baixar estoque)", async () => {
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-passo-1-botao"));

    fireEvent.click(screen.getByTestId("diario-produto-1"));
    // A quantidade padrão (4 L por implemento cheio) vem preenchida e continua editável.
    expect(screen.getByLabelText("Quantidade (L)").value).toBe("4");

    // O local do estoque chega do servidor (o campo abre a lista); a escolha dele completa a linha.
    fireEvent.click(screen.getByRole("combobox", { name: "Local do estoque" }));
    fireEvent.click(await screen.findByRole("option", { name: /dep[óo]sito/i }));

    fireEvent.click(screen.getByTestId("diario-implemento-cheio"));

    await waitFor(() => expect(diario.criarMistura).toHaveBeenCalledTimes(1));
    const [atividadeId, corpo] = vi.mocked(diario.criarMistura).mock.calls[0];
    expect(atividadeId).toBe("atv-1");
    expect(corpo).toMatchObject({
      implemento_bem_id: "imp1",
      area_id: "area-1",
      itens: [{ produto_id: "p1", local_estoque_id: "l1", quantidade: "4" }],
    });
    // Nada de capacidade/unidade no corpo: o servidor usa a do bem.
    expect(corpo).not.toHaveProperty("capacidade");
  });

  it("sem produto nem quantidade, não envia e mostra o erro da quantidade", async () => {
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-passo-1-botao"));
    fireEvent.click(screen.getByTestId("diario-implemento-cheio"));
    expect(await screen.findByText("Informe a quantidade.")).toBeTruthy();
    expect(diario.criarMistura).not.toHaveBeenCalled();
  });
});

describe("Diário da máquina — Passo 2 (aplicar no pasto)", () => {
  it("parcial: manda a sobra (texto) e mostra quanto foi para o pasto antes de gravar", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    vi.mocked(diario.apontamentoDoDia).mockResolvedValue({ id: "ap-1", data_operacional: "2026-11-26" });
    renderizar();

    fireEvent.click(await screen.findByTestId("diario-passo-2-botao"));
    fireEvent.click(screen.getByRole("radio", { name: "Não, sobrou um pouco" }));
    fireEvent.change(screen.getByTestId("diario-sobra"), { target: { value: "500" } });

    expect(screen.getByText("Vai para o pasto: 1.500 L")).toBeTruthy();
    expect(screen.getByText("Herbicida glifosato: 3 L")).toBeTruthy();
    fireEvent.click(screen.getByTestId("diario-gravar-aplicacao"));

    await waitFor(() => expect(diario.aplicarMistura).toHaveBeenCalledTimes(1));
    expect(diario.aplicarMistura).toHaveBeenCalledWith("atv-1", "m1", { empresa_id: "emp-1", esvaziou: false, sobra: "500" });
  });

  it("sem lançamento do dia: aplica do mesmo jeito (o servidor cria o lançamento de hoje)", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-passo-2-botao"));
    expect(screen.queryByText(/Lance o dia primeiro/)).toBeNull();
    fireEvent.click(screen.getByTestId("diario-gravar-aplicacao"));
    await waitFor(() => expect(diario.aplicarMistura).toHaveBeenCalledWith("atv-1", "m1", { empresa_id: "emp-1", esvaziou: true }));
  });

  it("esvaziou: não manda sobra", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    vi.mocked(diario.apontamentoDoDia).mockResolvedValue({ id: "ap-1", data_operacional: "2026-11-26" });
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-passo-2-botao"));
    fireEvent.click(screen.getByTestId("diario-gravar-aplicacao"));
    await waitFor(() => expect(diario.aplicarMistura).toHaveBeenCalledTimes(1));
    expect(diario.aplicarMistura.mock.calls[0][2]).toEqual({ empresa_id: "emp-1", esvaziou: true });
  });
});

describe("Diário da máquina — Trocar pasto", () => {
  it("com perda, exige o motivo; com o motivo, grava a sobra como PERDA", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    renderizar();

    fireEvent.click(await screen.findByTestId("diario-trocar-botao"));
    fireEvent.click(screen.getByRole("radio", { name: "Perda (com motivo)" }));
    fireEvent.click(screen.getByTestId("diario-ir-para-pasto"));

    expect(await screen.findByText(/Informe o motivo da perda/)).toBeTruthy();
    expect(diario.registrarSobra).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Motivo da perda"), { target: { value: "Vazou no tanque" } });
    fireEvent.click(screen.getByTestId("diario-ir-para-pasto"));

    await waitFor(() => expect(diario.registrarSobra).toHaveBeenCalledTimes(1));
    const [atividadeId, misturaId, corpo] = vi.mocked(diario.registrarSobra).mock.calls[0];
    expect([atividadeId, misturaId]).toEqual(["atv-1", "m1"]);
    expect(corpo).toMatchObject({ empresa_id: "emp-1", tipo: "PERDA", motivo: "Vazou no tanque" });
    expect(corpo).not.toHaveProperty("para_area_id");
  });

  it("vai junto para o próximo pasto: manda a transferência com o pasto e os horímetros", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-trocar-botao"));
    fireEvent.change(screen.getByLabelText("Horímetro de saída"), { target: { value: "1250,6" } });
    fireEvent.click(screen.getByTestId("diario-ir-para-pasto"));

    await waitFor(() => expect(diario.registrarSobra).toHaveBeenCalledTimes(1));
    const corpo = vi.mocked(diario.registrarSobra).mock.calls[0][2];
    expect(corpo).toMatchObject({ tipo: "TRANSFERENCIA", para_area_id: "area-2", horimetro_saida: "1250.6" });
    expect(corpo).not.toHaveProperty("horimetro_chegada");
  });
});

describe("Diário da máquina — Trocar pasto sem sobra (horímetro sempre que informado)", () => {
  it("sem mistura com sobra: manda só o trajeto com os horímetros, sem sobra e sem estoque", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([]);
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-trocar-botao"));
    fireEvent.change(screen.getByLabelText("Horímetro de saída"), { target: { value: "120,5" } });
    fireEvent.change(screen.getByLabelText("Horímetro de chegada"), { target: { value: "123" } });
    fireEvent.click(screen.getByTestId("diario-ir-para-pasto"));

    await waitFor(() => expect(diario.registrarTrajeto).toHaveBeenCalledTimes(1));
    expect(diario.registrarTrajeto).toHaveBeenCalledWith("atv-1", {
      empresa_id: "emp-1", de_area_id: "area-1", para_area_id: "area-2", horimetro_saida: "120.5", horimetro_chegada: "123",
    });
    expect(diario.registrarSobra).not.toHaveBeenCalled();
  });

  it("sobra devolvida com horímetro: grava a sobra (sem horímetro) e depois o trajeto", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-trocar-botao"));
    fireEvent.click(screen.getByRole("radio", { name: "Volta ao depósito" }));
    fireEvent.change(screen.getByLabelText("Horímetro de saída"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("diario-ir-para-pasto"));

    await waitFor(() => expect(diario.registrarTrajeto).toHaveBeenCalledTimes(1));
    const sobra = vi.mocked(diario.registrarSobra).mock.calls[0][2];
    expect(sobra).toMatchObject({ tipo: "DEVOLUCAO" });
    expect(sobra).not.toHaveProperty("horimetro_saida");
    expect(diario.registrarTrajeto.mock.calls[0][1]).toMatchObject({ de_area_id: "area-1", para_area_id: "area-2", horimetro_saida: "10" });
  });
});

describe("Diário da máquina — Abastecer (seção própria, D-PROD-324)", () => {
  /** Abre o Abastecer pelo "Mais" do diário. */
  const abrirAbastecer = async () => {
    fireEvent.click(await screen.findByTestId("diario-mais-botao"));
    fireEvent.click(screen.getByTestId("diario-abastecer"));
    return screen.findByTestId("diario-abastecer");
  };

  it("máquina do contexto, litros e horímetro (sugerido pela leitura vigente); grava pelo caminho da tela Abastecimentos", async () => {
    renderizar();
    const secao = await abrirAbastecer();
    expect(within(secao).getByText(/Trator 12/)).toBeTruthy();

    // Um Produto e um tanque só: já vêm escolhidos. O horímetro vem com a última leitura.
    await waitFor(() => expect(screen.getByTestId("diario-abastecer-horimetro").value).toBe("1250,5"));
    fireEvent.change(screen.getByTestId("diario-abastecer-litros"), { target: { value: "80" } });
    fireEvent.click(screen.getByTestId("diario-abastecer-gravar"));

    await waitFor(() => expect(abastecimento.confirmarAbastecimento).toHaveBeenCalledTimes(1));
    // O lançamento de hoje da área é garantido antes (o abastecimento fica ligado à atividade).
    expect(diario.garantirDiaDoDiario).toHaveBeenCalledWith("atv-1", "area-1");
    const [empresa, form] = vi.mocked(abastecimento.previaDoAbastecimento).mock.calls[0];
    expect(empresa).toBe("emp-1");
    expect(form).toMatchObject({
      bem: { id: "bem-1", medidor: { tipo: "HORIMETRO" } },
      produto: { id: "d1" },
      tanque_id: "t1",
      local_estoque_id: "l1",
      quantidade: "80",
      medidor_leitura: "1250,5",
      apontamento_id: "ap-9",
    });
    expect(abastecimento.confirmarAbastecimento.mock.calls[0][0]).toBe("emp-1");
    expect(abastecimento.confirmarAbastecimento.mock.calls[0][3]).toMatchObject({ escopo: expect.any(String) });
  });

  it("sem litros, não envia e mostra o erro da quantidade", async () => {
    renderizar();
    await abrirAbastecer();
    await waitFor(() => expect(screen.getByTestId("diario-abastecer-horimetro").value).toBe("1250,5"));
    fireEvent.click(screen.getByTestId("diario-abastecer-gravar"));
    expect(await screen.findByText("Informe a quantidade abastecida.")).toBeTruthy();
    expect(abastecimento.previaDoAbastecimento).not.toHaveBeenCalled();
  });

  it("rota ausente no servidor: cai no formulário antigo (a janela de sempre, no lugar deste diário)", async () => {
    vi.mocked(abastecimento.previaDoAbastecimento).mockRejectedValue(Object.assign(new Error("Route POST not found"), { rotaAusente: true }));
    renderizar();
    await abrirAbastecer();
    await waitFor(() => expect(screen.getByTestId("diario-abastecer-horimetro").value).toBe("1250,5"));
    fireEvent.change(screen.getByTestId("diario-abastecer-litros"), { target: { value: "80" } });
    fireEvent.click(screen.getByTestId("diario-abastecer-gravar"));
    expect(await screen.findByTestId("janela-antiga-stub")).toBeTruthy();
  });

  it("atividade sem máquina: avisa e não abre o formulário", async () => {
    renderizar({ props: { atividade: { ...ATIVIDADE, bem_id: null, bem: null } } });
    await abrirAbastecer();
    expect(await screen.findByText(/não tem máquina/)).toBeTruthy();
  });
});

describe("Diário da máquina — Resumo do dia", () => {
  it("volume em L e kg em linhas separadas (nunca somados)", async () => {
    vi.mocked(diario.lerResumoDoDia).mockResolvedValue({
      areas: [{ area_id: "area-1", area_nome: "Pasto 01", implementos_cheios: 2, volumes_aplicados: [{ unidade: "L", volume: "1500" }, { unidade: "KG", volume: "1000" }], produtos: [], horas_maquina: "0", sobra: [{ unidade: "L", volume: "500" }] }],
    });
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-resumo-botao"));
    expect((await screen.findByTestId("diario-resumo-volume-area-1")).textContent).toBe("Volume aplicado: 1.500 L · 1.000 kg");
    expect(screen.getByTestId("diario-resumo-sobra-area-1").textContent).toContain("Sobra no implemento: 500 L");
  });

  it("sem R$ para o operador, mesmo com o custo vindo do servidor", async () => {
    renderizar({ admin: false });
    fireEvent.click(await screen.findByTestId("diario-resumo-botao"));

    const resumo = await screen.findByTestId("diario-resumo");
    expect(await within(resumo).findByText("Herbicida glifosato: 8 L")).toBeTruthy();
    expect(within(resumo).queryByText(/R\$/)).toBeNull();
    expect(screen.queryByTestId("diario-resumo-custo")).toBeNull();
  });

  it("com R$ para o administrador, quando o servidor manda o custo", async () => {
    renderizar({ admin: true });
    fireEvent.click(await screen.findByTestId("diario-resumo-botao"));

    expect(await screen.findByTestId("diario-resumo-custo")).toBeTruthy();
    expect(screen.getByTestId("diario-resumo-custo").textContent).toMatch(/R\$/);
  });
});
