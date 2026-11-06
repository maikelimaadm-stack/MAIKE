/**
 * Missão integrada (D-PROD-136), frente M4a — SUP-01, com DetalhesLote e
 * FormularioMovimentacaoLote REAIS (e o suplementacaoService real).
 *
 * Defeito: "Fechar consumo" gravava o fechamento do período do cocho (PATCH do
 * evento e dos lotes de suplementação) ANTES da transferência. Se o servidor
 * recusasse a transferência (data antes do corte, saldo…), o usuário
 * cancelasse ou estivesse offline, o período ficava fechado sem o gado ter
 * saído — e a tela dizia "Nada foi gravado".
 *
 * Contrato: o fechamento é CALCULADO no passo do consumo (sem gravar) e só é
 * gravado DEPOIS de a transferência ser confirmada pelo servidor. Recusa,
 * cancelamento ou offline → nada gravado (a mensagem "Nada foi gravado" passa a
 * ser verdade). Transferência gravada e fechamento falhou → aviso explícito.
 *
 * Mocks só nas bordas: rede (`nativeRequest`), cache local do mapa, sessão e o
 * `toast` (para ler a mensagem).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const rede = vi.hoisted(() => ({
  chamadas: /** @type {Array<{metodo: string, caminho: string, body: any}>} */ ([]),
  transferencia: /** @type {(body: any) => any} */ (() => ({ movimentacao: { id: 'mov-1' } })),
  patchEvento: /** @type {(caminho: string, body: any) => any} */ ((caminho, body) => ({ id: 'ev-1', ...body })),
  /** Outra pessoa fechou o período depois do passo do consumo. */
  eventoFechadoPorOutro: false,
}));
const toast = vi.hoisted(() => {
  const t = /** @type {any} */ (() => {});
  for (const k of ['success', 'error', 'warning', 'info', 'message', 'dismiss', 'loading', 'custom']) t[k] = () => {};
  return t;
});

const EMPRESA = 'emp-1';
const EVENTO_ABERTO = vi.hoisted(() => ({
  id: 'ev-1', empresa_id: 'emp-1', area_id: 'area-a', dias_periodo: null, ponto_suplementacao_id: 'p1', produto: 'SAL MINERAL',
  quantidade_total_kg: 100, sobra_kg: 0, total_cabecas_afetadas: 10, data_lancamento: '2026-10-26',
}));

vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal()), toast }));
vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: 'tenant-1', isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ id: 'u-1', login: 'vaqueiro', email: 'vaqueiro', cliente_id: 'tenant-1' })),
}));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
}));
vi.mock('@/apis/_core/nativeHttpClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  nativeRequest: vi.fn(async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    rede.chamadas.push({ metodo, caminho, body: opcoes.body });
    if (metodo === 'GET' && caminho.startsWith('/suplementacao-eventos')) {
      return [rede.eventoFechadoPorOutro ? { ...EVENTO_ABERTO, dias_periodo: 3, sobra_kg: 12 } : EVENTO_ABERTO];
    }
    if (metodo === 'GET' && caminho.startsWith('/suplementacao-lotes')) {
      return [{ id: 'sl-1', empresa_id: 'emp-1', suplementacao_evento_id: 'ev-1', lote_id: 'l-1', cabecas_na_area: 10 }];
    }
    if (metodo === 'GET' && caminho.startsWith('/pontos-suplementacao')) {
      return [{ id: 'p1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', area_vinculada_ids: ['area-a'], status: 'Ativo' }];
    }
    if (metodo === 'POST' && caminho === '/rebanho/comandos/transferencia') return rede.transferencia(opcoes.body);
    if (metodo === 'PATCH' && caminho.startsWith('/suplementacao-eventos/')) return rede.patchEvento(caminho, opcoes.body);
    if (metodo === 'PATCH' && caminho.startsWith('/suplementacao-lotes/')) return { id: caminho.split('/').pop(), ...opcoes.body };
    if (metodo === 'GET') return [];
    throw new Error(`rede inesperada no teste: ${metodo} ${caminho}`);
  }),
}));

const POSICAO = { id: 'pos-1', __posicao: true, nome: 'BASE', categoria: 'BOI', quantidade_cabecas: 10, area_atual_id: 'area-a', status: 'Ativo', empresa_id: EMPRESA };

const assentar = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const recusa = (code) => () => { throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 'executarTransferenciaLedger', resource: 'Lote', cause: { code } }); };
const patches = () => rede.chamadas.filter((c) => c.metodo === 'PATCH');
const indice = (pred) => rede.chamadas.findIndex(pred);

/** Abre Mover, escolhe "Fechar consumo" e conclui o passo do consumo (sobra 0). */
const fecharConsumoNoFormulario = async () => {
  const { default: DetalhesLote } = await import('@/components/mapa/DetalhesLote');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    render(<QueryClientProvider client={client}><DetalhesLote lotes={[POSICAO]} onClose={() => {}} permissions={{ mover_lotes: true, lancar_suplementacao: true }} /></QueryClientProvider>);
  });
  await assentar();
  await act(async () => { window.dispatchEvent(new CustomEvent('open-movimentacao', { detail: { areaDestinoId: 'area-b' } })); });
  fireEvent.click(await screen.findByRole('button', { name: 'Fechar consumo' }));
  fireEvent.click(await screen.findByRole('button', { name: /Fechar Consumos e Continuar/ }));
  await screen.findByRole('button', { name: /Confirmar Movimentação/ }, { timeout: 3000 });
  await assentar();
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', EMPRESA);
  rede.chamadas.length = 0;
  rede.transferencia = () => ({ movimentacao: { id: 'mov-1' } });
  rede.patchEvento = (caminho, body) => ({ id: 'ev-1', ...body });
  rede.eventoFechadoPorOutro = false;
  for (const k of ['success', 'error', 'warning', 'info']) toast[k] = vi.fn();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('SUP-01 — fechamento do consumo só depois da transferência confirmada', () => {
  it('servidor recusa a transferência (antes do corte): NENHUM PATCH de fechamento; "Nada foi gravado" é verdade', async () => {
    // O DetalhesLote registra a recusa no console ('❌ Erro:'); só esse log é esperado aqui.
    const errorDoSetup = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).startsWith('❌ Erro:')) return;
      errorDoSetup(...args);
    });
    rede.transferencia = recusa('REBANHO_ANTES_DO_CORTE');
    await fecharConsumoNoFormulario();
    expect(patches(), 'o passo do consumo não grava nada').toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/Nada foi gravado/);
    expect(rede.chamadas.some((c) => c.metodo === 'POST' && c.caminho === '/rebanho/comandos/transferencia')).toBe(true);
    expect(patches(), 'período continua aberto: nada de fechamento órfão').toEqual([]);
  });

  it('cancelar depois do passo do consumo: nada gravado', async () => {
    await fecharConsumoNoFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    await assentar();
    expect(patches()).toEqual([]);
    expect(rede.chamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  it('offline na confirmação: recusa sem requisição e sem fechamento', async () => {
    await fecharConsumoNoFormulario();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/Sem conexão.*Nada foi gravado/);
    expect(patches()).toEqual([]);
    expect(rede.chamadas.some((c) => c.metodo === 'POST')).toBe(false);
  });

  it('controle positivo: transferência confirmada → o fechamento é gravado DEPOIS dela, com os valores do passo do consumo', async () => {
    await fecharConsumoNoFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const iTransf = indice((c) => c.metodo === 'POST' && c.caminho === '/rebanho/comandos/transferencia');
    const iEvento = indice((c) => c.metodo === 'PATCH' && c.caminho.startsWith('/suplementacao-eventos/ev-1'));
    const iLote = indice((c) => c.metodo === 'PATCH' && c.caminho.startsWith('/suplementacao-lotes/sl-1'));
    expect(iTransf).toBeGreaterThanOrEqual(0);
    expect(iEvento, 'fechamento do evento gravado').toBeGreaterThan(iTransf);
    expect(iLote, 'lotes do período gravados').toBeGreaterThan(iTransf);
    const corpoEvento = rede.chamadas[iEvento].body;
    expect(corpoEvento).toMatchObject({ sobra_kg: 0 });
    expect(corpoEvento.dias_periodo).toBeGreaterThan(0);
    expect(rede.chamadas[iTransf].body.data_movimentacao, 'a transferência usa a data do fechamento').toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('transferência gravada e o fechamento falhou: aviso explícito (sem falso sucesso, sem "nada foi gravado")', async () => {
    rede.patchEvento = () => { throw new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'updateEvento', resource: 'SuplementacaoEvento' }); };
    await fecharConsumoNoFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const aviso = String(toast.warning.mock.calls[0][0]);
    expect(aviso).toMatch(/Transferência registrada/);
    expect(aviso).toMatch(/COCHO 1/);
    expect(aviso).toMatch(/NÃO foi fechado/);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('idempotência preservada: resultado desconhecido → reenvio com a MESMA chave → replay; o fechamento é gravado uma vez, depois da confirmação', async () => {
    const errorDoSetup = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).startsWith('❌ Erro:')) return;
      errorDoSetup(...args);
    });
    // 1º envio: o servidor gravou, mas a resposta se perdeu (sem código do servidor).
    rede.transferencia = () => { throw new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'executarTransferenciaLedger', resource: 'Lote' }); };
    await fecharConsumoNoFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(patches(), 'sem confirmação, nada de fechamento').toEqual([]);

    rede.transferencia = () => ({ replay: true, movimentacao: { id: 'mov-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const envios = rede.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/rebanho/comandos/transferencia');
    expect(envios).toHaveLength(2);
    expect(envios[1].body.operation_id, 'mesma chave idempotente').toBe(envios[0].body.operation_id);
    expect(patches().filter((c) => c.caminho.startsWith('/suplementacao-eventos/'))).toHaveLength(1);
  });

  it('outra pessoa fechou o período no meio tempo: não sobrescreve; avisa', async () => {
    await fecharConsumoNoFormulario();
    rede.eventoFechadoPorOutro = true;
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Movimentação/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(String(toast.warning.mock.calls[0][0])).toMatch(/já tinha sido fechado/);
    expect(patches()).toEqual([]);
  });
});
