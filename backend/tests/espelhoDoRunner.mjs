/**
 * D-PROD-208 — o runner oficial (`npm run deploy:migrate`) NO DIA de uma migration antiga: um espelho do repositório
 * com só as pastas de migration até um nome. Os testes de migration que aplicam "tudo o que pende no diretório real"
 * passaram a ter, depois da D-PROD-207, uma CONTRACT posterior (a D-PROD-208) que o runner nunca aplica junto de
 * outra; com o espelho, o GREEN de uma CONTRACT antiga roda como no dia dela, e a D-PROD-208 entra depois, pelo
 * runner do repositório, com a decisão dela (a ordem de produção).
 *
 * O espelho: package.json e os scripts do runner (scripts/deploy e scripts/auth) COPIADOS — por link, o runner não se
 * reconhece como entrada (`import.meta.url` vira o caminho real) —, node_modules e backend/src por link (o runtime do
 * backend é o mesmo), o schema.prisma copiado (o `migrate deploy` só lê o datasource) e as pastas de migration até
 * `ate` (inclusive) com o migration_lock.toml. A barreira do CONTRACT e o `prisma migrate deploy` leem
 * `backend/prisma/migrations` do diretório de trabalho, que é o espelho. Quem cria, apaga (`rmSync`).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @param {{ raiz: string, ate: string }} opcoes raiz do repositório e o nome da última pasta de migration do dia
 * @returns {{ dir: string, pastas: string[] }} o diretório do espelho e as pastas copiadas, em ordem
 */
export const criarEspelhoDoRunner = ({ raiz, ate }) => {
  const migrations = join(raiz, 'backend', 'prisma', 'migrations');
  const pastas = readdirSync(migrations, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().filter((n) => n <= ate);
  if (!pastas.includes(ate)) throw new Error(`espelho do runner: a pasta ${ate} não existe`);
  const dir = mkdtempSync(join(tmpdir(), 'maike-runner-dia-'));
  cpSync(join(raiz, 'package.json'), join(dir, 'package.json'));
  symlinkSync(join(raiz, 'node_modules'), join(dir, 'node_modules'), 'dir');
  for (const d of ['deploy', 'auth']) cpSync(join(raiz, 'scripts', d), join(dir, 'scripts', d), { recursive: true });
  mkdirSync(join(dir, 'backend', 'prisma', 'migrations'), { recursive: true });
  symlinkSync(join(raiz, 'backend', 'src'), join(dir, 'backend', 'src'), 'dir');
  cpSync(join(raiz, 'backend', 'prisma', 'schema.prisma'), join(dir, 'backend', 'prisma', 'schema.prisma'));
  for (const d of pastas) cpSync(join(migrations, d), join(dir, 'backend', 'prisma', 'migrations', d), { recursive: true });
  if (existsSync(join(migrations, 'migration_lock.toml'))) cpSync(join(migrations, 'migration_lock.toml'), join(dir, 'backend', 'prisma', 'migrations', 'migration_lock.toml'));
  return { dir, pastas };
};
