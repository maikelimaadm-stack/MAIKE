/**
 * D-PROD-145 — tela Parceiros montada de verdade (página, motor Base1, service,
 * API, porta e nativeHttpClient reais). Mocks só da borda: `fetch` (backend
 * falso) e a sessão (usuário/permissão efetiva, tenant do JWT).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { API_FAKE, envelope, erroServidor, escolherOpcao, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));

const linhaTela = (tela, acoes) => ({
  tela_id: tela,
  visualizar: true,
  novo: false,
  salvar: false,
  editar: false,
  excluir: false,
  importar: false,
  exportar: false,
  ...acoes,
});
const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [linhaTela('ges-parceiros', acoes)],
});

const PJ = {
  id: 'p1', empresa_id: 'emp-1', numero_cadastro: '7', tipo_pessoa: 'Jurídica', nome: 'AGRO SOL', razao_social: 'AGRO SOL LTDA',
  cpf: null, cnpj: '11222333000181', rg: null, data_nascimento: null, inscricao_estadual: '123', nome_responsavel: null,
  telefone: '6533334444', email: null, endereco: null, cidade: 'CUIABA', codigo_ibge: null, estado: 'MT', cep: null, observacoes: null,
  papeis: ['fornecedor'], tipos_legados: [], ativo: true, created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-01T00:00:00Z',
};
const LEGADO = { ...PJ, id: 'p2', numero_cadastro: '8', nome: 'FAZENDA VELHA', papeis: [], tipos_legados: ['Vendedor de gado'] };

const empresaSelecionada = (id) => {
  window.localStorage.setItem('empresa_selecionada_id', id);
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
};

const montar = async () => {
  const { default: Parceiros } = await import('@/pages/Parceiros');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Parceiros />
    </QueryClientProvider>,
  );
  return { queryClient };
};

const abrirRegistro = async (nome) => {
  const celula = await screen.findByText(nome);
  fireEvent.doubleClick(celula);
  await waitFor(() => expect(screen.getByTestId('b1-form')).toBeTruthy());
};

let backend;
let registros;
let proximaResposta;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true });
  registros = { 'emp-1': [PJ, LEGADO], 'emp-2': [{ ...PJ, id: 'p9', empresa_id: 'emp-2', nome: 'OUTRA EMPRESA SA' }] };
  proximaResposta = null;
  backend = instalarBackendFake(({ method, path, query, body }) => {
    if (proximaResposta && method !== 'GET') {
      const r = proximaResposta;
      proximaResposta = null;
      return r;
    }
    if (method === 'GET' && path === '/parceiros') return { status: 200, body: envelope(registros[query.get('empresa_id')] ?? []) };
    if (method === 'POST' && path === '/parceiros') return { status: 201, body: { ...PJ, ...body, id: 'novo1', numero_cadastro: '9', tipos_legados: [] } };
    const m = path.match(/^\/parceiros\/([^/]+)$/);
    if (method === 'PATCH' && m) {
      const atual = Object.values(registros).flat().find((r) => r.id === m[1]);
      return { status: 200, body: { ...atual, ...body } };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Parceiros — empresa', () => {
  it('sem empresa real (fallback = clienteId) avisa, não lista e não oferece gravação', async () => {
    empresaSelecionada('cli-1');
    await montar();
    expect(await screen.findByTestId('gestao-sem-empresa')).toHaveTextContent(/Selecione uma empresa/);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(backend.chamadas.filter((c) => c.path.startsWith('/parceiros'))).toEqual([]);
  });

  it('troca de empresa limpa a lista anterior e relê com a nova empresa', async () => {
    empresaSelecionada('emp-1');
    await montar();
    expect(await screen.findByText('AGRO SOL')).toBeTruthy();
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    expect(await screen.findByText('OUTRA EMPRESA SA')).toBeTruthy();
    expect(screen.queryByText('AGRO SOL')).toBeNull();
    const listagens = backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/parceiros');
    expect(listagens.map((c) => c.query.empresa_id)).toEqual(expect.arrayContaining(['emp-1', 'emp-2']));
    expect(listagens.every((c) => c.query.ativo === 'true')).toBe(true);
  });
});

describe('Parceiros — permissões espelham o servidor', () => {
  it('só visualizar: lista, abre registro somente leitura, sem Novo/Editar/Excluir', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = permissaoCom({});
    await montar();
    await abrirRegistro('AGRO SOL');
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Excluir/ })).toBeNull();
  });

  it('salvar sozinho libera criar e editar (novo|salvar, editar|salvar)', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = permissaoCom({ salvar: true });
    await montar();
    await screen.findByText('AGRO SOL');
    expect(screen.getByRole('button', { name: 'Novo' })).toBeTruthy();
    fireEvent.click(screen.getByText('AGRO SOL'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy());
  });

  it('sem linha da tela (padrão não-admin) nada aparece e nada é listado', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = { user_email: 'operador', modulos_permitidos: ['gestao-rural'], permissoes_telas: [] };
    await montar();
    expect(await screen.findByTestId('gestao-sem-permissao')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(backend.chamadas.filter((c) => c.path === '/parceiros')).toEqual([]);
  });
});

describe('Parceiros — formulário', () => {
  it('cria Pessoa Física com CPF/RG/nascimento e papéis múltiplos (sem campos de PJ)', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await screen.findByText('AGRO SOL');
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    const form = await screen.findByTestId('b1-form');
    await escolherOpcao(within(form).getByLabelText(/Tipo de pessoa/), 'Pessoa física');
    expect(within(form).queryByLabelText(/CNPJ/)).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'joão da silva' } });
    fireEvent.change(within(form).getByLabelText(/^CPF/), { target: { value: '529.982.247-25' } });
    fireEvent.change(within(form).getByLabelText(/^RG/), { target: { value: '1234' } });
    fireEvent.change(within(form).getByLabelText(/Data de nascimento/), { target: { value: '1980-05-02' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Cliente' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Transportador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Parceiro criado');
    const post = backend.chamadas.find((c) => c.method === 'POST');
    expect(post.body).toEqual({
      empresa_id: 'emp-1', tipo_pessoa: 'Física', nome: 'JOÃO DA SILVA', cpf: '529.982.247-25', rg: '1234',
      data_nascimento: '1980-05-02', papeis: ['cliente', 'transportador'],
    });
  });

  it('cria Pessoa Jurídica com razão social e CNPJ', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await screen.findByText('AGRO SOL');
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    const form = await screen.findByTestId('b1-form');
    expect(within(form).queryByLabelText(/^CPF/)).toBeNull();
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Transportes X' } });
    fireEvent.change(within(form).getByLabelText(/Razão social/), { target: { value: 'TRANSPORTES X LTDA' } });
    fireEvent.change(within(form).getByLabelText(/^CNPJ/), { target: { value: '11.222.333/0001-81' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Parceiro criado');
    const post = backend.chamadas.find((c) => c.method === 'POST');
    expect(post.body).toMatchObject({ tipo_pessoa: 'Jurídica', nome: 'TRANSPORTES X', razao_social: 'TRANSPORTES X LTDA', cnpj: '11.222.333/0001-81', papeis: [] });
    expect(post.body).not.toHaveProperty('cpf');
  });

  it('PATCH envia só os campos alterados (e empresa_id de escopo)', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('AGRO SOL');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const form = screen.getByTestId('b1-form');
    fireEvent.change(within(form).getByLabelText(/^Telefone/), { target: { value: '65999990000' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Prestador de serviço' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Parceiro atualizado');
    const patch = backend.chamadas.find((c) => c.method === 'PATCH');
    expect(patch.path).toBe('/parceiros/p1');
    expect(patch.body).toEqual({ empresa_id: 'emp-1', telefone: '65999990000', papeis: ['fornecedor', 'prestador_servico'] });
  });

  it('legado com papeis=[] aparece; tipos antigos ficam como somente leitura', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('FAZENDA VELHA');
    expect(screen.getByTestId('parceiro-papeis-legados')).toHaveTextContent('Papéis antigos preservados: Vendedor de gado');
    for (const nome of ['Fornecedor', 'Cliente', 'Prestador de serviço', 'Transportador', 'Outros']) {
      expect(screen.getByRole('checkbox', { name: nome }).getAttribute('aria-checked')).toBe('false');
    }
  });

  it('inativar pela barra pede confirmação e envia ativo=false', async () => {
    empresaSelecionada('emp-1');
    await montar();
    fireEvent.click(await screen.findByText('AGRO SOL'));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent(/Inativar este parceiro/);
    expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.click(within(dialogo).getByRole('button', { name: /Inativar/ }));
    await screen.findByText('Parceiro inativado');
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', ativo: false });
  });

  it('inativar pelo switch da Situação pede confirmação; cancelar não grava', async () => {
    empresaSelecionada('emp-1');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await montar();
    await abrirRegistro('AGRO SOL');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(within(screen.getByTestId('b1-form')).getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('Parceiros — mensagens por código do servidor (nunca sucesso falso)', () => {
  const casos = [
    [erroServidor(409, 'PARCEIRO_DOCUMENTO_DUPLICADO', { details: { numero_cadastro: '42' }, field: 'cnpj' }), /Já existe um parceiro com este CNPJ nesta empresa \(cadastro nº 42\)/],
    [erroServidor(400, 'PARCEIRO_DOCUMENTO_INVALIDO', { details: { field: 'cnpj' } }), /CNPJ inválido/],
    [erroServidor(403, 'ACAO_NAO_PERMITIDA'), /não tem permissão para esta ação/],
    [erroServidor(404, 'EMPRESA_NOT_FOUND', { details: { field: 'empresa_id' } }), /Empresa não encontrada/],
    [erroServidor(404, 'PARCEIRO_NOT_FOUND'), /Parceiro não encontrado nesta empresa/],
    [erroServidor(400, 'REQUEST_VALIDATION_FAILED', { details: { field: 'email' } }), /Dados inválidos no campo "email"/],
  ];
  it.each(casos)('%#: mostra a mensagem do código', async (falha, mensagem) => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('AGRO SOL');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^CNPJ/), { target: { value: '11.111.111/1111-11' } });
    proximaResposta = falha;
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(mensagem)).toBeTruthy();
    expect(screen.queryByText('Parceiro atualizado')).toBeNull();
  });
});
