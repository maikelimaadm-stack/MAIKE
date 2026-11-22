/**
 * D-PROD-273 (fatia 3) — o replay PURO sobre históricos sintéticos (sem banco): a era LEGADA (saída FIFO de antes do
 * custo médio, D-PROD-256, e o estorno anterior ao corte, que devolvia sem reavaliar), a passagem do legado à regra
 * atual quando a simulação alcança o depósito, a ordem canônica e o movimento fora do protocolo (fail-closed).
 * Os valores "gravados" de cada caso estão calculados à mão no próprio teste.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compararCanonico, compararComGravado, ordenarCanonico, reproduzir, simularExclusao } from '../src/modules/estoqueRecalculo/estoqueReplay.js';

const A = 'deposito-a';
const dd = (d) => String(d).padStart(2, '0');
const dia = (d) => new Date(`2026-11-${dd(d)}T12:00:00.000Z`);
let n = 0;
const mov = (extra) => ({
  numero_movimentacao: String(++n), createdAt: dia(10), status: 'Ativa', origem_sistema: 'operacao_financeira', modo_saida_fifo: null,
  lotes_consumidos: null, movimento_pai_id: null, movimento_filho_id: null, lancamento_origem_id: null, local_estoque_origem: null, local_estoque_destino: null,
  custo_medio_antes: null, custo_medio_depois: null, ...extra,
});
const entrada = (id, kg, custo, saldoAntes, extra = {}) =>
  mov({ id, tipo_movimentacao: 'Entrada', tipo_detalhado: 'compra_financeiro', quantidade: kg, valor_unitario: custo, valor_total: (Number(kg) * Number(custo)).toFixed(4),
    local_estoque_destino: A, saldo_antes: saldoAntes, saldo_depois: (Number(saldoAntes) + Number(kg)).toFixed(4), ...extra });
const camada = (id, movimento, kg, custo, disp, status, d) => ({
  id, local_estoque_id: A, data_documento: new Date(`2026-11-${dd(d)}T00:00:00.000Z`), createdAt: dia(d), custo_unitario: custo, quantidade_entrada: kg,
  quantidade_disponivel: disp, status, movimentacao_entrada_id: movimento,
});

/**
 * E1 10 a 2 (L1), E2 10 a 4 (L2); saída FIFO legada de 15 (L1 10 a 2 + L2 5 a 4 = 40, sem reavaliar); estorno dela ANTES do
 * corte (devolve sem reavaliar: L1 10 a 2, L2 10 a 4); estorno da compra E2 (L2 sai pelo custo dela, 4); venda a custo
 * médio de 5 depois do corte: poço = L1 10 a 2 → 5 × 2 = 10; L1 fica 5 a 2.
 */
const historicoLegado = () => {
  n = 0;
  const s = mov({ id: 's-fifo', tipo_movimentacao: 'Saída', tipo_detalhado: 'venda_financeiro', quantidade: '15', modo_saida_fifo: 'FIFO', valor_unitario: '2.6667', valor_total: '40.0000',
    local_estoque_origem: A, saldo_antes: '20', saldo_depois: '5', status: 'Estornada', movimento_filho_id: 'est-s',
    lotes_consumidos: [{ lote_id: 'L1', quantidade: '10.0000', custo_unitario: '2.0000' }, { lote_id: 'L2', quantidade: '5.0000', custo_unitario: '4.0000' }] });
  const movimentos = [
    entrada('e1', '10', '2', '0', { createdAt: dia(1) }),
    entrada('e2', '10', '4', '10', { createdAt: dia(2), status: 'Estornada', movimento_filho_id: 'est-e2' }),
    { ...s, createdAt: dia(3) },
    mov({ id: 'est-s', createdAt: dia(4), tipo_movimentacao: 'Entrada', tipo_detalhado: 'estorno_venda', quantidade: '15', valor_unitario: '2.6667', valor_total: '40.0000',
      local_estoque_destino: A, saldo_antes: '5', saldo_depois: '20', movimento_pai_id: 's-fifo' }),
    mov({ id: 'est-e2', createdAt: dia(5), tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', quantidade: '10', valor_unitario: '4', valor_total: '40.0000',
      local_estoque_origem: A, saldo_antes: '20', saldo_depois: '10', movimento_pai_id: 'e2' }),
    mov({ id: 's-medio', createdAt: dia(20), tipo_movimentacao: 'Saída', tipo_detalhado: 'venda_financeiro', quantidade: '5', modo_saida_fifo: 'CUSTO_MEDIO', valor_unitario: '2.0000', valor_total: '10.0000',
      local_estoque_origem: A, saldo_antes: '10', saldo_depois: '5', lotes_consumidos: [{ lote_id: 'L1', quantidade: '5.0000', custo_unitario: '2.0000' }] }),
  ];
  movimentos.forEach((m, i) => { m.numero_movimentacao = String(i + 1); });
  const camadas = [camada('L1', 'e1', '10', '2.0000', '5.0000', 'Disponivel', 1), camada('L2', 'e2', '10', '4.0000', '0.0000', 'Estornado', 2)];
  return { movimentos, camadas, cutover: dia(15) };
};

describe('D-PROD-273 fatia 3 — replay puro (era legada e corte do custo médio)', () => {
  test('saída FIFO legada e estorno anterior ao corte: o replay aplica as fatias e o valor gravados e não reavalia; reproduz tudo', () => {
    const h = historicoLegado();
    const r = reproduzir(h);
    assert.equal(r.reproduzivel, true, JSON.stringify(r.parada));
    assert.deepEqual(compararComGravado(r, h), []);
    assert.equal(r.resultados.get('s-fifo').regra, 'legado');
    assert.equal(r.resultados.get('est-s').regra, 'legado');
    assert.equal(r.resultados.get('s-medio').regra, 'atual');
  });

  test('o corte importa: com o estorno tratado como posterior ao custo médio (reavalia a 3), a venda daria 15 e o replay acusa a divergência', () => {
    const h = { ...historicoLegado(), cutover: -Infinity };
    const div = compararComGravado(reproduzir(h), h);
    assert.ok(div.some((d) => d.movimento_id === 's-medio' && d.campo === 'valor_total' && d.gravado === '10.0000' && d.calculado === '15.0000'), JSON.stringify(div));
  });

  test('simulação: a saída FIFO legada depois do excluído passa à regra atual (médio do poço) e diz que mudou de regra', () => {
    n = 0;
    const movimentos = [
      entrada('e1', '10', '2', '0', { createdAt: dia(1) }),
      entrada('e2', '10', '4', '10', { createdAt: dia(2) }),
      mov({ id: 's-fifo', createdAt: dia(3), tipo_movimentacao: 'Saída', tipo_detalhado: 'venda_financeiro', quantidade: '5', modo_saida_fifo: 'FIFO', valor_unitario: '2.0000', valor_total: '10.0000',
        local_estoque_origem: A, saldo_antes: '20', saldo_depois: '15', lotes_consumidos: [{ lote_id: 'L1', quantidade: '5.0000', custo_unitario: '2.0000' }] }),
    ];
    const camadas = [camada('L1', 'e1', '10', '2.0000', '5.0000', 'Disponivel', 1), camada('L2', 'e2', '10', '4.0000', '10.0000', 'Disponivel', 2)];
    const h = { movimentos, camadas, cutover: dia(15) };
    const base = reproduzir(h);
    assert.deepEqual(compararComGravado(base, h), []);
    const sim = simularExclusao(h, base, ['e1']);
    assert.equal(sim.permitido, true);
    const s = sim.movimentos.find((m) => m.id === 's-fifo');
    // sem E1, o poço é só L2 10 a 4: a saída de 5 vale 20 pelo médio (e o resto fica a 4)
    assert.deepEqual([s.antes.valor_total, s.depois.valor_total, s.depois.saldo_antes, s.regra], ['10.0000', '20.0000', '10.0000', { antes: 'legado', depois: 'atual' }]);
    assert.deepEqual(sim.depositos, [{ local_estoque_id: A, saldo_antes: '15.0000', saldo_depois: '5.0000', valor_antes: '50.0000', valor_depois: '20.0000', custo_medio_antes: '3.3333', custo_medio_depois: '4.0000' }]);
  });

  test('ordem canônica: número numérico (11 depois de 9); legado não numérico desempata por createdAt e id', () => {
    const a = { id: 'a', numero_movimentacao: '9', createdAt: dia(5) };
    const b = { id: 'b', numero_movimentacao: '11', createdAt: dia(1) };
    const c = { id: 'c', numero_movimentacao: 'LEG-1', createdAt: dia(2) };
    const d = { id: 'd', numero_movimentacao: 'LEG-2', createdAt: dia(2) };
    assert.deepEqual(ordenarCanonico([b, a]).map((m) => m.id), ['a', 'b']);
    assert.ok(compararCanonico(c, d) < 0);
    assert.ok(compararCanonico(d, c) > 0);
  });

  test('fora do protocolo (origem que o motor não grava): não é adivinhado — problema e replay não reproduzível', () => {
    n = 0;
    const h = {
      movimentos: [entrada('e1', '10', '2', '0'), mov({ id: 'x', tipo_movimentacao: 'Saída', tipo_detalhado: 'ajuste', origem_sistema: 'manual', quantidade: '1', local_estoque_origem: A })],
      camadas: [camada('L1', 'e1', '10', '2.0000', '10.0000', 'Disponivel', 1)],
      cutover: null,
    };
    const r = reproduzir(h);
    assert.equal(r.reproduzivel, false);
    assert.deepEqual(r.problemas.map((p) => [p.reason, p.movimento_id]), [['fora_do_protocolo', 'x']]);
  });
});
