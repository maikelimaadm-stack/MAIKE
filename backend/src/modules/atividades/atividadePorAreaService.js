/**
 * D-PROD-254 — leituras do painel "Detalhes da área" (mapa) e do Histórico de registros de campo:
 *
 *  - `GET /atividades-por-area/:areaId/resumo?empresa_id` — as atividades da área (ABERTAS ou iniciadas no mês corrente
 *    da fazenda, nunca as CANCELADAS; ABERTAS primeiro, depois `data_inicio` desc; no máximo 20) e os custos da área no
 *    mês corrente (Σ das linhas CONFIRMADAS dos apontamentos CONFIRMADOS cuja área da atividade é esta, pelo
 *    `data_operacional`). Todo número vem do banco; nada é calculado no cliente. D-PROD-267: cada atividade traz também o
 *    `ultimo_dia` lançado nesta área (a prévia do "+ Lançar dia" e do "serviço parado").
 *  - `GET /atividades-por-area/:areaId/registros?empresa_id&limit&cursor&tipo_atividade_id` — os apontamentos CONFIRMADOS
 *    da área, mais recentes primeiro (dia, `createdAt`, `id` desc; cursor keyset), cada um com as linhas CONFIRMADAS.
 *    Uma consulta com `include` (sem N+1).
 *
 * Tenant só do auth_context; a fazenda é conferida no tenant e a área tem de ser dela (senão 404 `AREA_NOT_FOUND`).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { areaNotFound } from '../../shared/errors/AppError.js';
import { ID_DE_CURSOR, instanteSerializavel } from '../../shared/pagination/keysetCursor.js';
import { arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { STATUS_APONTAMENTO, STATUS_ATIVIDADE, TRANSACAO_LEITURA, comoData, diaDe, t4, tempoDaFazenda } from './atividadeComum.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { limitesDoMes } from './atividadeRegistroService.js';

export const LIMITE_REGISTROS_PADRAO = 20;
export const LIMITE_REGISTROS_MAXIMO = 50;
const LIMITE_ATIVIDADES_DO_RESUMO = 20;

/** @param {any} v @returns {string} */
const dinheiro = (v) => (v === null || v === undefined ? '0.00' : arredondar(dec(String(v)), 2).toFixed(2));

/**
 * A área é desta fazenda e deste tenant; senão 404.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} areaId
 */
const exigirAreaDaFazenda = async (tx, clienteId, empresaId, areaId) => {
  const area = await tx.areaPastagem.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: areaId } }, select: { empresa_id: true, tamanho_hectares: true } });
  if (!area || area.empresa_id !== empresaId) throw areaNotFound();
  return area;
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} areaId @param {Record<string, any>} query
 */
export const resumoDaArea = async (contexto, areaId, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const area = await exigirAreaDaFazenda(tx, cli, empresaId, areaId);
    const { hoje } = await tempoDaFazenda(tx, cli, empresaId);
    const { de, ate } = limitesDoMes(hoje);

    const atividades = /** @type {any[]} */ (
      await tx.atividade.findMany({
        where: {
          cliente_id: cli, empresa_id: empresaId, status: { not: STATUS_ATIVIDADE.CANCELADA },
          areas: { some: { area_id: areaId } },
          OR: [{ status: STATUS_ATIVIDADE.ABERTA }, { data_inicio: { gte: de, lt: ate } }],
        },
        // 'ABERTA' < 'CONCLUIDA': ordem alfabética = ABERTAS primeiro.
        orderBy: [{ status: 'asc' }, { data_inicio: 'desc' }, { id: 'desc' }],
        take: LIMITE_ATIVIDADES_DO_RESUMO,
        select: {
          id: true, numero: true, nome: true, tipo_atividade_id: true, tipo_atividade_nome: true, status: true, data_inicio: true, data_prevista_fim: true,
          areas: { where: { area_id: areaId }, select: { id: true, status: true, area_planejada: true } },
          // D-PROD-268: o capim do Plantio de pastagem (a prévia "Entra em…" usa a mesma regra do servidor).
          plantio: { select: { cultura_id: true } },
        },
      })
    );
    const idsDasAreas = atividades.flatMap((a) => a.areas.map((x) => x.id));
    const somas = idsDasAreas.length
      ? /** @type {any[]} */ (
          await tx.atividadeApontamento.groupBy({
            by: ['atividade_area_id'],
            where: { cliente_id: cli, empresa_id: empresaId, status: STATUS_APONTAMENTO.CONFIRMADO, atividade_area_id: { in: idsDasAreas } },
            _sum: { area_executada_dia: true },
            _max: { data_operacional: true, data_termino: true },
          })
        )
      : [];
    const feita = new Map(somas.map((s) => [s.atividade_area_id, s._sum.area_executada_dia]));
    // D-PROD-267: o último dia lançado na área em cada atividade (o maior entre o dia e o término).
    const ultimoDia = new Map(
      somas.map((s) => {
        const d = diaDe(s._max?.data_operacional) ?? null;
        const t = diaDe(s._max?.data_termino) ?? null;
        return [s.atividade_area_id, t && (!d || t > d) ? t : d];
      })
    );

    const deDia = comoData(`${hoje.slice(0, 7)}-01`);
    const linhas = /** @type {Array<{ tipo: string, total: any }>} */ (
      await tx.$queryRaw`
        SELECT x.tipo, COALESCE(SUM(x.total), 0) AS total FROM (
          SELECT 'insumos' AS tipo, l.custo_total AS total, l.apontamento_id, l.cliente_id, l.empresa_id FROM "AtividadeApontamentoProduto" l WHERE l.cliente_id = ${cli} AND l.empresa_id = ${empresaId} AND l.status = 'CONFIRMADO'
          UNION ALL
          SELECT 'maquinas', l.custo_total, l.apontamento_id, l.cliente_id, l.empresa_id FROM "AtividadeApontamentoMaquina" l WHERE l.cliente_id = ${cli} AND l.empresa_id = ${empresaId} AND l.status = 'CONFIRMADO'
          UNION ALL
          SELECT 'mao_obra', l.custo_total, l.apontamento_id, l.cliente_id, l.empresa_id FROM "AtividadeApontamentoMaoObra" l WHERE l.cliente_id = ${cli} AND l.empresa_id = ${empresaId} AND l.status = 'CONFIRMADO'
          UNION ALL
          SELECT 'servicos', l.valor_total, l.apontamento_id, l.cliente_id, l.empresa_id FROM "AtividadeApontamentoServico" l WHERE l.cliente_id = ${cli} AND l.empresa_id = ${empresaId} AND l.status = 'CONFIRMADO'
        ) x
        JOIN "AtividadeApontamento" a ON a.cliente_id = x.cliente_id AND a.empresa_id = x.empresa_id AND a.id = x.apontamento_id
        JOIN "AtividadeArea" aa ON aa.cliente_id = a.cliente_id AND aa.empresa_id = a.empresa_id AND aa.atividade_id = a.atividade_id AND aa.id = a.atividade_area_id
        WHERE a.status = 'CONFIRMADO' AND aa.area_id = ${areaId}
          AND a.data_operacional >= ${deDia}::date AND a.data_operacional < ${ate}::date
        GROUP BY x.tipo`
    );
    const por = Object.fromEntries(linhas.map((l) => [l.tipo, dec(String(l.total ?? 0))]));
    const parte = (/** @type {string} */ k) => por[k] ?? dec(0);
    const total = parte('insumos').plus(parte('maquinas')).plus(parte('mao_obra')).plus(parte('servicos'));
    const ha = dec(String(area.tamanho_hectares));
    return {
      area_id: areaId,
      mes: hoje.slice(0, 7),
      atividades: atividades.map((a) => {
        const aa = a.areas[0] ?? null;
        return {
          atividade_id: a.id,
          numero: a.numero,
          nome: a.nome,
          tipo_atividade_id: a.tipo_atividade_id,
          tipo_atividade_nome: a.tipo_atividade_nome,
          status: a.status,
          area_status: aa?.status ?? null,
          area_planejada: t4(aa?.area_planejada ?? null),
          area_executada: aa ? t4(feita.get(aa.id) ?? 0) : null,
          // D-PROD-267: o último dia lançado nesta área desta atividade (null sem lançamento): a prévia do "parado".
          ultimo_dia: aa ? ultimoDia.get(aa.id) ?? null : null,
          data_inicio: diaDe(a.data_inicio),
          data_prevista_fim: diaDe(a.data_prevista_fim),
          // D-PROD-268: o capim plantado (só no Plantio de pastagem; capim diferente abre outra atividade).
          plantio_cultura_id: a.plantio?.cultura_id ?? null,
        };
      }),
      custos: {
        custo_total: dinheiro(total),
        custo_por_ha: ha.gt(0) ? dinheiro(total.dividedBy(ha)) : null,
        area_ha: ha.gt(0) ? t4(ha) : null,
        insumos: dinheiro(parte('insumos')),
        maquinas: dinheiro(parte('maquinas')),
        mao_obra: dinheiro(parte('mao_obra')),
        servicos: dinheiro(parte('servicos')),
      },
    };
  });
};

/** @param {{ d: string, t: Date, i: string }} c */
const codificar = (c) => Buffer.from(JSON.stringify({ d: c.d, t: c.t.toISOString(), i: c.i }), 'utf8').toString('base64url');
/** @param {unknown} bruto @returns {{ d: string, t: Date, i: string } | null} */
const decodificar = (bruto) => {
  try {
    const p = JSON.parse(Buffer.from(String(bruto), 'base64url').toString('utf8'));
    const t = new Date(p?.t);
    if (typeof p?.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.d) || typeof p?.i !== 'string' || !ID_DE_CURSOR.test(p.i) || !instanteSerializavel(t)) return null;
    return { d: p.d, t, i: p.i };
  } catch {
    return null;
  }
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} areaId @param {Record<string, any>} query
 */
export const registrosDaArea = async (contexto, areaId, query = {}) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const limite = Math.min(Math.max(Math.floor(Number(query.limit ?? LIMITE_REGISTROS_PADRAO)) || LIMITE_REGISTROS_PADRAO, 1), LIMITE_REGISTROS_MAXIMO);
  const cursor = query.cursor === undefined ? null : decodificar(query.cursor);
  if (query.cursor !== undefined && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'formato' });
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    await exigirAreaDaFazenda(tx, cli, empresaId, areaId);
    const quando = cursor ? comoData(cursor.d) : null;
    const rows = /** @type {any[]} */ (
      await tx.atividadeApontamento.findMany({
        where: {
          cliente_id: cli, empresa_id: empresaId, status: STATUS_APONTAMENTO.CONFIRMADO,
          atividadeArea: { is: { area_id: areaId } },
          ...(typeof query.tipo_atividade_id === 'string' && query.tipo_atividade_id ? { atividade: { is: { tipo_atividade_id: query.tipo_atividade_id } } } : {}),
          ...(cursor
            ? {
                OR: [
                  { data_operacional: { lt: quando } },
                  { AND: [{ data_operacional: quando }, { createdAt: { lt: cursor.t } }] },
                  { AND: [{ data_operacional: quando }, { createdAt: cursor.t }, { id: { lt: cursor.i } }] },
                ],
              }
            : {}),
        },
        orderBy: [{ data_operacional: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: limite + 1,
        select: {
          id: true, data_operacional: true, data_termino: true, createdAt: true, area_executada_dia: true, observacao: true,
          operador: { select: { nome: true } },
          atividade: { select: { id: true, nome: true, tipo_atividade_id: true, tipo_atividade_nome: true } },
          maquinas: { where: { status: STATUS_APONTAMENTO.CONFIRMADO }, orderBy: { ordem: 'asc' }, select: { quantidade_uso: true, medidor_unidade: true, bem: { select: { nome: true } }, implemento: { select: { nome: true } } } },
          produtos: { where: { status: STATUS_APONTAMENTO.CONFIRMADO }, orderBy: { ordem: 'asc' }, select: { quantidade: true, unidade: true, dose_ha: true, produto: { select: { nome_produto: true } } } },
          maoObras: { where: { status: STATUS_APONTAMENTO.CONFIRMADO }, orderBy: { ordem: 'asc' }, select: { quantidade: true, tipo_medida: true, parceiro: { select: { nome: true } } } },
          servicos: { where: { status: STATUS_APONTAMENTO.CONFIRMADO }, orderBy: { ordem: 'asc' }, select: { quantidade: true, unidade: true, valor_total: true, servico: { select: { nome: true } } } },
        },
      })
    );
    const temMais = rows.length > limite;
    const pagina = temMais ? rows.slice(0, limite) : rows;
    const ultimo = pagina[pagina.length - 1];
    return {
      items: pagina.map((r) => ({
        id: r.id,
        data_operacional: diaDe(r.data_operacional),
        // D-PROD-265: o último dia do serviço (nulo = um dia só).
        data_termino: r.data_termino ? diaDe(r.data_termino) : null,
        atividade_id: r.atividade.id,
        atividade_nome: r.atividade.nome,
        tipo_atividade_id: r.atividade.tipo_atividade_id,
        tipo_atividade_nome: r.atividade.tipo_atividade_nome,
        area_executada_dia: t4(r.area_executada_dia),
        operador_nome: r.operador?.nome ?? null,
        observacao: r.observacao ?? null,
        maquinas: r.maquinas.map((l) => ({ bem_nome: l.bem.nome, implemento_nome: l.implemento?.nome ?? null, quantidade_uso: t4(l.quantidade_uso), unidade: l.medidor_unidade ?? null })),
        produtos: r.produtos.map((l) => ({ produto_nome: l.produto.nome_produto, quantidade: t4(l.quantidade), unidade: l.unidade, dose_ha: t4(l.dose_ha) })),
        mao_obra: r.maoObras.map((l) => ({ nome: l.parceiro.nome, quantidade: t4(l.quantidade), medida: l.tipo_medida })),
        servicos: r.servicos.map((l) => ({ nome: l.servico.nome, quantidade: t4(l.quantidade), unidade: l.unidade, valor: t4(l.valor_total) })),
      })),
      next_cursor: temMais && ultimo ? codificar({ d: /** @type {string} */ (diaDe(ultimo.data_operacional)), t: ultimo.createdAt, i: ultimo.id }) : null,
    };
  });
};
