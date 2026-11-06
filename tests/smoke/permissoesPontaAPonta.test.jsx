/**
 * Permissões de ponta a ponta no navegador (fail-closed).
 *
 * Antes: conta sem registro (ou falha de leitura) recebia `is_admin: true`
 * (`permissaoMinimaNativa`), tela sem linha era liberada, o Mapa Geral olhava o
 * módulo errado (`pecuaria`) e `role === 'admin'` (nunca preenchido no login
 * nativo), e nada era relido depois do primeiro carregamento.
 *
 * Aqui se prova, no shell real (Layout), com a API de sessão substituída:
 *  - menu e URL colada seguem a permissão efetiva;
 *  - sem registro → nenhuma tela, com aviso compreensível (sem laço de redirect);
 *  - administrador da fazenda (papel do servidor) vê tudo, mesmo sem linha;
 *  - mudança salva chega SEM logout (evento de gravação e foco);
 *  - cache offline é por login e nunca amplia nada; falha não vira privilégio;
 *  - o 403 do servidor vira mensagem compreensível.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { readFileSync } from 'node:fs';

const sessao = vi.hoisted(() => ({ usuario: null, permissoes: [], falhar: false }));

vi.mock('@/api/base44Client', async () => {
  const { createBase44Stub } = await import('./base44Stub.js');
  return { base44: createBase44Stub() };
});
vi.mock('@/apis/_core/nativeHttpClient.js', () => ({
  nativeRequest: vi.fn(async () => []),
}));
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: () => Promise.resolve([]),
  refreshMapaCacheEntry: () => Promise.resolve([]),
  updateMapaCachedData: () => Promise.resolve([]),
  warmMapaCache: () => Promise.resolve(),
  // D-PROD-137 (GET-06): o logout (`sairDaSessaoNativa`) agora também apaga o
  // cache offline do mapa que é do tenant; aqui o cache é substituído.
  esquecerCacheDoTenant: () => Promise.resolve(),
  CACHE_KEYS: [],
}));
vi.mock('@/apis/session', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getCurrentUser: vi.fn(async () => sessao.usuario),
    listPermissoes: vi.fn(async () => {
      if (sessao.falhar) throw new Error('rede');
      return sessao.permissoes;
    }),
  };
});

import { carregarPermissaoEfetiva, permissaoEfetiva, avisarPermissoesAtualizadas, sairDaSessaoNativa } from '@/services/sessionService';
import { canAccessModule, canAccessPage, canPerformAction } from '@/lib/permissions';
import { MAPA_GERAL_ACESSO_TOTAL, MAPA_GERAL_ACOES_GRAVADORAS, normalizeMapaGeralPermissions } from '@/lib/mapaGeralPermissions';
import { ApiError, API_ERROR_CODES, getApiErrorMessage } from '@/apis/_core/ApiError';

const operador = { id: 'u-op', login: 'vaqueiro', email: 'vaqueiro', nome: 'Vaqueiro', administrador_fazenda: false, cliente_id: 'fazenda-1' };
const admin = { id: 'u-adm', login: 'dono', email: 'dono', nome: 'Dono', administrador_fazenda: true, cliente_id: 'fazenda-1' };

const tela = (modulo_id, tela_id, acoes = {}) => ({
  modulo_id, tela_id, visualizar: false, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes,
});

/** Configuração real do proprietário: só o Mapa Geral, só visualizar. */
const soVerMapa = (login = 'vaqueiro') => ({
  id: `p-${login}`,
  user_email: login,
  is_admin: false,
  modulos_permitidos: ['mapa'],
  permissoes_telas: [tela('mapa', 'pec-mapa-geral', { visualizar: true }), tela('mapa', 'pec-mapa-cadastro')],
  mobile_menu_ids: ['pec-mapa-geral'],
  mapa_geral_permissoes: { mover_lotes: false },
});

const PaginaFalsa = ({ nome }) => <div data-testid={`pagina-${nome}`}>{nome}</div>;

const renderShell = async (rota, currentPageName) => {
  const { default: Layout } = await import('@/Layout');
  const { AuthProvider } = await import('@/lib/AuthContext');
  const { BootSplashProvider } = await import('@/lib/bootSplashContext');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[rota]}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <BootSplashProvider>
              <Routes>
                <Route
                  path="*"
                  element={
                    <Layout currentPageName={currentPageName}>
                      <Routes>
                        <Route path="/mapageral" element={<PaginaFalsa nome="mapa" />} />
                        <Route path="/mapacadastro" element={<PaginaFalsa nome="cadastro" />} />
                        <Route path="/cadastrolotes" element={<PaginaFalsa nome="lotes" />} />
                        <Route path="*" element={<PaginaFalsa nome="outra" />} />
                      </Routes>
                    </Layout>
                  }
                />
              </Routes>
            </BootSplashProvider>
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  });
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('empresa_selecionada_id', 'empresa-smoke');
  sessao.usuario = operador;
  sessao.permissoes = [];
  sessao.falhar = false;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('PERM-F1 — regras puras fail-closed (iguais às do servidor)', () => {
  it('sem registro, módulo ausente, tela sem linha ou visualizar ≠ true → negado', () => {
    expect(canAccessModule(null, 'mapa')).toBe(false);
    expect(canAccessPage(null, 'pec-mapa-geral', 'mapa')).toBe(false);
    expect(canPerformAction(null, 'pec-lotes', 'manejo', 'novo')).toBe(false);
    const r = soVerMapa();
    expect(canAccessPage(r, 'pec-mapa-geral', 'mapa')).toBe(true);
    expect(canAccessPage(r, 'pec-mapa-cadastro', 'mapa')).toBe(false);
    expect(canAccessPage(r, 'pec-lotes', 'manejo')).toBe(false);
    expect(canAccessPage({ ...r, modulos_permitidos: ['mapa', 'manejo'] }, 'pec-lotes', 'manejo')).toBe(false);
    expect(canPerformAction(r, 'pec-mapa-geral', 'mapa', 'salvar')).toBe(false);
    expect(canPerformAction({ ...r, permissoes_telas: [{ tela_id: 'pec-mapa-geral', visualizar: 'true', salvar: 1 }] }, 'pec-mapa-geral', 'mapa', 'visualizar')).toBe(false);
  });

  it('linha com is_admin = concessão explícita de todas as telas', () => {
    expect(canPerformAction({ user_email: 'x', is_admin: true }, 'pec-lotes', 'manejo', 'excluir')).toBe(true);
  });

  it('permissão efetiva: papel real do servidor; linha de OUTRO login nunca vale', () => {
    expect(permissaoEfetiva(admin, null)?.is_admin).toBe(true);
    expect(permissaoEfetiva(operador, null)).toBeNull();
    expect(permissaoEfetiva(operador, soVerMapa('outro'))).toBeNull();
    expect(permissaoEfetiva({ ...operador, role: 'admin', is_admin: true }, null)).toBeNull();
    expect(permissaoEfetiva(operador, soVerMapa())?.is_admin).toBe(false);
  });
});

describe('PERM-F2 — menu e URL colada no shell', () => {
  it('operador sem registro: nenhuma tela, aviso compreensível, sem conteúdo da página', async () => {
    await renderShell('/mapageral', 'MapaGeral');
    const aviso = await screen.findByTestId('acesso-sem-tela');
    expect(aviso.textContent).toMatch(/ainda não tem telas liberadas/i);
    expect(screen.queryByTestId('pagina-mapa')).toBeNull();
  });

  it('URL colada para tela negada não monta a página', async () => {
    sessao.permissoes = [soVerMapa()];
    await renderShell('/cadastrolotes', 'CadastroLotes');
    await screen.findByTestId('acesso-sem-tela');
    expect(screen.queryByTestId('pagina-lotes')).toBeNull();
  });

  it('tela concedida monta; o menu não oferece Cadastro de Lotes', async () => {
    sessao.permissoes = [soVerMapa()];
    await renderShell('/mapageral', 'MapaGeral');
    expect(await screen.findByTestId('pagina-mapa')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /cadastro de lotes/i })).toBeNull();
  });

  it('administrador da fazenda sem linha de Permissão vê as telas', async () => {
    sessao.usuario = admin;
    await renderShell('/cadastrolotes', 'CadastroLotes');
    expect(await screen.findByTestId('pagina-lotes')).toBeTruthy();
  });

  it('falha ao ler permissões NÃO libera nada', async () => {
    sessao.falhar = true;
    await renderShell('/mapageral', 'MapaGeral');
    await screen.findByTestId('acesso-sem-tela');
    expect(screen.queryByTestId('pagina-mapa')).toBeNull();
  });

  it('mudança salva chega sem logout (evento de gravação)', async () => {
    await renderShell('/mapageral', 'MapaGeral');
    await screen.findByTestId('acesso-sem-tela');
    sessao.permissoes = [soVerMapa()];
    await act(async () => {
      avisarPermissoesAtualizadas();
    });
    expect(await screen.findByTestId('pagina-mapa')).toBeTruthy();
  });

  it('revogação chega ao voltar o foco', async () => {
    sessao.permissoes = [soVerMapa()];
    await renderShell('/mapageral', 'MapaGeral');
    await screen.findByTestId('pagina-mapa');
    sessao.permissoes = [];
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(screen.queryByTestId('pagina-mapa')).toBeNull());
  });
});

describe('PERM-F3 — cache offline por login, nunca amplia', () => {
  it('offline usa só o último valor DO SERVIDOR da própria conta', async () => {
    sessao.permissoes = [soVerMapa(), { ...soVerMapa('outro'), is_admin: true }];
    expect((await carregarPermissaoEfetiva(operador))?.is_admin).toBe(false);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const offline = await carregarPermissaoEfetiva(operador);
    expect(offline?.user_email).toBe('vaqueiro');
    expect(offline?.is_admin).toBe(false);
    // Outra conta na mesma máquina não herda o cache de ninguém.
    expect(await carregarPermissaoEfetiva({ ...operador, login: 'outro', email: 'outro' })).toBeNull();
  });

  it('cache adulterado (outro login, is_admin) é ignorado; logout limpa o cache', async () => {
    localStorage.setItem('maike_permissao_efetiva:fazenda-1:vaqueiro', JSON.stringify({ user_email: 'outro', is_admin: true }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(await carregarPermissaoEfetiva(operador)).toBeNull();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    sessao.permissoes = [soVerMapa()];
    await carregarPermissaoEfetiva(operador);
    expect(localStorage.getItem('maike_permissao_efetiva:fazenda-1:vaqueiro')).not.toBeNull();
    sairDaSessaoNativa();
    expect(localStorage.getItem('maike_permissao_efetiva:fazenda-1:vaqueiro')).toBeNull();
  });

  it('linha removida no servidor apaga o cache (revogação vale offline depois)', async () => {
    sessao.permissoes = [soVerMapa()];
    await carregarPermissaoEfetiva(operador);
    sessao.permissoes = [];
    expect(await carregarPermissaoEfetiva(operador)).toBeNull();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(await carregarPermissaoEfetiva(operador)).toBeNull();
  });
});

describe('PERM-R2 — cache por tenant + login; política das ações do mapa', () => {
  it('mesmo login em OUTRA fazenda não lê o cache; sem tenant conhecido não há cache', async () => {
    sessao.permissoes = [{ ...soVerMapa(), is_admin: true }];
    await carregarPermissaoEfetiva(operador);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect((await carregarPermissaoEfetiva(operador))?.is_admin).toBe(true);
    expect(await carregarPermissaoEfetiva({ ...operador, cliente_id: 'fazenda-2' })).toBeNull();
    expect(await carregarPermissaoEfetiva({ ...operador, cliente_id: undefined })).toBeNull();
    localStorage.setItem('maike_permissao_efetiva:fazenda-1:vaqueiro', JSON.stringify({ ...soVerMapa(), cliente_id: 'fazenda-2', is_admin: true }));
    expect(await carregarPermissaoEfetiva(operador)).toBeNull();
  });

  it('ação gravadora ausente, objeto ausente ou valor não booleano → desligada; visualização ausente → ligada', () => {
    const semObjeto = normalizeMapaGeralPermissions(null, true);
    const omitida = normalizeMapaGeralPermissions({ visualizar_lotes: false }, true);
    const texto = normalizeMapaGeralPermissions({ mover_lotes: 'true', pesar_lotes: 1 }, true);
    for (const p of [semObjeto, omitida, texto]) {
      for (const k of MAPA_GERAL_ACOES_GRAVADORAS) expect(p[k]).toBe(false);
    }
    expect(semObjeto.visualizar_lotes).toBe(true);
    expect(omitida.visualizar_lotes).toBe(false);
    expect(normalizeMapaGeralPermissions({ mover_lotes: true }, true).mover_lotes).toBe(true);
    expect(Object.values(normalizeMapaGeralPermissions({ mover_lotes: true }, false)).every((v) => v === false)).toBe(true);
    expect(Object.values(MAPA_GERAL_ACESSO_TOTAL).every((v) => v === true)).toBe(true);
  });

  it('mesma lista de ações gravadoras no navegador e no servidor', () => {
    const servidor = readFileSync('backend/src/shared/auth/autorizacaoTela.js', 'utf8');
    const lista = servidor.slice(servidor.indexOf('ACOES_GRAVADORAS_MAPA = Object.freeze(['), servidor.indexOf(']);', servidor.indexOf('ACOES_GRAVADORAS_MAPA = Object.freeze([')));
    const chaves = [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(chaves.sort()).toEqual([...MAPA_GERAL_ACOES_GRAVADORAS].sort());
  });

  it('formulário de usuário não liga ação ausente ao editar registro antigo', () => {
    const form = readFileSync('src/components/usuarios/FormularioUsuario.jsx', 'utf8');
    expect(form).toContain('normalizeMapaGeralPermissions(initialData.mapa_geral_permissoes)');
    expect(form).not.toMatch(/\.\.\.DEFAULT_MAPA_GERAL_PERMISSIONS,\s*\.\.\.initialData\.mapa_geral_permissoes/);
  });
});

describe('PERM-F4 — 403 do servidor', () => {
  it('ACAO_NAO_PERMITIDA vira mensagem compreensível', () => {
    const erro = new ApiError(API_ERROR_CODES.ACAO_NAO_PERMITIDA, { operation: 'create' });
    expect(getApiErrorMessage(erro, 'falhou')).toMatch(/não tem permissão para esta ação/i);
    // O cliente HTTP nativo traduz o código do servidor para este código estável.
    const cliente = readFileSync('src/apis/_core/nativeHttpClient.js', 'utf8');
    expect(cliente).toContain('ACAO_NAO_PERMITIDA: API_ERROR_CODES.ACAO_NAO_PERMITIDA');
  });
});
