/**
 * Testes do `gate:tenancy`.
 *
 * Cada caso monta um schema Prisma (e, quando a invariante é de código, um
 * backend sintético) num diretório temporário e roda o **gate real**. Nenhuma
 * reimplementação da lógica, nenhum mock.
 *
 * A regra que governa este arquivo vem da auditoria P2-R1: uma invariante não
 * está protegida porque o schema correto passa — ela está protegida quando o
 * schema **mutilado reprova** com o código certo. Por isso quase todo caso aqui
 * é negativo, e as cinco fontes proibidas de tenant têm cinco fixtures
 * independentes em vez de uma que testa três e conclui pelas outras duas.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const GATE = 'gate-tenancy.mjs';
const SCHEMA = 'backend/prisma/schema.prisma';
const CONTRATO = 'config/modelobase1-pecuario.json';

const schemaReal = () => readFileSync(join(REPO_ROOT, SCHEMA), 'utf8');
const contratoReal = () => readFileSync(join(REPO_ROOT, CONTRATO), 'utf8');

/** Backend sintético mínimo — o gate exige ao menos um arquivo executável. */
const BACKEND_LIMPO = `
import { exigirAuthContext } from '../shared/auth/authContext.js';

export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto.auth);
  return { cliente_id: auth.clienteId };
};
`;

/**
 * Monta um projeto temporário e roda o gate.
 * @param {{schema?: string, backend?: Record<string,string>}} projeto
 */
const rodar = ({ schema, backend } = {}) => {
  const dir = makeTempDir('maike-ten-');
  try {
    writeFile(dir, CONTRATO, contratoReal());
    writeFile(dir, SCHEMA, schema === undefined ? schemaReal() : schema);

    const arquivos = backend || { 'backend/src/modules/exemplo/exemploService.js': BACKEND_LIMPO };
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      writeFile(dir, caminho, conteudo);
    }

    return { ...runGate(GATE, { cwd: dir }), dir, lerSchema: () => readFileSync(join(dir, SCHEMA), 'utf8') };
  } finally {
    cleanup(dir);
  }
};

/** Roda mantendo o diretório vivo, para inspecionar o arquivo depois. */
const rodarEInspecionar = ({ schema }) => {
  const dir = makeTempDir('maike-ten-');
  try {
    writeFile(dir, CONTRATO, contratoReal());
    writeFile(dir, SCHEMA, schema);
    writeFile(dir, 'backend/src/modules/exemplo/exemploService.js', BACKEND_LIMPO);
    const antes = readFileSync(join(dir, SCHEMA), 'utf8');
    const resultado = runGate(GATE, { cwd: dir });
    const depois = readFileSync(join(dir, SCHEMA), 'utf8');
    return { ...resultado, antes, depois };
  } finally {
    cleanup(dir);
  }
};

/** Substitui texto no schema real, falhando alto se o alvo não existir. */
const mutarSchema = (de, para) => {
  const fonte = schemaReal();
  if (!fonte.includes(de)) {
    throw new Error(`fixture inválida: o schema real não contém ${JSON.stringify(de)}`);
  }
  return fonte.replace(de, para);
};

describe('gate:tenancy — schema e backend', () => {
  // -------------------------------------------------------------------------
  // Controles positivos
  // -------------------------------------------------------------------------

  test('TEN-01 schema real do repositório passa', () => {
    const r = runGate(GATE, { cwd: REPO_ROOT });
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /gate:tenancy — PASSOU/);
    assert.match(r.output, /raiz "Cliente"/);
  });

  test('TEN-02 schema válido em diretório temporário passa', () => {
    const r = rodar();
    assert.equal(r.status, 0, r.output);
  });

  test('TEN-03 schema ausente reprova', () => {
    const dir = makeTempDir('maike-ten-');
    try {
      writeFile(dir, CONTRATO, contratoReal());
      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.match(r.output, /P3-TEN-SCHEMA-MISSING/);
    } finally {
      cleanup(dir);
    }
  });

  // -------------------------------------------------------------------------
  // Raiz e exceções — P3-TEN-ROOT-CONTRACT
  // -------------------------------------------------------------------------

  test('TEN-04 Usuario sem cliente_id reprova', () => {
    const r = rodar({
      schema: mutarSchema('  cliente_id String   @db.VarChar(64)\n  nome       String', '  nome       String'),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-ROOT-CONTRACT/);
    assert.match(r.output, /Usuario/);
  });

  test('TEN-05 segundo model sem cliente_id reprova como exceção não autorizada', () => {
    const r = rodar({
      schema: `${schemaReal()}

model CatalogoGlobal {
  id        String   @id @default(cuid())
  nome      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-ROOT-CONTRACT/);
    assert.match(r.output, /CatalogoGlobal/);
    assert.match(r.output, /Única exceção permitida: Cliente/);
  });

  test('TEN-06 cliente_id autorreferente na raiz reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        'model Cliente {\n  id        String   @id @default(cuid())',
        'model Cliente {\n  id         String  @id @default(cuid())\n  cliente_id String  @db.VarChar(64)'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-ROOT-CONTRACT/);
    assert.match(r.output, /autorreferente/);
  });

  // -------------------------------------------------------------------------
  // Campo de tenant — P3-TEN-FIELD
  // -------------------------------------------------------------------------

  test('TEN-07 cliente_id nullable reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        'model AuditLog {\n  id               String   @id @default(cuid())\n  cliente_id       String   @db.VarChar(64)',
        'model AuditLog {\n  id               String   @id @default(cuid())\n  cliente_id       String?  @db.VarChar(64)'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-FIELD/);
    assert.match(r.output, /AuditLog\.cliente_id é opcional/);
  });

  // -------------------------------------------------------------------------
  // Relação com a raiz — P3-TEN-RELATION
  // -------------------------------------------------------------------------

  test('TEN-08 model tenant sem relação com Cliente reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        '  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)\n\n  @@unique([cliente_id, entidade, escopo_tipo, escopo_id])',
        '  @@unique([cliente_id, entidade, escopo_tipo, escopo_id])'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-RELATION/);
    assert.match(r.output, /EntidadeCodigoSequencia/);
  });

  // -------------------------------------------------------------------------
  // Unique de negócio — P3-TEN-BUSINESS-UNIQUE
  // -------------------------------------------------------------------------

  test('TEN-09 unique de login sem tenant reprova', () => {
    const r = rodar({
      schema: mutarSchema('@@unique([cliente_id, login])', '@@unique([login])'),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-BUSINESS-UNIQUE/);
    assert.match(r.output, /não inclui cliente_id/);
  });

  test('TEN-10 @unique isolado em model tenant-scoped reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        '  login      String   @db.VarChar(120)',
        '  login      String   @unique @db.VarChar(120)'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-BUSINESS-UNIQUE/);
    assert.match(r.output, /@unique isolado/);
  });

  // -------------------------------------------------------------------------
  // Identidade — P3-TEN-IDENTITY
  // -------------------------------------------------------------------------

  test('TEN-11 PK numérica reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        'model RegistroAnexo {\n  id            String   @id @default(cuid())',
        'model RegistroAnexo {\n  id            Int      @id @default(autoincrement())'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-IDENTITY/);
    assert.match(r.output, /deve ser String/);
  });

  test('TEN-12 UUID paralelo à chave primária reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        '  nome      String   @db.VarChar(255)\n  ativo     Boolean  @default(true)',
        '  uuid      String   @default(uuid())\n  nome      String   @db.VarChar(255)\n  ativo     Boolean  @default(true)'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-IDENTITY/);
    assert.match(r.output, /UUID paralelo/);
  });

  test('TEN-13 chave primária sem cuid() reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        'model Usuario {\n  id         String   @id @default(cuid())',
        'model Usuario {\n  id         String   @id'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-IDENTITY/);
    assert.match(r.output, /@default\(cuid\(\)\)/);
  });

  // -------------------------------------------------------------------------
  // Timestamps — P3-TEN-TIMESTAMPS
  // -------------------------------------------------------------------------

  test('TEN-14 model sem updatedAt reprova', () => {
    const r = rodar({
      schema: mutarSchema(
        '  createdAt        DateTime @default(now())\n  updatedAt        DateTime @updatedAt',
        '  createdAt        DateTime @default(now())'
      ),
    });
    assert.equal(r.status, 1);
    assert.match(r.output, /P3-TEN-TIMESTAMPS/);
    assert.match(r.output, /updatedAt/);
  });

  // -------------------------------------------------------------------------
  // Fonte do tenant — P3-TEN-SOURCE
  //
  // Cinco fixtures independentes. A auditoria P2-R1 mostrou o custo de testar
  // três e concluir pelas cinco.
  // -------------------------------------------------------------------------

  for (const fonte of ['body', 'query', 'params', 'headers', 'cookie']) {
    test(`TEN-15/${fonte} — cliente_id lido de "${fonte}" reprova`, () => {
      const r = rodar({
        backend: {
          'backend/src/modules/exemplo/exemploService.js': `
export const listar = async (request) => {
  const clienteId = request.${fonte}.cliente_id;
  return { clienteId };
};
`,
        },
      });
      assert.equal(r.status, 1, r.output);
      assert.match(r.output, /P3-TEN-SOURCE/);
      assert.match(r.output, new RegExp(`lido de "${fonte}"`));
    });

    test(`TEN-16/${fonte} — acesso por colchete a "${fonte}" também reprova`, () => {
      const r = rodar({
        backend: {
          'backend/src/modules/exemplo/exemploService.js': `
export const listar = async (request) => {
  const clienteId = request.${fonte}['cliente_id'];
  return { clienteId };
};
`,
        },
      });
      assert.equal(r.status, 1, r.output);
      assert.match(r.output, /P3-TEN-SOURCE/);
    });
  }

  test('TEN-17 desestruturação de cliente_id a partir do body reprova', () => {
    const r = rodar({
      backend: {
        'backend/src/modules/exemplo/exemploService.js': `
export const listar = async (request) => {
  const { cliente_id } = request.body;
  return { cliente_id };
};
`,
      },
    });
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /P3-TEN-SOURCE/);
  });

  test('TEN-18 controle positivo: outro campo vindo do body NÃO reprova', () => {
    const r = rodar({
      backend: {
        'backend/src/modules/exemplo/exemploService.js': `
export const criar = async (request) => {
  const nome = request.body.nome;      // dado de entrada legítimo
  const login = request.body.login;    // idem
  return { nome, login };
};
`,
      },
    });
    assert.equal(r.status, 0, r.output);
  });

  // -------------------------------------------------------------------------
  // Base44 — P3-TEN-BASE44
  // -------------------------------------------------------------------------

  test('TEN-19 import de @base44/sdk no backend reprova', () => {
    const r = rodar({
      backend: {
        'backend/src/modules/exemplo/exemploService.js':
          "import { createClient } from '@base44/sdk';\nexport const c = createClient({});\n",
      },
    });
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /P3-TEN-BASE44/);
  });

  test('TEN-20 require e import dinâmico de Base44 também reprovam', () => {
    for (const forma of [
      "const sdk = require('@base44/sdk');",
      "const sdk = await import('@base44/sdk');",
      "import { base44Client } from './base44Client.js';",
    ]) {
      const r = rodar({
        backend: { 'backend/src/modules/exemplo/exemploService.js': `${forma}\nexport const x = 1;\n` },
      });
      assert.equal(r.status, 1, `forma não reprovou: ${forma}\n${r.output}`);
      assert.match(r.output, /P3-TEN-BASE44/);
    }
  });

  // -------------------------------------------------------------------------
  // O gate não escreve
  // -------------------------------------------------------------------------

  test('TEN-21 gate não reescreve schema inválido', () => {
    const invalido = mutarSchema('@@unique([cliente_id, login])', '@@unique([login])');
    const r = rodarEInspecionar({ schema: invalido });
    assert.equal(r.status, 1);
    assert.equal(r.depois, r.antes, 'o gate não pode reescrever o schema');
    assert.equal(r.depois, invalido, 'o conteúdo precisa continuar byte a byte igual');
    assert.match(r.output, /não existe --update, baseline nem correção automática/);
  });

  test('TEN-22 gate não aceita flag de correção', () => {
    const dir = makeTempDir('maike-ten-');
    try {
      const invalido = mutarSchema('@@unique([cliente_id, login])', '@@unique([login])');
      writeFile(dir, CONTRATO, contratoReal());
      writeFile(dir, SCHEMA, invalido);
      writeFile(dir, 'backend/src/modules/exemplo/exemploService.js', BACKEND_LIMPO);

      const r = runGate(GATE, { cwd: dir, args: ['--update'] });
      assert.equal(r.status, 1);
      assert.equal(readFileSync(join(dir, SCHEMA), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });
});
