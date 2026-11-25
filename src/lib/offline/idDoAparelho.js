/**
 * D-PROD-308 — id gerado no aparelho para registro novo (UUID v4).
 *
 * O id é definitivo desde o aparelho: o servidor grava com ele, e repetir a mesma
 * criação devolve o registro já criado (não duplica). Assim nada precisa trocar de id
 * depois do envio, e o que foi lançado sem internet pode citar o registro novo
 * (ex.: a leitura de um cocho criado no campo).
 */

const PADRAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {unknown} valor */
export const eIdDoAparelho = (valor) => typeof valor === 'string' && PADRAO.test(valor);

/** @returns {string} */
export const novoIdDoAparelho = () => {
  const c = /** @type {any} */ (globalThis).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
