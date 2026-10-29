/**
 * Smoke pós-deploy do MAIKE Admin (PR145-R4) — só leitura, sem credencial.
 *
 * Detecta os erros de rollout que deixam o admin publicado inutilizável ou
 * inseguro, com o diagnóstico de cada um:
 *  - sem HTTPS;
 *  - cabeçalhos de segurança ausentes (CSP/frame-ancestors, X-Frame-Options,
 *    HSTS, noindex);
 *  - proxy `/api/native` ausente (a chamada cai no index.html da SPA) ou
 *    apontando para o lugar errado (404/HTML);
 *  - backend sem `ADMIN_MAIKE_CHAVE` (503 ADMIN_INDISPONIVEL);
 *  - `ADMIN_ORIGINS` sem a origin deste deploy (403 ADMIN_ORIGEM_RECUSADA);
 *  - API de tenant exposta sem sessão;
 *  - bundle carregando nome de credencial server-only.
 *
 * O único POST é um login com login ALEATÓRIO inexistente: não cria sessão,
 * não bloqueia a conta real (o bloqueio é por conta).
 *
 * @param {{ url: string, fetch?: typeof fetch, permitirHttp?: boolean }} opcoes
 * @returns {Promise<Array<{ nome: string, ok: boolean, detalhe: string }>>}
 */
export const verificarDeployAdmin = async ({ url, fetch: f = fetch, permitirHttp = false }) => {
  const base = new URL(url);
  const origin = base.origin;
  const r = [];
  const marcar = (nome, ok, detalhe = '') => r.push({ nome, ok, detalhe });
  const json = async (resp) => {
    const t = await resp.text();
    try {
      return { corpo: JSON.parse(t), html: false };
    } catch {
      return { corpo: null, html: /<html|<!doctype/i.test(t) };
    }
  };

  marcar('HTTPS', base.protocol === 'https:' || permitirHttp, base.protocol === 'https:' ? '' : 'use https:// no endereço público');

  const raiz = await f(`${origin}/`, { redirect: 'manual' });
  const html = await raiz.text();
  const h = (n) => raiz.headers.get(n) || '';
  marcar('página do MAIKE Admin', raiz.status === 200 && /MAIKE Admin/.test(html) && /id="raiz"/.test(html), `HTTP ${raiz.status}`);
  marcar("CSP com frame-ancestors 'none'", /frame-ancestors 'none'/.test(h('content-security-policy')), h('content-security-policy') || 'ausente');
  marcar('X-Frame-Options DENY', /deny/i.test(h('x-frame-options')), h('x-frame-options') || 'ausente');
  marcar('noindex', /noindex/i.test(h('x-robots-tag')), h('x-robots-tag') || 'ausente');
  if (!permitirHttp) marcar('HSTS', /max-age=\d+/.test(h('strict-transport-security')), h('strict-transport-security') || 'ausente');

  const sessao = await f(`${origin}/api/native/admin-maike/sessao`, { headers: { accept: 'application/json' } });
  const s = await json(sessao);
  let diag = `HTTP ${sessao.status}`;
  if (s.html) diag = 'resposta HTML: falta o proxy /api/native → backend (caiu no fallback da SPA)';
  else if (s.corpo?.code === 'ADMIN_INDISPONIVEL') diag = 'backend sem ADMIN_MAIKE_CHAVE válida (503)';
  else if (sessao.status === 404) diag = 'proxy aponta para lugar errado (404)';
  marcar('proxy /api/native até o backend', sessao.status === 401 && s.corpo?.code === 'ADMIN_SESSAO_REQUIRED', diag);

  const login = await f(`${origin}/api/native/admin-maike/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ login: `smoke-${Math.random().toString(36).slice(2, 10)}`, senha: 'smoke-sem-conta-0000' }),
  });
  const l = await json(login);
  let diagLogin = `HTTP ${login.status} ${l.corpo?.code ?? ''}`.trim();
  if (l.corpo?.code === 'ADMIN_ORIGEM_RECUSADA') diagLogin = `ADMIN_ORIGINS do backend não inclui ${origin}`;
  if (l.corpo?.code === 'ADMIN_RATE_LIMITED') diagLogin = 'limitador por IP ativo (429): rode de novo em 15 min';
  marcar(
    'Origin aceita e login genérico',
    login.status === 401 && l.corpo?.code === 'ADMIN_CREDENCIAIS_INVALIDAS' && !login.headers.get('set-cookie'),
    diagLogin
  );

  const tenant = await f(`${origin}/api/native/catalogo-global/manifest`, { headers: { accept: 'application/json' } });
  marcar('API de tenant exige sessão', tenant.status === 401, `HTTP ${tenant.status}`);

  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], origin).href);
  let vazou = '';
  for (const src of scripts) {
    const js = await (await f(src)).text();
    const m = /service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|ADMIN_MAIKE_CHAVE/.exec(js);
    if (m) vazou = `${src}: ${m[0]}`;
  }
  marcar('bundle sem credencial server-only', scripts.length > 0 && !vazou, vazou || `${scripts.length} script(s)`);
  return r;
};
