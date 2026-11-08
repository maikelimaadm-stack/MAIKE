/**
 * D-PROD-154 — cenário compartilhado da matriz de testes da P3-01 (Central
 * Única de Lançamentos). Não é arquivo de teste (sem `.test.`): só monta
 * tenants, contas por permissão, documentos e fotografias do banco.
 *
 * Tudo contra PostgreSQL real e HTTP autenticado (`app.inject`); a prova de
 * "nada mudou" é a fotografia COMPLETA das linhas do(s) tenant(s), não o
 * status HTTP.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarTenant, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

export const TELA = 'ges-lancamentos-financeiros';
export const SENHA = 'senha-de-teste-1';
export const prisma = () => getPrismaClient();
export const opId = () => `op-${randomUUID()}`;

/** Cliente HTTP sobre `app.inject`. */
export const http = (app) => {
  const req = (metodo, url, token, payload) =>
    app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
  const ok = async (r, status = 200) => {
    const x = await r;
    assert.equal(x.statusCode, status, x.body);
    return x.json();
  };
  return { req, ok };
};

export const codigo = (r) => r.json().code;
export const motivo = (r) => r.json().details?.reason ?? r.json().reason;
/** Corpo de erro sem o que varia por requisição (id de rastreio). */
export const corpoErro = (r) => {
  const resto = { ...r.json() };
  delete resto.requestId;
  delete resto.request_id;
  return resto;
};

/** Ações da tela (padrão + extras da P3). */
export const ACOES_PADRAO = ['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'];
export const ACOES_EXTRAS = ['confirmar', 'liquidar', 'estornar_liquidacao', 'cancelar'];
export const linhaTela = (acoes = {}) => ({
  modulo_id: 'gestao-rural',
  tela_id: TELA,
  ...Object.fromEntries([...ACOES_PADRAO, ...ACOES_EXTRAS].map((a) => [a, false])),
  ...acoes,
});

/**
 * Tenant com 2 empresas (E1 e E2), cada uma com parceiros, naturezas,
 * centros e produtos próprios; 2 locais do tenant; perfil BR/BRL em E1 e E2.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ fuso?: string|null, perfil?: {pais: string, moeda: string, locale: string}|null }} [opcoes]
 */
export const montarTenant = async (app, opcoes = {}) => {
  const p = prisma();
  const { req, ok } = http(app);
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const fuso = opcoes.fuso === undefined ? 'America/Sao_Paulo' : opcoes.fuso;
  const hash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const token = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = async (n) => {
    const e = await p.empresa.create({ data: { cliente_id: c, numero_empresa: n, apelido: `E${n}`, nome: `Fazenda ${n} ${c}`, fuso_horario: fuso } });
    const base = { cliente_id: c, empresa_id: e.id };
    const forn = await p.fornecedor.create({ data: { ...base, numero_cadastro: `${n}01`, tipo_pessoa: 'Jurídica', nome: `AGRO INSUMOS ${n}`, tipos: ['fornecedor'] } });
    const prest = await p.fornecedor.create({ data: { ...base, numero_cadastro: `${n}02`, tipo_pessoa: 'Jurídica', nome: `PRESTADOR ${n}`, tipos: ['prestador_servico'] } });
    const cli = await p.fornecedor.create({ data: { ...base, numero_cadastro: `${n}03`, tipo_pessoa: 'Jurídica', nome: `FRIGORIFICO ${n}`, tipos: ['cliente'] } });
    const legado = await p.fornecedor.create({ data: { ...base, numero_cadastro: `${n}04`, tipo_pessoa: 'Jurídica', nome: `LEGADO SEM PAPEL ${n}`, tipos: [] } });
    const desp = await p.naturezaFinanceira.create({ data: { ...base, numero: `${n}1`, tipo: 'DESPESA', nome: `INSUMOS ${n}` } });
    const desp2 = await p.naturezaFinanceira.create({ data: { ...base, numero: `${n}2`, tipo: 'DESPESA', nome: `FRETE ${n}` } });
    const desp3 = await p.naturezaFinanceira.create({ data: { ...base, numero: `${n}3`, tipo: 'DESPESA', nome: `ENERGIA ${n}` } });
    const rec = await p.naturezaFinanceira.create({ data: { ...base, numero: `${n}4`, tipo: 'RECEITA', nome: `VENDA ${n}` } });
    const rec2 = await p.naturezaFinanceira.create({ data: { ...base, numero: `${n}5`, tipo: 'RECEITA', nome: `SERVICOS ${n}` } });
    const cc = await p.centroCusto.create({ data: { ...base, numero: `${n}1`, nome: `REBANHO ${n}` } });
    const cc2 = await p.centroCusto.create({ data: { ...base, numero: `${n}2`, nome: `LAVOURA ${n}` } });
    const cr = await p.centroResultado.create({ data: { ...base, numero: `${n}1`, nome: `CRIA ${n}` } });
    const sal = await p.produto.create({ data: { ...base, numero_produto: `${n}1`, nome_produto: `SAL MINERAL ${n}`, unidade_principal_estoque: 'KG' } });
    const racao = await p.produto.create({
      data: { ...base, numero_produto: `${n}2`, nome_produto: `RACAO ${n}`, unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30' },
    });
    const milho = await p.produto.create({ data: { ...base, numero_produto: `${n}3`, nome_produto: `MILHO ${n}`, unidade_principal_estoque: 'KG' } });
    return { ...e, forn, prest, cli, legado, desp, desp2, desp3, rec, rec2, cc, cc2, cr, sal, racao, milho };
  };
  const e1 = await empresa(1);
  const e2 = await empresa(2);
  const local = await p.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: `DEPOSITO CENTRAL ${c}` } });
  const local2 = await p.localEstoque.create({ data: { cliente_id: c, numero_local: '2', nome: `GALPAO NORTE ${c}` } });
  const perfil = opcoes.perfil === undefined ? { pais: 'BR', moeda: 'BRL', locale: 'pt-BR' } : opcoes.perfil;
  if (perfil) {
    for (const e of [e1, e2]) await ok(req('PUT', '/perfis-financeiros-empresa', token, { empresa_id: e.id, ...perfil }));
  }
  /**
   * Conta extra do tenant (mesma senha), com a linha de Permissão dada.
   * @param {Record<string, unknown>|null} permissao  null = sem linha
   * @param {Record<string, unknown>} [extraUsuario]
   */
  const conta = async (permissao, extraUsuario = {}) => {
    const login = `op-${randomUUID().slice(0, 8)}`;
    const u = await p.usuario.create({ data: { cliente_id: c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario', ...extraUsuario } });
    if (permissao) await p.permissao.create({ data: { cliente_id: c, user_email: login, user_nome: 'Op', ...permissao } });
    const r = await autenticarNoApp(app, { login, senha: SENHA });
    assert.equal(r.resposta.statusCode, 200, r.resposta.body);
    return { id: u.id, login, token: r.corpo.token };
  };
  /** Conta com só estas ações na tela (visualizar incluso, salvo indicação). */
  const contaCom = (acoes, { semVisualizar = false, modulos = ['gestao-rural'] } = {}) =>
    conta({ modulos_permitidos: modulos, permissoes_telas: [linhaTela({ ...(semVisualizar ? {} : { visualizar: true }), ...acoes })] });
  return { c, cliente: adm.cliente, admId: adm.usuario.id, admLogin: adm.credenciais.login, token, hash, e1, e2, local, local2, conta, contaCom };
};

// ─── documentos ─────────────────────────────────────────────────────────────
/** PAGAR/RECEBER sem produtos (PRAZO, 1 linha de rateio VALOR). */
export const docSem = (e, extra = {}) => {
  const direcao = extra.direcao ?? 'PAGAR';
  const total = extra.valor_bruto ?? '500.00';
  return {
    empresa_id: e.id,
    direcao,
    conteudo: 'SEM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: (direcao === 'PAGAR' ? e.forn : e.cli).id,
    data_emissao: '2027-06-10',
    valor_bruto: total,
    rateio_modo: 'VALOR',
    rateios: [{ natureza_id: (direcao === 'PAGAR' ? e.desp : e.rec).id, valor: total }],
    parcelas: [{ vencimento: '2027-07-10', valor: total }],
    ...extra,
  };
};

/** À vista sem produtos (1 parcela no dia da emissão). */
export const docAvista = (e, total = '500.00', extra = {}) =>
  docSem(e, { condicao: 'AVISTA', valor_bruto: total, rateios: [{ natureza_id: e.desp.id, valor: total }], parcelas: [{ vencimento: '2027-06-10', valor: total }], ...extra });

/**
 * Com produtos: itens `{produto, local, unidade, quantidade, valor_unitario}`;
 * o total é a soma (2 casas) e vira 1 parcela a prazo.
 */
export const docCom = (e, local, itens, extra = {}) => {
  const direcao = extra.direcao ?? 'PAGAR';
  const linhas = itens.map((i) => ({
    tipo_item: 'MERCADORIA',
    produto_id: i.produto.id,
    local_estoque_id: (i.local ?? local).id,
    unidade: i.unidade ?? 'KG',
    quantidade: i.quantidade,
    valor_unitario: i.valor_unitario,
  }));
  const total = extra.total ?? centavos(itens.reduce((t, i) => t + Math.round(Number(i.quantidade) * Number(i.valor_unitario) * 100), 0));
  const resto = { ...extra };
  delete resto.total;
  return {
    empresa_id: e.id,
    direcao,
    conteudo: 'COM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: (direcao === 'PAGAR' ? e.forn : e.cli).id,
    data_emissao: '2027-06-10',
    data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    itens: linhas,
    rateio_modo: 'PERCENTUAL',
    rateios: [{ natureza_id: (direcao === 'PAGAR' ? e.desp : e.rec).id, percentual: '100' }],
    parcelas: [{ vencimento: '2027-07-10', valor: total }],
    ...resto,
  };
};

/** Inteiro de centavos → string canônica com 2 casas (só para montar fixtures). */
export const centavos = (n) => `${Math.trunc(n / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;

/** Ações HTTP sobre o documento. */
export const acoes = (app) => {
  const { req, ok } = http(app);
  const criar = (token, doc) => ok(req('POST', '/operacoes-financeiras', token, { ...doc, operation_id: opId() }), 201);
  const confirmarReq = (token, d, empresaId, extra = {}) =>
    req('POST', `/operacoes-financeiras/${d.id}/confirmar`, token, { empresa_id: empresaId, operation_id: opId(), versao: d.versao, ...extra });
  const confirmar = (token, d, empresaId, extra = {}) => ok(confirmarReq(token, d, empresaId, extra));
  const criarConfirmar = async (token, doc, extra = {}) => confirmar(token, await criar(token, doc), doc.empresa_id, extra);
  const cancelarReq = (token, id, empresaId, extra = {}) =>
    req('POST', `/operacoes-financeiras/${id}/cancelar`, token, { empresa_id: empresaId, operation_id: opId(), motivo: 'teste de cancelamento', ...extra });
  const liquidarReq = (token, tituloId, empresaId, extra = {}) =>
    req('POST', `/titulos-financeiros/${tituloId}/liquidacoes`, token, { empresa_id: empresaId, operation_id: opId(), valor: '100.00', data: '2027-06-12', metodo: 'DINHEIRO', ...extra });
  const estornarReq = (token, liqId, empresaId, extra = {}) =>
    req('POST', `/liquidacoes-financeiras/${liqId}/estorno`, token, { empresa_id: empresaId, operation_id: opId(), motivo: 'estorno de teste', ...extra });
  const detalhe = (token, id, empresaId) => ok(req('GET', `/operacoes-financeiras/${id}?empresa_id=${empresaId}`, token));
  const previa = (token, id, empresaId) => ok(req('POST', `/operacoes-financeiras/${id}/previa`, token, { empresa_id: empresaId }));
  return { req, ok, criar, confirmarReq, confirmar, criarConfirmar, cancelarReq, liquidarReq, estornarReq, detalhe, previa };
};

// ─── fotografias do banco ───────────────────────────────────────────────────
const MODELOS_FOTO = [
  'perfilFinanceiroEmpresa', 'operacaoFinanceira', 'operacaoFinanceiraItem', 'operacaoFinanceiraConsumoLote', 'operacaoFinanceiraRateio',
  'tituloFinanceiro', 'liquidacaoFinanceira', 'liquidacaoFinanceiraEstorno', 'produto', 'estoqueLoteNota', 'movimentacaoEstoque',
  'operacaoIdempotente', 'auditLog', 'entidadeCodigoSequencia', 'fornecedor', 'naturezaFinanceira', 'centroCusto', 'centroResultado',
  'localEstoque', 'empresa',
];
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

/** TODAS as linhas (todas as colunas) das tabelas tocáveis, dos tenants dados. */
export const foto = async (clienteIds) => {
  const p = /** @type {any} */ (prisma());
  const ids = Array.isArray(clienteIds) ? clienteIds : [clienteIds];
  const out = {};
  for (const m of MODELOS_FOTO) out[m] = await p[m].findMany({ where: { cliente_id: { in: ids } }, orderBy: { id: 'asc' } });
  return JSON.stringify(out, replacer);
};

/** Estoque do tenant (lotes, movimentos e `estoque_atual`) — prova de "sem efeito físico". */
export const fotoEstoque = async (clienteId) => {
  const p = prisma();
  const w = { where: { cliente_id: clienteId }, orderBy: { id: /** @type {const} */ ('asc') } };
  return JSON.stringify({
    produtos: await p.produto.findMany({ ...w, select: { id: true, estoque_atual: true } }),
    lotes: await p.estoqueLoteNota.findMany(w),
    movimentos: await p.movimentacaoEstoque.findMany(w),
  }, replacer);
};

/** Lote "legado" (fora da P3) direto no banco. */
export const loteLegado = (s, e, produto, local, { kg, custo = '2.0000', dia = '2027-06-01', status = 'Disponivel', disponivel } = /** @type {any} */ ({})) =>
  prisma().estoqueLoteNota.create({
    data: {
      cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: local.id, local_estoque_nome: local.nome,
      data_documento: new Date(`${dia}T00:00:00.000Z`), custo_unitario: custo, quantidade_entrada: kg, quantidade_disponivel: disponivel ?? kg, status,
    },
  });

/** Σ disponível dos lotes por chave. */
export const somaLotes = async (where) => {
  const r = await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where });
  return r._sum.quantidade_disponivel ? r._sum.quantidade_disponivel.toFixed(4) : '0.0000';
};
