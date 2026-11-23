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

  test('simulação: estorno de entrada cuja camada a simulação consumiu → o que falta sai das outras camadas (reatribuído) ou recusa por saldo negativo', () => {
    // E1 10 a 2 (L1), E2 10 a 4 (L2), venda de 5 a médio 3 (15; L1 5 e L2 10 passam a 3), E3 10 a 6 (L3), estorno da compra E2 (L2 intacta, sai a 3)
    const montarH = (comE3) => {
      n = 0;
      const movimentos = [
        entrada('e1', '10', '2', '0', { createdAt: dia(1) }),
        entrada('e2', '10', '4', '10', { createdAt: dia(2), status: 'Estornada', movimento_filho_id: 'est-e2' }),
        mov({ id: 'v', createdAt: dia(3), tipo_movimentacao: 'Saída', tipo_detalhado: 'venda_financeiro', quantidade: '5', modo_saida_fifo: 'CUSTO_MEDIO', valor_unitario: '3.0000', valor_total: '15.0000',
          local_estoque_origem: A, saldo_antes: '20', saldo_depois: '15', lotes_consumidos: [{ lote_id: 'L1', quantidade: '5.0000', custo_unitario: '3.0000' }] }),
        ...(comE3 ? [entrada('e3', '10', '6', '15', { createdAt: dia(4) })] : []),
        mov({ id: 'est-e2', createdAt: dia(5), tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', quantidade: '10', valor_unitario: '4', valor_total: '40.0000',
          local_estoque_origem: A, saldo_antes: comE3 ? '25' : '15', saldo_depois: comE3 ? '15' : '5', movimento_pai_id: 'e2' }),
      ];
      movimentos.forEach((m, i) => { m.numero_movimentacao = String(i + 1); });
      const camadas = [
        camada('L1', 'e1', '10', '3.0000', '5.0000', 'Disponivel', 1), camada('L2', 'e2', '10', '3.0000', '0.0000', 'Estornado', 2),
        ...(comE3 ? [camada('L3', 'e3', '10', '6.0000', '10.0000', 'Disponivel', 4)] : []),
      ];
      return { movimentos, camadas, cutover: null };
    };
    const h = montarH(true);
    const base = reproduzir(h);
    assert.deepEqual(compararComGravado(base, h), []);
    // sem E1: a venda sai de L2 (5 a 4 = 20); o estorno de E2 tira os 5 que restam em L2 e os outros 5 de L3 (FIFO, a 6)
    const sim = simularExclusao(h, base, ['e1']);
    assert.equal(sim.permitido, true, JSON.stringify(sim.recusa));
    const est = sim.movimentos.find((m) => m.id === 'est-e2');
    assert.deepEqual([est.reatribuido, est.depois.saldo_antes, est.depois.saldo_depois], [true, '15.0000', '5.0000']);
    assert.deepEqual(sim.depositos.map((d) => [d.saldo_depois, d.custo_medio_depois]), [['5.0000', '6.0000']]);
    // sem E3 não há de onde tirar: o estorno de E2 deixaria −5 no depósito
    const h2 = montarH(false);
    const base2 = reproduzir(h2);
    assert.deepEqual(compararComGravado(base2, h2), []);
    const sim2 = simularExclusao(h2, base2, ['e1']);
    assert.deepEqual([sim2.permitido, sim2.recusa.reason, sim2.recusa.movimento_id, sim2.recusa.saldo], [false, 'saldo_negativo', 'est-e2', '-5.0000']);
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

/**
 * D-PROD-272 — sobra do ajuste de inventário: E1 10 a 2 (L1), E2 10 a 4 (L2) → 20 kg, R$ 60, médio 3; sobra de 5 ao
 * médio (L3 5 a 3 = 15). A linha do ajuste diz se o custo foi informado. `excluido`: o ajuste foi excluído depois
 * (estorno `estorno_ajuste_sobra`: a camada sai pelo custo dela, 25 → 20 kg).
 */
const historicoSobra = ({ custoSobra = '3.0000', informado = false, comLinha = true, excluido = false } = {}) => {
  n = 0;
  const movimentos = [
    entrada('e1', '10', '2', '0', { createdAt: dia(1) }),
    entrada('e2', '10', '4', '10', { createdAt: dia(2) }),
    entrada('sobra', '5', custoSobra, '20', { createdAt: dia(3), origem_sistema: 'ajuste_estoque', tipo_detalhado: 'ajuste_sobra', lancamento_origem_id: 'ajuste-1',
      ...(excluido ? { status: 'Estornada', movimento_filho_id: 'est-sobra' } : {}) }),
  ];
  if (excluido) {
    movimentos.push(mov({ id: 'est-sobra', createdAt: dia(4), origem_sistema: 'ajuste_estoque', tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_ajuste_sobra', quantidade: '5',
      valor_unitario: custoSobra, valor_total: (5 * Number(custoSobra)).toFixed(4), local_estoque_origem: A, saldo_antes: '25', saldo_depois: '20', movimento_pai_id: 'sobra' }));
  }
  movimentos.forEach((m, i) => { m.numero_movimentacao = String(i + 1); });
  const camadas = [
    camada('L1', 'e1', '10', '2.0000', '10.0000', 'Disponivel', 1), camada('L2', 'e2', '10', '4.0000', '10.0000', 'Disponivel', 2),
    excluido ? camada('L3', 'sobra', '5', custoSobra, '0.0000', 'Estornado', 3) : camada('L3', 'sobra', '5', custoSobra, '5.0000', 'Disponivel', 3),
  ];
  return { movimentos, camadas, cutover: -Infinity, ajustes: comLinha ? [{ movimentacao_estoque_id: 'sobra', custo_informado: informado }] : [] };
};

describe('D-PROD-272 — replay puro da sobra do ajuste (custo = médio do depósito naquele ponto)', () => {
  test('sobra ao médio reproduz; gravada com outro custo (não informado) diverge; com custo informado vale o gravado; ajuste excluído reproduz', () => {
    const h = historicoSobra();
    assert.deepEqual(compararComGravado(reproduzir(h), h), []);
    const errada = historicoSobra({ custoSobra: '9.0000' });
    const div = compararComGravado(reproduzir(errada), errada);
    assert.ok(div.some((d) => d.movimento_id === 'sobra' && d.campo === 'valor_unitario' && d.gravado === '9.0000' && d.calculado === '3.0000'), JSON.stringify(div));
    const informada = historicoSobra({ custoSobra: '9.0000', informado: true });
    assert.deepEqual(compararComGravado(reproduzir(informada), informada), []);
    const excluida = historicoSobra({ excluido: true });
    const r = reproduzir(excluida);
    assert.equal(r.reproduzivel, true, JSON.stringify(r.parada));
    assert.deepEqual(compararComGravado(r, excluida), []);
  });

  test('fail-closed: sobra sem a linha do ajuste para o replay; na simulação, sobra (de ajuste excluído) não informada num poço vazio para (o motor exigiria o custo)', () => {
    const sem = reproduzir(historicoSobra({ comLinha: false }));
    assert.deepEqual([sem.reproduzivel, sem.parada?.reason], [false, 'sobra_de_ajuste_sem_linha']);
    const h = historicoSobra({ excluido: true });
    const sim = simularExclusao(h, reproduzir(h), ['e1', 'e2']);
    assert.deepEqual([sim.permitido, sim.recusa?.reason], [false, 'sobra_de_ajuste_sem_custo_medio']);
  });

  test('escolha do proprietário (2026-11-23): excluída E2, a contagem VIGENTE depois no depósito recusa a simulação (ajuste_de_inventario_posterior)', () => {
    const h = historicoSobra();
    const sim = simularExclusao(h, reproduzir(h), ['e2']);
    assert.deepEqual([sim.permitido, sim.recusa?.reason, sim.recusa?.local_estoque_id, sim.recusa?.movimento_id, sim.recusa?.ajuste_id], [false, 'ajuste_de_inventario_posterior', A, 'sobra', 'ajuste-1']);
  });

  test('ajuste JÁ EXCLUÍDO depois: excluída E2, a simulação passa; a sobra segue o médio de E1 (3 → 2) e o estorno dela também', () => {
    const h = historicoSobra({ excluido: true });
    const sim = simularExclusao(h, reproduzir(h), ['e2']);
    assert.equal(sim.permitido, true, JSON.stringify(sim.recusa));
    const porId = new Map(sim.movimentos.map((m) => [m.id, m]));
    assert.deepEqual([porId.get('sobra')?.antes.valor_unitario, porId.get('sobra')?.depois.valor_unitario, porId.get('sobra')?.depois.valor_total], ['3.0000', '2.0000', '10.0000']);
    assert.deepEqual([porId.get('est-sobra')?.antes.valor_total, porId.get('est-sobra')?.depois.valor_total], ['15.0000', '10.0000']);
    assert.deepEqual(sim.camadas.find((c) => c.lote_id === 'L3')?.depois, { quantidade_disponivel: '0.0000', custo_unitario: '2.0000', status: 'Estornado' });
  });
});
