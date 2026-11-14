/**
 * Repositório de ApontamentoAtividade (D-PROD-190, Fatia C).
 *
 * Adaptador de dados, sem regra: leitura pela empresa do tenant (`cliente_id`
 * vem SEMPRE do auth_context), listagem keyset, gravação na transação de quem
 * chama e as leituras curtas dos cadastros apontados (tipo, bem, usuário,
 * área, centros e tarefa), que o serviço confere antes de gravar.
 *
 * Nenhum módulo ANTIGO importa daqui para consultar a tabela nova (lição do
 * hotfix #259): a exclusão de um cadastro apontado é barrada pela FK RESTRICT,
 * traduzida em `shared/errors/vinculoApontamentoAtividade.js`.
 *
 * D-PROD-191 (Fatia D) — itens do apontamento: a trava da linha do apontamento
 * (serializa todo comando de item e o cancelamento), a leitura dos itens e das
 * fatias FIFO, o INSERT do item e das fatias e o cancelamento dos itens com CAS.
 * Este módulo pode assumir as tabelas novas (a migration sobe ANTES do código).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { listarKeyset } from '../patrimonio/patrimonioComum.js';

/** Resumos dos cadastros apontados (só exibição; o login do usuário é credencial e nunca sai). */
const BEM_RESUMO = Object.freeze({ select: { id: true, numero: true, codigo_frota: true, nome: true, natureza: true } });
const USUARIO_RESUMO = Object.freeze({ select: { id: true, nome: true } });
const CENTRO_RESUMO = Object.freeze({ select: { id: true, numero: true, nome: true } });

export const INCLUIR = Object.freeze({
  bem: BEM_RESUMO,
  implemento: BEM_RESUMO,
  operador: USUARIO_RESUMO,
  area: { select: { id: true, numero_area: true, nome: true } },
  centroCusto: CENTRO_RESUMO,
  centroResultado: CENTRO_RESUMO,
  lancamentoTarefa: { select: { id: true, titulo: true, status: true } },
  criadoPor: USUARIO_RESUMO,
  canceladoPor: USUARIO_RESUMO,
});

/** Fatias FIFO do item PRODUTO, na ordem gravada. */
const FATIAS = Object.freeze({
  orderBy: { ordem: /** @type {const} */ ('asc') },
  select: { ordem: true, estoque_lote_nota_id: true, quantidade: true, custo_unitario: true },
});
const MOVIMENTO_RESUMO = Object.freeze({ select: { id: true, numero_movimentacao: true } });

/** D-PROD-191 — itens do DETALHE (A1–A4), em ordem, inclusive os cancelados (histórico). */
export const INCLUIR_DETALHE = Object.freeze({
  ...INCLUIR,
  itens: {
    orderBy: { ordem: /** @type {const} */ ('asc') },
    include: {
      produto: { select: { id: true, nome_produto: true, unidade_principal_estoque: true } },
      localEstoque: { select: { id: true, nome: true } },
      movimentacao: MOVIMENTO_RESUMO,
      movimentacaoEstorno: MOVIMENTO_RESUMO,
      consumos: FATIAS,
      criadoPor: USUARIO_RESUMO,
      canceladoPor: USUARIO_RESUMO,
    },
  },
});

/**
 * Apontamento da EMPRESA com os resumos. Outra empresa e outro tenant dão o
 * mesmo `null` (sem oráculo).
 * @param {any} db  cliente Prisma ou transação
 * @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const buscarApontamento = (db, clienteId, empresaId, id) =>
  db.apontamentoAtividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, include: INCLUIR });

/**
 * D-PROD-191 — apontamento da EMPRESA com os resumos e os itens (detalhe).
 * @param {any} db  cliente Prisma ou transação
 * @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const buscarApontamentoComItens = (db, clienteId, empresaId, id) =>
  db.apontamentoAtividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, include: INCLUIR_DETALHE });

/**
 * D-PROD-191 (I-c) — trava a linha do apontamento (`FOR UPDATE`) ANTES de ler
 * itens, locais ou produtos: serializa os comandos de item e o cancelamento.
 * Outra empresa e outro tenant = inexistente (`false`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 * @returns {Promise<boolean>}
 */
export const travarApontamento = async (tx, clienteId, empresaId, id) => {
  const linhas = /** @type {any[]} */ (
    await tx.$queryRaw`SELECT id FROM "ApontamentoAtividade" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`
  );
  return linhas.length === 1;
};

/**
 * Lista keyset (createdAt desc, id desc) — índice (cliente_id, empresa_id, createdAt, id).
 * @param {{ where: Record<string, unknown>, busca: any[], query: Record<string, any>, mapItem: (r: any) => any }} pedido
 */
export const listarApontamentos = ({ where, busca, query, mapItem }) =>
  listarKeyset(getPrismaClient().apontamentoAtividade, { where, busca, query, include: INCLUIR, mapItem });

/** @param {any} tx @param {Record<string, unknown>} dados */
export const inserirApontamento = (tx, dados) => tx.apontamentoAtividade.create({ data: dados, select: { id: true } });

/**
 * UPDATE com CAS por `versao` e só sobre apontamento CONFIRMADO; incrementa a
 * versão uma vez. Devolve a contagem (0 = perdeu a corrida ou já cancelado).
 * @param {any} tx @param {{ clienteId: string, empresaId: string, id: string, versao: number, statusEsperado: string, dados: Record<string, unknown> }} pedido
 */
export const atualizarComVersao = async (tx, { clienteId, empresaId, id, versao, statusEsperado, dados }) => {
  const r = await tx.apontamentoAtividade.updateMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, id, versao, status: statusEsperado },
    data: { ...dados, versao: { increment: 1 } },
  });
  return r.count;
};

/**
 * D-PROD-191 — o essencial do apontamento para os comandos de item (lido DEPOIS
 * de `travarApontamento`): número e data (documento do movimento), status e versão.
 */
export const lerApontamentoBase = (tx, clienteId, empresaId, id) =>
  tx.apontamentoAtividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id },
    select: { id: true, empresa_id: true, numero: true, status: true, versao: true, data_operacional: true },
  });

/** Estado atual (versão e status) depois de um CAS perdido. */
export const lerVersaoEStatus = (tx, clienteId, empresaId, id) =>
  tx.apontamentoAtividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: { versao: true, status: true } });

// ─── itens (D-PROD-191) ─────────────────────────────────────────────────────

/**
 * Quantos itens o apontamento tem (CONFIRMADO + CANCELADO) e a maior `ordem`
 * (nunca reaproveitada). Lido SOB a trava do apontamento.
 * @returns {Promise<{ total: number, maiorOrdem: number }>}
 */
export const resumoDosItens = async (tx, clienteId, empresaId, apontamentoId) => {
  const r = await tx.apontamentoAtividadeItem.aggregate({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId },
    _count: { _all: true },
    _max: { ordem: true },
  });
  return { total: r._count._all, maiorOrdem: r._max.ordem ?? 0 };
};

/**
 * Itens do apontamento com as fatias FIFO (para o estorno), em ordem. `filtro`
 * restringe (ex.: `{ status: 'CONFIRMADO' }` ou `{ id }`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {Record<string, unknown>} [filtro]
 */
export const lerItensComFatias = (tx, clienteId, empresaId, apontamentoId, filtro = {}) =>
  tx.apontamentoAtividadeItem.findMany({
    where: { ...filtro, cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId },
    orderBy: { ordem: 'asc' },
    include: { consumos: FATIAS },
  });

/**
 * D-1 (D-PROD-191): itens PRODUTO CONFIRMADO do apontamento (o PATCH lê sem
 * trava; o CAS por `versao` o protege de um item que entre depois).
 */
export const contarItensProdutoConfirmados = (tx, clienteId, empresaId, apontamentoId) =>
  tx.apontamentoAtividadeItem.count({
    where: { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: apontamentoId, tipo: 'PRODUTO', status: 'CONFIRMADO' },
  });

/** @param {any} tx @param {Record<string, unknown>} dados */
export const inserirItem = (tx, dados) => tx.apontamentoAtividadeItem.create({ data: dados, select: { id: true } });

/** @param {any} tx @param {Array<Record<string, unknown>>} fatias */
export const inserirFatias = (tx, fatias) => (fatias.length ? tx.apontamentoAtividadeItemConsumoLote.createMany({ data: fatias }) : Promise.resolve({ count: 0 }));

/**
 * CONFIRMADO → CANCELADO numa instrução, com CAS (`status = 'CONFIRMADO'`):
 * cada item leva o SEU estorno (null em SERVICO/OUTRO). Devolve a contagem
 * (quem chama confere = nº de itens). `agora` em UTC na coluna TIMESTAMP(3).
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, apontamentoId: string, itens: Array<{ id: string, estorno: string|null }>,
 *   motivo: string, origem: 'ITEM'|'APONTAMENTO', usuarioId: string|null, agora: Date }} pedido
 * @returns {Promise<number>}
 */
export const cancelarItensConfirmados = async (tx, { clienteId, empresaId, apontamentoId, itens, motivo, origem, usuarioId, agora }) => {
  if (!itens.length) return 0;
  const instante = agora.toISOString();
  return tx.$executeRaw`UPDATE "ApontamentoAtividadeItem" AS i
    SET status = 'CANCELADO', movimentacao_estorno_id = v.estorno, cancelado_em = ${instante}::timestamp, cancelado_por_usuario_id = ${usuarioId},
        motivo_cancelamento = ${motivo}, cancelamento_origem = ${origem}, "updatedAt" = ${instante}::timestamp
    FROM unnest(${itens.map((x) => x.id)}::text[], ${itens.map((x) => x.estorno)}::text[]) AS v(id, estorno)
    WHERE i.cliente_id = ${clienteId} AND i.empresa_id = ${empresaId} AND i.apontamento_id = ${apontamentoId} AND i.id = v.id AND i.status = 'CONFIRMADO'`;
};

// ─── cadastros apontados (leituras curtas, no tenant da sessão) ─────────────

/** Tipo de atividade com o grupo em cache (fonte dos snapshots, R-h). */
export const lerTipoAtividade = (tx, clienteId, id) =>
  tx.tipoAtividade.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { id: true, nome_tipo: true, grupo_atividade_id: true, grupo_atividade_nome: true, ativo: true },
  });

/** Bem (máquina/veículo ou implemento): empresa e situação. */
export const lerBem = (tx, clienteId, id) =>
  tx.bemPatrimonial.findFirst({ where: { cliente_id: clienteId, id }, select: { empresa_id: true, ativo: true } });

/**
 * Centro de custo do cadastro do bem (fonte da cópia na CRIAÇÃO, R-e), lido
 * pela chave da empresa do tenant: id e situação do centro, ou `null` se o bem
 * não tem centro (ou não é desta empresa). A FK composta do bem garante que o
 * centro é da mesma empresa.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} bemId
 * @returns {Promise<{ id: string, ativo: boolean } | null>}
 */
export const lerCentroCustoDoBem = async (tx, clienteId, empresaId, bemId) => {
  const bem = await tx.bemPatrimonial.findUnique({
    where: { cliente_id_empresa_id_id: { cliente_id: clienteId, empresa_id: empresaId, id: bemId } },
    select: { centroCusto: { select: { id: true, ativo: true } } },
  });
  return bem?.centroCusto ?? null;
};

/** Usuário do tenant (operador): situação. */
export const lerUsuario = (tx, clienteId, id) =>
  tx.usuario.findFirst({ where: { cliente_id: clienteId, id }, select: { ativo: true } });

/** Área: empresa e situação (a tabela antiga só tem unique (cliente_id, id)). */
export const lerArea = (tx, clienteId, id) =>
  tx.areaPastagem.findFirst({ where: { cliente_id: clienteId, id }, select: { empresa_id: true, ativo: true } });

/** @param {'custo'|'resultado'} lado */
export const lerCentro = (tx, lado, clienteId, id) =>
  (lado === 'custo' ? tx.centroCusto : tx.centroResultado).findFirst({ where: { cliente_id: clienteId, id }, select: { empresa_id: true, ativo: true } });

/** Lançamento de tarefa (a demanda): empresa (a tabela antiga só tem unique (cliente_id, id)). */
export const lerLancamentoTarefa = (tx, clienteId, id) =>
  tx.lancamentoTarefa.findFirst({ where: { cliente_id: clienteId, id }, select: { empresa_id: true } });
