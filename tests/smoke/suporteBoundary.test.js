/**
 * Fronteira nativa de suporte e administração (P1.4).
 *
 * Duas coisas são provadas aqui: que os 23 caminhos do inventário saíram da
 * fronteira legada, e que o desenho que a P1.4 fecha — monkey patch global,
 * arquivo `Utils` fazendo I/O, guard acoplado ao SDK — não pode voltar sem
 * quebrar um teste.
 *
 * O cliente Base44 é substituído globalmente em `tests/smoke/setup.js`, antes
 * da avaliação dos módulos. Não há mock local aqui de propósito.
 */

import { describe, it, expect } from 'vitest';
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

/** Os 23 caminhos do inventário da missão. */
const INVENTARIO = [
  'src/Layout.jsx',
  'src/lib/AuthContext.jsx',
  'src/lib/PageNotFound.jsx',
  'src/pages/ConfiguracoesGerais.jsx',
  'src/components/configuracoes/GerenciadorIcones.jsx',
  'src/components/empresa/FormularioEmpresa.jsx',
  'src/pages/Produtos.jsx',
  'src/components/produtos/FormularioProduto.jsx',
  'src/components/produtos/FichaProduto.jsx',
  'src/pages/Marcas.jsx',
  'src/pages/UnidadesMedida.jsx',
  'src/pages/LocaisEstoque.jsx',
  'src/pages/GruposAtividades.jsx',
  'src/pages/TiposTarefa.jsx',
  'src/pages/Usuarios.jsx',
  'src/components/suplementacao/FormularioLancamentoSuplementacao.jsx',
  'src/components/suplementacao/HistoricoDepositoSuplementacao.jsx',
  'src/components/suplementacao/HistoricoSuplementacaoLote.jsx',
  'src/components/suplementacao/HistoricoSuplementacaoPonto.jsx',
  'src/components/suplementacao/ResumoSuplementacao.jsx',
  'src/components/suplementacao/estoqueSuplementacaoUtils.jsx',
  'src/components/utils/consumoUtils.jsx',
];

describe('B1–B6 — os 23 caminhos saíram da fronteira legada', () => {
  it.each(INVENTARIO)('B1 — %s não fala Base44', (rel) => {
    expect(codigoDe(rel)).not.toContain('base44');
  });

  it('B2 — o 23º caminho, historicoSuplementacaoUtils, virou service', () => {
    expect(existsSync(join(RAIZ, 'src/components/suplementacao/historicoSuplementacaoUtils.jsx'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/services/suplementacaoHistoricoService.js'))).toBe(true);
  });

  it('B3 — os acessos indiretos foram removidos', () => {
    expect(existsSync(join(RAIZ, 'src/lib/entityDeleteGuards.js'))).toBe(false);
    expect(existsSync(join(RAIZ, 'src/lib/offlineEntitySync.js'))).toBe(false);
  });

  it('B4 — nenhum arquivo de src/ fala com o client, fora do provider', () => {
    const dirs = [
      'src/pages', 'src/services', 'src/lib', 'src/domain',
      'src/components/lotes', 'src/components/mapa', 'src/components/produtos',
      'src/components/suplementacao', 'src/components/configuracoes', 'src/components/empresa',
      'src/components/common', 'src/components/usuarios', 'src/hooks',
    ].filter((d) => existsSync(join(RAIZ, d)));

    const infratores = dirs
      .flatMap(arquivosDe)
      .filter((rel) => /@\/api\/base44Client|base44\.(entities|auth|integrations|functions)/.test(codigoDe(rel)));

    expect(infratores).toEqual([]);
  });

  it('B5 — o client é o único importador do SDK e não instala nada', () => {
    const fonte = codigoDe('src/api/base44Client.js');
    expect(fonte).toContain("from '@base44/sdk'");
    expect(fonte).not.toMatch(/install[A-Z]\w*\(/);
    expect(fonte).not.toContain('applyDeleteGuards');
    expect(fonte).not.toContain('OfflineEntitySync');
    // Só uma chamada de criação; nada de monkey patch depois dela.
    expect((fonte.match(/createClient\(/g) || []).length).toBe(1);
  });

  it('B6 — nenhum monkey patch global sobrou no client nem nas libs', () => {
    const suspeitos = ['src/api/base44Client.js', 'src/lib/textNormalization.js', 'src/lib/offline/offlineEntityRuntime.js'];
    for (const rel of suspeitos) {
      const fonte = codigoDe(rel);
      expect(fonte, rel).not.toMatch(/entityApi\.\w+\s*=/);
      expect(fonte, rel).not.toMatch(/Object\.values\(\s*\w*[Cc]lient/);
      expect(fonte, rel).not.toMatch(/__\w+Applied|__offlinePatched|__offlineOriginals/);
    }
  });
});

describe('B7–B12 — a cadeia de camadas', () => {
  const UI = [
    'src/pages', 'src/components/lotes', 'src/components/produtos', 'src/components/suplementacao',
    'src/components/configuracoes', 'src/components/empresa', 'src/components/common',
    'src/components/usuarios', 'src/hooks',
  ].filter((d) => existsSync(join(RAIZ, d)));

  it('B7 — a UI não importa API de dados; só o contrato de erro', () => {
    const infratores = UI.flatMap(arquivosDe).filter((rel) => /@\/apis\/(?!_core\/)/.test(codigoDe(rel)));
    expect(infratores).toEqual([]);
  });

  it('B8 — nenhum service importa o provider', () => {
    const infratores = arquivosDe('src/services').filter((rel) => codigoDe(rel).includes('_providers'));
    expect(infratores).toEqual([]);
  });

  it('B9 — services importam superfície pública, nunca arquivo interno de módulo', () => {
    const infratores = arquivosDe('src/services').filter((rel) => /@\/apis\/[a-z-]+\/[A-Za-z]/.test(codigoDe(rel)));
    expect(infratores).toEqual([]);
  });

  it('B10 — nenhuma função Base44 de nome aberto na superfície pública', () => {
    const modulos = readdirSync(join(RAIZ, 'src/apis')).filter((d) => !d.startsWith('_'));
    for (const modulo of modulos) {
      const rel = `src/apis/${modulo}/index.js`;
      if (!existsSync(join(RAIZ, rel))) continue;
      expect(codigoDe(rel), rel).not.toMatch(/invoke|functionName/);
      expect(codigoDe(rel), rel).not.toMatch(/Provider\b/);
    }
  });

  it('B11 — os módulos novos da P1.4 existem com superfície pública', () => {
    for (const modulo of ['produtos', 'marcas', 'unidades-medida', 'suplementacao']) {
      expect(existsSync(join(RAIZ, `src/apis/${modulo}/index.js`)), modulo).toBe(true);
    }
  });

  it('B12 — nenhuma decisão por texto de erro nos alvos', () => {
    const infratores = INVENTARIO.filter((rel) => {
      const fonte = codigoDe(rel);
      const usaMensagemCrua = /toast\.(error|warn)\(\s*err(or)?\.message/.test(fonte);
      const decidePorTexto = /\.message\s*\)?\.?(toLowerCase\(\))?\.?includes\(/.test(fonte)
        || /error\.message\s*===/.test(fonte);
      return usaMensagemCrua || decidePorTexto;
    });
    expect(infratores).toEqual([]);
  });
});

describe('B13–B16 — arquivos `Utils` e domínio puro não fazem I/O', () => {
  const PUROS = [
    'src/components/suplementacao/estoqueSuplementacaoUtils.jsx',
    'src/components/utils/consumoUtils.jsx',
    'src/domain/deleteRules.js',
    'src/domain/numeroPtBR.js',
    'src/domain/produtos/csvProduto.js',
  ];

  it.each(PUROS)('B13 — %s não importa API, provider nem client', (rel) => {
    const fonte = codigoDe(rel);
    expect(fonte).not.toContain('@/apis/');
    expect(fonte).not.toContain('_providers');
    expect(fonte).not.toContain('base44');
  });

  it('B14 — os utilitários puros não têm função async de persistência', () => {
    const fonte = codigoDe('src/components/suplementacao/estoqueSuplementacaoUtils.jsx');
    expect(fonte).not.toMatch(/\bawait\b/);
    expect(fonte).not.toContain('registrarSaidaSuplementacao');
    expect(fonte).not.toContain('registrarTransferenciaEntreLocais');
  });

  it('B15 — consumoUtils não persiste nada', () => {
    const fonte = codigoDe('src/components/utils/consumoUtils.jsx');
    expect(fonte).not.toMatch(/\bawait\b/);
    expect(fonte).not.toContain('fecharPeriodoSupplementacao');
    expect(fonte).not.toContain('reabrirPeriodoSuplementacao');
  });

  it('B16 — o runtime offline não conhece provider, client nem endpointOf', () => {
    const fonte = codigoDe('src/lib/offline/offlineEntityRuntime.js');
    expect(fonte).not.toContain('base44');
    expect(fonte).not.toContain('_providers');
    expect(fonte).not.toContain('endpointOf');
    expect(fonte).not.toMatch(/client/i);
  });
});

describe('B17 — registry do provider é literal, exato e igual ao manifesto', () => {
  const ESPERADO = [
    'AplicacaoMedicamento', 'AreaPastagem', 'Bebedouro', 'BebedouroAlerta', 'BebedouroHistorico',
    'BebedouroSanidade', 'Categoria', 'CategoriaManejo', 'ConfiguracaoIcone', 'Empresa',
    'EstoqueLoteNota', 'EventoSanitario', 'Fornecedor', 'GrupoAtividade', 'HistoricoLancamentoTarefa',
    'LancamentoTarefa', 'LayoutCampo', 'LayoutConfiguracao', 'LayoutSecao', 'LinhaGeografica',
    'LocalEstoque', 'Lote', 'ManejoTecnicoRebanho', 'Marca', 'MovimentacaoEstoque', 'MovimentacaoMapa',
    'MovimentacaoPecuaria', 'Permissao', 'PontoReferencia', 'PontoSuplementacao', 'Produto',
    'RegistroAnexo', 'Setor', 'SuplementacaoEvento', 'SuplementacaoLote', 'TipoTarefa',
    'UnidadeMedida', 'User',
  ].sort();

  it('são 38 entidades, e são exatamente as do manifesto', async () => {
    const { getRegisteredEntityNames } = await import('@/apis/_providers/base44Provider');
    const registrados = getRegisteredEntityNames().slice().sort();
    const manifesto = JSON.parse(ler('config/mapa-manejo-scope.json')).allowedBase44Entities.slice().sort();

    expect(registrados).toEqual(ESPERADO);
    expect(registrados).toEqual(manifesto);
    expect(registrados.length).toBe(38);
  });

  it('só Marca e UnidadeMedida entraram na P1.4', () => {
    const registry = codigoDe('src/apis/_providers/base44Provider.js');
    expect(registry).toContain("Marca: comFronteira('Marca', base44.entities.Marca)");
    expect(registry).toContain("UnidadeMedida: comFronteira('UnidadeMedida', base44.entities.UnidadeMedida)");
    expect(registry).not.toMatch(/entities\s*\[/);
  });
});
