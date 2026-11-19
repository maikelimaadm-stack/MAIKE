/**
 * Detalhes da área acessíveis pelo contorno no Mapa Geral (D-PROD-94a, D-PROD-220, D-PROD-254), no desenho do Detalhes do
 * Lote: abas Detalhes · Histórico (os REGISTROS de campo da área), o cartão da área, as atividades em andamento e os custos
 * do mês (números do servidor), o rodapé com "Manejos" (abre o formulário "Registrar serviço" com a área presa, D-PROD-258) e
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
  useAcoesTelaAtividades: () => ({ ...atividades.acoes, carregando: false, login: "operador" }),
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
  it("o painel é o do lote: título e setor, abas Detalhes · Histórico, cartão da área, atividades e custos do servidor, rodapé Manejos", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" ocupada />);
    expect(screen.getByRole("heading", { name: "P1 — PASTO 01" })).toBeTruthy();
    expect(screen.getByText("RETIRO")).toBeTruthy();
    expect(document.querySelector(".mk-dp .mk-dp__corpo--cards")).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Histórico"]);
    expect(screen.getByRole("tab", { name: "Detalhes" }).getAttribute("aria-selected")).toBe("true");
    // O cartão da área.
    const corpo = document.querySelector(".mk-dp-area-organizada");
    expect(corpo.textContent).toMatch(/Área \(ha\).*22,00/);
    expect(corpo.textContent).toContain("PASTO");
    expect(corpo.textContent).toContain("BRACHIARIA");
    expect(corpo.textContent).toContain("OCUPADO");
    // As atividades (nome, feito/previsto, situação) e os custos (os números do servidor, só formatados).
    expect(await screen.findByText("Atividades em andamento")).toBeTruthy();
    expect(screen.getByText("Gradeação · nov/26")).toBeTruthy();
    expect(screen.getByText("Feito 12 de 22 ha · até 30/11/2026")).toBeTruthy();
    expect(screen.getByText("Em andamento")).toBeTruthy();
    expect(screen.getByText("Concluída")).toBeTruthy();
    expect(screen.getByText("Feito 0 de 22 ha · previsto 10/12/2026")).toBeTruthy();
    expect(screen.getByText("Planejada")).toBeTruthy();
    expect(screen.getByText("Custos da área · nov/26")).toBeTruthy();
    const custos = { textContent: screen.getByText("Custos da área · nov/26").closest("section").textContent.replace(/\u00a0/g, " ") };
    expect(custos.textContent).toContain("R$ 3.480,00");
    expect(custos.textContent).toContain("R$ 158,18");
    expect(custos.textContent).toContain("R$ 1.920,00");
    expect(custos.textContent).toContain("R$ 1.560,00");
    // Rodapé: Manejos + o Histórico completo (movimentação) que já existia.
    const rodape = screen.getByRole("group", { name: "Ações da área" });
    expect([...rodape.querySelectorAll(".mk-dp-pilula")].map((b) => b.textContent)).toEqual(["Manejos", "Histórico completo"]);
    expect(atividades.resumo).toHaveBeenCalledWith("area-A");
  });

  it("aba Histórico: os registros de campo da área na linha do tempo, com o filtro Todos; não é o histórico de movimentação", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" />);
    fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
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

  it("aba Histórico vazia: vazio verdadeiro, não erro; erro do servidor: Tentar novamente", async () => {
    atividades.registros.mockImplementation(async () => ({ items: [], next_cursor: null }));
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Nenhum registro de campo nesta área.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    atividades.registros.mockImplementation(async () => {
      throw Object.assign(new Error("x"), { code: "PROVIDER_UNAVAILABLE" });
    });
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(await screen.findByText("Não foi possível carregar o histórico.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  it("sem a permissão de ver atividades: só o cartão da área (sem aba Histórico, atividades, custos nem Manejos); o histórico completo segue", async () => {
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
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Histórico"]);
    expect(screen.queryByRole("button", { name: "Manejos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
  });

  it("sem permissão de histórico de movimentação e sem forragem: abre mesmo assim; sem a pílula Histórico completo", () => {
    renderizar(<DetalhesArea area={PASTO} permissions={NEGA} />);
    expect(screen.getByRole("heading", { name: "P1 — PASTO 01" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Histórico completo" })).toBeNull();
    expect(screen.queryByTestId("painel-forragem")).toBeNull();
  });

  it("forragem (D-PROD-219) continua no Detalhes: o painel Forragem com a chave medir_forragem", () => {
    renderizar(<DetalhesArea area={PASTO} permissions={MAPA_GERAL_ACESSO_TOTAL} />);
    expect(screen.getByTestId("painel-forragem")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
  });
});

describe("DetalhesArea — Manejos abre o MESMO formulário \"Registrar serviço\" (D-PROD-258)", () => {
  const abrirManejos = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Manejos" }));
    return screen.findByTestId("janela-registro-de-campo");
  };
  /** Escolhe uma opção num campo de lista da janela. */
  const escolher = async (janela, campo, opcao) => {
    fireEvent.click(within(janela).getByRole("combobox", { name: campo }));
    fireEvent.click(await screen.findByRole("option", { name: opcao }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  };
  const opcoesDe = async (janela, campo) => {
    fireEvent.click(within(janela).getByRole("combobox", { name: campo }));
    const nomes = (await screen.findAllByRole("option")).map((o) => o.textContent.trim());
    fireEvent.click(within(janela).getByRole("combobox", { name: campo }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    return nomes;
  };

  it("Manejos abre direto o formulário (sem a tela empilhada de tipos), com a ÁREA presa e o tipo e a operação para escolher", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} setorNome="RETIRO" />);
    const janela = await abrirManejos();
    expect(document.querySelector(".mk-dp-cab__titulo")?.textContent).not.toBe("Manejos");
    expect(document.querySelectorAll('[data-testid="janela-registro-de-campo"]').length).toBe(1);
    expect(within(janela).getByText("Registrar serviço")).toBeTruthy();
    // Área presa (só leitura), com os hectares.
    const area = within(janela).getByDisplayValue(/P1 — PASTO 01/i);
    expect(area.hasAttribute("readonly") || area.hasAttribute("disabled")).toBe(true);
    // Data = hoje na fazenda.
    expect(within(janela).getByTestId("registro-de-campo-data").value).toBe("2026-11-18");
    expect(within(janela).getByRole("combobox", { name: /^Tipo/ })).toBeTruthy();
    expect(within(janela).getByRole("combobox", { name: /Operação/ })).toBeTruthy();
    expect(within(janela).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(within(janela).getByRole("button", { name: "Salvar" })).toBeTruthy();
  });

  it("as QUATRO seções (Máquinas, Insumos, Mão de obra, Serviço de terceiro) aparecem sempre, antes e depois de escolher tipo e operação", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    const secoes = () => [...janela.querySelectorAll(".mg-b1-secao, [data-secao], h3, h4, legend")].map((n) => n.textContent.trim());
    for (const titulo of ["Máquinas", "Insumos", "Mão de obra", "Serviço de terceiro"]) {
      expect(secoes()).toContain(titulo);
    }
    await escolher(janela, /^Tipo/, "Roçada e tratos");
    await escolher(janela, /Operação/, "Roçada");
    for (const titulo of ["Máquinas", "Insumos", "Mão de obra", "Serviço de terceiro"]) {
      expect(secoes()).toContain(titulo);
    }
    expect(janela.textContent).toContain("Hectares feitos");
    expect(janela.textContent).toContain("Operador");
  });

  it("as quatro seções são opcionais: nenhum campo-chave (Máquina, Produto, Funcionário, Serviço) leva asterisco de obrigatório", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    const rotulos = [...janela.querySelectorAll(".mg-field__label")].map((el) => el.textContent.trim());
    for (const chave of ["Máquina", "Produto", "Funcionário ou terceiro", "Serviço"]) {
      const achado = rotulos.filter((r) => r.replace(/\s*\*\s*$/, "") === chave);
      expect(achado.length, chave).toBeGreaterThan(0);
      expect(achado.some((r) => r.endsWith("*")), `${chave} não deve ser obrigatório`).toBe(false);
    }
    // Tipo e Operação, sim, são obrigatórios.
    expect(rotulos.some((r) => /^Tipo\s*\*$/.test(r))).toBe(true);
  });

  it("a operação é filtrada pelo tipo escolhido: ativas, sem Abastecimento nem inativas; tipo sem operação avisa", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    expect(await opcoesDe(janela, /^Tipo/)).toEqual([
      "Preparo do solo",
      "Formação de pastagem (plantio)",
      "Fertilização",
      "Aplicação",
      "Roçada e tratos",
      "Manutenção",
      "Outros",
    ]);
    await escolher(janela, /^Tipo/, "Preparo do solo");
    expect(await opcoesDe(janela, /Operação/)).toEqual(["Gradeação"]);
    await escolher(janela, /^Tipo/, "Aplicação");
    expect(await opcoesDe(janela, /Operação/)).toEqual(["Aplicação / Pulverização"]);
    // Abastecimento (categoria OUTROS no cadastro) nunca é oferecido; o desativado também não.
    await escolher(janela, /^Tipo/, "Outros");
    expect(within(janela).getByTestId("registro-de-campo-sem-operacao").textContent).toContain("Nenhuma operação ativa neste tipo");
    await escolher(janela, /^Tipo/, "Aplicação");
    expect(within(janela).queryByTestId("registro-de-campo-sem-operacao")).toBeNull();
  });

  it("trocar o tipo limpa a operação escolhida", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    await escolher(janela, /^Tipo/, "Preparo do solo");
    await escolher(janela, /Operação/, "Gradeação");
    expect(within(janela).getByRole("combobox", { name: /Operação/ }).textContent).toContain("Gradeação");
    await escolher(janela, /^Tipo/, "Aplicação");
    expect(within(janela).getByRole("combobox", { name: /Operação/ }).textContent).not.toContain("Gradeação");
  });

  it("escolhida a operação, o destino do registro aparece (Gradeação já aberta no mês: entra nela)", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    await escolher(janela, /^Tipo/, "Preparo do solo");
    await escolher(janela, /Operação/, "Gradeação");
    expect((await within(janela).findByTestId("registro-de-campo-destino")).textContent).toBe("Entra em Gradeação · nov/26");
  });

  it("Salvar manda UM registro com a área e a operação (o servidor acha ou abre a atividade) e fecha a janela", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    await escolher(janela, /^Tipo/, "Roçada e tratos");
    await escolher(janela, /Operação/, "Roçada");
    fireEvent.change(within(janela).getByTestId("registro-de-campo-hectares"), { target: { value: "7" } });
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(atividades.registrar).toHaveBeenCalledTimes(1));
    const [corpo] = atividades.registrar.mock.calls[0];
    expect(corpo).toMatchObject({ area_id: "area-A", tipo_atividade_id: "t-roc", data_operacional: "2026-11-18", area_executada_dia: "7" });
    expect(corpo.maquinas).toBeUndefined();
    expect(corpo.produtos).toBeUndefined();
    expect(corpo.mao_obra).toBeUndefined();
    expect(corpo.servicos).toBeUndefined();
    await waitFor(() => expect(screen.queryByTestId("janela-registro-de-campo")).toBeNull());
    expect(screen.getByRole("tab", { name: "Detalhes" })).toBeTruthy();
  });

  it("sem tipo e sem operação, não grava e aponta os dois campos", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    // Salvar só habilita com tipo e operação; o Enter no formulário aponta o que falta.
    expect(within(janela).getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.submit(within(janela).getByTestId("registro-de-campo-form"));
    expect(await within(janela).findByText("Escolha o tipo.")).toBeTruthy();
    expect(within(janela).getByText("Escolha a operação.")).toBeTruthy();
    expect(atividades.registrar).not.toHaveBeenCalled();
  });

  it("operação que exige máquina (cadastro antigo): sem escolher a máquina, não grava e aponta o campo", async () => {
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    const janela = await abrirManejos();
    await escolher(janela, /^Tipo/, "Preparo do solo");
    await escolher(janela, /Operação/, "Gradeação");
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    expect(await within(janela).findByText("Escolha a máquina.")).toBeTruthy();
    expect(atividades.registrar).not.toHaveBeenCalled();
  });

  it("sem a permissão de lançar atividade, o botão Manejos não existe", async () => {
    atividades.acoes = { ...atividades.acoes, lancarApontamento: false };
    renderizar(<DetalhesArea area={PASTO} permissions={PERMITE} />);
    expect(screen.queryByRole("button", { name: "Manejos" })).toBeNull();
  });
});

describe("Registrar serviço (a pessoa escolhe a área) — mesmo formulário", () => {
  it("o formulário genérico escolhe área, tipo e operação e não oferece Abastecimento — é da máquina", async () => {
    const { default: JanelaRegistroDeCampo } = await import("@/components/lancamento-atividades/RegistroDeCampo");
    renderizar(<JanelaRegistroDeCampo tipos={TIPOS} areas={[PASTO]} onFechar={() => {}} />);
    const janela = await screen.findByTestId("janela-registro-de-campo");
    for (const campo of [/^Área/, /^Tipo/, /Operação/]) expect(within(janela).getByRole("combobox", { name: campo })).toBeTruthy();
    fireEvent.click(within(janela).getByRole("combobox", { name: /^Tipo/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Outros" }));
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    fireEvent.click(within(janela).getByRole("combobox", { name: /Operação/ }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(janela.textContent).not.toContain("Abastecimento");
  });
});

describe("DetalhesArea — curral e histórico completo", () => {
  it("T07: curral tem Detalhes · Histórico · Abate, e o Abate segue sendo o histórico de abate de hoje", async () => {
    renderizar(<DetalhesArea area={CURRAL} permissions={PERMITE} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Detalhes", "Histórico", "Abate"]);
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
