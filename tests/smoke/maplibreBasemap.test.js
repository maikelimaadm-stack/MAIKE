import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("maplibre/basemap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_MAP_SATELLITE_STYLE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("provider de ruas aponta para OpenFreeMap Liberty", async () => {
    const mod = await import("@/lib/maplibre/basemap.js");
    expect(mod.PROVIDER_RUAS.configured).toBe(true);
    expect(mod.PROVIDER_RUAS.styleUrl).toBe(mod.OPENFREEMAP_LIBERTY_STYLE_URL);
    expect(mod.PROVIDER_RUAS.attribution).toMatch(/OpenStreetMap/i);
  });

  it("satélite sem env fica não configurado com mensagem honesta", async () => {
    const {
      getSatelliteProvider,
      mensagemSateliteNaoConfigurado,
      resolveBasemapProvider,
      BASEMAP_IDS,
    } = await import("@/lib/maplibre/basemap.js");
    const sat = getSatelliteProvider();
    expect(sat.configured).toBe(false);
    expect(sat.styleUrl).toBeNull();
    expect(mensagemSateliteNaoConfigurado()).toMatch(/não configurado/i);
    expect(resolveBasemapProvider(BASEMAP_IDS.SATELITE).id).toBe(BASEMAP_IDS.RUAS);
  });

  it("satélite com URL https válida fica configurado", async () => {
    vi.stubEnv("VITE_MAP_SATELLITE_STYLE_URL", "https://tiles.example.com/styles/sat.json");
    vi.resetModules();
    const { getSatelliteProvider, resolveBasemapProvider, BASEMAP_IDS } = await import(
      "@/lib/maplibre/basemap.js"
    );
    const sat = getSatelliteProvider();
    expect(sat.configured).toBe(true);
    expect(sat.styleUrl).toBe("https://tiles.example.com/styles/sat.json");
    expect(resolveBasemapProvider(BASEMAP_IDS.SATELITE).id).toBe(BASEMAP_IDS.SATELITE);
  });

  it("valida style URL", async () => {
    const { isValidStyleUrl } = await import("@/lib/maplibre/basemap.js");
    expect(isValidStyleUrl("https://a.com/x")).toBe(true);
    expect(isValidStyleUrl("not-a-url")).toBe(false);
    expect(isValidStyleUrl("")).toBe(false);
  });
});
