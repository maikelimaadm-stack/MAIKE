/**
 * Ledger pecuário L1 — contrato PURO (sem banco) + reconciliação read-only.
 * Itens que dependem da integração L2 aparecem como `todo` (PENDING), não PASS.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  ANO_MAXIMO_CAPTURADO_EM,
  ANO_MINIMO_CAPTURADO_EM,
  QUANTIDADE_MAXIMA_REGISTRO_HISTORICO,
  TOLERANCIA_FUTURO_CAPTURADO_EM_MS,
  auditarLedgerPecuario,
  estadoDaFonte,
  instanteUtcEstrito,
  inteiroPositivoEstrito,
  validarManifestoSnapshot,
} from '../../scripts/ops/auditarLedgerPecuarioLib.mjs';

/**
 * Manifesto v1 SINTÉTICO (CONTRATO §7.1), com contagens escritas à mão pelo
 * teste — nunca derivadas dos arrays do dump.
 */
const CLIENTE_SINTETICO = 'cliente-sintetico';
const manifestoV1 = ({ empresas, lotes, movimentacoes_mapa, por_empresa, ...o }) => ({
  versao: 1,
  snapshot_id: 'snap-sintetico-001',
  capturado_em: '2026-10-01T12:00:00Z',
  escopo: { cliente_id: CLIENTE_SINTETICO, empresas },
  contagens: { lotes, movimentacoes_mapa, ...(por_empresa === undefined ? {} : { por_empresa }) },
  consistencia: { modo: 'snapshot_transacional', confirmado: true },
  origem: { tipo: 'dump_local_sintetico' },
  ...o,
});

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

describe('R3 — categoria do movimento só com prova (fail-closed)', () => {
  const lote = (o) => ({ id: 'L', empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', quantidade_entrada: 10, quantidade_cabecas: 10, area_entrada_id: 'A', area_atual_id: 'B', ...o });
  const mov = (dados = {}) => ({ id: 'M', empresa_id: 'E', dados: { tipo: 'Transferência de Área', lote_id: 'L', quantidade_animais: 10, area_origem_id: 'A', area_destino_id: 'B', ...dados } });
  const aplicado = (r) => r.matriz.some((l) => l.transf_out > 0 || l.transf_in > 0);
  const motivos = (r) => r.quarentena.map((q) => q.motivo);

  test('(a) histórica AUSENTE + atual presente + movimento sem categoria → bloqueado, não aplicado', () => {
    const r = auditarLedgerPecuario({ lotes: [lote({ categoria_manejo_id: 'boi', categoria_manejo_entrada_id: null })], movimentacoes_mapa: [mov()] }, { mostrarIds: true });
    assert.equal(aplicado(r), false);
    assert.ok(motivos(r).includes('categoria_do_movimento_nao_comprovavel'));
    assert.equal(r.estado, 'bloqueada_para_backfill');
    assert.equal(r.apto_para_backfill, false);
  });

  test('(b) histórica PRESENTE e igual à atual (lote de cadastro) → infere, com proveniência lote_estavel', () => {
    const r = auditarLedgerPecuario({ lotes: [lote({ categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi' })], movimentacoes_mapa: [mov()] }, { mostrarIds: true });
    assert.equal(aplicado(r), true);
    assert.deepEqual(r.proveniencia_categoria_movimento, [{ movimentacao: 'M', fonte: 'lote_estavel', categoria: 'cm:boi' }]);
    assert.equal(r.quarentena.length, 0);
  });

  test('(c) histórica DIFERENTE da atual → quarentena (e mudança de categoria impeditiva)', () => {
    const r = auditarLedgerPecuario({ lotes: [lote({ categoria_manejo_id: 'garrote', categoria_manejo_entrada_id: 'bezerro' })], movimentacoes_mapa: [mov()] }, { mostrarIds: true });
    assert.equal(aplicado(r), false);
    assert.ok(motivos(r).includes('categoria_do_movimento_nao_comprovavel'));
    assert.ok(r.suspeitas.some((x) => x.tipo === 'mudanca_categoria_nao_suportada'));
  });

  test('(d) categoria explícita no evento: forma válida e sem conflito → evento; inválida/conflitante → quarentena; mapeamento só explícito', () => {
    const base = lote({ categoria_manejo_id: 'garrote', categoria_manejo_entrada_id: 'bezerro' });
    const ok = auditarLedgerPecuario({ lotes: [base], movimentacoes_mapa: [mov({ categoria_manejo_id: 'bezerro' })] }, { mostrarIds: true });
    assert.deepEqual(ok.proveniencia_categoria_movimento, [{ movimentacao: 'M', fonte: 'evento', categoria: 'cm:bezerro' }]);
    assert.equal(aplicado(ok), true);
    const conflito = auditarLedgerPecuario({ lotes: [base], movimentacoes_mapa: [mov({ categoria_manejo_id: 'vaca' })] }, { mostrarIds: true });
    assert.equal(aplicado(conflito), false);
    assert.ok(motivos(conflito).includes('categoria_do_movimento_conflitante'));
    const invalida = auditarLedgerPecuario({ lotes: [base], movimentacoes_mapa: [mov({ categoria_manejo_id: 'BOI GORDO' })] }, { mostrarIds: true });
    assert.ok(motivos(invalida).includes('categoria_do_movimento_invalida'));
    // nome livre nunca vira ID sem mapeamento revisado
    const semMapa = auditarLedgerPecuario({ lotes: [], movimentacoes_mapa: [mov({ lote_id: 'X', categoria_animal: 'BOI' })] }, { mostrarIds: true });
    assert.ok(motivos(semMapa).includes('categoria_do_movimento_nao_comprovavel'));
    const comMapa = auditarLedgerPecuario({ lotes: [], movimentacoes_mapa: [mov({ lote_id: 'X', categoria_animal: 'BOI' })], mapeamento_categorias: { BOI: 'boi' } }, { mostrarIds: true });
    assert.deepEqual(comMapa.proveniencia_categoria_movimento, [{ movimentacao: 'M', fonte: 'mapeamento', categoria: 'cm:boi', texto: 'BOI' }]);
    const mapaRuim = auditarLedgerPecuario({ lotes: [], movimentacoes_mapa: [mov({ lote_id: 'X', categoria_animal: 'BOI' })], mapeamento_categorias: { BOI: 'BOI GORDO' } }, { mostrarIds: true });
    assert.ok(motivos(mapaRuim).includes('mapeamento_categoria_invalido'));
  });

  test('(e) lote gerado por MOVIMENTAÇÃO nunca serve de prova de categoria (mesmo com histórico = atual)', () => {
    const r = auditarLedgerPecuario({ lotes: [lote({ origem: 'MOVIMENTAÇÃO', categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi' })], movimentacoes_mapa: [mov()] }, { mostrarIds: true });
    assert.equal(aplicado(r), false);
    assert.ok(motivos(r).includes('categoria_do_movimento_nao_comprovavel'));
  });

  test('auditoria continua pura: não altera o dump (campos históricos do lote intactos)', () => {
    const dump = { lotes: [lote({ categoria_manejo_id: 'boi', categoria_manejo_entrada_id: null })], movimentacoes_mapa: [mov()] };
    const copia = structuredClone(dump);
    auditarLedgerPecuario(dump, { mostrarIds: true });
    assert.deepEqual(dump, copia);
  });
});

describe('R3 — apto_para_backfill (fail-closed)', () => {
  // R5: toda linha traz o tenant do escopo; a ausência é provada à parte.
  const lote = (o) => ({ cliente_id: CLIENTE_SINTETICO, empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi', ...o });
  const transf = (id, o) => ({ id, cliente_id: CLIENTE_SINTETICO, empresa_id: 'E', dados: { tipo: 'Transferência de Área', ...o } });

  test('1000 A→B integralmente conciliado → apto=true (geral e por empresa)', () => {
    const r = auditarLedgerPecuario({
      lotes: [
        lote({ id: 'L', status: 'Inativo', quantidade_entrada: 1000, quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'G', origem: 'MOVIMENTAÇÃO', quantidade_entrada: 1000, quantidade_cabecas: 1000, area_entrada_id: 'B', area_atual_id: 'B' }),
      ],
      movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 1000, area_origem_id: 'A', area_destino_id: 'B' })],
      manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 1 }),
    }, { mostrarIds: true });
    assert.equal(r.estado, 'conciliada');
    assert.equal(r.apto_matematico, true);
    assert.equal(r.apto_para_backfill, true);
    assert.deepEqual(r.motivos_bloqueio_backfill, []);
    assert.deepEqual(r.por_empresa.map((e) => [e.empresa, e.estado, e.apto_para_backfill]), [['E', 'conciliada', true]]);
  });

  test('150/135 + self-target de 15 → reconciliacao_parcial e apto=false', () => {
    const r = auditarLedgerPecuario({
      lotes: [lote({ id: 'L1', quantidade_entrada: 150, quantidade_cabecas: 135, area_entrada_id: 'X', area_atual_id: 'X' })],
      movimentacoes_mapa: [transf('M1', { lote_id: 'L1', quantidade_animais: 15, area_origem_id: 'X', area_destino_id: 'X' })],
    }, { mostrarIds: true });
    assert.equal(r.estado, 'reconciliacao_parcial');
    assert.equal(r.apto_para_backfill, false);
    assert.equal(r.por_empresa[0].apto_para_backfill, false);
  });

  test('quarentena impeditiva → apto=false', () => {
    const r = auditarLedgerPecuario({ lotes: [lote({ id: 'N', origem: 'Nascimento', quantidade_entrada: 3, quantidade_cabecas: 3, area_entrada_id: 'A', area_atual_id: 'A' })], movimentacoes_mapa: [] }, { mostrarIds: true });
    assert.equal(r.estado, 'bloqueada_para_backfill');
    assert.equal(r.apto_para_backfill, false);
  });

  test('diferença TOTAL zero com duas lacunas opostas por área → apto=false', () => {
    const r = auditarLedgerPecuario({ lotes: [lote({ id: 'L', quantidade_entrada: 10, quantidade_cabecas: 10, area_entrada_id: 'A', area_atual_id: 'B' })], movimentacoes_mapa: [] }, { mostrarIds: true });
    assert.equal(r.resumo.diferenca_total, 0);
    assert.equal(r.resumo.linhas_com_lacuna, 2);
    assert.equal(r.apto_para_backfill, false);
  });

  test('self-target SEM lacuna (só suspeita) → apto=false', () => {
    const r = auditarLedgerPecuario({
      lotes: [lote({ id: 'L', quantidade_entrada: 20, quantidade_cabecas: 20, area_entrada_id: 'A', area_atual_id: 'A' })],
      movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 5, area_origem_id: 'A', area_destino_id: 'A' })],
    }, { mostrarIds: true });
    assert.equal(r.resumo.linhas_com_lacuna, 0);
    assert.equal(r.apto_para_backfill, false);
  });

  test('empresa só com quarentena/suspeita aparece em por_empresa e não é apta; sem empresa → (sem_empresa); dump vazio → sem_dados', () => {
    const r = auditarLedgerPecuario({
      lotes: [
        lote({ id: 'OK', quantidade_entrada: 5, quantidade_cabecas: 5, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'Q', empresa_id: 'F', quantidade_entrada: '1.5', quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'S', empresa_id: null, quantidade_entrada: 4, quantidade_cabecas: 4, area_entrada_id: 'A', area_atual_id: 'A' }),
      ],
      movimentacoes_mapa: [],
      manifesto_snapshot: manifestoV1({ empresas: ['E', 'F'], lotes: 3, movimentacoes_mapa: 0 }),
    }, { mostrarIds: true });
    const por = Object.fromEntries(r.por_empresa.map((e) => [e.empresa, e]));
    assert.equal(por.E.apto_matematico, true);
    assert.equal(por.E.apto_para_backfill, false, 'R4: lote sem empresa está fora do escopo do manifesto → snapshot inválido');
    assert.ok(r.motivos_bloqueio_backfill.includes('registro_fora_do_escopo'));
    assert.equal(por.F.apto_para_backfill, false);
    assert.equal(por.F.estado, 'bloqueada_para_backfill');
    assert.equal(por['(sem_empresa)'].apto_para_backfill, false);
    assert.equal(r.apto_para_backfill, false, 'uma empresa inapta derruba o geral');
    // Mesmo cenário sem o lote órfão e com manifesto coerente: E é apta, F não, geral não.
    const r2 = auditarLedgerPecuario({
      lotes: [
        lote({ id: 'OK', quantidade_entrada: 5, quantidade_cabecas: 5, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'Q', empresa_id: 'F', quantidade_entrada: '1.5', quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
      ],
      movimentacoes_mapa: [],
      manifesto_snapshot: manifestoV1({ empresas: ['E', 'F'], lotes: 2, movimentacoes_mapa: 0 }),
    }, { mostrarIds: true });
    const por2 = Object.fromEntries(r2.por_empresa.map((e) => [e.empresa, e]));
    assert.equal(r2.snapshot.valido, true);
    assert.equal(por2.E.apto_para_backfill, true);
    assert.equal(por2.F.apto_para_backfill, false);
    assert.equal(r2.apto_para_backfill, false);
    const vazio = auditarLedgerPecuario({ lotes: [], movimentacoes_mapa: [] });
    assert.equal(vazio.estado, 'sem_dados');
    assert.equal(vazio.apto_para_backfill, false);
  });
});

describe('R3 — quantidades: inteiro seguro até int4, sem truncar', () => {
  test('limites', () => {
    assert.equal(QUANTIDADE_MAXIMA_REGISTRO_HISTORICO, 2_147_483_647);
    assert.equal(inteiroPositivoEstrito(2_147_483_647), 2_147_483_647, 'limite int4 válido');
    assert.equal(inteiroPositivoEstrito('2147483647'), 2_147_483_647);
    for (const v of [2_147_483_648, '2147483648', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, '9007199254740993', 1e300, '99999999999']) {
      assert.equal(inteiroPositivoEstrito(v), null, String(v));
    }
  });

  test('quantidade acima de int4 vai para quarentena (entrada e movimento), nunca para a matriz', () => {
    const r = auditarLedgerPecuario({
      lotes: [{ id: 'L', empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria_manejo_id: 'b', categoria_manejo_entrada_id: 'b', quantidade_entrada: Number.MAX_SAFE_INTEGER + 1, quantidade_cabecas: 2 ** 31, area_entrada_id: 'A', area_atual_id: 'A' }],
      movimentacoes_mapa: [{ id: 'M', empresa_id: 'E', dados: { tipo: 'Transferência de Área', lote_id: 'L', quantidade_animais: 2 ** 31, area_origem_id: 'A', area_destino_id: 'B' } }],
    }, { mostrarIds: true });
    const m = r.quarentena.map((q) => q.motivo);
    for (const x of ['quantidade_entrada_invalida', 'quantidade_cabecas_invalida', 'quantidade_movimento_invalida']) assert.ok(m.includes(x), x);
    assert.equal(r.matriz.length, 0);
    assert.equal(r.apto_para_backfill, false);
  });
});

describe('R4 — integridade do snapshot (manifesto externo v1)', () => {
  // R5: toda linha traz o tenant do escopo; a ausência é provada à parte.
  const lote = (o) => ({ cliente_id: CLIENTE_SINTETICO, empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi', ...o });
  const transf = (id, o) => ({ id, cliente_id: CLIENTE_SINTETICO, empresa_id: 'E', dados: { tipo: 'Transferência de Área', ...o } });
  // Cenário conciliado de referência: 1000 cabeças A→B na empresa E (2 lotes, 1 movimento).
  const conciliado = (extra = {}) => ({
    lotes: [
      lote({ id: 'L', status: 'Inativo', quantidade_entrada: 1000, quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
      lote({ id: 'G', origem: 'MOVIMENTAÇÃO', quantidade_entrada: 1000, quantidade_cabecas: 1000, area_entrada_id: 'B', area_atual_id: 'B' }),
    ],
    movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 1000, area_origem_id: 'A', area_destino_id: 'B' })],
    manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 1 }),
    ...extra,
  });
  const umLote = (extra = {}) => ({ lotes: [lote({ id: 'L', quantidade_entrada: 7, quantidade_cabecas: 7, area_entrada_id: 'A', area_atual_id: 'A' })], ...extra });
  const auditar = (dump) => auditarLedgerPecuario(dump, { mostrarIds: true });
  const motivos = (r) => r.motivos_bloqueio_backfill;

  test('(A) movimentacoes_mapa OMITIDO nunca vira zero: apto=false com motivo estável; malformado idem', () => {
    const semMovs = conciliado();
    delete semMovs.movimentacoes_mapa;
    const r = auditar({ ...semMovs, manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 0 }) });
    assert.equal(r.apto_para_backfill, false);
    assert.equal(r.snapshot.fontes.movimentacoes_mapa, 'ausente');
    assert.ok(motivos(r).includes('fonte_movimentacoes_mapa_ausente'));
    assert.equal(estadoDaFonte(undefined), 'ausente');
    for (const v of [null, {}, 'x', [1], [null], [{}, 'x']]) assert.equal(estadoDaFonte(v), 'malformada', JSON.stringify(v));
    assert.equal(estadoDaFonte([]), 'presente');
    const mal = auditar({ ...conciliado(), movimentacoes_mapa: { M: 1 } });
    assert.equal(mal.apto_para_backfill, false);
    assert.ok(motivos(mal).includes('fonte_movimentacoes_mapa_malformada'));
    const semLotes = auditar({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 0, movimentacoes_mapa: 0 }) });
    assert.ok(motivos(semLotes).includes('fonte_lotes_ausente'));
  });

  test('(B) movimentacoes_mapa: [] SEM manifesto: conta pode fechar, mas apto=false (manifesto_ausente)', () => {
    const r = auditar(umLote({ movimentacoes_mapa: [] }));
    assert.equal(r.estado, 'conciliada');
    assert.equal(r.apto_matematico, true);
    assert.equal(r.apto_para_backfill, false);
    assert.deepEqual(motivos(r), ['manifesto_ausente']);
    assert.equal(r.por_empresa[0].apto_para_backfill, false);
    for (const m of [null, 'snap', [], 7]) assert.ok(motivos(auditar(umLote({ movimentacoes_mapa: [], manifesto_snapshot: m }))).includes('manifesto_malformado'));
  });

  test('(C) manifesto válido declarando ZERO movimentações + [] → apto=true', () => {
    const r = auditar(umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0 }) }));
    assert.equal(r.snapshot.valido, true);
    assert.equal(r.apto_para_backfill, true);
    assert.deepEqual(motivos(r), []);
    assert.deepEqual(r.snapshot.contagens, { declaradas: { lotes: 1, movimentacoes_mapa: 0 }, lidas: { lotes: 1, movimentacoes_mapa: 0 } });
  });

  test('(D) manifesto declara 2 movimentações e o dump tem 1 → contagem_movimentacoes_divergente', () => {
    const r = auditar(conciliado({ manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 2 }) }));
    assert.equal(r.estado, 'conciliada', 'o estado matemático não muda');
    assert.equal(r.apto_para_backfill, false);
    assert.ok(motivos(r).includes('contagem_movimentacoes_divergente'));
  });

  test('(E) manifesto declara 1000 lotes e o dump tem 1 → contagem_lotes_divergente; contagem inválida → manifesto_contagens_invalidas', () => {
    const r = auditar(umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1000, movimentacoes_mapa: 0 }) }));
    assert.equal(r.apto_para_backfill, false);
    assert.deepEqual(r.snapshot.impedimentos.map((i) => i.codigo), ['contagem_lotes_divergente']);
    for (const c of [-1, 1.5, '1', null, undefined]) {
      const x = auditar(umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: c, movimentacoes_mapa: 0 }) }));
      assert.ok(motivos(x).includes('manifesto_contagens_invalidas'), String(c));
    }
  });

  test('(F) escopo com 2 empresas e só 1 no dump → sem prova de zero; zero explícito em por_empresa → aceito', () => {
    const base = umLote({ movimentacoes_mapa: [] });
    const r = auditar({ ...base, manifesto_snapshot: manifestoV1({ empresas: ['E', 'F'], lotes: 1, movimentacoes_mapa: 0 }) });
    assert.equal(r.apto_para_backfill, false);
    assert.ok(motivos(r).includes('empresa_do_escopo_sem_prova_de_zero'));
    assert.deepEqual(r.snapshot.empresas.sem_registros, ['F']);
    const ok = auditar({
      ...base,
      manifesto_snapshot: manifestoV1({ empresas: ['E', 'F'], lotes: 1, movimentacoes_mapa: 0, por_empresa: { E: { lotes: 1, movimentacoes_mapa: 0 }, F: { lotes: 0, movimentacoes_mapa: 0 } } }),
    });
    assert.equal(ok.apto_para_backfill, true);
    const div = auditar({ ...base, manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0, por_empresa: { E: { lotes: 2, movimentacoes_mapa: 0 } } }) });
    assert.ok(motivos(div).includes('contagem_por_empresa_divergente'));
    const fora = auditar({ ...base, manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0, por_empresa: { E: { lotes: 1, movimentacoes_mapa: 0 }, Z: { lotes: 0, movimentacoes_mapa: 0 } } }) });
    assert.ok(motivos(fora).includes('manifesto_por_empresa_fora_do_escopo'));
    const malf = auditar({ ...base, manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0, por_empresa: [] }) });
    assert.ok(motivos(malf).includes('manifesto_por_empresa_malformado'));
    // Registro de empresa fora do escopo declarado bloqueia.
    const extra = auditar({ lotes: [...base.lotes, lote({ id: 'X', empresa_id: 'Y', quantidade_entrada: 1, quantidade_cabecas: 1, area_entrada_id: 'A', area_atual_id: 'A' })], movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 0 }) });
    assert.ok(motivos(extra).includes('registro_fora_do_escopo'));
    assert.deepEqual(extra.snapshot.empresas.fora_do_escopo, ['Y']);
    assert.equal(extra.apto_para_backfill, false);
  });

  test('(G) movimento com empresa diferente da do lote → quarentena impeditiva; deltas NÃO aplicados', () => {
    const dump = conciliado({ manifesto_snapshot: manifestoV1({ empresas: ['E', 'Y'], lotes: 2, movimentacoes_mapa: 1, por_empresa: { E: { lotes: 2, movimentacoes_mapa: 0 }, Y: { lotes: 0, movimentacoes_mapa: 1 } } }) });
    dump.movimentacoes_mapa[0].empresa_id = 'Y';
    const r = auditar(dump);
    const q = r.quarentena.find((x) => x.motivo === 'movimento_empresa_divergente_do_lote');
    assert.ok(q);
    assert.equal(q.impeditiva, true);
    assert.equal(r.matriz.filter((l) => l.empresa === 'Y').length, 0, 'nada contabilizado na empresa do movimento');
    assert.ok(r.matriz.filter((l) => l.empresa === 'E').every((l) => l.transf_in === 0 && l.transf_out === 0), 'nem na empresa do lote');
    assert.equal(r.estado, 'bloqueada_para_backfill');
    assert.equal(r.apto_para_backfill, false);
  });

  test('(H) ID de lote/movimento duplicado ou vazio → quarentena impeditiva, nunca "a última linha vence"', () => {
    const dupLote = conciliado({ manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 3, movimentacoes_mapa: 1 }) });
    dupLote.lotes.push(lote({ id: 'L', quantidade_entrada: 1000, quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }));
    const r1 = auditar(dupLote);
    const m1 = r1.quarentena.map((q) => q.motivo);
    assert.ok(m1.includes('lote_id_duplicado'));
    assert.ok(m1.includes('lote_referenciado_ambiguo'), 'movimento do lote duplicado não usa nenhuma das linhas');
    assert.equal(r1.estado, 'bloqueada_para_backfill');
    assert.equal(r1.apto_para_backfill, false);

    const dupMov = conciliado({ manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 2 }) });
    dupMov.movimentacoes_mapa.push(transf('M', { lote_id: 'L', quantidade_animais: 1000, area_origem_id: 'A', area_destino_id: 'B' }));
    const r2 = auditar(dupMov);
    assert.ok(r2.quarentena.some((q) => q.motivo === 'movimentacao_id_duplicada' && q.impeditiva));
    assert.equal(r2.apto_para_backfill, false);

    for (const vazio of [undefined, null, '', '  ']) {
      const lv = auditar(umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0 }) }));
      assert.equal(lv.apto_para_backfill, true, 'controle');
      const dl = umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0 }) });
      dl.lotes[0].id = vazio;
      const rl = auditar(dl);
      assert.ok(rl.quarentena.some((q) => q.motivo === 'lote_id_ausente' && q.impeditiva), String(vazio));
      assert.equal(rl.apto_para_backfill, false);
      const dm = conciliado();
      dm.movimentacoes_mapa[0].id = vazio;
      const rm = auditar(dm);
      assert.ok(rm.quarentena.some((q) => q.motivo === 'movimentacao_id_ausente' && q.impeditiva), String(vazio));
      assert.equal(rm.apto_para_backfill, false);
    }
  });

  test('(I) sem_dados: mesmo com manifesto coerente declarando zero, apto=false com motivo sem_dados', () => {
    const r = auditar({ lotes: [], movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 0, movimentacoes_mapa: 0, por_empresa: { E: { lotes: 0, movimentacoes_mapa: 0 } } }) });
    assert.equal(r.estado, 'sem_dados');
    assert.equal(r.snapshot.valido, true);
    assert.equal(r.apto_para_backfill, false);
    assert.deepEqual(motivos(r), ['sem_dados']);
  });

  test('(J) regressões da R3 continuam inaptas mesmo com manifesto VÁLIDO', () => {
    const casos = [
      // 150/135 + self-target
      { lotes: [lote({ id: 'L1', quantidade_entrada: 150, quantidade_cabecas: 135, area_entrada_id: 'X', area_atual_id: 'X' })], movimentacoes_mapa: [transf('M1', { lote_id: 'L1', quantidade_animais: 15, area_origem_id: 'X', area_destino_id: 'X' })], n: [1, 1] },
      // categoria do movimento não comprovável
      { lotes: [lote({ id: 'L', categoria_manejo_entrada_id: null, quantidade_entrada: 10, quantidade_cabecas: 10, area_entrada_id: 'A', area_atual_id: 'B' })], movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 10, area_origem_id: 'A', area_destino_id: 'B' })], n: [1, 1] },
      // lacunas opostas
      { lotes: [lote({ id: 'L', quantidade_entrada: 10, quantidade_cabecas: 10, area_entrada_id: 'A', area_atual_id: 'B' })], movimentacoes_mapa: [], n: [1, 0] },
      // nascimento
      { lotes: [lote({ id: 'N', origem: 'Nascimento', quantidade_entrada: 3, quantidade_cabecas: 3, area_entrada_id: 'A', area_atual_id: 'A' })], movimentacoes_mapa: [], n: [1, 0] },
      // acima de int4
      { lotes: [lote({ id: 'L', quantidade_entrada: 2 ** 31, quantidade_cabecas: 1, area_entrada_id: 'A', area_atual_id: 'A' })], movimentacoes_mapa: [], n: [1, 0] },
    ];
    for (const { n, ...d } of casos) {
      const r = auditar({ ...d, manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: n[0], movimentacoes_mapa: n[1] }) });
      assert.equal(r.snapshot.valido, true);
      assert.equal(r.apto_matematico, false);
      assert.equal(r.apto_para_backfill, false);
      assert.ok(motivos(r).includes('reconciliacao_nao_conciliada'));
    }
  });

  test('(K) pureza: o dump (manifesto incluso) sai idêntico; o validador não gera manifesto', () => {
    const dump = conciliado();
    const antes = structuredClone(dump);
    auditarLedgerPecuario(dump);
    validarManifestoSnapshot(dump);
    assert.deepEqual(dump, antes);
    const semManifesto = conciliado();
    delete semManifesto.manifesto_snapshot;
    auditarLedgerPecuario(semManifesto);
    assert.equal('manifesto_snapshot' in semManifesto, false);
  });

  test('(L) isolamento por empresa e tenant: duas empresas com tenant presente e igual → aptas; divergente bloqueia', () => {
    const dump = {
      lotes: [
        lote({ id: 'L1', quantidade_entrada: 5, quantidade_cabecas: 5, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'L2', empresa_id: 'F', quantidade_entrada: 9, quantidade_cabecas: 9, area_entrada_id: 'A', area_atual_id: 'A' }),
      ],
      movimentacoes_mapa: [],
      manifesto_snapshot: manifestoV1({ empresas: ['E', 'F'], lotes: 2, movimentacoes_mapa: 0 }),
    };
    const r = auditar(dump);
    assert.deepEqual(r.por_empresa.map((e) => [e.empresa, e.total_entradas, e.apto_para_backfill]), [['E', 5, true], ['F', 9, true]]);
    assert.equal(r.apto_para_backfill, true);
    assert.deepEqual(r.snapshot.avisos, []);
    const outro = structuredClone(dump);
    outro.lotes[1].cliente_id = 'outro-cliente';
    const ro = auditar(outro);
    assert.ok(motivos(ro).includes('cliente_divergente_do_escopo'));
    assert.equal(ro.apto_para_backfill, false);
    assert.ok(ro.por_empresa.every((e) => e.apto_para_backfill === false));
  });

  test('manifesto: campos obrigatórios e origem sem dado sensível; IDs do manifesto saem com hash', () => {
    const casos = [
      [{ versao: 2 }, 'manifesto_versao_nao_suportada'],
      [{ snapshot_id: '' }, 'manifesto_snapshot_id_invalido'],
      [{ capturado_em: '2026-10-01' }, 'manifesto_capturado_em_invalido'],
      [{ capturado_em: '2026-13-01T00:00:00Z' }, 'manifesto_capturado_em_invalido'],
      [{ capturado_em: '2999-01-01T00:00:00Z' }, 'manifesto_capturado_em_no_futuro'],
      [{ escopo: { empresas: ['E'] } }, 'manifesto_escopo_cliente_invalido'],
      [{ escopo: { cliente_id: 'c', empresas: [] } }, 'manifesto_escopo_empresas_invalido'],
      [{ escopo: { cliente_id: 'c', empresas: ['E', 'E'] } }, 'manifesto_escopo_empresas_invalido'],
      [{ consistencia: { modo: 'snapshot_transacional', confirmado: 'sim' } }, 'manifesto_consistencia_nao_declarada'],
      [{ consistencia: { modo: 'leitura_solta', confirmado: true } }, 'manifesto_consistencia_nao_declarada'],
      [{ origem: undefined }, 'manifesto_origem_ausente'],
      [{ origem: { tipo: 'postgres://u:p@host/db' } }, 'manifesto_origem_com_dado_sensivel'],
      [{ origem: { tipo: 'pg_dump', referencia: 'token=abc' } }, 'manifesto_origem_com_dado_sensivel'],
    ];
    for (const [o, codigo] of casos) {
      const r = auditar(umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0, ...o }) }));
      assert.ok(motivos(r).includes(codigo), codigo);
      assert.equal(r.apto_para_backfill, false, codigo);
      assert.ok(!JSON.stringify(r).includes('postgres://') && !JSON.stringify(r).includes('token=abc'), 'origem sensível nunca é ecoada');
    }
    const h = auditarLedgerPecuario(umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0 }) }));
    assert.equal(h.apto_para_backfill, true);
    const texto = JSON.stringify(h);
    for (const cru of ['snap-sintetico-001', 'cliente-sintetico']) assert.ok(!texto.includes(cru), `${cru} sai com hash`);
  });

  test('(M) CLI: --exigir-apto distingue apto (0), inapto (3), falha técnica (1) e uso (2); IDs com hash', () => {
    const cli = fileURLToPath(new URL('../../scripts/ops/auditar-ledger-pecuario.mjs', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'ledger-r4-'));
    try {
      const gravar = (nome, conteudo) => {
        const p = join(dir, nome);
        writeFileSync(p, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
        return p;
      };
      const rodar = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8', env: {} });
      const apto = gravar('apto.json', umLote({ movimentacoes_mapa: [], manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0 }) }));
      const inapto = gravar('inapto.json', umLote({ movimentacoes_mapa: [] }));
      const ok = rodar('--entrada', apto, '--exigir-apto');
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /estado: conciliada — apto_para_backfill: true/);
      assert.ok(!ok.stdout.includes('cliente-sintetico') && !ok.stdout.includes('snap-sintetico-001'), 'saída padrão sem IDs crus');
      const no = rodar('--entrada', inapto, '--exigir-apto');
      assert.equal(no.status, 3);
      assert.match(no.stdout, /motivos de bloqueio: manifesto_ausente/);
      assert.equal(rodar('--entrada', inapto).status, 0, 'sem a flag, auditoria executada = 0');
      const quebrado = rodar('--entrada', gravar('quebrado.json', '{ não é json'), '--exigir-apto');
      assert.equal(quebrado.status, 1);
      assert.match(quebrado.stderr, /FALHA TÉCNICA/);
      assert.equal(rodar('--entrada', join(dir, 'inexistente.json'), '--exigir-apto').status, 1);
      assert.equal(rodar().status, 2);
      assert.equal(rodar('--entrada').status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('R5 — tenant verificado em TODA linha e capturado_em como instante UTC real', () => {
  const lote = (o) => ({ cliente_id: CLIENTE_SINTETICO, empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria: 'BOI', categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi', ...o });
  const transf = (id, o) => ({ id, cliente_id: CLIENTE_SINTETICO, empresa_id: 'E', dados: { tipo: 'Transferência de Área', ...o } });
  // 1000 A→B conciliado; tenant em todas as linhas (controle positivo).
  const conciliado = () => ({
    lotes: [
      lote({ id: 'L', status: 'Inativo', quantidade_entrada: 1000, quantidade_cabecas: 0, area_entrada_id: 'A', area_atual_id: 'A' }),
      lote({ id: 'G', origem: 'MOVIMENTAÇÃO', quantidade_entrada: 1000, quantidade_cabecas: 1000, area_entrada_id: 'B', area_atual_id: 'B' }),
    ],
    movimentacoes_mapa: [transf('M', { lote_id: 'L', quantidade_animais: 1000, area_origem_id: 'A', area_destino_id: 'B' })],
    manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 2, movimentacoes_mapa: 1 }),
  });
  const auditar = (dump, opcoes = { mostrarIds: true }) => auditarLedgerPecuario(dump, opcoes);
  const impedimento = (r, codigo) => r.snapshot.impedimentos.find((i) => i.codigo === codigo);
  /** Conta fechada, tenant não verificável: aptidão cai, matemática intacta. */
  const assertInaptoSoPeloTenant = (r, codigo, linhas) => {
    assert.equal(r.estado, 'conciliada');
    assert.equal(r.apto_matematico, true);
    assert.equal(r.snapshot.valido, false);
    assert.equal(r.apto_para_backfill, false);
    assert.ok(r.por_empresa.every((e) => e.apto_matematico === true && e.apto_para_backfill === false));
    assert.deepEqual(r.motivos_bloqueio_backfill, [codigo]);
    assert.equal(impedimento(r, codigo).linhas, linhas);
  };

  test('(6) controle: tenant presente e igual em todas as linhas + manifesto válido → apto=true', () => {
    const r = auditar(conciliado());
    assert.equal(r.snapshot.valido, true);
    assert.equal(r.apto_para_backfill, true);
    assert.deepEqual(r.snapshot.avisos, []);
  });

  test('(1) lote conciliado SEM cliente_id → cliente_ausente_em_linhas; o cliente do manifesto não substitui o da linha', () => {
    const d = conciliado();
    delete d.lotes[0].cliente_id;
    const r = auditar(d);
    assertInaptoSoPeloTenant(r, 'cliente_ausente_em_linhas', 1);
    assert.deepEqual(r.snapshot.avisos, [{ codigo: 'cliente_nao_verificado_em_linhas', linhas: 1 }]);
    assert.equal('cliente_id' in d.lotes[0], false, 'auditor não preenche o tenant');
  });

  test('(2) movimento conciliado SEM cliente_id → cliente_ausente_em_linhas', () => {
    const d = conciliado();
    delete d.movimentacoes_mapa[0].cliente_id;
    assertInaptoSoPeloTenant(auditar(d), 'cliente_ausente_em_linhas', 1);
  });

  test('(3) mistura de linhas com e sem cliente_id → conta todas as não verificáveis', () => {
    const d = conciliado();
    d.lotes[1].cliente_id = undefined;
    d.movimentacoes_mapa[0].cliente_id = null;
    assertInaptoSoPeloTenant(auditar(d), 'cliente_ausente_em_linhas', 2);
  });

  test('(4) linha de OUTRO tenant → cliente_divergente_do_escopo (sem inferir pela empresa)', () => {
    const d = conciliado();
    d.movimentacoes_mapa[0].cliente_id = 'outro-cliente';
    assertInaptoSoPeloTenant(auditar(d), 'cliente_divergente_do_escopo', 1);
    const pad = conciliado();
    pad.lotes[0].cliente_id = ` ${CLIENTE_SINTETICO} `;
    assertInaptoSoPeloTenant(auditar(pad), 'cliente_divergente_do_escopo', 1);
  });

  test('(5) cliente_id vazio/só espaços = ausente; tipo inesperado = inválido', () => {
    for (const v of ['', ' ', '\t\n']) {
      const d = conciliado();
      d.lotes[0].cliente_id = v;
      assertInaptoSoPeloTenant(auditar(d), 'cliente_ausente_em_linhas', 1);
    }
    for (const v of [7, 0, true, {}, [CLIENTE_SINTETICO], { id: CLIENTE_SINTETICO }]) {
      const d = conciliado();
      d.movimentacoes_mapa[0].cliente_id = v;
      assertInaptoSoPeloTenant(auditar(d), 'cliente_invalido_em_linhas', 1);
    }
  });

  test('(7) estado matemático × aptidão: conta quebrada E tenant ausente mostram os dois motivos, sem um esconder o outro', () => {
    const d = {
      lotes: [{ id: 'L1', empresa_id: 'E', origem: 'Compra', status: 'Ativo', categoria_manejo_id: 'boi', categoria_manejo_entrada_id: 'boi', quantidade_entrada: 150, quantidade_cabecas: 135, area_entrada_id: 'X', area_atual_id: 'X' }],
      movimentacoes_mapa: [],
      manifesto_snapshot: manifestoV1({ empresas: ['E'], lotes: 1, movimentacoes_mapa: 0 }),
    };
    const r = auditar(d);
    assert.equal(r.estado, 'reconciliacao_parcial');
    assert.equal(r.apto_matematico, false);
    assert.equal(r.apto_para_backfill, false);
    assert.deepEqual(r.motivos_bloqueio_backfill, ['reconciliacao_nao_conciliada', 'cliente_ausente_em_linhas']);
    assert.equal(r.matriz[0].lacuna, -15, 'a divergência matemática continua visível');
  });

  test('multitenant + multiempresa com escopo explícito: uma linha de outro tenant derruba tudo; saída padrão sem tenant cru', () => {
    const base = () => ({
      lotes: [
        lote({ id: 'E1', quantidade_entrada: 5, quantidade_cabecas: 5, area_entrada_id: 'A', area_atual_id: 'A' }),
        lote({ id: 'F1', empresa_id: 'F', quantidade_entrada: 9, quantidade_cabecas: 9, area_entrada_id: 'A', area_atual_id: 'A' }),
      ],
      movimentacoes_mapa: [],
      manifesto_snapshot: manifestoV1({ empresas: ['E', 'F'], lotes: 2, movimentacoes_mapa: 0 }),
    });
    assert.equal(auditar(base()).apto_para_backfill, true);
    const d = base();
    d.lotes[1].cliente_id = 'tenant-vizinho-segredo';
    const r = auditar(d, {});
    assert.equal(r.apto_para_backfill, false);
    assert.ok(r.por_empresa.every((e) => e.apto_matematico === true && e.apto_para_backfill === false), 'E também cai: o snapshot inteiro está contaminado');
    assert.ok(r.motivos_bloqueio_backfill.includes('cliente_divergente_do_escopo'));
    const texto = JSON.stringify(r);
    for (const cru of ['tenant-vizinho-segredo', CLIENTE_SINTETICO]) assert.ok(!texto.includes(cru), `${cru} não sai cru`);
  });

  test('(8) capturado_em: datas inexistentes, horas inválidas, zona/espaço/sufixo e fora da faixa → manifesto_capturado_em_invalido', () => {
    const invalidos = [
      '2026-02-30T12:00:00Z', '2026-04-31T00:00:00Z', '1900-02-29T00:00:00Z', '2100-02-29T00:00:00Z', '2023-02-29T00:00:00Z',
      '2026-10-29T24:00:00Z', '2026-10-29T12:60:00Z', '2026-10-29T12:00:60Z', '2026-12-31T23:59:60Z',
      '2026-00-10T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-00T00:00:00Z', '2026-10-32T00:00:00Z',
      '2026-10-29T12:00:00+00:00', '2026-10-29T12:00:00z', '2026-10-29t12:00:00Z', '2026-10-29 12:00:00Z',
      ' 2026-10-29T12:00:00Z', '2026-10-29T12:00:00Z ', '2026-10-29T12:00:00Zx', '2026-10-29T12:00:00',
      '2026-10-29T12:00:00.Z', '2026-10-29T12:00:00.1234Z', '2026-10-29T12:00Z', '+002026-10-29T12:00:00Z',
      '1899-12-31T23:59:59Z', '0099-01-01T00:00:00Z', '0000-01-01T00:00:00Z', '',
      Date.UTC(2026, 9, 1), new Date(Date.UTC(2026, 9, 1)), null, undefined,
    ];
    for (const v of invalidos) {
      assert.equal(instanteUtcEstrito(v), null, String(v));
      const d = conciliado();
      d.manifesto_snapshot.capturado_em = v;
      const r = auditar(d);
      assert.deepEqual(r.motivos_bloqueio_backfill, ['manifesto_capturado_em_invalido'], String(v));
      assert.equal(r.snapshot.resumo.capturado_em, null, 'valor rejeitado não é ecoado');
      assert.equal(r.apto_para_backfill, false);
    }
  });

  test('(9) capturado_em válido: bissextos, milissegundos de 1–3 dígitos e limites da faixa', () => {
    assert.equal(ANO_MINIMO_CAPTURADO_EM, 1900);
    assert.equal(ANO_MAXIMO_CAPTURADO_EM, 9999);
    const validos = [
      ['2024-02-29T10:11:12Z', Date.UTC(2024, 1, 29, 10, 11, 12)],
      ['2000-02-29T23:59:59.123Z', Date.UTC(2000, 1, 29, 23, 59, 59, 123)],
      ['2026-10-29T12:00:00.5Z', Date.UTC(2026, 9, 29, 12, 0, 0, 500)],
      ['2026-10-29T12:00:00.05Z', Date.UTC(2026, 9, 29, 12, 0, 0, 50)],
      ['2026-12-31T23:59:59Z', Date.UTC(2026, 11, 31, 23, 59, 59)],
      ['1900-01-01T00:00:00Z', Date.UTC(1900, 0, 1)],
      ['9999-12-31T23:59:59.999Z', Date.UTC(9999, 11, 31, 23, 59, 59, 999)],
    ];
    for (const [v, ms] of validos) assert.equal(instanteUtcEstrito(v), ms, v);
    const d = conciliado();
    d.manifesto_snapshot.capturado_em = '2024-02-29T10:11:12Z';
    const r = auditar(d);
    assert.equal(r.apto_para_backfill, true);
    assert.equal(r.snapshot.resumo.capturado_em, '2024-02-29T10:11:12Z');
  });

  test('capturado_em no futuro: relógio controlado, limite exato de 5 min', () => {
    const agora = Date.UTC(2026, 9, 1, 12, 0, 0);
    assert.equal(TOLERANCIA_FUTURO_CAPTURADO_EM_MS, 300_000);
    const comCaptura = (iso) => {
      const d = conciliado();
      d.manifesto_snapshot.capturado_em = iso;
      return validarManifestoSnapshot(d, undefined, agora).impedimentos.map((i) => i.codigo);
    };
    assert.deepEqual(comCaptura('2026-10-01T12:05:00.000Z'), [], 'exatamente +5 min é aceito');
    assert.deepEqual(comCaptura('2026-10-01T12:05:00.001Z'), ['manifesto_capturado_em_no_futuro']);
    assert.deepEqual(comCaptura('2026-10-01T11:00:00Z'), []);
    assert.deepEqual(comCaptura('2026-02-30T12:00:00Z'), ['manifesto_capturado_em_invalido'], 'calendário vem antes do relógio');
  });

  test('(10) CLI --exigir-apto: tenant não verificável ou divergente → exit 3, sem ecoar tenant cru', () => {
    const cli = fileURLToPath(new URL('../../scripts/ops/auditar-ledger-pecuario.mjs', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'ledger-r5-'));
    try {
      const rodar = (nome, dump) => {
        const p = join(dir, nome);
        writeFileSync(p, JSON.stringify(dump));
        return spawnSync(process.execPath, [cli, '--entrada', p, '--exigir-apto'], { encoding: 'utf8', env: {} });
      };
      const ok = rodar('ok.json', conciliado());
      assert.equal(ok.status, 0, ok.stderr);
      const sem = conciliado();
      delete sem.lotes[0].cliente_id;
      const r1 = rodar('sem.json', sem);
      assert.equal(r1.status, 3);
      assert.match(r1.stdout, /motivos de bloqueio: cliente_ausente_em_linhas/);
      const outro = conciliado();
      outro.movimentacoes_mapa[0].cliente_id = 'tenant-vizinho-segredo';
      const r2 = rodar('outro.json', outro);
      assert.equal(r2.status, 3);
      assert.match(r2.stdout, /cliente_divergente_do_escopo/);
      for (const r of [ok, r1, r2]) {
        for (const cru of ['tenant-vizinho-segredo', CLIENTE_SINTETICO, 'snap-sintetico-001']) assert.ok(!`${r.stdout}${r.stderr}`.includes(cru), cru);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PENDING — depende da integração L2 (após merge da PR #145)', () => {
  test.todo('models Prisma + migration aditiva versionada das tabelas do ledger (hoje só DDL em esquema descartável)');
  test.todo('rota HTTP autenticada (auth_context) + códigos LEDGER_PECUARIO_* no mapa global de erros');
  test.todo('grants/RLS backend-only no Supabase para as novas tabelas (gate supabase-public-grants)');
  test.todo('backfill controlado do legado a partir da reconciliação, com quarentena revisada manualmente');
  test.todo('Mapa Geral/cadastro passam a ler a posição do ledger (sem mudança visual)');
});
