/**
 * D-PROD-155 — planejamento PURO do lançamento (sem banco).
 *
 *  - `normalizarDocumento(corpo, casas)`: validação ESTRUTURAL (400) do corpo já
 *    aceito pelo schema fechado: datas reais, escala da moeda, regras de
 *    conteúdo/itens/rateio/parcelas. Devolve o documento normalizado (Decimal).
 *  - `planejarOperacao(doc, referencias)`: a MESMA função usada por POST/PUT,
 *    prévia e confirmação (§4): totais, kg, rateio do desconto/acréscimo do
 *    cabeçalho por linha, valor líquido, custo por kg (+ resíduo), rateio
 *    gerencial (VALOR ou PERCENTUAL com distribuição do resto), parcelas e
 *    efeitos de estoque.
 *    Falha matemática → 422 com `details.field/reason` (+ `colecao`/`indice`).
 *  - `simularEfeitosEstoque(plano, estado)`: bloqueios de ESTADO da prévia
 *    (FIFO em SEQUÊNCIA, `estoque_atual`, limites das colunas antigas).
 *
 * Rateio e parcelas são SEMPRE sobre `valor_total` (após desconto/acréscimo).
 *
 * D-PROD-162: mercadoria aceita também `L` (litros), só para Produto com estoque
 * em L (regra de referência do serviço). Item `L` tem fator 1 (como o KG) e a
 * sua "quantidade em kg" (`quantidade_estoque`, `kg`, `custo_kg`) fica em
 * LITROS: os nomes das colunas antigas não mudam. Para KG, SACO e UN o plano é
 * byte a byte o de antes (teste `gestaoP3UnidadeLitros`).
 *
 * Escopo do rateio gerencial (D-PROD-156, P3-02), EXCLUSIVO por documento:
 *  - GERAL (padrão; NULL no banco = GERAL): `rateios` do documento, como na
 *    P3-01, sobre `valor_total`; nenhum item traz linhas;
 *  - POR_ITEM (só COM_PRODUTOS): cada item traz as SUAS linhas
 *    (`itens[i].rateios`) sobre o `valor_liquido` do item (o mesmo gravado),
 *    VALOR exato ou PERCENTUAL distribuído pelos MESMOS maiores restos do geral;
 *    `rateios` do documento vazio. Σ de todas as linhas = `valor_total`.
 *  Os dois modos devolvem `rateio_consolidado` (soma por natureza + centros).
 *
 * Custo de aquisição líquido (rodada 4): desconto D e acréscimo A do cabeçalho
 * de um COM_PRODUTOS são rateados SEPARADAMENTE entre TODAS as linhas
 * (mercadoria e serviço, nas duas direções), proporcionais ao subtotal, em
 * unidades mínimas da moeda, pelos maiores restos (empate → menor ordem):
 * Σ d = D e Σ a = A exatos, e Σ líquido = `valor_total`. Na compra de
 * mercadoria o custo por kg (4 casas, colunas antigas Decimal(14,4)) sai do
 * LÍQUIDO; o resíduo `líquido − kg × custo` fica fora do custo FIFO e é
 * mostrado; acima de max(1 unidade mínima, 0,001 × líquido) → 422
 * `custo_kg_nao_representavel`. Na venda o rateio é só informativo (o custo
 * da saída continua FIFO).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { consumirCustoMedio, consumirPorLote } from '../estoqueFisico/estoqueFisicoMotor.js';
import {
  CASAS_CUSTO, CASAS_PERCENTUAL, CASAS_QUANTIDADE, CASAS_RESIDUO, CEM, Dec, LIMITE_DINHEIRO, LIMITE_ESTOQUE, LIMITE_RESIDUO_RELATIVO, UM, ZERO,
  arredondar, casasDecimais, dec, somar, texto, unidadeMinima,
} from './decimalFinanceiro.js';

export const DIRECOES = Object.freeze(['PAGAR', 'RECEBER']);
export const CONTEUDOS = Object.freeze(['COM_PRODUTOS', 'SEM_PRODUTOS']);
export const CONDICOES = Object.freeze(['AVISTA', 'PRAZO', 'PARCELADO']);
export const RATEIO_MODOS = Object.freeze(['VALOR', 'PERCENTUAL']);
/** D-PROD-156: escopo do rateio gerencial (exclusivo). Sem `rateio_escopo` → GERAL. */
export const RATEIO_ESCOPOS = Object.freeze(['GERAL', 'POR_ITEM']);
export const ESCOPO_PADRAO = 'GERAL';
export const TIPOS_ITEM = Object.freeze(['MERCADORIA', 'SERVICO']);
/**
 * D-PROD-162: `L` (litros) só para Produto com estoque em L (regra de referência
 * do serviço); KG, SACO e UN como antes. Item `L` guarda `fator_kg = 1` e
 * `quantidade_estoque` em LITROS (as colunas antigas mantêm o nome).
 */
export const UNIDADES = Object.freeze(['KG', 'SACO', 'UN', 'L']);
/** Unidade de estoque do item (nas mensagens): `L` para item em litros; kg para KG e SACO. */
const unidadeDeEstoqueDoItem = (it) => (it?.unidade === 'L' ? 'L' : 'kg');
/**
 * D-PROD-177 (Estoque P1-02, contrato §5 C1): unidades de estoque do PRODUTO
 * que geram movimento físico. `UN` (só de serviço) e qualquer outro texto do
 * cadastro legado, não. Espelho de `UNIDADES_ESTOQUE` (produtos/produtoService.js).
 */
const UNIDADES_ESTOQUE_PRODUTO = Object.freeze(['KG', 'SACO', 'L']);
/** Unidades do PRODUTO compatíveis com cada unidade do item de mercadoria (sem conversão L ↔ KG). */
const PRODUTO_ACEITA_ITEM = Object.freeze({ KG: ['KG', 'SACO'], SACO: ['SACO'], L: ['L'] });
export const MAX_ITENS = 200;
export const MAX_RATEIOS = 50;
/** D-PROD-156: linhas do rateio por item (por item e no documento inteiro). */
export const MAX_RATEIOS_POR_ITEM = 20;
export const MAX_RATEIOS_ITENS_TOTAL = 1000;
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
    rateio_escopo: presente(corpo.rateio_escopo) ? corpo.rateio_escopo : ESCOPO_PADRAO,
  };
  exigirEscopoValido(doc.rateio_escopo);
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
  const linhasDosItens = itensCorpo.map((it) => (Array.isArray(it?.rateios) ? it.rateios : []));
  // D-PROD-156: escopo e exclusões ANTES dos valores das linhas (a recusa aponta o modo, não a linha).
  exigirEscopoDoRateio({ rateio_escopo: doc.rateio_escopo, conteudo, rateios: rateiosCorpo, itens: linhasDosItens.map((rateios) => ({ rateios })) });
  doc.rateios = normalizarLinhasDeRateio(rateiosCorpo, doc.rateio_modo, casas, (indice) => ({ colecao: 'rateios', indice }));
  doc.itens.forEach((item, indice) => {
    item.rateios = normalizarLinhasDeRateio(linhasDosItens[indice], doc.rateio_modo, casas, (subindice) => posicaoNoItem(indice, subindice));
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
    if (it.unidade !== 'KG' && it.unidade !== 'SACO' && it.unidade !== 'L') throw invalido('mercadoria usa a unidade KG, SACO ou L', { field: 'unidade', reason: 'unidade_invalida', ...extra });
    return { ...base, produto_id: it.produto_id, local_estoque_id: it.local_estoque_id, descricao: textoLinha(it.descricao, 'descricao', {}, extra) };
  }
  if (presente(it.produto_id)) throw invalido('serviço não tem produto', { field: 'produto_id', reason: 'nao_permitido_em_servico', ...extra });
  if (presente(it.local_estoque_id)) throw invalido('serviço não tem local de estoque', { field: 'local_estoque_id', reason: 'nao_permitido_em_servico', ...extra });
  if (it.unidade !== 'UN') throw invalido('serviço usa a unidade UN', { field: 'unidade', reason: 'unidade_invalida', ...extra });
  return { ...base, produto_id: null, local_estoque_id: null, descricao: textoLinha(it.descricao, 'descricao', { obrigatorio: true }, extra) };
};

/** Posição de uma linha do rateio POR ITEM nos erros (item e linha exatos). */
const posicaoNoItem = (indice, subindice) => ({ colecao: 'itens', indice, subcolecao: 'rateios', ...(subindice === undefined ? {} : { subindice }) });

/**
 * Linhas de rateio do corpo (geral ou de um item) em Decimal, na escala da
 * moeda. VALOR exige `valor`; PERCENTUAL exige `percentual`; o outro campo é
 * ignorado (como na P3-01). `posicao(i)` dá o `details` da linha `i`.
 * @param {any[]} linhas @param {string} modo @param {number} casas @param {(i: number) => Record<string, unknown>} posicao
 */
const normalizarLinhasDeRateio = (linhas, modo, casas, posicao) =>
  linhas.map((r, i) => {
    const extra = posicao(i);
    const linha = {
      ordem: i + 1,
      natureza_id: r.natureza_id,
      centro_custo_id: presente(r.centro_custo_id) ? r.centro_custo_id : null,
      centro_resultado_id: presente(r.centro_resultado_id) ? r.centro_resultado_id : null,
      valor: null,
      percentual: null,
    };
    if (modo === 'VALOR') {
      if (!presente(r.valor)) throw invalido('valor da linha de rateio é obrigatório no modo VALOR', { field: 'valor', reason: 'obrigatorio', ...extra });
      linha.valor = dinheiro(r.valor, 'valor', casas, extra);
    } else {
      if (!presente(r.percentual)) throw invalido('percentual da linha de rateio é obrigatório no modo PERCENTUAL', { field: 'percentual', reason: 'obrigatorio', ...extra });
      linha.percentual = dec(r.percentual);
    }
    return linha;
  });

/** `rateio_escopo` fora do domínio → 422 `escopo_invalido` (o schema da rota só tipa como texto). */
const exigirEscopoValido = (escopo) => {
  if (!RATEIO_ESCOPOS.includes(escopo)) {
    throw rateioInvalido('escopo do rateio inválido (use GERAL ou POR_ITEM)', { field: 'rateio_escopo', reason: 'escopo_invalido', permitidos: [...RATEIO_ESCOPOS] });
  }
};

/**
 * D-PROD-156 — escopo do rateio e exclusões (§3), pela PRESENÇA das linhas. A
 * MESMA regra no corpo (normalização) e no documento lido do banco
 * (planejamento: prévia e confirmação), para que um documento gravado fora da
 * API nunca confirme com rateio faltante, geral + por item, ou acima do teto.
 * @param {{ rateio_escopo: unknown, conteudo: string, rateios: any[], itens: Array<{ rateios: any[] }> }} doc
 */
export const exigirEscopoDoRateio = (doc) => {
  exigirEscopoValido(doc.rateio_escopo);
  if (doc.rateio_escopo === 'POR_ITEM' && doc.conteudo !== 'COM_PRODUTOS') {
    throw rateioInvalido('o rateio por item só existe em lançamento COM produtos', { field: 'rateio_escopo', reason: 'escopo_por_item_exige_produtos' });
  }
  const itemComLinhas = doc.itens.findIndex((i) => i.rateios.length > 0);
  const juntos = (details) =>
    rateioInvalido('rateio geral e rateio por item são exclusivos: use só um deles no documento', { field: 'rateios', reason: 'rateio_geral_e_por_item', escopo: doc.rateio_escopo, ...details });
  if (doc.rateio_escopo === 'GERAL') {
    // Linha em item no escopo GERAL é o modo por item misturado ao geral (com ou sem linhas no topo).
    if (itemComLinhas >= 0) throw juntos(posicaoNoItem(itemComLinhas));
    if (!doc.rateios.length) throw rateioInvalido('o rateio geral exige ao menos 1 linha', { field: 'rateios', reason: 'rateio_geral_obrigatorio' });
    return;
  }
  if (doc.rateios.length) throw juntos({ colecao: 'rateios', indice: 0 });
  let total = 0;
  doc.itens.forEach((item, indice) => {
    const n = item.rateios.length;
    if (!n) throw rateioInvalido('no rateio por item, cada item precisa de ao menos 1 linha', { field: 'rateios', reason: 'item_sem_rateio', ...posicaoNoItem(indice) });
    if (n > MAX_RATEIOS_POR_ITEM) {
      throw rateioInvalido(`o item passa de ${MAX_RATEIOS_POR_ITEM} linhas de rateio`, {
        field: 'rateios', reason: 'rateio_item_excede_limite', ...posicaoNoItem(indice), limite: MAX_RATEIOS_POR_ITEM, informado: n,
      });
    }
    total += n;
    if (total > MAX_RATEIOS_ITENS_TOTAL) {
      throw rateioInvalido(`o documento passa de ${MAX_RATEIOS_ITENS_TOTAL} linhas de rateio por item`, {
        field: 'rateios', reason: 'rateio_itens_excede_limite', ...posicaoNoItem(indice), limite: MAX_RATEIOS_ITENS_TOTAL,
        informado: doc.itens.reduce((t, i) => t + i.rateios.length, 0),
      });
    }
  });
};

/**
 * Plano do lançamento (puro). `referencias.casas` é a escala da moeda DO
 * DOCUMENTO; `referencias.produtos` (Map id → produto) dá o `peso_por_saco_kg`.
 * @param {any} doc documento normalizado
 * @param {{ casas: number, moeda: string, produtos: Map<string, any> }} referencias
 */
export const planejarOperacao = (doc, referencias) => {
  const casas = referencias.casas;
  const brutos = doc.itens.map((it, indice) => planejarItem(it, indice, referencias, casas));
  const valorBruto = doc.conteudo === 'COM_PRODUTOS' ? somar(brutos.map((i) => i.valor_total)) : dec(doc.valor_bruto);
  // D-PROD-177 (P1-02, M4): desconto e acréscimo negativos nunca entram no rateio
  // nem no custo (o schema da rota já os recusa; o documento lido do banco, não).
  // Zero continua permitido.
  for (const [campo, v] of [['valor_desconto', doc.valor_desconto], ['valor_acrescimo', doc.valor_acrescimo]]) {
    if (dec(v).lt(0)) throw valoresInvalidos(`${campo} não pode ser negativo; nada foi gravado`, { field: campo, reason: 'valor_negativo' });
  }
  for (const [campo, v] of [['valor_bruto', valorBruto], ['valor_desconto', doc.valor_desconto], ['valor_acrescimo', doc.valor_acrescimo]]) {
    if (dec(v).gt(LIMITE_DINHEIRO)) throw valoresInvalidos(`${campo} acima do limite (99.999.999.999.999,9999)`, { field: campo, reason: 'valor_excede_limite' });
  }
  if (!valorBruto.gt(0)) throw valoresInvalidos('o valor bruto deve ser maior que zero', { field: 'valor_bruto', reason: 'total_nao_positivo' });
  const valorTotal = valorBruto.minus(doc.valor_desconto).plus(doc.valor_acrescimo);
  if (!valorTotal.gt(0)) throw valoresInvalidos('o total (bruto − desconto + acréscimo) deve ser maior que zero', { field: 'valor_total', reason: 'total_nao_positivo' });
  if (valorTotal.gt(LIMITE_DINHEIRO)) throw valoresInvalidos('o total está acima do limite (99.999.999.999.999,9999)', { field: 'valor_total', reason: 'valor_excede_limite' });
  exigirEscopoDoRateio(doc);
  const liquidos = planejarCustoLiquido(doc, brutos, casas);
  const porItem = doc.rateio_escopo === 'POR_ITEM';
  // GERAL: o rateio do documento, intacto (P3-01); POR_ITEM: depois do líquido (é a base de cada item).
  const rateios = porItem ? [] : planejarRateio(doc, valorTotal, casas);
  const itens = porItem ? planejarRateioPorItem(doc, liquidos, casas) : liquidos.map((i) => ({ ...i, rateios: [] }));
  if (porItem) {
    const soma = somar(itens.flatMap((i) => i.rateios.map((r) => r.valor)));
    if (!soma.eq(valorTotal)) throw new TypeError(`rateio por item: Σ das linhas ${soma.toFixed(casas)} ≠ total ${valorTotal.toFixed(casas)}`);
  }
  const parcelas = planejarParcelas(doc, valorTotal, casas);
  /** @type {any[]} */
  const entradas = [];
  /** @type {any[]} */
  const saidas = [];
  for (const item of itens) {
    if (item.tipo_item !== 'MERCADORIA') continue;
    const efeito = {
      item_ordem: item.ordem, indice: item.ordem - 1, produto_id: item.produto_id, local_estoque_id: item.local_estoque_id, kg: item.quantidade_estoque,
      custo_kg: item.custo_kg, valor_liquido: item.valor_liquido,
    };
    (doc.direcao === 'PAGAR' ? entradas : saidas).push(efeito);
  }
  const avisos = [];
  if (doc.conteudo === 'COM_PRODUTOS' && (doc.valor_desconto.gt(0) || doc.valor_acrescimo.gt(0))) {
    avisos.push({
      codigo: 'desconto_acrescimo_rateados',
      mensagem: !entradas.length && !saidas.length
        ? 'desconto e acréscimo do cabeçalho foram rateados entre as linhas proporcionalmente ao subtotal (valor líquido por item); nenhum item deste lançamento movimenta estoque'
        : doc.direcao === 'PAGAR'
        ? 'desconto e acréscimo do cabeçalho foram rateados entre as linhas proporcionalmente ao subtotal; o custo do lote é o valor líquido da mercadoria'
        : 'desconto e acréscimo do cabeçalho foram rateados entre as linhas proporcionalmente ao subtotal (receita líquida por item); a saída do estoque continua com o custo FIFO dos lotes',
    });
  }
  const comCusto = itens.filter((i) => i.residuo_custo !== null);
  if (comCusto.some((i) => !i.residuo_custo.isZero())) {
    const total = texto(somar(comCusto.map((i) => i.residuo_custo)), CASAS_RESIDUO);
    avisos.push({
      codigo: 'residuo_custo_estoque',
      // D-PROD-162: com item em L o texto não fala em kg; sem item em L, o de antes.
      mensagem: comCusto.some((i) => i.unidade === 'L')
        ? `o custo unitário do lote tem 4 casas; a diferença de arredondamento entre o valor líquido e quantidade × custo unitário (resíduo total ${total}) não entra no custo FIFO do estoque`
        : `o custo por kg do lote tem 4 casas; a diferença de arredondamento entre o valor líquido e kg × custo (resíduo total ${total}) não entra no custo FIFO do estoque`,
      residuo_total: total,
    });
  }
  return {
    moeda: referencias.moeda,
    casas,
    valor_bruto: valorBruto,
    valor_desconto: doc.valor_desconto,
    valor_acrescimo: doc.valor_acrescimo,
    valor_total: valorTotal,
    rateio_escopo: doc.rateio_escopo,
    itens,
    rateios,
    rateio_consolidado: porItem
      ? consolidarRateio(itens.flatMap((i) => i.rateios), valorTotal)
      : rateios.map((r) => ({ ...chaveDaLinha(r), valor: r.valor, percentual: r.percentual ?? percentualDe(r.valor, valorTotal), linha: r })),
    parcelas,
    efeitos_estoque: { entradas, saidas },
    resumo: { parcelas_n: parcelas.length, itens_estoque_n: entradas.length + saidas.length, valor_titulos: valorTotal, moeda: referencias.moeda },
    avisos,
  };
};

/** Subtotal, fator e kg de uma linha (o custo por kg sai do líquido: `planejarCustoLiquido`). */
const planejarItem = (it, indice, referencias, casas) => {
  const extra = { colecao: 'itens', indice };
  if (!it.quantidade.gt(0)) throw valoresInvalidos('a quantidade deve ser maior que zero', { field: 'quantidade', reason: 'quantidade_nao_positiva', ...extra });
  // D-PROD-177 (P1-02, M4): valor unitário negativo é recusado pelo nome (antes
  // caía em `item_valor_zero`, com texto de "zero"). Zero segue em `item_valor_zero`.
  if (dec(it.valor_unitario).lt(0)) throw valoresInvalidos('o valor unitário não pode ser negativo; nada foi gravado', { field: 'valor_unitario', reason: 'valor_negativo', ...extra });
  const valorTotal = arredondar(it.quantidade.times(it.valor_unitario), casas);
  if (valorTotal.gt(LIMITE_DINHEIRO)) throw valoresInvalidos('o subtotal do item está acima do limite', { field: 'valor_total', reason: 'valor_excede_limite', ...extra });
  if (!valorTotal.gt(0)) throw valoresInvalidos('o subtotal do item (quantidade × valor unitário) arredondado na moeda é zero', { field: 'valor_unitario', reason: 'item_valor_zero', ...extra });
  if (it.tipo_item !== 'MERCADORIA') return { ...it, valor_total: valorTotal, fator_kg: null, quantidade_estoque: null };
  const produto = referencias.produtos.get(it.produto_id);
  if (produto) exigirUnidadeCompativel(it, produto, extra);
  // D-PROD-162: item em L (só de Produto em L) tem fator 1, como o KG; a quantidade em estoque fica em litros.
  const fator = it.unidade === 'KG' || it.unidade === 'L' ? UM : dec(produto?.peso_por_saco_kg ?? 0);
  // kg UMA vez, 4 casas: o mesmo valor no item, lote, movimento, estoque_atual, consumo e estorno.
  const kg = arredondar(it.quantidade.times(fator), CASAS_QUANTIDADE);
  if (!kg.gt(0)) throw valoresInvalidos(`a quantidade em ${unidadeDeEstoqueDoItem(it)} (arredondada a 4 casas) é zero`, { field: 'quantidade', reason: 'quantidade_estoque_zero', ...extra });
  const acima = [['valor_total', valorTotal], ['quantidade', kg]].find(([, v]) => dec(v).gt(LIMITE_ESTOQUE));
  if (acima) throw excedeLimiteEstoque(acima[0], extra, it);
  return { ...it, valor_total: valorTotal, fator_kg: fator, quantidade_estoque: kg };
};

/**
 * D-PROD-177 (P1-02, contrato §5 C1), no planejamento — onde o Produto é
 * conhecido —, ANTES do fator e de qualquer escrita:
 *  - o Produto tem `unidade_principal_estoque` ∈ {KG, SACO, L}; o legado (UN,
 *    minúsculas, outro texto) não gera movimento físico → `unidade_produto_invalida`;
 *  - item KG → Produto KG ou SACO; item SACO → Produto SACO; item L ⇔ Produto L
 *    → senão `unidade_incompativel`. Nada de conversão L ↔ KG.
 * O peso do SACO (> 0) continua conferido como antes: sem peso o fator é 0 e a
 * quantidade em kg zera (`quantidade_estoque_zero`; o plano KG/SACO fica byte a
 * byte o de antes). O serviço já recusa antes, nas referências, o SACO sem
 * Produto SACO com peso e o L × não-L (`OPERACAO_REFERENCIA_INVALIDA`/
 * `unidade_invalida`); aqui é a garantia do próprio plano. Produto ausente do
 * mapa é recusa de referência do serviço, não daqui.
 * @param {any} it @param {any} produto @param {Record<string, unknown>} extra
 */
const exigirUnidadeCompativel = (it, produto, extra) => {
  const unidadeProduto = produto.unidade_principal_estoque ?? null;
  if (!UNIDADES_ESTOQUE_PRODUTO.includes(unidadeProduto)) {
    throw valoresInvalidos('o produto tem unidade de estoque fora de KG, SACO ou L (cadastro legado) e não movimenta estoque; procure o administrador antes de lançar este produto; nada foi gravado', {
      field: 'unidade', reason: 'unidade_produto_invalida', ...extra, unidade_produto: unidadeProduto, permitidos: [...UNIDADES_ESTOQUE_PRODUTO],
    });
  }
  const aceitas = PRODUTO_ACEITA_ITEM[/** @type {'KG'|'SACO'|'L'} */ (it.unidade)] ?? [];
  if (!aceitas.includes(unidadeProduto)) {
    throw valoresInvalidos('unidade do item incompatível com a do produto (KG: produto em KG ou SACO; SACO: produto em SACO; L: só produto em L); nada foi gravado', {
      field: 'unidade', reason: 'unidade_incompativel', ...extra, unidade: it.unidade, unidade_produto: unidadeProduto,
    });
  }
};

const excedeLimiteEstoque = (field, extra, it) => {
  const u = unidadeDeEstoqueDoItem(it);
  return valoresInvalidos(`mercadoria acima do limite das colunas de estoque (9.999.999.999,9999 em ${u}, custo por ${u} e valor)`, { field, reason: 'valor_excede_limite_estoque', ...extra });
};

/** Valor na escala da moeda → inteiro de unidades mínimas (exige estar na escala). */
const unidadesDe = (x, casas) => {
  const u = dec(x).times(new Dec(10).pow(casas));
  if (!u.isInteger()) throw new TypeError(`rateio do cabeçalho: ${dec(x).toString()} fora da escala da moeda (${casas} casas)`);
  return BigInt(u.toFixed(0));
};

/** Inteiro de unidades mínimas → valor na escala `casas`. */
const deUnidades = (n, casas) => new Dec(n.toString()).dividedBy(new Dec(10).pow(casas));

/**
 * MAIORES RESTOS em aritmética inteira (BigInt), o ÚNICO algoritmo de
 * distribuição do módulo (desconto/acréscimo do cabeçalho, rateio PERCENTUAL
 * geral e por item): cada parte recebe o piso de `alvo × p / Σp` e a sobra vai
 * 1 unidade por vez às partes de MAIOR resto; empate de resto → menor índice
 * (ordem). Σ do resultado = `alvo`, exato. Sem `Number`.
 * @param {bigint} alvo  em unidades mínimas
 * @param {bigint[]} pesos  não negativos
 * @returns {bigint[]}
 */
export const maioresRestos = (alvo, pesos) => {
  const base = pesos.reduce((t, p) => t + p, 0n);
  if (alvo === 0n || base <= 0n) return pesos.map(() => 0n);
  const partes = pesos.map((p) => (alvo * p) / base);
  const restos = pesos.map((p) => (alvo * p) % base);
  let faltam = alvo - partes.reduce((t, p) => t + p, 0n);
  const ordem = pesos.map((_, i) => i).sort((a, b) => (restos[b] > restos[a] ? 1 : restos[b] < restos[a] ? -1 : a - b));
  for (let k = 0; faltam > 0n; k += 1, faltam -= 1n) partes[ordem[k]] += 1n;
  return partes;
};

/**
 * Rateia `valor` (desconto OU acréscimo do cabeçalho) entre as linhas,
 * proporcional ao subtotal, em unidades mínimas da moeda pelos MAIORES
 * RESTOS; empate de resto → menor ordem (índice). Aritmética inteira (BigInt):
 * Σ do resultado = `valor`, exato.
 * @param {any} valor  na escala `casas`
 * @param {any[]} subtotais  subtotais das linhas (na escala `casas`, todos > 0)
 * @param {number} casas
 */
export const ratearCabecalho = (valor, subtotais, casas) =>
  maioresRestos(unidadesDe(valor, casas), subtotais.map((x) => unidadesDe(x, casas))).map((n) => deUnidades(n, casas));

/**
 * Distribui `total` (escala `casas`) pelos percentuais (Σ = 100, conferida
 * antes) pelos maiores restos: `total × p / 100` em unidades mínimas. O peso
 * de cada linha é o percentual escrito como inteiro (todas na mesma escala, a
 * maior das linhas), o que dá exatamente o piso e a ordem dos restos de
 * `total × p / 100` — o mesmo resultado da distribuição da P3-01.
 * @param {any} total @param {any[]} percentuais @param {number} casas
 */
export const distribuirPercentuais = (total, percentuais, casas) => {
  const escala = Math.max(0, ...percentuais.map((p) => dec(p).decimalPlaces()));
  const fator = new Dec(10).pow(escala);
  const pesos = percentuais.map((p) => BigInt(dec(p).times(fator).toFixed(0)));
  return maioresRestos(unidadesDe(total, casas), pesos).map((n) => deUnidades(n, casas));
};

/**
 * Desconto/acréscimo do cabeçalho por linha, valor líquido e, na COMPRA de
 * mercadoria, custo por kg do líquido + resíduo (representabilidade).
 * SEM_PRODUTOS não tem linhas: nada a fazer.
 */
const planejarCustoLiquido = (doc, itens, casas) => {
  if (!itens.length) return [];
  const subtotais = itens.map((i) => i.valor_total);
  const descontos = ratearCabecalho(doc.valor_desconto, subtotais, casas);
  const acrescimos = ratearCabecalho(doc.valor_acrescimo, subtotais, casas);
  const u = unidadeMinima(casas);
  return itens.map((it, indice) => {
    const extra = { colecao: 'itens', indice, item_ordem: it.ordem };
    const d = descontos[indice];
    const a = acrescimos[indice];
    const liquido = it.valor_total.minus(d).plus(a);
    if (!liquido.gt(0)) {
      throw valoresInvalidos('o desconto rateado zera (ou passa) o valor desta linha; reduza o desconto ou ajuste os itens', {
        field: 'valor_desconto', reason: 'item_liquido_nao_positivo', ...extra,
        valor_total: texto(it.valor_total, casas), valor_desconto_rateado: texto(d, casas), valor_acrescimo_rateado: texto(a, casas), valor_liquido: texto(liquido, casas),
      });
    }
    const linha = { ...it, valor_desconto_rateado: d, valor_acrescimo_rateado: a, valor_liquido: liquido, custo_kg: null, residuo_custo: null };
    if (doc.direcao !== 'PAGAR' || it.tipo_item !== 'MERCADORIA') return linha;
    const kg = it.quantidade_estoque;
    const custoKg = arredondar(liquido.dividedBy(kg), CASAS_CUSTO);
    // D-PROD-177 (P1-02, M4): o custo por unidade do lote nunca é negativo (as
    // tabelas de consumo têm CHECK custo_unitario >= 0 e o banco não confere a
    // camada). Líquido > 0 e kg > 0 já o garantem; a recusa é explícita.
    if (custoKg.lt(0)) {
      throw valoresInvalidos(`o custo por ${unidadeDeEstoqueDoItem(it)} desta linha, depois do rateio do desconto e do acréscimo, é negativo; nada foi gravado`, {
        field: 'valor_unitario', reason: 'custo_negativo', ...extra, valor_liquido: texto(liquido, casas), quantidade_estoque: texto(kg, CASAS_QUANTIDADE), custo_kg: texto(custoKg, CASAS_CUSTO),
      });
    }
    const acima = [['valor_total', liquido], ['valor_unitario', custoKg]].find(([, v]) => v.gt(LIMITE_ESTOQUE));
    if (acima) throw excedeLimiteEstoque(acima[0], { colecao: 'itens', indice }, it);
    const bruto = liquido.minus(kg.times(custoKg));
    const residuo = bruto.isZero() ? ZERO : bruto;
    if (residuo.abs().gt(Dec.max(u, liquido.times(LIMITE_RESIDUO_RELATIVO)))) {
      throw valoresInvalidos(`o custo por ${unidadeDeEstoqueDoItem(it)} com 4 casas não representa o valor líquido desta linha (o resíduo passa de 0,1% do líquido da linha, mínimo 1 unidade da moeda); revise quantidade, unidade ou valores`, {
        field: 'valor_unitario', reason: 'custo_kg_nao_representavel', ...extra,
        valor_liquido: texto(liquido, casas), quantidade_estoque: texto(kg, CASAS_QUANTIDADE), custo_kg: texto(custoKg, CASAS_CUSTO), residuo_custo: texto(residuo, CASAS_RESIDUO),
      });
    }
    return { ...linha, custo_kg: custoKg, residuo_custo: residuo };
  });
};

const planejarRateio = (doc, total, casas) => {
  const linhas = doc.rateios;
  /** @type {Map<string, number>} */
  const vistos = new Map();
  linhas.forEach((l, indice) => {
    const chave = textoDaChave(l);
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
  // Resto em unidades mínimas, 1 a 1, para os MAIORES restos; empate → menor ordem.
  const valores = distribuirPercentuais(total, linhas.map((l) => l.percentual), casas);
  return linhas.map((l, indice) => {
    if (!valores[indice].gt(0)) {
      throw rateioInvalido('uma linha do rateio ficou com valor zero depois da distribuição; ajuste os percentuais', { field: 'percentual', reason: 'valor_linha_zero', colecao: 'rateios', indice });
    }
    return { ...l, valor: valores[indice], percentual: arredondar(l.percentual, CASAS_PERCENTUAL) };
  });
};

/** Chave da linha de rateio: natureza + centro de custo + centro de resultado. */
const chaveDaLinha = (l) => ({ natureza_id: l.natureza_id, centro_custo_id: l.centro_custo_id ?? null, centro_resultado_id: l.centro_resultado_id ?? null });
const textoDaChave = (l) => `${l.natureza_id}|${l.centro_custo_id ?? ''}|${l.centro_resultado_id ?? ''}`;

/** Percentual informativo de `valor` sobre `base` (6 casas, ROUND_HALF_UP); base ≤ 0 → 0. */
export const percentualDe = (valor, base) => (dec(base).gt(0) ? arredondar(dec(valor).times(CEM).dividedBy(dec(base)), CASAS_PERCENTUAL) : ZERO);

/**
 * D-PROD-156 — rateio POR ITEM, depois de `planejarCustoLiquido`: a base de
 * cada item é o `valor_liquido` dele (o MESMO valor gravado). VALOR: cada linha
 * > 0 e Σ = líquido do item, exato. PERCENTUAL: Σ = 100 por item e o líquido é
 * distribuído pelos maiores restos (`distribuirPercentuais`, o mesmo do geral).
 * Linha repetida (mesma natureza e centros) só conta DENTRO do mesmo item.
 * Erros apontam `{colecao:'itens', indice, subcolecao:'rateios', subindice}`.
 * @param {any} doc @param {any[]} itens  itens com `valor_liquido` @param {number} casas
 */
export const planejarRateioPorItem = (doc, itens, casas) =>
  itens.map((item, indice) => {
    const linhas = item.rateios;
    const liquido = item.valor_liquido;
    const noItem = (subindice) => ({ ...posicaoNoItem(indice, subindice), item_ordem: item.ordem });
    if (!linhas.length) throw rateioInvalido('no rateio por item, cada item precisa de ao menos 1 linha', { field: 'rateios', reason: 'item_sem_rateio', ...noItem() });
    /** @type {Map<string, number>} */
    const vistos = new Map();
    linhas.forEach((l, subindice) => {
      const chave = textoDaChave(l);
      if (vistos.has(chave)) {
        throw rateioInvalido('linha de rateio repetida no mesmo item (mesma natureza e centros)', {
          field: 'natureza_id', reason: 'linha_duplicada', ...noItem(subindice), repete_subindice: vistos.get(chave),
        });
      }
      vistos.set(chave, subindice);
    });
    if (doc.rateio_modo === 'VALOR') {
      linhas.forEach((l, subindice) => {
        if (!l.valor.gt(0)) throw rateioInvalido('linha de rateio do item com valor zero', { field: 'valor', reason: 'valor_linha_zero', ...noItem(subindice) });
      });
      const soma = somar(linhas.map((l) => l.valor));
      if (!soma.eq(liquido)) {
        throw rateioInvalido('a soma do rateio do item difere do valor líquido do item', {
          field: 'rateios', reason: 'soma_diferente', modo: 'VALOR', ...noItem(),
          esperado: liquido.toFixed(casas), informado: soma.toFixed(casas), diferenca: liquido.minus(soma).toFixed(casas), valor_liquido: liquido.toFixed(casas),
        });
      }
      // Modo VALOR: percentual NÃO é gravado (o informativo é calculado na leitura, sobre o líquido do item).
      return { ...item, rateios: linhas.map((l) => ({ ...l, valor: l.valor, percentual: null })) };
    }
    const somaP = somar(linhas.map((l) => l.percentual));
    if (!somaP.eq(CEM)) {
      throw rateioInvalido('os percentuais do rateio do item devem somar exatamente 100', {
        field: 'rateios', reason: 'soma_diferente', modo: 'PERCENTUAL', ...noItem(),
        esperado: CEM.toFixed(CASAS_PERCENTUAL), informado: somaP.toFixed(CASAS_PERCENTUAL), diferenca: CEM.minus(somaP).toFixed(CASAS_PERCENTUAL), valor_liquido: liquido.toFixed(casas),
      });
    }
    const valores = distribuirPercentuais(liquido, linhas.map((l) => l.percentual), casas);
    return {
      ...item,
      rateios: linhas.map((l, subindice) => {
        if (!valores[subindice].gt(0)) {
          throw rateioInvalido('uma linha do rateio do item ficou com valor zero depois da distribuição; ajuste os percentuais', {
            field: 'percentual', reason: 'valor_linha_zero', ...noItem(subindice),
          });
        }
        return { ...l, valor: valores[subindice], percentual: arredondar(l.percentual, CASAS_PERCENTUAL) };
      }),
    };
  });

/**
 * Resumo CONSOLIDADO do rateio: soma por (natureza, centro de custo, centro de
 * resultado), na ordem da PRIMEIRA aparição; Σ valor = Σ das linhas (= total
 * no documento); percentual sobre `total` (6 casas, informativo). `linha` é a
 * primeira linha do grupo (os nomes/snapshots saem dela).
 * @template {{ natureza_id: string, centro_custo_id?: string|null, centro_resultado_id?: string|null, valor: any }} L
 * @param {L[]} linhas @param {any} total
 * @returns {Array<{ natureza_id: string, centro_custo_id: string|null, centro_resultado_id: string|null, valor: any, percentual: any, linha: L }>}
 */
export const consolidarRateio = (linhas, total) => {
  /** @type {Map<string, { natureza_id: string, centro_custo_id: string|null, centro_resultado_id: string|null, valor: any, linha: L }>} */
  const grupos = new Map();
  for (const l of linhas) {
    const chave = textoDaChave(l);
    const g = grupos.get(chave);
    if (g) g.valor = g.valor.plus(dec(l.valor));
    else grupos.set(chave, { ...chaveDaLinha(l), valor: dec(l.valor), linha: l });
  }
  return [...grupos.values()].map((g) => ({ ...g, percentual: percentualDe(g.valor, total) }));
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
 * @param {{ estoqueAtual: Map<string, any>, lotes: Map<string, any[]>, comLote?: Set<string> }} estado `comLote` (D-PROD-281): produtos que controlam lote (saem pelo custo da camada, FEFO)
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
    // D-PROD-281: produto com lote sai pelo custo da camada (FEFO), sem reavaliar (como o motor).
    const fifo = estado.comLote?.has(s.produto_id) ? consumirPorLote(ls, s.kg) : consumirCustoMedio(ls, s.kg);
    if (!fifo.suficiente) {
      bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente', {
        ...linha(s), disponivel: fifo.disponivel.toFixed(CASAS_QUANTIDADE), solicitado: s.kg.toFixed(CASAS_QUANTIDADE),
      });
    } else {
      for (const f of fifo.fatias) {
        const l = ls.find((x) => x.id === f.lote_id);
        if (l) l.quantidade_disponivel = l.quantidade_disponivel.minus(f.quantidade);
      }
      // D-PROD-256: o motor reavalia o disponível restante para o médio de depois; a simulação da próxima saída do mesmo poço vê o mesmo.
      for (const l of ls) if (fifo.camadasRestantes.includes(l.id)) l.custo_unitario = fifo.custoMedioDepois;
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
