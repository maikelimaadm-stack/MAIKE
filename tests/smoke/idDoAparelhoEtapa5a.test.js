/**
 * D-PROD-319 — Etapa 5a: id do aparelho na medição de forragem, na tarefa do mapa e no evento de suplementação; e
 * as tarefas que ficaram presas no armazenamento antigo do aparelho voltam a subir.
 *
 * Cadeia real `porta → fila de cadastros (IndexedDB em memória) → nativeHttpClient`, com `fetch` substituído.
 *
 * AP-01 medição sem internet: nasce com o id definitivo (UUID); ao enviar, o id vai junto (e só os campos aceitos)
 * AP-02 tarefa sem internet: o mesmo
 * AP-03 evento de suplementação sem internet: o mesmo
 * AP-04 com internet, a criação da tarefa que não chega a uma resposta vai para a fila com o MESMO id
 * RT-01 tarefa presa no armazenamento antigo: sobe com as fotos e um id do aparelho; sai do armazenamento antigo
 * RT-02 recusada pelo servidor: fica guardada com o id e as fotos já enviadas; a próxima tentativa não repete as fotos
 *       e usa o MESMO id
 * RT-03 a rede cai no envio: vai para a fila de cadastros com o mesmo id e sai do armazenamento antigo
 * RT-04 sem internet: nada é tentado
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

let online = true;

/** Servidor falso: grava pelo id que chega (repetir devolve o mesmo). */
const servidor = () => {
  const s = {
    chamadas: /** @type {Array<{metodo: string, caminho: string, corpo: any}>} */ ([]),
    gravados: new Map(),
    falhar: /** @type {null | 'rede' | number} */ (null),
    uploads: 0,
  };
  s.fetch = vi.fn(async (url, init = {}) => {
    const metodo = init.method || 'GET';
    const caminho = String(url).replace(`${API}/api/native`, '').split('?')[0];
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    s.chamadas.push({ metodo, caminho, corpo });
    if (metodo === 'POST' && caminho === '/arquivos/upload') {
      s.uploads += 1;
      return respostaJson(201, { file_url: `https://arquivos.exemplo.invalido/foto-${s.uploads}.jpg` });
    }
    if (metodo === 'POST') {
      if (s.falhar === 'rede') {
        s.falhar = null;
        throw new TypeError('Failed to fetch');
      }
      if (typeof s.falhar === 'number') return respostaJson(s.falhar, { code: 'REQUEST_VALIDATION_FAILED', message: 'recusado' });
      const id = corpo?.id ?? `srv_${s.gravados.size + 1}`;
      if (!s.gravados.has(id)) s.gravados.set(id, { ...corpo, id });
      return respostaJson(201, s.gravados.get(id));
    }
    if (metodo === 'GET') return respostaJson(200, []);
    return respostaJson(200, {});
  });
  return s;
};

const carregar = async () => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const rt = await import('@/lib/offline/offlineEntityRuntime');
  return { rt };
};

const apagarBancos = () =>
  Promise.all(
    ['pesagens_offline_db'].map(
      (nome) =>
        new Promise((r) => {
          const pedido = indexedDB.deleteDatabase(nome);
          pedido.onsuccess = pedido.onerror = pedido.onblocked = () => r(undefined);
        })
    )
  );

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  await apagarBancos();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const envioDe = (srv, caminho) => srv.chamadas.filter((c) => c.metodo === 'POST' && c.caminho === caminho);

describe('D-PROD-319 — criação sem internet com o id do aparelho', () => {
  it('AP-01 medição: nasce com o UUID; ao enviar, o id vai junto e só os campos aceitos', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt } = await carregar();
    const { medicaoForragemPort } = await import('@/apis/medicoes-forragem/medicaoForragemNativePort');
    online = false;
    const criada = await medicaoForragemPort.create({ empresa_id: 'emp-1', area_id: 'a1', data_medicao: '2026-11-26', metodo: 'OLHO', situacao: 'PRONTO', altura_media_cm: 9 });
    expect(criada.id).toMatch(UUID);
    expect(criada._isOffline).toBe(true);
    expect(srv.fetch).not.toHaveBeenCalled();
    online = true;
    await rt.syncOfflineEntityQueue();
    const [envio] = envioDe(srv, '/medicoes-forragem');
    expect(envio.corpo).toEqual({ id: criada.id, empresa_id: 'emp-1', area_id: 'a1', data_medicao: '2026-11-26', metodo: 'OLHO', situacao: 'PRONTO' });
  });

  it('AP-02 tarefa: nasce com o UUID; ao enviar, o id vai junto', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt } = await carregar();
    const { createLancamento } = await import('@/apis/tarefas');
    online = false;
    const criada = await createLancamento({ empresa_id: 'emp-1', titulo: 'Arrumar cerca', tipo: 'Manejo', tipo_tarefa_id: 't1' });
    expect(criada.id).toMatch(UUID);
    online = true;
    await rt.syncOfflineEntityQueue();
    const [envio] = envioDe(srv, '/lancamentos-tarefa');
    expect(envio.corpo).toMatchObject({ id: criada.id, titulo: 'Arrumar cerca', tipo_tarefa_id: 't1' });
  });

  it('AP-03 evento de suplementação: nasce com o UUID; ao enviar, o id vai junto', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt } = await carregar();
    const { suplementacaoEventoPort } = await import('@/apis/suplementacao-eventos/suplementacaoEventoNativePort');
    online = false;
    const criado = await suplementacaoEventoPort.create({ empresa_id: 'emp-1', area_id: 'a1', data_lancamento: '2026-11-26', quantidade_total_kg: 0, sobra_kg: 3 });
    expect(criado.id).toMatch(UUID);
    online = true;
    await rt.syncOfflineEntityQueue();
    const [envio] = envioDe(srv, '/suplementacao-eventos');
    expect(envio.corpo.id).toBe(criado.id);
    expect(envio.corpo._isOffline).toBeUndefined();
  });

  it('AP-04 com internet, a criação da tarefa que não chega a uma resposta vai para a fila com o mesmo id', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt } = await carregar();
    const { createLancamento } = await import('@/apis/tarefas');
    srv.falhar = 'rede';
    const criada = await createLancamento({ empresa_id: 'emp-1', titulo: 'Cerca', tipo: 'Manejo', tipo_tarefa_id: 't1' });
    expect(criada.id).toMatch(UUID);
    expect(criada._isOffline).toBe(true);
    const [primeira] = envioDe(srv, '/lancamentos-tarefa');
    expect(primeira.corpo.id).toBe(criada.id);
    await rt.syncOfflineEntityQueue();
    const envios = envioDe(srv, '/lancamentos-tarefa');
    expect(envios).toHaveLength(2);
    expect(envios[1].corpo.id).toBe(criada.id);
    expect(srv.gravados.size).toBe(1);
  });
});

describe('D-PROD-319 — tarefas presas no armazenamento antigo', () => {
  const guardar = async (extra = {}) => {
    const idb = await import('@/components/offline/IndexedDBManager');
    const chave = await idb.saveTarefaOffline('create', { empresa_id: 'emp-1', titulo: 'Bebedouro vazando', tipo: 'Manejo', tipo_tarefa_id: 't1', ...extra });
    // O que a tela guardava: nome, tipo e o conteúdo (o jsdom não tem `File.arrayBuffer`).
    await idb.saveTarefaImageOffline(chave, { name: 'foto.jpg', type: 'image/jpeg', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    return { idb, chave };
  };

  it('RT-01 sobe com as fotos e um id do aparelho; sai do armazenamento antigo', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    await carregar();
    const { idb } = await guardar();
    const { enviarTarefasGuardadasNoAparelho } = await import('@/services/tarefasGuardadasNoAparelhoService');
    expect(await enviarTarefasGuardadasNoAparelho()).toEqual({ enviadas: 1, ficaram: 0 });
    expect(srv.uploads).toBe(1);
    const [envio] = envioDe(srv, '/lancamentos-tarefa');
    expect(envio.corpo.id).toMatch(UUID);
    expect(envio.corpo).toMatchObject({ titulo: 'Bebedouro vazando', fotos: ['https://arquivos.exemplo.invalido/foto-1.jpg'] });
    expect(envio.corpo._offlineId).toBeUndefined();
    expect(await idb.getPendingTarefas()).toEqual([]);
    expect(await idb.getAllPendingTarefaImages()).toEqual([]);
  });

  it('RT-02 recusada: fica guardada; a próxima tentativa não repete as fotos e usa o mesmo id', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    await carregar();
    const { idb } = await guardar();
    const { enviarTarefasGuardadasNoAparelho } = await import('@/services/tarefasGuardadasNoAparelhoService');
    srv.falhar = 400;
    expect(await enviarTarefasGuardadasNoAparelho()).toEqual({ enviadas: 0, ficaram: 1 });
    const [guardada] = await idb.getPendingTarefas();
    expect(guardada._id_do_aparelho).toMatch(UUID);
    expect(guardada._fotos_enviadas).toEqual(['https://arquivos.exemplo.invalido/foto-1.jpg']);
    srv.falhar = null;
    expect(await enviarTarefasGuardadasNoAparelho()).toEqual({ enviadas: 1, ficaram: 0 });
    expect(srv.uploads).toBe(1);
    const envios = envioDe(srv, '/lancamentos-tarefa');
    expect(envios.map((e) => e.corpo.id)).toEqual([guardada._id_do_aparelho, guardada._id_do_aparelho]);
    expect(await idb.getPendingTarefas()).toEqual([]);
  });

  it('RT-03 a rede cai no envio: vai para a fila de cadastros com o mesmo id e sai do armazenamento antigo', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt } = await carregar();
    const { idb } = await guardar();
    const { enviarTarefasGuardadasNoAparelho } = await import('@/services/tarefasGuardadasNoAparelhoService');
    srv.falhar = 'rede';
    expect(await enviarTarefasGuardadasNoAparelho()).toEqual({ enviadas: 1, ficaram: 0 });
    expect(await idb.getPendingTarefas()).toEqual([]);
    const [primeira] = envioDe(srv, '/lancamentos-tarefa');
    await rt.syncOfflineEntityQueue();
    const envios = envioDe(srv, '/lancamentos-tarefa');
    expect(envios).toHaveLength(2);
    expect(envios[1].corpo.id).toBe(primeira.corpo.id);
    expect(srv.gravados.size).toBe(1);
  });

  it('RT-04 sem internet: nada é tentado', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    await carregar();
    const { idb } = await guardar();
    online = false;
    const { enviarTarefasGuardadasNoAparelho } = await import('@/services/tarefasGuardadasNoAparelhoService');
    expect(await enviarTarefasGuardadasNoAparelho()).toEqual({ enviadas: 0, ficaram: 0 });
    expect(srv.fetch).not.toHaveBeenCalled();
    expect(await idb.getPendingTarefas()).toHaveLength(1);
  });
});
