/**
 * D-PROD-324 — Tarefas, parte 3: fotos tiradas sem internet ficam guardadas no aparelho e sobem sozinhas.
 *
 * Cadeia real `porta → fila de cadastros (IndexedDB em memória) → nativeHttpClient`, com `fetch` substituído.
 *
 * FS-01 tarefa nova sem internet com foto: a tarefa sobe pela fila; depois a foto sobe e entra nas fotos da tarefa
 *       (com um evento no histórico); a foto guardada sai do aparelho
 * FS-02 a criação da tarefa ainda na fila: a foto espera (nada sobe)
 * FS-03 a gravação da tarefa falha: a foto já enviada não sobe de novo na próxima vez
 * FS-04 tarefa que já tinha fotos: as novas entram junto das antigas
 * FS-05 sem internet: nada é tentado; a contagem de fotos aguardando é a da tarefa
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

let online = true;

/** Servidor falso das tarefas: grava pelo id que chega; PATCH junta; upload devolve um endereço. */
const servidor = () => {
  const s = {
    chamadas: /** @type {Array<{metodo: string, caminho: string, corpo: any}>} */ ([]),
    tarefas: new Map(),
    uploads: 0,
    falharPatch: 0,
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
    if (metodo === 'POST' && caminho === '/lancamentos-tarefa') {
      const id = corpo.id ?? `srv_${s.tarefas.size + 1}`;
      if (!s.tarefas.has(id)) s.tarefas.set(id, { fotos: [], ...corpo, id });
      return respostaJson(201, s.tarefas.get(id));
    }
    if (metodo === 'PATCH' && caminho.startsWith('/lancamentos-tarefa/')) {
      if (s.falharPatch > 0) {
        s.falharPatch -= 1;
        return respostaJson(400, { code: 'REQUEST_VALIDATION_FAILED', message: 'recusado' });
      }
      const id = caminho.split('/').pop();
      const atual = s.tarefas.get(id);
      if (!atual) return respostaJson(404, { code: 'NOT_FOUND', message: 'não achou' });
      const { historico_evento: _e, historico_descricao: _d, historico_data_evento: _t, ...resto } = corpo;
      s.tarefas.set(id, { ...atual, ...resto });
      return respostaJson(200, s.tarefas.get(id));
    }
    if (metodo === 'GET' && caminho === '/lancamentos-tarefa') return respostaJson(200, [...s.tarefas.values()]);
    if (metodo === 'GET') return respostaJson(200, []);
    return respostaJson(200, {});
  });
  return s;
};

const carregar = async () => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const rt = await import('@/lib/offline/offlineEntityRuntime');
  const fotos = await import('@/services/fotosDeTarefaAguardandoService');
  const { createLancamento } = await import('@/apis/tarefas');
  const idb = await import('@/components/offline/IndexedDBManager');
  // O IndexedDB em memória pode não ser apagado entre os casos (conexão aberta): começa sem fotos nem fila.
  for (const f of await idb.getAllPendingTarefaImages()) await idb.deleteTarefaImageOffline(f._imgId);
  for (const item of await idb.getEntitySyncQueue()) await idb.deleteEntitySyncQueueItem(item.id);
  return { rt, fotos, createLancamento, idb };
};

/** O que a tela guardava do `File` (o jsdom não tem `File.arrayBuffer`). */
const foto = (nome = 'cerca.jpg') => ({ name: nome, type: 'image/jpeg', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  await new Promise((r) => {
    const pedido = indexedDB.deleteDatabase('pesagens_offline_db');
    pedido.onsuccess = pedido.onerror = pedido.onblocked = () => r(undefined);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const envios = (srv, metodo, prefixo) => srv.chamadas.filter((c) => c.metodo === metodo && c.caminho.startsWith(prefixo));

describe('D-PROD-324 — fotos de tarefa sem internet', () => {
  it('FS-01 tarefa nova com foto: a tarefa sobe, depois a foto entra nas fotos dela e sai do aparelho', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt, fotos, createLancamento, idb } = await carregar();
    online = false;
    const criada = await createLancamento({ empresa_id: 'emp-1', titulo: 'Cerca', tipo: 'Manejo' });
    expect(await fotos.guardarFotosDaTarefa(criada.id, [foto()])).toBe(1);
    expect(await fotos.fotosAguardandoDaTarefa(criada.id)).toBe(1);

    online = true;
    await rt.syncOfflineEntityQueue();
    expect(srv.tarefas.get(criada.id).fotos).toEqual([]);
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 1, esperando: 0, falharam: 0 });
    expect(srv.uploads).toBe(1);
    const [patch] = envios(srv, 'PATCH', '/lancamentos-tarefa/');
    expect(patch.corpo).toMatchObject({ fotos: ['https://arquivos.exemplo.invalido/foto-1.jpg'], historico_evento: 'Edição' });
    expect(srv.tarefas.get(criada.id).fotos).toEqual(['https://arquivos.exemplo.invalido/foto-1.jpg']);
    expect(await fotos.fotosAguardandoDaTarefa(criada.id)).toBe(0);
    expect(await idb.getAllPendingTarefaImages()).toEqual([]);
  });

  it('FS-02 a criação da tarefa ainda na fila: a foto espera', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { fotos, createLancamento } = await carregar();
    online = false;
    const criada = await createLancamento({ empresa_id: 'emp-1', titulo: 'Cerca', tipo: 'Manejo' });
    await fotos.guardarFotosDaTarefa(criada.id, [foto()]);
    online = true;
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 0, esperando: 1, falharam: 0 });
    expect(srv.uploads).toBe(0);
    expect(await fotos.fotosAguardandoDaTarefa(criada.id)).toBe(1);
  });

  it('FS-03 a gravação da tarefa falha: a foto enviada não sobe de novo', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { rt, fotos, createLancamento } = await carregar();
    online = false;
    const criada = await createLancamento({ empresa_id: 'emp-1', titulo: 'Cerca', tipo: 'Manejo' });
    await fotos.guardarFotosDaTarefa(criada.id, [foto('a.jpg'), foto('b.jpg')]);
    online = true;
    await rt.syncOfflineEntityQueue();
    srv.falharPatch = 1;
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 0, esperando: 0, falharam: 1 });
    expect(srv.uploads).toBe(2);
    expect(await fotos.fotosAguardandoDaTarefa(criada.id)).toBe(2);
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 1, esperando: 0, falharam: 0 });
    expect(srv.uploads).toBe(2);
    expect(srv.tarefas.get(criada.id).fotos).toEqual(['https://arquivos.exemplo.invalido/foto-1.jpg', 'https://arquivos.exemplo.invalido/foto-2.jpg']);
  });

  it('FS-04 tarefa que já tinha fotos: as novas entram junto das antigas', async () => {
    const srv = servidor();
    srv.tarefas.set('t-velha', { id: 't-velha', empresa_id: 'emp-1', titulo: 'Velha', fotos: ['https://arquivos.exemplo.invalido/antiga.jpg'] });
    vi.stubGlobal('fetch', srv.fetch);
    const { fotos } = await carregar();
    await fotos.guardarFotosDaTarefa('t-velha', [foto()]);
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 1, esperando: 0, falharam: 0 });
    expect(srv.tarefas.get('t-velha').fotos).toEqual(['https://arquivos.exemplo.invalido/antiga.jpg', 'https://arquivos.exemplo.invalido/foto-1.jpg']);
  });

  it('FS-05 sem internet nada é tentado', async () => {
    const srv = servidor();
    vi.stubGlobal('fetch', srv.fetch);
    const { fotos } = await carregar();
    await fotos.guardarFotosDaTarefa('t-1', [foto(), foto()]);
    online = false;
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 0, esperando: 0, falharam: 0 });
    expect(srv.fetch).not.toHaveBeenCalled();
    expect(await fotos.fotosAguardandoDaTarefa('t-1')).toBe(2);
    expect(await fotos.fotosAguardandoDaTarefa('t-2')).toBe(0);
  });
});
