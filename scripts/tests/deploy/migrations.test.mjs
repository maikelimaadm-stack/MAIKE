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
  exigirAlvoConferido,
  exigirContractAutorizado,
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

/*
 * Barreira do CONTRACT contra a pasta REAL `backend/prisma/migrations`, que tem
 * CINCO migrations CONTRACT: a D-PROD-162, a D-PROD-183, a D-PROD-187, a
 * D-PROD-194 e a D-PROD-195. Como `MIGRATION_CONTRACT_AUTORIZADO` tem um só valor, cada caso
 * simula no histórico as OUTRAS CONTRACT já concluídas quando quer provar o
 * comportamento de uma só — senão uma outra, pendente, recusaria por conta
 * própria e o caso passaria (ou quebraria) pelo motivo errado.
 */
const CONTRACT_162 = '20261110300000_patrimonio_simplifica';
const CONTRACT_183 = '20261113200000_tipo_tarefa_drop_colunas';
const CONTRACT_187 = '20261113500000_categoria_manejo_cadcategoria';
const CONTRACT_194 = '20261114100000_cadcurvaganho_mensal';
const CONTRACT_195 = '20261114200000_tipo_atividade_defaults';
const ALVO_REMOTO = `postgresql://ops:${SENHA_FIXTURE}@db.exemplo.invalido:5432/postgres`;
const ALVO_LOCAL = 'postgresql://postgres@localhost:5432/maike_ci';
const concluida = (n, extra = {}) => ({ migration_name: n, checksum: 'x', finished_at: new Date(), rolled_back_at: null, ...extra });
const rodarBarreiraContract = async (env, lerHistorico) => {
  const saida = criarSaida();
  let leu = 0;
  const pode = await exigirContractAutorizado({
    env,
    urlMigracao: env[VARIAVEL_DE_MIGRATION],
    lerHistorico: async (url) => {
      leu++;
      assert.equal(url, env[VARIAVEL_DE_MIGRATION]);
      return lerHistorico();
    },
    erro: saida.erro,
    log: saida.log,
  });
  return { pode, leu, texto: saida.texto() };
};

describe('B11 (D-PROD-162) — o runner oficial não aplica um CONTRACT pendente sem autorização', () => {
  const NOME_C = CONTRACT_162;
  const REMOTO = ALVO_REMOTO;
  const LOCAL = ALVO_LOCAL;
  const rodar = rodarBarreiraContract;
  // A D-PROD-183, a D-PROD-187, a D-PROD-194 e a D-PROD-195 concluídas isolam a D-PROD-162 como a única CONTRACT pendente.
  const OUTRAS_CONCLUIDAS = () => [concluida(CONTRACT_183), concluida(CONTRACT_187), concluida(CONTRACT_194), concluida(CONTRACT_195)];

  test('B11-1 alvo remoto com o CONTRACT pendente e SEM a variável → recusa com código estável, sem URL', async () => {
    for (const autorizado of [undefined, '', 'D-PROD-999', 'd-prod-162']) {
      const env = { [VARIAVEL_DE_MIGRATION]: REMOTO, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const r = await rodar(env, () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos'), ...OUTRAS_CONCLUIDAS()]);
      assert.equal(r.pode, false, String(autorizado));
      assert.equal(r.leu, 1);
      assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.match(r.texto, new RegExp(NOME_C));
      assert.match(r.texto, /Nenhuma migration foi executada/);
      for (const outra of [CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195]) {
        assert.ok(!r.texto.includes(outra), `a recusa é pela D-PROD-162, não pela ${outra}:\n${r.texto}`);
      }
      assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
    }
    assert.equal(CODIGOS_DEPLOY_MIGRATION.CONTRACT_NAO_AUTORIZADO, 'DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED');
  });

  test('B11-2 falha aberta ou revertida no histórico continua pendente; histórico ilegível → falha fechada', async () => {
    const env = { [VARIAVEL_DE_MIGRATION]: REMOTO };
    const aberta = await rodar(env, () => [concluida(NOME_C, { finished_at: null }), ...OUTRAS_CONCLUIDAS()]);
    assert.equal(aberta.pode, false);
    assert.match(aberta.texto, new RegExp(`${NOME_C} \\(D-PROD-162\\)`));
    const revertida = await rodar(env, () => [concluida(NOME_C, { rolled_back_at: new Date() }), ...OUTRAS_CONCLUIDAS()]);
    assert.equal(revertida.pode, false);
    assert.match(revertida.texto, new RegExp(`${NOME_C} \\(D-PROD-162\\)`));
    const ilegivel = await rodar(env, () => {
      throw Object.assign(new Error(`Can't reach database server at db.exemplo.invalido user ops:${SENHA_FIXTURE}`), { code: 'P1001' });
    });
    assert.equal(ilegivel.pode, false);
    assert.match(ilegivel.texto, /DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED/);
    assert.match(ilegivel.texto, /P1001/);
    assert.ok(!ilegivel.texto.includes(SENHA_FIXTURE) && !ilegivel.texto.includes('exemplo.invalido'), ilegivel.texto);
  });

  test('B11-3 com MIGRATION_CONTRACT_AUTORIZADO = decisão exata → segue', async () => {
    const r = await rodar({ [VARIAVEL_DE_MIGRATION]: REMOTO, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-162' }, () => [...OUTRAS_CONCLUIDAS()]);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.match(r.texto, new RegExp(`CONTRACT autorizado: ${NOME_C} \\(D-PROD-162\\)`));
  });

  test('B11-4 CONTRACT já concluído no alvo → segue sem a variável (as releases seguintes não mudam)', async () => {
    const r = await rodar({ [VARIAVEL_DE_MIGRATION]: REMOTO }, () => [concluida(NOME_C, { rolled_back_at: new Date() }), concluida(NOME_C), ...OUTRAS_CONCLUIDAS()]);
    assert.equal(r.pode, true);
  });

  test('B11-5 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico (CI e dev livres); com a conferência exigida → recusa', async () => {
    const livre = await rodar({ [VARIAVEL_DE_MIGRATION]: LOCAL }, () => []);
    assert.equal(livre.pode, true);
    assert.equal(livre.leu, 0);
    const exigida = await rodar({ [VARIAVEL_DE_MIGRATION]: LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, () => [...OUTRAS_CONCLUIDAS()]);
    assert.equal(exigida.pode, false);
    assert.equal(exigida.leu, 1);
    assert.match(exigida.texto, new RegExp(`${NOME_C} \\(D-PROD-162\\)`));
  });

  test('B11-6 exigirAlvoConferido chama a barreira do CONTRACT DEPOIS do alvo conferido (alvo reprovado nem lê o histórico)', async () => {
    const SID = '7692130048193495360';
    const env = { [VARIAVEL_DE_MIGRATION]: REMOTO, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID };
    let leu = 0;
    const lerHistorico = async () => (leu++, [...OUTRAS_CONCLUIDAS()]);
    const silencio = { log: () => {}, erro: () => {}, resolverRuntime: async () => REMOTO, lerHistorico };
    assert.equal(await exigirAlvoConferido({ env, conferir: async () => ({ ok: false, falhas: ['x'], resumo: '' }), ...silencio }), false);
    assert.equal(leu, 0);
    assert.equal(await exigirAlvoConferido({ env, conferir: async () => ({ ok: true, falhas: [], resumo: '' }), ...silencio }), false);
    assert.equal(leu, 1);
    assert.equal(await exigirAlvoConferido({ env: { ...env, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-162' }, conferir: async () => ({ ok: true, falhas: [], resumo: '' }), ...silencio }), true);
  });

  test('B11-7 a única fonte de MIGRATION_CONTRACT_AUTORIZADO no repositório é o premerge (o release-migrate.yml não a define)', () => {
    const wf = readFileSync('.github/workflows/release-migrate.yml', 'utf8');
    assert.ok(!wf.includes('MIGRATION_CONTRACT_AUTORIZADO'));
  });
});

describe('B14 (D-PROD-183) — o DROP COLUMN de TipoTarefa só passa pelo runner com a própria decisão, e nunca junto da D-PROD-162', () => {
  const D183 = `${CONTRACT_183} (D-PROD-183)`;
  const D162 = `${CONTRACT_162} (D-PROD-162)`;
  // A D-PROD-187, a D-PROD-194 e a D-PROD-195 (posteriores) concluídas nos históricos simulados: aqui só a 162 e a 183 estão em jogo.
  const POSTERIORES_CONCLUIDAS = () => [concluida(CONTRACT_187), concluida(CONTRACT_194), concluida(CONTRACT_195)];
  // Como em produção antes da D-PROD-183: a D-PROD-162 já está concluída; a D-PROD-183 é a única CONTRACT pendente.
  const D162_CONCLUIDA = () => concluida(CONTRACT_162);
  const remoto = (autorizado) => ({
    [VARIAVEL_DE_MIGRATION]: ALVO_REMOTO,
    ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }),
  });
  const assertRecusa = (r, citada, rotulo) => {
    assert.equal(r.pode, false, rotulo);
    assert.equal(r.leu, 1, rotulo);
    assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/, rotulo);
    assert.ok(r.texto.includes(citada), `${rotulo}: deveria citar ${citada}:\n${r.texto}`);
    assert.match(r.texto, /Nenhuma migration foi executada/, rotulo);
    assert.ok(!r.texto.includes('CONTRACT autorizado'), `${rotulo}: recusa não pode anunciar autorização:\n${r.texto}`);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), `${rotulo}: a saída expôs a URL:\n${r.texto}`);
  };

  test('B14-1 D-PROD-162 concluída e D-PROD-183 pendente no alvo remoto, sem a decisão exata → recusa citando a D-PROD-183', async () => {
    for (const autorizado of [undefined, '', 'D-PROD-162', 'd-prod-183']) {
      const r = await rodarBarreiraContract(remoto(autorizado), () => [D162_CONCLUIDA(), ...POSTERIORES_CONCLUIDAS()]);
      assertRecusa(r, D183, String(autorizado));
      assert.ok(!r.texto.includes(CONTRACT_162), `a D-PROD-162 já concluída não pode ser citada:\n${r.texto}`);
      assert.ok(!r.texto.includes(CONTRACT_187) && !r.texto.includes(CONTRACT_194) && !r.texto.includes(CONTRACT_195), `as posteriores já concluídas não podem ser citadas:\n${r.texto}`);
    }
  });

  test('B14-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-183 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-183'), () => [D162_CONCLUIDA(), ...POSTERIORES_CONCLUIDAS()]);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D183}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU') && !r.texto.includes(CONTRACT_162), r.texto);
    assert.ok(!r.texto.includes(CONTRACT_187) && !r.texto.includes(CONTRACT_194) && !r.texto.includes(CONTRACT_195), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B14-3 as DUAS CONTRACT pendentes → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    // Só a D-PROD-187, a D-PROD-194 e a D-PROD-195 concluídas: a D-PROD-162 e a D-PROD-183 ficam pendentes juntas.
    const nenhumaContractConcluida = () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos'), ...POSTERIORES_CONCLUIDAS()];
    const com162 = await rodarBarreiraContract(remoto('D-PROD-162'), nenhumaContractConcluida);
    assertRecusa(com162, D183, 'D-PROD-162');
    assert.ok(!com162.texto.includes(D162), `a D-PROD-162 autorizada não é a que falta:\n${com162.texto}`);
    const com183 = await rodarBarreiraContract(remoto('D-PROD-183'), nenhumaContractConcluida);
    assertRecusa(com183, D162, 'D-PROD-183');
    assert.ok(!com183.texto.includes(D183), `a D-PROD-183 autorizada não é a que falta:\n${com183.texto}`);
    // Sem a variável, as duas aparecem.
    const sem = await rodarBarreiraContract(remoto(undefined), nenhumaContractConcluida);
    assertRecusa(sem, D162, 'sem variável');
    assert.ok(sem.texto.includes(D183), sem.texto);
    // Valor composto (a tentativa mais provável de autorizar as duas de uma vez) não autoriza nenhuma.
    for (const composto of ['D-PROD-162,D-PROD-183', 'D-PROD-162 D-PROD-183', ' D-PROD-183 ']) {
      const r = await rodarBarreiraContract(remoto(composto), nenhumaContractConcluida);
      assertRecusa(r, D162, composto);
      assert.ok(r.texto.includes(D183), `${composto}: a D-PROD-183 também fica sem autorização\n${r.texto}`);
    }
  });

  test('B14-4 D-PROD-183 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_183, { finished_at: null })],
      ['revertida', concluida(CONTRACT_183, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [D162_CONCLUIDA(), ...POSTERIORES_CONCLUIDAS(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D183, rotulo);
      // Pendente, e não concluída: com a decisão exata, a barreira anuncia a autorização.
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-183'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D183}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B14-5 as duas CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [D162_CONCLUIDA(), concluida(CONTRACT_183), ...POSTERIORES_CONCLUIDAS()],
      () => [D162_CONCLUIDA(), concluida(CONTRACT_183, { rolled_back_at: new Date() }), concluida(CONTRACT_183), ...POSTERIORES_CONCLUIDAS()],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B14-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-183 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-162']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract(
      { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' },
      () => [D162_CONCLUIDA(), ...POSTERIORES_CONCLUIDAS()]
    );
    assertRecusa(exigida, D183, 'conferência exigida');
  });
});

describe('B16 (D-PROD-187) — CategoriaManejo → CADCATEGORIA só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D187 = `${CONTRACT_187} (D-PROD-187)`;
  const D183 = `${CONTRACT_183} (D-PROD-183)`;
  // Como em produção antes da D-PROD-187: a D-PROD-162 e a D-PROD-183 já estão concluídas; a D-PROD-194 e a D-PROD-195
  // (posteriores) concluídas nos históricos simulados isolam a D-PROD-187 como a única CONTRACT pendente.
  const PRODUCAO = () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_194), concluida(CONTRACT_195)];
  const remoto = (autorizado) => ({
    [VARIAVEL_DE_MIGRATION]: ALVO_REMOTO,
    ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }),
  });
  const assertRecusa = (r, citada, rotulo) => {
    assert.equal(r.pode, false, rotulo);
    assert.equal(r.leu, 1, rotulo);
    assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/, rotulo);
    assert.ok(r.texto.includes(citada), `${rotulo}: deveria citar ${citada}:\n${r.texto}`);
    assert.match(r.texto, /Nenhuma migration foi executada/, rotulo);
    assert.ok(!r.texto.includes('CONTRACT autorizado'), `${rotulo}: recusa não pode anunciar autorização:\n${r.texto}`);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), `${rotulo}: a saída expôs a URL:\n${r.texto}`);
  };

  test('B16-1 D-PROD-162 e D-PROD-183 concluídas e D-PROD-187 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-187', async () => {
    for (const autorizado of [undefined, '', 'D-PROD-183', 'D-PROD-162', 'D-PROD-194', 'd-prod-187', ' D-PROD-187 ']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D187, String(autorizado));
      assert.ok(
        !r.texto.includes(CONTRACT_162) && !r.texto.includes(CONTRACT_183) && !r.texto.includes(CONTRACT_194) && !r.texto.includes(CONTRACT_195),
        `as concluídas não podem ser citadas:\n${r.texto}`
      );
    }
  });

  test('B16-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-187 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-187'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D187}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU'), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B16-3 D-PROD-183 e D-PROD-187 pendentes → recusa com qualquer decisão (nunca duas CONTRACT de uma vez)', async () => {
    // A D-PROD-194 e a D-PROD-195 (posteriores) concluídas: só a 183 e a 187 ficam pendentes juntas.
    const so162 = () => [concluida(CONTRACT_162), concluida(CONTRACT_194), concluida(CONTRACT_195)];
    const com183 = await rodarBarreiraContract(remoto('D-PROD-183'), so162);
    assertRecusa(com183, D187, 'D-PROD-183');
    assert.ok(!com183.texto.includes(D183), `a D-PROD-183 autorizada não é a que falta:\n${com183.texto}`);
    const com187 = await rodarBarreiraContract(remoto('D-PROD-187'), so162);
    assertRecusa(com187, D183, 'D-PROD-187');
    assert.ok(!com187.texto.includes(D187), `a D-PROD-187 autorizada não é a que falta:\n${com187.texto}`);
    for (const composto of ['D-PROD-183,D-PROD-187', 'D-PROD-183 D-PROD-187']) {
      const r = await rodarBarreiraContract(remoto(composto), so162);
      assertRecusa(r, D183, composto);
      assert.ok(r.texto.includes(D187), `${composto}: a D-PROD-187 também fica sem autorização\n${r.texto}`);
    }
  });

  test('B16-4 D-PROD-187 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_187, { finished_at: null })],
      ['revertida', concluida(CONTRACT_187, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...PRODUCAO(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D187, rotulo);
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-187'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D187}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B16-5 as cinco CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    const r = await rodarBarreiraContract(remoto(undefined), () => [...PRODUCAO(), concluida(CONTRACT_187)]);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
  });

  test('B16-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-187 pendente', async () => {
    const livre = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL }, () => []);
    assert.equal(livre.pode, true);
    assert.equal(livre.leu, 0);
    const exigida = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, PRODUCAO);
    assertRecusa(exigida, D187, 'conferência exigida');
  });
});

describe('B15 (D-PROD-194) — o DROP TABLE da CADCURVAGANHO por estação só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D194 = `${CONTRACT_194} (D-PROD-194)`;
  const D187 = `${CONTRACT_187} (D-PROD-187)`;
  const D183 = `${CONTRACT_183} (D-PROD-183)`;
  const D162 = `${CONTRACT_162} (D-PROD-162)`;
  // Produção: a D-PROD-162, a D-PROD-183 e a D-PROD-187 já estão concluídas; a D-PROD-194 é a única CONTRACT pendente.
  // A D-PROD-195 (posterior) concluída nos históricos simulados a mantém isolada.
  const D195_CONCLUIDA = () => concluida(CONTRACT_195);
  const ANTIGAS_CONCLUIDAS = () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187), D195_CONCLUIDA()];
  const remoto = (autorizado) => ({
    [VARIAVEL_DE_MIGRATION]: ALVO_REMOTO,
    ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }),
  });
  const assertRecusa = (r, citada, rotulo) => {
    assert.equal(r.pode, false, rotulo);
    assert.equal(r.leu, 1, rotulo);
    assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/, rotulo);
    assert.ok(r.texto.includes(citada), `${rotulo}: deveria citar ${citada}:\n${r.texto}`);
    assert.match(r.texto, /Nenhuma migration foi executada/, rotulo);
    assert.ok(!r.texto.includes('CONTRACT autorizado'), `${rotulo}: recusa não pode anunciar autorização:\n${r.texto}`);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), `${rotulo}: a saída expôs a URL:\n${r.texto}`);
  };

  test('B15-1 D-PROD-162, D-PROD-183 e D-PROD-187 concluídas e D-PROD-194 pendente no alvo remoto, sem a decisão exata → recusa citando a D-PROD-194', async () => {
    // 'D-PROD-190' e 'D-PROD-191' são os números antigos desta decisão (hoje da PR #269, Apontamento de Atividade, e da
    // PR #271, ícones de lote): não autorizam a curva mensal.
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-190', 'D-PROD-191', 'd-prod-194', ' D-PROD-194 ', 'D-PROD-19']) {
      const r = await rodarBarreiraContract(remoto(autorizado), ANTIGAS_CONCLUIDAS);
      assertRecusa(r, D194, String(autorizado));
      assert.ok(
        !r.texto.includes(CONTRACT_162) && !r.texto.includes(CONTRACT_183) && !r.texto.includes(CONTRACT_187),
        `as CONTRACT já concluídas não podem ser citadas:\n${r.texto}`
      );
    }
  });

  test('B15-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-194 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-194'), ANTIGAS_CONCLUIDAS);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D194}`), r.texto);
    assert.ok(
      !r.texto.includes('FALHOU') && !r.texto.includes(CONTRACT_162) && !r.texto.includes(CONTRACT_183) && !r.texto.includes(CONTRACT_187) && !r.texto.includes(CONTRACT_195),
      r.texto
    );
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B15-3 D-PROD-194 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const cenarios = [
      // [rótulo, histórico, a outra pendente]
      ['D-PROD-187 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), D195_CONCLUIDA()], D187],
      ['D-PROD-183 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_187), D195_CONCLUIDA()], D183],
      ['D-PROD-162 também pendente', () => [concluida(CONTRACT_183), concluida(CONTRACT_187), D195_CONCLUIDA()], D162],
      ['as quatro pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos'), D195_CONCLUIDA()], D162],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com194 = await rodarBarreiraContract(remoto('D-PROD-194'), historico);
      assertRecusa(com194, outra, `${rotulo} / D-PROD-194`);
      assert.ok(!com194.texto.includes(D194), `${rotulo}: a D-PROD-194 autorizada não é a que falta:\n${com194.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-190', 'D-PROD-191']) {
        const r = await rodarBarreiraContract(remoto(decisao), historico);
        assertRecusa(r, D194, `${rotulo} / ${decisao}`);
      }
      // Sem a variável, a D-PROD-194 e a outra aparecem.
      const sem = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(sem, D194, `${rotulo} / sem variável`);
      assert.ok(sem.texto.includes(outra), `${rotulo}: ${sem.texto}`);
      // Valor composto não autoriza nenhuma.
      for (const composto of [
        'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194',
        'D-PROD-162,D-PROD-183,D-PROD-194',
        'D-PROD-187,D-PROD-194',
        'D-PROD-183,D-PROD-194',
        'D-PROD-162 D-PROD-194',
      ]) {
        const r = await rodarBarreiraContract(remoto(composto), historico);
        assertRecusa(r, D194, `${rotulo} / ${composto}`);
        assert.ok(r.texto.includes(outra), `${rotulo} / ${composto}: a outra também fica sem autorização\n${r.texto}`);
      }
    }
  });

  test('B15-4 D-PROD-194 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_194, { finished_at: null })],
      ['revertida', concluida(CONTRACT_194, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...ANTIGAS_CONCLUIDAS(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D194, rotulo);
      // Pendente, e não concluída: com a decisão exata, a barreira anuncia a autorização.
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-194'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D194}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B15-5 as cinco CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [...ANTIGAS_CONCLUIDAS(), concluida(CONTRACT_194)],
      () => [...ANTIGAS_CONCLUIDAS(), concluida(CONTRACT_194, { rolled_back_at: new Date() }), concluida(CONTRACT_194)],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B15-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-194 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-183', 'D-PROD-187']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract(
      { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' },
      ANTIGAS_CONCLUIDAS
    );
    assertRecusa(exigida, D194, 'conferência exigida');
  });
});

describe('B17 (D-PROD-195) — os padrões e as flags do TipoAtividade só passam pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D195 = `${CONTRACT_195} (D-PROD-195)`;
  const D194 = `${CONTRACT_194} (D-PROD-194)`;
  const D187 = `${CONTRACT_187} (D-PROD-187)`;
  // Produção: as quatro CONTRACT anteriores já estão concluídas (a D-PROD-194 por último, em 2026-11-14 13:29 UTC);
  // a D-PROD-195 é a única CONTRACT pendente.
  const PRODUCAO = () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187), concluida(CONTRACT_194)];
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194];
  const remoto = (autorizado) => ({
    [VARIAVEL_DE_MIGRATION]: ALVO_REMOTO,
    ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }),
  });
  const assertRecusa = (r, citada, rotulo) => {
    assert.equal(r.pode, false, rotulo);
    assert.equal(r.leu, 1, rotulo);
    assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/, rotulo);
    assert.ok(r.texto.includes(citada), `${rotulo}: deveria citar ${citada}:\n${r.texto}`);
    assert.match(r.texto, /Nenhuma migration foi executada/, rotulo);
    assert.ok(!r.texto.includes('CONTRACT autorizado'), `${rotulo}: recusa não pode anunciar autorização:\n${r.texto}`);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), `${rotulo}: a saída expôs a URL:\n${r.texto}`);
  };

  test('B17-1 as quatro CONTRACT anteriores concluídas e a D-PROD-195 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-195', async () => {
    // 'D-PROD-182' é a decisão que criou a tabela: não autoriza os padrões e as flags.
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-182', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'd-prod-195', ' D-PROD-195 ', 'D-PROD-19']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D195, String(autorizado));
      for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), `${anterior} já está concluída e não pode ser citada:\n${r.texto}`);
    }
  });

  test('B17-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-195 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-195'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D195}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU'), r.texto);
    for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B17-3 D-PROD-195 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const cenarios = [
      // [rótulo, histórico, a outra pendente]
      ['D-PROD-194 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187)], D194],
      ['D-PROD-187 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_194)], D187],
      ['as cinco pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D194],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com195 = await rodarBarreiraContract(remoto('D-PROD-195'), historico);
      assertRecusa(com195, outra, `${rotulo} / D-PROD-195`);
      assert.ok(!com195.texto.includes(D195), `${rotulo}: a D-PROD-195 autorizada não é a que falta:\n${com195.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194']) {
        assertRecusa(await rodarBarreiraContract(remoto(decisao), historico), D195, `${rotulo} / ${decisao}`);
      }
      // Sem a variável, a D-PROD-195 e a outra aparecem.
      const sem = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(sem, D195, `${rotulo} / sem variável`);
      assert.ok(sem.texto.includes(outra), `${rotulo}: ${sem.texto}`);
      // Valor composto não autoriza nenhuma.
      for (const composto of ['D-PROD-194,D-PROD-195', 'D-PROD-187 D-PROD-195', 'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-195']) {
        const r = await rodarBarreiraContract(remoto(composto), historico);
        assertRecusa(r, D195, `${rotulo} / ${composto}`);
        assert.ok(r.texto.includes(outra), `${rotulo} / ${composto}: a outra também fica sem autorização\n${r.texto}`);
      }
    }
  });

  test('B17-4 D-PROD-195 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_195, { finished_at: null })],
      ['revertida', concluida(CONTRACT_195, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...PRODUCAO(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D195, rotulo);
      // Pendente, e não concluída: com a decisão exata, a barreira anuncia a autorização.
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-195'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D195}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B17-5 as cinco CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [...PRODUCAO(), concluida(CONTRACT_195)],
      () => [...PRODUCAO(), concluida(CONTRACT_195, { rolled_back_at: new Date() }), concluida(CONTRACT_195)],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B17-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-195 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-194']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, PRODUCAO);
    assertRecusa(exigida, D195, 'conferência exigida');
  });
});
