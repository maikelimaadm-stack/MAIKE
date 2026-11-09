/**
 * D-PROD-156 — Famílias patrimoniais (catálogo do TENANT, sem empresa).
 *
 * Regras:
 *  - `cliente_id` só da sessão; registro de outro tenant = mesmo 404 de inexistente;
 *  - `codigo` (MAIÚSCULAS, `^[A-Z0-9_]{2,32}$`) e `natureza` escolhidos na
 *    criação e IMUTÁVEIS (fora do schema do PATCH);
 *  - código e nome únicos no tenant (nome sem diferenciar maiúsculas, pré-checado
 *    sob a trava do catálogo; o unique do banco é a última barreira);
 *  - toda escrita sob `travarCatalogo` (A9); PATCH com CAS por `versao`; PATCH
 *    sem mudança efetiva devolve o atual sem gravar, auditar nem incrementar;
 *  - sem exclusão física: inativar mantém a família legível nos bens antigos
 *    e a tira das opções de cadastro;
 *  - auditoria por allowlist na mesma transação (ids, código, natureza,
 *    situação, versão e NOMES dos campos alterados — sem texto livre).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { invalido, iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import {
  atualizarComVersao, camposAlterados, codigoDoCorpo, codigoDuplicado, comUnicosEstaveis, exigirVersao, lerAtivo, listarKeyset,
  nomeDuplicado, nomeIgual, paginacaoOpcoes, paginarPorNome, termoDeBusca, travarCatalogo,
} from './patrimonioComum.js';
import { NATUREZAS } from './patrimonioDominio.js';

export const ENTIDADE = 'FamiliaPatrimonial';

const SELECAO = Object.freeze({
  id: true, codigo: true, nome: true, natureza: true, descricao: true, ordem: true, vida_util_meses_padrao: true,
  ativo: true, versao: true, createdAt: true, updatedAt: true,
});

export const naoEncontrada = () => new AppError('FAMILIA_PATRIMONIAL_NAO_ENCONTRADA', 'família patrimonial não encontrada');

/** Forma pública (sem tenant). */
export const comoFamiliaPublica = (r) => ({
  id: r.id,
  codigo: r.codigo,
  nome: r.nome,
  natureza: r.natureza,
  descricao: r.descricao ?? null,
  ordem: r.ordem ?? null,
  vida_util_meses_padrao: r.vida_util_meses_padrao ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria por allowlist (sem nome nem descrição). */
export const paraAuditoria = (r) => ({ id: r.id, codigo: r.codigo, natureza: r.natureza, ativo: r.ativo, versao: r.versao });
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'ordem', 'vida_util_meses_padrao', 'ativo']);

const buscar = (db, clienteId, id) => db.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, id }, select: SELECAO });

/** @param {unknown} n */
const exigirNatureza = (n) => {
  if (typeof n !== 'string' || !NATUREZAS.includes(n)) throw invalido('natureza inválida', { field: 'natureza', reason: 'natureza_invalida' });
  return n;
};

/**
 * Código e nome livres (sob a trava do catálogo); campo ausente não é conferido.
 * @param {any} tx
 * @param {string} clienteId
 * @param {{ codigo?: string, nome?: string }} campos
 * @param {string|null} [ignorarId]
 */
const exigirLivre = async (tx, clienteId, { codigo, nome }, ignorarId = null) => {
  const fora = ignorarId ? { NOT: { id: ignorarId } } : {};
  if (codigo !== undefined && (await tx.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, codigo, ...fora }, select: { id: true } }))) {
    throw codigoDuplicado();
  }
  if (nome !== undefined && (await tx.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, nome: nomeIgual(nome), ...fora }, select: { id: true } }))) {
    throw nomeDuplicado();
  }
};

const ESTAVEIS = Object.freeze({ codigo: codigoDuplicado, nome: nomeDuplicado });
const transacao = (fn) => comUnicosEstaveis(() => emTransacao(TRANSACAO_CURTA, fn, {}, MENSAGEM_CONFLITO_SEM_CHAVE), ESTAVEIS);

export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId };
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  if (query.natureza !== undefined) where.natureza = exigirNatureza(query.natureza);
  const q = termoDeBusca(query.q);
  const busca = q
    ? [{ codigo: { contains: q, mode: 'insensitive' } }, { nome: { contains: q, mode: 'insensitive' } }, { descricao: { contains: q, mode: 'insensitive' } }]
    : [];
  return listarKeyset(getPrismaClient().familiaPatrimonial, { where, busca, query, select: SELECAO, mapItem: comoFamiliaPublica });
};

export const detalhar = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const r = await buscar(getPrismaClient(), auth.clienteId, id);
  if (!r) throw naoEncontrada();
  return comoFamiliaPublica(r);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const codigo = codigoDoCorpo(entrada.codigo);
  const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
  const natureza = exigirNatureza(entrada.natureza);
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  return transacao(async (tx) => {
    await travarCatalogo(tx, auth.clienteId);
    await exigirLivre(tx, auth.clienteId, { codigo, nome });
    const r = await tx.familiaPatrimonial.create({
      data: {
        cliente_id: auth.clienteId,
        codigo,
        nome,
        natureza,
        descricao,
        ordem: entrada.ordem ?? null,
        vida_util_meses_padrao: entrada.vida_util_meses_padrao ?? null,
      },
      select: SELECAO,
    });
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: r.id, dadosNovos: paraAuditoria(r) }, tx);
    return comoFamiliaPublica(r);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    await tx.$queryRaw`SELECT id FROM "FamiliaPatrimonial" WHERE cliente_id = ${cli} AND id = ${id} FOR UPDATE`;
    const antes = await buscar(tx, cli, id);
    if (!antes) throw naoEncontrada();
    exigirVersao(antes, entrada.versao);
    /** @type {Record<string, unknown>} */
    const dados = {};
    if (entrada.nome !== undefined) {
      const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
      if (nome !== antes.nome) {
        if (nome.toLowerCase() !== antes.nome.toLowerCase()) await exigirLivre(tx, cli, { nome }, id);
        dados.nome = nome;
      }
    }
    if (entrada.descricao !== undefined) {
      const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
      if (descricao !== (antes.descricao ?? null)) dados.descricao = descricao;
    }
    if (entrada.ordem !== undefined && (entrada.ordem ?? null) !== (antes.ordem ?? null)) dados.ordem = entrada.ordem ?? null;
    if (entrada.vida_util_meses_padrao !== undefined && (entrada.vida_util_meses_padrao ?? null) !== (antes.vida_util_meses_padrao ?? null)) {
      dados.vida_util_meses_padrao = entrada.vida_util_meses_padrao ?? null;
    }
    if (entrada.ativo !== undefined && entrada.ativo !== antes.ativo) dados.ativo = entrada.ativo;
    if (!Object.keys(dados).length) return comoFamiliaPublica(antes);
    await atualizarComVersao(tx.familiaPatrimonial, { clienteId: cli, id, versao: entrada.versao, data: dados });
    const depois = await buscar(tx, cli, id);
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: { ...paraAuditoria(depois), campos_alterados: camposAlterados(antes, depois, CAMPOS_AUDITAVEIS) } },
      tx
    );
    return comoFamiliaPublica(depois);
  });
};

/** Opções de seletor: famílias ATIVAS em ordem alfabética, `{id, codigo, nome, natureza}`. */
export const opcoes = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(getPrismaClient().familiaPatrimonial, {
    where: { AND: filtros },
    select: { id: true, codigo: true, nome: true, natureza: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, natureza: r.natureza })),
  });
};
