/**
 * D-PROD-152 — tela Naturezas Financeiras montada de verdade (página, motor
 * Base1, service, API, porta e nativeHttpClient reais). Mocks só da borda:
 * `fetch` (backend falso) e a sessão (usuário/permissão efetiva, tenant do JWT).
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
  modulos_permitidos: ['gestao-rural'],
  permissoes_telas: [
    { tela_id: 'ges-naturezas-financeiras', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes },
  ],
});

/** Natureza como o servidor devolve (caminho/nivel resolvidos). */
const natureza = (id, numero, tipo, nome, pai = null, extra = {}) => ({
  id,
  empresa_id: 'emp-1',
  numero: String(numero),
  tipo,
  nome,
  descricao: null,
  pai_id: pai?.id ?? null,
  pai_nome: pai?.nome ?? null,
  caminho: pai ? `${pai.caminho} / ${nome}` : nome,
  nivel: pai ? pai.nivel + 1 : 1,
  ativo: true,
  created_date: '2026-01-01T00:00:00Z',
  updated_date: '2026-01-01T00:00:00Z',
  ...extra,
});
const INSUMOS = natureza('n1', 1, 'DESPESA', 'INSUMOS');
const RACAO = natureza('n2', 2, 'DESPESA', 'RAÇÃO', INSUMOS);
const SAL = natureza('n3', 3, 'DESPESA', 'SAL MINERAL', RACAO);
const ENERGIA = natureza('n4', 4, 'DESPESA', 'ENERGIA');
const VENDA = natureza('r1', 5, 'RECEITA', 'VENDA DE GADO');
const ANTIGA = natureza('n5', 6, 'DESPESA', 'ANTIGA', null, { ativo: false });
const OUTRA_EMPRESA = { ...natureza('x1', 1, 'DESPESA', 'OUTRA EMPRESA DESPESA'), empresa_id: 'emp-2' };

const empresaSelecionada = (id) => {
  window.localStorage.setItem('empresa_selecionada_id', id);
  window.localStorage.setItem('empresa_selecionada_cliente_id', sessao.clienteId);
};

const montar = async () => {
  const { default: NaturezasFinanceiras } = await import('@/pages/NaturezasFinanceiras');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <NaturezasFinanceiras />
    </QueryClientProvider>,
  );
};

const celula = (id) => screen.findByTestId(`natureza-caminho-${id}`);
const abrirRegistro = async (id) => {
  fireEvent.doubleClick(await celula(id));
  await waitFor(() => expect(screen.getByTestId('b1-form')).toBeTruthy());
};
const editar = () => fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
const abrirSeletorPai = () => fireEvent.click(screen.getByTestId('seletor-pai-natureza'));
const listaPais = () => screen.getByRole('listbox', { name: 'Opções de natureza pai' });
const chamadasPais = () => backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/naturezas-financeiras-opcoes/pais');
const listagens = () => backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/naturezas-financeiras');

let backend;
/** @type {Record<string, any[]>} */
let registros;
/** @type {any[] | null} quando definido, as opções de pai vêm daqui (teste de escala). */
let paisGrandes;
let proximaResposta;
/** @type {Promise<void> | null} PATCH segurado até o teste liberar (resposta atrasada). */
let segurarPatch;
/** @type {(query: URLSearchParams) => any} falha injetável nas opções de pai (R1). */
let opcoesPaisFalha = () => null;

/** Ids do nó e de toda a subárvore (como o servidor faz com `excluir_id`). */
const subarvore = (lista, raizId) => {
  const fora = new Set([raizId]);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const n of lista) if (n.pai_id && fora.has(n.pai_id) && !fora.has(n.id)) { fora.add(n.id); cresceu = true; }
  }
  return fora;
};

/** Opções de pai paginadas: ativas do tipo, por nome; cursor = posição. */
const opcoesPais = (query) => {
  const lista = paisGrandes ?? registros[query.get('empresa_id')] ?? [];
  const fora = query.get('excluir_id') ? subarvore(lista, query.get('excluir_id')) : new Set();
  const q = (query.get('q') || '').toLowerCase();
  const filtradas = lista
    .filter((n) => n.ativo && n.tipo === query.get('tipo') && !fora.has(n.id))
    .filter((n) => !q || n.nome.toLowerCase().includes(q) || String(n.numero).includes(q))
    .sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id));
  const inicio = query.get('cursor') ? Number(query.get('cursor')) : 0;
  const limit = Number(query.get('limit') || 50);
  const pagina = filtradas.slice(inicio, inicio + limit);
  const mais = inicio + limit < filtradas.length;
  return {
    itens: pagina.map(({ id, numero, nome, pai_id, caminho, nivel }) => ({ id, numero, nome, pai_id, caminho, nivel })),
    has_more: mais,
    next_cursor: mais ? String(inicio + limit) : null,
  };
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  window.sessionStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  sessao.permissao = permissaoCom({ novo: true, editar: true });
  registros = { 'emp-1': [INSUMOS, RACAO, SAL, ENERGIA, VENDA, ANTIGA], 'emp-2': [OUTRA_EMPRESA] };
  paisGrandes = null;
  proximaResposta = null;
  segurarPatch = null;
  opcoesPaisFalha = () => null;
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proximaResposta && method !== 'GET') {
      const r = proximaResposta;
      proximaResposta = null;
      return r;
    }
    if (method === 'GET' && path === '/naturezas-financeiras') {
      const tipo = query.get('tipo');
      const ativo = query.get('ativo');
      const itens = (registros[query.get('empresa_id')] ?? [])
        .filter((n) => !tipo || n.tipo === tipo)
        .filter((n) => ativo == null || String(n.ativo) === ativo);
      return { status: 200, body: envelope(itens) };
    }
    if (method === 'GET' && path === '/naturezas-financeiras-opcoes/pais') return opcoesPaisFalha(query) ?? { status: 200, body: opcoesPais(query) };
    if (method === 'POST' && path === '/naturezas-financeiras') {
      const pai = body.pai_id ? registros['emp-1'].find((n) => n.id === body.pai_id) : null;
      return { status: 201, body: natureza('n9', 9, body.tipo, body.nome, pai) };
    }
    const m = path.match(/^\/naturezas-financeiras\/([^/]+)$/);
    if (method === 'PATCH' && m) {
      if (segurarPatch) await segurarPatch;
      const atual = Object.values(registros).flat().find((n) => n.id === m[1]);
      const { empresa_id: _e, ...resto } = body;
      return { status: 200, body: { ...atual, ...resto } };
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Naturezas — lista, filtros e empresa', () => {
  it('mostra a hierarquia (caminho) com indentação; padrão = só DESPESA ativas', async () => {
    empresaSelecionada('emp-1');
    await montar();
    const sal = await celula('n3');
    expect(sal.getAttribute('title')).toBe('INSUMOS / RAÇÃO / SAL MINERAL');
    expect(sal.getAttribute('style')).toMatch(/padding-left: 24px/);
    expect(within(sal.closest('tr')).getByText('RAÇÃO')).toBeTruthy();
    expect(within(sal.closest('tr')).getByText('Despesa')).toBeTruthy();
    expect(screen.queryByText('VENDA DE GADO')).toBeNull();
    expect(listagens().length).toBeGreaterThan(0);
    expect(listagens().every((c) => c.query.tipo === 'DESPESA' && c.query.ativo === 'true' && c.query.empresa_id === 'emp-1')).toBe(true);
  });

  it('filtro de tipo: Receita relê com tipo=RECEITA; Todos sem tipo', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('n1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), 'Receita');
    expect(await celula('r1')).toBeTruthy();
    expect(screen.queryByTestId('natureza-caminho-n1')).toBeNull();
    expect(listagens().some((c) => c.query.tipo === 'RECEITA')).toBe(true);
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por tipo' }), 'Todos');
    await waitFor(() => expect(listagens().some((c) => c.query.tipo === undefined)).toBe(true));
    expect(await celula('n1')).toBeTruthy();
    expect(await celula('r1')).toBeTruthy();
  });

  it('filtro de situação relê com ativo=false', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('n1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    expect(await celula('n5')).toBeTruthy();
    expect(listagens().some((c) => c.query.ativo === 'false' && c.query.tipo === 'DESPESA')).toBe(true);
  });

  it('busca vai ao servidor com q', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('n1');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pesquisa' }));
    const busca = await screen.findByLabelText('Buscar naturezas…');
    fireEvent.change(busca, { target: { value: 'sal' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    await waitFor(() => expect(listagens().some((c) => c.query.q === 'sal' && c.query.tipo === 'DESPESA')).toBe(true), { timeout: 2000 });
  });

  it('sem empresa real (fallback clienteId) avisa e não chama o servidor', async () => {
    empresaSelecionada('cli-1');
    await montar();
    expect(await screen.findByTestId('gestao-sem-empresa')).toHaveTextContent(/Selecione uma empresa/);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(backend.chamadas.filter((c) => c.path.startsWith('/naturezas'))).toEqual([]);
  });

  it('troca de empresa fecha o registro, limpa a lista e relê com a nova empresa', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n1');
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    expect(await celula('x1')).toBeTruthy();
    expect(screen.queryByTestId('natureza-caminho-n1')).toBeNull();
    expect(screen.queryByTestId('b1-form')).toBeNull();
    expect(listagens().map((c) => c.query.empresa_id)).toEqual(expect.arrayContaining(['emp-1', 'emp-2']));
  });
});

describe('Naturezas — permissões espelham o servidor', () => {
  it('só visualizar: lista e abre somente leitura, sem Novo/Editar/Excluir', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = permissaoCom({});
    await montar();
    await abrirRegistro('n1');
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Excluir/ })).toBeNull();
    expect(screen.getByTestId('seletor-pai-natureza')).toBeDisabled();
  });

  it('sem linha da tela: aviso e nada listado', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = { user_email: 'operador', modulos_permitidos: ['gestao-rural'], permissoes_telas: [] };
    await montar();
    expect(await screen.findByTestId('gestao-sem-permissao')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
    expect(listagens()).toEqual([]);
  });

  it('salvar sozinho libera Novo (novo|salvar)', async () => {
    empresaSelecionada('emp-1');
    sessao.permissao = permissaoCom({ salvar: true });
    await montar();
    await celula('n1');
    expect(screen.getByRole('button', { name: 'Novo' })).toBeTruthy();
  });
});

describe('Naturezas — criação', () => {
  const novo = async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('n1');
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
    return screen.findByTestId('b1-form');
  };

  it('tipo é obrigatório e sem padrão: não envia POST sem Receita/Despesa', async () => {
    const form = await novo();
    expect(within(form).getByRole('combobox', { name: 'Tipo' }).getAttribute('value')).toBe('');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'frete' } });
    expect(screen.getByTestId('seletor-pai-natureza')).toBeDisabled();
    salvar();
    expect(await screen.findByText(/Preencha o campo obrigatório: Tipo \(Receita ou Despesa\)/)).toBeTruthy();
    expect(within(form).getByText(/Obrigatório: escolha Receita ou Despesa/)).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(backend.chamadas.some((c) => c.method === 'POST')).toBe(false);
  });

  it('cria com pai: envia { empresa_id, tipo, nome, pai_id } e o seletor só pede o tipo do formulário', async () => {
    const form = await novo();
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Tipo' }), 'Despesa');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'frete' } });
    abrirSeletorPai();
    const opcao = await within(listaPais()).findByRole('option', { name: /INSUMOS \/ RAÇÃO$/ });
    expect(within(listaPais()).queryByRole('option', { name: /VENDA DE GADO/ })).toBeNull();
    expect(chamadasPais().every((c) => c.query.tipo === 'DESPESA' && c.query.empresa_id === 'emp-1' && !c.query.excluir_id)).toBe(true);
    fireEvent.click(opcao);
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('INSUMOS / RAÇÃO');
    salvar();
    await screen.findByText('Natureza financeira criada');
    expect(backend.chamadas.find((c) => c.method === 'POST').body).toEqual({ empresa_id: 'emp-1', tipo: 'DESPESA', nome: 'FRETE', pai_id: 'n2' });
  });

  it('trocar o tipo limpa o pai escolhido', async () => {
    const form = await novo();
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Tipo' }), 'Despesa');
    abrirSeletorPai();
    fireEvent.click(await within(listaPais()).findByRole('option', { name: /^1\s*INSUMOS$/ }));
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('INSUMOS');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Tipo' }), 'Receita');
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('— Nenhum (raiz) —');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'arrendamento' } });
    salvar();
    await screen.findByText('Natureza financeira criada');
    expect(backend.chamadas.find((c) => c.method === 'POST').body).toEqual({ empresa_id: 'emp-1', tipo: 'RECEITA', nome: 'ARRENDAMENTO' });
  });

  it('NATUREZA_NOME_CONFLITO na criação', async () => {
    const form = await novo();
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Tipo' }), 'Despesa');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'insumos' } });
    proximaResposta = erroServidor(409, 'NATUREZA_NOME_CONFLITO', { details: { field: 'nome', reason: 'nome_repetido' } });
    salvar();
    expect(await screen.findByText(/Já existe uma natureza com este nome e tipo/)).toBeTruthy();
    expect(screen.queryByText('Natureza financeira criada')).toBeNull();
  });

  it('mostra a nota de que a associação com Parceiros/Centros vem nas próximas etapas', async () => {
    const form = await novo();
    expect(within(form).getByTestId('natureza-nota-etapas')).toHaveTextContent(/próximas etapas/);
  });
});

describe('Naturezas — seletor de pai paginado no servidor', () => {
  it('digitar busca com q; edição manda excluir_id; tipo fixo só leitura', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n2');
    editar();
    const form = screen.getByTestId('b1-form');
    expect(within(form).queryByRole('combobox', { name: 'Tipo' })).toBeNull();
    const tipo = /** @type {HTMLInputElement} */ (within(form).getByLabelText('Tipo'));
    expect(tipo.value).toBe('Despesa');
    expect(tipo.readOnly).toBe(true);
    // pai atual aparece mesmo antes de carregar qualquer opção
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('INSUMOS');
    expect(chamadasPais()).toEqual([]);
    abrirSeletorPai();
    await within(listaPais()).findByRole('option', { name: /ENERGIA/ });
    // a própria natureza e a subárvore (SAL MINERAL) não são oferecidas
    expect(within(listaPais()).queryByRole('option', { name: /RAÇÃO/ })).toBeNull();
    expect(chamadasPais()[0].query).toMatchObject({ empresa_id: 'emp-1', tipo: 'DESPESA', excluir_id: 'n2' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar natureza pai' }), { target: { value: 'ener' } });
    await waitFor(() => expect(chamadasPais().some((c) => c.query.q === 'ener' && c.query.excluir_id === 'n2')).toBe(true));
    await waitFor(() => expect(within(listaPais()).queryByRole('option', { name: /INSUMOS/ })).toBeNull());
  });

  it('1.001 naturezas: "Carregar mais" segue o cursor até a última, que fica escolhível', async () => {
    paisGrandes = Array.from({ length: 1001 }, (_, i) => natureza(`g${i + 1}`, 100 + i, 'DESPESA', `NAT ${String(i + 1).padStart(4, '0')}`));
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n1');
    editar();
    abrirSeletorPai();
    await within(listaPais()).findByRole('option', { name: /NAT 0050$/ });
    expect(within(listaPais()).queryByRole('option', { name: /NAT 1001$/ })).toBeNull();
    for (let i = 0; i < 25 && screen.queryByRole('button', { name: 'Carregar mais' }); i += 1) {
      const antes = chamadasPais().length;
      fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
      await waitFor(() => expect(chamadasPais().length).toBe(antes + 1));
      await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
    }
    const cursores = chamadasPais().map((c) => c.query.cursor).filter(Boolean);
    expect(cursores.length).toBe(20);
    expect(chamadasPais().every((c) => c.query.limit === '50')).toBe(true);
    fireEvent.click(await within(listaPais()).findByRole('option', { name: /NAT 1001$/ }));
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('NAT 1001');
    salvar();
    await screen.findByText('Natureza financeira atualizada');
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', pai_id: 'g1001' });
  });

  it('1.001 naturezas: a última é alcançável pela busca no servidor (sem carregar tudo)', async () => {
    paisGrandes = Array.from({ length: 1001 }, (_, i) => natureza(`g${i + 1}`, 100 + i, 'DESPESA', `NAT ${String(i + 1).padStart(4, '0')}`));
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n1');
    editar();
    abrirSeletorPai();
    await within(listaPais()).findByRole('option', { name: /NAT 0001$/ });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar natureza pai' }), { target: { value: 'NAT 1001' } });
    fireEvent.click(await within(listaPais()).findByRole('option', { name: /NAT 1001$/ }));
    expect(chamadasPais().length).toBe(2);
    expect(chamadasPais()[1].query.q).toBe('NAT 1001');
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('NAT 1001');
  });
});

describe('Naturezas — edição, inativação e reativação', () => {
  it('PATCH só com o que mudou e nunca com tipo; virar raiz envia pai_id=null', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n2');
    editar();
    abrirSeletorPai();
    fireEvent.click(await within(listaPais()).findByRole('option', { name: '— Nenhum (raiz) —' }));
    salvar();
    await screen.findByText('Natureza financeira atualizada');
    const patch = backend.chamadas.find((c) => c.method === 'PATCH');
    expect(patch.path).toBe('/naturezas-financeiras/n2');
    expect(patch.body).toEqual({ empresa_id: 'emp-1', pai_id: null });
  });

  it('salvar sem mudar nada não chama o servidor', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n1');
    editar();
    salvar();
    expect(await screen.findByText('Sem alterações')).toBeTruthy();
    expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('renomear envia só nome (sem tipo)', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n4');
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'energia elétrica' } });
    salvar();
    await screen.findByText('Natureza financeira atualizada');
    const body = backend.chamadas.find((c) => c.method === 'PATCH').body;
    expect(body).toEqual({ empresa_id: 'emp-1', nome: 'ENERGIA ELÉTRICA' });
    expect(body).not.toHaveProperty('tipo');
  });

  it('inativar pela barra pede confirmação; NATUREZA_COM_FILHOS_ATIVOS mostra a mensagem', async () => {
    empresaSelecionada('emp-1');
    await montar();
    fireEvent.click(await celula('n1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent(/Inativar esta natureza financeira/);
    expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(false);
    proximaResposta = erroServidor(409, 'NATUREZA_COM_FILHOS_ATIVOS');
    fireEvent.click(within(dialogo).getByRole('button', { name: /Inativar/ }));
    expect(await screen.findByText(/tem naturezas filhas ativas/)).toBeTruthy();
    expect(screen.queryByText('Natureza financeira inativada')).toBeNull();
    expect(backend.chamadas.find((c) => c.method === 'PATCH').body).toEqual({ empresa_id: 'emp-1', ativo: false });
  });

  it('inativar natureza sem filhas: confirma e envia ativo=false', async () => {
    empresaSelecionada('emp-1');
    await montar();
    fireEvent.click(await celula('n4'));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Inativar/ }));
    await screen.findByText('Natureza financeira inativada');
    expect(backend.chamadas.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/naturezas-financeiras/n4', body: { empresa_id: 'emp-1', ativo: false } });
  });

  it('desligar Ativo no formulário pede confirmação; cancelar não grava', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n4');
    editar();
    fireEvent.click(within(screen.getByTestId('b1-form')).getByRole('switch'));
    salvar();
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('reativar natureza inativa pelo menu Mais opções', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await celula('n1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por situação' }), 'Inativos');
    await abrirRegistro('n5');
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByText('Reativar natureza financeira'));
    await screen.findByText('Natureza financeira reativada');
    expect(backend.chamadas.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/naturezas-financeiras/n5', body: { empresa_id: 'emp-1', ativo: true } });
  });

  const casosHierarquia = [
    [{ field: 'pai_id', reason: 'ciclo' }, /formaria um ciclo/],
    [{ details: { field: 'pai_id', reason: 'profundidade_maxima', maximo: 5 } }, /número máximo de níveis permitido \(5\)/],
    [{ field: 'pai_id', reason: 'pai_inativo' }, /pai está inativa/],
    [{ field: 'pai_id', reason: 'pai_fora_da_empresa' }, /não pertence a esta empresa/],
    [{ field: 'pai_id', reason: 'pai_de_outro_tipo' }, /precisa ser do mesmo tipo/],
    [{ details: { reason: 'autorreferencia' } }, /não pode ser pai de si mesma/],
  ];
  it.each(casosHierarquia)('NATUREZA_HIERARQUIA_INVALIDA %#: mensagem pelo reason', async (extra, mensagem) => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n4');
    editar();
    abrirSeletorPai();
    fireEvent.click(await within(listaPais()).findByRole('option', { name: /^1\s*INSUMOS$/ }));
    proximaResposta = erroServidor(409, 'NATUREZA_HIERARQUIA_INVALIDA', extra);
    salvar();
    expect(await screen.findByText(mensagem)).toBeTruthy();
    expect(screen.queryByText('Natureza financeira atualizada')).toBeNull();
  });

  it('NATUREZA_FINANCEIRA_NOT_FOUND fecha o registro e relê a lista', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n4');
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'luz' } });
    const antes = listagens().length;
    proximaResposta = erroServidor(404, 'NATUREZA_FINANCEIRA_NOT_FOUND');
    salvar();
    expect(await screen.findByText(/Natureza financeira não encontrada nesta empresa/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('b1-form')).toBeNull());
    await waitFor(() => expect(listagens().length).toBeGreaterThan(antes));
  });
});

describe('Naturezas — resposta atrasada depois de trocar de empresa', () => {
  it('PATCH da empresa A que chega depois de abrir um registro da empresa B não substitui o registro de B', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n4');
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'luz' } });
    /** @type {() => void} */
    let liberar = () => {};
    segurarPatch = new Promise((r) => {
      liberar = r;
    });
    salvar();
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'PATCH')).toBe(true));
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    await abrirRegistro('x1');
    await act(async () => {
      liberar();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(await screen.findByText('Gravação concluída')).toBeTruthy();
    const nome = /** @type {HTMLInputElement} */ (within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/));
    expect(nome.value).toBe('OUTRA EMPRESA DESPESA');
    expect(screen.queryByText('Natureza financeira atualizada')).toBeNull();
    expect(backend.chamadas.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/naturezas-financeiras/n4', body: { empresa_id: 'emp-1', nome: 'LUZ' } });
  });
});

describe('Naturezas — R1: duplicar e falha nas opções de pai', () => {
  it('duplicar: novo rascunho sem id nem código do original; POST sem id/numero, com o mesmo tipo e pai', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n2');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    const form = await screen.findByTestId('b1-form');
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Tipo' })).toBeTruthy());
    // cabeçalho do rascunho não pode exibir o código "2" do original
    expect(document.querySelector('.mg-b1-record-sep')).toBeNull();
    expect(screen.getByTestId('seletor-pai-natureza')).toHaveTextContent('INSUMOS');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'ração 2' } });
    salvar();
    await screen.findByText('Natureza financeira criada');
    const post = backend.chamadas.find((c) => c.method === 'POST').body;
    expect(post).toEqual({ empresa_id: 'emp-1', tipo: 'DESPESA', nome: 'RAÇÃO 2', pai_id: 'n1' });
  });

  it('falha na 1ª página de pais: alerta + "Tentar novamente" recarrega e mostra as opções', async () => {
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n4');
    editar();
    let falhar = true;
    opcoesPaisFalha = () => (falhar ? erroServidor(503, 'SERVICE_UNAVAILABLE') : null);
    abrirSeletorPai();
    expect(await screen.findByRole('alert')).toHaveTextContent(/opções de pai|tente/i);
    expect(within(listaPais()).queryByRole('option', { name: /INSUMOS/ })).toBeNull();
    falhar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await within(listaPais()).findByRole('option', { name: /^1\s*INSUMOS$/ });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha ao carregar mais: avisa que a lista está incompleta e "Tentar novamente" segue o mesmo cursor', async () => {
    paisGrandes = Array.from({ length: 120 }, (_, i) => natureza(`g${i + 1}`, 100 + i, 'DESPESA', `NAT ${String(i + 1).padStart(4, '0')}`));
    empresaSelecionada('emp-1');
    await montar();
    await abrirRegistro('n1');
    editar();
    abrirSeletorPai();
    await within(listaPais()).findByRole('option', { name: /NAT 0050$/ });
    opcoesPaisFalha = (query) => (query.get('cursor') ? erroServidor(503, 'SERVICE_UNAVAILABLE') : null);
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incompleta/i);
    // as 50 já carregadas continuam escolhíveis
    expect(within(listaPais()).getByRole('option', { name: /NAT 0050$/ })).toBeTruthy();
    opcoesPaisFalha = () => null;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await within(listaPais()).findByRole('option', { name: /NAT 0100$/ });
    const cursores = chamadasPais().map((c) => c.query.cursor).filter(Boolean);
    expect(cursores.every((c) => c === '50')).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
