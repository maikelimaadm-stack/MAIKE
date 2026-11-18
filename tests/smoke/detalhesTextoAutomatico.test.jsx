// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Celula, Grade, Item } from '@/components/mapa/detalhes-lote/blocos';

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
  const { container, unmount } = render(<div className="mk-dp"><Grade><Celula textoAutomatico rotulo="Rótulo longo para leitura" valor="12 kg" /></Grade></div>);
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

it('texto automático dentro de um botão não cria foco extra e preserva a abertura do lote', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240);
  const abrir = vi.fn();
  const { container } = render(<div className="mk-dp"><ul><Item textoAutomatico titulo="Nome de lote comprido" meta="Informações completas do lote" onClick={abrir} /></ul></div>);
  const botao = container.querySelector('button');
  expect(botao.querySelectorAll('.mk-dp-texto-auto.is-longo')).toHaveLength(2);
  expect(botao.querySelector('[tabindex]')).toBeNull();
  fireEvent.click(botao);
  expect(abrir).toHaveBeenCalledTimes(1);
});

it('campos compartilhados preservam rótulo e valor diretos quando a passagem não está habilitada', () => {
  const { container } = render(<Grade><Celula rotulo="Saldo atual kg" valor="150 kg" /></Grade>);
  const dt = container.querySelector('dt');
  expect(dt.children).toHaveLength(0);
  expect(dt.nextElementSibling.textContent).toBe('150 kg');
});
