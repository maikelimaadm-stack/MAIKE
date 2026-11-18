import { describe, expect, it } from "vitest";
import { fraseDoRegistro, movimentosDaArea, opcoesDeRegistro, registroDoDiaParaAbastecer } from "@/lib/atividadeFluxoCampo";

const maquina = (id, extra = {}) => ({ id, status: "CONFIRMADO", bem_id: "b1", bem: { codigo: "TP-02", nome: "Trator" }, custo_total: "100", ...extra });
const ap = (id, area, dia, linhas = {}, extra = {}) => ({ id, status: "CONFIRMADO", atividade_area_id: area, data_operacional: dia, sequencia: 1, ...linhas, ...extra });

describe("D-PROD-251 — fluxo de campo", () => {
  it("FC-1 — implemento é opção própria, só se o tipo permite; abastecimento, só quando liberado", () => {
    const ids = (f, e) => opcoesDeRegistro(f, e).map((o) => o.id);
    expect(ids({}, {})).toEqual(["maquinas"]);
    expect(ids({ permiteImplemento: true, permiteProduto: true }, { abastecimento: true })).toEqual(["maquinas", "implemento", "produtos", "abastecimento"]);
  });

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

  it("FC-3 — sem registro na área, não há onde ligar o abastecimento; com vários, vale o de hoje, senão o mais recente", () => {
    const lista = [ap("a", "ar1", "2026-11-10"), ap("b", "ar1", "2026-11-12"), ap("c", "ar2", "2026-11-18"), ap("d", "ar1", "2026-11-18", {}, { status: "CANCELADO" })];
    expect(registroDoDiaParaAbastecer(lista, "ar3", "2026-11-18")).toBeNull();
    expect(registroDoDiaParaAbastecer(lista, "ar1", "2026-11-18")?.id).toBe("b");
    expect(registroDoDiaParaAbastecer([...lista, ap("e", "ar1", "2026-11-18")], "ar1", "2026-11-18")?.id).toBe("e");
  });

  it("FC-4 — a frase da confirmação é curta e diz onde foi anotado", () => {
    expect(fraseDoRegistro({ texto: "Máquina Trator salva", area: "Pasto 01", atividade: "Adubação" })).toBe("Máquina Trator salva. Foi anotado em Pasto 01, na atividade Adubação.");
    expect(fraseDoRegistro({ texto: "", area: "", atividade: "Adubação" })).toBe("Registro salvo. Foi anotado na atividade Adubação.");
  });
});
