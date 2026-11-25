/**
 * D-PROD-282 em todas as telas — o abastecimento do estoque com combustível que controla lote: o campo "Lote"
 * (sugestão FEFO, escolher e dividir, vencido pede confirmação) aparece depois do local; a validação recusa o vencido
 * sem confirmação; o corpo da prévia e da confirmação leva `lotes` só com a escolha manual (e nunca no posto externo);
 * a escolha entra na assinatura (mudou depois da revisão → revisar de novo); a porta deixa passar `lotes`. Produto sem
 * lote: nada muda. Formulário REAL; os services de leitura são de mentira.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LOTES = vi.hoisted(() => ({
  unidade: 'L', controla_lote: true, controla_validade: true, hoje: '2027-06-15', dias_aviso: 30,
  lotes: [
    { id: 'cV', lote_fabricante: 'VELHO', data_validade: '2027-06-01', quantidade_disponivel: '100.0000', custo_unitario: '4.0000', vencido: true, vence_em_dias: -14 },
    { id: 'cN', lote_fabricante: 'NOVO', data_validade: '2027-12-31', quantidade_disponivel: '200.0000', custo_unitario: '6.0000', vencido: false, vence_em_dias: 199 },
  ],
}));
const estado = vi.hoisted(() => ({ controlaLote: true }));
const lerLotes = vi.hoisted(() => vi.fn(async () => LOTES));
vi.mock('@/services/estoqueConsultaService', () => ({ listarLotesDisponiveis: lerLotes }));
vi.mock('@/hooks/usePatrimonioSessao', async (importOriginal) => ({ ...(await importOriginal()), useAcoesTelaPatrimonio: () => ({ ver: false }) }));
vi.mock('@/services/abastecimentoService', async (importOriginal) => ({
  ...(await importOriginal()),
  listarProdutosDoBem: vi.fn(async (_e, bemId) => ({
    bem: { id: bemId, leitura_vigente: null },
    itens: [{ id: 'd1', produto: { id: 'd1', nome: 'Diesel S10', unidade_principal_estoque: 'L', unidade_abastecimento: 'L', controla_lote: estado.controlaLote }, tanques: [{ id: 't1', identificador: 'Tanque', capacidade_litros: '180.0000' }], pronto: true }],
    has_more: false, next_cursor: null, resumo: { total: 1 },
  })),
  listarOpcoesAbastecimento: vi.fn(async (recurso) => (recurso === 'locais' ? { itens: [{ local_estoque_id: 'l1', local_nome: 'Tanque da sede', disponivel: '300.0000' }] } : { itens: [] })),
}));

import FormularioAbastecimento from '@/components/patrimonio/FormularioAbastecimento';
import { assinaturaDoFormulario, montarCorpoPrevia, validarFormulario } from '@/lib/abastecimentoRegras';
import { confirmarAbastecimento as confirmarApi } from '@/apis/patrimonio/patrimonioApi';

afterEach(() => cleanup());

const BEM = { id: 'b1', nome: 'Trator', codigo_frota: 'TP-02', natureza: 'MAQUINA', medidor: { tipo: 'SEM_MEDIDOR' } };
const FORM = { bem: BEM, produto: null, tanque_id: null, local_estoque_id: null, data_operacional: '2027-06-10', quantidade: '50', medidor_leitura: '', tanque_cheio: false, observacao: '', referencia_externa: '' };

function Tela({ aoMudar }) {
  const [form, setFormBruto] = useState(FORM);
  // Estável, como o `setForm` da tela (useState): os efeitos do formulário dependem dele.
  const setForm = React.useCallback((f) => setFormBruto((atual) => {
    const novo = f(atual);
    aoMudar?.(novo);
    return novo;
  }), []);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FormularioAbastecimento empresaId="emp-1" form={form} setForm={setForm} hoje="2027-06-15" erros={validarFormulario(form).erros} limparErro={() => {}} previando={false} situacaoPrevia="nenhuma" onPrevia={() => {}} onReabrirPrevia={() => {}} />
    </QueryClientProvider>
  );
}

describe('D-PROD-282 — lote no abastecimento', () => {
  it('produto sem lote: sem campo e sem leitura dos lotes; o corpo é o de sempre', async () => {
    estado.controlaLote = false;
    let ultimo = null;
    render(<Tela aoMudar={(f) => { ultimo = f; }} />);
    await screen.findByTestId('abastecimento-local-auto');
    expect(screen.queryByTestId('abastecimento-lotes')).toBeNull();
    expect(lerLotes).not.toHaveBeenCalled();
    expect('lotes' in montarCorpoPrevia('emp-1', ultimo)).toBe(false);
    estado.controlaLote = true;
  });

  it('com lote: sugestão FEFO; vencido sem confirmação recusa; escolher 30 NOVO + 20 VELHO manda `lotes` e muda a assinatura', async () => {
    let ultimo = null;
    render(<Tela aoMudar={(f) => { ultimo = f; }} />);
    expect((await screen.findByTestId('abastecimento-lotes-sugestao')).textContent).toContain('VELHO');
    await waitFor(() => expect(validarFormulario(ultimo).erros.lotes).toBe('Confirme o uso do lote vencido.'));
    const antes = assinaturaDoFormulario(ultimo);
    await act(async () => { fireEvent.click(screen.getByTestId('abastecimento-lotes-alternar')); });
    await act(async () => { fireEvent.change(screen.getByTestId('abastecimento-lotes-qtd-cV'), { target: { value: '20' } }); });
    await act(async () => { fireEvent.change(screen.getByTestId('abastecimento-lotes-qtd-cN'), { target: { value: '30' } }); });
    await act(async () => { fireEvent.click(screen.getByTestId('abastecimento-lotes-confirma-vencido')); });
    await waitFor(() => expect(validarFormulario(ultimo).erros.lotes).toBeUndefined());
    const corpo = montarCorpoPrevia('emp-1', ultimo);
    expect(corpo.lotes).toEqual([{ estoque_lote_nota_id: 'cV', quantidade: '20' }, { estoque_lote_nota_id: 'cN', quantidade: '30' }]);
    expect(assinaturaDoFormulario(ultimo)).not.toBe(antes);
    // Posto externo: nunca leva lotes.
    expect('lotes' in montarCorpoPrevia('emp-1', { ...ultimo, origem: 'EXTERNO', custo_total: '100' })).toBe(false);
  });

  it('a porta deixa passar `lotes` na confirmação (formato fechado)', async () => {
    const base = {
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 't1', produto_id: 'd1', local_estoque_id: 'l1', data_operacional: '2027-06-10', quantidade: '50',
      medidor_leitura: null, tanque_cheio: false, observacao: null, referencia_externa: null, operation_id: 'op-12345678',
    };
    const errado = await confirmarApi({ ...base, lotes: 'x' }).catch((e) => e);
    expect([errado?.code, errado?.details?.campo]).toEqual(['API_INVALID_ARGUMENT', 'lotes']);
    // Com a lista no formato certo, a validação local passa (a rede é que falha aqui, nunca o INVALID_ARGUMENT).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('sem rede no teste'); }));
    const r = await confirmarApi({ ...base, lotes: [{ estoque_lote_nota_id: 'cN', quantidade: '50' }] }).catch((e) => e);
    expect(r?.code).not.toBe('API_INVALID_ARGUMENT');
    // Posto externo com a lista: recusa local.
    const externo = { ...base, origem: 'EXTERNO', custo_total: '100', lotes: [{ estoque_lote_nota_id: 'cN', quantidade: '50' }] };
    delete externo.local_estoque_id;
    expect((await confirmarApi(externo).catch((e) => e))?.details?.campo).toBe('lotes');
  });
});
