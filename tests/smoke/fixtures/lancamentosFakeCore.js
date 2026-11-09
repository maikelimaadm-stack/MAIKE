/**
 * Backend FALSO da Central Única de Lançamentos (D-PROD-155) — só para testes
 * RTL e para a evidência visual (scripts/dev/visual-lancamentos-financeiros.mjs).
 * D-PROD-156 (P3-02): `rateio_escopo` (ausente/NULL = GERAL), `itens[].rateios`,
 * `rateio_consolidado` e as recusas do rateio por item com `subindice`.
 * Nada aqui fala com banco ou API real. Segue o contrato do SPEC §5/§6/§8:
 * valores em string canônica, datas AAAA-MM-DD, `operation_id` idempotente,
 * `versao` com compare-and-swap, corpo de erro `{code, message, request_id,
 * field?, reason?, details?}`. Sem dependência de Vitest (puro JS).
 * D-PROD-157 (P3-03, SPEC §3–§6): `GET /:id/elegibilidade`, `POST /:id/retificar`
 * (NO_LUGAR quando a assinatura física não muda; SUBSTITUICAO atômica quando
 * muda), `POST /:id/excluir` (lógico), `situacao` na lista, `excluido_em`,
 * `retificado_em`, `exclusao`, `substitui`, `substituido_por` e `eventos` no
 * detalhe, `duplicado_de_id` no POST (gravado só na auditoria da criação) e as
 * mesmas recusas: OPERACAO_RETIFICACAO_BLOQUEADA / OPERACAO_EXCLUSAO_BLOQUEADA
 * com `details.motivos`, versão, status e declaração física.
 */
import { comparar, ehPositivo, multiplicarArredondar, naEscala, percentualDe, ratearPercentual, somar, subtrair } from '../../../src/lib/dinheiroDecimal.js';
import { ratearCabecalho } from '../../../src/lib/rateioCabecalho.js';
import { ESCOPOS_RATEIO, MAX_RATEIOS_ITENS_TOTAL, MAX_RATEIOS_POR_ITEM, consolidarRateio, planejarRateioDoItem } from '../../../src/lib/rateioPorItem.js';

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
  /**
   * D-PROD-157 — permissões que o SERVIDOR enxerga para a elegibilidade
   * (`sem_permissao` entra como motivo, nunca mascarado).
   */
  permissoes: { criar: true, editar: true, confirmar: true, cancelar: true, excluir: true },
  /**
   * D-PROD-157 — dependências físicas por documento (lote consumido/alterado,
   * venda com movimento posterior): `{ [docId]: motivo[] }`. Com elas o
   * estoque não pode ser refeito (efeito_fisico_permitido=false).
   */
  dependencias: /** @type {Record<string, any[]>} */ ({}),
  /** D-PROD-157 — AuditLog da criação (proveniência `duplicado_de_id`). */
  auditoria: /** @type {any[]} */ ([]),
  /** D-PROD-157 — eventos de revisão/exclusão (com snapshot, como a tabela nova). */
  eventos: /** @type {any[]} */ ([]),
  /** Promessa que segura a resposta do GET de detalhe (troca de empresa no meio do Duplicar). */
  segurarDetalhe: /** @type {Promise<void>|null} */ (null),
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

// ─── D-PROD-156 — rateio POR ITEM (SPEC §3–§5) ───────────────────────────

const rateioInvalido = (details) => new RecusaDoServidor(erro(422, 'OPERACAO_RATEIO_INVALIDO', { field: details.field, reason: details.reason, details }));
const posicaoNoItem = (indice, subindice) => ({ colecao: 'itens', indice, subcolecao: 'rateios', ...(subindice === undefined ? {} : { subindice }) });

/**
 * Escopo e exclusões, na ordem do `exigirEscopoDoRateio` do servidor: escopo
 * fora do domínio; POR_ITEM sem produtos; geral + por item; GERAL sem linha;
 * item sem linha; tetos (20 por item, 1000 no documento). Ausente = GERAL.
 * @returns {'GERAL'|'POR_ITEM'}
 */
const exigirEscopoDoRateio = (corpo) => {
  const escopo = corpo.rateio_escopo ?? 'GERAL';
  if (!ESCOPOS_RATEIO.includes(escopo)) throw rateioInvalido({ field: 'rateio_escopo', reason: 'escopo_invalido', permitidos: [...ESCOPOS_RATEIO] });
  if (escopo === 'POR_ITEM' && corpo.conteudo !== 'COM_PRODUTOS') throw rateioInvalido({ field: 'rateio_escopo', reason: 'escopo_por_item_exige_produtos' });
  const itens = corpo.itens ?? [];
  const topo = corpo.rateios ?? [];
  const itemComLinhas = itens.findIndex((i) => Array.isArray(i.rateios) && i.rateios.length > 0);
  const juntos = (details) => rateioInvalido({ field: 'rateios', reason: 'rateio_geral_e_por_item', escopo, ...details });
  if (escopo === 'GERAL') {
    if (itemComLinhas >= 0) throw juntos(posicaoNoItem(itemComLinhas));
    if (!topo.length) throw rateioInvalido({ field: 'rateios', reason: 'rateio_geral_obrigatorio' });
    return 'GERAL';
  }
  if (topo.length) throw juntos({ colecao: 'rateios', indice: 0 });
  let total = 0;
  itens.forEach((item, indice) => {
    const n = (item.rateios ?? []).length;
    if (!n) throw rateioInvalido({ field: 'rateios', reason: 'item_sem_rateio', ...posicaoNoItem(indice) });
    if (n > MAX_RATEIOS_POR_ITEM) throw rateioInvalido({ field: 'rateios', reason: 'rateio_item_excede_limite', ...posicaoNoItem(indice), limite: MAX_RATEIOS_POR_ITEM, informado: n });
    total += n;
    if (total > MAX_RATEIOS_ITENS_TOTAL) {
      throw rateioInvalido({ field: 'rateios', reason: 'rateio_itens_excede_limite', ...posicaoNoItem(indice), limite: MAX_RATEIOS_ITENS_TOTAL, informado: itens.reduce((t, i) => t + (i.rateios ?? []).length, 0) });
    }
  });
  return 'POR_ITEM';
};

/** Casas decimais LITERAIS do texto, como `casasDecimais` do servidor (zero à direita conta). */
const casasDoTexto = (v) => {
  const t = String(v);
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
};

/**
 * Linhas do rateio de cada item, como o `normalizarLinhasDeRateio` do servidor
 * (400 antes de qualquer conta, logo depois do escopo): VALOR exige `valor` e
 * PERCENTUAL exige `percentual`; dinheiro com mais casas que a moeda →
 * `casas_decimais_excedidas`. O corpo do erro é o do servidor (field/reason no
 * topo; posição da linha em `details`).
 */
const normalizarLinhasDosItens = (corpo, casas) => {
  const percentual = corpo.rateio_modo === 'PERCENTUAL';
  const field = percentual ? 'percentual' : 'valor';
  const recusa = (reason, details) => new RecusaDoServidor(erro(400, 'REQUEST_VALIDATION_FAILED', { field, reason, details }));
  (corpo.itens ?? []).forEach((item, indice) => {
    (item.rateios ?? []).forEach((l, subindice) => {
      const v = l?.[field];
      if (v === null || v === undefined) throw recusa('obrigatorio', posicaoNoItem(indice, subindice));
      if (!percentual && casasDoTexto(v) > casas) throw recusa('casas_decimais_excedidas', { casas, ...posicaoNoItem(indice, subindice) });
    });
  });
};

/** Linha de rateio do DETALHE (mesmos campos no geral e no item; nomes do cadastro). */
const linhaDoDetalhe = (r, ordem, valor, percentual) => {
  const nat = NATUREZAS.find((n) => n.id === r.natureza_id);
  return {
    ordem, natureza_id: r.natureza_id, natureza_nome: nat?.nome ?? null, natureza_tipo: nat?.tipo ?? null,
    centro_custo_id: r.centro_custo_id ?? null, centro_custo_nome: CENTROS_CUSTO.find((c) => c.id === r.centro_custo_id)?.nome ?? null,
    centro_resultado_id: r.centro_resultado_id ?? null, centro_resultado_nome: CENTROS_RESULTADO.find((c) => c.id === r.centro_resultado_id)?.nome ?? null,
    percentual, valor,
  };
};

/**
 * POR_ITEM: cada item sobre o SEU líquido (a MESMA conta da tela e do servidor,
 * src/lib/rateioPorItem.js); a recusa aponta item e linha.
 */
const ratearPorItem = (corpo, itens, casas) =>
  itens.forEach((item, indice) => {
    const percentual = corpo.rateio_modo === 'PERCENTUAL';
    const linhas = (corpo.itens[indice].rateios ?? []).map((l) => ({
      natureza_id: l.natureza_id, centro_custo_id: l.centro_custo_id ?? null, centro_resultado_id: l.centro_resultado_id ?? null,
      valor: percentual ? null : l.valor ?? null, percentual: percentual ? l.percentual ?? null : null,
    }));
    const r = planejarRateioDoItem({ modo: corpo.rateio_modo, liquido: item.valor_liquido, linhas, casas });
    if (r.erro) {
      throw rateioInvalido({
        field: r.erro.field, reason: r.erro.reason, ...posicaoNoItem(indice, r.erro.subindice), item_ordem: item.ordem, ...r.erro.details,
        ...(r.erro.reason === 'soma_diferente' ? { valor_liquido: item.valor_liquido } : {}),
      });
    }
    item.rateios = linhas.map((l, j) => linhaDoDetalhe(l, j + 1, r.valores[j], r.percentuais[j]));
  });

/** Documento do corpo DOC (como o servidor recalcula). */
const montarDoc = (estado, corpo, base = {}) => {
  const casas = estado.perfil?.moeda_casas ?? 2;
  const escopo = exigirEscopoDoRateio(corpo);
  if (escopo === 'POR_ITEM') normalizarLinhasDosItens(corpo, casas);
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
  itens.forEach((i, k) => Object.assign(i, rateio?.itens[k] ?? {}, { rateios: [] }));
  if (escopo === 'POR_ITEM') ratearPorItem(corpo, itens, casas);
  const rateiosCorpo = escopo === 'POR_ITEM' ? [] : corpo.rateios ?? [];
  const valoresPct = corpo.rateio_modo === 'PERCENTUAL' ? ratearPercentual(total, rateiosCorpo.map((r) => r.percentual), casas).valores : [];
  const rateios = rateiosCorpo.map((r, k) => {
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
    valor_bruto: bruto, valor_desconto: desconto, valor_acrescimo: acrescimo, valor_total: total, rateio_modo: corpo.rateio_modo, rateio_escopo: escopo,
    metodo_preferido: corpo.metodo_preferido ?? null, criado_por: usuario, confirmado_por: null, confirmado_em: null, cancelado_por: null,
    cancelado_em: null, motivo_cancelamento: null, created_date: base.created_date ?? TS, updated_date: TS,
    itens, rateios, titulos, historico: [...(base.historico ?? []), { acao: base.id ? 'operacao_financeira.editar' : 'operacao_financeira.criar', em: TS, usuario_login: 'dono' }],
    // Resumo consolidado (D-PROD-156): no GERAL são as próprias linhas do geral (percentual
    // gravado ou informativo sobre o total); no POR_ITEM, a soma por natureza + centros.
    rateio_consolidado:
      escopo === 'POR_ITEM'
        ? consolidarRateio(itens.flatMap((i) => i.rateios), total, casas)
        : rateios.map(({ ordem: _o, natureza_tipo: _t, ...r }) => ({ ...r, percentual: r.percentual ?? percentualDe(r.valor, total, casas, 6) })),
  };
};

/** Evento público (sem o snapshot), como o detalhe do servidor devolve. */
const eventoPublico = ({ snapshot_anterior: _s, cliente_id: _c, empresa_id: _e, id: _id, ...e }) => ({ ...e });

/**
 * Cadeia lógica de revisões nos dois sentidos (SPEC §6): os eventos do próprio
 * documento e os das versões ligadas por substituição, até 50, sem snapshot.
 */
const eventosDaCadeia = (estado, doc) => {
  const ids = new Set([doc.id]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const e of estado.eventos) {
      if (e.modo !== 'SUBSTITUICAO') continue;
      if (ids.has(e.operacao_id) && !ids.has(e.operacao_nova_id)) { ids.add(e.operacao_nova_id); mudou = true; }
      if (ids.has(e.operacao_nova_id) && !ids.has(e.operacao_id)) { ids.add(e.operacao_id); mudou = true; }
    }
  }
  return estado.eventos.filter((e) => ids.has(e.operacao_id) || (e.operacao_nova_id && ids.has(e.operacao_nova_id))).slice(0, 50).map(eventoPublico);
};

/** Campos de leitura do D-PROD-157 (detalhe). */
const camposDeRevisao = (estado, doc) => {
  const exclusao = estado.eventos.find((e) => e.tipo === 'EXCLUSAO' && e.operacao_id === doc.id);
  const saiu = estado.eventos.find((e) => e.modo === 'SUBSTITUICAO' && e.operacao_id === doc.id);
  const entrou = estado.eventos.find((e) => e.modo === 'SUBSTITUICAO' && e.operacao_nova_id === doc.id);
  const numeroDe = (id) => estado.documentos.find((d) => d.id === id)?.numero ?? null;
  return {
    excluido_em: doc.excluido_em ?? null,
    retificado_em: doc.retificado_em ?? null,
    exclusao: exclusao ? { em: exclusao.em, por: exclusao.por, motivo: exclusao.motivo } : null,
    substituido_por: saiu ? { id: saiu.operacao_nova_id, numero: numeroDe(saiu.operacao_nova_id) } : null,
    substitui: entrou ? { id: entrou.operacao_id, numero: numeroDe(entrou.operacao_id) } : null,
    eventos: eventosDaCadeia(estado, doc),
  };
};

/** Detalhe como o servidor devolve (cópia: o teste não muta o estado por engano). */
const detalhe = (doc, extra = {}, estado = null) => {
  const copia = JSON.parse(JSON.stringify(doc));
  copia.titulos = copia.titulos.map(({ moeda_casas: _c, ...t }) => t);
  // Como o servidor: NULL (documento da P3-01) é GERAL; `itens[].rateios` sempre presente.
  copia.rateio_escopo = copia.rateio_escopo ?? 'GERAL';
  copia.itens = copia.itens.map((i) => ({ ...i, rateios: i.rateios ?? [] }));
  copia.rateio_consolidado = copia.rateio_consolidado ?? [];
  const revisao = estado ? camposDeRevisao(estado, doc) : { excluido_em: doc.excluido_em ?? null, retificado_em: doc.retificado_em ?? null };
  return { ...copia, ...revisao, ...extra };
};

const resumoLista = (d) => {
  const abertos = d.titulos.filter((t) => t.status === 'ABERTO' || t.status === 'PARCIAL');
  return {
    id: d.id, numero: d.numero, status: d.status, direcao: d.direcao, conteudo: d.conteudo, condicao: d.condicao, parceiro_nome: d.parceiro_nome,
    data_emissao: d.data_emissao, valor_total: d.valor_total, moeda: d.moeda, moeda_casas: d.moeda_casas,
    saldo_aberto: somar(abertos.map((t) => t.saldo), d.moeda_casas), proximo_vencimento: abertos[0]?.vencimento ?? null,
    tem_estoque: d.itens.some((i) => i.tipo_item === 'MERCADORIA'), created_date: d.created_date, rateio_escopo: d.rateio_escopo ?? 'GERAL',
    excluido_em: d.excluido_em ?? null, retificado_em: d.retificado_em ?? null,
  };
};

// ─── D-PROD-157 — elegibilidade, retificar e excluir (SPEC §3–§5) ─────────

const SITUACOES = ['OPERACIONAIS', 'EXCLUIDOS', 'TODOS'];
/** Filtro `situacao` da lista: OPERACIONAIS (padrão) sem excluídos nem versões substituídas. */
const naSituacao = (d, situacao) => {
  if (situacao === 'TODOS') return true;
  if (situacao === 'EXCLUIDOS') return Boolean(d.excluido_em);
  return !d.excluido_em && !d.retificado_em;
};

/** Qualquer liquidação já registrada (ativa OU estornada) bloqueia: a baixa é fato histórico. */
const motivosDeLiquidacao = (doc) =>
  doc.titulos.flatMap((t) =>
    t.liquidacoes
      .filter((l) => l.tipo !== 'ESTORNO')
      .map((l) => ({ codigo: 'tem_liquidacao', mensagem: `a parcela ${t.numero_parcela} tem liquidação registrada`, entidade: 'LiquidacaoFinanceira', id: l.id, numero_parcela: t.numero_parcela, estornada: l.estornada === true })),
  );

/** Como o servidor: `exige` lista as ações de tela que faltam. */
const semPermissao = (...faltam) => ({ codigo: 'sem_permissao', mensagem: `você não tem permissão (falta: ${faltam.join(', ')})`, exige: faltam });

/** A mesma decisão do serviço (SPEC §3), para o GET e para os comandos. */
const avaliarElegibilidade = (estado, doc) => {
  const p = estado.permissoes;
  const historico = doc.status === 'CANCELADO' || Boolean(doc.excluido_em) || Boolean(doc.retificado_em);
  const temMercadoria = doc.itens.some((i) => i.tipo_item === 'MERCADORIA');
  const dependencias = temMercadoria ? estado.dependencias[doc.id] ?? [] : [];
  const fisicoOk = dependencias.length === 0;
  const faltaEditar = [...(p.editar ? [] : ['editar']), ...(p.confirmar ? [] : ['confirmar'])];
  const faltaExcluir = [...(p.cancelar ? [] : ['cancelar']), ...(p.excluir ? [] : ['excluir'])];
  const permEditar = faltaEditar.length ? [semPermissao(...faltaEditar)] : [];
  const permExcluir = faltaExcluir.length ? [semPermissao(...faltaExcluir)] : [];
  const duplicar = { permitido: Boolean(p.criar), motivos: p.criar ? [] : [semPermissao('novo')] };
  if (doc.status === 'RASCUNHO') {
    const semEditar = p.editar ? [] : [semPermissao('editar')];
    return {
      editar: { permitido: !semEditar.length, modo: semEditar.length ? null : 'RASCUNHO', efeito_fisico_permitido: true, motivos: semEditar },
      excluir: { permitido: !semEditar.length, modo: semEditar.length ? null : 'DESCARTE', motivos: semEditar },
      duplicar,
    };
  }
  // Como o servidor: documento histórico vem antes de tudo (com as permissões que faltam).
  if (historico) {
    const h = documentoHistorico(estado, doc);
    return {
      editar: { permitido: false, modo: null, efeito_fisico_permitido: false, motivos: [h, ...permEditar] },
      excluir: { permitido: false, modo: null, motivos: [h, ...permExcluir] },
      duplicar,
    };
  }
  // Mesma ordem do servidor: liquidação → permissão (→ dependência física). Os
  // motivos físicos vêm em `editar.motivos` MESMO com a correção permitida (a
  // faixa da tela os mostra); `efeito_fisico_permitido` só depende da prova física.
  const liquidacoes = motivosDeLiquidacao(doc);
  const bloqueiosEditar = [...liquidacoes, ...permEditar];
  const editarOk = bloqueiosEditar.length === 0;
  const motivosExcluir = [...liquidacoes, ...(fisicoOk ? [] : dependencias), ...permExcluir];
  const excluirOk = motivosExcluir.length === 0;
  return {
    editar: { permitido: editarOk, modo: editarOk ? 'RETIFICACAO' : null, efeito_fisico_permitido: fisicoOk, motivos: [...bloqueiosEditar, ...dependencias] },
    excluir: { permitido: excluirOk, modo: excluirOk ? 'LOGICA' : null, motivos: motivosExcluir },
    duplicar,
  };
};

/**
 * Motivo `documento_historico` como o servidor: na versão substituída, aponta a
 * versão atual (`entidade`, `id`, `numero`).
 */
const documentoHistorico = (estado, doc) => {
  if (doc.retificado_em) {
    const ev = estado.eventos.find((e) => e.modo === 'SUBSTITUICAO' && e.operacao_id === doc.id);
    const nova = ev ? estado.documentos.find((d) => d.id === ev.operacao_nova_id) : null;
    return { codigo: 'documento_historico', mensagem: 'versão anterior, substituída por retificação', ...(nova ? { entidade: 'OperacaoFinanceira', id: nova.id, numero: nova.numero } : {}) };
  }
  return { codigo: 'documento_historico', mensagem: doc.excluido_em ? 'o lançamento foi excluído' : 'o lançamento está cancelado' };
};

/**
 * 409 de bloqueio como o tradutor HTTP do servidor: `field` = documento
 * (`id`), `reason` = código do 1º motivo e a lista em `details.motivos`.
 */
const bloqueio = (code, motivos, extra = {}) => erro(409, code, { field: 'id', reason: motivos[0]?.codigo ?? 'bloqueado', details: { motivos, ...extra } });

/** Assinatura física de um item MERCADORIA (SPEC §4.5) + cabeçalho. */
const assinaturaFisica = (doc) => {
  const merc = doc.itens.filter((i) => i.tipo_item === 'MERCADORIA');
  if (!merc.length) return '[]';
  return JSON.stringify({
    direcao: doc.direcao, data_operacional: doc.data_operacional,
    itens: merc.map((i) => [i.ordem, i.tipo_item, i.produto_id, i.local_estoque_id, i.unidade, naEscala(i.quantidade_estoque, 4), naEscala(i.fator_kg ?? '0', 4), doc.direcao === 'PAGAR' ? i.valor_liquido : null]),
  });
};

/** Snapshot da versão anterior (só histórico; nenhuma regra lê). */
const snapshotDe = (doc) => JSON.parse(JSON.stringify({ ...doc, historico: undefined }));

const registrarEvento = (estado, e) => {
  estado.eventos.push({ id: `ev${estado.eventos.length + 1}`, em: TS, por: usuario, ...e });
};

/** Estorna os efeitos físicos e cancela os títulos (núcleo do cancelamento). */
const estornarEfeitos = (doc) => {
  doc.titulos.forEach((t) => { t.status = 'CANCELADO'; });
  doc.itens.forEach((i, k) => { if (i.movimentacao_estoque_id) i.movimentacao_estorno_id = `mov-estorno-${doc.id}-${k + 1}`; });
};

/** Efeitos físicos e títulos da confirmação (núcleo da confirmação). */
const aplicarEfeitos = (doc, sufixo = '') => {
  doc.titulos.forEach((t) => { t.status = 'ABERTO'; });
  doc.itens.forEach((i, k) => {
    if (i.tipo_item !== 'MERCADORIA') return;
    i.movimentacao_estoque_id = `mov-${doc.id}${sufixo}-${k + 1}`;
    if (doc.direcao === 'PAGAR') i.estoque_lote_nota_id = `lote-${doc.id}${sufixo}-${k + 1}`;
    else i.consumos = [{ estoque_lote_nota_id: 'lote-antigo-1', quantidade: i.quantidade_estoque, custo_unitario: '2.5000' }];
  });
};

const motivoValido = (m) => typeof m === 'string' && m.trim().length > 0 && m.length <= 500;

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
    const situacao = query.get('situacao') || 'OPERACIONAIS';
    if (!SITUACOES.includes(situacao)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'situacao', reason: 'invalido' });
    const itens = estado.documentos
      .filter((d) => naSituacao(d, situacao))
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
      const { operation_id: _op, duplicado_de_id: duplicadoDe, ...corpo } = body;
      // D-PROD-157: proveniência da cópia — do mesmo tenant e da MESMA empresa, senão 422.
      if (duplicadoDe !== undefined) {
        const origem = estado.documentos.find((d) => d.id === duplicadoDe);
        if (typeof duplicadoDe !== 'string' || !origem || origem.empresa_id !== (corpo.empresa_id ?? EMPRESA)) {
          return erro(422, 'OPERACAO_REFERENCIA_INVALIDA', { field: 'duplicado_de_id', reason: 'duplicado_de_nao_encontrado' });
        }
      }
      const r = ouRecusa(() => montarDoc(estado, corpo));
      if (r.recusa) return r.recusa;
      estado.documentos.unshift(r.ok);
      // Só no AuditLog da criação: nada liga a vida dos dois documentos.
      estado.auditoria.push({ acao: 'operacao_financeira.criar', operacao_id: r.ok.id, ...(duplicadoDe ? { duplicado_de_id: duplicadoDe } : {}) });
      return { status: 201, body: detalhe(r.ok, { replay: false }, estado) };
    });
    if (f?.gravarAntes) return { rede: true };
    return r;
  }
  let m = path.match(/^\/operacoes-financeiras\/([^/]+)(?:\/(previa|confirmar|cancelar|elegibilidade|retificar|excluir))?$/);
  if (m) {
    const doc = estado.documentos.find((d) => d.id === m[1]);
    if (!doc) return erro(404, 'OPERACAO_FINANCEIRA_NOT_FOUND');
    const acao = m[2];
    if (!acao && method === 'GET') {
      if (estado.segurarDetalhe) await estado.segurarDetalhe;
      const f = falha(estado, 'detalhe');
      if (f) return f.resposta ?? { rede: true };
      return { status: 200, body: detalhe(doc, {}, estado) };
    }
    if (acao === 'elegibilidade' && method === 'GET') {
      const f = falha(estado, 'elegibilidade');
      if (f) return f.resposta ?? { rede: true };
      return { status: 200, body: { id: doc.id, versao: doc.versao, status: doc.status, ...avaliarElegibilidade(estado, doc) } };
    }
    if (acao === 'retificar' && method === 'POST') {
      const f = falha(estado, 'retificar');
      if (f && !f.gravarAntes) return f.resposta ?? { rede: true };
      const r = idempotente(estado, 'retificar', body, () => {
        const { operation_id: _op, versao, motivo, ...corpo } = body;
        if (!motivoValido(motivo)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'motivo', reason: 'obrigatorio' });
        // Como o servidor (`exigirVigente`): rascunho → 409 de situação (use o PUT);
        // cancelado/excluído/versão substituída → 409 de bloqueio `documento_historico`.
        if (doc.status === 'RASCUNHO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
        if (doc.status !== 'CONFIRMADO' || doc.excluido_em || doc.retificado_em) return bloqueio('OPERACAO_RETIFICACAO_BLOQUEADA', [documentoHistorico(estado, doc)]);
        if (versao !== doc.versao) return erro(409, 'OPERACAO_VERSAO_CONFLITO');
        // Normalização e plano ANTES da elegibilidade (mesma ordem do servidor):
        // a declaração física vale nos DOIS modos (o normalizador exige com mercadoria).
        const novo = ouRecusa(() => montarDoc(estado, corpo, { id: doc.id, numero: doc.numero, versao: doc.versao + 1, created_date: doc.created_date, historico: doc.historico }));
        if (novo.recusa) return novo.recusa;
        const plano = novo.ok;
        if (plano.itens.some((i) => i.tipo_item === 'MERCADORIA') && corpo.efeito_fisico_confirmado !== true) {
          return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'efeito_fisico_confirmado', reason: 'declaracao_obrigatoria' });
        }
        const eleg = avaliarElegibilidade(estado, doc);
        if (!eleg.editar.permitido) return bloqueio('OPERACAO_RETIFICACAO_BLOQUEADA', eleg.editar.motivos);
        // `montarDoc` anota "editar" (rascunho): a correção anota só "retificar".
        plano.historico = [...doc.historico];
        const snapshot = snapshotDe(doc);
        if (assinaturaFisica(plano) === assinaturaFisica(doc)) {
          // NO_LUGAR: mesmos movimentos e lotes; títulos recriados (nunca houve baixa).
          const movs = new Map(doc.itens.filter((i) => i.tipo_item === 'MERCADORIA').map((i) => [i.ordem, i]));
          plano.itens.forEach((i) => {
            const antigo = movs.get(i.ordem);
            if (antigo) Object.assign(i, { movimentacao_estoque_id: antigo.movimentacao_estoque_id, estoque_lote_nota_id: antigo.estoque_lote_nota_id, consumos: antigo.consumos });
          });
          plano.titulos.forEach((t, k) => { t.id = `${doc.id}-v${plano.versao}-t${k + 1}`; t.status = 'ABERTO'; });
          Object.assign(doc, plano, { status: 'CONFIRMADO', confirmado_por: doc.confirmado_por, confirmado_em: doc.confirmado_em });
          doc.historico.push({ acao: 'operacao_financeira.retificar', em: TS, usuario_login: 'dono' });
          registrarEvento(estado, { tipo: 'RETIFICACAO', modo: 'NO_LUGAR', operacao_id: doc.id, operacao_nova_id: null, numero_original: doc.numero, versao_anterior: snapshot.versao, versao_nova: doc.versao, motivo, snapshot_anterior: snapshot });
          return { status: 200, body: detalhe(doc, { replay: false, retificacao: { modo: 'NO_LUGAR', operacao_anterior_id: doc.id, operacao_atual_id: doc.id } }, estado) };
        }
        if (!eleg.editar.efeito_fisico_permitido) {
          const fisicos = eleg.editar.motivos.filter((m) => !['tem_liquidacao', 'sem_permissao'].includes(m.codigo));
          return bloqueio('OPERACAO_RETIFICACAO_BLOQUEADA', fisicos, { efeito_fisico_permitido: false });
        }
        // SUBSTITUICAO atômica: o antigo é estornado/cancelado e libera o número; o novo assume.
        const numero = doc.numero;
        estornarEfeitos(doc);
        Object.assign(doc, {
          status: 'CANCELADO', cancelado_por: usuario, cancelado_em: TS, motivo_cancelamento: `Retificado: ${motivo}`.slice(0, 500),
          retificado_em: TS, numero: `${numero}/r${doc.versao}`, versao: doc.versao + 1,
        });
        doc.historico.push({ acao: 'operacao_financeira.retificar', em: TS, usuario_login: 'dono' });
        const id = `op${++estado.seq}`;
        const atual = { ...plano, id, numero, versao: snapshot.versao + 1, status: 'CONFIRMADO', confirmado_por: usuario, confirmado_em: TS, created_date: TS, historico: [{ acao: 'operacao_financeira.retificar', em: TS, usuario_login: 'dono' }] };
        atual.itens = atual.itens.map((i, k) => ({ ...i, id: `${id}-i${k + 1}` }));
        atual.titulos = atual.titulos.map((t, k) => ({ ...t, id: `${id}-t${k + 1}` }));
        aplicarEfeitos(atual);
        estado.documentos.unshift(atual);
        registrarEvento(estado, { tipo: 'RETIFICACAO', modo: 'SUBSTITUICAO', operacao_id: doc.id, operacao_nova_id: id, numero_original: numero, versao_anterior: snapshot.versao, versao_nova: atual.versao, motivo, snapshot_anterior: snapshot });
        return { status: 200, body: detalhe(atual, { replay: false, retificacao: { modo: 'SUBSTITUICAO', operacao_anterior_id: doc.id, operacao_atual_id: id } }, estado) };
      });
      // `gravarAntes` + `resposta`: gravou, mas o cliente recebe outra coisa (504 depois do COMMIT).
      if (f?.gravarAntes) return f.resposta ?? { rede: true };
      return r;
    }
    if (acao === 'excluir' && method === 'POST') {
      const f = falha(estado, 'excluir');
      if (f && !f.gravarAntes) return f.resposta ?? { rede: true };
      const r = idempotente(estado, 'excluir', body, () => {
        const { versao, motivo } = body;
        const extras = Object.keys(body).filter((k) => !['empresa_id', 'versao', 'operation_id', 'motivo'].includes(k));
        if (extras.length) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: extras[0], reason: 'nao_permitido' });
        if (!motivoValido(motivo)) return erro(400, 'REQUEST_VALIDATION_FAILED', { field: 'motivo', reason: 'obrigatorio' });
        if (doc.status === 'RASCUNHO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
        if (doc.status !== 'CONFIRMADO' || doc.excluido_em || doc.retificado_em) return bloqueio('OPERACAO_EXCLUSAO_BLOQUEADA', [documentoHistorico(estado, doc)]);
        if (versao !== doc.versao) return erro(409, 'OPERACAO_VERSAO_CONFLITO');
        const eleg = avaliarElegibilidade(estado, doc);
        if (!eleg.excluir.permitido) return bloqueio('OPERACAO_EXCLUSAO_BLOQUEADA', eleg.excluir.motivos);
        const snapshot = snapshotDe(doc);
        estornarEfeitos(doc);
        Object.assign(doc, {
          status: 'CANCELADO', cancelado_por: usuario, cancelado_em: TS, motivo_cancelamento: `Excluído: ${motivo}`.slice(0, 500), excluido_em: TS, versao: doc.versao + 1,
        });
        doc.historico.push({ acao: 'operacao_financeira.excluir', em: TS, usuario_login: 'dono' });
        registrarEvento(estado, { tipo: 'EXCLUSAO', modo: null, operacao_id: doc.id, operacao_nova_id: null, numero_original: doc.numero, versao_anterior: snapshot.versao, versao_nova: doc.versao, motivo, snapshot_anterior: snapshot });
        return { status: 200, body: detalhe(doc, { replay: false }, estado) };
      });
      if (f?.gravarAntes) return f.resposta ?? { rede: true };
      return r;
    }
    if (!acao && method === 'PUT') {
      const f = falha(estado, 'editar');
      if (f) return f.resposta ?? { rede: true };
      if (doc.status !== 'RASCUNHO') return erro(409, 'OPERACAO_STATUS_INVALIDO');
      if (body.versao !== doc.versao) return erro(409, 'OPERACAO_VERSAO_CONFLITO');
      const { versao: _v, ...corpo } = body;
      const r = ouRecusa(() => montarDoc(estado, corpo, { id: doc.id, numero: doc.numero, versao: doc.versao + 1, created_date: doc.created_date, historico: doc.historico }));
      if (r.recusa) return r.recusa;
      Object.assign(doc, r.ok);
      return { status: 200, body: detalhe(doc, {}, estado) };
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
        rateio_escopo: doc.rateio_escopo ?? 'GERAL',
        itens: doc.itens.map(({ ordem, tipo_item, produto_id, local_estoque_id, unidade, quantidade, valor_unitario, valor_total, fator_kg, quantidade_estoque, valor_desconto_rateado, valor_acrescimo_rateado, valor_liquido, custo_kg, residuo_custo, rateios: linhas }) => ({
          ordem, tipo_item, produto_id, local_estoque_id, unidade, quantidade, valor_unitario, valor_total, fator_kg, quantidade_estoque,
          valor_desconto_rateado, valor_acrescimo_rateado, valor_liquido, custo_kg: custo_kg ?? null, residuo_custo: residuo_custo ?? null,
          rateios: (linhas ?? []).map((l) => ({ ...l })),
        })),
        rateios: doc.rateios.map(({ ordem, natureza_id, centro_custo_id, centro_resultado_id, valor, percentual }) => ({ ordem, natureza_id, centro_custo_id, centro_resultado_id, valor, percentual })),
        rateio_consolidado: (doc.rateio_consolidado ?? []).map((l) => ({ ...l })),
        parcelas: doc.titulos.map((t) => ({ numero_parcela: t.numero_parcela, total_parcelas: t.total_parcelas, vencimento: t.vencimento, valor: t.valor })),
        efeitos_estoque: { entradas: doc.direcao === 'PAGAR' ? mercadorias.map(entrada) : [], saidas: doc.direcao === 'RECEBER' ? mercadorias.map(saida) : [] },
        resumo: { parcelas_n: doc.titulos.length, itens_estoque_n: estoque, valor_titulos: doc.valor_total, moeda: doc.moeda },
        // Como `planejarOperacao` real (rodada 4), só informativos: rateio do cabeçalho
        // num COM_PRODUTOS com desconto ou acréscimo; resíduo de custo ≠ 0 em alguma linha.
        avisos: [
          ...(comRateio && (ehPositivo(doc.valor_desconto) || ehPositivo(doc.valor_acrescimo))
            ? [{
                codigo: 'desconto_acrescimo_rateados',
                mensagem: !mercadorias.length
                  ? 'desconto e acréscimo do cabeçalho foram rateados entre as linhas proporcionalmente ao subtotal (valor líquido por item); nenhum item deste lançamento movimenta estoque'
                  : doc.direcao === 'PAGAR'
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
        return { status: 200, body: detalhe(doc, { replay: false }, estado) };
      });
      // `gravarAntes` + `resposta`: gravou, mas o cliente recebe outra coisa (ex.: 504
      // da Vercel quando o prazo da função estoura depois do COMMIT).
      if (f?.gravarAntes) return f.resposta ?? { rede: true };
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
        return { status: 200, body: detalhe(doc, { replay: false }, estado) };
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
      return { status: 201, body: detalhe(doc, { replay: false }, estado) };
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
      return { status: 201, body: detalhe(doc, { replay: false }, estado) };
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
