/**
 * Detalhes da área acessíveis pelo contorno no Mapa Geral (D-PROD-94a, D-PROD-220, D-PROD-254), no desenho do Detalhes do
 * Lote: abas Detalhes · Histórico (os REGISTROS de campo da área), o cartão da área, as atividades em andamento e os custos
 * do mês (números do servidor), o rodapé com "Manejos" (abre o Diário das atividades do pasto, D-PROD-339) e
 * "Histórico completo" (o Histórico de Movimentação de hoje, com o "Excluir movimentação" do administrador, D-PROD-110).
 * Curral mantém a aba Abate. Testes de componente (mock de serviço).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { acaoDoCliqueNaArea, ehCurral, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import { MAPA_GERAL_ACESSO_TOTAL } from "@/lib/mapaGeralPermissions";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  cancelarMovimentacaoMapa: vi.fn(),
  consultarCancelamentoMovimentacao: vi.fn(),
  // "Excluir movimentação" (D-PROD-110) do Histórico completo da área.
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(),
  pendenciasOfflineDaMovimentacao: vi.fn(),
  eventoMudancaFilaOffline: () => "offline-entity-queue-updated",
}));
const sessao = vi.hoisted(() => ({ admin: false }));
// vi.fn: o teste do "Histórico completo fechado" confere as fontes que só ele lê.
const refreshMapaCacheEntry = vi.hoisted(() => vi.fn(async (chave) => (chave === "areas" ? [{ id: "area-A", nome: "PASTO A", empresa_id: "emp-1" }] : [])));
vi.mock("@/services/loteManejoService", () => servico);
// D-PROD-254: a sessão da tela de atividades (ações liberadas, fazenda, fuso) e o service das atividades.
const atividades = vi.hoisted(() => ({
  acoes: { ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true },
  resumo: vi.fn(),
  registros: vi.fn(),
  tipos: vi.fn(),
  registrar: vi.fn(),
}));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  // Diário da máquina (Fase 2): este painel mostra R$ para o administrador (a aba Custos é dele).
  useAcoesTelaAtividades: () => ({ ...atividades.acoes, permissaoEfetiva: { is_admin: true, modulos_permitidos: [], permissoes_telas: [] }, carregando: false, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-18" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "c-1", user: { id: "u-1" } }) }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  obterResumoDaArea: atividades.resumo,
  listarRegistrosDaArea: atividades.registros,
  listarTiposAtividade: atividades.tipos,
  registrarCampo: atividades.registrar,
  listarOpcoesOperadores: vi.fn(async () => ({ items: [], next_cursor: null })),
  // D-PROD-263: a janela aberta do mapa lê as áreas da fazenda para marcar mais de uma.
  listarAreasDaFazenda: vi.fn(async () => [
    { id: "area-A", nome: "P1 — PASTO 01", tipo_cultura: "Pastagem", tamanho_hectares: 22, ativo: true },
    { id: "area-B", nome: "P2 — PASTO 02", tipo_cultura: "Pastagem", tamanho_hectares: 10, ativo: true },
  ]),
}));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async () => [],
  getMapaCacheSnapshot: async () => ({ items: [], atualizadoEm: null }),
  refreshMapaCacheEntry,
}));
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1", administrador_fazenda: sessao.admin }),
  ehAdministrador: (u) => u?.administrador_fazenda === true,
}));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/mapa/HistoricoAbateCurral", () => ({
  default: ({ areaId }) => <div data-testid="abate-curral">Histórico de Abate {areaId}</div>,
}));

const { default: DetalhesArea } = await import("@/components/mapa/DetalhesArea");

const PASTO_A = { id: "area-A", nome: "PASTO A", tipo_cultura: "Pastagem" };
const RESERVA = { id: "area-R", nome: "RESERVA", tipo_cultura: "Reserva" };
const CURRAL = { id: "area-C", nome: "CURRAL", tipo_cultura: "Infraestrutura", tipo_infraestrutura: "Curral" };
const PERMITE = { visualizar_historico_movimentacoes_lote: true };
const NEGA = { visualizar_historico_movimentacoes_lote: false };

const saidaAntiga = {
  id: "mv-1",
  empresa_id: "emp-1",
  tipo: "Transferência de Área",
  lote: "NELORE 1",
  lote_id: "lote-que-saiu",
  quantidade_animais: 120,
  area_origem_id: "area-A",
  area_origem_nome: "PASTO A",
  area_destino_id: "area-B",
  area_destino_nome: "PASTO B",
  data_movimentacao: "2026-09-01T12:00:00.000Z",
  created_date: "2026-09-01T15:00:00.000Z",
};
const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });

const renderizar = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  sessao.admin = false;
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([]));
  servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({ elegivel: true, codigo: null, pode_excluir: true, efeitos: [] }));
  servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => []);
  servico.removerMovimentacaoExcluidaDoCacheOffline.mockImplementation(async () => 1);
});
afterEach(() => cleanup());

/** Movimento do ledger (a exclusão só vale para ele): a prova é o evento + a operação idempotente. */
const morteDoLedger = {
  id: "mv-m",
  empresa_id: "emp-1",
  tipo: "Morte",
  lote: "NELORE 1",
  lote_id: "lote-1",
  quantidade_animais: 1,
  area_origem_id: "area-A",
  area_origem_nome: "PASTO A",
  data_movimentacao: "2026-10-10T12:00:00.000Z",
  created_date: "2026-10-10T13:00:00.000Z",
  efeito_servidor: { comando: "rebanho_ledger", evento_id: "ev-1", operation_id: "manejo-x" },
};

const RESUMO = {
  area_id: "area-A",
  mes: "2026-11",
  atividades: [
    { atividade_id: "at-1", numero: "10", nome: "Gradeação · nov/26", tipo_atividade_id: "t-grad", tipo_atividade_nome: "Gradeação", status: "ABERTA", area_status: "EM_ANDAMENTO", area_planejada: "22.0000", area_executada: "12.0000", data_inicio: "2026-11-02", data_prevista_fim: "2026-11-30" },
    { atividade_id: "at-2", numero: "11", nome: "Aplicação / Pulverização · nov/26", tipo_atividade_id: "t-apl", tipo_atividade_nome: "Aplicação / Pulverização", status: "ABERTA", area_status: "CONCLUIDA", area_planejada: "22.0000", area_executada: "22.0000", data_inicio: "2026-11-03", data_prevista_fim: null },
    { atividade_id: "at-3", numero: "12", nome: "Roçada · dez/26", tipo_atividade_id: "t-roc", tipo_atividade_nome: "Roçada", status: "ABERTA", area_status: "PLANEJADA", area_planejada: "22.0000", area_executada: "0.0000", data_inicio: "2026-12-01", data_prevista_fim: "2026-12-10" },
  ],
  custos: { custo_total: "3480.00", custo_por_ha: "158.18", area_ha: "22.0000", insumos: "1920.00", maquinas: "1000.00", mao_obra: "560.00", servicos: "0.00" },
};
const REGISTROS = {
  items: [
    { id: "ap-2", data_operacional: "2026-11-17", atividade_id: "at-1", atividade_nome: "Gradeação · nov/26", tipo_atividade_id: "t-grad", tipo_atividade_nome: "Gradeação", area_executada_dia: "7.0000", operador_nome: "José Silva", observacao: null, maquinas: [{ bem_nome: "Trator TP-02", implemento_nome: "Grade GR-01", quantidade_uso: "6.5000", unidade: "H" }], produtos: [], mao_obra: [], servicos: [] },
    { id: "ap-1", data_operacional: "2026-11-12", atividade_id: "at-2", atividade_nome: "Aplicação / Pulverização · nov/26", tipo_atividade_id: "t-apl", tipo_atividade_nome: "Aplicação / Pulverização", area_executada_dia: "22.0000", operador_nome: "Pedro Rocha", observacao: null, maquinas: [{ bem_nome: "Pulverizador PL-01", implemento_nome: null, quantidade_uso: "3.0000", unidade: "H" }], produtos: [{ produto_nome: "Glifosato", quantidade: "44.0000", unidade: "L", dose_ha: "2.0000" }], mao_obra: [], servicos: [] },
  ],
  next_cursor: null,
};
const TIPOS = [
  { id: "t-aba", nome_tipo: "Abastecimento", categoria: "OUTROS", ativo: true },
  { id: "t-grad", nome_tipo: "Gradeação", categoria: "PREPARO_SOLO", ativo: true, exige_maquina: true, permite_implemento: true },
  { id: "t-apl", nome_tipo: "Aplicação / Pulverização", categoria: "APLICACAO", ativo: true, permite_produto: true },
  { id: "t-roc", nome_tipo: "Roçada", categoria: "PASTAGEM", ativo: true },
  { id: "t-velho", nome_tipo: "Tipo Desativado", categoria: "OUTROS", ativo: false },
];

const PASTO = { id: "area-A", nome: "P1 — PASTO 01", tipo_cultura: "Pastagem", tipo_pastagem: "BRACHIARIA", tamanho_hectares: 22 };

beforeEach(() => {
  atividades.acoes = { ver: true, criar: true, editar: true, cancelar: true, reabrir: true, lancarApontamento: true, editarApontamento: true, cancelarApontamento: true };
  atividades.resumo.mockImplementation(async () => RESUMO);
  atividades.registros.mockImplementation(async () => REGISTROS);
  atividades.tipos.mockImplementation(async () => TIPOS);
  atividades.registrar.mockImplementation(async () => ({ apontamento: { id: "ap-9" }, atividade: { id: "at-9" }, alertas: [], registro: { atividade_criada: true } }));
});

describe("política do clique na área", () => {
  it("T08: selecionando local de tarefa, o clique escolhe o local e nunca abre detalhes", () => {
    for (const area of [PASTO_A, CURRAL]) {
      expect(acaoDoCliqueNaArea({ area, selecionandoLocalTarefa: true, toqueLongoAcabouDeDisparar: false, permissoes: PERMITE })).toBe("selecionar-local");
    }
  });

  it("clique que encerra um toque longo (lançamento de tarefa) não abre detalhes", () => {
    expect(acaoDoCliqueNaArea({ area: PASTO_A, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: true, permissoes: PERMITE })).toBe("ignorar");
  });

  it("T04/T05: pasto, reserva, curral abrem detalhes", () => {
    for (const area of [PASTO_A, RESERVA, CURRAL]) {
      expect(acaoDoCliqueNaArea({ area, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: false, permissoes: PERMITE })).toBe("abrir-detalhes");
    }
  });

  it("D-PROD-254: quem vê áreas abre os detalhes mesmo sem histórico de movimentação nem forragem; sem visualizar_areas, nada", () => {
    const clique = (permissoes, area = PASTO_A) => acaoDoCliqueNaArea({ area, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: false, permissoes });
    expect(clique(NEGA)).toBe("abrir-detalhes");
    expect(clique({ visualizar_areas: true, visualizar_historico_movimentacoes_lote: false, medir_forragem: false })).toBe("abrir-detalhes");
    expect(clique({ visualizar_areas: false })).toBe("ignorar");
    expect(clique(undefined)).toBe("abrir-detalhes");
    expect(clique(NEGA, CURRAL)).toBe("abrir-detalhes");
    expect(podeVerHistoricoDaArea(undefined)).toBe(true);
    expect(ehCurral(CURRAL)).toBe(true);
    expect(ehCurral(PASTO_A)).toBe(false);
  });
});

describe("DetalhesArea — Detalhes e Histórico", () => {
  it("o painel é o do lote: título e setor, abas Detalhes · Manejos · Custos (D-PROD-289), cartão da área, resumo, atividades e custos do servidor, rodapé Manejos", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" ocupada />);
    expect(screen.getByRole("heading", { name: "P1 — PASTO 01" })).toBeTruthy();
    expect(screen.getByText("RETIRO")).toBeTruthy();
    expect(document.querySelector(".mk-dp .mk-dp__corpo--cards")).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Manejos", "Custos"]);
    expect(screen.getByRole("tab", { name: "Detalhes" }).getAttribute("aria-selected")).toBe("true");
    // O cartão da área.
    const corpo = document.querySelector(".mk-dp-area-organizada");
    expect(corpo.textContent).toMatch(/Área \(ha\).*22,00/);
    expect(corpo.textContent).toContain("PASTO");
    expect(corpo.textContent).toContain("BRACHIARIA");
    expect(corpo.textContent).toContain("OCUPADO");
    // D-PROD-289: o resumo de uma linha leva à aba.
    const resumoManejos = await screen.findByTestId("area-resumo-manejos");
    expect(resumoManejos.textContent).toContain("1 em andamento · 1 planejado");
    expect(screen.getByTestId("area-resumo-custos").textContent.replace(/\u00a0/g, " ")).toContain("R$ 3.480,00");
    // As atividades (nome, feito/previsto, situação) na aba Manejos.
    fireEvent.click(resumoManejos);
    expect(await screen.findByText("Em andamento e planejado")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Manejos" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Gradeação · nov/26")).toBeTruthy();
    expect(screen.getByText("Feito 12 de 22 ha · até 30/11/2026")).toBeTruthy();
    expect(screen.getByText("Em andamento")).toBeTruthy();
    expect(screen.getByText("Finalizada")).toBeTruthy();
    expect(screen.getByText("Feito 0 de 22 ha · previsto 10/12/2026")).toBeTruthy();
    expect(screen.getByText("Planejada")).toBeTruthy();
    expect(document.querySelectorAll(".mk-da13-prog").length).toBe(3);
    // Os custos (os números do servidor, só formatados) na aba Custos.
    fireEvent.click(screen.getByRole("tab", { name: "Custos" }));
    expect(await screen.findByText("Custos da área · nov/26")).toBeTruthy();
    const custos = { textContent: screen.getByText("Custos da área · nov/26").closest("section").textContent.replace(/\u00a0/g, " ") };
    expect(custos.textContent).toContain("R$ 3.480,00");
    expect(custos.textContent).toContain("R$ 158,18");
    expect(custos.textContent).toContain("R$ 1.920,00");
    expect(custos.textContent).toContain("R$ 1.560,00");
    expect(custos.textContent).toContain("55%");
    // Rodapé: Manejos + o Histórico completo (movimentação) que já existia.
    const rodape = screen.getByRole("group", { name: "Ações da área" });
    expect([...rodape.querySelectorAll(".mk-dp-pilula")].map((b) => b.textContent)).toEqual(["Manejos", "Histórico completo"]);
    expect(atividades.resumo).toHaveBeenCalledWith("area-A");
  });

  it("aba Manejos (Já feito): os registros de campo da área na linha do tempo, com o filtro Todos; não é o histórico de movimentação", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" />);
    fireEvent.click(screen.getByRole("tab", { name: "Manejos" }));
    const linha = await screen.findByRole("list", { name: "Registros de campo da área" });
    expect(linha.textContent).toContain("17 NOV. 2026");
    expect(linha.textContent).toContain("12 NOV. 2026");
    expect(linha.textContent).toMatch(/Gradeação.*Máquina.*Trator TP-02.*Implemento.*Grade GR-01.*Horas.*6,5 h.*Feito.*7 ha.*Operador.*José Silva/);
    expect(linha.textContent).toMatch(/Aplicação \/ Pulverização.*Produto.*Glifosato · 44 L/);
    expect(screen.getByRole("button", { name: "Mostrar: Todos" })).toBeTruthy();
    expect(screen.getByText("Registros de todos os manejos de campo feitos nesta área.")).toBeTruthy();
    expect(atividades.registros).toHaveBeenCalledWith("area-A", expect.objectContaining({ tipo_atividade_id: null }));
    // Nada da movimentação de animais aqui.
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
  });

  it("aba Manejos sem registros: vazio verdadeiro, não erro; erro do servidor: Tentar novamente", async () => {
    atividades.registros.mockImplementation(async () => ({ items: [], next_cursor: null }));
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    fireEvent.click(screen.getByRole("tab", { name: "Manejos" }));
    expect(await screen.findByText("Nenhum registro de campo nesta área.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    atividades.registros.mockImplementation(async () => {
      throw Object.assign(new Error("x"), { code: "PROVIDER_UNAVAILABLE" });
    });
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    fireEvent.click(screen.getByRole("tab", { name: "Manejos" }));
    expect(await screen.findByText("Não foi possível carregar o histórico.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  it("sem a permissão de ver atividades: só o cartão da área (sem abas Manejos/Custos, atividades, custos nem Manejos); o histórico completo segue", async () => {
    atividades.acoes = { ...atividades.acoes, ver: false, lancarApontamento: false };
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("heading", { name: "P1 — PASTO 01" })).toBeTruthy();
    expect(document.querySelector(".mk-dp-area-organizada").textContent).toContain("BRACHIARIA");
    expect(screen.queryByText("Atividades em andamento")).toBeNull();
    expect(screen.queryByRole("button", { name: "Manejos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
    expect(atividades.resumo).not.toHaveBeenCalled();
    expect(atividades.tipos).not.toHaveBeenCalled();
  });

  it("ver sem lançar: abas e histórico, sem a pílula Manejos", async () => {
    atividades.acoes = { ...atividades.acoes, lancarApontamento: false };
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Manejos", "Custos"]);
    expect(screen.queryByRole("button", { name: "Manejos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
  });

  it("sem permissão de histórico de movimentação e sem forragem: abre mesmo assim; sem a pílula Histórico completo", () => {
    renderizar(<DetalhesArea area={PASTO} permissions={NEGA} />);
    expect(screen.getByRole("heading", { name: "P1 — PASTO 01" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Histórico completo" })).toBeNull();
    expect(screen.queryByTestId("painel-forragem")).toBeNull();
  });

  it("forragem (D-PROD-219): com a chave medir_forragem, aba própria Forragem (D-PROD-289) com o painel de antes", () => {
    renderizar(<DetalhesArea area={PASTO} permissions={MAPA_GERAL_ACESSO_TOTAL} />);
    expect(screen.queryByTestId("painel-forragem")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Forragem" }));
    expect(screen.getByTestId("painel-forragem")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
  });
});

describe("DetalhesArea — Manejos abre o Diário das atividades do pasto (D-PROD-339: uma entrada só)", () => {
  it("a pílula Manejos abre o Diário das atividades (não a Nova realização): sem atividade aberta no pasto, vai direto ao tipo", async () => {
    atividades.resumo.mockImplementation(async () => ({ ...RESUMO, atividades: [RESUMO.atividades[1]] }));
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" />);
    fireEvent.click(await screen.findByRole("button", { name: "Manejos" }));
    const diario = await screen.findByTestId("diario-atividades");
    expect(within(diario).getByTestId("diario-atividades-tipos")).toBeInTheDocument();
    expect(screen.queryByTestId("diario-atividades-escolher")).toBeNull();
    expect(screen.queryByTestId("janela-registro-de-campo")).toBeNull();
  });

  it("com atividades abertas no pasto, a pílula abre a lista \"Em andamento neste pasto\" (a concluída não entra)", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" />);
    fireEvent.click(await screen.findByRole("button", { name: "Manejos" }));
    expect(await screen.findByTestId("diario-atividades-escolher")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividades-titulo")).toHaveTextContent("Em andamento neste pasto");
    expect(screen.getByTestId("diario-atividade-aberta-at-1")).toBeInTheDocument();
    expect(screen.getByTestId("diario-atividade-aberta-at-3")).toBeInTheDocument();
    expect(screen.queryByTestId("diario-atividade-aberta-at-2")).toBeNull();
    expect(screen.queryByTestId("janela-registro-de-campo")).toBeNull();
  });

  it("sem a permissão de lançar atividade, o botão Manejos não existe", async () => {
    atividades.acoes = { ...atividades.acoes, lancarApontamento: false };
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    expect(screen.queryByRole("button", { name: "Manejos" })).toBeNull();
  });
});

describe("Nova realização (a pessoa escolhe a área) — mesmo formulário", () => {
  it("o formulário genérico escolhe tipo (cartão), área e operação e não oferece Abastecimento — é da máquina", async () => {
    const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");
    renderizar(<JanelaRegistroDeCampo tipos={TIPOS} areas={[PASTO]} onFechar={() => {}} />);
    const janela = await screen.findByTestId("janela-registro-de-campo");
    fireEvent.click(within(janela).getByRole("button", { name: "Outros" }));
    await within(janela).findByTestId("registro-de-campo-form");
    for (const campo of [/^Área/, /Operação/]) expect(within(janela).getByRole("combobox", { name: campo })).toBeTruthy();
    expect(within(janela).queryByRole("combobox", { name: /^Tipo/ })).toBeNull();
    fireEvent.click(within(janela).getByRole("combobox", { name: /Operação/ }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(janela.textContent).not.toContain("Abastecimento");
  });
});

describe("DetalhesArea — curral e histórico completo", () => {
  it("T07: curral tem Detalhes · Manejos · Custos · Abate, e o Abate segue sendo o histórico de abate de hoje", async () => {
    renderizar(<DetalhesArea area={CURRAL} permissions={PERMITE} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Manejos", "Custos", "Abate"]);
    fireEvent.click(screen.getByRole("tab", { name: "Abate" }));
    expect(screen.getByTestId("abate-curral").textContent).toContain("area-C");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Abate" }).id);
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
  });

  it("curral sem permissões de atividades: o cartão da área e o abate", () => {
    atividades.acoes = { ...atividades.acoes, ver: false, lancarApontamento: false };
    renderizar(<DetalhesArea area={CURRAL} permissions={NEGA} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Abate"]);
    expect(screen.queryByRole("button", { name: "Histórico completo" })).toBeNull();
  });

  it("A1/A2: 'Histórico completo' abre por cima o Histórico de Movimentação da área, com o 'Excluir movimentação' do administrador", async () => {
    sessao.admin = true;
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([morteDoLedger]));
    renderizar(<DetalhesArea area={RESERVA} permissions={PERMITE} setorNome="Retiro" />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo.querySelector(".mk-ll-dlg__titulo")?.textContent).toMatch(/^Histórico da Área/);
    expect(await within(dialogo).findByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
    // A consulta é a da área, sem lotes (área vazia não perde histórico).
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenLastCalledWith(expect.objectContaining({ areaId: "area-R" }));
  });

  it("A1: quem não é administrador vê o histórico completo, sem o 'Excluir movimentação'", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([morteDoLedger]));
    renderizar(<DetalhesArea area={RESERVA} permissions={PERMITE} />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByText("NELORE 1")).toBeTruthy();
    expect(within(dialogo).queryByRole("button", { name: "Excluir movimentação" })).toBeNull();
  });

  it("Histórico completo fechado: nada monta nem consulta; aberto, o histórico aparece por cima", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([saidaAntiga]));
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Entradas, saídas e manejos registrados nesta área");
    expect(refreshMapaCacheEntry.mock.calls.map(([chave]) => chave)).not.toContain("suplementacaoLote");
    fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByText("NELORE 1")).toBeTruthy();
    expect(dialogo.textContent).toContain("Entradas, saídas e manejos registrados nesta área");
    expect(refreshMapaCacheEntry.mock.calls.map(([chave]) => chave)).toContain("suplementacaoLote");
  });

  it("Histórico completo: ao fechar pelo ✕, o histórico e o título com a contagem ficam no diálogo até o fim da animação de saída", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([saidaAntiga]));
    // O jsdom não anima: simula a saída do app (data-state=closed). O Presence do Radix lê a
    // animação pelo getComputedStyle e só desmonta no animationend.
    const original = window.getComputedStyle;
    vi.stubGlobal("getComputedStyle", (el, ...resto) => {
      const estilo = original(el, ...resto);
      if (!el?.classList?.contains("mk-ll-dlg")) return estilo;
      return new Proxy(estilo, {
        get: (alvo, p) => (p === "animationName" ? (el.getAttribute("data-state") === "closed" ? "saida" : "entrada") : Reflect.get(alvo, p)),
      });
    });
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} />);
    fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
    const dialogo = await screen.findByRole("dialog");
    await within(dialogo).findByText("NELORE 1");
    const titulo = dialogo.querySelector(".mk-ll-dlg__titulo");
    expect(titulo?.textContent).toBe("Histórico da Área PASTO A (1)");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Fechar" }));
    expect(dialogo.getAttribute("data-state")).toBe("closed");
    expect(within(dialogo).getByText("NELORE 1")).toBeTruthy();
    expect(titulo?.textContent).toBe("Histórico da Área PASTO A (1)");
    const fim = new Event("animationend", { bubbles: true });
    Object.defineProperty(fim, "animationName", { value: "saida" });
    fireEvent(dialogo, fim);
    expect(dialogo.isConnected).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
