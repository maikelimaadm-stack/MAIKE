/**
 * D-PROD-162 (F4, padrão P-11, achado D3) — o depósito do Mapa Geral soma só
 * Produtos com estoque em kg.
 *
 *  DEP-1. `getDepositoIndicator`: no MESMO local, um lote de ração em KG e um
 *         de diesel em L → saldo, % do LIMITE OPERACIONAL e alerta de estoque
 *         mínimo usam só o KG; o "último registro" ignora o movimento rotulado `L`;
 *  DEP-2. sem Produto em L (ou sem passar `produtos`, a chamada antiga), saldo,
 *         percentual e alertas são IDÊNTICOS aos da chamada antiga; só muda a
 *         confirmação de unidade (sem a lista de produtos, a unidade dos lotes
 *         não é confirmada — D-PROD-178);
 *  DEP-3. o detalhe do depósito: "Saldo atual kg" e "Necessidade reposição kg"
 *         só com o KG; o diesel aparece no saldo por produto com "L" e sem
 *         sacos; o último registro não é o do diesel. Sem Produto em L, o
 *         detalhe é idêntico ao renderizado com a lista de produtos sem L.
 *         D-PROD-220 (desenho v12): o "último registro" é o primeiro cartão da
 *         linha do tempo "Histórico do depósito", e o kg sai no formato do
 *         SSOT ("250 kg").
 *
 * D-PROD-178 trocou a regra do nível: o percentual do depósito é o saldo sobre o
 * LIMITE OPERACIONAL (`capacidade_cocho_kg`), bruto (pode passar de 100%); o
 * ícone limita a 0..1. O estoque mínimo só dispara o alerta de reposição — nunca
 * é divisor nem teto. Antes o nível era saldo ÷ mínimo e ignorava a capacidade.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
// Farol e nível dos cochos vinculados (cache do mapa) e o fuso da fazenda: sem cochos aqui.
vi.mock('@/services/mapaCacheService', () => ({ getMapaCachedData: vi.fn(async () => []), refreshMapaCacheEntry: vi.fn(async () => []) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => []) }));
vi.mock('@/components/mapa/FormularioTransferenciaDeposito', () => ({ default: () => null }));
// A linha do tempo usa a regra (pura) do histórico; só o componente do histórico completo sai.
vi.mock('@/components/suplementacao/HistoricoDepositoSuplementacao', async (importOriginal) => ({ ...(await importOriginal()), default: () => null }));

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
  it('ração KG + diesel L no mesmo local: saldo, % do limite, alerta e último registro só do KG', () => {
    const ind = getDepositoIndicator(DEPOSITO, [], [], LOTES, MOVS, [RACAO, DIESEL]);
    expect(ind.saldoAtual).toBe(250);
    // 250 kg de um limite operacional de 1000 kg (capacidade_cocho_kg).
    expect(ind.percent).toBe(0.25);
    expect(ind.badgeLabel).toBe('25%');
    expect(ind.nivel.ocupacaoPercentual).toBe(25);
    expect(ind.nivel.lotesEmLitrosIgnorados).toBe(1);
    expect(ind.isCritical).toBe(true);
    expect(ind.necessidadeReposicao).toBe(750);
    expect(ind.latestRecord?.id).toBe('m1');
    // Sem saber dos produtos (chamada antiga), o diesel entraria no saldo: é por isso que o Mapa passa `produtos`.
    const semProdutos = getDepositoIndicator(DEPOSITO, [], [], LOTES, MOVS);
    expect(semProdutos.saldoAtual).toBe(5250);
    expect(semProdutos.nivel.unidadesConfirmadas).toBe(false);
  });

  it('usa o limite operacional (capacidade) no nível; o mínimo só dispara o alerta; trata vazio, excesso e sem configuração', () => {
    const base = { ...DEPOSITO, estoque_minimo_kg: 1000, capacidade_cocho_kg: 9000 };
    const ind = (qtd, deposito = base) => getDepositoIndicator(deposito, [], [], [lote('l1', RACAO, qtd)], [], [RACAO]);
    expect(ind(4500).percent).toBe(.5);
    // O mínimo não muda o percentual…
    expect(ind(4500, { ...base, estoque_minimo_kg: 4000 }).percent).toBe(.5);
    expect(ind(4500, { ...base, estoque_minimo_kg: 0 }).percent).toBe(.5);
    // …e o limite muda.
    expect(ind(4500, { ...base, capacidade_cocho_kg: 18000 }).percent).toBe(.25);
    expect(ind(0).percent).toBe(0);
    expect(ind(9000).percent).toBe(1);
    // Acima do limite: o ícone limita a 1, o percentual bruto e o excesso ficam no nível.
    expect(ind(18000).percent).toBe(1);
    expect(ind(18000).badgeLabel).toBe('200%');
    expect(ind(18000).nivel.ocupacaoPercentual).toBe(200);
    expect(ind(18000).nivel.excessoKg).toBe(9000);
    expect(ind(18000).necessidadeReposicao).toBe(0);
    // Mínimo: mesma regra de "crítico" (saldo ≤ mínimo).
    expect(ind(1000).isCritical).toBe(true);
    expect(ind(1001).isCritical).toBe(false);
    // Sem limite operacional: sem percentual (ícone neutro).
    const semLimite = ind(500, { ...base, capacidade_cocho_kg: 0 });
    expect(semLimite.percent).toBe(0);
    expect(semLimite.nivel.neutro).toBe(true);
    expect(semLimite.badgeLabel).toBe('Sem limite');
    expect(semLimite.helperLabel).toContain('Limite operacional não configurado');
    expect(ind(4500).helperLabel).toContain('limite operacional');
  });

  it('sem Produto em L: saldo, percentual e alertas idênticos aos da chamada antiga (sem `produtos`); só a unidade deixa de ser confirmada', () => {
    const lotes = [lote('l1', RACAO, 250), lote('l3', { ...RACAO, id: 'pr-sal', nome_produto: 'SAL' }, 120)];
    const movs = [mov('m1', RACAO, '2026-11-01', 'KG'), mov('m3', RACAO, '2026-11-07', 'kg')];
    const semUnidade = ({ nivel, ...resto }) => ({ ...resto, nivel: { ...nivel, unidadesConfirmadas: undefined, mensagemUnidade: undefined } });
    const antiga = getDepositoIndicator(DEPOSITO, [], [], lotes, movs);
    const comProdutos = getDepositoIndicator(DEPOSITO, [], [], lotes, movs, [RACAO, { ...RACAO, id: 'pr-sal' }]);
    expect(semUnidade(comProdutos)).toEqual(semUnidade(antiga));
    expect(semUnidade(getDepositoIndicator(DEPOSITO, [], [], lotes, movs, []))).toEqual(semUnidade(antiga));
    expect(comProdutos.nivel.unidadesConfirmadas).toBe(true);
    expect(antiga.nivel.unidadesConfirmadas).toBe(false);
    expect(antiga.nivel.mensagemUnidade).toContain('Unidade de alguns produtos não confirmada');
    expect(antiga.saldoAtual).toBe(370);
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
    await waitFor(() => expect(screen.getByText('Saldo por produto')).toBeTruthy());
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
    expect(valorDe('Saldo atual kg')).toBe('250 kg');
    expect(valorDe('Necessidade reposição kg')).toBe('750 kg');
    expect(document.querySelector('.mk-dp-linha__sub')?.textContent).toBe('10,00 sacos');
    expect(screen.getByTestId('saldo-litros-pr-diesel').textContent).toBe('5.000,00 L');
    // Sacos do produto em litros: "—" (o sub da linha dele).
    const linhaDiesel = screen.getByTestId('saldo-litros-pr-diesel').closest('[data-unidade-confirmada]');
    expect(within(linhaDiesel).getByText('—')).toBeTruthy();
    expect(linhaDiesel.textContent).not.toMatch(/sacos/);
    expect(screen.queryByRole('list', { name: 'Histórico do depósito' })).toBeNull();
    expect(screen.getAllByText('RAÇÃO')).toHaveLength(1);
    expect(screen.getAllByText('DIESEL S10 (L)')).toHaveLength(1);
  });

  it('sem Produto em L: o detalhe é o mesmo com a lista de produtos sem L (nenhum "L", saldo em kg e sacos como antes)', async () => {
    dados.lotesNota = [lote('l1', RACAO, 250)];
    dados.produtos = [RACAO];
    dados.movimentacoes = [mov('m1', RACAO, '2026-11-01', 'KG')];
    const { container } = await renderizar();
    await waitFor(() => expect(valorDe('Saldo atual kg')).toBe('250 kg'));
    expect(document.querySelector('.mk-dp-linha__sub')?.textContent).toBe('10,00 sacos');
    expect(screen.queryByTestId(/^saldo-litros-/)).toBeNull();
    expect(container.textContent).not.toMatch(/\d L\b/);
    // Linha do produto: sacos (sub) e o saldo em kg (valor), lado a lado no texto.
    expect(container.textContent).toContain('10,00 sacos250 kg');
  });
});
