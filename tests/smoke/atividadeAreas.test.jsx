/**
 * D-PROD-238 — VÁRIAS ÁREAS POR ATIVIDADE (a tela). "Eu tenho uma atividade que é combate contra cigarrinha, e nessa
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
 *  - o card "Áreas da atividade" (`CardAreasDaAtividade`): os três grupos na ordem, os números de cada área, o
 *    "Iniciar área" (o diálogo com a data → `POST …/areas/:id/iniciar`), Concluídas recolhidas, o ⚡ de cada área;
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
    expect(within(tabela).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Área", "Setor", "Tamanho (ha)", "Área planejada (ha)", ""]);
    expect(screen.getByTestId("areas-abertura-linha-m1")).toHaveTextContent("01 — PASTO 01RETIRO12,5 ha");
    expect(screen.getByTestId("areas-abertura-total")).toHaveTextContent("Total · 2 áreas52,5 ha42,5 ha");
    fireEvent.change(screen.getByTestId("areas-abertura-planejada-m2"), { target: { value: "35" } });
    expect(onChange).toHaveBeenLastCalledWith([{ area_id: "m1", area_planejada: "12,5" }, { area_id: "m2", area_planejada: "35" }]);
    fireEvent.click(screen.getByTestId("areas-abertura-tirar-m1"));
    expect(onChange).toHaveBeenLastCalledWith([{ area_id: "m2", area_planejada: "30" }]);
  });
});

describe("AR-CARD — o card Áreas da atividade", () => {
  const LANCAMENTOS = [
    { tipo: "maquinas", rotulo: "Trabalho de máquinas", Icone: () => null, lancar: true },
    { tipo: "produtos", rotulo: "Aplicação de insumos", Icone: () => null, lancar: true },
  ];
  const montar = (props = {}) => {
    const onLancarNaArea = vi.fn();
    const onVerLancamentosDaArea = vi.fn();
    const onAtividadeAtualizada = vi.fn();
    comConsulta(
      <CardAreasDaAtividade
        atividade={ATIVIDADE}
        totais={TOTAIS}
        lendoTotais={false}
        podeGerir
        lancamentos={LANCAMENTOS}
        onLancarNaArea={onLancarNaArea}
        onVerLancamentosDaArea={onVerLancamentosDaArea}
        onAtividadeAtualizada={onAtividadeAtualizada}
        {...props}
      />,
    );
    return { onLancarNaArea, onVerLancamentosDaArea, onAtividadeAtualizada };
  };

  it("AR-CARD-1 — os contadores no título, Em andamento com os números do servidor, A iniciar com o Iniciar área, Concluídas recolhidas", () => {
    montar();
    expect(screen.getByTestId("atividade-areas-contadores")).toHaveTextContent("2 em andamento · 2 a iniciar · 1 concluída");
    const andamento = screen.getByTestId("areas-grupo-EM_ANDAMENTO");
    expect(within(andamento).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Ações", "Área", "Planejada", "Feita", "%", "Custo", "Custo/ha", "Iniciada em", "Último lançamento"]);
    expect(screen.getByTestId("area-p1-feita")).toHaveTextContent("4 ha");
    expect(screen.getByTestId("area-p1-percentual")).toHaveTextContent("40%");
    expect(screen.getByTestId("area-p1-custo-ha")).toHaveTextContent(/37,50/);
    expect(screen.getByTestId("area-p1-ultimo")).toHaveTextContent("15/11/2026");
    expect(screen.getByTestId("area-p3-feita")).toHaveTextContent("—");
    expect(screen.getByTestId("area-iniciar-p2")).toBeTruthy();
    expect(screen.queryByTestId("area-p4")).toBeNull();
    fireEvent.click(screen.getByTestId("areas-concluidas-toggle"));
    expect(screen.getByTestId("area-p4-conclusao")).toHaveTextContent("14/11/2026");
    expect(screen.getByTestId("atividade-areas-adicionar")).toBeTruthy();
  });

  it("AR-CARD-2 — Iniciar área: o diálogo com a data (padrão hoje na fazenda, nunca futura) → acaoAreaAtividade(iniciar); a atividade devolvida volta para a tela", async () => {
    const atualizada = { ...ATIVIDADE, versao: 9 };
    servico.acaoAreaAtividade.mockResolvedValue({ area: { ...ATIVIDADE.areas[1], status: "EM_ANDAMENTO" }, atividade: atualizada });
    const { onAtividadeAtualizada } = montar();
    fireEvent.click(screen.getByTestId("area-iniciar-p2"));
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

  it("AR-CARD-3 — sem permissão de editar: nada de Iniciar, Adicionar nem os itens de gestão; o ⚡ da área em andamento lança fixo na área", async () => {
    const { onLancarNaArea } = montar({ podeGerir: false });
    expect(screen.queryByTestId("area-iniciar-p2")).toBeNull();
    expect(screen.queryByTestId("atividade-areas-adicionar")).toBeNull();
    fireEvent.click(within(screen.getByTestId("area-p1")).getByRole("button", { name: /Ações da área/ }));
    const item = await screen.findByRole("menuitem", { name: "Trabalho de máquinas" });
    expect(screen.queryByRole("menuitem", { name: "Concluir área" })).toBeNull();
    fireEvent.click(item);
    expect(onLancarNaArea).toHaveBeenCalledWith("maquinas", "dados", "p1");
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
