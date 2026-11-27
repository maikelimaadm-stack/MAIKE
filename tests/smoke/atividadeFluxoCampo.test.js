import { describe, expect, it } from "vitest";
import { bemParaAbastecer, ehTipoAbastecimento, movimentosDaArea, tiposRegistraveisNaArea } from "@/lib/atividadeFluxoCampo";

const maquina = (id, extra = {}) => ({ id, status: "CONFIRMADO", bem_id: "b1", bem: { codigo: "TP-02", nome: "Trator" }, custo_total: "100", ...extra });
const ap = (id, area, dia, linhas = {}, extra = {}) => ({ id, status: "CONFIRMADO", atividade_area_id: area, data_operacional: dia, sequencia: 1, ...linhas, ...extra });

describe("D-PROD-251 — fluxo de campo", () => {
  it("FC-2 — implemento tem grupo próprio, sem custo próprio: conta os usos e manda o custo para Máquinas", () => {
    const linhas = { maquinas: [maquina("m1", { implemento: { codigo: "GR-1", nome: "Grade" } }), maquina("m2")] };
    const grupos = movimentosDaArea([ap("ap1", "ar1", "2026-11-12", linhas)], "ar1", { maquinas: "200" });
    expect(grupos.map((g) => g.id)).toEqual(["maquinas", "implemento"]);
    const impl = grupos[1];
    expect(impl.rotulo).toBe("Implementos");
    expect(impl.total).toBe("1 uso");
    expect(impl.itens).toHaveLength(1);
    expect(impl.itens[0].custo).toBe("");
    expect(impl.nota).toMatch(/Máquinas/);
    expect(grupos[0].itens[0].detalhe).toMatch(/com /);
  });

  it("FC-3 — o tipo Abastecimento (pelo nome, sem acento nem caixa) fica fora dos tipos registráveis na área; o bem do abastecimento leva o tipo do medidor", () => {
    const tipos = [{ nome_tipo: "Abastecimento" }, { nome_tipo: "ABASTECIMENTO DE MÁQUINAS" }, { nome_tipo: "Combustível" }, { nome_tipo: "Gradeação" }, { nome_tipo: "Roçada" }];
    expect(ehTipoAbastecimento(tipos[1])).toBe(true);
    expect(tiposRegistraveisNaArea(tipos).map((t) => t.nome_tipo)).toEqual(["Gradeação", "Roçada"]);
    expect(tiposRegistraveisNaArea(null)).toEqual([]);
    expect(bemParaAbastecer({ id: 7, rotulo: "TP-02 — Trator", medidorTipo: "HORIMETRO" })).toEqual({ id: "7", nome: "TP-02 — Trator", medidor: { tipo: "HORIMETRO" } });
    expect(bemParaAbastecer({ id: null })).toBeNull();
  });
});
