/**
 * D-PROD-325 — a camada de API marca a RECUSA de rota que o servidor não tem (404/405/501 sem o `code` de uma regra), para o
 * Diário da máquina cair no fluxo antigo. Um 404 de negócio (com `code`) NÃO é marcado. A regra de quem usa só lê a marca.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nativeRequest } from '@/apis/_core/nativeHttpClient';

const respostaJson = (status, corpo) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('nativeRequest — rota ausente no servidor (D-PROD-325)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('404 do próprio Fastify (rota inexistente, sem code) vem marcado como rotaAusente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(404, { message: 'Route POST:/atividades/1/trajetos not found', error: 'Not Found', statusCode: 404 })));
    const erro = await nativeRequest('/atividades/1/trajetos', { method: 'POST', body: {}, autenticado: false }, { operation: 'trajeto', resource: 'Mistura' }).catch((e) => e);
    expect(erro.rotaAusente).toBe(true);
  });

  it('404 de negócio (com code de regra) NÃO é marcado: é a resposta do servidor sobre o dado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(404, { code: 'MISTURA_NOT_FOUND', message: 'não encontrada' })));
    const erro = await nativeRequest('/atividades/1/misturas', { method: 'POST', body: {}, autenticado: false }, { operation: 'x', resource: 'Mistura' }).catch((e) => e);
    expect(erro.rotaAusente).toBeUndefined();
  });
});
