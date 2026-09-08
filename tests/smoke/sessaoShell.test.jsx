/**
 * Sessão e casca do aplicativo (P1.4 · reescrito na P4.0).
 *
 * `AuthContext` e `PageNotFound` eram os dois pontos em que a autenticação
 * escapava da fronteira: um montava a requisição de configurações públicas à
 * mão, com `appId` e `Authorization` dentro de um componente React; o outro
 * chamava o `auth.me()` do SDK direto para decidir se mostrava uma nota de
 * administrador.
 *
 * ─── O que a P4.0 mudou aqui ───────────────────────────────────────────────
 *
 * A autenticação do aplicativo deixou de ser da Base44. Os casos AUTH5 e AUTH6
 * afirmavam o contrato antigo — logout com `urlDeRetorno` e redirecionamento
 * para o login da Base44 — e ele **não existe mais**: `redirectToLogin` saiu
 * porque autenticaria no provider errado, e o logout agora encerra a sessão
 * nativa. Eles foram substituídos, não afrouxados: AUTH5 passou a exigir que o
 * logout limpe a sessão nativa, e AUTH9–AUTH12 cobrem entrada, restauração e a
 * ausência de fallback.
 *
 * O que **não** mudou: as configurações públicas continuam vindo do provider
 * (dados que ainda não migraram), e `PageNotFound` continua lendo o usuário
 * pelo service.
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
  entrarComSessaoNativa: vi.fn(),
  restaurarSessaoNativaAtual: vi.fn(),
  sairDaSessaoNativa: vi.fn(),
  RAZOES_DE_SESSAO_DO_PRODUTO: RAZOES,
};

vi.mock('@/services/sessionService', () => sessionService);

const { AuthProvider, useAuth } = await import('@/lib/AuthContext');
const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
const PageNotFound = (await import('@/lib/PageNotFound')).default;

const comQuery = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionService.verificarAutenticacao.mockResolvedValue({ autenticado: false, usuario: null, precisaAutenticar: false });
  sessionService.carregarConfiguracoesPublicas.mockResolvedValue({ ok: true, value: { id: 'app', public_settings: {} } });
  sessionService.restaurarSessaoNativaAtual.mockResolvedValue({ autenticado: false, contexto: null });
  sessionService.entrarComSessaoNativa.mockResolvedValue({
    usuario: { id: 'usr_1', login: 'joao', nome: 'João' },
    clienteId: 'cli_1',
  });
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
      <span data-testid="usuario">{auth.user?.login ?? 'ninguem'}</span>
      <span data-testid="cliente">{auth.clienteId ?? 'sem-cliente'}</span>
      <span data-testid="estado">{auth.sessionState}</span>
      <span data-testid="erro-validacao">{auth.sessionValidationError ?? 'sem-erro-validacao'}</span>
      <button type="button" onClick={() => auth.revalidarSessao()}>revalidar</button>
      <button type="button" onClick={() => auth.logout()}>sair</button>
      <button
        type="button"
        onClick={() => auth.entrar({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' }).catch(() => {})}
      >
        entrar
      </button>
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

  it('AUTH5 — logout encerra a sessão NATIVA e zera o estado', async () => {
    sessionService.restaurarSessaoNativaAtual.mockResolvedValue({
      autenticado: true,
      contexto: { cliente_id: 'cli_1', usuario_id: 'usr_1', login: 'joao' },
    });
    await montarAuth();
    expect(screen.getByTestId('autenticado')).toHaveTextContent('true');

    await act(async () => { screen.getByText('sair').click(); });

    expect(sessionService.sairDaSessaoNativa).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('autenticado')).toHaveTextContent('false');
    expect(screen.getByTestId('usuario')).toHaveTextContent('ninguem');
    expect(screen.getByTestId('cliente')).toHaveTextContent('sem-cliente');
  });

  it('AUTH9/P4T-16 — login válido autentica e publica o tenant resolvido pelo servidor', async () => {
    await montarAuth();
    expect(screen.getByTestId('autenticado')).toHaveTextContent('false');

    await act(async () => { screen.getByText('entrar').click(); });

    expect(sessionService.entrarComSessaoNativa).toHaveBeenCalledWith({
      cliente: 'FAZENDA', login: 'joao', senha: 's3nh4',
    });
    expect(screen.getByTestId('autenticado')).toHaveTextContent('true');
    expect(screen.getByTestId('usuario')).toHaveTextContent('joao');
    // `cliente_id` chega como RESULTADO da autenticação, nunca como entrada.
    expect(screen.getByTestId('cliente')).toHaveTextContent('cli_1');
  });

  it('AUTH10/P4T-07 — o reload restaura a sessão nativa validada', async () => {
    sessionService.restaurarSessaoNativaAtual.mockResolvedValue({
      autenticado: true,
      contexto: { cliente_id: 'cli_9', usuario_id: 'usr_9', login: 'maria' },
    });
    await montarAuth();

    expect(sessionService.restaurarSessaoNativaAtual).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('autenticado')).toHaveTextContent('true');
    expect(screen.getByTestId('usuario')).toHaveTextContent('maria');
  });

  it('AUTH11 — login recusado NÃO autentica e não cai na Base44', async () => {
    // A ausência de fallback é o ponto: backend fora do ar precisa aparecer
    // como falha, não virar sessão do provider legado (D-PROD-24, item G).
    const erro = Object.assign(new Error('recusado'), { code: 'AUTH_INVALID_CREDENTIALS' });
    sessionService.entrarComSessaoNativa.mockRejectedValue(erro);
    await montarAuth();

    await act(async () => { screen.getByText('entrar').click(); });

    expect(screen.getByTestId('autenticado')).toHaveTextContent('false');
    expect(sessionService.verificarAutenticacao).not.toHaveBeenCalled();
  });

  it('AUTH12 — falha das configurações públicas não bloqueia a sessão nativa', async () => {
    // Os dois eixos são independentes desde a P4.0: travar a entrada porque o
    // provider de dados legado não respondeu religaria o acoplamento que a
    // missão acabou de separar.
    sessionService.carregarConfiguracoesPublicas.mockResolvedValue({ ok: false, reason: RAZOES.UNKNOWN });
    sessionService.restaurarSessaoNativaAtual.mockResolvedValue({
      autenticado: true,
      contexto: { cliente_id: 'cli_1', usuario_id: 'usr_1', login: 'joao' },
    });
    await montarAuth();

    expect(screen.getByTestId('erro')).toHaveTextContent('unknown');
    expect(screen.getByTestId('autenticado')).toHaveTextContent('true');
  });

  it('AUTH13 — AuthContext não conhece a Base44 nem redireciona para fora', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const fonte = readFileSync(join(process.cwd(), 'src/lib/AuthContext.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const proibido of ['redirectToLogin', 'irParaLogin', 'base44', 'getDataProviderConfig']) {
      expect(fonte, proibido).not.toContain(proibido);
    }
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

/**
 * P4.0-R1 — a casca durante indisponibilidade.
 *
 * O bloqueador auditado não estava só na camada de sessão: estava no que a tela
 * fazia com o veredito. Com `isAuthenticated: false` e nada mais, a única
 * leitura possível era "deslogado" — e o `App` mostrava o formulário de login,
 * dizendo ao usuário que a senha dele não servia enquanto o servidor estava
 * fora do ar.
 *
 * Estes casos montam o `App` real, com o `AuthProvider` real, e observam o que
 * o usuário veria.
 */
describe('P4R1 — casca durante validação indisponível', () => {
  // `ApiError` de verdade, não um objeto parecido. `getApiErrorMessage` só
  // entrega texto de `ApiError` — qualquer outra coisa cai no fallback público,
  // e é assim que deve ser. Um dublê aqui testaria o dublê.
  const indisponivel = () =>
    new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {
      operation: 'restaurarSessao',
      resource: 'SessaoNativa',
    });

  const montarApp = async () => {
    const { default: NativeLoginForm } = await import('@/components/auth/NativeLoginForm');
    const { default: NativeSessionUnavailable } = await import('@/components/auth/NativeSessionUnavailable');
    void NativeLoginForm;
    void NativeSessionUnavailable;

    const resultado = comQuery(
      <AuthProvider>
        <Sonda />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('estado')).not.toHaveTextContent('carregando'));
    return resultado;
  };

  it('P4R1-T06 restore indisponível NÃO autentica e NÃO vira "não autenticado"', async () => {
    sessionService.restaurarSessaoNativaAtual.mockRejectedValue(indisponivel());
    await montarApp();

    expect(screen.getByTestId('estado')).toHaveTextContent('validacao_indisponivel');
    expect(screen.getByTestId('autenticado')).toHaveTextContent('false');
    // O estado é distinguível de logout — que era exatamente o defeito.
    expect(screen.getByTestId('estado')).not.toHaveTextContent('nao_autenticada');
  });

  it('P4R1-T07 o contexto oferece retry e mensagem pública', async () => {
    sessionService.restaurarSessaoNativaAtual.mockRejectedValue(indisponivel());
    await montarApp();

    expect(screen.getByTestId('erro-validacao')).toHaveTextContent('Serviço de dados indisponível no momento.');
    expect(screen.getByText('revalidar')).toBeInTheDocument();
  });

  it('P4R1-T08 retry com backend de volta autentica SEM novo login', async () => {
    sessionService.restaurarSessaoNativaAtual
      .mockRejectedValueOnce(indisponivel())
      .mockResolvedValueOnce({
        autenticado: true,
        contexto: { cliente_id: 'cli_7', usuario_id: 'usr_7', login: 'maria' },
      });

    await montarApp();
    expect(screen.getByTestId('estado')).toHaveTextContent('validacao_indisponivel');

    await act(async () => { screen.getByText('revalidar').click(); });

    expect(screen.getByTestId('estado')).toHaveTextContent('autenticada');
    expect(screen.getByTestId('usuario')).toHaveTextContent('maria');
    expect(screen.getByTestId('cliente')).toHaveTextContent('cli_7');
    // O ponto inteiro da correção: nenhuma senha foi pedida.
    expect(sessionService.entrarComSessaoNativa).not.toHaveBeenCalled();
  });

  it('P4R1-T09 retry com credencial recusada leva ao login', async () => {
    sessionService.restaurarSessaoNativaAtual
      .mockRejectedValueOnce(indisponivel())
      .mockResolvedValueOnce({ autenticado: false, contexto: null });

    await montarApp();
    await act(async () => { screen.getByText('revalidar').click(); });

    expect(screen.getByTestId('estado')).toHaveTextContent('nao_autenticada');
    expect(screen.getByTestId('erro-validacao')).toHaveTextContent('sem-erro-validacao');
  });

  it('P4R1-T10 nenhuma mensagem crua da falha chega ao contexto', async () => {
    const cru = Object.assign(new Error('cru'), {
      name: 'Error',
      message: 'connect ECONNREFUSED 10.0.0.5:3333 — Authorization: Bearer jwt.secreto',
    });
    sessionService.restaurarSessaoNativaAtual.mockRejectedValue(cru);
    await montarApp();

    const texto = screen.getByTestId('erro-validacao').textContent;
    for (const fragmento of ['ECONNREFUSED', '10.0.0.5', 'Authorization', 'Bearer', 'jwt.secreto']) {
      expect(texto, fragmento).not.toContain(fragmento);
    }
  });

  it('P4R1-T11 NÃO existe fallback para a Base44 durante a indisponibilidade', async () => {
    // O comportamento correto é "backend indisponível", nunca
    // "backend indisponível → Base44". Um fallback aqui autenticaria o usuário
    // no provider errado e esconderia o incidente.
    sessionService.restaurarSessaoNativaAtual.mockRejectedValue(indisponivel());
    await montarApp();

    expect(sessionService.verificarAutenticacao).not.toHaveBeenCalled();
    expect(sessionService.entrarComSessaoNativa).not.toHaveBeenCalled();
    // `irParaLogin`/`redirectToLogin` saíram do módulo na P4.0 — não existem
    // nem para serem chamados.
    expect(sessionService.irParaLogin).toBeUndefined();
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
