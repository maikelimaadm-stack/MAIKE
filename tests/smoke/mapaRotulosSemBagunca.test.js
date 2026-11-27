/**
 * D-PROD-126 — rótulos de área sem bagunça: todos no MESMO nível (nome + ha,
 * só o nome, ou só a sigla), nunca uns sim e outros não.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { centroideArea, escalaRotulo, escolherModoRotulos, fontesRotuloPorZoom, pontoEFolga, pontoMaisDentro, siglaDaArea } from "@/lib/maplibre/mapaGeralRender.js";
import { pointInPolygonRing } from "@/lib/maplibre/taskLocationPicker.js";
import { OFFSET_LOTE_COM_NOME_PX, OFFSET_LOTE_PX, camadasLotes } from "@/lib/maplibre/lotesNoMapa.js";
import { DESLOC_NOME_COM_LOTE_PX, camadasNomes, expressaoTamanhoNome, tamanhoNoZoom } from "@/lib/maplibre/nomesNoMapa.js";

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
    // D-PROD-354: cada nível já na posição final (caixaDoNome, com e sem lote) e o nome sozinho, sem medir elemento
    expect(r).toMatch(/tudo: caixaDoNome\(p, n\.niveis\.tudo\.medida, zoom, comLote\),\s*nome: caixaDoNome\(p, n\.niveis\.nome\.medida, zoom, comLote\),/);
    expect(r).toMatch(/escolherModoRotulos\(itens, \{ tudo: obstaculosLotes, nome: obstaculosLotes \}\)/);
    // o nível vale para todos: uma publicação com o mesmo nível em todos os nomes (o funcionamento em nomesNoMapaD354)
    expect(r).toMatch(/const d = n\.niveis\[nivel\];/);
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
    // rótulo no renderer; lote e tarefa nos itens do Mapa Geral (D-PROD-369: os mesmos para o MapLibre e o Google)
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    const itens = readFileSync("src/lib/maplibre/itensDoMapaGeral.js", "utf8");
    expect((r.match(/centroideArea\(area\)/g) || []).length).toBeGreaterThanOrEqual(1);
    expect((itens.match(/centroideArea\(area\)/g) || []).length).toBeGreaterThanOrEqual(2);
    // D-PROD-128: par ícone + nome centrado no ponto com posições FIXAS — nada depende da altura do nome nem da imagem.
    // D-PROD-349: o ícone é desenhado pelo mapa (`comRotulo` na fonte); D-PROD-354: o nome também — com lote, o topo
    // 10 px abaixo do ponto (icon-translate, que o icon-size não escala); sem lote, centrado no ponto.
    expect(OFFSET_LOTE_COM_NOME_PX).toEqual([0, -14]);
    expect(DESLOC_NOME_COM_LOTE_PX).toEqual([0, 10]);
    const [semLote, comLote] = camadasNomes();
    expect(semLote.layout["icon-anchor"]).toBe("center");
    expect(comLote.layout["icon-anchor"]).toBe("top");
    expect(comLote.paint["icon-translate"]).toEqual([0, 10]);
    expect(r).not.toMatch(/offsetHeight/);
    // nomes desligados: o lote volta à posição padrão (revisão Cursor no #194) — `comRotulo` é ter nome, e a fonte é
    // publicada antes do retorno "sem nomes"
    expect(OFFSET_LOTE_PX).toEqual([0, -26]);
    expect(r).toMatch(/const comRotulo = nomesRef\.current\.has\(areaId\);/);
    const arrumar = r.slice(r.indexOf("const arrumarNomes = (opcoes) =>"));
    expect(arrumar.indexOf("publicarLotes();")).toBeGreaterThan(-1);
    expect(arrumar.indexOf("publicarLotes();")).toBeLessThan(arrumar.indexOf("if (!nomesRef.current.size) {"));
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

  it("durante o zoom a letra acompanha (pelo próprio mapa) e o nível é revisto (não só no fim); o ícone não muda", () => {
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(r).toMatch(/map\.on\("zoom", h\)/);
    expect(r).not.toMatch(/map\.on\("zoomend"/);
    // D-PROD-354: a letra acompanha o zoom no `icon-size` da camada dos nomes (paradas = letra ÷ 12 × encaixe)
    for (const camada of camadasNomes()) expect(camada.layout["icon-size"]).toEqual(expressaoTamanhoNome());
    expect(tamanhoNoZoom({ w: 40, h: 13 }, null, 13)).toBeCloseTo(fontesRotuloPorZoom(13).nome / 12, 10);
    expect(tamanhoNoZoom({ w: 40, h: 13 }, null, 17)).toBe(1);
    // o nível é revisto no zoom no máximo a cada 120 ms
    expect(r).toMatch(/arrumarDuranteZoom\(\);/);
    expect(r).toMatch(/if \(agora - ultimoArrumarRef\.current < 120\) return;/);
    // ícone do lote: posição fixa do D-PROD-128, sem escala por zoom (camada sem icon-size nem expressão de zoom)
    for (const camada of camadasLotes()) {
      expect(camada.layout["icon-size"]).toBeUndefined();
      expect(JSON.stringify(camada)).not.toMatch(/"zoom"/);
    }
    // nada é escalado por CSS
    expect(r).not.toMatch(/scale\(/);
  });
});

describe("nome do tamanho do pasto (D-PROD-130)", () => {
  it("cabe no círculo livre do ponto; nunca maior que o normal nem menor que 60%", () => {
    expect(escalaRotulo(40, 13, 100)).toBe(1);
    expect(escalaRotulo(40, 13, 18)).toBeCloseTo((2 * 18 * 0.95) / Math.hypot(40, 13), 2);
    expect(escalaRotulo(80, 26, 5)).toBe(0.6);
    expect(escalaRotulo(40, 13, null)).toBe(1);
  });

  it("no zoom o nome encolhe na mesma proporção do pasto (×2 por nível) até o mínimo", () => {
    const r0 = 14; // folga em px no zoom de referência
    const s0 = escalaRotulo(30, 13, r0);
    const s1 = escalaRotulo(30, 13, r0 * Math.pow(2, -0.25)); // afastou ¼ de nível
    expect(s1).toBeLessThan(s0);
    expect(s1 / s0).toBeCloseTo(Math.pow(2, -0.25), 1);
    expect(escalaRotulo(30, 13, r0 * Math.pow(2, -3))).toBe(0.6); // muito afastado: mínimo legível
  });

  it("pontoEFolga: mesmo ponto do pontoMaisDentro e a folga até a borda", () => {
    const q = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.02 }, { lat: -0.02, lng: 0.02 }, { lat: -0.02, lng: 0 }];
    const pf = pontoEFolga(q);
    expect({ lat: pf.lat, lng: pf.lng }).toEqual(pontoMaisDentro(q));
    expect(pf.folga).toBeCloseTo(0.01, 4);
  });
});
