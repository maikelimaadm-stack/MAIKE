/**
 * D-PROD-329 — sincronização nos dois sentidos, com a porcentagem no círculo do canto.
 *
 * SC-01 porcentagem: envio 0–25, mapa 25–55, cadastros 55–80, telas 80–100
 * SC-02 (D-PROD-380) o que sincronizar sozinho: a completa só com formato antigo ou mais de 12 h desde a última
 *       completa; a leve ao abrir/voltar depois de 2 min (relógio: 15 min); sem a primeira baixa ou sem internet: nada
 * SC-03 envia ANTES de baixar; a porcentagem só anda para a frente; termina em 100 ("Tudo sincronizado") e some
 * SC-04 sem internet não faz nada; pedir de novo durante uma devolve a mesma
 * SC-05 o círculo mostra a porcentagem, ✓ no fim, e tocar abre a janela "Sincronização"
 * SC-06 (D-PROD-337) ficou registro no celular: o fim diz quantos ficaram (nunca "Tudo sincronizado"); o envio pede
 *       que o que esperava por falta de rede tente já
 * SC-07 (D-PROD-380) a leve envia e baixa só o que mudou (não a baixa completa); a automática não mostra o cartão; a
 *       pessoa pedindo no meio dela passa a mostrar a que está em curso
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const chamadas = [];
let resolverBaixa;
const filaRestante = vi.hoisted(() => ({ aguardando: 0, atencao: 0 }));
vi.mock('@/services/sincronizacaoService', () => ({ lerFilaDeEnvio: vi.fn(async () => ({ ...filaRestante, itens: [] })) }));
vi.mock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({
  sincronizarTudo: vi.fn(async () => { chamadas.push('envio'); }),
}));
vi.mock('@/services/dadosOfflineService', () => ({
  estaSemInternet: () => navigator.onLine === false,
  baixarSoOQueMudou: vi.fn(async () => {
    chamadas.push('leve');
    await new Promise((r) => { resolverBaixa = r; });
    return { ok: true, falhas: 0, em: 456 };
  }),
  baixarDadosParaOffline: vi.fn(async ({ aoAvancar }) => {
    chamadas.push('baixa');
    aoAvancar({ etapa: 'mapa', titulo: 'Mapa', feitas: 0, total: 10 });
    aoAvancar({ etapa: 'mapa', titulo: 'Mapa', feitas: 10, total: 10 });
    aoAvancar({ etapa: 'cadastros', titulo: 'Cadastros', feitas: 5, total: 10 });
    await new Promise((r) => { resolverBaixa = r; });
    aoAvancar({ etapa: 'telas', titulo: 'Telas do sistema', feitas: 4, total: 4 });
    return { ok: true, falhas: 0, em: 123 };
  }),
}));

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

let svc;
beforeEach(async () => {
  vi.resetModules();
  chamadas.length = 0;
  filaRestante.aguardando = 0;
  filaRestante.atencao = 0;
  online(true);
  svc = await import('@/services/sincronizacaoCompletaService');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('D-PROD-329 — sincronização nos dois sentidos', () => {
  it('SC-01 porcentagem por etapa', () => {
    expect(svc.percentualDaSincronia('envio', 0, 0)).toBe(0);
    expect(svc.percentualDaSincronia('mapa', 5, 10)).toBe(40);
    expect(svc.percentualDaSincronia('cadastros', 10, 10)).toBe(80);
    expect(svc.percentualDaSincronia('telas', 4, 4)).toBe(100);
    expect(svc.percentualDaSincronia('telas', 9, 4)).toBe(100);
  });

  it('SC-02 o que sincronizar sozinho (D-PROD-380)', () => {
    const agora = 10_000_000_000;
    const min = 60_000;
    const base = { ultima: agora - min, ultimaLeve: null, agora, formatoAtual: true, semInternet: false };
    // Acabou de sincronizar: nada.
    expect(svc.deveSincronizarSozinho('voltou', base)).toBe(null);
    expect(svc.deveSincronizarSozinho('abriu', base)).toBe(null);
    // Depois de 2 min, ao abrir ou ao voltar a internet: a leve (antes: a completa depois de 10 min / 3 min).
    expect(svc.deveSincronizarSozinho('abriu', { ...base, ultima: agora - 3 * min })).toBe('leve');
    expect(svc.deveSincronizarSozinho('voltou', { ...base, ultima: agora - 3 * min })).toBe('leve');
    // Vale a mais nova das duas (leve ou completa).
    expect(svc.deveSincronizarSozinho('abriu', { ...base, ultima: agora - 60 * min, ultimaLeve: agora - min })).toBe(null);
    // Relógio (app aberto): a leve a cada 15 min.
    expect(svc.deveSincronizarSozinho('relogio', { ...base, ultima: agora - 10 * min })).toBe(null);
    expect(svc.deveSincronizarSozinho('relogio', { ...base, ultima: agora - 16 * min })).toBe('leve');
    // A completa: formato antigo ou mais de 12 h desde a última completa (mesmo com a leve recente).
    expect(svc.deveSincronizarSozinho('abriu', { ...base, formatoAtual: false })).toBe('tudo');
    expect(svc.deveSincronizarSozinho('relogio', { ...base, ultima: agora - 13 * 3600_000, ultimaLeve: agora - min })).toBe('tudo');
    // Sem a primeira baixa (é a tela de preparo) ou sem internet: nada.
    expect(svc.deveSincronizarSozinho('voltou', { ...base, ultima: null })).toBe(null);
    expect(svc.deveSincronizarSozinho('voltou', { ...base, ultima: agora - 13 * 3600_000, semInternet: true })).toBe(null);
  });

  it('SC-03 envia antes de baixar; a porcentagem só sobe; 100 no fim e some', async () => {
    vi.useFakeTimers();
    const vistos = [];
    const ouvir = (e) => vistos.push({ ...e.detail });
    window.addEventListener(svc.EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
    const avancos = [];
    const p = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1', aoAvancar: (x) => avancos.push(x) });
    await vi.waitFor(() => expect(resolverBaixa).toBeTypeOf('function'));
    expect(chamadas).toEqual(['envio', 'baixa']);
    expect(svc.lerProgressoDaSincronia()).toMatchObject({ ativo: true, fase: 'baixando', percentual: 68 });
    resolverBaixa();
    expect(await p).toMatchObject({ ok: true });
    const pct = vistos.map((v) => v.percentual);
    expect(pct[0]).toBe(2);
    expect([...pct].sort((a, b) => a - b)).toEqual(pct);
    expect(vistos.at(-1)).toMatchObject({ fase: 'pronto', percentual: 100, titulo: 'Tudo sincronizado' });
    expect(avancos.at(-1)).toEqual({ titulo: 'Telas do sistema', feitas: 4, total: 4 });
    vi.advanceTimersByTime(svc.MOSTRAR_PRONTO_MS + 10);
    expect(svc.lerProgressoDaSincronia().ativo).toBe(false);
    window.removeEventListener(svc.EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
  });

  it('SC-04 sem internet nada; pedir de novo durante devolve a mesma', async () => {
    online(false);
    expect(await svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' })).toMatchObject({ ok: false });
    expect(chamadas).toEqual([]);
    online(true);
    resolverBaixa = undefined;
    const a = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' });
    const b = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' });
    expect(b).toBe(a);
    await vi.waitFor(() => expect(resolverBaixa).toBeTypeOf('function'));
    resolverBaixa();
    await a;
    expect(chamadas).toEqual(['envio', 'baixa']);
  });

  it('SC-05 o círculo mostra a porcentagem, ✓ no fim e abre a janela', async () => {
    vi.doMock('@/components/offline/DadosOffline', () => ({ abrirDadosOffline: () => window.dispatchEvent(new Event('teste:abrir')) }));
    const { default: Circulo } = await import('@/components/offline/CirculoDeSincronizacao');
    render(<Circulo />);
    expect(screen.queryByRole('button', { name: /Sincronização/ })).toBeNull();
    resolverBaixa = undefined;
    let p;
    await act(async () => { p = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' }); });
    await vi.waitFor(() => expect(resolverBaixa).toBeTypeOf('function'));
    await act(async () => {});
    const botao = screen.getByRole('button', { name: /Sincronização: Baixando: Cadastros — 68%/ });
    expect(screen.getByRole('progressbar').textContent).toBe('68%');
    const abriu = vi.fn();
    window.addEventListener('teste:abrir', abriu);
    fireEvent.click(botao);
    expect(abriu).toHaveBeenCalledTimes(1);
    await act(async () => { resolverBaixa(); await p; });
    expect(screen.getByRole('button', { name: /Tudo sincronizado/ }).getAttribute('data-fase')).toBe('pronto');
    window.removeEventListener('teste:abrir', abriu);
    vi.doUnmock('@/components/offline/DadosOffline');
  });

  it('SC-06 ficou registro no celular: o fim diz quantos (nunca "Tudo sincronizado")', async () => {
    filaRestante.aguardando = 1;
    filaRestante.atencao = 1;
    const fases = [];
    const ouvir = (e) => fases.push(`${e.detail.fase}:${e.detail.titulo}`);
    window.addEventListener(svc.EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
    const p = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    resolverBaixa();
    await p;
    window.removeEventListener(svc.EVENTO_PROGRESSO_DA_SINCRONIA, ouvir);
    expect(fases.at(-1)).toBe('incompleto:2 registros ficaram no celular');
    expect(fases.some((f) => f.includes('Tudo sincronizado'))).toBe(false);
    const { sincronizarTudo } = await import('@/lib/offline/sincronizacao/gatilhosDeSincronizacao');
    expect(sincronizarTudo).toHaveBeenCalledWith({ jaEmVoltaDaRede: true });
  });

  it('SC-07 a leve: só o que mudou, sem cartão; a pessoa pedindo no meio passa a ver a que está em curso', async () => {
    vi.doMock('@/components/offline/DadosOffline', () => ({ abrirDadosOffline: () => {} }));
    const { default: Circulo } = await import('@/components/offline/CirculoDeSincronizacao');
    render(<Circulo />);
    resolverBaixa = undefined;
    let p;
    await act(async () => { p = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1', modo: 'leve', mostrar: false }); });
    await vi.waitFor(() => expect(resolverBaixa).toBeTypeOf('function'));
    expect(chamadas).toEqual(['envio', 'leve']);
    expect(svc.lerProgressoDaSincronia()).toMatchObject({ ativo: true, visivel: false });
    expect(screen.queryByRole('button', { name: /Sincronização/ }), 'automática: sem o cartão').toBeNull();
    // "Sincronizar agora" no meio: recebe a mesma e o cartão aparece.
    let q;
    await act(async () => { q = svc.sincronizarNosDoisSentidos({ empresaId: 'emp-1' }); });
    expect(q).toBe(p);
    expect(screen.getByRole('button', { name: /Sincronização/ })).toBeTruthy();
    await act(async () => { resolverBaixa(); await p; });
    expect(await p).toMatchObject({ ok: true, em: 456 });
    expect(chamadas).toEqual(['envio', 'leve']);
    vi.doUnmock('@/components/offline/DadosOffline');
  });
});
