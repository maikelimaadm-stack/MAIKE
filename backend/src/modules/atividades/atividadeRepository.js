/**
 * Repositório do CABEÇALHO do Lançamento de Atividades (`Atividade`,
 * D-PROD-200, Fatia 2; contrato `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`).
 *
 * Adaptador de dados, sem regra: a lista keyset da empresa, a gravação na
 * transação de quem chama e as leituras curtas dos cadastros que a abertura e a
 * edição conferem antes de gravar (tipo com o grupo, os padrões e as flags;
 * área com o setor; máquina; tarefa) e as opções de máquina da tela. A busca
 * da atividade com os resumos, a trava (`FOR UPDATE`), os totais e o CAS por
 * `versao` são comuns ao apontamento e ficam em `atividadeComum.js`.
 *
 * Tenant SÓ do auth_context: toda função recebe o `clienteId` de quem chama,
 * nunca de corpo, query, params, cabeçalho ou cookie (R11). Nenhum módulo
 * ANTIGO importa daqui para consultar a tabela nova (lição do hotfix #259): a
 * exclusão de um cadastro usado por atividade é barrada pela FK RESTRICT,
 * traduzida em `shared/errors/vinculoAtividade.js`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { listarKeyset, paginarPorNome } from '../patrimonio/patrimonioComum.js';
import { FLAGS_TIPO_ATIVIDADE } from '../tiposAtividade/tipoAtividadePadroes.js';
import { BEM_RESUMO, INCLUIR_ATIVIDADE } from './atividadeComum.js';

/**
 * Lista keyset (`createdAt desc, id desc`) da empresa, com os resumos de
 * `INCLUIR_ATIVIDADE` — índices (cliente_id, empresa_id, createdAt, id) e
 * (cliente_id, empresa_id, status, createdAt, id). Envelope `{ items,
 * next_cursor, has_more, total, limit }` (o `total` ignora o cursor).
 * @param {{ where: Record<string, unknown>, busca: any[], query: Record<string, any>, mapItem: (r: any) => any }} pedido
 */
export const listarAtividades = ({ where, busca, query, mapItem }) =>
  listarKeyset(getPrismaClient().atividade, { where, busca, query, include: INCLUIR_ATIVIDADE, mapItem });

/**
 * D-PROD-234 — custo total de VÁRIAS atividades da empresa numa consulta só
 * (a coluna "Valor total" da lista, sem N+1): Σ das linhas CONFIRMADO de
 * apontamentos CONFIRMADO (produto e máquina pelo `custo_total`, mão de obra
 * pelo `custo_total`, serviço pelo `valor_total`) + Σ dos abastecimentos
 * CONFIRMADO ligados à atividade — as MESMAS parcelas do `custo_total` de
 * `GET /atividades/:id/totais`. A linha sem custo (máquina ou mão de obra sem
 * custo no cadastro) não soma; a atividade sem nenhuma parcela com custo não
 * aparece (o service a devolve com `null`). Decimal como texto.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string[]} atividadeIds
 * @returns {Promise<Array<{ atividade_id: string, custo_total: string|null }>>}
 */
export const custosTotaisDasAtividades = (db, clienteId, empresaId, atividadeIds) =>
  db.$queryRaw`SELECT x.atividade_id, SUM(x.custo)::text AS custo_total FROM (
      SELECT a.atividade_id, p.custo_total AS custo
        FROM "AtividadeApontamentoProduto" p
        JOIN "AtividadeApontamento" a ON a.cliente_id = p.cliente_id AND a.empresa_id = p.empresa_id AND a.id = p.apontamento_id
        WHERE p.cliente_id = ${clienteId} AND p.empresa_id = ${empresaId} AND a.atividade_id = ANY(${atividadeIds}::text[])
          AND p.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_id, m.custo_total AS custo
        FROM "AtividadeApontamentoMaquina" m
        JOIN "AtividadeApontamento" a ON a.cliente_id = m.cliente_id AND a.empresa_id = m.empresa_id AND a.id = m.apontamento_id
        WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${empresaId} AND a.atividade_id = ANY(${atividadeIds}::text[])
          AND m.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_id, l.custo_total AS custo
        FROM "AtividadeApontamentoMaoObra" l
        JOIN "AtividadeApontamento" a ON a.cliente_id = l.cliente_id AND a.empresa_id = l.empresa_id AND a.id = l.apontamento_id
        WHERE l.cliente_id = ${clienteId} AND l.empresa_id = ${empresaId} AND a.atividade_id = ANY(${atividadeIds}::text[])
          AND l.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_id, l.valor_total AS custo
        FROM "AtividadeApontamentoServico" l
        JOIN "AtividadeApontamento" a ON a.cliente_id = l.cliente_id AND a.empresa_id = l.empresa_id AND a.id = l.apontamento_id
        WHERE l.cliente_id = ${clienteId} AND l.empresa_id = ${empresaId} AND a.atividade_id = ANY(${atividadeIds}::text[])
          AND l.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT ab.atividade_id, ab.custo_total AS custo
        FROM "AbastecimentoBem" ab
        WHERE ab.cliente_id = ${clienteId} AND ab.empresa_id = ${empresaId} AND ab.atividade_id = ANY(${atividadeIds}::text[])
          AND ab.status = 'CONFIRMADO'
    ) x
    GROUP BY x.atividade_id`;

/**
 * D-PROD-267 — o ANDAMENTO de várias atividades da empresa numa consulta só (a lista "uma linha por serviço", sem N+1):
 * por atividade e área da atividade, Σ `area_executada_dia`, o primeiro dia, o último dia (o maior entre
 * `data_operacional` e `data_termino`) e quantos lançamentos, só dos apontamentos CONFIRMADO. A atividade sem lançamento
 * confirmado não aparece. Decimal como texto; dias como `Date` de coluna `@db.Date`.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string[]} atividadeIds
 * @returns {Promise<Array<{ atividade_id: string, atividade_area_id: string|null, hectares: string|null, primeiro: Date, ultimo: Date, lancamentos: number }>>}
 */
export const andamentoDasAtividades = (db, clienteId, empresaId, atividadeIds) =>
  db.$queryRaw`SELECT a.atividade_id, a.atividade_area_id,
      SUM(a.area_executada_dia)::text AS hectares,
      MIN(a.data_operacional) AS primeiro,
      MAX(GREATEST(a.data_operacional, COALESCE(a.data_termino, a.data_operacional))) AS ultimo,
      COUNT(*)::int AS lancamentos
    FROM "AtividadeApontamento" a
    WHERE a.cliente_id = ${clienteId} AND a.empresa_id = ${empresaId} AND a.atividade_id = ANY(${atividadeIds}::text[]) AND a.status = 'CONFIRMADO'
    GROUP BY a.atividade_id, a.atividade_area_id`;

/**
 * D-PROD-267 — a categoria (o tipo fixo) ATUAL das operações de uma página da lista, numa consulta só.
 * @param {any} db @param {string} clienteId @param {string[]} tipoIds
 * @returns {Promise<Array<{ id: string, categoria: string|null }>>}
 */
export const categoriasDosTipos = (db, clienteId, tipoIds) =>
  db.tipoAtividade.findMany({ where: { cliente_id: clienteId, id: { in: tipoIds } }, select: { id: true, categoria: true } });

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirAtividade = (tx, dados) => tx.atividade.create({ data: dados, select: { id: true } });

/**
 * A fazenda de uma atividade do TENANT (o PATCH sem `empresa_id` no corpo usa a
 * da própria atividade). Outro tenant dá o mesmo `null` do inexistente.
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ empresa_id: string } | null>}
 */
export const lerEmpresaDaAtividade = (tx, clienteId, id) =>
  tx.atividade.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } }, select: { empresa_id: true } });

/**
 * Tipo de atividade pela chave do TENANT, com o que a abertura usa: situação,
 * nome e grupo (com a situação do grupo) para os snapshots; os 3 padrões com
 * empresa e situação, como `padroesParaAtividade` os confere (D-PROD-197), e a
 * sigla da unidade; as 8 flags (`regrasDoTipo`). Id de outro tenant dá o mesmo
 * `null` do inexistente (sem oráculo).
 * @param {any} tx @param {string} clienteId @param {string} id
 */
export const lerTipoAtividade = (tx, clienteId, id) =>
  tx.tipoAtividade.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: {
      id: true,
      nome_tipo: true,
      ativo: true,
      grupo_atividade_id: true,
      grupo: { select: { id: true, nome_grupo: true, ativo: true } },
      centroCustoPadrao: { select: { id: true, empresa_id: true, ativo: true } },
      centroResultadoPadrao: { select: { id: true, empresa_id: true, ativo: true } },
      unidadeProducao: { select: { id: true, sigla: true, ativo: true } },
      ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((flag) => [flag, true])),
      // MAIKE-ENTREGA2 (D-PROD-269): o tipo fixo (os campos de cada tipo no registro de campo) e o alvo da Aplicação.
      categoria: true,
      alvo: true,
    },
  });

/**
 * Área do TENANT: fazenda, situação e o setor dela (o setor da atividade é
 * herdado daqui, nunca digitado). A tabela antiga só tem unique (cliente_id, id).
 * @param {any} tx @param {string} clienteId @param {string} id
 * D-PROD-249: e o tamanho (a área planejada padrão de cada área da atividade).
 * @returns {Promise<{ empresa_id: string, ativo: boolean, setor_id: string, setor_nome: string, tamanho_hectares: unknown } | null>}
 */
export const lerArea = (tx, clienteId, id) =>
  tx.areaPastagem.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: { empresa_id: true, ativo: true, setor_id: true, setor_nome: true, tamanho_hectares: true },
  });

/**
 * Máquina (bem) do TENANT: fazenda, situação e natureza (só MAQUINA, VEICULO ou EQUIPAMENTO servem de máquina).
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ empresa_id: string, ativo: boolean, natureza: string } | null>}
 */
export const lerBem = (tx, clienteId, id) =>
  tx.bemPatrimonial.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } }, select: { empresa_id: true, ativo: true, natureza: true } });

/**
 * Tarefa de origem (`LancamentoTarefa`, a demanda) do TENANT: fazenda (a tabela
 * antiga só tem unique (cliente_id, id); a tarefa não tem situação ativa).
 * @param {any} tx @param {string} clienteId @param {string} id
 * @returns {Promise<{ empresa_id: string } | null>}
 */
export const lerLancamentoTarefa = (tx, clienteId, id) =>
  tx.lancamentoTarefa.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } }, select: { empresa_id: true } });

/**
 * Página das máquinas ATIVAS da empresa para o seletor da tela, keyset (nome,
 * id) crescente; `naturezas` filtra (uma ou várias); `q` (literal, já
 * escapado) em nome, número ou código de frota. Envelope `{ itens, has_more,
 * next_cursor }`.
 * @param {{ clienteId: string, empresaId: string, naturezas: string[], q: string, limit: number,
 *   cursor: { nome: string, id: string } | null, mapear: (linhas: any[]) => any[] }} pedido
 */
export const paginarBensAtivos = ({ clienteId, empresaId, naturezas, q, limit, cursor, mapear }) => {
  /** @type {any[]} */
  const filtros = [{ cliente_id: clienteId, empresa_id: empresaId, ativo: true }];
  if (naturezas.length) filtros.push({ natureza: { in: naturezas } });
  if (q) {
    filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }, { codigo_frota: { contains: q, mode: 'insensitive' } }] });
  }
  return paginarPorNome(getPrismaClient().bemPatrimonial, { where: { AND: filtros }, select: BEM_RESUMO.select, limit, cursor, mapear });
};
