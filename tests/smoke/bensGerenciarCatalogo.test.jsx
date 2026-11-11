/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01, §5.2) — "⋯ › Gerenciar famílias
 * e tipos" e "⋯ › Instalar catálogo padrão" no cadastro de Bens (as telas
 * Famílias/Tipos/Perfis/Combustíveis saíram). Tela real; mocks só da borda.
 *
 *  - o "⋯" mostra "Gerenciar famílias e tipos" para quem vê Bens e "Instalar
 *    catálogo padrão" só para o administrador (`is_admin`, P-06);
 *  - o diálogo lista Famílias (filtro de natureza, busca, situação) e Tipos
 *    (filtro de família) pelas rotas keyset `/patrimonio-familias` e
 *    `/patrimonio-tipos`, sem `empresa_id`;
 *  - "+ Nova" (Bens novo|salvar|editar) cria sem código (P-05); "Editar"
 *    (Bens editar|salvar) manda o PATCH mínimo com `versao`; "Inativar"/
 *    "Reativar" só com a ação `inativar` de Bens, com confirmação;
 *  - o resumo do catálogo padrão mostra só famílias e tipos.
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

const permissaoCom = (acoes, extra = {}) => ({
  user_email: 'operador',
  modulos_permitidos: ['patrimonio'],
  ...extra,
  permissoes_telas: [{ tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });

const FAMILIAS = [
  { id: 'f1', codigo: 'BENFEITORIAS', nome: 'Benfeitorias', natureza: 'BENFEITORIA', descricao: null, ordem: null, vida_util_meses_padrao: 300, ativo: true, versao: 2 },
  { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', descricao: null, ordem: 1, vida_util_meses_padrao: 120, ativo: true, versao: 3 },
  { id: 'f7', codigo: 'GALPOES', nome: 'Galpões', natureza: 'BENFEITORIA', descricao: null, ordem: null, vida_util_meses_padrao: null, ativo: false, versao: 5 },
];
const TIPOS = [
  { id: 't1', codigo: 'CURRAL', nome: 'Curral', familia_id: 'f1', familia: { id: 'f1', nome: 'Benfeitorias', natureza: 'BENFEITORIA' }, descricao: null, vida_util_meses_sugerida: null, ativo: true, versao: 1 },
  { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', familia_id: 'f2', familia: { id: 'f2', nome: 'Máquinas', natureza: 'MAQUINA' }, descricao: null, vida_util_meses_sugerida: 120, ativo: true, versao: 4 },
];
const RESUMO_TRATOR = {
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', familia: { id: 'f2', nome: 'Máquinas' },
  tipo: { id: 't2', nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 4,
};

let backend;
/** Resposta de erro injetada na PRÓXIMA gravação. */
let proxima;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true, inativar: true });
  proxima = null;
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proxima && method !== 'GET') {
      const r = proxima;
      proxima = null;
      return r;
    }
    if (method === 'GET' && path === '/bens-patrimoniais') return { status: 200, body: envelope([RESUMO_TRATOR]) };
    if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Sao_Paulo' }] };
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/familias') return opcoes(FAMILIAS.filter((f) => f.ativo));
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return opcoes([]);
    if (method === 'GET' && path === '/patrimonio-familias') {
      const ativo = query.get('ativo');
      const itens = FAMILIAS.filter(
        (f) =>
          (ativo === null || String(f.ativo) === ativo) &&
          (!query.get('natureza') || f.natureza === query.get('natureza')) &&
          (!query.get('q') || f.nome.toLowerCase().includes(query.get('q').toLowerCase())),
      );
      return { status: 200, body: envelope(itens) };
    }
    if (method === 'GET' && path === '/patrimonio-tipos') {
      const ativo = query.get('ativo');
      const itens = TIPOS.filter((t) => (ativo === null || String(t.ativo) === ativo) && (!query.get('familia_id') || t.familia_id === query.get('familia_id')));
      return { status: 200, body: envelope(itens) };
    }
    if (method === 'POST' && path === '/patrimonio-familias') return { status: 201, body: { id: 'f9', codigo: 'GERADO', ativo: true, versao: 1, ...body } };
    if (method === 'PATCH' && path.startsWith('/patrimonio-familias/')) {
      const f = FAMILIAS.find((x) => x.id === path.split('/')[2]);
      return { status: 200, body: { ...f, ...body, versao: f.versao + 1 } };
    }
    if (method === 'PATCH' && path.startsWith('/patrimonio-tipos/')) {
      const t = TIPOS.find((x) => x.id === path.split('/')[2]);
      return { status: 200, body: { ...t, ...body, versao: t.versao + 1 } };
    }
    if (method === 'POST' && path === '/patrimonio-catalogo-padrao') {
      return {
        status: 200,
        body: {
          criados: { familias: 2, tipos: 5 },
          existentes: { familias: 1, tipos: 0 },
          conflitos: [{ recurso: 'familias', codigo: 'MAQUINAS', motivo: 'natureza_divergente' }],
        },
      };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const montar = async () => {
  const { default: Pagina } = await import('@/pages/BensPatrimoniais');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Pagina />
    </QueryClientProvider>,
  );
};

const mutacoes = () => backend.chamadas.filter((c) => c.method !== 'GET');
const listagens = (path) => backend.chamadas.filter((c) => c.method === 'GET' && c.path === path);
const abrirMenu = async () => {
  await screen.findByTestId('bem-nome-b1');
  fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
  await screen.findByText('Imprimir');
};
const abrirGerenciar = async () => {
  await abrirMenu();
  fireEvent.click(screen.getByText('Gerenciar famílias e tipos'));
  const dialogo = await screen.findByTestId('gerenciar-familias-tipos');
  await within(dialogo).findByTestId('gerenciar-lista-familias');
  return dialogo;
};

describe('Bens — "⋯" do catálogo (D-PROD-162)', () => {
  it('quem só vê Bens tem "Gerenciar famílias e tipos"; "Instalar catálogo padrão" só para o administrador', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    await abrirMenu();
    expect(screen.getByText('Gerenciar famílias e tipos')).toBeTruthy();
    expect(screen.queryByText('Instalar catálogo padrão')).toBeNull();
  });

  it('administrador (is_admin): instala o catálogo padrão com confirmação; o resumo fala só de famílias e tipos', async () => {
    sessao.permissao = permissaoCom({}, { is_admin: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrirMenu();
    fireEvent.click(screen.getByText('Instalar catálogo padrão'));
    const resumo = await screen.findByTestId('patrimonio-catalogo-padrao-resumo');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/famílias e tipos de uso comum/);
    expect(confirmSpy.mock.calls[0][0]).not.toMatch(/perfis|combust/i);
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', path: '/patrimonio-catalogo-padrao', body: {} })]);
    expect(resumo).toHaveTextContent('Criados: 2 famílias, 5 tipos.');
    expect(resumo).toHaveTextContent('Já existiam: 1 família, 0 tipos.');
    expect(resumo).toHaveTextContent('família MAQUINAS: já existe com outra natureza');
    expect(resumo.textContent).not.toMatch(/perfis|combust/i);
  });

  it('403 de administrador no catálogo padrão mostra "Só o administrador…"', async () => {
    sessao.permissao = permissaoCom({}, { is_admin: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    proxima = erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { exige: ['administrador_ou_is_admin'] } });
    await montar();
    await abrirMenu();
    fireEvent.click(screen.getByText('Instalar catálogo padrão'));
    expect(await screen.findByText('Só o administrador da fazenda pode fazer isso.')).toBeTruthy();
    expect(screen.queryByTestId('patrimonio-catalogo-padrao-resumo')).toBeNull();
  });
});

describe('Gerenciar famílias e tipos — listas e filtros', () => {
  it('famílias ativas sem empresa; filtro de natureza, busca e situação vão na query; tipos com filtro de família', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).getByTestId('gerenciar-familias-f2')).toHaveTextContent(/MAQUINAS.*Máquinas.*Máquina.*120 meses.*Ativo/);
    expect(within(dialogo).queryByTestId('gerenciar-familias-f7')).toBeNull();
    expect(listagens('/patrimonio-familias')[0].query).toEqual({ ativo: 'true', limit: '50' });

    await escolherOpcao(within(dialogo).getByRole('combobox', { name: 'Filtrar por natureza' }), 'Benfeitoria');
    await waitFor(() => expect(listagens('/patrimonio-familias').at(-1).query).toMatchObject({ natureza: 'BENFEITORIA', ativo: 'true' }));
    await waitFor(() => expect(within(dialogo).queryByTestId('gerenciar-familias-f2')).toBeNull());
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(dialogo).getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    expect(await within(dialogo).findByTestId('gerenciar-familias-f7')).toHaveTextContent(/Inativo/);
    expect(listagens('/patrimonio-familias').at(-1).query).toMatchObject({ ativo: 'false', natureza: 'BENFEITORIA' });
    fireEvent.change(within(dialogo).getByRole('searchbox', { name: 'Buscar famílias' }), { target: { value: 'galp' } });
    await waitFor(() => expect(listagens('/patrimonio-familias').at(-1).query).toMatchObject({ q: 'galp' }));

    fireEvent.click(within(dialogo).getByRole('tab', { name: 'Tipos' }));
    // A situação escolhida vale para as duas listas.
    await waitFor(() => expect(listagens('/patrimonio-tipos').at(-1)?.query).toMatchObject({ ativo: 'false' }));
    expect(await within(dialogo).findByTestId('gerenciar-vazio')).toHaveTextContent('Nenhum tipo encontrado.');
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(dialogo).getByRole('combobox', { name: 'Filtrar por situação' }), 'Ativos');
    await waitFor(() => expect(listagens('/patrimonio-tipos').at(-1).query).toMatchObject({ ativo: 'true' }));
    fireEvent.click(within(dialogo).getByTestId('gerenciar-filtro-familia'));
    fireEvent.click(await within(dialogo).findByRole('option', { name: /^Máquinas/ }));
    await waitFor(() => expect(listagens('/patrimonio-tipos').at(-1).query).toMatchObject({ familia_id: 'f2' }));
    // O cabeçalho da lista de tipos não tem mais "Perfis sugeridos".
    expect(await within(dialogo).findByTestId('gerenciar-tipos-t2')).toHaveTextContent(/TRATOR_PNEUS.*Trator de pneus.*Máquinas.*Ativo/);
    expect(within(dialogo).queryByTestId('gerenciar-tipos-t1')).toBeNull();
    expect(within(dialogo).queryByText('Perfis sugeridos')).toBeNull();
    expect([...backend.chamadas].every((c) => !/patrimonio-(familias|tipos)/.test(c.path) || c.query.empresa_id === undefined)).toBe(true);
  });
});

describe('Gerenciar famílias e tipos — criar, editar e inativar pelas ações de Bens', () => {
  it('"+ Nova família" cria sem código (P-05); vazio = o servidor gera', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByTestId('gerenciar-novo'));
    const form = within(dialogo).getByTestId('gerenciar-form');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Pivôs de irrigação' } });
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Natureza' }), 'Equipamento');
    fireEvent.click(within(form).getByRole('button', { name: 'Criar família' }));
    await screen.findByText('Família patrimonial criada');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/patrimonio-familias', body: { nome: 'Pivôs de irrigação', natureza: 'EQUIPAMENTO' } }),
    ]);
    await waitFor(() => expect(within(dialogo).queryByTestId('gerenciar-form')).toBeNull());
  });

  it('"Editar" renomeia com o PATCH mínimo e a versao; o tipo nunca leva perfis', async () => {
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Editar Máquinas' }));
    let form = within(dialogo).getByTestId('gerenciar-form');
    expect(within(form).getByLabelText(/^Código/).readOnly).toBe(true);
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Máquinas agrícolas' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }));
    await screen.findByText('Família patrimonial atualizada');
    expect(mutacoes()[0]).toEqual(expect.objectContaining({ method: 'PATCH', path: '/patrimonio-familias/f2', body: { versao: 3, nome: 'Máquinas agrícolas' } }));

    fireEvent.click(within(dialogo).getByRole('tab', { name: 'Tipos' }));
    fireEvent.click(await within(dialogo).findByRole('button', { name: 'Editar Trator de pneus' }));
    form = within(dialogo).getByTestId('gerenciar-form');
    fireEvent.change(within(form).getByLabelText(/^Descrição/), { target: { value: 'Tração 4x4' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar alterações' }));
    await screen.findByText('Tipo patrimonial atualizado');
    expect(mutacoes()[1]).toEqual(expect.objectContaining({ method: 'PATCH', path: '/patrimonio-tipos/t2', body: { versao: 4, descricao: 'Tração 4x4' } }));
  });

  it('"Inativar" pede confirmação e manda {versao, ativo:false}; 409 de versão relê a lista', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    const dialogo = await abrirGerenciar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Inativar Máquinas' }));
    await screen.findByText('Família patrimonial inativada');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mutacoes()[0]).toEqual(expect.objectContaining({ method: 'PATCH', path: '/patrimonio-familias/f2', body: { versao: 3, ativo: false } }));

    const antes = listagens('/patrimonio-familias').length;
    proxima = erroServidor(409, 'PATRIMONIO_VERSAO_CONFLITO', { details: { versao_atual: 4, versao_informada: 2 } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Inativar Benfeitorias' }));
    expect(await screen.findByText(/A lista foi recarregada com a versão atual/)).toBeTruthy();
    await waitFor(() => expect(listagens('/patrimonio-familias').length).toBeGreaterThan(antes));
  });

  it('sem `inativar`: nada de Inativar/Reativar; só novo: "+ Nova" sem "Editar"', async () => {
    sessao.permissao = permissaoCom({ novo: true });
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).getByTestId('gerenciar-novo')).toBeTruthy();
    expect(within(dialogo).queryByRole('button', { name: /^Inativar/ })).toBeNull();
    expect(within(dialogo).queryByRole('button', { name: /^Editar/ })).toBeNull();
  });

  it('só visualizar: lista sem "+ Nova", "Editar" nem "Inativar"', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    const dialogo = await abrirGerenciar();
    expect(within(dialogo).queryByTestId('gerenciar-novo')).toBeNull();
    expect(within(dialogo).queryByRole('button', { name: /^(Editar|Inativar|Reativar) / })).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mutacoes()).toEqual([]);
  });
});
