import { describe, expect, it } from 'vitest';
import { calcularNivelCocho } from '@/domain/suplementacao/nivelSuplementacao';
const ponto = { id: 'cocho', empresa_id: 'fazenda', categoria_ponto: 'COCHO', capacidade_cocho_kg: 400, dias_alerta_reposicao: 1 };
const evento = { id: 'sal', empresa_id: 'fazenda', ponto_suplementacao_id: 'cocho', data_lancamento: '2026-11-14', quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: 50, produto_id: 'sal' };
const calcular = (hoje, ajustes = {}, p = ponto) => calcularNivelCocho({ ponto: p, eventos: [{ ...evento, ...ajustes }], hoje });

describe('Saldo do cocho por dia do abastecimento, sem horários', () => {
  it('100 kg e consumo de 50 kg/dia: 100%, 50% e 0%, sem usar a capacidade', () => {
    for (const [hoje, saldo, fracao, dias] of [['2026-11-14', 100, 1, 0], ['2026-11-15', 50, .5, 1], ['2026-11-16', 0, 0, 2]]) {
      const n = calcular(hoje);
      expect(n.saldoKg).toBe(saldo);
      expect(n.fracaoParaSvg).toBe(fracao);
      expect(n.diasDecorridos).toBe(dias);
    }
  });
  it('50 kg com consumo de 50 kg/dia permanece cheio no próprio dia e zera no seguinte', () => {
    expect(calcular('2026-11-14', { quantidade_total_kg: 50 }).fracaoParaSvg).toBe(1);
    expect(calcular('2026-11-15', { quantidade_total_kg: 50 }).saldoKg).toBe(0);
  });
  it('digitar de manhã, à tarde ou no dia seguinte não muda o saldo da mesma data de abastecimento', () => {
    for (const created_date of ['2026-11-14T06:00:00-04:00', '2026-11-14T18:00:00-04:00', '2026-11-15T18:00:00-04:00']) {
      const n = calcular('2026-11-15', { created_date });
      expect(n.saldoKg).toBe(50);
      expect(n.fracaoParaSvg).toBe(.5);
      expect(n.dataLancamento).toBe('2026-11-14');
    }
  });
  it('sobra anterior faz parte do saldo inicial, sem consumir nada na data informada', () => {
    const n = calcular('2026-11-14', { sobra_kg: 25 });
    expect(n.baseCicloKg).toBe(125);
    expect(n.saldoKg).toBe(125);
    expect(n.fracaoParaSvg).toBe(1);
  });
  it('o prazo de alerta cadastrado muda o aviso, não o saldo nem o percentual', () => {
    const ajustes = { quantidade_total_kg: 150 };
    const um = calcular('2026-11-14', ajustes, { ...ponto, dias_alerta_reposicao: 1 });
    const tres = calcular('2026-11-14', ajustes, { ...ponto, dias_alerta_reposicao: 3 });
    expect(um.alertas.some(a => a.tipo === 'cocho_baixo')).toBe(false);
    expect(tres.alertas.some(a => a.tipo === 'cocho_baixo')).toBe(true);
    expect(um.fracaoParaSvg).toBe(tres.fracaoParaSvg);
    expect(um.saldoKg).toBe(tres.saldoKg);
    const zerado = calcular('2026-11-17', ajustes, { ...ponto, dias_alerta_reposicao: 0 });
    expect(zerado.alertas.some(a => a.tipo === 'cocho_sem_produto')).toBe(true);
    expect(calcular('2026-11-14', ajustes, { ...ponto, dias_alerta_reposicao: 0 }).alertas.some(a => a.tipo === 'cocho_baixo')).toBe(false);
  });
});
