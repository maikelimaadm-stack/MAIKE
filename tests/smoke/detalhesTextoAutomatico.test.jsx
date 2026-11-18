// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Celula, Grade } from '@/components/mapa/detalhes-lote/blocos';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('passa apenas o texto que não cabe e para quando o espaço aumenta, mantendo o texto completo', () => {
  let largura = 80;
  let redimensionar = () => {};
  const desconectar = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => largura);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () { return this.textContent.length * 8; });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { redimensionar = callback; }
    observe() {}
    disconnect() { desconectar(); }
  });
  const { container, unmount } = render(<div className="mk-dp"><Grade><Celula rotulo="Rótulo longo para leitura" valor="12 kg" /></Grade></div>);
  const rotulo = container.querySelector('dt .mk-dp-texto-auto');
  const valor = container.querySelector('dd .mk-dp-texto-auto');
  expect(rotulo.classList.contains('is-longo')).toBe(true);
  expect(rotulo.getAttribute('tabindex')).toBe('0');
  expect(rotulo.textContent).toBe('Rótulo longo para leitura');
  expect(valor.classList.contains('is-longo')).toBe(false);
  act(() => { largura = 500; redimensionar(); window.dispatchEvent(new Event('resize')); });
  expect(rotulo.classList.contains('is-longo')).toBe(false);
  expect(rotulo.hasAttribute('tabindex')).toBe(false);
  unmount();
  expect(desconectar).toHaveBeenCalled();
});
