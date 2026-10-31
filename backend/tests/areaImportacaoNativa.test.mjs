/**
 * Importação de áreas por arquivo (D-PROD-90), contra PostgreSQL real.
 *
 * Prova o que a tela promete:
 *  - conferir não grava nada (nem área, nem número, nem auditoria);
 *  - importar grava todas ou nenhuma: um item ruim no fim desfaz o lote;
 *  - setor de outro tenant, de outra empresa ou inativo é recusado sem escrita;
 *  - empresa de outro tenant é 404, sem escrita;
 *  - numero_area e setor_nome vêm do servidor; mandar os campos é 400;
 *  - hectares recalculados no servidor (geodésico), não aceitos do cliente;
 *  - retentativa com a mesma operation_id devolve o mesmo resultado sem
 *    duplicar; contorno igual a área existente vira pendência;
 *  - duas importações simultâneas das mesmas áreas não gravam em dobro.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../src/database/prismaClient.js';
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

const auth = (token) => ({ authorization: `Bearer ${token}` });

const tenantAutenticado = async () => {
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, token: corpo.token };
};

const criarEmpresa = async (token, nome = 'FAZENDA BOA VISTA') => {
  const r = await app.inject({
    method: 'POST',
    url: '/empresas',
    headers: auth(token),
    payload: { apelido: nome, nome, tipo_pessoa: 'Jurídica' },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const criarSetor = async (token, empresaId, nome = 'RETIRO') => {
  const r = await app.inject({
    method: 'POST',
    url: '/setores',
    headers: auth(token),
    payload: { empresa_id: empresaId, nome, tipo: 'Próprio' },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

/** Quadrado de ~1 km de lado perto de Cuiabá: ~100 ha. Desloca por `i`. */
const quadrado = (i = 0) => {
  const lat = -15.6 - i * 0.02;
  const lng = -56.1;
  const d = 0.009;
  return [
    [lat, lng],
    [lat, lng + d],
    [lat - d, lng + d],
    [lat - d, lng],
  ];
};

const item = (setorId, i = 0, extras = {}) => ({
  ref: `f${i + 1}`,
  nome: `PASTO ${i + 1}`,
  setor_id: setorId,
  tipo_cultura: 'Pastagem',
  tipo_pastagem: 'Marandu',
  area_pastejada: 50,
  aproveitamento_classificacao: 'Média',
  cor: '#f8f9fa',
  coords: quadrado(i),
  ...extras,
});

const conferir = (token, empresaId, itens) =>
  app.inject({
    method: 'POST',
    url: '/areas-pastagem/importacao/conferir',
    headers: auth(token),
    payload: { empresa_id: empresaId, itens },
  });

const importar = (token, empresaId, itens, operationId = `op-${randomUUID()}`) =>
  app.inject({
    method: 'POST',
    url: '/areas-pastagem/importacao',
    headers: auth(token),
    payload: { operation_id: operationId, empresa_id: empresaId, itens },
  });

const contarAreas = (clienteId) => getPrismaClient().areaPastagem.count({ where: { cliente_id: clienteId } });
const contarAuditoria = (clienteId) =>
  getPrismaClient().auditLog.count({ where: { cliente_id: clienteId, entidade: 'AreaPastagem' } });

describe('D-PROD-90 — importação de áreas', () => {
  test('IMP-01 sem token: 401 nas duas rotas', async () => {
    for (const url of ['/areas-pastagem/importacao/conferir', '/areas-pastagem/importacao']) {
      const r = await app.inject({ method: 'POST', url, payload: {} });
      assert.equal(r.statusCode, 401);
    }
  });

  test('IMP-02 conferir não grava área, número nem auditoria; devolve hectares geodésicos', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const auditAntes = await contarAuditoria(cliente.id);

    const r = await conferir(token, empresa.id, [item(setor.id, 0), item(setor.id, 1, { nome: '' })]);
    assert.equal(r.statusCode, 200, r.body);
    const corpo = r.json();
    assert.equal(corpo.total, 2);
    assert.equal(corpo.validas, 1);
    assert.equal(corpo.com_pendencia, 1);
    const ha = corpo.itens[0].tamanho_hectares_geodesico;
    assert.ok(ha > 90 && ha < 110, `hectares fora do esperado: ${ha}`);
    assert.deepEqual(
      corpo.itens[1].pendencias.map((p) => [p.campo, p.codigo]),
      [['nome', 'CAMPO_OBRIGATORIO']]
    );

    assert.equal(await contarAreas(cliente.id), 0);
    assert.equal(await contarAuditoria(cliente.id), auditAntes);
    const seq = await getPrismaClient().entidadeCodigoSequencia.count({
      where: { cliente_id: cliente.id, entidade: 'AreaPastagem' },
    });
    assert.equal(seq, 0, 'conferência não pode reservar número');
  });

  test('IMP-03 importar grava todas com número da sequência e setor_nome do servidor', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id, 'SETOR NORTE');

    const r = await importar(token, empresa.id, [item(setor.id, 0), item(setor.id, 1)]);
    assert.equal(r.statusCode, 201, r.body);
    const corpo = r.json();
    assert.equal(corpo.gravadas, 2);
    assert.deepEqual(corpo.importadas.map((a) => a.numero_area), ['1', '2']);
    assert.ok(corpo.importadas.every((a) => a.setor_nome === 'SETOR NORTE'));

    const areas = await getPrismaClient().areaPastagem.findMany({
      where: { cliente_id: cliente.id },
      orderBy: { numero_area: 'asc' },
    });
    assert.equal(areas.length, 2);
    const [a] = areas;
    assert.equal(a.empresa_id, empresa.id);
    assert.equal(a.setor_nome, 'SETOR NORTE');
    assert.equal(a.quantidade_atual, 0);
    assert.equal(a.status_ocupacao, 'Disponível');
    assert.equal(a.tipo_cultura, 'Pastagem');
    assert.equal(a.tipo_pastagem, 'Marandu');
    assert.equal(Number(a.area_pastejada), 50);
    const ha = Number(a.tamanho_hectares);
    assert.ok(ha > 90 && ha < 110);
    assert.deepEqual(/** @type {any} */ (a.coordenadas).coords, quadrado(0));
    assert.equal(/** @type {any} */ (a.coordenadas).cor, '#f8f9fa');
    assert.equal(await contarAuditoria(cliente.id), 2);
    // Nada além de áreas: nenhum lote, ponto ou linha.
    assert.equal(await getPrismaClient().lote.count({ where: { cliente_id: cliente.id } }), 0);
    assert.equal(await getPrismaClient().pontoReferencia.count({ where: { cliente_id: cliente.id } }), 0);
    assert.equal(await getPrismaClient().linhaGeografica.count({ where: { cliente_id: cliente.id } }), 0);
  });

  test('IMP-04 tudo ou nada: item inválido no fim → 422 e zero áreas, zero números', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const itens = [item(setor.id, 0), item(setor.id, 1), item(setor.id, 2, { area_pastejada: 99999 })];

    const r = await importar(token, empresa.id, itens);
    assert.equal(r.statusCode, 422, r.body);
    const corpo = r.json();
    assert.equal(corpo.code, 'AREA_IMPORT_VALIDATION_FAILED');
    assert.equal(corpo.details.gravadas, 0);
    const ruim = corpo.details.itens.find((i) => i.ref === 'f3');
    assert.equal(ruim.pendencias[0].codigo, 'PASTEJADA_MAIOR_QUE_TOTAL');

    assert.equal(await contarAreas(cliente.id), 0);
    assert.equal(await contarAuditoria(cliente.id), 0);
    assert.equal(await getPrismaClient().operacaoIdempotente.count({ where: { cliente_id: cliente.id } }), 0);
  });

  test('IMP-05 setor de outro tenant, de outra empresa e inativo → pendência, sem escrita', async () => {
    const a = await tenantAutenticado();
    const b = await tenantAutenticado();
    const empresaA = await criarEmpresa(a.token, 'EMPRESA A');
    const outraEmpresaA = await criarEmpresa(a.token, 'EMPRESA A2');
    const setorA = await criarSetor(a.token, empresaA.id, 'ATIVO');
    const setorOutraEmpresa = await criarSetor(a.token, outraEmpresaA.id, 'DA OUTRA');
    const setorInativo = await criarSetor(a.token, empresaA.id, 'INATIVO');
    const desativa = await app.inject({
      method: 'PATCH',
      url: `/setores/${setorInativo.id}`,
      headers: auth(a.token),
      payload: { ativo: false },
    });
    assert.equal(desativa.statusCode, 200, desativa.body);
    const empresaB = await criarEmpresa(b.token, 'EMPRESA B');
    const setorB = await criarSetor(b.token, empresaB.id, 'DO B');

    const itens = [
      item(setorA.id, 0),
      item(setorB.id, 1),
      item(setorOutraEmpresa.id, 2),
      item(setorInativo.id, 3),
    ];
    const r = await conferir(a.token, empresaA.id, itens);
    assert.equal(r.statusCode, 200, r.body);
    const codigos = r.json().itens.map((i) => i.pendencias.map((p) => p.codigo).join(','));
    assert.deepEqual(codigos, ['', 'SETOR_INVALIDO', 'SETOR_DE_OUTRA_EMPRESA', 'SETOR_INATIVO']);

    const imp = await importar(a.token, empresaA.id, itens);
    assert.equal(imp.statusCode, 422);
    assert.equal(await contarAreas(a.cliente.id), 0);
    assert.equal(await contarAreas(b.cliente.id), 0);
  });

  test('IMP-06 empresa de outro tenant → 404 EMPRESA_NOT_FOUND, sem escrita', async () => {
    const a = await tenantAutenticado();
    const b = await tenantAutenticado();
    const empresaB = await criarEmpresa(b.token, 'EMPRESA B');
    const setorB = await criarSetor(b.token, empresaB.id);
    const r = await importar(a.token, empresaB.id, [item(setorB.id, 0)]);
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal(await contarAreas(a.cliente.id), 0);
    assert.equal(await contarAreas(b.cliente.id), 0);
  });

  test('IMP-07 campos do servidor no item (numero_area, setor_nome, cliente_id, tamanho) → 400', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    for (const extra of [{ numero_area: '7' }, { setor_nome: 'X' }, { tamanho_hectares: 1 }, { empresa_id: 'x' }]) {
      const r = await importar(token, empresa.id, [item(setor.id, 0, extra)]);
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} deveria ser recusado`);
    }
    const r = await app.inject({
      method: 'POST',
      url: '/areas-pastagem/importacao',
      headers: auth(token),
      payload: { operation_id: 'op-12345678', empresa_id: empresa.id, cliente_id: 'x', itens: [item(setor.id, 0)] },
    });
    assert.equal(r.statusCode, 400);
    assert.equal(await contarAreas(cliente.id), 0);
  });

  test('IMP-08 retentativa com a mesma operation_id não duplica e devolve o mesmo resultado', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const itens = [item(setor.id, 0), item(setor.id, 1)];
    const op = `op-${randomUUID()}`;

    const r1 = await importar(token, empresa.id, itens, op);
    const r2 = await importar(token, empresa.id, itens, op);
    assert.equal(r1.statusCode, 201);
    assert.equal(r2.statusCode, 201);
    assert.equal(r2.json().replay, true);
    assert.deepEqual(
      r2.json().importadas.map((a) => a.id),
      r1.json().importadas.map((a) => a.id)
    );
    assert.equal(await contarAreas(cliente.id), 2);

    // Mesma chave com outro conteúdo: conflito, nada novo.
    const r3 = await importar(token, empresa.id, [item(setor.id, 5)], op);
    assert.equal(r3.statusCode, 409);
    assert.equal(r3.json().code, 'IDEMPOTENCY_CONFLICT');

    // Chave nova com o mesmo arquivo: as áreas já existem → pendência, sem gravar.
    const r4 = await importar(token, empresa.id, itens);
    assert.equal(r4.statusCode, 422);
    const codigos = r4.json().details.itens.flatMap((i) => i.pendencias.map((p) => p.codigo));
    assert.ok(codigos.includes('AREA_DUPLICADA'));
    assert.ok(codigos.includes('NOME_DUPLICADO_NO_SETOR'));
    assert.equal(await contarAreas(cliente.id), 2);
  });

  test('IMP-09 duplicata dentro do arquivo: mesmo contorno em outro sentido e outro vértice inicial', async () => {
    const { token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const invertido = [...quadrado(0)].reverse();
    const rotacionado = [...invertido.slice(2), ...invertido.slice(0, 2)];
    const r = await conferir(token, empresa.id, [
      item(setor.id, 0),
      item(setor.id, 1, { nome: 'OUTRO NOME', coords: rotacionado }),
      item(setor.id, 2, { nome: 'PASTO 1' }),
    ]);
    const itens = r.json().itens;
    assert.equal(itens[0].ok, true);
    assert.equal(itens[1].pendencias[0].codigo, 'AREA_DUPLICADA_NO_ARQUIVO');
    assert.equal(itens[2].pendencias[0].codigo, 'NOME_DUPLICADO_NO_ARQUIVO');
  });

  test('IMP-10 homônimas em setores diferentes são áreas diferentes', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const s1 = await criarSetor(token, empresa.id, 'NORTE');
    const s2 = await criarSetor(token, empresa.id, 'SUL');
    const r = await importar(token, empresa.id, [
      item(s1.id, 0, { nome: 'PIQUETE' }),
      item(s2.id, 1, { nome: 'PIQUETE' }),
    ]);
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(await contarAreas(cliente.id), 2);
  });

  test('IMP-11 geometria inválida: autointerseção, faixa, degenerado → pendência', async () => {
    const { token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const gravata = [[-15.6, -56.1], [-15.6, -56.09], [-15.61, -56.1], [-15.61, -56.09]];
    const r = await conferir(token, empresa.id, [
      item(setor.id, 0, { coords: gravata }),
      item(setor.id, 1, { coords: [[95, -56.1], [-15.6, -56.09], [-15.61, -56.1]] }),
      item(setor.id, 2, { coords: [[-15.6, -56.1], [-15.6, -56.09], [-15.6, -56.08]] }),
      item(setor.id, 3, { coords: [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0]], area_pastejada: 0 }),
    ]);
    const codigos = r.json().itens.map((i) => i.pendencias.map((p) => p.codigo).join(','));
    assert.equal(codigos[0], 'POLIGONO_AUTOINTERSECAO');
    assert.equal(codigos[1], 'VERTICE_FORA_DA_FAIXA');
    assert.equal(codigos[2], 'POLIGONO_DEGENERADO');
    assert.equal(codigos[3], '', 'lat/lng 0 é coordenada válida');
  });

  test('IMP-12 regras por uso: Reserva aceita 0 sem cultura; Infraestrutura exige tipo e grava 0 ha', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const sem = await conferir(token, empresa.id, [
      item(setor.id, 0, { tipo_cultura: 'Agricultura', tipo_pastagem: null, area_pastejada: null }),
      item(setor.id, 1, { tipo_cultura: 'Infraestrutura', tipo_pastagem: null, area_pastejada: null }),
    ]);
    assert.deepEqual(
      sem.json().itens.map((i) => i.pendencias.map((p) => p.campo).sort().join(',')),
      ['area_pastejada,tipo_pastagem', 'tipo_pastagem']
    );

    const r = await importar(token, empresa.id, [
      item(setor.id, 0, { tipo_cultura: 'Reserva', tipo_pastagem: null, area_pastejada: 0 }),
      item(setor.id, 1, { tipo_cultura: 'Infraestrutura', tipo_pastagem: 'Curral', area_pastejada: null }),
    ]);
    assert.equal(r.statusCode, 201, r.body);
    const areas = await getPrismaClient().areaPastagem.findMany({
      where: { cliente_id: cliente.id },
      orderBy: { numero_area: 'asc' },
    });
    assert.equal(Number(areas[0].area_pastejada), 0);
    assert.equal(areas[0].tipo_pastagem, null);
    assert.equal(areas[1].tipo_pastagem, 'Curral');
    assert.equal(Number(areas[1].tamanho_hectares), 0);
    assert.equal(/** @type {any} */ (areas[1].coordenadas).coords.length, 4, 'contorno preservado');
  });

  test('IMP-13 limite de itens → 413 sem escrita', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const itens = Array.from({ length: 101 }, (_, i) => item(setor.id, i));
    const r = await importar(token, empresa.id, itens);
    assert.ok([400, 413].includes(r.statusCode), r.body);
    assert.equal(await contarAreas(cliente.id), 0);
  });

  test('IMP-14 concorrência: duas importações iguais ao mesmo tempo gravam uma vez só', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const itens = [item(setor.id, 0), item(setor.id, 1), item(setor.id, 2)];
    const [r1, r2] = await Promise.all([importar(token, empresa.id, itens), importar(token, empresa.id, itens)]);
    const status = [r1.statusCode, r2.statusCode].sort();
    assert.deepEqual(status, [201, 422], `${r1.body} | ${r2.body}`);
    assert.equal(await contarAreas(cliente.id), 3);
  });

  // ─── R1 ────────────────────────────────────────────────────────────────────

  test('IMP-15 R1 corrida com a MESMA chave e o mesmo conteúdo: grava uma vez; o outro recebe replay ou conflito tipado', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const itens = [item(setor.id, 0), item(setor.id, 1), item(setor.id, 2)];
    const op = `op-${randomUUID()}`;
    const respostas = await Promise.all([
      importar(token, empresa.id, itens, op),
      importar(token, empresa.id, itens, op),
      importar(token, empresa.id, itens, op),
    ]);
    const corpos = respostas.map((r) => ({ status: r.statusCode, corpo: r.json() }));
    for (const { status, corpo } of corpos) {
      assert.ok(
        status === 201 || (status === 409 && corpo.code === 'IDEMPOTENCY_IN_PROGRESS'),
        `resposta não tipada: ${status} ${JSON.stringify(corpo)}`
      );
    }
    const criadas = corpos.filter((c) => c.status === 201 && c.corpo.replay === false);
    assert.equal(criadas.length, 1, 'exatamente uma execução real');
    const ids = criadas[0].corpo.importadas.map((a) => a.id).sort();
    for (const c of corpos.filter((x) => x.status === 201)) {
      assert.deepEqual(c.corpo.importadas.map((a) => a.id).sort(), ids, 'replay devolve as mesmas áreas');
    }
    assert.equal(await contarAreas(cliente.id), 3);
    assert.equal(await contarAuditoria(cliente.id), 3);
    assert.equal(await getPrismaClient().operacaoIdempotente.count({ where: { cliente_id: cliente.id } }), 1);
  });

  test('IMP-16 R1 corrida com a MESMA chave e conteúdo DIFERENTE: um grava, o outro recebe IDEMPOTENCY_CONFLICT', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const op = `op-${randomUUID()}`;
    const a = [item(setor.id, 0), item(setor.id, 1)];
    const b = [item(setor.id, 5), item(setor.id, 6), item(setor.id, 7)];
    const [r1, r2] = await Promise.all([importar(token, empresa.id, a, op), importar(token, empresa.id, b, op)]);
    const status = [r1.statusCode, r2.statusCode].sort();
    assert.deepEqual(status, [201, 409], `${r1.body} | ${r2.body}`);
    const perdedor = r1.statusCode === 409 ? r1 : r2;
    assert.ok(['IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_IN_PROGRESS'].includes(perdedor.json().code), perdedor.body);
    const vencedor = r1.statusCode === 201 ? r1 : r2;
    const n = vencedor.json().gravadas;
    assert.equal(await contarAreas(cliente.id), n);
    assert.equal(await contarAuditoria(cliente.id), n);
  });

  test('IMP-17 R1 commit feito e resposta perdida: reenviar a mesma chave devolve replay, sem área, número ou auditoria novos', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const itens = [item(setor.id, 0), item(setor.id, 1)];
    const op = `op-${randomUUID()}`;
    const primeira = await importar(token, empresa.id, itens, op); // "resposta perdida" pelo cliente
    assert.equal(primeira.statusCode, 201);
    const antes = {
      areas: await contarAreas(cliente.id),
      auditoria: await contarAuditoria(cliente.id),
      seq: JSON.stringify(await getPrismaClient().entidadeCodigoSequencia.findMany({ where: { cliente_id: cliente.id } })),
    };
    const retentativa = await importar(token, empresa.id, itens, op);
    assert.equal(retentativa.statusCode, 201);
    assert.equal(retentativa.json().replay, true);
    assert.deepEqual(retentativa.json().importadas, primeira.json().importadas);
    assert.equal(await contarAreas(cliente.id), antes.areas);
    assert.equal(await contarAuditoria(cliente.id), antes.auditoria);
    assert.equal(
      JSON.stringify(await getPrismaClient().entidadeCodigoSequencia.findMany({ where: { cliente_id: cliente.id } })),
      antes.seq,
      'a sequência não avança no replay'
    );
  });

  test('IMP-18 R1 422 não deixa chave presa: corrigir e reenviar (mesma ou nova chave) grava', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const op = `op-${randomUUID()}`;
    const ruim = [item(setor.id, 0), item(setor.id, 1, { area_pastejada: 99999 })];
    const r1 = await importar(token, empresa.id, ruim, op);
    assert.equal(r1.statusCode, 422);
    assert.equal(await contarAreas(cliente.id), 0);
    const bom = [item(setor.id, 0), item(setor.id, 1)];
    const r2 = await importar(token, empresa.id, bom, op);
    assert.equal(r2.statusCode, 201, r2.body);
    assert.equal(await contarAreas(cliente.id), 2);
  });

  test('IMP-19 R1 arquivo de 205 áreas em lotes 100 + 100 + 5: cada lote atômico, falha no 2º não desfaz o 1º', async () => {
    const { cliente, token } = await tenantAutenticado();
    const empresa = await criarEmpresa(token);
    const setor = await criarSetor(token, empresa.id);
    const todos = Array.from({ length: 205 }, (_, i) => item(setor.id, i));
    const lote1 = todos.slice(0, 100);
    const lote2 = todos.slice(100, 200);
    const lote3 = todos.slice(200);

    const r1 = await importar(token, empresa.id, lote1);
    assert.equal(r1.statusCode, 201, r1.body);
    assert.equal(r1.json().gravadas, 100);

    // 2º lote com um item ruim no fim: nada dele é gravado; o 1º continua.
    const lote2Ruim = [...lote2.slice(0, 99), { ...lote2[99], area_pastejada: 99999 }];
    const r2Ruim = await importar(token, empresa.id, lote2Ruim);
    assert.equal(r2Ruim.statusCode, 422);
    assert.equal(await contarAreas(cliente.id), 100);

    // Corrigido, com chave nova (conteúdo novo): grava.
    const r2 = await importar(token, empresa.id, lote2);
    assert.equal(r2.statusCode, 201, r2.body);
    const r3 = await importar(token, empresa.id, lote3);
    assert.equal(r3.statusCode, 201, r3.body);

    assert.equal(await contarAreas(cliente.id), 205);
    assert.equal(await contarAuditoria(cliente.id), 205);
    const numeros = (await getPrismaClient().areaPastagem.findMany({ where: { cliente_id: cliente.id }, select: { numero_area: true } }))
      .map((a) => Number(a.numero_area))
      .sort((x, y) => x - y);
    assert.equal(new Set(numeros).size, 205, 'números sem repetição');
    assert.deepEqual([numeros[0], numeros[204]], [1, 205]);

    // Reenviar um lote já gravado com chave nova: tudo duplicado, nada gravado.
    const r1Denovo = await importar(token, empresa.id, lote1);
    assert.equal(r1Denovo.statusCode, 422);
    assert.equal(await contarAreas(cliente.id), 205);
  });
});
