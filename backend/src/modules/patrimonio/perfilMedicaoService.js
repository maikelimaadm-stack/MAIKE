/**
 * D-PROD-156 — Perfis de medição física (catálogo do TENANT, sem empresa).
 *
 * Regras (além das comuns do catálogo — ver `familiaPatrimonialService.js`):
 *  - `dimensao` e `finalidade` escolhidas na criação e IMUTÁVEIS (A9);
 *  - `unidade_canonica` DERIVADA da dimensão (nunca vem do corpo);
 *  - `unidades_permitidas` ⊂ unidades da dimensão, sem repetição e sempre com a
 *    canônica (422 `PERFIL_UNIDADES_INVALIDAS`); gravadas na ordem da dimensão;
 *  - remover unidade usada por medição de bem → 409 `PERFIL_UNIDADE_EM_USO`.
 *    A linha do perfil é travada (FOR UPDATE) antes da contagem: um bem que
 *    grava medição segura a mesma linha com FOR SHARE (A5), então nenhuma das
 *    duas escritas vê o estado velho da outra.
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
import { FINALIDADES_PERFIL, NOMES_DIMENSOES } from './patrimonioDominio.js';
import { unidadeCanonicaDe, validarUnidadesPermitidas } from './unidadesFisicas.js';

export const ENTIDADE = 'PerfilMedicao';

const SELECAO = Object.freeze({
  id: true, codigo: true, nome: true, dimensao: true, finalidade: true, unidade_canonica: true, unidades_permitidas: true,
  descricao: true, ativo: true, versao: true, createdAt: true, updatedAt: true,
});

export const naoEncontrado = () => new AppError('PERFIL_MEDICAO_NAO_ENCONTRADO', 'perfil de medição não encontrado');

/** Forma pública (sem tenant). */
export const comoPerfilPublico = (r) => ({
  id: r.id,
  codigo: r.codigo,
  nome: r.nome,
  dimensao: r.dimensao,
  finalidade: r.finalidade,
  unidade_canonica: r.unidade_canonica,
  unidades_permitidas: [...(r.unidades_permitidas ?? [])],
  descricao: r.descricao ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria por allowlist (sem nome nem descrição). */
export const paraAuditoria = (r) => ({
  id: r.id,
  codigo: r.codigo,
  dimensao: r.dimensao,
  finalidade: r.finalidade,
  unidades_permitidas: [...(r.unidades_permitidas ?? [])],
  ativo: r.ativo,
  versao: r.versao,
});
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'unidades_permitidas', 'ativo']);

const buscar = (db, clienteId, id) => db.perfilMedicao.findFirst({ where: { cliente_id: clienteId, id }, select: SELECAO });

/** @param {unknown} d */
const exigirDimensao = (d) => {
  if (typeof d !== 'string' || !NOMES_DIMENSOES.includes(d)) throw invalido('dimensão inválida', { field: 'dimensao', reason: 'dimensao_invalida' });
  return d;
};
/** @param {unknown} f */
const exigirFinalidade = (f) => {
  if (typeof f !== 'string' || !FINALIDADES_PERFIL.includes(f)) throw invalido('finalidade inválida', { field: 'finalidade', reason: 'finalidade_invalida' });
  return f;
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
  if (codigo !== undefined && (await tx.perfilMedicao.findFirst({ where: { cliente_id: clienteId, codigo, ...fora }, select: { id: true } }))) {
    throw codigoDuplicado();
  }
  if (nome !== undefined && (await tx.perfilMedicao.findFirst({ where: { cliente_id: clienteId, nome: nomeIgual(nome), ...fora }, select: { id: true } }))) {
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
  return listarKeyset(getPrismaClient().perfilMedicao, { where, busca, query, select: SELECAO, mapItem: comoPerfilPublico });
};

export const detalhar = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const r = await buscar(getPrismaClient(), auth.clienteId, id);
  if (!r) throw naoEncontrado();
  return comoPerfilPublico(r);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const codigo = codigoDoCorpo(entrada.codigo);
  const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
  const dimensao = exigirDimensao(entrada.dimensao);
  const finalidade = exigirFinalidade(entrada.finalidade);
  const unidades = validarUnidadesPermitidas(dimensao, entrada.unidades_permitidas);
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  return transacao(async (tx) => {
    await travarCatalogo(tx, auth.clienteId);
    await exigirLivre(tx, auth.clienteId, { codigo, nome });
    const r = await tx.perfilMedicao.create({
      data: { cliente_id: auth.clienteId, codigo, nome, dimensao, finalidade, unidade_canonica: unidadeCanonicaDe(dimensao), unidades_permitidas: unidades, descricao },
      select: SELECAO,
    });
    await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: r.id, dadosNovos: paraAuditoria(r) }, tx);
    return comoPerfilPublico(r);
  });
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    await tx.$queryRaw`SELECT id FROM "PerfilMedicao" WHERE cliente_id = ${cli} AND id = ${id} FOR UPDATE`;
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
    if (entrada.unidades_permitidas !== undefined) {
      const unidades = validarUnidadesPermitidas(antes.dimensao, entrada.unidades_permitidas);
      if (unidades.join(',') !== antes.unidades_permitidas.join(',')) {
        const removidas = antes.unidades_permitidas.filter((u) => !unidades.includes(u));
        if (removidas.length) {
          const emUso = await tx.medicaoBem.groupBy({
            by: ['unidade_informada'],
            where: { cliente_id: cli, perfil_id: id, unidade_informada: { in: removidas } },
            _count: { _all: true },
          });
          if (emUso.length) {
            throw new AppError('PERFIL_UNIDADE_EM_USO', 'há medições de bens nesta unidade; ela não pode sair do perfil; nada foi gravado', {
              details: { field: 'unidades_permitidas', reason: 'unidade_em_uso', unidades: emUso.map((u) => u.unidade_informada).sort() },
            });
          }
        }
        dados.unidades_permitidas = unidades;
      }
    }
    if (entrada.ativo !== undefined && entrada.ativo !== antes.ativo) dados.ativo = entrada.ativo;
    if (!Object.keys(dados).length) return comoPerfilPublico(antes);
    await atualizarComVersao(tx.perfilMedicao, { clienteId: cli, id, versao: entrada.versao, data: dados });
    const depois = await buscar(tx, cli, id);
    await registrarEvento(
      contexto,
      { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: { ...paraAuditoria(depois), campos_alterados: camposAlterados(antes, depois, CAMPOS_AUDITAVEIS) } },
      tx
    );
    return comoPerfilPublico(depois);
  });
};

/**
 * Opções de seletor: perfis ATIVOS em ordem alfabética,
 * `{id, codigo, nome, dimensao, finalidade, unidade_canonica, unidades_permitidas}`.
 */
export const opcoes = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(getPrismaClient().perfilMedicao, {
    where: { AND: filtros },
    select: { id: true, codigo: true, nome: true, dimensao: true, finalidade: true, unidade_canonica: true, unidades_permitidas: true },
    limit,
    cursor,
    mapear: (linhas) =>
      linhas.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        dimensao: r.dimensao,
        finalidade: r.finalidade,
        unidade_canonica: r.unidade_canonica,
        unidades_permitidas: [...r.unidades_permitidas],
      })),
  });
};
