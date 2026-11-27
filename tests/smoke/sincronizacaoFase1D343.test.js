/**
 * D-PROD-343 — Fase 1 da sincronização: proteção.
 *
 *  F1-01 o cocho, a área, o ponto e a linha feitos sem internet aparecem no mapa já (antes só no cadastro); o
 *        excluído sai; a fila de outra fazenda não entra
 *  F1-02 a baixa das telas: erro do servidor conta como falha (antes aparecia "baixado"); o que o servidor diz que
 *        não existe mais sai do aparelho; sem permissão (403) não é falha
 *  F1-03 a baixa das telas para depois de 6 faltas de rede seguidas (antes: 20 s por caminho, minutos com o envio
 *        esperando)
 *  F1-04 a resposta do pedido mais antigo, chegando depois, não apaga a do mais novo
 *  F1-05 a baixa toma a vez da sincronia POR PARTE: o envio pedido no meio passa entre uma parte e outra
 *  F1-06 ao terminar a sincronização, o mapa relê a cópia nova (sem pedir ao servidor de novo)
 *  F1-07 o pedido de armazenamento protegido nunca lança
 * A volta da internet só baixa de novo depois de 3 min: tests/smoke/sincronizacaoCompletaCirculo.test.jsx (SC-02).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  online(true);
});
afterEach(() => {
  online(true);
  vi.doUnmock('@/lib/offline/offlineEntityRuntime');
  vi.doUnmock('@/apis/_core/nativeHttpClient.js');
  vi.doUnmock('@/lib/offline/leiturasOffline');
  vi.doUnmock('@/lib/offline/respostasOffline');
  vi.doUnmock('@/lib/offline/sincronizacao/vezDaSincronia.js');
  vi.doUnmock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao');
  vi.doUnmock('@/apis/offline/offlineApi');
  vi.doUnmock('@/services/mapaCacheService');
  vi.restoreAllMocks();
});

describe('D-PROD-343 — o que foi feito sem internet aparece no mapa', () => {
  it('F1-01 cocho, área, ponto e linha da fila entram no mapa; o excluído sai; outra fazenda não', async () => {
    vi.doMock('@/lib/offline/offlineEntityRuntime', async (original) => ({
      ...(await original()),
      listarItensDaFilaDeEntidades: async () => [
        { id: 1, entidade: 'PontoSuplementacao', operacao: 'create', registroId: 'cocho-novo', situacao: 'aguardando', empresaId: 'emp-1', dados: { id: 'cocho-novo', empresa_id: 'emp-1', nome_ponto: 'COCHO NOVO', coordenadas: { lat: -15, lng: -56 } } },
        { id: 2, entidade: 'AreaPastagem', operacao: 'create', registroId: 'area-nova', situacao: 'aguardando', empresaId: 'emp-1', dados: { id: 'area-nova', empresa_id: 'emp-1', nome: 'PIQUETE 9' } },
        { id: 3, entidade: 'PontoReferencia', operacao: 'delete', registroId: 'ref-1', situacao: 'aguardando', empresaId: 'emp-1', dados: { id: 'ref-1' } },
        { id: 4, entidade: 'LinhaGeografica', operacao: 'create', registroId: 'linha-B', situacao: 'aguardando', empresaId: 'emp-2', dados: { id: 'linha-B', empresa_id: 'emp-2', nome: 'CERCA B' } },
        { id: 5, entidade: 'PontoSuplementacao', operacao: 'create', registroId: 'cocho-recusado', situacao: 'recusado', empresaId: 'emp-1', dados: { id: 'cocho-recusado', empresa_id: 'emp-1' } },
      ],
    }));
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const mapa = await import('@/services/mapaCacheService');
    const ids = async (chave) => ((await mapa.getMapaCachedData(chave, 'emp-1')) ?? []).map((r) => r.id);
    const cochos = (await mapa.getMapaCachedData('pontosSuplementacao', 'emp-1')) ?? [];
    expect(cochos.map((c) => [c.id, c.status, c._isOffline])).toEqual([['cocho-novo', 'Ativo', true]]);
    expect(await ids('areas')).toEqual(['area-nova']);
    expect(await ids('pontos')).toEqual([]);
    expect(await ids('linhas')).toEqual([]);
  });
});

describe('D-PROD-343 — a baixa das telas', () => {
  const montar = async ({ caminhos, responder }) => {
    const esquecerResposta = vi.fn(async () => undefined);
    vi.doMock('@/lib/offline/leiturasOffline', async (original) => ({ ...(await original()), leiturasOfflineRegistradas: () => caminhos }));
    vi.doMock('@/lib/offline/respostasOffline', async (original) => ({ ...(await original()), listarCaminhosGuardados: async () => [], esquecerResposta }));
    const nativeRequest = vi.fn(async (caminho) => responder(caminho));
    vi.doMock('@/apis/_core/nativeHttpClient.js', async (original) => ({ ...(await original()), nativeRequest }));
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const erros = await import('@/apis/_core/ApiError');
    const api = await import('@/apis/offline/offlineApi');
    return { api, erros, nativeRequest, esquecerResposta };
  };

  it('F1-02 erro do servidor é falha; "não existe mais" sai do aparelho; sem permissão não é falha', async () => {
    let erros;
    const { api, esquecerResposta, erros: e } = await montar({
      caminhos: ['/ok', '/erro-500', '/lotes/excluido', '/sem-permissao'],
      responder: (c) => {
        if (c === '/ok') return [];
        if (c === '/erro-500') throw new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { cause: { code: 'INTERNAL_ERROR' } });
        if (c === '/lotes/excluido') throw new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { cause: { code: 'LOTE_NOT_FOUND' } });
        throw new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { cause: { code: 'ACAO_NAO_PERMITIDA' } });
      },
    });
    erros = e;
    const r = await api.baixarLeiturasDasTelas(null);
    expect(r).toMatchObject({ total: 4, falhas: 1 });
    expect(esquecerResposta).toHaveBeenCalledWith('cli_A', '/lotes/excluido');
    expect(esquecerResposta).toHaveBeenCalledTimes(1);
  });

  it('F1-03 para depois de 6 faltas de rede seguidas', async () => {
    let erros;
    const caminhos = Array.from({ length: 60 }, (_, i) => `/tela-${i}`);
    const { api, nativeRequest, erros: e } = await montar({
      caminhos,
      responder: () => {
        throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, {});
      },
    });
    erros = e;
    const r = await api.baixarLeiturasDasTelas(null);
    expect(r).toMatchObject({ total: 60, falhas: 60 });
    // 8 de cada vez: as que já tinham saído terminam; nenhuma nova sai depois das 6 seguidas.
    expect(nativeRequest.mock.calls.length).toBeLessThanOrEqual(6 + 8);
  });
});

describe('D-PROD-343 — cópia das leituras', () => {
  it('F1-04 a resposta do pedido mais antigo, chegando depois, não apaga a mais nova', async () => {
    indexedDB.deleteDatabase('maike_respostas_offline');
    const r = await import('@/lib/offline/respostasOffline');
    await r.guardarResposta('cli_A', '/pontos', [{ id: 'a' }, { id: 'novo' }], { pedido_em: 2000 });
    await r.guardarResposta('cli_A', '/pontos', [{ id: 'a' }], { pedido_em: 1000 });
    expect((await r.lerResposta('cli_A', '/pontos')).corpo).toEqual([{ id: 'a' }, { id: 'novo' }]);
    await r.guardarResposta('cli_A', '/pontos', [{ id: 'b' }], { pedido_em: 3000 });
    expect((await r.lerResposta('cli_A', '/pontos')).corpo).toEqual([{ id: 'b' }]);
    // Sem hora de pedido (gravação antiga): grava, como antes.
    await r.guardarResposta('cli_A', '/pontos', [{ id: 'c' }]);
    expect((await r.lerResposta('cli_A', '/pontos')).corpo).toEqual([{ id: 'c' }]);
  });
});

describe('D-PROD-343 — a baixa e o envio', () => {
  it('F1-05 a vez da sincronia é tomada por parte: o envio pedido no meio passa entre as partes', async () => {
    const ordem = [];
    let soltarMapa;
    let mapaComecou;
    const comecou = new Promise((r) => (mapaComecou = r));
    vi.doMock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({ sincronizarTudo: vi.fn(async () => undefined) }));
    vi.doMock('@/services/mapaCacheService', async (original) => ({
      ...(await original()),
      CACHE_KEYS: ['areas'],
      refreshMapaCacheEntryDetalhado: vi.fn(async () => {
        mapaComecou();
        await new Promise((r) => (soltarMapa = r));
        ordem.push('mapa');
        return { erro: null };
      }),
    }));
    vi.doMock('@/apis/offline/offlineApi', () => ({
      carregarTodasAsPortas: async () => undefined,
      baixarEntidadesParaOffline: async () => {
        ordem.push('cadastros');
        return { total: 1, falhas: [] };
      },
      baixarLeiturasDasTelas: async () => {
        ordem.push('telas');
        return { total: 1, falhas: 0 };
      },
    }));
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const vez = await import('@/lib/offline/sincronizacao/vezDaSincronia.js');
    const svc = await import('@/services/dadosOfflineService');
    const baixa = svc.baixarDadosParaOffline({ empresaId: 'emp-1' });
    // O envio pedido no meio do mapa não espera a baixa inteira.
    await comecou;
    const envio = vez.naVezDaSincronia(async () => ordem.push('envio'));
    soltarMapa();
    await Promise.all([baixa, envio]);
    expect(ordem.indexOf('envio')).toBeLessThan(ordem.indexOf('telas'));
  });
});

describe('D-PROD-343 — as telas abertas se atualizam', () => {
  it('F1-06 ao terminar, o mapa relê a cópia nova sem pedir ao servidor', async () => {
    vi.doMock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({ sincronizarTudo: vi.fn(async () => undefined) }));
    vi.doMock('@/services/dadosOfflineService', async (original) => ({
      ...(await original()),
      baixarDadosParaOffline: vi.fn(async () => ({ ok: true, falhas: 0, em: Date.now() })),
    }));
    const eventos = [];
    const ouvir = (e) => eventos.push(e.detail);
    window.addEventListener('atualizar-mapa', ouvir);
    const svc = await import('@/services/sincronizacaoCompletaService');
    await svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' });
    window.removeEventListener('atualizar-mapa', ouvir);
    expect(eventos).toContainEqual({ jaBuscado: true });
  });
});

describe('D-PROD-343 — armazenamento protegido', () => {
  it('F1-07 pede uma vez e nunca lança', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(window.navigator, 'storage', { value: { persist, persisted: async () => false }, configurable: true });
    const { pedirArmazenamentoPersistente } = await import('@/lib/offline/armazenamentoPersistente');
    expect(await pedirArmazenamentoPersistente()).toBe(true);
    expect(await pedirArmazenamentoPersistente()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    vi.resetModules();
    Object.defineProperty(window.navigator, 'storage', { value: { persist: async () => { throw new Error('negado'); } }, configurable: true });
    const outro = await import('@/lib/offline/armazenamentoPersistente');
    expect(await outro.pedirArmazenamentoPersistente()).toBe(false);
    Object.defineProperty(window.navigator, 'storage', { value: undefined, configurable: true });
  });
});
