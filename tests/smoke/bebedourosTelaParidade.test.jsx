/**
 * Missão integrada (D-PROD-136), frente M4a — BEB-04, no shell REAL (Layout,
 * com a heurística de clique ativa) e na tela REAL de Bebedouros.
 *
 * Defeito: a heurística do Layout lia o TEXTO do botão — "Lançar" exigia
 * "novo" e "Salvar lançamento" exigia "salvar" —, enquanto o servidor aceita
 * "novo" OU "salvar" (GUARDAS.bebedouroHistorico.criar). Quem tinha só "novo"
 * abria o formulário e era barrado ao salvar; quem tinha só "salvar" nem abria.
 *
 * Contrato: os botões do bebedouro são controlados explicitamente pela regra
 * do servidor (`src/lib/bebedouroPermissions.js`) e ficam fora da heurística.
 *
 * Mocks só nas bordas: API de sessão, rede (`nativeRequest`), cache local do
 * mapa e o `toast`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));
const rede = vi.hoisted(() => ({ chamadas: /** @type {Array<{metodo: string, caminho: string, body: any}>} */ ([]) }));
const toast = vi.hoisted(() => {
  const t = /** @type {any} */ (() => {});
  for (const k of ['success', 'error', 'warning', 'info', 'message', 'dismiss', 'loading', 'custom']) t[k] = () => {};
  return t;
});

const BEBEDOURO = { id: 'beb-1', empresa_id: 'empresa-smoke', nome: 'BEBEDOURO NORTE', tipo: 'Cocho', status: 'Ativo', ativo: true };

vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal()), toast }));
vi.mock('@/apis/_core/nativeHttpClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  nativeRequest: vi.fn(async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    rede.chamadas.push({ metodo, caminho, body: opcoes.body });
    if (metodo === 'GET' && (caminho === '/bebedouros' || caminho.startsWith('/bebedouros?'))) return [BEBEDOURO];
    if (metodo === 'POST' && caminho === '/bebedouros-historico') return { id: 'novo', ...opcoes.body };
    if (metodo === 'GET') return [];
    throw new Error(`rede inesperada no teste: ${metodo} ${caminho}`);
  }),
}));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
  CACHE_KEYS: [],
}));
vi.mock('@/apis/session', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    listPermissoes: vi.fn(async () => sessao.permissoes),
  };
});

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const tela = (modulo_id, tela_id, acoes = {}) => ({
  modulo_id, tela_id, visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes,
});
const comBebedouros = (acoes) => ({
  id: 'p-vaqueiro', user_email: 'vaqueiro', is_admin: false, modulos_permitidos: ['manejo'],
  permissoes_telas: [tela('manejo', 'pec-bebedouros', acoes)], mobile_menu_ids: [],
});

const abrirRegistroNaTela = async () => {
  const { default: Layout } = await import('@/Layout');
  const { default: Bebedouros } = await import('@/pages/Bebedouros');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/bebedouros']}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route path="*" element={<Layout currentPageName="Bebedouros"><Bebedouros /></Layout>} />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
  const celula = (await screen.findAllByText('BEBEDOURO NORTE', {}, { timeout: 4000 }))[0];
  await act(async () => { fireEvent.doubleClick(celula); });
  await screen.findByText(/Local: BEBEDOURO NORTE/);
};
const bloqueio = () => screen.queryByText(/Você não tem permissão para/);
const posts = () => rede.chamadas.filter((c) => c.metodo === 'POST');

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'empresa-smoke');
  sessao.usuario = operador;
  rede.chamadas.length = 0;
  for (const k of ['success', 'error', 'warning', 'info']) toast[k] = vi.fn();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('BEB-04 — tela Bebedouros: "Lançar"/"Salvar lançamento" seguem o servidor (novo OU salvar)', () => {
  it('só "novo": abre o formulário e salva (o servidor aceita "novo")', async () => {
    sessao.permissoes = [comBebedouros({ novo: true })];
    await abrirRegistroNaTela();
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Salvar lançamento/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Lançamento registrado.'));
    expect(bloqueio(), 'a heurística de texto não barra o envio').toBeNull();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toMatchObject({ bebedouro_id: 'beb-1' });
  });

  it('só "salvar": "Lançar" abre (o servidor aceita "salvar") e grava', async () => {
    sessao.permissoes = [comBebedouros({ salvar: true })];
    await abrirRegistroNaTela();
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    expect(bloqueio()).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Salvar lançamento/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('só "visualizar": "Lançar" não aparece (o servidor recusaria)', async () => {
    sessao.permissoes = [comBebedouros({})];
    await abrirRegistroNaTela();
    expect(screen.queryByRole('button', { name: 'Lançar' })).toBeNull();
    expect(posts()).toEqual([]);
  });
});
