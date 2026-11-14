/**
 * TipoAtividade nativo (D-PROD-182, D-PROD-196) — PostgreSQL real.
 *
 * D-PROD-182: cadastro irmão do Tipo de Tarefa: nome em MAIÚSCULAS e único por
 * (cliente, grupo), cache do nome do grupo, isolamento por tenant, exclusão
 * física, grupo com tipo vinculado não sai (409 + FK Restrict).
 *
 * D-PROD-196 (Fatia 1 — contrato `docs/engineering/MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`):
 * o tipo guarda os PADRÕES que a atividade herda (categoria, centros de custo e
 * de resultado, unidade de produção, coeficiente) e as 8 FLAGS de como ela
 * funciona. Prova, regra a regra (§3 e §7 do contrato):
 *  - defaults na criação (flags false, padrões null) e a forma pública com os
 *    objetos incluídos (criação, edição, detalhe, lista e auditoria);
 *  - flags gravam e leem (ligar e desligar), sem coerção: null, "true", 1 → 400;
 *  - categoria: as 9 válidas; fora da lista → 400; coeficiente canônico com 4
 *    casas; zero → 422 `nao_positivo`; formato inválido ou número JSON → 400;
 *  - 422 `TIPO_ATIVIDADE_PADRAO_INVALIDO` (`field`/`reason`): centro ou unidade
 *    inexistente ou de outro cliente (`nao_encontrado`, sem oráculo), inativo
 *    (`inativo`), centros de empresas diferentes (`empresas_diferentes`, também
 *    mudando só um deles); conferido só quando o campo muda — padrão que ficou
 *    inativo depois de gravado continua no tipo; o cadastro que some na corrida
 *    (P2003 da FK nova, forçado por gatilho temporário) dá o mesmo `nao_encontrado`;
 *  - unicidade (cliente, grupo, nome) mantida; `pode_ter_*` → 400 (nomes
 *    aposentados); `exige_area` passa a ser campo válido; o TipoTarefa continua
 *    sem flag nenhuma (D-PROD-181/183);
 *  - opções de centros do formulário (§3.4): só ATIVOS da empresa, por número,
 *    no máximo 1000; 404 da empresa alheia; 403 sem criar/editar tipo.
 * Toda recusa prova "nada gravado" pelas linhas completas do tipo e da
 * auditoria do tenant.
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

/** As 8 flags da D-PROD-196, na ordem do contrato (§2). */
const FLAGS = Object.freeze([
  'exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento', 'permite_produto', 'permite_servico', 'permite_mao_obra', 'exige_producao',
]);
/** As 9 categorias do CHECK `TipoAtividade_categoria_check`. */
const CATEGORIAS = Object.freeze(['PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'COLHEITA', 'PASTAGEM', 'BENFEITORIA', 'MANEJO_ANIMAL', 'OUTROS']);
/** Nomes aposentados (D-PROD-181/183): continuam recusados em /tipos-atividade. */
const CHAVES_APOSENTADAS = Object.freeze(['pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento']);
const CAMPOS_D182 = Object.freeze([
  'ativo', 'created_date', 'descricao', 'grupo_atividade_id', 'grupo_atividade_nome', 'id', 'nome_tipo', 'updated_date',
]);
/** Campos novos da resposta (§3.2). */
const CAMPOS_D195 = Object.freeze([
  'categoria',
  'centro_custo_padrao_id', 'centro_custo_padrao',
  'centro_resultado_padrao_id', 'centro_resultado_padrao',
  'unidade_producao_id', 'unidade_producao',
  'coeficiente_padrao',
  ...FLAGS,
]);
const CAMPOS_PUBLICOS = Object.freeze([...CAMPOS_D182, ...CAMPOS_D195].sort());
/** Os campos novos de um tipo sem nada informado: flags false, padrões null. */
const SEM_PADROES = Object.freeze({
  categoria: null,
  centro_custo_padrao_id: null, centro_custo_padrao: null,
  centro_resultado_padrao_id: null, centro_resultado_padrao: null,
  unidade_producao_id: null, unidade_producao: null,
  coeficiente_padrao: null,
  ...Object.fromEntries(FLAGS.map((f) => [f, false])),
});
const PADRAO_INVALIDO = 'TIPO_ATIVIDADE_PADRAO_INVALIDO';

/** Só os campos da D-PROD-196 (ausente vira `undefined`, e a comparação acusa). */
const camposD195 = (t) => Object.fromEntries(CAMPOS_D195.map((k) => [k, t[k]]));
const flagsDe = (t) => Object.fromEntries(FLAGS.map((f) => [f, t[f]]));
/** Forma do centro dentro do tipo (§3.2). */
const centroPublico = (c) => ({ id: c.id, numero: c.numero, nome: c.nome, empresa_id: c.empresa_id, ativo: c.ativo });
/** Forma da unidade dentro do tipo (§3.2). */
const unidadePublica = (u) => ({ id: u.id, sigla: u.sigla, descricao: u.descricao, ativo: u.ativo });

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

const tenantAutenticado = async (opcoes) => {
  const { cliente, usuario, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: cliente.id, senha: credenciais.senha, senhaHash: usuario.senha_hash };
};

const criarGrupo = async (token, nome) => {
  const r = await req('POST', '/grupos-atividade', token, { nome_grupo: nome });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const criarTipo = (token, payload) => req('POST', '/tipos-atividade', token, payload);
const patchTipo = (token, id, payload) => req('PATCH', `/tipos-atividade/${id}`, token, payload);
const criarTipoOk = async (token, payload) => {
  const r = await criarTipo(token, payload);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const patchTipoOk = async (token, id, payload) => {
  const r = await patchTipo(token, id, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const detalheOk = async (token, id) => {
  const r = await req('GET', `/tipos-atividade/${id}`, token);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const linhaDoTipo = (id) => prisma().tipoAtividade.findUnique({ where: { id } });

const criarUnidade = async (token, sigla, descricao) => {
  const r = await req('POST', '/unidades-medida', token, { sigla, descricao });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const inativarUnidade = async (token, unidade) => {
  const r = await req('PATCH', `/unidades-medida/${unidade.id}`, token, { ativo: false });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

/** `[status, code, field, reason]` de uma resposta de erro. */
const erro = (r) => {
  const c = r.json();
  return [r.statusCode, c.code, c.field ?? null, c.reason ?? null];
};
/** Corpo de erro sem o id de rastreio e sem o id enviado (o resto tem de ser idêntico). */
const corpoErroSem = (r, idEnviado) => {
  const resto = { ...r.json() };
  delete resto.request_id;
  return JSON.stringify(resto).replaceAll(idEnviado, '<id>');
};

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** Prova de "nada gravado": linhas COMPLETAS dos tipos e da auditoria do tipo no tenant. */
const foto = async (clienteId) =>
  JSON.stringify({
    tipos: await prisma().tipoAtividade.findMany({ where: { cliente_id: clienteId }, orderBy: { id: 'asc' } }),
    auditoria: await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'TipoAtividade' }, orderBy: { id: 'asc' } }),
  }, replacer);

/** Recusa com `[status, code, field, reason]` exatos e nada gravado. */
const recusa = async (clienteId, pedir, esperado, rotulo) => {
  const antes = await foto(clienteId);
  const r = await pedir();
  assert.deepEqual(erro(r), esperado, `${rotulo}: ${r.body}`);
  assert.equal(await foto(clienteId), antes, `${rotulo}: nada gravado`);
  return r;
};
/** Recusa de validação (400 `REQUEST_VALIDATION_FAILED`) e nada gravado. */
const recusaValidacao = async (clienteId, pedir, rotulo) => {
  const antes = await foto(clienteId);
  const r = await pedir();
  assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
  assert.equal(await foto(clienteId), antes, `${rotulo}: nada gravado`);
  return r;
};

const criarCentro = (modelo, clienteId, empresaId, { numero, nome, ativo = true }) =>
  prisma()[modelo].create({ data: { cliente_id: clienteId, empresa_id: empresaId, numero, nome, ativo } });

/**
 * Cenário D-PROD-196: tenant (concessão `is_admin`) com duas fazendas, um
 * grupo, um centro de custo e um de resultado ATIVOS por fazenda e a unidade HA
 * (pela API de Unidades). `cc`/`cr` criam mais centros (numero, nome, ativo).
 */
const montar = async () => {
  const t = await tenantAutenticado();
  const p = prisma();
  const sufixo = randomUUID().slice(0, 6);
  const empresa = (n) => p.empresa.create({ data: { cliente_id: t.clienteId, numero_empresa: n, apelido: `F${n}`, nome: `Fazenda ${n} ${sufixo}` } });
  const e1 = await empresa(1);
  const e2 = await empresa(2);
  const cc = (e, numero, nome, ativo = true) => criarCentro('centroCusto', t.clienteId, e.id, { numero, nome, ativo });
  const cr = (e, numero, nome, ativo = true) => criarCentro('centroResultado', t.clienteId, e.id, { numero, nome, ativo });
  const grupo = await criarGrupo(t.token, 'Lavoura');
  return {
    ...t,
    e1,
    e2,
    grupo,
    cc,
    cr,
    empresa,
    cc1: await cc(e1, '11', 'MAQUINAS F1'),
    cr1: await cr(e1, '21', 'SOJA F1'),
    cc2: await cc(e2, '12', 'MAQUINAS F2'),
    cr2: await cr(e2, '22', 'SOJA F2'),
    ha: await criarUnidade(t.token, 'ha', 'Hectare'),
  };
};
/** Corpo mínimo de criação no grupo do cenário. */
const base = (s, nome = 'Pulverização', extra = {}) => ({ nome_tipo: nome, grupo_atividade_id: s.grupo.id, ...extra });

const ACOES_TELA = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar']);
const TODAS_ACOES = Object.freeze(Object.fromEntries(ACOES_TELA.map((a) => [a, true])));
/** Linha de permissão da tela com só as ações dadas ligadas. */
const linhaTela = (modulo, tela, ligadas = {}) => ({ modulo_id: modulo, tela_id: tela, ...Object.fromEntries(ACOES_TELA.map((a) => [a, false])), ...ligadas });
/** Permissão só na tela de Tipos de Atividade (visualizar + as ações dadas). */
const permTipos = (ligadas) => ({
  modulos_permitidos: ['suporte-mapa'],
  permissoes_telas: [linhaTela('suporte-mapa', 'sup-tipos-atividade', { visualizar: true, ...ligadas })],
});
/** Usuário do MESMO tenant com a permissão dada (`null` = sem linha de Permissão). */
const contaNoTenant = async (t, permissao, extra = {}) => {
  const login = `ta-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: t.clienteId, nome: 'Operador', login, senha_hash: t.senhaHash, papel_tenant: 'usuario', ...extra } });
  if (permissao) await prisma().permissao.create({ data: { cliente_id: t.clienteId, user_email: login, user_nome: 'Operador', ...permissao } });
  const { corpo } = await autenticarNoApp(app, { login, senha: t.senha });
  assert.ok(corpo.token, `login ${login}`);
  return corpo.token;
};

describe('D-PROD-182 — TipoAtividade: criação e conflitos', () => {
  test('GET /tipos-atividade sem token → 401', async () => {
    const r = await req('GET', '/tipos-atividade');
    assert.equal(r.statusCode, 401);
  });

  test('POST cria (201): nome em MAIÚSCULAS, cache do nome do grupo, conjunto exato de chaves públicas', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'operacional');

    const r = await criarTipo(token, { nome_tipo: 'roçada manual', grupo_atividade_id: g.id, descricao: 'com foice' });
    assert.equal(r.statusCode, 201, r.body);
    const t = r.json();
    assert.deepEqual(Object.keys(t).sort(), CAMPOS_PUBLICOS);
    assert.equal(t.nome_tipo, 'ROÇADA MANUAL');
    assert.equal(t.grupo_atividade_id, g.id);
    assert.equal(t.grupo_atividade_nome, 'OPERACIONAL');
    assert.equal(t.ativo, true, 'ativo por padrão');
    assert.equal(t.descricao, 'com foice');

    const lista = await req('GET', '/tipos-atividade', token);
    assert.equal(lista.statusCode, 200, lista.body);
    assert.equal(lista.json().length, 1);
    assert.deepEqual(Object.keys(lista.json()[0]).sort(), CAMPOS_PUBLICOS);

    const linha = await prisma().tipoAtividade.findUnique({ where: { id: t.id } });
    assert.equal(linha.cliente_id, clienteId, 'tenant vem do auth_context');

    const audit = await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'TipoAtividade' } });
    assert.equal(audit.length, 1, 'criação auditada');
  });

  test('nome duplicado no mesmo grupo (caixa diferente) → 409 TIPO_ATIVIDADE_NAME_CONFLICT', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'PASTO');
    assert.equal((await criarTipo(token, { nome_tipo: 'roçada', grupo_atividade_id: g.id })).statusCode, 201);

    const dup = await criarTipo(token, { nome_tipo: 'ROÇADA', grupo_atividade_id: g.id });
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'TIPO_ATIVIDADE_NAME_CONFLICT');
    assert.equal(await prisma().tipoAtividade.count(), 1, 'nada gravado');
  });

  test('mesmo nome em outro grupo → 201', async () => {
    const { token } = await tenantAutenticado();
    const g1 = await criarGrupo(token, 'PASTO');
    const g2 = await criarGrupo(token, 'CERCAS');
    assert.equal((await criarTipo(token, { nome_tipo: 'roçada', grupo_atividade_id: g1.id })).statusCode, 201);
    const r = await criarTipo(token, { nome_tipo: 'roçada', grupo_atividade_id: g2.id });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().grupo_atividade_nome, 'CERCAS');
  });

  test('cliente_id no corpo → 400 (additionalProperties)', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const r = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id, cliente_id: 'outro-tenant' });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(await prisma().tipoAtividade.count(), 0);
  });

  test('D-PROD-196: nomes aposentados pode_ter_produto/pode_ter_maquina/pode_ter_implemento → 400 no POST e no PATCH; exige_area passa a ser campo válido', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    for (const chave of CHAVES_APOSENTADAS) {
      for (const valor of [true, false]) {
        await recusaValidacao(clienteId, () => criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id, [chave]: valor }), `POST ${chave}=${valor}`);
      }
    }
    assert.equal(await prisma().tipoAtividade.count(), 0);

    const ok = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id, exige_area: true });
    assert.equal(ok.statusCode, 201, `exige_area aceito no POST: ${ok.body}`);
    assert.equal(ok.json().exige_area, true);
    for (const chave of CHAVES_APOSENTADAS) {
      for (const valor of [true, false]) {
        await recusaValidacao(clienteId, () => patchTipo(token, ok.json().id, { [chave]: valor }), `PATCH ${chave}=${valor}`);
      }
      await recusaValidacao(clienteId, () => patchTipo(token, ok.json().id, { exige_area: false, [chave]: true }), `PATCH exige_area + ${chave}`);
    }
    const off = await patchTipoOk(token, ok.json().id, { exige_area: false });
    assert.equal(off.exige_area, false, 'exige_area aceito no PATCH');
    assert.equal((await linhaDoTipo(off.id)).exige_area, false);
    for (const chave of CHAVES_APOSENTADAS) assert.equal(Object.prototype.hasOwnProperty.call(off, chave), false, `${chave} nunca sai na resposta`);
  });

  test('grupo inexistente → 404 GRUPO_ATIVIDADE_NOT_FOUND', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: 'grupo-que-nao-existe' });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'GRUPO_ATIVIDADE_NOT_FOUND');
  });
});

describe('D-PROD-182 — TipoAtividade: leitura, edição e exclusão', () => {
  test('GET /tipos-atividade/:id devolve o tipo; id desconhecido → 404 TIPO_ATIVIDADE_NOT_FOUND', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'vacinação', grupo_atividade_id: g.id })).json();

    const r = await req('GET', `/tipos-atividade/${t.id}`, token);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json(), t);

    const nada = await req('GET', '/tipos-atividade/id-inexistente', token);
    assert.equal(nada.statusCode, 404, nada.body);
    assert.equal(nada.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');
  });

  test('renomear o grupo atualiza o cache; mover o tipo de grupo via PATCH também', async () => {
    const { token } = await tenantAutenticado();
    const g1 = await criarGrupo(token, 'A');
    const g2 = await criarGrupo(token, 'OUTRO');
    const t = (await criarTipo(token, { nome_tipo: 'T1', grupo_atividade_id: g1.id })).json();

    const ren = await req('PATCH', `/grupos-atividade/${g1.id}`, token, { nome_grupo: 'b novo' });
    assert.equal(ren.statusCode, 200, ren.body);
    assert.equal((await req('GET', `/tipos-atividade/${t.id}`, token)).json().grupo_atividade_nome, 'B NOVO');

    const mover = await req('PATCH', `/tipos-atividade/${t.id}`, token, { grupo_atividade_id: g2.id });
    assert.equal(mover.statusCode, 200, mover.body);
    assert.equal(mover.json().grupo_atividade_id, g2.id);
    assert.equal(mover.json().grupo_atividade_nome, 'OUTRO');
    const linha = await prisma().tipoAtividade.findUnique({ where: { id: t.id } });
    assert.equal(linha.grupo_atividade_nome, 'OUTRO');
  });

  test('inativar via PATCH {ativo:false} e reativar', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id })).json();

    const off = await req('PATCH', `/tipos-atividade/${t.id}`, token, { ativo: false });
    assert.equal(off.statusCode, 200, off.body);
    assert.equal(off.json().ativo, false);
    const lista = (await req('GET', '/tipos-atividade', token)).json();
    assert.equal(lista.find((x) => x.id === t.id).ativo, false, 'inativo continua listado');

    const on = await req('PATCH', `/tipos-atividade/${t.id}`, token, { ativo: true });
    assert.equal(on.statusCode, 200, on.body);
    assert.equal(on.json().ativo, true);
  });

  test('DELETE → 204 (exclusão física) e depois 404', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id })).json();

    const del = await req('DELETE', `/tipos-atividade/${t.id}`, token);
    assert.equal(del.statusCode, 204, del.body);
    assert.equal(await prisma().tipoAtividade.count({ where: { id: t.id } }), 0, 'exclusão física');

    const de2 = await req('DELETE', `/tipos-atividade/${t.id}`, token);
    assert.equal(de2.statusCode, 404, de2.body);
    assert.equal(de2.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');
    assert.equal((await req('GET', `/tipos-atividade/${t.id}`, token)).statusCode, 404);

    const acoes = (await prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'TipoAtividade' } })).map((a) => a.acao).sort();
    assert.deepEqual(acoes, ['create', 'delete']);
  });

  test('grupo com tipo vinculado → 409 GRUPO_ATIVIDADE_DELETE_BLOCKED; e a FK no banco é Restrict', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const t = (await criarTipo(token, { nome_tipo: 'X', grupo_atividade_id: g.id })).json();

    const r = await req('DELETE', `/grupos-atividade/${g.id}`, token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'GRUPO_ATIVIDADE_DELETE_BLOCKED');
    assert.match(r.json().message, /tipos de atividade/);
    assert.equal(await prisma().grupoAtividade.count({ where: { id: g.id } }), 1);

    await assert.rejects(
      prisma().grupoAtividade.delete({ where: { cliente_id_id: { cliente_id: clienteId, id: g.id } } }),
      (e) => e?.code === 'P2003' || /foreign key/i.test(String(e?.message)),
      'FK Restrict barra o delete direto'
    );
    assert.equal(await prisma().tipoAtividade.count({ where: { id: t.id } }), 1);

    assert.equal((await req('DELETE', `/tipos-atividade/${t.id}`, token)).statusCode, 204);
    assert.equal((await req('DELETE', `/grupos-atividade/${g.id}`, token)).statusCode, 204, 'sem tipo, o grupo sai');
  });
});

describe('D-PROD-182 — TipoAtividade: isolamento por tenant', () => {
  test('tenant B não lista, não lê, não edita, não apaga o tipo de A (404) e não cria no grupo de A', async () => {
    const A = await tenantAutenticado();
    const B = await tenantAutenticado();
    const gA = await criarGrupo(A.token, 'GRUPO A');
    const tA = (await criarTipo(A.token, { nome_tipo: 'X', grupo_atividade_id: gA.id })).json();

    assert.deepEqual((await req('GET', '/tipos-atividade', B.token)).json(), []);

    const get = await req('GET', `/tipos-atividade/${tA.id}`, B.token);
    assert.equal(get.statusCode, 404, get.body);
    assert.equal(get.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');

    const patch = await req('PATCH', `/tipos-atividade/${tA.id}`, B.token, { nome_tipo: 'hack' });
    assert.equal(patch.statusCode, 404, patch.body);
    assert.equal(patch.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');

    const del = await req('DELETE', `/tipos-atividade/${tA.id}`, B.token);
    assert.equal(del.statusCode, 404, del.body);
    assert.equal(del.json().code, 'TIPO_ATIVIDADE_NOT_FOUND');

    const criar = await criarTipo(B.token, { nome_tipo: 'Y', grupo_atividade_id: gA.id });
    assert.equal(criar.statusCode, 404, criar.body);
    assert.equal(criar.json().code, 'GRUPO_ATIVIDADE_NOT_FOUND');

    const gB = await criarGrupo(B.token, 'GRUPO B');
    const tB = (await criarTipo(B.token, { nome_tipo: 'Z', grupo_atividade_id: gB.id })).json();
    const mover = await req('PATCH', `/tipos-atividade/${tB.id}`, B.token, { grupo_atividade_id: gA.id });
    assert.equal(mover.statusCode, 404, mover.body);
    assert.equal(mover.json().code, 'GRUPO_ATIVIDADE_NOT_FOUND');

    const intacto = await prisma().tipoAtividade.findUnique({ where: { id: tA.id } });
    assert.equal(intacto.nome_tipo, 'X');
    assert.equal(intacto.cliente_id, A.clienteId);
    assert.equal(await prisma().tipoAtividade.count({ where: { cliente_id: B.clienteId } }), 1);
  });
});

describe('D-PROD-182 — TipoAtividade: permissão de tela', () => {
  const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
  const linha = (tela, a) => ({ modulo_id: 'suporte-mapa', tela_id: tela, ...acoes(false), visualizar: true, ...a });

  const contaCom = async (permissoes_telas) => {
    const c = await criarTenant({ semPermissao: true });
    await prisma().permissao.create({
      data: { cliente_id: c.cliente.id, user_email: c.credenciais.login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas },
    });
    const { corpo } = await autenticarNoApp(app, c.credenciais);
    assert.ok(corpo.token, 'login');
    const grupo = await prisma().grupoAtividade.create({ data: { cliente_id: c.cliente.id, nome_grupo: 'G' } });
    return { token: corpo.token, clienteId: c.cliente.id, grupo };
  };

  test('usuário comum sem a tela sup-tipos-atividade (só sup-tipos-tarefa) → 403 no POST, nada gravado', async () => {
    const c = await contaCom([linha('sup-tipos-tarefa', { novo: true, salvar: true, editar: true, excluir: true })]);
    const r = await criarTipo(c.token, { nome_tipo: 'X', grupo_atividade_id: c.grupo.id });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
    assert.equal(await prisma().tipoAtividade.count({ where: { cliente_id: c.clienteId } }), 0);
    assert.equal((await req('GET', '/tipos-atividade', c.token)).statusCode, 200, 'leitura só exige autenticação');
  });

  test('controle positivo: "novo" em sup-tipos-atividade cria (201)', async () => {
    const c = await contaCom([linha('sup-tipos-atividade', { novo: true })]);
    const r = await criarTipo(c.token, { nome_tipo: 'X', grupo_atividade_id: c.grupo.id });
    assert.equal(r.statusCode, 201, r.body);
  });
});

// ═══ D-PROD-196 — padrões e flags ════════════════════════════════════════════

describe('D-PROD-196 — TipoAtividade: defaults, flags e forma pública', () => {
  test('POST sem os campos novos: flags false, categoria/padrões/coeficiente null — na resposta, no detalhe, na lista, na linha e na auditoria', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Gradagem'));
    assert.deepEqual(Object.keys(t).sort(), CAMPOS_PUBLICOS);
    assert.deepEqual(camposD195(t), SEM_PADROES);
    assert.deepEqual(await detalheOk(s.token, t.id), t, 'detalhe');
    assert.deepEqual((await req('GET', '/tipos-atividade', s.token)).json(), [t], 'lista');

    const linha = await linhaDoTipo(t.id);
    for (const f of FLAGS) assert.equal(linha[f], false, `linha: ${f}`);
    for (const c of ['categoria', 'centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id', 'coeficiente_padrao']) {
      assert.equal(linha[c], null, `linha: ${c}`);
    }

    const audit = await prisma().auditLog.findMany({ where: { cliente_id: s.clienteId, entidade: 'TipoAtividade', entidade_id: t.id } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].acao, 'create');
    assert.deepEqual(audit[0].dados_novos, t, 'a auditoria grava a forma pública');
  });

  test('POST com os padrões explicitamente null → 201 com tudo null (null é valor aceito)', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Roçada', {
      categoria: null, centro_custo_padrao_id: null, centro_resultado_padrao_id: null, unidade_producao_id: null, coeficiente_padrao: null,
    }));
    assert.deepEqual(camposD195(t), SEM_PADROES);
  });

  test('POST completo: categoria, centros e unidade da fazenda, coeficiente canônico e flags — os 3 objetos (§3.2) na criação, no detalhe, na lista e na auditoria', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Pulverização', {
      categoria: 'APLICACAO',
      centro_custo_padrao_id: s.cc1.id,
      centro_resultado_padrao_id: s.cr1.id,
      unidade_producao_id: s.ha.id,
      coeficiente_padrao: '1.5',
      exige_maquina: true,
      permite_implemento: true,
    }));
    assert.deepEqual(Object.keys(t).sort(), CAMPOS_PUBLICOS);
    assert.deepEqual(camposD195(t), {
      ...SEM_PADROES,
      categoria: 'APLICACAO',
      centro_custo_padrao_id: s.cc1.id,
      centro_custo_padrao: centroPublico(s.cc1),
      centro_resultado_padrao_id: s.cr1.id,
      centro_resultado_padrao: centroPublico(s.cr1),
      unidade_producao_id: s.ha.id,
      unidade_producao: { id: s.ha.id, sigla: 'HA', descricao: 'HECTARE', ativo: true },
      coeficiente_padrao: '1.5000',
      exige_maquina: true,
      permite_implemento: true,
    });
    assert.deepEqual(await detalheOk(s.token, t.id), t, 'detalhe com os objetos');

    const sem = await criarTipoOk(s.token, base(s, 'Capina'));
    const lista = (await req('GET', '/tipos-atividade', s.token)).json();
    assert.equal(lista.length, 2);
    assert.deepEqual(lista.find((x) => x.id === t.id), t, 'lista com os objetos');
    assert.deepEqual(lista.find((x) => x.id === sem.id), sem, 'na lista, o tipo sem padrão sai com os objetos null');
    for (const x of lista) assert.deepEqual(Object.keys(x).sort(), CAMPOS_PUBLICOS);

    const linha = await linhaDoTipo(t.id);
    assert.deepEqual(
      [linha.categoria, linha.centro_custo_padrao_id, linha.centro_resultado_padrao_id, linha.unidade_producao_id, linha.coeficiente_padrao.toFixed(4)],
      ['APLICACAO', s.cc1.id, s.cr1.id, s.ha.id, '1.5000']
    );
    assert.deepEqual(flagsDe(linha), { ...flagsDe(SEM_PADROES), exige_maquina: true, permite_implemento: true });

    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: s.clienteId, entidade: 'TipoAtividade', entidade_id: t.id, acao: 'create' } });
    assert.deepEqual(audit.dados_novos, t, 'auditoria com os objetos incluídos (forma pública)');
  });

  test('cada flag é gravada e lida isoladamente no POST; o PATCH liga e desliga (resposta, detalhe, linha e auditoria); PATCH sem flag não mexe nelas', async () => {
    const s = await montar();
    for (const f of FLAGS) {
      const t = await criarTipoOk(s.token, base(s, `Só ${f}`, { [f]: true }));
      const esperado = { ...flagsDe(SEM_PADROES), [f]: true };
      assert.deepEqual(flagsDe(t), esperado, `POST ${f}: resposta`);
      assert.deepEqual(flagsDe(await detalheOk(s.token, t.id)), esperado, `POST ${f}: detalhe`);
      assert.deepEqual(flagsDe(await linhaDoTipo(t.id)), esperado, `POST ${f}: linha`);
    }

    const todas = Object.fromEntries(FLAGS.map((f) => [f, true]));
    const t = await criarTipoOk(s.token, base(s, 'Todas', todas));
    assert.deepEqual(flagsDe(t), todas);
    let atual = todas;
    for (const f of FLAGS) {
      const antes = await detalheOk(s.token, t.id);
      const depois = await patchTipoOk(s.token, t.id, { [f]: false });
      atual = { ...atual, [f]: false };
      assert.deepEqual(flagsDe(depois), atual, `PATCH ${f}=false: resposta`);
      assert.deepEqual(flagsDe(await detalheOk(s.token, t.id)), atual, `PATCH ${f}=false: detalhe`);
      assert.deepEqual(flagsDe(await linhaDoTipo(t.id)), atual, `PATCH ${f}=false: linha`);
      const audit = await prisma().auditLog.findMany({ where: { cliente_id: s.clienteId, entidade_id: t.id, acao: 'update' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 });
      assert.deepEqual(audit[0].dados_anteriores, antes, `PATCH ${f}: auditoria do antes (forma pública)`);
      assert.deepEqual(audit[0].dados_novos, depois, `PATCH ${f}: auditoria do depois (forma pública)`);
    }
    assert.deepEqual(atual, flagsDe(SEM_PADROES), 'todas desligadas');

    const religa = await patchTipoOk(s.token, t.id, { exige_safra: true, permite_servico: true, exige_producao: true });
    const esperado = { ...flagsDe(SEM_PADROES), exige_safra: true, permite_servico: true, exige_producao: true };
    assert.deepEqual(flagsDe(religa), esperado);
    const outro = await patchTipoOk(s.token, t.id, { descricao: 'sem flag no corpo', categoria: 'PLANTIO' });
    assert.deepEqual(flagsDe(outro), esperado, 'PATCH sem flag mantém as flags');
    assert.deepEqual(flagsDe(await linhaDoTipo(t.id)), esperado);
  });

  test('flag com valor não booleano no corpo BRUTO (null, "true", "false", 1, 0) → 400 valor_deve_ser_booleano no POST e no PATCH, sem coerção; nada gravado', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base', { exige_area: true }));
    for (const f of FLAGS) {
      const esperado = [400, 'REQUEST_VALIDATION_FAILED', f, 'valor_deve_ser_booleano'];
      for (const v of [null, 'true', 'false', 1, 0]) {
        const rotulo = `${f}=${JSON.stringify(v)}`;
        await recusa(s.clienteId, () => criarTipo(s.token, base(s, `Novo ${f}`, { [f]: v })), esperado, `POST ${rotulo}`);
        await recusa(s.clienteId, () => patchTipo(s.token, t.id, { [f]: v }), esperado, `PATCH ${rotulo}`);
      }
    }
    assert.deepEqual(flagsDe(await linhaDoTipo(t.id)), { ...flagsDe(SEM_PADROES), exige_area: true }, 'flags intactas');
  });

  test('categoria: as 9 do contrato gravam no POST e no PATCH; null limpa; fora da lista (minúscula, com acento, espaço, vazia, número, booleano) → 400', async () => {
    const s = await montar();
    for (const [i, c] of CATEGORIAS.entries()) {
      const t = await criarTipoOk(s.token, base(s, `Tipo ${i}`, { categoria: c }));
      assert.equal(t.categoria, c, `POST ${c}`);
      assert.equal((await linhaDoTipo(t.id)).categoria, c);
    }
    const t = await criarTipoOk(s.token, base(s, 'Mutável'));
    for (const c of CATEGORIAS) {
      assert.equal((await patchTipoOk(s.token, t.id, { categoria: c })).categoria, c, `PATCH ${c}`);
      assert.equal((await detalheOk(s.token, t.id)).categoria, c);
    }
    assert.equal((await patchTipoOk(s.token, t.id, { categoria: null })).categoria, null, 'null limpa');
    assert.equal((await linhaDoTipo(t.id)).categoria, null);

    for (const v of ['INVALIDA', 'aplicacao', 'APLICAÇÃO', 'PREPARO SOLO', ' PLANTIO', '', 1, true]) {
      await recusaValidacao(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { categoria: v })), `POST categoria=${JSON.stringify(v)}`);
      await recusaValidacao(s.clienteId, () => patchTipo(s.token, t.id, { categoria: v }), `PATCH categoria=${JSON.stringify(v)}`);
    }
  });

  test('coeficiente_padrao: string canônica com 4 casas (POST e PATCH); null limpa', async () => {
    const s = await montar();
    const casos = [
      ['1.5', '1.5000'], ['2', '2.0000'], ['0.0001', '0.0001'], ['12.3456', '12.3456'], ['0010.50', '10.5000'],
      ['1234567890', '1234567890.0000'], ['9999999999.9999', '9999999999.9999'],
    ];
    for (const [i, [entrada, saida]] of casos.entries()) {
      const t = await criarTipoOk(s.token, base(s, `Coef ${i}`, { coeficiente_padrao: entrada }));
      assert.equal(t.coeficiente_padrao, saida, `POST ${entrada}`);
      assert.equal((await detalheOk(s.token, t.id)).coeficiente_padrao, saida, `detalhe ${entrada}`);
      assert.equal((await linhaDoTipo(t.id)).coeficiente_padrao.toFixed(4), saida, `linha ${entrada}`);
    }
    const t = await criarTipoOk(s.token, base(s, 'Coef PATCH', { coeficiente_padrao: '3' }));
    for (const [entrada, saida] of casos) {
      assert.equal((await patchTipoOk(s.token, t.id, { coeficiente_padrao: entrada })).coeficiente_padrao, saida, `PATCH ${entrada}`);
    }
    assert.equal((await patchTipoOk(s.token, t.id, { coeficiente_padrao: null })).coeficiente_padrao, null, 'null limpa');
    assert.equal((await linhaDoTipo(t.id)).coeficiente_padrao, null);
  });

  test('coeficiente_padrao zero ("0", "0.0000", "0.0", "00") → 422 nao_positivo no POST e no PATCH; nada gravado', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base', { coeficiente_padrao: '2.5' }));
    for (const v of ['0', '0.0000', '0.0', '00']) {
      const esperado = [422, PADRAO_INVALIDO, 'coeficiente_padrao', 'nao_positivo'];
      await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { coeficiente_padrao: v })), esperado, `POST ${v}`);
      await recusa(s.clienteId, () => patchTipo(s.token, t.id, { coeficiente_padrao: v }), esperado, `PATCH ${v}`);
    }
    assert.equal((await linhaDoTipo(t.id)).coeficiente_padrao.toFixed(4), '2.5000', 'coeficiente intacto');
  });

  test('coeficiente_padrao fora do formato (negativo, vírgula, 11 dígitos, 5 casas, espaço, vazio, expoente) → 400; número JSON ou booleano → 400 valor_deve_ser_texto (POST e PATCH); nada gravado', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base', { coeficiente_padrao: '2.5' }));
    for (const v of ['-1', '1,5', '12345678901', '1.23456', ' 1.5', '1.5 ', '', '1.', '.5', 'abc', '1e3', '+1', '-0']) {
      const rotulo = `coeficiente_padrao=${JSON.stringify(v)}`;
      await recusaValidacao(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { coeficiente_padrao: v })), `POST ${rotulo}`);
      await recusaValidacao(s.clienteId, () => patchTipo(s.token, t.id, { coeficiente_padrao: v }), `PATCH ${rotulo}`);
    }
    const naoTexto = [400, 'REQUEST_VALIDATION_FAILED', 'coeficiente_padrao', 'valor_deve_ser_texto'];
    for (const v of [1.5, 0, 2, -1, true]) {
      const rotulo = `coeficiente_padrao=${JSON.stringify(v)} (sem coerção para texto)`;
      await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { coeficiente_padrao: v })), naoTexto, `POST ${rotulo}`);
      await recusa(s.clienteId, () => patchTipo(s.token, t.id, { coeficiente_padrao: v }), naoTexto, `PATCH ${rotulo}`);
    }
    assert.equal((await linhaDoTipo(t.id)).coeficiente_padrao.toFixed(4), '2.5000', 'coeficiente intacto');
  });

  test('id de padrão fora do formato (vazio, espaço, barra, acento, 65 caracteres) → 400 no POST e no PATCH; nada gravado', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base'));
    for (const campo of ['centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id']) {
      for (const v of ['', 'a b', 'a/b', 'ção', 'x'.repeat(65)]) {
        const rotulo = `${campo}=${JSON.stringify(v).slice(0, 20)}`;
        await recusaValidacao(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { [campo]: v })), `POST ${rotulo}`);
        await recusaValidacao(s.clienteId, () => patchTipo(s.token, t.id, { [campo]: v }), `PATCH ${rotulo}`);
      }
    }
  });

  test('DELETE de tipo com padrões → 204 (exclusão física segue; auditoria com a forma pública); centros e unidade ficam', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Com padrões', {
      categoria: 'PREPARO_SOLO', centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id, unidade_producao_id: s.ha.id,
      coeficiente_padrao: '1.2', exige_area: true,
    }));
    const del = await req('DELETE', `/tipos-atividade/${t.id}`, s.token);
    assert.equal(del.statusCode, 204, del.body);
    assert.equal(await prisma().tipoAtividade.count({ where: { id: t.id } }), 0);
    assert.equal(await prisma().centroCusto.count({ where: { id: s.cc1.id } }), 1);
    assert.equal(await prisma().centroResultado.count({ where: { id: s.cr1.id } }), 1);
    assert.equal(await prisma().unidadeMedida.count({ where: { id: s.ha.id } }), 1);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: s.clienteId, entidade: 'TipoAtividade', entidade_id: t.id, acao: 'delete' } });
    assert.deepEqual(audit.dados_anteriores, t, 'auditoria da exclusão grava a forma pública (com os objetos)');
  });

  test('TipoTarefa continua sem flags (D-PROD-181/183): as flags novas que não são chave legada → 400 em /tipos-tarefa; exige_area segue aceita e ignorada; nenhuma flag sai', async () => {
    const { token } = await tenantAutenticado();
    const g = await criarGrupo(token, 'G');
    const novasNaoLegadas = FLAGS.filter((f) => f !== 'exige_area');
    for (const f of novasNaoLegadas) {
      const r = await req('POST', '/tipos-tarefa', token, { nome_tipo: `T ${f}`, grupo_atividade_id: g.id, [f]: true });
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `POST /tipos-tarefa ${f}: ${r.body}`);
    }
    assert.equal(await prisma().tipoTarefa.count(), 0, 'nada gravado');
    const tt = await req('POST', '/tipos-tarefa', token, { nome_tipo: 'Roçar', grupo_atividade_id: g.id, exige_area: true });
    assert.equal(tt.statusCode, 201, `exige_area segue chave legada ignorada (D-PROD-181): ${tt.body}`);
    for (const f of [...FLAGS, ...CHAVES_APOSENTADAS]) assert.equal(Object.prototype.hasOwnProperty.call(tt.json(), f), false, `${f} nunca sai do TipoTarefa`);
    for (const f of novasNaoLegadas) {
      const r = await req('PATCH', `/tipos-tarefa/${tt.json().id}`, token, { [f]: false });
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `PATCH /tipos-tarefa ${f}: ${r.body}`);
    }
  });
});

describe('D-PROD-196 — TipoAtividade: regras dos padrões (422 TIPO_ATIVIDADE_PADRAO_INVALIDO)', () => {
  const CAMPOS_ID = Object.freeze(['centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id']);
  /** O cadastro do cenário que cada campo aponta. */
  const alvo = (s, campo) => ({ centro_custo_padrao_id: s.cc1, centro_resultado_padrao_id: s.cr1, unidade_producao_id: s.ha })[campo];

  test('centro de custo, centro de resultado ou unidade de OUTRO cliente ou inexistente → 422 nao_encontrado, indistinguíveis (POST e PATCH); nada gravado', async () => {
    const s = await montar();
    const outro = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base'));
    const fotoOutro = await foto(outro.clienteId);
    for (const campo of CAMPOS_ID) {
      const alheio = alvo(outro, campo).id;
      const inexistente = `nao-existe-${randomUUID().slice(0, 8)}`;
      const esperado = [422, PADRAO_INVALIDO, campo, 'nao_encontrado'];
      const rAlheio = await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { [campo]: alheio })), esperado, `POST ${campo} de outro cliente`);
      const rInexistente = await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { [campo]: inexistente })), esperado, `POST ${campo} inexistente`);
      assert.equal(corpoErroSem(rAlheio, alheio), corpoErroSem(rInexistente, inexistente), `${campo}: outro cliente é indistinguível de inexistente (sem oráculo)`);
      await recusa(s.clienteId, () => patchTipo(s.token, t.id, { [campo]: alheio }), esperado, `PATCH ${campo} de outro cliente`);
      await recusa(s.clienteId, () => patchTipo(s.token, t.id, { [campo]: inexistente }), esperado, `PATCH ${campo} inexistente`);
    }
    assert.equal(await foto(outro.clienteId), fotoOutro, 'o outro tenant não é tocado');
  });

  test('centro de custo, centro de resultado ou unidade INATIVO → 422 inativo (POST e PATCH); nada gravado', async () => {
    const s = await montar();
    const inativos = {
      centro_custo_padrao_id: await s.cc(s.e1, '13', 'CC INATIVO', false),
      centro_resultado_padrao_id: await s.cr(s.e1, '23', 'CR INATIVO', false),
      unidade_producao_id: await inativarUnidade(s.token, await criarUnidade(s.token, 'cab', 'Cabeça')),
    };
    const t = await criarTipoOk(s.token, base(s, 'Base', { centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id, unidade_producao_id: s.ha.id }));
    for (const [campo, inativo] of Object.entries(inativos)) {
      const esperado = [422, PADRAO_INVALIDO, campo, 'inativo'];
      await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Novo', { [campo]: inativo.id })), esperado, `POST ${campo} inativo`);
      await recusa(s.clienteId, () => patchTipo(s.token, t.id, { [campo]: inativo.id }), esperado, `PATCH ${campo} inativo`);
    }
    const linha = await linhaDoTipo(t.id);
    assert.deepEqual([linha.centro_custo_padrao_id, linha.centro_resultado_padrao_id, linha.unidade_producao_id], [s.cc1.id, s.cr1.id, s.ha.id], 'padrões intactos');
  });

  test('centros padrão de empresas diferentes → 422 empresas_diferentes em centro_resultado_padrao_id: no POST e no PATCH mudando só um deles; mesma empresa ou um só preenchido grava', async () => {
    const s = await montar();
    const esperado = [422, PADRAO_INVALIDO, 'centro_resultado_padrao_id', 'empresas_diferentes'];
    await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Cruzado', { centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr2.id })), esperado, 'POST custo F1 + resultado F2');
    await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'Cruzado', { centro_custo_padrao_id: s.cc2.id, centro_resultado_padrao_id: s.cr1.id })), esperado, 'POST custo F2 + resultado F1');

    const t = await criarTipoOk(s.token, base(s, 'Base', { centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id }));
    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_resultado_padrao_id: s.cr2.id }), esperado, 'PATCH só o resultado para F2');
    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_custo_padrao_id: s.cc2.id }), esperado, 'PATCH só o custo para F2');
    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_custo_padrao_id: s.cc2.id, descricao: 'x' }), esperado, 'PATCH custo para F2 com outro campo');

    const ambos = await patchTipoOk(s.token, t.id, { centro_custo_padrao_id: s.cc2.id, centro_resultado_padrao_id: s.cr2.id });
    assert.deepEqual([ambos.centro_custo_padrao.empresa_id, ambos.centro_resultado_padrao.empresa_id], [s.e2.id, s.e2.id], 'os dois para F2 juntos: grava');
    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_custo_padrao_id: s.cc1.id }), esperado, 'PATCH só o custo de volta para F1');

    const soCusto = await patchTipoOk(s.token, t.id, { centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: null });
    assert.deepEqual([soCusto.centro_custo_padrao_id, soCusto.centro_resultado_padrao_id, soCusto.centro_resultado_padrao], [s.cc1.id, null, null], 'um só preenchido: grava');
    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_resultado_padrao_id: s.cr2.id }), esperado, 'PATCH resultado F2 com custo F1 gravado');
    const soResultado = await patchTipoOk(s.token, t.id, { centro_custo_padrao_id: null, centro_resultado_padrao_id: s.cr2.id });
    assert.deepEqual([soResultado.centro_custo_padrao_id, soResultado.centro_resultado_padrao_id], [null, s.cr2.id]);
    const soResultadoNovo = await criarTipoOk(s.token, base(s, 'Só resultado', { centro_resultado_padrao_id: s.cr2.id }));
    assert.equal(soResultadoNovo.centro_resultado_padrao.empresa_id, s.e2.id);
  });

  test('corrida (revisão A5-1/A6-1): dois PATCH simultâneos, cada um mudando UM centro para fazendas diferentes, nunca gravam o par cruzado — um grava e o outro recebe 422 empresas_diferentes', async () => {
    const s = await montar();
    for (let i = 0; i < 6; i += 1) {
      const t = await criarTipoOk(s.token, base(s, `Corrida ${i}`));
      const [ra, rb] = await Promise.all([
        patchTipo(s.token, t.id, { centro_custo_padrao_id: s.cc1.id }),
        patchTipo(s.token, t.id, { centro_resultado_padrao_id: s.cr2.id }),
      ]);
      assert.deepEqual([ra.statusCode, rb.statusCode].sort(), [200, 422], `iteração ${i}: um grava, o outro é recusado (${ra.body} | ${rb.body})`);
      const recusado = ra.statusCode === 422 ? ra : rb;
      assert.deepEqual(erro(recusado), [422, PADRAO_INVALIDO, 'centro_resultado_padrao_id', 'empresas_diferentes'], `iteração ${i}`);
      const linha = await linhaDoTipo(t.id);
      assert.ok(!(linha.centro_custo_padrao_id && linha.centro_resultado_padrao_id), `iteração ${i}: o par de fazendas diferentes nunca fica gravado`);
    }
  });

  test('null limpa os padrões (centros, unidade, coeficiente e categoria): resposta, detalhe e linha nulos; flags intactas', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base', {
      categoria: 'COLHEITA', centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id, unidade_producao_id: s.ha.id,
      coeficiente_padrao: '0.75', exige_producao: true,
    }));
    const limpo = await patchTipoOk(s.token, t.id, {
      categoria: null, centro_custo_padrao_id: null, centro_resultado_padrao_id: null, unidade_producao_id: null, coeficiente_padrao: null,
    });
    assert.deepEqual(camposD195(limpo), { ...SEM_PADROES, exige_producao: true });
    assert.deepEqual(await detalheOk(s.token, t.id), limpo);
    const linha = await linhaDoTipo(t.id);
    for (const c of ['categoria', 'centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id', 'coeficiente_padrao']) assert.equal(linha[c], null, c);
    assert.equal(linha.exige_producao, true);
  });

  test('padrão que fica inativo DEPOIS de gravado continua no tipo: PATCH que não o toca (ou reenvia o mesmo id) grava; trocar o outro centro confere a empresa, não o inativo', async () => {
    const s = await montar();
    const t = await criarTipoOk(s.token, base(s, 'Base', { centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id, unidade_producao_id: s.ha.id }));
    // §4: inativar um centro (ou a unidade) usado como padrão é permitido, pelas rotas dos cadastros.
    for (const [url, corpo] of [
      [`/centros-custo/${s.cc1.id}`, { empresa_id: s.e1.id, ativo: false }],
      [`/centros-resultado/${s.cr1.id}`, { empresa_id: s.e1.id, ativo: false }],
      [`/unidades-medida/${s.ha.id}`, { ativo: false }],
    ]) {
      const r = await req('PATCH', url, s.token, corpo);
      assert.equal(r.statusCode, 200, `${url}: ${r.body}`);
    }
    const objetosInativos = {
      centro_custo_padrao: { ...centroPublico(s.cc1), ativo: false },
      centro_resultado_padrao: { ...centroPublico(s.cr1), ativo: false },
      unidade_producao: { ...unidadePublica(s.ha), ativo: false },
    };
    const detalhe = await detalheOk(s.token, t.id);
    for (const [k, v] of Object.entries(objetosInativos)) assert.deepEqual(detalhe[k], v, `detalhe: ${k} inativo continua no tipo`);

    const naoToca = await patchTipoOk(s.token, t.id, { nome_tipo: 'renomeado', exige_area: true, coeficiente_padrao: '3', categoria: 'PASTAGEM' });
    assert.deepEqual([naoToca.centro_custo_padrao_id, naoToca.centro_resultado_padrao_id, naoToca.unidade_producao_id], [s.cc1.id, s.cr1.id, s.ha.id]);
    for (const [k, v] of Object.entries(objetosInativos)) assert.deepEqual(naoToca[k], v, `PATCH que não toca: ${k}`);

    const mesmo = await patchTipoOk(s.token, t.id, { centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id, unidade_producao_id: s.ha.id });
    assert.deepEqual([mesmo.centro_custo_padrao_id, mesmo.centro_resultado_padrao_id, mesmo.unidade_producao_id], [s.cc1.id, s.cr1.id, s.ha.id], 'mesmo valor gravado: não confere');

    const cr1b = await s.cr(s.e1, '24', 'MILHO F1');
    const troca = await patchTipoOk(s.token, t.id, { centro_resultado_padrao_id: cr1b.id });
    assert.equal(troca.centro_custo_padrao_id, s.cc1.id, 'o custo inativo gravado não é revalidado quando só o resultado muda');
    assert.deepEqual(troca.centro_resultado_padrao, centroPublico(cr1b));

    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_resultado_padrao_id: s.cr2.id }),
      [422, PADRAO_INVALIDO, 'centro_resultado_padrao_id', 'empresas_diferentes'], 'a empresa do custo inativo ainda vale');
    await recusa(s.clienteId, () => patchTipo(s.token, t.id, { centro_resultado_padrao_id: s.cr1.id }),
      [422, PADRAO_INVALIDO, 'centro_resultado_padrao_id', 'inativo'], 'voltar para o inativo é mudança: confere');
    const linha = await linhaDoTipo(t.id);
    assert.deepEqual([linha.centro_custo_padrao_id, linha.centro_resultado_padrao_id, linha.unidade_producao_id], [s.cc1.id, cr1b.id, s.ha.id]);
  });

  test('corrida: o cadastro some entre a conferência e a escrita (P2003 da FK nova) → o mesmo 422 nao_encontrado do campo, no POST e no PATCH; nada gravado', async () => {
    const s = await montar();
    const p = prisma();
    const t = await criarTipoOk(s.token, base(s, 'Base'));
    // Gatilho temporário (só deste tenant): apaga o cadastro apontado ANTES da linha do tipo ser
    // escrita, na MESMA transação — o serviço já conferiu (existe, ativo); a FK nova recusa a escrita.
    const GATILHO = 'd195_cadastro_some';
    const casos = [
      ['centro_custo_padrao_id', 'CentroCusto', 'centroCusto', () => s.cc(s.e1, '15', 'CC QUE SOME')],
      ['centro_resultado_padrao_id', 'CentroResultado', 'centroResultado', () => s.cr(s.e1, '25', 'CR QUE SOME')],
      ['unidade_producao_id', 'UnidadeMedida', 'unidadeMedida', () => criarUnidade(s.token, 'km', 'Quilômetro')],
    ];
    try {
      for (const [campo, tabela, modelo, novoCadastro] of casos) {
        const alvoDoPadrao = await novoCadastro();
        await p.$executeRawUnsafe(
          `CREATE OR REPLACE FUNCTION ${GATILHO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN DELETE FROM "${tabela}" WHERE cliente_id = NEW.cliente_id AND id = NEW.${campo}; RETURN NEW; END $f$`
        );
        await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${GATILHO} ON "TipoAtividade"`);
        await p.$executeRawUnsafe(
          `CREATE TRIGGER ${GATILHO} BEFORE INSERT OR UPDATE OF ${campo} ON "TipoAtividade" FOR EACH ROW WHEN (NEW.cliente_id = '${s.clienteId}' AND NEW.${campo} IS NOT NULL) EXECUTE FUNCTION ${GATILHO}()`
        );
        const esperado = [422, PADRAO_INVALIDO, campo, 'nao_encontrado'];
        await recusa(s.clienteId, () => criarTipo(s.token, base(s, `Corrida ${campo}`, { [campo]: alvoDoPadrao.id })), esperado, `POST ${campo}: cadastro sumiu na corrida`);
        await recusa(s.clienteId, () => patchTipo(s.token, t.id, { [campo]: alvoDoPadrao.id }), esperado, `PATCH ${campo}: cadastro sumiu na corrida`);
        await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${GATILHO} ON "TipoAtividade"`);
        assert.equal(await p[modelo].count({ where: { id: alvoDoPadrao.id } }), 1, `${campo}: o rollback devolve o cadastro`);
        assert.equal((await patchTipoOk(s.token, t.id, { [campo]: alvoDoPadrao.id }))[campo], alvoDoPadrao.id, `${campo}: sem a corrida, o mesmo pedido grava`);
      }
    } finally {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${GATILHO} ON "TipoAtividade"`);
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${GATILHO}()`);
    }
  });
});

describe('D-PROD-196 — TipoAtividade: unicidade e isolamento por tenant', () => {
  test('unicidade (cliente, grupo, nome) mantida com os campos novos: POST e PATCH → 409 TIPO_ATIVIDADE_NAME_CONFLICT; nada gravado', async () => {
    const s = await montar();
    const completo = {
      categoria: 'COLHEITA', centro_custo_padrao_id: s.cc1.id, centro_resultado_padrao_id: s.cr1.id, unidade_producao_id: s.ha.id,
      coeficiente_padrao: '2', exige_maquina: true,
    };
    await criarTipoOk(s.token, base(s, 'Colheita de soja', completo));
    const conflito = [409, 'TIPO_ATIVIDADE_NAME_CONFLICT', null, null];
    await recusa(s.clienteId, () => criarTipo(s.token, base(s, 'COLHEITA DE SOJA', { ...completo, categoria: 'OUTROS', exige_area: true })), conflito, 'POST nome repetido');
    const outro = await criarTipoOk(s.token, base(s, 'Colheita de milho'));
    await recusa(s.clienteId, () => patchTipo(s.token, outro.id, { nome_tipo: 'colheita de soja', exige_area: true, coeficiente_padrao: '1' }), conflito, 'PATCH renomeando para nome existente');
    const g2 = await criarGrupo(s.token, 'Outro grupo');
    assert.equal((await criarTipoOk(s.token, { nome_tipo: 'Colheita de soja', grupo_atividade_id: g2.id, ...completo })).grupo_atividade_id, g2.id, 'mesmo nome em outro grupo segue valendo');
  });

  test('tenant B não lê nem edita o tipo de A com padrões (404), não usa centro nem unidade de A (422 nao_encontrado); os padrões de A ficam intactos', async () => {
    const A = await montar();
    const B = await montar();
    const tA = await criarTipoOk(A.token, base(A, 'Plantio', {
      categoria: 'PLANTIO', centro_custo_padrao_id: A.cc1.id, centro_resultado_padrao_id: A.cr1.id, unidade_producao_id: A.ha.id,
    }));
    const fotoA = await foto(A.clienteId);

    assert.deepEqual((await req('GET', '/tipos-atividade', B.token)).json(), [], 'B não lista o tipo de A');
    const get = await req('GET', `/tipos-atividade/${tA.id}`, B.token);
    assert.deepEqual([get.statusCode, get.json().code], [404, 'TIPO_ATIVIDADE_NOT_FOUND']);
    for (const corpo of [
      { centro_custo_padrao_id: null },
      { centro_custo_padrao_id: B.cc1.id, centro_resultado_padrao_id: B.cr1.id, unidade_producao_id: B.ha.id },
      { exige_maquina: true },
    ]) {
      const r = await patchTipo(B.token, tA.id, corpo);
      assert.deepEqual([r.statusCode, r.json().code], [404, 'TIPO_ATIVIDADE_NOT_FOUND'], `${JSON.stringify(corpo)}: ${r.body}`);
    }

    const tB = await criarTipoOk(B.token, base(B, 'Plantio B'));
    for (const [campo, id] of [['centro_custo_padrao_id', A.cc1.id], ['centro_resultado_padrao_id', A.cr1.id], ['unidade_producao_id', A.ha.id]]) {
      const esperado = [422, PADRAO_INVALIDO, campo, 'nao_encontrado'];
      await recusa(B.clienteId, () => criarTipo(B.token, base(B, 'Novo B', { [campo]: id })), esperado, `B cria com ${campo} de A`);
      await recusa(B.clienteId, () => patchTipo(B.token, tB.id, { [campo]: id }), esperado, `B edita com ${campo} de A`);
    }
    assert.equal(await foto(A.clienteId), fotoA, 'tipo e auditoria de A intactos');
    assert.deepEqual(await detalheOk(A.token, tA.id), tA);
  });
});

describe('D-PROD-196 — TipoAtividade: opções de centros do formulário (GET /tipos-atividade/opcoes/...)', () => {
  const LADOS = Object.freeze(['centros-custo', 'centros-resultado']);
  const opcoes = (token, lado, query) => req('GET', `/tipos-atividade/opcoes/${lado}${query === undefined ? '' : `?${query}`}`, token);
  const opcoesOk = async (token, lado, empresaId) => {
    const r = await opcoes(token, lado, `empresa_id=${encodeURIComponent(empresaId)}`);
    assert.equal(r.statusCode, 200, `${lado}: ${r.body}`);
    const corpo = r.json();
    assert.deepEqual(Object.keys(corpo), ['itens'], `${lado}: envelope { itens }`);
    for (const item of corpo.itens) assert.deepEqual(Object.keys(item).sort(), ['id', 'nome', 'numero'], `${lado}: item { id, numero, nome }`);
    return corpo.itens;
  };
  const opcao = (c) => ({ id: c.id, numero: c.numero, nome: c.nome });

  test('só os centros ATIVOS da empresa pedida, ordenados por número, como { itens: [{ id, numero, nome }] } (custo e resultado)', async () => {
    const s = await montar();
    // Criados fora da ordem do número; inativos e de outra fazenda ficam fora.
    const c17 = await s.cc(s.e1, '17', 'SETE');
    const c13 = await s.cc(s.e1, '13', 'TRES');
    await s.cc(s.e1, '14', 'CC INATIVO', false);
    const c19 = await s.cc(s.e1, '19', 'NOVE');
    const r26 = await s.cr(s.e1, '26', 'SEIS');
    await s.cr(s.e1, '25', 'CR INATIVO', false);
    const r23 = await s.cr(s.e1, '23', 'TRES');

    assert.deepEqual(await opcoesOk(s.token, 'centros-custo', s.e1.id), [s.cc1, c13, c17, c19].map(opcao), 'custo da F1');
    assert.deepEqual(await opcoesOk(s.token, 'centros-resultado', s.e1.id), [s.cr1, r23, r26].map(opcao), 'resultado da F1');
    assert.deepEqual(await opcoesOk(s.token, 'centros-custo', s.e2.id), [opcao(s.cc2)], 'custo da F2');
    assert.deepEqual(await opcoesOk(s.token, 'centros-resultado', s.e2.id), [opcao(s.cr2)], 'resultado da F2');

    const e3 = await s.empresa(3);
    for (const lado of LADOS) assert.deepEqual(await opcoesOk(s.token, lado, e3.id), [], `${lado}: fazenda sem centro → lista vazia`);

    // Inativar tira da lista; reativar devolve.
    await prisma().centroCusto.update({ where: { id: c13.id }, data: { ativo: false } });
    assert.deepEqual((await opcoesOk(s.token, 'centros-custo', s.e1.id)).map((c) => c.id), [s.cc1.id, c17.id, c19.id]);
    await prisma().centroCusto.update({ where: { id: c13.id }, data: { ativo: true } });
    assert.deepEqual((await opcoesOk(s.token, 'centros-custo', s.e1.id)).map((c) => c.id), [s.cc1.id, c13.id, c17.id, c19.id]);
  });

  test('número da sequência em ordem numérica ("2" antes de "10"), como a gestão numera os centros', async () => {
    const s = await montar();
    const e3 = await s.empresa(3);
    // Fora de ordem na criação; em ordem de texto sairiam '1', '10', '100', '2' e '30', '300', '4'.
    for (const n of ['100', '2', '10', '1']) await s.cc(e3, n, `CENTRO ${n}`);
    for (const n of ['30', '4', '300']) await s.cr(e3, n, `RESULTADO ${n}`);
    assert.deepEqual((await opcoesOk(s.token, 'centros-custo', e3.id)).map((c) => c.numero), ['1', '2', '10', '100']);
    assert.deepEqual((await opcoesOk(s.token, 'centros-resultado', e3.id)).map((c) => c.numero), ['4', '30', '300']);
    // Número que não é só dígitos (cadastro antigo ou importado) vai para o fim, em ordem de texto.
    for (const n of ['B7', '5', 'A9']) await s.cc(e3, n, `MISTO ${n}`);
    assert.deepEqual((await opcoesOk(s.token, 'centros-custo', e3.id)).map((c) => c.numero), ['1', '2', '5', '10', '100', 'A9', 'B7']);

    // O teto corta na MESMA ordem: com 1001 ativos numerados 1..1001 (sem zeros à esquerda), saem 1..1000
    // — em ordem de texto o corte deixaria '999' de fora e manteria '1001'.
    const e4 = await s.empresa(4);
    const linhas = Array.from({ length: 1001 }, (_, k) => 1001 - k).map((n) => ({
      cliente_id: s.clienteId, empresa_id: e4.id, numero: `${n}`, nome: `CENTRO ${n}`,
    }));
    // numero é único por CLIENTE: os centros já criados (nenhum é padrão de tipo aqui) saem antes.
    await prisma().centroCusto.deleteMany({ where: { cliente_id: s.clienteId } });
    await prisma().centroResultado.deleteMany({ where: { cliente_id: s.clienteId } });
    await prisma().centroCusto.createMany({ data: linhas });
    await prisma().centroResultado.createMany({ data: linhas });
    for (const lado of LADOS) {
      const numeros = (await opcoesOk(s.token, lado, e4.id)).map((c) => c.numero);
      assert.deepEqual(numeros, Array.from({ length: 1000 }, (_, k) => `${k + 1}`), `${lado}: os 1000 primeiros pelo valor do número`);
    }
  });

  test('no máximo 1000 itens (o teto de ativos por empresa da gestão): os primeiros pelo número', async () => {
    const s = await montar();
    const e3 = await s.empresa(3);
    // Inseridos do maior para o menor número: a ordem por número não coincide com a de criação.
    const linhas = Array.from({ length: 1001 }, (_, k) => 1001 - k).map((n) => ({
      cliente_id: s.clienteId, empresa_id: e3.id, numero: String(n).padStart(4, '0'), nome: `CENTRO ${n}`,
    }));
    await prisma().centroCusto.createMany({ data: linhas });
    await prisma().centroResultado.createMany({ data: linhas });
    for (const lado of LADOS) {
      const itens = await opcoesOk(s.token, lado, e3.id);
      assert.equal(itens.length, 1000, `${lado}: teto de 1000`);
      assert.deepEqual([itens[0].numero, itens[999].numero], ['0001', '1000'], `${lado}: os 1000 primeiros pelo número`);
      assert.ok(itens.every((c, i) => i === 0 || itens[i - 1].numero < c.numero), `${lado}: ordenados por número`);
    }
  });

  test('empresa de outro cliente ou inexistente → 404 EMPRESA_NOT_FOUND; sem empresa_id → 400; sem token → 401', async () => {
    const s = await montar();
    const outro = await montar();
    for (const lado of LADOS) {
      for (const [rotulo, empresaId] of [['empresa de outro cliente', outro.e1.id], ['empresa inexistente', 'empresa-que-nao-existe']]) {
        const r = await opcoes(s.token, lado, `empresa_id=${empresaId}`);
        assert.deepEqual([r.statusCode, r.json().code], [404, 'EMPRESA_NOT_FOUND'], `${lado} / ${rotulo}: ${r.body}`);
        assert.ok(!r.body.includes(outro.cc1.id) && !r.body.includes(outro.cr1.id), `${lado} / ${rotulo}: nenhum centro alheio sai`);
      }
      const sem = await opcoes(s.token, lado);
      assert.deepEqual([sem.statusCode, sem.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${lado} sem empresa_id: ${sem.body}`);
      const semToken = await opcoes(null, lado, `empresa_id=${s.e1.id}`);
      assert.equal(semToken.statusCode, 401, `${lado} sem token`);
    }
  });

  test('guarda: quem pode criar OU editar tipo de atividade (novo, salvar ou editar; administrador; is_admin) vê as opções; visualizar/excluir, só as telas de centros, módulo não liberado, linha sem visualizar ou sem linha → 403', async () => {
    const s = await montar();
    const liberados = {
      'novo em sup-tipos-atividade': await contaNoTenant(s, permTipos({ novo: true })),
      'salvar em sup-tipos-atividade': await contaNoTenant(s, permTipos({ salvar: true })),
      'editar em sup-tipos-atividade': await contaNoTenant(s, permTipos({ editar: true })),
      'administrador da fazenda (sem linha)': await contaNoTenant(s, null, { papel_tenant: 'administrador' }),
      'concessão is_admin': s.token,
    };
    const negados = {
      'sem linha de permissão': await contaNoTenant(s, null),
      'só visualizar': await contaNoTenant(s, permTipos({})),
      'visualizar + excluir': await contaNoTenant(s, permTipos({ excluir: true })),
      'visualizar + importar + exportar': await contaNoTenant(s, permTipos({ importar: true, exportar: true })),
      'só as telas de centros (todas as ações)': await contaNoTenant(s, {
        modulos_permitidos: ['gestao-rural'],
        permissoes_telas: [linhaTela('gestao-rural', 'ges-centros-custo', TODAS_ACOES), linhaTela('gestao-rural', 'ges-centros-resultado', TODAS_ACOES)],
      }),
      'só sup-tipos-tarefa (todas as ações)': await contaNoTenant(s, {
        modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linhaTela('suporte-mapa', 'sup-tipos-tarefa', TODAS_ACOES)],
      }),
      'módulo não liberado': await contaNoTenant(s, { modulos_permitidos: ['mapa'], permissoes_telas: [linhaTela('suporte-mapa', 'sup-tipos-atividade', TODAS_ACOES)] }),
      'linha sem visualizar': await contaNoTenant(s, {
        modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linhaTela('suporte-mapa', 'sup-tipos-atividade', { novo: true, salvar: true, editar: true, excluir: true })],
      }),
    };
    for (const lado of LADOS) {
      const esperado = (lado === 'centros-custo' ? [s.cc1] : [s.cr1]).map(opcao);
      for (const [nome, token] of Object.entries(liberados)) {
        assert.deepEqual(await opcoesOk(token, lado, s.e1.id), esperado, `${nome} / ${lado}`);
      }
      for (const [nome, token] of Object.entries(negados)) {
        const r = await opcoes(token, lado, `empresa_id=${s.e1.id}`);
        assert.deepEqual([r.statusCode, r.json().code], [403, 'ACAO_NAO_PERMITIDA'], `${nome} / ${lado}: ${r.body}`);
      }
    }
    // §3.4: as unidades do formulário vêm de GET /unidades-medida, que só exige autenticação.
    for (const [nome, token] of [['novo em sup-tipos-atividade', liberados['novo em sup-tipos-atividade']], ['sem linha de permissão', negados['sem linha de permissão']]]) {
      const r = await req('GET', '/unidades-medida', token);
      assert.equal(r.statusCode, 200, `${nome} / unidades: ${r.body}`);
      assert.deepEqual(r.json().map((u) => u.id), [s.ha.id]);
    }
  });
});
