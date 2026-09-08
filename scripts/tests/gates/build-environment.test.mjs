/**
 * Ambiente do build de produção (P3-R1/B3).
 *
 * A primeira versão da P3 definiu `NODE_ENV: test` no `env:` do **job** do
 * workflow. O `env:` de job alcança todos os passos, então ele chegou ao
 * `npm run build`, e o Vite montou o bundle com React e demais bibliotecas em
 * modo de desenvolvimento: a CI mediu 3.555,01 kB onde o build de produção mede
 * 2.496,62 kB, sem uma linha de `src/` ter mudado. Em medição local reproduzível
 * a mesma troca leva 3.941 módulos a 3.958 e o JS a ~3,5–3,9 MB, e reproduz
 * igual no commit base, onde backend não existe.
 *
 * O que torna esse defeito traiçoeiro é que ele **não aparece no código**. Não
 * há import novo, não há dependência nova no bundle, e o diff de `src/` é
 * vazio. Ele só aparece em quem lê o número — e a leitura errada mais provável
 * é culpar o backend.
 *
 * Estes casos travam as duas pontas: a CI não define `NODE_ENV`, e o
 * `verify:all` fixa `production` no passo de build, de modo que a medição
 * independe do ambiente de quem executa.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers.mjs';

const ler = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** Remove comentários de linha YAML, para prosa não contar como declaração. */
const yamlSemComentarios = (texto) =>
  texto
    .split('\n')
    .map((linha) => {
      const posicao = linha.indexOf('#');
      return posicao === -1 ? linha : linha.slice(0, posicao);
    })
    .join('\n');

describe('ambiente do build de produção', () => {
  test('ENV-B1 o workflow não define NODE_ENV', () => {
    const workflow = yamlSemComentarios(ler('.github/workflows/quality.yml'));

    assert.doesNotMatch(
      workflow,
      /^\s*NODE_ENV\s*:/m,
      'NODE_ENV no workflow vaza para o npm run build e infla o bundle em ~1 MB'
    );
  });

  test('ENV-B2 o comentário que explica a proibição continua no workflow', () => {
    // Sem a explicação, a próxima pessoa reintroduz a variável achando que
    // está consertando os testes.
    const workflow = ler('.github/workflows/quality.yml');
    assert.match(workflow, /NÃO defina NODE_ENV aqui/);
  });

  test('ENV-B3 verify:all fixa NODE_ENV=production no passo de build', () => {
    const verifyAll = ler('scripts/gates/verify-all.mjs');

    assert.match(
      verifyAll,
      /\['build',\s*npm\('build',\s*\{\s*NODE_ENV:\s*'production'\s*\}\)\]/,
      'o passo de build precisa fixar NODE_ENV=production'
    );
  });

  test('ENV-B4 verify:all propaga o env declarado por etapa', () => {
    // A declaração da etapa só vale se o spawn a usar. Sem esta asserção,
    // alguém poderia declarar o env e o runner ignorá-lo em silêncio.
    const verifyAll = ler('scripts/gates/verify-all.mjs');
    assert.match(verifyAll, /env:\s*env\s*\?\s*\{\s*\.\.\.process\.env,\s*\.\.\.env\s*\}\s*:\s*process\.env/);
  });

  test('ENV-B5 nenhuma outra etapa do verify:all sobrescreve NODE_ENV', () => {
    const verifyAll = ler('scripts/gates/verify-all.mjs');
    const ocorrencias = [...verifyAll.matchAll(/NODE_ENV:\s*'([^']+)'/g)].map((m) => m[1]);

    assert.deepEqual(
      ocorrencias,
      ['production'],
      `apenas o build fixa NODE_ENV, e como production — encontrado: ${ocorrencias.join(', ')}`
    );
  });
});
