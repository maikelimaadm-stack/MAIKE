/**
 * D-PROD-313 — a quantidade como foi DIGITADA (D-PROD-310) aparece na lista de movimentos do Estoque e no histórico do
 * depósito: "3 SC", e na grade "− 75 kg (3 SC)". Sem conversão, nada muda. Dados sintéticos.
 */
import { describe, it, expect } from 'vitest';
import { textoDaUnidadeDigitada } from '@/lib/unidadeLancamentoRegras';
import { quantidadeComDigitada, quantidadeComSinal } from '@/lib/estoqueConsultaRegras';
import { valorDoCampoMovimento } from '@/components/estoque/TabelaMovimentosEstoque';

describe('D-PROD-313 — unidade digitada nos históricos', () => {
  it('textoDaUnidadeDigitada: "3 SC", "2,5 CX"; sem unidade, sem quantidade ou quantidade ilegível: vazio', () => {
    expect(textoDaUnidadeDigitada({ unidade_lancamento: 'SC', quantidade_lancamento: '3.0000' })).toBe('3 SC');
    expect(textoDaUnidadeDigitada({ unidade_lancamento: 'CX', quantidade_lancamento: '2.5' })).toBe('2,5 CX');
    expect(textoDaUnidadeDigitada({ unidade_lancamento: 'SC', quantidade_lancamento: '1250.1234' })).toBe('1.250,1234 SC');
    expect(textoDaUnidadeDigitada({ unidade_lancamento: null, quantidade_lancamento: null })).toBe('');
    expect(textoDaUnidadeDigitada({ unidade_lancamento: 'SC', quantidade_lancamento: null })).toBe('');
    expect(textoDaUnidadeDigitada({ unidade_lancamento: 'SC', quantidade_lancamento: 'abc' })).toBe('');
    expect(textoDaUnidadeDigitada({ unidade_lancamento: '  ', quantidade_lancamento: '3' })).toBe('');
    expect(textoDaUnidadeDigitada(null)).toBe('');
  });

  it('grade do Estoque: "− 75 kg (3 SC)" com a conversão; sem ela, igual à quantidade com sinal', () => {
    const comSaco = { tipo: 'Saída', quantidade: '75.0000', unidade: 'KG', unidade_lancamento: 'SC', quantidade_lancamento: '3.0000', fator_lancamento: '25.0000' };
    const semConversao = { tipo: 'Entrada', quantidade: '20.0000', unidade: 'L', unidade_lancamento: null, quantidade_lancamento: null, fator_lancamento: null };
    expect(quantidadeComDigitada(comSaco)).toBe(`${quantidadeComSinal(comSaco)} (3 SC)`);
    expect(valorDoCampoMovimento(comSaco, 'quantidade')).toBe(`${quantidadeComSinal(comSaco)} (3 SC)`);
    expect(valorDoCampoMovimento(semConversao, 'quantidade')).toBe(quantidadeComSinal(semConversao));
    expect(quantidadeComDigitada({ ...comSaco, quantidade: null })).toBe('');
  });
});
