/**
 * Ledger pecuário L1 — contrato PURO (sem banco) + reconciliação read-only.
 * Itens que dependem da integração L2 aparecem como `todo` (PENDING), não PASS.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIA_SEM,
  TIPOS_EVENTO,
  aplicarPartidas,
  chavesDeTravaOrdenadas,
  normalizarCategoria,
  normalizarDataOperacional,
  normalizarOperationId,
  normalizarQuantidade,
  payloadCanonico,
  planejarEntrada,
  planejarEstorno,
  planejarTransferencia,
  somaDeltas,
} from '../src/modules/estoquePecuarioLedger/ledgerPecuarioContrato.js';
import { CODIGOS_LEDGER_PECUARIO as C, LedgerPecuarioError, ehErroLedger } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioErros.js';
import { auditarLedgerPecuario } from '../../scripts/ops/auditarLedgerPecuarioLib.mjs';

const erroCom = (codigo) => (e) => ehErroLedger(e, codigo);
const base = { empresa_id: 'emp1', categoria_manejo_id: 'boi', data_operacional: '2026-10-29' };

describe('contrato puro — normalização', () => {
  test('quantidade: só inteiro positivo, sem coerção', () => {
    assert.equal(normalizarQuantidade(1), 1);
    for (const ruim of [0, -1, 1.5, '10', NaN, Infinity, null, undefined, 2_000_000]) {
      assert.throws(() => normalizarQuantidade(ruim), erroCom(C.QUANTIDADE_INVALIDA), String(ruim));
    }
  });

  test('categoria: ID estável ou SEM_CATEGORIA explícito; nome livre não vira chave', () => {
    assert.deepEqual(normalizarCategoria({ categoria_manejo_id: 'abc' }), { chave: 'cm:abc', categoriaManejoId: 'abc' });
    assert.deepEqual(normalizarCategoria({ sem_categoria: true }), { chave: CATEGORIA_SEM, categoriaManejoId: null });
    assert.throws(() => normalizarCategoria({}), erroCom(C.CATEGORIA_INVALIDA));
    assert.throws(() => normalizarCategoria({ categoria_manejo_id: 'BOI GORDO' }), erroCom(C.CATEGORIA_INVALIDA));
    assert.throws(() => normalizarCategoria({ categoria_manejo_id: 'a', sem_categoria: true }), erroCom(C.CATEGORIA_INVALIDA));
  });

  test('data operacional e operation_id', () => {
    assert.equal(normalizarDataOperacional('2026-10-29T15:00:00Z'), '2026-10-29');
    assert.throws(() => normalizarDataOperacional('29/10/2026'), erroCom(C.DATA_INVALIDA));
    assert.throws(() => normalizarDataOperacional('2026-13-45'), erroCom(C.DATA_INVALIDA));
    assert.throws(() => normalizarOperationId('curto'), erroCom(C.OPERACAO_INVALIDA));
    assert.equal(normalizarOperationId('  operacao-123  '), 'operacao-123');
  });

  test('código de erro desconhecido não é aceito', () => {
    assert.throws(() => new LedgerPecuarioError('QUALQUER', 'x'), TypeError);
  });
});

describe('contrato puro — eventos e partidas', () => {
  test('ENTRADA: um crédito na área, lote só como referência', () => {
    const p = planejarEntrada({ ...base, area_id: 'A', quantidade: 1000, lote_referencia_id: 'lote1' });
    assert.equal(p.tipo, TIPOS_EVENTO.ENTRADA);
    assert.deepEqual(p.partidas, [{ area_id: 'A', categoria_chave: 'cm:boi', delta: 1000 }]);
    assert.equal(p.lote_referencia_id, 'lote1');
  });

  test('TRANSFERÊNCIA conserva o total (soma dos deltas = 0); origem == destino recusada', () => {
    const t = planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'B', quantidade: 400 });
    assert.equal(somaDeltas(t.partidas), 0);
    assert.deepEqual(t.partidas.map((p) => p.delta), [-400, 400]);
    assert.throws(() => planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'A', quantidade: 1 }), erroCom(C.ORIGEM_IGUAL_DESTINO));
  });

  test('1000 em A → 400/350/250 → B→C: posições derivadas e total constante', () => {
    let saldos = new Map();
    saldos = aplicarPartidas(saldos, planejarEntrada({ ...base, area_id: 'A', quantidade: 1000 }).partidas);
    for (const [d, q] of [['B', 400], ['C', 350], ['D', 250]]) {
      saldos = aplicarPartidas(saldos, planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: d, quantidade: q }).partidas);
    }
    saldos = aplicarPartidas(saldos, planejarTransferencia({ ...base, area_origem_id: 'B', area_destino_id: 'C', quantidade: 100 }).partidas);
    const k = (a) => `${a}\u0000cm:boi`;
    assert.deepEqual([k('A'), k('B'), k('C'), k('D')].map((x) => saldos.get(x)), [0, 300, 450, 250]);
    assert.equal([...saldos.values()].reduce((t, v) => t + v, 0), 1000);
  });

  test('aplicarPartidas nunca deixa negativo e não muta a entrada', () => {
    const inicial = new Map([['A\u0000cm:boi', 5]]);
    assert.throws(() => aplicarPartidas(inicial, [{ area_id: 'A', categoria_chave: 'cm:boi', delta: -6 }]), erroCom(C.SALDO_INSUFICIENTE));
    assert.equal(inicial.get('A\u0000cm:boi'), 5);
  });

  test('ESTORNO: partidas exatamente inversas; estorno de estorno e sem motivo recusados', () => {
    const t = planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'B', quantidade: 60 });
    const e = planejarEstorno(t, { partidas: t.partidas }, { motivo: 'erro', data_operacional: '2026-10-30' });
    assert.deepEqual(e.partidas.map((p) => p.delta), [60, -60]);
    assert.equal(e.area_origem_id, 'B');
    assert.throws(() => planejarEstorno({ ...t, tipo: TIPOS_EVENTO.ESTORNO }, { partidas: [] }, { motivo: 'x', data_operacional: '2026-10-30' }), erroCom(C.ESTORNO_INVALIDO));
    assert.throws(() => planejarEstorno(t, { partidas: t.partidas }, { data_operacional: '2026-10-30' }), erroCom(C.ESTORNO_INVALIDO));
  });

  test('trava em ordem determinística, independente da direção (anti-deadlock)', () => {
    const ab = chavesDeTravaOrdenadas(planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'B', quantidade: 1 }).partidas);
    const ba = chavesDeTravaOrdenadas(planejarTransferencia({ ...base, area_origem_id: 'B', area_destino_id: 'A', quantidade: 1 }).partidas);
    assert.deepEqual(ab, ba);
  });

  test('fingerprint canônico distingue comando e payload', () => {
    const e = { ...base, area_id: 'A', quantidade: 1 };
    assert.notDeepEqual(payloadCanonico('ENTRADA', e), payloadCanonico('TRANSFERENCIA', e));
    assert.notDeepEqual(payloadCanonico('ENTRADA', e), payloadCanonico('ENTRADA', { ...e, quantidade: 2 }));
    assert.deepEqual(payloadCanonico('ENTRADA', e), payloadCanonico('ENTRADA', { ...e, extra_ignorado: 1 }));
  });
});

describe('reconciliação read-only do legado (dry-run)', () => {
  // Fixture SINTÉTICA com o padrão observado (§1): 150/135 com movimento de 15
  // para a própria área; 250 → 50 parcial (gera lote "MOVIMENTAÇÃO") → 200 total.
  const dump = {
    lotes: [
      { id: 'L1', empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', quantidade_entrada: 150, quantidade_cabecas: 135, area_entrada_id: 'X', area_atual_id: 'X' },
      { id: 'L2', empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', quantidade_entrada: 250, quantidade_cabecas: 200, area_entrada_id: 'P', area_atual_id: 'R' },
      { id: 'L3', empresa_id: 'E', origem: 'MOVIMENTAÇÃO', status: 'Ativo', categoria: 'BOI', quantidade_entrada: 50, quantidade_cabecas: 50, area_entrada_id: 'Q', area_atual_id: 'Q' },
    ],
    movimentacoes_mapa: [
      { id: 'M1', empresa_id: 'E', dados: { tipo: 'Transferência de Área', lote_id: 'L1', categoria_animal: 'BOI', quantidade_animais: 15, area_origem_id: 'X', area_destino_id: 'X', data_movimentacao: '2026-10-20T12:00:00Z' } },
      { id: 'M2', empresa_id: 'E', dados: { tipo: 'Transferência de Área', lote_id: 'L2', categoria_animal: 'BOI', quantidade_animais: 50, area_origem_id: 'P', area_destino_id: 'Q', data_movimentacao: '2026-10-21T12:00:00Z' } },
      { id: 'M3', empresa_id: 'E', dados: { tipo: 'Transferência de Área', lote_id: 'L2', categoria_animal: 'BOI', quantidade_animais: 200, area_origem_id: 'P', area_destino_id: 'R', data_movimentacao: '2026-10-22T12:00:00Z' } },
    ],
  };

  test('lote gerado por movimento não conta como compra; lacuna de 15 em X aparece; self-target vira suspeita', () => {
    const r = auditarLedgerPecuario(dump, { mostrarIds: true });
    assert.equal(r.modo, 'somente-leitura');
    assert.equal(r.resumo.total_entradas, 400, 'só 150 + 250 são entradas; o 50 gerado não');
    assert.deepEqual(r.lotes_gerados_por_movimento.map((l) => l.lote), ['L3']);
    const por = Object.fromEntries(r.matriz.map((l) => [l.area, l]));
    assert.equal(por.X.esperada, 150);
    assert.equal(por.X.observada, 135);
    assert.equal(por.X.lacuna, -15);
    assert.equal(por.P.esperada, 0);
    assert.equal(por.Q.esperada, 50);
    assert.equal(por.Q.lacuna, 0);
    assert.equal(por.R.esperada, 200);
    assert.equal(por.R.lacuna, 0);
    assert.ok(r.suspeitas.some((s) => s.tipo === 'origem_igual_destino' && s.movimentacao === 'M1'));
    assert.ok(r.suspeitas.some((s) => s.tipo === 'categoria_somente_texto'));
  });

  test('duplicata provável é apontada, não removida; tipos sem semântica vão para quarentena', () => {
    const dup = structuredClone(dump);
    dup.movimentacoes_mapa.push({ ...structuredClone(dump.movimentacoes_mapa[1]), id: 'M2b' });
    dup.movimentacoes_mapa.push({ id: 'M9', empresa_id: 'E', dados: { tipo: 'Morte', lote_id: 'L1', quantidade_animais: 2, area_origem_id: 'X' } });
    const r = auditarLedgerPecuario(dup, { mostrarIds: true });
    assert.ok(r.suspeitas.some((s) => s.tipo === 'possivel_duplicata' && s.movimentacao === 'M2b'));
    assert.ok(r.quarentena.some((q) => q.motivo === 'tipo_nao_aplicado' && q.tipo === 'Morte'));
    assert.equal(dup.movimentacoes_mapa.length, 5, 'entrada não é mutada');
  });

  test('IDs saem com hash por padrão', () => {
    const r = auditarLedgerPecuario(dump);
    assert.ok(r.matriz.every((l) => /^#[0-9a-f]{10}$/.test(l.area)));
    assert.ok(!JSON.stringify(r).includes('"L2"'));
  });
});

describe('PENDING — depende da integração L2 (após merge da PR #145)', () => {
  test.todo('models Prisma + migration aditiva versionada das tabelas do ledger (hoje só DDL em esquema descartável)');
  test.todo('rota HTTP autenticada (auth_context) + códigos LEDGER_PECUARIO_* no mapa global de erros');
  test.todo('grants/RLS backend-only no Supabase para as novas tabelas (gate supabase-public-grants)');
  test.todo('backfill controlado do legado a partir da reconciliação, com quarentena revisada manualmente');
  test.todo('Mapa Geral/cadastro passam a ler a posição do ledger (sem mudança visual)');
});
