/**
 * D-PROD-153 — MAIKE Gestão P2: Naturezas Financeiras GERENCIAIS. PostgreSQL
 * real, HTTP autenticado, prova por persistência.
 *
 *  A. API: criar RECEITA/DESPESA, listar/filtrar, keyset+total, detalhe, editar,
 *     inativar/reativar; tipo e empresa imutáveis; corpo fechado.
 *  B. Hierarquia: raiz/filho/neto, tipo oposto, pai inativo, autorreferência,
 *     ciclo indireto, profundidade > 5, outra empresa/tenant, inativar com filha
 *     ativa, reativar com pai inativo; corridas sob trava.
 *  C. Segurança: 2 tenants × 2 empresas; permissões por ação; auditoria mínima
 *     na mesma transação (rollback na falha).
 *  D. Escala: 1.001+ naturezas ativas — o último pai continua alcançável por
 *     página e por busca; sem teto silencioso.
 *  G. Banco: FK composta com tipo e CHECKs recusam INSERT/UPDATE direto;
 *     Lote/Produto/Movimentação/rebanho intactos.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const ok = async (r, status = 200) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const codigo = (r) => r.json().code;
const motivo = (r) => r.json().reason ?? r.json().details?.reason;
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (a) => ({ modulo_id: 'gestao-rural', tela_id: 'ges-naturezas-financeiras', ...a });

/** Tenant com 2 empresas e contas por perfil. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const hash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const conta = async (permissao, extra = {}) => {
    const login = `op-${randomUUID().slice(0, 8)}`;
    const u = await p.usuario.create({ data: { cliente_id: c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario', ...extra } });
    if (permissao) await p.permissao.create({ data: { cliente_id: c, user_email: login, user_nome: 'Op', ...permissao } });
    return { id: u.id, token: (await autenticarNoApp(app, { login, senha: adm.credenciais.senha })).corpo.token };
  };
  const nat = await conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha(acoes(true))] });
  return {
    cliente: adm.cliente,
    e1,
    e2,
    adm: (await autenticarNoApp(app, adm.credenciais)).corpo.token,
    natId: nat.id,
    nat: nat.token,
    ver: (await conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha({ ...acoes(false), visualizar: true })] })).token,
    soNovo: (await conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha({ ...acoes(false), visualizar: true, novo: true })] })).token,
    soSalvar: (await conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha({ ...acoes(false), visualizar: true, salvar: true })] })).token,
    soEditar: (await conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha({ ...acoes(false), visualizar: true, editar: true })] })).token,
    semTela: (await conta({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [{ modulo_id: 'gestao-rural', tela_id: 'ges-centros-custo', ...acoes(true) }] })).token,
    isAdmin: (await conta({ is_admin: true })).token,
  };
};

const nova = (c, tok, nome, tipo = 'DESPESA', extra = {}) => ok(req('POST', '/naturezas-financeiras', tok, { empresa_id: c.e1.id, tipo, nome, ...extra }), 201);
const patch = (c, tok, id, corpo, empresa = c.e1.id) => req('PATCH', `/naturezas-financeiras/${id}`, tok, { empresa_id: empresa, ...corpo });

/** Tabelas que esta missão NÃO pode tocar. */
const fotografiaProibidas = async (clienteId) => {
  const p = prisma();
  const w = { where: { cliente_id: clienteId } };
  return JSON.stringify({
    lote: await p.lote.count(w), produto: await p.produto.count(w), mov: await p.movimentacaoEstoque.count(w),
    nota: await p.estoqueLoteNota.count(w), posicao: await p.posicaoRebanho.count(w), evento: await p.eventoRebanho.count(w),
    movMapa: await p.movimentacaoMapa.count(w), fornecedor: await p.fornecedor.count(w), cc: await p.centroCusto.count(w), cr: await p.centroResultado.count(w),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('A — API', () => {
  test('cria RECEITA e DESPESA (nome em maiúsculas, código da sequência), detalha, lista por tipo/situação/pai, keyset e total', async () => {
    const c = await cenario();
    const antes = await fotografiaProibidas(c.cliente.id);
    const desp = await nova(c, c.nat, 'Alimentação');
    const racao = await nova(c, c.nat, 'Ração', 'DESPESA', { pai_id: desp.id, descricao: 'concentrado' });
    const rec = await nova(c, c.nat, 'Venda de animais', 'RECEITA');
    assert.equal(desp.nome, 'ALIMENTAÇÃO');
    assert.equal(racao.caminho, 'ALIMENTAÇÃO / RAÇÃO');
    assert.equal(racao.nivel, 2);
    assert.equal(racao.pai_nome, 'ALIMENTAÇÃO');
    assert.ok(Number(desp.numero) >= 1 && Number(racao.numero) === Number(desp.numero) + 1 && Number(rec.numero) === Number(racao.numero) + 1);
    // mesmo nome pode existir no outro tipo
    await nova(c, c.nat, 'Alimentação', 'RECEITA');
    const det = await ok(req('GET', `/naturezas-financeiras/${racao.id}?empresa_id=${c.e1.id}`, c.ver));
    assert.equal(det.tipo, 'DESPESA');
    assert.equal(det.descricao, 'concentrado');

    const despesas = await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&tipo=DESPESA`, c.ver));
    assert.deepEqual(despesas.items.map((i) => i.nome).sort(), ['ALIMENTAÇÃO', 'RAÇÃO']);
    assert.equal(despesas.total, 2);
    const filhas = await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&pai_id=${desp.id}`, c.ver));
    assert.deepEqual(filhas.items.map((i) => i.id), [racao.id]);
    // keyset: 2 por página, total coerente, sem repetir
    const p1 = await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&limit=2`, c.ver));
    assert.equal(p1.total, 4);
    assert.ok(p1.has_more && p1.next_cursor);
    const p2 = await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`, c.ver));
    assert.equal(p2.total, 4);
    assert.equal(new Set([...p1.items, ...p2.items].map((i) => i.id)).size, 4);
    // busca
    const busca = await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&q=ra%C3%A7%C3%A3o`, c.ver));
    assert.deepEqual(busca.items.map((i) => i.id), [racao.id]);
    assert.equal(await fotografiaProibidas(c.cliente.id), antes, 'Lote, estoque, produto, rebanho, Parceiros e Centros intactos');
  });

  test('editar só o enviado; idempotente; inativar/reativar; filtro de situação', async () => {
    const c = await cenario();
    const n = await nova(c, c.nat, 'Manutenção');
    const ed = await ok(patch(c, c.nat, n.id, { nome: 'Manutenção de máquinas', descricao: 'peças' }));
    assert.equal(ed.nome, 'MANUTENÇÃO DE MÁQUINAS');
    const logs0 = await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'NaturezaFinanceira' } });
    await ok(patch(c, c.nat, n.id, { nome: 'manutenção de máquinas', descricao: 'peças' }));
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'NaturezaFinanceira' } }), logs0, 'mesmo conteúdo: nada gravado nem auditado');
    assert.equal((await ok(patch(c, c.nat, n.id, { ativo: false }))).ativo, false);
    assert.equal((await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&ativo=false`, c.ver))).total, 1);
    assert.equal((await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&ativo=true`, c.ver))).total, 0);
    assert.equal((await ok(patch(c, c.nat, n.id, { ativo: true }))).ativo, true);
  });

  test('tipo e empresa imutáveis; corpo/query fechados; texto inválido; nada gravado', async () => {
    const c = await cenario();
    const n = await nova(c, c.nat, 'Insumos');
    const gravado = await prisma().naturezaFinanceira.findUnique({ where: { id: n.id } });
    for (const corpo of [{ tipo: 'RECEITA' }, { cliente_id: 'x' }, { id: 'outro' }, { numero: '9' }, { desconhecido: 1 }, { nome: '<b>x</b>' }, { nome: 'a\u0007b' }, { pai: { id: 'x' } }]) {
      const r = await patch(c, c.nat, n.id, corpo);
      assert.equal(r.statusCode, 400, `${JSON.stringify(corpo)}: ${r.body}`);
    }
    // empresa_id do PATCH é escopo: outra empresa → 404 (não move o registro)
    assert.equal((await patch(c, c.nat, n.id, { nome: 'X' }, c.e2.id)).statusCode, 404);
    for (const corpo of [{ empresa_id: c.e1.id, tipo: 'OUTRO', nome: 'X' }, { empresa_id: c.e1.id, nome: 'SEM TIPO' }, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: '' }, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: 'X', cliente_id: 'y' }]) {
      assert.equal((await req('POST', '/naturezas-financeiras', c.nat, corpo)).statusCode, 400, JSON.stringify(corpo));
    }
    assert.equal((await req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&tipo=XYZ`, c.ver)).statusCode, 400);
    assert.equal((await req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&extra=1`, c.ver)).statusCode, 400);
    assert.deepEqual(await prisma().naturezaFinanceira.findUnique({ where: { id: n.id } }), gravado);
    assert.equal(await prisma().naturezaFinanceira.count({ where: { cliente_id: c.cliente.id } }), 1);
  });

  test('nome repetido no mesmo tipo e empresa → 409; corrida: dois POST iguais → um 201 e um 409', async () => {
    const c = await cenario();
    await nova(c, c.nat, 'Frete');
    const r = await req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: 'frete' });
    assert.equal(r.statusCode, 409);
    assert.equal(codigo(r), 'NATUREZA_NOME_CONFLITO');
    await ok(req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e2.id, tipo: 'DESPESA', nome: 'Frete' }), 201);
    const [a, b] = await Promise.all([1, 2].map(() => req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: 'Energia' })));
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409]);
    const numeros = (await prisma().naturezaFinanceira.findMany({ where: { cliente_id: c.cliente.id }, select: { numero: true } })).map((x) => x.numero);
    assert.equal(new Set(numeros).size, numeros.length, 'sequência atômica: números distintos');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B — hierarquia', () => {
  test('raiz/filho/neto; pai de tipo oposto, inativo, de outra empresa, inexistente, autorreferência e ciclo → 409 com motivo', async () => {
    const c = await cenario();
    const raiz = await nova(c, c.nat, 'Raiz');
    const filho = await nova(c, c.nat, 'Filho', 'DESPESA', { pai_id: raiz.id });
    const neto = await nova(c, c.nat, 'Neto', 'DESPESA', { pai_id: filho.id });
    assert.equal(neto.caminho, 'RAIZ / FILHO / NETO');
    const rec = await nova(c, c.nat, 'Receita X', 'RECEITA');
    const outraEmp = await ok(req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e2.id, tipo: 'DESPESA', nome: 'E2' }), 201);
    const inativo = await nova(c, c.nat, 'Inativo');
    await ok(patch(c, c.nat, inativo.id, { ativo: false }));
    const casos = [
      [{ pai_id: rec.id }, 'pai_de_outro_tipo'],
      [{ pai_id: inativo.id }, 'pai_inativo'],
      [{ pai_id: outraEmp.id }, 'pai_fora_da_empresa'],
      [{ pai_id: 'nao-existe' }, 'pai_fora_da_empresa'],
    ];
    for (const [corpo, esperado] of casos) {
      const r = await req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: `N ${esperado} ${randomUUID().slice(0, 4)}`, ...corpo });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(codigo(r), 'NATUREZA_HIERARQUIA_INVALIDA');
      assert.equal(motivo(r), esperado);
    }
    let r = await patch(c, c.nat, raiz.id, { pai_id: raiz.id });
    assert.equal(motivo(r), 'autorreferencia');
    r = await patch(c, c.nat, raiz.id, { pai_id: neto.id });
    assert.equal(r.statusCode, 409);
    assert.equal(motivo(r), 'ciclo');
    assert.equal((await prisma().naturezaFinanceira.findUnique({ where: { id: raiz.id } })).pai_id, null, 'nada gravado');
    // mover o neto para a raiz é válido; virar raiz (null) também
    assert.equal((await ok(patch(c, c.nat, neto.id, { pai_id: raiz.id }))).caminho, 'RAIZ / NETO');
    assert.equal((await ok(patch(c, c.nat, neto.id, { pai_id: null }))).nivel, 1);
  });

  test('profundidade máxima 5 (criar e mover subárvore)', async () => {
    const c = await cenario();
    let pai = null;
    const nos = [];
    for (let i = 1; i <= 5; i += 1) {
      pai = await nova(c, c.nat, `N${i}`, 'DESPESA', pai ? { pai_id: pai.id } : {});
      nos.push(pai);
    }
    assert.equal(nos[4].nivel, 5);
    const r = await req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: 'N6', pai_id: nos[4].id });
    assert.equal(motivo(r), 'profundidade_maxima');
    // subárvore de altura 2 não cabe sob o nível 4
    const a = await nova(c, c.nat, 'A');
    await nova(c, c.nat, 'B', 'DESPESA', { pai_id: a.id });
    assert.equal(motivo(await patch(c, c.nat, a.id, { pai_id: nos[3].id })), 'profundidade_maxima');
    await ok(patch(c, c.nat, a.id, { pai_id: nos[2].id }));
  });

  test('inativar com filha ativa → 409; reativar com pai inativo → 409; inativar folha primeiro funciona', async () => {
    const c = await cenario();
    const p = await nova(c, c.nat, 'Pai');
    const f = await nova(c, c.nat, 'Filha', 'DESPESA', { pai_id: p.id });
    let r = await patch(c, c.nat, p.id, { ativo: false });
    assert.equal(codigo(r), 'NATUREZA_COM_FILHOS_ATIVOS');
    await ok(patch(c, c.nat, f.id, { ativo: false }));
    await ok(patch(c, c.nat, p.id, { ativo: false }));
    r = await patch(c, c.nat, f.id, { ativo: true });
    assert.equal(r.statusCode, 409);
    assert.equal(motivo(r), 'pai_inativo');
    await ok(patch(c, c.nat, p.id, { ativo: true }));
    await ok(patch(c, c.nat, f.id, { ativo: true }));
  });

  test('corrida: A→B e B→A ao mesmo tempo não formam ciclo (trava por empresa+tipo)', async () => {
    const c = await cenario();
    const a = await nova(c, c.nat, 'A');
    const b = await nova(c, c.nat, 'B');
    for (let i = 0; i < 5; i += 1) {
      await ok(patch(c, c.nat, a.id, { pai_id: null }));
      await ok(patch(c, c.nat, b.id, { pai_id: null }));
      const [r1, r2] = await Promise.all([patch(c, c.nat, a.id, { pai_id: b.id }), patch(c, c.nat, b.id, { pai_id: a.id })]);
      assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
      const [ga, gb] = await Promise.all([a.id, b.id].map((id) => prisma().naturezaFinanceira.findUnique({ where: { id } })));
      assert.ok(!(ga.pai_id === b.id && gb.pai_id === a.id), 'sem ciclo gravado');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C — segurança', () => {
  test('2 tenants × 2 empresas: leituras, buscas, edições e opções cruzadas negadas sem revelar existência', async () => {
    const c = await cenario();
    const outro = await cenario();
    const n = await nova(c, c.nat, 'Minha');
    const alheia = await ok(req('POST', '/naturezas-financeiras', outro.nat, { empresa_id: outro.e1.id, tipo: 'DESPESA', nome: 'Alheia' }), 201);
    assert.equal((await req('GET', `/naturezas-financeiras/${alheia.id}?empresa_id=${c.e1.id}`, c.nat)).statusCode, 404);
    assert.equal((await req('GET', `/naturezas-financeiras/${n.id}?empresa_id=${outro.e1.id}`, outro.nat)).statusCode, 404, 'empresa de outro tenant');
    assert.equal((await req('GET', `/naturezas-financeiras?empresa_id=${outro.e1.id}`, c.nat)).statusCode, 404);
    assert.equal((await req('GET', `/naturezas-financeiras/${n.id}?empresa_id=${c.e2.id}`, c.nat)).statusCode, 404, 'outra empresa do mesmo tenant');
    assert.equal((await patch(c, c.nat, alheia.id, { nome: 'X' })).statusCode, 404);
    const lista = await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&q=alheia`, c.nat));
    assert.equal(lista.total, 0);
    const r = await req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: 'Filha', pai_id: alheia.id });
    assert.equal(motivo(r), 'pai_fora_da_empresa');
    const op = await ok(req('GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${c.e1.id}&tipo=DESPESA`, c.nat));
    assert.deepEqual(op.itens.map((i) => i.id), [n.id]);
    assert.equal((await prisma().naturezaFinanceira.findUnique({ where: { id: alheia.id } })).nome, 'ALHEIA');
    assert.equal((await req('GET', `/naturezas-financeiras?empresa_id=${c.cliente.id}`, c.nat)).statusCode, 404, 'clienteId não é empresa');
  });

  test('permissões: sem tela 403; visualizar só lê; novo|salvar cria; editar|salvar edita; admin real e is_admin passam', async () => {
    const c = await cenario();
    const n = await nova(c, c.nat, 'Base');
    const e = c.e1.id;
    for (const [m, u, b] of [['GET', `/naturezas-financeiras?empresa_id=${e}`], ['GET', `/naturezas-financeiras/${n.id}?empresa_id=${e}`], ['GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${e}&tipo=DESPESA`], ['POST', '/naturezas-financeiras', { empresa_id: e, tipo: 'DESPESA', nome: 'X' }], ['PATCH', `/naturezas-financeiras/${n.id}`, { empresa_id: e, nome: 'X' }]]) {
      const r = await req(m, u, c.semTela, b);
      assert.equal(r.statusCode, 403, `sem tela ${m} ${u}`);
    }
    assert.equal((await req('GET', `/naturezas-financeiras?empresa_id=${e}`, c.ver)).statusCode, 200);
    assert.equal((await req('POST', '/naturezas-financeiras', c.ver, { empresa_id: e, tipo: 'DESPESA', nome: 'V' })).statusCode, 403);
    assert.equal((await patch(c, c.ver, n.id, { nome: 'V' })).statusCode, 403);
    await ok(req('POST', '/naturezas-financeiras', c.soNovo, { empresa_id: e, tipo: 'DESPESA', nome: 'Por novo' }), 201);
    assert.equal((await patch(c, c.soNovo, n.id, { nome: 'N1' })).statusCode, 403, 'novo não edita');
    await ok(req('POST', '/naturezas-financeiras', c.soSalvar, { empresa_id: e, tipo: 'DESPESA', nome: 'Por salvar' }), 201);
    await ok(patch(c, c.soSalvar, n.id, { nome: 'Por salvar edit' }));
    assert.equal((await req('POST', '/naturezas-financeiras', c.soEditar, { empresa_id: e, tipo: 'DESPESA', nome: 'E' })).statusCode, 403, 'editar não cria');
    await ok(patch(c, c.soEditar, n.id, { ativo: false }));
    await ok(patch(c, c.adm, n.id, { ativo: true }));
    await ok(req('GET', `/naturezas-financeiras?empresa_id=${e}`, c.isAdmin));
    // usuário desativado: sessão não vale
    await prisma().usuario.update({ where: { id: c.natId }, data: { ativo: false } });
    assert.ok([401, 403].includes((await req('GET', `/naturezas-financeiras?empresa_id=${e}`, c.nat)).statusCode));
  });

  test('auditoria mínima na mesma transação: ator/tenant/ação; sem texto livre; falha de auditoria desfaz a escrita', async () => {
    const c = await cenario();
    const n = await nova(c, c.nat, 'Auditada', 'DESPESA', { descricao: 'TEXTOLIVRESENTINELA' });
    await ok(patch(c, c.nat, n.id, { nome: 'Auditada 2', descricao: 'OUTROTEXTOSENTINELA' }));
    const logs = await prisma().auditLog.findMany({ where: { cliente_id: c.cliente.id, entidade: 'NaturezaFinanceira' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(logs.map((l) => l.acao), ['create', 'update']);
    for (const l of logs) assert.equal(l.usuario_id, c.natId);
    const texto = JSON.stringify(logs.map((l) => [l.dados_anteriores, l.dados_novos]));
    for (const s of ['TEXTOLIVRESENTINELA', 'OUTROTEXTOSENTINELA', 'AUDITADA']) assert.ok(!texto.includes(s), `auditoria com texto livre: ${s}`);
    assert.deepEqual([.../** @type {any} */ (logs[1].dados_novos).campos_alterados].sort(), ['descricao', 'nome']);
    assert.equal(/** @type {any} */ (logs[0].dados_novos).tipo, 'DESPESA');
    // falha forçada na auditoria (gatilho temporário) → 5xx e nada gravado
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION p2_falha_audit() RETURNS trigger AS $$ BEGIN IF NEW.entidade = 'NaturezaFinanceira' THEN RAISE EXCEPTION 'falha'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe(`CREATE TRIGGER p2_falha_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION p2_falha_audit()`);
    try {
      const antes = await p.naturezaFinanceira.count({ where: { cliente_id: c.cliente.id } });
      const r = await req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e1.id, tipo: 'DESPESA', nome: 'Sem auditoria' });
      assert.ok(r.statusCode >= 500, r.body);
      assert.equal(await p.naturezaFinanceira.count({ where: { cliente_id: c.cliente.id } }), antes, 'rollback');
      assert.ok((await patch(c, c.nat, n.id, { nome: 'Nao grava' })).statusCode >= 500);
      assert.equal((await p.naturezaFinanceira.findUnique({ where: { id: n.id } })).nome, 'AUDITADA 2');
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS p2_falha_audit ON "AuditLog"');
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS p2_falha_audit()');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D — escala (1.001+ naturezas ativas do mesmo tipo)', () => {
  test('o último pai continua selecionável por página e por busca; sem teto silencioso; opções sem o nó e a subárvore', async () => {
    const c = await cenario();
    const p = prisma();
    const N = 1005;
    const linhas = Array.from({ length: N }, (_, i) => ({ cliente_id: c.cliente.id, empresa_id: c.e1.id, numero: `M${i}`, tipo: 'DESPESA', nome: `NAT ${String(i).padStart(4, '0')}` }));
    await p.naturezaFinanceira.createMany({ data: linhas });
    // percorre todas as páginas das opções de pai (100 por página)
    const vistos = new Set();
    let cursor = null;
    let paginas = 0;
    const t0 = Date.now();
    do {
      const r = await ok(req('GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${c.e1.id}&tipo=DESPESA&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, c.nat));
      for (const i of r.itens) vistos.add(i.nome);
      cursor = r.next_cursor;
      paginas += 1;
    } while (cursor && paginas < 50);
    const ms = Date.now() - t0;
    assert.equal(vistos.size, N, 'todas as opções alcançáveis');
    assert.ok(vistos.has('NAT 1004'));
    assert.equal(paginas, Math.ceil(N / 100));
    assert.ok(ms < 15000, `paginação lenta: ${ms}ms`);
    // busca no servidor acha o último direto
    const busca = await ok(req('GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${c.e1.id}&tipo=DESPESA&q=1004`, c.nat));
    assert.deepEqual(busca.itens.map((i) => i.nome), ['NAT 1004']);
    // e serve de pai
    const ultimo = await p.naturezaFinanceira.findFirst({ where: { cliente_id: c.cliente.id, nome: 'NAT 1004' } });
    const filha = await nova(c, c.nat, 'Filha do último', 'DESPESA', { pai_id: ultimo.id });
    assert.equal(filha.caminho, 'NAT 1004 / FILHA DO ÚLTIMO');
    // criar a 1.007ª ativa não é recusada (sem teto)
    await nova(c, c.nat, 'Mais uma');
    // excluir_id tira o nó e a subárvore
    const semSub = await ok(req('GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${c.e1.id}&tipo=DESPESA&q=NAT%201004&excluir_id=${ultimo.id}`, c.nat));
    assert.equal(semSub.itens.length, 0);
    const semSub2 = await ok(req('GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${c.e1.id}&tipo=DESPESA&q=FILHA&excluir_id=${ultimo.id}`, c.nat));
    assert.equal(semSub2.itens.length, 0);
    // listagem principal: total coerente com 1.007
    assert.equal((await ok(req('GET', `/naturezas-financeiras?empresa_id=${c.e1.id}&tipo=DESPESA&limit=10`, c.ver))).total, N + 2);
    // opções só do tipo pedido e só ativas
    await nova(c, c.nat, 'Receita única', 'RECEITA');
    const rec = await ok(req('GET', `/naturezas-financeiras-opcoes/pais?empresa_id=${c.e1.id}&tipo=RECEITA`, c.nat));
    assert.deepEqual(rec.itens.map((i) => i.nome), ['RECEITA ÚNICA']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('G — o banco garante o escopo (FK composta com tipo e CHECKs)', () => {
  test('INSERT/UPDATE direto: pai de outro tipo, outra empresa, autorreferência e tipo fora do domínio são recusados; tipo de pai com filhos não muda; RESTRICT na exclusão', async () => {
    const c = await cenario();
    const p = prisma();
    const desp = await nova(c, c.nat, 'Despesa');
    const rec = await nova(c, c.nat, 'Receita', 'RECEITA');
    const outraEmp = await ok(req('POST', '/naturezas-financeiras', c.nat, { empresa_id: c.e2.id, tipo: 'DESPESA', nome: 'Outra' }), 201);
    const ins = (tipo, empresa, pai) =>
      p.$executeRaw`INSERT INTO "NaturezaFinanceira" (id, cliente_id, empresa_id, numero, tipo, nome, pai_id, "updatedAt") VALUES (${randomUUID()}, ${c.cliente.id}, ${empresa}, ${randomUUID().slice(0, 8)}, ${tipo}, ${randomUUID()}, ${pai}, now())`;
    await assert.rejects(ins('DESPESA', c.e1.id, rec.id), /foreign key|violates/i, 'pai de outro tipo');
    await assert.rejects(ins('DESPESA', c.e1.id, outraEmp.id), /foreign key|violates/i, 'pai de outra empresa');
    await assert.rejects(ins('OUTRO', c.e1.id, null), /check|violates/i, 'tipo fora do domínio');
    await assert.rejects(p.$executeRaw`UPDATE "NaturezaFinanceira" SET pai_id = id WHERE id = ${desp.id}`, /check|foreign key|violates/i, 'autorreferência');
    await nova(c, c.nat, 'Filha', 'DESPESA', { pai_id: desp.id });
    await assert.rejects(p.$executeRaw`UPDATE "NaturezaFinanceira" SET tipo = 'RECEITA' WHERE id = ${desp.id}`, /foreign key|violates/i, 'tipo de pai com filhos');
    await assert.rejects(p.$executeRaw`DELETE FROM "NaturezaFinanceira" WHERE id = ${desp.id}`, /foreign key|violates/i, 'RESTRICT');
    await assert.rejects(p.$executeRaw`DELETE FROM "Empresa" WHERE id = ${c.e1.id}`, /foreign key|violates/i, 'empresa com naturezas não some');
  });

  test('RLS ligado e sem grants para papéis públicos', async () => {
    const p = prisma();
    const [rls] = /** @type {any[]} */ (await p.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE relname = 'NaturezaFinanceira'`);
    assert.equal(rls.relrowsecurity, true);
    const grants = /** @type {any[]} */ (await p.$queryRaw`SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'NaturezaFinanceira' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`);
    assert.deepEqual(grants, []);
  });
});
