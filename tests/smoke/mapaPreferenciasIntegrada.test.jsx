/**
 * D-PROD-137 (frente M4b) — preferências do Mapa Geral × permissão, com o
 * MapaGeral REAL montado. Mocks só de rede (cache do mapa, serviços de dados),
 * de sessão (AuthContext, sessionService) e do mapa (instância MapLibre falsa,
 * renderer e camada de base). O que o mapa DESENHA é lido das chamadas
 * `sync*` do renderer; o que fica SALVO é lido do localStorage.
 *
 * PREF-02 — sem "Ver filtros e camadas" o mapa mostra o PADRÃO; a preferência
 *           salva não é aplicada, mas também não é apagada nem reescrita, e
 *           volta a valer quando a permissão volta.
 * PREF-04 — Mover, Minha localização e a chave "Tarefas" dos Filtros só
 *           aparecem com a permissão que os faz funcionar.
 * PREF-06 — moveend da troca de empresa (antes de a empresa nova ser
 *           enquadrada) não grava a vista da anterior na chave da nova.
 * PREF-07 — resposta tardia do GPS não liga "Localização" no escopo que entrou
 *           depois do pedido.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { persistirEmpresaSelecionada } from '@/hooks/useEmpresaSelecionadaId';
import { PADRAO_FILTROS_MAPA, CAMPOS_DO_PAINEL_FILTROS, preferenciaAplicada } from '@/lib/mapaGeralFiltrosStorage';

const sessao = vi.hoisted(() => ({ usuario: null, clienteIdAuth: 'tenant-1', permissoes: null }));
/** Dados "do servidor" por empresa e respostas que o teste segura (pendentes). */
const dados = vi.hoisted(() => ({ porEmpresa: {}, pendentes: {} }));
/** Instância MapLibre falsa criada pela página. */
const mapa = vi.hoisted(() => ({ atual: null }));
/** Última chamada de cada `sync*` do renderer: é o que aparece no mapa. */
const desenho = vi.hoisted(() => ({ ultimo: {} }));

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: sessao.clienteIdAuth, isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    carregarPermissaoEfetiva: vi.fn(
      (u) => new Promise((ok) => setTimeout(() => ok(orig.permissaoEfetiva(u, sessao.permissoes ?? linha())), 20))
    ),
  };
});
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: (k, emp) =>
    dados.pendentes[`${k}:${emp}`]?.promise ?? Promise.resolve(dados.porEmpresa[emp]?.[k] ?? []),
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
    let centro = { lat: -10, lng: -50 };
    let zoom = 15;
    const map = {
      fits: [],
      jumps: [],
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
      getCenter: () => ({ ...centro }),
      getZoom: () => zoom,
      setMinZoom() {},
      setMaxZoom() {},
      isStyleLoaded: () => true,
      // Como no MapLibre: jumpTo e fitBounds sem animação disparam moveend na hora.
      jumpTo({ center, zoom: z }) {
        map.jumps.push({ center, zoom: z });
        centro = { lng: center[0], lat: center[1] };
        if (Number.isFinite(z)) zoom = z;
        map.disparar('moveend');
      },
      fitBounds(b) {
        map.fits.push(b);
        centro = { lng: (b[0][0] + b[1][0]) / 2, lat: (b[0][1] + b[1][1]) / 2 };
        zoom = 16;
        map.disparar('moveend');
      },
      /** Arrasto/pinça do usuário: termina em moveend. */
      arrastar(lat, lng) {
        centro = { lat, lng };
        map.disparar('moveend');
      },
    };
    setTimeout(() => map.disparar('load'), 0);
    return map;
  };
  return {
    ...real,
    createEditorMap: () => {
      const map = criarMapaFalso();
      mapa.atual = map;
      return { map, dispose: () => {}, getCancelled: () => false };
    },
  };
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

/** Linha Permissao do operador "ana" (tela do mapa visível). */
function linha(mapaGeral = {}, telasExtras = []) {
  return {
    user_email: 'ana', is_admin: false,
    modulos_permitidos: ['mapa', ...telasExtras.map((t) => t.modulo_id)],
    permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', visualizar: true }, ...telasExtras],
    mapa_geral_permissoes: mapaGeral,
  };
}
const TELA_TAREFAS = { modulo_id: 'gestao-tarefas', tela_id: 'gt-lancamentos', visualizar: true };

const ANA = { id: 'u-a', login: 'ana', email: 'ana', cliente_id: 'tenant-1', administrador_fazenda: false };
const chave = (empresa) => `mapa_geral_filtros_u:tenant-1:ana:${empresa}`;
const ler = (k) => JSON.parse(localStorage.getItem(k) || 'null');

const quadrado = (lat, lng) => ({ coords: [
  { lat, lng }, { lat, lng: lng - 0.01 }, { lat: lat - 0.01, lng: lng - 0.01 }, { lat: lat - 0.01, lng },
] });
const AREAS_EMP1 = [
  { id: 'a1', empresa_id: 'emp-1', ativo: true, nome: 'Pasto 1', setor_id: 's1', coordenadas: quadrado(-15, -47) },
  { id: 'a2', empresa_id: 'emp-1', ativo: true, nome: 'Pasto 2', setor_id: 's2', coordenadas: quadrado(-15.02, -47.02) },
];
const LOTES_EMP1 = [
  { id: 'l1', empresa_id: 'emp-1', status: 'Ativo', area_atual_id: 'a1', categoria: 'BOI', quantidade_cabecas: 10, peso_medio_kg: 300 },
  { id: 'l2', empresa_id: 'emp-1', status: 'Ativo', area_atual_id: 'a2', categoria: 'VACA', quantidade_cabecas: 5, peso_medio_kg: 400 },
];
const AREAS_EMP2 = [
  { id: 'b1', empresa_id: 'emp-2', ativo: true, nome: 'Retiro', setor_id: 's9', coordenadas: quadrado(-20, -50) },
];
/** O que a ana deixou salvo da última vez que tinha o painel de filtros. */
const PREF_ANA = {
  showAreas: false, showLotes: false, showHectaresAreas: false, showTaskIcons: false,
  filtroCategoria: 'BOI', filtroSetor: 's1', modoColoracao: 'situacao_pasto',
};

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });
const animais = () => Number(document.querySelector('.mk-mapa-resumo__num--verde')?.textContent);
const lotesDesenhados = () => ({ visiveis: desenho.ultimo.lotes?.[2], quantos: desenho.ultimo.lotes?.[0]?.length, arrastaveis: desenho.ultimo.lotes?.[6] });

let client;
/** A permissão efetiva chegou (sem ela tudo fica desligado, por desenho). */
const permissaoCarregada = () =>
  client.getQueryCache().findAll({ queryKey: ['permissao-efetiva'] })
    .some((q) => q.state.status === 'success' && q.state.fetchStatus === 'idle');
const abrir = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  // Espera por condição (não por relógio): a primeira montagem do arquivo é lenta.
  await waitFor(() => {
    expect(permissaoCarregada()).toBe(true);
    expect(mapa.atual?.fits.length).toBeGreaterThan(0);
  }, { timeout: 8000 });
  await assentar();
};
/** Mudança feita pelo administrador chega com a página MONTADA (revalidação). */
const trocarPermissao = async (registro) => {
  sessao.permissoes = registro;
  await act(async () => { await client.invalidateQueries({ queryKey: ['permissao-efetiva'] }); });
  await assentar();
};
const trocarEmpresa = async (empresa) => {
  await act(async () => { persistirEmpresaSelecionada(empresa, 'tenant-1'); });
  await assentar();
};
const abrirFiltros = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Filtros' })); });
  return within(screen.getByRole('dialog', { name: 'Filtros e Camadas' }));
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  sessao.usuario = ANA;
  sessao.clienteIdAuth = 'tenant-1';
  sessao.permissoes = null;
  dados.porEmpresa = { 'emp-1': { areas: AREAS_EMP1, lotes: LOTES_EMP1 }, 'emp-2': { areas: AREAS_EMP2, lotes: [] } };
  dados.pendentes = {};
  desenho.ultimo = {};
  mapa.atual = null;
});
afterEach(cleanup);

describe('PREF-02 — sem "Ver filtros e camadas": mostra o PADRÃO e guarda a preferência', () => {
  it('filtros e camadas salvos NÃO se aplicam (lotes e áreas visíveis, sem filtro, cor padrão) e o storage fica intacto', async () => {
    localStorage.setItem(chave('emp-1'), JSON.stringify(PREF_ANA));
    sessao.permissoes = linha({ visualizar_filtros_camadas: false });
    await abrir();

    expect(screen.queryByRole('button', { name: 'Filtros' }), 'painel inacessível').toBeNull();
    expect(lotesDesenhados()).toMatchObject({ visiveis: true, quantos: 2 });
    expect(desenho.ultimo.areas?.[1], 'áreas visíveis (padrão)').toBe(true);
    expect(desenho.ultimo.areas?.[0]?.length, 'filtro de setor salvo não corta áreas').toBe(2);
    expect(desenho.ultimo.rotulos?.[3], 'hectares do padrão').toBe(true);
    expect(animais(), 'Animais conta todas as categorias').toBe(15);
    expect(screen.queryByText('Situação do Pasto'), 'cor salva não pinta nem mostra legenda').toBeNull();
    expect(ler(chave('emp-1')), 'preferência guardada, sem reescrita').toMatchObject(PREF_ANA);
  });

  it('a permissão volta (mesma montagem): a preferência guardada volta a valer, sem ter sido perdida', async () => {
    localStorage.setItem(chave('emp-1'), JSON.stringify(PREF_ANA));
    sessao.permissoes = linha({ visualizar_filtros_camadas: false });
    await abrir();
    expect(lotesDesenhados().visiveis).toBe(true);

    await trocarPermissao(linha({}));
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument();
    expect(lotesDesenhados().visiveis, 'Lotes desligado pelo próprio usuário').toBe(false);
    expect(desenho.ultimo.areas?.[1]).toBe(false);
    expect(animais(), 'só BOI do setor s1').toBe(10);
    expect(screen.getByText('Situação do Pasto')).toBeInTheDocument();
    expect(ler(chave('emp-1'))).toMatchObject(PREF_ANA);
  });

  it('controle: COM a permissão a preferência é aplicada desde a abertura', async () => {
    localStorage.setItem(chave('emp-1'), JSON.stringify(PREF_ANA));
    await abrir();
    expect(lotesDesenhados().visiveis).toBe(false);
    expect(desenho.ultimo.areas?.[0]?.length).toBe(1);
    expect(animais()).toBe(10);
  });

  it('sem filtros, Mover e Minha localização continuam funcionando (preferência própria deles)', async () => {
    sessao.permissoes = linha({ visualizar_filtros_camadas: false, mover_lotes: true });
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ativar arrasto' })); });
    expect(screen.getByRole('button', { name: 'Arrasto ativo' })).toHaveAttribute('aria-pressed', 'true');
    expect(lotesDesenhados().arrastaveis).toBe(true);
    expect(ler(chave('emp-1'))?.dragLotesEnabled).toBe(true);

    let responder;
    navigator.geolocation.getCurrentPosition.mockImplementation((ok) => { responder = ok; });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Minha localização' })); });
    await act(async () => { responder({ coords: { latitude: -15.005, longitude: -47.005 } }); });
    await assentar();
    expect(desenho.ultimo.localizacao).toEqual([{ lat: -15.005, lng: -47.005 }, true]);
  });
});

describe('PREF-04 — controles só com a permissão que os faz funcionar', () => {
  it('operador sem mover_lotes, sem visualizar_localizacao e sem a tela de Tarefas: sem Mover, sem Localizar, sem a chave Tarefas', async () => {
    sessao.permissoes = linha({ visualizar_localizacao: false });
    await abrir();
    expect(screen.getByRole('button', { name: 'Atualizar mapa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ativar arrasto' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arrasto ativo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Minha localização' })).toBeNull();
    const filtros = await abrirFiltros();
    expect(filtros.getByRole('switch', { name: 'Lotes' }), 'controle: camada permitida aparece').toBeInTheDocument();
    expect(filtros.queryByRole('switch', { name: 'Tarefas' })).toBeNull();
    const salvo = ler(chave('emp-1'));
    expect(salvo?.dragLotesEnabled).toBe(false);
    expect(salvo?.showUserLocation).toBe(false);
  });

  it('operador com mover_lotes e a tela de Tarefas: Mover alterna e grava; chave Tarefas aparece', async () => {
    sessao.permissoes = linha({ mover_lotes: true }, [TELA_TAREFAS]);
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ativar arrasto' })); });
    expect(lotesDesenhados().arrastaveis).toBe(true);
    expect(ler(chave('emp-1'))?.dragLotesEnabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Minha localização' })).toBeInTheDocument();
    const filtros = await abrirFiltros();
    expect(filtros.getByRole('switch', { name: 'Tarefas' })).toBeInTheDocument();
  });

  it('administrador da fazenda vê os três', async () => {
    sessao.usuario = { ...ANA, administrador_fazenda: true };
    await abrir();
    expect(screen.getByRole('button', { name: 'Ativar arrasto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minha localização' })).toBeInTheDocument();
    const filtros = await abrirFiltros();
    expect(filtros.getByRole('switch', { name: 'Tarefas' })).toBeInTheDocument();
  });
});

describe('PREF-06 — vista salva só depois de enquadrar a empresa atual', () => {
  it('arrastar enquanto a empresa nova carrega NÃO grava a vista anterior na chave dela; depois enquadra a nova e volta a gravar', async () => {
    const areasEmp2 = deferred();
    dados.pendentes['areas:emp-2'] = areasEmp2;
    await abrir();
    expect(mapa.atual?.fits.length, 'emp-1 enquadrada').toBe(1);

    await trocarEmpresa('emp-2');
    // O mapa ainda mostra a fazenda da emp-1; o usuário arrasta (moveend).
    await act(async () => { mapa.atual.arrastar(-15.005, -47.005); });
    expect(localStorage.getItem('mapa_geral_view_emp-2'), 'vista da emp-1 gravada como da emp-2').toBeNull();

    await act(async () => { areasEmp2.resolve(AREAS_EMP2); });
    await assentar();
    const ultimoFit = mapa.atual.fits.at(-1);
    expect(ultimoFit?.[1], 'enquadrou a emp-2 (não pulou para a vista errada)').toEqual([-50, -20]);
    expect(ultimoFit?.[0]?.[1]).toBeCloseTo(-20.01, 5);
    expect(JSON.parse(localStorage.getItem('mapa_geral_view_emp-2') || 'null')?.center?.lat).toBeCloseTo(-20.005, 5);

    await act(async () => { mapa.atual.arrastar(-20.002, -50.002); });
    expect(JSON.parse(localStorage.getItem('mapa_geral_view_emp-2') || 'null')?.center).toEqual({ lat: -20.002, lng: -50.002 });
  });
});

describe('PREF-07 — GPS que responde depois da troca de escopo', () => {
  it('pedido na emp-1, resposta já na emp-2: a emp-2 NÃO ganha Localização ligada nem pulo de mapa', async () => {
    let responder;
    navigator.geolocation.getCurrentPosition.mockImplementation((ok) => { responder = ok; });
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Minha localização' })); });
    await trocarEmpresa('emp-2');
    const pulosAntes = mapa.atual.jumps.length;

    await act(async () => { responder({ coords: { latitude: -21.5, longitude: -51.5 } }); });
    await assentar();
    expect(ler(chave('emp-2'))?.showUserLocation, 'preferência da emp-2 intacta').toBe(false);
    expect(ler(chave('emp-1'))?.showUserLocation).toBe(false);
    expect(desenho.ultimo.localizacao?.[1]).toBe(false);
    expect(mapa.atual.jumps.slice(pulosAntes).some((j) => j.center[1] === -21.5)).toBe(false);
  });

  it('controle: resposta no MESMO escopo liga a localização, pula para a posição e grava', async () => {
    let responder;
    navigator.geolocation.getCurrentPosition.mockImplementation((ok) => { responder = ok; });
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Minha localização' })); });
    await act(async () => { responder({ coords: { latitude: -15.005, longitude: -47.005 } }); });
    await assentar();
    expect(ler(chave('emp-1'))?.showUserLocation).toBe(true);
    expect(desenho.ultimo.localizacao).toEqual([{ lat: -15.005, lng: -47.005 }, true]);
    expect(mapa.atual.jumps.at(-1)).toEqual({ center: [-47.005, -15.005], zoom: 18 });
  });
});

describe('PREF-02 — preferenciaAplicada (regra pura)', () => {
  const pref = {
    ...PADRAO_FILTROS_MAPA, ...PREF_ANA, filtroPesoMin: 200, showUserLocation: true, dragLotesEnabled: true, estiloPasto: 'contorno',
  };

  it('sem filtros: todo campo do painel volta ao PADRÃO; os de botão próprio e a Visualização ficam', () => {
    const aplicada = preferenciaAplicada(pref, { podeFiltrar: false, podeColorir: false });
    for (const k of CAMPOS_DO_PAINEL_FILTROS) expect(aplicada[k], k).toEqual(PADRAO_FILTROS_MAPA[k]);
    expect(aplicada.modoColoracao).toBe('padrao');
    expect(aplicada.showUserLocation, 'Minha localização tem permissão própria').toBe(true);
    expect(aplicada.dragLotesEnabled, 'Mover tem permissão própria').toBe(true);
    expect(aplicada.estiloPasto, 'Visualização preservada').toBe('contorno');
    expect(pref.filtroCategoria, 'a preferência não é alterada').toBe('BOI');
  });

  it('com filtros e sem colorir: só a cor volta ao padrão; com os dois, nada muda', () => {
    expect(preferenciaAplicada(pref, { podeFiltrar: true, podeColorir: false })).toEqual({ ...pref, modoColoracao: 'padrao' });
    expect(preferenciaAplicada(pref, { podeFiltrar: true, podeColorir: true })).toEqual(pref);
  });
});
