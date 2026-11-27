/**
 * D-PROD-366 — mapa nativo do Google no app (etapa 1): áreas sobre o satélite do Google, toque na área abre o
 * detalhe, escolha por aparelho. Plugin `@capacitor/google-maps` falso (o mapa nativo não roda no jsdom).
 *
 *  G366-1. Polígonos das áreas: cor do Mapa Geral, estilo Cheio/Suave/Contorno, área sem contorno fica de fora, `tag`.
 *  G366-2. Caixa da fazenda, tipo do mapa, escolha do aparelho; sem o plugin (site, APK antigo) nunca liga.
 *  G366-3. Componente: cria o mapa na vista salva, abre a "janela" (fundos transparentes) e devolve ao sair,
 *          satélite, polígonos, toque → área, vista gravada, primeira abertura enquadra a fazenda, falha avisa.
 *  G366-4. Painel Visualização: a escolha "Mapa do Google (teste)" só aparece com o plugin.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({ disponivel: false, nativo: false }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    Capacitor: {
      ...real.Capacitor,
      isNativePlatform: () => plugin.nativo,
      isPluginAvailable: (nome) => plugin.disponivel && nome === "CapacitorGoogleMaps",
    },
  };
});

const falso = vi.hoisted(() => {
  const estado = { criado: /** @type {any} */ (null), mapa: /** @type {any} */ (null), falhar: false };
  const novoMapa = () => {
    const ouvintes = {};
    let n = 0;
    return {
      ouvintes,
      poligonos: /** @type {any[]} */ ([]),
      removidos: /** @type {string[][]} */ ([]),
      tipo: null,
      caixa: null,
      destruido: false,
      setMapType: vi.fn(async function (t) { this.tipo = t; }),
      addPolygons: vi.fn(async function (lista) { this.poligonos = lista; return lista.map(() => `p${(n += 1)}`); }),
      removePolygons: vi.fn(async function (ids) { this.removidos.push(ids); }),
      fitBounds: vi.fn(async function (caixa) { this.caixa = caixa; }),
      setOnPolygonClickListener: vi.fn(async (cb) => { ouvintes.poligono = cb; }),
      setOnCameraIdleListener: vi.fn(async (cb) => { ouvintes.camera = cb; }),
      destroy: vi.fn(async function () { this.destruido = true; }),
    };
  };
  return { estado, novoMapa };
});
vi.mock("@capacitor/google-maps", () => ({
  GoogleMap: {
    create: vi.fn(async (opcoes) => {
      if (falso.estado.falhar) throw new Error("sem chave");
      falso.estado.criado = opcoes;
      falso.estado.mapa = falso.novoMapa();
      return falso.estado.mapa;
    }),
  },
}));

import {
  CHAVE_PREFERENCIA,
  caixaDosPoligonos,
  estiloDoPoligono,
  gravarPreferenciaMapaGoogle,
  lerPreferenciaMapaGoogle,
  poligonosDasAreas,
  temMapaGoogleNativo,
  tipoDoMapaGoogle,
  usarMapaGoogleNativo,
} from "@/lib/mapaNativo/mapaGoogleNativo.js";
import MapaGoogleNativo from "@/components/mapa/MapaGoogleNativo.jsx";
import MapaVisualizacao from "@/components/mapa/MapaVisualizacao.jsx";

const quadrado = (id, lat, lng, extra = {}) => ({
  id,
  nome: `Pasto ${id}`,
  coordenadas: { coords: [[lat, lng], [lat, lng + 0.01], [lat - 0.01, lng + 0.01], [lat - 0.01, lng]] },
  ...extra,
});
const A1 = quadrado("a1", -15, -47);
const A2 = quadrado("a2", -15.02, -47.03);
const SEM_CONTORNO = { id: "a3", nome: "Sem contorno", coordenadas: { coords: [[-15, -47]] } };
const cor = (a) => (a.id === "a1" ? "#22c55e" : null);

beforeEach(() => {
  plugin.disponivel = false;
  plugin.nativo = false;
  falso.estado.criado = null;
  falso.estado.mapa = null;
  falso.estado.falhar = false;
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe("G366-1 — polígonos das áreas", () => {
  it("cor do Mapa Geral (reserva cinza), estilo Cheio por padrão, `tag` = id; área sem contorno fica de fora", () => {
    const p = poligonosDasAreas([A1, A2, SEM_CONTORNO], cor, "cheio");
    expect(p.map((x) => x.tag)).toEqual(["a1", "a2"]);
    expect(p[0]).toMatchObject({ fillColor: "#22c55e", fillOpacity: 0.78, strokeColor: "#ffffff", strokeWeight: 1, clickable: true });
    expect(p[1].fillColor).toBe("#94a3b8");
    expect(p[0].paths).toEqual([{ lat: -15, lng: -47 }, { lat: -15, lng: -46.99 }, { lat: -15.01, lng: -46.99 }, { lat: -15.01, lng: -47 }]);
  });

  it("Suave 40%, Contorno 8% com a divisa na cor da área (os mesmos do MapLibre)", () => {
    expect(estiloDoPoligono("suave", "#123456")).toEqual({ fillOpacity: 0.4, strokeColor: "#ffffff", strokeWeight: 1 });
    expect(estiloDoPoligono("contorno", "#123456")).toEqual({ fillOpacity: 0.08, strokeColor: "#123456", strokeWeight: 2 });
    expect(estiloDoPoligono(undefined, "#123456").fillOpacity).toBe(0.78);
  });
});

describe("G366-2 — caixa, tipo do mapa e escolha do aparelho", () => {
  it("caixa da fazenda por todas as áreas; sem áreas, nenhuma", () => {
    const c = caixaDosPoligonos(poligonosDasAreas([A1, A2], cor));
    expect(c?.southwest).toEqual({ lat: -15.03, lng: -47.03 });
    expect(c?.northeast).toEqual({ lat: -15, lng: -46.99 });
    expect(caixaDosPoligonos([])).toBeNull();
  });

  it("satélite = foto limpa (Satellite), mapa = Normal", () => {
    expect(tipoDoMapaGoogle("satellite")).toBe("Satellite");
    expect(tipoDoMapaGoogle("roadmap")).toBe("Normal");
  });

  it("sem o plugin (site, APK antigo) o mapa do Google nunca liga, mesmo com a escolha gravada", () => {
    gravarPreferenciaMapaGoogle(true);
    expect(localStorage.getItem(CHAVE_PREFERENCIA)).toBe("1");
    expect(lerPreferenciaMapaGoogle()).toBe(true);
    expect(temMapaGoogleNativo()).toBe(false);
    expect(usarMapaGoogleNativo()).toBe(false);
    plugin.nativo = true;
    plugin.disponivel = true;
    expect(usarMapaGoogleNativo()).toBe(true);
    gravarPreferenciaMapaGoogle(false);
    expect(usarMapaGoogleNativo()).toBe(false);
  });
});

describe("G366-3 — o mapa nativo no Mapa Geral", () => {
  const montar = (props = {}) => {
    const onClickArea = vi.fn();
    const onFalha = vi.fn();
    const pai = document.createElement("div");
    pai.style.background = "rgb(255, 255, 255)";
    document.body.appendChild(pai);
    const r = render(
      <MapaGoogleNativo
        areas={[A1, A2]}
        mostrarAreas
        corDaArea={cor}
        estiloPasto="cheio"
        tipoMapa="satellite"
        empresaId="e1"
        onClickArea={onClickArea}
        onFalha={onFalha}
        {...props} />,
      { container: pai }
    );
    return { ...r, pai, onClickArea, onFalha };
  };

  it("abre na vista salva da fazenda, no satélite, com as áreas; toque no polígono abre a área; vista gravada ao parar", async () => {
    localStorage.setItem("mapa_geral_view_e1", JSON.stringify({ center: { lat: -15.1, lng: -47.2 }, zoom: 14 }));
    const { onClickArea, unmount, pai } = montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    const mapa = falso.estado.mapa;
    expect(falso.estado.criado.config).toMatchObject({ center: { lat: -15.1, lng: -47.2 }, zoom: 14 });
    expect(falso.estado.criado.element.tagName.toLowerCase()).toBe("capacitor-google-map");
    expect(mapa.tipo).toBe("Satellite");
    // vista salva: não enquadra de novo
    expect(mapa.fitBounds).not.toHaveBeenCalled();
    // a página fica transparente em volta do mapa (o mapa nativo fica atrás da WebView)
    expect(pai.style.background).toBe("transparent");

    act(() => mapa.ouvintes.poligono({ polygonId: "p1", tag: "a2" }));
    expect(onClickArea).toHaveBeenCalledWith(A2);

    act(() => mapa.ouvintes.camera({ latitude: -15.3, longitude: -47.4, zoom: 16 }));
    expect(JSON.parse(localStorage.getItem("mapa_geral_view_e1") || "{}")).toEqual({ center: { lat: -15.3, lng: -47.4 }, zoom: 16 });

    unmount();
    expect(mapa.destruido).toBe(true);
    expect(pai.style.background).toBe("rgb(255, 255, 255)");
  });

  it("primeira abertura (sem vista salva): enquadra a fazenda depois das áreas", async () => {
    montar();
    await waitFor(() => expect(falso.estado.mapa?.fitBounds).toHaveBeenCalledTimes(1));
    expect(falso.estado.mapa.caixa.northeast).toEqual({ lat: -15, lng: -46.99 });
  });

  it("coloração, estilo ou áreas mudam: os polígonos velhos saem e os novos entram; áreas escondidas, nada", async () => {
    const { rerender } = montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    const mapa = falso.estado.mapa;
    rerender(
      <MapaGoogleNativo areas={[A1, A2]} mostrarAreas corDaArea={() => "#ef4444"} estiloPasto="contorno" tipoMapa="roadmap" empresaId="e1" />
    );
    await waitFor(() => expect(mapa.poligonos[0]?.strokeColor).toBe("#ef4444"));
    expect(mapa.removidos.at(-1)).toEqual(["p1", "p2"]);
    expect(mapa.tipo).toBe("Normal");
    rerender(<MapaGoogleNativo areas={[A1, A2]} mostrarAreas={false} corDaArea={cor} tipoMapa="roadmap" empresaId="e1" />);
    await waitFor(() => expect(mapa.removidos).toHaveLength(2));
    expect(mapa.addPolygons).toHaveBeenCalledTimes(2);
  });

  it("o mapa do Google não abre (sem chave, sem Play Services): avisa quem chamou", async () => {
    falso.estado.falhar = true;
    const { onFalha } = montar();
    await waitFor(() => expect(onFalha).toHaveBeenCalledTimes(1));
  });
});

describe("G366-4 — escolha no painel Visualização", () => {
  const base = {
    mapType: "satellite",
    setMapType: () => {},
    estiloPasto: "cheio",
    setEstiloPasto: () => {},
    modoColoracao: "padrao",
    setModoColoracao: () => {},
  };

  it("sem o plugin a escolha não aparece; com o plugin, mostra o estado e alterna", () => {
    const { rerender } = render(<MapaVisualizacao {...base} />);
    expect(screen.queryByTestId("mapa-google-nativo-alternar")).toBeNull();
    const alternar = vi.fn();
    rerender(<MapaVisualizacao {...base} mapaGoogle={{ ligado: false, alternar }} />);
    const botao = screen.getByTestId("mapa-google-nativo-alternar");
    expect(botao.getAttribute("aria-checked")).toBe("false");
    expect(botao.textContent).toContain("Mapa do Google (teste)");
    fireEvent.click(botao);
    expect(alternar).toHaveBeenCalledTimes(1);
  });
});
