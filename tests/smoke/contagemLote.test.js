/**
 * Quantidade de cabeças no marcador do lote (D-PROD-82/111): cinza,
 * abaixo da figura, tamanho fixo e milhar separado por ponto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { formatarContagem, FONTE_CONTAGEM_PX } from '../../src/lib/maplibre/contagemLote.js';

describe('CNT — quantidade de cabeças no marcador', () => {
  it('CNT-01 milhar com ponto', () => {
    expect(formatarContagem(8)).toBe('8');
    expect(formatarContagem(500)).toBe('500');
    expect(formatarContagem(5000)).toBe('5.000');
    expect(formatarContagem(12500)).toBe('12.500');
    expect(formatarContagem(1250000)).toBe('1.250.000');
  });

  it('CNT-02 valor ausente ou inválido vira 0', () => {
    expect(formatarContagem(undefined)).toBe('0');
    expect(formatarContagem(null)).toBe('0');
    expect(formatarContagem('abc')).toBe('0');
  });

  it('CNT-03 o marcador usa texto formatado, fonte fixa e fica abaixo da figura', () => {
    const fonte = readFileSync('src/components/mapa/useMapRenderer.jsx', 'utf8');
    expect(FONTE_CONTAGEM_PX).toBe(10);
    expect(fonte).toMatch(/entry\.badge\.textContent = formatarContagem\(totalCabecas\)/);
    expect(fonte).toMatch(/top:69%;[^`]*color:#6b7280;font-size:\$\{FONTE_CONTAGEM_PX\}px/);
    expect(fonte).not.toMatch(/badge\.style\.fontSize/);
  });

  it('CNT-04 rótulo de área (nome e hectares) sem sombra no texto', () => {
    for (const arq of ['src/components/mapa/useMapRenderer.jsx', 'src/components/mapa/MapaDesenho.jsx', 'src/components/mapa/SelecaoAreasMapa.jsx']) {
      const fonte = readFileSync(arq, 'utf8');
      expect(fonte).not.toMatch(/el\.style\.textShadow/);
      expect(fonte).not.toMatch(/mg-area-label[\s\S]{0,200}text-shadow/);
    }
  });
});
