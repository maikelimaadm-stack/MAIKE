/**
 * Serviço de ApontamentoAtividade (D-PROD-190, Fatia C).
 *
 * A TAREFA (`LancamentoTarefa`) é a demanda; o APONTAMENTO é a EXECUÇÃO de um
 * Tipo de Atividade (D-PROD-182): a operação feita, que consome máquina,
 * combustível e insumo. Base enxuta, SEM itens de custo (o abastecimento se
 * pendura aqui nas fatias seguintes).
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
 *    incrementa `versao` (CAS, como o abastecimento);
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
  apontamentoAtividadeDataFutura,
  apontamentoAtividadeHorarioInvalido,
  apontamentoAtividadeImplementoInvalido,
  apontamentoAtividadeNotFound,
  apontamentoAtividadeProducaoInvalida,
  apontamentoAtividadeReferenciaInvalida,
  apontamentoAtividadeStatusInvalido,
  apontamentoAtividadeVersaoConflito,
} from '../../shared/errors/AppError.js';
import { fkDoApontamentoNaEscrita } from '../../shared/errors/vinculoApontamentoAtividade.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import { comoData, diaDe, ehDiaValido, paginacaoOpcoes, paginarPorNome, termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { agoraDoServidor, diaNoFuso, fusoDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  atualizarComVersao,
  buscarApontamento,
  inserirApontamento,
  lerArea,
  lerBem,
  lerCentro,
  lerCentroCustoDoBem,
  lerLancamentoTarefa,
  lerTipoAtividade,
  lerUsuario,
  lerVersaoEStatus,
  listarApontamentos,
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

// ─── normalização do corpo ──────────────────────────────────────────────────

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const tem = (obj, chave) => Object.prototype.hasOwnProperty.call(obj, chave);

/** Decimais do corpo (anti-coerção antes do AJV, no plugin das rotas). */
export const DECIMAIS_DO_CORPO = Object.freeze(['quantidade_produzida', 'horas_trabalhadas']);

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
const tempoDaFazenda = async (tx, cli, empresaId) => {
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
const erroDoCasPerdido = async (tx, cli, empresaId, id, versao) => {
  const atual = await lerVersaoEStatus(tx, cli, empresaId, id);
  if (!atual) return apontamentoAtividadeNotFound();
  if (atual.status !== STATUS_CONFIRMADO) return apontamentoAtividadeStatusInvalido(atual.status);
  return apontamentoAtividadeVersaoConflito(atual.versao, versao);
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
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, any>} [query]
 */
export const obter = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  return comoApontamentoPublico(await detalheNa(prisma, auth.clienteId, empresaId, id));
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

// ─── cancelamento (R-j) ─────────────────────────────────────────────────────

/**
 * Sem DELETE físico: CONFIRMADO → CANCELADO com quem, quando e motivo; CAS por
 * `versao`. Cancelado não cancela de novo (R-g).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id @param {Record<string, any>} corpo
 */
export const cancelar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const motivo = textoDoCorpo(corpo.motivo, 'motivo');
  if (!motivo) throw invalido('informe o motivo do cancelamento', { field: 'motivo', reason: 'obrigatorio' });
  if ([...motivo].length < MOTIVO_MINIMO) {
    throw invalido(`o motivo do cancelamento deve ter ao menos ${MOTIVO_MINIMO} caracteres`, { field: 'motivo', reason: 'motivo_curto' });
  }
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const antes = await detalheNa(tx, cli, empresaId, id);
      if (antes.status !== STATUS_CONFIRMADO) throw apontamentoAtividadeStatusInvalido(antes.status); // R-g
      if (antes.versao !== versao) throw apontamentoAtividadeVersaoConflito(antes.versao, versao);
      const alterados = await atualizarComVersao(tx, {
        clienteId: cli,
        empresaId,
        id,
        versao,
        statusEsperado: STATUS_CONFIRMADO,
        dados: {
          status: STATUS_CANCELADO,
          cancelado_em: new Date(),
          cancelado_por_usuario_id: auth.usuarioId ?? null,
          motivo_cancelamento: motivo,
        },
      });
      if (alterados !== 1) throw await erroDoCasPerdido(tx, cli, empresaId, id, versao);
      const depois = await detalheNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        { acao: 'apontamento_atividade.cancelar', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(depois) },
        tx
      );
      return comoApontamentoPublico(depois);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
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
