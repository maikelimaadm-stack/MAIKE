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

  it('CNT-03 o lote usa texto formatado, fonte fixa e fica abaixo da figura', () => {
    // D-PROD-348: a contagem é escrita na imagem do lote (canvas), não num elemento HTML.
    // O desenho em si é conferido em lotesNoMapaD348.test.jsx (L348-2).
    const fonte = readFileSync('src/lib/maplibre/lotesNoMapa.js', 'utf8');
    expect(FONTE_CONTAGEM_PX).toBe(9.5);
    expect(fonte).toMatch(/texto: formatarContagem\(cabecas\)/);
    // D-PROD-191: a altura é o centro da faixa do card reservada à contagem (motor do ícone).
    expect(fonte).toMatch(/import \{[^}]*\bCONTAGEM_TOPO_PCT\b[^}]*\} from "@\/assets\/icones\/lotes"/);
    expect(fonte).toMatch(/\(h \* CONTAGEM_TOPO_PCT\) \/ 100/);
    expect(fonte).toMatch(/ctx\.font = `700 \$\{FONTE_CONTAGEM_PX\}px \$\{FONTE_FAMILIA\}`;/);
    expect(fonte).toMatch(/ctx\.fillStyle = "#6b7280";/);
    expect(fonte).not.toMatch(/top:69%|0\.69/);
    // sem text-field do MapLibre: o estilo sem internet não tem fonte de letras
    expect(fonte).not.toMatch(/"text-field"/);
  });

  it('CNT-04 rótulo de área (nome e hectares) sem sombra no texto', () => {
    for (const arq of ['src/components/mapa/useMapRenderer.jsx', 'src/components/mapa/MapaDesenho.jsx', 'src/components/mapa/SelecaoAreasMapa.jsx']) {
      const fonte = readFileSync(arq, 'utf8');
      expect(fonte).not.toMatch(/el\.style\.textShadow/);
      expect(fonte).not.toMatch(/mg-area-label[\s\S]{0,200}text-shadow/);
    }
  });
});
