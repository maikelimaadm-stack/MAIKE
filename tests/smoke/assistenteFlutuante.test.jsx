/**
 * D-PROD-230 — Assistente só de leitura: botão flutuante, painel, envio com histórico,
 * erro de "não configurado", conversa preservada ao fechar/reabrir e ao trocar de tela
 * (o componente vive no Layout), e o Layout monta o botão uma vez.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const perguntar = vi.fn();
let opcoesDoFluxo = null;
vi.mock('@/services/assistenteService', () => ({
  perguntarAssistenteAoVivo: (d, o) => {
    opcoesDoFluxo = o;
    return perguntar(d, o);
  },
}));

import AssistenteFlutuante from '@/components/assistente/AssistenteFlutuante';

beforeEach(() => perguntar.mockReset());
afterEach(() => cleanup());

const perguntarPeloCampo = (texto) => {
  fireEvent.change(screen.getByTestId('assistente-campo'), { target: { value: texto } });
  fireEvent.click(screen.getByTestId('assistente-enviar'));
};

describe('AssistenteFlutuante', () => {
  it('abre pelo botão, envia a pergunta com fazenda e tela e mostra a resposta', async () => {
    perguntar.mockResolvedValueOnce({ resposta: 'O PASTO 3 está pronto.', ferramentas: ['listar_pastos'], recusada: false });
    render(<AssistenteFlutuante empresaId="emp-1" tela="MapaGeral" />);
    expect(screen.queryByTestId('assistente-painel')).toBeNull();
    fireEvent.click(screen.getByTestId('assistente-botao'));
    expect(screen.getByTestId('assistente-painel')).toBeTruthy();
    perguntarPeloCampo('Quais pastos estão prontos?');
    await waitFor(() => expect(screen.getByText('O PASTO 3 está pronto.')).toBeTruthy());
    expect(perguntar.mock.calls[0][0]).toEqual({ empresa_id: 'emp-1', pergunta: 'Quais pastos estão prontos?', tela: 'MapaGeral', historico: [] });
  });

  it('leva o histórico na segunda pergunta e mantém a conversa ao fechar, reabrir e trocar de tela', async () => {
    perguntar.mockResolvedValueOnce({ resposta: 'Resposta 1' }).mockResolvedValueOnce({ resposta: 'Resposta 2' });
    const { rerender } = render(<AssistenteFlutuante empresaId="emp-1" tela="MapaGeral" />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('Pergunta 1');
    await waitFor(() => expect(screen.getByText('Resposta 1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('assistente-fechar'));
    rerender(<AssistenteFlutuante empresaId="emp-1" tela="CadastroLotes" />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    expect(screen.getByText('Resposta 1')).toBeTruthy();
    perguntarPeloCampo('Pergunta 2');
    await waitFor(() => expect(screen.getByText('Resposta 2')).toBeTruthy());
    expect(perguntar.mock.calls[1][0]).toEqual({
      empresa_id: 'emp-1',
      pergunta: 'Pergunta 2',
      tela: 'CadastroLotes',
      historico: [{ papel: 'usuario', texto: 'Pergunta 1' }, { papel: 'assistente', texto: 'Resposta 1' }],
    });
  });

  it('trocar de fazenda começa outra conversa e descarta a resposta atrasada da fazenda anterior', async () => {
    let soltar;
    perguntar.mockImplementationOnce(() => new Promise((r) => { soltar = r; })).mockResolvedValueOnce({ resposta: 'Resposta da fazenda 2' });
    const { rerender } = render(<AssistenteFlutuante empresaId="emp-1" tela="MapaGeral" />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('Pergunta na fazenda 1');
    expect(screen.getByText('Pergunta na fazenda 1')).toBeTruthy();
    rerender(<AssistenteFlutuante empresaId="emp-2" tela="MapaGeral" />);
    expect(screen.queryByText('Pergunta na fazenda 1')).toBeNull();
    soltar({ resposta: 'Resposta atrasada da fazenda 1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Resposta atrasada da fazenda 1')).toBeNull();
    perguntarPeloCampo('Pergunta na fazenda 2');
    await waitFor(() => expect(screen.getByText('Resposta da fazenda 2')).toBeTruthy());
    expect(perguntar.mock.calls[1][0]).toEqual({ empresa_id: 'emp-2', pergunta: 'Pergunta na fazenda 2', tela: 'MapaGeral', historico: [] });
  });

  it('mostra a resposta aos pedaços, com o status da consulta, e troca pelo texto final', async () => {
    let soltar;
    perguntar.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    render(<AssistenteFlutuante empresaId="emp-1" tela="MapaGeral" />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('Quais pastos estão prontos?');
    expect(screen.getByTestId('assistente-status').textContent).toBe('Pensando…');
    act(() => opcoesDoFluxo.aoFerramenta('listar_pastos'));
    expect(screen.getByTestId('assistente-status').textContent).toBe('Consultando os pastos…');
    act(() => opcoesDoFluxo.aoTexto('O **PASTO 3** '));
    expect(screen.getByTestId('assistente-fala-parcial').textContent).toContain('O PASTO 3');
    expect(screen.getByTestId('assistente-fala-parcial').querySelector('strong').textContent).toBe('PASTO 3');
    act(() => opcoesDoFluxo.aoTexto('está pronto.'));
    expect(screen.getByTestId('assistente-fala-parcial').textContent).toContain('está pronto.');
    // Enquanto responde, o botão é "Parar" (não dá para mandar outra).
    expect(screen.queryByTestId('assistente-enviar')).toBeNull();
    expect(screen.getByTestId('assistente-parar')).toBeTruthy();
    await act(async () => soltar({ resposta: 'O **PASTO 3** está pronto.' }));
    expect(screen.queryByTestId('assistente-fala-parcial')).toBeNull();
    expect(screen.getByTestId('assistente-fala-resposta').textContent).toBe('O PASTO 3 está pronto.');
    expect(screen.getByTestId('assistente-enviar')).toBeTruthy();
  });

  it('"Parar" cancela e mantém o que já chegou, marcado como interrompido', async () => {
    perguntar.mockImplementationOnce(
      (_d, o) =>
        new Promise((_r, rejeitar) => {
          o.signal.addEventListener('abort', () => rejeitar(Object.assign(new Error('cancelado'), { name: 'AbortError' })));
        }),
    );
    render(<AssistenteFlutuante empresaId="emp-1" />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('Pergunta longa');
    act(() => opcoesDoFluxo.aoTexto('Parte da resposta'));
    fireEvent.click(screen.getByTestId('assistente-parar'));
    await waitFor(() => expect(screen.getByTestId('assistente-fala-resposta').textContent).toContain('Parte da resposta'));
    expect(screen.getByTestId('assistente-fala-resposta').textContent).toContain('(resposta interrompida)');
    expect(screen.getByTestId('assistente-enviar')).toBeTruthy();
  });

  it('mostra a mensagem de "não configurado" e não manda o erro como histórico', async () => {
    perguntar.mockRejectedValueOnce(new ApiError(API_ERROR_CODES.ASSISTENTE_NAO_CONFIGURADO));
    render(<AssistenteFlutuante empresaId="emp-1" />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('oi');
    await waitFor(() => expect(screen.getByText(/não está configurado/)).toBeTruthy());
  });

  it('sem fazenda escolhida não chama o servidor', () => {
    render(<AssistenteFlutuante empresaId={null} />);
    fireEvent.click(screen.getByTestId('assistente-botao'));
    perguntarPeloCampo('oi');
    expect(perguntar).not.toHaveBeenCalled();
    expect(screen.getByText(/Escolha uma fazenda/)).toBeTruthy();
  });

  it('o Layout monta o assistente uma vez, para todas as telas logadas', () => {
    const layout = readFileSync('src/Layout.jsx', 'utf8');
    expect(layout.match(/<AssistenteFlutuante /g)?.length).toBe(1);
  });
});
