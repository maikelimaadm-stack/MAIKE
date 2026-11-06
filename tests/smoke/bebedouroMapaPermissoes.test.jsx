/**
 * Missão integrada (D-PROD-137), frente M4a — bebedouro no Mapa Geral, com o
 * MapaGeral REAL montado (o clique no ponto passa pelo handler real e abre o
 * DetalhesBebedouro, a timeline e o formulário reais).
 *
 *  BEB-01  "Lançar" e "Excluir" apareciam para QUALQUER operador do mapa; o
 *          servidor respondia 403 e a interface falhava calada (o formulário
 *          ficava aberto sem mensagem; o Excluir ficava travado com uma
 *          rejeição não tratada). Contrato: o botão só aparece quando a
 *          permissão efetiva permite exatamente o que o servidor exige
 *          (GUARDAS.bebedouroHistorico); 403/erro vira mensagem clara.
 *  BEB-03  ponto BEBEDOURO sem cadastro: "Lançar" gravava histórico órfão e
 *          dizia "Lançamento registrado.". Contrato: sem cadastro não há
 *          "Lançar" (a tela explica onde cadastrar) e nada é enviado.
 *
 * Mocks só nas bordas: rede (`nativeRequest`), sessão, motor do mapa (WebGL /
 * MapLibre, que o jsdom não roda) e o `toast` (para ler a mensagem mostrada).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: null }));
const rede = vi.hoisted(() => ({
  chamadas: /** @type {Array<{metodo: string, caminho: string, body: any}>} */ ([]),
  bebedouros: /** @type {any[]} */ ([]),
  historico: /** @type {any[]} */ ([]),
  post: /** @type {(body: any) => any} */ ((body) => ({ id: 'novo', ...body })),
  del: /** @type {(caminho: string) => any} */ (() => null),
}));
const mapa = vi.hoisted(() => ({ cliquePonto: /** @type {null | ((p: any) => Promise<void>)} */ (null) }));
const toast = vi.hoisted(() => {
  const t = /** @type {any} */ (() => {});
  for (const k of ['success', 'error', 'warning', 'info', 'message', 'dismiss', 'loading', 'custom']) t[k] = () => {};
  return t;
});

vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal()), toast }));
vi.mock('@/lib/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ clienteId: 'tenant-1', isAuthenticated: true, logout: vi.fn() }),
}));
vi.mock('@/services/sessionService', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    carregarPermissaoEfetiva: vi.fn(async (u) => orig.permissaoEfetiva(u, sessao.permissoes)),
  };
});
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
}));
vi.mock('@/apis/_core/nativeHttpClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  nativeRequest: vi.fn(async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    rede.chamadas.push({ metodo, caminho, body: opcoes.body });
    if (metodo === 'GET' && caminho.startsWith('/bebedouros-historico')) return rede.historico;
    if (metodo === 'GET' && (caminho === '/bebedouros' || caminho.startsWith('/bebedouros?'))) return rede.bebedouros;
    if (metodo === 'POST' && caminho === '/bebedouros-historico') return rede.post(opcoes.body);
    if (metodo === 'DELETE' && caminho.startsWith('/bebedouros-historico/')) return rede.del(caminho);
    if (metodo === 'GET') return [];
    throw new Error(`rede inesperada no teste: ${metodo} ${caminho}`);
  }),
}));
// Motor do mapa: o jsdom não tem WebGL. Um mapa falso dispara `load` e o
// renderizador guarda o handler REAL de clique em ponto de referência.
vi.mock('@/lib/maplibre/falhaWebGL', async (importOriginal) => ({ ...(await importOriginal()), navegadorTemWebGL: () => true }));
vi.mock('@/lib/maplibre/lifecycle.js', async (importOriginal) => {
  const real = await importOriginal();
  const mapaFalso = () => new Proxy({}, {
    get: (_alvo, prop) => {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (prop === 'on') return (evento, cb) => { if (evento === 'load') setTimeout(cb, 0); };
      if (prop === 'getCenter') return () => ({ lat: -15, lng: -47 });
      if (prop === 'getZoom') return () => 15;
      return () => undefined;
    },
  });
  return { ...real, createEditorMap: () => ({ map: mapaFalso(), getCancelled: () => false, dispose: () => {} }) };
});
vi.mock('@/components/mapa/useMapRenderer', () => {
  const nada = () => {};
  const renderer = {
    syncAreas: nada, syncLabels: nada, syncLinhas: nada, syncPontosSuplementacao: nada, syncLotes: nada,
    syncTarefas: nada, syncUserLocation: nada, clearAll: nada, ensureLayers: nada, hitArea: () => null, setEstiloPasto: nada,
    syncPontos: (_pontos, _visivel, _icones, onClick) => { mapa.cliquePonto = onClick; },
  };
  return { default: () => renderer };
});
vi.mock('@/components/mapa/useBasemap', () => ({
  default: () => ({ basemapId: 'satelite', status: 'ok', atribuicao: '', mensagem: '', setBasemap: () => {}, retry: () => {} }),
}));

const EMPRESA = 'emp-1';
const PONTO = { id: 'pr-1', tipo: 'BEBEDOURO', nome: 'BEBEDOURO NORTE', numero_ponto: '7', empresa_id: EMPRESA, coordenadas: { lat: -15.1, lng: -47.1 } };
const BEBEDOURO = { id: 'beb-1', empresa_id: EMPRESA, nome: 'BEBEDOURO NORTE', ponto_referencia_id: 'pr-1', tipo: 'Cocho', status: 'Ativo', ativo: true };
const HISTORICO = [
  { id: 'h2', empresa_id: EMPRESA, bebedouro_id: 'beb-1', tipo_lancamento: 'Limpeza', data_lancamento: '2027-06-10', status: 'Concluído' },
  { id: 'h1', empresa_id: EMPRESA, bebedouro_id: 'beb-1', tipo_lancamento: 'Inspeção', data_lancamento: '2027-06-01', status: 'Concluído' },
];

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', cliente_id: 'tenant-1', administrador_fazenda: false };
const dono = { ...operador, id: 'u-dono', login: 'dono', email: 'dono', administrador_fazenda: true };
const tela = (modulo_id, tela_id, acoes = {}) => ({
  modulo_id, tela_id, visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes,
});
const linhaDe = (login, { modulos = ['mapa'], telas = [], mapaGeral = { mover_lotes: true } } = {}) => ({
  user_email: login, is_admin: false, modulos_permitidos: modulos,
  permissoes_telas: [tela('mapa', 'pec-mapa-geral'), ...telas], mapa_geral_permissoes: mapaGeral,
});

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const abrirPontoNoMapa = async () => {
  const { default: MapaGeral } = await import('@/pages/MapaGeral');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><MapaGeral /></QueryClientProvider></MemoryRouter>);
  });
  await assentar();
  await waitFor(() => expect(mapa.cliquePonto, 'mapa pronto e pontos sincronizados').toBeTypeOf('function'));
  await act(async () => { await mapa.cliquePonto(PONTO); });
  await assentar();
  expect(await screen.findByText(/Local: BEBEDOURO NORTE/)).toBeTruthy();
};
const botao = (nome) => screen.queryByRole('button', { name: nome });
const posts = () => rede.chamadas.filter((c) => c.metodo === 'POST');
const deletes = () => rede.chamadas.filter((c) => c.metodo === 'DELETE');
const negado = () => { throw new ApiError(API_ERROR_CODES.ACAO_NAO_PERMITIDA, { operation: 'teste', resource: 'BebedouroHistorico' }); };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', EMPRESA);
  sessao.usuario = operador;
  sessao.permissoes = null;
  rede.chamadas.length = 0;
  rede.bebedouros = [BEBEDOURO];
  rede.historico = HISTORICO;
  rede.post = (body) => ({ id: 'novo', ...body });
  rede.del = () => null;
  mapa.cliquePonto = null;
  for (const k of ['success', 'error', 'warning', 'info']) toast[k] = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(cleanup);

describe('BEB-01 — botões do bebedouro no Mapa Geral seguem a regra do servidor', () => {
  it('operador só do mapa (ver + mover lotes): sem "Lançar" e, no histórico, sem "Excluir"', async () => {
    sessao.permissoes = linhaDe('vaqueiro');
    await abrirPontoNoMapa();
    expect(botao('Lançar'), 'servidor exige Bebedouros novo/salvar ou Mapa Geral salvar').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(await screen.findByText(/Histórico do Bebedouro \(2\)/)).toBeTruthy();
    expect(botao('Excluir'), 'servidor exige Bebedouros excluir').toBeNull();
    expect(posts()).toEqual([]);
    expect(deletes()).toEqual([]);
  });

  it('Mapa Geral "salvar": "Lançar" aparece; se o servidor negar (403), a mensagem aparece e nada de sucesso', async () => {
    sessao.permissoes = linhaDe('vaqueiro', { telas: [], mapaGeral: { mover_lotes: true } });
    sessao.permissoes.permissoes_telas = [tela('mapa', 'pec-mapa-geral', { salvar: true })];
    rede.post = negado;
    await abrirPontoNoMapa();
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Salvar lançamento/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/não tem permissão/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Salvar lançamento/ }), 'o formulário continua aberto para o usuário decidir').not.toBeDisabled();
    expect(posts()).toHaveLength(1);
  });

  it('Bebedouros "excluir" não dá "Lançar" (são concessões diferentes no servidor)', async () => {
    sessao.permissoes = linhaDe('vaqueiro', { modulos: ['mapa', 'manejo'], telas: [tela('manejo', 'pec-bebedouros', { excluir: true })] });
    await abrirPontoNoMapa();
    expect(botao('Lançar')).toBeNull();
  });

  it('Bebedouros "excluir": "Excluir" aparece; 403 do servidor vira mensagem e o botão volta a funcionar', async () => {
    sessao.permissoes = linhaDe('vaqueiro', { modulos: ['mapa', 'manejo'], telas: [tela('manejo', 'pec-bebedouros', { excluir: true })] });
    rede.del = negado;
    await abrirPontoNoMapa();
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    const excluir = await screen.findAllByRole('button', { name: 'Excluir' });
    await act(async () => { fireEvent.click(excluir[0]); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/não tem permissão/i);
    expect(deletes().map((d) => d.caminho)).toEqual(['/bebedouros-historico/h2']);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Excluir' })[0]).not.toBeDisabled());
  });

  it('BEB-02 na tela: o servidor recusa (409, entrou um lançamento mais novo) → mensagem clara, nada de silêncio', async () => {
    sessao.permissoes = linhaDe('vaqueiro', { modulos: ['mapa', 'manejo'], telas: [tela('manejo', 'pec-bebedouros', { excluir: true })] });
    rede.del = () => { throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, { operation: 'deleteHistorico', resource: 'Bebedouro', cause: { code: 'BEBEDOUROHISTORICO_SOMENTE_ULTIMO' } }); };
    await abrirPontoNoMapa();
    fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
    const excluir = await screen.findAllByRole('button', { name: 'Excluir' });
    await act(async () => { fireEvent.click(excluir[0]); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toMatch(/só o último pode ser excluído/);
  });

  it('controle positivo — administrador da fazenda: lança (com bebedouro_id) e exclui o mais recente, com sucesso real', async () => {
    sessao.usuario = dono;
    await abrirPontoNoMapa();
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Salvar lançamento/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Lançamento registrado.'));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toMatchObject({ empresa_id: EMPRESA, bebedouro_id: 'beb-1' });
    expect(toast.error).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Histórico' }));
    const excluir = await screen.findAllByRole('button', { name: 'Excluir' });
    await act(async () => { fireEvent.click(excluir[0]); });
    await waitFor(() => expect(deletes().map((d) => d.caminho)).toEqual(['/bebedouros-historico/h2']));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('BEB-03 — ponto BEBEDOURO sem cadastro não grava histórico órfão', () => {
  it('administrador: sem cadastro não há "Lançar"; a tela explica e nada é enviado', async () => {
    sessao.usuario = dono;
    rede.bebedouros = [];
    rede.historico = [];
    await abrirPontoNoMapa();
    expect(botao('Lançar')).toBeNull();
    expect(screen.getByText(/sem cadastro de bebedouro/i)).toBeTruthy();
    expect(posts()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
