/**
 * D-PROD-126 — rótulos de área sem bagunça: todos no MESMO nível (nome + ha,
 * só o nome, ou só a sigla), nunca uns sim e outros não.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { centroideArea, escolherModoRotulos, fontesRotuloPorZoom, pontoMaisDentro, siglaDaArea } from "@/lib/maplibre/mapaGeralRender.js";
import { pointInPolygonRing } from "@/lib/maplibre/taskLocationPicker.js";

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

  it("obstáculos por nível: o ícone que só bate no nível 'tudo' derruba para 'nome', não para a sigla", () => {
    const r = [rot("a", cx(0, 0, 100, 100), cx(10, 10, 40, 30))];
    const icone = cx(10, 35, 40, 10); // encosta na parte de baixo (o "ha") só no layout "tudo"
    expect(escolherModoRotulos(r, { tudo: [icone], nome: [] })).toBe("nome");
    expect(escolherModoRotulos(r, { tudo: [], nome: [] })).toBe("tudo");
  });

  it("o ícone do lote da própria área não conta contra o nome dela (revisão Cursor no #194)", () => {
    const r = [rot("a", cx(0, 0, 100, 100), cx(10, 47, 40, 30))];
    const proprio = { ...cx(10, 0, 40, 46.5), dono: "a" }; // meio pixel de arredondamento
    expect(escolherModoRotulos(r, [proprio])).toBe("tudo");
    expect(escolherModoRotulos(r, [{ ...proprio, dono: "b" }])).not.toBe("tudo");
  });

  it("uma área minúscula entre muitas não derruba o mapa para a sigla (tolerância 10%)", () => {
    const r = Array.from({ length: 12 }, (_, i) => rot(`a${i}`, cx(i * 200, 0, 150, 100), cx(i * 200 + 10, 10, 40, 24)));
    r.push(rot("mini", cx(5000, 0, 10, 5), cx(5000, 0, 40, 24)));
    expect(escolherModoRotulos(r)).toBe("tudo");
  });

  it("o renderer reaplica a cada movimento/zoom e quando os lotes mudam, e troca o texto pela sigla", () => {
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(r).toMatch(/map\.on\("moveend", handler\)/);
    // mede cada nível já na posição final e o nome sozinho (revisão Codex no #194)
    expect(r).toMatch(/aplicar\("tudo"\);\s*const comTudo = medir\(\);\s*aplicar\("nome"\);\s*const soNome = medir\(\);/);
    expect(r).toMatch(/escolherModoRotulos\(itens, \{ tudo: comTudo\.obstaculos, nome: soNome\.obstaculos \}\)/);
    expect(r).toMatch(/entry\.titulo\.textContent = modo === "sigla" \? entry\.sigla : entry\.nome;/);
    expect(r).not.toMatch(/visibility = d === "nada"/);
    expect((r.match(/agendarArrumar\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("pontoMaisDentro — nome e lote no miolo da área torta (D-PROD-127)", () => {
  // distância (em graus) do ponto à borda mais próxima
  const borda = (p, ring) => Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b.lng - a.lng, dy = b.lat - a.lat;
    const t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.lng - (a.lng + dx * t), p.lat - (a.lat + dy * t));
  }));

  it("quadrado: o centro", () => {
    const q = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.02 }, { lat: -0.02, lng: 0.02 }, { lat: -0.02, lng: 0 }];
    const p = pontoMaisDentro(q);
    expect(p.lat).toBeCloseTo(-0.01, 6);
    expect(p.lng).toBeCloseTo(0.01, 6);
  });

  it("área em L: o ponto fica dentro e bem longe das divisas (o centroide fica colado na quina)", () => {
    // L: perna grossa embaixo, perna fina subindo à esquerda
    const L = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 0.004 }, { lat: -0.012, lng: 0.004 }, { lat: -0.012, lng: 0.02 },
      { lat: -0.02, lng: 0.02 }, { lat: -0.02, lng: 0 },
    ];
    const p = pontoMaisDentro(L);
    expect(pointInPolygonRing(p, L)).toBe(true);
    const c = { lat: L.reduce((t, v) => t + v.lat, 0) / L.length, lng: L.reduce((t, v) => t + v.lng, 0) / L.length };
    expect(borda(p, L)).toBeGreaterThan(borda(c, L) * 2);
    expect(borda(p, L)).toBeGreaterThan(0.0025); // ≥ 70% da folga máxima (0,004)
  });

  it("faixa comprida (torta): o nome vai para o meio da faixa, não para uma ponta", () => {
    // paralelogramo comprido e inclinado
    const faixa = [{ lat: 0, lng: 0 }, { lat: 0.004, lng: 0.04 }, { lat: 0.0, lng: 0.04 }, { lat: -0.004, lng: 0 }];
    const p = pontoMaisDentro(faixa);
    expect(pointInPolygonRing(p, faixa)).toBe(true);
    expect(p.lng).toBeGreaterThan(0.016);
    expect(p.lng).toBeLessThan(0.024);
  });

  it("o nome e o ícone do lote usam o mesmo ponto (centroideArea → pontoMaisDentro)", () => {
    const L = [[0, 0], [0, 0.004], [-0.012, 0.004], [-0.012, 0.02], [-0.02, 0.02], [-0.02, 0]];
    const area = { coordenadas: { coords: L } };
    const viaArea = centroideArea(area);
    const direto = pontoMaisDentro(L.map(([lat, lng]) => ({ lat, lng })));
    expect(viaArea).toEqual(direto);
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect((r.match(/centroideArea\(area\)/g) || []).length).toBeGreaterThanOrEqual(3); // rótulo, lote e tarefa
    // D-PROD-128: par ícone + nome centrado no ponto com posições FIXAS — nada
    // depende da altura do nome nem da imagem; sem lote, nome centrado por CSS
    expect(r).toMatch(/lote\.marker\.setOffset\(PAR_LOTE\.icone\);\s*entry\.marker\.setOffset\(PAR_LOTE\.nome\);/);
    expect(r).toMatch(/entry\.marker\.setOffset\(\[0, 0\]\);\s*entry\.corpo\.style\.transform = "translateY\(-50%\)";/);
    expect(r).toMatch(/icone: \/\*\* @type \{\[number, number\]\} \*\/ \(\[0, -14\]\)/);
    expect(r).toMatch(/nome: \/\*\* @type \{\[number, number\]\} \*\/ \(\[0, 10\]\)/);
    expect(r).not.toMatch(/offsetHeight/);
    // nomes desligados: o lote volta à posição padrão (revisão Cursor no #194)
    expect(r).toMatch(/!labelsRef\.current\.has\(key\.slice\("lote_area_"\.length\)\)\) entry\.marker\.setOffset\(OFFSET_LOTE_PX\)/);
    expect(r.indexOf("entry.marker.setOffset(OFFSET_LOTE_PX)")).toBeLessThan(r.indexOf("if (!labelsRef.current.size) return;"));
  });
});

describe("nome do pasto acompanha o zoom (D-PROD-129)", () => {
  it("fonte suave: cresce ao aproximar, diminui ao afastar, sem pulos grandes", () => {
    expect(fontesRotuloPorZoom(10)).toEqual({ nome: 10, ha: 9 });
    expect(fontesRotuloPorZoom(18)).toEqual({ nome: 12, ha: 11 });
    let antes = fontesRotuloPorZoom(12).nome;
    for (let z = 12.1; z <= 18; z += 0.1) {
      const agora = fontesRotuloPorZoom(z).nome;
      expect(agora).toBeGreaterThanOrEqual(antes);
      expect(agora - antes).toBeLessThanOrEqual(0.25);
      antes = agora;
    }
  });

  it("durante o zoom a fonte e o nível são revistos (não só no fim); o ícone não muda", () => {
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(r).toMatch(/map\.on\("zoom", h\)/);
    expect(r).not.toMatch(/map\.on\("zoomend"/);
    expect(r).toMatch(/labelsRef\.current\.forEach\(aplicarFonte\);\s*arrumarDuranteZoom\(\);/);
    expect(r).toMatch(/if \(agora - ultimoArrumarRef\.current < 120\) return;/);
    // ícone do lote: posição fixa do D-PROD-128, sem escala por zoom
    expect(r).toMatch(/lote\.marker\.setOffset\(PAR_LOTE\.icone\);/);
    expect(r).not.toMatch(/scale\(/);
  });
});
