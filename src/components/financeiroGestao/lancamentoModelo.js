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
  formatarNumero,
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
import { dividirArredondar } from '@/lib/estoqueEntradasRegras';
import { mensagemDaLinhaDoRateio } from '@/lib/gestaoErros';
import { ratearCabecalho } from '@/lib/rateioCabecalho';
import { MAX_RATEIOS_ITENS_TOTAL, MAX_RATEIOS_POR_ITEM, distribuirProporcional, escopoDoRateio } from '@/lib/rateioPorItem';

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
 *
 * Rateio (D-PROD-156): `rateio_escopo` GERAL (padrão, o de sempre, em `rateios`)
 * ou POR_ITEM (só com produtos). No POR_ITEM as linhas de cada item ficam em
 * `rateios_itens[chave do item]` — presas à CHAVE estável do item, nunca ao
 * índice: reordenar leva as linhas junto e remover o item as remove. O rateio
 * geral continua guardado em `rateios` enquanto o escopo é POR_ITEM.
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
  rateio_escopo: 'GERAL',
  rateio_modo: 'VALOR',
  rateios: [rateioVazio()],
  rateios_itens: {},
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
    // D-PROD-162: item em L só existe para Produto em L: o detalhe preserva `L` e marca o Produto.
    produto: ref(
      i.produto_id,
      i.produto_nome,
      i.unidade === 'SACO' ? { unidade_principal_estoque: 'SACO', peso_por_saco_kg: t(i.fator_kg) } : i.unidade === 'L' ? { unidade_principal_estoque: 'L' }
        // D-PROD-288: item numa unidade de conversão volta com o fator GRAVADO (editar o fator não muda o passado).
        : ehSiglaDeConversao(i.unidade) && i.fator_kg != null ? { unidades_conversao: [{ sigla: String(i.unidade), operacao: 'MULTIPLICA', fator: t(i.fator_kg), ativa: true }] } : {},
    ),
    local: ref(i.local_estoque_id, i.local_estoque_nome),
    descricao: t(i.descricao),
    unidade: i.unidade === 'SACO' || i.unidade === 'UN' || i.unidade === 'L' || ehSiglaDeConversao(i.unidade) ? i.unidade : 'KG',
    quantidade: numero(i.quantidade, 4),
    valor_unitario: numero(i.valor_unitario, 6),
  }));
  const modo = d?.rateio_modo === 'PERCENTUAL' ? 'PERCENTUAL' : 'VALOR';
  const linhaDoRateio = (/** @type {any} */ r) => ({
    chave: novaChaveLinha(),
    natureza: ref(r.natureza_id, r.natureza_nome),
    centro_custo: ref(r.centro_custo_id, r.centro_custo_nome),
    centro_resultado: ref(r.centro_resultado_id, r.centro_resultado_nome),
    valor: modo === 'VALOR' ? dinheiro(r.valor) : '',
    percentual: modo === 'PERCENTUAL' ? numero(r.percentual, 6) : '',
  });
  const rateios = (Array.isArray(d?.rateios) ? d.rateios : []).map(linhaDoRateio);
  // Rascunho antigo (P3-01, sem `rateio_escopo`) abre como GERAL.
  const escopo = d?.conteudo === 'COM_PRODUTOS' ? escopoDoRateio(d?.rateio_escopo) : 'GERAL';
  /** @type {Record<string, any[]>} */
  const rateiosItens = {};
  if (escopo === 'POR_ITEM') {
    (Array.isArray(d?.itens) ? d.itens : []).forEach((/** @type {any} */ i, /** @type {number} */ k) => {
      const linhas = Array.isArray(i?.rateios) ? [...i.rateios].sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0)) : [];
      rateiosItens[itens[k].chave] = linhas.map(linhaDoRateio);
    });
  }
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
    rateio_escopo: escopo,
    rateio_modo: modo,
    rateios: rateios.length ? rateios : [rateioVazio()],
    rateios_itens: rateiosItens,
    parcelas: condicao === 'PARCELADO' ? parcelas : [],
    prazo_vencimento: condicao === 'PRAZO' ? (parcelas[0]?.vencimento ?? '') : '',
    gerador: { quantidade: String(Math.max(2, parcelas.length || 2)), primeiro_vencimento: parcelas[0]?.vencimento || somarDias(emissao, 30), intervalo: '30', entrada: '' },
  };
};

// ─── D-PROD-158 — duplicar, corrigir confirmado e situação do registro ───

/**
 * Formulário NOVO a partir do DETALHE completo de outro lançamento (Duplicar).
 * Copia o conteúdo editável — direção, conteúdo, condição, parceiro, itens e
 * serviços, preços, desconto/acréscimo, rateio GERAL ou POR_ITEM (as linhas por
 * item presas às chaves NOVAS dos itens), naturezas, centros e parcelas com as
 * mesmas datas e valores. NÃO copia identidade nem estado (id, número, versão,
 * status, operation_id, datas de sistema, usuários, títulos, baixas, lotes,
 * movimentos, consumos, histórico, eventos): o formulário só guarda conteúdo.
 * `documento_referencia` começa vazio (unicidade) e a declaração física começa
 * DESMARCADA (sem segunda entrada/saída sem intenção).
 * @param {any} d
 * @param {{ locale: string, casas: number, hoje: string }} ctx
 * @returns {any}
 */
export const formularioDeDuplicacao = (d, ctx) => ({
  ...formularioDoDetalhe(d, ctx),
  documento_referencia: '',
  efeito_fisico_confirmado: false,
});

/**
 * Situação de exibição do registro: excluído e versão substituída por correção
 * têm selo próprio (os dois ficam CANCELADO no servidor).
 * @param {any} item
 * @returns {string}
 */
export const situacaoDoLancamento = (item) => {
  if (typeof item?.excluido_em === 'string' && item.excluido_em) return 'EXCLUIDO';
  if (typeof item?.retificado_em === 'string' && item.retificado_em) return 'SUBSTITUIDO';
  return typeof item?.status === 'string' ? item.status : '';
};

/** Decimal canônico igual (escala livre: "100" = "100.0000"); ausente só é igual a ausente. @param {unknown} a @param {unknown} b */
const mesmoDecimal = (a, b) => {
  const x = a == null || a === '' ? null : t(a);
  const y = b == null || b === '' ? null : t(b);
  if (x === null || y === null) return x === y;
  try {
    return comparar(x, y) === 0;
  } catch {
    return x === y;
  }
};

/**
 * D-PROD-158 (revisão TELA-01): na correção de um confirmado, o peso por saco
 * de um produto que o documento JÁ tinha em SACO é o GRAVADO no item
 * (`fator_kg` do recebimento), não o do cadastro atual — a MESMA regra do
 * servidor (`comPesoGravado` em operacaoFinanceiraService): o saco recebido
 * não muda de peso porque o cadastro mudou depois. Vale também quando o
 * produto é escolhido de novo no seletor (que traz o peso ATUAL). Produto que
 * entra no documento pela primeira vez usa o peso do seletor.
 * @param {any} form
 * @param {any} d detalhe do confirmado aberto
 * @returns {any} o formulário com o peso gravado nos produtos já recebidos em SACO
 */
export const comPesoGravado = (form, d) => {
  /** @type {Map<string, string>} */
  const gravado = new Map();
  const antigos = (Array.isArray(d?.itens) ? [...d.itens] : []).sort((/** @type {any} */ a, /** @type {any} */ b) => (Number(a?.ordem) || 0) - (Number(b?.ordem) || 0));
  for (const i of antigos) {
    if (i?.tipo_item === 'MERCADORIA' && i.unidade === 'SACO' && i.produto_id && i.fator_kg != null && !gravado.has(String(i.produto_id))) {
      gravado.set(String(i.produto_id), t(i.fator_kg));
    }
  }
  if (!gravado.size || !Array.isArray(form?.itens)) return form;
  return {
    ...form,
    itens: form.itens.map((/** @type {any} */ item) => {
      const fator = item?.tipo_item === 'MERCADORIA' && item.produto?.id ? gravado.get(String(item.produto.id)) : undefined;
      return fator === undefined ? item : { ...item, produto: { ...item.produto, unidade_principal_estoque: 'SACO', peso_por_saco_kg: fator } };
    }),
  };
};

/**
 * A correção muda o efeito FÍSICO? A mesma assinatura que o servidor compara
 * (SPEC §4.5): por item MERCADORIA `(ordem, tipo, produto, local, unidade,
 * quantidade em kg, fator)` + data operacional + direção e, só na compra, o
 * valor líquido (custo do lote). O peso por saco é o GRAVADO para o produto
 * já recebido em SACO (`comPesoGravado`, como o servidor). É só a PREVISÃO da
 * tela (texto do diálogo e aviso quando o servidor já disse que o estoque não
 * pode mudar): quem decide é o servidor, sob trava.
 * @param {any} d detalhe do confirmado aberto
 * @param {any} formulario
 * @param {ReturnType<typeof calcularResumo>} resumo
 * @returns {{ muda: boolean, diferencas: Array<{ item: number|null, campo: string }> }}
 */
export const mudancasFisicas = (d, formulario, resumo) => {
  const antigos = (Array.isArray(d?.itens) ? d.itens : []).filter((/** @type {any} */ i) => i?.tipo_item === 'MERCADORIA');
  const form = comPesoGravado(formulario, d);
  const comProdutos = form.conteudo === 'COM_PRODUTOS';
  const novos = (comProdutos ? form.itens : [])
    .map((/** @type {any} */ item, /** @type {number} */ k) => ({ item, k }))
    .filter((/** @type {{ item: any }} */ x) => x.item.tipo_item === 'MERCADORIA');
  /** @type {Array<{ item: number|null, campo: string }>} */
  const diferencas = [];
  if (!antigos.length && !novos.length) return { muda: false, diferencas };
  if (d?.direcao !== form.direcao) diferencas.push({ item: null, campo: 'direcao' });
  if (t(d?.data_operacional).slice(0, 10) !== String(form.data_operacional ?? '')) diferencas.push({ item: null, campo: 'data_operacional' });
  const compra = d?.direcao === 'PAGAR' && form.direcao === 'PAGAR';
  const total = Math.max(antigos.length, novos.length);
  for (let n = 0; n < total; n += 1) {
    const antigo = antigos[n];
    const novo = novos[n];
    if (!antigo || !novo) {
      diferencas.push({ item: novo ? novo.k + 1 : Number(antigo?.ordem) || null, campo: antigo ? 'item_removido' : 'item_incluido' });
      continue;
    }
    const { item, k } = novo;
    const ordem = k + 1;
    const r = resumo.itens[k] ?? {};
    const fator = fatorDoItem(item);
    /** @param {string} campo */
    const dif = (campo) => diferencas.push({ item: ordem, campo });
    if (Number(antigo.ordem) !== ordem) dif('ordem');
    if (String(antigo.produto_id ?? '') !== String(item.produto?.id ?? '')) dif('produto');
    if (String(antigo.local_estoque_id ?? '') !== String(item.local?.id ?? '')) dif('local');
    if (String(antigo.unidade ?? '') !== String(item.unidade ?? '')) dif('unidade');
    if (!mesmoDecimal(antigo.quantidade_estoque, r.kg)) dif('quantidade');
    if (!mesmoDecimal(antigo.fator_kg, fator)) dif('fator');
    if (compra && !mesmoDecimal(antigo.valor_liquido, resumo.liquidos?.[k] ?? null)) dif('custo');
  }
  return { muda: diferencas.length > 0, diferencas };
};

const ROTULO_MUDANCA_FISICA = /** @type {Record<string, string>} */ ({
  direcao: 'direção',
  data_operacional: 'data de recebimento/entrega da mercadoria',
  item_removido: 'mercadoria removida',
  item_incluido: 'mercadoria incluída',
  ordem: 'posição da mercadoria na lista',
  produto: 'produto',
  local: 'local de estoque',
  unidade: 'unidade',
  quantidade: 'quantidade',
  fator: 'peso por saco',
  custo: 'custo (valor líquido da mercadoria: preço, desconto ou acréscimo)',
});

/**
 * "item 1: quantidade; data de recebimento/entrega da mercadoria" (até 4).
 * @param {Array<{ item: number|null, campo: string }>} diferencas
 */
export const descreverMudancasFisicas = (diferencas) => {
  const textos = diferencas.map((x) => `${x.item ? `item ${x.item}: ` : ''}${ROTULO_MUDANCA_FISICA[x.campo] ?? x.campo}`);
  const unicos = [...new Set(textos)];
  return `${unicos.slice(0, 4).join('; ')}${unicos.length > 4 ? '…' : ''}`;
};

/**
 * D-PROD-306 — os efeitos de estoque que a correção vai gravar, no formato da prévia (`efeitos_estoque`): por item
 * MERCADORIA, a ordem (a mesma do corpo: posição na lista + 1), produto, depósito e a quantidade em kg (ou L) do
 * resumo. É o que o diálogo "Salvar correção" usa para pedir o lote (compra) ou deixar escolher (venda) — a prévia do
 * servidor só existe para rascunho. O controle de lote do produto vem da leitura dos lotes, no diálogo.
 * @param {any} form @param {{ itens: Array<{ kg?: string|null }> }} resumo
 * @returns {Array<{ item_ordem: number, produto_id: string, produto_nome: string, local_estoque_id: string, local_nome: string, kg: string }>}
 */
export const mercadoriasDaCorrecao = (form, resumo) => {
  if (form?.conteudo !== 'COM_PRODUTOS' || !Array.isArray(form.itens)) return [];
  return form.itens.flatMap((/** @type {any} */ item, /** @type {number} */ k) => {
    const kg = resumo?.itens?.[k]?.kg;
    if (item?.tipo_item !== 'MERCADORIA' || !item.produto?.id || !item.local?.id || kg == null) return [];
    return [{
      item_ordem: k + 1, produto_id: String(item.produto.id), produto_nome: t(item.produto.rotulo), local_estoque_id: String(item.local.id), local_nome: t(item.local.rotulo), kg: t(kg),
    }];
  });
};

const CAMPO_DA_REFERENCIA = /** @type {Record<string, string>} */ ({
  produto_id: 'produto',
  local_estoque_id: 'local',
  unidade: 'unidade',
  natureza_id: 'natureza',
  centro_custo_id: 'centro_custo',
  centro_resultado_id: 'centro_resultado',
});

/**
 * Campo do formulário apontado por uma recusa de REFERÊNCIA do servidor (fora
 * do rateio por item, que tem `alvoDoErroDoRateioPorItem`): parceiro, produto,
 * local ou unidade de um item, natureza/centros de uma linha do rateio geral.
 * Serve a cópia (Duplicar) cuja referência ficou inativa ou saiu da empresa.
 * @param {{ field?: string|null, details?: Record<string, any> }} e
 * @returns {{ tipo: 'parceiro' } | { tipo: 'item'|'rateio', indice: number, campo: string } | null}
 */
export const alvoDaReferencia = ({ field = null, details = {} }) => {
  const campo = String(field ?? details?.field ?? '');
  if (campo === 'parceiro_id' && details?.colecao == null) return { tipo: 'parceiro' };
  if (!Number.isInteger(details?.indice) || details?.subcolecao != null) return null;
  const alvo = CAMPO_DA_REFERENCIA[campo];
  if (!alvo) return null;
  if (details.colecao === 'itens' && ['produto', 'local', 'unidade'].includes(alvo)) return { tipo: 'item', indice: details.indice, campo: alvo };
  if (details.colecao === 'rateios' && ['natureza', 'centro_custo', 'centro_resultado'].includes(alvo)) return { tipo: 'rateio', indice: details.indice, campo: alvo };
  return null;
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

/** D-PROD-288: a sigla é de uma unidade de conversão (não KG, SACO, L nem UN)? @param {unknown} u */
export const ehSiglaDeConversao = (u) => typeof u === 'string' && u.trim() !== '' && !['KG', 'SACO', 'L', 'UN'].includes(u);

/** D-PROD-288: a conversão ativa do produto com a sigla (ou null). @param {any} produto @param {string} sigla */
export const conversaoDoProduto = (produto, sigla) =>
  (Array.isArray(produto?.unidades_conversao) ? produto.unidades_conversao : []).find((c) => c && c.sigla === sigla && c.ativa !== false) ?? null;

/**
 * D-PROD-288: unidades que o item de mercadoria oferece: a de estoque, o SACO legado e as conversões ativas com o uso
 * da direção (compra → uso_compra; venda → uso_venda). @param {any} produto @param {'PAGAR'|'RECEBER'} direcao
 */
export const conversoesDoItem = (produto, direcao) =>
  (Array.isArray(produto?.unidades_conversao) ? produto.unidades_conversao : [])
    .filter((c) => c && c.ativa !== false && (direcao === 'RECEBER' ? c.uso_venda !== false : c.uso_compra !== false));

/** Fator efetivo (texto) do item: 1 para KG/L, o peso do saco, ou o da conversão (DIVIDE → 1/fator). @param {any} item */
const fatorDoItem = (item) => {
  const c = conversaoDoProduto(item.produto, item.unidade);
  if (c) return c.operacao === 'DIVIDE' ? dividirArredondar('1', String(c.fator), 4) : t(c.fator);
  return item.unidade === 'SACO' ? pesoDoSaco(item.produto) : '1';
};

/** Quantidade do item na unidade de estoque (4 casas), pela operação exata; null se não der. @param {any} item @param {string} q */
const emEstoqueDoItem = (item, q) => {
  const c = conversaoDoProduto(item.produto, item.unidade);
  if (c) return c.operacao === 'DIVIDE' ? dividirArredondar(q, String(c.fator), 4) : multiplicarArredondar(q, t(c.fator), 4);
  const fator = item.unidade === 'SACO' ? pesoDoSaco(item.produto) : '1';
  return fator ? multiplicarArredondar(q, fator, 4) : null;
};

/** O produto aceita SACO? (só com unidade principal SACO e peso por saco > 0). @param {any} produto */
export const produtoAceitaSaco = (produto) => produto?.unidade_principal_estoque === 'SACO' && pesoDoSaco(produto) !== null;

/** D-PROD-162: o produto é controlado em litros? (só ele aceita — e exige — a unidade L). @param {any} produto */
export const produtoEmLitros = (produto) => produto?.unidade_principal_estoque === 'L';

/** D-PROD-162: unidade do item ao escolher o produto (Produto em L → L; os outros → KG, como antes). @param {any} produto */
export const unidadeAoEscolherProduto = (produto) => (produtoEmLitros(produto) ? 'L' : 'KG');

// ─── Rateio POR ITEM (D-PROD-156) ────────────────────────────────────────

/** Soma do item que não fecha (o indicador da tela já mostra quanto falta/sobra). */
export const ERRO_SOMA_ITEM_VALOR = 'A soma das linhas precisa ser igual ao líquido do item';
export const ERRO_SOMA_ITEM_PERCENTUAL = 'Os percentuais deste item precisam somar exatamente 100%';

/** Linhas do rateio de UM item, pela CHAVE estável dele. @param {any} form @param {string} chave @returns {any[]} */
export const linhasDoItem = (form, chave) => {
  const linhas = form?.rateios_itens?.[chave];
  return Array.isArray(linhas) ? linhas : [];
};

/** Alguma linha por item tem algo escolhido ou digitado? (troca POR_ITEM → GERAL pede confirmação) @param {any} form */
export const temDadosPorItem = (form) =>
  (form?.itens ?? []).some((/** @type {any} */ i) =>
    linhasDoItem(form, i.chave).some((r) => r.natureza || r.centro_custo || r.centro_resultado || String(r.valor ?? '').trim() || String(r.percentual ?? '').trim()),
  );

/** O rateio geral guardado está em branco (nada escolhido nem digitado)? @param {any} form */
export const geralEmBranco = (form) =>
  (form?.rateios ?? []).every(
    (/** @type {any} */ r) => !r.natureza && !r.centro_custo && !r.centro_resultado && !String(r.valor ?? '').trim() && !String(r.percentual ?? '').trim(),
  );

/**
 * GERAL → POR_ITEM: guarda o MODO do geral (`rateio_modo_geral`), porque o
 * "Modo do rateio" do bloco por item muda o `rateio_modo` do documento.
 * @param {any} form @param {Record<string, any[]>} rateiosItens @returns {any}
 */
export const entrarNoPorItem = (form, rateiosItens) => ({
  ...form,
  rateio_escopo: 'POR_ITEM',
  rateios_itens: rateiosItens,
  rateio_modo_geral: form.rateio_escopo === 'POR_ITEM' ? form.rateio_modo_geral : form.rateio_modo,
});

/**
 * POR_ITEM → GERAL (troca de escopo ou "sem produtos"): descarta as linhas por
 * item e devolve o geral guardado no MODO em que ele estava.
 * @param {any} form @returns {any}
 */
export const voltarAoGeral = (form) => {
  const { rateio_modo_geral: modoGeral, ...resto } = form;
  return { ...resto, rateio_escopo: 'GERAL', rateios_itens: {}, rateio_modo: modoGeral ?? form.rateio_modo };
};

/**
 * Linha do corpo DOC (geral ou de um item): natureza, centros e o valor OU o
 * percentual, conforme o modo do documento.
 * @param {any} r @param {string} modo @param {string|null} percentual @param {string|null} valor
 */
const linhaDoCorpo = (r, modo, percentual, valor) => {
  /** @type {Record<string, unknown>} */
  const linha = { natureza_id: r.natureza?.id };
  if (r.centro_custo) linha.centro_custo_id = r.centro_custo.id;
  if (r.centro_resultado) linha.centro_resultado_id = r.centro_resultado.id;
  if (modo === 'PERCENTUAL') linha.percentual = percentual;
  else linha.valor = valor;
  return linha;
};

/** Item novo no fim; no POR_ITEM ele já nasce com 1 linha (vazia) de rateio. @param {any} form @param {string} tipo @returns {any} */
export const adicionarItemAoFormulario = (form, tipo) => {
  const item = itemVazio(tipo);
  const porItem = form.conteudo === 'COM_PRODUTOS' && form.rateio_escopo === 'POR_ITEM';
  const rateiosItens = form.rateios_itens ?? {};
  return { ...form, itens: [...form.itens, item], rateios_itens: porItem ? { ...rateiosItens, [item.chave]: [rateioVazio()] } : rateiosItens };
};

/** Remove o item `i` e, junto, as linhas de rateio dele. @param {any} form @param {number} i @returns {any} */
export const removerItemDoFormulario = (form, i) => {
  const chave = form.itens[i]?.chave;
  const { [chave]: _removidas, ...rateiosItens } = form.rateios_itens ?? {};
  return { ...form, itens: form.itens.filter((/** @type {any} */ _, /** @type {number} */ k) => k !== i), rateios_itens: rateiosItens };
};

/**
 * Move o item `i` uma posição (`delta` −1 sobe, +1 desce). As linhas de rateio
 * vão junto porque vivem na CHAVE do item, não no índice.
 * @param {any} form @param {number} i @param {number} delta @returns {any}
 */
export const moverItemDoFormulario = (form, i, delta) => {
  const j = i + delta;
  if (i < 0 || j < 0 || i >= form.itens.length || j >= form.itens.length) return form;
  const itens = [...form.itens];
  [itens[i], itens[j]] = [itens[j], itens[i]];
  return { ...form, itens };
};

/**
 * "Aplicar classificação a todos os itens": cada item fica com UMA linha (100%
 * automático) com a natureza e os centros escolhidos uma vez.
 * @param {any} form @param {{ natureza: any, centro_custo?: any, centro_resultado?: any }} c
 * @returns {Record<string, any[]>}
 */
export const classificacaoParaTodos = (form, { natureza, centro_custo = null, centro_resultado = null }) =>
  Object.fromEntries(form.itens.map((/** @type {any} */ i) => [i.chave, [{ ...rateioVazio(), natureza, centro_custo, centro_resultado }]]));

/**
 * GERAL → POR_ITEM, opção "usar a classificação geral": cada item recebe as
 * MESMAS naturezas e centros do geral, nas MESMAS proporções, sobre o SEU
 * líquido (maiores restos em unidades mínimas; empate → menor ordem). Só com o
 * geral completo e fechado; senão volta o motivo (e a tela oferece só
 * "começar em branco"). O geral do formulário não muda.
 * @param {any} form
 * @param {ReturnType<typeof calcularResumo>} resumo resumo do formulário no escopo GERAL
 * @param {{ locale: string, casas: number }} ctx
 * @returns {{ possivel: boolean, motivo: string|null, rateios_itens: Record<string, any[]> }}
 */
export const inicializacaoProporcional = (form, resumo, { locale, casas }) => {
  const nada = (/** @type {string} */ motivo) => ({ possivel: false, motivo, rateios_itens: {} });
  const geral = Array.isArray(form.rateios) ? form.rateios : [];
  if (!form.itens.length) return nada('Inclua os itens antes de classificar por item.');
  if (!geral.length || geral.some((/** @type {any} */ r) => !r.natureza)) return nada('O rateio geral tem linha sem natureza: complete o rateio geral ou comece em branco.');
  const copia = (/** @type {any} */ r, /** @type {Partial<{ valor: string, percentual: string }>} */ extra) => ({
    ...rateioVazio(),
    natureza: r.natureza,
    centro_custo: r.centro_custo ?? null,
    centro_resultado: r.centro_resultado ?? null,
    ...extra,
  });
  if (geral.length === 1) {
    return { possivel: true, motivo: null, rateios_itens: Object.fromEntries(form.itens.map((/** @type {any} */ i) => [i.chave, [copia(geral[0], {})]])) };
  }
  const errosGeral = Object.keys(resumo.erros).some((c) => c === 'rateio' || c.startsWith('rateios.'));
  if (form.rateio_modo === 'PERCENTUAL') {
    const pcts = resumo.rateio.percentuais;
    if (errosGeral || resumo.rateio.somaPercentual == null || comparar(resumo.rateio.somaPercentual, '100') !== 0 || pcts.some((p) => !p)) {
      return nada('O rateio geral não fecha (os percentuais precisam somar 100%): ajuste o rateio geral ou comece em branco.');
    }
    const percentuais = pcts.map((p) => paraTextoDeEdicao(/** @type {string} */ (p), locale, { casasMin: 0, casasMax: 6 }));
    return { possivel: true, motivo: null, rateios_itens: Object.fromEntries(form.itens.map((/** @type {any} */ i) => [i.chave, geral.map((/** @type {any} */ r, /** @type {number} */ j) => copia(r, { percentual: percentuais[j] }))])) };
  }
  const pesos = resumo.rateio.valores;
  if (errosGeral || !resumo.rateio.fecha || pesos.some((v) => !v)) {
    return nada('O rateio geral não fecha com o total: ajuste o rateio geral ou comece em branco.');
  }
  const liquidos = resumo.liquidos ?? [];
  if (liquidos.length !== form.itens.length || liquidos.some((l) => !l)) {
    return nada('Preencha quantidade e valor de todos os itens: o rateio proporcional é feito sobre o líquido de cada item.');
  }
  /** @type {Record<string, any[]>} */
  const rateiosItens = {};
  for (const [k, item] of form.itens.entries()) {
    const valores = distribuirProporcional({ liquido: /** @type {string} */ (liquidos[k]), pesos: /** @type {string[]} */ (pesos), casas, casasPeso: casas });
    if (!valores) return nada('Não foi possível calcular o líquido de algum item: comece em branco.');
    // Linha que ficaria com zero num item: recusar. Tirá-la calada deixaria o item
    // sem uma natureza/centro do geral e, se zerasse em todos, o valor dela iria
    // para as outras naturezas do documento (o diálogo promete as MESMAS do geral).
    const zerada = valores.findIndex((v) => !ehPositivo(v));
    if (zerada >= 0) {
      const rotulo = geral[zerada].natureza?.rotulo ? ` (${geral[zerada].natureza.rotulo})` : '';
      return nada(
        `A linha ${zerada + 1} do rateio geral${rotulo} ficaria com valor zero no item ${k + 1}: o valor dela é pequeno demais para dividir entre os itens. Comece em branco ou ajuste o rateio geral.`,
      );
    }
    rateiosItens[item.chave] = geral.map((/** @type {any} */ r, /** @type {number} */ j) => copia(r, { valor: formatarNumero(valores[j], { locale, casasMin: casas, casasMax: casas }) }));
  }
  return { possivel: true, motivo: null, rateios_itens: rateiosItens };
};

const CAMPO_DA_LINHA = /** @type {Record<string, string>} */ ({
  natureza_id: 'natureza',
  natureza_tipo: 'natureza',
  centro_custo_id: 'centro_custo',
  centro_resultado_id: 'centro_resultado',
  valor: 'valor',
  percentual: 'percentual',
});

/**
 * Campo do formulário apontado por um erro do servidor no rateio POR ITEM
 * (`details.colecao = 'itens'`, `indice`, `subcolecao = 'rateios'`, `subindice`).
 * Sem `subindice` (soma, item sem linha, limite) o alvo é o item inteiro.
 * @param {{ field?: string|null, details?: Record<string, any> }} e
 * @returns {{ indice: number, subindice: number|null, campo: string } | null}
 */
export const alvoDoErroDoRateioPorItem = ({ field = null, details = {} }) => {
  if (details?.colecao !== 'itens' || details?.subcolecao !== 'rateios' || !Number.isInteger(details.indice)) return null;
  const subindice = Number.isInteger(details.subindice) ? details.subindice : null;
  return { indice: details.indice, subindice, campo: subindice === null ? 'rateio' : CAMPO_DA_LINHA[String(field ?? details.field ?? '')] ?? 'natureza' };
};

/**
 * Confere o rateio POR ITEM: cada item sobre o SEU líquido, no modo do
 * documento. Erros em `itens.<i>.rateios.<j>.<campo>` e `itens.<i>.rateio` (o
 * índice é só o da exibição; o estado vive na chave do item).
 * @param {any} form
 * @param {Array<string|null>} liquidos
 * @param {{ locale: string, casas: number, total: string|null }} c
 * @param {Record<string, string>} erros (recebe os erros encontrados)
 */
const conferirRateioPorItem = (form, liquidos, { locale, casas, total }, erros) => {
  const DIN = { casas, inteiros: LIMITES.DINHEIRO.inteiros };
  const emPercentual = form.rateio_modo === 'PERCENTUAL';
  let totalLinhas = 0;
  const porItem = form.itens.map((/** @type {any} */ item, /** @type {number} */ k) => {
    const linhas = linhasDoItem(form, item.chave);
    totalLinhas += linhas.length;
    const base = `itens.${k}`;
    const liquido = liquidos[k] ?? null;
    const umaLinha = linhas.length === 1;
    /** @type {Array<string|null>} */
    let valores = linhas.map(() => null);
    /** @type {Array<string|null>} */
    let percentuais = linhas.map(() => null);
    /** @type {Array<string|null>} */
    let percentuaisInformativos = linhas.map(() => null);
    /** @type {string|null} */
    let diferenca = null;
    /** @type {string|null} */
    let somaPercentual = null;
    let fecha = false;
    if (emPercentual) {
      percentuais = linhas.map((r, j) => {
        if (umaLinha) return '100';
        const p = lerCampo(r.percentual, locale, LIMITES.PERCENTUAL, { obrigatorio: true, positivo: true });
        if (!p.erro && p.valor && comparar(p.valor, '100') > 0) p.erro = 'No máximo 100%';
        if (p.erro) erros[`${base}.rateios.${j}.percentual`] = p.erro;
        return p.erro ? null : p.valor;
      });
      somaPercentual = linhas.length && percentuais.every((p) => p) ? somar(percentuais, 6) : null;
      if (somaPercentual && comparar(somaPercentual, '100') !== 0) erros[`${base}.rateio`] = ERRO_SOMA_ITEM_PERCENTUAL;
      else if (somaPercentual && liquido) {
        const r = ratearPercentual(liquido, percentuais, casas);
        valores = r.valores;
        fecha = r.fecha100 && r.linhasZeradas.length === 0;
        if (r.fecha100) diferenca = subtrair(liquido, somar(r.valores, casas), casas);
        for (const j of r.linhasZeradas) erros[`${base}.rateios.${j}.percentual`] = 'Esta linha ficaria com valor zero';
      }
    } else {
      valores = linhas.map((r, j) => {
        if (umaLinha) return liquido;
        const v = lerCampo(r.valor, locale, DIN, { obrigatorio: true, positivo: true });
        if (v.erro) erros[`${base}.rateios.${j}.valor`] = v.erro;
        return v.erro || !v.valor ? null : naEscala(v.valor, casas);
      });
      if (liquido && linhas.length && valores.every((v) => v)) {
        diferenca = subtrair(liquido, somar(valores, casas), casas);
        fecha = comparar(diferenca, '0') === 0;
        if (!fecha) erros[`${base}.rateio`] = ERRO_SOMA_ITEM_VALOR;
        percentuaisInformativos = valores.map((v) => percentualDe(/** @type {string} */ (v), liquido, casas, 2));
      }
    }
    linhas.forEach((r, j) => {
      if (!r.natureza) erros[`${base}.rateios.${j}.natureza`] = 'Escolha a natureza';
    });
    /** @type {Map<string, number>} */
    const vistos = new Map();
    linhas.forEach((r, j) => {
      if (!r.natureza) return;
      const chave = `${r.natureza.id}|${r.centro_custo?.id ?? ''}|${r.centro_resultado?.id ?? ''}`;
      const anterior = vistos.get(chave);
      if (anterior !== undefined) erros[`${base}.rateios.${j}.natureza`] = `Linha repetida (igual à linha ${anterior + 1})`;
      else vistos.set(chave, j);
    });
    if (!linhas.length) erros[`${base}.rateio`] = 'Inclua pelo menos uma linha de rateio neste item';
    else if (linhas.length > MAX_RATEIOS_POR_ITEM) erros[`${base}.rateio`] = `No máximo ${MAX_RATEIOS_POR_ITEM} linhas de rateio por item`;
    const comErro = Object.keys(erros).some((c) => c === `${base}.rateio` || c.startsWith(`${base}.rateios.`));
    return { chave: /** @type {string} */ (item.chave), liquido, valores, percentuais, percentuaisInformativos, diferenca, somaPercentual, fecha: fecha && !comErro };
  });
  if (totalLinhas > MAX_RATEIOS_ITENS_TOTAL) erros.rateio_itens = `No máximo ${MAX_RATEIOS_ITENS_TOTAL} linhas de rateio somando todos os itens`;
  const todos = porItem.flatMap((/** @type {any} */ i) => i.valores);
  const diferencaTotal = total && todos.length && todos.every((/** @type {string|null} */ v) => v) ? subtrair(total, somar(todos, casas), casas) : null;
  /** @type {Array<{ chave: string, item: number|null, linha: number|null, mensagem: string }>} */
  const problemas = [];
  porItem.forEach((/** @type {any} */ _, /** @type {number} */ k) => {
    const base = `itens.${k}`;
    const daLinha = Object.keys(erros)
      .filter((c) => c.startsWith(`${base}.rateios.`))
      .map((c) => ({ chave: c, item: k, linha: Number(c.split('.')[3]), mensagem: erros[c] }))
      .sort((a, b) => a.linha - b.linha);
    problemas.push(...daLinha);
    if (erros[`${base}.rateio`]) problemas.push({ chave: `${base}.rateio`, item: k, linha: null, mensagem: erros[`${base}.rateio`] });
  });
  if (erros.rateio_itens) problemas.push({ chave: 'rateio_itens', item: null, linha: null, mensagem: erros.rateio_itens });
  const fecha = porItem.length > 0 && porItem.every((/** @type {any} */ i) => i.fecha) && !erros.rateio_itens && diferencaTotal !== null && comparar(diferencaTotal, '0') === 0;
  return { porItem, totalLinhas, diferencaTotal, fecha, problemas };
};

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
      const conversao = conversaoDoProduto(item.produto, item.unidade);
      if (item.unidade === 'SACO' && !conversao && !produtoAceitaSaco(item.produto)) e.unidade = 'Este produto não é controlado em sacos';
      if (item.unidade !== 'KG' && item.unidade !== 'SACO' && item.unidade !== 'L' && !conversao) e.unidade = 'Use KG ou uma unidade do cadastro do produto';
      // D-PROD-162: Produto em L só com item L; item L só com Produto em L (o servidor confere igual).
      else if (produtoEmLitros(item.produto) && item.unidade !== 'L' && !conversao) e.unidade = 'Este produto é controlado em litros (L)';
      else if (!produtoEmLitros(item.produto) && item.unidade === 'L') e.unidade = 'Use KG ou SACO';
      if (q.valor && !q.erro) {
        // fator 1 para KG e para L (a quantidade em estoque fica em litros); SACO usa o peso do saco; D-PROD-288: as
        // unidades de conversão multiplicam ou dividem (a mesma conta do servidor).
        const emEstoque = emEstoqueDoItem(item, q.valor);
        if (emEstoque) {
          kg = emEstoque;
          if (!ehPositivo(kg)) e.quantidade = item.unidade === 'L' ? 'A quantidade em L ficaria zero' : 'A quantidade em kg ficaria zero';
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
  // O líquido de cada item é também a BASE do rateio por item (D-PROD-156).
  /** @type {Array<string|null>} */
  const liquidos = itens.map(() => null);
  if (comProdutos && totalValido && itens.length && itens.every((i) => i.subtotal && ehPositivo(i.subtotal))) {
    const rateio = ratearCabecalho({
      direcao: form.direcao,
      casas,
      valor_desconto: desconto,
      valor_acrescimo: acrescimo,
      itens: itens.map((i, k) => ({ ordem: k + 1, tipo_item: form.itens[k]?.tipo_item, valor_total: /** @type {string} */ (i.subtotal), quantidade_estoque: form.itens[k]?.tipo_item === 'MERCADORIA' ? i.kg : null })),
    });
    rateio?.itens.forEach((ri, k) => {
      if (ehPositivo(ri.valor_liquido)) liquidos[k] = ri.valor_liquido;
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

  // Rateio GERAL (sempre sobre o TOTAL, depois de desconto e acréscimo). No
  // escopo POR_ITEM (D-PROD-156) o geral fica guardado no formulário, mas não é
  // conferido nem enviado: cada item é conferido sobre o SEU líquido.
  const porItem = comProdutos && form.rateio_escopo === 'POR_ITEM';
  /** @type {Array<string|null>} */
  let valoresRateio = [];
  /** @type {string|null} */
  let diferencaRateio = null;
  /** @type {string|null} */
  let somaPercentual = null;
  let rateioFecha = false;
  /** @type {Array<string|null>} */
  let percentuais = [];
  /** @type {ReturnType<typeof conferirRateioPorItem>|null} */
  let rateioItens = null;
  if (porItem) {
    rateioItens = conferirRateioPorItem(form, liquidos, { locale, casas, total: totalValido ? total : null }, erros);
  } else {
    const umaLinha = form.rateios.length === 1;
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
  }

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
    liquidos,
    rateioItens,
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
  const porItem = comProdutos && form.rateio_escopo === 'POR_ITEM';
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
      // POR_ITEM: as linhas do item vão aninhadas nele (o servidor associa pela
      // ordem do item na MESMA requisição — nunca por índice de outra coleção).
      if (porItem) {
        const conferido = resumo.rateioItens?.porItem[i];
        linha.rateios = linhasDoItem(form, item.chave).map((/** @type {any} */ r, /** @type {number} */ j) =>
          linhaDoCorpo(r, form.rateio_modo, conferido?.percentuais[j] ?? null, conferido?.valores[j] ?? null),
        );
      }
      return linha;
    });
  }
  // Sempre explícito: o servidor grava o escopo (ausente = GERAL nos clientes antigos).
  doc.rateio_escopo = porItem ? 'POR_ITEM' : 'GERAL';
  doc.rateio_modo = form.rateio_modo;
  doc.rateios = porItem
    ? []
    : form.rateios.map((/** @type {any} */ r, /** @type {number} */ i) => linhaDoCorpo(r, form.rateio_modo, resumo.rateio.percentuais[i] ?? null, resumo.rateio.valores[i] ?? null));
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
