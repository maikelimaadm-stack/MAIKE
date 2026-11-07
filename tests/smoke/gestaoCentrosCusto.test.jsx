/**
 * D-PROD-145 — tela Centros de Custo montada de verdade (página, motor Base1,
 * service, API, porta e nativeHttpClient reais). Mocks só da borda: `fetch`
 * (backend falso) e a sessão (usuário/permissão efetiva, tenant do JWT).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, envelope, erroServidor, escolherOpcao, instalarBackendFake, rotulosDasOpcoes } from './fixtures/gestaoBackendFake.js';

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
  permissoes_telas: [{ tela_id: 'ges-centros-custo', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, ...acoes }],
});

const centro = (id, numero, nome, pai = null, ativo = true) => ({
  id, empresa_id: 'emp-1', numero, nome, descricao: null, pai_id: pai?.id ?? null, pai_nome: pai?.nome ?? null, ativo,
  created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z',
});
const PEC = centro('c1', 1, 'PECUÁRIA');
const CRIA = centro('c2', 2, 'CRIA', PEC);
const MAT = centro('c3', 3, 'MATERNIDADE', CRIA);
const AGR = centro('c4', 4, 'AGRICULTURA');

const empresaSelecionada = (id) => {
  window.localStorage.setItem('empresa_selecionada_id', id);
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
};

const montar = async () => {
  const { default: CentrosCusto } = await import('@/pages/CentrosCusto');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <CentrosCusto />
    </QueryClientProvider>,
  );
};

const ID = { 'PECUÁRIA': 'c1', CRIA: 'c2', MATERNIDADE: 'c3', AGRICULTURA: 'c4' };
/** Célula da coluna Hierarquia (o nome também aparece na coluna Pai dos filhos). */
const celula = (nome) => screen.findByTestId(`centro-caminho-${ID[nome]}`);

/** As opções de pai chegaram e o seletor já as desenhou. */
const esperarPais = async () => {
  await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/centros-custo-opcoes/pais')).toBe(true));
  await waitFor(() => expect(screen.getByLabelText(/^Centro pai$/)).toBeTruthy());
};

const abrirRegistro = async (nome) => {
  fireEvent.doubleClick(await celula(nome));
  await waitFor(() => expect(screen.getByTestId('b1-form')).toBeTruthy());
};

let backend;
let vinculos;
let proximaResposta;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true });
  vinculos = [{ id: 'r1', numero: 1, nome: 'BEZERROS', ativo: true }];
  proximaResposta = null;
  const crs = [
    { id: 'r1', numero: 1, nome: 'BEZERROS', pai_id: null },
    { id: 'r2', numero: 2, nome: 'BOI GORDO', pai_id: null },
    { id: 'r3', numero: 3, nome: 'GRÃOS', pai_id: null },
  ];
  backend = instalarBackendFake(({ method, path, query, body }) => {
    if (proximaResposta && method !== 'GET') {
      const r = proximaResposta;
      proximaResposta = null;
      return r;
    }
    if (method === 'GET' && path === '/centros-custo') return { status: 200, body: envelope(query.get('empresa_id') === 'emp-1' ? [PEC, CRIA, MAT, AGR] : []) };
    if (method === 'GET' && path === '/centros-custo-opcoes/pais') {
      return { status: 200, body: { itens: [PEC, CRIA, MAT, AGR].map(({ id, numero, nome, pai_id }) => ({ id, numero, nome, pai_id })) } };
    }
    if (method === 'GET' && path === '/centros-custo-opcoes/centros-resultado') return { status: 200, body: { itens: crs } };
    if (method === 'GET' && path === '/centros-custo/c1/centros-resultado') return { status: 200, body: { itens: vinculos } };
    if (method === 'PUT' && path === '/centros-custo/c1/centros-resultado') {
      vinculos = body.centro_resultado_ids.map((id) => ({ ...crs.find((c) => c.id === id), ativo: true }));
      return { status: 200, body: { alterado: true, adicionados: [], removidos: [], itens: vinculos } };
    }
    if (method === 'POST' && path === '/centros-custo') return { status: 201, body: centro('c9', 9, body.nome, body.pai_id ? PEC : null) };
    const m = path.match(/^\/centros-custo\/([^/]+)$/);
    if (method === 'PATCH' && m) return { status: 200, body: { ...[PEC, CRIA, MAT, AGR].find((c) => c.id === m[1]), ...body } };
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Centros de Custo — lista e empresa', () => {
  it('mostra a hierarquia (caminho e pai) com indentação', async () => {
    empresaSelecionada('emp-1');
    await montar();
    const mat = await screen.findByText('MATERNIDADE');
    expect(mat.closest('[title]')?.getAttribute('title')).toBe('PECUÁRIA / CRIA / MATERNIDADE');
    expect(mat.closest('[title]')?.getAttribute('style')).toMatch(/padding-left: 24px/);
    const linha = mat.closest('tr');
    expect(within(linha).getByText('CRIA')).toBeTruthy();
  });

  it('sem empresa real (fallback clienteId) avisa e não lista', async () => {
    empresaSelecionada('cli-1');
    await montar();
    expect(await screen.findByTestId('gestao-sem-empresa')).toHaveTextContent(/Selecione uma empresa/);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(backend.chamadas.filter((c) => c.path.startsWith('/centros'))).toEqual([]);
  });

  it('filtro de situação relê com ativo=false', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('PECUÁRIA');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/centros-custo' && c.query.ativo === 'false')).toBe(true));
  });
});

describe('Centros de Custo — formulário e hierarquia', () => {
  it('opções de pai não incluem o próprio nó nem descendentes', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('CRIA');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const select = within(screen.getByTestId('b1-form')).getByLabelText(/Centro pai/);
    await esperarPais();
    expect(await rotulosDasOpcoes(select)).toEqual(['— Nenhum (raiz) —', 'AGRICULTURA', 'PECUÁRIA']);
  });

  it('mudar o pai envia só pai_id; virar raiz envia pai_id=null', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('CRIA');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const select = within(screen.getByTestId('b1-form')).getByLabelText(/Centro pai/);
    await esperarPais();
    await escolherOpcao(select, '— Nenhum (raiz) —');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Centro de custo atualizado');
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', pai_id: null });
  });

  it('cria com pai', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('PECUÁRIA');
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    const form = await screen.findByTestId('b1-form');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'recria' } });
    const select = within(form).getByLabelText(/Centro pai/);
    await esperarPais();
    await escolherOpcao(select, 'PECUÁRIA');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Centro de custo criado');
    expect(backend.chamadas.find((c) => c.method === 'POST').body).toEqual({ empresa_id: 'emp-1', nome: 'RECRIA', pai_id: 'c1' });
  });

  const casosHierarquia = [
    [{ field: 'pai_id', reason: 'ciclo' }, /formaria um ciclo/],
    [{ field: 'pai_id', reason: 'profundidade_maxima', details: { maximo: 5 } }, /número máximo de níveis/],
    [{ field: 'pai_id', reason: 'pai_inativo' }, /pai está inativo/],
    [{ field: 'pai_id', reason: 'pai_fora_da_empresa' }, /não pertence a esta empresa/],
    [{ details: { reason: 'autorreferencia' } }, /não pode ser pai de si mesmo/],
  ];
  it.each(casosHierarquia)('CENTRO_HIERARQUIA_INVALIDA %#: mensagem pelo reason', async (extra, mensagem) => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('CRIA');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const select = within(screen.getByTestId('b1-form')).getByLabelText(/Centro pai/);
    await esperarPais();
    await escolherOpcao(select, 'AGRICULTURA');
    proximaResposta = erroServidor(409, 'CENTRO_HIERARQUIA_INVALIDA', extra);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(mensagem)).toBeTruthy();
    expect(screen.queryByText('Centro de custo atualizado')).toBeNull();
  });

  it('CENTRO_NOME_CONFLITO na criação', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('PECUÁRIA');
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    fireEvent.change(within(await screen.findByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'cria' } });
    proximaResposta = erroServidor(409, 'CENTRO_NOME_CONFLITO');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Já existe um centro com este nome/)).toBeTruthy();
  });

  it('inativar com filhos ativos: confirmação e mensagem CENTRO_COM_FILHOS_ATIVOS', async () => {
    empresaSelecionada('emp-1');
    await montar();
    fireEvent.click(await celula('PECUÁRIA'));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialogo = await screen.findByRole('dialog');
    proximaResposta = erroServidor(409, 'CENTRO_COM_FILHOS_ATIVOS');
    fireEvent.click(within(dialogo).getByRole('button', { name: /Inativar/ }));
    expect(await screen.findByText(/tem centros filhos ativos/)).toBeTruthy();
    expect(screen.queryByText('Centro de custo inativado')).toBeNull();
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', ativo: false });
  });
});

describe('Centros de Custo — vínculo N:N com Centros de Resultado', () => {
  it('seleção múltipla envia os ids certos e relê do banco', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('PECUÁRIA');
    const secao = await screen.findByTestId('vinculos-centro-custo');
    expect(await within(secao).findByText('1 · BEZERROS')).toBeTruthy();
    fireEvent.click(within(secao).getByRole('button', { name: 'Alterar vínculos' }));
    await within(secao).findByRole('checkbox', { name: '2 · BOI GORDO' });
    fireEvent.click(within(secao).getByRole('checkbox', { name: '2 · BOI GORDO' }));
    fireEvent.click(within(secao).getByRole('checkbox', { name: '3 · GRÃOS' }));
    fireEvent.click(within(secao).getByRole('checkbox', { name: '1 · BEZERROS' }));
    const leiturasAntes = backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/centros-custo/c1/centros-resultado').length;
    fireEvent.click(within(secao).getByRole('button', { name: 'Salvar vínculos' }));
    await screen.findByText('Vínculos atualizados');
    const put = backend.chamadas.find((c) => c.method === 'PUT');
    expect(put.body).toEqual({ empresa_id: 'emp-1', centro_resultado_ids: ['r2', 'r3'] });
    await waitFor(() =>
      expect(backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/centros-custo/c1/centros-resultado').length).toBeGreaterThan(leiturasAntes),
    );
    expect(await within(secao).findByText('2 · BOI GORDO')).toBeTruthy();
    expect(within(secao).queryByText('1 · BEZERROS')).toBeNull();
  });

  it('CENTRO_INATIVO no vínculo mostra a mensagem e não finge sucesso', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('PECUÁRIA');
    const secao = await screen.findByTestId('vinculos-centro-custo');
    fireEvent.click(await within(secao).findByRole('button', { name: 'Alterar vínculos' }));
    fireEvent.click(await within(secao).findByRole('checkbox', { name: '2 · BOI GORDO' }));
    proximaResposta = erroServidor(409, 'CENTRO_INATIVO', { details: { field: 'centro_resultado_ids' } });
    fireEvent.click(within(secao).getByRole('button', { name: 'Salvar vínculos' }));
    expect(await screen.findByText(/não recebe vínculo novo/)).toBeTruthy();
    expect(screen.queryByText('Vínculos atualizados')).toBeNull();
  });

  it('só visualizar: vê os vínculos, sem alterar e sem pedir as opções', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = permissaoCom({});
    await montar();
    await abrirRegistro('PECUÁRIA');
    const secao = await screen.findByTestId('vinculos-centro-custo');
    expect(await within(secao).findByText('1 · BEZERROS')).toBeTruthy();
    expect(within(secao).queryByRole('button', { name: 'Alterar vínculos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(backend.chamadas.some((c) => c.path === '/centros-custo-opcoes/centros-resultado')).toBe(false);
  });
});
