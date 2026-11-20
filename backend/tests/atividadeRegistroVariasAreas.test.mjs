/**
 * D-PROD-263 — REGISTRO DE CAMPO DE VÁRIAS ÁREAS (`POST /atividades/registrar` com `areas: [{ area_id, hectares }]`),
 * contra PostgreSQL real e HTTP autenticado.
 *
 * Cobre: N áreas → UMA atividade e N apontamentos (hectares de cada área); o nome `<Tipo> · <Área 1> +N · <mmm/aa>`;
 * o rateio exato do insumo (resto na última área) com a baixa de estoque de cada parte; os trechos SEGUIDOS do medidor
 * (a série continua válida para o registro seguinte; várias passadas do mesmo bem; inicial vigente quando o corpo não a
 * traz); mão de obra e serviço repartidos; a parte que arredonda para zero; entrar numa atividade aberta que tem parte
 * das áreas (as outras entram; a PLANEJADA é iniciada); `areas` de um item = o `area_id` de sempre (até o recibo);
 * idempotência; a recusa com `area_indice` e a linha na posição do corpo; área CONCLUIDA na atividade achada; tenant; e
 * o corpo fechado. Mais a conta pura do rateio (`atividadeRegistroRateio.js`).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { partesPorHectares, trechosDoMedidor } from '../src/modules/atividades/atividadeRegistroRateio.js';

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
  const novaArea = (nome, tamanho = '10') =>
    p.areaPastagem.create({
      data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: tamanho },
    });
  const aroeira = await novaArea('PASTO DA AROEIRA', '38');
  const acude = await novaArea('PASTO DO AÇUDE', '27.3');
  const base = { empresa_id: s.e1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10' };
  const registrar = (corpo = {}, tok = s.token) => s.H.req('POST', '/atividades/registrar', tok, { ...base, operation_id: opId('reg'), ...corpo });
  const ok = async (corpo, tok) => {
    const r = await registrar(corpo, tok);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const atividades = () => p.atividade.findMany({ where: { cliente_id: s.c, id: { not: s.atividade.id } }, orderBy: { createdAt: 'asc' } });
  const apontamentosDe = (atividadeId) =>
    p.atividadeApontamento.findMany({
      where: { atividade_id: atividadeId },
      include: { atividadeArea: true, produtos: { orderBy: { ordem: 'asc' } }, maquinas: { orderBy: { ordem: 'asc' } }, maoObras: { orderBy: { ordem: 'asc' } }, servicos: { orderBy: { ordem: 'asc' } } },
      orderBy: [{ sequencia: 'asc' }],
    });
  /** Os apontamentos na ordem das áreas do corpo. */
  const porArea = async (r) => {
    const aps = await apontamentosDe(r.registro.atividade_id);
    return r.registro.areas.map((a) => aps.find((x) => x.id === a.apontamento_id));
  };
  const nada = async () => {
    assert.equal((await atividades()).length, 0);
    assert.equal(await p.atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: { not: s.atividade.id } } }), 0);
  };
  return { ...s, novaArea, aroeira, acude, registrar, ok, atividades, apontamentosDe, porArea, nada };
};

const t4 = (v) => (v === null || v === undefined ? null : Number(v).toFixed(4));

describe('várias áreas num registro só', () => {
  test('3 áreas → UMA atividade "<Tipo> · <Área 1> +2 · jun/27", 3 apontamentos com os hectares de cada área, todas EM_ANDAMENTO desde o dia', async () => {
    const s = await montar();
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '38' }, { area_id: s.acude.id, hectares: '16.38' }, { area_id: s.area1.id, hectares: '5' }],
      operador_usuario_id: s.adm.usuario.id, observacao: 'gradeou', turno: 'MANHA',
    });
    const [a] = await s.atividades();
    assert.equal((await s.atividades()).length, 1);
    assert.equal(a.nome, `${s.tipo.nome_tipo} · PASTO DA AROEIRA +2 · jun/27`);
    assert.deepEqual([r.registro.atividade_criada, r.registro.atividade_id, r.registro.atividade_nome], [true, a.id, a.nome]);
    assert.equal(r.apontamentos.length, 3);
    assert.equal(r.apontamento.id, r.apontamentos[0].id);
    assert.equal(r.atividade.id, a.id);
    assert.equal(r.atividade.area_executada, '59.3800');
    const aps = await s.porArea(r);
    assert.deepEqual(aps.map((x) => t4(x.area_executada_dia)), ['38.0000', '16.3800', '5.0000']);
    assert.deepEqual(r.registro.areas.map((x) => x.hectares), ['38.0000', '16.3800', '5.0000']);
    for (const ap of aps) {
      assert.deepEqual([ap.operador_usuario_id, ap.observacao, ap.turno, ap.status], [s.adm.usuario.id, 'gradeou', 'MANHA', 'CONFIRMADO']);
    }
    const areas = await prisma().atividadeArea.findMany({ where: { atividade_id: a.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(areas.map((x) => x.area_id), [s.aroeira.id, s.acude.id, s.area1.id]);
    assert.deepEqual(areas.map((x) => [x.status, x.data_inicio.toISOString().slice(0, 10), x.area_planejada.toFixed(4)]), [
      ['EM_ANDAMENTO', '2027-06-10', '38.0000'],
      ['EM_ANDAMENTO', '2027-06-10', '27.3000'],
      ['EM_ANDAMENTO', '2027-06-10', '10.0000'],
    ]);
    assert.deepEqual(aps.map((x) => x.atividade_area_id), areas.map((x) => x.id));
    assert.equal(a.area_id, s.aroeira.id);
    assert.equal(a.area_planejada.toFixed(4), '75.3000');
  });

  test('insumo: a quantidade é repartida pelos hectares com 4 casas, a última área leva o resto (soma exata) e cada parte baixa o estoque', async () => {
    const s = await montar();
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }, { area_id: s.area1.id, hectares: '1' }],
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '10' }],
    });
    const aps = await s.porArea(r);
    const linhas = aps.map((x) => x.produtos[0]);
    assert.deepEqual(linhas.map((l) => l.quantidade.toFixed(4)), ['3.3333', '3.3333', '3.3334']);
    assert.ok(linhas.every((l) => l.produto_id === s.herbicida.id && l.local_estoque_id === s.local.id && l.status === 'CONFIRMADO'));
    // dose/ha de cada área = a parte ÷ os hectares dela
    assert.deepEqual(linhas.map((l) => l.dose_ha.toFixed(4)), ['3.3333', '3.3333', '3.3334']);
    // custo FIFO do motor (R$ 5,00 o litro) em cada parte; um movimento por parte
    assert.deepEqual(linhas.map((l) => Number(l.custo_total).toFixed(2)), ['16.67', '16.67', '16.67']);
    assert.equal(new Set(linhas.map((l) => l.movimentacao_estoque_id)).size, 3);
    const movs = await prisma().movimentacaoEstoque.findMany({ where: { id: { in: linhas.map((l) => l.movimentacao_estoque_id) } } });
    assert.equal(movs.length, 3);
    const produto = await prisma().produto.findUnique({ where: { id: s.herbicida.id } });
    assert.equal(produto.estoque_atual.toFixed(4), '90.0000');
    // as chaves derivadas: a 1ª área usa a do corpo, as outras `:a2`, `:a3`
    const op = (await prisma().atividadeApontamentoProduto.findMany({ where: { id: { in: linhas.map((l) => l.id) } } })).map((l) => l.operation_id).sort();
    assert.equal(op.length, 3);
    assert.ok(op.some((k) => /:a2:p1$/.test(k)) && op.some((k) => /:a3:p1$/.test(k)) && op.some((k) => /^reg-[^:]+:p1$/.test(k)), op.join(' '));
  });

  test('máquina com medidor: o intervalo vira trechos SEGUIDOS na ordem das áreas, e a série segue válida para o registro seguinte', async () => {
    const s = await montar();
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '6' }, { area_id: s.acude.id, hectares: '4' }],
      maquinas: [{ bem_id: s.trator.id, leitura_inicial: '1530', leitura_final: '1540', observacao: 'grade 28 discos' }],
    });
    const aps = await s.porArea(r);
    const [m1, m2] = aps.map((x) => x.maquinas[0]);
    assert.deepEqual([m1.leitura_inicial.toFixed(4), m1.leitura_final.toFixed(4), m1.quantidade_uso.toFixed(4)], ['1530.0000', '1536.0000', '6.0000']);
    assert.deepEqual([m2.leitura_inicial.toFixed(4), m2.leitura_final.toFixed(4), m2.quantidade_uso.toFixed(4)], ['1536.0000', '1540.0000', '4.0000']);
    assert.deepEqual([m1.observacao, m2.observacao], ['grade 28 discos', 'grade 28 discos']);
    // o próximo registro do dia começa na final (a vigente), e abaixo dela é recusado
    const med = await s.H.ok(s.H.req('GET', `/atividades-opcoes/medidor?empresa_id=${s.e1.id}&bem_id=${s.trator.id}&data=2027-06-10`, s.token));
    assert.equal(med.leitura_sugerida, '1540.0000');
    const seguinte = await s.ok({ area_id: s.area1.id, maquinas: [{ bem_id: s.trator.id, leitura_final: '1545' }] });
    assert.equal(seguinte.apontamento.maquinas[0].leitura_inicial, '1540.0000');
    const abaixo = await s.registrar({ area_id: s.area1.id, maquinas: [{ bem_id: s.trator.id, leitura_inicial: '1538', leitura_final: '1550' }] });
    assert.deepEqual(erro(abaixo), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_inicial', 'abaixo_da_vigente']);
  });

  test('máquina com medidor: sem leitura inicial no corpo, os trechos começam na vigente; duas passadas do mesmo bem viram uma série só', async () => {
    const s = await montar();
    // a vigente é a do cadastro (1.520,5 h)
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }],
      maquinas: [{ bem_id: s.trator.id, leitura_final: '1530.5' }],
    });
    const [m1, m2] = (await s.porArea(r)).map((x) => x.maquinas[0]);
    assert.deepEqual([m1.leitura_inicial, m1.leitura_final, m2.leitura_inicial, m2.leitura_final].map((v) => v.toFixed(4)), ['1520.5000', '1525.5000', '1525.5000', '1530.5000']);
    // duas passadas no dia (a 2ª começa onde a 1ª terminou), 6 ha × 4 ha: 20 h no total → 12 h na 1ª área, 8 h na 2ª
    const r2 = await s.ok({
      data_operacional: '2027-06-11',
      areas: [{ area_id: s.aroeira.id, hectares: '6' }, { area_id: s.acude.id, hectares: '4' }],
      maquinas: [
        { bem_id: s.trator.id, leitura_inicial: '1530.5', leitura_final: '1540.5' },
        { bem_id: s.gerador.id, sem_medidor: true, quantidade_uso: '5' },
        { bem_id: s.trator.id, leitura_final: '1550.5' },
      ],
    });
    const [a1, a2] = await s.porArea(r2);
    const leituras = (ap) => ap.maquinas.filter((m) => m.bem_id === s.trator.id).map((m) => [m.leitura_inicial.toFixed(4), m.leitura_final.toFixed(4)]);
    assert.deepEqual(leituras(a1), [['1530.5000', '1540.5000'], ['1540.5000', '1542.5000']]);
    assert.deepEqual(leituras(a2), [['1542.5000', '1550.5000']]);
    // o gerador (sem medidor): o uso repartido, 3 h e 2 h
    const usoGerador = (ap) => ap.maquinas.filter((m) => m.bem_id === s.gerador.id).map((m) => m.quantidade_uso.toFixed(4));
    assert.deepEqual([usoGerador(a1), usoGerador(a2)], [['3.0000'], ['2.0000']]);
    // a ordem do corpo dentro de cada área (trator, gerador, trator)
    assert.deepEqual(a1.maquinas.map((m) => m.bem_id), [s.trator.id, s.gerador.id, s.trator.id]);
  });

  test('mão de obra e serviço: a quantidade é repartida, o custo unitário fica e o total segue a regra de sempre', async () => {
    const s = await montar();
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '2' }, { area_id: s.acude.id, hectares: '1' }],
      mao_obra: [{ parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '6.5' }],
      servicos: [{ servico_id: s.gradagem.id, quantidade: '3', valor_unitario: '150' }],
    });
    const [a1, a2] = await s.porArea(r);
    const mo = [a1.maoObras[0], a2.maoObras[0]];
    assert.deepEqual(mo.map((l) => l.quantidade.toFixed(4)), ['4.3333', '2.1667']);
    assert.deepEqual(mo.map((l) => l.custo_unitario.toFixed(4)), ['25.5000', '25.5000']);
    assert.deepEqual(mo.map((l) => l.custo_total.toFixed(4)), ['110.4992', '55.2509']);
    const sv = [a1.servicos[0], a2.servicos[0]];
    assert.deepEqual(sv.map((l) => [l.quantidade.toFixed(4), l.valor_unitario.toFixed(4), l.valor_total.toFixed(4)]), [
      ['2.0000', '150.0000', '300.0000'],
      ['1.0000', '150.0000', '150.0000'],
    ]);
    // soma exata das quantidades
    assert.equal((Number(mo[0].quantidade) + Number(mo[1].quantidade)).toFixed(4), '6.5000');
  });

  test('a parte que arredonda para zero não vira linha: sai daquela área e vai para a de mais hectares', async () => {
    const s = await montar();
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '3' }],
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '0.0001' }],
      servicos: [{ servico_id: s.gradagem.id, quantidade: '0.0001', valor_unitario: '150' }],
    });
    const [a1, a2] = await s.porArea(r);
    assert.deepEqual([a1.produtos.length, a2.produtos.length], [0, 1]);
    assert.equal(a2.produtos[0].quantidade.toFixed(4), '0.0001');
    assert.deepEqual([a1.servicos.length, a2.servicos.length], [0, 1]);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.herbicida.id } })).estoque_atual.toFixed(4), '99.9999');
    assert.equal(await prisma().atividadeApontamentoProduto.count({ where: { cliente_id: s.c, quantidade: 0 } }), 0);
  });

  test('entra na atividade aberta que já tem parte das áreas: a que falta entra EM_ANDAMENTO no dia e a PLANEJADA é iniciada', async () => {
    const s = await montar();
    const aberta = await s.abrir({ areas: [{ area_id: s.acude.id }], data_inicio: '2027-06-01' });
    const r = await s.ok({ areas: [{ area_id: s.aroeira.id, hectares: '38' }, { area_id: s.acude.id, hectares: '20' }] });
    assert.deepEqual([r.registro.atividade_criada, r.registro.atividade_id], [false, aberta.id]);
    assert.deepEqual(r.registro.areas.map((a) => [a.area_adicionada, a.area_iniciada]), [[true, true], [false, true]]);
    const areas = await prisma().atividadeArea.findMany({ where: { atividade_id: aberta.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(areas.map((a) => [a.area_id, a.status, a.data_inicio.toISOString().slice(0, 10), a.area_planejada.toFixed(4)]), [
      [s.acude.id, 'EM_ANDAMENTO', '2027-06-10', '27.3000'],
      [s.aroeira.id, 'EM_ANDAMENTO', '2027-06-10', '38.0000'],
    ]);
    assert.equal((await s.atividades()).filter((a) => a.id !== aberta.id).length, 0);
    assert.equal((await s.apontamentosDe(aberta.id)).length, 2);
    // o cabeçalho acompanha (Σ das planejadas)
    assert.equal((await prisma().atividade.findUnique({ where: { id: aberta.id } })).area_planejada.toFixed(4), '65.3000');
  });

  test('área CONCLUIDA na atividade achada: 409 da regra do lançamento, com a área (area_indice); nada gravado', async () => {
    const s = await montar();
    const aberta = await s.abrir({ areas: [{ area_id: s.aroeira.id }, { area_id: s.acude.id }], data_inicio: '2027-06-01' });
    await prisma().atividadeArea.updateMany({
      where: { atividade_id: aberta.id, area_id: s.acude.id },
      data: { status: 'CONCLUIDA', data_inicio: new Date('2027-06-01'), data_conclusao: new Date('2027-06-02') },
    });
    const r = await s.registrar({ areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }] });
    assert.equal(r.statusCode, 409, r.body);
    const j = r.json();
    assert.deepEqual([j.code, j.details.entidade, j.details.area_id, j.details.area_indice], ['ATIVIDADE_STATUS_INVALIDO', 'area', s.acude.id, 1]);
    assert.equal((await s.apontamentosDe(aberta.id)).length, 0);
    assert.equal((await prisma().atividadeArea.findFirst({ where: { atividade_id: aberta.id, area_id: s.aroeira.id } })).status, 'PLANEJADA');
  });

  test('`areas` de um item é o `area_id` de sempre: mesma atividade, mesmo nome, os hectares no apontamento e o MESMO recibo', async () => {
    const s = await montar();
    const operation_id = opId('um');
    const legado = await s.registrar({ operation_id, area_id: s.aroeira.id, area_executada_dia: '7' });
    assert.equal(legado.statusCode, 201, legado.body);
    // o mesmo registro em `areas[]` com a mesma chave é o mesmo corpo: replay
    const novo = await s.registrar({ operation_id, areas: [{ area_id: s.aroeira.id, hectares: '7' }] });
    assert.equal(novo.statusCode, 200, novo.body);
    assert.equal(novo.json().replay, true);
    assert.equal(novo.json().apontamento.id, legado.json().apontamento.id);
    // e, com chave nova, entra na mesma atividade (o casamento de sempre)
    const outro = await s.ok({ areas: [{ area_id: s.aroeira.id, hectares: '3' }], data_operacional: '2027-06-11' });
    assert.deepEqual([outro.registro.atividade_criada, outro.registro.atividade_id], [false, legado.json().registro.atividade_id]);
    assert.equal(outro.apontamento.area_executada_dia, '3.0000');
    const [a] = await s.atividades();
    assert.equal(a.nome, `${s.tipo.nome_tipo} · PASTO DA AROEIRA · jun/27`);
    assert.equal((await s.apontamentosDe(a.id)).length, 2);
  });

  test('a corrida: dois registros paralelos com as MESMAS áreas em ordem inversa → sem deadlock, UMA atividade e 4 apontamentos', async () => {
    const s = await montar();
    const [a, b] = await Promise.all([
      s.registrar({ areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }] }),
      s.registrar({ areas: [{ area_id: s.acude.id, hectares: '2' }, { area_id: s.aroeira.id, hectares: '2' }], data_operacional: '2027-06-11' }),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201], `${a.body} ${b.body}`);
    assert.equal(a.json().registro.atividade_id, b.json().registro.atividade_id);
    assert.equal((await s.atividades()).length, 1);
    assert.equal((await s.apontamentosDe(a.json().registro.atividade_id)).length, 4);
    assert.equal(await prisma().atividadeArea.count({ where: { atividade_id: a.json().registro.atividade_id } }), 2);
  });

  test('histórico e resumo por área: cada área mostra o SEU registro (os hectares e a parte do insumo dela)', async () => {
    const s = await montar();
    const r = await s.ok({
      areas: [{ area_id: s.aroeira.id, hectares: '6' }, { area_id: s.acude.id, hectares: '4' }],
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }],
    });
    const registrosDe = async (area) => (await s.H.ok(s.H.req('GET', `/atividades-por-area/${area.id}/registros?empresa_id=${s.e1.id}`, s.token))).items;
    const [daAroeira] = await registrosDe(s.aroeira);
    const [doAcude] = await registrosDe(s.acude);
    assert.deepEqual([daAroeira.id, daAroeira.area_executada_dia, daAroeira.produtos[0].quantidade], [r.apontamentos[0].id, '6.0000', '3.0000']);
    assert.deepEqual([doAcude.id, doAcude.area_executada_dia, doAcude.produtos[0].quantidade], [r.apontamentos[1].id, '4.0000', '2.0000']);
    assert.equal(daAroeira.atividade_id, doAcude.atividade_id);
    for (const area of [s.aroeira, s.acude]) {
      const resumo = await s.H.ok(s.H.req('GET', `/atividades-por-area/${area.id}/resumo?empresa_id=${s.e1.id}`, s.token));
      assert.deepEqual(resumo.atividades.map((a) => [a.atividade_id, a.area_status]), [[r.registro.atividade_id, 'EM_ANDAMENTO']]);
    }
  });

  test('idempotência: reenvio igual → 200 replay com os mesmos apontamentos (nada novo); corpo diferente → 409', async () => {
    const s = await montar();
    const operation_id = opId('idem');
    const corpo = {
      operation_id,
      areas: [{ area_id: s.aroeira.id, hectares: '6' }, { area_id: s.acude.id, hectares: '4' }],
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }],
      maquinas: [{ bem_id: s.trator.id, leitura_inicial: '1530', leitura_final: '1540' }],
    };
    const um = await s.registrar(corpo);
    assert.equal(um.statusCode, 201, um.body);
    const dois = await s.registrar(corpo);
    assert.equal(dois.statusCode, 200, dois.body);
    assert.equal(dois.json().replay, true);
    assert.deepEqual(dois.json().apontamentos.map((a) => a.id), um.json().apontamentos.map((a) => a.id));
    const diferente = await s.registrar({ ...corpo, areas: [{ area_id: s.aroeira.id, hectares: '5' }, { area_id: s.acude.id, hectares: '4' }] });
    assert.deepEqual(erro(diferente).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal((await s.atividades()).length, 1);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: { not: s.atividade.id } } }), 2);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.herbicida.id } })).estoque_atual.toFixed(4), '95.0000');
  });

  test('a recusa de uma área diz qual (area_id, area_indice) e aponta a linha na posição do CORPO; nada gravado', async () => {
    const s = await montar();
    // Insumo 0 (0,0001) só vai para a 1ª área; o insumo 1 (120 L) dá 90 L na 1ª (sobram 10) e 30 L na 2ª: falta saldo.
    const r = await s.registrar({
      areas: [{ area_id: s.aroeira.id, hectares: '3' }, { area_id: s.acude.id, hectares: '1' }],
      produtos: [
        { produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '0.0001' },
        { produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '120' },
      ],
    });
    assert.equal(r.statusCode, 422, r.body);
    const j = r.json();
    assert.equal(j.code, 'ESTOQUE_SALDO_INSUFICIENTE');
    assert.deepEqual([j.details.area_id, j.details.area_indice, j.details.colecao, j.details.indice], [s.acude.id, 1, 'produtos', 1]);
    await s.nada();
    assert.equal((await prisma().produto.findUnique({ where: { id: s.herbicida.id } })).estoque_atual.toFixed(4), '100.0000');
    // a máquina: a linha 1 do corpo (uso zero: vai inteira para a 1ª área) recusa ali, com linha_indice 1
    const m = await s.registrar({
      areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }],
      maquinas: [
        { bem_id: s.gerador.id, sem_medidor: true, quantidade_uso: '2' },
        { bem_id: s.gerador.id, sem_medidor: true, quantidade_uso: '0' },
      ],
    });
    assert.equal(m.statusCode, 422, m.body);
    const jm = m.json();
    assert.deepEqual([jm.code, jm.field, jm.reason, jm.details.linha_indice, jm.details.area_indice], ['ATIVIDADE_LINHA_INVALIDA', 'quantidade_uso', 'nao_positiva', 1, 0]);
    // área do mapa recusada: o campo e a área
    const outraFazenda = await s.registrar({ areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.area2.id, hectares: '1' }] });
    assert.equal(outraFazenda.statusCode, 422, outraFazenda.body);
    assert.deepEqual([outraFazenda.json().field, outraFazenda.json().reason, outraFazenda.json().details.area_indice], ['areas[1].area_id', 'outra_empresa', 1]);
    await s.nada();
  });

  test('tenant: a área de outro tenant é inexistente (422, nada gravado); o tenant nunca vem do corpo', async () => {
    const s = await montar();
    const outro = await montarLinhasCusto(app);
    const r = await s.H.req('POST', '/atividades/registrar', outro.token, {
      empresa_id: outro.e1.id, tipo_atividade_id: outro.tipo.id, data_operacional: '2027-06-10', operation_id: opId('reg'),
      areas: [{ area_id: outro.area1.id, hectares: '1' }, { area_id: s.aroeira.id, hectares: '1' }],
    });
    assert.equal(r.statusCode, 422, r.body);
    assert.deepEqual([r.json().field, r.json().reason, r.json().details.area_indice], ['areas[1].area_id', 'inexistente', 1]);
    assert.equal(await prisma().atividade.count({ where: { cliente_id: outro.c, id: { not: outro.atividade.id } } }), 0);
    const comCliente = await s.registrar({ cliente_id: outro.c, areas: [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }] });
    assert.equal(comCliente.statusCode, 400, comCliente.body);
    await s.nada();
  });

  test('corpo fechado: area_id e areas juntos, nenhum dos dois, areas com area_executada_dia, campo a mais, hectares número, zero ou ausente, área repetida e 21 áreas → recusados; nada gravado', async () => {
    const s = await montar();
    const duas = [{ area_id: s.aroeira.id, hectares: '1' }, { area_id: s.acude.id, hectares: '1' }];
    const muitas = await Promise.all(Array.from({ length: 21 }, (_, i) => s.novaArea(`P${i}`)));
    const casos = [
      [{ area_id: s.aroeira.id, areas: duas }, 400, 'areas_e_area_id'],
      [{}, 400, 'obrigatorio'],
      [{ areas: duas, area_executada_dia: '2' }, 400, 'com_areas'],
      [{ areas: [{ ...duas[0], atividade_area_id: 'x' }, duas[1]] }, 400, null],
      [{ areas: [{ area_id: s.aroeira.id, hectares: 1 }, duas[1]] }, 400, 'valor_deve_ser_texto'],
      [{ areas: [{ area_id: s.aroeira.id, hectares: '0' }, duas[1]] }, 400, 'nao_positivo'],
      [{ areas: [{ area_id: s.aroeira.id }, duas[1]] }, 400, null],
      [{ areas: [{ area_id: s.aroeira.id, hectares: '-1' }, duas[1]] }, 400, null],
      [{ areas: [] }, 400, null],
      [{ areas: [duas[0], { area_id: s.aroeira.id, hectares: '2' }] }, 422, 'duplicada'],
      [{ areas: muitas.map((a) => ({ area_id: a.id, hectares: '1' })) }, 400, null],
    ];
    for (const [extra, status, reason] of casos) {
      const r = await s.registrar(extra);
      assert.equal(r.statusCode, status, `${JSON.stringify(extra).slice(0, 120)} ${r.body}`);
      if (reason) assert.equal(r.json().reason, reason, r.body);
    }
    await s.nada();
  });
});

describe('a conta do rateio (pura)', () => {
  test('partes pelos hectares: 4 casas, resto na última, soma exata; zero sai e vai para a de mais hectares; total zero vai inteiro para a maior', () => {
    assert.deepEqual(partesPorHectares('10', ['1', '1', '1']), ['3.3333', '3.3333', '3.3334']);
    assert.deepEqual(partesPorHectares('100', ['38', '16.38']), ['69.8786', '30.1214']);
    assert.deepEqual(partesPorHectares('0.0001', ['1', '3']), [null, '0.0001']);
    assert.deepEqual(partesPorHectares('0.0001', ['3', '1']), ['0.0001', null]);
    // o resto negativo (4 áreas iguais, 0,0002): as três primeiras arredondam para cima; o resto vai para a maior
    const quatro = partesPorHectares('0.0002', ['1', '1', '1', '1']);
    assert.equal(quatro.filter((p) => p !== null).reduce((t, p) => t + Number(p), 0).toFixed(4), '0.0002');
    assert.ok(quatro.every((p) => p === null || Number(p) > 0), JSON.stringify(quatro));
    assert.deepEqual(partesPorHectares('0', ['1', '5', '2']), [null, '0.0000', null]);
    assert.deepEqual(partesPorHectares('7', ['2']), ['7.0000']);
    // muitas áreas: soma sempre exata e nenhuma parte zerada
    for (const total of ['1', '0.0013', '123.4567', '9999999999.9999']) {
      const h = ['0.3', '17', '2.5', '0.0001', '40', '1'];
      const partes = partesPorHectares(total, h).filter((p) => p !== null);
      const somaQ = partes.reduce((t, p) => t + BigInt(p.replace('.', '')), 0n);
      assert.equal(somaQ, BigInt(Number(total).toFixed(4).replace('.', '')), `${total}: ${partes}`);
      assert.ok(partes.every((p) => Number(p) > 0));
    }
  });

  test('trechos do medidor: seguidos, na ordem das áreas, a última termina na final; a série de várias passadas é uma só', () => {
    assert.deepEqual(trechosDoMedidor([{ indice: 0, inicial: '1530', final: '1540' }], ['6', '4']), [
      [{ indice: 0, inicial: '1530.0000', final: '1536.0000' }],
      [{ indice: 0, inicial: '1536.0000', final: '1540.0000' }],
    ]);
    assert.deepEqual(trechosDoMedidor([{ indice: 0, inicial: '100', final: '100.0001' }], ['1', '3']), [[], [{ indice: 0, inicial: '100.0000', final: '100.0001' }]]);
    // duas passadas com um vão entre elas (110 → 115): cada área leva um trecho seguido da série
    assert.deepEqual(trechosDoMedidor([{ indice: 0, inicial: '100', final: '110' }, { indice: 2, inicial: '115', final: '120' }], ['1', '1']), [
      [{ indice: 0, inicial: '100.0000', final: '107.5000' }],
      [{ indice: 0, inicial: '107.5000', final: '110.0000' }, { indice: 2, inicial: '115.0000', final: '120.0000' }],
    ]);
    // medidor parado (uso zero): a linha inteira na área de mais hectares
    assert.deepEqual(trechosDoMedidor([{ indice: 0, inicial: '50', final: '50' }], ['1', '2']), [[], [{ indice: 0, inicial: '50.0000', final: '50.0000' }]]);
    // três áreas: emendam exatamente
    const t = trechosDoMedidor([{ indice: 0, inicial: '1520.5', final: '1530.5' }], ['1', '1', '1']).map((x) => x[0]);
    assert.deepEqual(t.map((x) => [x.inicial, x.final]), [['1520.5000', '1523.8333'], ['1523.8333', '1527.1666'], ['1527.1666', '1530.5000']]);
  });
});
