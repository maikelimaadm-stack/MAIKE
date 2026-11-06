/**
 * MAIKE-ADMIN-S02 — invariantes do deploy próprio do MAIKE Admin
 * (`apps/admin/vercel.json`, projeto Vercel com Root Directory `apps/admin`).
 *
 * O que quebrar aqui expõe a sessão do proprietário ou derruba o admin:
 *  - a API é chamada na MESMA origin (`/api/native`) e o proxy aponta para o
 *    domínio PRÓPRIO do backend — um `*.vercel.app` some atrás da Deployment
 *    Protection ("todos exceto domínios próprios");
 *  - respostas da API nunca ficam em cache (sessão, CSRF, dados de clientes);
 *  - CSP estrita, sem iframe, sem indexação;
 *  - o fallback SPA não engole `/api/native` (senão um 404 da API viraria HTML 200);
 *  - o build é o do admin, não o da SPA dos clientes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('apps/admin/vercel.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const vite = readFileSync('apps/admin/vite.config.js', 'utf8');

const cabecalhos = (source) => Object.fromEntries((config.headers.find((h) => h.source === source)?.headers ?? []).map((h) => [h.key, h.value]));

describe('ADM-DEPLOY — apps/admin/vercel.json', () => {
  it('ADM-DEPLOY-01 build e saída do admin (monorepo com Root Directory apps/admin)', () => {
    expect(config.installCommand).toBe('npm ci --prefix ../..');
    expect(config.buildCommand).toBe('npm run build:admin --prefix ../..');
    expect(pkg.scripts['build:admin']).toBe('vite build --config apps/admin/vite.config.js');
    expect(config.outputDirectory).toBe('dist');
    expect(vite).toMatch(/outDir: 'dist'/);
    expect(config.framework).toBeNull();
  });

  it('ADM-DEPLOY-02 API na mesma origin, proxied para o domínio próprio do backend', () => {
    const api = config.rewrites.find((r) => r.source === '/api/native/:path*');
    expect(api?.destination).toBe('https://www.makgestao.com/api/native/:path*');
    expect(new URL(api.destination.replace(':path*', 'x')).hostname.endsWith('.vercel.app')).toBe(false);
    const spa = config.rewrites.find((r) => r.destination === '/index.html');
    expect(spa?.source).toBe('/((?!api/native).*)');
    expect(config.rewrites.indexOf(api)).toBeLessThan(config.rewrites.indexOf(spa));
  });

  it('ADM-DEPLOY-03 respostas da API sem cache', () => {
    expect(cabecalhos('/api/native/(.*)')['Cache-Control']).toBe('no-store');
  });

  it('ADM-DEPLOY-04 cabeçalhos de segurança em tudo', () => {
    const h = cabecalhos('/(.*)');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(h['Strict-Transport-Security']).toMatch(/max-age=\d{8}/);
    const csp = h['Content-Security-Policy'];
    for (const diretiva of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) {
      expect(csp).toContain(diretiva);
    }
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|connect-src[^;]*https:/);
  });

  it('ADM-DEPLOY-05 atalho makgestao.com/admmakgestao só redireciona para a origin própria do admin', () => {
    const raiz = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const atalhos = (raiz.redirects ?? []).filter((r) => /^\/admmakgestao/.test(r.source));
    expect(atalhos.map((r) => r.source).sort()).toEqual(['/admmakgestao', '/admmakgestao/:path*']);
    for (const r of atalhos) {
      expect(r.destination).toBe('https://admmakgestao.vercel.app/');
      // 307: trocar o destino depois não fica preso no cache do navegador.
      expect(r.permanent).toBe(false);
    }
    expect((raiz.rewrites ?? []).some((r) => /admmakgestao/.test(r.source))).toBe(false);
  });
});
