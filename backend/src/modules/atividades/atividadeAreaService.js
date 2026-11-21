/**
 * D-PROD-249 — serviço das ÁREAS da atividade (`AtividadeArea`): "Eu tenho uma
 * atividade que é combate contra cigarrinha, e nessa atividade são vários
 * pastos que vou fazendo ao decorrer do tempo [...] cada custo e lançamento é
 * feito para aquela área." Contrato
 * `docs/engineering/MAIKE-ATIVIDADE-AREAS-CONTRATO.md`.
 *
 * Uma atividade, várias áreas. Cada área tem um ciclo próprio:
 *   PLANEJADA (ao abrir a atividade; "a iniciar")
 *     → EM_ANDAMENTO ("Iniciar área", com a data de início: padrão hoje na
 *       fazenda, nunca futura nem antes do início da atividade)
 *     → CONCLUIDA ("Concluir área", com a data de conclusão: padrão hoje, nunca
 *       futura nem antes do início da área); "Reabrir área" volta a EM_ANDAMENTO.
 * Só a área EM_ANDAMENTO recebe lançamento (o apontamento do dia e qualquer
 * linha nova). A área PLANEJADA e sem lançamento pode sair da atividade (DELETE
 * físico: nada com custo é apagado); a iniciada fica (conclua). Toda mudança de
 * área exige a atividade ABERTA e a `versao` da área (CAS).
 *
 * Compatibilidade (o que lia `Atividade.area_id` continua funcionando): o
 * cabeçalho guarda em `area_id` (e o setor) a 1ª área, pela `ordem`, e em
 * `area_planejada` a soma das áreas planejadas (`sincronizarCabecalhoComAreas`,
 * sem mexer na `versao` da atividade: são derivados, como os totais).
 *
 * Travas na ordem canônica: Empresa FOR SHARE (o "hoje") → Atividade FOR UPDATE
 * → áreas e lançamentos. Tenant SÓ do auth_context (R11); a empresa vem do corpo
 * e é conferida no tenant.
 *
 * D-PROD-267 — concluir (a área ou a atividade) nunca antes do ÚLTIMO DIA lançado (422 `ATIVIDADE_DATA_INVALIDA`
 * `antes_do_ultimo_dia`; o último dia é o maior entre `data_operacional` e `data_termino` dos lançamentos CONFIRMADO). E
 * "todas as áreas concluídas ⇒ atividade concluída": quando a última área em aberto conclui (por "Concluir área" ou pelo
 * registro de campo com `concluir`), a atividade conclui junto, no dia da área que concluiu por último
 * (`concluirAtividadeSeAreasConcluidas`). Tipo que exige produção sem produção somada > 0: a atividade fica ABERTA (o
 * "Concluir atividade" explica o porquê).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  atividadeAreaComLancamentos,
  atividadeAreaNotFound,
  atividadeDataInvalida,
  atividadeExigidaPeloTipo,
  atividadeNotFound,
  atividadeReferenciaInvalida,
  atividadeStatusInvalido,
} from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { regrasDoTipo } from '../tiposAtividade/tipoAtividadePadroes.js';
import {
  ENTIDADE_ATIVIDADE,
  STATUS_APONTAMENTO,
  STATUS_ATIVIDADE,
  atualizarComVersao,
  carregarAtividadeDetalhe,
  comFkTraduzida,
  comoAreaDaAtividadePublica,
  comoData,
  decimalDoCorpo,
  diaDe,
  diaDoCorpo,
  erroDoCasPerdido,
  exigirDiaNaoFuturo,
  exigirStatusDaAtividade,
  exigirVersao,
  idOuNulo,
  iso,
  somarApontamentosConfirmados,
  t4,
  tempoDaFazenda,
  travarAtividade,
} from './atividadeComum.js';
import { lerArea, lerTipoAtividade } from './atividadeRepository.js';
import {
  apagarAreaDaAtividade,
  buscarAreaDaAtividade,
  contarLancamentosDaArea,
  custosPorArea,
  inserirAreaDaAtividade,
  lancamentosPorArea,
  lerAreaDoApontamento,
  listarAreasDaAtividade,
  proximaOrdemDaArea,
} from './atividadeAreaRepository.js';

/** Entidade da auditoria. */
export const ENTIDADE_AREA_DA_ATIVIDADE = 'AtividadeArea';

/** O ciclo da área (CHECK `AtividadeArea_status_check`, com a coerência das datas). */
export const STATUS_AREA = Object.freeze({ PLANEJADA: 'PLANEJADA', EM_ANDAMENTO: 'EM_ANDAMENTO', CONCLUIDA: 'CONCLUIDA' });

/** Teto de áreas na abertura (o schema da rota confere o mesmo). */
export const AREAS_NA_ABERTURA_MAXIMO = 100;

// ─── normalização ───────────────────────────────────────────────────────────

/**
 * `areas[]` da abertura: 1..N itens `{ area_id, area_planejada? }`, sem área repetida (422 `duplicada`, no índice da
 * repetição). `area_planejada` ausente = o tamanho da área (resolvido na gravação).
 * @param {unknown} v
 * @returns {Array<{ area_id: string, area_planejada: string|null|undefined }>|undefined}
 */
export const areasDoCorpo = (v) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0) throw invalido('areas deve ter ao menos uma área', { field: 'areas', reason: 'obrigatorio' });
  if (v.length > AREAS_NA_ABERTURA_MAXIMO) throw invalido(`areas aceita no máximo ${AREAS_NA_ABERTURA_MAXIMO} áreas`, { field: 'areas', reason: 'longo' });
  const vistas = new Set();
  return v.map((item, i) => {
    const areaId = idOuNulo(item?.area_id, `areas[${i}].area_id`);
    if (!areaId) throw invalido(`areas[${i}].area_id é obrigatório`, { field: `areas[${i}].area_id`, reason: 'obrigatorio' });
    if (vistas.has(areaId)) throw atividadeReferenciaInvalida(`areas[${i}].area_id`, 'duplicada');
    vistas.add(areaId);
    const temPlanejada = item && Object.prototype.hasOwnProperty.call(item, 'area_planejada') && item.area_planejada !== undefined;
    return { area_id: areaId, area_planejada: temPlanejada ? decimalDoCorpo(item.area_planejada, `areas[${i}].area_planejada`) : undefined };
  });
};

// ─── regras ─────────────────────────────────────────────────────────────────

/**
 * Área do MAPA para a atividade: do tenant, da MESMA fazenda e ativa (o `campo` vai no erro: `area_id` ou
 * `areas[n].area_id`). Devolve o setor (snapshot) e o tamanho (a área planejada padrão).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id @param {string} [campo]
 */
export const exigirAreaDoMapa = async (tx, clienteId, empresaId, id, campo = 'area_id') => {
  const area = await lerArea(tx, clienteId, id);
  if (!area) throw atividadeReferenciaInvalida(campo, 'inexistente');
  if (area.empresa_id !== empresaId) throw atividadeReferenciaInvalida(campo, 'outra_empresa');
  if (!area.ativo) throw atividadeReferenciaInvalida(campo, 'inativo');
  return { setor_id: area.setor_id, setor_nome: area.setor_nome, tamanho: t4(area.tamanho_hectares) };
};

/**
 * Status da área para a ação; senão 409 `ATIVIDADE_STATUS_INVALIDO` (`entidade` `area`).
 * @param {{ status: string }} area @param {string} exigido @param {string} acao
 */
const exigirStatusDaArea = (area, exigido, acao) => {
  if (area.status !== exigido) throw atividadeStatusInvalido({ status: area.status, acao, entidade: 'area' });
};

/**
 * Só a área EM_ANDAMENTO recebe lançamento (o apontamento do dia e a linha nova): a PLANEJADA tem de ser iniciada e a
 * CONCLUIDA, reaberta → 409 `ATIVIDADE_STATUS_INVALIDO` (`entidade` `area`, `acao` `lancar_na_area`).
 * @param {{ status: string }} area
 */
export const exigirAreaEmAndamento = (area) => exigirStatusDaArea(area, STATUS_AREA.EM_ANDAMENTO, 'lancar_na_area');

/**
 * A área do lançamento novo, SOB a trava da atividade. Atividade sem área: o corpo não traz área (senão 422
 * `sem_areas`) → `null`. Com áreas: a do corpo, que tem de ser desta atividade (422 `inexistente`); sem ela no corpo,
 * só a atividade de UMA área usa essa (compatibilidade com o cliente antigo), com várias é 422 `obrigatorio`. A área tem
 * de estar EM_ANDAMENTO (409). Devolve o id.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, atividadeAreaId: string|null|undefined }} p
 * @returns {Promise<string|null>}
 */
export const exigirAreaDoLancamento = async (tx, { clienteId, empresaId, atividadeId, atividadeAreaId }) => {
  const areas = /** @type {Array<{ id: string, status: string }>} */ (
    await tx.atividadeArea.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId }, select: { id: true, status: true } })
  );
  if (!areas.length) {
    if (atividadeAreaId) throw atividadeReferenciaInvalida('atividade_area_id', 'sem_areas');
    return null;
  }
  if (!atividadeAreaId && areas.length > 1) throw atividadeReferenciaInvalida('atividade_area_id', 'obrigatorio');
  const alvo = atividadeAreaId ? areas.find((a) => a.id === atividadeAreaId) : areas[0];
  if (!alvo) throw atividadeReferenciaInvalida('atividade_area_id', 'inexistente');
  exigirAreaEmAndamento(alvo);
  return alvo.id;
};

/**
 * A linha NOVA num lançamento existente: a área dele tem de estar EM_ANDAMENTO (lançamento sem área: nada a conferir).
 * Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} apontamentoId
 */
export const exigirAreaDoApontamentoEmAndamento = async (tx, clienteId, empresaId, atividadeId, apontamentoId) => {
  const r = await lerAreaDoApontamento(tx, clienteId, empresaId, atividadeId, apontamentoId);
  if (r?.atividadeArea) exigirAreaEmAndamento(r.atividadeArea);
};

/**
 * O cabeçalho acompanha as áreas (compatibilidade): `area_id`, `setor_id` e `setor_nome` = os da 1ª área pela `ordem`
 * (sem área: nulos); `area_planejada` = Σ das planejadas (nula se nenhuma tem; sem área, a do cabeçalho fica). Não mexe
 * na `versao` da atividade (são derivados). Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
export const sincronizarCabecalhoComAreas = async (tx, clienteId, empresaId, atividadeId) => {
  const areas = /** @type {any[]} */ (
    await tx.atividadeArea.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
      select: { area_id: true, setor_id: true, setor_nome: true, area_planejada: true },
    })
  );
  /** @type {Record<string, unknown>} */
  let dados = { area_id: null, setor_id: null, setor_nome: null };
  if (areas.length) {
    const comPlanejada = areas.filter((a) => a.area_planejada !== null && a.area_planejada !== undefined);
    dados = {
      area_id: areas[0].area_id,
      setor_id: areas[0].setor_id ?? null,
      setor_nome: areas[0].setor_nome ?? null,
      area_planejada: comPlanejada.length ? t4(comPlanejada.reduce((t, a) => t.plus(dec(a.area_planejada)), dec(0))) : null,
    };
  }
  await tx.atividade.updateMany({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId }, data: dados });
};

/**
 * As áreas da ABERTURA (abrir e duplicar), na transação da abertura e depois do INSERT da atividade: uma linha por área,
 * `ordem` 1..N. `status` PLANEJADA (o cliente novo, `areas[]`) ou EM_ANDAMENTO desde o início da atividade (o cliente
 * antigo, `area_id` único: a atividade de uma área começa já em andamento, como antes).
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, usuarioId: string|null, status: string, dataInicio: string|null,
 *   areas: Array<{ area_id: string, area_planejada: string|null, setor_id: string|null, setor_nome: string|null }> }} p
 */
export const gravarAreasDaAbertura = async (tx, { clienteId, empresaId, atividadeId, usuarioId, status, dataInicio, areas }) => {
  for (const [i, a] of areas.entries()) {
    await comFkTraduzida(() =>
      inserirAreaDaAtividade(tx, {
        cliente_id: clienteId,
        empresa_id: empresaId,
        atividade_id: atividadeId,
        area_id: a.area_id,
        setor_id: a.setor_id,
        setor_nome: a.setor_nome,
        area_planejada: a.area_planejada,
        status,
        data_inicio: status === STATUS_AREA.EM_ANDAMENTO && dataInicio ? comoData(dataInicio) : null,
        ordem: i + 1,
        criado_por_usuario_id: usuarioId,
        versao: 1,
      })
    );
  }
};

/**
 * Concluir a ATIVIDADE conclui junto as áreas EM_ANDAMENTO, com a mesma data (que não pode ser antes do início de
 * nenhuma delas: 422 `antes_do_inicio_da_area`); as PLANEJADAS ficam como estão ("não iniciadas"). SOB a trava da
 * atividade. Devolve quantas áreas foram concluídas.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, dia: string }} p
 */
export const concluirAreasEmAndamento = async (tx, { clienteId, empresaId, atividadeId, dia }) => {
  const emAndamento = /** @type {any[]} */ (await listarAreasDaAtividade(tx, clienteId, empresaId, atividadeId)).filter((a) => a.status === STATUS_AREA.EM_ANDAMENTO);
  for (const a of emAndamento) {
    const inicio = diaDe(a.data_inicio);
    if (inicio && dia < inicio) {
      throw atividadeDataInvalida('data_conclusao', 'antes_do_inicio_da_area', { data: dia, area: a.area?.nome ?? null, data_inicio_area: inicio });
    }
  }
  // D-PROD-267: nunca antes do último dia lançado na atividade (em qualquer área, ou sem área na atividade antiga).
  const ultimo = await ultimoDiaDaAtividade(tx, { clienteId, empresaId, atividadeId });
  if (ultimo && dia < ultimo) throw atividadeDataInvalida('data_conclusao', 'antes_do_ultimo_dia', { data: dia, ultimo_dia: ultimo });
  if (!emAndamento.length) return 0;
  const r = await tx.atividadeArea.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: STATUS_AREA.EM_ANDAMENTO },
    data: { status: STATUS_AREA.CONCLUIDA, data_conclusao: comoData(dia), versao: { increment: 1 } },
  });
  return r.count;
};

// ─── o último dia lançado e a conclusão automática (D-PROD-267) ───────────

/** O maior de dois dias `AAAA-MM-DD` (nulos ficam de fora). @param {string|null} a @param {string|null} b */
const maiorDia = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * O ÚLTIMO DIA lançado de cada área da atividade: o maior entre `data_operacional` e `data_termino` dos lançamentos
 * CONFIRMADO. `atividadeAreaIds` limita às áreas dadas (ids de `AtividadeArea`). Uma consulta agrupada. Devolve o mapa
 * id da área da atividade → `AAAA-MM-DD` (a chave `null` junta os lançamentos sem área, da atividade antiga).
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, atividadeAreaIds?: string[] }} p
 * @returns {Promise<Map<string|null, string>>}
 */
export const ultimosDiasDasAreas = async (tx, { clienteId, empresaId, atividadeId, atividadeAreaIds = undefined }) => {
  if (atividadeAreaIds && !atividadeAreaIds.length) return new Map();
  const linhas = /** @type {any[]} */ (
    await tx.atividadeApontamento.groupBy({
      by: ['atividade_area_id'],
      where: {
        cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: STATUS_APONTAMENTO.CONFIRMADO,
        ...(atividadeAreaIds ? { atividade_area_id: { in: atividadeAreaIds } } : {}),
      },
      _max: { data_operacional: true, data_termino: true },
    })
  );
  /** @type {Map<string|null, string>} */
  const porArea = new Map();
  for (const l of linhas) {
    const ultimo = maiorDia(diaDe(l._max.data_operacional) ?? null, diaDe(l._max.data_termino) ?? null);
    if (ultimo) porArea.set(l.atividade_area_id ?? null, ultimo);
  }
  return porArea;
};

/**
 * O último dia lançado na ATIVIDADE (todas as áreas e os lançamentos sem área), ou null sem lançamento confirmado.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string }} p
 */
export const ultimoDiaDaAtividade = async (tx, p) => {
  /** @type {string|null} */
  let ultimo = null;
  for (const d of (await ultimosDiasDasAreas(tx, p)).values()) ultimo = maiorDia(ultimo, d);
  return ultimo;
};

/**
 * Conclui UMA área EM_ANDAMENTO na transação de quem chama, SOB a trava da atividade (ABERTA, conferida por quem chama):
 * a data nunca antes do início da área (`antes_do_inicio_da_area`) nem do último dia lançado nela (`antes_do_ultimo_dia`);
 * "não futura" é de quem chama. É o caminho de `POST …/areas/:areaId/concluir` e do registro de campo com `concluir`
 * (D-PROD-267). `area` é a linha lida sob a trava (com `versao` e o resumo da área). Devolve `{ area, atividade }`.
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, area: any, dia: string, versao?: unknown }} p
 */
export const concluirAreaNaTransacao = async (tx, contexto, { clienteId, empresaId, atividadeId, area, dia, versao = undefined }) => {
  exigirStatusDaArea(area, STATUS_AREA.EM_ANDAMENTO, 'concluir_area');
  const inicio = diaDe(area.data_inicio);
  if (inicio && dia < inicio) {
    throw atividadeDataInvalida('data_conclusao', 'antes_do_inicio_da_area', { data: dia, area: area.area?.nome ?? null, data_inicio_area: inicio });
  }
  const ultimo = (await ultimosDiasDasAreas(tx, { clienteId, empresaId, atividadeId, atividadeAreaIds: [area.id] })).get(area.id) ?? null;
  if (ultimo && dia < ultimo) throw atividadeDataInvalida('data_conclusao', 'antes_do_ultimo_dia', { data: dia, area: area.area?.nome ?? null, ultimo_dia: ultimo });
  return gravarAreaEResponder(tx, contexto, {
    clienteId, empresaId, atividadeId, area, versao: versao ?? area.versao, acao: 'concluir_area', dados: { status: STATUS_AREA.CONCLUIDA, data_conclusao: comoData(dia) },
  });
};

/**
 * "Todas as áreas concluídas ⇒ atividade concluída" (D-PROD-267), na transação de quem chama e SOB a trava da atividade:
 * com pelo menos uma área e TODAS CONCLUIDAS, a atividade ABERTA conclui no dia da área que concluiu por último, com quem e
 * quando (a `versao` sobe, como no "Concluir atividade"), e a conclusão é auditada (`atividade.concluir`,
 * `conclusao_automatica`). Tipo que exige produção sem produção somada > 0: fica ABERTA (nada muda). Devolve se concluiu.
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, tempo: { agora: Date } }} p
 * @returns {Promise<boolean>}
 */
export const concluirAtividadeSeAreasConcluidas = async (tx, contexto, { clienteId, empresaId, atividadeId, tempo }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const areas = /** @type {Array<{ status: string, data_conclusao: Date|null }>} */ (
    await tx.atividadeArea.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId }, select: { status: true, data_conclusao: true } })
  );
  if (!areas.length || areas.some((a) => a.status !== STATUS_AREA.CONCLUIDA)) return false;
  const atividade = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { id: true, status: true, versao: true, tipo_atividade_id: true },
  });
  if (!atividade || atividade.status !== STATUS_ATIVIDADE.ABERTA) return false;
  if (regrasDoTipo(await lerTipoAtividade(tx, clienteId, atividade.tipo_atividade_id)).exige_producao) {
    const { quantidade_produzida: producao } = await somarApontamentosConfirmados(tx, clienteId, empresaId, atividadeId);
    if (producao === null || !dec(producao).gt(0)) return false;
  }
  /** @type {string|null} */
  let dia = null;
  for (const a of areas) dia = maiorDia(dia, diaDe(a.data_conclusao) ?? null);
  if (!dia) return false;
  const r = await tx.atividade.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId, status: STATUS_ATIVIDADE.ABERTA, versao: atividade.versao },
    data: {
      status: STATUS_ATIVIDADE.CONCLUIDA,
      data_conclusao: comoData(dia),
      concluida_em: tempo.agora,
      concluida_por_usuario_id: auth.usuarioId ?? null,
      versao: { increment: 1 },
    },
  });
  if (r.count !== 1) return false;
  await registrarEvento(
    contexto,
    {
      acao: 'atividade.concluir',
      entidade: ENTIDADE_ATIVIDADE,
      entidadeId: atividadeId,
      dadosAnteriores: { id: atividadeId, status: STATUS_ATIVIDADE.ABERTA, versao: atividade.versao },
      dadosNovos: {
        id: atividadeId, status: STATUS_ATIVIDADE.CONCLUIDA, data_conclusao: dia, versao: atividade.versao + 1,
        conclusao_automatica: true, motivo: 'todas_as_areas_concluidas', areas_concluidas: areas.length,
      },
    },
    tx
  );
  return true;
};

/**
 * Reabrir a ATIVIDADE desfaz o concluir: as áreas CONCLUIDAS na data de conclusão da atividade voltam a EM_ANDAMENTO
 * (a conclusão sai; o início fica). As concluídas em outro dia ficam. SOB a trava da atividade. Devolve quantas.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, dia: string|null }} p
 */
export const reabrirAreasConcluidasJunto = async (tx, { clienteId, empresaId, atividadeId, dia }) => {
  if (!dia) return 0;
  const r = await tx.atividadeArea.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, status: STATUS_AREA.CONCLUIDA, data_conclusao: comoData(dia) },
    data: { status: STATUS_AREA.EM_ANDAMENTO, data_conclusao: null, versao: { increment: 1 } },
  });
  return r.count;
};

// ─── totais por área ────────────────────────────────────────────────────────

/**
 * `por_area` de `GET /atividades/:id/totais`: uma entrada por área, na ordem:
 * `{ atividade_area_id, area {id, numero_area, nome}, status, data_inicio, data_conclusao, area_planejada,
 *   area_executada, percentual, custo_total, custo_por_tipo {maquinas, produtos, mao_obra, servicos, combustivel},
 *   custo_por_ha, combustivel {quantidade_l, quantidade_kg, custo_total}, ultimo_lancamento,
 *   lancamentos_confirmados, lancamentos_cancelados }`.
 * As parcelas são as mesmas do `custo_total` da atividade; o lançamento sem área (atividade antiga) só entra no total
 * da atividade. `percentual` = feita ÷ planejada × 100 (2 casas; nulo sem planejada > 0); `custo_por_ha` = custo ÷
 * feita (4 casas; nulo sem feita > 0 ou sem custo). Decimais como texto.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
export const totaisPorArea = async (db, clienteId, empresaId, atividadeId) => {
  const areas = /** @type {any[]} */ (await listarAreasDaAtividade(db, clienteId, empresaId, atividadeId));
  if (!areas.length) return [];
  const lancamentos = await lancamentosPorArea(db, clienteId, empresaId, atividadeId);
  const custos = await custosPorArea(db, clienteId, empresaId, atividadeId);
  return areas.map((a) => {
    const l = lancamentos.find((x) => x.atividade_area_id === a.id);
    const c = (/** @type {string} */ tipo) => custos.find((x) => x.atividade_area_id === a.id && x.tipo === tipo) ?? null;
    const porTipo = {
      maquinas: t4(c('maquinas')?.custo ?? null),
      produtos: t4(c('produtos')?.custo ?? null),
      mao_obra: t4(c('mao_obra')?.custo ?? null),
      servicos: t4(c('servicos')?.custo ?? null),
      combustivel: t4(c('combustivel')?.custo ?? null),
    };
    const parcelas = Object.values(porTipo).filter((v) => v !== null);
    const custoTotal = parcelas.length ? parcelas.reduce((t, v) => t.plus(dec(v)), dec(0)) : null;
    const feita = l?.area_executada === null || l?.area_executada === undefined ? null : dec(l.area_executada);
    const planejada = a.area_planejada === null || a.area_planejada === undefined ? null : dec(a.area_planejada);
    return {
      atividade_area_id: a.id,
      area: a.area ? { id: a.area.id, numero_area: a.area.numero_area, nome: a.area.nome } : null,
      status: a.status,
      data_inicio: diaDe(a.data_inicio),
      data_conclusao: diaDe(a.data_conclusao),
      area_planejada: t4(a.area_planejada),
      area_executada: feita === null ? null : t4(feita),
      percentual: feita !== null && planejada !== null && planejada.gt(0) ? arredondar(feita.dividedBy(planejada).times(100), 2).toFixed(2) : null,
      custo_total: custoTotal === null ? null : t4(custoTotal),
      custo_por_tipo: porTipo,
      custo_por_ha: custoTotal !== null && feita !== null && feita.gt(0) ? t4(arredondar(custoTotal.dividedBy(feita), 4)) : null,
      combustivel: {
        quantidade_l: t4(c('combustivel')?.litros ?? null),
        quantidade_kg: t4(c('combustivel')?.quilos ?? null),
        custo_total: porTipo.combustivel,
      },
      ultimo_lancamento: l?.ultimo_lancamento ? diaDe(l.ultimo_lancamento) : null,
      lancamentos_confirmados: l?.confirmados ?? 0,
      lancamentos_cancelados: l?.cancelados ?? 0,
    };
  });
};

// ─── escritas das áreas ─────────────────────────────────────────────────────

/** Auditoria da área (sem texto livre). @param {any} r */
const paraAuditoria = (r) => ({
  id: r.id,
  atividade_id: r.atividade_id,
  area_id: r.area_id,
  setor_id: r.setor_id ?? null,
  area_planejada: t4(r.area_planejada),
  status: r.status,
  data_inicio: diaDe(r.data_inicio),
  data_conclusao: diaDe(r.data_conclusao),
  ordem: r.ordem,
  versao: r.versao,
  updatedAt: iso(r.updatedAt),
});

/**
 * Abertura comum das escritas de área: empresa no tenant → (o "hoje", quando a ação usa) → Atividade FOR UPDATE →
 * status da atividade (ABERTA) → a área (404) → `versao` da área.
 * @param {any} tx @param {string} clienteId
 * @param {{ empresaDoCorpo: unknown, atividadeId: string, areaId?: string, versao?: unknown, acao: string, comTempo?: boolean }} a
 */
const abrirEscritaDeArea = async (tx, clienteId, { empresaDoCorpo, atividadeId, areaId, versao, acao, comTempo = false }) => {
  const empresaId = await exigirEmpresaDoTenant(tx, clienteId, empresaDoCorpo);
  const tempo = comTempo ? await tempoDaFazenda(tx, clienteId, empresaId) : null; // Empresa FOR SHARE
  if (!(await travarAtividade(tx, clienteId, empresaId, atividadeId))) throw atividadeNotFound(); // Atividade FOR UPDATE
  const atividade = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { id: true, status: true, data_inicio: true, tipo_atividade_id: true },
  });
  if (!atividade) throw atividadeNotFound();
  exigirStatusDaAtividade(atividade, /** @type {any} */ (acao));
  let area = null;
  if (areaId !== undefined) {
    area = await buscarAreaDaAtividade(tx, clienteId, empresaId, atividadeId, areaId);
    if (!area) throw atividadeAreaNotFound();
    exigirVersao(area, versao, 'area');
  }
  return { empresaId, tempo, atividade, area };
};

/**
 * UPDATE da área com CAS (`versao` + status lido sob a trava) e a resposta `{ area, atividade }`.
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, area: any, versao: number, acao: string, dados: Record<string, unknown>, sincronizar?: boolean }} p
 */
const gravarAreaEResponder = async (tx, contexto, { clienteId, empresaId, atividadeId, area, versao, acao, dados, sincronizar = false }) => {
  const alvo = { clienteId, empresaId, id: area.id, versao, statusEsperado: area.status, onde: { atividade_id: atividadeId } };
  const alterados = await atualizarComVersao(tx.atividadeArea, { ...alvo, dados });
  if (alterados !== 1) throw await erroDoCasPerdido(tx.atividadeArea, { ...alvo, acao, entidade: 'area' });
  if (sincronizar) await sincronizarCabecalhoComAreas(tx, clienteId, empresaId, atividadeId);
  const depois = await buscarAreaDaAtividade(tx, clienteId, empresaId, atividadeId, area.id);
  await registrarEvento(
    contexto,
    { acao: `atividade.area.${acao.replace(/_area$/, '')}`, entidade: ENTIDADE_AREA_DA_ATIVIDADE, entidadeId: area.id, dadosAnteriores: paraAuditoria(area), dadosNovos: paraAuditoria(depois) },
    tx
  );
  return { area: comoAreaDaAtividadePublica(depois), atividade: await carregarAtividadeDetalhe(tx, clienteId, empresaId, atividadeId) };
};

/**
 * Mais uma área na atividade, na transação de quem chama e SOB a trava da atividade (ABERTA, conferida por quem chama):
 * a área do mapa conferida (`exigirAreaDoMapa`; `campo` vai no erro), nunca duas vezes (422 `ja_na_atividade`),
 * PLANEJADA, no fim da ordem, `area_planejada` padrão = o tamanho; o cabeçalho acompanha e a escrita é auditada. É o
 * caminho de `POST /atividades/:id/areas` e do registro de campo de várias áreas (D-PROD-263), que depois a inicia.
 * Devolve a área relida (com o resumo).
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, areaId: string, planejada?: string|null, campo?: string }} p
 */
export const adicionarAreaNaTransacao = async (tx, contexto, { clienteId, empresaId, atividadeId, areaId, planejada = undefined, campo = 'area_id' }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const mapa = await exigirAreaDoMapa(tx, clienteId, empresaId, areaId, campo);
  const ja = await tx.atividadeArea.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, area_id: areaId }, select: { id: true } });
  if (ja) throw atividadeReferenciaInvalida(/** @type {any} */ (campo), 'ja_na_atividade');
  const ordem = await proximaOrdemDaArea(tx, clienteId, empresaId, atividadeId);
  const { id } = await comFkTraduzida(() =>
    inserirAreaDaAtividade(tx, {
      cliente_id: clienteId,
      empresa_id: empresaId,
      atividade_id: atividadeId,
      area_id: areaId,
      setor_id: mapa.setor_id,
      setor_nome: mapa.setor_nome,
      area_planejada: planejada === undefined ? mapa.tamanho : planejada,
      status: STATUS_AREA.PLANEJADA,
      ordem,
      criado_por_usuario_id: auth.usuarioId ?? null,
      versao: 1,
    })
  );
  await sincronizarCabecalhoComAreas(tx, clienteId, empresaId, atividadeId);
  const area = await buscarAreaDaAtividade(tx, clienteId, empresaId, atividadeId, id);
  await registrarEvento(contexto, { acao: 'atividade.area.adicionar', entidade: ENTIDADE_AREA_DA_ATIVIDADE, entidadeId: id, dadosNovos: paraAuditoria(area) }, tx);
  return area;
};

/**
 * `POST /atividades/:id/areas` (201): mais uma área na atividade ABERTA, PLANEJADA, no fim da ordem; `area_planejada`
 * padrão = o tamanho da área. A mesma área duas vezes → 422 `ja_na_atividade` (o UNIQUE é a rede).
 * @param {any} contexto @param {string} atividadeId @param {Record<string, any>} corpo
 */
export const adicionarArea = async (contexto, atividadeId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const areaId = idOuNulo(corpo.area_id, 'area_id');
  if (!areaId) throw invalido('area_id é obrigatório', { field: 'area_id', reason: 'obrigatorio' });
  const planejadaInformada = corpo.area_planejada === undefined ? undefined : decimalDoCorpo(corpo.area_planejada, 'area_planejada');
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const { empresaId } = await abrirEscritaDeArea(tx, cli, { empresaDoCorpo: corpo.empresa_id, atividadeId, acao: 'adicionar_area' });
      const area = await adicionarAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, areaId, planejada: planejadaInformada });
      return { area: comoAreaDaAtividadePublica(area), atividade: await carregarAtividadeDetalhe(tx, cli, empresaId, atividadeId) };
    },
    // A unique (cliente_id, empresa_id, atividade_id, area_id) é a rede da pré-conferência de `adicionarAreaNaTransacao`. D-PROD-253: sem o
    // alvo do P2002 (produção: papel não dono + RLS), a mesma área é conferida depois do rollback.
    {
      area_id: {
        erro: () => atividadeReferenciaInvalida('area_id', 'ja_na_atividade'),
        conferir: (tx) => tx.atividadeArea.findFirst({ where: { cliente_id: cli, atividade_id: atividadeId, area_id: areaId }, select: { id: true } }),
      },
    },
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * `PATCH /atividades/:id/areas/:areaId`: a área planejada (null limpa), em qualquer status, com a atividade ABERTA e a
 * `versao` da área. O cabeçalho acompanha (Σ).
 * @param {any} contexto @param {string} atividadeId @param {string} areaId @param {Record<string, any>} corpo
 */
export const editarArea = async (contexto, atividadeId, areaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const planejada = decimalDoCorpo(corpo.area_planejada, 'area_planejada');
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const { empresaId, area } = await abrirEscritaDeArea(tx, cli, { empresaDoCorpo: corpo.empresa_id, atividadeId, areaId, versao: corpo.versao, acao: 'editar_area' });
      return gravarAreaEResponder(tx, contexto, {
        clienteId: cli, empresaId, atividadeId, area, versao: corpo.versao, acao: 'editar_area', dados: { area_planejada: planejada }, sincronizar: true,
      });
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * `POST …/areas/:areaId/iniciar`: PLANEJADA → EM_ANDAMENTO com `data_inicio` (padrão hoje na fazenda; nunca futura nem
 * antes do início da atividade). A partir daí a área recebe lançamento.
 * @param {any} contexto @param {string} atividadeId @param {string} areaId @param {Record<string, any>} corpo
 */
export const iniciarArea = async (contexto, atividadeId, areaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const informada = diaDoCorpo(corpo.data_inicio, 'data_inicio');
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const { empresaId, tempo, atividade, area } = await abrirEscritaDeArea(tx, cli, {
        empresaDoCorpo: corpo.empresa_id, atividadeId, areaId, versao: corpo.versao, acao: 'iniciar_area', comTempo: true,
      });
      exigirStatusDaArea(area, STATUS_AREA.PLANEJADA, 'iniciar_area');
      const dia = informada ?? /** @type {any} */ (tempo).hoje;
      exigirDiaNaoFuturo(/** @type {any} */ (tempo), dia, 'data_inicio');
      const inicioDaAtividade = diaDe(atividade.data_inicio);
      if (inicioDaAtividade && dia < inicioDaAtividade) throw atividadeDataInvalida('data_inicio', 'antes_do_inicio', { data: dia, data_inicio: inicioDaAtividade });
      return gravarAreaEResponder(tx, contexto, {
        clienteId: cli, empresaId, atividadeId, area, versao: corpo.versao, acao: 'iniciar_area', dados: { status: STATUS_AREA.EM_ANDAMENTO, data_inicio: comoData(dia) },
      });
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * Inicia a área PLANEJADA na transação de quem chama, SOB a trava da atividade (D-PROD-254, o registro de campo que
 * entra numa atividade com a área ainda "a iniciar"): mesmo efeito de `iniciarArea` (EM_ANDAMENTO com `data_inicio`),
 * com o dia = o maior entre o dia do registro e o início da atividade (a regra "não antes do início da atividade" fica
 * valendo; o dia nunca é futuro porque o registro já foi conferido). `area` é a linha lida sob a trava.
 * @param {any} tx @param {any} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, area: any, dia: string, inicioDaAtividade: string|null }} p
 */
export const iniciarAreaNaTransacao = async (tx, contexto, { clienteId, empresaId, atividadeId, area, dia, inicioDaAtividade }) => {
  exigirStatusDaArea(area, STATUS_AREA.PLANEJADA, 'iniciar_area');
  const inicio = inicioDaAtividade && dia < inicioDaAtividade ? inicioDaAtividade : dia;
  return gravarAreaEResponder(tx, contexto, {
    clienteId, empresaId, atividadeId, area, versao: area.versao, acao: 'iniciar_area', dados: { status: STATUS_AREA.EM_ANDAMENTO, data_inicio: comoData(inicio) },
  });
};

/**
 * `POST …/areas/:areaId/concluir`: EM_ANDAMENTO → CONCLUIDA com `data_conclusao` (padrão hoje; nunca futura nem antes
 * do início da área). Concluída, a área não recebe lançamento novo.
 * D-PROD-267: nem antes do último dia lançado nela; e, sendo a última área em aberto, a atividade conclui junto
 * (`atividade_concluida: true` na resposta, com o `atividade` já concluído).
 * @param {any} contexto @param {string} atividadeId @param {string} areaId @param {Record<string, any>} corpo
 */
export const concluirArea = async (contexto, atividadeId, areaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const informada = diaDoCorpo(corpo.data_conclusao, 'data_conclusao');
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const { empresaId, tempo, area } = await abrirEscritaDeArea(tx, cli, {
        empresaDoCorpo: corpo.empresa_id, atividadeId, areaId, versao: corpo.versao, acao: 'concluir_area', comTempo: true,
      });
      exigirStatusDaArea(area, STATUS_AREA.EM_ANDAMENTO, 'concluir_area');
      const dia = informada ?? /** @type {any} */ (tempo).hoje;
      exigirDiaNaoFuturo(/** @type {any} */ (tempo), dia, 'data_conclusao');
      const r = await concluirAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, area, dia, versao: corpo.versao });
      const concluida = await concluirAtividadeSeAreasConcluidas(tx, contexto, { clienteId: cli, empresaId, atividadeId, tempo: /** @type {any} */ (tempo) });
      return concluida ? { ...r, atividade: await carregarAtividadeDetalhe(tx, cli, empresaId, atividadeId), atividade_concluida: true } : { ...r, atividade_concluida: false };
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * `POST …/areas/:areaId/reabrir`: CONCLUIDA → EM_ANDAMENTO (o início fica; a conclusão sai).
 * @param {any} contexto @param {string} atividadeId @param {string} areaId @param {Record<string, any>} corpo
 */
export const reabrirArea = async (contexto, atividadeId, areaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const { empresaId, area } = await abrirEscritaDeArea(tx, cli, { empresaDoCorpo: corpo.empresa_id, atividadeId, areaId, versao: corpo.versao, acao: 'reabrir_area' });
      exigirStatusDaArea(area, STATUS_AREA.CONCLUIDA, 'reabrir_area');
      return gravarAreaEResponder(tx, contexto, {
        clienteId: cli, empresaId, atividadeId, area, versao: corpo.versao, acao: 'reabrir_area', dados: { status: STATUS_AREA.EM_ANDAMENTO, data_conclusao: null },
      });
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * `POST …/areas/:areaId/remover`: a área PLANEJADA e SEM nenhum lançamento sai da atividade (DELETE físico: não tem
 * custo). Iniciada → 409 `ATIVIDADE_STATUS_INVALIDO`; com lançamento (mesmo cancelado) → 409
 * `ATIVIDADE_AREA_COM_LANCAMENTOS`; a última área de um tipo que exige área → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`.
 * Responde `{ removida, atividade }`.
 * @param {any} contexto @param {string} atividadeId @param {string} areaId @param {Record<string, any>} corpo
 */
export const removerArea = async (contexto, atividadeId, areaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const { empresaId, atividade, area } = await abrirEscritaDeArea(tx, cli, { empresaDoCorpo: corpo.empresa_id, atividadeId, areaId, versao: corpo.versao, acao: 'remover_area' });
      exigirStatusDaArea(area, STATUS_AREA.PLANEJADA, 'remover_area');
      const uso = await contarLancamentosDaArea(tx, cli, empresaId, atividadeId, area.id);
      if (uso.confirmados + uso.cancelados > 0) throw atividadeAreaComLancamentos(uso);
      const total = await tx.atividadeArea.count({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId } });
      if (total === 1 && regrasDoTipo(await lerTipoAtividade(tx, cli, atividade.tipo_atividade_id)).exige_area) throw atividadeExigidaPeloTipo('area_id');
      const apagadas = await apagarAreaDaAtividade(tx, { clienteId: cli, empresaId, atividadeId, id: area.id, versao: /** @type {number} */ (corpo.versao) });
      if (apagadas !== 1) throw atividadeAreaNotFound();
      await sincronizarCabecalhoComAreas(tx, cli, empresaId, atividadeId);
      await registrarEvento(contexto, { acao: 'atividade.area.remover', entidade: ENTIDADE_AREA_DA_ATIVIDADE, entidadeId: area.id, dadosAnteriores: paraAuditoria(area) }, tx);
      return { removida: area.id, atividade: await carregarAtividadeDetalhe(tx, cli, empresaId, atividadeId) };
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};
