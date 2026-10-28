/**
 * SSOT badge `ativo` — Motor Base1 (CadastroAtivoBadge + cellKind).
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import CadastroAtivoBadge from '@/components/cadastro/base1/CadastroAtivoBadge';
import {
  cadastroAtivoLabel,
  getCadastroAtivoFieldValue,
  isCadastroAtivo,
} from '@/lib/cadastroAtivoStatus';
import CadastroBase1Grade from '@/components/cadastro/base1/CadastroBase1Grade';
import { getMarcaFieldValue, MARCAS_COLUNAS } from '@/components/marcas/TabelaMarcas';
import { getUnidadeFieldValue, UNIDADES_COLUNAS } from '@/components/unidades-medida/TabelaUnidadesMedida';
import fs from 'node:fs';
import path from 'node:path';

const readSrc = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('CadastroAtivoBadge — unitário', () => {
  beforeEach(() => cleanup());

  it('rótulos e semântica para true, false e undefined (legado ativo)', () => {
    expect(isCadastroAtivo(true)).toBe(true);
    expect(isCadastroAtivo(undefined)).toBe(true);
    expect(isCadastroAtivo(false)).toBe(false);
    expect(cadastroAtivoLabel(false)).toBe('Inativo');
    expect(cadastroAtivoLabel(undefined)).toBe('Ativo');
    expect(getCadastroAtivoFieldValue({ ativo: false })).toBe('Inativo');
    expect(getCadastroAtivoFieldValue({})).toBe('Ativo');
  });

  it('renderiza classes e aria-label coerentes', () => {
    const { rerender } = render(<CadastroAtivoBadge value={true} />);
    let badge = screen.getByTestId('cadastro-ativo-badge');
    expect(badge.getAttribute('data-ativo')).toBe('true');
    expect(badge.getAttribute('aria-label')).toBe('Ativo');
    expect(badge.className).toMatch(/emerald/);

    rerender(<CadastroAtivoBadge value={false} />);
    badge = screen.getByTestId('cadastro-ativo-badge');
    expect(badge.getAttribute('data-ativo')).toBe('false');
    expect(badge.textContent).toBe('Inativo');
    expect(badge.className).toMatch(/slate/);
  });
});

function gradeHarnessProps(columns, rows, getFieldValue, renderCell) {
  return {
    rows,
    columns,
    storageKey: `test_ativo_badge_${columns[0]?.id ?? 'x'}`,
    droppableId: 'test-ativo-badge',
    getFieldValue,
    renderCell,
    defaultSortKey: columns.find((c) => c.sortable)?.id ?? columns[0].id,
    emptyText: 'Vazio',
    searchQuery: '',
    resetFiltersKey: 0,
    onSelectionChange: () => {},
    onFiltersActiveChange: () => {},
    viewMode: 'table',
    colunaSelecao: false,
    selecaoSticky: false,
  };
}

describe('CadastroBase1Grade — badge ativo real (sem mock de Base1Grid)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  const marcaRows = [
    { id: 'm1', numero_marca: '1', nome: 'MARCA A', descricao: 'D1', ativo: true },
    { id: 'm2', numero_marca: '2', nome: 'MARCA B', descricao: 'D2', ativo: false },
  ];

  const unidadeRows = [
    { id: 'u1', numero_unidade: '1', sigla: 'KG', descricao: 'Quilo', ativo: true },
    { id: 'u2', numero_unidade: '2', sigla: 'UN', descricao: 'Unidade', ativo: false },
  ];

  it('Marcas e Unidades exibem o mesmo badge SSOT na grade', () => {
    render(
      <>
        <div data-testid="marcas-wrap">
          <CadastroBase1Grade
            {...gradeHarnessProps(MARCAS_COLUNAS, marcaRows, getMarcaFieldValue, undefined)}
          />
        </div>
        <div data-testid="unidades-wrap">
          <CadastroBase1Grade
            {...gradeHarnessProps(UNIDADES_COLUNAS, unidadeRows, getUnidadeFieldValue, undefined)}
          />
        </div>
      </>,
    );

    for (const wrapId of ['marcas-wrap', 'unidades-wrap']) {
      const wrap = screen.getByTestId(wrapId);
      const badges = within(wrap).getAllByTestId('cadastro-ativo-badge');
      expect(badges).toHaveLength(2);
      expect(badges[0].textContent).toBe('Ativo');
      expect(badges[1].textContent).toBe('Inativo');
    }
  });

  it('adapters TabelaMarcas/TabelaUnidades não duplicam JSX de status', () => {
    const marcasSrc = readSrc('src/components/marcas/TabelaMarcas.jsx');
    const unidadesSrc = readSrc('src/components/unidades-medida/TabelaUnidadesMedida.jsx');
    expect(marcasSrc).not.toMatch(/Sim|Não/);
    expect(marcasSrc).not.toMatch(/<Badge/);
    expect(unidadesSrc).not.toMatch(/from "@\/components\/ui\/badge"/);
    expect(unidadesSrc).not.toMatch(/<Badge/);
    expect(MARCAS_COLUNAS.find((c) => c.id === 'ativo')?.cellKind).toBe('ativo-badge');
    expect(UNIDADES_COLUNAS.find((c) => c.id === 'ativo')?.cellKind).toBe('ativo-badge');
    expect(getMarcaFieldValue({ ativo: false }, 'ativo')).toBe('Inativo');
    expect(getUnidadeFieldValue({ ativo: true }, 'ativo')).toBe('Ativo');
  });
});
