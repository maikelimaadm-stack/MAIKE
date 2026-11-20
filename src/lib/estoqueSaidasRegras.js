/**
 * Estoque → Novo movimento → Saída (D-PROD-264): regras PURAS do formulário da saída manual e as mensagens. Sem
 * rede e sem ponto flutuante: a quantidade é TEXTO (lida com `lerNumeroLocal`, que nunca arredonda).
 *
 * Escolhas do proprietário: o motivo vem do CADASTRO de motivos de saída (padrões Perda, Consumo interno, Doação,
 * Vencimento; o usuário cria, renomeia e desativa); NÃO se digita valor (o servidor valoriza pelo custo médio do
 * depósito); excluir só se o produto não teve outro movimento naquele depósito depois; editar só a observação.
 * O servidor repete todas as regras e é quem bloqueia de fato.
 */
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { lerNumeroLocal } from '@/lib/dinheiroDecimal';
import { formatarQtd } from '@/lib/estoqueConsultaRegras';
import { LIMITES_ENTRADA, LOCALE_ENTRADA } from '@/lib/estoqueEntradasRegras';

export const MAX_ITENS_SAIDA = 50;
export const ROTULO_STATUS_SAIDA = Object.freeze({ CONFIRMADA: 'Confirmada', EXCLUIDA: 'Excluída' });

let sequenciaDeLinha = 0;
/** Uma linha de produto vazia da saída (a `chave` é só da tela, para o React). */
export const linhaVaziaSaida = () => ({
  chave: `s${++sequenciaDeLinha}`,
  produto: /** @type {null | { id: string, rotulo: string, unidade_estoque: string, peso_por_saco_kg: string|null }} */ (null),
  deposito: /** @type {null | { id: string, rotulo: string }} */ (null),
  unidade: '',
  quantidade: '',
});

/** @param {string} hoje AAAA-MM-DD */
export const formularioVazioSaida = (hoje) => ({
  motivo: /** @type {null | { id: string, nome: string }} */ (null),
  data_saida: hoje,
  centro_custo: /** @type {null | { id: string, rotulo: string }} */ (null),
  centro_resultado: /** @type {null | { id: string, rotulo: string }} */ (null),
  observacao: '',
  itens: [linhaVaziaSaida()],
});

/** @param {string} texto */
const lerDecimal = (texto) => lerNumeroLocal(texto, LOCALE_ENTRADA, LIMITES_ENTRADA);
const tamanho = (/** @type {string} */ t) => [...String(t ?? '').trim()].length;
const ehZeroCanonico = (/** @type {string} */ v) => /^0(\.0*)?$/.test(v);

/**
 * Confere o formulário. `{ erros, ok }`: `erros` do cabeçalho por campo (`motivo`, `data_saida`, `itens`) e de cada
 * linha como `itens.<i>.<campo>`, em português. @param {any} form @param {string} hoje
 */
export const validarFormularioSaida = (form, hoje) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!form.motivo?.id) erros.motivo = 'Escolha o motivo da saída.';
  if (!form.data_saida) erros.data_saida = 'Informe a data.';
  else if (form.data_saida > hoje) erros.data_saida = 'A data não pode ser posterior a hoje.';
  const itens = Array.isArray(form.itens) ? form.itens : [];
  if (!itens.length) erros.itens = 'Inclua ao menos um produto.';
  if (itens.length > MAX_ITENS_SAIDA) erros.itens = `No máximo ${MAX_ITENS_SAIDA} produtos por saída.`;
  const pares = new Map();
  itens.forEach((/** @type {any} */ l, i) => {
    const p = `itens.${i}.`;
    if (!l.produto?.id) erros[`${p}produto`] = 'Escolha o produto.';
    if (!l.deposito?.id) erros[`${p}deposito`] = 'Escolha o depósito.';
    if (!l.unidade) erros[`${p}unidade`] = 'Escolha a unidade.';
    const quantidade = lerDecimal(l.quantidade);
    if (!quantidade.ok) erros[`${p}quantidade`] = quantidade.motivo === 'vazio' ? 'Informe a quantidade.' : 'Quantidade inválida (até 4 casas decimais).';
    else if (ehZeroCanonico(quantidade.valor)) erros[`${p}quantidade`] = 'A quantidade deve ser maior que zero.';
    if (l.produto?.id && l.deposito?.id) {
      const chave = `${l.produto.id}|${l.deposito.id}`;
      if (pares.has(chave)) erros[`${p}produto`] = 'Este produto já está neste depósito em outra linha: some as quantidades.';
      pares.set(chave, i);
    }
  });
  return { erros, ok: Object.keys(erros).length === 0 };
};

/** Corpo do POST (quantidade como TEXTO canônico; sem valor: o servidor usa o custo médio). @param {string} empresaId @param {any} form @param {string} operationId */
export const montarCorpoSaida = (empresaId, form, operationId) => ({
  empresa_id: empresaId,
  operation_id: operationId,
  motivo_id: form.motivo.id,
  data_saida: form.data_saida,
  centro_custo_id: form.centro_custo?.id ?? null,
  centro_resultado_id: form.centro_resultado?.id ?? null,
  observacao: tamanho(form.observacao) ? String(form.observacao).trim() : null,
  itens: form.itens.map((/** @type {any} */ l) => ({
    produto_id: l.produto.id,
    local_estoque_id: l.deposito.id,
    unidade: l.unidade,
    quantidade: /** @type {any} */ (lerDecimal(l.quantidade)).valor,
  })),
});

// ─── apresentação ───────────────────────────────────────────────────────────

/** Quantidade baixada de uma linha, na unidade de estoque do produto. @param {any} item */
export const quantidadeDaLinhaSaida = (item) => formatarQtd(item?.quantidade_estoque, item?.unidade_estoque);

/** Id da saída de um movimento do Kardex, quando o movimento é dela (pelo documento ou pela origem). @param {any} m */
export const saidaDoMovimento = (m) => {
  if (m?.documento?.tipo === 'SAIDA_ESTOQUE' && m.documento.id) return { id: String(m.documento.id), numero: String(m.documento.numero ?? ''), rotulo: String(m.documento.rotulo ?? '') };
  if (m?.origem_sistema === 'saida_estoque' && typeof m.lancamento_origem_id === 'string' && m.lancamento_origem_id) {
    return { id: m.lancamento_origem_id, numero: '', rotulo: 'Saída manual' };
  }
  return null;
};

// ─── mensagens ──────────────────────────────────────────────────────────────

const NADA = 'Nada foi gravado.';

/** Recusas de campo da saída (`details.reason`). */
const INVALIDA = /** @type {Record<string, string>} */ ({
  motivo_inexistente: 'O motivo não existe mais. Escolha outro.',
  motivo_inativo: 'O motivo está inativo. Escolha outro ou reative-o em "Motivos".',
  produto_inexistente: 'O produto não existe nesta fazenda.',
  produto_inativo: 'O produto está inativo.',
  unidade_incompativel: 'A unidade escolhida não combina com o estoque do produto.',
  peso_por_saco_ausente: 'O produto não tem o peso do saco cadastrado: informe em quilos.',
  par_duplicado: 'O mesmo produto aparece duas vezes no mesmo depósito: some as quantidades.',
  quantidade_zero: 'A quantidade deve ser maior que zero.',
  data_futura: 'A data da saída é posterior a hoje na fazenda.',
  centro_custo_inexistente: 'O centro de custo não existe nesta fazenda.',
  centro_custo_inativo: 'O centro de custo está inativo.',
  centro_resultado_inexistente: 'O centro de resultado não existe nesta fazenda.',
  centro_resultado_inativo: 'O centro de resultado está inativo.',
});

/**
 * "linha 2 (Ureia em Galpão insumos)" a partir de `details.indice` (0-based) ou `details.item_ordem` (1-based)
 * e das linhas do formulário. @param {Record<string, any>} details @param {any[]} itens
 */
const naLinha = (details, itens) => {
  const indice = Number.isInteger(details.indice) ? details.indice : Number.isInteger(details.item_ordem) ? details.item_ordem - 1 : null;
  if (indice == null) return { linha: '', unidade: undefined };
  const l = itens[indice];
  const nomes = [l?.produto?.rotulo, l?.deposito?.rotulo].filter(Boolean);
  const unidade = l?.produto?.unidade_estoque === 'L' ? 'L' : l?.produto ? 'KG' : undefined;
  return { linha: `linha ${indice + 1}${nomes.length === 2 ? ` (${nomes[0]} em ${nomes[1]})` : nomes.length ? ` (${nomes[0]})` : ''}`, unidade };
};

/**
 * Mensagem em português de um erro das Saídas, pelo CÓDIGO do servidor (a `message` do servidor nunca é exibida).
 * `itens` são as linhas do formulário, para dizer qual linha foi recusada.
 * @param {unknown} erro @param {string} padrao @param {any[]} [itens]
 */
export const mensagemErroSaida = (erro, padrao, itens = []) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  const onde = naLinha(details, itens);
  switch (code) {
    case 'SAIDA_ESTOQUE_NOT_FOUND':
      return 'Saída não encontrada nesta fazenda. A lista será atualizada.';
    case 'SAIDA_ESTOQUE_INVALIDA':
      if (reason === 'nada_a_alterar') return 'Nada mudou na observação.';
      return `${INVALIDA[String(reason)] ?? `A saída foi recusada (${field ?? 'dados inválidos'}).`}${onde.linha ? ` Na ${onde.linha}.` : ''} ${NADA}`;
    case 'ESTOQUE_SALDO_INSUFICIENTE': {
      const disponivel = details.disponivel ?? details.estoque_atual;
      const valores = disponivel != null
        ? `: disponível ${formatarQtd(String(disponivel), onde.unidade ?? 'KG')}${details.solicitado != null ? `, pedido ${formatarQtd(String(details.solicitado), onde.unidade ?? 'KG')}` : ''}`
        : '';
      return `Não há saldo suficiente ${onde.linha ? `na ${onde.linha}` : 'no depósito'}${valores}. ${NADA}`;
    }
    case 'SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR':
      return 'O produto já teve outro movimento neste depósito depois desta saída: ela não pode ser excluída. Para corrigir, lance uma entrada. Nada foi alterado.';
    case 'SAIDA_ESTOQUE_STATUS_INVALIDO':
      return 'Esta saída já foi excluída. Nada foi alterado.';
    case 'SAIDA_ESTOQUE_VERSAO_CONFLITO':
      return 'A saída mudou desde que foi aberta. Feche e abra de novo. Nada foi alterado.';
    case 'SAIDA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA':
      return 'Só a observação se edita. Para mudar o resto, exclua a saída e lance outra.';
    case 'MOTIVO_SAIDA_DUPLICADO':
      return `Já existe um motivo de saída com este nome. ${NADA}`;
    case 'MOTIVO_SAIDA_NOT_FOUND':
      return 'Motivo não encontrado. A lista será atualizada.';
    case 'REQUEST_VALIDATION_FAILED':
      if (reason === 'nada_a_alterar') return 'Nada mudou no motivo.';
      return getApiErrorMessage(erro, padrao);
    case 'OPERACAO_VALORES_INVALIDOS':
      if (reason === 'valor_excede_limite_estoque') return `A quantidade passa do limite do estoque. ${NADA}`;
      return `Quantidade inválida. ${NADA}`;
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
