/**
 * D-PROD-221 — Farol de forragem no Mapa Geral.
 *  - domínio: a última medição do pasto decide (dia, depois hora do registro); mais de
 *    15 dias → cinza "sem medição recente"; no olho → mesma cor, mais clara, com 👁;
 *    régua sem situação → cinza; nunca medido → null / neutro; infraestrutura,
 *    reserva e APP ficam com a cor normal (null);
 *  - mapa: o modo de coloração "Forragem" existe e a legenda mostra os estados e o 👁.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  COR_FORRAGEM_SEM_MEDICAO, COR_FORRAGEM_VENCIDA, COR_SITUACAO_FORRAGEM, DIAS_VALIDADE_FORRAGEM,
  clarear, corForragemDaArea, farolForragemDaArea, farolForragemPorArea,
} from '@/domain/pastagem/farolForragem';
import { MODOS_COLORACAO } from '@/components/mapa/MapaFiltrosAvancados';
import MapaLegenda from '@/components/mapa/MapaLegenda';

const HOJE = '2026-11-17';
const med = (o) => ({ id: o.id, area_id: 'a1', data_medicao: '2026-11-10', created_date: '2026-11-10T10:00:00Z', metodo: 'REGUA', situacao: 'DESCANSO', ...o });

describe('farol de forragem — domínio', () => {
  it('a última medição decide: dia mais recente e, no mesmo dia, o registro mais recente', () => {
    const medicoes = [
      med({ id: '1', data_medicao: '2026-11-01', situacao: 'RAPADO' }),
      med({ id: '2', data_medicao: '2026-11-15', created_date: '2026-11-15T08:00:00Z', situacao: 'DESCANSO' }),
      med({ id: '3', data_medicao: '2026-11-15', created_date: '2026-11-15T17:00:00Z', situacao: 'PRONTO' }),
      med({ id: '4', area_id: 'outra', data_medicao: '2026-11-16', situacao: 'PASSOU' }),
    ];
    const f = farolForragemDaArea(medicoes, 'a1', HOJE);
    expect(f).toMatchObject({ situacao: 'PRONTO', metodo: 'REGUA', olho: false, data: '2026-11-15', dias: 2, vencida: false, cor: COR_SITUACAO_FORRAGEM.PRONTO, rotulo: 'Pronto' });
    const todos = farolForragemPorArea(medicoes, HOJE);
    expect(todos.a1.medicao.id).toBe('3');
    expect(todos.outra.situacao).toBe('PASSOU');
  });

  it('15 dias ainda vale; 16 vira cinza "sem medição recente"', () => {
    const quinze = farolForragemDaArea([med({ id: 'x', data_medicao: '2026-11-02', situacao: 'RAPADO' })], 'a1', HOJE);
    expect(quinze).toMatchObject({ dias: DIAS_VALIDADE_FORRAGEM, vencida: false, cor: COR_SITUACAO_FORRAGEM.RAPADO });
    const dezesseis = farolForragemDaArea([med({ id: 'y', data_medicao: '2026-11-01', situacao: 'RAPADO' })], 'a1', HOJE);
    expect(dezesseis).toMatchObject({ dias: 16, vencida: true, cor: COR_FORRAGEM_VENCIDA, rotulo: 'Sem medição recente' });
  });

  it('no olho: mesma cor mais clara e marca 👁; régua sem situação fica cinza', () => {
    const olho = farolForragemDaArea([med({ id: 'o', metodo: 'OLHO', situacao: 'PRONTO' })], 'a1', HOJE);
    expect(olho.olho).toBe(true);
    expect(olho.cor).toBe(clarear(COR_SITUACAO_FORRAGEM.PRONTO));
    expect(olho.cor).not.toBe(COR_SITUACAO_FORRAGEM.PRONTO);
    expect(olho.rotulo).toBe('Pronto 👁');
    const semSituacao = farolForragemDaArea([med({ id: 's', situacao: null })], 'a1', HOJE);
    expect(semSituacao).toMatchObject({ vencida: false, cor: COR_FORRAGEM_VENCIDA });
  });

  it('nunca medido → null; no mapa, neutro; infraestrutura, reserva e APP ficam com a cor normal', () => {
    expect(farolForragemDaArea([], 'a1', HOJE)).toBeNull();
    const farois = farolForragemPorArea([med({ id: '1', situacao: 'PASSOU' })], HOJE);
    expect(corForragemDaArea({ id: 'a1', tipo_cultura: 'Pastagem' }, farois)).toBe(COR_SITUACAO_FORRAGEM.PASSOU);
    expect(corForragemDaArea({ id: 'a2', tipo_cultura: 'Pastagem' }, farois)).toBe(COR_FORRAGEM_SEM_MEDICAO);
    for (const uso of ['Infraestrutura', 'Reserva', 'APP']) expect(corForragemDaArea({ id: 'a1', tipo_cultura: uso }, farois)).toBeNull();
  });

  it('dia de hoje inválido não quebra: farol cinza', () => {
    expect(farolForragemDaArea([med({ id: '1' })], 'a1', null)).toMatchObject({ dias: null, vencida: true, cor: COR_FORRAGEM_VENCIDA });
  });
});

describe('farol de forragem — mapa', () => {
  it('o modo de coloração "Forragem" existe no painel Visualização', () => {
    expect(MODOS_COLORACAO.find((m) => m.id === 'forragem')?.label).toBe('Forragem');
  });

  it('a legenda mostra os 4 estados, sem medição recente, nunca medido e o 👁', () => {
    render(<MapaLegenda modoColoracao="forragem" categoriasGadoCores={{}} tiposPastagemCores={{}} />);
    const legenda = screen.getByTestId('mapa-legenda');
    for (const t of ['Forragem', 'Rapado', 'Descanso', 'Pronto', 'Passou do ponto', 'Sem medição recente (> 15 dias)', 'Nunca medido']) expect(legenda.textContent).toContain(t);
    expect(screen.getByTestId('legenda-forragem-olho').textContent).toContain('👁');
  });

  it('fora do modo "Forragem" a legenda não muda', () => {
    render(<MapaLegenda modoColoracao="padrao" categoriasGadoCores={{}} tiposPastagemCores={{}} />);
    expect(screen.queryByTestId('mapa-legenda')).toBeNull();
  });
});
