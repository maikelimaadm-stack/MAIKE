/**
 * Cursor keyset opaco (createdAt + id) para listagens estáveis em escala.
 *
 * Formato: base64url(JSON { t: ISO-8601, i: id }).
 * Ordem canônica das listas: createdAt DESC, id DESC.
 */

const TEXTO = 'utf8';

/**
 * @param {{ createdAt: Date|string, id: string }} registro
 * @returns {string}
 */
export const codificarCursor = (registro) => {
  const createdAt =
    registro.createdAt instanceof Date
      ? registro.createdAt.toISOString()
      : String(registro.createdAt);
  const payload = JSON.stringify({ t: createdAt, i: String(registro.id) });
  return Buffer.from(payload, TEXTO).toString('base64url');
};

/**
 * @param {unknown} bruto
 * @returns {{ createdAt: Date, id: string } | null}
 */
export const decodificarCursor = (bruto) => {
  if (typeof bruto !== 'string' || bruto.trim() === '') return null;
  try {
    const json = Buffer.from(bruto, 'base64url').toString(TEXTO);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    const t = /** @type {{ t?: unknown, i?: unknown }} */ (parsed).t;
    const i = /** @type {{ t?: unknown, i?: unknown }} */ (parsed).i;
    if (typeof t !== 'string' || typeof i !== 'string' || i.trim() === '') return null;
    const createdAt = new Date(t);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: i };
  } catch {
    return null;
  }
};

/** Limite padrão de página (listagens Base1). */
export const LIMITE_PADRAO = 100;

/** Teto absoluto por request — nunca serializar milhares à toa. */
export const LIMITE_MAXIMO = 500;

/**
 * @param {unknown} bruto
 * @param {{ padrao?: number, maximo?: number }} [opts]
 * @returns {number}
 */
export const normalizarLimite = (bruto, opts = {}) => {
  const padrao = opts.padrao ?? LIMITE_PADRAO;
  const maximo = opts.maximo ?? LIMITE_MAXIMO;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < 1) return padrao;
  return Math.min(Math.floor(n), maximo);
};

/**
 * Cláusula Prisma para keyset DESC em (createdAt, id).
 * @param {{ createdAt: Date, id: string }} cursor
 */
export const clausulaKeysetDesc = (cursor) => ({
  OR: [
    { createdAt: { lt: cursor.createdAt } },
    { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
  ],
});
