/**
 * Diário da máquina, Fase 2 (só tela, sem banco):
 *  - `podeVerCusto(permissao)`: R$ só com a permissão efetiva de administrador da fazenda (`is_admin === true`);
 *  - as telas de lançamento do operador escondem os valores em R$ (o envio e o custo gravado não mudam);
 *  - "Diário das atividades" na janela do pasto (Detalhes da área do Mapa, D-PROD-329): abre já com ESTE pasto,
 *    só com permissão de lançar e fuso da fazenda.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { podeVerCusto } from "@/lib/verCustoRegras";
import { VerCustoContext, useVerCusto } from "@/components/lancamento-atividades/VerCusto";
import LinhasDoApontamento from "@/components/lancamento-atividades/LinhasDoApontamento";

const sessao = vi.hoisted(() => ({
  acoes: /** @type {Record<string, any>} */ ({}),
  permissaoEfetiva: /** @type {any} */ (null),
  fusoOk: true,
  resumo: vi.fn(),
}));

vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ...sessao.acoes, permissaoEfetiva: sessao.permissaoEfetiva, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: sessao.fusoOk, semFuso: false, hoje: "2026-11-26" }),
}));
vi.mock("@/hooks/usePatrimonioSessao", () => ({
  useAcoesTelaAbastecimento: () => ({ ver: false, criar: false, editar: false, cancelar: false }),
  useAcoesTelaPatrimonio: () => ({ ver: false }),
}));
vi.mock("@/services/abastecimentoService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarAbastecimentosPagina: vi.fn(async () => ({ items: [], total: 0 })),
  detalharAbastecimento: vi.fn(),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "c-1", user: { id: "u-1" } }) }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  obterResumoDaArea: sessao.resumo,
  obterAtividade: vi.fn(),
  listarAtividades: vi.fn(async () => ({ items: [] })),
}));
vi.mock("@/components/mapa/HistoricoAbateCurral", () => ({ default: () => null }));

const TUDO = { ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true };
const ADMIN = { is_admin: true, modulos_permitidos: [], permissoes_telas: [] };
const OPERADOR = { is_admin: false, modulos_permitidos: ["operacao"], permissoes_telas: [{ tela_id: "op-atividades", visualizar: true, lancar_apontamento: true }] };

afterEach(() => cleanup());
beforeEach(() => {
  sessao.acoes = { ...TUDO };
  sessao.permissaoEfetiva = ADMIN;
  sessao.fusoOk = true;
  sessao.resumo.mockReset();
});

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

describe("podeVerCusto", () => {
  it("só o administrador da fazenda (is_admin === true) vê R$", () => {
    expect(podeVerCusto(ADMIN)).toBe(true);
    expect(podeVerCusto({ is_admin: true })).toBe(true);
  });

  it("operador, sem registro ou com is_admin diferente de true não vê R$", () => {
    expect(podeVerCusto(OPERADOR)).toBe(false);
    expect(podeVerCusto(null)).toBe(false);
    expect(podeVerCusto(undefined)).toBe(false);
    expect(podeVerCusto({ is_admin: "true" })).toBe(false);
    expect(podeVerCusto({ modulos_permitidos: ["operacao"], permissoes_telas: [] })).toBe(false);
  });
});

describe("contexto VerCusto", () => {
  it("sem provedor, o valor padrão é true (quem não passa o provedor vê como antes)", () => {
    const Sonda = () => <span data-testid="sonda">{String(useVerCusto())}</span>;
    render(<Sonda />);
    expect(screen.getByTestId("sonda")).toHaveTextContent("true");
  });
});

describe("R$ escondido para o operador", () => {
  const apontamento = {
    id: "ap-1",
    status: "CONFIRMADO",
    versao: 1,
    data: "2026-11-26",
    area_executada_dia: "10",
    produtos: [{ id: "pl1", produto_id: "p1", nome: "Herbicida X", quantidade: "4", unidade: "L", custo_total: "125.00", status: "CONFIRMADO", jato: 1 }],
    maquinas: [{ id: "mq1", bem_id: "b1", quantidade_uso: "2", custo_total: "300.00", status: "CONFIRMADO" }],
    mao_obra: [{ id: "mo1", tipo_medida: "HORA", quantidade: "3", custo_unitario: "50.00", custo_total: "150.00", status: "CONFIRMADO" }],
    servicos: [],
  };
  const atividade = { id: "at-1", status: "ABERTA", versao: 3, tipo_atividade_id: "t-1" };
  const props = {
    atividade,
    apontamento,
    permiteProduto: true,
    permiteImplemento: false,
    permiteMaoObra: true,
    permiteServico: false,
    podeLancar: false,
    podeEditar: false,
    podeCancelar: false,
    gravavel: false,
    escopo: "c-1:operador",
    fuso: "America/Cuiaba",
    onEscrita: vi.fn(),
    onMudou: vi.fn(),
  };

  const montar = (verCusto) =>
    render(
      <QueryClientProvider client={novoCliente()}>
        <VerCustoContext.Provider value={verCusto}>
          <LinhasDoApontamento {...props} />
        </VerCustoContext.Provider>
      </QueryClientProvider>,
    );

  it("com provedor false, não mostra nenhum valor em R$ e mantém as quantidades", () => {
    const { container } = montar(false);
    expect(container.textContent).not.toContain("R$");
    expect(screen.queryByTestId("linha-produto-pl1-custo")).toBeNull();
    expect(screen.queryByTestId("linha-maquina-mq1-custo")).toBeNull();
    expect(screen.queryByTestId("linha-mao-obra-mo1-custo")).toBeNull();
    expect(screen.getByTestId("linha-produto-pl1-quantidade")).toBeTruthy();
  });

  it("com provedor true (administrador), mostra o custo como antes", () => {
    const { container } = montar(true);
    expect(container.textContent).toContain("R$");
    expect(screen.getByTestId("linha-produto-pl1-custo")).toHaveTextContent("R$ 125,00");
  });
});

describe("Diário das atividades no pasto (Detalhes da área, D-PROD-329)", () => {
  const PASTO = { id: "area-A", nome: "PASTO A", tipo_cultura: "Pastagem", tamanho_hectares: "22.0000" };
  const RESUMO_VAZIO = { area_id: "area-A", mes: "2026-11", atividades: [], custos: null, planejamentos: [] };
  const RESUMO_COM_CUSTO = {
    ...RESUMO_VAZIO,
    custos: { custo_total: "1500.00", custo_por_ha: "68.18", insumos: "1000.00", maquinas: "300.00", mao_obra: "200.00", servicos: null },
  };

  /** @param {string} secao */
  const montar = async (secao, resumo = RESUMO_VAZIO) => {
    const AbaDetalhesDaArea = (await import("@/components/mapa/detalhes-area/AbaDetalhesDaArea")).default;
    sessao.resumo.mockResolvedValue(resumo);
    return render(
      <QueryClientProvider client={novoCliente()}>
        <AbaDetalhesDaArea area={PASTO} verAtividades ocupada={false} tipos={[]} secao={secao} />
      </QueryClientProvider>,
    );
  };

  it("com permissão de lançar e fuso ok, o botão abre o Diário das atividades deste pasto (no tipo)", async () => {
    await montar("manejos");
    const botao = await screen.findByTestId("area-diario-atividades");
    expect(botao).toHaveClass("tb-btn", "tb-btn-green");
    expect(botao).toHaveTextContent("Diário das atividades");
    expect(screen.queryByTestId("diario-atividades")).toBeNull();
    fireEvent.click(botao);
    expect(await screen.findByTestId("diario-atividades")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-tipos")).toBeInTheDocument();
    expect(screen.queryByTestId("area-diario-maquina")).toBeNull();
  });

  it("sem permissão de lançar, o botão não aparece", async () => {
    sessao.acoes = { ...TUDO, lancarApontamento: false };
    await montar("manejos");
    await waitFor(() => expect(sessao.resumo).toHaveBeenCalled());
    await screen.findByText("Nenhuma atividade nesta área agora.");
    expect(screen.queryByTestId("area-diario-atividades")).toBeNull();
  });

  it("sem fuso da fazenda, o botão não aparece", async () => {
    sessao.fusoOk = false;
    await montar("manejos");
    await screen.findByText("Nenhuma atividade nesta área agora.");
    expect(screen.queryByTestId("area-diario-atividades")).toBeNull();
  });

  it("operador não vê a seção de custos (R$); o administrador vê", async () => {
    sessao.permissaoEfetiva = OPERADOR;
    const operador = await montar("custos", RESUMO_COM_CUSTO);
    await waitFor(() => expect(sessao.resumo).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(within(operador.container).queryByText("Custo total")).toBeNull();
    expect(operador.container.textContent).not.toContain("R$");
    operador.unmount();

    sessao.permissaoEfetiva = ADMIN;
    const admin = await montar("custos", RESUMO_COM_CUSTO);
    expect(await within(admin.container).findByText("Custo total")).toBeTruthy();
  });
});
