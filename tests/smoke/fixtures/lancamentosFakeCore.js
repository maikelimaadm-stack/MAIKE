/**
 * Backend FALSO da Central Única de Lançamentos (D-PROD-155) — só para testes
 * RTL e para a evidência visual (scripts/dev/visual-lancamentos-financeiros.mjs).
 * Nada aqui fala com banco ou API real. Segue o contrato do SPEC §5/§6/§8:
 * valores em string canônica, datas AAAA-MM-DD, `operation_id` idempotente,
 * `versao` com compare-and-swap, corpo de erro `{code, message, request_id,
 * field?, reason?, details?}`. Sem dependência de Vitest (puro JS).
 */
import { comparar, ehPositivo, multiplicarArredondar, naEscala, ratearPercentual, somar, subtrair } from '../../../src/lib/dinheiroDecimal.js';
import { ratearCabecalho } from '../../../src/lib/rateioCabecalho.js';

export const EMPRESA = 'emp-1';
export const TS = '2026-11-08T12:00:00.000Z';

const erro = (status, code, extra = {}) => ({ status, body: { code, message: 'texto do servidor (falso)', request_id: 'req_fake', ...extra } });

const pagina = (lista, query, limitPadrao = 50) => {
  const inicio = Number(query.get('cursor') || 0);
  const limit = Number(query.get('limit') || limitPadrao);
  const fatia = lista.slice(inicio, inicio + limit);
  const mais = inicio + limit < lista.length;
  return { itens: fatia, has_more: mais, next_cursor: mais ? String(inicio + limit) : null };
};

const filtrarQ = (lista, query, campos = ['nome']) => {
  const q = (query.get('q') || '').toLowerCase();
  return q ? lista.filter((x) => campos.some((c) => String(x[c] ?? '').toLowerCase().includes(q))) : lista;
};

export const PARCEIROS = [
  { id: 'pa1', numero: '1', nome: 'AGROPECUÁRIA BOA VISTA', papeis: ['fornecedor'] },
  { id: 'pa2', numero: '2', nome: 'FRIGORÍFICO CENTRAL', papeis: ['cliente'] },
  { id: 'pa3', numero: '3', nome: 'VETERINÁRIA SÃO JOSÉ', papeis: ['prestador_servico'] },
  { id: 'pa4', numero: '4', nome: 'COOPERATIVA MISTA', papeis: ['fornecedor', 'cliente'] },
];
export const PRODUTOS = [
  { id: 'pr1', numero: '10', nome: 'SAL MINERAL 80', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '25.0000', estoque_atual: '500.0000' },
  { id: 'pr2', numero: '11', nome: 'MILHO MOÍDO', unidade_principal_estoque: 'KG', peso_por_saco_kg: null, estoque_atual: '1200.0000' },
];
export const LOCAIS = [
  { id: 'lo1', numero: '1', nome: 'DEPÓSITO SEDE' },
  { id: 'lo2', numero: '2', nome: 'GALPÃO RETIRO' },
];
export const NATUREZAS = [
  { id: 'nd1', numero: '1', nome: 'NUTRIÇÃO', caminho: 'INSUMOS / NUTRIÇÃO', tipo: 'DESPESA' },
  { id: 'nd2', numero: '2', nome: 'SANIDADE', caminho: 'INSUMOS / SANIDADE', tipo: 'DESPESA' },
  { id: 'nd3', numero: '3', nome: 'ENERGIA ELÉTRICA', caminho: 'ENERGIA ELÉTRICA', tipo: 'DESPESA' },
  { id: 'nr1', numero: '4', nome: 'VENDA DE INSUMOS', caminho: 'VENDA DE INSUMOS', tipo: 'RECEITA' },
  { id: 'nr2', numero: '5', nome: 'VENDA DE GADO', caminho: 'VENDA DE GADO', tipo: 'RECEITA' },
];
export const CENTROS_CUSTO = [{ id: 'cc1', numero: '1', nome: 'CRIA' }, { id: 'cc2', numero: '2', nome: 'RECRIA' }];
export const CENTROS_RESULTADO = [{ id: 'cr1', numero: '1', nome: 'PECUÁRIA DE CORTE' }];
export const SALDOS = { pr1: [{ local_estoque_id: 'lo1', local_nome: 'DEPÓSITO SEDE', disponivel_kg: '300.0000' }], pr2: [{ local_estoque_id: 'lo2', local_nome: 'GALPÃO RETIRO', disponivel_kg: '1200.0000' }] };

export const CATALOGO = {
  moedas: [
    { codigo: 'BRL', casas: 2 }, { codigo: 'USD', casas: 2 }, { codigo: 'EUR', casas: 2 }, { codigo: 'ARS', casas: 2 },
    { codigo: 'UYU', casas: 2 }, { codigo: 'PYG', casas: 0 }, { codigo: 'JPY', casas: 0 }, { codigo: 'KWD', casas: 3 },
  ],
  paises: ['BR', 'AR', 'PY', 'UY', 'US', 'PT', 'ES', 'JP', 'KW'],
  locales: ['pt-BR', 'pt-PT', 'es-AR', 'es-PY', 'es-UY', 'es-ES', 'en-US', 'ja-JP'],
  metodos_por_pais: { BR: ['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'PIX', 'OUTRO'], _padrao: ['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'OUTRO'] },
  pix_exige: { pais: 'BR', moeda: 'BRL' },
};

/** Formas permitidas como o backend real calcula (§8.6: PIX só BR + BRL). */
const metodosPermitidos = (pais, moeda) => (pais === 'BR' && moeda === 'BRL' ? CATALOGO.metodos_por_pais.BR : CATALOGO.metodos_por_pais._padrao);

export const PERFIL_BR = { empresa_id: EMPRESA, pais: 'BR', moeda: 'BRL', moeda_casas: 2, locale: 'pt-BR', versao_contrato: 1, metodos_permitidos: ['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'PIX', 'OUTRO'] };

const usuario = { id: 'u1', login: 'dono' };

/**
 * Estado do backend falso.
 * @param {{ perfil?: any, fuso?: string|null, documentos?: any[] }} [opts]
 */
export const criarEstadoLancamentos = (opts = {}) => ({
  perfil: opts.perfil === undefined ? PERFIL_BR : opts.perfil,
  fuso: opts.fuso === undefined ? 'America/Sao_Paulo' : opts.fuso,
  documentos: /** @type {any[]} */ (opts.documentos ?? []),
  seq: 100,
  idem: new Map(),
  /** @type {Record<string, any>} falhas injetáveis por rota: { confirmar: 'rede'|{status,body}, ... } */
  falhas: {},
  /** Bloqueios da próxima prévia. */
  bloqueiosPrevia: /** @type {any[]} */ ([]),
  /** Como o servidor quando o PLANEJAMENTO recusa (`plano: null` + bloqueios). */
  planoNuloNaPrevia: false,
  /** Promessa que segura a resposta do confirmar (teste de duplo clique). */
  segurarConfirmar: /** @type {Promise<void>|null} */ (null),
  /** Parceiros extras (teste de escala do seletor paginado). */
  parceirosExtras: /** @type {any[]} */ ([]),
  /** Produtos extras (vetores com saco de outro peso). */
  produtosExtras: /** @type {any[]} */ ([]),
});

/** Recusa do servidor dentro de `montarDoc` (vira a resposta do POST/PUT). */
class RecusaDoServidor extends Error {
  /** @param {{ status: number, body: any }} resposta */
  constructor(resposta) {
    super(resposta.body.code);
    this.resposta = resposta;
  }
}

/** POST/PUT: recusa de `montarDoc` vira resposta; o resto é erro do teste. @param {() => any} fazer */
const ouRecusa = (fazer) => {
  try {
    return { ok: fazer() };
  } catch (e) {
    if (e instanceof RecusaDoServidor) return { recusa: e.resposta };
    throw e;
  }
};

const casasDe = (doc) => doc.moeda_casas ?? 2;

/** Soma exata dos resíduos (8 casas, podem ser negativos). @param {string[]} residuos */
const somarResiduos = (residuos) => somar(residuos, 8);

/** Saldo e status do título a partir dos FATOS (liquidações sem estorno). */
const recalcularTitulo = (t) => {
  const casas = t.moeda_casas ?? 2;
  const pago = somar(t.liquidacoes.filter((l) => l.tipo !== 'ESTORNO' && !l.estornada).map((l) => l.valor), casas);
  t.valor_liquidado = pago;
  t.saldo = subtrair(t.valor, pago, casas);
  if (t.status === 'CANCELADO' || t.status === 'PREVISTO') return;
  t.status = comparar(pago, '0') === 0 ? 'ABERTO' : comparar(pago, t.valor) === 0 ? 'QUITADO' : 'PARCIAL';
};

/** Documento do corpo DOC (como o servidor recalcula). */
const montarDoc = (estado, corpo, base = {}) => {
  const casas = estado.perfil?.moeda_casas ?? 2;
  const itens = (corpo.itens ?? []).map((i, k) => {
    const prod = [...PRODUTOS, ...estado.produtosExtras].find((p) => p.id === i.produto_id);
    const local = LOCAIS.find((l) => l.id === i.local_estoque_id);
    const fator = i.unidade === 'SACO' ? prod?.peso_por_saco_kg ?? '1' : i.unidade === 'KG' ? '1' : null;
    return {
      id: `${base.id ?? 'novo'}-i${k + 1}`, ordem: k + 1, tipo_item: i.tipo_item, produto_id: i.produto_id ?? null, produto_nome: prod?.nome ?? null,
      descricao: i.descricao ?? null, local_estoque_id: i.local_estoque_id ?? null, local_estoque_nome: local?.nome ?? null, unidade: i.unidade,
      quantidade: naEscala(i.quantidade, 4), fator_kg: fator ? naEscala(fator, 4) : null,
      quantidade_estoque: i.tipo_item === 'MERCADORIA' && fator ? multiplicarArredondar(i.quantidade, fator, 4) : null,
      valor_unitario: naEscala(i.valor_unitario, 6), valor_total: multiplicarArredondar(i.quantidade, i.valor_unitario, casas),
      movimentacao_estoque_id: null, estoque_lote_nota_id: null, movimentacao_estorno_id: null, consumos: [],
    };
  });
  const bruto = corpo.conteudo === 'COM_PRODUTOS' ? somar(itens.map((i) => i.valor_total), casas) : naEscala(corpo.valor_bruto, casas);
  const desconto = naEscala(corpo.valor_desconto ?? '0', casas);
  const acrescimo = naEscala(corpo.valor_acrescimo ?? '0', casas);
  const total = somar([subtrair(bruto, desconto, casas), acrescimo], casas);
  // Custo de aquisição líquido (rodada 4): a MESMA política do `planejarOperacao`.
  const rateio = corpo.conteudo === 'COM_PRODUTOS' ? ratearCabecalho({ direcao: corpo.direcao, casas, valor_desconto: desconto, valor_acrescimo: acrescimo, itens }) : null;
  if (rateio?.erro) {
    const { field, reason, details } = rateio.erro;
    throw new RecusaDoServidor(erro(422, 'OPERACAO_VALORES_INVALIDOS', { field, reason, details: { field, reason, ...details } }));
  }
  itens.forEach((i, k) => Object.assign(i, rateio?.itens[k] ?? {}));
  const valoresPct = corpo.rateio_modo === 'PERCENTUAL' ? ratearPercentual(total, corpo.rateios.map((r) => r.percentual), casas).valores : [];
  const rateios = corpo.rateios.map((r, k) => {
    const nat = NATUREZAS.find((n) => n.id === r.natureza_id);
    return {
      ordem: k + 1, natureza_id: r.natureza_id, natureza_nome: nat?.nome ?? null, natureza_tipo: nat?.tipo ?? null,
      centro_custo_id: r.centro_custo_id ?? null, centro_custo_nome: CENTROS_CUSTO.find((c) => c.id === r.centro_custo_id)?.nome ?? null,
      centro_resultado_id: r.centro_resultado_id ?? null, centro_resultado_nome: CENTROS_RESULTADO.find((c) => c.id === r.centro_resultado_id)?.nome ?? null,
      percentual: corpo.rateio_modo === 'PERCENTUAL' ? naEscala(r.percentual, 6) : null,
      valor: corpo.rateio_modo === 'PERCENTUAL' ? valoresPct[k] : naEscala(r.valor, casas),
    };
  });
  const parceiro = PARCEIROS.find((p) => p.id === corpo.parceiro_id);
  const id = base.id ?? `op${++estado.seq}`;
  const titulos = corpo.parcelas.map((p, k) => ({
    id: `${id}-t${k + 1}`, numero_parcela: k + 1, total_parcelas: corpo.parcelas.length, vencimento: p.vencimento, valor: naEscala(p.valor, casas),
    valor_liquidado: naEscala('0', casas), saldo: naEscala(p.valor, casas), status: 'PREVISTO', moeda_casas: casas, liquidacoes: [],
  }));
  return {
    id, numero: base.numero ?? String(estado.seq), status: 'RASCUNHO', versao: base.versao ?? 1, empresa_id: corpo.empresa_id ?? EMPRESA,
    direcao: corpo.direcao, conteudo: corpo.conteudo, condicao: corpo.condicao, parceiro_id: corpo.parceiro_id, parceiro_nome: parceiro?.nome ?? 'PARCEIRO',
    descricao: corpo.descricao ?? null, documento_referencia: corpo.documento_referencia ?? null, data_emissao: corpo.data_emissao,
    data_operacional: corpo.data_operacional ?? null, moeda: estado.perfil?.moeda ?? 'BRL', moeda_casas: casas,
    valor_bruto: bruto, valor_desconto: desconto, valor_acrescimo: acrescimo, valor_total: total, rateio_modo: corpo.rateio_modo,
    metodo_preferido: corpo.metodo_preferido ?? null, criado_por: usuario, confirmado_por: null, confirmado_em: null, cancelado_por: null,
    cancelado_em: null, motivo_cancelamento: null, created_date: base.created_date ?? TS, updated_date: TS,
    itens, rateios, titulos, historico: [...(base.historico ?? []), { acao: base.id ? 'operacao_financeira.editar' : 'operacao_financeira.criar', em: TS, usuario_login: 'dono' }],
  };
};

/** Detalhe como o servidor devolve (cópia: o teste não muta o estado por engano). */
const detalhe = (doc, extra = {}) => {
  const copia = JSON.parse(JSON.stringify(doc));
  copia.titulos = copia.titulos.map(({ moeda_casas: _c, ...t }) => t);
  return { ...copia, ...extra };
};

const resumoLista = (d) => {
  const abertos = d.titulos.filter((t) => t.status === 'ABERTO' || t.status === 'PARCIAL');
  return {
    id: d.id, numero: d.numero, status: d.status, direcao: d.direcao, conteudo: d.conteudo, condicao: d.condicao, parceiro_nome: d.parceiro_nome,
    data_emissao: d.data_emissao, valor_total: d.valor_total, moeda: d.moeda, moeda_casas: d.moeda_casas,
    saldo_aberto: somar(abertos.map((t) => t.saldo), d.moeda_casas), proximo_vencimento: abertos[0]?.vencimento ?? null,
    tem_estoque: d.itens.some((i) => i.tipo_item === 'MERCADORIA'), created_date: d.created_date,
  };
};

/** Idempotência: mesmo operation_id + mesmo conteúdo = replay; conteúdo diferente = IDEMPOTENCY_CONFLICT. */
const idempotente = (estado, tipo, corpo, executar) => {
  const { operation_id: op, ...resto } = corpo;
  const chave = `${tipo}:${op}`;
  const fp = JSON.stringify(resto);
  const anterior = estado.idem.get(chave);
  if (anterior) {
    if (anterior.fp !== fp) return erro(409, 'IDEMPOTENCY_CONFLICT');
    return { status: 200, body: { ...anterior.body, replay: true } };
  }
  const r = executar();
  if (r.status < 300) estado.idem.set(chave, { fp, body: r.body });
  return r;
};

const falha = (estado, rota) => {
  const f = estado.falhas[rota];
  if (!f) return null;
  if (f.umaVez) delete estado.falhas[rota];
  return f;
};

/**
 * Roteador do backend falso. Devolve `{status, body}`, `{rede: true}` (simula
 * conexão caída DEPOIS de gravar quando `gravarAntes`) ou undefined (rota ausente).
 * @param {ReturnType<typeof criarEstadoLancamentos>} estado
 * @param {{ method: string, path: string, query: URLSearchParams, body: any }} req
 */
export const rotearLancamentos = async (estado, { method, path, query, body }) => {
  if (path === '/perfis-financeiros-empresa') {
    if (method === 'GET') return { status: 200, body: { perfil: estado.perfil, fuso_horario: estado.fuso, catalogo: CATALOGO } };
    if (method === 'PUT') {
      const f = falha(estado, 'perfil');
      if (f) return f.resposta;
      const casas = CATALOGO.moedas.find((m) => m.codigo === body.moeda)?.casas ?? 2;
      estado.perfil = { empresa_id: body.empresa_id, pais: body.pais, moeda: body.moeda, moeda_casas: casas, locale: body.locale, versao_contrato: 1, metodos_permitidos: metodosPermitidos(body.pais, body.moeda) };
      return { status: 200, body: estado.perfil };
    }
  }
  if (path.startsWith('/operacoes-financeiras-opcoes/')) {
    const recurso = path.split('/').pop();
    const f = falha(estado, `opcoes:${recurso}`);
    if (f && (!f.soComCursor || query.get('cursor'))) return f.resposta;
    if (recurso === 'parceiros') {
      const direcao = query.get('direcao');
      const lista = [...PARCEIROS, ...estado.parceirosExtras].filter((p) => (direcao === 'RECEBER' ? p.papeis.includes('cliente') : p.papeis.some((x) => x === 'fornecedor' || x === 'prestador_servico')));
      return { status: 200, body: pagina(filtrarQ(lista, query), query) };
    }
    if (recurso === 'produtos') return { status: 200, body: pagina(filtrarQ(PRODUTOS, query), query) };
    if (recurso === 'locais') return { status: 200, body: pagina(filtrarQ(LOCAIS, query), query) };
    if (recurso === 'naturezas') return { status: 200, body: pagina(filtrarQ(NATUREZAS.filter((n) => n.tipo === query.get('tipo')), query, ['nome', 'caminho']), query) };
    if (recurso === 'centros-custo') return { status: 200, body: pagina(filtrarQ(CENTROS_CUSTO, query), query) };
    if (recurso === 'centros-resultado') return { status: 200, body: pagina(filtrarQ(CENTROS_RESULTADO, query), query) };
    if (recurso === 'saldos') return { status: 200, body: { itens: SALDOS[query.get('produto_id')] ?? [] } };
  }
  if (path === '/operacoes-financeiras' && method === 'GET') {
    const q = (query.get('q') || '').toLowerCase();
    const itens = estado.documentos
      .filter((d) => !query.get('direcao') || d.direcao === query.get('direcao'))
      .filter((d) => !query.get('status') || d.status === query.get('status'))
      .filter((d) => !q || `${d.numero} ${d.parceiro_nome} ${d.documento_referencia ?? ''}`.toLowerCase().includes(q))
      .map(resumoLista);
    return { status: 200, body: { items: itens, next_cursor: null, has_more: false, total: itens.length, limit: Number(query.get('limit') || 50) } };
  }
  if (path === '/operacoes-financeiras' && method === 'POST') {
    const f = falha(estado, 'criar');
    if (f && !f.gravarAntes) return f.resposta ?? { rede: true };
    const r = idempotente(estado, 'criar', body, () => {
      if (!estado.perfil) return erro(409, 'PERFIL_FINANCEIRO_NAO_CONFIGURADO');
      const { operation_id: _op, ...corpo } = body;
      const r = ouRecusa(() => montarDoc(estado, corpo));
      if (r.recusa) return r.recusa;
      estado.documentos.unshift(r.ok);
      return { status: 201, body: detalhe(r.ok, { replay: false }) };
    });
    if (f?.gravarAntes) return { rede: true };
    return r;
  }
  let m = path.match(/^\/operacoes-financeiras\/([^/]+)(?:\/(previa|confirmar|cancelar))?$/);
  if (m) {
    const doc = estado.documentos.find((d) => d.id === m[1]);
    if (!doc) return erro(404, 'OPERACAO_FINANCEIRA_NOT_FOUND');
    const acao = m[2];
    if (!acao && method === 'GET') return { status: 200, body: detalhe(doc) };
    if (!acao && method === 'PUT') {
      const f = falha(estado, 'editar');
      if (f) return f.resposta ?? { rede: true };
      if (doc.status !== 'RASCUNHO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
      if (body.versao !== doc.versao) return erro(409, 'OPERACAO_VERSAO_CONFLITO');
      const { versao: _v, ...corpo } = body;
      const r = ouRecusa(() => montarDoc(estado, corpo, { id: doc.id, numero: doc.numero, versao: doc.versao + 1, created_date: doc.created_date, historico: doc.historico }));
      if (r.recusa) return r.recusa;
      Object.assign(doc, r.ok);
      return { status: 200, body: detalhe(doc) };
    }
    if (!acao && method === 'DELETE') {
      if (doc.status !== 'RASCUNHO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
      if (Number(query.get('versao')) !== doc.versao) return erro(409, 'OPERACAO_VERSAO_CONFLITO');
      estado.documentos = estado.documentos.filter((d) => d !== doc);
      return { status: 204 };
    }
    if (acao === 'previa' && method === 'POST') {
      const bloqueios = estado.bloqueiosPrevia;
      if (estado.planoNuloNaPrevia) return { status: 200, body: { plano: null, bloqueios } };
      const estoque = doc.itens.filter((i) => i.tipo_item === 'MERCADORIA').length;
      // Mesmo formato do `planejarOperacao` real (o front usa `resumo`; o resto é contrato).
      const mercadorias = doc.itens.filter((i) => i.tipo_item === 'MERCADORIA');
      // Chaves EXATAS do servidor (rateioCabecalhoVetores.json → formato.efeitos_estoque_chaves):
      // entrada leva o custo líquido por kg; saída leva disponível/custo/fatias (aqui sem
      // simulação FIFO: null/null/[] — como o servidor quando não há simulação).
      const base = (i) => ({ item_ordem: i.ordem, produto_id: i.produto_id, produto_nome: i.produto_nome, local_estoque_id: i.local_estoque_id, local_nome: i.local_estoque_nome, kg: i.quantidade_estoque });
      const entrada = (i) => ({ ...base(i), custo_kg: i.custo_kg ?? null });
      const saida = (i) => ({ ...base(i), disponivel: null, custo_total: null, fatias: [] });
      const comRateio = doc.conteudo === 'COM_PRODUTOS' && doc.itens.length > 0;
      const residuos = doc.itens.map((i) => i.residuo_custo).filter((r) => r != null);
      const plano = {
        moeda: doc.moeda, moeda_casas: doc.moeda_casas, valor_bruto: doc.valor_bruto, valor_desconto: doc.valor_desconto, valor_acrescimo: doc.valor_acrescimo, valor_total: doc.valor_total,
        itens: doc.itens.map(({ ordem, tipo_item, produto_id, local_estoque_id, unidade, quantidade, valor_unitario, valor_total, fator_kg, quantidade_estoque, valor_desconto_rateado, valor_acrescimo_rateado, valor_liquido, custo_kg, residuo_custo }) => ({
          ordem, tipo_item, produto_id, local_estoque_id, unidade, quantidade, valor_unitario, valor_total, fator_kg, quantidade_estoque,
          valor_desconto_rateado, valor_acrescimo_rateado, valor_liquido, custo_kg: custo_kg ?? null, residuo_custo: residuo_custo ?? null,
        })),
        rateios: doc.rateios.map(({ ordem, natureza_id, centro_custo_id, centro_resultado_id, valor, percentual }) => ({ ordem, natureza_id, centro_custo_id, centro_resultado_id, valor, percentual })),
        parcelas: doc.titulos.map((t) => ({ numero_parcela: t.numero_parcela, total_parcelas: t.total_parcelas, vencimento: t.vencimento, valor: t.valor })),
        efeitos_estoque: { entradas: doc.direcao === 'PAGAR' ? mercadorias.map(entrada) : [], saidas: doc.direcao === 'RECEBER' ? mercadorias.map(saida) : [] },
        resumo: { parcelas_n: doc.titulos.length, itens_estoque_n: estoque, valor_titulos: doc.valor_total, moeda: doc.moeda },
        // Como `planejarOperacao` real (rodada 4), só informativos: rateio do cabeçalho
        // num COM_PRODUTOS com desconto ou acréscimo; resíduo de custo ≠ 0 em alguma linha.
        avisos: [
          ...(comRateio && (ehPositivo(doc.valor_desconto) || ehPositivo(doc.valor_acrescimo))
            ? [{
                codigo: 'desconto_acrescimo_rateados',
                mensagem: doc.direcao === 'PAGAR'
                  ? 'desconto e acréscimo do cabeçalho foram rateados entre as linhas proporcionalmente ao subtotal; o custo do lote é o valor líquido da mercadoria'
                  : 'desconto e acréscimo do cabeçalho foram rateados entre as linhas proporcionalmente ao subtotal (receita líquida por item); a saída do estoque continua com o custo FIFO dos lotes',
              }]
            : []),
          ...(residuos.some((r) => comparar(r, '0') !== 0)
            ? [{ codigo: 'residuo_custo_estoque', mensagem: 'diferença de arredondamento do custo por kg fora do custo FIFO', residuo_total: somarResiduos(residuos) }]
            : []),
        ],
      };
      return { status: 200, body: { plano, bloqueios } };
    }
    if (acao === 'confirmar' && method === 'POST') {
      if (estado.segurarConfirmar) await estado.segurarConfirmar;
      const f = falha(estado, 'confirmar');
      if (f && !f.gravarAntes) return f.resposta ?? { rede: true };
      const r = idempotente(estado, 'confirmar', body, () => {
        if (doc.status !== 'RASCUNHO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
        if (body.versao !== doc.versao) return erro(409, 'OPERACAO_VERSAO_CONFLITO');
        doc.status = 'CONFIRMADO';
        doc.confirmado_por = usuario;
        doc.confirmado_em = TS;
        doc.titulos.forEach((t) => { t.status = 'ABERTO'; });
        doc.itens.forEach((i, k) => {
          if (i.tipo_item !== 'MERCADORIA') return;
          i.movimentacao_estoque_id = `mov-${doc.id}-${k + 1}`;
          if (doc.direcao === 'PAGAR') i.estoque_lote_nota_id = `lote-${doc.id}-${k + 1}`;
          else i.consumos = [{ estoque_lote_nota_id: 'lote-antigo-1', quantidade: i.quantidade_estoque, custo_unitario: '2.5000' }];
        });
        if (body.baixa_no_ato) {
          const t = doc.titulos[0];
          t.liquidacoes.push({ id: `liq-${++estado.seq}`, tipo: 'LIQUIDACAO', valor: t.valor, data: body.baixa_no_ato.data, metodo: body.baixa_no_ato.metodo, referencia: body.baixa_no_ato.referencia ?? null, observacao: null, estorna_liquidacao_id: null, estornada: false, estorno_id: null, motivo: null, registrado_por: usuario, created_date: TS });
          recalcularTitulo(t);
        }
        doc.versao += 1;
        doc.historico.push({ acao: 'operacao_financeira.confirmar', em: TS, usuario_login: 'dono' });
        return { status: 200, body: detalhe(doc, { replay: false }) };
      });
      if (f?.gravarAntes) return { rede: true };
      return r;
    }
    if (acao === 'cancelar' && method === 'POST') {
      const f = falha(estado, 'cancelar');
      if (f) return f.resposta ?? { rede: true };
      return idempotente(estado, 'cancelar', body, () => {
        if (doc.status !== 'CONFIRMADO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
        if (doc.titulos.some((t) => ehPositivo(t.valor_liquidado))) return erro(409, 'OPERACAO_COM_LIQUIDACOES');
        doc.status = 'CANCELADO';
        doc.cancelado_por = usuario;
        doc.cancelado_em = TS;
        doc.motivo_cancelamento = body.motivo;
        doc.titulos.forEach((t) => { t.status = 'CANCELADO'; });
        doc.itens.forEach((i, k) => { if (i.movimentacao_estoque_id) i.movimentacao_estorno_id = `mov-estorno-${doc.id}-${k + 1}`; });
        doc.historico.push({ acao: 'operacao_financeira.cancelar', em: TS, usuario_login: 'dono' });
        return { status: 200, body: detalhe(doc, { replay: false }) };
      });
    }
  }
  m = path.match(/^\/titulos-financeiros\/([^/]+)\/liquidacoes$/);
  if (m && method === 'POST') {
    const doc = estado.documentos.find((d) => d.titulos.some((t) => t.id === m[1]));
    if (!doc) return erro(404, 'TITULO_FINANCEIRO_NOT_FOUND');
    const t = doc.titulos.find((x) => x.id === m[1]);
    const f = falha(estado, 'liquidar');
    if (f && !f.gravarAntes) return f.resposta ?? { rede: true };
    const r = idempotente(estado, 'liquidar', body, () => {
      if (t.status !== 'ABERTO' && t.status !== 'PARCIAL') return erro(409, 'TITULO_NAO_LIQUIDAVEL');
      if (comparar(body.valor, t.saldo) > 0) return erro(422, 'LIQUIDACAO_EXCEDE_SALDO', { details: { saldo: t.saldo, valor: body.valor } });
      t.liquidacoes.push({ id: `liq-${++estado.seq}`, tipo: 'LIQUIDACAO', valor: naEscala(body.valor, casasDe(doc)), data: body.data, metodo: body.metodo, referencia: body.referencia ?? null, observacao: body.observacao ?? null, estorna_liquidacao_id: null, estornada: false, estorno_id: null, motivo: null, registrado_por: usuario, created_date: TS });
      recalcularTitulo(t);
      doc.historico.push({ acao: 'titulo_financeiro.liquidar', em: TS, usuario_login: 'dono' });
      return { status: 201, body: detalhe(doc, { replay: false }) };
    });
    if (f?.gravarAntes) return { rede: true };
    return r;
  }
  m = path.match(/^\/liquidacoes-financeiras\/([^/]+)\/estorno$/);
  if (m && method === 'POST') {
    const doc = estado.documentos.find((d) => d.titulos.some((t) => t.liquidacoes.some((l) => l.id === m[1])));
    if (!doc) return erro(404, 'LIQUIDACAO_FINANCEIRA_NOT_FOUND');
    const t = doc.titulos.find((x) => x.liquidacoes.some((l) => l.id === m[1]));
    const l = t.liquidacoes.find((x) => x.id === m[1]);
    const f = falha(estado, 'estornar');
    if (f && !f.gravarAntes) return f.resposta ?? { rede: true };
    const r = idempotente(estado, 'estornar', body, () => {
      if (l.tipo === 'ESTORNO') return erro(404, 'LIQUIDACAO_FINANCEIRA_NOT_FOUND');
      if (l.estornada) return erro(409, 'LIQUIDACAO_JA_ESTORNADA');
      // Como o backend real: a baixa fica `estornada` (com `estorno_id`) e o
      // estorno aparece como linha própria `tipo: 'ESTORNO'` (só exibição).
      const estornoId = `est-${++estado.seq}`;
      l.estornada = true;
      l.estorno_id = estornoId;
      t.liquidacoes.push({ id: estornoId, tipo: 'ESTORNO', valor: l.valor, data: TS.slice(0, 10), metodo: null, referencia: null, observacao: null, estorna_liquidacao_id: l.id, estornada: false, estorno_id: null, motivo: body.motivo, registrado_por: usuario, created_date: TS });
      recalcularTitulo(t);
      doc.historico.push({ acao: 'liquidacao_financeira.estornar', em: TS, usuario_login: 'dono' });
      return { status: 201, body: detalhe(doc, { replay: false }) };
    });
    if (f?.gravarAntes) return { rede: true };
    return r;
  }
  return undefined;
};

/** Documento pronto (útil para cenários de consulta): cria pelo próprio contrato. */
export const semearDocumento = (estado, corpo, { confirmar = false } = {}) => {
  const doc = montarDoc(estado, corpo);
  estado.documentos.unshift(doc);
  if (confirmar) {
    doc.status = 'CONFIRMADO';
    doc.confirmado_por = usuario;
    doc.confirmado_em = TS;
    doc.titulos.forEach((t) => { t.status = 'ABERTO'; });
    doc.versao += 1;
    doc.itens.forEach((i, k) => {
      if (i.tipo_item === 'MERCADORIA') {
        i.movimentacao_estoque_id = `mov-${doc.id}-${k + 1}`;
        if (doc.direcao === 'PAGAR') i.estoque_lote_nota_id = `lote-${doc.id}-${k + 1}`;
      }
    });
    doc.historico.push({ acao: 'operacao_financeira.confirmar', em: TS, usuario_login: 'dono' });
  }
  return doc;
};
