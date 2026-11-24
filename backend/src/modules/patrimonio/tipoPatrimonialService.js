/**
 * D-PROD-157 / D-PROD-162 / D-PROD-169 — Tipos patrimoniais (catálogo do
 * TENANT, sem empresa), criados, renomeados e EXCLUÍDOS dentro do cadastro de
 * Bens ("Gerenciar tipos").
 *
 * D-PROD-169 (SIMPLIFICA-02): o usuário não vê família. O tipo pertence a um
 * "Tipo de bem" (a natureza da família dele):
 *  - antes de listar, de dar as opções do formulário e de criar, o catálogo
 *    padrão é GARANTIDO (`garantirCatalogoPadrao`: as 6 famílias padrão e, só
 *    para as criadas naquela chamada, os tipos padrão);
 *  - POST `{ natureza, nome, ... }` sem `familia_id`: o servidor resolve a
 *    família PADRÃO ATIVA da natureza (`familiaPadraoDaNatureza`; sem ela →
 *    422 `PATRIMONIO_FAMILIA_PADRAO_INDISPONIVEL`). Com `familia_id`
 *    (compatibilidade): família do tenant, ATIVA e — se a natureza vier — da
 *    mesma natureza (422 `BEM_REFERENCIA_INVALIDA` field `familia_id`, reason
 *    `inexistente|inativo|natureza_diferente`);
 *  - nome único DENTRO do tipo de bem (todas as famílias da natureza), sem
 *    diferenciar maiúsculas, sob a trava do catálogo; o unique do banco
 *    (por família) é a última barreira. Código único no tenant; sem `codigo`
 *    no POST, o servidor o gera do nome (P-05);
 *  - GET lista com filtro `natureza` (join `familia.natureza`); cada item traz
 *    `natureza` e `bens_em_uso` (bens ativos OU inativos de qualquer fazenda);
 *  - DELETE com CAS por `versao` (query): exclusão FÍSICA só sem nenhum bem
 *    (ativo ou inativo) usando o tipo; senão 409 `PATRIMONIO_TIPO_EM_USO`
 *    `{ bens }`. A trava do catálogo + `FOR UPDATE` do tipo serializam com o
 *    cadastro do bem (que lê o tipo `FOR SHARE`): nunca sobra bem órfão;
 *  - `familia_id`, `codigo` e `natureza` IMUTÁVEIS (fora do schema do PATCH);
 *  - D-PROD-162: os perfis de medição sugeridos saíram (`perfis` no corpo → 400);
 *  - D-PROD-202: `salto_maximo_medidor` (texto decimal ≥ 0, null limpa) é o teto
 *    do salto do medidor por lançamento: acima dele, a linha de máquina do
 *    Lançamento de Atividades pede justificativa.
 *  - D-PROD-279: "a máquina sozinha não leva produto; quem leva é o implemento".
 *    Só o tipo de IMPLEMENTO aceita `usa_produto`, `forma_produto` (hoje só
 *    `JATO`), `capacidade` (texto decimal > 0 e ≤ 100000, até 4 casas) e
 *    `capacidade_unidade` (`L` | `KG`); em outra natureza, mandar qualquer um
 *    deles é 400. Sem produto (false/null), os outros três ficam nulos (mandá-los
 *    preenchidos é 400; os gravados são limpos). Com produto, os três são
 *    obrigatórios (no PATCH, o que não vier é o gravado).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { texto } from '../financeiro/decimalFinanceiro.js';
import { invalido, iso, textoDoCorpo } from '../gestao/gestaoComum.js';
import { PADRAO_MEDIDA, decimalDoCorpo } from './bemPatrimonialRegras.js';
import { familiaPadraoDaNatureza, garantirCatalogoPadrao } from './patrimonioCatalogoPadrao.js';
import {
  atualizarComVersao, camposAlterados, codigoDisponivel, codigoDoCorpo, codigoDuplicado, comUnicosEstaveis, exigirVersao, lerAtivo, listarKeyset,
  nomeDuplicado, nomeIgual, paginacaoOpcoes, paginarPorNome, termoDeBusca, travarCatalogo,
} from './patrimonioComum.js';
import { NATUREZAS } from './patrimonioDominio.js';

export const ENTIDADE = 'TipoPatrimonial';

const SELECAO = Object.freeze({
  id: true, familia_id: true, codigo: true, nome: true, descricao: true, vida_util_meses_sugerida: true, salto_maximo_medidor: true,
  usa_produto: true, forma_produto: true, capacidade: true, capacidade_unidade: true,
  ativo: true, versao: true, createdAt: true, updatedAt: true,
  familia: { select: { id: true, codigo: true, nome: true, natureza: true, ativo: true } },
  _count: { select: { bens: true } },
});

export const naoEncontrado = () => new AppError('TIPO_PATRIMONIAL_NAO_ENCONTRADO', 'tipo patrimonial não encontrado');
const MENSAGENS_FAMILIA = Object.freeze({
  inexistente: 'família não encontrada; nada foi gravado',
  inativo: 'a família escolhida está inativa; nada foi gravado',
  natureza_diferente: 'a família informada é de outro tipo de bem; nada foi gravado',
});
/** @param {keyof typeof MENSAGENS_FAMILIA} reason */
const familiaInvalida = (reason) => new AppError('BEM_REFERENCIA_INVALIDA', MENSAGENS_FAMILIA[reason], { details: { field: 'familia_id', reason } });

/**
 * 409 do DELETE: o tipo é usado por bem(ns) ativo(s) ou inativo(s).
 * @param {number|null} bens  null só no caminho defensivo da FK (sem contagem confiável)
 */
export const tipoEmUso = (bens) =>
  new AppError(
    'PATRIMONIO_TIPO_EM_USO',
    bens === null
      ? 'Este tipo está em uso por bem(ns). Troque o tipo desses bens antes de excluir.'
      : `Este tipo está em uso por ${bens} bem(ns). Troque o tipo desses bens antes de excluir.`,
    { details: { field: 'id', reason: 'tipo_em_uso', bens } }
  );

/** Forma pública (sem tenant). D-PROD-169: `natureza` (da família) e `bens_em_uso`. */
export const comoTipoPublico = (r) => ({
  id: r.id,
  familia_id: r.familia_id,
  familia: r.familia ? { id: r.familia.id, codigo: r.familia.codigo, nome: r.familia.nome, natureza: r.familia.natureza, ativo: r.familia.ativo } : null,
  natureza: r.familia?.natureza ?? null,
  codigo: r.codigo,
  nome: r.nome,
  descricao: r.descricao ?? null,
  vida_util_meses_sugerida: r.vida_util_meses_sugerida ?? null,
  salto_maximo_medidor: texto(r.salto_maximo_medidor, 4),
  usa_produto: r.usa_produto ?? null,
  forma_produto: r.forma_produto ?? null,
  capacidade: texto(r.capacidade, 4),
  capacidade_unidade: r.capacidade_unidade ?? null,
  ativo: r.ativo,
  versao: r.versao,
  bens_em_uso: r._count?.bens ?? 0,
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
const CAMPOS_AUDITAVEIS = Object.freeze(['nome', 'descricao', 'vida_util_meses_sugerida', 'salto_maximo_medidor', 'usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade', 'ativo']);

/** D-PROD-279 — os campos do produto do implemento. */
export const CAMPOS_PRODUTO = Object.freeze(['usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade']);
export const FORMAS_PRODUTO = Object.freeze(['JATO']);
export const UNIDADES_CAPACIDADE = Object.freeze(['L', 'KG']);
const CAPACIDADE_MAXIMA = 100000;
const PADRAO_CAPACIDADE = /^\d{1,6}(\.\d{1,4})?$/;

/**
 * D-PROD-279 — estado final dos campos do produto, conferido. `atual` é o
 * gravado (PATCH) ou nada (POST); campo ausente na entrada fica como estava.
 * Natureza diferente de IMPLEMENTO com qualquer campo presente → 400.
 * @param {Record<string, any>} entrada @param {string} natureza @param {Record<string, any>|null} atual
 * @returns {null | { usa_produto: boolean|null, forma_produto: string|null, capacidade: string|null, capacidade_unidade: string|null }}
 *   null quando nenhum campo veio (nada a gravar)
 */
export const produtoDoCorpo = (entrada, natureza, atual = null) => {
  const veio = CAMPOS_PRODUTO.filter((c) => entrada[c] !== undefined);
  if (!veio.length) return null;
  if (natureza !== 'IMPLEMENTO') {
    throw invalido('só o tipo de implemento diz se usa produto; nada foi gravado', { field: veio[0], reason: 'so_implemento' });
  }
  const valor = (c) => (entrada[c] !== undefined ? entrada[c] : (atual?.[c] ?? null));
  const usa = valor('usa_produto');
  if (usa !== null && typeof usa !== 'boolean') throw invalido('usa_produto deve ser sim ou não', { field: 'usa_produto', reason: 'formato' });
  if (!usa) {
    for (const c of ['forma_produto', 'capacidade', 'capacidade_unidade']) {
      if (entrada[c] !== undefined && entrada[c] !== null) {
        throw invalido('sem produto, a forma, a capacidade e a unidade ficam vazias; nada foi gravado', { field: c, reason: 'sem_produto' });
      }
    }
    return { usa_produto: usa, forma_produto: null, capacidade: null, capacidade_unidade: null };
  }
  const forma = valor('forma_produto');
  if (forma === null) throw invalido('informe como o produto é contado', { field: 'forma_produto', reason: 'obrigatorio' });
  if (!FORMAS_PRODUTO.includes(forma)) throw invalido('forma do produto inválida (hoje só por jato)', { field: 'forma_produto', reason: 'invalido' });
  const bruto = valor('capacidade');
  if (bruto === null) throw invalido('informe a capacidade do jato', { field: 'capacidade', reason: 'obrigatorio' });
  const cap = typeof bruto === 'string' ? bruto : texto(bruto, 4);
  if (typeof cap !== 'string' || !PADRAO_CAPACIDADE.test(cap)) {
    throw invalido('a capacidade deve ser um número decimal em texto, com até 4 casas', { field: 'capacidade', reason: 'formato' });
  }
  const n = Number(cap);
  if (!(n > 0)) throw invalido('a capacidade deve ser maior que zero', { field: 'capacidade', reason: 'nao_positivo' });
  if (n > CAPACIDADE_MAXIMA) throw invalido(`a capacidade vai até ${CAPACIDADE_MAXIMA}`, { field: 'capacidade', reason: 'acima_do_maximo' });
  const unidade = valor('capacidade_unidade');
  if (unidade === null) throw invalido('informe a unidade da capacidade', { field: 'capacidade_unidade', reason: 'obrigatorio' });
  if (!UNIDADES_CAPACIDADE.includes(unidade)) throw invalido('unidade da capacidade inválida (L ou KG)', { field: 'capacidade_unidade', reason: 'invalido' });
  return { usa_produto: true, forma_produto: forma, capacidade: n.toFixed(4), capacidade_unidade: unidade };
};

/**
 * D-PROD-202 — teto do salto do medidor: texto decimal (≥ 0, até 10 dígitos e
 * 4 casas) → texto com 4 casas; null limpa; ausente → undefined.
 * @param {unknown} v @returns {string|null|undefined}
 */
const saltoDoCorpo = (v) => (v === undefined ? undefined : decimalDoCorpo(v, 'salto_maximo_medidor', PADRAO_MEDIDA, 4));

const buscar = (db, clienteId, id) => db.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, id }, select: SELECAO });

/** @param {unknown} n @returns {string} */
const exigirNatureza = (n) => {
  if (typeof n !== 'string' || !NATUREZAS.includes(n)) throw invalido('natureza inválida', { field: 'natureza', reason: 'natureza_invalida' });
  return n;
};

/**
 * Código (no tenant) e nome (no TIPO DE BEM, sem diferenciar maiúsculas)
 * livres, sob a trava do catálogo; campo ausente não é conferido.
 * @param {any} tx
 * @param {string} clienteId
 * @param {{ codigo?: string, nome?: string, natureza?: string }} campos
 * @param {string|null} [ignorarId]
 */
const exigirLivre = async (tx, clienteId, { codigo, nome, natureza }, ignorarId = null) => {
  const fora = ignorarId ? { NOT: { id: ignorarId } } : {};
  if (codigo !== undefined && (await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, codigo, ...fora }, select: { id: true } }))) {
    throw codigoDuplicado();
  }
  if (
    nome !== undefined &&
    (await tx.tipoPatrimonial.findFirst({ where: { cliente_id: clienteId, nome: nomeIgual(nome), familia: { natureza }, ...fora }, select: { id: true } }))
  ) {
    throw nomeDuplicado();
  }
};

const ESTAVEIS = Object.freeze({ codigo: codigoDuplicado, nome: nomeDuplicado });
const transacao = (fn) => comUnicosEstaveis(() => emTransacao(TRANSACAO_CURTA, fn, {}, MENSAGEM_CONFLITO_SEM_CHAVE), ESTAVEIS);

export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  await garantirCatalogoPadrao(contexto);
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId };
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  if (typeof query.familia_id === 'string' && query.familia_id) where.familia_id = query.familia_id;
  if (query.natureza !== undefined) where.familia = { natureza: exigirNatureza(query.natureza) };
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

/**
 * Família do tipo novo: a informada (compatibilidade, conferida) ou a padrão
 * ATIVA da natureza. Sob a trava do catálogo.
 * @param {any} tx @param {string} cli @param {{ familia_id?: unknown, natureza?: unknown }} entrada
 * @returns {Promise<{ id: string, natureza: string }>}
 */
const resolverFamilia = async (tx, cli, entrada) => {
  const natureza = entrada.natureza === undefined ? null : exigirNatureza(entrada.natureza);
  if (entrada.familia_id !== undefined) {
    if (typeof entrada.familia_id !== 'string' || !entrada.familia_id) throw familiaInvalida('inexistente');
    const familia = await tx.familiaPatrimonial.findFirst({ where: { cliente_id: cli, id: entrada.familia_id }, select: { id: true, natureza: true, ativo: true } });
    if (!familia) throw familiaInvalida('inexistente');
    if (natureza && familia.natureza !== natureza) throw familiaInvalida('natureza_diferente');
    if (!familia.ativo) throw familiaInvalida('inativo');
    return familia;
  }
  if (!natureza) throw invalido('informe o tipo de bem (natureza) do tipo', { field: 'natureza', reason: 'obrigatorio' });
  return familiaPadraoDaNatureza(tx, cli, natureza);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const codigoInformado = entrada.codigo === undefined ? null : codigoDoCorpo(entrada.codigo);
  const nome = /** @type {string} */ (textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true }));
  const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
  const salto = saltoDoCorpo(entrada.salto_maximo_medidor) ?? null;
  if (entrada.familia_id === undefined && entrada.natureza === undefined) {
    throw invalido('informe o tipo de bem (natureza) do tipo', { field: 'natureza', reason: 'obrigatorio' });
  }
  await garantirCatalogoPadrao(contexto);
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    const familia = await resolverFamilia(tx, cli, entrada);
    const produto = produtoDoCorpo(entrada, familia.natureza) ?? {};
    await exigirLivre(tx, cli, { ...(codigoInformado ? { codigo: codigoInformado } : {}), nome, natureza: familia.natureza });
    const codigo = codigoInformado ?? (await codigoDisponivel(tx, cli, 'tipoPatrimonial', nome));
    const criado = await tx.tipoPatrimonial.create({
      data: { cliente_id: cli, familia_id: familia.id, codigo, nome, descricao, vida_util_meses_sugerida: entrada.vida_util_meses_sugerida ?? null, salto_maximo_medidor: salto, ...produto },
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
        if (nome.toLowerCase() !== antes.nome.toLowerCase()) await exigirLivre(tx, cli, { nome, natureza: antes.familia.natureza }, id);
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
    const salto = saltoDoCorpo(entrada.salto_maximo_medidor);
    if (salto !== undefined && salto !== texto(antes.salto_maximo_medidor, 4)) dados.salto_maximo_medidor = salto;
    const produto = produtoDoCorpo(entrada, antes.familia.natureza, { ...antes, capacidade: texto(antes.capacidade, 4) });
    if (produto) {
      if (produto.usa_produto !== (antes.usa_produto ?? null)) dados.usa_produto = produto.usa_produto;
      if (produto.forma_produto !== (antes.forma_produto ?? null)) dados.forma_produto = produto.forma_produto;
      if (produto.capacidade !== texto(antes.capacidade, 4)) dados.capacidade = produto.capacidade;
      if (produto.capacidade_unidade !== (antes.capacidade_unidade ?? null)) dados.capacidade_unidade = produto.capacidade_unidade;
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

/** A exclusão bateu na FK do bem (caminho defensivo: a contagem sob trava já a evita). */
const ehViolacaoDeFk = (erro) => {
  const e = /** @type {any} */ (erro);
  return e?.code === 'P2003' || /foreign key/i.test(String(e?.message ?? ''));
};

/**
 * DELETE (D-PROD-169): exclusão FÍSICA do tipo sem nenhum bem (ativo ou
 * inativo, de qualquer fazenda). Ordem: trava do catálogo → `FOR UPDATE` do
 * tipo (espera o `FOR SHARE` do cadastro de bem em voo) → CAS da versão →
 * contagem dos bens (READ COMMITTED: vê o bem já confirmado) → DELETE →
 * auditoria na mesma transação.
 * @param {any} contexto @param {string} id @param {{ versao?: number }} [query]
 */
export const excluir = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const versao = Number(query.versao);
  return transacao(async (tx) => {
    await travarCatalogo(tx, cli);
    await tx.$queryRaw`SELECT id FROM "TipoPatrimonial" WHERE cliente_id = ${cli} AND id = ${id} FOR UPDATE`;
    const antes = await buscar(tx, cli, id);
    if (!antes) throw naoEncontrado();
    exigirVersao(antes, versao);
    const bens = await tx.bemPatrimonial.count({ where: { cliente_id: cli, tipo_id: id } });
    if (bens > 0) throw tipoEmUso(bens);
    try {
      await tx.tipoPatrimonial.delete({ where: { cliente_id_id: { cliente_id: cli, id } } });
    } catch (erro) {
      if (ehViolacaoDeFk(erro)) throw tipoEmUso(null);
      throw erro;
    }
    await registrarEvento(contexto, { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes) }, tx);
  });
};

/**
 * Opções de seletor (formulário do bem): tipos ATIVOS de famílias ATIVAS,
 * filtro `natureza` (D-PROD-169) e/ou `familia_id`, em ordem alfabética,
 * `{id, codigo, nome, familia_id, natureza}`. Garante o catálogo antes.
 */
export const opcoes = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  await garantirCatalogoPadrao(contexto);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true, familia: { ativo: true, ...(query.natureza !== undefined ? { natureza: exigirNatureza(query.natureza) } : {}) } }];
  if (typeof query.familia_id === 'string' && query.familia_id) filtros.push({ familia_id: query.familia_id });
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(getPrismaClient().tipoPatrimonial, {
    where: { AND: filtros },
    select: { id: true, codigo: true, nome: true, familia_id: true, familia: { select: { natureza: true } } },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, familia_id: r.familia_id, natureza: r.familia.natureza })),
  });
};
