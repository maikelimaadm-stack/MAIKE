/**
 * D-PROD-178 (MAPA-NIVEIS-COCHO-DEPOSITO-UX01) — nível de cocho/depósito no
 * Mapa Geral REAL, com relógio falso. Mocks só nas bordas: cache do mapa
 * (rede), empresas (fuso da fazenda), sessão e mapa (MapLibre falso e
 * renderer que só registra o que receberia). O que o mapa DESENHA é lido da
 * última chamada de `syncPontosSuplementacao`.
 *
 * NIV-MAPA-1  "hoje" é o dia civil no FUSO DA FAZENDA (`Empresa.fuso_horario`),
 *             e vira à meia-noite NAQUELE fuso sem refetch: cocho de 200 kg
 *             com taxa de 50 kg/dia mostra 100% no dia do lançamento e 75%
 *             depois da virada — o servidor não é consultado de novo.
 * NIV-MAPA-2  depósito com limite operacional 300 kg e saldo 600 kg: ícone
 *             cheio (fração ≤ 1), alerta de excesso e 200% no título.
 * NIV-MAPA-3  empresa sem fuso configurado: relógio do navegador
 *             (`hojeNoFuso(null)`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { hojeNoFuso } from '@/lib/diaCivil';

const SP = 'America/Sao_Paulo';
const EMPRESA = 'emp-1';

const sessao = vi.hoisted(() => ({ usuario: null }));
/** Dados "do servidor" e as chamadas de rede (por chave do cache do mapa). */
const dados = vi.hoisted(() => ({ porChave: {}, chamadas: [], empresas: [] }));
/** Última chamada de cada `sync*` do renderer: é o que aparece no mapa. */
const desenho = vi.hoisted(() => ({ ultimo: {}, suplementacao: [] }));

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
  listEmpresas: vi.fn(async () => dados.empresas),
}));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: (k) => {
    dados.chamadas.push(k);
    return Promise.resolve(dados.porChave[k] ?? []);
  },
  updateMapaCachedData: () => Promise.resolve([]),
}));
vi.mock('@/services/mapaService', async (importOriginal) => ({
  ...(await importOriginal()),
  listarSetoresAtivos: async () => [],
  listarAreasAtivas: async () => [],
  listarBebedourosAtivos: async () => [],
}));
vi.mock('@/services/bebedouroDataService', async (importOriginal) => ({
  ...(await importOriginal()),
  listarBebedouros: async () => [],
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
  // Objeto ÚNICO: `clearAll` precisa ser estável (o init do mapa depende dele).
  const renderer = {
    clearAll: () => {},
    ensureLayers: () => {},
    hitArea: () => false,
    setEstiloPasto: registrar('estilo'),
    syncAreas: registrar('areas'),
    syncLabels: registrar('rotulos'),
    syncPontos: registrar('pontos'),
    syncLinhas: registrar('linhas'),
    syncPontosSuplementacao: (...args) => {
      desenho.ultimo.suplementacao = args;
      desenho.suplementacao.push(args);
    },
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
const quadrado = (lat, lng) => ({ coords: [
  { lat, lng }, { lat, lng: lng - 0.01 }, { lat: lat - 0.01, lng: lng - 0.01 }, { lat: lat - 0.01, lng },
] });
const AREAS = [{ id: 'a1', empresa_id: EMPRESA, ativo: true, nome: 'Pasto 1', setor_id: 's1', coordenadas: quadrado(-15, -47) }];
const LOTES = [{ id: 'l1', empresa_id: EMPRESA, status: 'Ativo', area_atual_id: 'a1', categoria: 'BOI', quantidade_cabecas: 50, peso_medio_kg: 400 }];
const COCHO = {
  id: 'c1', empresa_id: EMPRESA, status: 'Ativo', categoria_ponto: 'COCHO', nome_ponto: 'Cocho Norte',
  area_vinculada_ids: ['a1'], coordenadas: { lat: -15.005, lng: -47.005 },
};
const DEPOSITO = {
  id: 'd1', empresa_id: EMPRESA, status: 'Ativo', categoria_ponto: 'DEPOSITO', nome_ponto: 'Depósito Sede',
  capacidade_cocho_kg: 300, estoque_minimo_kg: 100, local_estoque_id: 'loc-1', coordenadas: { lat: -15.006, lng: -47.006 },
};
/** Lançado em 11/11 (dia civil da fazenda): 200 kg, sobra 0, taxa 50 kg/dia (%PV no lançamento). */
const EVENTO = {
  id: 'e1', empresa_id: EMPRESA, ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-11',
  quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: 50,
  produto: 'Sal mineral', produto_id: 'p1',
};
const PRODUTOS = [{ id: 'p1', nome: 'Sal mineral', unidade_principal_estoque: 'KG', percentual_consumo_pv: 0.1 }];
const ESTOQUE = [{ id: 'el1', local_estoque_id: 'loc-1', produto_id: 'p1', quantidade_disponivel: 600 }];

/** 23:30 de 11/11 em São Paulo (UTC−3) = 02:30 de 12/11 em UTC. */
const QUASE_MEIA_NOITE_SP = new Date('2026-11-12T02:30:00.000Z');

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });
const pontosDesenhados = () => desenho.ultimo.suplementacao?.[0] || [];
const desenhado = (id) => pontosDesenhados().find((p) => p.id === id);

let client;
const abrir = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  await waitFor(() => {
    expect(desenhado('c1')).toBeTruthy();
    expect(desenhado('d1')).toBeTruthy();
    expect(client.getQueryData(['empresas'])).toBeTruthy();
  }, { timeout: 8000 });
  await assentar();
};

beforeEach(() => {
  cleanup();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(QUASE_MEIA_NOITE_SP);
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', EMPRESA);
  sessao.usuario = ADMIN;
  dados.empresas = [{ id: EMPRESA, nome: 'Fazenda', fuso_horario: SP }];
  dados.porChave = {
    areas: AREAS, lotes: LOTES, pontosSuplementacao: [COCHO, DEPOSITO],
    eventosSuplementacao: [EVENTO], estoqueLotes: ESTOQUE, produtos: PRODUTOS,
  };
  dados.chamadas = [];
  desenho.ultimo = {};
  desenho.suplementacao = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NIV-MAPA-1 — o cocho baixa na virada do dia NO FUSO DA FAZENDA, sem refetch', () => {
  it('200 kg, 50 kg/dia: 100% em 11/11 (23:30 em SP, já 12/11 em UTC) e 75% depois da meia-noite em SP', async () => {
    await abrir();
    const antes = desenhado('c1');
    expect(antes.nivel_suplementacao?.hoje, 'dia civil da fazenda, não o UTC').toBe('2026-11-11');
    expect(antes.indicador_percentual).toBe(1);
    expect(antes.indicador_neutro).toBe(false);
    expect(antes.indicador_titulo).toContain('200 kg de 200 kg (100%)');

    const chamadasAntes = dados.chamadas.length;
    const desenhosAntes = desenho.suplementacao.length;
    // O timer único do dia civil mira a meia-noite em SP (30 min); nada mais muda.
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    await assentar();

    const depois = desenhado('c1');
    expect(depois.nivel_suplementacao?.hoje).toBe('2026-11-12');
    expect(depois.indicador_percentual).toBe(0.75);
    expect(depois.indicador_titulo).toContain('150 kg de 200 kg (75%)');
    expect(desenho.suplementacao.length, 'o mapa foi redesenhado').toBeGreaterThan(desenhosAntes);
    expect(dados.chamadas.slice(chamadasAntes), 'sem refetch: o servidor não foi consultado de novo').toEqual([]);
  });

  it('o depósito não consome com o tempo: continua igual depois da virada', async () => {
    await abrir();
    const antes = desenhado('d1');
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    await assentar();
    const depois = desenhado('d1');
    expect(depois.indicador_percentual).toBe(antes.indicador_percentual);
    expect(depois.indicador_titulo).toBe(antes.indicador_titulo);
  });
});

describe('NIV-MAPA-2 — depósito acima do limite operacional', () => {
  it('limite 300 kg, saldo 600 kg: ícone cheio, alerta de excesso, 200% no título e selo de excesso', async () => {
    await abrir();
    const d = desenhado('d1');
    expect(d.indicador_percentual, 'fração do SVG ≤ 1').toBe(1);
    expect(d.indicador_neutro).toBe(false);
    expect(d.indicador_alerta_excesso).toBe(true);
    expect(d.indicador_titulo).toContain('200%');
    expect(d.indicador_titulo).toContain('300 kg acima');
    expect(d.nivel_suplementacao?.ocupacaoPercentual).toBeCloseTo(200, 6);
    expect(d.nivel_suplementacao?.excessoKg).toBe(300);
    expect(d.alertas_inteligentes.map((a) => a.tipo)).toContain('deposito_acima_limite');
    // O cocho (sem limite configurado) não ganha selo de excesso.
    expect(desenhado('c1').indicador_alerta_excesso).toBe(false);
  });

  it('depósito sem limite operacional: neutro (selo "?") e sem percentual', async () => {
    dados.porChave.pontosSuplementacao = [COCHO, { ...DEPOSITO, capacidade_cocho_kg: null }];
    await abrir();
    const d = desenhado('d1');
    expect(d.indicador_percentual).toBe(0);
    expect(d.indicador_neutro).toBe(true);
    expect(d.indicador_alerta_excesso).toBe(false);
    expect(d.nivel_suplementacao?.rotuloCurto).toBe('Sem limite');
  });
});

describe('NIV-MAPA-3 — empresa sem fuso configurado: relógio do navegador', () => {
  it('usa hojeNoFuso(null) — o mesmo dia do navegador', async () => {
    dados.empresas = [{ id: EMPRESA, nome: 'Fazenda', fuso_horario: null }];
    await abrir();
    expect(desenhado('c1').nivel_suplementacao?.hoje).toBe(hojeNoFuso(null));
  });

  it('cocho sem %PV no lançamento: neutro, sem estimativa (não mostra 100%)', async () => {
    dados.porChave.eventosSuplementacao = [{ ...EVENTO, consumo_esperado_pv_kg: null }];
    await abrir();
    const c = desenhado('c1');
    expect(c.indicador_neutro).toBe(true);
    expect(c.indicador_percentual).toBe(0);
    expect(c.indicador_titulo).toMatch(/Estimativa de consumo indisponível/);
  });
});
