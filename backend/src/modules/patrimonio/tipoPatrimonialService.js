/**
 * D-PROD-157 / D-PROD-162 — Tipos patrimoniais (catálogo do TENANT, sem
 * empresa), criados e mantidos DENTRO do cadastro de Bens.
 *
 * Regras (além das comuns do catálogo — ver `familiaPatrimonialService.js`):
 *  - o tipo pertence a UMA família (`familia_id` IMUTÁVEL); a família tem de
 *    existir no tenant e estar ATIVA na criação (senão 422
 *    `BEM_REFERENCIA_INVALIDA` field `familia_id`, reason `inexistente|inativo`);
 *  - nome único DENTRO da família (sem diferenciar maiúsculas); código único no
 *    tenant; sem `codigo` no POST, o servidor o gera do nome (P-05);
 *  - D-PROD-162: os perfis de medição sugeridos saíram (`perfis` no corpo → 400).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import {
  atualizarComVersao, camposAlterados, codigoDisponivel, codigoDoCorpo, codigoDuplicado, comUnicosEstaveis, exigirVersao, lerAtivo, listarKeyset,
  nomeDuplicado, nomeIgual, paginacaoOpcoes, paginarPorNome, termoDeBusca, travarCatalogo,
} from './patrimonioComum.js';

export const ENTIDADE = 'TipoPatrimonial';

const SELECAO = Object.freeze({
  id: true, familia_id: true, codigo: true, nome: true, descricao: true, vida_util_meses_sugerida: true,
  ativo: true, versao: true, createdAt: true, updatedAt: true,
  familia: { select: { id: true, codigo: true, nome: true, natureza: true, ativo: true } },
});

export const naoEncontrado = () => new AppError('TIPO_PATRIMONIAL_NAO_ENCONTRADO', 'tipo patrimonial não encontrado');
const familiaInvalida = (reason) =>
  new AppError('BEM_REFERENCIA_INVALIDA', reason === 'inativo' ? 'a família escolhida está inativa; nada foi gravado' : 'família não encontrada; nada foi gravado', {
    details: { field: 'familia_id', reason },
  });

/** Forma pública (sem tenant). */
export const comoTipoPublico = (r) => ({
  id: r.id,
  familia_id: r.familia_id,
  familia: r.familia ? { id: r.familia.id, codigo: r.familia.codigo, nome: r.familia.nome, natureza: r.familia.natureza, ativo: r.familia.ativo } : null,
  codigo: r.codigo,
  nome: r.nome,
  descricao: r.descricao ?? null,
  vida_util_meses_sugerida: r.vida_util_meses_sugerida ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria por allowlist (ids, código, situação e versão; sem texto livre). */
export const paraAuditoria = (r) => ({
  id: r.id,
  codigo: r.codigo,
  familia_id: r.familia_id,
  ativo: r.ativo,
  versao: r.versao,
});
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'vida_util_meses_sugerida', 'ativo']);

const buscar = (db, clienteId, id) => db.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, id }, select: SELECAO });

/**
 * Código e nome livres (sob a trava do catálogo); campo ausente não é conferido.
 * @param {any} tx
 * @param {string} clienteId
 * @param {{ codigo?: string, nome?: string, familiaId?: string }} campos
 * @param {string|null} [ignorarId]
 */
const exigirLivre = async (tx, clienteId, { codigo, nome, familiaId }, ignorarId = null) => {
  const fora = ignorarId ? { NOT: { id: ignorarId } } : {};
  if (codigo !== undefined && (await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, codigo, ...fora }, select: { id: true } }))) {
    throw codigoDuplicado();
  }
  if (
    nome !== undefined &&
    (await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, familia_id: familiaId, nome: nomeIgual(nome), ...fora }, select: { id: true } }))
  ) {
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
  if (typeof query.familia_id === 'string' && query.familia_id) where.familia_id = query.familia_id;
  const q = termoDeBusca(query.q);
  const busca = q
    ? [{ codigo: { contains: q, mode: 'insensitive' } }, { nome: { contains: q, mode: 'insensitive' } }, { descricao: { contains: q, mode: 'insensitive' } }]
    : [];
  return listarKeyset(getPrismaClient().tipoPatrimonial, { where, busca, query, select: SELECAO, mapItem: comoTipoPublico });
};

export const detalhar = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const r = await buscar(getPrismaClient(), auth.clienteId, id);
  if (!r) throw naoEncontrado();
  return comoTipoPublico(r);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const codigoInformado = entrada.codigo === undefined ? null : codigoDoCorpo(entrada.codigo);
  const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    if (typeof entrada.familia_id !== 'string' || !entrada.familia_id) throw familiaInvalida('inexistente');
    const familia = await tx.familiaPatrimonial.findFirst({ where: { cliente_id: cli, id: entrada.familia_id }, select: { id: true, natureza: true, ativo: true } });
    if (!familia) throw familiaInvalida('inexistente');
    if (!familia.ativo) throw familiaInvalida('inativo');
    await exigirLivre(tx, cli, { ...(codigoInformado ? { codigo: codigoInformado } : {}), nome, familiaId: familia.id });
    const codigo = codigoInformado ?? (await codigoDisponivel(tx, cli, 'tipoPatrimonial', nome));
    const criado = await tx.tipoPatrimonial.create({
      data: { cliente_id: cli, familia_id: familia.id, codigo, nome, descricao, vida_util_meses_sugerida: entrada.vida_util_meses_sugerida ?? null },
      select: { id: true },
    });
    const r = await buscar(tx, cli, criado.id);
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: r.id, dadosNovos: paraAuditoria(r) }, tx);
    return comoTipoPublico(r);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    await tx.$queryRaw`SELECT id FROM "TipoPatrimonial" WHERE cliente_id = ${cli} AND id = ${id} FOR UPDATE`;
    const antes = await buscar(tx, cli, id);
    if (!antes) throw naoEncontrado();
    exigirVersao(antes, entrada.versao);
    /** @type {Record<string, unknown>} */
    const dados = {};
    if (entrada.nome !== undefined) {
      const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
      if (nome !== antes.nome) {
        if (nome.toLowerCase() !== antes.nome.toLowerCase()) await exigirLivre(tx, cli, { nome, familiaId: antes.familia_id }, id);
        dados.nome = nome;
      }
    }
    if (entrada.descricao !== undefined) {
      const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
      if (descricao !== (antes.descricao ?? null)) dados.descricao = descricao;
    }
    if (entrada.vida_util_meses_sugerida !== undefined && (entrada.vida_util_meses_sugerida ?? null) !== (antes.vida_util_meses_sugerida ?? null)) {
      dados.vida_util_meses_sugerida = entrada.vida_util_meses_sugerida ?? null;
    }
    if (entrada.ativo !== undefined && entrada.ativo !== antes.ativo) dados.ativo = entrada.ativo;
    if (!Object.keys(dados).length) return comoTipoPublico(antes);
    await atualizarComVersao(tx.tipoPatrimonial, { clienteId: cli, id, versao: entrada.versao, data: dados });
    const depois = await buscar(tx, cli, id);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: paraAuditoria(antes),
        dadosNovos: { ...paraAuditoria(depois), campos_alterados: camposAlterados(antes, depois, CAMPOS_AUDITAVEIS) },
      },
      tx
    );
    return comoTipoPublico(depois);
  });
};

/**
 * Opções de seletor: tipos ATIVOS (filtro `familia_id`), em ordem alfabética,
 * `{id, codigo, nome, familia_id}`.
 */
export const opcoes = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (typeof query.familia_id === 'string' && query.familia_id) filtros.push({ familia_id: query.familia_id });
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(getPrismaClient().tipoPatrimonial, {
    where: { AND: filtros },
    select: { id: true, codigo: true, nome: true, familia_id: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, familia_id: r.familia_id })),
  });
};
