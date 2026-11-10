/**
 * D-PROD-153 — Naturezas financeiras GERENCIAIS (Gestão P2).
 *
 * Catálogo que classifica FUTURAS receitas e despesas pelo tipo econômico
 * ("qual foi o tipo da receita/despesa?"). Não é plano de contas contábil e não
 * guarda valor, saldo nem lançamento. Não tem vínculo estático com Parceiro,
 * Centro de Custo ou Centro de Resultado: a combinação será da operação futura.
 *
 * Regras:
 *  - `cliente_id` só da sessão; `empresa_id` validado no banco (mesmo tenant) e
 *    imutável; leitura e escrita escopadas por tenant + empresa (alheio = 404);
 *  - `tipo` RECEITA | DESPESA escolhido na criação e IMUTÁVEL (CHECK no banco);
 *  - nome em maiúsculas, único por empresa E tipo (unique do banco = última barreira);
 *  - código pela sequência atômica `EntidadeCodigoSequencia` (nunca MAX+1);
 *  - pai opcional do MESMO tipo e empresa (FK composta com `tipo`), ativo, sem
 *    ciclo, até PROFUNDIDADE_MAXIMA níveis; escritas da árvore serializadas por
 *    empresa+tipo (trava transacional);
 *  - sem exclusão física: inativar exige não ter filho ativo; reativar exige pai ativo;
 *  - auditoria mínima na mesma transação (ids, tipo, número, situação, pai e
 *    NOMES dos campos alterados — sem texto livre);
 *  - sem teto artificial: listagem e opções de pai são paginadas (keyset) com
 *    busca no servidor, então qualquer natureza ativa é alcançável.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { decodificarCursor, normalizarLimite, montarEnvelopeKeyset, clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';
import { ehViolacaoDeUnique, exigirEmpresaDoTenant, invalido, iso, textoDoCorpo, travarEscopo } from './gestaoComum.js';

export const ENTIDADE = 'NaturezaFinanceira';
export const TIPOS_NATUREZA = Object.freeze(['RECEITA', 'DESPESA']);
/** Raiz + 4 níveis (ex.: DESPESA > Alimentação > Ração > Proteinado > Lote X). */
export const PROFUNDIDADE_MAXIMA = 5;

const SELECAO = Object.freeze({ id: true, empresa_id: true, numero: true, tipo: true, nome: true, descricao: true, pai_id: true, ativo: true, createdAt: true, updatedAt: true });

const naoEncontrado = () => new AppError('NATUREZA_FINANCEIRA_NOT_FOUND', 'natureza financeira não encontrada nesta empresa');
const hierarquia = (reason, details = {}) =>
  new AppError('NATUREZA_HIERARQUIA_INVALIDA', 'pai inválido para esta natureza', { details: { field: 'pai_id', ...details, reason } });
const conflitoNome = () => new AppError('NATUREZA_NOME_CONFLITO', 'já existe natureza com este nome e tipo nesta empresa', { details: { field: 'nome', reason: 'nome_repetido' } });

/** @param {unknown} t */
const exigirTipo = (t) => {
  if (typeof t !== 'string' || !TIPOS_NATUREZA.includes(t)) throw invalido('tipo deve ser RECEITA ou DESPESA', { field: 'tipo', reason: 'tipo_invalido' });
  return t;
};

/** Forma pública (sem tenant). `caminho`/`nivel` quando resolvidos. */
export const comoNaturezaPublica = (r, extra = {}) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  tipo: r.tipo,
  nome: r.nome,
  descricao: r.descricao ?? null,
  pai_id: r.pai_id ?? null,
  ativo: r.ativo,
  ...extra,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria por allowlist: identificadores, tipo, número, situação e pai. */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  tipo: r.tipo,
  ativo: r.ativo,
  pai_id: r.pai_id ?? null,
});
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'pai_id', 'ativo']);
const camposAlterados = (antes, depois) => CAMPOS_AUDITAVEIS.filter((c) => (antes?.[c] ?? null) !== (depois?.[c] ?? null));

const chaveDaArvore = (clienteId, empresaId, tipo) => `gestao:${ENTIDADE}:${clienteId}:${empresaId}:${tipo}`;

const buscar = (tx, clienteId, empresaId, id) =>
  tx.naturezaFinanceira.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: SELECAO });

/**
 * Caminho ("RAIZ / FILHO / NETO") e nível de vários nós numa consulta só
 * (CTE recursiva subindo pelos pais, limitada à profundidade + folga).
 * @returns {Promise<Map<string, { caminho: string, nivel: number, pai_nome: string|null }>>}
 */
export const caminhosDe = async (tx, clienteId, empresaId, ids) => {
  /** @type {Map<string, { caminho: string, nivel: number, pai_nome: string|null }>} */
  const saida = new Map();
  if (!ids.length) return saida;
  const linhas = /** @type {Array<{ origem: string, nome: string, nivel: number }>} */ (
    await tx.$queryRaw`
      WITH RECURSIVE sobe AS (
        SELECT n.id AS origem, n.id, n.pai_id, n.nome, 1 AS nivel
          FROM "NaturezaFinanceira" n
         WHERE n.cliente_id = ${clienteId} AND n.empresa_id = ${empresaId} AND n.id = ANY(${ids})
        UNION ALL
        SELECT s.origem, p.id, p.pai_id, p.nome, s.nivel + 1
          FROM sobe s
          JOIN "NaturezaFinanceira" p ON p.cliente_id = ${clienteId} AND p.empresa_id = ${empresaId} AND p.id = s.pai_id
         WHERE s.nivel < ${PROFUNDIDADE_MAXIMA + 2}
      )
      SELECT origem, nome, nivel FROM sobe ORDER BY origem, nivel DESC`
  );
  /** @type {Map<string, Array<{ nome: string, nivel: number }>>} */
  const porOrigem = new Map();
  for (const l of linhas) {
    if (!porOrigem.has(l.origem)) porOrigem.set(l.origem, []);
    porOrigem.get(l.origem).push({ nome: l.nome, nivel: Number(l.nivel) });
  }
  for (const [origem, nos] of porOrigem) {
    // nos vem do topo (nivel maior) para o próprio nó (nivel 1)
    saida.set(origem, { caminho: nos.map((n) => n.nome).join(' / '), nivel: nos.length, pai_nome: nos.length > 1 ? nos[nos.length - 2].nome : null });
  }
  return saida;
};

/** Ids de `id` e de toda a subárvore abaixo dele (CTE descendo). */
const subarvoreDe = async (tx, clienteId, empresaId, id) => {
  const linhas = /** @type {Array<{ id: string, nivel: number }>} */ (
    await tx.$queryRaw`
      WITH RECURSIVE desce AS (
        SELECT n.id, 1 AS nivel FROM "NaturezaFinanceira" n
         WHERE n.cliente_id = ${clienteId} AND n.empresa_id = ${empresaId} AND n.id = ${id}
        UNION ALL
        SELECT f.id, d.nivel + 1 FROM desce d
          JOIN "NaturezaFinanceira" f ON f.cliente_id = ${clienteId} AND f.empresa_id = ${empresaId} AND f.pai_id = d.id
         WHERE d.nivel < ${PROFUNDIDADE_MAXIMA + 2}
      )
      SELECT id, nivel FROM desce`
  );
  return { ids: linhas.map((l) => l.id), altura: linhas.reduce((m, l) => Math.max(m, Number(l.nivel)), 0) };
};

/**
 * Valida o pai proposto (null = raiz) para um nó do `tipo` (sob a trava da árvore).
 * @param {string|null} [id] nó sendo editado (null na criação)
 */
const validarPai = async (tx, clienteId, empresaId, tipo, paiId, id = null) => {
  if (paiId === null || paiId === undefined) return null;
  if (id && paiId === id) throw hierarquia('autorreferencia');
  const pai = await buscar(tx, clienteId, empresaId, paiId);
  if (!pai) throw hierarquia('pai_fora_da_empresa');
  if (pai.tipo !== tipo) throw hierarquia('pai_de_outro_tipo', { tipo_pai: pai.tipo });
  if (!pai.ativo) throw hierarquia('pai_inativo');
  const caminhoPai = (await caminhosDe(tx, clienteId, empresaId, [pai.id])).get(pai.id);
  const nivelPai = caminhoPai?.nivel ?? 1;
  let altura = 1;
  if (id) {
    const sub = await subarvoreDe(tx, clienteId, empresaId, id);
    if (sub.ids.includes(pai.id)) throw hierarquia('ciclo');
    altura = sub.altura || 1;
  }
  if (nivelPai + altura > PROFUNDIDADE_MAXIMA) throw hierarquia('profundidade_maxima', { maximo: PROFUNDIDADE_MAXIMA });
  return pai;
};

const exigirNomeLivre = async (tx, clienteId, empresaId, tipo, nome, ignorarId = null) => {
  const existe = await tx.naturezaFinanceira.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, tipo, nome, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existe) throw conflitoNome();
};

/** Corrida perdida no unique (nome) vira 409 estável, nunca 500. */
const comConflitoEstavel = async (fn) => {
  try {
    return await fn();
  } catch (erro) {
    if (ehViolacaoDeUnique(erro)) throw conflitoNome();
    throw erro;
  }
};

const lerAtivo = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);

export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const limit = normalizarLimite(query.limit);
  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
  if (query.tipo !== undefined) where.tipo = exigirTipo(query.tipo);
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  if (typeof query.pai_id === 'string' && query.pai_id) where.pai_id = query.pai_id;
  /** @type {any[]} */
  const AND = [];
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) AND.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }, { descricao: { contains: q, mode: 'insensitive' } }] });
  const total = await prisma.naturezaFinanceira.count({ where: { ...where, ...(AND.length ? { AND } : {}) } });
  if (cursor) AND.push(clausulaKeysetDesc(cursor));
  const registros = await prisma.naturezaFinanceira.findMany({
    where: { ...where, ...(AND.length ? { AND } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: SELECAO,
  });
  const caminhos = await caminhosDe(prisma, auth.clienteId, empresaId, registros.slice(0, limit).map((r) => r.id));
  return montarEnvelopeKeyset({
    registros,
    limit,
    total,
    mapItem: (r) => {
      const c = caminhos.get(r.id);
      return comoNaturezaPublica(r, { pai_nome: c?.pai_nome ?? null, caminho: c?.caminho ?? r.nome, nivel: c?.nivel ?? 1 });
    },
  });
};

export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const r = await buscar(prisma, auth.clienteId, empresaId, id);
  if (!r) throw naoEncontrado();
  const c = (await caminhosDe(prisma, auth.clienteId, empresaId, [r.id])).get(r.id);
  return comoNaturezaPublica(r, { pai_nome: c?.pai_nome ?? null, caminho: c?.caminho ?? r.nome, nivel: c?.nivel ?? 1 });
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const tipo = exigirTipo(entrada.tipo);
  const nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true });
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  const paiId = entrada.pai_id ?? null;
  return comConflitoEstavel(() =>
    getPrismaClient().$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      await travarEscopo(tx, chaveDaArvore(auth.clienteId, empresaId, tipo));
      await exigirNomeLivre(tx, auth.clienteId, empresaId, tipo, nome);
      const pai = await validarPai(tx, auth.clienteId, empresaId, tipo, paiId);
      const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT });
      const registro = await tx.naturezaFinanceira.create({
        data: { cliente_id: auth.clienteId, empresa_id: empresaId, numero: String(numero), tipo, nome, descricao, pai_id: pai?.id ?? null },
        select: SELECAO,
      });
      await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: paraAuditoria(registro) }, tx);
      const c = (await caminhosDe(tx, auth.clienteId, empresaId, [registro.id])).get(registro.id);
      return comoNaturezaPublica(registro, { pai_nome: c?.pai_nome ?? null, caminho: c?.caminho ?? registro.nome, nivel: c?.nivel ?? 1 });
    })
  );
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  return comConflitoEstavel(() =>
    getPrismaClient().$transaction(async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
      // O tipo do nó define a árvore (trava): lê-o antes de travar e relê depois.
      const previo = await buscar(tx, auth.clienteId, empresaId, id);
      if (!previo) throw naoEncontrado();
      await travarEscopo(tx, chaveDaArvore(auth.clienteId, empresaId, previo.tipo));
      const antes = await buscar(tx, auth.clienteId, empresaId, id);
      if (!antes) throw naoEncontrado();
      /** @type {Record<string, unknown>} */
      const dados = {};
      if (entrada.nome !== undefined) {
        const nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true });
        if (nome !== antes.nome) {
          await exigirNomeLivre(tx, auth.clienteId, empresaId, antes.tipo, nome, id);
          dados.nome = nome;
        }
      }
      if (entrada.descricao !== undefined) {
        const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
        if (descricao !== (antes.descricao ?? null)) dados.descricao = descricao;
      }
      if (entrada.pai_id !== undefined && (entrada.pai_id ?? null) !== (antes.pai_id ?? null)) {
        const pai = await validarPai(tx, auth.clienteId, empresaId, antes.tipo, entrada.pai_id ?? null, id);
        dados.pai_id = pai?.id ?? null;
      }
      if (entrada.ativo !== undefined && entrada.ativo !== antes.ativo) {
        if (entrada.ativo === false) {
          const filhosAtivos = await tx.naturezaFinanceira.count({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, pai_id: id, ativo: true } });
          if (filhosAtivos) {
            throw new AppError('NATUREZA_COM_FILHOS_ATIVOS', 'inative as naturezas filhas antes', { details: { filhos_ativos: filhosAtivos } });
          }
        } else {
          const paiId = dados.pai_id !== undefined ? dados.pai_id : antes.pai_id;
          if (paiId) {
            const pai = await buscar(tx, auth.clienteId, empresaId, String(paiId));
            if (pai && !pai.ativo) throw hierarquia('pai_inativo', { field: 'ativo' });
          }
        }
        dados.ativo = entrada.ativo;
      }
      if (!Object.keys(dados).length) {
        const c = (await caminhosDe(tx, auth.clienteId, empresaId, [antes.id])).get(antes.id);
        return comoNaturezaPublica(antes, { pai_nome: c?.pai_nome ?? null, caminho: c?.caminho ?? antes.nome, nivel: c?.nivel ?? 1 });
      }
      const depois = await tx.naturezaFinanceira.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, data: dados, select: SELECAO });
      await registrarEvento(
        contexto,
        { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: { ...paraAuditoria(depois), campos_alterados: camposAlterados(antes, depois) } },
        tx
      );
      const c = (await caminhosDe(tx, auth.clienteId, empresaId, [depois.id])).get(depois.id);
      return comoNaturezaPublica(depois, { pai_nome: c?.pai_nome ?? null, caminho: c?.caminho ?? depois.nome, nivel: c?.nivel ?? 1 });
    })
  );
};

/** Cursor das opções: posição (nome, id) na ordem alfabética. */
const codificarCursorOpcoes = (nome, id) => Buffer.from(JSON.stringify([nome, id]), 'utf8').toString('base64url');
const decodificarCursorOpcoes = (bruto) => {
  try {
    const v = JSON.parse(Buffer.from(String(bruto), 'base64url').toString('utf8'));
    return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' ? { nome: v[0], id: v[1] } : null;
  } catch {
    return null;
  }
};

/**
 * Opções de pai (paginadas e com busca no servidor): naturezas ATIVAS do
 * `tipo`, em ordem alfabética, sem o próprio nó e sem a sua subárvore quando
 * `excluir_id` vem (edição). Nenhum teto: qualquer ativo é alcançável por
 * página ou por busca.
 */
export const opcoesPais = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const tipo = exigirTipo(query.tipo);
  const limit = normalizarLimite(query.limit);
  const cursor = query.cursor ? decodificarCursorOpcoes(query.cursor) : null;
  if (query.cursor && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  /** @type {any[]} */
  const AND = [{ cliente_id: auth.clienteId, empresa_id: empresaId, tipo, ativo: true }];
  if (typeof query.excluir_id === 'string' && query.excluir_id) {
    const sub = await subarvoreDe(prisma, auth.clienteId, empresaId, query.excluir_id);
    if (sub.ids.length) AND.push({ id: { notIn: sub.ids } });
  }
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) AND.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] });
  if (cursor) AND.push({ OR: [{ nome: { gt: cursor.nome } }, { nome: cursor.nome, id: { gt: cursor.id } }] });
  const linhas = await prisma.naturezaFinanceira.findMany({
    where: { AND },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: { id: true, numero: true, nome: true, pai_id: true },
  });
  const pagina = linhas.slice(0, limit);
  const caminhos = await caminhosDe(prisma, auth.clienteId, empresaId, pagina.map((r) => r.id));
  const ultimo = pagina[pagina.length - 1];
  return {
    itens: pagina.map((r) => {
      const c = caminhos.get(r.id);
      return { id: r.id, numero: r.numero, nome: r.nome, pai_id: r.pai_id ?? null, caminho: c?.caminho ?? r.nome, nivel: c?.nivel ?? 1 };
    }),
    has_more: linhas.length > limit,
    next_cursor: linhas.length > limit && ultimo ? codificarCursorOpcoes(ultimo.nome, ultimo.id) : null,
  };
};
