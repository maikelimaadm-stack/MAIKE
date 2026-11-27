/**
 * D-PROD-218 — barra do topo do Mapa Geral (⚙ · Lotes · Pastos · Tarefas) e o
 * foco do mapa. A parte integrada monta o MapaGeral REAL com os mesmos mocks
 * de borda de mapaPreferenciasIntegrada (cache do mapa, sessão, MapLibre falso
 * e renderer que registra a última chamada de cada `sync*`): o que o mapa
 * DESENHA em cada foco é lido dos argumentos do renderer.
 *
 * BARRA-1  regra pura do foco (src/lib/mapaFoco.js).
 * BARRA-2  barra: ⚙ "Filtros", segmentos por permissão, aria-pressed, Tarefas
 *          liga o foco (D-PROD-321: a lista abre pelo cartão de baixo do mapa), setas.
 * BARRA-3  MapaGeral: argumentos dos renderer.sync* em Lotes, Pastos e Tarefas;
 *          movimentações lidas só quando o foco/cor pedem e relidas no servidor
 *          pelo "Atualizar mapa" no foco Pastos.
 * BARRA-4  rótulo do foco Pastos: "x,x UA (y,yy/ha)", "x,x UA", "Descanso Nd".
 * BARRA-5  perdeu a permissão do foco atual → volta para Lotes.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

import MapaControlesMobile from '@/components/mapa/MapaControlesMobile';
import { FOCOS_MAPA, FOCO_PADRAO, camadasDoFoco, focoEmVigor, focosPermitidos } from '@/lib/mapaFoco';
import { salvarFiltrosMapaGeral } from '@/lib/mapaGeralFiltrosStorage';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: null }));
/**
 * Dados "do servidor" por empresa, a cópia local (o IndexedDB do cache do mapa),
 * as chaves pedidas ao cache e, dessas, as pedidas com `force: true`.
 */
const dados = vi.hoisted(() => ({ porEmpresa: {}, local: {}, pedidas: [], forcadas: [] }));
const mapa = vi.hoisted(() => ({ atual: null }));
/** Última chamada de cada `sync*` do renderer: é o que aparece no mapa. */
const desenho = vi.hoisted(() => ({ ultimo: {} }));

vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: 'tenant-1', isAuthenticated: true, logout: vi.fn() }),
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
  // Como o serviço real dentro da janela de 60 s: sem `force`, uma chave já
  // lida devolve a cópia local; com `force`, vai ao servidor e troca a cópia.
  refreshMapaCacheEntry: (k, emp, opts) => {
    const forcar = opts?.force === true;
    dados.pedidas.push(k);
    if (forcar) dados.forcadas.push(k);
    if (!dados.local[emp]) dados.local[emp] = {};
    const local = dados.local[emp];
    if (forcar || !(k in local)) local[k] = dados.porEmpresa[emp]?.[k] ?? [];
    return Promise.resolve(local[k]);
  },
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
// A Gestão de Tarefas que JÁ existe (o diálogo é o real; o painel fica de fora).
vi.mock('@/components/mapa/TarefasMapaPanel', async () => {
  const { createElement } = await import('react');
  // D-PROD-321: guarda as props (o "Nova tarefa" passa o local pela posição do celular).
  return { default: (props) => { globalThis.__painelTarefas = props; return createElement('p', null, 'Lista de tarefas'); } };
});
// D-PROD-325: os detalhes da tarefa ficam de fora (guarda as props: o ‹ Voltar só existe vindo da lista).
vi.mock('@/components/mapa/DetalhesTarefaMapa', async () => {
  const { createElement } = await import('react');
  return { default: (props) => { globalThis.__detalhesTarefa = props; return createElement('p', null, `Detalhes de ${props.tarefa?.titulo}`); } };
});
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
      jumpTo({ center, zoom: z }) {
        centro = { lng: center[0], lat: center[1] };
        if (Number.isFinite(z)) zoom = z;
        map.disparar('moveend');
      },
      fitBounds(b) {
        map.fits.push(b);
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
const ADMIN = { ...ANA, administrador_fazenda: true };
const ESCOPO = { clienteId: 'tenant-1', login: 'ana', empresaId: 'emp-1' };

/** "AAAA-MM-DD" de `dias` atrás, no dia civil local (o que a situação do pasto lê). */
const diaCivilAtras = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  const dd = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
};
const quadrado = (lat, lng) => ({ coords: [
  { lat, lng }, { lat, lng: lng - 0.01 }, { lat: lat - 0.01, lng: lng - 0.01 }, { lat: lat - 0.01, lng },
] });
const area = (id, lat, extra = {}) => ({ id, empresa_id: 'emp-1', ativo: true, nome: id.toUpperCase(), setor_id: 's1', coordenadas: quadrado(lat, -47), ...extra });
// A1 com gado e hectares; A2 sem gado, em descanso há 21 dias; A3 sem gado nem
// histórico; A4 com gado e sem hectares.
const A1 = area('a1', -15, { tamanho_hectares: 4 });
const A2 = area('a2', -15.02, { tamanho_hectares: 6 });
const A3 = area('a3', -15.04, { tamanho_hectares: 3 });
const A4 = area('a4', -15.06);
const LOTES = [
  { id: 'l1', empresa_id: 'emp-1', status: 'Ativo', area_atual_id: 'a1', categoria: 'BOI', quantidade_cabecas: 10, peso_medio_kg: 450 },
  { id: 'l2', empresa_id: 'emp-1', status: 'Ativo', area_atual_id: 'a4', categoria: 'VACA', quantidade_cabecas: 3, peso_medio_kg: 300 },
];
const MOVIMENTACOES = [
  { id: 'm1', empresa_id: 'emp-1', tipo: 'Transferência de Área', lote_id: 'l1', area_origem_id: 'a2', area_destino_id: 'a1', data_movimentacao: diaCivilAtras(21) },
];
/** Chega ao servidor com o mapa já aberto: a saída do A3, há 5 dias. */
const SAIDA_DO_A3 = { id: 'm2', empresa_id: 'emp-1', tipo: 'Transferência de Área', lote_id: 'l2', area_origem_id: 'a3', area_destino_id: 'a4', data_movimentacao: diaCivilAtras(5) };
const PONTOS_SUPL = [
  { id: 'c1', empresa_id: 'emp-1', status: 'Ativo', categoria_ponto: 'COCHO', area_vinculada_ids: ['a1'], coordenadas: { lat: -15.005, lng: -47.005 } },
];
const TAREFAS = [
  { id: 't1', empresa_id: 'emp-1', titulo: 'Consertar cerca', area_id: 'a1', prioridade: 'Alta', status: 'Pendente' },
];

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });

let client;
/** Onde o roteador está (D-PROD-333: o "+" de Pontos leva ao cadastro). */
const rota = { atual: '' };
function SondaDeRota() {
  const l = useLocation();
  rota.atual = `${l.pathname}${l.search}`;
  return null;
}
const permissaoCarregada = () =>
  client.getQueryCache().findAll({ queryKey: ['permissao-efetiva'] })
    .some((q) => q.state.status === 'success' && q.state.fetchStatus === 'idle');
const abrir = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><SondaDeRota /><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  await waitFor(() => {
    expect(permissaoCarregada()).toBe(true);
    expect(mapa.atual?.fits.length).toBeGreaterThan(0);
  }, { timeout: 8000 });
  await assentar();
};
const trocarPermissao = async (registro) => {
  sessao.permissoes = registro;
  await act(async () => { await client.invalidateQueries({ queryKey: ['permissao-efetiva'] }); });
  await assentar();
};

const barra = () => within(screen.getByRole('toolbar', { name: 'Mapa' }));
const nomesDaBarra = () => barra().getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent);
const pressionado = (nome) => screen.getByRole('button', { name: nome, hidden: true }).getAttribute('aria-pressed');
const tocar = async (nome) => {
  await act(async () => { fireEvent.click(barra().getByRole('button', { name: nome })); });
  await assentar();
};
const atualizarMapa = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Atualizar mapa' })); });
  await assentar();
};

/** O que o mapa está desenhando agora, pela última chamada de cada `sync*`. */
const noMapa = () => ({
  lotes: desenho.ultimo.lotes?.[2],
  lotesNaLista: desenho.ultimo.lotes?.[0]?.length,
  cochos: desenho.ultimo.suplementacao?.[1],
  tarefas: desenho.ultimo.tarefas?.[0]?.length,
  textoNoRotulo: typeof desenho.ultimo.rotulos?.[2] === 'function',
});
const rotulo = (a) => desenho.ultimo.rotulos?.[2]?.(a) ?? null;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  sessao.usuario = ADMIN;
  sessao.permissoes = null;
  dados.porEmpresa = {
    'emp-1': { areas: [A1, A2, A3, A4], lotes: LOTES, movimentacoes: MOVIMENTACOES, pontosSuplementacao: PONTOS_SUPL, tarefas: TAREFAS },
  };
  dados.local = {};
  dados.pedidas = [];
  dados.forcadas = [];
  desenho.ultimo = {};
  mapa.atual = null;
});
afterEach(cleanup);

describe('BARRA-1 — regra pura do foco (src/lib/mapaFoco.js)', () => {
  it('segmentos na ordem da tela; Lotes é o padrão', () => {
    expect(FOCOS_MAPA.map((f) => [f.id, f.rotulo])).toEqual([['lotes', 'Lotes'], ['pastos', 'Pastos'], ['tarefas', 'Tarefas']]);
    expect(FOCO_PADRAO).toBe('lotes');
  });

  it('focos por permissão: Lotes sempre; Pastos com áreas; Tarefas com o uso das tarefas no mapa', () => {
    expect(focosPermitidos()).toEqual(['lotes']);
    expect(focosPermitidos({ visualizarAreas: true })).toEqual(['lotes', 'pastos']);
    expect(focosPermitidos({ usarTarefas: true })).toEqual(['lotes', 'tarefas']);
    expect(focosPermitidos({ visualizarAreas: true, usarTarefas: true })).toEqual(['lotes', 'pastos', 'tarefas']);
    expect(focosPermitidos(/** @type {any} */ ({ visualizarAreas: 1, usarTarefas: 'sim' })), 'só true libera').toEqual(['lotes']);
  });

  it('foco em vigor: sem a permissão (ou desconhecido) volta para Lotes', () => {
    expect(focoEmVigor('pastos', ['lotes', 'pastos'])).toBe('pastos');
    expect(focoEmVigor('pastos', ['lotes', 'tarefas'])).toBe('lotes');
    expect(focoEmVigor('tarefas', ['lotes'])).toBe('lotes');
    expect(focoEmVigor('mapa', ['lotes', 'pastos', 'tarefas'])).toBe('lotes');
  });

  it('o que cada foco deixa no mapa (o mesmo objeto a cada chamada)', () => {
    // D-PROD-326: cada aba com as suas coisas — Lotes sem cochos/depósitos e sem tarefas.
    expect(camadasDoFoco('lotes')).toEqual({ lotes: true, suplementacao: false, tarefas: false, lotacaoNoRotulo: false });
    expect(camadasDoFoco('pastos')).toEqual({ lotes: false, suplementacao: true, tarefas: false, lotacaoNoRotulo: true });
    expect(camadasDoFoco('tarefas')).toEqual({ lotes: false, suplementacao: false, tarefas: true, lotacaoNoRotulo: false });
    expect(camadasDoFoco('outro')).toBe(camadasDoFoco('lotes'));
    expect(camadasDoFoco('pastos')).toBe(camadasDoFoco('pastos'));
    expect(Object.isFrozen(camadasDoFoco('tarefas'))).toBe(true);
  });
});

describe('BARRA-2 — barra do topo (MapaControlesMobile)', () => {
  const montar = (extra = {}) => {
    const props = {
      mapType: 'roadmap', setMapType: vi.fn(), onRefresh: vi.fn(), onLocate: vi.fn(), onToggleDrag: vi.fn(),
      onOpenTarefas: vi.fn(), onOpenFiltros: vi.fn(), onFoco: vi.fn(),
      focosPermitidos: ['lotes', 'pastos', 'tarefas'], ...extra,
    };
    render(<MapaControlesMobile {...props} />);
    return props;
  };

  it('⚙ "Filtros" abre o painel Filtro de hoje; segmentos na ordem, Lotes pressionado', () => {
    const p = montar();
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Pontos', 'Tarefas', 'Visualização do mapa: Mapa']);
    const cfg = barra().getByRole('button', { name: 'Filtros' });
    expect(cfg).toHaveAttribute('title', 'Filtros');
    expect(cfg.className).toBe('mk-mapa-barra__cfg');
    expect(pressionado('Lotes')).toBe('true');
    expect(pressionado('Pontos')).toBe('false');
    expect(pressionado('Tarefas')).toBe('false');
    fireEvent.click(cfg);
    expect(p.onOpenFiltros).toHaveBeenCalledTimes(1);
    expect(p.onFoco).not.toHaveBeenCalled();
    expect(barra().getByRole('button', { name: /Visualização do mapa:/ }).closest('.mk-mapa-dir')).toBeNull();
  });

  it('Pontos mantém o foco de áreas; Tarefas (D-PROD-321) só liga o foco, sem abrir a lista', () => {
    const p = montar();
    fireEvent.click(barra().getByRole('button', { name: 'Pontos' }));
    expect(p.onFoco).toHaveBeenLastCalledWith('pastos');
    fireEvent.click(barra().getByRole('button', { name: 'Tarefas' }));
    expect(p.onFoco).toHaveBeenLastCalledWith('tarefas');
    expect(p.onOpenTarefas).not.toHaveBeenCalled();
  });

  it('segmentos por permissão; mesmo sem filtros e com um segmento, Visualização permanece na barra', () => {
    montar({ focosPermitidos: ['lotes'] });
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Visualização do mapa: Mapa']);
    cleanup();
    montar({ focosPermitidos: ['lotes', 'pastos'], showFiltrosButton: false });
    expect(nomesDaBarra()).toEqual(['Lotes', 'Pontos', 'Visualização do mapa: Mapa']);
    expect(screen.getByRole('toolbar', { name: 'Mapa' }).className).toContain('mk-mapa-barra--sem-cfg');
    cleanup();
    montar({ focosPermitidos: ['lotes'], showFiltrosButton: false });
    expect(barra().getByRole('button', { name: /Visualização do mapa:/ })).toBeInTheDocument();
    // Os botões da direita continuam iguais.
    expect(screen.getByRole('button', { name: 'Visualização do mapa: Mapa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar mapa' })).toBeInTheDocument();
  });

  it('padrão fechado: sem focosPermitidos só existe Lotes; os chips antigos sumiram', () => {
    render(<MapaControlesMobile mapType="roadmap" setMapType={() => {}} onRefresh={() => {}} onLocate={() => {}} onToggleDrag={() => {}} onOpenTarefas={() => {}} onOpenFiltros={() => {}} />);
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Visualização do mapa: Mapa']);
    expect(document.querySelector('.mk-mapa-chip, .mk-mapa-topo')).toBeNull();
    // Classes próprias: nada do !important de .mk-mapa-btn/.mk-mapa-card na barra.
    expect(document.querySelector('.mk-mapa-barra :is(.mk-mapa-btn, .mk-mapa-card, .mk-mapa-chip)')).toBeNull();
  });

  it('setas, Home e End andam entre os botões da barra', () => {
    montar();
    const botao = (nome) => barra().getByRole('button', { name: nome });
    botao('Lotes').focus();
    fireEvent.keyDown(botao('Lotes'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(botao('Pontos'));
    fireEvent.keyDown(botao('Pontos'), { key: 'End' });
    expect(document.activeElement).toBe(botao('Visualização do mapa: Mapa'));
    fireEvent.keyDown(botao('Visualização do mapa: Mapa'), { key: 'ArrowRight' });
    expect(document.activeElement, 'dá a volta').toBe(botao('Filtros'));
    fireEvent.keyDown(botao('Filtros'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(botao('Visualização do mapa: Mapa'));
    fireEvent.keyDown(botao('Pontos'), { key: 'Home' });
    expect(document.activeElement).toBe(botao('Filtros'));
  });
});

describe('BARRA-3 — MapaGeral real: o que cada foco desenha', () => {
  it('abre em Lotes (como hoje); Pastos tira lotes e tarefas; Tarefas (D-PROD-321) tira lotes e cochos, mostra o resumo das tarefas e abre a lista pelo cartão', async () => {
    await abrir();
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Pontos', 'Tarefas', 'Visualização do mapa: Satélite']);
    expect(pressionado('Lotes')).toBe('true');
    expect(noMapa()).toEqual({ lotes: true, lotesNaLista: 2, cochos: false, tarefas: 0, textoNoRotulo: false });

    await tocar('Pontos');
    expect(pressionado('Pontos')).toBe('true');
    expect(noMapa()).toEqual({ lotes: false, lotesNaLista: 2, cochos: true, tarefas: 0, textoNoRotulo: true });

    await tocar('Tarefas');
    expect(pressionado('Tarefas')).toBe('true');
    expect(noMapa()).toMatchObject({ lotes: false, cochos: false, tarefas: 1, textoNoRotulo: false });
    // O cartão de baixo resume as tarefas (no lugar dos animais) e abre a lista; "Nova tarefa" ao lado.
    const cartao = screen.getByRole('button', { name: 'Resumo das tarefas' });
    expect(cartao.textContent).toContain('1tarefa aberta');
    expect(screen.getByRole('button', { name: 'Nova tarefa' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Tarefas' })).toBeNull();
    await act(async () => { fireEvent.click(cartao); });
    expect(within(screen.getByRole('dialog', { name: 'Tarefas' })).getByText('Lista de tarefas')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' }); });

    await tocar('Lotes');
    expect(pressionado('Lotes')).toBe('true');
    expect(noMapa()).toEqual({ lotes: true, lotesNaLista: 2, cochos: false, tarefas: 0, textoNoRotulo: false });
  });

  it('o ⚙ abre o painel Filtro de sempre', async () => {
    await abrir();
    await act(async () => { fireEvent.click(barra().getByRole('button', { name: 'Filtros' })); });
    expect(within(screen.getByRole('dialog', { name: 'Filtro' })).getByRole('checkbox', { name: 'Lotes' })).toBeInTheDocument();
  });

  it('as movimentações (dias de descanso) só são lidas quando o foco Pastos ou a cor "Situação do Pasto" pedem; no foco Pastos, "Atualizar mapa" relê no servidor', async () => {
    await abrir();
    expect(dados.pedidas).not.toContain('movimentacoes');
    await atualizarMapa();
    expect(dados.pedidas, 'foco Lotes: nem o "Atualizar mapa" lê').not.toContain('movimentacoes');

    await tocar('Pontos');
    await waitFor(() => expect(dados.pedidas).toContain('movimentacoes'));
    await waitFor(() => expect(rotulo(A2)).toBe('Descanso 21d'));
    expect(rotulo(A3)).toBeNull();

    // Sem `force` a leitura devolveria a cópia local: o "Atualizar mapa" tem de
    // ir ao servidor E reler a consulta para o rótulo do A3 mudar.
    dados.porEmpresa['emp-1'].movimentacoes = [...MOVIMENTACOES, SAIDA_DO_A3];
    dados.forcadas = [];
    await atualizarMapa();
    expect(dados.forcadas, 'vai ao servidor').toContain('movimentacoes');
    await waitFor(() => expect(rotulo(A3), 'e o rótulo usa o dado novo').toBe('Descanso 5d'));
  });
});

describe('BARRA-6 — D-PROD-321: "Nova tarefa" já sabe onde a pessoa está', () => {
  const posicao = (resultado) => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok, falha) => (resultado ? ok({ coords: resultado }) : falha({ code: 1 })) },
    });
  };

  it('dentro de um pasto: a tarefa nova abre com esse pasto e o ponto', async () => {
    posicao({ latitude: -15.005, longitude: -47.005 });
    await abrir();
    await tocar('Tarefas');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' })); });
    const p = /** @type {any} */ (globalThis).__painelTarefas;
    expect(p).toMatchObject({ areaId: 'a1', areaNome: 'A1', initialCoordinates: { lat: -15.005, lng: -47.005 } });
    // D-PROD-325: o formulário abre na própria janela (pelo mapa: ao sair, fecha tudo).
    expect(p.formulario).toEqual({ tarefa: null, voltarParaLista: false });
    expect(screen.getByRole('dialog', { name: 'Nova tarefa' })).toBeInTheDocument();
    expect(typeof p.onNovaTarefa).toBe('function');
    expect(typeof p.onAbrirTarefa).toBe('function');
  });

  it('sem a posição (sem permissão): abre a tarefa nova sem local, para escolher setor e pasto', async () => {
    posicao(null);
    await abrir();
    await tocar('Tarefas');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' })); });
    const p = /** @type {any} */ (globalThis).__painelTarefas;
    expect(p).toMatchObject({ formulario: { tarefa: null, voltarParaLista: false }, initialCoordinates: null });
    expect(p.areaId).toBeUndefined();
  });
});

describe('BARRA-4 — rótulo da área no foco Pastos', () => {
  it('lotação "x,x UA (y,yy/ha)", "x,x UA" sem hectares e "Descanso Nd" na área sem gado em descanso', async () => {
    await abrir();
    expect(rotulo(A1), 'foco Lotes com a cor padrão: sem texto extra').toBeNull();
    await tocar('Pontos');
    await waitFor(() => expect(rotulo(A2)).toBe('Descanso 21d'));
    expect(rotulo(A1)).toBe('10,0 UA (2,50/ha)');
    expect(rotulo(A4)).toBe('2,0 UA');
    expect(rotulo(A3), 'sem gado e sem histórico: nada').toBeNull();
  });

  it('no foco Pastos a lotação vence a cor "Situação do Pasto"; no foco Lotes vale a situação', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { modoColoracao: 'situacao_pasto' });
    await abrir();
    await waitFor(() => expect(rotulo(A1)).toBe('Ocupado 21d'));
    expect(rotulo(A2)).toBe('Descanso 21d');
    await tocar('Pontos');
    expect(rotulo(A1)).toBe('10,0 UA (2,50/ha)');
    expect(rotulo(A2)).toBe('Descanso 21d');
    expect(rotulo(A3)).toBeNull();
  });

  it('foco Lotes com "UA por Hectare": área sem gado não mostra descanso (como hoje)', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { modoColoracao: 'ua_ha' });
    await abrir();
    expect(rotulo(A1)).toBe('10,0 UA (2,50/ha)');
    expect(rotulo(A2)).toBeNull();
  });
});

describe('BARRA-5 — perdeu a permissão do foco atual: volta para Lotes', () => {
  it('Pastos some sem "Ver áreas"; o mapa volta a mostrar os lotes e o foco não volta sozinho', async () => {
    sessao.usuario = ANA;
    sessao.permissoes = linha({}, [TELA_TAREFAS]);
    await abrir();
    await tocar('Pontos');
    expect(noMapa().lotes).toBe(false);

    await trocarPermissao(linha({ visualizar_areas: false }, [TELA_TAREFAS]));
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Tarefas', 'Visualização do mapa: Satélite']);
    expect(pressionado('Lotes')).toBe('true');
    expect(noMapa().lotes).toBe(true);

    await trocarPermissao(linha({}, [TELA_TAREFAS]));
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Pontos', 'Tarefas', 'Visualização do mapa: Satélite']);
    expect(pressionado('Lotes'), 'o foco foi reposto, não só escondido').toBe('true');
  });

  it('Tarefas some sem a tela de Tarefas; a lista de tarefas fecha e o foco volta para Lotes', async () => {
    sessao.usuario = ANA;
    sessao.permissoes = linha({}, [TELA_TAREFAS]);
    await abrir();
    await tocar('Tarefas');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resumo das tarefas' })); });
    expect(screen.getByRole('dialog', { name: 'Tarefas' })).toBeInTheDocument();

    await trocarPermissao(linha({}, []));
    expect(screen.queryByRole('dialog', { name: 'Tarefas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nova tarefa' })).toBeNull();
    expect(nomesDaBarra()).toEqual(['Filtros', 'Lotes', 'Pontos', 'Visualização do mapa: Satélite']);
    expect(pressionado('Lotes')).toBe('true');
    expect(noMapa()).toMatchObject({ lotes: true, cochos: false, tarefas: 0 });
  });

  it('sem filtros a barra mantém Visualização e só os segmentos autorizados', async () => {
    sessao.usuario = ANA;
    sessao.permissoes = linha({ visualizar_filtros_camadas: false, visualizar_areas: false });
    await abrir();
    expect(barra().getByRole('button', { name: /Visualização do mapa:/ })).toBeInTheDocument();
    expect(noMapa().lotes).toBe(true);

    await trocarPermissao(linha({ visualizar_filtros_camadas: false }));
    expect(nomesDaBarra()).toEqual(['Lotes', 'Pontos', 'Visualização do mapa: Satélite']);
  });
});

describe('BARRA-7 — D-PROD-325: a tarefa abre numa janela só', () => {
  const janelas = () => screen.queryAllByRole('dialog');

  it('da lista: os detalhes entram NO LUGAR da lista (uma janela) e o ‹ volta para ela', async () => {
    await abrir();
    await tocar('Tarefas');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resumo das tarefas' })); });
    expect(janelas()).toHaveLength(1);
    await act(async () => { /** @type {any} */ (globalThis).__painelTarefas.onAbrirTarefa({ id: 't-9', titulo: 'CERCA' }); });

    expect(janelas(), 'sem a lista atrás').toHaveLength(1);
    const detalhes = screen.getByRole('dialog');
    expect(within(detalhes).getByText('Detalhes de CERCA')).toBeInTheDocument();
    expect(screen.queryByText('Lista de tarefas')).toBeNull();
    const props = /** @type {any} */ (globalThis).__detalhesTarefa;
    expect(typeof props.onVoltar).toBe('function');
    expect(props.anim).toBe('empurrar');

    await act(async () => { props.onVoltar(); });
    expect(janelas()).toHaveLength(1);
    expect(within(screen.getByRole('dialog', { name: 'Tarefas' })).getByText('Lista de tarefas')).toBeInTheDocument();
  });

  it('o formulário entra na mesma janela, com o título certo e o ✓; ao sair volta a ser a lista', async () => {
    await abrir();
    await tocar('Tarefas');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resumo das tarefas' })); });
    const painel = () => /** @type {any} */ (globalThis).__painelTarefas;
    await act(async () => { painel().onFormularioChange({ tarefa: null, voltarParaLista: true }); });
    expect(janelas()).toHaveLength(1);
    const form = screen.getByRole('dialog', { name: 'Nova tarefa' });
    expect(within(form).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();

    await act(async () => { painel().onFormularioChange({ tarefa: { id: 't-1' }, voltarParaLista: true }); });
    expect(screen.getByRole('dialog', { name: 'Editar tarefa' })).toBeInTheDocument();
    await act(async () => { painel().onFormularioChange(null); });
    expect(screen.getByRole('dialog', { name: 'Tarefas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('"Nova tarefa" pela lista volta para a lista ao sair; pelo mapa, fecha tudo', async () => {
    Object.defineProperty(window.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_ok, falha) => falha({ code: 1 }) } });
    await abrir();
    await tocar('Tarefas');
    const painel = () => /** @type {any} */ (globalThis).__painelTarefas;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' })); });
    expect(painel().formulario).toEqual({ tarefa: null, voltarParaLista: false });
    await act(async () => { painel().onClose(); });
    expect(janelas()).toHaveLength(0);

    // Abrir a lista de novo começa pela lista (o formulário de antes não volta).
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resumo das tarefas' })); });
    expect(painel().formulario).toBeNull();
    await act(async () => { painel().onNovaTarefa(); });
    expect(painel().formulario).toEqual({ tarefa: null, voltarParaLista: true });
    expect(janelas()).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Nova tarefa' })).toBeInTheDocument();
  });
});

describe('BARRA-8 — D-PROD-326: cada aba com as suas camadas e os seus filtros', () => {
  const filtro = async () => {
    await act(async () => { fireEvent.click(barra().getByRole('button', { name: 'Filtros' })); });
    return within(screen.getByRole('dialog', { name: 'Filtro' }));
  };
  const caixas = (f) => f.queryAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
  const fecharFiltro = async () => { await act(async () => { fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' }); }); };

  it('o painel mostra só o que é da aba', async () => {
    await abrir();
    let f = await filtro();
    expect(caixas(f)).toEqual(['Mapa de Áreas', 'Detalhes Áreas', 'Hectares', 'Pontos Referência', 'Lotes', 'Linhas (cercas, rios)', 'Alertas', 'Localização']);
    expect(f.getByText('Filtros de Áreas')).toBeInTheDocument();
    expect(f.getByText('Filtros de Categorias de Manejo')).toBeInTheDocument();
    expect(f.queryByText('Filtros de Tarefas')).toBeNull();
    await fecharFiltro();

    await tocar('Pontos');
    f = await filtro();
    expect(caixas(f)).toEqual(['Mapa de Áreas', 'Detalhes Áreas', 'Hectares', 'Pontos Referência', 'Linhas (cercas, rios)', 'Cochos', 'Depósitos', 'Localização']);
    expect(f.getByText('Filtros de Áreas')).toBeInTheDocument();
    expect(f.queryByText('Filtros de Categorias de Manejo')).toBeNull();
    await fecharFiltro();

    await tocar('Tarefas');
    f = await filtro();
    expect(caixas(f)).toEqual(['Mapa de Áreas', 'Detalhes Áreas', 'Pontos Referência', 'Linhas (cercas, rios)', 'Localização']);
    expect(f.getByText('Filtros de Tarefas')).toBeInTheDocument();
    for (const campo of ['Setor', 'Situação', 'Prioridade', 'Responsável', 'Prazo']) expect(f.getByRole('combobox', { name: campo }), campo).toBeInTheDocument();
    expect(f.queryByText('Filtros de Áreas')).toBeNull();
    expect(f.queryByText('Filtros de Categorias de Manejo')).toBeNull();
  });

  it('o filtro de lote só vale na aba Lotes', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { filtroCategoria: ['VACA'] });
    await abrir();
    expect(noMapa().lotesNaLista).toBe(1);
    await tocar('Pontos');
    expect(noMapa().lotesNaLista, 'na aba Pontos o filtro de lote não vale').toBe(2);
  });

  it('na aba Tarefas valem os filtros de tarefa (e não a cultura/pastagem das áreas)', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { filtroTarefaPrioridade: ['Baixa'], filtroTipoCultura: ['Agricultura'] });
    await abrir();
    await tocar('Tarefas');
    expect(noMapa().tarefas, 'prioridade Baixa: a tarefa Alta sai').toBe(0);
    expect(screen.getByRole('button', { name: 'Resumo das tarefas' }).textContent).toContain('0tarefas abertas');
  });

  it('sem filtro de tarefa, a cultura escolhida na aba Lotes não esconde a tarefa', async () => {
    salvarFiltrosMapaGeral(ESCOPO, { filtroTarefaPrioridade: ['Alta'], filtroTipoCultura: ['Agricultura'] });
    await abrir();
    await tocar('Tarefas');
    expect(noMapa().tarefas).toBe(1);
  });
});

describe('BARRA-9 — D-PROD-333/359: botão redondo "+" na aba Pontos (novo pasto, ponto ou linha)', () => {
  // D-PROD-361: o "+" abre a escolha Novo pasto · Novo ponto · Nova linha (antes ia direto ao ponto).
  const novoPonto = () => screen.queryByRole('button', { name: 'Novo cadastro no mapa' });

  it('só aparece na aba Pontos e cada opção leva direto ao editor dela', async () => {
    await abrir();
    expect(novoPonto(), 'na aba Lotes não aparece').toBeNull();
    await tocar('Pontos');
    expect(novoPonto()).toBeInTheDocument();
    await act(async () => { fireEvent.click(novoPonto()); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Novo ponto' })); });
    expect(rota.atual).toBe('/mapacadastro?novo=ponto');
  });

  it('sem permissão de cadastrar no mapa, o botão não aparece', async () => {
    sessao.usuario = ANA;
    sessao.permissoes = linha();
    await abrir();
    await tocar('Pontos');
    expect(novoPonto()).toBeNull();
  });

  it('com permissão de novo cadastro no mapa, o botão aparece', async () => {
    sessao.usuario = ANA;
    sessao.permissoes = linha({}, [{ modulo_id: 'mapa', tela_id: 'pec-mapa-cadastro', visualizar: true, novo: true }]);
    await abrir();
    await tocar('Pontos');
    expect(novoPonto()).toBeInTheDocument();
  });
});
