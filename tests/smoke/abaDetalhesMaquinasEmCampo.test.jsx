/**
 * D-PROD-348 (item 2) — a linha de cada atividade EM ANDAMENTO na aba Detalhes da área diz "N máquinas em campo" (o mesmo
 * texto do cartão da atividade no Diário), lendo os apontamentos com a chave e o serviço do Diário:
 *  (a) duas aberturas abertas → "2 máquinas em campo";
 *  (b) sem aberturas → nada do trecho;
 *  (c) todas encerradas → nada do trecho;
 *  (d) atividade planejada (não está em andamento) → não lê os apontamentos e não mostra o trecho;
 *  (e) leitura com erro → a linha fica como era (só o "Feito …");
 *  (f) a chave de cache é a do Diário (`chaveApontamentos`): uma leitura por atividade.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useLancamentoAtividadesSessao", () => ({
  useAcoesTelaAtividades: () => ({ ver: true, criar: true, editar: true, lancarApontamento: true, permissaoEfetiva: { is_admin: false }, login: "operador" }),
  useEmpresaRealSelecionadaId: () => "emp-1",
  useFusoDaFazenda: () => ({ fuso: "America/Cuiaba", fusoOk: true, semFuso: false, hoje: "2026-11-26" }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ clienteId: "c-1", user: { id: "u-1" } }) }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  definirFazendaDaTela: vi.fn(),
  obterResumoDaArea: vi.fn(),
  listarApontamentos: vi.fn(),
}));

import AbaDetalhesDaArea from "@/components/mapa/detalhes-area/AbaDetalhesDaArea";
import { marcadorDaAbertura, marcadorDoEncerramento } from "@/lib/aberturaServicoRegras";
import { chaveApontamentos } from "@/lib/atividadeApontamentoRegras";
import * as servico from "@/services/lancamentoAtividadesService";

const AREA = { id: "area-A", nome: "Pasto 04", tamanho_hectares: "28.3500", tipo_cultura: "Pastagem" };
const RESUMO = {
  area_id: "area-A",
  mes: "2026-11",
  atividades: [
    { atividade_id: "at-1", numero: 10, nome: "Aplicação · nov/26", tipo_atividade_nome: "Aplicação de defensivo", area_status: "EM_ANDAMENTO", area_planejada: "22.0000", area_executada: "12.0000", data_inicio: "2026-11-02", data_prevista_fim: "2026-11-30" },
    { atividade_id: "at-3", numero: 12, nome: "Roçada · dez/26", tipo_atividade_nome: "Roçada", area_status: "PLANEJADA", area_planejada: "22.0000", area_executada: "0.0000", data_inicio: "2026-12-01", data_prevista_fim: "2026-12-10" },
  ],
  custos: null,
  planejamentos: [],
};

const abertura = (bem, nome, hor) => marcadorDaAbertura({ bemId: bem, bemNome: nome, horimetro: hor, responsavelId: "usr-3", responsavelNome: "João" });
const ap = (id, observacao) => ({ id, data_operacional: "2026-11-20", status: "CONFIRMADO", createdAt: "2026-11-20T09:00:00.000Z", observacao, produtos: [], maquinas: [], mao_obra: [], servicos: [] });

/** Duas frentes abertas (Trator 12 e Trator 08). */
const DUAS_ABERTAS = [ap("a1", abertura("bem-7", "Trator 12", "1000.0")), ap("a2", abertura("bem-8", "Trator 08", "900.0"))];
/** A mesma máquina aberta e depois encerrada. */
const TODAS_ENCERRADAS = [ap("a1", abertura("bem-7", "Trator 12", "1000.0")), ap("e1", marcadorDoEncerramento({ bemId: "bem-7", horimetro: "1100.0", bemNome: "Trator 12" }))];

/** @type {Record<string, any[]>} */
let apontamentosPorAtividade;

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AbaDetalhesDaArea area={AREA} verAtividades secao="manejos" />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  apontamentosPorAtividade = { "at-1": DUAS_ABERTAS, "at-3": [] };
  servico.obterResumoDaArea.mockResolvedValue(RESUMO);
  servico.listarApontamentos.mockImplementation(async (id) => {
    const lista = apontamentosPorAtividade[id];
    if (!lista) throw new Error(`sem atividade ${id}`);
    return { items: [...lista] };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("D-PROD-348 (item 2) — máquinas em campo na linha da atividade em andamento", () => {
  it("(a) duas aberturas abertas → a linha diz \"2 máquinas em campo\"", async () => {
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    await waitFor(() => expect(linha).toHaveTextContent("2 máquinas em campo"));
    expect(linha).toHaveTextContent("Feito 12 de 22 ha");
  });

  it("(b) sem aberturas → a linha não mostra o trecho de máquinas", async () => {
    apontamentosPorAtividade["at-1"] = [];
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    await waitFor(() => expect(servico.listarApontamentos).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(linha).not.toHaveTextContent("máquina");
    expect(linha).toHaveTextContent("Feito 12 de 22 ha");
  });

  it("(c) todas as frentes encerradas → a linha não mostra o trecho de máquinas", async () => {
    apontamentosPorAtividade["at-1"] = TODAS_ENCERRADAS;
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    await waitFor(() => expect(servico.listarApontamentos).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(linha).not.toHaveTextContent("máquina");
  });

  it("(d) atividade planejada não é lida e não mostra o trecho", async () => {
    renderizar();
    const planejada = await screen.findByTestId("area-atividade-at-3");
    expect(planejada).not.toHaveTextContent("máquina");
    expect(servico.listarApontamentos).not.toHaveBeenCalledWith("at-3");
  });

  it("(e) leitura com erro → a linha fica como era, sem o trecho", async () => {
    servico.listarApontamentos.mockRejectedValue(new Error("offline"));
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    await waitFor(() => expect(servico.listarApontamentos).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(linha).not.toHaveTextContent("máquina");
    expect(linha).toHaveTextContent("Feito 12 de 22 ha");
  });

  it("(f) a leitura usa a chave de cache do Diário (uma chamada por atividade em andamento)", async () => {
    renderizar();
    const linha = await screen.findByTestId("area-atividade-at-1");
    await waitFor(() => expect(linha).toHaveTextContent("2 máquinas em campo"));
    expect(chaveApontamentos("emp-1", "at-1")).toEqual(["lancamento-atividades", "apontamentos", "emp-1", "at-1"]);
    expect(servico.listarApontamentos.mock.calls.filter(([id]) => id === "at-1")).toHaveLength(1);
  });
});
