/**
 * D-PROD-282 em todas as telas — o campo "Lote" reutilizável (`CampoLotes`): recebe produto, depósito, quantidade
 * (na unidade de estoque) e a escolha, sem depender do formato da linha do Estoque. As regras puras novas
 * (`erroDaEscolha`, `usaLoteVencidoNaEscolha`, `corpoDaEscolha`) são as mesmas da Saída, com a quantidade explícita.
 * Mock só do service de leitura dos lotes.
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
const leitura = vi.hoisted(() => ({ listarLotesDisponiveis: null }));
vi.mock('@/services/estoqueConsultaService', () => {
  const fn = vi.fn(async () => LOTES);
  leitura.listarLotesDisponiveis = fn;
  return { listarLotesDisponiveis: fn };
});

import CampoLotes, { comDevolvidos } from '@/components/estoque/CampoLotes';
import { corpoDaEscolha, erroDaEscolha, usaLoteVencidoNaEscolha } from '@/lib/estoqueLotesRegras';

afterEach(() => cleanup());

const comQuery = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const PRODUTO = { id: 'p1', controla_lote: true, controla_validade: true };

/** Estado controlado pelo pai, como nas telas (cocho, financeiro, atividade, abastecimento). */
function Campo({ produto = PRODUTO, localId = 'l1', quantidade = 20, aoMudar, devolvidos = null }) {
  const [estado, setEstado] = useState({ lotes: null, confirmaVencido: false, loteVencido: false, erroLote: '' });
  return (
    <CampoLotes
      empresaId="emp-1"
      produto={produto}
      localId={localId}
      quantidade={quantidade}
      lotes={estado.lotes}
      confirmaVencido={estado.confirmaVencido}
      loteVencido={estado.loteVencido}
      erroLote={estado.erroLote}
      onMudar={(patch) => setEstado((e) => {
        const novo = { ...e, ...patch };
        aoMudar?.(novo);
        return novo;
      })}
      testId="campo"
      devolvidos={devolvidos}
    />
  );
}

describe('CampoLotes — o campo "Lote" de qualquer tela que tira produto do estoque', () => {
  it('produto sem lote: nada aparece e nada é lido', () => {
    comQuery(<Campo produto={{ id: 'p2', controla_lote: false }} />);
    expect(screen.queryByTestId('campo')).toBeNull();
    expect(leitura.listarLotesDisponiveis).not.toHaveBeenCalled();
  });

  it('sem depósito, pede o depósito', () => {
    comQuery(<Campo localId={null} />);
    expect(screen.getByTestId('campo-sem-deposito').textContent).toContain('depósito');
  });

  it('sugere FEFO, avisa o vencido e pede confirmação; "Escolher lotes" divide entre lotes; soma errada mostra o erro', async () => {
    let ultimo = null;
    comQuery(<Campo aoMudar={(e) => { ultimo = e; }} />);
    const sugestao = await screen.findByTestId('campo-sugestao');
    expect(sugestao.textContent).toContain('VELHO');
    expect((await screen.findByTestId('campo-vencido')).textContent).toContain('Lote vencido em 01/06');
    await waitFor(() => expect(ultimo?.loteVencido).toBe(true));
    fireEvent.click(screen.getByTestId('campo-confirma-vencido'));
    await waitFor(() => expect(ultimo.confirmaVencido).toBe(true));
    expect(corpoDaEscolha(ultimo.lotes)).toBeNull();

    fireEvent.click(screen.getByTestId('campo-alternar'));
    await screen.findByTestId('campo-manual');
    fireEvent.change(screen.getByTestId('campo-qtd-cV'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('campo-qtd-cB'), { target: { value: '12,5' } });
    fireEvent.change(screen.getByTestId('campo-qtd-cA'), { target: { value: '7,5' } });
    await waitFor(() => expect(ultimo.erroLote).toBe(''));
    expect(ultimo.loteVencido).toBe(false);
    expect(corpoDaEscolha(ultimo.lotes)).toEqual([{ estoque_lote_nota_id: 'cB', quantidade: '12.5' }, { estoque_lote_nota_id: 'cA', quantidade: '7.5' }]);

    fireEvent.change(screen.getByTestId('campo-qtd-cA'), { target: { value: '5' } });
    expect((await screen.findByTestId('campo-erro')).textContent).toContain('A soma dos lotes tem de ser a quantidade');
    await waitFor(() => expect(ultimo.erroLote).toContain('A soma'));
  });

  it('cabe em 390 px: lista empilhada, sem tabela, campo de quantidade com largura total no celular', async () => {
    comQuery(<Campo />);
    fireEvent.click(await screen.findByTestId('campo-alternar'));
    await screen.findByTestId('campo-manual');
    expect(screen.getByTestId('campo').querySelector('table')).toBeNull();
    expect(screen.getByTestId('campo-qtd-cB').className).toContain('w-full');
  });

  it('regras puras com a quantidade explícita (sem o formato da linha do Estoque)', () => {
    expect(erroDaEscolha(null, 20, LOTES.lotes)).toBe('');
    expect(erroDaEscolha(null, 500, LOTES.lotes)).toBe('Saldo dos lotes insuficiente neste depósito.');
    expect(erroDaEscolha([{ id: 'cB', quantidade: '10' }], 20, LOTES.lotes)).toBe('A soma dos lotes tem de ser a quantidade da linha.');
    expect(erroDaEscolha([{ id: 'cV', quantidade: '6' }, { id: 'cB', quantidade: '14' }], 20, LOTES.lotes)).toBe('O lote VELHO não tem essa quantidade.');
    expect(erroDaEscolha(null, 0, LOTES.lotes)).toBe('');
    expect(usaLoteVencidoNaEscolha(null, 3, LOTES.lotes)).toBe(true);
    expect(usaLoteVencidoNaEscolha([{ id: 'cA', quantidade: '3' }], 3, LOTES.lotes)).toBe(false);
    expect(corpoDaEscolha([{ id: 'cA', quantidade: '0' }, { id: 'cB', quantidade: '3' }])).toEqual([{ estoque_lote_nota_id: 'cB', quantidade: '3' }]);
    expect(corpoDaEscolha(undefined)).toBeNull();
  });
  it('sem a lista dos lotes (sem internet ou leitura com erro): não acusa saldo, avisa que sai do que vence primeiro', async () => {
    leitura.listarLotesDisponiveis.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    let ultimo = null;
    comQuery(<Campo produto={{ id: 'p-off', controla_lote: true }} aoMudar={(e) => { ultimo = e; }} />);
    expect((await screen.findByTestId('campo-sem-lista')).textContent).toContain('vence primeiro');
    expect(screen.queryByTestId('campo-erro')).toBeNull();
    expect(screen.queryByTestId('campo-vazio')).toBeNull();
    expect(ultimo?.erroLote ?? '').toBe('');
    expect(screen.getByTestId('campo-alternar').hasAttribute('disabled')).toBe(true);
  });

  it('edição: o que a própria linha baixou volta ao saldo de cada lote (o servidor estorna antes); lote esgotado volta à lista', async () => {
    const lista = [{ id: 'cA', lote_fabricante: 'A', data_validade: null, quantidade_disponivel: '2.0000', vencido: false }];
    const r = comDevolvidos(lista, [{ lote_id: 'cA', quantidade: '3.0000' }, { lote_id: 'cX', quantidade: '7.0000' }]);
    expect(r[0].quantidade_disponivel).toBe('5.0000');
    expect(r[1]).toMatchObject({ id: 'cX', quantidade_disponivel: '7.0000', _daLinha: true });
    expect(comDevolvidos(lista, null)).toBe(lista);
    // A linha gravou 10 do lote esgotado cX; reduzir para 9 não acusa saldo.
    leitura.listarLotesDisponiveis.mockResolvedValueOnce({ ...LOTES, lotes: [] });
    let ultimo = null;
    comQuery(<Campo produto={{ id: 'p-ed', controla_lote: true }} quantidade={9} devolvidos={[{ lote_id: 'cX', quantidade: '10.0000' }]} aoMudar={(e) => { ultimo = e; }} />);
    const sugestao = await screen.findByTestId('campo-sugestao');
    expect(sugestao.textContent).toContain('Lote já usado nesta linha');
    expect(screen.queryByTestId('campo-erro')).toBeNull();
    expect(ultimo?.erroLote ?? '').toBe('');
  });
});
