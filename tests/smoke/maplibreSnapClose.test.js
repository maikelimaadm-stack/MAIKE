import { describe, expect, it, vi } from "vitest";
import { isNearFirstVertex, isNearAnyVertex } from "@/lib/maplibre/snap.js";

function fakeMap(projectFn) {
  return {
    project: (ll) => {
      // MapLibre project expects [lng, lat]
      const lng = Array.isArray(ll) ? ll[0] : ll.lng;
      const lat = Array.isArray(ll) ? ll[1] : ll.lat;
      return projectFn(lng, lat);
    },
  };
}

describe("R5-02 isNearFirstVertex", () => {
  const pts = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
  ];

  // Pixel space: first at (0,0), #2 at (100,0), #3 at (100,100)
  const map = fakeMap((lng, lat) => ({ x: lng * 100, y: lat * 100 }));

  it("fecha perto do primeiro vértice com ≥3 distintos", () => {
    expect(isNearFirstVertex(map, { lat: 0.05, lng: 0.05 }, pts, 20)).toBe(true);
  });

  it("NÃO fecha perto do vértice #2", () => {
    expect(isNearFirstVertex(map, { lat: 0, lng: 1 }, pts, 20)).toBe(false);
  });

  it("NÃO fecha com menos de 3 vértices", () => {
    expect(isNearFirstVertex(map, { lat: 0, lng: 0 }, pts.slice(0, 2), 20)).toBe(false);
  });

  it("NÃO fecha com 3 vértices colapsados no mesmo ponto", () => {
    const same = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
    ];
    expect(isNearFirstVertex(map, { lat: 0, lng: 0 }, same, 20)).toBe(false);
  });

  it("alias isNearAnyVertex delega para first-only", () => {
    expect(isNearAnyVertex(map, { lat: 0, lng: 1 }, pts, 20)).toBe(false);
    expect(isNearAnyVertex(map, { lat: 0, lng: 0 }, pts, 20)).toBe(true);
  });
});
