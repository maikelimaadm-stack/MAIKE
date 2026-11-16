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
 * NOVE migrations CONTRACT: a D-PROD-162, a D-PROD-183, a D-PROD-187, a
 * D-PROD-194, a D-PROD-195, a D-PROD-197, a D-PROD-200, a D-PROD-208 e a D-PROD-209. Como `MIGRATION_CONTRACT_AUTORIZADO` tem um só valor, cada caso
 * simula no histórico as OUTRAS CONTRACT já concluídas quando quer provar o
 * comportamento de uma só — senão uma outra, pendente, recusaria por conta
 * própria e o caso passaria (ou quebraria) pelo motivo errado.
 */
const CONTRACT_162 = '20261110300000_patrimonio_simplifica';
const CONTRACT_183 = '20261113200000_tipo_tarefa_drop_colunas';
const CONTRACT_187 = '20261113500000_categoria_manejo_cadcategoria';
const CONTRACT_194 = '20261114100000_cadcurvaganho_mensal';
const CONTRACT_195 = '20261114200000_cadcategoria_curva_ganho';
const CONTRACT_196 = '20261114300000_tipo_atividade_defaults';
const CONTRACT_198 = '20261114500000_atividade_cabecalho';
const CONTRACT_208 = '20261116000000_mao_obra_parceiro';
const CONTRACT_209 = '20261116100000_funcionario_tipo_terceirizado';
/**
 * D-PROD-210 — a décima CONTRACT (base do consumo na Formulação). Os cenários das CONTRACT anteriores (B11…B21) são
 * de antes dela: `rodarBarreiraContract` a acrescenta como CONCLUÍDA a esses históricos (como as POSTERIORES de cada
 * um), salvo quando o histórico já a cita ou o cenário pede `sem210` (o B22, que a testa).
 */
const CONTRACT_210 = '20261116200000_formulacao_base_consumo';
/** O histórico com a D-PROD-210 concluída (se ele ainda não a cita). */
const com210Concluida = (h) => (h.some((l) => l.migration_name === CONTRACT_210) ? h : [...h, concluida(CONTRACT_210)]);
const ALVO_REMOTO = `postgresql://ops:${SENHA_FIXTURE}@db.exemplo.invalido:5432/postgres`;
const ALVO_LOCAL = 'postgresql://postgres@localhost:5432/maike_ci';
const concluida = (n, extra = {}) => ({ migration_name: n, checksum: 'x', finished_at: new Date(), rolled_back_at: null, ...extra });
const rodarBarreiraContract = async (env, lerHistorico, { sem210 = false } = {}) => {
  const saida = criarSaida();
  let leu = 0;
  const pode = await exigirContractAutorizado({
    env,
    urlMigracao: env[VARIAVEL_DE_MIGRATION],
    lerHistorico: async (url) => {
      leu++;
      assert.equal(url, env[VARIAVEL_DE_MIGRATION]);
      const h = await lerHistorico();
      return sem210 ? h : com210Concluida(h);
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
  // A D-PROD-183, a D-PROD-187, a D-PROD-194, a D-PROD-195, a D-PROD-197 e a D-PROD-200 concluídas isolam a D-PROD-162 como a única CONTRACT pendente.
  const OUTRAS_CONCLUIDAS = () => [concluida(CONTRACT_183), concluida(CONTRACT_187), concluida(CONTRACT_194), concluida(CONTRACT_195), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)];

  test('B11-1 alvo remoto com o CONTRACT pendente e SEM a variável → recusa com código estável, sem URL', async () => {
    for (const autorizado of [undefined, '', 'D-PROD-999', 'd-prod-162']) {
      const env = { [VARIAVEL_DE_MIGRATION]: REMOTO, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const r = await rodar(env, () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos'), ...OUTRAS_CONCLUIDAS()]);
      assert.equal(r.pode, false, String(autorizado));
      assert.equal(r.leu, 1);
      assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.match(r.texto, new RegExp(NOME_C));
      assert.match(r.texto, /Nenhuma migration foi executada/);
      for (const outra of [CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195, CONTRACT_196, CONTRACT_198, CONTRACT_208, CONTRACT_209]) {
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
    const lerHistorico = async () => (leu++, com210Concluida([...OUTRAS_CONCLUIDAS()]));
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
  // A D-PROD-187, a D-PROD-194, a D-PROD-195, a D-PROD-197 e a D-PROD-200 (posteriores) concluídas nos históricos simulados: aqui só a 162 e a 183 estão em jogo.
  const POSTERIORES_CONCLUIDAS = () => [concluida(CONTRACT_187), concluida(CONTRACT_194), concluida(CONTRACT_195), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)];
  const POSTERIORES = [CONTRACT_187, CONTRACT_194, CONTRACT_195, CONTRACT_196, CONTRACT_198, CONTRACT_208, CONTRACT_209];
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
      assert.ok(POSTERIORES.every((n) => !r.texto.includes(n)), `as posteriores já concluídas não podem ser citadas:\n${r.texto}`);
    }
  });

  test('B14-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-183 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-183'), () => [D162_CONCLUIDA(), ...POSTERIORES_CONCLUIDAS()]);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D183}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU') && !r.texto.includes(CONTRACT_162), r.texto);
    assert.ok(POSTERIORES.every((n) => !r.texto.includes(n)), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B14-3 as DUAS CONTRACT pendentes → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    // Só as posteriores (D-PROD-187, D-PROD-194, D-PROD-195, D-PROD-197 e D-PROD-200) concluídas: a D-PROD-162 e a D-PROD-183 ficam pendentes juntas.
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
  // Como em produção antes da D-PROD-187: a D-PROD-162 e a D-PROD-183 já estão concluídas; a D-PROD-194, a D-PROD-195, a
  // D-PROD-197 e a D-PROD-200 (posteriores) concluídas nos históricos simulados isolam a D-PROD-187 como a única CONTRACT pendente.
  const PRODUCAO = () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_194), concluida(CONTRACT_195), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)];
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
    for (const autorizado of [undefined, '', 'D-PROD-183', 'D-PROD-162', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'd-prod-187', ' D-PROD-187 ']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D187, String(autorizado));
      assert.ok(
        !r.texto.includes(CONTRACT_162) && !r.texto.includes(CONTRACT_183) && !r.texto.includes(CONTRACT_194) && !r.texto.includes(CONTRACT_195) && !r.texto.includes(CONTRACT_196) && !r.texto.includes(CONTRACT_198),
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
    // A D-PROD-194, a D-PROD-195, a D-PROD-197 e a D-PROD-200 (posteriores) concluídas: só a 183 e a 187 ficam pendentes juntas.
    const so162 = () => [concluida(CONTRACT_162), concluida(CONTRACT_194), concluida(CONTRACT_195), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)];
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

  test('B16-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
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
  // Como em produção antes da D-PROD-194: a D-PROD-162, a D-PROD-183 e a D-PROD-187 já estão concluídas; a D-PROD-195, a
  // D-PROD-197 e a D-PROD-200 (posteriores) concluídas nos históricos simulados isolam a D-PROD-194 como a única CONTRACT pendente.
  const POSTERIORES_CONCLUIDAS = () => [concluida(CONTRACT_195), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)];
  const ANTIGAS_CONCLUIDAS = () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187), ...POSTERIORES_CONCLUIDAS()];
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
        !r.texto.includes(CONTRACT_162) && !r.texto.includes(CONTRACT_183) && !r.texto.includes(CONTRACT_187) && !r.texto.includes(CONTRACT_195) && !r.texto.includes(CONTRACT_196) && !r.texto.includes(CONTRACT_198),
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
      !r.texto.includes('FALHOU') && !r.texto.includes(CONTRACT_162) && !r.texto.includes(CONTRACT_183) && !r.texto.includes(CONTRACT_187) && !r.texto.includes(CONTRACT_195) && !r.texto.includes(CONTRACT_196) && !r.texto.includes(CONTRACT_198),
      r.texto
    );
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B15-3 D-PROD-194 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const cenarios = [
      // [rótulo, histórico, a outra pendente] — a D-PROD-195, a D-PROD-197 e a D-PROD-200 (posteriores) concluídas, salvo em "as nove pendentes".
      ['D-PROD-187 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), ...POSTERIORES_CONCLUIDAS()], D187],
      ['D-PROD-183 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_187), ...POSTERIORES_CONCLUIDAS()], D183],
      ['D-PROD-162 também pendente', () => [concluida(CONTRACT_183), concluida(CONTRACT_187), ...POSTERIORES_CONCLUIDAS()], D162],
      ['as nove pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D162],
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

  test('B15-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
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

describe('B17 (D-PROD-195) — a curva de ganho obrigatória na Categoria de Manejo só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D195 = `${CONTRACT_195} (D-PROD-195)`;
  const D194 = `${CONTRACT_194} (D-PROD-194)`;
  const D187 = `${CONTRACT_187} (D-PROD-187)`;
  const D162 = `${CONTRACT_162} (D-PROD-162)`;
  const D196 = `${CONTRACT_196} (D-PROD-197)`;
  // Como em produção antes da D-PROD-195: as quatro CONTRACT anteriores (D-PROD-162, D-PROD-183, D-PROD-187 e D-PROD-194)
  // já estão concluídas; a D-PROD-197 e a D-PROD-200 (posteriores) concluídas nos históricos simulados isolam a D-PROD-195
  // como a única CONTRACT pendente.
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194];
  const CONCLUIDAS = [...ANTERIORES, CONTRACT_196, CONTRACT_198, CONTRACT_208, CONTRACT_209];
  const PRODUCAO = () => CONCLUIDAS.map((n) => concluida(n));
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

  test('B17-1 as quatro anteriores concluídas e D-PROD-195 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-195', async () => {
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-197', 'D-PROD-200', 'd-prod-195', ' D-PROD-195 ', 'D-PROD-19', 'D-PROD-1950']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D195, String(autorizado));
      assert.ok(CONCLUIDAS.every((n) => !r.texto.includes(n)), `as CONTRACT já concluídas não podem ser citadas:\n${r.texto}`);
    }
  });

  test('B17-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-195 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-195'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D195}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU') && CONCLUIDAS.every((n) => !r.texto.includes(n)), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B17-3 D-PROD-195 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const cenarios = [
      // [rótulo, histórico, a outra pendente] — a D-PROD-197 e a D-PROD-200 (posteriores) concluídas, salvo quando uma
      // delas é a outra pendente e em "as nove pendentes".
      ['D-PROD-197 também pendente', () => [...ANTERIORES, CONTRACT_198, CONTRACT_208, CONTRACT_209].map((n) => concluida(n)), D196],
      ['D-PROD-200 também pendente', () => [...ANTERIORES, CONTRACT_196, CONTRACT_208, CONTRACT_209].map((n) => concluida(n)), `${CONTRACT_198} (D-PROD-200)`],
      ['D-PROD-194 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)], D194],
      ['D-PROD-187 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_194), concluida(CONTRACT_196), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)], D187],
      ['as nove pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D162],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com195 = await rodarBarreiraContract(remoto('D-PROD-195'), historico);
      assertRecusa(com195, outra, `${rotulo} / D-PROD-195`);
      assert.ok(!com195.texto.includes(D195), `${rotulo}: a D-PROD-195 autorizada não é a que falta:\n${com195.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-187', 'D-PROD-194', 'D-PROD-197']) {
        assertRecusa(await rodarBarreiraContract(remoto(decisao), historico), D195, `${rotulo} / ${decisao}`);
      }
      const sem = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(sem, D195, `${rotulo} / sem variável`);
      assert.ok(sem.texto.includes(outra), `${rotulo}: ${sem.texto}`);
      // Valor composto não autoriza nenhuma.
      for (const composto of ['D-PROD-194,D-PROD-195', 'D-PROD-187 D-PROD-195', 'D-PROD-195,D-PROD-197', 'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-195', 'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-195,D-PROD-197']) {
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
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-195'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D195}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B17-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização (as releases seguintes não mudam)', async () => {
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

describe('B18 (D-PROD-197) — os padrões e as flags do TipoAtividade só passam pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D196 = `${CONTRACT_196} (D-PROD-197)`;
  const D195 = `${CONTRACT_195} (D-PROD-195)`;
  const D194 = `${CONTRACT_194} (D-PROD-194)`;
  const D187 = `${CONTRACT_187} (D-PROD-187)`;
  // Como em produção antes da D-PROD-197: as cinco CONTRACT anteriores já estão concluídas (a D-PROD-195 por último, às
  // 14:51:56 UTC de 2026-11-14); a D-PROD-200 (posterior) concluída nos históricos simulados isola a D-PROD-197 como a
  // única CONTRACT pendente.
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195];
  const POSTERIORES = [CONTRACT_198, CONTRACT_208, CONTRACT_209];
  const PRODUCAO = () => [...ANTERIORES, ...POSTERIORES].map((n) => concluida(n));
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

  test('B18-1 as cinco CONTRACT anteriores concluídas e a D-PROD-197 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-197', async () => {
    // 'D-PROD-182' é a decisão que criou a tabela, 'D-PROD-195' a CONTRACT anterior e 'D-PROD-200' a seguinte: nenhuma autoriza os padrões e as flags.
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-182', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-200', 'd-prod-195', 'd-prod-197', 'D-PROD-196', ' D-PROD-197 ', 'D-PROD-19', 'D-PROD-1970']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D196, String(autorizado));
      for (const outra of [...ANTERIORES, ...POSTERIORES]) assert.ok(!r.texto.includes(outra), `${outra} já está concluída e não pode ser citada:\n${r.texto}`);
    }
  });

  test('B18-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-197 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-197'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D196}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU'), r.texto);
    for (const outra of [...ANTERIORES, ...POSTERIORES]) assert.ok(!r.texto.includes(outra), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B18-3 D-PROD-197 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const cenarios = [
      // [rótulo, histórico, a outra pendente] — a D-PROD-200 (posterior) concluída, salvo quando é ela a outra pendente e
      // em "as nove pendentes".
      ['D-PROD-200 também pendente', () => [...ANTERIORES, CONTRACT_208, CONTRACT_209].map((n) => concluida(n)), `${CONTRACT_198} (D-PROD-200)`],
      ['D-PROD-195 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187), concluida(CONTRACT_194), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)], D195],
      ['D-PROD-194 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_187), concluida(CONTRACT_195), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)], D194],
      ['D-PROD-187 também pendente', () => [concluida(CONTRACT_162), concluida(CONTRACT_183), concluida(CONTRACT_194), concluida(CONTRACT_195), concluida(CONTRACT_198), concluida(CONTRACT_208), concluida(CONTRACT_209)], D187],
      ['as nove pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D194],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com196 = await rodarBarreiraContract(remoto('D-PROD-197'), historico);
      assertRecusa(com196, outra, `${rotulo} / D-PROD-197`);
      assert.ok(!com196.texto.includes(D196), `${rotulo}: a D-PROD-197 autorizada não é a que falta:\n${com196.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-200']) {
        assertRecusa(await rodarBarreiraContract(remoto(decisao), historico), D196, `${rotulo} / ${decisao}`);
      }
      // Sem a variável, a D-PROD-197 e a outra aparecem.
      const sem = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(sem, D196, `${rotulo} / sem variável`);
      assert.ok(sem.texto.includes(outra), `${rotulo}: ${sem.texto}`);
      // Valor composto não autoriza nenhuma.
      for (const composto of [
        'D-PROD-194,D-PROD-197',
        'D-PROD-187 D-PROD-197',
        'D-PROD-195,D-PROD-197',
        'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-197',
        'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-195,D-PROD-197',
      ]) {
        const r = await rodarBarreiraContract(remoto(composto), historico);
        assertRecusa(r, D196, `${rotulo} / ${composto}`);
        assert.ok(r.texto.includes(outra), `${rotulo} / ${composto}: a outra também fica sem autorização\n${r.texto}`);
      }
    }
  });

  test('B18-4 D-PROD-197 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_196, { finished_at: null })],
      ['revertida', concluida(CONTRACT_196, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...PRODUCAO(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D196, rotulo);
      // Pendente, e não concluída: com a decisão exata, a barreira anuncia a autorização.
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-197'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D196}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B18-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [...PRODUCAO(), concluida(CONTRACT_196)],
      () => [...PRODUCAO(), concluida(CONTRACT_196, { rolled_back_at: new Date() }), concluida(CONTRACT_196)],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B18-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-197 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-194', 'D-PROD-195']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, PRODUCAO);
    assertRecusa(exigida, D196, 'conferência exigida');
  });
});

describe('B19 (D-PROD-200) — a Atividade cabeçalho (conversão e DROP das 3 tabelas antigas) só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D198 = `${CONTRACT_198} (D-PROD-200)`;
  const D196 = `${CONTRACT_196} (D-PROD-197)`;
  const D195 = `${CONTRACT_195} (D-PROD-195)`;
  const D162 = `${CONTRACT_162} (D-PROD-162)`;
  // Como em produção no dia da D-PROD-200: as seis CONTRACT anteriores já estão concluídas (a D-PROD-197 por último, às
  // 17:05:05 UTC de 2026-11-14); a D-PROD-208 (posterior) concluída nos históricos simulados isola a D-PROD-200 como a
  // única CONTRACT pendente.
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195, CONTRACT_196];
  const POSTERIORES = [CONTRACT_208, CONTRACT_209];
  const PRODUCAO = () => [...ANTERIORES, ...POSTERIORES].map((n) => concluida(n));
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

  test('B19-1 as seis CONTRACT anteriores concluídas e a D-PROD-200 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-200', async () => {
    // 'D-PROD-190' e 'D-PROD-193' criaram as tabelas que ela apaga e 'D-PROD-197' é a CONTRACT anterior: nenhuma autoriza
    // esta; nem a decisão em minúsculas, com espaço, cortada ou com um dígito a mais (comparação exata).
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-190', 'D-PROD-193', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'd-prod-200', ' D-PROD-200 ', ' D-PROD-200', 'D-PROD-200 ', 'D-PROD-19', 'D-PROD-1980']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D198, String(autorizado));
      for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), `${anterior} já está concluída e não pode ser citada:\n${r.texto}`);
    }
  });

  test('B19-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-200 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-200'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D198}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU'), r.texto);
    for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B19-3 D-PROD-200 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const sem = (n) => () => [...ANTERIORES, ...POSTERIORES].filter((x) => x !== n).map((x) => concluida(x));
    const cenarios = [
      // [rótulo, histórico, a outra pendente]
      ['D-PROD-197 também pendente', sem(CONTRACT_196), D196],
      ['D-PROD-195 também pendente', sem(CONTRACT_195), D195],
      ['as nove pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D162],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com198 = await rodarBarreiraContract(remoto('D-PROD-200'), historico);
      assertRecusa(com198, outra, `${rotulo} / D-PROD-200`);
      assert.ok(!com198.texto.includes(D198), `${rotulo}: a D-PROD-200 autorizada não é a que falta:\n${com198.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-195', 'D-PROD-197']) {
        assertRecusa(await rodarBarreiraContract(remoto(decisao), historico), D198, `${rotulo} / ${decisao}`);
      }
      // Sem a variável, a D-PROD-200 e a outra aparecem.
      const semVariavel = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(semVariavel, D198, `${rotulo} / sem variável`);
      assert.ok(semVariavel.texto.includes(outra), `${rotulo}: ${semVariavel.texto}`);
      // Valor composto não autoriza nenhuma.
      for (const composto of ['D-PROD-197,D-PROD-200', 'D-PROD-195 D-PROD-200', 'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-195,D-PROD-197,D-PROD-200']) {
        const r = await rodarBarreiraContract(remoto(composto), historico);
        assertRecusa(r, D198, `${rotulo} / ${composto}`);
        assert.ok(r.texto.includes(outra), `${rotulo} / ${composto}: a outra também fica sem autorização\n${r.texto}`);
      }
    }
  });

  test('B19-4 D-PROD-200 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_198, { finished_at: null })],
      ['revertida', concluida(CONTRACT_198, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...PRODUCAO(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D198, rotulo);
      // Pendente, e não concluída: com a decisão exata, a barreira anuncia a autorização.
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-200'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D198}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B19-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [...PRODUCAO(), concluida(CONTRACT_198)],
      () => [...PRODUCAO(), concluida(CONTRACT_198, { rolled_back_at: new Date() }), concluida(CONTRACT_198)],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B19-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-200 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-197']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, PRODUCAO);
    assertRecusa(exigida, D198, 'conferência exigida');
  });
});

describe('B20 (D-PROD-208) — o funcionário como papel do parceiro (DROP da coluna e da tabela Funcionario, vazias) só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D208 = `${CONTRACT_208} (D-PROD-208)`;
  const D198 = `${CONTRACT_198} (D-PROD-200)`;
  const D196 = `${CONTRACT_196} (D-PROD-197)`;
  const D162 = `${CONTRACT_162} (D-PROD-162)`;
  // Como em produção no dia da D-PROD-208: as sete CONTRACT anteriores já estão concluídas (a D-PROD-200 por último); a
  // D-PROD-209 (posterior) concluída nos históricos simulados isola a D-PROD-208 como a única CONTRACT pendente.
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195, CONTRACT_196, CONTRACT_198];
  const POSTERIORES = [CONTRACT_209];
  const PRODUCAO = () => [...ANTERIORES, ...POSTERIORES].map((n) => concluida(n));
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

  test('B20-1 as sete CONTRACT anteriores concluídas e a D-PROD-208 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-208', async () => {
    // 'D-PROD-207' criou a tabela que ela apaga e 'D-PROD-200' é a CONTRACT anterior: nenhuma autoriza esta; nem a
    // decisão em minúsculas, com espaço, cortada ou com um dígito a mais (comparação exata).
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-207', 'd-prod-208', ' D-PROD-208 ', ' D-PROD-208', 'D-PROD-208 ', 'D-PROD-20', 'D-PROD-2080']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D208, String(autorizado));
      for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), `${anterior} já está concluída e não pode ser citada:\n${r.texto}`);
    }
  });

  test('B20-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-208 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-208'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D208}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU'), r.texto);
    for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B20-3 D-PROD-208 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const sem = (n) => () => [...ANTERIORES, ...POSTERIORES].filter((x) => x !== n).map((x) => concluida(x));
    const cenarios = [
      // [rótulo, histórico, a outra pendente]
      ['D-PROD-209 também pendente', sem(CONTRACT_209), `${CONTRACT_209} (D-PROD-209)`],
      ['D-PROD-200 também pendente', sem(CONTRACT_198), D198],
      ['D-PROD-197 também pendente', sem(CONTRACT_196), D196],
      ['as nove pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D162],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com208 = await rodarBarreiraContract(remoto('D-PROD-208'), historico);
      assertRecusa(com208, outra, `${rotulo} / D-PROD-208`);
      assert.ok(!com208.texto.includes(D208), `${rotulo}: a D-PROD-208 autorizada não é a que falta:\n${com208.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-197', 'D-PROD-200']) {
        assertRecusa(await rodarBarreiraContract(remoto(decisao), historico), D208, `${rotulo} / ${decisao}`);
      }
      const semVariavel = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(semVariavel, D208, `${rotulo} / sem variável`);
      assert.ok(semVariavel.texto.includes(outra), `${rotulo}: ${semVariavel.texto}`);
      for (const composto of ['D-PROD-200,D-PROD-208', 'D-PROD-197 D-PROD-208', 'D-PROD-162,D-PROD-183,D-PROD-187,D-PROD-194,D-PROD-195,D-PROD-197,D-PROD-200,D-PROD-208']) {
        const r = await rodarBarreiraContract(remoto(composto), historico);
        assertRecusa(r, D208, `${rotulo} / ${composto}`);
        assert.ok(r.texto.includes(outra), `${rotulo} / ${composto}: a outra também fica sem autorização\n${r.texto}`);
      }
    }
  });

  test('B20-4 D-PROD-208 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_208, { finished_at: null })],
      ['revertida', concluida(CONTRACT_208, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...PRODUCAO(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D208, rotulo);
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-208'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D208}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B20-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [...PRODUCAO(), concluida(CONTRACT_208)],
      () => [...PRODUCAO(), concluida(CONTRACT_208, { rolled_back_at: new Date() }), concluida(CONTRACT_208)],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B20-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-208 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-200']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, PRODUCAO);
    assertRecusa(exigida, D208, 'conferência exigida');
  });
});

describe('B21 (D-PROD-209) — o tipo do funcionário com TERCEIRIZADO no lugar de TAREFEIRO (troca do CHECK de Fornecedor) só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D209 = `${CONTRACT_209} (D-PROD-209)`;
  const D208 = `${CONTRACT_208} (D-PROD-208)`;
  const D198 = `${CONTRACT_198} (D-PROD-200)`;
  const D162 = `${CONTRACT_162} (D-PROD-162)`;
  // Produção hoje: as oito CONTRACT anteriores já estão concluídas (a D-PROD-208 por último); a D-PROD-209 é a única
  // CONTRACT pendente.
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195, CONTRACT_196, CONTRACT_198, CONTRACT_208];
  const PRODUCAO = () => ANTERIORES.map((n) => concluida(n));
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

  test('B21-1 as oito CONTRACT anteriores concluídas e a D-PROD-209 pendente no alvo remoto, sem a decisão exata → recusa citando só a D-PROD-209', async () => {
    // 'D-PROD-208' criou o CHECK que ela troca: não autoriza esta; nem a decisão em minúsculas, com espaço, cortada ou
    // com um dígito a mais (comparação exata).
    for (const autorizado of [undefined, '', 'D-PROD-162', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208', 'd-prod-209', ' D-PROD-209 ', ' D-PROD-209', 'D-PROD-209 ', 'D-PROD-20', 'D-PROD-2090']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO);
      assertRecusa(r, D209, String(autorizado));
      for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), `${anterior} já está concluída e não pode ser citada:\n${r.texto}`);
    }
  });

  test('B21-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-209 → segue e registra a autorização', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-209'), PRODUCAO);
    assert.equal(r.pode, true);
    assert.equal(r.leu, 1);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D209}`), r.texto);
    assert.ok(!r.texto.includes('FALHOU'), r.texto);
    for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), r.texto);
    assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
  });

  test('B21-3 D-PROD-209 pendente junto de outra CONTRACT → recusa com qualquer decisão (o runner nunca aplica duas CONTRACT de uma vez)', async () => {
    const sem = (n) => () => ANTERIORES.filter((x) => x !== n).map((x) => concluida(x));
    const cenarios = [
      // [rótulo, histórico, a outra pendente]
      ['D-PROD-208 também pendente', sem(CONTRACT_208), D208],
      ['D-PROD-200 também pendente', sem(CONTRACT_198), D198],
      ['as nove pendentes', () => [concluida('20261110200000_patrimonio_p1_02_abastecimentos')], D162],
    ];
    for (const [rotulo, historico, outra] of cenarios) {
      const com209 = await rodarBarreiraContract(remoto('D-PROD-209'), historico);
      assertRecusa(com209, outra, `${rotulo} / D-PROD-209`);
      assert.ok(!com209.texto.includes(D209), `${rotulo}: a D-PROD-209 autorizada não é a que falta:\n${com209.texto}`);
      for (const decisao of ['D-PROD-162', 'D-PROD-200', 'D-PROD-208']) {
        assertRecusa(await rodarBarreiraContract(remoto(decisao), historico), D209, `${rotulo} / ${decisao}`);
      }
      const semVariavel = await rodarBarreiraContract(remoto(undefined), historico);
      assertRecusa(semVariavel, D209, `${rotulo} / sem variável`);
      assert.ok(semVariavel.texto.includes(outra), `${rotulo}: ${semVariavel.texto}`);
      for (const composto of ['D-PROD-208,D-PROD-209', 'D-PROD-208 D-PROD-209']) {
        const r = await rodarBarreiraContract(remoto(composto), historico);
        assertRecusa(r, D209, `${rotulo} / ${composto}`);
        assert.ok(r.texto.includes(outra), `${rotulo} / ${composto}: a outra também fica sem autorização\n${r.texto}`);
      }
    }
  });

  test('B21-4 D-PROD-209 com linha aberta (finished_at null) ou revertida continua pendente', async () => {
    for (const [rotulo, linha] of [
      ['aberta', concluida(CONTRACT_209, { finished_at: null })],
      ['revertida', concluida(CONTRACT_209, { rolled_back_at: new Date() })],
    ]) {
      const historico = () => [...PRODUCAO(), linha];
      assertRecusa(await rodarBarreiraContract(remoto(undefined), historico), D209, rotulo);
      const autorizada = await rodarBarreiraContract(remoto('D-PROD-209'), historico);
      assert.equal(autorizada.pode, true, rotulo);
      assert.ok(autorizada.texto.includes(`CONTRACT autorizado: ${D209}`), `${rotulo}:\n${autorizada.texto}`);
    }
  });

  test('B21-5 as nove CONTRACT concluídas no alvo → segue sem a variável e sem anunciar autorização', async () => {
    for (const historico of [
      () => [...PRODUCAO(), concluida(CONTRACT_209)],
      () => [...PRODUCAO(), concluida(CONTRACT_209, { rolled_back_at: new Date() }), concluida(CONTRACT_209)],
    ]) {
      const r = await rodarBarreiraContract(remoto(undefined), historico);
      assert.equal(r.pode, true);
      assert.equal(r.leu, 1);
      assert.equal(r.texto, '', `nada a autorizar, nada a dizer:\n${r.texto}`);
    }
  });

  test('B21-6 URL local sem MIGRATION_EXIGIR_CONFERENCIA → segue sem ler o histórico; com a conferência exigida → recusa a D-PROD-209 pendente', async () => {
    for (const autorizado of [undefined, 'D-PROD-208']) {
      const env = { [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) };
      const livre = await rodarBarreiraContract(env, () => []);
      assert.equal(livre.pode, true, String(autorizado));
      assert.equal(livre.leu, 0, String(autorizado));
    }
    const exigida = await rodarBarreiraContract({ [VARIAVEL_DE_MIGRATION]: ALVO_LOCAL, MIGRATION_EXIGIR_CONFERENCIA: 'sim' }, PRODUCAO);
    assertRecusa(exigida, D209, 'conferência exigida');
  });
});

describe('B22 (D-PROD-210) — a base do consumo na Formulação só passa pelo runner com a própria decisão, e nunca junto de outra CONTRACT', () => {
  const D210 = `${CONTRACT_210} (D-PROD-210)`;
  // Produção hoje: as nove CONTRACT anteriores concluídas (a D-PROD-209 por último); a D-PROD-210 é a única CONTRACT pendente.
  const ANTERIORES = [CONTRACT_162, CONTRACT_183, CONTRACT_187, CONTRACT_194, CONTRACT_195, CONTRACT_196, CONTRACT_198, CONTRACT_208, CONTRACT_209];
  const PRODUCAO = () => ANTERIORES.map((n) => concluida(n));
  const remoto = (autorizado) => ({ [VARIAVEL_DE_MIGRATION]: ALVO_REMOTO, ...(autorizado === undefined ? {} : { MIGRATION_CONTRACT_AUTORIZADO: autorizado }) });

  test('B22-1 sem a decisão exata → recusa citando só a D-PROD-210, sem URL', async () => {
    for (const autorizado of [undefined, '', 'D-PROD-200', 'D-PROD-203', 'D-PROD-206', 'D-PROD-207', 'D-PROD-208', 'D-PROD-209', 'd-prod-210', ' D-PROD-210', 'D-PROD-2100']) {
      const r = await rodarBarreiraContract(remoto(autorizado), PRODUCAO, { sem210: true });
      assert.equal(r.pode, false, String(autorizado));
      assert.equal(r.leu, 1);
      assert.match(r.texto, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.texto.includes(D210), r.texto);
      for (const anterior of ANTERIORES) assert.ok(!r.texto.includes(anterior), `${anterior} já está concluída:\n${r.texto}`);
      assert.ok(!r.texto.includes(SENHA_FIXTURE) && !r.texto.includes('@'), r.texto);
    }
  });

  test('B22-2 com MIGRATION_CONTRACT_AUTORIZADO = D-PROD-210 → segue; já concluída → segue sem a variável', async () => {
    const r = await rodarBarreiraContract(remoto('D-PROD-210'), PRODUCAO, { sem210: true });
    assert.equal(r.pode, true);
    assert.ok(r.texto.includes(`CONTRACT autorizado: ${D210}`), r.texto);
    const depois = await rodarBarreiraContract(remoto(undefined), () => [...PRODUCAO(), concluida(CONTRACT_210)], { sem210: true });
    assert.equal(depois.pode, true);
  });

  test('B22-3 pendente junto de outra CONTRACT → recusa com qualquer decisão; aberta ou revertida continua pendente', async () => {
    const semDuzentos = () => ANTERIORES.filter((n) => n !== CONTRACT_198).map((n) => concluida(n));
    for (const decisao of ['D-PROD-210', 'D-PROD-200', undefined]) {
      const r = await rodarBarreiraContract(remoto(decisao), semDuzentos, { sem210: true });
      assert.equal(r.pode, false, String(decisao));
    }
    for (const linha of [concluida(CONTRACT_210, { finished_at: null }), concluida(CONTRACT_210, { rolled_back_at: new Date() })]) {
      const r = await rodarBarreiraContract(remoto(undefined), () => [...PRODUCAO(), linha], { sem210: true });
      assert.equal(r.pode, false);
      assert.ok(r.texto.includes(D210), r.texto);
    }
  });
});
