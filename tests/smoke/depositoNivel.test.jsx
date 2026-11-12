/**
 * Nível do DEPÓSITO no mapa e no detalhe (D-PROD-178).
 *
 * O percentual do depósito é o saldo em kg sobre o LIMITE OPERACIONAL
 * (`capacidade_cocho_kg`), bruto: pode passar de 100% e aparece como número
 * fora do ícone; o ícone (mapa e detalhe) preenche só até 100%. O estoque
 * mínimo é um LIMIAR independente (acima/abaixo, margem em kg): nunca é
 * divisor nem teto do percentual. Antes (D-PROD-176) o nível era saldo ÷ mínimo
 * e o texto dizia "% do mínimo".
 */
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DepositoNivel from '@/components/mapa/DepositoNivel';
import { resolverIconeSuplementacao } from '@/lib/maplibre/mapaGeralRender';
import { criarSvgDeposito } from '@/assets/icones/deposito-sal';
import { calcularNivelDeposito } from '@/domain/suplementacao/nivelSuplementacao';
afterEach(cleanup);
const xml = (s) => new DOMParser().parseFromString(s, 'image/svg+xml');

const RACAO = { id: 'pr-racao', unidade_principal_estoque: 'KG' };
/** Nível do SSOT para um depósito com `saldo` kg de ração. */
const nivelDe = ({ saldo, limite = null, minimo = null }) => calcularNivelDeposito({
  deposito: { id: 'dep', local_estoque_id: 'loc', capacidade_cocho_kg: limite, estoque_minimo_kg: minimo },
  estoqueLotes: saldo > 0 ? [{ id: 'l1', local_estoque_id: 'loc', produto_id: RACAO.id, quantidade_disponivel: saldo }] : [],
  produtos: [RACAO],
});
/** SVG do ícone do detalhe (o mesmo desenho do marcador). */
const iconeDe = (container) => xml(decodeURIComponent(container.querySelector('img[data-deposito-icone]').src.split(',')[1]));
const medidorLimite = () => screen.getByRole('meter', { name: 'Ocupação do limite operacional' });
const painelMinimo = () => screen.getByRole('group', { name: 'Estoque mínimo' });

describe('Depósito com nível pelo limite operacional', () => {
  it('mostra no mapa o mesmo nível do subícone e preserva a moldura do cocho', () => {
    const { iconUrl } = resolverIconeSuplementacao({ categoria_ponto: 'DEPÓSITO', indicador_percentual: .5 });
    const mapa = xml(decodeURIComponent(iconUrl.split(',')[1]));
    expect(mapa.querySelector('parsererror')).toBeNull();
    expect(mapa.querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('50');
    expect(mapa.querySelector('svg > path').getAttribute('stroke')).toBe('#bbb7b7');
    // 500 kg de um limite de 1000 kg: 50% no medidor e no subícone.
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 500, limite: 1000, minimo: 1000 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('50');
    expect(medidorLimite().getAttribute('aria-valuetext')).toBe('50% de 1.000 kg · dentro do limite');
    expect(screen.getByText('50%')).toBeTruthy();
    const sub = iconeDe(container);
    expect(sub.querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('50');
    expect(sub.getElementById('corpo').getAttribute('stroke')).toBe('#a6afb6');
    // Nada de "% do mínimo": o mínimo não é o divisor.
    expect(container.textContent).not.toMatch(/% do (estoque )?mínimo/);
  });

  it('acima do limite: percentual bruto fora do ícone, ícone cheio e excesso em kg', () => {
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 2000, limite: 1000 })} />);
    expect(screen.getByText('200%')).toBeTruthy();
    expect(screen.getByText('de 1.000 kg · 1.000 kg acima do limite')).toBeTruthy();
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('200');
    expect(medidorLimite().getAttribute('data-variante')).toBe('excesso');
    // Preenchimento gráfico ≤ 100%: barra e ícone cheios, número bruto no texto.
    expect(container.querySelector('[data-medidor-preenchimento]').style.width).toBe('100%');
    expect(iconeDe(container).querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('100');
  });

  it('sem limite operacional: sem percentual, ícone vazio e mensagem', () => {
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 500, limite: 0, minimo: null })} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Limite operacional não configurado; não há percentual.')).toBeTruthy();
    expect(iconeDe(container).querySelector('[data-deposito-nivel]')).toBeNull();
    expect(container.textContent).not.toMatch(/\d%/);
    expect(within(painelMinimo()).getByText('Estoque mínimo não configurado.')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('nao_configurado');
  });

  it('estoque mínimo é limiar independente: acima/abaixo com margem em kg, sem mudar o percentual', () => {
    const { rerender } = render(<DepositoNivel nivel={nivelDe({ saldo: 150, limite: 300, minimo: 100 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('50');
    expect(within(painelMinimo()).getByText('Mínimo 100 kg · 50 kg acima do mínimo')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('acima');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 90, limite: 300, minimo: 100 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('30');
    expect(within(painelMinimo()).getByText('Mínimo 100 kg · abaixo do mínimo (faltam 10 kg)')).toBeTruthy();
    expect(within(painelMinimo()).getByText('Reposição recomendada.')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('abaixo');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 100, limite: 300, minimo: 100 })} />);
    expect(within(painelMinimo()).getByText('Mínimo 100 kg · no mínimo')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('no_minimo');

    // Mínimo acima do limite não vira teto nem divisor: o percentual é o mesmo.
    rerender(<DepositoNivel nivel={nivelDe({ saldo: 150, limite: 300, minimo: 1000 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('50');
    expect(within(painelMinimo()).getByText('Mínimo 1.000 kg · abaixo do mínimo (faltam 850 kg)')).toBeTruthy();
  });

  it('avisa quando a unidade de algum lote não está confirmada e quando há produto em litros fora do kg', () => {
    const nivel = calcularNivelDeposito({
      deposito: { id: 'dep', local_estoque_id: 'loc', capacidade_cocho_kg: 300 },
      estoqueLotes: [
        { id: 'l1', local_estoque_id: 'loc', produto_id: 'pr-desconhecido', quantidade_disponivel: 100 },
        { id: 'l2', local_estoque_id: 'loc', produto_id: 'pr-diesel', quantidade_disponivel: 5000 },
      ],
      produtos: [{ id: 'pr-diesel', unidade_principal_estoque: 'L' }],
    });
    render(<DepositoNivel nivel={nivel} />);
    expect(screen.getByText('Unidade de alguns produtos não confirmada; o saldo em kg pode incluir itens de outra unidade.')).toBeTruthy();
    expect(screen.getByText('Produtos em litros ficam fora do saldo em kg e do percentual.')).toBeTruthy();
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('33.33');
  });

  it('o vazio não contém produto e os SVGs são independentes, sem pontos nem recursos externos', () => {
    const vazio = xml(criarSvgDeposito(0));
    expect(vazio.querySelector('[data-deposito-nivel]')).toBeNull();
    expect(vazio.querySelector('[data-deposito-sacos]')).toBeNull();
    const cheio = xml(criarSvgDeposito(1, true));
    expect(cheio.querySelector('parsererror')).toBeNull();
    expect(cheio.querySelector('[data-deposito-sacos]')).toBeNull();
    expect(cheio.querySelector('svg svg').getAttribute('width')).toBe('44');
    expect(cheio.querySelector('svg svg').getAttribute('height')).toBe('33');
    expect(cheio.getElementById('cintas')).toBeNull();
    expect(vazio.getElementById('cintas')).toBeNull();
    expect(cheio.querySelectorAll('circle, image, script')).toHaveLength(0);
    expect(cheio.getElementById('corpo').getAttribute('stroke-width')).toBe('5.5');
  });
});
