/**
 * D-PROD-363 — caminhar com o GPS gravando o contorno sozinho, como no AgriWebb ("walk the boundary").
 *
 * Antes, a captura por GPS só marcava um ponto quando a pessoa tocava "Marcar ponto N" em cada canto. Agora,
 * gravando, cada leitura boa do GPS a pelo menos `passoM` metros da última vira um ponto. No fim, a trilha é
 * enxugada (Douglas-Peucker em metros), sem perder os cantos marcados à mão.
 */

/** Distância mínima entre dois pontos gravados (m). */
export const PASSO_PADRAO_M = 5;
/** Leitura com precisão pior que isto não grava (m). */
export const PRECISAO_MAXIMA_M = 25;
/** Tolerância para enxugar a trilha no fim (m): pontos que se afastam menos que isto da reta saem. */
export const TOLERANCIA_PADRAO_M = 1.5;

const RAIO_TERRA_M = 6_371_008.8;
const rad = (g) => (g * Math.PI) / 180;

/**
 * Distância entre dois pontos (m), haversine.
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 */
export function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A leitura nova vira ponto da trilha?
 * @param {{ lat: number, lng: number } | null | undefined} ultimo o último ponto gravado
 * @param {{ lat: number, lng: number, accuracy?: number|null, stale?: boolean } | null | undefined} leitura
 * @param {{ passoM?: number, precisaoMaxM?: number }} [opts]
 */
export function deveGravar(ultimo, leitura, opts = {}) {
  if (!leitura || !Number.isFinite(leitura.lat) || !Number.isFinite(leitura.lng)) return false;
  if (leitura.stale) return false;
  const precisaoMax = opts.precisaoMaxM ?? PRECISAO_MAXIMA_M;
  if (leitura.accuracy != null && Number.isFinite(leitura.accuracy) && leitura.accuracy > precisaoMax) return false;
  if (!ultimo) return true;
  return distanciaM(ultimo, leitura) >= (opts.passoM ?? PASSO_PADRAO_M);
}

/**
 * Distância (m) de `p` ao segmento a–b, numa projeção plana local (boa para trechos de centenas de metros).
 * @param {{ lat: number, lng: number }} p
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 */
function distanciaAoSegmentoM(p, a, b) {
  const kx = Math.cos(rad(a.lat)) * (Math.PI / 180) * RAIO_TERRA_M;
  const ky = (Math.PI / 180) * RAIO_TERRA_M;
  const ax = 0, ay = 0;
  const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Enxuga a trilha (Douglas-Peucker em metros). Mantém a primeira, a última e os pontos `fixo` (cantos marcados
 * à mão). Devolve os mesmos objetos (com precisão e hora), na mesma ordem.
 * @template {{ lat: number, lng: number, fixo?: boolean }} T
 * @param {T[]} pontos
 * @param {number} [toleranciaM]
 * @returns {T[]}
 */
export function simplificarTrilha(pontos, toleranciaM = TOLERANCIA_PADRAO_M) {
  if (!Array.isArray(pontos) || pontos.length <= 2) return Array.isArray(pontos) ? [...pontos] : [];
  const manter = new Array(pontos.length).fill(false);
  manter[0] = true;
  manter[pontos.length - 1] = true;
  pontos.forEach((p, i) => { if (p.fixo) manter[i] = true; });

  // Divide nos pontos fixos e enxuga cada trecho entre eles.
  const ancoras = manter.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  const pilha = [];
  for (let k = 0; k < ancoras.length - 1; k += 1) pilha.push([ancoras[k], ancoras[k + 1]]);
  while (pilha.length) {
    const [ini, fim] = /** @type {[number, number]} */ (pilha.pop());
    if (fim - ini < 2) continue;
    let maior = -1;
    let onde = -1;
    for (let i = ini + 1; i < fim; i += 1) {
      const d = distanciaAoSegmentoM(pontos[i], pontos[ini], pontos[fim]);
      if (d > maior) { maior = d; onde = i; }
    }
    if (maior > toleranciaM) {
      manter[onde] = true;
      pilha.push([ini, onde], [onde, fim]);
    }
  }
  return pontos.filter((_, i) => manter[i]);
}
