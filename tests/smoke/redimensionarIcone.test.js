/**
 * Ajuste automático do ícone no envio (D-PROD-81): qualquer imagem cabe no
 * quadrado do ícone, sem deformar nem ampliar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { dimensoesDeIcone, LADO_MAXIMO_ICONE, redimensionarParaIcone } from '../../src/lib/imagens/redimensionarIcone.js';

describe('ICO — ajuste automático do ícone', () => {
  it('ICO-01 reduz mantendo a proporção (1000×1000 → 256×256; 1000×500 → 256×128; 416×415 → 256×255)', () => {
    expect(dimensoesDeIcone(1000, 1000)).toEqual({ largura: 256, altura: 256 });
    expect(dimensoesDeIcone(1000, 500)).toEqual({ largura: 256, altura: 128 });
    expect(dimensoesDeIcone(500, 1000)).toEqual({ largura: 128, altura: 256 });
    expect(dimensoesDeIcone(416, 415)).toEqual({ largura: 256, altura: 255 });
    expect(LADO_MAXIMO_ICONE).toBe(256);
  });

  it('ICO-02 nunca amplia imagem pequena e trata dimensão inválida', () => {
    expect(dimensoesDeIcone(64, 48)).toEqual({ largura: 64, altura: 48 });
    expect(dimensoesDeIcone(0, 10)).toEqual({ largura: 0, altura: 0 });
  });

  it('ICO-03 SVG e não-imagem seguem como estão', async () => {
    const svg = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    const txt = new Blob(['x'], { type: 'text/plain' });
    expect(await redimensionarParaIcone(svg)).toBe(svg);
    expect(await redimensionarParaIcone(txt)).toBe(txt);
  });

  it('ICO-04 o gerenciador de ícones reduz antes de enviar (principal e subícone)', () => {
    const fonte = readFileSync('src/components/configuracoes/GerenciadorIcones.jsx', 'utf8');
    expect(fonte.match(/enviarArquivo\(await redimensionarParaIcone\(file\)\)/g)).toHaveLength(2);
  });
});
