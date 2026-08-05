/**
 * Services de suplementação (P1.4).
 *
 * Migração de fronteira, não reescrita de domínio: o que se prova aqui é que o
 * I/O saiu dos arquivos `Utils` sem mudar o resultado — FIFO, baixa,
 * transferência pareada, reversão por custo, fechamento e reabertura de período.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const suplementacao = {
  listEventos: vi.fn(), filterEventos: vi.fn(), createEvento: vi.fn(), updateEvento: vi.fn(), deleteEvento: vi.fn(),
  listLotesSuplementacao: vi.fn(), bulkCreateLotesSuplementacao: vi.fn(),
  updateLoteSuplementacao: vi.fn(), deleteLoteSuplementacao: vi.fn(),
  listMovimentacoesEstoque: vi.fn(), createMovimentacaoEstoque: vi.fn(),
  updateMovimentacaoEstoque: vi.fn(), deleteMovimentacaoEstoque: vi.fn(),
  listLotesNota: vi.fn(), filterLotesNota: vi.fn(), createLoteNota: vi.fn(),
  updateLoteNota: vi.fn(), deleteLoteNota: vi.fn(),
  listProdutos: vi.fn(), updateProduto: vi.fn(),
  listLotesRebanho: vi.fn(), listMovimentacoesPecuarias: vi.fn(),
  listAreas: vi.fn(), listPontosSuplementacao: vi.fn(),
  MOVIMENTACAO_RECENTE_ORDER: '-created_date',
  MOVIMENTACAO_RECENTE_LIMIT: 200,
};

vi.mock('@/apis/suplementacao', () => suplementacao);

const estoqueSvc = await import('@/services/suplementacaoEstoqueService');
const historicoSvc = await import('@/services/suplementacaoHistoricoService');
const supSvc = await import('@/services/suplementacaoService');
const puros = await import('@/components/suplementacao/estoqueSuplementacaoUtils');
const consumo = await import('@/components/utils/consumoUtils');
const { API_ERROR_CODES, hasApiErrorCode } = await import('@/apis/_core/ApiError');

const EMPRESA = 'emp-1';
const PRODUTO = {
  id: 'prod-1', nome_produto: 'MILHO', estoque_atual: 100, preco_custo: 2,
  unidade_medida: 'KG', local_estoque: 'GALPÃO',
};

/** Dois lotes no mesmo local, com datas que definem a ordem FIFO. */
const lotesNota = () => [
  { id: 'lote-antigo', empresa_id: EMPRESA, produto_id: 'prod-1', local_estoque_id: 'loc-1', status: 'Disponivel', quantidade_disponivel: 60, custo_unitario: 2, data_documento: '2026-01-01', numero_documento: 'NF1' },
  { id: 'lote-novo', empresa_id: EMPRESA, produto_id: 'prod-1', local_estoque_id: 'loc-1', status: 'Disponivel', quantidade_disponivel: 40, custo_unitario: 3, data_documento: '2026-02-01', numero_documento: 'NF2' },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(suplementacao)) {
    if (typeof fn?.mockResolvedValue === 'function') fn.mockResolvedValue([]);
  }
  suplementacao.createMovimentacaoEstoque.mockImplementation(async (d) => ({ id: `mov-${d.tipo_movimentacao}`, ...d }));
  suplementacao.createEvento.mockImplementation(async (d) => ({ id: 'evt-1', ...d }));
  suplementacao.createLoteNota.mockImplementation(async (d) => ({ id: 'novo-lote', ...d }));
});

// ── Cálculo puro ──────────────────────────────────────────────────────────

describe('SF — FIFO puro', () => {
  it('SF1 — consome o lote mais antigo primeiro e pondera o custo', () => {
    const r = puros.calcularRateioFIFO({ lotesNota: lotesNota(), produtoId: 'prod-1', localEstoqueId: 'loc-1', quantidade: 80 });
    expect(r.sucesso).toBe(true);
    expect(r.rateio.map((i) => [i.lote_id, i.quantidade_consumida])).toEqual([
      ['lote-antigo', 60], ['lote-novo', 20],
    ]);
    // (60×2 + 20×3) / 80
    expect(r.custoMedioPonderado).toBeCloseTo(2.25, 6);
  });

  it('SF2 — quantidade acima do saldo recusa com mensagem de domínio', () => {
    const r = puros.calcularRateioFIFO({ lotesNota: lotesNota(), produtoId: 'prod-1', localEstoqueId: 'loc-1', quantidade: 500 });
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/Saldo insuficiente/);
    expect(r.rateio).toEqual([]);
  });

  it('SF3 — lote sem data válida bloqueia o FIFO em vez de adivinhar a ordem', () => {
    const r = puros.calcularRateioFIFO({
      lotesNota: [{ id: 'x', produto_id: 'prod-1', local_estoque_id: 'loc-1', quantidade_disponivel: 10, data_documento: 'não é data' }],
      produtoId: 'prod-1', localEstoqueId: 'loc-1', quantidade: 5,
    });
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/sem data válida/);
  });

  it('SF4 — a validação reúne rateio, divergência e saldo negativo', () => {
    const ok = puros.validarBaixaFIFO({ lotesNota: lotesNota(), produto: PRODUTO, localEstoqueId: 'loc-1', quantidade: 10 });
    expect(ok.ok).toBe(true);
    expect(ok.saldoAntes).toBe(100);

    const semLote = puros.validarBaixaFIFO({ lotesNota: [], produto: PRODUTO, localEstoqueId: 'loc-1', quantidade: 10 });
    expect(semLote.ok).toBe(false);
    expect(semLote.motivo).toBe('rateio_inviavel');
  });

  it('SF5 — divergência entre lotes e cadastro é detectada', () => {
    const r = puros.conferirDivergenciaEstoque({ lotesNota: lotesNota(), produtoId: 'prod-1', localEstoqueId: 'loc-1', saldoProduto: 90 });
    expect(r.saldoLotes).toBe(100);
    expect(r.inconsistente).toBe(true);
  });

  it('SF6 — o número de movimentação é max + 1 sobre a lista recebida', () => {
    expect(puros.proximoNumeroDeMovimentacao([{ numero_movimentacao: '7' }, { numero_movimentacao: '19' }])).toBe(20);
    expect(puros.proximoNumeroDeMovimentacao([])).toBe(1);
  });
});

// ── Baixa e transferência ─────────────────────────────────────────────────

describe('SB — baixa de suplementação', () => {
  it('SB1 — cria a movimentação, baixa os lotes e ajusta o estoque do produto', async () => {
    suplementacao.filterLotesNota.mockImplementation(async ({ id }) =>
      lotesNota().filter((l) => l.id === id)
    );
    suplementacao.listMovimentacoesEstoque.mockResolvedValue([{ numero_movimentacao: '5' }]);

    const r = await estoqueSvc.registrarSaidaSuplementacao({
      empresaId: EMPRESA, userEmail: 'a@b.c', produto: PRODUTO, quantidade: 80,
      localOrigemId: 'loc-1', localOrigemNome: 'GALPÃO', lotesNota: lotesNota(),
      dataMovimentacao: '2026-03-01',
    });

    expect(suplementacao.createMovimentacaoEstoque).toHaveBeenCalledWith(expect.objectContaining({
      numero_movimentacao: '6', tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao',
      quantidade: 80, saldo_antes: 100, saldo_depois: 20, origem_sistema: 'suplementacao',
      exclusao_somente_em: 'cocho', usuario_responsavel: 'a@b.c',
      data_movimentacao: '2026-03-01T12:00:00.000Z',
    }));
    expect(suplementacao.updateLoteNota).toHaveBeenCalledWith('lote-antigo', { quantidade_disponivel: 0, status: 'Esgotado' });
    expect(suplementacao.updateLoteNota).toHaveBeenCalledWith('lote-novo', { quantidade_disponivel: 20, status: 'Disponivel' });
    expect(suplementacao.updateProduto).toHaveBeenCalledWith('prod-1', { estoque_atual: 20 });
    expect(r.rateio).toHaveLength(2);
  });

  it('SB2 — a observação carrega o rateio FIFO', async () => {
    suplementacao.filterLotesNota.mockImplementation(async ({ id }) => lotesNota().filter((l) => l.id === id));
    await estoqueSvc.registrarSaidaSuplementacao({
      empresaId: EMPRESA, produto: PRODUTO, quantidade: 10,
      localOrigemId: 'loc-1', localOrigemNome: 'GALPÃO', lotesNota: lotesNota(), observacoes: 'obs',
    });
    const payload = suplementacao.createMovimentacaoEstoque.mock.calls[0][0];
    expect(payload.observacoes).toContain('[RATEIO_FIFO]');
    expect(payload.observacoes).toContain('NF1');
  });

  it('SB3 — saldo insuficiente recusa antes de qualquer escrita', async () => {
    await expect(
      estoqueSvc.registrarSaidaSuplementacao({
        empresaId: EMPRESA, produto: PRODUTO, quantidade: 5000,
        localOrigemId: 'loc-1', localOrigemNome: 'GALPÃO', lotesNota: lotesNota(),
      })
    ).rejects.toSatisfy((erro) => hasApiErrorCode(erro, API_ERROR_CODES.INVALID_ARGUMENT));
    expect(suplementacao.createMovimentacaoEstoque).not.toHaveBeenCalled();
  });

  it('SB4 — falha depois da movimentação vira erro parcial com as etapas', async () => {
    suplementacao.filterLotesNota.mockRejectedValue(new Error('rede'));
    await expect(
      estoqueSvc.registrarSaidaSuplementacao({
        empresaId: EMPRESA, produto: PRODUTO, quantidade: 10,
        localOrigemId: 'loc-1', localOrigemNome: 'GALPÃO', lotesNota: lotesNota(),
      })
    ).rejects.toSatisfy(
      (erro) => hasApiErrorCode(erro, API_ERROR_CODES.SUPLEMENTACAO_PARTIAL_OPERATION)
        && erro.details.etapas.includes('movimentacao')
    );
  });
});

describe('ST — transferência entre locais', () => {
  it('ST1 — saída e entrada pareadas, com vínculo e lotes recriados no destino', async () => {
    suplementacao.filterLotesNota.mockImplementation(async ({ id }) => lotesNota().filter((l) => l.id === id));
    suplementacao.listMovimentacoesEstoque.mockResolvedValue([{ numero_movimentacao: '10' }]);

    const r = await estoqueSvc.registrarTransferenciaEntreLocais({
      empresaId: EMPRESA, produto: PRODUTO, quantidade: 70,
      localOrigemId: 'loc-1', localOrigemNome: 'GALPÃO',
      localDestinoId: 'loc-2', localDestinoNome: 'COCHO', lotesNota: lotesNota(),
    });

    const [saida, entrada] = suplementacao.createMovimentacaoEstoque.mock.calls.map(([d]) => d);
    expect(saida).toMatchObject({ numero_movimentacao: '11', tipo_detalhado: 'transferencia_enviada', is_registro_principal: true });
    expect(entrada).toMatchObject({ numero_movimentacao: '12', tipo_detalhado: 'transferencia_recebida', movimento_pai_id: 'mov-Saída' });
    expect(suplementacao.updateMovimentacaoEstoque).toHaveBeenCalledWith('mov-Saída', { movimento_filho_id: 'mov-Entrada' });

    // Um lote no destino por faixa de custo, preservando a origem documental.
    const criados = suplementacao.createLoteNota.mock.calls.map(([d]) => d);
    expect(criados.map((c) => [c.numero_documento, c.quantidade_entrada, c.custo_unitario])).toEqual([
      ['NF1', 60, 2], ['NF2', 10, 3],
    ]);
    expect(r.rateio).toHaveLength(2);
  });

  it('ST2 — sem lote no local, o saldo do produto vira lote SALDO-INICIAL', async () => {
    suplementacao.filterLotesNota.mockImplementation(async () => []);
    suplementacao.createLoteNota.mockImplementation(async (d) => ({
      id: 'saldo-inicial', ...d,
      // devolve como lote disponível para o rateio seguinte
      empresa_id: EMPRESA, status: 'Disponivel', produto_id: 'prod-1',
      local_estoque_id: 'loc-1', quantidade_disponivel: d.quantidade_disponivel,
    }));

    await estoqueSvc.registrarTransferenciaEntreLocais({
      empresaId: EMPRESA, produto: PRODUTO, quantidade: 10,
      localOrigemId: 'loc-1', localOrigemNome: 'GALPÃO',
      localDestinoId: 'loc-2', localDestinoNome: 'COCHO', lotesNota: [],
    });

    const primeiro = suplementacao.createLoteNota.mock.calls[0][0];
    expect(primeiro).toMatchObject({ numero_documento: 'SALDO-INICIAL', serie_documento: 'INI', quantidade_entrada: 100 });
  });
});

// ── Reversão ──────────────────────────────────────────────────────────────

describe('SR — reversão', () => {
  it('SR1 — restauração prefere lote com custo compatível', async () => {
    suplementacao.listLotesNota.mockResolvedValue([
      { id: 'l1', produto_id: 'prod-1', local_estoque_id: 'loc-1', custo_unitario: 2, quantidade_disponivel: 5 },
    ]);
    suplementacao.listProdutos.mockResolvedValue([{ id: 'prod-1', estoque_atual: 50 }]);

    await historicoSvc.restaurarEstoqueNoLocal({
      empresaId: EMPRESA, produtoId: 'prod-1', produtoNome: 'MILHO', quantidade: 10,
      localEstoqueId: 'loc-1', localEstoqueNome: 'GALPÃO', custoUnitario: 2,
    });

    expect(suplementacao.updateLoteNota).toHaveBeenCalledWith('l1', { quantidade_disponivel: 15, status: 'Disponivel' });
    expect(suplementacao.createLoteNota).not.toHaveBeenCalled();
    expect(suplementacao.updateProduto).toHaveBeenCalledWith('prod-1', { estoque_atual: 60 });
  });

  it('SR2 — sem custo compatível, cria lote REVERSAO', async () => {
    suplementacao.listLotesNota.mockResolvedValue([
      { id: 'l1', produto_id: 'prod-1', local_estoque_id: 'loc-1', custo_unitario: 9, quantidade_disponivel: 5 },
    ]);
    await historicoSvc.restaurarEstoqueNoLocal({
      empresaId: EMPRESA, produtoId: 'prod-1', produtoNome: 'MILHO', quantidade: 10,
      localEstoqueId: 'loc-1', localEstoqueNome: 'GALPÃO', custoUnitario: 2,
    });
    expect(suplementacao.createLoteNota).toHaveBeenCalledWith(expect.objectContaining({
      numero_documento: 'REVERSAO', serie_documento: 'REV', quantidade_disponivel: 10,
    }));
  });

  it('SR3 — excluir evento apaga lotes, reabre o período anterior e reverte o estoque', async () => {
    const evento = { id: 'e2', empresa_id: EMPRESA, ponto_suplementacao_id: 'p1', movimentacao_estoque_id: 'mov-9', data_lancamento: '2026-03-01' };
    suplementacao.listLotesSuplementacao.mockResolvedValue([
      { id: 'sl1', suplementacao_evento_id: 'e2' },
      { id: 'sl0', suplementacao_evento_id: 'e1' },
    ]);
    suplementacao.listEventos.mockResolvedValue([
      evento,
      { id: 'e1', empresa_id: EMPRESA, ponto_suplementacao_id: 'p1', data_lancamento: '2026-02-01' },
    ]);
    suplementacao.listMovimentacoesEstoque.mockResolvedValue([
      { id: 'mov-9', produto_id: 'prod-1', quantidade: 10, local_estoque_origem: 'loc-1', local_origem: 'GALPÃO', valor_unitario: 2 },
    ]);

    const r = await historicoSvc.excluirEventoSuplementacaoComReversao({
      evento, ponto: { deposito_origem_id: 'd1' },
    });

    expect(suplementacao.deleteLoteSuplementacao).toHaveBeenCalledWith('sl1');
    expect(suplementacao.deleteLoteSuplementacao).not.toHaveBeenCalledWith('sl0');
    expect(suplementacao.updateEvento).toHaveBeenCalledWith('e1', { dias_periodo: null, consumo_diario_grupo_kg: null });
    expect(suplementacao.deleteMovimentacaoEstoque).toHaveBeenCalledWith('mov-9');
    expect(suplementacao.deleteEvento).toHaveBeenCalledWith('e2');
    expect(r.etapas).toContain('evento_excluido');
  });

  it('SR4 — falha no meio da reversão vira erro parcial com as etapas concluídas', async () => {
    const evento = { id: 'e2', empresa_id: EMPRESA, ponto_suplementacao_id: 'p1' };
    suplementacao.listLotesSuplementacao.mockResolvedValue([{ id: 'sl1', suplementacao_evento_id: 'e2' }]);
    suplementacao.listEventos.mockRejectedValue(new Error('rede'));

    await expect(
      historicoSvc.excluirEventoSuplementacaoComReversao({ evento, ponto: {} })
    ).rejects.toSatisfy(
      (erro) => hasApiErrorCode(erro, API_ERROR_CODES.SUPLEMENTACAO_PARTIAL_OPERATION)
        && erro.details.etapas.includes('lotes_do_evento')
    );
  });

  it('SR5 — transferência revertida devolve só o saldo disponível', async () => {
    const entrada = {
      id: 'mov-in', tipo_movimentacao: 'Entrada', movimento_pai_id: 'mov-out',
      empresa_id: EMPRESA, produto_id: 'prod-1', produto_nome: 'MILHO',
      local_estoque_origem: 'loc-1', local_origem: 'GALPÃO', quantidade: 50, valor_unitario: 2,
    };
    suplementacao.listMovimentacoesEstoque.mockResolvedValue([
      entrada, { id: 'mov-out', tipo_movimentacao: 'Saída', movimento_filho_id: 'mov-in' },
    ]);
    suplementacao.listLotesNota.mockResolvedValue([
      // 50 chegaram, 30 já foram consumidos no destino: só 20 voltam.
      { id: 'dest-1', movimentacao_entrada_id: 'mov-in', custo_unitario: 2, quantidade_disponivel: 20 },
      { id: 'orig-1', produto_id: 'prod-1', local_estoque_id: 'loc-1', custo_unitario: 2, quantidade_disponivel: 5 },
    ]);

    const r = await historicoSvc.excluirTransferenciaDeposito({ movimentacao: entrada });

    expect(suplementacao.deleteLoteNota).toHaveBeenCalledWith('dest-1');
    expect(suplementacao.updateLoteNota).toHaveBeenCalledWith('orig-1', { quantidade_disponivel: 25, status: 'Disponivel' });
    expect(suplementacao.deleteMovimentacaoEstoque).toHaveBeenCalledWith('mov-in');
    expect(suplementacao.deleteMovimentacaoEstoque).toHaveBeenCalledWith('mov-out');
    expect(r.etapas).toContain('saida_excluida');
  });

  it('SR6 — transferência sem entrada localizada é argumento inválido', async () => {
    suplementacao.listMovimentacoesEstoque.mockResolvedValue([]);
    await expect(
      historicoSvc.excluirTransferenciaDeposito({ movimentacao: { id: 'x', tipo_movimentacao: 'Saída' } })
    ).rejects.toSatisfy((erro) => hasApiErrorCode(erro, API_ERROR_CODES.INVALID_ARGUMENT));
  });
});

// ── Período ───────────────────────────────────────────────────────────────

describe('SP — fechamento e reabertura de período', () => {
  it('SP1 — consumo é fornecido − sobra final + sobra inicial', () => {
    const r = consumo.calcularConsumo({ fornecido: 100, sobraFinal: 10, sobraInicial: 5, diasPeriodo: 5, totalCabecas: 10 });
    expect(r.consumoTotal).toBe(95);
    expect(r.consumoDiarioGrupo).toBe(19);
    expect(r.consumoPorCabecaDia).toBe(1.9);
  });

  it('SP2 — o fechamento grava o evento e depois cada lote', async () => {
    const evento = { id: 'e1', quantidade_total_kg: 100, total_cabecas_afetadas: 10, sobra_kg: 0, data_lancamento: '2026-03-01' };
    suplementacao.listLotesSuplementacao.mockResolvedValue([
      { id: 'sl1', suplementacao_evento_id: 'e1', lote_id: 'l1', cabecas_na_area: 10 },
    ]);

    const progresso = [];
    const r = await supSvc.fecharPeriodoSuplementacao({
      evento, diasPeriodo: 5, sobraFinal: 10, sobraInicial: 0, onProgress: (m) => progresso.push(m),
    });

    expect(suplementacao.updateEvento).toHaveBeenCalledWith('e1', {
      sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 18,
    });
    expect(suplementacao.updateLoteSuplementacao).toHaveBeenCalledWith('sl1', expect.objectContaining({
      dias_periodo: 5, percentual_consumo_lote: 1,
    }));
    expect(progresso).toEqual(['Atualizando lotes do período...']);
    expect(r.consumoTotal).toBe(90);
  });

  it('SP2b — evento sem data de lançamento cai no rateio simples, sem estourar', async () => {
    suplementacao.listLotesSuplementacao.mockResolvedValue([
      { id: 'sl1', suplementacao_evento_id: 'e1', lote_id: 'l1', cabecas_na_area: 10 },
    ]);
    const r = await supSvc.fecharPeriodoSuplementacao({
      evento: { id: 'e1', quantidade_total_kg: 100, total_cabecas_afetadas: 10 },
      diasPeriodo: 5, sobraFinal: 10, sobraInicial: 0,
    });
    expect(r.consumoTotal).toBe(90);
    expect(suplementacao.updateLoteSuplementacao).toHaveBeenCalled();
  });

  it('SP3 — reabrir remove as métricas do evento e de cada lote', async () => {
    await supSvc.reabrirPeriodoSuplementacao({
      eventoId: 'e1',
      lotesSupl: [{ id: 'sl1', suplementacao_evento_id: 'e1' }, { id: 'sl2', suplementacao_evento_id: 'e2' }],
    });
    expect(suplementacao.updateEvento).toHaveBeenCalledWith('e1', { dias_periodo: null, consumo_diario_grupo_kg: null });
    expect(suplementacao.updateLoteSuplementacao).toHaveBeenCalledTimes(1);
    expect(suplementacao.updateLoteSuplementacao).toHaveBeenCalledWith('sl1', {
      dias_periodo: null, consumo_unitario_dia: null,
      consumo_por_cabeca_dia_kg: null, consumo_total_lote_periodo_kg: null,
    });
  });

  it('SP4 — o lançamento cria o evento e vincula os lotes ao id gerado', async () => {
    await supSvc.registrarLancamento({
      evento: { ponto_suplementacao_id: 'p1' },
      lotes: [{ lote_id: 'l1' }, { lote_id: 'l2' }],
    });
    expect(suplementacao.bulkCreateLotesSuplementacao).toHaveBeenCalledWith([
      { lote_id: 'l1', suplementacao_evento_id: 'evt-1' },
      { lote_id: 'l2', suplementacao_evento_id: 'evt-1' },
    ]);
  });

  it('SP5 — lançamento sem lotes não chama o bulkCreate', async () => {
    await supSvc.registrarLancamento({ evento: {}, lotes: [] });
    expect(suplementacao.bulkCreateLotesSuplementacao).not.toHaveBeenCalled();
  });

  it('SP6 — o último evento do ponto vem do filtro ordenado, com limite 1', async () => {
    suplementacao.filterEventos.mockResolvedValue([{ id: 'e9' }]);
    expect(await supSvc.ultimoEventoDoPonto({ empresaId: EMPRESA, pontoId: 'p1' })).toEqual({ id: 'e9' });
    expect(suplementacao.filterEventos).toHaveBeenCalledWith(
      { empresa_id: EMPRESA, ponto_suplementacao_id: 'p1' },
      { order: '-data_lancamento', limit: 1 }
    );
  });
});
