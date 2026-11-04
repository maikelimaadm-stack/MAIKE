/**
 * D-PROD-122 (S1/H1) — inventário READ-ONLY de fatos futuros do ledger do rebanho.
 *
 * Para cada empresa ATIVADA no ledger, com fuso IANA configurado, aponta:
 *  - eventos ativos com data_operacional posterior a "hoje" no fuso da fazenda
 *    (tipo, data, registro, posições/áreas tocadas e quantos fatos posteriores
 *    tocam as mesmas posições — a cadeia a avaliar antes de qualquer reparo);
 *  - posições cuja projeção (PosicaoRebanho.quantidade_cabecas) difere do saldo
 *    até hoje (SUM(delta) com data <= hoje), separando a divergência causada por
 *    fato futuro ("fato_futuro") de projeção que nem bate com a soma total
 *    ("projecao_inconsistente", outro problema);
 *  - pesos ativos com data futura (a projeção usa a última observação).
 * Empresas ativadas SEM fuso saem em `empresas_sem_fuso`: não se inventaria
 * por um fuso inventado.
 *
 * NÃO conserta nada. Roda inteiro numa transação `READ ONLY` (o PostgreSQL
 * recusa qualquer escrita, inclusive acidental). Sem `mostrarIds`, ids saem
 * como hash curto e nenhum nome é exposto.
 */

import { createHash } from 'node:crypto';

import { diaNoFuso, normalizarFusoIana } from '../../backend/src/modules/rebanhoLedger/rebanhoLedgerTempo.js';

export const LIMITE_PADRAO = 200;

const hashCurto = (v) => (v === null || v === undefined ? null : `h:${createHash('sha256').update(String(v)).digest('hex').slice(0, 12)}`);
const diaDoBanco = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const n = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Executa `fn` numa transação somente leitura (REPEATABLE READ, READ ONLY).
 * @template T
 * @param {any} prisma
 * @param {(tx: any) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const executarSomenteLeitura = (prisma, fn) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return fn(tx);
  }, { timeout: 120_000, maxWait: 10_000 });

/**
 * @param {any} prisma
 * @param {{agora?: Date, mostrarIds?: boolean, limite?: number}} [opcoes]
 */
export const inventariarFuturosRebanho = (prisma, { agora = new Date(), mostrarIds = false, limite = LIMITE_PADRAO } = {}) =>
  executarSomenteLeitura(prisma, async (tx) => {
    const id = mostrarIds ? (v) => v ?? null : hashCurto;
    const ativadas = /** @type {Array<{cliente_id: string, empresa_id: string, fuso_horario: string|null, modo: string}>} */ (await tx.$queryRaw`
      SELECT a.cliente_id, a.empresa_id, e.fuso_horario, a.modo
        FROM "RebanhoLedgerAtivacao" a
        JOIN "Empresa" e ON e.cliente_id = a.cliente_id AND e.id = a.empresa_id
       ORDER BY a.cliente_id, a.empresa_id`);
    const empresas = [];
    const semFuso = [];
    for (const a of ativadas) {
      const fuso = normalizarFusoIana(a.fuso_horario);
      if (!fuso) {
        semFuso.push({ cliente_id: id(a.cliente_id), empresa_id: id(a.empresa_id) });
        continue;
      }
      const hoje = diaNoFuso(agora, fuso);

      const eventos = /** @type {Array<any>} */ (await tx.$queryRaw`
        SELECT ev.id, ev.tipo, ev.data_operacional, ev.registrado_em, ev.movimentacao_id,
               COALESCE(array_agg(DISTINCT x.posicao_id) FILTER (WHERE x.posicao_id IS NOT NULL), '{}') AS posicoes,
               COALESCE(array_agg(DISTINCT p.area_id) FILTER (WHERE p.area_id IS NOT NULL), '{}') AS areas,
               COALESCE(SUM(x.delta), 0)::int AS delta_total
          FROM "EventoRebanho" ev
          LEFT JOIN "PartidaRebanho" x ON x.cliente_id = ev.cliente_id AND x.evento_id = ev.id AND x.ativa
          LEFT JOIN "PosicaoRebanho" p ON p.cliente_id = x.cliente_id AND p.id = x.posicao_id
         WHERE ev.cliente_id = ${a.cliente_id} AND ev.empresa_id = ${a.empresa_id}
           AND ev.situacao = 'ativo' AND ev.data_operacional > ${hoje}::date
         GROUP BY ev.id
         ORDER BY ev.data_operacional, ev.registrado_em, ev.id
         LIMIT ${limite + 1}`);
      const eventosFuturos = [];
      for (const ev of eventos.slice(0, limite)) {
        const [dep] = /** @type {Array<{n: number}>} */ (await tx.$queryRaw`
          SELECT COUNT(DISTINCT e2.id)::int AS n
            FROM "PartidaRebanho" q
            JOIN "EventoRebanho" e2 ON e2.cliente_id = q.cliente_id AND e2.id = q.evento_id
           WHERE q.cliente_id = ${a.cliente_id} AND q.ativa AND e2.situacao = 'ativo' AND e2.id <> ${ev.id}
             AND q.posicao_id = ANY(${ev.posicoes}::text[])
             AND (e2.data_operacional, e2.registrado_em, e2.id) > (${ev.data_operacional}::date, ${ev.registrado_em}::timestamptz, ${ev.id})`);
        eventosFuturos.push({
          evento_id: id(ev.id),
          movimentacao_id: id(ev.movimentacao_id),
          tipo: ev.tipo,
          data_operacional: diaDoBanco(ev.data_operacional),
          registrado_em: ev.registrado_em instanceof Date ? ev.registrado_em.toISOString() : String(ev.registrado_em),
          delta_total: ev.delta_total,
          posicoes: ev.posicoes.map(id),
          areas: ev.areas.map(id),
          fatos_posteriores_nas_mesmas_posicoes: dep?.n ?? 0,
        });
      }

      const posicoes = /** @type {Array<any>} */ (await tx.$queryRaw`
        SELECT p.id, p.area_id, p.categoria, p.quantidade_cabecas AS projecao,
               COALESCE(SUM(x.delta) FILTER (WHERE x.data_operacional <= ${hoje}::date), 0)::int AS ate_hoje,
               COALESCE(SUM(x.delta) FILTER (WHERE x.data_operacional > ${hoje}::date), 0)::int AS futuro,
               COALESCE(SUM(x.delta), 0)::int AS soma_total
          FROM "PosicaoRebanho" p
          LEFT JOIN "PartidaRebanho" x ON x.cliente_id = p.cliente_id AND x.posicao_id = p.id AND x.ativa
         WHERE p.cliente_id = ${a.cliente_id} AND p.empresa_id = ${a.empresa_id}
         GROUP BY p.id
         ORDER BY p.id`);
      const divergentes = posicoes
        .filter((p) => p.projecao !== p.ate_hoje || p.projecao !== p.soma_total)
        .map((p) => ({
          posicao_id: id(p.id),
          area_id: id(p.area_id),
          categoria: p.categoria ?? null,
          projecao: p.projecao,
          ate_hoje: p.ate_hoje,
          futuro: p.futuro,
          soma_total: p.soma_total,
          causa: p.projecao === p.soma_total ? 'fato_futuro' : 'projecao_inconsistente',
        }));

      const pesos = /** @type {Array<any>} */ (await tx.$queryRaw`
        SELECT w.posicao_id, w.data_operacional, w.peso_medio_kg, w.evento_id
          FROM "PesoRebanho" w
         WHERE w.cliente_id = ${a.cliente_id} AND w.empresa_id = ${a.empresa_id} AND w.ativa AND w.data_operacional > ${hoje}::date
         ORDER BY w.data_operacional, w.posicao_id
         LIMIT ${limite + 1}`);

      empresas.push({
        cliente_id: id(a.cliente_id),
        empresa_id: id(a.empresa_id),
        modo: a.modo,
        fuso,
        hoje,
        eventos_futuros: eventosFuturos,
        eventos_futuros_truncados: eventos.length > limite,
        posicoes_divergentes: divergentes.slice(0, limite),
        posicoes_divergentes_truncadas: divergentes.length > limite,
        pesos_futuros: pesos.slice(0, limite).map((w) => ({ posicao_id: id(w.posicao_id), evento_id: id(w.evento_id), data_operacional: diaDoBanco(w.data_operacional), peso_medio_kg: n(w.peso_medio_kg) })),
        pesos_futuros_truncados: pesos.length > limite,
        total_projecao: posicoes.reduce((t, p) => t + p.projecao, 0),
        total_ate_hoje: posicoes.reduce((t, p) => t + p.ate_hoje, 0),
      });
    }
    return {
      gerado_em: agora.toISOString(),
      somente_leitura: true,
      ids: mostrarIds ? 'crus' : 'hash_curto',
      empresas,
      empresas_sem_fuso: semFuso,
      resumo: {
        empresas_ativadas: ativadas.length,
        empresas_sem_fuso: semFuso.length,
        empresas_com_futuros: empresas.filter((e) => e.eventos_futuros.length).length,
        eventos_futuros: empresas.reduce((t, e) => t + e.eventos_futuros.length, 0),
        posicoes_divergentes: empresas.reduce((t, e) => t + e.posicoes_divergentes.length, 0),
      },
    };
  });
