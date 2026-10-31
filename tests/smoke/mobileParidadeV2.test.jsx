/**
 * UX-MOBILE-V2 paridade 2 (D-PROD-88): campos de lançamento e seletores no
 * padrão Base1. JSDOM não aplica media query: prova estrutura e comportamento.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import React from 'react';

beforeEach(() => cleanup());

describe('PAR — campo de lançamento (LancField)', () => {
  it('PAR1 — rótulo dentro do campo, sobe quando há valor e aponta para o controle', async () => {
    const { default: LancField } = await import('@/components/cadastro/base1/LancField');
    const Caso = () => {
      const [v, setV] = React.useState('');
      return (
        <LancField label="Quantidade" required>
          <input value={v} onChange={(e) => setV(e.target.value)} />
        </LancField>
      );
    };
    render(<Caso />);
    const campo = screen.getByLabelText(/quantidade/i);
    const caixa = campo.closest('.mg-field');
    expect(caixa).not.toHaveClass('mg-has-value');
    await act(async () => fireEvent.change(campo, { target: { value: '12' } }));
    expect(caixa).toHaveClass('mg-has-value');
  });

  it('PAR2 — nenhum formulário de lançamento mantém o FL antigo (rótulo em cima, borda slate)', () => {
    const arquivos = execSync("grep -rln '^const FL\\b' src", { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const arq of arquivos) {
      if (arq.endsWith('FormularioLote.jsx')) continue; // FL legado sem uso no arquivo
      expect(readFileSync(arq, 'utf8'), arq).toMatch(/const FL = LancField;/);
    }
  });
});

describe('PAR — seletores', () => {
  it('PAR3 — nenhum <select> nativo solto nos formulários', () => {
    const achados = execSync("grep -rln '<select' src/components src/pages || true", { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.endsWith('base1/B1Select.jsx'));
    expect(achados).toEqual([]);
  });

  it('PAR4 — B1Select no desktop continua o select nativo, com a mesma API', async () => {
    const { default: B1Select } = await import('@/components/cadastro/base1/B1Select');
    const onChange = vi.fn();
    render(
      <B1Select aria-label="Tipo" value="" onChange={onChange}>
        <option value="">SELECIONE</option>
        <option value="a">A</option>
      </B1Select>,
    );
    const sel = screen.getByRole('combobox', { name: 'Tipo' });
    expect(sel.tagName).toBe('SELECT');
    await act(async () => fireEvent.change(sel, { target: { value: 'a' } }));
    expect(onChange).toHaveBeenCalled();
  });

  it('PAR5 — select genérico e autocomplete têm o caminho de folha no celular', () => {
    expect(readFileSync('src/components/ui/select.jsx', 'utf8')).toMatch(/mk-select /);
    expect(readFileSync('src/styles/maike-mobile-shell.css', 'utf8')).toMatch(/\[data-radix-popper-content-wrapper\]:has\(> \.mk-select\)/);
    expect(readFileSync('src/components/financeiro/AutocompleteGenerico.jsx', 'utf8')).toMatch(/<MobileSheet/);
  });
});

describe('PAR — lista', () => {
  it('PAR6 — resumo na ordem Listados, Filtrados, Totais, Selecionados', () => {
    const fonte = readFileSync('src/components/cadastro/base1/CadastroListaChrome.jsx', 'utf8');
    const ordem = ['Listados:', 'Filtrados:', 'Totais:', 'Selecionados:'].map((t) => fonte.indexOf(`>${t} {`));
    expect(ordem.every((i, k) => i > 0 && (k === 0 || i > ordem[k - 1]))).toBe(true);
  });
});
