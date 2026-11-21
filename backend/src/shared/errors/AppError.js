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
  // D-PROD-207 — unidade de medida de um serviço (cadastro da Fatia 4).
  servico: 'não é possível excluir: a unidade de medida é usada por um serviço; inative-a; nada foi apagado',
});

// D-PROD-197 — a FK RESTRICT do Tipo de Atividade barra apagar a unidade usada como padrão.
// D-PROD-200 — e a da Atividade, que guarda a unidade de produção herdada do tipo:
// quem chama passa `details.vinculo = 'atividade'`; sem ele, o vínculo é `tipo_atividade`.
export const unidadeMedidaDeleteBlocked = (message, options) => {
  const pedido = options?.details?.vinculo;
  const vinculo = pedido === 'atividade' || pedido === 'servico' ? pedido : 'tipo_atividade';
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

/** D-PROD-249 — área de outra atividade, empresa ou tenant = inexistente (o mesmo corpo: sem oráculo). */
export const atividadeAreaNotFound = (message, options) =>
  new AppError('ATIVIDADE_AREA_NOT_FOUND', message || 'área não encontrada nesta atividade', options);

/**
 * D-PROD-249 — a área da atividade tem lançamento e não pode sair (nada com custo é apagado):
 * `details.confirmados` e `details.cancelados` (lançamentos da área). Conclua a área em vez de removê-la.
 * @param {{ confirmados: number, cancelados: number }} contagem
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeAreaComLancamentos = ({ confirmados, cancelados }, options = undefined) =>
  new AppError(
    'ATIVIDADE_AREA_COM_LANCAMENTOS',
    confirmados > 0
      ? `a área tem ${confirmados} lançamento(s) confirmado(s) e não pode sair da atividade: conclua a área; nada foi apagado`
      : `a área tem ${cancelados} lançamento(s) cancelado(s) (histórico) e não pode sair da atividade: conclua a área; nada foi apagado`,
    { ...options, details: { ...(options?.details ?? {}), confirmados, cancelados } }
  );

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
    abastecimento: 'Abastecimento não é registro de campo da área: abasteça pela máquina (Lançamento de Atividades › Trabalho de máquinas)',
  }),
  grupo_atividade_id: Object.freeze({ inexistente: 'o grupo do tipo de atividade não foi encontrado' }),
  area_id: Object.freeze({
    inexistente: 'a área não foi encontrada',
    outra_empresa: 'a área é de outra fazenda',
    inativo: 'a área está inativa',
    // D-PROD-249 — várias áreas por atividade.
    duplicada: 'a mesma área foi escolhida duas vezes',
    ja_na_atividade: 'a área já está nesta atividade',
    varias_areas: 'a atividade tem várias áreas: mude as áreas pelo card "Áreas da atividade"',
    com_lancamentos: 'a área atual tem lançamento: ela não pode ser trocada nem retirada (conclua a área e adicione outra)',
  }),
  // D-PROD-249 — a área do lançamento (uma das áreas da atividade).
  atividade_area_id: Object.freeze({
    inexistente: 'a área não é desta atividade',
    obrigatorio: 'a atividade tem áreas: escolha a área do lançamento',
    sem_areas: 'a atividade não tem áreas: lance sem área',
  }),
  area_planejada: Object.freeze({
    varias_areas: 'a atividade tem várias áreas: a área planejada é a soma das áreas; mude a de cada área',
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
  // MAIKE-ENTREGA2 (D-PROD-271) — o capim plantado e a cultura do consórcio (Cadastro de Culturas da fazenda).
  'plantio.cultura_id': Object.freeze({
    inexistente: 'o capim plantado não foi encontrado no Cadastro de Culturas desta fazenda',
    inativo: 'o capim plantado está inativo no Cadastro de Culturas: escolha um ativo',
  }),
  'plantio.consorcio_cultura_id': Object.freeze({
    inexistente: 'a cultura do consórcio não foi encontrada no Cadastro de Culturas desta fazenda',
    inativo: 'a cultura do consórcio está inativa no Cadastro de Culturas: escolha uma ativa',
  }),
  // MAIKE-ENTREGA2 (D-PROD-271) — a unidade da quantidade feita é a da atividade.
  unidade_producao_sigla: Object.freeze({
    diferente_da_atividade: 'a unidade da quantidade feita é diferente da unidade deste serviço: use a mesma unidade',
  }),
});

/**
 * D-PROD-200 — referência recusada na atividade ou no apontamento (um só
 * código; `details.field`/`details.reason` dizem qual). Id de outro tenant é
 * `inexistente`, como o que não existe (sem oráculo).
 * D-PROD-249: `atividade_area_id` (a área do lançamento) e `areas[n].area_id` (as áreas da abertura, com a frase do
 * `area_id`), com os reasons novos `duplicada`, `ja_na_atividade`, `varias_areas`, `com_lancamentos`, `obrigatorio` e
 * `sem_areas`.
 * @param {string} field
 * D-PROD-271: `plantio.cultura_id`/`plantio.consorcio_cultura_id` (`inexistente`, `inativo`) e `unidade_producao_sigla`
 * (`diferente_da_atividade`).
 * @param {'inexistente'|'inativo'|'outra_empresa'|'grupo_inativo'|'natureza'|'duplicada'|'ja_na_atividade'|'varias_areas'|'com_lancamentos'|'obrigatorio'|'sem_areas'|'abastecimento'|'diferente_da_atividade'} reason
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeReferenciaInvalida = (field, reason, options) =>
  new AppError(
    'ATIVIDADE_REFERENCIA_INVALIDA',
    `${(MENSAGENS_REFERENCIA_ATIVIDADE[field] ?? MENSAGENS_REFERENCIA_ATIVIDADE[String(field).replace(/^areas\[\d+\]\./, '')])?.[reason] ?? 'referência da atividade recusada'}; nada foi gravado`,
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
  // D-PROD-202 (Fatia 3): flags que PERMITEM a linha; sem a flag, a linha é recusada (reason = a flag).
  produto_id: Object.freeze({
    flag: 'permite_produto',
    mensagem: 'o tipo de atividade não permite produto: ligue "permite produto" no tipo ou lance sem produto',
  }),
  implemento_bem_id: Object.freeze({
    flag: 'permite_implemento',
    mensagem: 'o tipo de atividade não permite implemento: ligue "permite implemento" no tipo ou lance a máquina sem implemento',
  }),
  // D-PROD-207 (Fatia 4): linhas de mão de obra e de serviço (D-PROD-208: a mão de obra aponta o parceiro).
  parceiro_id: Object.freeze({
    flag: 'permite_mao_obra',
    mensagem: 'o tipo de atividade não permite mão de obra: ligue "permite mão de obra" no tipo ou lance sem mão de obra',
  }),
  servico_id: Object.freeze({
    flag: 'permite_servico',
    mensagem: 'o tipo de atividade não permite serviço: ligue "permite serviço" no tipo ou lance sem serviço',
  }),
});

/**
 * D-PROD-200 — campo exigido por uma flag do tipo de atividade:
 * `details.field` = o campo; `details.reason` = a flag (`exige_area`,
 * `exige_safra`, `exige_maquina`, `exige_producao`). D-PROD-202: também a
 * linha que o tipo não PERMITE (`produto_id` → `permite_produto`;
 * `implemento_bem_id` → `permite_implemento`). D-PROD-207: `servico_id` →
 * `permite_servico`; mão de obra (D-PROD-208: `parceiro_id`) → `permite_mao_obra`.
 * @param {'area_id'|'safra_ciclo'|'bem_id'|'quantidade_produzida'|'produto_id'|'implemento_bem_id'|'parceiro_id'|'servico_id'} field
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
  // D-PROD-265: a data de término do registro de campo (Nova realização).
  data_termino: 'a data de término',
});

/**
 * D-PROD-200 — frase de cada data recusada, por `reason`.
 * @type {Readonly<Record<string, (rotulo: string, extra: Record<string, unknown>) => string>>}
 */
const MENSAGENS_DATA_ATIVIDADE = Object.freeze({
  futura: (rotulo, extra) =>
    `${rotulo}${extra.data ? ` (${extra.data})` : ''} é posterior a hoje na fazenda${extra.hoje ? ` (${extra.hoje})` : ''}`,
  antes_do_inicio: (rotulo) => `${rotulo} é anterior à data de início da atividade`,
  // D-PROD-249: a data de conclusão da área (ou da atividade, que conclui as áreas em andamento) antes do início da área.
  antes_do_inicio_da_area: (rotulo, extra) =>
    `${rotulo}${extra.data ? ` (${extra.data})` : ''} é anterior ao início da área${extra.area ? ` ${extra.area}` : ''}${extra.data_inicio_area ? ` (${extra.data_inicio_area})` : ''}`,
  periodo_invertido: (rotulo) => `${rotulo} é anterior à data de início: o período está invertido`,
  data_inexistente: (rotulo) => `${rotulo} não existe no calendário; use AAAA-MM-DD`,
  // D-PROD-265: a data do lançamento depois do término gravado nele.
  depois_do_termino: (rotulo, extra) => `${rotulo}${extra.data ? ` (${extra.data})` : ''} é posterior à data de término do serviço${extra.data_termino ? ` (${extra.data_termino})` : ''}`,
  // D-PROD-267: concluir (a área ou a atividade) antes do último dia que já tem lançamento.
  antes_do_ultimo_dia: (rotulo, extra) =>
    `${rotulo}${extra.data ? ` (${extra.data})` : ''} é anterior ao último dia lançado${extra.area ? ` na área ${extra.area}` : ''}${extra.ultimo_dia ? ` (${extra.ultimo_dia})` : ''}`,
});

/**
 * D-PROD-200 — data recusada (um só código; `details.field`/`details.reason`).
 * `futura` leva `data`, `hoje` e `fuso` em `extra` (o "hoje" é o da fazenda).
 * @param {string} field  ex.: `data_inicio`, `data_conclusao`, `data_operacional`
 * @param {'futura'|'antes_do_inicio'|'antes_do_inicio_da_area'|'periodo_invertido'|'data_inexistente'|'depois_do_termino'|'antes_do_ultimo_dia'} reason  D-PROD-265: `depois_do_termino` leva `data` e `data_termino`; D-PROD-267: `antes_do_ultimo_dia` leva `data` e `ultimo_dia`
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

/**
 * D-PROD-267 — o registro de campo acharia a atividade ABERTA da operação na área, mas ela está PARADA: o último dia lançado
 * nela (nas áreas do registro) foi há mais de `limite_dias`. O servidor não junta sozinho; o cliente pergunta e reenvia
 * com `nova_atividade` (false = continuar; true = concluir a antiga no último dia e abrir outra). Nada foi gravado (nem o
 * recibo da chave: o reenvio com a decisão usa a mesma `operation_id`).
 * D-PROD-271: no registro SEM área (Manutenção e Outros), `area_id` é null e `local` diz qual.
 * @param {{ atividade_id: string, atividade_nome: string, ultimo_dia: string, area_id: string|null, local?: string|null, dias_parado: number, limite_dias: number }} d
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeServicoParado = (d, options = undefined) =>
  new AppError(
    'ATIVIDADE_SERVICO_PARADO',
    `${d.atividade_nome} está parada desde ${d.ultimo_dia} (mais de ${d.limite_dias} dias sem lançamento): diga se o registro é continuação dela ou um serviço novo; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), ...d } }
  );

/** D-PROD-200 — status da atividade e do apontamento, como aparecem nas frases. */
const ROTULO_DO_STATUS_ATIVIDADE = Object.freeze({
  ABERTA: 'aberta',
  CONCLUIDA: 'concluída',
  CANCELADA: 'cancelada',
  CONFIRMADO: 'confirmado',
  CANCELADO: 'cancelado',
  // D-PROD-249: o ciclo da área da atividade.
  PLANEJADA: 'planejada (não iniciada)',
  EM_ANDAMENTO: 'em andamento',
});

/** D-PROD-202 — como cada entidade aparece nas frases de status. */
const ROTULO_DA_ENTIDADE_ATIVIDADE = Object.freeze({
  atividade: 'a atividade',
  apontamento: 'o apontamento',
  linha_produto: 'a linha de produto',
  linha_maquina: 'a linha de máquina',
  // D-PROD-249 — a área de uma atividade de várias áreas.
  area: 'a área da atividade',
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
  // D-PROD-202 (Fatia 3): as linhas de produto e de máquina do apontamento.
  lancar_linha: 'só apontamento confirmado de atividade aberta recebe linha (produto, máquina, mão de obra ou serviço)',
  editar_linha: 'só linha confirmada, de apontamento confirmado e atividade aberta, é editada',
  cancelar_linha: 'só linha confirmada, de apontamento confirmado e atividade aberta, é cancelada',
  // D-PROD-211 (Fatia 5): o abastecimento ligado ao lançamento do dia.
  lancar_abastecimento: 'só apontamento confirmado de atividade aberta recebe abastecimento',
  cancelar_abastecimento: 'só abastecimento de atividade aberta é cancelado (a concluída precisa ser reaberta antes)',
  // D-PROD-249 — as áreas da atividade.
  adicionar_area: 'só atividade aberta recebe área nova',
  editar_area: 'só área de atividade aberta é alterada',
  iniciar_area: 'só área planejada (não iniciada), de atividade aberta, é iniciada',
  concluir_area: 'só área em andamento, de atividade aberta, é concluída',
  reabrir_area: 'só área concluída, de atividade aberta, é reaberta',
  remover_area: 'só área planejada (não iniciada) e sem lançamento, de atividade aberta, sai da atividade',
  lancar_na_area: 'só área em andamento recebe lançamento (inicie a área planejada ou reabra a concluída)',
});

/**
 * D-PROD-200 — a ação não é permitida no status atual da atividade (ou do
 * apontamento, ou da linha — D-PROD-202): `details.status`, `details.acao` e `details.entidade`.
 * @param {{ status: string, acao: string, entidade?: 'atividade'|'apontamento'|'linha_produto'|'linha_maquina'|'linha_mao_obra'|'linha_servico'|'area' }} situacao
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
 * @param {{ entidade?: 'atividade'|'apontamento'|'area' }} [alvo]
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeVersaoConflito = (versaoAtual, versaoInformada, { entidade = 'atividade' } = {}, options = undefined) =>
  new AppError(
    'ATIVIDADE_VERSAO_CONFLITO',
    entidade === 'apontamento'
      ? 'o apontamento foi alterado por outra pessoa desde que você o abriu; recarregue e tente de novo; nada foi gravado'
      : entidade === 'area'
        ? 'a área da atividade foi alterada por outra pessoa desde que você a abriu; recarregue e tente de novo; nada foi gravado'
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

// D-PROD-202 — Lançamento de Atividades (Fatia 3): as LINHAS que geram custo do
// apontamento — produto (`AtividadeApontamentoProduto`, baixa de estoque pelo
// motor FIFO) e máquina (`AtividadeApontamentoMaquina`, uso por medidor).
// Contrato `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`.

/** D-PROD-202/203 — rótulo e entidade de cada tipo de linha do apontamento. */
const TIPOS_DE_LINHA_ATIVIDADE = Object.freeze({
  produto: Object.freeze({ rotulo: 'linha de produto', entidade: 'linha_produto' }),
  maquina: Object.freeze({ rotulo: 'linha de máquina', entidade: 'linha_maquina' }),
  mao_obra: Object.freeze({ rotulo: 'linha de mão de obra', entidade: 'linha_mao_obra' }),
  servico: Object.freeze({ rotulo: 'linha de serviço', entidade: 'linha_servico' }),
});

/**
 * D-PROD-202 — linha de outro apontamento, atividade, empresa ou tenant =
 * inexistente (o mesmo corpo: sem oráculo). `details.entidade` diz qual linha
 * (D-PROD-207: também `linha_mao_obra` e `linha_servico`).
 * @param {'produto'|'maquina'|'mao_obra'|'servico'} tipo
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeLinhaNotFound = (tipo, options = undefined) => {
  const t = TIPOS_DE_LINHA_ATIVIDADE[tipo] ?? TIPOS_DE_LINHA_ATIVIDADE.produto;
  return new AppError('ATIVIDADE_LINHA_NOT_FOUND', `${t.rotulo} não encontrada neste apontamento`, {
    ...options,
    details: { ...(options?.details ?? {}), entidade: t.entidade },
  });
};

/**
 * D-PROD-202 — frase de cada linha recusada, por coluna e `reason` (toda
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
  quantidade: Object.freeze({
    quantidade_nao_positiva: 'a quantidade deve ser maior que zero',
    // D-PROD-207 (mão de obra e serviço).
    obrigatoria: 'informe a quantidade',
    nao_positiva: 'a quantidade deve ser maior que zero',
    custo_excede_limite: 'o custo da linha (quantidade × valor unitário) passa do limite da coluna',
  }),
  // D-PROD-207 — edição de linha de mão de obra/serviço sem mudança real.
  corpo: Object.freeze({ sem_alteracao: 'os dados enviados são os mesmos da linha gravada: não há o que alterar' }),
  // D-PROD-207 — linha de mão de obra. D-PROD-208: o parceiro (funcionário ou terceiro), recusa uniforme.
  parceiro_id: Object.freeze({
    parceiro_invalido: 'o parceiro não foi encontrado como funcionário ou prestador de serviço ativo desta fazenda',
  }),
  tipo_medida: Object.freeze({ obrigatorio: 'informe se a mão de obra é por hora, por diária ou por tarefa' }),
  custo_unitario: Object.freeze({
    obrigatorio: 'informe o custo unitário (na tarefa do funcionário e em qualquer medida do terceiro)',
    nao_aceito: 'por hora ou por diária, o custo do funcionário vem do cadastro do parceiro: não informe o custo unitário',
  }),
  // D-PROD-207 — linha de serviço.
  servico_id: Object.freeze({
    inexistente: 'o serviço não foi encontrado',
    outra_empresa: 'o serviço é de outra fazenda',
    inativo: 'o serviço está inativo',
  }),
  fornecedor_parceiro_id: Object.freeze({
    parceiro_invalido: 'o parceiro não foi encontrado como prestador de serviço ativo desta fazenda',
  }),
  valor_unitario: Object.freeze({ obrigatorio: 'informe o valor unitário do serviço' }),
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
 * D-PROD-202 — linha de produto ou de máquina recusada (um só código;
 * `details.field`/`details.reason` dizem qual; `details.entidade`
 * `linha_produto` | `linha_maquina`, D-PROD-207 `linha_mao_obra` |
 * `linha_servico`). Id de outro tenant é `inexistente`.
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
 * D-PROD-202 — o uso da linha de máquina passa do teto de salto do tipo
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

/** D-PROD-202 — frase de cada estorno exato recusado de linha de produto, por `reason`. */
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
 * D-PROD-202 — o estorno exato de uma linha de produto (editar, cancelar a
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
 * D-PROD-202 — a data do apontamento não muda com linha de produto ou de
 * máquina CONFIRMADA (a saída de estoque e a leitura do medidor estão nesta
 * data): cancelar e lançar de novo. `details.linhas_produto`/`linhas_maquina`.
 * D-PROD-207: também com linha de mão de obra ou de serviço confirmada
 * (`details.linhas_mao_obra`/`linhas_servico`).
 * @param {{ produtos: number, maquinas: number, maoObra?: number, servicos?: number }} contagem
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const atividadeDataComLinhas = ({ produtos, maquinas, maoObra = 0, servicos = 0 }, options = undefined) =>
  new AppError(
    'ATIVIDADE_DATA_COM_LINHAS',
    'a data do lançamento não pode mudar: há linha de produto, máquina, mão de obra ou serviço confirmada nesta data; cancele o lançamento e lance de novo na data certa; nada foi gravado',
    {
      ...options,
      details: {
        ...(options?.details ?? {}),
        field: 'data_operacional',
        reason: 'data_com_linhas',
        linhas_produto: produtos,
        linhas_maquina: maquinas,
        linhas_mao_obra: maoObra,
        linhas_servico: servicos,
      },
    }
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

// D-PROD-215 — Cadastro de Culturas da fazenda (tabela CADCULTURAS).
export const culturaNotFound = (message, options) =>
  new AppError('CULTURA_NOT_FOUND', message || 'cultura não encontrada', options);

export const culturaNomeConflito = (message, options) =>
  new AppError('CULTURA_NAME_CONFLICT', message || 'já existe cultura com este nome nesta fazenda', options);

export const culturaCodigoConflito = (message, options) =>
  new AppError('CULTURA_CODIGO_CONFLICT', message || 'já existe cultura com este código nesta fazenda', options);

// D-PROD-216 — cultura ligada a áreas não sai (FK RESTRICT).
export const culturaEmUso = (message, options) =>
  new AppError('CULTURA_EM_USO', message || 'a cultura está ligada a áreas e não pode ser excluída', options);

// D-PROD-207 — cadastro de Serviço da fazenda (Fatia 4). D-PROD-208: o de Funcionário saiu.
export const servicoNotFound = (message, options) =>
  new AppError('SERVICO_NOT_FOUND', message || 'serviço não encontrado nesta fazenda', options);

const MENSAGENS_REFERENCIA_SERVICO = Object.freeze({
  unidade_medida_id: Object.freeze({
    nao_encontrado: 'unidade de medida não encontrada neste cliente',
    inativo: 'unidade de medida inativa não pode ser escolhida',
  }),
  centro_custo_padrao_id: Object.freeze({
    nao_encontrado: 'centro de custo não encontrado nesta fazenda',
    inativo: 'centro de custo inativo não pode ser escolhido',
  }),
});

/**
 * @param {'unidade_medida_id'|'centro_custo_padrao_id'} field
 * @param {'nao_encontrado'|'inativo'} reason
 * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
 */
export const servicoReferenciaInvalida = (field, reason, options = undefined) =>
  new AppError(
    'SERVICO_REFERENCIA_INVALIDA',
    `${MENSAGENS_REFERENCIA_SERVICO[field]?.[reason] ?? 'referência do serviço recusada'}; nada foi gravado`,
    { ...options, details: { ...(options?.details ?? {}), field, reason } }
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

// D-PROD-203 — Formulações de suplemento da fazenda (tabela CADFORMULACAO).
export const formulacaoNotFound = (message, options) =>
  new AppError('FORMULACAO_NOT_FOUND', message || 'formulação não encontrada', options);

export const formulacaoNomeConflito = (message, options) =>
  new AppError('FORMULACAO_NAME_CONFLICT', message || 'já existe formulação com este nome nesta fazenda', options);

/**
 * D-PROD-203 — excluir formulação já usada em lançamento de suplementação: 409
 * com a contagem; a saída é inativar (o histórico continua apontando para ela).
 * @param {number} lancamentos
 */
export const formulacaoEmUso = (lancamentos, options) =>
  new AppError(
    'FORMULACAO_EM_USO',
    `Esta formulação já foi usada em ${lancamentos} lançamento(s) de suplementação e não pode ser excluída. Inative-a.`,
    { ...options, details: { ...(options?.details ?? {}), lancamentos } }
  );

// D-PROD-219 — Medição de Forragem (tabela MEDICAOFORRAGEM).
export const medicaoForragemNotFound = (message, options) =>
  new AppError('MEDICAO_FORRAGEM_NOT_FOUND', message || 'medição de forragem não encontrada', options);

// D-PROD-205 — Leitura de cocho (tabela LEITURACOCHO).
export const leituraCochoNotFound = (message, options) =>
  new AppError('LEITURA_COCHO_NOT_FOUND', message || 'leitura de cocho não encontrada', options);

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
