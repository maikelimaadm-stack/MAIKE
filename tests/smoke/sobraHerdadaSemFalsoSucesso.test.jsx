/**
 * Missão integrada (D-PROD-136), frente M4a — SUP-02, com o
 * FormularioLancamentoSuplementacao e o SobraHerdadaDialog REAIS.
 *
 * Defeito: "Abrir novo ciclo com essa sobra" mostrava o toast VERDE
 * "Novo lançamento aberto com X kg de saldo inicial." sem gravar nada — só
 * preenchia o formulário; fechar a tela não deixava registro nenhum.
 *
 * Contrato: escolher aproveitar a sobra só preenche o saldo inicial; nada de
 * sucesso antes do envio — o aviso diz que o registro só é criado ao salvar.
 *
 * Mocks só nas bordas: rede (`nativeRequest`), sessão e o `toast`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rede = vi.hoisted(() => ({ chamadas: /** @type {Array<{metodo: string, caminho: string}>} */ ([]) }));
const toast = vi.hoisted(() => {
  const t = /** @type {any} */ (() => {});
  for (const k of ['success', 'error', 'warning', 'info', 'message', 'dismiss', 'loading', 'custom']) t[k] = () => {};
  return t;
});

vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal()), toast }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ id: 'u-1', login: 'vaqueiro', email: 'vaqueiro', cliente_id: 'tenant-1' })),
}));
vi.mock('@/apis/_core/nativeHttpClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  nativeRequest: vi.fn(async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    rede.chamadas.push({ metodo, caminho });
    if (metodo === 'GET' && caminho.startsWith('/suplementacao-eventos')) {
      // Último evento do cocho: período FECHADO com 30 kg de sobra.
      return [{ id: 'ev-0', empresa_id: 'emp-1', ponto_suplementacao_id: 'p1', dias_periodo: 5, sobra_kg: 30, quantidade_total_kg: 100, data_lancamento: '2026-10-20', produto: 'SAL MINERAL' }];
    }
    if (metodo === 'GET' && caminho.startsWith('/pontos-suplementacao')) {
      return [{ id: 'p1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', area_vinculada_ids: ['area-a'] }];
    }
    if (metodo === 'GET') return [];
    throw new Error(`rede inesperada no teste: ${metodo} ${caminho}`);
  }),
}));

const PONTO = { id: 'p1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', area_vinculada_ids: ['area-a'], produto_padrao: 'SAL MINERAL' };
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  rede.chamadas.length = 0;
  for (const k of ['success', 'error', 'warning', 'info']) toast[k] = vi.fn();
});
afterEach(cleanup);

describe('SUP-02 — "Aproveitar sobra" não afirma que gravou', () => {
  it('escolher a sobra só preenche o saldo inicial: nenhum toast de sucesso, nenhuma escrita, o aviso diz que só grava ao salvar', async () => {
    const { default: FormularioLancamentoSuplementacao } = await import('@/components/suplementacao/FormularioLancamentoSuplementacao');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(<QueryClientProvider client={client}><FormularioLancamentoSuplementacao ponto={PONTO} onSubmit={() => {}} onCancel={() => {}} /></QueryClientProvider>);
    });
    await assentar();
    expect(await screen.findByText('Sobra do ciclo anterior')).toBeTruthy();
    const prometiaRegistro = Boolean(screen.queryByText(/Cria um novo registro em aberto/));
    // O botão "aproveitar" do diálogo (rótulo antigo ou novo).
    fireEvent.click(screen.getByRole('button', { name: /Abrir novo ciclo com essa sobra|Usar essa sobra no novo ciclo/ }));
    await assentar();

    expect(toast.success, 'nada foi gravado: sem toast de sucesso').not.toHaveBeenCalled();
    expect(rede.chamadas.filter((c) => c.metodo !== 'GET')).toEqual([]);
    expect(toast.info).toHaveBeenCalledTimes(1);
    const aviso = String(toast.info.mock.calls[0][0]);
    expect(aviso).toMatch(/30,00 kg|30\.00 kg/);
    expect(aviso).toMatch(/Salvar novo ciclo/);
    // O saldo inicial foi de fato preenchido no formulário.
    expect(screen.getByText(/Herdada do ciclo anterior/)).toBeTruthy();
    // O botão não promete criar registro: só usa a sobra como saldo inicial.
    expect(prometiaRegistro, 'texto do botão prometia "Cria um novo registro"').toBe(false);
  });
});
