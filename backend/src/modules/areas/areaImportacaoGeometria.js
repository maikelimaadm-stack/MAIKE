/**
 * Geometria da importação de áreas (D-PROD-90) — regra pura, sem banco.
 *
 * O servidor não confia na geometria nem na área calculadas pelo navegador:
 * revalida o anel e recalcula os hectares aqui, com a mesma fórmula geodésica
 * do editor (`@turf/area`, WGS84). O contrato persistido continua o do editor:
 * `coordenadas: { coords: [[lat, lng], ...], cor }`, anel aberto (sem repetir
 * o primeiro vértice no fim).
 *
 * Nada aqui usa `x || y` para ler coordenada: 0 é latitude/longitude válida.
 */

import { createHash } from 'node:crypto';

import area from '@turf/area';

/** Área mínima de um polígono gravável, em m² (mesma tolerância do editor). */
export const AREA_MINIMA_M2 = 1e-2;

/** Casas decimais da chave canônica: 1e-7 grau ≈ 1 cm. */
const PRECISAO_CHAVE = 7;

const ehNumeroFinito = (valor) => typeof valor === 'number' && Number.isFinite(valor);

/**
 * Lê o vértice persistido: `[lat, lng]` ou, em registros antigos, `{lat, lng}`.
 * @param {unknown} bruto
 * @returns {{lat: number, lng: number} | null}
 */
export const lerVertice = (bruto) => {
  if (Array.isArray(bruto)) {
    if (bruto.length < 2) return null;
    const [lat, lng] = bruto;
    return ehNumeroFinito(lat) && ehNumeroFinito(lng) ? { lat, lng } : null;
  }
  if (bruto && typeof bruto === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (bruto);
    const lat = obj.lat ?? obj.latitude;
    const lng = obj.lng ?? obj.longitude;
    return ehNumeroFinito(lat) && ehNumeroFinito(lng)
      ? { lat: /** @type {number} */ (lat), lng: /** @type {number} */ (lng) }
      : null;
  }
  return null;
};

const mesmoVertice = (a, b) => a.lat === b.lat && a.lng === b.lng;

/** Produto vetorial (b - a) × (c - a) no plano lng/lat. */
const orientacao = (a, b, c) => (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);

const noSegmento = (a, b, p) =>
  Math.min(a.lng, b.lng) <= p.lng &&
  p.lng <= Math.max(a.lng, b.lng) &&
  Math.min(a.lat, b.lat) <= p.lat &&
  p.lat <= Math.max(a.lat, b.lat);

/** Os segmentos [p1,p2] e [p3,p4] se tocam (inclusive colineares sobrepostos)? */
const segmentosSeTocam = (p1, p2, p3, p4) => {
  const d1 = orientacao(p3, p4, p1);
  const d2 = orientacao(p3, p4, p2);
  const d3 = orientacao(p1, p2, p3);
  const d4 = orientacao(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && noSegmento(p3, p4, p1)) return true;
  if (d2 === 0 && noSegmento(p3, p4, p2)) return true;
  if (d3 === 0 && noSegmento(p1, p2, p3)) return true;
  if (d4 === 0 && noSegmento(p1, p2, p4)) return true;
  return false;
};

/**
 * O anel aberto se cruza? Compara cada par de arestas não adjacentes. O(n²)
 * com recorte por caixa; o limite de vértices por polígono mantém o custo
 * previsível.
 * @param {{lat: number, lng: number}[]} anel aberto
 */
export const anelSeAutoIntersecta = (anel) => {
  const n = anel.length;
  if (n < 4) return false;
  const arestas = anel.map((a, i) => {
    const b = anel[(i + 1) % n];
    return {
      a,
      b,
      minLng: Math.min(a.lng, b.lng),
      maxLng: Math.max(a.lng, b.lng),
      minLat: Math.min(a.lat, b.lat),
      maxLat: Math.max(a.lat, b.lat),
    };
  });
  for (let i = 0; i < n; i += 1) {
    const e1 = arestas[i];
    for (let j = i + 1; j < n; j += 1) {
      // Arestas vizinhas compartilham um vértice por definição.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const e2 = arestas[j];
      if (e1.maxLng < e2.minLng || e2.maxLng < e1.minLng || e1.maxLat < e2.minLat || e2.maxLat < e1.minLat) {
        continue;
      }
      if (segmentosSeTocam(e1.a, e1.b, e2.a, e2.b)) return true;
    }
  }
  return false;
};

/**
 * Área geodésica do anel aberto, em m².
 * @param {{lat: number, lng: number}[]} anel
 */
export const areaM2DoAnel = (anel) => {
  const fechado = [...anel.map((v) => [v.lng, v.lat]), [anel[0].lng, anel[0].lat]];
  return area({ type: 'Polygon', coordinates: [fechado] });
};

/**
 * Valida o anel recebido no formato persistido `[[lat, lng], ...]`.
 *
 * Recusa em vez de "consertar": vértice fora de faixa, repetido em sequência,
 * menos de 3 vértices distintos e área degenerada. Cruzamento de arestas NÃO
 * recusa: volta `seCruza: true` para virar aviso (D-PROD-90 R2). O
 * único ajuste é tirar o vértice de fechamento quando ele repete o primeiro —
 * o mesmo que o adapter do editor faz, sem perder vértice real.
 *
 * @param {unknown} coords
 * @returns {{ ok: true, anel: {lat: number, lng: number}[], areaM2: number, hectares: number, seCruza: boolean }
 *   | { ok: false, codigo: string, mensagem: string }}
 */
export const validarAnel = (coords) => {
  if (!Array.isArray(coords) || coords.length === 0) {
    return { ok: false, codigo: 'GEOMETRIA_AUSENTE', mensagem: 'A área não tem contorno.' };
  }
  /** @type {{lat: number, lng: number}[]} */
  const anel = [];
  for (const bruto of coords) {
    if (!Array.isArray(bruto) || bruto.length !== 2) {
      return { ok: false, codigo: 'VERTICE_INVALIDO', mensagem: 'Vértice fora do formato [lat, lng].' };
    }
    const [lat, lng] = bruto;
    if (!ehNumeroFinito(lat) || !ehNumeroFinito(lng)) {
      return { ok: false, codigo: 'VERTICE_INVALIDO', mensagem: 'Vértice com número inválido.' };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return {
        ok: false,
        codigo: 'VERTICE_FORA_DA_FAIXA',
        mensagem: 'Vértice fora da faixa WGS84 (latitude −90 a 90, longitude −180 a 180).',
      };
    }
    anel.push({ lat, lng });
  }
  if (anel.length >= 2 && mesmoVertice(anel[0], anel[anel.length - 1])) anel.pop();
  for (let i = 1; i < anel.length; i += 1) {
    if (mesmoVertice(anel[i - 1], anel[i])) {
      return { ok: false, codigo: 'VERTICE_REPETIDO', mensagem: 'O contorno repete o mesmo vértice em sequência.' };
    }
  }
  const distintos = new Set(anel.map((v) => `${v.lat},${v.lng}`));
  if (anel.length < 3 || distintos.size < 3) {
    return { ok: false, codigo: 'POLIGONO_DEGENERADO', mensagem: 'O contorno precisa de pelo menos 3 vértices distintos.' };
  }
  // Contorno que se cruza ou passa duas vezes pelo mesmo ponto é IMPORTADO como
  // está, com aviso (decisão do proprietário, D-PROD-90 R2): é o desenho do
  // arquivo, e recusar travava a importação. Nada é "consertado".
  const seCruza = distintos.size !== anel.length || anelSeAutoIntersecta(anel);
  const areaM2 = areaM2DoAnel(anel);
  if (!(areaM2 > AREA_MINIMA_M2)) {
    return { ok: false, codigo: 'POLIGONO_DEGENERADO', mensagem: 'Área nula: vértices colineares ou degenerados.' };
  }
  return { ok: true, anel, areaM2, hectares: areaM2 / 10000, seCruza };
};

/**
 * Chave canônica do contorno: mesma geometria → mesma chave, não importa o
 * vértice inicial nem o sentido (horário/anti-horário). Arredonda a 1e-7 grau.
 *
 * @param {unknown[]} coords vértices persistidos (`[lat,lng]` ou `{lat,lng}`)
 * @returns {string | null} null quando não há anel legível
 */
export const chaveCanonicaDoContorno = (coords) => {
  if (!Array.isArray(coords)) return null;
  const vertices = coords.map(lerVertice);
  if (vertices.some((v) => v === null)) return null;
  const anel = /** @type {{lat: number, lng: number}[]} */ (vertices);
  if (anel.length >= 2 && mesmoVertice(anel[0], anel[anel.length - 1])) anel.pop();
  if (anel.length < 3) return null;
  const tokens = anel.map((v) => `${v.lat.toFixed(PRECISAO_CHAVE)},${v.lng.toFixed(PRECISAO_CHAVE)}`);
  // Menor rotação lexicográfica. O menor vértice pode aparecer mais de uma vez
  // (contorno que passa duas vezes pelo mesmo ponto é aceito desde a R2), então
  // compara as rotações de TODAS as ocorrências — não só a primeira.
  const rotacionar = (lista) => {
    const minimo = lista.reduce((m, t) => (t < m ? t : m), lista[0]);
    let melhor = null;
    for (let i = 0; i < lista.length; i += 1) {
      if (lista[i] !== minimo) continue;
      const candidato = [...lista.slice(i), ...lista.slice(0, i)].join(';');
      if (melhor === null || candidato < melhor) melhor = candidato;
    }
    return /** @type {string} */ (melhor);
  };
  const direto = rotacionar(tokens);
  const inverso = rotacionar([...tokens].reverse());
  const canonico = direto < inverso ? direto : inverso;
  return createHash('sha256').update(canonico).digest('hex');
};

/** Nome comparável: sem acento, sem caixa, espaços colapsados. */
export const nomeComparavel = (nome) =>
  String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
