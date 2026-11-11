/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01, §5.2) e D-PROD-163
 * (SIMPLIFICA-02) — "Produtos aceitos" de cada tanque do bem, com a tela real
 * (página, motor Base1, formulário, services, API, porta e nativeHttpClient).
 * Mocks só da borda: `fetch` (backend falso) e a sessão.
 *
 *  - seletor paginado sobre `GET /bens-patrimoniais-opcoes/produtos` (empresa
 *    na query), com o selo da unidade de estoque em cada opção (`L`, `kg` e,
 *    D-PROD-163, o Produto em SACO como `kg · saco`) e o filtro opcional
 *    Litros | Quilos | Sacos | Todos (query `unidade`, achado D8);
 *  - D-PROD-163: Produto em QUALQUER unidade (L, KG ou SACO) é aceito, e a
 *    nota dos tanques traz a regra nova (baixa na unidade de estoque: litros
 *    para L; quilos para KG e SACO; capacidade só para L);
 *  - chips removíveis; tanque sem Produto mostra o aviso P-01; Produto em KG
 *    ou SACO aceito mostra o aviso de que no abastecimento se digita kg (D8);
 *  - até 20 por tanque (P-02): cheio, o seletor sai e a tela explica;
 *  - Produto aceito inativo ou fora de L/KG/SACO aparece riscado com o motivo e
 *    pode ser retirado; o 422 `TANQUE_PRODUTO_INVALIDO` (ex.: `outra_empresa`
 *    ao reativar o tanque, achado D1) marca o Produto apontado, e retirá-lo
 *    no mesmo envio resolve;
 *  - só leitura: nada de seletor nem de retirar.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
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
  permissoes_telas: [{ tela_id: 'pat-bens-patrimoniais', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...acoes }],
});

const opcoes = (itens) => ({ status: 200, body: { itens, has_more: false, next_cursor: null } });

const TIPOS = [{ id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', natureza: 'MAQUINA' }];
/** D-PROD-163: Produtos ativos da fazenda em QUALQUER unidade (os 2 Produtos de produção estão em SACO). */
const PRODUTOS = [
  { id: 'pd1', nome: 'Diesel S10', codigo_interno: 'DS10', unidade_principal_estoque: 'L' },
  { id: 'pd4', nome: 'Arla 32', codigo_interno: 'ARLA', unidade_principal_estoque: 'KG' },
  { id: 'pd6', nome: 'Sal mineral', codigo_interno: 'SAL', unidade_principal_estoque: 'SACO' },
];
const NOTA_NOVA =
  'Os Produtos aceitos vêm do estoque desta fazenda, em qualquer unidade (litros, quilos ou sacos). O abastecimento baixa do estoque exatamente a quantidade digitada, na unidade de estoque do Produto (litros para L; quilos para KG e SACO); a capacidade do tanque só é conferida para Produto em litros.';
/** @param {string} id @param {string} nome @param {string} unidade @param {boolean} [ativo] */
const aceito = (id, nome, unidade, ativo = true) => ({ produto_id: id, nome, codigo_interno: null, unidade_principal_estoque: unidade, produto_ativo: ativo });

const RESUMO_TRATOR = {
  id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA',
  tipo: { id: 't2', nome: 'Trator de pneus' }, propriedade: 'PROPRIO', medidor_tipo: 'HORIMETRO', ativo: true, versao: 4,
};
const detalheTrator = (tanques) => ({
  ...RESUMO_TRATOR,
  empresa_id: 'emp-1',
  familia: { id: 'f2', codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA', ativo: true },
  tipo: { id: 't2', codigo: 'TRATOR_PNEUS', nome: 'Trator de pneus', ativo: true },
  proprietario: null, responsavel: null, centro_custo: null, area: null, localizacao_descricao: null, marca: null, modelo: null,
  ano_fabricacao: null, ano_modelo: null, numero_serie: null, chassi: null, placa: null, placa_uf: null, renavam: null, potencia_cv: null,
  material: null, ano_conclusao: null, compatibilidade: null, especificacoes: null, observacoes: null,
  medidor: { tipo: 'HORIMETRO', unidade: 'h', leitura_inicial: '1250.0000', leitura_atual: '1300.0000', data_leitura: '2026-11-01', origem: 'AJUSTE_CADASTRO' },
  tanques,
  aquisicao: { data_aquisicao: null, data_disponibilidade: null, valor_aquisicao: null, custo_incorporacao: null, fornecedor: null, documento_referencia: null, garantia_ate: null },
  depreciacao: { depreciavel: false, metodo: null, vida_util_meses: null, residual_modo: null, valor_residual: null, residual_percentual: null, data_inicio_depreciacao: null, previa: null },
});

let backend;
/** Tanques do detalhe do trator. @type {any[]} */
let tanquesDoTrator;
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
  sessao.permissao = permissaoCom({ novo: true, editar: true });
  proxima = null;
  tanquesDoTrator = [{ id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true, produtos: [aceito('pd1', 'Diesel S10', 'L')] }];
  backend = instalarBackendFake(async ({ method, path, query, body }) => {
    if (proxima && method !== 'GET') {
      const r = proxima;
      proxima = null;
      return r;
    }
    if (method === 'GET' && path === '/bens-patrimoniais') return { status: 200, body: envelope([RESUMO_TRATOR]) };
    if (method === 'GET' && path === '/empresas') return { status: 200, body: [{ id: 'emp-1', numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Sao_Paulo' }] };
    if (method === 'GET' && path === '/bens-patrimoniais/b1') return { status: 200, body: detalheTrator(tanquesDoTrator) };
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/tipos') return opcoes(TIPOS.filter((t) => t.natureza === query.get('natureza')));
    if (method === 'GET' && path === '/bens-patrimoniais-opcoes/produtos') {
      return opcoes(PRODUTOS.filter((p) => !query.get('unidade') || p.unidade_principal_estoque === query.get('unidade')));
    }
    if (method === 'GET' && path.startsWith('/bens-patrimoniais-opcoes/')) return opcoes([]);
    if (method === 'POST' && path === '/bens-patrimoniais') return { status: 201, body: { ...detalheTrator([]), id: 'b9', numero: '8', versao: 1 } };
    if (method === 'PATCH' && path === '/bens-patrimoniais/b1') return { status: 200, body: { ...detalheTrator(tanquesDoTrator), versao: 5 } };
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
const pedidosDeProdutos = () => backend.chamadas.filter((c) => c.path === '/bens-patrimoniais-opcoes/produtos');
const salvar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
const aba = (nome) => fireEvent.click(screen.getByRole('tab', { name: nome }));
const escolherNoSeletor = async (form, testId, nome) => {
  fireEvent.click(within(form).getByTestId(testId));
  fireEvent.click(await within(form).findByRole('option', { name: nome }));
  await waitFor(() => expect(within(form).queryByTestId(`${testId}-painel`)).toBeNull());
};
const tratorNovoComTanque = async () => {
  await screen.findByTestId('bem-nome-b1');
  fireEvent.click(screen.getByRole('button', { name: 'Novo' }));
  const form = await screen.findByTestId('b1-form');
  fireEvent.change(within(form).getByLabelText(/^Nome/), { target: { value: 'Trator novo' } });
  await escolherOpcao(within(form).getByRole('combobox', { name: 'Tipo de bem' }), 'Máquina');
  await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
  await escolherNoSeletor(form, 'bem-seletor-tipo', /Trator de pneus/);
  aba('Operação');
  await escolherOpcao(within(form).getByRole('combobox', { name: 'Medidor' }), 'Sem medidor');
  fireEvent.click(within(form).getByRole('button', { name: 'Adicionar tanque' }));
  const tanque = within(form).getByTestId('bem-tanque-0');
  fireEvent.change(within(tanque).getByLabelText(/^Identificador/), { target: { value: 'Principal' } });
  fireEvent.change(within(tanque).getByLabelText('Capacidade (L)'), { target: { value: '300' } });
  return { form, tanque };
};
const editarTrator = async () => {
  fireEvent.doubleClick(await screen.findByTestId('bem-nome-b1'));
  await screen.findByTestId('b1-form');
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  aba('Operação');
  return screen.getByTestId('b1-form');
};

describe('Tanque × Produtos aceitos — seletor, unidade e avisos', () => {
  it('opções com selo de unidade; aceitar L e KG; aviso P-01 some e o aviso de KG aparece; POST com produto_ids', async () => {
    await montar();
    const { form, tanque } = await tratorNovoComTanque();
    expect(within(tanque).getByTestId('bem-tanque-sem-produto-0')).toHaveTextContent('Este tanque não pode ser abastecido até ter um Produto aceito.');
    fireEvent.click(within(form).getByTestId('bem-tanque-seletor-produto-0'));
    const painel = await within(form).findByTestId('bem-tanque-seletor-produto-0-painel');
    expect(await within(painel).findByRole('option', { name: /Diesel S10.*DS10 · L/ })).toBeTruthy();
    fireEvent.click(within(painel).getByRole('option', { name: /Arla 32.*ARLA · kg/ }));
    await escolherNoSeletor(form, 'bem-tanque-seletor-produto-0', /Diesel S10/);
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd4')).toHaveTextContent(/Arla 32.*kg/);
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd1')).toHaveTextContent(/Diesel S10.*L/);
    expect(within(tanque).queryByTestId('bem-tanque-sem-produto-0')).toBeNull();
    expect(within(tanque).getByTestId('bem-tanque-aviso-kg-0')).toHaveTextContent(
      'Produto em quilos ou em sacos tem estoque em quilos: no abastecimento digita-se kg, não sacos nem os litros da bomba.',
    );
    expect(within(tanque).getByText(/\(2 de 20\)/)).toBeTruthy();
    // O mesmo Produto não entra duas vezes.
    await escolherNoSeletor(form, 'bem-tanque-seletor-produto-0', /Diesel S10/);
    expect(within(tanque).getAllByTestId(/^bem-tanque-0-produto-/)).toHaveLength(2);
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body.tanques).toEqual([{ identificador: 'Principal', capacidade_litros: '300', produto_ids: ['pd1', 'pd4'] }]);
    expect(pedidosDeProdutos().every((c) => c.query.empresa_id === 'emp-1')).toBe(true);
  });

  it('D-PROD-163: Produto em SACO aparece e é aceito (selo "kg · saco"); a nota traz a regra nova; aviso de kg; POST com produto_ids', async () => {
    await montar();
    const { form, tanque } = await tratorNovoComTanque();
    expect(within(form).getByTestId('bem-tanques-nota')).toHaveTextContent(NOTA_NOVA);
    expect(within(form).getByTestId('bem-tanques-nota').textContent).not.toMatch(/em litros \(L\) ou quilos \(kg\)/);
    fireEvent.click(within(form).getByTestId('bem-tanque-seletor-produto-0'));
    const painel = await within(form).findByTestId('bem-tanque-seletor-produto-0-painel');
    expect(await within(painel).findByRole('option', { name: /Diesel S10.*DS10 · L/ })).toBeTruthy();
    expect(within(painel).getByRole('option', { name: /Arla 32.*ARLA · kg/ })).toBeTruthy();
    fireEvent.click(within(painel).getByRole('option', { name: /Sal mineral.*SAL · kg · saco/ }));
    await waitFor(() => expect(within(form).queryByTestId('bem-tanque-seletor-produto-0-painel')).toBeNull());
    const chip = within(tanque).getByTestId('bem-tanque-0-produto-pd6');
    expect(chip).toHaveTextContent(/Sal mineral.*kg · saco/);
    expect(chip).not.toHaveAttribute('data-motivo');
    expect(within(tanque).getByTestId('bem-tanque-aviso-kg-0')).toBeTruthy();
    salvar();
    await screen.findByText('Bem patrimonial criado');
    expect(mutacoes()[0].body.tanques).toEqual([{ identificador: 'Principal', capacidade_litros: '300', produto_ids: ['pd6'] }]);
    expect(pedidosDeProdutos().every((c) => c.query.empresa_id === 'emp-1' && c.query.unidade === undefined)).toBe(true);
  });

  it('filtro Litros | Quilos | Sacos | Todos vai na query `unidade` e muda as opções', async () => {
    await montar();
    const { form, tanque } = await tratorNovoComTanque();
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(tanque).getByRole('combobox', { name: 'Unidade' }), 'Litros (L)');
    fireEvent.click(within(form).getByTestId('bem-tanque-seletor-produto-0'));
    let painel = await within(form).findByTestId('bem-tanque-seletor-produto-0-painel');
    await within(painel).findByRole('option', { name: /Diesel S10/ });
    expect(within(painel).queryByRole('option', { name: /Arla 32/ })).toBeNull();
    expect(pedidosDeProdutos().at(-1).query).toMatchObject({ empresa_id: 'emp-1', unidade: 'L' });
    fireEvent.click(within(painel).getByRole('button', { name: /Fechar seleção/ }));
    // jsdom: o popover do próximo B1Select só abre depois que as opções anteriores sumirem.
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(tanque).getByRole('combobox', { name: 'Unidade' }), 'Quilos (kg)');
    fireEvent.click(within(form).getByTestId('bem-tanque-seletor-produto-0'));
    painel = await within(form).findByTestId('bem-tanque-seletor-produto-0-painel');
    await within(painel).findByRole('option', { name: /Arla 32/ });
    expect(within(painel).queryByRole('option', { name: /Diesel S10/ })).toBeNull();
    expect(within(painel).queryByRole('option', { name: /Sal mineral/ })).toBeNull();
    expect(pedidosDeProdutos().at(-1).query).toMatchObject({ unidade: 'KG' });
    fireEvent.click(within(painel).getByRole('button', { name: /Fechar seleção/ }));
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(tanque).getByRole('combobox', { name: 'Unidade' }), 'Sacos (estoque em kg)');
    fireEvent.click(within(form).getByTestId('bem-tanque-seletor-produto-0'));
    painel = await within(form).findByTestId('bem-tanque-seletor-produto-0-painel');
    await within(painel).findByRole('option', { name: /Sal mineral/ });
    expect(within(painel).queryByRole('option', { name: /Arla 32/ })).toBeNull();
    expect(pedidosDeProdutos().at(-1).query).toMatchObject({ unidade: 'SACO' });
    fireEvent.click(within(painel).getByRole('button', { name: /Fechar seleção/ }));
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    await escolherOpcao(within(tanque).getByRole('combobox', { name: 'Unidade' }), 'Todos');
    fireEvent.click(within(form).getByTestId('bem-tanque-seletor-produto-0'));
    painel = await within(form).findByTestId('bem-tanque-seletor-produto-0-painel');
    await within(painel).findByRole('option', { name: /Arla 32/ });
    expect(pedidosDeProdutos().at(-1).query.unidade).toBeUndefined();
  });

  it('limite de 20 (P-02): cheio, o seletor sai e a tela explica', async () => {
    tanquesDoTrator = [{
      id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
      produtos: Array.from({ length: 20 }, (_, i) => aceito(`px${String(i).padStart(2, '0')}`, `Produto ${i}`, 'L')),
    }];
    await montar();
    const form = await editarTrator();
    const tanque = within(form).getByTestId('bem-tanque-0');
    expect(within(tanque).getByText(/\(20 de 20\)/)).toBeTruthy();
    expect(within(tanque).queryByTestId('bem-tanque-seletor-produto-0')).toBeNull();
    expect(within(tanque).getByText('Limite de 20 Produtos aceitos neste tanque: tire um para aceitar outro.')).toBeTruthy();
    fireEvent.click(within(tanque).getByRole('button', { name: 'Tirar Produto 3 dos Produtos aceitos do tanque Principal' }));
    expect(within(tanque).getByTestId('bem-tanque-seletor-produto-0')).toBeTruthy();
  });

  it('só leitura: chips sem "tirar" e sem seletor', async () => {
    await montar();
    fireEvent.doubleClick(await screen.findByTestId('bem-nome-b1'));
    const form = await screen.findByTestId('b1-form');
    aba('Operação');
    const tanque = within(form).getByTestId('bem-tanque-0');
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd1')).toBeTruthy();
    expect(within(tanque).queryByRole('button', { name: /^Tirar Diesel S10/ })).toBeNull();
    expect(within(tanque).queryByTestId('bem-tanque-seletor-produto-0')).toBeNull();
    expect(pedidosDeProdutos()).toEqual([]);
  });
});

describe('Tanque × Produtos aceitos — Produto que já não serve', () => {
  it('inativo e fora de L/KG/SACO aparecem riscados com o motivo (SACO serve); tirar um manda o conjunto novo; manter não muda o PATCH', async () => {
    tanquesDoTrator = [{
      id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true,
      produtos: [
        aceito('pd1', 'Diesel S10', 'L'),
        aceito('pd9', 'Diesel S500', 'L', false),
        aceito('pd8', 'Graxa avulsa', 'UN'),
        aceito('pd6', 'Sal mineral', 'SACO'),
      ],
    }];
    await montar();
    const form = await editarTrator();
    const tanque = within(form).getByTestId('bem-tanque-0');
    const inativo = within(tanque).getByTestId('bem-tanque-0-produto-pd9');
    expect(inativo).toHaveAttribute('data-motivo', 'inativo');
    expect(inativo).toHaveTextContent('(inativo)');
    expect(within(inativo).getByText('Diesel S500')).toHaveClass('line-through');
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd8')).toHaveTextContent('(unidade não aceita)');
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd1')).not.toHaveAttribute('data-motivo');
    expect(within(tanque).getByTestId('bem-tanque-0-produto-pd6')).not.toHaveAttribute('data-motivo');
    fireEvent.click(within(tanque).getByRole('button', { name: 'Tirar Graxa avulsa dos Produtos aceitos do tanque Principal' }));
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()[0].body).toEqual({
      empresa_id: 'emp-1', versao: 4,
      tanques: [{ id: 'tq1', identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1', 'pd6', 'pd9'], ativo: true }],
    });
  });

  it('achado D1: reativar o tanque com Produto que mudou de fazenda → 422 marca o Produto ("outra fazenda"); retirá-lo no mesmo envio resolve', async () => {
    tanquesDoTrator = [
      { id: 'tq1', identificador: 'Principal', capacidade_litros: '180.0000', observacao: null, ativo: true, produtos: [aceito('pd1', 'Diesel S10', 'L')] },
      { id: 'tq2', identificador: 'Reserva', capacidade_litros: '60.0000', observacao: null, ativo: false, produtos: [aceito('pd5', 'Diesel do vizinho', 'L')] },
    ];
    await montar();
    const form = await editarTrator();
    fireEvent.click(within(form).getByRole('button', { name: 'Reativar o tanque Reserva' }));
    proxima = erroServidor(422, 'TANQUE_PRODUTO_INVALIDO', { details: { field: 'tanques[1].produto_ids', reason: 'outra_empresa', produto_id: 'pd5' } });
    salvar();
    expect(await screen.findByText(/Um Produto aceito do tanque \(linha 2\) é de outra fazenda/)).toBeTruthy();
    const reserva = within(screen.getByTestId('b1-form')).getByTestId('bem-tanque-1');
    const marcado = within(reserva).getByTestId('bem-tanque-1-produto-pd5');
    expect(marcado).toHaveAttribute('data-motivo', 'outra fazenda');
    expect(within(reserva).getByTestId('bem-tanque-1-produto-pd5')).toHaveTextContent('(outra fazenda)');
    // O primeiro envio levou o tanque reativado com o aceite antigo.
    expect(mutacoes()[0].body.tanques[1]).toEqual({ id: 'tq2', identificador: 'Reserva', capacidade_litros: '60', produto_ids: ['pd5'], ativo: true });
    fireEvent.click(within(reserva).getByRole('button', { name: 'Tirar Diesel do vizinho dos Produtos aceitos do tanque Reserva' }));
    expect(within(reserva).getByTestId('bem-tanque-sem-produto-1')).toBeTruthy();
    salvar();
    await screen.findByText('Bem patrimonial atualizado');
    expect(mutacoes()[1].body.tanques).toEqual([
      { id: 'tq1', identificador: 'Principal', capacidade_litros: '180', produto_ids: ['pd1'], ativo: true },
      { id: 'tq2', identificador: 'Reserva', capacidade_litros: '60', produto_ids: [], ativo: true },
    ]);
  });
});
