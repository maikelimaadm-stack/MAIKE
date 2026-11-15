/**
 * Leitura de cocho (D-PROD-205, etapa 3 da suplementação), tabela física
 * "LEITURACOCHO" — PostgreSQL real.
 *
 * Escore VAZIO | ADEQUADO | CHEIO (obrigatório), acesso BOM | RUIM (padrão BOM),
 * estrutura BOA | REPARO | QUEBRADA (padrão BOA). Só cocho DESTA fazenda (outra
 * fazenda, outro tenant ou depósito → 400). Data AAAA-MM-DD não posterior a hoje
 * no fuso da fazenda. `registrado_por_nome` vem da conta autenticada. Listar é
 * só autenticado; criar e excluir com a chave do mapa `lancar_suplementacao`.
 * Não mexe em estoque. Apagar o cocho apaga as leituras (CASCADE). CHECK no banco.
 * Relógio de teste: MAIKE_TESTE_AGORA = 2027-06-15T15:00:00Z (12:00 em São Paulo).
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

const CAMPOS_PUBLICOS = [
  'acesso', 'created_date', 'data_leitura', 'empresa_id', 'escore', 'estrutura', 'id', 'observacoes', 'ponto_suplementacao_id',
  'registrado_por_nome', 'updated_date',
].sort();

let seq = 0;
const ponto = async (clienteId, empresaId, extra = {}) => {
  seq += 1;
  return prisma().pontoSuplementacao.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, numero_ponto: `LC${seq}-${randomUUID().slice(0, 6)}`, nome_ponto: `COCHO ${seq}`, categoria_ponto: 'COCHO', ...extra },
  });
};

/** Tenant administrador com duas fazendas, cocho e depósito na 1, cocho na 2. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}`, fuso_horario: 'America/Sao_Paulo' } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const cocho = await ponto(c, e1.id);
  const deposito = await ponto(c, e1.id, { categoria_ponto: 'DEPOSITO', nome_ponto: 'DEPÓSITO 1' });
  const cochoE2 = await ponto(c, e2.id);
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, e1, e2, adm, cocho, deposito, cochoE2 };
};

/** Conta comum do mesmo tenant com a permissão dada. */
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), ...a });
/** Ver o mapa (sem chave de lançamento), como em permissoesR2Rotas. */
const verMapa = (chaves = {}) => ({
  permissoes_telas: [linha('mapa', 'pec-mapa-geral', { visualizar: true }), linha('mapa', 'pec-mapa-cadastro', {})],
  mapa_geral_permissoes: { visualizar_lotes: true, lancar_suplementacao: false, movimentar_depositos: false, mover_lotes: false, ...chaves },
});
const contaCom = async (cen, extra = {}) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Vaqueiro Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Vaqueiro Op', modulos_permitidos: ['mapa'], ...extra } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const leitura = (cen, extra = {}) => ({ empresa_id: cen.e1.id, ponto_suplementacao_id: cen.cocho.id, data_leitura: '2027-06-15', escore: 'VAZIO', ...extra });

describe('D-PROD-205 — leitura de cocho', () => {
  test('LC-01 cria com os padrões (acesso BOM, estrutura BOA), quem registrou vem da conta e o formato público é fechado', async () => {
    const cen = await cenario();
    const r = await req('POST', '/leituras-cocho', cen.token, leitura(cen, { observacoes: '  sobrou pouco  ' }));
    assert.equal(r.statusCode, 201, r.body);
    const l = r.json();
    assert.deepEqual(Object.keys(l).sort(), CAMPOS_PUBLICOS);
    assert.equal(l.data_leitura, '2027-06-15');
    assert.deepEqual([l.escore, l.acesso, l.estrutura, l.observacoes], ['VAZIO', 'BOM', 'BOA', 'sobrou pouco']);
    const usuario = await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } });
    assert.equal(l.registrado_por_nome, usuario.nome);
    const banco = await prisma().leituraCocho.findUnique({ where: { id: l.id } });
    assert.equal(banco.cliente_id, cen.clienteId);
    assert.equal(banco.empresa_id, cen.e1.id);
  });

  test('LC-02 os três escores, acesso RUIM e estrutura REPARO/QUEBRADA; a lista vem da mais recente para a mais antiga e filtra por fazenda e por cocho', async () => {
    const cen = await cenario();
    for (const [dia, escore, acesso, estrutura] of [['2027-06-13', 'CHEIO', 'BOM', 'BOA'], ['2027-06-15', 'ADEQUADO', 'RUIM', 'QUEBRADA'], ['2027-06-14', 'VAZIO', 'RUIM', 'REPARO']]) {
      const r = await req('POST', '/leituras-cocho', cen.token, leitura(cen, { data_leitura: dia, escore, acesso, estrutura }));
      assert.equal(r.statusCode, 201, r.body);
    }
    const r2 = await req('POST', '/leituras-cocho', cen.token, { empresa_id: cen.e2.id, ponto_suplementacao_id: cen.cochoE2.id, data_leitura: '2027-06-15', escore: 'CHEIO' });
    assert.equal(r2.statusCode, 201, r2.body);
    const lista = (await req('GET', `/leituras-cocho?empresa_id=${cen.e1.id}`, cen.token)).json();
    assert.deepEqual(lista.map((l) => [l.data_leitura, l.escore, l.acesso, l.estrutura]), [
      ['2027-06-15', 'ADEQUADO', 'RUIM', 'QUEBRADA'], ['2027-06-14', 'VAZIO', 'RUIM', 'REPARO'], ['2027-06-13', 'CHEIO', 'BOM', 'BOA'],
    ]);
    const doCocho = (await req('GET', `/leituras-cocho?ponto_suplementacao_id=${cen.cochoE2.id}`, cen.token)).json();
    assert.deepEqual(doCocho.map((l) => l.empresa_id), [cen.e2.id]);
    assert.equal((await req('GET', '/leituras-cocho', cen.token)).json().length, 4);
  });

  test('LC-03 validação: escore obrigatório e fechado, acesso/estrutura fechados, data inválida ou futura, corpo fechado (cliente_id e registrado_por_nome recusados)', async () => {
    const cen = await cenario();
    const casos = [
      [{ escore: undefined }, null],
      [{ escore: 'MEIO' }, null],
      [{ acesso: 'OTIMO' }, null],
      [{ estrutura: 'NOVA' }, null],
      [{ data_leitura: '2027-02-30' }, 'data_invalida'],
      [{ data_leitura: '15/06/2027' }, 'data_invalida'],
      [{ data_leitura: '2027-06-16' }, 'data_futura'],
      [{ cliente_id: 'outro' }, null],
      [{ registrado_por_nome: 'Fulano' }, null],
    ];
    for (const [extra, reason] of casos) {
      const corpo = leitura(cen, extra);
      for (const [k, v] of Object.entries(extra)) if (v === undefined) delete corpo[k];
      const r = await req('POST', '/leituras-cocho', cen.token, corpo);
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} → ${r.body}`);
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED', r.body);
      if (reason) assert.equal(r.json().reason, reason, r.body);
    }
    assert.equal(await prisma().leituraCocho.count(), 0, 'nada gravado');
  });

  test('LC-04 data no fuso da fazenda: 15/06 é hoje em São Paulo; sem fuso configurado vale America/Sao_Paulo', async () => {
    const cen = await cenario();
    // A fazenda 2 não tem fuso: hoje = 2027-06-15 (reserva America/Sao_Paulo), amanhã é futuro.
    const ok = await req('POST', '/leituras-cocho', cen.token, { empresa_id: cen.e2.id, ponto_suplementacao_id: cen.cochoE2.id, data_leitura: '2027-06-15', escore: 'ADEQUADO' });
    assert.equal(ok.statusCode, 201, ok.body);
    const futura = await req('POST', '/leituras-cocho', cen.token, { empresa_id: cen.e2.id, ponto_suplementacao_id: cen.cochoE2.id, data_leitura: '2027-06-16', escore: 'ADEQUADO' });
    assert.equal(futura.statusCode, 400, futura.body);
    assert.equal(futura.json().reason, 'data_futura');
    // Fazenda em Tóquio (UTC+9): às 15:00 UTC já é 16/06 lá.
    await prisma().empresa.update({ where: { id: cen.e1.id }, data: { fuso_horario: 'Asia/Tokyo' } });
    const toquio = await req('POST', '/leituras-cocho', cen.token, leitura(cen, { data_leitura: '2027-06-16' }));
    assert.equal(toquio.statusCode, 201, toquio.body);
  });

  test('LC-05 cocho: de outra fazenda, de outro tenant, inexistente ou depósito → 400; fazenda de outro tenant → 404', async () => {
    const cen = await cenario();
    const outro = await cenario();
    for (const [corpo, reason] of [
      [leitura(cen, { ponto_suplementacao_id: cen.cochoE2.id }), 'ponto_de_outra_fazenda'],
      [leitura(cen, { ponto_suplementacao_id: outro.cocho.id }), 'ponto_inexistente'],
      [leitura(cen, { ponto_suplementacao_id: 'nao-existe' }), 'ponto_inexistente'],
      [leitura(cen, { ponto_suplementacao_id: cen.deposito.id }), 'ponto_nao_e_cocho'],
    ]) {
      const r = await req('POST', '/leituras-cocho', cen.token, corpo);
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(r.json().reason, reason, r.body);
      assert.equal(r.json().field, 'ponto_suplementacao_id');
    }
    const fazendaAlheia = await req('POST', '/leituras-cocho', cen.token, leitura(cen, { empresa_id: outro.e1.id, ponto_suplementacao_id: outro.cocho.id }));
    assert.equal(fazendaAlheia.statusCode, 404, fazendaAlheia.body);
    assert.equal(fazendaAlheia.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal(await prisma().leituraCocho.count(), 0);
  });

  test('LC-06 tenancy: a lista e a exclusão só enxergam o próprio tenant', async () => {
    const cen = await cenario();
    const outro = await cenario();
    const minha = (await req('POST', '/leituras-cocho', cen.token, leitura(cen))).json();
    const alheia = (await req('POST', '/leituras-cocho', outro.token, leitura(outro))).json();
    const lista = (await req('GET', '/leituras-cocho', cen.token)).json();
    assert.deepEqual(lista.map((l) => l.id), [minha.id]);
    const r = await req('DELETE', `/leituras-cocho/${alheia.id}`, cen.token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'LEITURA_COCHO_NOT_FOUND');
    assert.equal(await prisma().leituraCocho.count({ where: { id: alheia.id } }), 1, 'a do outro tenant continua');
    const filtro = (await req('GET', `/leituras-cocho?empresa_id=${outro.e1.id}`, cen.token)).json();
    assert.deepEqual(filtro, [], 'filtrar pela fazenda de outro tenant não vaza nada');
  });

  test('LC-07 exclusão física e auditoria; repetir a exclusão dá 404', async () => {
    const cen = await cenario();
    const l = (await req('POST', '/leituras-cocho', cen.token, leitura(cen))).json();
    const r = await req('DELETE', `/leituras-cocho/${l.id}`, cen.token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await prisma().leituraCocho.count(), 0);
    assert.equal((await req('DELETE', `/leituras-cocho/${l.id}`, cen.token)).statusCode, 404);
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: cen.clienteId, entidade: 'LeituraCocho' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audit.map((a) => a.acao), ['create', 'delete']);
  });

  test('LC-08 permissão: listar só autenticado; criar e excluir exigem lancar_suplementacao no mapa; quem registrou é a conta comum', async () => {
    const cen = await cenario();
    const semChave = await contaCom(cen, verMapa());
    assert.equal((await req('GET', '/leituras-cocho', semChave)).statusCode, 200);
    const negado = await req('POST', '/leituras-cocho', semChave, leitura(cen));
    assert.equal(negado.statusCode, 403, negado.body);
    assert.equal(negado.json().code, 'ACAO_NAO_PERMITIDA');
    const comChave = await contaCom(cen, verMapa({ lancar_suplementacao: true }));
    const ok = await req('POST', '/leituras-cocho', comChave, leitura(cen));
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(ok.json().registrado_por_nome, 'Vaqueiro Op');
    assert.equal((await req('DELETE', `/leituras-cocho/${ok.json().id}`, semChave)).statusCode, 403);
    assert.equal((await req('DELETE', `/leituras-cocho/${ok.json().id}`, comChave)).statusCode, 204);
    assert.equal((await req('GET', '/leituras-cocho')).statusCode, 401, 'sem sessão');
  });

  test('LC-09 não mexe em estoque; apagar o cocho apaga as leituras dele (CASCADE)', async () => {
    const cen = await cenario();
    const antes = await prisma().movimentacaoEstoque.count();
    await req('POST', '/leituras-cocho', cen.token, leitura(cen));
    await req('POST', '/leituras-cocho', cen.token, leitura(cen, { escore: 'CHEIO' }));
    assert.equal(await prisma().movimentacaoEstoque.count(), antes, 'nenhum movimento de estoque');
    assert.equal(await prisma().leituraCocho.count(), 2);
    await prisma().pontoSuplementacao.delete({ where: { id: cen.cocho.id } });
    assert.equal(await prisma().leituraCocho.count(), 0);
  });

  test('LC-10 o banco é a última barreira: CHECK recusa escore, acesso e estrutura fora da lista', async () => {
    const cen = await cenario();
    const base = { cliente_id: cen.clienteId, empresa_id: cen.e1.id, ponto_suplementacao_id: cen.cocho.id, data_leitura: new Date('2027-06-15T00:00:00Z'), escore: 'VAZIO', acesso: 'BOM', estrutura: 'BOA' };
    for (const ruim of [{ escore: 'vazio' }, { acesso: 'OTIMO' }, { estrutura: 'NOVA' }]) {
      await assert.rejects(() => prisma().leituraCocho.create({ data: { ...base, ...ruim } }), /check constraint|violates/i, JSON.stringify(ruim));
    }
    await assert.rejects(
      () => prisma().leituraCocho.create({ data: { ...base, empresa_id: cen.e2.id, ponto_suplementacao_id: 'nao-existe' } }),
      /Foreign key|foreign key/i,
    );
  });
});
