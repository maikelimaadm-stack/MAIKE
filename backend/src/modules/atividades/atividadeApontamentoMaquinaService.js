/**
 * D-PROD-201 (Fatia 3 do Lançamento de Atividades) — serviço das LINHAS DE
 * MÁQUINA do apontamento (`AtividadeApontamentoMaquina`), contrato
 * `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` §3 e §4.
 *
 * Regras (§3):
 *  - a linha só entra em apontamento CONFIRMADO de atividade ABERTA (senão 409
 *    `ATIVIDADE_STATUS_INVALIDO`); a máquina pode entrar em qualquer tipo de
 *    atividade; o bem (`bem_id`) é da fazenda, ativo (vínculo novo) e de
 *    natureza MAQUINA, VEICULO ou EQUIPAMENTO;
 *  - `implemento_bem_id` precisa de `permite_implemento` no TIPO da atividade
 *    (422 `ATIVIDADE_EXIGIDA_PELO_TIPO`), de natureza IMPLEMENTO, e nunca é o
 *    mesmo bem da máquina (422 `ATIVIDADE_LINHA_INVALIDA` `igual_a_maquina`);
 *  - medidor: `medidor_tipo`/`medidor_unidade` são SNAPSHOT do bem (nunca do
 *    usuário). Com medidor, `leitura_inicial` é sugerida pela leitura vigente
 *    do bem na data do apontamento (o corpo pode mandá-la, nunca abaixo da
 *    vigente), `leitura_final` é obrigatória, final < inicial → 422, final
 *    acima de uma leitura posterior já registrada → 422 (o medidor não anda
 *    para trás) e `quantidade_uso = final − inicial`. Com `sem_medidor: true`
 *    (sempre, para bem sem contador) as leituras ficam nulas e o uso é
 *    digitado (> 0);
 *  - salto: `quantidade_uso` acima de `TipoPatrimonial.salto_maximo_medidor`
 *    (do tipo do bem) → 422 `ATIVIDADE_SALTO_MEDIDOR`, a não ser que venha
 *    `justificativa_salto` (3..500): com ela, aceita;
 *  - custo: `custo_unitario_uso` = snapshot de `BemPatrimonial.custo_uso_unitario`;
 *    `custo_total = quantidade_uso × custo_unitario_uso` (4 casas), ou nulo;
 *  - "atualiza a leitura atual do bem": a leitura vive na LINHA; a série do
 *    medidor (`patrimonio/abastecimentoMedidor.js`) passa a considerar as
 *    linhas CONFIRMADAS de apontamentos CONFIRMADOS. Nada é gravado em
 *    `BemPatrimonial` (DO-NOT-DO, D-PROD-159). Cancelar a linha a tira da série;
 *  - editar = cancelar a linha (origem `EDICAO`) + linha nova, na mesma
 *    transação; cancelar com motivo (origem `LINHA`);
 *  - toda escrita de linha pela rota leva `operation_id` (idempotência,
 *    `executarComIdempotencia`: reenvio igual devolve a resposta gravada; corpo
 *    diferente → 409) e a `versao` do APONTAMENTO (CAS), incrementada uma vez.
 *
 * Travas, na ordem canônica: Empresa FOR SHARE (`tempoDaFazenda`) → Atividade
 * FOR UPDATE (`travarAtividade`) → Bem FOR UPDATE (`travarBens`, a mesma trava
 * do abastecimento e do PATCH do bem, que também leem a série do medidor).
 *
 * Para o serviço do apontamento (C2), este módulo exporta `criarLinhasMaquina`
 * (lançar e repetir com `maquinas[]`), `cancelarLinhasMaquinaDoApontamento`
 * (cascata do cancelamento), `contarLinhasMaquinaConfirmadas` (a data não muda
 * com linha), `linhasMaquinaDosApontamentos` (a lista e o detalhe trazem
 * `maquinas[]`) e `totaisDasMaquinasDaAtividade` (`GET /atividades/:id/totais`).
 *
 * Tenant SÓ do auth_context (R11); a empresa vem do corpo (escrita) ou da query
 * (leitura) e é conferida no tenant.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  atividadeApontamentoNotFound,
  atividadeExigidaPeloTipo,
  atividadeLinhaInvalida,
  atividadeLinhaNotFound,
  atividadeNotFound,
  atividadeSaltoMedidor,
  atividadeStatusInvalido,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, Dec, arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { ehContador, leituraVigente, pisoOperacional, pontoDoCadastro, pontosVizinhos } from '../patrimonio/abastecimentoMedidor.js';
import { avaliarLeitura } from '../patrimonio/abastecimentoPlano.js';
import { paginacaoOpcoes } from '../patrimonio/patrimonioComum.js';
import { UNIDADE_DO_MEDIDOR } from '../patrimonio/patrimonioDominio.js';
import { agoraDoServidor, diaNoFuso, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import {
  STATUS_APONTAMENTO,
  STATUS_ATIVIDADE,
  TRANSACAO_LEITURA,
  atualizarComVersao,
  bemPublico,
  carregarAtividadeDetalhe,
  decimalDoCorpo,
  diaDe,
  diaDoFiltro,
  erroDoCasPerdido,
  exigirVersao,
  idOuNulo,
  iso,
  motivoDoCorpo,
  t4,
  temCampo,
  tempoDaFazenda,
  travarAtividade,
  usuarioPublico,
} from './atividadeComum.js';
import { buscarApontamento, lerAtividadeBase } from './atividadeApontamentoRepository.js';
import { comoApontamentoPublico } from './atividadeApontamentoService.js';
import {
  ORIGENS_CANCELAMENTO,
  STATUS_LINHA,
  buscarLinha,
  cancelarLinhas,
  contarConfirmadasDoApontamento,
  inserirLinha,
  lerApontamentoDaLinha,
  lerBemDaLinha,
  listarLinhasDosApontamentos,
  proximaOrdem,
  tipoPermiteImplemento,
  travarBens,
} from './atividadeApontamentoMaquinaRepository.js';
import { paginarBensAtivos } from './atividadeRepository.js';

// ─── constantes ─────────────────────────────────────────────────────────────

/** Entidade da auditoria da linha de máquina. */
export const ENTIDADE_LINHA_MAQUINA = 'AtividadeApontamentoMaquina';

/** Naturezas de bem aceitas como máquina da linha (como a máquina do cabeçalho). */
export const NATUREZAS_MAQUINA = Object.freeze(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);

/** Natureza do implemento. */
export const NATUREZA_IMPLEMENTO = 'IMPLEMENTO';

/** Decimais do corpo da linha (a guarda anti-coerção das rotas). */
export const DECIMAIS_DA_LINHA_MAQUINA = Object.freeze(['leitura_inicial', 'leitura_final', 'quantidade_uso']);

/** Justificativa do salto: caracteres ÚTEIS, depois de aparada. */
export const JUSTIFICATIVA_MINIMA = 3;
export const JUSTIFICATIVA_MAXIMA = 500;

/** Ações da auditoria e tipos de operação da idempotência. */
export const ACOES_LINHA_MAQUINA = Object.freeze({
  lancar: 'atividade_maquina.lancar',
  editar: 'atividade_maquina.editar',
  cancelar: 'atividade_maquina.cancelar',
});

/** Motivo gravado na linha substituída por uma edição (o CHECK exige motivo no cancelado). */
export const MOTIVO_DA_EDICAO = 'linha editada: substituída por uma linha nova';

/** Limite de Decimal(14, 4) (custo total da linha). */
const LIMITE_DECIMAL_14_4 = new Dec('9999999999.9999');

const CASAS = 4;

/** Detalhe comum das recusas da linha de máquina. */
const ENTIDADE_ERRO = Object.freeze({ entidade: 'linha_maquina' });

/**
 * Recusa da linha de máquina (`ATIVIDADE_LINHA_INVALIDA`, entidade `linha_maquina`).
 * @param {string} field @param {string} reason @param {Record<string, unknown>} [extra] @param {{ message?: string }} [opcoes]
 */
const recusa = (field, reason, extra = {}, opcoes = undefined) => atividadeLinhaInvalida(field, reason, { ...ENTIDADE_ERRO, ...extra }, opcoes);

/**
 * A unique `(cliente_id, operation_id)` da linha é a rede do banco: a mesma
 * chave já usada por OUTRA operação de linha → 409 de idempotência; a unique
 * `(apontamento, ordem)` fora da trava → 409 de concorrência (nunca 500).
 */
const UNICOS = Object.freeze({
  operation_id: () => new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente'),
  apontamento_ordem: () => concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE),
});

// ─── normalização do corpo ──────────────────────────────────────────────────

/**
 * @typedef {{ bem_id: string|null, implemento_bem_id: string|null, sem_medidor: boolean|null,
 *   leitura_inicial: string|null, leitura_final: string|null, quantidade_uso: string|null,
 *   justificativa_salto: string|null, observacao: string|null }} EstadoDaLinha
 */

/** @type {Readonly<EstadoDaLinha>} */
const LINHA_VAZIA = Object.freeze({
  bem_id: null,
  implemento_bem_id: null,
  sem_medidor: null,
  leitura_inicial: null,
  leitura_final: null,
  quantidade_uso: null,
  justificativa_salto: null,
  observacao: null,
});

/**
 * Só os campos da linha PRESENTES no corpo, normalizados (ausente ≠ null: na
 * edição, null limpa o opcional). Decimais como texto com 4 casas; `sem_medidor`
 * booleano (null = não informado).
 * @param {Record<string, any>} corpo
 * @returns {Partial<EstadoDaLinha>}
 */
export const camposDaLinha = (corpo) => {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  /** @type {Record<string, any>} */
  const saida = {};
  for (const campo of ['bem_id', 'implemento_bem_id']) if (temCampo(c, campo) && c[campo] !== undefined) saida[campo] = idOuNulo(c[campo], campo);
  if (temCampo(c, 'sem_medidor') && c.sem_medidor !== undefined) {
    if (c.sem_medidor !== null && typeof c.sem_medidor !== 'boolean') throw invalido('sem_medidor deve ser verdadeiro ou falso', { field: 'sem_medidor', reason: 'formato' });
    saida.sem_medidor = c.sem_medidor;
  }
  for (const campo of DECIMAIS_DA_LINHA_MAQUINA) if (temCampo(c, campo) && c[campo] !== undefined) saida[campo] = decimalDoCorpo(c[campo], campo);
  if (temCampo(c, 'justificativa_salto') && c.justificativa_salto !== undefined) saida.justificativa_salto = textoDoCorpo(c.justificativa_salto, 'justificativa_salto') ?? null;
  if (temCampo(c, 'observacao') && c.observacao !== undefined) saida.observacao = textoDoCorpo(c.observacao, 'observacao') ?? null;
  return saida;
};

/**
 * Linha gravada na forma do estado normalizado: a base da edição. O uso só é
 * dado de entrada na linha sem medidor (com medidor, é calculado).
 * @param {any} r
 * @returns {EstadoDaLinha}
 */
const estadoGravado = (r) => ({
  bem_id: r.bem_id,
  implemento_bem_id: r.implemento_bem_id ?? null,
  sem_medidor: r.sem_medidor,
  leitura_inicial: t4(r.leitura_inicial),
  leitura_final: t4(r.leitura_final),
  quantidade_uso: r.sem_medidor ? t4(r.quantidade_uso) : null,
  justificativa_salto: r.justificativa_salto ?? null,
  observacao: r.observacao ?? null,
});

/**
 * Edição: o gravado + os campos enviados. Trocar a máquina descarta as
 * leituras e o uso gravados (são do medidor da outra máquina); marcar "sem
 * medidor" descarta as leituras; desmarcar descarta o uso digitado.
 * @param {EstadoDaLinha} gravado @param {Partial<EstadoDaLinha>} campos
 * @returns {EstadoDaLinha}
 */
const mesclar = (gravado, campos) => {
  /** @type {EstadoDaLinha} */
  const e = { ...gravado, ...campos };
  const descartar = (/** @type {Array<keyof EstadoDaLinha>} */ chaves) => {
    for (const k of chaves) if (!temCampo(campos, k)) /** @type {any} */ (e)[k] = LINHA_VAZIA[k];
  };
  if (temCampo(campos, 'bem_id') && campos.bem_id !== gravado.bem_id) descartar(['sem_medidor', 'leitura_inicial', 'leitura_final', 'quantidade_uso']);
  if (e.sem_medidor === true) descartar(['leitura_inicial', 'leitura_final']);
  if (e.sem_medidor === false) descartar(['quantidade_uso']);
  return e;
};

/** Trecho de `details` de um ponto da série do medidor. @param {string} nome @param {any} p */
const detalhesDoPonto = (nome, p) => ({
  [`leitura_${nome}`]: p.leitura,
  [`data_${nome}`]: p.data,
  [`origem_${nome}`]: p.origem,
  abastecimento_id: p.abastecimento_id ?? null,
  linha_maquina_id: p.linha_maquina_id ?? null,
});

// ─── regras ─────────────────────────────────────────────────────────────────

/**
 * O bem da linha (máquina ou implemento) conferido: da fazenda, da natureza e
 * ativo (vínculo novo; manter o gravado, mesmo inativado depois, pode).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 * @param {{ campo: 'bem_id'|'implemento_bem_id', naturezas: readonly string[], gravadoId: string|null, extra: Record<string, unknown> }} regra
 */
const exigirBem = async (tx, clienteId, empresaId, id, { campo, naturezas, gravadoId, extra }) => {
  const bem = await lerBemDaLinha(tx, clienteId, id);
  if (!bem) throw recusa(campo, 'inexistente', extra);
  if (bem.empresa_id !== empresaId) throw recusa(campo, 'outra_empresa', extra);
  if (!naturezas.includes(bem.natureza)) throw recusa(campo, 'natureza', { ...extra, natureza: bem.natureza });
  if (!bem.ativo && id !== gravadoId) throw recusa(campo, 'inativo', extra);
  return bem;
};

/**
 * Regra ÚNICA da linha (rota, lançamento com `maquinas[]` e edição): confere o
 * estado final e devolve as colunas a gravar (snapshot do medidor e do custo,
 * leituras, uso). Lê a série do medidor SOB a trava do bem (quem chama já
 * travou). Na edição, a linha antiga já foi cancelada: a leitura dela não conta.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, dia: string, estado: EstadoDaLinha,
 *   gravado?: EstadoDaLinha|null, extra?: Record<string, unknown> }} pedido
 *   `extra` vai para `details` de toda recusa (ex.: `{ linha_indice }` no lançamento com `maquinas[]`)
 */
const planejarLinha = async (tx, { clienteId, empresaId, atividadeId, dia, estado, gravado = null, extra = {} }) => {
  if (!estado.bem_id) throw invalido('bem_id é obrigatório', { field: 'bem_id', reason: 'obrigatorio', ...ENTIDADE_ERRO, ...extra });
  const bem = await exigirBem(tx, clienteId, empresaId, estado.bem_id, { campo: 'bem_id', naturezas: NATUREZAS_MAQUINA, gravadoId: gravado?.bem_id ?? null, extra });

  // implemento
  const implementoId = estado.implemento_bem_id ?? null;
  if (implementoId) {
    if (!(await tipoPermiteImplemento(tx, clienteId, empresaId, atividadeId))) {
      throw atividadeExigidaPeloTipo('implemento_bem_id', { details: { ...ENTIDADE_ERRO, ...extra } });
    }
    if (implementoId === bem.id) throw recusa('implemento_bem_id', 'igual_a_maquina', extra);
    await exigirBem(tx, clienteId, empresaId, implementoId, {
      campo: 'implemento_bem_id',
      naturezas: [NATUREZA_IMPLEMENTO],
      gravadoId: gravado?.implemento_bem_id ?? null,
      extra,
    });
  }

  // medidor (snapshot do bem)
  const tipo = typeof bem.medidor_tipo === 'string' && bem.medidor_tipo ? bem.medidor_tipo : 'SEM_MEDIDOR';
  const contador = ehContador(tipo);
  const unidade = contador ? (bem.medidor_unidade ?? UNIDADE_DO_MEDIDOR[/** @type {'HORIMETRO'} */ (tipo)] ?? null) : null;
  if (!contador && (estado.sem_medidor === false || estado.leitura_inicial !== null || estado.leitura_final !== null)) {
    throw recusa('sem_medidor', 'medidor_obrigatorio', { ...extra, medidor_tipo: tipo });
  }
  const semMedidor = !contador || estado.sem_medidor === true;
  /** @type {string|null} */
  let inicial = null;
  /** @type {string|null} */
  let final = null;
  /** @type {import('@prisma/client').Prisma.Decimal} */
  let uso;
  if (semMedidor) {
    if (estado.leitura_inicial !== null) throw recusa('leitura_inicial', 'nao_aceita', extra);
    if (estado.leitura_final !== null) throw recusa('leitura_final', 'nao_aceita', extra);
    if (estado.quantidade_uso === null) throw recusa('quantidade_uso', 'obrigatoria', { ...extra, medidor_unidade: unidade });
    uso = dec(estado.quantidade_uso);
    if (!uso.gt(0)) throw recusa('quantidade_uso', 'nao_positiva', extra);
  } else {
    if (estado.quantidade_uso !== null) throw recusa('quantidade_uso', 'nao_aceita', extra);
    const vizinhos = await pontosVizinhos(tx, clienteId, bem.id, tipo, dia);
    const { anterior, posterior } = avaliarLeitura({ tipo, leitura: null, dia, cadastro: pontoDoCadastro(bem), ...vizinhos });
    inicial = estado.leitura_inicial ?? anterior?.leitura ?? null;
    if (inicial === null) throw recusa('leitura_inicial', 'obrigatoria', extra);
    if (anterior && dec(inicial).lt(dec(anterior.leitura))) {
      throw recusa('leitura_inicial', 'abaixo_da_vigente', { ...extra, leitura_inicial: inicial, ...detalhesDoPonto('vigente', anterior) });
    }
    if (estado.leitura_final === null) throw recusa('leitura_final', 'obrigatoria', { ...extra, leitura_sugerida: inicial });
    final = estado.leitura_final;
    if (dec(final).lt(dec(inicial))) throw recusa('leitura_final', 'menor_que_inicial', { ...extra, leitura_inicial: inicial, leitura_final: final });
    if (posterior && dec(final).gt(dec(posterior.leitura))) {
      throw recusa('leitura_final', 'acima_de_posterior', { ...extra, leitura_final: final, ...detalhesDoPonto('posterior', posterior) });
    }
    uso = dec(final).minus(dec(inicial));
  }

  // salto (não bloqueia com justificativa)
  const justificativa = estado.justificativa_salto ?? null;
  if (justificativa !== null) {
    const tamanho = [...justificativa].length;
    const limites = { minimo: JUSTIFICATIVA_MINIMA, maximo: JUSTIFICATIVA_MAXIMA };
    if (tamanho < JUSTIFICATIVA_MINIMA) throw recusa('justificativa_salto', 'curta', { ...extra, ...limites });
    if (tamanho > JUSTIFICATIVA_MAXIMA) throw recusa('justificativa_salto', 'longa', { ...extra, ...limites });
  }
  const teto = bem.tipo?.salto_maximo_medidor ?? null;
  if (teto !== null && uso.gt(dec(teto)) && justificativa === null) {
    const salto = uso.toFixed(CASAS);
    throw atividadeSaltoMedidor({ ...extra, quantidade_uso: salto, salto_maximo: t4(teto), medidor_unidade: unidade, teto: t4(teto), salto });
  }

  // custo (snapshot do cadastro do bem)
  const custoUnitario = t4(bem.custo_uso_unitario);
  const custoTotal = custoUnitario === null ? null : arredondar(uso.times(dec(custoUnitario)), CASAS_CUSTO);
  if (custoTotal !== null && custoTotal.gt(LIMITE_DECIMAL_14_4)) {
    throw recusa('quantidade_uso', 'custo_excede_limite', { ...extra, custo_unitario_uso: custoUnitario }, {
      message: 'o custo da linha (uso × custo por hora ou km do bem) passa do limite da coluna',
    });
  }

  return {
    bem_id: bem.id,
    implemento_bem_id: implementoId,
    medidor_tipo: tipo,
    medidor_unidade: unidade,
    sem_medidor: semMedidor,
    leitura_inicial: inicial,
    leitura_final: final,
    quantidade_uso: uso.toFixed(CASAS),
    justificativa_salto: justificativa,
    custo_unitario_uso: custoUnitario,
    custo_total: custoTotal === null ? null : custoTotal.toFixed(CASAS),
    observacao: estado.observacao ?? null,
  };
};

// ─── formas públicas e auditoria ────────────────────────────────────────────

/**
 * Forma pública da LINHA DE MÁQUINA (lista e detalhe do apontamento, e as
 * escritas): as colunas e, ao lado de cada id, o resumo para exibir. Decimais
 * com 4 casas; instantes ISO.
 * @param {any} r  linha lida com `INCLUIR_LINHA_MAQUINA`
 */
export const comoLinhaMaquinaPublica = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  bem_id: r.bem_id,
  bem: bemPublico(r.bem),
  implemento_bem_id: r.implemento_bem_id ?? null,
  implemento: bemPublico(r.implemento),
  medidor_tipo: r.medidor_tipo,
  medidor_unidade: r.medidor_unidade ?? null,
  sem_medidor: r.sem_medidor,
  leitura_inicial: t4(r.leitura_inicial),
  leitura_final: t4(r.leitura_final),
  quantidade_uso: t4(r.quantidade_uso),
  justificativa_salto: r.justificativa_salto ?? null,
  custo_unitario_uso: t4(r.custo_unitario_uso),
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

/** Auditoria: as colunas, sem texto livre (só se há observação, justificativa ou motivo). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  apontamento_id: r.apontamento_id,
  ordem: r.ordem,
  status: r.status,
  bem_id: r.bem_id,
  implemento_bem_id: r.implemento_bem_id ?? null,
  medidor_tipo: r.medidor_tipo,
  medidor_unidade: r.medidor_unidade ?? null,
  sem_medidor: r.sem_medidor,
  leitura_inicial: t4(r.leitura_inicial),
  leitura_final: t4(r.leitura_final),
  quantidade_uso: t4(r.quantidade_uso),
  custo_unitario_uso: t4(r.custo_unitario_uso),
  custo_total: t4(r.custo_total),
  cancelamento_origem: r.cancelamento_origem ?? null,
  tem_observacao: Boolean(r.observacao),
  tem_justificativa_salto: Boolean(r.justificativa_salto),
  tem_motivo_cancelamento: Boolean(r.motivo_cancelamento),
});

// ─── para o serviço do apontamento (C2) ─────────────────────────────────────

/**
 * Linhas de máquina (confirmadas e canceladas) dos apontamentos dados, na
 * forma pública, por apontamento (a lista e o detalhe do apontamento trazem
 * `maquinas[]`). Apontamento sem linha → `[]`.
 * @param {any} db @param {string} clienteId  do auth_context @param {string} empresaId @param {string[]} apontamentoIds
 * @returns {Promise<Map<string, Array<ReturnType<typeof comoLinhaMaquinaPublica>>>>}
 */
export const linhasMaquinaDosApontamentos = async (db, clienteId, empresaId, apontamentoIds) => {
  /** @type {Map<string, Array<ReturnType<typeof comoLinhaMaquinaPublica>>>} */
  const mapa = new Map(apontamentoIds.map((id) => [id, []]));
  for (const r of await listarLinhasDosApontamentos(db, clienteId, empresaId, apontamentoIds)) {
    const lista = mapa.get(r.apontamento_id) ?? [];
    lista.push(comoLinhaMaquinaPublica(r));
    mapa.set(r.apontamento_id, lista);
  }
  return mapa;
};

/**
 * Linhas de máquina CONFIRMADAS do apontamento (a data dele não muda com elas: 409).
 * @param {any} db @param {{ clienteId: string, empresaId: string, apontamentoId: string }} alvo
 * @returns {Promise<number>}
 */
export const contarLinhasMaquinaConfirmadas = (db, { clienteId, empresaId, apontamentoId }) =>
  contarConfirmadasDoApontamento(db, clienteId, empresaId, apontamentoId);

/**
 * Lança as linhas de `maquinas[]` de um apontamento NOVO (lançar e "repetir"),
 * na transação de quem chama, com as MESMAS regras da rota da linha. Quem chama
 * (o serviço do apontamento) já travou a Empresa (FOR SHARE, `tempoDaFazenda`) e
 * a atividade (FOR UPDATE), conferiu que ela está ABERTA, inseriu o apontamento
 * CONFIRMADO e cuida da idempotência (um `operation_id` para tudo). Aqui: trava
 * os bens (em ordem de id), confere e grava cada linha em ordem (a 2ª linha do
 * MESMO bem começa onde a 1ª terminou) e audita cada uma. O `operation_id` de
 * cada linha é derivado do apontamento: `<apontamento.id>:m<ordem>`. Recusas
 * levam `details.linha_indice` (a posição em `maquinas[]`). Devolve as linhas
 * na forma pública.
 *
 * `operationId` (opcional): a chave do lançamento; cada linha grava
 * `<operationId>:m<n>` (n = posição + 1, como `operationIdDaLinha`). Sem ela,
 * `<apontamento.id>:m<n>`.
 * @param {any} tx
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ apontamento: { id: string, empresa_id: string, data_operacional: Date|string },
 *   atividade: { id: string }, linhas: unknown, operationId?: string|null }} pedido
 * @returns {Promise<Array<ReturnType<typeof comoLinhaMaquinaPublica>>>}
 */
export const criarLinhasMaquina = async (tx, contexto, { apontamento, atividade, linhas, operationId = null }) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  if (linhas === undefined || linhas === null) return [];
  if (!Array.isArray(linhas)) throw invalido('maquinas deve ser uma lista', { field: 'maquinas', reason: 'formato' });
  if (!linhas.length) return [];
  const empresaId = apontamento.empresa_id;
  const dia = /** @type {string} */ (typeof apontamento.data_operacional === 'string' ? apontamento.data_operacional : diaDe(apontamento.data_operacional));
  const estados = linhas.map((l, i) => {
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw invalido('cada item de maquinas deve ser um objeto', { field: `maquinas[${i}]`, reason: 'formato' });
    return /** @type {EstadoDaLinha} */ ({ ...LINHA_VAZIA, ...camposDaLinha(/** @type {Record<string, any>} */ (l)) });
  });
  await travarBens(tx, cli, empresaId, estados.map((e) => e.bem_id).filter((id) => typeof id === 'string'));
  const criadas = [];
  for (const [i, estado] of estados.entries()) {
    const dados = await planejarLinha(tx, { clienteId: cli, empresaId, atividadeId: atividade.id, dia, estado, extra: { linha_indice: i } });
    const linha = await gravarLinha(tx, contexto, { clienteId: cli, empresaId, apontamentoId: apontamento.id, dados, operationId: `${operationId ?? apontamento.id}:m${i + 1}` });
    criadas.push(comoLinhaMaquinaPublica(linha));
  }
  return criadas;
};

/**
 * Cascata do cancelamento (do apontamento ou da atividade): cancela num UPDATE
 * só TODAS as linhas de máquina CONFIRMADAS dos apontamentos dados, com o
 * MESMO motivo, instante, usuário e a origem (`APONTAMENTO` | `ATIVIDADE`). As
 * leituras delas saem da série do medidor do bem. Quem chama já travou a
 * atividade e normalizou o motivo. Devolve quantas linhas foram canceladas.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, apontamentoIds: string[], usuarioId: string|null, motivo: string,
 *   agora: Date, origem: 'APONTAMENTO'|'ATIVIDADE' }} pedido
 * @returns {Promise<number>}
 */
export const cancelarLinhasMaquinaDoApontamento = async (tx, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, agora, origem }) => {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) throw new Error('cancelarLinhasMaquinaDoApontamento: `agora` tem de ser um Date válido');
  if (typeof motivo !== 'string' || !motivo.trim()) throw new Error('cancelarLinhasMaquinaDoApontamento: `motivo` tem de vir normalizado');
  if (origem !== ORIGENS_CANCELAMENTO.APONTAMENTO && origem !== ORIGENS_CANCELAMENTO.ATIVIDADE) {
    throw new Error('cancelarLinhasMaquinaDoApontamento: `origem` é APONTAMENTO ou ATIVIDADE');
  }
  if (!Array.isArray(apontamentoIds) || !apontamentoIds.length) return 0;
  return cancelarLinhas(
    tx,
    { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds } },
    { usuarioId: usuarioId ?? null, motivo, agora, origem }
  );
};

/**
 * Totais de máquina da atividade (`GET /atividades/:id/totais`): Σ uso e Σ
 * custo das linhas CONFIRMADAS de apontamentos CONFIRMADOS, por bem e unidade
 * do medidor, em ordem de nome. `custo_total` do bem é nulo quando nenhuma
 * linha dele tem custo; `custo_total` geral idem.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<{ maquinas: Array<{ bem_id: string, nome: string, medidor_unidade: string|null, quantidade_uso: string, custo_total: string|null }>, custo_total: string|null }>}
 */
export const totaisDasMaquinasDaAtividade = async (db, clienteId, empresaId, atividadeId) => {
  const linhas = /** @type {Array<{ bem_id: string, nome: string, medidor_unidade: string|null, uso: unknown, custo: unknown }>} */ (
    await db.$queryRaw`SELECT m.bem_id, b.nome, m.medidor_unidade, SUM(m.quantidade_uso) AS uso, SUM(m.custo_total) AS custo
      FROM "AtividadeApontamentoMaquina" m
      JOIN "AtividadeApontamento" a ON a.cliente_id = m.cliente_id AND a.empresa_id = m.empresa_id AND a.id = m.apontamento_id
      JOIN "BemPatrimonial" b ON b.cliente_id = m.cliente_id AND b.empresa_id = m.empresa_id AND b.id = m.bem_id
      WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
        AND m.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      GROUP BY m.bem_id, b.nome, m.medidor_unidade
      ORDER BY b.nome, m.bem_id, m.medidor_unidade`
  );
  const comCusto = linhas.filter((l) => l.custo !== null && l.custo !== undefined);
  return {
    maquinas: linhas.map((l) => ({ bem_id: l.bem_id, nome: l.nome, medidor_unidade: l.medidor_unidade ?? null, quantidade_uso: /** @type {string} */ (t4(l.uso)), custo_total: t4(l.custo) })),
    custo_total: comCusto.length ? dec(comCusto.reduce((t, l) => t.plus(dec(l.custo)), new Dec(0))).toFixed(CASAS) : null,
  };
};

// ─── escrita ────────────────────────────────────────────────────────────────

/**
 * INSERT da linha (já planejada) com a próxima `ordem` do apontamento, relida
 * com os resumos, e a auditoria.
 * @param {any} tx @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ clienteId: string, empresaId: string, apontamentoId: string, dados: Record<string, unknown>,
 *   operationId: string, acao?: string, auditoriaExtra?: Record<string, unknown>, anterior?: any }} pedido
 */
const gravarLinha = async (tx, contexto, { clienteId, empresaId, apontamentoId, dados, operationId, acao = ACOES_LINHA_MAQUINA.lancar, auditoriaExtra = {}, anterior = null }) => {
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
      entidade: ENTIDADE_LINHA_MAQUINA,
      entidadeId: id,
      ...(anterior ? { dadosAnteriores: paraAuditoria(anterior) } : {}),
      dadosNovos: { ...paraAuditoria(linha), ...auditoriaExtra },
    },
    tx
  );
  return linha;
};

/**
 * Corpo das escritas da linha: `{ apontamento, atividade, alertas, maquina }`
 * — o apontamento relido (forma pública do serviço do apontamento, com
 * `maquinas[]`), a atividade no formato do DETALHE, `alertas` (sempre `[]`: a
 * data não muda) e a linha escrita.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} apontamentoId @param {any} linha
 */
const respostaDaLinha = async (tx, clienteId, empresaId, atividadeId, apontamentoId, linha) => {
  const registro = await buscarApontamento(tx, clienteId, empresaId, atividadeId, apontamentoId);
  if (!registro) throw atividadeApontamentoNotFound();
  /** @type {Record<string, any>} */
  const publico = comoApontamentoPublico(registro);
  const apontamento = Array.isArray(publico.maquinas)
    ? publico
    : { ...publico, maquinas: (await linhasMaquinaDosApontamentos(tx, clienteId, empresaId, [apontamentoId])).get(apontamentoId) ?? [] };
  return {
    apontamento,
    atividade: await carregarAtividadeDetalhe(tx, clienteId, empresaId, atividadeId),
    alertas: [],
    maquina: comoLinhaMaquinaPublica(linha),
  };
};

/**
 * Reenvio conflitante (mesma `operation_id`, corpo diferente): a resposta segue
 * 409 `IDEMPOTENCY_CONFLICT` e o fato é auditado numa transação PRÓPRIA,
 * best-effort (molde do abastecimento).
 * @template T
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {unknown} operationId @param {string} tipoOperacao @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
const comAuditoriaDoConflito = async (contexto, operationId, tipoOperacao, fn) => {
  try {
    return await fn();
  } catch (erro) {
    if (/** @type {any} */ (erro)?.code === 'IDEMPOTENCY_CONFLICT') {
      try {
        await registrarEvento(contexto, {
          acao: 'atividade_maquina.reenvio_conflitante',
          entidade: ENTIDADE_LINHA_MAQUINA,
          entidadeId: null,
          dadosNovos: { operation_id: operationId, tipo_operacao: tipoOperacao },
        });
      } catch {
        // best-effort: a auditoria do conflito não muda a resposta 409.
      }
    }
    throw erro;
  }
};

/**
 * Esqueleto das três escritas da rota: idempotência por `operation_id`,
 * travas na ordem canônica, atividade ABERTA, apontamento CONFIRMADO, CAS pela
 * `versao` do apontamento (incrementada uma vez), a resposta.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ atividadeId: string, apontamentoId: string, corpo: Record<string, any>, tipoOperacao: string,
 *   acao: 'lancar_linha'|'editar_linha'|'cancelar_linha', httpStatus: number, fingerprint: Record<string, unknown>,
 *   executar: (tx: any, estado: { clienteId: string, empresaId: string, agora: Date, dia: string }) => Promise<any> }} pedido
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
const escreverLinha = async (contexto, { atividadeId, apontamentoId, corpo, tipoOperacao, acao, httpStatus, fingerprint, executar }) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const versao = corpo.versao;
  const r = await comAuditoriaDoConflito(contexto, corpo.operation_id, tipoOperacao, () => emTransacao(
    TRANSACAO_CURTA,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey: corpo.operation_id,
        tipoOperacao,
        fingerprint: fingerprintDePayload({ atividade_id: atividadeId, apontamento_id: apontamentoId, empresa_id: corpo.empresa_id, versao, ...fingerprint }),
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
          const { agora } = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
          if (!(await travarAtividade(tx, cli, empresaId, atividadeId))) throw atividadeNotFound(); // Atividade FOR UPDATE
          const atividade = await lerAtividadeBase(tx, cli, empresaId, atividadeId);
          if (!atividade) throw atividadeNotFound();
          if (atividade.status !== STATUS_ATIVIDADE.ABERTA) throw atividadeStatusInvalido({ status: atividade.status, acao, entidade: 'atividade' });
          const apontamento = await lerApontamentoDaLinha(tx, cli, empresaId, atividadeId, apontamentoId);
          if (!apontamento) throw atividadeApontamentoNotFound();
          if (apontamento.status !== STATUS_APONTAMENTO.CONFIRMADO) throw atividadeStatusInvalido({ status: apontamento.status, acao, entidade: 'apontamento' });
          exigirVersao(apontamento, versao, 'apontamento');
          const linha = await executar(tx, { clienteId: cli, empresaId, agora, dia: /** @type {string} */ (diaDe(apontamento.data_operacional)) });
          const alvo = { clienteId: cli, empresaId, id: apontamentoId, versao, statusEsperado: STATUS_APONTAMENTO.CONFIRMADO, onde: { atividade_id: atividadeId } };
          if ((await atualizarComVersao(tx.atividadeApontamento, { ...alvo, dados: {} })) !== 1) {
            throw await erroDoCasPerdido(tx.atividadeApontamento, { ...alvo, acao, entidade: 'apontamento' });
          }
          return { httpStatus, body: await respostaDaLinha(tx, cli, empresaId, atividadeId, apontamentoId, linha) };
        },
      }),
    UNICOS,
    MENSAGEM_CONFLITO_SEM_CHAVE
  ));
  return { status: r.httpStatus, body: r.body };
};

/**
 * Linha CONFIRMADA deste apontamento; senão 404 `ATIVIDADE_LINHA_NOT_FOUND`
 * (outro apontamento, fazenda ou tenant) ou 409 `ATIVIDADE_STATUS_INVALIDO`
 * (entidade `linha_maquina`: a cancelada é histórico).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} id
 * @param {'editar_linha'|'cancelar_linha'} acao
 */
const exigirLinhaConfirmada = async (tx, clienteId, empresaId, apontamentoId, id, acao) => {
  const linha = await buscarLinha(tx, clienteId, empresaId, apontamentoId, id);
  if (!linha) throw atividadeLinhaNotFound('maquina');
  if (linha.status !== STATUS_LINHA.CONFIRMADO) throw atividadeStatusInvalido({ status: linha.status, acao, entidade: 'linha_maquina' });
  return linha;
};

/**
 * `POST /atividades/:id/apontamentos/:apontamentoId/maquinas` (201): lança UMA
 * linha de máquina no apontamento CONFIRMADO de atividade ABERTA.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const lancarLinhaMaquina = async (contexto, atividadeId, apontamentoId, corpo) => {
  /** @type {EstadoDaLinha} */
  const estado = { ...LINHA_VAZIA, ...camposDaLinha(corpo) };
  return escreverLinha(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_MAQUINA.lancar,
    acao: 'lancar_linha',
    httpStatus: 201,
    fingerprint: { estado },
    executar: async (tx, { clienteId, empresaId, dia }) => {
      if (estado.bem_id) await travarBens(tx, clienteId, empresaId, [estado.bem_id]); // Bem FOR UPDATE
      const dados = await planejarLinha(tx, { clienteId, empresaId, atividadeId, dia, estado });
      return gravarLinha(tx, contexto, { clienteId, empresaId, apontamentoId, dados, operationId: corpo.operation_id });
    },
  });
};

/**
 * `PATCH …/maquinas/:linhaId`: editar = cancelar a linha (origem `EDICAO`) +
 * linha NOVA com o gravado e os campos enviados, na mesma transação (a leitura
 * da linha antiga sai da série antes de conferir a nova). Devolve a linha nova
 * em `maquina`; a antiga fica em `apontamento.maquinas[]`, cancelada.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const editarLinhaMaquina = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const campos = camposDaLinha(corpo);
  const auth = exigirAuthContext(contexto?.auth);
  return escreverLinha(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_MAQUINA.editar,
    acao: 'editar_linha',
    httpStatus: 200,
    fingerprint: { linha_id: linhaId, campos },
    executar: async (tx, { clienteId, empresaId, agora, dia }) => {
      const anterior = await exigirLinhaConfirmada(tx, clienteId, empresaId, apontamentoId, linhaId, 'editar_linha');
      const gravado = estadoGravado(anterior);
      const estado = mesclar(gravado, campos);
      await travarBens(tx, clienteId, empresaId, [anterior.bem_id, ...(estado.bem_id ? [estado.bem_id] : [])]); // Bem FOR UPDATE
      const cancelada = await cancelarLinhas(
        tx,
        { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id: linhaId },
        { usuarioId: auth.usuarioId ?? null, motivo: MOTIVO_DA_EDICAO, agora, origem: ORIGENS_CANCELAMENTO.EDICAO }
      );
      if (cancelada !== 1) throw concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE);
      const dados = await planejarLinha(tx, { clienteId, empresaId, atividadeId, dia, estado, gravado });
      return gravarLinha(tx, contexto, {
        clienteId,
        empresaId,
        apontamentoId,
        dados,
        operationId: corpo.operation_id,
        acao: ACOES_LINHA_MAQUINA.editar,
        anterior,
        auditoriaExtra: { substitui_linha_id: anterior.id },
      });
    },
  });
};

/**
 * `POST …/maquinas/:linhaId/cancelar`: CONFIRMADO → CANCELADO com quem, quando
 * (o "agora" da fazenda) e motivo (3..500), origem `LINHA`. A leitura sai da
 * série do medidor do bem.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const cancelarLinhaMaquina = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const motivo = motivoDoCorpo(corpo.motivo);
  return escreverLinha(contexto, {
    atividadeId,
    apontamentoId,
    corpo,
    tipoOperacao: ACOES_LINHA_MAQUINA.cancelar,
    acao: 'cancelar_linha',
    httpStatus: 200,
    fingerprint: { linha_id: linhaId, motivo },
    executar: async (tx, { clienteId, empresaId, agora }) => {
      const antes = await exigirLinhaConfirmada(tx, clienteId, empresaId, apontamentoId, linhaId, 'cancelar_linha');
      await travarBens(tx, clienteId, empresaId, [antes.bem_id]); // Bem FOR UPDATE
      const n = await cancelarLinhas(
        tx,
        { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id: linhaId },
        { usuarioId: auth.usuarioId ?? null, motivo, agora, origem: ORIGENS_CANCELAMENTO.LINHA }
      );
      if (n !== 1) throw concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE);
      const depois = await buscarLinha(tx, clienteId, empresaId, apontamentoId, linhaId);
      await registrarEvento(
        contexto,
        { acao: ACOES_LINHA_MAQUINA.cancelar, entidade: ENTIDADE_LINHA_MAQUINA, entidadeId: linhaId, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) },
        tx
      );
      return depois;
    },
  });
};

// ─── opções da tela ─────────────────────────────────────────────────────────

/**
 * `GET /atividades-opcoes/implementos`: implementos ATIVOS da empresa (natureza
 * IMPLEMENTO), keyset (nome, id), `q` em nome, número ou código de frota;
 * envelope `{ itens, has_more, next_cursor }`.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesImplementos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  return paginarBensAtivos({ clienteId: auth.clienteId, empresaId, naturezas: [NATUREZA_IMPLEMENTO], q, limit, cursor, mapear: (linhas) => linhas.map(bemPublico) });
};

/**
 * `GET /atividades-opcoes/medidor?empresa_id=&bem_id=&data=`: o medidor do bem
 * para a linha de máquina, na data (padrão: hoje na fazenda):
 * `{ bem, data, medidor_tipo, medidor_unidade, sem_medidor, leitura_vigente,
 * leitura_sugerida, leitura_posterior, leitura_atual, salto_maximo_medidor,
 * custo_uso_unitario }`. `leitura_vigente` é o ponto da série vigente na data
 * (o maior com data <= data: cadastro, abastecimento ou linha), e
 * `leitura_sugerida` a leitura dele (a inicial sugerida); `leitura_posterior`,
 * o menor ponto depois da data (o teto da leitura final); `leitura_atual`, a
 * vigente do bem hoje. Pontos `{ leitura, data, origem, abastecimento_id,
 * numero[, linha_maquina_id, apontamento_id] }`. Sem contador, os pontos são
 * nulos e `sem_medidor` é `true`. Bem de outra fazenda, de outro tenant ou que
 * não é máquina → 422 `ATIVIDADE_LINHA_INVALIDA` (`bem_id`).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesMedidor = async (contexto, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const diaInformado = query.data === undefined ? null : diaDoFiltro(query.data, 'data');
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    let dia = diaInformado;
    if (!dia) {
      const empresa = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: empresaId } }, select: { fuso_horario: true } });
      const fuso = normalizarFusoIana(empresa?.fuso_horario);
      if (!fuso) {
        throw new AppError('EMPRESA_FUSO_NAO_CONFIGURADO', 'o fuso horário da fazenda não está configurado: informe a data ou configure o fuso em Empresa', {
          details: { empresa_id: empresaId },
        });
      }
      dia = diaNoFuso(agoraDoServidor(), fuso);
    }
    const bem = await exigirBem(tx, cli, empresaId, String(query.bem_id ?? ''), { campo: 'bem_id', naturezas: NATUREZAS_MAQUINA, gravadoId: String(query.bem_id ?? ''), extra: {} });
    const tipo = typeof bem.medidor_tipo === 'string' && bem.medidor_tipo ? bem.medidor_tipo : 'SEM_MEDIDOR';
    const contador = ehContador(tipo);
    const cadastro = pontoDoCadastro(bem);
    const limites = contador
      ? avaliarLeitura({ tipo, leitura: null, dia, cadastro, ...(await pontosVizinhos(tx, cli, bem.id, tipo, dia)) })
      : { anterior: null, posterior: null };
    const atual = contador ? leituraVigente(cadastro, await pisoOperacional(tx, cli, bem.id, tipo)) : null;
    return {
      bem: bemPublico(bem),
      data: dia,
      medidor_tipo: tipo,
      medidor_unidade: contador ? (bem.medidor_unidade ?? UNIDADE_DO_MEDIDOR[/** @type {'HORIMETRO'} */ (tipo)] ?? null) : null,
      sem_medidor: !contador,
      leitura_vigente: limites.anterior ?? null,
      leitura_sugerida: limites.anterior?.leitura ?? null,
      leitura_posterior: limites.posterior ?? null,
      leitura_atual: atual ?? null,
      salto_maximo_medidor: t4(bem.tipo?.salto_maximo_medidor ?? null),
      custo_uso_unitario: t4(bem.custo_uso_unitario),
    };
  });
};
