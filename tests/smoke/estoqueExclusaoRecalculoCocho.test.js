/**
 * D-PROD-273 (fatia 4) — o porte do CUSTO do fechamento do cocho no servidor
 * (`backend/src/modules/suplementacaoEventos/fechamentoCustoCocho.js`) é a mesma conta da tela
 * (`calcularFechamentoConsumo` de `src/domain/suplementacao/fechamentoConsumo.js`): mesmos campos de custo, mesmos
 * arredondamentos, nos três caminhos da sobra herdada (camadas, custo do anterior, aproximado) e no legado sem
 * sobra herdada. E o par excluído COM recálculo some do histórico do depósito sem descontar o saldo.
 */
import { describe, it, expect } from 'vitest';
import { calcularFechamentoConsumo } from '@/domain/suplementacao/fechamentoConsumo';
import { comSaldoSemExcluidos, idsDeParesExcluidos } from '@/lib/estoqueSaldoSemExcluidos';
import { resumoDaPrevia } from '@/lib/estoqueRecalculoExclusao';
import { CAMPOS_CUSTO_FECHAMENTO, custoDoFechamento, recalcularCustosDosCochos } from '../../backend/src/modules/suplementacaoEventos/fechamentoCustoCocho.js';

const evento = { total_cabecas_afetadas: 12, cabecas_nao_consomem: 2, quantidade_total_kg: 37.5, base_consumo: 'PV', consumo_esperado_pv_kg: 8 };
const soCusto = (r) => Object.fromEntries(CAMPOS_CUSTO_FECHAMENTO.map((k) => [k, r[k]]));

describe('D-PROD-273 — porte do custo do fechamento do cocho', () => {
  const casos = [
    { nome: 'camadas herdadas', sobraInicialKg: 7.25, sobraHerdada: { camadas: [{ kg: 3, custo_kg: 4.1 }, { kg: 5, custo_kg: 5.37 }] }, consumoTotalKg: 31.4, custo: 5.8123 },
    { nome: 'custo do anterior', sobraInicialKg: 4, sobraHerdada: { custoAnteriorKg: 3.3333 }, consumoTotalKg: 40, custo: 6.0001 },
    { nome: 'aproximado (sem anterior)', sobraInicialKg: 2.5, sobraHerdada: {}, consumoTotalKg: 12.345, custo: 4.75 },
    { nome: 'sem sobra herdada', sobraInicialKg: 0, sobraHerdada: {}, consumoTotalKg: 30, custo: 2.9 },
    { nome: 'legado (sem camadas)', sobraInicialKg: null, sobraHerdada: null, consumoTotalKg: 18.7, custo: 7.1 },
  ];
  for (const c of casos) {
    it(`mesma conta da tela: ${c.nome}`, () => {
      const tela = calcularFechamentoConsumo({ evento, consumoTotalKg: c.consumoTotalKg, diasPeriodo: 6, custoUnitarioKg: c.custo, sobraInicialKg: c.sobraInicialKg, sobraHerdada: c.sobraHerdada });
      const servidor = custoDoFechamento({ evento, consumoTotalKg: c.consumoTotalKg, diasPeriodo: 6, custoUnitarioKg: c.custo, sobraInicialKg: c.sobraInicialKg, sobraHerdada: c.sobraHerdada });
      expect(servidor).toEqual(soCusto(tela));
    });
  }

  it('a cadeia do cocho: o custo novo da saída refaz o fechamento e o seguinte herda as camadas novas; o que não reproduz recusa', () => {
    const fechamento = (d, custo, sobraHerdada) => ({ ...d, ...custoDoFechamento({ evento: d, consumoTotalKg: d.consumo_diario_grupo_kg * d.dias_periodo, diasPeriodo: d.dias_periodo, custoUnitarioKg: custo, sobraInicialKg: d.sobra_herdada_kg, sobraHerdada }) });
    const a = fechamento({ ponto_suplementacao_id: 'p', data_lancamento: '2027-06-01', movimentacao_estoque_id: 'm1', total_cabecas_afetadas: 10, quantidade_total_kg: 80, sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, sobra_herdada_kg: 0, sobra_final_camadas: [] }, 6, {});
    const b = fechamento({ ponto_suplementacao_id: 'p', data_lancamento: '2027-06-07', movimentacao_estoque_id: 'm2', total_cabecas_afetadas: 10, quantidade_total_kg: 20, sobra_kg: 5, dias_periodo: 5, consumo_diario_grupo_kg: 5, sobra_herdada_kg: 10, sobra_final_camadas: [] }, 6, { camadas: a.sobra_final_camadas });
    expect([a.custo_total_periodo, b.custo_total_periodo]).toEqual([420, 150]);
    const eventos = [{ id: 'b', createdAt: '2027-06-07T10:00:00Z', dados: b }, { id: 'a', createdAt: '2027-06-01T10:00:00Z', dados: a }];
    const r = recalcularCustosDosCochos(eventos, new Map([['m1', { antes: 6, depois: 5.8 }]]));
    expect(r.recusa).toBe(null);
    const porId = Object.fromEntries(r.patches.map((p) => [p.id, p]));
    expect([porId.a.depois.custo_total_periodo, porId.a.depois.sobra_final_camadas]).toEqual([406, [{ kg: 10, custo_kg: 5.8 }]]);
    // b não mudou de custo próprio, mas herdou 10 kg a 5,8: 10 × 5,8 + 15 × 6 = 148
    expect([porId.b.depois.custo_total_periodo, porId.b.depois.custo_sobra_herdada_kg]).toEqual([148, 5.8]);
    const adulterado = [{ id: 'a', createdAt: '2027-06-01T10:00:00Z', dados: { ...a, custo_total_periodo: 999 } }];
    expect(recalcularCustosDosCochos(adulterado, new Map([['m1', { antes: 6, depois: 5.8 }]])).recusa).toEqual({ reason: 'cocho_fechamento_nao_reproduzivel', evento_id: 'a' });
  });
});

describe('D-PROD-273 — revisão: o custo herdado do anterior sem custo/kg gravado', () => {
  it('o anterior fechado não gravou custo_unitario_kg (a tela usou o valor do movimento dele): mudando esse valor, o seguinte é refeito', () => {
    const p = { ponto_suplementacao_id: 'p', data_lancamento: '2027-06-01', movimentacao_estoque_id: 'm1', total_cabecas_afetadas: 10, quantidade_total_kg: 80, sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14 };
    const base = { ponto_suplementacao_id: 'p', data_lancamento: '2027-06-07', movimentacao_estoque_id: 'm2', total_cabecas_afetadas: 10, quantidade_total_kg: 20, sobra_kg: 5, dias_periodo: 5, consumo_diario_grupo_kg: 5, sobra_herdada_kg: 10, sobra_final_camadas: [] };
    const q = { ...base, ...custoDoFechamento({ evento: base, consumoTotalKg: 25, diasPeriodo: 5, custoUnitarioKg: 6, sobraInicialKg: 10, sobraHerdada: { custoAnteriorKg: 6 } }) };
    expect(q.custo_total_periodo).toBe(150);
    const r = recalcularCustosDosCochos([{ id: 'p', createdAt: '2027-06-01T10:00:00Z', dados: p }, { id: 'q', createdAt: '2027-06-07T10:00:00Z', dados: q }], new Map([['m1', { antes: 6, depois: 5.8 }]]));
    expect(r.recusa).toBe(null);
    // 10 kg herdados a 5,8 + 15 kg a 6 = 148
    expect(r.patches.map((x) => [x.id, x.depois.custo_total_periodo, x.depois.custo_sobra_herdada_kg])).toEqual([['q', 148, 5.8]]);
  });
});

describe('D-PROD-273 — par excluído com recálculo no histórico do depósito', () => {
  const base = { empresa_id: 'e', produto_id: 'p', status: 'Ativa', unidade_medida: 'KG' };
  const S1 = { ...base, id: 's1', numero_movimentacao: '1', tipo_movimentacao: 'Saída', quantidade: '50', local_estoque_origem: 'A', saldo_antes: '200', saldo_depois: '150', status: 'Estornada', movimento_filho_id: 'e1', movimentacao_grupo_id: 'exclusao_recalculo:s1' };
  const S2 = { ...base, id: 's2', numero_movimentacao: '2', tipo_movimentacao: 'Saída', quantidade: '80', local_estoque_origem: 'A', saldo_antes: '250', saldo_depois: '170' };
  const E1 = { ...base, id: 'e1', numero_movimentacao: '3', tipo_movimentacao: 'Entrada', tipo_detalhado: 'estorno_saida_manual', quantidade: '50', local_estoque_destino: 'A', movimento_pai_id: 's1', saldo_antes: '120', saldo_depois: '170', movimentacao_grupo_id: 'exclusao_recalculo:s1' };
  it('some da lista (é par) mas não desconta: o saldo da S2 já foi regravado sem a S1', () => {
    expect([...idsDeParesExcluidos([S1, S2, E1])].sort()).toEqual(['e1', 's1']);
    const [s2] = comSaldoSemExcluidos([S2], [S1, S2, E1]);
    expect(s2).toBe(S2);
    // o mesmo par sem a marca (regra antiga) desconta a S1
    const semMarca = comSaldoSemExcluidos([S2], [{ ...S1, movimentacao_grupo_id: null }, S2, { ...E1, movimentacao_grupo_id: null }]);
    expect([semMarca[0].saldo_antes, semMarca[0].saldo_depois]).toEqual(['300.0000', '220.0000']);
  });
});

describe('D-PROD-273 — resumo da prévia na janela de exclusão', () => {
  it('estorno exato, recálculo (dois itens do mesmo documento contados uma vez), sem recálculo (não é recusa) e recusa', () => {
    expect(resumoDaPrevia([{ permitido: true, modo: 'estorno_exato', excluidos: ['m1'], movimentos: [], movimentos_posteriores: 0 }]).estado).toBe('exato');
    const mov = { id: 's2', numero: '7', tipo_detalhado: 'saida_manual', antes: { valor_total: '480.0000' }, depois: { valor_total: '464.0000' } };
    const dois = [{ permitido: true, modo: 'recalculo', excluidos: ['v1', 'v2'], movimentos: [mov], movimentos_posteriores: 2 }, { permitido: true, modo: 'recalculo', excluidos: ['v1', 'v2'], movimentos: [mov], movimentos_posteriores: 2 }];
    const r = resumoDaPrevia(dois);
    expect([r.estado, r.mensagem, r.linhas.length, r.linhas[0].tipo]).toEqual(['recalcula', '1 movimento posterior terá o custo recalculado.', 1, 'Saída manual']);
    const sem = resumoDaPrevia([{ permitido: true, modo: 'estorno_exato_sem_recalculo', aviso: { code: 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', reason: 'replay_diverge_do_gravado' } }]);
    expect(sem.estado).toBe('sem_recalculo');
    expect(sem.mensagem).toMatch(/sem recalcular/);
    expect(resumoDaPrevia([{ permitido: false, recusa: { code: 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', movimento_numero: '9' } }]).estado).toBe('recusa');
  });
});
