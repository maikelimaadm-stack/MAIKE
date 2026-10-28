import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("R6-01/R6-02 source contracts", () => {
  const src = readFileSync("src/components/mapa/MapaDesenho.jsx", "utf8");

  it("R6-01 — trocarBasemap reconstrói overlays via rehydrate (não clearLabels solto)", () => {
    expect(src).toContain("rebuildOverlayMarkers");
    expect(src).toContain("rehydrateAllSources(map)");
    // Não pode terminar o onReady só com clearLabels()
    const onReadyBlock = src.slice(src.indexOf("trocarBasemap"), src.indexOf("finalizarDesenho"));
    expect(onReadyBlock).toContain("rehydrateAllSources(map)");
    expect(onReadyBlock).not.toMatch(/onReady:\s*\(\)\s*=>\s*\{[^}]*clearLabels\(\);\s*\}/);
  });

  it("R6-02 — retryMap não zera innerHTML antes do cleanup", () => {
    const retryBlock = src.slice(src.indexOf("const retryMap"), src.indexOf("const crosshair"));
    expect(retryBlock).toContain("setMapEpoch");
    expect(retryBlock).not.toMatch(/innerHTML\s*=\s*[\"'][\"']/);
    expect(retryBlock).not.toMatch(/mapRef\.current\.innerHTML/);
  });

  it("R6 — decisão MapLibre referida como D-PROD-58 no relatório", () => {
    const report = readFileSync("docs/engineering/MAPLIBRE-M1-EDITOR-AREAS-REPORT.md", "utf8");
    expect(report).toMatch(/D-PROD-58/);
  });
});
