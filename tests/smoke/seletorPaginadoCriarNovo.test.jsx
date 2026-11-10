/**
 * D-PROD-161 (MAIKE-PATRIMONIO-SIMPLIFICA-01, §5.2) — `SeletorPaginadoGestao`
 * ganha as props OPCIONAIS `onCriarNovo(busca)` e `rotuloCriarNovo` (o "+ Nova
 * família"/"+ Novo tipo" do cadastro de Bens).
 *
 *  - NÃO REGRESSÃO: sem `onCriarNovo`, a renderização é IDÊNTICA à de antes da
 *    missão (a Central de Lançamentos da P3 usa este componente). Os snapshots
 *    em linha abaixo foram gravados com o componente da `main` (`e39d318b`),
 *    ANTES da mudança, e não podem ser regravados;
 *  - com `onCriarNovo`: o painel aberto mostra o botão com o rótulo, que chama
 *    `onCriarNovo` com o texto da busca (aparado) e fecha o painel; sem rótulo,
 *    "+ Cadastrar novo"; bloqueado/só leitura não abre o painel (nem o botão).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SeletorPaginadoGestao from '@/components/financeiroGestao/SeletorPaginadoGestao';

afterEach(() => cleanup());

const OPCOES = [
  { id: 'p1', nome: 'Diesel S10', numero: '7' },
  { id: 'p2', nome: 'Ração inicial' },
];

const buscarFake = () => vi.fn(async () => ({ itens: OPCOES, has_more: false, next_cursor: null }));

/** @param {Record<string, any>} props */
const montar = (props) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <div className="grid grid-cols-12">
        <SeletorPaginadoGestao
          rotulo="Produto"
          testId="seletor-teste"
          chave={['teste', 'produtos']}
          value={null}
          onChange={() => {}}
          detalheDaOpcao={(o) => (o.id === 'p1' ? 'L' : null)}
          {...props}
        />
      </div>
    </QueryClientProvider>,
  );
};

const abrir = async () => {
  fireEvent.click(screen.getByTestId('seletor-teste'));
  await screen.findByRole('option', { name: /Diesel S10/ });
};

describe('SeletorPaginadoGestao — sem onCriarNovo a renderização é a de hoje (P3)', () => {
  it('fechado: markup idêntico ao da main', () => {
    const { container } = montar({ buscar: buscarFake() });
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="grid grid-cols-12"><div class="col-span-12 md:col-span-6"><div class="mg-field mg-has-value"><label for=":r0:" class="mg-field__label">Produto</label><div class="mg-field__control"><button type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Produto" data-testid="seletor-teste" class="h-5 w-full rounded-none border-0 bg-transparent px-0 text-[13px] font-medium uppercase text-[var(--mg-text-1)] shadow-none focus:ring-0 focus:outline-none read-only:bg-transparent disabled:bg-transparent disabled:text-[var(--mg-text-1)] b1-select-btn text-left" id=":r0:"><span class="b1-select-btn__v truncate normal-case text-[var(--mg-text-3,#94a3b8)]">— Escolha —</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down b1-select-btn__c" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div></div></div></div>"`);
  });

  it('aberto, com opções: markup idêntico ao da main (nenhum botão de criar)', async () => {
    const { container } = montar({ buscar: buscarFake() });
    await abrir();
    await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
    expect(screen.queryByRole('button', { name: /Cadastrar novo|Nova|Novo/ })).toBeNull();
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="grid grid-cols-12"><div class="col-span-12 md:col-span-6"><div class="mg-field mg-has-value is-open"><label for=":r1:" class="mg-field__label">Produto</label><div class="mg-field__control"><button type="button" aria-haspopup="listbox" aria-expanded="true" aria-label="Produto" data-testid="seletor-teste" class="h-5 w-full rounded-none border-0 bg-transparent px-0 text-[13px] font-medium uppercase text-[var(--mg-text-1)] shadow-none focus:ring-0 focus:outline-none read-only:bg-transparent disabled:bg-transparent disabled:text-[var(--mg-text-1)] b1-select-btn text-left" id=":r1:" aria-controls="seletor-teste-lista"><span class="b1-select-btn__v truncate normal-case text-[var(--mg-text-3,#94a3b8)]">— Escolha —</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down b1-select-btn__c" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div></div></div><div class="col-span-12 min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2" data-testid="seletor-teste-painel"><div class="flex items-center gap-2 rounded border border-[var(--mg-divider,#cbd5e1)] px-2"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search shrink-0 text-[var(--mg-text-3,#94a3b8)]" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><input type="search" aria-label="Buscar produto" placeholder="Buscar por nome ou código…" class="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none" autocomplete="off" maxlength="120" value=""><button type="button" aria-label="Fechar seleção de produto" class="inline-flex h-10 w-10 shrink-0 items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><ul id="seletor-teste-lista" role="listbox" aria-label="Opções de produto" class="mt-2 max-h-64 overflow-y-auto"><li><button type="button" role="option" aria-selected="false" class="min-h-10 w-full rounded px-2 py-2 text-left text-[13px] hover:bg-slate-50 uppercase" title="Diesel S10"><span class="mr-2 font-mono text-[var(--mg-text-3,#94a3b8)]">7</span><span class="break-words">Diesel S10</span><span class="ml-2 normal-case text-[11px] text-[var(--mg-text-2,#475569)]">L</span></button></li><li><button type="button" role="option" aria-selected="false" class="min-h-10 w-full rounded px-2 py-2 text-left text-[13px] hover:bg-slate-50 uppercase" title="Ração inicial"><span class="break-words">Ração inicial</span></button></li></ul></div></div>"`);
  });
});

describe('SeletorPaginadoGestao — onCriarNovo (D-PROD-161)', () => {
  it('o painel mostra "+ <rótulo>"; o clique chama onCriarNovo com a busca aparada e fecha o painel', async () => {
    const onCriarNovo = vi.fn();
    montar({ buscar: buscarFake(), onCriarNovo, rotuloCriarNovo: 'Nova família' });
    await abrir();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar produto' }), { target: { value: '  Pivô central ' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Nova família' }));
    expect(onCriarNovo).toHaveBeenCalledTimes(1);
    expect(onCriarNovo).toHaveBeenCalledWith('Pivô central');
    await waitFor(() => expect(screen.queryByTestId('seletor-teste-painel')).toBeNull());
  });

  it('sem rótulo: "+ Cadastrar novo"; com a lista vazia o botão continua lá', async () => {
    const onCriarNovo = vi.fn();
    const buscar = vi.fn(async () => ({ itens: [], has_more: false, next_cursor: null }));
    montar({ buscar, onCriarNovo });
    fireEvent.click(screen.getByTestId('seletor-teste'));
    await screen.findByText('Nenhuma opção ativa disponível.');
    fireEvent.click(screen.getByRole('button', { name: '+ Cadastrar novo' }));
    expect(onCriarNovo).toHaveBeenCalledWith('');
  });

  it('bloqueado (motivo) ou só leitura: o painel não abre, então não há botão de criar', async () => {
    const onCriarNovo = vi.fn();
    const { unmount } = montar({ buscar: buscarFake(), onCriarNovo, rotuloCriarNovo: 'Novo tipo', bloqueadoMotivo: 'Escolha a família primeiro' });
    fireEvent.click(screen.getByTestId('seletor-teste'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByRole('button', { name: '+ Novo tipo' })).toBeNull();
    unmount();
    montar({ buscar: buscarFake(), onCriarNovo, rotuloCriarNovo: 'Novo tipo', readOnly: true });
    fireEvent.click(screen.getByTestId('seletor-teste'));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByRole('button', { name: '+ Novo tipo' })).toBeNull();
    expect(onCriarNovo).not.toHaveBeenCalled();
  });
});
