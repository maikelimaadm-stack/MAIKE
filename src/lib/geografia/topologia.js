/**
 * Topologia do contorno: o anel se cruza?
 *
 * Mesmo algoritmo do servidor (`backend/src/modules/areas/areaImportacaoGeometria.js`):
 * compara cada par de arestas não adjacentes no plano lng/lat, com recorte por
 * caixa. Contorno que passa duas vezes pelo mesmo vértice também conta.
 */

/** @typedef {{ lat: number, lng: number }} LatLng */

const orientacao = (a, b, c) => (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);

const noSegmento = (a, b, p) =>
  Math.min(a.lng, b.lng) <= p.lng &&
  p.lng <= Math.max(a.lng, b.lng) &&
  Math.min(a.lat, b.lat) <= p.lat &&
  p.lat <= Math.max(a.lat, b.lat);

const segmentosSeTocam = (p1, p2, p3, p4) => {
  const d1 = orientacao(p3, p4, p1);
  const d2 = orientacao(p3, p4, p2);
  const d3 = orientacao(p1, p2, p3);
  const d4 = orientacao(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && noSegmento(p3, p4, p1)) return true;
  if (d2 === 0 && noSegmento(p3, p4, p2)) return true;
  if (d3 === 0 && noSegmento(p1, p2, p3)) return true;
  if (d4 === 0 && noSegmento(p1, p2, p4)) return true;
  return false;
};

/**
 * @param {LatLng[]} anel anel ABERTO (sem repetir o primeiro vértice no fim)
 * @returns {boolean}
 */
export function anelSeAutoIntersecta(anel) {
  const n = anel.length;
  if (n < 3) return false;
  if (new Set(anel.map((v) => `${v.lat},${v.lng}`)).size !== n) return true;
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
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const e2 = arestas[j];
      if (e1.maxLng < e2.minLng || e2.maxLng < e1.minLng || e1.maxLat < e2.minLat || e2.maxLat < e1.minLat) continue;
      if (segmentosSeTocam(e1.a, e1.b, e2.a, e2.b)) return true;
    }
  }
  return false;
}
