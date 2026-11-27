/**
 * D-PROD-352 (mapa leve, etapa 3) — cochos/depósitos, pontos de referência (bebedouro incluído) e tarefas desenhados
 * pelo próprio mapa, no mesmo padrão dos lotes (D-PROD-349). MapLibre e canvas falsos.
 *
 *  P352-1. Imagem por chave: pontos iguais dividem a imagem; a mesma chave não é desenhada nem registrada de novo;
 *          o nível muda → imagem nova; nenhum marcador HTML.
 *  P352-2. Cocho: figura de 36 px sem achatar, selo "?"/"!" no canto de cima à direita e farol no de baixo, nas
 *          posições e cores de antes.
 *  P352-3. Tarefa: indicador ("3d", cor do prazo) como o `aplicarIndicadorTarefa`; Urgente por cima (`symbol-sort-key`).
 *  P352-4. Ordem das camadas: cocho < ponto < lote < identificador < tarefa (o z-index de antes).
 *  P352-5. Clique: o callback de sempre com o objeto mais novo; nunca abre a área/linha por baixo; quem está por
 *          cima ganha (tarefa sobre lote, lote sobre ponto); hitArea/hitPonto; toque longo não começa num ponto.
 *  P352-6. Reserva: figura que não carrega, figura de outra origem que suja o canvas (sem quebrar o próximo desenho),
 *          limite de tentativas; a tarefa com ícone enviado que não carrega usa o modelo local.
 *  P352-7. Poda (imagens sem uso saem; grupo escondido não poda) e troca de estilo (as imagens voltam).
 *  P352-8. Texto acessível: o título (nível do cocho, prazo da tarefa) vai na fonte e aparece no mouse.
 *  P352-9. Revisão: figura remota lenta fora da fila (não atrasa lotes nem outros pontos; publica com a reserva),
 *          falha lembrada por URL; sobrepostos abrem o de cima; clique com o objeto novo; margem transparente.
 */
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { urlIconeCocho } from "@/assets/icones/cocho-descoberto.js";
import { urlIconeDeposito } from "@/assets/icones/deposito-sal.js";
import { urlIconeTarefa } from "@/assets/icones/tarefas.js";
import { indicadorTarefa } from "@/lib/tarefas/marcador";
import { LOTES_IDENT_LAYER_ID, LOTES_LAYER_ID, MAX_TENTATIVAS_IMAGEM, MS_FALHA_FIGURA, colecaoLotes, limparCacheImagensLotes } from "@/lib/maplibre/lotesNoMapa.js";
import { resolverIconeTarefa } from "@/lib/maplibre/mapaGeralRender.js";
import {
  CORES_SELO_SUPLEMENTACAO,
  FAROL_SUPL,
  ORDEM_CLICAVEIS,
  PONTOS_LAYER_ID,
  PONTOS_SOURCE_ID,
  SELO_SUPL,
  SUPL_LAYER_ID,
  SUPL_SOURCE_ID,
  TAREFAS_LAYER_ID,
  TAREFAS_SOURCE_ID,
  camadasAbaixoDosLotes,
  camadasAcimaDosLotes,
  chaveImagemPonto,
  ehImagemDePonto,
  limparAvisoPontos,
  resumoDaUrl,
} from "@/lib/maplibre/pontosNoMapa.js";
import useMapRenderer from "@/components/mapa/useMapRenderer.jsx";
import { deveComecarToqueLongo } from "@/domain/mapa/cliqueArea";
import { esperarImagens, instalarCanvasFalso } from "./helpers/canvasLotesFalso.js";

const marcadores = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock("@/lib/maplibre/lifecycle.js", async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this.opts = opts;
      this.removed = false;
      marcadores.push(this);
    }
    setLngLat(ll) {
      this.ll = ll;
      return this;
    }
    addTo(map) {
      map.container.appendChild(this.el);
      return this;
    }
    getElement() {
      return this.el;
    }
    setOffset() {
      return this;
    }
    remove() {
      this.removed = true;
      this.el.remove();
    }
  }
  class Popup {
    constructor() {
      popups.push(this);
    }
    setLngLat() {
      return this;
    }
    setDOMContent(el) {
      this.el = el;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  const popups = [];
  globalThis.__popupsD352 = popups;
  return { ...real, maplibregl: { Marker, Popup, LngLatBounds: class {} }, setSourceData: (map, id, data) => map?.data?.set(id, data) };
});

/** Mapa falso: fontes, camadas (com `beforeId`), imagens, eventos e o que está "desenhado" sob o ponto. */
const mkMap = () => {
  const sources = new Map();
  const layers = [];
  const images = new Map();
  const handlers = [];
  const canvas = document.createElement("canvas");
  const map = {
    container: document.createElement("div"),
    data: new Map(),
    handlers,
    images,
    layers,
    sobPonto: /** @type {Record<string, any[]>} */ ({}),
    getSource: (id) => sources.get(id),
    addSource: (id, s) => sources.set(id, s),
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (l, antes) => {
      const i = antes ? layers.findIndex((x) => x.id === antes) : -1;
      if (i >= 0) layers.splice(i, 0, l);
      else layers.push(l);
    },
    addImage: vi.fn((id, img, opts) => {
      if (images.has(id)) throw new Error(`imagem ${id} já existe`);
      images.set(id, { img, opts });
    }),
    hasImage: (id) => images.has(id),
    removeImage: vi.fn((id) => images.delete(id)),
    setPaintProperty: vi.fn(),
    setFeatureState: vi.fn(),
    on: (...a) => handlers.push(a),
    off: (...a) => {
      const i = handlers.findIndex((h) => h[0] === a[0] && h[h.length - 1] === a[a.length - 1]);
      if (i >= 0) handlers.splice(i, 1);
    },
    getZoom: () => 15,
    project: (ll) => {
      const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
      return { x: lng * 10000, y: -lat * 10000 };
    },
    unproject: ([x, y]) => ({ lng: x / 10000, lat: -y / 10000 }),
    getCanvas: () => canvas,
    queryRenderedFeatures: (p, opts) => {
      if (!Array.isArray(p)) throw new Error("ponto deve ser [x, y]");
      return (opts?.layers || []).flatMap((l) => map.sobPonto[l] || []);
    },
  };
  return map;
};

/** Dispara os handlers de um evento (com camada: `on(ev, layer, fn)`; sem: `on(ev, fn)`). */
const disparar = (map, ev, camada, e) => {
  for (const h of [...map.handlers]) {
    if (h[0] !== ev) continue;
    if (camada ? h[1] === camada : typeof h[1] === "function") h[h.length - 1](e);
  }
};

const montar = () => {
  const map = mkMap();
  const { result } = renderHook(() => useMapRenderer(/** @type {any} */ ({ current: map })));
  return { map, r: result.current };
};

const AREA = {
  id: "a1",
  nome: "Pasto 1",
  tamanho_hectares: 12.5,
  coordenadas: { coords: [[0, 0], [0, 0.01], [-0.01, 0.01], [-0.01, 0]], cor: "#0d67ad" },
};
const COCHO = { id: "c1", nome_ponto: "Cocho Norte", categoria_ponto: "COCHO", coordenadas: { lat: -0.005, lng: 0.005 } };
const DEPOSITO = { id: "d1", nome_ponto: "Depósito Sede", categoria_ponto: "DEPOSITO", coordenadas: { lat: -0.006, lng: 0.006 } };
const TXT_75 = "Restante estimado: 150 kg de 200 kg (75%).";
const TXT_SEM_PV = "Estimativa de consumo indisponível: o produto não tinha %PV no lançamento.";
const TXT_DEP_200 = "Saldo de 600 kg: 200% do limite operacional de 300 kg (300 kg acima).";
const FAROL_VAZIO = { cor: "vermelho", hex: "#dc2626", rotulo: "Cocho vazio", texto: "Leitura: Cocho vazio", avisos: 0 };
const cocho = (extra = {}) => ({ ...COCHO, indicador_neutro: false, ...extra });
const BEBEDOURO = { id: "p1", nome: "Bebedouro 1", tipo: "BEBEDOURO", cor: "#0284c7", coordenadas: { lat: -0.002, lng: 0.002 } };
const ICONE_BEB = { id: "ic1", tipo_entidade: "Ponto", categoria: "BEBEDOURO", cor_padrao: "#0284c7", icone_url: "https://icones.exemplo.com/bebedouro.png" };
const TAREFA = { id: "t1", titulo: "Cerca", prioridade: "Urgente", area_id: "a1", status: "Pendente", data_prevista: "2026-11-29" };

const feicoes = (map, fonte) => map.data.get(fonte)?.features || [];
const adds = (map, prefixo) => map.addImage.mock.calls.filter((c) => String(c[0]).startsWith(prefixo));

let canvas;
let renderer = null;
beforeEach(() => {
  marcadores.length = 0;
  limparCacheImagensLotes();
  limparAvisoPontos();
  canvas = instalarCanvasFalso();
  renderer = null;
});
afterEach(() => {
  renderer?.clearAll();
});

describe("P352-1 — imagem por chave", () => {
  it("o cocho vai para a fonte mg-supl com imagem, reserva e título; nenhum marcador HTML", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], vi.fn());
    expect(marcadores).toHaveLength(0);
    expect(map.container.querySelector(".mg-marker, .mg-supl-selo")).toBeNull();
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    expect(f.geometry.coordinates).toEqual([0.005, -0.005]);
    expect(f.properties).toMatchObject({ id: "c1", titulo: `Cocho Norte — ${TXT_75}` });
    expect(f.properties.imagem).toBe(chaveImagemPonto("mg-supl", { urls: [urlIconeCocho(0.75, true)], base: 36, cor: "#10b981" }));
    expect(f.properties.reserva).toMatch(/^mg-supl-res\|#10b981\|/);
    expect(map.images.has(f.properties.imagem)).toBe(true);
    expect(map.images.has(f.properties.reserva)).toBe(true);
    expect(map.images.get(f.properties.imagem).opts).toEqual({ pixelRatio: window.devicePixelRatio || 1 });
    // a chave não carrega a data URL inteira (vários KB): só um resumo
    expect(f.properties.imagem.length).toBeLessThan(80);
    expect(resumoDaUrl(urlIconeCocho(0.75, true))).not.toBe(resumoDaUrl(urlIconeCocho(0.74, true)));
    expect(ehImagemDePonto(f.properties.imagem) && ehImagemDePonto(f.properties.reserva)).toBe(true);
    expect(ehImagemDePonto("mg-lote|x|1")).toBe(false);
  });

  it("dois cochos no mesmo nível dividem a imagem; refetch não desenha nem registra de novo; nível novo = imagem nova", async () => {
    const { map, r } = montar();
    renderer = r;
    const dois = [cocho({ indicador_percentual: 0.5 }), { ...cocho({ indicador_percentual: 0.5 }), id: "c2", coordenadas: { lat: -0.007, lng: 0.007 } }];
    await r.syncPontosSuplementacao(dois, true, [], vi.fn());
    const fs = feicoes(map, SUPL_SOURCE_ID);
    expect(fs).toHaveLength(2);
    expect(fs[0].properties.imagem).toBe(fs[1].properties.imagem);
    const imagens = adds(map, "mg-supl|").length;
    const desenhos = canvas.desenhos();
    expect(imagens).toBe(1);
    const dados = map.data.get(SUPL_SOURCE_ID);

    await r.syncPontosSuplementacao(dois.map((p) => ({ ...p })), true, [], vi.fn());
    expect(canvas.desenhos()).toBe(desenhos);
    expect(adds(map, "mg-supl|")).toHaveLength(1);
    expect(map.data.get(SUPL_SOURCE_ID)).toBe(dados); // nada mudou: nem setData

    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.25 })], true, [], vi.fn());
    expect(feicoes(map, SUPL_SOURCE_ID)[0].properties.imagem).not.toBe(fs[0].properties.imagem);
    expect(adds(map, "mg-supl|")).toHaveLength(2);
    // a figura nova é o SVG do nível novo
    expect(canvas.figurasCarregadas).toContain(urlIconeCocho(0.25, true));
  });

  it("depósito: figura do depósito no nível; ponto de referência: ícone do tipo (40 px) ou círculo da cor", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([{ ...DEPOSITO, indicador_percentual: 0.5 }], true, [], vi.fn());
    expect(canvas.figurasCarregadas).toContain(urlIconeDeposito(0.5, true));
    await r.syncPontos([BEBEDOURO, { ...BEBEDOURO, id: "p2", tipo: "PORTEIRA", nome: "Porteira" }], true, [ICONE_BEB], vi.fn());
    const [beb, porteira] = feicoes(map, PONTOS_SOURCE_ID);
    expect(beb.properties).toMatchObject({ id: "p1", titulo: "Bebedouro 1" });
    expect(beb.properties.imagem).toBe(chaveImagemPonto("mg-ponto", { urls: [ICONE_BEB.icone_url], base: 40, cor: "#0284c7" }));
    // figura de outra origem é pedida com CORS (sem ele o canvas ficaria sujo)
    expect(canvas.crossOrigin.at(-1)).toBe("anonymous");
    // 64 × 64 → 40 × 40, centrada
    const fig = canvas.chamadas.find((c) => c.nome === "drawImage" && c.args[0]?._src === ICONE_BEB.icone_url);
    expect(fig.args.slice(1)).toEqual([0, 0, 40, 40]);
    // sem ícone: o círculo da cor (raio 20, borda branca 3 px, sombra), como o marcador antigo
    expect(porteira.properties.imagem).toBe(chaveImagemPonto("mg-ponto", { urls: [], base: 40, cor: "#0284c7" }));
    const cor = canvas.chamadas.find((c) => c.nome === "arc" && c.estado.fillStyle === "#0284c7");
    expect(cor.args[2]).toBe(17);
    const branco = canvas.chamadas.find((c) => c.nome === "fill" && c.estado.shadowColor === "rgba(0,0,0,.35)" && c.largura === 48);
    expect(branco.estado).toMatchObject({ fillStyle: "#ffffff", shadowBlur: 3, shadowOffsetY: 1 });
  });
});

describe("P352-2 — selo e farol do cocho", () => {
  it("neutro: selo '?' cinza 13 px à direita/14 acima do centro; farol 13 à direita/12 abaixo; figura 34 × 36 no centro", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0, indicador_neutro: true, indicador_titulo: TXT_SEM_PV, indicador_farol: FAROL_VAZIO })], true, [], vi.fn());
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    const { img } = map.images.get(f.properties.imagem);
    // imagem simétrica em volta do centro do ícone (âncora center, como o marcador)
    expect([img.width, img.height]).toEqual([50, 52]);
    const cx = 25, cy = 26;
    const fig = canvas.chamadas.find((c) => c.nome === "drawImage" && c.largura === 50);
    expect(fig.args.slice(1)).toEqual([cx - 17, cy - 18, 34, 36]);
    // selo
    const s = { x: cx + SELO_SUPL.dx, y: cy + SELO_SUPL.dy };
    const borda = canvas.chamadas.find((c) => c.nome === "arc" && c.largura === 50 && c.args[0] === s.x && c.args[1] === s.y && c.args[2] === 8);
    expect(borda.estado.fillStyle).toBe("#ffffff");
    const fundo = canvas.chamadas.find((c) => c.nome === "arc" && c.largura === 50 && c.args[0] === s.x && c.args[1] === s.y && c.args[2] === 6);
    expect(fundo.estado.fillStyle).toBe(CORES_SELO_SUPLEMENTACAO.neutro.fundo);
    const sombra = canvas.chamadas.find((c) => c.nome === "fill" && c.largura === 50 && c.estado.shadowBlur === 2);
    expect(sombra.estado).toMatchObject({ shadowColor: "rgba(0,0,0,.35)", shadowOffsetY: 1 });
    const texto = canvas.chamadas.find((c) => c.nome === "fillText" && c.args[0] === "?");
    expect(texto.args[1]).toBe(s.x);
    expect(texto.estado).toMatchObject({ fillStyle: "#ffffff", font: "700 10px Inter, Arial, sans-serif", textAlign: "center" });
    // farol
    const farol = canvas.chamadas.find((c) => c.nome === "arc" && c.largura === 50 && c.estado.fillStyle === "#dc2626");
    expect(farol.args.slice(0, 3)).toEqual([cx + FAROL_SUPL.dx, cy + FAROL_SUPL.dy, 4]);
    // o título leva o nível e o farol (o que era o aria-label)
    expect(f.properties.titulo).toBe(`Cocho Norte — ${TXT_SEM_PV} · Leitura: Cocho vazio`);
    // a reserva leva os mesmos selo e farol
    expect(f.properties.reserva).toBe("mg-supl-res|#10b981|neutro|#dc2626|");
  });

  it("depósito acima do limite: selo '!' âmbar com texto escuro; voltar ao normal tira o selo (imagem sem selo, 34 × 36)", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([{ ...DEPOSITO, indicador_percentual: 1, indicador_alerta_excesso: true, indicador_titulo: TXT_DEP_200 }], true, [], vi.fn());
    const texto = canvas.chamadas.find((c) => c.nome === "fillText" && c.args[0] === "!");
    expect(texto.estado.fillStyle).toBe(CORES_SELO_SUPLEMENTACAO.excesso.texto);
    expect(canvas.chamadas.find((c) => c.nome === "arc" && c.args[2] === 6 && c.estado.fillStyle === "#f59e0b")).toBeTruthy();
    expect(feicoes(map, SUPL_SOURCE_ID)[0].properties.titulo).toContain("200%");

    canvas.chamadas.length = 0;
    await r.syncPontosSuplementacao([{ ...DEPOSITO, indicador_percentual: 0.5 }], true, [], vi.fn());
    expect(canvas.textos()).toEqual([]);
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    expect(f.properties.imagem.endsWith("||")).toBe(true);
  });
});

describe("P352-3 — tarefa", () => {
  it("indicador como o aplicarIndicadorTarefa: '3d' na cor do prazo, 7 px para fora à direita, 4 px acima do pé", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncTarefas([TAREFA], [AREA], [], vi.fn(), "2026-11-26");
    const [f] = feicoes(map, TAREFAS_SOURCE_ID);
    const ind = indicadorTarefa(TAREFA, "2026-11-26");
    expect(ind.texto).toBe("3d");
    expect(f.properties).toMatchObject({ id: "t1", urgente: true, titulo: `Cerca — prioridade Urgente — ${ind.descricao}` });
    const { iconUrl, cor } = resolverIconeTarefa(TAREFA, []);
    expect(iconUrl).toBe(urlIconeTarefa("Urgente"));
    expect(f.properties.imagem).toBe(chaveImagemPonto("mg-tarefa", { urls: [iconUrl], base: 40, cor, indicador: ind }));
    const { img } = map.images.get(f.properties.imagem);
    expect([img.width, img.height]).toEqual([50, 40]);
    // figura 40 × 44 → 36 × 40, centrada
    const fig = canvas.chamadas.find((c) => c.nome === "drawImage" && c.largura === 50);
    expect(fig.args.slice(1)).toEqual([7, 0, 36, 40]);
    // pílula de 22 × 22: direita em 25 + 18 + 7 = 50, pé em 20 + 20 − 4 = 36
    // (a reserva também leva o "3d", numa imagem de outra largura)
    const texto = canvas.chamadas.find((c) => c.nome === "fillText" && c.largura === 50 && c.args[0] === "3d");
    expect(texto.args[1]).toBe(50 - 11);
    expect(texto.estado).toMatchObject({ fillStyle: "#ffffff", font: "700 10px Arial, sans-serif" });
    const fundo = canvas.chamadas.find((c) => c.nome === "arc" && c.largura === 50 && c.estado.fillStyle === ind.cor);
    expect(fundo.args[1]).toBe(36 - 11);
    // centrada a pílula no "99+" mais largo: 6 px por letra + folga + borda = 26
    canvas.chamadas.length = 0;
    await r.syncTarefas([{ ...TAREFA, data_prevista: "2027-06-01" }], [AREA], [], vi.fn(), "2026-11-26");
    const t99 = canvas.chamadas.find((c) => c.nome === "fillText" && c.largura === 50 && c.args[0] === "99+");
    expect(t99.args[1]).toBe(50 - 13);
  });

  it("Urgente por cima das outras (symbol-sort-key); mudar prazo/estado troca a imagem do MESMO ponto", async () => {
    const [tarefas] = camadasAcimaDosLotes();
    expect(tarefas.layout["symbol-sort-key"]).toEqual(["case", ["boolean", ["get", "urgente"], false], 1, 0]);
    const { map, r } = montar();
    renderer = r;
    await r.syncTarefas([TAREFA, { ...TAREFA, id: "t2", prioridade: "Baixa" }], [AREA], [], vi.fn(), "2026-11-26");
    // a Urgente vai no fim dos dados: é desenhada por cima e o MapLibre devolve o clique na ordem inversa dos dados
    expect(feicoes(map, TAREFAS_SOURCE_ID).map((f) => [f.properties.id, f.properties.urgente])).toEqual([["t2", false], ["t1", true]]);
    const antes = feicoes(map, TAREFAS_SOURCE_ID).find((f) => f.properties.id === "t1").properties.imagem;
    await r.syncTarefas([{ ...TAREFA, status: "Em Andamento" }], [AREA], [], vi.fn(), "2026-11-30");
    const [f] = feicoes(map, TAREFAS_SOURCE_ID);
    expect(f.properties.imagem).not.toBe(antes);
    expect(canvas.textos()).toContain("1d");
    expect(f.properties.titulo).toContain("Em andamento, 1 dia(s) de atraso");
  });
});

describe("P352-4 — ordem das camadas", () => {
  it("cocho < ponto < lote < identificador < tarefa, como o z-index dos marcadores antigos", async () => {
    const { map, r } = montar();
    renderer = r;
    r.ensureLayers();
    const ids = map.layers.map((l) => l.id);
    const ordem = [SUPL_LAYER_ID, PONTOS_LAYER_ID, LOTES_LAYER_ID, LOTES_IDENT_LAYER_ID, TAREFAS_LAYER_ID].map((id) => ids.indexOf(id));
    expect(ordem.every((v, i) => v > -1 && (i === 0 || v > ordem[i - 1]))).toBe(true);
    expect(ids.indexOf(SUPL_LAYER_ID)).toBeGreaterThan(ids.indexOf("mg-areas-fill"));
    expect(ORDEM_CLICAVEIS).toEqual([TAREFAS_LAYER_ID, LOTES_LAYER_ID, PONTOS_LAYER_ID, SUPL_LAYER_ID]);
    for (const c of [...camadasAbaixoDosLotes(), ...camadasAcimaDosLotes()]) {
      expect(c.layout).toMatchObject({
        "icon-image": ["coalesce", ["image", ["get", "imagem"]], ["image", ["get", "reserva"]]],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      });
      expect(JSON.stringify(c)).not.toMatch(/text-field/);
    }
  });

  it("estilo antigo com os lotes já criados: cocho e ponto entram ANTES dos lotes", () => {
    const map = mkMap();
    map.addLayer({ id: LOTES_LAYER_ID });
    map.addLayer({ id: LOTES_IDENT_LAYER_ID });
    const { result } = renderHook(() => useMapRenderer(/** @type {any} */ ({ current: map })));
    result.current.ensureLayers();
    const ids = map.layers.map((l) => l.id);
    expect(ids.indexOf(PONTOS_LAYER_ID)).toBeLessThan(ids.indexOf(LOTES_LAYER_ID));
    expect(ids.indexOf(SUPL_LAYER_ID)).toBeLessThan(ids.indexOf(PONTOS_LAYER_ID));
    expect(ids.indexOf(TAREFAS_LAYER_ID)).toBeGreaterThan(ids.indexOf(LOTES_IDENT_LAYER_ID));
    result.current.clearAll();
  });
});

describe("P352-5 — clique", () => {
  const preparar = async () => {
    const { map, r } = montar();
    renderer = r;
    const cb = { area: vi.fn(), supl: vi.fn(), ponto: vi.fn(), tarefa: vi.fn(), lotes: vi.fn() };
    r.syncAreas([AREA], true, cb.area, vi.fn(), null);
    r.syncLinhas([{ id: "ln1", nome: "Cerca", tipo: "Cerca", coordenadas: { coords: [[0, 0], [0, 0.01]] } }], true);
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], cb.supl);
    await r.syncPontos([BEBEDOURO], true, [], cb.ponto);
    await r.syncTarefas([TAREFA], [AREA], [], cb.tarefa, "2026-11-26");
    await r.syncLotes([{ id: "l1", area_atual_id: "a1", quantidade_cabecas: 3 }], [AREA], true, [], cb.lotes, vi.fn(), true, false);
    const e = (props) => ({ point: { x: 5, y: 5 }, lngLat: { lat: 0, lng: 0 }, features: [{ properties: props }] });
    return { map, r, cb, e };
  };

  it("cada camada chama o callback de hoje com o objeto MAIS NOVO; a área e a linha por baixo não abrem", async () => {
    const { map, r, cb, e } = await preparar();
    map.sobPonto[SUPL_LAYER_ID] = [{ properties: { id: "c1" } }];
    disparar(map, "click", SUPL_LAYER_ID, e({ id: "c1" }));
    disparar(map, "click", "mg-areas-fill", e({ id: "a1" }));
    disparar(map, "click", "mg-linhas", e({ id: "ln1" }));
    expect(cb.supl).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", indicador_percentual: 0.75 }));
    expect(cb.area).not.toHaveBeenCalled();
    expect(globalThis.__popupsD352).toHaveLength(0);
    expect(r.hitArea({ x: 5, y: 5 })).toBe(true);
    expect(r.hitPonto({ x: 5, y: 5 })).toBe(true);
    expect(r.hitLote({ x: 5, y: 5 })).toBe(false);

    // o nível muda: o clique entrega o ponto novo
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.25 })], true, [], cb.supl);
    disparar(map, "click", SUPL_LAYER_ID, e({ id: "c1" }));
    expect(cb.supl).toHaveBeenLastCalledWith(expect.objectContaining({ indicador_percentual: 0.25 }));

    map.sobPonto = { [PONTOS_LAYER_ID]: [{ properties: { id: "p1" } }] };
    disparar(map, "click", PONTOS_LAYER_ID, e({ id: "p1" }));
    expect(cb.ponto).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", tipo: "BEBEDOURO" }));
    map.sobPonto = { [TAREFAS_LAYER_ID]: [{ properties: { id: "t1" } }] };
    disparar(map, "click", TAREFAS_LAYER_ID, e({ id: "t1" }));
    expect(cb.tarefa).toHaveBeenCalledWith(TAREFA);

    // fora de qualquer ponto, a área abre normalmente
    map.sobPonto = {};
    expect(r.hitPonto({ x: 5, y: 5 })).toBe(false);
    disparar(map, "click", "mg-areas-fill", e({ id: "a1" }));
    expect(cb.area).toHaveBeenCalledTimes(1);
  });

  it("quem está por cima ganha: tarefa sobre o lote abre a tarefa (o lote não abre nem arrasta); lote sobre o ponto abre o lote", async () => {
    const { map, cb, e } = await preparar();
    map.sobPonto = { [TAREFAS_LAYER_ID]: [{ properties: { id: "t1" } }], [LOTES_LAYER_ID]: [{ properties: { areaId: "a1" } }] };
    disparar(map, "click", TAREFAS_LAYER_ID, e({ id: "t1" }));
    disparar(map, "click", LOTES_LAYER_ID, e({ areaId: "a1" }));
    expect(cb.tarefa).toHaveBeenCalledTimes(1);
    expect(cb.lotes).not.toHaveBeenCalled();
    const pd = vi.fn();
    disparar(map, "mousedown", LOTES_LAYER_ID, { ...e({ areaId: "a1" }), type: "mousedown", preventDefault: pd });
    expect(pd).not.toHaveBeenCalled(); // o mapa não trava: o dedo está na tarefa

    map.sobPonto = { [LOTES_LAYER_ID]: [{ properties: { areaId: "a1" } }], [PONTOS_LAYER_ID]: [{ properties: { id: "p1" } }], [SUPL_LAYER_ID]: [{ properties: { id: "c1" } }] };
    disparar(map, "click", LOTES_LAYER_ID, e({ areaId: "a1" }));
    disparar(map, "click", PONTOS_LAYER_ID, e({ id: "p1" }));
    disparar(map, "click", SUPL_LAYER_ID, e({ id: "c1" }));
    expect(cb.lotes).toHaveBeenCalledTimes(1);
    expect(cb.ponto).not.toHaveBeenCalled();
    expect(cb.supl).not.toHaveBeenCalled();

    // ponto sobre cocho: o ponto
    map.sobPonto = { [PONTOS_LAYER_ID]: [{ properties: { id: "p1" } }], [SUPL_LAYER_ID]: [{ properties: { id: "c1" } }] };
    disparar(map, "click", PONTOS_LAYER_ID, e({ id: "p1" }));
    disparar(map, "click", SUPL_LAYER_ID, e({ id: "c1" }));
    expect(cb.ponto).toHaveBeenCalledTimes(1);
    expect(cb.supl).not.toHaveBeenCalled();
  });

  it("ponto sem callback abre o popup com nome e tipo (como antes)", async () => {
    const { map, r } = montar();
    renderer = r;
    globalThis.__popupsD352.length = 0;
    await r.syncPontos([BEBEDOURO], true, [], null);
    map.sobPonto = { [PONTOS_LAYER_ID]: [{ properties: { id: "p1" } }] };
    disparar(map, "click", PONTOS_LAYER_ID, { point: { x: 1, y: 1 }, features: [{ properties: { id: "p1" } }] });
    expect(globalThis.__popupsD352).toHaveLength(1);
    expect(globalThis.__popupsD352[0].el.textContent).toBe("Bebedouro 1BEBEDOURO");
  });

  it("toque longo não começa em cima de um ponto clicável (Mapa Geral consulta hitPonto antes de armar o tempo)", () => {
    expect(deveComecarToqueLongo({ podeUsarTarefasMapa: true, selecionandoLocalTarefa: false, sobreLote: false, sobrePonto: true })).toBe(false);
    expect(deveComecarToqueLongo({ podeUsarTarefasMapa: true, selecionandoLocalTarefa: false, sobreLote: false, sobrePonto: false })).toBe(true);
    const src = readFileSync("src/pages/MapaGeral.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const press = src.slice(src.indexOf("const handlePressStart = (event) => {"), src.indexOf("const handlePressMove"));
    const consulta = press.indexOf("rendererHitPontoRef.current?.(");
    const regra = press.indexOf("deveComecarToqueLongo({ podeUsarTarefasMapa, selecionandoLocalTarefa, sobreLote, sobrePonto })");
    expect(consulta).toBeGreaterThan(-1);
    expect(regra).toBeGreaterThan(consulta);
    expect(press.indexOf("longPressTimerRef.current = setTimeout(")).toBeGreaterThan(regra);
    expect(src).toMatch(/rendererHitPontoRef\.current = renderer\.hitPonto;/);
  });

  it("clique logo depois de arrastar um lote não abre o ponto onde o dedo soltou", async () => {
    const { map, cb, e } = await preparar();
    map.sobPonto = { [LOTES_LAYER_ID]: [{ properties: { areaId: "a1" } }] };
    disparar(map, "mousedown", LOTES_LAYER_ID, { ...e({ areaId: "a1" }), type: "mousedown", preventDefault: vi.fn() });
    disparar(map, "mousemove", null, { point: { x: 60, y: 5 }, originalEvent: { buttons: 1 } });
    disparar(map, "mouseup", null, { point: { x: 60, y: 5 } });
    map.sobPonto = { [SUPL_LAYER_ID]: [{ properties: { id: "c1" } }] };
    disparar(map, "click", SUPL_LAYER_ID, e({ id: "c1" }));
    expect(cb.supl).not.toHaveBeenCalled();
  });
});

describe("P352-6 — reserva", () => {
  it("figura que não carrega: o ponto fica com a reserva (círculo da cor + selo), avisa uma vez e tenta de novo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    canvas.falharUrl = (u) => u === urlIconeCocho(0, true);
    const { map, r } = montar();
    renderer = r;
    const ponto = cocho({ indicador_percentual: 0, indicador_neutro: true });
    await r.syncPontosSuplementacao([ponto], true, [], vi.fn());
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    expect(f).toBeTruthy(); // não some
    expect(map.images.has(f.properties.imagem)).toBe(false);
    expect(map.images.has(f.properties.reserva)).toBe(true);
    // a reserva tem o selo "?" por cima do círculo verde
    expect(canvas.textos()).toContain("?");
    expect(canvas.chamadas.find((c) => c.nome === "arc" && c.args[2] === 17 && c.estado.fillStyle === "#10b981")).toBeTruthy();
    expect(aviso).toHaveBeenCalledTimes(1);

    canvas.falharUrl = null;
    const dados = map.data.get(SUPL_SOURCE_ID);
    await r.syncPontosSuplementacao([ponto], true, [], vi.fn());
    expect(map.images.has(f.properties.imagem)).toBe(true);
    expect(map.data.get(SUPL_SOURCE_ID)).not.toBe(dados); // republicada: o mapa troca a reserva pela figura
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("ícone de outra origem que SUJA o canvas: reserva, sem quebrar — o próximo desenho (lote ou ponto) sai num canvas limpo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    canvas.sujarCom = (u) => u.startsWith("https://");
    const { map, r } = montar();
    renderer = r;
    await r.syncPontos([BEBEDOURO], true, [ICONE_BEB], vi.fn());
    const [f] = feicoes(map, PONTOS_SOURCE_ID);
    expect(map.images.has(f.properties.imagem)).toBe(false);
    expect(map.images.has(f.properties.reserva)).toBe(true);
    // depois disso, um cocho e um lote ainda são desenhados
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5 })], true, [], vi.fn());
    expect(map.images.has(feicoes(map, SUPL_SOURCE_ID)[0].properties.imagem)).toBe(true);
    await r.syncLotes([{ id: "l1", area_atual_id: "a1", quantidade_cabecas: 3 }], [AREA], true, [], vi.fn(), vi.fn(), true, false);
    expect(map.images.has(map.data.get("mg-lotes").features[0].properties.imagem)).toBe(true);
  });

  it("figura remota que falha: a falha é lembrada por MS_FALHA_FIGURA (N pontos/sincronizações = 1 download); depois tenta de novo, até MAX_TENTATIVAS_IMAGEM", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let relogio = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => relogio);
    canvas.falharUrl = (u) => u.startsWith("https://");
    const { map, r } = montar();
    renderer = r;
    const downloads = () => canvas.crossOrigin.filter((c) => c === "anonymous").length;
    const tres = [BEBEDOURO, { ...BEBEDOURO, id: "p2", cor: "#111111" }, { ...BEBEDOURO, id: "p3", cor: "#222222" }];
    for (let i = 0; i < 4; i++) await r.syncPontos(tres, true, [ICONE_BEB], vi.fn());
    expect(downloads()).toBe(1);
    expect(feicoes(map, PONTOS_SOURCE_ID)).toHaveLength(3); // com a reserva
    // passou o tempo: uma tentativa nova (um download para os três)
    relogio += MS_FALHA_FIGURA + 1;
    await r.syncPontos(tres, true, [ICONE_BEB], vi.fn());
    expect(downloads()).toBe(2);
    for (let i = 0; i < MAX_TENTATIVAS_IMAGEM + 2; i++) {
      relogio += MS_FALHA_FIGURA + 1;
      await r.syncPontos(tres, true, [ICONE_BEB], vi.fn());
    }
    expect(downloads()).toBe(MAX_TENTATIVAS_IMAGEM);
  });

  it("tarefas com o mesmo ícone remoto que falha: um download só; todas com o modelo local", async () => {
    canvas.falharUrl = (u) => u.startsWith("https://");
    const { map, r } = montar();
    renderer = r;
    const icone = { tipo_entidade: "Prioridade Tarefa", categoria: "Urgente", icone_url: "https://icones.exemplo.com/urgente.png" };
    const tarefas = ["2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"].map((d, i) => ({ ...TAREFA, id: `t${i}`, data_prevista: d }));
    await r.syncTarefas(tarefas, [AREA], [icone], vi.fn(), "2026-11-26");
    expect(canvas.crossOrigin.filter((c) => c === "anonymous")).toHaveLength(1);
    for (const f of feicoes(map, TAREFAS_SOURCE_ID)) expect(map.images.has(f.properties.imagem)).toBe(true);
  });

  it("figura que NUNCA responde não atrasa os lotes nem os outros pontos; o ponto sai com a reserva e o grupo publica", async () => {
    canvas.penderUrl = (u) => u.startsWith("https://lento.");
    const { map, r } = montar();
    renderer = r;
    const lento = { ...ICONE_BEB, icone_url: "https://lento.exemplo.com/b.png" };
    const porteira = { ...BEBEDOURO, id: "p2", tipo: "PORTEIRA", nome: "Porteira" };
    // não espera: a figura do bebedouro nunca chega (só o tempo-limite de 8 s a encerra)
    void r.syncPontos([BEBEDOURO, porteira], true, [lento], vi.fn());
    const t0 = performance.now();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5 })], true, [], vi.fn());
    await r.syncLotes([{ id: "l1", area_atual_id: "a1", quantidade_cabecas: 3 }], [AREA], true, [], vi.fn(), vi.fn(), true, false);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(map.images.has(feicoes(map, SUPL_SOURCE_ID)[0].properties.imagem)).toBe(true);
    expect(map.images.has(map.data.get("mg-lotes").features[0].properties.imagem)).toBe(true);
    // o grupo dos pontos publica depois de MS_ESPERA_IMAGENS: a porteira com a figura dela, o bebedouro com a reserva
    await vi.waitFor(() => expect(feicoes(map, PONTOS_SOURCE_ID)).toHaveLength(2), { timeout: 2000 });
    const [beb, port] = ["p1", "p2"].map((id) => feicoes(map, PONTOS_SOURCE_ID).find((f) => f.properties.id === id));
    expect(map.images.has(beb.properties.imagem)).toBe(false);
    expect(map.images.has(beb.properties.reserva)).toBe(true);
    expect(map.images.has(port.properties.imagem)).toBe(true);
  });

  it("tarefa com ícone enviado que não carrega: usa o modelo local da prioridade (como o onerror do marcador)", async () => {
    canvas.falharUrl = (u) => u.startsWith("https://");
    const { map, r } = montar();
    renderer = r;
    const icone = { tipo_entidade: "Prioridade Tarefa", categoria: "Urgente", icone_url: "https://icones.exemplo.com/urgente.png" };
    await r.syncTarefas([TAREFA], [AREA], [icone], vi.fn(), "2026-11-26");
    const [f] = feicoes(map, TAREFAS_SOURCE_ID);
    expect(map.images.has(f.properties.imagem)).toBe(true);
    const fig = canvas.chamadas.find((c) => c.nome === "drawImage" && c.largura === 50);
    expect(fig.args[0]._src).toBe(urlIconeTarefa("Urgente"));
  });
});

describe("P352-7 — poda e troca de estilo", () => {
  it("imagens que nenhum ponto usa saem do mapa; com o grupo escondido, nada sai", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5 })], true, [], vi.fn());
    const velha = feicoes(map, SUPL_SOURCE_ID)[0].properties.imagem;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.6 })], true, [], vi.fn());
    expect(map.removeImage).toHaveBeenCalledWith(velha);
    expect(map.images.has(velha)).toBe(false);
    // as imagens de outro grupo ficam
    await r.syncTarefas([TAREFA], [AREA], [], vi.fn(), "2026-11-26");
    const tarefa = feicoes(map, TAREFAS_SOURCE_ID)[0].properties.imagem;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.7 })], true, [], vi.fn());
    expect(map.images.has(tarefa)).toBe(true);
    // escondido pelo filtro: fonte vazia, imagens ficam (mostrar de novo não redesenha)
    map.removeImage.mockClear();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.7 })], false, [], vi.fn());
    expect(feicoes(map, SUPL_SOURCE_ID)).toHaveLength(0);
    expect(map.removeImage).not.toHaveBeenCalled();
    const d = canvas.desenhos();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.7 })], true, [], vi.fn());
    expect(canvas.desenhos()).toBe(d);
  });

  it("troca de estilo: ensureLayers repõe fontes, dados e imagens; styleimagemissing repõe a que faltar", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5 })], true, [], vi.fn());
    await r.syncTarefas([TAREFA], [AREA], [], vi.fn(), "2026-11-26");
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    // estilo novo: sem imagens, sem camadas, sem dados
    map.images.clear();
    map.layers.length = 0;
    map.data.clear();
    r.ensureLayers();
    expect(map.images.has(f.properties.imagem)).toBe(true);
    expect(feicoes(map, SUPL_SOURCE_ID)).toHaveLength(1);
    expect(feicoes(map, TAREFAS_SOURCE_ID)).toHaveLength(1);
    map.images.delete(f.properties.reserva);
    disparar(map, "styleimagemissing", null, { id: f.properties.reserva });
    expect(map.images.has(f.properties.reserva)).toBe(true);
  });

  it("clearAll esvazia as fontes e desliga os eventos das camadas", async () => {
    const { map, r } = montar();
    await r.syncPontosSuplementacao([cocho()], true, [], vi.fn());
    await r.syncPontos([BEBEDOURO], true, [], vi.fn());
    await r.syncTarefas([TAREFA], [AREA], [], vi.fn(), "2026-11-26");
    r.clearAll();
    for (const id of [SUPL_SOURCE_ID, PONTOS_SOURCE_ID, TAREFAS_SOURCE_ID]) expect(feicoes(map, id)).toHaveLength(0);
    expect(map.handlers.filter((h) => typeof h[1] === "string")).toHaveLength(0);
  });
});

describe("P352-8 — texto acessível", () => {
  it("no mouse, cursor de mão e o título (nível do cocho) no canvas; ao sair, some", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.75, indicador_titulo: TXT_75 })], true, [], vi.fn());
    const c = map.getCanvas();
    map.sobPonto = { [SUPL_LAYER_ID]: [{ properties: { id: "c1" } }] };
    disparar(map, "mousemove", SUPL_LAYER_ID, { point: { x: 1, y: 1 }, features: [{ properties: { id: "c1" } }] });
    expect(c.style.cursor).toBe("pointer");
    expect(c.title).toBe(`Cocho Norte — ${TXT_75}`);
    disparar(map, "mouseleave", SUPL_LAYER_ID, {});
    expect(c.style.cursor).toBe("");
    expect(c.title).toBe("");
  });

  it("o renderer não cria mais marcador HTML de ponto, cocho ou tarefa (só a localização)", () => {
    const src = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(src).not.toMatch(/mg-supl-selo|mg-supl-farol|criarMarcadorClicavel|aplicarIndicadorTarefa/);
    expect(src).toMatch(/new maplibregl\.Marker\(\{ element: el, anchor: "center" \}\)/); // localização
  });
});

describe("P352 — imagens só depois de prontas", () => {
  it("as imagens são desenhadas antes de publicar (a fonte só sai com elas no mapa)", async () => {
    const { map, r } = montar();
    renderer = r;
    const p = r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.3 })], true, [], vi.fn());
    expect(feicoes(map, SUPL_SOURCE_ID)).toHaveLength(0);
    await p;
    await esperarImagens();
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    expect(map.images.has(f.properties.imagem)).toBe(true);
  });
});

describe("P352-9 — revisão: sobrepostos, objeto novo e margem transparente", () => {
  it("sobrepostos na mesma camada: abre a Urgente (desenhada por cima) mesmo se o mapa a devolver depois", async () => {
    const { map, r } = montar();
    renderer = r;
    const onTarefa = vi.fn();
    const baixa = { ...TAREFA, id: "t2", prioridade: "Baixa" };
    await r.syncTarefas([TAREFA, baixa], [AREA], [], onTarefa, "2026-11-26");
    map.sobPonto = { [TAREFAS_LAYER_ID]: [{ properties: { id: "t2" } }, { properties: { id: "t1", urgente: true } }] };
    disparar(map, "click", TAREFAS_LAYER_ID, { point: { x: 1, y: 1 }, features: [{ properties: { id: "t2" } }] });
    expect(onTarefa).toHaveBeenCalledTimes(1);
    expect(onTarefa).toHaveBeenCalledWith(TAREFA);
    // o mesmo nos lotes: o com alerta vai no fim dos dados (a ordem em que o MapLibre devolve o clique é a inversa)
    const dados = colecaoLotes([
      { areaId: "a", lngLat: [0, 0], imagem: "x", ident: null, alerta: true, piscar: false, comRotulo: false, nome: "A", cabecas: 1, desenho: "d" },
      { areaId: "b", lngLat: [0, 0], imagem: "x", ident: null, alerta: false, piscar: false, comRotulo: false, nome: "B", cabecas: 1, desenho: "d" },
    ]);
    expect(dados.features.map((f) => f.properties.areaId)).toEqual(["b", "a"]);
  });

  it("o clique entrega o objeto novo mesmo com a imagem nova ainda por desenhar", async () => {
    const { map, r } = montar();
    renderer = r;
    const onSupl = vi.fn();
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5 })], true, [], onSupl);
    const pendente = r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.9, nome_ponto: "Cocho Novo" })], true, [], onSupl);
    map.sobPonto = { [SUPL_LAYER_ID]: [{ properties: { id: "c1" } }] };
    disparar(map, "click", SUPL_LAYER_ID, { point: { x: 1, y: 1 }, features: [{ properties: { id: "c1" } }] });
    expect(onSupl).toHaveBeenLastCalledWith(expect.objectContaining({ indicador_percentual: 0.9, nome_ponto: "Cocho Novo" }));
    await pendente;
  });

  it("toque na margem transparente da imagem não é do ponto: a área abre; no ícone visível, o ponto", async () => {
    const { map, r } = montar();
    renderer = r;
    const onArea = vi.fn();
    const onSupl = vi.fn();
    r.syncAreas([AREA], true, onArea, vi.fn(), null);
    await r.syncPontosSuplementacao([cocho({ indicador_percentual: 0.5, indicador_neutro: true })], true, [], onSupl);
    const [f] = feicoes(map, SUPL_SOURCE_ID);
    // o ícone visível (34 × 36) vai na fonte; a imagem tem 50 × 52 por causa do selo
    expect([f.properties.hw, f.properties.hh]).toEqual([17, 18]);
    const centro = map.project(f.geometry.coordinates);
    map.sobPonto = { [SUPL_LAYER_ID]: [f] };
    const tocar = (dx, dy) => {
      const e = { point: { x: centro.x + dx, y: centro.y + dy }, lngLat: { lat: 0, lng: 0 }, features: [f] };
      disparar(map, "click", SUPL_LAYER_ID, e);
      disparar(map, "click", "mg-areas-fill", { ...e, features: [{ properties: { id: "a1" } }] });
    };
    tocar(23, -20); // no canto do selo/margem: fora do ícone
    expect(onSupl).not.toHaveBeenCalled();
    expect(onArea).toHaveBeenCalledTimes(1);
    expect(r.hitPonto({ x: centro.x + 23, y: centro.y - 20 })).toBe(false);
    tocar(10, 10); // no ícone
    expect(onSupl).toHaveBeenCalledTimes(1);
    expect(onArea).toHaveBeenCalledTimes(1);
    expect(r.hitPonto({ x: centro.x + 10, y: centro.y + 10 })).toBe(true);
  });
});
