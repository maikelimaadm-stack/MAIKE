/**
 * Estoque → Entradas (D-PROD-257): regras PURAS do formulário e rótulos. Sem rede e sem aritmética de ponto flutuante:
 * decimais são TEXTO (lidos com `lerNumeroLocal`, que nunca arredonda). O servidor repete todas as regras (e é quem
 * bloqueia de fato); aqui elas só evitam a ida e a volta e dizem ao usuário o que falta.
 */
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { lerNumeroLocal } from '@/lib/dinheiroDecimal';
import { formatarDia, formatarQtd, formatarReais } from '@/lib/estoqueConsultaRegras';

export const LOCALE_ENTRADA = 'pt-BR';
export const LIMITES_ENTRADA = Object.freeze({ inteiros: 10, casas: 4 });

export const MOTIVO_IMPLANTACAO = 'SALDO_IMPLANTACAO';
export const MOTIVO_DOACAO = 'DOACAO';
export const MOTIVO_OUTRA = 'OUTRA_COM_JUSTIFICATIVA';

/** Os três motivos FECHADOS (D-PROD-177). Não há "Compra" nem "Ajuste de inventário". */
export const MOTIVOS_ENTRADA = Object.freeze([
  { value: MOTIVO_IMPLANTACAO, label: 'Saldo de implantação', ajuda: 'Estoque que já existia quando o produto passou a ser controlado aqui.' },
  { value: MOTIVO_DOACAO, label: 'Doação', ajuda: 'Recebimento sem compra e sem pagamento.' },
  { value: MOTIVO_OUTRA, label: 'Outra, com justificativa', ajuda: 'Caso raro, fora dos anteriores. Exige a justificativa.' },
]);
export const ROTULO_MOTIVO = Object.freeze(/** @type {Record<string, string>} */ (Object.fromEntries(MOTIVOS_ENTRADA.map((m) => [m.value, m.label]))));
export const ROTULO_STATUS_ENTRADA = Object.freeze({ CONFIRMADA: 'Confirmada', EXCLUIDA: 'Excluída' });
export const OPCOES_STATUS_ENTRADA = Object.freeze([
  { value: '', label: 'Todas as situações' },
  { value: 'CONFIRMADA', label: 'Confirmadas' },
  { value: 'EXCLUIDA', label: 'Excluídas' },
]);
export const OPCOES_MOTIVO_ENTRADA = Object.freeze([{ value: '', label: 'Todos os motivos' }, ...MOTIVOS_ENTRADA.map((m) => ({ value: m.value, label: m.label }))]);

export const JUSTIFICATIVA_MINIMA_OUTRA = 20;
export const JUSTIFICATIVA_MINIMA_CUSTO_ZERO = 10;
export const MOTIVO_ACAO_MINIMO = 3;

/** @param {string} hoje AAAA-MM-DD */
export const formularioVazioEntrada = (hoje) => ({
  motivo: MOTIVO_IMPLANTACAO,
  produto: /** @type {null | { id: string, rotulo: string, unidade_estoque: string, peso_por_saco_kg: string|null }} */ (null),
  deposito: /** @type {null | { id: string, rotulo: string }} */ (null),
  unidade: '',
  quantidade: '',
  custo: '',
  custo_zero: false,
  data_entrada: hoje,
  documento_numero: '',
  observacao: '',
  justificativa: '',
});

/** Unidades que o produto aceita: litros para produto em L; quilo (e saco, se tiver peso) para os demais. @param {{ unidade_estoque?: string, peso_por_saco_kg?: string|null }|null} produto */
export const unidadesDoProduto = (produto) => {
  if (!produto) return [];
  if (produto.unidade_estoque === 'L') return [{ value: 'L', label: 'Litros (L)' }];
  const unidades = [{ value: 'KG', label: 'Quilos (kg)' }];
  if (produto.peso_por_saco_kg && produto.peso_por_saco_kg !== '0.0000') unidades.push({ value: 'SACO', label: 'Sacos' });
  return unidades;
};

/** Ao escolher o produto, a unidade vira a de estoque dele (a única, ou o quilo). @param {any} form @param {any} produto */
export const comProduto = (form, produto) => {
  const unidades = unidadesDoProduto(produto);
  const manter = unidades.some((u) => u.value === form.unidade);
  return { ...form, produto, unidade: manter ? form.unidade : (unidades[0]?.value ?? '') };
};

/** Justificativa obrigatória? (e o mínimo): "outra" sempre; custo zero fora da doação. @param {any} form */
export const justificativaExigida = (form) => {
  if (form.motivo === MOTIVO_OUTRA) return JUSTIFICATIVA_MINIMA_OUTRA;
  if (form.custo_zero && form.motivo !== MOTIVO_DOACAO) return JUSTIFICATIVA_MINIMA_CUSTO_ZERO;
  return 0;
};

/** @param {string} texto */
const lerDecimal = (texto) => lerNumeroLocal(texto, LOCALE_ENTRADA, LIMITES_ENTRADA);
const tamanho = (/** @type {string} */ t) => [...String(t ?? '').trim()].length;

/**
 * Confere o formulário. `{ erros, ok }`: `erros` por campo (`produto`, `deposito`, `quantidade`, `custo`, `data_entrada`,
 * `justificativa`), em português. @param {any} form @param {string} hoje
 */
export const validarFormularioEntrada = (form, hoje) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form.produto?.id) erros.produto = 'Escolha o produto.';
  if (!form.deposito?.id) erros.deposito = 'Escolha o depósito.';
  if (!form.unidade) erros.unidade = 'Escolha a unidade.';
  const quantidade = lerDecimal(form.quantidade);
  if (!quantidade.ok) erros.quantidade = quantidade.motivo === 'vazio' ? 'Informe a quantidade.' : 'Quantidade inválida (até 4 casas decimais).';
  else if (/^0(\.0*)?$/.test(quantidade.valor)) erros.quantidade = 'A quantidade deve ser maior que zero.';
  if (form.custo_zero) {
    if (tamanho(form.custo) && lerDecimal(form.custo).ok && !/^0(\.0*)?$/.test(/** @type {any} */ (lerDecimal(form.custo)).valor)) erros.custo = 'Desmarque "Custo zero" ou deixe o custo vazio.';
  } else {
    const custo = lerDecimal(form.custo);
    if (!custo.ok) erros.custo = custo.motivo === 'vazio' ? 'Informe o custo ou marque "Custo zero".' : 'Custo inválido (até 4 casas decimais).';
    else if (/^0(\.0*)?$/.test(custo.valor)) erros.custo = 'Custo zero só com "Custo zero" marcado.';
  }
  if (!form.data_entrada) erros.data_entrada = 'Informe a data.';
  else if (form.data_entrada > hoje) erros.data_entrada = 'A data não pode ser posterior a hoje.';
  const minimo = justificativaExigida(form);
  if (minimo && tamanho(form.justificativa) < minimo) erros.justificativa = `Informe a justificativa (ao menos ${minimo} caracteres).`;
  return { erros, ok: Object.keys(erros).length === 0 };
};

/** Corpo do POST (decimais como TEXTO canônico). @param {string} empresaId @param {any} form @param {string} operationId */
export const montarCorpoEntrada = (empresaId, form, operationId) => {
  const quantidade = /** @type {any} */ (lerDecimal(form.quantidade)).valor;
  const custo = form.custo_zero ? '0' : /** @type {any} */ (lerDecimal(form.custo)).valor;
  const texto = (/** @type {string} */ t) => (tamanho(t) ? String(t).trim() : null);
  return {
    empresa_id: empresaId,
    operation_id: operationId,
    motivo: form.motivo,
    data_entrada: form.data_entrada,
    documento_numero: texto(form.documento_numero),
    observacao: texto(form.observacao),
    justificativa: texto(form.justificativa),
    itens: [{ produto_id: form.produto.id, local_estoque_id: form.deposito.id, unidade: form.unidade, quantidade, custo_unitario: custo, ...(form.custo_zero ? { custo_zero: true } : {}) }],
  };
};

/** `operation_id` estável enquanto o conteúdo é o mesmo (reenvio sem resposta = replay), novo quando muda. */
export const chaveDeOperacao = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? `ent-${crypto.randomUUID()}` : `ent-${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ─── apresentação ───────────────────────────────────────────────────────────

/** "Ureia" ou "Ureia +2". @param {any} e */
export const produtosDaEntrada = (e) => {
  const itens = Array.isArray(e?.itens) && e.itens.length ? e.itens : Array.isArray(e?.itens_historico) ? e.itens_historico : [];
  if (!itens.length) return '';
  return itens.length === 1 ? String(itens[0].produto_nome ?? '') : `${itens[0].produto_nome ?? ''} +${itens.length - 1}`;
};

/** Itens da entrada (os vigentes; a excluída mostra os do histórico). @param {any} e */
const itensParaMostrar = (e) => (Array.isArray(e?.itens) && e.itens.length ? e.itens : Array.isArray(e?.itens_historico) ? e.itens_historico : []);

/** @param {any} e */
export const quantidadeDaEntrada = (e) => {
  const itens = itensParaMostrar(e);
  if (!itens.length) return '';
  if (itens.length > 1) return `${itens.length} itens`;
  return formatarQtd(itens[0].quantidade_estoque, itens[0].unidade_estoque);
};

/** @param {any} e */
export const depositoDaEntrada = (e) => {
  const nomes = [...new Set(itensParaMostrar(e).map((/** @type {any} */ i) => i.local_estoque_nome).filter(Boolean))];
  return nomes.length > 1 ? `${nomes[0]} +${nomes.length - 1}` : String(nomes[0] ?? '');
};

/** Valor total da entrada (soma dos itens), em reais, sem float: só com um item; vários mostram "–". @param {any} e */
export const valorDaEntrada = (e) => {
  const itens = itensParaMostrar(e);
  return itens.length === 1 ? formatarReais(itens[0].valor_total) : '';
};

/** @param {any} item @param {string} id */
export const valorDoCampoEntrada = (item, id) => {
  if (id === 'data') return formatarDia(item.data_entrada);
  if (id === 'numero') return String(item.numero ?? '');
  if (id === 'produto') return produtosDaEntrada(item);
  if (id === 'deposito') return depositoDaEntrada(item);
  if (id === 'quantidade') return quantidadeDaEntrada(item);
  if (id === 'valor') return valorDaEntrada(item);
  if (id === 'motivo') return ROTULO_MOTIVO[item.motivo] ?? String(item.motivo ?? '');
  if (id === 'documento') return String(item.documento_numero ?? '');
  if (id === 'situacao') return item.status === 'EXCLUIDA' ? 'Excluída' : item.revisao > 1 ? 'Editada' : 'Confirmada';
  return '';
};

/** @param {any} item */
export const textoBuscaEntrada = (item) =>
  [item.numero, produtosDaEntrada(item), depositoDaEntrada(item), ROTULO_MOTIVO[item.motivo], item.documento_numero].filter(Boolean).join(' ');

const NADA = 'Nada foi gravado.';

/** Quando a recusa foi a de uma regra de dependência da exclusão (`details.reason`). */
const DEPENDENCIA = /** @type {Record<string, string>} */ ({
  camada_consumida: 'O estoque desta entrada já foi usado (venda, abastecimento, atividade, transferência ou suplementação).',
  consumo_estornado: 'O estoque desta entrada já foi usado em uma baixa que depois foi cancelada.',
  camada_citada_em_baixa: 'O estoque desta entrada já aparece em uma baixa.',
  custo_reavaliado: 'O custo do estoque deste produto já foi recalculado por uma baixa.',
  prova_indeterminada: 'Há movimentos demais para provar que este estoque nunca foi usado.',
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
      if (reason === 'peso_por_saco_ausente') return `O produto não tem o peso do saco cadastrado: informe em quilos. ${NADA}`;
      if (reason === 'unidade_incompativel') return `A unidade escolhida não combina com o estoque do produto. ${NADA}`;
      if (reason === 'data_futura') return `A data da entrada é posterior a hoje na fazenda. ${NADA}`;
      if (reason === 'justificativa_obrigatoria') return `A justificativa é obrigatória em "Outra" (ao menos ${JUSTIFICATIVA_MINIMA_OUTRA} caracteres). ${NADA}`;
      if (reason === 'produto_inativo') return `O produto está inativo. ${NADA}`;
      if (reason === 'produto_inexistente') return `O produto não existe nesta fazenda. ${NADA}`;
      if (reason === 'nada_a_alterar') return 'Nada mudou na observação nem na justificativa.';
      return `A entrada foi recusada (${field ?? 'dados inválidos'}). ${NADA}`;
    case 'ENTRADA_ESTOQUE_CUSTO_ZERO':
      return `Custo zero só com "Custo zero" marcado e, fora da doação, com a justificativa. ${NADA}`;
    case 'ENTRADA_ESTOQUE_MOTIVO_IMUTAVEL':
      return 'O motivo da entrada nunca muda: exclua a entrada e lance outra. Nada foi alterado.';
    case 'ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO':
      if (reason === 'implantacao_ativa') return `Este produto já tem uma implantação ativa: corrija-a (exclua) em vez de lançar outra. ${NADA}`;
      return `O saldo de implantação só vale para produto sem histórico de estoque, e este produto já teve movimento. Para entrada de produto com histórico, use "Doação" ou "Outra". ${NADA}`;
    case 'ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS':
      return `${DEPENDENCIA[String(reason)] ?? 'O estoque desta entrada não se prova intocado.'} A entrada não pode ser excluída. Nada foi alterado.`;
    case 'ENTRADA_ESTOQUE_STATUS_INVALIDO':
      return 'Esta entrada já foi excluída. Nada foi alterado.';
    case 'ENTRADA_ESTOQUE_VERSAO_CONFLITO':
      return 'A entrada mudou desde que foi aberta. Feche e abra de novo. Nada foi alterado.';
    case 'ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE':
      if (reason === 'documento_de_compra' || reason === 'documento_de_venda') {
        return `Este documento já está em um lançamento ${reason === 'documento_de_venda' ? 'de venda' : 'de compra'}: a mercadoria entra por ele, não por entrada manual. ${NADA}`;
      }
      return `Já existe uma entrada confirmada com este documento. ${NADA}`;
    case 'ENTRADA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA':
      return 'Só a observação e a justificativa se editam. Para mudar data, produto, quantidade, custo ou depósito, exclua a entrada e lance outra.';
    case 'OPERACAO_VALORES_INVALIDOS':
      if (reason === 'custo_negativo') return `O custo não pode ser negativo. ${NADA}`;
      if (reason === 'valor_excede_limite_estoque') return `A quantidade ou o valor passa do limite do estoque. ${NADA}`;
      return `Quantidade ou custo inválidos. ${NADA}`;
    case 'ESTOQUE_LOCAL_INVALIDO':
      return `O depósito não existe mais ou está inativo. ${NADA}`;
    case 'EMPRESA_FUSO_NAO_CONFIGURADO':
      return `O fuso horário da fazenda não está configurado (Empresa). ${NADA}`;
    case 'IDEMPOTENCY_CONFLICT':
      return `Esta operação já foi enviada com outro conteúdo. Feche a janela e abra de novo. ${NADA}`;
    default:
      return getApiErrorMessage(erro, padrao);
  }
};
