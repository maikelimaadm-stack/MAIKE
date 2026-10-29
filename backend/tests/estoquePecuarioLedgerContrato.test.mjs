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
  categoriaHistoricaDaEntrada,
  chavesDeTravaOrdenadas,
  classificarOrigemLote,
  normalizarCategoria,
  normalizarDataOperacional,
  normalizarOperationId,
  normalizarQuantidade,
  payloadCanonico,
  planejarEntrada,
  planejarEstorno,
  planejarTransferencia,
  somaDeltas,
  validarEntradaContraLote,
} from '../src/modules/estoquePecuarioLedger/ledgerPecuarioContrato.js';
import { esquemaSeguro, gerarEsquemaDescartavel, ddlRemoverLedgerPecuario } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioDdl.js';
import { CODIGOS_LEDGER_PECUARIO as C, LedgerPecuarioError, ehErroLedger } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioErros.js';
import { auditarLedgerPecuario, inteiroPositivoEstrito } from '../../scripts/ops/auditarLedgerPecuarioLib.mjs';

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

  test('R2 P1 — data operacional estrita: string inteira AAAA-MM-DD e calendário real', () => {
    assert.equal(normalizarDataOperacional('2026-10-29'), '2026-10-29');
    assert.equal(normalizarDataOperacional('2024-02-29'), '2024-02-29', 'bissexto válido');
    assert.equal(normalizarDataOperacional('2000-02-29'), '2000-02-29', 'bissexto secular válido');
    for (const ruim of ['2026-10-29abc', '2026-02-29', '2026-02-30', '1900-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-00', ' 2026-10-29', '2026-10-29 ', '2026-10-29T12:00:00Z', '29/10/2026', '20261029', '', null, 20261029]) {
      assert.throws(() => normalizarDataOperacional(ruim), erroCom(C.DATA_INVALIDA), JSON.stringify(ruim));
    }
  });

  test('operation_id e código de erro desconhecido', () => {
    assert.throws(() => normalizarOperationId('curto'), erroCom(C.OPERACAO_INVALIDA));
    assert.equal(normalizarOperationId('  operacao-123  '), 'operacao-123');
    assert.throws(() => new LedgerPecuarioError('QUALQUER', 'x'), TypeError);
  });

  test('R2 P1 — esquema descartável: só ledger_l1_<hex>; DROP CASCADE impossível fora dele', () => {
    const gerado = gerarEsquemaDescartavel();
    assert.match(gerado, /^ledger_l1_[0-9a-f]{12}$/);
    assert.equal(esquemaSeguro(gerado), `"${gerado}"`);
    assert.equal(ddlRemoverLedgerPecuario(gerado), `DROP SCHEMA IF EXISTS "${gerado}" CASCADE`);
    for (const s of ['public', 'auth', 'storage', 'pg_catalog', 'information_schema', 'prisma', 'extensions', 'graphql', '', 'ledger_l1_', 'ledger_l1_abc', 'ledger_l1_ABCDEF123456', 'ledger_l1_0123456789abz', `ledger_l1_${'a'.repeat(33)}`, 'x_ledger_l1_0123456789ab', 'ledger_l1_0123456789ab; drop', null, 42]) {
      assert.throws(() => esquemaSeguro(s), erroCom(C.ESQUEMA_INVALIDO), JSON.stringify(s));
      assert.throws(() => ddlRemoverLedgerPecuario(/** @type {any} */ (s)), erroCom(C.ESQUEMA_INVALIDO), JSON.stringify(s));
    }
  });
});

describe('contrato puro — eventos e partidas', () => {
  test('ENTRADA exige lote de referência; um crédito na área', () => {
    const p = planejarEntrada({ ...base, area_id: 'A', quantidade: 1000, lote_referencia_id: 'lote1' });
    assert.equal(p.tipo, TIPOS_EVENTO.ENTRADA);
    assert.deepEqual(p.partidas, [{ area_id: 'A', categoria_chave: 'cm:boi', delta: 1000 }]);
    assert.throws(() => planejarEntrada({ ...base, area_id: 'A', quantidade: 1 }), erroCom(C.LOTE_REFERENCIA_INVALIDO));
  });

  test('TRANSFERÊNCIA conserva o total (soma dos deltas = 0); origem == destino recusada', () => {
    const t = planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'B', quantidade: 400 });
    assert.equal(somaDeltas(t.partidas), 0);
    assert.throws(() => planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'A', quantidade: 1 }), erroCom(C.ORIGEM_IGUAL_DESTINO));
  });

  test('1000 em A → 400/350/250 → B→C: posições derivadas e total constante', () => {
    let saldos = new Map();
    saldos = aplicarPartidas(saldos, planejarEntrada({ ...base, area_id: 'A', quantidade: 1000, lote_referencia_id: 'L' }).partidas);
    for (const [d, q] of [['B', 400], ['C', 350], ['D', 250]]) {
      saldos = aplicarPartidas(saldos, planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: d, quantidade: q }).partidas);
    }
    saldos = aplicarPartidas(saldos, planejarTransferencia({ ...base, area_origem_id: 'B', area_destino_id: 'C', quantidade: 100 }).partidas);
    const k = (a) => `${a}\u0000cm:boi`;
    assert.deepEqual([k('A'), k('B'), k('C'), k('D')].map((x) => saldos.get(x)), [0, 300, 450, 250]);
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
    assert.throws(() => planejarEstorno({ ...t, tipo: TIPOS_EVENTO.ESTORNO }, { partidas: [] }, { motivo: 'x', data_operacional: '2026-10-30' }), erroCom(C.ESTORNO_INVALIDO));
    assert.throws(() => planejarEstorno(t, { partidas: t.partidas }, { data_operacional: '2026-10-30' }), erroCom(C.ESTORNO_INVALIDO));
  });

  test('trava em ordem determinística, independente da direção (anti-deadlock)', () => {
    const ab = chavesDeTravaOrdenadas(planejarTransferencia({ ...base, area_origem_id: 'A', area_destino_id: 'B', quantidade: 1 }).partidas);
    const ba = chavesDeTravaOrdenadas(planejarTransferencia({ ...base, area_origem_id: 'B', area_destino_id: 'A', quantidade: 1 }).partidas);
    assert.deepEqual(ab, ba);
  });

  test('fingerprint canônico distingue comando e payload', () => {
    const e = { ...base, area_id: 'A', quantidade: 1, lote_referencia_id: 'L' };
    assert.notDeepEqual(payloadCanonico('ENTRADA', e), payloadCanonico('TRANSFERENCIA', e));
    assert.notDeepEqual(payloadCanonico('ENTRADA', e), payloadCanonico('ENTRADA', { ...e, quantidade: 2 }));
    assert.deepEqual(payloadCanonico('ENTRADA', e), payloadCanonico('ENTRADA', { ...e, extra_ignorado: 1 }));
  });
});

describe('R2 — origem do lote e snapshot histórico de entrada (puro)', () => {
  test('classificação das origens do legado (ORIGENS_SISTEMA)', () => {
    assert.equal(classificarOrigemLote('Compra'), 'cadastro');
    assert.equal(classificarOrigemLote(null), 'cadastro');
    assert.equal(classificarOrigemLote('MOVIMENTAÇÃO'), 'derivado_movimento');
    assert.equal(classificarOrigemLote('Movimentacao'), 'derivado_movimento');
    assert.equal(classificarOrigemLote('REVERSÃO MOVIMENTAÇÃO'), 'derivado_reversao');
    assert.equal(classificarOrigemLote('Mudança de Categoria'), 'derivado_categoria');
    assert.equal(classificarOrigemLote('NASCIMENTO'), 'nascimento');
  });

  test('categoria histórica: ID de entrada; ausência total = SEM_CATEGORIA; só texto/atual = não confiável', () => {
    assert.deepEqual(categoriaHistoricaDaEntrada({ categoria_manejo_entrada_id: 'bez', categoria_manejo_id: 'boi' }), { chave: 'cm:bez', confiavel: true });
    assert.deepEqual(categoriaHistoricaDaEntrada({}), { chave: CATEGORIA_SEM, confiavel: true });
    assert.equal(categoriaHistoricaDaEntrada({ categoria_entrada: 'BOI' }).confiavel, false);
    assert.equal(categoriaHistoricaDaEntrada({ categoria_manejo_id: 'boi' }).confiavel, false, 'categoria ATUAL não substitui a histórica');
  });

  test('validarEntradaContraLote: bate com quantidade_entrada/area_entrada/categoria de entrada; nunca com a atual', () => {
    const lote = { origem: 'Compra', quantidade_entrada: 150, area_entrada_id: 'X', categoria_manejo_entrada_id: 'boi', categoria_manejo_id: 'vaca' };
    const plano = planejarEntrada({ ...base, area_id: 'X', quantidade: 150, lote_referencia_id: 'L' });
    validarEntradaContraLote(plano, lote);
    assert.throws(() => validarEntradaContraLote(planejarEntrada({ ...base, area_id: 'X', quantidade: 135, lote_referencia_id: 'L' }), lote), erroCom(C.ENTRADA_DIVERGENTE_DO_LOTE));
    assert.throws(() => validarEntradaContraLote(planejarEntrada({ ...base, area_id: 'Y', quantidade: 150, lote_referencia_id: 'L' }), lote), erroCom(C.ENTRADA_DIVERGENTE_DO_LOTE));
    assert.throws(() => validarEntradaContraLote(planejarEntrada({ ...base, categoria_manejo_id: 'vaca', area_id: 'X', quantidade: 150, lote_referencia_id: 'L' }), lote), erroCom(C.ENTRADA_DIVERGENTE_DO_LOTE));
    assert.throws(() => validarEntradaContraLote(plano, { ...lote, origem: 'MOVIMENTAÇÃO' }), erroCom(C.LOTE_ORIGEM_NAO_SUPORTADA));
    assert.throws(() => validarEntradaContraLote(plano, { ...lote, quantidade_entrada: '150' }), erroCom(C.ENTRADA_DIVERGENTE_DO_LOTE));
  });
});

describe('reconciliação read-only do legado (dry-run)', () => {
  const lote = (o) => ({ empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi', ...o });
  const transf = (id, o) => ({ id, empresa_id: 'E', dados: { tipo: 'Transferência de Área', categoria_animal: 'BOI', ...o } });
  const porArea = (r) => Object.fromEntries(r.matriz.map((l) => [l.area, l]));

  test('inteiroPositivoEstrito não trunca', () => {
    assert.equal(inteiroPositivoEstrito(10), 10);
    assert.equal(inteiroPositivoEstrito('10'), 10);
    for (const v of [10.5, '10.5', '', ' ', NaN, -3, '-3', '1e3', 'abc', null, undefined, 0]) assert.equal(inteiroPositivoEstrito(v), null, JSON.stringify(v));
  });

  test('R2 P0 — transferência TOTAL com origem Inativo: A=0, B=1000, total 1000, sem lacuna nem entrada dupla', () => {
    const r = auditarLedgerPecuario({
      lotes: [
        lote({ id: 'L', status: 'Inativo', quantidade_entrada: 1000, quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'G', origem: 'MOVIMENTAÇÃO', quantidade_entrada: 1000, quantidade_cabecas: 1000, area_entrada_id: 'B', area_atual_id: 'B' }),
      ],
      movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 1000, area_origem_id: 'A', area_destino_id: 'B' })],
    }, { mostrarIds: true });
    const m = porArea(r);
    assert.equal(r.resumo.total_entradas, 1000, 'entrada do lote Inativo continua contando; o gerado não');
    assert.equal(m.A.esperada, 0);
    assert.equal(m.B.esperada, 1000);
    assert.equal(m.B.observada, 1000);
    assert.equal(r.resumo.linhas_com_lacuna, 0);
    assert.equal(r.resumo.total_observado, 1000);
    assert.equal(r.estado, 'conciliada');
  });

  // Caso real (§1), fixture sintética: 150→135 com movimento de 15 para a
  // própria área; 250 → 50 parcial (gera lote MOVIMENTAÇÃO) → 200 total.
  const casoReal = {
    lotes: [
      lote({ id: 'L1', quantidade_entrada: 150, quantidade_cabecas: 135, area_entrada_id: 'X', area_atual_id: 'X' }),
      lote({ id: 'L2', status: 'Ativo', quantidade_entrada: 250, quantidade_cabecas: 200, area_entrada_id: 'P', area_atual_id: 'R' }),
      lote({ id: 'L3', origem: 'MOVIMENTAÇÃO', quantidade_entrada: 50, quantidade_cabecas: 50, area_entrada_id: 'Q', area_atual_id: 'Q' }),
    ],
    movimentacoes_mapa: [
      transf('M1', { lote_id: 'L1', quantidade_animais: 15, area_origem_id: 'X', area_destino_id: 'X', data_movimentacao: '2026-10-20T12:00:00Z' }),
      transf('M2', { lote_id: 'L2', quantidade_animais: 50, area_origem_id: 'P', area_destino_id: 'Q', data_movimentacao: '2026-10-21T12:00:00Z' }),
      transf('M3', { lote_id: 'L2', quantidade_animais: 200, area_origem_id: 'P', area_destino_id: 'R', data_movimentacao: '2026-10-22T12:00:00Z' }),
    ],
  };

  test('caso real: 50 gerado não é compra; lacuna −15 em X; self-target vira suspeita; estado parcial (nunca conciliada)', () => {
    const r = auditarLedgerPecuario(casoReal, { mostrarIds: true });
    const m = porArea(r);
    assert.equal(r.resumo.total_entradas, 400);
    assert.deepEqual(r.lotes_gerados_pelo_legado.map((l) => [l.lote, l.classe]), [['L3', 'derivado_movimento']]);
    assert.deepEqual([m.X.esperada, m.X.observada, m.X.lacuna], [150, 135, -15]);
    assert.deepEqual([m.P.esperada, m.Q.esperada, m.R.esperada], [0, 50, 200]);
    assert.equal(m.Q.lacuna + m.R.lacuna, 0);
    assert.ok(r.suspeitas.some((s) => s.tipo === 'origem_igual_destino' && s.movimentacao === 'M1' && s.impeditiva === false));
    assert.equal(r.estado, 'reconciliacao_parcial');
    assert.equal(r.por_empresa[0].estado, 'reconciliacao_parcial');
    assert.equal(r.por_empresa[0].linhas_com_lacuna, 1);
  });

  test('R2 P1 — lote que MUDOU de categoria: entrada pela categoria histórica, posição pela atual; movimento ambíguo em quarentena; bloqueia', () => {
    const r = auditarLedgerPecuario({
      lotes: [lote({ id: 'L', categoria_manejo_entrada_id: 'bezerro', categoria_manejo_id: 'garrote', quantidade_entrada: 10, quantidade_cabecas: 10, area_entrada_id: 'A', area_atual_id: 'B' })],
      movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 10, area_origem_id: 'A', area_destino_id: 'B' })],
    }, { mostrarIds: true });
    const entrada = r.matriz.find((l) => l.entradas > 0);
    assert.equal(entrada.categoria, 'cm:bezerro', 'nunca a categoria atual na ENTRADA');
    assert.ok(r.matriz.some((l) => l.categoria === 'cm:garrote' && l.observada === 10), 'posição usa a categoria atual');
    assert.ok(r.quarentena.some((q) => q.motivo === 'categoria_do_movimento_nao_comprovavel'));
    assert.ok(r.suspeitas.some((s) => s.tipo === 'mudanca_categoria_nao_suportada' && s.impeditiva));
    assert.ok(r.resumo.linhas_com_lacuna > 0, 'a divergência aparece — nada de diferença zero enganosa');
    assert.equal(r.estado, 'bloqueada_para_backfill');
  });

  test('R2 P1 — categoria só textual: impeditiva; mapeamento explícito vira trilha auditável', () => {
    const semId = {
      lotes: [{ id: 'L', empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', quantidade_entrada: 5, quantidade_cabecas: 5, area_entrada_id: 'A', area_atual_id: 'A' }],
      movimentacoes_mapa: [{ id: 'M', empresa_id: 'E', dados: { tipo: 'Transferência de Área', categoria_animal: 'BOI', quantidade_animais: 2, area_origem_id: 'A', area_destino_id: 'B' } }],
    };
    const r = auditarLedgerPecuario(semId, { mostrarIds: true });
    assert.ok(r.suspeitas.some((s) => s.tipo === 'categoria_somente_texto' && s.impeditiva));
    assert.ok(r.quarentena.some((q) => q.motivo === 'categoria_do_movimento_nao_comprovavel'), 'movimento sem lote e sem mapeamento não é aplicado');
    assert.equal(r.estado, 'bloqueada_para_backfill');
    const comMapa = auditarLedgerPecuario({ ...semId, mapeamento_categorias: { BOI: 'boi' } }, { mostrarIds: true });
    assert.deepEqual(comMapa.categorias_por_mapeamento, [{ movimentacao: 'M', texto: 'BOI' }]);
    assert.ok(!comMapa.quarentena.some((q) => q.motivo === 'categoria_do_movimento_nao_comprovavel'));
  });

  test('R2 P1 — quantidades inválidas vão para quarentena, não são truncadas nem contadas', () => {
    const r = auditarLedgerPecuario({
      lotes: [
        lote({ id: 'A1', quantidade_entrada: 10.5, quantidade_cabecas: 10, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'A2', quantidade_entrada: '', quantidade_cabecas: 1, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'A3', quantidade_entrada: -4, quantidade_cabecas: 1, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'A4', quantidade_entrada: '12abc', quantidade_cabecas: 1, area_entrada_id: 'A', area_atual_id: 'A' }),
      ],
      movimentacoes_mapa: [transf('M', { lote_id: 'A1', quantidade_animais: '3.2', area_origem_id: 'A', area_destino_id: 'B' })],
    }, { mostrarIds: true });
    assert.equal(r.resumo.total_entradas, 0);
    assert.equal(r.quarentena.filter((q) => q.motivo === 'quantidade_entrada_invalida').length, 4);
    assert.ok(r.quarentena.some((q) => q.motivo === 'quantidade_movimento_invalida'));
    assert.equal(r.estado, 'bloqueada_para_backfill');
  });

  test('R2 P0 — status com cara de anulação: conta e quarentena (sem exclusão silenciosa); nascimento conta e bloqueia; reversão/mudança de categoria não são compra', () => {
    const r = auditarLedgerPecuario({
      lotes: [
        lote({ id: 'C', status: 'Cancelado', quantidade_entrada: 8, quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'N', origem: 'Nascimento', quantidade_entrada: 3, quantidade_cabecas: 3, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'R', origem: 'REVERSÃO MOVIMENTAÇÃO', quantidade_entrada: 4, quantidade_cabecas: 4, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'K', origem: 'MUDANÇA DE CATEGORIA', quantidade_entrada: 2, quantidade_cabecas: 2, area_entrada_id: 'A', area_atual_id: 'A' }),
      ],
      movimentacoes_mapa: [{ id: 'X', empresa_id: 'E', dados: { tipo: 'Morte', lote_id: 'N', quantidade_animais: 1, area_origem_id: 'A' } }],
    }, { mostrarIds: true });
    assert.equal(r.resumo.total_entradas, 11, 'Cancelado (8) + Nascimento (3); derivados fora');
    const motivos = r.quarentena.map((q) => q.motivo);
    for (const m of ['status_de_anulacao_sem_prova_formal', 'nascimento_sem_contrato_l1', 'lote_derivado_reversao_sem_evento_no_l1', 'lote_derivado_categoria_sem_evento_no_l1', 'tipo_nao_aplicado']) {
      assert.ok(motivos.includes(m), m);
    }
    assert.equal(r.estado, 'bloqueada_para_backfill');
    assert.ok(r.por_empresa[0].quarentena_por_motivo.nascimento_sem_contrato_l1 === 1);
  });

  test('duplicata provável é apontada (impeditiva), não removida; entrada não é mutada', () => {
    const dup = structuredClone(casoReal);
    dup.movimentacoes_mapa.push({ ...structuredClone(casoReal.movimentacoes_mapa[1]), id: 'M2b' });
    const r = auditarLedgerPecuario(dup, { mostrarIds: true });
    assert.ok(r.suspeitas.some((s) => s.tipo === 'possivel_duplicata' && s.movimentacao === 'M2b' && s.impeditiva));
    assert.equal(dup.movimentacoes_mapa.length, 4);
    assert.equal(r.estado, 'bloqueada_para_backfill');
  });

  test('IDs saem com hash por padrão', () => {
    const r = auditarLedgerPecuario(casoReal);
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
