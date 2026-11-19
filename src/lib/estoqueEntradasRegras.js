/**
 * Estoque → Novo movimento (D-PROD-257, D-PROD-259): regras PURAS do formulário da Entrada e da Transferência, e os
 * rótulos. Sem rede e sem aritmética de ponto flutuante: decimais são TEXTO (lidos com `lerNumeroLocal`, que nunca
 * arredonda; contas em BigInt por `dinheiroDecimal`). O servidor repete todas as regras (e é quem bloqueia de fato);
 * aqui elas só evitam a ida e a volta e dizem ao usuário o que falta.
 *
 * D-PROD-259: o motivo vem do CADASTRO de motivos (natureza SALDO_IMPLANTACAO ou ENTRADA); a entrada tem cabeçalho
 * (data, motivo, fornecedor, documento, centros, observação) e VÁRIOS produtos (produto, unidade, depósito,
 * quantidade, valor unitário, valor total, lote, validade). O saldo de implantação não tem fornecedor nem documento.
 */
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { deUnidades, lerNumeroLocal, multiplicarArredondar, paraUnidades } from '@/lib/dinheiroDecimal';
import { formatarDia, formatarQtd, formatarReais } from '@/lib/estoqueConsultaRegras';

export const LOCALE_ENTRADA = 'pt-BR';
export const LIMITES_ENTRADA = Object.freeze({ inteiros: 10, casas: 4 });
export const LIMITES_TOTAL = Object.freeze({ inteiros: 14, casas: 4 });
export const MAX_ITENS_ENTRADA = 50;
export const TAMANHO_LOTE = 64;

/** As 2 naturezas do motivo (o nome vem do cadastro). */
export const MOTIVO_IMPLANTACAO = 'SALDO_IMPLANTACAO';
export const MOTIVO_ENTRADA = 'ENTRADA';
export const ROTULO_NATUREZA = Object.freeze({ [MOTIVO_IMPLANTACAO]: 'Saldo de implantação', [MOTIVO_ENTRADA]: 'Entrada' });

/** Os tipos do "Novo movimento" desta versão. */
export const TIPO_ENTRADA = 'entrada';
export const TIPO_TRANSFERENCIA = 'transferencia';
export const TIPOS_DE_MOVIMENTO = Object.freeze([
  { value: TIPO_ENTRADA, label: 'Entrada' },
  { value: TIPO_TRANSFERENCIA, label: 'Transferência' },
]);

export const ROTULO_STATUS_ENTRADA = Object.freeze({ CONFIRMADA: 'Confirmada', EXCLUIDA: 'Excluída' });
export const MOTIVO_ACAO_MINIMO = 3;

let sequenciaDeLinha = 0;
/** Uma linha de produto vazia (a `chave` é só da tela, para o React). */
export const linhaVaziaEntrada = () => ({
  chave: `l${++sequenciaDeLinha}`,
  produto: /** @type {null | { id: string, rotulo: string, unidade_estoque: string, peso_por_saco_kg: string|null }} */ (null),
  deposito: /** @type {null | { id: string, rotulo: string }} */ (null),
  unidade: '',
  quantidade: '',
  custo: '',
  total: '',
  custo_zero: false,
  lote: '',
  validade: '',
});

/** @param {string} hoje AAAA-MM-DD */
export const formularioVazioEntrada = (hoje) => ({
  motivo: /** @type {null | { id: string, nome: string, natureza: string }} */ (null),
  data_entrada: hoje,
  fornecedor: /** @type {null | { id: string, rotulo: string }} */ (null),
  documento_numero: '',
  centro_custo: /** @type {null | { id: string, rotulo: string }} */ (null),
  centro_resultado: /** @type {null | { id: string, rotulo: string }} */ (null),
  observacao: '',
  itens: [linhaVaziaEntrada()],
});

/** A entrada é saldo de implantação? (sem fornecedor nem documento). @param {any} form */
export const ehImplantacao = (form) => form?.motivo?.natureza === MOTIVO_IMPLANTACAO;

/** Unidades que o produto aceita: litros para produto em L; quilo (e saco, se tiver peso) para os demais. @param {{ unidade_estoque?: string, peso_por_saco_kg?: string|null }|null} produto */
export const unidadesDoProduto = (produto) => {
  if (!produto) return [];
  if (produto.unidade_estoque === 'L') return [{ value: 'L', label: 'Litros (L)' }];
  const unidades = [{ value: 'KG', label: 'Quilos (kg)' }];
  if (produto.peso_por_saco_kg && produto.peso_por_saco_kg !== '0.0000') unidades.push({ value: 'SACO', label: 'Sacos' });
  return unidades;
};

/** Ao escolher o produto, a unidade vira a de estoque dele (a única, ou o quilo). @param {any} linha @param {any} produto */
export const comProduto = (linha, produto) => {
  const unidades = unidadesDoProduto(produto);
  const manter = unidades.some((u) => u.value === linha.unidade);
  return { ...linha, produto, unidade: manter ? linha.unidade : (unidades[0]?.value ?? '') };
};

/** @param {string} texto */
const lerDecimal = (texto) => lerNumeroLocal(texto, LOCALE_ENTRADA, LIMITES_ENTRADA);
/** @param {string} texto */
const lerTotal = (texto) => lerNumeroLocal(texto, LOCALE_ENTRADA, LIMITES_TOTAL);
const tamanho = (/** @type {string} */ t) => [...String(t ?? '').trim()].length;
const ehZeroCanonico = (/** @type {string} */ v) => /^0(\.0*)?$/.test(v);
const ehDiaIso = (/** @type {string} */ v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));

/** a ÷ b com `casas` decimais, arredondado HALF_UP, em BigInt. @param {string} a @param {string} b @param {number} casas */
export const dividirArredondar = (a, b, casas) => {
  const ua = paraUnidades(a, 8);
  const ub = paraUnidades(b, 8);
  if (ub === 0n) throw new RangeError('divisao_por_zero');
  const escala = 10n ** BigInt(casas);
  const num = ua * escala * 2n;
  const q = num / ub;
  return deUnidades((q + (q >= 0n ? 1n : -1n)) / 2n, casas);
};

/** Formata um canônico para o campo de edição (vírgula decimal, sem zeros à direita). @param {string} canonico */
const paraCampo = (canonico) => {
  const [i, f = ''] = String(canonico).split('.');
  const fracao = f.replace(/0+$/, '');
  return fracao ? `${i},${fracao}` : i;
};

/**
 * Digitou a quantidade ou o valor unitário: o total é recalculado (quantidade × unitário, 2 casas). Digitou o total:
 * o unitário é recalculado (total ÷ quantidade, 4 casas). Sem um dos dois, o outro fica como está.
 * @param {any} linha @param {'quantidade'|'custo'|'total'} campo @param {string} valor
 */
export const comValor = (linha, campo, valor) => {
  const nova = { ...linha, [campo]: valor };
  if (nova.custo_zero) return { ...nova, custo: '', total: '' };
  const q = lerDecimal(nova.quantidade);
  if (campo === 'total') {
    const t = lerTotal(nova.total);
    if (q.ok && t.ok && !ehZeroCanonico(q.valor)) nova.custo = paraCampo(dividirArredondar(t.valor, q.valor, 4));
    return nova;
  }
  const c = lerDecimal(nova.custo);
  if (q.ok && c.ok) nova.total = paraCampo(multiplicarArredondar(q.valor, c.valor, 2));
  return nova;
};

/**
 * Confere o formulário. `{ erros, ok }`: `erros` do cabeçalho por campo (`motivo`, `data_entrada`, `fornecedor`,
 * `documento_numero`, `itens`) e de cada linha como `itens.<i>.<campo>`, em português. @param {any} form @param {string} hoje
 */
export const validarFormularioEntrada = (form, hoje) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form.motivo?.id) erros.motivo = 'Escolha o motivo da entrada.';
  if (!form.data_entrada) erros.data_entrada = 'Informe a data.';
  else if (form.data_entrada > hoje) erros.data_entrada = 'A data não pode ser posterior a hoje.';
  if (ehImplantacao(form)) {
    if (form.fornecedor?.id) erros.fornecedor = 'O saldo de implantação não tem fornecedor.';
    if (tamanho(form.documento_numero)) erros.documento_numero = 'O saldo de implantação não tem documento.';
  }
  const itens = Array.isArray(form.itens) ? form.itens : [];
  if (!itens.length) erros.itens = 'Inclua ao menos um produto.';
  if (itens.length > MAX_ITENS_ENTRADA) erros.itens = `No máximo ${MAX_ITENS_ENTRADA} produtos por entrada.`;
  const pares = new Map();
  itens.forEach((/** @type {any} */ l, i) => {
    const p = `itens.${i}.`;
    if (!l.produto?.id) erros[`${p}produto`] = 'Escolha o produto.';
    if (!l.deposito?.id) erros[`${p}deposito`] = 'Escolha o depósito.';
    if (!l.unidade) erros[`${p}unidade`] = 'Escolha a unidade.';
    const quantidade = lerDecimal(l.quantidade);
    if (!quantidade.ok) erros[`${p}quantidade`] = quantidade.motivo === 'vazio' ? 'Informe a quantidade.' : 'Quantidade inválida (até 4 casas decimais).';
    else if (ehZeroCanonico(quantidade.valor)) erros[`${p}quantidade`] = 'A quantidade deve ser maior que zero.';
    if (!l.custo_zero) {
      const custo = lerDecimal(l.custo);
      if (!custo.ok) erros[`${p}custo`] = custo.motivo === 'vazio' ? 'Informe o valor unitário ou marque "Sem custo".' : 'Valor inválido (até 4 casas decimais).';
      else if (ehZeroCanonico(custo.valor)) erros[`${p}custo`] = 'Valor zero só com "Sem custo" marcado.';
    }
    if (tamanho(l.lote) > TAMANHO_LOTE) erros[`${p}lote`] = `No máximo ${TAMANHO_LOTE} caracteres.`;
    if (l.validade && !ehDiaIso(l.validade)) erros[`${p}validade`] = 'Data de validade inválida.';
    if (l.produto?.id && l.deposito?.id) {
      const chave = `${l.produto.id}|${l.deposito.id}`;
      if (pares.has(chave)) erros[`${p}produto`] = 'Este produto já está neste depósito em outra linha: some as quantidades.';
      pares.set(chave, i);
    }
  });
  return { erros, ok: Object.keys(erros).length === 0 };
};

/** Corpo do POST (decimais como TEXTO canônico). @param {string} empresaId @param {any} form @param {string} operationId */
export const montarCorpoEntrada = (empresaId, form, operationId) => {
  const texto = (/** @type {string} */ t) => (tamanho(t) ? String(t).trim() : null);
  const implantacao = ehImplantacao(form);
  return {
    empresa_id: empresaId,
    operation_id: operationId,
    motivo_id: form.motivo.id,
    data_entrada: form.data_entrada,
    fornecedor_id: implantacao ? null : (form.fornecedor?.id ?? null),
    documento_numero: implantacao ? null : texto(form.documento_numero),
    centro_custo_id: form.centro_custo?.id ?? null,
    centro_resultado_id: form.centro_resultado?.id ?? null,
    observacao: texto(form.observacao),
    itens: form.itens.map((/** @type {any} */ l) => ({
      produto_id: l.produto.id,
      local_estoque_id: l.deposito.id,
      unidade: l.unidade,
      quantidade: /** @type {any} */ (lerDecimal(l.quantidade)).valor,
      custo_unitario: l.custo_zero ? '0' : /** @type {any} */ (lerDecimal(l.custo)).valor,
      ...(l.custo_zero ? { custo_zero: true } : {}),
      lote_fabricante: texto(l.lote),
      data_validade: l.validade || null,
    })),
  };
};

/** `operation_id` estável enquanto o conteúdo é o mesmo (reenvio sem resposta = replay), novo quando muda. @param {string} [prefixo] */
export const chaveDeOperacao = (prefixo = 'ent') =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? `${prefixo}-${crypto.randomUUID()}` : `${prefixo}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ─── transferência ─────────────────────────────────────────────────────────

/** @param {string} hoje */
export const formularioVazioTransferencia = (hoje) => ({
  data: hoje,
  produto: /** @type {null | { id: string, rotulo: string, unidade_estoque: string }} */ (null),
  origem: /** @type {null | { id: string, rotulo: string }} */ (null),
  destino: /** @type {null | { id: string, rotulo: string }} */ (null),
  quantidade: '',
  observacao: '',
});

/** @param {any} form @param {string} hoje */
export const validarTransferencia = (form, hoje) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form.data) erros.data = 'Informe a data.';
  else if (form.data > hoje) erros.data = 'A data não pode ser posterior a hoje.';
  if (!form.produto?.id) erros.produto = 'Escolha o produto.';
  if (!form.origem?.id) erros.origem = 'Escolha o depósito de origem.';
  if (!form.destino?.id) erros.destino = 'Escolha o depósito de destino.';
  else if (form.origem?.id && form.origem.id === form.destino.id) erros.destino = 'O destino tem de ser outro depósito.';
  const q = lerDecimal(form.quantidade);
  if (!q.ok) erros.quantidade = q.motivo === 'vazio' ? 'Informe a quantidade.' : 'Quantidade inválida (até 4 casas decimais).';
  else if (ehZeroCanonico(q.valor)) erros.quantidade = 'A quantidade deve ser maior que zero.';
  return { erros, ok: Object.keys(erros).length === 0 };
};

/** Dados do comando (a quantidade vai como número: o comando de transferência recebe número). @param {any} form @param {string} operationId */
export const dadosDaTransferencia = (form, operationId) => ({
  operationId,
  produtoId: form.produto.id,
  origemId: form.origem.id,
  destinoId: form.destino.id,
  quantidade: Number(/** @type {any} */ (lerDecimal(form.quantidade)).valor),
  data: form.data || null,
  observacao: tamanho(form.observacao) ? String(form.observacao).trim() : null,
});

// ─── apresentação ───────────────────────────────────────────────────────────

/** Itens da entrada (os vigentes; a excluída mostra os do histórico). @param {any} e */
export const itensParaMostrar = (e) => (Array.isArray(e?.itens) && e.itens.length ? e.itens : Array.isArray(e?.itens_historico) ? e.itens_historico : []);

/** Nome do motivo (do cadastro) ou, sem ele, a natureza. @param {any} e */
export const rotuloDoMotivo = (e) => String(e?.motivo_nome ?? ROTULO_NATUREZA[/** @type {keyof typeof ROTULO_NATUREZA} */ (e?.motivo)] ?? e?.motivo ?? '');

/** @param {any} e */
export const valorTotalDaEntrada = (e) => {
  const itens = itensParaMostrar(e);
  if (!itens.length) return '';
  try {
    const soma = itens.reduce((/** @type {bigint} */ s, /** @type {any} */ i) => s + paraUnidades(i.valor_total ?? '0', 4), 0n);
    return formatarReais(deUnidades(soma, 4));
  } catch {
    return '';
  }
};

/** @param {any} item */
export const quantidadeDoItem = (item) => formatarQtd(item.quantidade_estoque, item.unidade_estoque);
/** @param {string|null|undefined} dia */
export const formatarValidade = (dia) => (dia ? formatarDia(dia) : '');

const NADA = 'Nada foi gravado.';

/** Quando a recusa foi a de uma regra de dependência da exclusão (`details.reason`). */
const DEPENDENCIA = /** @type {Record<string, string>} */ ({
  camada_consumida: 'O estoque desta entrada já foi usado (venda, abastecimento, atividade, transferência ou suplementação).',
  consumo_estornado: 'O estoque desta entrada já foi usado em uma baixa que depois foi cancelada.',
  camada_citada_em_baixa: 'O estoque desta entrada já aparece em uma baixa.',
  custo_reavaliado: 'O custo do estoque deste produto já foi recalculado por uma baixa.',
  prova_indeterminada: 'Há movimentos demais para provar que este estoque nunca foi usado.',
});

/** Recusas de campo da entrada (`details.reason`). */
const INVALIDA = /** @type {Record<string, string>} */ ({
  peso_por_saco_ausente: 'O produto não tem o peso do saco cadastrado: informe em quilos.',
  unidade_incompativel: 'A unidade escolhida não combina com o estoque do produto.',
  data_futura: 'A data da entrada é posterior a hoje na fazenda.',
  produto_inativo: 'O produto está inativo.',
  produto_inexistente: 'O produto não existe nesta fazenda.',
  motivo_inexistente: 'O motivo não existe mais. Escolha outro.',
  motivo_inativo: 'O motivo está inativo. Escolha outro ou reative-o em "Motivos".',
  fornecedor_inexistente: 'O fornecedor não existe nesta fazenda.',
  fornecedor_inativo: 'O fornecedor está inativo.',
  fornecedor_sem_papel: 'O parceiro escolhido não tem o papel de fornecedor.',
  centro_custo_inexistente: 'O centro de custo não existe nesta fazenda.',
  centro_custo_inativo: 'O centro de custo está inativo.',
  centro_resultado_inexistente: 'O centro de resultado não existe nesta fazenda.',
  centro_resultado_inativo: 'O centro de resultado está inativo.',
  implantacao_sem_fornecedor: 'O saldo de implantação não tem fornecedor.',
  implantacao_sem_documento: 'O saldo de implantação não tem documento.',
  par_duplicado: 'O mesmo produto aparece duas vezes no mesmo depósito: some as quantidades.',
});

/**
 * Mensagem em português de um erro das Entradas, pelo CÓDIGO do servidor (a `message` do servidor nunca é exibida).
 * @param {unknown} erro @param {string} padrao
 */
export const mensagemErroEntrada = (erro, padrao) => {
  const { code, field, reason } = lerErroGestao(erro);
  switch (code) {
    case 'ENTRADA_ESTOQUE_NOT_FOUND':
      return 'Entrada não encontrada nesta fazenda. A lista será atualizada.';
    case 'ENTRADA_ESTOQUE_INVALIDA':
      if (reason === 'nada_a_alterar') return 'Nada mudou na observação.';
      return `${INVALIDA[String(reason)] ?? `A entrada foi recusada (${field ?? 'dados inválidos'}).`} ${NADA}`;
    case 'ENTRADA_ESTOQUE_CUSTO_ZERO':
      return `Valor zero só com "Sem custo" marcado. ${NADA}`;
    case 'ENTRADA_ESTOQUE_MOTIVO_IMUTAVEL':
      return 'O motivo da entrada nunca muda: exclua a entrada e lance outra. Nada foi alterado.';
    case 'ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO':
      if (reason === 'implantacao_ativa') return `Este produto já tem uma implantação ativa: corrija-a (exclua) em vez de lançar outra. ${NADA}`;
      return `O saldo de implantação só vale para produto sem histórico de estoque, e este produto já teve movimento. Use outro motivo (Compra, Doação…). ${NADA}`;
    case 'ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS':
      return `${DEPENDENCIA[String(reason)] ?? 'O estoque desta entrada não se prova intocado.'} A entrada não pode ser excluída. Nada foi alterado.`;
    case 'ENTRADA_ESTOQUE_STATUS_INVALIDO':
      return 'Esta entrada já foi excluída. Nada foi alterado.';
    case 'ENTRADA_ESTOQUE_VERSAO_CONFLITO':
      return 'A entrada mudou desde que foi aberta. Feche e abra de novo. Nada foi alterado.';
    case 'ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE':
      if (reason === 'documento_de_compra' || reason === 'documento_de_venda') {
        return `Este documento já está em um lançamento ${reason === 'documento_de_venda' ? 'de venda' : 'de compra'} com produtos: a mercadoria entra por ele, não por entrada manual. ${NADA}`;
      }
      return `Já existe uma entrada confirmada com este documento. ${NADA}`;
    case 'ENTRADA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA':
      return 'Só a observação se edita. Para mudar o resto, exclua a entrada e lance outra.';
    case 'MOTIVO_ENTRADA_DUPLICADO':
      return `Já existe um motivo com este nome. ${NADA}`;
    case 'MOTIVO_ENTRADA_PADRAO_FIXO':
      return 'O motivo "Saldo de implantação" é fixo: não se renomeia nem se desativa.';
    case 'MOTIVO_ENTRADA_NOT_FOUND':
      return 'Motivo não encontrado. A lista será atualizada.';
    case 'OPERACAO_VALORES_INVALIDOS':
      if (reason === 'custo_negativo') return `O valor não pode ser negativo. ${NADA}`;
      if (reason === 'valor_excede_limite_estoque') return `A quantidade ou o valor passa do limite do estoque. ${NADA}`;
      return `Quantidade ou valor inválidos. ${NADA}`;
    case 'ESTOQUE_LOCAL_INVALIDO':
      return `O depósito não existe mais ou está inativo. ${NADA}`;
    case 'ESTOQUE_SALDO_INSUFICIENTE':
      return `Não há saldo suficiente deste produto no depósito de origem. ${NADA}`;
    case 'EMPRESA_FUSO_NAO_CONFIGURADO':
      return `O fuso horário da fazenda não está configurado (Empresa). ${NADA}`;
    case 'IDEMPOTENCY_CONFLICT':
      return `Esta operação já foi enviada com outro conteúdo. Feche a janela e abra de novo. ${NADA}`;
    default:
      return getApiErrorMessage(erro, padrao);
  }
};
