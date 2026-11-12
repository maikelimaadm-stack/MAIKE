import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DepositoNivel from '@/components/mapa/DepositoNivel';
import { resolverIconeSuplementacao } from '@/lib/maplibre/mapaGeralRender';
import { criarSvgDeposito } from '@/assets/icones/deposito-sal';
afterEach(cleanup);
const xml = (s) => new DOMParser().parseFromString(s, 'image/svg+xml');

describe('Depósito com nível pelo mínimo', () => {
  it('mostra no mapa o mesmo nível do subícone e preserva a moldura do cocho', () => {
    const { iconUrl } = resolverIconeSuplementacao({ categoria_ponto: 'DEPÓSITO', indicador_percentual: .5 });
    const mapa = xml(decodeURIComponent(iconUrl.split(',')[1]));
    expect(mapa.querySelector('parsererror')).toBeNull();
    expect(mapa.querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('50');
    expect(mapa.querySelector('svg > path').getAttribute('stroke')).toBe('#bbb7b7');
    const { rerender } = render(<DepositoNivel percent={.5} estoqueMinimo={1000} />);
    expect(screen.getByRole('img').alt).toContain('50% do estoque mínimo');
    const sub = xml(decodeURIComponent(screen.getByRole('img').src.split(',')[1]));
    expect(sub.querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('50');
    expect(sub.getElementById('corpo').getAttribute('stroke')).toBe('#a6afb6');
    rerender(<DepositoNivel percent={1} estoqueMinimo={1000} saldoAtual={2000} />);
    expect(screen.getByText("200% do mínimo")).toBeTruthy();
    rerender(<DepositoNivel percent={0} estoqueMinimo={0} />);
    expect(screen.getByText('Defina o estoque mínimo')).toBeTruthy();
  });
  it('o vazio não contém produto e os SVGs são independentes, sem pontos nem recursos externos', () => {
    const vazio = xml(criarSvgDeposito(0));
    expect(vazio.querySelector('[data-deposito-nivel]')).toBeNull();
    expect(vazio.querySelector('[data-deposito-sacos]')).toBeNull();
    const cheio = xml(criarSvgDeposito(1, true));
    expect(cheio.querySelector('parsererror')).toBeNull();
    expect(cheio.querySelector('[data-deposito-sacos]')).not.toBeNull();
    expect(cheio.getElementById('corpo').getAttribute('stroke')).toBe(xml(criarSvgDeposito(1)).getElementById('corpo').getAttribute('stroke'));
    expect(cheio.getElementById('cintas')).toBeNull();
    expect(vazio.getElementById('cintas')).toBeNull();
    expect(cheio.querySelectorAll('circle, image, script')).toHaveLength(0);
    expect(cheio.getElementById('corpo').getAttribute('stroke-width')).toBe('5.5');
  });
});
