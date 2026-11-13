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

/**
 * Apontamento da EMPRESA com os resumos. Outra empresa e outro tenant dão o
 * mesmo `null` (sem oráculo).
 * @param {any} db  cliente Prisma ou transação
 * @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const buscarApontamento = (db, clienteId, empresaId, id) =>
  db.apontamentoAtividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, include: INCLUIR });

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

/** Estado atual (versão e status) depois de um CAS perdido. */
export const lerVersaoEStatus = (tx, clienteId, empresaId, id) =>
  tx.apontamentoAtividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: { versao: true, status: true } });

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
