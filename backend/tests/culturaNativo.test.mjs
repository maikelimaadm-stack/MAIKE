/**
 * Cadastro de Culturas (D-PROD-215), tabela física "CADCULTURAS" — PostgreSQL real.
 *
 * Cadastro novo, sem vínculo com nenhum outro: código (numeração da fazenda,
 * próximo número sugerido pelo servidor) e nome únicos por fazenda, tipo fechado
 * (PASTAGEM | CAPINEIRA | LAVOURA | SILAGEM), alturas de referência em cm (pt-BR,
 * 1 casa, saída < entrada), lista de referência por comando idempotente,
 * isolamento por tenant e por fazenda, exclusão física, permissão pela própria
 * tela `pec-culturas` (leitura incluída), CHECKs e RLS no banco.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { LISTA_REFERENCIA, proximoCodigo, alturaDoCorpo } from '../src/modules/culturas/culturaService.js';

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

const CAMPOS_PUBLICOS = [
  'altura_entrada_cm', 'altura_saida_cm', 'ativo', 'codigo', 'created_date', 'cultivar', 'dias_descanso', 'empresa_id', 'especie', 'id', 'nome',
  'observacoes', 'tipo', 'updated_date',
];

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (tela, a) => ({ modulo_id: 'manejo', tela_id: tela, ...acoes(false), ...a });

/** Tenant administrador com duas fazendas. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, e1, e2, adm };
};

/** Conta comum do mesmo tenant com as linhas de permissão dadas. */
const contaCom = async (cen, permissoes_telas, modulos = ['manejo']) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Op', modulos_permitidos: modulos, permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const base = (empresaId, extra = {}) => ({
  empresa_id: empresaId,
  nome: 'braquiarão da baixada',
  tipo: 'PASTAGEM',
  especie: 'Urochloa brizantha',
  cultivar: 'Marandu',
  altura_entrada_cm: '25',
  altura_saida_cm: '15',
  ...extra,
});

const criar = (token, payload) => req('POST', '/culturas', token, payload);
const comEmpresa = (url, empresaId) => `${url}?empresa_id=${encodeURIComponent(empresaId)}`;
const listaReferencia = (token, empresaId) => req('POST', '/culturas/comandos/lista-referencia', token, { empresa_id: empresaId });

describe('D-PROD-215 — Culturas: funções puras', () => {
  test('proximoCodigo: depois do maior número, 3 dígitos, pula o ocupado; ignora código não numérico', () => {
    assert.equal(proximoCodigo([]), '001');
    assert.equal(proximoCodigo(['001', '002', '011']), '012');
    assert.equal(proximoCodigo(['A1', 'X']), '001');
    assert.equal(proximoCodigo(['9']), '010');
  });

  test('alturaDoCorpo: pt-BR, 1 casa, > 0, teto; vazio = sem altura', () => {
    assert.equal(alturaDoCorpo('25,5', 'altura_entrada_cm'), '25.5');
    assert.equal(alturaDoCorpo(25, 'altura_entrada_cm'), '25.0');
    assert.equal(alturaDoCorpo('', 'altura_entrada_cm'), null);
    assert.equal(alturaDoCorpo(null, 'altura_entrada_cm'), null);
    assert.equal(alturaDoCorpo(undefined, 'altura_entrada_cm'), undefined);
    for (const ruim of ['0', '-3', '25,55', 'abc', 1001]) assert.throws(() => alturaDoCorpo(ruim, 'altura_entrada_cm'), (e) => e.code === 'REQUEST_VALIDATION_FAILED', String(ruim));
  });

  // D-PROD-269: + os 6 do Doc 397 que faltavam (012–017); o Estilosantes Campo Grande (leguminosa) sem altura.
  test('LISTA_REFERENCIA: 17 pastagens numeradas 001–017, nomes únicos, saída < entrada (com as duas alturas)', () => {
    assert.equal(LISTA_REFERENCIA.length, 17);
    assert.deepEqual(LISTA_REFERENCIA.map((c) => c.codigo), ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017']);
    assert.equal(new Set(LISTA_REFERENCIA.map((c) => c.nome)).size, 17);
    for (const c of LISTA_REFERENCIA) {
      assert.equal(c.tipo, 'PASTAGEM');
      if (c.entrada !== null && c.saida !== null) assert.ok(c.saida < c.entrada, c.nome);
      else assert.equal(c.nome, 'ESTILOSANTES CAMPO GRANDE', 'só a leguminosa fica sem altura (o Doc 397 não traz)');
    }
  });
});

describe('D-PROD-215 — Culturas: criação, leitura e formato público', () => {
  test('GET /culturas sem token → 401', async () => {
    const r = await req('GET', '/culturas?empresa_id=x');
    assert.equal(r.statusCode, 401);
  });

  test('POST cria (201): nome em MAIÚSCULAS, código 001 sugerido, alturas numéricas, ativo por padrão, chaves exatas; GET lista e detalha', async () => {
    const { token, e1 } = await cenario();
    const r = await criar(token, base(e1.id, { altura_entrada_cm: '25,5' }));
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c).sort(), CAMPOS_PUBLICOS);
    assert.equal(c.nome, 'BRAQUIARÃO DA BAIXADA');
    assert.equal(c.codigo, '001');
    assert.equal(c.altura_entrada_cm, 25.5);
    assert.equal(c.altura_saida_cm, 15);
    assert.equal(c.especie, 'Urochloa brizantha');
    assert.equal(c.ativo, true);
    const segunda = await criar(token, base(e1.id, { nome: 'capim 2', tipo: 'CAPINEIRA', altura_entrada_cm: null, altura_saida_cm: null }));
    assert.equal(segunda.statusCode, 201, segunda.body);
    assert.equal(segunda.json().codigo, '002');
    assert.equal(segunda.json().altura_entrada_cm, null);
    const lista = await req('GET', comEmpresa('/culturas', e1.id), token);
    assert.equal(lista.statusCode, 200);
    assert.deepEqual(lista.json().map((x) => x.codigo), ['001', '002']);
    const um = await req('GET', comEmpresa(`/culturas/${c.id}`, e1.id), token);
    assert.equal(um.statusCode, 200);
    assert.equal(um.json().id, c.id);
  });

  test('código informado é normalizado; código e nome repetidos na fazenda → 409; em outra fazenda é permitido', async () => {
    const { token, e1, e2 } = await cenario();
    assert.equal((await criar(token, base(e1.id, { codigo: 'p-10' }))).json().codigo, 'P-10');
    const codigoRepetido = await criar(token, base(e1.id, { nome: 'outro', codigo: 'P-10' }));
    assert.equal(codigoRepetido.statusCode, 409, codigoRepetido.body);
    assert.equal(codigoRepetido.json().code, 'CULTURA_CODIGO_CONFLICT');
    const nomeRepetido = await criar(token, base(e1.id, { nome: 'BRAQUIARÃO da baixada' }));
    assert.equal(nomeRepetido.statusCode, 409, nomeRepetido.body);
    assert.equal(nomeRepetido.json().code, 'CULTURA_NAME_CONFLICT');
    assert.equal((await criar(token, base(e2.id, { codigo: 'P-10' }))).statusCode, 201);
  });
});

describe('D-PROD-215 — Culturas: validação do corpo', () => {
  test('campos fora do schema (cliente_id, chave extra) → 400 e nada gravado', async () => {
    const { token, clienteId, e1 } = await cenario();
    assert.equal((await criar(token, base(e1.id, { cliente_id: clienteId }))).statusCode, 400);
    assert.equal((await criar(token, base(e1.id, { area_id: 'x' }))).statusCode, 400);
    assert.equal(await prisma().cultura.count(), 0);
  });

  test('obrigatórios (empresa_id, nome, tipo) e tipo fechado → 400; os quatro tipos aceitos', async () => {
    const { token, e1 } = await cenario();
    for (const falta of ['empresa_id', 'nome', 'tipo']) {
      const corpo = base(e1.id);
      delete corpo[falta];
      assert.equal((await criar(token, corpo)).statusCode, 400, falta);
    }
    assert.equal((await criar(token, base(e1.id, { tipo: 'PASTO' }))).statusCode, 400);
    for (const [i, tipo] of ['PASTAGEM', 'CAPINEIRA', 'LAVOURA', 'SILAGEM'].entries()) {
      assert.equal((await criar(token, base(e1.id, { nome: `c${i}`, tipo }))).statusCode, 201, tipo);
    }
  });

  test('alturas: inválida, zero, 2 casas, acima do teto, saída >= entrada → 400 com field/reason; só uma altura é aceita', async () => {
    const { token, e1 } = await cenario();
    const casos = [
      [{ altura_entrada_cm: 'abc' }, 'altura_entrada_cm', 'altura_invalida'],
      [{ altura_entrada_cm: '0' }, 'altura_entrada_cm', 'altura_fora_da_faixa'],
      [{ altura_saida_cm: '10,25' }, 'altura_saida_cm', 'altura_casas_decimais'],
      [{ altura_entrada_cm: 1001 }, 'altura_entrada_cm', 'altura_fora_da_faixa'],
      [{ altura_entrada_cm: '20', altura_saida_cm: '20' }, 'altura_saida_cm', 'altura_saida_maior_ou_igual'],
      [{ altura_entrada_cm: true }, 'altura_entrada_cm', 'altura_invalida'],
    ];
    for (const [extra, field, reason] of casos) {
      const r = await criar(token, base(e1.id, extra));
      assert.equal(r.statusCode, 400, JSON.stringify(extra));
      assert.equal(r.json().field, field, JSON.stringify(extra));
      assert.equal(r.json().reason, reason, JSON.stringify(extra));
    }
    assert.equal((await criar(token, base(e1.id, { altura_saida_cm: null }))).statusCode, 201);
    assert.equal(await prisma().cultura.count(), 1);
  });

  test('D-PROD-223 dias de descanso: inteiro 1..365 (número ou texto), null limpa; fora da faixa, fração, texto ou booleano → 400', async () => {
    const { token, e1 } = await cenario();
    const r = await criar(token, base(e1.id, { dias_descanso: '30' }));
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().dias_descanso, 30);
    for (const [valor, reason] of [[0, 'dias_descanso_fora_da_faixa'], [366, 'dias_descanso_fora_da_faixa'], ['abc', 'dias_descanso_invalido'], ['3,5', 'dias_descanso_invalido'], [true, 'dias_descanso_invalido']]) {
      const ruim = await req('PATCH', `/culturas/${r.json().id}`, token, { empresa_id: e1.id, dias_descanso: valor });
      assert.equal(ruim.statusCode, 400, String(valor));
      assert.equal(ruim.json().field, 'dias_descanso', String(valor));
      assert.equal(ruim.json().reason, reason, String(valor));
    }
    const ok = await req('PATCH', `/culturas/${r.json().id}`, token, { empresa_id: e1.id, dias_descanso: 28 });
    assert.equal(ok.json().dias_descanso, 28);
    const limpa = await req('PATCH', `/culturas/${r.json().id}`, token, { empresa_id: e1.id, dias_descanso: null });
    assert.equal(limpa.json().dias_descanso, null);
  });

  test('código com caractere inválido → 400 codigo_invalido', async () => {
    const { token, e1 } = await cenario();
    const r = await criar(token, base(e1.id, { codigo: '0 1' }));
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'codigo_invalido');
  });
});

describe('D-PROD-215 — Culturas: edição, exclusão e isolamento', () => {
  test('PATCH altera e confere a coerência das alturas com o valor que já estava gravado', async () => {
    const { token, e1 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    const ok = await req('PATCH', `/culturas/${a.id}`, token, { empresa_id: e1.id, nome: 'marandu do retiro', altura_entrada_cm: '30', ativo: false });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().nome, 'MARANDU DO RETIRO');
    assert.equal(ok.json().altura_entrada_cm, 30);
    assert.equal(ok.json().ativo, false);
    const invertida = await req('PATCH', `/culturas/${a.id}`, token, { empresa_id: e1.id, altura_saida_cm: '35' });
    assert.equal(invertida.statusCode, 400, invertida.body);
    assert.equal(invertida.json().reason, 'altura_saida_maior_ou_igual');
    assert.equal((await req('PATCH', `/culturas/${a.id}`, token, { empresa_id: e1.id, codigo: null })).statusCode, 400, 'código não fica vazio');
    assert.equal((await req('PATCH', `/culturas/${a.id}`, token, { empresa_id: e1.id })).statusCode, 400, 'nada para alterar');
  });

  test('DELETE apaga (204) e some (404); pela fazenda errada → 404; auditoria de create/update/delete', async () => {
    const { token, clienteId, e1, e2 } = await cenario();
    const a = (await criar(token, base(e1.id))).json();
    await req('PATCH', `/culturas/${a.id}`, token, { empresa_id: e1.id, nome: 'renomeada' });
    assert.equal((await req('DELETE', comEmpresa(`/culturas/${a.id}`, e2.id), token)).statusCode, 404);
    const r = await req('DELETE', comEmpresa(`/culturas/${a.id}`, e1.id), token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal((await req('GET', comEmpresa(`/culturas/${a.id}`, e1.id), token)).statusCode, 404);
    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'Cultura' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(eventos.map((x) => x.acao), ['create', 'update', 'delete']);
  });

  test('fazenda de outro tenant → 404; tenant B não vê nem altera cultura de A', async () => {
    const A = await cenario();
    const B = await cenario();
    const a = (await criar(A.token, base(A.e1.id))).json();
    const naFazendaDeA = await criar(B.token, base(A.e1.id));
    assert.equal(naFazendaDeA.statusCode, 404, naFazendaDeA.body);
    assert.equal(naFazendaDeA.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal((await req('GET', comEmpresa('/culturas', A.e1.id), B.token)).statusCode, 404);
    assert.equal((await req('PATCH', `/culturas/${a.id}`, B.token, { empresa_id: B.e1.id, nome: 'x' })).statusCode, 404);
    assert.equal((await req('DELETE', comEmpresa(`/culturas/${a.id}`, B.e1.id), B.token)).statusCode, 404);
    assert.equal((await listaReferencia(B.token, A.e1.id)).statusCode, 404);
    assert.equal(await prisma().cultura.count({ where: { empresa_id: A.e1.id } }), 1);
  });

  test('excluir a fazenda que tem cultura → 409 EMPRESA_COM_VINCULOS', async () => {
    const { token, e1 } = await cenario();
    assert.equal((await criar(token, base(e1.id))).statusCode, 201);
    const r = await req('DELETE', `/empresas/${e1.id}`, token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
  });
});

describe('D-PROD-215 — Culturas: lista de referência', () => {
  test('inclui as 17 numeradas 001–017 com alturas; repetir não duplica (idempotente)', async () => {
    const { token, e1, e2 } = await cenario();
    const r = await listaReferencia(token, e1.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().criadas, 17);
    assert.equal(r.json().ja_existiam, 0);
    const marandu = r.json().culturas.find((c) => c.codigo === '001');
    assert.equal(marandu.nome, 'BRACHIARIA BRIZANTHA CV. MARANDU');
    // D-PROD-269: Doc 397 (Embrapa Cerrados, Tabela 2): entrada 35, saída 20 (era 25/15).
    assert.equal(marandu.altura_entrada_cm, 35);
    assert.equal(marandu.altura_saida_cm, 20);
    assert.equal(marandu.dias_descanso, 30, 'D-PROD-223: dias de descanso de referência');
    assert.equal(marandu.observacoes, 'Valor de referência (manejo rotacionado). Ajuste para a fazenda.');
    const mombaca = r.json().culturas.find((c) => c.codigo === '007');
    assert.equal(mombaca.altura_entrada_cm, 90);
    assert.equal(mombaca.dias_descanso, 35);
    assert.equal(r.json().culturas.find((c) => c.codigo === '011').dias_descanso, 25);
    const de_novo = await listaReferencia(token, e1.id);
    assert.equal(de_novo.json().criadas, 0);
    assert.equal(de_novo.json().ja_existiam, 17);
    assert.equal(await prisma().cultura.count({ where: { empresa_id: e1.id } }), 17);
    assert.equal(await prisma().cultura.count({ where: { empresa_id: e2.id } }), 0, 'outra fazenda intocada');
  });

  test('nome já cadastrado é pulado; código ocupado por outra cultura → próximo número livre', async () => {
    const { token, e1 } = await cenario();
    assert.equal((await criar(token, base(e1.id, { nome: 'BRACHIARIA BRIZANTHA CV. MARANDU', codigo: '050' }))).statusCode, 201);
    assert.equal((await criar(token, base(e1.id, { nome: 'meu capim', codigo: '002' }))).statusCode, 201);
    const r = await listaReferencia(token, e1.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().criadas, 16);
    assert.equal(r.json().ja_existiam, 1);
    const xaraes = r.json().culturas.find((c) => c.nome === 'BRACHIARIA BRIZANTHA CV. XARAÉS');
    assert.equal(xaraes.codigo, '051', 'o 002 era de outra; o próximo depois do maior (050)');
    assert.equal(new Set(r.json().culturas.map((c) => c.codigo)).size, r.json().culturas.length);
  });

  test('permissão: incluir a lista exige criar na tela; só visualizar → 403 e nada gravado', async () => {
    const cen = await cenario();
    const ver = await contaCom(cen, [linha('pec-culturas', { visualizar: true })]);
    assert.equal((await listaReferencia(ver, cen.e1.id)).statusCode, 403);
    assert.equal(await prisma().cultura.count(), 0);
    const novo = await contaCom(cen, [linha('pec-culturas', { visualizar: true, novo: true })]);
    assert.equal((await listaReferencia(novo, cen.e1.id)).statusCode, 200);
  });
});

describe('D-PROD-215 — Culturas: permissão da tela pec-culturas', () => {
  test('sem a tela (só pec-estacoes) → 403 na leitura e na escrita, nada gravado', async () => {
    const cen = await cenario();
    const token = await contaCom(cen, [linha('pec-estacoes', { visualizar: true, novo: true, salvar: true, editar: true, excluir: true })]);
    const ler = await req('GET', comEmpresa('/culturas', cen.e1.id), token);
    assert.equal(ler.statusCode, 403, ler.body);
    assert.equal(ler.json().code, 'ACAO_NAO_PERMITIDA');
    assert.equal((await criar(token, base(cen.e1.id))).statusCode, 403);
    assert.equal(await prisma().cultura.count(), 0);
  });

  test('só "visualizar" lê (200) e não cria (403); "novo" cria; "editar" edita; "excluir" exclui', async () => {
    const cen = await cenario();
    const ver = await contaCom(cen, [linha('pec-culturas', { visualizar: true })]);
    assert.equal((await req('GET', comEmpresa('/culturas', cen.e1.id), ver)).statusCode, 200);
    assert.equal((await criar(ver, base(cen.e1.id))).statusCode, 403);
    const novo = await contaCom(cen, [linha('pec-culturas', { visualizar: true, novo: true })]);
    const criada = await criar(novo, base(cen.e1.id));
    assert.equal(criada.statusCode, 201, criada.body);
    assert.equal((await req('PATCH', `/culturas/${criada.json().id}`, novo, { empresa_id: cen.e1.id, nome: 'x' })).statusCode, 403);
    const ed = await contaCom(cen, [linha('pec-culturas', { visualizar: true, editar: true })]);
    assert.equal((await req('PATCH', `/culturas/${criada.json().id}`, ed, { empresa_id: cen.e1.id, nome: 'x' })).statusCode, 200);
    assert.equal((await req('DELETE', comEmpresa(`/culturas/${criada.json().id}`, cen.e1.id), novo)).statusCode, 403);
    const exc = await contaCom(cen, [linha('pec-culturas', { visualizar: true, excluir: true })]);
    assert.equal((await req('DELETE', comEmpresa(`/culturas/${criada.json().id}`, cen.e1.id), exc)).statusCode, 204);
  });
});

describe('D-PROD-215 — CADCULTURAS no banco: nome físico, CHECKs e RLS', () => {
  test('a tabela física chama "CADCULTURAS", tem RLS ligado e os CHECKs de tipo e alturas barram escrita direta', async () => {
    const { clienteId, e1 } = await cenario();
    const [tabela] = await prisma().$queryRaw`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'CADCULTURAS' AND relkind = 'r'`;
    assert.ok(tabela, 'tabela "CADCULTURAS" existe');
    assert.equal(tabela.relrowsecurity, true, 'RLS ligado');
    const dados = { cliente_id: clienteId, empresa_id: e1.id, codigo: '001', nome: 'X' };
    await assert.rejects(prisma().cultura.create({ data: { ...dados, tipo: 'PASTO' } }), /CADCULTURAS_tipo_check|check constraint/i);
    await assert.rejects(prisma().cultura.create({ data: { ...dados, tipo: 'PASTAGEM', altura_entrada_cm: '0' } }), /CADCULTURAS_alturas_check|check constraint/i);
    await assert.rejects(
      prisma().cultura.create({ data: { ...dados, tipo: 'PASTAGEM', altura_entrada_cm: '20', altura_saida_cm: '25' } }),
      /CADCULTURAS_alturas_check|check constraint/i
    );
    assert.equal(await prisma().cultura.count(), 0);
  });
});
