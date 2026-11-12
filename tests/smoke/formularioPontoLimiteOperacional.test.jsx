/**
 * D-PROD-178, seção 6 — `FormularioPonto`: o campo `capacidade_cocho_kg` passa
 * a se chamar LIMITE OPERACIONAL (máximo recomendado pelo proprietário, que pode
 * ser menor que a capacidade física). Mesmo campo e mesmo payload; só mudam
 * rótulo, texto de ajuda e mensagens de validação.
 *
 *  FP-1. cocho: "Limite operacional do cocho (kg)" com ajuda ligada por
 *        `aria-describedby`; validação "Informe o limite operacional do cocho em kg.";
 *  FP-2. depósito: "Limite operacional do depósito (kg)" e "Estoque mínimo (kg)"
 *        com ajudas; validações com os nomes novos; o payload grava os MESMOS
 *        campos (`capacidade_cocho_kg`, `estoque_minimo_kg`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const svc = vi.hoisted(() => ({
  criarPonto: vi.fn(),
  atualizarPonto: vi.fn(),
  criarPontoSuplementacao: vi.fn(),
  atualizarPontoSuplementacao: vi.fn(),
  criarLocal: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/mapaService', () => ({
  listarIconesPorTipoEntidade: vi.fn(async () => []),
  listarTodosPontos: vi.fn(async () => []),
  listarTodosPontosSuplementacao: vi.fn(async () => []),
  listarTodosBebedouros: vi.fn(async () => []),
  listarSetoresAtivos: vi.fn(async () => [{ id: 's1', nome: 'SETOR 1', empresa_id: 'emp-1' }]),
  listarAreasAtivas: vi.fn(async () => [{ id: 'a1', nome: 'PASTO 1', setor_id: 's1', empresa_id: 'emp-1' }]),
  criarPonto: (...a) => svc.criarPonto(...a),
  atualizarPonto: (...a) => svc.atualizarPonto(...a),
  criarPontoSuplementacao: (...a) => svc.criarPontoSuplementacao(...a),
  atualizarPontoSuplementacao: (...a) => svc.atualizarPontoSuplementacao(...a),
}));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosProdutos: vi.fn(async () => []),
  listarTodosLocais: vi.fn(async () => []),
  criarLocal: (...a) => svc.criarLocal(...a),
  atualizarLocal: vi.fn(),
  buscarLotesNotaPorCriterio: vi.fn(async () => []),
  atualizarLoteNota: vi.fn(),
  listarMovimentacoesRecentes: vi.fn(async () => []),
  atualizarMovimentacao: vi.fn(),
}));
vi.mock('@/services/bebedouroDataService', () => ({ atualizarBebedouro: vi.fn(), criarBebedouro: vi.fn() }));
vi.mock('@/components/mapa/CapturaGPSPonto', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoAreasMapa', () => ({ default: () => null }));
vi.mock('@/components/mapa/SelecaoDepositoMapa', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a) => svc.toastError(...a) } }));

const { default: FormularioPonto } = await import('@/components/mapa/FormularioPonto');

const AJUDA_LIMITE = 'Máximo recomendado que você define (pode ser menor que a capacidade física, por exemplo no período chuvoso). Usado para mostrar a ocupação e o excesso.';
const AJUDA_MINIMO = 'Abaixo deste saldo o mapa avisa para repor.';
const COORDENADAS = { lat: -15.6, lng: -56.1 };

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  svc.toastError.mockReset();
  svc.criarPonto.mockReset().mockImplementation(async (d) => ({ id: 'ref-novo', ...d }));
  svc.atualizarPonto.mockReset().mockImplementation(async (id, d) => ({ id, ...d }));
  svc.criarPontoSuplementacao.mockReset().mockImplementation(async (d) => ({ id: 'supl-novo', ...d }));
  svc.atualizarPontoSuplementacao.mockReset();
  svc.criarLocal.mockReset().mockImplementation(async (d) => ({ id: 'loc-novo', ...d }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const montar = async (item) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FormularioPonto coordenadas={COORDENADAS} item={item} onSave={() => {}} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  await act(async () => {});
};
/** Campo pelo rótulo (o rótulo inclui o " *" de obrigatório). */
const campo = (rotulo) => /** @type {HTMLInputElement} */ (screen.getByLabelText(new RegExp(`^${rotulo.replace(/[()]/g, '\\$&')}`)));
const ajudaDe = (input) => document.getElementById(input.getAttribute('aria-describedby') || '')?.textContent;
const enviar = async () => {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('b1-form-ponto'));
  });
};

describe('FormularioPonto — limite operacional (D-PROD-178)', () => {
  it('FP-1 — cocho: rótulo, ajuda acessível e validação com o nome novo', async () => {
    await montar({ id: 'p1', nome: 'COCHO 1', tipo: 'COCHO', setor_id: 's1', area_vinculada_ids: ['a1'], area_vinculada_id: 'a1', deposito_origem_id: 'dep1' });
    await waitFor(() => expect(screen.getByText('Dados do Cocho')).toBeTruthy());
    const limite = campo('Limite operacional do cocho (kg)');
    expect(limite.type).toBe('number');
    expect(ajudaDe(limite)).toBe(AJUDA_LIMITE);
    expect(screen.getByText(AJUDA_LIMITE)).toBeTruthy();
    expect(screen.queryByText(/Capacidade do cocho/)).toBeNull();

    await enviar();
    expect(svc.toastError).toHaveBeenCalledWith('Informe o limite operacional do cocho em kg.');
    expect(svc.toastError.mock.calls.flat().join(' ')).not.toMatch(/capacidade/i);
  });

  it('FP-2 — depósito: rótulos, ajudas, validações e o MESMO payload', async () => {
    await montar({ id: 'p2', nome: 'DEPÓSITO 1', tipo: 'DEPÓSITO', setor_id: 's1' });
    await waitFor(() => expect(screen.getByText('Depósito de Suplementação')).toBeTruthy());
    const limite = campo('Limite operacional do depósito (kg)');
    const minimo = campo('Estoque mínimo (kg)');
    expect(ajudaDe(limite)).toBe(AJUDA_LIMITE);
    expect(ajudaDe(minimo)).toBe(AJUDA_MINIMO);
    expect(screen.queryByText(/Capacidade do depósito/)).toBeNull();

    await enviar();
    expect(svc.toastError).toHaveBeenLastCalledWith('Informe o limite operacional do depósito em kg.');

    await act(async () => {
      fireEvent.change(limite, { target: { value: '250' } });
    });
    await enviar();
    expect(svc.toastError).toHaveBeenLastCalledWith('Informe o estoque mínimo do depósito em kg.');

    await act(async () => {
      fireEvent.change(minimo, { target: { value: '100' } });
    });
    await enviar();
    await waitFor(() => expect(svc.criarPontoSuplementacao).toHaveBeenCalledTimes(1));
    expect(svc.criarPontoSuplementacao).toHaveBeenCalledWith(expect.objectContaining({
      categoria_ponto: 'DEPOSITO',
      capacidade_cocho_kg: 250,
      estoque_minimo_kg: 100,
    }));
    expect(Object.keys(svc.criarPontoSuplementacao.mock.calls[0][0]).some((chave) => /limite_operacional/.test(chave))).toBe(false);
  });
});
