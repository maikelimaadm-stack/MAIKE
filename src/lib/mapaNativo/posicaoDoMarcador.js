/**
 * Onde e de que tamanho vai a imagem de um marcador do mapa do Google (D-PROD-374), a mesma conta no site
 * (`mapaGoogleWeb.js`) e no app (`camadaDeImagens.js`).
 *
 * - `escala(zoom)`: o tamanho segue o zoom (os nomes dos pastos, como o `icon-size` do MapLibre); sem ela, fixo.
 * - `ancora`: "centro" (o centro da imagem no ponto + deslocamento) ou "topo" (o topo da imagem no ponto +
 *   deslocamento: o nome embaixo do ícone do lote, que cresce para baixo, como o `icon-anchor: top`).
 * - Sem arredondar: com o mapa se mexendo, arredondar para o px inteiro faz o ícone tremer.
 */

/**
 * @typedef {import('./mapaGoogleWeb.js').MarcadorWeb} Marcador
 * @typedef {{ x: number, y: number, w: number, h: number }} Caixa
 */

/**
 * Caixa da imagem na tela.
 * @param {Marcador} m @param {{ x: number, y: number }} p o ponto na tela @param {number} zoom zoom do MapLibre
 * @returns {Caixa}
 */
export function caixaDoMarcador(m, p, zoom) {
  const f = m.escala ? m.escala(zoom) : 1;
  const w = m.w * (Number.isFinite(f) && f > 0 ? f : 1);
  const h = m.h * (Number.isFinite(f) && f > 0 ? f : 1);
  const x = p.x + (m.dx || 0) - w / 2;
  const y = m.ancora === "topo" ? p.y + (m.dy || 0) : p.y + (m.dy || 0) - h / 2;
  return { x, y, w, h };
}

/**
 * Põe a imagem na caixa (só mexe no tamanho quando ele muda).
 * @param {HTMLElement} el @param {Caixa} c
 */
export function porNaCaixa(el, c) {
  el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0)`;
  // o navegador guarda "40px" para "40.00px": compara o número
  const w = Number(c.w.toFixed(2));
  const h = Number(c.h.toFixed(2));
  if (parseFloat(el.style.width) !== w) el.style.width = `${w}px`;
  if (parseFloat(el.style.height) !== h) el.style.height = `${h}px`;
}
