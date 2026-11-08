/**
 * Dias civis (AAAA-MM-DD) no navegador (D-PROD-154, §8.7).
 *
 * Datas de negócio são TEXTO de dia, nunca `Date` local: `new Date(2026, 10, 8)`
 * em Tóquio vira "2026-11-07" no `toISOString`, e somar 1 dia na troca de
 * horário de Madri pula um dia. Toda aritmética aqui é em UTC sobre o texto;
 * "hoje" é calculado com `Intl` no fuso IANA da EMPRESA (vem do perfil).
 */

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DIA = 86400000;

/** @param {unknown} dia @returns {[number, number, number] | null} */
const partesDoDia = (dia) => {
  const m = RE_DIA.exec(String(dia ?? ''));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(ano, mes - 1, d));
  if (t.getUTCFullYear() !== ano || t.getUTCMonth() !== mes - 1 || t.getUTCDate() !== d) return null;
  return [ano, mes, d];
};

/** É um dia real no formato AAAA-MM-DD? @param {unknown} dia */
export const ehDiaValido = (dia) => partesDoDia(dia) !== null;

/**
 * Soma `n` dias (UTC) a um dia válido. Dia inválido → "".
 * @param {string} dia
 * @param {number} n
 */
export const somarDias = (dia, n) => {
  const p = partesDoDia(dia);
  if (!p || !Number.isInteger(n)) return '';
  const t = Date.UTC(p[0], p[1] - 1, p[2]) + n * MS_DIA;
  const r = new Date(t);
  if (r.getUTCFullYear() > 9999 || r.getUTCFullYear() < 1) return '';
  return r.toISOString().slice(0, 10);
};

/** Diferença em dias (b − a) entre dois dias válidos. @param {string} a @param {string} b */
export const diasEntre = (a, b) => {
  const pa = partesDoDia(a);
  const pb = partesDoDia(b);
  if (!pa || !pb) return null;
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / MS_DIA);
};

/**
 * Hoje no fuso IANA informado (ex.: "America/Sao_Paulo"). Sem fuso (ou fuso
 * inválido) usa o relógio do navegador — a tela avisa que a empresa não tem fuso.
 * @param {string|null|undefined} fuso
 * @param {Date} [agora]
 */
export const hojeNoFuso = (fuso, agora = new Date()) => {
  /** @param {string|undefined} timeZone */
  const formatar = (timeZone) => {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', numberingSystem: 'latn' }).formatToParts(agora);
    const v = (/** @type {string} */ tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
    return `${v('year')}-${v('month')}-${v('day')}`;
  };
  try {
    return formatar(fuso || undefined);
  } catch {
    return formatar(undefined);
  }
};

/**
 * Dia para exibição no locale (ex.: "08/11/2026"), calculado em UTC sobre o
 * texto (não desloca no fuso do navegador).
 * @param {unknown} dia
 * @param {string} [locale]
 */
export const formatarDia = (dia, locale = 'pt-BR') => {
  const p = partesDoDia(dia);
  if (!p) return typeof dia === 'string' && dia ? dia : '—';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', numberingSystem: 'latn' }).format(new Date(Date.UTC(p[0], p[1] - 1, p[2])));
  } catch {
    return `${String(p[2]).padStart(2, '0')}/${String(p[1]).padStart(2, '0')}/${p[0]}`;
  }
};

/**
 * Instante ISO para exibição (data e hora) no fuso da empresa.
 * @param {unknown} iso
 * @param {string} [locale]
 * @param {string|null} [fuso]
 */
export const formatarInstante = (iso, locale = 'pt-BR', fuso = null) => {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opcoes = /** @type {Intl.DateTimeFormatOptions} */ ({ dateStyle: 'short', timeStyle: 'short', numberingSystem: 'latn' });
  try {
    return new Intl.DateTimeFormat(locale, { ...opcoes, timeZone: fuso || undefined }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale, opcoes).format(d);
  }
};
