/**
 * D-PROD-282 em todas as telas — a confirmação do lançamento financeiro com produto que controla lote:
 *  - compra: "Lote do fabricante" (obrigatório) e "Validade" (obrigatória se o produto controla validade) por item;
 *    sem eles o botão não confirma; o corpo leva `lotes_por_item` (o servidor recusa a compra sem o lote);
 *  - venda: o campo "Lote" (sugestão FEFO, escolher e dividir, vencido pede confirmação) por item; `lotes` só com a
 *    escolha manual;
 *  - produto sem lote: nenhum campo e nenhum `lotes_por_item` (o corpo de sempre).
 * O diálogo é o REAL; só a leitura dos lotes é de mentira.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LOTES = vi.hoisted(() => ({
  unidade: 'KG', controla_lote: true, controla_validade: false, hoje: '2027-06-15', dias_aviso: 30,
  lotes: [
    { id: 'cV', lote_fabricante: 'VELHO', data_validade: '2027-06-01', quantidade_disponivel: '5.0000', custo_unitario: '3.0000', vencido: true, vence_em_dias: -14 },
    { id: 'cA', lote_fabricante: 'A', data_validade: '2027-12-31', quantidade_disponivel: '100.0000', custo_unitario: '4.0000', vencido: false, vence_em_dias: 199 },
  ],
}));
vi.mock('@/services/estoqueConsultaService', () => ({ listarLotesDisponiveis: vi.fn(async () => LOTES) }));
const confirmarApi = vi.hoisted(() => vi.fn());
vi.mock('@/apis/operacoes-financeiras', async (importOriginal) => ({ ...(await importOriginal()), confirmarOperacaoFinanceira: confirmarApi }));

import { DialogoConfirmacao } from '@/components/financeiroGestao/DialogosLancamento';
import { lotesDaConfirmacao } from '@/lib/estoqueLotesRegras';

afterEach(() => cleanup());

const PERFIL = { locale: 'pt-BR', moeda: 'BRL', moeda_casas: 2, metodos_permitidos: ['PIX'] };
const efeito = (ordem, produto, kg, extra = {}) => ({
  item_ordem: ordem, produto_id: produto, produto_nome: `Produto ${produto}`, local_estoque_id: 'l1', local_nome: 'Farmácia', kg, ...extra,
});
const abrir = ({ direcao, efeitos, onConfirmar = vi.fn(async () => ({})) }) => {
  const registro = { id: 'op1', numero: 7, empresa_id: 'emp-1', direcao, conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', versao: 1, valor_total: '100.00', itens: [] };
  const plano = {
    valor_total: '100.00', itens: [], parcelas: [{}],
    efeitos_estoque: direcao === 'PAGAR' ? { entradas: efeitos, saidas: [] } : { entradas: [], saidas: efeitos },
    resumo: { parcelas_n: 1, itens_estoque_n: efeitos.length, valor_titulos: '100.00' }, avisos: [],
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DialogoConfirmacao aberto registro={registro} previa={{ plano, bloqueios: [] }} perfil={PERFIL} hoje="2027-06-15" fusoConfigurado podeLiquidar={false} onFechar={() => {}} onConfirmar={onConfirmar} onConsultar={() => {}} />
    </QueryClientProvider>,
  );
  return { dialogo: screen.getByTestId('dialogo-confirmacao'), onConfirmar };
};
const clicar = async (el) => act(async () => { fireEvent.click(el); });
const digitar = async (el, valor) => act(async () => { fireEvent.change(el, { target: { value: valor } }); });

describe('D-PROD-282 — lote na confirmação do lançamento financeiro', () => {
  it('compra: lote e validade obrigatórios conforme o produto; o corpo leva lotes_por_item só dos itens com lote', async () => {
    const { dialogo, onConfirmar } = abrir({
      direcao: 'PAGAR',
      efeitos: [efeito(1, 'pV', '40.0000', { controla_lote: true, controla_validade: true }), efeito(2, 'pL', '10.0000', { controla_lote: true }), efeito(3, 'pS', '5.0000', { controla_lote: false })],
    });
    const botao = within(dialogo).getByTestId('botao-confirmar-definitivo');
    expect(within(dialogo).getByTestId('confirmacao-lote-1')).toBeTruthy();
    expect(within(dialogo).getByTestId('confirmacao-lote-2-validade')).toBeTruthy();
    expect(within(dialogo).queryByTestId('confirmacao-lote-3')).toBeNull();
    expect(botao).toBeDisabled();
    expect(within(dialogo).getByTestId('confirmacao-lotes-pendencia').textContent).toContain('informe o lote');
    await digitar(within(dialogo).getByTestId('confirmacao-lote-1-lote'), ' NF-77 ');
    await digitar(within(dialogo).getByTestId('confirmacao-lote-2-lote'), 'L-2');
    expect(botao).toBeDisabled();
    expect(within(dialogo).getByTestId('confirmacao-lotes-pendencia').textContent).toContain('informe a validade');
    await digitar(within(dialogo).getByTestId('confirmacao-lote-1-validade'), '2027-12-31');
    expect(botao).not.toBeDisabled();
    await clicar(botao);
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
    expect(onConfirmar.mock.calls[0][0].lotes_por_item).toEqual([
      { item_ordem: 1, lote_fabricante: 'NF-77', data_validade: '2027-12-31' },
      { item_ordem: 2, lote_fabricante: 'L-2' },
    ]);
  });

  it('venda: sugestão FEFO por item; vencido pede confirmação; escolher o A manda `lotes`', async () => {
    const { dialogo, onConfirmar } = abrir({ direcao: 'RECEBER', efeitos: [efeito(1, 'pV', '10.0000', { controla_lote: true })] });
    const campo = await within(dialogo).findByTestId('confirmacao-lote-1');
    expect((await within(campo).findByTestId('confirmacao-lote-1-sugestao')).textContent).toContain('VELHO');
    const botao = within(dialogo).getByTestId('botao-confirmar-definitivo');
    await waitFor(() => expect(botao).toBeDisabled());
    expect(within(dialogo).getByTestId('confirmacao-lotes-pendencia').textContent).toContain('Confirme o uso do lote vencido');
    await clicar(within(campo).getByTestId('confirmacao-lote-1-alternar'));
    await digitar(within(campo).getByTestId('confirmacao-lote-1-qtd-cV'), '');
    await digitar(within(campo).getByTestId('confirmacao-lote-1-qtd-cA'), '10');
    await waitFor(() => expect(botao).not.toBeDisabled());
    await clicar(botao);
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
    expect(onConfirmar.mock.calls[0][0].lotes_por_item).toEqual([{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: 'cA', quantidade: '10' }] }]);
  });

  it('produto sem lote: nenhum campo; o corpo é o de sempre (sem lotes_por_item)', async () => {
    const { dialogo, onConfirmar } = abrir({ direcao: 'RECEBER', efeitos: [efeito(1, 'pS', '5.0000', { controla_lote: false })] });
    expect(within(dialogo).queryByTestId('confirmacao-lotes')).toBeNull();
    await clicar(within(dialogo).getByTestId('botao-confirmar-definitivo'));
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
    expect('lotes_por_item' in onConfirmar.mock.calls[0][0]).toBe(false);
  });

  it('regra pura e service: lotes_por_item só com item de lote; confirmarLancamento manda só quando há', async () => {
    expect(lotesDaConfirmacao('PAGAR', [efeito(1, 'p', '1', { controla_lote: true })], {})).toEqual({ lotes_por_item: [], pendencia: 'Item 1: informe o lote do fabricante.' });
    expect(lotesDaConfirmacao('PAGAR', [efeito(1, 'p', '1', { controla_lote: true })], { 1: { lote: 'x'.repeat(65) } }).pendencia).toBe('Item 1: o lote tem no máximo 64 caracteres.');
    expect(lotesDaConfirmacao('RECEBER', [efeito(1, 'p', '1', { controla_lote: false })], {})).toEqual({ lotes_por_item: [], pendencia: '' });
    const { confirmarLancamento } = await import('@/services/operacaoFinanceiraService');
    confirmarApi.mockImplementation(async () => ({ id: 'op1', status: 'CONFIRMADO' }));
    await confirmarLancamento('emp-1', 'op1', { versao: 1, escopo: 't', storage: null, lotes_por_item: [{ item_ordem: 1, lote_fabricante: 'A' }] });
    expect(confirmarApi.mock.calls[0][1].lotes_por_item).toEqual([{ item_ordem: 1, lote_fabricante: 'A' }]);
    await confirmarLancamento('emp-1', 'op2', { versao: 1, escopo: 't', storage: null, lotes_por_item: [] });
    expect('lotes_por_item' in confirmarApi.mock.calls[1][1]).toBe(false);
  });
});
