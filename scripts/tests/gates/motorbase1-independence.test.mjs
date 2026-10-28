import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyImport,
  classifyImportInFile,
  scanMotorBase1Independence,
  SCAN_ROOTS,
} from '../../gates/lib/motorbase1-independence.mjs';
import { join } from 'node:path';
import { makeTempDir, writeFile, cleanup, runGate } from './helpers.mjs';

describe('gate:motorbase1-independence', () => {
  it('classifica imports de domínio como proibidos', () => {
    assert.equal(classifyImport('@/components/mapa/Foo'), 'forbidden-domain-component');
    assert.equal(classifyImport('@/components/marcas/Bar'), 'forbidden-domain-component');
    assert.equal(classifyImport('@/components/cadastro/base1/X'), 'allowed');
    assert.equal(classifyImport('@/lib/utils'), 'allowed');
    assert.equal(classifyImport('react'), 'external');
  });

  it('RED: import relativo ../../marcas falha o gate', () => {
    const dir = makeTempDir('motorbase1-rel-red-');
    writeFile(
      dir,
      'src/components/cadastro/base1/EvilRelative.jsx',
      `import X from '../../marcas/TabelaMarcas';\nexport default X;\n`,
    );
    writeFile(dir, 'scripts/gates/gate-motorbase1-independence.mjs', '');
    const importer = join(dir, 'src/components/cadastro/base1/EvilRelative.jsx');
    assert.equal(
      classifyImportInFile('../../marcas/TabelaMarcas', importer, dir),
      'forbidden-domain-component',
    );
    const { violations } = scanMotorBase1Independence({ repoRoot: dir, roots: SCAN_ROOTS });
    cleanup(dir);
    assert.ok(violations.some((v) => v.spec.includes('../../marcas')));
  });

  it('RED: fixture com import de Mapa falha o gate', () => {
    const dir = makeTempDir('motorbase1-red-');
    writeFile(
      dir,
      'src/components/cadastro/base1/Evil.jsx',
      `import X from '@/components/mapa/ConfiguracaoColunasMapaDialog';\nexport default X;\n`,
    );
    writeFile(dir, 'scripts/gates/gate-motorbase1-independence.mjs', '');
    const { violations } = scanMotorBase1Independence({ repoRoot: dir, roots: SCAN_ROOTS });
    cleanup(dir);
    assert.ok(violations.some((v) => v.spec.includes('components/mapa')));
  });

  it('GREEN: repositório real passa', () => {
    const { violations } = scanMotorBase1Independence();
    assert.equal(violations.length, 0);
  });

  it('executável gate-motorbase1-independence.mjs exit 0 no repo', () => {
    const r = runGate('gate-motorbase1-independence.mjs');
    assert.equal(r.status, 0, r.output);
  });
});
