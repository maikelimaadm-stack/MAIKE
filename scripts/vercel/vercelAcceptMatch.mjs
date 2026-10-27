/**
 * Matching de Accept / condições de header alinhado ao matcher Vercel (rewrites).
 * Usado pelo gerador SSOT e pelos testes de smoke — não duplicar lógica nos testes.
 */

/** @typedef {{ type: 'header', key: string, value?: string | { pre?: string, suf?: string } }} VercelHeaderCondition */

const MIME_TEXT_HTML = /(?:^|[,\s])text\/html(?:[;\s,]|$)/i;

/**
 * Accept de navegação (documento) inclui text/html na lista de tipos MIME.
 * @param {string | undefined | null} accept
 */
export function acceptHeaderIsSpaDocument(accept) {
  if (accept == null || accept === '') return false;
  return MIME_TEXT_HTML.test(String(accept).trim());
}

/**
 * Valor usado em `missing`/`has` das regras de API: detecta text/html no Accept composto.
 * Regex compatível com o matcher Vercel (case-insensitive, parâmetros q=, listas).
 */
export const VERCEL_ACCEPT_TEXT_HTML_HEADER_VALUE = '(?i)(?:^|[,\\s])text/html(?:[;,\\s]|$)';

/** @type {VercelHeaderCondition} */
export const VERCEL_ACCEPT_TEXT_HTML_MISSING_CONDITION = {
  type: 'header',
  key: 'accept',
  value: VERCEL_ACCEPT_TEXT_HTML_HEADER_VALUE,
};

/**
 * @param {string | { pre?: string, suf?: string }} pattern
 * @param {string} headerValue
 */
export function headerValueMatchesPattern(pattern, headerValue) {
  const value = String(headerValue ?? '');
  if (pattern == null) return value.length > 0;
  if (typeof pattern === 'object') {
    const pre = pattern.pre ?? '';
    const suf = pattern.suf ?? '';
    return value.startsWith(pre) && value.endsWith(suf);
  }
  const pat = String(pattern);
  if (pat.startsWith('(?') || pat.includes('\\')) {
    try {
      let flags = '';
      let body = pat;
      if (body.startsWith('(?i)')) {
        flags = 'i';
        body = body.slice(4);
      }
      return new RegExp(body, flags).test(value);
    } catch {
      return value === pat;
    }
  }
  return value === pat;
}

/**
 * @param {VercelHeaderCondition} condition
 * @param {Record<string, string | undefined>} headers
 */
export function headerConditionMatches(condition, headers) {
  if (condition.type !== 'header') return false;
  const key = condition.key.toLowerCase();
  const raw = headers[key] ?? headers[condition.key];
  if (raw === undefined) return false;
  if (condition.value === undefined) return true;
  return headerValueMatchesPattern(condition.value, raw);
}

/**
 * @param {VercelHeaderCondition[] | undefined} conditions
 * @param {Record<string, string | undefined>} headers
 */
export function allHeaderConditionsMatch(conditions, headers) {
  if (!conditions?.length) return true;
  return conditions.every((c) => headerConditionMatches(c, headers));
}

/**
 * @param {string} pathname
 * @param {string} source
 */
export function pathMatchesRewriteSource(pathname, source) {
  let norm = pathname.split('?')[0];
  if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
  if (source === norm) return true;
  const splat = '/:path*';
  if (source.endsWith(splat)) {
    const base = source.slice(0, -splat.length);
    if (norm === base) return true;
    return norm.startsWith(`${base}/`);
  }
  return false;
}

/**
 * @param {{ source: string, destination: string, has?: VercelHeaderCondition[], missing?: VercelHeaderCondition[] }} rule
 * @param {{ pathname: string, headers?: Record<string, string | undefined> }} request
 */
export function rewriteRuleMatches(rule, request) {
  const pathname = request.pathname.split('?')[0];
  if (!pathMatchesRewriteSource(pathname, rule.source)) return false;
  const headers = request.headers ?? {};
  if (rule.has?.length && !allHeaderConditionsMatch(rule.has, headers)) return false;
  if (rule.missing?.length) {
    const anyPresent = rule.missing.some((c) => headerConditionMatches(c, headers));
    if (anyPresent) return false;
  }
  return true;
}

/**
 * Primeira regra que casa (ordem do vercel.json).
 * @param {Array<{ source: string, destination: string, has?: VercelHeaderCondition[], missing?: VercelHeaderCondition[] }>} rewrites
 * @param {{ pathname: string, headers?: Record<string, string | undefined> }} request
 * @returns {{ destination: string, rule: object } | null}
 */
export function resolveRewrite(rewrites, request) {
  for (const rule of rewrites) {
    if (rewriteRuleMatches(rule, request)) {
      return { destination: rule.destination, rule };
    }
  }
  return null;
}
