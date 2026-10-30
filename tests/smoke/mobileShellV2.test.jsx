/**
 * UX-MOBILE-V2 — shell do celular e chrome Base1 (D-PROD-85).
 *
 * JSDOM não aplica media query: o que se prova aqui é estrutura e
 * comportamento (o que abre, o que navega, o que fica acessível), não pixels.
 * A conferência visual a 390 px está no relatório.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import React from 'react';

const codigo = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => cleanup());

describe('MSH — tela de Módulos do celular', () => {
  const MENU = [
    { id: 'mapa', title: 'Mapa', submenu: [{ id: 'pec-mapa-geral', title: 'Mapa Geral', url: 'MapaGeral' }] },
    {
      id: 'manejo',
      title: 'Manejo',
      submenu: [
        { id: 'pec-lotes', title: 'Lotes', url: 'CadastroLotes' },
        { id: 'pec-setores', title: 'Setores', url: 'CadastroSetores' },
      ],
    },
  ];

  const montar = async (props = {}) => {
    const { default: MobileModulesView } = await import('@/components/navigation/MobileModulesView');
    const onModulo = vi.fn();
    const onAbrirTela = vi.fn((e) => e.preventDefault());
    render(
      <MemoryRouter>
        <MobileModulesView
          menuItems={MENU}
          moduloId={null}
          onModulo={onModulo}
          moduloAtualId="manejo"
          paginaAtualUrl="CadastroLotes"
          onAbrirTela={onAbrirTela}
          {...props}
        />
      </MemoryRouter>,
    );
    return { onModulo, onAbrirTela };
  };

  it('MSH1 — grade mostra os módulos com a contagem de telas', async () => {
    await montar();
    const painel = screen.getByRole('dialog', { name: /módulos/i });
    expect(within(painel).getByRole('button', { name: /manejo\s*2 telas/i })).toBeInTheDocument();
    expect(within(painel).getByRole('button', { name: /mapa\s*1 tela/i })).toBeInTheDocument();
  });

  it('MSH2 — tocar no módulo pede a lista de telas dele', async () => {
    const { onModulo } = await montar();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^manejo/i })));
    expect(onModulo).toHaveBeenCalledWith('manejo');
  });

  it('MSH3 — módulo aberto lista as telas como links e marca a aberta', async () => {
    const { onAbrirTela } = await montar({ moduloId: 'manejo' });
    const aberta = screen.getByRole('link', { name: /lotes/i });
    expect(aberta).toHaveAttribute('aria-current', 'page');
    expect(within(aberta).getByText('Aberta')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('link', { name: /setores/i })));
    expect(onAbrirTela).toHaveBeenCalledWith(expect.anything(), 'CadastroSetores');
  });

  it('MSH4 — busca de telas filtra por nome', async () => {
    await montar();
    await act(async () => fireEvent.change(screen.getByRole('textbox', { name: /buscar tela/i }), { target: { value: 'set' } }));
    expect(screen.getByRole('link', { name: /setores/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /lotes/i })).toBeNull();
  });
});

describe('MSH — barra inferior e cabeçalho', () => {
  const layout = () => codigo('src/Layout.jsx');

  it('MSH5 — barra inferior: Mapa, Módulos, Lotes, Bebedouros', () => {
    const fonte = layout();
    const bloco = fonte.slice(fonte.indexOf('FIXED_MOBILE_NAV_ITEMS = ['), fonte.indexOf('];', fonte.indexOf('FIXED_MOBILE_NAV_ITEMS = [')));
    expect(bloco.match(/label: "([^"]+)"/g)).toEqual(['label: "Mapa"', 'label: "Módulos"', 'label: "Lotes"', 'label: "Bebedouros"']);
  });

  it('MSH6 — barra inferior some com registro aberto', () => {
    expect(layout()).toMatch(/const mostrarNavInferior = !mobileRecord/);
  });

  it('MSH7 — voltar: registro → lista, tela → telas do módulo dela', () => {
    const fonte = layout();
    expect(fonte).toMatch(/label: 'Voltar para a lista'/);
    expect(fonte).toMatch(/abrirModulos\(moduloDaPagina\)/);
  });
});

describe('MSH — chrome Base1', () => {
  const chrome = () => codigo('src/components/cadastro/base1/CadastroListaChrome.jsx');

  it('MSH8 — Novo/Editar/Duplicar/Excluir só com ícone e nome acessível', () => {
    const fonte = chrome();
    for (const nome of ['Editar', 'Duplicar']) expect(fonte).toContain(`aria-label="${nome}"`);
    expect(fonte).toMatch(/aria-label=\{createLabel\}/);
    expect(fonte).toMatch(/Excluir \(\$\{selectedCount\}\)/);
    // nenhum texto solto dentro dos botões de ação
    expect(fonte).not.toMatch(/<\/svg>\s*Editar|aria-hidden \/>\s*\n\s*Editar\s*\n/);
  });

  it('MSH9 — Salvar/Cancelar do registro também só com ícone', () => {
    const tela = codigo('src/components/cadastro/base1/CadastroBase1Screen.jsx');
    expect(tela).toMatch(/aria-label=\{c\.saving \? "Salvando…" : "Salvar"\}/);
    expect(tela).toMatch(/aria-label="Cancelar"/);
  });

  it('MSH10 — resumo some na edição; navegação ≪ ‹ n/N › ≫ no celular', () => {
    const fonte = chrome();
    expect(fonte).toMatch(/const listSummary = recordMode && recordEditing \? null/);
    for (const a of ['Primeiro registro', 'Registro anterior', 'Próximo registro', 'Último registro']) {
      expect(fonte).toContain(a);
    }
  });

  it('MSH11 — botão Filtros pede o painel "Filtrar por campo" à grade', async () => {
    const { pedirFiltroPorCampo, EVENTO_FILTRAR_POR_CAMPO } = await import('@/components/cadastro/base1/filtroPorCampoBus');
    const ouvinte = vi.fn();
    document.addEventListener(EVENTO_FILTRAR_POR_CAMPO, ouvinte);
    pedirFiltroPorCampo(null);
    document.removeEventListener(EVENTO_FILTRAR_POR_CAMPO, ouvinte);
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(codigo('src/components/cadastro/base1/CadastroBase1Grade.jsx')).toMatch(/addEventListener\(EVENTO_FILTRAR_POR_CAMPO/);
  });
});

describe('MSH — Filtrar por campo', () => {
  it('MSH12 — lista as colunas na ordem e resume o filtro ativo', async () => {
    const { default: FiltroPorCampo } = await import('@/components/cadastro/base1/FiltroPorCampo');
    const onEscolher = vi.fn();
    render(
      <FiltroPorCampo
        colunas={[{ id: 'nome', label: 'Nome' }, { id: 'cab', label: 'Cabeças' }]}
        filtros={{ cab: { op: 'mai', v1: '100', v2: '', valores: null } }}
        ancora={null}
        onEscolher={onEscolher}
        onFechar={() => {}}
      />,
    );
    const itens = screen.getAllByRole('menuitem');
    expect(itens.map((i) => i.textContent)).toEqual(['Nome', 'Cabeças> 100']);
    await act(async () => fireEvent.click(itens[1]));
    expect(onEscolher).toHaveBeenCalledWith('cab');
  });
});

describe('MSH — toque', () => {
  it('MSH13 — toque marca/desmarca (multi) e toque duplo abre', async () => {
    const { selectClickOf, ehToqueDuplo } = await import('@/components/cadastro/base1/selectClick');
    const toque = { nativeEvent: { pointerType: 'touch' }, ctrlKey: false, metaKey: false, shiftKey: false };
    const mouse = { nativeEvent: { pointerType: 'mouse' }, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(selectClickOf(/** @type {any} */ (toque)).ctrl).toBe(true);
    expect(selectClickOf(/** @type {any} */ (mouse)).ctrl).toBe(false);
    expect(ehToqueDuplo(/** @type {any} */ (toque), 'a')).toBe(false);
    expect(ehToqueDuplo(/** @type {any} */ (toque), 'a')).toBe(true);
    expect(ehToqueDuplo(/** @type {any} */ (mouse), 'a')).toBe(false);
  });
});
