/**
 * D-PROD-338 — Grupo 3 da varredura sem internet: os limites.
 *
 *  G3-01 relógio do celular voltou: a fila de cadastros manda na ordem em que os itens ENTRARAM (a área antes do lote
 *        que a cita), não pela hora gravada
 *  G3-02 armazenamento cheio ao criar sem internet: dá erro e nada aparece como salvo
 *  G3-03 armazenamento cheio ao editar sem internet: dá erro e a lista volta ao valor de antes
 *  G3-04 guardar a foto que não cabe no celular não derruba o salvar da tarefa (não cria outra tarefa)
 *  G3-05 a foto é conferida na escolha: HEIC recusado com explicação, sem tipo ganha o tipo pela extensão, e a soma
 *        das fotos (salvas + guardadas + novas) não passa do que a tarefa aceita
 *  G3-06 outra pessoa entra no mesmo celular: as cópias de leitura do cliente saem
 *  G3-07 sem internet, trocar para uma fazenda sem cópia própria mostra os registros dela da cópia do cliente
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const memoria = (falhar = {}) => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k)?.items || [])],
    gravarCache: async (k, r) => {
      cache.set(k, { cache_key: k, ...r });
    },
    listarCaches: async () => [...cache.values()].map((c) => structuredClone(c)),
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => {
      if (falhar.fila) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      const id = proximo++;
      fila.set(id, { ...structuredClone(i), id });
      return id;
    },
    atualizarNaFila: async (id, c) => {
      if (falhar.fila) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      if (fila.has(id)) fila.set(id, { ...fila.get(id), ...structuredClone(c), id });
    },
    removerDaFila: async (id) => fila.delete(id),
    removerCache: async (k) => cache.delete(k),
  };
};

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
let rt;

beforeEach(async () => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  rt = await import('@/lib/offline/offlineEntityRuntime');
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
  rt.resetOfflineEntityRuntime();
  online(true);
});
afterEach(() => online(true));

describe('D-PROD-338 — fila de cadastros', () => {
  it('G3-01 relógio que voltou: a área sobe antes do lote que a cita', async () => {
    const storage = memoria();
    const ordem = [];
    const ops = (nome) => ({
      list: async () => [],
      create: vi.fn(async (d) => {
        ordem.push(nome);
        return { ...d, id: `srv-${nome}` };
      }),
    });
    rt.createOfflineEntityAdapter({ entityName: 'AreaPastagem', operations: ops('area'), storage, tenantScoped: true });
    rt.createOfflineEntityAdapter({ entityName: 'Lote', operations: ops('lote'), storage, tenantScoped: true });
    // A área entrou primeiro (10:00); o relógio voltou e o lote, que cita a área, ficou com uma hora ANTERIOR.
    await storage.adicionarNaFila({ entity_name: 'AreaPastagem', empresa_id: 'emp-1', cliente_id: 'cli_A', operation: 'create', record_id: 'offline_AreaPastagem_1', data: { id: 'offline_AreaPastagem_1', nome: 'PIQUETE' }, created_at: '2026-11-27T10:00:00Z' });
    await storage.adicionarNaFila({ entity_name: 'Lote', empresa_id: 'emp-1', cliente_id: 'cli_A', operation: 'create', record_id: 'offline_Lote_1', data: { id: 'offline_Lote_1', nome: 'LOTE', area_atual_id: 'offline_AreaPastagem_1' }, created_at: '2026-11-27T09:55:00Z' });
    await rt.syncOfflineEntityQueue();
    expect(ordem).toEqual(['area', 'lote']);
    expect(storage.fila.size).toBe(0);
  });

  it('G3-02 armazenamento cheio ao criar: dá erro e nada aparece como salvo', async () => {
    const storage = memoria({ fila: true });
    const porta = rt.createOfflineEntityAdapter({ entityName: 'Marca', operations: { list: async () => [], create: async (d) => d }, storage, tenantScoped: true });
    online(false);
    await expect(porta.create({ empresa_id: 'emp-1', nome: 'FANTASMA' })).rejects.toThrow(/Quota/);
    expect(await porta.list()).toEqual([]);
  });

  it('G3-03 armazenamento cheio ao editar: dá erro e a lista volta ao valor de antes', async () => {
    const falhar = { fila: false };
    const storage = memoria(falhar);
    const porta = rt.createOfflineEntityAdapter({
      entityName: 'Marca',
      operations: { list: async () => [{ id: 'm1', empresa_id: 'emp-1', nome: 'A' }], update: async (id, d) => ({ id, ...d }) },
      storage,
      tenantScoped: true,
    });
    await porta.list(); // cópia do servidor
    online(false);
    falhar.fila = true;
    await expect(porta.update('m1', { empresa_id: 'emp-1', nome: 'B' })).rejects.toThrow(/Quota/);
    expect((await porta.list()).map((m) => m.nome)).toEqual(['A']);
  });

  it('G3-07 sem internet, fazenda sem cópia própria: mostra os registros dela da cópia do cliente', async () => {
    const storage = memoria();
    const porta = rt.createOfflineEntityAdapter({
      entityName: 'Lote',
      operations: {
        list: async () => [
          { id: 'l1', empresa_id: 'emp-1', nome: 'DA FAZENDA A' },
          { id: 'l2', empresa_id: 'emp-2', nome: 'DA FAZENDA B' },
        ],
      },
      storage,
      tenantScoped: true,
    });
    await porta.list(); // baixou na fazenda A (a lista do servidor é do cliente inteiro)
    online(false);
    window.localStorage.setItem('empresa_selecionada_id', 'emp-2');
    expect((await porta.list()).map((l) => l.nome)).toEqual(['DA FAZENDA B']);
  });
});

describe('D-PROD-338 — fotos de tarefa', () => {
  it('G3-04 a foto que não cabe no celular não derruba o salvar da tarefa', async () => {
    vi.doMock('@/components/offline/IndexedDBManager', async (original) => ({
      ...(await original()),
      saveTarefaImageOffline: vi.fn(async (_k, arquivo) => {
        if (arquivo.name === 'grande.jpg') throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      }),
    }));
    const fotos = await import('@/services/fotosDeTarefaAguardandoService');
    const arquivo = (nome) => ({ name: nome, type: 'image/jpeg', arrayBuffer: async () => new Uint8Array([1]).buffer });
    expect(await fotos.guardarFotosDaTarefa('t1', [arquivo('grande.jpg'), arquivo('pequena.jpg')])).toBe(1);
    expect(fotos.avisoDeFotosQueNaoCouberam(1)).toMatch(/Uma foto não coube/);
    expect(fotos.avisoDeFotosQueNaoCouberam(0)).toBeNull();
    vi.doUnmock('@/components/offline/IndexedDBManager');
  });

  it('G3-05 a foto é conferida na escolha e a soma não passa do limite', async () => {
    const { conferirFotoEscolhida, fotosCabemNaTarefa, LIMITE_DAS_FOTOS_NA_TAREFA, avisoDeFotosDemais } = await import('@/lib/imagens/fotosDaTarefa');
    const heic = conferirFotoEscolhida(new File([new Uint8Array(10)], 'IMG_1.HEIC', { type: 'image/heic' }));
    expect(heic.ok).toBe(false);
    expect(heic.motivo).toMatch(/HEIC/);
    const semTipo = conferirFotoEscolhida(new File([new Uint8Array(10)], 'cerca.jpg', { type: '' }));
    expect(semTipo.ok && semTipo.arquivo.type).toBe('image/jpeg');
    expect(conferirFotoEscolhida(new File([new Uint8Array(10)], 'mapa.pdf', { type: 'application/pdf' })).ok).toBe(false);
    expect(conferirFotoEscolhida(new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' })).ok).toBe(true);

    const foto = (kb) => ({ size: kb * 1024 });
    expect(fotosCabemNaTarefa({ salvas: ['x'.repeat(1024 * 1024)], guardadas: [{ tamanho: 500 * 1024 }], novas: [foto(400)] }).cabe).toBe(true);
    const demais = fotosCabemNaTarefa({ salvas: ['x'.repeat(2 * 1024 * 1024)], novas: [foto(600), foto(600)] });
    expect(demais.cabe).toBe(false);
    expect(demais.limite).toBe(LIMITE_DAS_FOTOS_NA_TAREFA);
    expect(avisoDeFotosDemais(demais.total)).toMatch(/passam do tamanho/);
  });
});

describe('D-PROD-338 — cópias entre usuários', () => {
  it('G3-06 outra pessoa entra no mesmo celular: as cópias do cliente saem', async () => {
    let usuario = { id: 'u-ana', login: 'ana' };
    vi.doMock('@/apis/session', async (original) => ({ ...(await original()), loginNativo: vi.fn(async () => ({ usuario, clienteId: 'cli_A' })) }));
    const respostas = await import('@/lib/offline/respostasOffline');
    const sessao = await import('@/services/sessionService');
    await sessao.entrarComSessaoNativa({ login: 'ana', senha: 'x' });
    await respostas.guardarResposta('cli_A', '/usuarios', [{ id: 'só-admin-vê' }]);
    // A mesma pessoa de novo: a cópia continua.
    await sessao.entrarComSessaoNativa({ login: 'ana', senha: 'x' });
    expect(await respostas.lerResposta('cli_A', '/usuarios')).toBeTruthy();
    // Outra pessoa: a cópia sai antes de ela usar o app.
    usuario = { id: 'u-bia', login: 'bia' };
    await sessao.entrarComSessaoNativa({ login: 'bia', senha: 'x' });
    expect(await respostas.lerResposta('cli_A', '/usuarios')).toBeFalsy();
    vi.doUnmock('@/apis/session');
  });
});
