#!/usr/bin/env node
/**
 * Barreira de migrations do deploy (DEPLOY-MIGRATION-01, D-PROD-28).
 *
 * ─── O que este arquivo existe para impedir ────────────────────────────────
 *
 * Que código novo entre em execução antes do schema que ele espera existir.
 *
 * Até aqui, a aplicação das migrations em produção foi **manual**: a tabela
 * `Setor` (P4.1) e o default de `Setor.tipo` (P4.1-R2) foram aplicados à mão,
 * e a segunda ficou dias no repositório sem estar no banco. Com uma capacidade
 * por vez isso é um incômodo; com uma onda de domínio inteira, é a garantia de
 * que em algum deploy o código chega antes da tabela.
 *
 * ─── Por que migration NÃO roda no startup ─────────────────────────────────
 *
 * A tentação óbvia é chamar `migrate deploy` no `server.js`. Não fazemos, e o
 * motivo não é estético:
 *
 *  - o lifecycle do schema passaria a ser o lifecycle do processo. Todo
 *    restart, todo crash-loop, todo scale-up tentaria migrar;
 *  - com mais de uma réplica, N processos disputam a mesma tarefa ao mesmo
 *    tempo. O advisory lock do Prisma evita corrupção, mas transforma o start
 *    numa fila — e o healthcheck não espera fila;
 *  - falha de migration viraria falha de boot, que o orquestrador trata como
 *    "reinicie", produzindo um loop em vez de um erro claro;
 *  - o deploy anterior, saudável, seria substituído antes de alguém saber que
 *    o schema não subiu.
 *
 * Aplicar schema e servir tráfego são estágios diferentes. Este runner é o
 * primeiro; `backend:start` é o segundo. O `gate:deploy-migrations` prova que
 * eles não se misturam.
 *
 * ─── Por que uma variável própria ──────────────────────────────────────────
 *
 * `MIGRATION_DATABASE_URL`, e **nunca** um fallback para `DATABASE_URL`.
 *
 * As duas conexões têm requisitos diferentes. A aplicação pode falar por um
 * pooler de transação, otimizado para muitas conexões curtas. A migration não:
 * ela roda DDL em transação longa, com advisory lock, e precisa de uma sessão
 * de verdade.
 *
 * Fallback silencioso seria o pior dos mundos: em produção, onde a variável
 * estivesse ausente, o runner usaria a conexão da aplicação e "funcionaria" —
 * até o dia em que travasse no meio de um `ALTER TABLE`, com o deploy pela
 * metade. Ausência é falha dura, e é dura de propósito.
 *
 * ─── O que este runner nunca imprime ───────────────────────────────────────
 *
 * Nenhuma URL, nenhum host, nenhuma porta, nenhum usuário, nenhuma senha —
 * nem mascarada. Uma senha "mascarada" com pedaço visível é uma senha vazada
 * mais devagar. Em erro de validação sai o código estável e uma frase; quem
 * precisa do valor tem acesso ao painel, não ao log.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { motivoAlvoProtegido } from '../auth/alvoProtegido.mjs';
import { CONSULTA_HISTORICO, conferirAlvos, executorPrisma } from './alvoBancoLib.mjs';
import { contractsPendentes } from './premergeMigrateLib.mjs';

/** Códigos estáveis. Fazem parte do contrato — não renomear sem migrar o gate. */
export const CODIGOS_DEPLOY_MIGRATION = Object.freeze({
  URL_REQUERIDA: 'DEPLOY-MIGRATION-URL-REQUIRED',
  URL_INVALIDA: 'DEPLOY-MIGRATION-URL-INVALID',
  POOLER_INSEGURO: 'DEPLOY-MIGRATION-UNSAFE-POOLER',
  ALVO_NAO_CONFERIDO: 'DEPLOY-MIGRATION-TARGET-UNVERIFIED',
  // D-PROD-161: migration CONTRACT pendente no alvo remoto sem MIGRATION_CONTRACT_AUTORIZADO = decisão.
  CONTRACT_NAO_AUTORIZADO: 'DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED',
});

/** Nome da variável. Server-only: nunca com prefixo `VITE_`. */
export const VARIAVEL_DE_MIGRATION = 'MIGRATION_DATABASE_URL';

const PROTOCOLOS = Object.freeze(['postgres:', 'postgresql:']);

/**
 * Porta do modo de transação do Supavisor (Supabase).
 *
 * É a porta que já quebrou este projeto uma vez: `prisma migrate deploy`
 * apontado para ela ficou pendurado até o deploy ser cancelado à mão. O modo
 * de transação não sustenta prepared statement nem sessão longa, e migration
 * precisa das duas coisas.
 */
const PORTA_POOLER_DE_TRANSACAO = '6543';

const ehHostSupabase = (hostname) =>
  hostname === 'supabase.com' ||
  hostname.endsWith('.supabase.com') ||
  hostname.endsWith('.supabase.co');

/**
 * A URL serve para rodar migration?
 *
 * Devolve o veredito; **não** devolve a URL, e nenhuma mensagem daqui a cita.
 *
 * @param {unknown} valor
 * @returns {{ok: true} | {ok: false, codigo: string, mensagem: string}}
 */
export const validarUrlDeMigration = (valor) => {
  const bruto = typeof valor === 'string' ? valor.trim() : '';

  if (!bruto) {
    return {
      ok: false,
      codigo: CODIGOS_DEPLOY_MIGRATION.URL_REQUERIDA,
      mensagem:
        `${VARIAVEL_DE_MIGRATION} ausente. As migrations de produção não usam a conexão da ` +
        'aplicação: defina a variável no serviço de backend. Não há fallback.',
    };
  }

  let url;
  try {
    url = new URL(bruto);
  } catch {
    return {
      ok: false,
      codigo: CODIGOS_DEPLOY_MIGRATION.URL_INVALIDA,
      mensagem: `${VARIAVEL_DE_MIGRATION} não é uma URL válida.`,
    };
  }

  if (!PROTOCOLOS.includes(url.protocol)) {
    return {
      ok: false,
      codigo: CODIGOS_DEPLOY_MIGRATION.URL_INVALIDA,
      mensagem: `${VARIAVEL_DE_MIGRATION} precisa usar postgres:// ou postgresql://.`,
    };
  }

  if (ehHostSupabase(url.hostname) && url.port === PORTA_POOLER_DE_TRANSACAO) {
    return {
      ok: false,
      codigo: CODIGOS_DEPLOY_MIGRATION.POOLER_INSEGURO,
      mensagem:
        'A porta 6543 do Supabase é o pooler de modo transação, que não sustenta o lock nem a ' +
        'sessão longa de uma migration. Use a conexão de sessão ou a direta, na 5432.',
    };
  }

  return { ok: true };
};

/** Executor padrão: `npm run prisma:deploy`, sem shell. */
const executarPrismaDeploy = (env) => {
  const comando = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(comando, ['run', 'prisma:deploy'], {
    stdio: 'inherit',
    shell: false,
    env,
  });
  // `status === null` significa morte por sinal: é falha, não sucesso.
  return r.status === null ? 1 : r.status;
};

/**
 * Aplica as migrations versionadas.
 *
 * O subprocesso recebe `DATABASE_URL` **substituída** pelo valor de
 * `MIGRATION_DATABASE_URL`. É essa a fronteira: o schema Prisma continua
 * simples, lendo `env("DATABASE_URL")`, e quem decide qual conexão é essa em
 * cada estágio é este runner — não o schema, não o runtime.
 *
 * @param {{env?: NodeJS.ProcessEnv, executar?: (env: NodeJS.ProcessEnv) => number,
 *          log?: (m: string) => void, erro?: (m: string) => void}} [opcoes]
 * @returns {number} código de saída
 */
export const executarMigrationsDeDeploy = ({
  env = process.env,
  executar = executarPrismaDeploy,
  log = console.log,
  erro = console.error,
} = {}) => {
  const veredito = validarUrlDeMigration(env[VARIAVEL_DE_MIGRATION]);

  if (!veredito.ok) {
    erro(`deploy:migrate — FALHOU [${veredito.codigo}]\n\n  ${veredito.mensagem}\n`);
    return 1;
  }

  log('deploy:migrate — aplicando migrations versionadas...');

  const status = executar({
    ...env,
    // Só aqui, e só para o subprocesso. O processo deste runner não é alterado.
    DATABASE_URL: env[VARIAVEL_DE_MIGRATION],
  });

  if (status !== 0) {
    // Sem `catch` que vire sucesso: o deploy precisa parar, e a semântica de
    // pre-deploy do Railway é exatamente "exit != 0 impede o deployment".
    erro(`deploy:migrate — FALHOU: as migrations não foram aplicadas (exit ${status}).`);
    return status;
  }

  log('deploy:migrate — migrations aplicadas.');
  return 0;
};

/** Variável com o `system_identifier` esperado do alvo remoto (não é segredo). */
export const VARIAVEL_DE_ALVO_ESPERADO = 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER';

/** Pastas de migration do repositório (as mesmas que o `prisma migrate deploy` aplica). */
const RAIZ_MIGRATIONS = 'backend/prisma/migrations';

/**
 * Barreira do CONTRACT (D-PROD-161), antes de qualquer DDL.
 *
 * Uma migration CONTRACT (MIGRATIONS_CONTRACT_APROVADAS) APAGA dados: no alvo
 * remoto (ou com `MIGRATION_EXIGIR_CONFERENCIA=sim`) ela só é aplicada se
 * `MIGRATION_CONTRACT_AUTORIZADO` for EXATAMENTE a decisão dela. Só o
 * `premerge-migrate --aplicar --contract <decisão>` define essa variável; um
 * `npm run deploy:migrate` à mão ou o `release-migrate.yml` recusam enquanto o
 * CONTRACT estiver pendente no alvo. Depois de aplicado (linha concluída e não
 * revertida no histórico), nada muda para as releases seguintes. Local e CI
 * seguem livres. Histórico ilegível → falha fechada. Nunca imprime URL.
 *
 * @param {{env?: NodeJS.ProcessEnv, urlMigracao?: string, lerHistorico?: (url: string) => Promise<any[]>,
 *          raiz?: string, log?: (m: string) => void, erro?: (m: string) => void}} [opcoes]
 * @returns {Promise<boolean>} pode migrar?
 */
export const exigirContractAutorizado = async ({
  env = process.env,
  urlMigracao = env[VARIAVEL_DE_MIGRATION],
  lerHistorico = (url) => executorPrisma(url, CONSULTA_HISTORICO),
  raiz = RAIZ_MIGRATIONS,
  log = console.log,
  erro = console.error,
} = {}) => {
  if (!validarUrlDeMigration(urlMigracao).ok) return true; // o runner recusa com o código próprio
  const remoto = motivoAlvoProtegido({}, urlMigracao) !== null;
  if (!remoto && env.MIGRATION_EXIGIR_CONFERENCIA !== 'sim') return true;
  const falhar = (motivo) => {
    erro(`deploy:migrate — FALHOU [${CODIGOS_DEPLOY_MIGRATION.CONTRACT_NAO_AUTORIZADO}]\n\n  ${motivo}\n  Nenhuma migration foi executada.\n`);
    return false;
  };
  let locais;
  try {
    locais = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return falhar('pastas de migration ilegíveis: não dá para saber se há CONTRACT a aplicar.');
  }
  if (!contractsPendentes({ locais, linhas: [] }).length) return true; // nenhuma migration CONTRACT nesta árvore
  let linhas;
  try {
    linhas = await lerHistorico(urlMigracao);
  } catch (e) {
    // Mensagem do driver pode conter host/usuário: só o código sai daqui.
    const codigo = /** @type {any} */ (e)?.code ?? /** @type {any} */ (e)?.errorCode ?? 'erro';
    return falhar(`histórico do alvo ilegível (${codigo}): não dá para provar que a migration CONTRACT já foi aplicada.`);
  }
  const pendentes = contractsPendentes({ locais, linhas });
  const semAutorizacao = pendentes.filter((p) => env.MIGRATION_CONTRACT_AUTORIZADO !== p.decisao);
  if (semAutorizacao.length) {
    return falhar(
      `migration CONTRACT pendente no alvo: ${semAutorizacao.map((p) => `${p.nome} (${p.decisao})`).join(', ')}. ` +
        'Ela apaga dados e só é aplicada pelo premerge-migrate --aplicar --contract <decisão>, com o GO do proprietário ' +
        '(MIGRATION_CONTRACT_AUTORIZADO ausente ou diferente da decisão).'
    );
  }
  if (pendentes.length) log(`deploy:migrate — CONTRACT autorizado: ${pendentes.map((p) => `${p.nome} (${p.decisao})`).join(', ')}.`);
  return true;
};

/** Conexão do runtime exatamente como o backend a resolve (dotenv + prioridade). */
const resolverRuntimeDoBackend = async () => (await import('../../backend/src/config/env.js')).env.databaseUrl;

/**
 * Barreira de ALVO, antes de qualquer DDL (PR145-G4-R1).
 *
 * Banco remoto (ou `MIGRATION_EXIGIR_CONFERENCIA=sim`) só migra se a conexão de
 * migration e a do runtime forem o MESMO banco lógico e o cluster for o
 * esperado em `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`. Local segue como antes.
 * Com o alvo conferido, aplica a barreira do CONTRACT (D-PROD-161).
 *
 * @param {{env?: NodeJS.ProcessEnv, conferir?: typeof conferirAlvos,
 *          resolverRuntime?: () => Promise<string|null|undefined>,
 *          lerHistorico?: (url: string) => Promise<any[]>,
 *          log?: (m: string) => void, erro?: (m: string) => void}} [opcoes]
 * @returns {Promise<boolean>} pode migrar?
 */
export const exigirAlvoConferido = async ({
  env = process.env,
  conferir = conferirAlvos,
  resolverRuntime = resolverRuntimeDoBackend,
  lerHistorico,
  log = console.log,
  erro = console.error,
} = {}) => {
  const urlMigracao = env[VARIAVEL_DE_MIGRATION];
  if (!validarUrlDeMigration(urlMigracao).ok) return true; // o runner recusa com o código próprio
  const remoto = motivoAlvoProtegido({}, urlMigracao) !== null;
  if (!remoto && env.MIGRATION_EXIGIR_CONFERENCIA !== 'sim') return true;
  const falhar = (motivo) => {
    erro(`deploy:migrate — FALHOU [${CODIGOS_DEPLOY_MIGRATION.ALVO_NAO_CONFERIDO}]\n\n  ${motivo}\n  Nenhuma migration foi executada.\n`);
    return false;
  };
  const esperadoSid = (env[VARIAVEL_DE_ALVO_ESPERADO] ?? '').trim();
  if (!esperadoSid) return falhar(`${VARIAVEL_DE_ALVO_ESPERADO} ausente: alvo remoto exige o identificador esperado.`);
  const urlRuntime = await resolverRuntime();
  const v = await conferir({ esperadoSid, urlRuntime, urlMigracao });
  if (!v.ok) return falhar(v.falhas.join('\n  '));
  log(`deploy:migrate — alvo conferido nas duas conexões (${v.resumo}).`);
  return exigirContractAutorizado({ env, urlMigracao, ...(lerHistorico ? { lerHistorico } : {}), log, erro });
};

/* c8 ignore start — entrada de CLI, exercitada pelos testes via a função exportada */
const ehEntradaDireta = () =>
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (ehEntradaDireta()) {
  process.exit((await exigirAlvoConferido()) ? executarMigrationsDeDeploy() : 1);
}
/* c8 ignore stop */
