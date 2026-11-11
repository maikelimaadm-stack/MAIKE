/**
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, R2) — "Saída do Depósito" no celular: a
 * folha "Local de Destino" (AutocompleteGenerico → MobileSheet) tem de abrir
 * DENTRO do diálogo modal da transferência, que é a camada de cima do Radix.
 *
 * Causa real (reproduzida no Chromium em 390 px): o "Depósito de
 * Suplementação" é um `LancLoteDialogo` e entrega aos filhos o alvo das
 * folhas (`MobileSheetPortalCtx`, D-PROD-116). O diálogo da transferência,
 * aberto POR CIMA dele, herdava esse alvo: a folha nascia no diálogo de
 * BAIXO — que o diálogo de cima deixa `aria-hidden`, sem toque
 * (`pointer-events: none`) e fora do foco preso — e ficava atrás dele.
 *
 *  FT1. a folha nasce dentro do diálogo da transferência, fora de qualquer
 *       `aria-hidden` e sem `pointer-events: none` herdado de camada;
 *  FT2. Escape fecha SÓ a folha (o diálogo continua aberto) e o foco volta ao
 *       campo; o segundo Escape fecha o diálogo;
 *  FT3. tocar na opção escolhe o local: a folha fecha, o resumo mostra o
 *       destino e o diálogo continua aberto;
 *  FT4. teclado: Enter no campo abre a folha e o foco entra nela; Enter na
 *       opção escolhe;
 *  FT5. no celular o diálogo não é bloco de contenção de `position: fixed`
 *       (sem transform), para a folha ocupar a tela e não o cartão.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const EMPRESA = 'emp-1';
const LOCAL_A = { id: 'loc-a', nome: 'DEPÓSITO CENTRAL', numero_local: '1', ativo: true };
const LOCAL_B = { id: 'loc-b', nome: 'DEPÓSITO RETIRO', numero_local: '2', ativo: true };
const PRODUTO = { id: 'p1', empresa_id: EMPRESA, nome_produto: 'RAÇÃO P0', tipo_uso: 'Nutrição Animal', unidade_medida: 'KG' };
const DEPOSITO = {
  id: 'dep-1',
  nome_ponto: 'DEPÓSITO DA SEDE',
  categoria_ponto: 'DEPOSITO',
  local_estoque_id: LOCAL_A.id,
  local_estoque_nome: LOCAL_A.nome,
};

vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => [
    { id: 'l1', empresa_id: EMPRESA, produto_id: PRODUTO.id, produto_nome: PRODUTO.nome_produto, local_estoque_id: LOCAL_A.id, local_estoque_nome: LOCAL_A.nome, quantidade_disponivel: 180, status: 'Disponivel' },
  ]),
  listarTodosProdutos: vi.fn(async () => [PRODUTO]),
  listarTodasMovimentacoes: vi.fn(async () => []),
  listarTodosLocais: vi.fn(async () => [LOCAL_A, LOCAL_B]),
}));
vi.mock('@/services/mapaService', () => ({
  listarPontosSuplementacaoAtivos: vi.fn(async () => []),
  listarAreasAtivas: vi.fn(async () => []),
  listarIconesPorTipoEntidade: vi.fn(async () => []),
}));
vi.mock('@/services/loteManejoService', () => ({ listarTodosLotes: vi.fn(async () => []) }));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/services/suplementacaoEstoqueService', () => ({ registrarTransferenciaEntreLocais: vi.fn(async () => ({})) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => EMPRESA }));

const { LancLoteDialogo } = await import('@/components/lotes/LancamentoLoteUi');
const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');

/** Celular (< 640 px): AutocompleteGenerico usa a folha; LancLoteDialogo abre em tela. */
const celular = () => {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: /max-width:\s*639px/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
};

/** Toque real: pointerdown, pointerup e click em tarefas separadas (como em mobileSelecaoToque). */
const tocar = async (el) => {
  await act(async () => {
    fireEvent.pointerDown(el);
  });
  await act(async () => {
    fireEvent.pointerUp(el);
  });
  await act(async () => {
    fireEvent.click(el);
  });
};
const tecla = async (el, key) => {
  await act(async () => {
    fireEvent.keyDown(el, { key });
  });
};

/** Mesma composição do Mapa Geral: Depósito (LancLoteDialogo) → Saída (Dialog) → campo Local. */
const montar = async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Depósito de Suplementação" largo somenteLeitura>
        <DetalhesDepositoSuplementacao deposito={DEPOSITO} permissions={{}} onClose={vi.fn()} />
      </LancLoteDialogo>
    </QueryClientProvider>,
  );
  await tocar(await screen.findByRole('button', { name: 'Saída' }));
  const titulo = await screen.findByRole('heading', { name: 'Saída do Depósito' });
  const dialogo = titulo.closest('[role="dialog"]');
  expect(dialogo).toBeTruthy();
  const campo = await within(dialogo).findByPlaceholderText('BUSCAR LOCAL...');
  return { dialogo, campo };
};

/** A camada (Radix) mais próxima com `pointer-events` explícito não pode desligar o toque. */
const peHerdado = (el) => {
  for (let n = el; n; n = n.parentElement) {
    if (n.style?.pointerEvents) return n.style.pointerEvents;
  }
  return '';
};

let original;
beforeEach(() => {
  cleanup();
  original = window.matchMedia;
  celular();
});
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

describe('D-PROD-161 — Saída do Depósito no celular: folha "Local de Destino"', () => {
  it('FT1 — a folha nasce dentro do diálogo da transferência, visível ao leitor de tela e ao toque', async () => {
    const { dialogo, campo } = await montar();
    await tocar(campo);
    // `hidden: true` acha a opção mesmo escondida, para a prova dizer ONDE ela nasceu.
    const opcao = await screen.findByRole('option', { name: LOCAL_B.nome, hidden: true });
    const folha = opcao.closest('.mk-sheet');
    expect(folha).toBeTruthy();
    // Dentro do diálogo de CIMA (o da transferência), não no "Depósito de Suplementação".
    expect(dialogo.contains(folha)).toBe(true);
    expect(folha.closest('.mk-ll-dlg')).toBeNull();
    // Nada acima da opção está escondido do leitor de tela nem sem toque.
    expect(opcao.closest('[aria-hidden="true"]')).toBeNull();
    expect(peHerdado(opcao)).not.toBe('none');
  });

  it('FT2 — Escape fecha só a folha e devolve o foco ao campo; o segundo Escape fecha o diálogo', async () => {
    const { dialogo, campo } = await montar();
    await tocar(campo);
    const opcao = await screen.findByRole('option', { name: LOCAL_B.nome });
    await tecla(document.activeElement || opcao, 'Escape');
    expect(screen.queryByRole('option', { name: LOCAL_B.nome })).toBeNull();
    expect(dialogo.isConnected).toBe(true);
    expect(screen.getByRole('heading', { name: 'Saída do Depósito' })).toBeTruthy();
    expect(document.activeElement).toBe(campo);
    await tecla(document.activeElement, 'Escape');
    expect(screen.queryByRole('heading', { name: 'Saída do Depósito' })).toBeNull();
  });

  it('FT3 — tocar na opção escolhe o destino e mantém o diálogo aberto', async () => {
    const { dialogo, campo } = await montar();
    await tocar(campo);
    await tocar(await screen.findByRole('option', { name: LOCAL_B.nome }));
    expect(screen.queryByRole('option', { name: LOCAL_B.nome })).toBeNull();
    expect(dialogo.isConnected).toBe(true);
    expect(campo.value).toBe(LOCAL_B.nome);
    expect(within(dialogo).getByText(/^Destino:/).textContent).toContain(LOCAL_B.nome);
  });

  it('FT4 — teclado: Enter abre, o foco entra na folha e Enter na opção escolhe', async () => {
    const { dialogo, campo } = await montar();
    act(() => campo.focus());
    await tecla(campo, 'Enter');
    const folha = (await screen.findByRole('option', { name: LOCAL_B.nome })).closest('.mk-sheet');
    expect(folha.contains(document.activeElement)).toBe(true);
    const opcaoB = screen.getByRole('option', { name: LOCAL_B.nome });
    act(() => opcaoB.focus());
    await act(async () => {
      fireEvent.click(opcaoB);
    });
    expect(campo.value).toBe(LOCAL_B.nome);
    expect(dialogo.isConnected).toBe(true);
    expect(document.activeElement).toBe(campo);
  });

  it('FT5 — no celular o diálogo da transferência centraliza sem transform (a folha ocupa a tela)', async () => {
    const { dialogo } = await montar();
    expect(dialogo.className).toMatch(/(^|\s)max-sm:transform-none(\s|$)/);
    expect(dialogo.className).toMatch(/(^|\s)max-sm:inset-0(\s|$)/);
  });
});
