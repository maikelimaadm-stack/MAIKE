/**
 * Fronteira nativa do manejo (P1.3).
 *
 * Duas coisas são provadas aqui e em nenhum outro lugar: que os arquivos-alvo
 * saíram da fronteira legada, e que os caminhos que a slice fechou **reprovam**
 * se voltarem. As provas negativas são fixtures analisadas pelo mesmo módulo
 * que o gate usa — não mutações manuais no repositório.
 */

import { describe, it, expect, vi } from 'vitest';

// O registry é lido do módulo real; o SDK por trás não pode tentar rede.
vi.mock('@/api/base44Client', async () => {
  const { createBase44Stub } = await import('./base44Stub.js');
  return { base44: createBase44Stub() };
});
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8');
/** Sem comentários: texto explicativo cita formas proibidas de propósito. */
const codigoDe = (rel) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const arquivosDe = (dir) =>
  readdirSync(join(RAIZ, dir))
    .filter((f) => f.endsWith('.jsx') || f.endsWith('.js'))
    .map((f) => `${dir}/${f}`);

const PAGINAS = [
  'src/pages/CadastroLotes.jsx',
  'src/pages/CadastroSetores.jsx',
  'src/pages/Categorias.jsx',
  'src/pages/CategoriasManejo.jsx',
  'src/pages/Bebedouros.jsx',
];

describe('A1–A7 — os alvos saíram da fronteira legada', () => {
  it.each(PAGINAS)('A1 — %s não fala Base44', (rel) => {
    expect(codigoDe(rel)).not.toContain('base44');
  });

  it('A2 — nenhum componente de lotes fala Base44', () => {
    const infratores = arquivosDe('src/components/lotes').filter((rel) => codigoDe(rel).includes('base44'));
    expect(infratores).toEqual([]);
  });

  it('A3 — nenhum componente de bebedouros fala Base44', () => {
    const infratores = arquivosDe('src/components/bebedouros').filter((rel) => codigoDe(rel).includes('base44'));
    expect(infratores).toEqual([]);
  });

  it('A4 — RegistroAnexosDialog não fala Base44 nem integrations', () => {
    const fonte = codigoDe('src/components/common/RegistroAnexosDialog.jsx');
    expect(fonte).not.toContain('base44');
    expect(fonte).not.toContain('integrations');
  });

  it('A5/A6 — os repositórios legados não existem mais', () => {
    expect(existsSync(join(RAIZ, 'src/core/repositories/loteRepository.js'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/repositories/bebedouroRepository.js'))).toBe(false);
  });

  it('A7 — nenhum import remanescente dos repositórios, nem shim com o nome antigo', () => {
    const fontes = ['src/pages', 'src/components/lotes', 'src/components/bebedouros', 'src/components/mapa', 'src/hooks', 'src/services']
      .flatMap((dir) => arquivosDe(dir));
    const infratores = fontes.filter((rel) =>
      /from ["'][^"']*(loteRepository|bebedouroRepository)["']/.test(codigoDe(rel))
    );
    expect(infratores).toEqual([]);
  });
});

describe('A8–A15 — a cadeia de camadas', () => {
  const UI = ['src/pages', 'src/components/lotes', 'src/components/bebedouros', 'src/components/common', 'src/hooks'];

  it('A8 — a UI não importa API de dados; só o contrato de erro', () => {
    const infratores = UI.flatMap(arquivosDe).filter((rel) => {
      const fonte = codigoDe(rel);
      // `_core/ApiError` é o contrato público de erro, não uma API de dados.
      return /@\/apis\/(?!_core\/)/.test(fonte);
    });
    expect(infratores).toEqual([]);
  });

  it('A9 — services importam superfície pública, nunca arquivo interno de módulo', () => {
    const services = arquivosDe('src/services');
    const infratores = services.filter((rel) => /@\/apis\/[a-z-]+\/[A-Za-z]/.test(codigoDe(rel)));
    expect(infratores).toEqual([]);
  });

  it('A10 — nenhum service importa o provider', () => {
    const infratores = arquivosDe('src/services').filter((rel) => codigoDe(rel).includes('_providers'));
    expect(infratores).toEqual([]);
  });

  it('A10b — só arquivos de src/apis/<modulo>/ importam o provider', () => {
    const modulos = readdirSync(join(RAIZ, 'src/apis')).filter((d) => !d.startsWith('_'));
    const arquivos = modulos.flatMap((m) => arquivosDe(`src/apis/${m}`));
    expect(arquivos.length).toBeGreaterThan(10);
    const semProvider = arquivos.filter((rel) => rel.endsWith('/index.js') && codigoDe(rel).includes('_providers'));
    expect(semProvider).toEqual([]);
  });

  it('A12 — nenhuma entidade dinâmica dentro de src/apis/', () => {
    const arquivos = readdirSync(join(RAIZ, 'src/apis'), { recursive: true })
      .filter((f) => typeof f === 'string' && f.endsWith('.js'))
      .map((f) => `src/apis/${f}`);
    const infratores = arquivos.filter((rel) => /entities\s*\[/.test(codigoDe(rel)));
    expect(infratores).toEqual([]);
  });

  it('A13 — nenhuma função Base44 de nome aberto na superfície pública', () => {
    const modulos = readdirSync(join(RAIZ, 'src/apis')).filter((d) => !d.startsWith('_'));
    const publicos = modulos.map((m) => `src/apis/${m}/index.js`).filter((rel) => existsSync(join(RAIZ, rel)));
    for (const rel of publicos) {
      expect(codigoDe(rel)).not.toMatch(/invoke|functionName/);
    }
    // O nome da function fica literal no provider, não vem do chamador.
    expect(codigoDe('src/apis/_providers/base44Provider.js')).toContain("invoke('syncEntityReferences'");
  });

  it('A14 — nenhum provider é exportado por superfície pública', () => {
    const modulos = readdirSync(join(RAIZ, 'src/apis')).filter((d) => !d.startsWith('_'));
    for (const modulo of modulos) {
      const rel = `src/apis/${modulo}/index.js`;
      if (!existsSync(join(RAIZ, rel))) continue;
      expect(codigoDe(rel)).not.toMatch(/Provider\b/);
    }
  });

  it('A15 — nenhuma decisão por texto de erro nos alvos', () => {
    const alvos = [...PAGINAS, ...arquivosDe('src/components/lotes'), ...arquivosDe('src/components/bebedouros')];
    const infratores = alvos.filter((rel) => {
      const fonte = codigoDe(rel);
      return /message\s*\|\|\s*["']/.test(fonte) && !fonte.includes('getApiErrorMessage')
        || /\.message\s*\)?\.(toLowerCase\(\))?\.?includes\(/.test(fonte);
    });
    expect(infratores).toEqual([]);
  });
});

describe('A11 — registry do provider é literal e exato', () => {
  const ESPERADO = [
    'AplicacaoMedicamento', 'AreaPastagem', 'Bebedouro', 'BebedouroAlerta', 'BebedouroHistorico',
    'BebedouroSanidade', 'Categoria', 'CategoriaManejo', 'ConfiguracaoIcone', 'Empresa',
    'EstoqueLoteNota', 'EventoSanitario', 'Fornecedor', 'GrupoAtividade', 'HistoricoLancamentoTarefa',
    'LancamentoTarefa', 'LayoutCampo', 'LayoutConfiguracao', 'LayoutSecao', 'LinhaGeografica',
    'LocalEstoque', 'Lote', 'ManejoTecnicoRebanho', 'MovimentacaoEstoque', 'MovimentacaoMapa',
    'MovimentacaoPecuaria', 'Permissao', 'PontoReferencia', 'PontoSuplementacao', 'Produto',
    'RegistroAnexo', 'Setor', 'SuplementacaoEvento', 'SuplementacaoLote', 'TipoTarefa', 'User',
  ].sort();

  it('o conjunto é exatamente o esperado — igualdade, não inclusão', async () => {
    const { getRegisteredEntityNames } = await import('@/apis/_providers/base44Provider');
    expect(getRegisteredEntityNames().slice().sort()).toEqual(ESPERADO);
  });

  it('cada entrada é literal: nenhum acesso computado no registry', () => {
    const fonte = codigoDe('src/apis/_providers/base44Provider.js');
    const registry = fonte.slice(fonte.indexOf('ENTITY_REGISTRY'), fonte.indexOf('getRegisteredEntityNames'));
    expect(registry).not.toMatch(/entities\s*\[/);
    for (const nome of ESPERADO) {
      expect(registry).toContain(`${nome}: base44.entities.${nome}`);
    }
  });
});
