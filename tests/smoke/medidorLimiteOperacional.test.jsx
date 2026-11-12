/**
 * D-PROD-178 — `MedidorLimiteOperacional`: barra acessível do uso do limite
 * operacional (cocho e depósito).
 *
 *  - `role="meter"` com `aria-valuenow` BRUTO (166,67 — sem limitar a 100) e
 *    `aria-valuetext` com o texto que a tela mostra;
 *  - preenchimento VISUAL nunca passa de 100% (nem fica negativo);
 *  - o valor bruto aparece como TEXTO visível ("166,67%"), fora da barra;
 *  - variante explícita ou derivada do valor: normal (≤ 100), excesso (> 100),
 *    neutro (sem valor) — o neutro não finge medir nada (sem role meter);
 *  - rótulo e descrição ligados por `aria-labelledby`/`aria-describedby`.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import MedidorLimiteOperacional from '@/components/mapa/MedidorLimiteOperacional';

afterEach(cleanup);

const preenchimento = (container) => container.querySelector('[data-medidor-preenchimento]');

describe('MedidorLimiteOperacional', () => {
  it('acima do limite: valor bruto no texto e no aria-valuenow, barra cheia em 100%', () => {
    const { container } = render(
      <MedidorLimiteOperacional percentualBruto={500 / 3} rotulo="Uso do limite operacional" descricao="de 120 kg · 80 kg acima do limite" />,
    );
    const medidor = screen.getByRole('meter', { name: 'Uso do limite operacional' });
    expect(medidor.getAttribute('aria-valuenow')).toBe('166.67');
    expect(medidor.getAttribute('aria-valuemin')).toBe('0');
    expect(Number(medidor.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(166.67);
    expect(medidor.getAttribute('aria-valuetext')).toBe('166,67% de 120 kg · 80 kg acima do limite');
    expect(screen.getByText('166,67%')).toBeTruthy();
    expect(screen.getByText('de 120 kg · 80 kg acima do limite')).toBeTruthy();
    expect(preenchimento(container).style.width).toBe('100%');
    expect(medidor.getAttribute('data-variante')).toBe('excesso');
    expect(medidor.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(medidor.getAttribute('aria-describedby')).textContent).toBe('de 120 kg · 80 kg acima do limite');
  });

  it('dentro do limite: preenchimento proporcional e variante normal', () => {
    const { container } = render(<MedidorLimiteOperacional percentualBruto={75} rotulo="Uso do limite operacional" descricao="de 120 kg" />);
    const medidor = screen.getByRole('meter');
    expect(medidor.getAttribute('aria-valuenow')).toBe('75');
    expect(medidor.getAttribute('aria-valuemax')).toBe('100');
    expect(medidor.getAttribute('data-variante')).toBe('normal');
    expect(preenchimento(container).style.width).toBe('75%');
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('exatamente 100% é normal; valor negativo não preenche ao contrário', () => {
    const { container, rerender } = render(<MedidorLimiteOperacional percentualBruto={100} rotulo="Uso" />);
    expect(screen.getByRole('meter').getAttribute('data-variante')).toBe('normal');
    expect(preenchimento(container).style.width).toBe('100%');
    rerender(<MedidorLimiteOperacional percentualBruto={-5} rotulo="Uso" />);
    expect(preenchimento(container).style.width).toBe('0%');
    expect(screen.getByRole('meter').getAttribute('aria-valuemin')).toBe('0');
  });

  it('variante explícita prevalece sobre a derivada', () => {
    render(<MedidorLimiteOperacional percentualBruto={50} rotulo="Uso" variante="excesso" />);
    expect(screen.getByRole('meter').getAttribute('data-variante')).toBe('excesso');
  });

  it('sem valor (limite não configurado): neutro, sem role meter, mensagem visível', () => {
    const { container } = render(
      <MedidorLimiteOperacional percentualBruto={null} rotulo="Uso do limite operacional" descricao="Limite operacional não configurado." />,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Uso do limite operacional')).toBeTruthy();
    expect(screen.getByText('Limite operacional não configurado.')).toBeTruthy();
    expect(container.querySelector('[data-variante="neutro"]')).not.toBeNull();
    expect(preenchimento(container).style.width).toBe('0%');
    expect(container.textContent).not.toMatch(/\d%/);
  });

  it('valor não finito é tratado como sem valor', () => {
    render(<MedidorLimiteOperacional percentualBruto={Number.NaN} rotulo="Uso" descricao="Sem estimativa." />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Sem estimativa.')).toBeTruthy();
  });
});
