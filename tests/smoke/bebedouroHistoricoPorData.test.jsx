/**
 * Frente G6 — tela Bebedouros.
 *
 *  #39  "Último registro", "Próxima limpeza" e "Próxima inspeção" da ficha do
 *       bebedouro saíam de `historico[0]`/`historico.find(...)`, isto é, da
 *       ordem de criação do servidor (createdAt desc). Um lançamento
 *       retroativo, criado depois, passava a ser o "último". Contrato: as datas
 *       vêm de `data_lancamento` (+ hora), como em `buildBebedouroAlertas`.
 *  #40  Excluir um lançamento na timeline não invalidava a chave da lista da
 *       tela Bebedouros (["bebedouro-historico-all", empresaId]); status,
 *       alertas e custos ficavam com o lançamento apagado.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const estado = vi.hoisted(() => ({ historico: /** @type {any[]} */ ([]) }));

vi.mock('@/hooks/useBebedouroHistorico', () => ({
  useBebedouroHistorico: () => ({ data: estado.historico }),
}));
vi.mock('@/services/mapaService', () => ({
  listarIconesPorTipoEntidade: async () => [],
  listarPontosDaEmpresa: async () => [],
}));
vi.mock('@/services/loteManejoService', () => ({ listarTodosLotes: async () => [] }));
vi.mock('@/services/bebedouroDataService', () => ({ excluirHistorico: vi.fn(async () => null) }));
vi.mock('@/lib/maikeConfirmar', () => ({ confirmarExclusao: async () => true }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import DetalhesBebedouro from '@/components/bebedouros/DetalhesBebedouro';
import BebedouroTimeline from '@/components/bebedouros/BebedouroTimeline';
import { ordenarHistoricoBebedouroPorData, resumoHistoricoBebedouro } from '@/components/bebedouros/historicoBebedouroPorData';

const brasil = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR');

function montar(ui, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

const bebedouro = {
  id: 'beb-1',
  nome: 'Bebedouro 1',
  periodicidade_limpeza: 'Mensal',
  periodicidade_inspecao: 'Semanal',
};

beforeEach(() => {
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
});
afterEach(() => {
  cleanup();
  estado.historico = [];
  localStorage.clear();
});

function valorDaMetrica(label) {
  const rotulo = screen.getByText(label);
  return rotulo.parentElement.lastChild.textContent;
}

describe('#39 ficha do bebedouro usa a data do lançamento', () => {
  it('lançamento retroativo criado por último não vira "último registro" nem base da próxima limpeza/inspeção', () => {
    // Ordem do servidor: createdAt desc — o retroativo (01/11) veio primeiro.
    estado.historico = [
      { id: 'h3', tipo_lancamento: 'Limpeza', status: 'Concluído', data_lancamento: '2026-11-01', hora_lancamento: '08:00' },
      { id: 'h2', tipo_lancamento: 'Inspeção', status: 'Concluído', data_lancamento: '2026-11-01', hora_lancamento: '09:00' },
      { id: 'h1', tipo_lancamento: 'Limpeza', status: 'Concluído', data_lancamento: '2026-11-16', hora_lancamento: '07:00', descricao: 'limpeza do dia' },
      { id: 'h0', tipo_lancamento: 'Inspeção', status: 'Concluído', data_lancamento: '2026-11-10', hora_lancamento: '10:00' },
    ];
    montar(<DetalhesBebedouro bebedouro={bebedouro} />);

    expect(valorDaMetrica('Próxima limpeza')).toBe(brasil('2026-12-16'));
    expect(valorDaMetrica('Próxima inspeção')).toBe(brasil('2026-11-17'));
    expect(screen.getByText(`${brasil('2026-11-16')} · 07:00`)).toBeTruthy();
    expect(screen.getByText('Obs: limpeza do dia')).toBeTruthy();
  });

  it('limpeza pendente não adia a próxima limpeza (mesma regra da lista)', () => {
    estado.historico = [
      { id: 'h2', tipo_lancamento: 'Limpeza', status: 'Pendente', data_lancamento: '2026-11-20' },
      { id: 'h1', tipo_lancamento: 'Limpeza', status: 'Concluído', data_lancamento: '2026-11-05' },
    ];
    montar(<DetalhesBebedouro bebedouro={bebedouro} />);
    expect(valorDaMetrica('Próxima limpeza')).toBe(brasil('2026-12-05'));
  });

  it('ordenação: data + hora desc, estável nos empates, sem data no fim, sem mutar a entrada', () => {
    const entrada = [
      { id: 'a', data_lancamento: '' },
      { id: 'b', data_lancamento: '2026-11-01T00:00:00.000Z', hora_lancamento: '10:00' },
      { id: 'c', data_lancamento: '2026-11-01', hora_lancamento: '10:00' },
      { id: 'd', data_lancamento: '2026-11-01', hora_lancamento: '11:30' },
      { id: 'e', data_lancamento: '2026-10-31', hora_lancamento: '23:59' },
    ];
    const copia = [...entrada];
    expect(ordenarHistoricoBebedouroPorData(entrada).map((i) => i.id)).toEqual(['d', 'b', 'c', 'e', 'a']);
    expect(entrada).toEqual(copia);
    expect(resumoHistoricoBebedouro([]).ultimoLancamento).toBeUndefined();
  });
});

describe('#40 excluir na timeline atualiza a lista da tela Bebedouros', () => {
  it('invalida também ["bebedouro-historico-all"]', async () => {
    const queryClient = new QueryClient();
    const espiao = vi.spyOn(queryClient, 'invalidateQueries');
    const historico = [{ id: 'h1', tipo_lancamento: 'Limpeza', status: 'Emergencial', data_lancamento: '2026-11-16' }];
    montar(<BebedouroTimeline historico={historico} podeExcluir />, queryClient);

    fireEvent.click(screen.getByRole('button', { name: /excluir/i }));

    await waitFor(() => {
      const chaves = espiao.mock.calls.map(([filtro]) => JSON.stringify(filtro?.queryKey));
      expect(chaves).toContain(JSON.stringify(['bebedouro-historico']));
      expect(chaves).toContain(JSON.stringify(['bebedouro-historico-all']));
    });
  });
});
