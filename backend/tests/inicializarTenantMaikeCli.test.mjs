/**
 * PR145-G4 (D-PROD-73) — inicialização única do MAIKE: apaga os dados de teste
 * dos tenants e cria o tenant técnico com uma conta. Roda o script REAL.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarTenant, criarApp, autenticarNoApp, limparBanco, encerrar } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/ops/inicializar-tenant-maike.mjs', import.meta.url));
const SENHA = 'Pasto-Verde_Chuva-2026!';
const prisma = () => getPrismaClient();
let SID;

const rodar = (argv, linhas = [], envExtra = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...argv], {
    input: `${linhas.join('\n')}\n`,
    encoding: 'utf8',
    env: { ...process.env, INICIALIZAR_STDIN: 'sim', NODE_ENV: 'test', ...envExtra },
  });
const contar = async () => {
  const p = prisma();
  return {
    clientes: await p.cliente.count(),
    usuarios: await p.usuario.count(),
    lotes: await p.lote.count(),
    auditoria: await p.auditLog.count(),
    categorias: await p.categoria.count(),
    historicos: await p.historicoLancamentoTarefa.count(),
  };
};

/** Dados de teste em várias relações (FK composta de AuditLog, auto-referência, cascata). */
const semear = async () => {
  const p = prisma();
  const a = await criarTenant({ login: 'legado.admin' });
  const b = await criarTenant();
  for (const t of [a, b]) {
    const c = t.cliente.id;
    await p.permissao.create({ data: { cliente_id: c, user_email: t.usuario.login, is_admin: true } });
    const emp = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E', nome: 'EMPRESA' } });
    const setor = await p.setor.create({ data: { cliente_id: c, empresa_id: emp.id, numero_setor: '1', nome: 'S' } });
    const area = await p.areaPastagem.create({ data: { cliente_id: c, empresa_id: emp.id, setor_id: setor.id, setor_nome: 'S', numero_area: '1', nome: 'A', tamanho_hectares: 1 } });
    const lote = await p.lote.create({ data: { cliente_id: c, empresa_id: emp.id, numero_lote: '1', nome: 'L', quantidade_cabecas: 5, quantidade_entrada: 5, motivo_entrada: 'Compra' } });
    void area;
    const pai = await p.categoria.create({ data: { cliente_id: c, numero_categoria: '1', nome: 'PAI' } });
    await p.categoria.create({ data: { cliente_id: c, numero_categoria: '2', nome: 'FILHA', categoria_pai_id: pai.id } });
    const g = await p.grupoAtividade.create({ data: { cliente_id: c, nome_grupo: 'G' } });
    const tt = await p.tipoTarefa.create({ data: { cliente_id: c, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    const tarefa = await p.lancamentoTarefa.create({ data: { cliente_id: c, empresa_id: emp.id, titulo: 'X', tipo: 'Tarefa', tipo_tarefa_id: tt.id, tipo_tarefa_nome: 'T', lote_id: lote.id } });
    await p.historicoLancamentoTarefa.create({ data: { cliente_id: c, empresa_id: emp.id, tarefa_id: tarefa.id, evento: 'criada', data_evento: new Date() } });
    await p.movimentacaoMapa.create({ data: { cliente_id: c, empresa_id: emp.id } });
    await p.auditLog.create({ data: { cliente_id: c, usuario_id: t.usuario.id, acao: 'criar', entidade: 'Lote', entidade_id: lote.id, request_id: 'req-teste' } });
  }
  // Global do produto: tem de sobreviver.
  await p.catalogoTipoEntidade.create({ data: { codigo: 'lote', nome: 'Lote' } });
  return { a, b };
};

before(async () => {
  SID = (await prisma().$queryRawUnsafe(`SELECT system_identifier::text AS sid FROM pg_control_system()`))[0].sid;
});
after(async () => encerrar());
beforeEach(async () => limparBanco());

describe('inicializar-tenant-maike (operação única)', () => {
  test('IT-01 dry-run lista o inventário e não altera nada', async () => {
    await semear();
    const antes = await contar();
    const r = rodar(['--sistema', SID]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /alvo: system_identifier confere/);
    assert.match(r.stdout, /schema: 25\/25 migrations/);
    assert.match(r.stdout, /DRY-RUN: nada foi alterado/);
    assert.match(r.stdout, /APAGAR \d+ LINHAS DE 2 CLIENTE\(S\)/);
    assert.match(r.stdout, /preservadas \(não tocadas\): 14 tabela/);
    assert.deepEqual(await contar(), antes);
  });

  test('IT-02 alvo errado, sem --sistema, sem TTY ou banco remoto sem liberação: recusa, nada muda', async () => {
    await semear();
    const antes = await contar();
    assert.match(rodar(['--sistema', '1234567']).stderr, /NÃO é o alvo/);
    assert.match(rodar([]).stderr, /uso: --sistema/);
    const semTty = spawnSync(process.execPath, [SCRIPT, '--sistema', SID, '--executar'], { input: '', encoding: 'utf8', env: { ...process.env, INICIALIZAR_STDIN: '' } });
    assert.match(semTty.stderr, /terminal interativo/);
    const remoto = rodar(['--sistema', SID], [], { DATABASE_URL: 'postgresql://ops:fixture-nao-segredo@db.exemplo.invalid:5432/postgres' });
    assert.match(remoto.stderr, /banco fora desta máquina.*INICIALIZAR_ALLOW_PRODUCTION=sim/);
    assert.equal(`${remoto.stdout}${remoto.stderr}`.includes('exemplo.invalid'), false);
    assert.deepEqual(await contar(), antes);
  });

  test('IT-03 schema incompleto ou tabela inesperada: recusa antes de apagar', async () => {
    await semear();
    const antes = await contar();
    const p = prisma();
    const ultima = (await p.$queryRawUnsafe(`SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1`))[0].migration_name;
    await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = NULL WHERE migration_name = $1`, ultima);
    try {
      assert.match(rodar(['--sistema', SID]).stderr, /schema incompleto/);
    } finally {
      await p.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET finished_at = now() WHERE migration_name = $1`, ultima);
    }
    await p.$executeRawUnsafe(`CREATE TABLE public."TabelaIntrusa" (id int)`);
    try {
      assert.match(rodar(['--sistema', SID]).stderr, /fora do schema versionado: TabelaIntrusa/);
    } finally {
      await p.$executeRawUnsafe(`DROP TABLE public."TabelaIntrusa"`);
    }
    assert.deepEqual(await contar(), antes);
  });

  test('IT-04 frase errada, senhas diferentes ou fracas: nada muda e a senha nunca aparece', async () => {
    await semear();
    const antes = await contar();
    const frase = rodar(['--sistema', SID]).stdout.match(/"(APAGAR [^"]+)"/)[1];
    assert.match(rodar(['--sistema', SID, '--executar'], ['APAGAR 1 LINHAS DE 2 CLIENTE(S)', SENHA, SENHA]).stderr, /confirmação não confere/);
    assert.match(rodar(['--sistema', SID, '--executar'], [frase, SENHA, `${SENHA}x`]).stderr, /não conferem/);
    for (const fraca of ['curta-1', '123456789012345', 'MinhaSenhaMaike2026', 'aaaaaaaaaaaaaaaa']) {
      const r = rodar(['--sistema', SID, '--executar'], [frase, fraca, fraca]);
      assert.match(r.stderr, /senha recusada/);
      assert.equal(`${r.stdout}${r.stderr}`.includes(fraca), false, 'senha não ecoa');
    }
    assert.deepEqual(await contar(), antes);
  });

  test('IT-05 falha no meio da transação: tudo desfeito, nada parcial', async () => {
    await semear();
    const antes = await contar();
    const frase = rodar(['--sistema', SID]).stdout.match(/"(APAGAR [^"]+)"/)[1];
    const p = prisma();
    // A criação da conta nova falha DEPOIS dos DELETEs.
    await p.$executeRawUnsafe(`ALTER TABLE "Usuario" ADD CONSTRAINT "teste_bloqueia_maike" CHECK (login <> 'maike') NOT VALID`);
    let r;
    try {
      r = rodar(['--sistema', SID, '--executar'], [frase, SENHA, SENHA]);
    } finally {
      await p.$executeRawUnsafe(`ALTER TABLE "Usuario" DROP CONSTRAINT "teste_bloqueia_maike"`);
    }
    assert.equal(r.status, 1);
    assert.match(r.stderr, /transação desfeita/);
    assert.deepEqual(await contar(), antes);
  });

  test('IT-06 sucesso: só o tenant técnico e a conta; global e migrations intactos; sessão antiga cai', async () => {
    const { a } = await semear();
    const app = await criarApp();
    const tokenAntigo = (await autenticarNoApp(app, a.credenciais)).corpo.token;
    assert.ok(tokenAntigo);
    const migrations = await prisma().$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`);
    const frase = rodar(['--sistema', SID]).stdout.match(/"(APAGAR [^"]+)"/)[1];
    const r = rodar(['--sistema', SID, '--executar'], [frase, SENHA, SENHA]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(`${r.stdout}${r.stderr}`.includes(SENHA), false, 'senha não ecoa');
    assert.deepEqual(await contar(), { clientes: 1, usuarios: 1, lotes: 0, auditoria: 1, categorias: 0, historicos: 0 });

    const p = prisma();
    const conta = await p.usuario.findFirst({ include: { cliente: true } });
    assert.deepEqual([conta.login, conta.nome, conta.ativo, conta.papel_tenant, conta.cliente.codigo], ['maike', 'Maike', true, 'usuario', 'maike']);
    assert.equal(await bcrypt.compare(SENHA, conta.senha_hash), true, 'só o hash bcrypt foi gravado');
    assert.notEqual(conta.senha_hash, SENHA);
    const [log] = await p.auditLog.findMany();
    assert.equal(log.acao, 'ops_inicializacao');
    assert.equal(JSON.stringify(log).includes(SENHA) || JSON.stringify(log).includes(conta.senha_hash), false);
    assert.equal(await p.catalogoTipoEntidade.count(), 1, 'catálogo global preservado');
    assert.deepEqual(await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`), migrations);

    // Sessão antiga do tenant apagado: 401 em tudo. A conta nova entra.
    const get = (url, t) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${t}` } });
    assert.equal((await get('/lotes', tokenAntigo)).statusCode, 401);
    const novo = (await autenticarNoApp(app, { login: 'maike', senha: SENHA })).corpo.token;
    assert.ok(novo);
    const lotes = await get('/lotes', novo);
    assert.equal(lotes.statusCode, 200);
    // Ainda 'usuario': não cria contas até a elevação.
    const criar = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${novo}` }, payload: { nome: 'X', login: 'x.y', senha: 'outra-senha-123' } });
    assert.equal(criar.statusCode, 403);
    await app.close();
  });

  test('IT-08 preflight --sistema: confere o alvo antes de tudo', () => {
    const preflight = fileURLToPath(new URL('../../scripts/deploy/preflight-schema.mjs', import.meta.url));
    const run = (a) => spawnSync(process.execPath, [preflight, ...a], { encoding: 'utf8', env: { ...process.env } });
    const errado = run(['--sistema', '1234567']);
    assert.equal(errado.status, 1);
    assert.match(errado.stdout, /NÃO é o alvo/);
    assert.doesNotMatch(errado.stdout, /migrations:/, 'para antes de qualquer outra leitura');
    const certo = run(['--sistema', SID]);
    assert.match(certo.stdout, /alvo: system_identifier confere/);
    assert.match(certo.stdout, /migrations: 25\/25/);
  });

  test('IT-07 idempotente: rodar de novo não apaga a conta nova', async () => {
    await semear();
    const frase = rodar(['--sistema', SID]).stdout.match(/"(APAGAR [^"]+)"/)[1];
    assert.equal(rodar(['--sistema', SID, '--executar'], [frase, SENHA, SENHA]).status, 0);
    const id = (await prisma().usuario.findFirst()).id;
    const r = rodar(['--sistema', SID, '--executar'], ['x', SENHA, SENHA]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /já inicializado/);
    assert.equal((await prisma().usuario.findFirst()).id, id);
  });
});
