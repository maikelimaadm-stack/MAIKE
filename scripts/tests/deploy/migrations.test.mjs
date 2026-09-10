/**
 * Provas do runner de migrations de deploy (DEPLOY-MIGRATION-01, D-PROD-28).
 *
 * O runner é a única coisa entre "código novo" e "schema que ele espera". Um
 * defeito aqui não aparece em teste de domínio nenhum: aparece num deploy, com
 * a tabela faltando.
 *
 * Nenhum caso toca banco. O executor do subprocesso é injetado, então dá para
 * provar propagação de exit code e sigilo sem subir PostgreSQL — e sem que uma
 * falha de rede transforme prova em flake.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  validarUrlDeMigration,
  executarMigrationsDeDeploy,
  CODIGOS_DEPLOY_MIGRATION,
  VARIAVEL_DE_MIGRATION,
} from '../../deploy/run-migrations.mjs';

/**
 * Credencial FALSA, deliberadamente reconhecível.
 *
 * Não é segredo: é fixture. Existe para que DM-T09 possa afirmar que ela NÃO
 * aparece na saída — uma asserção que só tem valor se o valor procurado for
 * inconfundível.
 */
const SENHA_FIXTURE = 'SENHA_NAO_PODE_APARECER_123';
const URL_VALIDA = `postgresql://usuario:${SENHA_FIXTURE}@db.exemplo.invalido:5432/postgres`;

/** Coletor de saída, para provar o que o runner imprime e o que não imprime. */
const criarSaida = () => {
  const linhas = [];
  return {
    linhas,
    log: (m) => linhas.push(String(m)),
    erro: (m) => linhas.push(String(m)),
    texto: () => linhas.join('\n'),
  };
};

describe('DM-T01–DM-T06 — validação da conexão', () => {
  test('DM-T01 variável ausente reprova com código estável', () => {
    const r = validarUrlDeMigration(undefined);
    assert.equal(r.ok, false);
    assert.equal(r.codigo, CODIGOS_DEPLOY_MIGRATION.URL_REQUERIDA);
    assert.equal(r.codigo, 'DEPLOY-MIGRATION-URL-REQUIRED');
  });

  test('DM-T02 variável vazia (e só espaço) reprova igual', () => {
    for (const valor of ['', '   ', '\t\n']) {
      const r = validarUrlDeMigration(valor);
      assert.equal(r.ok, false, `deveria reprovar: ${JSON.stringify(valor)}`);
      assert.equal(r.codigo, CODIGOS_DEPLOY_MIGRATION.URL_REQUERIDA);
    }
  });

  test('DM-T03 URL sintaticamente inválida reprova', () => {
    const r = validarUrlDeMigration('isto não é uma url');
    assert.equal(r.ok, false);
    assert.equal(r.codigo, CODIGOS_DEPLOY_MIGRATION.URL_INVALIDA);
  });

  test('DM-T04 esquema que não é postgres reprova', () => {
    for (const url of [
      'http://db.exemplo.invalido:5432/postgres',
      'https://db.exemplo.invalido:5432/postgres',
      'mysql://db.exemplo.invalido:3306/app',
      'file:///tmp/banco',
    ]) {
      const r = validarUrlDeMigration(url);
      assert.equal(r.ok, false, `deveria reprovar: ${url}`);
      assert.equal(r.codigo, CODIGOS_DEPLOY_MIGRATION.URL_INVALIDA);
    }
  });

  test('DM-T05 pooler de transação do Supabase (:6543) reprova', () => {
    // O caso que já quebrou este projeto: `migrate deploy` apontado para a
    // 6543 ficou pendurado até o deploy ser cancelado à mão.
    for (const host of [
      'aws-0-sa-east-1.pooler.supabase.com',
      'db.abcdefghijklmnop.supabase.co',
    ]) {
      const r = validarUrlDeMigration(`postgresql://postgres.ref:${SENHA_FIXTURE}@${host}:6543/postgres`);
      assert.equal(r.ok, false, `deveria reprovar: ${host}:6543`);
      assert.equal(r.codigo, CODIGOS_DEPLOY_MIGRATION.POOLER_INSEGURO);
    }
  });

  test('DM-T06 conexão de sessão/direta na 5432 é aceita', () => {
    for (const url of [
      URL_VALIDA,
      `postgres://usuario:${SENHA_FIXTURE}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`,
      'postgresql://maike@127.0.0.1:55432/maike_test',
    ]) {
      assert.equal(validarUrlDeMigration(url).ok, true, `deveria aceitar: ${url}`);
    }
  });

  test('DM-T06b CONTROLE POSITIVO: 6543 fora do Supabase não é recusada', () => {
    // A regra é sobre o pooler do Supabase, não sobre o número 6543. Recusar a
    // porta em qualquer host transformaria a regra num palpite sobre a
    // infraestrutura alheia.
    const r = validarUrlDeMigration('postgresql://usuario@db.outraempresa.invalido:6543/app');
    assert.equal(r.ok, true);
  });
});

describe('DM-T07–DM-T10 — execução e sigilo', () => {
  test('DM-T07 subprocesso com exit 1 faz o runner falhar', () => {
    const saida = criarSaida();
    const status = executarMigrationsDeDeploy({
      env: { [VARIAVEL_DE_MIGRATION]: URL_VALIDA },
      executar: () => 1,
      log: saida.log,
      erro: saida.erro,
    });
    // O deploy precisa parar: o pre-deploy do Railway só bloqueia com exit != 0.
    assert.notEqual(status, 0);
  });

  test('DM-T08 subprocesso com exit 0 faz o runner devolver 0', () => {
    const saida = criarSaida();
    const status = executarMigrationsDeDeploy({
      env: { [VARIAVEL_DE_MIGRATION]: URL_VALIDA },
      executar: () => 0,
      log: saida.log,
      erro: saida.erro,
    });
    assert.equal(status, 0);
  });

  test('DM-T08b a conexão de migration substitui DATABASE_URL só no subprocesso', () => {
    let recebido = null;
    const env = {
      [VARIAVEL_DE_MIGRATION]: URL_VALIDA,
      DATABASE_URL: 'postgresql://runtime@pooler.exemplo.invalido:6543/app',
    };

    executarMigrationsDeDeploy({
      env,
      executar: (ambiente) => {
        recebido = ambiente;
        return 0;
      },
      log: () => {},
      erro: () => {},
    });

    assert.equal(recebido.DATABASE_URL, URL_VALIDA);
    // O ambiente do próprio runner não é mutado: a substituição é de fronteira.
    assert.equal(env.DATABASE_URL, 'postgresql://runtime@pooler.exemplo.invalido:6543/app');
  });

  test('DM-T08c variável ausente falha ANTES de executar qualquer coisa', () => {
    let chamou = false;
    const status = executarMigrationsDeDeploy({
      env: {},
      executar: () => {
        chamou = true;
        return 0;
      },
      log: () => {},
      erro: () => {},
    });

    assert.notEqual(status, 0);
    assert.equal(chamou, false, 'o runner não pode tentar migrar sem conexão declarada');
  });

  test('DM-T09 a saída NUNCA contém a credencial recebida', () => {
    // Vale para o caminho de sucesso, o de falha do subprocesso e os três de
    // validação: nenhum deles pode ecoar o valor.
    const cenarios = [
      { env: { [VARIAVEL_DE_MIGRATION]: URL_VALIDA }, executar: () => 0 },
      { env: { [VARIAVEL_DE_MIGRATION]: URL_VALIDA }, executar: () => 1 },
      { env: { [VARIAVEL_DE_MIGRATION]: `http://x:${SENHA_FIXTURE}@h:5432/d` }, executar: () => 0 },
      {
        env: {
          [VARIAVEL_DE_MIGRATION]: `postgresql://p:${SENHA_FIXTURE}@aws-0.pooler.supabase.com:6543/postgres`,
        },
        executar: () => 0,
      },
    ];

    for (const cenario of cenarios) {
      const saida = criarSaida();
      executarMigrationsDeDeploy({ ...cenario, log: saida.log, erro: saida.erro });
      const texto = saida.texto();
      assert.ok(!texto.includes(SENHA_FIXTURE), `credencial vazou na saída:\n${texto}`);
      assert.ok(!texto.includes('@'), `a saída expôs userinfo/host:\n${texto}`);
    }
  });

  test('DM-T10 o runner executa o primitive versionado, não migrate dev / db push', () => {
    const fonte = readFonte();
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.ok(codigo.includes('prisma:deploy'), 'o runner deve chamar o script prisma:deploy');
    for (const proibido of ['migrate dev', 'db push', 'migrate reset', 'db seed']) {
      assert.ok(!codigo.includes(proibido), `o runner não pode citar "${proibido}"`);
    }
  });
});

/** Lê a fonte do runner, para as asserções estruturais. */
function readFonte() {
  const aqui = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(aqui, '../../deploy/run-migrations.mjs'), 'utf8');
}
