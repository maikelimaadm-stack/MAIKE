#!/usr/bin/env node
/**
 * Runner dos testes de backend.
 *
 * Antes de rodar teste, garante duas coisas — nesta ordem:
 *
 *  1. o schema Prisma é válido e o client está gerado;
 *  2. as migrations foram aplicadas no banco alvo (`migrate deploy`).
 *
 * O passo 2 é o **smoke de migration**: o banco da CI nasce vazio a cada job,
 * então cada execução prova, de graça, que `banco vazio → migrate deploy →
 * schema disponível` funciona. Se a migration quebrar, os testes nem começam, e
 * a mensagem diz que foi a migration — não um teste aleatório.
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

console.log('test:backend — gerando Prisma Client');
executar('prisma generate', 'npx', ['prisma', 'generate', '--schema', SCHEMA]);

console.log('test:backend — aplicando migrations (smoke de banco vazio)');
executar('prisma migrate deploy', 'npx', ['prisma', 'migrate', 'deploy', '--schema', SCHEMA]);

const arquivos = readdirSync(DIR)
  .filter((nome) => nome.endsWith('.test.mjs'))
  .sort()
  .map((nome) => join(DIR, nome));

if (arquivos.length === 0) falhar(`nenhum teste encontrado em ${DIR}`);

console.log(
  `test:backend — ${arquivos.length} arquivo(s): ${arquivos.map((f) => f.split('/').pop()).join(', ')}`
);

const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
