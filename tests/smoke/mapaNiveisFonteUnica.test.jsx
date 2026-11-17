/**
 * D-PROD-178 (MAIKE-MAPA-NIVEIS-COCHO-DEPOSITO-UX01) — integração: mapa,
 * detalhe do cocho, detalhe do depósito e alertas leem o MESMO resultado do
 * SSOT (`src/domain/suplementacao/nivelSuplementacao.js`). Nenhuma tela refaz
 * a conta com o campo cru do cadastro.
 *
 *  FU-1. `getDepositoIndicator`: todo número do indicador sai do nível
 *        (limite, mínimo, saldo, reposição, crítico). Sem estimativa paralela
 *        de consumo (`consumo_ideal_por_cabeca_kg × cabeças`), que contava em
 *        dobro o rebanho de cochos que atendem os mesmos animais.
 *  FU-2. `alertasPonto` do depósito: o mínimo é o do nível, não o campo cru.
 *  FU-3. Duração do ciclo (base ÷ taxa) vem do SSOT
 *        (`duracaoCicloEstimadaDias`) — o detalhe do cocho não divide nada.
 *  FU-4. Mesmo saldo no marcador do mapa e no detalhe do depósito quando um
 *        Produto INATIVO em litros tem lote no depósito: a unidade do lote não
 *        depende de o produto estar ativo (P-11). Antes o mapa só conhecia os
 *        produtos ativos e somava o litro no kg; o detalhe não somava.
 *  FU-5. Os alertas de LOTE (`suplementacao_pendente`, fora do escopo) ficam
 *        iguais: o fallback do "maior %PV" continua só entre produtos ativos.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const bruto = vi.hoisted(() => ({ produtos: [], lotesNota: [] }));
const armazenamento = vi.hoisted(() => new Map());

// ── Fonte do MAPA: mapaCacheService com as APIs falsas (mesma lista bruta) ──
vi.mock('@/components/offline/IndexedDBManager', () => ({
  getEntityCacheItems: vi.fn(async (k, e) => armazenamento.get(`${k}::${e}`)),
  setEntityCacheItems: vi.fn(async (k, e, items) => { armazenamento.set(`${k}::${e}`, items); }),
  getEntityCacheRecord: vi.fn(async () => null),
}));
vi.mock('@/apis/mapa', () => ({
  listAreas: async () => [],
  listPontos: async () => [],
  listPontosSuplementacao: async () => [],
  listLinhas: async () => [],
  listIcones: async () => [],
}));
vi.mock('@/apis/lotes', () => ({
  listLotes: async () => [],
  listarPosicoesRebanhoServidor: async () => ({ ativo: false, data_corte: null, itens: [] }),
  listMovimentacoes: async () => [],
  listSuplementacaoEventos: async () => [],
  listSuplementacaoLotes: async () => [],
}));
vi.mock('@/apis/estoque', () => ({
  listLotesNota: async () => bruto.lotesNota,
  listMovimentacoes: async () => [],
  listProdutos: async () => bruto.produtos,
}));
vi.mock('@/apis/tarefas', () => ({ listLancamentos: async () => [], listHistorico: async () => [] }));
// O detalhe do depósito lê as leituras de cocho (farol dos cochos vinculados) pelo mesmo cache.
vi.mock('@/apis/leituras-cocho', () => ({ listLeiturasCocho: async () => [], createLeituraCocho: vi.fn(), deleteLeituraCocho: vi.fn() }));
vi.mock('@/apis/session', () => ({ listPermissoes: async () => [] }));
vi.mock('@/apis/rebanho', () => ({
  listAplicacoesMedicamento: async () => [],
  listEventosSanitarios: async () => [],
  listManejosTecnicos: async () => [],
}));

// ── Fonte do DETALHE do depósito: os serviços da tela, com a MESMA lista bruta ──
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => bruto.lotesNota),
  listarTodosProdutos: vi.fn(async () => bruto.produtos),
  listarTodasMovimentacoes: vi.fn(async () => []),
}));
vi.mock('@/services/mapaService', () => ({
  listarPontosSuplementacaoAtivos: vi.fn(async () => []),
  listarAreasAtivas: vi.fn(async () => []),
  listarIconesPorTipoEntidade: vi.fn(async () => []),
}));
vi.mock('@/services/loteManejoService', () => ({ listarTodosLotes: vi.fn(async () => []) }));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => []) }));
vi.mock('@/components/mapa/FormularioTransferenciaDeposito', () => ({ default: () => null }));
// A linha do tempo do detalhe usa a regra (pura) do histórico; só o componente do histórico completo sai.
vi.mock('@/components/suplementacao/HistoricoDepositoSuplementacao', async (importOriginal) => ({ ...(await importOriginal()), default: () => null }));

const { getDepositoIndicator } = await import('@/components/mapa/pontoStatusUtils');
const { buildMapaAlertasSuplementacao } = await import('@/components/mapa/mapaAlertasSuplementacaoUtils');
const { calcularNivelCocho } = await import('@/domain/suplementacao/nivelSuplementacao');
const { refreshMapaCacheEntry, __resetMapaCachePolicy } = await import('@/services/mapaCacheService');
const { formatarKgNivel } = await import('@/domain/suplementacao/nivelSuplementacao');
const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');

const RACAO = { id: 'pr-racao', empresa_id: 'emp-1', nome_produto: 'RAÇÃO', unidade_principal_estoque: 'KG', peso_por_saco_kg: 30, ativo: true, percentual_consumo_pv: 0.1 };
const OLEO_INATIVO = { id: 'pr-oleo', empresa_id: 'emp-1', nome_produto: 'ÓLEO MINERAL', unidade_principal_estoque: 'L', ativo: false, percentual_consumo_pv: 5 };
const deposito = (extra = {}) => ({
  id: 'dep1', empresa_id: 'emp-1', nome_ponto: 'DEPÓSITO SEDE', categoria_ponto: 'DEPOSITO', status: 'Ativo', local_estoque_id: 'loc1',
  capacidade_cocho_kg: 300, estoque_minimo_kg: 100, ...extra,
});
const loteNota = (id, produto, qtd) => ({
  id, empresa_id: 'emp-1', produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: 'loc1', quantidade_disponivel: qtd, status: 'Disponivel',
});

beforeEach(() => {
  armazenamento.clear();
  __resetMapaCachePolicy();
  bruto.produtos = [RACAO];
  bruto.lotesNota = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FU — mapa, detalhes e alertas na mesma fonte (D-PROD-178)', () => {
  it('FU-1 — getDepositoIndicator: todo número sai do nível do SSOT, sem estimativa paralela de consumo', () => {
    const cochoLigado = { id: 'c1', categoria_ponto: 'COCHO', deposito_origem_id: 'dep1', area_vinculada_ids: ['a1'], consumo_ideal_por_cabeca_kg: 2 };
    const loteGado = { id: 'g1', status: 'Ativo', area_atual_id: 'a1', quantidade_cabecas: 100 };
    const casos = [
      deposito(),
      deposito({ capacidade_cocho_kg: -300, estoque_minimo_kg: -50 }),
      deposito({ capacidade_cocho_kg: '300', estoque_minimo_kg: '100' }),
      deposito({ capacidade_cocho_kg: null, estoque_minimo_kg: null }),
    ];
    for (const dep of casos) {
      const ind = getDepositoIndicator(dep, [cochoLigado], [loteGado], [loteNota('l1', RACAO, 150)], [], [RACAO]);
      const n = ind.nivel;
      expect(ind.percent).toBe(n.fracaoParaSvg);
      expect(ind.saldoAtual).toBe(n.saldoKg);
      expect(ind.capacidadeDeposito).toBe(n.limiteOperacionalKg ?? 0);
      expect(ind.estoqueMinimo).toBe(n.estoqueMinimoKg ?? 0);
      expect(ind.necessidadeReposicao).toBe(n.necessidadeReposicaoKg);
      expect(ind.isCritical).toBe(n.abaixoMinimo);
      // Só estes números existem no indicador: nenhum outro cálculo fora do SSOT.
      const numericos = Object.keys(ind).filter((k) => typeof ind[k] === 'number').sort();
      expect(numericos).toEqual(['capacidadeDeposito', 'estoqueMinimo', 'necessidadeReposicao', 'percent', 'saldoAtual']);
    }
  });

  it('FU-2 — alertasPonto do depósito: o mínimo é o do nível (campo cru inválido não vaza)', () => {
    const r = buildMapaAlertasSuplementacao({
      pontosSuplementacao: [deposito({ estoque_minimo_kg: -50 })],
      estoqueLotes: [loteNota('l1', RACAO, 150)],
      produtos: [RACAO],
      hoje: '2026-11-12',
    });
    const info = r.alertasPonto.get('dep1');
    expect(info.estoqueMinimo).toBe(info.nivel.estoqueMinimoKg ?? 0);
    expect(info.estoqueMinimo).toBe(0);
    expect(info.saldoAtual).toBe(info.nivel.saldoKg);
  });

  it('FU-3 — duração do ciclo estimada vem do SSOT (base ÷ taxa), só quando a estimativa é confiável', () => {
    const cocho = { id: 'c1', empresa_id: 'emp-1', categoria_ponto: 'COCHO', status: 'Ativo', area_vinculada_ids: ['a1'], capacidade_cocho_kg: 120 };
    const ev = (extra = {}) => ({ id: 'e1', empresa_id: 'emp-1', ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-11', produto: 'SAL', quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: 50, ...extra });
    expect(calcularNivelCocho({ ponto: cocho, eventos: [ev()], hoje: '2026-11-12' }).duracaoCicloEstimadaDias).toBe(4);
    expect(calcularNivelCocho({ ponto: cocho, eventos: [ev({ consumo_esperado_pv_kg: 30 })], hoje: '2026-11-12' }).duracaoCicloEstimadaDias).toBeCloseTo(200 / 30, 10);
    expect(calcularNivelCocho({ ponto: cocho, eventos: [ev({ consumo_esperado_pv_kg: null })], hoje: '2026-11-12' }).duracaoCicloEstimadaDias).toBeNull();
    expect(calcularNivelCocho({ ponto: cocho, eventos: [ev({ dias_periodo: 3, sobra_kg: 30 })], hoje: '2026-11-12' }).duracaoCicloEstimadaDias).toBeNull();
    expect(calcularNivelCocho({ ponto: cocho, eventos: [ev({ quantidade_total_kg: 0 })], hoje: '2026-11-12' }).duracaoCicloEstimadaDias).toBeNull();
    expect(calcularNivelCocho({ ponto: cocho, eventos: [], hoje: '2026-11-12' }).duracaoCicloEstimadaDias).toBeNull();
    const outro = { ...cocho, id: 'c2' };
    const compartilhado = calcularNivelCocho({ ponto: cocho, eventos: [ev(), ev({ id: 'e2', ponto_suplementacao_id: 'c2' })], hoje: '2026-11-12', pontos: [cocho, outro] });
    expect(compartilhado.confiabilidade).toBe('compartilhada');
    expect(compartilhado.duracaoCicloEstimadaDias).toBeNull();
  });

  it('FU-4 — Produto INATIVO em litros no depósito: marcador do mapa e detalhe mostram o MESMO saldo e percentual', async () => {
    bruto.produtos = [RACAO, OLEO_INATIVO];
    bruto.lotesNota = [loteNota('l1', RACAO, 150), loteNota('l2', OLEO_INATIVO, 100)];
    const dep = deposito();

    // Caminho do MAPA: capacidades do cache do mapa → SSOT.
    const produtosMapa = await refreshMapaCacheEntry('produtos', 'emp-1');
    const estoqueMapa = await refreshMapaCacheEntry('estoqueLotes', 'emp-1');
    const nivelMapa = getDepositoIndicator(dep, [], [], estoqueMapa, [], produtosMapa).nivel;
    expect(nivelMapa.saldoKg).toBe(150);
    expect(nivelMapa.lotesEmLitrosIgnorados).toBe(1);
    expect(nivelMapa.unidadesConfirmadas).toBe(true);
    expect(nivelMapa.ocupacaoPercentual).toBe(50);

    // Caminho do DETALHE: a tela com os serviços dela.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DetalhesDepositoSuplementacao deposito={dep} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const secao = await screen.findByRole('region', { name: 'Nível do depósito' });
    const medidor = within(secao).getByRole('meter', { name: 'Ocupação do limite operacional' });
    await waitFor(() => expect(medidor.getAttribute('aria-valuenow')).toBe(String(nivelMapa.ocupacaoPercentual)));
    // D-PROD-220: a célula do v12 mostra o kg no formato do SSOT ("150 kg").
    expect(within(secao).getByText('Saldo atual kg').nextElementSibling?.textContent).toBe(formatarKgNivel(nivelMapa.saldoKg));
    expect(within(secao).queryByText(nivelMapa.mensagemUnidade ?? '— sem aviso de unidade —')).toBeNull();
    expect(screen.queryByText(/Unidade de alguns produtos não confirmada/)).toBeNull();
  });

  it('FU-5 — alertas de LOTE iguais com ou sem produtos inativos (fallback do maior %PV só entre ativos)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    const cocho = { id: 'c1', empresa_id: 'emp-1', categoria_ponto: 'COCHO', status: 'Ativo', area_vinculada_ids: ['a1'] };
    const evSemTaxa = { id: 'e1', empresa_id: 'emp-1', ponto_suplementacao_id: 'c1', data_lancamento: '2026-11-01', produto: 'RAÇÃO', quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: null };
    const loteGado = { id: 'g1', status: 'Ativo', area_atual_id: 'a1', quantidade_cabecas: 100, peso_medio_kg: 300 };
    const entrada = { lotes: [loteGado], pontosSuplementacao: [cocho], eventosSupl: [evSemTaxa], estoqueLotes: [], hoje: '2026-11-04' };
    const soAtivos = buildMapaAlertasSuplementacao({ ...entrada, produtos: [RACAO] });
    const comInativos = buildMapaAlertasSuplementacao({ ...entrada, produtos: [RACAO, OLEO_INATIVO] });
    expect(comInativos.alertasLote.get('g1')).toEqual(soAtivos.alertasLote.get('g1'));
  });
});
