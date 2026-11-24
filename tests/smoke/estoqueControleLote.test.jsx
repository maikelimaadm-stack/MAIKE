/**
 * D-PROD-281 — telas do controle de lote: o campo "Lote" da saída/transferência (sugestão FEFO, escolher e dividir,
 * aviso de vencido com confirmação), o detalhe por lote do Saldo e as regras puras do formulário (lote/validade
 * obrigatórios na entrada; corpo `lotes` só com escolha manual). Mock só do service de leitura dos lotes.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LOTES = vi.hoisted(() => ({
  unidade: 'KG', controla_lote: true, controla_validade: true, hoje: '2027-06-15', dias_aviso: 30,
  lotes: [
    { id: 'cV', lote_fabricante: 'VELHO', data_validade: '2027-06-01', quantidade_disponivel: '5.0000', custo_unitario: '3.0000', vencido: true, vence_em_dias: -14 },
    { id: 'cB', lote_fabricante: 'B', data_validade: '2027-07-01', quantidade_disponivel: '50.0000', custo_unitario: '6.0000', vencido: false, vence_em_dias: 16 },
    { id: 'cA', lote_fabricante: 'A', data_validade: '2027-12-31', quantidade_disponivel: '100.0000', custo_unitario: '4.0000', vencido: false, vence_em_dias: 199 },
  ],
}));
vi.mock('@/services/estoqueConsultaService', () => ({ listarLotesDisponiveis: vi.fn(async () => LOTES) }));
vi.mock('@/components/common/MobileSheet', () => ({ useCelular: () => true }));

import CampoLotesSaida from '@/components/estoque/CampoLotesSaida';
import JanelaLotesSaldo from '@/components/estoque/JanelaLotesSaldo';
import { corpoDosLotes, sugestaoFefo, avisoDoLote } from '@/lib/estoqueLotesRegras';
import { montarCorpoSaida, validarFormularioSaida } from '@/lib/estoqueSaidasRegras';
import { validarFormularioEntrada } from '@/lib/estoqueEntradasRegras';

afterEach(() => cleanup());

const comQuery = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const PRODUTO = { id: 'p1', rotulo: 'Vermífugo', unidade_estoque: 'KG', peso_por_saco_kg: null, controla_lote: true, controla_validade: true };

/** Linha controlada (o estado vive no pai, como no formulário). */
function Linha({ inicial, aoMudar }) {
  const [linha, setLinha] = useState(inicial);
  return (
    <CampoLotesSaida
      empresaId="emp-1"
      linha={linha}
      onMudar={(patch) => setLinha((l) => {
        const nova = { ...l, ...patch };
        aoMudar?.(nova);
        return nova;
      })}
      testId="lotes"
    />
  );
}

describe('D-PROD-281 — campo "Lote" da saída', () => {
  it('sugere o que vence primeiro (o vencido entra), avisa "Lote vencido em 01/06" e pede confirmação; escolher e dividir monta o corpo', async () => {
    let ultima = null;
    comQuery(<Linha inicial={{ produto: PRODUTO, deposito: { id: 'l1' }, unidade: 'KG', quantidade: '20', lotes: null }} aoMudar={(l) => { ultima = l; }} />);
    const sugestao = await screen.findByTestId('lotes-sugestao');
    expect(sugestao.textContent).toContain('VELHO');
    expect(sugestao.textContent).toContain('B');
    expect((await screen.findByTestId('lotes-vencido')).textContent).toContain('Lote vencido em 01/06');
    await waitFor(() => expect(ultima?.loteVencido).toBe(true));
    // Sem confirmar, o formulário recusa.
    const form = { motivo: { id: 'm' }, data_saida: '2027-06-15', itens: [ultima] };
    expect(validarFormularioSaida(form, '2027-06-15').erros['itens.0.lotes']).toBe('Confirme o uso do lote vencido.');
    fireEvent.click(screen.getByTestId('lotes-confirma-vencido'));
    await waitFor(() => expect(ultima.confirmaVencido).toBe(true));
    expect(validarFormularioSaida({ ...form, itens: [ultima] }, '2027-06-15').erros['itens.0.lotes']).toBeUndefined();
    // Sem escolha manual, o corpo não leva `lotes` (o servidor aplica o FEFO).
    expect(corpoDosLotes(ultima)).toEqual({});

    // Escolher lotes: começa da sugestão; troca para 10 do A + 10 do B.
    fireEvent.click(screen.getByTestId('lotes-alternar'));
    await screen.findByTestId('lotes-manual');
    fireEvent.change(screen.getByTestId('lotes-qtd-cV'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('lotes-qtd-cB'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('lotes-qtd-cA'), { target: { value: '10' } });
    await waitFor(() => expect(ultima.erroLote).toBe(''));
    expect(ultima.loteVencido).toBe(false);
    const corpo = montarCorpoSaida('emp-1', { motivo: { id: 'm' }, data_saida: '2027-06-15', observacao: '', itens: [ultima] }, 'op-1');
    expect(corpo.itens[0].lotes).toEqual([{ estoque_lote_nota_id: 'cB', quantidade: '10' }, { estoque_lote_nota_id: 'cA', quantidade: '10' }]);
    // Soma diferente da linha: erro na própria linha.
    fireEvent.change(screen.getByTestId('lotes-qtd-cA'), { target: { value: '5' } });
    expect((await screen.findByTestId('lotes-erro')).textContent).toContain('A soma dos lotes tem de ser a quantidade da linha.');
  });

  it('produto sem lote: o campo não aparece; sem depósito, pede o depósito', () => {
    comQuery(<Linha inicial={{ produto: { ...PRODUTO, controla_lote: false }, deposito: { id: 'l1' }, unidade: 'KG', quantidade: '5', lotes: null }} />);
    expect(screen.queryByTestId('lotes')).toBeNull();
    cleanup();
    comQuery(<Linha inicial={{ produto: PRODUTO, deposito: null, unidade: 'KG', quantidade: '5', lotes: null }} />);
    expect(screen.getByTestId('lotes-sem-deposito').textContent).toContain('Escolha o depósito');
  });
});

describe('D-PROD-281 — Saldo por lote e regras puras', () => {
  it('a janela do Saldo lista lote, validade, saldo e custo e avisa vencido e "Vence em 16 dias" (tela cheia no celular)', async () => {
    comQuery(<JanelaLotesSaldo empresaId="emp-1" alvo={{ produto_id: 'p1', produto_nome: 'Vermífugo', local_estoque_id: 'l1', local_estoque_nome: 'Farmácia' }} onFechar={() => {}} />);
    expect((await screen.findByTestId('lote-saldo-aviso-cV')).textContent).toBe('Lote vencido em 01/06');
    expect(screen.getByTestId('lote-saldo-aviso-cB').textContent).toBe('Vence em 16 dias');
    expect(screen.queryByTestId('lote-saldo-aviso-cA')).toBeNull();
    expect(screen.getByTestId('lote-saldo-cA').textContent).toContain('31/12/2027');
  });

  it('FEFO puro, aviso e entrada com lote/validade obrigatórios conforme o produto', () => {
    expect(sugestaoFefo(LOTES.lotes, 60).fatias).toEqual([{ id: 'cV', quantidade: 5 }, { id: 'cB', quantidade: 50 }, { id: 'cA', quantidade: 5 }]);
    expect(sugestaoFefo(LOTES.lotes, 500).suficiente).toBe(false);
    expect(avisoDoLote({ data_validade: '2027-07-10', vencido: false, vence_em_dias: 0 })).toBe('Vence hoje');
    const linha = { produto: PRODUTO, deposito: { id: 'l1' }, unidade: 'KG', quantidade: '10', custo: '4', custo_zero: false, lote: '', validade: '' };
    const { erros } = validarFormularioEntrada({ motivo: { id: 'm' }, data_entrada: '2027-06-15', itens: [linha] }, '2027-06-15');
    expect(erros['itens.0.lote']).toBe('Este produto controla lote: informe o lote.');
    expect(erros['itens.0.validade']).toBe('Este produto controla validade: informe a validade.');
    const semLote = validarFormularioEntrada({ motivo: { id: 'm' }, data_entrada: '2027-06-15', itens: [{ ...linha, produto: { ...PRODUTO, controla_lote: false, controla_validade: false } }] }, '2027-06-15');
    expect(semLote.ok).toBe(true);
  });
});

describe('D-PROD-281 (revisão) — recusa do estorno com o controle de lote trocado', () => {
  it('mensagem clara nos dois sentidos, pela mesma função de erro das telas', async () => {
    const { mensagemErroGestao } = await import('@/lib/gestaoErros');
    const erro = (reason) => ({ code: 'ESTOQUE_ESTORNO_MODO_LOTE_DIVERGENTE', details: { field: 'movimento_id', reason } });
    expect(mensagemErroGestao(erro('movimento_sem_lote'), 'x')).toMatch(/não controlava lote, e agora o produto controla.*Nada foi alterado\./);
    expect(mensagemErroGestao(erro('movimento_com_lote'), 'x')).toMatch(/controlava lote, e o produto não controla mais.*Nada foi alterado\./);
  });
});
