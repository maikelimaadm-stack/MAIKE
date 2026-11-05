/**
 * D-PROD-126 — rótulos de área sem bagunça: todos no MESMO nível (nome + ha,
 * só o nome, ou só a sigla), nunca uns sim e outros não.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { escolherModoRotulos, siglaDaArea } from "@/lib/maplibre/mapaGeralRender.js";

const cx = (x, y, w, h) => ({ x, y, w, h });
/** rótulo com caixa "tudo" (nome + ha) e "nome" (metade de cima) */
const rot = (id, area, tudo) => ({ id, area, tudo, nome: cx(tudo.x, tudo.y, tudo.w * 0.8, tudo.h / 2) });

describe("siglaDaArea (D-PROD-126)", () => {
  it("usa a sigla do cadastro; sem ela, o nome sem o prefixo", () => {
    expect(siglaDaArea({ nome: "KM - 01", sigla: "K1" })).toBe("K1");
    expect(siglaDaArea({ nome: "KM - 01" })).toBe("01");
    expect(siglaDaArea({ nome: "KM - 07 A", sigla: "  " })).toBe("07 A");
    expect(siglaDaArea({ nome: "MT-12" })).toBe("12");
    expect(siglaDaArea({ nome: "Retiro" })).toBe("Retiro");
  });
});

describe("escolherModoRotulos (D-PROD-126)", () => {
  it("cabe tudo → nome + ha para todos", () => {
    expect(escolherModoRotulos([rot("a", cx(0, 0, 100, 100), cx(10, 10, 40, 24)), rot("b", cx(200, 0, 100, 100), cx(210, 10, 40, 24))])).toBe("tudo");
  });

  it("o ha bate, o nome não → só o nome para todos", () => {
    // caixas "tudo" se encostam na vertical; os nomes (metade de cima) não
    const r = [rot("a", cx(0, 0, 100, 30), cx(10, 0, 40, 30)), rot("b", cx(0, 30, 100, 30), cx(10, 26, 40, 30))];
    expect(escolherModoRotulos(r)).toBe("nome");
  });

  it("nem o nome cabe → só a sigla para todos", () => {
    const r = [rot("a", cx(0, 0, 20, 10), cx(0, 0, 60, 24)), rot("b", cx(30, 0, 20, 10), cx(30, 0, 60, 24))];
    expect(escolherModoRotulos(r)).toBe("sigla");
  });

  it("uma área minúscula entre muitas não derruba o mapa para a sigla (tolerância 10%)", () => {
    const r = Array.from({ length: 12 }, (_, i) => rot(`a${i}`, cx(i * 200, 0, 150, 100), cx(i * 200 + 10, 10, 40, 24)));
    r.push(rot("mini", cx(5000, 0, 10, 5), cx(5000, 0, 40, 24)));
    expect(escolherModoRotulos(r)).toBe("tudo");
  });

  it("o renderer reaplica a cada movimento/zoom e quando os lotes mudam, e troca o texto pela sigla", () => {
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(r).toMatch(/map\.on\("moveend", handler\)/);
    expect(r).toMatch(/escolherModoRotulos\(itens, obstaculos\)/);
    expect(r).toMatch(/if \(modo === "sigla"\) entry\.titulo\.textContent = entry\.sigla;/);
    expect(r).not.toMatch(/visibility = d === "nada"/);
    expect((r.match(/agendarArrumar\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
