/**
 * D-PROD-195 — excluir curva de ganho ligada a categoria de manejo: o servidor
 * responde 409 `CURVA_GANHO_EM_USO` com `details.categorias` (quantas). O
 * código atravessa o nativeHttpClient (não vira falha genérica), a mensagem é
 * a do catálogo local (nunca a do servidor) e a exclusão em lote diz quantas
 * categorias usam a curva.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

const RESPOSTA_EM_USO = Object.freeze({
  code: 'CURVA_GANHO_EM_USO',
  message: 'texto cru do servidor que não deve aparecer',
  details: { categorias: 2 },
  request_id: 'req_curva_1',
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CURVA_GANHO_EM_USO (D-PROD-195)', () => {
  it('EU-1 — 409 preserva código e `details.categorias`; mensagem do catálogo, sem o texto do servidor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(409, RESPOSTA_EM_USO)));
    const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const { getApiErrorMessage, API_ERROR_CODES } = await import('@/apis/_core/ApiError.js');
    setNativeToken('jwt.teste');

    const erro = await nativeRequest(
      '/curvas-ganho/c1?empresa_id=emp-1',
      { method: 'DELETE', autenticado: true },
      { operation: 'deleteCurvaGanho', resource: 'CurvaGanho' },
    ).catch((e) => e);

    expect(API_ERROR_CODES.CURVA_GANHO_EM_USO).toBe('CURVA_GANHO_EM_USO');
    expect(erro.code).toBe('CURVA_GANHO_EM_USO');
    expect(erro.details).toMatchObject({ categorias: 2, requestId: 'req_curva_1' });
    expect(getApiErrorMessage(erro)).toBe('Esta curva está ligada a categoria(s) de manejo e não pode ser excluída.');
    expect(erro.message).not.toContain('texto cru');
  });

  it('EU-2 — exclusão em lote: a curva em uso volta bloqueada com a contagem; a frase diz quantas categorias', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(409, RESPOSTA_EM_USO))
      .mockResolvedValueOnce(respostaJson(204))
      .mockResolvedValueOnce(respostaJson(404, { code: 'CURVA_GANHO_NOT_FOUND' }));
    vi.stubGlobal('fetch', fetch);
    const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
    const { excluirCurvasGanho, mensagemExclusaoBloqueada, mensagemCurvaEmUso } = await import(
      '@/services/curvaGanhoCadastroService'
    );
    setNativeToken('jwt.teste');

    const resultado = await excluirCurvasGanho(['c1', 'c2', 'c3'], { empresaId: 'emp-1' });
    expect(resultado).toEqual({
      excluidos: ['c2'],
      bloqueados: [
        { id: 'c1', code: 'CURVA_GANHO_EM_USO', categorias: 2 },
        { id: 'c3', code: 'CURVA_GANHO_NOT_FOUND' },
      ],
    });
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');

    expect(mensagemExclusaoBloqueada([resultado.bloqueados[0]])).toBe(
      'Esta curva está ligada a 2 categoria(s) de manejo e não pode ser excluída.',
    );
    expect(mensagemExclusaoBloqueada(resultado.bloqueados)).toBe(
      '2 curvas de ganho não puderam ser excluídas. 1 está ligada a categorias de manejo.',
    );
    expect(mensagemExclusaoBloqueada([resultado.bloqueados[1]])).toBe('1 curva de ganho não pôde ser excluída.');
    expect(mensagemExclusaoBloqueada([{ id: 'a', code: 'X' }, { id: 'b', code: 'Y' }])).toBe(
      '2 curvas de ganho não puderam ser excluídas.',
    );
    // Sem contagem válida: a frase do catálogo.
    for (const ruim of [undefined, 0, -1, 1.5, 'abc']) {
      expect(mensagemCurvaEmUso(ruim)).toBe('Esta curva está ligada a categoria(s) de manejo e não pode ser excluída.');
    }
  });
});
