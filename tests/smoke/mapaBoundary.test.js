/**
 * Testes de arquitetura da fronteira do Mapa (P1.2).
 *
 * Verificação **mecânica** sobre os arquivos reais: não basta o gate passar
 * hoje, o contrato precisa estar afirmado em teste.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { scanBoundary, moduleOf } from '../../scripts/gates/lib/api-boundary.mjs';
import { getRegisteredEntityNames } from '@/apis/_providers/base44Provider';

const RAIZ = process.cwd();
const ler = (rel) => readFileSync(join(RAIZ, rel), 'utf8');

/**
 * Fonte sem comentários.
 *
 * As asserções abaixo falam sobre **código**. Um comentário que cita
 * `localStorage` para explicar que a API não o usa não pode reprovar o teste —
 * seria o próprio texto explicativo virando falso positivo.
 */
const codigoDe = (rel) =>
  ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const arquivosDe = (dir) =>
  readdirSync(join(RAIZ, dir)).filter((f) => f.endsWith('.jsx') || f.endsWith('.js')).map((f) => `${dir}/${f}`);

const retrato = scanBoundary(RAIZ);
const emAlgumEixo = (rel) => Object.values(retrato.listas).some((lista) => lista.includes(rel));

describe('P1.2 — a UI do mapa não fala Base44', () => {
  it('B1 — MapaGeral não importa o client legado', () => {
    expect(codigoDe('src/pages/MapaGeral.jsx')).not.toContain('base44');
    expect(emAlgumEixo('src/pages/MapaGeral.jsx')).toBe(false);
  });

  it('B2 — MapaCadastro não importa o client legado', () => {
    expect(codigoDe('src/pages/MapaCadastro.jsx')).not.toContain('base44');
    expect(emAlgumEixo('src/pages/MapaCadastro.jsx')).toBe(false);
  });

  it('B3 — DetalhesLote não importa o client legado', () => {
    expect(codigoDe('src/components/mapa/DetalhesLote.jsx')).not.toContain('base44');
    expect(emAlgumEixo('src/components/mapa/DetalhesLote.jsx')).toBe(false);
  });

  it('B4/B5 — nenhum arquivo de src/components/mapa/ está em qualquer eixo', () => {
    const presentes = Object.entries(retrato.listas).flatMap(([eixo, lista]) =>
      lista.filter((p) => p.startsWith('src/components/mapa/')).map((p) => `${eixo}: ${p}`)
    );
    expect(presentes).toEqual([]);
  });

  it('B6 — o armazenamento offline não conhece provider nem API', () => {
    const storage = codigoDe('src/components/offline/IndexedDBManager.jsx');
    expect(storage).not.toContain('base44');
    expect(storage).not.toContain('@/apis/');
  });

  it('B7 — useSetorAreas não toca o provider', () => {
    expect(codigoDe('src/hooks/useSetorAreas.js')).not.toContain('base44');
    expect(emAlgumEixo('src/hooks/useSetorAreas.js')).toBe(false);
  });

  it('B8 — a UI do mapa importa service, nunca API de módulo', () => {
    const arquivos = [...arquivosDe('src/components/mapa'), 'src/pages/MapaGeral.jsx', 'src/pages/MapaCadastro.jsx'];
    const infratores = arquivos.filter((rel) => /from ["']@\/apis\/(?!_core)/.test(ler(rel)));
    expect(infratores).toEqual([]);
  });

  it('B9 — services importam superfície pública, nunca arquivo interno de módulo', () => {
    const services = arquivosDe('src/services');
    const infratores = services.filter((rel) => /@\/apis\/[a-z]+\/[A-Za-z]/.test(codigoDe(rel)));
    expect(infratores).toEqual([]);
  });

  it('B10 — APIs não importam UI, cache, browser storage nem React', () => {
    const apis = ['mapa', 'lotes', 'estoque', 'tarefas', 'session', 'rebanho', 'arquivos'].flatMap((m) =>
      arquivosDe(`src/apis/${m}`)
    );
    for (const rel of apis) {
      const fonte = codigoDe(rel);
      expect(fonte, rel).not.toMatch(/from ["']react/);
      expect(fonte, rel).not.toMatch(/@tanstack\/react-query/);
      expect(fonte, rel).not.toMatch(/localStorage|indexedDB|sessionStorage/);
      expect(fonte, rel).not.toMatch(/@\/components\//);
      expect(fonte, rel).not.toMatch(/@\/services\//);
      expect(fonte, rel).not.toContain('sonner');
    }
  });

  /**
   * O registry cresce a cada slice; a igualdade **exata** do conjunto vive em
   * `manejoBoundary.test.js` (A11), num lugar só. Aqui o que importa é que
   * nenhuma entidade da P1.2 tenha sido perdida — duas asserções de igualdade
   * exata em arquivos diferentes só criariam trabalho de sincronização.
   */
  it('B11 — as entidades da P1.2 continuam registradas', () => {
    expect([...getRegisteredEntityNames()].sort()).toEqual(expect.arrayContaining([
      'AplicacaoMedicamento', 'AreaPastagem', 'Bebedouro', 'ConfiguracaoIcone', 'Empresa',
      'EstoqueLoteNota', 'EventoSanitario', 'GrupoAtividade', 'HistoricoLancamentoTarefa',
      'LancamentoTarefa', 'LinhaGeografica', 'LocalEstoque', 'Lote', 'ManejoTecnicoRebanho',
      'MovimentacaoEstoque', 'MovimentacaoMapa', 'MovimentacaoPecuaria', 'Permissao',
      'PontoReferencia', 'PontoSuplementacao', 'Produto', 'Setor', 'SuplementacaoEvento',
      'SuplementacaoLote', 'TipoTarefa', 'User',
    ]));
  });

  it('B12 — nenhuma entidade dinâmica dentro de src/apis/', () => {
    expect(retrato.dynamicEntityNaFronteira).toEqual([]);
  });

  it('B13 — nenhum provider é exportado por módulo público', () => {
    expect(retrato.publicProviderLeaks).toEqual([]);
    expect(retrato.providerLeaks).toEqual([]);
    expect(retrato.layerBypasses).toEqual([]);
    expect(retrato.serviceBypasses).toEqual([]);
    expect(retrato.moduleInternalBypasses).toEqual([]);
  });

  it('B14/B15 — a UI do mapa não decide por substring de error.message', () => {
    const arquivos = [...arquivosDe('src/components/mapa'), 'src/pages/MapaGeral.jsx', 'src/pages/MapaCadastro.jsx'];
    const infratores = arquivos.filter((rel) => {
      const fonte = codigoDe(rel);
      return /error\??\.message\s*\|\|\s*["']/.test(fonte) && /includes\(/.test(fonte) === false
        ? false
        : /String\(\s*error\??\.message[^)]*\)\s*\.?\s*(toLowerCase\(\))?\s*\.includes\(/.test(fonte);
    });
    expect(infratores).toEqual([]);
  });

  it('o módulo de dados de cada API é derivado do caminho, sem citar "empresa"', () => {
    expect(moduleOf('src/apis/mapa/mapaApi.js')).toBe('mapa');
    expect(moduleOf('src/apis/lotes/lotesApi.js')).toBe('lotes');
    expect(moduleOf('src/apis/_providers/base44Provider.js')).toBeNull();
  });
});
