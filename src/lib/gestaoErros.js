/**
 * Mensagens em português dos erros dos cadastros de Gestão Rural (D-PROD-146).
 *
 * O transporte nativo (`nativeHttpClient`) só preserva códigos catalogados; os
 * códigos novos de Gestão viajam no corpo do servidor, guardado em `erro.cause`
 * (não enumerável, nunca exibido cru). Aqui lemos SÓ `code`, `field`, `reason` e
 * `details` — a `message` do servidor continua descartada.
 *
 * O errorHandler do servidor sobe `field` e `reason` ao topo do corpo quando os
 * dois existem; senão ficam em `details`. Aceitamos os dois lugares.
 */

import { getApiErrorMessage } from '@/apis/_core/ApiError';
import { formatarMoeda, formatarNumero } from '@/lib/dinheiroDecimal';
import { formatarDia } from '@/lib/diaCivil';

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} erro
 * @returns {{ code: string|null, field: string|null, reason: string|null, details: Record<string, any> }}
 */
export const lerErroGestao = (erro) => {
  const e = /** @type {any} */ (erro);
  const causa = ehObjeto(e?.cause) ? e.cause : {};
  const detalhesCausa = ehObjeto(causa.details) ? causa.details : {};
  const detalhesErro = ehObjeto(e?.details) ? e.details : {};
  const details = { ...detalhesErro, ...detalhesCausa };
  const code = typeof causa.code === 'string' ? causa.code : typeof e?.code === 'string' ? e.code : null;
  const field = [causa.field, detalhesCausa.field, detalhesErro.field].find((v) => typeof v === 'string') ?? null;
  const reason = [causa.reason, detalhesCausa.reason, detalhesErro.reason].find((v) => typeof v === 'string') ?? null;
  return { code, field, reason, details };
};

const ROTULO_DOCUMENTO = /** @type {Record<string, string>} */ ({ cpf: 'CPF', cnpj: 'CNPJ' });

const HIERARQUIA = /** @type {Record<string, string>} */ ({
  ciclo: 'O centro escolhido como pai está abaixo deste centro na hierarquia (formaria um ciclo).',
  profundidade_maxima: 'A hierarquia ultrapassaria o número máximo de níveis permitido.',
  pai_inativo: 'O centro escolhido como pai está inativo. Escolha um pai ativo.',
  pai_fora_da_empresa: 'O centro escolhido como pai não pertence a esta empresa (ou não existe mais).',
  autorreferencia: 'Um centro não pode ser pai de si mesmo.',
});

const HIERARQUIA_NATUREZA = /** @type {Record<string, string>} */ ({
  ciclo: 'A natureza escolhida como pai está abaixo desta natureza na hierarquia (formaria um ciclo).',
  profundidade_maxima: 'A hierarquia ultrapassaria o número máximo de níveis permitido.',
  pai_inativo: 'A natureza escolhida como pai está inativa. Escolha um pai ativo.',
  pai_fora_da_empresa: 'A natureza escolhida como pai não pertence a esta empresa (ou não existe mais).',
  pai_de_outro_tipo: 'A natureza pai precisa ser do mesmo tipo (Receita com Receita, Despesa com Despesa).',
  autorreferencia: 'Uma natureza não pode ser pai de si mesma.',
});

// ─── D-PROD-154 — Central Única de Lançamentos ───────────────────────────

const COLECAO = /** @type {Record<string, string>} */ ({ itens: 'dos itens', rateios: 'do rateio', parcelas: 'das parcelas' });

/** " (linha 2 dos itens)" a partir de `details.colecao` + `details.indice` (0-based). @param {Record<string, any>} details */
const ondeNaLinha = (details) => {
  const indice = Number.isInteger(details.indice) ? details.indice : Number.isInteger(details.item_ordem) ? details.item_ordem - 1 : null;
  if (indice == null) return '';
  const colecao = COLECAO[String(details.colecao ?? (details.item_ordem != null ? 'itens' : ''))] ?? '';
  return ` (linha ${indice + 1}${colecao ? ` ${colecao}` : ''})`;
};

/**
 * Formatação dos valores que o servidor manda em `details` (string canônica).
 * `comandoIdempotente`: a tela reenvia com o MESMO `operation_id` (Central de
 * Lançamentos) — só então a mensagem promete que a repetição não duplica.
 * @typedef {{ locale?: string, moeda?: string, casas?: number, comandoIdempotente?: boolean }} ContextoMoeda
 */
/** @param {unknown} v @param {ContextoMoeda} c */
const dinheiro = (v, c) => (typeof v === 'string' && v ? (c.moeda ? formatarMoeda(v, { locale: c.locale, moeda: c.moeda, casas: c.casas ?? 2 }) : formatarNumero(v, { locale: c.locale, casasMin: 0, casasMax: 4 })) : '');
/** @param {unknown} v @param {ContextoMoeda} c */
const kg = (v, c) => (typeof v === 'string' && v ? `${formatarNumero(v, { locale: c.locale, casasMin: 0, casasMax: 4 })} kg` : '');

const REFERENCIA_INVALIDA = /** @type {Record<string, string>} */ ({
  parceiro_nao_encontrado: 'O parceiro escolhido não existe mais nesta empresa. Escolha outro.',
  parceiro_inativo: 'O parceiro escolhido está inativo. Reative-o em Parceiros ou escolha outro.',
  parceiro_sem_papel: 'O parceiro escolhido não tem o papel exigido (a pagar: fornecedor ou prestador de serviço; a receber: cliente).',
  natureza_nao_encontrada: 'A natureza escolhida não existe mais nesta empresa. Escolha outra.',
  natureza_inativa: 'A natureza escolhida está inativa. Escolha uma natureza ativa.',
  natureza_tipo_incompativel: 'A natureza precisa ser de Despesa (a pagar) ou de Receita (a receber).',
  natureza_sintetica: 'A natureza escolhida tem naturezas filhas: escolha uma natureza do último nível (analítica).',
  centro_custo_nao_encontrado: 'O centro de custo escolhido não existe mais nesta empresa. Escolha outro.',
  centro_custo_inativo: 'O centro de custo escolhido está inativo. Escolha um ativo.',
  centro_resultado_nao_encontrado: 'O centro de resultado escolhido não existe mais nesta empresa. Escolha outro.',
  centro_resultado_inativo: 'O centro de resultado escolhido está inativo. Escolha um ativo.',
  produto_nao_encontrado: 'O produto escolhido não existe mais nesta empresa. Escolha outro.',
  produto_inativo: 'O produto escolhido está inativo. Escolha um produto ativo.',
  unidade_invalida: 'Unidade inválida para o produto: use KG, ou SACO só quando o produto é controlado em sacos com peso por saco.',
  local_nao_encontrado: 'O local de estoque escolhido não existe mais. Escolha outro.',
  local_inativo: 'O local de estoque escolhido está inativo. Escolha um local ativo.',
  metodo_nao_permitido: 'Forma de pagamento não permitida pelo perfil financeiro da empresa (Pix só existe no Brasil com Real).',
});

const PARCELAS_INVALIDAS = /** @type {Record<string, string>} */ ({
  soma_diferente: 'A soma das parcelas é diferente do total do lançamento.',
  quantidade_invalida: 'Quantidade de parcelas inválida: à vista e a prazo têm 1 parcela; parcelado tem de 2 a 120.',
  vencimento_invalido: 'Vencimento inválido: à vista vence na emissão; os demais vencem na emissão ou depois, em ordem.',
  valor_invalido: 'Toda parcela precisa ter valor maior que zero.',
});

const VALORES_INVALIDOS = /** @type {Record<string, string>} */ ({
  valor_excede_limite: 'Valor acima do limite permitido para lançamentos (99.999.999.999.999,9999).',
  valor_excede_limite_estoque: 'Para mercadoria, quantidade em kg, custo e valor têm o limite do estoque (9.999.999.999,9999). Divida em mais lançamentos.',
  item_valor_zero: 'Há item com valor total zero: confira quantidade e valor unitário.',
  total_nao_positivo: 'O total do lançamento precisa ser maior que zero (confira desconto e acréscimo).',
  quantidade_estoque_zero: 'A quantidade em kg do item ficaria zero depois da conversão. Aumente a quantidade.',
});

const VALIDACAO = /** @type {Record<string, string>} */ ({
  casas_decimais_excedidas: 'Valor com mais casas decimais do que a moeda da empresa permite. Nada foi arredondado nem gravado.',
  moeda_nao_suportada: 'Moeda fora do catálogo do sistema.',
  pais_nao_suportado: 'País fora do catálogo do sistema.',
  locale_nao_suportado: 'Idioma/formato fora do catálogo do sistema.',
  valor_deve_ser_texto: 'Valor enviado em formato inválido. Recarregue a página e tente de novo.',
  tipo_invalido: 'Dado enviado em formato inválido. Recarregue a página e tente de novo.',
  declaracao_obrigatoria: 'Confirme que a mercadoria já foi recebida/entregue antes de gravar.',
  data_invalida: 'Data inválida: use um dia real do calendário.',
  obrigatorio: 'Há campo obrigatório sem preencher.',
  itens_obrigatorios: 'Lançamento com produtos precisa de pelo menos um item.',
  itens_nao_permitidos: 'Lançamento sem produtos não aceita itens.',
  valor_bruto_so_sem_produtos: 'O valor digitado só existe no lançamento sem produtos (com produtos, o valor é a soma dos itens).',
  nao_permitido_sem_mercadoria: 'A data operacional só existe quando há mercadoria.',
  nao_permitido_em_servico: 'Serviço não leva produto nem local de estoque.',
  baixa_no_ato_so_avista: 'A baixa no ato só existe para lançamento à vista.',
  quantidade_nao_positiva: 'A quantidade precisa ser maior que zero.',
  valor_nao_positivo: 'O valor precisa ser maior que zero.',
  tamanho_excedido: 'Texto maior que o permitido.',
});

/**
 * Mensagem dos códigos da Central de Lançamentos (null = não é desta tela).
 * @param {string|null} code @param {string|null} field @param {string|null} reason @param {Record<string, any>} details
 * @param {ContextoMoeda} c
 * @returns {string|null}
 */
const mensagemLancamento = (code, field, reason, details, c) => {
  const linha = ondeNaLinha(details);
  switch (code) {
    case 'OPERACAO_FINANCEIRA_NOT_FOUND':
      return 'Lançamento não encontrado nesta empresa. A lista será atualizada.';
    case 'TITULO_FINANCEIRO_NOT_FOUND':
      return 'Parcela não encontrada neste lançamento. Recarregue o lançamento.';
    case 'LIQUIDACAO_FINANCEIRA_NOT_FOUND':
      return 'Baixa não encontrada neste lançamento. Recarregue o lançamento.';
    case 'PERFIL_FINANCEIRO_NAO_CONFIGURADO':
      return 'Configure o perfil financeiro da empresa (país, moeda e formato) antes de lançar. Nada foi gravado.';
    case 'PERFIL_FINANCEIRO_MOEDA_EM_USO':
      return reason === 'estoque_legado_brl'
        ? 'A moeda precisa continuar BRL: esta empresa tem estoque com custo registrado em reais. País e formato podem mudar. Nada foi gravado.'
        : 'A moeda não pode ser trocada: esta empresa já tem lançamentos. País e formato podem mudar. Nada foi gravado.';
    case 'OPERACAO_STATUS_INVALIDO':
      return 'Este lançamento mudou de situação (já foi confirmado, cancelado ou descartado). Recarregue e confira. Nada foi gravado.';
    case 'OPERACAO_VERSAO_CONFLITO':
      return 'O rascunho foi alterado em outro lugar (outra pessoa ou outra aba). Recarregue o lançamento e refaça a alteração. Nada foi gravado.';
    case 'OPERACAO_DOCUMENTO_DUPLICADO':
      return 'Já existe um lançamento confirmado com este número de documento para este parceiro e direção. Confira antes de confirmar de novo. Nada foi gravado.';
    case 'OPERACAO_RATEIO_INVALIDO':
      if (reason === 'soma_diferente' && details.esperado != null) {
        return `O rateio não fecha com o total: esperado ${dinheiro(details.esperado, c)}, informado ${dinheiro(details.informado, c)} (diferença ${dinheiro(details.diferenca, c)}). Nada foi gravado.`;
      }
      if (reason === 'valor_linha_zero') return `No rateio por percentual uma linha ficaria com valor zero${linha}. Ajuste os percentuais. Nada foi gravado.`;
      if (reason === 'linha_duplicada') return `Há linhas de rateio repetidas (mesma natureza e mesmos centros)${linha}. Junte-as numa linha só. Nada foi gravado.`;
      if (reason === 'soma_percentual_diferente' || reason === 'percentual_diferente_de_100') return 'Os percentuais do rateio precisam somar exatamente 100%. Nada foi gravado.';
      return `O rateio é inválido${linha}. Revise as linhas (de 1 a 50, valores maiores que zero). Nada foi gravado.`;
    case 'OPERACAO_PARCELAS_INVALIDAS':
      return `${PARCELAS_INVALIDAS[reason ?? ''] ?? 'As parcelas são inválidas.'}${linha} Nada foi gravado.`;
    case 'OPERACAO_REFERENCIA_INVALIDA':
      return `${REFERENCIA_INVALIDA[reason ?? ''] ?? `Referência inválida${field ? ` no campo "${field}"` : ''}.`}${linha} Nada foi gravado.`;
    case 'OPERACAO_VALORES_INVALIDOS':
      return `${VALORES_INVALIDOS[reason ?? ''] ?? 'Valores inválidos no lançamento.'}${linha} Nada foi gravado.`;
    case 'OPERACAO_COM_LIQUIDACOES':
      return 'Este lançamento tem pagamentos/recebimentos registrados. Estorne as baixas antes de cancelar. Nada foi alterado.';
    case 'ESTOQUE_JA_CONSUMIDO': {
      const qtd = details.entrada != null ? ` (entrada ${kg(details.entrada, c)}, disponível ${kg(details.disponivel, c)})` : '';
      return `A mercadoria${linha} já foi usada no estoque${qtd}. O lançamento não pode ser cancelado enquanto ela estiver consumida. Nada foi alterado.`;
    }
    case 'ESTOQUE_SALDO_INSUFICIENTE':
      if (reason === 'estoque_atual_insuficiente') {
        return `Estoque do produto insuficiente${linha}: atual ${kg(details.estoque_atual, c)}, pedido ${kg(details.solicitado, c)}. Nada foi gravado.`;
      }
      return `Saldo insuficiente no local escolhido${linha}${details.disponivel != null ? `: disponível ${kg(details.disponivel, c)}, pedido ${kg(details.solicitado, c)}` : ''}. Nada foi gravado.`;
    case 'TITULO_NAO_LIQUIDAVEL':
      return 'Esta parcela não aceita baixa agora (prevista, quitada ou cancelada). Recarregue o lançamento.';
    case 'LIQUIDACAO_EXCEDE_SALDO':
      return `O valor informado${details.valor != null ? ` (${dinheiro(details.valor, c)})` : ''} é maior que o saldo da parcela${details.saldo != null ? ` (${dinheiro(details.saldo, c)})` : ''}. Nada foi gravado.`;
    case 'LIQUIDACAO_JA_ESTORNADA':
      return 'Esta baixa já foi estornada. Recarregue o lançamento.';
    case 'FINANCEIRO_DATA_FUTURA': {
      const hoje = details.hoje ? ` (hoje na fazenda: ${formatarDia(details.hoje, c.locale)}${details.fuso ? `, fuso ${String(details.fuso)}` : ''})` : '';
      return `A data ${details.data ? `${formatarDia(details.data, c.locale)} ` : ''}é futura para a fazenda${hoje}. Use uma data até hoje. Nada foi gravado.`;
    }
    case 'EMPRESA_FUSO_NAO_CONFIGURADO':
      return 'A empresa não tem fuso horário configurado: o administrador precisa definir o fuso em Administração › Empresa. Nada foi gravado.';
    case 'IDEMPOTENCY_CONFLICT':
      return 'Este envio já foi usado com outro conteúdo. Recarregue e confira o registro antes de repetir. Nada foi gravado.';
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'O envio anterior ainda está sendo processado. Aguarde alguns segundos e tente de novo: o mesmo envio não será duplicado.';
    case 'CONCURRENCY_CONFLICT':
      return c.comandoIdempotente
        ? 'Outra operação mexia nos mesmos dados ao mesmo tempo. Nada foi gravado. Tente novamente: o mesmo envio não será duplicado.'
        : 'Outra operação mexia nos mesmos dados ao mesmo tempo. Nada foi gravado. Recarregue e tente novamente.';
    case 'REQUEST_VALIDATION_FAILED':
      if (reason && VALIDACAO[reason]) return `${VALIDACAO[reason]}${linha}`;
      return null;
    default:
      return null;
  }
};

/**
 * Mensagem clara por código. Nunca devolve vazio; código desconhecido cai na
 * mensagem pública do `ApiError` (catálogo local) ou no fallback.
 * @param {unknown} erro
 * @param {string} fallback
 * @param {ContextoMoeda} [contexto] moeda/locale para formatar valores de `details`
 */
export const mensagemErroGestao = (erro, fallback, contexto = {}) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  const doLancamento = mensagemLancamento(code, field, reason, details, contexto);
  if (doLancamento) return doLancamento;
  switch (code) {
    case 'ACAO_NAO_PERMITIDA':
      return 'Você não tem permissão para esta ação nesta tela. Peça ao administrador para liberar.';
    case 'EMPRESA_NOT_FOUND':
      return 'Empresa não encontrada. Selecione a empresa novamente.';
    case 'PARCEIRO_NOT_FOUND':
      return 'Parceiro não encontrado nesta empresa. A lista será atualizada.';
    case 'PARCEIRO_DOCUMENTO_INVALIDO':
      return `${ROTULO_DOCUMENTO[field ?? ''] ?? 'CPF/CNPJ'} inválido: confira os dígitos. Nada foi gravado.`;
    case 'PARCEIRO_DOCUMENTO_DUPLICADO': {
      const doc = ROTULO_DOCUMENTO[field ?? ''] ?? 'documento';
      const numero = details.numero_cadastro != null ? ` (cadastro nº ${String(details.numero_cadastro)})` : '';
      return `Já existe um parceiro com este ${doc} nesta empresa${numero}. Nada foi gravado.`;
    }
    case 'CENTRO_CUSTO_NOT_FOUND':
      return 'Centro de custo não encontrado nesta empresa. A lista será atualizada.';
    case 'CENTRO_RESULTADO_NOT_FOUND':
      return 'Centro de resultado não encontrado nesta empresa. A lista será atualizada.';
    case 'CENTRO_NOME_CONFLITO':
      return 'Já existe um centro com este nome nesta empresa. Nada foi gravado.';
    case 'CENTRO_HIERARQUIA_INVALIDA':
      return HIERARQUIA[reason ?? ''] ?? 'Pai inválido para este centro. Nada foi gravado.';
    case 'CENTRO_COM_FILHOS_ATIVOS':
      return 'Este centro tem centros filhos ativos. Inative os filhos antes. Nada foi gravado.';
    case 'CENTRO_LIMITE_ATIVOS': {
      const limite = details.limite != null ? String(details.limite) : '1000';
      return `Esta empresa já tem ${limite} centros ativos deste tipo. Inative algum antes de criar ou reativar. Nada foi gravado.`;
    }
    case 'CENTRO_INATIVO':
      return 'Há centro inativo na seleção: centro inativo não recebe vínculo novo. Nada foi gravado.';
    case 'NATUREZA_FINANCEIRA_NOT_FOUND':
      return 'Natureza financeira não encontrada nesta empresa. A lista será atualizada.';
    case 'NATUREZA_NOME_CONFLITO':
      return 'Já existe uma natureza com este nome e tipo nesta empresa. Nada foi gravado.';
    case 'NATUREZA_HIERARQUIA_INVALIDA':
      if (reason === 'profundidade_maxima' && details.maximo != null) {
        return `A hierarquia ultrapassaria o número máximo de níveis permitido (${String(details.maximo)}).`;
      }
      return HIERARQUIA_NATUREZA[reason ?? ''] ?? 'Pai inválido para esta natureza. Nada foi gravado.';
    case 'NATUREZA_COM_FILHOS_ATIVOS':
      return 'Esta natureza tem naturezas filhas ativas. Inative as filhas antes. Nada foi gravado.';
    case 'REQUEST_VALIDATION_FAILED':
      return field ? `Dados inválidos no campo "${field}". Revise e tente novamente.` : 'Dados inválidos. Revise o formulário e tente novamente.';
    default:
      return getApiErrorMessage(erro, fallback);
  }
};

/** Códigos que significam "o registro não existe mais": a tela relê a lista. */
export const ehNaoEncontradoGestao = (erro) =>
  [
    'PARCEIRO_NOT_FOUND',
    'CENTRO_CUSTO_NOT_FOUND',
    'CENTRO_RESULTADO_NOT_FOUND',
    'NATUREZA_FINANCEIRA_NOT_FOUND',
    // D-PROD-154
    'OPERACAO_FINANCEIRA_NOT_FOUND',
    'TITULO_FINANCEIRO_NOT_FOUND',
    'LIQUIDACAO_FINANCEIRA_NOT_FOUND',
  ].includes(lerErroGestao(erro).code ?? '');

/**
 * Mensagem de um BLOQUEIO da prévia (`{code, field, reason, details}`), no mesmo
 * vocabulário dos erros.
 * @param {{ code?: string, field?: string, reason?: string, details?: Record<string, any> }} bloqueio
 * @param {ContextoMoeda} [contexto]
 */
export const mensagemDoBloqueio = (bloqueio, contexto = {}) =>
  mensagemErroGestao({ cause: { code: bloqueio?.code, field: bloqueio?.field, reason: bloqueio?.reason, details: bloqueio?.details ?? {} } }, 'Há uma pendência que impede a confirmação.', contexto);
