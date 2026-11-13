/**
 * D-PROD-178 — dia civil que vira à meia-noite NO FUSO DA FAZENDA
 * (`src/hooks/useDiaCivil.js`).
 *
 *  - `msAteProximaMeiaNoite(fuso, agora)` é pura: America/Sao_Paulo (UTC−3)
 *    × UTC para o mesmo instante;
 *  - `atrasoAteVirada` nunca passa do teto de segurança de 1 h;
 *  - o hook troca o dia na virada (fake timers), com UM timer de módulo por
 *    fuso (dois componentes no mesmo fuso não criam dois timers), sem timer
 *    depois de desmontar;
 *  - aba em segundo plano/suspensão: `visibilitychange` e `focus` rechecam o
 *    dia sem esperar o timer;
 *  - sem fuso (ou fuso inválido) usa o relógio do navegador, como `hojeNoFuso(null)`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { hojeNoFuso } from '@/lib/diaCivil';
import {
  TETO_ATRASO_DIA_CIVIL_MS,
  atrasoAteVirada,
  msAteProximaMeiaNoite,
  useDiaCivil,
} from '@/hooks/useDiaCivil';

const SP = 'America/Sao_Paulo';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('msAteProximaMeiaNoite (pura)', () => {
  it('mesmo instante: 30 min até a meia-noite em São Paulo, 21 h 30 min em UTC', () => {
    const agora = new Date('2026-11-12T02:30:00.000Z'); // 23:30 de 11/11 em SP
    expect(msAteProximaMeiaNoite(SP, agora)).toBe(30 * 60 * 1000);
    expect(msAteProximaMeiaNoite('UTC', agora)).toBe((21 * 60 + 30) * 60 * 1000);
  });

  it('considera os milissegundos e a virada de mês/ano', () => {
    expect(msAteProximaMeiaNoite(SP, new Date('2026-11-12T02:59:59.500Z'))).toBe(500);
    expect(msAteProximaMeiaNoite('UTC', new Date('2026-12-31T23:59:00.000Z'))).toBe(60 * 1000);
    expect(msAteProximaMeiaNoite('UTC', new Date('2026-11-12T00:00:00.000Z'))).toBe(24 * 60 * 60 * 1000);
  });

  it('fuso inválido cai no relógio do navegador sem lançar erro', () => {
    const agora = new Date('2026-11-12T02:30:00.000Z');
    expect(msAteProximaMeiaNoite('Fuso/Inexistente', agora)).toBe(msAteProximaMeiaNoite(null, agora));
    expect(msAteProximaMeiaNoite(null, agora)).toBeGreaterThan(0);
  });

  it('atrasoAteVirada nunca passa do teto de 1 h', () => {
    expect(TETO_ATRASO_DIA_CIVIL_MS).toBe(60 * 60 * 1000);
    expect(atrasoAteVirada(SP, new Date('2026-11-11T13:00:00.000Z'))).toBe(TETO_ATRASO_DIA_CIVIL_MS);
    const perto = atrasoAteVirada(SP, new Date('2026-11-12T02:59:00.000Z'));
    expect(perto).toBeGreaterThanOrEqual(60 * 1000);
    expect(perto).toBeLessThan(61 * 1000);
  });
});

describe('useDiaCivil', () => {
  it('vira o dia à meia-noite no fuso da fazenda (SP) enquanto UTC já está no dia seguinte', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T02:59:00.000Z')); // 23:59 de 11/11 em SP
    const sp = renderHook(() => useDiaCivil(SP));
    const utc = renderHook(() => useDiaCivil('UTC'));
    expect(sp.result.current).toBe('2026-11-11');
    expect(utc.result.current).toBe('2026-11-12');

    act(() => { vi.advanceTimersByTime(59 * 1000); });
    expect(sp.result.current).toBe('2026-11-11');
    act(() => { vi.advanceTimersByTime(2 * 1000); });
    expect(sp.result.current).toBe('2026-11-12');
    expect(utc.result.current).toBe('2026-11-12');
  });

  it('um único timer por fuso, reagendado a cada disparo; nenhum depois de desmontar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T13:00:00.000Z')); // 10:00 em SP
    const base = vi.getTimerCount();
    const a = renderHook(() => useDiaCivil(SP));
    const b = renderHook(() => useDiaCivil(SP));
    expect(vi.getTimerCount() - base).toBe(1);
    const c = renderHook(() => useDiaCivil('UTC'));
    expect(vi.getTimerCount() - base).toBe(2);

    // Teto de 1 h: dispara, o dia não mudou, reagenda (continua 1 por fuso).
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000); });
    expect(a.result.current).toBe('2026-11-11');
    expect(vi.getTimerCount() - base).toBe(2);

    a.unmount();
    expect(vi.getTimerCount() - base).toBe(2);
    b.unmount();
    expect(vi.getTimerCount() - base).toBe(1);
    c.unmount();
    expect(vi.getTimerCount() - base).toBe(0);
  });

  it('recheca o dia ao voltar a aba (visibilitychange) e ao focar a janela, sem esperar o timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T13:00:00.000Z'));
    const { result } = renderHook(() => useDiaCivil(SP));
    expect(result.current).toBe('2026-11-11');

    // Suspensão: o relógio anda dois dias sem nenhum timer disparar.
    vi.setSystemTime(new Date('2026-11-13T13:00:00.000Z'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current).toBe('2026-11-13');

    vi.setSystemTime(new Date('2026-11-14T13:00:00.000Z'));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current).toBe('2026-11-14');
  });

  it('troca de fuso no mesmo componente passa a usar o dia do novo fuso', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T02:30:00.000Z'));
    const { result, rerender } = renderHook(({ fuso }) => useDiaCivil(fuso), { initialProps: { fuso: SP } });
    expect(result.current).toBe('2026-11-11');
    rerender({ fuso: 'UTC' });
    expect(result.current).toBe('2026-11-12');
  });

  it('sem fuso: relógio do navegador, igual a hojeNoFuso(null)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T15:00:00.000Z'));
    const { result } = renderHook(() => useDiaCivil(null));
    expect(result.current).toBe(hojeNoFuso(null));
    const invalido = renderHook(() => useDiaCivil('Fuso/Inexistente'));
    expect(invalido.result.current).toBe(hojeNoFuso(null));
  });
});
