/**
 * D-PROD-203 (Fatia 4 do Lançamento de Atividades) — serviço das LINHAS DE
 * SERVIÇO (de terceiro) do apontamento (`AtividadeApontamentoServico`),
 * contrato `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §4 e §5, no
 * molde da linha de máquina da Fatia 3.
 *
 * Regras (§4):
 *  - o TIPO da atividade precisa de `permite_servico` (lida agora); sem ela →
 *    422 `ATIVIDADE_EXIGIDA_PELO_TIPO` (`field: servico_id`,
 *    `reason: permite_servico`);
 *  - apontamento CONFIRMADO de atividade ABERTA; serviço da fazenda e ativo
 *    (vínculo novo). `unidade` = SNAPSHOT da sigla da unidade de medida do
 *    serviço (nunca do usuário);
 *  - `valor_unitario` obrigatório no corpo (≥ 0; a tela preenche com
 *    `valor_referencia`); `valor_total = quantidade × valor_unitario` (4 casas);
 *  - `fornecedor_parceiro_id` opcional: parceiro ATIVO, da MESMA fazenda e com o
 *    papel `prestador_servico` (`lerPapeis(tipos)`), lido FOR KEY SHARE (molde
 *    `bemPatrimonialService.lerReferencia`). Qualquer outro caso (inexistente,
 *    outro tenant, outra fazenda, inativo, sem o papel) → a MESMA recusa 422
 *    `parceiro_invalido` (sem revelar se o id existe). Conferido só quando o
 *    vínculo é novo ou mudou (manter o gravado pode);
 *  - editar = cancelar (`EDICAO`) + linha nova (sem mudança real → 422
 *    `sem_alteracao`); cancelar com motivo (`LINHA`);
 *  - idempotência por `operation_id`, CAS pela `versao` do apontamento;
 *  - nada de financeiro: nenhuma operação, título ou rateio sai daqui.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { atividadeExigidaPeloTipo, atividadeLinhaInvalida, atividadeLinhaNotFound, atividadeStatusInvalido, concurrencyConflict } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, Dec, arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { lerPapeis } from '../fornecedores/fornecedorDominio.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { decimalDoCorpo, idOuNulo, iso, motivoDoCorpo, operationIdDaLinha, t4, temCampo, usuarioPublico } from './atividadeComum.js';
import {
  ORIGENS_CANCELAMENTO,
  STATUS_LINHA,
  buscarLinha,
  cancelarLinhas,
  contarConfirmadasDoApontamento,
  inserirLinha,
  lerParceiroDaLinha,
  lerServicoDaLinha,
  listarLinhasDosApontamentos,
  proximaOrdem,
  somarPorServico,
  tipoPermiteServico,
} from './atividadeApontamentoServicoRepository.js';
import { LIMITE_DECIMAL_14_4, MOTIVO_DA_EDICAO, escreverLinhaDoApontamento, itensDaLista } from './atividadeLinhaCustoComum.js';

// ─── constantes ─────────────────────────────────────────────────────────────

/** Entidade da auditoria da linha de serviço. */
export const ENTIDADE_LINHA_SERVICO = 'AtividadeApontamentoServico';

/** Papel que o parceiro da linha tem de ter (`fornecedorDominio.PAPEIS`). */
export const PAPEL_PRESTADOR = 'prestador_servico';

/** Decimais do corpo da linha (a guarda anti-coerção das rotas). */
export const DECIMAIS_DA_LINHA_SERVICO = Object.freeze(['quantidade', 'valor_unitario']);

/** Teto do documento de referência (coluna VarChar(120)). */
export const DOCUMENTO_REFERENCIA_MAXIMO = 120;

/** Ações da auditoria e tipos de operação da idempotência. */
export const ACOES_LINHA_SERVICO = Object.freeze({
  lancar: 'atividade_servico.lancar',
  editar: 'atividade_servico.editar',
  cancelar: 'atividade_servico.cancelar',
  reenvio_conflitante: 'atividade_servico.reenvio_conflitante',
});

const CASAS = 4;

/** Detalhe comum das recusas da linha de serviço. */
const ENTIDADE_ERRO = Object.freeze({ entidade: 'linha_servico' });

/**
 * Recusa da linha de serviço (`ATIVIDADE_LINHA_INVALIDA`, entidade `linha_servico`).
 * @param {string} field @param {string} reason @param {Record<string, unknown>} [extra]
 */
const recusa = (field, reason, extra = {}) => atividadeLinhaInvalida(field, reason, { ...ENTIDADE_ERRO, ...extra });

// ─── normalização do corpo ──────────────────────────────────────────────────

/**
 * @typedef {{ servico_id: string|null, fornecedor_parceiro_id: string|null, quantidade: string|null,
 *   valor_unitario: string|null, documento_referencia: string|null, observacao: string|null }} EstadoDaLinha
 */

/** @type {Readonly<EstadoDaLinha>} */
const LINHA_VAZIA = Object.freeze({
  servico_id: null,
  fornecedor_parceiro_id: null,
  quantidade: null,
  valor_unitario: null,
  documento_referencia: null,
  observacao: null,
});

/**
 * Só os campos da linha PRESENTES no corpo, normalizados (ausente ≠ null: na
 * edição, null limpa o opcional).
 * @param {Record<string, any>} corpo
 * @returns {Partial<EstadoDaLinha>}
 */
export const camposDaLinha = (corpo) => {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  /** @type {Record<string, any>} */
  const saida = {};
  for (const campo of ['servico_id', 'fornecedor_parceiro_id']) if (temCampo(c, campo) && c[campo] !== undefined) saida[campo] = idOuNulo(c[campo], campo);
  for (const campo of DECIMAIS_DA_LINHA_SERVICO) if (temCampo(c, campo) && c[campo] !== undefined) saida[campo] = decimalDoCorpo(c[campo], campo);
  if (temCampo(c, 'documento_referencia') && c.documento_referencia !== undefined) {
    const doc = textoDoCorpo(c.documento_referencia, 'documento_referencia') ?? null;
    if (doc !== null && [...doc].length > DOCUMENTO_REFERENCIA_MAXIMO) {
      throw invalido(`documento_referencia deve ter no máximo ${DOCUMENTO_REFERENCIA_MAXIMO} caracteres`, { field: 'documento_referencia', reason: 'longo' });
    }
    saida.documento_referencia = doc;
  }
  if (temCampo(c, 'observacao') && c.observacao !== undefined) saida.observacao = textoDoCorpo(c.observacao, 'observacao') ?? null;
  return saida;
};

/** Linha gravada na forma do estado: a base da edição. @param {any} r @returns {EstadoDaLinha} */
const estadoGravado = (r) => ({
  servico_id: r.servico_id,
  fornecedor_parceiro_id: r.fornecedor_parceiro_id ?? null,
  quantidade: t4(r.quantidade),
  valor_unitario: t4(r.valor_unitario),
  documento_referencia: r.documento_referencia ?? null,
  observacao: r.observacao ?? null,
});

/**
 * O estado mesclado da edição é o MESMO gravado (campo a campo; os decimais já
 * vêm canônicos, com 4 casas)?
 * @param {EstadoDaLinha} gravado @param {EstadoDaLinha} estado
 */
const semAlteracao = (gravado, estado) =>
  /** @type {Array<keyof EstadoDaLinha>} */ (Object.keys(LINHA_VAZIA)).every((campo) => (estado[campo] ?? null) === (gravado[campo] ?? null));

// ─── regras ─────────────────────────────────────────────────────────────────

/**
 * O parceiro da linha, quando informado: ativo, da fazenda e prestador de
 * serviço; qualquer falha é a MESMA recusa (sem oráculo). Lido FOR KEY SHARE
 * sempre (segura a FK até o commit); conferido só no vínculo novo ou trocado.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string|null} id @param {string|null} gravadoId
 * @param {Record<string, unknown>} extra
 */
const exigirParceiro = async (tx, clienteId, empresaId, id, gravadoId, extra) => {
  if (!id) return;
  const parceiro = await lerParceiroDaLinha(tx, clienteId, id);
  if (id === gravadoId && parceiro) return;
  const ok = parceiro && parceiro.empresa_id === empresaId && parceiro.ativo === true && lerPapeis(parceiro.tipos).papeis.includes(PAPEL_PRESTADOR);
  if (!ok) throw recusa('fornecedor_parceiro_id', 'parceiro_invalido', extra);
};

/**
 * Regra ÚNICA da linha (rota, lançamento com `servicos[]` e edição): confere o
 * estado final e devolve as colunas a gravar.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, estado: EstadoDaLinha,
 *   gravado?: EstadoDaLinha|null, extra?: Record<string, unknown> }} pedido
 */
const planejarLinha = async (tx, { clienteId, empresaId, atividadeId, estado, gravado = null, extra = {} }) => {
  if (!(await tipoPermiteServico(tx, clienteId, empresaId, atividadeId))) {
    throw atividadeExigidaPeloTipo('servico_id', { details: { ...ENTIDADE_ERRO, ...extra } });
  }
  if (!estado.servico_id) throw invalido('servico_id é obrigatório', { field: 'servico_id', reason: 'obrigatorio', ...ENTIDADE_ERRO, ...extra });
  const servico = await lerServicoDaLinha(tx, clienteId, estado.servico_id);
  if (!servico) throw recusa('servico_id', 'inexistente', extra);
  if (servico.empresa_id !== empresaId) throw recusa('servico_id', 'outra_empresa', extra);
  if (!servico.ativo && servico.id !== (gravado?.servico_id ?? null)) throw recusa('servico_id', 'inativo', extra);

  await exigirParceiro(tx, clienteId, empresaId, estado.fornecedor_parceiro_id, gravado?.fornecedor_parceiro_id ?? null, extra);

  if (estado.quantidade === null) throw recusa('quantidade', 'obrigatoria', extra);
  const quantidade = dec(estado.quantidade);
  if (!quantidade.gt(0)) throw recusa('quantidade', 'nao_positiva', extra);
  if (estado.valor_unitario === null) throw recusa('valor_unitario', 'obrigatorio', extra);
  const total = arredondar(quantidade.times(dec(estado.valor_unitario)), CASAS_CUSTO);
  if (total.gt(LIMITE_DECIMAL_14_4)) throw recusa('quantidade', 'custo_excede_limite', { ...extra, valor_unitario: estado.valor_unitario });

  return {
    servico_id: servico.id,
    fornecedor_parceiro_id: estado.fornecedor_parceiro_id ?? null,
    quantidade: quantidade.toFixed(CASAS),
    unidade: servico.unidadeMedida.sigla,
    valor_unitario: estado.valor_unitario,
    valor_total: total.toFixed(CASAS),
    documento_referencia: estado.documento_referencia ?? null,
    observacao: estado.observacao ?? null,
  };
};

// ─── formas públicas e auditoria ────────────────────────────────────────────

/** @param {any} s */
const servicoPublico = (s) => (s ? { id: s.id, numero: s.numero, nome: s.nome } : null);
/** @param {any} p */
const parceiroPublico = (p) => (p ? { id: p.id, nome: p.nome } : null);

/**
 * Forma pública da LINHA DE SERVIÇO (lista e detalhe do apontamento, e as
 * escritas). Decimais com 4 casas; instantes ISO. O parceiro sai só com id e nome.
 * @param {any} r  linha lida com `INCLUIR_LINHA_SERVICO`
 */
export const comoLinhaServicoPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  servico_id: r.servico_id,
  servico: servicoPublico(r.servico),
  fornecedor_parceiro_id: r.fornecedor_parceiro_id ?? null,
  parceiro: parceiroPublico(r.parceiro),
  quantidade: t4(r.quantidade),
  unidade: r.unidade,
  valor_unitario: t4(r.valor_unitario),
  valor_total: t4(r.valor_total),
  documento_referencia: r.documento_referencia ?? null,
  observacao: r.observacao ?? null,
  cancelado_em: iso(r.cancelado_em),
  cancelado_por: usuarioPublico(r.canceladoPor),
  motivo_cancelamento: r.motivo_cancelamento ?? null,
  cancelamento_origem: r.cancelamento_origem ?? null,
  criado_por: usuarioPublico(r.criadoPor),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

/** Auditoria: as colunas, sem texto livre (só se há documento, observação ou motivo). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  servico_id: r.servico_id,
  fornecedor_parceiro_id: r.fornecedor_parceiro_id ?? null,
  quantidade: t4(r.quantidade),
  unidade: r.unidade,
  valor_unitario: t4(r.valor_unitario),
  valor_total: t4(r.valor_total),
  cancelamento_origem: r.cancelamento_origem ?? null,
  tem_documento_referencia: Boolean(r.documento_referencia),
  tem_observacao: Boolean(r.observacao),
  tem_motivo_cancelamento: Boolean(r.motivo_cancelamento),
});

// ─── para o serviço do apontamento ──────────────────────────────────────────

/**
 * Linhas de serviço (confirmadas e canceladas) dos apontamentos dados, na
 * forma pública, por apontamento.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string[]} apontamentoIds
 * @returns {Promise<Map<string, Array<ReturnType<typeof comoLinhaServicoPublica>>>>}
 */
export const linhasServicoDosApontamentos = async (db, clienteId, empresaId, apontamentoIds) => {
  /** @type {Map<string, Array<ReturnType<typeof comoLinhaServicoPublica>>>} */
  const mapa = new Map(apontamentoIds.map((id) => [id, []]));
  for (const r of await listarLinhasDosApontamentos(db, clienteId, empresaId, apontamentoIds)) {
    const lista = mapa.get(r.apontamento_id) ?? [];
    lista.push(comoLinhaServicoPublica(r));
    mapa.set(r.apontamento_id, lista);
  }
  return mapa;
};

/**
 * Linhas de serviço CONFIRMADAS do apontamento (a data dele não muda com elas: 409).
 * @param {any} db @param {{ clienteId: string, empresaId: string, apontamentoId: string }} alvo
 * @returns {Promise<number>}
 */
export const contarLinhasServicoConfirmadas = (db, { clienteId, empresaId, apontamentoId }) =>
  contarConfirmadasDoApontamento(db, clienteId, empresaId, apontamentoId);

/**
 * INSERT da linha (já planejada) com a próxima `ordem`, relida, e a auditoria.
 * @param {any} tx @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ clienteId: string, empresaId: string, apontamentoId: string, dados: Record<string, unknown>,
 *   operationId: string, acao?: string, auditoriaExtra?: Record<string, unknown>, anterior?: any }} pedido
 */
const gravarLinha = async (tx, contexto, { clienteId, empresaId, apontamentoId, dados, operationId, acao = ACOES_LINHA_SERVICO.lancar, auditoriaExtra = {}, anterior = null }) => {
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
      entidade: ENTIDADE_LINHA_SERVICO,
      entidadeId: id,
      ...(anterior ? { dadosAnteriores: paraAuditoria(anterior) } : {}),
      dadosNovos: { ...paraAuditoria(linha), ...auditoriaExtra },
    },
    tx
  );
  return linha;
};

/**
 * Lança as linhas de `servicos[]` de um apontamento NOVO (lançar e "repetir"),
 * na transação de quem chama, com as MESMAS regras da rota. Cada linha grava
 * `<operationId>:s<n>` (sem chave, `<apontamento.id>:s<n>`). Recusas levam
 * `details.linha_indice`.
 * @param {any} tx
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ apontamento: { id: string, empresa_id: string }, atividade: { id: string }, linhas: unknown, operationId?: string|null }} pedido
 * @returns {Promise<Array<ReturnType<typeof comoLinhaServicoPublica>>>}
 */
export const criarLinhasServico = async (tx, contexto, { apontamento, atividade, linhas, operationId = null }) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const itens = itensDaLista(linhas, 'servicos');
  const criadas = [];
  for (const [i, item] of itens.entries()) {
    /** @type {EstadoDaLinha} */
    const estado = { ...LINHA_VAZIA, ...camposDaLinha(item) };
    const dados = await planejarLinha(tx, { clienteId: cli, empresaId: apontamento.empresa_id, atividadeId: atividade.id, estado, extra: { linha_indice: i } });
    const linha = await gravarLinha(tx, contexto, {
      clienteId: cli,
      empresaId: apontamento.empresa_id,
      apontamentoId: apontamento.id,
      dados,
      operationId: operationIdDaLinha(operationId ?? apontamento.id, 'servico', i),
    });
    criadas.push(comoLinhaServicoPublica(linha));
  }
  return criadas;
};

/**
 * Cascata do cancelamento (do apontamento ou da atividade): cancela num UPDATE
 * só TODAS as linhas de serviço CONFIRMADAS dos apontamentos dados. Devolve quantas.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, apontamentoIds: string[], usuarioId: string|null, motivo: string,
 *   agora: Date, origem: 'APONTAMENTO'|'ATIVIDADE' }} pedido
 * @returns {Promise<number>}
 */
export const cancelarLinhasServicoDoApontamento = async (tx, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, agora, origem }) => {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) throw new Error('cancelarLinhasServicoDoApontamento: `agora` tem de ser um Date válido');
  if (typeof motivo !== 'string' || !motivo.trim()) throw new Error('cancelarLinhasServicoDoApontamento: `motivo` tem de vir normalizado');
  if (origem !== ORIGENS_CANCELAMENTO.APONTAMENTO && origem !== ORIGENS_CANCELAMENTO.ATIVIDADE) {
    throw new Error('cancelarLinhasServicoDoApontamento: `origem` é APONTAMENTO ou ATIVIDADE');
  }
  if (!Array.isArray(apontamentoIds) || !apontamentoIds.length) return 0;
  return cancelarLinhas(
    tx,
    { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds } },
    { usuarioId: usuarioId ?? null, motivo, agora, origem }
  );
};

/**
 * Totais de serviço da atividade (`GET /atividades/:id/totais`): Σ quantidade e
 * Σ valor das linhas CONFIRMADAS de apontamentos CONFIRMADOS, por serviço e
 * unidade, em ordem de nome. O valor é sempre informado (nunca nulo).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<{ servicos: Array<{ servico_id: string, nome: string, unidade: string, quantidade: string, custo_total: string }>, custo_total: string|null }>}
 */
export const totaisDosServicosDaAtividade = async (db, clienteId, empresaId, atividadeId) => {
  const linhas = await somarPorServico(db, clienteId, empresaId, atividadeId);
  return {
    servicos: linhas.map((l) => ({
      servico_id: l.servico_id,
      nome: l.nome,
      unidade: l.unidade,
      quantidade: /** @type {string} */ (t4(l.quantidade)),
      custo_total: /** @type {string} */ (t4(l.custo)),
    })),
    custo_total: linhas.length ? linhas.reduce((t, l) => t.plus(dec(l.custo)), new Dec(0)).toFixed(CASAS) : null,
  };
};

// ─── escrita pela rota ──────────────────────────────────────────────────────

/** O esqueleto comum, com a entidade e a chave da resposta desta linha. */
const escrever = (/** @type {any} */ contexto, /** @type {any} */ pedido) =>
  escreverLinhaDoApontamento(contexto, {
    ...pedido,
    entidade: ENTIDADE_LINHA_SERVICO,
    acaoConflito: ACOES_LINHA_SERVICO.reenvio_conflitante,
    chave: 'servico',
    publica: comoLinhaServicoPublica,
  });

/**
 * Linha CONFIRMADA deste apontamento; senão 404 `ATIVIDADE_LINHA_NOT_FOUND` ou
 * 409 `ATIVIDADE_STATUS_INVALIDO` (entidade `linha_servico`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} id
 * @param {'editar_linha'|'cancelar_linha'} acao
 */
const exigirLinhaConfirmada = async (tx, clienteId, empresaId, apontamentoId, id, acao) => {
  const linha = await buscarLinha(tx, clienteId, empresaId, apontamentoId, id);
  if (!linha) throw atividadeLinhaNotFound('servico');
  if (linha.status !== STATUS_LINHA.CONFIRMADO) throw atividadeStatusInvalido({ status: linha.status, acao, entidade: 'linha_servico' });
  return linha;
};

/**
 * `POST /atividades/:id/apontamentos/:apontamentoId/servicos` (201): lança UMA
 * linha de serviço. Corpo `{ empresa_id, versao, operation_id, servico_id,
 * quantidade, valor_unitario, fornecedor_parceiro_id?, documento_referencia?, observacao? }`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const lancarLinhaServico = async (contexto, atividadeId, apontamentoId, corpo) => {
  /** @type {EstadoDaLinha} */
  const estado = { ...LINHA_VAZIA, ...camposDaLinha(corpo) };
  return escrever(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_SERVICO.lancar,
    acao: 'lancar_linha',
    httpStatus: 201,
    fingerprint: { estado },
    executar: async (/** @type {any} */ tx, /** @type {{ clienteId: string, empresaId: string }} */ { clienteId, empresaId }) => {
      const dados = await planejarLinha(tx, { clienteId, empresaId, atividadeId, estado });
      return gravarLinha(tx, contexto, { clienteId, empresaId, apontamentoId, dados, operationId: corpo.operation_id });
    },
  });
};

/**
 * `PATCH …/servicos/:linhaId`: editar = cancelar a linha (origem `EDICAO`) +
 * linha NOVA com o gravado e os campos enviados, na mesma transação. Devolve a
 * linha nova em `servico`; a antiga fica em `apontamento.servicos[]`, cancelada.
 * Estado mesclado igual ao gravado → 422 `sem_alteracao`, nada gravado.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const editarLinhaServico = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const campos = camposDaLinha(corpo);
  const auth = exigirAuthContext(contexto?.auth);
  return escrever(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_SERVICO.editar,
    acao: 'editar_linha',
    httpStatus: 200,
    fingerprint: { linha_id: linhaId, campos },
    executar: async (/** @type {any} */ tx, /** @type {{ clienteId: string, empresaId: string, agora: Date }} */ { clienteId, empresaId, agora }) => {
      const anterior = await exigirLinhaConfirmada(tx, clienteId, empresaId, apontamentoId, linhaId, 'editar_linha');
      const gravado = estadoGravado(anterior);
      /** @type {EstadoDaLinha} */
      const estado = { ...gravado, ...campos };
      // Nada muda de fato: não cancela nem recria (a linha e a versão ficam como estão).
      if (semAlteracao(gravado, estado)) throw recusa('corpo', 'sem_alteracao');
      const cancelada = await cancelarLinhas(
        tx,
        { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id: linhaId },
        { usuarioId: auth.usuarioId ?? null, motivo: MOTIVO_DA_EDICAO, agora, origem: ORIGENS_CANCELAMENTO.EDICAO }
      );
      if (cancelada !== 1) throw concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE);
      const dados = await planejarLinha(tx, { clienteId, empresaId, atividadeId, estado, gravado });
      return gravarLinha(tx, contexto, {
        clienteId,
        empresaId,
        apontamentoId,
        dados,
        operationId: corpo.operation_id,
        acao: ACOES_LINHA_SERVICO.editar,
        anterior,
        auditoriaExtra: { substitui_linha_id: anterior.id },
      });
    },
  });
};

/**
 * `POST …/servicos/:linhaId/cancelar`: CONFIRMADO → CANCELADO com quem, quando
 * e motivo (3..500), origem `LINHA`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const cancelarLinhaServico = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const motivo = motivoDoCorpo(corpo.motivo);
  return escrever(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_SERVICO.cancelar,
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
        { acao: ACOES_LINHA_SERVICO.cancelar, entidade: ENTIDADE_LINHA_SERVICO, entidadeId: linhaId, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) },
        tx
      );
      return depois;
    },
  });
};
