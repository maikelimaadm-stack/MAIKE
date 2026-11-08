/**
 * D-PROD-154 (§8.7) — Central de Lançamentos dentro do shell REAL (Layout):
 *  - perfil {visualizar, confirmar} (sem salvar/editar) confirma um rascunho já
 *    salvo: o botão da tela e o do diálogo (portal) seguem a regra exata do
 *    servidor — a heurística de texto do Layout ("Confirmar…" = salvar) não barra;
 *    nenhum PUT é feito (nada mudou);
 *  - o ✓ do cabeçalho do celular carrega `data-permissao-explicita` e quem só
 *    tem "editar" grava o rascunho por ele;
 *  - deep link `/lancamentosfinanceiros`.
 * Mocks só da borda: `fetch` (backend falso) e a sessão (`@/apis/session`).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { criarEstadoLancamentos, rotearLancamentos, semearDocumento } from './fixtures/lancamentosFakeCore.js';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [] }));

vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
  esquecerCacheDoTenant: () => Promise.resolve(),
  CACHE_KEYS: [],
}));
vi.mock('@/apis/session', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => sessao.usuario),
  listPermissoes: vi.fn(async () => sessao.permissoes),
}));

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const permissaoCom = (acoes) => ({
  id: 'p1',
  user_email: 'vaqueiro',
  is_admin: false,
  modulos_permitidos: ['gestao-rural'],
  mobile_menu_ids: [],
  permissoes_telas: [
    { modulo_id: 'gestao-rural', tela_id: 'ges-lancamentos-financeiros', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, confirmar: false, liquidar: false, estornar_liquidacao: false, cancelar: false, ...acoes },
  ],
});
const RASCUNHO = {
  empresa_id: 'emp-1', direcao: 'PAGAR', conteudo: 'SEM_PRODUTOS', condicao: 'AVISTA', parceiro_id: 'pa1', data_emissao: '2026-11-08',
  valor_bruto: '250.00', rateio_modo: 'VALOR', rateios: [{ natureza_id: 'nd3', valor: '250.00' }], parcelas: [{ vencimento: '2026-11-08', valor: '250.00' }],
};

let backend;
let estado;

const renderShell = async () => {
  const { default: Layout } = await import('@/Layout');
  const { default: LancamentosFinanceiros } = await import('@/pages/LancamentosFinanceiros');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/lancamentosfinanceiros']}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route path="*" element={<Layout currentPageName="LancamentosFinanceiros"><LancamentosFinanceiros /></Layout>} />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
};

const abrirRascunho = async (id) => {
  const celula = await screen.findByTestId(`lancamento-numero-${id}`, {}, { timeout: 4000 });
  expect(celula.closest('[data-permissao-explicita]')).toBeTruthy();
  fireEvent.doubleClick(celula);
  return screen.findByTestId('b1-form');
};

beforeEach(async () => {
  cleanup();
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T15:00:00.000Z'));
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  localStorage.setItem('empresa_selecionada_cliente_id', 'fazenda-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.usuario = operador;
  estado = criarEstadoLancamentos();
  backend = instalarBackendFake(async (req) => {
    const r = await rotearLancamentos(estado, req);
    if (r) return r;
    if (req.method === 'GET') return { status: 200, body: [] };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Lançamentos no shell — permissão explícita (§8.7)', () => {
  it('{visualizar, confirmar}: confirma rascunho salvo pela tela e pelo diálogo, sem "Ação bloqueada" e sem PUT', async () => {
    sessao.permissoes = [permissaoCom({ confirmar: true })];
    const doc = semearDocumento(estado, RASCUNHO);
    await renderShell();
    await abrirRascunho(doc.id);
    expect(screen.queryAllByRole('button', { name: 'Editar' })).toHaveLength(0);
    const botao = await screen.findByTestId('botao-confirmar-lancamento');
    await act(async () => {
      fireEvent.click(botao);
    });
    const dialogo = await screen.findByTestId('dialogo-confirmacao');
    expect(dialogo).toHaveAttribute('data-permissao-explicita');
    const definitivo = within(dialogo).getByTestId('botao-confirmar-definitivo');
    expect(definitivo).toHaveTextContent('Confirmar lançamento');
    await act(async () => {
      fireEvent.click(definitivo);
    });
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'POST' && c.path.endsWith('/confirmar'))).toBe(true));
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
    expect(backend.chamadas.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(await screen.findByTestId('status-lancamento')).toHaveTextContent('Confirmado');
  });

  it('{visualizar} só: não há botão de confirmar (o servidor também recusaria)', async () => {
    sessao.permissoes = [permissaoCom({})];
    const doc = semearDocumento(estado, RASCUNHO);
    await renderShell();
    await abrirRascunho(doc.id);
    expect(screen.queryByTestId('botao-confirmar-lancamento')).toBeNull();
  });

  it('✓ do cabeçalho do celular: carrega data-permissao-explicita e quem só tem "editar" grava (PUT com versao)', async () => {
    sessao.permissoes = [permissaoCom({ editar: true })];
    const doc = semearDocumento(estado, RASCUNHO);
    await renderShell();
    await abrirRascunho(doc.id);
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    fireEvent.change(await screen.findByTestId('valor-bruto'), { target: { value: '260' } });
    const check = await vi.waitFor(() => {
      const b = document.querySelector('.mk-mhdr__round--salvar');
      if (!b) throw new Error('sem ✓');
      return b;
    });
    expect(check.hasAttribute('data-permissao-explicita')).toBe(true);
    await act(async () => {
      fireEvent.click(check);
    });
    expect(screen.queryAllByText(/Ação bloqueada/i)).toHaveLength(0);
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'PUT')).toBe(true));
    expect(backend.chamadas.find((c) => c.method === 'PUT').body).toMatchObject({ empresa_id: 'emp-1', versao: 1, valor_bruto: '260.00' });
  });
});
