/**
 * G3 — Mapa Geral REAL com mocks só nas bordas (cache do mapa, sessão, MapLibre
 * e renderer que registra o que receberia).
 *
 * G3-INT-1  depois de um cadastro (invalidarCachesDoMapa) com o Mapa Geral
 *           desmontado, ao voltar a área excluída some e a nova aparece, mesmo
 *           com o IndexedDB ainda com a cópia antiga (refresh sem force a devolve).
 * G3-INT-2  "Atualizar" também relê as linhas.
 * G3-INT-3  coloração "Ocupação": área gravada "Disponível" com lote do mapa
 *           dentro não fica cinza de Disponível.
 * G3-INT-4  filtro Tipo de pastagem esconde lotes, cochos e tarefas da área oculta.
 * G3-INT-5  filtro de setor mantém o depósito do setor.
 * G3-INT-6  clique no bebedouro abre o ligado por ponto_referencia_id.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { salvarFiltrosMapaGeral } from '@/lib/mapaGeralFiltrosStorage';
import { CORES_OCUPACAO } from '@/components/mapa/MapaFiltrosAvancados';

const EMPRESA = 'emp-1';

const sessao = vi.hoisted(() => ({ usuario: null }));
/** servidor: dado atual; indexedDb: cópia do último refresh; chamadas: [chave, force]. */
const dados = vi.hoisted(() => ({ servidor: {}, indexedDb: {}, chamadas: [], bebedouros: [], portao: null }));
const desenho = vi.hoisted(() => ({ ultimo: {}, bebedouroAberto: null }));

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: 'tenant-1', isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    carregarPermissaoEfetiva: vi.fn(async (u) => orig.permissaoEfetiva(u, null)),
  };
});
vi.mock('@/services/empresaService', async (importOriginal) => ({
  ...(await importOriginal()),
  listEmpresas: vi.fn(async () => [{ id: EMPRESA, nome: 'Fazenda', fuso_horario: 'America/Sao_Paulo' }]),
}));
// Mesma política do serviço real: sem force, dentro da janela, devolve o IndexedDB.
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: (k) => Promise.resolve(dados.indexedDb[k] ?? null),
  refreshMapaCacheEntry: async (k, _empresa, opcoes = {}) => {
    dados.chamadas.push([k, opcoes.force === true]);
    if (opcoes.force !== true && dados.indexedDb[k]) return dados.indexedDb[k];
    // `portao`: segura a resposta forçada (rede lenta) até o teste liberar.
    if (opcoes.force === true && dados.portao) await dados.portao;
    dados.indexedDb[k] = dados.servidor[k] ?? [];
    return dados.indexedDb[k];
  },
  updateMapaCachedData: () => Promise.resolve([]),
}));
vi.mock('@/services/mapaService', async (importOriginal) => ({
  ...(await importOriginal()),
  listarSetoresAtivos: async () => [{ id: 's1', nome: 'RETIRO 1' }, { id: 's2', nome: 'RETIRO 2' }],
  listarAreasAtivas: async () => [],
  listarBebedourosAtivos: async () => dados.bebedouros,
}));
vi.mock('@/hooks/useSetorAreas', () => ({
  default: () => ({ setores: [{ id: 's1', nome: 'RETIRO 1' }, { id: 's2', nome: 'RETIRO 2' }] }),
}));
vi.mock('@/services/bebedouroDataService', async (importOriginal) => ({
  ...(await importOriginal()),
  listarBebedouros: async () => [],
}));
vi.mock('@/components/bebedouros/DetalhesBebedouro', () => ({
  default: ({ bebedouro }) => {
    desenho.bebedouroAberto = bebedouro;
    return null;
  },
}));
vi.mock('@/lib/maplibre/falhaWebGL', async (importOriginal) => ({
  ...(await importOriginal()),
  navegadorTemWebGL: () => true,
}));
vi.mock('@/lib/maplibre/lifecycle.js', async (importOriginal) => {
  const real = await importOriginal();
  const criarMapaFalso = () => {
    const ouvintes = new Map();
    const map = {
      on(ev, fn) {
        if (!ouvintes.has(ev)) ouvintes.set(ev, new Set());
        ouvintes.get(ev).add(fn);
        return map;
      },
      off(ev, fn) {
        ouvintes.get(ev)?.delete(fn);
        return map;
      },
      disparar(ev) {
        for (const fn of [...(ouvintes.get(ev) || [])]) fn({});
      },
      getCenter: () => ({ lat: -15, lng: -47 }),
      getZoom: () => 15,
      setMinZoom() {},
      setMaxZoom() {},
      isStyleLoaded: () => true,
      jumpTo() { map.disparar('moveend'); },
      fitBounds() { map.disparar('moveend'); },
    };
    setTimeout(() => map.disparar('load'), 0);
    return map;
  };
  return { ...real, createEditorMap: () => ({ map: criarMapaFalso(), dispose: () => {}, getCancelled: () => false }) };
});
vi.mock('@/components/mapa/useMapRenderer', () => {
  const registrar = (nome) => (...args) => { desenho.ultimo[nome] = args; };
  const renderer = {
    clearAll: () => {},
    ensureLayers: () => {},
    hitArea: () => false,
    setEstiloPasto: registrar('estilo'),
    syncAreas: registrar('areas'),
    syncLabels: registrar('rotulos'),
    syncPontos: registrar('pontos'),
    syncLinhas: registrar('linhas'),
    syncPontosSuplementacao: registrar('suplementacao'),
    syncLotes: registrar('lotes'),
    syncTarefas: registrar('tarefas'),
    syncUserLocation: registrar('localizacao'),
  };
  return { default: () => renderer };
});
vi.mock('@/components/mapa/useBasemap', () => {
  const estado = { basemapId: 'satelite', status: 'pronto', provedor: 'teste', mensagem: null, atribuicao: null, setBasemap: () => {}, retry: () => {} };
  return { default: () => estado };
});

const ADMIN = { id: 'u-adm', login: 'ana', email: 'ana', cliente_id: 'tenant-1', administrador_fazenda: true };
const ESCOPO = { clienteId: 'tenant-1', login: 'ana', empresaId: EMPRESA };
const quadrado = (lat, lng) => ({ coords: [
  { lat, lng }, { lat, lng: lng - 0.01 }, { lat: lat - 0.01, lng: lng - 0.01 }, { lat: lat - 0.01, lng },
] });
const area = (id, extra = {}) => ({ id, empresa_id: EMPRESA, ativo: true, nome: id.toUpperCase(), coordenadas: quadrado(-15, -47), ...extra });
const A1 = area('a1', { setor_id: 's1', tipo_pastagem: 'MOMBACA', status_ocupacao: 'Disponível' });
const A2 = area('a2', { setor_id: 's2', tipo_pastagem: 'BRAQUIARIA' });
const LOTES = [
  { id: 'l1', empresa_id: EMPRESA, status: 'Ativo', area_atual_id: 'a1', categoria: 'BOI', quantidade_cabecas: 50, peso_medio_kg: 400 },
  { id: 'l2', empresa_id: EMPRESA, status: 'Ativo', area_atual_id: 'a2', categoria: 'BOI', quantidade_cabecas: 30, peso_medio_kg: 400 },
];
const PONTOS_SUPL = [
  { id: 'c1', empresa_id: EMPRESA, status: 'Ativo', categoria_ponto: 'COCHO', area_vinculada_ids: ['a1'], coordenadas: { lat: -15.005, lng: -47.005 } },
  { id: 'c2', empresa_id: EMPRESA, status: 'Ativo', categoria_ponto: 'COCHO', area_vinculada_ids: ['a2'], coordenadas: { lat: -15.005, lng: -47.005 } },
  { id: 'd1', empresa_id: EMPRESA, status: 'Ativo', categoria_ponto: 'DEPOSITO', setor_id: 's1', area_vinculada_ids: [], coordenadas: { lat: -15.006, lng: -47.006 } },
];

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 150)); });
const ids = (lista) => (lista || []).map((x) => x.id).sort();

let client;
let desmontar;
const montar = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  await act(async () => {
    const r = render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
    desmontar = r.unmount;
  });
  await waitFor(() => expect(desenho.ultimo.areas?.[0]?.length).toBeGreaterThan(0), { timeout: 8000 });
  await assentar();
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', EMPRESA);
  sessao.usuario = ADMIN;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  dados.servidor = { areas: [A1, A2], lotes: LOTES, pontosSuplementacao: PONTOS_SUPL, linhas: [], tarefas: [] };
  dados.indexedDb = {};
  dados.chamadas = [];
  dados.bebedouros = [];
  dados.portao = null;
  desenho.ultimo = {};
  desenho.bebedouroAberto = null;
});
afterEach(() => cleanup());

describe('G3-INT-1 — cadastro em outra tela e volta ao Mapa Geral', () => {
  it('área excluída some e área nova aparece, sem apertar Atualizar', async () => {
    const { invalidarCachesDoMapa } = await import('@/components/mapa/invalidarCachesMapa');
    await montar();
    expect(ids(desenho.ultimo.areas[0])).toEqual(['a1', 'a2']);

    // Vai ao Cadastro (Mapa Geral desmonta), exclui a2 e cria a3.
    act(() => desmontar());
    const A3 = area('a3');
    dados.servidor.areas = [A1, A3];
    await act(async () => { await invalidarCachesDoMapa(client, ['areas']); });

    desenho.ultimo = {};
    await montar();
    await waitFor(() => expect(ids(desenho.ultimo.areas[0])).toEqual(['a1', 'a3']), { timeout: 4000 });
    expect(dados.chamadas).toContainEqual(['areas', true]);
  });

  it('revisão: com o mapa montado, o cadastro de área força só a chave areas (não as 13)', async () => {
    const { invalidarCachesDoMapa } = await import('@/components/mapa/invalidarCachesMapa');
    await montar();
    dados.chamadas = [];
    dados.servidor.areas = [A1];
    await act(async () => { await invalidarCachesDoMapa(client, ['areas']); });
    await assentar();
    await waitFor(() => expect(ids(desenho.ultimo.areas[0])).toEqual(['a1']), { timeout: 4000 });
    const forcadas = [...new Set(dados.chamadas.filter(([, force]) => force).map(([k]) => k))];
    expect(forcadas).toEqual(['areas']);
  });

  it('revisão: voltando depois do gcTime em rede lenta, mostra a cópia local e depois aplica o servidor', async () => {
    const { invalidarCachesDoMapa } = await import('@/components/mapa/invalidarCachesMapa');
    await montar();
    act(() => desmontar());
    client.removeQueries({ queryKey: ['mapa-cache'] });
    dados.servidor.areas = [A1, area('a3')];
    let liberar = () => {};
    dados.portao = new Promise((r) => { liberar = r; });
    await act(async () => { await invalidarCachesDoMapa(client, ['areas']); });

    desenho.ultimo = {};
    await montar(); // não fica vazio esperando o servidor
    expect(ids(desenho.ultimo.areas[0])).toEqual(['a1', 'a2']);
    await act(async () => { liberar(); });
    await waitFor(() => expect(ids(desenho.ultimo.areas[0])).toEqual(['a1', 'a3']), { timeout: 4000 });
    expect(dados.chamadas).toContainEqual(['areas', true]);
  });
});

describe('G3-INT-2 — Atualizar relê as linhas', () => {
  it('a linha nova aparece depois de Atualizar', async () => {
    await montar();
    dados.servidor.linhas = [{ id: 'ln1', empresa_id: EMPRESA, ativo: true, coordenadas: { coords: [] } }];
    dados.chamadas = [];
    await act(async () => { window.dispatchEvent(new CustomEvent('atualizar-mapa')); });
    await waitFor(() => expect(ids(desenho.ultimo.linhas?.[0])).toEqual(['ln1']), { timeout: 4000 });
    expect(dados.chamadas).toContainEqual(['linhas', true]);
  });
});

describe('G3-INT-3 — coloração Ocupação pelos lotes do mapa', () => {
  it('área gravada "Disponível" com lote do mapa dentro não pinta de Disponível', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { modoColoracao: 'ocupacao' });
    dados.servidor.lotes = [LOTES[0]];
    await montar();
    await waitFor(() => expect(typeof desenho.ultimo.areas?.[4]).toBe('function'));
    const getAreaColor = desenho.ultimo.areas[4];
    expect(getAreaColor(A1)).not.toBe(CORES_OCUPACAO['Disponível']);
    expect(getAreaColor({ ...A2, status_ocupacao: 'Alto' })).toBe(CORES_OCUPACAO['Disponível']);
  });
});

describe('G3-INT-4/5 — filtros de área', () => {
  it('Tipo de pastagem = MOMBACA: lotes e cochos de BRAQUIARIA somem; depósito (sem área) fica', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { filtroTipoPastagem: ['MOMBACA'] });
    await montar();
    await waitFor(() => expect(ids(desenho.ultimo.areas[0])).toEqual(['a1']));
    expect(ids(desenho.ultimo.lotes?.[0])).toEqual(['l1']);
    expect(ids(desenho.ultimo.suplementacao?.[0])).toEqual(['c1', 'd1']);
  });

  it('setor RETIRO 1: o depósito do setor continua no mapa', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { filtroSetor: ['s1'] });
    await montar();
    await waitFor(() => expect(ids(desenho.ultimo.areas[0])).toEqual(['a1']));
    expect(ids(desenho.ultimo.suplementacao?.[0])).toEqual(['c1', 'd1']);
  });
});

describe('G3-INT-6 — clique no bebedouro', () => {
  it('abre o bebedouro ligado ao ponto, não o que só contém o número no nome', async () => {
    const P2 = { id: 'P2', empresa_id: EMPRESA, ativo: true, tipo: 'BEBEDOURO', nome: 'BEB CURRAL', numero_ponto: '2', coordenadas: { lat: -15, lng: -47 } };
    dados.servidor.pontos = [P2];
    dados.bebedouros = [
      { id: 'bB', empresa_id: EMPRESA, nome: 'BEB PASTO 12', ponto_referencia_id: 'P12' },
      { id: 'bA', empresa_id: EMPRESA, nome: 'BEBEDOURO A', ponto_referencia_id: 'P2' },
    ];
    await montar();
    await waitFor(() => expect(typeof desenho.ultimo.pontos?.[3]).toBe('function'));
    await act(async () => { await desenho.ultimo.pontos[3](P2); });
    await waitFor(() => expect(desenho.bebedouroAberto?.id).toBe('bA'));
  });
});
