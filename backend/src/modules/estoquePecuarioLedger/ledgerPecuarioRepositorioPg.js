/**
 * Repositório PostgreSQL do ledger pecuário (L1, SQL parametrizado).
 *
 * Opera sobre as tabelas da DDL proposta (`ledgerPecuarioDdl.js`) num esquema
 * descartável. Toda função recebe o `tx` da transação interativa do Prisma —
 * nada aqui abre transação própria. O nome do esquema passa por
 * `esquemaSeguro` (identificador validado); valores vão sempre como parâmetro.
 */

import { esquemaSeguro } from './ledgerPecuarioDdl.js';

/**
 * @typedef {{ $queryRawUnsafe: Function, $executeRawUnsafe: Function }} ClienteSql
 * @typedef {{ area_id: string, categoria_chave: string }} ChavePosicao
 */

/**
 * Garante a linha da posição (saldo 0) para poder travá-la com FOR UPDATE.
 * ON CONFLICT DO NOTHING: duas transações criando a mesma posição não falham.
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {ChavePosicao} chave
 */
export const garantirPosicao = async (tx, esquema, clienteId, empresaId, chave) => {
  const s = esquemaSeguro(esquema);
  await tx.$executeRawUnsafe(
    `INSERT INTO ${s}.ledger_pecuario_posicao (cliente_id, empresa_id, area_id, categoria_chave)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    clienteId,
    empresaId,
    chave.area_id,
    chave.categoria_chave
  );
};

/**
 * Trava UMA posição (SELECT … FOR UPDATE) e devolve o saldo atual. O chamador
 * trava em ordem determinística (`chavesDeTravaOrdenadas`) — uma por vez,
 * para que a ordem de aquisição seja exatamente a ordem pedida.
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {ChavePosicao} chave
 * @returns {Promise<number>}
 */
export const travarPosicao = async (tx, esquema, clienteId, empresaId, chave) => {
  const s = esquemaSeguro(esquema);
  /** @type {Array<{ saldo: number }>} */
  const linhas = await tx.$queryRawUnsafe(
    `SELECT saldo FROM ${s}.ledger_pecuario_posicao
     WHERE cliente_id = $1 AND empresa_id = $2 AND area_id = $3 AND categoria_chave = $4
     FOR UPDATE`,
    clienteId,
    empresaId,
    chave.area_id,
    chave.categoria_chave
  );
  return linhas.length ? Number(linhas[0].saldo) : 0;
};

/**
 * Atualização condicional: só aplica se o saldo resultante não for negativo.
 * Com a linha já travada isso é redundante — e é de propósito: é a segunda
 * barreira (junto do CHECK saldo >= 0) caso alguém um dia esqueça a trava.
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {ChavePosicao & { delta: number }} partida
 * @returns {Promise<number | null>} saldo novo, ou null se recusado
 */
export const aplicarDeltaPosicao = async (tx, esquema, clienteId, empresaId, partida) => {
  const s = esquemaSeguro(esquema);
  /** @type {Array<{ saldo: number }>} */
  const linhas = await tx.$queryRawUnsafe(
    `UPDATE ${s}.ledger_pecuario_posicao
        SET saldo = saldo + $5::int, versao = versao + 1, atualizado_em = now()
      WHERE cliente_id = $1 AND empresa_id = $2 AND area_id = $3 AND categoria_chave = $4
        AND saldo + $5::int >= 0
      RETURNING saldo`,
    clienteId,
    empresaId,
    partida.area_id,
    partida.categoria_chave,
    partida.delta
  );
  return linhas.length ? Number(linhas[0].saldo) : null;
};

/**
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {{
 *   cliente_id: string, empresa_id: string, tipo: string, operation_id: string,
 *   data_operacional: string, quantidade: number, categoria_chave: string,
 *   area_origem_id: string | null, area_destino_id: string | null,
 *   lote_referencia_id: string | null, estorno_de_evento_id: string | null,
 *   motivo: string | null, autor_usuario_id: string, request_id: string | null,
 * }} evento
 * @returns {Promise<Record<string, unknown>>}
 */
export const inserirEvento = async (tx, esquema, evento) => {
  const s = esquemaSeguro(esquema);
  // A PK vem do DEFAULT do banco (gate:tenancy P3-TEN-RUNTIME-IDENTITY).
  /** @type {Array<Record<string, unknown>>} */
  const linhas = await tx.$queryRawUnsafe(
    `INSERT INTO ${s}.ledger_pecuario_evento
       (cliente_id, empresa_id, tipo, operation_id, data_operacional, quantidade, categoria_chave,
        area_origem_id, area_destino_id, lote_referencia_id, estorno_de_evento_id, motivo,
        autor_usuario_id, request_id)
     VALUES ($1, $2, $3, $4, $5::date, $6::int, $7, $8, $9, $10, $11::bigint, $12, $13, $14)
     RETURNING id::text AS id, cliente_id, empresa_id, tipo, operation_id, to_char(data_operacional, 'YYYY-MM-DD') AS data_operacional,
               quantidade, categoria_chave, area_origem_id, area_destino_id, lote_referencia_id,
               estorno_de_evento_id::text AS estorno_de_evento_id, motivo, autor_usuario_id, request_id, created_at`,
    evento.cliente_id,
    evento.empresa_id,
    evento.tipo,
    evento.operation_id,
    evento.data_operacional,
    evento.quantidade,
    evento.categoria_chave,
    evento.area_origem_id,
    evento.area_destino_id,
    evento.lote_referencia_id,
    evento.estorno_de_evento_id,
    evento.motivo,
    evento.autor_usuario_id,
    evento.request_id
  );
  return linhas[0];
};

/**
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {{ evento_id: string, cliente_id: string, empresa_id: string }} base
 * @param {Array<ChavePosicao & { delta: number }>} partidas
 */
export const inserirPartidas = async (tx, esquema, base, partidas) => {
  const s = esquemaSeguro(esquema);
  for (const p of partidas) {
    await tx.$executeRawUnsafe(
      `INSERT INTO ${s}.ledger_pecuario_partida (evento_id, cliente_id, empresa_id, area_id, categoria_chave, delta)
       VALUES ($1::bigint, $2, $3, $4, $5, $6::int)`,
      base.evento_id,
      base.cliente_id,
      base.empresa_id,
      p.area_id,
      p.categoria_chave,
      p.delta
    );
  }
};

/**
 * Evento + partidas, travando o evento (serializa estornos concorrentes do
 * mesmo original). Escopo SEMPRE pelo tenant.
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} eventoId
 */
export const buscarEventoParaEstorno = async (tx, esquema, clienteId, eventoId) => {
  const s = esquemaSeguro(esquema);
  // PK da prova de conceito é bigint (identity); ID fora do formato = não existe.
  if (!/^\d{1,18}$/.test(eventoId)) return null;
  /** @type {Array<Record<string, any>>} */
  const eventos = await tx.$queryRawUnsafe(
    `SELECT id::text AS id, empresa_id, tipo, quantidade, categoria_chave, area_origem_id, area_destino_id
       FROM ${s}.ledger_pecuario_evento WHERE cliente_id = $1 AND id = $2::bigint FOR UPDATE`,
    clienteId,
    eventoId
  );
  if (!eventos.length) return null;
  /** @type {Array<{ area_id: string, categoria_chave: string, delta: number }>} */
  const partidas = await tx.$queryRawUnsafe(
    `SELECT area_id, categoria_chave, delta FROM ${s}.ledger_pecuario_partida
      WHERE cliente_id = $1 AND evento_id = $2::bigint ORDER BY delta ASC, area_id ASC`,
    clienteId,
    eventoId
  );
  /** @type {Array<{ id: string }>} */
  const estorno = await tx.$queryRawUnsafe(
    `SELECT id::text AS id FROM ${s}.ledger_pecuario_evento WHERE cliente_id = $1 AND estorno_de_evento_id = $2::bigint`,
    clienteId,
    eventoId
  );
  const e = eventos[0];
  return {
    evento: { ...e, quantidade: Number(e.quantidade) },
    partidas: partidas.map((p) => ({ area_id: p.area_id, categoria_chave: p.categoria_chave, delta: Number(p.delta) })),
    jaEstornado: estorno.length > 0,
  };
};

/**
 * Lote já tem ENTRADA ativa (não estornada)? Evita contar a mesma compra 2x.
 * @param {ClienteSql} tx
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} loteId
 */
export const loteTemEntradaAtiva = async (tx, esquema, clienteId, loteId) => {
  const s = esquemaSeguro(esquema);
  /** @type {Array<{ n: number }>} */
  const linhas = await tx.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM ${s}.ledger_pecuario_evento e
      WHERE e.cliente_id = $1 AND e.tipo = 'ENTRADA' AND e.lote_referencia_id = $2
        AND NOT EXISTS (SELECT 1 FROM ${s}.ledger_pecuario_evento x
                         WHERE x.cliente_id = e.cliente_id AND x.estorno_de_evento_id = e.id)`,
    clienteId,
    loteId
  );
  return Number(linhas[0]?.n ?? 0) > 0;
};

/**
 * Posições (projeção atual) de uma empresa, saldo > 0, ordem estável.
 * @param {ClienteSql} db
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} empresaId
 */
export const listarPosicoes = async (db, esquema, clienteId, empresaId) => {
  const s = esquemaSeguro(esquema);
  /** @type {Array<{ area_id: string, categoria_chave: string, saldo: number }>} */
  const linhas = await db.$queryRawUnsafe(
    `SELECT area_id, categoria_chave, saldo FROM ${s}.ledger_pecuario_posicao
      WHERE cliente_id = $1 AND empresa_id = $2 AND saldo > 0
      ORDER BY area_id, categoria_chave`,
    clienteId,
    empresaId
  );
  return linhas.map((l) => ({ area_id: l.area_id, categoria_chave: l.categoria_chave, saldo: Number(l.saldo) }));
};

/**
 * Projeção RECONSTRUÍDA dos fatos (soma das partidas) — O(n) com o índice da
 * posição. Usada para provar que a projeção materializada não divergiu.
 * @param {ClienteSql} db
 * @param {string} esquema
 * @param {string} clienteId
 * @param {string} empresaId
 */
export const reconstruirPosicoesDosFatos = async (db, esquema, clienteId, empresaId) => {
  const s = esquemaSeguro(esquema);
  /** @type {Array<{ area_id: string, categoria_chave: string, saldo: number }>} */
  const linhas = await db.$queryRawUnsafe(
    `SELECT area_id, categoria_chave, sum(delta)::int AS saldo FROM ${s}.ledger_pecuario_partida
      WHERE cliente_id = $1 AND empresa_id = $2
      GROUP BY area_id, categoria_chave HAVING sum(delta) <> 0
      ORDER BY area_id, categoria_chave`,
    clienteId,
    empresaId
  );
  return linhas.map((l) => ({ area_id: l.area_id, categoria_chave: l.categoria_chave, saldo: Number(l.saldo) }));
};
