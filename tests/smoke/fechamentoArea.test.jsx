// D-PROD-291 — o Finalizar com "Fez o pasto todo?" e o resumo "Como ficou" (jatos, horas, produto por hectare, custo).
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const dados = vi.hoisted(() => ({ detalhe: /** @type {any} */ (null), apontamentos: /** @type {any[]} */ ([]) }));
vi.mock("@/services/lancamentoAtividadesService", async (importOriginal) => ({
  ...(await importOriginal()),
  obterAtividade: vi.fn(async () => dados.detalhe),
  listarApontamentos: vi.fn(async () => ({ items: dados.apontamentos })),
}));

const { default: DialogoConcluirServico } = await import("@/components/lancamento-atividades/DialogoConcluirServico");
const { hectaresDaEscolha, linhasDoResumo, resumoDosLancamentos } = await import("@/lib/fechamentoRegras");

afterEach(() => cleanup());

const HERB = { id: "p1", nome: "HERBICIDA FOLHA LARGA" };
const ADUBO = { id: "p2", nome: "ADUBO FOLIAR" };
const linhaP = (produto, quantidade, jato, custo, unidade = "L") => ({ status: "CONFIRMADO", produto_id: produto.id, produto, quantidade, unidade, jato, custo_total: custo });
const DIA = (id, data, extra = {}) => ({
  id, status: "CONFIRMADO", data_operacional: data, atividade_area_id: "aa1", area_executada_dia: null,
  produtos: [], maquinas: [], mao_obra: [], servicos: [], ...extra,
});
const APONTAMENTOS = [
  DIA("ap1", "2026-12-01", {
    produtos: [linhaP(HERB, "10", 1, "100"), linhaP(ADUBO, "8", 1, "40", "KG"), linhaP(HERB, "10", 2, "100"), linhaP(ADUBO, "8", 2, "40", "KG")],
    maquinas: [{ status: "CONFIRMADO", medidor_tipo: "HORIMETRO", quantidade_uso: "8", custo_total: "400" }],
    mao_obra: [{ status: "CONFIRMADO", custo_total: "150" }],
  }),
  DIA("ap2", "2026-12-02", {
    produtos: [linhaP(HERB, "14", 1, "140"), linhaP(ADUBO, "8", 1, "40", "KG"), { ...linhaP(HERB, "99", 2, "990"), status: "CANCELADO" }],
    maquinas: [{ status: "CONFIRMADO", medidor_tipo: "HORIMETRO", quantidade_uso: "4", custo_total: "200" }],
  }),
  { ...DIA("ap3", "2026-12-03", { produtos: [linhaP(HERB, "50", 1, "500")] }), status: "CANCELADO" },
];

describe("regras do fechamento", () => {
  it("resumo: jatos (lançamento × jato), dias, horas, total por produto e custo — só o confirmado", () => {
    const r = resumoDosLancamentos(APONTAMENTOS);
    expect(r.jatos).toBe(3);
    expect(r.diasComJato).toBe(2);
    expect(r.horasMaquina).toBe(12);
    expect(r.produtos.map((p) => [p.rotulo, p.total, p.unidade])).toEqual([["HERBICIDA FOLHA LARGA", 34, "L"], ["ADUBO FOLIAR", 24, "KG"]]);
    expect(r.custoTotal).toBe(100 + 40 + 100 + 40 + 400 + 150 + 140 + 40 + 200);
  });

  it("por hectare com os hectares informados; sem hectares, os totais", () => {
    const r = resumoDosLancamentos(APONTAMENTOS);
    const l = linhasDoResumo(r, 10);
    expect(l.jatos).toBe("3 jatos em 2 dias");
    expect(l.horas).toBe("12 horas");
    expect(l.porHectare).toEqual([{ rotulo: "HERBICIDA FOLHA LARGA", texto: "3,4 L/ha" }, { rotulo: "ADUBO FOLIAR", texto: "2,4 kg/ha" }]);
    expect(l.custoTotal).toMatch(/1\.210,00/);
    expect(l.custoPorHectare).toMatch(/121,00/);
    expect(linhasDoResumo(r, null).porHectare[0].texto).toBe("34 L");
  });

  it("a escolha: Sim = o tamanho; Parte = o digitado (não menos que o lançado); sem escolha, o aviso", () => {
    expect(hectaresDaEscolha({ escolha: "SIM", digitado: "", tamanho: 25, jaLancado: 0 })).toEqual({ hectares: 25, erro: null });
    expect(hectaresDaEscolha({ escolha: "SIM", digitado: "", tamanho: null, jaLancado: 0 }).erro).toMatch(/tamanho/);
    expect(hectaresDaEscolha({ escolha: "PARTE", digitado: "12,5", tamanho: 25, jaLancado: 0 })).toEqual({ hectares: 12.5, erro: null });
    expect(hectaresDaEscolha({ escolha: "PARTE", digitado: "3", tamanho: 25, jaLancado: 10 }).erro).toBe("Já foram lançados 10 ha nesta área.");
    expect(hectaresDaEscolha({ escolha: "", digitado: "", tamanho: 25, jaLancado: 0 }).erro).toBe("Escolha se fez o pasto todo.");
  });
});

describe("o diálogo Finalizar com o pasto", () => {
  const ITEM = { id: "at-9", versao: 3, nome: "APLICAÇÃO · PASTO DO CÓRREGO", tipo_atividade_nome: "APLICAÇÃO", data_inicio: "2026-12-01", andamento: { ultimo_dia: "2026-12-02" } };
  const montar = (onConcluir = vi.fn(async () => ({}))) => {
    dados.detalhe = { id: "at-9", areas: [{ id: "aa1", ordem: 1, status: "EM_ANDAMENTO", area_planejada: "25.0000", area: { id: "ar1", numero_area: "07", nome: "PASTO DO CÓRREGO", tamanho_hectares: "25.0000" } }] };
    dados.apontamentos = APONTAMENTOS;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogoConcluirServico item={ITEM} hoje="2026-12-05" onFechar={vi.fn()} onConcluir={onConcluir} />
      </QueryClientProvider>,
    );
    return onConcluir;
  };

  it("'Fez o pasto todo?' obrigatório; 'Sim, os 25 ha' mostra o por hectare e manda os 25 ha da área", async () => {
    const onConcluir = montar();
    const grupo = await screen.findByTestId("dialogo-concluir-fez-tudo-aa1");
    await waitFor(() => expect(screen.getByTestId("dialogo-concluir-servico-enviar")).not.toBeDisabled());
    expect(screen.getByTestId("dialogo-concluir-resumo-uso")).toHaveTextContent("3 jatos em 2 dias");
    expect(screen.getByTestId("dialogo-concluir-resumo-uso")).toHaveTextContent("12 horas");
    expect(screen.getByTestId("dialogo-concluir-resumo-produtos")).toHaveTextContent("34 L");
    // Sem escolha: o aviso e nada vai.
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-enviar"));
    expect(await screen.findByTestId("dialogo-concluir-erro-area-aa1")).toHaveTextContent("Escolha se fez o pasto todo.");
    expect(onConcluir).not.toHaveBeenCalled();
    fireEvent.click(within(grupo).getByRole("radio", { name: "Sim, os 25 ha" }));
    expect(screen.getByTestId("dialogo-concluir-resumo-produtos")).toHaveTextContent("1,36 L/ha");
    expect(screen.getByTestId("dialogo-concluir-resumo-custo")).toHaveTextContent("Custo por hectare");
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-enviar"));
    await waitFor(() => expect(onConcluir).toHaveBeenCalledWith("2026-12-02", [{ atividade_area_id: "aa1", hectares: "25" }]));
  });

  it("'Não, fiz só uma parte' pede os hectares e manda o digitado", async () => {
    const onConcluir = montar();
    const grupo = await screen.findByTestId("dialogo-concluir-fez-tudo-aa1");
    await waitFor(() => expect(screen.getByTestId("dialogo-concluir-servico-enviar")).not.toBeDisabled());
    fireEvent.click(within(grupo).getByRole("radio", { name: "Não, fiz só uma parte" }));
    fireEvent.change(screen.getByTestId("dialogo-concluir-hectares-aa1"), { target: { value: "12,5" } });
    fireEvent.click(screen.getByTestId("dialogo-concluir-servico-enviar"));
    await waitFor(() => expect(onConcluir).toHaveBeenCalledWith("2026-12-02", [{ atividade_area_id: "aa1", hectares: "12.5" }]));
  });
});
