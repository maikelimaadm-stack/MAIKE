/**
 * Chave = UISwitch do iPhone (D-PROD-98, refinada pela D-PROD-102):
 * trilho 60×28, cápsula 38×24 que estica ao pressionar e chega com mola.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = () => readFileSync('src/styles/maike-mobile-shell.css', 'utf8');

describe('V7/V8 — chave do iOS', () => {
  it('V7-1 — um tamanho para todas (60×28, cápsula 38×24, pressionada 44)', () => {
    const f = css();
    expect(f).toMatch(/--mk-sw-w: 60px;\s*--mk-sw-h: 28px;\s*--mk-sw-g: 2px;\s*--mk-sw-knob: 38px;\s*--mk-sw-knob-press: 44px;/);
    expect(f).toMatch(/\.cadastro-b1 \.b1-switch:not\(#mk-padrao\) \{\s*--sw-w: var\(--mk-sw-w\);\s*--sw-h: var\(--mk-sw-h\);\s*--sw-g: var\(--mk-sw-g\);\s*--sw-b: 1\.58;/);
    expect(f).toMatch(/\.mk-ios-switch:not\(#mk-padrao\) \{\s*width: var\(--mk-sw-w\);\s*height: var\(--mk-sw-h\);/);
    expect(f).toMatch(/button\.mk-switch:not\(#mk-padrao\) \{\s*width: var\(--mk-sw-w\);/);
  });

  it('V7-2 — mola: passa levemente do ponto e volta (linear() com fallback cubic-bezier)', () => {
    const f = css();
    const fallback = f.match(/--mk-sw-mola: cubic-bezier\(([^)]+)\)/);
    expect(fallback).not.toBeNull();
    const [, y1, , y2] = fallback[1].split(',').map(Number);
    expect(Math.max(y1, y2)).toBeGreaterThan(1);
    expect(Math.max(y1, y2)).toBeLessThan(1.6); // sem exagero
    const mola = f.match(/@supports \(transition-timing-function: linear\(0, 1\)\) \{[\s\S]*?--mk-sw-mola: linear\(([^)]+)\)/);
    expect(mola).not.toBeNull();
    const pico = Math.max(...mola[1].split(',').map((p) => Number(p.trim().split(' ')[0])));
    expect(pico).toBeGreaterThan(1);
    expect(pico).toBeLessThan(1.15);
  });

  it('V7-3 — chave ao lado do rótulo (sem empurrar para o canto)', () => {
    expect(css()).toMatch(/\.cadastro-b1 \.b1-chave-row:not\(#mk-padrao\) \{\s*justify-content: flex-start;/);
  });

  it('V7-4 — Switch do shadcn usa as classes do padrão', () => {
    const fonte = readFileSync('src/components/ui/switch.jsx', 'utf8');
    expect(fonte).toMatch(/"mk-switch peer/);
    expect(fonte).toMatch(/"mk-switch__thumb /);
  });

  it('V8-1 — pressionar estica a bolinha nas três chaves', () => {
    const f = css();
    expect(f).toMatch(/\.b1-switch:active:not\(:disabled\):not\(#mk-padrao\) \.b1-switch__thumb \{\s*aspect-ratio: 1\.83;/);
    expect(f).toMatch(/\.mk-ios-switch:active:not\(:disabled\):not\(#mk-padrao\) \.mk-ios-switch__thumb \{\s*width: var\(--mk-sw-knob-press\);/);
    expect(f).toMatch(/button\.mk-switch:active:not\(:disabled\):not\(#mk-padrao\) \.mk-switch__thumb \{\s*width: var\(--mk-sw-knob-press\);/);
  });

  it('V8-2 — iOS: ouvinte de toque para o :active funcionar', () => {
    const layout = readFileSync('src/Layout.jsx', 'utf8');
    expect(layout).toMatch(/document\.addEventListener\("touchstart", nada, \{ passive: true \}\)/);
  });

  it('V8-3 — folha: largura constante; média flutuante por recorte (clip-path), sem animar margens', () => {
    const f = css();
    expect(f).toMatch(/\.mk-sheet \{\s*--mk-folha-margem: 8px;\s*right: 0;\s*bottom: 0;\s*left: 0;/);
    expect(f).toMatch(/clip-path: inset\(0 var\(--mk-folha-margem\)/);
    expect(f).toMatch(/\.mk-sheet\.is-large \{[^}]*clip-path: inset\(0 0 0 0 round 38px 38px 0 0\)/);
    const bloco = f.slice(f.indexOf('Folha (D-PROD-102)'), f.indexOf('.mk-sheet.is-dragging'));
    expect(bloco).not.toMatch(/left 0\.\d+s|right 0\.\d+s|bottom 0\.\d+s/);
  });
});
