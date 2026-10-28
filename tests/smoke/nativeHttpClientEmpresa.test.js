/**
 * PR108 — códigos de Empresa atravessam nativeHttpClient sem virar falha genérica.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('nativeHttpClient — Empresa (PR108)', () => {
  it('409 EMPRESA_NAME_CONFLICT preserva código e mensagem do catálogo local', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(409, {
          code: 'EMPRESA_NAME_CONFLICT',
          message: 'texto cru do servidor que não deve aparecer',
          request_id: 'req_empresa_1',
        }),
      ),
    );

    const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const { getApiErrorMessage } = await import('@/apis/_core/ApiError.js');

    setNativeToken('jwt.teste');

    const erro = await nativeRequest(
      '/empresas',
      { method: 'POST', body: { nome: 'X' }, autenticado: true },
      { operation: 'createEmpresa', resource: 'Empresa' },
    ).catch((e) => e);

    expect(erro.code).toBe('EMPRESA_NAME_CONFLICT');
    expect(getApiErrorMessage(erro)).toMatch(/já existe uma empresa cadastrada com este nome/i);
    expect(erro.message).not.toContain('texto cru');
    expect(erro.details?.requestId).toBe('req_empresa_1');
  });

  it('500 INTERNAL_ERROR vira API_OPERATION_FAILED com request_id sanitizado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(500, {
          code: 'INTERNAL_ERROR',
          message: 'column "numero_empresa" does not exist',
          request_id: 'req_interno_9',
        }),
      ),
    );

    const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');

    setNativeToken('jwt.teste');

    const erro = await nativeRequest(
      '/empresas',
      { method: 'POST', body: { nome: 'Y' }, autenticado: true },
      { operation: 'createEmpresa', resource: 'Empresa' },
    ).catch((e) => e);

    expect(erro.code).toBe('API_OPERATION_FAILED');
    expect(erro.message).not.toContain('numero_empresa');
    expect(erro.details?.requestId).toBe('req_interno_9');
  });
});
