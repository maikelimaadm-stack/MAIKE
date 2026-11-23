/**
 * Repositório de TipoAtividade (D-PROD-182).
 *
 * Espelho do repositório de TipoTarefa (D-PROD-45): lista completa do tenant,
 * leitura pela chave composta (cliente_id, id) e escrita sempre em transação.
 *
 * D-PROD-197 — padrões e flags: toda leitura e toda escrita devolvem, ao lado
 * dos ids, o resumo dos 3 cadastros apontados (centro de custo, centro de
 * resultado e unidade de produção) pelo `select` aninhado do Prisma: a lista
 * carrega cada relação numa consulta só para todas as linhas (sem N+1). E as
 * leituras curtas que o serviço confere antes de gravar (centro e unidade do
 * tenant) e as opções de centro ATIVO da empresa para o formulário.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';

/** Resumo do centro padrão (custo ou resultado): exibição e herança (empresa e situação). */
const CENTRO_PADRAO = Object.freeze({ select: { id: true, numero: true, nome: true, empresa_id: true, ativo: true } });
/** Resumo da unidade de produção (UnidadeMedida do tenant). */
const UNIDADE_PRODUCAO = Object.freeze({ select: { id: true, sigla: true, descricao: true, ativo: true } });

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  nome_tipo: true,
  grupo_atividade_id: true,
  grupo_atividade_nome: true,
  ativo: true,
  descricao: true,
  // D-PROD-197 — padrões (com o resumo de cada cadastro) e flags.
  categoria: true,
  centro_custo_padrao_id: true,
  centro_resultado_padrao_id: true,
  unidade_producao_id: true,
  coeficiente_padrao: true,
  exige_area: true,
  exige_safra: true,
  exige_maquina: true,
  permite_implemento: true,
  permite_produto: true,
  permite_servico: true,
  permite_mao_obra: true,
  exige_producao: true,
  alvo: true,
  centroCustoPadrao: CENTRO_PADRAO,
  centroResultadoPadrao: CENTRO_PADRAO,
  unidadeProducao: UNIDADE_PRODUCAO,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarTipos = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.tipoAtividade.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarTipo = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.tipoAtividade.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} grupoId
 * @param {string} nomeNormalizado
 * @param {string} [ignorarId]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const existeTipoComNomeNoGrupo = async (clienteId, grupoId, nomeNormalizado, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.tipoAtividade.findFirst({
    where: {
      cliente_id: clienteId,
      grupo_atividade_id: grupoId,
      nome_tipo: nomeNormalizado,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirTipo = async (tx, dados) => tx.tipoAtividade.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarTipoPorId = async (tx, clienteId, id, dados) =>
  tx.tipoAtividade.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/**
 * Exclusão física. O retorno não é usado (a auditoria grava o registro lido
 * antes): seleciona só o id, sem reler os cadastros apontados.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export const excluirTipoPorId = async (tx, clienteId, id) =>
  tx.tipoAtividade.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { id: true },
  });

// ─── D-PROD-197: cadastros apontados pelos padrões (leituras curtas, no tenant da sessão) ───

/**
 * Centro padrão (custo ou resultado) pela chave do TENANT: empresa e situação.
 * Id de outro tenant dá o mesmo `null` do inexistente (sem oráculo).
 * @param {any} tx @param {'custo'|'resultado'} lado @param {string} clienteId @param {string} id
 * @returns {Promise<{ empresa_id: string, ativo: boolean } | null>}
 */
export const lerCentroPadrao = (tx, lado, clienteId, id) =>
  (lado === 'custo' ? tx.centroCusto : tx.centroResultado).findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { empresa_id: true, ativo: true },
  });

/**
 * Unidade de produção (UnidadeMedida) pela chave do TENANT: situação.
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ ativo: boolean } | null>}
 */
export const lerUnidadePadrao = (tx, clienteId, id) =>
  tx.unidadeMedida.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { ativo: true },
  });

/** Tabela física de cada lado: identificador FIXO, nunca vindo da requisição. */
const TABELA_DO_CENTRO = Object.freeze({ custo: Prisma.raw('"CentroCusto"'), resultado: Prisma.raw('"CentroResultado"') });

/**
 * Centros ATIVOS da empresa (opções do formulário): `{ id, numero, nome }`,
 * no máximo `limite` (filtro no índice `(cliente_id, empresa_id, ativo)`).
 *
 * Ordem pelo VALOR do número: o `numero` é texto da sequência do tenant
 * ("2" vem antes de "10"); o texto que não for só dígitos vem depois, pela
 * ordem do texto; empate pelo id. A ordem e o LIMIT são a MESMA (no banco):
 * acima do teto saem os primeiros pelo número, nunca os primeiros pelo texto.
 * @param {'custo'|'resultado'} lado @param {string} clienteId @param {string} empresaId @param {number} limite
 * @returns {Promise<Array<{ id: string, numero: string, nome: string }>>}
 */
export const listarCentrosAtivosDaEmpresa = async (lado, clienteId, empresaId, limite) => {
  const tabela = TABELA_DO_CENTRO[lado];
  if (!tabela) throw new TypeError(`lado de centro desconhecido: ${String(lado)}`);
  const linhas = /** @type {Array<{ id: string, numero: string, nome: string }>} */ (
    await getPrismaClient().$queryRaw`
      SELECT id, numero, nome
        FROM ${tabela}
       WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND ativo = true
       ORDER BY CASE WHEN numero ~ '^[0-9]+$' THEN numero::numeric END ASC NULLS LAST, numero ASC, id ASC
       LIMIT ${limite}`
  );
  return linhas;
};
