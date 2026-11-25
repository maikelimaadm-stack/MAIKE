/**
 * D-PROD-313 — estoque: só o último sai. A recusa do servidor vira a mensagem "exclua primeiro o mais recente".
 *
 * SE-01 com o tipo, o número, a data e o depósito do registro posterior
 * SE-02 pela origem (abastecimento, atividade, cocho) quando o tipo não diz
 * SE-03 sem detalhes: a frase genérica, nunca vazia
 * SE-04 a tela do cocho usa os detalhes da recusa e reconhece o código como recusa definitiva
 */
import { describe, it, expect } from 'vitest';
import { mensagemRecalculoDaExclusao } from '@/lib/gestaoErros';
import { mensagemDoCancelamento, MENSAGENS_CODIGO } from '@/components/suplementacao/CancelarLancamentoCocho';

const CODIGO = 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR';

describe('D-PROD-313 — mensagem do registro posterior no estoque', () => {
  it('SE-01 tipo, número, data e depósito', () => {
    const m = mensagemRecalculoDaExclusao(CODIGO, 'registro_posterior', {
      posterior_tipo: 'transferencia_enviada', posterior_numero: '42', posterior_data: '2026-11-12', local_nome: 'DEP 15',
    });
    expect(m).toBe('Há registro lançado depois deste no depósito DEP 15. Exclua primeiro o mais recente: a transferência nº 42 de 12/11/2026. Nada foi alterado.');
  });

  it('SE-02 pela origem quando o tipo não diz', () => {
    expect(mensagemRecalculoDaExclusao(CODIGO, null, { posterior_tipo: 'Saída', posterior_origem: 'abastecimento_patrimonio', posterior_numero: '7' }))
      .toContain('o abastecimento nº 7');
    expect(mensagemRecalculoDaExclusao(CODIGO, null, { posterior_tipo: 'Saída', posterior_origem: 'apontamento_atividade' })).toContain('a atividade');
    expect(mensagemRecalculoDaExclusao(CODIGO, null, { posterior_tipo: 'suplementacao' })).toContain('o lançamento no cocho');
  });

  it('SE-03 sem detalhes: frase genérica', () => {
    const m = mensagemRecalculoDaExclusao(CODIGO, null, {});
    expect(m).toBe('Há registro lançado depois deste no depósito. Exclua primeiro o mais recente: o movimento. Nada foi alterado.');
  });

  it('SE-04 tela do cocho', () => {
    expect(MENSAGENS_CODIGO[CODIGO]).toBeTruthy();
    expect(mensagemDoCancelamento(CODIGO, 'registro_posterior', { posterior_tipo: 'suplementacao', posterior_numero: '9', local_nome: 'BARRACÃO' }))
      .toBe('Há registro lançado depois deste no depósito BARRACÃO. Exclua primeiro o mais recente: o lançamento no cocho nº 9. Nada foi alterado.');
  });
});
