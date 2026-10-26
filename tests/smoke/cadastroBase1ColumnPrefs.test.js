import { describe, it, expect } from "vitest";
import {
  normalizeColumnWidths,
  normalizeAutoFitKeys,
  normalizeFrozenCount,
  CADASTRO_B1_COLUMN_PREFS_VERSION,
} from "@/lib/cadastroBase1ColumnPrefs";

describe("cadastroBase1ColumnPrefs — paridade CDE (355–356)", () => {
  const known = ["nome", "descricao"];

  it("largura mínima 48px (grade mg-grid)", () => {
    const defaults = { nome: 160, descricao: 200 };
    const out = normalizeColumnWidths(defaults, { nome: 30, descricao: 48 }, known);
    expect(out.nome).toBe(160);
    expect(out.descricao).toBe(48);
  });

  it("autoFit é conjunto de ids conhecidos", () => {
    const set = normalizeAutoFitKeys(["nome", "x", "nome"], known);
    expect([...set]).toEqual(["nome"]);
  });

  it("congelamento não zera autoFit (só ajusta contagem)", () => {
    expect(normalizeFrozenCount(2, 5)).toBe(2);
    expect(normalizeFrozenCount(99, 3)).toBe(3);
  });

  it("versão unificada do JSON de prefs", () => {
    expect(CADASTRO_B1_COLUMN_PREFS_VERSION).toBe(1);
  });
});
