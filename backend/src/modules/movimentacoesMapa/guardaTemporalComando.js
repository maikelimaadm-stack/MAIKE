/**
 * Guarda temporal de COMANDO NOVO retroativo — PR169-R2/R3 (D-PROD-104).
 *
 * O cancelamento compara contra um movimento que já existe (createdAt real) e
 * continua usando `dependenciasPosteriores` (lá createdAt e datas entram em
 * OU: data inválida só pode somar bloqueio, nunca esconder). Um comando novo
 * (Junção) ainda não tem createdAt; esta consulta é própria e explícita:
 *
 *   data CONFIÁVEL = texto que é, inteiro, uma data de calendário REAL:
 *     AAAA-MM-DD, ou ISO AAAA-MM-DDTHH:MM[:SS[.fff]][Z|±HH:MM] (mesma
 *     gramática de `dataOperacionalValida` do comando), com mês 01–12, dia
 *     existente naquele mês (bissexto incluído) e ano ≠ 0000. O dia
 *     operacional é o prefixo como foi escrito, sem converter fuso.
 *     2026-00-00, 2026-02-30, "2026-10-19texto", 25/10/2026 → NÃO confiável.
 *     A checagem é SQL puro em CASE aninhado: nunca lança erro.
 *
 *   data efetiva do registro (R3, conservadora) =
 *     GREATEST(todas as datas confiáveis dos campos da fonte,
 *              createdAt UTC — sempre que NENHUMA data é confiável OU algum
 *              campo de data está preenchido com valor NÃO confiável).
 *     Data impossível nunca prova anterioridade; data anterior nunca esconde
 *     data posterior de outro campo (GREATEST, não COALESCE).
 *   bloqueia quando data efetiva > data do comando (mesmo dia NÃO bloqueia:
 *   o comando é gravado agora, depois dos registros daquele dia).
 *
 *   Campos por fonte (só datas de evento REALIZADO; previsão não entra):
 *     MovimentacaoMapa.data_movimentacao; MovimentacaoPecuaria
 *     data_movimentacao e data_evento (sinônimos legados do dia do evento,
 *     sem prioridade semântica entre si: conflito → vale a MAIOR);
 *     SuplementacaoLote.data_lancamento; AplicacaoMedicamento.data_aplicacao;
 *     EventoSanitario.data_evento; ManejoTecnicoRebanho.data_evento.
 *   LancamentoTarefa: GREATEST(data_conclusao, data_inicio) (colunas tipadas);
 *   sem nenhuma → createdAt. data_prevista é previsão, não evento: não conta.
 *   Tarefa 'Cancelada' não bloqueia. MovimentacaoMapa 'cancelado' não bloqueia.
 *
 * Vínculo: o mesmo `movimentoCitaLotes` do histórico/exclusão (lote_id,
 * lote_destino_id, lote_ids, efeitos, matrizes) e, só para registro legado
 * SEM lote_id, o nome. Tenant e empresa sempre filtrados. Sem teto (COUNT).
 */

import { Prisma } from '@prisma/client';

import { movimentoCitaLotes } from './movimentacaoVinculoLote.js';
import { FONTES_DE_LOTE, SITUACAO_CANCELADO } from './movimentacaoMapaCancelamentoService.js';

/** Gramática aceita (texto inteiro): AAAA-MM-DD ou ISO com hora e fuso opcionais. */
export const PADRAO_DATA_CONFIAVEL =
  '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,3})?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?)?$';

/**
 * Dia AAAA-MM-DD de uma data de calendário REAL, ou NULL. CASE aninhado: os
 * casts só rodam depois que o regex garantiu dígitos — nunca lança erro.
 */
export const dataConfiavel = (expr) => Prisma.sql`(CASE WHEN COALESCE(${expr}, '') ~ ${PADRAO_DATA_CONFIAVEL} THEN
    CASE WHEN left(${expr}, 4) <> '0000'
          AND substr(${expr}, 9, 2)::int <= (CASE substr(${expr}, 6, 2)::int
                WHEN 2 THEN (CASE WHEN (left(${expr}, 4)::int % 4 = 0 AND left(${expr}, 4)::int % 100 <> 0) OR left(${expr}, 4)::int % 400 = 0 THEN 29 ELSE 28 END)
                WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)
         THEN left(${expr}, 10) END
  END)`;
const diaDeRegistro = (alias) => Prisma.sql`to_char(${Prisma.raw(alias)}."createdAt", 'YYYY-MM-DD')`;

/**
 * Data efetiva conservadora de um registro JSON com 1+ campos de data:
 * a MAIOR data confiável; createdAt entra quando nenhuma é confiável ou
 * algum campo preenchido não é confiável (GREATEST ignora NULL).
 */
export const dataEfetiva = (alias, campos) => {
  const exprs = campos.map((c) => Prisma.sql`${Prisma.raw(alias)}.dados->>${c}`);
  const confiaveis = exprs.map(dataConfiavel);
  const algumaConfiavel = Prisma.join(confiaveis.map((x) => Prisma.sql`${x} IS NOT NULL`), ' OR ');
  const nenhumInvalido = Prisma.join(
    exprs.map((e, i) => Prisma.sql`(btrim(COALESCE(${e}, '')) = '' OR ${confiaveis[i]} IS NOT NULL)`),
    ' AND '
  );
  return Prisma.sql`GREATEST(${Prisma.join(confiaveis, ', ')}, CASE WHEN (${algumaConfiavel}) AND ${nenhumInvalido} THEN NULL ELSE ${diaDeRegistro(alias)} END)`;
};

/** "AAAA-MM-DD" da data do comando (aceita AAAA-MM-DD ou ISO; o dia operacional é o do prefixo). */
export const diaOperacional = (valor) => String(valor ?? '').slice(0, 10);

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ loteIds: string[], nomes: string[], data: string }} filtro
 * @returns {Promise<Array<{fonte: string, quantidade: number}>>}
 */
export const registrosAtivosPosteriores = async (tx, clienteId, empresaId, { loteIds, nomes, data }) => {
  const dia = diaOperacional(data);
  const lotes = [...new Set(loteIds)];
  const nomesUp = [...new Set(nomes.filter(Boolean).map((n) => String(n).trim().toUpperCase()))];
  const encontrados = [];

  const [mapa] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "MovimentacaoMapa" m
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${empresaId}
         AND COALESCE(m.dados->>'situacao', '') <> ${SITUACAO_CANCELADO}
         AND (
           ${movimentoCitaLotes('m', lotes)}
           OR (COALESCE(m.dados->>'lote_id', '') = '' AND upper(btrim(COALESCE(m.dados->>'lote', ''))) = ANY(${nomesUp}::text[]))
         )
         AND ${dataEfetiva('m', ['data_movimentacao'])} > ${dia}`
  );
  if (mapa?.n) encontrados.push({ fonte: 'MovimentacaoMapa', quantidade: mapa.n });

  for (const fonte of FONTES_DE_LOTE) {
    const [linha] = /** @type {Array<{n: number}>} */ (
      await tx.$queryRaw`
        SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${fonte.tabela}"`)} d
         WHERE d.cliente_id = ${clienteId} AND d.empresa_id = ${empresaId}
           AND (
             d.dados->>'lote_id' = ANY(${lotes}::text[])
             OR (COALESCE(d.dados->>'lote_id', '') = ''
                 AND upper(btrim(COALESCE(d.dados->>'lote', d.dados->>'lote_nome', d.dados->>'nome_lote', ''))) = ANY(${nomesUp}::text[]))
           )
           AND ${dataEfetiva('d', fonte.datas)} > ${dia}`
    );
    if (linha?.n) encontrados.push({ fonte: fonte.tabela, quantidade: linha.n });
  }

  const [tarefas] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "LancamentoTarefa" t
       WHERE t.cliente_id = ${clienteId} AND t.empresa_id = ${empresaId}
         AND t.lote_id = ANY(${lotes}::text[])
         AND t.status <> 'Cancelada'
         AND COALESCE(GREATEST(to_char(t.data_conclusao, 'YYYY-MM-DD'), to_char(t.data_inicio, 'YYYY-MM-DD')), ${diaDeRegistro('t')}) > ${dia}`
  );
  if (tarefas?.n) encontrados.push({ fonte: 'LancamentoTarefa', quantidade: tarefas.n });

  return encontrados;
};
