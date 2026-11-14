/**
 * D-PROD-198 — motor do peso projetado (puro, sem banco).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ganhoNoPeriodo, diaQueAtinge, criarProjetor, gmdDoDia, somarDias } from '../src/modules/rebanhoLedger/pesoProjetado.js';

const curva = (gmd) => Object.fromEntries(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].map((m, i) => [`gmd_${m}`, Array.isArray(gmd) ? gmd[i] : gmd]));
const PASTO = curva(0.5);
const CONF = curva(1.5);
const MESES = curva([0.65, 0.65, 0.6, 0.5, 0.35, 0.25, 0.2, 0.2, 0.25, 0.4, 0.55, 0.65]);

describe('ganho no período', () => {
  test('soma o GMD de cada dia depois da base, mês a mês', () => {
    // 15/11 → 30/11: 15 dias × 0,55 = 8,25
    assert.equal(Number(ganhoNoPeriodo(MESES, '2026-11-15', '2026-11-30').toFixed(4)), 8.25);
    // 15/11 → 31/12: + 31 × 0,65 = 28,4
    assert.equal(Number(ganhoNoPeriodo(MESES, '2026-11-15', '2026-12-31').toFixed(4)), 28.4);
    // ano bissexto: fevereiro de 2028 tem 29 dias
    assert.equal(Number(ganhoNoPeriodo(PASTO, '2028-01-31', '2028-02-29').toFixed(4)), 14.5);
    assert.equal(ganhoNoPeriodo(PASTO, '2026-11-15', '2026-11-15'), 0);
    assert.equal(ganhoNoPeriodo(null, '2026-11-01', '2026-12-01'), 0);
    assert.equal(gmdDoDia(MESES, '2026-07-10'), 0.2);
  });

  test('dia em que atinge o objetivo', () => {
    assert.equal(diaQueAtinge(PASTO, '2026-01-01', 400, 410), '2026-01-21');
    assert.equal(diaQueAtinge(PASTO, '2026-01-01', 420, 410), '2026-01-01');
    assert.equal(diaQueAtinge(curva(0), '2026-01-01', 400, 410), null);
    assert.equal(diaQueAtinge(PASTO, '2026-01-01', 400, null), null);
  });
});

const ev = (id, tipo, dia, ordem, dados = {}) => [id, { id, tipo, dia, registrado_em: `2026-01-01T00:00:0${ordem}.000Z`, dados }];

describe('projetor', () => {
  test('pasto → confinamento: a base derivada usa o projetado da origem no dia da mudança', () => {
    // Posição P (BOI PASTO) pesou 400 kg em 01/03 com 10 cabeças. Em 31/03 as 10 mudam de
    // categoria para C (BOI CONFINAMENTO); o ledger grava em C o peso REGISTRADO de P (400).
    const eventos = new Map([
      ev('e1', 'PESAGEM', '2026-03-01', 1),
      ev('e0', 'ENTRADA', '2026-02-01', 0),
      ev('e2', 'MUDANCA_CATEGORIA', '2026-03-31', 2, { pesos_derivados: [{ destino_posicao_id: 'C', entradas: [{ q: 10, posicao_id: 'P', peso_informado: null }] }] }),
    ]);
    const projetor = criarProjetor({
      posicoes: new Map([['P', { categoria_manejo_id: 'pasto' }], ['C', { categoria_manejo_id: 'conf' }]]),
      categorias: new Map([['pasto', { curva: PASTO, peso_objetivo_kg: null }], ['conf', { curva: CONF, peso_objetivo_kg: 540 }]]),
      eventos,
      pesos: [
        { posicao_id: 'P', evento_id: 'e0', dia: '2026-02-01', peso: 380, medido: true },
        { posicao_id: 'P', evento_id: 'e1', dia: '2026-03-01', peso: 400, medido: true },
        { posicao_id: 'C', evento_id: 'e2', dia: '2026-03-31', peso: 400, medido: false },
      ],
      partidas: [
        { posicao_id: 'P', evento_id: 'e0', dia: '2026-02-01', delta: 10 },
        { posicao_id: 'P', evento_id: 'e2', dia: '2026-03-31', delta: -10 },
        { posicao_id: 'C', evento_id: 'e2', dia: '2026-03-31', delta: 10 },
      ],
    });
    const r = projetor.resumo('C', '2026-05-30');
    // 400 + 30 × 0,5 (pasto, 02/03..31/03) = 415; + 60 × 1,5 (confinamento, 01/04..30/05) = 505
    assert.equal(r.base.peso_kg, 415);
    assert.equal(r.base.peso_gravado_kg, 400);
    assert.equal(r.base.derivado, true);
    assert.equal(r.base.tipo, 'MUDANCA_CATEGORIA');
    assert.equal(r.peso_kg, 505);
    assert.equal(r.arroba, 16.83);
    assert.equal(r.gmd_hoje_kg, 1.5);
    assert.equal(r.peso_objetivo_kg, 540);
    assert.equal(r.falta_kg, 35);
    assert.equal(r.data_prevista_objetivo, somarDias('2026-05-30', 24)); // 35 ÷ 1,5 → 24 dias
    assert.equal(r.projecao_mensal.length, 12);
    assert.equal(r.projecao_mensal[0].dia, '2026-05-31');
    assert.equal(r.projecao_mensal[0].peso_kg, 506.5);
  });

  test('pesado × previsto: a última pesagem comparada com o projetado logo antes dela', () => {
    const projetor = criarProjetor({
      posicoes: new Map([['L', { categoria_manejo_id: 'g' }]]),
      categorias: new Map([['g', { curva: MESES, peso_objetivo_kg: null }]]),
      eventos: new Map([ev('a', 'ENTRADA', '2026-11-15', 0), ev('b', 'PESAGEM', '2027-02-10', 1)]),
      pesos: [
        { posicao_id: 'L', evento_id: 'a', dia: '2026-11-15', peso: 280, medido: true },
        { posicao_id: 'L', evento_id: 'b', dia: '2027-02-10', peso: 330, medido: true },
      ],
      partidas: [{ posicao_id: 'L', evento_id: 'a', dia: '2026-11-15', delta: 50 }],
    });
    const r = projetor.resumo('L', '2027-02-11');
    // previsto em 10/02: 280 + 15×0,55 + 31×0,65 + 31×0,65 + 10×0,65 = 335,05
    assert.equal(r.ultima_pesagem.previsto_kg, 335.05);
    assert.equal(r.ultima_pesagem.peso_kg, 330);
    assert.equal(r.ultima_pesagem.percentual_do_previsto, 98.49);
    // hoje: base é a pesagem (330) + 1 dia × 0,65
    assert.equal(r.base.tipo, 'PESAGEM');
    assert.equal(r.peso_kg, 330.65);
  });

  test('sem peso → indisponível; sem curva → projeta sem ganho e avisa', () => {
    const projetor = criarProjetor({
      posicoes: new Map([['A', { categoria_manejo_id: null }], ['B', { categoria_manejo_id: null }]]),
      categorias: new Map(),
      eventos: new Map([ev('x', 'ENTRADA', '2026-11-01', 0)]),
      pesos: [{ posicao_id: 'B', evento_id: 'x', dia: '2026-11-01', peso: 300, medido: true }],
      partidas: [],
    });
    assert.deepEqual(projetor.resumo('A', '2026-11-14'), { disponivel: false, motivo: 'sem_peso', sem_curva: true, peso_objetivo_kg: null });
    const b = projetor.resumo('B', '2026-11-14');
    assert.equal(b.peso_kg, 300);
    assert.equal(b.sem_curva, true);
  });

  test('origem com peso desconhecido: a base derivada cai para o peso gravado (nunca inventa)', () => {
    const projetor = criarProjetor({
      posicoes: new Map([['P', { categoria_manejo_id: 'g' }], ['D', { categoria_manejo_id: 'g' }]]),
      categorias: new Map([['g', { curva: PASTO, peso_objetivo_kg: null }]]),
      eventos: new Map([ev('t', 'TRANSFERENCIA', '2026-11-10', 0, { pesos_derivados: [{ destino_posicao_id: 'D', entradas: [{ q: 5, posicao_id: 'P', peso_informado: null }] }] })]),
      pesos: [{ posicao_id: 'D', evento_id: 't', dia: '2026-11-10', peso: 350, medido: false }],
      partidas: [],
    });
    const r = projetor.resumo('D', '2026-11-12');
    assert.equal(r.base.peso_kg, 350);
    assert.equal(r.base.derivado, false);
    assert.equal(r.peso_kg, 351);
  });
});
