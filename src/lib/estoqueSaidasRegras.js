/**
 * Estoque → Novo movimento → Saída (D-PROD-264): regras PURAS do formulário da saída manual e as mensagens. Sem
 * rede e sem ponto flutuante: a quantidade é TEXTO (lida com `lerNumeroLocal`, que nunca arredonda).
 *
 * Escolhas do proprietário: o motivo vem do CADASTRO de motivos de saída (padrões Perda, Consumo interno, Doação,
 * Vencimento; o usuário cria, renomeia e desativa); NÃO se digita valor (o servidor valoriza pelo custo médio do
 * depósito); excluir só se o produto não teve outro movimento naquele depósito depois.
 * D-PROD-271: editar a observação sozinha, ou a edição completa (o mesmo formulário preenchido com a versão vigente,
 * `formularioDaSaida`; o corpo da criação + `versao` e `motivo_edicao`, `montarCorpoEdicaoSaida`), que o servidor só
 * aceita se o produto não teve outro movimento naquele depósito depois.
 * O servidor repete todas as regras e é quem bloqueia de fato.
 */
import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { lerErroGestao } from '@/lib/gestaoErros';
import { lerNumeroLocal } from '@/lib/dinheiroDecimal';
import { formatarQtd } from '@/lib/estoqueConsultaRegras';
import { LIMITES_ENTRADA, LOCALE_ENTRADA, paraCampo } from '@/lib/estoqueEntradasRegras';
import { mensagemRecusaRecalculo } from '@/lib/estoqueRecalculoExclusao';
import { corpoDosLotes } from './estoqueLotesRegras.js';

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
    // D-PROD-279: produto com lote — a escolha tem de fechar e o lote vencido, ser confirmado.
    if (l.produto?.controla_lote && l.erroLote) erros[`${p}lotes`] = l.erroLote;
    else if (l.produto?.controla_lote && l.loteVencido && !l.confirmaVencido) erros[`${p}lotes`] = 'Confirme o uso do lote vencido.';
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
    ...corpoDosLotes(l), // D-PROD-279: só com escolha manual (sem ela, FEFO no servidor)
  })),
});

// ─── edição completa (D-PROD-271) ──────────────────────────────────────────

/** @param {any} id @param {any} nome */
const opcaoOuNada = (id, nome) => (id ? { id: String(id), rotulo: String(nome ?? '') } : null);

/**
 * D-PROD-271 — o formulário da Saída preenchido com a versão VIGENTE (o detalhe do servidor), para a edição
 * completa. A quantidade canônica vira texto de campo ("50.0000" → "50"); o produto em saco traz o peso do saco
 * pelo fator da linha.
 * @param {any} s detalhe da saída
 */
export const formularioDaSaida = (s) => {
  const itens = (Array.isArray(s?.itens) ? s.itens : []).map((/** @type {any} */ i) => ({
    ...linhaVaziaSaida(),
    produto: { id: String(i.produto_id), rotulo: String(i.produto_nome ?? ''), unidade_estoque: i.unidade_estoque === 'L' ? 'L' : 'KG', peso_por_saco_kg: i.unidade === 'SACO' ? (i.fator_kg ?? null) : null },
    deposito: { id: String(i.local_estoque_id), rotulo: String(i.local_estoque_nome ?? '') },
    unidade: String(i.unidade ?? ''),
    quantidade: i.quantidade != null ? paraCampo(i.quantidade) : '',
  }));
  return {
    motivo: s?.motivo_id ? { id: String(s.motivo_id), nome: String(s.motivo_nome ?? '') } : null,
    data_saida: String(s?.data_saida ?? ''),
    centro_custo: opcaoOuNada(s?.centro_custo_id, s?.centro_custo_nome),
    centro_resultado: opcaoOuNada(s?.centro_resultado_id, s?.centro_resultado_nome),
    observacao: String(s?.observacao ?? ''),
    itens: itens.length ? itens : [linhaVaziaSaida()],
  };
};

/**
 * D-PROD-271 — corpo do PATCH de SUBSTITUIÇÃO da saída: o MESMO corpo da criação (`montarCorpoSaida`) + a versão
 * lida e o motivo da edição.
 * @param {string} empresaId @param {any} form @param {{ versao: number, motivoEdicao: string }} edicao @param {string} operationId
 */
export const montarCorpoEdicaoSaida = (empresaId, form, edicao, operationId) => ({
  ...montarCorpoSaida(empresaId, form, operationId),
  versao: edicao.versao,
  motivo_edicao: String(edicao.motivoEdicao ?? '').trim(),
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
  const recalculo = mensagemRecusaRecalculo(erro);
  if (recalculo) return recalculo;
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

/**
 * D-PROD-271 — mensagem em português de uma recusa da EDIÇÃO COMPLETA da saída (pelo código; a `message` do servidor
 * nunca aparece). `itens` são as linhas do formulário (a versão nova: saldo insuficiente, linha recusada) e
 * `vigentes` as da versão que estava sendo editada (para dizer onde houve movimento depois).
 * @param {unknown} erro @param {string} padrao @param {any[]} [itens] @param {any[]} [vigentes]
 */
export const mensagemErroEdicaoSaida = (erro, padrao, itens = [], vigentes = []) => {
  const { code, reason, details } = lerErroGestao(erro);
  switch (code) {
    case 'SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR': {
      if (reason === 'fatias_ausentes') return 'Não dá para editar: não foi possível saber de quais lotes esta saída baixou. Os lançamentos não foram refeitos. Nada foi alterado.';
      const ordem = Number.isInteger(details.item_ordem) ? details.item_ordem : null;
      const linha = vigentes.find((i) => (details.produto_id && i?.produto_id === details.produto_id && (!details.local_estoque_id || i?.local_estoque_id === details.local_estoque_id)))
        ?? (ordem != null ? (vigentes.find((i) => i?.ordem === ordem) ?? vigentes[ordem - 1]) : null);
      const produto = linha?.produto_nome ? `o produto ${linha.produto_nome}` : 'o produto';
      const deposito = linha?.local_estoque_nome ? `no depósito ${linha.local_estoque_nome}` : 'no depósito';
      const numero = details.movimento_numero != null && details.movimento_numero !== '' ? ` (movimento nº ${details.movimento_numero})` : '';
      return `Não dá para editar: ${produto} teve outro movimento ${deposito} depois desta saída${numero}. Para corrigir, lance uma entrada. Nada foi alterado.`;
    }
    case 'SAIDA_ESTOQUE_INVALIDA':
      if (reason === 'nada_a_alterar') return 'Nada mudou na saída: altere algum campo antes de salvar.';
      return mensagemErroSaida(erro, padrao, itens);
    case 'SAIDA_ESTOQUE_STATUS_INVALIDO':
      return 'Esta saída não pode mais ser editada (já foi excluída). Nada foi alterado.';
    case 'SAIDA_ESTOQUE_VERSAO_CONFLITO':
      return 'A saída mudou desde que foi aberta (outra edição ou exclusão). Feche e abra de novo. Nada foi alterado.';
    case 'IDEMPOTENCY_CONFLICT':
      return 'Esta edição já foi enviada com outro conteúdo. Feche a janela e abra de novo. Nada foi alterado.';
    default:
      return mensagemErroSaida(erro, padrao, itens);
  }
};
