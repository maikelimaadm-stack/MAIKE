/**
 * Diário da máquina — a janela (DiarioDaMaquina) com o service mockado:
 *  - degradação: sem a rota nova no servidor, o aviso + "Lançamento de hoje" (e o fluxo que já existe);
 *  - Passo 1: a quantidade vem pré-preenchida com a quantidade padrão do produto e o corpo vai certo;
 *  - Passo 2 parcial: manda a sobra (e o que foi ao pasto aparece antes de gravar);
 *  - Trocar pasto com perda: exige o motivo; com o motivo, grava a sobra como PERDA;
 *  - Resumo: sem R$ para o operador; com R$ para o administrador (só quando o servidor manda custo).
 *
 * A busca paginada de produto (SeletorPaginadoGestao) é trocada por um botão de teste: o que se testa aqui é a janela.
 *
 * D-PROD-335: a janela NÃO tem mais entrada em menu nenhum (a página Lançamento de Atividades e o mapa abrem o
 * "Diário das atividades"). Este arquivo testa o componente em si, montado direto; a entrada nova é coberta em
 * lancamentoAtividades.test.jsx (LA-DIARIO) e em diarioEmAndamentoNoPasto.test.jsx.
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
  apontamentoDoDia: vi.fn(),
  lerResumoDoDia: vi.fn(),
}));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarOpcoesImplementos: vi.fn(),
  listarLocaisDoProduto: vi.fn(),
  listarOpcoesProdutos: vi.fn(),
  concluirAtividade: vi.fn(),
}));

import DiarioDaMaquina from "@/components/lancamento-atividades/DiarioDaMaquina";
import { VerCustoContext } from "@/components/lancamento-atividades/VerCusto";
import * as diario from "@/services/diarioMaquinaService";
import * as atividadeService from "@/services/lancamentoAtividadesService";

const ATIVIDADE = {
  id: "atv-1",
  versao: 3,
  tipo_atividade_id: "t1",
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
      volume_aplicado: "4000",
      produtos: [{ nome: "Herbicida glifosato", quantidade: "8", unidade: "L" }],
      horas_maquina: "3.5",
      custo_total: "1234.5",
    },
  ],
  sobra: null,
  custo_total: "1234.5",
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
  itens: [{ produto_id: "p1", produto: { nome: "Herbicida glifosato", unidade: "L" }, local_estoque_id: "l1", quantidade: "4" }],
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
  vi.mocked(atividadeService.listarOpcoesImplementos).mockResolvedValue({ itens: [IMPLEMENTO] });
  vi.mocked(atividadeService.listarLocaisDoProduto).mockResolvedValue({ itens: [LOCAL] });
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
    fireEvent.click(screen.getByTestId("diario-gravar-aplicacao"));

    await waitFor(() => expect(diario.aplicarMistura).toHaveBeenCalledTimes(1));
    expect(diario.aplicarMistura).toHaveBeenCalledWith("atv-1", "ap-1", "m1", { empresa_id: "emp-1", esvaziou: false, sobra: "500" });
  });

  it("esvaziou: não manda sobra", async () => {
    vi.mocked(diario.listarMisturas).mockResolvedValue([MISTURA_ABERTA]);
    vi.mocked(diario.apontamentoDoDia).mockResolvedValue({ id: "ap-1", data_operacional: "2026-11-26" });
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-passo-2-botao"));
    fireEvent.click(screen.getByTestId("diario-gravar-aplicacao"));
    await waitFor(() => expect(diario.aplicarMistura).toHaveBeenCalledTimes(1));
    expect(diario.aplicarMistura.mock.calls[0][3]).toEqual({ empresa_id: "emp-1", esvaziou: true });
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

describe("Diário da máquina — Resumo do dia", () => {
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
