/**
 * D-PROD-159 (Patrimônio P1-02), revisto pela D-PROD-162 (SIMPLIFICA-01) —
 * consumo pelo método do TANQUE CHEIO (D11), calculado no banco por SQL com
 * janela (sem carregar as linhas do bem no Node; a LISTA não traz consumo, o
 * detalhe e `GET /patrimonio-abastecimentos-consumo` trazem).
 *
 * Entre dois abastecimentos CONFIRMADOS do MESMO tanque marcados como tanque
 * cheio: quantidade = Σ dos abastecimentos confirmados do tanque depois do 1º
 * até o 2º (inclusive), na unidade do Produto (D-PROD-162, P-03). A métrica
 * depende do medidor e da unidade: ODOMETRO + L = km/L, ODOMETRO + KG = km/kg,
 * HORIMETRO + L = L/h, HORIMETRO + KG = kg/h. Intervalo com L e KG misturados
 * não tem métrica (`unidades_misturadas`): nunca se soma litro com quilo.
 * CICLOS e SEM_MEDIDOR não têm métrica. Decimal ponta a ponta.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { diaDe } from './patrimonioComum.js';

export const METODOLOGIA_CONSUMO =
  'Método do tanque cheio: entre dois abastecimentos confirmados do mesmo tanque marcados como tanque cheio, somam-se as quantidades abastecidas depois do primeiro até o segundo (inclusive), na unidade do Produto (L ou kg). km/L ou km/kg = distância do odômetro ÷ quantidade; L/h ou kg/h = quantidade ÷ horas do horímetro. Litros e quilos nunca se somam: um intervalo com as duas unidades não é calculado. Sem dois tanques cheios consecutivos com leitura e intervalo positivo, o consumo não é calculado (dados insuficientes).';

const CASAS = 4;
/** Métrica por (medidor, unidade). */
const METRICA = Object.freeze({
  ODOMETRO: Object.freeze({
    L: Object.freeze({ metrica: 'KM_POR_LITRO', unidade_metrica: 'km/L' }),
    KG: Object.freeze({ metrica: 'KM_POR_KG', unidade_metrica: 'km/kg' }),
  }),
  HORIMETRO: Object.freeze({
    L: Object.freeze({ metrica: 'LITROS_POR_HORA', unidade_metrica: 'L/h' }),
    KG: Object.freeze({ metrica: 'KG_POR_HORA', unidade_metrica: 'kg/h' }),
  }),
});
const t4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS));

/** O medidor tem métrica de consumo? @param {string|null} tipo */
const medidorComMetrica = (tipo) => Boolean(tipo) && Object.prototype.hasOwnProperty.call(METRICA, /** @type {string} */ (tipo));

/**
 * Métrica do (medidor, unidade); null quando não se aplica.
 * @param {string|null} tipo @param {string|null} unidade `L` | `KG`
 */
export const metricaDoMedidor = (tipo, unidade) => {
  if (!medidorComMetrica(tipo) || (unidade !== 'L' && unidade !== 'KG')) return null;
  return METRICA[/** @type {'ODOMETRO'|'HORIMETRO'} */ (tipo)][unidade];
};

const SEM_METRICA = Object.freeze({ metrica: null, unidade_metrica: null });

/**
 * Avaliação PURA de uma linha da janela (tanque cheio com o cheio anterior do tanque).
 * @param {any} linha `{ id, medidor_tipo, medidor_leitura, unidade, acumulado_l, acumulado_kg, ant_id, ant_tipo, ant_leitura, ant_acumulado_l, ant_acumulado_kg, ... }`
 */
export const avaliarIntervalo = (linha) => {
  const vazio = { intervalo: null, quantidade: null, unidade: null, valor: null, abastecimento_inicial_id: null };
  if (!medidorComMetrica(linha.medidor_tipo)) {
    return { situacao: 'NAO_APLICAVEL', motivo: linha.medidor_tipo === 'CICLOS' ? 'medidor_ciclos' : 'sem_medidor', ...SEM_METRICA, ...vazio };
  }
  // Sem intervalo, a métrica é a da unidade do PRÓPRIO abastecimento.
  const propria = metricaDoMedidor(linha.medidor_tipo, linha.unidade) ?? SEM_METRICA;
  if (!linha.ant_id) return { situacao: 'DADOS_INSUFICIENTES', motivo: 'sem_tanque_cheio_anterior', ...propria, ...vazio };
  if (linha.ant_tipo !== linha.medidor_tipo || linha.ant_leitura === null || linha.medidor_leitura === null) {
    return { situacao: 'DADOS_INSUFICIENTES', motivo: 'medidor_trocado', ...propria, ...vazio, abastecimento_inicial_id: linha.ant_id };
  }
  const intervalo = dec(linha.medidor_leitura).minus(dec(linha.ant_leitura));
  const qL = dec(linha.acumulado_l).minus(dec(linha.ant_acumulado_l));
  const qK = dec(linha.acumulado_kg).minus(dec(linha.ant_acumulado_kg));
  if (qL.gt(0) && qK.gt(0)) {
    return { situacao: 'DADOS_INSUFICIENTES', motivo: 'unidades_misturadas', ...SEM_METRICA, ...vazio, intervalo: t4(intervalo), abastecimento_inicial_id: linha.ant_id };
  }
  const unidade = qL.gt(0) ? 'L' : 'KG';
  const quantidade = unidade === 'L' ? qL : qK;
  const m = /** @type {{metrica: string, unidade_metrica: string}} */ (metricaDoMedidor(linha.medidor_tipo, unidade));
  const comum = { ...m, intervalo: t4(intervalo), quantidade: t4(quantidade), unidade, abastecimento_inicial_id: linha.ant_id };
  if (!intervalo.gt(0)) return { situacao: 'DADOS_INSUFICIENTES', motivo: 'intervalo_nao_positivo', ...comum, valor: null };
  if (!quantidade.gt(0)) return { situacao: 'DADOS_INSUFICIENTES', motivo: 'quantidade_nao_positiva', ...comum, valor: null };
  const valor = linha.medidor_tipo === 'ODOMETRO' ? arredondar(intervalo.dividedBy(quantidade), CASAS) : arredondar(quantidade.dividedBy(intervalo), CASAS);
  return { situacao: 'CALCULADO', motivo: null, ...comum, valor: t4(valor) };
};

/**
 * Janela dos tanques cheios do bem (opcionalmente de um tanque), com o cheio
 * anterior do MESMO tanque e os acumulados do tanque por unidade (L e KG).
 * @param {any} db @param {string} cli @param {string} empresaId @param {string} bemId
 * @param {{ tanqueId?: string|null, abastecimentoId?: string|null, limite?: number }} [opcoes]
 */
const janelaDosCheios = (db, cli, empresaId, bemId, { tanqueId = null, abastecimentoId = null, limite = 20 } = {}) => {
  const filtroTanque = tanqueId ? Prisma.sql`AND a.tanque_id = ${tanqueId}` : Prisma.empty;
  const filtroId = abastecimentoId ? Prisma.sql`WHERE c.id = ${abastecimentoId}` : Prisma.empty;
  return db.$queryRaw`
    WITH base AS (
      SELECT a.id, a.numero, a.tanque_id, a.data_operacional, a.medidor_tipo, a.medidor_leitura, a.quantidade, a.unidade, a.tanque_cheio, a."createdAt",
             SUM(CASE WHEN a.unidade = 'L' THEN a.quantidade ELSE 0 END)
               OVER (PARTITION BY a.tanque_id ORDER BY a.data_operacional, a.medidor_leitura NULLS FIRST, a."createdAt", a.id) AS acumulado_l,
             SUM(CASE WHEN a.unidade = 'KG' THEN a.quantidade ELSE 0 END)
               OVER (PARTITION BY a.tanque_id ORDER BY a.data_operacional, a.medidor_leitura NULLS FIRST, a."createdAt", a.id) AS acumulado_kg
      FROM "AbastecimentoBem" a
      WHERE a.cliente_id = ${cli} AND a.empresa_id = ${empresaId} AND a.bem_id = ${bemId} AND a.status = 'CONFIRMADO' ${filtroTanque}
    ), cheios AS (
      SELECT b.*, LAG(b.id) OVER w AS ant_id, LAG(b.data_operacional) OVER w AS ant_data, LAG(b.medidor_leitura) OVER w AS ant_leitura,
             LAG(b.medidor_tipo) OVER w AS ant_tipo, LAG(b.acumulado_l) OVER w AS ant_acumulado_l, LAG(b.acumulado_kg) OVER w AS ant_acumulado_kg
      FROM base b WHERE b.tanque_cheio
      WINDOW w AS (PARTITION BY b.tanque_id ORDER BY b.data_operacional, b.medidor_leitura NULLS FIRST, b."createdAt", b.id)
    )
    SELECT c.*, t.identificador AS tanque_identificador
    FROM cheios c JOIN "TanqueBem" t ON t.cliente_id = ${cli} AND t.id = c.tanque_id
    ${filtroId}
    ORDER BY c.data_operacional DESC, c.medidor_leitura DESC NULLS LAST, c."createdAt" DESC, c.id DESC
    LIMIT ${limite}`;
};

/**
 * Consumo do PRÓPRIO abastecimento (detalhe).
 * @param {any} db @param {string} cli
 * @param {any} row linha de `AbastecimentoBem`
 */
export const consumoDoAbastecimento = async (db, cli, row) => {
  const vazio = { intervalo: null, quantidade: null, unidade: null, valor: null, abastecimento_inicial_id: null, metodologia: METODOLOGIA_CONSUMO };
  if (row.status !== 'CONFIRMADO') return { situacao: 'NAO_APLICAVEL', motivo: 'cancelado', ...SEM_METRICA, ...vazio };
  if (!medidorComMetrica(row.medidor_tipo)) {
    return { situacao: 'NAO_APLICAVEL', motivo: row.medidor_tipo === 'CICLOS' ? 'medidor_ciclos' : 'sem_medidor', ...SEM_METRICA, ...vazio };
  }
  if (!row.tanque_cheio) {
    return { situacao: 'DADOS_INSUFICIENTES', motivo: 'nao_e_tanque_cheio', ...(metricaDoMedidor(row.medidor_tipo, row.unidade) ?? SEM_METRICA), ...vazio };
  }
  const [linha] = /** @type {any[]} */ (await janelaDosCheios(db, cli, row.empresa_id, row.bem_id, { tanqueId: row.tanque_id, abastecimentoId: row.id, limite: 1 }));
  if (!linha) throw new Error(`consumo: abastecimento ${row.id} ausente da janela do tanque`);
  return { ...avaliarIntervalo(linha), metodologia: METODOLOGIA_CONSUMO };
};

/**
 * `GET /patrimonio-abastecimentos-consumo` (A6): intervalos dos tanques cheios
 * do bem. `metrica`/`unidade_metrica` vêm em CADA intervalo (dependem da
 * unidade do Produto), não no cabeçalho.
 * @param {any} contexto @param {Record<string, any>} query `{empresa_id, bem_id, tanque_id?, limit?}`
 */
export const consumoDoBem = async (contexto, query) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const bem = await prisma.bemPatrimonial.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id: query.bem_id },
    select: { id: true, numero: true, codigo_frota: true, nome: true, medidor_tipo: true, medidor_unidade: true },
  });
  if (!bem) throw new AppError('BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem patrimonial não encontrado nesta fazenda', { details: { field: 'bem_id', reason: 'bem_inexistente' } });
  const tanqueId = typeof query.tanque_id === 'string' && query.tanque_id ? query.tanque_id : null;
  if (tanqueId) {
    const tanque = await prisma.tanqueBem.findFirst({ where: { cliente_id: cli, bem_id: bem.id, id: tanqueId }, select: { id: true } });
    if (!tanque) {
      throw new AppError('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque não encontrado neste bem', { details: { field: 'tanque_id', reason: 'tanque_inexistente' } });
    }
  }
  const comMetrica = medidorComMetrica(bem.medidor_tipo);
  const cabecalho = {
    bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota ?? null, nome: bem.nome, medidor_tipo: bem.medidor_tipo ?? null, medidor_unidade: bem.medidor_unidade ?? null },
    situacao_geral: comMetrica ? 'DISPONIVEL' : 'NAO_APLICAVEL',
    metodologia: METODOLOGIA_CONSUMO,
  };
  if (!comMetrica) return { ...cabecalho, intervalos: [] };
  const n = Number(query.limit);
  const limite = Number.isInteger(n) && n >= 1 && n <= 50 ? n : 20;
  const linhas = /** @type {any[]} */ (await janelaDosCheios(prisma, cli, empresaId, bem.id, { tanqueId, limite }));
  return {
    ...cabecalho,
    intervalos: linhas.map((l) => {
      const a = avaliarIntervalo(l);
      return {
        abastecimento_id: l.id,
        numero: l.numero,
        tanque: { id: l.tanque_id, identificador: l.tanque_identificador },
        abastecimento_inicial_id: a.abastecimento_inicial_id,
        data_inicial: l.ant_id ? diaDe(l.ant_data) : null,
        data_final: diaDe(l.data_operacional),
        leitura_inicial: l.ant_id ? t4(l.ant_leitura) : null,
        leitura_final: t4(l.medidor_leitura),
        intervalo: a.intervalo,
        quantidade: a.quantidade,
        unidade: a.unidade,
        metrica: a.metrica,
        unidade_metrica: a.unidade_metrica,
        valor: a.valor,
        situacao: a.situacao === 'NAO_APLICAVEL' ? 'DADOS_INSUFICIENTES' : a.situacao,
        motivo: a.motivo,
      };
    }),
  };
};
