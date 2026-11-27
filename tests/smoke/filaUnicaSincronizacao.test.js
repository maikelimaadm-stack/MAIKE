/**
 * D-PROD-328 — a fila única da janela "Sincronização": tudo que espera envio aparece, com o que aconteceu, e
 * nada fica preso sem saída ("Tentar de novo" e "Excluir" em qualquer item).
 *
 * FU-01 cadastro esperando (não só o recusado) aparece, com o nome; erro do servidor fica guardado como o motivo
 * FU-02 excluir a CRIAÇÃO leva junto a alteração do mesmo registro e tira o registro do aparelho
 * FU-03 exclusão retida (só com internet) aparece como "precisa de atenção", sem "Tentar de novo"; excluir tira
 * FU-04 "Tentar de novo" no recusado tira a recusa e volta a "aguardando"
 * FU-05 "Ver detalhes": o conteúdo em linhas simples (sem campos internos nem fotos em data:)
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

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

let storage;
let rt;
let servico;
beforeEach(async () => {
  vi.resetModules();
  storage = memoria();
  rt = await import('@/lib/offline/offlineEntityRuntime');
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
  rt.resetOfflineEntityRuntime();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
// O serviço entra DEPOIS do adaptador do teste: ao carregar, as portas reais registram as suas entidades, e a fila
// lida é a da primeira entidade registrada (a do teste, em memória).
const carregarServico = async () => { servico = await import('@/services/sincronizacaoService'); return servico; };

const na = (i) => ({ cliente_id: 'cli_A', created_at: new Date(1).toISOString(), ...i });

describe('D-PROD-328 — fila única', () => {
  it('FU-01 cadastro esperando aparece com o nome; o erro do servidor vira o motivo', async () => {
    const erro = Object.assign(new Error('Serviço fora do ar'), {});
    const ops = { list: vi.fn(async () => []), update: vi.fn(async () => { throw erro; }) };
    rt.createOfflineEntityAdapter({ entityName: 'CochoTeste', operations: ops, storage, tenantScoped: true });
    await carregarServico();
    await storage.adicionarNaFila(na({ entity_name: 'CochoTeste', operation: 'update', record_id: 'b1', data: { nome: 'BEBEDOURO 3' }, created_at: new Date(1).toISOString() }));
    let fila = await servico.lerFilaDeEnvio();
    expect(fila.itens).toHaveLength(1);
    expect(fila.itens[0]).toMatchObject({ origem: 'cadastro', estado: 'aguardando', rotulo: 'Alteração de cocho teste: BEBEDOURO 3', podeTentar: true });
    await rt.syncOfflineEntityQueue();
    fila = await servico.lerFilaDeEnvio();
    expect(fila.itens[0]).toMatchObject({ estado: 'aguardando', tentativas: 1 });
    expect(fila.itens[0].motivo).toBeTruthy();
    expect(fila.itens[0].ultimaTentativaEm).toBeTruthy();
  });

  it('FU-02 excluir a criação leva junto a alteração e tira o registro do aparelho', async () => {
    rt.createOfflineEntityAdapter({ entityName: 'CochoTeste', operations: { list: vi.fn(async () => []) }, storage, tenantScoped: true });
    await carregarServico();
    await storage.adicionarNaFila(na({ entity_name: 'CochoTeste', operation: 'create', record_id: 'novo-1', empresa_id: 'emp-1', data: { id: 'novo-1', nome: 'B NOVO' }, created_at: new Date(1).toISOString() }));
    await storage.adicionarNaFila(na({ entity_name: 'CochoTeste', operation: 'update', record_id: 'novo-1', empresa_id: 'emp-1', data: { nome: 'B NOVO 2' }, created_at: new Date(2).toISOString() }));
    await storage.adicionarNaFila(na({ entity_name: 'CochoTeste', operation: 'update', record_id: 'outro', empresa_id: 'emp-1', data: { nome: 'OUTRO' }, created_at: new Date(3).toISOString() }));
    const fila = await servico.lerFilaDeEnvio();
    const criacao = fila.itens.find((i) => i.rotulo.startsWith('Cadastro'));
    expect(criacao.avisoAoExcluir).toMatch(/alterações/);
    expect(await servico.descartarRegistroNaoEnviado(criacao.id)).toBe(true);
    expect([...storage.fila.values()].map((i) => i.record_id)).toEqual(['outro']);
  });

  it('FU-03 exclusão retida: precisa de atenção, sem "Tentar de novo"; excluir tira', async () => {
    rt.createOfflineEntityAdapter({ entityName: 'CochoTeste', operations: { list: vi.fn(async () => []) }, storage, tenantScoped: true });
    await carregarServico();
    await storage.adicionarNaFila(na({ entity_name: 'CochoTeste', operation: 'delete', record_id: 'b9', data: {}, quarentena: { codigo: 'OFFLINE_DELETE_QUARANTINED', em: new Date(5).toISOString() } }));
    const [item] = (await servico.lerFilaDeEnvio()).itens;
    expect(item).toMatchObject({ estado: 'atencao', podeTentar: false });
    expect(item.motivo).toMatch(/com internet/);
    await servico.descartarRegistroNaoEnviado(item.id);
    expect(storage.fila.size).toBe(0);
  });

  it('FU-04 "Tentar de novo" no recusado volta a aguardando', async () => {
    rt.createOfflineEntityAdapter({ entityName: 'CochoTeste', operations: { list: vi.fn(async () => []), update: vi.fn(async (id, d) => ({ id, ...d })) }, storage, tenantScoped: true });
    await carregarServico();
    await storage.adicionarNaFila(na({ entity_name: 'CochoTeste', operation: 'update', record_id: 'b1', data: { nome: 'X' }, tentativas_com_erro: 4, quarentena: { codigo: 'RECUSADO_PELO_SERVIDOR', motivo: 'Erro interno', em: new Date(5).toISOString() } }));
    const [item] = (await servico.lerFilaDeEnvio()).itens;
    expect(item).toMatchObject({ estado: 'atencao', motivo: 'Erro interno', tentativas: 5 });
    expect(await rt.tentarDeNovoNaFilaDeEntidades(Number(item.id.split(':')[1]))).toBe(true);
    const [depois] = [...storage.fila.values()];
    expect(depois.quarentena).toBeNull();
    expect(depois.tentativas_com_erro).toBe(0);
  });

  it('FU-05 detalhes em linhas simples', async () => {
    await carregarServico();
    expect(servico.detalhesDoConteudo({
      id: 'x', cliente_id: 'c', titulo: 'CERCA', prioridade: 'Alta', fotos: ['data:image/jpeg;base64,AAA', 'data:…'], urgente: true,
      evento: { quantidade_kg: 30, observacao: 'data:image/png;base64,ZZ' }, _offlineId: 3,
    })).toEqual([
      { rotulo: 'Titulo', valor: 'CERCA' },
      { rotulo: 'Prioridade', valor: 'Alta' },
      { rotulo: 'Fotos', valor: '2' },
      { rotulo: 'Urgente', valor: 'Sim' },
      { rotulo: 'Evento › Quantidade kg', valor: '30' },
    ]);
    expect(servico.detalhesDoConteudo(null)).toEqual([]);
  });
});
