/**
 * D-PROD-203 (Fatia 4 do Lançamento de Atividades) — serviço das LINHAS DE MÃO
 * DE OBRA do apontamento (`AtividadeApontamentoMaoObra`), contrato
 * `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §3 e §5, no molde da
 * linha de máquina da Fatia 3.
 *
 * Regras (§3):
 *  - o TIPO da atividade precisa de `permite_mao_obra` (lida agora); sem ela →
 *    422 `ATIVIDADE_EXIGIDA_PELO_TIPO` (`field: funcionario_id`,
 *    `reason: permite_mao_obra`);
 *  - apontamento CONFIRMADO de atividade ABERTA (senão 409
 *    `ATIVIDADE_STATUS_INVALIDO`); funcionário da fazenda e ativo (vínculo
 *    novo; manter o gravado, mesmo inativado depois, pode). Outro tenant →
 *    `inexistente` (sem oráculo);
 *  - custo: `HORA` → `custo_unitario` = snapshot de `Funcionario.custo_hora`;
 *    `DIARIA` → de `custo_diaria`; o corpo NÃO aceita `custo_unitario` nesses
 *    casos (422 `nao_aceito`). Sem custo no cadastro → custo nulo (a linha
 *    entra, sem custo). `TAREFA` → `custo_unitario` obrigatório no corpo (≥ 0).
 *    `custo_total = quantidade × custo_unitario` (4 casas, meio para cima, como
 *    a máquina). O CHECK da tabela exige os dois nulos ou os dois preenchidos;
 *  - editar = cancelar a linha (origem `EDICAO`) + linha nova, na mesma
 *    transação; cancelar com motivo (origem `LINHA`);
 *  - toda escrita de linha pela rota leva `operation_id` (idempotência) e a
 *    `versao` do APONTAMENTO (CAS), incrementada uma vez;
 *  - nada de financeiro: nenhuma operação, título ou rateio sai daqui.
 *
 * Para o serviço do apontamento, exporta `criarLinhasMaoObra` (lançar e
 * repetir com `mao_obra[]`), `cancelarLinhasMaoObraDoApontamento` (cascata),
 * `contarLinhasMaoObraConfirmadas` (trava da data), `comoLinhaMaoObraPublica`
 * e `totaisDaMaoObraDaAtividade` (`GET /atividades/:id/totais`).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { atividadeExigidaPeloTipo, atividadeLinhaInvalida, atividadeLinhaNotFound, atividadeStatusInvalido, concurrencyConflict } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, Dec, arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { decimalDoCorpo, idOuNulo, iso, motivoDoCorpo, operationIdDaLinha, t4, temCampo, usuarioPublico } from './atividadeComum.js';
import {
  ORIGENS_CANCELAMENTO,
  STATUS_LINHA,
  buscarLinha,
  cancelarLinhas,
  contarConfirmadasDoApontamento,
  inserirLinha,
  lerFuncionarioDaLinha,
  listarLinhasDosApontamentos,
  proximaOrdem,
  somarPorFuncionario,
  tipoPermiteMaoObra,
} from './atividadeApontamentoMaoObraRepository.js';
import { LIMITE_DECIMAL_14_4, MOTIVO_DA_EDICAO, escreverLinhaDoApontamento, itensDaLista } from './atividadeLinhaCustoComum.js';

// ─── constantes ─────────────────────────────────────────────────────────────

/** Entidade da auditoria da linha de mão de obra. */
export const ENTIDADE_LINHA_MAO_OBRA = 'AtividadeApontamentoMaoObra';

/** Tipos de medida (CHECK `…_valores_check`). */
export const TIPOS_MEDIDA = Object.freeze(['HORA', 'DIARIA', 'TAREFA']);

/** Coluna de custo do cadastro do funcionário que dá o snapshot de cada medida. */
const CUSTO_DO_CADASTRO = Object.freeze({ HORA: 'custo_hora', DIARIA: 'custo_diaria' });

/** Decimais do corpo da linha (a guarda anti-coerção das rotas). */
export const DECIMAIS_DA_LINHA_MAO_OBRA = Object.freeze(['quantidade', 'custo_unitario']);

/** Ações da auditoria e tipos de operação da idempotência. */
export const ACOES_LINHA_MAO_OBRA = Object.freeze({
  lancar: 'atividade_mao_obra.lancar',
  editar: 'atividade_mao_obra.editar',
  cancelar: 'atividade_mao_obra.cancelar',
  reenvio_conflitante: 'atividade_mao_obra.reenvio_conflitante',
});

const CASAS = 4;

/** Detalhe comum das recusas da linha de mão de obra. */
const ENTIDADE_ERRO = Object.freeze({ entidade: 'linha_mao_obra' });

/**
 * Recusa da linha de mão de obra (`ATIVIDADE_LINHA_INVALIDA`, entidade `linha_mao_obra`).
 * @param {string} field @param {string} reason @param {Record<string, unknown>} [extra]
 */
const recusa = (field, reason, extra = {}) => atividadeLinhaInvalida(field, reason, { ...ENTIDADE_ERRO, ...extra });

// ─── normalização do corpo ──────────────────────────────────────────────────

/**
 * @typedef {{ funcionario_id: string|null, tipo_medida: string|null, quantidade: string|null,
 *   custo_unitario: string|null, observacao: string|null }} EstadoDaLinha
 */

/** @type {Readonly<EstadoDaLinha>} */
const LINHA_VAZIA = Object.freeze({ funcionario_id: null, tipo_medida: null, quantidade: null, custo_unitario: null, observacao: null });

/**
 * Só os campos da linha PRESENTES no corpo, normalizados (ausente ≠ null).
 * @param {Record<string, any>} corpo
 * @returns {Partial<EstadoDaLinha>}
 */
export const camposDaLinha = (corpo) => {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  /** @type {Record<string, any>} */
  const saida = {};
  if (temCampo(c, 'funcionario_id') && c.funcionario_id !== undefined) saida.funcionario_id = idOuNulo(c.funcionario_id, 'funcionario_id');
  if (temCampo(c, 'tipo_medida') && c.tipo_medida !== undefined) {
    if (c.tipo_medida !== null && !TIPOS_MEDIDA.includes(c.tipo_medida)) {
      throw invalido(`tipo_medida deve ser ${TIPOS_MEDIDA.join(', ')}`, { field: 'tipo_medida', reason: 'formato' });
    }
    saida.tipo_medida = c.tipo_medida;
  }
  for (const campo of DECIMAIS_DA_LINHA_MAO_OBRA) if (temCampo(c, campo) && c[campo] !== undefined) saida[campo] = decimalDoCorpo(c[campo], campo);
  if (temCampo(c, 'observacao') && c.observacao !== undefined) saida.observacao = textoDoCorpo(c.observacao, 'observacao') ?? null;
  return saida;
};

/**
 * Linha gravada na forma do estado: a base da edição. O custo só é dado de
 * entrada na TAREFA (em hora e diária é o snapshot do cadastro).
 * @param {any} r
 * @returns {EstadoDaLinha}
 */
const estadoGravado = (r) => ({
  funcionario_id: r.funcionario_id,
  tipo_medida: r.tipo_medida,
  quantidade: t4(r.quantidade),
  custo_unitario: r.tipo_medida === 'TAREFA' ? t4(r.custo_unitario) : null,
  observacao: r.observacao ?? null,
});

/**
 * Edição: o gravado + os campos enviados. Trocar o tipo de medida descarta o
 * custo digitado da tarefa (o da hora/diária vem do cadastro).
 * @param {EstadoDaLinha} gravado @param {Partial<EstadoDaLinha>} campos
 * @returns {EstadoDaLinha}
 */
const mesclar = (gravado, campos) => {
  const e = { ...gravado, ...campos };
  if (temCampo(campos, 'tipo_medida') && campos.tipo_medida !== gravado.tipo_medida && !temCampo(campos, 'custo_unitario')) e.custo_unitario = null;
  return e;
};

// ─── regras ─────────────────────────────────────────────────────────────────

/**
 * Regra ÚNICA da linha (rota, lançamento com `mao_obra[]` e edição): confere o
 * estado final e devolve as colunas a gravar.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, estado: EstadoDaLinha, campos: Partial<EstadoDaLinha>,
 *   gravado?: EstadoDaLinha|null, extra?: Record<string, unknown> }} pedido
 *   `campos` = o que o corpo trouxe (o custo digitado só é recusado se veio no corpo)
 */
const planejarLinha = async (tx, { clienteId, empresaId, atividadeId, estado, campos, gravado = null, extra = {} }) => {
  if (!(await tipoPermiteMaoObra(tx, clienteId, empresaId, atividadeId))) {
    throw atividadeExigidaPeloTipo('funcionario_id', { details: { ...ENTIDADE_ERRO, ...extra } });
  }
  if (!estado.funcionario_id) throw invalido('funcionario_id é obrigatório', { field: 'funcionario_id', reason: 'obrigatorio', ...ENTIDADE_ERRO, ...extra });
  const funcionario = await lerFuncionarioDaLinha(tx, clienteId, estado.funcionario_id);
  if (!funcionario) throw recusa('funcionario_id', 'inexistente', extra);
  if (funcionario.empresa_id !== empresaId) throw recusa('funcionario_id', 'outra_empresa', extra);
  if (!funcionario.ativo && funcionario.id !== (gravado?.funcionario_id ?? null)) throw recusa('funcionario_id', 'inativo', extra);

  const tipo = estado.tipo_medida;
  if (!tipo) throw recusa('tipo_medida', 'obrigatorio', extra);
  if (estado.quantidade === null) throw recusa('quantidade', 'obrigatoria', extra);
  const quantidade = dec(estado.quantidade);
  if (!quantidade.gt(0)) throw recusa('quantidade', 'nao_positiva', extra);

  /** @type {string|null} */
  let custoUnitario;
  if (tipo === 'TAREFA') {
    if (estado.custo_unitario === null) throw recusa('custo_unitario', 'obrigatorio', extra);
    custoUnitario = estado.custo_unitario;
  } else {
    if (temCampo(campos, 'custo_unitario') && campos.custo_unitario !== null) throw recusa('custo_unitario', 'nao_aceito', { ...extra, tipo_medida: tipo });
    custoUnitario = t4(funcionario[CUSTO_DO_CADASTRO[/** @type {'HORA'|'DIARIA'} */ (tipo)]]);
  }
  const custoTotal = custoUnitario === null ? null : arredondar(quantidade.times(dec(custoUnitario)), CASAS_CUSTO);
  if (custoTotal !== null && custoTotal.gt(LIMITE_DECIMAL_14_4)) throw recusa('quantidade', 'custo_excede_limite', { ...extra, custo_unitario: custoUnitario });

  return {
    funcionario_id: funcionario.id,
    tipo_medida: tipo,
    quantidade: quantidade.toFixed(CASAS),
    custo_unitario: custoUnitario,
    custo_total: custoTotal === null ? null : custoTotal.toFixed(CASAS),
    observacao: estado.observacao ?? null,
  };
};

// ─── formas públicas e auditoria ────────────────────────────────────────────

/** Resumo do funcionário: os custos são os ATUAIS do cadastro (a prévia da tela); os da linha são o snapshot. @param {any} f */
const funcionarioPublico = (f) =>
  f ? { id: f.id, numero: f.numero, nome: f.nome, cargo: f.cargo ?? null, tipo: f.tipo, custo_hora: t4(f.custo_hora), custo_diaria: t4(f.custo_diaria) } : null;

/**
 * Forma pública da LINHA DE MÃO DE OBRA (lista e detalhe do apontamento, e as
 * escritas). Decimais com 4 casas; instantes ISO.
 * @param {any} r  linha lida com `INCLUIR_LINHA_MAO_OBRA`
 */
export const comoLinhaMaoObraPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  funcionario_id: r.funcionario_id,
  funcionario: funcionarioPublico(r.funcionario),
  tipo_medida: r.tipo_medida,
  quantidade: t4(r.quantidade),
  custo_unitario: t4(r.custo_unitario),
  custo_total: t4(r.custo_total),
  observacao: r.observacao ?? null,
  cancelado_em: iso(r.cancelado_em),
  cancelado_por: usuarioPublico(r.canceladoPor),
  motivo_cancelamento: r.motivo_cancelamento ?? null,
  cancelamento_origem: r.cancelamento_origem ?? null,
  criado_por: usuarioPublico(r.criadoPor),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

/** Auditoria: as colunas, sem texto livre (só se há observação ou motivo). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  funcionario_id: r.funcionario_id,
  tipo_medida: r.tipo_medida,
  quantidade: t4(r.quantidade),
  custo_unitario: t4(r.custo_unitario),
  custo_total: t4(r.custo_total),
  cancelamento_origem: r.cancelamento_origem ?? null,
  tem_observacao: Boolean(r.observacao),
  tem_motivo_cancelamento: Boolean(r.motivo_cancelamento),
});

// ─── para o serviço do apontamento ──────────────────────────────────────────

/**
 * Linhas de mão de obra (confirmadas e canceladas) dos apontamentos dados, na
 * forma pública, por apontamento.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string[]} apontamentoIds
 * @returns {Promise<Map<string, Array<ReturnType<typeof comoLinhaMaoObraPublica>>>>}
 */
export const linhasMaoObraDosApontamentos = async (db, clienteId, empresaId, apontamentoIds) => {
  /** @type {Map<string, Array<ReturnType<typeof comoLinhaMaoObraPublica>>>} */
  const mapa = new Map(apontamentoIds.map((id) => [id, []]));
  for (const r of await listarLinhasDosApontamentos(db, clienteId, empresaId, apontamentoIds)) {
    const lista = mapa.get(r.apontamento_id) ?? [];
    lista.push(comoLinhaMaoObraPublica(r));
    mapa.set(r.apontamento_id, lista);
  }
  return mapa;
};

/**
 * Linhas de mão de obra CONFIRMADAS do apontamento (a data dele não muda com elas: 409).
 * @param {any} db @param {{ clienteId: string, empresaId: string, apontamentoId: string }} alvo
 * @returns {Promise<number>}
 */
export const contarLinhasMaoObraConfirmadas = (db, { clienteId, empresaId, apontamentoId }) =>
  contarConfirmadasDoApontamento(db, clienteId, empresaId, apontamentoId);

/**
 * INSERT da linha (já planejada) com a próxima `ordem` do apontamento, relida
 * com os resumos, e a auditoria.
 * @param {any} tx @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ clienteId: string, empresaId: string, apontamentoId: string, dados: Record<string, unknown>,
 *   operationId: string, acao?: string, auditoriaExtra?: Record<string, unknown>, anterior?: any }} pedido
 */
const gravarLinha = async (tx, contexto, { clienteId, empresaId, apontamentoId, dados, operationId, acao = ACOES_LINHA_MAO_OBRA.lancar, auditoriaExtra = {}, anterior = null }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ordem = await proximaOrdem(tx, clienteId, apontamentoId);
  const { id } = await inserirLinha(tx, {
    ...dados,
    cliente_id: clienteId,
    empresa_id: empresaId,
    apontamento_id: apontamentoId,
    ordem,
    status: STATUS_LINHA.CONFIRMADO,
    operation_id: operationId,
    criado_por_usuario_id: auth.usuarioId ?? null,
  });
  const linha = await buscarLinha(tx, clienteId, empresaId, apontamentoId, id);
  await registrarEvento(
    contexto,
    {
      acao,
      entidade: ENTIDADE_LINHA_MAO_OBRA,
      entidadeId: id,
      ...(anterior ? { dadosAnteriores: paraAuditoria(anterior) } : {}),
      dadosNovos: { ...paraAuditoria(linha), ...auditoriaExtra },
    },
    tx
  );
  return linha;
};

/**
 * Lança as linhas de `mao_obra[]` de um apontamento NOVO (lançar e "repetir"),
 * na transação de quem chama, com as MESMAS regras da rota. Quem chama já
 * travou a Empresa e a atividade, conferiu que ela está ABERTA, inseriu o
 * apontamento CONFIRMADO e cuida da idempotência. Cada linha grava
 * `<operationId>:o<n>` (sem chave, `<apontamento.id>:o<n>`). Recusas levam
 * `details.linha_indice`.
 * @param {any} tx
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ apontamento: { id: string, empresa_id: string }, atividade: { id: string }, linhas: unknown, operationId?: string|null }} pedido
 * @returns {Promise<Array<ReturnType<typeof comoLinhaMaoObraPublica>>>}
 */
export const criarLinhasMaoObra = async (tx, contexto, { apontamento, atividade, linhas, operationId = null }) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const itens = itensDaLista(linhas, 'mao_obra');
  const criadas = [];
  for (const [i, item] of itens.entries()) {
    const campos = camposDaLinha(item);
    /** @type {EstadoDaLinha} */
    const estado = { ...LINHA_VAZIA, ...campos };
    const dados = await planejarLinha(tx, { clienteId: cli, empresaId: apontamento.empresa_id, atividadeId: atividade.id, estado, campos, extra: { linha_indice: i } });
    const linha = await gravarLinha(tx, contexto, {
      clienteId: cli,
      empresaId: apontamento.empresa_id,
      apontamentoId: apontamento.id,
      dados,
      operationId: operationIdDaLinha(operationId ?? apontamento.id, 'mao_obra', i),
    });
    criadas.push(comoLinhaMaoObraPublica(linha));
  }
  return criadas;
};

/**
 * Cascata do cancelamento (do apontamento ou da atividade): cancela num UPDATE
 * só TODAS as linhas de mão de obra CONFIRMADAS dos apontamentos dados, com o
 * MESMO motivo, instante, usuário e a origem. Devolve quantas.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, apontamentoIds: string[], usuarioId: string|null, motivo: string,
 *   agora: Date, origem: 'APONTAMENTO'|'ATIVIDADE' }} pedido
 * @returns {Promise<number>}
 */
export const cancelarLinhasMaoObraDoApontamento = async (tx, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, agora, origem }) => {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) throw new Error('cancelarLinhasMaoObraDoApontamento: `agora` tem de ser um Date válido');
  if (typeof motivo !== 'string' || !motivo.trim()) throw new Error('cancelarLinhasMaoObraDoApontamento: `motivo` tem de vir normalizado');
  if (origem !== ORIGENS_CANCELAMENTO.APONTAMENTO && origem !== ORIGENS_CANCELAMENTO.ATIVIDADE) {
    throw new Error('cancelarLinhasMaoObraDoApontamento: `origem` é APONTAMENTO ou ATIVIDADE');
  }
  if (!Array.isArray(apontamentoIds) || !apontamentoIds.length) return 0;
  return cancelarLinhas(
    tx,
    { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds } },
    { usuarioId: usuarioId ?? null, motivo, agora, origem }
  );
};

/**
 * Totais de mão de obra da atividade (`GET /atividades/:id/totais`): Σ
 * quantidade e Σ custo das linhas CONFIRMADAS de apontamentos CONFIRMADOS, por
 * funcionário e tipo de medida, em ordem de nome. `custo_total` do grupo é nulo
 * quando nenhuma linha dele tem custo; o geral idem.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<{ mao_obra: Array<{ funcionario_id: string, nome: string, tipo_medida: string, quantidade: string, custo_total: string|null }>, custo_total: string|null }>}
 */
export const totaisDaMaoObraDaAtividade = async (db, clienteId, empresaId, atividadeId) => {
  const linhas = await somarPorFuncionario(db, clienteId, empresaId, atividadeId);
  const comCusto = linhas.filter((l) => l.custo !== null && l.custo !== undefined);
  return {
    mao_obra: linhas.map((l) => ({
      funcionario_id: l.funcionario_id,
      nome: l.nome,
      tipo_medida: l.tipo_medida,
      quantidade: /** @type {string} */ (t4(l.quantidade)),
      custo_total: t4(l.custo),
    })),
    custo_total: comCusto.length ? comCusto.reduce((t, l) => t.plus(dec(l.custo)), new Dec(0)).toFixed(CASAS) : null,
  };
};

// ─── escrita pela rota ──────────────────────────────────────────────────────

/** O esqueleto comum, com a entidade e a chave da resposta desta linha. */
const escrever = (/** @type {any} */ contexto, /** @type {any} */ pedido) =>
  escreverLinhaDoApontamento(contexto, {
    ...pedido,
    entidade: ENTIDADE_LINHA_MAO_OBRA,
    acaoConflito: ACOES_LINHA_MAO_OBRA.reenvio_conflitante,
    chave: 'mao_obra',
    publica: comoLinhaMaoObraPublica,
  });

/**
 * Linha CONFIRMADA deste apontamento; senão 404 `ATIVIDADE_LINHA_NOT_FOUND` ou
 * 409 `ATIVIDADE_STATUS_INVALIDO` (entidade `linha_mao_obra`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} id
 * @param {'editar_linha'|'cancelar_linha'} acao
 */
const exigirLinhaConfirmada = async (tx, clienteId, empresaId, apontamentoId, id, acao) => {
  const linha = await buscarLinha(tx, clienteId, empresaId, apontamentoId, id);
  if (!linha) throw atividadeLinhaNotFound('mao_obra');
  if (linha.status !== STATUS_LINHA.CONFIRMADO) throw atividadeStatusInvalido({ status: linha.status, acao, entidade: 'linha_mao_obra' });
  return linha;
};

/**
 * `POST /atividades/:id/apontamentos/:apontamentoId/mao-obra` (201): lança UMA
 * linha de mão de obra. Corpo `{ empresa_id, versao, operation_id,
 * funcionario_id, tipo_medida, quantidade, custo_unitario?, observacao? }`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const lancarLinhaMaoObra = async (contexto, atividadeId, apontamentoId, corpo) => {
  const campos = camposDaLinha(corpo);
  /** @type {EstadoDaLinha} */
  const estado = { ...LINHA_VAZIA, ...campos };
  return escrever(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_MAO_OBRA.lancar,
    acao: 'lancar_linha',
    httpStatus: 201,
    fingerprint: { estado },
    executar: async (/** @type {any} */ tx, /** @type {{ clienteId: string, empresaId: string }} */ { clienteId, empresaId }) => {
      const dados = await planejarLinha(tx, { clienteId, empresaId, atividadeId, estado, campos });
      return gravarLinha(tx, contexto, { clienteId, empresaId, apontamentoId, dados, operationId: corpo.operation_id });
    },
  });
};

/**
 * `PATCH …/mao-obra/:linhaId`: editar = cancelar a linha (origem `EDICAO`) +
 * linha NOVA com o gravado e os campos enviados, na mesma transação. Devolve a
 * linha nova em `mao_obra`; a antiga fica em `apontamento.mao_obra[]`, cancelada.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const editarLinhaMaoObra = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const campos = camposDaLinha(corpo);
  const auth = exigirAuthContext(contexto?.auth);
  return escrever(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_MAO_OBRA.editar,
    acao: 'editar_linha',
    httpStatus: 200,
    fingerprint: { linha_id: linhaId, campos },
    executar: async (/** @type {any} */ tx, /** @type {{ clienteId: string, empresaId: string, agora: Date }} */ { clienteId, empresaId, agora }) => {
      const anterior = await exigirLinhaConfirmada(tx, clienteId, empresaId, apontamentoId, linhaId, 'editar_linha');
      const gravado = estadoGravado(anterior);
      const estado = mesclar(gravado, campos);
      const cancelada = await cancelarLinhas(
        tx,
        { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id: linhaId },
        { usuarioId: auth.usuarioId ?? null, motivo: MOTIVO_DA_EDICAO, agora, origem: ORIGENS_CANCELAMENTO.EDICAO }
      );
      if (cancelada !== 1) throw concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE);
      const dados = await planejarLinha(tx, { clienteId, empresaId, atividadeId, estado, campos, gravado });
      return gravarLinha(tx, contexto, {
        clienteId,
        empresaId,
        apontamentoId,
        dados,
        operationId: corpo.operation_id,
        acao: ACOES_LINHA_MAO_OBRA.editar,
        anterior,
        auditoriaExtra: { substitui_linha_id: anterior.id },
      });
    },
  });
};

/**
 * `POST …/mao-obra/:linhaId/cancelar`: CONFIRMADO → CANCELADO com quem, quando
 * e motivo (3..500), origem `LINHA`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const cancelarLinhaMaoObra = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const motivo = motivoDoCorpo(corpo.motivo);
  return escrever(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_MAO_OBRA.cancelar,
    acao: 'cancelar_linha',
    httpStatus: 200,
    fingerprint: { linha_id: linhaId, motivo },
    executar: async (/** @type {any} */ tx, /** @type {{ clienteId: string, empresaId: string, agora: Date }} */ { clienteId, empresaId, agora }) => {
      const antes = await exigirLinhaConfirmada(tx, clienteId, empresaId, apontamentoId, linhaId, 'cancelar_linha');
      const n = await cancelarLinhas(
        tx,
        { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id: linhaId },
        { usuarioId: auth.usuarioId ?? null, motivo, agora, origem: ORIGENS_CANCELAMENTO.LINHA }
      );
      if (n !== 1) throw concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE);
      const depois = await buscarLinha(tx, clienteId, empresaId, apontamentoId, linhaId);
      await registrarEvento(
        contexto,
        { acao: ACOES_LINHA_MAO_OBRA.cancelar, entidade: ENTIDADE_LINHA_MAO_OBRA, entidadeId: linhaId, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) },
        tx
      );
      return depois;
    },
  });
};
