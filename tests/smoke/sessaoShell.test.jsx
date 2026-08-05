/**
 * Sessão e casca do aplicativo (P1.4).
 *
 * `AuthContext` e `PageNotFound` eram os dois pontos em que a autenticação
 * escapava da fronteira: um montava a requisição de configurações públicas à
 * mão, com `appId` e `Authorization` dentro de um componente React; o outro
 * chamava o `auth.me()` do SDK direto para decidir se mostrava uma nota de
 * administrador. Aqui se prova que os estados observáveis continuam os mesmos.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const RAZOES = Object.freeze({
  AUTH_REQUIRED: 'auth_required',
  USER_NOT_REGISTERED: 'user_not_registered',
  UNKNOWN: 'unknown',
});

const sessionService = {
  verificarAutenticacao: vi.fn(),
  carregarConfiguracoesPublicas: vi.fn(),
  encerrarSessao: vi.fn(),
  irParaLogin: vi.fn(),
  RAZOES_DE_SESSAO_DO_PRODUTO: RAZOES,
};

vi.mock('@/services/sessionService', () => sessionService);

const { AuthProvider, useAuth } = await import('@/lib/AuthContext');
const PageNotFound = (await import('@/lib/PageNotFound')).default;

const comQuery = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionService.verificarAutenticacao.mockResolvedValue({ autenticado: false, usuario: null, precisaAutenticar: false });
  sessionService.carregarConfiguracoesPublicas.mockResolvedValue({ ok: true, value: { id: 'app', public_settings: {} } });
});

/** Sonda que expõe o estado do contexto como texto. */
const Sonda = () => {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="autenticado">{String(auth.isAuthenticated)}</span>
      <span data-testid="erro">{auth.authError?.type ?? 'sem-erro'}</span>
      <span data-testid="settings">{auth.appPublicSettings ? 'ok' : 'vazio'}</span>
      <span data-testid="loading-auth">{String(auth.isLoadingAuth)}</span>
      <span data-testid="loading-settings">{String(auth.isLoadingPublicSettings)}</span>
      <span data-testid="usuario">{auth.user?.email ?? 'ninguem'}</span>
      <button type="button" onClick={() => auth.logout()}>sair</button>
      <button type="button" onClick={() => auth.logout(false)}>sair sem redirecionar</button>
      <button type="button" onClick={() => auth.navigateToLogin()}>entrar</button>
    </div>
  );
};

const montarAuth = async () => {
  const resultado = comQuery(
    <AuthProvider>
      <Sonda />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('loading-settings')).toHaveTextContent('false'));
  return resultado;
};

describe('AUTH — estados do AuthContext', () => {
  it('AUTH1 — as configurações públicas vêm do service, não de um fetch montado na tela', async () => {
    await montarAuth();
    expect(sessionService.carregarConfiguracoesPublicas).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings')).toHaveTextContent('ok');
  });

  it('AUTH2 — auth_required chega como razão estável, não como erro de provider', async () => {
    sessionService.carregarConfiguracoesPublicas.mockResolvedValue({ ok: false, reason: RAZOES.AUTH_REQUIRED });
    await montarAuth();
    expect(screen.getByTestId('erro')).toHaveTextContent('auth_required');
    expect(screen.getByTestId('autenticado')).toHaveTextContent('false');
    expect(screen.getByTestId('loading-settings')).toHaveTextContent('false');
  });

  it('AUTH3 — user_not_registered é preservado como estado próprio', async () => {
    sessionService.carregarConfiguracoesPublicas.mockResolvedValue({ ok: false, reason: RAZOES.USER_NOT_REGISTERED });
    await montarAuth();
    expect(screen.getByTestId('erro')).toHaveTextContent('user_not_registered');
  });

  it('AUTH4 — razão desconhecida vira unknown e encerra os loadings', async () => {
    sessionService.carregarConfiguracoesPublicas.mockResolvedValue({ ok: false, reason: RAZOES.UNKNOWN });
    await montarAuth();
    expect(screen.getByTestId('erro')).toHaveTextContent('unknown');
    expect(screen.getByTestId('loading-auth')).toHaveTextContent('false');
  });

  /**
   * SE9 — a prova mecânica de que o formato cru do provider não atravessa.
   *
   * Não basta o teste de comportamento passar: `AuthContext` passava antes
   * inspecionando `status`, `data.extra_data.reason` e `message`. O que se fixa
   * aqui é a **ausência** dessas leituras no arquivo.
   */
  it('AUTH8/SE9 — AuthContext não lê status, data, extra_data nem mensagem do provider', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(process.cwd(), 'src/lib/AuthContext.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const proibido of ['.status', '.statusCode', '.response', 'extra_data', '.data?.', 'appError', 'error.message']) {
      expect(fonte, proibido).not.toContain(proibido);
    }
  });

  it('AUTH5 — logout com e sem redirecionamento chega ao service', async () => {
    await montarAuth();

    await act(async () => { screen.getByText('sair').click(); });
    expect(sessionService.encerrarSessao).toHaveBeenLastCalledWith(window.location.href);

    await act(async () => { screen.getByText('sair sem redirecionar').click(); });
    expect(sessionService.encerrarSessao).toHaveBeenLastCalledWith(undefined);

    expect(screen.getByTestId('autenticado')).toHaveTextContent('false');
    expect(screen.getByTestId('usuario')).toHaveTextContent('ninguem');
  });

  it('AUTH6 — ir para o login passa pelo service', async () => {
    await montarAuth();
    await act(async () => { screen.getByText('entrar').click(); });
    expect(sessionService.irParaLogin).toHaveBeenCalledWith(window.location.href);
  });

  it('AUTH7 — o contexto exige o provider', () => {
    const Solto = () => {
      useAuth();
      return null;
    };
    // O erro é de programação, não de runtime do usuário: precisa estourar.
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Solto />)).toThrow(/useAuth/);
    console_error.mockRestore();
  });
});

describe('P404 — página não encontrada', () => {
  const montar404 = () =>
    comQuery(
      <MemoryRouter initialEntries={['/RotaInexistente']}>
        <PageNotFound />
      </MemoryRouter>
    );

  it('P404-1 — texto em português e sem menção genérica a IA', async () => {
    montar404();
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument();
    expect(screen.getByText(/RotaInexistente/)).toBeInTheDocument();
    expect(screen.queryByText(/Page Not Found/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bAI\b|Go Home/);
  });

  it('P404-2 — o botão leva ao Mapa Geral', async () => {
    montar404();
    expect(await screen.findByRole('button', { name: /Mapa Geral/i })).toBeInTheDocument();
  });

  it('P404-3 — a checagem de sessão passa pelo service', async () => {
    montar404();
    await waitFor(() => expect(sessionService.verificarAutenticacao).toHaveBeenCalled());
  });

  it('P404-4 — nota de administrador só aparece para admin autenticado', async () => {
    sessionService.verificarAutenticacao.mockResolvedValue({
      autenticado: true, usuario: { role: 'admin' }, precisaAutenticar: false,
    });
    montar404();
    expect(await screen.findByText('Nota para o administrador')).toBeInTheDocument();
  });

  it('P404-5 — usuário comum não vê a nota', async () => {
    sessionService.verificarAutenticacao.mockResolvedValue({
      autenticado: true, usuario: { role: 'user' }, precisaAutenticar: false,
    });
    montar404();
    await screen.findByText('Página não encontrada');
    expect(screen.queryByText('Nota para o administrador')).toBeNull();
  });
});
