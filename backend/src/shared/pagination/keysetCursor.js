/**
 * Cursor keyset opaco (createdAt + id) para listagens estáveis em escala.
 *
 * Formato: base64url(JSON { t: ISO-8601, i: id }).
 * Ordem canônica das listas: createdAt DESC, id DESC.
 */

const TEXTO = 'utf8';

/**
 * Id que um cursor válido pode trazer: todo `@id` do schema é `cuid()` (e as
 * rotas aceitam `^[A-Za-z0-9_-]{1,64}$`). NUL (22021 no PostgreSQL), surrogate
 * isolado (o engine recusa o JSON) ou texto longo nunca vêm de um registro.
 */
export const ID_DE_CURSOR = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Instante que o Prisma serializa (`DateTime` do PostgreSQL com ano 0000–9999).
 * `new Date('+010000-…')` é válido no JS, mas derrubava a consulta com 500.
 * @param {Date} d
 */
export const instanteSerializavel = (d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 0 && d.getUTCFullYear() <= 9999;

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
 * Cursor adulterado (forma, id ou instante que nenhum registro produz) → null,
 * e quem chama responde 400 — nunca 500 no banco ou no engine. O formato dos
 * cursores válidos não muda.
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
    if (typeof t !== 'string' || typeof i !== 'string' || !ID_DE_CURSOR.test(i)) return null;
    const createdAt = new Date(t);
    if (!instanteSerializavel(createdAt)) return null;
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

/**
 * Envelope HTTP padrão do motor Base1 (qualquer entidade).
 *
 * `registros` deve ter vindo com `take: limit + 1`.
 *
 * @template TRow
 * @template TItem
 * @param {{
 *   registros: TRow[],
 *   limit: number,
 *   total: number,
 *   mapItem: (row: TRow) => TItem,
 *   cursorDe?: (row: TRow) => { createdAt: Date|string, id: string },
 * }} args
 */
export const montarEnvelopeKeyset = ({
  registros,
  limit,
  total,
  mapItem,
  cursorDe = (row) => /** @type {{ createdAt: Date|string, id: string }} */ (row),
}) => {
  const hasMore = registros.length > limit;
  const pagina = hasMore ? registros.slice(0, limit) : registros;
  const ultimo = pagina[pagina.length - 1];
  const nextCursor = hasMore && ultimo ? codificarCursor(cursorDe(ultimo)) : null;
  return {
    items: pagina.map(mapItem),
    next_cursor: nextCursor,
    has_more: hasMore,
    total,
    limit,
  };
};
