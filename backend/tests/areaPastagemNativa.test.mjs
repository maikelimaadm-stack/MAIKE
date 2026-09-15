/**
 * AreaPastagem nativa, contra PostgreSQL real (P4.2, D-PROD-30).
 *
 * O que este arquivo existe para provar — e que nenhum gate estático consegue:
 *
 *  - a FK composta **rejeita de fato** área vinculada a setor de outro tenant.
 *    O gate prova que a declaração está no schema; só o banco prova que a
 *    constraint existe e barra;
 *  - `setor_nome` é derivado, não recebido: enviar o campo é 400, e o valor
 *    gravado é o nome real do setor mesmo quando o cliente tenta outro;
 *  - renomear um setor reescreve o `setor_nome` das áreas dele, na mesma
 *    transação, e **não** toca nas áreas de outro tenant;
 *  - `numero_area` vem da sequência atômica e não repete sob concorrência real.
 *    Em série, qualquer contador acerta; o defeito só aparece em paralelo;
 *  - o tenant vem do token: área do cliente B não é lida, não é atualizada e
 *    não é distinguível de um id inexistente para o cliente A;
 *  - não existe rota de exclusão. Não como rota que reprova: como rota ausente.
 *
 * Nada aqui usa mock de Prisma. Constraint, atomicidade e isolamento entre
 * tenants só existem de verdade no banco.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { escopoDaNumeracao, ENTIDADE_SEQUENCIA } from '../src/modules/areas/areaPastagemService.js';
import { ESCOPO_TENANT } from '../src/modules/sequencias/entidadeCodigoService.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;

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

const EMPRESA = 'empresa-legada-1';

const tenantAutenticado = async (opcoes) => {
  const { cliente, usuario, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, usuario, token: corpo.token };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

/** Cria um setor e devolve o registro público. */
const criarSetor = async (token, nome = 'FAZENDA SANTA CLARA') => {
  const r = await app.inject({
    method: 'POST',
    url: '/setores',
    headers: auth(token),
    payload: { empresa_id: EMPRESA, nome, tipo: 'Próprio' },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const corpoDeArea = (setorId, extras = {}) => ({
  empresa_id: EMPRESA,
  setor_id: setorId,
  nome: 'PIQUETE 1',
  tamanho_hectares: 12.5,
  ...extras,
});

const criarArea = (token, setorId, extras) =>
  app.inject({
    method: 'POST',
    url: '/areas-pastagem',
    headers: auth(token),
    payload: corpoDeArea(setorId, extras),
  });

// ---------------------------------------------------------------------------

describe('P4.2 — sessão obrigatória', () => {
  test('BE-P42-01 GET /areas-pastagem sem token reprova com TENANT_CONTEXT_REQUIRED', async () => {
    const r = await app.inject({ method: 'GET', url: '/areas-pastagem' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P42-02 POST /areas-pastagem sem token reprova', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/areas-pastagem',
      payload: corpoDeArea('qualquer'),
    });
    assert.equal(r.statusCode, 401);
  });

  test('BE-P42-03 PATCH /areas-pastagem/:id sem token reprova', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/areas-pastagem/qualquer',
      payload: { nome: 'X' },
    });
    assert.equal(r.statusCode, 401);
  });
});

describe('P4.2 — criação e contrato de entrada', () => {
  test('BE-P42-04 cria com 201 e devolve os campos do contrato', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);

    const r = await criarArea(token, setor.id);
    assert.equal(r.statusCode, 201, r.body);

    const area = r.json();
    assert.ok(area.id);
    assert.equal(area.setor_id, setor.id);
    assert.equal(area.numero_area, '1');
    assert.equal(area.tamanho_hectares, 12.5);
    assert.equal(area.ativo, true);
    // `cliente_id` é contexto de sessão, não dado do registro.
    assert.equal('cliente_id' in area, false);
  });

  test('BE-P42-05 defaults do schema chegam ao registro', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);
    const area = (await criarArea(token, setor.id)).json();

    assert.equal(area.aproveitamento_classificacao, 'Média');
    assert.equal(area.tipo_cultura, 'Pastagem');
    assert.equal(area.status_ocupacao, 'Disponível');
    assert.equal(area.quantidade_atual, 0);
  });

  test('BE-P42-06 campo atribuído pelo servidor é RECUSADO, não ignorado', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);

    for (const proibido of [
      { id: 'forjado' },
      { cliente_id: 'outro' },
      { numero_area: '999' },
      { setor_nome: 'NOME QUE O CLIENTE INVENTOU' },
      { created_date: '2020-01-01' },
      { _isOffline: true },
    ]) {
      const r = await criarArea(token, setor.id, proibido);
      assert.equal(
        r.statusCode,
        400,
        `${Object.keys(proibido)[0]} deveria ser recusado, veio ${r.statusCode}`
      );
    }
  });

  test('BE-P42-07 obrigatório em branco é 400, não 500', async () => {
    // A classe de defeito da P4.1-R1: `minLength: 1` aceita `" "`, que o
    // serviço normaliza para null e o Prisma recusa numa coluna NOT NULL.
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);

    for (const branco of [{ nome: '   ' }, { empresa_id: ' ' }, { setor_id: '  ' }]) {
      const r = await criarArea(token, setor.id, branco);
      assert.equal(r.statusCode, 400, `${Object.keys(branco)[0]}: veio ${r.statusCode}`);
    }
  });

  test('BE-P42-08 enum fora do catálogo é 400', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);

    const r = await criarArea(token, setor.id, { tipo_cultura: 'Mineração' });
    assert.equal(r.statusCode, 400);
  });
});

describe('P4.2 — o vínculo com Setor', () => {
  test('BE-P42-09 setor inexistente é SETOR_NOT_FOUND, não 500', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarArea(token, 'setor-que-nao-existe');
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'SETOR_NOT_FOUND');
  });

  test('BE-P42-10 setor de OUTRO tenant é indistinguível de inexistente', async () => {
    // Se a resposta fosse 403, ela confirmaria que o id existe em outro
    // cliente — informação sobre dado que quem perguntou não pode ver.
    const a = await tenantAutenticado({ codigo: 'CLI-A', login: 'a@x' });
    const b = await tenantAutenticado({ codigo: 'CLI-B', login: 'b@x' });
    const setorDoB = await criarSetor(b.token);

    const r = await criarArea(a.token, setorDoB.id);
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'SETOR_NOT_FOUND');
  });

  test('BE-P42-11 a FK composta BARRA no banco, não só no service', async () => {
    // A prova que só o PostgreSQL dá: escrita direta pelo Prisma, sem passar
    // pelo service, tentando vincular área do cliente A ao setor do cliente B.
    const a = await tenantAutenticado({ codigo: 'CLI-A2', login: 'a2@x' });
    const b = await tenantAutenticado({ codigo: 'CLI-B2', login: 'b2@x' });
    const setorDoB = await criarSetor(b.token);

    const prisma = getPrismaClient();
    await assert.rejects(
      () =>
        prisma.areaPastagem.create({
          data: {
            cliente_id: a.cliente.id,
            empresa_id: EMPRESA,
            setor_id: setorDoB.id,
            setor_nome: 'QUALQUER',
            numero_area: '77',
            nome: 'ÁREA CRUZADA',
            tamanho_hectares: 1,
          },
        }),
      'a constraint composta precisa recusar vínculo cross-tenant'
    );
  });

  test('BE-P42-12 apagar setor com área é barrado por Restrict', async () => {
    const { token, cliente } = await tenantAutenticado();
    const setor = await criarSetor(token);
    assert.equal((await criarArea(token, setor.id)).statusCode, 201);

    const prisma = getPrismaClient();
    await assert.rejects(
      () =>
        prisma.setor.delete({
          where: { cliente_id_id: { cliente_id: cliente.id, id: setor.id } },
        }),
      'onDelete: Restrict precisa impedir a exclusão'
    );
  });
});

describe('P4.2 — setor_nome é derivado', () => {
  test('BE-P42-13 o nome gravado é o do setor, não o que o cliente mandaria', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token, 'SETOR VERDADEIRO');

    const area = (await criarArea(token, setor.id)).json();
    assert.equal(area.setor_nome, 'SETOR VERDADEIRO');
  });

  test('BE-P42-14 renomear o setor reescreve o setor_nome das áreas', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token, 'NOME ANTIGO');
    const area1 = (await criarArea(token, setor.id)).json();
    const area2 = (await criarArea(token, setor.id, { nome: 'PIQUETE 2' })).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/setores/${setor.id}`,
      headers: auth(token),
      payload: { nome: 'NOME NOVO' },
    });
    assert.equal(r.statusCode, 200, r.body);

    const lista = (
      await app.inject({ method: 'GET', url: '/areas-pastagem', headers: auth(token) })
    ).json();

    const porId = Object.fromEntries(lista.map((a) => [a.id, a]));
    assert.equal(porId[area1.id].setor_nome, 'NOME NOVO');
    assert.equal(porId[area2.id].setor_nome, 'NOME NOVO');
  });

  test('BE-P42-15 a propagação NÃO atravessa tenant', async () => {
    const a = await tenantAutenticado({ codigo: 'CLI-A3', login: 'a3@x' });
    const b = await tenantAutenticado({ codigo: 'CLI-B3', login: 'b3@x' });

    const setorA = await criarSetor(a.token, 'MESMO NOME');
    const setorB = await criarSetor(b.token, 'MESMO NOME');
    await criarArea(a.token, setorA.id);
    const areaB = (await criarArea(b.token, setorB.id)).json();

    await app.inject({
      method: 'PATCH',
      url: `/setores/${setorA.id}`,
      headers: auth(a.token),
      payload: { nome: 'SÓ O A MUDOU' },
    });

    const listaB = (
      await app.inject({ method: 'GET', url: '/areas-pastagem', headers: auth(b.token) })
    ).json();
    assert.equal(listaB.length, 1);
    assert.equal(listaB[0].id, areaB.id);
    assert.equal(listaB[0].setor_nome, 'MESMO NOME');
  });

  test('BE-P42-16 mover a área de setor rederiva o nome', async () => {
    const { token } = await tenantAutenticado();
    const origem = await criarSetor(token, 'SETOR ORIGEM');
    const destino = await criarSetor(token, 'SETOR DESTINO');
    const area = (await criarArea(token, origem.id)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/areas-pastagem/${area.id}`,
      headers: auth(token),
      payload: { setor_id: destino.id },
    });

    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().setor_id, destino.id);
    assert.equal(r.json().setor_nome, 'SETOR DESTINO');
  });
});

describe('P4.2 — numeração atômica', () => {
  test('BE-P42-17 o escopo declarado é tenant', () => {
    assert.equal(escopoDaNumeracao(), ESCOPO_TENANT);
    assert.equal(ENTIDADE_SEQUENCIA, 'AreaPastagem');
  });

  test('BE-P42-18 doze criações CONCORRENTES produzem doze números distintos', async () => {
    // Em série, qualquer contador acerta. O `MAX + 1` que a P4.1 removeu só
    // falha quando duas criações leem a mesma lista ao mesmo tempo.
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);

    const respostas = await Promise.all(
      Array.from({ length: 12 }, (_, i) => criarArea(token, setor.id, { nome: `PIQUETE ${i}` }))
    );

    for (const r of respostas) assert.equal(r.statusCode, 201, r.body);

    const numeros = respostas.map((r) => r.json().numero_area);
    assert.equal(new Set(numeros).size, 12, `números repetidos: ${numeros.join(', ')}`);
  });

  test('BE-P42-19 a sequência de área é separada da de setor', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);
    const area = (await criarArea(token, setor.id)).json();

    // Setor e área são a primeira de cada sequência: ambas em 1, sem interferir.
    assert.equal(setor.numero_setor, '1');
    assert.equal(area.numero_area, '1');
  });
});

describe('P4.2 — isolamento de tenant', () => {
  test('BE-P42-20 a lista só traz o que é do tenant do token', async () => {
    const a = await tenantAutenticado({ codigo: 'CLI-A4', login: 'a4@x' });
    const b = await tenantAutenticado({ codigo: 'CLI-B4', login: 'b4@x' });

    const setorA = await criarSetor(a.token);
    const setorB = await criarSetor(b.token);
    await criarArea(a.token, setorA.id);
    await criarArea(b.token, setorB.id, { nome: 'ÁREA DO B' });

    const listaA = (
      await app.inject({ method: 'GET', url: '/areas-pastagem', headers: auth(a.token) })
    ).json();

    assert.equal(listaA.length, 1);
    assert.equal(listaA[0].nome, 'PIQUETE 1');
  });

  test('BE-P42-21 PATCH em área de outro tenant é AREA_NOT_FOUND', async () => {
    const a = await tenantAutenticado({ codigo: 'CLI-A5', login: 'a5@x' });
    const b = await tenantAutenticado({ codigo: 'CLI-B5', login: 'b5@x' });

    const setorB = await criarSetor(b.token);
    const areaB = (await criarArea(b.token, setorB.id)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/areas-pastagem/${areaB.id}`,
      headers: auth(a.token),
      payload: { nome: 'INVADIDA' },
    });

    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'AREA_NOT_FOUND');
  });

  test('BE-P42-22 id inexistente responde igual a id de outro tenant', async () => {
    const a = await tenantAutenticado({ codigo: 'CLI-A6', login: 'a6@x' });

    const r = await app.inject({
      method: 'PATCH',
      url: '/areas-pastagem/nao-existe-em-lugar-nenhum',
      headers: auth(a.token),
      payload: { nome: 'X' },
    });

    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'AREA_NOT_FOUND');
  });
});

describe('P4.2 — exclusão ausente e auditoria', () => {
  test('BE-P42-23 DELETE /areas-pastagem/:id não existe', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);
    const area = (await criarArea(token, setor.id)).json();

    const r = await app.inject({
      method: 'DELETE',
      url: `/areas-pastagem/${area.id}`,
      headers: auth(token),
    });

    // 404 de rota inexistente, não 405: a rota não está registrada.
    assert.equal(r.statusCode, 404);
  });

  test('BE-P42-24 a baixa lógica continua sendo um PATCH', async () => {
    const { token } = await tenantAutenticado();
    const setor = await criarSetor(token);
    const area = (await criarArea(token, setor.id)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/areas-pastagem/${area.id}`,
      headers: auth(token),
      payload: { ativo: false },
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().ativo, false);
  });

  test('BE-P42-25 criação e atualização deixam rastro de auditoria do tenant', async () => {
    const { token, cliente } = await tenantAutenticado();
    const setor = await criarSetor(token);
    const area = (await criarArea(token, setor.id)).json();

    await app.inject({
      method: 'PATCH',
      url: `/areas-pastagem/${area.id}`,
      headers: auth(token),
      payload: { nome: 'PIQUETE RENOMEADO' },
    });

    const prisma = getPrismaClient();
    const eventos = await prisma.auditLog.findMany({
      where: { cliente_id: cliente.id, entidade: 'AreaPastagem', entidade_id: area.id },
      orderBy: { createdAt: 'asc' },
    });

    assert.equal(eventos.length, 2);
    assert.deepEqual(
      eventos.map((e) => e.acao),
      ['create', 'update']
    );
    // O payload não pode carregar objeto interno de Decimal.
    assert.equal(typeof eventos[0].dados_novos.tamanho_hectares, 'number');
  });
});
