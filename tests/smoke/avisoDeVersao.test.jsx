/**
 * D-PROD-304 — aviso de versão: "Versão nova do app pronta" (tocar atualiza na
 * hora) e "App atualizado" ao abrir com a versão nova.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

const toastCustom = vi.fn();
const toastDismiss = vi.fn();
vi.mock('sonner', () => ({ toast: { custom: (...a) => toastCustom(...a), dismiss: (...a) => toastDismiss(...a) } }));
const aplicar = vi.fn(async () => true);
vi.mock('@/lib/app/atualizacaoAutomatica', () => ({
  EVENTO_VERSAO_BAIXADA: 'maike:versao-baixada',
  EVENTO_APP_ATUALIZADO: 'maike:app-atualizado',
  aplicarVersaoBaixada: () => aplicar(),
}));

beforeEach(() => {
  toastCustom.mockClear();
  aplicar.mockClear();
});

describe('D-PROD-304 — aviso de versão', () => {
  it('VS-01 versão baixada: um aviso por versão; tocar atualiza na hora', async () => {
    const { default: AvisoDeVersao } = await import('@/components/offline/AvisoDeVersao');
    render(<AvisoDeVersao />);
    act(() => window.dispatchEvent(new CustomEvent('maike:versao-baixada', { detail: { versao: 'v2', id: 'id-v2' } })));
    act(() => window.dispatchEvent(new CustomEvent('maike:versao-baixada', { detail: { versao: 'v2', id: 'id-v2' } })));
    expect(toastCustom).toHaveBeenCalledTimes(1);
    expect(toastCustom.mock.calls[0][1]).toMatchObject({ id: 'maike-versao-baixada' });

    const { getByTestId } = render(toastCustom.mock.calls[0][0]('t1'));
    expect(getByTestId('aviso-versao-atualizar')).toHaveTextContent('Versão nova do app pronta');
    fireEvent.click(getByTestId('aviso-versao-atualizar'));
    expect(aplicar).toHaveBeenCalledTimes(1);
  });

  it('VS-02 abriu com a versão nova: "App atualizado"', async () => {
    const { default: AvisoDeVersao } = await import('@/components/offline/AvisoDeVersao');
    render(<AvisoDeVersao />);
    act(() => window.dispatchEvent(new CustomEvent('maike:app-atualizado', { detail: { versao: 'v2' } })));
    expect(toastCustom).toHaveBeenCalledTimes(1);
    const { container } = render(toastCustom.mock.calls[0][0]('t2'));
    expect(container).toHaveTextContent('App atualizado');
  });
});
