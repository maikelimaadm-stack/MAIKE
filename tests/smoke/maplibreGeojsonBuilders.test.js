import { describe, expect, it } from "vitest";
import {
  buildAreasCollection,
  buildDesenhoCollection,
  buildVerticesCollection,
  buildMidpointsCollection,
} from "@/lib/maplibre/geojsonBuilders.js";

describe("maplibre/geojsonBuilders", () => {
  const area = {
    id: "a1",
    nome: "Piquete 1",
    cor: "#0d67ad",
    coordenadas: {
      cor: "#0d67ad",
      coords: [
        [-15, -59],
        [-15.1, -59],
        [-15.1, -58.9],
      ],
    },
  };

  it("monta FeatureCollection de áreas com fill e id", () => {
    const fc = buildAreasCollection([area]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("Polygon");
    expect(fc.features[0].properties.id).toBe("a1");
    expect(fc.features[0].properties.fill).toMatch(/^#/);
  });

  it("omite fill da área em edição (anti-duplicação de overlay)", () => {
    const fc = buildAreasCollection([area], { hideFillForId: "a1" });
    expect(fc.features).toHaveLength(0);
  });

  it("desenho de área com ≥3 pontos vira Polygon; 2 vira LineString", () => {
    const poly = buildDesenhoCollection(
      [
        { lat: -15, lng: -59 },
        { lat: -15.1, lng: -59 },
        { lat: -15.1, lng: -58.9 },
      ],
      "area"
    );
    expect(poly.features[0].geometry.type).toBe("Polygon");
    const line = buildDesenhoCollection(
      [
        { lat: -15, lng: -59 },
        { lat: -15.1, lng: -59 },
      ],
      "area"
    );
    expect(line.features[0].geometry.type).toBe("LineString");
  });

  it("vértices e midpoints têm indices e roles", () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    const verts = buildVerticesCollection(pts);
    expect(verts.features).toHaveLength(3);
    expect(verts.features[1].properties.role).toBe("vertex");
    const mids = buildMidpointsCollection(pts, "area");
    expect(mids.features).toHaveLength(3);
    expect(mids.features[0].properties.role).toBe("midpoint");
  });

  it("aceita vértice com latitude 0", () => {
    const fc = buildAreasCollection([
      {
        id: "z",
        coordenadas: {
          coords: [
            [0, -50],
            [0.1, -50],
            [0.1, -49.9],
          ],
        },
      },
    ]);
    expect(fc.features).toHaveLength(1);
  });
});
