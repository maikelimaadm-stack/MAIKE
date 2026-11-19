/**
 * D-PROD-259 — "Novo movimento" do Estoque montado de verdade (página, motor Base1, service, API, porta e
 * nativeHttpClient reais sobre um backend falso). Mocks só da borda: sessão e permissão.
 *
 *  - só as abas Saldo e Movimentos (a aba Entradas saiu); "Novo movimento" em Movimentos, só com a ação `entrada`;
 *  - UMA janela em que se escolhe o tipo (Entrada ou Transferência); o motivo vem do cadastro (gerenciado na mesma
 *    janela, sem popup sobre popup); a Entrada tem cabeçalho e vários produtos; valor unitário ↔ total;
 *  - o corpo vai com decimais como TEXTO, `motivo_id`, fornecedor, centros, lote e validade; o saldo de implantação
 *    não leva fornecedor nem documento; reenvio do mesmo conteúdo reaproveita a `operation_id`;
 *  - a Transferência chama o comando de transferência; o detalhe de um movimento de entrada abre a entrada (excluir).
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

const MOTIVOS = [
  { id: 'mot-compra', nome: 'Compra', natureza: 'ENTRADA', ativo: true, padrao: false },
  { id: 'mot-doacao', nome: 'Doação', natureza: 'ENTRADA', ativo: true, padrao: false },
  { id: 'mot-impl', nome: 'Saldo de implantação', natureza: 'SALDO_IMPLANTACAO', ativo: true, padrao: true },
];
const ITEM = {
  id: 'i1', ordem: 1, produto_id: 'p-ureia', produto_nome: 'Ureia', local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'KG', quantidade: '1500.0000',
  fator_kg: '1.0000', quantidade_estoque: '1500.0000', unidade_estoque: 'KG', custo_unitario: '3.4000', custo_kg: '3.4000', valor_total: '5100.0000', custo_zero: false,
  lote_fabricante: 'L-77', data_validade: '2027-03-31', estoque_lote_nota_id: 'c1', movimentacao_estoque_id: 'm1', movimentacao_estorno_id: null, revisao_inicio: 1, revisao_fim: null,
};
const ENTRADA = {
  id: 'e1', empresa_id: 'emp-1', numero: '7', status: 'CONFIRMADA', versao: 1, revisao: 1, motivo: 'ENTRADA', motivo_id: 'mot-compra', motivo_nome: 'Compra', data_entrada: '2026-11-10',
  fornecedor_id: 'f1', fornecedor_nome: 'Agro Sul', documento_numero: 'NF 77', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: 'cr1', centro_resultado_nome: 'Pecuária',
  observacao: 'compra avulsa', excluida_em: null, criada_em: '2026-11-10T12:00:00.000Z', itens: [ITEM], itens_historico: [],
  eventos: [{ id: 'v1', tipo: 'CONFIRMACAO', modo: null, motivo: 'Entrada manual: Compra', criado_em: '2026-11-10T12:00:00.000Z' }],
};

/** Backend falso: o do Estoque + as rotas das Entradas, dos motivos e da transferência (estado em memória). */
const criarRoteador = () => {
  const estado = { entradas: [ENTRADA], motivos: [...MOTIVOS], falhaDoPost: /** @type {null|{status:number, body:any}} */ (null) };
  const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });
  const rotear = async (req) => {
    const { method, path, query, body } = req;
    if (path === '/estoque/motivos-entrada' && method === 'GET') {
      const ativos = query.get('ativos') === 'true';
      return { status: 200, body: { items: estado.motivos.filter((m) => !ativos || m.ativo) } };
    }
    if (path === '/estoque/motivos-entrada' && method === 'POST') {
      const m = { id: `mot-${estado.motivos.length + 1}`, nome: body.nome, natureza: 'ENTRADA', ativo: true, padrao: false };
      estado.motivos.push(m);
      return { status: 201, body: m };
    }
    if (path === '/estoque/entradas/opcoes/produtos') return opcoes([{ id: 'p-ureia', nome: 'Ureia', codigo: null, unidade_estoque: 'KG', peso_por_saco_kg: null }, { id: 'p-sal', nome: 'Sal mineral', codigo: null, unidade_estoque: 'KG', peso_por_saco_kg: '25.0000' }]);
    if (path === '/estoque/entradas/opcoes/locais') return opcoes([{ id: 'l-galpao', nome: 'Galpão insumos' }, { id: 'l-tanque', nome: 'Tanque diesel sede' }]);
    if (path === '/estoque/entradas/opcoes/fornecedores') return opcoes([{ id: 'f1', nome: 'Agro Sul', numero: '1', papeis: ['fornecedor'] }]);
    if (path === '/estoque/entradas/opcoes/centros-custo') return opcoes([{ id: 'cc1', nome: 'Confinamento', numero: '1' }]);
    if (path === '/estoque/entradas/opcoes/centros-resultado') return opcoes([{ id: 'cr1', nome: 'Pecuária', numero: '1' }]);
    if (path === '/estoque/movimentos/m1' && method === 'GET') {
      const base = await rotearEstoque(req);
      return { ...base, body: { ...base.body, tipo_detalhado: 'entrada_manual', documento: { tipo: 'ENTRADA_ESTOQUE', id: 'e1', numero: '7', rotulo: 'Entrada nº 7 — Compra', pagina: null } } };
    }
    const m = /^\/estoque\/entradas\/([^/]+)(\/excluir)?$/.exec(path);
    if (m && method === 'GET') return { status: 200, body: estado.entradas.find((e) => e.id === m[1]) };
    if (path === '/estoque/entradas' && method === 'POST') {
      if (estado.falhaDoPost) return estado.falhaDoPost;
      const criada = { ...ENTRADA, id: 'e2', numero: '8', motivo_id: body.motivo_id };
      estado.entradas = [criada, ...estado.entradas];
      return { status: 201, body: { ...criada, replay: false } };
    }
    if (m && m[2] && method === 'POST') {
      const e = estado.entradas.find((x) => x.id === m[1]);
      const excluida = { ...e, status: 'EXCLUIDA', versao: e.versao + 1, itens: [], itens_historico: e.itens };
      estado.entradas = estado.entradas.map((x) => (x.id === e.id ? excluida : x));
      return { status: 200, body: { ...excluida, replay: false } };
    }
    if (path === '/movimentacoes-estoque/comandos/transferencia-locais' && method === 'POST') return { status: 201, body: { committed: true, operation_id: body.operation_id, replay: false } };
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
const abrirMovimentos = async () => {
  await montar();
  fireEvent.click(await screen.findByTestId('estoque-aba-movimentos'));
  await screen.findByText('Diesel S10', {}, { timeout: 3000 }).catch(() => null);
};
const abrirNovoMovimento = async () => {
  await abrirMovimentos();
  fireEvent.click(await screen.findByRole('button', { name: /Novo movimento/ }));
  return screen.findByTestId('janela-novo-movimento-estoque');
};
const posts = (caminho) => backend.chamadas.filter((c) => c.method === 'POST' && c.path === caminho);
const digitar = (el, valor) => fireEvent.change(el, { target: { value: valor } });
/** Seletor paginado (lista de opções do servidor). */
const escolher = async (janela, testId, rotulo) => {
  await act(async () => fireEvent.click(within(janela).getByTestId(testId)));
  const opcao = await screen.findByRole('option', { name: new RegExp(rotulo, 'i') });
  await act(async () => fireEvent.click(opcao));
};
/** Seletor Base1 de opções fixas (o do motivo). */
const escolherNoSelect = async (rotulo, nome) => {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    await act(async () => fireEvent.click(screen.getByLabelText(rotulo)));
    const opcao = screen.queryAllByRole('option').find((o) => o.textContent.trim().toLowerCase() === nome.toLowerCase());
    if (opcao) {
      await act(async () => fireEvent.click(opcao));
      return;
    }
  }
  throw new Error(`opção ${nome} não apareceu em ${rotulo}`);
};

describe('D-PROD-259 — abas e botão', () => {
  it('só Saldo e Movimentos: a aba Entradas saiu', async () => {
    await montar();
    expect(await screen.findByTestId('estoque-aba-saldo')).toBeTruthy();
    expect(screen.getByTestId('estoque-aba-movimentos')).toBeTruthy();
    expect(screen.queryByTestId('estoque-aba-entradas')).toBeNull();
  });

  it('sem a ação `entrada` não há "Novo movimento"', async () => {
    sessao.permissao = permissaoCom({});
    await abrirMovimentos();
    await waitFor(() => expect(backend.chamadas.some((c) => c.path === '/estoque/movimentos')).toBe(true));
    expect(screen.queryByRole('button', { name: /Novo movimento/ })).toBeNull();
  });

  it('com a ação: "Novo movimento" abre UMA janela com o tipo de movimento (Entrada ou Transferência); no celular ocupa a tela', async () => {
    celular(true);
    const janela = await abrirNovoMovimento();
    expect(janela.querySelector('.b1-janela')?.className).toContain('b1-janela--tela-cheia');
    expect(within(janela).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Entrada', 'Transferência']);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('D-PROD-259 — Entrada', () => {
  it('cada produto é um cartão de linha inteira com grade própria (a grade compacta de 4 colunas da Base1 não pode achatar a linha)', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByTestId('entrada-adicionar-produto'));
    for (const i of [0, 1]) {
      const linha = within(janela).getByTestId(`entrada-linha-${i}`);
      expect(linha.className).toContain('b1-form-embutido');
      expect(linha.className).not.toContain('mg-b1-form-grid');
      // Os campos ficam numa grade DENTRO do cartão (não são filhos diretos da grade do formulário).
      const grade = /** @type {HTMLElement} */ (linha.firstElementChild);
      expect(grade.className).toContain('grid-cols-12');
      expect(grade.contains(within(linha).getByTestId(`entrada-linha-${i}-produto`))).toBe(true);
    }
  });

  it('no celular a folha de uma lista nasce DENTRO da janela (senão a janela modal cobre a folha e as opções não recebem o toque)', async () => {
    celular(true);
    const janela = await abrirNovoMovimento();
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-linha-0-produto')));
    const folha = await waitFor(() => {
      const f = document.querySelector('.mk-sheet-root');
      expect(f).not.toBeNull();
      return /** @type {HTMLElement} */ (f);
    });
    expect(janela.contains(folha)).toBe(true);
  });

  it('enviar vazio mostra o que falta e NÃO chama o servidor', async () => {
    const janela = await abrirNovoMovimento();
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText('Escolha o motivo da entrada.')).toBeTruthy();
    expect(within(janela).getByText('Escolha o produto.')).toBeTruthy();
    expect(within(janela).getByText('Escolha o depósito.')).toBeTruthy();
    expect(within(janela).getByText('Informe a quantidade.')).toBeTruthy();
    expect(posts('/estoque/entradas')).toHaveLength(0);
  });

  it('Compra com fornecedor, documento, centros e 2 produtos: o total se calcula e o corpo vai com motivo_id, lote, validade e decimais como TEXTO', async () => {
    const janela = await abrirNovoMovimento();
    await escolherNoSelect('Motivo', 'Compra');
    await escolher(janela, 'entrada-fornecedor', 'Agro Sul');
    digitar(within(janela).getByLabelText(/^Documento/), 'NF 55');
    await escolher(janela, 'entrada-centro-resultado', 'Pecuária');
    await escolher(janela, 'entrada-centro-custo', 'Confinamento');
    await escolher(janela, 'entrada-linha-0-produto', 'Ureia');
    await escolher(janela, 'entrada-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '100');
    digitar(within(janela).getByTestId('entrada-linha-0-custo'), '3,5');
    expect(within(janela).getByTestId('entrada-linha-0-total').value).toBe('350');
    digitar(within(janela).getByLabelText('Lote', { selector: 'input' }), 'L-2026');
    digitar(within(janela).getByTestId('entrada-linha-0-validade'), '2027-03-31');
    fireEvent.click(within(janela).getByTestId('entrada-adicionar-produto'));
    await escolher(janela, 'entrada-linha-1-produto', 'Sal mineral');
    await escolher(janela, 'entrada-linha-1-deposito', 'Tanque diesel sede');
    digitar(within(janela).getByTestId('entrada-linha-1-quantidade'), '10');
    digitar(within(janela).getByTestId('entrada-linha-1-total'), '25');
    expect(within(janela).getByTestId('entrada-linha-1-custo').value).toBe('2,5');
    expect(within(janela).getByTestId('entrada-valor-total').textContent).toMatch(/375,00/);
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(1));
    const corpo = posts('/estoque/entradas')[0].body;
    expect(corpo).toMatchObject({
      empresa_id: 'emp-1', motivo_id: 'mot-compra', fornecedor_id: 'f1', documento_numero: 'NF 55', centro_custo_id: 'cc1', centro_resultado_id: 'cr1', observacao: null,
      itens: [
        { produto_id: 'p-ureia', local_estoque_id: 'l-galpao', unidade: 'KG', quantidade: '100', custo_unitario: '3.5', lote_fabricante: 'L-2026', data_validade: '2027-03-31' },
        { produto_id: 'p-sal', local_estoque_id: 'l-tanque', unidade: 'KG', quantidade: '10', custo_unitario: '2.5', lote_fabricante: null, data_validade: null },
      ],
    });
    expect(corpo.operation_id).toMatch(/^ent-/);
    expect(corpo).not.toHaveProperty('motivo');
    expect(corpo).not.toHaveProperty('justificativa');
    expect(corpo).not.toHaveProperty('cliente_id');
    expect(await screen.findByTestId('janela-entrada-estoque')).toBeTruthy();
  });

  it('Saldo de implantação esconde fornecedor e documento e não os envia', async () => {
    const janela = await abrirNovoMovimento();
    await escolherNoSelect('Motivo', 'Saldo de implantação');
    expect(within(janela).getByTestId('entrada-aviso-implantacao')).toBeTruthy();
    expect(within(janela).queryByTestId('entrada-fornecedor')).toBeNull();
    expect(within(janela).queryByLabelText(/^Documento/)).toBeNull();
    await escolher(janela, 'entrada-linha-0-produto', 'Ureia');
    await escolher(janela, 'entrada-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '50');
    fireEvent.click(within(janela).getByTestId('entrada-linha-0-sem-custo'));
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(1));
    expect(posts('/estoque/entradas')[0].body).toMatchObject({ motivo_id: 'mot-impl', fornecedor_id: null, documento_numero: null, itens: [{ custo_unitario: '0', custo_zero: true }] });
  });

  it('erro do servidor aparece na janela; reenviar o MESMO conteúdo reaproveita a operation_id', async () => {
    roteador.estado.falhaDoPost = { status: 422, body: { code: 'ENTRADA_ESTOQUE_INVALIDA', message: 'x', field: 'fornecedor_id', reason: 'fornecedor_inativo', request_id: 'x' } };
    const janela = await abrirNovoMovimento();
    await escolherNoSelect('Motivo', 'Compra');
    await escolher(janela, 'entrada-linha-0-produto', 'Ureia');
    await escolher(janela, 'entrada-linha-0-deposito', 'Galpão insumos');
    digitar(within(janela).getByTestId('entrada-linha-0-quantidade'), '10');
    digitar(within(janela).getByTestId('entrada-linha-0-custo'), '3');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect((await within(janela).findByTestId('movimento-erro')).textContent).toContain('fornecedor está inativo');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/estoque/entradas')).toHaveLength(2));
    const [a, b] = posts('/estoque/entradas');
    expect(a.body.operation_id).toBe(b.body.operation_id);
  });

  it('"Motivos…" gerencia o cadastro DENTRO da mesma janela: incluir um motivo e voltar para a entrada', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByTestId('entrada-gerenciar-motivos'));
    const motivos = await within(janela).findByTestId('motivos-entrada');
    expect(await within(motivos).findByText('Saldo de implantação')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    digitar(within(motivos).getByLabelText('Novo motivo'), 'Devolução');
    await act(async () => fireEvent.click(within(motivos).getByTestId('motivo-incluir')));
    await waitFor(() => expect(posts('/estoque/motivos-entrada')).toHaveLength(1));
    expect(posts('/estoque/motivos-entrada')[0].body).toEqual({ nome: 'Devolução' });
    fireEvent.click(within(janela).getByTestId('motivos-voltar'));
    expect(await within(janela).findByTestId('formulario-novo-movimento')).toBeTruthy();
  });
});

describe('D-PROD-259 — Transferência', () => {
  it('mesmo depósito na origem e no destino é recusado na tela; certo, chama o comando de transferência com a quantidade', async () => {
    const janela = await abrirNovoMovimento();
    fireEvent.click(within(janela).getByRole('radio', { name: 'Transferência' }));
    await escolher(janela, 'transferencia-produto', 'Ureia');
    await escolher(janela, 'transferencia-origem', 'Galpão insumos');
    await escolher(janela, 'transferencia-destino', 'Galpão insumos');
    digitar(within(janela).getByTestId('transferencia-quantidade'), '30,5');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    expect(await within(janela).findByText('O destino tem de ser outro depósito.')).toBeTruthy();
    expect(posts('/movimentacoes-estoque/comandos/transferencia-locais')).toHaveLength(0);
    await escolher(janela, 'transferencia-destino', 'Tanque diesel sede');
    await act(async () => fireEvent.click(within(janela).getByTestId('movimento-lancar')));
    await waitFor(() => expect(posts('/movimentacoes-estoque/comandos/transferencia-locais')).toHaveLength(1));
    const corpo = posts('/movimentacoes-estoque/comandos/transferencia-locais')[0].body;
    expect(corpo).toMatchObject({ empresa_id: 'emp-1', produto_id: 'p-ureia', local_origem_id: 'l-galpao', local_destino_id: 'l-tanque', quantidade: 30.5 });
    expect(corpo.operation_id).toMatch(/^trf-/);
    await waitFor(() => expect(screen.queryByTestId('janela-novo-movimento-estoque')).toBeNull());
  });
});

describe('D-PROD-259 — do movimento para a entrada', () => {
  it('o detalhe do movimento de entrada leva à entrada (fecha um, abre o outro) e lá se exclui com motivo, versão e operation_id', async () => {
    await abrirMovimentos();
    fireEvent.doubleClick((await screen.findByText('101')).closest('tr'));
    const mov = await screen.findByTestId('movimento-abrir-entrada');
    fireEvent.click(mov);
    const janela = await screen.findByTestId('janela-entrada-estoque');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(await within(janela).findByTestId('entrada-detalhe-fornecedor')).toHaveProperty('textContent', 'Agro Sul');
    expect(within(janela).getByTestId('entrada-detalhe-lote').textContent).toBe('L-77');
    fireEvent.click(within(janela).getByTestId('entrada-excluir'));
    digitar(within(janela).getByTestId('entrada-exclusao-motivo'), 'lançada por engano');
    await act(async () => fireEvent.click(within(janela).getByTestId('entrada-confirmar-exclusao')));
    await waitFor(() => expect(posts('/estoque/entradas/e1/excluir')).toHaveLength(1));
    expect(posts('/estoque/entradas/e1/excluir')[0].body).toMatchObject({ empresa_id: 'emp-1', versao: 1, motivo: 'lançada por engano' });
    expect(await within(janela).findByTestId('entrada-detalhe-situacao')).toHaveProperty('textContent', 'Excluída');
  });
});
