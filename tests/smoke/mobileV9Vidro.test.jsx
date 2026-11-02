/**
 * v9 — folha sem a "travinha" no iPhone e chave com cápsula de vidro (D-PROD-103).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codigo = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const css = () => readFileSync('src/styles/maike-mobile-shell.css', 'utf8');

describe('V9 — folha', () => {
  it('V9-1 — ao limpar, aplica o layout SEM transição antes de religá-la (nada de requestAnimationFrame)', () => {
    const f = codigo('src/components/common/MobileSheet.jsx');
    const limpar = f.slice(f.indexOf('const limpar'), f.indexOf('const soltar'));
    expect(limpar).toMatch(/folha\.style\.transition = "none";[\s\S]*folha\.style\.transform = "";\s*void folha\.getBoundingClientRect\(\);\s*folha\.style\.transition = "";/);
    expect(limpar).not.toMatch(/requestAnimationFrame/);
  });
});

describe('V9 — chave de vidro', () => {
  it('V9-2 — segurando: cápsula cresce e fica de vidro nas três chaves', () => {
    const f = css();
    expect(f).toMatch(/--mk-sw-vidro-escala: 1\.38;/);
    expect(f).toMatch(/\.b1-switch:active:not\(:disabled\):not\(#mk-padrao\) \.b1-switch__thumb,\s*\.mk-ios-switch:active:not\(:disabled\):not\(#mk-padrao\) \.mk-ios-switch__thumb,\s*button\.mk-switch:active:not\(:disabled\):not\(#mk-padrao\) \.mk-switch__thumb \{\s*scale: var\(--mk-sw-vidro-escala\);/);
  });

  it('V9-3 — ao trocar: animação de vidro (nomes alternados para rodar a cada toque), só depois de tocar', () => {
    const f = css();
    expect(f).toMatch(/@keyframes mk-sw-vidro-a/);
    expect(f).toMatch(/@keyframes mk-sw-vidro-b/);
    expect(f).toMatch(/\[data-mk-tocado\]\[aria-checked="true"\][\s\S]*?animation: mk-sw-vidro-a/);
    expect(f).toMatch(/\[data-mk-tocado\]\[aria-checked="false"\][\s\S]*?animation: mk-sw-vidro-b/);
    const layout = readFileSync('src/Layout.jsx', 'utf8');
    expect(layout).toMatch(/closest\('\[role="switch"\]'\)/);
    expect(layout).toMatch(/setAttribute\("data-mk-tocado", ""\)/);
  });

  it('V9-4 — respeita "reduzir movimento"', () => {
    expect(css()).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important;/);
  });
});
