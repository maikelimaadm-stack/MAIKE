/**
 * D-PROD-301 — sincronização organizada: o ícone do topo, o aviso de quando
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

describe('D-PROD-301 — ícone da sincronização no topo', () => {
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

  it('SO-06 (D-PROD-380) a passada de rotina sem nada a enviar não gira o ícone; com algo a enviar, gira', async () => {
    const { default: BotaoSincronizacao } = await import('@/components/offline/BotaoSincronizacao');
    fila = { ...estadoDaFila, enviando: true };
    const { rerender } = render(<BotaoSincronizacao />);
    expect(screen.getByTestId('botao-sincronizacao')).toHaveAttribute('aria-label', 'Sincronização: tudo enviado');
    expect(screen.getByTestId('botao-sincronizacao').querySelector('.animate-spin')).toBeNull();
    fila = { ...estadoDaFila, enviando: true, aguardando: 2 };
    rerender(<BotaoSincronizacao />);
    expect(screen.getByTestId('botao-sincronizacao')).toHaveAttribute('aria-label', 'Sincronização: enviando 2 registro(s)');
    expect(screen.getByTestId('botao-sincronizacao').querySelector('.animate-spin')).toBeTruthy();
  });
});

describe('D-PROD-301 — aviso quando sobe o que foi feito sem internet', () => {
  it('SO-03 (D-PROD-380) nada enquanto envia; no fim "Tudo enviado"; a passada de rotina sem envio não avisa', async () => {
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

    // Volta da internet: demora, envia os 2. Enquanto sobe, nada na tela (antes: "Sincronizando — Enviando…").
    fila = { ...fila, enviando: true };
    rerender(<AvisoDeSincronizacao />);
    act(() => vi.advanceTimersByTime(5000));
    expect(toastCustom).not.toHaveBeenCalled();
    fila = { ...estadoDaFila };
    rerender(<AvisoDeSincronizacao />);
    expect(toastCustom).toHaveBeenCalledTimes(1);
    expect(toastCustom.mock.calls[0][1]).toMatchObject({ id: 'maike-sincronizacao', duration: 3000 });
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

describe('D-PROD-301 — janela "Sincronização"', () => {
  it('SO-05 mostra internet, cada parte com quando veio, e "Sincronizar agora" chama uma vez a baixa (que envia antes)', async () => {
    const { default: DadosOffline, abrirDadosOffline } = await import('@/components/offline/DadosOffline');
    baixar.mockResolvedValue({ ok: true, falhas: 0, em: Date.now() });
    render(<DadosOffline />);
    act(() => abrirDadosOffline());
    expect(await screen.findByText('Sincronização')).toBeInTheDocument();
    expect(screen.getByTestId('sincronizacao-conexao')).toHaveTextContent('Com internet.');
    const partes = screen.getByTestId('sincronizacao-partes');
    expect(partes).toHaveTextContent('Mapa');
    expect(partes).toHaveTextContent('2 de 30 não vieram');
    expect(screen.getByTestId('sincronizacao-ultima')).toHaveTextContent(/^Última sincronização: /);

    fireEvent.click(screen.getByTestId('sincronizar-agora'));
    await waitFor(() => expect(baixar).toHaveBeenCalledTimes(1));
    // D-PROD-307: a baixa já envia antes (na vez da sincronia); a janela não dispara um
    // segundo envio em paralelo.
    expect(enviarAgora).not.toHaveBeenCalled();
    expect(await screen.findByText('Pronto! Sincronizado.')).toBeInTheDocument();
  });

  it('SO-07 (D-PROD-380) "há quanto tempo" da última sincronização', async () => {
    const { haQuantoTempo } = await import('@/components/offline/DadosOffline');
    const agora = Date.parse('2026-11-28T12:00:00Z');
    expect(haQuantoTempo(null, agora)).toBe(null);
    expect(haQuantoTempo(agora - 20_000, agora)).toBe('agora mesmo');
    expect(haQuantoTempo(agora - 5 * 60_000, agora)).toBe('há 5 min');
    expect(haQuantoTempo(agora - 3 * 3600_000, agora)).toBe('há 3 h');
    expect(haQuantoTempo(agora - 30 * 3600_000, agora)).toMatch(/^em \d{2}\/\d{2}/);
  });
});
