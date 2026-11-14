/**
 * Formulações de suplemento da fazenda (D-PROD-202, etapa 2a da suplementação),
 * tabelas físicas "CADFORMULACAO", "CADFORMULACAOINGREDIENTE" e
 * "CADFORMULACAOREGRA" — PostgreSQL real.
 *
 * PRONTO (produto comprado pronto, sem ingredientes) ou BATELADA (ingredientes
 * em kg POR BATIDA, com o total e o % de cada um derivados). %PV padrão de
 * (0, 5], com vírgula aceita; regras por Categoria de Manejo (não consome, ou
 * consome com %PV próprio). Produto, ingredientes e categorias da MESMA fazenda
 * (outra fazenda ou outro tenant = inexistente), ativos quando a referência é
 * nova. Nome em MAIÚSCULAS e único por fazenda. PATCH substitui as listas
 * enviadas. Exclusão física só sem lançamento de suplementação que a cite
 * (`dados->>'formulacao_id'`); senão 409 `FORMULACAO_EM_USO`. Permissão pela tela
 * `pec-formulacoes`; opções do lançamento (só ativas). CHECK e RLS no banco.
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
const comEmpresa = (url, empresaId) => `${url}?empresa_id=${encodeURIComponent(empresaId)}`;

const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (tela, a) => ({ modulo_id: 'manejo', tela_id: tela, ...acoes(false), ...a });

const CAMPOS_PUBLICOS = [
  'ativo', 'consumo_objetivo_g_cab_dia', 'created_date', 'empresa_id', 'id', 'ingredientes', 'nome', 'observacoes', 'percentual_pv_padrao',
  'produto_ativo', 'produto_id', 'produto_nome', 'regras', 'tipo', 'total_batida_kg', 'updated_date',
].sort();

let seq = 0;
const produto = async (clienteId, empresaId, nome, extra = {}) => {
  seq += 1;
  return prisma().produto.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, numero_produto: `F${seq}`, nome_produto: nome, tipo_uso: 'Nutrição Animal', ...extra },
  });
};
const GMD = Object.fromEntries(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].map((m) => [`gmd_${m}`, '0.5']));
const categoria = async (clienteId, empresaId, nome, extra = {}) => {
  const curva = await prisma().cadCurvaGanho.create({ data: { cliente_id: clienteId, empresa_id: empresaId, nome: `CURVA ${nome}`, ...GMD } });
  return prisma().categoriaManejo.create({ data: { cliente_id: clienteId, empresa_id: empresaId, nome, curva_ganho_id: curva.id, ...extra } });
};

/** Tenant administrador com duas fazendas, produtos e categorias em cada uma. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const p = {
    sal: await produto(c, e1.id, 'SAL MINERAL 80'),
    mistura: await produto(c, e1.id, 'PROTEINADO DA FAZENDA'),
    milho: await produto(c, e1.id, 'MILHO GRAO', { tipo_uso: 'Insumo' }),
    farelo: await produto(c, e1.id, 'FARELO DE SOJA', { tipo_uso: 'Insumo' }),
    nucleo: await produto(c, e1.id, 'NUCLEO MINERAL'),
    inativo: await produto(c, e1.id, 'SAL VELHO', { ativo: false }),
    daOutra: await produto(c, e2.id, 'SAL DA FAZENDA 2'),
  };
  const cat = {
    bezerro: await categoria(c, e1.id, 'BEZERRO MAMANDO'),
    vaca: await categoria(c, e1.id, 'VACA LEITEIRA'),
    inativa: await categoria(c, e1.id, 'DESCARTE', { ativo: false }),
    daOutra: await categoria(c, e2.id, 'NOVILHA'),
  };
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, e1, e2, adm, p, cat };
};

/** Conta comum do mesmo tenant com as linhas de permissão dadas. */
const contaCom = async (cen, permissoes_telas, extra = {}) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Op', modulos_permitidos: ['manejo'], permissoes_telas, ...extra } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const pronto = (cen, extra = {}) => ({
  empresa_id: cen.e1.id,
  nome: 'sal mineral 80',
  tipo: 'PRONTO',
  produto_id: cen.p.sal.id,
  percentual_pv_padrao: '0,1',
  ...extra,
});
const batelada = (cen, extra = {}) => ({
  empresa_id: cen.e1.id,
  nome: 'proteinado seca',
  tipo: 'BATELADA',
  produto_id: cen.p.mistura.id,
  percentual_pv_padrao: 0.2,
  consumo_objetivo_g_cab_dia: '800',
  ingredientes: [
    { produto_id: cen.p.milho.id, quantidade_kg: 600 },
    { produto_id: cen.p.farelo.id, quantidade_kg: '300' },
    { produto_id: cen.p.nucleo.id, quantidade_kg: '100,000' },
  ],
  regras: [
    { categoria_manejo_id: cen.cat.bezerro.id, consome: false },
    { categoria_manejo_id: cen.cat.vaca.id, consome: true, percentual_pv: '0,15' },
  ],
  ...extra,
});
const criar = (token, payload) => req('POST', '/formulacoes', token, payload);

describe('D-PROD-202 — Formulações: criação, leitura e formato público', () => {
  test('GET /formulacoes sem token → 401', async () => {
    assert.equal((await req('GET', '/formulacoes?empresa_id=x')).statusCode, 401);
    assert.equal((await req('GET', '/formulacoes/opcoes-lancamento?empresa_id=x')).statusCode, 401);
  });

  test('PRONTO (201): nome em MAIÚSCULAS, %PV com vírgula gravado exato, sem ingredientes, total 0, chaves exatas; tenant da sessão', async () => {
    const cen = await cenario();
    const r = await criar(cen.token, pronto(cen, { observacoes: 'comprado pronto' }));
    assert.equal(r.statusCode, 201, r.body);
    const f = r.json();
    assert.deepEqual(Object.keys(f).sort(), CAMPOS_PUBLICOS);
    assert.equal(f.nome, 'SAL MINERAL 80');
    assert.equal(f.tipo, 'PRONTO');
    assert.equal(f.produto_nome, 'SAL MINERAL 80');
    assert.equal(f.percentual_pv_padrao, 0.1);
    assert.equal(f.consumo_objetivo_g_cab_dia, null);
    assert.equal(f.observacoes, 'COMPRADO PRONTO');
    assert.equal(f.ativo, true);
    assert.deepEqual([f.ingredientes, f.regras, f.total_batida_kg], [[], [], 0]);
    const banco = await prisma().formulacao.findUnique({ where: { id: f.id } });
    assert.equal(banco.cliente_id, cen.clienteId);
    assert.equal(banco.percentual_pv_padrao.toString(), '0.1');
  });

  test('BATELADA (201): ingredientes em kg por batida na ordem, total 1.000 kg e o % de cada um; regras com o nome da categoria (não consome sem %PV; VACA 0,15%); lista e detalhe', async () => {
    const cen = await cenario();
    const r = await criar(cen.token, batelada(cen));
    assert.equal(r.statusCode, 201, r.body);
    const f = r.json();
    assert.equal(f.total_batida_kg, 1000);
    assert.deepEqual(f.ingredientes.map((i) => [i.produto_nome, i.quantidade_kg, i.percentual, i.ordem]), [
      ['MILHO GRAO', 600, 60, 0], ['FARELO DE SOJA', 300, 30, 1], ['NUCLEO MINERAL', 100, 10, 2],
    ]);
    assert.equal(f.consumo_objetivo_g_cab_dia, 800);
    assert.deepEqual(f.regras.map((x) => [x.categoria_manejo_nome, x.consome, x.percentual_pv]), [['BEZERRO MAMANDO', false, null], ['VACA LEITEIRA', true, 0.15]]);
    const ing = await prisma().formulacaoIngrediente.findMany({ where: { formulacao_id: f.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(ing.map((i) => [i.quantidade_kg.toString(), i.empresa_id]), [['600', cen.e1.id], ['300', cen.e1.id], ['100', cen.e1.id]]);
    const lista = await req('GET', comEmpresa('/formulacoes', cen.e1.id), cen.token);
    assert.equal(lista.statusCode, 200, lista.body);
    assert.equal(lista.json().length, 1);
    assert.deepEqual(lista.json()[0], f);
    const um = await req('GET', comEmpresa(`/formulacoes/${f.id}`, cen.e1.id), cen.token);
    assert.deepEqual(um.json(), f);
    assert.equal((await req('GET', comEmpresa('/formulacoes', cen.e2.id), cen.token)).json().length, 0, 'outra fazenda não enxerga');
  });

  test('nome único por fazenda (409 FORMULACAO_NAME_CONFLICT, também em maiúsculas); outra fazenda aceita o mesmo nome; corrida → uma 201 e uma 409', async () => {
    const cen = await cenario();
    assert.equal((await criar(cen.token, pronto(cen))).statusCode, 201);
    const dup = await criar(cen.token, pronto(cen, { nome: 'SAL MINERAL 80' }));
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'FORMULACAO_NAME_CONFLICT');
    assert.equal((await criar(cen.token, pronto(cen, { empresa_id: cen.e2.id, produto_id: cen.p.daOutra.id }))).statusCode, 201);
    const [a, b] = await Promise.all([criar(cen.token, pronto(cen, { nome: 'X' })), criar(cen.token, pronto(cen, { nome: 'X' }))]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body} | ${b.body}`);
  });

  test('opções do lançamento: só as ATIVAS, com produto, %PV padrão e regras (sem ingredientes)', async () => {
    const cen = await cenario();
    const ativa = (await criar(cen.token, batelada(cen))).json();
    await criar(cen.token, pronto(cen, { ativo: false }));
    const r = await req('GET', comEmpresa('/formulacoes/opcoes-lancamento', cen.e1.id), cen.token);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), [{
      id: ativa.id, empresa_id: cen.e1.id, nome: 'PROTEINADO SECA', tipo: 'BATELADA', produto_id: cen.p.mistura.id, produto_nome: 'PROTEINADO DA FAZENDA',
      produto_ativo: true, percentual_pv_padrao: 0.2, consumo_objetivo_g_cab_dia: 800,
      regras: [
        { categoria_manejo_id: cen.cat.bezerro.id, categoria_manejo_nome: 'BEZERRO MAMANDO', consome: false, percentual_pv: null },
        { categoria_manejo_id: cen.cat.vaca.id, categoria_manejo_nome: 'VACA LEITEIRA', consome: true, percentual_pv: 0.15 },
      ],
    }]);
  });
});

describe('D-PROD-202 — Formulações: validação', () => {
  test('obrigatórios e chaves fora do schema → 400; nada gravado', async () => {
    const cen = await cenario();
    for (const campo of ['empresa_id', 'nome', 'tipo', 'produto_id', 'percentual_pv_padrao']) {
      const corpo = pronto(cen);
      delete corpo[campo];
      assert.equal((await criar(cen.token, corpo)).statusCode, 400, campo);
    }
    for (const extra of [{ cliente_id: cen.clienteId }, { tipo: 'MISTURA' }, { percentual_consumo_pv: 0.1 }, { regras: [{ categoria_manejo_id: cen.cat.vaca.id, consome: true, percentual_pv: 0.1, x: 1 }] }]) {
      assert.equal((await criar(cen.token, pronto(cen, extra))).statusCode, 400, JSON.stringify(extra));
    }
    assert.equal(await prisma().formulacao.count(), 0);
  });

  test('%PV, consumo objetivo e kg: fora da faixa, casas demais ou tipo errado → 400 com o motivo; extremos aceitos', async () => {
    const cen = await cenario();
    const ruins = [
      [{ percentual_pv_padrao: 0 }, 'percentual_pv_fora_da_faixa'],
      [{ percentual_pv_padrao: '5,01' }, 'percentual_pv_fora_da_faixa'],
      [{ percentual_pv_padrao: '0,12345' }, 'percentual_pv_casas_decimais'],
      [{ percentual_pv_padrao: 'muito' }, 'percentual_pv_invalido'],
      // milhar pt-BR: "1.000,5" é 1000,5 (não 1,0005) → fora da faixa de %PV
      [{ percentual_pv_padrao: '1.000,5' }, 'percentual_pv_fora_da_faixa'],
      [{ percentual_pv_padrao: null }, 'percentual_pv_invalido'],
      [{ percentual_pv_padrao: true }, 'percentual_pv_invalido'],
      [{ consumo_objetivo_g_cab_dia: 0 }, 'consumo_objetivo_fora_da_faixa'],
      [{ consumo_objetivo_g_cab_dia: '1,234' }, 'consumo_objetivo_casas_decimais'],
      [{ consumo_objetivo_g_cab_dia: false }, 'consumo_objetivo_invalido'],
    ];
    for (const [extra, motivo] of ruins) {
      const r = await criar(cen.token, pronto(cen, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)}: ${r.body}`);
      assert.equal(r.json().reason, motivo, JSON.stringify(extra));
    }
    const kg = await criar(cen.token, batelada(cen, { ingredientes: [{ produto_id: cen.p.milho.id, quantidade_kg: 0 }] }));
    assert.equal(kg.json().reason, 'quantidade_fora_da_faixa', kg.body);
    const kgNulo = await criar(cen.token, batelada(cen, { ingredientes: [{ produto_id: cen.p.milho.id, quantidade_kg: null }] }));
    assert.equal(kgNulo.json().reason, 'quantidade_invalido', kgNulo.body);
    assert.equal(await prisma().formulacao.count(), 0);
    const ok = await criar(cen.token, pronto(cen, { percentual_pv_padrao: 5, consumo_objetivo_g_cab_dia: null }));
    assert.equal(ok.statusCode, 201, ok.body);
    const ok2 = await criar(cen.token, pronto(cen, { nome: 'b', percentual_pv_padrao: '0,0001' }));
    assert.equal(ok2.json().percentual_pv_padrao, 0.0001);
    // milhar pt-BR no kg da batida: "1.000" são mil quilos (não 1 kg)
    const mil = await criar(cen.token, batelada(cen, { nome: 'mil', ingredientes: [{ produto_id: cen.p.milho.id, quantidade_kg: '1.000' }] }));
    assert.equal(mil.statusCode, 201, mil.body);
    assert.equal(mil.json().ingredientes[0].quantidade_kg, 1000);
  });

  test('forma: PRONTO com ingrediente, BATELADA sem ingrediente, ingrediente repetido e o produto misturado como ingrediente → 400', async () => {
    const cen = await cenario();
    const casos = [
      [pronto(cen, { ingredientes: [{ produto_id: cen.p.milho.id, quantidade_kg: 1 }] }), 'pronto_com_ingredientes'],
      [batelada(cen, { ingredientes: [] }), 'batelada_sem_ingredientes'],
      [batelada(cen, { ingredientes: undefined }), 'batelada_sem_ingredientes'],
      [batelada(cen, { ingredientes: [{ produto_id: cen.p.milho.id, quantidade_kg: 1 }, { produto_id: cen.p.milho.id, quantidade_kg: 2 }] }), 'ingrediente_duplicado'],
      [batelada(cen, { ingredientes: [{ produto_id: cen.p.milho.id, quantidade_kg: 1 }, { produto_id: cen.p.mistura.id, quantidade_kg: 2 }] }), 'ingrediente_e_o_produto'],
    ];
    for (const [corpo, motivo] of casos) {
      const r = await criar(cen.token, JSON.parse(JSON.stringify(corpo)));
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(r.json().reason, motivo);
    }
    assert.equal(await prisma().formulacao.count(), 0);
  });

  test('regras: não consome com %PV, consome sem %PV, categoria repetida, "consome" que não é booleano → 400', async () => {
    const cen = await cenario();
    const vaca = cen.cat.vaca.id;
    const casos = [
      [[{ categoria_manejo_id: vaca, consome: false, percentual_pv: 0.1 }], 'regra_nao_consome_com_pv'],
      [[{ categoria_manejo_id: vaca, consome: true }], 'regra_pv_obrigatorio'],
      [[{ categoria_manejo_id: vaca, consome: true, percentual_pv: null }], 'regra_pv_obrigatorio'],
      [[{ categoria_manejo_id: vaca, consome: true, percentual_pv: 6 }], 'percentual_pv_fora_da_faixa'],
      [[{ categoria_manejo_id: vaca, consome: false }, { categoria_manejo_id: vaca, consome: true, percentual_pv: 0.1 }], 'regra_duplicada'],
      [[{ categoria_manejo_id: vaca, consome: 'true', percentual_pv: 0.1 }], 'consome_invalido'],
      [[{ categoria_manejo_id: vaca, consome: 1, percentual_pv: 0.1 }], 'consome_invalido'],
    ];
    for (const [regras, motivo] of casos) {
      const r = await criar(cen.token, pronto(cen, { regras }));
      assert.equal(r.statusCode, 400, `${JSON.stringify(regras)}: ${r.body}`);
      assert.equal(r.json().reason, motivo, JSON.stringify(regras));
    }
    assert.equal(await prisma().formulacao.count(), 0);
  });

  test('referências: produto, ingrediente e categoria de OUTRA fazenda ou inexistentes → 400 *_inexistente; inativos em referência nova → 400 *_inativo', async () => {
    const cen = await cenario();
    const casos = [
      [pronto(cen, { produto_id: cen.p.daOutra.id }), 'produto_inexistente'],
      [pronto(cen, { produto_id: 'nao-existe' }), 'produto_inexistente'],
      [pronto(cen, { produto_id: cen.p.inativo.id }), 'produto_inativo'],
      [batelada(cen, { ingredientes: [{ produto_id: cen.p.daOutra.id, quantidade_kg: 1 }] }), 'ingrediente_inexistente'],
      [batelada(cen, { ingredientes: [{ produto_id: cen.p.inativo.id, quantidade_kg: 1 }] }), 'ingrediente_inativo'],
      [pronto(cen, { regras: [{ categoria_manejo_id: cen.cat.daOutra.id, consome: false }] }), 'categoria_inexistente'],
      [pronto(cen, { regras: [{ categoria_manejo_id: cen.cat.inativa.id, consome: false }] }), 'categoria_inativa'],
    ];
    for (const [corpo, motivo] of casos) {
      const r = await criar(cen.token, corpo);
      assert.equal(r.statusCode, 400, `${motivo}: ${r.body}`);
      assert.equal(r.json().reason, motivo);
    }
    assert.equal(await prisma().formulacao.count(), 0);
  });
});

describe('D-PROD-202 — Formulações: edição, exclusão e escopo', () => {
  test('PATCH substitui as listas enviadas e mantém as não enviadas; troca para PRONTO exige ingredientes: []; referência que ficou inativa continua aceita', async () => {
    const cen = await cenario();
    const f = (await criar(cen.token, batelada(cen))).json();
    // Só o nome: listas intactas.
    const nome = await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, nome: 'proteinado 2' });
    assert.equal(nome.statusCode, 200, nome.body);
    assert.equal(nome.json().ingredientes.length, 3);
    assert.equal(nome.json().regras.length, 2);
    // Lista nova inteira: 2 ingredientes, 1 regra.
    const troca = await req('PATCH', `/formulacoes/${f.id}`, cen.token, {
      empresa_id: cen.e1.id,
      ingredientes: [{ produto_id: cen.p.nucleo.id, quantidade_kg: '250,5' }, { produto_id: cen.p.milho.id, quantidade_kg: 749.5 }],
      regras: [{ categoria_manejo_id: cen.cat.vaca.id, consome: false }],
    });
    assert.equal(troca.statusCode, 200, troca.body);
    assert.deepEqual(troca.json().ingredientes.map((i) => [i.produto_nome, i.quantidade_kg, i.percentual]), [['NUCLEO MINERAL', 250.5, 25.05], ['MILHO GRAO', 749.5, 74.95]]);
    assert.equal(troca.json().total_batida_kg, 1000);
    assert.deepEqual(troca.json().regras.map((r) => [r.categoria_manejo_nome, r.consome]), [['VACA LEITEIRA', false]]);
    assert.equal(await prisma().formulacaoIngrediente.count({ where: { formulacao_id: f.id } }), 2);
    // Para PRONTO sem esvaziar os ingredientes → 400; com ingredientes: [] → 200.
    const semEsvaziar = await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, tipo: 'PRONTO', produto_id: cen.p.sal.id });
    assert.equal(semEsvaziar.json().reason, 'pronto_com_ingredientes', semEsvaziar.body);
    const vira = await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, tipo: 'PRONTO', produto_id: cen.p.sal.id, ingredientes: [] });
    assert.equal(vira.statusCode, 200, vira.body);
    assert.deepEqual([vira.json().tipo, vira.json().ingredientes, vira.json().total_batida_kg], ['PRONTO', [], 0]);
    // O produto e a categoria ficaram inativos depois: editar outra coisa continua aceito.
    await prisma().produto.update({ where: { id: cen.p.sal.id }, data: { ativo: false } });
    await prisma().categoriaManejo.update({ where: { id: cen.cat.vaca.id }, data: { ativo: false } });
    const depois = await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, percentual_pv_padrao: '0,12', regras: [{ categoria_manejo_id: cen.cat.vaca.id, consome: true, percentual_pv: 0.1 }] });
    assert.equal(depois.statusCode, 200, depois.body);
    assert.equal(depois.json().produto_ativo, false);
    // Mas trocar PARA um produto inativo, não.
    const paraInativo = await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, produto_id: cen.p.inativo.id });
    assert.equal(paraInativo.json().reason, 'produto_inativo', paraInativo.body);
    assert.equal((await req('PATCH', `/formulacoes/${f.id}`, cen.token, { nome: 'Z' })).statusCode, 400, 'sem empresa_id');
    assert.equal((await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id })).statusCode, 400, 'nada para alterar');
  });

  test('DELETE sem lançamento → 204 (ingredientes e regras saem junto); auditoria create/update/delete; fazenda errada → 404', async () => {
    const cen = await cenario();
    const f = (await criar(cen.token, batelada(cen))).json();
    await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, ativo: false });
    assert.equal((await req('DELETE', comEmpresa(`/formulacoes/${f.id}`, cen.e2.id), cen.token)).statusCode, 404);
    const r = await req('DELETE', comEmpresa(`/formulacoes/${f.id}`, cen.e1.id), cen.token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await prisma().formulacaoIngrediente.count(), 0);
    assert.equal(await prisma().formulacaoRegraCategoria.count(), 0);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: cen.clienteId, entidade: 'Formulacao' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((x) => x.acao), ['create', 'update', 'delete']);
  });

  test('DELETE da formulação citada por lançamento de suplementação da MESMA fazenda → 409 FORMULACAO_EM_USO { lancamentos } (inativar é a saída); lançamento de outra fazenda não conta', async () => {
    const cen = await cenario();
    const f = (await criar(cen.token, pronto(cen))).json();
    const outra = (await criar(cen.token, pronto(cen, { nome: 'outra' }))).json();
    await prisma().suplementacaoEvento.create({ data: { cliente_id: cen.clienteId, empresa_id: cen.e1.id, dados: { formulacao_id: f.id, produto: 'SAL MINERAL 80' } } });
    await prisma().suplementacaoEvento.create({ data: { cliente_id: cen.clienteId, empresa_id: cen.e1.id, dados: { formulacao_id: f.id } } });
    await prisma().suplementacaoEvento.create({ data: { cliente_id: cen.clienteId, empresa_id: cen.e2.id, dados: { formulacao_id: outra.id } } });
    const r = await req('DELETE', comEmpresa(`/formulacoes/${f.id}`, cen.e1.id), cen.token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'FORMULACAO_EM_USO');
    assert.deepEqual(r.json().details, { lancamentos: 2 });
    assert.match(r.json().message, /Inative-a/);
    assert.ok(await prisma().formulacao.findUnique({ where: { id: f.id } }), 'a formulação fica');
    assert.equal((await req('PATCH', `/formulacoes/${f.id}`, cen.token, { empresa_id: cen.e1.id, ativo: false })).statusCode, 200, 'inativar é permitido');
    assert.equal((await req('DELETE', comEmpresa(`/formulacoes/${outra.id}`, cen.e1.id), cen.token)).statusCode, 204, 'o lançamento da outra fazenda não a prende');
  });

  test('tenant B não vê nem usa nada de A: fazenda de A → 404 EMPRESA_NOT_FOUND; produto/categoria de A na fazenda de B → inexistente; formulação de A → 404', async () => {
    const A = await cenario();
    const B = await cenario();
    const f = (await criar(A.token, batelada(A))).json();
    const naFazendaDeA = await criar(B.token, pronto(A));
    assert.equal(naFazendaDeA.statusCode, 404, naFazendaDeA.body);
    assert.equal(naFazendaDeA.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal((await criar(B.token, pronto(B, { produto_id: A.p.sal.id }))).json().reason, 'produto_inexistente');
    assert.equal((await criar(B.token, batelada(B, { ingredientes: [{ produto_id: A.p.milho.id, quantidade_kg: 1 }], regras: [] }))).json().reason, 'ingrediente_inexistente');
    assert.equal((await criar(B.token, pronto(B, { regras: [{ categoria_manejo_id: A.cat.vaca.id, consome: false }] }))).json().reason, 'categoria_inexistente');
    assert.equal((await req('GET', comEmpresa(`/formulacoes/${f.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('GET', comEmpresa('/formulacoes', B.e1.id), B.token)).json().length, 0);
    assert.equal((await req('PATCH', `/formulacoes/${f.id}`, B.token, { empresa_id: B.e1.id, nome: 'x' })).statusCode, 404);
    assert.equal((await req('DELETE', comEmpresa(`/formulacoes/${f.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('GET', comEmpresa('/formulacoes/opcoes-lancamento', A.e1.id), B.token)).statusCode, 404);
  });

  test('excluir a fazenda, o produto ou a categoria em uso é barrado (409 EMPRESA_COM_VINCULOS e FKs Restrict)', async () => {
    const cen = await cenario();
    assert.equal((await criar(cen.token, batelada(cen))).statusCode, 201);
    const r = await req('DELETE', `/empresas/${cen.e1.id}`, cen.token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
    assert.ok(r.json().details.vinculos.some((v) => v.entidade === 'Formulacao'));
    await assert.rejects(prisma().produto.delete({ where: { id: cen.p.mistura.id } }));
    await assert.rejects(prisma().produto.delete({ where: { id: cen.p.milho.id } }));
    await assert.rejects(prisma().categoriaManejo.delete({ where: { id: cen.cat.vaca.id } }));
  });
});

describe('D-PROD-202 — Formulações: permissão da tela pec-formulacoes', () => {
  test('sem a tela → 403 na leitura e na escrita; só "visualizar" lê e não cria; "novo" cria e não exclui; "excluir" exclui', async () => {
    const cen = await cenario();
    const outra = await contaCom(cen, [linha('pec-curvas-ganho', acoes(true))]);
    const ler = await req('GET', comEmpresa('/formulacoes', cen.e1.id), outra);
    assert.equal(ler.statusCode, 403, ler.body);
    assert.equal(ler.json().code, 'ACAO_NAO_PERMITIDA');
    assert.equal((await criar(outra, pronto(cen))).statusCode, 403);
    const ver = await contaCom(cen, [linha('pec-formulacoes', { visualizar: true })]);
    assert.equal((await req('GET', comEmpresa('/formulacoes', cen.e1.id), ver)).statusCode, 200);
    assert.equal((await criar(ver, pronto(cen))).statusCode, 403);
    const novo = await contaCom(cen, [linha('pec-formulacoes', { visualizar: true, novo: true })]);
    const criada = await criar(novo, pronto(cen));
    assert.equal(criada.statusCode, 201, criada.body);
    assert.equal((await req('DELETE', comEmpresa(`/formulacoes/${criada.json().id}`, cen.e1.id), novo)).statusCode, 403);
    const exc = await contaCom(cen, [linha('pec-formulacoes', { visualizar: true, excluir: true })]);
    assert.equal((await req('DELETE', comEmpresa(`/formulacoes/${criada.json().id}`, cen.e1.id), exc)).statusCode, 204);
  });

  test('quem só lança suplementação no mapa lê as opções do lançamento (ativas) e não o cadastro', async () => {
    const cen = await cenario();
    await criar(cen.token, pronto(cen));
    const vaqueiro = await contaCom(cen, [linha('pec-mapa-geral', { visualizar: true })], {
      modulos_permitidos: ['mapa'],
      permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar: true }],
      mapa_geral_permissoes: { visualizar_lotes: true, lancar_suplementacao: true },
    });
    const opcoes = await req('GET', comEmpresa('/formulacoes/opcoes-lancamento', cen.e1.id), vaqueiro);
    assert.equal(opcoes.statusCode, 200, opcoes.body);
    assert.deepEqual(opcoes.json().map((f) => f.nome), ['SAL MINERAL 80']);
    assert.equal((await req('GET', comEmpresa('/formulacoes', cen.e1.id), vaqueiro)).statusCode, 403);
  });
});

describe('D-PROD-202 — Formulações no banco: nomes físicos, CHECK e RLS', () => {
  test('as 3 tabelas físicas existem com RLS ligado; os CHECKs barram escrita direta fora da forma', async () => {
    const cen = await cenario();
    const tabelas = await prisma().$queryRaw`SELECT relname::text AS t, relrowsecurity AS rls FROM pg_class WHERE relname IN ('CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA') AND relkind = 'r' ORDER BY relname`;
    assert.deepEqual(tabelas, [{ t: 'CADFORMULACAO', rls: true }, { t: 'CADFORMULACAOINGREDIENTE', rls: true }, { t: 'CADFORMULACAOREGRA', rls: true }]);
    const base = { cliente_id: cen.clienteId, empresa_id: cen.e1.id, nome: 'X', tipo: 'PRONTO', produto_id: cen.p.sal.id, percentual_pv_padrao: '0.1' };
    await assert.rejects(prisma().formulacao.create({ data: { ...base, tipo: 'OUTRO' } }), /CADFORMULACAO_tipo_check|check constraint/i);
    await assert.rejects(prisma().formulacao.create({ data: { ...base, percentual_pv_padrao: '0' } }), /percentual_pv_padrao_check|check constraint/i);
    await assert.rejects(prisma().formulacao.create({ data: { ...base, percentual_pv_padrao: '5.0001' } }), /percentual_pv_padrao_check|check constraint/i);
    await assert.rejects(prisma().formulacao.create({ data: { ...base, consumo_objetivo_g_cab_dia: '0' } }), /consumo_objetivo_check|check constraint/i);
    const f = await prisma().formulacao.create({ data: base });
    const escopo = { cliente_id: cen.clienteId, empresa_id: cen.e1.id, formulacao_id: f.id };
    await assert.rejects(prisma().formulacaoIngrediente.create({ data: { ...escopo, produto_id: cen.p.milho.id, quantidade_kg: '0' } }), /quantidade_kg_check|check constraint/i);
    await assert.rejects(prisma().formulacaoRegraCategoria.create({ data: { ...escopo, categoria_manejo_id: cen.cat.vaca.id, consome: false, percentual_pv: '0.1' } }), /forma_check|check constraint/i);
    await assert.rejects(prisma().formulacaoRegraCategoria.create({ data: { ...escopo, categoria_manejo_id: cen.cat.vaca.id, consome: true } }), /forma_check|check constraint/i);
    // A filha é da MESMA fazenda da formulação por construção (FK composta com empresa_id).
    await assert.rejects(prisma().formulacaoIngrediente.create({ data: { ...escopo, empresa_id: cen.e2.id, produto_id: cen.p.milho.id, quantidade_kg: '1' } }));
    assert.equal(await prisma().formulacaoIngrediente.count(), 0);
  });
});
