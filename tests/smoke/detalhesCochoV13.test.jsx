// @vitest-environment jsdom
/**
 * Detalhe do COCHO v13 (redesenho aprovado pelo dono, mesmas regras do Detalhes do Lote v13):
 * as contas puras das barras e réguas novas e o cartão curto do histórico do cocho.
 *
 *  C13-1. barraDoCiclo: do lançamento até o fim estimado, hoje marcado (0–100, preso nas pontas).
 *  C13-2. reguaDoConsumoPorCabeca: mínimo, ideal e máximo na mesma escala; texto acessível.
 *  C13-3. larguraDaBarra: 0–100; fora de número, null.
 *  C13-4. LinhaDoTempo compacto com `sub` e `destaque` prontos (cocho): subtítulo, kg e sacos
 *         à direita; as linhas ficam como estão; cartões sem esses campos não mudam.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { barraDoCiclo, larguraDaBarra, reguaDoConsumoPorCabeca } from '@/components/mapa/cochoV13';
import LinhaDoTempo, { resumoDoCartao } from '@/components/mapa/detalhes-lote/LinhaDoTempo';

afterEach(() => cleanup());

describe('C13-1 — barraDoCiclo', () => {
  it('fração do ciclo já passada, datas dd/mm e o texto', () => {
    const b = barraDoCiclo({ inicio: '2026-11-10', hoje: '2026-11-12', fim: '2026-11-14' });
    expect(b).toEqual({ decorrido: 50, inicio: '10/11', fim: '14/11', texto: 'Lançado em 10/11; acaba por volta de 14/11; restam 2 dias' });
    expect(barraDoCiclo({ inicio: '2026-11-10', hoje: '2026-11-13', fim: '2026-11-14' })?.texto).toMatch(/resta 1 dia$/);
  });
  it('presa nas pontas; sem datas ou fim antes do início: null', () => {
    expect(barraDoCiclo({ inicio: '2026-11-10', hoje: '2026-11-20', fim: '2026-11-14' })?.decorrido).toBe(100);
    expect(barraDoCiclo({ inicio: '2026-11-10', hoje: '2026-11-01', fim: '2026-11-14' })?.decorrido).toBe(0);
    expect(barraDoCiclo({ inicio: null, hoje: '2026-11-12', fim: '2026-11-14' })).toBeNull();
    expect(barraDoCiclo({ inicio: '2026-11-14', hoje: '2026-11-12', fim: '2026-11-10' })).toBeNull();
  });
});

describe('C13-2 — reguaDoConsumoPorCabeca', () => {
  it('escala até 125% do maior; zona entre mínimo e máximo; marca no ideal', () => {
    const r = reguaDoConsumoPorCabeca({ minimo: 0.06, ideal: 0.075, maximo: 0.11 });
    expect(r?.maximo?.pos).toBeCloseTo(80, 6);
    expect(r?.minimo?.pos).toBeCloseTo((0.06 / 0.1375) * 100, 6);
    expect(r?.ideal?.pos).toBeCloseTo((0.075 / 0.1375) * 100, 6);
    expect(r?.zona).toEqual({ inicio: r?.minimo?.pos, fim: r?.maximo?.pos });
    expect(r?.texto).toBe('Consumo por cabeça por dia: mínimo 0,060 kg, ideal 0,075 kg, máximo 0,110 kg');
  });
  it('só o ideal: sem zona; nenhum valor: null', () => {
    const r = reguaDoConsumoPorCabeca({ minimo: null, ideal: 0.075, maximo: undefined });
    expect(r?.zona).toBeNull();
    expect(r?.ideal?.pos).toBeCloseTo(80, 6);
    expect(r?.texto).toBe('Consumo por cabeça por dia: ideal 0,075 kg');
    expect(reguaDoConsumoPorCabeca({ minimo: 0, ideal: null, maximo: '' })).toBeNull();
  });
});

describe('C13-3 — larguraDaBarra', () => {
  it('presa em 0–100', () => {
    expect(larguraDaBarra(46.67)).toBe(46.67);
    expect(larguraDaBarra(125)).toBe(100);
    expect(larguraDaBarra(-3)).toBe(0);
    expect(larguraDaBarra(null)).toBeNull();
  });
});

describe('C13-4 — cartão curto do cocho no histórico', () => {
  const cartao = {
    chave: 'ev-1',
    titulo: 'Fechamento de período',
    sub: 'SAL MINERAL 80 · Período fechado (13 dia(s))',
    destaque: { texto: '200 kg', sub: '8,00 sacos', tom: 'neutro', rotulo: 'Quantidade: 200 kg, 8,00 sacos' },
    linhas: [{ rotulo: 'Sobra (kg)', valor: '10,00' }],
  };
  it('usa o subtítulo e o destaque do próprio cartão e deixa as linhas como estão', () => {
    expect(resumoDoCartao(cartao)).toEqual({ lote: cartao.sub, destaque: cartao.destaque, rota: null, resto: cartao.linhas });
    // Cartão sem `sub`/`destaque` (pasto) segue a regra das linhas.
    expect(resumoDoCartao({ titulo: 'Movimentação · entrada', icone: 'movimentacao', linhas: [{ rotulo: 'Cabeças', valor: '2' }] }).destaque?.texto).toBe('+2 cab');
  });
  it('desenha kg e sacos à direita, o subtítulo embaixo do título e a sobra como linha', () => {
    render(
      <div className="mk-dp">
        <LinhaDoTempo compacto rotulo="Lançamentos do cocho" dias={[{ chave: 'd1', rotulo: '09 NOV. 2026', cartoes: [cartao] }]} />
      </div>,
    );
    const item = within(screen.getByRole('list', { name: 'Lançamentos do cocho' })).getAllByRole('listitem')[1];
    const qtd = /** @type {HTMLElement} */ (item.querySelector('.mk-dp-tl__qtd'));
    expect(qtd.getAttribute('aria-label')).toBe('Quantidade: 200 kg, 8,00 sacos');
    expect(qtd.textContent).toBe('200 kg8,00 sacos');
    expect(item.querySelector('.mk-dp-tl__lote')?.textContent).toBe('Lote: SAL MINERAL 80 · Período fechado (13 dia(s))');
    expect(within(item).getByText('Sobra (kg)').nextElementSibling?.textContent).toBe('10,00');
  });
});
