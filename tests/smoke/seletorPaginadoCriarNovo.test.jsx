/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01, §5.2) — `SeletorPaginadoGestao`
 * ganha as props OPCIONAIS `onCriarNovo(busca)` e `rotuloCriarNovo` (o "+ Nova
 * família"/"+ Novo tipo" do cadastro de Bens).
 *
 *  - NÃO REGRESSÃO: sem `onCriarNovo`, a renderização é IDÊNTICA à do campo
 *    sem a ação de criar (a Central de Lançamentos da P3 usa este componente).
 *    Os snapshots em linha abaixo foram gravados com o componente da `main`
 *    (`e39d318b`), ANTES da D-PROD-162, e só foram regravados uma vez, de
 *    propósito, na D-PROD-172 (o campo passou ao desenho do motor Base1: campo
 *    vazio sem "— Escolha —", lista na janela do motor, sem a opção vazia nem o
 *    botão "Fechar seleção"). Fora de uma decisão assim, não se regravam;
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
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="grid grid-cols-12"><div class="col-span-12 md:col-span-6"><div class="mg-field"><label for=":r1:" class="mg-field__label">Produto</label><div class="mg-field__control"><div class="relative mk-sel-campo w-full"><button id=":r1:" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Produto" data-testid="seletor-teste" class="h-5 w-full rounded-none border-0 bg-transparent px-0 text-[13px] font-medium uppercase text-[var(--mg-text-1)] shadow-none focus:ring-0 focus:outline-none read-only:bg-transparent disabled:bg-transparent disabled:text-[var(--mg-text-1)] b1-select-btn text-left" data-placeholder=""><span class="b1-select-btn__v truncate uppercase"></span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down b1-select-btn__c" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div></div></div></div></div>"`);
  });

  it('aberto, com opções: markup idêntico ao da main (nenhum botão de criar)', async () => {
    const { container } = montar({ buscar: buscarFake() });
    await abrir();
    await waitFor(() => expect(screen.queryByText('Carregando…')).toBeNull());
    expect(screen.queryByRole('button', { name: /Cadastrar novo|Nova|Novo/ })).toBeNull();
    expect(container.innerHTML).toMatchInlineSnapshot(`"<div class="grid grid-cols-12"><div class="col-span-12 md:col-span-6"><div class="mg-field is-open"><label for=":r3:" class="mg-field__label">Produto</label><div class="mg-field__control"><div class="relative mk-sel-campo w-full"><button id=":r3:" type="button" aria-haspopup="listbox" aria-expanded="true" aria-label="Produto" data-testid="seletor-teste" class="h-5 w-full rounded-none border-0 bg-transparent px-0 text-[13px] font-medium uppercase text-[var(--mg-text-1)] shadow-none focus:ring-0 focus:outline-none read-only:bg-transparent disabled:bg-transparent disabled:text-[var(--mg-text-1)] b1-select-btn text-left" data-placeholder="" aria-controls="seletor-teste-lista"><span class="b1-select-btn__v truncate uppercase"></span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down b1-select-btn__c" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg></button></div></div></div></div></div>"`);
    expect(screen.getByTestId('seletor-teste-painel').outerHTML).toMatchInlineSnapshot(`"<div data-side="bottom" data-align="start" data-state="open" role="dialog" id="radix-:r2:" class="mk-sel-pop b1-lista-pop b1-seletor-servidor b1-maiusculas" data-testid="seletor-teste-painel" style="--radix-popover-content-transform-origin: var(--radix-popper-transform-origin); --radix-popover-content-available-width: var(--radix-popper-available-width); --radix-popover-content-available-height: var(--radix-popper-available-height); --radix-popover-trigger-width: var(--radix-popper-anchor-width); --radix-popover-trigger-height: var(--radix-popper-anchor-height);" tabindex="-1"><div class="b1-pq"><input type="search" class="b1-pq__in" placeholder="Pesquisar…" aria-label="Buscar produto" autocomplete="off" maxlength="120" value=""></div><div id="seletor-teste-lista" role="listbox" aria-label="Opções de produto" class="mk-sel-lista b1-lista"><button type="button" role="option" aria-selected="false" class="mk-sel-op" title="Diesel S10"><span class="mk-sel-op__txt"><span class="mk-sel-op__label uppercase"><span class="mk-sel-op__cod mr-2">7</span>Diesel S10</span><span class="mk-sel-op__sub">L</span></span></button><button type="button" role="option" aria-selected="false" class="mk-sel-op" title="Ração inicial"><span class="mk-sel-op__txt"><span class="mk-sel-op__label uppercase">Ração inicial</span></span></button></div></div>"`);
  });
});

describe('SeletorPaginadoGestao — onCriarNovo (D-PROD-162)', () => {
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
