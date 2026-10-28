/**
 * Prova: motor Base1 + preset visual rodam sem importar Marcas/marcaService.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CadastroBase1Grade from '@/components/cadastro/base1/CadastroBase1Grade';
import {
  BASE1_GRADE_REFERENCE_HEADERS,
  BASE1_LISTA_CHROME_VISUAL,
  BASE1_LISTA_INTEGRADA_VISUAL,
} from '@/components/cadastro/base1/base1VisualPreset';

vi.mock('@/components/cadastro/base1/Base1Grid', () => ({
  default: function MockBase1Grid() {
    return <div data-testid="mock-base1-grid">grid</div>;
  },
}));

vi.mock('@/components/cadastro/base1/Base1Cards', () => ({
  Base1Cards: function MockBase1Cards() {
    return <div data-testid="mock-base1-cards">cards</div>;
  },
}));

const FAKE_COLS = [
  { id: 'codigo', label: 'Código', default: true, sortable: true, width: 80 },
  { id: 'nome', label: 'Nome', default: true, sortable: true, width: 200 },
];

const FAKE_ROWS = [
  { id: '1', codigo: 'A1', nome: 'Entidade fictícia' },
  { id: '2', codigo: 'B2', nome: 'Outra linha' },
];

function getFakeFieldValue(item, id) {
  return item[id] ?? '';
}

describe('motorBase1 fictitious entity harness', () => {
  it('renderiza grade com preset referenceHeaders sem módulos de Marca', () => {
    render(
      <CadastroBase1Grade
        rows={FAKE_ROWS}
        columns={FAKE_COLS}
        storageKey="test_colunas_ficticias_v1"
        droppableId="colunas-ficticias-test"
        getFieldValue={getFakeFieldValue}
        defaultSortKey="nome"
        emptyText="Nenhum registro"
        searchQuery=""
        resetFiltersKey={0}
        onSelectionChange={() => {}}
        onFiltersActiveChange={() => {}}
        viewMode="table"
        {...BASE1_GRADE_REFERENCE_HEADERS}
      />,
    );
    expect(screen.getByTestId('mock-base1-grid')).toBeTruthy();
    expect(BASE1_LISTA_CHROME_VISUAL.joinTableToolbar).toBe(true);
  });

  it('preset lista integrada congela workspace, chrome e grade', () => {
    expect(BASE1_LISTA_INTEGRADA_VISUAL.workspace.pageLayout).toBe('base1-list');
    expect(BASE1_LISTA_INTEGRADA_VISUAL.chrome.portalComprasSkin).toBe(true);
    expect(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders).toBe(true);
    expect(Object.isFrozen(BASE1_LISTA_INTEGRADA_VISUAL)).toBe(true);
  });
});
