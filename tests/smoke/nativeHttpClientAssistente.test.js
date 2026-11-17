/**
 * D-PROD-230 — 503 do próprio backend com código do assistente mostra a mensagem do
 * assistente; 503 sem esse código continua sendo indisponibilidade de infraestrutura.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const respostaJson = (status, corpo) => ({ ok: false, status, text: async () => JSON.stringify(corpo) });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const pedir = async () => {
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
  setNativeToken('jwt.teste');
  return nativeRequest('/assistente/perguntar', { method: 'POST', body: { pergunta: 'oi' }, autenticado: true }, { operation: 'perguntar', resource: 'Assistente' }).catch((e) => e);
};

describe('nativeHttpClient — assistente (D-PROD-230)', () => {
  it('503 ASSISTENTE_INDISPONIVEL e ASSISTENTE_NAO_CONFIGURADO mantêm o código', async () => {
    const { getApiErrorMessage } = await import('@/apis/_core/ApiError.js');
    for (const code of ['ASSISTENTE_INDISPONIVEL', 'ASSISTENTE_NAO_CONFIGURADO']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(503, { code, message: 'x' })));
      const erro = await pedir();
      expect(erro.code).toBe(code);
      expect(getApiErrorMessage(erro)).toMatch(/assistente/i);
    }
  });

  it('503 sem código do assistente continua indisponibilidade', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(503, { code: 'OUTRO' })));
    const erro = await pedir();
    expect(erro.code).toBe('API_PROVIDER_UNAVAILABLE');
  });
});
