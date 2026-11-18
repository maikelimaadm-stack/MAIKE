/**
 * D-PROD-238 — os testes de migration ANTIGOS rodam "no dia da D-PROD-223" (`20261117300000_descanso_e_alturas_por_area`,
 * a última aplicada em produção antes da CONTRACT das áreas da atividade, `20261118100000_atividade_areas`).
 *
 * Por quê: esses testes aplicam pelo runner oficial "tudo o que pende" e comparam o banco com o `schema.prisma`. Com a
 * D-PROD-238 no repositório, o runner do repositório passa a ter mais uma CONTRACT pendente (que ele nunca aplica junto
 * de outra) e o `schema.prisma` passa a ter a tabela AtividadeArea e a coluna do lançamento. Como nos espelhos da
 * D-PROD-208 (`espelhoDoRunner.mjs`), o teste antigo continua provando o que provava, na ordem de produção: o runner
 * vem de um ESPELHO com as pastas até a D-PROD-223 e o schema do `migrate diff` / `migrate status` é o do espelho — o
 * `schema.prisma` de hoje SEM o que a D-PROD-238 acrescentou (o model AtividadeArea, a coluna, a relação e o índice da
 * área no lançamento e as relações inversas). A D-PROD-238 tem a prova própria em `atividadeAreasMigration.test.mjs`.
 *
 * O espelho é criado uma vez por processo (na primeira chamada) e apagado na saída do processo.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarEspelhoDoRunner } from './espelhoDoRunner.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A última migration de produção antes da D-PROD-238 (o "dia" destes testes). */
export const ATE_D223 = '20261117300000_descanso_e_alturas_por_area';
/** A CONTRACT das áreas da atividade (D-PROD-238), fora do "dia" destes testes. */
export const NOME_ATIVIDADE_AREAS = '20261118100000_atividade_areas';

/** Só as pastas do dia da D-PROD-223. @param {string[]} nomes */
export const ateD223 = (nomes) => nomes.filter((n) => n <= ATE_D223);

/**
 * O `schema.prisma` de hoje sem o que a D-PROD-238 acrescentou: o model AtividadeArea (e a documentação dele), toda
 * linha que cita `AtividadeArea` ou `atividade_area_id` e as linhas `///` logo acima delas.
 * @param {string} schema
 */
export const schemaSemAreasDaAtividade = (schema) => {
  const linhas = schema.split('\n');
  const sai = new Array(linhas.length).fill(false);
  for (let i = 0; i < linhas.length; i += 1) {
    if (/^model AtividadeArea \{/.test(linhas[i])) {
      let j = i;
      while (j < linhas.length && linhas[j].trim() !== '}') sai[j++] = true;
      sai[j] = true;
      i = j;
      continue;
    }
    if (/AtividadeArea\b|atividade_area_id/.test(linhas[i])) sai[i] = true;
  }
  for (let i = linhas.length - 1; i > 0; i -= 1) {
    if (sai[i] && /^\s*\/\/\//.test(linhas[i - 1])) sai[i - 1] = true;
    if (sai[i] && /^\s*\/\/ D-PROD-238/.test(linhas[i - 1])) sai[i - 1] = true;
  }
  return linhas.filter((_, i) => !sai[i]).join('\n');
};

let espelho = null;
/** O diretório do espelho do runner até a D-PROD-223, com o schema do dia dela. */
export const espelhoDoDiaD223 = () => {
  if (espelho) return espelho;
  espelho = criarEspelhoDoRunner({ raiz: RAIZ, ate: ATE_D223 }).dir;
  const destino = join(espelho, 'backend', 'prisma', 'schema.prisma');
  writeFileSync(destino, schemaSemAreasDaAtividade(readFileSync(join(RAIZ, 'backend', 'prisma', 'schema.prisma'), 'utf8')));
  const dir = espelho;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return espelho;
};

/** O schema do dia da D-PROD-223 (no espelho, junto das pastas até ela: `migrate status` lê as pastas ao lado). */
export const schemaDoDiaD223 = () => join(espelhoDoDiaD223(), 'backend', 'prisma', 'schema.prisma');
