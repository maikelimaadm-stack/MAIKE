/**
 * v7 — chave do iOS com tamanho único, pulinho e ao lado do rótulo (D-PROD-98).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = () => readFileSync('src/styles/maike-mobile-shell.css', 'utf8');

describe('V7 — chave do iOS', () => {
  it('V7-1 — um tamanho para todas (56×26) via variáveis', () => {
    const f = css();
    expect(f).toMatch(/--mk-sw-w: 56px;\s*--mk-sw-h: 26px;/);
    expect(f).toMatch(/\.cadastro-b1 \.b1-switch:not\(#mk-padrao\) \{\s*--sw-w: var\(--mk-sw-w\);\s*--sw-h: var\(--mk-sw-h\);/);
    expect(f).toMatch(/\.mk-ios-switch:not\(#mk-padrao\) \{\s*width: var\(--mk-sw-w\);\s*height: var\(--mk-sw-h\);/);
    expect(f).toMatch(/button\.mk-switch:not\(#mk-padrao\) \{\s*width: var\(--mk-sw-w\);/);
  });

  it('V7-2 — pulinho: curva que passa do ponto e volta', () => {
    const m = css().match(/--mk-sw-pulo: cubic-bezier\(([^)]+)\)/);
    expect(m).not.toBeNull();
    const [, y1, , y2] = m[1].split(',').map(Number);
    expect(Math.max(y1, y2)).toBeGreaterThan(1.5);
  });

  it('V7-3 — chave ao lado do rótulo (sem empurrar para o canto)', () => {
    expect(css()).toMatch(/\.cadastro-b1 \.b1-chave-row:not\(#mk-padrao\) \{\s*justify-content: flex-start;/);
  });

  it('V7-4 — Switch do shadcn usa as classes do padrão', () => {
    const fonte = readFileSync('src/components/ui/switch.jsx', 'utf8');
    expect(fonte).toMatch(/"mk-switch peer/);
    expect(fonte).toMatch(/"mk-switch__thumb /);
  });
});
