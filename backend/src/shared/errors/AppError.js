/**
 * Erro de aplicação com código estável do contrato.
 *
 * A mensagem pública nunca carrega o erro original: a causa fica em `cause`,
 * para log, e o cliente recebe `{ code, message }`. É a mesma disciplina que a
 * P1 aplicou no frontend — a UI identifica pelo código, não pelo texto.
 */

import { ehCodigoConhecido, statusHttpDe } from './errorCodes.js';

export class AppError extends Error {
  /**
   * @param {string} code código do contrato
   * @param {string} [message] mensagem pública; sem segredo, sem SQL, sem stack
   * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
   */
  constructor(code, message, options = {}) {
    super(message || code, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = statusHttpDe(code);
    this.details = options.details;

    // Código desconhecido é defeito de programação, não condição de runtime:
    // ele vira 500 pelo fallback de `statusHttpDe`, e a marca abaixo permite
    // que teste e log distingam "erro interno de verdade" de "código que
    // alguém esqueceu de declarar".
    if (!ehCodigoConhecido(code)) {
      this.codigoDesconhecido = true;
    }
  }
}

/** @param {unknown} erro */
export const ehAppError = (erro) => erro instanceof AppError;

export const tenantContextRequired = (message, options) =>
  new AppError('TENANT_CONTEXT_REQUIRED', message || 'contexto de tenant ausente', options);

export const tenantScopeViolation = (message, options) =>
  new AppError('TENANT_SCOPE_VIOLATION', message || 'recurso pertence a outro cliente', options);

export const sequenceScopeInvalid = (message, details) =>
  new AppError('SEQUENCE_SCOPE_INVALID', message || 'escopo de sequência inválido', { details });

export const sequenceConflict = (message, options) =>
  new AppError('SEQUENCE_CONFLICT', message || 'não foi possível reservar o número', options);

export const attachmentInvalid = (message, details) =>
  new AppError('ATTACHMENT_INVALID', message || 'anexo inválido', { details });

export const attachmentOwnerInvalid = (message) =>
  new AppError('ATTACHMENT_OWNER_INVALID', message || 'proprietário do anexo não encontrado');

export const auditWriteFailed = (message, options) =>
  new AppError('AUDIT_WRITE_FAILED', message || 'falha ao registrar auditoria', options);

export const concurrencyConflict = (message, options) =>
  new AppError('CONCURRENCY_CONFLICT', message || 'conflito de concorrência', options);

/**
 * Setor inexistente **ou** de outro tenant — indistinguíveis de propósito.
 *
 * A mensagem é a mesma nos dois casos. Diferenciá-las transformaria a rota num
 * oráculo de existência: quem quisesse saber se um id pertence a outro cliente
 * bastaria comparar as respostas.
 */
export const setorNotFound = (message, options) =>
  new AppError('SETOR_NOT_FOUND', message || 'setor não encontrado', options);

/**
 * Área de pastagem inexistente **ou** de outro tenant — indistinguíveis, pelo
 * mesmo motivo de `setorNotFound`.
 */
export const areaNotFound = (message, options) =>
  new AppError('AREA_NOT_FOUND', message || 'área de pastagem não encontrada', options);

export const usuarioNotFound = (message, options) =>
  new AppError('USUARIO_NOT_FOUND', message || 'usuário não encontrado', options);

/** @param {string} code @param {string} [message] @param {{details?: Record<string, unknown>}} [options] */
export const adminError = (code, message, options) => new AppError(code, message, options);

export const productOperatorRequired = (message, options) =>
  new AppError(
    'PRODUCT_OPERATOR_REQUIRED',
    message || 'operador de produto MAIKE não autorizado',
    options
  );

export const catalogoGlobalInvalid = (message, details) =>
  new AppError('CATALOGO_GLOBAL_INVALID', message || 'catálogo global inválido', { details });

export const catalogoGlobalNotFound = (message, options) =>
  new AppError('CATALOGO_GLOBAL_NOT_FOUND', message || 'recurso do catálogo não encontrado', options);

export const catalogoAssetInvalid = (message, details) =>
  new AppError('CATALOGO_ASSET_INVALID', message || 'asset inválido', { details });

export const usuarioLoginDuplicado = (message, options) =>
  new AppError('USUARIO_LOGIN_DUPLICADO', message || 'login já existe neste cliente', options);

export const usuarioSelfDeactivate = (message, options) =>
  new AppError('USUARIO_SELF_DEACTIVATE', message || 'não é possível desativar a própria conta', options);

export const configuracaoIconeNotFound = (message, options) =>
  new AppError(
    'CONFIGURACAO_ICONE_NOT_FOUND',
    message || 'configuração de ícone não encontrada',
    options
  );

export const pontoReferenciaNotFound = (message, options) =>
  new AppError('PONTO_REFERENCIA_NOT_FOUND', message || 'ponto de referência não encontrado', options);

export const linhaGeograficaNotFound = (message, options) =>
  new AppError('LINHA_GEOGRAFICA_NOT_FOUND', message || 'linha geografica não encontrada', options);

export const marcaNotFound = (message, options) =>
  new AppError('MARCA_NOT_FOUND', message || 'marca não encontrada', options);

export const marcaNomeConflito = (message, options) =>
  new AppError('MARCA_NAME_CONFLICT', message || 'já existe marca com este nome nesta empresa', options);

export const unidadeMedidaNotFound = (message, options) =>
  new AppError('UNIDADE_MEDIDA_NOT_FOUND', message || 'unidade de medida não encontrada', options);

export const unidadeMedidaSiglaConflito = (message, options) =>
  new AppError('UNIDADE_MEDIDA_SIGLA_CONFLICT', message || 'já existe unidade com esta sigla', options);

// D-PROD-195 — a FK RESTRICT do Tipo de Atividade barra apagar a unidade usada como padrão.
export const unidadeMedidaDeleteBlocked = (message, options) =>
  new AppError(
    'UNIDADE_MEDIDA_DELETE_BLOCKED',
    message || 'não é possível excluir: a unidade de medida é a unidade de produção padrão de um tipo de atividade; inative-a; nada foi apagado',
    { ...options, details: { ...(options?.details ?? {}), vinculo: 'tipo_atividade' } }
  );

export const grupoAtividadeNotFound = (message, options) =>
  new AppError('GRUPO_ATIVIDADE_NOT_FOUND', message || 'grupo de atividade não encontrado', options);

export const grupoAtividadeNomeConflito = (message, options) =>
  new AppError('GRUPO_ATIVIDADE_NAME_CONFLICT', message || 'já existe grupo com este nome', options);

export const grupoAtividadeDeleteBlocked = (message, options) =>
  new AppError(
    'GRUPO_ATIVIDADE_DELETE_BLOCKED',
    message || 'não é possível excluir grupo com tipos de tarefa ou de atividade vinculados',
    options
  );

export const tipoTarefaNotFound = (message, options) =>
  new AppError('TIPO_TAREFA_NOT_FOUND', message || 'tipo de tarefa não encontrado', options);

export const tipoTarefaNomeConflito = (message, options) =>
  new AppError('TIPO_TAREFA_NAME_CONFLICT', message || 'já existe tipo com este nome no grupo', options);

// D-PROD-182 — Tipo de Atividade (cadastro nativo, irmão do Tipo de Tarefa).
export const tipoAtividadeNotFound = (message, options) =>
  new AppError('TIPO_ATIVIDADE_NOT_FOUND', message || 'tipo de atividade não encontrado', options);

export const tipoAtividadeNomeConflito = (message, options) =>
  new AppError(
    'TIPO_ATIVIDADE_NAME_CONFLICT',
    message || 'já existe tipo de atividade com este nome no grupo',
    options
  );

// D-PROD-190 — a FK RESTRICT do apontamento barra a exclusão do tipo usado.
export const tipoAtividadeDeleteBlocked = (message, options) =>
  new AppError(
    'TIPO_ATIVIDADE_DELETE_BLOCKED',
    message || 'não é possível excluir tipo de atividade com apontamentos vinculados; inative-o',
    options
  );

/**
 * D-PROD-195 — frase de cada padrão recusado do Tipo de Atividade, por coluna e `reason`.
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const MENSAGENS_PADRAO_TIPO_ATIVIDADE = Object.freeze({
  centro_custo_padrao_id: Object.freeze({
    nao_encontrado: 'o centro de custo padrão não foi encontrado',
    inativo: 'o centro de custo padrão está inativo: escolha um centro ativo',
  }),
  centro_resultado_padrao_id: Object.freeze({
    nao_encontrado: 'o centro de resultado padrão não foi encontrado',
    inativo: 'o centro de resultado padrão está inativo: escolha um centro ativo',
    empresas_diferentes: 'o centro de resultado padrão é de outra fazenda que o centro de custo padrão: os dois têm de ser da mesma fazenda',
  }),
  unidade_producao_id: Object.freeze({
    nao_encontrado: 'a unidade de produção não foi encontrada',
    inativo: 'a unidade de produção está inativa: escolha uma unidade ativa',
  }),
  coeficiente_padrao: Object.freeze({
    nao_positivo: 'o coeficiente padrão deve ser maior que zero',
  }),
});

/**
 * D-PROD-195 — padrão do Tipo de Atividade recusado (um só código;
 * `details.field`/`details.reason` dizem qual). Id de outro tenant é
 * `nao_encontrado`, como o inexistente (sem oráculo).
 * @param {'centro_custo_padrao_id'|'centro_resultado_padrao_id'|'unidade_producao_id'|'coeficiente_padrao'} field
 * @param {'nao_encontrado'|'inativo'|'empresas_diferentes'|'nao_positivo'} reason
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const tipoAtividadePadraoInvalido = (field, reason, options) =>
  new AppError(
    'TIPO_ATIVIDADE_PADRAO_INVALIDO',
    `${MENSAGENS_PADRAO_TIPO_ATIVIDADE[field]?.[reason] ?? 'padrão do tipo de atividade recusado'}; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), field, reason } }
  );

// D-PROD-190 — Apontamento de Atividade.
export const apontamentoAtividadeNotFound = (message, options) =>
  new AppError('APONTAMENTO_ATIVIDADE_NOT_FOUND', message || 'apontamento de atividade não encontrado nesta fazenda', options);

/** @param {string} field @param {'inexistente'|'outra_empresa'|'inativo'} reason @param {string} message */
export const apontamentoAtividadeReferenciaInvalida = (field, reason, message, options) =>
  new AppError('APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA', message, {
    ...options,
    details: { ...(options?.details ?? {}), field, reason },
  });

/** Frase de cada horário recusado do apontamento, por `reason` e coluna. */
const MENSAGENS_HORARIO_APONTAMENTO = Object.freeze({
  fim_antes_do_inicio: () => 'a hora de fim é anterior à hora de início; nada foi gravado',
  hora_futura: (field) =>
    `a hora de ${field === 'hora_inicio' ? 'início' : 'fim'} é posterior a agora; só atividade já executada é apontada; nada foi gravado`,
  hora_fora_do_dia: (field) =>
    `a hora de ${field === 'hora_inicio' ? 'início' : 'fim'} tem de cair na data da atividade (no fuso da fazenda); nada foi gravado`,
});

/**
 * Horário recusado (um só código, `details.field`/`details.reason` dizem qual):
 * fim antes do início, hora depois de agora ou fora do dia da atividade.
 * @param {'fim_antes_do_inicio'|'hora_futura'|'hora_fora_do_dia'} [reason]
 * @param {'hora_inicio'|'hora_fim'} [field]
 * @param {Record<string, unknown>} [extra] detalhes do caso (ex.: dia local e fuso)
 */
export const apontamentoAtividadeHorarioInvalido = (reason = 'fim_antes_do_inicio', field = 'hora_fim', extra = {}, options = undefined) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_HORARIO_INVALIDO',
    MENSAGENS_HORARIO_APONTAMENTO[reason](field),
    { ...options, details: { ...(options?.details ?? {}), ...extra, field, reason } }
  );

/** @param {{ data: string, hoje: string, fuso: string }} referencia */
export const apontamentoAtividadeDataFutura = ({ data, hoje, fuso }, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_DATA_FUTURA',
    `a data da atividade (${data}) é posterior a hoje na fazenda (${hoje}); só atividade já executada é apontada; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), field: 'data_operacional', reason: 'data_futura', data, hoje, fuso } }
  );

/** @param {'implemento_sem_bem'|'implemento_igual_ao_bem'} reason */
export const apontamentoAtividadeImplementoInvalido = (reason, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_IMPLEMENTO_INVALIDO',
    reason === 'implemento_sem_bem'
      ? 'escolha a máquina ou o veículo antes do implemento; nada foi gravado'
      : 'o implemento não pode ser o mesmo bem da máquina ou do veículo; nada foi gravado',
    { ...options, details: { ...(options?.details ?? {}), field: 'implemento_bem_id', reason } }
  );

/** @param {string} field @param {'quantidade_sem_unidade'|'unidade_sem_quantidade'|'quantidade_nao_positiva'|'horas_nao_positivas'} reason @param {string} message */
export const apontamentoAtividadeProducaoInvalida = (field, reason, message, options) =>
  new AppError('APONTAMENTO_ATIVIDADE_PRODUCAO_INVALIDA', message, {
    ...options,
    details: { ...(options?.details ?? {}), field, reason },
  });

/** @param {string} status */
export const apontamentoAtividadeStatusInvalido = (status, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO',
    'o apontamento está cancelado e não aceita edição nem novo cancelamento; nada foi alterado',
    { ...options, details: { ...(options?.details ?? {}), field: 'status', reason: 'status_invalido', status, esperado: 'CONFIRMADO' } }
  );

/** @param {number|null} versaoAtual @param {unknown} versaoInformada */
export const apontamentoAtividadeVersaoConflito = (versaoAtual, versaoInformada, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO',
    'o apontamento foi alterado por outra pessoa desde que você o abriu; recarregue e tente de novo; nada foi gravado',
    { ...options, details: { ...(options?.details ?? {}), versao_atual: versaoAtual, versao_informada: versaoInformada } }
  );

/** @param {string} vinculo coluna do apontamento que segura o cadastro (ex.: `lancamento_tarefa_id`) */
export const apontamentoAtividadeVinculado = (vinculo, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_VINCULADO',
    'não é possível excluir: há apontamentos de atividade vinculados a este cadastro; nada foi apagado',
    { ...options, details: { ...(options?.details ?? {}), vinculo } }
  );

// D-PROD-193 — itens do apontamento de atividade.
/** Item de outro apontamento, empresa ou tenant = inexistente (o mesmo corpo: sem oráculo). */
export const apontamentoAtividadeItemNotFound = (message, options) =>
  new AppError('APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND', message || 'item não encontrado neste apontamento de atividade', options);

/**
 * Item recusado (um só código; `details.field`/`details.reason` dizem qual).
 * @param {'produto_id'|'local_estoque_id'|'quantidade'|'valor_unitario'} field
 * @param {string} reason @param {string} message @param {Record<string, unknown>} [extra]
 */
export const apontamentoAtividadeItemInvalido = (field, reason, message, extra = {}, options = undefined) =>
  new AppError('APONTAMENTO_ATIVIDADE_ITEM_INVALIDO', message, {
    ...options,
    details: { ...(options?.details ?? {}), ...extra, field, reason },
  });

/** @param {string} status */
export const apontamentoAtividadeItemStatusInvalido = (status, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO',
    'este item já foi cancelado; nada foi alterado',
    { ...options, details: { ...(options?.details ?? {}), field: 'status', reason: 'status_invalido', status, esperado: 'CONFIRMADO' } }
  );

/** @param {number} limite */
export const apontamentoAtividadeItensExcedidos = (limite, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS',
    `o apontamento já tem ${limite} itens (confirmados e cancelados), o máximo; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), limite } }
  );

/** Frase de cada estorno bloqueado de item PRODUTO, por `reason`. */
const MENSAGENS_ESTORNO_ITEM = Object.freeze({
  produto_mudou_de_fazenda: 'o produto deste item mudou de fazenda: o estorno exato não é seguro; nada foi alterado',
  unidade_mudou: 'a unidade de estoque do produto mudou desde o lançamento do item: o estorno exato não é seguro; nada foi alterado',
  movimento_inexistente: 'o movimento de saída deste item não existe mais: o estorno exato não é seguro; nada foi alterado',
  movimento_estornado: 'o movimento de saída deste item já foi estornado; nada foi alterado',
  fatias_inconsistentes: 'as fatias FIFO gravadas não somam a quantidade do item: o estorno exato não é seguro; nada foi alterado',
  lote_indisponivel_para_devolucao: 'um lote consumido por este item não pode receber a devolução (lote estornado ou removido); nada foi alterado',
  devolucao_excede_entrada: 'a devolução ultrapassaria a entrada de um lote consumido por este item; nada foi alterado',
  estoque_excede_limite: 'a devolução passaria do limite das colunas de estoque; nada foi alterado',
  vinculo_divergente: 'o movimento de saída deste item é de outro produto ou outra fazenda: o estorno exato não é seguro; nada foi alterado',
  camada_divergente: 'um lote consumido por este item é de outro produto, outra fazenda ou outro local: o estorno exato não é seguro; nada foi alterado',
});

/**
 * Estorno exato de item PRODUTO recusado (molde `ABASTECIMENTO_CANCELAMENTO_BLOQUEADO`).
 * @param {keyof typeof MENSAGENS_ESTORNO_ITEM} reason
 * @param {{ item_id?: string, item_ordem?: number, lote_id?: string } & Record<string, unknown>} [extra]
 */
export const apontamentoAtividadeEstornoBloqueado = (reason, extra = {}, options = undefined) =>
  new AppError('APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO', MENSAGENS_ESTORNO_ITEM[reason], {
    ...options,
    details: { ...(options?.details ?? {}), ...extra, field: 'item', reason },
  });

/** D-1 (D-PROD-193): a data não muda com item PRODUTO confirmado (a saída está na data atual). @param {number} itens */
export const apontamentoAtividadeDataComItens = (itens, options) =>
  new AppError(
    'APONTAMENTO_ATIVIDADE_DATA_COM_ITENS',
    'a data da atividade não pode mudar: há item de produto confirmado, com a saída do estoque nesta data; cancele os itens de produto antes; nada foi gravado',
    { ...options, details: { ...(options?.details ?? {}), field: 'data_operacional', reason: 'data_com_itens', itens_produto: itens } }
  );

// D-PROD-188 — Estações da fazenda (tabela CADESTACOES).
export const estacaoNotFound = (message, options) =>
  new AppError('ESTACAO_NOT_FOUND', message || 'estação não encontrada', options);

export const estacaoNomeConflito = (message, options) =>
  new AppError('ESTACAO_NAME_CONFLICT', message || 'já existe estação com este nome nesta fazenda', options);

export const estacaoPeriodoSobreposto = (message, options) =>
  new AppError(
    'ESTACAO_PERIODO_SOBREPOSTO',
    message || 'o período se sobrepõe a outra estação ativa desta fazenda',
    options
  );

// D-PROD-189 — Curvas de Ganho de Peso da fazenda (tabela CADCURVAGANHO).
export const curvaGanhoNotFound = (message, options) =>
  new AppError('CURVA_GANHO_NOT_FOUND', message || 'curva de ganho não encontrada', options);

export const curvaGanhoNomeConflito = (message, options) =>
  new AppError('CURVA_GANHO_NAME_CONFLICT', message || 'já existe curva de ganho com este nome nesta fazenda', options);

export const loteNotFound = (message, options) =>
  new AppError('LOTE_NOT_FOUND', message || 'lote não encontrado', options);

export const loteDeleteBlocked = (vinculo, options) =>
  new AppError(
    'LOTE_DELETE_BLOCKED',
    'não é possível excluir lote com registros vinculados',
    { ...options, details: { ...(options?.details ?? {}), vinculo } }
  );

export const loteUpdateBlocked = (vinculo, options) =>
  new AppError(
    'LOTE_UPDATE_BLOCKED',
    'não é possível editar o lançamento de entrada de um lote que já tem movimentação, manejo ou registro',
    { ...options, details: { ...(options?.details ?? {}), vinculo } }
  );

export const categoriaNotFound = (message, options) =>
  new AppError('CATEGORIA_NOT_FOUND', message || 'categoria não encontrada', options);

export const categoriaPaiNotFound = (message, options) =>
  new AppError('CATEGORIA_PAI_NOT_FOUND', message || 'categoria pai não encontrada', options);

export const categoriaDeleteBlocked = (message, options) =>
  new AppError(
    'CATEGORIA_DELETE_BLOCKED',
    message || 'não é possível excluir categoria com subcategorias',
    options
  );

export const localEstoqueNotFound = (message, options) =>
  new AppError('LOCAL_ESTOQUE_NOT_FOUND', message || 'local de estoque não encontrado', options);

export const localEstoqueDeleteBlocked = (motivo, options) =>
  new AppError(
    'LOCAL_ESTOQUE_DELETE_BLOCKED',
    'não é possível excluir local de estoque com registros vinculados',
    { ...options, details: { ...(options?.details ?? {}), motivo } }
  );

export const produtoNotFound = (message, options) =>
  new AppError('PRODUTO_NOT_FOUND', message || 'produto não encontrado', options);

export const produtoNomeConflito = (message, options) =>
  new AppError(
    'PRODUTO_NAME_CONFLICT',
    message || 'já existe produto com este nome nesta empresa',
    options
  );

export const produtoDeleteBlocked = (quantidade, options) =>
  new AppError(
    'PRODUTO_DELETE_BLOCKED',
    'não é possível excluir produto com movimentações de estoque',
    { ...options, details: { ...(options?.details ?? {}), quantidade } }
  );
