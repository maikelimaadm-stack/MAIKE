/**
 * D-PROD-178 — alertas de cocho e depósito do Mapa Geral vêm do SSOT
 * (`nivelSuplementacao`), com o MESMO dia civil e a MESMA taxa do marcador.
 *
 *  - tipos, títulos e severidades preservados: cocho_sem_lancamento,
 *    cocho_sem_produto, cocho_baixo, deposito_sem_estoque,
 *    deposito_estoque_minimo, deposito_cobertura_baixa; novos
 *    cocho_acima_limite e deposito_acima_limite. Nas descrições, só o formato
 *    dos números mudou para pt-BR ("1.0" → "1", "0.5" → "0,5", "1234" →
 *    "1.234,4"); o excesso diz o saldo e quanto passa do limite;
 *  - cocho com ciclo aberto antigo (sem lançamento novo) não contamina o
 *    vizinho ativo, e o próprio cocho vazio mantém "Cocho sem produto";
 *  - sem taxa no lançamento (sem %PV) não há falso "Cocho sem produto" — nem no
 *    dia do lançamento, nem com o fallback antigo do "maior %PV" da área;
 *  - saldo do depósito sem Produto em L (P-11), como o marcador;
 *  - cobertura do depósito só soma taxas ESTIMADAS dos cochos ligados;
 *  - `hoje` por parâmetro (padrão: `hojeNoFuso(null)`);
 *  - `alertasLote` e o formato `{ alertasLote, alertasPonto }` inalterados.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildMapaAlertasSuplementacao } from '@/components/mapa/mapaAlertasSuplementacaoUtils';

const COCHO = { id: 'c1', empresa_id: 'emp-1', nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', status: 'Ativo', area_vinculada_ids: ['a1'], deposito_origem_id: 'd1' };
const DEPOSITO = { id: 'd1', empresa_id: 'emp-1', nome_ponto: 'DEPÓSITO', categoria_ponto: 'DEPOSITO', status: 'Ativo', local_estoque_id: 'loc1', capacidade_cocho_kg: 1000, estoque_minimo_kg: 100 };
const evento = (extra = {}) => ({
  id: 'e1', empresa_id: 'emp-1', ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-01', produto: 'SAL', produto_id: 'p-sal',
  quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: 50, ...extra,
});
const RACAO = { id: 'pr-racao', unidade_principal_estoque: 'KG', percentual_consumo_pv: 1 };
const DIESEL = { id: 'pr-diesel', unidade_principal_estoque: 'L' };
const loteEstoque = (qtd, produto = RACAO) => ({ id: `le-${produto.id}-${qtd}`, produto_id: produto.id, local_estoque_id: 'loc1', quantidade_disponivel: qtd, status: 'Disponivel' });
const loteGado = { id: 'lote-1', status: 'Ativo', area_atual_id: 'a1', quantidade_cabecas: 100, peso_medio_kg: 300 };

const montar = (extra = {}) => buildMapaAlertasSuplementacao({
  lotes: [],
  pontosSuplementacao: [COCHO, DEPOSITO],
  eventosSupl: [evento()],
  estoqueLotes: [loteEstoque(500)],
  produtos: [RACAO, DIESEL],
  hoje: '2026-11-02',
  ...extra,
});
const tipos = (resultado, id) => (resultado.alertasPonto.get(id)?.alertas || []).map((a) => a.tipo);

afterEach(() => vi.useRealTimers());

describe('alertas do cocho pelo SSOT', () => {
  it('tipos preservados: sem lançamento, reposição próxima e sem produto (mesmo dia civil do marcador)', () => {
    expect(montar({ eventosSupl: [] }).alertasPonto.get('c1').alertas).toEqual([
      { tipo: 'cocho_sem_lancamento', severidade: 'critico', titulo: 'Cocho sem lançamento', descricao: 'Não há lançamento de suplementação para este cocho.' },
    ]);
    expect(tipos(montar({ hoje: '2026-11-03' }), 'c1')).toEqual([]);
    expect(montar({ hoje: '2026-11-04' }).alertasPonto.get('c1').alertas).toEqual([
      { tipo: 'cocho_baixo', severidade: 'alerta', titulo: 'Reposição próxima', descricao: 'Cobertura estimada restante: 1 dia(s).' },
    ]);
    // Fração de dia em pt-BR: 175 kg a 50 kg/dia no dia 3 → 0,5 dia.
    expect(montar({ hoje: '2026-11-04', eventosSupl: [evento({ quantidade_total_kg: 175 })] }).alertasPonto.get('c1').alertas[0].descricao)
      .toBe('Cobertura estimada restante: 0,5 dia(s).');
    expect(montar({ hoje: '2026-11-05' }).alertasPonto.get('c1').alertas).toEqual([
      { tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: 'A cobertura estimada do cocho foi esgotada.' },
    ]);
  });

  it('sem taxa (%PV ausente no lançamento): nunca "Cocho sem produto", nem no dia do lançamento nem com lotes e %PV na área', () => {
    const semTaxa = evento({ consumo_esperado_pv_kg: null });
    for (const hoje of ['2026-11-01', '2026-11-02', '2026-12-30']) {
      const r = montar({ eventosSupl: [semTaxa], hoje, lotes: [loteGado] });
      expect(tipos(r, 'c1')).toEqual([]);
      expect(r.alertasPonto.get('c1').nivel.confiabilidade).toBe('indisponivel');
    }
  });

  it('cocho abandonado (ciclo aberto antigo) ao lado de um ativo: os dois seguem estimados e o vazio mantém o crítico', () => {
    const A = { ...COCHO, id: 'A', deposito_origem_id: null };
    const B = { ...COCHO, id: 'B', deposito_origem_id: null };
    const evB = evento({ id: 'eB', ponto_suplementacao_id: 'B', data_lancamento: '2026-08-01', quantidade_total_kg: 100 });
    const evA = evento({ id: 'eA', ponto_suplementacao_id: 'A', data_lancamento: '2026-11-10' });
    const soB = montar({ pontosSuplementacao: [B], eventosSupl: [evB], hoje: '2026-11-12' });
    expect(tipos(soB, 'B')).toEqual(['cocho_sem_produto']);
    const ambos = montar({ pontosSuplementacao: [A, B], eventosSupl: [evA, evB], hoje: '2026-11-12' });
    expect(tipos(ambos, 'B')).toEqual(['cocho_sem_produto']);
    expect(ambos.alertasPonto.get('B').nivel.confiabilidade).toBe('estimada');
    expect(ambos.alertasPonto.get('A').nivel.confiabilidade).toBe('estimada');
    expect(ambos.alertasPonto.get('A').nivel.rotuloCurto).toBe('50%');
  });

  it('período fechado não recalcula cobertura a partir da data do lançamento', () => {
    const fechado = evento({ dias_periodo: 4, sobra_kg: 0 });
    expect(tipos(montar({ eventosSupl: [fechado], hoje: '2026-12-30' }), 'c1')).toEqual([]);
  });

  it('acima do limite operacional: cocho_acima_limite', () => {
    const r = montar({ pontosSuplementacao: [{ ...COCHO, capacidade_cocho_kg: 120 }, DEPOSITO] });
    expect(r.alertasPonto.get('c1').alertas).toEqual([
      {
        tipo: 'cocho_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional',
        descricao: 'Fornecimento acima do limite operacional: 80 kg (166,67%) no lançamento; agora 30 kg acima.',
      },
    ]);
  });

  it('`hoje` padrão é o dia civil do navegador (hojeNoFuso(null)), não blocos de 24 h UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0)); // 05/11 meio-dia no relógio local
    const r = buildMapaAlertasSuplementacao({ lotes: [], pontosSuplementacao: [COCHO], eventosSupl: [evento()], estoqueLotes: [], produtos: [] });
    expect(r.alertasPonto.get('c1').nivel.hoje).toBe('2026-11-05');
    expect(tipos(r, 'c1')).toEqual(['cocho_sem_produto']);
  });

  it('guarda o nível do SSOT junto dos alertas (consumoDiario = taxa estimada)', () => {
    const info = montar().alertasPonto.get('c1');
    expect(info.nivel.saldoKg).toBe(150);
    expect(info.consumoDiario).toBe(50);
    expect(info.cobertura.diasRestantes).toBe(3);
  });
});

describe('alertas do depósito pelo SSOT', () => {
  it('sem estoque e estoque mínimo (tipos preservados)', () => {
    expect(montar({ estoqueLotes: [] }).alertasPonto.get('d1').alertas[0]).toEqual(
      { tipo: 'deposito_sem_estoque', severidade: 'critico', titulo: 'Depósito sem produto', descricao: 'Não há saldo disponível no depósito.' },
    );
    expect(montar({ estoqueLotes: [loteEstoque(90)], eventosSupl: [] }).alertasPonto.get('d1').alertas).toEqual([
      { tipo: 'deposito_estoque_minimo', severidade: 'alerta', titulo: 'Estoque mínimo atingido', descricao: 'Saldo 90 kg abaixo do mínimo configurado.' },
    ]);
  });

  it('Produto em L fica fora do saldo: diesel no mesmo local não esconde o depósito vazio de ração', () => {
    const r = montar({ estoqueLotes: [loteEstoque(5000, DIESEL)], eventosSupl: [] });
    expect(r.alertasPonto.get('d1').saldoAtual).toBe(0);
    expect(tipos(r, 'd1')).toEqual(['deposito_sem_estoque']);
    const misto = montar({ estoqueLotes: [loteEstoque(250), loteEstoque(5000, DIESEL)], eventosSupl: [] });
    expect(misto.alertasPonto.get('d1').saldoAtual).toBe(250);
  });

  it('cobertura baixa usa só a taxa ESTIMADA dos cochos ligados (alerta ≤ 2 dias, crítico ≤ 1)', () => {
    const doisDias = montar({ estoqueLotes: [loteEstoque(100)], pontosSuplementacao: [COCHO, { ...DEPOSITO, estoque_minimo_kg: null }] });
    expect(doisDias.alertasPonto.get('d1').alertas).toEqual([
      { tipo: 'deposito_cobertura_baixa', severidade: 'alerta', titulo: 'Baixa cobertura do depósito', descricao: 'Saldo cobre cerca de 2 dia(s).' },
    ]);
    expect(doisDias.alertasPonto.get('d1').consumoDiario).toBe(50);
    const umDia = montar({ estoqueLotes: [loteEstoque(40)], pontosSuplementacao: [COCHO, { ...DEPOSITO, estoque_minimo_kg: null }] });
    expect(umDia.alertasPonto.get('d1').alertas.map((a) => [a.tipo, a.severidade])).toEqual([['deposito_cobertura_baixa', 'critico']]);
    // Cocho sem taxa (sem %PV) não entra na conta: sem alerta de cobertura.
    const semTaxa = montar({ estoqueLotes: [loteEstoque(40)], eventosSupl: [evento({ consumo_esperado_pv_kg: null })], lotes: [loteGado], pontosSuplementacao: [COCHO, { ...DEPOSITO, estoque_minimo_kg: null }] });
    expect(tipos(semTaxa, 'd1')).toEqual([]);
  });

  it('cochos compartilhando os mesmos animais (estimativa não confiável) não entram na cobertura', () => {
    const OUTRO = { ...COCHO, id: 'c2' };
    const r = montar({
      estoqueLotes: [loteEstoque(40)],
      pontosSuplementacao: [COCHO, OUTRO, { ...DEPOSITO, estoque_minimo_kg: null }],
      eventosSupl: [evento(), evento({ id: 'e2', ponto_suplementacao_id: 'c2' })],
    });
    expect(r.alertasPonto.get('c1').nivel.confiabilidade).toBe('compartilhada');
    expect(tipos(r, 'd1')).toEqual([]);
  });

  it('acima do limite operacional: deposito_acima_limite', () => {
    const r = montar({ estoqueLotes: [loteEstoque(600)], eventosSupl: [], pontosSuplementacao: [COCHO, { ...DEPOSITO, capacidade_cocho_kg: 300 }] });
    expect(r.alertasPonto.get('d1').alertas).toEqual([
      { tipo: 'deposito_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional', descricao: 'Saldo de 600 kg, 300 kg acima do limite operacional (200%).' },
    ]);
    expect(r.alertasPonto.get('d1').isDeposito).toBe(true);
  });
});

describe('formato e alertas de lote inalterados', () => {
  it('retorna { alertasLote, alertasPonto } e mantém suplementacao_pendente por área', () => {
    const r = buildMapaAlertasSuplementacao({
      lotes: [loteGado, { ...loteGado, id: 'lote-2', area_atual_id: 'a-sem-cocho' }],
      pontosSuplementacao: [COCHO],
      eventosSupl: [],
      estoqueLotes: [],
      produtos: [RACAO],
      hoje: '2026-11-02',
    });
    expect(Object.keys(r).sort()).toEqual(['alertasLote', 'alertasPonto']);
    expect(r.alertasLote.get('lote-1').map((a) => [a.tipo, a.titulo])).toEqual([['suplementacao_pendente', 'Sem histórico de suplementação']]);
    expect(r.alertasLote.get('lote-2').map((a) => [a.tipo, a.titulo])).toEqual([['suplementacao_pendente', 'Área sem cocho vinculado']]);
  });
});
