#!/usr/bin/env node
/**
 * Runner dos testes de backend.
 *
 * Antes de rodar teste, garante três coisas — nesta ordem:
 *
 *  1. o schema Prisma é VÁLIDO (`prisma validate`);
 *  2. o client está gerado (`prisma generate`);
 *  3. as migrations foram aplicadas no banco alvo (`migrate deploy`).
 *
 * O passo 1 existia como script no `package.json` desde a P3, mas ninguém o
 * executava na cadeia de certificação — `generate` e `migrate deploy` rodavam
 * direto. Um schema inválido falharia mais adiante, com mensagem pior. Agora
 * ele é obrigatório e a falha para a cadeia (P3-R1/B5).
 *
 * O passo 2 é o **smoke de migration**: o banco da CI nasce vazio a cada job,
 * então cada execução prova, de graça, que `banco vazio → migrate deploy →
 * schema disponível` funciona. Se a migration quebrar, os testes nem começam, e
 * a mensagem diz que foi a migration — não um teste aleatório.
 *
 * Desde a DEPLOY-MIGRATION-01 esse passo NÃO chama `prisma migrate deploy`
 * direto: chama `npm run deploy:migrate`, o mesmo runner que o pre-deploy do
 * Railway vai executar. A diferença importa. Antes, a CI provava que "o Prisma
 * consegue migrar"; agora prova que **o nosso caminho de produção** consegue
 * migrar. Um runner que exigisse a variável errada, ou que engolisse o erro,
 * passaria despercebido enquanto a CI chamasse o primitive por fora.
 *
 * `MIGRATION_DATABASE_URL` recebe aqui a `DATABASE_URL` do PostgreSQL efêmero.
 * É apropriado: o banco descartável não tem pooler, é local ao job, e some com
 * ele. Nenhuma produção é tocada.
 *
 * Sem `DATABASE_URL` o runner **falha**, em vez de pular em silêncio. Suíte que
 * se auto-desliga quando falta configuração é pior que suíte ausente: ela
 * reporta verde sem ter verificado nada.
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'backend/tests';
const SCHEMA = 'backend/prisma/schema.prisma';

const falhar = (mensagem) => {
  console.error(`test:backend — FALHOU\n\n  ${mensagem}\n`);
  process.exit(1);
};

if (!process.env.DATABASE_URL) {
  falhar(
    'DATABASE_URL ausente. Os testes de backend rodam contra PostgreSQL real — não há modo mock.\n' +
      '  Local:  npm run db:up  e  export DATABASE_URL=...  (ver .env.example)\n' +
      '  CI:     o serviço postgres do workflow define a variável.'
  );
}

if (!process.env.AUTH_SECRET) {
  falhar('AUTH_SECRET ausente. O backend não emite sessão sem segredo configurado.');
}

if (!existsSync(SCHEMA)) falhar(`schema Prisma ausente: ${SCHEMA}`);
if (!existsSync(DIR)) falhar(`diretório de testes não encontrado: ${DIR}`);

const executar = (rotulo, comando, args) => {
  const r = spawnSync(comando, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  const status = r.status === null ? 1 : r.status;
  if (status !== 0) falhar(`${rotulo} falhou com exit ${status}`);
};

/** Igual ao anterior, com variáveis extras só para o subprocesso. */
const executarComAmbiente = (rotulo, comando, args, extras) => {
  const r = spawnSync(comando, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extras },
  });
  const status = r.status === null ? 1 : r.status;
  if (status !== 0) falhar(`${rotulo} falhou com exit ${status}`);
};

console.log('test:backend — validando schema Prisma');
executar('prisma validate', 'npx', ['prisma', 'validate', '--schema', SCHEMA]);

console.log('test:backend — gerando Prisma Client');
executar('prisma generate', 'npx', ['prisma', 'generate', '--schema', SCHEMA]);

console.log('test:backend — aplicando migrations pelo runner de deploy (smoke de banco vazio)');
executarComAmbiente(
  'deploy:migrate',
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'deploy:migrate'],
  { MIGRATION_DATABASE_URL: process.env.DATABASE_URL }
);

const arquivos = readdirSync(DIR)
  .filter((nome) => nome.endsWith('.test.mjs'))
  .sort()
  .map((nome) => join(DIR, nome));

if (arquivos.length === 0) falhar(`nenhum teste encontrado em ${DIR}`);

console.log(
  `test:backend — ${arquivos.length} arquivo(s): ${arquivos.map((f) => f.split('/').pop()).join(', ')}`
);

/**
 * `--test-concurrency=1` é obrigatório, não preferência de velocidade.
 *
 * Os testes de backend rodam contra **um** PostgreSQL e limpam as tabelas entre
 * casos (`limparBanco`). Com mais de um arquivo, o runner do Node paraleliza por
 * arquivo por padrão — e aí o `deleteMany` de um apaga as linhas que o outro
 * acabou de criar. O sintoma é um erro de Prisma em testes que não têm defeito
 * nenhum, e que passam quando executados sozinhos: o pior tipo de vermelho,
 * porque parece bug de código e é corrida de infraestrutura.
 *
 * A alternativa seria um schema por arquivo. Custa mais e não paga: a suíte
 * inteira roda em segundos.
 */
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...arquivos], {
  stdio: 'inherit',
});
process.exit(r.status === null ? 1 : r.status);
