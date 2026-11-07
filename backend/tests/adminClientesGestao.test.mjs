/**
 * MAIKE-SAAS-ADMIN-S03 — gestão de clientes pelo MAIKE Admin.
 *
 * PostgreSQL local descartável, vários tenants reais. Prova:
 *  - só o proprietário com MFA, Origin permitida e CSRF escreve;
 *  - cliente + primeiro administrador nascem juntos (tudo ou nada), com senha
 *    temporária devolvida UMA vez e nunca persistida em texto/auditoria;
 *  - a senha autentica pelo login normal e a conta é administradora REAL da
 *    fazenda (papel_tenant), não `Permissao.is_admin`;
 *  - conflitos de código/login (inclusive em corrida) não deixam órfão;
 *  - edição só toca o alvo; suspensão derruba login novo E token já emitido,
 *    sem afetar outro tenant nem apagar dados; reativação recupera.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarSessaoAdmin, zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, criarAdminComSessao, ORIGEM_ADMIN } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  zerarLimitadorAdmin();
});

const enviar = (method, url, headers, payload) => app.inject({ method, url, headers, payload });
const novo = (extra = {}) => ({
  nome: 'Fazenda Nova Esperança',
  codigo: 'nova-esperanca',
  administrador: { nome: 'Maria Gestora', login: 'maria.esperanca' },
  ...extra,
});
/** Revisão bem formada que não corresponde a nenhuma ficha. */
const REV_FALSA = `"r1-${'A'.repeat(43)}"`;
const idDaUrl = (url) => url.split('/')[3];
/** GET da ficha (ETag) e só então a escrita com If-Match: o fluxo normal da tela. */
const revisaoAtual = async (id, headers) => (await enviar('GET', `/admin-maike/clientes/${id}`, headers)).headers.etag;
const escrever = async (method, url, headers, payload) =>
  enviar(method, url, { ...headers, 'if-match': (await revisaoAtual(idDaUrl(url), headers)) || REV_FALSA }, payload);
const SENHA_FORMATO = /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/;

describe('autorização das escritas', () => {
  test('GES-01 anônimo, JWT de fazenda, pré-MFA, Origin forjada e CSRF ausente: nada é gravado', async () => {
    const t = await criarTenant({ codigo: 'fazenda-existente', papelTenant: 'administrador' });
    const { headers } = await criarAdminComSessao(app);
    const { corpo } = await autenticarNoApp(app, t.credenciais);
    const pre = await criarSessaoAdmin(prisma(), { adminId: (await prisma().adminPrincipalMaike.findFirst()).id, mfaVerificado: false });
    const alvo = `/admin-maike/clientes/${t.cliente.id}`;
    const tentativas = [
      [{}, 401],
      [{ authorization: `Bearer ${corpo.token}`, origin: ORIGEM_ADMIN }, 403],
      [{ cookie: `maike_admin=${pre.token}`, origin: ORIGEM_ADMIN, 'x-maike-admin-csrf': pre.csrf }, 403],
      [{ ...headers, origin: 'https://evil.example' }, 403],
      [{ cookie: headers.cookie, origin: ORIGEM_ADMIN }, 403],
      [{ ...headers, 'x-maike-admin-csrf': 'csrf-forjado' }, 403],
    ];
    for (const [h, status] of tentativas) {
      for (const [method, url, payload] of [
        ['POST', '/admin-maike/clientes', novo()],
        ['PATCH', alvo, { nome: 'Invadido' }],
        ['POST', `${alvo}/situacao`, { ativo: false, justificativa: 'tentativa sem autorização' }],
      ]) {
        const r = await enviar(method, url, h, payload);
        assert.equal(r.statusCode, status, `${method} ${url} ${JSON.stringify(Object.keys(h))}`);
      }
    }
    assert.equal(await prisma().cliente.count(), 1);
    const c = await prisma().cliente.findUnique({ where: { id: t.cliente.id } });
    assert.equal(c.nome, t.cliente.nome);
    assert.equal(c.ativo, true);
  });
});

describe('cadastro de cliente com primeiro administrador', () => {
  test('GES-02 cria Cliente + Usuario administrador numa transação; senha temporária só nesta resposta, com no-store', async () => {
    const { headers } = await criarAdminComSessao(app);
    const r = await enviar('POST', '/admin-maike/clientes', headers, novo({ codigo: 'Nova-Esperanca' }));
    assert.equal(r.statusCode, 201, r.body);
    assert.match(String(r.headers['cache-control']), /no-store/);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo).sort(), ['administrador', 'cliente', 'senha_temporaria']);
    assert.equal(corpo.cliente.codigo, 'nova-esperanca', 'código normalizado em minúsculas');
    assert.equal(corpo.cliente.ativo, true);
    assert.deepEqual(Object.keys(corpo.administrador).sort(), ['id', 'login', 'nome']);
    assert.match(corpo.senha_temporaria, SENHA_FORMATO);

    const usuario = await prisma().usuario.findUnique({ where: { id: corpo.administrador.id } });
    assert.equal(usuario.cliente_id, corpo.cliente.id);
    assert.equal(usuario.papel_tenant, 'administrador');
    assert.equal(usuario.ativo, true);
    assert.match(usuario.senha_hash, /^\$2[aby]\$/, 'bcrypt do serviço de auth');
    assert.equal(usuario.senha_hash.includes(corpo.senha_temporaria), false);
    assert.equal(await prisma().permissao.count({ where: { cliente_id: corpo.cliente.id } }), 0, 'sem Permissao.is_admin forjado');
    assert.equal(await prisma().empresa.count({ where: { cliente_id: corpo.cliente.id } }), 0, 'empresa não é criada automaticamente');

    // Auditoria do produto: ator = proprietário, sem senha nem hash.
    const eventos = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'cliente_criar' } });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].sucesso, true);
    assert.ok(eventos[0].admin_id);
    assert.ok(eventos[0].request_id);
    assert.equal(eventos[0].dados.cliente_id, corpo.cliente.id);
    const todos = JSON.stringify(await prisma().eventoSegurancaAdminMaike.findMany());
    assert.equal(todos.includes(corpo.senha_temporaria), false);
    assert.equal(todos.includes(usuario.senha_hash), false);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: corpo.cliente.id } }), 0, 'sem ator de fazenda forjado');

    // Nenhuma leitura devolve a senha de novo.
    for (const url of ['/admin-maike/clientes', `/admin-maike/clientes/${corpo.cliente.id}`, `/admin-maike/clientes/${corpo.cliente.id}/usuarios`]) {
      const g = await enviar('GET', url, headers);
      assert.equal(g.statusCode, 200);
      assert.equal(g.body.includes(corpo.senha_temporaria), false, url);
      assert.equal(/senha|\$2[aby]\$/.test(g.body), false, url);
    }
  });

  test('GES-03 a senha temporária só abre a troca obrigatória (S04-P2); com a senha nova a conta é administradora REAL da fazenda', async () => {
    const { headers } = await criarAdminComSessao(app);
    const { administrador, senha_temporaria, cliente } = (await enviar('POST', '/admin-maike/clientes', headers, novo())).json();
    // S04-P2: a senha temporária não emite a sessão normal, só o token restrito da troca.
    const primeiro = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: administrador.login, senha: senha_temporaria } });
    assert.equal(primeiro.statusCode, 200, primeiro.body);
    assert.equal(primeiro.json().troca_senha_obrigatoria, true);
    assert.equal(primeiro.json().token, undefined);
    const troca = await app.inject({
      method: 'POST',
      url: '/auth/troca-senha-inicial',
      headers: { authorization: `Bearer ${primeiro.json().token_troca_senha}` },
      payload: { senha_atual: senha_temporaria, nova_senha: 'Senha-Nova-Da-Maria-1' },
    });
    assert.equal(troca.statusCode, 200, troca.body);
    const { resposta, corpo } = await autenticarNoApp(app, { login: administrador.login, senha: 'Senha-Nova-Da-Maria-1' });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const bearer = { authorization: `Bearer ${corpo.token}` };
    const ctx = await app.inject({ method: 'GET', url: '/auth/contexto', headers: bearer });
    assert.equal(ctx.statusCode, 200, ctx.body);
    assert.equal(ctx.json().administrador_fazenda, true);
    // Ação restrita ao administrador da fazenda (exigirAdminTenant): criar outra conta.
    const conta = await app.inject({ method: 'POST', url: '/usuarios', headers: bearer, payload: { nome: 'Peão', login: 'peao.esperanca', senha: 'senha-do-peao-1' } });
    assert.equal(conta.statusCode, 201, conta.body);
    assert.equal((await prisma().usuario.findUnique({ where: { id: conta.json().id } })).cliente_id, cliente.id);
    // Senha errada continua genérica.
    const errada = await autenticarNoApp(app, { login: administrador.login, senha: 'nao-e-a-senha' });
    assert.equal(errada.resposta.statusCode, 401);
  });

  test('GES-04 login já usado por conta ativa (qualquer tenant, sem diferenciar maiúsculas): 409 e nenhum cliente órfão', async () => {
    await criarTenant({ codigo: 'outra-fazenda', login: 'joao.silva' });
    const { headers } = await criarAdminComSessao(app);
    const antes = await prisma().cliente.count();
    const r = await enviar('POST', '/admin-maike/clientes', headers, novo({ administrador: { nome: 'João', login: 'JOAO.Silva' } }));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ADMIN_LOGIN_DUPLICADO');
    assert.equal(r.body.includes('outra-fazenda'), false, 'não revela o tenant dono do login');
    assert.equal(await prisma().cliente.count(), antes);
    assert.equal(await prisma().cliente.count({ where: { codigo: 'nova-esperanca' } }), 0);
  });

  test('GES-05 código repetido: 409; corrida com o mesmo código ou o mesmo login cria exatamente um', async () => {
    await criarTenant({ codigo: 'nova-esperanca' });
    const { headers } = await criarAdminComSessao(app);
    const dup = await enviar('POST', '/admin-maike/clientes', headers, novo());
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().code, 'ADMIN_CLIENTE_CODIGO_DUPLICADO');

    const base = await prisma().cliente.count();
    const mesmoCodigo = await Promise.all([
      enviar('POST', '/admin-maike/clientes', headers, novo({ codigo: 'corrida-a', administrador: { nome: 'Ana', login: 'login.a' } })),
      enviar('POST', '/admin-maike/clientes', headers, novo({ codigo: 'corrida-a', administrador: { nome: 'Bia', login: 'login.b' } })),
    ]);
    assert.deepEqual(mesmoCodigo.map((x) => x.statusCode).sort(), [201, 409]);
    const mesmoLogin = await Promise.all([
      enviar('POST', '/admin-maike/clientes', headers, novo({ codigo: 'corrida-b', administrador: { nome: 'Caio', login: 'mesmo.login' } })),
      enviar('POST', '/admin-maike/clientes', headers, novo({ codigo: 'corrida-c', administrador: { nome: 'Davi', login: 'mesmo.login' } })),
    ]);
    assert.deepEqual(mesmoLogin.map((x) => x.statusCode).sort(), [201, 409]);
    assert.equal(await prisma().cliente.count(), base + 2, 'sem tenant órfão da tentativa perdedora');
    assert.equal(await prisma().usuario.count({ where: { login: 'mesmo.login' } }), 1);
    const semAdmin = await prisma().cliente.findMany({ where: { usuarios: { none: {} } } });
    assert.deepEqual(semAdmin, []);
  });

  test('GES-06 campos forjados e formatos inválidos são recusados sem gravar', async () => {
    const { headers } = await criarAdminComSessao(app);
    const casos = [
      novo({ cliente_id: 'x' }),
      novo({ ativo: false }),
      novo({ id: 'cl_forjado' }),
      novo({ admin_id: 'x' }),
      novo({ administrador: { nome: 'X', login: 'x.y', papel_tenant: 'usuario' } }),
      novo({ administrador: { nome: 'X', login: 'x.y', senha: 'eu-escolho-123' } }),
      novo({ codigo: 'ab' }),
      novo({ codigo: 'com espaço' }),
      novo({ codigo: '-comeca-com-hifen' }),
      novo({ nome: ' ' }),
      novo({ administrador: { nome: 'X', login: 'tem espaço' } }),
      { nome: 'Só nome', codigo: 'so-nome' },
    ];
    for (const payload of casos) {
      const r = await enviar('POST', '/admin-maike/clientes', headers, payload);
      assert.ok([400, 422].includes(r.statusCode), `${JSON.stringify(payload)} → ${r.statusCode}`);
    }
    assert.equal(await prisma().cliente.count(), 0);
    assert.equal(await prisma().usuario.count(), 0);
  });
});

describe('edição e situação', () => {
  test('GES-07 editar nome/código só altera o alvo; código duplicado 409; contrato fechado; auditoria antes/depois', async () => {
    const a = await criarTenant({ codigo: 'fazenda-a' });
    const b = await criarTenant({ codigo: 'fazenda-b' });
    const { headers } = await criarAdminComSessao(app);
    const ok = await escrever('PATCH', `/admin-maike/clientes/${a.cliente.id}`, headers, { nome: 'Fazenda A Renomeada', codigo: 'fazenda-a2' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.match(String(ok.headers['cache-control']), /no-store/);
    assert.equal(ok.json().cliente.nome, 'Fazenda A Renomeada');
    assert.equal(ok.json().cliente.codigo, 'fazenda-a2');
    const intacto = await prisma().cliente.findUnique({ where: { id: b.cliente.id } });
    assert.equal(intacto.nome, b.cliente.nome);
    assert.equal(intacto.codigo, 'fazenda-b');

    const dup = await escrever('PATCH', `/admin-maike/clientes/${a.cliente.id}`, headers, { codigo: 'fazenda-b' });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().code, 'ADMIN_CLIENTE_CODIGO_DUPLICADO');
    for (const payload of [{}, { ativo: false }, { id: 'x' }, { cliente_id: 'x' }, { nome: 'x', usuarios_total: 9 }, { papel_tenant: 'administrador' }]) {
      const r = await escrever('PATCH', `/admin-maike/clientes/${a.cliente.id}`, headers, payload);
      assert.equal(r.statusCode, 400, JSON.stringify(payload));
    }
    const inexistente = await escrever('PATCH', '/admin-maike/clientes/cl_nao_existe_000', headers, { nome: 'X' });
    assert.equal(inexistente.statusCode, 422);
    const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'cliente_editar' } });
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0].dados.antes, { nome: a.cliente.nome, codigo: 'fazenda-a' });
    assert.deepEqual(ev[0].dados.depois, { nome: 'Fazenda A Renomeada', codigo: 'fazenda-a2' });
  });

  test('GES-08 suspender derruba login novo e token já emitido; outro tenant segue; reativar recupera; nada é apagado', async () => {
    const a = await criarTenant({ codigo: 'fazenda-suspensa' });
    const b = await criarTenant({ codigo: 'fazenda-vizinha' });
    const empresa = await prisma().empresa.create({ data: { cliente_id: a.cliente.id, numero_empresa: 1, apelido: 'Sede', nome: 'Sede Suspensa' } });
    const { headers } = await criarAdminComSessao(app);
    const tokenA = (await autenticarNoApp(app, a.credenciais)).corpo.token;
    const tokenB = (await autenticarNoApp(app, b.credenciais)).corpo.token;
    const ctx = (token) => app.inject({ method: 'GET', url: '/auth/contexto', headers: { authorization: `Bearer ${token}` } });
    assert.equal((await ctx(tokenA)).statusCode, 200);

    const semJustificativa = await escrever('POST', `/admin-maike/clientes/${a.cliente.id}/situacao`, headers, { ativo: false });
    assert.equal(semJustificativa.statusCode, 400);
    const curta = await escrever('POST', `/admin-maike/clientes/${a.cliente.id}/situacao`, headers, { ativo: false, justificativa: 'curta' });
    assert.equal(curta.statusCode, 400);

    const sus = await escrever('POST', `/admin-maike/clientes/${a.cliente.id}/situacao`, headers, { ativo: false, justificativa: 'inadimplência combinada com o cliente' });
    assert.equal(sus.statusCode, 200, sus.body);
    assert.equal(sus.json().cliente.ativo, false);
    assert.equal((await ctx(tokenA)).statusCode, 401, 'token emitido antes da suspensão perde o acesso na hora');
    assert.equal((await autenticarNoApp(app, a.credenciais)).resposta.statusCode, 401, 'login novo recusado');
    assert.equal((await ctx(tokenB)).statusCode, 200, 'outro tenant não é afetado');
    assert.equal((await autenticarNoApp(app, b.credenciais)).resposta.statusCode, 200);

    const repetida = await escrever('POST', `/admin-maike/clientes/${a.cliente.id}/situacao`, headers, { ativo: false, justificativa: 'suspensão repetida por engano' });
    assert.equal(repetida.statusCode, 422);

    // Nada apagado: conta, empresa e o próprio cliente continuam lá.
    assert.ok(await prisma().empresa.findUnique({ where: { id: empresa.id } }));
    assert.equal((await prisma().usuario.findUnique({ where: { id: a.usuario.id } })).ativo, true);

    const re = await escrever('POST', `/admin-maike/clientes/${a.cliente.id}/situacao`, headers, { ativo: true, justificativa: 'pagamento regularizado pelo cliente' });
    assert.equal(re.statusCode, 200);
    assert.equal(re.json().cliente.ativo, true);
    assert.equal((await autenticarNoApp(app, a.credenciais)).resposta.statusCode, 200, 'reativado volta a entrar');

    const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: { in: ['cliente_suspender', 'cliente_reativar'] } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(ev.map((e) => e.acao), ['cliente_suspender', 'cliente_reativar']);
    assert.equal(ev[0].dados.justificativa, 'inadimplência combinada com o cliente');
    assert.equal(ev[0].dados.cliente_id, a.cliente.id);
  });

  test('GES-09 leituras da S01 continuam com a mesma projeção depois das escritas', async () => {
    const { headers } = await criarAdminComSessao(app);
    const criado = (await enviar('POST', '/admin-maike/clientes', headers, novo())).json();
    const lista = (await enviar('GET', '/admin-maike/clientes', headers)).json();
    assert.deepEqual(Object.keys(lista.items[0]).sort(), ['ativo', 'codigo', 'criado_em', 'empresas_total', 'id', 'nome', 'usuarios_total']);
    assert.equal(lista.items[0].usuarios_total, 1);
    const ficha = (await enviar('GET', `/admin-maike/clientes/${criado.cliente.id}`, headers)).json();
    assert.deepEqual(ficha.contagens, { usuarios: 1, usuarios_ativos: 1, empresas: 0 });
    const usuarios = (await enviar('GET', `/admin-maike/clientes/${criado.cliente.id}/usuarios`, headers)).json();
    // S04-P3: + `revisao` (opaca, para o If-Match da reemissão de senha).
    assert.deepEqual(Object.keys(usuarios.items[0]).sort(), ['ativo', 'criado_em', 'id', 'login', 'nome', 'revisao']);
    assert.match(usuarios.items[0].revisao, /^"u1-[A-Za-z0-9_-]{43}"$/);
  });

  test('GES-10 proprietário inexistente no payload não muda o ator: auditoria usa a sessão', async () => {
    const { headers, admin } = await criarAdminComSessao(app);
    const r = await enviar('POST', '/admin-maike/clientes', headers, novo({ admin_id: 'cl_outro_admin' }));
    assert.equal(r.statusCode, 400);
    const ok = await enviar('POST', '/admin-maike/clientes', headers, novo());
    assert.equal(ok.statusCode, 201);
    const ev = await prisma().eventoSegurancaAdminMaike.findFirst({ where: { acao: 'cliente_criar' } });
    assert.equal(ev.admin_id, admin.id);
  });
});

/**
 * S03-R1 — concorrência e semântica de token.
 *
 * Barreira determinística: uma transação à parte segura a linha do cliente
 * (`SELECT … FOR UPDATE`). As duas edições leem (leitura simples não espera
 * lock), param no UPDATE e só seguem quando o `pg_stat_activity` mostra AS
 * DUAS esperando lock. Assim ambas leram o mesmo estado antes de qualquer
 * escrita — exatamente a janela em que o `antes` da auditoria podia mentir.
 */
const esperarBloqueadas = async (n) => {
  for (let i = 0; i < 400; i += 1) {
    const [{ qtd }] = await prisma().$queryRaw`SELECT count(*)::int AS qtd FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (qtd >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`esperava ${n} transações aguardando lock`);
};

/** Segura a linha, dispara `disparar()` e solta só depois de `n` esperas; `alterar` roda dentro da trava. */
const comLinhaPresa = async (id, n, disparar, alterar) => {
  let pedidos;
  await prisma().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Cliente" WHERE id = ${id} FOR UPDATE`;
      pedidos = disparar();
      await esperarBloqueadas(n);
      if (alterar) await alterar(tx);
    },
    { timeout: 15000 }
  );
  return Promise.all(pedidos);
};

describe('S03-R1 concorrência da edição e auditoria', () => {
  test('GES-11 duas edições do mesmo cliente lidas no mesmo estado: uma grava, a outra 409 sem evento; auditoria = estados persistidos', async () => {
    for (const [pa, pb] of [
      [{ nome: 'Nome da Sessão A' }, { nome: 'Nome da Sessão B' }],
      [{ codigo: 'codigo-sessao-a' }, { nome: 'Nome da Sessão B' }],
    ]) {
      await limparBanco();
      zerarLimitadorAdmin();
      const alvo = await criarTenant({ codigo: 'fazenda-disputada' });
      const vizinho = await criarTenant({ codigo: 'fazenda-vizinha' });
      const { headers } = await criarAdminComSessao(app);
      const url = `/admin-maike/clientes/${alvo.cliente.id}`;
      const original = await prisma().cliente.findUnique({ where: { id: alvo.cliente.id } });

      const [ra, rb] = await comLinhaPresa(alvo.cliente.id, 2, () => [escrever('PATCH', url, headers, pa), escrever('PATCH', url, headers, pb)]);
      const status = [ra.statusCode, rb.statusCode].sort();
      assert.deepEqual(status, [200, 409], `${ra.body} | ${rb.body}`);
      const perdedor = ra.statusCode === 409 ? ra : rb;
      const vencedor = ra.statusCode === 200 ? ra : rb;
      assert.equal(perdedor.json().code, 'ADMIN_CLIENTE_EDICAO_CONCORRENTE');

      const final = await prisma().cliente.findUnique({ where: { id: alvo.cliente.id } });
      assert.equal(final.nome, vencedor.json().cliente.nome);
      assert.equal(final.codigo, vencedor.json().cliente.codigo);
      const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'cliente_editar' } });
      assert.equal(ev.length, 1, 'quem perdeu não audita sucesso');
      assert.deepEqual(ev[0].dados.antes, { nome: original.nome, codigo: original.codigo });
      assert.deepEqual(ev[0].dados.depois, { nome: final.nome, codigo: final.codigo });
      const v = await prisma().cliente.findUnique({ where: { id: vizinho.cliente.id } });
      assert.equal(v.nome, vizinho.cliente.nome);
      assert.equal(v.codigo, 'fazenda-vizinha');
    }
  });

  test('GES-12 edição lida antes de outra escrita já confirmada é recusada (409), sem evento; a seguinte audita o antes real', async () => {
    const alvo = await criarTenant({ codigo: 'fazenda-alterada' });
    const { headers } = await criarAdminComSessao(app);
    const url = `/admin-maike/clientes/${alvo.cliente.id}`;
    // A edição lê, espera a trava; dentro da trava outra escrita muda o nome (e o updatedAt).
    const [r] = await comLinhaPresa(
      alvo.cliente.id,
      1,
      () => [escrever('PATCH', url, headers, { codigo: 'codigo-defasado' })],
      (tx) => tx.$executeRaw`UPDATE "Cliente" SET nome = 'Mudado por fora', "updatedAt" = now() WHERE id = ${alvo.cliente.id}`
    );
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ADMIN_CLIENTE_EDICAO_CONCORRENTE');
    let atual = await prisma().cliente.findUnique({ where: { id: alvo.cliente.id } });
    assert.equal(atual.codigo, 'fazenda-alterada', 'nada gravado pela edição defasada');
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'cliente_editar' } }), 0);

    const ok = await escrever('PATCH', url, headers, { codigo: 'codigo-revisado' });
    assert.equal(ok.statusCode, 200, ok.body);
    atual = await prisma().cliente.findUnique({ where: { id: alvo.cliente.id } });
    const [ev] = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'cliente_editar' } });
    assert.deepEqual(ev.dados.antes, { nome: 'Mudado por fora', codigo: 'fazenda-alterada' });
    assert.deepEqual(ev.dados.depois, { nome: 'Mudado por fora', codigo: 'codigo-revisado' });
    assert.ok(atual.updatedAt > alvo.cliente.updatedAt, 'updatedAt avança a cada escrita');
  });

  test('GES-13 dois clientes disputando o mesmo código novo: um 200, outro 409 CODIGO_DUPLICADO, um único evento', async () => {
    const a = await criarTenant({ codigo: 'fazenda-um' });
    const b = await criarTenant({ codigo: 'fazenda-dois' });
    const { headers } = await criarAdminComSessao(app);
    const rs = await Promise.all([a, b].map((t) => escrever('PATCH', `/admin-maike/clientes/${t.cliente.id}`, headers, { codigo: 'codigo-cobicado' })));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(rs.find((r) => r.statusCode === 409).json().code, 'ADMIN_CLIENTE_CODIGO_DUPLICADO');
    assert.equal(await prisma().cliente.count({ where: { codigo: 'codigo-cobicado' } }), 1);
    const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'cliente_editar' } });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].dados.depois.codigo, 'codigo-cobicado');
  });

  test('GES-14 suspensões simultâneas: uma grava, a outra recusa; um único evento de suspensão', async () => {
    const alvo = await criarTenant({ codigo: 'fazenda-dupla-suspensao' });
    const { headers } = await criarAdminComSessao(app);
    const url = `/admin-maike/clientes/${alvo.cliente.id}/situacao`;
    const corpo = { ativo: false, justificativa: 'suspensão disparada duas vezes' };
    const rs = await comLinhaPresa(alvo.cliente.id, 2, () => [escrever('POST', url, headers, corpo), escrever('POST', url, headers, corpo)]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' | '));
    assert.equal(rs.find((r) => r.statusCode === 409).json().code, 'ADMIN_CLIENTE_EDICAO_CONCORRENTE');
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'cliente_suspender' } }), 1);
  });
});

describe('S03-R1 semântica do token de fazenda na suspensão', () => {
  test('GES-15 mesmo JWT: 200 → suspender → 401 → reativar → 401 (S04-P1: revogação permanente); login novo = 200', async () => {
    const t = await criarTenant({ codigo: 'fazenda-token' });
    const { headers } = await criarAdminComSessao(app);
    const tokenA = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const ctx = () => app.inject({ method: 'GET', url: '/auth/contexto', headers: { authorization: `Bearer ${tokenA}` } });
    const url = `/admin-maike/clientes/${t.cliente.id}/situacao`;
    assert.equal((await ctx()).statusCode, 200);
    assert.equal((await escrever('POST', url, headers, { ativo: false, justificativa: 'teste de semântica do token' })).statusCode, 200);
    assert.equal((await ctx()).statusCode, 401, 'enquanto suspenso, o token antigo é recusado');
    assert.equal((await escrever('POST', url, headers, { ativo: true, justificativa: 'teste de semântica do token' })).statusCode, 200);
    // Até o S03 o mesmo token voltava a valer aqui (200). Desde o S04-P1 a
    // suspensão avança Cliente.sessao_epoca: o token anterior morre de vez.
    assert.equal((await ctx()).statusCode, 401, 'mesmo token continua recusado após reativar');
    assert.equal((await autenticarNoApp(app, t.credenciais)).resposta.statusCode, 200, 'login novo funciona');
  });
});

describe('S03-R2 revisão da ficha (ETag / If-Match)', () => {
  test('GES-16 ficha obsoleta: A e B leem X; A salva Y; B com a revisão X recebe 409, sem gravar nem auditar', async () => {
    const alvo = await criarTenant({ codigo: 'fazenda-ficha-velha' });
    const { headers } = await criarAdminComSessao(app);
    const url = `/admin-maike/clientes/${alvo.cliente.id}`;
    const fichaA = await enviar('GET', url, headers);
    const fichaB = await enviar('GET', url, headers);
    const revX = fichaB.headers.etag;
    assert.match(String(revX), /^"r1-[A-Za-z0-9_-]{43}"$/);
    assert.equal(fichaA.headers.etag, revX, 'mesmo estado, mesma revisão');
    assert.deepEqual(Object.keys(fichaB.json()).sort(), ['cliente', 'contagens'], 'projeção JSON da S01 intacta');

    const a = await enviar('PATCH', url, { ...headers, 'if-match': fichaA.headers.etag }, { nome: 'Nome Salvo por A' });
    assert.equal(a.statusCode, 200, a.body);
    assert.notEqual(a.headers.etag, revX, 'a escrita devolve a revisão nova');

    // Minutos depois, B envia o formulário antigo: o estado atual (Y) seria
    // aceito pelo CAS intra-requisição; a revisão da ficha é que denuncia.
    const b = await enviar('PATCH', url, { ...headers, 'if-match': revX }, { nome: 'Nome Velho de B' });
    assert.equal(b.statusCode, 409, b.body);
    assert.equal(b.json().code, 'ADMIN_CLIENTE_EDICAO_CONCORRENTE');
    const sus = await enviar('POST', `${url}/situacao`, { ...headers, 'if-match': revX }, { ativo: false, justificativa: 'ficha antiga tentando suspender' });
    assert.equal(sus.statusCode, 409, sus.body);

    const atual = await prisma().cliente.findUnique({ where: { id: alvo.cliente.id } });
    assert.equal(atual.nome, 'Nome Salvo por A');
    assert.equal(atual.ativo, true);
    const ev = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: { in: ['cliente_editar', 'cliente_suspender'] } } });
    assert.deepEqual(ev.map((e) => e.acao), ['cliente_editar'], 'só o sucesso de A é auditado');

    // Com a revisão nova (devolvida por A), a situação passa; e ficha velha de reativação também é barrada.
    const ok = await enviar('POST', `${url}/situacao`, { ...headers, 'if-match': a.headers.etag }, { ativo: false, justificativa: 'suspensão com ficha atual' });
    assert.equal(ok.statusCode, 200, ok.body);
    const reVelha = await enviar('POST', `${url}/situacao`, { ...headers, 'if-match': a.headers.etag }, { ativo: true, justificativa: 'reativação com ficha velha' });
    assert.equal(reVelha.statusCode, 409, reVelha.body);
    const reOk = await enviar('POST', `${url}/situacao`, { ...headers, 'if-match': ok.headers.etag }, { ativo: true, justificativa: 'reativação com ficha atual' });
    assert.equal(reOk.statusCode, 200, reOk.body);
  });

  test('GES-17 If-Match ausente, malformado, fraco ou de outro cliente: 428/409; nunca há caminho desprotegido', async () => {
    const a = await criarTenant({ codigo: 'fazenda-pre-a' });
    const b = await criarTenant({ codigo: 'fazenda-pre-b' });
    const { headers } = await criarAdminComSessao(app);
    const url = `/admin-maike/clientes/${a.cliente.id}`;
    const revB = (await enviar('GET', `/admin-maike/clientes/${b.cliente.id}`, headers)).headers.etag;
    const revA = (await enviar('GET', url, headers)).headers.etag;
    for (const [rev, status] of [
      [undefined, 428],
      ['', 428],
      ['*', 428],
      ['r1-semaspas', 428],
      [`W/${revA}`, 428],
      [`${revA}, ${revB}`, 428],
      [REV_FALSA, 409],
      [revB, 409],
    ]) {
      const h = rev === undefined ? headers : { ...headers, 'if-match': rev };
      const p = await enviar('PATCH', url, h, { nome: 'Sem Revisão Válida' });
      assert.equal(p.statusCode, status, `PATCH if-match=${rev}`);
      if (status === 428) assert.equal(p.json().code, 'ADMIN_REVISAO_REQUERIDA');
      const s = await enviar('POST', `${url}/situacao`, h, { ativo: false, justificativa: 'sem revisão válida aqui' });
      assert.equal(s.statusCode, status, `situacao if-match=${rev}`);
    }
    const c = await prisma().cliente.findUnique({ where: { id: a.cliente.id } });
    assert.equal(c.nome, a.cliente.nome);
    assert.equal(c.ativo, true);
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: { in: ['cliente_editar', 'cliente_suspender'] } } }), 0);
    // O corpo continua fechado: revisão no corpo é campo desconhecido (400), não atalho.
    const noCorpo = await enviar('PATCH', url, { ...headers, 'if-match': revA }, { nome: 'X Y', revisao: revA });
    assert.equal(noCorpo.statusCode, 400);
  });
});
