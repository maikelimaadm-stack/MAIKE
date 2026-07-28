import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanup, writeFile, runGate } from './helpers.mjs';

const GATE = 'gate-package-sync.mjs';

const PKG = {
  name: 'projeto-teste',
  version: '1.2.3',
  dependencies: { react: '^18.2.0' },
  devDependencies: { vite: '^6.1.0' },
};

const LOCK = {
  name: 'projeto-teste',
  version: '1.2.3',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'projeto-teste',
      version: '1.2.3',
      dependencies: { react: '^18.2.0' },
      devDependencies: { vite: '^6.1.0' },
    },
  },
};

const makeProject = (pkgOverrides = {}, lockOverrides = {}) => {
  const dir = makeTempDir('maike-pkgsync-');
  writeFile(dir, 'package.json', { ...structuredClone(PKG), ...pkgOverrides });
  const lock = structuredClone(LOCK);
  Object.assign(lock, lockOverrides);
  writeFile(dir, 'package-lock.json', lock);
  return dir;
};

const run = (dir) => runGate(GATE, { cwd: dir });

describe('gate:package-sync', () => {
  test('projeto sincronizado passa', () => {
    const d = makeProject();
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('name divergente reprova — o drift real encontrado na auditoria', () => {
    const d = makeProject({}, { name: 'base44-app' });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-PACKAGE-DRIFT/);
    assert.match(r.output, /name divergente/);
    cleanup(d);
  });

  test('name divergente na raiz do lock reprova', () => {
    const lock = structuredClone(LOCK);
    lock.packages[''].name = 'outro-nome';
    const d = makeProject({}, lock);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /name divergente na raiz do lock/);
    cleanup(d);
  });

  test('version divergente reprova', () => {
    const d = makeProject({ version: '9.9.9' });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /version divergente/);
    cleanup(d);
  });

  test('dependência só no package.json reprova', () => {
    const d = makeProject({ dependencies: { react: '^18.2.0', zod: '^3.24.2' } });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /"zod" está no package\.json mas não no lock/);
    cleanup(d);
  });

  test('dependência só no lock reprova', () => {
    const lock = structuredClone(LOCK);
    lock.packages[''].dependencies.lodash = '^4.17.21';
    const d = makeProject({}, lock);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /"lodash" está no lock mas não no package\.json/);
    cleanup(d);
  });

  test('faixa de versão divergente reprova', () => {
    const lock = structuredClone(LOCK);
    lock.packages[''].dependencies.react = '^17.0.0';
    const d = makeProject({}, lock);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /faixa divergente para "react"/);
    cleanup(d);
  });

  test('devDependency divergente reprova', () => {
    const lock = structuredClone(LOCK);
    delete lock.packages[''].devDependencies.vite;
    const d = makeProject({}, lock);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /devDependencies: "vite" está no package\.json mas não no lock/);
    cleanup(d);
  });

  test('lockfileVersion não suportada reprova', () => {
    const d = makeProject({}, { lockfileVersion: 1 });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-LOCKFILE-INVALID/);
    assert.match(r.output, /lockfileVersion não suportada/);
    cleanup(d);
  });

  test('lock ausente reprova', () => {
    const dir = makeTempDir('maike-pkgsync-');
    writeFile(dir, 'package.json', PKG);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-LOCKFILE-INVALID/);
    cleanup(dir);
  });

  test('lock malformado reprova', () => {
    const d = makeProject();
    writeFile(d, 'package-lock.json', '{ quebrado');
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /JSON inválido/);
    cleanup(d);
  });
});
