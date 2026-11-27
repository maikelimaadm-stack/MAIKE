import { useEffect, useState } from "react";

/**
 * D-PROD-362 — para onde o celular aponta (graus a partir do norte, sentido horário), para a seta do ponto azul do
 * editor do mapa, como no AgriWebb. Vem da bússola do aparelho (`deviceorientationabsolute` no Android;
 * `webkitCompassHeading` no iPhone). Andando, o rumo do GPS vale mais que a bússola (`rumoDoGps`).
 * Sem bússola nem rumo, devolve null e a seta não aparece.
 */

/** Rumo da bússola a partir do evento de orientação, ou null. */
export function rumoDaOrientacao(ev) {
  if (!ev) return null;
  if (Number.isFinite(ev.webkitCompassHeading)) return normalizarGraus(ev.webkitCompassHeading);
  // `alpha` é anti-horário a partir do norte só quando a leitura é absoluta (presa ao norte magnético).
  if (ev.absolute === true && Number.isFinite(ev.alpha)) return normalizarGraus(360 - ev.alpha);
  return null;
}

/** @param {number} g */
export function normalizarGraus(g) {
  const r = g % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * O rumo do GPS só vale andando (parado, o `heading` do GPS é ruído ou vem vazio).
 * @param {{ rumo?: number|null, velocidade?: number|null } | null | undefined} posicao
 */
export function rumoDoGps(posicao) {
  if (!posicao || !Number.isFinite(posicao.rumo) || !Number.isFinite(posicao.velocidade)) return null;
  return posicao.velocidade >= 0.7 ? normalizarGraus(/** @type {number} */ (posicao.rumo)) : null;
}

/**
 * @param {{ ativo: boolean, posicao?: { rumo?: number|null, velocidade?: number|null } | null }} p
 * @returns {number|null}
 */
export function useRumoDoAparelho({ ativo, posicao }) {
  const [bussola, setBussola] = useState(/** @type {number|null} */ (null));

  useEffect(() => {
    if (!ativo || typeof window === "undefined") return undefined;
    let ultimo = -1;
    const receber = (ev) => {
      const r = rumoDaOrientacao(ev);
      if (r == null) return;
      // Só re-desenha quando muda pelo menos 3° (a bússola manda dezenas de leituras por segundo).
      if (ultimo >= 0 && Math.abs(((r - ultimo + 540) % 360) - 180) < 3) return;
      ultimo = r;
      setBussola(Math.round(r));
    };
    const temAbsoluta = "ondeviceorientationabsolute" in window;
    const evento = temAbsoluta ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(evento, receber, true);
    return () => window.removeEventListener(evento, receber, true);
  }, [ativo]);

  const doGps = rumoDoGps(posicao);
  return doGps != null ? Math.round(doGps) : bussola;
}
