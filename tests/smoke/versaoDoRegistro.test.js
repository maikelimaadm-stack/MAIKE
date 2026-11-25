/**
 * D-PROD-316 — Etapa 3 da sincronização: a versão do registro e quem alterou (app).
 *
 * VA-01 com internet, a edição leva a versão vista ao servidor
 * VA-02 sem internet, a edição vai para a fila com a versão; o registro guardado não leva o campo
 * VA-03 duas edições sem internet: juntam numa, com a versão da PRIMEIRA (a da cópia é local)
 * VA-04 editar o que ainda está sendo criado na fila: a criação não leva a versão
 * VA-05 com internet e uma edição ainda na fila: a nova vai para a fila DEPOIS dela, sem versão, e a fila é enviada
 * VA-06 conflito ao enviar: a edição fica retida com a mensagem; a seguinte do mesmo registro espera (não grava por cima)
 * VA-07 a mensagem do conflito diz quem e quando; sem detalhes, o texto do catálogo
 * VA-08 atualizarLote manda a versão vista (do registro aberto, ou a informada)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

const memoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k) || [])],
    gravarCache: async (k, r) => {
      cache.set(k, r.items);
    },
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => {
      const id = proximo++;
      fila.set(id, { ...structuredClone(i), id });
      return id;
    },
    atualizarNaFila: async (id, c) => {
      const a = fila.get(id);
      if (a) fila.set(id, { ...a, ...structuredClone(c), id });
    },
    removerDaFila: async (id) => {
      fila.delete(id);
    },
    removerCache: async (k) => {
      cache.delete(k);
    },
  };
};

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

let storage;
let rt;
let erros;

beforeEach(async () => {
  vi.resetModules();
  storage = memoria();
  rt = await import('@/lib/offline/offlineEntityRuntime');
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
  rt.resetOfflineEntityRuntime();
  erros = await import('@/apis/_core/ApiError');
  online(true);
});

afterEach(() => {
  online(true);
});

const V0 = '2026-11-25T10:00:00.000Z';

const servidor = () => {
  const gravados = new Map([['p1', { id: 'p1', empresa_id: 'emp-1', nome_ponto: 'A', updated_date: V0 }]]);
  const ops = {
    list: vi.fn(async () => [...gravados.values()]),
    create: vi.fn(async (d) => {
      gravados.set(d.id, { ...d, updated_date: new Date().toISOString() });
      return gravados.get(d.id);
    }),
    update: vi.fn(async (id, d) => {
      const { versao_esperada: _v, ...resto } = d;
      gravados.set(id, { ...gravados.get(id), ...resto, id, updated_date: new Date(Date.now() + 1000).toISOString() });
      return gravados.get(id);
    }),
    delete: vi.fn(async () => undefined),
  };
  return { gravados, ops };
};

const porta = (ops) => rt.createOfflineEntityAdapter({ entityName: 'PontoSuplementacao', operations: ops, storage, tenantScoped: true, idDoAparelho: true });
const fila = () => [...storage.fila.values()];
const conflito = () =>
  new erros.ApiError(erros.API_ERROR_CODES.REGISTRO_VERSAO_CONFLITO, {
    operation: 'update', resource: 'pontos',
    details: { entidade: 'PontoSuplementacao', alterado_por_nome: 'Maria', alterado_em: '2026-11-25T14:30:00.000Z' },
    cause: { code: 'REGISTRO_VERSAO_CONFLITO' },
  });

describe('D-PROD-316 — versão na fila do aparelho', () => {
  it('VA-01 com internet, a edição leva a versão vista', async () => {
    const { ops } = servidor();
    const p = porta(ops);
    await p.list();
    await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'B', versao_esperada: V0 });
    expect(ops.update).toHaveBeenCalledWith('p1', expect.objectContaining({ nome_ponto: 'B', versao_esperada: V0 }));
  });

  it('VA-02 sem internet: na fila com a versão; o registro guardado sem o campo', async () => {
    const { ops } = servidor();
    const p = porta(ops);
    await p.list();
    online(false);
    const r = await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'B', versao_esperada: V0 });
    expect(r.versao_esperada).toBeUndefined();
    expect(fila()).toHaveLength(1);
    expect(fila()[0].data).toMatchObject({ nome_ponto: 'B', versao_esperada: V0 });
    const guardado = (await p.list()).find((x) => x.id === 'p1');
    expect(guardado.versao_esperada).toBeUndefined();
  });

  it('VA-03 duas edições sem internet: uma só na fila, com a versão da primeira', async () => {
    const { ops } = servidor();
    const p = porta(ops);
    await p.list();
    online(false);
    await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'B', versao_esperada: V0 });
    // A tela abre a cópia do aparelho, que tem uma versão local (a hora da edição sem internet).
    await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'C', versao_esperada: '2026-11-25T12:34:56.000Z' });
    expect(fila()).toHaveLength(1);
    expect(fila()[0].data).toMatchObject({ nome_ponto: 'C', versao_esperada: V0 });
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.update).toHaveBeenCalledWith('p1', expect.objectContaining({ nome_ponto: 'C', versao_esperada: V0 }));
  });

  it('VA-04 editar o que ainda está sendo criado: a criação não leva a versão', async () => {
    const { ops } = servidor();
    const p = porta(ops);
    online(false);
    const criado = await p.create({ empresa_id: 'emp-1', nome_ponto: 'NOVO' });
    await p.update(criado.id, { empresa_id: 'emp-1', nome_ponto: 'NOVO 2', versao_esperada: criado.updated_date });
    expect(fila().map((i) => i.operation)).toEqual(['create']);
    expect(fila()[0].data.versao_esperada).toBeUndefined();
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create.mock.calls[0][0].versao_esperada).toBeUndefined();
  });

  it('VA-05 com internet e edição ainda na fila: a nova vai DEPOIS dela, sem versão, e a fila é enviada', async () => {
    const { ops, gravados } = servidor();
    const p = porta(ops);
    await p.list();
    online(false);
    await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'B', versao_esperada: V0 });
    online(true);
    ops.update.mockClear();
    const local = (await p.list()).find((x) => x.id === 'p1');
    await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'C', versao_esperada: local?.updated_date ?? 'x' });
    await vi.waitFor(() => expect(ops.update).toHaveBeenCalledTimes(2));
    expect(ops.update.mock.calls.map(([, d]) => [d.nome_ponto, d.versao_esperada])).toEqual([['B', V0], ['C', undefined]]);
    expect(gravados.get('p1').nome_ponto).toBe('C');
    expect(fila()).toHaveLength(0);
  });

  it('VA-06 conflito ao enviar: retida com a mensagem; a seguinte do mesmo registro espera', async () => {
    const { ops, gravados } = servidor();
    const p = porta(ops);
    await p.list();
    online(false);
    await p.update('p1', { empresa_id: 'emp-1', nome_ponto: 'B', versao_esperada: V0 });
    // Uma segunda edição como item próprio (como a do VA-05), sem versão.
    await storage.adicionarNaFila({ entity_name: 'PontoSuplementacao', empresa_id: 'emp-1', cliente_id: 'cli_A', operation: 'update', record_id: 'p1', data: { nome_ponto: 'C' }, created_at: new Date(Date.now() + 1).toISOString() });
    online(true);
    ops.update.mockRejectedValueOnce(conflito());
    await rt.syncOfflineEntityQueue();
    expect(ops.update).toHaveBeenCalledTimes(1);
    expect(gravados.get('p1').nome_ponto).toBe('A'); // nada gravado por cima
    const [retida, esperando] = fila();
    expect(retida.quarentena?.motivo).toMatch(/Este cocho foi alterado por Maria em/);
    expect(esperando.quarentena).toBeUndefined();
    await rt.syncOfflineEntityQueue();
    expect(ops.update).toHaveBeenCalledTimes(1); // continua esperando
  });
});

describe('D-PROD-316 — mensagem e envio da versão', () => {
  it('VA-07 a mensagem diz quem e quando; sem detalhes, o catálogo', () => {
    const m = erros.getApiErrorMessage(conflito());
    expect(m).toMatch(/^Este cocho foi alterado por Maria em \d{2}\/\d{2}\/2026 \d{2}:\d{2}, depois que você o abriu\. Abra de novo, confira e refaça a alteração\. Nada foi gravado\.$/);
    const lote = new erros.ApiError(erros.API_ERROR_CODES.REGISTRO_VERSAO_CONFLITO, { operation: 'x', resource: 'y', details: { entidade: 'Lote' } });
    expect(erros.getApiErrorMessage(lote)).toBe('Este lote foi alterado por outra pessoa, depois que você o abriu. Abra de novo, confira e refaça a alteração. Nada foi gravado.');
    const semNada = new erros.ApiError(erros.API_ERROR_CODES.REGISTRO_VERSAO_CONFLITO, { operation: 'x', resource: 'y' });
    expect(erros.getApiErrorMessage(semNada)).toMatch(/^Este registro foi alterado/);
  });

  it('VA-08 atualizarLote manda a versão vista', async () => {
    vi.resetModules();
    const updateLote = vi.fn(async (id, d) => ({ id, ...d }));
    vi.doMock('@/apis/lotes/lotesApi', async (orig) => ({ ...(await orig()), updateLote }));
    vi.doMock('@/apis', async (orig) => ({ ...(await orig()), updateLote }));
    const { atualizarLote } = await import('@/services/loteCadastroService');
    await atualizarLote('l1', { nome: 'X' }, { registroAnterior: { id: 'l1', updated_date: V0 } }).catch(() => undefined);
    await atualizarLote('l1', { nome: 'Y' }, { versaoVista: '2026-11-25T11:00:00.000Z' }).catch(() => undefined);
    await atualizarLote('l1', { nome: 'Z' }).catch(() => undefined);
    const enviados = updateLote.mock.calls.map(([, d]) => d.versao_esperada);
    expect(enviados).toEqual([V0, '2026-11-25T11:00:00.000Z', undefined]);
  });
});
