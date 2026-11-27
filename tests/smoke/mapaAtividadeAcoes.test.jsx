/**
 * MAIKE-MAPA-ATIVIDADE-SEM-MENU (D-PROD-369) — nos Detalhes da área do Mapa, tocar na atividade em andamento abre direto o
 * Diário das atividades do pasto, já na atividade (sem menu por cima). Logo abaixo da linha, uma fileira discreta de ações
 * curtas abre as janelas antigas de UM lançamento, presas nesta área: "Só mão de obra" e "Só serviço de terceiro" (quando a
 * operação permite) e, só na atividade SEM máquina, "Só insumo" e "Finalizar". Sem permissão de lançar, a linha não é tocável.
 * As janelas são substituídas por marcadores com as props recebidas (o comportamento delas tem os próprios testes).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LINHA_MAO_OBRA, LINHA_PRODUTO } from "@/lib/atividadeLinhasRegras";
import { marcadorDaAbertura } from "@/lib/aberturaServicoRegras";

const TUDO = { ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true };
const atividades = vi.hoisted(() => ({
  acoes: /** @type {Record<string, boolean>} */ ({}),
  resumo: vi.fn(),
  tipos: vi.fn(),
  obter: vi.fn(),
  listar: vi.fn(),
  apontamentos: vi.fn(),
  concluir: vi.fn(),
}));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ...atividades.acoes, carregando: false, login: "operador", permissaoEfetiva: { is_admin: false } }),
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
  listarApontamentos: atividades.apontamentos,
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
vi.mock("@/components/mapa/detalhes-area/DiarioDoPasto", () => ({
  default: ({ area, atividade }) => <div data-testid="janela-diario" data-area={area?.id ?? ""} data-atividade={atividade?.id ?? ""} />,
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
    // Gradeação: operação COM máquina (exige_maquina); em andamento, com dia lançado.
    { atividade_id: "at-1", numero: "10", nome: "Gradeação · nov/26", tipo_atividade_id: "t-grad", tipo_atividade_nome: "Gradeação", status: "ABERTA", area_status: "EM_ANDAMENTO", area_planejada: "22.0000", area_executada: "12.0000", ultimo_dia: "2026-11-17", data_inicio: "2026-11-02", data_prevista_fim: "2026-11-30" },
    // Calagem: operação SEM máquina; em andamento, com dia lançado.
    { atividade_id: "at-2", numero: "11", nome: "Calagem · nov/26", tipo_atividade_id: "t-cal", tipo_atividade_nome: "Calagem", status: "ABERTA", area_status: "EM_ANDAMENTO", area_planejada: "22.0000", area_executada: "5.0000", ultimo_dia: "2026-11-17", data_inicio: "2026-11-02", data_prevista_fim: "2026-11-30" },
    // Planejada na área: a linha abre o Diário; sem ações secundárias (só se faz em andamento).
    { atividade_id: "at-3", numero: "12", nome: "Roçada · dez/26", tipo_atividade_id: "t-roc", tipo_atividade_nome: "Roçada", status: "ABERTA", area_status: "PLANEJADA", area_planejada: "22.0000", area_executada: "0.0000", ultimo_dia: null, data_inicio: "2026-12-01", data_prevista_fim: "2026-12-10" },
  ],
  custos: null,
};
const TIPOS = [
  { id: "t-grad", nome: "Gradeação", ativo: true, exige_maquina: true, permite_produto: true, permite_mao_obra: true, permite_servico: true },
  { id: "t-cal", nome: "Calagem", ativo: true, exige_maquina: false, permite_produto: true, permite_mao_obra: true, permite_servico: false },
  { id: "t-roc", nome: "Roçada", ativo: true, exige_maquina: false, permite_produto: false, permite_mao_obra: true, permite_servico: true },
];
/** O detalhe de cada atividade (a leitura inteira, `GET /atividades/:id`). */
const DETALHES = {
  "at-1": { id: "at-1", numero: "10", nome: "Gradeação · nov/26", tipo_atividade_id: "t-grad", tipo_atividade_nome: "Gradeação", status: "ABERTA", versao: 4, areas: [{ id: "aa-1", area_id: "area-A", status: "EM_ANDAMENTO", ordem: 1 }] },
  "at-2": { id: "at-2", numero: "11", nome: "Calagem · nov/26", tipo_atividade_id: "t-cal", tipo_atividade_nome: "Calagem", status: "ABERTA", versao: 4, areas: [{ id: "aa-2", area_id: "area-A", status: "EM_ANDAMENTO", ordem: 1 }] },
  "at-3": { id: "at-3", numero: "12", nome: "Roçada · dez/26", tipo_atividade_id: "t-roc", tipo_atividade_nome: "Roçada", status: "ABERTA", versao: 1, areas: [{ id: "aa-3", area_id: "area-A", status: "PLANEJADA", ordem: 1 }] },
};

/** Um apontamento confirmado com uma máquina aberta na observação (a frente aberta da atividade). */
const ap = (id, observacao) => ({ id, data_operacional: "2026-11-17", status: "CONFIRMADO", createdAt: "2026-11-17T09:00:00.000Z", observacao, produtos: [], maquinas: [], mao_obra: [], servicos: [] });
const FRENTE_ABERTA = [ap("a1", marcadorDaAbertura({ bemId: "bem-7", bemNome: "Trator 12", horimetro: "1000.0", responsavelId: "usr-3", responsavelNome: "João" }))];

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

/** Os rótulos da fileira de ações da linha (vazia = []). @param {string} id */
const acoesDaLinha = (id) => {
  const fileira = screen.queryByTestId(`area-atividade-${id}-acoes`);
  return fileira ? Array.from(fileira.querySelectorAll("button")).map((b) => b.textContent) : [];
};
/** Toca num dos botões da fileira da linha. @param {string} id @param {string} rotulo */
const tocarAcao = (id, rotulo) => fireEvent.click(/** @type {HTMLElement} */ (Array.from(screen.getByTestId(`area-atividade-${id}-acoes`).querySelectorAll("button")).find((b) => b.textContent === rotulo)));

beforeEach(() => {
  atividades.acoes = { ...TUDO };
  atividades.resumo.mockResolvedValue(RESUMO);
  atividades.tipos.mockResolvedValue(TIPOS);
  atividades.obter.mockImplementation(async (id) => ({ ...DETALHES[id] }));
  atividades.listar.mockResolvedValue({
    items: [
      { id: "at-1", versao: 3, andamento: { situacao: "EM_ANDAMENTO", ultimo_dia: "2026-11-17" }, custo_total: "100.00" },
      { id: "at-2", versao: 3, andamento: { situacao: "EM_ANDAMENTO", ultimo_dia: "2026-11-17" }, custo_total: "40.00" },
    ],
  });
  // Sem frente aberta por padrão (a atividade sem máquina fica "sem máquina"); a leitura é a da lista de apontamentos.
  atividades.apontamentos.mockResolvedValue({ items: [] });
  atividades.concluir.mockResolvedValue({ ...DETALHES["at-2"], status: "CONCLUIDA", versao: 5 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("D-PROD-369 — tocar na atividade abre o Diário direto", () => {
  it("tocar na linha abre o Diário das atividades do pasto, já na atividade, sem menu", async () => {
    const { invalidar } = renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    expect(linha.tagName).toBe("BUTTON");
    expect(linha).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(linha);
    const diario = await screen.findByTestId("janela-diario");
    // A atividade lida inteira (o detalhe + o andamento da lista, filtrada pela área) e o pasto dos Detalhes da área.
    expect(atividades.obter).toHaveBeenCalledWith("at-1");
    expect(atividades.listar).toHaveBeenCalledWith({ area_id: "area-A", status: "ABERTA" });
    expect(diario).toHaveAttribute("data-atividade", "at-1");
    expect(diario).toHaveAttribute("data-area", "area-A");
    // Sem menu por cima, sem a Nova realização e sem janela de um lançamento.
    expect(document.querySelectorAll("[role='menuitem']")).toHaveLength(0);
    expect(screen.queryByTestId("area-atividade-at-1-menu")).toBeNull();
    expect(screen.queryByTestId("janela-registro")).toBeNull();
    expect(screen.queryByTestId("janela-tipo")).toBeNull();
    expect(invalidar).not.toHaveBeenCalled();
  });

  it("a planejada também abre o Diário, sem ações secundárias", async () => {
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-3");
    fireEvent.click(linha);
    expect(await screen.findByTestId("janela-diario")).toHaveAttribute("data-atividade", "at-3");
    expect(screen.queryByTestId("area-atividade-at-3-acoes")).toBeNull();
  });

  it("sem permissão de lançar, a linha não é tocável e não tem ações (nem Finalizar sem editar)", async () => {
    atividades.acoes = { ...TUDO, lancarApontamento: false, editar: false };
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    expect(linha.tagName).toBe("DIV");
    expect(linha).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(linha);
    expect(atividades.obter).not.toHaveBeenCalled();
    expect(screen.queryByTestId("janela-diario")).toBeNull();
    await waitFor(() => expect(atividades.apontamentos).toHaveBeenCalled());
    expect(screen.queryByTestId("area-atividade-at-2-acoes")).toBeNull();
  });
});

describe("D-PROD-369 — as ações secundárias na fileira da linha", () => {
  it("atividade COM máquina: sem \"Só insumo\", \"Só máquina\" nem \"Finalizar\"; com \"Só mão de obra\" e \"Só serviço de terceiro\" (a operação permite)", async () => {
    renderizar();
    await waitFor(() => expect(acoesDaLinha("at-1")).toContain("Só mão de obra"));
    expect(acoesDaLinha("at-1")).toEqual(["Só mão de obra", "Só serviço de terceiro"]);
  });

  it("atividade SEM máquina (tipo sem exige_maquina e sem frentes): \"Só insumo\" e \"Finalizar\"", async () => {
    renderizar();
    await waitFor(() => expect(acoesDaLinha("at-2")).toContain("Finalizar"));
    // Na ordem: mão de obra, insumo; o serviço de terceiro não é permitido por este tipo; "Finalizar" por último.
    expect(acoesDaLinha("at-2")).toEqual(["Só mão de obra", "Só insumo", "Finalizar"]);
  });

  it("atividade SEM máquina COM frente aberta lida: sem \"Só insumo\" nem \"Finalizar\" (o Diário encerra)", async () => {
    atividades.apontamentos.mockResolvedValue({ items: FRENTE_ABERTA });
    renderizar();
    await waitFor(() => expect(screen.getByTestId("area-atividade-at-2")).toHaveTextContent("1 máquina em campo"));
    expect(acoesDaLinha("at-2")).toEqual(["Só mão de obra"]);
  });

  it("\"Só insumo\" abre a janela de UM lançamento de produtos presa nesta área (atividade sem máquina)", async () => {
    renderizar();
    await waitFor(() => expect(acoesDaLinha("at-2")).toContain("Só insumo"));
    tocarAcao("at-2", "Só insumo");
    const janela = await screen.findByTestId("janela-tipo");
    expect(janela).toHaveAttribute("data-atividade", "at-2");
    expect(janela).toHaveAttribute("data-tipo", LINHA_PRODUTO);
    expect(janela).toHaveAttribute("data-area", "aa-2");
    expect(screen.queryByTestId("janela-diario")).toBeNull();
  });

  it("\"Só mão de obra\" abre a janela de UM lançamento de mão de obra presa nesta área", async () => {
    renderizar();
    await waitFor(() => expect(acoesDaLinha("at-1")).toContain("Só mão de obra"));
    tocarAcao("at-1", "Só mão de obra");
    const janela = await screen.findByTestId("janela-tipo");
    expect(janela).toHaveAttribute("data-atividade", "at-1");
    expect(janela).toHaveAttribute("data-tipo", LINHA_MAO_OBRA);
    expect(janela).toHaveAttribute("data-area", "aa-1");
  });

  it("\"Finalizar\" (sem máquina) usa a versão do detalhe e relê o resumo da área", async () => {
    const { invalidar } = renderizar();
    await waitFor(() => expect(acoesDaLinha("at-2")).toContain("Finalizar"));
    tocarAcao("at-2", "Finalizar");
    const dialogo = await screen.findByTestId("dialogo-concluir");
    expect(dialogo).toHaveAttribute("data-versao", "4");
    fireEvent.click(dialogo);
    await waitFor(() => expect(atividades.concluir).toHaveBeenCalledWith("at-2", { versao: 4, data_conclusao: "2026-11-17" }));
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: ["atividades-da-area"] }));
    await waitFor(() => expect(screen.queryByTestId("dialogo-concluir")).toBeNull());
  });

  it("as ações secundárias ficam dentro da própria linha da atividade (sem menu por cima)", async () => {
    renderizar();
    await waitFor(() => expect(acoesDaLinha("at-2")).toContain("Só insumo"));
    const bloco = screen.getByTestId("area-atividade-at-2").parentElement;
    expect(bloco).toHaveClass("mk-da13-ativ");
    expect(bloco?.querySelector("[data-testid='area-atividade-at-2-acoes']")).not.toBeNull();
    expect(document.querySelectorAll("[role='menuitem']")).toHaveLength(0);
  });
});
