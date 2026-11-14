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

/** Frase de cada vínculo que barra a exclusão da unidade de medida (`details.vinculo`). */
const MENSAGENS_UNIDADE_MEDIDA_EM_USO = Object.freeze({
  tipo_atividade: 'não é possível excluir: a unidade de medida é a unidade de produção padrão de um tipo de atividade; inative-a; nada foi apagado',
  atividade: 'não é possível excluir: a unidade de medida é a unidade de produção de uma atividade; inative-a; nada foi apagado',
});

// D-PROD-197 — a FK RESTRICT do Tipo de Atividade barra apagar a unidade usada como padrão.
// D-PROD-200 — e a da Atividade, que guarda a unidade de produção herdada do tipo:
// quem chama passa `details.vinculo = 'atividade'`; sem ele, o vínculo é `tipo_atividade`.
export const unidadeMedidaDeleteBlocked = (message, options) => {
  const vinculo = options?.details?.vinculo === 'atividade' ? 'atividade' : 'tipo_atividade';
  return new AppError('UNIDADE_MEDIDA_DELETE_BLOCKED', message || MENSAGENS_UNIDADE_MEDIDA_EM_USO[vinculo], {
    ...options,
    details: { ...(options?.details ?? {}), vinculo },
  });
};

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

// D-PROD-190 — a FK RESTRICT do apontamento barrava a exclusão do tipo usado.
// D-PROD-200 — agora é a FK da atividade (o cabeçalho; o apontamento é filho dela).
export const tipoAtividadeDeleteBlocked = (message, options) =>
  new AppError(
    'TIPO_ATIVIDADE_DELETE_BLOCKED',
    message || 'não é possível excluir tipo de atividade usado em atividades; inative-o',
    options
  );

/**
 * D-PROD-197 — frase de cada padrão recusado do Tipo de Atividade, por coluna e `reason`.
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
 * D-PROD-197 — padrão do Tipo de Atividade recusado (um só código;
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

// D-PROD-200 — Lançamento de Atividades (Fatia 2): o CABEÇALHO (`Atividade`) e
// o APONTAMENTO do dia/turno (`AtividadeApontamento`). Um código por situação;
// `details.field`/`details.reason` dizem qual campo e por quê (contrato
// `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md` §10).

/** Atividade de outra empresa ou de outro tenant = inexistente (o mesmo corpo: sem oráculo). */
export const atividadeNotFound = (message, options) =>
  new AppError('ATIVIDADE_NOT_FOUND', message || 'atividade não encontrada nesta fazenda', options);

/** Apontamento de outra atividade, empresa ou tenant = inexistente (o mesmo corpo: sem oráculo). */
export const atividadeApontamentoNotFound = (message, options) =>
  new AppError('ATIVIDADE_APONTAMENTO_NOT_FOUND', message || 'apontamento não encontrado nesta atividade', options);

/**
 * D-PROD-200 — frase de cada referência recusada, por coluna e `reason`.
 * Centros, unidade, grupo e setor não vêm do corpo (são herdados do tipo e da
 * área): só aparecem como `inexistente`, quando o cadastro some entre a
 * leitura e a escrita (a FK composta é a rede).
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const MENSAGENS_REFERENCIA_ATIVIDADE = Object.freeze({
  tipo_atividade_id: Object.freeze({
    inexistente: 'o tipo de atividade não foi encontrado',
    inativo: 'o tipo de atividade está inativo: escolha um tipo ativo',
    grupo_inativo: 'o grupo do tipo de atividade está inativo: reative o grupo ou escolha outro tipo',
  }),
  grupo_atividade_id: Object.freeze({ inexistente: 'o grupo do tipo de atividade não foi encontrado' }),
  area_id: Object.freeze({
    inexistente: 'a área não foi encontrada',
    outra_empresa: 'a área é de outra fazenda',
    inativo: 'a área está inativa',
  }),
  setor_id: Object.freeze({ inexistente: 'o setor da área não foi encontrado' }),
  bem_id: Object.freeze({
    inexistente: 'a máquina não foi encontrada',
    outra_empresa: 'a máquina é de outra fazenda',
    inativo: 'a máquina está inativa',
    natureza: 'o bem não é máquina, veículo nem equipamento: escolha uma máquina',
  }),
  centro_custo_id: Object.freeze({ inexistente: 'o centro de custo padrão do tipo não foi encontrado' }),
  centro_resultado_id: Object.freeze({ inexistente: 'o centro de resultado padrão do tipo não foi encontrado' }),
  unidade_producao_id: Object.freeze({ inexistente: 'a unidade de produção do tipo não foi encontrada' }),
  lancamento_tarefa_id: Object.freeze({
    inexistente: 'a tarefa não foi encontrada',
    outra_empresa: 'a tarefa é de outra fazenda',
  }),
  operador_usuario_id: Object.freeze({
    inexistente: 'o operador não foi encontrado',
    inativo: 'o operador está inativo',
  }),
});

/**
 * D-PROD-200 — referência recusada na atividade ou no apontamento (um só
 * código; `details.field`/`details.reason` dizem qual). Id de outro tenant é
 * `inexistente`, como o que não existe (sem oráculo).
 * @param {'tipo_atividade_id'|'grupo_atividade_id'|'area_id'|'setor_id'|'bem_id'|'centro_custo_id'|'centro_resultado_id'|'unidade_producao_id'|'lancamento_tarefa_id'|'operador_usuario_id'} field
 * @param {'inexistente'|'inativo'|'outra_empresa'|'grupo_inativo'|'natureza'} reason
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeReferenciaInvalida = (field, reason, options) =>
  new AppError(
    'ATIVIDADE_REFERENCIA_INVALIDA',
    `${MENSAGENS_REFERENCIA_ATIVIDADE[field]?.[reason] ?? 'referência da atividade recusada'}; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), field, reason } }
  );

/**
 * D-PROD-200 — campo que a flag do tipo exige → frase e `reason` (a própria flag).
 * @type {Readonly<Record<string, Readonly<{ flag: string, mensagem: string }>>>}
 */
const EXIGENCIAS_DO_TIPO_ATIVIDADE = Object.freeze({
  area_id: Object.freeze({ flag: 'exige_area', mensagem: 'o tipo de atividade exige a área: escolha a área da atividade' }),
  safra_ciclo: Object.freeze({ flag: 'exige_safra', mensagem: 'o tipo de atividade exige a safra: informe a safra ou o ciclo' }),
  bem_id: Object.freeze({ flag: 'exige_maquina', mensagem: 'o tipo de atividade exige a máquina: escolha a máquina da atividade' }),
  quantidade_produzida: Object.freeze({
    flag: 'exige_producao',
    mensagem: 'o tipo de atividade exige produção: a soma da produção dos apontamentos confirmados tem de ser maior que zero para concluir',
  }),
  // D-PROD-201 (Fatia 3): flags que PERMITEM a linha; sem a flag, a linha é recusada (reason = a flag).
  produto_id: Object.freeze({
    flag: 'permite_produto',
    mensagem: 'o tipo de atividade não permite produto: ligue "permite produto" no tipo ou lance sem produto',
  }),
  implemento_bem_id: Object.freeze({
    flag: 'permite_implemento',
    mensagem: 'o tipo de atividade não permite implemento: ligue "permite implemento" no tipo ou lance a máquina sem implemento',
  }),
});

/**
 * D-PROD-200 — campo exigido por uma flag do tipo de atividade:
 * `details.field` = o campo; `details.reason` = a flag (`exige_area`,
 * `exige_safra`, `exige_maquina`, `exige_producao`). D-PROD-201: também a
 * linha que o tipo não PERMITE (`produto_id` → `permite_produto`;
 * `implemento_bem_id` → `permite_implemento`).
 * @param {'area_id'|'safra_ciclo'|'bem_id'|'quantidade_produzida'|'produto_id'|'implemento_bem_id'} field
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeExigidaPeloTipo = (field, options) => {
  const exigencia = EXIGENCIAS_DO_TIPO_ATIVIDADE[field];
  return new AppError(
    'ATIVIDADE_EXIGIDA_PELO_TIPO',
    `${exigencia?.mensagem ?? 'o tipo de atividade exige este campo'}; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), field, reason: exigencia?.flag ?? 'exigido_pelo_tipo' } }
  );
};

/** D-PROD-200 — como cada data da atividade e do apontamento aparece nas frases. */
const ROTULO_DA_DATA_ATIVIDADE = Object.freeze({
  data_inicio: 'a data de início',
  data_prevista_fim: 'a data prevista de fim',
  data_conclusao: 'a data de conclusão',
  data_operacional: 'a data do lançamento',
});

/**
 * D-PROD-200 — frase de cada data recusada, por `reason`.
 * @type {Readonly<Record<string, (rotulo: string, extra: Record<string, unknown>) => string>>}
 */
const MENSAGENS_DATA_ATIVIDADE = Object.freeze({
  futura: (rotulo, extra) =>
    `${rotulo}${extra.data ? ` (${extra.data})` : ''} é posterior a hoje na fazenda${extra.hoje ? ` (${extra.hoje})` : ''}`,
  antes_do_inicio: (rotulo) => `${rotulo} é anterior à data de início da atividade`,
  periodo_invertido: (rotulo) => `${rotulo} é anterior à data de início: o período está invertido`,
  data_inexistente: (rotulo) => `${rotulo} não existe no calendário; use AAAA-MM-DD`,
});

/**
 * D-PROD-200 — data recusada (um só código; `details.field`/`details.reason`).
 * `futura` leva `data`, `hoje` e `fuso` em `extra` (o "hoje" é o da fazenda).
 * @param {string} field  ex.: `data_inicio`, `data_conclusao`, `data_operacional`
 * @param {'futura'|'antes_do_inicio'|'periodo_invertido'|'data_inexistente'} reason
 * @param {Record<string, unknown>} [extra]
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeDataInvalida = (field, reason, extra = {}, options = undefined) => {
  const rotulo = ROTULO_DA_DATA_ATIVIDADE[field] ?? `a data (${field})`;
  const frase = MENSAGENS_DATA_ATIVIDADE[reason]?.(rotulo, extra) ?? `${rotulo} foi recusada`;
  return new AppError('ATIVIDADE_DATA_INVALIDA', `${frase}; nada foi gravado`, {
    ...options,
    details: { ...(options?.details ?? {}), ...extra, field, reason },
  });
};

/** D-PROD-200 — status da atividade e do apontamento, como aparecem nas frases. */
const ROTULO_DO_STATUS_ATIVIDADE = Object.freeze({
  ABERTA: 'aberta',
  CONCLUIDA: 'concluída',
  CANCELADA: 'cancelada',
  CONFIRMADO: 'confirmado',
  CANCELADO: 'cancelado',
});

/** D-PROD-201 — como cada entidade aparece nas frases de status. */
const ROTULO_DA_ENTIDADE_ATIVIDADE = Object.freeze({
  atividade: 'a atividade',
  apontamento: 'o apontamento',
  linha_produto: 'a linha de produto',
  linha_maquina: 'a linha de máquina',
});

/** D-PROD-200 — a regra de status de cada ação (§3 do contrato), como aparece nas frases. */
const REGRA_DE_STATUS_DA_ACAO = Object.freeze({
  editar: 'só atividade aberta é editada',
  concluir: 'só atividade aberta é concluída',
  reabrir: 'só atividade concluída é reaberta',
  cancelar: 'só atividade aberta é cancelada (a concluída precisa ser reaberta antes)',
  lancar_apontamento: 'só atividade aberta recebe lançamento',
  editar_apontamento: 'só apontamento confirmado de atividade aberta é editado',
  cancelar_apontamento: 'só apontamento confirmado de atividade aberta é cancelado',
  // D-PROD-201 (Fatia 3): as linhas de produto e de máquina do apontamento.
  lancar_linha: 'só apontamento confirmado de atividade aberta recebe linha de produto ou de máquina',
  editar_linha: 'só linha confirmada, de apontamento confirmado e atividade aberta, é editada',
  cancelar_linha: 'só linha confirmada, de apontamento confirmado e atividade aberta, é cancelada',
});

/**
 * D-PROD-200 — a ação não é permitida no status atual da atividade (ou do
 * apontamento, ou da linha — D-PROD-201): `details.status`, `details.acao` e `details.entidade`.
 * @param {{ status: string, acao: string, entidade?: 'atividade'|'apontamento'|'linha_produto'|'linha_maquina' }} situacao
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeStatusInvalido = ({ status, acao, entidade = 'atividade' }, options = undefined) =>
  new AppError(
    'ATIVIDADE_STATUS_INVALIDO',
    `${ROTULO_DA_ENTIDADE_ATIVIDADE[entidade] ?? 'a atividade'} está ${ROTULO_DO_STATUS_ATIVIDADE[status] ?? String(status).toLowerCase()}: ${REGRA_DE_STATUS_DA_ACAO[acao] ?? 'a ação não é permitida neste status'}; nada foi alterado`,
    { ...options, details: { ...(options?.details ?? {}), status, acao, entidade } }
  );

/**
 * D-PROD-200 — conflito de versão (CAS por `versao`) da atividade ou do apontamento.
 * @param {number|null} versaoAtual
 * @param {unknown} versaoInformada
 * @param {{ entidade?: 'atividade'|'apontamento' }} [alvo]
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeVersaoConflito = (versaoAtual, versaoInformada, { entidade = 'atividade' } = {}, options = undefined) =>
  new AppError(
    'ATIVIDADE_VERSAO_CONFLITO',
    entidade === 'apontamento'
      ? 'o apontamento foi alterado por outra pessoa desde que você o abriu; recarregue e tente de novo; nada foi gravado'
      : 'a atividade foi alterada por outra pessoa desde que você a abriu; recarregue e tente de novo; nada foi gravado',
    { ...options, details: { ...(options?.details ?? {}), versao_atual: versaoAtual, versao_informada: versaoInformada, entidade } }
  );

/**
 * D-PROD-200 — motivo (cancelar, reabrir) ausente, curto ou longo, contado em
 * caracteres úteis (aparado). Os limites vêm de quem chama
 * (`modules/atividades/atividadeComum.js`).
 * @param {'obrigatorio'|'curto'|'longo'} reason
 * @param {{ minimo: number, maximo: number }} limites
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeMotivoInvalido = (reason, { minimo, maximo }, options = undefined) =>
  new AppError(
    'ATIVIDADE_MOTIVO_INVALIDO',
    `${reason === 'curto' ? `o motivo deve ter ao menos ${minimo} caracteres` : reason === 'longo' ? `o motivo deve ter no máximo ${maximo} caracteres` : 'informe o motivo'}; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), field: 'motivo', reason, minimo, maximo } }
  );

/**
 * D-PROD-200 — a FK RESTRICT de uma atividade (ou de um apontamento dela)
 * barrou a exclusão do cadastro apontado (reconhecida pelo nome da FK em
 * `vinculoAtividade.js`; nenhum módulo consulta as tabelas da atividade).
 * @param {string} vinculo  coluna que segura o cadastro (ex.: `lancamento_tarefa_id`)
 * @param {'atividade'|'apontamento'} [entidade]  a tabela da FK
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeVinculada = (vinculo, entidade = 'atividade', options = undefined) =>
  new AppError(
    'ATIVIDADE_VINCULADA',
    entidade === 'apontamento'
      ? 'não é possível excluir: o cadastro é usado por um apontamento de atividade; inative-o; nada foi apagado'
      : 'não é possível excluir: o cadastro é usado por uma atividade; inative-o; nada foi apagado',
    { ...options, details: { ...(options?.details ?? {}), vinculo, entidade } }
  );

// D-PROD-201 — Lançamento de Atividades (Fatia 3): as LINHAS que geram custo do
// apontamento — produto (`AtividadeApontamentoProduto`, baixa de estoque pelo
// motor FIFO) e máquina (`AtividadeApontamentoMaquina`, uso por medidor).
// Contrato `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`.

/**
 * D-PROD-201 — linha de outro apontamento, atividade, empresa ou tenant =
 * inexistente (o mesmo corpo: sem oráculo). `details.entidade` diz qual linha.
 * @param {'produto'|'maquina'} tipo
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeLinhaNotFound = (tipo, options = undefined) =>
  new AppError(
    'ATIVIDADE_LINHA_NOT_FOUND',
    tipo === 'maquina' ? 'linha de máquina não encontrada neste apontamento' : 'linha de produto não encontrada neste apontamento',
    { ...options, details: { ...(options?.details ?? {}), entidade: tipo === 'maquina' ? 'linha_maquina' : 'linha_produto' } }
  );

/**
 * D-PROD-201 — frase de cada linha recusada, por coluna e `reason` (toda
 * recusa termina com "nada foi gravado", acrescentado pela fábrica).
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const MENSAGENS_LINHA_ATIVIDADE = Object.freeze({
  produto_id: Object.freeze({
    inexistente: 'o produto não foi encontrado nesta fazenda',
    outra_empresa: 'o produto é de outra fazenda: só produtos da fazenda da atividade podem ser baixados',
    inativo: 'o produto está inativo',
    unidade_nao_aceita: 'o estoque do produto não está em L, KG nem SACO: a linha de produto não é possível',
    combustivel_no_abastecimento: 'o produto é combustível (aceito por um tanque ativo): combustível se lança no abastecimento, não como produto da atividade',
  }),
  local_estoque_id: Object.freeze({
    inexistente: 'o local de estoque não foi encontrado',
    inativo: 'o local de estoque está inativo',
  }),
  quantidade: Object.freeze({ quantidade_nao_positiva: 'a quantidade deve ser maior que zero' }),
  bem_id: Object.freeze({
    inexistente: 'a máquina não foi encontrada',
    outra_empresa: 'a máquina é de outra fazenda',
    inativo: 'a máquina está inativa',
    natureza: 'o bem não é máquina, veículo nem equipamento: escolha uma máquina',
  }),
  implemento_bem_id: Object.freeze({
    inexistente: 'o implemento não foi encontrado',
    outra_empresa: 'o implemento é de outra fazenda',
    inativo: 'o implemento está inativo',
    natureza: 'o bem não é implemento: escolha um implemento',
    igual_a_maquina: 'o implemento não pode ser o mesmo bem da máquina',
  }),
  leitura_inicial: Object.freeze({
    obrigatoria: 'informe a leitura inicial do medidor',
    abaixo_da_vigente: 'a leitura inicial está abaixo da leitura vigente do medidor nesta data: o medidor não anda para trás',
    nao_aceita: 'a linha sem medidor não leva leitura',
  }),
  leitura_final: Object.freeze({
    obrigatoria: 'informe a leitura final do medidor',
    menor_que_inicial: 'a leitura final é menor que a inicial',
    abaixo_da_vigente: 'a leitura final está abaixo da leitura vigente do medidor nesta data: o medidor não anda para trás',
    acima_de_posterior: 'a leitura final passa de uma leitura posterior já registrada para este medidor',
    nao_aceita: 'a linha sem medidor não leva leitura',
  }),
  quantidade_uso: Object.freeze({
    obrigatoria: 'informe as horas ou o km de uso',
    nao_aceita: 'com medidor, o uso é calculado pelas leituras (final − inicial): não informe o uso',
    nao_positiva: 'o uso deve ser maior que zero',
  }),
  sem_medidor: Object.freeze({ medidor_obrigatorio: 'a máquina não tem medidor: lance com "sem medidor", informando as horas ou o km' }),
  justificativa_salto: Object.freeze({
    curta: 'a justificativa do salto do medidor deve ter ao menos 3 caracteres',
    longa: 'a justificativa do salto do medidor deve ter no máximo 500 caracteres',
  }),
});

/**
 * D-PROD-201 — linha de produto ou de máquina recusada (um só código;
 * `details.field`/`details.reason` dizem qual; `details.entidade`
 * `linha_produto` | `linha_maquina`). Id de outro tenant é `inexistente`.
 * @param {string} field  ex.: `produto_id`, `local_estoque_id`, `quantidade`, `bem_id`, `leitura_final`
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]  vai para `details` (ex.: `{ entidade: 'linha_maquina', leitura_vigente }`)
 * @param {{cause?: unknown, details?: Record<string, unknown>, message?: string}} [options]  `message` troca a frase
 */
export const atividadeLinhaInvalida = (field, reason, extra = {}, options = undefined) => {
  const { message, ...resto } = options ?? {};
  const frase = message ?? MENSAGENS_LINHA_ATIVIDADE[field]?.[reason] ?? 'a linha da atividade foi recusada';
  return new AppError('ATIVIDADE_LINHA_INVALIDA', `${frase}; nada foi gravado`, {
    ...resto,
    details: { entidade: 'linha_produto', ...(resto.details ?? {}), ...extra, field, reason },
  });
};

/**
 * D-PROD-201 — o uso da linha de máquina passa do teto de salto do tipo
 * patrimonial (`TipoPatrimonial.salto_maximo_medidor`): sem
 * `justificativa_salto` (3..500), recusa; com ela, aceita (não bloqueia).
 * `details.field = 'justificativa_salto'`, `reason = 'salto_acima_do_teto'`,
 * mais `quantidade_uso`, `salto_maximo` e `medidor_unidade` em `extra`.
 * @param {Record<string, unknown>} [extra]
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeSaltoMedidor = (extra = {}, options = undefined) =>
  new AppError(
    'ATIVIDADE_SALTO_MEDIDOR',
    'o uso informado passa do teto de salto do medidor para este tipo de bem: informe a justificativa do salto (3 a 500 caracteres); nada foi gravado',
    { ...options, details: { entidade: 'linha_maquina', ...(options?.details ?? {}), ...extra, field: 'justificativa_salto', reason: 'salto_acima_do_teto' } }
  );

/** D-PROD-201 — frase de cada estorno exato recusado de linha de produto, por `reason`. */
const MENSAGENS_ESTORNO_LINHA = Object.freeze({
  produto_mudou_de_fazenda: 'o produto desta linha mudou de fazenda: o estorno exato não é seguro',
  unidade_mudou: 'a unidade de estoque do produto mudou desde o lançamento da linha: o estorno exato não é seguro',
  movimento_inexistente: 'o movimento de saída desta linha não existe mais: o estorno exato não é seguro',
  movimento_estornado: 'o movimento de saída desta linha já foi estornado',
  fatias_inconsistentes: 'as fatias FIFO gravadas não somam a quantidade da linha: o estorno exato não é seguro',
  lote_indisponivel_para_devolucao: 'um lote consumido por esta linha não pode receber a devolução (lote estornado, transferido ou removido)',
  devolucao_excede_entrada: 'a devolução ultrapassaria a entrada de um lote consumido por esta linha',
  estoque_excede_limite: 'a devolução passaria do limite das colunas de estoque',
  vinculo_divergente: 'o movimento de saída desta linha é de outro produto ou outra fazenda: o estorno exato não é seguro',
  camada_divergente: 'um lote consumido por esta linha é de outro produto, outra fazenda ou outro local: o estorno exato não é seguro',
});

/**
 * D-PROD-201 — o estorno exato de uma linha de produto (editar, cancelar a
 * linha, o apontamento ou a atividade) foi recusado pelo motor ou pelas
 * conferências antes dele (molde `ABASTECIMENTO_CANCELAMENTO_BLOQUEADO`).
 * `details.reason`, `details.linha_id`/`linha_ordem`/`lote_id` e, quando veio do
 * motor, `details.motor` (`{ code, message }`, a explicação do motor).
 * @param {keyof typeof MENSAGENS_ESTORNO_LINHA} reason
 * @param {Record<string, unknown>} [extra]
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeEstornoBloqueado = (reason, extra = {}, options = undefined) =>
  new AppError('ATIVIDADE_ESTORNO_BLOQUEADO', `${MENSAGENS_ESTORNO_LINHA[reason] ?? 'o estorno exato da linha de produto não é seguro'}; nada foi alterado`, {
    ...options,
    details: { entidade: 'linha_produto', ...(options?.details ?? {}), ...extra, field: 'linha', reason },
  });

/**
 * D-PROD-201 — a data do apontamento não muda com linha de produto ou de
 * máquina CONFIRMADA (a saída de estoque e a leitura do medidor estão nesta
 * data): cancelar e lançar de novo. `details.linhas_produto`/`linhas_maquina`.
 * @param {{ produtos: number, maquinas: number }} contagem
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeDataComLinhas = ({ produtos, maquinas }, options = undefined) =>
  new AppError(
    'ATIVIDADE_DATA_COM_LINHAS',
    'a data do lançamento não pode mudar: há linha de produto ou de máquina confirmada nesta data; cancele o lançamento e lance de novo na data certa; nada foi gravado',
    { ...options, details: { ...(options?.details ?? {}), field: 'data_operacional', reason: 'data_com_linhas', linhas_produto: produtos, linhas_maquina: maquinas } }
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

/**
 * D-PROD-195 — excluir curva ligada a categoria de manejo: 409 com a contagem.
 * @param {number} categorias
 */
export const curvaGanhoEmUso = (categorias, options) =>
  new AppError(
    'CURVA_GANHO_EM_USO',
    `Esta curva está ligada a ${categorias} categoria(s) de manejo e não pode ser excluída.`,
    { ...options, details: { ...(options?.details ?? {}), categorias } }
  );

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
