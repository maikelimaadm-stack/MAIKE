/**
 * D-PROD-178 (MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01), seção 5 — detalhe do DEPÓSITO.
 *
 * `DetalhesDepositoSuplementacao` lê o nível SÓ do SSOT
 * (`calcularNivelDeposito`, via `getDepositoIndicator`): o mesmo número do
 * marcador do mapa.
 *
 *  DD-1. limite 300 kg, saldo 600 kg: medidor "Ocupação do limite operacional"
 *        com 200% (bruto, fora do ícone), "300 kg acima do limite", ícone e
 *        barra cheios; "Capacidade:" virou "Limite operacional:";
 *  DD-2. limite 300, saldo 150, mínimo 100: 50% e 50 kg acima do mínimo;
 *  DD-3. limite 300, saldo 90, mínimo 100: 30% e abaixo do mínimo (faltam 10 kg);
 *  DD-4. sem limite operacional (0/null): sem percentual, com mensagem; sem
 *        mínimo: mensagem;
 *  DD-5. produto em L no mesmo local: fora do saldo em kg e do percentual; o
 *        saldo por produto mostra o L numa linha separada (D-PROD-162 P-11);
 *  DD-6. lote de produto que não está no cadastro: aviso de unidade não
 *        confirmada (o lote continua somado, como antes).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const dados = vi.hoisted(() => ({ lotesNota: [], produtos: [], movimentacoes: [] }));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => dados.lotesNota),
  listarTodosProdutos: vi.fn(async () => dados.produtos),
  listarTodasMovimentacoes: vi.fn(async () => dados.movimentacoes),
}));
vi.mock('@/services/mapaService', () => ({
  listarPontosSuplementacaoAtivos: vi.fn(async () => []),
  listarAreasAtivas: vi.fn(async () => []),
  listarIconesPorTipoEntidade: vi.fn(async () => []),
}));
vi.mock('@/services/loteManejoService', () => ({ listarTodosLotes: vi.fn(async () => []) }));
vi.mock('@/components/mapa/FormularioTransferenciaDeposito', () => ({ default: () => null }));
vi.mock('@/components/suplementacao/HistoricoDepositoSuplementacao', () => ({ default: () => null }));

const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');

const RACAO = { id: 'pr-racao', empresa_id: 'emp-1', nome_produto: 'RAÇÃO', unidade_principal_estoque: 'KG', peso_por_saco_kg: 30 };
const DIESEL = { id: 'pr-diesel', empresa_id: 'emp-1', nome_produto: 'DIESEL S10', unidade_principal_estoque: 'L', peso_por_saco_kg: null };
const deposito = (extra = {}) => ({
  id: 'dep1', nome_ponto: 'DEPÓSITO SEDE', categoria_ponto: 'DEPOSITO', local_estoque_id: 'loc1', capacidade_cocho_kg: 300, estoque_minimo_kg: null, ...extra,
});
const lote = (id, produto, qtd) => ({
  id, empresa_id: 'emp-1', produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: 'loc1', quantidade_disponivel: qtd, status: 'Disponivel',
});

const renderizar = async (dep) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <DetalhesDepositoSuplementacao deposito={dep} onClose={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole('region', { name: 'Nível do depósito' })).toBeTruthy());
  return r;
};
const secao = () => screen.getByRole('region', { name: 'Nível do depósito' });
const medidor = () => within(secao()).getByRole('meter', { name: 'Ocupação do limite operacional' });
const painelMinimo = () => within(secao()).getByRole('group', { name: 'Estoque mínimo' });
/** SVG do ícone do depósito no detalhe. */
const icone = () => {
  const img = secao().querySelector('img[data-deposito-icone]');
  return new DOMParser().parseFromString(decodeURIComponent(img.src.split(',')[1]), 'image/svg+xml');
};
const nivelIcone = () => icone().querySelector('[data-deposito-nivel]')?.getAttribute('data-deposito-nivel') ?? null;
const valorDe = (rotulo) => screen.getByText(rotulo).nextElementSibling?.textContent;

beforeEach(() => {
  dados.lotesNota = [];
  dados.produtos = [RACAO, DIESEL];
  dados.movimentacoes = [];
});
afterEach(() => cleanup());

describe('DD — detalhe do depósito pelo limite operacional (D-PROD-178)', () => {
  it('DD-1 — limite 300, saldo 600: 200% bruto fora do ícone, 300 kg acima, ícone cheio; "Limite operacional:" no lugar de "Capacidade:"', async () => {
    dados.lotesNota = [lote('l1', RACAO, 600)];
    await renderizar(deposito());
    await waitFor(() => expect(medidor().getAttribute('aria-valuenow')).toBe('200'));
    expect(within(secao()).getByText('200%')).toBeTruthy();
    expect(within(secao()).getByText('de 300 kg · 300 kg acima do limite')).toBeTruthy();
    expect(medidor().getAttribute('aria-valuetext')).toBe('200% de 300 kg · 300 kg acima do limite');
    expect(medidor().getAttribute('data-variante')).toBe('excesso');
    expect(nivelIcone()).toBe('100');
    expect(secao().querySelector('[data-medidor-preenchimento]').style.width).toBe('100%');
    expect(valorDe('Saldo atual kg')).toBe('600,00 kg');
    expect(valorDe('Necessidade reposição kg')).toBe('0,00 kg');
    expect(valorDe('Limite operacional:')).toBe('300,00 kg');
    expect(screen.queryByText('Capacidade:')).toBeNull();
    expect(screen.queryByText(/do mínimo/)).toBeNull();
    expect(within(painelMinimo()).getByText('Estoque mínimo não configurado.')).toBeTruthy();
  });

  it('DD-2 — limite 300, saldo 150, mínimo 100: 50% e 50 kg acima do mínimo', async () => {
    dados.lotesNota = [lote('l1', RACAO, 150)];
    await renderizar(deposito({ estoque_minimo_kg: 100 }));
    await waitFor(() => expect(medidor().getAttribute('aria-valuenow')).toBe('50'));
    expect(within(secao()).getByText('50%')).toBeTruthy();
    expect(within(secao()).getByText('de 300 kg · dentro do limite')).toBeTruthy();
    expect(nivelIcone()).toBe('50');
    expect(within(painelMinimo()).getByText('Mínimo 100 kg · 50 kg acima do mínimo')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('acima');
    expect(valorDe('Necessidade reposição kg')).toBe('150,00 kg');
    expect(valorDe('Estoque mínimo:')).toBe('100,00 kg');
  });

  it('DD-3 — limite 300, saldo 90, mínimo 100: 30% e abaixo do mínimo (faltam 10 kg)', async () => {
    dados.lotesNota = [lote('l1', RACAO, 90)];
    await renderizar(deposito({ estoque_minimo_kg: 100 }));
    await waitFor(() => expect(medidor().getAttribute('aria-valuenow')).toBe('30'));
    expect(within(secao()).getByText('30%')).toBeTruthy();
    expect(nivelIcone()).toBe('30');
    expect(within(painelMinimo()).getByText('Mínimo 100 kg · abaixo do mínimo (faltam 10 kg)')).toBeTruthy();
    expect(within(painelMinimo()).getByText('Reposição recomendada.')).toBeTruthy();
    expect(painelMinimo().getAttribute('data-estado-minimo')).toBe('abaixo');
  });

  it.each([[0], [null]])('DD-4 — sem limite operacional (%s): sem percentual, mensagem do limite e do mínimo', async (limite) => {
    dados.lotesNota = [lote('l1', RACAO, 150)];
    await renderizar(deposito({ capacidade_cocho_kg: limite, estoque_minimo_kg: null }));
    await waitFor(() => expect(valorDe('Saldo atual kg')).toBe('150,00 kg'));
    expect(within(secao()).queryByRole('meter')).toBeNull();
    expect(within(secao()).getByText('Limite operacional não configurado; não há percentual.')).toBeTruthy();
    expect(secao().textContent).not.toMatch(/\d%/);
    expect(nivelIcone()).toBeNull();
    expect(within(painelMinimo()).getByText('Estoque mínimo não configurado.')).toBeTruthy();
    expect(valorDe('Necessidade reposição kg')).toBe('0,00 kg');
    expect(valorDe('Limite operacional:')).toBe('-');
  });

  it('DD-5 — produto em L fica fora do saldo em kg e do percentual; aparece separado no saldo por produto', async () => {
    dados.lotesNota = [lote('l1', RACAO, 150), lote('l2', DIESEL, 5000)];
    await renderizar(deposito());
    await waitFor(() => expect(screen.getByTestId('saldo-litros-pr-diesel')).toBeTruthy());
    await waitFor(() => expect(medidor().getAttribute('aria-valuenow')).toBe('50'));
    expect(valorDe('Saldo atual kg')).toBe('150,00 kg');
    expect(secao().textContent).not.toContain('5.000');
    expect(within(secao()).getByText('Produtos em litros ficam fora do saldo em kg e do percentual.')).toBeTruthy();
    expect(within(secao()).queryByText(/Unidade de alguns produtos não confirmada/)).toBeNull();
    // Saldo por produto: kg primeiro; o L numa linha à parte, sem sacos.
    const litros = screen.getByRole('group', { name: 'Em litros (fora do saldo em kg)' });
    expect(within(litros).getByText('DIESEL S10')).toBeTruthy();
    expect(within(litros).getByTestId('saldo-litros-pr-diesel').textContent).toBe('5.000,00 L');
    expect(within(litros).queryByText('RAÇÃO')).toBeNull();
    expect(screen.getByTestId('saldo-litros-pr-diesel').previousElementSibling?.textContent).toBe('—');
  });

  it('DD-6 — lote de produto fora do cadastro: aviso de unidade não confirmada (o lote continua somado)', async () => {
    const SEM_CADASTRO = { id: 'pr-sem-cadastro', nome_produto: 'SAL ANTIGO' };
    dados.lotesNota = [lote('l1', RACAO, 100), lote('l2', SEM_CADASTRO, 50)];
    await renderizar(deposito());
    await waitFor(() => expect(medidor().getAttribute('aria-valuenow')).toBe('50'));
    expect(valorDe('Saldo atual kg')).toBe('150,00 kg');
    expect(within(secao()).getByText('Unidade de alguns produtos não confirmada; o saldo em kg pode incluir itens de outra unidade.')).toBeTruthy();
    expect(screen.getByText('SAL ANTIGO').closest('[data-unidade-confirmada]')?.getAttribute('data-unidade-confirmada')).toBe('false');
    expect(screen.getByText('unidade não confirmada')).toBeTruthy();
  });
});
