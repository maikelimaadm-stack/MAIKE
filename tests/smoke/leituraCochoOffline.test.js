/**
 * D-PROD-296 — leitura de cocho sem internet, pelo motor de sincronização.
 *
 * Cadeia real `leituraCochoService → motor → fila (IndexedDB em memória) →
 * porta → nativeHttpClient`, com `fetch` substituído.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const EMP = 'emp-1';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

let online = true;

const corpo = (extra = {}) => ({
  empresa_id: EMP, ponto_suplementacao_id: 'c1', data_leitura: '2026-11-12', escore: 'VAZIO', acesso: 'BOM', estrutura: 'BOA', observacoes: null, ...extra,
});

const carregar = async () => {
  const storage = await import('@/lib/auth/nativeTokenStorage');
  storage.setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_1');
  const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
  motor.definirSessaoDaFila({ cliente_id: 'cli_1', usuario_id: 'usr_1' });
  const servico = await import('@/services/leituraCochoService');
  return { motor, servico };
};

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

describe('D-PROD-296 — leitura de cocho sem internet', () => {
  it('LO-01 com internet: POST com operation_id, volta a leitura do servidor', async () => {
    const { servico } = await carregar();
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(201, { ...corpo(), id: 'l-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await servico.registrarLeituraCocho(corpo());
    expect(r).toEqual({ leitura: expect.objectContaining({ id: 'l-1' }), aguardandoEnvio: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/api/native/leituras-cocho`);
    const enviado = JSON.parse(init.body);
    expect(enviado.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(enviado).sort()).toEqual(['acesso', 'data_leitura', 'empresa_id', 'escore', 'estrutura', 'observacoes', 'operation_id', 'ponto_suplementacao_id']);
  });

  it('LO-02 sem internet: fica no aparelho, aparece como "aguardando envio" e sobe depois com o mesmo código', async () => {
    const { servico, motor } = await carregar();
    online = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await servico.registrarLeituraCocho(corpo(), { rotulo: 'Leitura · COCHO 1' });
    expect(r.aguardandoEnvio).toBe(true);
    expect(r.leitura).toMatchObject({ _aguardandoEnvio: true, escore: 'VAZIO' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await servico.leiturasAguardandoEnvio(EMP)).toHaveLength(1);
    expect(await servico.leiturasAguardandoEnvio('outra-fazenda')).toHaveLength(0);
    expect((await motor.resumoDaFila()).itens[0].rotulo).toBe('Leitura · COCHO 1');

    online = true;
    fetchMock.mockResolvedValue(respostaJson(201, { ...corpo(), id: 'l-9' }));
    await motor.sincronizar();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).operation_id).toBe(r.leitura._operationId);
    expect(await servico.leiturasAguardandoEnvio(EMP)).toHaveLength(0);
  });

  it('LO-03 excluir a que ainda não subiu tira só do aparelho (nada vai ao servidor)', async () => {
    const { servico } = await carregar();
    online = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { leitura } = await servico.registrarLeituraCocho(corpo());
    await servico.excluirLeituraCocho(leitura);
    expect(await servico.leiturasAguardandoEnvio(EMP)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LO-04 a rede caiu durante o envio: "confirmando envio" — não exclui até o servidor responder', async () => {
    const { servico, motor } = await carregar();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { leitura, aguardandoEnvio } = await servico.registrarLeituraCocho(corpo());
    expect(aguardandoEnvio).toBe(true);
    expect(await motor.situacaoNaFila(leitura._operationId)).toBe('confirmando');
    await expect(servico.excluirLeituraCocho(leitura)).rejects.toThrow(/sendo enviada/);
    expect(await servico.leiturasAguardandoEnvio(EMP)).toHaveLength(1);
  });

  it('LO-05 quando sobe, avisa as telas para reler as leituras do mapa', async () => {
    const { servico, motor } = await carregar();
    online = false;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(201, { ...corpo(), id: 'l-2' })));
    await servico.registrarLeituraCocho(corpo());
    online = true;
    const ouvidos = [];
    const ouvir = (e) => ouvidos.push(e.detail?.atualizar);
    window.addEventListener(motor.EVENTO_FILA_DE_ENVIO, ouvir);
    await motor.sincronizar();
    window.removeEventListener(motor.EVENTO_FILA_DE_ENVIO, ouvir);
    expect(ouvidos).toContainEqual(['leiturasCocho']);
  });
});
