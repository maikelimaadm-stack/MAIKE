/**
 * v4 — comportamento iOS / app do Claude (D-PROD-95).
 *
 * JSDOM não mede layout nem aplica media query: aqui se prova o comportamento
 * (Enter avança, + abre o cadastro, Anexos no menu da edição, ✕/✓ no
 * cabeçalho). A conferência visual a 390 px está no relatório.
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
let rectOriginal;
beforeEach(() => {
  cleanup();
  original = window.matchMedia;
  rectOriginal = Element.prototype.getBoundingClientRect;
  // JSDOM não mede: todo campo "visível" com 100×40.
  Element.prototype.getBoundingClientRect = function () {
    return /** @type {any} */ ({ width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0 });
  };
});
afterEach(() => {
  window.matchMedia = original;
  Element.prototype.getBoundingClientRect = rectOriginal;
});

describe('V4 — Enter funciona como Tab e o último salva', () => {
  it('V4-1 — Enter vai para o próximo campo; no último envia o formulário', async () => {
    const { instalarTecladoDoFormulario } = await import('@/lib/tecladoFormulario');
    const remover = instalarTecladoDoFormulario();
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Nome" />
        <input aria-label="Peso" type="number" />
        <textarea aria-label="Obs" />
        <input aria-label="Último" />
      </form>,
    );
    const nome = screen.getByLabelText('Nome');
    nome.focus();
    fireEvent.keyDown(nome, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Peso'));
    fireEvent.keyDown(screen.getByLabelText('Peso'), { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Obs'));
    // Textarea mantém a quebra de linha (não avança).
    fireEvent.keyDown(screen.getByLabelText('Obs'), { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('Obs'));
    const ultimo = screen.getByLabelText('Último');
    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    remover();
  });

  it('V4-2 — campo numérico ganha teclado numérico e a tecla mostra Próximo/OK', async () => {
    const { instalarTecladoDoFormulario } = await import('@/lib/tecladoFormulario');
    const remover = instalarTecladoDoFormulario();
    render(
      <form>
        <input aria-label="Qtd" type="number" />
        <input aria-label="Fim" />
      </form>,
    );
    const qtd = screen.getByLabelText('Qtd');
    act(() => qtd.focus());
    expect(qtd.getAttribute('inputmode')).toBe('decimal');
    expect(qtd.getAttribute('enterkeyhint')).toBe('next');
    const fim = screen.getByLabelText('Fim');
    act(() => fim.focus());
    expect(fim.getAttribute('enterkeyhint')).toBe('done');
    remover();
  });

  it('V4-3 — quem já trata o Enter (preventDefault) fica de fora', async () => {
    const { instalarTecladoDoFormulario } = await import('@/lib/tecladoFormulario');
    const remover = instalarTecladoDoFormulario();
    render(
      <form>
        <input aria-label="Busca" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
        <input aria-label="Outro" />
      </form>,
    );
    const busca = screen.getByLabelText('Busca');
    busca.focus();
    fireEvent.keyDown(busca, { key: 'Enter' });
    expect(document.activeElement).toBe(busca);
    remover();
  });
});

describe('V4 — + da lista de seleção cadastra um novo', () => {
  it('V4-4 — celular: + à direita do título da folha chama onCreateNew com a pesquisa', async () => {
    midia(true);
    const { default: AutocompleteGenerico } = await import('@/components/financeiro/AutocompleteGenerico');
    const onCreateNew = vi.fn();
    render(
      <AutocompleteGenerico
        items={[{ id: 'a', nome: 'Setor Norte' }]}
        value=""
        onChange={() => {}}
        placeholder="BUSCAR SETOR..."
        onCreateNew={onCreateNew}
        createNewLabel="Novo setor"
      />,
    );
    await act(async () => fireEvent.click(screen.getByPlaceholderText('BUSCAR SETOR...')));
    const mais = screen.getByRole('button', { name: 'Novo setor' });
    expect(mais.closest('.mk-sheet__head')).not.toBeNull();
    await act(async () => fireEvent.click(mais));
    expect(onCreateNew).toHaveBeenCalledWith('');
    expect(screen.queryByRole('option', { name: 'Setor Norte' })).toBeNull();
  });

  it('V4-5 — sem onCreateNew não há +', async () => {
    midia(true);
    const { default: AutocompleteGenerico } = await import('@/components/financeiro/AutocompleteGenerico');
    render(<AutocompleteGenerico items={[]} value="" onChange={() => {}} placeholder="BUSCAR COR..." />);
    await act(async () => fireEvent.click(screen.getByPlaceholderText('BUSCAR COR...')));
    expect(screen.queryByRole('button', { name: /novo|cadastrar/i })).toBeNull();
  });

  it('V4-6 — Lote liga o + de Setor e Categoria de Manejo ao cadastro rápido', () => {
    const fonte = codigo('src/components/lotes/FormularioLote.jsx');
    expect(fonte).toMatch(/createNewLabel="Novo setor"/);
    expect(fonte).toMatch(/createNewLabel="Nova categoria de manejo"/);
    expect(fonte).toMatch(/<CadastroRapidoSetor/);
    expect(fonte).toMatch(/<CadastroRapidoCategoriaManejo/);
  });
});

describe('V4 — folha, menu e cabeçalho', () => {
  it('V4-7 — folha: ✕ à esquerda, título, ação à direita; começa média e abre grande', async () => {
    midia(true);
    const { default: MobileSheet } = await import('@/components/common/MobileSheet');
    const { rerender } = render(
      <MobileSheet open onClose={() => {}} label="Setor" headerAction={<button type="button">Ação</button>}>
        <div>corpo</div>
      </MobileSheet>,
    );
    const folha = screen.getByRole('dialog', { name: 'Setor' });
    expect(folha.getAttribute('data-detent')).toBe('medium');
    const cab = folha.querySelector('.mk-sheet__head');
    expect([...cab.children].map((c) => c.textContent)).toEqual(['', 'Setor', 'Ação']);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Expandir painel' })));
    expect(folha.getAttribute('data-detent')).toBe('large');
    rerender(
      <MobileSheet open={false} onClose={() => {}} label="Setor">
        <div />
      </MobileSheet>,
    );
  });

  it('V4-8 — item whileEditing (Anexos) continua no Mais opções durante a edição', async () => {
    const fonte = codigo('src/components/cadastro/base1/CadastroListaChrome.jsx');
    expect(fonte).toMatch(/secondaryToolsLocked \? extraMenuItems\.filter\(\(item\) => item\.whileEditing\)/);
    const lotes = codigo('src/pages/CadastroLotes.jsx');
    expect(lotes).toMatch(/key: "anexos"[\s\S]*whileEditing: true[\s\S]*onSelect: openAttachments/);
    expect(lotes).not.toMatch(/extraToolbar=/);
  });

  it('V4-9 — registro em edição no celular: ✕ Descartar à esquerda e ✓ Salvar (submit do form) à direita', () => {
    const fonte = codigo('src/Layout.jsx');
    const i = fonte.indexOf('mk-mhdr--edit');
    const bloco = fonte.slice(i, fonte.indexOf('</div> :', i));
    expect(bloco.indexOf('aria-label="Descartar"')).toBeLessThan(bloco.indexOf('form={mobileRecord.formId}'));
    expect(bloco).toMatch(/type="submit"/);
    const tela = codigo('src/components/cadastro/base1/CadastroBase1Screen.jsx');
    expect(tela.indexOf('mg-act-cancelar')).toBeLessThan(tela.indexOf('mg-act-salvar'));
  });

  it('V4-10 — chave Ativo sem o texto Sim/Não por padrão', async () => {
    const { default: B1Switch } = await import('@/components/cadastro/base1/B1Switch');
    render(<B1Switch checked onChange={() => {}} ariaLabel="Ativo" />);
    expect(screen.getByRole('switch', { name: 'Ativo' })).toBeInTheDocument();
    expect(screen.queryByText('Sim')).toBeNull();
  });
});
