/**
 * D-PROD-178 — o cartão de métricas do lançamento (`CardMetricaEvento`) dá a
 * MESMA projeção no detalhe do cocho e no Histórico.
 *
 *  CM-1. ciclo aberto, sem as props do SSOT (o Histórico): duração = base ÷
 *        taxa SEM arredondar e próxima reposição = lançamento + ⌈base ÷ taxa⌉,
 *        a mesma regra de `calcularNivelCocho` (antes: duração arredondada e a
 *        reposição saía dela, um dia antes);
 *  CM-2. período fechado: a taxa gravada no evento (`consumo_esperado_pv_kg`)
 *        mostra o esperado × real (Desvio). A duração estimada usa a base do
 *        ciclo reconstituída pela fórmula do fechamento (consumo real × dias +
 *        sobra final = fornecido + sobra inicial), nunca fornecido + sobra
 *        FINAL;
 *  CM-3. `projecaoDoCartaoDoNivel`: no ciclo aberto a taxa e a projeção do SSOT
 *        (sem estimativa confiável → nada); fora dele, nada passa e o cartão usa
 *        o que ficou gravado no evento;
 *  CM-4. Histórico com o nível do detalhe: o ÚLTIMO evento sai com a projeção
 *        do SSOT (inclusive "não confiável" nos cochos compartilhados).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import CardMetricaEvento from '@/components/suplementacao/CardMetricaEvento';
import { calcularNivelCocho, projecaoDoCartaoDoNivel } from '@/domain/suplementacao/nivelSuplementacao';

const cache = vi.hoisted(() => ({ dados: {} }));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: async () => ({ email: 'operador@exemplo.test' }) }));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: async (chave) => cache.dados[chave] || [],
  refreshMapaCacheEntry: async (chave) => cache.dados[chave] || [],
  updateMapaCachedData: vi.fn(),
}));

const EMP = 'emp-1';
const COCHO = { id: 'c1', empresa_id: EMP, categoria_ponto: 'COCHO', status: 'Ativo', area_vinculada_ids: ['a1'], capacidade_cocho_kg: 120 };
const aberto = (extra = {}) => ({
  id: 'e1', empresa_id: EMP, ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-10', quantidade_total_kg: 200, sobra_kg: 0,
  dias_periodo: null, consumo_esperado_pv_kg: 45, produto: 'SAL', produto_id: 'p1', total_cabecas_afetadas: 10,
  created_date: '2026-11-10T12:00:00.000Z', ...extra,
});
// Fechado: 200 kg fornecidos, sem sobra inicial, 5 dias, sobra FINAL 30 → consumo real 34 kg/dia.
const fechado = (extra = {}) => aberto({
  id: 'e0', data_lancamento: '2026-11-03', dias_periodo: 5, sobra_kg: 30, consumo_diario_grupo_kg: 34,
  consumo_esperado_pv_kg: 50, total_cabecas_afetadas: 100, created_date: '2026-11-03T12:00:00.000Z', ...extra,
});

const valor = (raiz, rotulo) => within(raiz).getByText(rotulo).nextElementSibling?.textContent;

beforeEach(() => {
  localStorage.setItem('empresa_selecionada_id', EMP);
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe('CM-1 — ciclo aberto sem as props do SSOT', () => {
  it('duração sem arredondar e próxima reposição pela mesma regra do SSOT', () => {
    const evento = aberto();
    const nivel = calcularNivelCocho({ ponto: COCHO, eventos: [evento], hoje: '2026-11-11' });
    expect(nivel.dataEsgotamentoEstimada).toBe('2026-11-15');
    const { container } = render(<CardMetricaEvento evento={evento} showProjecao />);
    expect(valor(container, 'Duração estimada')).toBe('4,4 dia(s)');
    expect(valor(container, 'Próx. reposição')).toBe('15/11/2026');
    expect(valor(container, 'Consumo Lote PV/dia')).toBe('45,00 kg');
  });

  it('com sobra anterior, a base do ciclo é fornecido + sobra (como no SSOT)', () => {
    const evento = aberto({ quantidade_total_kg: 150, sobra_kg: 50, consumo_esperado_pv_kg: 50 });
    const { container } = render(<CardMetricaEvento evento={evento} showProjecao />);
    expect(valor(container, 'Duração estimada')).toBe('4 dia(s)');
    expect(valor(container, 'Próx. reposição')).toBe('14/11/2026');
  });
});

describe('CM-2 — período fechado', () => {
  it('esperado × real pela taxa gravada e duração pela base reconstituída (não fornecido + sobra final)', () => {
    const { container } = render(<CardMetricaEvento evento={fechado()} showProjecao />);
    expect(valor(container, 'Consumo Lote PV/dia')).toBe('50,00 kg');
    expect(valor(container, 'Esperado/cab/dia')).toBe('0,500 kg');
    expect(valor(container, 'Realizado cab/dia')).toBe('0,340 kg');
    expect(valor(container, 'Desvio')).toContain('-0,160 kg');
    // Base = 34 × 5 + 30 = 200 kg → 200 ÷ 50 = 4 dias (com 200 + 30 seriam 5).
    expect(valor(container, 'Duração estimada')).toBe('4 dia(s)');
    expect(valor(container, 'Diferença dia(s)')).toBe('-1 dia(s)');
    expect(valor(container, 'Fechamento')).toBe('5 dia(s)');
  });

  it('sem consumo real gravado não há base: duração e diferença ficam em branco', () => {
    const { container } = render(<CardMetricaEvento evento={fechado({ consumo_diario_grupo_kg: null })} showProjecao />);
    expect(valor(container, 'Consumo Lote PV/dia')).toBe('50,00 kg');
    expect(valor(container, 'Duração estimada')).toBe('-');
    expect(valor(container, 'Diferença dia(s)')).toBe('-');
  });
});

describe('CM-3 — projecaoDoCartaoDoNivel', () => {
  it('ciclo aberto estimado: taxa, duração e reposição do SSOT', () => {
    const nivel = calcularNivelCocho({ ponto: COCHO, eventos: [aberto()], hoje: '2026-11-11' });
    expect(projecaoDoCartaoDoNivel(nivel)).toEqual({ consumoEsperadoDiaKg: 45, duracaoEstimada: 200 / 45, proximaReposicao: '15/11/2026' });
  });

  it('ciclo aberto sem estimativa confiável (sem %PV ou compartilhado): nada é projetado', () => {
    const semPv = calcularNivelCocho({ ponto: COCHO, eventos: [aberto({ consumo_esperado_pv_kg: null })], hoje: '2026-11-11' });
    expect(projecaoDoCartaoDoNivel(semPv)).toEqual({ consumoEsperadoDiaKg: null, duracaoEstimada: null, proximaReposicao: null });
    const C2 = { ...COCHO, id: 'c2' };
    const compartilhado = calcularNivelCocho({ ponto: COCHO, eventos: [aberto(), aberto({ id: 'e2', ponto_suplementacao_id: 'c2' })], hoje: '2026-11-11', pontos: [COCHO, C2] });
    expect(compartilhado.confiabilidade).toBe('compartilhada');
    expect(projecaoDoCartaoDoNivel(compartilhado)).toEqual({ consumoEsperadoDiaKg: null, duracaoEstimada: null, proximaReposicao: null });
  });

  it('período fechado, lançamento futuro, data inválida e sem lançamento: nada passa (vale o gravado no evento)', () => {
    for (const eventos of [[fechado()], [aberto({ data_lancamento: '2026-12-01' })], [aberto({ data_lancamento: 'xx' })], []]) {
      expect(projecaoDoCartaoDoNivel(calcularNivelCocho({ ponto: COCHO, eventos, hoje: '2026-11-11' }))).toEqual({});
    }
    expect(projecaoDoCartaoDoNivel(null)).toEqual({});
  });
});

describe('CM-4 — Histórico com o nível do detalhe', () => {
  const renderizarHistorico = async (nivel) => {
    const { default: HistoricoSuplementacaoPonto } = await import('@/components/suplementacao/HistoricoSuplementacaoPonto');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <HistoricoSuplementacaoPonto pontoId="c1" pontoNome="COCHO 1" ponto={COCHO} nivel={nivel} />
      </QueryClientProvider>,
    );
    await screen.findByText(/Histórico do Cocho/);
  };

  it('o último evento do cocho compartilhado não projeta nada, como o detalhe; o fechado continua com o gravado', async () => {
    const C2 = { ...COCHO, id: 'c2' };
    const eventos = [aberto(), fechado(), aberto({ id: 'e2', ponto_suplementacao_id: 'c2' })];
    cache.dados = { eventosSuplementacao: eventos, movimentacoes: [] };
    const nivel = calcularNivelCocho({ ponto: COCHO, eventos, hoje: '2026-11-11', pontos: [COCHO, C2] });
    expect(nivel.confiabilidade).toBe('compartilhada');
    await renderizarHistorico(nivel);

    const duracoes = screen.getAllByText('Duração estimada').map((rotulo) => rotulo.nextElementSibling?.textContent);
    // Ordem do histórico: o aberto (último, 10/11) e depois o fechado (03/11).
    expect(duracoes).toEqual(['-', '4 dia(s)']);
    expect(screen.getByText('Próx. reposição').nextElementSibling?.textContent).toBe('-');
    expect(screen.getAllByText('Consumo Lote PV/dia').map((rotulo) => rotulo.nextElementSibling?.textContent)).toEqual(['-', '50,00 kg']);
  });

  it('cocho estimado: o último evento sai com a projeção do SSOT', async () => {
    cache.dados = { eventosSuplementacao: [aberto()], movimentacoes: [] };
    const nivel = calcularNivelCocho({ ponto: COCHO, eventos: [aberto()], hoje: '2026-11-11', pontos: [COCHO] });
    await renderizarHistorico(nivel);
    expect(screen.getByText('Duração estimada').nextElementSibling?.textContent).toBe('4,4 dia(s)');
    expect(screen.getByText('Próx. reposição').nextElementSibling?.textContent).toBe('15/11/2026');
  });
});
