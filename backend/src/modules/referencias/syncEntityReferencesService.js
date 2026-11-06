/**
 * Propagação de referências desnormalizadas — `POST /referencias/sincronizar`
 * (P5.5 → D-PROD-137).
 *
 * Contrato: o corpo só IDENTIFICA a origem (`event.entity_name` + `data.id`).
 * Antes, `data`/`old_data` do corpo eram gravados nos dependentes: quem tinha a
 * tela de Setores reescrevia `setor_nome` livre em lotes e movimentações do mapa
 * e re-apontava `setor_id` de área, lote e cocho; quem tinha Tipos de tarefa
 * mudava o grupo das tarefas sem mudar o tipo (REF-01/F4). Agora:
 *
 *  1. a origem é RELIDA no tenant do auth_context, travada `FOR SHARE` (uma
 *     renomeação concorrente espera esta transação, e a próxima sincronização
 *     já lê o nome novo). Inexistente no tenant → 404 da entidade (id de outro
 *     tenant é "não existe", não 403); entidade fora do catálogo → 400;
 *  2. cada dependente é casado SÓ por id (FK ou id dentro de `dados`), no
 *     tenant e — se a origem é por empresa — na empresa DA ORIGEM, e recebe os
 *     valores atuais dela. Só linha divergente é escrita (vazio ≡ nulo), então
 *     re-sincronizar é idempotente e a 2ª chamada não toca nada;
 *  3. tudo numa transação, com um evento-resumo no AuditLog (entidade, id,
 *     contagem e ids por tabela). Erro no meio desfaz o que já foi escrito
 *     (REF-02). O merge de JSON é um único `UPDATE … dados || …`: atômico na
 *     linha, sem o read-modify-write que apagava um cancelamento concorrente.
 *
 * Quem pode chamar não muda: a guarda R3 (`GUARDAS.referencias`) exige a tela
 * da própria entidade. Com o corpo reduzido a um id, essa tela só dá o poder de
 * pedir "copie os valores atuais desta origem" — nada que o PATCH dela já não
 * fizesse.
 */
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  setorNotFound,
  loteNotFound,
  produtoNotFound,
  tipoTarefaNotFound,
  grupoAtividadeNotFound,
} from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { ORIGENS } from './propagationRules.js';

const NAO_ENCONTRADO = Object.freeze({
  Setor: setorNotFound,
  Lote: loteNotFound,
  Produto: produtoNotFound,
  TipoTarefa: tipoTarefaNotFound,
  GrupoAtividade: grupoAtividadeNotFound,
});

/** Interativa, mas cada dependente é UM statement: o teto cobre fila de lock, não laço. */
const OPCOES_TRANSACAO = Object.freeze({ maxWait: 10000, timeout: 30000 });
/** Ids por tabela no AuditLog: rastro sem transformar uma renomeação grande em megabytes. */
const IDS_NO_AUDIT = 200;
const IDENTIFICADOR = /^[A-Za-z][A-Za-z0-9_]*$/;

const ident = (nome) => {
  if (!IDENTIFICADOR.test(nome)) throw new Error(`identificador inválido: ${nome}`);
  return Prisma.raw(`"${nome}"`);
};

/** Prisma grava DateTime como UTC em `timestamp(3)`: não depender do fuso da sessão. */
const AGORA_UTC = Prisma.raw(`(now() AT TIME ZONE 'UTC')`);

const invalido = (mensagem, campo) => new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details: { field: campo } });

/**
 * Lê do corpo SÓ a identificação. A entidade é resolvida exatamente como na
 * guarda R3 (`event.entity_name`, senão `entity_name`): guarda e service têm de
 * falar da mesma entidade. `data.*` além do id e `old_data` são ignorados.
 * @param {unknown} payload
 */
const identificarOrigem = (payload) => {
  const corpo = /** @type {Record<string, any>} */ (payload && typeof payload === 'object' ? payload : {});
  const evento = corpo.event && typeof corpo.event === 'object' ? corpo.event : {};
  if (evento.type !== 'update') throw invalido('event.type deve ser "update"', 'event.type');
  const entidade = evento.entity_name || corpo.entity_name || null;
  if (typeof entidade !== 'string' || !Object.prototype.hasOwnProperty.call(ORIGENS, entidade)) {
    throw invalido('entidade sem propagação de referências', 'event.entity_name');
  }
  const id = corpo.data && typeof corpo.data === 'object' ? corpo.data.id : undefined;
  if (typeof id !== 'string' || !id.trim() || id.length > 64) throw invalido('data.id é obrigatório', 'data.id');
  return { entidade, id };
};

/** @param {Record<string, unknown>} valores */
const exigirTexto = (valores) => {
  for (const [campo, valor] of Object.entries(valores)) {
    ident(campo);
    if (valor !== null && typeof valor !== 'string') throw new Error(`valor não textual para ${campo}`);
  }
  return /** @type {Record<string, string | null>} */ (valores);
};

/**
 * Um dependente, um `UPDATE … RETURNING id`. A condição de divergência trata
 * vazio e nulo como iguais: a baixa grava `''` onde o POST genérico grava nulo,
 * e normalizar um no outro só tocaria linhas sem mudar nada visível.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{clienteId: string, empresaId: string | null, id: string}} escopo
 * @param {import('./propagationRules.js').Dependente} dep
 * @param {Record<string, string | null>} valores
 * @returns {Promise<string[]>}
 */
const atualizarDependente = async (tx, escopo, dep, valores) => {
  const campos = Object.entries(valores);
  const tabela = ident(dep.tabela);
  const daEmpresa = escopo.empresaId ? Prisma.sql`AND empresa_id = ${escopo.empresaId}` : Prisma.empty;

  if (dep.documento) {
    const pares = Prisma.join(campos.flatMap(([campo, valor]) => [Prisma.sql`${campo}::text`, Prisma.sql`${valor}::text`]));
    const difere = Prisma.join(
      campos.map(([campo, valor]) => Prisma.sql`COALESCE(dados->>(${campo}::text), '') IS DISTINCT FROM COALESCE(${valor}::text, '')`),
      ' OR '
    );
    const linhas = await tx.$queryRaw`
      UPDATE ${tabela}
         SET dados = dados || jsonb_build_object(${pares}), "updatedAt" = ${AGORA_UTC}
       WHERE cliente_id = ${escopo.clienteId} ${daEmpresa}
         AND jsonb_typeof(dados) = 'object'
         AND dados->>(${dep.chave}::text) = ${escopo.id}
         AND (${difere})
      RETURNING id`;
    return /** @type {Array<{id: string}>} */ (linhas).map((l) => l.id);
  }

  const difereCampo = (campo, valor) => Prisma.sql`COALESCE(${ident(campo)}::text, '') IS DISTINCT FROM COALESCE(${valor}::text, '')`;
  // Com mais de um campo (tipo → tarefa, produto → estoque), só a coluna
  // divergente muda: a que já bate com a origem fica como está.
  const sets = Prisma.join(
    campos.map(([campo, valor]) => Prisma.sql`${ident(campo)} = CASE WHEN ${difereCampo(campo, valor)} THEN ${valor} ELSE ${ident(campo)} END`)
  );
  const difere = Prisma.join(campos.map(([campo, valor]) => difereCampo(campo, valor)), ' OR ');
  const linhas = await tx.$queryRaw`
    UPDATE ${tabela}
       SET ${sets}, "updatedAt" = ${AGORA_UTC}
     WHERE cliente_id = ${escopo.clienteId} ${daEmpresa}
       AND ${ident(dep.chave)} = ${escopo.id}
       AND (${difere})
    RETURNING id`;
  return /** @type {Array<{id: string}>} */ (linhas).map((l) => l.id);
};

/**
 * Evento-resumo da propagação (REF-02). Só quando algo foi escrito: chamada
 * sem efeito não é escrita e não polui a trilha.
 *
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} entidade
 * @param {string} entidadeId
 * @param {{porTabela: Record<string, number>, ids: Record<string, string[]>, valores: Record<string, string | null>}} resultado
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export const registrarPropagacao = async (contexto, entidade, entidadeId, resultado, tx) => {
  const total = Object.values(resultado.porTabela).reduce((t, v) => t + v, 0);
  if (!total) return;
  const ids = Object.fromEntries(Object.entries(resultado.ids).map(([tabela, lista]) => [tabela, lista.slice(0, IDS_NO_AUDIT)]));
  await registrarEvento(
    contexto,
    {
      acao: 'propagar_referencias',
      entidade,
      entidadeId,
      dadosNovos: {
        por_tabela: resultado.porTabela,
        total_atualizado: total,
        valores: resultado.valores,
        ids,
        ids_truncados: Object.values(resultado.ids).some((lista) => lista.length > IDS_NO_AUDIT),
      },
    },
    tx
  );
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {unknown} payload
 */
export const sincronizarReferencias = async (contexto, payload) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { entidade, id } = identificarOrigem(payload);
  const definicao = ORIGENS[entidade];
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const travada = /** @type {Array<{id: string}>} */ (
      await tx.$queryRaw`SELECT id FROM ${ident(definicao.tabela)} WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR SHARE`
    );
    const origem = travada.length
      ? await /** @type {any} */ (tx)[definicao.delegate].findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } } })
      : null;
    if (!origem) throw NAO_ENCONTRADO[entidade]();

    const escopo = { clienteId: auth.clienteId, empresaId: definicao.porEmpresa ? String(origem.empresa_id) : null, id };
    /** @type {Record<string, Set<string>>} */
    const tocados = {};
    /** @type {Record<string, string | null>} */
    const valores = {};
    for (const dep of definicao.dependentes) {
      const novos = exigirTexto(dep.valores(origem));
      const ids = await atualizarDependente(tx, escopo, dep, novos);
      if (!ids.length) continue;
      const conjunto = (tocados[dep.tabela] ??= new Set());
      ids.forEach((x) => conjunto.add(x));
      for (const [campo, valor] of Object.entries(novos)) valores[`${dep.tabela}.${campo}`] = valor;
    }

    // Documento tocado por duas chaves (ex.: setor_id e setor_origem_id do mesmo
    // setor) conta uma vez: a contagem é de linhas, não de statements.
    const porTabela = Object.fromEntries(Object.entries(tocados).map(([tabela, s]) => [tabela, s.size]));
    const ids = Object.fromEntries(Object.entries(tocados).map(([tabela, s]) => [tabela, [...s]]));
    await registrarPropagacao(contexto, entidade, id, { porTabela, ids, valores }, tx);

    return {
      success: true,
      source_entity: entidade,
      source_id: id,
      total_updated: Object.values(porTabela).reduce((t, v) => t + v, 0),
      por_tabela: porTabela,
    };
  }, OPCOES_TRANSACAO);
};
