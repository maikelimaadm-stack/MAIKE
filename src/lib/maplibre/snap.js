/**
 * Snap (ímã) em pixels de tela — vértices e arestas de áreas/linhas existentes.
 */
import { parseVertices } from "@/lib/geografia/coords.js";

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function distPx(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {{ x: number, y: number }}
 */
export function projectOnSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  if (l2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return { x: a.x + t * vx, y: a.y + t * vy };
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ lat: number, lng: number }} ll
 * @returns {{ x: number, y: number } | null}
 */
export function projectLatLng(map, ll) {
  try {
    const p = map.project([ll.lng, ll.lat]);
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ x: number, y: number }} px
 * @returns {{ lat: number, lng: number } | null}
 */
export function unprojectPx(map, px) {
  try {
    const ll = map.unproject([px.x, px.y]);
    return { lat: ll.lat, lng: ll.lng };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ coordenadas?: { coords?: unknown } }} SnapEntidade
 */

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ lat: number, lng: number }} mouse
 * @param {{ areas?: SnapEntidade[], linhas?: SnapEntidade[], toleranciaPx?: number, enabled?: boolean }} opts
 * @returns {{ lat: number, lng: number } | null}
 */
export function findNearestSnap(map, mouse, opts = {}) {
  if (opts.enabled === false) return null;
  const tol = opts.toleranciaPx ?? 16;
  const mousePx = projectLatLng(map, mouse);
  if (!mousePx) return null;

  let best = null;
  let bestDist = Infinity;

  const evaluateVertex = (lat, lng) => {
    const px = projectLatLng(map, { lat, lng });
    if (!px) return;
    const d = distPx(mousePx, px);
    if (d < tol && d < bestDist) {
      bestDist = d;
      best = { lat, lng };
    }
  };

  const evaluateSegment = (a, b) => {
    const pa = projectLatLng(map, a);
    const pb = projectLatLng(map, b);
    if (!pa || !pb) return;
    const q = projectOnSegment(mousePx, pa, pb);
    const d = distPx(mousePx, q);
    if (d < tol && d < bestDist) {
      const ll = unprojectPx(map, q);
      if (ll) {
        bestDist = d;
        best = ll;
      }
    }
  };

  const processRing = (coords, isPolygon) => {
    const parsed = parseVertices(coords);
    parsed.forEach((p) => evaluateVertex(p.lat, p.lng));
    for (let i = 0; i < parsed.length - 1; i += 1) {
      evaluateSegment(parsed[i], parsed[i + 1]);
    }
    if (isPolygon && parsed.length >= 3) {
      evaluateSegment(parsed[parsed.length - 1], parsed[0]);
    }
  };

  for (const area of opts.areas || []) {
    const coords = area?.coordenadas?.coords || [];
    if (Array.isArray(coords) && coords.length >= 2) processRing(coords, true);
  }
  for (const linha of opts.linhas || []) {
    const coords = linha?.coordenadas?.coords || [];
    if (Array.isArray(coords) && coords.length >= 2) processRing(coords, false);
  }

  return best;
}

/**
 * Fecha polígono se o clique está perto de algum vértice existente.
 * @param {import('maplibre-gl').Map} map
 * @param {{ lat: number, lng: number }} click
 * @param {{ lat: number, lng: number }[]} points
 * @param {number} [tolPx]
 * @returns {boolean}
 */
export function isNearAnyVertex(map, click, points, tolPx = 20) {
  if (!points || points.length < 3) return false;
  const clickPx = projectLatLng(map, click);
  if (!clickPx) return false;
  for (const p of points) {
    const px = projectLatLng(map, p);
    if (px && distPx(clickPx, px) < tolPx) return true;
  }
  return false;
}
