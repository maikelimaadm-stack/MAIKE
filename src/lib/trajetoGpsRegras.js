/**
 * Regras do rastreio do trajeto (Diário da máquina, GPS fase 1). Puro: sem React, sem navegador, sem rede.
 *
 * Um ponto aqui é `{ lat, lng, precisao_m, velocidade_ms, em }` (`em` = instante em ms do relógio do aparelho). O servidor
 * recebe o formato do contrato (`capturado_em` em ISO); a conversão é `paraPontoDoServidor`.
 */

/** Leitura com precisão pior que isto (m) é descartada. */
export const PRECISAO_MAX_M = 50;
/** Salto acima disto (km/h) entre o último ponto gravado e o novo é descartado (erro de GPS, não deslocamento). */
export const VELOCIDADE_MAX_KMH = 60;
/** Grava um ponto quando passou este tempo (ms) desde o último gravado... */
export const INTERVALO_MIN_MS = 10_000;
/** ...OU esta distância (m). O que vier primeiro. */
export const DISTANCIA_MIN_M = 10;
/** Parado (abaixo de 1 km/h): grava só a cada este tempo (ms), para não encher o buffer no pátio. */
export const INTERVALO_PARADO_MS = 60_000;
/** 1 km/h em m/s. */
export const VELOCIDADE_PARADO_MS = 1 / 3.6;
/** Tamanho máximo de um lote enviado ao servidor (contrato: 1 a 200). */
export const LOTE_MAX_PONTOS = 200;
/** Teto do buffer no aparelho: passou disto, o rastreio para de gravar e pede para sincronizar. */
export const TETO_PONTOS_BUFFER = 20_000;
/** Envio do buffer a cada este tempo (ms), com internet. */
export const ENVIO_A_CADA_MS = 30_000;

const RAIO_TERRA_M = 6_371_000;
const rad = (graus) => (graus * Math.PI) / 180;

/**
 * Distância em linha reta entre dois pontos (fórmula de haversine), em metros.
 * @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b
 */
export function haversineM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Velocidade média (m/s) entre o último ponto gravado e o novo. Sem intervalo positivo, não há velocidade (null).
 * @param {{ lat: number, lng: number, em: number }} ultimo @param {{ lat: number, lng: number, em: number }} novo
 */
export function velocidadeEntre(ultimo, novo) {
  const dt = (novo.em - ultimo.em) / 1000;
  if (!(dt > 0)) return null;
  return haversineM(ultimo, novo) / dt;
}

/**
 * O filtro do aparelho: descarta leitura sem precisão ou com precisão pior que `PRECISAO_MAX_M`, e salto impossível
 * (mais que `VELOCIDADE_MAX_KMH`) em relação ao último ponto gravado.
 * @param {{ lat: number, lng: number, em: number } | null} ultimo
 * @param {{ lat: number, lng: number, precisao_m: number | null, em: number }} novo
 * @returns {{ aceito: boolean, motivo?: 'precisao' | 'salto' }}
 */
export function filtroDePonto(ultimo, novo) {
  if (!Number.isFinite(novo.precisao_m) || novo.precisao_m > PRECISAO_MAX_M) return { aceito: false, motivo: 'precisao' };
  if (ultimo) {
    const v = velocidadeEntre(ultimo, novo);
    if (v !== null && v * 3.6 > VELOCIDADE_MAX_KMH) return { aceito: false, motivo: 'salto' };
  }
  return { aceito: true };
}

/**
 * A regra de amostragem: o primeiro ponto grava. Depois, grava quando passou `INTERVALO_MIN_MS` OU `DISTANCIA_MIN_M`
 * desde o último gravado; parado (velocidade abaixo de 1 km/h) grava só a cada `INTERVALO_PARADO_MS`.
 * A velocidade é a do aparelho quando ele informa; senão, a média entre os dois pontos.
 * @param {{ lat: number, lng: number, em: number } | null} ultimo
 * @param {{ lat: number, lng: number, em: number, velocidade_ms?: number | null }} novo
 */
export function deveGravar(ultimo, novo) {
  if (!ultimo) return true;
  const dt = novo.em - ultimo.em;
  const velocidadeAparelho = Number.isFinite(novo.velocidade_ms) ? novo.velocidade_ms : null;
  const velocidade = velocidadeAparelho ?? velocidadeEntre(ultimo, novo);
  const parado = velocidade !== null && velocidade < VELOCIDADE_PARADO_MS;
  if (parado) return dt >= INTERVALO_PARADO_MS;
  return dt >= INTERVALO_MIN_MS || haversineM(ultimo, novo) >= DISTANCIA_MIN_M;
}

/**
 * Divide em lotes de até `tamanho` pontos (o servidor aceita 1 a 200 por envio).
 * @template T @param {T[]} lista @param {number} [tamanho]
 * @returns {T[][]}
 */
export function dividirEmLotes(lista, tamanho = LOTE_MAX_PONTOS) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/**
 * Distância acumulada (m) ao longo da sequência de pontos.
 * @param {Array<{ lat: number, lng: number }>} pontos
 */
export function distanciaAcumulada(pontos) {
  let total = 0;
  for (let i = 1; i < pontos.length; i += 1) total += haversineM(pontos[i - 1], pontos[i]);
  return total;
}

/**
 * Formato para a faixa do Diário: "850 m" abaixo de 1 km; "1,2 km" a partir de 1 km (vírgula, 1 casa).
 * @param {number} metros
 */
export function formatarDistancia(metros) {
  const m = Number.isFinite(metros) && metros > 0 ? metros : 0;
  if (Math.round(m) < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/**
 * O ponto como o servidor espera (contrato de POST …/pontos).
 * @param {{ lat: number, lng: number, precisao_m: number | null, velocidade_ms: number | null, em: number }} p
 * @param {number} seq
 */
export function paraPontoDoServidor(p, seq) {
  return {
    seq,
    lat: p.lat,
    lng: p.lng,
    precisao_m: Number.isFinite(p.precisao_m) ? p.precisao_m : null,
    velocidade_ms: Number.isFinite(p.velocidade_ms) ? p.velocidade_ms : null,
    capturado_em: new Date(p.em).toISOString(),
  };
}
