/**
 * D-PROD-254 — REGISTRO DE CAMPO (`POST /atividades/registrar`) e leituras por área
 * (`GET /atividades-por-area/:areaId/resumo|registros`), contra PostgreSQL real e HTTP autenticado.
 *
 * Cobre: entrar na atividade aberta do tipo/área/mês, criar quando não há (nome `<Tipo> · <Área> · <mmm/aa>`, área
 * EM_ANDAMENTO), o casamento (outro mês, tipo, área; concluída, cancelada, área CONCLUIDA não casam), duas abertas → a
 * mais recente, área PLANEJADA iniciada, linhas (máquina com a atividade exigindo máquina, produto, mão de obra, serviço),
 * a corrida (1 atividade só), idempotência, validação, permissão e tenant, e as leituras (resumo, custos, registros e
 * paginação).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';

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

const montar = async () => {
  const s = await montarLinhasCusto(app);
  const p = prisma();
  const registrar = (corpo = {}, tok = s.token) =>
    s.H.req('POST', '/atividades/registrar', tok, {
      empresa_id: s.e1.id, area_id: s.area1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10', operation_id: opId('reg'), ...corpo,
    });
  const ok = async (corpo, tok) => {
    const r = await registrar(corpo, tok);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const novaArea = (nome, tamanho = '25') =>
    p.areaPastagem.create({
      data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: tamanho },
    });
  const atividades = () => p.atividade.findMany({ where: { cliente_id: s.c, id: { not: s.atividade.id } }, orderBy: { createdAt: 'asc' } });
  const versaoAt = async (id) => (await p.atividade.findUnique({ where: { id } })).versao;
  const concluirAt = async (id) => s.H.ok(s.H.req('POST', `/atividades/${id}/concluir`, s.token, { empresa_id: s.e1.id, versao: await versaoAt(id) }));
  const cancelarAt = async (id) => s.H.ok(s.H.req('POST', `/atividades/${id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: await versaoAt(id), motivo: 'cancelada no teste' }));
  const cancelarAp = async (atividadeId, ap) =>
    s.H.ok(s.H.req('POST', `/atividades/${atividadeId}/apontamentos/${ap.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: ap.versao, motivo: 'cancelado no teste' }));
  return { ...s, registrar, ok, novaArea, atividades, concluirAt, cancelarAt, cancelarAp };
};

describe('registrar', () => {
  test('sem atividade aberta: cria "<Tipo> · <Área> · <mmm/aa>", com a área EM_ANDAMENTO desde o dia, e grava o apontamento', async () => {
    const s = await montar();
    const r = await s.ok({ area_executada_dia: '7', observacao: 'gradeou' });
    const [a] = await s.atividades();
    assert.equal(a.nome, `${s.tipo.nome_tipo} · ${s.area1.nome} · jun/27`);
    assert.deepEqual([r.registro.atividade_criada, r.registro.atividade_id, r.registro.atividade_nome, r.registro.area_iniciada], [true, a.id, a.nome, false]);
    assert.equal(r.apontamento.atividade_id, a.id);
    assert.equal(r.apontamento.atividade_area_id, r.registro.atividade_area_id);
    assert.equal(r.apontamento.area_executada_dia, '7.0000');
    const [ar] = await prisma().atividadeArea.findMany({ where: { atividade_id: a.id } });
    assert.deepEqual([ar.status, ar.area_planejada.toFixed(4), ar.data_inicio.toISOString().slice(0, 10)], ['EM_ANDAMENTO', '10.0000', '2027-06-10']);
    assert.equal(a.data_inicio.toISOString().slice(0, 10), '2027-06-10');
  });

  test('com atividade aberta do tipo/área/mês: entra nela (não cria), 2 registros = 1 atividade, 2 apontamentos', async () => {
    const s = await montar();
    const um = await s.ok();
    const dois = await s.ok({ data_operacional: '2027-06-12' });
    assert.equal(dois.registro.atividade_criada, false);
    assert.equal(dois.registro.atividade_id, um.registro.atividade_id);
    assert.equal((await s.atividades()).length, 1);
    assert.equal(await prisma().atividadeApontamento.count({ where: { atividade_id: um.registro.atividade_id } }), 2);
  });

  test('entra numa atividade planejada pelo cabeçalho (mês, tipo e área iguais) e a área PLANEJADA é iniciada', async () => {
    const s = await montar();
    const a = await s.abrir({ areas: [{ area_id: s.area1.id }], data_inicio: '2027-06-01' });
    const r = await s.ok();
    assert.deepEqual([r.registro.atividade_criada, r.registro.atividade_id, r.registro.area_iniciada], [false, a.id, true]);
    const [ar] = await prisma().atividadeArea.findMany({ where: { atividade_id: a.id } });
    assert.deepEqual([ar.status, ar.data_inicio.toISOString().slice(0, 10)], ['EM_ANDAMENTO', '2027-06-10']);
  });

  test('dia anterior ao início da atividade: a área começa no início da atividade (o registro entra, com alerta)', async () => {
    const s = await montar();
    await s.abrir({ areas: [{ area_id: s.area1.id }], data_inicio: '2027-06-08' });
    const r = await s.ok({ data_operacional: '2027-06-03' });
    assert.equal(r.registro.area_iniciada, true);
    assert.equal(r.alertas.length, 1);
  });

  test('não casam: outro mês, outro tipo, outra área, atividade concluída ou cancelada, área CONCLUIDA — cada um cria atividade nova', async () => {
    const s = await montar();
    const outraArea = await s.novaArea('PASTO 02');
    const base = await s.abrir({ areas: [{ area_id: s.area1.id }], data_inicio: '2027-06-01' });
    // outro mês
    const maio = await s.ok({ data_operacional: '2027-05-20' });
    assert.equal(maio.registro.atividade_criada, true);
    assert.match(maio.registro.atividade_nome, /mai\/27$/);
    // outro tipo
    const outroTipo = await s.ok({ tipo_atividade_id: s.tipoSem.id });
    assert.equal(outroTipo.registro.atividade_criada, true);
    // outra área
    const outra = await s.ok({ area_id: outraArea.id });
    assert.equal(outra.registro.atividade_criada, true);
    assert.notEqual(outra.registro.atividade_id, base.id);
    // área CONCLUIDA na atividade
    await prisma().atividadeArea.updateMany({ where: { atividade_id: base.id }, data: { status: 'CONCLUIDA', data_inicio: new Date('2027-06-01'), data_conclusao: new Date('2027-06-02') } });
    const concluidaArea = await s.ok({ data_operacional: '2027-06-11' });
    assert.equal(concluidaArea.registro.atividade_criada, true);
    // atividade concluída / cancelada
    await s.concluirAt(concluidaArea.registro.atividade_id);
    const aposConcluir = await s.ok({ data_operacional: '2027-06-12' });
    assert.equal(aposConcluir.registro.atividade_criada, true, 'concluída');
    assert.notEqual(aposConcluir.registro.atividade_id, concluidaArea.registro.atividade_id);
    await s.cancelarAt(aposConcluir.registro.atividade_id);
    const aposCancelar = await s.ok({ data_operacional: '2027-06-12' });
    assert.equal(aposCancelar.registro.atividade_criada, true, 'cancelada');
    assert.notEqual(aposCancelar.registro.atividade_id, aposConcluir.registro.atividade_id);
  });

  test('duas abertas do tipo contêm a área no mês: entra na de updatedAt mais recente', async () => {
    const s = await montar();
    const a1 = await s.abrir({ areas: [{ area_id: s.area1.id }], data_inicio: '2027-06-01' });
    const a2 = await s.abrir({ areas: [{ area_id: s.area1.id }], data_inicio: '2027-06-02' });
    await prisma().$executeRaw`UPDATE "Atividade" SET "updatedAt" = (now() AT TIME ZONE 'UTC') + interval '1 hour' WHERE id = ${a1.id}`;
    assert.equal((await s.ok()).registro.atividade_id, a1.id);
    await prisma().$executeRaw`UPDATE "Atividade" SET "updatedAt" = (now() AT TIME ZONE 'UTC') + interval '2 hours' WHERE id = ${a2.id}`;
    assert.equal((await s.ok({ data_operacional: '2027-06-11' })).registro.atividade_id, a2.id);
  });

  test('as linhas entram no mesmo apontamento: máquina (a atividade criada usa o bem), produto, mão de obra e serviço', async () => {
    const s = await montar();
    await prisma().tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_maquina: true, permite_implemento: true } });
    const r = await s.ok({
      maquinas: [{ bem_id: s.trator.id, sem_medidor: true, quantidade_uso: '6.5' }],
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }],
      mao_obra: [{ parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '6.5' }],
      servicos: [{ servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '150' }],
      area_executada_dia: '7',
    });
    const ap = r.apontamento;
    assert.deepEqual([ap.maquinas.length, ap.produtos.length, ap.mao_obra.length, ap.servicos.length], [1, 1, 1, 1]);
    const [a] = await s.atividades();
    assert.equal(a.bem_id, s.trator.id);
  });

  test('tipo que exige máquina sem máquina nas linhas: 422 e nada criado', async () => {
    const s = await montar();
    await prisma().tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_maquina: true } });
    const r = await s.registrar();
    assert.equal(r.statusCode, 422, r.body);
    assert.equal((await s.atividades()).length, 0);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), 0);
  });

  test('a corrida: dois registros paralelos (chaves diferentes) → UMA atividade e dois apontamentos', async () => {
    const s = await montar();
    const [a, b] = await Promise.all([s.registrar(), s.registrar({ data_operacional: '2027-06-11' })]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201], `${a.body} ${b.body}`);
    assert.equal(a.json().registro.atividade_id, b.json().registro.atividade_id);
    assert.equal((await s.atividades()).length, 1);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), 2);
    assert.deepEqual([a, b].map((x) => x.json().registro.atividade_criada).sort(), [false, true]);
  });

  test('idempotência: reenvio igual → 200 replay (nada novo); corpo diferente com a mesma chave → 409', async () => {
    const s = await montar();
    const operation_id = opId('idem');
    const um = await s.registrar({ operation_id, area_executada_dia: '3' });
    assert.equal(um.statusCode, 201, um.body);
    const dois = await s.registrar({ operation_id, area_executada_dia: '3' });
    assert.equal(dois.statusCode, 200, dois.body);
    assert.equal(dois.json().replay, true);
    assert.equal(dois.json().apontamento.id, um.json().apontamento.id);
    assert.deepEqual(erro(await s.registrar({ operation_id, area_executada_dia: '4' })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal((await s.atividades()).length, 1);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), 1);
  });

  test('validação: dia futuro 422; área inexistente/de outra fazenda/inativa e tipo inexistente/inativo 422; operation_id ausente e campos fora do contrato 400; nada gravado', async () => {
    const s = await montar();
    const inativa = await s.novaArea('PASTO VELHO');
    await prisma().areaPastagem.update({ where: { id: inativa.id }, data: { ativo: false } });
    await prisma().tipoAtividade.update({ where: { id: s.tipoSem.id }, data: { ativo: false } });
    const casos = [
      [{ data_operacional: '2027-06-16' }, 422],
      [{ area_id: 'nao-existe' }, 422],
      [{ area_id: s.area2.id }, 422],
      [{ area_id: inativa.id }, 422],
      [{ tipo_atividade_id: 'nao-existe' }, 422],
      [{ tipo_atividade_id: s.tipoSem.id }, 422],
      [{ cliente_id: 'x' }, 400],
      [{ atividade_area_id: 'x' }, 400],
      [{ area_executada_dia: 7 }, 400],
    ];
    for (const [extra, status] of casos) {
      const r = await s.registrar(extra);
      assert.equal(r.statusCode, status, `${JSON.stringify(extra)} ${r.body}`);
    }
    const sem = await s.H.req('POST', '/atividades/registrar', s.token, { empresa_id: s.e1.id, area_id: s.area1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10' });
    assert.equal(sem.statusCode, 400, sem.body);
    assert.equal((await s.atividades()).length, 0);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), 0);
  });

  test('linha recusada (estoque insuficiente) desfaz tudo: nem a atividade nasce', async () => {
    const s = await montar();
    const r = await s.registrar({ produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '9999' }] });
    assert.ok(r.statusCode >= 400, r.body);
    assert.equal((await s.atividades()).length, 0);
  });

  test('permissão: só quem lança apontamento registra (403 sem a ação, com visualizar sozinho ou sem a tela); outro tenant não enxerga a área (422)', async () => {
    const s = await montar();
    const lanca = await s.contaTela({ lancar_apontamento: true });
    assert.equal((await s.registrar({}, lanca.token)).statusCode, 201);
    for (const conta of [await s.contaTela({}), await s.conta(null)]) {
      assert.deepEqual(erro(await s.registrar({}, conta.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    }
    const outro = await montarLinhasCusto(app);
    const r = await s.H.req('POST', '/atividades/registrar', outro.token, {
      empresa_id: outro.e1.id, area_id: s.area1.id, tipo_atividade_id: outro.tipo.id, data_operacional: '2027-06-10', operation_id: opId('reg'),
    });
    assert.equal(r.statusCode, 422, r.body);
  });
});

describe('leituras por área', () => {
  const resumo = (s, area = s.area1, tok = s.token) => s.H.req('GET', `/atividades-por-area/${area.id}/resumo?empresa_id=${s.e1.id}`, tok);
  const registros = (s, qs = '', area = s.area1, tok = s.token) => s.H.req('GET', `/atividades-por-area/${area.id}/registros?empresa_id=${s.e1.id}${qs}`, tok);

  test('resumo: atividades da área (ABERTAS primeiro, sem canceladas), feito/planejado e custos do mês somando as linhas', async () => {
    const s = await montar();
    const r1 = await s.ok({
      area_executada_dia: '4',
      mao_obra: [{ parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '2' }],
      servicos: [{ servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '150' }],
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }],
    });
    await s.ok({ tipo_atividade_id: s.tipoSem.id, area_executada_dia: '1' });
    const canc = await s.ok({ data_operacional: '2027-05-05', tipo_atividade_id: s.tipoSem.id });
    await s.cancelarAt(canc.registro.atividade_id);
    const j = (await resumo(s)).json();
    assert.deepEqual([j.area_id, j.mes], [s.area1.id, '2027-06']);
    assert.equal(j.atividades.length, 2);
    const doTipo = j.atividades.find((a) => a.atividade_id === r1.registro.atividade_id);
    assert.deepEqual(
      [doTipo.status, doTipo.area_status, doTipo.area_planejada, doTipo.area_executada, doTipo.data_inicio, doTipo.tipo_atividade_nome],
      ['ABERTA', 'EM_ANDAMENTO', '10.0000', '4.0000', '2027-06-10', s.tipo.nome_tipo]
    );
    // insumos: 5 L × R$ 5,00 = 25; serviço 2 × 150 = 300; mão de obra 2 h × 25,50 = 51.
    assert.deepEqual(j.custos, {
      custo_total: '376.00', custo_por_ha: '37.60', area_ha: '10.0000', insumos: '25.00', maquinas: '0.00', mao_obra: '51.00', servicos: '300.00',
    });
  });

  test('resumo: mês anterior fica fora dos custos; área sem registro → zeros; área de outra fazenda e outro tenant → 404', async () => {
    const s = await montar();
    await s.ok({ data_operacional: '2027-05-20', servicos: [{ servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '100' }] });
    const j = (await resumo(s)).json();
    assert.equal(j.custos.custo_total, '0.00');
    assert.equal(j.atividades.length, 1); // aberta, iniciada em maio
    const vazia = await s.novaArea('PASTO 09');
    assert.deepEqual((await resumo(s, vazia)).json().atividades, []);
    assert.equal((await resumo(s, s.area2)).statusCode, 404);
    const outro = await montarLinhasCusto(app);
    assert.equal((await s.H.req('GET', `/atividades-por-area/${s.area1.id}/resumo?empresa_id=${outro.e1.id}`, outro.token)).statusCode, 404);
    assert.equal((await s.H.req('GET', `/atividades-por-area/${s.area1.id}/registros?empresa_id=${outro.e1.id}`, outro.token)).statusCode, 404);
  });

  test('registros: confirmados da área, mais recentes primeiro, com as linhas; cancelado e outra área ficam fora; filtro por tipo', async () => {
    const s = await montar();
    const outraArea = await s.novaArea('PASTO 02');
    await s.ok({ data_operacional: '2027-06-05', operador_usuario_id: s.adm.usuario.id, area_executada_dia: '5', mao_obra: [{ parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '4' }] });
    const novo = await s.ok({ data_operacional: '2027-06-12', produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }], servicos: [{ servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '150' }] });
    await s.ok({ area_id: outraArea.id });
    const cancelado = await s.ok({ data_operacional: '2027-06-13' });
    await s.cancelarAp(cancelado.registro.atividade_id, cancelado.apontamento);
    await s.ok({ data_operacional: '2027-06-14', tipo_atividade_id: s.tipoSem.id });
    const j = (await registros(s)).json();
    assert.deepEqual(j.items.map((i) => i.data_operacional), ['2027-06-14', '2027-06-12', '2027-06-05']);
    assert.equal(j.next_cursor, null);
    const doDia12 = j.items[1];
    assert.deepEqual([doDia12.id, doDia12.atividade_id, doDia12.tipo_atividade_nome, doDia12.operador_nome], [novo.apontamento.id, novo.registro.atividade_id, s.tipo.nome_tipo, null]);
    assert.deepEqual(doDia12.produtos, [{ produto_nome: 'Herbicida (L)', quantidade: '5.0000', unidade: 'L', dose_ha: doDia12.produtos[0].dose_ha }]);
    assert.deepEqual(doDia12.servicos, [{ nome: 'Gradagem terceirizada', quantidade: '2.0000', unidade: 'ha', valor: '300.0000' }]);
    const antigo = j.items[2];
    assert.deepEqual([antigo.operador_nome, antigo.area_executada_dia, antigo.mao_obra], [s.adm.usuario.nome, '5.0000', [{ nome: 'João Diarista', quantidade: '4.0000', medida: 'HORA' }]]);
    const filtrado = (await registros(s, `&tipo_atividade_id=${s.tipoSem.id}`)).json();
    assert.deepEqual(filtrado.items.map((i) => i.data_operacional), ['2027-06-14']);
  });

  test('registros: paginação por cursor (sem repetir nem pular, inclusive no mesmo dia) e cursor adulterado → 400', async () => {
    const s = await montar();
    for (const d of ['2027-06-03', '2027-06-03', '2027-06-04', '2027-06-05', '2027-06-05']) await s.ok({ data_operacional: d });
    const vistos = [];
    let cursor = null;
    for (let i = 0; i < 5; i += 1) {
      const j = (await registros(s, `&limit=2${cursor ? `&cursor=${cursor}` : ''}`)).json();
      vistos.push(...j.items.map((x) => x.id));
      cursor = j.next_cursor;
      if (!cursor) break;
    }
    assert.equal(vistos.length, 5);
    assert.equal(new Set(vistos).size, 5);
    assert.equal((await registros(s, '&cursor=lixo')).statusCode, 400);
    assert.equal((await registros(s, '&limit=51')).statusCode, 400);
  });

  test('permissão: ver = visualizar da tela (403 sem ela)', async () => {
    const s = await montar();
    const ver = await s.contaTela({});
    assert.equal((await resumo(s, s.area1, ver.token)).statusCode, 200);
    assert.equal((await registros(s, '', s.area1, ver.token)).statusCode, 200);
    const sem = await s.conta(null);
    assert.equal((await resumo(s, s.area1, sem.token)).statusCode, 403);
    assert.equal((await registros(s, '', s.area1, sem.token)).statusCode, 403);
  });
});
