import { describe, expect, it } from "vitest";
import { areaHectares, comprimentoMetros, formatHectaresPt, formatDistanciaPt } from "@/lib/geografia/medidas.js";

describe("geografia/medidas", () => {
  it("calcula área > 0 para polígono válido e 0 para inválido", () => {
    const square = [
      { lat: -15.0, lng: -59.0 },
      { lat: -15.0, lng: -58.99 },
      { lat: -15.01, lng: -58.99 },
      { lat: -15.01, lng: -59.0 },
    ];
    const ha = areaHectares(square);
    expect(ha).toBeGreaterThan(0);
    expect(ha).toBeLessThan(200);
    expect(areaHectares([{ lat: 0, lng: 0 }])).toBe(0);
  });

  it("comprimento geodésico de segmento conhecido (ordem de grandeza)", () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    const m = comprimentoMetros(line);
    // ~1113 m no equador
    expect(m).toBeGreaterThan(1000);
    expect(m).toBeLessThan(1200);
  });

  it("formata pt-BR", () => {
    expect(formatHectaresPt(12.345)).toMatch(/12/);
    expect(formatDistanciaPt(500)).toMatch(/500/);
    expect(formatDistanciaPt(2500)).toMatch(/km/i);
  });
});
