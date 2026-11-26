/**
 * MAIKE-MAPA-ATIVIDADE-ACOES (D-PROD-278) — nos Detalhes da área do Mapa, a atividade em andamento é tocável e abre as
 * ações rápidas do Lançamento de Atividades: "+ Lançar dia" (a Nova realização preenchida, `continuar`), "Só máquina /
 * mão de obra / insumo / serviço de terceiro" (a janela de um lançamento presa nesta área; só os que a operação permite)
 * e "Concluir". Sem permissão, a linha não é tocável. As janelas são substituídas por marcadores com as props recebidas
 * (o comportamento delas tem os próprios testes); a atividade inteira vem do detalhe + a linha da lista.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TUDO = { ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true };
const atividades = vi.hoisted(() => ({
  acoes: /** @type {Record<string, boolean>} */ ({}),
  resumo: vi.fn(),
  tipos: vi.fn(),
  obter: vi.fn(),
  listar: vi.fn(),
  concluir: vi.fn(),
}));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ...atividades.acoes, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-18" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "c-1", user: { id: "u-1" } }) }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  obterResumoDaArea: atividades.resumo,
  listarTiposAtividade: atividades.tipos,
  obterAtividade: atividades.obter,
  listarAtividades: atividades.listar,
  concluirAtividade: atividades.concluir,
}));
vi.mock("@/services/loteManejoService", () => ({ eventoMudancaFilaOffline: () => "offline-entity-queue-updated" }));
vi.mock("@/components/mapa/HistoricoAbateCurral", () => ({ default: () => null }));
// As janelas: marcadores com o que receberam.
vi.mock("@/components/lancamento-atividades/RegistroDeCampo", () => ({
  default: ({ continuar, area }) => (
    <div data-testid="janela-registro" data-continuar={continuar?.id ?? ""} data-area={area?.id ?? ""} data-andamento={continuar?.andamento?.situacao ?? ""} />
  ),
}));
vi.mock("@/components/lancamento-atividades/JanelaLancamentoPorTipo", async (importOriginal) => ({
  ...(await importOriginal()),
  default: ({ atividade, tipo, areaInicial }) => <div data-testid="janela-tipo" data-atividade={atividade?.id} data-tipo={tipo} data-area={areaInicial ?? ""} />,
}));
vi.mock("@/components/lancamento-atividades/DialogoConcluirServico", () => ({
  default: ({ item, onConcluir }) => (
    <button type="button" data-testid="dialogo-concluir" data-versao={item?.versao} onClick={() => void onConcluir("2026-11-17")}>
      Concluir agora
    </button>
  ),
}));

const { default: DetalhesArea } = await import("@/components/mapa/DetalhesArea");

const PASTO_A = { id: "area-A", nome: "PASTO A", tipo_cultura: "Pastagem" };
const RESUMO = {
  area_id: "area-A",
  mes: "2026-11",
  atividades: [
    // Gradeação: a operação não permite insumo nem serviço; a área está em andamento, com dia lançado.
    { atividade_id: "at-1", numero: "10", nome: "Gradeação · nov/26", tipo_atividade_id: "t-grad", tipo_atividade_nome: "Gradeação", status: "ABERTA", area_status: "EM_ANDAMENTO", area_planejada: "22.0000", area_executada: "12.0000", ultimo_dia: "2026-11-17", data_inicio: "2026-11-02", data_prevista_fim: "2026-11-30" },
    // Planejada na área: só "+ Lançar dia" (as janelas por tipo recusam a área que não está em andamento).
    { atividade_id: "at-3", numero: "12", nome: "Roçada · dez/26", tipo_atividade_id: "t-roc", tipo_atividade_nome: "Roçada", status: "ABERTA", area_status: "PLANEJADA", area_planejada: "22.0000", area_executada: "0.0000", ultimo_dia: null, data_inicio: "2026-12-01", data_prevista_fim: "2026-12-10" },
  ],
  custos: null,
};
const TIPOS = [
  { id: "t-grad", nome: "Gradeação", ativo: true, permite_produto: false, permite_mao_obra: true, permite_servico: false },
  { id: "t-roc", nome: "Roçada", ativo: true, permite_produto: false, permite_mao_obra: true, permite_servico: true },
];
const DETALHE = {
  id: "at-1",
  numero: "10",
  nome: "Gradeação · nov/26",
  tipo_atividade_id: "t-grad",
  tipo_atividade_nome: "Gradeação",
  status: "ABERTA",
  versao: 4,
  areas: [
    { id: "aa-9", area_id: "area-Z", status: "EM_ANDAMENTO", ordem: 1 },
    { id: "aa-1", area_id: "area-A", status: "EM_ANDAMENTO", ordem: 2 },
  ],
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <DetalhesArea area={PASTO_A} permissions={{}} />
    </QueryClientProvider>,
  );
  // D-PROD-289: as atividades ficam na aba Manejos.
  fireEvent.click(screen.getByRole("tab", { name: "Manejos" }));
  return { invalidar };
};

/** Toca a linha e devolve os rótulos do menu. @param {string} id */
const abrirMenu = async (id) => {
  fireEvent.click(await screen.findByTestId(`area-atividade-${id}`));
  const menu = await screen.findByTestId(`area-atividade-${id}-menu`);
  return { menu, rotulos: Array.from(menu.querySelectorAll("[role='menuitem']")).map((b) => b.textContent) };
};

/** @param {string} id */
const rotulosDoMenu = (id) => Array.from(screen.getByTestId(`area-atividade-${id}-menu`).querySelectorAll("[role='menuitem']")).map((b) => b.textContent);
/** @param {string} id @param {string} rotulo */
const clicarItem = (id, rotulo) =>
  fireEvent.click(/** @type {HTMLElement} */ (Array.from(screen.getByTestId(`area-atividade-${id}-menu`).querySelectorAll("[role='menuitem']")).find((b) => b.textContent === rotulo)));

beforeEach(() => {
  atividades.acoes = { ...TUDO };
  atividades.resumo.mockResolvedValue(RESUMO);
  atividades.tipos.mockResolvedValue(TIPOS);
  atividades.obter.mockResolvedValue(DETALHE);
  atividades.listar.mockResolvedValue({ items: [{ ...DETALHE, versao: 3, andamento: { situacao: "EM_ANDAMENTO", ultimo_dia: "2026-11-17" }, custo_total: "100.00" }] });
  atividades.concluir.mockResolvedValue({ ...DETALHE, status: "CONCLUIDA", versao: 5 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("D-PROD-278 — ações da atividade nos Detalhes da área", () => {
  it("tocar a atividade abre o menu com as ações permitidas pela operação", async () => {
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    expect(linha.tagName).toBe("BUTTON");
    expect(linha).toHaveAttribute("aria-haspopup", "menu");
    await abrirMenu("at-1");
    // As operações chegam junto com o resumo: o menu aberto acompanha.
    // D-PROD-314: o "Diário das atividades" entra logo depois do "+ Lançamento" numa atividade em andamento no pasto.
    await waitFor(() => expect(rotulosDoMenu("at-1")).toEqual(["+ Lançamento", "Diário das atividades", "Só máquina", "Só mão de obra", "Finalizar"]));
    expect(rotulosDoMenu("at-1")).not.toContain("Abrir atividade");
  });

  it("área planejada na atividade: só o \"+ Lançar dia\"", async () => {
    renderizar();
    const { rotulos } = await abrirMenu("at-3");
    expect(rotulos).toEqual(["+ Lançamento"]);
  });

  it("\"+ Lançar dia\" lê a atividade inteira e abre a Nova realização preenchida (continuar)", async () => {
    const { invalidar } = renderizar();
    await abrirMenu("at-1");
    clicarItem("at-1", "+ Lançamento");
    const janela = await screen.findByTestId("janela-registro");
    expect(atividades.obter).toHaveBeenCalledWith("at-1");
    expect(atividades.listar).toHaveBeenCalledWith({ area_id: "area-A", status: "ABERTA" });
    expect(janela).toHaveAttribute("data-continuar", "at-1");
    // O andamento vem da linha da lista; a área não vem presa (o "+ Lançar dia" traz as áreas do serviço).
    expect(janela).toHaveAttribute("data-andamento", "EM_ANDAMENTO");
    expect(janela).toHaveAttribute("data-area", "");
    expect(invalidar).not.toHaveBeenCalled();
  });

  it("\"Só máquina\" abre a janela do lançamento presa nesta área", async () => {
    renderizar();
    await abrirMenu("at-1");
    await waitFor(() => expect(rotulosDoMenu("at-1")).toContain("Só mão de obra"));
    clicarItem("at-1", "Só máquina");
    const janela = await screen.findByTestId("janela-tipo");
    expect(janela).toHaveAttribute("data-atividade", "at-1");
    expect(janela).toHaveAttribute("data-tipo", "maquinas");
    // A área da atividade (o vínculo) cuja área do mapa é a dos detalhes.
    expect(janela).toHaveAttribute("data-area", "aa-1");
  });

  it("\"Concluir\" usa a versão do detalhe e relê o resumo da área", async () => {
    const { invalidar } = renderizar();
    await abrirMenu("at-1");
    clicarItem("at-1", "Finalizar");
    const dialogo = await screen.findByTestId("dialogo-concluir");
    expect(dialogo).toHaveAttribute("data-versao", "4");
    fireEvent.click(dialogo);
    await waitFor(() => expect(atividades.concluir).toHaveBeenCalledWith("at-1", { versao: 4, data_conclusao: "2026-11-17" }));
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: ["atividades-da-area"] }));
    await waitFor(() => expect(screen.queryByTestId("dialogo-concluir")).toBeNull());
  });

  it("sem permissão de lançar nem de concluir, a linha não é tocável", async () => {
    atividades.acoes = { ...TUDO, lancarApontamento: false, editar: false };
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    expect(linha.tagName).toBe("DIV");
    expect(linha).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(linha);
    expect(screen.queryByTestId("area-atividade-at-1-menu")).toBeNull();
    expect(atividades.obter).not.toHaveBeenCalled();
  });
});
