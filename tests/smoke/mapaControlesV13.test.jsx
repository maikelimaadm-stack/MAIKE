// @vitest-environment jsdom
/**
 * D-PROD-285 — controles do Mapa Geral v13 (aprovados pelo proprietário):
 *  MC-1. faixa branca acima do mapa com UM trilho: Filtros (só ícone) · Lotes · Pontos ·
 *        Visualização (só ícone), nessa ordem, com rótulos acessíveis;
 *  MC-2. Lotes/Pontos com aria-pressed no foco atual; o toque troca o foco;
 *  MC-3. Atualizar · Minha localização · Mover numa pílula em pé (fora da faixa);
 *  MC-4. o CSS v13 vale nos três tamanhos (celular, tablet, computador) com o
 *        controle de 36 px dentro de 3 px e a pílula/resumo embaixo.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('@/components/mapa/MapaFiltrosPainel', () => ({ default: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null) }));
const { default: MapaControlesMobile } = await import('@/components/mapa/MapaControlesMobile');

afterEach(cleanup);

const montar = (props = {}) => render(
  <div className="mk-mapa mk-mapa--v13">
    <MapaControlesMobile mapType="roadmap" setMapType={() => {}} onRefresh={() => {}} onLocate={() => {}} onToggleDrag={() => {}}
      focosPermitidos={['lotes', 'pastos']} foco="lotes" showLocalizarButton showMoverButton {...props} />
  </div>,
);

describe('MC-1 — faixa com um trilho', () => {
  it('Filtros · Lotes · Pontos · Visualização, na ordem, dentro da faixa branca', () => {
    montar();
    const faixa = /** @type {HTMLElement} */ (document.querySelector('.mk-mapa-faixa'));
    expect(faixa).not.toBeNull();
    const barra = within(faixa).getByRole('toolbar', { name: 'Mapa' });
    const nomes = within(barra).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent);
    expect(nomes).toEqual(['Filtros', 'Lotes', 'Pontos', 'Visualização do mapa: Mapa']);
    // Filtro e Visualização só com ícone (sem texto visível).
    expect(within(barra).getByRole('button', { name: 'Filtros' }).textContent).toBe('');
    expect(within(barra).getByRole('button', { name: /Visualização do mapa/ }).textContent).toBe('');
  });
});

describe('MC-2 — foco Lotes/Pontos', () => {
  it('aria-pressed no foco atual e o toque troca', () => {
    const onFoco = vi.fn();
    montar({ onFoco });
    expect(screen.getByRole('button', { name: 'Lotes' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pontos' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Pontos' }));
    expect(onFoco).toHaveBeenCalledWith('pastos');
  });
});

describe('MC-3 — pílula em pé', () => {
  it('Atualizar, Minha localização e Mover juntos, fora da faixa; arrasto ligado fica destacado', () => {
    montar({ dragEnabled: true });
    const pilha = /** @type {HTMLElement} */ (document.querySelector('.mk-mapa-dir .mk-mapa-pilha'));
    expect(pilha.closest('.mk-mapa-faixa')).toBeNull();
    const nomes = within(pilha).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(nomes).toEqual(['Atualizar mapa', 'Minha localização', 'Arrasto ativo']);
    expect(within(pilha).getByRole('button', { name: 'Arrasto ativo' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('MC-4 — CSS v13 nos três tamanhos', () => {
  const css = fs.readFileSync(path.resolve('src/styles/mapa-controles-v13.css'), 'utf8');
  it('controle de 36 px em trilho de 3 px; pílula vertical e resumo embaixo', () => {
    expect(css).toMatch(/--mk13-botao:\s*36px/);
    expect(css).toMatch(/--mk13-folga:\s*3px/);
    expect(css).toMatch(/\.mk-mapa-dir \.mk13-pilha[^{]*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.mk-mapa-dir:not[^{]*\{[^}]*bottom:/);
    expect(css).toMatch(/\.mk-mapa-resumo:not[^{]*\{[^}]*bottom:/);
  });
  it('celular: trilho na largura toda; tablet: 290 px; computador: 300 px', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?width:\s*100%/);
    expect(css).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*?width:\s*290px/);
    expect(css).toMatch(/width:\s*300px/);
  });
});
