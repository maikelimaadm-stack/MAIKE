/**
 * D-PROD-267 — transporte do cancelamento do cocho e os campos novos dos escritores.
 *  CS-1. o serviço do cancelamento só fala com os comandos do servidor; offline recusa SEM I/O;
 *  CS-2. `registrarLancamento` envia `evento_anterior_id` (null incluído) e não envia sem ele;
 *  CS-3. o fechamento pelo lançamento leva `fechado_por_tipo: 'lancamento'` + `fechado_por_evento_id`;
 *        pela movimentação do gado (`aplicarFechamentoSeAindaAberto`), `'movimentacao_gado'`;
 *        sem a prova, o patch fica como antes;
 *  CS-4. os campos novos estão na lista fechada do servidor, com o tipo conferido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const http = vi.hoisted(() => ({ chamadas: /** @type {any[]} */ ([]) }));
vi.mock('@/apis/_core/nativeHttpClient.js', () => ({
  nativeRequest: vi.fn(async (caminho, opcoes) => {
    http.chamadas.push({ caminho, metodo: opcoes?.method ?? 'GET', corpo: opcoes?.body ?? null });
    return { ok: true };
  }),
}));
const apis = vi.hoisted(() => ({
  listEventos: vi.fn(async () => []),
  listLotesSuplementacao: vi.fn(async () => []),
  listLotesRebanho: vi.fn(async () => []),
  listMovimentacoesPecuarias: vi.fn(async () => []),
  updateEvento: vi.fn(async () => ({})),
  updateLoteSuplementacao: vi.fn(async () => ({})),
}));
vi.mock('@/apis/suplementacao', async (importOriginal) => ({ ...(await importOriginal()), ...apis }));
const comandos = vi.hoisted(() => ({ comandoLancamentoComLotes: vi.fn(async (body) => ({ evento: { id: 'novo', ...body.evento } })) }));
vi.mock('@/apis/suplementacao-eventos', async (importOriginal) => ({ ...(await importOriginal()), ...comandos }));
vi.mock('@/apis/formulacoes', async (importOriginal) => ({ ...(await importOriginal()), listFormulacoesOpcoesLancamento: vi.fn(async () => []) }));
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({ ...(await importOriginal()), getMapaCachedData: vi.fn(async () => []) }));

const cancelamento = await import('@/services/suplementacaoCancelamentoService');
const supSvc = await import('@/services/suplementacaoService');
const camposServidor = await import('../../backend/src/modules/suplementacaoEventos/camposFechamentoEvento.js');
const { API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const EVENTO = { id: 'ev 1', empresa_id: 'emp-1' };
const ABERTO = { id: 'e1', empresa_id: 'emp-1', ponto_suplementacao_id: 'p1', quantidade_total_kg: 100, total_cabecas_afetadas: 10, sobra_kg: 0, data_lancamento: '2026-03-01', dias_periodo: null };

beforeEach(() => {
  http.chamadas = [];
  for (const f of Object.values(apis)) f.mockClear();
  comandos.comandoLancamentoComLotes.mockClear();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

describe('CS-1 — serviço do cancelamento', () => {
  it('POST do comando e GET da elegibilidade, com o id codificado e a empresa', async () => {
    await cancelamento.consultarElegibilidadeCancelamentoCocho({ evento: EVENTO });
    await cancelamento.cancelarLancamentoCocho({ evento: EVENTO, motivo: '  lançado em dobro ', operationId: 'cancelar-cocho-1' });
    expect(http.chamadas).toEqual([
      { caminho: '/suplementacao-eventos/ev%201/elegibilidade-cancelamento?empresa_id=emp-1', metodo: 'GET', corpo: null },
      { caminho: '/suplementacao-eventos/ev%201/cancelamento', metodo: 'POST', corpo: { empresa_id: 'emp-1', operation_id: 'cancelar-cocho-1', motivo: 'lançado em dobro' } },
    ]);
  });

  it('offline: recusa sem nenhuma chamada (nunca vai para a fila)', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const e1 = await cancelamento.cancelarLancamentoCocho({ evento: EVENTO, motivo: 'x y z', operationId: 'k' }).then(() => null, (e) => e);
    const e2 = await cancelamento.consultarElegibilidadeCancelamentoCocho({ evento: EVENTO }).then(() => null, (e) => e);
    expect([e1?.code, e2?.code]).toEqual([API_ERROR_CODES.INVALID_ARGUMENT, API_ERROR_CODES.INVALID_ARGUMENT]);
    expect(e1.details.motivo).toBe('offline_comando_composto');
    expect(http.chamadas).toEqual([]);
  });
});

describe('CS-2 — evento_anterior_id no lançamento', () => {
  it('envia o anterior (id ou null) e omite quando não informado', async () => {
    await supSvc.registrarLancamento({ evento: { empresa_id: 'emp-1' }, lotes: [], operationId: 'op-12345678', eventoAnteriorId: 'e9' });
    await supSvc.registrarLancamento({ evento: { empresa_id: 'emp-1' }, lotes: [], operationId: 'op-12345679', eventoAnteriorId: null });
    await supSvc.registrarLancamento({ evento: { empresa_id: 'emp-1' }, lotes: [], operationId: 'op-12345670' });
    const corpos = comandos.comandoLancamentoComLotes.mock.calls.map((c) => c[0]);
    expect(corpos[0].evento_anterior_id).toBe('e9');
    expect(corpos[1]).toHaveProperty('evento_anterior_id', null);
    expect(corpos[2]).not.toHaveProperty('evento_anterior_id');
  });
});

describe('CS-3 — quem fechou o período', () => {
  it('lançamento: fechado_por_tipo + fechado_por_evento_id; sem a prova, o patch de antes', async () => {
    await supSvc.fecharPeriodoSuplementacao({ evento: ABERTO, diasPeriodo: 5, sobraFinal: 10, sobraInicial: 0, fechadoPorEventoId: 'novo' });
    expect(apis.updateEvento.mock.calls[0][1]).toMatchObject({ dias_periodo: 5, sobra_kg: 10, fechado_por_tipo: 'lancamento', fechado_por_evento_id: 'novo' });
    await supSvc.fecharPeriodoSuplementacao({ evento: ABERTO, diasPeriodo: 5, sobraFinal: 10, sobraInicial: 0 });
    expect(apis.updateEvento.mock.calls[1][1]).not.toHaveProperty('fechado_por_tipo');
  });

  it('movimentação do gado: aplicarFechamentoSeAindaAberto acrescenta movimentacao_gado', async () => {
    const preparado = await supSvc.prepararFechamentoPeriodo({ evento: ABERTO, diasPeriodo: 3, sobraFinal: 5, sobraInicial: 0, sobraInformada: true, compartilhado: false });
    expect(preparado.patchEvento).not.toHaveProperty('fechado_por_tipo');
    apis.listEventos.mockResolvedValueOnce([ABERTO]);
    expect(await supSvc.aplicarFechamentoSeAindaAberto(preparado)).toEqual({ aplicado: true });
    const patch = apis.updateEvento.mock.calls[0][1];
    expect(patch.fechado_por_tipo).toBe('movimentacao_gado');
    expect(patch).not.toHaveProperty('fechado_por_evento_id');
  });
});

describe('CS-4 — a lista fechada do servidor aceita os campos novos', () => {
  it('fechado_por_* permitidos e com tipo conferido', () => {
    const permitidos = new Set(camposServidor.CAMPOS_PATCH_PERMITIDOS);
    expect(permitidos.has('fechado_por_tipo') && permitidos.has('fechado_por_evento_id')).toBe(true);
    expect(() => camposServidor.exigirTiposDoFechamento({ fechado_por_tipo: 'lancamento', fechado_por_evento_id: 'e1' }, 'SuplementacaoEvento')).not.toThrow();
    expect(() => camposServidor.exigirTiposDoFechamento({ fechado_por_tipo: 'outro' }, 'SuplementacaoEvento')).toThrow();
    expect(() => camposServidor.exigirTiposDoFechamento({ fechado_por_evento_id: 3 }, 'SuplementacaoEvento')).toThrow();
  });
});

describe('CS-5 — portas: limite depois do filtro e sem cancelados', () => {
  it('o último do cocho não some porque a conta tem lançamento mais novo em outro cocho; cancelado não aparece', async () => {
    const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
    const lista = [
      { id: 'x', ponto_suplementacao_id: 'outro', data_lancamento: '2026-03-09' },
      { id: 'c', ponto_suplementacao_id: 'p1', data_lancamento: '2026-03-08', situacao: 'cancelado' },
      { id: 'b', ponto_suplementacao_id: 'p1', data_lancamento: '2026-03-05' },
      { id: 'a', ponto_suplementacao_id: 'p1', data_lancamento: '2026-03-01' },
    ];
    vi.mocked(nativeRequest).mockImplementation(async (caminho) => {
      http.chamadas.push({ caminho });
      return lista;
    });
    const { filterSuplementacaoEventosNativos, listSuplementacaoEventosNativos } = await vi.importActual('@/apis/suplementacao-eventos');
    const ultimo = await filterSuplementacaoEventosNativos({ ponto_suplementacao_id: 'p1' }, '-data_lancamento', 1);
    expect(ultimo.map((e) => e.id)).toEqual(['b']);
    expect(http.chamadas.at(-1).caminho).toBe('/suplementacao-eventos');
    expect((await listSuplementacaoEventosNativos()).map((e) => e.id)).toEqual(['x', 'b', 'a']);
  });
});
