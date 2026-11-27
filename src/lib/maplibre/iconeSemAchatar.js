/**
 * Tamanho de um ícone na tela sem achatar: o lado maior fica com `base` px e o outro segue a proporção da figura
 * (sem piso no eixo menor). Usado pelos marcadores HTML e pelas imagens dos lotes desenhadas no canvas (D-PROD-349).
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} base
 * @returns {{ width: number, height: number }}
 */
export function iconeSemAchatar(naturalWidth, naturalHeight, base) {
  const w = naturalWidth > 0 ? naturalWidth : base;
  const h = naturalHeight > 0 ? naturalHeight : base;
  const r = w / h;
  return r >= 1 ? { width: base, height: Math.max(1, Math.round(base / r)) } : { width: Math.max(1, Math.round(base * r)), height: base };
}
