/**
 * D-PROD-258 — os 7 tipos fixos no cliente: a lista, o rótulo, o filtro de operações por tipo e a paridade com o servidor.
 */
import { describe, it, expect } from "vitest";

import { TIPOS_FIXOS_ATIVIDADE, operacoesDoTipoFixo, rotuloDoTipoFixo, tipoFixoDaOperacao } from "@/lib/tiposFixosAtividade";
import { TIPOS_FIXOS_ATIVIDADE as DO_SERVIDOR } from "../../backend/src/modules/tiposAtividade/tipoAtividadePadroes.js";

describe("tipos fixos de atividade (D-PROD-258)", () => {
  it("o cliente e o servidor falam dos mesmos 7 tipos, com os mesmos valores, rótulos e ordem", () => {
    expect(TIPOS_FIXOS_ATIVIDADE.map((t) => ({ categoria: t.value, rotulo: t.label }))).toEqual(DO_SERVIDOR.map((t) => ({ ...t })));
    expect(TIPOS_FIXOS_ATIVIDADE).toHaveLength(7);
  });

  it("operação sem categoria ou com categoria fora dos 7 conta como Outros", () => {
    expect(tipoFixoDaOperacao({ categoria: "PASTAGEM" })).toBe("PASTAGEM");
    for (const categoria of [null, undefined, "", "COLHEITA", "MANEJO_ANIMAL", "QUALQUER"]) expect(tipoFixoDaOperacao({ categoria })).toBe("OUTROS");
    expect(tipoFixoDaOperacao(null)).toBe("OUTROS");
    expect(rotuloDoTipoFixo("TRATO_CULTURAL")).toBe("Fertilização");
    expect(rotuloDoTipoFixo("COLHEITA")).toBe("Outros");
  });

  it("operacoesDoTipoFixo: só as ativas do tipo, em ordem alfabética (pt-BR)", () => {
    const todas = [
      { id: "1", nome_tipo: "Roçada", categoria: "PASTAGEM", ativo: true },
      { id: "2", nome_tipo: "Capina", categoria: "PASTAGEM", ativo: true },
      { id: "3", nome_tipo: "Queima", categoria: "PASTAGEM", ativo: false },
      { id: "4", nome_tipo: "Cerca", categoria: "BENFEITORIA", ativo: true },
      { id: "5", nome_tipo: "Vacina", categoria: "MANEJO_ANIMAL", ativo: true },
      { id: "6", nome_tipo: "Sem categoria" },
      null,
    ];
    expect(operacoesDoTipoFixo(todas, "PASTAGEM").map((o) => o.nome_tipo)).toEqual(["Capina", "Roçada"]);
    expect(operacoesDoTipoFixo(todas, "BENFEITORIA").map((o) => o.nome_tipo)).toEqual(["Cerca"]);
    expect(operacoesDoTipoFixo(todas, "OUTROS").map((o) => o.nome_tipo)).toEqual(["Sem categoria", "Vacina"]);
    expect(operacoesDoTipoFixo(todas, "APLICACAO")).toEqual([]);
    expect(operacoesDoTipoFixo(undefined, "OUTROS")).toEqual([]);
  });
});
