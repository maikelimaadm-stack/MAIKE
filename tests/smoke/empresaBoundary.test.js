import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  ApiError,
  API_ERROR_CODES,
  getApiErrorMessage,
  hasApiErrorCode,
  isApiError,
} from '@/apis/_core/ApiError';
import { normalizeApiError } from '@/apis/_core/normalizeApiError';

/**
 * O provider é mockado: estes testes provam o **contrato da fronteira**, não a
 * Base44. Se amanhã o provider virar HTTP, estes testes continuam válidos.
 */
const providerMock = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/apis/_providers/base44Provider', () => ({
  empresaProvider: {
    list: (...a) => providerMock.list(...a),
    create: (...a) => providerMock.create(...a),
    update: (...a) => providerMock.update(...a),
    delete: (...a) => providerMock.delete(...a),
  },
  getRegisteredEntityNames: () => ['Empresa'],
}));

beforeEach(() => {
  Object.values(providerMock).forEach((m) => m.mockReset());
});

describe('ApiError', () => {
  it('tem código estável e mensagem pública', () => {
    const erro = new ApiError(API_ERROR_CODES.EMPRESA_NAME_CONFLICT, { operation: 'create' });
    expect(erro.name).toBe('ApiError');
    expect(erro.code).toBe('EMPRESA_NAME_CONFLICT');
    expect(erro.message).toMatch(/já existe uma empresa/i);
    expect(erro.operation).toBe('create');
    expect(erro.retryable).toBe(false);
  });

  it('marca indisponibilidade como retryable', () => {
    expect(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE).retryable).toBe(true);
  });

  it('preserva o erro original em cause sem expô-lo na mensagem', () => {
    const original = new Error('detalhe interno do provider com token=abc');
    const erro = normalizeApiError(original, { operation: 'list', resource: 'Empresa' });
    expect(erro.cause).toBe(original);
    expect(erro.message).not.toContain('token=abc');
    expect(JSON.stringify(erro)).not.toContain('token=abc');
  });

  it('normaliza erro desconhecido para API_OPERATION_FAILED', () => {
    const erro = normalizeApiError({ qualquer: 'coisa' }, { operation: 'list', resource: 'Empresa' });
    expect(erro.code).toBe('API_OPERATION_FAILED');
  });

  it('reconhece falha de rede como provider indisponível', () => {
    const erro = normalizeApiError(new Error('fetch failed'), { operation: 'list', resource: 'Empresa' });
    expect(erro.code).toBe('API_PROVIDER_UNAVAILABLE');
    expect(erro.retryable).toBe(true);
  });

  it('não reclassifica um ApiError já normalizado', () => {
    const conflito = new ApiError(API_ERROR_CODES.EMPRESA_NAME_CONFLICT);
    expect(normalizeApiError(conflito, { operation: 'create', resource: 'Empresa' })).toBe(conflito);
  });

  it('getApiErrorMessage tem fallback determinístico', () => {
    expect(getApiErrorMessage(null, 'padrão')).toBe('padrão');
    expect(getApiErrorMessage(undefined, 'padrão')).toBe('padrão');
    expect(getApiErrorMessage({}, 'padrão')).toBe('padrão');
    expect(getApiErrorMessage('texto solto')).toBe('texto solto');
    expect(getApiErrorMessage(new Error('do provider'))).toBe('do provider');
  });

  it('hasApiErrorCode identifica o conflito sem olhar o texto', () => {
    const erro = new ApiError(API_ERROR_CODES.EMPRESA_NAME_CONFLICT);
    expect(hasApiErrorCode(erro, 'EMPRESA_NAME_CONFLICT')).toBe(true);
    expect(hasApiErrorCode(new Error('Já existe uma empresa'), 'EMPRESA_NAME_CONFLICT')).toBe(false);
  });
});

describe('empresaApi — adaptador de dados', () => {
  it('list encaminha a ordenação padrão', async () => {
    providerMock.list.mockResolvedValue([{ id: '1' }]);
    const { listEmpresas } = await import('@/apis/empresa');

    await expect(listEmpresas()).resolves.toEqual([{ id: '1' }]);
    expect(providerMock.list).toHaveBeenCalledWith('-created_date');
  });

  it('list devolve lista mesmo quando o provider devolve undefined', async () => {
    providerMock.list.mockResolvedValue(undefined);
    const { listEmpresas } = await import('@/apis/empresa');
    await expect(listEmpresas()).resolves.toEqual([]);
  });

  it('create encaminha o payload', async () => {
    providerMock.create.mockResolvedValue({ id: '9' });
    const { createEmpresa } = await import('@/apis/empresa');

    await createEmpresa({ nome: 'Fazenda' });
    expect(providerMock.create).toHaveBeenCalledWith({ nome: 'Fazenda' });
  });

  it('update encaminha id e payload', async () => {
    providerMock.update.mockResolvedValue({ id: '9' });
    const { updateEmpresa } = await import('@/apis/empresa');

    await updateEmpresa('9', { nome: 'Nova' });
    expect(providerMock.update).toHaveBeenCalledWith('9', { nome: 'Nova' });
  });

  it('delete encaminha o id', async () => {
    providerMock.delete.mockResolvedValue(undefined);
    const { deleteEmpresa } = await import('@/apis/empresa');

    await deleteEmpresa('9');
    expect(providerMock.delete).toHaveBeenCalledWith('9');
  });

  it('argumento inválido vira API_INVALID_ARGUMENT sem chamar o provider', async () => {
    const { updateEmpresa, deleteEmpresa, createEmpresa } = await import('@/apis/empresa');

    await expect(updateEmpresa('', { nome: 'x' })).rejects.toMatchObject({ code: 'API_INVALID_ARGUMENT' });
    await expect(deleteEmpresa(null)).rejects.toMatchObject({ code: 'API_INVALID_ARGUMENT' });
    await expect(createEmpresa('não é objeto')).rejects.toMatchObject({ code: 'API_INVALID_ARGUMENT' });

    expect(providerMock.update).not.toHaveBeenCalled();
    expect(providerMock.delete).not.toHaveBeenCalled();
    expect(providerMock.create).not.toHaveBeenCalled();
  });

  it('falha do provider vira ApiError', async () => {
    providerMock.list.mockRejectedValue(new Error('quebrou lá dentro'));
    const { listEmpresas } = await import('@/apis/empresa');

    const erro = await listEmpresas().catch((e) => e);
    expect(isApiError(erro)).toBe(true);
    expect(erro.resource).toBe('Empresa');
    expect(erro.operation).toBe('list');
  });

  it('a superfície pública não exporta o objeto do provider', async () => {
    const modulo = await import('@/apis/empresa');
    expect(Object.keys(modulo).sort()).toEqual([
      'EMPRESA_DEFAULT_ORDER',
      'createEmpresa',
      'deleteEmpresa',
      'listEmpresas',
      'updateEmpresa',
    ]);
    for (const valor of Object.values(modulo)) {
      expect(valor === null || typeof valor !== 'object').toBe(true);
    }
  });
});

describe('empresaService — regra de nome duplicado', () => {
  const existentes = [
    { id: '1', nome: 'Fazenda Boa Vista' },
    { id: '2', nome: 'Sítio Alegre' },
  ];

  it('create recusa nome já cadastrado', async () => {
    providerMock.list.mockResolvedValue(existentes);
    const { createEmpresa } = await import('@/services/empresaService');

    const erro = await createEmpresa({ nome: 'Fazenda Boa Vista' }).catch((e) => e);
    expect(erro.code).toBe('EMPRESA_NAME_CONFLICT');
    expect(providerMock.create).not.toHaveBeenCalled();
  });

  it('create ignora diferença de caixa e espaços nas pontas', async () => {
    providerMock.list.mockResolvedValue(existentes);
    const { createEmpresa } = await import('@/services/empresaService');

    const erro = await createEmpresa({ nome: '  fazenda boa vista  ' }).catch((e) => e);
    expect(erro.code).toBe('EMPRESA_NAME_CONFLICT');
  });

  it('create aceita nome novo', async () => {
    providerMock.list.mockResolvedValue(existentes);
    providerMock.create.mockResolvedValue({ id: '3' });
    const { createEmpresa } = await import('@/services/empresaService');

    await expect(createEmpresa({ nome: 'Estância Nova' })).resolves.toEqual({ id: '3' });
    expect(providerMock.create).toHaveBeenCalledWith({ nome: 'Estância Nova' });
  });

  it('update recusa nome de outro registro', async () => {
    providerMock.list.mockResolvedValue(existentes);
    const { updateEmpresa } = await import('@/services/empresaService');

    const erro = await updateEmpresa('2', { nome: 'Fazenda Boa Vista' }).catch((e) => e);
    expect(erro.code).toBe('EMPRESA_NAME_CONFLICT');
    expect(providerMock.update).not.toHaveBeenCalled();
  });

  it('update aceita manter o próprio nome', async () => {
    providerMock.list.mockResolvedValue(existentes);
    providerMock.update.mockResolvedValue({ id: '1' });
    const { updateEmpresa } = await import('@/services/empresaService');

    await expect(updateEmpresa('1', { nome: 'Fazenda Boa Vista' })).resolves.toEqual({ id: '1' });
    expect(providerMock.update).toHaveBeenCalledWith('1', { nome: 'Fazenda Boa Vista' });
  });

  it('delete encaminha o id', async () => {
    providerMock.delete.mockResolvedValue(undefined);
    const { deleteEmpresa } = await import('@/services/empresaService');

    await deleteEmpresa('1');
    expect(providerMock.delete).toHaveBeenCalledWith('1');
  });

  it('lista sem nome não gera falso conflito', async () => {
    providerMock.list.mockResolvedValue([{ id: '1' }, { id: '2', nome: null }]);
    providerMock.create.mockResolvedValue({ id: '3' });
    const { createEmpresa } = await import('@/services/empresaService');

    await expect(createEmpresa({ nome: 'Qualquer' })).resolves.toEqual({ id: '3' });
  });
});
