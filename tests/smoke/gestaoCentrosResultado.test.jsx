/**
 * D-PROD-145 — tela Centros de Resultado montada de verdade. Mocks só da borda
 * (`fetch` = backend falso; sessão). O vínculo com Centros de Custo aqui é só
 * leitura.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, envelope, erroServidor, instalarBackendFake, rotulosDasOpcoes } from './fixtures/gestaoBackendFake.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));

const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [{ tela_id: 'ges-centros-resultado', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, ...acoes }],
});

const cr = (id, numero, nome, pai = null) => ({
  id, empresa_id: 'emp-1', numero, nome, descricao: null, pai_id: pai?.id ?? null, pai_nome: pai?.nome ?? null, ativo: true,
  created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z',
});
const BOI = cr('r1', 1, 'BOI GORDO');
const NOVILHA = cr('r2', 2, 'NOVILHA', BOI);

const empresaSelecionada = (id) => {
  window.localStorage.setItem('empresa_selecionada_id', id);
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
};

const montar = async () => {
  const { default: CentrosResultado } = await import('@/pages/CentrosResultado');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <CentrosResultado />
    </QueryClientProvider>,
  );
};

const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`centro-caminho-${id}`));
  await waitFor(() => expect(screen.getByTestId('b1-form')).toBeTruthy());
};

let backend;
let proximaResposta;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ salvar: true });
  proximaResposta = null;
  backend = instalarBackendFake(({ method, path, body }) => {
    if (proximaResposta && method !== 'GET') {
      const r = proximaResposta;
      proximaResposta = null;
      return r;
    }
    if (method === 'GET' && path === '/centros-resultado') return { status: 200, body: envelope([BOI, NOVILHA]) };
    if (method === 'GET' && path === '/centros-resultado-opcoes/pais') return { status: 200, body: { itens: [BOI, NOVILHA].map(({ id, numero, nome, pai_id }) => ({ id, numero, nome, pai_id })) } };
    if (method === 'GET' && path === '/centros-resultado/r1/centros-custo') return { status: 200, body: { itens: [{ id: 'c1', numero: 1, nome: 'PECUÁRIA', ativo: true }, { id: 'c9', numero: 9, nome: 'ANTIGO', ativo: false }] } };
    const m = path.match(/^\/centros-resultado\/([^/]+)$/);
    if (method === 'PATCH' && m) return { status: 200, body: { ...[BOI, NOVILHA].find((c) => c.id === m[1]), ...body } };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Centros de Resultado', () => {
  it('lista com hierarquia e mostra os centros de custo vinculados SOMENTE LEITURA', async () => {
    empresaSelecionada('emp-1');
    await montar();
    expect((await screen.findByTestId('centro-caminho-r2')).getAttribute('title')).toBe('BOI GORDO / NOVILHA');
    await abrir('r1');
    const secao = await screen.findByTestId('vinculos-centro-resultado');
    expect(await within(secao).findByText('1 · PECUÁRIA')).toBeTruthy();
    expect(within(secao).getByText('9 · ANTIGO (inativo)')).toBeTruthy();
    expect(within(secao).queryByRole('button')).toBeNull();
    expect(within(secao).queryByRole('checkbox')).toBeNull();
    expect(backend.chamadas.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('opções de pai vêm do próprio tipo, sem o nó e sem descendentes', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrir('r1');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const select = within(screen.getByTestId('b1-form')).getByLabelText(/Centro pai/);
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/centros-resultado-opcoes/pais')).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(await rotulosDasOpcoes(select)).toEqual(['— Nenhum (raiz) —']);
  });

  it('CENTRO_RESULTADO_NOT_FOUND ao salvar: mensagem e lista relida', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrir('r2');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Descrição/), { target: { value: 'x' } });
    const listagensAntes = backend.chamadas.filter((c) => c.path === '/centros-resultado').length;
    proximaResposta = erroServidor(404, 'CENTRO_RESULTADO_NOT_FOUND');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Centro de resultado não encontrado nesta empresa/)).toBeTruthy();
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', descricao: 'x' });
    await waitFor(() => expect(backend.chamadas.filter((c) => c.path === '/centros-resultado').length).toBeGreaterThan(listagensAntes));
  });

  it('sem empresa real (fallback clienteId) avisa e não chama o servidor', async () => {
    empresaSelecionada('cli-1');
    await montar();
    expect(await screen.findByTestId('gestao-sem-empresa')).toHaveTextContent(/Selecione uma empresa/);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(backend.chamadas).toEqual([]);
  });
});
