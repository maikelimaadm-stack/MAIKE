/**
 * Modelo PURO do formulário da Central Única de Lançamentos (D-PROD-155).
 *
 * O formulário guarda o que o usuário DIGITOU (texto no formato do locale);
 * daqui sai tudo o que é derivado — subtotais, total, rateio, parcelas,
 * diferenças ao centavo — e o corpo DOC da API (§5) com valores em string
 * canônica. Nenhuma conta usa float: tudo passa por `dinheiroDecimal`.
 * O servidor continua sendo a autoridade (ele refaz a mesma conta).
 */

import {
  LIMITES,
  comparar,
  dividirComRestoNaUltima,
  ehPositivo,
  lerNumeroLocal,
  multiplicarArredondar,
  naEscala,
  paraTextoDeEdicao,
  percentualDe,
  ratearPercentual,
  somar,
  subtrair,
} from '@/lib/dinheiroDecimal';
import { ehDiaValido, somarDias } from '@/lib/diaCivil';
import { mensagemDaLinhaDoRateio } from '@/lib/gestaoErros';
import { ratearCabecalho } from '@/lib/rateioCabecalho';

export const MAX_ITENS = 200;
export const MAX_RATEIOS = 50;
export const MAX_PARCELAS = 120;
/** Teto do estoque legado (colunas 14,4): mercadoria não passa disto (§8.2). */
export const LIMITE_ESTOQUE = '9999999999.9999';
/** Teto de qualquer total do documento (18,4). */
export const LIMITE_TOTAL = '99999999999999.9999';

let sequencia = 0;
/** Chave estável de linha (só para o React). */
export const novaChaveLinha = () => {
  sequencia += 1;
  return `l${Date.now().toString(36)}${sequencia}`;
};

/** @returns {any} */
export const itemVazio = (tipo = 'MERCADORIA') => ({
  chave: novaChaveLinha(),
  tipo_item: tipo,
  produto: null,
  local: null,
  descricao: '',
  unidade: tipo === 'SERVICO' ? 'UN' : 'KG',
  quantidade: '',
  valor_unitario: '',
});

/** @returns {any} */
export const rateioVazio = () => ({ chave: novaChaveLinha(), natureza: null, centro_custo: null, centro_resultado: null, valor: '', percentual: '' });

/** @param {string} [vencimento] @param {string} [valor] @returns {any} */
export const parcelaVazia = (vencimento = '', valor = '') => ({ chave: novaChaveLinha(), vencimento, valor });

/**
 * Formulário novo. Padrões visíveis: a pagar, sem produtos, à vista, emissão = hoje.
 * @param {{ hoje: string }} p
 * @returns {any}
 */
export const formularioVazio = ({ hoje }) => ({
  direcao: 'PAGAR',
  conteudo: 'SEM_PRODUTOS',
  condicao: 'AVISTA',
  parceiro: null,
  data_emissao: hoje,
  data_operacional: '',
  efeito_fisico_confirmado: false,
  documento_referencia: '',
  descricao: '',
  metodo_preferido: '',
  valor_bruto: '',
  valor_desconto: '',
  valor_acrescimo: '',
  itens: [],
  rateio_modo: 'VALOR',
  rateios: [rateioVazio()],
  parcelas: [],
  prazo_vencimento: somarDias(hoje, 30),
  gerador: { quantidade: '2', primeiro_vencimento: somarDias(hoje, 30), intervalo: '30', entrada: '' },
});

/** @param {unknown} v */
const t = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Formulário a partir do DETALHE do servidor (rascunho a editar ou consultar).
 * @param {any} d
 * @param {{ locale: string, casas: number, hoje: string }} ctx
 * @returns {any}
 */
export const formularioDoDetalhe = (d, ctx) => {
  const dinheiro = (/** @type {unknown} */ v) => (v == null || v === '' || comparar(t(v), '0') === 0 ? '' : paraTextoDeEdicao(t(v), ctx.locale, { casasMin: ctx.casas, casasMax: ctx.casas }));
  const numero = (/** @type {unknown} */ v, /** @type {number} */ max) => (v == null || v === '' ? '' : paraTextoDeEdicao(t(v), ctx.locale, { casasMin: 0, casasMax: max }));
  const ref = (/** @type {unknown} */ id, /** @type {unknown} */ nome, extra = {}) => (id ? { id: String(id), rotulo: t(nome) || String(id), ...extra } : null);
  const itens = (Array.isArray(d?.itens) ? d.itens : []).map((/** @type {any} */ i) => ({
    chave: novaChaveLinha(),
    tipo_item: i.tipo_item === 'SERVICO' ? 'SERVICO' : 'MERCADORIA',
    produto: ref(i.produto_id, i.produto_nome, i.unidade === 'SACO' ? { unidade_principal_estoque: 'SACO', peso_por_saco_kg: t(i.fator_kg) } : {}),
    local: ref(i.local_estoque_id, i.local_estoque_nome),
    descricao: t(i.descricao),
    unidade: i.unidade === 'SACO' || i.unidade === 'UN' ? i.unidade : 'KG',
    quantidade: numero(i.quantidade, 4),
    valor_unitario: numero(i.valor_unitario, 6),
  }));
  const modo = d?.rateio_modo === 'PERCENTUAL' ? 'PERCENTUAL' : 'VALOR';
  const rateios = (Array.isArray(d?.rateios) ? d.rateios : []).map((/** @type {any} */ r) => ({
    chave: novaChaveLinha(),
    natureza: ref(r.natureza_id, r.natureza_nome),
    centro_custo: ref(r.centro_custo_id, r.centro_custo_nome),
    centro_resultado: ref(r.centro_resultado_id, r.centro_resultado_nome),
    valor: modo === 'VALOR' ? dinheiro(r.valor) : '',
    percentual: modo === 'PERCENTUAL' ? numero(r.percentual, 6) : '',
  }));
  const titulos = Array.isArray(d?.titulos) ? d.titulos : [];
  const parcelas = [...titulos]
    .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.numero_parcela ?? 0) - (b.numero_parcela ?? 0))
    .map((/** @type {any} */ p) => parcelaVazia(t(p.vencimento).slice(0, 10), dinheiro(p.valor)));
  const condicao = ['AVISTA', 'PRAZO', 'PARCELADO'].includes(d?.condicao) ? d.condicao : 'AVISTA';
  const emissao = t(d?.data_emissao).slice(0, 10) || ctx.hoje;
  return {
    direcao: d?.direcao === 'RECEBER' ? 'RECEBER' : 'PAGAR',
    conteudo: d?.conteudo === 'COM_PRODUTOS' ? 'COM_PRODUTOS' : 'SEM_PRODUTOS',
    condicao,
    parceiro: ref(d?.parceiro_id, d?.parceiro_nome),
    data_emissao: emissao,
    data_operacional: t(d?.data_operacional).slice(0, 10),
    // Rascunho com mercadoria só é gravado com a declaração: volta marcada.
    efeito_fisico_confirmado: Boolean(d?.data_operacional),
    documento_referencia: t(d?.documento_referencia),
    descricao: t(d?.descricao),
    metodo_preferido: t(d?.metodo_preferido),
    valor_bruto: d?.conteudo === 'COM_PRODUTOS' ? '' : dinheiro(d?.valor_bruto),
    valor_desconto: dinheiro(d?.valor_desconto),
    valor_acrescimo: dinheiro(d?.valor_acrescimo),
    itens,
    rateio_modo: modo,
    rateios: rateios.length ? rateios : [rateioVazio()],
    parcelas: condicao === 'PARCELADO' ? parcelas : [],
    prazo_vencimento: condicao === 'PRAZO' ? (parcelas[0]?.vencimento ?? '') : '',
    gerador: { quantidade: String(Math.max(2, parcelas.length || 2)), primeiro_vencimento: parcelas[0]?.vencimento || somarDias(emissao, 30), intervalo: '30', entrada: '' },
  };
};

/** Mensagem do motivo de leitura de número. @param {'vazio'|'formato'|'casas'|'limite'|undefined} motivo @param {number} casas */
export const mensagemNumero = (motivo, casas) => {
  if (motivo === 'casas') return casas === 0 ? 'Esta moeda não tem casas decimais' : `No máximo ${casas} casa${casas === 1 ? '' : 's'} decimais`;
  if (motivo === 'limite') return 'Valor acima do limite';
  if (motivo === 'formato') return 'Formato inválido';
  return 'Obrigatório';
};

/**
 * @param {string} texto
 * @param {string} locale
 * @param {{ casas: number, inteiros: number }} limites
 * @param {{ obrigatorio?: boolean, positivo?: boolean }} [regras]
 * @returns {{ valor: string|null, erro: string|null }}
 */
const lerCampo = (texto, locale, limites, regras = {}) => {
  const r = lerNumeroLocal(texto, locale, limites);
  if (!r.ok) {
    if (r.motivo === 'vazio') return { valor: null, erro: regras.obrigatorio ? 'Obrigatório' : null };
    return { valor: null, erro: mensagemNumero(r.motivo, limites.casas) };
  }
  if (regras.positivo && !ehPositivo(r.valor)) return { valor: r.valor, erro: 'Precisa ser maior que zero' };
  return { valor: r.valor, erro: null };
};

/** @param {any} produto */
const pesoDoSaco = (produto) => {
  const peso = produto?.peso_por_saco_kg;
  if (peso == null || peso === '') return null;
  const texto = typeof peso === 'number' ? String(peso) : t(peso);
  return /^\d+(?:\.\d+)?$/.test(texto) && ehPositivo(texto) ? texto : null;
};

/** O produto aceita SACO? (só com unidade principal SACO e peso por saco > 0). @param {any} produto */
export const produtoAceitaSaco = (produto) => produto?.unidade_principal_estoque === 'SACO' && pesoDoSaco(produto) !== null;

/**
 * Tudo o que é derivado do formulário, mais os erros por campo.
 * @param {any} form
 * @param {{ locale: string, casas: number, hoje?: string, moeda?: string }} ctx
 */
export const calcularResumo = (form, ctx) => {
  const { locale, casas } = ctx;
  const DIN = { casas, inteiros: LIMITES.DINHEIRO.inteiros };
  const comProdutos = form.conteudo === 'COM_PRODUTOS';
  /** @type {Record<string, string>} */
  const erros = {};

  // Itens
  const itens = (comProdutos ? form.itens : []).map((/** @type {any} */ item, /** @type {number} */ i) => {
    const q = lerCampo(item.quantidade, locale, LIMITES.QUANTIDADE, { obrigatorio: true, positivo: true });
    const vu = lerCampo(item.valor_unitario, locale, LIMITES.PRECO, { obrigatorio: true });
    const mercadoria = item.tipo_item === 'MERCADORIA';
    /** @type {Record<string, string>} */
    const e = {};
    if (q.erro) e.quantidade = q.erro;
    if (vu.erro) e.valor_unitario = vu.erro;
    let subtotal = null;
    let kg = null;
    if (q.valor && vu.valor && !q.erro && !vu.erro) {
      subtotal = multiplicarArredondar(q.valor, vu.valor, casas);
      if (!ehPositivo(subtotal)) e.subtotal = 'Subtotal zero: confira quantidade e valor unitário';
    }
    if (mercadoria) {
      if (!item.produto) e.produto = 'Escolha o produto';
      if (!item.local) e.local = 'Escolha o local de estoque';
      if (item.unidade === 'SACO' && !produtoAceitaSaco(item.produto)) e.unidade = 'Este produto não é controlado em sacos';
      if (item.unidade !== 'KG' && item.unidade !== 'SACO') e.unidade = 'Use KG ou SACO';
      if (q.valor && !q.erro) {
        const fator = item.unidade === 'SACO' ? pesoDoSaco(item.produto) : '1';
        if (fator) {
          kg = multiplicarArredondar(q.valor, fator, 4);
          if (!ehPositivo(kg)) e.quantidade = 'A quantidade em kg ficaria zero';
          else if (comparar(kg, LIMITE_ESTOQUE) > 0) e.quantidade = 'Acima do limite do estoque';
        }
      }
      if (subtotal && comparar(subtotal, LIMITE_ESTOQUE) > 0) e.subtotal = 'Mercadoria acima do limite do estoque (9.999.999.999,9999)';
    } else if (!item.descricao.trim()) {
      e.descricao = 'Descreva o serviço';
    }
    for (const [campo, msg] of Object.entries(e)) erros[`itens.${i}.${campo}`] = msg;
    return { subtotal, kg, quantidade: q.valor, valor_unitario: vu.valor, erros: e };
  });
  if (comProdutos && !form.itens.length) erros.itens = 'Inclua pelo menos um item';
  if (form.itens.length > MAX_ITENS) erros.itens = `No máximo ${MAX_ITENS} itens`;

  // Bruto, desconto, acréscimo, total
  let bruto = null;
  if (comProdutos) {
    bruto = itens.every((i) => i.subtotal) && itens.length ? somar(itens.map((i) => i.subtotal), casas) : null;
  } else {
    const b = lerCampo(form.valor_bruto, locale, DIN, { obrigatorio: true, positivo: true });
    if (b.erro) erros.valor_bruto = b.erro;
    bruto = b.erro ? null : b.valor && naEscala(b.valor, casas);
  }
  const desc = lerCampo(form.valor_desconto, locale, DIN);
  const acr = lerCampo(form.valor_acrescimo, locale, DIN);
  if (desc.erro) erros.valor_desconto = desc.erro;
  if (acr.erro) erros.valor_acrescimo = acr.erro;
  const desconto = desc.valor ? naEscala(desc.valor, casas) : naEscala('0', casas);
  const acrescimo = acr.valor ? naEscala(acr.valor, casas) : naEscala('0', casas);
  let total = null;
  if (bruto && !desc.erro && !acr.erro) {
    total = somar([subtrair(bruto, desconto, casas), acrescimo], casas);
    if (!ehPositivo(total)) erros.total = 'O total precisa ser maior que zero (confira o desconto)';
    else if (comparar(total, LIMITE_TOTAL) > 0) erros.total = 'Total acima do limite permitido';
  }
  const totalValido = Boolean(total) && !erros.total;

  // Custo de aquisição líquido (rodada 4): a MESMA política do servidor
  // (desconto/acréscimo rateados por item; custo/kg com 4 casas) aponta, DENTRO
  // do item, a linha que o servidor recusaria — antes de salvar ou confirmar.
  if (comProdutos && totalValido && itens.length && itens.every((i) => i.subtotal && ehPositivo(i.subtotal))) {
    const rateio = ratearCabecalho({
      direcao: form.direcao,
      casas,
      valor_desconto: desconto,
      valor_acrescimo: acrescimo,
      itens: itens.map((i, k) => ({ ordem: k + 1, tipo_item: form.itens[k]?.tipo_item, valor_total: /** @type {string} */ (i.subtotal), quantidade_estoque: form.itens[k]?.tipo_item === 'MERCADORIA' ? i.kg : null })),
    });
    if (rateio?.erro) {
      const { reason, details } = rateio.erro;
      erros[`itens.${details.indice}.liquido`] = mensagemDaLinhaDoRateio(reason, details, { locale, moeda: ctx.moeda, casas }) ?? 'O valor líquido deste item é inválido.';
    } else if (rateio && form.direcao === 'PAGAR') {
      // Como o servidor (valor_excede_limite_estoque): na compra, lote e movimento
      // recebem o LÍQUIDO, que o acréscimo rateado pode levar acima do teto do estoque.
      rateio.itens.forEach((ri, k) => {
        if (form.itens[k]?.tipo_item === 'MERCADORIA' && comparar(ri.valor_liquido, LIMITE_ESTOQUE) > 0) {
          erros[`itens.${k}.liquido`] = 'Com o acréscimo rateado, o valor líquido desta mercadoria passa do limite do estoque (9.999.999.999,9999). Reduza o acréscimo ou divida o item.';
        }
      });
    }
  }

  // Rateio (sempre sobre o TOTAL, depois de desconto e acréscimo)
  const umaLinha = form.rateios.length === 1;
  /** @type {Array<string|null>} */
  let valoresRateio = [];
  let diferencaRateio = null;
  let somaPercentual = null;
  let rateioFecha = false;
  /** @type {Array<string|null>} */
  let percentuais = [];
  if (form.rateio_modo === 'PERCENTUAL') {
    const pcts = form.rateios.map((/** @type {any} */ r, /** @type {number} */ i) => {
      if (umaLinha) return '100';
      const p = lerCampo(r.percentual, locale, LIMITES.PERCENTUAL, { obrigatorio: true, positivo: true });
      if (!p.erro && p.valor && comparar(p.valor, '100') > 0) p.erro = 'No máximo 100%';
      if (p.erro) erros[`rateios.${i}.percentual`] = p.erro;
      return p.erro ? null : p.valor;
    });
    percentuais = pcts;
    const soma = pcts.every((p) => p) ? somar(pcts, 6) : null;
    somaPercentual = soma;
    if (soma && comparar(soma, '100') !== 0) erros.rateio = 'Os percentuais precisam somar exatamente 100%';
    else if (totalValido && soma) {
      const r = ratearPercentual(/** @type {string} */ (total), pcts, casas);
      rateioFecha = r.fecha100 && r.linhasZeradas.length === 0;
      valoresRateio = r.valores;
      for (const i of r.linhasZeradas) erros[`rateios.${i}.percentual`] = 'Esta linha ficaria com valor zero';
    }
  } else {
    valoresRateio = form.rateios.map((/** @type {any} */ r, /** @type {number} */ i) => {
      if (umaLinha) return totalValido ? total : null;
      const v = lerCampo(r.valor, locale, DIN, { obrigatorio: true, positivo: true });
      if (v.erro) erros[`rateios.${i}.valor`] = v.erro;
      return v.erro || !v.valor ? null : naEscala(v.valor, casas);
    });
    if (totalValido && valoresRateio.every((v) => v)) {
      diferencaRateio = subtrair(/** @type {string} */ (total), somar(valoresRateio, casas), casas);
      rateioFecha = comparar(diferencaRateio, '0') === 0;
      if (!rateioFecha) erros.rateio = 'A soma do rateio precisa ser igual ao total';
    }
  }
  form.rateios.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    if (!r.natureza) erros[`rateios.${i}.natureza`] = 'Escolha a natureza';
  });
  const vistos = new Map();
  form.rateios.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    if (!r.natureza) return;
    const k = `${r.natureza.id}|${r.centro_custo?.id ?? ''}|${r.centro_resultado?.id ?? ''}`;
    if (vistos.has(k)) erros[`rateios.${i}.natureza`] = `Linha repetida (igual à linha ${vistos.get(k) + 1})`;
    else vistos.set(k, i);
  });
  if (!form.rateios.length) erros.rateio = 'Inclua pelo menos uma linha de rateio';
  if (form.rateios.length > MAX_RATEIOS) erros.rateio = `No máximo ${MAX_RATEIOS} linhas de rateio`;

  // Parcelas
  /** @type {Array<{ vencimento: string, valor: string|null }>} */
  let parcelas = [];
  let diferencaParcelas = null;
  if (form.condicao === 'AVISTA') {
    parcelas = [{ vencimento: form.data_emissao, valor: totalValido ? total : null }];
  } else if (form.condicao === 'PRAZO') {
    const venc = form.prazo_vencimento ?? '';
    if (!ehDiaValido(venc)) erros.prazo_vencimento = 'Informe o vencimento';
    else if (ehDiaValido(form.data_emissao) && venc < form.data_emissao) erros.prazo_vencimento = 'O vencimento não pode ser antes da emissão';
    parcelas = [{ vencimento: venc, valor: totalValido ? total : null }];
  } else {
    parcelas = form.parcelas.map((/** @type {any} */ p, /** @type {number} */ i) => {
      const v = lerCampo(p.valor, locale, DIN, { obrigatorio: true, positivo: true });
      if (v.erro) erros[`parcelas.${i}.valor`] = v.erro;
      if (!ehDiaValido(p.vencimento)) erros[`parcelas.${i}.vencimento`] = 'Informe o vencimento';
      else if (ehDiaValido(form.data_emissao) && p.vencimento < form.data_emissao) erros[`parcelas.${i}.vencimento`] = 'Antes da emissão';
      else if (i > 0 && ehDiaValido(form.parcelas[i - 1].vencimento) && p.vencimento < form.parcelas[i - 1].vencimento) erros[`parcelas.${i}.vencimento`] = 'Antes da parcela anterior';
      return { vencimento: p.vencimento, valor: v.erro || !v.valor ? null : naEscala(v.valor, casas) };
    });
    if (form.parcelas.length < 2 || form.parcelas.length > MAX_PARCELAS) erros.parcelas = `Parcelado tem de 2 a ${MAX_PARCELAS} parcelas`;
    if (totalValido && parcelas.length && parcelas.every((p) => p.valor)) {
      diferencaParcelas = subtrair(/** @type {string} */ (total), somar(parcelas.map((p) => p.valor), casas), casas);
      if (comparar(diferencaParcelas, '0') !== 0) erros.parcelas = 'A soma das parcelas precisa ser igual ao total';
    }
  }

  // Cabeçalho
  const temMercadoria = comProdutos && form.itens.some((/** @type {any} */ i) => i.tipo_item === 'MERCADORIA');
  if (!form.parceiro) erros.parceiro = 'Escolha o parceiro';
  if (!ehDiaValido(form.data_emissao)) erros.data_emissao = 'Informe a data de emissão';
  if (temMercadoria) {
    if (!ehDiaValido(form.data_operacional)) erros.data_operacional = form.direcao === 'PAGAR' ? 'Informe o dia do recebimento da mercadoria' : 'Informe o dia da entrega da mercadoria';
    else if (ctx.hoje && form.data_operacional > ctx.hoje) erros.data_operacional = 'O dia do recebimento/entrega não pode ser futuro';
    if (form.efeito_fisico_confirmado !== true) erros.efeito_fisico_confirmado = 'Confirme que a mercadoria já foi recebida/entregue';
  }
  if (form.documento_referencia.trim().length > 64) erros.documento_referencia = 'No máximo 64 caracteres';
  if (form.descricao.trim().length > 500) erros.descricao = 'No máximo 500 caracteres';

  const itensEstoque = itens.filter((_, i) => form.itens[i]?.tipo_item === 'MERCADORIA').length;
  return {
    itens,
    bruto,
    desconto,
    acrescimo,
    total: totalValido ? total : null,
    temMercadoria,
    itensEstoque,
    rateio: {
      valores: valoresRateio,
      diferenca: diferencaRateio,
      somaPercentual,
      percentuais,
      fecha: rateioFecha,
      percentuaisInformativos:
        form.rateio_modo === 'VALOR' && totalValido
          ? valoresRateio.map((v) => (v ? percentualDe(v, /** @type {string} */ (total), casas, 2) : null))
          : [],
    },
    parcelas,
    diferencaParcelas,
    erros,
    valido: Object.keys(erros).length === 0,
  };
};

/**
 * Corpo DOC da API (POST/PUT, §5). Só monta com o resumo VÁLIDO.
 * @param {any} form
 * @param {ReturnType<typeof calcularResumo>} resumo
 * @returns {Record<string, unknown>}
 */
export const montarDocumento = (form, resumo) => {
  const comProdutos = form.conteudo === 'COM_PRODUTOS';
  /** @type {Record<string, unknown>} */
  const doc = {
    direcao: form.direcao,
    conteudo: form.conteudo,
    condicao: form.condicao,
    parceiro_id: form.parceiro?.id,
    data_emissao: form.data_emissao,
  };
  if (resumo.temMercadoria) {
    doc.data_operacional = form.data_operacional;
    doc.efeito_fisico_confirmado = form.efeito_fisico_confirmado === true;
  }
  const descricao = form.descricao.trim();
  if (descricao) doc.descricao = descricao;
  const documento = form.documento_referencia.trim().toUpperCase();
  if (documento) doc.documento_referencia = documento;
  if (form.metodo_preferido) doc.metodo_preferido = form.metodo_preferido;
  if (!comProdutos && resumo.bruto) doc.valor_bruto = resumo.bruto;
  if (ehPositivo(resumo.desconto)) doc.valor_desconto = resumo.desconto;
  if (ehPositivo(resumo.acrescimo)) doc.valor_acrescimo = resumo.acrescimo;
  if (comProdutos) {
    doc.itens = form.itens.map((/** @type {any} */ item, /** @type {number} */ i) => {
      const r = resumo.itens[i];
      /** @type {Record<string, unknown>} */
      const linha = { tipo_item: item.tipo_item, unidade: item.tipo_item === 'SERVICO' ? 'UN' : item.unidade, quantidade: r.quantidade, valor_unitario: r.valor_unitario };
      if (item.tipo_item === 'MERCADORIA') {
        linha.produto_id = item.produto?.id;
        linha.local_estoque_id = item.local?.id;
      }
      const d = item.descricao.trim();
      if (d) linha.descricao = d;
      return linha;
    });
  }
  doc.rateio_modo = form.rateio_modo;
  doc.rateios = form.rateios.map((/** @type {any} */ r, /** @type {number} */ i) => {
    /** @type {Record<string, unknown>} */
    const linha = { natureza_id: r.natureza?.id };
    if (r.centro_custo) linha.centro_custo_id = r.centro_custo.id;
    if (r.centro_resultado) linha.centro_resultado_id = r.centro_resultado.id;
    if (form.rateio_modo === 'PERCENTUAL') {
      linha.percentual = resumo.rateio.percentuais[i];
    } else {
      linha.valor = resumo.rateio.valores[i];
    }
    return linha;
  });
  doc.parcelas = resumo.parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valor }));
  return doc;
};

/**
 * Gerador do parcelado (§7): nº de parcelas, 1º vencimento, intervalo em dias e
 * entrada opcional (vence na emissão). O resto do arredondamento vai para a
 * ÚLTIMA parcela.
 * @param {{ total: string|null, casas: number, locale: string, dataEmissao: string,
 *   quantidade: string, primeiroVencimento: string, intervalo: string, entrada: string }} p
 * @returns {{ ok: boolean, parcelas?: Array<{ vencimento: string, valor: string }>, erro?: string }}
 */
export const gerarParcelas = (p) => {
  if (!p.total) return { ok: false, erro: 'Preencha os valores antes de gerar as parcelas.' };
  const n = Number(p.quantidade);
  const intervalo = Number(p.intervalo);
  if (!/^\d{1,3}$/.test(String(p.quantidade).trim()) || !Number.isInteger(n) || n < 1) return { ok: false, erro: 'Informe o número de parcelas.' };
  if (!/^\d{1,3}$/.test(String(p.intervalo).trim()) || !Number.isInteger(intervalo) || intervalo < 1) return { ok: false, erro: 'Informe o intervalo em dias (1 ou mais).' };
  if (!ehDiaValido(p.primeiroVencimento)) return { ok: false, erro: 'Informe o 1º vencimento.' };
  if (ehDiaValido(p.dataEmissao) && p.primeiroVencimento < p.dataEmissao) return { ok: false, erro: 'O 1º vencimento não pode ser antes da emissão.' };
  let entrada = null;
  if (String(p.entrada ?? '').trim()) {
    const e = lerNumeroLocal(p.entrada, p.locale, { casas: p.casas, inteiros: LIMITES.DINHEIRO.inteiros });
    if (!e.ok) return { ok: false, erro: `Entrada: ${mensagemNumero(e.motivo, p.casas)}.` };
    if (ehPositivo(e.valor)) entrada = naEscala(e.valor, p.casas);
  }
  const totalParcelas = n + (entrada ? 1 : 0);
  if (totalParcelas < 2 || totalParcelas > MAX_PARCELAS) return { ok: false, erro: `Parcelado tem de 2 a ${MAX_PARCELAS} parcelas (contando a entrada).` };
  const restante = entrada ? subtrair(p.total, entrada, p.casas) : p.total;
  if (!ehPositivo(restante)) return { ok: false, erro: 'A entrada precisa ser menor que o total.' };
  const valores = dividirComRestoNaUltima(restante, n, p.casas);
  if (valores.some((v) => !ehPositivo(v))) return { ok: false, erro: 'O valor não dá para tantas parcelas (alguma ficaria zero).' };
  const parcelas = [];
  if (entrada) parcelas.push({ vencimento: p.dataEmissao, valor: entrada });
  for (let k = 0; k < n; k += 1) {
    const vencimento = somarDias(p.primeiroVencimento, k * intervalo);
    if (!vencimento) return { ok: false, erro: 'Vencimento fora do calendário.' };
    parcelas.push({ vencimento, valor: valores[k] });
  }
  return { ok: true, parcelas };
};
