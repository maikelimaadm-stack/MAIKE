/**
 * Quantidade de cabeças no marcador do lote (D-PROD-82/83): cinza escuro,
 * abaixo da figura, e a fonte encolhe para caber quando passa de 4 caracteres.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { tamanhoFonteContagem, FONTE_CONTAGEM_BASE, FONTE_CONTAGEM_MINIMA } from '../../src/lib/maplibre/contagemLote.js';

describe('CNT — fonte da quantidade de cabeças', () => {
  it('CNT-01 até 4 caracteres usa o tamanho base', () => {
    for (const t of ['5', '50', '500', '5000']) expect(tamanhoFonteContagem(t)).toBe(FONTE_CONTAGEM_BASE);
  });

  it('CNT-02 mais caracteres encolhe proporcionalmente, sem passar do mínimo', () => {
    expect(tamanhoFonteContagem('12500')).toBe(8);
    expect(tamanhoFonteContagem('125000')).toBe(7);
    expect(tamanhoFonteContagem('1250000')).toBe(FONTE_CONTAGEM_MINIMA);
    expect(tamanhoFonteContagem('123456789012')).toBe(FONTE_CONTAGEM_MINIMA);
  });

  it('CNT-03 o marcador aplica a fonte calculada e fica abaixo da figura', () => {
    const fonte = readFileSync('src/components/mapa/useMapRenderer.jsx', 'utf8');
    expect(fonte).toMatch(/entry\.badge\.style\.fontSize = `\$\{tamanhoFonteContagem\(textoCabecas\)\}px`/);
    expect(fonte).toMatch(/top:72%[^"]*color:#374151/);
  });
});
