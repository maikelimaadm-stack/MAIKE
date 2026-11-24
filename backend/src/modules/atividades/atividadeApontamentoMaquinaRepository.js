/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades) — repositório das LINHAS DE
 * MÁQUINA do apontamento (`AtividadeApontamentoMaquina`), contrato
 * `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` §3.
 *
 * Adaptador de dados, sem regra: o `cliente_id` vem SEMPRE de quem chama (que o
 * tirou do auth_context), nunca do corpo, da query, dos params, do cabeçalho nem
 * do cookie (R11). Toda leitura vai pelo escopo (cliente_id, empresa_id, …):
 * linha de outro apontamento, de outra fazenda ou de outro tenant dá o mesmo
 * `null` (sem oráculo).
 *
 * A leitura do medidor vive na LINHA; nada aqui grava `BemPatrimonial` (a série
 * do medidor é derivada em `patrimonio/abastecimentoMedidor.js`).
 */

import { BEM_RESUMO, IMPLEMENTO_RESUMO, STATUS_APONTAMENTO, USUARIO_RESUMO } from './atividadeComum.js';

/** Status da linha (CHECK `AtividadeApontamentoMaquina_status_check`). */
export const STATUS_LINHA = Object.freeze({ CONFIRMADO: 'CONFIRMADO', CANCELADO: 'CANCELADO' });

/** Origem do cancelamento da linha (CHECK do status). */
export const ORIGENS_CANCELAMENTO = Object.freeze({ LINHA: 'LINHA', EDICAO: 'EDICAO', APONTAMENTO: 'APONTAMENTO', ATIVIDADE: 'ATIVIDADE' });

/** `include` da linha: o resumo ao lado de cada id da forma pública. */
export const INCLUIR_LINHA_MAQUINA = Object.freeze({
  bem: BEM_RESUMO,
  implemento: IMPLEMENTO_RESUMO, // D-PROD-283: com o produto do tipo (o jato)
  criadoPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
});

/** Ordem das linhas dentro do apontamento (a `ordem` é única por apontamento). */
export const ORDEM_LINHAS_MAQUINA = Object.freeze([{ ordem: 'asc' }, { id: 'asc' }]);

/**
 * Linhas (confirmadas E canceladas) dos apontamentos dados, com os resumos, na
 * ordem do apontamento.
 * @param {any} db  cliente Prisma ou transação
 * @param {string} clienteId @param {string} empresaId @param {string[]} apontamentoIds
 */
export const listarLinhasDosApontamentos = (db, clienteId, empresaId, apontamentoIds) =>
  apontamentoIds.length
    ? db.atividadeApontamentoMaquina.findMany({
        where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds } },
        include: INCLUIR_LINHA_MAQUINA,
        orderBy: [{ apontamento_id: 'asc' }, ...ORDEM_LINHAS_MAQUINA],
      })
    : Promise.resolve([]);

/**
 * Linha DESTE apontamento e desta empresa, com os resumos.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} id
 */
export const buscarLinha = (db, clienteId, empresaId, apontamentoId, id) =>
  db.atividadeApontamentoMaquina.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id },
    include: INCLUIR_LINHA_MAQUINA,
  });

/**
 * Próxima `ordem` (máx + 1) do apontamento, contando as confirmadas e as
 * canceladas (a unique vale para as duas). Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} apontamentoId
 * @returns {Promise<number>}
 */
export const proximaOrdem = async (tx, clienteId, apontamentoId) => {
  const r = await tx.atividadeApontamentoMaquina.aggregate({ where: { cliente_id: clienteId, apontamento_id: apontamentoId }, _max: { ordem: true } });
  return (r._max.ordem ?? 0) + 1;
};

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirLinha = (tx, dados) => tx.atividadeApontamentoMaquina.create({ data: dados, select: { id: true } });

/**
 * O que a regra da linha lê do bem (máquina ou implemento): fazenda, situação,
 * natureza, o medidor do CADASTRO (o ponto da série), o custo por uso e o teto
 * de salto do TIPO patrimonial. Outro tenant = `null`.
 * @param {any} tx @param {string} clienteId @param {string} id
 */
export const lerBemDaLinha = (tx, clienteId, id) =>
  tx.bemPatrimonial.findFirst({
    where: { cliente_id: clienteId, id },
    select: {
      ...BEM_RESUMO.select,
      empresa_id: true,
      ativo: true,
      medidor_tipo: true,
      medidor_unidade: true,
      medidor_leitura_atual: true,
      medidor_data_leitura: true,
      custo_uso_unitario: true,
      tipo: { select: { id: true, salto_maximo_medidor: true } },
    },
  });

/**
 * Trava os bens (`FOR UPDATE`), em ordem de id (sem deadlock entre duas
 * escritas com os mesmos bens): serializa a leitura do medidor da linha com o
 * abastecimento e o PATCH do bem, que travam o bem do mesmo jeito. Ordem
 * canônica: Empresa FOR SHARE → Atividade FOR UPDATE → Bem FOR UPDATE.
 * Devolve os ids travados (bem de outra fazenda ou tenant não trava).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string[]} ids
 * @returns {Promise<string[]>}
 */
export const travarBens = async (tx, clienteId, empresaId, ids) => {
  const travados = [];
  for (const id of [...new Set(ids)].sort()) {
    const r = /** @type {any[]} */ (
      await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
    );
    if (r.length) travados.push(id);
  }
  return travados;
};

/**
 * A flag `permite_implemento` do TIPO da atividade (lida agora, não é snapshot).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<boolean>}
 */
export const tipoPermiteImplemento = async (tx, clienteId, empresaId, atividadeId) => {
  const r = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { tipoAtividade: { select: { permite_implemento: true } } },
  });
  return r?.tipoAtividade?.permite_implemento === true;
};

/**
 * O essencial do apontamento para as regras da linha. Outra atividade,
 * fazenda ou tenant = `null`.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id
 */
export const lerApontamentoDaLinha = (tx, clienteId, empresaId, atividadeId, id) =>
  tx.atividadeApontamento.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id },
    select: { id: true, empresa_id: true, atividade_id: true, status: true, versao: true, data_operacional: true },
  });

/**
 * CONFIRMADO → CANCELADO das linhas dadas pelo filtro, numa instrução, com o
 * mesmo instante, usuário, motivo e origem. Devolve a contagem.
 * @param {any} tx
 * @param {Record<string, unknown>} onde  já com `cliente_id` e `empresa_id`
 * @param {{ usuarioId: string|null, motivo: string, agora: Date, origem: string }} dados
 * @returns {Promise<number>}
 */
export const cancelarLinhas = async (tx, onde, { usuarioId, motivo, agora, origem }) => {
  const r = await tx.atividadeApontamentoMaquina.updateMany({
    where: { ...onde, status: STATUS_LINHA.CONFIRMADO },
    data: {
      status: STATUS_LINHA.CANCELADO,
      cancelado_em: agora,
      cancelado_por_usuario_id: usuarioId,
      motivo_cancelamento: motivo,
      cancelamento_origem: origem,
    },
  });
  return r.count;
};

/**
 * Linhas CONFIRMADAS de um apontamento (a data dele não muda com elas).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} apontamentoId
 * @returns {Promise<number>}
 */
export const contarConfirmadasDoApontamento = (db, clienteId, empresaId, apontamentoId) =>
  db.atividadeApontamentoMaquina.count({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, status: STATUS_LINHA.CONFIRMADO },
  });

/** Status do apontamento que aceita linha. */
export const APONTAMENTO_ACEITA_LINHA = STATUS_APONTAMENTO.CONFIRMADO;
