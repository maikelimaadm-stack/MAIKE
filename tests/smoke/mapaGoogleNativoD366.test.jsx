/**
 * D-PROD-366 — mapa nativo do Google no app (etapa 1): áreas sobre o satélite do Google, toque na área abre o
 * detalhe, escolha por aparelho. Plugin `@capacitor/google-maps` falso (o mapa nativo não roda no jsdom).
 *
 *  G366-1. Polígonos das áreas: cor do Mapa Geral, estilo Cheio/Suave/Contorno, área sem contorno fica de fora, `tag`.
 *  G366-2. Caixa da fazenda, tipo do mapa, escolha do aparelho; sem o plugin (site, APK antigo) nunca liga.
 *  G366-3. Componente: cria o mapa na vista salva, abre a "janela" (fundos transparentes) e devolve ao sair,
 *          satélite, polígonos, toque → área, vista gravada, primeira abertura enquadra a fazenda (espera as áreas
 *          carregarem), órfão de recarga destruído antes do mapa novo, falha avisa.
 *  G366-4. Painel Visualização: a escolha "Mapa do Google (teste)" só aparece com o plugin.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({ disponivel: false, nativo: false, plataforma: "web" }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    Capacitor: {
      ...real.Capacitor,
      isNativePlatform: () => plugin.nativo,
      getPlatform: () => plugin.plataforma,
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
      enableTouch: vi.fn(async () => {}),
      disableTouch: vi.fn(async () => {}),
      setOnCameraIdleListener: vi.fn(async (cb) => { ouvintes.camera = cb; }),
      setOnCameraMoveStartedListener: vi.fn(async (cb) => { ouvintes.mover = cb; }),
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

// D-PROD-369: no site o mapa é a Maps JavaScript API direto (o mesmo mapa falso, sem o plugin)
vi.mock("@/lib/mapaNativo/mapaGoogleWeb.js", () => ({
  criarMapaGoogleWeb: vi.fn(async (opcoes) => {
    if (falso.estado.falhar) throw new Error("sem chave");
    falso.estado.criado = { ...opcoes, web: true };
    falso.estado.mapa = falso.novoMapa();
    return falso.estado.mapa;
  }),
}));

import { corExibidaNoMapa } from "@/lib/maplibre/estiloAreas.js";
import {
  CHAVE_PREFERENCIA,
  escalaDoMapaGoogle,
  fecharMapaGoogleAberto,
  caixaDosPoligonos,
  estiloDoPoligono,
  gravarPreferenciaMapaGoogle,
  lerPreferenciaMapaGoogle,
  poligonosDasAreas,
  configDoMapaGoogle,
  temMapaGoogle,
  tipoDoMapaGoogle,
  usarMapaGoogle,
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
  plugin.plataforma = "web";
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe("G366-1 — polígonos das áreas", () => {
  it("a mesma cor do MapLibre: a da coloração ou, sem ela, a salva da área (clareada 5%, sempre #rrggbb); `tag` = id; área sem contorno fica de fora", () => {
    const A2_COM_COR = { ...A2, coordenadas: { ...A2.coordenadas, cor: "#abc" } };
    const p = poligonosDasAreas([A1, A2, SEM_CONTORNO, A2_COM_COR], cor, "cheio");
    expect(p.map((x) => x.tag)).toEqual(["a1", "a2", "a2"]);
    expect(p[0]).toMatchObject({ fillColor: corExibidaNoMapa("#22c55e"), fillOpacity: 0.78, strokeColor: "#ffffff", strokeWeight: 1, clickable: true });
    // modo padrão (coloração sem cor): a cor salva, ou o azul de reserva do Mapa Geral — não o cinza
    expect(p[1].fillColor).toBe(corExibidaNoMapa("#61aad9"));
    expect(p[2].fillColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(p[0].paths).toEqual([{ lat: -15, lng: -47 }, { lat: -15, lng: -46.99 }, { lat: -15.01, lng: -46.99 }, { lat: -15.01, lng: -47 }]);
  });

  it("Android: a linha em pixels físicos (× densidade); iOS e site em px", () => {
    const dpr = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    try {
      plugin.plataforma = "android";
      expect(escalaDoMapaGoogle()).toBe(3);
      expect(poligonosDasAreas([A1], cor, "cheio", escalaDoMapaGoogle())[0].strokeWeight).toBe(3);
      plugin.plataforma = "ios";
      expect(escalaDoMapaGoogle()).toBe(1);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
    }
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

  it("app: só com o plugin no APK (APK antigo nunca liga, mesmo com a escolha gravada)", () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "chave-site");
    try {
      gravarPreferenciaMapaGoogle(true);
      expect(localStorage.getItem(CHAVE_PREFERENCIA)).toBe("1");
      expect(lerPreferenciaMapaGoogle()).toBe(true);
      plugin.nativo = true;
      plugin.disponivel = false;
      expect(temMapaGoogle()).toBe(false);
      expect(usarMapaGoogle()).toBe(false);
      plugin.disponivel = true;
      expect(usarMapaGoogle()).toBe(true);
      gravarPreferenciaMapaGoogle(false);
      expect(usarMapaGoogle()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("site: com a chave do Google (Maps JavaScript API); sem a chave, nunca", () => {
    gravarPreferenciaMapaGoogle(true);
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    try {
      expect(temMapaGoogle()).toBe(false);
      expect(usarMapaGoogle()).toBe(false);
      vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "chave-site");
      expect(temMapaGoogle()).toBe(true);
      expect(usarMapaGoogle()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("criação: satélite ou mapa, um dedo arrasta no celular, sem os botões e ícones do Google", () => {
    expect(configDoMapaGoogle({ center: { lat: -15, lng: -47 }, zoom: 14 }, "satellite")).toEqual({
      center: { lat: -15, lng: -47 },
      zoom: 14,
      mapTypeId: "satellite",
      gestureHandling: "greedy",
      disableDefaultUI: true,
      clickableIcons: false,
      keyboardShortcuts: false,
    });
    expect(configDoMapaGoogle({ center: { lat: 0, lng: 0 }, zoom: 3 }, "roadmap").mapTypeId).toBe("roadmap");
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

  it("app: abre na vista salva da fazenda, no satélite, com as áreas; toque no polígono abre a área; vista gravada ao parar", async () => {
    plugin.nativo = true;
    plugin.disponivel = true;
    localStorage.setItem("mapa_geral_view_e1", JSON.stringify({ center: { lat: -15.1, lng: -47.2 }, zoom: 14 }));
    const { onClickArea, unmount, pai } = montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    const mapa = falso.estado.mapa;
    // zoom do Google = zoom do MapLibre + 1 (ladrilhos de 256 × 512 px): a mesma escala na tela
    expect(falso.estado.criado.config).toMatchObject({ center: { lat: -15.1, lng: -47.2 }, zoom: 15, mapTypeId: "satellite", gestureHandling: "greedy" });
    expect(falso.estado.criado.element.tagName.toLowerCase()).toBe("capacitor-google-map");
    expect(mapa.tipo).toBe("Satellite");
    // vista salva: não enquadra de novo
    expect(mapa.fitBounds).not.toHaveBeenCalled();
    // a página fica transparente em volta do mapa (o mapa nativo fica atrás da WebView)
    expect(pai.style.background).toBe("transparent");

    act(() => mapa.ouvintes.poligono({ polygonId: "p1", tag: "a2" }));
    expect(onClickArea).toHaveBeenCalledWith(A2);

    act(() => mapa.ouvintes.camera({ latitude: -15.3, longitude: -47.4, zoom: 16 }));
    expect(JSON.parse(localStorage.getItem("mapa_geral_view_e1") || "{}")).toEqual({ center: { lat: -15.3, lng: -47.4 }, zoom: 15 });

    unmount();
    expect(mapa.destruido).toBe(true);
    expect(pai.style.background).toBe("rgb(255, 255, 255)");
  });

  it("primeira abertura (sem vista salva): enquadra a fazenda depois das áreas", async () => {
    montar();
    await waitFor(() => expect(falso.estado.mapa?.fitBounds).toHaveBeenCalledTimes(1));
    expect(falso.estado.mapa.caixa.northeast).toEqual({ lat: -15, lng: -46.99 });
  });

  it("áreas ainda carregando: o enquadramento espera (a vista não é gravada); chegam as áreas, enquadra; fazenda vazia de fato, grava como está", async () => {
    const { rerender } = montar({ areas: [], areasDaFazenda: [], areasCarregadas: false });
    await waitFor(() => expect(falso.estado.mapa?.ouvintes.camera).toBeTypeOf("function"));
    const mapa = falso.estado.mapa;
    act(() => mapa.ouvintes.camera({ latitude: -15.78, longitude: -47.93, zoom: 15 }));
    expect(localStorage.getItem("mapa_geral_view_e1")).toBeNull();
    expect(mapa.fitBounds).not.toHaveBeenCalled();
    // as áreas chegam (mesmo escondidas pelo filtro, a fazenda inteira enquadra, como no MapLibre)
    rerender(<MapaGoogleNativo areas={[]} areasDaFazenda={[A1, A2]} areasCarregadas mostrarAreas corDaArea={cor} tipoMapa="satellite" empresaId="e1" />);
    await waitFor(() => expect(mapa.fitBounds).toHaveBeenCalledTimes(1));
    expect(mapa.caixa.northeast).toEqual({ lat: -15, lng: -46.99 });
    act(() => mapa.ouvintes.camera({ latitude: -15.01, longitude: -47.01, zoom: 15 }));
    expect(localStorage.getItem("mapa_geral_view_e1")).not.toBeNull();

    // outra fazenda, sem áreas de fato: a consulta termina vazia e a vista passa a ser gravada
    rerender(<MapaGoogleNativo areas={[]} areasDaFazenda={[]} areasCarregadas mostrarAreas corDaArea={cor} tipoMapa="satellite" empresaId="e2" />);
    await waitFor(() => expect(falso.estado.mapa).not.toBe(mapa));
    const outro = falso.estado.mapa;
    await waitFor(() => expect(outro.ouvintes.camera).toBeTypeOf("function"));
    await act(async () => {});
    act(() => outro.ouvintes.camera({ latitude: -16, longitude: -48, zoom: 15 }));
    expect(JSON.parse(localStorage.getItem("mapa_geral_view_e2") || "{}")).toEqual({ center: { lat: -16, lng: -48 }, zoom: 14 });
    expect(outro.fitBounds).not.toHaveBeenCalled();
  });

  it("app recarregado com o mapa do Google ligado: o mapa órfão é destruído ANTES de criar o novo", async () => {
    plugin.nativo = true;
    plugin.disponivel = true;
    localStorage.setItem("mk_mapa_google_ultimo_id", "mapa-orfao");
    const { Capacitor } = await import("@capacitor/core");
    const ordem = [];
    const cap = /** @type {any} */ (Capacitor);
    const antes = cap.nativePromise;
    cap.nativePromise = vi.fn(async (_plugin, metodo, opcoes) => { ordem.push(`${metodo}:${opcoes.id}`); });
    const { GoogleMap } = await import("@capacitor/google-maps");
    /** @type {any} */ (GoogleMap.create).mockImplementationOnce(async (opcoes) => {
      ordem.push("create");
      falso.estado.criado = opcoes;
      falso.estado.mapa = falso.novoMapa();
      return falso.estado.mapa;
    });
    try {
      montar();
      await waitFor(() => expect(ordem).toContain("create"));
      expect(ordem).toEqual(["destroy:mapa-orfao", "create"]);
      expect(localStorage.getItem("mk_mapa_google_ultimo_id")).toBe(falso.estado.criado.id);
    } finally {
      cap.nativePromise = antes;
    }
  });

  it("coloração, estilo ou áreas mudam: os polígonos velhos saem e os novos entram; áreas escondidas, nada", async () => {
    const { rerender } = montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    const mapa = falso.estado.mapa;
    rerender(
      <MapaGoogleNativo areas={[A1, A2]} mostrarAreas corDaArea={() => "#ef4444"} estiloPasto="contorno" tipoMapa="roadmap" empresaId="e1" />
    );
    await waitFor(() => expect(mapa.poligonos[0]?.strokeColor).toBe(corExibidaNoMapa("#ef4444")));
    expect(mapa.removidos[0]).toEqual(["p1", "p2"]);
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
  it("trocas seguidas de cor e estilo não deixam polígono velho no mapa (uma troca de cada vez)", async () => {
    const { rerender } = montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    const mapa = falso.estado.mapa;
    const vivos = new Set(["p1", "p2"]);
    mapa.addPolygons.mockImplementation(async function (lista) {
      await new Promise((r) => setTimeout(r, 5));
      this.poligonos = lista;
      const ids = lista.map((_, i) => `n${mapa.addPolygons.mock.calls.length}-${i}`);
      ids.forEach((id) => vivos.add(id));
      return ids;
    });
    mapa.removePolygons.mockImplementation(async (ids) => { ids.forEach((id) => vivos.delete(id)); });
    for (const c of ["#111111", "#222222", "#333333"]) {
      rerender(<MapaGoogleNativo areas={[A1, A2]} mostrarAreas corDaArea={() => c} estiloPasto="cheio" tipoMapa="satellite" empresaId="e1" />);
    }
    await waitFor(() => expect(mapa.poligonos[0]?.fillColor).toBe(corExibidaNoMapa("#333333")));
    await new Promise((r) => setTimeout(r, 30));
    expect(vivos.size).toBe(2);
  });

  it("app: fora do Mapa Geral (escondido, D-PROD-305) o fundo volta e o mapa larga o toque; de volta, reabre", async () => {
    plugin.nativo = true;
    plugin.disponivel = true;
    const { pai, rerender } = montar();
    await waitFor(() => expect(pai.style.background).toBe("transparent"));
    const mapa = falso.estado.mapa;
    rerender(<MapaGoogleNativo areas={[A1, A2]} mostrarAreas corDaArea={cor} tipoMapa="satellite" empresaId="e1" ativo={false} />);
    await waitFor(() => expect(mapa.disableTouch).toHaveBeenCalled());
    expect(pai.style.background).toBe("rgb(255, 255, 255)");
    rerender(<MapaGoogleNativo areas={[A1, A2]} mostrarAreas corDaArea={cor} tipoMapa="satellite" empresaId="e1" ativo />);
    await waitFor(() => expect(pai.style.background).toBe("transparent"));
    expect(mapa.enableTouch).toHaveBeenCalled();
  });

  it("antes de recarregar a página o mapa aberto é destruído (o mapa nativo não fica vivo atrás da página)", async () => {
    montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    await fecharMapaGoogleAberto();
    expect(falso.estado.mapa.destruido).toBe(true);
  });

  it("cada mapa criado tem um id novo (o destroy atrasado de um mapa velho não derruba o novo)", async () => {
    plugin.nativo = true;
    plugin.disponivel = true;
    const { unmount } = montar();
    await waitFor(() => expect(falso.estado.criado).not.toBeNull());
    const primeiro = falso.estado.criado.id;
    unmount();
    montar();
    await waitFor(() => expect(falso.estado.criado.id).not.toBe(primeiro));
  });

  it("site: a Maps JavaScript API direto (sem o plugin), desenhada dentro do elemento — a página não fica transparente", async () => {
    const { GoogleMap } = await import("@capacitor/google-maps");
    const { pai } = montar();
    await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
    expect(falso.estado.criado.web).toBe(true);
    expect(falso.estado.criado.element.tagName.toLowerCase()).toBe("div");
    expect(falso.estado.criado.config).toMatchObject({ mapTypeId: "satellite", gestureHandling: "greedy" });
    expect(GoogleMap.create).not.toHaveBeenCalled();
    expect(pai.style.background).toBe("rgb(255, 255, 255)");
  });

  it("app: o plugin nativo recebe a chave do iOS ou, sem ela, a do site", async () => {
    plugin.nativo = true;
    plugin.disponivel = true;
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "chave-site");
    try {
      montar();
      await waitFor(() => expect(falso.estado.mapa?.poligonos).toHaveLength(2));
      expect(falso.estado.criado.apiKey).toBe("chave-site");
      expect(falso.estado.criado.web).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
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
