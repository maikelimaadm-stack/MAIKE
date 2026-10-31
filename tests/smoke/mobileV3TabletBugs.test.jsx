/**
 * UX-MOBILE-V3 (D-PROD-91): seleção que "às vezes não abria", Sistema
 * Produtivo sobrepondo, botões Base1 iguais em todos os tamanhos e tablet.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';

beforeEach(() => cleanup());

describe('V3 — AutocompleteGenerico no desktop', () => {
  const montar = async (items) => {
    const { default: AutocompleteGenerico } = await import('@/components/financeiro/AutocompleteGenerico');
    const Caso = () => {
      const [v, setV] = React.useState('');
      return <AutocompleteGenerico items={items} value={v} onChange={setV} placeholder="BUSCAR SETOR..." />;
    };
    render(<Caso />);
    return screen.getByPlaceholderText('BUSCAR SETOR...');
  };

  it('V3-1 — lista vazia avisa em vez de não abrir nada', async () => {
    const campo = await montar([]);
    await act(async () => fireEvent.focus(campo));
    expect(await screen.findByText('Nenhuma opção disponível')).toBeInTheDocument();
  });

  it('V3-2 — depois de escolher, um novo clique no campo (ainda focado) reabre a lista', async () => {
    const campo = await montar([{ id: 'a', nome: 'Setor Norte' }, { id: 'b', nome: 'Setor Sul' }]);
    await act(async () => fireEvent.focus(campo));
    await act(async () => fireEvent.click(screen.getByText('Setor Sul')));
    // Fechou: o texto só existe como valor do campo, não como opção.
    expect(screen.queryByText('Setor Sul')).toBeNull();
    await act(async () => fireEvent.click(campo));
    // Reabriu filtrando pelo texto escolhido.
    expect(screen.getByText('Setor Sul')).toBeInTheDocument();
  });
});

describe('V3 — formulário e estilos', () => {
  const css = () => readFileSync('src/styles/maike-mobile-shell.css', 'utf8');

  it('V3-3 — Sistema Produtivo é campo de altura livre com pílulas de marcar', () => {
    expect(readFileSync('src/components/dynamic/DynamicFormRenderer.jsx', 'utf8')).toMatch(/field\.type === "checkbox" && typeof field\.render === "function"/);
    const lote = readFileSync('src/components/lotes/FormularioLote.jsx', 'utf8');
    expect(lote).toMatch(/className="b1-multi"/);
    expect(lote).toMatch(/role="checkbox" aria-checked=\{checked\}/);
  });

  it('V3-4 — datas nativas alinhadas à esquerda dentro do campo (Safari do iPhone)', () => {
    expect(css()).toMatch(/::-webkit-date-and-time-value \{\s*margin: 0;\s*text-align: left;/);
  });

  it('V3-5 — ações só com ícone são círculos em todos os tamanhos', () => {
    expect(css()).toMatch(/\.cadastro-b1 \.tb-btn\.mg-act-ic \{\s*width: auto !important;\s*min-width: 0 !important;\s*aspect-ratio: 1 \/ 1;/);
  });
});

describe('V3 — tablet', () => {
  it('V3-6 — cabeçalho e barra lateral do tablet entre 768 e 1023px', () => {
    const layout = readFileSync('src/Layout.jsx', 'utf8');
    expect(layout).toMatch(/className="mk-thdr hidden md:flex lg:hidden"/);
    expect(layout).toMatch(/aria-label="Navegação lateral" className="mk-rail hidden md:flex lg:hidden"/);
    expect(layout).toMatch(/max-w-\[1600px\] mx-auto px-4 py-2 hidden lg:block/);
  });
});
