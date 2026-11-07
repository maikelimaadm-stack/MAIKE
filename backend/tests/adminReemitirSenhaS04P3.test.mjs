/**
 * MAIKE-SAAS-ADMIN-S04-P3 PR01 — reemissão segura de senha temporária pelo MAIKE Admin.
 *
 * PostgreSQL local descartável, API Fastify real e MAIKE Admin real (MFA).
 * Prova:
 *  - só o proprietário verificado, com Origin/CSRF e reautenticação (senha +
 *    TOTP novo), reemite;
 *  - a conta é alvo só dentro do próprio cliente, ativa, de cliente ativo e
 *    com a revisão lida (If-Match);
 *  - a escrita é atômica (senha + pendência + época + auditoria); em corrida
 *    há um único vencedor; a senha antiga cai; a nova só abre a troca
 *    obrigatória do S04-P2; as sessões antigas morrem para sempre;
 *  - nada além da conta alvo muda.
 */

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { codigoTotp, passoTotpAtual } from '../src/modules/adminMaike/adminCrypto.js';
import { criarApp, criarTenant, limparBanco, encerrar, criarAdminComSessao, ORIGEM_ADMIN } from './helpers.mjs';

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
// R1: o gate de ativação nasce DESLIGADO (variável ausente no ambiente de
// teste, como em Production/Preview). Cada teste liga explicitamente no objeto
// `env` deste processo isolado e o valor original volta no afterEach — nada
// vaza para outros testes nem para `process.env`.
const GATE_ORIGINAL = env.adminReemissaoSenhaHabilitada;
beforeEach(async () => {
  await limparBanco();
  zerarLimitadorAdmin();
  env.adminReemissaoSenhaHabilitada = true;
});
afterEach(() => {
  env.adminReemissaoSenhaHabilitada = GATE_ORIGINAL;
});

const SENHA_FORMATO = /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/;
const JUST = 'administrador perdeu a senha inicial';
const enviar = (method, url, headers, payload) => app.inject({ method, url, headers, payload });
const login = (credenciais) => app.inject({ method: 'POST', url: '/auth/login', payload: credenciais });
const contexto = (token) => app.inject({ method: 'GET', url: '/auth/contexto', headers: { authorization: `Bearer ${token}` } });
const conta = (id) => prisma().usuario.findUnique({ where: { id } });
const urlReemitir = (clienteId, usuarioId) => `/admin-maike/clientes/${clienteId}/usuarios/${usuarioId}/reemitir-senha`;

/** Laboratório: proprietário com MFA, uma fazenda nova (S03) e uma fazenda vizinha preexistente. */
const laboratorio = async () => {
  const dono = await criarAdminComSessao(app);
  const r = await enviar('POST', '/admin-maike/clientes', dono.headers, {
    nome: 'Fazenda Laboratório',
    codigo: 'fazenda-lab',
    administrador: { nome: 'Ana Gestora', login: 'ana.lab' },
  });
  assert.equal(r.statusCode, 201, r.body);
  const nova = r.json();
  const vizinha = await criarTenant({ codigo: 'vizinha', login: 'joao.vizinho' });
  return { dono, cliente: nova.cliente, usuario: nova.administrador, senhaInicial: nova.senha_temporaria, vizinha };
};

/** Revisão da conta como a ficha mostra (GET da listagem). */
const revisaoDe = async (headers, clienteId, usuarioId) => {
  const r = await enviar('GET', `/admin-maike/clientes/${clienteId}/usuarios`, headers);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().items.find((u) => u.id === usuarioId)?.revisao;
};

const reemitir = async (lab, { usuarioId = lab.usuario.id, clienteId = lab.cliente.id, revisao, codigo, senha, headers, corpoExtra = {} } = {}) => {
  const rev = revisao === undefined ? await revisaoDe(lab.dono.headers, clienteId, usuarioId) : revisao;
  return enviar(
    'POST',
    urlReemitir(clienteId, usuarioId),
    { ...(headers ?? lab.dono.headers), ...(rev ? { 'if-match': rev } : {}) },
    { justificativa: JUST, senha_admin_atual: senha ?? lab.dono.senha, codigo_mfa: codigo ?? (await lab.dono.proximoCodigo()), ...corpoExtra }
  );
};

/** Trigger temporária que faz o INSERT de auditoria do admin falhar (rollback real). */
const comAuditoriaAdminQuebrada = async (fn) => {
  const db = prisma();
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION s04p3_falhar() RETURNS trigger AS $$ BEGIN IF NEW.acao = 'usuario_senha_reemitir' AND NEW.sucesso THEN RAISE EXCEPTION 's04p3 auditoria falhou'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER s04p3_falhar BEFORE INSERT ON "EventoSegurancaAdminMaike" FOR EACH ROW EXECUTE FUNCTION s04p3_falhar()`);
  try {
    return await fn();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS s04p3_falhar ON "EventoSegurancaAdminMaike"`);
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS s04p3_falhar()');
  }
};

/** Assinatura dos dados que NÃO podem mudar (contas vizinhas, clientes, empresas, permissões). */
const assinatura = async (excetoUsuarioId) => ({
  clientes: await prisma().cliente.findMany({ orderBy: { id: 'asc' }, select: { id: true, nome: true, codigo: true, ativo: true, sessao_epoca: true, updatedAt: true } }),
  usuarios: await prisma().usuario.findMany({ where: { id: { not: excetoUsuarioId } }, orderBy: { id: 'asc' } }),
  empresas: await prisma().empresa.count(),
  permissoes: await prisma().permissao.count(),
  auditoriaFazenda: await prisma().auditLog.count(),
});

describe('S04-P3 R1 — gate de ativação ADMIN_REEMISSAO_SENHA_HABILITADA (fail-closed)', () => {
  test('RS-00a sem a variável o gate nasce fechado (como em Production/Preview); só o literal "true" liga', () => {
    assert.equal(GATE_ORIGINAL, false, 'ambiente de teste sem ADMIN_REEMISSAO_SENHA_HABILITADA = desligado');
    const envJs = fileURLToPath(new URL('../src/config/env.js', import.meta.url));
    // Processo filho com diretório vazio (nenhum .env alcançável) e só a variável em teste.
    const vazio = mkdtempSync(join(tmpdir(), 's04p3-gate-'));
    const ler = (valor) => {
      const filho = { ...process.env, DOTENV_CONFIG_QUIET: 'true' };
      delete filho.ADMIN_REEMISSAO_SENHA_HABILITADA;
      if (valor !== undefined) filho.ADMIN_REEMISSAO_SENHA_HABILITADA = valor;
      const saida = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', `const m = await import(${JSON.stringify(envJs)}); process.stdout.write(String(m.reemissaoSenhaHabilitada()));`],
        { env: filho, cwd: vazio }
      );
      return String(saida).trim().split('\n').pop();
    };
    for (const valor of [undefined, '', ' ', 'false', '0', '1', 'yes', 'TRUE', 'True', ' true', 'true ', 'on']) {
      assert.equal(ler(valor), 'false', `valor ${JSON.stringify(valor)} deve manter fechado`);
    }
    assert.equal(ler('true'), 'true');
    rmSync(vazio, { recursive: true, force: true });
  });

  test('RS-00b gate desligado: POST = 503 antes de tudo; nenhuma senha/pendência/época/auditoria/TOTP/sessão muda; a lista não oferece', async () => {
    const lab = await laboratorio();
    const rev = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    const lista = (await enviar('GET', `/admin-maike/clientes/${lab.cliente.id}/usuarios`, lab.dono.headers)).json();
    assert.equal(lista.items.find((u) => u.id === lab.usuario.id).reemissao_disponivel, true, 'ligado: a lista oferece');
    const codigo = await lab.dono.proximoCodigo();

    env.adminReemissaoSenhaHabilitada = false;
    const desligada = (await enviar('GET', `/admin-maike/clientes/${lab.cliente.id}/usuarios`, lab.dono.headers)).json();
    assert.ok(desligada.items.length > 0);
    for (const u of desligada.items) assert.equal(u.reemissao_disponivel, false, 'desligado: a lista não oferece');

    const contaAntes = await conta(lab.usuario.id);
    const adminAntes = await prisma().adminPrincipalMaike.findMany({ orderBy: { id: 'asc' } });
    const sessoesAntes = await prisma().sessaoAdminMaike.findMany({ orderBy: { id: 'asc' } });
    const eventosAntes = await prisma().eventoSegurancaAdminMaike.count();
    const sig = await assinatura(lab.usuario.id);

    const tentativas = [
      // proprietário verificado, corpo e If-Match corretos, TOTP novo
      () => enviar('POST', urlReemitir(lab.cliente.id, lab.usuario.id), { ...lab.dono.headers, 'if-match': rev }, { justificativa: JUST, senha_admin_atual: lab.dono.senha, codigo_mfa: codigo }),
      // HTTP direto sem cookie/CSRF/Origin (Preview ou script): mesma resposta, sem oráculo
      () => enviar('POST', urlReemitir(lab.cliente.id, lab.usuario.id), {}, {}),
      // conta inexistente / de outro cliente: mesma resposta, não revela existência
      () => enviar('POST', urlReemitir(lab.cliente.id, lab.vizinha.usuario?.id ?? 'zzzzzzzzzzzzzzzzzzzzzzzzz'), { ...lab.dono.headers, 'if-match': rev }, { justificativa: JUST, senha_admin_atual: lab.dono.senha, codigo_mfa: codigo }),
      () => enviar('POST', urlReemitir('naoexiste000000000000000', 'naoexiste000000000000000'), { ...lab.dono.headers, 'if-match': rev }, { justificativa: JUST, senha_admin_atual: 'errada', codigo_mfa: '000000' }),
    ];
    const corpos = [];
    for (let i = 0; i < 12; i++) {
      const r = await tentativas[i % tentativas.length]();
      assert.equal(r.statusCode, 503, r.body);
      assert.match(String(r.headers['cache-control']), /no-store/);
      const corpo = r.json();
      assert.equal(corpo.code, 'ADMIN_REEMISSAO_SENHA_DESABILITADA');
      assert.doesNotMatch(r.body, /ana\.lab|Ana Gestora|joao|senha_temporaria|\$2[aby]\$/i);
      corpos.push(JSON.stringify({ code: corpo.code, message: corpo.message }));
    }
    assert.equal(new Set(corpos).size, 1, 'resposta idêntica para qualquer alvo/credencial');

    assert.deepEqual(await conta(lab.usuario.id), contaAntes, 'senha, pendência, época e updatedAt intactos');
    assert.deepEqual(await prisma().adminPrincipalMaike.findMany({ orderBy: { id: 'asc' } }), adminAntes, 'TOTP não consumido; sem falha de senha contada');
    assert.deepEqual(await prisma().sessaoAdminMaike.findMany({ orderBy: { id: 'asc' } }), sessoesAntes, 'sessão admin intocada');
    assert.equal(await prisma().eventoSegurancaAdminMaike.count(), eventosAntes, 'nenhum evento de auditoria');
    assert.deepEqual(await assinatura(lab.usuario.id), sig);

    // O limitador também não foi tocado: ligado de novo, o MESMO TOTP ainda vale e a reemissão funciona.
    env.adminReemissaoSenhaHabilitada = true;
    const ok = await enviar('POST', urlReemitir(lab.cliente.id, lab.usuario.id), { ...lab.dono.headers, 'if-match': rev }, { justificativa: JUST, senha_admin_atual: lab.dono.senha, codigo_mfa: codigo });
    assert.equal(ok.statusCode, 200, ok.body);
  });
});

describe('S04-P3 reemissão — caminho feliz e ciclo completo', () => {
  test('RS-01 proprietário verificado reemite: 200 mínimo, no-store, sem token/hash; senha nova; pendência e época; auditoria sem segredo', async () => {
    const lab = await laboratorio();
    const antes = await conta(lab.usuario.id);
    const sig = await assinatura(lab.usuario.id);
    const r = await reemitir(lab);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(String(r.headers['cache-control']), /no-store/);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo).sort(), ['senha_temporaria', 'sessoes_revogadas', 'troca_senha_obrigatoria', 'usuario']);
    assert.deepEqual(corpo.usuario, { id: lab.usuario.id, nome: 'Ana Gestora', login: 'ana.lab' });
    assert.equal(corpo.troca_senha_obrigatoria, true);
    assert.equal(corpo.sessoes_revogadas, true);
    assert.match(corpo.senha_temporaria, SENHA_FORMATO);
    assert.notEqual(corpo.senha_temporaria, lab.senhaInicial);
    assert.doesNotMatch(r.body, /token|hash|\$2[aby]\$/i);

    const depois = await conta(lab.usuario.id);
    assert.notEqual(depois.senha_hash, antes.senha_hash);
    assert.equal(depois.troca_senha_pendente, true);
    assert.equal(depois.sessao_epoca, 1, 'S04-P1: época +1');
    assert.equal(depois.papel_tenant, antes.papel_tenant);
    assert.equal(depois.ativo, true);
    assert.equal(depois.nome, antes.nome);
    assert.equal(depois.login, antes.login);

    const eventos = await prisma().eventoSegurancaAdminMaike.findMany({ where: { acao: 'usuario_senha_reemitir' } });
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].sucesso, true);
    assert.equal(eventos[0].admin_id, lab.dono.admin.id);
    assert.deepEqual(eventos[0].dados, {
      cliente_id: lab.cliente.id,
      usuario: { id: lab.usuario.id, login: 'ana.lab' },
      justificativa: JUST,
      troca_senha_obrigatoria: true,
      sessoes_revogadas: true,
      sessao_epoca: { antes: 0, depois: 1 },
    });
    const tudo = JSON.stringify(await prisma().eventoSegurancaAdminMaike.findMany());
    for (const segredo of [corpo.senha_temporaria, lab.dono.senha, depois.senha_hash]) assert.equal(tudo.includes(segredo), false);

    // Nenhuma leitura devolve a senha de novo.
    for (const url of [`/admin-maike/clientes/${lab.cliente.id}`, `/admin-maike/clientes/${lab.cliente.id}/usuarios`]) {
      assert.equal((await enviar('GET', url, lab.dono.headers)).body.includes(corpo.senha_temporaria), false);
    }
    assert.deepEqual(await assinatura(lab.usuario.id), sig, 'nada além da conta alvo mudou');
  });

  test('RS-02 ciclo: senha antiga 401; nova só abre a etapa restrita; S04-P2 conclui; sessão antiga morre; login final normal', async () => {
    const lab = await laboratorio();
    // Conta já em uso: troca inicial concluída e sessão normal aberta.
    const r0 = await login({ login: 'ana.lab', senha: lab.senhaInicial });
    await app.inject({
      method: 'POST',
      url: '/auth/troca-senha-inicial',
      headers: { authorization: `Bearer ${r0.json().token_troca_senha}` },
      payload: { senha_atual: lab.senhaInicial, nova_senha: 'Senha-Antiga-Da-Ana-1' },
    });
    const sessaoAntiga = (await login({ login: 'ana.lab', senha: 'Senha-Antiga-Da-Ana-1' })).json().token;
    assert.equal((await contexto(sessaoAntiga)).statusCode, 200);
    const tokenVizinho = (await login(lab.vizinha.credenciais)).json().token;

    const r = await reemitir(lab);
    assert.equal(r.statusCode, 200, r.body);
    const temporaria = r.json().senha_temporaria;

    assert.equal((await contexto(sessaoAntiga)).statusCode, 401, 'sessão anterior revogada');
    assert.equal((await login({ login: 'ana.lab', senha: 'Senha-Antiga-Da-Ana-1' })).statusCode, 401, 'senha antiga não entra');
    const etapa = await login({ login: 'ana.lab', senha: temporaria });
    assert.equal(etapa.statusCode, 200);
    assert.deepEqual(Object.keys(etapa.json()).sort(), ['expira_em_segundos', 'token_troca_senha', 'troca_senha_obrigatoria']);
    assert.equal((await contexto(etapa.json().token_troca_senha)).statusCode, 401, 'token restrito não abre a fazenda');

    const troca = await app.inject({
      method: 'POST',
      url: '/auth/troca-senha-inicial',
      headers: { authorization: `Bearer ${etapa.json().token_troca_senha}` },
      payload: { senha_atual: temporaria, nova_senha: 'Senha-Final-Da-Ana-2' },
    });
    assert.equal(troca.statusCode, 200, troca.body);
    assert.equal((await conta(lab.usuario.id)).sessao_epoca, 3, 'troca inicial (1) + reemissão (2) + conclusão (3)');
    assert.equal((await login({ login: 'ana.lab', senha: temporaria })).statusCode, 401);
    const final = await login({ login: 'ana.lab', senha: 'Senha-Final-Da-Ana-2' });
    assert.equal(final.statusCode, 200);
    assert.equal((await contexto(final.json().token)).statusCode, 200);
    assert.equal((await contexto(sessaoAntiga)).statusCode, 401, 'continua morta para sempre');
    assert.equal((await contexto(tokenVizinho)).statusCode, 200, 'outro cliente intacto');
  });
});

describe('S04-P3 reemissão — autenticação, origem e reautenticação', () => {
  test('RS-03 sem cookie, sem MFA, Origin errada, sem CSRF, senha atual errada ou TOTP inválido: recusa e nada muda', async () => {
    const lab = await laboratorio();
    const antes = await conta(lab.usuario.id);
    const rev = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    const { cookie, 'x-maike-admin-csrf': csrf } = lab.dono.headers;
    const casos = [
      ['sem cookie', { origin: ORIGEM_ADMIN, 'x-maike-admin-csrf': csrf }, {}, 401],
      ['Origin estranha', { origin: 'https://evil.example', cookie, 'x-maike-admin-csrf': csrf }, {}, 403],
      ['sem CSRF', { origin: ORIGEM_ADMIN, cookie }, {}, 403],
      ['senha atual errada', lab.dono.headers, { senha: 'nao-e-a-senha-1' }, 401],
      ['TOTP inválido', lab.dono.headers, { codigo: '000000' }, 401],
    ];
    for (const [nome, headers, extra, status] of casos) {
      const r = await reemitir(lab, { headers, revisao: rev, ...extra });
      assert.equal(r.statusCode, status, `${nome}: ${r.body}`);
      assert.equal(r.body.includes(lab.dono.senha), false);
    }
    const depois = await conta(lab.usuario.id);
    assert.equal(depois.senha_hash, antes.senha_hash);
    assert.equal(depois.sessao_epoca, antes.sessao_epoca);
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'usuario_senha_reemitir', sucesso: true } }), 0);
    assert.ok((await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'usuario_senha_reemitir', sucesso: false } })) >= 2, 'falhas de reautenticação auditadas');
  });

  test('RS-04 TOTP reutilizado é recusado (passo consumido não volta a valer)', async () => {
    const lab = await laboratorio();
    const codigo = await lab.dono.proximoCodigo();
    const ok = await reemitir(lab, { codigo });
    assert.equal(ok.statusCode, 200, ok.body);
    const hash = (await conta(lab.usuario.id)).senha_hash;
    const repetido = await reemitir(lab, { codigo });
    assert.equal(repetido.statusCode, 401, repetido.body);
    assert.equal(repetido.json().code, 'ADMIN_CREDENCIAIS_INVALIDAS');
    assert.equal((await conta(lab.usuario.id)).senha_hash, hash);
  });

  test('RS-05 sessão pré-MFA não reemite (403 ADMIN_MFA_REQUIRED)', async () => {
    const lab = await laboratorio();
    const r1 = await enviar('POST', '/admin-maike/auth/login', { origin: ORIGEM_ADMIN }, { login: lab.dono.login, senha: lab.dono.senha });
    const cookie = r1.headers['set-cookie'];
    const pre = { origin: ORIGEM_ADMIN, cookie: Array.isArray(cookie) ? cookie[0].split(';')[0] : String(cookie).split(';')[0], 'x-maike-admin-csrf': r1.json().csrf_token };
    const r = await reemitir(lab, { headers: pre });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'ADMIN_MFA_REQUIRED');
  });

  test('RS-06 JWT de fazenda e token restrito do S04-P2 não servem como sessão admin', async () => {
    const lab = await laboratorio();
    const fazenda = (await login(lab.vizinha.credenciais)).json().token;
    const restrito = (await login({ login: 'ana.lab', senha: lab.senhaInicial })).json().token_troca_senha;
    const rev = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    for (const token of [fazenda, restrito]) {
      const r = await enviar(
        'POST',
        urlReemitir(lab.cliente.id, lab.usuario.id),
        // CSRF válido da sessão do dono, mas sem o cookie: só o bearer de fazenda/restrito.
        { origin: ORIGEM_ADMIN, 'x-maike-admin-csrf': lab.dono.headers['x-maike-admin-csrf'], authorization: `Bearer ${token}`, 'if-match': rev },
        { justificativa: JUST, senha_admin_atual: 'x', codigo_mfa: '123456' }
      );
      // Bearer sem cookie de sessão admin = recusa explícita (não é sessão do proprietário).
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().code, 'ADMIN_PRINCIPAL_REQUIRED');
    }
    assert.equal((await conta(lab.usuario.id)).sessao_epoca, null);
  });
});

describe('S04-P3 reemissão — alvo, tenant e contrato', () => {
  test('RS-07 conta de outro cliente, inexistente, cliente suspenso ou conta inativa: recusa sem escrita e sem oráculo', async () => {
    const lab = await laboratorio();
    const revVizinho = await revisaoDe(lab.dono.headers, lab.vizinha.cliente.id, lab.vizinha.usuario.id);
    const outroTenant = await reemitir(lab, { clienteId: lab.cliente.id, usuarioId: lab.vizinha.usuario.id, revisao: revVizinho });
    const inexistente = await reemitir(lab, { usuarioId: 'nao-existe-123', revisao: revVizinho });
    for (const r of [outroTenant, inexistente]) {
      assert.equal(r.statusCode, 422, r.body);
      assert.equal(r.json().message, 'usuário não encontrado neste cliente', 'mesma resposta: sem oráculo cross-tenant');
      assert.equal(r.body.includes('vizinha'), false);
    }
    assert.equal((await conta(lab.vizinha.usuario.id)).sessao_epoca, null, 'conta do outro cliente intacta');

    const rev = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    await prisma().usuario.update({ where: { id: lab.usuario.id }, data: { ativo: false } });
    const inativo = await reemitir(lab, { revisao: rev });
    assert.equal(inativo.statusCode, 422);
    assert.match(inativo.json().message, /usuário inativo/);
    await prisma().usuario.update({ where: { id: lab.usuario.id }, data: { ativo: true } });

    await prisma().cliente.update({ where: { id: lab.cliente.id }, data: { ativo: false } });
    const suspenso = await reemitir(lab);
    assert.equal(suspenso.statusCode, 422);
    assert.match(suspenso.json().message, /cliente suspenso/);
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'usuario_senha_reemitir', sucesso: true } }), 0);
  });

  test('RS-08 contrato fechado: ids inválidos 400; campos extras (senha escolhida, ids, papel, época, pendência) 400; justificativa curta 400', async () => {
    const lab = await laboratorio();
    const rev = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    const base = { justificativa: JUST, senha_admin_atual: lab.dono.senha, codigo_mfa: '123456' };
    const h = { ...lab.dono.headers, 'if-match': rev };
    for (const url of [urlReemitir('id com espaço', lab.usuario.id), urlReemitir(lab.cliente.id, 'x'.repeat(65))]) {
      assert.equal((await enviar('POST', url, h, base)).statusCode, 400, url);
    }
    for (const extra of [{ senha: 'Escolhida-123' }, { nova_senha: 'x' }, { usuario_id: 'x' }, { papel_tenant: 'administrador' }, { sessao_epoca: 0 }, { troca_senha_pendente: false }, { senha_hash: 'x' }]) {
      const r = await enviar('POST', urlReemitir(lab.cliente.id, lab.usuario.id), h, { ...base, ...extra });
      assert.equal(r.statusCode, 400, JSON.stringify(Object.keys(extra)));
    }
    assert.equal((await enviar('POST', urlReemitir(lab.cliente.id, lab.usuario.id), h, { ...base, justificativa: 'curta' })).statusCode, 400);
    assert.equal((await conta(lab.usuario.id)).sessao_epoca, null);
  });

  test('RS-09 If-Match ausente/malformado = 428; obsoleto (conta mudou após a leitura) = 409 ADMIN_USUARIO_EDICAO_CONCORRENTE; nada gravado', async () => {
    const lab = await laboratorio();
    for (const revisao of [null, 'abc', '"r1-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"']) {
      const r = await reemitir(lab, { revisao });
      assert.equal(r.statusCode, 428, r.body);
      assert.equal(r.json().code, 'ADMIN_REVISAO_REQUERIDA');
    }
    const lida = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    // Alguém mudou a conta depois da leitura (nome e, em outro caso, época por SQL cru).
    await prisma().usuario.update({ where: { id: lab.usuario.id }, data: { nome: 'Ana Renomeada' } });
    const r1 = await reemitir(lab, { revisao: lida });
    assert.equal(r1.statusCode, 409, r1.body);
    assert.equal(r1.json().code, 'ADMIN_USUARIO_EDICAO_CONCORRENTE');
    const lida2 = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    await prisma().$executeRawUnsafe(`UPDATE "Usuario" SET "sessao_epoca" = 7 WHERE id = '${lab.usuario.id}'`);
    const r2 = await reemitir(lab, { revisao: lida2 });
    assert.equal(r2.statusCode, 409, 'época alterada fora do Prisma também invalida a revisão');
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'usuario_senha_reemitir', sucesso: true } }), 0);
  });

  test('RS-10 corrida de duas reemissões com a mesma revisão: um único vencedor, uma senha válida, uma auditoria', async () => {
    const lab = await laboratorio();
    const rev = await revisaoDe(lab.dono.headers, lab.cliente.id, lab.usuario.id);
    const passo = passoTotpAtual();
    await prisma().adminPrincipalMaike.update({ where: { id: lab.dono.admin.id }, data: { mfa_ultimo_passo: passo - 3 } });
    const [a, b] = await Promise.all([
      reemitir(lab, { revisao: rev, codigo: codigoTotp(lab.dono.segredo, passo - 1) }),
      reemitir(lab, { revisao: rev, codigo: codigoTotp(lab.dono.segredo, passo) }),
    ]);
    const vencedoras = [a, b].filter((r) => r.statusCode === 200);
    assert.equal(vencedoras.length, 1, `${a.statusCode} ${b.statusCode}`);
    const perdedora = [a, b].find((r) => r.statusCode !== 200);
    assert.ok([409, 401].includes(perdedora.statusCode), perdedora.body);
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'usuario_senha_reemitir', sucesso: true } }), 1);
    assert.equal((await conta(lab.usuario.id)).sessao_epoca, 1);
    const etapa = await login({ login: 'ana.lab', senha: vencedoras[0].json().senha_temporaria });
    assert.equal(etapa.json().troca_senha_obrigatoria, true, 'só a senha da vencedora vale');
  });

  test('RS-11 falha injetada na auditoria: rollback integral (hash, pendência e época); repetir depois conclui', async () => {
    const lab = await laboratorio();
    const r0 = await login({ login: 'ana.lab', senha: lab.senhaInicial });
    await app.inject({
      method: 'POST',
      url: '/auth/troca-senha-inicial',
      headers: { authorization: `Bearer ${r0.json().token_troca_senha}` },
      payload: { senha_atual: lab.senhaInicial, nova_senha: 'Senha-Atual-Da-Ana-1' },
    });
    const antes = await conta(lab.usuario.id);
    const r = await comAuditoriaAdminQuebrada(() => reemitir(lab));
    assert.ok(r.statusCode >= 500, r.body);
    const meio = await conta(lab.usuario.id);
    assert.equal(meio.senha_hash, antes.senha_hash);
    assert.equal(meio.troca_senha_pendente, false);
    assert.equal(meio.sessao_epoca, antes.sessao_epoca);
    assert.equal((await login({ login: 'ana.lab', senha: 'Senha-Atual-Da-Ana-1' })).statusCode, 200, 'senha anterior continua valendo');
    const ok = await reemitir(lab);
    assert.equal(ok.statusCode, 200, ok.body);
  });

  test('RS-12 contas NULL preexistentes que não são alvo seguem login normal; nenhuma migration nova no slice', async () => {
    const lab = await laboratorio();
    assert.equal((await conta(lab.vizinha.usuario.id)).troca_senha_pendente, null);
    assert.equal((await reemitir(lab)).statusCode, 200);
    const r = await login(lab.vizinha.credenciais);
    assert.deepEqual(Object.keys(r.json()).sort(), ['cliente_id', 'token', 'usuario']);
    const migrations = readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter((n) => /^\d+_/.test(n)).sort();
    assert.equal(migrations.at(-1), '20261107200000_s04_p2_troca_senha_inicial', 'S04-P3 PR01 não cria migration');
  });
});
