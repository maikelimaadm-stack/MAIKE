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
 * D-PROD-335:
 * FS-06 a foto é SOMADA no servidor: fora da cópia do aparelho, ou com foto posta no escritório, nada se apaga
 * FS-07 foto excluída enquanto a anterior subia não vai para a tarefa nem volta
 * FS-08 tarefa com edição na fila: a foto espera a edição subir
 * FS-09 a edição aberta antes da foto subir não a apaga (a que a pessoa tirou, sai)
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

/** Servidor falso das tarefas: grava pelo id que chega; PATCH junta (e SOMA `fotos_adicionar`, D-PROD-335); upload devolve um endereço. */
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
      const { historico_evento: _e, historico_descricao: _d, historico_data_evento: _t, fotos_adicionar: somar, ...resto } = corpo;
      const proxima = { ...atual, ...resto };
      if (Array.isArray(somar)) proxima.fotos = [...new Set([...(proxima.fotos ?? []), ...somar])];
      s.tarefas.set(id, proxima);
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
    // D-PROD-335: a foto é SOMADA no servidor; o aparelho não manda a lista inteira (que podia estar velha).
    expect(patch.corpo).toMatchObject({ fotos_adicionar: ['https://arquivos.exemplo.invalido/foto-1.jpg'], historico_evento: 'Edição' });
    expect(patch.corpo).not.toHaveProperty('fotos');
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

  // D-PROD-335 — as fotos que já estavam na tarefa nunca são apagadas pela foto que sobe depois.
  it('FS-06 a tarefa fora da cópia do aparelho (ou com foto posta no escritório): nada do servidor é apagado', async () => {
    const srv = servidor();
    srv.tarefas.set('t-escritorio', { id: 't-escritorio', empresa_id: 'emp-1', titulo: 'Bebedouro', fotos: ['https://arquivos.exemplo.invalido/do-escritorio.jpg'] });
    vi.stubGlobal('fetch', srv.fetch);
    const { fotos } = await carregar();
    await fotos.guardarFotosDaTarefa('t-escritorio', [foto()]);
    // A lista de tarefas que o aparelho lê não traz esta (cópia de outra fazenda / sinal fraco): não importa.
    srv.fetch.mockClear();
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 1, esperando: 0, falharam: 0 });
    expect(envios(srv, 'GET', '/lancamentos-tarefa')).toHaveLength(0);
    expect(srv.tarefas.get('t-escritorio').fotos).toEqual(['https://arquivos.exemplo.invalido/do-escritorio.jpg', 'https://arquivos.exemplo.invalido/foto-1.jpg']);
  });

  it('FS-07 foto excluída enquanto a anterior subia: não vai para a tarefa nem volta ao aparelho', async () => {
    const srv = servidor();
    srv.tarefas.set('t-1', { id: 't-1', empresa_id: 'emp-1', titulo: 'Cerca', fotos: [] });
    const { fotos, idb } = await carregar();
    await fotos.guardarFotosDaTarefa('t-1', [foto('a.jpg'), foto('b.jpg')]);
    const [, segunda] = await idb.getTarefaImagesOffline('tarefa:t-1');
    const fetchOriginal = srv.fetch.getMockImplementation();
    srv.fetch.mockImplementation(async (url, init) => {
      const r = await fetchOriginal(url, init);
      // A pessoa toca no ✕ da segunda foto enquanto a primeira está subindo.
      if (String(url).endsWith('/arquivos/upload') && srv.uploads === 1) await fotos.excluirFotoGuardada(segunda._imgId);
      return r;
    });
    vi.stubGlobal('fetch', srv.fetch);
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 1, esperando: 0, falharam: 0 });
    expect(srv.uploads).toBe(1);
    expect(srv.tarefas.get('t-1').fotos).toEqual(['https://arquivos.exemplo.invalido/foto-1.jpg']);
    expect(await idb.getAllPendingTarefaImages()).toEqual([]);
  });

  it('FS-08 tarefa com edição na fila: a foto espera a edição subir (não passa à frente)', async () => {
    const srv = servidor();
    srv.tarefas.set('t-1', { id: 't-1', empresa_id: 'emp-1', titulo: 'Cerca', fotos: [] });
    vi.stubGlobal('fetch', srv.fetch);
    const { rt, fotos } = await carregar();
    const { updateLancamento } = await import('@/apis/tarefas');
    online = false;
    await updateLancamento('t-1', { titulo: 'Cerca nova' });
    await fotos.guardarFotosDaTarefa('t-1', [foto()]);
    online = true;
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 0, esperando: 1, falharam: 0 });
    expect(srv.uploads).toBe(0);
    await rt.syncOfflineEntityQueue();
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toEqual({ enviadas: 1, esperando: 0, falharam: 0 });
    expect(srv.tarefas.get('t-1')).toMatchObject({ titulo: 'Cerca nova', fotos: ['https://arquivos.exemplo.invalido/foto-1.jpg'] });
  });

  it('FS-09 a edição aberta antes da foto subir não apaga a foto (a que a pessoa tirou, sai)', async () => {
    const srv = servidor();
    srv.tarefas.set('t-1', { id: 't-1', empresa_id: 'emp-1', titulo: 'Cerca', fotos: ['https://arquivos.exemplo.invalido/antiga.jpg'] });
    vi.stubGlobal('fetch', srv.fetch);
    const { fotos } = await carregar();
    const { atualizarTarefa } = await import('@/services/tarefasMapaService');
    const telaAbriuCom = ['https://arquivos.exemplo.invalido/antiga.jpg'];
    await fotos.guardarFotosDaTarefa('t-1', [foto()]);
    expect(await fotos.enviarFotosDeTarefasGuardadas()).toMatchObject({ enviadas: 1 });
    // O formulário, aberto antes, salva a lista que tinha:
    await atualizarTarefa('t-1', { titulo: 'Cerca nova', fotos: telaAbriuCom }, { fotosDaTela: telaAbriuCom });
    expect(srv.tarefas.get('t-1').fotos).toEqual(['https://arquivos.exemplo.invalido/antiga.jpg', 'https://arquivos.exemplo.invalido/foto-1.jpg']);
    // Aberto depois (já com a foto), a pessoa a tira: sai.
    const comAFoto = srv.tarefas.get('t-1').fotos;
    await atualizarTarefa('t-1', { fotos: ['https://arquivos.exemplo.invalido/antiga.jpg'] }, { fotosDaTela: comAFoto });
    expect(srv.tarefas.get('t-1').fotos).toEqual(['https://arquivos.exemplo.invalido/antiga.jpg']);
  });
});
