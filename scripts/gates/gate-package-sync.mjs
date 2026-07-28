#!/usr/bin/env node
/**
 * Gate: sincronia entre `package.json` e `package-lock.json`.
 *
 * O drift encontrado na auditoria (package name `maike-mapa-manejo` contra lock
 * name `base44-app`) passou despercebido porque nada verificava isso.
 *
 * Códigos: P01-PACKAGE-DRIFT · P01-LOCKFILE-INVALID
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.PACKAGE_SYNC_ROOT || process.cwd();
const PKG = join(ROOT, 'package.json');
const LOCK = join(ROOT, 'package-lock.json');
const SUPPORTED_LOCKFILE_VERSIONS = [2, 3];

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push(`[${codigo}] ${mensagem}`);

const lerJson = (path, codigo) => {
  if (!existsSync(path)) {
    registrar(codigo, `arquivo ausente: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    registrar(codigo, `JSON inválido em ${path}: ${error.message}`);
    return null;
  }
};

const pkg = lerJson(PKG, 'P01-PACKAGE-DRIFT');
const lock = lerJson(LOCK, 'P01-LOCKFILE-INVALID');

if (pkg && lock) {
  if (!SUPPORTED_LOCKFILE_VERSIONS.includes(lock.lockfileVersion)) {
    registrar(
      'P01-LOCKFILE-INVALID',
      `lockfileVersion não suportada: ${JSON.stringify(lock.lockfileVersion)} (esperado ${SUPPORTED_LOCKFILE_VERSIONS.join(' ou ')})`
    );
  }

  const rootEntry = lock.packages?.[''];
  if (!rootEntry) {
    registrar('P01-LOCKFILE-INVALID', 'lockfile sem entrada raiz packages[""]');
  }

  if (lock.name !== pkg.name) {
    registrar('P01-PACKAGE-DRIFT', `name divergente: package.json="${pkg.name}" lock="${lock.name}"`);
  }
  if (rootEntry && rootEntry.name !== pkg.name) {
    registrar('P01-PACKAGE-DRIFT', `name divergente na raiz do lock: package.json="${pkg.name}" lock.packages[""]="${rootEntry.name}"`);
  }
  if (lock.version !== pkg.version) {
    registrar('P01-PACKAGE-DRIFT', `version divergente: package.json="${pkg.version}" lock="${lock.version}"`);
  }
  if (rootEntry && rootEntry.version !== pkg.version) {
    registrar('P01-PACKAGE-DRIFT', `version divergente na raiz do lock: package.json="${pkg.version}" lock.packages[""]="${rootEntry.version}"`);
  }

  const comparar = (campo) => {
    const doPkg = pkg[campo] || {};
    const doLock = (rootEntry && rootEntry[campo]) || {};

    for (const [nome, faixa] of Object.entries(doPkg)) {
      if (!(nome in doLock)) {
        registrar('P01-PACKAGE-DRIFT', `${campo}: "${nome}" está no package.json mas não no lock`);
      } else if (doLock[nome] !== faixa) {
        registrar('P01-PACKAGE-DRIFT', `${campo}: faixa divergente para "${nome}": package="${faixa}" lock="${doLock[nome]}"`);
      }
    }
    for (const nome of Object.keys(doLock)) {
      if (!(nome in doPkg)) {
        registrar('P01-PACKAGE-DRIFT', `${campo}: "${nome}" está no lock mas não no package.json`);
      }
    }
  };

  comparar('dependencies');
  comparar('devDependencies');
}

if (falhas.length) {
  console.error('gate:package-sync — FALHOU\n');
  falhas.forEach((f) => console.error(`  - ${f}`));
  console.error('\nRode `npm install` para reconciliar o lockfile.');
  process.exit(1);
}

const diretas = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
console.log(`gate:package-sync — PASSOU (${pkg.name}@${pkg.version}, ${diretas} dependência(s) direta(s), lockfileVersion ${lock.lockfileVersion})`);
