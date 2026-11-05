/**
 * Mapa Geral sobre MapLibre — helpers puros (D-PROD-65).
 *
 * Estilo das áreas é o MESMO SSOT do editor (`estiloAreas.js`): cor salva
 * (+5% branco), divisa branca fina por zoom, destaque por feature-state.
 * Coordenadas persistidas `[[lat,lng],…]` → GeoJSON `[lng,lat]` só aqui; zero
 * é coordenada válida (nada de `c[0] || c.lat`).
 */
import { parseVertex, parseVertices, toGeoJsonLineString, toGeoJsonPolygon } from "@/lib/geografia/coords.js";
import { corExibidaNoMapa, paintAreaDestaque, paintAreaDivisa, paintAreaFill } from "./estiloAreas.js";
import { pointInPolygonRing, safeCentroid } from "./taskLocationPicker.js";

export const MG_SOURCE_IDS = Object.freeze({
  AREAS: "mg-areas",
  LINHAS: "mg-linhas",
  USER: "mg-user",
});

export const MG_LAYER_IDS = Object.freeze({
  AREAS_FILL: "mg-areas-fill",
  AREAS_LINE: "mg-areas-line",
  AREAS_DESTAQUE: "mg-areas-destaque",
  LINHAS: "mg-linhas",
  USER_FILL: "mg-user-fill",
  USER_LINE: "mg-user-line",
});

const vazio = () => ({ type: "FeatureCollection", features: [] });

/**
 * Cor da área no Mapa Geral: modo de coloração (se houver) senão a cor salva.
 * @param {any} area
 * @param {((a: any) => string | null) | null | undefined} colorFn
 */
export function corDaAreaNoMapaGeral(area, colorFn) {
  const salva = area?.coordenadas?.cor || area?.cor || "#61aad9";
  const modo = typeof colorFn === "function" ? colorFn(area) : null;
  return modo || salva;
}

/**
 * @param {any[]} areas
 * @param {((a: any) => string | null) | null} [colorFn]
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildMgAreasCollection(areas, colorFn = null) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const area of areas || []) {
    if (!area || area.id == null) continue;
    const geometry = toGeoJsonPolygon(parseVertices(area.coordenadas?.coords));
    if (!geometry) continue;
    const cor = corDaAreaNoMapaGeral(area, colorFn);
    features.push({
      type: "Feature",
      id: String(area.id),
      properties: { id: String(area.id), nome: area.nome || "", cor, fill: corExibidaNoMapa(cor) },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {any[]} linhas
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildMgLinhasCollection(linhas) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const linha of linhas || []) {
    if (!linha || linha.id == null) continue;
    const geometry = toGeoJsonLineString(parseVertices(linha.coordenadas?.coords));
    if (!geometry) continue;
    features.push({
      type: "Feature",
      id: String(linha.id),
      properties: { id: String(linha.id), cor: linha.coordenadas?.cor || linha.cor || "#f59e0b" },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/** Centroide (shoelace) da área; null se geometria inválida. */
export function centroideArea(area) {
  const ring = parseVertices(area?.coordenadas?.coords);
  if (ring.length < 3) return null;
  // D-PROD-127: o ponto mais "de dentro" (longe de todas as bordas), para o
  // nome e o ícone do lote não caírem em cima de uma divisa em área torta.
  return pontoMaisDentro(ring) || pontoRotuloSeguro(ring);
}

/**
 * Ponto bem dentro do polígono e o mais perto possível do meio dele
 * (D-PROD-127): acha a maior folga até as bordas (centro do maior círculo que
 * cabe — "polo de inacessibilidade") e, entre os pontos com ao menos 70%
 * dessa folga, usa o mais perto do centroide. Em área quadrada é o
 * centro; em L, U ou recortada fica no miolo da parte mais larga, nunca numa
 * divisa nem fora. Busca em grade com refinamento (algoritmo polylabel), em
 * metros aproximados (longitude corrigida pela latitude).
 * @param {{ lat: number, lng: number }[]} ring anel aberto válido (≥3)
 * @param {number} [precisao] fração do menor lado da caixa (padrão 1%)
 * @returns {{ lat: number, lng: number } | null}
 */
export function pontoMaisDentro(ring, precisao = 0.01) {
  const r = pontoEFolga(ring, precisao);
  return r ? { lat: r.lat, lng: r.lng } : null;
}

/**
 * O mesmo ponto de `pontoMaisDentro` e a **folga** dele: o raio do círculo livre
 * em volta do ponto (em graus de latitude) — quanto cabe de ícone ali (D-PROD-128).
 * @param {{ lat: number, lng: number }[]} ring
 * @param {number} [precisao]
 * @returns {{ lat: number, lng: number, folga: number } | null}
 */
export function pontoEFolga(ring, precisao = 0.01) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const k = Math.cos(((ring.reduce((t, p) => t + p.lat, 0) / ring.length) * Math.PI) / 180) || 1;
  const pts = ring.map((p) => [p.lng * k, p.lat]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const larg = maxX - minX;
  const alt = maxY - minY;
  const lado = Math.min(larg, alt);
  if (!(lado > 0)) return null;
  const minimo = lado * precisao;

  /** distância com sinal do ponto à borda (positiva dentro) */
  const dist = (x, y) => {
    let dentro = false;
    let menor = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) dentro = !dentro;
      let dx = bx - ax;
      let dy = by - ay;
      let px = ax;
      let py = ay;
      if (dx !== 0 || dy !== 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        px = ax + dx * t;
        py = ay + dy * t;
      }
      dx = x - px;
      dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < menor) menor = d2;
    }
    return (dentro ? 1 : -1) * Math.sqrt(menor);
  };
  const celula = (x, y, h) => {
    const d = dist(x, y);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };

  // começa pelo centroide (em quadrado/retângulo ele já é a resposta)
  const c = safeCentroid(ring);
  let melhor = c ? celula(c.lng * k, c.lat, 0) : celula(minX + larg / 2, minY + alt / 2, 0);
  const centroCaixa = celula(minX + larg / 2, minY + alt / 2, 0);
  if (centroCaixa.d > melhor.d) melhor = centroCaixa;

  const fila = [];
  const h0 = lado / 2;
  for (let x = minX; x < maxX; x += lado) for (let y = minY; y < maxY; y += lado) fila.push(celula(x + h0, y + h0, h0));
  let voltas = 0;
  while (fila.length && voltas++ < 5000) {
    // maior potencial primeiro
    let iMax = 0;
    for (let i = 1; i < fila.length; i += 1) if (fila[i].max > fila[iMax].max) iMax = i;
    const cel = fila.splice(iMax, 1)[0];
    if (cel.d > melhor.d) melhor = cel;
    if (cel.max - melhor.d <= minimo) continue;
    const h = cel.h / 2;
    fila.push(celula(cel.x - h, cel.y - h, h), celula(cel.x + h, cel.y - h, h), celula(cel.x - h, cel.y + h, h), celula(cel.x + h, cel.y + h, h));
  }
  if (!(melhor.d > 0)) return null;

  // Entre os pontos "fundos o bastante" (≥ 70% da maior folga), fica o mais
  // perto do meio da área: numa faixa comprida o nome vai para o meio dela,
  // não para uma ponta qualquer (D-PROD-127).
  const fundo = melhor.d * 0.7;
  const meio = c ? { x: c.lng * k, y: c.lat } : { x: minX + larg / 2, y: minY + alt / 2 };
  /** @type {{ x: number, y: number, d: number }} */
  let escolhido = { x: melhor.x, y: melhor.y, d: melhor.d };
  let perto = Math.hypot(melhor.x - meio.x, melhor.y - meio.y);
  const dMeio = dist(meio.x, meio.y);
  if (dMeio >= fundo) {
    escolhido = { x: meio.x, y: meio.y, d: dMeio };
    perto = 0;
  } else {
    const N = 32;
    for (let i = 0; i <= N; i += 1) {
      for (let j = 0; j <= N; j += 1) {
        const x = minX + (larg * i) / N;
        const y = minY + (alt * j) / N;
        const dd = Math.hypot(x - meio.x, y - meio.y);
        if (dd >= perto) continue;
        const d = dist(x, y);
        if (d >= fundo) {
          escolhido = { x, y, d };
          perto = dd;
        }
      }
    }
  }
  return { lat: escolhido.y, lng: escolhido.x / k, folga: escolhido.d };
}

/**
 * Ponto para rótulo/ícone SEMPRE dentro do polígono (R1 / GEO-11).
 * Convexo: centroide. Côncavo (U, L…) com centroide fora: varre linhas
 * horizontais e usa o meio do trecho interno mais largo — nunca cai em outro pasto.
 * @param {{ lat: number, lng: number }[]} ring anel aberto válido (≥3)
 * @returns {{ lat: number, lng: number } | null}
 */
export function pontoRotuloSeguro(ring) {
  const c = safeCentroid(ring);
  if (c && pointInPolygonRing(c, ring)) return c;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  if (!(maxLat > minLat)) return c;
  let melhor = null;
  const FAIXAS = 24;
  for (let k = 1; k < FAIXAS; k += 1) {
    const y = minLat + ((maxLat - minLat) * k) / FAIXAS;
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.lat > y) !== (b.lat > y)) xs.push(a.lng + ((y - a.lat) * (b.lng - a.lng)) / (b.lat - a.lat));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const largura = xs[i + 1] - xs[i];
      // prefere trechos largos e perto do meio vertical
      const peso = largura * (1 - Math.abs(k / FAIXAS - 0.5));
      if (!melhor || peso > melhor.peso) melhor = { peso, lat: y, lng: (xs[i] + xs[i + 1]) / 2 };
    }
  }
  return melhor ? { lat: melhor.lat, lng: melhor.lng } : c;
}

/**
 * Sigla curta da área para o mapa afastado (D-PROD-126): a do cadastro; sem
 * ela, o nome sem o prefixo ("KM - 01 A" → "01 A", "KM - 01" → "01").
 * @param {{ sigla?: string | null, nome?: string | null } | null | undefined} area
 */
export function siglaDaArea(area) {
  const sigla = String(area?.sigla ?? "").trim();
  if (sigla) return sigla;
  const nome = String(area?.nome ?? "").trim();
  const semPrefixo = nome.replace(/^[^\d-]*-\s*/u, "").trim();
  return semPrefixo || nome;
}

/**
 * Tamanho e posição do ícone do lote para ficar DENTRO do pasto (D-PROD-128).
 * `raio` = folga em volta do ponto da área, em px na tela. O ícone (44 px)
 * fica com a ponta no ponto, todo acima dele, quando cabe (raio ≥ 48 px).
 * Com menos folga ele desce, aos poucos, até ficar centrado no ponto, e
 * encolhe (até 45%, para continuar legível) para caber no círculo — contínuo com o zoom, sem pulos.
 * @param {number | null | undefined} raio folga em px (sem folga conhecida: tamanho normal)
 * @returns {{ escala: number, desce: number, base: number }} escala; quanto o
 *   centro do ícone desce (px, 0 = ponta no ponto, 26 = centrado no ponto); e
 *   onde fica a base do ícone em relação ao ponto (px, para o nome ir logo abaixo)
 */
export function layoutLote(raio) {
  if (!(Number(raio) > 0)) return { escala: 1, desce: 0, base: -4 };
  const r = Number(raio);
  const escala = Math.max(0.45, Math.min(1, Math.floor((r / 27.5) * 20) / 20));
  const desce = Math.round(26 * Math.max(0, Math.min(1, (48 - r) / 20.5)) * 10) / 10;
  const base = Math.round((-26 + desce + 22 * escala) * 10) / 10;
  return { escala, desce, base };
}

/**
 * Nível dos rótulos de área, IGUAL para todos (D-PROD-126) — sem mostrar uns
 * e esconder outros. "tudo" (nome + ha) se cabe; senão "nome"; senão "sigla".
 * Cabe = o rótulo cabe na caixa da própria área na tela e não bate em outro
 * rótulo nem em ícone de lote. Tolera uns poucos casos (`tolerancia`) para uma
 * área minúscula não derrubar o mapa inteiro para a sigla.
 *
 * @typedef {{ x: number, y: number, w: number, h: number }} Caixa
 * @param {Array<{ id: string, area: Caixa, tudo: Caixa, nome: Caixa }>} rotulos caixas na tela (px)
 * @param {Array<Caixa & { dono?: string }> | { tudo: Array<Caixa & { dono?: string }>, nome: Array<Caixa & { dono?: string }> }} [obstaculos] ícones de lote etc.; por nível quando eles mudam de lugar com o nível. `dono` = id da área do ícone: o ícone da própria área não conta contra o nome dela
 * @param {{ folga?: number, sobraNaArea?: number, tolerancia?: number }} [opcoes]
 * @returns {"tudo" | "nome" | "sigla"}
 */
export function escolherModoRotulos(rotulos, obstaculos = [], { folga = 2, sobraNaArea = 6, tolerancia = 0.1 } = {}) {
  if (!rotulos.length) return "tudo";
  const bate = (a, b) => a.x < b.x + b.w + folga && b.x < a.x + a.w + folga && a.y < b.y + b.h + folga && b.y < a.y + a.h + folga;
  const problemas = (/** @type {"tudo" | "nome"} */ chave) => {
    let n = 0;
    rotulos.forEach((r, i) => {
      const c = r[chave];
      const naoCabe = c.w > r.area.w + sobraNaArea || c.h > r.area.h + sobraNaArea;
      const obs = Array.isArray(obstaculos) ? obstaculos : obstaculos[chave] || [];
      const colide = obs.some((o) => o.dono !== r.id && bate(c, o)) || rotulos.some((o, k) => k !== i && bate(c, o[chave]));
      if (naoCabe || colide) n += 1;
    });
    return n;
  };
  const limite = Math.floor(rotulos.length * tolerancia);
  if (problemas("tudo") <= limite) return "tudo";
  if (problemas("nome") <= limite) return "nome";
  return "sigla";
}

/** Fonte do rótulo por faixas largas de zoom (sem “pulsar” a cada leve zoom). */
export function fontesRotuloPorZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom < 13) return { nome: 10, ha: 9 };
  if (zoom < 16) return { nome: 11, ha: 10 };
  return { nome: 12, ha: 10.5 };
}

/** "ha 12,34" (área pastejada se houver, senão tamanho); null se ≤ 0. */
export function textoHectares(area) {
  const pastejada = Number(area?.area_pastejada);
  const ha = Number.isFinite(pastejada) && pastejada > 0 ? pastejada : Number(area?.tamanho_hectares);
  if (!Number.isFinite(ha) || ha <= 0) return null;
  return `ha ${ha.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Ícone sem achatar (sem piso no eixo menor). */
export function iconeSemAchatar(naturalWidth, naturalHeight, base) {
  const w = naturalWidth > 0 ? naturalWidth : base;
  const h = naturalHeight > 0 ? naturalHeight : base;
  const r = w / h;
  return r >= 1 ? { width: base, height: Math.max(1, Math.round(base / r)) } : { width: Math.max(1, Math.round(base * r)), height: base };
}

const norm = (v) => String(v ?? "").toUpperCase().trim();
const normAcento = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

/** Mesma resolução de ícone do renderer anterior (ConfiguracaoIcone). */
export function resolverIconePonto(ponto, iconesConfig = []) {
  const cfg =
    iconesConfig.find((ic) => ic.id === ponto.configuracao_icone_id) ||
    iconesConfig.find((ic) => ic.tipo_entidade === "Ponto" && norm(ic.categoria) === norm(ponto.tipo));
  return { iconUrl: cfg?.icone_url || null, cor: cfg?.cor_padrao || ponto.cor || "#0066ff" };
}

export function resolverIconeSuplementacao(ponto, iconesConfig = []) {
  const categoria = norm(ponto.categoria_ponto || ponto.tipo || "COCHO");
  const doTipo = (cat) => iconesConfig.find((ic) => ic.tipo_entidade === "Ponto" && norm(ic.categoria) === cat);
  const cfg = doTipo(categoria) || doTipo(norm(ponto.tipo)) || doTipo("COCHO");
  return { iconUrl: cfg?.icone_url || null, cor: cfg?.cor_padrao || "#10b981", categoria };
}

export function resolverIconeLote(lotesNaArea, iconesConfig = []) {
  const cats = [...new Set(lotesNaArea.map((l) => norm(l.categoria)).filter(Boolean))].sort();
  let cfg = null;
  if (cats.length === 1) {
    cfg = iconesConfig.find((ic) => ic.tipo_entidade === "Lote" && norm(ic.categoria) === cats[0]) || null;
  } else if (cats.length > 1) {
    const validos = iconesConfig
      .filter((ic) => ic.tipo_entidade === "Lote" && norm(ic.categoria) === "MISTO" && Array.isArray(ic.categorias_misto) && ic.categorias_misto.length > 0)
      .filter((c) => cats.every((cat) => c.categorias_misto.map(norm).includes(cat)))
      .sort((a, b) => a.categorias_misto.length - b.categorias_misto.length);
    cfg = validos[0] || null;
  }
  return { iconUrl: cfg?.icone_url || null, categorias: cats.join("|") };
}

const CORES_PRIORIDADE = { Baixa: "#94a3b8", Normal: "#3b82f6", Alta: "#f59e0b", Urgente: "#ef4444" };

export function resolverIconeTarefa(tarefa, iconesConfig = []) {
  const cfg = iconesConfig.find((ic) => ic.tipo_entidade === "Prioridade Tarefa" && normAcento(ic.categoria) === normAcento(tarefa.prioridade));
  return { iconUrl: cfg?.icone_url || null, cor: CORES_PRIORIDADE[tarefa.prioridade] || "#3b82f6" };
}

/**
 * Bounds [lng,lat] de todas as áreas (para o fit inicial).
 * @returns {[[number, number], [number, number]] | null}
 */
export function boundsDasAreas(areas) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const a of areas || []) {
    for (const p of parseVertices(a?.coordenadas?.coords)) {
      if (p.lng < w) w = p.lng;
      if (p.lng > e) e = p.lng;
      if (p.lat < s) s = p.lat;
      if (p.lat > n) n = p.lat;
    }
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

/** Visão salva por empresa; inválida → null. */
export function lerVisaoSalva(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const c = parseVertex(v?.center);
    return c && Number.isFinite(v?.zoom) ? { center: c, zoom: v.zoom } : null;
  } catch {
    return null;
  }
}

/**
 * Sources/layers do Mapa Geral — idempotente (reaplicável após setStyle).
 * Ordem: áreas (fill, divisa, destaque) → linhas → localização.
 * @param {any} map
 */
export function ensureMgLayers(map) {
  const src = (id, extra = {}) => {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: vazio(), ...extra });
  };
  src(MG_SOURCE_IDS.AREAS, { promoteId: "id" });
  src(MG_SOURCE_IDS.LINHAS, { promoteId: "id" });
  src(MG_SOURCE_IDS.USER);
  const layer = (spec) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  };
  layer({ id: MG_LAYER_IDS.AREAS_FILL, type: "fill", source: MG_SOURCE_IDS.AREAS, paint: paintAreaFill("fill") });
  layer({ id: MG_LAYER_IDS.AREAS_LINE, type: "line", source: MG_SOURCE_IDS.AREAS, paint: paintAreaDivisa() });
  layer({ id: MG_LAYER_IDS.AREAS_DESTAQUE, type: "line", source: MG_SOURCE_IDS.AREAS, paint: paintAreaDestaque() });
  layer({
    id: MG_LAYER_IDS.LINHAS,
    type: "line",
    source: MG_SOURCE_IDS.LINHAS,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["coalesce", ["get", "cor"], "#f59e0b"], "line-width": 3 },
  });
  layer({ id: MG_LAYER_IDS.USER_FILL, type: "fill", source: MG_SOURCE_IDS.USER, paint: { "fill-color": "#4285F4", "fill-opacity": 0.15 } });
  layer({ id: MG_LAYER_IDS.USER_LINE, type: "line", source: MG_SOURCE_IDS.USER, paint: { "line-color": "#4285F4", "line-opacity": 0.3, "line-width": 1 } });
}
