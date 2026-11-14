/**
 * Serviço de ApontamentoAtividade (D-PROD-190, Fatia C).
 *
 * A TAREFA (`LancamentoTarefa`) é a demanda; o APONTAMENTO é a EXECUÇÃO de um
 * Tipo de Atividade (D-PROD-182): a operação feita, que consome máquina,
 * combustível e insumo. D-PROD-191 (Fatia D): o apontamento CONFIRMADO recebe
 * ITENS de custo (`apontamentoAtividadeItemService.js`: adicionar e cancelar
 * item); aqui ficam o DETALHE com os itens e o custo, o estorno exato dos itens
 * PRODUTO (um caminho só, para o cancelamento do item e o do apontamento) e o
 * cancelamento do apontamento, que cancela e estorna TODOS os itens na mesma
 * transação. O abastecimento se pendura aqui numa fatia seguinte.
 *
 * Molde: o cadastro de Tipo de Atividade (estrutura, auth, guardas, auditoria,
 * erros) e o abastecimento (número pela sequência do tenant, keyset,
 * cancelamento com CAS por `versao`, "hoje" no fuso da fazenda).
 *
 * Regras:
 *  - R-a tipo inativo não entra em apontamento NOVO; manter o tipo na edição
 *    pode (mesmo que inativo agora); TROCAR para um tipo inativo, não. O mesmo
 *    vale para bem, implemento, operador, área e centros (vínculo NOVO exige
 *    cadastro ativo; manter um que depois foi inativado é permitido), como no
 *    cadastro do bem;
 *  - R-b hora_fim anterior a hora_inicio é recusada (iguais pode);
 *  - R-c data operacional posterior a "hoje" no fuso da fazenda é recusada;
 *    sem fuso configurado, falha fechado (EMPRESA_FUSO_NAO_CONFIGURADO). As
 *    horas também ficam dentro do executado: nenhuma depois de "agora" (o
 *    MESMO relógio do "hoje", `agoraDoServidor`); `hora_inicio` e `hora_fim`
 *    caem na data operacional (dia local no fuso da fazenda). Sem turno que
 *    vira o dia: com a R-b, é o que a tela permite (HH:MM no mesmo dia, fim
 *    não antes do início); um turno noturno vira dois apontamentos. Mesmo
 *    código da R-b, com `reason` `hora_futura`
 *    ou `hora_fora_do_dia`; na edição, reaplicada sobre o estado final quando
 *    a data ou uma das horas vem no PATCH; sem horas, nada a conferir;
 *  - R-d implemento exige bem e não pode ser o próprio bem;
 *  - R-e CENTRO DE CUSTO (regra acordada com o proprietário): na CRIAÇÃO, se
 *    ele vier nulo ou ausente e houver bem, o servidor COPIA o centro de custo
 *    do cadastro do bem, na mesma transação, SÓ se esse centro estiver ativo
 *    (inativo não é copiado: fica nulo); o informado explicitamente vence.
 *    Depois da criação é SNAPSHOT: nunca é relido do bem (nem ao editar outro
 *    campo, nem ao trocar o bem, nem quando o bem muda de centro); na edição só
 *    muda se vier explícito no PATCH. CENTRO DE RESULTADO: o escolhido pelo
 *    usuário na lista de centros de resultado ativos da empresa; NUNCA vem do
 *    bem (o bem nem tem esse campo), nunca é copiado nem preenchido sozinho;
 *  - R-f quantidade produzida e unidade andam juntas; quantidade > 0; horas > 0;
 *    unidade ∈ {HA, CAB, TON, KM};
 *  - R-g apontamento CANCELADO não aceita edição nem novo cancelamento;
 *  - R-h `tipo_atividade_nome`, `grupo_atividade_id` e `grupo_atividade_nome`
 *    são gravados do tipo na criação e quando o tipo é TROCADO; renomear o tipo
 *    ou o grupo depois NÃO propaga (fora de `referencias/propagationRules.js`);
 *  - R-i bem, implemento, área e lançamento de tarefa são da MESMA empresa do
 *    apontamento (centros também; a FK composta já garante);
 *  - R-j sem DELETE físico: cancelar grava status, quem, quando e motivo, e
 *    incrementa `versao` (CAS, como o abastecimento). D-PROD-191: o
 *    cancelamento é idempotente por `operation_id` (obrigatório, D-2), trava a
 *    linha do apontamento e cancela/estorna todos os itens CONFIRMADO junto;
 *    qualquer estorno recusado → 409 e nada muda;
 *  - D-1 (D-PROD-191): o PATCH não muda `data_operacional` se houver item
 *    PRODUTO CONFIRMADO (a saída de estoque está na data gravada) → 409
 *    `APONTAMENTO_ATIVIDADE_DATA_COM_ITENS`; lê os itens sem trava (o CAS por
 *    `versao` o protege: um item que entre depois muda a versão);
 *  - R-k `numero` pela sequência do tenant (`EntidadeCodigoSequencia`), o
 *    mesmo formato do abastecimento e do bem;
 *  - tenant SÓ do auth_context; a empresa vem do corpo/query e é conferida no
 *    tenant (`exigirEmpresaDoTenant`), como no abastecimento.
 *
 * Decimais em `Dec` (decimalFinanceiro), nunca Number: chegam como TEXTO e
 * saem com 4 casas.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  apontamentoAtividadeDataComItens,
  apontamentoAtividadeDataFutura,
  apontamentoAtividadeEstornoBloqueado,
  apontamentoAtividadeHorarioInvalido,
  apontamentoAtividadeImplementoInvalido,
  apontamentoAtividadeNotFound,
  apontamentoAtividadeProducaoInvalida,
  apontamentoAtividadeReferenciaInvalida,
  apontamentoAtividadeStatusInvalido,
  apontamentoAtividadeVersaoConflito,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { fkDoApontamentoNaEscrita } from '../../shared/errors/vinculoApontamentoAtividade.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento, registrarEventosEmLote } from '../auditoria/auditService.js';
import {
  EFEITO_SAIDA, ORIGEM_APONTAMENTO, estornarEmLote, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { CASAS_CUSTO, CASAS_PRECO, CASAS_QUANTIDADE, dec, somar } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import { comoData, diaDe, ehDiaValido, paginacaoOpcoes, paginarPorNome, termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { unidadeEfetivaDoEstoque } from '../patrimonio/patrimonioDominio.js';
import { agoraDoServidor, diaNoFuso, fusoDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  atualizarComVersao,
  buscarApontamento,
  buscarApontamentoComItens,
  cancelarItensConfirmados,
  contarItensProdutoConfirmados,
  inserirApontamento,
  lerArea,
  lerBem,
  lerCentro,
  lerCentroCustoDoBem,
  lerItensComFatias,
  lerLancamentoTarefa,
  lerTipoAtividade,
  lerUsuario,
  lerVersaoEStatus,
  listarApontamentos,
  travarApontamento,
} from './apontamentoAtividadeRepository.js';

export const ENTIDADE = 'ApontamentoAtividade';
export const STATUS_CONFIRMADO = 'CONFIRMADO';
export const STATUS_CANCELADO = 'CANCELADO';
export const STATUS = Object.freeze([STATUS_CONFIRMADO, STATUS_CANCELADO]);
/** R-f — hectare, cabeça, tonelada, quilômetro. */
export const UNIDADES_PRODUCAO = Object.freeze(['HA', 'CAB', 'TON', 'KM']);
/** Decimal(14, 4): até 10 dígitos inteiros e 4 casas, como texto. */
export const PADRAO_DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;
/** Instante ISO 8601 com fuso EXPLÍCITO (`Z` ou ±hh:mm): sem fuso, a hora seria ambígua. */
export const PADRAO_INSTANTE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
export const MOTIVO_MINIMO = 3;
/** Chave de idempotência (= `PADRAO_OPERATION_ID` do abastecimento e o CHECK da tabela de itens). */
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
/** D-PROD-191 — entidade e situações do item (CHECK da tabela). */
export const ENTIDADE_ITEM = 'ApontamentoAtividadeItem';
export const TIPO_PRODUTO = 'PRODUTO';
/** D-2 (D-PROD-191) — recibo do cancelamento do apontamento (efeito de estoque = recibo). */
export const TIPO_CANCELAR_APONTAMENTO = 'cancelar_apontamento_atividade_v1';
/** Rótulos do estorno de item PRODUTO no movimento (I-p). */
const TIPO_DETALHADO_ESTORNO = 'estorno_apontamento_atividade';
const MOTIVO_ESTORNO = 'Estorno de item de apontamento de atividade cancelado';
/** Leitura consistente sem trava (detalhe com os itens). */
const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

// ─── normalização do corpo ──────────────────────────────────────────────────

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const tem = (obj, chave) => Object.prototype.hasOwnProperty.call(obj, chave);

/** Decimais do corpo (anti-coerção antes do AJV, no plugin das rotas). D-PROD-191: e os do item. */
export const DECIMAIS_DO_CORPO = Object.freeze(['quantidade_produzida', 'horas_trabalhadas', 'quantidade', 'valor_unitario']);

/**
 * `preValidation` do plugin: decimal presente, não-null e não-string → 400
 * `valor_deve_ser_texto` (o AJV coergiria o número em texto já corrompido pelo
 * float), como no abastecimento.
 * @param {unknown} corpo
 */
export const recusarCoercaoApontamento = (corpo) => {
  if (!ehObjeto(corpo)) return;
  const c = /** @type {Record<string, any>} */ (corpo);
  for (const chave of DECIMAIS_DO_CORPO) {
    if (!tem(c, chave)) continue;
    const v = c[chave];
    if (v !== null && v !== undefined && typeof v !== 'string') {
      throw invalido(`${chave} deve ser texto decimal (ex.: "12.5"), nunca número`, { field: chave, reason: 'valor_deve_ser_texto', campo: chave });
    }
  }
};

/** @param {unknown} v @param {string} campo */
const idOuNulo = (v, campo) => {
  if (v === null) return null;
  if (typeof v !== 'string' || !v.trim()) throw invalido(`${campo} inválido`, { field: campo, reason: 'formato' });
  return v.trim();
};

/** @param {unknown} v */
const diaDoCorpo = (v) => {
  if (!ehDiaValido(v)) throw invalido('data_operacional não existe; use AAAA-MM-DD', { field: 'data_operacional', reason: 'data_inexistente' });
  return /** @type {string} */ (v);
};

/** @param {unknown} v @param {string} campo @returns {Date|null} */
const instanteDoCorpo = (v, campo) => {
  if (v === null) return null;
  const m = typeof v === 'string' ? PADRAO_INSTANTE.exec(v) : null;
  const d = m && ehDiaValido(m[1]) ? new Date(/** @type {string} */ (v)) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw invalido(`${campo} deve ser data e hora ISO 8601 com fuso (ex.: "2026-11-10T07:30:00-04:00")`, { field: campo, reason: 'formato' });
  }
  return d;
};

/** @param {unknown} v @param {string} campo @returns {string|null} */
const decimalDoCorpo = (v, campo) => {
  if (v === null) return null;
  if (typeof v !== 'string' || !PADRAO_DECIMAL.test(v)) throw invalido(`${campo} tem formato inválido`, { field: campo, reason: 'formato' });
  return dec(v).toFixed(CASAS_QUANTIDADE);
};

/** @param {unknown} v */
const unidadeDoCorpo = (v) => {
  if (v === null) return null;
  if (typeof v !== 'string' || !UNIDADES_PRODUCAO.includes(v)) {
    throw invalido(`unidade_producao deve ser ${UNIDADES_PRODUCAO.join(', ')}`, { field: 'unidade_producao', reason: 'unidade_invalida' });
  }
  return v;
};

/** Campo do corpo → normalizador. Só estes entram no apontamento (o resto o schema já recusou). */
const CAMPOS_DO_CORPO = Object.freeze({
  tipo_atividade_id: (v) => idOuNulo(v, 'tipo_atividade_id'),
  data_operacional: (v) => diaDoCorpo(v),
  hora_inicio: (v) => instanteDoCorpo(v, 'hora_inicio'),
  hora_fim: (v) => instanteDoCorpo(v, 'hora_fim'),
  bem_id: (v) => idOuNulo(v, 'bem_id'),
  implemento_bem_id: (v) => idOuNulo(v, 'implemento_bem_id'),
  operador_usuario_id: (v) => idOuNulo(v, 'operador_usuario_id'),
  area_id: (v) => idOuNulo(v, 'area_id'),
  centro_custo_id: (v) => idOuNulo(v, 'centro_custo_id'),
  centro_resultado_id: (v) => idOuNulo(v, 'centro_resultado_id'),
  safra_ciclo: (v) => textoDoCorpo(v, 'safra_ciclo') ?? null,
  quantidade_produzida: (v) => decimalDoCorpo(v, 'quantidade_produzida'),
  unidade_producao: (v) => unidadeDoCorpo(v),
  horas_trabalhadas: (v) => decimalDoCorpo(v, 'horas_trabalhadas'),
  lancamento_tarefa_id: (v) => idOuNulo(v, 'lancamento_tarefa_id'),
  observacao: (v) => textoDoCorpo(v, 'observacao') ?? null,
});

/**
 * Só os campos PRESENTES no corpo, normalizados (ausente ≠ null: null limpa).
 * @param {Record<string, any>} corpo
 * @returns {Record<string, any>}
 */
const camposDoCorpo = (corpo) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const [campo, normalizar] of Object.entries(CAMPOS_DO_CORPO)) {
    if (tem(corpo, campo) && corpo[campo] !== undefined) saida[campo] = normalizar(corpo[campo]);
  }
  return saida;
};

/** Estado de um apontamento gravado na forma do corpo normalizado. @param {any} r */
const estadoGravado = (r) => ({
  tipo_atividade_id: r.tipo_atividade_id,
  data_operacional: diaDe(r.data_operacional),
  hora_inicio: r.hora_inicio ?? null,
  hora_fim: r.hora_fim ?? null,
  bem_id: r.bem_id ?? null,
  implemento_bem_id: r.implemento_bem_id ?? null,
  operador_usuario_id: r.operador_usuario_id ?? null,
  area_id: r.area_id ?? null,
  centro_custo_id: r.centro_custo_id ?? null,
  centro_resultado_id: r.centro_resultado_id ?? null,
  safra_ciclo: r.safra_ciclo ?? null,
  quantidade_produzida: r.quantidade_produzida === null || r.quantidade_produzida === undefined ? null : dec(r.quantidade_produzida).toFixed(CASAS_QUANTIDADE),
  unidade_producao: r.unidade_producao ?? null,
  horas_trabalhadas: r.horas_trabalhadas === null || r.horas_trabalhadas === undefined ? null : dec(r.horas_trabalhadas).toFixed(CASAS_QUANTIDADE),
  lancamento_tarefa_id: r.lancamento_tarefa_id ?? null,
  observacao: r.observacao ?? null,
});

const VAZIO = Object.freeze(Object.fromEntries(Object.keys(CAMPOS_DO_CORPO).map((c) => [c, null])));

// ─── regras puras (R-b, R-d, R-f) sobre o estado FINAL ──────────────────────

/** @param {Record<string, any>} e */
const exigirRegrasPuras = (e) => {
  if (!e.tipo_atividade_id) throw invalido('tipo_atividade_id é obrigatório', { field: 'tipo_atividade_id', reason: 'obrigatorio' });
  if (!e.data_operacional) throw invalido('data_operacional é obrigatória', { field: 'data_operacional', reason: 'obrigatorio' });
  // R-b
  if (e.hora_inicio && e.hora_fim && e.hora_fim.getTime() < e.hora_inicio.getTime()) throw apontamentoAtividadeHorarioInvalido('fim_antes_do_inicio', 'hora_fim');
  // R-d
  if (e.implemento_bem_id && !e.bem_id) throw apontamentoAtividadeImplementoInvalido('implemento_sem_bem');
  if (e.implemento_bem_id && e.implemento_bem_id === e.bem_id) throw apontamentoAtividadeImplementoInvalido('implemento_igual_ao_bem');
  // R-f
  if (e.quantidade_produzida !== null && e.unidade_producao === null) {
    throw apontamentoAtividadeProducaoInvalida('unidade_producao', 'quantidade_sem_unidade', 'informe a unidade da quantidade produzida (HA, CAB, TON ou KM); nada foi gravado');
  }
  if (e.unidade_producao !== null && e.quantidade_produzida === null) {
    throw apontamentoAtividadeProducaoInvalida('quantidade_produzida', 'unidade_sem_quantidade', 'informe a quantidade produzida da unidade escolhida; nada foi gravado');
  }
  if (e.quantidade_produzida !== null && !dec(e.quantidade_produzida).gt(0)) {
    throw apontamentoAtividadeProducaoInvalida('quantidade_produzida', 'quantidade_nao_positiva', 'a quantidade produzida deve ser maior que zero; nada foi gravado');
  }
  if (e.horas_trabalhadas !== null && !dec(e.horas_trabalhadas).gt(0)) {
    throw apontamentoAtividadeProducaoInvalida('horas_trabalhadas', 'horas_nao_positivas', 'as horas trabalhadas devem ser maiores que zero; nada foi gravado');
  }
};

/**
 * Relógio da fazenda num instante só (R-c): o "agora" das horas e o "hoje" da
 * data saem do MESMO `agoraDoServidor()` (fixável só em NODE_ENV=test). Lê o
 * fuso com a Empresa FOR SHARE; sem fuso, falha fechado.
 * @param {any} tx @param {string} cli @param {string} empresaId
 * @returns {Promise<{ agora: Date, hoje: string, fuso: string }>}
 */
export const tempoDaFazenda = async (tx, cli, empresaId) => {
  const fuso = await fusoDaEmpresa(tx, cli, empresaId);
  const agora = agoraDoServidor();
  return { agora, hoje: diaNoFuso(agora, fuso), fuso };
};

/** R-c — @param {{ hoje: string, fuso: string }} tempo @param {string} dia */
const exigirDiaNaoFuturo = ({ hoje, fuso }, dia) => {
  if (dia > hoje) throw apontamentoAtividadeDataFutura({ data: dia, hoje, fuso });
};

/**
 * R-c (horas) sobre o estado FINAL: nenhuma hora depois de agora; o dia local
 * (fuso da fazenda) de `hora_inicio` e o de `hora_fim` são a data operacional.
 * A R-b já valeu antes.
 * @param {{ agora: Date, fuso: string }} tempo @param {Record<string, any>} e
 */
const exigirHorasNoDia = ({ agora, fuso }, e) => {
  /** @type {Array<'hora_inicio'|'hora_fim'>} */
  const campos = ['hora_inicio', 'hora_fim'];
  for (const campo of campos) {
    const h = /** @type {Date|null} */ (e[campo]);
    if (h && h.getTime() > agora.getTime()) throw apontamentoAtividadeHorarioInvalido('hora_futura', campo, { agora: agora.toISOString() });
  }
  for (const campo of campos) {
    const h = /** @type {Date|null} */ (e[campo]);
    if (!h) continue;
    const dia = diaNoFuso(h, fuso);
    if (dia !== e.data_operacional) throw apontamentoAtividadeHorarioInvalido('hora_fora_do_dia', campo, { data: e.data_operacional, dia, fuso });
  }
};

// ─── referências (R-a, R-i) ─────────────────────────────────────────────────

/** Mensagens por coluna (inexistente / outra empresa / inativo). */
const REFERENCIAS = Object.freeze({
  tipo_atividade_id: { inexistente: 'o tipo de atividade não foi encontrado', inativo: 'o tipo de atividade está inativo: escolha um tipo ativo' },
  bem_id: { inexistente: 'a máquina ou o veículo não foi encontrado', outra_empresa: 'a máquina ou o veículo é de outra fazenda', inativo: 'a máquina ou o veículo está inativo' },
  implemento_bem_id: { inexistente: 'o implemento não foi encontrado', outra_empresa: 'o implemento é de outra fazenda', inativo: 'o implemento está inativo' },
  operador_usuario_id: { inexistente: 'o operador não foi encontrado', inativo: 'o operador está inativo' },
  area_id: { inexistente: 'a área não foi encontrada', outra_empresa: 'a área é de outra fazenda', inativo: 'a área está inativa' },
  centro_custo_id: { inexistente: 'o centro de custo não foi encontrado', outra_empresa: 'o centro de custo é de outra fazenda', inativo: 'o centro de custo está inativo' },
  centro_resultado_id: { inexistente: 'o centro de resultado não foi encontrado', outra_empresa: 'o centro de resultado é de outra fazenda', inativo: 'o centro de resultado está inativo' },
  lancamento_tarefa_id: { inexistente: 'a tarefa não foi encontrada', outra_empresa: 'a tarefa é de outra fazenda' },
});

/** @param {keyof typeof REFERENCIAS} campo @param {'inexistente'|'outra_empresa'|'inativo'} reason */
const referenciaRecusada = (campo, reason) =>
  apontamentoAtividadeReferenciaInvalida(campo, reason, `${/** @type {any} */ (REFERENCIAS[campo])[reason]}; nada foi gravado`);

/** @param {any} tx @param {string} cli @param {string} campo @param {string} id */
const lerReferencia = (tx, cli, campo, id) => {
  if (campo === 'bem_id' || campo === 'implemento_bem_id') return lerBem(tx, cli, id);
  if (campo === 'operador_usuario_id') return lerUsuario(tx, cli, id);
  if (campo === 'area_id') return lerArea(tx, cli, id);
  if (campo === 'centro_custo_id') return lerCentro(tx, 'custo', cli, id);
  if (campo === 'centro_resultado_id') return lerCentro(tx, 'resultado', cli, id);
  return lerLancamentoTarefa(tx, cli, id);
};

/**
 * Referências INFORMADAS (criação) ou TROCADAS (edição): do tenant, da MESMA
 * empresa (R-i) e ativas (R-a). Manter a referência gravada não relê nada.
 * Devolve o tipo lido quando ele é novo (fonte dos snapshots, R-h).
 * @param {any} tx @param {string} cli @param {string} empresaId
 * @param {Record<string, any>} estado  estado final
 * @param {Record<string, any>|null} anterior  estado gravado (edição) ou null
 */
const exigirReferencias = async (tx, cli, empresaId, estado, anterior) => {
  const novo = (campo) => Boolean(estado[campo]) && estado[campo] !== (anterior?.[campo] ?? null);
  let tipo = null;
  if (novo('tipo_atividade_id')) {
    tipo = await lerTipoAtividade(tx, cli, estado.tipo_atividade_id);
    if (!tipo) throw referenciaRecusada('tipo_atividade_id', 'inexistente');
    if (!tipo.ativo) throw referenciaRecusada('tipo_atividade_id', 'inativo');
  }
  for (const campo of ['bem_id', 'implemento_bem_id', 'operador_usuario_id', 'area_id', 'centro_custo_id', 'centro_resultado_id', 'lancamento_tarefa_id']) {
    if (!novo(campo)) continue;
    const r = /** @type {{ empresa_id?: string, ativo?: boolean } | null} */ (await lerReferencia(tx, cli, campo, estado[campo]));
    const chave = /** @type {keyof typeof REFERENCIAS} */ (campo);
    if (!r) throw referenciaRecusada(chave, 'inexistente');
    if (r.empresa_id !== undefined && r.empresa_id !== empresaId) throw referenciaRecusada(chave, 'outra_empresa');
    if (r.ativo === false) throw referenciaRecusada(chave, 'inativo');
  }
  return { tipo };
};

/**
 * R-e, SÓ na CRIAÇÃO e depois de `exigirReferencias` (o bem já foi conferido:
 * do tenant, da empresa, ativo): sem centro de custo informado e com bem, o
 * centro de custo a gravar é o do cadastro do bem, lido pela chave
 * (cliente_id, empresa_id, id), se ATIVO; inativo não é copiado (fica nulo).
 * O informado vence. A edição nunca chama isto (snapshot). O centro de
 * resultado nunca passa por aqui.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {Record<string, any>} estado
 * @returns {Promise<{ centro_custo_id: string|null, copiado_do_bem: boolean }>}
 */
const centroCustoNaCriacao = async (tx, cli, empresaId, estado) => {
  if (estado.centro_custo_id || !estado.bem_id) return { centro_custo_id: estado.centro_custo_id ?? null, copiado_do_bem: false };
  const centro = await lerCentroCustoDoBem(tx, cli, empresaId, estado.bem_id);
  return centro?.ativo ? { centro_custo_id: centro.id, copiado_do_bem: true } : { centro_custo_id: null, copiado_do_bem: false };
};

/** Snapshots do tipo (R-h). @param {{ nome_tipo: string, grupo_atividade_id: string, grupo_atividade_nome: string }} tipo */
const snapshotsDoTipo = (tipo) => ({
  tipo_atividade_nome: tipo.nome_tipo,
  grupo_atividade_id: tipo.grupo_atividade_id,
  grupo_atividade_nome: tipo.grupo_atividade_nome,
});

/** Estado normalizado → colunas do banco. @param {Record<string, any>} campos */
const paraGravacao = (campos) => {
  /** @type {Record<string, any>} */
  const dados = { ...campos };
  if (tem(dados, 'data_operacional')) dados.data_operacional = comoData(dados.data_operacional);
  return dados;
};

/**
 * Escrita no apontamento. A FK composta é a rede do banco: um cadastro que
 * sumiu entre a conferência e o INSERT/UPDATE (corrida) vira 422 da coluna,
 * nunca o 403 genérico do P2003.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
const comFkTraduzida = async (fn) => {
  try {
    return await fn();
  } catch (erro) {
    const fk = fkDoApontamentoNaEscrita(erro);
    if (fk && tem(REFERENCIAS, fk.campo)) {
      throw apontamentoAtividadeReferenciaInvalida(fk.campo, 'inexistente', `${/** @type {any} */ (REFERENCIAS)[fk.campo].inexistente}; nada foi gravado`, { cause: erro });
    }
    throw erro;
  }
};

// ─── formas públicas ────────────────────────────────────────────────────────

const t4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_QUANTIDADE));
const usuarioPublico = (u) => (u ? { id: u.id, nome: u.nome } : null);
const bemPublico = (b) => (b ? { id: b.id, numero: b.numero, codigo_frota: b.codigo_frota ?? null, nome: b.nome, natureza: b.natureza } : null);
const centroPublico = (c) => (c ? { id: c.id, numero: c.numero, nome: c.nome } : null);

/**
 * Forma pública (lista e detalhe): as colunas do apontamento (as mesmas que o
 * formulário reenvia) e, ao lado de cada id, o resumo do cadastro para exibir.
 * @param {any} r registro com os resumos de `INCLUIR`
 */
export const comoApontamentoPublico = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  status: r.status,
  versao: r.versao,
  data_operacional: diaDe(r.data_operacional),
  hora_inicio: iso(r.hora_inicio),
  hora_fim: iso(r.hora_fim),
  tipo_atividade_id: r.tipo_atividade_id,
  tipo_atividade_nome: r.tipo_atividade_nome,
  grupo_atividade_id: r.grupo_atividade_id,
  grupo_atividade_nome: r.grupo_atividade_nome,
  bem_id: r.bem_id ?? null,
  bem: bemPublico(r.bem),
  implemento_bem_id: r.implemento_bem_id ?? null,
  implemento: bemPublico(r.implemento),
  operador_usuario_id: r.operador_usuario_id ?? null,
  operador: usuarioPublico(r.operador),
  area_id: r.area_id ?? null,
  area: r.area ? { id: r.area.id, numero_area: r.area.numero_area, nome: r.area.nome } : null,
  centro_custo_id: r.centro_custo_id ?? null,
  centro_custo: centroPublico(r.centroCusto),
  centro_resultado_id: r.centro_resultado_id ?? null,
  centro_resultado: centroPublico(r.centroResultado),
  safra_ciclo: r.safra_ciclo ?? null,
  quantidade_produzida: t4(r.quantidade_produzida),
  unidade_producao: r.unidade_producao ?? null,
  horas_trabalhadas: t4(r.horas_trabalhadas),
  lancamento_tarefa_id: r.lancamento_tarefa_id ?? null,
  lancamento_tarefa: r.lancamentoTarefa ? { id: r.lancamentoTarefa.id, titulo: r.lancamentoTarefa.titulo, status: r.lancamentoTarefa.status } : null,
  observacao: r.observacao ?? null,
  cancelamento:
    r.status === STATUS_CANCELADO
      ? { cancelado_em: iso(r.cancelado_em), cancelado_por: usuarioPublico(r.canceladoPor), motivo: r.motivo_cancelamento ?? null }
      : null,
  criado_por: usuarioPublico(r.criadoPor),
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria: colunas, sem texto livre (só se há observação/motivo). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  status: r.status,
  versao: r.versao,
  tipo_atividade_id: r.tipo_atividade_id,
  tipo_atividade_nome: r.tipo_atividade_nome,
  grupo_atividade_id: r.grupo_atividade_id,
  grupo_atividade_nome: r.grupo_atividade_nome,
  data_operacional: diaDe(r.data_operacional),
  hora_inicio: iso(r.hora_inicio),
  hora_fim: iso(r.hora_fim),
  bem_id: r.bem_id ?? null,
  implemento_bem_id: r.implemento_bem_id ?? null,
  operador_usuario_id: r.operador_usuario_id ?? null,
  area_id: r.area_id ?? null,
  centro_custo_id: r.centro_custo_id ?? null,
  centro_resultado_id: r.centro_resultado_id ?? null,
  safra_ciclo: r.safra_ciclo ?? null,
  quantidade_produzida: t4(r.quantidade_produzida),
  unidade_producao: r.unidade_producao ?? null,
  horas_trabalhadas: t4(r.horas_trabalhadas),
  lancamento_tarefa_id: r.lancamento_tarefa_id ?? null,
  tem_observacao: Boolean(r.observacao),
  tem_motivo_cancelamento: Boolean(r.motivo_cancelamento),
});

/** Detalhe relido na mesma transação (corpo das respostas de escrita). */
const detalheNa = async (db, cli, empresaId, id) => {
  const r = await buscarApontamento(db, cli, empresaId, id);
  if (!r) throw apontamentoAtividadeNotFound();
  return r;
};

/**
 * CAS perdido: o apontamento foi cancelado (R-g) ou mudou de versão.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} id @param {number} versao
 */
export const erroDoCasPerdido = async (tx, cli, empresaId, id, versao) => {
  const atual = await lerVersaoEStatus(tx, cli, empresaId, id);
  if (!atual) return apontamentoAtividadeNotFound();
  if (atual.status !== STATUS_CONFIRMADO) return apontamentoAtividadeStatusInvalido(atual.status);
  return apontamentoAtividadeVersaoConflito(atual.versao, versao);
};

// ─── itens (D-PROD-191): forma pública, custo, normalização comum ──────────

const t6 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_PRECO));
const custo4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_CUSTO));
const movimentoResumo = (m) => (m ? { id: m.id, numero: m.numero_movimentacao } : null);

/**
 * Item público (§3.4 do contrato): decimais em TEXTO (quantidade e fatias com
 * 4 casas, valor unitário com 6, total com 4); produto, local e movimentos só
 * no item PRODUTO; cancelados ficam (histórico).
 * @param {any} i item com os resumos de `INCLUIR_DETALHE.itens`
 */
export const comoItemPublico = (i) => ({
  id: i.id,
  ordem: i.ordem,
  tipo: i.tipo,
  status: i.status,
  descricao: i.descricao ?? null,
  produto: i.produto ? { id: i.produto.id, nome: i.produto.nome_produto, unidade_principal_estoque: i.produto.unidade_principal_estoque } : null,
  local_estoque: i.localEstoque ? { id: i.localEstoque.id, nome: i.localEstoque.nome } : null,
  quantidade: t4(i.quantidade),
  unidade: i.unidade ?? null,
  valor_unitario: t6(i.valor_unitario),
  valor_total: custo4(i.valor_total),
  movimento: movimentoResumo(i.movimentacao),
  movimento_estorno: movimentoResumo(i.movimentacaoEstorno),
  consumos: (i.consumos ?? []).map((f) => ({ ordem: f.ordem, lote_id: f.estoque_lote_nota_id, quantidade: t4(f.quantidade), custo_unitario: custo4(f.custo_unitario) })),
  criado_por: usuarioPublico(i.criadoPor),
  criado_em: iso(i.createdAt),
  cancelamento:
    i.status === STATUS_CANCELADO
      ? { cancelado_em: iso(i.cancelado_em), cancelado_por: usuarioPublico(i.canceladoPor), motivo: i.motivo_cancelamento ?? null, origem: i.cancelamento_origem ?? null }
      : null,
});

/**
 * Custo dos itens: soma SÓ dos CONFIRMADO (4 casas, Decimal), por tipo. É
 * custo gerencial da atividade (sem efeito financeiro, I-w).
 * @param {Array<{ status: string, tipo: string, valor_total: any }>} itens
 */
export const custoDosItens = (itens) => {
  const confirmados = itens.filter((i) => i.status === STATUS_CONFIRMADO);
  /** @param {string|null} tipo */
  const soma = (tipo) => somar(confirmados.filter((i) => tipo === null || i.tipo === tipo).map((i) => i.valor_total)).toFixed(CASAS_CUSTO);
  return { total: soma(null), produto: soma(TIPO_PRODUTO), servico: soma('SERVICO'), outro: soma('OUTRO'), itens_confirmados: confirmados.length };
};

/**
 * DETALHE (A1–A4): a forma pública do apontamento + os itens + o custo. A
 * lista continua com `comoApontamentoPublico` (sem itens).
 * @param {any} r registro com `INCLUIR_DETALHE`
 */
export const comoDetalhePublico = (r) => ({ ...comoApontamentoPublico(r), itens: r.itens.map(comoItemPublico), custo_itens: custoDosItens(r.itens) });

/** Detalhe relido (com os itens) na transação de quem chama. @param {any} db @param {string} cli @param {string} empresaId @param {string} id */
export const carregarDetalhe = async (db, cli, empresaId, id) => {
  const r = await buscarApontamentoComItens(db, cli, empresaId, id);
  if (!r) throw apontamentoAtividadeNotFound();
  return comoDetalhePublico(r);
};

/** Auditoria do item: colunas, sem texto livre (só se há descrição/motivo). @param {any} i item com `consumos` */
export const itemParaAuditoria = (i) => ({
  id: i.id,
  apontamento_id: i.apontamento_id,
  empresa_id: i.empresa_id,
  ordem: i.ordem,
  tipo: i.tipo,
  status: i.status,
  produto_id: i.produto_id ?? null,
  local_estoque_id: i.local_estoque_id ?? null,
  quantidade: t4(i.quantidade),
  unidade: i.unidade ?? null,
  valor_unitario: t6(i.valor_unitario),
  valor_total: custo4(i.valor_total),
  movimentacao_estoque_id: i.movimentacao_estoque_id ?? null,
  movimentacao_estorno_id: i.movimentacao_estorno_id ?? null,
  cancelamento_origem: i.cancelamento_origem ?? null,
  fatias: (i.consumos ?? []).map((f) => ({ ordem: f.ordem, lote_id: f.estoque_lote_nota_id, quantidade: t4(f.quantidade), custo_unitario: custo4(f.custo_unitario) })),
  tem_descricao: Boolean(i.descricao),
  tem_motivo_cancelamento: Boolean(i.motivo_cancelamento),
});

/**
 * Motivo do cancelamento (do apontamento e do item): 3..500, aparado, sem
 * controle nem marcação.
 * @param {unknown} v
 */
export const motivoDoCorpo = (v) => {
  const motivo = textoDoCorpo(v, 'motivo');
  if (!motivo) throw invalido('informe o motivo do cancelamento', { field: 'motivo', reason: 'obrigatorio' });
  if ([...motivo].length < MOTIVO_MINIMO) {
    throw invalido(`o motivo do cancelamento deve ter ao menos ${MOTIVO_MINIMO} caracteres`, { field: 'motivo', reason: 'motivo_curto' });
  }
  return motivo;
};

/** @param {unknown} v */
export const operationIdDoCorpo = (v) => {
  if (typeof v !== 'string' || !PADRAO_OPERATION_ID.test(v)) throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  return v;
};

/**
 * Reenvio conflitante (mesma chave, conteúdo diferente) auditado numa
 * transação própria, best-effort (molde do abastecimento): a resposta segue 409
 * e nada foi gravado.
 * @param {any} contexto @param {string} entidade @param {string} operationId @param {string} tipoOperacao
 */
export const auditarReenvioConflitante = async (contexto, entidade, operationId, tipoOperacao) => {
  try {
    await registrarEvento(contexto, { acao: 'apontamento_atividade.reenvio_conflitante', entidade, entidadeId: null, dadosNovos: { operation_id: operationId, tipo_operacao: tipoOperacao } });
  } catch {
    // best-effort documentado: a auditoria do conflito não muda a resposta 409.
  }
};

// ─── estorno exato dos itens PRODUTO (I-p, I-q): um caminho só ──────────────

/** Recusas do motor que a tela conhece (as demais de `ESTOQUE_JA_CONSUMIDO` viram `fatias_inconsistentes`). */
const RECUSAS_DO_MOTOR = Object.freeze(['lote_indisponivel_para_devolucao', 'devolucao_excede_entrada', 'fatias_inconsistentes', 'vinculo_divergente', 'camada_divergente']);

/**
 * Erros do motor no estorno → 409 `APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO`
 * com o item (fail-closed; molde do cancelamento do abastecimento).
 * `CONCURRENCY_CONFLICT` e o resto passam.
 * @param {unknown} erro @param {any[]} itens os itens PRODUTO enviados ao motor (`ordem` → item)
 */
const traduzirErroDoEstorno = (erro, itens) => {
  if (!(erro instanceof AppError)) return erro;
  const e = /** @type {any} */ (erro);
  const porOrdem = new Map(itens.map((i) => [i.ordem, i]));
  /** O item da recusa: pela `item_ordem` do motor; sem ela, o único item do lote (se só há um). */
  const doItem = (ordem) => {
    const i = Number.isInteger(ordem) ? porOrdem.get(ordem) : itens.length === 1 ? itens[0] : undefined;
    return i ? { item_id: i.id, item_ordem: i.ordem } : {};
  };
  const opcoes = { cause: erro };
  if (e.code === 'ESTOQUE_JA_CONSUMIDO') {
    const base = { ...doItem(e.details?.item_ordem), ...(e.details?.lote_id ? { lote_id: e.details.lote_id } : {}) };
    if (e.details?.reason === 'original_ja_estornado' || e.details?.reason === 'original_nao_ativo') return apontamentoAtividadeEstornoBloqueado('movimento_estornado', base, opcoes);
    const reason = RECUSAS_DO_MOTOR.find((r) => r === e.details?.reason) ?? 'fatias_inconsistentes';
    return apontamentoAtividadeEstornoBloqueado(/** @type {any} */ (reason), base, opcoes);
  }
  if (e.code === 'MOVIMENTACAO_ESTOQUE_NOT_FOUND') return apontamentoAtividadeEstornoBloqueado('movimento_inexistente', doItem(undefined), opcoes);
  if (e.code === 'OPERACAO_VALORES_INVALIDOS') return apontamentoAtividadeEstornoBloqueado('estoque_excede_limite', doItem(e.details?.item_ordem), opcoes);
  if (e.code === 'PRODUTO_NOT_FOUND') return apontamentoAtividadeEstornoBloqueado('produto_mudou_de_fazenda', doItem(e.details?.item_ordem), opcoes);
  return erro;
};

/**
 * Estorno EXATO dos itens PRODUTO (I-p, I-q) — o MESMO caminho para cancelar
 * um item (lista de um) e para cancelar o apontamento (todos, na ordem):
 *  1. `travarProdutosEstoque` com todos os produtos de uma vez (o apontamento
 *     já está travado por quem chama: ordem canônica do motor);
 *  2. conferências ANTES do motor, item a item na ordem (molde do
 *     abastecimento): Produto ainda da empresa (`produto_mudou_de_fazenda`),
 *     mesma unidade EFETIVA (`unidade_mudou`), movimento original existe
 *     (`movimento_inexistente`), 'Ativa' e sem filho (`movimento_estornado`),
 *     fatias gravadas e Σ = quantidade (`fatias_inconsistentes`);
 *  3. `estornarEmLote` (efeito SAÍDA): cada fatia volta ao SEU lote, Entrada
 *     `estorno_apontamento_atividade` com o MESMO valor do original e
 *     `movimento_pai_id`, original 'Estornada' (CAS), `estoque_atual +`, no
 *     dia `hoje` da fazenda. Recusa do motor → 409 `…_ESTORNO_BLOQUEADO`.
 * Nada aqui escreve em Produto, lote ou movimento fora do motor (I-u). Os
 * números dos movimentos são PROVISÓRIOS: quem chama numera no fim.
 * @param {any} tx @param {{auth: any}} contexto
 * @param {{ empresaId: string, apontamento: { id: string, numero: string, data_operacional: any }, itens: any[], hoje: string }} a
 *   `itens`: CONFIRMADO, com `consumos` (os SERVICO/OUTRO são ignorados)
 * @returns {Promise<Map<string, string>>} id do item PRODUTO → id do movimento de estorno, na ordem dos itens
 */
export const estornarItensProduto = async (tx, contexto, { empresaId, apontamento, itens, hoje }) => {
  const doProduto = itens.filter((i) => i.tipo === TIPO_PRODUTO);
  if (!doProduto.length) return new Map();
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, doProduto.map((i) => i.produto_id));
  const produtos = new Map(
    (await tx.produto.findMany({ where: { cliente_id: cli, id: { in: produtoIds } }, select: { id: true, empresa_id: true, unidade_principal_estoque: true } })).map((p) => [p.id, p])
  );
  const movimentoIds = [...new Set(doProduto.map((i) => i.movimentacao_estoque_id).filter((v) => typeof v === 'string' && v))];
  // Pré-leitura SEM trava, só para responder os motivos que a tela conhece; o motor trava os lotes e DEPOIS os
  // originais (FOR UPDATE) e revalida tudo sob a trava.
  const movimentos = new Map(
    (movimentoIds.length
      ? await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, id: { in: movimentoIds } }, select: { id: true, status: true, movimento_filho_id: true } })
      : []
    ).map((m) => [m.id, m])
  );
  for (const item of doProduto) {
    const base = { item_id: item.id, item_ordem: item.ordem };
    const produto = produtos.get(item.produto_id);
    if (!produto || produto.empresa_id !== empresaId) throw apontamentoAtividadeEstornoBloqueado('produto_mudou_de_fazenda', base);
    // Unidade EFETIVA (L → L; KG/SACO → KG): KG ↔ SACO guardam kg e não bloqueiam; a troca que envolve L, sim.
    if (unidadeEfetivaDoEstoque(produto.unidade_principal_estoque) !== item.unidade) {
      throw apontamentoAtividadeEstornoBloqueado('unidade_mudou', { ...base, unidade_item: item.unidade, unidade_produto: produto.unidade_principal_estoque });
    }
    const original = item.movimentacao_estoque_id ? movimentos.get(item.movimentacao_estoque_id) : undefined;
    if (!original) throw apontamentoAtividadeEstornoBloqueado('movimento_inexistente', base);
    if (original.status !== 'Ativa' || original.movimento_filho_id) throw apontamentoAtividadeEstornoBloqueado('movimento_estornado', base);
    const fatias = item.consumos ?? [];
    if (!fatias.length || !somar(fatias.map((f) => f.quantidade)).eq(dec(item.quantidade))) throw apontamentoAtividadeEstornoBloqueado('fatias_inconsistentes', base);
  }
  let estornos;
  try {
    estornos = await estornarEmLote(tx, contexto, {
      empresaId,
      efeito: EFEITO_SAIDA,
      dia: hoje, // dia do estorno = hoje da fazenda (nunca a data operacional)
      documento: { numero: apontamento.numero, data: diaDe(apontamento.data_operacional) },
      origem: { sistema: ORIGEM_APONTAMENTO, operacaoId: apontamento.id, tipoDetalhadoEstorno: TIPO_DETALHADO_ESTORNO, motivoEstorno: MOTIVO_ESTORNO },
      itens: doProduto.map((i) => ({
        produto_id: i.produto_id,
        local_estoque_id: i.local_estoque_id,
        movimentacao_estoque_id: i.movimentacao_estoque_id,
        quantidade_estoque: i.quantidade,
        ordem: i.ordem,
        consumos: i.consumos.map((f) => ({ estoque_lote_nota_id: f.estoque_lote_nota_id, quantidade: f.quantidade })),
      })),
      numeroMovimento: numeroMovimentoProvisorio,
    });
  } catch (erro) {
    throw traduzirErroDoEstorno(erro, doProduto);
  }
  return new Map(doProduto.map((i, k) => [i.id, estornos[k]]));
};

/**
 * Cancela os itens CONFIRMADO lidos (CAS numa instrução; contagem = nº de
 * itens) com o estorno de cada PRODUTO. Contagem diferente = um escritor fora
 * do protocolo (a trava do apontamento serializa todos): 409, tudo desfeito.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, apontamentoId: string, itens: any[], estornos: Map<string, string>,
 *   motivo: string, origem: 'ITEM'|'APONTAMENTO', usuarioId: string|null, agora: Date }} a
 */
export const cancelarItens = async (tx, { estornos, itens, ...resto }) => {
  const n = await cancelarItensConfirmados(tx, { ...resto, itens: itens.map((i) => ({ id: i.id, estorno: estornos.get(i.id) ?? null })) });
  if (n !== itens.length) throw concurrencyConflict('um item do apontamento mudou durante o cancelamento; nada foi alterado, tente de novo com a mesma operation_id', { details: { itens: itens.length, cancelados: n } });
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * Lista keyset (createdAt desc, id desc) da empresa, com filtros por período
 * (data operacional), bem (máquina/veículo), implemento, tipo, área, tarefa e
 * status; `q` busca no número.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, any>} [query]
 */
export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), cli, query.empresa_id);
  const de = query.data_de === undefined ? null : diaDoFiltro(query.data_de, 'data_de');
  const ate = query.data_ate === undefined ? null : diaDoFiltro(query.data_ate, 'data_ate');
  if (de && ate && de > ate) throw invalido('o período está invertido: data_de é posterior a data_ate', { field: 'data_ate', reason: 'periodo_invertido' });
  /** @type {Record<string, any>} */
  const where = { cliente_id: cli, empresa_id: empresaId };
  for (const campo of ['bem_id', 'implemento_bem_id', 'tipo_atividade_id', 'area_id', 'lancamento_tarefa_id', 'status']) {
    if (typeof query[campo] === 'string' && query[campo]) where[campo] = query[campo];
  }
  if (de || ate) where.data_operacional = { ...(de ? { gte: comoData(de) } : {}), ...(ate ? { lte: comoData(ate) } : {}) };
  const q = termoDeBusca(query.q);
  const busca = q ? [{ numero: { contains: q } }] : [];
  return listarApontamentos({ where, busca, query, mapItem: comoApontamentoPublico });
};

/** @param {unknown} v @param {string} campo */
const diaDoFiltro = (v, campo) => {
  if (!ehDiaValido(v)) throw invalido(`${campo} não existe; use AAAA-MM-DD`, { field: campo, reason: 'data_inexistente' });
  return /** @type {string} */ (v);
};

/**
 * DETALHE (A4): o apontamento com os itens (inclusive cancelados) e o custo dos
 * CONFIRMADO, numa leitura consistente (RepeatableRead, sem trava).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, any>} [query]
 */
export const obter = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, query.empresa_id);
    return carregarDetalhe(tx, auth.clienteId, empresaId, id);
  });
};

// ─── criação ────────────────────────────────────────────────────────────────

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, any>} corpo
 */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
  exigirRegrasPuras(estado);

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      exigirDiaNaoFuturo(tempo, estado.data_operacional); // R-c
      exigirHorasNoDia(tempo, estado); // R-c (horas)
      const { tipo } = await exigirReferencias(tx, cli, empresaId, estado, null);
      // R-e: centro de custo nulo/ausente + bem → o do cadastro do bem, se ativo (só aqui, na criação).
      const { centro_custo_id, copiado_do_bem } = await centroCustoNaCriacao(tx, cli, empresaId, estado);
      const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT })); // R-k
      const { id } = await comFkTraduzida(() =>
        inserirApontamento(tx, {
          ...paraGravacao({ ...estado, centro_custo_id }),
          ...snapshotsDoTipo(/** @type {any} */ (tipo)), // R-h
          cliente_id: cli,
          empresa_id: empresaId,
          numero,
          status: STATUS_CONFIRMADO,
          criado_por_usuario_id: auth.usuarioId ?? null,
          versao: 1,
        })
      );
      const registro = await detalheNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        { acao: 'apontamento_atividade.criar', entidade: ENTIDADE, entidadeId: id, dadosNovos: { ...paraAuditoria(registro), centro_custo_copiado_do_bem: copiado_do_bem } },
        tx
      );
      return comoApontamentoPublico(registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── edição ─────────────────────────────────────────────────────────────────

/**
 * PATCH: só os campos enviados mudam (null limpa um opcional). Exige a
 * `versao` lida (CAS) e apontamento CONFIRMADO (R-g).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id @param {Record<string, any>} corpo
 */
export const atualizar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const campos = camposDoCorpo(corpo);
  if (!Object.keys(campos).length) throw invalido('informe ao menos um campo para alterar', { field: 'corpo', reason: 'sem_alteracao' });
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      // R-c só quando a data ou uma das horas vem no corpo (Empresa FOR SHARE, como na criação).
      const mexeNoTempo = ['data_operacional', 'hora_inicio', 'hora_fim'].some((c) => tem(campos, c));
      const tempo = mexeNoTempo ? await tempoDaFazenda(tx, cli, empresaId) : null;
      const anterior = await detalheNa(tx, cli, empresaId, id);
      if (anterior.status !== STATUS_CONFIRMADO) throw apontamentoAtividadeStatusInvalido(anterior.status); // R-g
      if (anterior.versao !== versao) throw apontamentoAtividadeVersaoConflito(anterior.versao, versao);
      const gravado = estadoGravado(anterior);
      // D-1 (D-PROD-191): a saída de estoque do item PRODUTO está na data gravada; mudar a data com item
      // PRODUTO CONFIRMADO é recusado (lido sem trava: um item que entre depois muda a versão e o CAS perde).
      if (tem(campos, 'data_operacional') && campos.data_operacional !== gravado.data_operacional) {
        const itensProduto = await contarItensProdutoConfirmados(tx, cli, empresaId, id);
        if (itensProduto > 0) throw apontamentoAtividadeDataComItens(itensProduto);
      }
      const estado = { ...gravado, ...campos };
      exigirRegrasPuras(estado);
      if (tempo && tem(campos, 'data_operacional')) exigirDiaNaoFuturo(tempo, estado.data_operacional);
      if (tempo) exigirHorasNoDia(tempo, estado); // sobre o estado mesclado
      const { tipo } = await exigirReferencias(tx, cli, empresaId, estado, gravado);
      // R-e: o centro de custo é snapshot; nada é relido do bem (nem trocando o bem): só o explícito no PATCH muda.
      const dados = { ...paraGravacao(campos), ...(tipo ? snapshotsDoTipo(tipo) : {}) }; // R-h: só quando o tipo é TROCADO
      const alterados = await comFkTraduzida(() =>
        atualizarComVersao(tx, { clienteId: cli, empresaId, id, versao, statusEsperado: STATUS_CONFIRMADO, dados })
      );
      if (alterados !== 1) throw await erroDoCasPerdido(tx, cli, empresaId, id, versao);
      const registro = await detalheNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        {
          acao: 'apontamento_atividade.editar',
          entidade: ENTIDADE,
          entidadeId: id,
          dadosAnteriores: paraAuditoria(anterior),
          dadosNovos: { ...paraAuditoria(registro), campos_alterados: Object.keys(dados).sort() },
        },
        tx
      );
      return comoApontamentoPublico(registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── cancelamento (R-j; D-PROD-191 I-q) ─────────────────────────────────────

/**
 * Sem DELETE físico: CONFIRMADO → CANCELADO com quem, quando e motivo; CAS por
 * `versao`. Cancelado não cancela de novo (R-g).
 *
 * D-PROD-191 (I-q, D-2): idempotente por `operation_id` (obrigatório; recibo
 * `cancelar_apontamento_atividade_v1`; mesma chave e mesmo conteúdo → o corpo
 * gravado com `replay: true`; conteúdo diferente → 409 `IDEMPOTENCY_CONFLICT`).
 * Na MESMA transação, TODOS os itens CONFIRMADO são cancelados
 * (`cancelamento_origem = 'APONTAMENTO'`, o motivo do apontamento) e os PRODUTO
 * estornados de uma vez pelo motor; qualquer recusa → 409
 * `APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO` com o item, e NADA muda. Travas:
 * recibo → empresa → Empresa FOR SHARE (fuso; sem fuso, falha fechado) →
 * Apontamento FOR UPDATE → itens → produtos → lotes → originais → sequência →
 * AuditLog → recibo.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id @param {Record<string, any>} corpo
 * @returns {Promise<Record<string, unknown>>} detalhe (itens cancelados/estornados) + `replay`
 */
export const cancelar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const motivo = motivoDoCorpo(corpo.motivo);
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const versao = corpo.versao;
  // Ordem FIXA de chaves; valores já normalizados (motivo aparado).
  const fingerprint = fingerprintDePayload({ v: 1, id, empresa_id: corpo.empresa_id, versao, motivo });

  try {
    const r = await emTransacao(
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: operationId,
          tipoOperacao: TIPO_CANCELAR_APONTAMENTO,
          fingerprint,
          executar: async () => {
            const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
            const { hoje } = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE (dia do estorno)
            if (!(await travarApontamento(tx, cli, empresaId, id))) throw apontamentoAtividadeNotFound(); // I-c
            const antes = await detalheNa(tx, cli, empresaId, id);
            if (antes.status !== STATUS_CONFIRMADO) throw apontamentoAtividadeStatusInvalido(antes.status); // R-g
            if (antes.versao !== versao) throw apontamentoAtividadeVersaoConflito(antes.versao, versao);
            const itens = await lerItensComFatias(tx, cli, empresaId, id, { status: STATUS_CONFIRMADO });
            const estornos = await estornarItensProduto(tx, contexto, { empresaId, apontamento: antes, itens, hoje }); // I-q
            const agora = new Date();
            await cancelarItens(tx, {
              clienteId: cli,
              empresaId,
              apontamentoId: id,
              itens,
              estornos,
              motivo,
              origem: 'APONTAMENTO',
              usuarioId: auth.usuarioId ?? null,
              agora,
            });
            const alterados = await atualizarComVersao(tx, {
              clienteId: cli,
              empresaId,
              id,
              versao,
              statusEsperado: STATUS_CONFIRMADO,
              dados: {
                status: STATUS_CANCELADO,
                cancelado_em: agora,
                cancelado_por_usuario_id: auth.usuarioId ?? null,
                motivo_cancelamento: motivo,
              },
            });
            if (alterados !== 1) throw await erroDoCasPerdido(tx, cli, empresaId, id, versao);
            await numerarMovimentos(tx, cli, [...estornos.values()]);
            const depois = await buscarApontamentoComItens(tx, cli, empresaId, id);
            if (!depois) throw apontamentoAtividadeNotFound();
            await registrarEvento(
              contexto,
              { acao: 'apontamento_atividade.cancelar', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) },
              tx
            );
            const cancelados = new Set(itens.map((i) => i.id));
            const anteriores = new Map(itens.map((i) => [i.id, i]));
            await registrarEventosEmLote(
              contexto,
              depois.itens
                .filter((/** @type {any} */ i) => cancelados.has(i.id))
                .map((/** @type {any} */ i) => ({
                  acao: 'apontamento_atividade.item_cancelar',
                  entidade: ENTIDADE_ITEM,
                  entidadeId: i.id,
                  dadosAnteriores: itemParaAuditoria(anteriores.get(i.id)),
                  dadosNovos: itemParaAuditoria(i),
                })),
              tx
            );
            return { httpStatus: 200, body: comoDetalhePublico(depois) };
          },
        }),
      {}
    );
    return { ...r.body, replay: r.replay };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, ENTIDADE, operationId, TIPO_CANCELAR_APONTAMENTO);
    throw e;
  }
};

// ─── opções do formulário (seletores próprios da tela) ──────────────────────

/**
 * Opção do seletor de bens: o resumo do bem e `centro_custo` `{ id, numero,
 * nome }` do cadastro dele SÓ quando o bem tem centro e o centro está ATIVO
 * (senão `null`) — o formulário pré-preenche o centro de custo com ele e o
 * usuário pode trocar; o servidor copia o mesmo na criação (R-e). O bem não tem
 * centro de resultado.
 * @param {any} b linha com `centroCusto` `{ id, numero, nome, ativo } | null`
 */
const opcaoDeBem = (b) => ({ ...bemPublico(b), centro_custo: b.centroCusto?.ativo ? centroPublico(b.centroCusto) : null });

/**
 * Bens ATIVOS da empresa para o seletor de máquina/veículo e de implemento,
 * keyset (nome, id); `natureza` filtra (uma ou várias); `q` em nome, número ou
 * código de frota. Cada opção traz o centro de custo ATIVO do bem (`opcaoDeBem`).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, any>} [query]
 */
export const opcoesBens = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }];
  const naturezas = Array.isArray(query.natureza) ? query.natureza : typeof query.natureza === 'string' ? [query.natureza] : [];
  if (naturezas.length) filtros.push({ natureza: { in: naturezas } });
  if (q) {
    filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }, { codigo_frota: { contains: q, mode: 'insensitive' } }] });
  }
  return paginarPorNome(prisma.bemPatrimonial, {
    where: { AND: filtros },
    select: { id: true, numero: true, codigo_frota: true, nome: true, natureza: true, centroCusto: { select: { id: true, numero: true, nome: true, ativo: true } } },
    limit,
    cursor,
    mapear: (linhas) => linhas.map(opcaoDeBem),
  });
};
