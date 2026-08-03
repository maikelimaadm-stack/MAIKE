/**
 * Política do cache offline do mapa (P1.2).
 *
 * A P1.2 separou armazenamento, política e busca. Estes testes fixam a
 * **semântica preservada** — se algum item mudar, é regressão, não detalhe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const armazenamento = new Map();
const chave = (k, e) => `${k}::${e}`;

vi.mock('@/components/offline/IndexedDBManager', () => ({
  getEntityCacheItems: vi.fn(async (k, e) => armazenamento.get(chave(k, e))),
  setEntityCacheItems: vi.fn(async (k, e, items) => { armazenamento.set(chave(k, e), items); }),
}));

const listAreas = vi.fn();
const listIcones = vi.fn();
const listProdutos = vi.fn();

vi.mock('@/apis/mapa', () => ({
  listAreas: (...a) => listAreas(...a),
  listPontos: async () => [],
  listPontosSuplementacao: async () => [],
  listLinhas: async () => [],
  listIcones: (...a) => listIcones(...a),
}));
vi.mock('@/apis/lotes', () => ({
  listLotes: async () => [],
  listMovimentacoes: async () => [],
  listSuplementacaoEventos: async () => [],
  listSuplementacaoLotes: async () => [],
}));
vi.mock('@/apis/estoque', () => ({
  listLotesNota: async () => [],
  listMovimentacoes: async () => [],
  listProdutos: (...a) => listProdutos(...a),
}));
vi.mock('@/apis/tarefas', () => ({ listLancamentos: async () => [], listHistorico: async () => [] }));
vi.mock('@/apis/session', () => ({ listPermissoes: async () => [] }));
vi.mock('@/apis/rebanho', () => ({
  listAplicacoesMedicamento: async () => [],
  listEventosSanitarios: async () => [],
  listManejosTecnicos: async () => [],
}));

const {
  getMapaCachedData,
  refreshMapaCacheEntry,
  updateMapaCachedData,
  warmMapaCache,
  temCapacidade,
  CACHE_KEYS,
  MIN_REFRESH_INTERVAL_MS,
  GLOBAL_EMPRESA_KEY,
  __resetMapaCachePolicy,
} = await import('@/services/mapaCacheService');
const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const EMPRESA = 'empresa-1';
const areaDa = (id) => ({ id, empresa_id: EMPRESA, ativo: true });

beforeEach(() => {
  armazenamento.clear();
  __resetMapaCachePolicy();
  vi.clearAllMocks();
  vi.useFakeTimers();
  listAreas.mockResolvedValue([areaDa('a1')]);
  listIcones.mockResolvedValue([{ id: 'i1', ativo: true }]);
  listProdutos.mockResolvedValue([{ id: 'p1', empresa_id: EMPRESA, ativo: true }]);
});
afterEach(() => vi.useRealTimers());

describe('cache do mapa — leitura e escrita', () => {
  it('C1 — devolve o que está em cache sem chamar a API', async () => {
    armazenamento.set(chave('mapa_areas', EMPRESA), [areaDa('cacheada')]);
    const itens = await getMapaCachedData('areas', EMPRESA);
    expect(itens).toEqual([areaDa('cacheada')]);
    expect(listAreas).not.toHaveBeenCalled();
  });

  it('C2 — sem cache, busca na API e grava', async () => {
    const itens = await refreshMapaCacheEntry('areas', EMPRESA);
    expect(itens).toEqual([areaDa('a1')]);
    expect(armazenamento.get(chave('mapa_areas', EMPRESA))).toEqual([areaDa('a1')]);
  });

  /**
   * C3 — o padrão que a UI aplica: ler o cache, devolver, e só então revalidar.
   *
   * O que se prova aqui é a ordem. O dado antigo tem de chegar ao chamador
   * **antes** de a rede responder; se o `getMapaCachedData` esperasse o
   * refresh, o mapa ficaria em branco a cada abertura com rede lenta.
   */
  it('C3 — stale-while-revalidate entrega o cache antes do refresh terminar', async () => {
    armazenamento.set(chave('mapa_areas', EMPRESA), [areaDa('antiga')]);
    let concluirBusca;
    listAreas.mockReturnValue(new Promise((r) => { concluirBusca = r; }));

    const ordem = [];
    const cacheada = await getMapaCachedData('areas', EMPRESA);
    ordem.push('cache');
    expect(cacheada).toEqual([areaDa('antiga')]);

    const revalidacao = refreshMapaCacheEntry('areas', EMPRESA).then((fresca) => {
      ordem.push('rede');
      return fresca;
    });

    concluirBusca([areaDa('nova')]);
    const fresca = await revalidacao;

    expect(ordem).toEqual(['cache', 'rede']);
    expect(fresca).toEqual([areaDa('nova')]);
    expect(armazenamento.get(chave('mapa_areas', EMPRESA))).toEqual([areaDa('nova')]);
  });

  it('C4 — chamadas concorrentes deduplicam numa única busca', async () => {
    let resolver;
    listAreas.mockReturnValue(new Promise((r) => { resolver = r; }));
    const p1 = refreshMapaCacheEntry('areas', EMPRESA);
    const p2 = refreshMapaCacheEntry('areas', EMPRESA);
    resolver([areaDa('a1')]);
    await Promise.all([p1, p2]);
    expect(listAreas).toHaveBeenCalledTimes(1);
  });

  it('C5 — dentro do intervalo mínimo não busca de novo', async () => {
    await refreshMapaCacheEntry('areas', EMPRESA);
    expect(listAreas).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS - 1);
    await refreshMapaCacheEntry('areas', EMPRESA);
    expect(listAreas).toHaveBeenCalledTimes(1);
  });

  it('C5b — passado o intervalo mínimo, busca de novo', async () => {
    await refreshMapaCacheEntry('areas', EMPRESA);
    vi.advanceTimersByTime(MIN_REFRESH_INTERVAL_MS + 1);
    await refreshMapaCacheEntry('areas', EMPRESA);
    expect(listAreas).toHaveBeenCalledTimes(2);
  });

  it('C6 — force ignora o intervalo mínimo', async () => {
    await refreshMapaCacheEntry('areas', EMPRESA);
    await refreshMapaCacheEntry('areas', EMPRESA, { force: true });
    expect(listAreas).toHaveBeenCalledTimes(2);
  });

  it('C7 — erro retryable ativa cooldown e devolve o cache', async () => {
    armazenamento.set(chave('mapa_areas', EMPRESA), [areaDa('antiga')]);
    listAreas.mockRejectedValue(new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'listAreas' }));

    const itens = await refreshMapaCacheEntry('areas', EMPRESA, { force: true });
    expect(itens).toEqual([areaDa('antiga')]);

    listAreas.mockResolvedValue([areaDa('nova')]);
    vi.advanceTimersByTime(1000);
    const durante = await refreshMapaCacheEntry('areas', EMPRESA);
    expect(durante).toEqual([areaDa('antiga')]);
  });

  it('C8 — a decisão de cooldown não olha o texto do erro', async () => {
    // Só o código: o comentário que documenta a abordagem antiga cita o texto
    // de propósito, e não pode reprovar o teste.
    const codigo = (await import('node:fs'))
      .readFileSync('src/services/mapaCacheService.js', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(codigo).not.toContain('rate limit exceeded');
    expect(codigo).not.toContain('network error');
    expect(codigo).not.toMatch(/error\??\.message/);
  });

  it('C9/C10 — a promise sai do mapa após sucesso e após falha', async () => {
    await refreshMapaCacheEntry('areas', EMPRESA);
    listAreas.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 'x' }));
    await refreshMapaCacheEntry('areas', EMPRESA, { force: true });
    listAreas.mockResolvedValue([areaDa('depois')]);
    const itens = await refreshMapaCacheEntry('areas', EMPRESA, { force: true });
    expect(itens).toEqual([areaDa('depois')]);
  });

  it('C11 — empresa ausente usa a chave global', async () => {
    await refreshMapaCacheEntry('icones', null);
    expect(armazenamento.has(chave('mapa_icones', GLOBAL_EMPRESA_KEY))).toBe(true);
  });

  it('C12 — produtos tem capacidade real; antes a query voltava vazia em silêncio', async () => {
    expect(temCapacidade('produtos')).toBe(true);
    expect(CACHE_KEYS).toContain('produtos');
    const itens = await refreshMapaCacheEntry('produtos', EMPRESA);
    expect(listProdutos).toHaveBeenCalled();
    expect(itens).toEqual([{ id: 'p1', empresa_id: EMPRESA, ativo: true }]);
  });

  it('C13 — warmMapaCache cobre todas as chaves', async () => {
    await warmMapaCache(EMPRESA);
    for (const k of CACHE_KEYS) {
      const empresa = k === 'icones' || k === 'permissoes' ? GLOBAL_EMPRESA_KEY : EMPRESA;
      expect(armazenamento.has(chave(`mapa_${k}`, empresa)), k).toBe(true);
    }
  });

  it('C14 — updater funcional recebe o conteúdo atual e não muta o anterior', async () => {
    const originais = [areaDa('a1')];
    armazenamento.set(chave('mapa_areas', EMPRESA), originais);
    const proximos = await updateMapaCachedData('areas', EMPRESA, (atuais) => [...atuais, areaDa('a2')]);
    expect(proximos).toHaveLength(2);
    expect(originais).toHaveLength(1);
  });

  it('capacidade inexistente devolve lista vazia sem quebrar', async () => {
    expect(await refreshMapaCacheEntry('nao-existe', EMPRESA)).toEqual([]);
  });
});
