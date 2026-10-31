/**
 * Leitura de contornos de área em KML e GeoJSON (D-PROD-90) — regra pura.
 *
 * Entrada: nome do arquivo (ou `null` para texto colado) e o texto. Saída: um
 * item por elemento do arquivo, já classificado:
 *
 *   area      Polygon de um só anel (ou MultiPolygon/MultiGeometry com UMA
 *             parte, convertido sem perda). Pode seguir para a conferência;
 *   ignorado  ponto ou linha — não é área e nunca vira ponto/linha aqui;
 *   invalido  algo que o cadastro não representa sem perder dado (buraco,
 *             várias partes, coordenada fora de WGS84, contorno que se cruza…).
 *             Nunca é gravado pela metade nem "só o primeiro anel".
 *
 * Contrato de coordenadas: GeoJSON/KML trazem `lng,lat`; o item devolve
 * `vertices: [{lat, lng}]` em anel ABERTO, e `toPersistedCoords` produz o
 * `[[lat, lng], ...]` gravado. 0 é coordenada válida: nada de `x || y`.
 *
 * Segurança: XML com DOCTYPE/ENTITY é recusado antes de ser lido; nenhuma
 * referência remota (NetworkLink, ícone, imagem) é seguida; texto do arquivo
 * vira só dado (nome, sigla), limpo e com tamanho limitado.
 */

import { isValidLatLng } from "./coords.js";
import { areaHectares, validatePolygonForSave } from "./medidas.js";
import { anelSeAutoIntersecta } from "./topologia.js";

export const LIMITES_ARQUIVO = Object.freeze({
  /** Tamanho máximo do arquivo lido no navegador. */
  maxBytes: 10 * 1024 * 1024,
  /** Elementos (Placemark/Feature) lidos de um arquivo. */
  maxElementos: 500,
  /** Vértices por contorno (o servidor recusa acima disso). */
  maxVerticesPorArea: 5000,
});

export const EXTENSOES_ACEITAS = Object.freeze([".kml", ".geojson", ".json"]);

/** Diferença tolerada entre a área informada no arquivo e a calculada. */
const TOLERANCIA_DIVERGENCIA = Object.freeze({ relativa: 0.01, absolutaHa: 0.01 });

const CRS_WGS84 = new Set([
  "urn:ogc:def:crs:OGC:1.3:CRS84",
  "urn:ogc:def:crs:OGC::CRS84",
  "urn:ogc:def:crs:EPSG::4326",
  "EPSG:4326",
]);

const CHAVES_NOME = ["name", "Name", "NAME", "nome", "Nome", "NOME", "title", "Title", "titulo", "Titulo"];
const CHAVES_SIGLA = ["sigla", "Sigla", "SIGLA"];
const CHAVES_AREA_HA = ["area_hectares", "area_ha", "hectares", "Hectares", "area", "Area", "AREA"];

/** Texto do arquivo → dado de exibição: sem controle, espaços colapsados, limitado. */
export const textoDoArquivo = (valor, max = 255) => {
  if (typeof valor !== "string") return "";
  return valor
    // Caracteres de controle e invisíveis viram espaço: o nome é só exibição.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
};

const extensaoDe = (nome) => {
  const m = /\.[^.]+$/.exec(String(nome ?? "").toLowerCase());
  return m ? m[0] : "";
};

/**
 * Identifica o formato por extensão E conteúdo. Contradição é erro.
 * @param {string | null} nomeArquivo
 * @param {string} texto já sem BOM
 * @returns {{ formato: 'kml' | 'geojson' } | { erro: string }}
 */
export function detectarFormato(nomeArquivo, texto) {
  const pareceXml = texto.startsWith("<");
  const pareceJson = texto.startsWith("{") || texto.startsWith("[");
  if (nomeArquivo) {
    const ext = extensaoDe(nomeArquivo);
    if (ext === ".kmz") return { erro: "Arquivo KMZ é compactado. Extraia o .kml de dentro dele e envie o .kml." };
    if (!EXTENSOES_ACEITAS.includes(ext)) {
      return { erro: "Formato não aceito. Envie um arquivo .kml, .geojson ou .json com GeoJSON." };
    }
    if (ext === ".kml") {
      return pareceXml ? { formato: "kml" } : { erro: "O arquivo tem extensão .kml, mas o conteúdo não é XML/KML." };
    }
    return pareceJson
      ? { formato: "geojson" }
      : { erro: `O arquivo tem extensão ${ext}, mas o conteúdo não é JSON.` };
  }
  if (pareceXml) return { formato: "kml" };
  if (pareceJson) return { formato: "geojson" };
  return { erro: "Conteúdo não reconhecido. Cole um KML ou um GeoJSON." };
}

/**
 * Normaliza o anel: tira o vértice de fechamento repetido e repetições em
 * sequência (não são vértices reais), e valida. Nunca descarta vértice
 * inválido em silêncio: qualquer um invalida o contorno inteiro.
 *
 * @param {{lat: number, lng: number}[]} brutos
 * @returns {{ ok: true, vertices: {lat: number, lng: number}[], hectares: number, avisos: string[] }
 *   | { ok: false, motivo: string }}
 */
export function normalizarAnel(brutos) {
  /** @type {string[]} */
  const avisos = [];
  for (let i = 0; i < brutos.length; i += 1) {
    const v = brutos[i];
    if (!isValidLatLng(v.lat, v.lng)) {
      const foraDaFaixa = Number.isFinite(v.lat) && Number.isFinite(v.lng);
      return {
        ok: false,
        motivo: foraDaFaixa
          ? `Vértice ${i + 1} fora de latitude/longitude WGS84 (o arquivo está em outra projeção?).`
          : `Vértice ${i + 1} com coordenada inválida.`,
      };
    }
  }
  const anel = [...brutos];
  if (anel.length >= 2 && anel[0].lat === anel[anel.length - 1].lat && anel[0].lng === anel[anel.length - 1].lng) {
    anel.pop();
  }
  /** @type {{lat: number, lng: number}[]} */
  const vertices = [];
  let repetidos = 0;
  for (const v of anel) {
    const ultimo = vertices[vertices.length - 1];
    if (ultimo && ultimo.lat === v.lat && ultimo.lng === v.lng) {
      repetidos += 1;
      continue;
    }
    vertices.push(v);
  }
  if (vertices.length >= 2) {
    const a = vertices[0];
    const z = vertices[vertices.length - 1];
    if (a.lat === z.lat && a.lng === z.lng) {
      vertices.pop();
      repetidos += 1;
    }
  }
  if (repetidos > 0) avisos.push(`${repetidos} vértice(s) repetido(s) em sequência desconsiderado(s).`);
  if (vertices.length > LIMITES_ARQUIVO.maxVerticesPorArea) {
    return { ok: false, motivo: `Contorno com mais de ${LIMITES_ARQUIVO.maxVerticesPorArea} vértices.` };
  }
  // Mesma ordem do servidor: cruzamento antes da área (uma "gravata" tem área
  // líquida zero e seria descrita como degenerada, escondendo a causa real).
  if (vertices.length >= 4 && anelSeAutoIntersecta(vertices)) {
    return { ok: false, motivo: "O contorno cruza a si mesmo." };
  }
  const check = validatePolygonForSave(vertices);
  if (!check.ok) return { ok: false, motivo: check.reason || "Contorno inválido." };
  return { ok: true, vertices, hectares: areaHectares(vertices), avisos };
}

/** Área informada no arquivo (se houver) vs. calculada: aviso, nunca substituição. */
const avisoDeDivergencia = (informadaHa, calculadaHa) => {
  if (typeof informadaHa !== "number" || !Number.isFinite(informadaHa) || informadaHa <= 0) return null;
  const diff = Math.abs(informadaHa - calculadaHa);
  if (diff <= TOLERANCIA_DIVERGENCIA.absolutaHa || diff / calculadaHa <= TOLERANCIA_DIVERGENCIA.relativa) return null;
  const fmt = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `O arquivo informa ${fmt(informadaHa)} ha; o cálculo geodésico do contorno dá ${fmt(calculadaHa)} ha (vale o cálculo).`;
};

const primeiroTexto = (props, chaves, max) => {
  for (const k of chaves) {
    const t = textoDoArquivo(props?.[k], max);
    if (t) return t;
  }
  return "";
};

const primeiroNumero = (props, chaves) => {
  for (const k of chaves) {
    const v = props?.[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
};

/**
 * Monta o item a partir do anel lido.
 * @returns {object}
 */
const itemDeArea = (base, brutos, extras = {}) => {
  const anel = normalizarAnel(brutos);
  if ("motivo" in anel) return { ...base, situacao: "invalido", motivo: anel.motivo };
  const avisos = [...anel.avisos, ...(extras.avisos ?? [])];
  const divergencia = avisoDeDivergencia(extras.areaInformadaHa, anel.hectares);
  if (divergencia) avisos.push(divergencia);
  return {
    ...base,
    situacao: "area",
    vertices: anel.vertices,
    hectares: anel.hectares,
    avisos,
  };
};

// ─── GeoJSON ────────────────────────────────────────────────────────────────

const posicaoGeoJson = (pos) => {
  if (!Array.isArray(pos) || pos.length < 2) return { lat: NaN, lng: NaN };
  const [lng, lat] = pos;
  return { lat: typeof lat === "number" ? lat : NaN, lng: typeof lng === "number" ? lng : NaN };
};

const GEOMETRIAS_GEOJSON = new Set([
  "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection",
]);

/** @param {unknown} json */
function itensDoGeoJson(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { erro: "O JSON não é GeoJSON: esperado um objeto com \"type\"." };
  }
  const obj = /** @type {Record<string, any>} */ (json);
  const crsNome = obj.crs?.properties?.name;
  if (obj.crs && (typeof crsNome !== "string" || !CRS_WGS84.has(crsNome))) {
    return { erro: "Sistema de coordenadas (CRS) não suportado. Exporte o arquivo em WGS84 (EPSG:4326)." };
  }
  /** @type {any[]} */
  let features;
  if (obj.type === "FeatureCollection") {
    if (!Array.isArray(obj.features)) return { erro: "FeatureCollection sem lista \"features\"." };
    features = obj.features;
  } else if (obj.type === "Feature") {
    features = [obj];
  } else if (GEOMETRIAS_GEOJSON.has(obj.type)) {
    features = [{ type: "Feature", geometry: obj, properties: {} }];
  } else {
    return { erro: "O JSON não é GeoJSON válido (\"type\" ausente ou desconhecido)." };
  }
  if (features.length > LIMITES_ARQUIVO.maxElementos) {
    return { erro: `O arquivo tem ${features.length} elementos; o máximo é ${LIMITES_ARQUIVO.maxElementos}. Divida o arquivo.` };
  }

  const itens = features.map((feature, i) => {
    const props = feature && typeof feature === "object" && feature.properties && typeof feature.properties === "object"
      ? feature.properties
      : {};
    const base = {
      ref: `f${i + 1}`,
      origem: `Elemento ${i + 1}`,
      nomeNoArquivo: primeiroTexto(props, CHAVES_NOME, 255),
      siglaNoArquivo: primeiroTexto(props, CHAVES_SIGLA, 10),
      tipoGeometria: "",
    };
    if (!feature || feature.type !== "Feature") return { ...base, situacao: "invalido", motivo: "Elemento não é um Feature GeoJSON." };
    const g = feature.geometry;
    if (!g || typeof g !== "object") return { ...base, situacao: "invalido", motivo: "Elemento sem geometria." };
    base.tipoGeometria = String(g.type ?? "");
    const areaInformadaHa = primeiroNumero(props, CHAVES_AREA_HA);

    switch (g.type) {
      case "Point":
      case "MultiPoint":
      case "LineString":
      case "MultiLineString":
        return { ...base, situacao: "ignorado", motivo: "Ignorado: não é área (ponto ou linha)." };
      case "Polygon": {
        if (!Array.isArray(g.coordinates) || !Array.isArray(g.coordinates[0])) {
          return { ...base, situacao: "invalido", motivo: "Polygon sem coordenadas." };
        }
        if (g.coordinates.length > 1) {
          return { ...base, situacao: "invalido", motivo: "Polígono com buraco interno: o cadastro não representa buracos." };
        }
        return itemDeArea(base, g.coordinates[0].map(posicaoGeoJson), { areaInformadaHa });
      }
      case "MultiPolygon": {
        const partes = Array.isArray(g.coordinates) ? g.coordinates : [];
        if (partes.length !== 1) {
          return {
            ...base,
            situacao: "invalido",
            motivo: `MultiPolygon com ${partes.length} partes: o cadastro grava uma parte por área. Separe as partes no arquivo.`,
          };
        }
        const aneis = Array.isArray(partes[0]) ? partes[0] : [];
        if (aneis.length !== 1) {
          return { ...base, situacao: "invalido", motivo: "Polígono com buraco interno: o cadastro não representa buracos." };
        }
        return itemDeArea(base, aneis[0].map(posicaoGeoJson), {
          areaInformadaHa,
          avisos: ["MultiPolygon de uma única parte, lido como polígono simples (sem perda)."],
        });
      }
      case "GeometryCollection":
        return { ...base, situacao: "invalido", motivo: "GeometryCollection não é suportado: separe os elementos." };
      default:
        return { ...base, situacao: "invalido", motivo: "Tipo de geometria desconhecido." };
    }
  });
  return { itens };
}

// ─── KML ────────────────────────────────────────────────────────────────────

/** Descendentes por nome local, ignorando namespace (kml:, gx:, sem prefixo). */
const descendentes = (raiz, nomeLocal) =>
  Array.from(raiz.getElementsByTagName("*")).filter((el) => el.localName === nomeLocal);

const filhoDireto = (raiz, nomeLocal) =>
  Array.from(raiz.children ?? []).find((el) => el.localName === nomeLocal) ?? null;

/** "lng,lat[,alt] lng,lat[,alt] …" → vértices. Token malformado → null. */
const coordenadasKml = (texto) => {
  const tokens = String(texto ?? "").replace(/\s*,\s*/g, ",").trim().split(/\s+/).filter(Boolean);
  /** @type {{lat: number, lng: number}[]} */
  const out = [];
  for (const tok of tokens) {
    const partes = tok.split(",");
    if (partes.length < 2 || partes.length > 3) return null;
    const lng = Number(partes[0]);
    const lat = Number(partes[1]);
    if (partes[0] === "" || partes[1] === "" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (partes.length === 3 && partes[2] !== "" && !Number.isFinite(Number(partes[2]))) return null;
    out.push({ lat, lng });
  }
  return out;
};

/** @param {string} texto */
function itensDoKml(texto) {
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) {
    return { erro: "KML recusado: declarações DOCTYPE/ENTITY não são aceitas por segurança." };
  }
  if (typeof DOMParser === "undefined") return { erro: "Leitura de KML indisponível neste navegador." };
  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { erro: "KML malformado: o XML não pôde ser lido." };
  }
  const raiz = doc.documentElement;
  if (!raiz || raiz.localName !== "kml") return { erro: "O XML não é um KML (elemento raiz <kml> ausente)." };

  const placemarks = descendentes(raiz, "Placemark");
  if (placemarks.length > LIMITES_ARQUIVO.maxElementos) {
    return { erro: `O arquivo tem ${placemarks.length} elementos; o máximo é ${LIMITES_ARQUIVO.maxElementos}. Divida o arquivo.` };
  }
  /** @type {string[]} */
  const avisosDoArquivo = [];
  if (descendentes(raiz, "NetworkLink").length > 0) {
    avisosDoArquivo.push("O arquivo cita conteúdo remoto (NetworkLink); ele não foi baixado nem importado.");
  }

  const itens = placemarks.map((pm, i) => {
    const nomeEl = filhoDireto(pm, "name");
    const base = {
      ref: `f${i + 1}`,
      origem: `Placemark ${i + 1}`,
      nomeNoArquivo: textoDoArquivo(nomeEl?.textContent ?? "", 255),
      siglaNoArquivo: "",
      tipoGeometria: "",
    };
    const poligonos = descendentes(pm, "Polygon");
    const naoAreas = ["Point", "LineString", "LinearRing", "Track", "MultiTrack", "Model"]
      .flatMap((nome) => descendentes(pm, nome))
      // LinearRing dentro de Polygon é o próprio contorno, não um elemento à parte.
      .filter((el) => !poligonos.some((p) => p.contains(el)));

    if (poligonos.length === 0) {
      if (naoAreas.length > 0) {
        base.tipoGeometria = naoAreas[0].localName;
        return { ...base, situacao: "ignorado", motivo: "Ignorado: não é área (ponto ou linha)." };
      }
      return { ...base, situacao: "invalido", motivo: "Placemark sem geometria." };
    }
    base.tipoGeometria = poligonos.length > 1 ? "MultiGeometry" : "Polygon";
    if (poligonos.length > 1) {
      return {
        ...base,
        situacao: "invalido",
        motivo: `MultiGeometry com ${poligonos.length} polígonos: o cadastro grava um polígono por área. Separe em Placemarks.`,
      };
    }
    const poligono = poligonos[0];
    if (descendentes(poligono, "innerBoundaryIs").length > 0) {
      return { ...base, situacao: "invalido", motivo: "Polígono com buraco interno: o cadastro não representa buracos." };
    }
    const externo = descendentes(poligono, "outerBoundaryIs")[0];
    const coordEl = externo ? descendentes(externo, "coordinates")[0] : null;
    const vertices = coordEl ? coordenadasKml(coordEl.textContent) : null;
    if (!vertices) return { ...base, situacao: "invalido", motivo: "Coordenadas do polígono ausentes ou malformadas." };
    /** @type {string[]} */
    const avisos = [];
    if (naoAreas.length > 0) avisos.push("Elementos que não são área no mesmo Placemark foram ignorados.");
    return itemDeArea(base, vertices, { avisos });
  });
  return { itens, avisosDoArquivo };
}

// ─── Entrada pública ────────────────────────────────────────────────────────

/**
 * @param {{ nomeArquivo: string | null, texto: string, tamanhoBytes?: number }} entrada
 * @returns {{ ok: false, erro: string } | {
 *   ok: true, formato: 'kml' | 'geojson', itens: any[], avisosDoArquivo: string[],
 *   contagem: { elementos: number, areas: number, ignorados: number, invalidos: number }
 * }}
 */
export function lerArquivoDeAreas({ nomeArquivo, texto, tamanhoBytes }) {
  if ((tamanhoBytes ?? texto.length) > LIMITES_ARQUIVO.maxBytes) {
    return { ok: false, erro: `Arquivo maior que ${LIMITES_ARQUIVO.maxBytes / 1024 / 1024} MB. Divida o arquivo.` };
  }
  const limpo = String(texto ?? "").replace(/^\uFEFF/, "").split("\u0000").join("").trim();
  if (!limpo) return { ok: false, erro: "Arquivo vazio." };
  const deteccao = detectarFormato(nomeArquivo, limpo);
  if ("erro" in deteccao) return { ok: false, erro: deteccao.erro };

  /** @type {any} */
  let lido;
  if (deteccao.formato === "kml") {
    lido = itensDoKml(limpo);
  } else {
    let json;
    try {
      json = JSON.parse(limpo);
    } catch {
      return { ok: false, erro: "JSON inválido: o arquivo não pôde ser lido." };
    }
    lido = itensDoGeoJson(json);
  }
  if (lido.erro) return { ok: false, erro: lido.erro };

  const itens = lido.itens;
  const contagem = {
    elementos: itens.length,
    areas: itens.filter((i) => i.situacao === "area").length,
    ignorados: itens.filter((i) => i.situacao === "ignorado").length,
    invalidos: itens.filter((i) => i.situacao === "invalido").length,
  };
  if (contagem.elementos === 0) return { ok: false, erro: "O arquivo não tem nenhum elemento (Placemark/Feature)." };
  return { ok: true, formato: deteccao.formato, itens, avisosDoArquivo: lido.avisosDoArquivo ?? [], contagem };
}
