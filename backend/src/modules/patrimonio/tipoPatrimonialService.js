/**
 * D-PROD-157 — Tipos patrimoniais (catálogo do TENANT, sem empresa).
 *
 * Regras (além das comuns do catálogo — ver `familiaPatrimonialService.js`):
 *  - o tipo pertence a UMA família (`familia_id` IMUTÁVEL); a família tem de
 *    existir no tenant e estar ATIVA na criação (senão 422
 *    `BEM_REFERENCIA_INVALIDA` field `familia_id`, reason `inexistente|inativo`);
 *  - nome único DENTRO da família (sem diferenciar maiúsculas); código único no tenant;
 *  - `perfis: [{perfil_id, principal?}]` é SYNC COMPLETO dos perfis de medição
 *    sugeridos, só para família BENFEITORIA (senão 422 `TIPO_PERFIS_NAO_APLICAVEIS`);
 *    até 10, sem repetição, no máximo 1 principal, perfil ATIVO ao ser
 *    acrescentado (manter um já vinculado e depois inativado é permitido) →
 *    senão 422 `TIPO_PERFIS_INVALIDOS` com `reason`;
 *  - o sync roda em duas fases para o `principal` (A5): remove os ausentes,
 *    zera o principal dos mantidos, atualiza a ordem, cria os novos e só então
 *    marca o principal — trocar o principal entre dois perfis nunca colide no
 *    unique `(cliente_id, tipo_id, principal)`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import {
  atualizarComVersao, camposAlterados, codigoDoCorpo, codigoDuplicado, comUnicosEstaveis, exigirVersao, lerAtivo, listarKeyset,
  nomeDuplicado, nomeIgual, paginacaoOpcoes, paginarPorNome, termoDeBusca, travarCatalogo,
} from './patrimonioComum.js';
import { MAX_PERFIS_POR_TIPO } from './patrimonioDominio.js';

export const ENTIDADE = 'TipoPatrimonial';

const SELECAO = Object.freeze({
  id: true, familia_id: true, codigo: true, nome: true, descricao: true, vida_util_meses_sugerida: true,
  ativo: true, versao: true, createdAt: true, updatedAt: true,
  familia: { select: { id: true, codigo: true, nome: true, natureza: true, ativo: true } },
  perfis: {
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    select: { perfil_id: true, principal: true, ordem: true, perfil: { select: { id: true, codigo: true, nome: true, dimensao: true, unidade_canonica: true, ativo: true } } },
  },
});

export const naoEncontrado = () => new AppError('TIPO_PATRIMONIAL_NAO_ENCONTRADO', 'tipo patrimonial não encontrado');
const perfisInvalidos = (mensagem, reason, details = {}) =>
  new AppError('TIPO_PERFIS_INVALIDOS', `${mensagem}; nada foi gravado`, { details: { field: 'perfis', reason, ...details } });
const familiaInvalida = (reason) =>
  new AppError('BEM_REFERENCIA_INVALIDA', reason === 'inativo' ? 'a família escolhida está inativa; nada foi gravado' : 'família não encontrada; nada foi gravado', {
    details: { field: 'familia_id', reason },
  });

/** Forma pública (sem tenant). `principal` sai booleano. */
export const comoTipoPublico = (r) => ({
  id: r.id,
  familia_id: r.familia_id,
  familia: r.familia ? { id: r.familia.id, codigo: r.familia.codigo, nome: r.familia.nome, natureza: r.familia.natureza, ativo: r.familia.ativo } : null,
  codigo: r.codigo,
  nome: r.nome,
  descricao: r.descricao ?? null,
  vida_util_meses_sugerida: r.vida_util_meses_sugerida ?? null,
  perfis: (r.perfis ?? []).map((p) => ({
    perfil_id: p.perfil_id,
    principal: p.principal === true,
    ordem: p.ordem,
    perfil: p.perfil
      ? { id: p.perfil.id, codigo: p.perfil.codigo, nome: p.perfil.nome, dimensao: p.perfil.dimensao, unidade_canonica: p.perfil.unidade_canonica, ativo: p.perfil.ativo }
      : null,
  })),
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Assinatura dos perfis (ordem + principal) para auditoria e detecção de mudança. */
const assinaturaPerfis = (lista) => lista.map((p) => `${p.perfil_id}${p.principal === true ? '*' : ''}`);

/** Auditoria por allowlist (ids, código, situação, versão e os perfis; sem texto livre). */
export const paraAuditoria = (r) => ({
  id: r.id,
  codigo: r.codigo,
  familia_id: r.familia_id,
  ativo: r.ativo,
  versao: r.versao,
  perfis: assinaturaPerfis(r.perfis ?? []),
});
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'vida_util_meses_sugerida', 'ativo', 'perfis']);
const comPerfisAssinados = (r) => ({ ...r, perfis: assinaturaPerfis(r.perfis ?? []) });

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

/**
 * Valida a lista de perfis pedida contra a família e o banco (sem gravar).
 * @param {any} tx
 * @param {string} clienteId
 * @param {{ natureza: string }} familia
 * @param {unknown} pedidos  `[{perfil_id, principal?}]`
 * @param {Array<{ perfil_id: string }>} atuais  vínculos já gravados (PATCH)
 * @returns {Promise<Array<{ perfil_id: string, principal: boolean, ordem: number }>>}
 */
export const validarPerfisDoTipo = async (tx, clienteId, familia, pedidos, atuais = []) => {
  const lista = Array.isArray(pedidos) ? pedidos : [];
  if (lista.length && familia.natureza !== 'BENFEITORIA') {
    throw new AppError('TIPO_PERFIS_NAO_APLICAVEIS', 'perfis de medição só se aplicam a tipos de benfeitoria; nada foi gravado', {
      details: { field: 'perfis', reason: 'natureza_sem_medicoes', natureza: familia.natureza },
    });
  }
  if (lista.length > MAX_PERFIS_POR_TIPO) throw perfisInvalidos(`um tipo tem no máximo ${MAX_PERFIS_POR_TIPO} perfis`, 'limite', { maximo: MAX_PERFIS_POR_TIPO });
  const ids = lista.map((p) => p.perfil_id);
  if (new Set(ids).size !== ids.length) throw perfisInvalidos('o mesmo perfil aparece mais de uma vez', 'duplicado');
  if (lista.filter((p) => p.principal === true).length > 1) throw perfisInvalidos('marque no máximo um perfil como principal', 'principal_duplicado');
  if (!ids.length) return [];
  const encontrados = await tx.perfilMedicao.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { id: true, ativo: true } });
  const porId = new Map(encontrados.map((p) => [p.id, p]));
  const jaVinculados = new Set(atuais.map((a) => a.perfil_id));
  for (const id of ids) {
    const perfil = porId.get(id);
    if (!perfil) throw perfisInvalidos('perfil de medição não encontrado', 'inexistente', { perfil_id: id });
    if (!perfil.ativo && !jaVinculados.has(id)) throw perfisInvalidos('perfil de medição inativo não pode ser acrescentado', 'inativo', { perfil_id: id });
  }
  return lista.map((p, ordem) => ({ perfil_id: p.perfil_id, principal: p.principal === true, ordem }));
};

/**
 * Sync completo em duas fases para o `principal` (A5). Sem validação: chame
 * `validarPerfisDoTipo` antes.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} tipoId
 * @param {Array<{ perfil_id: string, principal: boolean, ordem: number }>} desejados
 * @param {Array<{ perfil_id: string }>} atuais
 */
export const sincronizarPerfisDoTipo = async (tx, clienteId, tipoId, desejados, atuais) => {
  const base = { cliente_id: clienteId, tipo_id: tipoId };
  const querIds = new Set(desejados.map((d) => d.perfil_id));
  const temIds = new Set(atuais.map((a) => a.perfil_id));
  const remover = [...temIds].filter((id) => !querIds.has(id));
  if (remover.length) await tx.tipoPatrimonialPerfil.deleteMany({ where: { ...base, perfil_id: { in: remover } } });
  await tx.tipoPatrimonialPerfil.updateMany({ where: { ...base, principal: true }, data: { principal: null } });
  for (const d of desejados) {
    if (temIds.has(d.perfil_id)) await tx.tipoPatrimonialPerfil.updateMany({ where: { ...base, perfil_id: d.perfil_id }, data: { ordem: d.ordem } });
  }
  const novos = desejados.filter((d) => !temIds.has(d.perfil_id));
  if (novos.length) {
    await tx.tipoPatrimonialPerfil.createMany({ data: novos.map((d) => ({ ...base, perfil_id: d.perfil_id, ordem: d.ordem, principal: null })) });
  }
  const principal = desejados.find((d) => d.principal);
  if (principal) await tx.tipoPatrimonialPerfil.updateMany({ where: { ...base, perfil_id: principal.perfil_id }, data: { principal: true } });
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
  const codigo = codigoDoCorpo(entrada.codigo);
  const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    if (typeof entrada.familia_id !== 'string' || !entrada.familia_id) throw familiaInvalida('inexistente');
    const familia = await tx.familiaPatrimonial.findFirst({ where: { cliente_id: cli, id: entrada.familia_id }, select: { id: true, natureza: true, ativo: true } });
    if (!familia) throw familiaInvalida('inexistente');
    if (!familia.ativo) throw familiaInvalida('inativo');
    await exigirLivre(tx, cli, { codigo, nome, familiaId: familia.id });
    const perfis = await validarPerfisDoTipo(tx, cli, familia, entrada.perfis);
    const criado = await tx.tipoPatrimonial.create({
      data: { cliente_id: cli, familia_id: familia.id, codigo, nome, descricao, vida_util_meses_sugerida: entrada.vida_util_meses_sugerida ?? null },
      select: { id: true },
    });
    if (perfis.length) await sincronizarPerfisDoTipo(tx, cli, criado.id, perfis, []);
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
    /** @type {Array<{ perfil_id: string, principal: boolean, ordem: number }>|null} */
    let perfis = null;
    if (entrada.perfis !== undefined) {
      const desejados = await validarPerfisDoTipo(tx, cli, antes.familia, entrada.perfis, antes.perfis);
      if (assinaturaPerfis(desejados).join(',') !== assinaturaPerfis(antes.perfis).join(',')) perfis = desejados;
    }
    if (!Object.keys(dados).length && !perfis) return comoTipoPublico(antes);
    await atualizarComVersao(tx.tipoPatrimonial, { clienteId: cli, id, versao: entrada.versao, data: dados });
    if (perfis) await sincronizarPerfisDoTipo(tx, cli, id, perfis, antes.perfis);
    const depois = await buscar(tx, cli, id);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: paraAuditoria(antes),
        dadosNovos: { ...paraAuditoria(depois), campos_alterados: camposAlterados(comPerfisAssinados(antes), comPerfisAssinados(depois), CAMPOS_AUDITAVEIS) },
      },
      tx
    );
    return comoTipoPublico(depois);
  });
};

/**
 * Opções de seletor: tipos ATIVOS (filtro `familia_id`), em ordem alfabética,
 * `{id, codigo, nome, familia_id, perfis:[{perfil_id, principal}]}`.
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
    select: { id: true, codigo: true, nome: true, familia_id: true, perfis: { orderBy: [{ ordem: 'asc' }, { id: 'asc' }], select: { perfil_id: true, principal: true } } },
    limit,
    cursor,
    mapear: (linhas) =>
      linhas.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        familia_id: r.familia_id,
        perfis: r.perfis.map((p) => ({ perfil_id: p.perfil_id, principal: p.principal === true })),
      })),
  });
};
