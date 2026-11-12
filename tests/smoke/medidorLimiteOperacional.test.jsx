/**
 * D-PROD-178 — `MedidorLimiteOperacional`: barra acessível do uso do limite
 * operacional (cocho e depósito).
 *
 *  - `role="meter"` com `aria-valuenow` BRUTO (166,67 — sem limitar a 100) e
 *    `aria-valuetext` com o texto que a tela mostra;
 *  - preenchimento VISUAL nunca passa de 100% (nem fica negativo);
 *  - o valor bruto aparece como TEXTO visível ("166,67%"), fora da barra;
 *  - variante explícita ou derivada do valor: normal (≤ 100), excesso (> 100),
 *    neutro (sem valor) — o neutro não finge medir nada (sem role meter) e não
 *    desenha a trilha cheia de um "0%": a trilha é tracejada, sem preenchimento,
 *    com a orientação do que fazer;
 *  - o leitor de tela ouve o número e a frase UMA vez: `aria-valuetext` traz a
 *    frase completa ("125% do limite operacional: 150 kg de 120 kg, 30 kg
 *    acima"); sem `aria-describedby` repetindo a descrição, e o número e a
 *    descrição visíveis ficam fora da árvore acessível (já estão no valuetext).
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
      <MedidorLimiteOperacional
        percentualBruto={500 / 3}
        rotulo="Uso do limite operacional"
        descricao="200 kg de 120 kg · 80 kg acima do limite"
        textoAcessivel="166,67% do limite operacional: 200 kg de 120 kg, 80 kg acima" />,
    );
    const medidor = screen.getByRole('meter', { name: 'Uso do limite operacional' });
    expect(medidor.getAttribute('aria-valuenow')).toBe('166.67');
    expect(medidor.getAttribute('aria-valuemin')).toBe('0');
    expect(Number(medidor.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(166.67);
    expect(medidor.getAttribute('aria-valuetext')).toBe('166,67% do limite operacional: 200 kg de 120 kg, 80 kg acima');
    expect(screen.getByText('166,67%')).toBeTruthy();
    expect(screen.getByText('200 kg de 120 kg · 80 kg acima do limite')).toBeTruthy();
    expect(preenchimento(container).style.width).toBe('100%');
    expect(medidor.getAttribute('data-variante')).toBe('excesso');
    // A frase já está no valuetext: nada de lê-la de novo.
    expect(medidor.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByText('166,67%').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('200 kg de 120 kg · 80 kg acima do limite').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('sem textoAcessivel, o valuetext junta número e descrição com ":" (sem números colados)', () => {
    render(<MedidorLimiteOperacional percentualBruto={75} rotulo="Uso" descricao="90 kg de 120 kg · dentro do limite" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('75%: 90 kg de 120 kg · dentro do limite');
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
      <MedidorLimiteOperacional
        percentualBruto={null}
        rotulo="Uso do limite operacional"
        descricao="Limite operacional não configurado."
        orientacao="Configure o limite operacional no cadastro do ponto." />,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Uso do limite operacional')).toBeTruthy();
    expect(screen.getByText('Limite operacional não configurado.')).toBeTruthy();
    expect(screen.getByText('Configure o limite operacional no cadastro do ponto.')).toBeTruthy();
    expect(container.querySelector('[data-variante="neutro"]')).not.toBeNull();
    // Neutro não parece "0%": trilha tracejada, sem preenchimento.
    expect(preenchimento(container)).toBeNull();
    expect(container.querySelector('[data-medidor-trilha="neutra"]')?.className).toMatch(/border-dashed/);
    expect(container.textContent).not.toMatch(/\d%/);
  });

  it('valor não finito é tratado como sem valor', () => {
    render(<MedidorLimiteOperacional percentualBruto={Number.NaN} rotulo="Uso" descricao="Sem estimativa." />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Sem estimativa.')).toBeTruthy();
  });
});
