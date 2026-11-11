/**
 * D-PROD-157 — tela Bens Patrimoniais montada de verdade (página, motor Base1,
 * formulário em abas, service, API, porta e nativeHttpClient reais). Mocks só
 * da borda: `fetch` (backend falso) e a sessão (usuário/permissão efetiva).
 *
 *  - criação com o corpo EXATO do POST: trator TP-02 (horímetro + tanque de
 *    180 L que aceita o Produto Diesel S10), caminhonete flex UT-04 (odômetro +
 *    um tanque de 80 L que aceita Gasolina e Etanol), curral (sem medições:
 *    D-PROD-162);
 *  - seções e campos condicionais pela natureza da família (espelho da matriz
 *    §2: medidor obrigatório/opcional, tanques, placa, chassi…; sem aba
 *    Medições, D-PROD-162);
 *  - prévia de depreciação rotulada como simulação (1.250,00 por mês);
 *  - edição com PATCH mínimo + `versao`; 409/422 mostram a mensagem do
 *    patrimônio e mantêm o formulário; conflito de versão relê o detalhe;
 *  - sem empresa → aviso e nada lido; sem a ação `inativar` → sem o item;
 *  - referências da fazenda, aquisição/depreciação e troca de propriedade com
 *    o corpo HTTP exato; cancelar a edição descarta o digitado; correção do
 *    medidor não envia o que o servidor recusa; "hoje" da leitura no fuso da
 *    fazenda; duplicar só leva os Produtos aceitos que ainda servem (ativos,
 *    em L ou KG).
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
  modulos_permitidos: ['patrimonio'],
  permissoes_telas: [{ tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });
const FAMILIAS = [
  { id: 'f1', codigo: 'BENFEITORIAS', nome: 'Benfeitorias e instalações', natureza: 'BENFEITORIA' },
  { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA' },
  { id: 'f3', codigo: 'VEICULOS', nome: 'Veículos', natureza: 'VEICULO' },
  { id: 'f4', codigo: 'IMPLEMENTOS', nome: 'Implementos', natureza: 'IMPLEMENTO' },
  { id: 'f5', codigo: 'EQUIPAMENTOS', nome: 'Equipamentos', natureza: 'EQUIPAMENTO' },
  { id: 'f6', codigo: 'OUTROS', nome: 'Outros bens', natureza: 'OUTRO' },
];
const TIPOS = {
  f1: [{ id: 't1', codigo: 'CURRAL', nome: 'Curral', familia_id: 'f1' }],
  f2: [{ id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', familia_id: 'f2' }],
  f3: [{ id: 't3', codigo: 'CAMINHONETE', nome: 'Caminhonete', familia_id: 'f3' }],
  f4: [{ id: 't4', codigo: 'ROCADEIRA', nome: 'Roçadeira', familia_id: 'f4' }],
  f5: [{ id: 't5', codigo: 'GERADOR', nome: 'Gerador', familia_id: 'f5' }],
  f6: [{ id: 't6', codigo: 'BALSA', nome: 'Balsa', familia_id: 'f6' }],
};
/** Produtos ativos da fazenda em L ou KG (D-PROD-162: o que um tanque pode aceitar). */
const PRODUTOS = [
  { id: 'pd1', nome: 'Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L' },
  { id: 'pd2', nome: 'Gasolina', codigo_interno: null, unidade_principal_estoque: 'L' },
  { id: 'pd3', nome: 'Etanol', codigo_interno: null, unidade_principal_estoque: 'L' },
  { id: 'pd4', nome: 'Arla 32', codigo_interno: 'ARLA', unidade_principal_estoque: 'KG' },
];
/** Opções da EMPRESA (seletores do bem). */
const OPCOES_DA_EMPRESA = {
  responsaveis: [{ id: 'u7', nome: 'João Vaqueiro' }],
  'centros-custo': [{ id: 'cc1', numero: '12', nome: 'Manutenção' }],
  areas: [{ id: 'a1', nome: 'Retiro Sul' }],
  parceiros: [{ id: 'pc1', nome: 'Agro Máquinas' }, { id: 'pc2', nome: 'Vizinho da Divisa' }],
};
const RESUMO_TRATOR = {
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', familia: { id: 'f2', nome: 'Máquinas' },
  tipo: { id: 't2', nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 4,
};
const detalheTrator = (versao = 4) => ({
  ...RESUMO_TRATOR,
  versao,
  empresa_id: 'emp-1',
  familia: { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
  tipo: { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', ativo: true },
  proprietario: null, responsavel: null, centro_custo: null, area: null,
  localizacao_descricao: null, marca: 'Valtra', modelo: 'A950', ano_fabricacao: 2020, ano_modelo: 2021, numero_serie: 'SN-1', chassi: null, placa: null, placa_uf: null, renavam: null,
  potencia_cv: '95.0000', material: null, ano_conclusao: null, compatibilidade: null, especificacoes: null, observacoes: null,
  medidor: { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' },
  tanques: [{
    id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
    produtos: [{ produto_id: 'pd1', nome: 'Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L', produto_ativo: true }],
  }],
  aquisicao: { data_aquisicao: null, data_disponibilidade: null, valor_aquisicao: null, custo_incorporacao: null, fornecedor: null, documento_referencia: null, garantia_ate: null },
  depreciacao: { depreciavel: false, metodo: null, vida_util_meses: null, residual_modo: null, valor_residual: null, residual_percentual: null, data_inicio_depreciacao: null, previa: null },
  consumo: null,
});
const RESUMO_CURRAL = {
  id: 'b2', numero: '9', codigo_frota: null, nome: 'Curral de manejo', natureza: 'BENFEITORIA', familia: { id: 'f1', nome: 'Benfeitorias e instalações' },
  tipo: { id: 't1', nome: 'Curral' }, propriedade: 'PROPRIO', medidor_tipo: null, ativo: true, versao: 2,
};
const detalheCurral = () => ({
  ...detalheTrator(2), ...RESUMO_CURRAL,
  familia: { id: 'f1', codigo: 'BENFEITORIAS', nome: 'Benfeitorias e instalações', natureza: 'BENFEITORIA', ativo: true },
  tipo: { id: 't1', codigo: 'CURRAL', nome: 'Curral', ativo: true },
  marca: null, modelo: null, ano_fabricacao: null, ano_modelo: null, numero_serie: null, potencia_cv: null, material: 'Madeira', ano_conclusao: 2019,
  medidor: null, tanques: [],
});
const RESUMO_OUTRA_EMPRESA = { ...RESUMO_TRATOR, id: 'b5', numero: '1', codigo_frota: 'TP-02', nome: 'Trator da outra fazenda', versao: 1 };
const PREVIA = {
  simulada: true, contabilizada: false, metodo: 'LINEAR', custo_base: '200000.00', valor_residual: '50000.00', valor_depreciavel: '150000.00', vida_util_meses: 120,
  quota_mensal: '1250.00', ultima_quota: '1250.00', quota_anual: '15000.00', taxa_anual_percentual: '10.0000', primeira_competencia: '2026-01', ultima_competencia: '2035-12',
  valor_contabil: null, depreciacao_acumulada: null, aviso: 'Prévia gerencial simulada: não gera lançamento, título, despesa nem movimento de estoque.',
};

let backend;
/** Resposta de erro injetada na PRÓXIMA gravação. */
let proxima;
let versaoDetalhe;
/** Medidor do trator gravado (quando o teste quer outro estado). */
let medidorDoTrator;
/** Outros campos do detalhe do trator (quando o teste quer outro estado). */
let extraDoTrator;
/** Resumo das empresas (GET /empresas, o mesmo que o Layout lê): traz o fuso da fazenda. */
let empresasDoBackend;

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
  versaoDetalhe = 4;
  medidorDoTrator = null;
  extraDoTrator = null;
  empresasDoBackend = [
    { id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Sao_Paulo' },
    { id: 'emp-2', numero_empresa: 2, nome: 'Fazenda Santa Rita', fuso_horario: 'America/Sao_Paulo' },
  ];
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proxima && method !== 'GET') {
      const r = proxima;
      proxima = null;
      return r;
    }
    if (method === 'GET' && path === '/bens-patrimoniais') {
      const itens = query.get('empresa_id') === 'emp-2' ? [RESUMO_OUTRA_EMPRESA] : [{ ...RESUMO_TRATOR, versao: versaoDetalhe }, RESUMO_CURRAL];
      return { status: 200, body: envelope(itens.filter((b) => !query.get('familia_id') || b.familia.id === query.get('familia_id'))) };
    }
    if (method === 'GET' && path === '/empresas') return { status: 200, body: empresasDoBackend };
    if (method === 'GET' && path === '/bens-patrimoniais/b1') {
      return { status: 200, body: { ...detalheTrator(versaoDetalhe), ...(medidorDoTrator ? { medidor: medidorDoTrator } : {}), ...(extraDoTrator ?? {}) } };
    }
    if (method === 'GET' && path === '/bens-patrimoniais/b2') return { status: 200, body: detalheCurral() };
    if (method === 'PATCH' && path === '/bens-patrimoniais/b2') return { status: 200, body: { ...detalheCurral(), versao: 3 } };
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/familias') return opcoes(FAMILIAS);
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/tipos') return opcoes(TIPOS[query.get('familia_id')] ?? []);
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/produtos') {
      return opcoes(PRODUTOS.filter((p) => !query.get('unidade') || p.unidade_principal_estoque === query.get('unidade')));
    }
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return opcoes(OPCOES_DA_EMPRESA[path.split('/')[2]] ?? []);
    if (method === 'POST' && path === '/bens-patrimoniais-previa-depreciacao') return { status: 200, body: PREVIA };
    if (method === 'POST' && path === '/bens-patrimoniais') {
      const familia = FAMILIAS.find((f) => f.id === body.familia_id);
      const tipo = Object.values(TIPOS).flat().find((t) => t.id === body.tipo_id);
      return {
        status: 201,
        body: {
          id: 'b9', numero: '8', versao: 1, ativo: true, nome: body.nome, natureza: familia.natureza, codigo_frota: body.codigo_frota ?? null,
          familia: { ...familia, ativo: true }, tipo: { id: tipo.id, codigo: tipo.codigo, nome: tipo.nome, ativo: true }, propriedade: 'PROPRIO', tanques: [], medidor: null,
        },
      };
    }
    if (method === 'PATCH' && path === '/bens-patrimoniais/b1') {
      versaoDetalhe += 1;
      return { status: 200, body: { ...detalheTrator(versaoDetalhe), ...(body.nome ? { nome: body.nome } : {}), ...(body.ativo === false ? { ativo: false } : {}) } };
    }
    return undefined;
  });
});

afterEach(() => {
  vi.useRealTimers();
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
const listagens = () => backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais');
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
const editar = () => fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
const escolherNoSeletor = async (form, testId, nome) => {
  fireEvent.click(within(form).getByTestId(testId));
  fireEvent.click(await within(form).findByRole('option', { name: nome }));
  await waitFor(() => expect(within(form).queryByTestId(`${testId}-painel`)).toBeNull());
};
const aba = (nome) => fireEvent.click(screen.getByRole('tab', { name: nome }));
/** Aceita um Produto no tanque `i` pelo seletor paginado (D-PROD-162). */
const aceitarProduto = async (form, i, nome) => escolherNoSeletor(form, `bem-tanque-seletor-produto-${i}`, nome);
const abas = () => screen.getAllByRole('tab').map((t) => t.textContent.trim());
const novo = async () => {
  await screen.findByTestId('bem-nome-b1');
  fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
  return screen.findByTestId('b1-form');
};
const abrirTrator = async () => {
  fireEvent.doubleClick(await screen.findByTestId('bem-nome-b1'));
  return screen.findByTestId('b1-form');
};
/** Novo bem com nome, família e tipo escolhidos. */
const novoDaFamilia = async (nome, familia, tipo) => {
  const form = await novo();
  fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: nome } });
  await escolherNoSeletor(form, 'bem-seletor-familia', familia);
  await escolherNoSeletor(form, 'bem-seletor-tipo', tipo);
  return form;
};

describe('Bens — lista e empresa', () => {
  it('lista da empresa selecionada (ativos) e abre o detalhe com empresa_id na query', async () => {
    await montar();
    expect(await screen.findByTestId('bem-numero-b1')).toHaveTextContent('7');
    expect(within(screen.getByTestId('bem-nome-b1').closest('tr')).getByText('TP-02')).toBeTruthy();
    expect(listagens()[0].query).toMatchObject({ empresa_id: 'emp-1', ativo: 'true' });
    await abrirTrator();
    expect(backend.chamadas.find((c) => c.path === '/bens-patrimoniais/b1').query).toEqual({ empresa_id: 'emp-1' });
  });

  it('sem empresa real (só o cliente) mostra o aviso: nenhum bem é lido e não há Novo', async () => {
    window.localStorage.setItem('empresa_selecionada_id', 'cli-1');
    await montar();
    expect(await screen.findByTestId('patrimonio-sem-empresa')).toHaveTextContent(/Selecione uma empresa/);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(listagens()).toEqual([]);
    expect(backend.chamadas.some((c) => c.path.startsWith('/bens-patrimoniais/'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
  });

  it('sem visualizar: aviso de permissão e nenhuma listagem', async () => {
    sessao.permissao = { user_email: 'operador', modulos_permitidos: ['patrimonio'], permissoes_telas: [] };
    await montar();
    expect(await screen.findByTestId('patrimonio-sem-permissao')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(listagens()).toEqual([]);
  });

  it('filtro de família manda familia_id; trocar de empresa fecha o registro e relê com a nova empresa', async () => {
    await montar();
    await screen.findByTestId('bem-nome-b1');
    await escolherOpcao(screen.getByRole('combobox', { name: 'Filtrar por família' }), 'Máquinas');
    await waitFor(() => expect(listagens().some((c) => c.query.familia_id === 'f2' && c.query.empresa_id === 'emp-1')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('bem-nome-b2')).toBeNull());
    await abrirTrator();
    const { persistirEmpresaSelecionada } = await import('@/hooks/useEmpresaSelecionadaId');
    act(() => persistirEmpresaSelecionada('emp-2', 'cli-1'));
    expect(await screen.findByTestId('bem-nome-b5')).toBeTruthy();
    expect(screen.queryByTestId('b1-form')).toBeNull();
    expect(screen.queryByTestId('bem-nome-b1')).toBeNull();
    expect(listagens().some((c) => c.query.empresa_id === 'emp-2')).toBe(true);
    // O detalhe do bem aberto nunca é pedido com a empresa nova.
    expect(backend.chamadas.filter((c) => c.path === '/bens-patrimoniais/b1').every((c) => c.query.empresa_id === 'emp-1')).toBe(true);
  });
});

describe('Bens — criação (corpo exato)', () => {
  it('trator TP-02 com horímetro e tanque de 180 L que aceita o Produto Diesel S10; sem aba Medições', async () => {
    await montar();
    const form = await novo();
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Trator TP-02' } });
    fireEvent.change(within(form).getByLabelText(/^Código de frota/), { target: { value: ' tp-02 ' } });
    await escolherNoSeletor(form, 'bem-seletor-familia', /^Máquinas/);
    await escolherNoSeletor(form, 'bem-seletor-tipo', /Trator de pneus/);
    expect(backend.chamadas.find((c) => c.path === '/bens-patrimoniais-opcoes/tipos').query).toMatchObject({ familia_id: 'f2' });
    expect(backend.chamadas.filter((c) => c.path.startsWith('/bens-patrimoniais-opcoes/')).every((c) => c.query.empresa_id === undefined)).toBe(true);
    expect(screen.queryByRole('tab', { name: 'Medições' })).toBeNull();

    aba('Operação');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Horímetro');
    fireEvent.change(within(form).getByLabelText('Leitura inicial (h)'), { target: { value: '1.250' } });
    fireEvent.change(within(form).getByTestId('bem-medidor-data'), { target: { value: '2026-11-01' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar tanque' }));
    const tanque = within(form).getByTestId('bem-tanque-0');
    fireEvent.change(within(tanque).getByLabelText(/^Identificador/), { target: { value: 'Principal' } });
    fireEvent.change(within(tanque).getByLabelText('Capacidade (L)'), { target: { value: '180' } });
    expect(within(tanque).getByTestId('bem-tanque-sem-produto-0')).toHaveTextContent('Este tanque não pode ser abastecido até ter um Produto aceito.');
    await aceitarProduto(form, 0, /Diesel S10/);
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd1')).toHaveTextContent(/Diesel S10/);
    expect(within(tanque).queryByTestId('bem-tanque-sem-produto-0')).toBeNull();
    // Os Produtos aceitos são da fazenda (empresa na query), sem filtro de unidade por padrão.
    const pedidos = backend.chamadas.filter((c) => c.path === '/bens-patrimoniais-opcoes/produtos');
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.every((c) => c.query.empresa_id === 'emp-1' && c.query.unidade === undefined)).toBe(true);

    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()).toHaveLength(1);
    expect(mutacoes()[0]).toEqual(expect.objectContaining({
      method: 'POST',
      path: '/bens-patrimoniais',
      body: {
        empresa_id: 'emp-1', nome: 'Trator TP-02', familia_id: 'f2', tipo_id: 't2', codigo_frota: 'TP-02', propriedade: 'PROPRIO',
        medidor: { tipo: 'HORIMETRO', leitura_inicial: '1250', data_leitura: '2026-11-01' },
        tanques: [{ identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1'] }],
      },
    }));
    // Depois de criar, o registro fica aberto em modo leitura com o detalhe devolvido.
    await waitFor(() => expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nº patrimonial/).value).toBe('8'));
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).readOnly).toBe(true);
  });

  it('caminhonete flex UT-04: odômetro, placa Mercosul normalizada e um tanque de 80 L que aceita Gasolina e Etanol', async () => {
    await montar();
    const form = await novo();
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Caminhonete UT-04' } });
    fireEvent.change(within(form).getByLabelText(/^Código de frota/), { target: { value: 'ut-04' } });
    await escolherNoSeletor(form, 'bem-seletor-familia', /^Veículos/);
    await escolherNoSeletor(form, 'bem-seletor-tipo', /Caminhonete/);
    fireEvent.change(within(form).getByLabelText(/^Placa/), { target: { value: 'abc-1d23' } });
    await escolherOpcao(within(form).getByRole('combobox', { name: 'UF da placa' }), 'MS');
    // jsdom: o popover do próximo B1Select só abre depois que as opções do anterior sumirem.
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    aba('Operação');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Odômetro');
    fireEvent.change(within(form).getByLabelText('Leitura inicial (km)'), { target: { value: '45.300,5' } });
    fireEvent.change(within(form).getByTestId('bem-medidor-data'), { target: { value: '2026-11-02' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar tanque' }));
    const tanque = within(form).getByTestId('bem-tanque-0');
    fireEvent.change(within(tanque).getByLabelText(/^Identificador/), { target: { value: 'Único' } });
    fireEvent.change(within(tanque).getByLabelText('Capacidade (L)'), { target: { value: '80' } });
    await aceitarProduto(form, 0, /Gasolina/);
    await aceitarProduto(form, 0, /Etanol/);
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd2')).toBeTruthy();
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd3')).toBeTruthy();
    expect(within(tanque).queryByTestId('bem-tanque-0-produto-pd1')).toBeNull();
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()).toHaveLength(1);
    expect(mutacoes()[0].body).toEqual({
      empresa_id: 'emp-1', nome: 'Caminhonete UT-04', familia_id: 'f3', tipo_id: 't3', codigo_frota: 'UT-04', propriedade: 'PROPRIO', placa: 'ABC1D23', placa_uf: 'MS',
      medidor: { tipo: 'ODOMETRO', leitura_inicial: '45300.5', data_leitura: '2026-11-02' },
      tanques: [{ identificador: 'Único', capacidade_litros: '80', produto_ids: ['pd2', 'pd3'] }],
    });
  });

  it('curral (D-PROD-162): sem aba Medições nem Operação; material e ano de conclusão vão no POST, nunca medicoes', async () => {
    await montar();
    const form = await novo();
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Curral de manejo' } });
    await escolherNoSeletor(form, 'bem-seletor-familia', /^Benfeitorias/);
    await escolherNoSeletor(form, 'bem-seletor-tipo', /Curral/);
    expect(abas()).toEqual(['Identificação', 'Aquisição e depreciação']);
    fireEvent.change(within(form).getByLabelText(/^Material/), { target: { value: 'Madeira' } });
    fireEvent.change(within(form).getByLabelText(/^Ano de conclusão/), { target: { value: '2019' } });
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()).toHaveLength(1);
    expect(mutacoes()[0].body).toEqual({
      empresa_id: 'emp-1', nome: 'Curral de manejo', familia_id: 'f1', tipo_id: 't1', propriedade: 'PROPRIO', material: 'Madeira', ano_conclusao: 2019,
    });
    expect(backend.chamadas.some((c) => /perfis-medicao|combustiveis/.test(c.path))).toBe(false);
  });

  it('implemento: medidor opcional (voltar para "Não se aplica" tira o medidor do corpo), sem tanques; compatibilidade e série aparecem', async () => {
    await montar();
    const form = await novoDaFamilia('Roçadeira R1', /^Implementos/, /Roçadeira/);
    fireEvent.change(within(form).getByLabelText(/^Compatibilidade/), { target: { value: 'Tratores acima de 75 cv' } });
    fireEvent.change(within(form).getByLabelText(/^Número de série/), { target: { value: 'RC-77' } });
    aba('Operação');
    expect(within(form).getByTestId('bem-medidor')).toBeTruthy();
    expect(within(form).queryByTestId('bem-tanques')).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Adicionar tanque' })).toBeNull();
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Horímetro');
    expect(within(form).getByTestId('bem-medidor-data')).toBeTruthy();
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Não se aplica');
    expect(within(form).queryByTestId('bem-medidor-data')).toBeNull();
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body).toEqual({
      empresa_id: 'emp-1', nome: 'Roçadeira R1', familia_id: 'f4', tipo_id: 't4', propriedade: 'PROPRIO', numero_serie: 'RC-77', compatibilidade: 'Tratores acima de 75 cv',
    });
  });

  it('outro bem: "Sem medidor" vai como {tipo: SEM_MEDIDOR} e não pede leitura', async () => {
    await montar();
    const form = await novoDaFamilia('Balsa do açude', /^Outros bens/, /Balsa/);
    aba('Operação');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
    expect(within(form).queryByTestId('bem-medidor-leitura-inicial')).toBeNull();
    expect(within(form).queryByTestId('bem-medidor-data')).toBeNull();
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body).toEqual({ empresa_id: 'emp-1', nome: 'Balsa do açude', familia_id: 'f6', tipo_id: 't6', propriedade: 'PROPRIO', medidor: { tipo: 'SEM_MEDIDOR' } });
  });

  it('equipamento: medidor obrigatório (validação local, nada enviado); tanque sem Produto aceito não é exigido (P-01)', async () => {
    await montar();
    const form = await novoDaFamilia('Gerador 50 kVA', /^Equipamentos/, /Gerador/);
    aba('Operação');
    fireEvent.click(within(form).getByRole('button', { name: 'Adicionar tanque' }));
    const tanque = within(form).getByTestId('bem-tanque-0');
    fireEvent.change(within(tanque).getByLabelText(/^Identificador/), { target: { value: 'Principal' } });
    fireEvent.change(within(tanque).getByLabelText('Capacidade (L)'), { target: { value: '120' } });
    aba('Identificação');
    salvar();
    expect(await screen.findByText('Revise os campos destacados.')).toBeTruthy();
    // A validação leva para a aba do primeiro erro (Operação) e marca os campos.
    expect(screen.getByRole('tab', { name: 'Operação' }).getAttribute('aria-selected')).toBe('true');
    expect(within(form).getByText('Escolha o medidor (ou "Sem medidor")')).toBeTruthy();
    expect(within(form).getByTestId('bem-tanque-sem-produto-0')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mutacoes()).toEqual([]);
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body.tanques).toEqual([{ identificador: 'Principal', capacidade_litros: '120', produto_ids: [] }]);
  });
});

describe('Bens — seções e campos condicionais pela natureza', () => {
  it('antes da família: aviso, só Identificação e Aquisição, tipo bloqueado e nenhum campo de natureza', async () => {
    await montar();
    const form = await novo();
    expect(within(form).getByTestId('bem-escolha-familia')).toBeTruthy();
    expect(abas()).toEqual(['Identificação', 'Aquisição e depreciação']);
    for (const campo of [/^Placa/, /^Chassi/, /^Número de série/, /^Material/, /^Compatibilidade/]) expect(within(form).queryByLabelText(campo)).toBeNull();
    expect(within(form).queryByTestId('bem-potencia')).toBeNull();
    fireEvent.click(within(form).getByTestId('bem-seletor-tipo'));
    expect(within(form).queryByTestId('bem-seletor-tipo-painel')).toBeNull();
    expect(backend.chamadas.some((c) => c.path === '/bens-patrimoniais-opcoes/tipos')).toBe(false);
  });

  /** [família, abas, campos presentes, campos ausentes, tanques?, medidor obrigatório?] */
  const MATRIZ = [
    [/^Benfeitorias/, ['Identificação', 'Aquisição e depreciação'], [/^Material/, /^Ano de conclusão/], [/^Placa/, /^Chassi/, /^Número de série/, /^Compatibilidade/], null, null],
    [/^Máquinas/, ['Identificação', 'Operação', 'Aquisição e depreciação'], [/^Chassi/, /^Número de série/], [/^Placa/, /^Renavam/, /^Material/, /^Compatibilidade/], true, true],
    [/^Veículos/, ['Identificação', 'Operação', 'Aquisição e depreciação'], [/^Placa/, /^Renavam/, /^Chassi/, /^Número de série/], [/^Material/, /^Compatibilidade/], true, true],
    [/^Implementos/, ['Identificação', 'Operação', 'Aquisição e depreciação'], [/^Número de série/, /^Compatibilidade/], [/^Placa/, /^Chassi/, /^Material/], false, false],
    [/^Equipamentos/, ['Identificação', 'Operação', 'Aquisição e depreciação'], [/^Número de série/], [/^Placa/, /^Chassi/, /^Material/, /^Compatibilidade/], true, true],
    [/^Outros bens/, ['Identificação', 'Operação', 'Aquisição e depreciação'], [/^Número de série/], [/^Placa/, /^Chassi/, /^Material/, /^Compatibilidade/], false, false],
  ];
  it.each(MATRIZ)('família %s: abas, campos e operação conforme a natureza', async (familia, abasEsperadas, presentes, ausentes, comTanques, medidorObrigatorio) => {
    await montar();
    const form = await novo();
    await escolherNoSeletor(form, 'bem-seletor-familia', familia);
    expect(within(form).queryByTestId('bem-escolha-familia')).toBeNull();
    expect(abas()).toEqual(abasEsperadas);
    for (const campo of presentes) expect(within(form).getByLabelText(campo), String(campo)).toBeTruthy();
    for (const campo of ausentes) expect(within(form).queryByLabelText(campo), String(campo)).toBeNull();
    const potencia = Boolean(within(form).queryByTestId('bem-potencia'));
    expect(potencia).toBe(comTanques === true);
    if (comTanques === null) return;
    aba('Operação');
    expect(Boolean(within(form).queryByTestId('bem-tanques'))).toBe(comTanques);
    // Obrigatório: a opção vazia só pede a escolha (a validação recusa); opcional: "Não se aplica".
    const medidor = within(form).getByRole('combobox', { name: 'Medidor' });
    expect(await rotulosDasOpcoes(medidor)).toEqual([
      medidorObrigatorio ? '— Escolha o medidor —' : 'Não se aplica',
      'Sem medidor',
      'Horímetro',
      'Odômetro',
      'Contador de ciclos',
    ]);
  });

  it('trocar a família de um bem novo limpa o tipo e troca as abas', async () => {
    await montar();
    const form = await novoDaFamilia('Bem', /^Máquinas/, /Trator de pneus/);
    expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('Trator de pneus');
    await escolherNoSeletor(form, 'bem-seletor-familia', /^Benfeitorias/);
    expect(within(form).getByTestId('bem-seletor-tipo')).toHaveTextContent('— Escolha o tipo —');
    expect(abas()).toEqual(['Identificação', 'Aquisição e depreciação']);
    salvar();
    expect(await within(form).findByText('Escolha o tipo')).toBeTruthy();
    expect(mutacoes()).toEqual([]);
  });
});

describe('Bens — prévia de depreciação', () => {
  it('200.000,00 / residual 50.000,00 / 10 anos → quota 1.250,00 rotulada como prévia simulada; nada é gravado', async () => {
    await montar();
    const form = await novo();
    aba('Aquisição e depreciação');
    fireEvent.change(within(form).getByLabelText('Valor de aquisição (R$)'), { target: { value: '200.000,00' } });
    fireEvent.click(within(form).getByRole('switch', { name: 'Depreciável' }));
    fireEvent.change(within(form).getByLabelText(/^Vida útil \*$/), { target: { value: '10' } });
    expect(within(form).getByTestId('bem-vida-meses').textContent).toBe('120');
    fireEvent.change(within(form).getByLabelText('Valor residual (R$)'), { target: { value: '50.000,00' } });
    fireEvent.change(within(form).getByTestId('bem-inicio-depreciacao'), { target: { value: '2026-01-01' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Simular depreciação' }));
    const previa = await within(form).findByTestId('bem-previa-depreciacao');
    expect(within(previa).getByText('Prévia simulada — não é lançamento contábil')).toBeTruthy();
    expect(within(previa).getByTestId('bem-previa-quota-mensal').textContent).toMatch(/1\.250,00/);
    expect(previa.textContent).not.toMatch(/cont[aá]bil apurad|acumulad|km\/L|L\/h/i);
    expect(mutacoes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/bens-patrimoniais-previa-depreciacao',
        body: { empresa_id: 'emp-1', valor_aquisicao: '200000', residual_modo: 'VALOR', valor_residual: '50000', vida_util_meses: 120, data_inicio_depreciacao: '2026-01-01' },
      }),
    ]);
    // Mudou um parâmetro: a prévia mostrada deixa de valer.
    fireEvent.change(within(form).getByLabelText(/^Vida útil \*$/), { target: { value: '8' } });
    expect(within(form).queryByTestId('bem-previa-depreciacao')).toBeNull();
  });
});

describe('Bens — edição (PATCH mínimo com versao)', () => {
  it('nome + leitura atual → PATCH só com o que mudou e o bloco medidor inteiro; medidor ajustado fica com tipo fixo', async () => {
    await montar();
    const form = await abrirTrator();
    expect(within(form).getByLabelText(/^Nome/).readOnly).toBe(true);
    editar();
    const editavel = screen.getByTestId('b1-form');
    fireEvent.change(within(editavel).getByLabelText(/^Nome/), { target: { value: 'Trator TP-02 Valtra' } });
    aba('Operação');
    expect(within(editavel).getByTestId('bem-medidor-fixo')).toBeTruthy();
    expect(within(editavel).getByLabelText('Leitura inicial (h)').readOnly).toBe(true);
    fireEvent.change(within(editavel).getByLabelText('Leitura atual (h)'), { target: { value: '1.320' } });
    fireEvent.change(within(editavel).getByTestId('bem-medidor-data'), { target: { value: '2026-11-08' } });
    expect(within(editavel).queryByRole('button', { name: /Tirar o tanque Principal/ })).toBeNull();
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: '/bens-patrimoniais/b1',
        body: { empresa_id: 'emp-1', versao: 4, nome: 'Trator TP-02 Valtra', medidor: { tipo: 'HORIMETRO', leitura_inicial: '1250', leitura_atual: '1320', data_leitura: '2026-11-08' } },
      }),
    ]);
  });

  it('tanque gravado só é inativado: PATCH leva a lista completa com ativo:false', async () => {
    await montar();
    await abrirTrator();
    editar();
    aba('Operação');
    fireEvent.click(screen.getByRole('button', { name: 'Inativar o tanque Principal' }));
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()[0].body).toEqual({
      empresa_id: 'emp-1', versao: 4,
      tanques: [{ id: 'tq1', identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1'], ativo: false }],
    });
  });

  it('sem mudança não envia nada; 422 mostra a mensagem e mantém o formulário; 409 de versão recarrega e o próximo PATCH usa a versão nova', async () => {
    await montar();
    await abrirTrator();
    editar();
    salvar();
    await screen.findByText('Nada foi alterado.');
    expect(mutacoes()).toHaveLength(0);

    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'Outro nome' } });
    proxima = erroServidor(422, 'MEDIDOR_LEITURA_REGRESSIVA', { field: 'medidor.leitura_atual' });
    salvar();
    await screen.findByText(/A nova leitura do medidor é menor que a atual/);
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Outro nome');
    expect(screen.queryByText('Bem patrimonial atualizado')).toBeNull();

    const leiturasAntes = backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais/b1').length;
    versaoDetalhe = 5;
    proxima = erroServidor(409, 'PATRIMONIO_VERSAO_CONFLITO', { details: { versao_atual: 5, versao_informada: 4 } });
    salvar();
    await screen.findByText(/alterado por outra pessoa enquanto você editava\. O registro foi recarregado/);
    await waitFor(() => expect(backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/bens-patrimoniais/b1').length).toBe(leiturasAntes + 1));
    await waitFor(() => expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Trator TP-02'));
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'Outro nome' } });
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes().at(-1).body).toEqual({ empresa_id: 'emp-1', versao: 5, nome: 'Outro nome' });
  });

  it('409 de negócio na edição (natureza imutável) mostra a mensagem e mantém o que foi digitado', async () => {
    await montar();
    await abrirTrator();
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Marca/), { target: { value: 'Massey' } });
    proxima = erroServidor(409, 'BEM_NATUREZA_IMUTAVEL', { details: { field: 'familia_id' } });
    salvar();
    expect(await screen.findByText(/A natureza do bem não muda/)).toBeTruthy();
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Marca/).value).toBe('Massey');
    expect(mutacoes()[0].body).toEqual({ empresa_id: 'emp-1', versao: 4, marca: 'Massey' });
  });

  it('bem que sumiu (404) fecha o registro e relê a lista', async () => {
    await montar();
    await abrirTrator();
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'Trator' } });
    const antes = listagens().length;
    proxima = erroServidor(404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO');
    salvar();
    expect(await screen.findByText(/Bem patrimonial não encontrado nesta empresa/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('b1-form')).toBeNull());
    await waitFor(() => expect(listagens().length).toBeGreaterThan(antes));
  });

  it('duplicar parte do detalhe sem identidade física (código, série, leituras, ids)', async () => {
    await montar();
    await abrirTrator();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    const form = await screen.findByTestId('b1-form');
    await waitFor(() => expect(within(form).getByLabelText(/^Nome/).value).toBe('Trator TP-02'));
    expect(within(form).getByLabelText(/^Código de frota/).value).toBe('');
    expect(within(form).getByLabelText(/^Número de série/).value).toBe('');
    aba('Operação');
    fireEvent.change(within(form).getByLabelText('Leitura inicial (h)'), { target: { value: '0' } });
    fireEvent.change(within(form).getByTestId('bem-medidor-data'), { target: { value: '2026-11-03' } });
    fireEvent.change(within(form).getByLabelText(/^Código de frota/), { target: { value: 'TP-03' } });
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body).toEqual({
      empresa_id: 'emp-1', nome: 'Trator TP-02', familia_id: 'f2', tipo_id: 't2', codigo_frota: 'TP-03', propriedade: 'PROPRIO',
      marca: 'Valtra', modelo: 'A950', ano_fabricacao: 2020, ano_modelo: 2021, potencia_cv: '95',
      medidor: { tipo: 'HORIMETRO', leitura_inicial: '0', data_leitura: '2026-11-03' },
      tanques: [{ identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1'] }],
    });
  });

  it('duplicar só copia os Produtos aceitos que ainda servem (nem o inativo, nem o que saiu de L/KG)', async () => {
    extraDoTrator = {
      tanques: [{
        id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
        produtos: [
          { produto_id: 'pd1', nome: 'Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L', produto_ativo: true },
          { produto_id: 'pd9', nome: 'Diesel S500', codigo_interno: null, unidade_principal_estoque: 'L', produto_ativo: false },
          { produto_id: 'pd8', nome: 'Ração ensacada', codigo_interno: null, unidade_principal_estoque: 'SACO', produto_ativo: true },
        ],
      }],
    };
    await montar();
    await abrirTrator();
    aba('Operação');
    // No registro aberto os dois aparecem riscados, com o motivo.
    expect(screen.getByTestId('bem-tanque-0-produto-pd9')).toHaveAttribute('data-motivo', 'inativo');
    expect(screen.getByTestId('bem-tanque-0-produto-pd8')).toHaveAttribute('data-motivo', 'unidade não aceita');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    const form = await screen.findByTestId('b1-form');
    await waitFor(() => expect(within(form).getByLabelText(/^Nome/).value).toBe('Trator TP-02'));
    aba('Operação');
    const tanque = within(form).getByTestId('bem-tanque-0');
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd1')).toBeTruthy();
    expect(within(tanque).queryByTestId('bem-tanque-0-produto-pd9')).toBeNull();
    expect(within(tanque).queryByTestId('bem-tanque-0-produto-pd8')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Leitura inicial (h)'), { target: { value: '0' } });
    fireEvent.change(within(form).getByTestId('bem-medidor-data'), { target: { value: '2026-11-03' } });
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body.tanques).toEqual([{ identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1'] }]);
  });

  it('cancelar a edição descarta o digitado: volta ao gravado e o próximo PATCH não leva o descartado', async () => {
    await montar();
    await abrirTrator();
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/), { target: { value: 'NOME DESCARTADO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Trator TP-02'));
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).readOnly).toBe(true);
    editar();
    fireEvent.change(within(screen.getByTestId('b1-form')).getByLabelText(/^Marca/), { target: { value: 'Massey' } });
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/bens-patrimoniais/b1', body: { empresa_id: 'emp-1', versao: 4, marca: 'Massey' } })]);
  });
});

describe('Bens — referências da fazenda, aquisição e propriedade (corpo exato)', () => {
  it('responsável, centro, área, fornecedor, aquisição e depreciação: POST com os ids, o bloco aquisicao e a vida útil em meses', async () => {
    await montar();
    const form = await novoDaFamilia('Balsa do açude', /^Outros bens/, /Balsa/);
    await escolherNoSeletor(form, 'bem-seletor-responsavel', 'João Vaqueiro');
    await escolherNoSeletor(form, 'bem-seletor-centro-custo', /Manutenção/);
    await escolherNoSeletor(form, 'bem-seletor-area', 'Retiro Sul');
    expect(within(form).getByTestId('bem-seletor-centro-custo')).toHaveTextContent('12 · Manutenção');
    aba('Aquisição e depreciação');
    fireEvent.change(within(form).getByLabelText('Valor de aquisição (R$)'), { target: { value: '200.000,00' } });
    await escolherNoSeletor(form, 'bem-seletor-fornecedor', 'Agro Máquinas');
    fireEvent.click(within(form).getByRole('switch', { name: 'Depreciável' }));
    fireEvent.change(within(form).getByLabelText(/^Vida útil \*$/), { target: { value: '10' } });
    fireEvent.change(within(form).getByLabelText('Valor residual (R$)'), { target: { value: '50.000,00' } });
    fireEvent.change(within(form).getByTestId('bem-inicio-depreciacao'), { target: { value: '2026-01-01' } });
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/bens-patrimoniais',
        body: {
          empresa_id: 'emp-1', nome: 'Balsa do açude', familia_id: 'f6', tipo_id: 't6', propriedade: 'PROPRIO',
          responsavel_usuario_id: 'u7', centro_custo_id: 'cc1', area_id: 'a1',
          aquisicao: { valor_aquisicao: '200000', fornecedor_parceiro_id: 'pc1' },
          depreciacao: { depreciavel: true, metodo: 'LINEAR', vida_util_meses: 120, residual_modo: 'VALOR', valor_residual: '50000', data_inicio_depreciacao: '2026-01-01' },
        },
      }),
    ]);
    const opcoesDaFazenda = backend.chamadas.filter((c) => /^\/bens-patrimoniais-opcoes\/(responsaveis|centros-custo|areas|parceiros)$/.test(c.path));
    expect(opcoesDaFazenda.length).toBeGreaterThanOrEqual(4);
    expect(opcoesDaFazenda.every((c) => c.query.empresa_id === 'emp-1')).toBe(true);
  });

  it('editar só a data de aquisição manda o bloco aquisicao INTEIRO (o servidor substitui o bloco: omitido = nulo)', async () => {
    extraDoTrator = {
      aquisicao: {
        data_aquisicao: '2026-01-10', data_disponibilidade: '2026-01-15', valor_aquisicao: '200000.00', custo_incorporacao: '5000.00',
        fornecedor: { id: 'pc1', nome: 'Agro Máquinas' }, documento_referencia: 'NF 123', garantia_ate: '2027-01-10',
      },
    };
    await montar();
    await abrirTrator();
    editar();
    const form = screen.getByTestId('b1-form');
    aba('Aquisição e depreciação');
    fireEvent.change(within(form).getByLabelText(/^Data de aquisição/), { target: { value: '2026-01-12' } });
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path: '/bens-patrimoniais/b1',
        body: {
          empresa_id: 'emp-1', versao: 4,
          aquisicao: {
            data_aquisicao: '2026-01-12', data_disponibilidade: '2026-01-15', valor_aquisicao: '200000', custo_incorporacao: '5000',
            fornecedor_parceiro_id: 'pc1', documento_referencia: 'NF 123', garantia_ate: '2027-01-10',
          },
        },
      }),
    ]);
  });

  it('troca de propriedade: terceiro → próprio leva proprietario_parceiro_id:null; próprio → terceiro leva o proprietário escolhido', async () => {
    extraDoTrator = { propriedade: 'TERCEIRO', proprietario: { id: 'pc2', nome: 'Vizinho da Divisa' } };
    await montar();
    await abrirTrator();
    editar();
    let form = screen.getByTestId('b1-form');
    expect(within(form).getByTestId('bem-seletor-proprietario')).toHaveTextContent('Vizinho da Divisa');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Propriedade' }), 'Próprio');
    expect(within(form).queryByTestId('bem-seletor-proprietario')).toBeNull();
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'PATCH', path: '/bens-patrimoniais/b1', body: { empresa_id: 'emp-1', versao: 4, propriedade: 'PROPRIO', proprietario_parceiro_id: null } }),
    ]);

    extraDoTrator = null;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy());
    editar();
    form = screen.getByTestId('b1-form');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Propriedade' }), 'De terceiro');
    await escolherNoSeletor(form, 'bem-seletor-proprietario', 'Vizinho da Divisa');
    salvar();
    await waitFor(() => expect(mutacoes()).toHaveLength(2));
    expect(mutacoes()[1].body).toEqual({ empresa_id: 'emp-1', versao: 5, propriedade: 'TERCEIRO', proprietario_parceiro_id: 'pc2' });
  });
});

describe('Bens — regras finas do formulário', () => {
  it('correção do medidor (sem ajuste ainda): mudar a leitura inicial leva a atual junto', async () => {
    medidorDoTrator = { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1250.0000', data_leitura: '2026-11-01', origem: 'CADASTRO_INICIAL' };
    await montar();
    await abrirTrator();
    editar();
    const form = screen.getByTestId('b1-form');
    aba('Operação');
    expect(within(form).queryByTestId('bem-medidor-fixo')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Leitura inicial (h)'), { target: { value: '1.200' } });
    expect(within(form).getByLabelText('Leitura atual (h)').value).toBe('1.200');
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()[0].body).toEqual({ empresa_id: 'emp-1', versao: 4, medidor: { tipo: 'HORIMETRO', leitura_inicial: '1200', leitura_atual: '1200', data_leitura: '2026-11-01' } });
  });

  it('D-PROD-159: com leitura registrada por abastecimento (medidor_operacional) o tipo e a leitura inicial ficam fixos, e o ajuste não desce do piso', async () => {
    medidorDoTrator = { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1250.0000', data_leitura: '2026-11-01', origem: 'CADASTRO_INICIAL' };
    extraDoTrator = { medidor_operacional: { leitura: '1550.5000', data: '2026-11-05', abastecimento_id: 'ab-9' } };
    await montar();
    await abrirTrator();
    editar();
    const form = screen.getByTestId('b1-form');
    aba('Operação');
    expect(within(form).getByTestId('bem-medidor-fixo')).toHaveTextContent(
      'Há leitura registrada por abastecimento: o tipo e a leitura inicial não mudam, e um ajuste não pode ser menor que 1.550,5 nem anterior a 05/11/2026.',
    );
    expect(within(form).getByLabelText('Leitura inicial (h)')).toHaveAttribute('readonly');
    fireEvent.change(within(form).getByLabelText('Leitura atual (h)'), { target: { value: '1.400' } });
    salvar();
    expect(await within(form).findByText('A leitura atual não pode ser menor que a registrada pelo último abastecimento')).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mutacoes()).toEqual([]);
  });

  it('D-PROD-159 (FE-01): leitura do abastecimento acima da do cadastro não impede editar outro campo; o piso só vale quando a leitura ou a data mudam', async () => {
    medidorDoTrator = { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' };
    extraDoTrator = { medidor_operacional: { leitura: '1550.5000', data: '2026-11-05', abastecimento_id: 'ab-9' } };
    await montar();
    await abrirTrator();
    editar();
    const form = screen.getByTestId('b1-form');
    // só a data muda, com a leitura do cadastro abaixo do piso: o servidor recusaria, a tela também
    aba('Operação');
    fireEvent.change(within(form).getByTestId('bem-medidor-data'), { target: { value: '2026-11-06' } });
    salvar();
    expect(await within(form).findByText('A leitura atual não pode ser menor que a registrada pelo último abastecimento')).toBeTruthy();
    expect(mutacoes()).toEqual([]);
    // data de volta + só o nome muda: sai o PATCH sem o bloco do medidor
    fireEvent.change(within(form).getByTestId('bem-medidor-data'), { target: { value: '2026-11-01' } });
    aba('Identificação');
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Trator renomeado' } });
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()).toHaveLength(1);
    expect(mutacoes()[0].body).toEqual({ empresa_id: 'emp-1', versao: 4, nome: 'Trator renomeado' });
  });

  it('correção do medidor com a leitura atual diferente da inicial: a tela não envia e explica; com a atual igual, salva a correção', async () => {
    medidorDoTrator = { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1520.5000', leitura_atual: '1520.5000', data_leitura: '2026-11-01', origem: 'CADASTRO_INICIAL' };
    await montar();
    await abrirTrator();
    editar();
    const form = screen.getByTestId('b1-form');
    aba('Operação');
    // Atual digitada antes: a inicial deixa de puxar a atual junto.
    fireEvent.change(within(form).getByLabelText('Leitura atual (h)'), { target: { value: '1.600' } });
    fireEvent.change(within(form).getByLabelText('Leitura inicial (h)'), { target: { value: '1.500' } });
    salvar();
    expect(await within(form).findByText(/Na correção do cadastro a leitura atual é a própria leitura inicial/)).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mutacoes()).toEqual([]);
    fireEvent.change(within(form).getByLabelText('Leitura atual (h)'), { target: { value: '1.500' } });
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()).toEqual([
      expect.objectContaining({ method: 'PATCH', body: { empresa_id: 'emp-1', versao: 4, medidor: { tipo: 'HORIMETRO', leitura_inicial: '1500', leitura_atual: '1500', data_leitura: '2026-11-01' } } }),
    ]);
  });

  it('422 da capacidade de um tanque com field tanques[0].capacidade_litros mostra a linha e mantém o digitado', async () => {
    await montar();
    await abrirTrator();
    editar();
    const form = screen.getByTestId('b1-form');
    aba('Operação');
    fireEvent.change(within(form).getByLabelText('Capacidade (L)'), { target: { value: '200' } });
    proxima = erroServidor(422, 'TANQUE_CAPACIDADE_INVALIDA', { field: 'tanques[0].capacidade_litros', reason: 'capacidade_invalida' });
    salvar();
    expect(await screen.findByText(/Capacidade do tanque inválida \(linha 1\)/)).toBeTruthy();
    expect(within(screen.getByTestId('b1-form')).getByLabelText('Capacidade (L)').value).toBe('200');
  });

  it('"hoje" da leitura é o dia da FAZENDA (fuso da empresa no resumo de empresas), não o do navegador', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 03:30 UTC de 15/06 = 23:30 de 14/06 em Cuiabá: no navegador (UTC ou Brasília) já é 15/06.
    vi.setSystemTime(new Date('2027-06-15T03:30:00.000Z'));
    empresasDoBackend = [{ id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Cuiaba' }];
    await montar();
    await waitFor(() => expect(backend.chamadas.some((c) => c.method === 'GET' && c.path === '/empresas')).toBe(true));
    const form = await novoDaFamilia('Trator novo', /^Máquinas/, /Trator de pneus/);
    aba('Operação');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Horímetro');
    const data = within(form).getByTestId('bem-medidor-data');
    expect(data.value).toBe('2027-06-14');
    expect(data.getAttribute('max')).toBe('2027-06-14');
    fireEvent.change(within(form).getByLabelText('Leitura inicial (h)'), { target: { value: '0' } });
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body.medidor).toEqual({ tipo: 'HORIMETRO', leitura_inicial: '0', data_leitura: '2027-06-14' });
  });

  it('benfeitoria gravada: família de outra natureza é recusada na tela; o PATCH leva só o que mudou (nunca medicoes)', async () => {
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('bem-nome-b2'));
    await screen.findByTestId('b1-form');
    editar();
    const form = screen.getByTestId('b1-form');
    fireEvent.click(within(form).getByTestId('bem-seletor-familia'));
    fireEvent.click(await within(form).findByRole('option', { name: /^Máquinas/ }));
    await within(form).findByText('A natureza do bem não muda: escolha uma família de Benfeitoria.');
    expect(abas()).toEqual(['Identificação', 'Aquisição e depreciação']);
    fireEvent.change(within(form).getByLabelText(/^Material/), { target: { value: 'Alvenaria' } });
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()[0].body).toEqual({ empresa_id: 'emp-1', versao: 2, material: 'Alvenaria' });
  });

  it('409 do servidor na criação (código de frota duplicado) mantém o formulário com o que foi digitado', async () => {
    await montar();
    const form = await novo();
    fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Trator novo' } });
    fireEvent.change(within(form).getByLabelText(/^Código de frota/), { target: { value: 'TP-02' } });
    await escolherNoSeletor(form, 'bem-seletor-familia', /^Máquinas/);
    await escolherNoSeletor(form, 'bem-seletor-tipo', /Trator de pneus/);
    aba('Operação');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
    proxima = erroServidor(409, 'BEM_CODIGO_FROTA_DUPLICADO', { details: { field: 'codigo_frota' } });
    salvar();
    await screen.findByText(/Já existe um bem com este código de frota nesta empresa/);
    expect(mutacoes()[0].body.medidor).toEqual({ tipo: 'SEM_MEDIDOR' });
    expect(screen.queryByText('Bem patrimonial criado')).toBeNull();
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Nome/).value).toBe('Trator novo');
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Código de frota/).value).toBe('TP-02');
  });

  it('422 do servidor na criação (placa inválida) mostra a mensagem do campo e mantém o formulário', async () => {
    await montar();
    const form = await novoDaFamilia('Caminhão', /^Veículos/, /Caminhonete/);
    fireEvent.change(within(form).getByLabelText(/^Placa/), { target: { value: 'ABC1D23' } });
    aba('Operação');
    await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
    proxima = erroServidor(422, 'BEM_CAMPO_INVALIDO', { field: 'placa' });
    salvar();
    expect(await screen.findByText(/Placa inválida: use o formato ABC-1234 ou o Mercosul ABC1D23/)).toBeTruthy();
    aba('Identificação');
    expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Placa/).value).toBe('ABC1D23');
  });
});

describe('Bens — situação e permissões', () => {
  it('inativar pelo menu (confirmação) manda {empresa_id, versao, ativo:false} e mostra o detalhe devolvido', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await montar();
    await abrirTrator();
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    fireEvent.click(await screen.findByText('Inativar bem patrimonial'));
    await screen.findByText('Bem patrimonial inativado');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mutacoes()).toEqual([expect.objectContaining({ method: 'PATCH', path: '/bens-patrimoniais/b1', body: { empresa_id: 'emp-1', versao: 4, ativo: false } })]);
    await waitFor(() => expect(within(screen.getByTestId('b1-form')).getByLabelText(/^Situação/).value).toBe('Inativo'));
  });

  it('sem a ação inativar: menu sem o item; sem novo/editar: sem Novo, Editar e Duplicar', async () => {
    sessao.permissao = permissaoCom({});
    await montar();
    await abrirTrator();
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    await screen.findByText('Imprimir');
    expect(screen.queryByText('Inativar bem patrimonial')).toBeNull();
    for (const nome of ['Novo', 'Editar', 'Duplicar']) expect(screen.queryByRole('button', { name: nome }), nome).toBeNull();
  });

  it('editar sem inativar: edita, mas o menu não oferece inativar', async () => {
    sessao.permissao = permissaoCom({ editar: true, salvar: true, excluir: true });
    await montar();
    await abrirTrator();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
    await screen.findByText('Imprimir');
    expect(screen.queryByText('Inativar bem patrimonial')).toBeNull();
    expect(screen.queryByText('Reativar bem patrimonial')).toBeNull();
  });
});
