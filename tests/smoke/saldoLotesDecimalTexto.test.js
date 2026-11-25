/**
 * D-PROD-299 — o saldo do formulário de Entrada/Saída do depósito (e do
 * lançamento do cocho) com os decimais que o servidor manda como TEXTO.
 *
 * Antes: `0 + "15760" + "35"` colava os números ("01576035") e o saldo do
 * local crescia a cada lote novo (cada transferência cria um lote no destino).
 */

import { describe, it, expect } from 'vitest';
import {
  calcularRateioFIFO,
  disponivelDoLote,
  obterSaldoProdutoLocal,
  obterSaldoTransferivelProduto,
} from '@/components/suplementacao/estoqueSuplementacaoUtils';

// Como a API devolve (Prisma Decimal → JSON em texto).
const lotes = [
  { id: 'a', produto_id: 'p', local_estoque_id: 'barracao', quantidade_disponivel: '15760', custo_unitario: '2.5', data_documento: '2026-11-24' },
  { id: 'b', produto_id: 'p', local_estoque_id: 'barracao', quantidade_disponivel: '35', custo_unitario: '2.5', data_documento: '2026-11-24' },
  { id: 'c', produto_id: 'p', local_estoque_id: 'dep15', quantidade_disponivel: '145.0000', custo_unitario: '2.5', data_documento: '2026-11-24' },
  { id: 'd', produto_id: 'p', local_estoque_id: 'dep15', quantidade_disponivel: '350', custo_unitario: '2.5', data_documento: '2026-11-25' },
  { id: 'e', produto_id: 'p', local_estoque_id: 'dep15', quantidade_disponivel: '0', custo_unitario: '2.5', data_documento: '2026-11-25' },
];

describe('D-PROD-299 — saldo dos lotes com decimal em texto', () => {
  it('SD-01 soma como número (não cola o texto)', () => {
    expect(obterSaldoProdutoLocal(lotes, 'p', 'barracao')).toBe(15795);
    expect(obterSaldoTransferivelProduto({ produto: { id: 'p' }, lotesNota: lotes, localEstoqueId: 'dep15' })).toBe(495);
  });

  it('SD-02 rateio FIFO com texto: saldo certo e quantidades numéricas', () => {
    const r = calcularRateioFIFO({ lotesNota: lotes, produtoId: 'p', localEstoqueId: 'dep15', quantidade: 200 });
    expect(r.sucesso).toBe(true);
    expect(r.rateio.map((x) => [x.lote_id, x.quantidade_consumida])).toEqual([['c', 145], ['d', 55]]);
    const demais = calcularRateioFIFO({ lotesNota: lotes, produtoId: 'p', localEstoqueId: 'dep15', quantidade: 496 });
    expect(demais.sucesso).toBe(false);
    expect(demais.erro).toContain('495.00');
  });

  it('SD-03 valor inválido vale 0', () => {
    expect(disponivelDoLote({ quantidade_disponivel: 'abc' })).toBe(0);
    expect(disponivelDoLote({})).toBe(0);
    expect(disponivelDoLote({ quantidade_disponivel: 12.5 })).toBe(12.5);
  });
});
