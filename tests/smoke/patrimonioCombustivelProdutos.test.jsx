/**
 * D-PROD-157 (R2) — Combustível × Produto por empresa na tela Combustíveis,
 * montada de verdade (página, motor Base1, seção de vínculos, service, API,
 * porta e nativeHttpClient reais). Mocks só da borda: `fetch` (backend falso,
 * com as regras do contrato) e a sessão (usuário/permissão efetiva).
 *
 *  - no registro ABERTO (leitura), a seção "Produtos vinculados nesta fazenda"
 *    usa a empresa selecionada: sem empresa → aviso e nada lido;
 *  - lista dos vínculos do combustível NA fazenda: nome do produto, unidade de
 *    estoque como está (ex.: KG, sem conversão), situação (vínculo inativo,
 *    produto inativo, produto movido para outra fazenda); estado vazio
 *    explícito;
 *  - "Vincular produto": seletor paginado no servidor só com produtos ATIVOS da
 *    fazenda; o produto já ativo em OUTRO combustível aparece marcado e não pode
 *    ser escolhido; POST com o corpo EXATO `{empresa_id, produto_id}`;
 *  - inativar/reativar por vínculo com confirmação, exige a ação `inativar`,
 *    PATCH com o corpo EXATO `{empresa_id, versao, ativo}`;
 *  - erros novos (409 em outro tipo, duplicado inativo, CAS, 404) mostram a
 *    mensagem do patrimônio ("Nada foi gravado.").
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

const permissaoCom = (acoes) => ({
  user_email: 'operador',
  modulos_permitidos: ['patrimonio'],
  permissoes_telas: [{ tela_id: 'pat-combustiveis', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

const datas = { created_date: '2026-11-01T10:00:00Z', updated_date: '2026-11-01T10:00:00Z' };
const combustivel = (id, codigo, nome, extra = {}) => ({ id, codigo, nome, unidade: 'L', descricao: null, ativo: true, versao: 1, ...datas, ...extra });
const COMBUSTIVEIS = () => [
  combustivel('c1', 'DIESEL_S10', 'Diesel S10'),
  combustivel('c2', 'DIESEL_S500', 'Diesel S500'),
  combustivel('c3', 'GASOLINA', 'Gasolina comum'),
  combustivel('c9', 'QUEROSENE', 'Querosene', { ativo: false, versao: 2 }),
];

/** Produtos REAIS do cadastro (tabela antiga): cada um de UMA empresa; unidade de estoque como está (KG). */
const PRODUTOS = () => [
  { id: 'pr1', nome: 'DIESEL S10 A GRANEL', codigo_interno: 'DS10G', unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pr2', nome: 'DIESEL S10 POSTO', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pr3', nome: 'DIESEL S500 BOMBA', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pr4', nome: 'DIESEL S10 ANTIGO', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: false, empresa_id: 'emp-1' },
  { id: 'pr5', nome: 'DIESEL S10 TRANSFERIDO', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-2' },
  { id: 'pr6', nome: 'DIESEL S10 FAZENDA B', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-2' },
  { id: 'pr7', nome: 'DIESEL S10 TANQUE 2', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pr8', nome: 'DIESEL S10 VELHO', codigo_interno: null, unidade_principal_estoque: 'SACO', ativo: false, empresa_id: 'emp-1' },
];

const vinculo = (id, empresa_id, tipo_combustivel_id, produto_id, ativo, versao) => ({ id, empresa_id, tipo_combustivel_id, produto_id, ativo, versao, ...datas });
const VINCULOS = () => [
  vinculo('v1', 'emp-1', 'c1', 'pr1', true, 1),
  vinculo('v2', 'emp-1', 'c1', 'pr4', true, 1), // produto inativado depois do vínculo
  vinculo('v3', 'emp-1', 'c1', 'pr5', true, 3), // produto movido para a emp-2 depois do vínculo
  vinculo('v4', 'emp-1', 'c1', 'pr7', false, 2), // vínculo inativo, produto ativo da fazenda
  vinculo('v5', 'emp-1', 'c2', 'pr3', true, 1), // S500 na mesma fazenda
  vinculo('v6', 'emp-2', 'c1', 'pr6', true, 1), // mesmo tipo, OUTRA fazenda
  vinculo('v8', 'emp-1', 'c1', 'pr8', false, 1), // vínculo inativo de produto inativo
];

/** @type {{ combustiveis: any[], produtos: any[], vinculos: any[] }} */
let estado;
let backend;
let proxima;
let seq;

/** Vínculo como o servidor devolve: produto resolvido + `empresa_coerente`. */
const vinculoPublico = (v) => {
  const p = estado.produtos.find((x) => x.id === v.produto_id);
  return {
    id: v.id,
    empresa_id: v.empresa_id,
    tipo_combustivel_id: v.tipo_combustivel_id,
    ativo: v.ativo,
    versao: v.versao,
    produto: { id: p.id, nome: p.nome, codigo_interno: p.codigo_interno, unidade_principal_estoque: p.unidade_principal_estoque, ativo: p.ativo, empresa_coerente: p.empresa_id === v.empresa_id },
    created_date: v.created_date,
    updated_date: v.updated_date,
  };
};

/** Página de opções de 2 em 2 (keyset simulado pelo índice) para provar o "Carregar mais". */
const POR_PAGINA_FAKE = 2;

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
  estado = { combustiveis: COMBUSTIVEIS(), produtos: PRODUTOS(), vinculos: VINCULOS() };
  proxima = null;
  seq = 0;
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proxima && method !== 'GET') {
      const r = proxima;
      proxima = null;
      return r;
    }
    if (method === 'GET' && path === '/patrimonio-combustiveis') {
      const itens = estado.combustiveis.filter((c) => query.get('ativo') == null || String(c.ativo) === query.get('ativo'));
      return { status: 200, body: envelope(itens) };
    }
    const lista = /^\/patrimonio-combustiveis\/([^/]+)\/produtos$/.exec(path);
    if (lista && method === 'GET') {
      const itens = estado.vinculos.filter((v) => v.tipo_combustivel_id === lista[1] && v.empresa_id === query.get('empresa_id'));
      return { status: 200, body: envelope(itens.map(vinculoPublico)) };
    }
    if (lista && method === 'POST') {
      const tipo = estado.combustiveis.find((c) => c.id === lista[1]);
      const produto = estado.produtos.find((p) => p.id === body.produto_id && p.empresa_id === body.empresa_id && p.ativo);
      if (!tipo || !tipo.ativo || !produto) return erroServidor(422, 'COMBUSTIVEL_PRODUTO_INVALIDO', { reason: 'inexistente' });
      const mesmo = estado.vinculos.find((v) => v.empresa_id === body.empresa_id && v.tipo_combustivel_id === tipo.id && v.produto_id === produto.id);
      if (mesmo?.ativo) return erroServidor(409, 'COMBUSTIVEL_PRODUTO_DUPLICADO');
      if (mesmo) return erroServidor(409, 'COMBUSTIVEL_PRODUTO_DUPLICADO', { reason: 'inativo_reative', details: { vinculo_id: mesmo.id } });
      const outro = estado.vinculos.find((v) => v.empresa_id === body.empresa_id && v.produto_id === produto.id && v.ativo);
      if (outro) return erroServidor(409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', { details: { tipo_combustivel_id: outro.tipo_combustivel_id } });
      seq += 1;
      const novo = vinculo(`v-novo-${seq}`, body.empresa_id, tipo.id, produto.id, true, 1);
      estado.vinculos.unshift(novo);
      return { status: 201, body: vinculoPublico(novo) };
    }
    const item = /^\/patrimonio-combustivel-produtos\/([^/]+)$/.exec(path);
    if (item && method === 'PATCH') {
      const v = estado.vinculos.find((x) => x.id === item[1] && x.empresa_id === body.empresa_id);
      if (!v) return erroServidor(404, 'COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO');
      if (v.versao !== body.versao) return erroServidor(409, 'PATRIMONIO_VERSAO_CONFLITO');
      v.ativo = body.ativo;
      v.versao += 1;
      return { status: 200, body: vinculoPublico(v) };
    }
    if (method === 'GET' && path === '/patrimonio-combustiveis-opcoes/produtos') {
      const q = (query.get('q') || '').toLowerCase();
      const todos = estado.produtos
        .filter((p) => p.empresa_id === query.get('empresa_id') && p.ativo)
        .filter((p) => !q || p.nome.toLowerCase().includes(q))
        .sort((a, b) => a.nome.localeCompare(b.nome));
      const inicio = Number(query.get('cursor') || 0);
      const pagina = todos.slice(inicio, inicio + POR_PAGINA_FAKE).map((p) => {
        const ativo = estado.vinculos.find((v) => v.empresa_id === query.get('empresa_id') && v.produto_id === p.id && v.ativo);
        const tipo = ativo ? estado.combustiveis.find((c) => c.id === ativo.tipo_combustivel_id) : null;
        return { id: p.id, nome: p.nome, unidade_principal_estoque: p.unidade_principal_estoque, vinculo_ativo: ativo ? { tipo_combustivel_id: tipo.id, tipo_nome: tipo.nome } : null };
      });
      const temMais = inicio + POR_PAGINA_FAKE < todos.length;
      return { status: 200, body: { itens: pagina, has_more: temMais, next_cursor: temMais ? String(inicio + POR_PAGINA_FAKE) : null } };
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
  const { default: Pagina } = await import('@/pages/Combustiveis.jsx');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Pagina />
    </QueryClientProvider>,
  );
};

const mutacoes = () => backend.chamadas.filter((c) => c.method !== 'GET');
const leituras = (caminho) => backend.chamadas.filter((c) => c.method === 'GET' && c.path === caminho);
const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`combustivel-nome-${id}`));
  await screen.findByTestId('b1-form');
  return screen.findByTestId('combustivel-produtos');
};
const linha = (id) => screen.findByTestId(`combustivel-produto-${id}`);
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('Combustíveis — produtos vinculados nesta fazenda (leitura)', () => {
  it('lista só os vínculos do combustível NA fazenda selecionada: nome, unidade de estoque como está e situação', async () => {
    await montar();
    const secao = await abrir('c1');
    expect(within(secao).getByRole('heading', { name: 'Produtos vinculados nesta fazenda' })).toBeTruthy();

    const v1 = await linha('v1');
    expect(v1).toHaveTextContent('DIESEL S10 A GRANEL');
    expect(v1).toHaveTextContent('DS10G');
    expect(v1).toHaveTextContent('Unidade de estoque: KG');
    expect(within(v1).getByTestId('combustivel-produto-situacao-v1')).toHaveTextContent(/^Ativo$/);

    // Rastreabilidade: o vínculo continua na lista, rotulado, mas não é oferecido.
    expect(within(await linha('v2')).getByTestId('combustivel-produto-situacao-v2')).toHaveTextContent('Ativo · produto inativo · não é oferecido');
    expect(within(await linha('v3')).getByTestId('combustivel-produto-situacao-v3')).toHaveTextContent('Ativo · produto movido para outra fazenda · não é oferecido');
    expect(within(await linha('v4')).getByTestId('combustivel-produto-situacao-v4')).toHaveTextContent(/^Vínculo inativo$/);
    expect(within(await linha('v8')).getByTestId('combustivel-produto-situacao-v8')).toHaveTextContent('Vínculo inativo · produto inativo');
    expect(await linha('v8')).toHaveTextContent('Unidade de estoque: SACO');

    // Outro tipo e outra fazenda não aparecem.
    expect(screen.queryByTestId('combustivel-produto-v5')).toBeNull();
    expect(screen.queryByTestId('combustivel-produto-v6')).toBeNull();
    // Leitura com a empresa na query, sem filtro de situação (inativos também, para rastreabilidade).
    expect(leituras('/patrimonio-combustiveis/c1/produtos').map((c) => c.query)).toEqual([{ empresa_id: 'emp-1', limit: '50' }]);
  });

  it('estado vazio explícito: nenhum produto vinculado nesta fazenda', async () => {
    await montar();
    const secao = await abrir('c3');
    expect(await within(secao).findByText('Nenhum produto vinculado nesta fazenda.')).toBeTruthy();
    expect(leituras('/patrimonio-combustiveis/c3/produtos').map((c) => c.query)).toEqual([{ empresa_id: 'emp-1', limit: '50' }]);
  });

  it('sem empresa selecionada: aviso, nada lido e nada a vincular', async () => {
    window.localStorage.removeItem('empresa_selecionada_id');
    window.localStorage.removeItem('empresa_selecionada_cliente_id');
    await montar();
    const secao = await abrir('c1');
    expect(within(secao).getByTestId('combustivel-produtos-sem-empresa')).toHaveTextContent(/Selecione uma empresa \(fazenda\) no topo da tela/);
    await esperar();
    expect(backend.chamadas.filter((c) => c.path.includes('/produtos'))).toEqual([]);
    expect(within(secao).queryByRole('button', { name: 'Vincular produto' })).toBeNull();
  });

  it('em edição do combustível a seção sai (só no registro aberto em leitura)', async () => {
    await montar();
    await abrir('c1');
    await linha('v1');
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    await waitFor(() => expect(screen.queryByTestId('combustivel-produtos')).toBeNull());
  });
});

describe('Combustíveis — vincular produto', () => {
  it('seletor paginado só com produtos ativos da fazenda; o que já está em outro combustível aparece marcado e não pode; POST com o corpo exato', async () => {
    await montar();
    const secao = await abrir('c1');
    await linha('v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Vincular produto' }));
    fireEvent.click(await within(secao).findByTestId('combustivel-produto-seletor'));

    const granel = await within(secao).findByRole('option', { name: /DIESEL S10 A GRANEL/ });
    expect(granel).toHaveTextContent('já vinculado a este combustível');
    expect(within(secao).getByRole('option', { name: /DIESEL S10 POSTO/ })).toHaveTextContent('KG');
    fireEvent.click(within(secao).getByRole('button', { name: 'Carregar mais' }));
    const s500 = await within(secao).findByRole('option', { name: /DIESEL S500 BOMBA/ });
    expect(s500).toHaveTextContent('já vinculado a Diesel S500 — não pode');
    expect(within(secao).getByRole('option', { name: /DIESEL S10 TANQUE 2/ })).toBeTruthy();
    // Inativo e de outra fazenda nunca são oferecidos.
    expect(within(secao).queryByRole('option', { name: /ANTIGO|TRANSFERIDO|FAZENDA B/ })).toBeNull();
    expect(leituras('/patrimonio-combustiveis-opcoes/produtos').map((c) => c.query)).toEqual([
      { empresa_id: 'emp-1', limit: '50' },
      { empresa_id: 'emp-1', limit: '50', cursor: '2' },
    ]);

    // Escolher o que já está em outro combustível: motivo legível e nada é gravado.
    fireEvent.click(s500);
    expect(await within(secao).findByTestId('combustivel-produto-bloqueado')).toHaveTextContent(
      'DIESEL S500 BOMBA já está vinculado a Diesel S500 nesta fazenda: um produto só pode ter um combustível ativo. Inative aquele vínculo antes.',
    );
    expect(within(secao).getByRole('button', { name: 'Gravar vínculo' })).toBeDisabled();

    // Escolher um livre e gravar.
    fireEvent.click(within(secao).getByTestId('combustivel-produto-seletor'));
    fireEvent.click(await within(secao).findByRole('option', { name: /DIESEL S10 POSTO/ }));
    await waitFor(() => expect(within(secao).queryByTestId('combustivel-produto-bloqueado')).toBeNull());
    fireEvent.click(within(secao).getByRole('button', { name: 'Gravar vínculo' }));
    await screen.findByText('Produto vinculado');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', path: '/patrimonio-combustiveis/c1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pr2' } })]);
    // A lista relê a verdade do servidor e o painel fecha.
    expect(await linha('v-novo-1')).toHaveTextContent('DIESEL S10 POSTO');
    expect(within(secao).queryByRole('button', { name: 'Gravar vínculo' })).toBeNull();
  });

  it('busca vai ao servidor (q) com a empresa', async () => {
    await montar();
    const secao = await abrir('c1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Vincular produto' }));
    fireEvent.click(await within(secao).findByTestId('combustivel-produto-seletor'));
    await within(secao).findByRole('option', { name: /DIESEL S10 POSTO/ });
    fireEvent.change(within(secao).getByRole('searchbox'), { target: { value: 'tanque' } });
    await waitFor(() => expect(leituras('/patrimonio-combustiveis-opcoes/produtos').map((c) => c.query)).toContainEqual({ empresa_id: 'emp-1', q: 'tanque', limit: '50' }), { timeout: 2000 });
    expect(await within(secao).findByRole('option', { name: /DIESEL S10 TANQUE 2/ })).toBeTruthy();
  });

  it('409 COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO do servidor (corrida): mensagem, painel mantido e lista sem o produto', async () => {
    await montar();
    const secao = await abrir('c1');
    await linha('v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Vincular produto' }));
    fireEvent.click(await within(secao).findByTestId('combustivel-produto-seletor'));
    fireEvent.click(await within(secao).findByRole('option', { name: /DIESEL S10 POSTO/ }));
    proxima = erroServidor(409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', { details: { tipo_combustivel_id: 'c2' } });
    fireEvent.click(within(secao).getByRole('button', { name: 'Gravar vínculo' }));
    expect(
      await screen.findByText('Este produto já está vinculado a outro combustível nesta fazenda: um produto só pode ter um combustível ativo. Inative aquele vínculo antes. Nada foi gravado.'),
    ).toBeTruthy();
    expect(within(secao).getByRole('button', { name: 'Gravar vínculo' })).toBeTruthy();
    expect(screen.queryByText('Produto vinculado')).toBeNull();
    // A lista relida continua sem o produto (o painel mantém a escolha para a pessoa conferir).
    await waitFor(() => expect(leituras('/patrimonio-combustiveis/c1/produtos').length).toBeGreaterThan(1));
    expect(within(screen.getByTestId('combustivel-produtos-lista')).queryByText('DIESEL S10 POSTO')).toBeNull();
  });

  it('par já existe inativo: 409 inativo_reative orienta reativar o vínculo da lista', async () => {
    await montar();
    const secao = await abrir('c1');
    await linha('v4');
    fireEvent.click(within(secao).getByRole('button', { name: 'Vincular produto' }));
    fireEvent.click(await within(secao).findByTestId('combustivel-produto-seletor'));
    fireEvent.click(await within(secao).findByRole('button', { name: 'Carregar mais' }));
    fireEvent.click(await within(secao).findByRole('option', { name: /DIESEL S10 TANQUE 2/ }));
    fireEvent.click(within(secao).getByRole('button', { name: 'Gravar vínculo' }));
    expect(
      await screen.findByText('Este produto já foi vinculado a este combustível nesta fazenda e o vínculo está inativo: reative-o na lista. Nada foi gravado.'),
    ).toBeTruthy();
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'POST', body: { empresa_id: 'emp-1', produto_id: 'pr7' } })]);
  });

  it('cancelar a vinculação fecha o painel sem gravar', async () => {
    await montar();
    const secao = await abrir('c1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Vincular produto' }));
    fireEvent.click(await within(secao).findByTestId('combustivel-produto-seletor'));
    fireEvent.click(await within(secao).findByRole('option', { name: /DIESEL S10 POSTO/ }));
    fireEvent.click(within(secao).getByRole('button', { name: 'Cancelar vinculação' }));
    expect(within(secao).queryByRole('button', { name: 'Gravar vínculo' })).toBeNull();
    expect(within(secao).getByRole('button', { name: 'Vincular produto' })).toBeTruthy();
    expect(mutacoes()).toEqual([]);
  });

  it('combustível inativo: não oferece vincular nem reativar (o servidor exige combustível ativo)', async () => {
    estado.vinculos.push(vinculo('v9', 'emp-1', 'c9', 'pr2', false, 1));
    await montar();
    await screen.findByTestId('combustivel-nome-c1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    const secao = await abrir('c9');
    await linha('v9');
    expect(within(secao).getByTestId('combustivel-produtos-tipo-inativo')).toHaveTextContent('Combustível inativo: reative-o para vincular ou reativar produtos.');
    expect(within(secao).queryByRole('button', { name: 'Vincular produto' })).toBeNull();
    expect(within(await linha('v9')).queryByRole('button', { name: 'Reativar vínculo' })).toBeNull();
  });
});

describe('Combustíveis — inativar e reativar vínculo (ação "inativar")', () => {
  it('inativa com confirmação ({empresa_id, versao, ativo:false}); depois reativa outro ({empresa_id, versao, ativo:true})', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrir('c1');
    fireEvent.click(within(await linha('v1')).getByRole('button', { name: 'Inativar vínculo' }));
    await screen.findByText('Vínculo inativado');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/patrimonio-combustivel-produtos/v1', body: { empresa_id: 'emp-1', versao: 1, ativo: false } })]);
    await waitFor(() => expect(screen.getByTestId('combustivel-produto-situacao-v1')).toHaveTextContent(/^Vínculo inativo$/));

    fireEvent.click(within(await linha('v4')).getByRole('button', { name: 'Reativar vínculo' }));
    await screen.findByText('Vínculo reativado');
    expect(mutacoes().at(-1)).toEqual(expect.objectContaining({ method: 'PATCH', path: '/patrimonio-combustivel-produtos/v4', body: { empresa_id: 'emp-1', versao: 2, ativo: true } }));
    await waitFor(() => expect(screen.getByTestId('combustivel-produto-situacao-v4')).toHaveTextContent(/^Ativo$/));
  });

  it('vínculo ativo de produto inativo/movido pode ser inativado; inativo de produto inativo não oferece reativar', async () => {
    await montar();
    await abrir('c1');
    expect(within(await linha('v2')).getByRole('button', { name: 'Inativar vínculo' })).toBeTruthy();
    expect(within(await linha('v3')).getByRole('button', { name: 'Inativar vínculo' })).toBeTruthy();
    const v8 = await linha('v8');
    expect(within(v8).queryByRole('button', { name: 'Reativar vínculo' })).toBeNull();
    expect(within(v8).queryByRole('button', { name: 'Inativar vínculo' })).toBeNull();
  });

  it('cancelar a confirmação não grava', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await montar();
    await abrir('c1');
    fireEvent.click(within(await linha('v1')).getByRole('button', { name: 'Inativar vínculo' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await esperar();
    expect(mutacoes()).toEqual([]);
  });

  it('reativar com produto já ativo em outro combustível: 409 com a mensagem e nada muda', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrir('c1');
    proxima = erroServidor(409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', { details: { tipo_combustivel_id: 'c2' } });
    fireEvent.click(within(await linha('v4')).getByRole('button', { name: 'Reativar vínculo' }));
    expect(await screen.findByText(/já está vinculado a outro combustível nesta fazenda.*Nada foi gravado\./)).toBeTruthy();
    expect(screen.getByTestId('combustivel-produto-situacao-v4')).toHaveTextContent(/^Vínculo inativo$/);
    expect(screen.queryByText('Vínculo reativado')).toBeNull();
  });

  it('conflito de versão (409 PATRIMONIO_VERSAO_CONFLITO): mensagem e a lista é relida', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrir('c1');
    await linha('v1');
    const antes = leituras('/patrimonio-combustiveis/c1/produtos').length;
    estado.vinculos.find((v) => v.id === 'v1').versao = 5; // outra pessoa gravou
    fireEvent.click(within(await linha('v1')).getByRole('button', { name: 'Inativar vínculo' }));
    expect(await screen.findByText(/alterado por outra pessoa enquanto você editava.*Nada foi gravado\./)).toBeTruthy();
    await waitFor(() => expect(leituras('/patrimonio-combustiveis/c1/produtos').length).toBeGreaterThan(antes));
  });

  it('404 COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO: mensagem sem oráculo e a lista é relida', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrir('c1');
    await linha('v1');
    const antes = leituras('/patrimonio-combustiveis/c1/produtos').length;
    proxima = erroServidor(404, 'COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO');
    fireEvent.click(within(await linha('v1')).getByRole('button', { name: 'Inativar vínculo' }));
    expect(await screen.findByText('Vínculo de produto não encontrado nesta fazenda. A lista será atualizada.')).toBeTruthy();
    await waitFor(() => expect(leituras('/patrimonio-combustiveis/c1/produtos').length).toBeGreaterThan(antes));
  });
});

describe('Combustíveis — permissões da seção de produtos', () => {
  it('só visualizar: lista legível, sem vincular e sem inativar/reativar', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    const secao = await abrir('c1');
    await linha('v1');
    expect(within(secao).queryByRole('button', { name: 'Vincular produto' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Inativar vínculo' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Reativar vínculo' })).toBeNull();
  });

  it('novo sem inativar: vincula, mas não inativa/reativa (o servidor exige "inativar")', async () => {
    sessao.permissao = permissaoCom({ novo: true, editar: true, salvar: true });
    await montar();
    const secao = await abrir('c1');
    await linha('v1');
    expect(within(secao).getByRole('button', { name: 'Vincular produto' })).toBeTruthy();
    expect(within(secao).queryByRole('button', { name: 'Inativar vínculo' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Reativar vínculo' })).toBeNull();
  });

  it('inativar sem novo/salvar: inativa, mas não vincula', async () => {
    sessao.permissao = permissaoCom({ inativar: true });
    await montar();
    const secao = await abrir('c1');
    await linha('v1');
    expect(within(secao).queryByRole('button', { name: 'Vincular produto' })).toBeNull();
    expect(within(await linha('v1')).getByRole('button', { name: 'Inativar vínculo' })).toBeTruthy();
  });

  it('servidor nega (403 ACAO_NAO_PERMITIDA): mensagem de permissão e nada muda', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrir('c1');
    proxima = erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis', exige: ['pat-combustiveis:inativar'] } });
    fireEvent.click(within(await linha('v1')).getByRole('button', { name: 'Inativar vínculo' }));
    expect(await screen.findByText(/Você não tem permissão para esta ação nesta tela/)).toBeTruthy();
    expect(screen.getByTestId('combustivel-produto-situacao-v1')).toHaveTextContent(/^Ativo$/);
  });
});

describe('Mensagens dos códigos novos (patrimonioErros) — sempre "Nada foi gravado." quando grava', () => {
  /** Erro como o nativeHttpClient entrega um código não catalogado: corpo do servidor em `cause`. */
  const erroCom = (code, extra = {}) => Object.assign(new Error('OPERATION_FAILED'), { code: 'OPERATION_FAILED', cause: { code, message: 'texto do servidor', ...extra } });

  it.each([
    [{ code: 'COMBUSTIVEL_PRODUTO_INVALIDO', reason: 'inexistente' }, 'O produto escolhido não existe nesta fazenda (ou não está mais disponível). Atualize a lista e escolha outro. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_INVALIDO', reason: 'outra_empresa' }, 'O produto escolhido é de outra fazenda: só produtos desta fazenda podem ser vinculados. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_INVALIDO', reason: 'inativo' }, 'O produto escolhido está inativo: só produtos ativos podem ser vinculados. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_INVALIDO', field: 'tipo_combustivel_id', reason: 'tipo_inativo' }, 'O combustível está inativo (ou não existe mais): reative-o antes de vincular produtos. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_DUPLICADO' }, 'Este produto já está vinculado a este combustível nesta fazenda. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_DUPLICADO', reason: 'inativo_reative', details: { vinculo_id: 'v4' } }, 'Este produto já foi vinculado a este combustível nesta fazenda e o vínculo está inativo: reative-o na lista. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', details: { tipo_combustivel_id: 'c2' } }, 'Este produto já está vinculado a outro combustível nesta fazenda: um produto só pode ter um combustível ativo. Inative aquele vínculo antes. Nada foi gravado.'],
    [{ code: 'COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO' }, 'Vínculo de produto não encontrado nesta fazenda. A lista será atualizada.'],
    [{ code: 'PRODUTO_VINCULADO_COMBUSTIVEL' }, 'Este produto está vinculado a um combustível do Patrimônio nesta fazenda: ele não pode mudar de fazenda. Inative o vínculo na tela Combustíveis antes. Nada foi gravado.'],
  ])('%o', async (corpo, esperado) => {
    const { mensagemErroPatrimonio } = await import('@/lib/patrimonioErros');
    const { code, ...extra } = corpo;
    expect(mensagemErroPatrimonio(erroCom(code, extra), 'fallback')).toBe(esperado);
  });
});
