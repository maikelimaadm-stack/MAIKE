import { describe, expect, it, vi } from "vitest";
import {
  commitDragTransaction,
  geometryChanged,
  resolvePontoIconUrl,
  hitEditLayers,
} from "@/lib/maplibre/editorInteraction.js";
import { validatePolygonForSave, validateLineForSave, inspectVertices } from "@/lib/geografia";

describe("R5-03 drag undo transaction", () => {
  it("não commit se geometria igual", () => {
    const before = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ];
    const after = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ];
    expect(geometryChanged(before, after)).toBe(false);
    const tx = commitDragTransaction({ undo: [], redo: [[{ lat: 9, lng: 9 }]], before, after });
    expect(tx.committed).toBe(false);
    expect(tx.undo).toHaveLength(0);
    expect(tx.redo).toHaveLength(1);
  });

  it("um único undo e zera redo quando mudou", () => {
    const before = [{ lat: 0, lng: 0 }];
    const after = [{ lat: 1, lng: 1 }];
    const tx = commitDragTransaction({
      undo: [[{ lat: -1, lng: -1 }]],
      redo: [[{ lat: 9, lng: 9 }]],
      before,
      after,
    });
    expect(tx.committed).toBe(true);
    expect(tx.undo).toHaveLength(2);
    expect(tx.redo).toHaveLength(0);
    expect(tx.undo[1]).toEqual(before);
  });
});

describe("R5-07 resolvePontoIconUrl", () => {
  it("usa icone_url do ponto primeiro", () => {
    expect(
      resolvePontoIconUrl(
        { icone_url: "a.png", tipo: "COCHO" },
        [{ tipo_entidade: "Ponto", categoria: "COCHO", icone_url: "b.png" }]
      )
    ).toBe("a.png");
  });

  it("cai no cfg por tipo_entidade+categoria quando ponto sem url", () => {
    expect(
      resolvePontoIconUrl(
        { tipo: "COCHO" },
        [{ tipo_entidade: "Ponto", categoria: "COCHO", icone_url: "cfg.png" }]
      )
    ).toBe("cfg.png");
  });

  it("não retorna url se não houver match", () => {
    expect(resolvePontoIconUrl({ tipo: "X" }, [])).toBeNull();
  });
});

describe("R5-01 hitEditLayers sem project inválido", () => {
  it("consulta por pixel [x,y] e layers existentes", () => {
    const map = {
      getLayer: (id) => (id === "m1-vertices" ? { id } : null),
      queryRenderedFeatures: vi.fn(() => [{ id: 1 }]),
    };
    expect(hitEditLayers(map, 10, 20, ["m1-vertices", "m1-midpoints"])).toBe(true);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith([10, 20], {
      layers: ["m1-vertices"],
    });
  });

  it("retorna false sem features", () => {
    const map = {
      getLayer: () => ({ id: "x" }),
      queryRenderedFeatures: () => [],
    };
    expect(hitEditLayers(map, 0, 0, ["x"])).toBe(false);
  });
});

describe("R5-08 validação persistência", () => {
  it("rejeita polígono degenerado / colinear", () => {
    const colinear = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.02 },
    ];
    const r = validatePolygonForSave(colinear);
    expect(r.ok).toBe(false);
  });

  it("aceita polígono com área > 0", () => {
    const square = [
      { lat: -15.0, lng: -59.0 },
      { lat: -15.0, lng: -58.99 },
      { lat: -15.01, lng: -58.99 },
      { lat: -15.01, lng: -59.0 },
    ];
    expect(validatePolygonForSave(square).ok).toBe(true);
  });

  it("linha rejeita pontos consecutivos duplicados / comprimento 0", () => {
    expect(validateLineForSave([{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }]).ok).toBe(false);
    expect(validateLineForSave([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }]).ok).toBe(true);
  });

  it("inspectVertices não esconde inválidos", () => {
    const r = inspectVertices([[1, 2], ["x", 3], [0, 0]]);
    expect(r.ok).toBe(false);
    expect(r.invalidCount).toBe(1);
    expect(r.vertices).toHaveLength(2);
  });
});
