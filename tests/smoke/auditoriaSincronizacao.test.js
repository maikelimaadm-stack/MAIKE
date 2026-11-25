/**
 * D-PROD-307 — auditoria da sincronização: o que foi corrigido.
 *
 *  A. Conta: as portas nativas guardam cache e fila POR CONTA; o que a versão
 *     anterior deixou na fila sem dono é adotado pela sessão (não descartado);
 *     a passada da fila antiga para se a conta trocar no meio.
 *  B. Fila antiga: recusa definitiva do servidor não trava a fila (fica retida
 *     com o motivo; a pessoa tenta de novo ou descarta); criado sem internet não
 *     aparece duas vezes.
 *  C. Cópia do aparelho (internet fraca): não é gravada como resposta do
 *     servidor (cache do mapa e das entidades); sem internet, mostra mas não grava.
 *  D. Leitura forçada nunca reaproveita outra que saiu antes.
 *  E. Motor: erro sem código não é recusa; edição volta a "aguardando".
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

/** Porta em memória com o mesmo contrato do armazenamento IndexedDB. */
const memoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k) || [])],
    gravarCache: async (k, r) => { cache.set(k, r.items); },
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => { const id = proximo++; fila.set(id, { ...structuredClone(i), id }); return id; },
    atualizarNaFila: async (id, c) => { const a = fila.get(id); if (a) fila.set(id, { ...a, ...structuredClone(c), id }); },
    removerDaFila: async (id) => { fila.delete(id); },
    removerCache: async (k) => { cache.delete(k); },
  };
};

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

describe('D-PROD-307 A — cada conta com o seu cache e a sua fila', () => {
  it('AU-01 toda porta nativa com cache offline é por conta (tenantScoped)', () => {
    const raiz = 'src/apis';
    const portas = [];
    const andar = (dir) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) andar(caminho);
        else if (/Port\.js$/.test(nome)) portas.push(caminho);
      }
    };
    andar(raiz);
    const semDono = portas.filter((arq) => {
      const fonte = readFileSync(arq, 'utf8');
      return /createOfflineEntityAdapter\(\{/.test(fonte) && /nativeRequest/.test(fonte) && !/tenantScoped:\s*true/.test(fonte);
    });
    expect(semDono).toEqual([]);
  });

  describe('fila antiga', () => {
    let storage;
    let rt;
    let tenant;
    beforeEach(async () => {
      vi.resetModules();
      storage = memoria();
      rt = await import('@/lib/offline/offlineEntityRuntime');
      tenant = await import('@/lib/offline/offlineTenant');
      rt.resetOfflineEntityRuntime();
      online(true);
    });

    it('AU-02 item sem dono deixado pela versão anterior é adotado pela conta atual e enviado (não descartado)', async () => {
      tenant.setOfflineTenant('cli_A');
      const ops = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'srv-1', ...d })) };
      rt.createOfflineEntityAdapter({ entityName: 'PontoSuplementacao', operations: ops, storage, tenantScoped: true, adotarFilaSemDono: true });
      await storage.adicionarNaFila({ entity_name: 'PontoSuplementacao', operation: 'create', record_id: 'offline_PontoSuplementacao_1_a', data: { id: 'offline_PontoSuplementacao_1_a', nome_ponto: 'C1' }, created_at: new Date().toISOString() });
      expect(await rt.contarPendenciasDaFilaDeEntidades()).toBe(1);
      const r = await rt.syncOfflineEntityQueue();
      expect(r.success).toBe(true);
      expect(ops.create).toHaveBeenCalledTimes(1);
      expect(storage.fila.size).toBe(0);
    });

    it('AU-03 item de OUTRA conta não é enviado com o login desta', async () => {
      tenant.setOfflineTenant('cli_B');
      const ops = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'srv-1', ...d })) };
      rt.createOfflineEntityAdapter({ entityName: 'PontoSuplementacao', operations: ops, storage, tenantScoped: true, adotarFilaSemDono: true });
      await storage.adicionarNaFila({ entity_name: 'PontoSuplementacao', operation: 'create', record_id: 'offline_x', cliente_id: 'cli_A', data: { id: 'offline_x' }, created_at: new Date().toISOString() });
      expect(await rt.contarPendenciasDaFilaDeEntidades()).toBe(0);
      await rt.syncOfflineEntityQueue();
      expect(ops.create).not.toHaveBeenCalled();
      expect(storage.fila.size).toBe(1);
    });

    it('AU-04 a conta troca no meio da passada: para antes do próximo envio', async () => {
      tenant.setOfflineTenant('cli_A');
      const ops = {
        list: vi.fn(async () => []),
        create: vi.fn(async (d) => {
          tenant.setOfflineTenant('cli_B'); // saiu e outra conta entrou enquanto o 1º subia
          return { id: `srv-${d.n}`, ...d };
        }),
      };
      rt.createOfflineEntityAdapter({ entityName: 'Bebedouro', operations: ops, storage, tenantScoped: true });
      for (const n of [1, 2]) {
        await storage.adicionarNaFila({ entity_name: 'Bebedouro', operation: 'create', record_id: `offline_${n}`, cliente_id: 'cli_A', data: { id: `offline_${n}`, n }, created_at: new Date(Date.now() + n).toISOString() });
      }
      const r = await rt.syncOfflineEntityQueue();
      expect(r).toMatchObject({ success: false, code: 'SESSAO_TROCOU' });
      expect(ops.create).toHaveBeenCalledTimes(1);
    });
  });
});

describe('D-PROD-307 B — fila antiga: recusa não trava, nada em dobro', () => {
  let storage;
  let rt;
  beforeEach(async () => {
    vi.resetModules();
    storage = memoria();
    rt = await import('@/lib/offline/offlineEntityRuntime');
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    rt.resetOfflineEntityRuntime();
    online(true);
  });

  it('AU-05 recusa definitiva fica retida com o motivo, a fila SEGUE; tentar de novo e descartar', async () => {
    const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
    const recusa = new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'NOT_FOUND' } });
    const ops = {
      list: vi.fn(async () => []),
      update: vi.fn(async (id) => {
        if (id === 'real-apagado') throw recusa;
        return { id };
      }),
    };
    rt.createOfflineEntityAdapter({ entityName: 'Bebedouro', operations: ops, storage, tenantScoped: true });
    await storage.adicionarNaFila({ entity_name: 'Bebedouro', operation: 'update', record_id: 'real-apagado', cliente_id: 'cli_A', data: { nome: 'x' }, created_at: new Date(1).toISOString() });
    await storage.adicionarNaFila({ entity_name: 'Bebedouro', operation: 'update', record_id: 'real-ok', cliente_id: 'cli_A', data: { nome: 'y' }, created_at: new Date(2).toISOString() });

    const r = await rt.syncOfflineEntityQueue();
    expect(r).toMatchObject({ success: true, recusados: 1 });
    expect(ops.update.mock.calls.map((c) => c[0])).toEqual(['real-apagado', 'real-ok']);
    expect(await rt.contarPendenciasDaFilaDeEntidades()).toBe(0);
    const [recusado] = await rt.listarRecusadosDaFilaDeEntidades();
    expect(recusado).toMatchObject({ entidade: 'Bebedouro', operacao: 'update' });

    // Não volta sozinho a cada passada.
    await rt.syncOfflineEntityQueue();
    expect(ops.update).toHaveBeenCalledTimes(2);

    expect(await rt.tentarDeNovoRecusadoDaFilaDeEntidades(recusado.id)).toBe(true);
    expect(await rt.contarPendenciasDaFilaDeEntidades()).toBe(1);
    await rt.syncOfflineEntityQueue();
    const [deNovo] = await rt.listarRecusadosDaFilaDeEntidades();
    expect(await rt.descartarRecusadoDaFilaDeEntidades(deNovo.id)).toBe(true);
    expect(storage.fila.size).toBe(0);
  });

  it('AU-12 o recusado aparece na janela "Sincronização" como "precisa de atenção", com o motivo', async () => {
    const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
    const recusa = new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'NOT_FOUND' } });
    const ops = { list: vi.fn(async () => []), update: vi.fn(async () => { throw recusa; }) };
    rt.createOfflineEntityAdapter({ entityName: 'CategoriaManejo', operations: ops, storage, tenantScoped: true });
    await storage.adicionarNaFila({ entity_name: 'CategoriaManejo', operation: 'update', record_id: 'apagada', cliente_id: 'cli_A', data: { nome: 'x' }, created_at: new Date(1).toISOString() });
    await rt.syncOfflineEntityQueue();

    const servico = await import('@/services/sincronizacaoService');
    const fila = await servico.lerFilaDeEnvio();
    expect(fila.atencao).toBe(1);
    expect(fila.aguardando).toBe(0);
    const [item] = fila.itens;
    expect(item).toMatchObject({ estado: 'atencao', rotulo: 'Alteração de categoria manejo' });
    expect(item.ultimo_erro.mensagem).toBeTruthy();
    expect(await servico.dependentesDoRegistro(item.id)).toEqual([]);

    await servico.descartarRegistroNaoEnviado(item.id);
    expect(storage.fila.size).toBe(0);
    expect((await servico.lerFilaDeEnvio()).atencao).toBe(0);
  });

  it('AU-06 falta de rede ou erro passageiro (sem código) PARA a passada, como antes', async () => {
    const ops = { list: vi.fn(async () => []), update: vi.fn(async () => { throw Object.assign(new Error('503'), { status: 503 }); }) };
    rt.createOfflineEntityAdapter({ entityName: 'Bebedouro', operations: ops, storage, tenantScoped: true });
    await storage.adicionarNaFila({ entity_name: 'Bebedouro', operation: 'update', record_id: 'r1', cliente_id: 'cli_A', data: {}, created_at: new Date(1).toISOString() });
    const r = await rt.syncOfflineEntityQueue();
    expect(r.success).toBe(false);
    expect(await rt.listarRecusadosDaFilaDeEntidades()).toEqual([]);
    expect(await rt.contarPendenciasDaFilaDeEntidades()).toBe(1);
  });

  it('AU-07 criado sem internet aparece UMA vez na lista', async () => {
    const ops = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'srv', ...d })) };
    const adapter = rt.createOfflineEntityAdapter({ entityName: 'Bebedouro', operations: ops, storage, tenantScoped: true });
    online(false);
    await adapter.create({ nome: 'Novo' });
    const lista = await adapter.list();
    expect(lista.filter((b) => b.nome === 'Novo')).toHaveLength(1);
  });
});

describe('D-PROD-307 C — cópia do aparelho não é gravada como resposta do servidor', () => {
  beforeEach(() => {
    vi.resetModules();
    online(true);
  });

  it('AU-08 a entidade: a rede não respondeu e veio a cópia → o cache fica como estava', async () => {
    const storage = memoria();
    const rt = await import('@/lib/offline/offlineEntityRuntime');
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const { registrarCopiaServida } = await import('@/lib/offline/copiasDoAparelho');
    rt.resetOfflineEntityRuntime();
    let resposta = [{ id: 'a', nome: 'do servidor' }];
    let copia = false;
    const ops = {
      list: vi.fn(async () => {
        if (copia) {
          registrarCopiaServida();
          return [{ id: 'a', nome: 'VELHO' }];
        }
        return resposta;
      }),
    };
    const adapter = rt.createOfflineEntityAdapter({ entityName: 'Bebedouro', operations: ops, storage, tenantScoped: true });
    expect((await adapter.list()).map((b) => b.nome)).toEqual(['do servidor']);
    copia = true;
    expect((await adapter.list()).map((b) => b.nome)).toEqual(['do servidor']);
  });

  it('AU-09 o mapa: com a cópia, fica o cache (com o que a tela gravou), sem gravar a cópia por cima', async () => {
    const { registrarCopiaServida } = await import('@/lib/offline/copiasDoAparelho');
    let copia = false;
    vi.doMock('@/apis/leituras-cocho', () => ({
      listLeiturasCocho: vi.fn(async () => {
        if (copia) {
          registrarCopiaServida();
          return [];
        }
        return [{ id: 'l1', empresa_id: 'emp-1' }];
      }),
    }));
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const mapa = await import('@/services/mapaCacheService');
    let r = await mapa.refreshMapaCacheEntryDetalhado('leiturasCocho', 'emp-1', { force: true });
    expect(r.origem).toBe('rede');
    await mapa.updateMapaCachedData('leiturasCocho', 'emp-1', (itens) => [{ id: 'l2-recem-feita', empresa_id: 'emp-1' }, ...itens]);
    copia = true;
    r = await mapa.refreshMapaCacheEntryDetalhado('leiturasCocho', 'emp-1', { force: true });
    expect(r).toMatchObject({ origem: 'cache', erro: 'COPIA_DO_APARELHO' });
    expect(r.dados.map((l) => l.id)).toEqual(['l2-recem-feita', 'l1']);
    // O cache continua com o que a tela gravou (a cópia não foi gravada por cima).
    expect((await mapa.getMapaCachedData('leiturasCocho', 'emp-1')).map((l) => l.id)).toEqual(['l2-recem-feita', 'l1']);
    // Com a rede de volta, a forçada grava a resposta do servidor.
    copia = false;
    r = await mapa.refreshMapaCacheEntryDetalhado('leiturasCocho', 'emp-1', { force: true });
    expect(r.origem).toBe('rede');
    vi.doUnmock('@/apis/leituras-cocho');
  });
});

describe('D-PROD-307 D — leitura forçada nunca reaproveita outra que saiu antes', () => {
  it('AU-10 a 2ª forçada espera a 1ª e busca de novo; as que chegam juntas viram uma só', async () => {
    vi.resetModules();
    online(true);
    const respostas = [];
    let chamadas = 0;
    vi.doMock('@/apis/leituras-cocho', () => ({
      listLeiturasCocho: vi.fn(() => {
        chamadas += 1;
        return new Promise((resolve) => respostas.push(resolve));
      }),
    }));
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const mapa = await import('@/services/mapaCacheService');
    const primeira = mapa.refreshMapaCacheEntryDetalhado('leiturasCocho', 'emp-1', { force: true });
    await Promise.resolve();
    const segunda = mapa.refreshMapaCacheEntryDetalhado('leiturasCocho', 'emp-1', { force: true });
    const terceira = mapa.refreshMapaCacheEntryDetalhado('leiturasCocho', 'emp-1', { force: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(chamadas).toBe(1);
    respostas[0]([{ id: 'antes-da-gravacao', empresa_id: 'emp-1' }]);
    await primeira;
    await new Promise((r) => setTimeout(r, 0));
    expect(chamadas).toBe(2); // a 2ª saiu depois da 1ª (não reaproveitou)
    respostas[1]([{ id: 'depois-da-gravacao', empresa_id: 'emp-1' }]);
    const [r2, r3] = await Promise.all([segunda, terceira]);
    expect(r2.dados.map((l) => l.id)).toContain('depois-da-gravacao');
    expect(r3).toEqual(r2);
    expect(chamadas).toBe(2);
    vi.doUnmock('@/apis/leituras-cocho');
  });
});

describe('D-PROD-307 E — motor', () => {
  it('AU-11 erro sem código (falha no aparelho) não é recusa: tenta de novo', async () => {
    const { classificarFalhaDeEnvio } = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    expect(classificarFalhaDeEnvio(new TypeError('x is undefined'))).toBe('servidor');
  });
});
