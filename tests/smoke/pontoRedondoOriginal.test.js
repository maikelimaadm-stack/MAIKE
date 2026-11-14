import { describe, expect, it } from 'vitest';
import { REDONDO_ORIGINAL_SVG, ENCAIXE_FIGURA } from '@/assets/icones/pontos/redondo';
import { criarSvgCocho } from '@/assets/icones/cocho-descoberto';
import { criarSvgDeposito } from '@/assets/icones/deposito-sal';
const xml = svg => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('Moldura redonda independente para cocho e depósito', () => {
  it('usa o mesmo original e preserva ponteira, transformação, sombra e enquadramento', () => {
    const original = xml(REDONDO_ORIGINAL_SVG);
    for (const gerar of [criarSvgCocho, criarSvgDeposito]) {
      const doc = xml(gerar(.5, true));
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.getAttribute('viewBox')).toBe(original.documentElement.getAttribute('viewBox'));
      expect(doc.querySelector('[data-fundo-ponto] path').outerHTML).toBe(original.querySelector('path').outerHTML);
      expect(doc.querySelector('[data-fundo-ponto] defs').outerHTML).toBe(original.querySelector('defs').outerHTML);
      expect(doc.querySelector('[data-figura-ponto]').getAttribute('width')).toBe(String(ENCAIXE_FIGURA.width));
    }
  });
  it('mantém a moldura quando o nível muda e os subícones ficam sem moldura', () => {
    for (const gerar of [criarSvgCocho, criarSvgDeposito]) {
      const fundos = [0, .2, .5, 1].map(n => xml(gerar(n, true)).querySelector('[data-fundo-ponto]').outerHTML);
      expect(new Set(fundos).size).toBe(1);
      expect(xml(gerar(.5)).querySelector('[data-fundo-ponto]')).toBeNull();
    }
  });
});
