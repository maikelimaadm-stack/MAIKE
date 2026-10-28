/**
 * Motor Base1 — estados de registro/busca compartilhados (unit leve).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCadastroBase1Controller } from '@/hooks/useCadastroBase1Controller';

const wrapper = ({ children }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const baseConfig = () => ({
  storageKey: 'test_cols',
  columnIds: ['a'],
  queryKey: ['test', 'page'],
  fetchPage: vi.fn(async () => ({
    items: [{ id: '1', nome: 'Alpha' }],
    next_cursor: null,
    has_more: false,
    total: 1,
    limit: 100,
  })),
  duplicateLabelField: 'nome',
  searchPlaceholder: 'Buscar…',
  exportFileName: 't.csv',
  exportColumns: [],
  getExportFieldValue: () => '',
  getRecordTitle: (item) => item?.nome || 'Novo',
  getRecordCode: () => undefined,
  getSearchHaystack: (r) => r.nome || '',
  mapSearchSuggestion: (r) => ({ id: r.id, label: r.nome }),
  matchRowId: (r, id) => r.id === id,
  getRowId: (r) => r.id,
  findRowById: (rows, id) => rows.find((r) => r.id === id),
  onSubmitRecord: vi.fn(),
  onRequestDeleteMutation: vi.fn(),
});

describe('useCadastroBase1Controller', () => {
  it('abre registro em leitura via handleEdit com id existente', () => {
    const { result } = renderHook(() => useCadastroBase1Controller(baseConfig()), { wrapper });
    act(() => {
      result.current.handleEdit({ id: '1', nome: 'Alpha' });
    });
    expect(result.current.showForm).toBe(true);
    expect(result.current.isEditing).toBe(false);
  });

  it('Novo entra em edição; Cancelar após Novo restaura registro anterior', () => {
    const { result } = renderHook(() => useCadastroBase1Controller(baseConfig()), { wrapper });
    act(() => {
      result.current.handleEdit({ id: '1', nome: 'Alpha' });
    });
    act(() => {
      result.current.openNew();
    });
    expect(result.current.isEditing).toBe(true);
    act(() => {
      result.current.cancelForm();
    });
    expect(result.current.isEditing).toBe(false);
    expect(result.current.editingItem?.id).toBe('1');
  });
});
