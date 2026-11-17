/**
 * D-PROD-230 — leitura do fluxo (SSE) do assistente no cliente: pedaços, consulta em
 * andamento, resultado final, erro com código e volta para a rota sem fluxo quando o
 * fluxo falha antes de chegar qualquer coisa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const enc = new TextEncoder();

/** Resposta SSE com os blocos em pedaços arbitrários (cortes no meio do evento). */
const respostaSse = (texto, cortes = 7) => {
  const bytes = enc.encode(texto);
  const partes = [];
  for (let i = 0; i < bytes.length; i += cortes) partes.push(bytes.slice(i, i + cortes));
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null) },
    body: new ReadableStream({
      start(c) {
        partes.forEach((p) => c.enqueue(p));
        c.close();
      },
    }),
  };
};
const sse = (evento, dados) => `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
const respostaJson = (status, corpo) => ({ ok: status < 300, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(corpo) });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const carregar = async () => {
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  return import('@/services/assistenteService');
};
const DADOS = { empresa_id: 'emp-1', pergunta: 'oi' };

describe('assistente — fluxo no cliente (D-PROD-230)', () => {
  it('junta os pedaços, avisa a consulta e devolve o resultado final', async () => {
    const corpo = sse('ferramenta', { nome: 'listar_pastos' }) + sse('delta', { texto: 'O PASTO ' }) + sse('delta', { texto: '3 está pronto.' }) + sse('fim', { resposta: 'O PASTO 3 está pronto.', ferramentas: ['listar_pastos'], recusada: false });
    const fetchMock = vi.fn().mockResolvedValue(respostaSse(corpo));
    vi.stubGlobal('fetch', fetchMock);
    const { perguntarAssistenteAoVivo } = await carregar();
    const pedacos = [];
    const consultas = [];
    const r = await perguntarAssistenteAoVivo(DADOS, { aoTexto: (t) => pedacos.push(t), aoFerramenta: (n) => consultas.push(n) });
    expect(pedacos.join('')).toBe('O PASTO 3 está pronto.');
    expect(consultas).toEqual(['listar_pastos']);
    expect(r.resposta).toBe('O PASTO 3 está pronto.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/assistente\/perguntar\/stream$/);
    expect(init.headers.Authorization).toBe('Bearer jwt.teste');
    expect(init.headers.Accept).toBe('text/event-stream');
  });

  it('evento `erro` vira o erro do assistente, sem cair na rota sem fluxo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaSse(sse('erro', { code: 'ASSISTENTE_INDISPONIVEL', message: 'x' })));
    vi.stubGlobal('fetch', fetchMock);
    const { perguntarAssistenteAoVivo } = await carregar();
    const { getApiErrorMessage } = await import('@/apis/_core/ApiError.js');
    const erro = await perguntarAssistenteAoVivo(DADOS).catch((e) => e);
    expect(erro.code).toBe('ASSISTENTE_INDISPONIVEL');
    expect(getApiErrorMessage(erro)).toMatch(/assistente/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('503 ASSISTENTE_NAO_CONFIGURADO antes do fluxo mantém o código', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(503, { code: 'ASSISTENTE_NAO_CONFIGURADO' })));
    const { perguntarAssistenteAoVivo } = await carregar();
    const erro = await perguntarAssistenteAoVivo(DADOS).catch((e) => e);
    expect(erro.code).toBe('ASSISTENTE_NAO_CONFIGURADO');
  });

  it('fluxo bloqueado no caminho (sem event-stream) repete pela rota sem fluxo', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, { qualquer: 1 }))
      .mockResolvedValueOnce(respostaJson(200, { resposta: 'Resposta inteira', ferramentas: [], recusada: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { perguntarAssistenteAoVivo } = await carregar();
    const r = await perguntarAssistenteAoVivo(DADOS);
    expect(r.resposta).toBe('Resposta inteira');
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/assistente\/perguntar$/);
  });

  it('rede caída antes do fluxo também repete pela rota sem fluxo; cancelado, não repete', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(respostaJson(200, { resposta: 'ok', ferramentas: [], recusada: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { perguntarAssistenteAoVivo } = await carregar();
    expect((await perguntarAssistenteAoVivo(DADOS)).resposta).toBe('ok');

    const cancelar = new AbortController();
    cancelar.abort();
    const fetch2 = vi.fn();
    vi.stubGlobal('fetch', fetch2);
    await expect(perguntarAssistenteAoVivo(DADOS, { signal: cancelar.signal })).rejects.toBeTruthy();
    expect(fetch2).not.toHaveBeenCalled();
  });
});
