/**
 * Quantidade de cabeças no marcador do lote (D-PROD-82/83): cinza escuro,
 * abaixo da figura, e a fonte encolhe pela largura medida para caber no ícone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  tamanhoFonteContagem,
  larguraEstimada,
  FONTE_CONTAGEM_BASE,
  FONTE_CONTAGEM_MINIMA,
  LARGURA_MAXIMA_CONTAGEM,
} from '../../src/lib/maplibre/contagemLote.js';

// Larguras reais medidas no Chromium (700 11px Inter/Arial), proporcionais ao px.
// Fonte base 10 px com o ícone de 44 px (D-PROD-89); a faixa de 22 px segue dentro dele.
const MEDIDAS_11PX = { 5: 7.0, 50: 14.4, 500: 21.9, 5000: 29.3, 12500: 33.5, 125000: 41.0, 1250000: 48.4 };
const medidor = (t, px) => (MEDIDAS_11PX[t] * px) / 11;

describe('CNT — fonte da quantidade de cabeças', () => {
  it('CNT-01 número que cabe na faixa usa o tamanho base', () => {
    expect(FONTE_CONTAGEM_BASE).toBe(10);
    for (const t of ['5', '50', '500']) expect(tamanhoFonteContagem(t, medidor)).toBe(FONTE_CONTAGEM_BASE);
  });

  it('CNT-02 número largo encolhe e, no tamanho escolhido, cabe dentro do ícone', () => {
    for (const t of ['5000', '12500', '125000', '1250000']) {
      const px = tamanhoFonteContagem(t, medidor);
      expect(px).toBeLessThan(FONTE_CONTAGEM_BASE);
      expect(px).toBeGreaterThanOrEqual(FONTE_CONTAGEM_MINIMA);
      expect(medidor(t, px)).toBeLessThanOrEqual(LARGURA_MAXIMA_CONTAGEM);
    }
  });

  it('CNT-03 sem canvas, a estimativa também encolhe e respeita o mínimo', () => {
    expect(tamanhoFonteContagem('50')).toBe(FONTE_CONTAGEM_BASE);
    expect(larguraEstimada('5000', tamanhoFonteContagem('5000'))).toBeLessThanOrEqual(LARGURA_MAXIMA_CONTAGEM);
    expect(tamanhoFonteContagem('123456789012')).toBe(FONTE_CONTAGEM_MINIMA);
  });

  it('CNT-04 o marcador mede o texto, aplica a fonte calculada e fica abaixo da figura', () => {
    const fonte = readFileSync('src/components/mapa/useMapRenderer.jsx', 'utf8');
    expect(fonte).toMatch(/medirContagem \|\|= criarMedidorDeTexto\(\)/);
    expect(fonte).toMatch(/entry\.badge\.style\.fontSize = `\$\{tamanhoFonteContagem\(textoCabecas, medirContagem\)\}px`/);
    expect(fonte).toMatch(/top:66%[^"]*color:#374151/);
    // Ícone do lote 44 px, raio e deslocamento proporcionais (D-PROD-89).
    expect(fonte).toMatch(/baseSize: 44, cor: "#10b981", titulo: area\.nome, raio: 19/);
    expect(fonte).toMatch(/OFFSET_LOTE_PX = .*\[0, -26\]/);
  });
});
