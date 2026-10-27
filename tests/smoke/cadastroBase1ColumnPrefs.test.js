import { describe, it, expect } from "vitest";
import {
  clampColumnPrefsToVisible,
  normalizeColumnWidths,
  normalizeAutoFitKeys,
  normalizeFrozenCount,
  CADASTRO_B1_COLUMN_PREFS_VERSION,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
} from "@/lib/cadastroBase1ColumnPrefs";
import { AUTOFIT_MAX_COL_WIDTH } from "@/lib/larguraColuna";

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

  it("teto autofit 480px e piso 48px alinhados (contrato D-PROD-42)", () => {
    expect(AUTOFIT_MAX_COL_WIDTH).toBe(480);
    expect(MIN_COL_WIDTH).toBe(48);
    expect(MAX_COL_WIDTH).toBeGreaterThan(AUTOFIT_MAX_COL_WIDTH);
  });

  it("clamp após ocultar colunas no diálogo (paridade list.tsx onApply)", () => {
    const out = clampColumnPrefsToVisible(
      { frozenCount: 4, autoFitKeys: new Set(["nome", "descricao", "numero"]) },
      ["nome", "descricao"],
    );
    expect(out.frozenCount).toBe(2);
    expect([...out.autoFitKeys]).toEqual(["nome", "descricao"]);
  });
});
