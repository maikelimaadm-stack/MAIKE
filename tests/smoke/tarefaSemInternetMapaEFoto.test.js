/**
 * D-PROD-330 — tarefa sem internet: aparece no mapa e a foto não derruba a tarefa com o sinal fraco.
 *
 * TM-01 criada sem internet (na fila): entra no mapa, com "Pendente" e `_isOffline`; sem ponto, não entra
 * TM-02 alteração na fila muda a tarefa do mapa; exclusão tira; recusada pelo servidor não entra; outra fazenda não
 * TM-03 sinal fraco (o celular acha que tem internet e o envio falha por falta de rede): as fotos ficam para guardar
 * TM-04 sem internet: nada é tentado, todas ficam para guardar; recusa do servidor continua sendo erro
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

const memoria = () => {
  const fila = new Map();
  let proximo = 1;
  return {
    fila,
    lerCache: async () => [],
    gravarCache: async () => {},
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => { const id = proximo++; fila.set(id, { ...structuredClone(i), id }); return id; },
    atualizarNaFila: async (id, c) => { const a = fila.get(id); if (a) fila.set(id, { ...a, ...structuredClone(c), id }); },
    removerDaFila: async (id) => { fila.delete(id); },
    removerCache: async () => {},
  };
};

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
const ponto = { lat: -15.1, lng: -47.2 };
const naFila = (i) => ({ entity_name: 'LancamentoTarefa', cliente_id: 'cli_A', created_at: new Date(1).toISOString(), ...i });

describe('D-PROD-330 — tarefa sem internet no mapa', () => {
  let storage;
  let mapa;
  beforeEach(async () => {
    vi.resetModules();
    storage = memoria();
    // O serviço do mapa carrega as portas reais; depois, o catálogo é zerado e só a porta do teste fica.
    mapa = await import('@/services/mapaCacheService');
    const rt = await import('@/lib/offline/offlineEntityRuntime');
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    rt.resetOfflineEntityRuntime();
    rt.createOfflineEntityAdapter({ entityName: 'LancamentoTarefa', operations: { list: vi.fn(async () => []) }, storage, tenantScoped: true });
    online(false);
  });

  it('TM-01 criada sem internet entra no mapa; sem ponto, não', async () => {
    await storage.adicionarNaFila(naFila({ operation: 'create', record_id: 'nova-1', data: { id: 'nova-1', empresa_id: 'emp-1', titulo: 'Cerca', coordenadas: ponto, prioridade: 'Alta' } }));
    await storage.adicionarNaFila(naFila({ operation: 'create', record_id: 'sem-ponto', data: { id: 'sem-ponto', empresa_id: 'emp-1', titulo: 'Sem ponto' } }));
    const tarefas = await mapa.updateMapaCachedData('tarefas', 'emp-1', [{ id: 'srv-1', empresa_id: 'emp-1', titulo: 'Velha', status: 'Pendente', coordenadas: ponto }]);
    expect(tarefas.map((t) => t.id)).toEqual(['srv-1', 'nova-1']);
    expect(tarefas[1]).toMatchObject({ status: 'Pendente', _isOffline: true, titulo: 'Cerca', prioridade: 'Alta' });
  });

  it('TM-02 alteração muda, exclusão tira, recusada e outra fazenda não entram', async () => {
    await storage.adicionarNaFila(naFila({ operation: 'update', record_id: 'srv-1', data: { titulo: 'Velha (editada)' } }));
    await storage.adicionarNaFila(naFila({ operation: 'update', record_id: 'srv-2', data: { status: 'Concluída' } }));
    await storage.adicionarNaFila(naFila({ operation: 'delete', record_id: 'srv-3', data: {} }));
    await storage.adicionarNaFila(naFila({ operation: 'create', record_id: 'recusada', data: { id: 'recusada', empresa_id: 'emp-1', coordenadas: ponto }, quarentena: { codigo: 'RECUSADO_PELO_SERVIDOR' } }));
    await storage.adicionarNaFila(naFila({ operation: 'create', record_id: 'outra', data: { id: 'outra', empresa_id: 'emp-2', coordenadas: ponto } }));
    const base = ['srv-1', 'srv-2', 'srv-3'].map((id) => ({ id, empresa_id: 'emp-1', titulo: id, status: 'Pendente', coordenadas: ponto }));
    const tarefas = await mapa.updateMapaCachedData('tarefas', 'emp-1', base);
    expect(tarefas.map((t) => t.id)).toEqual(['srv-1']);
    expect(tarefas[0]).toMatchObject({ titulo: 'Velha (editada)', _isOffline: true });
  });
});

describe('D-PROD-330 — foto com o sinal fraco', () => {
  let fotos;
  let enviarAnexo;
  let erros;
  beforeEach(async () => {
    vi.resetModules();
    erros = await import('@/apis/_core/ApiError');
    enviarAnexo = vi.fn();
    vi.doMock('@/services/tarefasMapaService', () => ({ enviarAnexo: (...a) => enviarAnexo(...a), atualizarTarefa: vi.fn(), listarTodasAsTarefas: vi.fn(async () => []) }));
    fotos = await import('@/services/fotosDeTarefaAguardandoService');
    online(true);
  });

  const semRede = () => new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
  const recusa = () => new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'ATTACHMENT_INVALID' } });

  it('TM-03 a 1ª sobe, a 2ª falha por falta de rede: a 2ª e a 3ª ficam para guardar', async () => {
    enviarAnexo.mockResolvedValueOnce({ file_url: 'data:a' }).mockRejectedValueOnce(semRede());
    const r = await fotos.enviarOuSepararFotos(['f1', 'f2', 'f3']);
    expect(r).toEqual({ urls: ['data:a'], paraGuardar: ['f2', 'f3'] });
    expect(enviarAnexo).toHaveBeenCalledTimes(2);
  });

  it('TM-04 sem internet nada é tentado; recusa do servidor é erro', async () => {
    online(false);
    expect(await fotos.enviarOuSepararFotos(['f1'])).toEqual({ urls: [], paraGuardar: ['f1'] });
    expect(enviarAnexo).not.toHaveBeenCalled();
    online(true);
    enviarAnexo.mockRejectedValueOnce(recusa());
    await expect(fotos.enviarOuSepararFotos(['f1'])).rejects.toBeTruthy();
    expect(await fotos.enviarOuSepararFotos([])).toEqual({ urls: [], paraGuardar: [] });
    vi.doUnmock('@/services/tarefasMapaService');
  });
});
