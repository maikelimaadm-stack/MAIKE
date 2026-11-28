/**
 * D-PROD-329 — quando a janela "Sincronização" sincroniza sozinha (no app do celular, já preparado):
 *
 * SA-01 a internet voltou: envia e baixa na hora; D-PROD-343: só se a última baixa tem mais de 3 min (com o sinal
 *       piscando, cada volta baixava tudo de novo; o ENVIO na volta da rede é dos gatilhos e não espera)
 * SA-02 abriu o app há pouco da última baixa: não repete; voltou ao app depois de 10 min: sincroniza
 * SA-03 no navegador (não é o app): nada automático
 * SA-04 (D-PROD-379) a automática é sempre por baixo (sem o cartão do meio da tela): a LEVE no dia a dia e a
 *       COMPLETA só quando a última completa passou de 12 h
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

let nativo = true;
let ultima = 0;
let ultimaLeve = null;
const sincronizar = vi.fn(async () => ({ ok: true, falhas: 0, em: Date.now() }));

vi.mock('@/config/runtimeConfig', async (orig) => ({ ...(await orig()), isAppNativo: () => nativo }));
vi.mock('@/services/sincronizacaoService', async (orig) => ({ ...(await orig()), ligarEnvioDaSessao: () => {} }));
vi.mock('@/services/dadosOfflineService', async (orig) => ({
  ...(await orig()),
  ultimaBaixaDosDados: () => ultima,
  ultimaSincronizacaoLeve: () => ultimaLeve,
  situacaoDaBaixa: () => null,
  dadosNoFormatoAtual: () => true,
  estaSemInternet: () => false,
}));
vi.mock('@/services/sincronizacaoCompletaService', async (orig) => ({ ...(await orig()), sincronizarNosDoisSentidos: (...a) => sincronizar(...a) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, clienteId: 'cli_1', user: { id: 'usr_1' } }) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', async (orig) => ({ ...(await orig()), useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/lib/bootSplashContext', () => ({ useBootSplash: () => ({ layoutBootReady: true }) }));
vi.mock('@/components/offline/FilaDeEnvio', () => ({ default: () => <p>fila</p> }));

const { default: DadosOffline } = await import('@/components/offline/DadosOffline');

const visivel = (v) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });

beforeEach(() => {
  nativo = true;
  ultimaLeve = null;
  sincronizar.mockClear();
  visivel('visible');
});
afterEach(() => cleanup());

describe('D-PROD-329 — sincronização automática', () => {
  it('SA-01 a internet voltou: a leve na hora (se a última sincronização tem mais de 2 min)', async () => {
    ultima = Date.now() - 60_000;
    render(<DadosOffline />);
    expect(sincronizar, 'abriu agora há pouco da última: não repete').not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(sincronizar, 'sincronizou há 1 min: não repete').not.toHaveBeenCalled();
    ultima = Date.now() - 3 * 60_000;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(sincronizar.mock.calls[0][0]).toMatchObject({ empresaId: 'emp-1', modo: 'leve', mostrar: false });
  });

  it('SA-02 voltou ao app: a leve, se a última (leve ou completa) tem mais de 2 min', async () => {
    ultima = Date.now() - 60 * 60_000;
    ultimaLeve = Date.now() - 60_000;
    render(<DadosOffline />);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(sincronizar, 'a leve foi há 1 min').not.toHaveBeenCalled();
    ultimaLeve = Date.now() - 3 * 60_000;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(sincronizar.mock.calls[0][0]).toMatchObject({ modo: 'leve', mostrar: false });
  });

  it('SA-03 no navegador: nada automático', async () => {
    nativo = false;
    ultima = Date.now() - 11 * 60_000;
    render(<DadosOffline />);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('SA-04 a última completa passou de 12 h: a completa, por baixo (sem o cartão)', async () => {
    ultima = Date.now() - 13 * 3600_000;
    ultimaLeve = Date.now() - 5 * 60_000;
    await act(async () => { render(<DadosOffline />); });
    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(sincronizar.mock.calls[0][0]).toMatchObject({ modo: 'tudo', mostrar: false });
  });
});
