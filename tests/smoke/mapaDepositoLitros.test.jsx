/**
 * D-PROD-162 (F4, padrão P-11, achado D3) — o depósito do Mapa Geral soma só
 * Produtos com estoque em kg.
 *
 *  DEP-1. `getDepositoIndicator`: no MESMO local, um lote de ração em KG e um
 *         de diesel em L → saldo, % da capacidade e alerta de estoque mínimo
 *         usam só o KG; o "último registro" ignora o movimento rotulado `L`;
 *  DEP-2. sem Produto em L (ou sem passar `produtos`, a chamada antiga), o
 *         resultado é IDÊNTICO ao da chamada antiga;
 *  DEP-3. o detalhe do depósito: "Saldo atual kg" e "Necessidade reposição kg"
 *         só com o KG; o diesel aparece no saldo por produto com "L" e sem
 *         sacos; o último registro não é o do diesel. Sem Produto em L, o
 *         detalhe é idêntico ao renderizado com a lista de produtos sem L.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { getDepositoIndicator } from '@/components/mapa/pontoStatusUtils';

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

const DEPOSITO = { id: 'dep1', nome_ponto: 'DEPÓSITO SEDE', categoria_ponto: 'DEPOSITO', local_estoque_id: 'loc1', capacidade_cocho_kg: 1000, estoque_minimo_kg: 300 };
const RACAO = { id: 'pr-racao', empresa_id: 'emp-1', nome_produto: 'RAÇÃO', unidade_principal_estoque: 'KG', peso_por_saco_kg: 25 };
const DIESEL = { id: 'pr-diesel', empresa_id: 'emp-1', nome_produto: 'DIESEL S10 (L)', unidade_principal_estoque: 'L', peso_por_saco_kg: null };
const lote = (id, produto, qtd, extra = {}) => ({
  id, empresa_id: 'emp-1', produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: 'loc1', quantidade_disponivel: qtd, status: 'Disponivel', ...extra,
});
const mov = (id, produto, dia, unidade, extra = {}) => ({
  id, empresa_id: 'emp-1', produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_destino: 'loc1', data_movimentacao: `${dia}T12:00:00.000Z`,
  tipo_movimentacao: 'Entrada', quantidade: 100, unidade_medida: unidade, ...extra,
});

const LOTES = [lote('l1', RACAO, 250), lote('l2', DIESEL, 5000)];
const MOVS = [mov('m1', RACAO, '2026-11-01', 'KG'), mov('m2', DIESEL, '2026-11-05', 'L')];

describe('DEP-1/DEP-2 — indicador do depósito', () => {
  it('ração KG + diesel L no mesmo local: saldo, %, alerta e último registro só do KG', () => {
    const ind = getDepositoIndicator(DEPOSITO, [], [], LOTES, MOVS, [RACAO, DIESEL]);
    expect(ind.saldoAtual).toBe(250);
    expect(ind.percent).toBeCloseTo(250 / 300);
    expect(ind.badgeLabel).toBe('83%');
    expect(ind.isCritical).toBe(true);
    expect(ind.necessidadeReposicao).toBe(750);
    expect(ind.latestRecord?.id).toBe('m1');
    // Sem saber dos produtos (chamada antiga), o diesel entraria no saldo: é por isso que o Mapa passa `produtos`.
    expect(getDepositoIndicator(DEPOSITO, [], [], LOTES, MOVS).saldoAtual).toBe(5250);
  });

  it('usa o mínimo, ignora a capacidade no nível e trata vazio, acima do mínimo e sem configuração', () => {
    const base = { ...DEPOSITO, estoque_minimo_kg: 1000, capacidade_cocho_kg: 9000 };
    const ind = (qtd, deposito = base) => getDepositoIndicator(deposito, [], [], [lote('l1', RACAO, qtd)], [], [RACAO]);
    expect(ind(500).percent).toBe(.5);
    expect(ind(500, { ...base, capacidade_cocho_kg: 20000 }).percent).toBe(.5);
    expect(ind(0).percent).toBe(0);
    expect(ind(1000).percent).toBe(1);
    expect(ind(2000).percent).toBe(1);
    expect(ind(1000).isCritical).toBe(true);
    expect(ind(1001).isCritical).toBe(false);
    expect(ind(500, { ...base, estoque_minimo_kg: 0 }).percent).toBe(0);
    expect(ind(500).helperLabel).toContain('mínimo');
  });

  it('sem Produto em L: resultado idêntico ao da chamada antiga (sem `produtos`)', () => {
    const lotes = [lote('l1', RACAO, 250), lote('l3', { ...RACAO, id: 'pr-sal', nome_produto: 'SAL' }, 120)];
    const movs = [mov('m1', RACAO, '2026-11-01', 'KG'), mov('m3', RACAO, '2026-11-07', 'kg')];
    const antiga = getDepositoIndicator(DEPOSITO, [], [], lotes, movs);
    expect(getDepositoIndicator(DEPOSITO, [], [], lotes, movs, [RACAO, { ...RACAO, id: 'pr-sal' }])).toEqual(antiga);
    expect(getDepositoIndicator(DEPOSITO, [], [], lotes, movs, [])).toEqual(antiga);
    expect(antiga.latestRecord?.id).toBe('m3');
  });
});

describe('DEP-3 — detalhe do depósito', () => {
  beforeEach(() => {
    dados.lotesNota = [];
    dados.produtos = [];
    dados.movimentacoes = [];
  });
  afterEach(() => cleanup());

  const renderizar = async () => {
    const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(
      <QueryClientProvider client={qc}>
        <DetalhesDepositoSuplementacao deposito={DEPOSITO} onClose={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Saldo por Produto')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('Sem saldo disponível neste depósito.')).toBeNull());
    return r;
  };
  const valorDe = (rotulo) => screen.getByText(rotulo).nextElementSibling?.textContent;

  it('com diesel em L: kg e necessidade só da ração; diesel no saldo por produto em L, sem sacos; último registro é o da ração', async () => {
    dados.lotesNota = LOTES;
    dados.produtos = [RACAO, DIESEL];
    dados.movimentacoes = MOVS;
    await renderizar();
    await waitFor(() => expect(screen.getByTestId('saldo-litros-pr-diesel')).toBeTruthy());
    expect(valorDe('Saldo atual kg')).toBe('250,00 kg');
    expect(valorDe('Necessidade reposição kg')).toBe('750,00 kg');
    expect(valorDe('Saldo em sacos')).toBe('10,00 sacos');
    expect(screen.getByTestId('saldo-litros-pr-diesel').textContent).toBe('5.000,00 L');
    expect(screen.getByTestId('saldo-litros-pr-diesel').previousElementSibling?.textContent).toBe('—');
    // Último registro: o da ração (o movimento `L` do diesel, mais novo, fica fora); o diesel só no saldo por produto.
    await waitFor(() => expect(screen.queryByText('Nenhum registro ainda.')).toBeNull());
    expect(screen.getAllByText('RAÇÃO')).toHaveLength(2);
    expect(screen.getAllByText('DIESEL S10 (L)')).toHaveLength(1);
  });

  it('sem Produto em L: o detalhe é o mesmo com a lista de produtos sem L (nenhum "L", saldo em kg e sacos como antes)', async () => {
    dados.lotesNota = [lote('l1', RACAO, 250)];
    dados.produtos = [RACAO];
    dados.movimentacoes = [mov('m1', RACAO, '2026-11-01', 'KG')];
    const { container } = await renderizar();
    await waitFor(() => expect(valorDe('Saldo atual kg')).toBe('250,00 kg'));
    expect(valorDe('Saldo em sacos')).toBe('10,00 sacos');
    expect(screen.queryByTestId(/^saldo-litros-/)).toBeNull();
    expect(container.textContent).not.toMatch(/\d L\b/);
    expect(container.textContent).toContain('10,00 sacos250,00 kg');
  });
});
