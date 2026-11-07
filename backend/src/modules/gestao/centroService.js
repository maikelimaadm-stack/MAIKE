/**
 * D-PROD-145 — Centros de Custo e Centros de Resultado (cadastros; sem valores).
 *
 * Os dois têm a mesma forma (árvore opcional por empresa), então este arquivo
 * descreve as regras uma vez e as aplica a cada tipo. Regras:
 *  - `cliente_id` só da sessão; `empresa_id` validado no banco (mesmo tenant) e
 *    imutável: toda leitura e escrita é escopada por tenant + empresa;
 *  - nome em maiúsculas, único por empresa (unique do banco é a última barreira);
 *  - código pela sequência atômica `EntidadeCodigoSequencia` (nunca MAX+1);
 *  - pai do mesmo tipo, da mesma empresa (FK composta), ativo, sem ciclo, até
 *    PROFUNDIDADE_MAXIMA níveis; escritas da árvore serializadas por empresa;
 *  - sem exclusão física: inativar exige não ter filho ativo; reativar exige pai
 *    ativo; vínculos existentes ficam (rastreáveis) — só não se criam novos com
 *    centro inativo;
 *  - toda escrita audita antes/depois na mesma transação.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { decodificarCursor, normalizarLimite, montarEnvelopeKeyset, clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';
import { ehViolacaoDeUnique, exigirEmpresaDoTenant, invalido, iso, textoDoCorpo, travarEscopo } from './gestaoComum.js';

/** Raiz + 4 níveis: suficiente para "Pecuária / Cria / Maternidade"; evita árvore sem fim. */
export const PROFUNDIDADE_MAXIMA = 5;
export const MAX_VINCULOS = 200;

export const TIPOS_CENTRO = Object.freeze({
  custo: Object.freeze({ modelo: 'centroCusto', entidade: 'CentroCusto', naoEncontrado: 'CENTRO_CUSTO_NOT_FOUND', rotulo: 'centro de custo' }),
  resultado: Object.freeze({ modelo: 'centroResultado', entidade: 'CentroResultado', naoEncontrado: 'CENTRO_RESULTADO_NOT_FOUND', rotulo: 'centro de resultado' }),
});

/** Delegate do Prisma do tipo (centroCusto | centroResultado). @returns {any} */
const modeloDe = (cliente, tipo) => /** @type {any} */ (cliente)[tipo.modelo];

const SELECAO = Object.freeze({ id: true, cliente_id: true, empresa_id: true, numero: true, nome: true, descricao: true, pai_id: true, ativo: true, createdAt: true, updatedAt: true });

const naoEncontrado = (tipo) => new AppError(tipo.naoEncontrado, `${tipo.rotulo} não encontrado nesta empresa`);
const hierarquia = (motivo, details = {}) =>
  new AppError('CENTRO_HIERARQUIA_INVALIDA', 'pai inválido para este centro', { details: { field: 'pai_id', ...details, reason: motivo } });

/** Forma pública: sem tenant; com o nome do pai quando o chamador o resolveu. */
export const comoCentroPublico = (r, paiNome = undefined) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  nome: r.nome,
  descricao: r.descricao ?? null,
  pai_id: r.pai_id ?? null,
  ...(paiNome !== undefined ? { pai_nome: paiNome } : {}),
  ativo: r.ativo,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

const buscar = (tx, tipo, clienteId, empresaId, id) =>
  modeloDe(tx, tipo).findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: SELECAO });

const chaveDaArvore = (tipo, clienteId, empresaId) => `gestao:${tipo.entidade}:${clienteId}:${empresaId}`;

/** Nível do nó (raiz = 1), subindo pelos pais dentro da empresa. */
const nivelDe = async (tx, tipo, clienteId, empresaId, id) => {
  let nivel = 0;
  let atual = id;
  const vistos = new Set();
  while (atual) {
    if (vistos.has(atual)) throw hierarquia('ciclo');
    vistos.add(atual);
    nivel += 1;
    if (nivel > PROFUNDIDADE_MAXIMA + 1) break;
    const no = await modeloDe(tx, tipo).findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atual }, select: { pai_id: true } });
    atual = no?.pai_id ?? null;
  }
  return nivel;
};

/** Altura da subárvore de `id` (o próprio nó conta 1). */
const alturaDe = async (tx, tipo, clienteId, empresaId, id) => {
  let altura = 0;
  let nivel = [id];
  while (nivel.length && altura <= PROFUNDIDADE_MAXIMA + 1) {
    altura += 1;
    const filhos = await modeloDe(tx, tipo).findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, pai_id: { in: nivel } }, select: { id: true } });
    nivel = filhos.map((f) => f.id);
  }
  return altura;
};

/**
 * Valida o pai proposto para `id` (null = raiz). Sob a trava da árvore.
 * @returns {Promise<{ id: string, nome: string }|null>}
 */
const validarPai = async (tx, tipo, clienteId, empresaId, paiId, id = null) => {
  if (paiId === null || paiId === undefined) return null;
  if (id && paiId === id) throw hierarquia('autorreferencia');
  const pai = await buscar(tx, tipo, clienteId, empresaId, paiId);
  if (!pai) throw hierarquia('pai_fora_da_empresa', { field: 'pai_id' });
  if (!pai.ativo) throw hierarquia('pai_inativo', { field: 'pai_id' });
  if (id) {
    // ciclo: o pai novo não pode estar abaixo do próprio nó
    let atual = pai.pai_id;
    const vistos = new Set([pai.id]);
    while (atual) {
      if (atual === id) throw hierarquia('ciclo', { field: 'pai_id' });
      if (vistos.has(atual)) throw hierarquia('ciclo', { field: 'pai_id' });
      vistos.add(atual);
      const no = await modeloDe(tx, tipo).findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atual }, select: { pai_id: true } });
      atual = no?.pai_id ?? null;
    }
  }
  const nivelPai = await nivelDe(tx, tipo, clienteId, empresaId, pai.id);
  const altura = id ? await alturaDe(tx, tipo, clienteId, empresaId, id) : 1;
  if (nivelPai + altura > PROFUNDIDADE_MAXIMA) throw hierarquia('profundidade_maxima', { field: 'pai_id', maximo: PROFUNDIDADE_MAXIMA });
  return { id: pai.id, nome: pai.nome };
};

const exigirNomeLivre = async (tx, tipo, clienteId, empresaId, nome, ignorarId = null) => {
  const existe = await modeloDe(tx, tipo).findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, nome, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existe) throw new AppError('CENTRO_NOME_CONFLITO', 'já existe centro com este nome nesta empresa', { details: { field: 'nome' } });
};

/** Converte a corrida perdida no unique (nome/numero) em 409 estável. */
const comConflitoEstavel = async (fn) => {
  try {
    return await fn();
  } catch (erro) {
    if (ehViolacaoDeUnique(erro)) throw new AppError('CENTRO_NOME_CONFLITO', 'já existe centro com este nome nesta empresa', { details: { field: 'nome' } });
    throw erro;
  }
};

/** @param {'custo'|'resultado'} chaveTipo */
export const servicoDeCentro = (chaveTipo) => {
  const tipo = TIPOS_CENTRO[chaveTipo];

  const listar = async (contexto, query = {}) => {
    const auth = exigirAuthContext(contexto?.auth);
    const prisma = getPrismaClient();
    const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
    const limit = normalizarLimite(query.limit);
    const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
    const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
    if (cursorBruto && !cursor) throw invalido('cursor inválido', { field: 'cursor' });
    let ativo = null;
    if (query.ativo === true || query.ativo === 'true') ativo = true;
    if (query.ativo === false || query.ativo === 'false') ativo = false;
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    /** @type {Record<string, any>} */
    const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
    if (ativo !== null) where.ativo = ativo;
    const AND = [];
    if (q) AND.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }, { descricao: { contains: q, mode: 'insensitive' } }] });
    const total = await modeloDe(prisma, tipo).count({ where: { ...where, ...(AND.length ? { AND } : {}) } });
    if (cursor) AND.push(clausulaKeysetDesc(cursor));
    const registros = await modeloDe(prisma, tipo).findMany({
      where: { ...where, ...(AND.length ? { AND } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SELECAO,
    });
    const paiIds = [...new Set(registros.map((r) => r.pai_id).filter(Boolean))];
    const pais = paiIds.length
      ? await modeloDe(prisma, tipo).findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, id: { in: paiIds } }, select: { id: true, nome: true } })
      : [];
    const nomeDoPai = new Map(pais.map((p) => [p.id, p.nome]));
    return montarEnvelopeKeyset({ registros, limit, total, mapItem: (r) => comoCentroPublico(r, r.pai_id ? nomeDoPai.get(r.pai_id) ?? null : null) });
  };

  const detalhar = async (contexto, id, query = {}) => {
    const auth = exigirAuthContext(contexto?.auth);
    const prisma = getPrismaClient();
    const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
    const r = await buscar(prisma, tipo, auth.clienteId, empresaId, id);
    if (!r) throw naoEncontrado(tipo);
    const pai = r.pai_id ? await buscar(prisma, tipo, auth.clienteId, empresaId, r.pai_id) : null;
    return comoCentroPublico(r, pai?.nome ?? null);
  };

  const criar = async (contexto, entrada) => {
    const auth = exigirAuthContext(contexto?.auth);
    const nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true });
    const descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
    const paiId = entrada.pai_id ?? null;
    return comConflitoEstavel(() =>
      getPrismaClient().$transaction(async (tx) => {
        const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
        await travarEscopo(tx, chaveDaArvore(tipo, auth.clienteId, empresaId));
        await exigirNomeLivre(tx, tipo, auth.clienteId, empresaId, nome);
        const pai = await validarPai(tx, tipo, auth.clienteId, empresaId, paiId);
        const numero = await reservarNumero(tx, { clienteId: auth.clienteId, entidade: tipo.entidade, escopoTipo: ESCOPO_TENANT });
        const registro = await modeloDe(tx, tipo).create({
          data: { cliente_id: auth.clienteId, empresa_id: empresaId, numero: String(numero), nome, descricao, pai_id: pai?.id ?? null },
          select: SELECAO,
        });
        const publico = comoCentroPublico(registro, pai?.nome ?? null);
        await registrarEvento(contexto, { acao: 'create', entidade: tipo.entidade, entidadeId: registro.id, dadosNovos: publico }, tx);
        return publico;
      })
    );
  };

  const atualizar = async (contexto, id, entrada) => {
    const auth = exigirAuthContext(contexto?.auth);
    return comConflitoEstavel(() =>
      getPrismaClient().$transaction(async (tx) => {
        const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
        await travarEscopo(tx, chaveDaArvore(tipo, auth.clienteId, empresaId));
        const antes = await buscar(tx, tipo, auth.clienteId, empresaId, id);
        if (!antes) throw naoEncontrado(tipo);
        /** @type {Record<string, unknown>} */
        const dados = {};
        if (entrada.nome !== undefined) {
          const nome = textoDoCorpo(entrada.nome, 'nome', { obrigatorio: true, maiusculas: true });
          if (nome !== antes.nome) {
            await exigirNomeLivre(tx, tipo, auth.clienteId, empresaId, nome, id);
            dados.nome = nome;
          }
        }
        if (entrada.descricao !== undefined) dados.descricao = textoDoCorpo(entrada.descricao, 'descricao') ?? null;
        let pai = antes.pai_id ? await buscar(tx, tipo, auth.clienteId, empresaId, antes.pai_id) : null;
        if (entrada.pai_id !== undefined && (entrada.pai_id ?? null) !== (antes.pai_id ?? null)) {
          const validado = await validarPai(tx, tipo, auth.clienteId, empresaId, entrada.pai_id ?? null, id);
          dados.pai_id = validado?.id ?? null;
          pai = validado ? { ...validado } : null;
        }
        if (entrada.ativo !== undefined && entrada.ativo !== antes.ativo) {
          if (entrada.ativo === false) {
            const filhosAtivos = await modeloDe(tx, tipo).count({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, pai_id: id, ativo: true } });
            if (filhosAtivos) throw new AppError('CENTRO_COM_FILHOS_ATIVOS', 'inative os filhos antes', { details: { filhos_ativos: filhosAtivos } });
          } else {
            const paiAtual = dados.pai_id !== undefined ? pai : antes.pai_id ? await buscar(tx, tipo, auth.clienteId, empresaId, antes.pai_id) : null;
            if (paiAtual && 'ativo' in paiAtual && paiAtual.ativo === false) throw hierarquia('pai_inativo', { field: 'ativo' });
          }
          dados.ativo = entrada.ativo;
        }
        if (!Object.keys(dados).length) return comoCentroPublico(antes, pai?.nome ?? null);
        const depois = await modeloDe(tx, tipo).update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, data: dados, select: SELECAO });
        const publico = comoCentroPublico(depois, pai?.nome ?? null);
        await registrarEvento(
          contexto,
          { acao: 'update', entidade: tipo.entidade, entidadeId: id, dadosAnteriores: comoCentroPublico(antes), dadosNovos: { ...publico, campos_alterados: Object.keys(dados) } },
          tx
        );
        return publico;
      })
    );
  };

  /** Opções mínimas (id, número, nome) dos centros ATIVOS — para seletores. */
  const opcoesAtivas = async (contexto, query = {}) => {
    const auth = exigirAuthContext(contexto?.auth);
    const prisma = getPrismaClient();
    const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
    const itens = await modeloDe(prisma, tipo).findMany({
      where: { cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true },
      orderBy: [{ nome: 'asc' }],
      take: 1000,
      select: { id: true, numero: true, nome: true, pai_id: true },
    });
    return { itens };
  };

  return { tipo, listar, detalhar, criar, atualizar, opcoesAtivas };
};

/**
 * Vínculos centro de custo × centro de resultado (catálogo de combinações).
 * Escrita só a partir do centro de custo; leitura dos dois lados.
 */
const projecaoMinima = (r) => ({ id: r.id, numero: r.numero, nome: r.nome, ativo: r.ativo });

export const listarVinculos = async (contexto, lado, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const tipo = lado === 'custo' ? TIPOS_CENTRO.custo : TIPOS_CENTRO.resultado;
  const dono = await buscar(prisma, tipo, auth.clienteId, empresaId, id);
  if (!dono) throw naoEncontrado(tipo);
  const filtro = lado === 'custo' ? { centro_custo_id: id } : { centro_resultado_id: id };
  const pares = /** @type {any[]} */ (await prisma.centroCustoResultado.findMany({
    where: { cliente_id: auth.clienteId, empresa_id: empresaId, ...filtro },
    select: lado === 'custo'
      ? { centroResultado: { select: { id: true, numero: true, nome: true, ativo: true } } }
      : { centroCusto: { select: { id: true, numero: true, nome: true, ativo: true } } },
  }));
  const itens = pares.map((p) => projecaoMinima(lado === 'custo' ? p.centroResultado : p.centroCusto)).sort((a, b) => a.nome.localeCompare(b.nome));
  return { itens };
};

/**
 * Define o conjunto de centros de resultado de um centro de custo (substitui).
 * Idempotente: o mesmo conjunto não grava nem audita. Novos pares exigem os
 * dois centros ativos; pares já existentes permanecem mesmo se um lado foi
 * inativado depois. Tudo numa transação, sob a trava da empresa.
 */
export const definirVinculos = async (contexto, centroCustoId, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const ids = entrada.centro_resultado_ids;
  if (!Array.isArray(ids) || ids.length > MAX_VINCULOS) throw invalido(`centro_resultado_ids deve ser lista de até ${MAX_VINCULOS}`, { field: 'centro_resultado_ids' });
  if (new Set(ids).size !== ids.length) throw invalido('centro_resultado_ids tem repetição', { field: 'centro_resultado_ids' });
  return getPrismaClient().$transaction(async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, entrada.empresa_id);
    await travarEscopo(tx, `gestao:vinculos:${auth.clienteId}:${empresaId}`);
    const cc = await buscar(tx, TIPOS_CENTRO.custo, auth.clienteId, empresaId, centroCustoId);
    if (!cc) throw naoEncontrado(TIPOS_CENTRO.custo);
    const atuais = await tx.centroCustoResultado.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, centro_custo_id: centroCustoId }, select: { id: true, centro_resultado_id: true } });
    const atuaisSet = new Set(atuais.map((a) => a.centro_resultado_id));
    const desejados = new Set(ids);
    const adicionar = ids.filter((x) => !atuaisSet.has(x));
    const remover = atuais.filter((a) => !desejados.has(a.centro_resultado_id));
    if (adicionar.length) {
      if (!cc.ativo) throw new AppError('CENTRO_INATIVO', 'centro de custo inativo não recebe vínculo novo', { details: { field: 'centro_custo_id' } });
      const crs = await tx.centroResultado.findMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, id: { in: adicionar } }, select: { id: true, ativo: true } });
      // Outro tenant, outra empresa ou inexistente: a mesma resposta, sem revelar qual.
      if (crs.length !== adicionar.length) throw new AppError('CENTRO_RESULTADO_NOT_FOUND', 'centro de resultado não encontrado nesta empresa', { details: { field: 'centro_resultado_ids' } });
      if (crs.some((c) => !c.ativo)) throw new AppError('CENTRO_INATIVO', 'centro de resultado inativo não recebe vínculo novo', { details: { field: 'centro_resultado_ids' } });
    }
    if (!adicionar.length && !remover.length) return { alterado: false, adicionados: [], removidos: [], ...(await listarDentro(tx, auth.clienteId, empresaId, centroCustoId)) };
    if (remover.length) await tx.centroCustoResultado.deleteMany({ where: { cliente_id: auth.clienteId, empresa_id: empresaId, id: { in: remover.map((r) => r.id) } } });
    if (adicionar.length) {
      await tx.centroCustoResultado.createMany({
        data: adicionar.map((crId) => ({ cliente_id: auth.clienteId, empresa_id: empresaId, centro_custo_id: centroCustoId, centro_resultado_id: crId })),
      });
    }
    const resultado = { alterado: true, adicionados: adicionar, removidos: remover.map((r) => r.centro_resultado_id) };
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'CentroCustoResultado',
        entidadeId: centroCustoId,
        dadosAnteriores: { centro_custo_id: centroCustoId, centro_resultado_ids: [...atuaisSet].sort() },
        dadosNovos: { centro_custo_id: centroCustoId, centro_resultado_ids: [...desejados].sort(), ...resultado, comando: 'definir_vinculos' },
      },
      tx
    );
    return { ...resultado, ...(await listarDentro(tx, auth.clienteId, empresaId, centroCustoId)) };
  });
};

const listarDentro = async (tx, clienteId, empresaId, centroCustoId) => {
  const pares = await tx.centroCustoResultado.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, centro_custo_id: centroCustoId },
    select: { centroResultado: { select: { id: true, numero: true, nome: true, ativo: true } } },
  });
  return { itens: pares.map((p) => projecaoMinima(p.centroResultado)).sort((a, b) => a.nome.localeCompare(b.nome)) };
};
