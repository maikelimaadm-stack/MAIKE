/**
 * v5 — ajustes pedidos pelo proprietário (D-PROD-96): Anexo ao lado do
 * Salvar, colunas no celular, filtros com descartar à esquerda, botões
 * padronizados e folha sem atraso no arraste.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';

const codigo = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const midia = (celular) => {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: celular && /max-width:\s*(639|767)px/.test(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
};

let original;
beforeEach(() => {
  cleanup();
  original = window.matchMedia;
});
afterEach(() => {
  window.matchMedia = original;
});

describe('V5 — edição', () => {
  it('V5-1 — publica as ações da edição no cabeçalho do app e o Layout as põe antes do ✓', () => {
    const ctx = codigo('src/lib/mobileShellContext.jsx');
    expect(ctx).toMatch(/acoes: acoesRef\.current\.map/);
    const layout = codigo('src/Layout.jsx');
    const i = layout.indexOf('mk-mhdr__acoes');
    const bloco = layout.slice(i, layout.indexOf('</div>', layout.indexOf('form={mobileRecord.formId}')));
    expect(bloco.indexOf('mobileRecord.acoes')).toBeLessThan(bloco.indexOf('form={mobileRecord.formId}'));
  });

  it('V5-2 — no celular a barra some inteira na edição (sem a linha vazia)', () => {
    const fonte = codigo('src/components/cadastro/base1/CadastroListaChrome.jsx');
    expect(fonte).toMatch(/const barraNoCabecalho = Boolean\(shellDoCelular && recordMode && recordEditing && secondaryToolsLocked\)/);
    expect(fonte).toMatch(/joinedShell && !barraNoCabecalho \? toolbarRow : null/);
  });
});

describe('V5 — filtros e colunas', () => {
  it('V5-3 — filtro da coluna: Cancelar à esquerda, Aplicar à direita', () => {
    const fonte = codigo('src/components/cadastro/base1/CadastroColunaFiltro.jsx');
    const rodape = fonte.slice(fonte.indexOf('className="fpop-f"'));
    expect(rodape.indexOf('aria-label="Cancelar"')).toBeLessThan(rodape.indexOf('fpop-zero'));
    expect(rodape.indexOf('fpop-zero')).toBeLessThan(rodape.indexOf('aria-label="Aplicar"'));
  });

  it('V5-4 — colunas no celular: chave mostra/oculta, ↑↓ reordena e ✓ aplica', async () => {
    midia(true);
    const { default: ConfiguracaoColunasB1Dialog } = await import('@/components/cadastro/base1/ConfiguracaoColunasB1Dialog');
    const onAplicar = vi.fn();
    render(
      <ConfiguracaoColunasB1Dialog
        open
        onFechar={() => {}}
        colunas={[
          { id: 'codigo', label: 'Código' },
          { id: 'nome', label: 'Nome' },
          { id: 'setor', label: 'Setor' },
        ]}
        ocultas={new Set()}
        onAplicar={onAplicar}
        onRestaurar={() => {}}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: 'Mostrar Nome' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Subir Setor' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Aplicar' })));
    expect(onAplicar).toHaveBeenCalledWith(['codigo', 'setor'], ['codigo', 'setor', 'nome']);
  });

  it('V5-5 — a última coluna visível não pode ser ocultada', async () => {
    midia(true);
    const { default: ConfiguracaoColunasB1Dialog } = await import('@/components/cadastro/base1/ConfiguracaoColunasB1Dialog');
    render(
      <ConfiguracaoColunasB1Dialog
        open
        onFechar={() => {}}
        colunas={[{ id: 'codigo', label: 'Código' }, { id: 'nome', label: 'Nome' }]}
        ocultas={new Set(['nome'])}
        onAplicar={() => {}}
        onRestaurar={() => {}}
      />,
    );
    expect(screen.getByRole('switch', { name: 'Mostrar Código' })).toBeDisabled();
  });
});

describe('V5 — estilo e folha', () => {
  const css = () => readFileSync('src/styles/maike-mobile-shell.css', 'utf8');

  it('V5-6 — botões sem sombra e cinza, com ícone verde/vermelho', () => {
    const fonte = css();
    expect(fonte).toMatch(/:is\(\.tb-btn, \.view-seg, \.mg-rec-pager__btn, \.mk-sheet__close, \.mk-sheet__new, \.mk-mhdr__round, \.mk-anexos__remover\):not\(#mk-padrao\)[\s\S]*?box-shadow: none !important/);
    expect(fonte).toMatch(/\.tb-btn\.tb-btn-green:not\(#mk-padrao\) svg \{\s*color: #16a34a !important/);
  });

  it('V5-7 — formulário do registro não anima ao montar (sem piscada)', () => {
    expect(css()).toMatch(/\.cadastro-b1--full-page \.mg-form-scroll \{\s*animation: none !important/);
  });

  it('V5-8 — arraste da folha só mexe em transform durante o movimento', () => {
    const fonte = codigo('src/components/common/MobileSheet.jsx');
    const pintar = fonte.slice(fonte.indexOf('const pintar'), fonte.indexOf('const iniciar'));
    expect(pintar).toMatch(/translate3d/);
    expect(pintar).not.toMatch(/style\.height/);
    expect(fonte).toMatch(/requestAnimationFrame\(pintar\)/);
  });
});
