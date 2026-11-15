/**
 * D-PROD-203 (Fatia 4 do Lançamento de Atividades) — repositório das LINHAS DE
 * SERVIÇO do apontamento (`AtividadeApontamentoServico`), contrato
 * `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §4 e §5.
 *
 * Adaptador de dados, sem regra: o `cliente_id` vem SEMPRE de quem chama (que o
 * tirou do auth_context), nunca do corpo, da query, dos params, do cabeçalho nem
 * do cookie (R11). Toda leitura vai pelo escopo (cliente_id, empresa_id, …):
 * linha de outro apontamento, de outra fazenda ou de outro tenant dá o mesmo
 * `null` (sem oráculo). Nada aqui toca o financeiro.
 */

import { USUARIO_RESUMO } from './atividadeComum.js';

/** Status da linha (CHECK `AtividadeApontamentoServico_status_check`). */
export const STATUS_LINHA = Object.freeze({ CONFIRMADO: 'CONFIRMADO', CANCELADO: 'CANCELADO' });

/** Origem do cancelamento da linha (CHECK do status). */
export const ORIGENS_CANCELAMENTO = Object.freeze({ LINHA: 'LINHA', EDICAO: 'EDICAO', APONTAMENTO: 'APONTAMENTO', ATIVIDADE: 'ATIVIDADE' });

/** Resumos ao lado dos ids (só exibição). O parceiro sai só com id e nome (nada de documento). */
export const SERVICO_RESUMO = Object.freeze({ select: { id: true, numero: true, nome: true } });
export const PARCEIRO_RESUMO = Object.freeze({ select: { id: true, nome: true } });

/** `include` da linha: o resumo ao lado de cada id da forma pública. */
export const INCLUIR_LINHA_SERVICO = Object.freeze({
  servico: SERVICO_RESUMO,
  parceiro: PARCEIRO_RESUMO,
  criadoPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
});

/** Ordem das linhas dentro do apontamento (a `ordem` é única por apontamento). */
export const ORDEM_LINHAS_SERVICO = Object.freeze([{ ordem: 'asc' }, { id: 'asc' }]);

/**
 * Linhas (confirmadas E canceladas) dos apontamentos dados, com os resumos.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string[]} apontamentoIds
 */
export const listarLinhasDosApontamentos = (db, clienteId, empresaId, apontamentoIds) =>
  apontamentoIds.length
    ? db.atividadeApontamentoServico.findMany({
        where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds } },
        include: INCLUIR_LINHA_SERVICO,
        orderBy: [{ apontamento_id: 'asc' }, ...ORDEM_LINHAS_SERVICO],
      })
    : Promise.resolve([]);

/**
 * Linha DESTE apontamento e desta empresa, com os resumos.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} id
 */
export const buscarLinha = (db, clienteId, empresaId, apontamentoId, id) =>
  db.atividadeApontamentoServico.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id },
    include: INCLUIR_LINHA_SERVICO,
  });

/**
 * Próxima `ordem` (máx + 1) do apontamento, contando confirmadas e canceladas.
 * Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} apontamentoId
 * @returns {Promise<number>}
 */
export const proximaOrdem = async (tx, clienteId, apontamentoId) => {
  const r = await tx.atividadeApontamentoServico.aggregate({ where: { cliente_id: clienteId, apontamento_id: apontamentoId }, _max: { ordem: true } });
  return (r._max.ordem ?? 0) + 1;
};

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirLinha = (tx, dados) => tx.atividadeApontamentoServico.create({ data: dados, select: { id: true } });

/**
 * O que a regra da linha lê do serviço: fazenda, situação e a sigla da unidade
 * de medida (o snapshot `unidade`). Outro tenant = `null`.
 * @param {any} tx @param {string} clienteId @param {string} id
 */
export const lerServicoDaLinha = (tx, clienteId, id) =>
  tx.servico.findFirst({
    where: { cliente_id: clienteId, id },
    select: { ...SERVICO_RESUMO.select, empresa_id: true, ativo: true, unidadeMedida: { select: { id: true, sigla: true } } },
  });

/**
 * O parceiro lido FOR KEY SHARE — a mesma trava que a FK pega no INSERT, só que
 * antes (molde `bemPatrimonialService.lerReferencia`): uma exclusão do parceiro
 * em voo termina primeiro e aqui ele já não existe (422, nunca o 403 da FK); se
 * esta linha chega antes, a exclusão espera o commit e vê o vínculo
 * (`PARCEIRO_EM_USO`). Outro tenant = `null`.
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ empresa_id: string, ativo: boolean, tipos: string[] } | null>}
 */
export const lerParceiroDaLinha = async (tx, clienteId, id) => {
  const [parceiro] = /** @type {Array<{ empresa_id: string, ativo: boolean, tipos: string[] }>} */ (
    await tx.$queryRaw`SELECT empresa_id, ativo, tipos FROM "Fornecedor" WHERE cliente_id = ${clienteId} AND id = ${id} FOR KEY SHARE`
  );
  return parceiro ?? null;
};

/**
 * A flag `permite_servico` do TIPO da atividade (lida agora, não é snapshot).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<boolean>}
 */
export const tipoPermiteServico = async (tx, clienteId, empresaId, atividadeId) => {
  const r = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { tipoAtividade: { select: { permite_servico: true } } },
  });
  return r?.tipoAtividade?.permite_servico === true;
};

/**
 * CONFIRMADO → CANCELADO das linhas dadas pelo filtro, numa instrução.
 * @param {any} tx @param {Record<string, unknown>} onde  já com `cliente_id` e `empresa_id`
 * @param {{ usuarioId: string|null, motivo: string, agora: Date, origem: string }} dados
 * @returns {Promise<number>}
 */
export const cancelarLinhas = async (tx, onde, { usuarioId, motivo, agora, origem }) => {
  const r = await tx.atividadeApontamentoServico.updateMany({
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
  db.atividadeApontamentoServico.count({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, status: STATUS_LINHA.CONFIRMADO },
  });

/**
 * Alguma linha de serviço com chave que começa por `prefixo` (as chaves
 * derivadas `<operation_id>:s<n>` de um lançamento com linhas).
 * @param {any} db @param {string} clienteId @param {string} prefixo
 * @returns {Promise<boolean>}
 */
export const existeLinhaComPrefixo = async (db, clienteId, prefixo) =>
  (await db.atividadeApontamentoServico.count({ where: { cliente_id: clienteId, operation_id: { startsWith: prefixo } } })) > 0;

/**
 * Σ quantidade e Σ valor das linhas CONFIRMADAS de apontamentos CONFIRMADOS da
 * atividade, por serviço e unidade (snapshot), em ordem de nome.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<Array<{ servico_id: string, nome: string, unidade: string, quantidade: unknown, custo: unknown }>>}
 */
export const somarPorServico = (db, clienteId, empresaId, atividadeId) =>
  db.$queryRaw`SELECT l.servico_id, s.nome, l.unidade, SUM(l.quantidade) AS quantidade, SUM(l.valor_total) AS custo
    FROM "AtividadeApontamentoServico" l
    JOIN "AtividadeApontamento" a ON a.cliente_id = l.cliente_id AND a.empresa_id = l.empresa_id AND a.id = l.apontamento_id
    JOIN "Servico" s ON s.cliente_id = l.cliente_id AND s.empresa_id = l.empresa_id AND s.id = l.servico_id
    WHERE l.cliente_id = ${clienteId} AND l.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
      AND l.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
    GROUP BY l.servico_id, s.nome, l.unidade
    ORDER BY s.nome, l.servico_id, l.unidade`;
