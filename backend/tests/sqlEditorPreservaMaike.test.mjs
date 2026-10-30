/**
 * PR145-G4-R5 (D-PROD-76) — 04 (limpeza preservando a conta "maike" existente)
 * e a correção do falso positivo do 01, executados de verdade com `psql`.
 *
 * Estado de produção reproduzido: o ÚNICO cliente já é "maike" e a ÚNICA conta
 * já é "maike" (papel `usuario`), com 124 linhas de teste do mesmo cliente
 * (FK composta de AuditLog, Categoria autorreferente, cascata de histórico).
 * O teste troca SÓ os valores dos parâmetros; o resto é o arquivo versionado.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarTenant, criarApp, autenticarNoApp, limparBanco, encerrar } from './helpers.mjs';

const DIR = fileURLToPath(new URL('../../scripts/ops/sql-editor/', import.meta.url));
const ler = (f) => readFileSync(join(DIR, f), 'utf8');
const PRE = ler('01-precheck-somente-leitura.sql');
const RESET = ler('02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql');
const POS = ler('03-postcheck-somente-leitura.sql');
const LIMPA = ler('04-limpeza-preservando-maike.sql');
const URL_PSQL = (() => {
  const u = new URL(process.env.DATABASE_URL);
  u.search = '';
  return u.toString();
})();
const SENHA_EXISTENTE = 'Senha-Existente-R5-2026';
const ITEM_IMPRESSAO = 'impressao_inventario (copie para o 02 depois das migrations)';
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
const precheck = () =>
  PRE.replace("'7692130048193495360'::text AS sid", `'${SID}'::text AS sid`).replace("'postgres'::text AS banco", `'${BANCO}'::text AS banco`);
const linhasDe = (r) =>
  Object.fromEntries(
    r.stdout.trim().split('\n').filter(Boolean).map((l) => {
      const [item, valor, esperado, status] = l.split('|');
      return [item.trim(), { valor, esperado, status }];
    })
  );
const pre = () => {
  const r = psql(precheck());
  assert.equal(r.status, 0, r.stderr);
  return linhasDe(r);
};
const limpeza = ({ impressao, sid = SID, banco = BANCO } = {}) =>
  LIMPA.replace("SET LOCAL maike_op.sid = '7692130048193495360';", `SET LOCAL maike_op.sid = '${sid}';`)
    .replace("SET LOCAL maike_op.banco = 'postgres';", `SET LOCAL maike_op.banco = '${banco}';`)
    .replace("SET LOCAL maike_op.impressao = 'COLE_AQUI_A_IMPRESSAO';", `SET LOCAL maike_op.impressao = '${impressao ?? 'COLE_AQUI_A_IMPRESSAO'}';`);
const reset = (impressao) =>
  RESET.replace("SET LOCAL maike_op.sid = '7692130048193495360';", `SET LOCAL maike_op.sid = '${SID}';`)
    .replace("SET LOCAL maike_op.banco = 'postgres';", `SET LOCAL maike_op.banco = '${BANCO}';`)
    .replace("SET LOCAL maike_op.impressao = 'COLE_AQUI_A_IMPRESSAO';", `SET LOCAL maike_op.impressao = '${impressao}';`);
const resultado = (r) => {
  const [status, login, papel, apagadas, obs] = (r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '').split('|');
  return { status, login, papel, apagadas: Number(apagadas), obs };
};
/** Retrato completo: contagens de tenant, conta, cliente, preservadas, migrations e segurança. */
const retrato = async () => {
  const [r] = await prisma().$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM "Cliente")::int c, (SELECT count(*) FROM "Usuario")::int u, (SELECT count(*) FROM "AuditLog")::int a,
           (SELECT count(*) FROM "Lote")::int l, (SELECT count(*) FROM "Categoria")::int cat, (SELECT count(*) FROM "MovimentacaoMapa")::int mm,
           (SELECT count(*) FROM "HistoricoLancamentoTarefa")::int h, (SELECT count(*) FROM "Empresa")::int e,
           (SELECT md5(string_agg(id || senha_hash || papel_tenant, ',')) FROM "Usuario") conta,
           (SELECT md5(string_agg(id || codigo || "updatedAt"::text, ',')) FROM "Cliente") cliente,
           (SELECT count(*) FROM "CatalogoTipoEntidade")::int glob,
           (SELECT md5(string_agg(migration_name || checksum, ',' ORDER BY migration_name)) FROM "_prisma_migrations") mig,
           (SELECT count(*) FILTER (WHERE relrowsecurity)::int FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND relkind = 'r') rls`);
  return r;
};

/** O estado de produção de 30/10: cliente e conta "maike" + 124 linhas de teste do mesmo cliente. */
const semearMaike = async () => {
  const p = prisma();
  const t = await criarTenant({ codigo: 'maike', login: 'maike', senha: SENHA_EXISTENTE });
  const c = t.cliente.id;
  await p.permissao.create({ data: { cliente_id: c, user_email: 'maike', is_admin: true } });
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
  // 14 linhas acima (fora a conta) + 110 de auditoria = 124, como em produção.
  await p.auditLog.createMany({
    data: Array.from({ length: 110 }, (_, k) => ({ cliente_id: c, usuario_id: t.usuario.id, acao: ['create', 'update', 'delete'][k % 3], entidade: 'Lote', entidade_id: lote.id, request_id: `req-${k}` })),
  });
  return t;
};

before(async () => {
  TMP = mkdtempSync(join(tmpdir(), 'maike-r5-'));
  const p = prisma();
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
  await prisma().catalogoTipoEntidade.deleteMany({ where: { codigo: 'lote-teste-r5' } });
});

describe('01 precheck — falso positivo corrigido', () => {
  test('PM-01 maike existente + teste: MAIKE EXISTENTE (04), nunca INICIALIZADO; nenhuma linha PARAR; 02 dá ANOMALIA', async () => {
    await semearMaike();
    const antes = await retrato();
    const l = pre();
    assert.equal(l['cliente "maike" / login "maike" já existem'].status, 'MAIKE EXISTENTE (caminho 04)');
    assert.equal(l['conta "maike": papel_tenant administrador'].status, 'AINDA NÃO');
    assert.equal(l['linhas de tenant além do cliente, da conta e da auditoria'].valor, '14');
    assert.match(l.VEREDITO.valor, /^MAIKE EXISTENTE — LIMPEZA CONTROLADA NECESSÁRIA/);
    assert.doesNotMatch(l.VEREDITO.valor, /INICIALIZADO/);
    for (const [item, v] of Object.entries(l)) assert.doesNotMatch(v.status ?? '', /^PARAR/, item);
    assert.match(psql(reset(l[ITEM_IMPRESSAO].valor)).stderr, /ANOMALIA/);
    assert.deepEqual(await retrato(), antes, 'precheck e 02 não alteram nada');
  });

  test('PM-02 papel administrador com teste restante, ou cliente extra: nunca INICIALIZADO', async () => {
    const t = await semearMaike();
    await prisma().usuario.update({ where: { id: t.usuario.id }, data: { papel_tenant: 'administrador' } });
    assert.match(pre().VEREDITO.valor, /^MAIKE EXISTENTE/);
    await criarTenant({ codigo: 'outro-tenant', login: 'outro' });
    const l = pre();
    assert.match(l['cliente "maike" / login "maike" já existem'].status, /^PARAR/);
    assert.match(l.VEREDITO.valor, /^PARAR: há linha PARAR acima/);
  });
});

describe('04 limpeza preservando maike — falha fechada', () => {
  test('PM-03 parâmetro, alvo errado, instrução por instrução, inventário mudado, cliente extra: nada muda', async () => {
    const t = await semearMaike();
    const imp = pre()[ITEM_IMPRESSAO].valor;
    const antes = await retrato();
    const casos = [
      [limpeza({}), /cole no parâmetro a impressao_inventario/],
      [limpeza({ impressao: imp, sid: '1234567' }), /NÃO é o banco esperado/],
      [limpeza({ impressao: imp, banco: 'outro_banco' }), /NÃO é o banco esperado/],
    ];
    for (const [sql, re] of casos) {
      const r = psql(sql);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, re);
    }
    const f = psql(limpeza({ impressao: imp }), 'f');
    assert.notEqual(f.status, 0);
    assert.match(f.stderr, /rode o arquivo INTEIRO de uma vez|parâmetros ausentes/);
    assert.deepEqual(await retrato(), antes);
    // mudança entre o 01 e o 04 (mesmo total): impressão diferente
    const p = prisma();
    await p.movimentacaoMapa.delete({ where: { id: (await p.movimentacaoMapa.findFirst()).id } });
    await p.permissao.create({ data: { cliente_id: t.cliente.id, user_email: 'concorrente@x', is_admin: false } });
    assert.match(psql(limpeza({ impressao: imp })).stderr, /o inventário mudou desde o 01/);
    // cliente extra
    await criarTenant({ codigo: 'outro-tenant', login: 'outro' });
    assert.match(psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor })).stderr, /ANOMALIA — o banco não tem exatamente 1 cliente/);
    assert.equal(await p.auditLog.count(), 110);
  });

  test('PM-04 dependência em preservada (OperadorProdutoMaike) e checksum adulterado de migration: recusa', async () => {
    const t = await semearMaike();
    const p = prisma();
    await p.operadorProdutoMaike.create({ data: { cliente_id: t.cliente.id, usuario_id: t.usuario.id } });
    const antes = await retrato();
    assert.match(psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor })).stderr, /OperadorProdutoMaike \(fora do tenant\) tem linhas/);
    await p.operadorProdutoMaike.deleteMany();
    const nome = '20261029400000_usuario_papel_tenant';
    const [{ checksum }] = await p.$queryRawUnsafe(`SELECT checksum FROM "_prisma_migrations" WHERE migration_name = $1`, nome);
    await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET checksum = repeat('0', 64) WHERE migration_name = $1`, nome);
    try {
      assert.match(psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor })).stderr, /checksum do repositório/);
    } finally {
      await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET checksum = $2 WHERE migration_name = $1`, nome, checksum);
    }
    assert.deepEqual(await retrato(), antes);
  });

  test('PM-05 falha forçada depois dos DELETEs (na promoção): tudo desfeito', async () => {
    await semearMaike();
    const p = prisma();
    const imp = pre()[ITEM_IMPRESSAO].valor;
    const antes = await retrato();
    await p.$executeRawUnsafe(`ALTER TABLE "Usuario" ADD CONSTRAINT "teste_bloqueia_admin" CHECK (papel_tenant <> 'administrador') NOT VALID`);
    let r;
    try {
      r = psql(limpeza({ impressao: imp }));
    } finally {
      await p.$executeRawUnsafe(`ALTER TABLE "Usuario" DROP CONSTRAINT "teste_bloqueia_admin"`);
    }
    assert.notEqual(r.status, 0);
    assert.deepEqual(await retrato(), antes);
  });
});

describe('04 sucesso + 01/03 + API com a senha existente', () => {
  test('PM-06 apaga 124, preserva id/hash/cliente, promove só o papel; 01 e 03 INICIALIZADO; login com a senha antiga', async () => {
    const t = await semearMaike();
    const p = prisma();
    await p.catalogoTipoEntidade.create({ data: { codigo: 'lote-teste-r5', nome: 'Lote' } });
    const app = await criarApp();
    const tokenAntigo = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const contaAntes = await p.usuario.findUnique({ where: { id: t.usuario.id } });
    const clienteAntes = await p.cliente.findUnique({ where: { id: t.cliente.id } });
    const antes = await retrato();

    const r = psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor }));
    assert.equal(r.status, 0, r.stderr);
    const res = resultado(r);
    assert.deepEqual([res.status, res.login, res.papel, res.apagadas], ['CONCLUIDO', 'maike', 'administrador', 124]);
    assert.doesNotMatch(r.stdout, /\$2[aby]\$/, 'nenhum hash na saída');

    const conta = await p.usuario.findUnique({ where: { id: t.usuario.id } });
    assert.deepEqual(
      [conta.id, conta.cliente_id, conta.login, conta.nome, conta.ativo, conta.senha_hash, conta.createdAt.getTime()],
      [contaAntes.id, contaAntes.cliente_id, contaAntes.login, contaAntes.nome, contaAntes.ativo, contaAntes.senha_hash, contaAntes.createdAt.getTime()]
    );
    assert.equal(conta.papel_tenant, 'administrador');
    assert.deepEqual(await p.cliente.findUnique({ where: { id: t.cliente.id } }), clienteAntes, 'cliente intacto');
    const depois = await retrato();
    assert.deepEqual(
      { c: depois.c, u: depois.u, a: depois.a, l: depois.l, cat: depois.cat, mm: depois.mm, h: depois.h, e: depois.e, glob: depois.glob, mig: depois.mig, rls: depois.rls, cliente: depois.cliente },
      { c: 1, u: 1, a: 2, l: 0, cat: 0, mm: 0, h: 0, e: 0, glob: antes.glob, mig: antes.mig, rls: antes.rls, cliente: antes.cliente }
    );
    const auditoria = await p.auditLog.findMany({ orderBy: { acao: 'asc' } });
    assert.deepEqual(auditoria.map((a) => a.acao), ['ops_inicializacao', 'papel_tenant']);
    assert.equal(auditoria[0].dados_anteriores.linhas_apagadas, 124);
    assert.equal(auditoria[1].dados_anteriores.papel_tenant, 'usuario');
    assert.equal(JSON.stringify(auditoria).includes(conta.senha_hash), false, 'auditoria sem hash');

    assert.match(pre().VEREDITO.valor, /^INICIALIZADO/);
    const pos = linhasDe(psql(POS));
    assert.match(pos.VEREDITO.valor, /^INICIALIZADO/);
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.notEqual(v.status, 'PARAR', item);

    // API real: a senha EXISTENTE continua valendo; agora como administradora da fazenda.
    const get = (url, tok) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tok}` } });
    assert.equal((await get('/lotes', tokenAntigo)).statusCode, 200, 'sessão da conta preservada segue válida');
    const login = await autenticarNoApp(app, { login: 'maike', senha: SENHA_EXISTENTE });
    assert.equal(login.resposta.statusCode, 200);
    const tok = login.corpo.token;
    assert.equal((await get('/lotes', tok)).statusCode, 200);
    const criar = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${tok}` }, payload: { nome: 'Vaqueiro', login: 'r5.vaqueiro', senha: 'Vaqueiro-R5-2026-abc' } });
    assert.equal(criar.statusCode, 201, 'administradora da fazenda cria conta');
    await app.close();
  });

  test('PM-07 rerun: JA_INICIALIZADO sem mudar nada; com dado novo depois da inicialização: ANOMALIA sem apagar', async () => {
    await semearMaike();
    assert.equal(resultado(psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor }))).status, 'CONCLUIDO');
    const p = prisma();
    const antes = await retrato();
    const r2 = psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor }));
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(resultado(r2).status, 'JA_INICIALIZADO');
    assert.deepEqual(await retrato(), antes);
    const conta = await p.usuario.findFirst();
    await p.empresa.create({ data: { cliente_id: conta.cliente_id, numero_empresa: 1, apelido: 'REAL', nome: 'REAL' } });
    assert.match(psql(limpeza({ impressao: pre()[ITEM_IMPRESSAO].valor })).stderr, /ANOMALIA — o tenant já foi inicializado/);
    assert.match(pre().VEREDITO.valor, /^PARAR/);
    assert.equal(await p.empresa.count(), 1);
  });
});
