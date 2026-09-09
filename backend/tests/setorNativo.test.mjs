/**
 * Setor nativo, contra PostgreSQL real (P4.1, D-PROD-25).
 *
 * O que este arquivo existe para provar — e que nenhum gate estático consegue:
 *
 *  - a numeração vem da sequência atômica, e não repete sob concorrência real.
 *    Um teste que criasse setores em série provaria só que o contador soma 1;
 *    o defeito que a P4.1 remove (`MAX + 1` no navegador) só aparece quando
 *    duas criações acontecem ao mesmo tempo;
 *  - o tenant vem do token: o setor do cliente B não é lido, não é atualizado e
 *    não é sequer distinguível de um id inexistente para o cliente A;
 *  - campo que o servidor atribui — `id`, `cliente_id`, `numero_setor` — é
 *    RECUSADO na porta quando enviado, e não silenciosamente ignorado;
 *  - a exclusão não existe. Não como rota que reprova: como rota ausente;
 *  - auditoria e gravação são a mesma transação.
 *
 * Nada aqui usa mock de Prisma. Isolamento entre tenants, atomicidade e
 * violação de unique só existem de verdade no banco.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { BACKEND_ONLY_CODES } from '../src/shared/errors/errorCodes.js';
import { escopoDaNumeracao, ENTIDADE_SEQUENCIA } from '../src/modules/setores/setorService.js';
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

/** Cria tenant, autentica e devolve o token. */
const tenantAutenticado = async (opcoes) => {
  const { cliente, usuario, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, usuario, token: corpo.token };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

const corpoValido = (extras = {}) => ({
  empresa_id: EMPRESA,
  nome: 'FAZENDA SANTA CLARA',
  tipo: 'Próprio',
  ...extras,
});

const criarSetor = (token, extras) =>
  app.inject({
    method: 'POST',
    url: '/setores',
    headers: auth(token),
    payload: corpoValido(extras),
  });

// ---------------------------------------------------------------------------

describe('P4.1 — sessão obrigatória', () => {
  test('BE-P41-01 GET /setores sem token reprova com TENANT_CONTEXT_REQUIRED', async () => {
    const r = await app.inject({ method: 'GET', url: '/setores' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P41-02 POST /setores sem token reprova antes de qualquer escrita', async () => {
    const r = await app.inject({ method: 'POST', url: '/setores', payload: corpoValido() });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
    assert.equal(await getPrismaClient().setor.count(), 0);
  });

  test('BE-P41-03 PATCH /setores/:id sem token reprova', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/setores/qualquer', payload: { nome: 'X' } });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P41-04 token inválido não vira sessão', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/setores',
      headers: { authorization: 'Bearer nao-e-um-jwt' },
    });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });
});

describe('P4.1 — numeração pela sequência', () => {
  test('BE-P41-05 o primeiro setor do tenant recebe numero_setor "1"', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token);

    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_setor, '1');
  });

  test('BE-P41-06 criações em série avançam 1, 2, 3 — sem MAX+1 em lugar nenhum', async () => {
    const { token } = await tenantAutenticado();

    const numeros = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await criarSetor(token, { nome: `SETOR ${i}` });
      numeros.push(r.json().numero_setor);
    }

    assert.deepEqual(numeros, ['1', '2', '3']);
  });

  test('BE-P41-07 a sequência usada é a do contrato: entidade Setor, escopo tenant', async () => {
    const { cliente, token } = await tenantAutenticado();
    await criarSetor(token);

    const linhas = await getPrismaClient().entidadeCodigoSequencia.findMany({
      where: { cliente_id: cliente.id },
    });

    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].entidade, ENTIDADE_SEQUENCIA);
    assert.equal(linhas[0].escopo_tipo, ESCOPO_TENANT);
    assert.equal(escopoDaNumeracao(), ESCOPO_TENANT);
    // Sentinela não nula: no escopo tenant, escopo_id é o próprio cliente_id.
    assert.equal(linhas[0].escopo_id, cliente.id);
  });

  test('BE-P41-08 12 criações CONCORRENTES produzem exatamente 1..12, sem repetir', async () => {
    const { token } = await tenantAutenticado();

    const respostas = await Promise.all(
      Array.from({ length: 12 }, (_, i) => criarSetor(token, { nome: `PARALELO ${i}` }))
    );

    for (const r of respostas) assert.equal(r.statusCode, 201, r.body);

    const numeros = respostas.map((r) => Number(r.json().numero_setor)).sort((a, b) => a - b);
    assert.deepEqual(numeros, Array.from({ length: 12 }, (_, i) => i + 1));
  });

  test('BE-P41-09 tenants diferentes numeram de forma independente', async () => {
    const a = await tenantAutenticado({ codigo: 'tenant-a-p41' });
    const b = await tenantAutenticado({ codigo: 'tenant-b-p41' });

    assert.equal((await criarSetor(a.token)).json().numero_setor, '1');
    assert.equal((await criarSetor(b.token)).json().numero_setor, '1');
    assert.equal((await criarSetor(a.token)).json().numero_setor, '2');
  });

  test('BE-P41-10 o número não é reaproveitado depois que a linha some', async () => {
    const { cliente, token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    // Exclusão direta no banco: a API não tem DELETE (ver BE-P41-20). O que se
    // prova aqui é o contrato `reuseAfterDelete = false` da numeração.
    await getPrismaClient().setor.delete({
      where: { cliente_id_id: { cliente_id: cliente.id, id: criado.id } },
    });

    assert.equal((await criarSetor(token, { nome: 'DEPOIS' })).json().numero_setor, '2');
  });
});

describe('P4.1 — o servidor atribui, o cliente não envia', () => {
  test('BE-P41-11 cliente_id no corpo é RECUSADO na porta, não ignorado', async () => {
    const { cliente, token } = await tenantAutenticado();
    const outro = await criarTenant({ codigo: 'alheio-p41' });

    const r = await app.inject({
      method: 'POST',
      url: '/setores',
      headers: auth(token),
      payload: { ...corpoValido(), cliente_id: outro.cliente.id },
    });

    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    // E nada foi gravado — nem no tenant certo, nem no alheio.
    assert.equal(await getPrismaClient().setor.count({ where: { cliente_id: cliente.id } }), 0);
    assert.equal(await getPrismaClient().setor.count({ where: { cliente_id: outro.cliente.id } }), 0);
  });

  test('BE-P41-12 id no corpo é recusado: a PK vem do cuid() do Prisma', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/setores',
      headers: auth(token),
      payload: { ...corpoValido(), id: 'id-escolhido-pelo-cliente' },
    });

    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });

  test('BE-P41-13 numero_setor no corpo é recusado: quem numera é a sequência', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/setores',
      headers: auth(token),
      payload: { ...corpoValido(), numero_setor: '999' },
    });

    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });

  test('BE-P41-14 metadado offline no corpo é recusado', async () => {
    const { token } = await tenantAutenticado();

    for (const extra of [{ _isOffline: true }, { created_date: '2020-01-01' }, { updated_date: '2020-01-01' }]) {
      const r = await app.inject({
        method: 'POST',
        url: '/setores',
        headers: auth(token),
        payload: { ...corpoValido(), ...extra },
      });
      assert.equal(r.statusCode, 400, JSON.stringify(extra));
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    }
  });

  test('BE-P41-15 a resposta NÃO devolve cliente_id', async () => {
    const { token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    assert.equal(Object.prototype.hasOwnProperty.call(criado, 'cliente_id'), false);

    const lista = (await app.inject({ method: 'GET', url: '/setores', headers: auth(token) })).json();
    assert.equal(lista.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(lista[0], 'cliente_id'), false);
  });
});

describe('P4.1 — validação de forma', () => {
  test('BE-P41-16 tipo fora do enum é recusado', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token, { tipo: 'Inventado' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });

  test('BE-P41-17 nome e empresa_id são obrigatórios na criação', async () => {
    const { token } = await tenantAutenticado();

    const semNome = await app.inject({
      method: 'POST',
      url: '/setores',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, tipo: 'Próprio' },
    });
    assert.equal(semNome.statusCode, 400);

    const semEmpresa = await app.inject({
      method: 'POST',
      url: '/setores',
      headers: auth(token),
      payload: { nome: 'X', tipo: 'Próprio' },
    });
    assert.equal(semEmpresa.statusCode, 400);
  });

  test('BE-P41-18 opcionais aceitam null e voltam null; decimal e inteiro sobrevivem', async () => {
    const { token } = await tenantAutenticado();
    const criado = (
      await criarSetor(token, {
        sigla: null,
        responsavel: null,
        area_total: 1234.5678,
        capacidade_animais: 480,
        estado: 'GO',
      })
    ).json();

    assert.equal(criado.sigla, null);
    assert.equal(criado.responsavel, null);
    assert.equal(criado.area_total, 1234.5678);
    assert.equal(criado.capacidade_animais, 480);
    assert.equal(criado.estado, 'GO');
    assert.equal(criado.ativo, true);

    // E o mesmo valor volta na leitura — não é artefato da resposta de criação.
    const lista = (await app.inject({ method: 'GET', url: '/setores', headers: auth(token) })).json();
    assert.equal(lista[0].area_total, 1234.5678);
  });

  test('BE-P41-19 string acima do limite da coluna vira 400, não 500 do banco', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token, { nome: 'N'.repeat(300) });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });

  // ── P4.1-R1: obrigatório só com espaço ────────────────────────────────────
  //
  // `minLength: 1` aceita `" "`. O serviço apara texto e devolve `null` para o
  // que sobra vazio, então o valor chegava ao Prisma como `null` numa coluna
  // NOT NULL e virava `INTERNAL_ERROR` 500 — recusa certa, status errado, e
  // sem causa para quem chamou. É a mesma classe do BE-P41-19.

  test('BE-P41-31 nome só com espaço é 400, não 500 do banco', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token, { nome: '   ' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await getPrismaClient().setor.count(), 0);
  });

  test('BE-P41-32 empresa_id só com espaço é 400, não 500 do banco', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token, { empresa_id: '\t \n' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await getPrismaClient().setor.count(), 0);
  });

  test('BE-P41-33 PATCH com nome só de espaço é 400 e não apaga o nome', async () => {
    const { token } = await tenantAutenticado();
    const criado = (await criarSetor(token, { nome: 'ORIGINAL' })).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/setores/${criado.id}`,
      headers: auth(token),
      payload: { nome: '  ' },
    });

    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');

    const depois = await getPrismaClient().setor.findUniqueOrThrow({ where: { id: criado.id } });
    assert.equal(depois.nome, 'ORIGINAL');
  });

  test('BE-P41-34 CONTROLE POSITIVO: espaço nas bordas de valor real continua aceito', async () => {
    // A regra recusa "só espaço", não "tem espaço". Sem este caso, apertar o
    // padrão até recusar nome com espaço passaria sem ninguém notar.
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token, { nome: ' SETOR DA SEDE ' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().nome, 'SETOR DA SEDE');
  });

  test('BE-P41-35 CONTROLE POSITIVO: opcional só com espaço continua virando null', async () => {
    // `sigla` é anulável: aparar para `null` ali é normalização desejada, e a
    // correção não podia transformá-la em 400.
    const { token } = await tenantAutenticado();
    const r = await criarSetor(token, { sigla: '   ' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().sigla, null);
  });
});

describe('P4.1 — exclusão não existe', () => {
  test('BE-P41-20 DELETE /setores/:id não é rota do backend', async () => {
    const { token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    const r = await app.inject({
      method: 'DELETE',
      url: `/setores/${criado.id}`,
      headers: auth(token),
    });

    // 404 do roteador: a rota não existe. Não é um handler que reprova — é
    // ausência de superfície, que é o que a P4.1 decidiu.
    assert.equal(r.statusCode, 404);
    assert.equal(await getPrismaClient().setor.count(), 1);
  });
});

describe('P4.1 — isolamento entre tenants', () => {
  test('BE-P41-21 GET devolve só os setores do próprio tenant', async () => {
    const a = await tenantAutenticado({ codigo: 'iso-a-p41' });
    const b = await tenantAutenticado({ codigo: 'iso-b-p41' });

    await criarSetor(a.token, { nome: 'DO A' });
    await criarSetor(b.token, { nome: 'DO B' });
    await criarSetor(b.token, { nome: 'DO B TAMBEM' });

    const daA = (await app.inject({ method: 'GET', url: '/setores', headers: auth(a.token) })).json();
    assert.deepEqual(daA.map((s) => s.nome), ['DO A']);

    const daB = (await app.inject({ method: 'GET', url: '/setores', headers: auth(b.token) })).json();
    assert.deepEqual(daB.map((s) => s.nome), ['DO B', 'DO B TAMBEM']);
  });

  test('BE-P41-22 PATCH em setor de OUTRO tenant devolve SETOR_NOT_FOUND, não 403', async () => {
    const a = await tenantAutenticado({ codigo: 'patch-a-p41' });
    const b = await tenantAutenticado({ codigo: 'patch-b-p41' });

    const doB = (await criarSetor(b.token, { nome: 'INTOCAVEL' })).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/setores/${doB.id}`,
      headers: auth(a.token),
      payload: { nome: 'INVADIDO' },
    });

    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'SETOR_NOT_FOUND');
    assert.equal(BACKEND_ONLY_CODES.SETOR_NOT_FOUND.http, 404);

    // O registro do B continua intacto.
    const aindaDoB = (await app.inject({ method: 'GET', url: '/setores', headers: auth(b.token) })).json();
    assert.equal(aindaDoB[0].nome, 'INTOCAVEL');
  });

  test('BE-P41-23 id inexistente e id alheio dão a MESMA resposta', async () => {
    const a = await tenantAutenticado({ codigo: 'oraculo-a-p41' });
    const b = await tenantAutenticado({ codigo: 'oraculo-b-p41' });
    const doB = (await criarSetor(b.token, { nome: 'DO B' })).json();

    const inexistente = await app.inject({
      method: 'PATCH',
      url: '/setores/id-que-nunca-existiu',
      headers: auth(a.token),
      payload: { nome: 'X' },
    });
    const alheio = await app.inject({
      method: 'PATCH',
      url: `/setores/${doB.id}`,
      headers: auth(a.token),
      payload: { nome: 'X' },
    });

    assert.equal(inexistente.statusCode, alheio.statusCode);
    assert.equal(inexistente.json().code, alheio.json().code);
    assert.equal(inexistente.json().message, alheio.json().message);
  });
});

describe('P4.1 — atualização', () => {
  test('BE-P41-24 PATCH altera campo e PRESERVA numero_setor e id', async () => {
    const { token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/setores/${criado.id}`,
      headers: auth(token),
      payload: { nome: 'FAZENDA NOVA', ativo: false },
    });

    assert.equal(r.statusCode, 200);
    const atualizado = r.json();
    assert.equal(atualizado.nome, 'FAZENDA NOVA');
    assert.equal(atualizado.ativo, false);
    assert.equal(atualizado.numero_setor, criado.numero_setor);
    assert.equal(atualizado.id, criado.id);
  });

  test('BE-P41-25 PATCH com numero_setor, id, cliente_id ou empresa_id é recusado', async () => {
    const { token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    for (const payload of [
      { numero_setor: '77' },
      { id: 'outro' },
      { cliente_id: 'outro' },
      { empresa_id: 'outra-empresa' },
    ]) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/setores/${criado.id}`,
        headers: auth(token),
        payload,
      });
      assert.equal(r.statusCode, 400, JSON.stringify(payload));
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    }

    const depois = (await app.inject({ method: 'GET', url: '/setores', headers: auth(token) })).json();
    assert.equal(depois[0].numero_setor, criado.numero_setor);
    assert.equal(depois[0].empresa_id, EMPRESA);
  });

  test('BE-P41-26 PATCH com corpo vazio é recusado, em vez de virar escrita sem efeito', async () => {
    const { token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    const r = await app.inject({
      method: 'PATCH',
      url: `/setores/${criado.id}`,
      headers: auth(token),
      payload: {},
    });

    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });
});

describe('P4.1 — auditoria na mesma transação', () => {
  test('BE-P41-27 criar grava AuditLog com ator do token e sem cliente_id do corpo', async () => {
    const { cliente, usuario, token } = await tenantAutenticado();
    const criado = (await criarSetor(token)).json();

    const logs = await getPrismaClient().auditLog.findMany({
      where: { cliente_id: cliente.id, entidade: 'Setor' },
    });

    assert.equal(logs.length, 1);
    assert.equal(logs[0].acao, 'create');
    assert.equal(logs[0].entidade_id, criado.id);
    assert.equal(logs[0].usuario_id, usuario.id);
    assert.equal(logs[0].dados_anteriores, null);
    assert.equal(logs[0].dados_novos.numero_setor, '1');
    assert.ok(logs[0].request_id);
  });

  test('BE-P41-28 atualizar grava o antes e o depois', async () => {
    const { cliente, token } = await tenantAutenticado();
    const criado = (await criarSetor(token, { nome: 'ANTES' })).json();

    await app.inject({
      method: 'PATCH',
      url: `/setores/${criado.id}`,
      headers: auth(token),
      payload: { nome: 'DEPOIS' },
    });

    const logs = await getPrismaClient().auditLog.findMany({
      where: { cliente_id: cliente.id, entidade: 'Setor', acao: 'update' },
    });

    assert.equal(logs.length, 1);
    assert.equal(logs[0].dados_anteriores.nome, 'ANTES');
    assert.equal(logs[0].dados_novos.nome, 'DEPOIS');
  });

  test('BE-P41-29 nenhum payload de auditoria de Setor carrega segredo', async () => {
    const { cliente, token } = await tenantAutenticado();
    await criarSetor(token);

    const logs = await getPrismaClient().auditLog.findMany({ where: { cliente_id: cliente.id } });
    const serializado = JSON.stringify(logs);

    for (const proibido of ['senha', 'senha_hash', 'password', 'token', 'authorization']) {
      assert.equal(
        new RegExp(`"[^"]*${proibido}[^"]*"\\s*:`, 'i').test(serializado),
        false,
        `campo "${proibido}" apareceu no AuditLog`
      );
    }
  });

  test('BE-P41-30 falha de auditoria desfaz a criação — nada de linha órfã', async () => {
    const { cliente, token } = await tenantAutenticado();
    const prisma = getPrismaClient();

    // A FK composta de AuditLog exige [cliente_id, usuario_id] existentes.
    // Apagar o usuário derruba a escrita de auditoria — e é isso que se quer
    // observar: a transação inteira volta atrás.
    await prisma.usuario.deleteMany({ where: { cliente_id: cliente.id } });

    const r = await criarSetor(token);

    assert.equal(r.statusCode, 500);
    assert.equal(r.json().code, 'AUDIT_WRITE_FAILED');
    assert.equal(await prisma.setor.count({ where: { cliente_id: cliente.id } }), 0);
  });
});
