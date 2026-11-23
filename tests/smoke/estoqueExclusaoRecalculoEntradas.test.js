/**
 * D-PROD-273 (fatia 5) — na tela, a exclusão com recálculo das ENTRADAS: as recusas do recálculo têm frase clara na
 * entrada documentada, no ajuste e na exclusão da transferência pelo mapa; a prévia nomeia compra, sobra e falta; e o
 * par da transferência excluída com recálculo (dois pares marcados) some do histórico do depósito sem descontar saldo.
 */
import { describe, it, expect } from 'vitest';
import { mensagemErroEntrada } from '@/lib/estoqueEntradasRegras';
import { mensagemErroAjuste } from '@/lib/estoqueAjustesRegras';
import { resumoDaPrevia } from '@/lib/estoqueRecalculoExclusao';
import { comSaldoSemExcluidos, idsDeParesExcluidos } from '@/lib/estoqueSaldoSemExcluidos';
import { mensagemDaRecusaTransferencia } from '@/components/mapa/deposito/CancelarTransferenciaDeposito';

/** O erro como o cliente da API o entrega (código e detalhes do corpo 409). */
const erro = (code, details = {}) => Object.assign(new Error('texto do servidor'), { code, details });

describe('D-PROD-273 fatia 5 — recusas do recálculo nas janelas das entradas', () => {
  it('entrada documentada e ajuste: saldo negativo diz o movimento; contagem depois diz o ajuste', () => {
    const negativo = erro('ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', { reason: 'saldo_negativo', movimento_numero: '57', saldo: '-50.0000' });
    expect(mensagemErroEntrada(negativo, 'x')).toBe('Sem este movimento o saldo do depósito ficaria negativo no movimento nº 57. A exclusão não é possível. Nada foi alterado.');
    expect(mensagemErroAjuste(negativo, 'x')).toBe('Sem este movimento o saldo do depósito ficaria negativo no movimento nº 57. A exclusão não é possível. Nada foi alterado.');
    const contagem = erro('ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', { reason: 'ajuste_de_inventario_posterior', ajuste_numero: '4' });
    expect(mensagemErroAjuste(contagem, 'x')).toMatch(/^Há uma contagem de inventário \(ajuste nº 4\) depois deste movimento no depósito/);
    // as recusas antigas continuam com a frase delas
    expect(mensagemErroEntrada(erro('ENTRADA_ESTOQUE_STATUS_INVALIDO'), 'x')).toBe('Esta entrada já foi excluída. Nada foi alterado.');
  });

  it('transferência pelo mapa: saldo negativo no destino e histórico que não se recalcula têm frase própria (não a genérica)', () => {
    expect(mensagemDaRecusaTransferencia('ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', { reason: 'saldo_negativo', movimento_numero: '12' }))
      .toBe('Sem este movimento o saldo do depósito ficaria negativo no movimento nº 12. A exclusão não é possível. Nada foi alterado.');
    expect(mensagemDaRecusaTransferencia('ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', { reason: 'replay_diverge_do_gravado' })).toMatch(/^Os valores gravados deste produto não batem/);
    expect(mensagemDaRecusaTransferencia('ESTOQUE_LOCAL_INVALIDO', { reason: 'local_inativo' })).toMatch(/depósito de origem está inativo/);
  });

  it('a prévia nomeia compra, sobra e falta do ajuste nas linhas antes → depois', () => {
    const r = resumoDaPrevia([{
      permitido: true, modo: 'recalculo', excluidos: ['c'], movimentos_posteriores: 3,
      movimentos: [
        { id: 's', numero: '9', tipo: 'Saída', tipo_detalhado: 'ajuste_falta', origem_sistema: 'ajuste_estoque', antes: { valor_total: '50.0000' }, depois: { valor_total: '60.0000' } },
        { id: 'e', numero: '8', tipo: 'Entrada', tipo_detalhado: 'ajuste_sobra', origem_sistema: 'ajuste_estoque', antes: { valor_total: '40.0000' }, depois: { valor_total: '45.0000' } },
        { id: 'v', numero: '7', tipo: 'Entrada', tipo_detalhado: 'compra_financeiro', origem_sistema: 'operacao_financeira', antes: { valor_total: '10.0000' }, depois: { valor_total: '10.0000' } },
      ],
    }]);
    expect(r.estado).toBe('recalcula');
    expect(r.linhas.map((l) => [l.numero, l.tipo])).toEqual([['8', 'Sobra (ajuste)'], ['9', 'Falta (ajuste)']]);
  });
});

describe('D-PROD-273 fatia 5 — transferência excluída com recálculo no histórico do depósito', () => {
  it('os dois pares (S + E_o com a marca de S, R + E_d com a marca de R) somem sem descontar: o saldo da saída posterior já foi regravado sem a transferência', () => {
    const base = { produto_id: 'p', empresa_id: 'e' };
    const movimentos = [
      { ...base, id: 's', numero_movimentacao: '2', tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', status: 'Estornada', local_estoque_origem: 'A', local_estoque_destino: 'B', quantidade: '80', saldo_antes: '200', saldo_depois: '120', movimento_filho_id: 'r', movimentacao_grupo_id: 'exclusao_recalculo:s' },
      { ...base, id: 'r', numero_movimentacao: '3', tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', status: 'Estornada', local_estoque_origem: 'A', local_estoque_destino: 'B', quantidade: '80', saldo_antes: '0', saldo_depois: '80', movimento_pai_id: 's', movimento_filho_id: 'ed', movimentacao_grupo_id: 'exclusao_recalculo:r' },
      { ...base, id: 'sa', numero_movimentacao: '4', tipo_movimentacao: 'Saída', tipo_detalhado: 'saida_manual', status: 'Ativa', local_estoque_origem: 'A', quantidade: '60', saldo_antes: '200', saldo_depois: '140' },
      { ...base, id: 'ed', numero_movimentacao: '5', tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_transferencia_recebida', status: 'Ativa', local_estoque_origem: 'B', quantidade: '80', movimento_pai_id: 'r', movimentacao_grupo_id: 'exclusao_recalculo:r' },
      { ...base, id: 'eo', numero_movimentacao: '6', tipo_movimentacao: 'Entrada', tipo_detalhado: 'estorno_transferencia_enviada', status: 'Ativa', local_estoque_destino: 'A', quantidade: '80', movimento_pai_id: 's', movimentacao_grupo_id: 'exclusao_recalculo:s' },
    ];
    expect([...idsDeParesExcluidos(movimentos)].sort()).toEqual(['ed', 'eo', 'r', 's']);
    const [sa] = comSaldoSemExcluidos([movimentos[2]], movimentos);
    expect([sa.saldo_antes, sa.saldo_depois]).toEqual(['200', '140']);
  });
});
