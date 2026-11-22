/**
 * D-PROD-273 (fatia 2) — saldo EXIBIDO sem os movimentos excluídos, para as listas do mapa que leem os movimentos
 * crus (o histórico do depósito). A mesma regra do kardex no servidor (`estoqueConsultaService`):
 *
 *  - par excluído = o original 'Estornada' e o estorno dele (`tipo_detalhado` 'estorno_*' com `movimento_pai_id` =
 *    o original), no mesmo produto e empresa;
 *  - o saldo de cada movimento que fica na tela = o `saldo_antes/depois` gravado menos o efeito dos excluídos do
 *    MESMO produto e depósito lançados antes dele (ordem canônica: `numero_movimentacao` numérico; empate/legado por
 *    `created_date`, `id`). Um par inteiro antes soma zero; só o movimento lançado ENTRE o original e o estorno muda.
 *
 * O depósito do saldo é o do motor: Entrada → `local_estoque_destino`; Saída → `local_estoque_origem`. Decimais em
 * inteiro (4 casas, BigInt): nada de ponto flutuante. Puro; não grava nada.
 */

const CASAS = 4;
const ESCALA = 10n ** BigInt(CASAS);

/** Decimal (texto ou número) → unidades de 1/10⁴ (BigInt); inválido → null. @param {unknown} v */
const paraUnidades = (v) => {
  const texto = typeof v === "number" ? (Number.isFinite(v) ? v.toFixed(CASAS) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!m) return null;
  const frac = (m[3] ?? "").slice(0, CASAS).padEnd(CASAS, "0");
  const n = BigInt(m[2]) * ESCALA + BigInt(frac);
  return m[1] ? -n : n;
};

/** Unidades → texto canônico com 4 casas ("50.0000"; negativo com "-"). @param {bigint} n */
const deUnidades = (n) => {
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / ESCALA}.${String(a % ESCALA).padStart(CASAS, "0")}`;
};

/** @param {any} m */
const ehEstorno = (m) => typeof m?.tipo_detalhado === "string" && m.tipo_detalhado.startsWith("estorno_");

/** Depósito cujo saldo o movimento gravou. @param {any} m */
const depositoDoSaldo = (m) => (m?.tipo_movimentacao === "Entrada" ? m.local_estoque_destino ?? null : m?.tipo_movimentacao === "Saída" ? m.local_estoque_origem ?? null : null);

/** Efeito no saldo do depósito (Entrada +q, Saída −q), em unidades; desconhecido → null. @param {any} m */
const efeitoNoSaldo = (m) => {
  const q = paraUnidades(m?.quantidade ?? 0);
  if (q === null) return null;
  if (m?.tipo_movimentacao === "Entrada") return q;
  if (m?.tipo_movimentacao === "Saída") return -q;
  return null;
};

/** @param {any} m */
const chaveDeOrdem = (m) => {
  const numero = typeof m?.numero_movimentacao === "string" && /^\d{1,18}$/.test(m.numero_movimentacao) ? BigInt(m.numero_movimentacao) : null;
  const t = new Date(m?.created_date ?? m?.createdAt ?? 0).getTime();
  return { numero, t: Number.isNaN(t) ? 0 : t, id: String(m?.id ?? "") };
};

/** `a` foi lançado antes de `b`. @param {ReturnType<typeof chaveDeOrdem>} a @param {ReturnType<typeof chaveDeOrdem>} b */
const lancadoAntes = (a, b) => {
  if (a.numero !== null && b.numero !== null && a.numero !== b.numero) return a.numero < b.numero;
  if (a.t !== b.t) return a.t < b.t;
  return a.id < b.id;
};

/**
 * Ids dos movimentos de pares excluídos COMPLETOS da lista (original 'Estornada' com estorno presente, e o estorno).
 * @param {any[]} movimentos
 * @returns {Set<string>}
 */
export function idsDeParesExcluidos(movimentos) {
  const lista = Array.isArray(movimentos) ? movimentos : [];
  const porId = new Map(lista.map((m) => [String(m?.id), m]));
  /** @type {Set<string>} */
  const ids = new Set();
  for (const e of lista) {
    if (!ehEstorno(e) || !e.movimento_pai_id) continue;
    const o = porId.get(String(e.movimento_pai_id));
    if (!o || o.status !== "Estornada" || o.produto_id !== e.produto_id || o.empresa_id !== e.empresa_id) continue;
    ids.add(String(o.id));
    ids.add(String(e.id));
  }
  return ids;
}

/**
 * Os `visiveis` com o saldo sem os excluídos (pares completos de `todos`). O movimento sem ajuste volta o MESMO
 * objeto; com ajuste, uma cópia com `saldo_antes`/`saldo_depois` em texto canônico. Um excluído na lista de visíveis
 * fica como está (o saldo gravado).
 * @template T
 * @param {T[]} visiveis
 * @param {any[]} todos a lista completa de onde saíram (a dos pares)
 * @returns {T[]}
 */
export function comSaldoSemExcluidos(visiveis, todos) {
  const lista = Array.isArray(todos) ? todos : [];
  const excluidos = idsDeParesExcluidos(lista);
  if (!excluidos.size) return visiveis;
  const fatos = lista
    .filter((m) => excluidos.has(String(m?.id)))
    .map((m) => ({ produto_id: m.produto_id, deposito: depositoDoSaldo(m), efeito: efeitoNoSaldo(m), ordem: chaveDeOrdem(m) }))
    .filter((f) => f.deposito && f.efeito !== null);
  return visiveis.map((m) => {
    const mov = /** @type {any} */ (m);
    if (excluidos.has(String(mov?.id))) return m;
    const deposito = depositoDoSaldo(mov);
    if (!deposito) return m;
    const ordem = chaveDeOrdem(mov);
    let ajuste = 0n;
    for (const f of fatos) {
      if (f.produto_id === mov.produto_id && f.deposito === deposito && lancadoAntes(f.ordem, ordem)) ajuste += /** @type {bigint} */ (f.efeito);
    }
    if (ajuste === 0n) return m;
    /** @param {unknown} v */
    const menos = (v) => {
      const u = v === null || v === undefined ? null : paraUnidades(v);
      return u === null ? v : deUnidades(u - ajuste);
    };
    return /** @type {T} */ ({ ...mov, saldo_antes: menos(mov.saldo_antes), saldo_depois: menos(mov.saldo_depois) });
  });
}
