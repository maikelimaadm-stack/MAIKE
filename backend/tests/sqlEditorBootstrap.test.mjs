/**
 * PR145-G4-R2 (D-PROD-74) — scripts do SQL Editor (01 precheck, 02 reset +
 * bootstrap, 03 postcheck) executados de verdade com `psql` contra PostgreSQL.
 *
 * `psql -c` envia o arquivo inteiro numa só consulta (uma transação implícita),
 * como o SQL Editor do Supabase; `psql -f` executa instrução por instrução,
 * para provar a falha fechada nesse modo. O teste troca SÓ os valores dos
 * parâmetros (identificador e nome do banco local, nº de clientes, impressão);
 * o resto é o arquivo versionado, byte a byte.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarTenant, criarApp, autenticarNoApp, limparBanco, encerrar } from './helpers.mjs';

const DIR = fileURLToPath(new URL('../../scripts/ops/sql-editor/', import.meta.url));
const ler = (f) => readFileSync(join(DIR, f), 'utf8');
const PRE = ler('01-precheck-somente-leitura.sql');
const RESET = ler('02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql');
const POS = ler('03-postcheck-somente-leitura.sql');
const URL_PSQL = (() => {
  const u = new URL(process.env.DATABASE_URL);
  u.search = '';
  return u.toString();
})();
const prisma = () => getPrismaClient();
let SID;
let BANCO;
let TMP;

const psql = (sql, modo = 'c') => {
  const args = [URL_PSQL, '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1'];
  if (modo === 'c') return spawnSync('psql', [...args, '-c', sql], { encoding: 'utf8' });
  const f = join(TMP, `s-${Date.now()}.sql`);
  writeFileSync(f, sql);
  return spawnSync('psql', [...args, '-f', f], { encoding: 'utf8' });
};
/** Troca só os valores esperados do alvo (o banco local não é o de produção). */
const precheck = () =>
  PRE.replace("'7692130048193495360'::text AS sid", `'${SID}'::text AS sid`).replace("'postgres'::text AS banco", `'${BANCO}'::text AS banco`);
const linhasDe = (r) =>
  Object.fromEntries(
    r.stdout.trim().split('\n').filter(Boolean).map((l) => {
      const [item, valor, esperado, status] = l.split('|');
      return [item.trim(), { valor, esperado, status }];
    })
  );
const impressaoAtual = () => {
  const r = psql(precheck());
  assert.equal(r.status, 0, r.stderr);
  return linhasDe(r)['impressao_inventario (copie para o 02 depois das migrations)'].valor;
};
const reset = ({ impressao, clientes = 1, sid = SID, banco = BANCO } = {}) =>
  RESET.replace("SET LOCAL maike_op.sid = '7692130048193495360';", `SET LOCAL maike_op.sid = '${sid}';`)
    .replace("SET LOCAL maike_op.banco = 'postgres';", `SET LOCAL maike_op.banco = '${banco}';`)
    .replace("SET LOCAL maike_op.clientes = '1';", `SET LOCAL maike_op.clientes = '${clientes}';`)
    .replace("SET LOCAL maike_op.impressao = 'COLE_AQUI_A_IMPRESSAO';", `SET LOCAL maike_op.impressao = '${impressao ?? 'COLE_AQUI_A_IMPRESSAO'}';`);
/** O resultado da ÚLTIMA instrução (é o que o SQL Editor mostra). */
const resultado = (r) => {
  const ultima = r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
  const [status, login, senha, apagadas, obs] = ultima.split('|');
  return { status, login, senha: senha || null, apagadas: Number(apagadas), obs };
};
const contar = async () => {
  const p = prisma();
  const tab = await p.$queryRawUnsafe(
    `SELECT (SELECT count(*) FROM "Cliente")::int c, (SELECT count(*) FROM "Usuario")::int u, (SELECT count(*) FROM "Lote")::int l,
            (SELECT count(*) FROM "AuditLog")::int a, (SELECT count(*) FROM "Categoria")::int cat, (SELECT count(*) FROM "MovimentacaoMapa")::int mm,
            (SELECT count(*) FROM "CatalogoTipoEntidade")::int glob, (SELECT count(*) FROM "_prisma_migrations")::int mig`
  );
  return tab[0];
};

/** Dados de teste no formato de produção (FK composta de AuditLog, auto-referência, cascata). */
const semear = async ({ clientes = 1 } = {}) => {
  const p = prisma();
  const criados = [];
  for (let i = 0; i < clientes; i += 1) {
    const t = await criarTenant({ login: i === 0 ? 'legado.admin' : undefined });
    const c = t.cliente.id;
    await p.permissao.create({ data: { cliente_id: c, user_email: t.usuario.login, is_admin: true } });
    const emp = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E', nome: 'EMPRESA' } });
    const setor = await p.setor.create({ data: { cliente_id: c, empresa_id: emp.id, numero_setor: '1', nome: 'S' } });
    await p.areaPastagem.create({ data: { cliente_id: c, empresa_id: emp.id, setor_id: setor.id, setor_nome: 'S', numero_area: '1', nome: 'A', tamanho_hectares: 1 } });
    const lote = await p.lote.create({ data: { cliente_id: c, empresa_id: emp.id, numero_lote: '1', nome: 'L', quantidade_cabecas: 5, quantidade_entrada: 5, motivo_entrada: 'Compra' } });
    const pai = await p.categoria.create({ data: { cliente_id: c, numero_categoria: '1', nome: 'PAI' } });
    await p.categoria.create({ data: { cliente_id: c, numero_categoria: '2', nome: 'FILHA', categoria_pai_id: pai.id } });
    const g = await p.grupoAtividade.create({ data: { cliente_id: c, nome_grupo: 'G' } });
    const tt = await p.tipoTarefa.create({ data: { cliente_id: c, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    const tarefa = await p.lancamentoTarefa.create({ data: { cliente_id: c, empresa_id: emp.id, titulo: 'X', tipo: 'Tarefa', tipo_tarefa_id: tt.id, tipo_tarefa_nome: 'T', lote_id: lote.id } });
    await p.historicoLancamentoTarefa.create({ data: { cliente_id: c, empresa_id: emp.id, tarefa_id: tarefa.id, evento: 'criada', data_evento: new Date() } });
    for (let k = 0; k < 3; k += 1) await p.movimentacaoMapa.create({ data: { cliente_id: c, empresa_id: emp.id } });
    for (let k = 0; k < 5; k += 1) await p.auditLog.create({ data: { cliente_id: c, usuario_id: t.usuario.id, acao: 'criar', entidade: 'Lote', entidade_id: lote.id, request_id: 'req-teste' } });
    criados.push(t);
  }
  return criados;
};

before(async () => {
  TMP = mkdtempSync(join(tmpdir(), 'maike-sqled-'));
  const p = prisma();
  // Como no Supabase: pgcrypto no schema "extensions".
  await p.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS extensions');
  await p.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions');
  const [r] = await p.$queryRawUnsafe(`SELECT system_identifier::text AS sid, current_database() AS banco FROM pg_control_system()`);
  SID = r.sid;
  BANCO = r.banco;
});
after(async () => {
  rmSync(TMP, { recursive: true, force: true });
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  await prisma().catalogoTipoEntidade.deleteMany({ where: { codigo: 'lote-teste-sqled' } });
});

describe('SQL Editor — 01 precheck', () => {
  test('SE-01 só leitura, veredito e impressão estável; mudança de distribuição muda a impressão', async () => {
    const [t] = await semear();
    const antes = await contar();
    const r = psql(precheck());
    assert.equal(r.status, 0, r.stderr);
    const l = linhasDe(r);
    assert.equal(l['alvo: system_identifier'].status, 'OK');
    assert.equal(l['migrations concluídas'].valor, '25');
    assert.equal(l['tabelas em public'].valor, '53');
    assert.match(l.VEREDITO.valor, /PRONTO PARA O 02/);
    assert.deepEqual(await contar(), antes, 'precheck não altera nada');
    const i1 = impressaoAtual();
    assert.equal(impressaoAtual(), i1, 'estável');
    // mesmo total, outra distribuição → outra impressão
    const p = prisma();
    await p.movimentacaoMapa.deleteMany({ where: { id: (await p.movimentacaoMapa.findFirst()).id } });
    await p.permissao.create({ data: { cliente_id: t.cliente.id, user_email: 'troca@x', is_admin: false } });
    assert.notEqual(impressaoAtual(), i1);
    // produção (valores reais) num banco que não é ela → PARAR
    assert.match(linhasDe(psql(PRE)).VEREDITO.valor, /PARAR: banco errado/);
  });
});

describe('SQL Editor — 02 reset + bootstrap (falha fechada)', () => {
  test('SE-02 parâmetro não preenchido, banco errado ou nº de clientes divergente: nada muda', async () => {
    await semear({ clientes: 2 });
    const antes = await contar();
    const imp = impressaoAtual();
    const casos = [
      [reset({}), /cole no parâmetro a impressao_inventario/],
      [reset({ impressao: imp, sid: '1234567' }), /NÃO é o banco esperado/],
      [reset({ impressao: imp, banco: 'outro_banco' }), /NÃO é o banco esperado/],
      [reset({ impressao: imp, clientes: 1 }), /2 cliente\(s\) no banco; o parâmetro autoriza 1/],
    ];
    for (const [sql, re] of casos) {
      const r = psql(sql);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /Nada foi alterado/);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-03 executado instrução por instrução (não numa transação): para ANTES de alterar', async () => {
    await semear();
    const antes = await contar();
    const r = psql(reset({ impressao: impressaoAtual() }), 'f');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /rode o arquivo INTEIRO de uma vez|parâmetros ausentes/);
    assert.deepEqual(await contar(), antes);
  });

  test('SE-04 schema 18/25 (migration não concluída), tabela intrusa ou view em public: recusa', async () => {
    await semear();
    const antes = await contar();
    const p = prisma();
    const imp = impressaoAtual();
    const ultima = '20261029400000_usuario_papel_tenant';
    await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = $1`, ultima);
    try {
      const r = psql(reset({ impressao: imp }));
      assert.match(r.stderr, /precisa 25\/25/);
    } finally {
      await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = now() WHERE migration_name = $1`, ultima);
    }
    await p.$executeRawUnsafe('CREATE TABLE public."TabelaIntrusa" (id int)');
    try {
      assert.match(psql(reset({ impressao: imp })).stderr, /fora do schema conhecido: TabelaIntrusa/);
    } finally {
      await p.$executeRawUnsafe('DROP TABLE public."TabelaIntrusa"');
    }
    await p.$executeRawUnsafe('CREATE VIEW public."VisaoIntrusa" AS SELECT 1 AS x');
    try {
      assert.match(psql(reset({ impressao: imp })).stderr, /view\/partição\/tabela estrangeira/);
    } finally {
      await p.$executeRawUnsafe('DROP VIEW public."VisaoIntrusa"');
    }
    assert.deepEqual(await contar(), antes);
  });

  test('SE-05 mudança entre o precheck e a execução (mesmo total): recusa', async () => {
    const [t] = await semear();
    const antes = await contar();
    const imp = impressaoAtual();
    const p = prisma();
    await p.movimentacaoMapa.deleteMany({ where: { id: (await p.movimentacaoMapa.findFirst()).id } });
    await p.permissao.create({ data: { cliente_id: t.cliente.id, user_email: 'concorrente@x', is_admin: false } });
    const r = psql(reset({ impressao: imp }));
    assert.match(r.stderr, /o inventário mudou desde o 01/);
    assert.equal((await contar()).c, antes.c);
  });

  test('SE-06 linha em tabela preservada que pode referenciar o tenant: recusa; preservada sem vínculo: intacta', async () => {
    const [t] = await semear();
    const p = prisma();
    await p.operadorProdutoMaike.create({ data: { cliente_id: t.cliente.id, usuario_id: t.usuario.id } });
    const r = psql(reset({ impressao: impressaoAtual() }));
    assert.match(r.stderr, /tabela preservada OperadorProdutoMaike tem linhas/);
    assert.equal(await p.cliente.count(), 1);
    await p.operadorProdutoMaike.deleteMany();
  });

  test('SE-07 falha no meio (depois dos DELETEs): tudo desfeito', async () => {
    await semear();
    const antes = await contar();
    const p = prisma();
    const imp = impressaoAtual();
    await p.$executeRawUnsafe(`ALTER TABLE "Usuario" ADD CONSTRAINT "teste_bloqueia_maike" CHECK (login <> 'maike') NOT VALID`);
    let r;
    try {
      r = psql(reset({ impressao: imp }));
    } finally {
      await p.$executeRawUnsafe(`ALTER TABLE "Usuario" DROP CONSTRAINT "teste_bloqueia_maike"`);
    }
    assert.notEqual(r.status, 0);
    assert.deepEqual(await contar(), antes);
  });

  test('SE-08 login "maike" já existe (fora do escopo) ou conta maike com papel errado: ANOMALIA, nada apagado', async () => {
    const [t] = await semear();
    const p = prisma();
    await p.usuario.create({ data: { cliente_id: t.cliente.id, nome: 'X', login: 'maike', senha_hash: 'x' } });
    const antes = await contar();
    assert.match(psql(reset({ impressao: impressaoAtual() })).stderr, /ANOMALIA/);
    assert.deepEqual(await contar(), antes);
  });
});

describe('SQL Editor — 02 sucesso + 03 postcheck + API real', () => {
  test('SE-09 apaga só o teste, cria maike administradora, senha só uma vez (bcryptjs), preservados intactos', async () => {
    const [t] = await semear();
    const p = prisma();
    await p.catalogoTipoEntidade.create({ data: { codigo: 'lote-teste-sqled', nome: 'Lote' } });
    const app = await criarApp();
    const tokenAntigo = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const antes = await contar();
    const rls = await p.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE relrowsecurity)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND relkind='r'`);

    const r = psql(reset({ impressao: impressaoAtual() }));
    assert.equal(r.status, 0, r.stderr);
    const res = resultado(r);
    assert.equal(res.status, 'CONCLUIDO');
    assert.equal(res.login, 'maike');
    assert.match(res.senha, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(res.apagadas > 0);

    const conta = await p.usuario.findFirst({ include: { cliente: true } });
    assert.deepEqual(
      [conta.login, conta.nome, conta.ativo, conta.papel_tenant, conta.cliente.codigo, conta.cliente.nome, conta.cliente.ativo],
      ['maike', 'Maike', true, 'administrador', 'maike', 'MAIKE', true]
    );
    assert.match(conta.senha_hash, /^\$2a\$10\$/);
    assert.equal(await bcrypt.compare(res.senha, conta.senha_hash), true, 'hash do pgcrypto compatível com bcryptjs');
    const depois = await contar();
    assert.deepEqual(depois, { c: 1, u: 1, l: 0, a: 2, cat: 0, mm: 0, glob: antes.glob, mig: antes.mig });
    const auditoria = await p.auditLog.findMany({ orderBy: { acao: 'asc' } });
    assert.deepEqual(auditoria.map((a) => a.acao), ['ops_inicializacao', 'papel_tenant']);
    const texto = JSON.stringify(auditoria);
    assert.equal(texto.includes(res.senha) || texto.includes(conta.senha_hash), false, 'auditoria sem senha nem hash');
    assert.equal(await p.permissao.count(), 0, 'sem Permissao.is_admin artificial');
    assert.deepEqual(
      await p.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE relrowsecurity)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND relkind='r'`),
      rls
    );

    // 03 postcheck
    const pos = linhasDe(psql(POS));
    assert.match(pos.VEREDITO.valor, /^INICIALIZADO/);
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.notEqual(v.status, 'PARAR', item);

    // API real do MAIKE (backend desta PR)
    const get = (url, tok) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tok}` } });
    assert.equal((await get('/lotes', tokenAntigo)).statusCode, 401, 'JWT da conta apagada');
    const login = await autenticarNoApp(app, { login: 'maike', senha: res.senha });
    assert.equal(login.resposta.statusCode, 200);
    const tok = login.corpo.token;
    assert.equal((await get('/lotes', tok)).statusCode, 200);
    const us = await get('/usuarios', tok);
    assert.equal(us.statusCode, 200);
    const criar = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${tok}` }, payload: { nome: 'Vaqueiro', login: 'sqled.vaqueiro', senha: 'Vaqueiro-SqlEd-2026' } });
    assert.equal(criar.statusCode, 201, 'administrador da fazenda cria conta');
    const tokComum = (await autenticarNoApp(app, { login: 'sqled.vaqueiro', senha: 'Vaqueiro-SqlEd-2026' })).corpo.token;
    const comumCria = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${tokComum}` }, payload: { nome: 'Y', login: 'sqled.y', senha: 'Y-SqlEd-2026-abc' } });
    assert.equal(comumCria.statusCode, 403, 'usuário comum não cria');
    await p.usuario.update({ where: { login: undefined, id: (await p.usuario.findFirst({ where: { login: 'sqled.vaqueiro' } })).id }, data: { ativo: false } });
    assert.equal((await get('/lotes', tokComum)).statusCode, 401, 'conta desativada');
    await p.cliente.update({ where: { id: conta.cliente_id }, data: { ativo: false } });
    assert.equal((await get('/lotes', tok)).statusCode, 401, 'cliente desativado');
    await app.close();
  });

  test('SE-10 reexecução: JA_INICIALIZADO, sem senha, sem alterar; com dado extra: ANOMALIA sem apagar', async () => {
    await semear();
    const r1 = resultado(psql(reset({ impressao: impressaoAtual() })));
    assert.equal(r1.status, 'CONCLUIDO');
    const p = prisma();
    const conta = await p.usuario.findFirst();
    assert.match(linhasDe(psql(precheck())).VEREDITO.valor, /JÁ INICIALIZADO/);
    const r2 = psql(reset({ impressao: impressaoAtual() }));
    assert.equal(r2.status, 0, r2.stderr);
    const res2 = resultado(r2);
    assert.equal(res2.status, 'JA_INICIALIZADO');
    assert.equal(res2.senha, null, 'senha nunca é mostrada de novo');
    const depois = await p.usuario.findFirst();
    assert.deepEqual([depois.id, depois.senha_hash], [conta.id, conta.senha_hash]);
    await p.empresa.create({ data: { cliente_id: conta.cliente_id, numero_empresa: 1, apelido: 'REAL', nome: 'REAL' } });
    assert.match(psql(reset({ impressao: impressaoAtual() })).stderr, /ANOMALIA/);
    assert.equal(await p.empresa.count(), 1);
    assert.equal(await p.usuario.count(), 1);
  });
});
