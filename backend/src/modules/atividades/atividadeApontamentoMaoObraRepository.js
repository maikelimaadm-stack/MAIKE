/**
 * D-PROD-205 (Fatia 4 do Lançamento de Atividades) — repositório das LINHAS DE
 * MÃO DE OBRA do apontamento (`AtividadeApontamentoMaoObra`), contrato
 * `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §3 e §5.
 *
 * Adaptador de dados, sem regra: o `cliente_id` vem SEMPRE de quem chama (que o
 * tirou do auth_context), nunca do corpo, da query, dos params, do cabeçalho nem
 * do cookie (R11). Toda leitura vai pelo escopo (cliente_id, empresa_id, …):
 * linha de outro apontamento, de outra fazenda ou de outro tenant dá o mesmo
 * `null` (sem oráculo). Nada aqui toca o financeiro.
 */

import { USUARIO_RESUMO } from './atividadeComum.js';

/** Status da linha (CHECK `AtividadeApontamentoMaoObra_status_check`). */
export const STATUS_LINHA = Object.freeze({ CONFIRMADO: 'CONFIRMADO', CANCELADO: 'CANCELADO' });

/** Origem do cancelamento da linha (CHECK do status). */
export const ORIGENS_CANCELAMENTO = Object.freeze({ LINHA: 'LINHA', EDICAO: 'EDICAO', APONTAMENTO: 'APONTAMENTO', ATIVIDADE: 'ATIVIDADE' });

/**
 * Resumo do funcionário ao lado do id (só exibição), com os custos ATUAIS do cadastro: a janela de editar e o
 * "Repetir" mostram a prévia do custo que o servidor vai gravar (hora/diária = o cadastro de agora, não o snapshot
 * da linha), inclusive ao trocar a medida.
 */
export const FUNCIONARIO_RESUMO = Object.freeze({ select: { id: true, numero: true, nome: true, cargo: true, tipo: true, custo_hora: true, custo_diaria: true } });

/** `include` da linha: o resumo ao lado de cada id da forma pública. */
export const INCLUIR_LINHA_MAO_OBRA = Object.freeze({
  funcionario: FUNCIONARIO_RESUMO,
  criadoPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
});

/** Ordem das linhas dentro do apontamento (a `ordem` é única por apontamento). */
export const ORDEM_LINHAS_MAO_OBRA = Object.freeze([{ ordem: 'asc' }, { id: 'asc' }]);

/**
 * Linhas (confirmadas E canceladas) dos apontamentos dados, com os resumos.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string[]} apontamentoIds
 */
export const listarLinhasDosApontamentos = (db, clienteId, empresaId, apontamentoIds) =>
  apontamentoIds.length
    ? db.atividadeApontamentoMaoObra.findMany({
        where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds } },
        include: INCLUIR_LINHA_MAO_OBRA,
        orderBy: [{ apontamento_id: 'asc' }, ...ORDEM_LINHAS_MAO_OBRA],
      })
    : Promise.resolve([]);

/**
 * Linha DESTE apontamento e desta empresa, com os resumos.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} id
 */
export const buscarLinha = (db, clienteId, empresaId, apontamentoId, id) =>
  db.atividadeApontamentoMaoObra.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, id },
    include: INCLUIR_LINHA_MAO_OBRA,
  });

/**
 * Próxima `ordem` (máx + 1) do apontamento, contando confirmadas e canceladas.
 * Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} apontamentoId
 * @returns {Promise<number>}
 */
export const proximaOrdem = async (tx, clienteId, apontamentoId) => {
  const r = await tx.atividadeApontamentoMaoObra.aggregate({ where: { cliente_id: clienteId, apontamento_id: apontamentoId }, _max: { ordem: true } });
  return (r._max.ordem ?? 0) + 1;
};

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirLinha = (tx, dados) => tx.atividadeApontamentoMaoObra.create({ data: dados, select: { id: true } });

/**
 * O que a regra da linha lê do funcionário: fazenda, situação e os custos do
 * cadastro (o snapshot). Outro tenant = `null`. Lido FOR SHARE: uma inativação
 * ou troca de custo em voo (o UPDATE do cadastro trava FOR NO KEY UPDATE)
 * termina antes e aqui já se lê o estado novo (inativo → 422; custo novo no
 * snapshot); se esta linha chega antes, o cadastro espera o commit dela. A
 * leitura sem trava veria a versão velha e gravaria um vínculo com quem acabou
 * de ser inativado.
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ id: string, numero: string, nome: string, cargo: string|null, tipo: string, custo_hora: unknown,
 *   custo_diaria: unknown, empresa_id: string, ativo: boolean } | null>}
 */
export const lerFuncionarioDaLinha = async (tx, clienteId, id) => {
  const [f] = /** @type {any[]} */ (
    await tx.$queryRaw`SELECT id, numero, nome, cargo, tipo, custo_hora, custo_diaria, empresa_id, ativo
      FROM "Funcionario" WHERE cliente_id = ${clienteId} AND id = ${id} FOR SHARE`
  );
  return f ?? null;
};

/**
 * A flag `permite_mao_obra` do TIPO da atividade (lida agora, não é snapshot).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<boolean>}
 */
export const tipoPermiteMaoObra = async (tx, clienteId, empresaId, atividadeId) => {
  const r = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { tipoAtividade: { select: { permite_mao_obra: true } } },
  });
  return r?.tipoAtividade?.permite_mao_obra === true;
};

/**
 * CONFIRMADO → CANCELADO das linhas dadas pelo filtro, numa instrução.
 * @param {any} tx @param {Record<string, unknown>} onde  já com `cliente_id` e `empresa_id`
 * @param {{ usuarioId: string|null, motivo: string, agora: Date, origem: string }} dados
 * @returns {Promise<number>}
 */
export const cancelarLinhas = async (tx, onde, { usuarioId, motivo, agora, origem }) => {
  const r = await tx.atividadeApontamentoMaoObra.updateMany({
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
  db.atividadeApontamentoMaoObra.count({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, status: STATUS_LINHA.CONFIRMADO },
  });

/**
 * Alguma linha de mão de obra gravada com uma das `chaves` (as derivadas
 * `<operation_id>:o<n>` de um lançamento com linhas, `chavesDerivadasDasLinhas`).
 * Comparação EXATA (`IN`), sem curinga de LIKE.
 * @param {any} db @param {string} clienteId @param {string[]} chaves
 * @returns {Promise<boolean>}
 */
export const existeLinhaComChave = async (db, clienteId, chaves) =>
  chaves.length > 0 && (await db.atividadeApontamentoMaoObra.count({ where: { cliente_id: clienteId, operation_id: { in: chaves } } })) > 0;

/**
 * Σ quantidade e Σ custo das linhas CONFIRMADAS de apontamentos CONFIRMADOS da
 * atividade, por funcionário e tipo de medida, em ordem de nome.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<Array<{ funcionario_id: string, nome: string, tipo_medida: string, quantidade: unknown, custo: unknown }>>}
 */
export const somarPorFuncionario = (db, clienteId, empresaId, atividadeId) =>
  db.$queryRaw`SELECT l.funcionario_id, f.nome, l.tipo_medida, SUM(l.quantidade) AS quantidade, SUM(l.custo_total) AS custo
    FROM "AtividadeApontamentoMaoObra" l
    JOIN "AtividadeApontamento" a ON a.cliente_id = l.cliente_id AND a.empresa_id = l.empresa_id AND a.id = l.apontamento_id
    JOIN "Funcionario" f ON f.cliente_id = l.cliente_id AND f.empresa_id = l.empresa_id AND f.id = l.funcionario_id
    WHERE l.cliente_id = ${clienteId} AND l.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
      AND l.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
    GROUP BY l.funcionario_id, f.nome, l.tipo_medida
    ORDER BY f.nome, l.funcionario_id, l.tipo_medida`;
