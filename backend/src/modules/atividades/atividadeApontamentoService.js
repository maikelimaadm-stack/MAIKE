/**
 * D-PROD-200 (Fatia 2 do Lançamento de Atividades) — serviço do APONTAMENTO
 * do dia/turno (`AtividadeApontamento`), filho da ATIVIDADE (o cabeçalho).
 * Contrato `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md` (§3, §4 e §10).
 *
 * O apontamento é o que foi feito num dia (e turno) da atividade aberta:
 * operador, área do dia, produção do dia e observação. Área, setor, safra,
 * máquina, centros e unidade são do CABEÇALHO, herdados e travados: o corpo
 * nem aceita esses campos (schema fechado nas rotas).
 *
 * Regras (§3):
 *  - só em atividade ABERTA: lançar, editar, cancelar e repetir em atividade
 *    concluída ou cancelada → 409 `ATIVIDADE_STATUS_INVALIDO`; editar e
 *    cancelar só apontamento CONFIRMADO (o cancelado é histórico);
 *  - `data_operacional` obrigatória e nunca depois de "hoje" no fuso da
 *    fazenda (422 `ATIVIDADE_DATA_INVALIDA` reason `futura`; sem fuso, falha
 *    fechado com 409 `EMPRESA_FUSO_NAO_CONFIGURADO`). Fora do período da
 *    atividade ([data_inicio, data_prevista_fim]) é aceita, com o alerta
 *    `FORA_DO_INTERVALO` na resposta (a equipe sai e volta);
 *  - turno nulo, MANHA, TARDE ou NOITE. A `sequencia` (as passadas: 1, 2…) é
 *    máx + 1 por (atividade, dia, turno), calculada aqui sob a trava da
 *    atividade, e nunca vem do corpo; trocar a data ou o turno na edição refaz
 *    a sequência no grupo novo;
 *  - operador: usuário ATIVO do tenant quando o vínculo é NOVO (lançar,
 *    repetir ou trocar na edição); manter o gravado, mesmo inativado depois,
 *    pode. Área do dia e produção do dia ≥ 0, sempre em texto. `origem` WEB
 *    (padrão) ou APP, gravada no lançamento;
 *  - editar com CAS pela `versao` do apontamento; cancelar com motivo
 *    (3..500 caracteres úteis) e CAS;
 *  - repetir (duplicar) copia turno, operador, área do dia, produção e
 *    observação para o dia do corpo (padrão hoje), com sequência nova e as
 *    mesmas validações do lançamento (a base pode até estar cancelada: só os
 *    dados são copiados; a tela oferece só as confirmadas);
 *  - toda escrita recalcula os totais do cabeçalho (`area_executada`,
 *    `quantidade_produzida` = Σ dos CONFIRMADO; nenhum com valor → nulo) na
 *    mesma transação. A `versao` do CABEÇALHO não muda: os totais são
 *    derivados, o PATCH do cabeçalho não os edita e a corrida com concluir e
 *    cancelar é resolvida pela trava da atividade;
 *  - sem DELETE físico; auditoria de toda escrita, sem texto livre (só
 *    `tem_observacao` e `tem_motivo_cancelamento`).
 *
 * Travas, na ordem canônica do cabeçalho: Empresa FOR SHARE (o fuso, em
 * `tempoDaFazenda`) → Atividade FOR UPDATE (`travarAtividade`) → apontamentos.
 * A trava da atividade serializa lançar, editar, cancelar e repetir com
 * concluir, reabrir, cancelar e editar o cabeçalho.
 *
 * Para o serviço do cabeçalho, este módulo exporta `recalcularTotaisDaAtividade`
 * e `cancelarApontamentosDaAtividade` (cancelar a atividade propaga).
 *
 * D-PROD-202 (Fatia 3, contrato `MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`):
 *  - o apontamento (lista, detalhe e escritas) traz `produtos[]` e `maquinas[]`,
 *    inclusive as linhas canceladas;
 *  - lançar e repetir aceitam `produtos[]` e `maquinas[]`, tudo numa transação
 *    e com UM `operation_id` (obrigatório quando há linha; recibo
 *    `executarComIdempotencia`: reenvio igual → 200 com `replay: true`, corpo
 *    diferente → 409). As de máquina são gravadas antes das de produto (trava
 *    bem → produto, a ordem do abastecimento);
 *  - a data do apontamento não muda com linha de produto ou de máquina
 *    CONFIRMADA (409 `ATIVIDADE_DATA_COM_LINHAS`): cancelar e lançar de novo;
 *  - trocar a área do dia refaz a `dose_ha` das linhas de produto confirmadas;
 *  - cancelar o apontamento (ou a atividade) cancela as linhas de máquina e
 *    estorna as de produto, na mesma transação, antes do UPDATE (origem
 *    `APONTAMENTO` | `ATIVIDADE`).
 *
 * D-PROD-211 (Fatia 5): a cascata também cancela os ABASTECIMENTOS confirmados
 * ligados ao apontamento (`cancelarAbastecimentosDosApontamentos`, o mesmo
 * caminho do cancelamento do abastecimento). A edição do apontamento não mexe
 * neles (não são linhas do lançamento: nem a troca de data os toca).
 *
 * Tenant SÓ do auth_context (R11); a empresa vem do corpo (escrita) ou da
 * query (leitura) e é conferida no tenant (`exigirEmpresaDoTenant`). O
 * apontamento sempre pertence à atividade da URL e a essa empresa: de outra
 * atividade, fazenda ou tenant é 404 `ATIVIDADE_APONTAMENTO_NOT_FOUND`.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  atividadeApontamentoNotFound,
  atividadeDataComLinhas,
  atividadeDataInvalida,
  atividadeNotFound,
  atividadeReferenciaInvalida,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import {
  ENTIDADE_APONTAMENTO,
  OPERATION_ID_DO_LANCAMENTO_MAXIMO,
  ORIGEM_CANCELAMENTO_LINHA,
  ORIGENS,
  ORIGEM_PADRAO,
  STATUS_APONTAMENTO,
  TRANSACAO_LEITURA,
  TURNOS,
  atualizarComVersao,
  auditarReenvioConflitante,
  carregarAtividadeDetalhe,
  chavesDerivadasDasLinhas,
  comFkTraduzida,
  comoLinhaProdutoPublica,
  comoData,
  decimalDoCorpo,
  diaDe,
  diaDoCorpo,
  erroDoCasPerdido,
  exigirApontamentoConfirmado,
  exigirDiaNaoFuturo,
  exigirStatusDaAtividade,
  exigirVersao,
  idOuNulo,
  iso,
  motivoDoCorpo,
  operationIdDoCorpo,
  recalcularTotaisDaAtividade as recalcularTotaisNoCabecalho,
  t4,
  temCampo,
  tempoDaFazenda,
  travarAtividade,
  usuarioPublico,
} from './atividadeComum.js';
import {
  buscarApontamento,
  cancelarConfirmadosDaAtividade,
  idsConfirmadosDaAtividade,
  inserirApontamento,
  lerAtividadeBase,
  lerEmpresaDaAtividade,
  lerUsuario,
  listarApontamentosDaAtividade,
  proximaSequencia,
} from './atividadeApontamentoRepository.js';
import {
  cancelarLinhasMaquinaDoApontamento,
  comoLinhaMaquinaPublica,
  contarLinhasMaquinaConfirmadas,
  criarLinhasMaquina,
} from './atividadeApontamentoMaquinaService.js';
import {
  cancelarLinhasProdutoDosApontamentos,
  contarLinhasProdutoConfirmadas,
  criarLinhasProduto,
  normalizarDadosDaLinha,
  recalcularDosesDoApontamento,
} from './atividadeApontamentoProdutoService.js';
import { existeLinhaComChave } from './atividadeApontamentoProdutoRepository.js';
import {
  cancelarLinhasMaoObraDoApontamento,
  comoLinhaMaoObraPublica,
  contarLinhasMaoObraConfirmadas,
  criarLinhasMaoObra,
} from './atividadeApontamentoMaoObraService.js';
import {
  cancelarLinhasServicoDoApontamento,
  comoLinhaServicoPublica,
  contarLinhasServicoConfirmadas,
  criarLinhasServico,
} from './atividadeApontamentoServicoService.js';
import { existeLinhaComChave as existeLinhaMaoObraComChave } from './atividadeApontamentoMaoObraRepository.js';
import { existeLinhaComChave as existeLinhaServicoComChave } from './atividadeApontamentoServicoRepository.js';
import { cancelarAbastecimentosDosApontamentos } from '../patrimonio/abastecimentoService.js';
import { exigirAreaDoLancamento } from './atividadeAreaService.js';

/** Código do alerta de data fora do período da atividade (não bloqueia). */
export const ALERTA_FORA_DO_INTERVALO = 'FORA_DO_INTERVALO';

/** Ações da auditoria do apontamento (entidade `AtividadeApontamento`). */
export const ACOES_AUDITORIA_APONTAMENTO = Object.freeze({
  lancar: 'atividade_apontamento.lancar',
  editar: 'atividade_apontamento.editar',
  cancelar: 'atividade_apontamento.cancelar',
  duplicar: 'atividade_apontamento.duplicar',
});

/** D-PROD-202 — recibos de idempotência do lançamento e da repetição COM chave (≤ 64). */
export const TIPOS_OPERACAO_APONTAMENTO = Object.freeze({
  lancar: 'atividade_apontamento_lancar_v1',
  duplicar: 'atividade_apontamento_duplicar_v1',
});

/**
 * A unique (atividade, dia, turno, sequência) é a rede do banco: um escritor
 * fora da trava da atividade que levasse a mesma sequência vira 409, nunca 500
 * (o trecho casa tanto a lista de colunas do P2002 quanto o nome do índice).
 */
const UNICOS = Object.freeze({ sequencia: () => concurrencyConflict(MENSAGEM_CONFLITO_SEM_CHAVE) });

// ─── normalização do corpo ──────────────────────────────────────────────────

/** @param {unknown} v @returns {string|null} */
const turnoDoCorpo = (v) => {
  if (v === null) return null;
  if (typeof v !== 'string' || !TURNOS.includes(v)) {
    throw invalido(`turno deve ser ${TURNOS.join(', ')} ou nulo`, { field: 'turno', reason: 'formato' });
  }
  return v;
};

/** @param {unknown} v @returns {string} */
export const origemDoCorpo = (v) => {
  if (v === undefined) return ORIGEM_PADRAO;
  if (typeof v !== 'string' || !ORIGENS.includes(v)) {
    throw invalido(`origem deve ser ${ORIGENS.join(' ou ')}`, { field: 'origem', reason: 'formato' });
  }
  return v;
};

/**
 * Campos de DADO do dia → normalizador: os mesmos no lançamento e na edição
 * (o formulário do §6). Fora deles o schema das rotas já recusou tudo.
 * @type {Readonly<Record<string, (v: unknown) => unknown>>}
 */
const CAMPOS_DO_DIA = Object.freeze({
  data_operacional: (v) => diaDoCorpo(v, 'data_operacional'),
  turno: (v) => turnoDoCorpo(v),
  operador_usuario_id: (v) => idOuNulo(v, 'operador_usuario_id'),
  area_executada_dia: (v) => decimalDoCorpo(v, 'area_executada_dia'),
  quantidade_produzida_dia: (v) => decimalDoCorpo(v, 'quantidade_produzida_dia'),
  observacao: (v) => textoDoCorpo(v, 'observacao') ?? null,
  // D-PROD-249: a área da atividade em que o lançamento é feito (conferida sob a trava: desta atividade e EM_ANDAMENTO).
  atividade_area_id: (v) => idOuNulo(v, 'atividade_area_id'),
});

/** Os campos de dado do apontamento, na ordem do formulário. */
export const CAMPOS_DE_DADO_DO_APONTAMENTO = Object.freeze(Object.keys(CAMPOS_DO_DIA));

/**
 * @typedef {{ data_operacional: string|null, turno: string|null, operador_usuario_id: string|null,
 *   area_executada_dia: string|null, quantidade_produzida_dia: string|null, observacao: string|null, atividade_area_id: string|null }} EstadoDoDia
 */

/** @type {Readonly<EstadoDoDia>} */
export const VAZIO = Object.freeze({
  data_operacional: null,
  turno: null,
  operador_usuario_id: null,
  area_executada_dia: null,
  quantidade_produzida_dia: null,
  observacao: null,
  atividade_area_id: null,
});

/**
 * Só os campos de dado PRESENTES no corpo, normalizados (ausente ≠ null: na
 * edição, null limpa o opcional).
 * @param {Record<string, any>} corpo
 * @returns {Partial<EstadoDoDia>}
 */
export const camposDoCorpo = (corpo) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const [campo, normalizar] of Object.entries(CAMPOS_DO_DIA)) {
    if (temCampo(corpo, campo) && corpo[campo] !== undefined) saida[campo] = normalizar(corpo[campo]);
  }
  return saida;
};

/**
 * Apontamento gravado na forma do corpo normalizado (dia `AAAA-MM-DD`,
 * decimais com 4 casas): é a base da edição e da repetição.
 * @param {any} r
 * @returns {EstadoDoDia}
 */
const estadoGravado = (r) => ({
  data_operacional: diaDe(r.data_operacional),
  turno: r.turno ?? null,
  operador_usuario_id: r.operador_usuario_id ?? null,
  area_executada_dia: t4(r.area_executada_dia),
  quantidade_produzida_dia: t4(r.quantidade_produzida_dia),
  observacao: r.observacao ?? null,
  atividade_area_id: r.atividade_area_id ?? null,
});

/** A data do lançamento é obrigatória no estado final. @param {Partial<EstadoDoDia>} estado */
export const exigirData = (estado) => {
  if (!estado.data_operacional) throw invalido('data_operacional é obrigatória', { field: 'data_operacional', reason: 'obrigatorio' });
};

/** Estado normalizado → colunas do banco (o dia vira Date à meia-noite UTC). @param {Partial<EstadoDoDia>} campos */
const paraGravacao = (campos) => {
  /** @type {Record<string, any>} */
  const dados = { ...campos };
  if (temCampo(dados, 'data_operacional')) dados.data_operacional = comoData(dados.data_operacional);
  // D-PROD-265: o término só chega pelo `POST /atividades/registrar` (fora de `CAMPOS_DO_DIA`); nulo fica nulo.
  if (temCampo(dados, 'data_termino') && dados.data_termino) dados.data_termino = comoData(dados.data_termino);
  return dados;
};

// ─── regras ─────────────────────────────────────────────────────────────────

/**
 * Operador de um vínculo NOVO: usuário do tenant e ativo; senão 422
 * `ATIVIDADE_REFERENCIA_INVALIDA` (`inexistente` também para outro tenant,
 * sem oráculo; `inativo`). Nulo não confere; manter o gravado não relê nada.
 * @param {any} tx @param {string} clienteId @param {string|null} operadorId @param {string|null} [gravado]
 */
const exigirOperador = async (tx, clienteId, operadorId, gravado = null) => {
  if (!operadorId || operadorId === gravado) return;
  const usuario = await lerUsuario(tx, clienteId, operadorId);
  if (!usuario) throw atividadeReferenciaInvalida('operador_usuario_id', 'inexistente');
  if (!usuario.ativo) throw atividadeReferenciaInvalida('operador_usuario_id', 'inativo');
};

/**
 * Alertas do dia do lançamento (§10): `[]`, ou `[{ codigo: 'FORA_DO_INTERVALO',
 * mensagem, data_inicio, data_prevista_fim }]` quando o dia é anterior ao
 * início ou posterior ao fim previsto da atividade. Não bloqueia: o lançamento
 * já foi gravado. Sem `data_inicio` (ou sem `data_prevista_fim`), aquele lado
 * do período fica aberto.
 * @param {{ data_inicio?: unknown, data_prevista_fim?: unknown }} atividade  datas `AAAA-MM-DD` ou Date
 * @param {string} dia  `AAAA-MM-DD`
 * @returns {Array<{ codigo: string, mensagem: string, data_inicio: string|null, data_prevista_fim: string|null }>}
 */
export const alertasDoPeriodo = (atividade, dia) => {
  const inicio = /** @type {string|null} */ (diaDe(atividade?.data_inicio ?? null));
  const fim = /** @type {string|null} */ (diaDe(atividade?.data_prevista_fim ?? null));
  const antes = Boolean(inicio) && dia < /** @type {string} */ (inicio);
  const depois = Boolean(fim) && dia > /** @type {string} */ (fim);
  if (!antes && !depois) return [];
  const mensagem = antes
    ? `a data do lançamento (${dia}) é anterior ao início da atividade (${inicio}); o lançamento foi gravado mesmo assim`
    : `a data do lançamento (${dia}) é posterior ao fim previsto da atividade (${fim}); o lançamento foi gravado mesmo assim`;
  return [{ codigo: ALERTA_FORA_DO_INTERVALO, mensagem, data_inicio: inicio, data_prevista_fim: fim }];
};

/**
 * Trava a atividade (FOR UPDATE) e lê o essencial dela (status e período).
 * Outra empresa ou outro tenant → 404 `ATIVIDADE_NOT_FOUND`.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
const travarELerAtividade = async (tx, clienteId, empresaId, atividadeId) => {
  if (!(await travarAtividade(tx, clienteId, empresaId, atividadeId))) throw atividadeNotFound();
  const atividade = await lerAtividadeBase(tx, clienteId, empresaId, atividadeId);
  if (!atividade) throw atividadeNotFound();
  return atividade;
};

/**
 * Apontamento desta atividade e desta empresa, com os resumos; senão 404
 * `ATIVIDADE_APONTAMENTO_NOT_FOUND` (o mesmo para outra atividade, fazenda ou tenant).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id
 */
const carregarApontamento = async (db, clienteId, empresaId, atividadeId, id) => {
  const r = await buscarApontamento(db, clienteId, empresaId, atividadeId, id);
  if (!r) throw atividadeApontamentoNotFound();
  return r;
};

// ─── formas públicas e auditoria ────────────────────────────────────────────

/**
 * Forma pública do APONTAMENTO (§10 do contrato, nesta ordem): as colunas e,
 * ao lado de cada id de usuário, o resumo `{ id, nome }`; D-PROD-202: no fim,
 * `produtos[]` e `maquinas[]` (inclusive as canceladas).
 * @param {any} r  registro lido com `INCLUIR_APONTAMENTO`
 */
export const comoApontamentoPublico = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  atividade_id: r.atividade_id,
  data_operacional: diaDe(r.data_operacional),
  turno: r.turno ?? null,
  sequencia: r.sequencia,
  operador_usuario_id: r.operador_usuario_id ?? null,
  operador: usuarioPublico(r.operador),
  area_executada_dia: t4(r.area_executada_dia),
  quantidade_produzida_dia: t4(r.quantidade_produzida_dia),
  observacao: r.observacao ?? null,
  // D-PROD-249: a área da atividade em que o lançamento foi feito (nula na atividade sem área).
  atividade_area_id: r.atividade_area_id ?? null,
  atividade_area: r.atividadeArea ? { id: r.atividadeArea.id, area: r.atividadeArea.area ? { id: r.atividadeArea.area.id, numero_area: r.atividadeArea.area.numero_area, nome: r.atividadeArea.area.nome } : null } : null,
  // D-PROD-265: o último dia do serviço (Nova realização); nulo = um dia só.
  data_termino: r.data_termino ? diaDe(r.data_termino) : null,
  // MAIKE-ENTREGA2 (D-PROD-271): o nº do receituário agronômico (Aplicação); nulo sem ele.
  numero_receituario: r.numero_receituario ?? null,
  origem: r.origem,
  status: r.status,
  versao: r.versao,
  cancelado_em: iso(r.cancelado_em),
  cancelado_por: usuarioPublico(r.canceladoPor),
  motivo_cancelamento: r.motivo_cancelamento ?? null,
  criado_por: usuarioPublico(r.criadoPor),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
  // D-PROD-202: as linhas que geram custo, inclusive as canceladas, em ordem de lançamento.
  produtos: [...(r.produtos ?? [])].sort(porOrdem).map(comoLinhaProdutoPublica),
  maquinas: [...(r.maquinas ?? [])].sort(porOrdem).map(comoLinhaMaquinaPublica),
  // D-PROD-207 (Fatia 4): mão de obra e serviço de terceiro, inclusive as canceladas.
  mao_obra: [...(r.maoObras ?? [])].sort(porOrdem).map(comoLinhaMaoObraPublica),
  servicos: [...(r.servicos ?? [])].sort(porOrdem).map(comoLinhaServicoPublica),
});

/** Linhas na ordem em que foram lançadas (a `ordem` nunca é reaproveitada). @param {any} a @param {any} b */
function porOrdem(a, b) {
  return a.ordem - b.ordem;
}

/** Auditoria: as colunas, sem texto livre (só se há observação ou motivo). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  atividade_id: r.atividade_id,
  data_operacional: diaDe(r.data_operacional),
  turno: r.turno ?? null,
  sequencia: r.sequencia,
  operador_usuario_id: r.operador_usuario_id ?? null,
  area_executada_dia: t4(r.area_executada_dia),
  quantidade_produzida_dia: t4(r.quantidade_produzida_dia),
  atividade_area_id: r.atividade_area_id ?? null,
  // D-PROD-265: o término do serviço (Nova realização).
  data_termino: r.data_termino ? diaDe(r.data_termino) : null,
  // MAIKE-ENTREGA2 (D-PROD-271): só se há receituário (texto livre fica fora da auditoria).
  tem_receituario: Boolean(r.numero_receituario),
  origem: r.origem,
  status: r.status,
  versao: r.versao,
  cancelado_em: iso(r.cancelado_em),
  cancelado_por_usuario_id: r.cancelado_por_usuario_id ?? null,
  tem_observacao: Boolean(r.observacao),
  tem_motivo_cancelamento: Boolean(r.motivo_cancelamento),
});

/** Turno na ordem do dia; sem turno vem depois dos três. */
const POSICAO_DO_TURNO = Object.freeze({ MANHA: 0, TARDE: 1, NOITE: 2 });

/** @param {unknown} turno @returns {number} */
const posicaoDoTurno = (turno) =>
  typeof turno === 'string' && Object.prototype.hasOwnProperty.call(POSICAO_DO_TURNO, turno)
    ? POSICAO_DO_TURNO[/** @type {keyof typeof POSICAO_DO_TURNO} */ (turno)]
    : TURNOS.length;

/**
 * Ordem da lista (§10): dia desc; no dia, manhã → tarde → noite → sem turno;
 * no turno, a sequência (as passadas). O desempate por criação e id deixa a
 * ordem total (a unique já não deixa empate).
 * @param {any} a @param {any} b
 */
export const compararNaOrdemDaLista = (a, b) => {
  const diaA = String(diaDe(a.data_operacional));
  const diaB = String(diaDe(b.data_operacional));
  if (diaA !== diaB) return diaA < diaB ? 1 : -1;
  const turno = posicaoDoTurno(a.turno) - posicaoDoTurno(b.turno);
  if (turno !== 0) return turno;
  if (a.sequencia !== b.sequencia) return a.sequencia - b.sequencia;
  const criadoA = String(iso(a.createdAt) ?? '');
  const criadoB = String(iso(b.createdAt) ?? '');
  if (criadoA !== criadoB) return criadoA < criadoB ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
};

/**
 * Corpo das escritas (§10): `{ apontamento, atividade, alertas }` — o
 * apontamento relido, a atividade no formato do DETALHE (com os totais já
 * recalculados) e os alertas do dia, tudo na transação da escrita.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @param {any} registro  apontamento relido com `INCLUIR_APONTAMENTO`
 * @param {{ comAlertas?: boolean }} [opcoes]  o cancelamento não tem dia a conferir
 */
const respostaDaEscrita = async (tx, clienteId, empresaId, atividadeId, registro, { comAlertas = true } = {}) => {
  const atividade = await carregarAtividadeDetalhe(tx, clienteId, empresaId, atividadeId);
  return {
    apontamento: comoApontamentoPublico(registro),
    atividade,
    alertas: comAlertas ? alertasDoPeriodo(atividade, String(diaDe(registro.data_operacional))) : [],
  };
};

// ─── para o serviço do cabeçalho ────────────────────────────────────────────

/**
 * Recalcula `area_executada` e `quantidade_produzida` do cabeçalho como
 * Σ `area_executada_dia` e Σ `quantidade_produzida_dia` dos apontamentos
 * CONFIRMADO (nenhum confirmado com valor → nulo), na transação de quem chama
 * e SOB `travarAtividade`. Não mexe na `versao` do cabeçalho (os totais são
 * derivados). Devolve as somas gravadas, em texto com 4 casas.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string }} alvo  `clienteId` do auth_context
 * @returns {Promise<{ area_executada: string|null, quantidade_produzida: string|null }>}
 */
export const recalcularTotaisDaAtividade = (tx, { clienteId, empresaId, atividadeId }) =>
  recalcularTotaisNoCabecalho(tx, clienteId, empresaId, atividadeId);

/**
 * Cancelar a atividade propaga (§3): cancela num UPDATE só TODOS os
 * apontamentos CONFIRMADO dela, com o MESMO motivo, instante e usuário, e
 * incrementa a `versao` de cada um; depois, se algum foi cancelado, recalcula
 * os totais do cabeçalho (ficam nulos: não sobra confirmado). Devolve quantos
 * foram cancelados. A `versao` do CABEÇALHO não muda aqui: o CAS dela é de
 * quem chama.
 *
 * Quem chama (o serviço do cabeçalho), na MESMA transação: já travou a
 * atividade (`travarAtividade`), conferiu que ela está ABERTA, normalizou o
 * motivo (`motivoDoCorpo`) e tirou `agora` (e `hoje`) de `tempoDaFazenda` e
 * `usuarioId` do auth_context.
 *
 * D-PROD-202 (Fatia 3): ANTES do UPDATE, na mesma transação, as linhas dos
 * apontamentos cancelados também caem, com o mesmo motivo e a origem
 * `ATIVIDADE` — as de máquina (as leituras saem da série do medidor) e as de
 * produto, estornadas num `estornarEmLote` só (o estoque volta exato, no dia
 * `hoje` da fazenda). O estorno precisa do `contexto` da requisição (o motor
 * confere o auth_context); sem `hoje`, ele é lido do fuso da fazenda.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, usuarioId: string|null, motivo: string, agora: Date,
 *   hoje?: string, contexto?: { requestId?: string, auth: import('../../shared/auth/authContext.js').AuthContext } }} pedido
 * @returns {Promise<number>}
 */
export const cancelarApontamentosDaAtividade = async (tx, { clienteId, empresaId, atividadeId, usuarioId, motivo, agora, hoje, contexto }) => {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new Error('cancelarApontamentosDaAtividade: `agora` tem de ser um Date válido (de tempoDaFazenda)');
  }
  if (typeof motivo !== 'string' || !motivo.trim()) {
    throw new Error('cancelarApontamentosDaAtividade: `motivo` tem de vir normalizado (motivoDoCorpo)');
  }
  const apontamentoIds = await idsConfirmadosDaAtividade(tx, clienteId, empresaId, atividadeId);
  await cancelarLinhasDosApontamentos(tx, {
    clienteId, empresaId, atividadeId, apontamentoIds, usuarioId: usuarioId ?? null, motivo, agora, hoje, contexto, origem: ORIGEM_CANCELAMENTO_LINHA.ATIVIDADE,
  });
  const cancelados = await cancelarConfirmadosDaAtividade(tx, { clienteId, empresaId, atividadeId, usuarioId: usuarioId ?? null, motivo, agora });
  if (cancelados > 0) await recalcularTotaisDaAtividade(tx, { clienteId, empresaId, atividadeId });
  return cancelados;
};

/**
 * D-PROD-202 — a cascada das LINHAS (cancelar o apontamento ou a atividade):
 * primeiro as de máquina (trava bem → produto, a ordem do abastecimento),
 * depois o estorno exato das de produto. D-PROD-207: as de mão de obra e de
 * serviço caem junto (sem estoque nem medidor: só o status).
 * D-PROD-211 (Fatia 5): os ABASTECIMENTOS confirmados ligados aos apontamentos
 * também caem (estorno exato no ESTOQUE, só o status no EXTERNO), pelo mesmo
 * caminho do cancelamento do abastecimento, com o motivo derivado — DEPOIS das
 * de máquina e ANTES das de produto. Travas: Bens (ordenados) → AbastecimentoBem
 * → UM `travarProdutosEstoque` com a UNIÃO ordenada dos combustíveis (ESTOQUE)
 * e dos produtos das linhas de produto confirmadas → lotes/movimentos; o
 * estorno das linhas de produto, depois, só retrava produtos que a transação já
 * tem (nenhuma segunda ordem de Produto, nenhuma inversão Produto → Bem). Sem
 * abastecimento ligado, o estorno das linhas trava o conjunto delas sozinho.
 * Devolve as contagens.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, apontamentoIds: string[], usuarioId: string|null,
 *   motivo: string, agora: Date, hoje?: string, contexto?: any, origem: 'APONTAMENTO'|'ATIVIDADE' }} pedido
 */
const cancelarLinhasDosApontamentos = async (tx, { clienteId, empresaId, atividadeId, apontamentoIds, usuarioId, motivo, agora, hoje, contexto, origem }) => {
  if (!apontamentoIds.length) return { maquinas: 0, produtos: 0, mao_obra: 0, servicos: 0, abastecimentos: 0 };
  const maquinas = await cancelarLinhasMaquinaDoApontamento(tx, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, agora, origem });
  // Os produtos das linhas de produto CONFIRMADO: a cascata dos abastecimentos os trava JUNTO com os combustíveis,
  // num conjunto ordenado só (uma ordem global de Produto; o estorno das linhas, depois, só retrava o que já tem).
  const produtosDasLinhas = (await tx.atividadeApontamentoProduto.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds }, status: 'CONFIRMADO' },
    select: { produto_id: true },
    distinct: ['produto_id'],
  })).map((/** @type {{ produto_id: string }} */ l) => l.produto_id);
  const abastecimentos = await cancelarAbastecimentosDosApontamentos(tx, contexto, {
    clienteId, empresaId, apontamentoIds, usuarioId, motivo, hoje, origem, produtosAdicionais: produtosDasLinhas,
  });
  const maoObra = await cancelarLinhasMaoObraDoApontamento(tx, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, agora, origem });
  const servicos = await cancelarLinhasServicoDoApontamento(tx, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, agora, origem });
  const temProduto = produtosDasLinhas.length > 0;
  if (!temProduto) return { maquinas, produtos: 0, mao_obra: maoObra, servicos, abastecimentos };
  if (!contexto?.auth) throw new Error('cancelamento em cascata: o estorno das linhas de produto precisa do contexto da requisição');
  const produtos = await cancelarLinhasProdutoDosApontamentos(tx, contexto, { clienteId, empresaId, atividadeId, apontamentoIds, usuarioId, motivo, agora, hoje, origem });
  return { maquinas, produtos, mao_obra: maoObra, servicos, abastecimentos };
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * `GET /atividades/:id/apontamentos`: TODOS os apontamentos da atividade
 * (confirmados e cancelados, sem paginação), na ordem da lista. Atividade de
 * outra empresa ou tenant → 404 `ATIVIDADE_NOT_FOUND`. Leitura consistente
 * (RepeatableRead, sem trava).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {Record<string, any>} [query]
 * @returns {Promise<{ items: Array<ReturnType<typeof comoApontamentoPublico>> }>}
 */
export const listarApontamentos = async (contexto, atividadeId, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    if (!(await lerAtividadeBase(tx, cli, empresaId, atividadeId))) throw atividadeNotFound();
    const linhas = await listarApontamentosDaAtividade(tx, cli, empresaId, atividadeId);
    return { items: [...linhas].sort(compararNaOrdemDaLista).map(comoApontamentoPublico) };
  });
};

/**
 * `GET /atividades/:id/apontamentos/:apontamentoId`: o apontamento na forma
 * pública. Atividade inexistente → 404 `ATIVIDADE_NOT_FOUND`; apontamento de
 * outra atividade → 404 `ATIVIDADE_APONTAMENTO_NOT_FOUND`.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} [query]
 */
export const obterApontamento = async (contexto, atividadeId, apontamentoId, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    if (!(await lerAtividadeBase(tx, cli, empresaId, atividadeId))) throw atividadeNotFound();
    return comoApontamentoPublico(await carregarApontamento(tx, cli, empresaId, atividadeId, apontamentoId));
  });
};

// ─── lançamento e repetição ─────────────────────────────────────────────────

/**
 * @typedef {{ operationId: string|null, produtos: Array<ReturnType<typeof normalizarDadosDaLinha>>, maquinas: unknown[],
 *   maoObra: unknown[], servicos: unknown[] }} LinhasDoLancamento
 */

/** JSON com as chaves em ordem (o fingerprint não depende da ordem das chaves do cliente). @param {unknown} v @returns {unknown} */
export const canonico = (v) => {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(/** @type {any} */ (v)[k])]));
  return v;
};

/**
 * D-PROD-207 — `mao_obra[]` e `servicos[]` entram no fingerprint SÓ quando
 * vêm (o fingerprint de um lançamento sem elas segue o mesmo da Fatia 3).
 * @param {LinhasDoLancamento} linhas
 */
export const linhasNovasDoFingerprint = (linhas) => ({
  ...(linhas.maoObra.length ? { mao_obra: canonico(linhas.maoObra) } : {}),
  ...(linhas.servicos.length ? { servicos: canonico(linhas.servicos) } : {}),
});

/**
 * D-PROD-202 — as linhas do corpo do lançamento/repetição: `produtos[]`
 * normalizados (400/422 antes da transação), `maquinas[]` como vieram (o
 * serviço da máquina normaliza) e a chave. Com linha, `operation_id` é
 * obrigatório (até 120: cada linha grava `<operation_id>:p<n>`).
 * @param {Record<string, any>} corpo
 * @returns {LinhasDoLancamento}
 */
export const linhasDoCorpo = (corpo) => {
  const produtosBrutos = Array.isArray(corpo.produtos) ? corpo.produtos : [];
  const maquinas = Array.isArray(corpo.maquinas) ? corpo.maquinas : [];
  // D-PROD-207: `mao_obra[]` e `servicos[]` como vieram (os serviços das linhas normalizam).
  const maoObra = Array.isArray(corpo.mao_obra) ? corpo.mao_obra : [];
  const servicos = Array.isArray(corpo.servicos) ? corpo.servicos : [];
  const produtos = produtosBrutos.map((/** @type {any} */ l, /** @type {number} */ i) => normalizarDadosDaLinha(l ?? {}, `produtos[${i}].`));
  const temChave = corpo.operation_id !== undefined && corpo.operation_id !== null;
  if (!temChave && (produtos.length || maquinas.length || maoObra.length || servicos.length)) {
    throw invalido('operation_id é obrigatório no lançamento com linhas (produto, máquina, mão de obra ou serviço)', { field: 'operation_id', reason: 'obrigatorio' });
  }
  return { operationId: temChave ? operationIdDoCorpo(corpo.operation_id, OPERATION_ID_DO_LANCAMENTO_MAXIMO) : null, produtos, maquinas, maoObra, servicos };
};

/**
 * Roda a escrita do lançamento: sem chave, como na Fatia 2 (só a transação);
 * com chave, sob o recibo de idempotência (reenvio igual devolve o corpo
 * gravado com `replay: true`; corpo diferente → 409, auditado à parte). A
 * chave de uma linha de produto, mão de obra ou serviço JÁ gravada
 * (`<operation_id>:p<n>`, `:o<n>`, `:s<n>`, comparadas EXATAS) é conflito
 * mesmo sem o recibo.
 * D-PROD-263: `bases` = as chaves de onde as linhas derivam as suas (padrão: só a do corpo; o registro de várias áreas
 * passa uma por área — `<chave>`, `<chave>:a2`, …), todas conferidas do mesmo jeito.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ operationId: string|null, tipoOperacao: string, fingerprint: () => string, executar: (tx: any) => Promise<Record<string, unknown>>,
 *   bases?: string[] }} a
 * @returns {Promise<Record<string, unknown>>}
 */
export const comReciboOpcional = async (contexto, { operationId, tipoOperacao, fingerprint, executar, bases = undefined }) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  if (!operationId) return emTransacao(TRANSACAO_CURTA, executar, UNICOS, MENSAGEM_CONFLITO_SEM_CHAVE);
  const chave = operationId;
  const conflito = () => new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', { details: { operation_id: chave } });
  /** @param {'produto'|'mao_obra'|'servico'} tipo */
  const derivadas = (tipo) => (bases ?? [chave]).flatMap((b) => chavesDerivadasDasLinhas(b, tipo));
  try {
    const r = await emTransacao(
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: chave,
          tipoOperacao,
          fingerprint: fingerprint(),
          executar: async () => {
            // As chaves derivadas EXATAS (`<chave>:p1…p20`, nunca um prefixo com curinga de LIKE).
            if (await existeLinhaComChave(tx, cli, derivadas('produto'))) throw conflito();
            // D-PROD-207: idem para as chaves derivadas das linhas de mão de obra (`:o`) e de serviço (`:s`).
            if (await existeLinhaMaoObraComChave(tx, cli, derivadas('mao_obra'))) throw conflito();
            if (await existeLinhaServicoComChave(tx, cli, derivadas('servico'))) throw conflito();
            return { httpStatus: 201, body: await executar(tx) };
          },
        }),
      { ...UNICOS, operation_id: conflito }
    );
    return { ...r.body, replay: r.replay };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, ENTIDADE_APONTAMENTO, chave, tipoOperacao);
    throw e;
  }
};

/**
 * INSERT do apontamento (lançar e repetir), já com as regras conferidas e SOB
 * a trava da atividade: sequência nova, as linhas (máquina, depois produto),
 * totais recalculados, auditoria e a resposta da escrita.
 * @param {any} tx
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ clienteId: string, empresaId: string, atividade: any, estado: EstadoDoDia, origem: string,
 *   acao: string, linhas: LinhasDoLancamento, extras?: Record<string, unknown> }} novo
 */
const gravarNovo = async (tx, contexto, { clienteId, empresaId, atividade, estado, origem, acao, linhas, extras = {} }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const atividadeId = atividade.id;
  const sequencia = await proximaSequencia(tx, {
    clienteId,
    empresaId,
    atividadeId,
    dia: /** @type {string} */ (estado.data_operacional),
    turno: estado.turno,
  });
  const { id } = await comFkTraduzida(() =>
    inserirApontamento(tx, {
      ...paraGravacao(estado),
      cliente_id: clienteId,
      empresa_id: empresaId,
      atividade_id: atividadeId,
      sequencia,
      origem,
      status: STATUS_APONTAMENTO.CONFIRMADO,
      criado_por_usuario_id: auth.usuarioId,
      versao: 1,
    })
  );
  if (linhas.maquinas.length || linhas.produtos.length || linhas.maoObra.length || linhas.servicos.length) {
    const apontamento = await tx.atividadeApontamento.findFirst({
      where: { cliente_id: clienteId, empresa_id: empresaId, id },
      select: { id: true, empresa_id: true, atividade_id: true, data_operacional: true, status: true, versao: true, area_executada_dia: true },
    });
    // Máquina antes de produto: a trava do bem vem antes da do produto, como no abastecimento.
    if (linhas.maquinas.length) await criarLinhasMaquina(tx, contexto, { apontamento, atividade, linhas: linhas.maquinas });
    if (linhas.produtos.length) {
      await criarLinhasProduto(tx, contexto, { apontamento, atividade, linhas: linhas.produtos, operationId: /** @type {string} */ (linhas.operationId) });
    }
    // D-PROD-207: mão de obra e serviço (sem trava própria: nem estoque nem medidor), com a chave do lançamento.
    if (linhas.maoObra.length) await criarLinhasMaoObra(tx, contexto, { apontamento, atividade, linhas: linhas.maoObra, operationId: linhas.operationId });
    if (linhas.servicos.length) await criarLinhasServico(tx, contexto, { apontamento, atividade, linhas: linhas.servicos, operationId: linhas.operationId });
  }
  const totais = await recalcularTotaisDaAtividade(tx, { clienteId, empresaId, atividadeId });
  const registro = await carregarApontamento(tx, clienteId, empresaId, atividadeId, id);
  await registrarEvento(
    contexto,
    {
      acao,
      entidade: ENTIDADE_APONTAMENTO,
      entidadeId: id,
      dadosNovos: {
        ...paraAuditoria(registro),
        ...extras,
        linhas_produto: (registro.produtos ?? []).map((/** @type {any} */ l) => l.id),
        linhas_maquina: (registro.maquinas ?? []).map((/** @type {any} */ l) => l.id),
        linhas_mao_obra: (registro.maoObras ?? []).map((/** @type {any} */ l) => l.id),
        linhas_servico: (registro.servicos ?? []).map((/** @type {any} */ l) => l.id),
        ...(linhas.operationId ? { operation_id: linhas.operationId } : {}),
        totais_da_atividade: totais,
      },
    },
    tx
  );
  return respostaDaEscrita(tx, clienteId, empresaId, atividadeId, registro);
};

/**
 * O lançamento do dia NA transação de quem chama (Empresa já FOR SHARE em `tempoDaFazenda`): trava a atividade, confere
 * status, dia, operador e a área e grava apontamento + linhas (`gravarNovo`). É o caminho ÚNICO do `POST …/apontamentos`
 * e do `POST /atividades/registrar` (D-PROD-254): nenhuma regra duplicada. `estado.atividade_area_id` ausente segue a
 * regra de `exigirAreaDoLancamento`.
 * @param {any} tx
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{ clienteId: string, empresaId: string, tempo: { hoje: string, fuso: string }, atividadeId: string, estado: EstadoDoDia, origem: string, linhas: LinhasDoLancamento }} p
 */
export const lancarNaTransacao = async (tx, contexto, { clienteId, empresaId, tempo, atividadeId, estado, origem, linhas }) => {
  const atividade = await travarELerAtividade(tx, clienteId, empresaId, atividadeId); // Atividade FOR UPDATE
  exigirStatusDaAtividade(atividade, 'lancar_apontamento');
  exigirDiaNaoFuturo(tempo, /** @type {string} */ (estado.data_operacional), 'data_operacional');
  await exigirOperador(tx, clienteId, estado.operador_usuario_id);
  // D-PROD-249: a área do lançamento (desta atividade e EM_ANDAMENTO; com uma área só, ela mesma).
  const atividadeAreaId = await exigirAreaDoLancamento(tx, { clienteId, empresaId, atividadeId, atividadeAreaId: estado.atividade_area_id });
  return gravarNovo(tx, contexto, {
    clienteId, empresaId, atividade, estado: { ...estado, atividade_area_id: atividadeAreaId }, origem, acao: ACOES_AUDITORIA_APONTAMENTO.lancar, linhas,
  });
};

/**
 * `POST /atividades/:id/apontamentos`: lança o apontamento do dia (201), com
 * `produtos[]` e `maquinas[]` opcionais (D-PROD-202: tudo numa transação, com
 * `operation_id`; reenvio igual → 200 com `replay: true`).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {Record<string, any>} corpo
 */
export const lancarApontamento = async (contexto, atividadeId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  /** @type {EstadoDoDia} */
  const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
  exigirData(estado);
  const origem = origemDoCorpo(corpo.origem);
  const linhas = linhasDoCorpo(corpo);

  return comReciboOpcional(contexto, {
    operationId: linhas.operationId,
    tipoOperacao: TIPOS_OPERACAO_APONTAMENTO.lancar,
    fingerprint: () =>
      fingerprintDePayload({
        v: 1, atividade_id: atividadeId, empresa_id: corpo.empresa_id, estado, origem, produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas),
      }),
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      return lancarNaTransacao(tx, contexto, { clienteId: cli, empresaId, tempo, atividadeId, estado, origem, linhas });
    },
  });
};

/**
 * `POST …/:apontamentoId/duplicar` ("repetir último lançamento", 201): um
 * lançamento NOVO com turno, operador, área do dia, produção e observação da
 * base, no dia do corpo (padrão hoje na fazenda), com sequência nova e as
 * mesmas validações do lançamento. A origem é a padrão (o corpo não a traz).
 * D-PROD-202: as linhas vêm no corpo (`produtos[]`, `maquinas[]`, a tela as
 * traz preenchidas da base para o operador ajustar), com `operation_id`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const duplicarApontamento = async (contexto, atividadeId, apontamentoId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const diaInformado = diaDoCorpo(corpo.data_operacional, 'data_operacional');
  // D-PROD-249: a área do lançamento novo (padrão: a da base).
  const areaInformada = corpo.atividade_area_id === undefined ? undefined : idOuNulo(corpo.atividade_area_id, 'atividade_area_id');
  const linhas = linhasDoCorpo(corpo);

  return comReciboOpcional(contexto, {
    operationId: linhas.operationId,
    tipoOperacao: TIPOS_OPERACAO_APONTAMENTO.duplicar,
    fingerprint: () =>
      fingerprintDePayload({
        v: 1, atividade_id: atividadeId, base_id: apontamentoId, empresa_id: corpo.empresa_id, data_operacional: diaInformado ?? null, produtos: linhas.produtos, maquinas: canonico(linhas.maquinas),
        ...(areaInformada !== undefined ? { atividade_area_id: areaInformada } : {}),
        ...linhasNovasDoFingerprint(linhas),
      }),
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      const atividade = await travarELerAtividade(tx, cli, empresaId, atividadeId); // Atividade FOR UPDATE
      const base = await carregarApontamento(tx, cli, empresaId, atividadeId, apontamentoId);
      exigirStatusDaAtividade(atividade, 'lancar_apontamento');
      /** @type {EstadoDoDia} */
      const estado = { ...estadoGravado(base), data_operacional: diaInformado ?? tempo.hoje };
      exigirDiaNaoFuturo(tempo, /** @type {string} */ (estado.data_operacional), 'data_operacional');
      await exigirOperador(tx, cli, estado.operador_usuario_id); // vínculo novo: o operador tem de estar ativo
      // D-PROD-249: a área do lançamento novo tem de estar EM_ANDAMENTO (a da base, ou a do corpo).
      estado.atividade_area_id = await exigirAreaDoLancamento(tx, {
        clienteId: cli, empresaId, atividadeId, atividadeAreaId: areaInformada === undefined ? estado.atividade_area_id : areaInformada,
      });
      return gravarNovo(tx, contexto, {
        clienteId: cli,
        empresaId,
        atividade,
        estado,
        origem: ORIGEM_PADRAO,
        acao: ACOES_AUDITORIA_APONTAMENTO.duplicar,
        linhas,
        extras: { duplicado_de: base.id },
      });
    },
  });
};

// ─── edição ─────────────────────────────────────────────────────────────────

/**
 * A fazenda do PATCH, como no PATCH do cabeçalho: a do corpo (conferida no
 * tenant) ou, sem ela, a da atividade da URL no tenant (404 se não existe).
 * @param {any} tx @param {string} clienteId @param {unknown} empresaDoCorpo @param {string} atividadeId
 * @returns {Promise<string>}
 */
const empresaDaEdicao = async (tx, clienteId, empresaDoCorpo, atividadeId) => {
  if (empresaDoCorpo !== undefined) return exigirEmpresaDoTenant(tx, clienteId, empresaDoCorpo);
  const atividade = await lerEmpresaDaAtividade(tx, clienteId, atividadeId);
  if (!atividade) throw atividadeNotFound();
  return atividade.empresa_id;
};

/**
 * `PATCH …/:apontamentoId`: só os campos enviados mudam (null limpa um
 * opcional). Exige a `versao` lida (CAS), apontamento CONFIRMADO e atividade
 * ABERTA. Trocar a data ou o turno refaz a sequência (máx + 1 no grupo novo);
 * a data nova também não pode ser futura; operador trocado tem de estar ativo.
 * `empresa_id` no corpo é opcional (ausente, vale a fazenda da atividade).
 * D-PROD-202: a data não muda com linha de produto ou de máquina CONFIRMADA
 * (409 `ATIVIDADE_DATA_COM_LINHAS`); trocar a área do dia refaz a `dose_ha`
 * das linhas de produto confirmadas.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const editarApontamento = async (contexto, atividadeId, apontamentoId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const campos = camposDoCorpo(corpo);
  if (!Object.keys(campos).length) throw invalido('informe ao menos um campo do lançamento para alterar', { field: 'corpo', reason: 'sem_alteracao' });
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await empresaDaEdicao(tx, cli, corpo.empresa_id, atividadeId);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      const atividade = await travarELerAtividade(tx, cli, empresaId, atividadeId); // Atividade FOR UPDATE
      const anterior = await carregarApontamento(tx, cli, empresaId, atividadeId, apontamentoId);
      exigirStatusDaAtividade(atividade, 'editar_apontamento');
      exigirApontamentoConfirmado(anterior, 'editar_apontamento');
      exigirVersao(anterior, versao, 'apontamento');
      const gravado = estadoGravado(anterior);
      /** @type {EstadoDoDia} */
      const estado = { ...gravado, ...campos };
      exigirData(estado);
      if (temCampo(campos, 'data_operacional')) exigirDiaNaoFuturo(tempo, /** @type {string} */ (estado.data_operacional), 'data_operacional');
      // D-PROD-265: o término gravado (Nova realização) nunca fica antes do início; o CHECK do banco também recusa.
      const termino = anterior.data_termino ? diaDe(anterior.data_termino) : null;
      if (termino && /** @type {string} */ (estado.data_operacional) > termino) {
        throw atividadeDataInvalida('data_operacional', 'depois_do_termino', { data: estado.data_operacional, data_termino: termino });
      }
      if (estado.data_operacional !== gravado.data_operacional) {
        // A saída de estoque e a leitura do medidor das linhas estão nesta data: cancelar e lançar de novo.
        const produtos = await contarLinhasProdutoConfirmadas(tx, cli, empresaId, apontamentoId);
        const maquinas = await contarLinhasMaquinaConfirmadas(tx, { clienteId: cli, empresaId, apontamentoId });
        // D-PROD-207: o custo da mão de obra e do serviço também é deste dia.
        const maoObra = await contarLinhasMaoObraConfirmadas(tx, { clienteId: cli, empresaId, apontamentoId });
        const servicos = await contarLinhasServicoConfirmadas(tx, { clienteId: cli, empresaId, apontamentoId });
        if (produtos + maquinas + maoObra + servicos > 0) throw atividadeDataComLinhas({ produtos, maquinas, maoObra, servicos });
      }
      await exigirOperador(tx, cli, estado.operador_usuario_id, gravado.operador_usuario_id);
      const dados = paraGravacao(campos);
      // D-PROD-249: trocar a área do lançamento: a nova é desta atividade e está EM_ANDAMENTO (manter a gravada não confere).
      if (temCampo(campos, 'atividade_area_id') && campos.atividade_area_id !== gravado.atividade_area_id) {
        dados.atividade_area_id = await exigirAreaDoLancamento(tx, { clienteId: cli, empresaId, atividadeId, atividadeAreaId: campos.atividade_area_id });
      } else {
        delete dados.atividade_area_id;
      }
      if (estado.data_operacional !== gravado.data_operacional || estado.turno !== gravado.turno) {
        dados.sequencia = await proximaSequencia(tx, {
          clienteId: cli,
          empresaId,
          atividadeId,
          dia: /** @type {string} */ (estado.data_operacional),
          turno: estado.turno,
        });
      }
      const alvo = { clienteId: cli, empresaId, id: apontamentoId, versao, statusEsperado: STATUS_APONTAMENTO.CONFIRMADO, onde: { atividade_id: atividadeId } };
      const alterados = await comFkTraduzida(() => atualizarComVersao(tx.atividadeApontamento, { ...alvo, dados }));
      if (alterados !== 1) throw await erroDoCasPerdido(tx.atividadeApontamento, { ...alvo, acao: 'editar_apontamento', entidade: 'apontamento' });
      if (estado.area_executada_dia !== gravado.area_executada_dia) {
        await recalcularDosesDoApontamento(tx, { clienteId: cli, empresaId, apontamentoId, area: estado.area_executada_dia });
      }
      const totais = await recalcularTotaisDaAtividade(tx, { clienteId: cli, empresaId, atividadeId });
      const registro = await carregarApontamento(tx, cli, empresaId, atividadeId, apontamentoId);
      await registrarEvento(
        contexto,
        {
          acao: ACOES_AUDITORIA_APONTAMENTO.editar,
          entidade: ENTIDADE_APONTAMENTO,
          entidadeId: apontamentoId,
          dadosAnteriores: paraAuditoria(anterior),
          dadosNovos: { ...paraAuditoria(registro), campos_alterados: Object.keys(dados).sort(), totais_da_atividade: totais },
        },
        tx
      );
      return respostaDaEscrita(tx, cli, empresaId, atividadeId, registro);
    },
    UNICOS,
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── cancelamento ───────────────────────────────────────────────────────────

/**
 * `POST …/:apontamentoId/cancelar`: sem DELETE físico, CONFIRMADO → CANCELADO
 * com quem, quando (o "agora" do relógio da fazenda) e motivo; CAS pela
 * `versao`. Só apontamento CONFIRMADO de atividade ABERTA. Os totais do
 * cabeçalho são recalculados (o cancelado sai da soma). `alertas` é sempre `[]`.
 * D-PROD-202: antes do UPDATE, na mesma transação, as linhas confirmadas caem
 * com o mesmo motivo (origem `APONTAMENTO`): as de máquina e as de produto,
 * estornadas exatamente num `estornarEmLote` (o estoque volta, no dia de hoje).
 * D-PROD-211: e os abastecimentos CONFIRMADO ligados a ele (motivo derivado).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const cancelarApontamento = async (contexto, atividadeId, apontamentoId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const motivo = motivoDoCorpo(corpo.motivo);
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const { agora, hoje } = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      const atividade = await travarELerAtividade(tx, cli, empresaId, atividadeId); // Atividade FOR UPDATE
      const antes = await carregarApontamento(tx, cli, empresaId, atividadeId, apontamentoId);
      exigirStatusDaAtividade(atividade, 'cancelar_apontamento');
      exigirApontamentoConfirmado(antes, 'cancelar_apontamento');
      exigirVersao(antes, versao, 'apontamento');
      const linhas = await cancelarLinhasDosApontamentos(tx, {
        clienteId: cli, empresaId, atividadeId, apontamentoIds: [apontamentoId], usuarioId: auth.usuarioId ?? null, motivo, agora, hoje, contexto,
        origem: ORIGEM_CANCELAMENTO_LINHA.APONTAMENTO,
      });
      const alvo = { clienteId: cli, empresaId, id: apontamentoId, versao, statusEsperado: STATUS_APONTAMENTO.CONFIRMADO, onde: { atividade_id: atividadeId } };
      const alterados = await atualizarComVersao(tx.atividadeApontamento, {
        ...alvo,
        dados: { status: STATUS_APONTAMENTO.CANCELADO, cancelado_em: agora, cancelado_por_usuario_id: auth.usuarioId, motivo_cancelamento: motivo },
      });
      if (alterados !== 1) throw await erroDoCasPerdido(tx.atividadeApontamento, { ...alvo, acao: 'cancelar_apontamento', entidade: 'apontamento' });
      const totais = await recalcularTotaisDaAtividade(tx, { clienteId: cli, empresaId, atividadeId });
      const depois = await carregarApontamento(tx, cli, empresaId, atividadeId, apontamentoId);
      await registrarEvento(
        contexto,
        {
          acao: ACOES_AUDITORIA_APONTAMENTO.cancelar,
          entidade: ENTIDADE_APONTAMENTO,
          entidadeId: apontamentoId,
          dadosAnteriores: paraAuditoria(antes),
          dadosNovos: { ...paraAuditoria(depois), linhas_canceladas: linhas, totais_da_atividade: totais },
        },
        tx
      );
      return respostaDaEscrita(tx, cli, empresaId, atividadeId, depois, { comAlertas: false });
    },
    UNICOS,
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};
