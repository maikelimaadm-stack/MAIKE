/**
 * D-PROD-178 — a data PADRÃO do lançamento de suplementação é o dia civil da
 * FAZENDA (`Empresa.fuso_horario`), o mesmo dia que o nível do cocho usa
 * (`useDiaCivil`). Antes ela vinha do relógio do navegador: com o navegador em
 * outro fuso, perto da meia-noite, o lançamento recém-feito aparecia como "data
 * futura" ou já com um dia consumido.
 *
 *  LD-1. navegador em UTC (13/11 03:30) e fazenda em Cuiabá (12/11 23:30): a
 *        data sugerida é 12/11 — e o SSOT, com o mesmo dia, não vê lançamento
 *        futuro;
 *  LD-2. empresa sem fuso: relógio do navegador (comportamento anterior);
 *  LD-3. a data que a pessoa já escolheu não é trocada quando o fuso chega;
 *  LD-4. com o formulário aberto na virada do dia, a data que a pessoa já viu
 *        não muda sozinha (o padrão da fazenda é aplicado uma vez).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { hojeNoFuso } from '@/lib/diaCivil';
import { calcularNivelCocho } from '@/domain/suplementacao/nivelSuplementacao';

const empresas = vi.hoisted(() => ({ resposta: /** @type {() => Promise<any[]>} */ (async () => []) }));

vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal()), toast: Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ id: 'u-1', login: 'vaqueiro', email: 'vaqueiro', cliente_id: 'tenant-1' })),
}));
vi.mock('@/services/empresaService', async (importOriginal) => ({ ...(await importOriginal()), listEmpresas: vi.fn(() => empresas.resposta()) }));
vi.mock('@/apis/_core/nativeHttpClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  nativeRequest: vi.fn(async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    if (metodo === 'GET' && caminho.startsWith('/pontos-suplementacao')) {
      return [{ id: 'p1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', area_vinculada_ids: ['area-a'] }];
    }
    if (metodo === 'GET') return [];
    throw new Error(`rede inesperada no teste: ${metodo} ${caminho}`);
  }),
}));

const PONTO = { id: 'p1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', area_vinculada_ids: ['area-a'], produto_padrao: 'SAL MINERAL' };
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const campoData = () => /** @type {HTMLInputElement} */ (document.querySelectorAll('input[type="date"]')[0]);

const montar = async () => {
  const { default: FormularioLancamentoSuplementacao } = await import('@/components/suplementacao/FormularioLancamentoSuplementacao');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<QueryClientProvider client={client}><FormularioLancamentoSuplementacao ponto={PONTO} onSubmit={() => {}} onCancel={() => {}} /></QueryClientProvider>);
  });
  await assentar();
  await screen.findByText('Data do lançamento');
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  vi.useFakeTimers({ toFake: ['Date'] });
  // 03:30 UTC de 13/11 = 23:30 de 12/11 em Cuiabá.
  vi.setSystemTime(new Date('2026-11-13T03:30:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('data padrão do lançamento no fuso da fazenda', () => {
  it('LD-1 — navegador já em 13/11, fazenda ainda em 12/11: sugere 12/11 e o nível não vê data futura', async () => {
    empresas.resposta = async () => [{ id: 'emp-1', nome: 'FAZENDA', fuso_horario: 'America/Cuiaba' }];
    expect(hojeNoFuso(null)).toBe('2026-11-13');
    await montar();
    expect(campoData().value).toBe('2026-11-12');

    const nivel = calcularNivelCocho({
      ponto: PONTO,
      eventos: [{ ponto_suplementacao_id: 'p1', data_lancamento: campoData().value, quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: 20 }],
      hoje: hojeNoFuso('America/Cuiaba'),
    });
    expect(nivel.estado).toBe('ciclo_aberto');
    expect(nivel.rotuloCurto).toBe('100%');
  });

  it('LD-2 — empresa sem fuso: relógio do navegador', async () => {
    empresas.resposta = async () => [{ id: 'emp-1', nome: 'FAZENDA', fuso_horario: null }];
    await montar();
    expect(campoData().value).toBe('2026-11-13');
  });

  it('LD-3 — a data escolhida antes de o fuso chegar é mantida', async () => {
    /** @type {(valor: any[]) => void} */
    let liberar = () => {};
    empresas.resposta = () => new Promise((resolve) => { liberar = resolve; });
    await montar();
    expect(campoData().value).toBe('2026-11-13');
    await act(async () => { fireEvent.change(campoData(), { target: { value: '2026-11-10' } }); });
    await act(async () => { liberar([{ id: 'emp-1', nome: 'FAZENDA', fuso_horario: 'America/Cuiaba' }]); });
    await assentar();
    expect(campoData().value).toBe('2026-11-10');
  });
  it('LD-4 — virada do dia com o formulário aberto: a data mostrada não muda sozinha', async () => {
    empresas.resposta = async () => [{ id: 'emp-1', nome: 'FAZENDA', fuso_horario: 'America/Cuiaba' }];
    await montar();
    expect(campoData().value).toBe('2026-11-12');
    // 04:05 UTC de 13/11 = 00:05 de 13/11 em Cuiabá; foco na janela relê o dia.
    vi.setSystemTime(new Date('2026-11-13T04:05:00.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await assentar();
    expect(campoData().value).toBe('2026-11-12');
  });
});
