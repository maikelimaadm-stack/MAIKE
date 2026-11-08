/**
 * D-PROD-154 — planejamento PURO do lançamento (sem banco).
 *
 *  - `normalizarDocumento(corpo, casas)`: validação ESTRUTURAL (400) do corpo já
 *    aceito pelo schema fechado: datas reais, escala da moeda, regras de
 *    conteúdo/itens/rateio/parcelas. Devolve o documento normalizado (Decimal).
 *  - `planejarOperacao(doc, referencias)`: a MESMA função usada por POST/PUT,
 *    prévia e confirmação (§4): totais, kg, custo por kg, rateio (VALOR ou
 *    PERCENTUAL com distribuição do resto), parcelas e efeitos de estoque.
 *    Falha matemática → 422 com `details.field/reason` (+ `colecao`/`indice`).
 *  - `simularEfeitosEstoque(plano, estado)`: bloqueios de ESTADO da prévia
 *    (FIFO em SEQUÊNCIA, `estoque_atual`, limites das colunas antigas).
 *
 * Rateio e parcelas são SEMPRE sobre `valor_total` (após desconto/acréscimo).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { consumirFifo } from '../estoqueFisico/estoqueFisicoMotor.js';
import {
  CASAS_CUSTO, CASAS_PERCENTUAL, CASAS_QUANTIDADE, CEM, LIMITE_DINHEIRO, LIMITE_ESTOQUE, UM, ZERO,
  arredondar, casasDecimais, dec, piso, somar, unidadeMinima,
} from './decimalFinanceiro.js';

export const DIRECOES = Object.freeze(['PAGAR', 'RECEBER']);
export const CONTEUDOS = Object.freeze(['COM_PRODUTOS', 'SEM_PRODUTOS']);
export const CONDICOES = Object.freeze(['AVISTA', 'PRAZO', 'PARCELADO']);
export const RATEIO_MODOS = Object.freeze(['VALOR', 'PERCENTUAL']);
export const TIPOS_ITEM = Object.freeze(['MERCADORIA', 'SERVICO']);
export const UNIDADES = Object.freeze(['KG', 'SACO', 'UN']);
export const MAX_ITENS = 200;
export const MAX_RATEIOS = 50;
export const MAX_PARCELAS = 120;
export const MIN_PARCELADO = 2;

/** Natureza exigida pela direção (PAGAR → DESPESA; RECEBER → RECEITA). */
export const tipoNaturezaDa = (direcao) => (direcao === 'PAGAR' ? 'DESPESA' : 'RECEITA');

const valoresInvalidos = (mensagem, details) => new AppError('OPERACAO_VALORES_INVALIDOS', mensagem, { details });
const rateioInvalido = (mensagem, details) => new AppError('OPERACAO_RATEIO_INVALIDO', mensagem, { details });
const parcelasInvalidas = (mensagem, details) => new AppError('OPERACAO_PARCELAS_INVALIDAS', mensagem, { details });

/** Dia `AAAA-MM-DD` de calendário real (2026-02-30 não existe). */
export const diaValido = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const exigirDia = (valor, field, extra = {}) => {
  if (!diaValido(valor)) throw invalido(`${field} não é um dia válido (AAAA-MM-DD)`, { field, reason: 'data_invalida', ...extra });
  return /** @type {string} */ (valor);
};

/** `textoDoCorpo` com `reason` e posição da linha nos erros. */
const textoLinha = (valor, field, opcoes = {}, extra = {}) => {
  try {
    const t = textoDoCorpo(valor, field, opcoes);
    if ((t === undefined || t === null) && opcoes.obrigatorio) throw invalido(`${field} é obrigatório`, { field, reason: 'obrigatorio' });
    return t === undefined ? null : t;
  } catch (erro) {
    const e = /** @type {any} */ (erro);
    if (e?.details) e.details = { reason: 'obrigatorio', ...e.details, ...extra };
    throw erro;
  }
};

/** Dinheiro do corpo na escala da moeda: mais casas que a moeda → 400 (não arredonda calado). */
const dinheiro = (valor, field, casas, extra = {}) => {
  if (valor === null || valor === undefined) return null;
  if (casasDecimais(valor) > casas) {
    throw invalido(`${field} tem mais casas decimais do que a moeda permite (${casas})`, { field, reason: 'casas_decimais_excedidas', casas, ...extra });
  }
  return dec(valor);
};

const presente = (v) => v !== null && v !== undefined;

/**
 * Validação ESTRUTURAL (400) e normalização do corpo DOC (§5) na escala `casas`.
 * @param {Record<string, any>} corpo
 * @param {number} casas
 */
export const normalizarDocumento = (corpo, casas) => {
  const itensCorpo = Array.isArray(corpo.itens) ? corpo.itens : [];
  const conteudo = corpo.conteudo;
  /** @type {any} */
  const doc = {
    empresa_id: corpo.empresa_id,
    direcao: corpo.direcao,
    conteudo,
    condicao: corpo.condicao,
    parceiro_id: corpo.parceiro_id,
    data_emissao: exigirDia(corpo.data_emissao, 'data_emissao'),
    descricao: textoLinha(corpo.descricao, 'descricao'),
    documento_referencia: textoLinha(corpo.documento_referencia, 'documento_referencia', { maiusculas: true }),
    metodo_preferido: presente(corpo.metodo_preferido) ? corpo.metodo_preferido : null,
    valor_desconto: dinheiro(corpo.valor_desconto, 'valor_desconto', casas) ?? ZERO,
    valor_acrescimo: dinheiro(corpo.valor_acrescimo, 'valor_acrescimo', casas) ?? ZERO,
    rateio_modo: corpo.rateio_modo,
  };
  // MAIÚSCULAS pode alongar o texto ("ß" → "SS"): confere de novo contra a coluna (64).
  if (doc.documento_referencia && [...doc.documento_referencia].length > 64) {
    throw invalido('documento_referencia passa de 64 caracteres', { field: 'documento_referencia', reason: 'tamanho_excedido' });
  }
  if (conteudo === 'SEM_PRODUTOS') {
    if (itensCorpo.length) throw invalido('lançamento SEM produtos não aceita itens', { field: 'itens', reason: 'itens_nao_permitidos' });
    if (!presente(corpo.valor_bruto)) throw invalido('valor_bruto é obrigatório no lançamento sem produtos', { field: 'valor_bruto', reason: 'obrigatorio' });
    doc.valor_bruto = dinheiro(corpo.valor_bruto, 'valor_bruto', casas);
  } else {
    if (!itensCorpo.length) throw invalido('lançamento COM produtos exige ao menos 1 item', { field: 'itens', reason: 'itens_obrigatorios' });
    if (presente(corpo.valor_bruto)) {
      throw invalido('valor_bruto só é informado sem produtos (com produtos ele é a soma dos itens)', { field: 'valor_bruto', reason: 'valor_bruto_so_sem_produtos' });
    }
    doc.valor_bruto = null;
  }
  doc.itens = itensCorpo.map((it, indice) => normalizarItem(it, indice));
  const temMercadoria = doc.itens.some((i) => i.tipo_item === 'MERCADORIA');
  if (temMercadoria) {
    if (!presente(corpo.data_operacional)) {
      throw invalido('data_operacional (dia do recebimento/entrega físico) é obrigatória com mercadoria', { field: 'data_operacional', reason: 'obrigatorio' });
    }
    doc.data_operacional = exigirDia(corpo.data_operacional, 'data_operacional');
    if (corpo.efeito_fisico_confirmado !== true) {
      throw invalido('declare que a mercadoria já foi recebida/entregue (efeito_fisico_confirmado: true)', { field: 'efeito_fisico_confirmado', reason: 'declaracao_obrigatoria' });
    }
  } else {
    if (presente(corpo.data_operacional)) {
      throw invalido('data_operacional só existe em lançamento com mercadoria', { field: 'data_operacional', reason: 'nao_permitido_sem_mercadoria' });
    }
    doc.data_operacional = null;
  }
  const rateiosCorpo = Array.isArray(corpo.rateios) ? corpo.rateios : [];
  doc.rateios = rateiosCorpo.map((r, indice) => {
    const extra = { colecao: 'rateios', indice };
    const linha = {
      ordem: indice + 1,
      natureza_id: r.natureza_id,
      centro_custo_id: presente(r.centro_custo_id) ? r.centro_custo_id : null,
      centro_resultado_id: presente(r.centro_resultado_id) ? r.centro_resultado_id : null,
      valor: null,
      percentual: null,
    };
    if (doc.rateio_modo === 'VALOR') {
      if (!presente(r.valor)) throw invalido('valor da linha de rateio é obrigatório no modo VALOR', { field: 'valor', reason: 'obrigatorio', ...extra });
      linha.valor = dinheiro(r.valor, 'valor', casas, extra);
    } else {
      if (!presente(r.percentual)) throw invalido('percentual da linha de rateio é obrigatório no modo PERCENTUAL', { field: 'percentual', reason: 'obrigatorio', ...extra });
      linha.percentual = dec(r.percentual);
    }
    return linha;
  });
  const parcelasCorpo = Array.isArray(corpo.parcelas) ? corpo.parcelas : [];
  doc.parcelas = parcelasCorpo.map((p, indice) => {
    const extra = { colecao: 'parcelas', indice };
    return { numero_parcela: indice + 1, vencimento: exigirDia(p.vencimento, 'vencimento', extra), valor: dinheiro(p.valor, 'valor', casas, extra) };
  });
  return doc;
};

const normalizarItem = (it, indice) => {
  const extra = { colecao: 'itens', indice };
  const base = {
    ordem: indice + 1,
    tipo_item: it.tipo_item,
    unidade: it.unidade,
    quantidade: dec(it.quantidade),
    valor_unitario: dec(it.valor_unitario),
  };
  if (it.tipo_item === 'MERCADORIA') {
    if (!presente(it.produto_id)) throw invalido('produto_id é obrigatório para mercadoria', { field: 'produto_id', reason: 'obrigatorio', ...extra });
    if (!presente(it.local_estoque_id)) throw invalido('local_estoque_id é obrigatório para mercadoria', { field: 'local_estoque_id', reason: 'obrigatorio', ...extra });
    if (it.unidade !== 'KG' && it.unidade !== 'SACO') throw invalido('mercadoria usa a unidade KG ou SACO', { field: 'unidade', reason: 'unidade_invalida', ...extra });
    return { ...base, produto_id: it.produto_id, local_estoque_id: it.local_estoque_id, descricao: textoLinha(it.descricao, 'descricao', {}, extra) };
  }
  if (presente(it.produto_id)) throw invalido('serviço não tem produto', { field: 'produto_id', reason: 'nao_permitido_em_servico', ...extra });
  if (presente(it.local_estoque_id)) throw invalido('serviço não tem local de estoque', { field: 'local_estoque_id', reason: 'nao_permitido_em_servico', ...extra });
  if (it.unidade !== 'UN') throw invalido('serviço usa a unidade UN', { field: 'unidade', reason: 'unidade_invalida', ...extra });
  return { ...base, produto_id: null, local_estoque_id: null, descricao: textoLinha(it.descricao, 'descricao', { obrigatorio: true }, extra) };
};

/**
 * Plano do lançamento (puro). `referencias.casas` é a escala da moeda DO
 * DOCUMENTO; `referencias.produtos` (Map id → produto) dá o `peso_por_saco_kg`.
 * @param {any} doc documento normalizado
 * @param {{ casas: number, moeda: string, produtos: Map<string, any> }} referencias
 */
export const planejarOperacao = (doc, referencias) => {
  const casas = referencias.casas;
  const itens = doc.itens.map((it, indice) => planejarItem(doc, it, indice, referencias, casas));
  const valorBruto = doc.conteudo === 'COM_PRODUTOS' ? somar(itens.map((i) => i.valor_total)) : dec(doc.valor_bruto);
  for (const [campo, v] of [['valor_bruto', valorBruto], ['valor_desconto', doc.valor_desconto], ['valor_acrescimo', doc.valor_acrescimo]]) {
    if (dec(v).gt(LIMITE_DINHEIRO)) throw valoresInvalidos(`${campo} acima do limite (99.999.999.999.999,9999)`, { field: campo, reason: 'valor_excede_limite' });
  }
  if (!valorBruto.gt(0)) throw valoresInvalidos('o valor bruto deve ser maior que zero', { field: 'valor_bruto', reason: 'total_nao_positivo' });
  const valorTotal = valorBruto.minus(doc.valor_desconto).plus(doc.valor_acrescimo);
  if (!valorTotal.gt(0)) throw valoresInvalidos('o total (bruto − desconto + acréscimo) deve ser maior que zero', { field: 'valor_total', reason: 'total_nao_positivo' });
  if (valorTotal.gt(LIMITE_DINHEIRO)) throw valoresInvalidos('o total está acima do limite (99.999.999.999.999,9999)', { field: 'valor_total', reason: 'valor_excede_limite' });
  const rateios = planejarRateio(doc, valorTotal, casas);
  const parcelas = planejarParcelas(doc, valorTotal, casas);
  /** @type {any[]} */
  const entradas = [];
  /** @type {any[]} */
  const saidas = [];
  for (const item of itens) {
    if (item.tipo_item !== 'MERCADORIA') continue;
    const efeito = { item_ordem: item.ordem, indice: item.ordem - 1, produto_id: item.produto_id, local_estoque_id: item.local_estoque_id, kg: item.quantidade_estoque, custo_kg: item.custo_kg };
    (doc.direcao === 'PAGAR' ? entradas : saidas).push(efeito);
  }
  const avisos = [];
  if (entradas.length && (doc.valor_desconto.gt(0) || doc.valor_acrescimo.gt(0))) {
    avisos.push({ codigo: 'custo_sem_desconto_acrescimo', mensagem: 'desconto e acréscimo do cabeçalho não entram no custo do estoque nesta fase (o custo do lote é o subtotal do item)' });
  }
  return {
    moeda: referencias.moeda,
    casas,
    valor_bruto: valorBruto,
    valor_desconto: doc.valor_desconto,
    valor_acrescimo: doc.valor_acrescimo,
    valor_total: valorTotal,
    itens,
    rateios,
    parcelas,
    efeitos_estoque: { entradas, saidas },
    resumo: { parcelas_n: parcelas.length, itens_estoque_n: entradas.length + saidas.length, valor_titulos: valorTotal, moeda: referencias.moeda },
    avisos,
  };
};

const planejarItem = (doc, it, indice, referencias, casas) => {
  const extra = { colecao: 'itens', indice };
  if (!it.quantidade.gt(0)) throw valoresInvalidos('a quantidade deve ser maior que zero', { field: 'quantidade', reason: 'quantidade_nao_positiva', ...extra });
  const valorTotal = arredondar(it.quantidade.times(it.valor_unitario), casas);
  if (valorTotal.gt(LIMITE_DINHEIRO)) throw valoresInvalidos('o subtotal do item está acima do limite', { field: 'valor_total', reason: 'valor_excede_limite', ...extra });
  if (!valorTotal.gt(0)) throw valoresInvalidos('o subtotal do item (quantidade × valor unitário) arredondado na moeda é zero', { field: 'valor_unitario', reason: 'item_valor_zero', ...extra });
  if (it.tipo_item !== 'MERCADORIA') return { ...it, valor_total: valorTotal, fator_kg: null, quantidade_estoque: null, custo_kg: null };
  const produto = referencias.produtos.get(it.produto_id);
  const fator = it.unidade === 'KG' ? UM : dec(produto?.peso_por_saco_kg ?? 0);
  // kg UMA vez, 4 casas: o mesmo valor no item, lote, movimento, estoque_atual, consumo e estorno.
  const kg = arredondar(it.quantidade.times(fator), CASAS_QUANTIDADE);
  if (!kg.gt(0)) throw valoresInvalidos('a quantidade em kg (arredondada a 4 casas) é zero', { field: 'quantidade', reason: 'quantidade_estoque_zero', ...extra });
  const custoKg = doc.direcao === 'PAGAR' ? arredondar(valorTotal.dividedBy(kg), CASAS_CUSTO) : null;
  const acima = [['valor_total', valorTotal], ['quantidade', kg], ['valor_unitario', custoKg]].find(([, v]) => v && dec(v).gt(LIMITE_ESTOQUE));
  if (acima) {
    throw valoresInvalidos('mercadoria acima do limite das colunas de estoque (9.999.999.999,9999 em kg, custo por kg e valor)', { field: acima[0], reason: 'valor_excede_limite_estoque', ...extra });
  }
  return { ...it, valor_total: valorTotal, fator_kg: fator, quantidade_estoque: kg, custo_kg: custoKg };
};

const planejarRateio = (doc, total, casas) => {
  const linhas = doc.rateios;
  /** @type {Map<string, number>} */
  const vistos = new Map();
  linhas.forEach((l, indice) => {
    const chave = `${l.natureza_id}|${l.centro_custo_id ?? ''}|${l.centro_resultado_id ?? ''}`;
    if (vistos.has(chave)) {
      throw rateioInvalido('linha de rateio repetida (mesma natureza e centros)', { field: 'natureza_id', reason: 'linha_duplicada', colecao: 'rateios', indice, repete_indice: vistos.get(chave) });
    }
    vistos.set(chave, indice);
  });
  if (doc.rateio_modo === 'VALOR') {
    linhas.forEach((l, indice) => {
      if (!l.valor.gt(0)) throw rateioInvalido('linha de rateio com valor zero', { field: 'valor', reason: 'valor_linha_zero', colecao: 'rateios', indice });
    });
    const soma = somar(linhas.map((l) => l.valor));
    if (!soma.eq(total)) {
      throw rateioInvalido('a soma do rateio difere do total do lançamento', {
        field: 'rateios', reason: 'soma_diferente', modo: 'VALOR', esperado: total.toFixed(casas), informado: soma.toFixed(casas), diferenca: total.minus(soma).toFixed(casas),
      });
    }
    // Modo VALOR: percentual NÃO é gravado (o informativo é calculado na leitura).
    return linhas.map((l) => ({ ...l, valor: l.valor, percentual: null }));
  }
  const somaP = somar(linhas.map((l) => l.percentual));
  if (!somaP.eq(CEM)) {
    throw rateioInvalido('os percentuais do rateio devem somar exatamente 100', {
      field: 'rateios', reason: 'soma_diferente', modo: 'PERCENTUAL', esperado: CEM.toFixed(CASAS_PERCENTUAL), informado: somaP.toFixed(CASAS_PERCENTUAL), diferenca: CEM.minus(somaP).toFixed(CASAS_PERCENTUAL),
    });
  }
  const u = unidadeMinima(casas);
  const exatos = linhas.map((l) => total.times(l.percentual).dividedBy(CEM));
  const valores = exatos.map((x) => piso(x, casas));
  const restos = exatos.map((x, i) => x.minus(valores[i]));
  const faltam = total.minus(somar(valores)).dividedBy(u).toNumber();
  // Resto em unidades mínimas, 1 a 1, para os MAIORES restos; empate → menor ordem.
  const ordem = linhas.map((_, i) => i).sort((a, b) => (restos[b].cmp(restos[a]) || a - b));
  for (let k = 0; k < faltam; k += 1) valores[ordem[k]] = valores[ordem[k]].plus(u);
  return linhas.map((l, indice) => {
    if (!valores[indice].gt(0)) {
      throw rateioInvalido('uma linha do rateio ficou com valor zero depois da distribuição; ajuste os percentuais', { field: 'percentual', reason: 'valor_linha_zero', colecao: 'rateios', indice });
    }
    return { ...l, valor: valores[indice], percentual: arredondar(l.percentual, CASAS_PERCENTUAL) };
  });
};

const planejarParcelas = (doc, total, casas) => {
  const parcelas = doc.parcelas;
  const n = parcelas.length;
  const quantidade = (esperado) =>
    parcelasInvalidas('quantidade de parcelas incompatível com a condição', { field: 'parcelas', reason: 'quantidade_invalida', condicao: doc.condicao, esperado, informado: n });
  if (doc.condicao === 'AVISTA' && n !== 1) throw quantidade('1');
  if (doc.condicao === 'PRAZO' && n !== 1) throw quantidade('1');
  if (doc.condicao === 'PARCELADO' && (n < MIN_PARCELADO || n > MAX_PARCELAS)) throw quantidade(`${MIN_PARCELADO}..${MAX_PARCELAS}`);
  parcelas.forEach((p, indice) => {
    const extra = { colecao: 'parcelas', indice };
    if (!p.valor.gt(0)) throw parcelasInvalidas('parcela com valor zero', { field: 'valor', reason: 'valor_invalido', ...extra });
    if (doc.condicao === 'AVISTA' && p.vencimento !== doc.data_emissao) {
      throw parcelasInvalidas('à vista: o vencimento é o próprio dia da emissão', { field: 'vencimento', reason: 'vencimento_invalido', ...extra });
    }
    if (p.vencimento < doc.data_emissao) throw parcelasInvalidas('vencimento anterior à emissão', { field: 'vencimento', reason: 'vencimento_invalido', ...extra });
    if (indice > 0 && p.vencimento < parcelas[indice - 1].vencimento) {
      throw parcelasInvalidas('vencimentos fora de ordem (devem ser não decrescentes)', { field: 'vencimento', reason: 'vencimento_invalido', ...extra });
    }
  });
  const soma = somar(parcelas.map((p) => p.valor));
  if (!soma.eq(total)) {
    throw parcelasInvalidas('a soma das parcelas difere do total do lançamento', {
      field: 'parcelas', reason: 'soma_diferente', esperado: total.toFixed(casas), informado: soma.toFixed(casas), diferenca: total.minus(soma).toFixed(casas),
    });
  }
  return parcelas.map((p) => ({ numero_parcela: p.numero_parcela, total_parcelas: n, vencimento: p.vencimento, valor: p.valor }));
};

/**
 * Bloqueios de ESTADO da prévia, simulando os efeitos EM SEQUÊNCIA (itens
 * repetidos do mesmo produto/local consomem o saldo que o anterior deixou).
 * @param {any} plano
 * @param {{ estoqueAtual: Map<string, any>, lotes: Map<string, any[]> }} estado
 *   `lotes` por chave `${produto_id}|${local_estoque_id}` (lotes elegíveis ao FIFO)
 */
export const simularEfeitosEstoque = (plano, estado) => {
  /** @type {any[]} */
  const bloqueios = [];
  const estoque = new Map([...estado.estoqueAtual].map(([k, v]) => [k, dec(v)]));
  const lotes = new Map([...estado.lotes].map(([k, ls]) => [k, ls.map((l) => ({ ...l, quantidade_disponivel: dec(l.quantidade_disponivel) }))]));
  const linha = (e) => ({ colecao: 'itens', indice: e.indice, item_ordem: e.item_ordem, produto_id: e.produto_id, local_estoque_id: e.local_estoque_id });
  const bloqueio = (code, field, reason, details) => bloqueios.push({ code, field, reason, details: { field, reason, ...details } });
  for (const e of plano.efeitos_estoque.entradas) {
    const atual = estoque.get(e.produto_id) ?? ZERO;
    if (atual.plus(e.kg).gt(LIMITE_ESTOQUE)) {
      bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque', { ...linha(e), estoque_atual: atual.toFixed(CASAS_QUANTIDADE) });
    }
    estoque.set(e.produto_id, atual.plus(e.kg));
  }
  const saidas = [];
  for (const s of plano.efeitos_estoque.saidas) {
    const chave = `${s.produto_id}|${s.local_estoque_id}`;
    const ls = lotes.get(chave) ?? [];
    const fifo = consumirFifo(ls, s.kg);
    if (!fifo.suficiente) {
      bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente', {
        ...linha(s), disponivel: fifo.disponivel.toFixed(CASAS_QUANTIDADE), solicitado: s.kg.toFixed(CASAS_QUANTIDADE),
      });
    } else {
      for (const f of fifo.fatias) {
        const l = ls.find((x) => x.id === f.lote_id);
        if (l) l.quantidade_disponivel = l.quantidade_disponivel.minus(f.quantidade);
      }
      if (fifo.valorTotal.gt(LIMITE_ESTOQUE)) bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque', linha(s));
    }
    const atual = estoque.get(s.produto_id) ?? ZERO;
    if (atual.lt(s.kg)) {
      bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'estoque_atual_insuficiente', { ...linha(s), estoque_atual: atual.toFixed(CASAS_QUANTIDADE), solicitado: s.kg.toFixed(CASAS_QUANTIDADE) });
    }
    estoque.set(s.produto_id, atual.minus(s.kg));
    saidas.push({ ...s, disponivel: fifo.disponivel, fatias: fifo.suficiente ? fifo.fatias : [], custo_total: fifo.suficiente ? fifo.valorTotal : null });
  }
  return { bloqueios, saidas };
};
