/*
 * Detalhe do COCHO v13 — contas puras das barras e réguas novas (só desenho; os números
 * continuam vindo do SSOT `calcularNivelCocho` e do cadastro do ponto). Testáveis sem tela.
 */

/** @param {unknown} v */
const positivo = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : null);

/** kg/cab/dia com 3 casas ("0,075"). @param {number} v */
const kg3 = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Dia (UTC) de "AAAA-MM-DD", ou null. @param {unknown} iso */
const diaUTC = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
};

/** "dd/mm" de "AAAA-MM-DD". @param {unknown} iso */
const ddmm = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}` : "";
};

/**
 * Barra do ciclo aberto: do lançamento até o dia em que o cocho acaba (estimado), com
 * a marca de hoje. Sem as três datas, ou com o fim antes do início → null.
 * @param {{ inicio: unknown, hoje: unknown, fim: unknown }} p datas "AAAA-MM-DD"
 * @returns {null | { decorrido: number, inicio: string, fim: string, texto: string }} `decorrido` 0–100
 */
export function barraDoCiclo({ inicio, hoje, fim }) {
  const a = diaUTC(inicio);
  const h = diaUTC(hoje);
  const b = diaUTC(fim);
  if (a === null || h === null || b === null || b <= a) return null;
  const decorrido = Math.max(0, Math.min(100, ((h - a) / (b - a)) * 100));
  const restam = Math.max(0, b - h);
  return {
    decorrido,
    inicio: ddmm(inicio),
    fim: ddmm(fim),
    texto: `Lançado em ${ddmm(inicio)}; acaba por volta de ${ddmm(fim)}; ${restam === 1 ? "resta 1 dia" : `restam ${restam} dias`}`,
  };
}

/**
 * Régua do consumo por cabeça (kg/dia) do cadastro: mínimo, ideal e máximo na mesma
 * escala (0 a 125% do maior). Zona verde entre o mínimo e o máximo (o que existir);
 * marca no ideal. Nenhum dos três → null.
 * @param {{ minimo: unknown, ideal: unknown, maximo: unknown }} p
 * @returns {null | { minimo: null | { valor: number, pos: number }, ideal: null | { valor: number, pos: number }, maximo: null | { valor: number, pos: number }, zona: null | { inicio: number, fim: number }, texto: string }}
 */
export function reguaDoConsumoPorCabeca({ minimo, ideal, maximo }) {
  const valores = { minimo: positivo(minimo), ideal: positivo(ideal), maximo: positivo(maximo) };
  const existentes = Object.values(valores).filter((v) => v !== null);
  if (!existentes.length) return null;
  const topo = Math.max(.../** @type {number[]} */ (existentes)) * 1.25;
  /** @param {number | null} v */
  const marca = (v) => (v === null ? null : { valor: v, pos: (v / topo) * 100 });
  const r = { minimo: marca(valores.minimo), ideal: marca(valores.ideal), maximo: marca(valores.maximo) };
  const zona = r.minimo || r.maximo ? { inicio: r.minimo ? r.minimo.pos : 0, fim: r.maximo ? r.maximo.pos : 100 } : null;
  const partes = [
    r.minimo ? `mínimo ${kg3(r.minimo.valor)} kg` : null,
    r.ideal ? `ideal ${kg3(r.ideal.valor)} kg` : null,
    r.maximo ? `máximo ${kg3(r.maximo.valor)} kg` : null,
  ].filter(Boolean);
  return { ...r, zona, texto: `Consumo por cabeça por dia: ${partes.join(", ")}` };
}

/** Percentual 0–100 para a largura de uma barra; fora de número → null. @param {unknown} pct */
export const larguraDaBarra = (pct) => (typeof pct === "number" && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null);
