/**
 * D-PROD-294 — primeira entrada no app: baixa tudo ANTES de abrir o sistema.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const servico = {
  baixarDadosParaOffline: vi.fn(),
  estaSemInternet: vi.fn(() => false),
  garantirEmpresaSelecionada: vi.fn(async () => 'emp-1'),
};
vi.mock('@/services/dadosOfflineService', () => servico);
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: 'cli-1' }) }));

const { default: PreparoDoApp } = await import('@/components/offline/PreparoDoApp');

beforeEach(() => {
  vi.clearAllMocks();
  servico.estaSemInternet.mockReturnValue(false);
});

describe('PreparoDoApp', () => {
  it('PA-01 baixa com a empresa escolhida e abre o sistema sozinho quando tudo veio', async () => {
    servico.baixarDadosParaOffline.mockImplementation(async ({ aoAvancar }) => {
      aoAvancar({ etapa: 'mapa', titulo: 'Mapa', feitas: 1, total: 2 });
      aoAvancar({ etapa: 'cadastros', titulo: 'Cadastros', feitas: 3, total: 3 });
      return { ok: true, falhas: 0, em: Date.now() };
    });
    const aoConcluir = vi.fn();
    render(<PreparoDoApp aoConcluir={aoConcluir} />);
    expect(screen.getByText('Preparando o app para usar no campo')).toBeInTheDocument();
    await waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
    expect(servico.garantirEmpresaSelecionada).toHaveBeenCalledWith('cli-1');
    expect(servico.baixarDadosParaOffline).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'emp-1' }));
  });

  it('PA-02 sem internet: não baixa, explica e deixa tentar de novo ou abrir assim mesmo', async () => {
    servico.estaSemInternet.mockReturnValue(true);
    const aoConcluir = vi.fn();
    render(<PreparoDoApp aoConcluir={aoConcluir} />);
    expect(await screen.findByText(/Sem internet. Conecte para preparar o app./)).toBeInTheDocument();
    expect(servico.baixarDadosParaOffline).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: 'Abrir assim mesmo' }).click(); });
    expect(aoConcluir).toHaveBeenCalledTimes(1);
  });

  it('PA-03 parte que não veio: não abre sozinho; "Tentar de novo" baixa outra vez', async () => {
    servico.baixarDadosParaOffline.mockResolvedValue({ ok: false, falhas: 2, em: Date.now() });
    const aoConcluir = vi.fn();
    render(<PreparoDoApp aoConcluir={aoConcluir} />);
    expect(await screen.findByText(/2 parte\(s\) não vieram/)).toBeInTheDocument();
    expect(aoConcluir).not.toHaveBeenCalled();
    servico.baixarDadosParaOffline.mockResolvedValue({ ok: true, falhas: 0, em: Date.now() });
    await act(async () => { screen.getByRole('button', { name: 'Tentar de novo' }).click(); });
    await waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
    expect(servico.baixarDadosParaOffline).toHaveBeenCalledTimes(2);
  });
});
