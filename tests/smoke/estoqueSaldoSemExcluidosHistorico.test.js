/**
 * D-PROD-273 (fatia 2) — o histórico do depósito (mapa) mostra o saldo antes/depois SEM os pares excluídos
 * (`comSaldoSemExcluidos`, a mesma regra do kardex no servidor): o cartão lançado entre o original e o estorno
 * desconta o original; um par inteiro antes soma zero; outro depósito e outro produto não entram; sem par ligado
 * (`movimento_pai_id`), nada muda (o mesmo objeto).
 */
import { describe, it, expect } from 'vitest';
import { comSaldoSemExcluidos, idsDeParesExcluidos } from '@/lib/estoqueSaldoSemExcluidos';
import { movimentacoesDoHistoricoDeposito } from '@/components/suplementacao/HistoricoDepositoSuplementacao';

const EMP = 'emp-1';
const LOCAL = 'loc-sede';
const OUTRO = 'loc-b';
const base = { empresa_id: EMP, produto_id: 'p-sal', produto_nome: 'SAL MINERAL', unidade_medida: 'KG', status: 'Ativa' };
const em = (n, dia) => ({ numero_movimentacao: String(n), data_movimentacao: `${dia}T12:00:00.000Z`, created_date: `${dia}T12:00:00.000Z` });

/** Galpão Sede: entrada 1000 (nº 10); transferência de 300 para o Barracão (nº 11/12); saída de 100 no cocho (nº 13);
 * a transferência excluída depois (estornos nº 14/15). Saldos gravados pelo motor. */
const ENTRADA = { ...base, ...em(10, '2026-11-01'), id: 'mv-ent', tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', quantidade: '1000', local_estoque_origem: 'loc-x', local_estoque_destino: LOCAL, saldo_antes: '0', saldo_depois: '1000' };
const S = { ...base, ...em(11, '2026-11-02'), id: 'mv-s', status: 'Estornada', tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', quantidade: '300', local_estoque_origem: LOCAL, local_estoque_destino: OUTRO, saldo_antes: '1000', saldo_depois: '700', movimento_filho_id: 'mv-r' };
const R = { ...base, ...em(12, '2026-11-02'), id: 'mv-r', status: 'Estornada', tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', quantidade: '300', local_estoque_origem: LOCAL, local_estoque_destino: OUTRO, saldo_antes: '0', saldo_depois: '300', movimento_pai_id: 'mv-s', movimento_filho_id: 'mv-ed' };
const COCHO = { ...base, ...em(13, '2026-11-03'), id: 'mv-cocho', tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', quantidade: '100', local_estoque_origem: LOCAL, saldo_antes: '700', saldo_depois: '600' };
const ED = { ...base, ...em(14, '2026-11-04'), id: 'mv-ed', tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_transferencia_recebida', quantidade: '300', local_estoque_origem: OUTRO, saldo_antes: '300', saldo_depois: '0', movimento_pai_id: 'mv-r' };
const EO = { ...base, ...em(15, '2026-11-04'), id: 'mv-eo', tipo_movimentacao: 'Entrada', tipo_detalhado: 'estorno_transferencia_enviada', quantidade: '300', local_estoque_destino: LOCAL, saldo_antes: '600', saldo_depois: '900', movimento_pai_id: 'mv-s' };
const DEPOIS = { ...base, ...em(16, '2026-11-05'), id: 'mv-depois', tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', quantidade: '50', local_estoque_origem: LOCAL, saldo_antes: '900', saldo_depois: '850' };
const TODOS = [ENTRADA, S, R, COCHO, ED, EO, DEPOIS];

describe('D-PROD-273 — saldo do histórico do depósito sem os excluídos', () => {
  it('os pares completos: as duas pernas e os dois estornos da transferência', () => {
    expect([...idsDeParesExcluidos(TODOS)].sort()).toEqual(['mv-ed', 'mv-eo', 'mv-r', 'mv-s']);
    // estorno sem pai na lista, 'Estornada' sem estorno, estorno de pai ativo e de outro produto: não são par
    expect(idsDeParesExcluidos([S, { ...ED, movimento_pai_id: 'sumiu' }]).size).toBe(0);
    expect(idsDeParesExcluidos([{ ...S, status: 'Ativa' }, EO]).size).toBe(0);
    expect(idsDeParesExcluidos([S, { ...EO, produto_id: 'outro' }]).size).toBe(0);
  });

  it('o cocho lançado entre a transferência e a exclusão dela desconta a saída excluída; o par inteiro antes soma zero', () => {
    const lista = movimentacoesDoHistoricoDeposito(TODOS, { empresaId: EMP, localEstoqueId: LOCAL });
    expect(lista.map((m) => m.id)).toEqual(['mv-depois', 'mv-cocho', 'mv-ent']);
    const [depois, cocho, entrada] = lista;
    expect([cocho.saldo_antes, cocho.saldo_depois]).toEqual(['1000.0000', '900.0000']);
    expect(cocho).not.toBe(COCHO);
    expect([COCHO.saldo_antes, COCHO.saldo_depois]).toEqual(['700', '600']); // o original não é alterado
    expect(depois).toBe(DEPOIS);
    expect([depois.saldo_antes, depois.saldo_depois]).toEqual(['900', '850']);
    expect(entrada).toBe(ENTRADA);
  });

  it('sem par ligado nada muda (o mesmo objeto); número e saldo como número também funcionam', () => {
    const soltos = [ENTRADA, { ...S, movimento_filho_id: null }, COCHO, { ...EO, movimento_pai_id: null }];
    const visiveis = [COCHO, ENTRADA];
    expect(comSaldoSemExcluidos(visiveis, soltos)).toBe(visiveis);
    const numerico = { ...COCHO, saldo_antes: 700, saldo_depois: 600 };
    const [r] = comSaldoSemExcluidos([numerico], [ENTRADA, S, R, numerico, ED, EO]);
    expect([r.saldo_antes, r.saldo_depois]).toEqual(['1000.0000', '900.0000']);
  });
});
