/**
 * D-PROD-336 — o "Diário das atividades" com atividades abertas no pasto (service mockado):
 *  (1) com 2 abertas: a 1ª tela é "Em andamento neste pasto" com as 2 e "Nova atividade"; cada uma com a etiqueta da abertura;
 *  (2) sem nenhuma aberta: abre direto no tipo, sem "Voltar" para a lista;
 *  (3) "Nova atividade" leva ao tipo; do tipo, o Voltar volta à lista;
 *  (4) tocar a aberta COM abertura: lê a atividade (`lerAtividade`) e vai ao cabeçalho do serviço;
 *  (5) tocar a aberta SEM abertura: formulário de abertura com o tipo e a operação dela já definidos;
 *  (6) falha ao ler: aviso (notifyWarning) e fica na lista;
 *  (7) tipo com atividade aberta no pasto: "Já existe … iniciar entra nela." (só aviso); outro tipo, sem o aviso.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

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
import { marcadorDaAbertura } from "@/lib/aberturaServicoRegras";
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

describe("Diário das atividades — Em andamento neste pasto (D-PROD-336)", () => {
  it("(1) com 2 abertas, a 1ª tela é a lista delas, com a etiqueta de cada abertura e o botão Nova atividade", async () => {
    renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA] });
    expect(screen.getByTestId("diario-atividades-escolher")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Em andamento neste pasto");
    expect(screen.queryByTestId("diario-atividades-tipos")).toBeNull();
    const primeira = screen.getByTestId("diario-atividade-aberta-at-1");
    const segunda = screen.getByTestId("diario-atividade-aberta-at-2");
    expect(primeira).toHaveTextContent("Aplicação · nov/26");
    expect(primeira).toHaveTextContent("Início 02/11");
    expect(segunda).toHaveTextContent("Início 20/11");
    expect(await within(primeira).findByText("Com abertura")).toBeInTheDocument();
    expect(await within(segunda).findByText("Sem abertura")).toBeInTheDocument();
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
    expect(await screen.findByTestId("abertura-iniciado")).toBeInTheDocument();
    expect(lerAtividade).toHaveBeenCalledWith("at-1");
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Diário das atividades");
    expect(screen.getByTestId("servico-encerrar")).toBeInTheDocument();
    expect(await screen.findByText("Horímetro inicial 1.245,0")).toBeInTheDocument();
  });

  it("(5) tocar a atividade SEM abertura vai ao formulário de abertura, com o tipo e a operação dela já escolhidos", async () => {
    const { lerAtividade } = renderizar({ atividadesAbertas: [ABERTA_COM_ABERTURA, ABERTA_SEM_ABERTURA] });
    fireEvent.click(screen.getByTestId("diario-atividade-aberta-at-2"));
    expect(await screen.findByTestId("abertura-form")).toBeInTheDocument();
    expect(lerAtividade).toHaveBeenCalledWith("at-2");
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Nova atividade de");
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
      "Já existe Aplicação · nov/26 em andamento neste pasto: iniciar entra nela.",
    );
    fireEvent.click(screen.getByTestId("abertura-tipo-PLANTIO"));
    expect(screen.queryByTestId("abertura-ja-existe")).toBeNull();
  });
});
