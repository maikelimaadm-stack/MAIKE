/**
 * R5 — CAT-02 ordenação de exclusão e CAT-03 payload do formulário.
 */

import { describe, it, expect } from 'vitest';

import { ordenarExclusaoFolhasPrimeiro, filhasDe } from '@/services/categoriaProdutoService';
import { idsDescendentesDe } from '@/components/categorias-produto/FormularioCategoriaProduto.jsx';
import {
  buildHierarchy,
  flattenVisible,
  idsAncestraisDe,
} from '@/components/categorias-produto/TabelaCategoriasProduto.jsx';
import { ApiError } from '@/apis/_core/ApiError';

describe('R5 — ordenarExclusaoFolhasPrimeiro', () => {
  const arvore = [
    { id: 'a' },
    { id: 'b', categoria_pai_id: 'a' },
    { id: 'c', categoria_pai_id: 'b' },
    { id: 'x' },
  ];

  it('ordena A,B,C selecionados como C,B,A independente da seleção', () => {
    expect(ordenarExclusaoFolhasPrimeiro(arvore, ['a', 'b', 'c'])).toEqual(['c', 'b', 'a']);
    expect(ordenarExclusaoFolhasPrimeiro(arvore, ['c', 'a', 'b'])).toEqual(['c', 'b', 'a']);
  });

  it('itens sem relação mantêm ordem estável por id', () => {
    expect(ordenarExclusaoFolhasPrimeiro(arvore, ['x', 'a'])).toEqual(['a', 'x']);
  });

  it('detecta ciclo no subgrafo selecionado', () => {
    const ciclo = [
      { id: 'a', categoria_pai_id: 'b' },
      { id: 'b', categoria_pai_id: 'a' },
    ];
    expect(() => ordenarExclusaoFolhasPrimeiro(ciclo, ['a', 'b'])).toThrow(ApiError);
  });
});

describe('R5 — idsDescendentesDe', () => {
  const dados = [
    { id: 'a' },
    { id: 'b', categoria_pai_id: 'a' },
    { id: 'c', categoria_pai_id: 'b' },
    { id: 'd', categoria_pai_id: 'a' },
  ];

  it('coleta todos os níveis abaixo do nó editado', () => {
    expect([...idsDescendentesDe(dados, 'a')].sort()).toEqual(['b', 'c', 'd']);
    expect([...idsDescendentesDe(dados, 'b')]).toEqual(['c']);
  });
});

describe('R5 — buildHierarchy defensiva', () => {
  it('exibe ciclo legado sem recursão infinita', () => {
    const items = [
      { id: 'a', nome: 'A', categoria_pai_id: 'b', ordem: 1 },
      { id: 'b', nome: 'B', categoria_pai_id: 'a', ordem: 2 },
    ];
    const { roots } = buildHierarchy(items);
    const ids = new Set();
    const walk = (nodes) => {
      nodes.forEach((n) => {
        ids.add(n.id);
        if (n.children?.length) walk(n.children);
      });
    };
    walk(roots);
    expect(ids.size).toBe(2);
    expect(roots.every((r) => r._hierarquiaAnomala)).toBe(true);
  });

  it('mantém árvore válida igual à projeção linear esperada', () => {
    const items = [
      { id: 'a', ordem: 1 },
      { id: 'b', categoria_pai_id: 'a', ordem: 1 },
    ];
    const { roots } = buildHierarchy(items);
    expect(roots).toHaveLength(1);
    expect(roots[0].children[0].id).toBe('b');
  });
});

describe('POS99 — visibilidade na grade', () => {
  const arvore = [
    { id: 'raiz', nome: 'Raiz', ordem: 1 },
    { id: 'filha', nome: 'Filha', categoria_pai_id: 'raiz', ordem: 1 },
    { id: 'neta', nome: 'Neta', categoria_pai_id: 'filha', ordem: 1 },
  ];

  it('filha fica oculta com pai recolhido (RED reproduzido)', () => {
    const { roots, indice } = buildHierarchy(arvore);
    const visiveis = flattenVisible(roots, {}, { indice });
    expect(visiveis.map((n) => n.id)).toEqual(['raiz']);
  });

  it('revealIds expande ancestrais e exibe filha (GREEN)', () => {
    const { roots, indice } = buildHierarchy(arvore);
    const visiveis = flattenVisible(roots, {}, { indice, revealIds: new Set(['filha']) });
    expect(visiveis.map((n) => n.id)).toEqual(['raiz', 'filha']);
  });

  it('busca por filha inclui ancestral na lista achatada', () => {
    const { roots, indice } = buildHierarchy(arvore);
    const visiveis = flattenVisible(roots, {}, { indice, searchQuery: 'neta' });
    expect(visiveis.map((n) => n.id)).toEqual(['raiz', 'filha', 'neta']);
  });

  it('idsAncestraisDe percorre até a raiz', () => {
    const { indice } = buildHierarchy(arvore);
    expect(idsAncestraisDe(indice, 'neta')).toEqual(['filha', 'raiz']);
  });
});

describe('R5 — filhasDe', () => {
  it('ignora filhos também marcados para exclusão na validação do service', () => {
    const todas = [{ id: 'pai' }, { id: 'filho', categoria_pai_id: 'pai' }];
    const alvos = ['pai', 'filho'];
    const restantes = todas.filter((c) => !alvos.includes(c.id));
    expect(filhasDe(restantes, 'pai')).toHaveLength(0);
  });
});
