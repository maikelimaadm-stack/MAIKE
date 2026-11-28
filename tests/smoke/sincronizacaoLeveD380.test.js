/**
 * D-PROD-380 — a sincronização do dia a dia é LEVE (como o AgriWebb): envia o que está no celular e baixa só o que
 * mudou (as listas do mapa que o servidor entrega por `/mudancas`), sem o mapa inteiro, os cadastros e as telas.
 *
 * SL-01 envia antes; atualiza só as chaves da leve, com `force`; marca a leve e NÃO marca a baixa completa
 * SL-02 sem internet não faz nada
 * SL-03 tudo falhou: não marca a leve; "sem capacidade" não conta como falha
 * SL-04 outra conta entrou no meio: não marca nada nela
 * SL-05 o logout esquece a data da leve
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ordem = [];
const tenant = vi.hoisted(() => ({ atual: 'cli-1' }));
const respostaDoMapa = vi.hoisted(() => ({ porChave: /** @type {Record<string, string|null>} */ ({}) }));

vi.mock('@/lib/offline/offlineTenant', () => ({ getOfflineTenant: () => tenant.atual }));
vi.mock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({
  sincronizarTudo: vi.fn(async () => {
    ordem.push('envio');
  }),
}));
vi.mock('@/lib/offline/sincronizacao/vezDaSincronia', () => ({ naVezDaSincronia: (fn) => fn() }));
vi.mock('@/services/mapaCacheService', () => ({
  CACHE_KEYS: ['areas', 'lotes', 'pontos', 'pontosSuplementacao', 'linhas', 'eventosSuplementacao', 'leiturasCocho', 'tarefas', 'produtos'],
  refreshMapaCacheEntryDetalhado: vi.fn(async (chave, _empresa, opcoes) => {
    ordem.push(`mapa:${chave}:${opcoes?.force ? 'force' : ''}`);
    return { dados: [], origem: 'rede', erro: respostaDoMapa.porChave[chave] ?? null };
  }),
}));
vi.mock('@/apis/offline', () => ({
  baixarLeiturasDasTelas: vi.fn(),
  baixarEntidadesParaOffline: vi.fn(),
  carregarTodasAsPortas: vi.fn(),
}));
vi.mock('@/lib/offline/respostasOffline', () => ({ esquecerRespostasDoTenant: vi.fn(async () => undefined) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => []) }));

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

let svc;
beforeEach(async () => {
  vi.resetModules();
  ordem.length = 0;
  tenant.atual = 'cli-1';
  respostaDoMapa.porChave = {};
  window.localStorage.clear();
  online(true);
  svc = await import('@/services/dadosOfflineService');
});

describe('D-PROD-380 — sincronização leve', () => {
  it('SL-01 envia antes; só as chaves da leve, com force; marca a leve e não a completa', async () => {
    const r = await svc.baixarSoOQueMudou({ empresaId: 'emp-1' });
    expect(r).toMatchObject({ ok: true, falhas: 0 });
    expect(r.em).toBeTypeOf('number');
    expect(ordem[0]).toBe('envio');
    const chaves = ordem.slice(1).map((x) => x.split(':')[1]);
    expect(chaves.sort()).toEqual([...svc.CHAVES_DA_SINCRONIA_LEVE].sort());
    expect(ordem.slice(1).every((x) => x.endsWith(':force'))).toBe(true);
    // Áreas, produtos e o resto do mapa não entram na leve.
    expect(chaves).not.toContain('areas');
    expect(chaves).not.toContain('produtos');
    const { baixarEntidadesParaOffline, baixarLeiturasDasTelas } = await import('@/apis/offline');
    expect(baixarEntidadesParaOffline).not.toHaveBeenCalled();
    expect(baixarLeiturasDasTelas).not.toHaveBeenCalled();
    expect(svc.ultimaSincronizacaoLeve()).toBe(r.em);
    expect(svc.ultimaBaixaDosDados(), 'a leve não conta como baixa completa').toBe(null);
  });

  it('SL-02 sem internet não faz nada', async () => {
    online(false);
    expect(await svc.baixarSoOQueMudou({ empresaId: 'emp-1' })).toEqual({ ok: false, falhas: 0, em: null });
    expect(ordem).toEqual([]);
    expect(svc.ultimaSincronizacaoLeve()).toBe(null);
  });

  it('SL-03 tudo falhou: não marca; "sem capacidade" não é falha', async () => {
    for (const chave of svc.CHAVES_DA_SINCRONIA_LEVE) respostaDoMapa.porChave[chave] = 'API_OPERATION_FAILED';
    expect(await svc.baixarSoOQueMudou({ empresaId: 'emp-1' })).toMatchObject({ ok: false, em: null });
    expect(svc.ultimaSincronizacaoLeve()).toBe(null);
    respostaDoMapa.porChave = { lotes: 'SEM_CAPACIDADE', tarefas: 'API_OPERATION_FAILED' };
    const r = await svc.baixarSoOQueMudou({ empresaId: 'emp-1' });
    expect(r).toMatchObject({ ok: false, falhas: 1 });
    expect(r.em).toBeTypeOf('number');
    expect(svc.ultimaSincronizacaoLeve()).toBe(r.em);
  });

  it('SL-04 outra conta entrou no meio: não marca nada nela', async () => {
    const { refreshMapaCacheEntryDetalhado } = await import('@/services/mapaCacheService');
    vi.mocked(refreshMapaCacheEntryDetalhado).mockImplementationOnce(async () => {
      tenant.atual = 'cli-2';
      return { dados: [], origem: 'rede', erro: null };
    });
    expect(await svc.baixarSoOQueMudou({ empresaId: 'emp-1' })).toMatchObject({ ok: false, em: null });
    expect(svc.ultimaSincronizacaoLeve()).toBe(null);
    tenant.atual = 'cli-1';
    expect(svc.ultimaSincronizacaoLeve()).toBe(null);
  });

  it('SL-05 o logout esquece a data da leve', async () => {
    await svc.baixarSoOQueMudou({ empresaId: 'emp-1' });
    expect(svc.ultimaSincronizacaoLeve()).not.toBe(null);
    svc.esquecerDadosOfflineDoTenant('cli-1');
    expect(svc.ultimaSincronizacaoLeve()).toBe(null);
  });
});
