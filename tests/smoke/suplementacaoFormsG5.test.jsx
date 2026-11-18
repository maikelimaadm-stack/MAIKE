/**
 * Frente G5 — formulários de suplementação (lançamento do cocho e transferência do depósito).
 *
 *  G5-1. a saída de estoque do lançamento manda `area_nome` que cabe nos 255 caracteres da rota
 *        (cocho com muitos pastos recebia 400 e não lançava);
 *  G5-2. a transferência do depósito sugere o dia civil da FAZENDA, não o dia em UTC
 *        (às 21h30 em São Paulo o campo vinha com o dia seguinte), e não aceita data futura;
 *  G5-3. "Saída do Depósito" não oferece local inativo como destino; "Entrada" mantém como origem;
 *  G5-4. depois da transferência, o cache do mapa de movimentações e lotes é atualizado com
 *        `force` (o histórico do depósito lia o IndexedDB velho por até 60 s).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const EMPRESA = 'emp-g5';
const LOCAL_DEP = { id: 'loc-dep', nome: 'DEPÓSITO SEDE', numero_local: '1', ativo: true };
const LOCAL_ATIVO = { id: 'loc-ativo', nome: 'DEPÓSITO RETIRO', numero_local: '2', ativo: true };
const LOCAL_INATIVO = { id: 'loc-inativo', nome: 'GALPÃO DESATIVADO', numero_local: '3', ativo: false };
const PRODUTO = { id: 'prod-1', empresa_id: EMPRESA, nome_produto: 'SAL G5', tipo_uso: 'Nutrição Animal', unidade_medida: 'KG' };
const DEPOSITO = { id: 'dep-1', nome_ponto: 'DEPÓSITO DA SEDE', categoria_ponto: 'DEPOSITO', local_estoque_id: LOCAL_DEP.id, local_estoque_nome: LOCAL_DEP.nome };

const h = vi.hoisted(() => ({
  toastError: /** @type {any} */ (null),
  registrar: vi.fn(async () => ({ committed: true })),
  refresh: vi.fn(async () => []),
  empresas: /** @type {any[]} */ ([]),
}));

vi.mock('sonner', () => {
  const toast = Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() });
  h.toastError = toast.error;
  return { toast };
});
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLocais: vi.fn(async () => [LOCAL_DEP, LOCAL_ATIVO, LOCAL_INATIVO]),
  listarTodosProdutos: vi.fn(async () => [PRODUTO]),
  listarTodosLotesNota: vi.fn(async () => [
    { id: 'l-dep', empresa_id: EMPRESA, produto_id: PRODUTO.id, produto_nome: PRODUTO.nome_produto, local_estoque_id: LOCAL_DEP.id, local_estoque_nome: LOCAL_DEP.nome, quantidade_disponivel: 500, status: 'Disponivel' },
    { id: 'l-inat', empresa_id: EMPRESA, produto_id: PRODUTO.id, produto_nome: PRODUTO.nome_produto, local_estoque_id: LOCAL_INATIVO.id, local_estoque_nome: LOCAL_INATIVO.nome, quantidade_disponivel: 80, status: 'Disponivel' },
  ]),
}));
vi.mock('@/services/sessionService', () => ({ getCurrentUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/services/suplementacaoEstoqueService', () => ({ registrarTransferenciaEntreLocais: (...a) => h.registrar(...a) }));
vi.mock('@/services/mapaCacheService', () => ({ refreshMapaCacheEntry: (...a) => h.refresh(...a) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => h.empresas) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => EMPRESA }));
// Campos de escolha como <select> nativo: o teste é da regra do formulário, não do componente de lista.
vi.mock('@/components/financeiro/AutocompleteGenerico', () => ({
  default: ({ items, value, onChange, placeholder }) => (
    <select aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-</option>
      {items.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
    </select>
  ),
}));
// D-PROD-222: Produto e Unidade da transferência são o B1Select do manejo (mesma API do <select>).
vi.mock('@/components/cadastro/base1/B1Select', () => ({
  default: ({ value, onChange, disabled, children }) => (
    <select aria-label="produto-ou-unidade" value={value} disabled={disabled} onChange={onChange}>
      <option value="">-</option>
      {children}
    </select>
  ),
}));

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const montarTransferencia = async (direcao, onSuccess = () => {}) => {
  const { default: FormularioTransferenciaDeposito } = await import('@/components/mapa/FormularioTransferenciaDeposito');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <FormularioTransferenciaDeposito deposito={DEPOSITO} initialDirection={direcao} onSuccess={onSuccess} onCancel={() => {}} />
      </QueryClientProvider>,
    );
  });
  await assentar();
  await assentar();
  return client;
};
const campoData = () => /** @type {HTMLInputElement} */ (document.querySelector('input[type="date"]'));
const opcoesDoLocal = () => Array.from(/** @type {HTMLSelectElement} */ (screen.getByLabelText('BUSCAR LOCAL...')).options).map((o) => o.textContent);

beforeEach(() => {
  cleanup();
  h.refresh.mockReset();
  h.refresh.mockImplementation(async () => []);
  h.registrar.mockClear();
  h.toastError?.mockClear();
  h.empresas = [{ id: EMPRESA, nome: 'FAZENDA G5', fuso_horario: 'America/Sao_Paulo' }];
  vi.useFakeTimers({ toFake: ['Date'] });
  // 00:30 UTC de 17/11 = 21:30 de 16/11 em São Paulo.
  vi.setSystemTime(new Date('2026-11-17T00:30:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('G5-1 — rótulo das áreas na saída de estoque do lançamento', () => {
  it('12 pastos de ~25 caracteres: cabe em 255 e diz quantos ficaram de fora', async () => {
    const { rotuloDeAreasDaSaida } = await import('@/components/suplementacao/FormularioLancamentoSuplementacao');
    const nomes = Array.from({ length: 12 }, (_, i) => `PASTO DA INVERNADA NUM ${String(i + 1).padStart(2, '0')}`);
    expect(nomes.join(', ').length).toBeGreaterThan(255);
    const rotulo = rotuloDeAreasDaSaida(nomes, null);
    expect(rotulo.length).toBeLessThanOrEqual(255);
    expect(rotulo.startsWith('PASTO DA INVERNADA NUM 01, ')).toBe(true);
    expect(rotulo).toMatch(/ \+\d+$/);
  });
  it('poucos pastos: todos os nomes; sem nomes: o nome da área do cocho; nada: null', async () => {
    const { rotuloDeAreasDaSaida } = await import('@/components/suplementacao/FormularioLancamentoSuplementacao');
    expect(rotuloDeAreasDaSaida(['PASTO A', 'PASTO B'], 'X')).toBe('PASTO A, PASTO B');
    expect(rotuloDeAreasDaSaida([], 'PASTO DO COCHO')).toBe('PASTO DO COCHO');
    expect(rotuloDeAreasDaSaida([], null)).toBeNull();
  });
  it('um nome só maior que o limite é cortado com reticências', async () => {
    const { rotuloDeAreasDaSaida } = await import('@/components/suplementacao/FormularioLancamentoSuplementacao');
    const rotulo = rotuloDeAreasDaSaida(['A'.repeat(400)], null);
    expect(rotulo.length).toBe(255);
    expect(rotulo.endsWith('…')).toBe(true);
  });
});

describe('G5-2 — data padrão da transferência no dia da fazenda', () => {
  it('às 21h30 em São Paulo (já 17/11 em UTC) sugere 16/11 e limita o campo a hoje', async () => {
    await montarTransferencia('entrada');
    expect(campoData().value).toBe('2026-11-16');
    expect(campoData().getAttribute('max')).toBe('2026-11-16');
  });

  it('data futura é recusada com mensagem clara, sem chamar o servidor', async () => {
    await montarTransferencia('saida');
    fireEvent.change(screen.getByLabelText('BUSCAR LOCAL...'), { target: { value: LOCAL_ATIVO.id } });
    await assentar();
    const [produto] = screen.getAllByLabelText('produto-ou-unidade');
    fireEvent.change(produto, { target: { value: PRODUTO.id } });
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '10' } });
    fireEvent.change(campoData(), { target: { value: '2026-11-17' } });
    await act(async () => { fireEvent.submit(campoData().closest('form')); });
    expect(h.toastError).toHaveBeenCalledWith('A data da movimentação não pode ser futura.');
    expect(h.registrar).not.toHaveBeenCalled();
  });
});

describe('G5-3 — local inativo', () => {
  it('"Saída do Depósito" não oferece local inativo como destino', async () => {
    await montarTransferencia('saida');
    const opcoes = opcoesDoLocal();
    expect(opcoes).toContain(LOCAL_ATIVO.nome);
    expect(opcoes).not.toContain(LOCAL_INATIVO.nome);
    expect(opcoes).not.toContain(LOCAL_DEP.nome);
  });
  it('"Entrada no Depósito" mantém o local inativo como origem (o saldo dele pode sair)', async () => {
    await montarTransferencia('entrada');
    expect(opcoesDoLocal()).toContain(LOCAL_INATIVO.nome);
  });
});

describe('G5-4 — cache do mapa depois da transferência', () => {
  it('atualiza movimentacaoEstoque e estoqueLotes com force antes de reabrir o histórico', async () => {
    // O refresh fica pendente até o teste liberar: nada pode ser invalidado (nem o histórico
    // refeito, nem o formulário fechado) antes de o IndexedDB estar atualizado.
    const ordem = [];
    let liberar = () => {};
    const pendente = new Promise((r) => { liberar = () => { ordem.push('refresh-concluido'); r([]); }; });
    h.refresh.mockImplementation(() => pendente);
    const onSuccess = vi.fn(() => ordem.push('onSuccess'));
    const client = await montarTransferencia('saida', onSuccess);
    const invalidar = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => { ordem.push('invalidate'); });
    fireEvent.change(screen.getByLabelText('BUSCAR LOCAL...'), { target: { value: LOCAL_ATIVO.id } });
    await assentar();
    const [produto] = screen.getAllByLabelText('produto-ou-unidade');
    fireEvent.change(produto, { target: { value: PRODUTO.id } });
    fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: '10' } });
    await act(async () => { fireEvent.submit(campoData().closest('form')); });
    await assentar();
    expect(h.registrar).toHaveBeenCalledTimes(1);
    expect(h.registrar.mock.calls[0][0]).toMatchObject({ dataMovimentacao: '2026-11-16', localDestinoId: LOCAL_ATIVO.id, localOrigemId: LOCAL_DEP.id });
    expect(h.refresh).toHaveBeenCalledWith('movimentacaoEstoque', EMPRESA, { force: true });
    expect(h.refresh).toHaveBeenCalledWith('estoqueLotes', EMPRESA, { force: true });
    // Refresh ainda pendente: nada invalidado, sucesso ainda não anunciado.
    expect(invalidar).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => { liberar(); });
    await assentar();
    expect(ordem).toEqual(['refresh-concluido', 'invalidate', 'onSuccess']);
    const chaves = [];
    const predicate = invalidar.mock.calls[0][0].predicate;
    for (const k of ['historico-deposito', 'movimentacoes-deposito-detalhe', 'mapa-cache', 'outra']) if (predicate({ queryKey: [k] })) chaves.push(k);
    expect(chaves).toEqual(['historico-deposito', 'movimentacoes-deposito-detalhe', 'mapa-cache']);
  });
});
