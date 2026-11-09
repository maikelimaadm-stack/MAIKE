/**
 * D-PROD-157 — Tipos de combustível (catálogo do TENANT, CLASSIFICATÓRIO).
 *
 * Sem preço, custo, saldo nem vínculo com Produto neste slice: o motor de
 * estoque é em KG e combustível em litros não cabe nele hoje (a associação a
 * Produto fica para a P1-02). `unidade` L | m3 escolhida na criação e
 * IMUTÁVEL. Regras comuns do catálogo — ver `familiaPatrimonialService.js`.
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
import { UNIDADES_COMBUSTIVEL } from './patrimonioDominio.js';

export const ENTIDADE = 'TipoCombustivel';

const SELECAO = Object.freeze({ id: true, codigo: true, nome: true, unidade: true, descricao: true, ativo: true, versao: true, createdAt: true, updatedAt: true });

export const naoEncontrado = () => new AppError('COMBUSTIVEL_NAO_ENCONTRADO', 'tipo de combustível não encontrado');

/** Forma pública (sem tenant). */
export const comoCombustivelPublico = (r) => ({
  id: r.id,
  codigo: r.codigo,
  nome: r.nome,
  unidade: r.unidade,
  descricao: r.descricao ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria por allowlist (sem nome nem descrição). */
export const paraAuditoria = (r) => ({ id: r.id, codigo: r.codigo, unidade: r.unidade, ativo: r.ativo, versao: r.versao });
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'ativo']);

const buscar = (db, clienteId, id) => db.tipoCombustivel.findFirst({ where: { cliente_id: clienteId, id }, select: SELECAO });

/** @param {unknown} u */
const exigirUnidade = (u) => {
  if (u === undefined || u === null) return 'L';
  if (typeof u !== 'string' || !UNIDADES_COMBUSTIVEL.includes(u)) throw invalido('unidade deve ser L ou m3', { field: 'unidade', reason: 'unidade_invalida' });
  return u;
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
  if (codigo !== undefined && (await tx.tipoCombustivel.findFirst({ where: { cliente_id: clienteId, codigo, ...fora }, select: { id: true } }))) {
    throw codigoDuplicado();
  }
  if (nome !== undefined && (await tx.tipoCombustivel.findFirst({ where: { cliente_id: clienteId, nome: nomeIgual(nome), ...fora }, select: { id: true } }))) {
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
  const q = termoDeBusca(query.q);
  const busca = q
    ? [{ codigo: { contains: q, mode: 'insensitive' } }, { nome: { contains: q, mode: 'insensitive' } }, { descricao: { contains: q, mode: 'insensitive' } }]
    : [];
  return listarKeyset(getPrismaClient().tipoCombustivel, { where, busca, query, select: SELECAO, mapItem: comoCombustivelPublico });
};

export const detalhar = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const r = await buscar(getPrismaClient(), auth.clienteId, id);
  if (!r) throw naoEncontrado();
  return comoCombustivelPublico(r);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const codigo = codigoDoCorpo(entrada.codigo);
  const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
  const unidade = exigirUnidade(entrada.unidade);
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  return transacao(async (tx) => {
    await travarCatalogo(tx, auth.clienteId);
    await exigirLivre(tx, auth.clienteId, { codigo, nome });
    const r = await tx.tipoCombustivel.create({ data: { cliente_id: auth.clienteId, codigo, nome, unidade, descricao }, select: SELECAO });
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: r.id, dadosNovos: paraAuditoria(r) }, tx);
    return comoCombustivelPublico(r);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    // FOR UPDATE: o bem que vincula este combustível segura a linha com FOR
    // SHARE (A5); inativar e vincular nunca se cruzam com estado velho.
    await tx.$queryRaw`SELECT id FROM "TipoCombustivel" WHERE cliente_id = ${cli} AND id = ${id} FOR UPDATE`;
    const antes = await buscar(tx, cli, id);
    if (!antes) throw naoEncontrado();
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
    if (entrada.ativo !== undefined && entrada.ativo !== antes.ativo) dados.ativo = entrada.ativo;
    if (!Object.keys(dados).length) return comoCombustivelPublico(antes);
    await atualizarComVersao(tx.tipoCombustivel, { clienteId: cli, id, versao: entrada.versao, data: dados });
    const depois = await buscar(tx, cli, id);
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: { ...paraAuditoria(depois), campos_alterados: camposAlterados(antes, depois, CAMPOS_AUDITAVEIS) } },
      tx
    );
    return comoCombustivelPublico(depois);
  });
};

/** Opções de seletor: combustíveis ATIVOS em ordem alfabética, `{id, codigo, nome, unidade}`. */
export const opcoes = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(getPrismaClient().tipoCombustivel, {
    where: { AND: filtros },
    select: { id: true, codigo: true, nome: true, unidade: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, unidade: r.unidade })),
  });
};
