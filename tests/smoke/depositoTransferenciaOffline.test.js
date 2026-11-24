/**
 * D-PROD-296 — transferência entre depósitos sem internet e o saldo do
 * aparelho descontando o que espera envio.
 *
 * Cadeia real `suplementacaoEstoqueService → motor → fila (IndexedDB em
 * memória) → comando → nativeHttpClient`, com `fetch` substituído.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const EMP = 'emp-1';
const PRODUTO = { id: 'prod-1', nome_produto: 'SAL', unidade_medida: 'KG' };

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

const lotes = () => [
  { id: 'l-antigo', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 60, custo_unitario: 2, data_documento: '2026-01-01', numero_documento: 'NF1' },
  { id: 'l-novo', empresa_id: EMP, produto_id: 'prod-1', local_estoque_id: 'galpao', status: 'Disponivel', quantidade_disponivel: 40, custo_unitario: 3, data_documento: '2026-02-01', numero_documento: 'NF2' },
];

let online = true;

const carregar = async () => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
  motor.definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_1' });
  const estoque = await import('@/services/suplementacaoEstoqueService');
  const visao = await import('@/services/estoqueAguardandoEnvioService');
  return { motor, estoque, visao };
};

const transferir = (estoque, extra = {}) =>
  estoque.registrarTransferenciaEntreLocais({
    empresaId: EMP, produto: PRODUTO, quantidade: 70,
    localOrigemId: 'galpao', localOrigemNome: 'GALPÃO', localDestinoId: 'deposito-2', localDestinoNome: 'DEPÓSITO 2',
    lotesNota: lotes(), dataMovimentacao: '2026-11-20', ...extra,
  });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  await new Promise((r) => {
    const pedido = indexedDB.deleteDatabase('maike_fila_envio');
    pedido.onsuccess = pedido.onerror = pedido.onblocked = () => r(undefined);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('D-PROD-296 — saldo do aparelho com o que espera envio (regra pura)', () => {
  it('ET-01 a saída consome os lotes da origem em FIFO e a entrada vira lote do destino', async () => {
    const { aplicarMovimentosAosLotes } = await import('@/services/estoqueAguardandoEnvioService');
    const originais = lotes();
    const r = aplicarMovimentosAosLotes(originais, [
      { operationId: 'op-1', empresa_id: EMP, produto_id: 'prod-1', quantidade: 70, local_origem_id: 'galpao', local_destino_id: 'deposito-2', data: '2026-11-20' },
    ]);
    expect(r.find((l) => l.id === 'l-antigo').quantidade_disponivel).toBe(0);
    expect(r.find((l) => l.id === 'l-novo').quantidade_disponivel).toBe(30);
    expect(r.find((l) => l.id === 'aguardando:op-1')).toMatchObject({ local_estoque_id: 'deposito-2', quantidade_disponivel: 70, _aguardandoEnvio: true, status: 'Disponivel' });
    expect(originais[0].quantidade_disponivel).toBe(60); // a lista recebida não muda
  });
});

describe('D-PROD-296 — transferência entre depósitos sem internet', () => {
  it('ET-02 com internet: vai direto ao comando, com operation_id', async () => {
    const { estoque } = await carregar();
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(201, { committed: true, movimentacao_saida: { id: 'ms' }, movimentacao_entrada: { id: 'me' } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await transferir(estoque);
    expect(r.aguardandoEnvio).toBe(false);
    expect(r.movimentacaoSaida).toEqual({ id: 'ms' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/api/native/movimentacoes-estoque/comandos/transferencia-locais`);
    expect(JSON.parse(init.body)).toMatchObject({ empresa_id: EMP, quantidade: 70, local_origem_id: 'galpao', operation_id: expect.any(String) });
  });

  it('ET-03 sem internet: fica no aparelho; o saldo já mostra a saída e a entrada; sobe depois com o mesmo código', async () => {
    const { estoque, visao, motor } = await carregar();
    online = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await transferir(estoque);
    expect(r.aguardandoEnvio).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const visto = await visao.comEstoqueAguardandoEnvio(lotes());
    const saldo = (local) => visto.filter((l) => l.local_estoque_id === local).reduce((t, l) => t + l.quantidade_disponivel, 0);
    expect(saldo('galpao')).toBe(30);
    expect(saldo('deposito-2')).toBe(70);

    online = true;
    fetchMock.mockResolvedValue(respostaJson(201, { committed: true }));
    await motor.sincronizar();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).operation_id).toBe(r.operation_id);
    // Chegou ao servidor: o aparelho não aplica mais (o servidor já tem).
    const depois = await visao.comEstoqueAguardandoEnvio(lotes());
    expect(depois).toEqual(lotes());
  });

  it('ET-04 o saldo do aparelho barra a 2ª transferência que não cabe mais (antes de guardar)', async () => {
    const { estoque, visao } = await carregar();
    online = false;
    vi.stubGlobal('fetch', vi.fn());
    await transferir(estoque);
    const lotesDoAparelho = await visao.comEstoqueAguardandoEnvio(lotes());
    await expect(transferir(estoque, { quantidade: 50, lotesNota: lotesDoAparelho })).rejects.toBeTruthy();
  });

  it('ET-05 reenviar o MESMO código (a tela tentou de novo) não guarda duas vezes', async () => {
    const { estoque, motor } = await carregar();
    // Conta própria: o IndexedDB em memória pode guardar itens de outro caso.
    motor.definirSessaoDaFila({ cliente_id: 'cli_et05', usuario_id: 'usr_et05' });
    online = false;
    vi.stubGlobal('fetch', vi.fn());
    const a = await transferir(estoque, { operationId: 'transf-abc-12345' });
    const b = await transferir(estoque, { operationId: 'transf-abc-12345' });
    expect([a.aguardandoEnvio, b.aguardandoEnvio]).toEqual([true, true]);
    expect((await motor.resumoDaFila()).aguardando).toBe(1);
  });

  it('ET-06 D-PROD-297: a transferência que não subiu aparece no depósito, edita (mesmo código) e exclui', async () => {
    const { estoque, motor } = await carregar();
    motor.definirSessaoDaFila({ cliente_id: 'cli_et06', usuario_id: 'usr_et06' });
    online = false;
    vi.stubGlobal('fetch', vi.fn());
    const r = await transferir(estoque, { operationId: 'transf-et06-0001', observacoes: 'levei de caminhonete' });
    const [item] = await estoque.transferenciasAguardandoDoLocal('deposito-2');
    expect(item).toMatchObject({ operationId: 'transf-et06-0001', direcao: 'entrada', quantidade: 70, observacoes: 'levei de caminhonete' });
    expect((await estoque.transferenciasAguardandoDoLocal('galpao'))[0].direcao).toBe('saida');

    await estoque.transferenciaAguardandoPodeEditar(r.operation_id);
    await transferir(estoque, { quantidade: 40, operationId: r.operation_id, edicao: r.operation_id });
    const [editado] = await estoque.transferenciasAguardandoDoLocal('deposito-2');
    expect(editado).toMatchObject({ operationId: 'transf-et06-0001', quantidade: 40 });
    expect((await motor.resumoDaFila()).aguardando).toBe(1);

    await estoque.descartarTransferenciaAguardando(r.operation_id);
    expect(await estoque.transferenciasAguardandoDoLocal('deposito-2')).toEqual([]);
  });
});

