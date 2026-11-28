/**
 * D-PROD-382 (canal de teste) — os pastos e as linhas do mapa do Google não são redesenhados ao abrir o mapa, trocar um
 * filtro ou chegar um dado novo: só o que mudou sai e entra, e o novo entra ANTES do velho sair (nada pisca).
 *
 *  G382-3. `planejarPoligonos`: o que não mudou fica; o que mudou de cor/contorno troca; o que saiu do filtro sai;
 *          iguais repetidos não se perdem.
 *  G382-4. Componente no app: um novo render com os mesmos pastos não mexe no mapa; um filtro tira só os pastos dele;
 *          trocar a cor de um pasto troca só ele, com o novo antes do velho; linhas iguais não são refeitas.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/googleMaps", () => ({ loadGoogleMaps: vi.fn(async () => {}) }));
vi.mock("@capacitor/app", () => ({ App: { getInfo: vi.fn(async () => ({ build: "9" })) } }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    registerPlugin: () => ({ addListener: async () => ({ remove: () => {} }) }),
    Capacitor: { ...real.Capacitor, isNativePlatform: () => true, getPlatform: () => "android", isPluginAvailable: () => true },
  };
});

const falso = vi.hoisted(() => ({ mapa: /** @type {any} */ (null), ordem: /** @type {string[]} */ ([]) }));
vi.mock("@capacitor/google-maps", () => ({
  GoogleMap: {
    create: vi.fn(async () => {
      let n = 0;
      const ids = (l, p) => l.map(() => `${p}${++n}`);
      const registrar = (nome, fn) => vi.fn(async (l) => (falso.ordem.push(nome), fn(l)));
      falso.mapa = {
        id: "mapa-1",
        setMapType: vi.fn(async () => {}),
        addPolygons: registrar("addPolygons", (l) => ids(l, "p")),
        removePolygons: registrar("removePolygons", () => {}),
        addPolylines: registrar("addPolylines", (l) => ids(l, "l")),
        removePolylines: registrar("removePolylines", () => {}),
        addCircles: vi.fn(async (l) => ids(l, "c")),
        removeCircles: vi.fn(async () => {}),
        addMarkers: vi.fn(async (l) => ids(l, "m")),
        removeMarkers: vi.fn(async () => {}),
        setCamera: vi.fn(async () => {}),
        fitBounds: vi.fn(async () => {}),
        setOnPolygonClickListener: vi.fn(async () => {}),
        setOnPolylineClickListener: vi.fn(async () => {}),
        setOnCameraIdleListener: vi.fn(async () => {}),
        setOnCameraMoveStartedListener: vi.fn(async () => {}),
        setOnMapClickListener: vi.fn(async () => {}),
        setOnMarkerClickListener: vi.fn(async () => {}),
        enableTouch: vi.fn(async () => {}),
        disableTouch: vi.fn(async () => {}),
        destroy: vi.fn(async () => {}),
      };
      return falso.mapa;
    }),
  },
}));

import { planejarPoligonos, poligonosDasAreas } from "@/lib/mapaNativo/mapaGoogleNativo.js";
import MapaGoogleNativo from "@/components/mapa/MapaGoogleNativo.jsx";

const pasto = (id, lat, cor = "#22aa22") => ({ id, nome: `Pasto ${id}`, cor, coordenadas: { coords: [[lat, -47], [lat, -46.99], [lat - 0.01, -46.99], [lat - 0.01, -47]] } });
const LINHA = { id: 7, nome: "Cerca", coordenadas: { coords: [[-15, -47], [-15.01, -47.01]], cor: "#ff0000" } };

let antesGetContext;
let antesToDataURL;
beforeEach(() => {
  falso.mapa = null;
  falso.ordem = [];
  localStorage.clear();
  globalThis.devicePixelRatio = 2;
  antesGetContext = HTMLCanvasElement.prototype.getContext;
  antesToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = /** @type {any} */ (() => new Proxy({}, { get: (alvo, k) => (k in alvo ? alvo[k] : () => {}), set: (alvo, k, v) => ((alvo[k] = v), true) }));
  HTMLCanvasElement.prototype.toDataURL = function () {
    return `data:image/png;base64,${this.width}x${this.height}`;
  };
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = antesGetContext;
  HTMLCanvasElement.prototype.toDataURL = antesToDataURL;
  vi.clearAllMocks();
});

describe("G382-3 — planejarPoligonos troca só o que mudou", () => {
  const [a, b, c] = poligonosDasAreas([pasto(1, -15), pasto(2, -15.1), pasto(3, -15.2)], () => null, "cheio", 2);

  it("mapa vazio: todos entram; os mesmos de novo: nada entra nem sai", () => {
    const p1 = planejarPoligonos(new Map(), [a, b]);
    expect(p1.entram.map((e) => e.poligono.tag)).toEqual(["1", "2"]);
    expect(p1.saem).toEqual([]);
    const noMapa = new Map(p1.entram.map((e, i) => [e.chave, `p${i}`]));
    // um objeto novo, igual (como num novo render): fica
    const p2 = planejarPoligonos(noMapa, [{ ...a }, { ...b }]);
    expect(p2.entram).toEqual([]);
    expect(p2.saem).toEqual([]);
    expect([...p2.ficam.values()]).toEqual(["p0", "p1"]);
  });

  it("filtro tira um, chega outro, muda a cor de um: só eles trocam", () => {
    const p1 = planejarPoligonos(new Map(), [a, b]);
    const noMapa = new Map(p1.entram.map((e, i) => [e.chave, `p${i}`]));
    const bVermelho = { ...b, fillColor: "#ff0000" };
    const p2 = planejarPoligonos(noMapa, [bVermelho, c]);
    expect(p2.entram.map((e) => [e.poligono.tag, e.poligono.fillColor])).toEqual([["2", "#ff0000"], ["3", c.fillColor]]);
    expect(p2.saem.sort()).toEqual(["p0", "p1"]);
    expect(p2.ficam.size).toBe(0);
  });

  it("dois polígonos idênticos não viram um só", () => {
    const p1 = planejarPoligonos(new Map(), [a, { ...a }]);
    expect(p1.entram).toHaveLength(2);
    expect(new Set(p1.entram.map((e) => e.chave)).size).toBe(2);
  });
});

describe("G382-4 — o componente no app não redesenha os pastos", () => {
  const props = (extra = {}) => ({ mostrarAreas: true, corDaArea: () => null, estiloPasto: "cheio", tipoMapa: "satellite", empresaId: "e1", ...extra });
  const tagsDe = (chamada) => chamada[0].map((p) => p.tag);

  it("novo render igual, filtro e cor nova: só o que mudou troca, o novo antes do velho sair", async () => {
    const areas = [pasto(1, -15), pasto(2, -15.1), pasto(3, -15.2)];
    const { rerender } = render(<MapaGoogleNativo {...props({ areas })} />);
    await waitFor(() => expect(falso.mapa?.addPolygons).toHaveBeenCalledTimes(1));
    expect(tagsDe(falso.mapa.addPolygons.mock.calls[0])).toEqual(["1", "2", "3"]);

    // os mesmos pastos em objetos novos e uma função de cor nova (como a cada render do Mapa Geral): nada no mapa
    rerender(<MapaGoogleNativo {...props({ areas: areas.map((x) => ({ ...x })), corDaArea: () => null })} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(falso.mapa.addPolygons).toHaveBeenCalledTimes(1);
    expect(falso.mapa.removePolygons).not.toHaveBeenCalled();

    // filtro: o pasto 2 sai; só ele
    rerender(<MapaGoogleNativo {...props({ areas: [areas[0], areas[2]] })} />);
    await waitFor(() => expect(falso.mapa.removePolygons).toHaveBeenCalledTimes(1));
    expect(falso.mapa.removePolygons.mock.calls[0][0]).toEqual(["p2"]);
    expect(falso.mapa.addPolygons).toHaveBeenCalledTimes(1);

    // a coloração muda a cor só do pasto 3: entra o novo e depois sai o velho
    falso.ordem = [];
    const cor = (a) => (a.id === 3 ? "#ff0000" : null);
    rerender(<MapaGoogleNativo {...props({ areas: [areas[0], areas[2]], corDaArea: cor })} />);
    await waitFor(() => expect(falso.mapa.addPolygons).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(falso.mapa.removePolygons).toHaveBeenCalledTimes(2));
    expect(tagsDe(falso.mapa.addPolygons.mock.calls[1])).toEqual(["3"]);
    expect(falso.mapa.removePolygons.mock.calls[1][0]).toEqual(["p3"]);
    expect(falso.ordem).toEqual(["addPolygons", "removePolygons"]);
  });

  it("linhas iguais num novo render não são refeitas", async () => {
    const { rerender } = render(<MapaGoogleNativo {...props({ areas: [], linhas: [LINHA] })} />);
    await waitFor(() => expect(falso.mapa?.addPolylines).toHaveBeenCalledTimes(1));
    rerender(<MapaGoogleNativo {...props({ areas: [], linhas: [{ ...LINHA }] })} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(falso.mapa.addPolylines).toHaveBeenCalledTimes(1);
    expect(falso.mapa.removePolylines).not.toHaveBeenCalled();
  });
});

describe("G382-5 — os ícones entram juntos e a troca sigla ↔ nome não sobrepõe", () => {
  it("grupos pedidos em seguida vão numa chamada só ao mapa", async () => {
    const { criarMarcadoresNativos } = await import("@/lib/mapaNativo/marcadoresNativos.js");
    const mapa = { addMarkers: vi.fn(async (l) => l.map((_, i) => `n${i}`)), removeMarkers: vi.fn(async () => {}) };
    const camada = criarMarcadoresNativos(mapa);
    const m = (id) => ({ id, lat: 0, lng: 0, url: "data:x", w: 10, h: 10 });
    const a = camada.definir("lotes", [m("l1"), m("l2")]);
    const b = camada.definir("supl", [m("c1")]);
    await Promise.all([a, b]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(1);
    expect(mapa.addMarkers.mock.calls[0][0]).toHaveLength(3);
  });

  it("o nome que troca de texto no mesmo lugar sai antes de o novo entrar; ícone novo entra antes do velho sair", async () => {
    const { criarMarcadoresNativos } = await import("@/lib/mapaNativo/marcadoresNativos.js");
    const ordem = [];
    let n = 0;
    const mapa = {
      addMarkers: vi.fn(async (l) => (ordem.push("add"), l.map(() => `n${++n}`))),
      removeMarkers: vi.fn(async (ids) => void ordem.push(`remove:${ids.join(",")}`)),
    };
    const camada = criarMarcadoresNativos(mapa);
    const nome = (url) => ({ id: "a", lat: 0, lng: 0, url, w: 40, h: 14, semToque: true });
    await camada.definir("nomes", [nome("data:sigla")]);
    ordem.length = 0;
    await camada.definir("nomes", [nome("data:nome-inteiro")]);
    expect(ordem).toEqual(["remove:n1", "add"]);
    // ícone (com toque) trocado: o novo entra antes
    await camada.definir("supl", [{ id: "c", lat: 0, lng: 0, url: "data:c1", w: 10, h: 10 }]);
    ordem.length = 0;
    await camada.definir("supl", [{ id: "c", lat: 0, lng: 0, url: "data:c2", w: 10, h: 10 }]);
    expect(ordem[0]).toBe("add");
    expect(ordem[1]).toMatch(/^remove:/);
  });
});

describe("G382-7 — com o APK que mostra e esconde, nada que já está no mapa é refeito", () => {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const montar = async (mostrarFn) => {
    const { criarMarcadoresNativos, MS_AQUECER, MS_PASSAGEM } = await import("@/lib/mapaNativo/marcadoresNativos.js");
    let n = 0;
    const mapa = { addMarkers: vi.fn(async (l) => l.map(() => `n${++n}`)), removeMarkers: vi.fn(async () => {}) };
    const mostrar = vi.fn(mostrarFn || (async () => {}));
    const camada = criarMarcadoresNativos(mapa, { mostrar });
    return { camada, mapa, mostrar, MS_AQUECER, MS_PASSAGEM };
  };
  const m = (id, extra = {}) => ({ id, lat: 0, lng: 0, url: `data:${id}`, w: 10, h: 10, ...extra });
  /** As chamadas de verdade (a primeira, vazia, é a pergunta "o APK sabe?"). */
  const passagens = (mostrar) => mostrar.mock.calls.filter(([a, b]) => a.length || b.length);

  it("os novos entram escondidos e aparecem numa passagem só; os `oculto` entram depois, escondidos", async () => {
    const { camada, mapa, mostrar, MS_AQUECER, MS_PASSAGEM } = await montar();
    await camada.definir("nomes", [m("a"), m("a|sg", { oculto: true }), m("a|ha")]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(1);
    expect(mapa.addMarkers.mock.calls[0][0].map((x) => x.opacity)).toEqual([0, 0]);
    expect(passagens(mostrar)).toEqual([[["n1", "n2"], [], MS_PASSAGEM]]);
    // sem pressa, a sigla entra escondida (sem passagem): a primeira troca de nível já é só mostrar e esconder
    await espera(MS_AQUECER + 80);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    expect(mapa.addMarkers.mock.calls[1][0]).toHaveLength(1);
    expect(mapa.addMarkers.mock.calls[1][0][0].opacity).toBe(0);
    expect(passagens(mostrar)).toHaveLength(1);
    await camada.limpar();
  });

  it("trocar o nível dos nomes (sigla ↔ nome + hectares): nenhuma imagem, só mostrar e esconder", async () => {
    const { camada, mapa, mostrar, MS_AQUECER, MS_PASSAGEM } = await montar();
    await camada.definir("nomes", [m("a"), m("a|sg", { oculto: true }), m("a|ha")]);
    await espera(MS_AQUECER + 80);
    const postos = mapa.addMarkers.mock.calls.length;
    // nível "sigla": o nome e os hectares somem, a sigla aparece
    await camada.definir("nomes", [m("a", { oculto: true }), m("a|sg"), m("a|ha", { oculto: true })]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(postos);
    expect(mapa.removeMarkers).not.toHaveBeenCalled();
    // uns saem e outros entram no mesmo lugar: troca seca (sem misturar os dois textos)
    expect(passagens(mostrar).at(-1)).toEqual([["n3"], ["n1", "n2"], 0]);
    // e de volta
    await camada.definir("nomes", [m("a"), m("a|sg", { oculto: true }), m("a|ha")]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(postos);
    expect(passagens(mostrar).at(-1)).toEqual([["n1", "n2"], ["n3"], 0]);
    // o marcador escondido não é achado pelo toque errado: o id segue o mesmo
    expect(camada.marcadorDoToque("n1")?.id).toBe("a");
    await camada.limpar();
  });

  it("filtro: o ícone que sai é escondido e guardado; quando volta, só aparece (não é posto de novo)", async () => {
    const { camada, mapa, mostrar } = await montar();
    await camada.definir("supl", [m("c1"), m("c2")]);
    await camada.definir("supl", [m("c1")]);
    expect(mapa.removeMarkers).not.toHaveBeenCalled();
    expect(passagens(mostrar).at(-1).slice(0, 2)).toEqual([[], ["n2"]]);
    await camada.definir("supl", [m("c1"), m("c2")]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(1);
    expect(passagens(mostrar).at(-1).slice(0, 2)).toEqual([["n2"], []]);
    await camada.limpar();
  });

  it("o ícone à vista que mudou de desenho: troca seca (o novo entra visível e o velho sai logo), sem passagem", async () => {
    const { camada, mapa, mostrar } = await montar();
    await camada.definir("lotes", [m("l1")]);
    const antes = passagens(mostrar).length;
    await camada.definir("lotes", [{ ...m("l1"), url: "data:l1-com-outra-contagem" }]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    expect(mapa.addMarkers.mock.calls[1][0][0].opacity).toBe(1);
    expect(mapa.removeMarkers).toHaveBeenCalledWith(["n1"]);
    expect(passagens(mostrar)).toHaveLength(antes);
    expect(camada.marcadorDoToque("n2")?.id).toBe("l1");
    await camada.limpar();
  });

  it("o escondido que volta com outro desenho: o novo aparece na passagem e o velho sai do mapa depois", async () => {
    const { camada, mapa, mostrar, MS_PASSAGEM } = await montar();
    await camada.definir("supl", [m("c1")]);
    await camada.definir("supl", []);
    await camada.definir("supl", [{ ...m("c1"), url: "data:c1-outro-nivel" }]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    expect(mapa.addMarkers.mock.calls[1][0][0].opacity).toBe(0);
    expect(passagens(mostrar).at(-1).slice(0, 2)).toEqual([["n2"], []]);
    await espera(MS_PASSAGEM + 140);
    expect(mapa.removeMarkers).toHaveBeenCalledWith(["n1"]);
    await camada.limpar();
  });

  it("APK anterior (o método não existe): como antes — o escondido não entra no mapa e o que sai é tirado", async () => {
    const { camada, mapa, mostrar } = await montar(async () => {
      throw new Error("not implemented");
    });
    await camada.definir("nomes", [m("a"), m("a|sg", { oculto: true })]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(1);
    expect(mapa.addMarkers.mock.calls[0][0]).toHaveLength(1);
    expect(mapa.addMarkers.mock.calls[0][0][0].opacity).toBeUndefined();
    await camada.definir("nomes", [m("a", { oculto: true }), m("a|sg")]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    expect(mapa.removeMarkers).toHaveBeenCalledWith(["n1"]);
    expect(mostrar).toHaveBeenCalledTimes(1);
    await camada.limpar();
  });
});

describe("G382-8 — o remendo do mapa nativo (marcadores juntos; mostrar e esconder)", () => {
  it("os dois remendos estão no plugin instalado e o método novo é do plugin", async () => {
    const { readFileSync } = await import("node:fs");
    const { MARCA_JUNTOS, MARCA_MOSTRAR, REMENDOS } = await import("../../scripts/app/remendar-google-maps.mjs");
    const pasta = "node_modules/@capacitor/google-maps/android/src/main/java/com/capacitorjs/plugins/googlemaps";
    const kt = readFileSync(`${pasta}/CapacitorGoogleMap.kt`, "utf8");
    const plugin = readFileSync(`${pasta}/CapacitorGoogleMapsPlugin.kt`, "utf8");
    expect(kt).toContain(MARCA_JUNTOS);
    // as imagens todas antes; nenhum marcador espera a imagem dele dentro do laço
    expect(kt).toContain("newMarkers.map { m -> this@CapacitorGoogleMap.buildMarker(m) }");
    expect(kt).not.toContain("googleMap?.addMarker(markerOptions.await())\n                    it.googleMapMarker");
    expect(kt).toContain("if (it.opacity == 0f) maikeOpcao.visible(false)");
    expect(kt).toContain("fun maikeMostrar(mostrar: List<String>, esconder: List<String>, ms: Long)");
    expect(plugin).toContain(MARCA_MOSTRAR);
    expect(plugin).toMatch(/@PluginMethod\n\s+fun maikeMostrar\(call: PluginCall\)/);
    expect(REMENDOS.filter((r) => r.marca === MARCA_MOSTRAR)).toHaveLength(2);
  });

  it("o componente entrega o método ao mapa nativo", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/components/mapa/MapaGoogleNativo.jsx", "utf8");
    expect(fonte).toMatch(/maikeMostrar\(\{ id: mapa\.id, mostrar: entram, esconder: saem, ms \}\)/);
  });
});

describe("G382-9 — os nomes se ajustam enquanto o mapa mexe (só com o APK que mostra e esconde)", () => {
  it("o componente só ouve a câmera a cada quadro para os nomes quando a troca é leve", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/components/mapa/MapaGoogleNativo.jsx", "utf8");
    // no celular, rever os nomes no meio do gesto travava o zoom: fica desligado (só quando o mapa para)
    expect(fonte).toContain("aoVivo = false;");
    expect(fonte).not.toContain("aoVivo = Boolean(");
    expect(fonte).toContain("if (camada || aoVivo) avisarCamera(ultimaCamera, false);");
  });

  it("a camada diz se o APK sabe mostrar e esconder", async () => {
    const { criarMarcadoresNativos } = await import("@/lib/mapaNativo/marcadoresNativos.js");
    const mapa = { addMarkers: vi.fn(async () => []), removeMarkers: vi.fn(async () => {}) };
    expect(await criarMarcadoresNativos(mapa, { mostrar: async () => {} }).liso).toBe(true);
    expect(await criarMarcadoresNativos(mapa, { mostrar: async () => Promise.reject(new Error("x")) }).liso).toBe(false);
    expect(await criarMarcadoresNativos(mapa).liso).toBe(false);
  });
});
