#!/usr/bin/env node
/**
 * Inicialização ÚNICA do MAIKE (PR145-G4, D-PROD-73): apaga os dados de TESTE
 * de todos os tenants e cria o tenant técnico inicial com uma única conta.
 *
 * Não é reset de banco: não toca em schema, migrations, RLS, grants, catálogo
 * global, identidade do proprietário, `auth` nem `storage`. Só DELETE de
 * linhas de tenant, em transação, na ordem das FKs.
 *
 * Travas (todas antes de apagar qualquer coisa):
 * - `--sistema <id>`: o `system_identifier` do PostgreSQL tem de conferir;
 *   banco errado = recusa (não depende de URL nem de segredo).
 * - Schema completo (mesmo veredito do `preflight-schema`): migrations
 *   primeiro, limpeza depois.
 * - Todas as tabelas do banco têm de ser do schema versionado; tabela
 *   inesperada = recusa.
 * - Banco remoto ou `NODE_ENV=production` exige
 *   INICIALIZAR_ALLOW_PRODUCTION=sim (aprovação do proprietário).
 * - Sem `--executar` é só DRY-RUN.
 * - Execução exige terminal interativo, a frase com o inventário exato
 *   ("APAGAR <n> LINHAS DE <c> CLIENTE(S)") e a senha nova digitada duas vezes
 *   com eco desligado. A senha nunca vem de argumento, variável ou arquivo e
 *   só o hash bcrypt é gravado.
 * - Dentro da transação: tabelas travadas contra escrita, inventário recontado
 *   (mudou = aborta) e estado final conferido antes do COMMIT.
 *
 * A conta nasce com papel 'usuario'. A elevação a administrador da fazenda é
 * um passo separado e auditado: `scripts/auth/papel-tenant.mjs`.
 *
 * Uso:
 *   DATABASE_URL=… node scripts/ops/inicializar-tenant-maike.mjs --sistema <id>             (dry-run)
 *   DATABASE_URL=… node scripts/ops/inicializar-tenant-maike.mjs --sistema <id> --executar
 * Teste automatizado (sem TTY): INICIALIZAR_STDIN=sim e as respostas no stdin.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { motivoAlvoProtegido } from '../auth/alvoProtegido.mjs';
import { CONSULTAS, TABELAS_PROTEGIDAS, avaliarPreflight } from '../deploy/preflightSchemaLib.mjs';
import {
  CLIENTE_INICIAL,
  CONTA_INICIAL,
  avaliarSenha,
  classificarTabelas,
  fraseDeConfirmacao,
  jaInicializado,
  planejarOrdem,
  q,
} from './inicializarTenantLib.mjs';

const sair = (msg, codigo = 1) => {
  console.error(`inicializar-tenant-maike: ${msg}`);
  process.exit(codigo);
};
const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? (args[i + 1] ?? '').trim() : '';
};
const executar = args.includes('--executar');
const sistemaEsperado = valor('--sistema');
if (!/^\d{6,25}$/.test(sistemaEsperado)) sair('uso: --sistema <system_identifier do PostgreSQL> [--executar]');
if (executar && !process.stdin.isTTY && process.env.INICIALIZAR_STDIN !== 'sim') {
  sair('execute num terminal interativo (a senha não é aceita por argumento nem variável)');
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { env } = await import('../../backend/src/config/env.js');
if (!env.databaseUrl) sair('DATABASE_URL ausente');
const motivo = motivoAlvoProtegido(process.env, env.databaseUrl);
if (motivo && process.env.INICIALIZAR_ALLOW_PRODUCTION !== 'sim') {
  sair(`recusado em ${motivo} (exige INICIALIZAR_ALLOW_PRODUCTION=sim e aprovação do proprietário)`);
}

const { Prisma } = await import('@prisma/client');
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const { gerarSenhaHash } = await import('../../backend/src/modules/auth/authService.js');
const db = getPrismaClient();

const contrato = JSON.parse(readFileSync(join(raiz, 'config', 'modelobase1-pecuario.json'), 'utf8'));
const preservados = [...contrato.tenancy.globalCatalogModels, ...contrato.tenancy.productAdminModels];
const modelos = Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name);
const pastas = readdirSync(join(raiz, 'backend', 'prisma', 'migrations'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
  .map((d) => d.name)
  .sort();

/** Lê o inventário (só SELECT). `cx` = cliente Prisma ou transação. */
const lerInventario = async (cx) => {
  const tabelasBanco = (
    await cx.$queryRawUnsafe(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')`
    )
  ).map((r) => r.t);
  const comClienteId = (
    await cx.$queryRawUnsafe(
      `SELECT table_name AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'cliente_id'`
    )
  ).map((r) => r.t);
  const cls = classificarTabelas({ tabelasBanco, modelos, preservados, comClienteId });
  const contagens = {};
  for (const t of [...cls.tenant, 'Cliente']) {
    contagens[t] = Number((await cx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.${q(t)}`))[0].n);
  }
  const clientes = await cx.$queryRawUnsafe(`SELECT id, codigo FROM public."Cliente" ORDER BY id`);
  const usuarios = await cx.$queryRawUnsafe(`SELECT login FROM public."Usuario"`);
  const linhas = Object.values(contagens).reduce((a, b) => a + b, 0);
  return { ...cls, contagens, clientes, usuarios, linhas };
};

const lerFks = async (cx) =>
  (
    await cx.$queryRawUnsafe(
      `SELECT c.conrelid::regclass::text AS filha, c.confrelid::regclass::text AS mae,
              array_agg(a.attname::text ORDER BY a.attnum) AS colunas,
              bool_and(NOT a.attnotnull OR a.attname = 'cliente_id') AS anulaveis
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND n.nspname = 'public'
        GROUP BY c.oid, c.conrelid, c.confrelid`
    )
  ).map((f) => ({ ...f, filha: f.filha.replaceAll('"', ''), mae: f.mae.replaceAll('"', '') }));

let codigo = 1;
try {
  // 1. Alvo certo (sem URL): identificador do cluster PostgreSQL.
  const [{ sid }] = await db.$queryRawUnsafe(`SELECT system_identifier::text AS sid FROM pg_control_system()`);
  if (sid !== sistemaEsperado) sair('o banco conectado NÃO é o alvo informado em --sistema; nada foi feito');
  console.log('alvo: system_identifier confere');

  // 2. Schema completo primeiro (migrations antes da limpeza).
  const r = avaliarPreflight({
    pastas,
    migrations: await db.$queryRawUnsafe(CONSULTAS.migrations),
    colunas: await db.$queryRawUnsafe(CONSULTAS.colunas),
    tabelas: await db.$queryRawUnsafe(CONSULTAS.tabelas, TABELAS_PROTEGIDAS),
    grants: await db.$queryRawUnsafe(CONSULTAS.grants, TABELAS_PROTEGIDAS),
    papeis: null,
  });
  if (!r.ok) sair(`schema incompleto — aplique as migrations antes (npm run deploy:migrate):\n  ${r.falhas.join('\n  ')}`);
  console.log(`schema: ${r.resumo.migrations_aplicadas}/${r.resumo.migrations_no_repositorio} migrations, RLS e grants conferem`);

  // 3. Inventário e plano.
  const inv = await lerInventario(db);
  if (inv.inesperadas.length) sair(`tabela(s) fora do schema versionado: ${inv.inesperadas.join(', ')} — revise antes`);
  if (inv.ausentes.length) sair(`tabela(s) do schema ausentes no banco: ${inv.ausentes.join(', ')}`);
  if (jaInicializado(inv)) {
    console.log('já inicializado: 1 cliente técnico e 1 conta; nada a fazer');
    codigo = 0;
  } else {
    const plano = planejarOrdem(inv.tenant, await lerFks(db));
    console.log(`preservadas (não tocadas): ${inv.preservadas.length} tabela(s) — ${inv.preservadas.join(', ')}`);
    console.log(`a apagar: ${inv.linhas} linha(s) de ${inv.clientes.length} cliente(s), em ${plano.ordem.length} tabela(s):`);
    for (const t of plano.ordem) if (inv.contagens[t]) console.log(`  ${t}: ${inv.contagens[t]}`);
    console.log(`depois: cliente "${CLIENTE_INICIAL.codigo}" + conta "${CONTA_INICIAL.login}" (papel usuario; elevar com papel-tenant.mjs)`);
    const frase = fraseDeConfirmacao({ clientes: inv.clientes.length, linhas: inv.linhas });

    if (!executar) {
      console.log(`DRY-RUN: nada foi alterado. Para executar: --executar e digitar "${frase}"`);
      codigo = 0;
    } else {
      // 4. Confirmação humana e senha (eco desligado em TTY).
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
      const linhas = rl[Symbol.asyncIterator]();
      let oculto = false;
      const escrever = /** @type {any} */ (rl)._writeToOutput?.bind(rl);
      /** @type {any} */ (rl)._writeToOutput = (t) => {
        if (!oculto || /\n|\r/.test(t)) escrever?.(oculto ? '\n' : t);
      };
      const perguntar = async (texto, secreto = false) => {
        process.stdout.write(texto);
        oculto = secreto;
        const { value, done } = await linhas.next();
        oculto = false;
        if (secreto && !process.stdin.isTTY) process.stdout.write('\n');
        if (done) sair('entrada encerrada; nada foi alterado');
        return String(value ?? '');
      };
      if ((await perguntar(`Digite "${frase}" para confirmar: `)).trim() !== frase) sair('confirmação não confere; nada foi alterado');
      const senha = await perguntar(`Nova senha da conta "${CONTA_INICIAL.login}" (não aparece na tela): `, true);
      const repetida = await perguntar('Repita a senha: ', true);
      rl.close();
      if (senha !== repetida) sair('as senhas não conferem; nada foi alterado');
      const recusa = avaliarSenha(senha, CONTA_INICIAL);
      if (recusa) sair(`senha recusada: ${recusa}; nada foi alterado`);
      const senhaHash = await gerarSenhaHash(senha);

      // 5. Transação única: trava, reconta, apaga, cria, confere.
      const requestId = `ops-inicializacao-${randomUUID()}`;
      const apagados = await db.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`LOCK TABLE ${plano.ordem.map((t) => `public.${q(t)}`).join(', ')} IN EXCLUSIVE MODE NOWAIT`);
          const agora = await lerInventario(tx);
          if (agora.linhas !== inv.linhas || agora.clientes.length !== inv.clientes.length) {
            throw new Error('o inventário mudou desde a conferência (uso concorrente?); nada foi alterado');
          }
          const ids = agora.clientes.map((c) => c.id);
          for (const a of plano.anular) {
            await tx.$executeRawUnsafe(
              `UPDATE public.${q(a.tabela)} SET ${a.colunas.map((c) => `${q(c)} = NULL`).join(', ')} WHERE cliente_id = ANY($1::text[])`,
              ids
            );
          }
          const feito = {};
          for (const t of plano.ordem) {
            const coluna = t === 'Cliente' ? 'id' : 'cliente_id';
            feito[t] = await tx.$executeRawUnsafe(`DELETE FROM public.${q(t)} WHERE ${q(coluna)} = ANY($1::text[])`, ids);
          }
          const cliente = await tx.cliente.create({ data: { codigo: CLIENTE_INICIAL.codigo, nome: CLIENTE_INICIAL.nome } });
          const usuario = await tx.usuario.create({
            data: { cliente_id: cliente.id, nome: CONTA_INICIAL.nome, login: CONTA_INICIAL.login, senha_hash: senhaHash, papel_tenant: 'usuario' },
            select: { id: true },
          });
          await tx.auditLog.create({
            data: {
              cliente_id: cliente.id,
              usuario_id: null,
              acao: 'ops_inicializacao',
              entidade: 'Cliente',
              entidade_id: cliente.id,
              dados_anteriores: { clientes: inv.clientes.length, linhas: inv.linhas },
              dados_novos: { cliente_codigo: CLIENTE_INICIAL.codigo, conta_login: CONTA_INICIAL.login, conta_id: usuario.id, via: 'scripts/ops/inicializar-tenant-maike.mjs' },
              request_id: requestId,
            },
          });
          const final = await lerInventario(tx);
          const sobras = Object.entries(final.contagens).filter(([t, n]) => n !== ({ Cliente: 1, Usuario: 1, AuditLog: 1 }[t] ?? 0));
          if (sobras.length || !jaInicializado(final)) {
            throw new Error(`estado final inesperado (${sobras.map(([t, n]) => `${t}=${n}`).join(', ')}); desfeito`);
          }
          return feito;
        },
        { timeout: 120_000, maxWait: 10_000 }
      );
      const total = Object.values(apagados).reduce((a, b) => a + Number(b), 0);
      console.log(`aplicado: ${total} linha(s) apagada(s); cliente "${CLIENTE_INICIAL.codigo}" e conta "${CONTA_INICIAL.login}" criados (auditoria ${requestId})`);
      console.log(`Próximo passo: papel-tenant.mjs --cliente ${CLIENTE_INICIAL.codigo} --login ${CONTA_INICIAL.login} --papel administrador`);
      codigo = 0;
    }
  }
} catch (erro) {
  console.error(`inicializar-tenant-maike: ${/** @type {any} */ (erro)?.message ?? 'falha'} — transação desfeita, nada foi alterado`);
  codigo = 1;
} finally {
  await closePrismaClient();
}
process.exit(codigo);
