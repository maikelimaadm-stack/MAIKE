/**
 * Backend falso das consultas de Estoque (D-PROD-255): saldo, movimentos, detalhe e opções, com os filtros e o
 * envelope keyset do servidor real. Decimais como texto. Dados realistas de fazenda.
 */
export const EMPRESA = 'emp-1';

const PRODUTOS = [
  { id: 'p-diesel', nome: 'Diesel S10', unidade: 'L' },
  { id: 'p-glifosato', nome: 'Glifosato', unidade: 'L' },
  { id: 'p-sal', nome: 'Sal mineral', unidade: 'KG' },
  { id: 'p-ureia', nome: 'Ureia', unidade: 'KG' },
];
const LOCAIS = [
  { id: 'l-galpao', nome: 'Galpão insumos' },
  { id: 'l-tanque', nome: 'Tanque diesel sede' },
];

export const SALDO = [
  { chave: 'p-diesel:l-tanque', produto_id: 'p-diesel', produto_nome: 'Diesel S10', produto_codigo: null, local_estoque_id: 'l-tanque', local_estoque_nome: 'Tanque diesel sede', unidade: 'L', quantidade: '4850.0000', custo_medio: '5.9200', valor: '28712.0000', camadas: 2 },
  { chave: 'p-glifosato:l-galpao', produto_id: 'p-glifosato', produto_nome: 'Glifosato', produto_codigo: null, local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'L', quantidade: '120.0000', custo_medio: '32.5000', valor: '3900.0000', camadas: 1 },
  { chave: 'p-sal:l-galpao', produto_id: 'p-sal', produto_nome: 'Sal mineral', produto_codigo: null, local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'KG', quantidade: '2400.0000', custo_medio: '3.1000', valor: '7440.0000', camadas: 3 },
  { chave: 'p-ureia:l-galpao', produto_id: 'p-ureia', produto_nome: 'Ureia', produto_codigo: null, local_estoque_id: 'l-galpao', local_estoque_nome: 'Galpão insumos', unidade: 'KG', quantidade: '1500.0000', custo_medio: '3.4000', valor: '5100.0000', camadas: 1 },
];

const mov = (id, numero, data, produto, extra) => ({
  id, numero, data, tipo: 'Entrada', tipo_detalhado: 'compra_financeiro', origem_sistema: 'operacao_financeira', status: 'Ativa', estorno: false, excluido: false,
  produto_id: produto.id, produto_nome: produto.nome, produto_codigo: null, quantidade: '100.0000', unidade: produto.unidade, valor_unitario: '5.0000', valor_total: '500.0000',
  local_origem_id: null, local_origem: null, local_destino_id: null, local_destino: null, saldo_antes: '0.0000', saldo_depois: '100.0000', movimento_pai_id: null, movimento_filho_id: null,
  ...extra,
});
const [DIESEL, GLIFOSATO, SAL, UREIA] = PRODUTOS;

export const MOVIMENTOS = [
  mov('m5', '105', '2026-11-12', DIESEL, { tipo: 'Saída', tipo_detalhado: 'abastecimento_patrimonio', origem_sistema: 'abastecimento_patrimonio', quantidade: '180.0000', saldo_antes: '5030.0000', saldo_depois: '4850.0000', valor_unitario: '5.9200', valor_total: '1065.6000', local_origem_id: 'l-tanque', local_origem: 'Tanque diesel sede' }),
  mov('m4', '104', '2026-11-10', UREIA, { tipo: 'Saída', tipo_detalhado: 'transferencia_enviada', origem_sistema: 'deposito', quantidade: '300.0000', saldo_antes: '1800.0000', saldo_depois: '1500.0000', local_origem_id: 'l-galpao', local_origem: 'Galpão insumos', local_destino_id: 'l-tanque', local_destino: 'Tanque diesel sede', movimento_filho_id: 'm4b', unidade_lancamento: 'SC', quantidade_lancamento: '12.0000', fator_lancamento: '25.0000' }),
  mov('m3', '103', '2026-11-08', SAL, { tipo: 'Saída', tipo_detalhado: 'estorno_compra', estorno: true, excluido: true, quantidade: '500.0000', saldo_antes: '2900.0000', saldo_depois: '2400.0000', local_origem_id: 'l-galpao', local_origem: 'Galpão insumos', movimento_pai_id: 'm2' }),
  mov('m2', '102', '2026-11-06', SAL, { status: 'Estornada', excluido: true, quantidade: '500.0000', saldo_antes: '2400.0000', saldo_depois: '2900.0000', valor_unitario: '3.1000', valor_total: '1550.0000', local_destino_id: 'l-galpao', local_destino: 'Galpão insumos', movimento_filho_id: 'm3' }),
  mov('m1', '101', '2026-11-03', DIESEL, { quantidade: '5000.0000', saldo_antes: '30.0000', saldo_depois: '5030.0000', valor_unitario: '5.9200', valor_total: '29600.0000', local_destino_id: 'l-tanque', local_destino: 'Tanque diesel sede' }),
];

const DETALHES = {
  m5: {
    custo_medio_antes: '5.9200', custo_medio_depois: '5.9200', motivo: 'Baixa por abastecimento', observacoes: 'Trator 7230', responsavel: 'maria',
    fornecedor_nome: null, tipo_documento: null, numero_documento: null, data_documento: null, vinculos: { area: null, lote: null, maquina: 'Trator 7230', centro_custo: null, safra: null },
    documento: { tipo: 'ABASTECIMENTO', id: 'ab-1', numero: '12', rotulo: 'Abastecimento nº 12', pagina: 'Abastecimentos' },
    camadas_consumidas: [
      { lote_id: 'c1', quantidade: '30.0000', custo_unitario: '5.8000', numero_documento: 'NF-1042', fornecedor_nome: 'Posto Boa Vista', data_documento: '2026-10-20', unidade: 'L' },
      { lote_id: 'c2', quantidade: '150.0000', custo_unitario: '5.9433', numero_documento: 'NF-1187', fornecedor_nome: 'Posto Boa Vista', data_documento: '2026-11-03', unidade: 'L' },
    ],
    pai: null, filho: null, criado_em: '2026-11-12T14:20:00.000Z',
  },
  m3: {
    custo_medio_antes: null, custo_medio_depois: null, motivo: 'Estorno por cancelamento da compra', observacoes: null, responsavel: 'maria', fornecedor_nome: null, tipo_documento: null, numero_documento: null, data_documento: null,
    vinculos: { area: null, lote: null, maquina: null, centro_custo: null, safra: null }, documento: null, camadas_consumidas: [],
    pai: { id: 'm2', numero: '102', tipo: 'Entrada', tipo_detalhado: 'compra_financeiro', status: 'Estornada', data: '2026-11-06', quantidade: '500.0000', unidade: 'KG' }, filho: null, criado_em: '2026-11-08T11:00:00.000Z',
  },
};

/** @param {URLSearchParams} q @param {string} k */
const filtro = (q, k) => q.get(k) || null;

/** @param {{ method: string, path: string, query: URLSearchParams, body: any }} req */
export const rotearEstoque = async (req) => {
  const { method, path, query } = req;
  if (method !== 'GET') return undefined;
  if (path === '/empresas') return { status: 200, body: [{ id: EMPRESA, numero_empresa: 1, nome: 'Fazenda Boa Vista', fuso_horario: 'America/Cuiaba' }] };
  if (path === '/estoque/opcoes/locais') return { status: 200, body: { itens: LOCAIS, has_more: false, next_cursor: null } };
  if (path === '/estoque/opcoes/produtos') return { status: 200, body: { itens: PRODUTOS.map((p) => ({ id: p.id, nome: p.nome, codigo: null })), has_more: false, next_cursor: null } };
  const envelope = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: Number(query.get('limit') || 100) });
  if (path === '/estoque/saldo') {
    const q = (filtro(query, 'q') || '').toLowerCase();
    const items = SALDO.filter((s) => (!filtro(query, 'produto_id') || s.produto_id === query.get('produto_id'))
      && (!filtro(query, 'local_estoque_id') || s.local_estoque_id === query.get('local_estoque_id'))
      && (!q || `${s.produto_nome} ${s.local_estoque_nome}`.toLowerCase().includes(q)));
    return { status: 200, body: envelope(items) };
  }
  if (path === '/estoque/movimentos') {
    const q = (filtro(query, 'q') || '').toLowerCase();
    // D-PROD-273 (fatia 2): o par excluído (m2 'Estornada' + o estorno m3) só vem com incluir_excluidos=true, marcado.
    const incluir = query.get('incluir_excluidos') === 'true';
    const items = MOVIMENTOS.filter((m) => (incluir || !m.excluido)
      && (!filtro(query, 'produto_id') || m.produto_id === query.get('produto_id'))
      && (!filtro(query, 'local_estoque_id') || [m.local_origem_id, m.local_destino_id].includes(query.get('local_estoque_id')))
      && (!filtro(query, 'origem_sistema') || m.origem_sistema === query.get('origem_sistema'))
      && (!filtro(query, 'tipo_movimentacao') || m.tipo === query.get('tipo_movimentacao'))
      && (!filtro(query, 'data_de') || m.data >= String(query.get('data_de')))
      && (!filtro(query, 'data_ate') || m.data <= String(query.get('data_ate')))
      && (!q || `${m.numero} ${m.produto_nome}`.toLowerCase().includes(q)));
    return { status: 200, body: envelope(items) };
  }
  const detalhe = /^\/estoque\/movimentos\/([^/]+)$/.exec(path);
  if (detalhe) {
    const m = MOVIMENTOS.find((x) => x.id === detalhe[1]);
    if (!m) return { status: 404, body: { code: 'MOVIMENTACAO_ESTOQUE_NOT_FOUND', message: 'não encontrado', request_id: 'r' } };
    return {
      status: 200,
      body: {
        ...m, custo_medio_antes: null, custo_medio_depois: null, motivo: null, observacoes: null, responsavel: null, fornecedor_nome: null, tipo_documento: null, numero_documento: null, data_documento: null,
        vinculos: { area: null, lote: null, maquina: null, centro_custo: null, safra: null }, documento: null, camadas_consumidas: [], pai: null, filho: null, criado_em: '2026-11-01T12:00:00.000Z',
        ...(DETALHES[m.id] ?? {}),
      },
    };
  }
  return undefined;
};
