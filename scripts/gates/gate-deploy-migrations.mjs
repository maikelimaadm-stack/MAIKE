#!/usr/bin/env node
/**
 * Gate: barreira de migrations do deploy (DEPLOY-MIGRATION-01, D-PROD-28).
 *
 * Absoluto, como `gate:tenancy`, `gate:native-api` e `gate:setor-native`: sem
 * `--update`, sem baseline, sem correção automática, e nunca escreve arquivo.
 *
 * Ele existe porque a barreira é do tipo que apodrece em silêncio. Nada quebra
 * em vermelho quando alguém:
 *
 *  - troca `deploy:migrate` por `prisma migrate deploy` direto, perdendo a
 *    validação da conexão;
 *  - acrescenta `|| DATABASE_URL` "para não falhar em dev";
 *  - move a migration para dentro do `backend:start`, que parece prático;
 *  - faz o runner de teste chamar o primitive por fora, contornando o caminho
 *    que produção usa.
 *
 * Nenhuma dessas mudanças reprova teste nenhum. Todas reabrem exatamente o
 * defeito que a D-PROD-28 fecha.
 *
 * Códigos:
 *   P28-DEPLOY-RUNNER · P28-DEPLOY-SCRIPTS · P28-DEPLOY-STARTUP
 *   P28-DEPLOY-CI · P28-DEPLOY-ENV · P28-DEPLOY-ACTIVATION
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.env.DEPLOY_MIGRATIONS_ROOT || process.cwd();

const RUNNER = 'scripts/deploy/run-migrations.mjs';
const PACKAGE = 'package.json';
const ENV_EXAMPLE = '.env.example';
const TEST_RUNNER = 'scripts/tests/run-backend-tests.mjs';
const BACKEND_SRC = 'backend/src';
const DOC_ATIVACAO = 'docs/engineering/DEPLOY-MIGRATION-01-PRODUCTION-MIGRATION-BARRIER-REPORT.md';

const VARIAVEL = 'MIGRATION_DATABASE_URL';
const SCRIPT_DEPLOY = 'deploy:migrate';
const SCRIPT_PRIMITIVE = 'prisma:deploy';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');

/**
 * Remove comentário de bloco e de linha.
 *
 * Sem isto o gate viraria scanner ingênuo contra a própria documentação: este
 * repositório explica em prosa exatamente as formas proibidas — "nunca
 * `|| DATABASE_URL`", "não rode `migrate dev` em produção" — e um `grep` cru
 * reprovaria o texto escrito para impedir o defeito. É a quinta vez que o
 * projeto encara essa armadilha; ver GATE-REGISTRY.
 */
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Arquivos de código de um diretório, recursivo.
 *
 * `.jsx` está aqui porque a primeira versão varria só `.js`/`.mjs` — e o
 * frontend deste repositório é majoritariamente `.jsx`. Um componente citando
 * a conexão de banco passaria batido, que é exatamente o que a regra existe
 * para pegar. Achado pela prova DGM-09c.
 */
const listarFontes = (dirRel) => {
  const base = caminho(dirRel);
  if (!existsSync(base)) return [];
  const encontrados = [];
  const andar = (atual) => {
    for (const nome of readdirSync(atual)) {
      const completo = join(atual, nome);
      if (statSync(completo).isDirectory()) {
        if (nome === 'node_modules' || nome === '.git') continue;
        andar(completo);
        continue;
      }
      if (/\.(js|jsx|mjs|cjs)$/.test(nome)) encontrados.push(relative(ROOT, completo).split('\\').join('/'));
    }
  };
  andar(base);
  return encontrados;
};

const lerPackage = () => {
  try {
    return JSON.parse(ler(PACKAGE));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// DM-G01 · P28-DEPLOY-RUNNER — o runner exige a conexão certa e não inventa uma
// ---------------------------------------------------------------------------

const verificarRunner = () => {
  if (!existe(RUNNER)) {
    registrar('P28-DEPLOY-RUNNER', `${RUNNER} não encontrado: não existe barreira de migration`);
    return;
  }

  const codigo = semComentarios(ler(RUNNER));

  // Precisa LER a variável própria. Sem isto o resto da regra é decorativo.
  if (!codigo.includes(VARIAVEL)) {
    registrar('P28-DEPLOY-RUNNER', `${RUNNER} não lê ${VARIAVEL}`);
  }

  // Fallback silencioso é o defeito principal que este gate fecha: em produção
  // a variável ausente passaria a usar a conexão da aplicação e "funcionaria"
  // até travar no meio de um ALTER TABLE.
  const fallback = [
    new RegExp(`${VARIAVEL}\\s*(\\|\\||\\?\\?)`),
    new RegExp(`(\\|\\||\\?\\?)\\s*[A-Za-z_.\\[\\]'"]*DATABASE_URL`),
  ];
  for (const padrao of fallback) {
    if (padrao.test(codigo)) {
      registrar(
        'P28-DEPLOY-RUNNER',
        `${RUNNER} faz fallback para DATABASE_URL: ausência de ${VARIAVEL} tem de ser falha dura`
      );
      break;
    }
  }

  // O runner termina no primitive versionado, e não numa segunda implementação
  // de `migrate deploy` com outras flags.
  if (!codigo.includes(SCRIPT_PRIMITIVE)) {
    registrar('P28-DEPLOY-RUNNER', `${RUNNER} não executa o script ${SCRIPT_PRIMITIVE}`);
  }

  // Comandos que não podem existir no caminho de produção, em forma nenhuma.
  for (const proibido of ['migrate dev', 'db push', 'migrate reset', 'db seed']) {
    if (codigo.includes(proibido)) {
      registrar('P28-DEPLOY-RUNNER', `${RUNNER} cita "${proibido}": proibido no caminho de deploy`);
    }
  }

  // A recusa do pooler de transação precisa ser mecanicamente demonstrável.
  if (!/6543/.test(codigo)) {
    registrar(
      'P28-DEPLOY-RUNNER',
      `${RUNNER} não recusa a porta 6543: o pooler de transação não sustenta migration`
    );
  }
};

// ---------------------------------------------------------------------------
// DM-G02 · P28-DEPLOY-SCRIPTS — os scripts apontam para onde dizem apontar
// ---------------------------------------------------------------------------

const verificarScripts = () => {
  const pacote = lerPackage();
  if (!pacote) {
    registrar('P28-DEPLOY-SCRIPTS', `${PACKAGE} ilegível`);
    return;
  }

  const scripts = pacote.scripts || {};

  const deploy = scripts[SCRIPT_DEPLOY];
  if (!deploy) {
    registrar('P28-DEPLOY-SCRIPTS', `${PACKAGE} não declara o script ${SCRIPT_DEPLOY}`);
  } else if (!deploy.includes(RUNNER)) {
    registrar(
      'P28-DEPLOY-SCRIPTS',
      `${SCRIPT_DEPLOY} não aponta para ${RUNNER}: a barreira seria contornada pelo próprio script`
    );
  }

  const primitive = scripts[SCRIPT_PRIMITIVE];
  if (!primitive) {
    registrar('P28-DEPLOY-SCRIPTS', `${PACKAGE} não declara o script ${SCRIPT_PRIMITIVE}`);
  } else {
    if (!/prisma\s+migrate\s+deploy/.test(primitive)) {
      registrar(
        'P28-DEPLOY-SCRIPTS',
        `${SCRIPT_PRIMITIVE} precisa ser "prisma migrate deploy" — encontrado outro comando`
      );
    }
    for (const proibido of ['migrate dev', 'db push', 'migrate reset']) {
      if (primitive.includes(proibido)) {
        registrar(
          'P28-DEPLOY-SCRIPTS',
          `${SCRIPT_PRIMITIVE} executa "${proibido}": destrutivo ou interativo, nunca em produção`
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// DM-G03 · P28-DEPLOY-STARTUP — migration não é startup
// ---------------------------------------------------------------------------

const verificarStartup = () => {
  const pacote = lerPackage();
  const start = pacote?.scripts?.['backend:start'];

  if (start && /(prisma|migrate|deploy:migrate|db push)/.test(start)) {
    registrar(
      'P28-DEPLOY-STARTUP',
      `backend:start executa migration: schema e processo têm lifecycles diferentes (D-PROD-28)`
    );
  }

  // Nenhum arquivo do backend pode disparar migration: com réplicas, cada
  // processo tentaria migrar no boot, e falha viraria crash-loop em vez de
  // erro claro.
  for (const rel of listarFontes(BACKEND_SRC)) {
    const codigo = semComentarios(ler(rel));
    for (const proibido of ['migrate deploy', 'migrate dev', 'db push', 'deploy:migrate']) {
      if (codigo.includes(proibido)) {
        registrar(
          'P28-DEPLOY-STARTUP',
          `${rel} dispara migration ("${proibido}"): o processo do backend não migra`
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// DM-G04 · P28-DEPLOY-CI — a CI exercita o caminho de produção
// ---------------------------------------------------------------------------

const verificarCI = () => {
  if (!existe(TEST_RUNNER)) {
    registrar('P28-DEPLOY-CI', `${TEST_RUNNER} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(TEST_RUNNER));

  // O ponto inteiro: a CI tem de provar que O NOSSO runner migra, não que o
  // Prisma migra. Chamar o primitive por fora devolveria a prova ao nível
  // anterior sem quebrar nada.
  if (!codigo.includes(SCRIPT_DEPLOY)) {
    registrar(
      'P28-DEPLOY-CI',
      `${TEST_RUNNER} não usa ${SCRIPT_DEPLOY}: a CI voltaria a provar o Prisma, não a barreira`
    );
  }

  if (/prisma['"\s,\]]*.*migrate['"\s,\]]*.*deploy/.test(codigo)) {
    registrar(
      'P28-DEPLOY-CI',
      `${TEST_RUNNER} chama "prisma migrate deploy" direto, contornando ${SCRIPT_DEPLOY}`
    );
  }
};

// ---------------------------------------------------------------------------
// DM-G05 · P28-DEPLOY-ENV — a variável é server-only e documentada
// ---------------------------------------------------------------------------

const verificarEnv = () => {
  if (!existe(ENV_EXAMPLE)) {
    registrar('P28-DEPLOY-ENV', `${ENV_EXAMPLE} não encontrado`);
  } else {
    const exemplo = ler(ENV_EXAMPLE);
    if (!new RegExp(`^${VARIAVEL}=\\s*$`, 'm').test(exemplo)) {
      registrar(
        'P28-DEPLOY-ENV',
        `${ENV_EXAMPLE} precisa declarar ${VARIAVEL}= sem valor: ninguém configura o que não está documentado`
      );
    }
  }

  // `VITE_` publica no bundle. Prefixar esta variável exporia a conexão de
  // administração do banco a qualquer visitante do site.
  for (const rel of [ENV_EXAMPLE, PACKAGE, RUNNER, TEST_RUNNER].filter(existe)) {
    if (new RegExp(`VITE_[A-Z_]*(${VARIAVEL}|DATABASE_URL)`).test(ler(rel))) {
      registrar(
        'P28-DEPLOY-ENV',
        `${rel} introduz variável VITE_ de banco: conexão de banco nunca vai para o bundle`
      );
    }
  }

  for (const rel of listarFontes('src')) {
    if (semComentarios(ler(rel)).includes(VARIAVEL)) {
      registrar('P28-DEPLOY-ENV', `${rel} cita ${VARIAVEL}: o frontend não conhece conexão de banco`);
    }
  }
};

// ---------------------------------------------------------------------------
// DM-G06 · P28-DEPLOY-ACTIVATION — a instrução de ativação não pode driftar
// ---------------------------------------------------------------------------

const verificarAtivacao = () => {
  // Não existe arquivo de configuração da plataforma neste repositório, e isso
  // é deliberado: o Config as Code do Railway (`railway.json`/`railway.toml`)
  // está DEPRECIADO, com corte duro em 2026-12-01, e serviços novos não podem
  // mais aderir. Um arquivo que a plataforma vai parar de ler — ou que o
  // serviço sequer consegue adotar — daria a aparência de barreira sem ser uma.
  //
  // O que o repositório PODE garantir é que a instrução de ativação exista e
  // continue nomeando o script certo. Renomear `deploy:migrate` sem atualizar
  // a instrução deixaria o proprietário configurando um comando inexistente.
  if (!existe(DOC_ATIVACAO)) {
    registrar(
      'P28-DEPLOY-ACTIVATION',
      `${DOC_ATIVACAO} não encontrado: a barreira do repositório não tem instrução de ativação`
    );
    return;
  }

  const doc = ler(DOC_ATIVACAO);

  if (!doc.includes(`npm run ${SCRIPT_DEPLOY}`)) {
    registrar(
      'P28-DEPLOY-ACTIVATION',
      `${DOC_ATIVACAO} não nomeia "npm run ${SCRIPT_DEPLOY}": a instrução de ativação driftou do script`
    );
  }

  if (!new RegExp(VARIAVEL).test(doc)) {
    registrar('P28-DEPLOY-ACTIVATION', `${DOC_ATIVACAO} não instrui a configurar ${VARIAVEL}`);
  }
};

// ---------------------------------------------------------------------------

verificarRunner();
verificarScripts();
verificarStartup();
verificarCI();
verificarEnv();
verificarAtivacao();

if (falhas.length > 0) {
  console.error('gate:deploy-migrations — REPROVOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  console.error(`\n  ${falhas.length} violação(ões) da barreira de migrations.`);
  console.error('  O gate é absoluto: não existe --update, baseline nem correção automática.');
  process.exit(1);
}

console.log(
  'gate:deploy-migrations — PASSOU ' +
    '(runner exige conexão própria sem fallback e recusa o pooler de transação; ' +
    'scripts apontam para o runner; migration fora do startup; ' +
    'a CI exercita o caminho de produção; variável server-only e documentada; ' +
    'instrução de ativação sincronizada)'
);
