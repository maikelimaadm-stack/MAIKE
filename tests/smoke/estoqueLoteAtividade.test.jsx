/**
 * D-PROD-282 em todas as telas — a linha de PRODUTO da atividade (janela da linha, "Repetir", registro de campo e os
 * "Jatos de hoje", que usam os mesmos campos e as mesmas regras): produto com lote mostra o campo "Lote" (sugestão
 * FEFO, escolher e dividir, vencido pede confirmação), o corpo leva `lotes` só com a escolha manual, a validação recusa
 * o vencido sem confirmação, a edição manda `lotes` só quando a escolha mudou e "Repetir o jato anterior" não copia a
 * escolha. Produto sem lote: nada muda. Os avisos do campo (vencido, erro) não "esquecem" o envio pendente: vão pelo
 * `marcar`, não pelo `mudar`.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LOTES = vi.hoisted(() => ({
  unidade: 'KG', controla_lote: true, controla_validade: true, hoje: '2027-06-15', dias_aviso: 30,
  lotes: [
    { id: 'cV', lote_fabricante: 'VELHO', data_validade: '2027-06-01', quantidade_disponivel: '5.0000', custo_unitario: '3.0000', vencido: true, vence_em_dias: -14 },
    { id: 'cA', lote_fabricante: 'A', data_validade: '2027-12-31', quantidade_disponivel: '100.0000', custo_unitario: '4.0000', vencido: false, vence_em_dias: 199 },
  ],
}));
const lerLotes = vi.hoisted(() => vi.fn(async () => LOTES));
vi.mock('@/services/estoqueConsultaService', () => ({ listarLotesDisponiveis: lerLotes }));
vi.mock('@/hooks/useLancamentoAtividadesSessao', async (importOriginal) => ({ ...(await importOriginal()), useEmpresaRealSelecionadaId: () => 'emp-1' }));

import { CamposDaLinhaProduto } from '@/components/lancamento-atividades/JanelasDaLinha';
import { camposAlteradosDaLinha, corpoDaLinhaProduto, formularioDaLinhaProduto, produtoEscolhido, validarLinhaProduto } from '@/lib/atividadeLinhasRegras';
import { repetirUltimoJato } from '@/lib/jatosRegras';
import { CAMPOS_DA_LINHA_PRODUTO, CAMPOS_DA_LINHA_PRODUTO_DO_LANCAMENTO } from '@/apis/atividades/lancamentoAtividadePort';

afterEach(() => cleanup());

const PRODUTO = { id: 'p1', rotulo: 'Herbicida', unidade_principal_estoque: 'KG', controla_lote: true };
const SALDO = {
  consulta: { isError: false, isLoading: false, isSuccess: true, refetch: () => {} },
  locais: [{ local_estoque_id: 'l1', local_nome: 'Galpão', disponivel: '105.0000' }],
  escolhido: { local_estoque_id: 'l1', local_nome: 'Galpão', disponivel: '105.0000' },
  unidade: 'KG',
  disponivel: '105.0000',
};

/** Os campos com o formulário no pai, como na janela (o `mudar` esquece o envio; o `marcar`, não). */
function Linha({ inicial, aoMudar, aoMarcar }) {
  const [form, setForm] = useState(inicial);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div className="grid grid-cols-12">
        <CamposDaLinhaProduto
          form={form}
          mudar={(m) => { aoMudar?.(m); setForm((f) => ({ ...f, ...m })); }}
          marcar={(m) => { aoMarcar?.(m); setForm((f) => ({ ...f, ...m })); }}
          erros={validarLinhaProduto(form, { disponivel: SALDO.disponivel }).erros}
          aviso={null}
          saldo={SALDO}
          atividadeId="a1"
          areaDoDia="10"
          bloqueado={false}
          prefixo="linha-produto"
        />
      </div>
      <output data-testid="corpo">{JSON.stringify(corpoDaLinhaProduto(form))}</output>
      <output data-testid="erro-lotes">{validarLinhaProduto(form, { disponivel: SALDO.disponivel }).erros.lotes ?? ''}</output>
    </QueryClientProvider>
  );
}
const corpo = () => JSON.parse(screen.getByTestId('corpo').textContent);

describe('D-PROD-282 — lote na linha de produto da atividade', () => {
  it('produto sem lote: nenhum campo, nenhuma leitura; o corpo é o de sempre', () => {
    render(<Linha inicial={{ produto: { ...PRODUTO, controla_lote: false }, local_estoque_id: 'l1', quantidade: '10', observacao: '' }} />);
    expect(screen.queryByTestId('linha-produto-lotes')).toBeNull();
    expect(lerLotes).not.toHaveBeenCalled();
    expect(corpo()).toEqual({ produto_id: 'p1', local_estoque_id: 'l1', quantidade: '10', observacao: null });
  });

  it('produto com lote: sugestão FEFO; vencido sem confirmação recusa; escolher o A manda `lotes`; avisos do campo vão pelo `marcar`', async () => {
    const mudancas = [];
    const marcas = [];
    render(<Linha inicial={{ produto: PRODUTO, local_estoque_id: 'l1', quantidade: '10', observacao: '' }} aoMudar={(m) => mudancas.push(m)} aoMarcar={(m) => marcas.push(m)} />);
    expect((await screen.findByTestId('linha-produto-lotes-sugestao')).textContent).toContain('VELHO');
    await waitFor(() => expect(screen.getByTestId('erro-lotes').textContent).toBe('Confirme o uso do lote vencido.'));
    expect(marcas.some((m) => m.loteVencido === true)).toBe(true);
    expect(mudancas).toEqual([]);
    expect('lotes' in corpo()).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId('linha-produto-lotes-alternar')); });
    await act(async () => { fireEvent.change(screen.getByTestId('linha-produto-lotes-qtd-cV'), { target: { value: '' } }); });
    await act(async () => { fireEvent.change(screen.getByTestId('linha-produto-lotes-qtd-cA'), { target: { value: '10' } }); });
    await waitFor(() => expect(screen.getByTestId('erro-lotes').textContent).toBe(''));
    expect(corpo().lotes).toEqual([{ estoque_lote_nota_id: 'cA', quantidade: '10' }]);
    expect(mudancas.length).toBeGreaterThan(0);
  });

  it('edição: sem trocar produto, local nem quantidade, a linha mantém os lotes (sem sugestão nem aviso de vencido)', async () => {
    const linha = { id: 'lin-1', produto_id: 'p1', produto: { id: 'p1', nome: 'Herbicida', controla_lote: true }, unidade: 'KG', local_estoque_id: 'l1', quantidade: '10.0000', observacao: null, fatias: [{ lote_id: 'cA', quantidade: '10.0000' }] };
    const form = formularioDaLinhaProduto(linha);
    expect(form.produto.controla_lote).toBe(true);
    render(<Linha inicial={form} />);
    expect((await screen.findByTestId('linha-produto-lotes-mantidos')).textContent).toContain('mesmos lotes');
    expect(screen.queryByTestId('linha-produto-lotes-vencido')).toBeNull();
    expect(screen.getByTestId('erro-lotes').textContent).toBe('');
  });

  it('regras: produto escolhido leva o controle; edição manda `lotes` só quando a escolha mudou; "Repetir o jato" não copia a escolha; a porta deixa passar `lotes`', () => {
    expect(produtoEscolhido({ id: 'p1', nome: 'Herbicida', unidade: 'KG', controla_lote: true }).controla_lote).toBe(true);
    expect('controla_lote' in produtoEscolhido({ id: 'p2', nome: 'Sal', unidade: 'KG', controla_lote: false })).toBe(false);
    const linha = { produto_id: 'p1', local_estoque_id: 'l1', quantidade: '10.0000', observacao: null, fatias: [{ lote_id: 'cA', quantidade: '10.0000' }] };
    expect(camposAlteradosDaLinha(linha, { produto_id: 'p1', local_estoque_id: 'l1', quantidade: '10', observacao: null, lotes: [{ estoque_lote_nota_id: 'cA', quantidade: '10' }] })).toEqual({});
    expect(camposAlteradosDaLinha(linha, { produto_id: 'p1', local_estoque_id: 'l1', quantidade: '10', observacao: null, lotes: [{ estoque_lote_nota_id: 'cB', quantidade: '10' }] }))
      .toEqual({ lotes: [{ estoque_lote_nota_id: 'cB', quantidade: '10' }] });
    const jatos = repetirUltimoJato([{ chave: 'k1', form: { produto: PRODUTO, local_estoque_id: 'l1', quantidade: '10', jato: 1, lotes: [{ id: 'cA', quantidade: '10' }], confirmaVencido: true } }], () => 'k2');
    expect(jatos[0].form).toMatchObject({ jato: 2, lotes: null, confirmaVencido: false });
    expect(CAMPOS_DA_LINHA_PRODUTO).toContain('lotes');
    expect(CAMPOS_DA_LINHA_PRODUTO_DO_LANCAMENTO).toContain('lotes');
  });
});
