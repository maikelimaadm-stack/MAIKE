/**
 * v6 — folha lisa no iPhone e cards sem fundo branco (D-PROD-97).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codigo = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('V6 — folha', () => {
  const folha = () => codigo('src/components/common/MobileSheet.jsx');

  it('V6-1 — cancela o primeiro touchmove quando o gesto só pode ser da folha', () => {
    const mover = folha().slice(folha().indexOf('const mover'), folha().indexOf('if (Math.abs(dy) < 7'));
    expect(mover).toMatch(/const daFolha = !g\.noCorpo \|\| \(dy > 0 && \(!corpo \|\| corpo\.scrollTop <= 0\)\) \|\| \(dy < 0 && !grandeRef\.current\)/);
    expect(mover).toMatch(/if \(daFolha\) ev\.preventDefault\(\)/);
  });

  it('V6-2 — altura fixa durante todo o arraste e classe trocada antes da animação final', () => {
    const f = folha();
    expect(f).toMatch(/folha\.style\.height = `\$\{g\.max\}px`;\s*folha\.style\.maxHeight = "none";\s*g\.base = grandeRef\.current \? 0 : g\.max - g\.h0;/);
    expect(f).toMatch(/setGrande\(true\);\s*animarAte\(0, limpar\)/);
    expect(f).toMatch(/setGrande\(false\);\s*animarAte\(estado\.max - media, limpar\)/);
  });

  it('V6-3 — sem sombra durante o arraste; lista não passa o rolar para a folha', () => {
    const css = readFileSync('src/styles/maike-mobile-shell.css', 'utf8');
    expect(css).toMatch(/\.mk-sheet\.is-dragging \{\s*box-shadow: none !important;/);
    expect(css).toMatch(/\.mk-sheet__body \{\s*overscroll-behavior: contain;/);
  });
});

describe('V6 — cards', () => {
  it('V6-4 — contêiner branco da tela fica transparente atrás dos cards', () => {
    const css = readFileSync('src/styles/maike-mobile-shell.css', 'utf8');
    expect(css).toMatch(/\.mg-shell__scroll :is\(\.bg-white, \[class\*="bg-white"\]\):has\(\.mg-b1-cards-grid\):not\(#mk-padrao\) \{\s*background: transparent !important;/);
  });
});
