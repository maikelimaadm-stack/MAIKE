/**
 * D-PROD-249 — VÁRIAS ÁREAS POR ATIVIDADE (a tela). "Eu tenho uma atividade que é combate contra cigarrinha, e nessa
 * atividade são vários pastos que vou fazendo ao decorrer do tempo [...] cada custo e lançamento é feito para aquela
 * área." E o ciclo de cada área: "não vão aparecer as 5 áreas para mim como em andamento; eu vou escolher INICIAR a área."
 *
 * Cobre:
 *  - as regras puras (`atividadeAreasRegras`): a coluna "Área" da lista ("2 de 5 em andamento"), os contadores e os
 *    grupos do card (Em andamento, A iniciar, Concluídas), as linhas da abertura (a planejada padrão = o tamanho, o
 *    corpo `areas[]`, a área exigida pelo tipo), os números de cada área (`por_area`, só do servidor; sem valor, "—")
 *    e quem pode sair (só a não iniciada sem lançamento);
 *  - o campo "Áreas" da abertura (`SeletorAreasDaAtividade`): marcar põe a área na lista com Setor, Tamanho e a área
 *    planejada editável; ✕ tira; o total;
 *  - a tabela "Áreas da atividade" (`CardAreasDaAtividade`, uma só na D-PROD-252): todas as áreas, a situação de cada uma, os
 *    números do servidor, o ⚡ (Abrir área, Iniciar área com o diálogo da data → `POST …/areas/:id/iniciar`, Concluir…);
 *  - o Resumo das áreas e as regras da organização (D-PROD-252: `ResumoDasAreas`, `lancamentosDaAreaRegras`);
 *  - a porta: as allowlists das áreas iguais aos corpos fechados das rotas do servidor.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const notify = vi.hoisted(() => ({ notifyWarning: vi.fn(), notifySuccess: vi.fn(), notifyInfo: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/maikeNotify", async (importOriginal) => ({ ...(await importOriginal()), ...notify }));
vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ hoje: "2026-11-18", fuso: "America/Sao_Paulo", semFuso: false }),
}));
const servico = vi.hoisted(() => ({
  acaoAreaAtividade: vi.fn(),
  adicionarAreaAtividade: vi.fn(),
  editarAreaAtividade: vi.fn(),
  listarAreasDaFazenda: vi.fn(async () => []),
}));
vi.mock("@/services/lancamentoAtividadesService", () => servico);
vi.mock("@/hooks/usePatrimonioSessao", () => ({ useAcoesTelaAbastecimento: () => ({ ver: false, criar: false, login: "operador" }) }));

import {
  alternarAreaNaAbertura,
  contadoresDasAreas,
  corpoDasAreasDaAbertura,
  errosDasAreasDaAbertura,
  gruposDasAreas,
  linhaDaAreaParaExibir,
  podeRemoverArea,
  textoDaColunaArea,
  textoDosContadores,
  totaisDaAbertura,
} from "@/lib/atividadeAreasRegras";
import SeletorAreasDaAtividade from "@/components/lancamento-atividades/SeletorAreasDaAtividade";
import CardAreasDaAtividade from "@/components/lancamento-atividades/CardAreasDaAtividade";

/** Uma área da atividade (a forma pública do servidor). */
const area = (id, nome, status, extra = {}) => ({
  id,
  atividade_id: "a1",
  area_id: `m-${id}`,
  area: { id: `m-${id}`, numero_area: id.toUpperCase(), nome, tamanho_hectares: "10.0000" },
  setor_id: "s1",
  setor_nome: "RETIRO",
  area_planejada: "10.0000",
  status,
  data_inicio: status === "PLANEJADA" ? null : "2026-11-10",
  data_conclusao: status === "CONCLUIDA" ? "2026-11-14" : null,
  ordem: 1,
  versao: 2,
  ...extra,
});

const ATIVIDADE = {
  id: "a1",
  numero: "7",
  nome: "COMBATE À CIGARRINHA",
  status: "ABERTA",
  data_inicio: "2026-11-01",
  areas: [
    area("p1", "PASTO 01", "EM_ANDAMENTO", { ordem: 1 }),
    area("p2", "PASTO 02", "PLANEJADA", { ordem: 2 }),
    area("p3", "PASTO 03", "EM_ANDAMENTO", { ordem: 3, area_planejada: "20.0000" }),
    area("p4", "PASTO 04", "CONCLUIDA", { ordem: 4 }),
    area("p5", "PASTO 05", "PLANEJADA", { ordem: 5 }),
  ],
};

const TOTAIS = {
  por_area: [
    { atividade_area_id: "p1", area_executada: "4.0000", percentual: "40.00", custo_total: "150.0000", custo_por_ha: "37.5000", ultimo_lancamento: "2026-11-15", lancamentos_confirmados: 2, lancamentos_cancelados: 0 },
    { atividade_area_id: "p2", area_executada: null, percentual: null, custo_total: null, custo_por_ha: null, ultimo_lancamento: null, lancamentos_confirmados: 0, lancamentos_cancelados: 0 },
    { atividade_area_id: "p3", area_executada: null, percentual: null, custo_total: null, custo_por_ha: null, ultimo_lancamento: null, lancamentos_confirmados: 0, lancamentos_cancelados: 0 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

const comConsulta = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("AR-REGRAS — as regras puras das áreas", () => {
  it("AR-REGRAS-1 — a coluna Área: uma área mostra o nome; várias, \"2 de 5 em andamento\"; nenhuma em andamento, a situação; sem área, a do cabeçalho", () => {
    expect(textoDaColunaArea(ATIVIDADE)).toBe("2 de 5 em andamento");
    expect(textoDaColunaArea({ areas: [area("p1", "PASTO 01", "EM_ANDAMENTO")] })).toBe("P1 — PASTO 01");
    expect(textoDaColunaArea({ areas: [area("p1", "A", "PLANEJADA"), area("p2", "B", "PLANEJADA")] })).toBe("2 áreas a iniciar");
    expect(textoDaColunaArea({ areas: [area("p1", "A", "CONCLUIDA"), area("p2", "B", "CONCLUIDA")] })).toBe("2 áreas concluídas");
    expect(textoDaColunaArea({ areas: [area("p1", "A", "CONCLUIDA"), area("p2", "B", "PLANEJADA")] })).toBe("2 áreas");
    expect(textoDaColunaArea({ area: { numero_area: "01", nome: "PASTO 01" }, areas: [] })).toBe("01 — PASTO 01");
  });

  it("AR-REGRAS-2 — contadores e grupos do card, na ordem do proprietário: Em andamento, A iniciar, Concluídas (recolhida)", () => {
    expect(contadoresDasAreas(ATIVIDADE)).toEqual({ emAndamento: 2, aIniciar: 2, concluidas: 1, total: 5 });
    expect(textoDosContadores(ATIVIDADE)).toBe("2 em andamento · 2 a iniciar · 1 concluída");
    const grupos = gruposDasAreas(ATIVIDADE);
    expect(grupos.map((g) => [g.titulo, g.areas.map((a) => a.id), g.recolhido])).toEqual([
      ["Em andamento", ["p1", "p3"], false],
      ["A iniciar", ["p2", "p5"], false],
      ["Concluídas", ["p4"], true],
    ]);
  });

  it("AR-REGRAS-3 — abertura: marcar entra no fim com a planejada = o tamanho (número da API das áreas); o corpo areas[]; a área exigida pelo tipo", () => {
    let linhas = alternarAreaNaAbertura([], { id: "m1", tamanho_hectares: 12.5 });
    linhas = alternarAreaNaAbertura(linhas, { id: "m2", tamanho_hectares: 40 });
    expect(linhas).toEqual([{ area_id: "m1", area_planejada: "12,5" }, { area_id: "m2", area_planejada: "40" }]);
    expect(alternarAreaNaAbertura(linhas, { id: "m1" })).toEqual([{ area_id: "m2", area_planejada: "40" }]);
    const editadas = [{ area_id: "m1", area_planejada: "10,25" }, { area_id: "m2", area_planejada: "" }];
    expect(corpoDasAreasDaAbertura(editadas)).toEqual([{ area_id: "m1", area_planejada: "10.25" }, { area_id: "m2" }]);
    expect(errosDasAreasDaAbertura([], { exigeArea: true, nomeDoTipo: "PULVERIZAÇÃO" })).toEqual({ areas: "O tipo PULVERIZAÇÃO exige ao menos uma área." });
    expect(errosDasAreasDaAbertura([{ area_id: "m1", area_planejada: "abc" }], { exigeArea: false })).toEqual({ "area:m1": "A área planejada está em formato inválido: use 1.234,5." });
    expect(totaisDaAbertura(linhas, [{ id: "m1", tamanho_hectares: 12.5 }, { id: "m2", tamanho_hectares: 40 }])).toEqual({ planejada: "52.5000", tamanho: "52.5000" });
  });

  it("AR-REGRAS-4 — os números de cada área só do servidor (sem valor, \"—\"); só a não iniciada sem lançamento sai", () => {
    const l = linhaDaAreaParaExibir(ATIVIDADE.areas[0], TOTAIS.por_area[0]);
    expect([l.planejada, l.feita, l.percentual, l.barra, l.inicio, l.ultimo]).toEqual(["10 ha", "4 ha", "40%", 40, "10/11/2026", "15/11/2026"]);
    expect(l.custo).toMatch(/150,00/);
    const vazia = linhaDaAreaParaExibir(ATIVIDADE.areas[2], null);
    expect([vazia.feita, vazia.percentual, vazia.custo, vazia.barra]).toEqual(["—", "—", "—", null]);
    expect(podeRemoverArea(ATIVIDADE.areas[1], TOTAIS.por_area[1])).toBe(true);
    expect(podeRemoverArea(ATIVIDADE.areas[1], { lancamentos_confirmados: 0, lancamentos_cancelados: 1 })).toBe(false);
    expect(podeRemoverArea(ATIVIDADE.areas[0], TOTAIS.por_area[0])).toBe(false);
  });
});

describe("AR-ABERTURA — o campo Áreas da abertura", () => {
  const MAPA = [
    { id: "m1", numero_area: "01", nome: "PASTO 01", setor_nome: "RETIRO", tamanho_hectares: 12.5, ativo: true },
    { id: "m2", numero_area: "02", nome: "PASTO 02", setor_nome: "SEDE", tamanho_hectares: 40, ativo: true },
    { id: "m3", numero_area: "03", nome: "PASTO VELHO", setor_nome: "SEDE", tamanho_hectares: 5, ativo: false },
  ];
  it("AR-ABERTURA-1 — só as ativas; a busca filtra; marcar chama onChange com a área e a planejada padrão", () => {
    const onChange = vi.fn();
    render(<SeletorAreasDaAtividade areasDoMapa={MAPA} linhas={[]} onChange={onChange} obrigatorio />);
    expect(screen.getByTestId("areas-abertura")).toHaveTextContent(/Áreas\s*\*/);
    // Fechado: só o campo; a lista e a busca não aparecem até abrir.
    expect(screen.getByTestId("areas-abertura-campo")).toHaveTextContent("Selecione as áreas…");
    expect(screen.queryByTestId("areas-abertura-busca")).toBeNull();
    expect(screen.queryByTestId("areas-abertura-opcao-m1")).toBeNull();
    fireEvent.click(screen.getByTestId("areas-abertura-campo"));
    expect(screen.getByTestId("areas-abertura-opcao-m1")).toBeTruthy();
    expect(screen.queryByTestId("areas-abertura-opcao-m3")).toBeNull();
    fireEvent.change(screen.getByTestId("areas-abertura-busca"), { target: { value: "sede" } });
    expect(screen.queryByTestId("areas-abertura-opcao-m1")).toBeNull();
    fireEvent.click(screen.getByTestId("areas-abertura-opcao-m2"));
    expect(onChange).toHaveBeenCalledWith([{ area_id: "m2", area_planejada: "40" }]);
  });

  it("AR-ABERTURA-2 — as escolhidas aparecem em lista (Área · Setor · Tamanho · Área planejada · ✕) com o total; ✕ tira; editar a planejada", () => {
    const onChange = vi.fn();
    const linhas = [{ area_id: "m1", area_planejada: "12,5" }, { area_id: "m2", area_planejada: "30" }];
    render(<SeletorAreasDaAtividade areasDoMapa={MAPA} linhas={linhas} onChange={onChange} />);
    const tabela = screen.getByTestId("areas-abertura-escolhidas");
    expect(within(tabela).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Área", "Tipo", "Setor", "Tamanho (ha)", "Hectares (ha)", ""]);
    expect(screen.getByTestId("areas-abertura-linha-m1")).toHaveTextContent("01 — PASTO 01PastoRETIRO12,5 ha");
    expect(screen.getByTestId("areas-abertura-total")).toHaveTextContent("Total · 2 áreas52,5 ha42,5 ha");
    fireEvent.change(screen.getByTestId("areas-abertura-planejada-m2"), { target: { value: "35" } });
    expect(onChange).toHaveBeenLastCalledWith([{ area_id: "m1", area_planejada: "12,5" }, { area_id: "m2", area_planejada: "35" }]);
    fireEvent.click(screen.getByTestId("areas-abertura-tirar-m1"));
    expect(onChange).toHaveBeenLastCalledWith([{ area_id: "m2", area_planejada: "30" }]);
  });

  it("AR-ABERTURA-3 — controlado: marcar põe na tabela com o tamanho como padrão; tirar desmarca na lista; marcar de novo restaura o padrão", () => {
    const Controlado = () => {
      const [linhas, setLinhas] = React.useState(/** @type {any[]} */ ([]));
      return <SeletorAreasDaAtividade areasDoMapa={MAPA} linhas={linhas} onChange={setLinhas} />;
    };
    render(<Controlado />);
    expect(screen.queryByTestId("areas-abertura-escolhidas")).toBeNull();
    fireEvent.click(screen.getByTestId("areas-abertura-campo"));
    fireEvent.click(screen.getByTestId("areas-abertura-opcao-m1"));
    fireEvent.click(screen.getByTestId("areas-abertura-opcao-m2"));
    // Fechar mantém a escolha; o campo resume.
    fireEvent.keyDown(screen.getByTestId("areas-abertura-busca"), { key: "Escape" });
    expect(screen.queryByTestId("areas-abertura-busca")).toBeNull();
    expect(screen.getByTestId("areas-abertura-campo")).toHaveTextContent("2 áreas selecionadas");
    expect((screen.getByTestId("areas-abertura-planejada-m1")).value).toBe("12,5");
    fireEvent.change(screen.getByTestId("areas-abertura-planejada-m1"), { target: { value: "8" } });
    fireEvent.click(screen.getByTestId("areas-abertura-tirar-m1"));
    expect(screen.queryByTestId("areas-abertura-linha-m1")).toBeNull();
    fireEvent.click(screen.getByTestId("areas-abertura-campo"));
    expect((screen.getByTestId("areas-abertura-opcao-m1")).checked).toBe(false);
    fireEvent.click(screen.getByTestId("areas-abertura-opcao-m1"));
    expect((screen.getByTestId("areas-abertura-planejada-m1")).value).toBe("12,5");
  });
});

describe("AR-CARD — a tabela Áreas da atividade (uma só, D-PROD-252)", () => {
  const montar = (props = {}) => {
    const onAbrirArea = vi.fn();
    const onAtividadeAtualizada = vi.fn();
    comConsulta(<CardAreasDaAtividade atividade={ATIVIDADE} totais={{ ...TOTAIS, area_planejada: "70.0000", area_executada: "4.0000", custo_total: "150.0000" }} lendoTotais={false} podeGerir onAbrirArea={onAbrirArea} onAtividadeAtualizada={onAtividadeAtualizada} {...props} />);
    return { onAbrirArea, onAtividadeAtualizada };
  };

  it("AR-CARD-1 — UMA tabela com todas as áreas (Área, Situação, Planejada, Feita, %, Custo, Último lançamento) e a linha de total; os contadores no título", () => {
    montar();
    expect(screen.getByTestId("atividade-areas-contadores")).toHaveTextContent("2 em andamento · 2 a iniciar · 1 concluída");
    expect(screen.getAllByRole("table")).toHaveLength(1);
    const tabela = screen.getByTestId("areas-tabela");
    expect(within(tabela).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Ações", "Área", "Situação", "Planejada", "Feita", "%", "Custo", "Último lançamento"]);
    expect([...tabela.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-testid"))).toEqual(["area-p1", "area-p2", "area-p3", "area-p4", "area-p5"]);
    expect(screen.getByTestId("area-p1-situacao")).toHaveTextContent("Em andamento");
    expect(screen.getByTestId("area-p2-situacao")).toHaveTextContent("A iniciar");
    expect(screen.getByTestId("area-p4-situacao")).toHaveTextContent("Concluída");
    expect(screen.getByTestId("area-p1-feita")).toHaveTextContent("4 ha");
    expect(screen.getByTestId("area-p1-percentual")).toHaveTextContent("40%");
    expect(screen.getByTestId("area-p1-custo")).toHaveTextContent("150,00");
    expect(screen.getByTestId("area-p1-ultimo")).toHaveTextContent("15/11/2026");
    expect(screen.getByTestId("area-p3-feita")).toHaveTextContent("—");
    // A concluída mostra a data de conclusão; a que ainda não começou, "—".
    expect(screen.getByTestId("area-p4-ultimo")).toHaveTextContent("14/11/2026");
    expect(screen.getByTestId("area-p2-feita")).toHaveTextContent("—");
    const total = screen.getByTestId("areas-total");
    expect(within(total).getByTestId("areas-total-planejada")).toHaveTextContent("70 ha");
    expect(within(total).getByTestId("areas-total-feita")).toHaveTextContent("4 ha");
    expect(within(total).getByTestId("areas-total-custo")).toHaveTextContent("150,00");
    // Nada dos cartões grandes, dos grupos nem do botão "Iniciar área" fixo na tabela.
    expect(screen.queryByTestId("areas-grupo-EM_ANDAMENTO")).toBeNull();
    expect(screen.queryByTestId("area-iniciar-p2")).toBeNull();
    expect(document.querySelector(".b1-tipo-card")).toBeNull();
    expect(screen.getByTestId("atividade-areas-adicionar")).toBeTruthy();
  });

  it("AR-CARD-2 — o nome da área (começada) abre a área; a que ainda não começou não abre; o ⚡ inicia: o diálogo com a data (padrão hoje na fazenda, nunca futura) → acaoAreaAtividade(iniciar)", async () => {
    const atualizada = { ...ATIVIDADE, versao: 9 };
    servico.acaoAreaAtividade.mockResolvedValue({ area: { ...ATIVIDADE.areas[1], status: "EM_ANDAMENTO" }, atividade: atualizada });
    const { onAbrirArea, onAtividadeAtualizada } = montar();
    fireEvent.click(screen.getByTestId("area-p1-abrir"));
    expect(onAbrirArea).toHaveBeenCalledWith("p1");
    expect(screen.queryByTestId("area-p2-abrir")).toBeNull();
    fireEvent.click(within(screen.getByTestId("area-p2")).getByRole("button", { name: /Ações da área/ }));
    expect(screen.queryByRole("menuitem", { name: "Abrir área" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar área" }));
    const dialogo = await screen.findByTestId("dialogo-area-iniciar");
    expect(within(dialogo).getByTestId("dialogo-area-iniciar-data")).toHaveValue("2026-11-18");
    fireEvent.change(within(dialogo).getByTestId("dialogo-area-iniciar-data"), { target: { value: "2026-11-19" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-area-iniciar-enviar"));
    expect(await within(dialogo).findByText("A data não pode ser posterior a hoje na fazenda.")).toBeTruthy();
    expect(servico.acaoAreaAtividade).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByTestId("dialogo-area-iniciar-data"), { target: { value: "2026-11-16" } });
    fireEvent.click(within(dialogo).getByTestId("dialogo-area-iniciar-enviar"));
    await waitFor(() => expect(servico.acaoAreaAtividade).toHaveBeenCalledWith("a1", ATIVIDADE.areas[1], "iniciar", { data: "2026-11-16" }));
    await waitFor(() => expect(onAtividadeAtualizada).toHaveBeenCalledWith(atualizada));
    expect(notify.notifySuccess).toHaveBeenCalledWith("Sucesso", "P2 — PASTO 02 foi iniciada: já recebe lançamentos.");
  });

  it("AR-CARD-3 — o ⚡ da área em andamento: Abrir área e Concluir área (com a permissão); sem editar, só Abrir área, sem Adicionar; os tipos de lançamento NÃO estão mais no ⚡ (são os botões + da área)", async () => {
    const { onAbrirArea } = montar();
    fireEvent.click(within(screen.getByTestId("area-p1")).getByRole("button", { name: /Ações da área/ }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent.trim())).toEqual(["Abrir área", "Concluir área", "Área planejada"]);
    fireEvent.keyDown(screen.getByTestId("area-acoes-p1-menu"), { key: "Escape" });
    cleanup();
    const sem = montar({ podeGerir: false });
    expect(screen.queryByTestId("atividade-areas-adicionar")).toBeNull();
    fireEvent.click(within(screen.getByTestId("area-p1")).getByRole("button", { name: /Ações da área/ }));
    const item = await screen.findByRole("menuitem", { name: "Abrir área" });
    expect(screen.queryByRole("menuitem", { name: "Concluir área" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Trabalho de máquinas" })).toBeNull();
    fireEvent.click(item);
    expect(sem.onAbrirArea).toHaveBeenCalledWith("p1");
    expect(onAbrirArea).not.toHaveBeenCalled();
  });

  it("AR-CARD-4 — no celular a tabela continua tabela (rola na horizontal) com o Custo e o Feito antes do resto; nada de cartões", async () => {
    vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("max-width: 639px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
    montar();
    const tabela = screen.getByTestId("areas-tabela");
    expect(tabela.closest(".b1-tipo-tabela__rolagem")).toBeTruthy();
    expect(within(tabela).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Ações", "Área", "Custo", "Feita", "%", "Situação", "Planejada", "Último lançamento"]);
    expect(document.querySelector(".b1-tipo-card")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("FL — as duas telas da atividade (D-PROD-252)", () => {
  const TOTAIS_FL = { ...TOTAIS, area_planejada: "70.0000", area_executada: "4.0000", custo_total: "150.0000", custo_por_ha: "37.5000" };
  const APONTAMENTOS = [
    {
      id: "d1",
      status: "CONFIRMADO",
      data_operacional: "2026-11-12",
      atividade_area_id: "p1",
      produtos: [{ id: "x1", status: "CONFIRMADO", produto: { nome: "Glifosato" }, quantidade: "25.0000", unidade: "L", custo_total: "100.0000" }],
      maquinas: [{ id: "m1", status: "CONFIRMADO", bem: { codigo_frota: "TP-02", nome: "Trator" }, quantidade_uso: "8.0000", medidor_tipo: "HORIMETRO", medidor_unidade: "h", custo_total: "50.0000" }],
      mao_obra: [],
      servicos: [],
    },
  ];
  const montar = async (props = {}) => {
    const { default: FluxoPorArea } = await import("@/components/lancamento-atividades/FluxoPorArea");
    const onLancar = vi.fn();
    comConsulta(
      <FluxoPorArea
        atividade={ATIVIDADE}
        totais={TOTAIS_FL}
        lendoTotais={false}
        lendoLinhas={false}
        apontamentos={APONTAMENTOS}
        acoes={{ ver: true, editarApontamento: true, cancelarApontamento: true, lancarApontamento: true }}
        escopo="cli-1:operador"
        podeLancar
        podeGerir
        flags={{ permiteProduto: true, permiteImplemento: true, permiteMaoObra: false, permiteServico: false }}
        onLancar={onLancar}
        onAtividadeAtualizada={() => {}}
        recado={null}
        onLimparRecado={() => {}}
        {...props}
      />,
    );
    return { onLancar };
  };
  const sp = (/** @type {HTMLElement} */ el) => (el.textContent ?? "").replace(/\u00a0/g, " ");

  it("FL-1 — a atividade: uma linha de resumo (Aberta · desde… · X de Y ha · custo total) e UMA tabela de áreas; sem os cartões Custo total / Áreas / Desde nem os botões \"Registrar nesta área\"", async () => {
    await montar();
    expect(sp(screen.getByTestId("fluxo-resumo"))).toBe("Aberta · desde 01/11/2026 · 4 de 70 ha · custo total R$ 150,00 (R$ 37,50 por ha)");
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByTestId("cartao-area-p1")).toBeNull();
    expect(screen.queryByTestId("registrar-area-p1")).toBeNull();
    expect(screen.queryByTestId("comecar-area-p2")).toBeNull();
    expect(screen.queryByText("Ver o que já foi feito")).toBeNull();
    expect(screen.queryByTestId("detalhe-area")).toBeNull();
  });

  it("FL-2 — o nome da área abre a área: nome, atividade, \"X de Y ha · R$ … (R$ … por ha)\", os botões + (só o que o tipo permite) e UMA tabela dos lançamentos com o total; os botões chamam onLancar com a área; \"‹ Áreas\" volta", async () => {
    const { onLancar } = await montar();
    fireEvent.click(screen.getByTestId("area-p1-abrir"));
    expect(screen.getByTestId("detalhe-area-nome")).toHaveTextContent("P1 — PASTO 01");
    expect(screen.getByTestId("detalhe-area-atividade")).toHaveTextContent("COMBATE À CIGARRINHA");
    expect(sp(screen.getByTestId("detalhe-area-resumo"))).toBe("4 de 10 ha · R$ 150,00 (R$ 37,50 por ha)");
    expect(within(screen.getByTestId("escolher-registro")).getAllByRole("button").map((b) => b.textContent.trim())).toEqual(["Máquina", "Implemento", "Produto"]);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    const tabela = screen.getByTestId("area-lancamentos-tabela");
    expect([...tabela.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Ações", "Tipo", "Dia", "Item", "Quantidade", "Valor"]);
    expect([...tabela.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-testid"))).toEqual(["lancamento-m1", "lancamento-x1"]);
    expect(sp(screen.getByTestId("area-lancamentos-total-valor"))).toBe("R$ 150,00");
    for (const t of ["ajustar-dia", "detalhe-area-aviso", "grupo-maquinas"]) expect(screen.queryByTestId(t)).toBeNull();
    fireEvent.click(screen.getByTestId("escolher-produtos"));
    expect(onLancar).toHaveBeenCalledWith("produtos", "dados", "p1");
    fireEvent.click(screen.getByTestId("escolher-implemento"));
    expect(onLancar).toHaveBeenLastCalledWith("maquinas", "dados", "p1");
    // Abastecimento: sem a permissão da tela, o botão nem aparece.
    expect(screen.queryByTestId("escolher-abastecimento")).toBeNull();
    fireEvent.click(screen.getByTestId("detalhe-area-voltar"));
    expect(screen.getByTestId("fluxo-por-area")).toBeTruthy();
  });

  it("FL-3 — a área concluída ou sem permissão de lançar não mostra os botões +; a atividade sem áreas abre direto na tela da área", async () => {
    await montar({ podeLancar: false });
    fireEvent.click(screen.getByTestId("area-p1-abrir"));
    expect(screen.queryByTestId("escolher-registro")).toBeNull();
    expect(screen.queryByTestId("linha-acoes-m1")).toBeNull();
    cleanup();
    await montar({ atividade: { id: "a9", nome: "ANTIGA", status: "ABERTA", area: { id: "m1", numero_area: "01", nome: "PASTO 01" }, areas: [], area_planejada: "40.0000", area_executada: "10.0000" }, totais: null, apontamentos: [] });
    expect(screen.getByTestId("detalhe-area")).toBeTruthy();
    expect(screen.queryByTestId("detalhe-area-voltar")).toBeNull();
    expect(screen.getByTestId("detalhe-area-resumo")).toHaveTextContent("10 de 40 ha");
  });
});

describe("RA — Resumo das áreas (D-PROD-252)", () => {
  const TOTAIS_RA = {
    area_planejada: "70.0000",
    area_executada: "28.0000",
    custo_total: "4710.0000",
    custo_por_ha: "168.2143",
    custo_por_tipo: { maquinas: "950.0000", produtos: "3000.0000", mao_obra: "400.0000", servicos: "50.0000", combustivel: "310.0000" },
    por_area: [
      {
        atividade_area_id: "p1",
        area_executada: "20.0000",
        custo_total: "3610.0000",
        custo_por_ha: "180.5000",
        custo_por_tipo: { maquinas: "700.0000", produtos: "2400.0000", mao_obra: "280.0000", servicos: "50.0000", combustivel: "180.0000" },
      },
      { atividade_area_id: "p3", area_executada: "8.0000", custo_total: "1100.0000", custo_por_ha: "137.5000", custo_por_tipo: { maquinas: "250.0000", produtos: "600.0000", mao_obra: "120.0000", servicos: null, combustivel: "130.0000" } },
    ],
  };
  const MAPA = [
    { id: "m-p1", tipo_cultura: "pastagem" },
    { id: "m-p3", tipo_cultura: "agricultura" },
    { id: "m-p4" },
  ];
  const montar = async () => {
    servico.listarAreasDaFazenda.mockResolvedValue(MAPA);
    const { default: ResumoDasAreas } = await import("@/components/lancamento-atividades/ResumoDasAreas");
    comConsulta(<ResumoDasAreas atividade={ATIVIDADE} totais={TOTAIS_RA} lendoTotais={false} empresaId="emp-1" habilitado />);
  };

  it("RA-1 — uma linha por área: Tipo (Pasto/Talhão pelo cadastro do mapa), feita / planejada, o custo por tipo, o Total e o R$/ha; a de sem lançamento mostra \"—\"; a linha de total; SEM coluna de Implementos", async () => {
    await montar();
    const tabela = screen.getByTestId("resumo-areas-tabela");
    expect(within(tabela).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Área", "Tipo", "Feita / planejada", "Máquinas", "Insumos", "Mão de obra", "Serviços", "Abastecimento", "Total", "R$/ha"]);
    expect(within(tabela).queryByText("Implementos")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("resumo-area-p3-tipo")).toHaveTextContent("Talhão"));
    expect(screen.getByTestId("resumo-area-p1-tipo")).toHaveTextContent("Pasto");
    // Sem uso informado, o mapa conta como pasto (a regra de `grupoDaArea`).
    expect(screen.getByTestId("resumo-area-p4-tipo")).toHaveTextContent("Pasto");
    expect(screen.getByTestId("resumo-area-p1-nome")).toHaveTextContent("P1 — PASTO 01");
    expect(screen.getByTestId("resumo-area-p1-feitaDePlanejada")).toHaveTextContent("20 de 10 ha");
    expect(screen.getByTestId("resumo-area-p1-maquinas")).toHaveTextContent("700,00");
    expect(screen.getByTestId("resumo-area-p1-insumos")).toHaveTextContent("2.400,00");
    expect(screen.getByTestId("resumo-area-p1-maoObra")).toHaveTextContent("280,00");
    expect(screen.getByTestId("resumo-area-p1-servicos")).toHaveTextContent("50,00");
    expect(screen.getByTestId("resumo-area-p1-abastecimento")).toHaveTextContent("180,00");
    expect(screen.getByTestId("resumo-area-p1-total")).toHaveTextContent("3.610,00");
    expect(screen.getByTestId("resumo-area-p1-porHa")).toHaveTextContent("180,50");
    expect(screen.getByTestId("resumo-area-p3-servicos")).toHaveTextContent(/^—$/);
    // Área sem nenhum lançamento: tudo "—".
    for (const c of ["maquinas", "insumos", "maoObra", "servicos", "abastecimento", "total", "porHa"]) expect(screen.getByTestId(`resumo-area-p2-${c}`)).toHaveTextContent(/^—$/);
    // Total da atividade, do próprio servidor.
    expect(screen.getByTestId("resumo-areas-total-feitaDePlanejada")).toHaveTextContent("28 de 70 ha");
    expect(screen.getByTestId("resumo-areas-total-maquinas")).toHaveTextContent("950,00");
    expect(screen.getByTestId("resumo-areas-total-total")).toHaveTextContent("4.710,00");
    expect(screen.getByTestId("resumo-areas-total-porHa")).toHaveTextContent("168,21");
    expect(screen.getByTestId("resumo-areas-nota")).toHaveTextContent("O custo do implemento já está em Máquinas. R$/ha = total ÷ hectares feitos.");
  });

  it("RA-2 — no celular continua tabela (rola na horizontal), com o Total e o R$/ha antes das colunas de custo", async () => {
    vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("max-width: 639px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
    await montar();
    const tabela = screen.getByTestId("resumo-areas-tabela");
    expect(tabela.closest(".b1-tipo-tabela__rolagem")).toBeTruthy();
    expect(within(tabela).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Área", "Total", "R$/ha", "Feita / planejada", "Máquinas", "Insumos", "Mão de obra", "Serviços", "Abastecimento", "Tipo"]);
    expect(document.querySelector(".b1-tipo-card")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("LAR — regras da organização (D-PROD-252)", () => {
  it("LAR-1 — a linha de resumo da atividade e o custo com o R$/ha só dizem o que o servidor deu", async () => {
    const R = await import("@/lib/lancamentosDaAreaRegras");
    // (a moeda do sistema usa o espaço sem quebra depois do R$)
    const sp = (/** @type {string} */ t) => t.replace(/\u00a0/g, " ");
    expect(sp(R.linhaResumoDaAtividade({ situacao: "Aberta", desde: "03/11/2026", feitaDePlanejada: "28 de 70 ha", custoTotal: "4710.0000", custoPorHa: "168.2143" }))).toBe(
      "Aberta · desde 03/11/2026 · 28 de 70 ha · custo total R$ 4.710,00 (R$ 168,21 por ha)",
    );
    expect(R.linhaResumoDaAtividade({ situacao: "Aberta", desde: "", feitaDePlanejada: "—", custoTotal: null, custoPorHa: null })).toBe("Aberta");
    expect(sp(R.textoCustoComPorHa("3610.0000", null))).toBe("R$ 3.610,00");
    expect(R.textoCustoComPorHa(null, "1.0000")).toBe("");
    expect(R.textoFeitaDePlanejada({ feita: "20 ha", planejada: "40 ha" })).toBe("20 de 40 ha");
    expect(R.textoFeitaDePlanejada({ feita: "—", planejada: "40 ha" })).toBe("40 ha");
  });

  it("LAR-2 — as linhas da área: só as confirmadas daquela área; o implemento é texto da máquina; o abastecimento é uma linha; do dia mais novo ao mais antigo, e no dia, na ordem dos tipos", async () => {
    const R = await import("@/lib/lancamentosDaAreaRegras");
    const ap = (id, dia, area, extra) => ({ id, status: "CONFIRMADO", data_operacional: dia, atividade_area_id: area, produtos: [], maquinas: [], mao_obra: [], servicos: [], ...extra });
    const apontamentos = [
      ap("d1", "2026-11-12", "p1", {
        maquinas: [{ id: "m1", status: "CONFIRMADO", bem: { codigo_frota: "TP-02", nome: "Trator" }, implemento: { codigo_frota: "GR-01", nome: "Grade" }, quantidade_uso: "8.0000", medidor_tipo: "HORIMETRO", medidor_unidade: "h", custo_total: "400.0000" }],
        produtos: [{ id: "x1", status: "CANCELADO", produto: { nome: "Cancelado" }, quantidade: "1", unidade: "L", custo_total: "9.0000" }],
      }),
      ap("d2", "2026-11-14", "p1", { servicos: [{ id: "s1", status: "CONFIRMADO", servico: { nome: "Frete" }, quantidade: "10.0000", unidade: "KM", valor_total: "50.0000" }] }),
      ap("d3", "2026-11-13", "p3", { maquinas: [{ id: "m9", status: "CONFIRMADO", bem: { nome: "Outro" }, quantidade_uso: "1.0000", custo_total: "10.0000" }] }),
    ];
    const abastecimentos = [
      { id: "ab1", status: "CONFIRMADO", data_operacional: "2026-11-12", bem: { codigo_frota: "TP-02", nome: "Trator" }, quantidade: "40.0000", unidade: "L", custo_total: "200.0000", apontamento: { id: "d1" } },
      { id: "ab2", status: "CONFIRMADO", data_operacional: "2026-11-13", bem: { nome: "Outro" }, quantidade: "5", unidade: "L", custo_total: "9", apontamento: { id: "d3" } },
    ];
    const linhas = R.linhasDaArea({ apontamentos, abastecimentos, areaId: "p1" });
    expect(linhas.map((l) => [l.id, l.rotuloDoTipo, l.diaTexto])).toEqual([
      ["s1", "Serviço", "14/11/2026"],
      ["m1", "Máquina", "12/11/2026"],
      ["abastecimento-ab1", "Abastecimento", "12/11/2026"],
    ]);
    expect(linhas[1].item).toBe("TP-02 — Trator com GR-01 — Grade");
    expect(linhas[2]).toMatchObject({ item: "TP-02 — Trator", quantidade: "40 L" });
    expect(linhas[2].valorTexto.replace(/\u00a0/g, " ")).toBe("R$ 200,00");
    expect(R.somaDasLinhas(linhas)).toBe("650.0000");
    // Sem a área (atividade antiga), a atividade toda.
    expect(R.linhasDaArea({ apontamentos, abastecimentos: [], areaId: null })).toHaveLength(3);
  });
});

describe("AR-PORTA — as allowlists das áreas iguais às rotas do servidor", () => {
  it("AR-PORTA-1 — adicionar, editar e as ações (iniciar, concluir, reabrir, remover) e o areas[] da abertura", async () => {
    const porta = await import("@/apis/atividades/lancamentoAtividadePort.js");
    const rotas = readFileSync("backend/src/modules/atividades/atividadeAreaRoutes.js", "utf8");
    const props = (nome) => {
      const ini = rotas.indexOf(`const ${nome} = {`);
      const trecho = rotas.slice(ini, rotas.indexOf("\n};", ini));
      return [...trecho.matchAll(/properties: \{ ([^}]*) \}/g)].at(-1)[1].split(",").map((p) => p.trim().split(":")[0]).sort();
    };
    expect(props("ADICIONAR")).toEqual([...porta.CAMPOS_DE_ADICAO_AREA].sort());
    expect(props("EDITAR")).toEqual([...porta.CAMPOS_DE_EDICAO_AREA].sort());
    expect(Object.keys(porta.ACOES_DA_AREA).sort()).toEqual(["concluir", "iniciar", "reabrir", "remover"]);
    expect(rotas).toMatch(/\/iniciar', \{ \.\.\.autenticado, schema: COM_VERSAO\('data_inicio'\) \}/);
    expect(rotas).toMatch(/\/concluir', \{ \.\.\.autenticado, schema: COM_VERSAO\('data_conclusao'\) \}/);
    expect(porta.CAMPOS_DE_ABERTURA).toContain("areas");
    expect([...porta.CAMPOS_DA_AREA_NA_ABERTURA]).toEqual(["area_id", "area_planejada"]);
    expect(porta.CAMPOS_DO_APONTAMENTO).toContain("atividade_area_id");
    expect(porta.CAMPOS_DE_DUPLICACAO_APONTAMENTO).toContain("atividade_area_id");
  });
});
