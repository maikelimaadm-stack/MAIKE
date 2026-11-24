/**
 * Nível do DEPÓSITO no mapa e no detalhe (D-PROD-178).
 *
 * O percentual do depósito é o saldo em kg sobre o LIMITE OPERACIONAL
 * (`capacidade_cocho_kg`), bruto: pode passar de 100% e aparece como número
 * fora do ícone; o ícone (mapa e detalhe) preenche só até 100%. O estoque
 * mínimo é um LIMIAR independente (acima/abaixo, margem em kg): nunca é
 * divisor nem teto do percentual. Antes (D-PROD-176) o nível era saldo ÷ mínimo
 * e o texto dizia "% do mínimo".
 *
 * D-PROD-220 (desenho do Detalhes do Lote v12): o percentual bruto é o número
 * grande do bloco do nível. D-PROD-227: aparece uma vez na tela; o medidor
 * mantém o percentual e a descrição acessíveis, sem repetir o número.
 *
 * v13 (desenho aprovado do depósito): o saldo fica sozinho ao lado do ícone; a régua 0 → limite
 * (role="meter", o mesmo valor acessível) traz o mínimo e o saldo; o mínimo vira a caixa "Estoque
 * mínimo" (Acima do mínimo / No mínimo / Abaixo do mínimo / não configurado).
 *
 * D-PROD-225: no detalhe, o ícone é o SUBÍCONE do depósito (o desenho dos
 * detalhes, sem o pino do mapa, nas cores configuradas para o subícone); o
 * marcador (pino + silo) fica só no mapa.
 */
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DepositoNivel, { reguaDoDeposito } from '@/components/mapa/DepositoNivel';
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
/** SVG do ícone do detalhe (o subícone: o desenho dos detalhes, sem o pino do mapa). */
const iconeDe = (container) => xml(decodeURIComponent(container.querySelector('img[data-deposito-icone]').src.split(',')[1]));
const medidorLimite = () => screen.getByRole('meter', { name: 'Ocupação do limite operacional' });
const painelMinimo = () => screen.getByRole('group', { name: 'Estoque mínimo' });
/** Percentual visível uma vez; o role=meter conserva o valor acessível. */
const percentualVisivel = (texto) => {
  expect(within(screen.getByTestId('nivel-do-deposito')).getByText(texto)).toBeTruthy();
  expect(screen.getAllByText(texto)).toHaveLength(1);
};

describe('Depósito com nível pelo limite operacional', () => {
  it('mostra no mapa e no detalhe o mesmo nível: o marcador (pino + silo) no mapa e o subícone no detalhe', () => {
    const { iconUrl } = resolverIconeSuplementacao({ categoria_ponto: 'DEPÓSITO', indicador_percentual: .5 });
    const mapa = xml(decodeURIComponent(iconUrl.split(',')[1]));
    expect(mapa.querySelector('parsererror')).toBeNull();
    expect(mapa.querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('50');
    expect(mapa.querySelector('[data-fundo-ponto] path').getAttribute('stroke')).toBe('#bbb7b7');
    // 500 kg de um limite de 1000 kg: 50% no medidor e no subícone.
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 500, limite: 1000, minimo: 1000 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('50');
    expect(medidorLimite().getAttribute('aria-valuetext')).toBe('50% do limite operacional: 500 kg de 1.000 kg, dentro do limite');
    // Dentro do limite, sem a linha de excesso embaixo da régua.
    expect(container.querySelector('.mk-dp-dep13__excesso')).toBeNull();
    percentualVisivel('50%');
    const sub = iconeDe(container);
    expect(sub.querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('50');
    // D-PROD-225: o bloco do nível usa o subícone (como o cocho): sem o pino do mapa, no contorno do subícone.
    expect(sub.querySelector('[data-fundo-ponto]')).toBeNull();
    expect(sub.documentElement.getAttribute('viewBox')).toBe('0 0 252 185');
    expect(sub.getElementById('corpo').getAttribute('stroke')).toBe('#a6afb6');
    expect(new XMLSerializer().serializeToString(sub)).toBe(new XMLSerializer().serializeToString(xml(criarSvgDeposito(0.5))));
    // Nada de "% do mínimo": o mínimo não é o divisor.
    expect(container.textContent).not.toMatch(/% do (estoque )?mínimo/);
  });

  it('acima do limite: percentual bruto fora do ícone, ícone cheio e excesso em kg', () => {
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 2000, limite: 1000 })} />);
    percentualVisivel('200%');
    expect(screen.getByText('2.000 kg de 1.000 kg · 1.000 kg acima do limite')).toBeTruthy();
    expect(medidorLimite().getAttribute('aria-valuetext')).toBe('200% do limite operacional: 2.000 kg de 1.000 kg, 1.000 kg acima');
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('200');
    expect(medidorLimite().getAttribute('data-variante')).toBe('excesso');
    // Preenchimento gráfico ≤ 100%: barra e ícone cheios, número bruto no texto.
    expect(container.querySelector('[data-medidor-preenchimento]').style.width).toBe('100%');
    expect(iconeDe(container).querySelector('[data-deposito-nivel]').getAttribute('data-deposito-nivel')).toBe('100');
  });

  it('sem limite operacional: sem percentual, ícone vazio com rótulo neutro, mensagem e o que fazer', () => {
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 500, limite: 0, minimo: null })} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('Limite operacional não configurado; não há percentual.')).toBeTruthy();
    expect(screen.getByText('Configure o limite operacional no cadastro do ponto.')).toBeTruthy();
    // Sob o ícone, um rótulo neutro (como o cocho): o ícone vazio não é "depósito vazio".
    expect(container.querySelector('[data-deposito-rotulo-neutro]')?.textContent).toBe('Sem limite');
    expect(iconeDe(container).querySelector('[data-deposito-nivel]')).toBeNull();
    expect(container.textContent).not.toMatch(/\d%/);
    expect(within(painelMinimo()).getByText('Estoque mínimo não configurado.')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('nao_configurado');
  });

  it('estoque mínimo é limiar independente: acima/abaixo com margem em kg, sem mudar o percentual', () => {
    const { rerender } = render(<DepositoNivel nivel={nivelDe({ saldo: 150, limite: 300, minimo: 100 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('50');
    expect(within(painelMinimo()).getByText('Acima do mínimo')).toBeTruthy();
    expect(within(painelMinimo()).getByText('50 kg')).toBeTruthy();
    expect(within(painelMinimo()).getByText('mínimo de 100 kg')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('acima');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 90, limite: 300, minimo: 100 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('30');
    expect(within(painelMinimo()).getByText('Abaixo do mínimo')).toBeTruthy();
    expect(within(painelMinimo()).getByText('10 kg')).toBeTruthy();
    expect(within(painelMinimo()).getByText('mínimo de 100 kg · Reposição recomendada.')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('abaixo');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 100, limite: 300, minimo: 100 })} />);
    expect(within(painelMinimo()).getByText('No mínimo')).toBeTruthy();
    expect(within(painelMinimo()).getByText('Reposição recomendada.')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('no_minimo');

    // Mínimo acima do limite não vira teto nem divisor: o percentual é o mesmo.
    rerender(<DepositoNivel nivel={nivelDe({ saldo: 150, limite: 300, minimo: 1000 })} />);
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('50');
    expect(within(painelMinimo()).getByText('850 kg')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('abaixo');
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
    expect(cheio.querySelector('svg svg').getAttribute('width')).toBe('64');
    expect(cheio.querySelector('svg svg').getAttribute('height')).toBe('47');
    expect(cheio.getElementById('cintas')).toBeNull();
    expect(vazio.getElementById('cintas')).toBeNull();
    expect(cheio.querySelectorAll('circle, image, script')).toHaveLength(0);
    expect(cheio.getElementById('corpo').getAttribute('stroke-width')).toBe('5.5');
  });
});

describe('v13 — régua 0 → limite e as duas caixas', () => {
  it('posições: saldo e mínimo em % do limite; acima do limite o saldo prende no fim', () => {
    const r = reguaDoDeposito(nivelDe({ saldo: 1400, limite: 2000, minimo: 500 }));
    expect([r.escalaKg, r.posSaldo, r.posMinimo, r.temLimite, r.excesso]).toEqual([2000, 70, 25, true, false]);
    const cheio = reguaDoDeposito(nivelDe({ saldo: 3000, limite: 2000 }));
    expect([cheio.posSaldo, cheio.excesso, cheio.posMinimo]).toEqual([100, true, null]);
  });

  it('o rótulo do saldo sobe quando encostaria no do mínimo ou no "limite" do fim; longe dos dois, fica embaixo', () => {
    // 1.400 de 2.000 (70%): perto do "limite 2.000 kg" do fim.
    expect(reguaDoDeposito(nivelDe({ saldo: 1400, limite: 2000, minimo: 500 })).saldoAcima).toBe(true);
    // 600 de 2.000 (30%) com mínimo 500 (25%): perto do mínimo.
    expect(reguaDoDeposito(nivelDe({ saldo: 600, limite: 2000, minimo: 500 })).saldoAcima).toBe(true);
    // 1.000 de 2.000 (50%) com mínimo 200 (10%): longe dos dois.
    expect(reguaDoDeposito(nivelDe({ saldo: 1000, limite: 2000, minimo: 200 })).saldoAcima).toBe(false);
    // Mínimo perto do fim: o rótulo dele sobe; o do saldo, longe, fica embaixo.
    const r = reguaDoDeposito(nivelDe({ saldo: 400, limite: 2000, minimo: 1800 }));
    expect([r.minimoAcima, r.saldoAcima]).toEqual([true, false]);
  });

  it('no DOM: o rótulo do saldo vai para a linha de cima quando sobe; a marca do mínimo e o "limite" ficam embaixo', () => {
    const { container } = render(<DepositoNivel nivel={nivelDe({ saldo: 1400, limite: 2000, minimo: 500 })} />);
    const regua = container.querySelector('.mk-dp-dep13__regua');
    expect(regua.getAttribute('data-saldo-acima')).toBe('true');
    expect(regua.querySelector('.mk-dp-dep13__rotulos--cima').textContent).toBe('1.400 kg');
    const baixo = [...regua.querySelectorAll('.mk-dp-dep13__rotulos:not(.mk-dp-dep13__rotulos--cima) > span')].map((e) => e.textContent);
    expect(baixo).toEqual(['mínimo 500 kg', 'limite 2.000 kg']);
    expect(regua.querySelector('[data-regua-minimo]').style.left).toBe('25%');
    expect(regua.querySelector('[data-regua-saldo]').style.left).toBe('70%');
    expect(medidorLimite().getAttribute('aria-valuenow')).toBe('70');
    expect(medidorLimite().getAttribute('aria-valuetext')).toBe('70% do limite operacional: 1.400 kg de 2.000 kg, dentro do limite');
  });

  it('sem limite: a régua vai até max(saldo, mínimo) × 1,25, sem percentual e com texto; sem saldo e sem mínimo, não há régua', () => {
    const r = reguaDoDeposito(nivelDe({ saldo: 400, limite: null, minimo: 800 }));
    expect([r.escalaKg, r.posSaldo, r.posMinimo, r.temLimite]).toEqual([1000, 40, 80, false]);
    const { container, unmount } = render(<DepositoNivel nivel={nivelDe({ saldo: 400, limite: null, minimo: 800 })} />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('img', { name: 'Saldo de 400 kg, mínimo de 800 kg; limite operacional não configurado.' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/limite \d/);
    unmount();
    expect(reguaDoDeposito(nivelDe({ saldo: 0, limite: null, minimo: null }))).toBeNull();
    const vazio = render(<DepositoNivel nivel={nivelDe({ saldo: 0, limite: null, minimo: null })} />);
    expect(vazio.container.querySelector('.mk-dp-dep13__regua')).toBeNull();
  });

  it('caixas: necessidade até o limite (com sacos), acima do limite e sem limite; mínimo acima, no mínimo e abaixo com o tom', () => {
    const caixa = (c, nome) => c.querySelector(`[data-caixa="${nome}"]`)?.textContent;
    const { container, rerender } = render(<DepositoNivel nivel={nivelDe({ saldo: 1400, limite: 2000, minimo: 500 })} necessidadeSacos={24} />);
    expect(caixa(container, 'necessidade')).toBe('Necessidade de reposição600 kg24,00 sacos · até o limite');
    expect(painelMinimo().textContent).toBe('Acima do mínimo900 kgmínimo de 500 kg');
    expect(painelMinimo().getAttribute('data-tom')).toBe('ok');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 2500, limite: 2000, minimo: 500 })} />);
    expect(caixa(container, 'necessidade')).toBe('Necessidade de reposição0 kg500 kg acima do limite');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 500, limite: 2000, minimo: 500 })} />);
    expect(painelMinimo().textContent).toBe('No mínimo500 kgReposição recomendada.');
    expect(painelMinimo().getAttribute('data-tom')).toBe('atencao');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 300, limite: 2000, minimo: 500 })} />);
    expect(painelMinimo().textContent).toBe('Abaixo do mínimo200 kgmínimo de 500 kg · Reposição recomendada.');
    expect(painelMinimo().getAttribute('data-tom')).toBe('perigo');

    rerender(<DepositoNivel nivel={nivelDe({ saldo: 300, limite: null, minimo: null })} />);
    expect(caixa(container, 'necessidade')).toBe('Necessidade de reposição—sem limite operacional');
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('nao_configurado');
  });

  it('o saldo é o único número do topo, numa linha (nowrap no CSS), sem a necessidade ao lado', () => {
    render(<DepositoNivel nivel={nivelDe({ saldo: 1400, limite: 2000, minimo: 500 })} saldoSacos={56} />);
    const topo = screen.getByTestId('nivel-do-deposito');
    expect(within(topo).getByText('Saldo atual').nextElementSibling?.textContent).toBe('1.400 kg');
    expect(within(topo).getByText('56,00 sacos')).toBeTruthy();
    expect(topo.textContent).not.toMatch(/Necessidade/);
  });
});
