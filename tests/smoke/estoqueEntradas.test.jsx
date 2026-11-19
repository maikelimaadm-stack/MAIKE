/**
 * D-PROD-257 — aba Entradas do Estoque montada de verdade (página, motor Base1, service, API, porta e
 * nativeHttpClient reais sobre um backend falso). Mocks só da borda: sessão e permissão.
 *
 *  - a aba existe; a lista traz motivo, quantidade e situação; uma linha abre UMA janela (680px; tela cheia no celular);
 *  - "Nova entrada" e as ações Editar/Excluir só com a ação `entrada` (o servidor é quem bloqueia de fato);
 *  - formulário único: custo zero só marcando "Custo zero"; "Outra" exige a justificativa; o corpo vai com decimais
 *    como TEXTO, `operation_id` e o motivo fechado; reenvio sem resposta reaproveita a mesma `operation_id`;
 *  - exclusão na mesma janela (sem popup sobre popup), com motivo, versão e `operation_id`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';
import { rotearEstoque } from './fixtures/estoqueConsultaFake.js';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(() => Promise.resolve(sessao.permissao)),
}));

const permissaoCom = (extras = {}) => ({
  user_email: 'operador',
  modulos_permitidos: ['suporte-mapa'],
  permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...extras }],
});

const ITEM = {
  id: 'i1', ordem: 1, produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos',
  unidade: 'KG', quantidade: '1500.0000', fator_kg: '1.0000', quantidade_estoque: '1500.0000', unidade_estoque: 'KG', custo_unitario: '3.4000', custo_kg: '3.4000', valor_total: '5100.0000',
  custo_zero: false, estoque_lote_nota_id: 'c1', movimentacao_estoque_id: 'm1', movimentacao_estorno_id: null, revisao_inicio: 1, revisao_fim: null,
};
const ENTRADA = {
  id: 'e1', empresa_id: 'emp-1', numero: '7', status: 'CONFIRMADA', versao: 1, revisao: 1, motivo: 'SALDO_IMPLANTACAO', data_entrada: '2026-11-10', documento_numero: 'NF 77',
  observacao: 'contagem inicial', justificativa: null, excluida_em: null, criada_em: '2026-11-10T12:00:00.000Z', itens: [ITEM],
  confirmada_em: '2026-11-10T12:00:00.000Z', itens_historico: [], eventos: [{ id: 'v1', tipo: 'CONFIRMACAO', modo: null, motivo: 'Entrada de saldo', criado_em: '2026-11-10T12:00:00.000Z' }],
};

/** Backend falso: o do Estoque + as rotas das Entradas (estado em memória). */
const criarRoteador = () => {
  const estado = { entradas: [ENTRADA], falhaDoPost: /** @type {null|{status:number, body:any}} */ (null) };
  const rotear = async (req) => {
    const { method, path, query, body } = req;
    if (path === '/estoque/entradas' && method === 'GET') return { status: 200, body: { items: estado.entradas, next_cursor: null, has_more: false, total: estado.entradas.length, limit: 100 } };
    if (path === '/estoque/entradas/opcoes/produtos') return { status: 200, body: { itens: [{ id: 'p-ureia', nome: 'Ureia', codigo: null, unidade_estoque: 'KG', peso_por_saco_kg: null }, { id: 'p-sal', nome: 'Sal mineral', codigo: null, unidade_estoque: 'KG', peso_por_saco_kg: '25.0000' }], has_more: false, next_cursor: null } };
    if (path === '/estoque/entradas/opcoes/locais') return { status: 200, body: { itens: [{ id: 'l-galpao', nome: 'Galpão insumos' }], has_more: false, next_cursor: null } };
    const m = /^\/estoque\/entradas\/([^/]+)(\/excluir)?$/.exec(path);
    if (m && method === 'GET') return { status: 200, body: estado.entradas.find((e) => e.id === m[1]) };
    if (path === '/estoque/entradas' && method === 'POST') {
      if (estado.falhaDoPost) return estado.falhaDoPost;
      const criada = { ...ENTRADA, id: 'e2', numero: '8', motivo: body.motivo, itens: [{ ...ITEM, id: 'i2', quantidade_estoque: `${body.itens[0].quantidade}.0000` }] };
      estado.entradas = [criada, ...estado.entradas];
      return { status: 201, body: { ...criada, replay: false } };
    }
    if (m && m[2] && method === 'POST') {
      const e = estado.entradas.find((x) => x.id === m[1]);
      const excluida = { ...e, status: 'EXCLUIDA', versao: e.versao + 1, itens: [], itens_historico: e.itens };
      estado.entradas = estado.entradas.map((x) => (x.id === e.id ? excluida : x));
      return { status: 200, body: { ...excluida, replay: false } };
    }
    return rotearEstoque(req);
  };
  return { estado, rotear };
};

/** @type {{ chamadas: any[] }} */
let backend;
let roteador = criarRoteador();
const matchMediaOriginal = window.matchMedia;
const celular = (ligado) => {
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: ligado && /max-width:\s*639px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
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
  sessao.permissao = permissaoCom({ entrada: true });
  roteador = criarRoteador();
  backend = instalarBackendFake(roteador.rotear);
  celular(false);
});

afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const montar = async () => {
  const { default: Pagina } = await import('@/pages/Estoque.jsx');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Toaster />
        <Pagina />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const abrirAbaEntradas = async () => {
  await montar();
  fireEvent.click(await screen.findByTestId('estoque-aba-entradas'));
  await screen.findByText('Ureia');
};
const posts = (caminho) => backend.chamadas.filter((c) => c.method === 'POST' && c.path === caminho);
const digitar = (el, valor) => fireEvent.change(el, { target: { value: valor } });

describe('D-PROD-257 — aba Entradas: lista e detalhe', () => {
  it('a aba existe e lista a entrada com motivo, quantidade e situação; a consulta vai com a fazenda', async () => {
    await abrirAbaEntradas();
    expect(screen.getByText('Saldo de implantação')).toBeTruthy();
    expect(screen.getByText('1.500 kg')).toBeTruthy();
    expect(screen.getByText('Confirmada')).toBeTruthy();
    const g = backend.chamadas.find((c) => c.method === 'GET' && c.path === '/estoque/entradas');
    expect(g.query.empresa_id).toBe('emp-1');
    expect(screen.queryByRole('tab', { name: /Inventário/ })).toBeNull();
  });

  it('o duplo clique na linha abre UMA janela com o detalhe (sem popup sobre popup); no celular ocupa a tela', async () => {
    celular(true);
    await abrirAbaEntradas();
    // no celular a lista vira cartões (sem <tr>): o toque no cartão abre
    const alvo = screen.getByText('Ureia');
    fireEvent.doubleClick(alvo.closest('[data-testid="b1-card"]') ?? alvo);
    const janela = await screen.findByTestId('janela-entrada-estoque');
    expect(janela.querySelector('.b1-janela')?.className).toContain('b1-janela--tela-cheia');
    expect(await within(janela).findByTestId('entrada-detalhe-motivo')).toHaveProperty('textContent', 'Saldo de implantação');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('D-PROD-257 — permissão `entrada` na tela', () => {
  it('sem a ação: não há "Nova entrada" nem Editar/Excluir na janela', async () => {
    sessao.permissao = permissaoCom({});
    await abrirAbaEntradas();
    expect(screen.queryByRole('button', { name: /Nova entrada/ })).toBeNull();
    fireEvent.doubleClick(screen.getByText('Ureia').closest('tr'));
    await screen.findByTestId('entrada-detalhe');
    expect(screen.queryByTestId('entrada-editar')).toBeNull();
    expect(screen.queryByTestId('entrada-excluir')).toBeNull();
  });

  it('com a ação: "Nova entrada" abre um formulário único numa janela', async () => {
    await abrirAbaEntradas();
    fireEvent.click(await screen.findByRole('button', { name: /Nova entrada/ }));
    const janela = await screen.findByTestId('janela-nova-entrada-estoque');
    expect(within(janela).getByTestId('formulario-entrada-estoque')).toBeTruthy();
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Saldo de implantação', 'Doação', 'Outra, com justificativa']);
  });
});

describe('D-PROD-257 — formulário', () => {
  const abrirFormulario = async () => {
    await abrirAbaEntradas();
    fireEvent.click(await screen.findByRole('button', { name: /Nova entrada/ }));
    return screen.findByTestId('janela-nova-entrada-estoque');
  };

  it('enviar vazio mostra o que falta e NÃO chama o servidor', async () => {
    const janela = await abrirFormulario();
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    expect(await within(janela).findByText('Escolha o produto.')).toBeTruthy();
    expect(within(janela).getByText('Escolha o depósito.')).toBeTruthy();
    expect(within(janela).getByText('Informe a quantidade.')).toBeTruthy();
    expect(posts('/estoque/entradas')).toHaveLength(0);
  });

  it('custo zero só com "Custo zero" marcado e, na implantação, com a justificativa; "Outra" exige 20+ caracteres', async () => {
    const janela = await abrirFormulario();
    const quantidade = within(janela).getByTestId('entrada-quantidade');
    digitar(quantidade, '10');
    digitar(within(janela).getByTestId('entrada-custo'), '0');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    expect(await within(janela).findByText('Custo zero só com "Custo zero" marcado.')).toBeTruthy();
    fireEvent.click(within(janela).getByTestId('entrada-custo-zero'));
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    expect(await within(janela).findByText(/Informe a justificativa \(ao menos 10 caracteres\)/)).toBeTruthy();
    fireEvent.click(within(janela).getByRole('radio', { name: 'Outra, com justificativa' }));
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    expect(await within(janela).findByText(/Informe a justificativa \(ao menos 20 caracteres\)/)).toBeTruthy();
    expect(posts('/estoque/entradas')).toHaveLength(0);
  });
});

describe('D-PROD-257 — envio do formulário', () => {
  const escolher = async (janela, testId, rotulo) => {
    await act(async () => fireEvent.click(within(janela).getByTestId(testId)));
    const opcao = await screen.findByRole('option', { name: new RegExp(rotulo, 'i') });
    await act(async () => fireEvent.click(opcao));
  };

  it('doação com custo zero declarado: o corpo vai com decimais como TEXTO, o motivo fechado e uma operation_id; a entrada nova abre no detalhe', async () => {
    await abrirAbaEntradas();
    fireEvent.click(await screen.findByRole('button', { name: /Nova entrada/ }));
    const janela = await screen.findByTestId('janela-nova-entrada-estoque');
    fireEvent.click(within(janela).getByRole('radio', { name: 'Doação' }));
    await escolher(janela, 'entrada-produto', 'Ureia');
    await escolher(janela, 'entrada-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-quantidade'), '250');
    fireEvent.click(within(janela).getByTestId('entrada-custo-zero'));
    digitar(within(janela).getByTestId('entrada-justificativa'), '');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(1));
    const corpo = posts('/estoque/entradas')[0].body;
    expect(corpo).toMatchObject({
      empresa_id: 'emp-1', motivo: 'DOACAO', documento_numero: null, observacao: null, justificativa: null,
      itens: [{ produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade: '250', custo_unitario: '0', custo_zero: true }],
    });
    expect(typeof corpo.data_entrada).toBe('string');
    expect(corpo.operation_id).toMatch(/^ent-/);
    expect(corpo).not.toHaveProperty('cliente_id');
    expect(await screen.findByTestId('janela-entrada-estoque')).toBeTruthy();
  });

  it('erro do servidor aparece na janela, sem fechá-la; reenviar o MESMO conteúdo reaproveita a operation_id', async () => {
    roteador.estado.falhaDoPost = { status: 409, body: { code: 'ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO', message: 'o saldo de implantação só vale para produto sem histórico de estoque; nada foi gravado', request_id: 'x' } };
    await abrirAbaEntradas();
    fireEvent.click(await screen.findByRole('button', { name: /Nova entrada/ }));
    const janela = await screen.findByTestId('janela-nova-entrada-estoque');
    await escolher(janela, 'entrada-produto', 'Ureia');
    await escolher(janela, 'entrada-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-quantidade'), '10');
    digitar(within(janela).getByTestId('entrada-custo'), '3,5');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    expect(await within(janela).findByTestId('entrada-erro')).toBeTruthy();
    expect(within(janela).getByTestId('entrada-erro').textContent).toContain('sem histórico de estoque');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(2));
    const [a, b] = posts('/estoque/entradas');
    expect(a.body.operation_id).toBe(b.body.operation_id);
    expect(a.body.itens[0].custo_unitario).toBe('3.5');
  });
});

describe('D-PROD-257 — excluir na mesma janela', () => {
  it('Excluir entrada pede o motivo, manda versão e operation_id e mostra a entrada como excluída', async () => {
    await abrirAbaEntradas();
    fireEvent.doubleClick(screen.getByText('Ureia').closest('tr'));
    const janela = await screen.findByTestId('janela-entrada-estoque');
    fireEvent.click(await within(janela).findByTestId('entrada-excluir'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-confirmar-exclusao')));
    expect(await within(janela).findByText(/Informe o motivo da exclusão/)).toBeTruthy();
    expect(posts('/estoque/entradas/e1/excluir')).toHaveLength(0);
    digitar(within(janela).getByTestId('entrada-exclusao-motivo'), 'lançada por engano');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-confirmar-exclusao')));
    await waitFor(() => expect(posts('/estoque/entradas/e1/excluir')).toHaveLength(1));
    const corpo = posts('/estoque/entradas/e1/excluir')[0].body;
    expect(corpo).toMatchObject({ empresa_id: 'emp-1', versao: 1, motivo: 'lançada por engano' });
    expect(corpo.operation_id).toMatch(/^ent-/);
    expect(await within(janela).findByTestId('entrada-detalhe-situacao')).toHaveProperty('textContent', 'Excluída');
    expect(within(janela).queryByTestId('entrada-excluir')).toBeNull();
  });
});
