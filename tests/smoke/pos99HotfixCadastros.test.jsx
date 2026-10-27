/**
 * POS-PR99 — hotfix Empresa/Categoria (formulário, offline tenant, service).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import {
  createOfflineEntityAdapter,
  resetOfflineEntityRuntime,
} from '@/lib/offline/offlineEntityRuntime';

const providerMock = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/apis/empresa/empresaNativePort.js', () => ({
  empresaPort: {
    list: (...a) => providerMock.list(...a),
    create: (...a) => providerMock.create(...a),
    update: (...a) => providerMock.update(...a),
    delete: (...a) => providerMock.delete(...a),
  },
}));

vi.mock('@/services/arquivoService', () => ({
  enviarArquivo: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

beforeEach(() => {
  Object.values(providerMock).forEach((m) => m.mockReset());
  resetOfflineEntityRuntime();
});

describe('FormularioEmpresa — contrato alinhado ao backend', () => {
  it('envia pessoa jurídica sem CNPJ quando apelido e nome estão preenchidos', async () => {
    const onSubmit = vi.fn();
    const { default: FormularioEmpresa } = await import('@/components/empresa/FormularioEmpresa.jsx');

    render(
      <FormularioEmpresa variant="embedded" onSubmit={onSubmit} initialData={null} isEditing={false} />,
    );

    fireEvent.change(screen.getByPlaceholderText('FAZENDA PALMITAL'), {
      target: { value: 'FZ TESTE' },
    });
    fireEvent.change(screen.getByPlaceholderText('NOME COMPLETO'), {
      target: { value: 'Empresa Teste' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      apelido: 'FZ TESTE',
      nome: 'EMPRESA TESTE',
      tipo_pessoa: 'Jurídica',
    });
  });
});

describe('empresaService — escrita sem GET prévio', () => {
  it('create chama provider mesmo se list falharia', async () => {
    providerMock.list.mockRejectedValue(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE));
    providerMock.create.mockResolvedValue({ id: '3', numero_empresa: 1 });
    const { createEmpresa } = await import('@/services/empresaService');

    await expect(
      createEmpresa({ nome: 'Nova', apelido: 'NV', tipo_pessoa: 'Jurídica' }),
    ).resolves.toMatchObject({ id: '3', numero_empresa: 1 });
    expect(providerMock.create).toHaveBeenCalled();
    expect(providerMock.list).not.toHaveBeenCalled();
  });
});

describe('offline — tenantCatalog Empresa', () => {
  const criarArmazenamentoEmMemoria = () => {
    const cache = new Map();
    const fila = new Map();
    let proximoId = 1;
    return {
      lerCache: async (chave) => [...(cache.get(chave) || [])],
      gravarCache: async (chave, registro) => {
        cache.set(chave, registro.items);
      },
      listarFila: async () => [...fila.values()],
      adicionarNaFila: async (item) => {
        const id = proximoId++;
        fila.set(id, { ...item, id });
        return id;
      },
      atualizarNaFila: async () => {},
      removerDaFila: async () => {},
      removerCache: async (chave) => {
        cache.delete(chave);
      },
      cache,
    };
  };

  it('usa chave __GLOBAL__ mesmo com empresa selecionada no localStorage', async () => {
    localStorage.setItem('empresa_selecionada_id', 'empresa-menu-99');
    const storage = criarArmazenamentoEmMemoria();
    const operacoes = {
      list: vi.fn(async () => [{ id: 'e1', nome: 'A' }]),
      create: vi.fn(async (d) => ({ id: 'e2', ...d })),
    };

    const adapter = createOfflineEntityAdapter({
      entityName: 'Empresa',
      operations: operacoes,
      tenantScoped: true,
      tenantCatalog: true,
      storage,
    });

    await adapter.list();
    const chaves = [...storage.cache.keys()];
    expect(chaves.some((k) => k.includes('__GLOBAL__'))).toBe(true);
    expect(chaves.some((k) => k.includes('empresa-menu-99'))).toBe(false);
  });
});
