/**
 * D-PROD-230 — a grade do Motor Base1 aplica os filtros de cabeçalho vindos do Assistente
 * (`filtrosExternos`): cada chave nova substitui os filtros e a lista mostrada encolhe.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import CadastroBase1Grade from '@/components/cadastro/base1/CadastroBase1Grade';

afterEach(() => cleanup());

const COLUNAS = [
  { id: 'nome', label: 'Nome', sortable: true },
  { id: 'sexo', label: 'Sexo', sortable: true },
  { id: 'peso', label: 'Peso', sortable: true, filterKind: /** @type {'num'} */ ('num') },
];
const LINHAS = [
  { id: '1', nome: 'A', sexo: 'Macho', peso: '360 kg' },
  { id: '2', nome: 'B', sexo: 'Fêmea', peso: '180 kg' },
  { id: '3', nome: 'C', sexo: 'Macho', peso: '300 kg' },
];

const montar = (filtrosExternos, aoMostrar) => (
  <CadastroBase1Grade
    rows={LINHAS}
    columns={COLUNAS}
    storageKey="teste_filtro_assistente"
    droppableId="teste-filtro-assistente"
    getFieldValue={(r, c) => r[c]}
    renderCell={(r, c) => r[c]}
    defaultSortKey="nome"
    emptyText="Vazio"
    referenceHeaders
    onDisplayChange={aoMostrar}
    filtrosExternos={filtrosExternos}
  />
);

describe('CadastroBase1Grade — filtrosExternos', () => {
  it('aplica, substitui e limpa', async () => {
    const aoMostrar = vi.fn();
    const nomes = () => aoMostrar.mock.calls.at(-1)[0].rows.map((r) => r.nome);
    const { rerender } = render(montar(null, aoMostrar));
    await waitFor(() => expect(nomes()).toEqual(['A', 'B', 'C']));

    rerender(montar({ chave: 1, filtros: { sexo: { op: '', v1: '', v2: '', valores: new Set(['Macho']) }, peso: { op: 'maie', v1: '350', v2: '', valores: null } } }, aoMostrar));
    await waitFor(() => expect(nomes()).toEqual(['A']));

    rerender(montar({ chave: 2, filtros: { sexo: { op: '', v1: '', v2: '', valores: new Set(['Macho']) } } }, aoMostrar));
    await waitFor(() => expect(nomes()).toEqual(['A', 'C']));

    rerender(montar({ chave: 3, filtros: {} }, aoMostrar));
    await waitFor(() => expect(nomes()).toEqual(['A', 'B', 'C']));
  });
});
