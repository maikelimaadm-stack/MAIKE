/**
 * Provas do smoke pós-deploy do MAIKE Admin (PR145-R4) contra deploys simulados.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { verificarDeployAdmin } from '../../admin/smokeAdminDeployLib.mjs';

const HTML = '<!doctype html><html><head><title>MAIKE Admin</title></head><body><div id="raiz"></div><script type="module" src="/assets/i.js"></script></body></html>';
const SEGURANCA = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'strict-transport-security': 'max-age=63072000',
};

/** Deploy simulado; `quebra` escolhe o defeito. */
const deploy = (quebra = '') => async (url, init = {}) => {
  const caminho = new URL(url).pathname;
  const resp = (status, corpo, headers = {}) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers });
  const comCabecalhos = quebra === 'sem-headers' ? {} : SEGURANCA;
  if (caminho === '/') return resp(200, HTML, { 'content-type': 'text/html', ...comCabecalhos });
  if (caminho === '/assets/i.js') return resp(200, quebra === 'vaza' ? 'x="SUPABASE_SERVICE_ROLE_KEY"' : 'console.log(1)');
  if (quebra === 'sem-proxy') return resp(200, HTML, { 'content-type': 'text/html' });
  if (caminho === '/api/native/admin-maike/sessao') {
    return quebra === 'sem-chave' ? resp(503, { code: 'ADMIN_INDISPONIVEL' }) : resp(401, { code: 'ADMIN_SESSAO_REQUIRED' });
  }
  if (caminho === '/api/native/admin-maike/auth/login') {
    // O smoke manda a origin do próprio deploy (é ela que precisa estar em ADMIN_ORIGINS).
    assert.equal(init.headers.origin, new URL(url).origin);
    return quebra === 'sem-origins' ? resp(403, { code: 'ADMIN_ORIGEM_RECUSADA' }) : resp(401, { code: 'ADMIN_CREDENCIAIS_INVALIDAS' });
  }
  if (caminho === '/api/native/catalogo-global/manifest') return resp(401, { code: 'TENANT_CONTEXT_REQUIRED' });
  return resp(404, { code: 'NOT_FOUND' });
};

const falhas = async (quebra, url = 'https://admin.teste') =>
  (await verificarDeployAdmin({ url, fetch: deploy(quebra) })).filter((c) => !c.ok);

describe('smoke pós-deploy do MAIKE Admin', () => {
  test('SMK-01 deploy correto passa em tudo', async () => assert.deepEqual(await falhas(''), []));
  test('SMK-02 sem proxy /api/native: diagnostica fallback da SPA', async () => {
    const f = await falhas('sem-proxy');
    assert.ok(f.some((c) => /falta o proxy/.test(c.detalhe)));
  });
  test('SMK-03 backend sem ADMIN_MAIKE_CHAVE', async () => assert.ok((await falhas('sem-chave')).some((c) => /ADMIN_MAIKE_CHAVE/.test(c.detalhe))));
  test('SMK-04 ADMIN_ORIGINS sem a origin do deploy', async () =>
    assert.ok((await falhas('sem-origins')).some((c) => /ADMIN_ORIGINS do backend não inclui https:\/\/admin\.teste/.test(c.detalhe))));
  test('SMK-05 cabeçalhos de segurança ausentes', async () => assert.equal((await falhas('sem-headers')).length, 4));
  test('SMK-06 sem HTTPS e bundle com credencial', async () => {
    assert.ok((await falhas('', 'http://admin.teste')).some((c) => c.nome === 'HTTPS'));
    assert.ok((await falhas('vaza')).some((c) => /SUPABASE_SERVICE_ROLE_KEY/.test(c.detalhe)));
  });
});
