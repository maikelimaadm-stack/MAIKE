/**
 * Manejo de lote iniciado pelo mapa (P1.2).
 *
 * `DetalhesLote.jsx` tem 1.289 linhas de interface. Aqui se testa o que saiu
 * dela — a orquestração e a regra —, não a árvore de componentes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const lotesApi = {
  listLotes: vi.fn(), filterLotes: vi.fn(), createLote: vi.fn(), updateLote: vi.fn(),
  createMovimentacao: vi.fn(), deleteMovimentacao: vi.fn(),
  listMovimentacoes: vi.fn(), listTodasMovimentacoes: vi.fn(),
  filterMovimentacoes: vi.fn(), filterSuplementacaoLotes: vi.fn(),
  createSuplementacaoEvento: vi.fn(), bulkCreateSuplementacaoLote: vi.fn(),
};
vi.mock('@/apis/lotes', () => lotesApi);
vi.mock('@/apis/estoque', () => ({ filterProdutos: vi.fn().mockResolvedValue([]) }));

/** Provider sintético: nenhuma chamada real de SDK sai daqui. */
const provider = { bulkCreateSuplementacaoLote: vi.fn() };
vi.mock('@/apis/_providers/base44Provider.js', () => ({ lotesProvider: provider }));

/**
 * Fonte sem comentários.
 *
 * As asserções abaixo falam sobre **código**. Um comentário que cita `window`
 * para explicar que o módulo não o usa não pode reprovar o teste — seria o
 * próprio texto explicativo virando falso positivo.
 */
const codigoDe = async (rel) =>
  (await import('node:fs'))
    .readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const service = await import('@/services/loteManejoService');
const { existeLancamentoPosterior, isPosterior } = await import('@/domain/lotes/ordemTemporal');
const {
  encontrarLoteDestinoCompativel,
  encontrarLoteFilhote,
  categoriaDoFilhote,
  modoDaMovimentacao,
  saldoEStatusDaOrigem,
  quantidadeAplicavel,
  pesoAplicavel,
  ganhoDePeso,
} = await import('@/domain/lotes/movimentacaoLote');
const { API_ERROR_CODES, hasApiErrorCode } = await import('@/apis/_core/ApiError');

beforeEach(() => {
  vi.clearAllMocks();
  lotesApi.filterMovimentacoes.mockResolvedValue([]);
  lotesApi.filterSuplementacaoLotes.mockResolvedValue([]);
});

describe('regra pura de ordem temporal', () => {
  it('data posterior é detectada', () => {
    expect(isPosterior('2026-02-10', '2026-02-01')).toBe(true);
    expect(isPosterior('2026-01-10', '2026-02-01')).toBe(false);
  });

  it('lista vazia nunca bloqueia', () => {
    expect(existeLancamentoPosterior([], '2026-02-01')).toBe(false);
    expect(existeLancamentoPosterior(undefined, '2026-02-01')).toBe(false);
  });

  it('movimentação posterior bloqueia', () => {
    expect(existeLancamentoPosterior([{ data_movimentacao: '2026-03-01' }], '2026-02-01')).toBe(true);
  });

  it('suplementação posterior bloqueia', () => {
    expect(existeLancamentoPosterior([{ data_lancamento: '2026-03-01' }], '2026-02-01')).toBe(true);
  });

  it('a regra é pura: não importa provider, React nem storage', async () => {
    const fonte = await codigoDe('src/domain/lotes/ordemTemporal.js');
    expect(fonte).not.toMatch(/@\/apis|base44|react|localStorage|window/i);
  });
});

describe('DL1–DL5 — decisão da movimentação', () => {
  const DESTINO = 'area-destino';
  const origem = { id: 'l1', nome: 'Boiada A', categoria: 'Novilho', quantidade_cabecas: 30, status: 'Ativo' };
  const compativel = {
    id: 'd1', nome: 'BOIADA A', categoria: 'NOVILHO', quantidade_cabecas: 12,
    status: 'Ativo', area_atual_id: DESTINO,
  };
  const buscar = (lista, lote = origem) =>
    encontrarLoteDestinoCompativel(lista, {
      loteOrigem: lote, categoriaMovimento: lote.categoria, areaDestinoId: DESTINO,
    });

  it('DL1 — movimentação total sem lote compatível não encontra destino', () => {
    expect(buscar([])).toBeNull();
    expect(buscar([{ ...compativel, nome: 'Outro nome' }])).toBeNull();
    expect(buscar([{ ...compativel, categoria: 'Bezerro' }])).toBeNull();
    expect(buscar([{ ...compativel, status: 'Inativo' }])).toBeNull();
    expect(buscar([{ ...compativel, area_atual_id: 'outra-area' }])).toBeNull();
  });

  it('DL2 — movimentação total encontra o lote de unificação, ignorando caixa', () => {
    expect(buscar([compativel])).toBe(compativel);
    expect(buscar([compativel], { ...origem, nome: 'boiada a', categoria: 'novilho' })).toBe(compativel);
  });

  it('DL3 — mover parte do lote é parcial; mover tudo é total', () => {
    expect(modoDaMovimentacao(10, 30)).toBe('parcial');
    expect(modoDaMovimentacao(30, 30)).toBe('total');
  });

  it('DL3b — quantidade como string numérica não vira parcial por engano', () => {
    expect(modoDaMovimentacao(30, '30')).toBe('total');
  });

  it('DL4 — movimentação parcial também unifica quando há lote compatível', () => {
    const quantidade = quantidadeAplicavel(10, origem);
    expect(quantidade).toBe(10);
    expect(modoDaMovimentacao(quantidade, origem.quantidade_cabecas)).toBe('parcial');
    expect(buscar([compativel])).toBe(compativel);
  });

  it('DL5 — saldo da origem nunca fica negativo e zera para Inativo', () => {
    expect(saldoEStatusDaOrigem(origem, 10)).toEqual({ quantidade_cabecas: 20, status: 'Ativo' });
    expect(saldoEStatusDaOrigem(origem, 30)).toEqual({ quantidade_cabecas: 0, status: 'Inativo' });
    expect(saldoEStatusDaOrigem(origem, 99)).toEqual({ quantidade_cabecas: 0, status: 'Inativo' });
  });

  it('DL5b — lote com saldo preserva o status que já tinha', () => {
    expect(saldoEStatusDaOrigem({ quantidade_cabecas: 10, status: 'Em quarentena' }, 4).status).toBe('Em quarentena');
  });

  it('quantidadeAplicavel limita ao saldo do lote', () => {
    expect(quantidadeAplicavel(50, origem)).toBe(30);
    expect(quantidadeAplicavel(5, { quantidade_cabecas: 0 })).toBe(0);
  });
});

describe('DL9 — nascimento', () => {
  it('a categoria do filhote vem do sexo', () => {
    expect(categoriaDoFilhote('Macho')).toBe('Bezerro 0 a 12 meses');
    expect(categoriaDoFilhote('Fêmea')).toBe('Bezerra 0 a 12 meses');
  });

  it('incrementa o lote existente da mesma empresa, categoria e área', () => {
    const alvo = { id: 'f1', empresa_id: 'e1', categoria: 'Bezerro 0 a 12 meses', area_atual_id: 'a1', status: 'Ativo' };
    const criterio = { empresaId: 'e1', categoria: 'Bezerro 0 a 12 meses', areaId: 'a1' };
    expect(encontrarLoteFilhote([alvo], criterio)).toBe(alvo);
    expect(encontrarLoteFilhote([{ ...alvo, empresa_id: 'e2' }], criterio)).toBeNull();
    expect(encontrarLoteFilhote([{ ...alvo, area_atual_id: 'a2' }], criterio)).toBeNull();
    expect(encontrarLoteFilhote([{ ...alvo, status: 'Inativo' }], criterio)).toBeNull();
  });
});

describe('DL11–DL13 — categoria e pesagem', () => {
  it('DL11 — mudança de categoria da quantidade inteira é total', () => {
    const lote = { quantidade_cabecas: 8 };
    expect(modoDaMovimentacao(quantidadeAplicavel(8, lote), lote.quantidade_cabecas)).toBe('total');
  });

  it('DL12 — mudança de parte da quantidade é parcial e deixa saldo na origem', () => {
    const lote = { quantidade_cabecas: 8, status: 'Ativo' };
    const qtd = quantidadeAplicavel(3, lote);
    expect(modoDaMovimentacao(qtd, lote.quantidade_cabecas)).toBe('parcial');
    expect(saldoEStatusDaOrigem(lote, qtd).quantidade_cabecas).toBe(5);
  });

  it('DL13 — peso individual do lote tem precedência sobre o da categoria', () => {
    expect(pesoAplicavel({ pesosPorLote: { l1: '420' }, loteId: 'l1', pesoPadrao: 380 })).toBe(420);
    expect(pesoAplicavel({ pesosPorLote: {}, loteId: 'l1', pesoPadrao: 380 })).toBe(380);
  });

  it('DL13b — peso ausente, zero ou inválido significa não pesar', () => {
    expect(pesoAplicavel({ pesosPorLote: {}, loteId: 'l1', pesoPadrao: NaN })).toBeNull();
    expect(pesoAplicavel({ pesosPorLote: { l1: '0' }, loteId: 'l1', pesoPadrao: 0 })).toBeNull();
    expect(pesoAplicavel({ pesosPorLote: {}, loteId: 'l1', pesoPadrao: -5 })).toBeNull();
  });

  it('DL13c — ganho de peso trata peso anterior ausente como zero', () => {
    expect(ganhoDePeso(420, 380)).toBe(40);
    expect(ganhoDePeso(420, undefined)).toBe(420);
  });

  it('as regras de movimentação são puras: sem provider, React ou storage', async () => {
    const fonte = await codigoDe('src/domain/lotes/movimentacaoLote.js');
    expect(fonte).not.toMatch(/@\/apis|@\/services|base44|react|localStorage|window/i);
  });
});

describe('DL7 — validação temporal via service', () => {
  it('bloqueia quando existe evento posterior', async () => {
    lotesApi.filterMovimentacoes.mockResolvedValue([{ id: 'm1', data_movimentacao: '2026-05-01' }]);
    await expect(
      service.validarOrdemTemporalLote({ empresaId: 'e1', loteId: 'l1', dataReferencia: '2026-01-01' })
    ).rejects.toThrow(/eventos posteriores/);
  });

  it('libera quando não existe evento posterior', async () => {
    lotesApi.filterMovimentacoes.mockResolvedValue([{ id: 'm1', data_movimentacao: '2025-01-01' }]);
    await expect(
      service.validarOrdemTemporalLote({ empresaId: 'e1', loteId: 'l1', dataReferencia: '2026-01-01' })
    ).resolves.toBeUndefined();
  });

  it('sem argumento obrigatório não consulta o provider', async () => {
    await service.validarOrdemTemporalLote({ empresaId: null, loteId: 'l1', dataReferencia: '2026-01-01' });
    expect(lotesApi.filterMovimentacoes).not.toHaveBeenCalled();
  });

  it('validarOrdemTemporalLotes percorre cada lote distinto uma vez', async () => {
    await service.validarOrdemTemporalLotes({
      empresaId: 'e1',
      lotes: [{ id: 'l1' }, { id: 'l1' }, { id: 'l2' }, null],
      dataReferencia: '2026-01-01',
    });
    expect(lotesApi.filterMovimentacoes).toHaveBeenCalledTimes(2);
  });

  it('validarSemRegistrosPosteriores ignora a própria movimentação', async () => {
    lotesApi.filterMovimentacoes.mockResolvedValue([
      { id: 'atual', data_movimentacao: '2026-06-01', created_date: '2026-06-01' },
    ]);
    await expect(
      service.validarSemRegistrosPosteriores({
        empresaId: 'e1', loteId: 'l1', dataReferencia: '2026-01-01', ignorarMovimentacaoId: 'atual',
      })
    ).resolves.toBeUndefined();
  });
});

describe('DL — operações compostas', () => {
  it('DL6 — criar movimentação delega para a API pública', async () => {
    lotesApi.createMovimentacao.mockResolvedValue({ id: 'mv1' });
    expect(await service.criarMovimentacao({ lote_id: 'l1' })).toEqual({ id: 'mv1' });
  });

  it('DL8/DL10 — atualização de quantidade passa pelo service', async () => {
    await service.atualizarLote('l1', { quantidade_cabecas: 5 });
    expect(lotesApi.updateLote).toHaveBeenCalledWith('l1', { quantidade_cabecas: 5 });
  });

  it('DL9 — criação de lote de destino passa pelo service', async () => {
    lotesApi.createLote.mockResolvedValue({ id: 'novo' });
    expect(await service.criarLote({ nome: 'X' })).toEqual({ id: 'novo' });
  });

  it('DL14 — falha parcial tem código estável e detalhes seguros', () => {
    const erro = service.erroOperacaoParcial({
      operation: 'movimentacaoParcial', etapaConcluida: 'loteDestino', etapaFalha: 'movimentacaoMapa',
    });
    expect(hasApiErrorCode(erro, API_ERROR_CODES.MAPA_PARTIAL_OPERATION)).toBe(true);
    expect(erro.details).toEqual({ etapaConcluida: 'loteDestino', etapaFalha: 'movimentacaoMapa' });
    expect(JSON.stringify(erro)).not.toMatch(/token|Bearer|http/i);
  });

  /**
   * A guarda de argumento mora na **API**, não no service — por isso o teste
   * usa o módulo real (`importActual`), com o provider substituído. Cobrar o
   * service aqui só provaria que o dublê devolve o que o dublê foi mandado
   * devolver.
   */
  it('bulkCreate exige lista não vazia e não chega ao provider', async () => {
    const api = await vi.importActual('@/apis/lotes/lotesApi.js');
    await expect(api.bulkCreateSuplementacaoLote([])).rejects.toMatchObject({
      code: API_ERROR_CODES.INVALID_ARGUMENT,
    });
    expect(provider.bulkCreateSuplementacaoLote).not.toHaveBeenCalled();
  });

  it('o service delega a suplementação em lote sem reimplementar a guarda', async () => {
    lotesApi.bulkCreateSuplementacaoLote.mockResolvedValue([{ id: 's1' }]);
    const registros = [{ lote_id: 'l1' }];
    expect(await service.registrarSuplementacaoEmLote(registros)).toEqual([{ id: 's1' }]);
    expect(lotesApi.bulkCreateSuplementacaoLote).toHaveBeenCalledWith(registros);
  });

  it('DL16 — DetalhesLote não fala entities, auth nem provider', async () => {
    const fonte = await codigoDe('src/components/mapa/DetalhesLote.jsx');
    expect(fonte).not.toMatch(/base44|@\/api\/entities|@\/api\/base44Client|\bUser\.me\b/);
    expect(fonte).not.toMatch(/@\/apis\/[a-z]+\/[A-Za-z]/);
  });

  it('DetalhesLote usa a regra de domínio em vez de reimplementá-la', async () => {
    const fonte = await codigoDe('src/components/mapa/DetalhesLote.jsx');
    expect(fonte).toContain('@/domain/lotes/movimentacaoLote');
    // O saldo da origem tinha três cópias da mesma conta; agora tem uma regra.
    expect(fonte).not.toMatch(/quantidade_cabecas \|\| 0\) - (qtdRemover|quantidadeMover)/);
  });

  it('o service não conhece React Query nem toast', async () => {
    const fonte = await codigoDe('src/services/loteManejoService.js');
    expect(fonte).not.toMatch(/@tanstack\/react-query|sonner|queryClient/);
  });
});
