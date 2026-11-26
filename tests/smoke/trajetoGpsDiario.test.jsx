/**
 * Rastreio do trajeto no Diário da máquina (tela):
 *  - a faixa "Gravando trajeto · 1,2 km" só aparece com trajeto aberto desta atividade;
 *  - o botão "Iniciar rastreio" / "Parar rastreio" fica no rodapé da seção principal, por toque;
 *  - sem máquina na atividade, avisa e não abre trajeto;
 *  - sem a rota no servidor, mostra o aviso discreto e some o botão (o Diário segue como hoje).
 * O hook de rastreio é trocado por um estado controlado; o que se testa aqui é a janela.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const rastreio = vi.hoisted(() => ({
  valor: /** @type {any} */ (null),
}));

vi.mock("@/hooks/useRastreioGps", () => ({
  useRastreioGps: () => rastreio.valor,
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
vi.mock("@/components/lancamento-atividades/RegistroDeCampo", () => ({
  default: () => <div data-testid="registro-de-campo-stub" />,
}));
vi.mock("@/services/diarioMaquinaService", () => ({
  diarioDisponivel: vi.fn(async () => true),
  listarMisturas: vi.fn(async () => []),
  criarMistura: vi.fn(),
  aplicarMistura: vi.fn(),
  registrarSobra: vi.fn(),
  apontamentoDoDia: vi.fn(async () => null),
  lerResumoDoDia: vi.fn(),
}));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  listarOpcoesImplementos: vi.fn(async () => ({ itens: [] })),
  listarLocaisDoProduto: vi.fn(),
  listarOpcoesProdutos: vi.fn(),
  concluirAtividade: vi.fn(),
}));

import DiarioDaMaquina from "@/components/lancamento-atividades/DiarioDaMaquina";

const ATIVIDADE_COM_MAQUINA = {
  id: "atv-1",
  versao: 3,
  tipo_atividade_id: "t1",
  bem_id: "bem-1",
  bem: { nome: "Trator 12" },
  areas: [{ id: "aa-1", area_id: "area-1", ordem: 1, status: "EM_ANDAMENTO", area: { id: "area-1", nome: "Pasto 01", numero_area: "01" } }],
};

/** O hook de rastreio com o padrão (nada ligado). */
const rastreioParado = (extra = {}) => ({
  trajeto: null,
  gravando: false,
  indisponivel: false,
  aviso: null,
  pendentes: 0,
  linha: [],
  aberto: false,
  abertoNestaAtividade: false,
  distanciaM: 0,
  iniciar: vi.fn(async () => ({ estado: "ok" })),
  parar: vi.fn(async () => undefined),
  encerrarDia: vi.fn(async () => ({ estado: "ok" })),
  ...extra,
});

const renderizar = (atividade = ATIVIDADE_COM_MAQUINA) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFechar = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <DiarioDaMaquina atividade={atividade} areaId="area-1" areaNome="Pasto 01" tipos={[]} onFechar={onFechar} />
    </QueryClientProvider>,
  );
  return { onFechar };
};

beforeEach(() => {
  rastreio.valor = rastreioParado();
});
afterEach(() => cleanup());

describe("rastreio do trajeto no Diário", () => {
  it("sem trajeto aberto: não mostra a faixa e oferece Iniciar rastreio no rodapé", async () => {
    renderizar();
    expect(await screen.findByTestId("diario-corpo")).toBeInTheDocument();
    expect(screen.queryByTestId("diario-trajeto-faixa")).toBeNull();
    expect(screen.getByTestId("diario-rastreio-botao")).toHaveTextContent("Iniciar rastreio");
  });

  it("com trajeto aberto desta atividade gravando: faixa com a distância e botão Parar rastreio", async () => {
    rastreio.valor = rastreioParado({ trajeto: { trajetoId: "tj-1", atividadeId: "atv-1" }, aberto: true, abertoNestaAtividade: true, gravando: true, distanciaM: 1200 });
    renderizar();
    const faixa = await screen.findByTestId("diario-trajeto-faixa");
    expect(faixa).toHaveTextContent("Gravando trajeto · 1,2 km");
    expect(screen.getByTestId("diario-rastreio-botao")).toHaveTextContent("Parar rastreio");
  });

  it("toque em Iniciar rastreio abre o trajeto com a máquina e a data, sem mandar implemento nem apontamento vazios", async () => {
    renderizar();
    fireEvent.click(await screen.findByTestId("diario-rastreio-botao"));
    await waitFor(() => expect(rastreio.valor.iniciar).toHaveBeenCalledTimes(1));
    expect(rastreio.valor.iniciar.mock.calls[0][0]).toMatchObject({
      atividadeId: "atv-1",
      empresaId: "emp-1",
      bemId: "bem-1",
      dataOperacional: "2026-11-26",
      implementoBemId: null,
      apontamentoId: null,
    });
  });

  it("sem máquina na atividade, avisa e não abre trajeto", async () => {
    renderizar({ ...ATIVIDADE_COM_MAQUINA, bem_id: null, bem: null });
    fireEvent.click(await screen.findByTestId("diario-rastreio-botao"));
    expect(await screen.findByTestId("diario-rastreio-aviso")).toHaveTextContent("Escolha a máquina antes de iniciar o rastreio.");
    expect(rastreio.valor.iniciar).not.toHaveBeenCalled();
  });

  it("sem a rota no servidor: aviso discreto e sem botão de rastreio; o Fechar continua", async () => {
    rastreio.valor = rastreioParado({ indisponivel: true, aviso: "Rastreio do trajeto ainda não está ligado no servidor." });
    const { onFechar } = renderizar();
    expect(await screen.findByTestId("diario-rastreio-indisponivel")).toHaveTextContent("Rastreio do trajeto ainda não está ligado no servidor.");
    expect(screen.queryByTestId("diario-rastreio-botao")).toBeNull();
    fireEvent.click(screen.getByTestId("diario-fechar"));
    expect(onFechar).toHaveBeenCalled();
  });
});
