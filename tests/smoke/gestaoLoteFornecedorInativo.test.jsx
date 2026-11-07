/**
 * D-PROD-146 — seletor de fornecedor do Cadastro de Lotes: parceiro INATIVO não
 * é oferecido para vínculo novo; o lote que já aponta para um inativo continua
 * mostrando o nome. A rota `/fornecedores` (projeção) não muda.
 *
 * FormularioLote real; `fetch` é o backend falso (rota `/fornecedores` real
 * via service → API → porta). Setores/áreas vêm do hook de leitura (borda de
 * dados do mapa), substituído como nos demais testes do formulário.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { fornecedoresSelecionaveis } from '@/domain/lotes/fornecedoresDoLote';

vi.mock('@/hooks/useEmpresaSelecionadaId', async (importOriginal) => ({
  ...(await importOriginal()),
  useEmpresaSelecionadaId: () => 'emp-1',
}));
vi.mock('@/hooks/useSetorAreas', () => ({
  default: () => ({ setores: [], areas: [], getAreasBySetor: () => [] }),
}));

const FORNECEDORES = [
  { id: 'f1', empresa_id: 'emp-1', numero_cadastro: '1', tipo_pessoa: 'Jurídica', nome: 'ATIVO UM', cidade: null, estado: null, tipos: [], ativo: true },
  { id: 'f2', empresa_id: 'emp-1', numero_cadastro: '2', tipo_pessoa: 'Jurídica', nome: 'INATIVO ATUAL', cidade: null, estado: null, tipos: [], ativo: false },
  { id: 'f3', empresa_id: 'emp-1', numero_cadastro: '3', tipo_pessoa: 'Jurídica', nome: 'INATIVO OUTRO', cidade: null, estado: null, tipos: [], ativo: false },
  // R2/B4: papéis
  { id: 'f4', empresa_id: 'emp-1', numero_cadastro: '4', tipo_pessoa: 'Jurídica', nome: 'SO CLIENTE', cidade: null, estado: null, tipos: ['cliente'], ativo: true },
  { id: 'f5', empresa_id: 'emp-1', numero_cadastro: '5', tipo_pessoa: 'Jurídica', nome: 'ALIAS FORNECEDOR', cidade: null, estado: null, tipos: ['Fornecedor', 'Transportadora'], ativo: true },
  { id: 'f6', empresa_id: 'emp-1', numero_cadastro: '6', tipo_pessoa: 'Jurídica', nome: 'SO TRANSPORTADOR', cidade: null, estado: null, tipos: ['transportador', 'outros'], ativo: true },
  { id: 'f7', empresa_id: 'emp-1', numero_cadastro: '7', tipo_pessoa: 'Jurídica', nome: 'NOVO FORNECEDOR', cidade: null, estado: null, tipos: ['fornecedor'], ativo: true },
  { id: 'f8', empresa_id: 'emp-1', numero_cadastro: '8', tipo_pessoa: 'Jurídica', nome: 'EX FORNECEDOR VIROU CLIENTE', cidade: null, estado: null, tipos: ['cliente'], ativo: true },
];

let backend;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  backend = instalarBackendFake(({ method, path }) => {
    if (method === 'GET' && path === '/fornecedores') return { status: 200, body: FORNECEDORES };
    if (method === 'GET') return { status: 200, body: [] };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const montar = async (initialData) => {
  const { default: FormularioLote } = await import('@/components/lotes/FormularioLote.jsx');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FormularioLote visualVariant="base1" variant="embedded" toolbarActions readOnly={false} isEditing onSubmit={() => {}} onCancel={() => {}} initialData={initialData} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Motivo' }));
};

const campoFornecedor = () => {
  const rotulo = [...document.querySelectorAll('label')].find((el) => /^Fornecedor\b/.test(el.textContent.trim()));
  return rotulo ? rotulo.closest('.mg-field') ?? rotulo.parentElement : null;
};

describe('Lote — seletor de fornecedor sem inativos', () => {
  it('regra pura: inativo fora, exceto o atual', () => {
    expect(fornecedoresSelecionaveis(FORNECEDORES, []).map((f) => f.id)).toEqual(['f1', 'f5', 'f7']);
    expect(fornecedoresSelecionaveis(FORNECEDORES, ['f2', null]).map((f) => f.id)).toEqual(['f1', 'f2', 'f5', 'f7']);
    // atual que perdeu o papel fornecedor continua exibido
    expect(fornecedoresSelecionaveis(FORNECEDORES, ['f8']).map((f) => f.id)).toEqual(['f1', 'f5', 'f7', 'f8']);
  });

  it('lote que aponta para inativo mostra o nome; outro inativo não é oferecido', async () => {
    await montar({ id: 'l1', nome: 'LOTE A', motivo_entrada: 'Compra', fornecedor_id: 'f2', fornecedor_nome: 'INATIVO ATUAL', status: 'Ativo' });
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/fornecedores')).toBe(true));
    const campo = await waitFor(() => {
      const el = campoFornecedor();
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(within(campo).getByDisplayValue('INATIVO ATUAL')).toBeTruthy());
    fireEvent.click(within(campo).getByDisplayValue('INATIVO ATUAL'));
    const opcoes = await screen.findAllByRole('option');
    const nomes = opcoes.map((o) => o.textContent);
    expect(nomes.some((n) => /ATIVO UM/.test(n))).toBe(true);
    expect(nomes.some((n) => /INATIVO ATUAL/.test(n))).toBe(true);
    expect(nomes.some((n) => /INATIVO OUTRO/.test(n))).toBe(false);
    // a projeção pedida continua a mesma rota, sem filtro novo
    expect(backend.chamadas.find((c) => c.path === '/fornecedores').query).toEqual({});
  });

  it('lote novo não oferece nenhum inativo', async () => {
    await montar({ nome: 'LOTE B', motivo_entrada: 'Compra', status: 'Ativo' });
    const campo = await waitFor(() => {
      const el = campoFornecedor();
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/fornecedores')).toBe(true));
    fireEvent.click(within(campo).getByRole('textbox'));
    const opcoes = await screen.findAllByRole('option');
    const nomes = opcoes.map((o) => o.textContent);
    expect(nomes.some((n) => /ATIVO UM/.test(n))).toBe(true);
    expect(nomes.some((n) => /INATIVO/.test(n))).toBe(false);
  });
});

describe('Lote — seletor de fornecedor só com papel fornecedor (R2/B4)', () => {
  it('lote novo: cliente-only e transportador fora; fornecedor, alias e legado tipos=[] dentro', async () => {
    await montar({ nome: 'LOTE C', motivo_entrada: 'Compra', status: 'Ativo' });
    const campo = await waitFor(() => {
      const el = campoFornecedor();
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/fornecedores')).toBe(true));
    fireEvent.click(within(campo).getByRole('textbox'));
    const nomes = (await screen.findAllByRole('option')).map((o) => o.textContent);
    for (const sim of [/ATIVO UM/, /ALIAS FORNECEDOR/, /NOVO FORNECEDOR/]) expect(nomes.some((n) => sim.test(n))).toBe(true);
    for (const nao of [/SO CLIENTE/, /SO TRANSPORTADOR/, /VIROU CLIENTE/, /INATIVO/]) expect(nomes.some((n) => nao.test(n))).toBe(false);
  });

  it('lote antigo com fornecedor que virou só cliente: nome exibido e mantido; outros não-fornecedores fora', async () => {
    await montar({ id: 'l2', nome: 'LOTE D', motivo_entrada: 'Compra', fornecedor_id: 'f8', fornecedor_nome: 'EX FORNECEDOR VIROU CLIENTE', status: 'Ativo' });
    const campo = await waitFor(() => {
      const el = campoFornecedor();
      expect(el).toBeTruthy();
      return el;
    });
    await waitFor(() => expect(within(campo).getByDisplayValue('EX FORNECEDOR VIROU CLIENTE')).toBeTruthy());
    fireEvent.click(within(campo).getByDisplayValue('EX FORNECEDOR VIROU CLIENTE'));
    const nomes = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(nomes.some((n) => /VIROU CLIENTE/.test(n))).toBe(true);
    expect(nomes.some((n) => /SO CLIENTE/.test(n))).toBe(false);
    expect(backend.chamadas.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
