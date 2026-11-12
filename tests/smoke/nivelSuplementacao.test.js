/**
 * D-PROD-178 (MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01) — SSOT PURO do nível de
 * cocho e depósito (`src/domain/suplementacao/nivelSuplementacao.js`).
 *
 * Matriz da seção 7 ("Puros") do contrato:
 *  - último evento do ponto: maior data válida, outra fazenda ignorada, empate
 *    por `created_date`/`createdAt` (senão o primeiro do array), datas
 *    inválidas só sem nenhuma válida;
 *  - cocho: 0 → 1 → 2 → 4 dias (base 200, taxa 50), limite 120 (166,67% no
 *    lançamento, 125% no dia 1), fornecido 90 × limite 120, taxa 30 no dia 1,
 *    período fechado (sobra informada), sem taxa (%PV), lançamento futuro,
 *    data inválida, base 0, compartilhamento (mesmo produto ⇒ não confiável;
 *    produtos diferentes ⇒ estimativa), limite 0/null, quantização;
 *  - depósito: limite × saldo (200%, 50%, 30%), mínimo independente do
 *    percentual, lote em L fora do saldo, unidade não confirmada, sem limite,
 *    quantização, nunca truncar.
 */
import { describe, it, expect } from 'vitest';
import {
  calcularNivelCocho,
  calcularNivelDeposito,
  formatarKgNivel,
  formatarPercentualNivel,
  selecionarUltimoEventoDoPonto,
} from '@/domain/suplementacao/nivelSuplementacao';

const COCHO = {
  id: 'c1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', status: 'Ativo',
  area_vinculada_ids: ['a1'], capacidade_cocho_kg: null,
};
const evento = (extra = {}) => ({
  id: 'e1', empresa_id: 'emp-1', ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-01',
  produto: 'SAL MINERAL', produto_id: 'p-sal', quantidade_total_kg: 200, sobra_kg: 0,
  dias_periodo: null, consumo_esperado_pv_kg: 50, ...extra,
});
const nivel = ({ ponto = COCHO, eventos = [evento()], hoje = '2026-11-01', pontos = [] } = {}) =>
  calcularNivelCocho({ ponto, eventos, hoje, pontos });

describe('selecionarUltimoEventoDoPonto', () => {
  it('pega a maior data válida do ponto e ignora outro ponto e outra fazenda', () => {
    const eventos = [
      evento({ id: 'velho', data_lancamento: '2026-10-01' }),
      evento({ id: 'outro-ponto', ponto_suplementacao_id: 'c2', data_lancamento: '2026-12-01' }),
      evento({ id: 'outra-fazenda', empresa_id: 'emp-2', data_lancamento: '2026-12-02' }),
      evento({ id: 'novo', data_lancamento: '2026-11-03' }),
    ];
    expect(selecionarUltimoEventoDoPonto(COCHO, eventos)?.id).toBe('novo');
    expect(selecionarUltimoEventoDoPonto(COCHO, [])).toBeNull();
    expect(selecionarUltimoEventoDoPonto(COCHO, undefined)).toBeNull();
    // Evento sem empresa (legado) continua do ponto; ponto sem empresa aceita qualquer.
    expect(selecionarUltimoEventoDoPonto(COCHO, [evento({ id: 'sem-emp', empresa_id: undefined })])?.id).toBe('sem-emp');
    expect(selecionarUltimoEventoDoPonto({ ...COCHO, empresa_id: undefined }, [evento({ id: 'x', empresa_id: 'emp-9' })])?.id).toBe('x');
  });

  it('empate de data: maior created_date/createdAt; sem marca de criação, o primeiro do array', () => {
    const a = evento({ id: 'a', created_date: '2026-11-01T10:00:00.000Z' });
    const b = evento({ id: 'b', created_date: '2026-11-01T12:00:00.000Z' });
    expect(selecionarUltimoEventoDoPonto(COCHO, [a, b])?.id).toBe('b');
    expect(selecionarUltimoEventoDoPonto(COCHO, [b, a])?.id).toBe('b');
    const c = evento({ id: 'c', createdAt: '2026-11-01T13:00:00.000Z' });
    expect(selecionarUltimoEventoDoPonto(COCHO, [a, c, b])?.id).toBe('c');
    const s1 = evento({ id: 's1' });
    const s2 = evento({ id: 's2' });
    expect(selecionarUltimoEventoDoPonto(COCHO, [s1, s2])?.id).toBe('s1');
    expect(selecionarUltimoEventoDoPonto(COCHO, [s2, s1])?.id).toBe('s2');
  });

  it('data inválida só entra quando não há nenhuma válida', () => {
    const invalido = evento({ id: 'inv', data_lancamento: '2026-02-30' });
    const valido = evento({ id: 'ok', data_lancamento: '2020-01-01' });
    expect(selecionarUltimoEventoDoPonto(COCHO, [invalido, valido])?.id).toBe('ok');
    expect(selecionarUltimoEventoDoPonto(COCHO, [invalido])?.id).toBe('inv');
    expect(selecionarUltimoEventoDoPonto(COCHO, [evento({ id: 'vazio', data_lancamento: '' }), invalido])?.id).toBe('vazio');
  });

  it('data com hora (legado) vale pelo dia antes do "T"', () => {
    const comHora = evento({ id: 'h', data_lancamento: '2026-11-05T00:00:00.000Z' });
    expect(selecionarUltimoEventoDoPonto(COCHO, [evento({ id: 'd' }), comHora])?.id).toBe('h');
  });
});

describe('calcularNivelCocho — ciclo aberto estimado', () => {
  it('base 200 (sobra 0), taxa 50: d0 200/100%, d1 150/75%, d2 100/50%, d4 0/0%', () => {
    const casos = [
      ['2026-11-01', 0, 200, 1, 0, 4],
      ['2026-11-02', 1, 150, 0.75, 50, 3],
      ['2026-11-03', 2, 100, 0.5, 100, 2],
      ['2026-11-05', 4, 0, 0, 200, 0],
    ];
    for (const [hoje, dias, saldo, fracao, consumido, restantes] of casos) {
      const n = nivel({ hoje });
      expect(n.estado).toBe('ciclo_aberto');
      expect(n.confiabilidade).toBe('estimada');
      expect(n.fonteConsumo).toBe('pv_no_lancamento');
      expect(n.taxaConsumoKgDia).toBe(50);
      expect(n.baseCicloKg).toBe(200);
      expect(n.diasDecorridos).toBe(dias);
      expect(n.saldoKg).toBe(saldo);
      expect(n.saldoTipo).toBe('estimado');
      expect(n.fracaoCiclo).toBe(fracao);
      expect(n.consumoEstimadoKg).toBe(consumido);
      expect(n.diasRestantesEstimados).toBe(restantes);
      expect(n.dataEsgotamentoEstimada).toBe('2026-11-05');
      expect(n.neutro).toBe(false);
      expect(n.fracaoParaSvg).toBe(fracao);
      expect(n.rotuloCurto).toBe(`${Math.round(fracao * 100)}%`);
    }
    expect(nivel({ hoje: '2026-11-02' }).descricao).toContain('150 kg de 200 kg (75%)');
  });

  it('depois de esgotar o saldo fica em 0 e o consumo estimado não passa da base', () => {
    const n = nivel({ hoje: '2026-11-20' });
    expect(n.saldoKg).toBe(0);
    expect(n.consumoEstimadoKg).toBe(200);
    expect(n.diasRestantesEstimados).toBe(0);
    expect(n.alertas.map((a) => a.tipo)).toEqual(['cocho_sem_produto']);
  });

  it('a sobra anterior entra na base do ciclo', () => {
    const n = nivel({ eventos: [evento({ quantidade_total_kg: 150, sobra_kg: 50 })], hoje: '2026-11-02' });
    expect(n.fornecidoKg).toBe(150);
    expect(n.sobraAnteriorKg).toBe(50);
    expect(n.baseCicloKg).toBe(200);
    expect(n.saldoKg).toBe(150);
  });

  it('alertas do ciclo: reposição próxima com até 1 dia, sem produto ao esgotar', () => {
    expect(nivel({ hoje: '2026-11-03' }).alertas).toEqual([]);
    const d3 = nivel({ hoje: '2026-11-04' });
    expect(d3.alertas).toEqual([
      { tipo: 'cocho_baixo', severidade: 'alerta', titulo: 'Reposição próxima', descricao: 'Cobertura estimada restante: 1 dia(s).' },
    ]);
    expect(nivel({ hoje: '2026-11-05' }).alertas).toEqual([
      { tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: 'A cobertura estimada do cocho foi esgotada.' },
    ]);
  });

  it('taxa 30, fornecido 90, limite 120, dia 1: saldo 60, ciclo 66,67%, limite 50%', () => {
    const ponto = { ...COCHO, capacidade_cocho_kg: 120 };
    const n = nivel({ ponto, eventos: [evento({ quantidade_total_kg: 90, consumo_esperado_pv_kg: 30 })], hoje: '2026-11-02' });
    expect(n.saldoKg).toBe(60);
    expect(n.fracaoCiclo).toBeCloseTo(2 / 3, 10);
    expect(n.ocupacaoAtualPercentual).toBe(50);
    expect(n.fracaoLimiteSvg).toBe(0.5);
    expect(n.fracaoParaSvg).toBe(0.67);
    expect(n.rotuloCurto).toBe('67%');
    expect(n.descricao).toContain('60 kg de 90 kg (67%)');
    expect(n.ocupacaoNoLancamentoPercentual).toBe(75);
    expect(n.excessoNoLancamentoKg).toBe(0);
    expect(n.alertas).toEqual([]);
  });
});

describe('calcularNivelCocho — limite operacional', () => {
  const ponto = { ...COCHO, capacidade_cocho_kg: 120 };

  it('base 200 com limite 120: 166,67% e excesso 80 no lançamento; 125% e excesso 30 no dia 1', () => {
    const d0 = nivel({ ponto });
    expect(d0.limiteOperacionalKg).toBe(120);
    expect(d0.ocupacaoNoLancamentoPercentual).toBeCloseTo(166.6666666, 5);
    expect(d0.excessoNoLancamentoKg).toBe(80);
    expect(d0.ocupacaoAtualPercentual).toBeCloseTo(166.6666666, 5);
    expect(d0.excessoAtualKg).toBe(80);
    expect(d0.fracaoLimiteSvg).toBe(1);
    expect(d0.mensagemLimite).toBeNull();

    const d1 = nivel({ ponto, hoje: '2026-11-02' });
    expect(d1.ocupacaoNoLancamentoPercentual).toBeCloseTo(166.6666666, 5);
    expect(d1.excessoNoLancamentoKg).toBe(80);
    expect(d1.ocupacaoAtualPercentual).toBe(125);
    expect(d1.excessoAtualKg).toBe(30);
    expect(d1.fracaoLimiteSvg).toBe(1);
    // A fração do ciclo é independente do limite.
    expect(d1.fracaoCiclo).toBe(0.75);
    expect(d1.fracaoParaSvg).toBe(0.75);
    expect(d1.alertas).toEqual([
      {
        tipo: 'cocho_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional',
        descricao: 'Fornecimento acima do limite operacional: 80 kg (166,67%) no lançamento; agora 30 kg acima.',
      },
    ]);
    expect(d1.descricao).toContain('125% de 120 kg (30 kg acima)');
  });

  it('o excesso do lançamento continua visível depois que o saldo volta para dentro do limite', () => {
    const d2 = nivel({ ponto, hoje: '2026-11-03' });
    expect(d2.ocupacaoAtualPercentual).toBeCloseTo(83.333333, 5);
    expect(d2.excessoAtualKg).toBe(0);
    expect(d2.excessoNoLancamentoKg).toBe(80);
    expect(d2.alertas.find((a) => a.tipo === 'cocho_acima_limite')?.descricao)
      .toBe('Fornecimento acima do limite operacional: 80 kg (166,67%) no lançamento; agora dentro do limite.');
  });

  it('fornecido 90 com limite 120: d0 ciclo 100% e limite 75%', () => {
    const n = nivel({ ponto, eventos: [evento({ quantidade_total_kg: 90 })] });
    expect(n.fracaoCiclo).toBe(1);
    expect(n.ocupacaoAtualPercentual).toBe(75);
    expect(n.ocupacaoNoLancamentoPercentual).toBe(75);
    expect(n.excessoAtualKg).toBe(0);
    expect(n.fracaoLimiteSvg).toBe(0.75);
    expect(n.alertas).toEqual([]);
  });

  it('limite 0, null ou inválido: sem ocupação e com a mensagem de limite não configurado', () => {
    for (const capacidade of [0, null, undefined, -10, 'abc', Number.NaN]) {
      const n = nivel({ ponto: { ...COCHO, capacidade_cocho_kg: capacidade }, hoje: '2026-11-02' });
      expect(n.limiteOperacionalKg).toBeNull();
      expect(n.ocupacaoNoLancamentoPercentual).toBeNull();
      expect(n.excessoNoLancamentoKg).toBeNull();
      expect(n.ocupacaoAtualPercentual).toBeNull();
      expect(n.excessoAtualKg).toBeNull();
      expect(n.fracaoLimiteSvg).toBeNull();
      expect(n.mensagemLimite).toBe('Limite operacional não configurado.');
      // O ciclo continua estimado.
      expect(n.fracaoCiclo).toBe(0.75);
    }
  });
});

describe('calcularNivelCocho — estados neutros', () => {
  it('sem lançamento: neutro, alerta crítico de cocho sem lançamento', () => {
    const n = nivel({ eventos: [] });
    expect(n.estado).toBe('sem_lancamento');
    expect(n.neutro).toBe(true);
    expect(n.fracaoParaSvg).toBe(0);
    expect(n.evento).toBeNull();
    expect(n.saldoKg).toBeNull();
    expect(n.mensagem).toBe('Nenhum lançamento registrado neste cocho.');
    expect(n.descricao).toBe('Nenhum lançamento registrado neste cocho.');
    expect(n.rotuloCurto).toBe('Sem lançamento');
    expect(n.alertas).toEqual([
      { tipo: 'cocho_sem_lancamento', severidade: 'critico', titulo: 'Cocho sem lançamento', descricao: 'Não há lançamento de suplementação para este cocho.' },
    ]);
  });

  it('evento de outra fazenda é ignorado (cocho fica sem lançamento)', () => {
    expect(nivel({ eventos: [evento({ empresa_id: 'emp-2' })] }).estado).toBe('sem_lancamento');
  });

  it('período fechado: saldo é a sobra informada, sem base nem fração, ícone neutro', () => {
    const fechado = evento({ dias_periodo: 5, sobra_kg: 30, consumo_diario_grupo_kg: 34 });
    const n = nivel({ ponto: { ...COCHO, capacidade_cocho_kg: 120 }, eventos: [fechado], hoje: '2026-11-20' });
    expect(n.estado).toBe('ciclo_fechado');
    expect(n.saldoKg).toBe(30);
    expect(n.saldoTipo).toBe('informado');
    expect(n.baseCicloKg).toBeNull();
    expect(n.fracaoCiclo).toBeNull();
    expect(n.taxaConsumoKgDia).toBeNull();
    expect(n.neutro).toBe(true);
    expect(n.fracaoParaSvg).toBe(0);
    expect(n.mensagem).toBe('Período fechado; sobra informada de 30 kg. Não há ciclo aberto.');
    expect(n.rotuloCurto).toBe('Período fechado');
    expect(n.ocupacaoNoLancamentoPercentual).toBeNull();
    expect(n.ocupacaoAtualPercentual).toBe(25);
    expect(n.alertas).toEqual([]);
    // Sobra informada acima do limite: o alerta diz a sobra e o excesso (sem ambiguidade).
    const acima = nivel({ ponto: { ...COCHO, capacidade_cocho_kg: 20 }, eventos: [fechado], hoje: '2026-11-20' });
    expect(acima.alertas).toEqual([
      { tipo: 'cocho_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional', descricao: 'Sobra informada de 30 kg, 10 kg acima do limite operacional (150%).' },
    ]);
    // dias_periodo 0 também é fechado (o critério é `!= null`).
    expect(nivel({ eventos: [evento({ dias_periodo: 0, sobra_kg: 10 })] }).estado).toBe('ciclo_fechado');
  });

  it('sem taxa válida (%PV ausente no lançamento): estimativa indisponível, sem saldo e sem "sem produto"', () => {
    for (const taxa of [null, undefined, 0, -5, 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
      const n = nivel({ eventos: [evento({ consumo_esperado_pv_kg: taxa })], hoje: '2026-11-30' });
      expect(n.estado).toBe('ciclo_aberto');
      expect(n.confiabilidade).toBe('indisponivel');
      expect(n.taxaConsumoKgDia).toBeNull();
      expect(n.fonteConsumo).toBeNull();
      expect(n.saldoKg).toBeNull();
      expect(n.saldoTipo).toBeNull();
      expect(n.fracaoCiclo).toBeNull();
      expect(n.diasRestantesEstimados).toBeNull();
      expect(n.dataEsgotamentoEstimada).toBeNull();
      expect(n.neutro).toBe(true);
      expect(n.fracaoParaSvg).toBe(0);
      expect(n.baseCicloKg).toBe(200);
      expect(n.mensagem).toBe('Estimativa de consumo indisponível');
      expect(n.motivo).toBe('o produto não tinha %PV no lançamento');
      expect(n.descricao).toContain('Estimativa de consumo indisponível: o produto não tinha %PV no lançamento.');
      expect(n.rotuloCurto).toBe('Sem estimativa');
      expect(n.alertas).toEqual([]);
    }
  });

  it('sem taxa e com limite: o excesso no lançamento continua conhecido (a base é conhecida)', () => {
    const n = nivel({ ponto: { ...COCHO, capacidade_cocho_kg: 120 }, eventos: [evento({ consumo_esperado_pv_kg: null })] });
    expect(n.ocupacaoNoLancamentoPercentual).toBeCloseTo(166.6666666, 5);
    expect(n.excessoNoLancamentoKg).toBe(80);
    expect(n.ocupacaoAtualPercentual).toBeNull();
    expect(n.alertas.map((a) => [a.tipo, a.descricao])).toEqual([
      ['cocho_acima_limite', 'Fornecimento acima do limite operacional: 80 kg (166,67%) no lançamento.'],
    ]);
  });

  it('lançamento futuro: neutro, com a data formatada', () => {
    const n = nivel({ eventos: [evento({ data_lancamento: '2026-11-10' })], hoje: '2026-11-05' });
    expect(n.estado).toBe('lancamento_futuro');
    expect(n.neutro).toBe(true);
    expect(n.fracaoParaSvg).toBe(0);
    expect(n.saldoKg).toBeNull();
    expect(n.mensagem).toBe('Lançamento com data futura (10/11/2026); a estimativa começa nessa data.');
    expect(n.alertas).toEqual([]);
  });

  it('data inválida: neutro, sem estimativa', () => {
    for (const data of ['2026-02-30', 'abc', '', null]) {
      const n = nivel({ eventos: [evento({ data_lancamento: data })] });
      expect(n.estado).toBe('data_invalida');
      expect(n.neutro).toBe(true);
      expect(n.saldoKg).toBeNull();
      expect(n.mensagem).toBe('Data do último lançamento inválida; não é possível estimar.');
      expect(n.alertas).toEqual([]);
    }
  });

  it('base 0: fração nula, neutro, "Ciclo sem quantidade fornecida."', () => {
    const n = nivel({ eventos: [evento({ quantidade_total_kg: 0, sobra_kg: 0 })], hoje: '2026-11-02' });
    expect(n.confiabilidade).toBe('estimada');
    expect(n.baseCicloKg).toBe(0);
    expect(n.saldoKg).toBe(0);
    expect(n.fracaoCiclo).toBeNull();
    expect(n.neutro).toBe(true);
    expect(n.fracaoParaSvg).toBe(0);
    expect(n.mensagem).toBe('Ciclo sem quantidade fornecida.');
  });

  it('dia de referência inválido: não estima (nunca usa o relógio por conta própria)', () => {
    const n = calcularNivelCocho({ ponto: COCHO, eventos: [evento()], hoje: 'ontem' });
    expect(n.confiabilidade).toBe('indisponivel');
    expect(n.saldoKg).toBeNull();
    expect(n.neutro).toBe(true);
  });
});

describe('calcularNivelCocho — cochos compartilhando os mesmos animais', () => {
  const OUTRO = { ...COCHO, id: 'c2', nome_ponto: 'COCHO 2', area_vinculada_ids: undefined, area_vinculada_id: 'a1' };
  const eventoOutro = (extra = {}) => evento({ id: 'e2', ponto_suplementacao_id: 'c2', ...extra });

  it('mesmo produto e ciclo aberto nas mesmas áreas ⇒ não confiável (saldo nulo, neutro, sem rateio inventado)', () => {
    const n = nivel({ eventos: [evento(), eventoOutro()], pontos: [COCHO, OUTRO], hoje: '2026-11-02' });
    expect(n.confiabilidade).toBe('compartilhada');
    expect(n.saldoKg).toBeNull();
    expect(n.fracaoCiclo).toBeNull();
    expect(n.neutro).toBe(true);
    expect(n.fracaoParaSvg).toBe(0);
    expect(n.compartilhadoCom).toEqual(['c2']);
    expect(n.mensagem).toBe('Estimativa não confiável: 2 cochos com o mesmo produto atendem os mesmos animais e o consumo não é rateado entre eles.');
    expect(n.rotuloCurto).toBe('Sem estimativa');
    expect(n.alertas).toEqual([]);
  });

  it('sem produto_id nos dois, compara o nome normalizado', () => {
    const n = nivel({
      eventos: [evento({ produto_id: null, produto: 'Sal Mineral' }), eventoOutro({ produto_id: null, produto: ' SAL MINERAL ' })],
      pontos: [COCHO, OUTRO],
    });
    expect(n.confiabilidade).toBe('compartilhada');
  });

  it('produtos diferentes, outro cocho fechado ANTES deste lançamento, outra área, depósito, inativo ou outra fazenda ⇒ estimativa normal', () => {
    const casos = [
      { eventos: [evento(), eventoOutro({ produto_id: 'p-prot', produto: 'PROTEINADO' })], pontos: [COCHO, OUTRO] },
      { eventos: [evento(), eventoOutro({ data_lancamento: '2026-10-25', dias_periodo: 3, sobra_kg: 10 })], pontos: [COCHO, OUTRO] },
      { eventos: [evento(), eventoOutro()], pontos: [COCHO, { ...OUTRO, area_vinculada_id: 'a9' }] },
      { eventos: [evento(), eventoOutro()], pontos: [COCHO, { ...OUTRO, categoria_ponto: 'DEPOSITO' }] },
      { eventos: [evento(), eventoOutro()], pontos: [COCHO, { ...OUTRO, status: 'Inativo' }] },
      { eventos: [evento(), eventoOutro({ empresa_id: 'emp-2' })], pontos: [COCHO, { ...OUTRO, empresa_id: 'emp-2' }] },
      { eventos: [evento()], pontos: [COCHO, OUTRO] },
    ];
    for (const caso of casos) {
      const n = nivel({ ...caso, hoje: '2026-11-02' });
      expect(n.confiabilidade).toBe('estimada');
      expect(n.saldoKg).toBe(150);
      expect(n.compartilhadoCom).toEqual([]);
    }
  });

  it('produto_id igual vence nome diferente; produto_id diferente vence nome igual', () => {
    expect(nivel({ eventos: [evento(), eventoOutro({ produto: 'OUTRO NOME' })], pontos: [COCHO, OUTRO] }).confiabilidade).toBe('compartilhada');
    expect(nivel({ eventos: [evento(), eventoOutro({ produto_id: 'p-x' })], pontos: [COCHO, OUTRO] }).confiabilidade).toBe('estimada');
  });

  it('três cochos: a mensagem conta todos', () => {
    const TERCEIRO = { ...COCHO, id: 'c3', area_vinculada_ids: ['a7', 'a1'] };
    const n = nivel({
      eventos: [evento(), eventoOutro(), evento({ id: 'e3', ponto_suplementacao_id: 'c3' })],
      pontos: [COCHO, OUTRO, TERCEIRO],
    });
    expect(n.compartilhadoCom).toEqual(['c2', 'c3']);
    expect(n.mensagem).toContain('3 cochos com o mesmo produto');
  });

  // Critério de tempo: um ciclo aberto que nunca recebeu outro lançamento não
  // fecha sozinho. A janela de um ciclo (lançamento → esgotamento pela taxa
  // gravada) só vale se o cocho esteve SOZINHO com o rebanho nesse intervalo;
  // se outro cocho teve ciclo do mesmo produto ali, o fim é desconhecido.
  it('cocho abandonado ao lado de um ativo: cada um tem a própria estimativa (o vazio mantém "sem produto")', () => {
    const abandonado = eventoOutro({ data_lancamento: '2026-08-01', quantidade_total_kg: 100 }); // esgota em 03/08
    const ativo = evento({ data_lancamento: '2026-11-10' });
    const eventos = [ativo, abandonado];

    const a = nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-12' });
    expect(a.confiabilidade).toBe('estimada');
    expect(a.compartilhadoCom).toEqual([]);
    expect(a.saldoKg).toBe(100);
    expect(a.rotuloCurto).toBe('50%');

    const b = nivel({ ponto: OUTRO, eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-12' });
    expect(b.confiabilidade).toBe('estimada');
    expect(b.compartilhadoCom).toEqual([]);
    expect(b.saldoKg).toBe(0);
    expect(b.alertas.map((alerta) => alerta.tipo)).toEqual(['cocho_sem_produto']);
  });

  it('reabastecimento em dias diferentes: o ciclo fechado que dividiu o rebanho mantém os dois sem estimativa (nada de 0% falso nem dupla contagem)', () => {
    // c1 e c2 em 01/11, 200 kg cada, 50 kg/dia o rebanho. Em 06/11 só c1 é
    // reabastecido: o ciclo de 01/11 fecha com 5 dias e sobra 100 (o rebanho
    // comeu só 20 kg/dia de c1 — o resto saiu de c2).
    const c1Fechado = evento({ id: 'e1a', data_lancamento: '2026-11-01', dias_periodo: 5, sobra_kg: 100, consumo_diario_grupo_kg: 20 });
    const c1Novo = evento({ id: 'e1b', data_lancamento: '2026-11-06', quantidade_total_kg: 200, sobra_kg: 100 });
    const c2 = eventoOutro({ data_lancamento: '2026-11-01' });
    const eventos = [c1Fechado, c1Novo, c2];
    for (const hoje of ['2026-11-06', '2026-11-08']) {
      const a = nivel({ eventos, pontos: [COCHO, OUTRO], hoje });
      const b = nivel({ ponto: OUTRO, eventos, pontos: [COCHO, OUTRO], hoje });
      expect(a.confiabilidade).toBe('compartilhada');
      expect(b.confiabilidade).toBe('compartilhada');
      expect(a.saldoKg).toBeNull();
      expect(b.saldoKg).toBeNull();
      expect(b.rotuloCurto).toBe('Sem estimativa');
      expect(b.alertas).toEqual([]);
      // Mesmo conjunto para os dois: 06/11 + (300 + 200) ÷ 50 = 16/11.
      expect(a.dataEsgotamentoConjuntoEstimada).toBe('2026-11-16');
      expect(b.dataEsgotamentoConjuntoEstimada).toBe('2026-11-16');
    }
    const emDezesseis = nivel({ ponto: OUTRO, eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-16' });
    expect(emDezesseis.alertas.map((alerta) => alerta.tipo)).toEqual(['cocho_sem_produto']);
  });

  it('cocho parado enquanto o vizinho seguia sendo reabastecido: dividiu o rebanho, então fica sem estimativa (conservador)', () => {
    // c2 recebeu 200 kg em 01/10 e nunca mais; c1 foi reabastecido a cada 4 dias.
    const c1 = [
      evento({ id: 'f1', data_lancamento: '2026-10-01', dias_periodo: 4, sobra_kg: 0, consumo_diario_grupo_kg: 50 }),
      evento({ id: 'f2', data_lancamento: '2026-10-05', dias_periodo: 4, sobra_kg: 0, consumo_diario_grupo_kg: 50 }),
      evento({ id: 'f3', data_lancamento: '2026-11-10' }),
    ];
    const c2 = eventoOutro({ data_lancamento: '2026-10-01' });
    const a = nivel({ eventos: [...c1, c2], pontos: [COCHO, OUTRO], hoje: '2026-11-12' });
    expect(a.confiabilidade).toBe('compartilhada');
    expect(a.compartilhadoCom).toEqual(['c2']);
  });

  it('vizinho cujo ciclo FECHOU (gado saiu) depois de dividir o rebanho: sem estimativa, sem 0% falso; conjunto conta a partir do fechamento', () => {
    // c2 [a1] recebeu SAL em 01/11 e fechou com 5 dias (gado saiu): dividiu o rebanho com c1 até 06/11.
    const eventos = [evento(), eventoOutro({ dias_periodo: 5, sobra_kg: 50, consumo_diario_grupo_kg: 30 })];
    const a = nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-06' });
    expect(a.confiabilidade).toBe('compartilhada');
    expect(a.saldoKg).toBeNull();
    expect(a.rotuloCurto).toBe('Sem estimativa');
    expect(a.alertas).toEqual([]);
    expect(a.compartilhadoCom).toEqual(['c2']);
    // Limite superior: depois de 06/11 o rebanho só come de c1 → 06/11 + 200 ÷ 50 = 10/11.
    expect(a.dataEsgotamentoConjuntoEstimada).toBe('2026-11-10');
    expect(nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-09' }).alertas).toEqual([]);
    expect(nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-10' }).alertas.map((alerta) => alerta.tipo)).toEqual(['cocho_sem_produto']);
  });

  it('vizinho que TROCOU de produto depois de dividir o rebanho: este cocho fica sem estimativa', () => {
    const eventos = [
      evento(),
      eventoOutro({ id: 'e2a', dias_periodo: 4, sobra_kg: 120, consumo_diario_grupo_kg: 20 }),
      eventoOutro({ id: 'e2b', data_lancamento: '2026-11-05', produto_id: 'p-prot', produto: 'PROTEINADO' }),
    ];
    const a = nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-05' });
    expect(a.confiabilidade).toBe('compartilhada');
    expect(a.alertas).toEqual([]);
    // O próprio vizinho segue estimado no produto novo.
    expect(nivel({ ponto: OUTRO, eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-05' }).confiabilidade).toBe('estimada');
  });

  it('conjunto com um ciclo externo fechado: não acusa "sem produto" antes do limite superior', () => {
    const C3 = { ...COCHO, id: 'c3', area_vinculada_ids: ['a1', 'a2'] };
    const eventos = [
      evento(),
      eventoOutro({ data_lancamento: '2026-11-02' }),
      evento({ id: 'e3', ponto_suplementacao_id: 'c3', quantidade_total_kg: 300, dias_periodo: 5, sobra_kg: 200, consumo_diario_grupo_kg: 20 }),
    ];
    const pontos = [COCHO, OUTRO, C3];
    const a = nivel({ eventos, pontos, hoje: '2026-11-10' });
    const b = nivel({ ponto: OUTRO, eventos, pontos, hoje: '2026-11-10' });
    expect(a.confiabilidade).toBe('compartilhada');
    // Início = máx(02/11, fim do ciclo de c3 em 06/11); 400 kg ÷ 50 = 8 dias → 14/11, igual para os dois.
    expect(a.dataEsgotamentoConjuntoEstimada).toBe('2026-11-14');
    expect(b.dataEsgotamentoConjuntoEstimada).toBe('2026-11-14');
    expect(a.alertas).toEqual([]);
  });

  it('vizinho com lançamento FUTURO que encerra um ciclo que dividiu o rebanho: o ciclo atual dele conta', () => {
    // c1 e c2 em 08/11; c2 tem lançamento em 14/11 (futuro em 12/11) que fecha o de 08/11 com 6 dias.
    const fechadoPeloFuturo = [
      evento({ data_lancamento: '2026-11-08' }),
      eventoOutro({ id: 'e2a', data_lancamento: '2026-11-08', dias_periodo: 6, sobra_kg: 0, consumo_diario_grupo_kg: 33 }),
      eventoOutro({ id: 'e2b', data_lancamento: '2026-11-14' }),
    ];
    const a = nivel({ eventos: fechadoPeloFuturo, pontos: [COCHO, OUTRO], hoje: '2026-11-12' });
    expect(a.confiabilidade).toBe('compartilhada');
    expect(a.alertas).toEqual([]);
    // Variante: o de 08/11 ainda aberto (o futuro não fechou): mesmo resultado.
    const abertoComFuturo = [
      evento({ data_lancamento: '2026-11-08' }),
      eventoOutro({ id: 'e2a', data_lancamento: '2026-11-08' }),
      eventoOutro({ id: 'e2b', data_lancamento: '2026-11-14' }),
    ];
    expect(nivel({ eventos: abertoComFuturo, pontos: [COCHO, OUTRO], hoje: '2026-11-12' }).confiabilidade).toBe('compartilhada');
  });

  it('produto por id e por nome misturados (legado sem id): o grupo e o conjunto são os mesmos vistos de qualquer cocho', () => {
    const A = { ...COCHO, id: 'A' };
    const B = { ...COCHO, id: 'B' };
    const C = { ...COCHO, id: 'C' };
    const eventos = [
      evento({ id: 'eA', ponto_suplementacao_id: 'A', produto_id: 'p-1', produto: 'SAL', data_lancamento: '2026-11-01' }),
      evento({ id: 'eB', ponto_suplementacao_id: 'B', produto_id: null, produto: 'SAL', data_lancamento: '2026-11-02' }),
      evento({ id: 'eC', ponto_suplementacao_id: 'C', produto_id: 'p-2', produto: 'SAL', quantidade_total_kg: 1000, data_lancamento: '2026-11-03' }),
    ];
    const pontos = [A, B, C];
    const niveis = [A, B, C].map((ponto) => nivel({ ponto, eventos, pontos, hoje: '2026-11-10' }));
    expect(niveis.map((n) => n.confiabilidade)).toEqual(['compartilhada', 'compartilhada', 'compartilhada']);
    expect(new Set(niveis.map((n) => n.dataEsgotamentoConjuntoEstimada)).size).toBe(1);
    expect(niveis.map((n) => n.alertas.length)).toEqual([0, 0, 0]);
  });

  it('desempenho: 150 cochos × 6.000 lançamentos — o índice da fazenda é montado uma vez', () => {
    const pontos = Array.from({ length: 150 }, (_, i) => ({ ...COCHO, id: `k${i}`, area_vinculada_ids: [`a${i % 50}`] }));
    const eventos = [];
    for (let i = 0; i < 150; i += 1) {
      for (let k = 0; k < 40; k += 1) {
        const dia = new Date(Date.UTC(2026, 0, 1) + k * 6 * 86400000).toISOString().slice(0, 10);
        eventos.push(evento({ id: `x${i}-${k}`, ponto_suplementacao_id: `k${i}`, data_lancamento: dia, dias_periodo: k < 39 ? 6 : null, sobra_kg: 0, consumo_diario_grupo_kg: k < 39 ? 30 : null }));
      }
    }
    const inicio = performance.now();
    for (let rodada = 0; rodada < 2; rodada += 1) {
      for (const ponto of pontos) {
        const n = nivel({ ponto, eventos, pontos, hoje: '2026-09-01' });
        expect(n.estado).toBe('ciclo_aberto');
      }
    }
    expect(performance.now() - inicio).toBeLessThan(1500);
  });

  it('lançamento FUTURO no vizinho não deixa este cocho sem estimativa hoje', () => {
    const eventos = [evento({ data_lancamento: '2026-11-10' }), eventoOutro({ data_lancamento: '2026-11-13' })];
    const a = nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-12' });
    expect(a.confiabilidade).toBe('estimada');
    expect(a.rotuloCurto).toBe('50%');
    // No dia do lançamento do vizinho, os dois passam a dividir o rebanho.
    expect(nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-13' }).confiabilidade).toBe('compartilhada');
  });

  it('grupo transitivo: A–B nas áreas a1 e B–C na a2 formam um grupo só, com o mesmo conjunto para os três', () => {
    const A = { ...COCHO, id: 'A', area_vinculada_ids: ['a1'] };
    const B = { ...COCHO, id: 'B', area_vinculada_ids: ['a1', 'a2'] };
    const C = { ...COCHO, id: 'C', area_vinculada_ids: ['a2'] };
    const eventos = [
      evento({ id: 'eA', ponto_suplementacao_id: 'A', data_lancamento: '2026-11-01' }),
      evento({ id: 'eB', ponto_suplementacao_id: 'B', data_lancamento: '2026-11-03' }),
      evento({ id: 'eC', ponto_suplementacao_id: 'C', data_lancamento: '2026-11-06' }),
    ];
    const pontos = [A, B, C];
    const niveis = [A, B, C].map((ponto) => nivel({ ponto, eventos, pontos, hoje: '2026-11-07' }));
    expect(niveis.map((n) => n.confiabilidade)).toEqual(['compartilhada', 'compartilhada', 'compartilhada']);
    expect([...niveis[0].compartilhadoCom].sort()).toEqual(['B', 'C']);
    // 06/11 + 600 ÷ 50 = 18/11 para todos.
    expect(niveis.map((n) => n.dataEsgotamentoConjuntoEstimada)).toEqual(['2026-11-18', '2026-11-18', '2026-11-18']);
  });

  it('taxa absurda (dado corrompido) não derruba o cálculo: sem data de esgotamento, sem exceção', () => {
    const minuscula = evento({ consumo_esperado_pv_kg: 0.000001 });
    expect(() => nivel({ eventos: [minuscula], hoje: '2026-11-12' })).not.toThrow();
    const n = nivel({ eventos: [minuscula], hoje: '2026-11-12' });
    expect(n.confiabilidade).toBe('estimada');
    expect(n.dataEsgotamentoEstimada).toBeNull();
    expect(n.rotuloCurto).toBe('100%');
    const comVizinho = [minuscula, eventoOutro({ consumo_esperado_pv_kg: 0.000001 })];
    expect(() => nivel({ eventos: comVizinho, pontos: [COCHO, OUTRO], hoje: '2026-11-12' })).not.toThrow();
    const n2 = nivel({ eventos: comVizinho, pontos: [COCHO, OUTRO], hoje: '2026-11-12' });
    expect(n2.confiabilidade).toBe('compartilhada');
    expect(n2.dataEsgotamentoConjuntoEstimada).toBeNull();
  });

  it('janelas: lançado no dia do esgotamento do outro não conta; um dia antes conta (nos dois sentidos)', () => {
    // c1: 01/11, 200 kg a 50 kg/dia → esgota em 05/11.
    const noEsgotamento = [evento(), eventoOutro({ data_lancamento: '2026-11-05' })];
    expect(nivel({ eventos: noEsgotamento, pontos: [COCHO, OUTRO], hoje: '2026-11-06' }).confiabilidade).toBe('estimada');
    expect(nivel({ ponto: OUTRO, eventos: noEsgotamento, pontos: [COCHO, OUTRO], hoje: '2026-11-06' }).confiabilidade).toBe('estimada');
    const antes = [evento(), eventoOutro({ data_lancamento: '2026-11-04' })];
    expect(nivel({ eventos: antes, pontos: [COCHO, OUTRO], hoje: '2026-11-06' }).confiabilidade).toBe('compartilhada');
    expect(nivel({ ponto: OUTRO, eventos: antes, pontos: [COCHO, OUTRO], hoje: '2026-11-06' }).confiabilidade).toBe('compartilhada');
  });

  it('outro cocho sem taxa: a janela dele usa a taxa deste (os dois contam o mesmo rebanho); sem data válida não conta', () => {
    // c2 sem %PV, 400 kg em 25/10: pela taxa de c1 (50 kg/dia) esgota em 02/11 > 01/11.
    const semTaxa = eventoOutro({ data_lancamento: '2026-10-25', quantidade_total_kg: 400, consumo_esperado_pv_kg: null });
    expect(nivel({ eventos: [evento(), semTaxa], pontos: [COCHO, OUTRO], hoje: '2026-11-02' }).confiabilidade).toBe('compartilhada');
    // 300 kg em 25/10 esgota em 31/10, antes do lançamento de c1.
    const curto = eventoOutro({ data_lancamento: '2026-10-25', quantidade_total_kg: 300, consumo_esperado_pv_kg: null });
    expect(nivel({ eventos: [evento(), curto], pontos: [COCHO, OUTRO], hoje: '2026-11-02' }).confiabilidade).toBe('estimada');
    const semData = eventoOutro({ data_lancamento: 'xx' });
    expect(nivel({ eventos: [evento(), semData], pontos: [COCHO, OUTRO], hoje: '2026-11-02' }).confiabilidade).toBe('estimada');
  });

  it('compartilhados e depois sem lançamento: mantém o aviso crítico quando nem somando os cochos ainda haveria produto', () => {
    // 01/11 e 02/11, 200 kg cada, 50 kg/dia o rebanho: 400 kg somados acabam
    // no máximo 8 dias depois do último lançamento (10/11).
    const eventos = [evento(), eventoOutro({ data_lancamento: '2026-11-02' })];
    const antes = nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-09' });
    expect(antes.confiabilidade).toBe('compartilhada');
    expect(antes.dataEsgotamentoConjuntoEstimada).toBe('2026-11-10');
    expect(antes.alertas).toEqual([]);
    const depois = nivel({ eventos, pontos: [COCHO, OUTRO], hoje: '2026-11-10' });
    expect(depois.confiabilidade).toBe('compartilhada');
    expect(depois.saldoKg).toBeNull();
    expect(depois.neutro).toBe(true);
    expect(depois.alertas).toEqual([
      { tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: 'A cobertura estimada dos 2 cochos que atendem estes animais foi esgotada.' },
    ]);
  });
});

describe('calcularNivelCocho — quantização do ícone', () => {
  it('fracaoParaSvg é a fração do ciclo arredondada em 1%', () => {
    const n1 = nivel({ eventos: [evento({ quantidade_total_kg: 3, consumo_esperado_pv_kg: 1 })], hoje: '2026-11-02' });
    expect(n1.fracaoCiclo).toBeCloseTo(2 / 3, 10);
    expect(n1.fracaoParaSvg).toBe(0.67);
    const n2 = nivel({ eventos: [evento({ quantidade_total_kg: 300, consumo_esperado_pv_kg: 1 })], hoje: '2026-11-02' });
    expect(n2.fracaoParaSvg).toBe(1);
    const n3 = nivel({ eventos: [evento({ quantidade_total_kg: 1000, consumo_esperado_pv_kg: 1 })], hoje: '2026-11-08' });
    expect(n3.fracaoParaSvg).toBe(0.99);
  });

  it('números em texto (documento JSON) são lidos; vazio vira 0', () => {
    const n = nivel({ eventos: [evento({ quantidade_total_kg: '200', sobra_kg: '', consumo_esperado_pv_kg: '50' })], hoje: '2026-11-02' });
    expect(n.baseCicloKg).toBe(200);
    expect(n.saldoKg).toBe(150);
  });
});

describe('calcularNivelDeposito', () => {
  const DEP = { id: 'd1', empresa_id: 'emp-1', categoria_ponto: 'DEPOSITO', local_estoque_id: 'loc1', capacidade_cocho_kg: 300, estoque_minimo_kg: null };
  const RACAO = { id: 'pr-racao', unidade_principal_estoque: 'KG' };
  const DIESEL = { id: 'pr-diesel', unidade_principal_estoque: 'L' };
  const lote = (qtd, produto = RACAO, extra = {}) => ({ id: `l-${qtd}-${produto.id}`, produto_id: produto.id, local_estoque_id: 'loc1', quantidade_disponivel: qtd, ...extra });
  const dep = (saldo, deposito = DEP, produtos = [RACAO, DIESEL]) => calcularNivelDeposito({ deposito, estoqueLotes: [lote(saldo)], produtos });

  it('limite 300, saldo 600: 200%, excesso 300, fração do ícone 1 e alerta acima do limite', () => {
    const n = dep(600);
    expect(n.saldoKg).toBe(600);
    expect(n.limiteOperacionalKg).toBe(300);
    expect(n.ocupacaoPercentual).toBe(200);
    expect(n.excessoKg).toBe(300);
    expect(n.fracaoParaSvg).toBe(1);
    expect(n.neutro).toBe(false);
    expect(n.necessidadeReposicaoKg).toBe(0);
    expect(n.rotuloCurto).toBe('200%');
    expect(n.alertas).toEqual([
      { tipo: 'deposito_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional', descricao: 'Saldo de 600 kg, 300 kg acima do limite operacional (200%).' },
    ]);
    expect(n.descricao).toContain('200% do limite operacional de 300 kg (300 kg acima)');
  });

  it('limite 300, saldo 150, mínimo 100: 50%, acima do mínimo (margem 50)', () => {
    const n = dep(150, { ...DEP, estoque_minimo_kg: 100 });
    expect(n.ocupacaoPercentual).toBe(50);
    expect(n.fracaoParaSvg).toBe(0.5);
    expect(n.estoqueMinimoKg).toBe(100);
    expect(n.abaixoMinimo).toBe(false);
    expect(n.margemMinimoKg).toBe(50);
    expect(n.necessidadeReposicaoKg).toBe(150);
    expect(n.alertas).toEqual([]);
  });

  it('limite 300, saldo 90, mínimo 100: 30% e abaixo do mínimo (margem −10)', () => {
    const n = dep(90, { ...DEP, estoque_minimo_kg: 100 });
    expect(n.ocupacaoPercentual).toBe(30);
    expect(n.fracaoParaSvg).toBe(0.3);
    expect(n.abaixoMinimo).toBe(true);
    expect(n.margemMinimoKg).toBe(-10);
    expect(n.alertas).toEqual([
      { tipo: 'deposito_estoque_minimo', severidade: 'alerta', titulo: 'Estoque mínimo atingido', descricao: 'Saldo 90 kg abaixo do mínimo configurado.' },
    ]);
  });

  it('o mínimo nunca é divisor nem teto do percentual; saldo igual ao mínimo conta como atingido', () => {
    for (const minimo of [null, 50, 150, 1000]) {
      const n = dep(150, { ...DEP, estoque_minimo_kg: minimo });
      expect(n.ocupacaoPercentual).toBe(50);
      expect(n.fracaoParaSvg).toBe(0.5);
    }
    expect(dep(100, { ...DEP, estoque_minimo_kg: 100 }).abaixoMinimo).toBe(true);
    expect(dep(100.01, { ...DEP, estoque_minimo_kg: 100 }).abaixoMinimo).toBe(false);
    expect(dep(100, { ...DEP, estoque_minimo_kg: 0 }).estoqueMinimoKg).toBeNull();
    expect(dep(100, { ...DEP, estoque_minimo_kg: 0 }).abaixoMinimo).toBe(false);
    expect(dep(100, { ...DEP, estoque_minimo_kg: 0 }).margemMinimoKg).toBeNull();
  });

  it('limite 0/null: sem percentual, neutro, fração 0 e necessidade 0', () => {
    for (const capacidade of [0, null, undefined, -1]) {
      const n = dep(150, { ...DEP, capacidade_cocho_kg: capacidade });
      expect(n.limiteOperacionalKg).toBeNull();
      expect(n.ocupacaoPercentual).toBeNull();
      expect(n.excessoKg).toBeNull();
      expect(n.neutro).toBe(true);
      expect(n.fracaoParaSvg).toBe(0);
      expect(n.necessidadeReposicaoKg).toBe(0);
      expect(n.mensagemLimite).toBe('Limite operacional não configurado; não há percentual.');
      expect(n.rotuloCurto).toBe('Sem limite');
      expect(n.alertas).toEqual([]);
    }
  });

  it('saldo 0: alerta crítico de depósito sem produto (e não o de mínimo)', () => {
    const n = calcularNivelDeposito({ deposito: { ...DEP, estoque_minimo_kg: 100 }, estoqueLotes: [], produtos: [RACAO] });
    expect(n.saldoKg).toBe(0);
    expect(n.fracaoParaSvg).toBe(0);
    expect(n.neutro).toBe(false);
    expect(n.alertas.map((a) => [a.tipo, a.severidade])).toEqual([['deposito_sem_estoque', 'critico']]);
  });

  it('lote em L no local fica fora do saldo em kg; outro local e quantidade ≤ 0 também', () => {
    const n = calcularNivelDeposito({
      deposito: DEP,
      estoqueLotes: [lote(250), lote(5000, DIESEL), lote(40, RACAO, { local_estoque_id: 'loc2' }), lote(0), lote(-3)],
      produtos: [RACAO, DIESEL],
    });
    expect(n.saldoKg).toBe(250);
    expect(n.lotesEmLitrosIgnorados).toBe(1);
    expect(n.unidadesConfirmadas).toBe(true);
    expect(n.mensagemUnidade).toBeNull();
  });

  it('nunca trunca o saldo', () => {
    const n = calcularNivelDeposito({ deposito: DEP, estoqueLotes: [lote(150.75), lote(0.5)], produtos: [RACAO] });
    expect(n.saldoKg).toBe(151.25);
  });

  it('unidade não confirmada: lista de produtos vazia ou lote sem produto na lista (o lote continua somado)', () => {
    const msg = 'Unidade de alguns produtos não confirmada; o saldo em kg pode incluir itens de outra unidade.';
    const semLista = calcularNivelDeposito({ deposito: DEP, estoqueLotes: [lote(250), lote(5000, DIESEL)], produtos: [] });
    expect(semLista.saldoKg).toBe(5250);
    expect(semLista.unidadesConfirmadas).toBe(false);
    expect(semLista.mensagemUnidade).toBe(msg);
    const faltando = calcularNivelDeposito({ deposito: DEP, estoqueLotes: [lote(250), lote(10, { id: 'pr-novo' })], produtos: [RACAO] });
    expect(faltando.saldoKg).toBe(260);
    expect(faltando.unidadesConfirmadas).toBe(false);
    const semLote = calcularNivelDeposito({ deposito: DEP, estoqueLotes: [], produtos: [] });
    expect(semLote.unidadesConfirmadas).toBe(true);
    expect(semLote.mensagemUnidade).toBeNull();
  });

  it('quantização do ícone em 1%', () => {
    const n = calcularNivelDeposito({ deposito: { ...DEP, capacidade_cocho_kg: 3 }, estoqueLotes: [lote(1)], produtos: [RACAO] });
    expect(n.ocupacaoPercentual).toBeCloseTo(33.333333, 5);
    expect(n.fracaoParaSvg).toBe(0.33);
    expect(n.rotuloCurto).toBe('33,33%');
  });

  it('depósito sem local de estoque não soma lote nenhum', () => {
    const n = calcularNivelDeposito({ deposito: { ...DEP, local_estoque_id: undefined }, estoqueLotes: [lote(10, RACAO, { local_estoque_id: undefined })], produtos: [RACAO] });
    expect(n.saldoKg).toBe(0);
  });
});

describe('formatadores do nível', () => {
  it('kg e percentual em pt-BR com até 2 casas, sem arredondar para inteiro', () => {
    expect(formatarKgNivel(150)).toBe('150 kg');
    expect(formatarKgNivel(5000.5)).toBe('5.000,5 kg');
    expect(formatarPercentualNivel(166.66666)).toBe('166,67%');
    expect(formatarPercentualNivel(125)).toBe('125%');
  });
});

describe('adaptadores de compatibilidade (pontoStatusUtils) delegam ao SSOT', () => {
  it('getCochoIndicator: percent/badge/helper/latestRecord/nivel vêm do nível, com `hoje` e `pontos` das opções', async () => {
    const { getCochoIndicator } = await import('@/components/mapa/pontoStatusUtils');
    const ponto = { ...COCHO, capacidade_cocho_kg: 120 };
    const ind = getCochoIndicator(ponto, [evento()], { hoje: '2026-11-02', pontos: [ponto] });
    const esperado = calcularNivelCocho({ ponto, eventos: [evento()], hoje: '2026-11-02', pontos: [ponto] });
    expect(ind.nivel).toEqual(esperado);
    expect(ind.percent).toBe(0.75);
    expect(ind.badgeLabel).toBe('75%');
    expect(ind.helperLabel).toBe(esperado.descricao);
    expect(ind.latestRecord?.id).toBe('e1');
    expect(ind.saldoAtual).toBe(150);
    // Sem taxa: o marcador NÃO mostra mais 100% (antes não descontava nada).
    expect(getCochoIndicator(ponto, [evento({ consumo_esperado_pv_kg: null })], { hoje: '2026-11-02' }).percent).toBe(0);
    // Compartilhado, via `opcoes.pontos`.
    const outro = { ...COCHO, id: 'c2' };
    const compartilhado = getCochoIndicator(ponto, [evento(), evento({ id: 'e2', ponto_suplementacao_id: 'c2' })], { hoje: '2026-11-02', pontos: [ponto, outro] });
    expect(compartilhado.nivel.confiabilidade).toBe('compartilhada');
    expect(compartilhado.percent).toBe(0);
  });

  it('getCochoIndicator sem `hoje` (ou inválido) usa hojeNoFuso(null)', async () => {
    const { getCochoIndicator } = await import('@/components/mapa/pontoStatusUtils');
    const { hojeNoFuso } = await import('@/lib/diaCivil');
    expect(getCochoIndicator(COCHO, [evento()]).nivel.hoje).toBe(hojeNoFuso(null));
    expect(getCochoIndicator(COCHO, [evento()], { hoje: 'ontem' }).nivel.hoje).toBe(hojeNoFuso(null));
    expect(getCochoIndicator(COCHO, []).badgeLabel).toBe('Sem lançamento');
  });

  it('getDepositoIndicator: nível do SSOT e campos antigos com consumidor', async () => {
    const { getDepositoIndicator } = await import('@/components/mapa/pontoStatusUtils');
    const deposito = { id: 'd1', local_estoque_id: 'loc1', capacidade_cocho_kg: 300, estoque_minimo_kg: 100 };
    const lotes = [{ id: 'l1', produto_id: 'p1', local_estoque_id: 'loc1', quantidade_disponivel: 600 }];
    const produtos = [{ id: 'p1', unidade_principal_estoque: 'KG' }];
    const ind = getDepositoIndicator(deposito, [], [], lotes, [], produtos);
    expect(ind.nivel).toEqual(calcularNivelDeposito({ deposito, estoqueLotes: lotes, produtos }));
    expect(ind.percent).toBe(1);
    expect(ind.badgeLabel).toBe('200%');
    expect(ind.helperLabel).toBe(ind.nivel.descricao);
    expect(ind.saldoAtual).toBe(600);
    expect(ind.estoqueMinimo).toBe(100);
    expect(ind.capacidadeDeposito).toBe(300);
    expect(ind.necessidadeReposicao).toBe(0);
    expect(ind.isCritical).toBe(false);
    expect(ind.latestRecord).toBeNull();
  });
});
