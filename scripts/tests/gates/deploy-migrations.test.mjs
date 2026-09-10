/**
 * Provas do `gate:deploy-migrations` (DEPLOY-MIGRATION-01, D-PROD-28).
 *
 * A disciplina da P2-R1 governa este arquivo: uma invariante não está protegida
 * porque o código correto passa — ela está protegida quando o código
 * **mutilado reprova**, com o código de falha certo.
 *
 * Cada mutilação abaixo é uma mudança que alguém faria de boa-fé e que reabre o
 * defeito: trocar o runner pelo primitive "para simplificar", acrescentar um
 * `|| DATABASE_URL` "para não falhar em dev", mover a migration para o
 * `backend:start` "porque é onde já roda". Nenhuma delas quebra teste nenhum.
 *
 * E cada regra tem **controle positivo**: prosa citando as formas proibidas
 * precisa CONTINUAR passando. Sem isso o gate reprovaria a documentação escrita
 * para impedir o defeito — armadilha em que este projeto já caiu quatro vezes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const GATE = 'gate-deploy-migrations.mjs';

const RUNNER = 'scripts/deploy/run-migrations.mjs';
const TEST_RUNNER = 'scripts/tests/run-backend-tests.mjs';
const PACKAGE = 'package.json';
const ENV_EXAMPLE = '.env.example';
const DOC = 'docs/engineering/DEPLOY-MIGRATION-01-PRODUCTION-MIGRATION-BARRIER-REPORT.md';
const SERVER = 'backend/src/server.js';

const real = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const rodar = (dir) => runGate(GATE, { env: { DEPLOY_MIGRATIONS_ROOT: dir } });

const passa = (dir) => {
  const r = rodar(dir);
  assert.equal(r.status, 0, r.output);
};

const falhaCom = (dir, codigo) => {
  const r = rodar(dir);
  assert.equal(r.status, 1, `esperava reprovação, saiu 0:\n${r.output}`);
  assert.match(r.output, new RegExp(codigo), r.output);
};

/** `package.json` mínimo com os scripts que a barreira exige. */
const PACKAGE_OK = JSON.stringify(
  {
    name: 'fixture',
    scripts: {
      'backend:start': 'node backend/src/server.js',
      'prisma:deploy': 'prisma migrate deploy --schema backend/prisma/schema.prisma',
      'deploy:migrate': 'node scripts/deploy/run-migrations.mjs',
    },
  },
  null,
  2
);

const SERVER_OK = `
import { construirApp } from './app.js';

const iniciar = async () => {
  const app = await construirApp();
  await app.listen({ port: 3333 });
};

iniciar();
`;

const ENV_OK = 'DATABASE_URL=\nMIGRATION_DATABASE_URL=\nAUTH_SECRET=\n';

const DOC_OK = `
# DEPLOY-MIGRATION-01

Ativação: configurar \`MIGRATION_DATABASE_URL\` no serviço e apontar o
pre-deploy para \`npm run deploy:migrate\`.
`;

/**
 * Projeto válido, com sobrescritas por arquivo.
 *
 * O runner e o runner de teste são **cópias fiéis** do código real: mutilar uma
 * cópia fiel prova algo sobre o código real; mutilar um esqueleto inventado
 * prova algo sobre o esqueleto.
 *
 * @param {Record<string, string|null>} [sobrescritas] `null` remove o arquivo
 */
const projeto = (sobrescritas = {}) => {
  const dir = makeTempDir('maike-deploy-mig-');
  const arquivos = {
    [PACKAGE]: PACKAGE_OK,
    [RUNNER]: real(RUNNER),
    [TEST_RUNNER]: real(TEST_RUNNER),
    [ENV_EXAMPLE]: ENV_OK,
    [DOC]: DOC_OK,
    [SERVER]: SERVER_OK,
    'src/main.jsx': "export const app = 'frontend';\n",
    ...sobrescritas,
  };

  for (const [rel, conteudo] of Object.entries(arquivos)) {
    if (conteudo === null) continue;
    writeFile(dir, rel, conteudo);
  }
  return dir;
};

describe('gate:deploy-migrations — estado correto', () => {
  test('DGM-10 o repositório real passa', () => {
    const r = runGate(GATE);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /PASSOU/);
  });

  test('DGM-10b o projeto sintético fiel passa', () => {
    const d = projeto();
    passa(d);
    cleanup(d);
  });
});

describe('P28-DEPLOY-RUNNER', () => {
  test('DGM-06 fallback para DATABASE_URL reprova', () => {
    // A mutilação mais tentadora: "só para não falhar em dev".
    const mutado = real(RUNNER).replace(
      'const veredito = validarUrlDeMigration(env[VARIAVEL_DE_MIGRATION]);',
      'const veredito = validarUrlDeMigration(env[VARIAVEL_DE_MIGRATION] || env.DATABASE_URL);'
    );
    const d = projeto({ [RUNNER]: mutado });
    falhaCom(d, 'P28-DEPLOY-RUNNER');
    cleanup(d);
  });

  test('DGM-06b fallback com ?? reprova igual', () => {
    const mutado = real(RUNNER).replace(
      'env[VARIAVEL_DE_MIGRATION]);',
      'env[VARIAVEL_DE_MIGRATION] ?? env.DATABASE_URL);'
    );
    const d = projeto({ [RUNNER]: mutado });
    falhaCom(d, 'P28-DEPLOY-RUNNER');
    cleanup(d);
  });

  test('DGM-12 runner que deixa de recusar o pooler de transação reprova', () => {
    const mutado = real(RUNNER).replaceAll('6543', '0000');
    const d = projeto({ [RUNNER]: mutado });
    falhaCom(d, 'P28-DEPLOY-RUNNER');
    cleanup(d);
  });

  test('DGM-13 runner que executa migrate dev reprova', () => {
    const mutado = real(RUNNER).replace("'run', 'prisma:deploy'", "'exec', 'prisma', 'migrate dev'");
    const d = projeto({ [RUNNER]: mutado });
    falhaCom(d, 'P28-DEPLOY-RUNNER');
    cleanup(d);
  });

  test('DGM-14 runner ausente reprova em vez de passar vazio', () => {
    const d = projeto({ [RUNNER]: null });
    falhaCom(d, 'P28-DEPLOY-RUNNER');
    cleanup(d);
  });
});

describe('P28-DEPLOY-SCRIPTS', () => {
  test('DGM-03 remover deploy:migrate do package.json reprova', () => {
    const pacote = JSON.parse(PACKAGE_OK);
    delete pacote.scripts['deploy:migrate'];
    const d = projeto({ [PACKAGE]: JSON.stringify(pacote, null, 2) });
    falhaCom(d, 'P28-DEPLOY-SCRIPTS');
    cleanup(d);
  });

  test('DGM-03b deploy:migrate apontando para outro lugar reprova', () => {
    // Mantém o nome do script e some com a barreira: passaria despercebido.
    const pacote = JSON.parse(PACKAGE_OK);
    pacote.scripts['deploy:migrate'] = 'npm run prisma:deploy';
    const d = projeto({ [PACKAGE]: JSON.stringify(pacote, null, 2) });
    falhaCom(d, 'P28-DEPLOY-SCRIPTS');
    cleanup(d);
  });

  test('DGM-04 prisma:deploy virando migrate dev reprova', () => {
    const pacote = JSON.parse(PACKAGE_OK);
    pacote.scripts['prisma:deploy'] = 'prisma migrate dev --schema backend/prisma/schema.prisma';
    const d = projeto({ [PACKAGE]: JSON.stringify(pacote, null, 2) });
    falhaCom(d, 'P28-DEPLOY-SCRIPTS');
    cleanup(d);
  });

  test('DGM-05 prisma:deploy virando db push reprova', () => {
    const pacote = JSON.parse(PACKAGE_OK);
    pacote.scripts['prisma:deploy'] = 'prisma db push --schema backend/prisma/schema.prisma';
    const d = projeto({ [PACKAGE]: JSON.stringify(pacote, null, 2) });
    falhaCom(d, 'P28-DEPLOY-SCRIPTS');
    cleanup(d);
  });
});

describe('P28-DEPLOY-STARTUP', () => {
  test('DGM-07 migration dentro de backend:start reprova', () => {
    const pacote = JSON.parse(PACKAGE_OK);
    pacote.scripts['backend:start'] = 'npm run prisma:deploy && node backend/src/server.js';
    const d = projeto({ [PACKAGE]: JSON.stringify(pacote, null, 2) });
    falhaCom(d, 'P28-DEPLOY-STARTUP');
    cleanup(d);
  });

  test('DGM-07b migration dentro do server.js reprova', () => {
    // Com réplicas, cada processo tentaria migrar no boot e falha viraria
    // crash-loop em vez de erro claro.
    const mutado = `${SERVER_OK}\nspawnSync('npx', ['prisma', 'migrate deploy']);\n`;
    const d = projeto({ [SERVER]: mutado });
    falhaCom(d, 'P28-DEPLOY-STARTUP');
    cleanup(d);
  });
});

describe('P28-DEPLOY-CI', () => {
  test('DGM-08 runner de teste que contorna deploy:migrate reprova', () => {
    // Devolveria a prova ao nível anterior — "o Prisma migra" — sem quebrar nada.
    const mutado = real(TEST_RUNNER).replace(
      /executarComAmbiente\([\s\S]*?\);/,
      "executar('prisma migrate deploy', 'npx', ['prisma', 'migrate', 'deploy', '--schema', SCHEMA]);"
    );
    const d = projeto({ [TEST_RUNNER]: mutado });
    falhaCom(d, 'P28-DEPLOY-CI');
    cleanup(d);
  });

  test('DGM-08b runner de teste ausente reprova', () => {
    const d = projeto({ [TEST_RUNNER]: null });
    falhaCom(d, 'P28-DEPLOY-CI');
    cleanup(d);
  });
});

describe('P28-DEPLOY-ENV', () => {
  test('DGM-09 prefixar a variável com VITE_ reprova', () => {
    // `VITE_` publica no bundle: exporia a conexão de administração do banco a
    // qualquer visitante do site.
    const d = projeto({ [ENV_EXAMPLE]: 'VITE_MIGRATION_DATABASE_URL=\nMIGRATION_DATABASE_URL=\n' });
    falhaCom(d, 'P28-DEPLOY-ENV');
    cleanup(d);
  });

  test('DGM-09b variável não documentada no .env.example reprova', () => {
    const d = projeto({ [ENV_EXAMPLE]: 'DATABASE_URL=\nAUTH_SECRET=\n' });
    falhaCom(d, 'P28-DEPLOY-ENV');
    cleanup(d);
  });

  test('DGM-09c frontend citando a variável reprova', () => {
    const d = projeto({ 'src/main.jsx': 'export const u = import.meta.env.MIGRATION_DATABASE_URL;\n' });
    falhaCom(d, 'P28-DEPLOY-ENV');
    cleanup(d);
  });
});

describe('P28-DEPLOY-ACTIVATION', () => {
  test('DGM-15 instrução de ativação ausente reprova', () => {
    const d = projeto({ [DOC]: null });
    falhaCom(d, 'P28-DEPLOY-ACTIVATION');
    cleanup(d);
  });

  test('DGM-15b instrução que driftou do nome do script reprova', () => {
    // Renomear `deploy:migrate` sem atualizar a instrução deixaria o
    // proprietário configurando um comando inexistente.
    const d = projeto({ [DOC]: DOC_OK.replace('npm run deploy:migrate', 'npm run migrar') });
    falhaCom(d, 'P28-DEPLOY-ACTIVATION');
    cleanup(d);
  });
});

describe('gate:deploy-migrations — controles positivos', () => {
  test('DGM-11 prosa citando as formas proibidas NÃO reprova', () => {
    // O caso que separa regra de teatro. Um documento e um runner cheios de
    // comentários citando exatamente o que o gate procura precisam passar,
    // porque comentário não executa nada.
    const runnerComentado = real(RUNNER).replace(
      'import { spawnSync }',
      '// NUNCA fazer: MIGRATION_DATABASE_URL || DATABASE_URL\n' +
        '// NUNCA rodar: migrate dev, db push, migrate reset\n' +
        'import { spawnSync }'
    );
    const d = projeto({
      [RUNNER]: runnerComentado,
      [DOC]: `${DOC_OK}\n\nNunca use \`prisma migrate dev\` nem \`db push\` em produção.\n`,
    });
    passa(d);
    cleanup(d);
  });

  test('DGM-11b o backend pode MENCIONAR migration em comentário', () => {
    const d = projeto({
      [SERVER]: `${SERVER_OK}\n// Este processo NÃO roda migrate deploy: ver D-PROD-28.\n`,
    });
    passa(d);
    cleanup(d);
  });
});
