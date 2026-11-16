/**
 * Repositório de AreaPastagem (P4.2, D-PROD-31).
 *
 * Mesmas duas regras do repositório de Setor, pelos mesmos motivos:
 *
 *  1. **nenhuma consulta sem `cliente_id`.** Não existe `findUnique({where:
 *     {id}})` aqui. Toda leitura e toda escrita usam o unique composto
 *     `[cliente_id, id]`;
 *  2. **o repositório não decide.** Não reserva número, não deriva
 *     `setor_nome`, não audita, não escolhe o que pode ser atualizado.
 *
 * `tx` é parâmetro explícito em toda escrita: a criação participa da MESMA
 * transação da reserva de número, da leitura do setor e da auditoria.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * Campos devolvidos ao cliente HTTP.
 *
 * Lista literal, nunca spread do registro: campo novo no model precisa ser
 * publicado de propósito.
 */
const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  setor_id: true,
  setor_nome: true,
  numero_area: true,
  nome: true,
  sigla: true,
  tamanho_hectares: true,
  area_pastejada: true,
  capacidade_maxima: true,
  tipo_pastagem: true,
  aproveitamento_classificacao: true,
  tipo_cultura: true,
  cor: true,
  quantidade_atual: true,
  status_ocupacao: true,
  forragem_kg_ha: true,
  taxa_crescimento_kg_ha_dia: true,
  taxa_aproveitamento: true,
  periodo_estacao: true,
  coordenadas: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Lista as áreas do tenant.
 *
 * Ordem por `createdAt`, como em Setor e pelo mesmo motivo: `numero_area` é
 * String (legado da Base44), então ordem alfabética colocaria "10" antes de
 * "2". A ordem de criação é a ordem em que os números foram atribuídos.
 *
 * @param {string} clienteId
 */
export const listarAreas = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.areaPastagem.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * Busca uma área do tenant. `null` quando não existe **ou** quando pertence a
 * outro cliente — para quem pergunta, os dois casos são o mesmo.
 *
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarArea = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.areaPastagem.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * Insere a área. `id` é omitido de propósito — quem o produz é o
 * `@default(cuid())`, nunca o runtime e nunca o cliente HTTP.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} dados
 */
export const inserirArea = async (tx, dados) =>
  tx.areaPastagem.create({ data: dados, select: SELECAO });

/**
 * Insere várias áreas numa única ida ao banco e devolve as linhas criadas
 * (importação em bloco, D-PROD-90 R2). Mesmo SELECAO da inserção unitária.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object[]} lista
 */
export const inserirAreasEmLote = async (tx, lista) =>
  tx.areaPastagem.createManyAndReturn({ data: lista, select: SELECAO });

/**
 * Atualiza a área pelo unique composto.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarAreaPorId = async (tx, clienteId, id, dados) =>
  tx.areaPastagem.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/**
 * Propaga o nome novo do setor para as áreas que o citam.
 *
 * É a metade nativa do que `syncEntityReferences` fazia na Base44 — e é melhor
 * que ela em três pontos que importam: roda **dentro** da transação que renomeou
 * o setor, é escopada por `cliente_id`, e não depende de uma varredura que pode
 * falhar depois sem ninguém saber.
 *
 * `updateMany` e não N `update`: o número de áreas de um setor não tem teto, e
 * uma renomeação não deve custar uma ida ao banco por área.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} setorId
 * @param {string} setorNome
 * @returns {Promise<number>} quantas áreas foram atualizadas
 */
export const propagarNomeDoSetor = async (tx, clienteId, setorId, setorNome) => {
  const { count } = await tx.areaPastagem.updateMany({
    where: { cliente_id: clienteId, setor_id: setorId },
    data: { setor_nome: setorNome },
  });
  return count;
};

/**
 * Gado por área, numa consulta agregada por tenant (G4).
 *
 * A fonte é a MESMA do Mapa Geral (`mapaCacheService.lotes`): empresa com o
 * ledger de rebanho ativado (`RebanhoLedgerAtivacao`) mostra as POSIÇÕES com
 * saldo (`PosicaoRebanho.quantidade_cabecas > 0`); as demais mostram os lotes
 * `status = 'Ativo'` (não excluídos) pela `area_atual_id`. Só conta gado da
 * mesma empresa da área, como o mapa, que filtra lotes e áreas pela empresa
 * selecionada.
 *
 * @param {string} clienteId
 * @param {{areaIds?: string[] | null, tx?: import('@prisma/client').Prisma.TransactionClient}} [opcoes]
 * @returns {Promise<Map<string, {cabecas: number, kg: number}>>}
 */
export const gadoPorArea = async (clienteId, { areaIds = null, tx } = {}) => {
  const cliente = tx || getPrismaClient();
  if (Array.isArray(areaIds) && areaIds.length === 0) return new Map();
  const soAreas = Array.isArray(areaIds) ? Prisma.sql`AND a.id = ANY(${areaIds}::text[])` : Prisma.empty;
  const linhas = /** @type {Array<{area_id: string, cabecas: number, kg: number}>} */ (await cliente.$queryRaw`
    WITH ledger AS (
      SELECT empresa_id FROM "RebanhoLedgerAtivacao" WHERE cliente_id = ${clienteId}
    ), gado AS (
      SELECT p.area_id, p.quantidade_cabecas AS cab, COALESCE(p.peso_medio_kg, 0) AS peso
        FROM "PosicaoRebanho" p
        JOIN "AreaPastagem" a ON a.cliente_id = p.cliente_id AND a.id = p.area_id AND a.empresa_id = p.empresa_id
       WHERE p.cliente_id = ${clienteId} ${soAreas}
         AND p.quantidade_cabecas > 0
         AND p.empresa_id IN (SELECT empresa_id FROM ledger)
      UNION ALL
      SELECT l.area_atual_id AS area_id, l.quantidade_cabecas AS cab, COALESCE(l.peso_medio_kg, 0) AS peso
        FROM "Lote" l
        JOIN "AreaPastagem" a ON a.cliente_id = l.cliente_id AND a.id = l.area_atual_id AND a.empresa_id = l.empresa_id
       WHERE l.cliente_id = ${clienteId} ${soAreas}
         AND l.status = 'Ativo' AND l.excluido_em IS NULL
         AND l.quantidade_cabecas > 0
         AND l.empresa_id NOT IN (SELECT empresa_id FROM ledger)
    )
    SELECT area_id, SUM(cab)::float8 AS cabecas, SUM(cab * peso)::float8 AS kg
      FROM gado
     GROUP BY area_id`);
  return new Map(linhas.map((l) => [l.area_id, { cabecas: Number(l.cabecas) || 0, kg: Number(l.kg) || 0 }]));
};

/**
 * Áreas do tenant pelos ids, travadas `FOR UPDATE` (renumeração, G4). Devolve
 * só as que existem neste tenant.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string[]} ids
 */
export const travarAreasPorIds = async (tx, clienteId, ids) => {
  await tx.$queryRaw`SELECT id FROM "AreaPastagem" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  return tx.areaPastagem.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: SELECAO });
};

/**
 * Áreas do tenant FORA da lista que já usam algum dos códigos pedidos.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string[]} codigos
 * @param {string[]} idsDaLista
 */
export const areasComCodigos = async (tx, clienteId, codigos, idsDaLista) =>
  tx.areaPastagem.findMany({
    where: { cliente_id: clienteId, numero_area: { in: codigos }, id: { notIn: idsDaLista } },
    select: { id: true, nome: true, numero_area: true, ativo: true },
  });

/**
 * Fase 1 da troca de códigos: tira as áreas da lista do caminho com um valor
 * temporário próprio de cada uma (`#` + hash do id), para que trocas entre
 * elas (1↔2) não batam no unique `[cliente_id, numero_area]` no meio.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string[]} ids
 */
export const liberarCodigos = async (tx, clienteId, ids) =>
  tx.$executeRaw`
    UPDATE "AreaPastagem" SET numero_area = '#' || left(md5(id), 31)
     WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[])`;

/**
 * Mantém a sequência de `numero_area` à frente do maior código numérico do
 * tenant: depois de uma renumeração para códigos altos, a próxima área criada
 * não pode receber um número que já existe.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{clienteId: string, entidade: string, escopoTipo: string, escopoId: string}} chave
 */
export const alinharSequenciaAoMaiorCodigo = async (tx, { clienteId, entidade, escopoTipo, escopoId }) =>
  tx.$executeRaw`
    UPDATE "EntidadeCodigoSequencia"
       SET proximo_valor = GREATEST(proximo_valor, (
             SELECT COALESCE(MAX(numero_area::int), 0) + 1 FROM "AreaPastagem"
              WHERE cliente_id = ${clienteId} AND numero_area ~ '^[0-9]{1,9}$'
           )),
           "updatedAt" = NOW()
     WHERE cliente_id = ${clienteId} AND entidade = ${entidade}
       AND escopo_tipo = ${escopoTipo} AND escopo_id = ${escopoId}`;

/**
 * A área mudou de setor: as tarefas dela que ainda carregam o setor ANTERIOR
 * da área (o `setor_nome` da tarefa é o da área na atribuição —
 * lancamentoTarefaService) acompanham. Tarefa com setor próprio fica.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {{areaId: string, setorNomeAnterior: string, setorNomeNovo: string}} troca
 * @returns {Promise<string[]>} ids das tarefas atualizadas
 */
export const propagarSetorDaAreaParaTarefas = async (tx, clienteId, { areaId, setorNomeAnterior, setorNomeNovo }) => {
  const linhas = /** @type {Array<{id: string}>} */ (await tx.$queryRaw`
    UPDATE "LancamentoTarefa" SET setor_nome = ${setorNomeNovo}, "updatedAt" = (now() AT TIME ZONE 'UTC')
     WHERE cliente_id = ${clienteId} AND area_id = ${areaId} AND setor_nome = ${setorNomeAnterior}
    RETURNING id`);
  return linhas.map((l) => l.id);
};
