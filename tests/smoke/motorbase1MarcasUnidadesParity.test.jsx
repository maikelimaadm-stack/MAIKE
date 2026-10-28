/**
 * MOTORBASE1-COMPLETE-01 — Marcas e Unidades consomem o mesmo motor (controlador + screen).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('MotorBase1 — paridade de arquitetura Marcas/Unidades', () => {
  it('ambas as páginas importam useCadastroBase1Controller e CadastroBase1Screen', () => {
    for (const page of ['src/pages/Marcas.jsx', 'src/pages/UnidadesMedida.jsx']) {
      const src = read(page);
      expect(src).toMatch(/useCadastroBase1Controller/);
      expect(src).toMatch(/CadastroBase1Screen/);
      expect(src).not.toMatch(/useCadastroPageListBindings/);
    }
  });

  it('Unidades usa listagem paginada keyset (não listarUnidades full-fetch na tela)', () => {
    const src = read('src/pages/UnidadesMedida.jsx');
    expect(src).toMatch(/listarUnidadesPagina/);
    expect(src).not.toMatch(/listarUnidades\(\)/);
    expect(src).toMatch(/\["unidades_medida", "page"\]/);
  });

  it('formulário Unidades usa peças Base1 (não Card/Checkbox legado na página)', () => {
    const src = read('src/components/unidades-medida/FormularioUnidadeMedida.jsx');
    expect(src).toMatch(/B1Field/);
    expect(src).toMatch(/CadastroFormShell/);
    expect(src).toMatch(/readOnly/);
    const page = read('src/pages/UnidadesMedida.jsx');
    expect(page).not.toMatch(/from "@\/components\/ui\/checkbox"/);
    expect(page).not.toMatch(/embeddedForm/);
  });

  it('motor não importa domínio Marcas/Unidades (gate complementar)', () => {
    const motor = read('src/hooks/useCadastroBase1Controller.js');
    expect(motor).not.toMatch(/marcaService/);
    expect(motor).not.toMatch(/unidadeMedidaService/);
    expect(motor).not.toMatch(/FormularioMarca/);
    const screen = read('src/components/cadastro/base1/CadastroBase1Screen.jsx');
    expect(screen).not.toMatch(/pages\//);
    expect(screen).not.toMatch(/services\//);
  });

  it('status ativo vem do motor (cellKind + CadastroAtivoBadge), não JSX duplicado nos adapters', () => {
    const grade = read('src/components/cadastro/base1/CadastroBase1Grade.jsx');
    expect(grade).toMatch(/composeCadastroBase1RenderCell/);
    expect(read('src/components/cadastro/base1/CadastroAtivoBadge.jsx')).toMatch(/cadastro-ativo-badge/);
    for (const table of [
      'src/components/marcas/TabelaMarcas.jsx',
      'src/components/unidades-medida/TabelaUnidadesMedida.jsx',
    ]) {
      const src = read(table);
      expect(src).toMatch(/cellKind:\s*CADASTRO_BASE1_CELL_KIND\.ATIVO_BADGE/);
      expect(src).not.toMatch(/from "@\/components\/ui\/badge"/);
      expect(src).not.toMatch(/<Badge/);
    }
  });
});
