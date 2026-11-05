/**
 * D-PROD-126 — rótulos de área sem bagunça: só aparece o que cabe na própria
 * área e não bate em outro rótulo nem em ícone de lote; maiores primeiro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decidirRotulos } from "@/lib/maplibre/mapaGeralRender.js";

const cx = (x, y, w, h) => ({ x, y, w, h });
const rot = (id, area, tudo, nome = cx(tudo.x, tudo.y, tudo.w, tudo.h / 2)) => ({ id, area, tudo, nome });

describe("decidirRotulos (D-PROD-126)", () => {
  it("dois rótulos que se batem: fica o da área maior", () => {
    const d = decidirRotulos([
      rot("pequena", cx(0, 0, 60, 40), cx(10, 10, 50, 24)),
      rot("grande", cx(0, 0, 200, 120), cx(20, 12, 50, 24)),
    ]);
    expect(d.get("grande")).toBe("tudo");
    expect(d.get("pequena")).toBe("nada");
  });

  it("rótulo maior que a área: tenta só o nome; se nem o nome cabe, some", () => {
    const d = decidirRotulos([
      rot("so-nome", cx(0, 0, 60, 14), cx(0, 0, 50, 26), cx(0, 0, 50, 13)),
      rot("some", cx(300, 0, 20, 10), cx(300, 0, 50, 26), cx(300, 0, 50, 13)),
    ]);
    expect(d.get("so-nome")).toBe("nome");
    expect(d.get("some")).toBe("nada");
  });

  it("ícone de lote é obstáculo; sem conflito, todos aparecem", () => {
    const d = decidirRotulos([rot("a", cx(0, 0, 100, 100), cx(10, 10, 40, 20)), rot("b", cx(200, 0, 100, 100), cx(210, 10, 40, 20))], [cx(205, 5, 44, 44)]);
    expect(d.get("a")).toBe("tudo");
    expect(d.get("b")).toBe("nada");
    const livre = decidirRotulos([rot("a", cx(0, 0, 100, 100), cx(10, 10, 40, 20)), rot("b", cx(200, 0, 100, 100), cx(210, 10, 40, 20))]);
    expect([...livre.values()]).toEqual(["tudo", "tudo"]);
  });

  it("o renderer refaz a escolha a cada movimento/zoom e quando os lotes mudam", () => {
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(r).toMatch(/map\.on\("moveend", handler\)/);
    expect(r).toMatch(/decidirRotulos\(itens, obstaculos\)/);
    expect((r.match(/agendarArrumar\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
