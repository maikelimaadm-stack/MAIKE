/**
 * A Saída manual do Estoque com produto que controla lote numa unidade de CONVERSÃO (D-PROD-288/310): o campo
 * "Lote" confere a soma dos lotes contra a quantidade na unidade de ESTOQUE (kg/L), como o servidor. Antes, a conta só
 * conhecia o SACO legado e comparava os lotes (em kg) com a quantidade digitada (em sacos ou galões), e o servidor
 * recusava com `lotes_nao_somam`.
 */
import { describe, it, expect } from 'vitest';
import { erroDosLotes, quantidadeDeEstoque } from '@/lib/estoqueLotesRegras';

const LOTES = [
  { id: 'cA', lote_fabricante: 'A', quantidade_disponivel: '100.0000', vencido: false },
  { id: 'cB', lote_fabricante: 'B', quantidade_disponivel: '100.0000', vencido: false },
];
const produto = (extra = {}) => ({ id: 'p1', controla_lote: true, unidade_estoque: 'KG', ...extra });

describe('quantidade da Saída na unidade de estoque (lote)', () => {
  it('conversão que multiplica: 3 SC de 25 kg = 75 kg; a soma dos lotes confere com 75', () => {
    const p = produto({ unidades_conversao: [{ sigla: 'SC', operacao: 'MULTIPLICA', fator: '25.0000', ativa: true }] });
    const linha = { produto: p, unidade: 'SC', quantidade: '3', lotes: [{ id: 'cA', quantidade: '50' }, { id: 'cB', quantidade: '25' }] };
    expect(quantidadeDeEstoque(linha)).toBe(75);
    expect(erroDosLotes(linha, LOTES)).toBe('');
    expect(erroDosLotes({ ...linha, lotes: [{ id: 'cA', quantidade: '3' }] }, LOTES)).toBe('A soma dos lotes tem de ser a quantidade da linha.');
  });

  it('conversão que divide: 10 CX ÷ 4 = 2,5 L', () => {
    const p = produto({ unidade_estoque: 'L', unidades_conversao: [{ sigla: 'CX', operacao: 'DIVIDE', fator: '4.0000', ativa: true }] });
    expect(quantidadeDeEstoque({ produto: p, unidade: 'CX', quantidade: '10' })).toBe(2.5);
  });

  it('a conversão SACO do cadastro vale antes do peso do saco legado', () => {
    const p = produto({ peso_por_saco_kg: '30.0000', unidades_conversao: [{ sigla: 'SACO', operacao: 'MULTIPLICA', fator: '25.0000', ativa: true }] });
    expect(quantidadeDeEstoque({ produto: p, unidade: 'SACO', quantidade: '2' })).toBe(50);
  });

  it('sem mudança: unidade de estoque, SACO legado pelo peso e quantidade inválida', () => {
    expect(quantidadeDeEstoque({ produto: produto(), unidade: 'KG', quantidade: '12,5' })).toBe(12.5);
    expect(quantidadeDeEstoque({ produto: produto({ peso_por_saco_kg: '40.0000' }), unidade: 'SACO', quantidade: '2' })).toBe(80);
    expect(quantidadeDeEstoque({ produto: produto(), unidade: 'KG', quantidade: 'x' })).toBe(0);
  });
});
