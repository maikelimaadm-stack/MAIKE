import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CochoNivel from '../../src/components/mapa/CochoNivel';
import { resolverIconeSuplementacao } from '../../src/lib/maplibre/mapaGeralRender';
afterEach(cleanup);
describe('Cocho com nível vetorial', () => {
  it('mostra o saldo calculado e recorta o alimento dentro do cocho', () => {
    const { container, rerender } = render(<CochoNivel percent={1} />);
    const cheio = container.querySelector('[data-cocho-nivel]').getAttribute('d');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('100%');
    rerender(<CochoNivel percent={300 / 350} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('86%');
    expect(container.querySelector('[data-cocho-nivel]').getAttribute('d')).not.toBe(cheio);
    expect(container.querySelector('[clip-path]')).not.toBeNull();
    rerender(<CochoNivel percent={0} />);
    expect(container.querySelector('[data-cocho-nivel]')).toBeNull();
  });
  it('limita valores fora da faixa e recusa nível não finito', () => {
    const { rerender } = render(<CochoNivel percent={2} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('100%');
    for (const percent of [-1, NaN, Infinity]) {
      rerender(<CochoNivel percent={percent} />);
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain('0%');
    }
  });
  it('mantém recortes independentes entre dois indicadores', () => {
    const { container } = render(<><CochoNivel percent={.2} /><CochoNivel percent={.8} /></>);
    const ids = [...container.querySelectorAll('clipPath')].map(e => e.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('Cocho no marcador do mapa', () => {
  it('leva o nível calculado ao marcador e deixa o vazio sem produto', () => {
    const svg = (percent) => {
      const { iconUrl } = resolverIconeSuplementacao({ categoria_ponto: 'COCHO', indicador_percentual: percent });
      return new DOMParser().parseFromString(decodeURIComponent(iconUrl.split(',')[1]), 'image/svg+xml');
    };
    const cheio = svg(1);
    const metade = svg(.5);
    const vazio = svg(0);
    expect(cheio.querySelector('parsererror')).toBeNull();
    expect(cheio.querySelector('svg > path').getAttribute('fill')).toBe('#fff');
    expect(cheio.querySelector('svg > path').getAttribute('stroke')).toBe('#bbb7b7');
    expect(cheio.querySelector('svg > path').getAttribute('stroke-width')).toBe('1');
    expect(cheio.querySelector('[clip-path]').getAttribute('d')).not.toBe(metade.querySelector('[clip-path]').getAttribute('d'));
    expect(vazio.querySelector('[clip-path]')).toBeNull();
    expect(vazio.querySelector('svg svg > path:last-child').getAttribute('stroke')).toBe('#65717a');
  });
});
