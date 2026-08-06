/**
 * Runtime offline provider-agnostic (P1.4).
 *
 * O antecessor não tinha teste nenhum: era um monkey patch sobre o SDK, e
 * exercitá-lo exigia o SDK. Agora o runtime recebe operações já resolvidas e
 * uma **porta de armazenamento**, então a fila, o replay e o mapeamento de ids
 * são verificáveis em memória, sem IndexedDB e sem rede.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  createOfflineEntityAdapter,
  syncOfflineEntityQueue,
  resetOfflineEntityRuntime,
  getOfflineEntityNames,
  getOfflineSyncEventName,
  offlineStorageDisponivel,
  instalarSincronizacaoAoVoltarOnline,
} = await import('@/lib/offline/offlineEntityRuntime');
const { API_ERROR_CODES } = await import('@/apis/_core/ApiError');

/** Porta em memória com o mesmo contrato do armazenamento IndexedDB. */
const criarArmazenamentoEmMemoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximoId = 1;

  return {
    cache,
    fila,
    lerCache: async (chave) => [...(cache.get(chave) || [])],
    gravarCache: async (chave, registro) => { cache.set(chave, registro.items); },
    listarFila: async () => [...fila.values()],
    adicionarNaFila: async (item) => {
      const id = proximoId++;
      fila.set(id, { ...item, id });
      return id;
    },
    atualizarNaFila: async (id, campos) => {
      const atual = fila.get(id);
      if (atual) fila.set(id, { ...atual, ...campos, id });
    },
    removerDaFila: async (id) => { fila.delete(id); },
  };
};

const criarOperacoes = () => ({
  list: vi.fn(async () => []),
  filter: vi.fn(async () => []),
  create: vi.fn(async (dados) => ({ id: `srv_${dados.nome}`, ...dados })),
  update: vi.fn(async (id, dados) => ({ id, ...dados })),
  delete: vi.fn(async () => undefined),
});

const ficarOffline = () => Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
const ficarOnline = () => Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

beforeEach(() => {
  resetOfflineEntityRuntime();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  ficarOnline();
});

afterEach(() => {
  resetOfflineEntityRuntime();
  ficarOnline();
});

describe('OFF1–OFF3 — composição e capacidade', () => {
  it('OFF1 — desabilitado devolve as operações intactas', () => {
    const operacoes = criarOperacoes();
    const adapter = createOfflineEntityAdapter({ entityName: 'Lote', operations: operacoes, enabled: false });
    expect(adapter).toBe(operacoes);
    expect(getOfflineEntityNames()).toEqual([]);
  });

  it('OFF2 — o runtime não pretende persistência sem IndexedDB', () => {
    // jsdom não implementa IndexedDB. A checagem é honesta: sem armazenamento,
    // o provider desliga o offline em vez de fingir fila durável.
    expect(offlineStorageDisponivel()).toBe(false);
  });

  it('OFF3 — nome vazio ou operações ausentes são erro de programação', () => {
    expect(() => createOfflineEntityAdapter({ entityName: '', operations: {} })).toThrow();
    expect(() => createOfflineEntityAdapter({ entityName: 'Lote', operations: null })).toThrow();
  });
});

describe('OFF4–OFF8 — leitura, escrita e fila', () => {
  let storage;
  let operacoes;
  let adapter;

  beforeEach(() => {
    storage = criarArmazenamentoEmMemoria();
    operacoes = criarOperacoes();
    adapter = createOfflineEntityAdapter({ entityName: 'Lote', operations: operacoes, storage });
  });

  it('OFF4 — online, o list vai à rede, alimenta o cache e devolve a mesma lista', async () => {
    operacoes.list.mockResolvedValue([{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }]);
    const r = await adapter.list('-created_date');
    expect(operacoes.list).toHaveBeenCalledWith('-created_date', undefined);
    expect(r.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(storage.cache.get('Lote::emp-1')).toHaveLength(2);
  });

  it('OFF5 — offline, o list sai do cache sem tocar na rede', async () => {
    await storage.gravarCache('Lote::emp-1', { items: [{ id: 'a', nome: 'A' }] });
    ficarOffline();
    const r = await adapter.list();
    expect(operacoes.list).not.toHaveBeenCalled();
    expect(r).toEqual([{ id: 'a', nome: 'A' }]);
  });

  it('OFF6 — filter offline aplica critério, ordem e limite sobre o cache', async () => {
    await storage.gravarCache('Lote::emp-1', {
      items: [
        { id: 'a', status: 'Ativo', nome: 'C' },
        { id: 'b', status: 'Inativo', nome: 'B' },
        { id: 'c', status: 'Ativo', nome: 'A' },
      ],
    });
    ficarOffline();
    const r = await adapter.filter({ status: 'Ativo' }, 'nome');
    expect(r.map((x) => x.id)).toEqual(['c', 'a']);
  });

  it('OFF7 — create offline gera id temporário, entra no cache e enfileira', async () => {
    ficarOffline();
    const criado = await adapter.create({ nome: 'NOVO' });

    expect(operacoes.create).not.toHaveBeenCalled();
    expect(criado.id.startsWith('offline_Lote_')).toBe(true);
    expect(criado._isOffline).toBe(true);

    const fila = await storage.listarFila();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ entity_name: 'Lote', operation: 'create', record_id: criado.id });

    // A leitura seguinte já enxerga o registro pendente.
    expect((await adapter.list()).map((x) => x.id)).toContain(criado.id);
  });

  it('OFF8 — update offline acumula no mesmo item de fila', async () => {
    await storage.gravarCache('Lote::emp-1', { items: [{ id: 'srv1', nome: 'A' }] });
    ficarOffline();

    await adapter.update('srv1', { nome: 'B' });
    await adapter.update('srv1', { peso: 10 });

    const fila = await storage.listarFila();
    expect(fila).toHaveLength(1);
    expect(fila[0].data).toEqual({ nome: 'B', peso: 10 });
  });

  it('OFF9 — delete de criação pendente some da fila, sem virar delete', async () => {
    ficarOffline();
    const criado = await adapter.create({ nome: 'NOVO' });
    await adapter.delete(criado.id);

    expect(await storage.listarFila()).toEqual([]);
    expect(operacoes.delete).not.toHaveBeenCalled();
  });

  it('OFF10 — delete de registro do servidor enfileira exclusão', async () => {
    await storage.gravarCache('Lote::emp-1', { items: [{ id: 'srv1' }] });
    ficarOffline();
    await adapter.delete('srv1');

    const fila = await storage.listarFila();
    expect(fila[0]).toMatchObject({ operation: 'delete', record_id: 'srv1' });
    expect(await adapter.list()).toEqual([]);
  });

  it('OFF11 — cada mudança de fila emite o evento, uma vez por operação', async () => {
    const ouvinte = vi.fn();
    window.addEventListener(getOfflineSyncEventName(), ouvinte);
    ficarOffline();

    await adapter.create({ nome: 'A' });
    await adapter.create({ nome: 'B' });

    expect(ouvinte).toHaveBeenCalledTimes(2);
    window.removeEventListener(getOfflineSyncEventName(), ouvinte);
  });
});

describe('OFF12–OFF16 — replay', () => {
  let storage;
  let operacoes;
  let adapter;

  beforeEach(() => {
    storage = criarArmazenamentoEmMemoria();
    operacoes = criarOperacoes();
    adapter = createOfflineEntityAdapter({ entityName: 'Lote', operations: operacoes, storage });
  });

  it('OFF12 — replay em ordem de chegada e fila esvaziada', async () => {
    ficarOffline();
    await adapter.create({ nome: 'A' });
    await adapter.create({ nome: 'B' });
    ficarOnline();

    const r = await syncOfflineEntityQueue();
    expect(r.success).toBe(true);
    expect(operacoes.create.mock.calls.map(([d]) => d.nome)).toEqual(['A', 'B']);
    expect(await storage.listarFila()).toEqual([]);
  });

  it('OFF13 — o id temporário não é enviado ao servidor', async () => {
    ficarOffline();
    await adapter.create({ nome: 'A' });
    ficarOnline();
    await syncOfflineEntityQueue();

    const payload = operacoes.create.mock.calls[0][0];
    expect(payload.id).toBeUndefined();
    expect(payload._isOffline).toBeUndefined();
  });

  it('OFF14 — id offline referenciado em outro payload é substituído pelo id real', async () => {
    ficarOffline();
    const pai = await adapter.create({ nome: 'PAI' });
    await adapter.create({ nome: 'FILHO', pai_id: pai.id });
    ficarOnline();

    await syncOfflineEntityQueue();

    const segundoPayload = operacoes.create.mock.calls[1][0];
    expect(segundoPayload.pai_id).toBe('srv_PAI');
  });

  it('OFF15 — update de registro nunca criado no servidor não é enviado', async () => {
    ficarOffline();
    const criado = await adapter.create({ nome: 'A' });
    // Marca o item como update pendente de um id offline sem criação na fila.
    storage.fila.clear();
    await storage.adicionarNaFila({
      entity_name: 'Lote', empresa_id: 'emp-1', operation: 'update',
      record_id: criado.id, data: { nome: 'B' }, created_at: new Date().toISOString(),
    });
    ficarOnline();

    const r = await syncOfflineEntityQueue();
    expect(r.success).toBe(true);
    expect(operacoes.update).not.toHaveBeenCalled();
  });

  it('OFF16 — entidade desconhecida falha explicitamente e a fila é preservada', async () => {
    ficarOffline();
    await adapter.create({ nome: 'A' });
    await storage.adicionarNaFila({
      entity_name: 'EntidadeQueNinguemRegistrou', empresa_id: 'emp-1', operation: 'create',
      record_id: 'x', data: { id: 'x' }, created_at: new Date(Date.now() + 1000).toISOString(),
    });
    ficarOnline();

    const r = await syncOfflineEntityQueue();

    expect(r.success).toBe(false);
    expect(r.code).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);
    expect(r.pendentes).toBe(1);
    // O item desconhecido continua lá: nunca é descartado em silêncio.
    const restante = await storage.listarFila();
    expect(restante).toHaveLength(1);
    expect(restante[0].entity_name).toBe('EntidadeQueNinguemRegistrou');
  });

  it('OFF17 — falha de rede no meio para o replay e preserva o que faltou', async () => {
    ficarOffline();
    await adapter.create({ nome: 'A' });
    await adapter.create({ nome: 'B' });
    ficarOnline();

    operacoes.create
      .mockResolvedValueOnce({ id: 'srv_A' })
      .mockRejectedValueOnce(new Error('rede caiu'));

    const r = await syncOfflineEntityQueue();
    expect(r.success).toBe(false);
    expect(r.pendentes).toBe(1);
    expect(await storage.listarFila()).toHaveLength(1);
  });

  it('OFF18 — offline, o replay nem começa', async () => {
    ficarOffline();
    expect(await syncOfflineEntityQueue()).toEqual({ success: false, code: 'OFFLINE' });
  });
});

describe('OFF19 — listener único', () => {
  it('instalar duas vezes registra um só listener', () => {
    const espiao = vi.spyOn(window, 'addEventListener');
    instalarSincronizacaoAoVoltarOnline();
    instalarSincronizacaoAoVoltarOnline();
    instalarSincronizacaoAoVoltarOnline();

    const online = espiao.mock.calls.filter(([evento]) => evento === 'online');
    expect(online).toHaveLength(1);
    espiao.mockRestore();
  });
});

describe('OFF20 — normalização preservada na composição', () => {
  it('o texto continua sendo normalizado por dentro do runtime offline', async () => {
    const { createNormalizedEntityAdapter } = await import('@/lib/textNormalization');
    const storage = criarArmazenamentoEmMemoria();

    const rede = {
      list: vi.fn(async () => [{ id: 'a', nome: 'joão   da   silva' }]),
      create: vi.fn(async (dados) => ({ id: 'a', ...dados })),
    };

    const adapter = createOfflineEntityAdapter({
      entityName: 'Lote',
      operations: createNormalizedEntityAdapter({ entityName: 'Lote', endpoint: rede }),
      storage,
    });

    // Saída formatada para exibição…
    const lista = await adapter.list();
    expect(lista[0].nome).toBe('João Da Silva');
    // …e o cache guarda o mesmo formato que a tela veria.
    expect(storage.cache.get('Lote::emp-1')[0].nome).toBe('João Da Silva');

    // Entrada normalizada para armazenamento.
    await adapter.create({ nome: '  MILHO   GRÃO ' });
    expect(rede.create).toHaveBeenCalledWith({ nome: 'milho grão' });
  });
});
