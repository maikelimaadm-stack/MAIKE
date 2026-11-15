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

import { selecionarShard } from '../ci/backend-shards.mjs';

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

/** Igual ao anterior, com variáveis extras só para o subprocesso (e uma dica opcional na falha). */
const executarComAmbiente = (rotulo, comando, args, extras, dica) => {
  const r = spawnSync(comando, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extras },
  });
  const status = r.status === null ? 1 : r.status;
  if (status !== 0) falhar(`${rotulo} falhou com exit ${status}${dica ? `\n\n  ${dica}` : ''}`);
};

/**
 * D-PROD-162 (achado B8): a migration CONTRACT do Patrimônio recusa banco com
 * abastecimento CONFIRMADO e banco com linhas nas tabelas que ela apaga sem a
 * impressão aprovada. A CI nasce vazia e não é afetada; um banco de teste LOCAL
 * com sobras de rodadas antigas (CONFIRMADO, sementes E2E) é. A dica só orienta
 * a recriar o banco local — não muda o código de saída. (`npm run db:down`
 * sozinho NÃO recria: o volume `maike_pgdata` continua; é preciso o `-v`.)
 *
 * D-PROD-183: a migration CONTRACT do Tipo de Tarefa apaga as 4 colunas
 * dormentes (exige_area, pode_ter_produto, pode_ter_maquina e
 * pode_ter_implemento) e, com algum valor true nelas, exige a impressão
 * aprovada no GO (maike.tipo_tarefa_flags_impressao). A CI nasce vazia e não é
 * afetada; um banco LOCAL com TipoTarefa de rodadas antigas com flags true é.
 * As mensagens dessa guarda começam com `tipo_tarefa_drop_colunas:` (o número
 * da decisão fica fora do migration.sql). O remédio é o mesmo: recriar o banco local.
 *
 * D-PROD-187: a migration CONTRACT da Categoria de Manejo apaga as 15 colunas
 * dormentes e o vínculo com o ícone oficial (catalogo_categoria_visual_id) e
 * renomeia a tabela para CADCATEGORIA. Com algum valor nessas 16 colunas, ela
 * exige a impressão aprovada no GO (maike.categoria_manejo_legado_impressao);
 * com um objeto de fora (índice, visão, função) na tabela, recusa. A CI nasce
 * vazia; um banco LOCAL com CategoriaManejo de rodadas antigas pode não estar.
 * As mensagens começam com `categoria_manejo_cadcategoria:`. Mesmo remédio.
 *
 * D-PROD-194: a migration CONTRACT da Curva de Ganho apaga e recria a tabela
 * CADCURVAGANHO (12 GMD mensais no lugar dos 3 por estação) e só a aceita
 * VAZIA, com a estrutura por estação. A CI nasce vazia e não é afetada; um
 * banco LOCAL com curvas de rodadas antigas em CADCURVAGANHO (estrutura por
 * estação) faz a guarda recusar. As mensagens dessa guarda começam com
 * `cadcurvaganho_mensal:`. O remédio é o mesmo: recriar o banco local.
 *
 * D-PROD-195: a migration CONTRACT da curva na Categoria de Manejo cria
 * CADCATEGORIA.curva_ganho_id NOT NULL e liga cada categoria que já existe à
 * curva chamada 'CURVA PADRÃO' da própria fazenda. A guarda recusa se alguma
 * fazenda com categoria não tiver exatamente uma CURVA PADRÃO. A CI nasce vazia
 * e não é afetada; um banco LOCAL com categorias de rodadas antigas e sem a
 * CURVA PADRÃO na fazenda delas é. As mensagens começam com
 * `cadcategoria_curva_ganho:`. O remédio é o mesmo: recriar o banco local.
 *
 * D-PROD-197: a migration CONTRACT do Tipo de Atividade só ACRESCENTA (5
 * padrões, 8 flags, 3 FKs, 2 CHECKs e 3 índices em TipoAtividade) e recusa se
 * qualquer coluna, constraint ou índice novo já existir. A CI nasce vazia; um
 * banco LOCAL que já recebeu as colunas por fora (`prisma db push` com o schema
 * novo, rodada interrompida) faz a guarda recusar. As mensagens começam com
 * `tipo_atividade_defaults:`. Mesmo remédio: recriar o banco local.
 *
 * D-PROD-200: a migration CONTRACT da Atividade cabeçalho converte cada
 * ApontamentoAtividade numa Atividade com um AtividadeApontamento e apaga as 3
 * tabelas antigas. A guarda recusa se houver item de custo ou fatia FIFO no
 * apontamento antigo, apontamento com implemento, hora ou horas trabalhadas,
 * status fora de CONFIRMADO/CANCELADO, contador da entidade Atividade, ou se as
 * tabelas novas já existirem. A CI nasce vazia; um banco LOCAL com apontamentos
 * de rodadas antigas (itens, horas) faz a guarda recusar. As mensagens começam
 * com `guarda:` e a saída do Prisma cita `20261114500000_atividade_cabecalho`.
 * Mesmo remédio: recriar o banco local.
 *
 * D-PROD-208: a migration CONTRACT do funcionário como papel do parceiro só roda
 * com Funcionario e AtividadeApontamentoMaoObra VAZIAS. Um banco LOCAL que já
 * rodou a suíte da Fatia 4 (D-PROD-207) tem funcionários e linhas de mão de obra
 * e a guarda recusa (`guarda: "Funcionario" tem linhas`; a saída do Prisma cita
 * `20261116000000_mao_obra_parceiro`). Mesmo remédio: recriar o banco local.
 */
const DICA_BANCO_LOCAL_COM_SOBRAS =
  'Se a saída acima cita D-PROD-162, o banco de teste local tem sobras de rodadas antigas: ' +
  'recrie-o (docker compose down -v && npm run db:up, que apaga o volume LOCAL do docker-compose; ' +
  'ou dropdb/createdb do banco de teste) e rode de novo. ' +
  'Se cita tipo_tarefa_drop_colunas (a CONTRACT da D-PROD-183), o mais provável é o banco local ter TipoTarefa ' +
  'de rodadas antigas com alguma das 4 flags (exige_area, pode_ter_produto, pode_ter_maquina, pode_ter_implemento) ' +
  'em true, e a guarda exigir a impressão aprovada no GO; a mensagem da guarda diz o motivo exato. ' +
  'Recriar o banco local, do mesmo jeito, resolve. ' +
  'Se cita categoria_manejo_cadcategoria (a CONTRACT da D-PROD-187), o banco local tem CategoriaManejo de rodadas ' +
  'antigas com valor em alguma das 16 colunas apagadas (raca, categoria_oficial, ganho_peso_anual_kg, gmd_*, ' +
  'catalogo_categoria_visual_id) ou algum objeto de fora na tabela; a mensagem da guarda diz o motivo exato. ' +
  'Recriar o banco local também resolve. ' +
  'Se cita cadcurvaganho_mensal (a CONTRACT da D-PROD-194), o mais provável é o banco local ter curvas de ganho ' +
  'de rodadas antigas em CADCURVAGANHO (estrutura por estação: gmd_aguas, gmd_transicao, gmd_seca), e a guarda só ' +
  'aceitar a tabela vazia; a mensagem da guarda diz o motivo exato. Recriar o banco local, do mesmo jeito, resolve. ' +
  'Se cita cadcategoria_curva_ganho (a CONTRACT da D-PROD-195), o banco local tem categorias de manejo de rodadas ' +
  'antigas em CADCATEGORIA numa fazenda sem a curva chamada CURVA PADRÃO (ou a coluna curva_ganho_id já existe), e a ' +
  'guarda exige exatamente uma CURVA PADRÃO em cada fazenda com categoria; a mensagem da guarda diz o motivo exato. ' +
  'Recriar o banco local, do mesmo jeito, resolve. ' +
  'Se cita tipo_atividade_defaults (a CONTRACT da D-PROD-197), o banco local já tem alguma coluna, constraint ou índice ' +
  'novo de TipoAtividade (por exemplo, de um prisma db push com o schema novo) e a guarda recusa reaplicar; a mensagem ' +
  'da guarda diz o motivo exato. Recriar o banco local, do mesmo jeito, resolve. ' +
  'Se cita atividade_cabecalho (a CONTRACT da D-PROD-200, mensagens "guarda: …"), o banco local tem apontamentos de ' +
  'atividade de rodadas antigas que o modelo novo não guarda (itens de custo, fatias FIFO, implemento, horas) ou já tem ' +
  'as tabelas Atividade/AtividadeApontamento ou o contador da entidade Atividade; a mensagem da guarda diz o motivo ' +
  'exato. Recriar o banco local, do mesmo jeito, resolve. ' +
  'Se cita mao_obra_parceiro (a CONTRACT da D-PROD-208, mensagens "guarda: …"), o banco local tem funcionários ou ' +
  'linhas de mão de obra de rodadas da Fatia 4 (D-PROD-207), e a guarda só aceita as duas tabelas vazias; recriar o ' +
  'banco local, do mesmo jeito, resolve.';

const todos = readdirSync(DIR)
  .filter((nome) => nome.endsWith('.test.mjs'))
  .sort();

if (todos.length === 0) falhar(`nenhum teste encontrado em ${DIR}`);

/**
 * Seleção ANTES de tocar no banco: shard inválido falha na hora.
 *
 * MAIKE-CI-PARALELO-PR02: `TEST_BACKEND_SHARD=i/n` roda só o i-ésimo de n
 * grupos (scripts/ci/backend-shards.mjs). A CI usa um job por grupo, cada um
 * com PostgreSQL próprio; juntos cobrem todos os arquivos exatamente uma vez.
 * Sem a variável, roda tudo (o uso local e o `verify:all` não mudam).
 */
let selecionados = todos;
if (process.env.TEST_BACKEND_SHARD) {
  try {
    selecionados = selecionarShard(todos, process.env.TEST_BACKEND_SHARD);
  } catch (erro) {
    falhar(erro.message);
  }
  if (selecionados.length === 0) falhar(`shard ${process.env.TEST_BACKEND_SHARD} ficou vazio`);
  console.log(`test:backend — shard ${process.env.TEST_BACKEND_SHARD}: ${selecionados.length} de ${todos.length} arquivo(s)`);
}

const arquivos = selecionados.map((nome) => join(DIR, nome));

console.log('test:backend — validando schema Prisma');
executar('prisma validate', 'npx', ['prisma', 'validate', '--schema', SCHEMA]);

console.log('test:backend — gerando Prisma Client');
executar('prisma generate', 'npx', ['prisma', 'generate', '--schema', SCHEMA]);

console.log('test:backend — aplicando migrations pelo runner de deploy (smoke de banco vazio)');
executarComAmbiente(
  'deploy:migrate',
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'deploy:migrate'],
  { MIGRATION_DATABASE_URL: process.env.DATABASE_URL },
  DICA_BANCO_LOCAL_COM_SOBRAS
);


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
/**
 * D-PROD-122: o ledger do rebanho recusa fato com data posterior a "hoje" no
 * fuso da fazenda. As fixtures usam datas fixas (out–dez/2026); sem relógio
 * determinístico, a suíte dependeria do dia real da máquina. O relógio de
 * teste só existe com NODE_ENV=test (rebanhoLedgerTempo.js) — por isso o
 * runner o define AQUI, só no processo dos testes (nunca no job inteiro: ver
 * quality.yml sobre o build). `MAIKE_TESTE_AGORA` é o instante padrão; cada
 * teste temporal fixa o seu por contexto (`comRelogioDeTeste`).
 */
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...arquivos], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', MAIKE_TESTE_AGORA: process.env.MAIKE_TESTE_AGORA || '2027-06-15T15:00:00.000Z' },
});
process.exit(r.status === null ? 1 : r.status);
