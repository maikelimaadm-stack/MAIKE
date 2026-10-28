import { describe, expect, it } from "vitest";
import {
  parseVertex,
  parseVertices,
  latLngToLngLat,
  lngLatToLatLng,
  roundTripLatLng,
  toPersistedCoords,
  toGeoJsonPolygon,
  toOpenRingLngLat,
  isValidPolygonRing,
  stripClosingVertex,
} from "@/lib/geografia/coords.js";

describe("geografia/coords adapters", () => {
  it("aceita [lat,lng] e {lat,lng}, inclusive zero legítimo", () => {
    expect(parseVertex([0, -59])).toEqual({ lat: 0, lng: -59 });
    expect(parseVertex([-15, 0])).toEqual({ lat: -15, lng: 0 });
    expect(parseVertex({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
    expect(parseVertex([null, -59])).toBeNull();
    expect(parseVertex({ lat: undefined, lng: 1 })).toBeNull();
  });

  it("não confunde 0 com ausente (nunca ||)", () => {
    const v = parseVertex([0, 0]);
    expect(v).toEqual({ lat: 0, lng: 0 });
    expect(toPersistedCoords([v])).toEqual([[0, 0]]);
  });

  it("round-trip lat/lng ↔ lng/lat sem deriva", () => {
    const samples = [
      { lat: -15, lng: -59 },
      { lat: 0, lng: 0 },
      { lat: -23.5505, lng: -46.6333 },
      { lat: 90, lng: 180 },
      { lat: -90, lng: -180 },
    ];
    for (const s of samples) {
      const rt = roundTripLatLng(s);
      expect(rt).toEqual(s);
      expect(lngLatToLatLng(latLngToLngLat(s))).toEqual(s);
    }
  });

  it("serializa payload sem closing vertex duplicado", () => {
    const pts = [
      { lat: -15, lng: -59 },
      { lat: -15.1, lng: -59 },
      { lat: -15.1, lng: -58.9 },
      { lat: -15, lng: -59 },
    ];
    expect(toPersistedCoords(pts)).toEqual([
      [-15, -59],
      [-15.1, -59],
      [-15.1, -58.9],
    ]);
  });

  it("GeoJSON Polygon fecha o anel sem duplicar no payload", () => {
    const pts = parseVertices([
      [-15, -59],
      [-15.1, -59],
      [-15.1, -58.9],
    ]);
    const g = toGeoJsonPolygon(pts);
    expect(g.type).toBe("Polygon");
    const ring = g.coordinates[0];
    expect(ring.length).toBe(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(toOpenRingLngLat(pts)).toEqual([
      [-59, -15],
      [-59, -15.1],
      [-58.9, -15.1],
    ]);
    expect(toPersistedCoords(pts).length).toBe(3);
  });

  it("rejeita polígono com menos de 3 vértices distintos", () => {
    expect(isValidPolygonRing([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).toBe(false);
    expect(isValidPolygonRing([
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 1 },
    ])).toBe(false);
    expect(isValidPolygonRing([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ])).toBe(true);
  });

  it("stripClosingVertex preserva ordem", () => {
    const open = stripClosingVertex([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
      { lat: 1, lng: 1 },
    ]);
    expect(open).toEqual([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
  });

  it("rejeita latitude/longitude fora do range", () => {
    expect(parseVertex([91, 0])).toBeNull();
    expect(parseVertex([0, 181])).toBeNull();
    expect(parseVertex([-91, 0])).toBeNull();
  });
});
