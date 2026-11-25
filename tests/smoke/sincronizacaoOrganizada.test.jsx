/**
 * D-PROD-300 — sincronização organizada: o ícone do topo, o aviso de quando
 * sobe o que foi feito sem internet e a janela "Sincronização"
 * ("Sincronizar agora" envia e depois baixa; cada parte com quando veio).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const estadoDaFila = { aguardando: 0, atencao: 0, enviando: false, itens: [], outrosAguardando: 0, carregado: true, recarregar: () => {} };
let fila = { ...estadoDaFila };
vi.mock('@/hooks/useFilaDeEnvio', () => ({ useFilaDeEnvio: () => fila }));

let nativo = true;
vi.mock('@/config/runtimeConfig', async (orig) => ({ ...(await orig()), isAppNativo: () => nativo }));

const toastCustom = vi.fn();
const toastDismiss = vi.fn();
vi.mock('sonner', () => ({ toast: { custom: (...a) => toastCustom(...a), dismiss: (...a) => toastDismiss(...a) } }));

const enviarAgora = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/sincronizacaoService', async (orig) => ({ ...(await orig()), enviarAgora: () => enviarAgora(), ligarEnvioDaSessao: () => {} }));

const baixar = vi.fn();
vi.mock('@/services/dadosOfflineService', async (orig) => ({
  ...(await orig()),
  baixarDadosParaOffline: (...a) => baixar(...a),
  ultimaBaixaDosDados: () => Date.parse('2026-11-24T12:00:00Z'),
  situacaoDaBaixa: () => ({
    mapa: { em: Date.parse('2026-11-24T12:00:00Z'), total: 20, falhas: 0 },
    cadastros: { em: Date.parse('2026-11-24T12:00:00Z'), total: 30, falhas: 2 },
    telas: { em: Date.parse('2026-11-24T12:00:00Z'), total: 40, falhas: 0 },
  }),
  estaSemInternet: () => false,
}));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, clienteId: 'cli_1', user: { id: 'usr_1' } }) }));
vi.mock('@/hooks/useEmpresaSelecionadaId', async (orig) => ({ ...(await orig()), useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/lib/bootSplashContext', () => ({ useBootSplash: () => ({ layoutBootReady: false }) }));
vi.mock('@/components/offline/FilaDeEnvio', () => ({ default: () => <p>fila</p> }));

beforeEach(() => {
  fila = { ...estadoDaFila };
  nativo = true;
  toastCustom.mockClear();
  toastDismiss.mockClear();
  enviarAgora.mockClear();
  baixar.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('D-PROD-300 — ícone da sincronização no topo', () => {
  it('SO-01 mostra o número do que espera envio e abre a janela', async () => {
    const { default: BotaoSincronizacao } = await import('@/components/offline/BotaoSincronizacao');
    const { EVENTO_ABRIR_DADOS_OFFLINE } = await import('@/components/offline/DadosOffline');
    fila = { ...estadoDaFila, aguardando: 3 };
    const abriu = vi.fn();
    window.addEventListener(EVENTO_ABRIR_DADOS_OFFLINE, abriu);
    render(<BotaoSincronizacao />);
    const botao = screen.getByTestId('botao-sincronizacao');
    expect(botao).toHaveAttribute('aria-label', 'Sincronização: 3 aguardando envio');
    expect(botao).toHaveTextContent('3');
    fireEvent.click(botao);
    expect(abriu).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVENTO_ABRIR_DADOS_OFFLINE, abriu);
  });

  it('SO-02 no navegador, sem nada a enviar, não aparece; com atenção, o rótulo diz', async () => {
    const { default: BotaoSincronizacao } = await import('@/components/offline/BotaoSincronizacao');
    nativo = false;
    const { container, rerender } = render(<BotaoSincronizacao />);
    expect(container).toBeEmptyDOMElement();
    fila = { ...estadoDaFila, atencao: 1 };
    rerender(<BotaoSincronizacao />);
    expect(screen.getByTestId('botao-sincronizacao')).toHaveAttribute('aria-label', 'Sincronização: 1 precisa(m) de atenção');
  });
});

describe('D-PROD-300 — aviso quando sobe o que foi feito sem internet', () => {
  it('SO-03 "Enviando…" (passada que demora) e depois "Tudo enviado"; a passada de rotina sem envio não avisa', async () => {
    vi.useFakeTimers();
    const { default: AvisoDeSincronizacao } = await import('@/components/offline/AvisoDeSincronizacao');
    fila = { ...estadoDaFila, aguardando: 2 };
    const { rerender } = render(<AvisoDeSincronizacao />);

    // Rotina: começa e termina logo, nada enviado → nenhum aviso.
    fila = { ...fila, enviando: true };
    rerender(<AvisoDeSincronizacao />);
    fila = { ...fila, enviando: false };
    rerender(<AvisoDeSincronizacao />);
    act(() => vi.advanceTimersByTime(2000));
    expect(toastCustom).not.toHaveBeenCalled();

    // Volta da internet: demora, envia os 2.
    fila = { ...fila, enviando: true };
    rerender(<AvisoDeSincronizacao />);
    act(() => vi.advanceTimersByTime(1300));
    expect(toastCustom).toHaveBeenCalledTimes(1);
    expect(toastCustom.mock.calls[0][1]).toMatchObject({ id: 'maike-sincronizacao', duration: Infinity });
    fila = { ...estadoDaFila };
    rerender(<AvisoDeSincronizacao />);
    expect(toastCustom).toHaveBeenCalledTimes(2);
    expect(toastCustom.mock.calls[1][1]).toMatchObject({ id: 'maike-sincronizacao', duration: 3000 });
  });

  it('SO-04 avisa quando aparece um NOVO "precisa de atenção" (não o que já havia ao abrir)', async () => {
    const { default: AvisoDeSincronizacao } = await import('@/components/offline/AvisoDeSincronizacao');
    fila = { ...estadoDaFila, atencao: 1 };
    const { rerender } = render(<AvisoDeSincronizacao />);
    expect(toastCustom).not.toHaveBeenCalled();
    fila = { ...estadoDaFila, atencao: 2 };
    rerender(<AvisoDeSincronizacao />);
    expect(toastCustom).toHaveBeenCalledTimes(1);
    expect(toastCustom.mock.calls[0][1]).toMatchObject({ id: 'maike-sincronizacao-atencao' });
  });
});

describe('D-PROD-300 — janela "Sincronização"', () => {
  it('SO-05 mostra internet, cada parte com quando veio, e "Sincronizar agora" envia e depois baixa', async () => {
    const { default: DadosOffline, abrirDadosOffline } = await import('@/components/offline/DadosOffline');
    baixar.mockResolvedValue({ ok: true, falhas: 0, em: Date.now() });
    render(<DadosOffline />);
    act(() => abrirDadosOffline());
    expect(await screen.findByText('Sincronização')).toBeInTheDocument();
    expect(screen.getByTestId('sincronizacao-conexao')).toHaveTextContent('Com internet.');
    const partes = screen.getByTestId('sincronizacao-partes');
    expect(partes).toHaveTextContent('Mapa');
    expect(partes).toHaveTextContent('2 de 30 não vieram');

    fireEvent.click(screen.getByTestId('sincronizar-agora'));
    await waitFor(() => expect(baixar).toHaveBeenCalledTimes(1));
    expect(enviarAgora).toHaveBeenCalledTimes(1);
    expect(enviarAgora.mock.invocationCallOrder[0]).toBeLessThan(baixar.mock.invocationCallOrder[0]);
    expect(await screen.findByText('Pronto! Sincronizado.')).toBeInTheDocument();
  });
});
