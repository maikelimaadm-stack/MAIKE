/**
 * UX-02 (D-PROD-160) — "Produtos associados nesta fazenda" no cadastro de
 * Combustíveis, montado de verdade (página, motor Base1, formulário, seção,
 * service, API, porta e nativeHttpClient reais). Mocks só da borda: `fetch`
 * (backend falso com as regras do contrato real: par único, um Produto um
 * combustível ativo, código do combustível único) e a sessão.
 *
 * O combustível é catálogo do TENANT; o Produto e a associação são da
 * FAZENDA. A criação escolhe os Produtos antes de salvar e associa cada um
 * pelos endpoints existentes (um POST por Produto, em sequência), com
 * resultado explícito: nunca "sucesso" se algum falhou; repetir só reenvia o
 * que falhou ao MESMO combustível e nunca recria o combustível.
 *
 * CB-01 seção nos dois modos · CB-02 associar 2 de uma vez · CB-03 novo com 2
 * Produtos · CB-04 falha parcial + "Tentar de novo" · CB-05 resposta perdida
 * do vínculo / `ja_vinculado` · CB-06 criação incerta · CB-07 troca de
 * fazenda · CB-08 sem fazenda · CB-09 permissões · CB-10 combustível inativo
 * · CB-11 Produto já de outro combustível · CB-12 textos de inativar/reativar
 * · CB-13 fazenda muda durante a associação da criação · CB-14 falha de
 * associação sobrevive à remontagem da seção (e o aviso diz onde vê-la) ·
 * CB-15 "Tentar de novo" com o painel aberto · CB-16 código que já existe
 * (nunca "criado" falso) · CB-17 resposta atrasada de um lote antigo não
 * apaga a falha de um lote novo (delta por lote).
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
const EMPRESAS = [
  { id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista' },
  { id: 'emp-2', numero_empresa: 2, nome: 'Fazenda Santa Rita' },
];
const COMBUSTIVEIS = () => [
  combustivel('c1', 'DIESEL_S10', 'Diesel S10'),
  combustivel('c2', 'DIESEL_S500', 'Diesel S500'),
  combustivel('c9', 'QUEROSENE', 'Querosene', { ativo: false, versao: 2 }),
];
/** Produtos REAIS do estoque, cada um de UMA fazenda. */
const PRODUTOS = () => [
  { id: 'pA', nome: 'DIESEL A GRANEL', codigo_interno: 'DAG', unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pB', nome: 'DIESEL ESTOQUE NOVO', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pC', nome: 'DIESEL POSTO', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pD', nome: 'DIESEL TANQUE 2', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pS', nome: 'S500 BOMBA', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-1' },
  { id: 'pX', nome: 'DIESEL FAZENDA B', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-2' },
  { id: 'pY', nome: 'GASOLINA FAZENDA B', codigo_interno: null, unidade_principal_estoque: 'KG', ativo: true, empresa_id: 'emp-2' },
];
const vinculo = (id, empresa_id, tipo_combustivel_id, produto_id, ativo, versao) => ({ id, empresa_id, tipo_combustivel_id, produto_id, ativo, versao, ...datas });
const VINCULOS = () => [
  vinculo('v1', 'emp-1', 'c1', 'pA', true, 1),
  vinculo('v7', 'emp-1', 'c1', 'pC', false, 2), // associação inativa (histórico preservado)
  vinculo('v5', 'emp-1', 'c2', 'pS', true, 1), // S500 na mesma fazenda
  vinculo('v6', 'emp-2', 'c1', 'pX', true, 1), // mesmo combustível, OUTRA fazenda
];

/** @type {{ combustiveis: any[], produtos: any[], vinculos: any[] }} */
let estado;
let backend;
/**
 * Ganchos por chamada (consumidos em ordem):
 *  - combustivel: POST /patrimonio-combustiveis → `{ modo: 'gravar-e-perder' | 'perder' }`, `{ esperar: Promise }`
 *    e/ou `{ antes: () => void }` (roda antes de gravar: outra pessoa grava no meio);
 *  - vinculo: POST /patrimonio-combustiveis/:id/produtos → `{ modo: 'gravar-e-perder' | 'perder' }`, `{ resposta }`
 *    e/ou `{ esperar: Promise }` (segura a resposta até liberar);
 *  - listaCombustiveisCai: GET da lista do catálogo responde 503;
 *  - buscasQueCaem: quantas buscas por texto (`q`) na lista do catálogo respondem 503 (uma a uma).
 */
let ganchos;
let seqCombustivel;
let seqVinculo;

const perderResposta = () => {
  throw new TypeError('Failed to fetch');
};

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

/** Regras do POST real do vínculo (combustivelProdutoService). */
const vincularNoFake = (tipoId, body) => {
  const tipo = estado.combustiveis.find((c) => c.id === tipoId);
  if (!tipo) return erroServidor(404, 'COMBUSTIVEL_NAO_ENCONTRADO');
  if (!tipo.ativo) return erroServidor(422, 'COMBUSTIVEL_PRODUTO_INVALIDO', { field: 'tipo_combustivel_id', reason: 'tipo_inativo' });
  const produto = estado.produtos.find((p) => p.id === body.produto_id && p.empresa_id === body.empresa_id && p.ativo);
  if (!produto) return erroServidor(422, 'COMBUSTIVEL_PRODUTO_INVALIDO', { field: 'produto_id', reason: 'inexistente' });
  const mesmo = estado.vinculos.find((v) => v.empresa_id === body.empresa_id && v.tipo_combustivel_id === tipo.id && v.produto_id === produto.id);
  if (mesmo?.ativo) return erroServidor(409, 'COMBUSTIVEL_PRODUTO_DUPLICADO', { field: 'produto_id', reason: 'ja_vinculado' });
  if (mesmo) return erroServidor(409, 'COMBUSTIVEL_PRODUTO_DUPLICADO', { field: 'produto_id', reason: 'inativo_reative', details: { vinculo_id: mesmo.id } });
  const outro = estado.vinculos.find((v) => v.empresa_id === body.empresa_id && v.produto_id === produto.id && v.ativo);
  if (outro) return erroServidor(409, 'COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', { field: 'produto_id', reason: 'vinculado_a_outro_tipo', details: { tipo_combustivel_id: outro.tipo_combustivel_id } });
  seqVinculo += 1;
  const novo = vinculo(`vn-${seqVinculo}`, body.empresa_id, tipo.id, produto.id, true, 1);
  estado.vinculos.unshift(novo);
  return { status: 201, body: vinculoPublico(novo) };
};

const criarCombustivelNoFake = (body) => {
  if (estado.combustiveis.some((c) => c.codigo === body.codigo)) return erroServidor(409, 'PATRIMONIO_CODIGO_DUPLICADO', { field: 'codigo' });
  seqCombustivel += 1;
  const criado = { id: `novo-${seqCombustivel}`, descricao: null, ...body, ativo: true, versao: 1, ...datas };
  estado.combustiveis.push(criado);
  return { status: 201, body: criado };
};

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
  ganchos = { combustivel: [], vinculo: [], listaCombustiveisCai: false, buscasQueCaem: 0 };
  seqCombustivel = 0;
  seqVinculo = 0;
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (method === 'GET' && path === '/empresas') return { status: 200, body: EMPRESAS };
    if (method === 'GET' && path === '/patrimonio-combustiveis') {
      if (ganchos.listaCombustiveisCai) return { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'x', request_id: 'r' } };
      if (query.get('q') && ganchos.buscasQueCaem > 0) {
        ganchos.buscasQueCaem -= 1;
        return { status: 503, body: { code: 'SERVICE_UNAVAILABLE', message: 'x', request_id: 'r' } };
      }
      const q = (query.get('q') || '').toLowerCase();
      const itens = estado.combustiveis
        .filter((c) => query.get('ativo') == null || String(c.ativo) === query.get('ativo'))
        .filter((c) => !q || c.codigo.toLowerCase().includes(q) || c.nome.toLowerCase().includes(q));
      return { status: 200, body: envelope(itens) };
    }
    if (method === 'POST' && path === '/patrimonio-combustiveis') {
      const g = ganchos.combustivel.shift();
      if (g?.esperar) await g.esperar;
      g?.antes?.();
      if (g?.modo === 'perder') perderResposta();
      const r = criarCombustivelNoFake(body);
      if (g?.modo === 'gravar-e-perder') perderResposta();
      return r;
    }
    const detalhe = /^\/patrimonio-combustiveis\/([^/]+)$/.exec(path);
    if (detalhe && method === 'GET') {
      const c = estado.combustiveis.find((x) => x.id === detalhe[1]);
      return c ? { status: 200, body: c } : erroServidor(404, 'COMBUSTIVEL_NAO_ENCONTRADO');
    }
    const lista = /^\/patrimonio-combustiveis\/([^/]+)\/produtos$/.exec(path);
    if (lista && method === 'GET') {
      const itens = estado.vinculos
        .filter((v) => v.tipo_combustivel_id === lista[1] && v.empresa_id === query.get('empresa_id'))
        .filter((v) => query.get('ativo') == null || String(v.ativo) === query.get('ativo'));
      return { status: 200, body: envelope(itens.map(vinculoPublico)) };
    }
    if (lista && method === 'POST') {
      const g = ganchos.vinculo.shift();
      if (g?.esperar) await g.esperar;
      if (g?.resposta) return g.resposta;
      if (g?.modo === 'perder') perderResposta();
      const r = vincularNoFake(lista[1], body);
      if (g?.modo === 'gravar-e-perder') perderResposta();
      return r;
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
      const itens = estado.produtos
        .filter((p) => p.empresa_id === query.get('empresa_id') && p.ativo)
        .filter((p) => !q || p.nome.toLowerCase().includes(q))
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .map((p) => {
          const ativo = estado.vinculos.find((v) => v.empresa_id === query.get('empresa_id') && v.produto_id === p.id && v.ativo);
          const tipo = ativo ? estado.combustiveis.find((c) => c.id === ativo.tipo_combustivel_id) : null;
          return { id: p.id, nome: p.nome, unidade_principal_estoque: p.unidade_principal_estoque, vinculo_ativo: ativo ? { tipo_combustivel_id: tipo.id, tipo_nome: tipo.nome } : null };
        });
      return { status: 200, body: { itens, has_more: false, next_cursor: null } };
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
const postsCombustivel = () => mutacoes().filter((c) => c.method === 'POST' && c.path === '/patrimonio-combustiveis');
const postsVinculo = () => mutacoes().filter((c) => c.method === 'POST' && /\/produtos$/.test(c.path));
const leituras = (caminho) => backend.chamadas.filter((c) => c.method === 'GET' && c.path === caminho);
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

const abrir = async (id) => {
  fireEvent.doubleClick(await screen.findByTestId(`combustivel-nome-${id}`));
  await screen.findByTestId('b1-form');
  return screen.findByTestId('combustivel-produtos');
};
const novo = async () => {
  await screen.findByTestId('combustivel-nome-c1');
  fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
  return screen.findByTestId('b1-form');
};
const preencher = (form, codigo, nome) => {
  fireEvent.change(within(form).getByLabelText(/^Código/), { target: { value: codigo } });
  fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: nome } });
};
/** Escolhe um Produto no seletor (abre o seletor de novo a cada escolha). */
const escolherNo = async (raiz, testIdSeletor, nome) => {
  if (!within(raiz).queryByTestId(`${testIdSeletor}-painel`)) fireEvent.click(within(raiz).getByTestId(testIdSeletor));
  fireEvent.click(await within(raiz).findByRole('option', { name: nome }));
};
const escolherNoNovo = (form, nome) => escolherNo(form, 'combustivel-novo-produto-seletor', nome);
const escolherNaSecao = (secao, nome) => escolherNo(secao, 'combustivel-produto-seletor', nome);
/** Troca a fazenda no topo da tela (mesmo caminho do seletor do Layout). */
const trocarFazenda = async (emp) => {
  const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
  act(() => persistirEmpresaSelecionada(emp, 'cli-1'));
};
const MSG_403 = 'Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.';
const MSG_JA_EXISTE = 'Já existe um combustível com este código. Confira a lista; nada foi criado nem associado.';

describe('CB-01 — seção "Produtos associados nesta fazenda" no registro gravado', () => {
  it('leitura e edição: fazenda pelo nome, Associados e Inativos com o nome real do Produto; nada da outra fazenda', async () => {
    await montar();
    const secao = await abrir('c1');
    expect(within(secao).getByRole('heading', { name: 'Produtos associados nesta fazenda' })).toBeTruthy();
    expect(await within(secao).findByTestId('combustivel-produtos-fazenda')).toHaveTextContent('Fazenda: Fazenda Boa Vista');
    const associados = await within(secao).findByTestId('combustivel-produtos-associados');
    expect(within(associados).getByTestId('combustivel-produto-v1')).toHaveTextContent('DIESEL A GRANEL');
    expect(secao).toHaveTextContent('Associados (1)');
    expect(within(within(secao).getByTestId('combustivel-produtos-inativos')).getByTestId('combustivel-produto-v7')).toHaveTextContent('DIESEL POSTO');
    expect(within(secao).getByTestId('combustivel-produto-situacao-v7')).toHaveTextContent(/^Associação inativa$/);
    expect(within(secao).queryByText('DIESEL FAZENDA B')).toBeNull();
    // O tipo de combustível não vira rótulo do Produto: o nome é o do estoque.
    expect(within(associados).queryByText('Diesel S10')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(await screen.findByTestId('combustivel-produtos-aviso-edicao')).toHaveTextContent('As associações são gravadas na hora, independentemente do botão Salvar.');
    const emEdicao = screen.getByTestId('combustivel-produtos');
    expect(within(emEdicao).getByTestId('combustivel-produto-v1')).toBeTruthy();
    expect(within(emEdicao).getByTestId('combustivel-produto-v7')).toBeTruthy();
    expect(within(emEdicao).getByRole('button', { name: 'Associar produtos' })).toBeTruthy();
  });
});

describe('CB-02 — associar vários de uma vez (registro gravado)', () => {
  it('2 Produtos: 2 POST em sequência com o corpo EXATO, um só aviso de sucesso e os dois em "Associados"', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    await escolherNaSecao(secao, /DIESEL TANQUE 2/);
    // Escolher de novo o mesmo não repete.
    await escolherNaSecao(secao, /DIESEL TANQUE 2/);
    expect(within(within(secao).getByTestId('combustivel-produto-pendentes')).getAllByRole('listitem')).toHaveLength(2);
    // Remover e devolver (botão com nome acessível).
    fireEvent.click(within(secao).getByRole('button', { name: 'Remover DIESEL TANQUE 2' }));
    expect(within(secao).queryByTestId('combustivel-produto-pendente-pD')).toBeNull();
    await escolherNaSecao(secao, /DIESEL TANQUE 2/);

    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 2 produto(s)' }));
    expect(await screen.findByText('2 produtos associados')).toBeTruthy();
    expect(postsVinculo().map((c) => ({ path: c.path, body: c.body }))).toEqual([
      { path: '/patrimonio-combustiveis/c1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pB' } },
      { path: '/patrimonio-combustiveis/c1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pD' } },
    ]);
    await waitFor(() => expect(within(screen.getByTestId('combustivel-produtos')).getByText('Associados (3)')).toBeTruthy());
    const associados = screen.getByTestId('combustivel-produtos-associados');
    expect(associados).toHaveTextContent('DIESEL ESTOQUE NOVO');
    expect(associados).toHaveTextContent('DIESEL TANQUE 2');
  });
});

describe('CB-03 — novo combustível já com os Produtos', () => {
  it('1 POST do combustível (corpo de sempre) + 1 POST por Produto com o id novo; aviso "criado com 2 produto(s)"', async () => {
    await montar();
    const form = await novo();
    const grupo = within(form).getByRole('group', { name: 'Produtos associados nesta fazenda' });
    expect(await within(grupo).findByText('Fazenda: Fazenda Boa Vista')).toBeTruthy();
    expect(grupo).toHaveTextContent(
      'Escolha os Produtos do estoque desta fazenda que são este combustível. Eles são associados logo depois de salvar. No abastecimento, quem abastece escolhe o Produto; o combustível só define quais tanques o aceitam.',
    );
    preencher(form, 'diesel_s10_aditivado', 'Diesel S10 aditivado');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    await escolherNoNovo(form, /DIESEL TANQUE 2/);
    expect(within(form).getByTestId('combustivel-novo-pendente-pB')).toHaveTextContent('DIESEL ESTOQUE NOVO');
    expect(within(form).getByTestId('combustivel-novo-pendente-pD')).toHaveTextContent('DIESEL TANQUE 2');
    // Nada é gravado antes de salvar.
    expect(mutacoes()).toEqual([]);

    salvar();
    expect(await screen.findByText('Combustível criado com 2 produto(s) associado(s) nesta fazenda')).toBeTruthy();
    expect(mutacoes().map((c) => ({ method: c.method, path: c.path, body: c.body }))).toEqual([
      { method: 'POST', path: '/patrimonio-combustiveis', body: { codigo: 'DIESEL_S10_ADITIVADO', nome: 'Diesel S10 aditivado', unidade: 'L' } },
      { method: 'POST', path: '/patrimonio-combustiveis/novo-1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pB' } },
      { method: 'POST', path: '/patrimonio-combustiveis/novo-1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pD' } },
    ]);
    // O registro criado abre com as associações lidas do servidor.
    const secao = await screen.findByTestId('combustivel-produtos');
    await waitFor(() => expect(within(secao).getByText('Associados (2)')).toBeTruthy());
    expect(within(secao).queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
  });
});

describe('CB-04 — falha parcial na criação: resultado explícito e repetição só do que falhou', () => {
  it('2º Produto preso a outro combustível (corrida): nunca sucesso, "Não associados (1)" e "Tentar de novo" manda SÓ ele ao MESMO combustível', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_b', 'Diesel S10 B');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    await escolherNoNovo(form, /DIESEL TANQUE 2/);
    // Outra pessoa associa o "DIESEL TANQUE 2" ao S500 enquanto o formulário está aberto.
    estado.vinculos.push(vinculo('v-corrida', 'emp-1', 'c2', 'pD', true, 1));
    salvar();
    expect(await screen.findByText('Combustível criado, mas 1 de 2 produto(s) não foram associados. Veja "Não associados" e tente de novo.')).toBeTruthy();
    expect(screen.queryByText('Sucesso')).toBeNull();
    expect(screen.queryByText(/Combustível criado com/)).toBeNull();

    const secao = await screen.findByTestId('combustivel-produtos');
    const bloco = within(secao).getByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent('DIESEL TANQUE 2: Este produto já está vinculado a outro combustível nesta fazenda');
    expect(bloco).not.toHaveTextContent('DIESEL ESTOQUE NOVO');
    await waitFor(() => expect(within(secao).getByText('Associados (1)')).toBeTruthy());

    // Resolve a corrida (inativa a outra associação) e repete: SÓ o que falhou, ao MESMO combustível.
    estado.vinculos.find((v) => v.id === 'v-corrida').ativo = false;
    fireEvent.click(within(bloco).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Produto associado')).toBeTruthy();
    expect(postsCombustivel()).toHaveLength(1);
    expect(postsVinculo().map((c) => ({ path: c.path, body: c.body }))).toEqual([
      { path: '/patrimonio-combustiveis/novo-1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pB' } },
      { path: '/patrimonio-combustiveis/novo-1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pD' } },
      { path: '/patrimonio-combustiveis/novo-1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pD' } },
    ]);
    await waitFor(() => expect(within(secao).queryByTestId('combustivel-produtos-nao-associados')).toBeNull());
    await waitFor(() => expect(within(secao).getByText('Associados (2)')).toBeTruthy());
  });

  it('"Descartar" fecha o bloco sem gravar nada', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_c', 'Diesel S10 C');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.vinculo.push({ resposta: erroServidor(422, 'COMBUSTIVEL_PRODUTO_INVALIDO', { field: 'produto_id', reason: 'inativo' }) });
    salvar();
    const bloco = await screen.findByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('DIESEL ESTOQUE NOVO: O produto escolhido está inativo: só produtos ativos podem ser vinculados. Nada foi gravado.');
    const antes = mutacoes().length;
    fireEvent.click(within(bloco).getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
    await esperar();
    expect(mutacoes()).toHaveLength(antes);
  });
});

describe('CB-05 — vínculo com resposta perdida e repetição idempotente', () => {
  it('gravado e resposta perdida: relê os ativos e conta como associado, sem 2º POST', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    ganchos.vinculo.push({ modo: 'gravar-e-perder' });
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    expect(await screen.findByText('Produto associado')).toBeTruthy();
    expect(postsVinculo()).toHaveLength(1);
    // A confirmação leu os vínculos ATIVOS do combustível na fazenda.
    expect(leituras('/patrimonio-combustiveis/c1/produtos').map((c) => c.query)).toContainEqual({ empresa_id: 'emp-1', ativo: 'true', limit: '100' });
    expect(within(screen.getByTestId('combustivel-produtos')).queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
  });

  it('não gravado e resposta perdida: falha "incerta" (sem sucesso); "Tentar de novo" grava uma vez', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    ganchos.vinculo.push({ modo: 'perder' });
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    const bloco = await within(secao).findByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('DIESEL ESTOQUE NOVO: A resposta do servidor não chegou e não foi possível confirmar a associação. Tente de novo: repetir não duplica.');
    expect(screen.queryByText('Sucesso')).toBeNull();
    fireEvent.click(within(bloco).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Produto associado')).toBeTruthy();
    expect(estado.vinculos.filter((v) => v.produto_id === 'pB' && v.tipo_combustivel_id === 'c1')).toHaveLength(1);
  });

  it('repetir o que outra pessoa já associou: 409 ja_vinculado → relê → conta como associado (nada duplica)', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    await escolherNaSecao(secao, /DIESEL TANQUE 2/);
    // Outra pessoa associou o "DIESEL TANQUE 2" a ESTE combustível depois que as opções foram lidas.
    estado.vinculos.push(vinculo('v-outro', 'emp-1', 'c1', 'pD', true, 1));
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 2 produto(s)' }));
    expect(await screen.findByText('2 produtos associados')).toBeTruthy();
    expect(postsVinculo()).toHaveLength(2);
    expect(estado.vinculos.filter((v) => v.produto_id === 'pD' && v.tipo_combustivel_id === 'c1')).toHaveLength(1);
  });

  it('service: associarProdutosAoCombustivel nunca lança e devolve o resultado por Produto', async () => {
    const { associarProdutosAoCombustivel } = await import('@/services/combustivelProdutoService');
    ganchos.vinculo.push({}, { resposta: erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis' } }) });
    const r = await associarProdutosAoCombustivel('emp-1', 'c1', [
      { id: 'pA', nome: 'DIESEL A GRANEL' }, // já associado: 409 ja_vinculado → associado
      { id: 'pB', nome: 'DIESEL ESTOQUE NOVO' }, // 403
      { id: 'pB', nome: 'DIESEL ESTOQUE NOVO' }, // repetido na entrada: enviado uma vez
    ]);
    expect(r.associados).toEqual([{ id: 'pA', nome: 'DIESEL A GRANEL' }]);
    expect(r.falhas).toEqual([
      { id: 'pB', nome: 'DIESEL ESTOQUE NOVO', codigo: 'ACAO_NAO_PERMITIDA', mensagem: 'Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.' },
    ]);
    expect(postsVinculo()).toHaveLength(2);
    const semEmpresa = await associarProdutosAoCombustivel(null, 'c1', [{ id: 'pB', nome: 'X' }]);
    expect(semEmpresa.associados).toEqual([]);
    expect(semEmpresa.falhas[0].codigo).toBe('SEM_EMPRESA');
    expect(postsVinculo()).toHaveLength(2);
  });
});

describe('CB-06 — criação do combustível com resultado incerto', () => {
  it('gravado e resposta perdida: localiza pelo código e associa, sem 2º POST de combustível', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_d', 'Diesel S10 D');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.combustivel.push({ modo: 'gravar-e-perder' });
    salvar();
    expect(
      await screen.findByText('Combustível criado com 1 produto(s) associado(s) nesta fazenda. A resposta do servidor não chegou, mas o combustível foi gravado.'),
    ).toBeTruthy();
    expect(postsCombustivel()).toHaveLength(1);
    expect(leituras('/patrimonio-combustiveis').some((c) => c.query.q === 'DIESEL_S10_D')).toBe(true);
    expect(postsVinculo().map((c) => ({ path: c.path, body: c.body }))).toEqual([{ path: '/patrimonio-combustiveis/novo-1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pB' } }]);
    expect(estado.combustiveis.filter((c) => c.codigo === 'DIESEL_S10_D')).toHaveLength(1);
  });

  it('não gravado: "O combustível não foi gravado. Salve de novo." — o formulário fica com os Produtos; salvar de novo cria uma vez e associa', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_e', 'Diesel S10 E');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.combustivel.push({ modo: 'perder' });
    salvar();
    expect(await screen.findByText('O combustível não foi gravado. Salve de novo.')).toBeTruthy();
    expect(postsVinculo()).toEqual([]);
    const aberto = screen.getByTestId('b1-form');
    expect(within(aberto).getByTestId('combustivel-novo-pendente-pB')).toBeTruthy();
    salvar();
    expect(await screen.findByText('Combustível criado com 1 produto(s) associado(s) nesta fazenda')).toBeTruthy();
    expect(postsCombustivel()).toHaveLength(2);
    expect(estado.combustiveis.filter((c) => c.codigo === 'DIESEL_S10_E')).toHaveLength(1);
    expect(postsVinculo()).toHaveLength(1);
  });

  it('a conferência também falha: pede para conferir a lista (o código não se repete) e não associa nada', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_f', 'Diesel S10 F');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.combustivel.push({ modo: 'gravar-e-perder' });
    ganchos.listaCombustiveisCai = true;
    salvar();
    expect(
      await screen.findByText('Não foi possível confirmar se o combustível foi gravado. Confira a lista antes de salvar de novo: o código não se repete.'),
    ).toBeTruthy();
    expect(postsVinculo()).toEqual([]);
    expect(screen.queryByText('Sucesso')).toBeNull();
    expect(within(screen.getByTestId('b1-form')).getByTestId('combustivel-novo-pendente-pB')).toBeTruthy();
  });
});

describe('CB-07 — troca de fazenda', () => {
  it('no cadastro novo: os Produtos escolhidos saem com aviso; o seletor passa a ler só a fazenda nova', async () => {
    await montar();
    const form = await novo();
    await within(form).findByText('Fazenda: Fazenda Boa Vista');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    expect(within(form).getByTestId('combustivel-novo-pendente-pB')).toBeTruthy();
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    expect(await within(form).findByTestId('combustivel-novo-fazenda-mudou')).toHaveTextContent(
      'A fazenda mudou: os Produtos escolhidos eram da fazenda anterior e foram retirados. Escolha de novo.',
    );
    expect(within(form).queryByTestId('combustivel-novo-pendente-pB')).toBeNull();
    expect(await within(form).findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
    fireEvent.click(within(form).getByTestId('combustivel-novo-produto-seletor'));
    expect(await within(form).findByRole('option', { name: /DIESEL FAZENDA B/ })).toHaveTextContent('já associado a Diesel S10 — não pode');
    expect(within(form).queryByRole('option', { name: /DIESEL ESTOQUE NOVO/ })).toBeNull();
    fireEvent.click(within(form).getByRole('option', { name: /GASOLINA FAZENDA B/ }));
    expect(within(form).queryByTestId('combustivel-novo-fazenda-mudou')).toBeNull();
    preencher(form, 'gasolina_b', 'Gasolina B');
    salvar();
    expect(await screen.findByText('Combustível criado com 1 produto(s) associado(s) nesta fazenda')).toBeTruthy();
    expect(postsVinculo().map((c) => c.body)).toEqual([{ empresa_id: 'emp-2', produto_id: 'pY' }]);
  });

  it('fazenda trocada ENQUANTO salva: o combustível é criado, nenhum Produto é associado e o aviso diz por quê (nunca sucesso)', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_g', 'Diesel S10 G');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    let liberar;
    ganchos.combustivel.push({ esperar: new Promise((r) => { liberar = r; }) });
    salvar();
    await waitFor(() => expect(postsCombustivel()).toHaveLength(1));
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    await act(async () => { liberar(); });
    expect(
      await screen.findByText('Combustível criado, mas nenhum Produto foi associado. A fazenda mudou: os Produtos escolhidos eram da fazenda anterior e foram retirados. Escolha de novo.'),
    ).toBeTruthy();
    expect(postsVinculo()).toEqual([]);
    expect(screen.queryByText('Sucesso')).toBeNull();
  });

  it('no registro aberto: a seção zera e relê só a fazenda nova', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    const nova = await screen.findByTestId('combustivel-produto-v6');
    expect(nova).toHaveTextContent('DIESEL FAZENDA B');
    expect(screen.queryByTestId('combustivel-produto-v1')).toBeNull();
    expect(screen.queryByTestId('combustivel-produto-v7')).toBeNull();
    expect(await screen.findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
    expect(leituras('/patrimonio-combustiveis/c1/produtos').map((c) => c.query.empresa_id)).toEqual(['emp-1', 'emp-2']);
  });
});

describe('CB-08 — sem fazenda selecionada', () => {
  it('cadastro novo: aviso, nenhum Produto lido; salva só o combustível ("Combustível criado") e nenhum POST de vínculo', async () => {
    window.localStorage.removeItem('empresa_selecionada_id');
    window.localStorage.removeItem('empresa_selecionada_cliente_id');
    await montar();
    const form = await novo();
    expect(within(form).getByTestId('combustivel-novo-sem-empresa')).toHaveTextContent(
      'Selecione uma fazenda no topo da tela para associar Produtos. O combustível pode ser salvo sem Produtos e associado depois.',
    );
    expect(within(form).queryByTestId('combustivel-novo-produto-seletor')).toBeNull();
    preencher(form, 'biodiesel', 'Biodiesel');
    salvar();
    expect(await screen.findByText('Combustível criado')).toBeTruthy();
    expect(mutacoes().map((c) => ({ path: c.path, body: c.body }))).toEqual([{ path: '/patrimonio-combustiveis', body: { codigo: 'BIODIESEL', nome: 'Biodiesel', unidade: 'L' } }]);
    expect(backend.chamadas.filter((c) => c.path.includes('/produtos') || c.path === '/empresas')).toEqual([]);
  });
});

describe('CB-09 — permissões', () => {
  it('só visualizar: lista legível, sem Novo, sem "Associar produtos", sem inativar/reativar', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Associar produtos' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Inativar associação' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Reativar associação' })).toBeNull();
  });

  it('criar sem inativar: associa (e o cadastro novo oferece Produtos), mas não inativa/reativa', async () => {
    sessao.permissao = permissaoCom({ novo: true, editar: true, salvar: true });
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    expect(within(secao).getByRole('button', { name: 'Associar produtos' })).toBeTruthy();
    expect(within(secao).queryByRole('button', { name: 'Inativar associação' })).toBeNull();
    expect(within(secao).queryByRole('button', { name: 'Reativar associação' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    expect(await screen.findByTestId('combustivel-novo-produto-seletor')).toBeTruthy();
  });

  it('inativar sem criar: inativa, mas não associa', async () => {
    sessao.permissao = permissaoCom({ inativar: true });
    await montar();
    const secao = await abrir('c1');
    expect(within(await within(secao).findByTestId('combustivel-produto-v1')).getByRole('button', { name: 'Inativar associação' })).toBeTruthy();
    expect(within(secao).getByTestId('combustivel-produto-v7')).toContainElement(within(secao).getByRole('button', { name: 'Reativar associação' }));
    expect(within(secao).queryByRole('button', { name: 'Associar produtos' })).toBeNull();
  });

  it('servidor nega (403) a associação na criação: combustível criado, aviso sem sucesso e o motivo em "Não associados"', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_h', 'Diesel S10 H');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.vinculo.push({ resposta: erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis', exige: ['pat-combustiveis:novo'] } }) });
    salvar();
    expect(await screen.findByText('Combustível criado, mas 1 de 1 produto(s) não foram associados. Veja "Não associados" e tente de novo.')).toBeTruthy();
    expect(await screen.findByTestId('combustivel-produtos-nao-associados')).toHaveTextContent(
      'DIESEL ESTOQUE NOVO: Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.',
    );
    expect(screen.queryByText('Sucesso')).toBeNull();
  });
});

describe('CB-10 — combustível inativo', () => {
  it('sem "Associar produtos" nem "Reativar associação"; a associação ativa ainda pode ser inativada', async () => {
    estado.vinculos.push(vinculo('v9', 'emp-1', 'c9', 'pB', false, 1), vinculo('v10', 'emp-1', 'c9', 'pD', true, 1));
    await montar();
    await screen.findByTestId('combustivel-nome-c1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    const secao = await abrir('c9');
    await within(secao).findByTestId('combustivel-produto-v9');
    expect(within(secao).getByTestId('combustivel-produtos-tipo-inativo')).toHaveTextContent('Combustível inativo: reative-o para associar ou reativar produtos.');
    expect(within(secao).queryByRole('button', { name: 'Associar produtos' })).toBeNull();
    expect(within(within(secao).getByTestId('combustivel-produto-v9')).queryByRole('button', { name: 'Reativar associação' })).toBeNull();
    expect(within(within(secao).getByTestId('combustivel-produto-v10')).getByRole('button', { name: 'Inativar associação' })).toBeTruthy();
  });
});

describe('CB-11 — Produto já associado a outro combustível nesta fazenda', () => {
  it('no cadastro novo aparece marcado, mostra o motivo e não entra em "A associar"', async () => {
    await montar();
    const form = await novo();
    fireEvent.click(within(form).getByTestId('combustivel-novo-produto-seletor'));
    const s500 = await within(form).findByRole('option', { name: /S500 BOMBA/ });
    expect(s500).toHaveTextContent('já associado a Diesel S500 — não pode');
    // Combustível ainda não criado: o já associado ao S10 também é "de outro".
    expect(within(form).getByRole('option', { name: /DIESEL A GRANEL/ })).toHaveTextContent('já associado a Diesel S10 — não pode');
    fireEvent.click(s500);
    expect(await within(form).findByTestId('combustivel-novo-bloqueado')).toHaveTextContent(
      'S500 BOMBA já está associado a Diesel S500 nesta fazenda: um Produto só pode ter um combustível ativo. Inative aquela associação antes.',
    );
    expect(within(form).queryByTestId('combustivel-novo-pendente-pS')).toBeNull();
    expect(within(form).getByText('A associar (0)')).toBeTruthy();
    // Um livre limpa o motivo e entra.
    await escolherNoNovo(form, /DIESEL POSTO/);
    expect(within(form).queryByTestId('combustivel-novo-bloqueado')).toBeNull();
    expect(within(form).getByText('A associar (1)')).toBeTruthy();
  });

  it('no registro aberto o já associado a ESTE combustível também não entra', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL A GRANEL/);
    expect(await within(secao).findByTestId('combustivel-produto-bloqueado')).toHaveTextContent('DIESEL A GRANEL já está associado a este combustível nesta fazenda.');
    expect(within(secao).getByRole('button', { name: 'Associar 0 produto(s)' })).toBeDisabled();
  });
});

describe('CB-12 — inativar e reativar valem para o futuro (histórico intacto)', () => {
  it('textos da confirmação e dos avisos; corpo exato do PATCH', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    const secao = await abrir('c1');
    fireEvent.click(within(await within(secao).findByTestId('combustivel-produto-v1')).getByRole('button', { name: 'Inativar associação' }));
    expect(await screen.findByText('Associação inativada')).toBeTruthy();
    expect(confirmSpy).toHaveBeenLastCalledWith(
      'Inativar a associação de "DIESEL A GRANEL" com Diesel S10? Ele deixa de ser oferecido nos próximos abastecimentos desta fazenda. Abastecimentos já lançados não mudam e nada é apagado.',
    );
    fireEvent.click(within(screen.getByTestId('combustivel-produto-v7')).getByRole('button', { name: 'Reativar associação' }));
    expect(await screen.findByText('Associação reativada')).toBeTruthy();
    expect(confirmSpy).toHaveBeenLastCalledWith('Reativar a associação de "DIESEL POSTO" com Diesel S10? Ele volta a ser oferecido nos próximos abastecimentos desta fazenda.');
    expect(mutacoes().map((c) => ({ path: c.path, body: c.body }))).toEqual([
      { path: '/patrimonio-combustivel-produtos/v1', body: { empresa_id: 'emp-1', versao: 1, ativo: false } },
      { path: '/patrimonio-combustivel-produtos/v7', body: { empresa_id: 'emp-1', versao: 2, ativo: true } },
    ]);
    // Nada é apagado: a associação inativada continua listada.
    await waitFor(() => expect(within(screen.getByTestId('combustivel-produtos-inativos')).getByTestId('combustivel-produto-v1')).toBeTruthy());
  });
});

describe('CB-13 — criação: a fazenda muda enquanto os Produtos são associados (C1)', () => {
  it('tudo ok: os vínculos vão para a fazenda de origem e o aviso a nomeia — nunca "nesta fazenda" com outra na tela', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_p1', 'Diesel P1');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    await escolherNoNovo(form, /DIESEL TANQUE 2/);
    let liberar;
    ganchos.vinculo.push({ esperar: new Promise((r) => { liberar = r; }) });
    salvar();
    await waitFor(() => expect(postsVinculo()).toHaveLength(1));
    await trocarFazenda('emp-2');
    await act(async () => { liberar(); });
    expect(
      await screen.findByText('Combustível criado com 2 produto(s) associado(s) na fazenda anterior (Fazenda Boa Vista). Para conferir, volte para essa fazenda no topo da tela.'),
    ).toBeTruthy();
    expect(screen.queryByText(/associado\(s\) nesta fazenda/)).toBeNull();
    expect(postsVinculo().map((c) => c.body)).toEqual([
      { empresa_id: 'emp-1', produto_id: 'pB' },
      { empresa_id: 'emp-1', produto_id: 'pD' },
    ]);
    const secao = await screen.findByTestId('combustivel-produtos');
    expect(await within(secao).findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
  });

  it('falha parcial: o aviso diz que "Não associados" aparece ao voltar para a fazenda de origem — e aparece lá', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_p2', 'Diesel P2');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    await escolherNoNovo(form, /DIESEL TANQUE 2/);
    estado.vinculos.push(vinculo('v-corrida', 'emp-1', 'c2', 'pD', true, 1));
    let liberar;
    ganchos.vinculo.push({ esperar: new Promise((r) => { liberar = r; }) });
    salvar();
    await waitFor(() => expect(postsVinculo()).toHaveLength(1));
    await trocarFazenda('emp-2');
    await act(async () => { liberar(); });
    expect(
      await screen.findByText(
        'Combustível criado, mas 1 de 2 produto(s) não foram associados na fazenda anterior (Fazenda Boa Vista). Volte para essa fazenda no topo da tela para ver "Não associados" e tentar de novo.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Sucesso')).toBeNull();
    const secao = await screen.findByTestId('combustivel-produtos');
    expect(await within(secao).findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
    expect(within(secao).queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
    await trocarFazenda('emp-1');
    const deVolta = await screen.findByTestId('combustivel-produtos');
    expect(await within(deVolta).findByText('Fazenda: Fazenda Boa Vista')).toBeTruthy();
    const bloco = within(deVolta).getByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent('DIESEL TANQUE 2: Este produto já está vinculado a outro combustível nesta fazenda');
  });
});

describe('CB-14 — registro: a falha de uma associação em andamento não se perde quando a seção remonta (C2)', () => {
  const associarComRespostaPresa = async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    let liberar;
    ganchos.vinculo.push({ esperar: new Promise((r) => { liberar = r; }), resposta: erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis' } }) });
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    await waitFor(() => expect(postsVinculo()).toHaveLength(1));
    return () => act(async () => { liberar(); });
  };

  it('troca de fazenda e volta ANTES da resposta: "Não associados" aparece com o motivo e "Tentar de novo" vai ao MESMO combustível e fazenda', async () => {
    const liberar = await associarComRespostaPresa();
    await trocarFazenda('emp-2');
    expect(await screen.findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
    await trocarFazenda('emp-1');
    expect(await screen.findByText('Fazenda: Fazenda Boa Vista')).toBeTruthy();
    await liberar();
    expect(await screen.findByText('1 de 1 produto(s) não foram associados. Veja "Não associados" e tente de novo.')).toBeTruthy();
    const bloco = await within(screen.getByTestId('combustivel-produtos')).findByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent(`DIESEL ESTOQUE NOVO: ${MSG_403}`);
    fireEvent.click(within(bloco).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Produto associado')).toBeTruthy();
    expect(postsVinculo().map((c) => ({ path: c.path, body: c.body }))).toEqual([
      { path: '/patrimonio-combustiveis/c1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pB' } },
      { path: '/patrimonio-combustiveis/c1/produtos', body: { empresa_id: 'emp-1', produto_id: 'pB' } },
    ]);
    await waitFor(() => expect(screen.queryByTestId('combustivel-produtos-nao-associados')).toBeNull());
  });

  it('a resposta chega com OUTRA fazenda na tela: o aviso nomeia o combustível e a fazenda de origem; o bloco não aparece lá e aparece ao voltar', async () => {
    const liberar = await associarComRespostaPresa();
    await trocarFazenda('emp-2');
    expect(await screen.findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
    await liberar();
    expect(
      await screen.findByText(
        '1 de 1 produto(s) não foram associados ao combustível Diesel S10 na fazenda anterior (Fazenda Boa Vista). Volte para essa fazenda no topo da tela para ver "Não associados" e tentar de novo.',
      ),
    ).toBeTruthy();
    // Nunca manda "ver" um bloco que não está na tela.
    expect(screen.queryByText(/Veja "Não associados"/)).toBeNull();
    await esperar(50);
    expect(within(screen.getByTestId('combustivel-produtos')).queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
    await trocarFazenda('emp-1');
    expect(await screen.findByText('Fazenda: Fazenda Boa Vista')).toBeTruthy();
    const bloco = within(screen.getByTestId('combustivel-produtos')).getByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent(`DIESEL ESTOQUE NOVO: ${MSG_403}`);
  });

  it('a resposta chega com OUTRO registro aberto na mesma fazenda: o aviso nomeia o combustível e manda abrir esse registro (o bloco aparece lá)', async () => {
    const liberar = await associarComRespostaPresa();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo registro' }));
    await within(await screen.findByTestId('combustivel-produtos')).findByTestId('combustivel-produto-v5');
    await liberar();
    expect(
      await screen.findByText('1 de 1 produto(s) não foram associados ao combustível Diesel S10 nesta fazenda. Abra esse registro para ver "Não associados" e tentar de novo.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Veja "Não associados"/)).toBeNull();
    await esperar(50);
    expect(within(screen.getByTestId('combustivel-produtos')).queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Registro anterior' }));
    await within(await screen.findByTestId('combustivel-produtos')).findByTestId('combustivel-produto-v1');
    const bloco = within(screen.getByTestId('combustivel-produtos')).getByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent(`DIESEL ESTOQUE NOVO: ${MSG_403}`);
  });

  it('outra fazenda E outro registro na tela: o aviso nomeia a fazenda de origem e o combustível e diz para voltar e abrir esse registro', async () => {
    const liberar = await associarComRespostaPresa();
    await trocarFazenda('emp-2');
    // c1 em Santa Rita mostra o vínculo de lá (v6); c2 em Santa Rita não tem nenhum.
    await within(await screen.findByTestId('combustivel-produtos')).findByTestId('combustivel-produto-v6');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo registro' }));
    await waitFor(() => expect(within(screen.getByTestId('combustivel-produtos')).getByText('Nenhum produto associado nesta fazenda.')).toBeTruthy());
    await liberar();
    expect(
      await screen.findByText(
        '1 de 1 produto(s) não foram associados ao combustível Diesel S10 na fazenda anterior (Fazenda Boa Vista). Volte para essa fazenda no topo da tela e abra esse registro para ver "Não associados" e tentar de novo.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Veja "Não associados"/)).toBeNull();
  });
});

describe('CB-17 — registro: resposta atrasada de um lote antigo não apaga a falha de um lote novo (delta por lote)', () => {
  const err403 = () => erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis' } });
  /**
   * c1 em Boa Vista: associa pB com a resposta PRESA; troca de fazenda e volta
   * (a seção remonta); na seção nova associa pD, que recebe 403. Devolve o
   * liberador da resposta antiga de pB.
   * @param {object|null} respostaAntiga resposta do POST antigo de pB (null = grava de verdade: 201)
   */
  const loteAntigoPresoELoteNovoComFalha = async (respostaAntiga) => {
    await montar();
    let secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    let liberar;
    ganchos.vinculo.push({ esperar: new Promise((r) => { liberar = r; }), ...(respostaAntiga ? { resposta: respostaAntiga } : {}) });
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    await waitFor(() => expect(postsVinculo()).toHaveLength(1));
    await trocarFazenda('emp-2');
    expect(await screen.findByText('Fazenda: Fazenda Santa Rita')).toBeTruthy();
    await trocarFazenda('emp-1');
    expect(await screen.findByText('Fazenda: Fazenda Boa Vista')).toBeTruthy();
    secao = screen.getByTestId('combustivel-produtos');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL TANQUE 2/);
    ganchos.vinculo.push({ resposta: err403() });
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    const bloco = await within(screen.getByTestId('combustivel-produtos')).findByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent(`DIESEL TANQUE 2: ${MSG_403}`);
    return () => act(async () => { liberar(); });
  };

  it('P2e: o lote antigo (pB) dá CERTO depois da falha nova (pD): só pB sai; "Não associados (1) DIESEL TANQUE 2" continua', async () => {
    const liberar = await loteAntigoPresoELoteNovoComFalha(null);
    await liberar();
    expect(await screen.findByText('Produto associado')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('combustivel-produtos')).getByText('Associados (2)')).toBeTruthy());
    const bloco = within(screen.getByTestId('combustivel-produtos')).getByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent(`DIESEL TANQUE 2: ${MSG_403}`);
    expect(bloco).not.toHaveTextContent('DIESEL ESTOQUE NOVO');
    // pD de fato não está associado: o bloco diz a verdade.
    expect(estado.vinculos.filter((v) => v.produto_id === 'pD')).toEqual([]);
  });

  it('P2a: o lote antigo (pB) também FALHA depois: os dois ficam em "Não associados" e "Tentar de novo" reenvia os dois', async () => {
    const liberar = await loteAntigoPresoELoteNovoComFalha(err403());
    await liberar();
    // Um aviso por lote (pD antes, pB agora), os dois com a seção na tela.
    await waitFor(() => expect(screen.getAllByText('1 de 1 produto(s) não foram associados. Veja "Não associados" e tente de novo.')).toHaveLength(2));
    const bloco = within(screen.getByTestId('combustivel-produtos')).getByTestId('combustivel-produtos-nao-associados');
    await waitFor(() => expect(bloco).toHaveTextContent('Não associados (2)'));
    expect(bloco).toHaveTextContent(`DIESEL TANQUE 2: ${MSG_403}`);
    expect(bloco).toHaveTextContent(`DIESEL ESTOQUE NOVO: ${MSG_403}`);
    fireEvent.click(within(bloco).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('2 produtos associados')).toBeTruthy();
    expect(postsVinculo().map((c) => c.body.produto_id)).toEqual(['pB', 'pD', 'pD', 'pB']);
    await waitFor(() => expect(screen.queryByTestId('combustivel-produtos-nao-associados')).toBeNull());
  });

  it('"Descartar" tira só o que estava no bloco: a falha que chega depois (lote antigo) aparece sozinha', async () => {
    const liberar = await loteAntigoPresoELoteNovoComFalha(err403());
    fireEvent.click(within(screen.getByTestId('combustivel-produtos-nao-associados')).getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByTestId('combustivel-produtos-nao-associados')).toBeNull();
    await liberar();
    const bloco = await within(screen.getByTestId('combustivel-produtos')).findByTestId('combustivel-produtos-nao-associados');
    expect(bloco).toHaveTextContent('Não associados (1)');
    expect(bloco).toHaveTextContent(`DIESEL ESTOQUE NOVO: ${MSG_403}`);
    expect(bloco).not.toHaveTextContent('DIESEL TANQUE 2');
  });
});

describe('CB-15 — "Tentar de novo" com o painel "Associar produtos" aberto (C3)', () => {
  it('reenvia só o que falhou e mantém o painel com os Produtos escolhidos (nada é descartado sem aviso)', async () => {
    await montar();
    const secao = await abrir('c1');
    await within(secao).findByTestId('combustivel-produto-v1');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL ESTOQUE NOVO/);
    ganchos.vinculo.push({ resposta: erroServidor(403, 'ACAO_NAO_PERMITIDA', { details: { tela: 'pat-combustiveis' } }) });
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    const bloco = await within(secao).findByTestId('combustivel-produtos-nao-associados');
    fireEvent.click(within(secao).getByRole('button', { name: 'Associar produtos' }));
    await escolherNaSecao(secao, /DIESEL TANQUE 2/);
    expect(within(secao).getByTestId('combustivel-produto-pendente-pD')).toBeTruthy();

    fireEvent.click(within(bloco).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Produto associado')).toBeTruthy();
    expect(postsVinculo().map((c) => c.body.produto_id)).toEqual(['pB', 'pB']);
    await waitFor(() => expect(within(secao).queryByTestId('combustivel-produtos-nao-associados')).toBeNull());
    // A escolha do painel continua lá: nada foi enviado nem descartado.
    expect(within(secao).getByTestId('combustivel-produto-vincular')).toBeTruthy();
    expect(within(secao).getByTestId('combustivel-produto-pendente-pD')).toBeTruthy();

    fireEvent.click(within(secao).getByRole('button', { name: 'Associar 1 produto(s)' }));
    await waitFor(() => expect(postsVinculo().map((c) => c.body.produto_id)).toEqual(['pB', 'pB', 'pD']));
    await waitFor(() => expect(within(secao).queryByTestId('combustivel-produto-vincular')).toBeNull());
    await waitFor(() => expect(within(screen.getByTestId('combustivel-produtos')).getByText('Associados (3)')).toBeTruthy());
  });
});

describe('CB-16 — código que já existe: nada é criado nem associado e nunca aparece "criado" (C4)', () => {
  it.each([
    ['inativo', 'QUEROSENE', 'Querosene'],
    ['ativo', 'DIESEL_S10', 'Diesel S10'],
  ])('combustível %s com o mesmo código e nome: a verificação antes do POST barra, mesmo que a resposta fosse se perder', async (_situacao, codigo, nome) => {
    await montar();
    const form = await novo();
    preencher(form, codigo, nome);
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.combustivel.push({ modo: 'perder' });
    salvar();
    expect(await screen.findByText(MSG_JA_EXISTE)).toBeTruthy();
    expect(leituras('/patrimonio-combustiveis').some((c) => c.query.q === codigo)).toBe(true);
    expect(postsCombustivel()).toEqual([]);
    expect(postsVinculo()).toEqual([]);
    expect(screen.queryByText(/Combustível criado/)).toBeNull();
    expect(screen.queryByText('Sucesso')).toBeNull();
    expect(estado.combustiveis.filter((c) => c.codigo === codigo)).toHaveLength(1);
    // O formulário continua aberto com os Produtos escolhidos.
    expect(within(screen.getByTestId('b1-form')).getByTestId('combustivel-novo-pendente-pB')).toBeTruthy();
  });

  it.each([
    ['com outro nome', { nome: 'Diesel de outra pessoa' }],
    ['inativo com o mesmo nome', { nome: 'Diesel S10 X', ativo: false }],
  ])('outra pessoa grava o mesmo código entre a verificação e o POST (%s) e a resposta se perde: não é dado como nosso', async (_caso, extra) => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_x', 'Diesel S10 X');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.combustivel.push({ antes: () => estado.combustiveis.push(combustivel('c-outro', 'DIESEL_S10_X', extra.nome, extra)), modo: 'perder' });
    salvar();
    expect(await screen.findByText(MSG_JA_EXISTE)).toBeTruthy();
    expect(postsCombustivel()).toHaveLength(1);
    expect(postsVinculo()).toEqual([]);
    expect(screen.queryByText(/Combustível criado/)).toBeNull();
    expect(within(screen.getByTestId('b1-form')).getByTestId('combustivel-novo-pendente-pB')).toBeTruthy();
  });

  it('a verificação antes do POST não respondeu e a resposta do POST se perdeu: achar pelo código não basta — pede conferência e não associa', async () => {
    await montar();
    const form = await novo();
    preencher(form, 'diesel_s10_y', 'Diesel S10 Y');
    await escolherNoNovo(form, /DIESEL ESTOQUE NOVO/);
    ganchos.buscasQueCaem = 1;
    ganchos.combustivel.push({ modo: 'gravar-e-perder' });
    salvar();
    expect(
      await screen.findByText('Não foi possível confirmar se o combustível foi gravado. Confira a lista antes de salvar de novo: o código não se repete.'),
    ).toBeTruthy();
    // Verificação (caiu) + recuperação (achou, mas não dá para provar que é nosso).
    expect(leituras('/patrimonio-combustiveis').filter((c) => c.query.q === 'DIESEL_S10_Y')).toHaveLength(2);
    expect(postsCombustivel()).toHaveLength(1);
    expect(postsVinculo()).toEqual([]);
    expect(screen.queryByText(/Combustível criado/)).toBeNull();
  });
});
