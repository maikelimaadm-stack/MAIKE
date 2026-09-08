/**
 * Testes do `gate:indices`.
 *
 * Mesma disciplina do teste de tenancy: gate real, schema temporário, mutação
 * por invariante. O que este arquivo prova, além do óbvio, é que a verificação
 * é **posicional** — `@@index([ativo, cliente_id])` tem exatamente os mesmos
 * caracteres de um índice correto e mesmo assim reprova, porque só a ordem
 * separa um índice tenant-first de um inútil.
 *
 * Há também um controle positivo que quase ninguém escreve e que aqui importa
 * muito: o model raiz PODE ter índice sem `cliente_id`. Um gate que reprovasse
 * isso estaria exigindo tenancy da própria raiz — exatamente o erro que a
 * D-PROD-22 acabou de corrigir na Constituição.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const GATE = 'gate-indices.mjs';
const SCHEMA = 'backend/prisma/schema.prisma';
const CONTRATO = 'config/modelobase1-pecuario.json';

const schemaReal = () => readFileSync(join(REPO_ROOT, SCHEMA), 'utf8');
const contratoReal = () => readFileSync(join(REPO_ROOT, CONTRATO), 'utf8');

const rodar = (schema) => {
  const dir = makeTempDir('maike-idx-');
  try {
    writeFile(dir, CONTRATO, contratoReal());
    writeFile(dir, SCHEMA, schema === undefined ? schemaReal() : schema);
    return runGate(GATE, { cwd: dir });
  } finally {
    cleanup(dir);
  }
};

const mutarSchema = (de, para) => {
  const fonte = schemaReal();
  if (!fonte.includes(de)) {
    throw new Error(`fixture inválida: o schema real não contém ${JSON.stringify(de)}`);
  }
  return fonte.replace(de, para);
};

describe('gate:indices — prefixo de tenant e unique da sequência', () => {
  // -------------------------------------------------------------------------
  // Controles positivos
  // -------------------------------------------------------------------------

  test('IDX-01 schema real do repositório passa', () => {
    const r = runGate(GATE, { cwd: REPO_ROOT });
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /gate:indices — PASSOU/);
  });

  test('IDX-02 schema ausente reprova', () => {
    const dir = makeTempDir('maike-idx-');
    try {
      writeFile(dir, CONTRATO, contratoReal());
      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.match(r.output, /P3-IDX-SCHEMA-MISSING/);
    } finally {
      cleanup(dir);
    }
  });

  test('IDX-03 raiz com índice sem cliente_id PASSA — a raiz não é tenant-scoped', () => {
    // Controle positivo do P3-IDX-06. `Cliente` tem @@index([nome]) e
    // @@index([ativo]) no schema real; o gate não pode exigir prefixo ali.
    const r = rodar();
    assert.equal(r.status, 0, r.output);
    assert.ok(schemaReal().includes('@@index([nome])'), 'a fixture depende do índice da raiz existir');
  });

  // -------------------------------------------------------------------------
  // Prefixo de tenant — P3-IDX-TENANT-PREFIX
  // -------------------------------------------------------------------------

  test('IDX-04 índice tenant-scoped sem cliente_id reprova', () => {
    const r = rodar(mutarSchema('@@index([cliente_id, ativo])', '@@index([ativo])'));
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-TENANT-PREFIX/);
    assert.match(r.output, /Usuario/);
  });

  test('IDX-05 índice com cliente_id fora da primeira posição reprova — ordem importa', () => {
    const r = rodar(mutarSchema('@@index([cliente_id, ativo])', '@@index([ativo, cliente_id])'));
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-TENANT-PREFIX/);
    assert.match(r.output, /na posição 1; ordem importa/);
  });

  test('IDX-06 formatação não muda o veredito: índice multilinha é lido igual', () => {
    const r = rodar(
      mutarSchema('@@index([cliente_id, ativo])', '@@index([\n    ativo,\n    cliente_id\n  ])')
    );
    assert.equal(r.status, 1, 'quebra de linha não pode esconder a ordem errada');
    assert.match(r.output, /P3-IDX-TENANT-PREFIX/);
  });

  // -------------------------------------------------------------------------
  // Unique de negócio — P3-IDX-BUSINESS-UNIQUE
  // -------------------------------------------------------------------------

  test('IDX-07 unique de negócio sem tenant reprova', () => {
    const r = rodar(mutarSchema('@@unique([cliente_id, login])', '@@unique([login])'));
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-BUSINESS-UNIQUE/);
    assert.match(r.output, /não inclui cliente_id/);
  });

  test('IDX-08 unique com tenant fora da primeira posição reprova', () => {
    const r = rodar(mutarSchema('@@unique([cliente_id, login])', '@@unique([login, cliente_id])'));
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-BUSINESS-UNIQUE/);
    assert.match(r.output, /deve começar por cliente_id/);
  });

  // -------------------------------------------------------------------------
  // Unique da sequência — P3-IDX-SEQUENCE-UNIQUE
  //
  // Uma prova por dimensão removida, como o brief exige.
  // -------------------------------------------------------------------------

  const UNIQUE_SEQUENCIA = '@@unique([cliente_id, entidade, escopo_tipo, escopo_id])';

  const dimensoes = [
    ['cliente_id', '@@unique([entidade, escopo_tipo, escopo_id])'],
    ['entidade', '@@unique([cliente_id, escopo_tipo, escopo_id])'],
    ['escopo_tipo', '@@unique([cliente_id, entidade, escopo_id])'],
    ['escopo_id', '@@unique([cliente_id, entidade, escopo_tipo])'],
  ];

  for (const [dimensao, mutacao] of dimensoes) {
    test(`IDX-09/${dimensao} — unique da sequência sem "${dimensao}" reprova`, () => {
      const r = rodar(mutarSchema(UNIQUE_SEQUENCIA, mutacao));
      assert.equal(r.status, 1, r.output);
      // Remover cliente_id dispara também a regra de unique de negócio; o que
      // este caso fixa é que a chave da sequência deixou de bater com o contrato.
      assert.match(r.output, /P3-IDX-SEQUENCE-UNIQUE/);
      assert.match(r.output, /deve ser exatamente \[cliente_id, entidade, escopo_tipo, escopo_id\]/);
    });
  }

  test('IDX-10 unique da sequência fora de ordem reprova', () => {
    const r = rodar(
      mutarSchema(UNIQUE_SEQUENCIA, '@@unique([cliente_id, escopo_tipo, entidade, escopo_id])')
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-SEQUENCE-UNIQUE/);
  });

  // -------------------------------------------------------------------------
  // NULL no escopo — P3-IDX-SEQUENCE-NULL-SCOPE
  //
  // A invariante mais fácil de errar do contrato inteiro, e a única cujo
  // sintoma só aparece sob concorrência.
  // -------------------------------------------------------------------------

  test('IDX-11 escopo_id nullable sob unique comum reprova', () => {
    const r = rodar(
      mutarSchema('  escopo_id     String   @db.VarChar(64)', '  escopo_id     String?  @db.VarChar(64)')
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-SEQUENCE-NULL-SCOPE/);
    assert.match(r.output, /NULL nunca é igual a NULL/);
  });

  test('IDX-12 escopo_tipo nullable sob unique comum também reprova', () => {
    const r = rodar(
      mutarSchema('  escopo_tipo   String   @db.VarChar(32)', '  escopo_tipo   String?  @db.VarChar(32)')
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-SEQUENCE-NULL-SCOPE/);
  });

  test('IDX-13 model da sequência ausente reprova', () => {
    const fonte = schemaReal();
    const inicio = fonte.indexOf('model EntidadeCodigoSequencia {');
    const fim = fonte.indexOf('\n}', inicio) + 2;
    const r = rodar(fonte.slice(0, inicio) + fonte.slice(fim));
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-IDX-SEQUENCE-UNIQUE/);
    assert.match(r.output, /não existe no schema/);
  });

  // -------------------------------------------------------------------------
  // O gate não escreve
  // -------------------------------------------------------------------------

  test('IDX-14 gate não reescreve schema inválido, nem com flag', () => {
    const dir = makeTempDir('maike-idx-');
    try {
      const invalido = mutarSchema('@@index([cliente_id, ativo])', '@@index([ativo])');
      writeFile(dir, CONTRATO, contratoReal());
      writeFile(dir, SCHEMA, invalido);

      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.equal(readFileSync(join(dir, SCHEMA), 'utf8'), invalido);
      assert.match(r.output, /não existe --update, baseline nem correção automática/);

      const comFlag = runGate(GATE, { cwd: dir, args: ['--update'] });
      assert.equal(comFlag.status, 1);
      assert.equal(readFileSync(join(dir, SCHEMA), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });
});
