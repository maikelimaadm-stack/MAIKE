/**
 * D-PROD-238 — VÁRIAS ÁREAS POR ATIVIDADE, contra PostgreSQL real e HTTP autenticado (`app.inject`). Contrato:
 * docs/engineering/MAIKE-ATIVIDADE-AREAS-CONTRATO.md.
 *
 * O pedido do proprietário: "Eu tenho uma atividade que é combate contra cigarrinha, e nessa atividade são vários pastos
 * que vou fazendo ao decorrer do tempo [...] cada custo e lançamento é feito para aquela área." E o ciclo de cada área:
 * "abri uma atividade com 5 áreas — não vão aparecer as 5 áreas para mim como em andamento; eu vou escolher INICIAR a
 * área."
 *
 * Cobre: abrir com `areas[]` (todas PLANEJADAS, planejada padrão = o tamanho, a 1ª no `area_id` do cabeçalho, a soma na
 * `area_planejada`; repetida, de outra fazenda, inativa e `areas` + `area_id` recusam sem gravar nada); o cliente antigo
 * (`area_id` único: uma área já EM_ANDAMENTO, lança sem dizer a área); iniciar (data padrão hoje, nunca futura nem antes
 * do início da atividade), concluir, reabrir, editar a planejada, adicionar e remover (só a PLANEJADA sem lançamento;
 * nada com custo é apagado); o lançamento só em área EM_ANDAMENTO (dia e linha nova), a área obrigatória com várias, a
 * área de outra atividade recusada pelo serviço E pelo banco (FK composta); concluir a atividade conclui junto as áreas
 * em andamento (as planejadas ficam "não iniciadas") e reabrir desfaz; os totais por área (`por_area`) somam o total da
 * atividade; a lista (`areas_count` e o filtro por qualquer área); o PATCH antigo com várias áreas; tenant e fazenda.
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

/** Cenário das linhas de custo + 3 áreas a mais na fazenda 1 (tamanhos 10, 25,5 e 40 ha). */
const montar = async () => {
  const s = await montarLinhasCusto(app);
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const novaArea = (nome, tamanho, extra = {}) =>
    p.areaPastagem.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${nome}-${suf}`,
        nome, tamanho_hectares: tamanho, ...extra,
      },
    });
  const pasto2 = await novaArea('PASTO 02', '25.5');
  const pasto3 = await novaArea('PASTO 03', '40');
  const inativa = await novaArea('PASTO VELHO', '5', { ativo: false });
  const base = (a) => `/atividades/${a.id}/areas`;
  const areaReq = (a, metodo, sufixo, corpo, tok = s.token) => s.H.req(metodo, `${base(a)}${sufixo}`, tok, { empresa_id: a.empresa_id, ...corpo });
  const detalhe = (a, tok = s.token) => s.H.ok(s.H.req('GET', `/atividades/${a.id}?empresa_id=${a.empresa_id}`, tok));
  /** A área (da atividade) pelo id da área do mapa, relida do detalhe. */
  const areaDe = async (a, areaId) => (await detalhe(a)).areas.find((x) => x.area_id === areaId);
  const iniciar = async (a, areaId, data_inicio) => {
    const ar = await areaDe(a, areaId);
    return areaReq(a, 'POST', `/${ar.id}/iniciar`, { versao: ar.versao, ...(data_inicio ? { data_inicio } : {}) });
  };
  const abrirVarias = (areas, extra = {}) => s.abrir({ areas, ...extra });
  return { ...s, pasto2, pasto3, inativa, areaReq, detalhe, areaDe, iniciar, abrirVarias };
};

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** Prova de "nada gravado": atividades, áreas, apontamentos e sequências do tenant. */
const foto = async (c) => {
  const p = prisma();
  return JSON.stringify({
    at: await p.atividade.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    ar: await p.atividadeArea.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    ap: await p.atividadeApontamento.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    sq: await p.entidadeCodigoSequencia.findMany({ where: { cliente_id: c, entidade: 'Atividade' } }),
  }, replacer);
};

describe('abrir com várias áreas', () => {
  test('areas[]: todas PLANEJADAS, na ordem; planejada padrão = o tamanho (ou a informada); o cabeçalho fica com a 1ª área e a soma das planejadas', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id, area_planejada: '20' }, { area_id: s.pasto3.id }]);
    assert.equal(a.areas_count, 3);
    assert.deepEqual(a.areas.map((x) => [x.area_id, x.ordem, x.status, x.area_planejada, x.data_inicio, x.data_conclusao]), [
      [s.area1.id, 1, 'PLANEJADA', '10.0000', null, null],
      [s.pasto2.id, 2, 'PLANEJADA', '20.0000', null, null],
      [s.pasto3.id, 3, 'PLANEJADA', '40.0000', null, null],
    ]);
    assert.deepEqual(a.areas[1].area, { id: s.pasto2.id, numero_area: s.pasto2.numero_area, nome: 'PASTO 02', tamanho_hectares: '25.5000' });
    assert.deepEqual([a.area_id, a.setor_id, a.area_planejada], [s.area1.id, s.area1.setor_id, '70.0000']);
    const [ev] = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade.abrir', entidade_id: a.id } });
    assert.deepEqual(ev.dados_novos.areas, [s.area1.id, s.pasto2.id, s.pasto3.id]);
  });

  test('repetida, de outra fazenda, inativa, inexistente, areas vazio e areas + area_id recusam; nada gravado, nenhum número consumido', async () => {
    const s = await montar();
    const antes = await foto(s.c);
    for (const [corpo, esperado] of [
      [{ areas: [{ area_id: s.area1.id }, { area_id: s.area1.id }] }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'areas[1].area_id', 'duplicada']],
      [{ areas: [{ area_id: s.pasto2.id }, { area_id: s.area2.id }] }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'areas[1].area_id', 'outra_empresa']],
      [{ areas: [{ area_id: s.inativa.id }] }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'areas[0].area_id', 'inativo']],
      [{ areas: [{ area_id: 'nao-existe' }] }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'areas[0].area_id', 'inexistente']],
      [{ areas: [{ area_id: s.area1.id }], area_id: s.area1.id }, [400, 'VALIDATION_ERROR', 'areas', 'areas_e_area_id']],
    ]) {
      const r = await s.H.req('POST', '/atividades', s.token, { empresa_id: s.e1.id, nome: 'X', tipo_atividade_id: s.tipo.id, data_inicio: '2027-06-01', ...corpo });
      const e = erro(r);
      assert.deepEqual([e[0], e[2], e[3]], [esperado[0], esperado[2], esperado[3]], r.body);
      if (esperado[0] === 422) assert.equal(e[1], esperado[1]);
    }
    const vazio = await s.H.req('POST', '/atividades', s.token, { empresa_id: s.e1.id, nome: 'X', tipo_atividade_id: s.tipo.id, areas: [] });
    assert.equal(vazio.statusCode, 400);
    const numero = await s.H.req('POST', '/atividades', s.token, { empresa_id: s.e1.id, nome: 'X', tipo_atividade_id: s.tipo.id, areas: [{ area_id: s.area1.id, area_planejada: 5 }] });
    assert.equal(numero.statusCode, 400, 'a planejada só como texto');
    assert.equal(await foto(s.c), antes);
  });

  test('o cliente antigo (area_id único): uma área já EM_ANDAMENTO desde o início da atividade, e o lançamento sem dizer a área cai nela', async () => {
    const s = await montar();
    const a = await s.abrir({ area_id: s.pasto2.id, area_planejada: '12' });
    assert.deepEqual(a.areas.map((x) => [x.area_id, x.status, x.data_inicio, x.area_planejada]), [[s.pasto2.id, 'EM_ANDAMENTO', '2027-06-01', '12.0000']]);
    const ap = await s.apontar({}, { a });
    assert.equal(ap.atividade_area_id, a.areas[0].id);
    assert.deepEqual(ap.atividade_area, { id: a.areas[0].id, area: { id: s.pasto2.id, numero_area: s.pasto2.numero_area, nome: 'PASTO 02' } });
  });
});

describe('o ciclo da área e o lançamento', () => {
  test('lançar exige a área (com várias), recusa a PLANEJADA e a de outra atividade; iniciar (data padrão hoje, nunca futura nem antes do início da atividade) libera', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id }]);
    const outra = await s.abrirVarias([{ area_id: s.pasto3.id }]);
    const antes = await foto(s.c);
    assert.deepEqual(erro(await s.lancarAp({}, { a })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'atividade_area_id', 'obrigatorio']);
    const r = await s.lancarAp({ atividade_area_id: a.areas[0].id }, { a });
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual([r.json().code, r.json().details.entidade, r.json().details.acao, r.json().details.status], ['ATIVIDADE_STATUS_INVALIDO', 'area', 'lancar_na_area', 'PLANEJADA']);
    assert.match(r.json().message, /inicie a área/);
    assert.deepEqual(erro(await s.lancarAp({ atividade_area_id: outra.areas[0].id }, { a })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'atividade_area_id', 'inexistente']);
    // Iniciar: futura e antes do início da atividade recusam.
    assert.deepEqual(erro(await s.iniciar(a, s.area1.id, '2027-06-16')), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'futura']);
    assert.deepEqual(erro(await s.iniciar(a, s.area1.id, '2027-05-31')), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'antes_do_inicio']);
    assert.equal(await foto(s.c), antes);
    const ini = await s.H.ok(s.iniciar(a, s.area1.id));
    assert.deepEqual([ini.area.status, ini.area.data_inicio, ini.area.versao], ['EM_ANDAMENTO', '2027-06-15', 2]);
    assert.equal(ini.atividade.areas[0].status, 'EM_ANDAMENTO');
    // Iniciar de novo: só a planejada.
    const de = await s.areaDe(a, s.area1.id);
    const r2 = await s.areaReq(a, 'POST', `/${de.id}/iniciar`, { versao: de.versao });
    assert.deepEqual([r2.statusCode, r2.json().details.acao], [409, 'iniciar_area']);
    const ap = await s.apontar({ atividade_area_id: de.id, area_executada_dia: '4' }, { a });
    assert.equal(ap.atividade_area_id, de.id);
    // A atividade sem área não aceita área no lançamento.
    const semArea = await s.abrir();
    assert.deepEqual(erro(await s.lancarAp({ atividade_area_id: de.id }, { a: semArea })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'atividade_area_id', 'sem_areas']);
    assert.equal((await s.apontar({}, { a: semArea })).atividade_area_id, null, 'a atividade sem área lança como antes');
  });

  test('concluir a área: data nunca futura nem antes do início dela; concluída, recusa o lançamento novo e a linha nova (mas edita e cancela o que já tem); reabrir libera', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id }]);
    await s.H.ok(s.iniciar(a, s.area1.id, '2027-06-05'));
    const area = await s.areaDe(a, s.area1.id);
    const ap = await s.apontar({ atividade_area_id: area.id }, { a });
    const S = s.acoesDaLinha('servicos');
    await S.lancarOk(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '100' }, { a });
    const concluir = (corpo) => s.areaReq(a, 'POST', `/${area.id}/concluir`, { versao: area.versao, ...corpo });
    assert.deepEqual(erro(await concluir({ data_conclusao: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'futura']);
    assert.deepEqual(erro(await concluir({ data_conclusao: '2027-06-04' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_inicio_da_area']);
    const fim = await s.H.ok(concluir({ data_conclusao: '2027-06-12' }));
    assert.deepEqual([fim.area.status, fim.area.data_inicio, fim.area.data_conclusao], ['CONCLUIDA', '2027-06-05', '2027-06-12']);
    const r = await s.lancarAp({ atividade_area_id: area.id }, { a });
    assert.deepEqual([r.statusCode, r.json().details.status], [409, 'CONCLUIDA']);
    const linha = await S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1' }, { a });
    assert.deepEqual([linha.statusCode, linha.json().details.entidade, linha.json().details.acao], [409, 'area', 'lancar_na_area']);
    // Editar o lançamento existente continua (a área concluída só não recebe lançamento NOVO).
    await s.H.ok(s.H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { empresa_id: a.empresa_id, versao: await s.versaoDe(ap.id), observacao: 'ajuste' }));
    // Reabrir: volta a EM_ANDAMENTO, a conclusão sai, o início fica.
    const conc = await s.areaDe(a, s.area1.id);
    const reab = await s.H.ok(s.areaReq(a, 'POST', `/${conc.id}/reabrir`, { versao: conc.versao }));
    assert.deepEqual([reab.area.status, reab.area.data_inicio, reab.area.data_conclusao], ['EM_ANDAMENTO', '2027-06-05', null]);
    await S.lancarOk(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1' }, { a });
    // Reabrir a que não está concluída e versão velha.
    const r2 = await s.areaReq(a, 'POST', `/${conc.id}/reabrir`, { versao: reab.area.versao });
    assert.deepEqual([r2.statusCode, r2.json().details.acao], [409, 'reabrir_area']);
    const r3 = await s.areaReq(a, 'POST', `/${conc.id}/concluir`, { versao: 1 });
    assert.deepEqual([r3.statusCode, r3.json().code, r3.json().details.entidade], [409, 'ATIVIDADE_VERSAO_CONFLITO', 'area']);
  });

  test('repetir o lançamento herda a área (que tem de estar em andamento); a edição troca a área só para outra EM_ANDAMENTO desta atividade', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id }]);
    await s.H.ok(s.iniciar(a, s.area1.id));
    const a1 = await s.areaDe(a, s.area1.id);
    const a2 = await s.areaDe(a, s.pasto2.id);
    const ap = await s.apontar({ atividade_area_id: a1.id }, { a });
    const rep = await s.H.ok(s.H.req('POST', `${s.baseAp(a)}/${ap.id}/duplicar`, s.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-11' }), 201);
    assert.equal(rep.apontamento.atividade_area_id, a1.id);
    const r = await s.H.req('POST', `${s.baseAp(a)}/${ap.id}/duplicar`, s.token, { empresa_id: a.empresa_id, atividade_area_id: a2.id });
    assert.deepEqual([r.statusCode, r.json().details.status], [409, 'PLANEJADA']);
    const ed = (corpo) => s.versaoDe(ap.id).then((v) => s.H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { empresa_id: a.empresa_id, versao: v, ...corpo }));
    assert.equal((await ed({ atividade_area_id: a2.id })).statusCode, 409);
    await s.H.ok(s.iniciar(a, s.pasto2.id));
    const trocado = await s.H.ok(ed({ atividade_area_id: a2.id }));
    assert.equal(trocado.apontamento.atividade_area_id, a2.id);
    assert.deepEqual(erro(await ed({ atividade_area_id: 'outra-area' })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'atividade_area_id', 'inexistente']);
  });

  test('o BANCO recusa (23503) o lançamento com a área de OUTRA atividade (FK composta), mesmo por fora do servidor', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }]);
    const b = await s.abrirVarias([{ area_id: s.pasto2.id }]);
    await assert.rejects(
      prisma().$executeRawUnsafe(
        `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, atividade_area_id, "updatedAt")
         VALUES ('ap-x', $1, $2, $3, '2027-06-10', 1, $4, now())`, s.c, a.empresa_id, a.id, b.areas[0].id
      ),
      (e) => /23503|AtividadeApontamento_atividade_area_fkey/.test(`${e.message} ${JSON.stringify(e.meta ?? {})}`)
    );
    // E a área com lançamento não sai nem por DELETE direto (RESTRICT).
    await s.H.ok(s.iniciar(a, s.area1.id));
    await s.apontar({ atividade_area_id: a.areas[0].id }, { a });
    await assert.rejects(prisma().atividadeArea.delete({ where: { id: a.areas[0].id } }));
  });
});

describe('adicionar, editar e remover áreas', () => {
  test('adicionar: PLANEJADA no fim, planejada padrão = o tamanho; repetida, inativa e atividade concluída recusam', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }]);
    const r = await s.H.ok(s.areaReq(a, 'POST', '', { area_id: s.pasto3.id }), 201);
    assert.deepEqual([r.area.ordem, r.area.status, r.area.area_planejada], [2, 'PLANEJADA', '40.0000']);
    assert.deepEqual([r.atividade.areas_count, r.atividade.area_id, r.atividade.area_planejada], [2, s.area1.id, '50.0000']);
    const r2 = await s.H.ok(s.areaReq(a, 'POST', '', { area_id: s.pasto2.id, area_planejada: '3.5' }), 201);
    assert.deepEqual([r2.area.ordem, r2.area.area_planejada, r2.atividade.area_planejada], [3, '3.5000', '53.5000']);
    assert.deepEqual(erro(await s.areaReq(a, 'POST', '', { area_id: s.pasto3.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'ja_na_atividade']);
    assert.deepEqual(erro(await s.areaReq(a, 'POST', '', { area_id: s.inativa.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'inativo']);
    assert.deepEqual(erro(await s.areaReq(a, 'POST', '', { area_id: s.area2.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'outra_empresa']);
    // Editar a planejada (null limpa; a soma segue).
    const d = await s.areaDe(a, s.pasto2.id);
    const ed = await s.H.ok(s.areaReq(a, 'PATCH', `/${d.id}`, { versao: d.versao, area_planejada: null }));
    assert.deepEqual([ed.area.area_planejada, ed.atividade.area_planejada], [null, '50.0000']);
    const atual = await s.detalhe(a);
    await s.H.ok(s.H.req('POST', `/atividades/${a.id}/concluir`, s.token, { empresa_id: a.empresa_id, versao: atual.versao }));
    const r3 = await s.areaReq(a, 'POST', '', { area_id: s.inativa.id });
    assert.deepEqual([r3.statusCode, r3.json().details.acao], [409, 'adicionar_area']);
  });

  test('remover: só a PLANEJADA e sem lançamento (DELETE físico); a 1ª removida, o cabeçalho passa à próxima; iniciada → 409; com lançamento → 409 ATIVIDADE_AREA_COM_LANCAMENTOS; a última de um tipo que exige área → 422', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id }, { area_id: s.pasto3.id }]);
    const primeira = await s.areaDe(a, s.area1.id);
    const r = await s.H.ok(s.areaReq(a, 'POST', `/${primeira.id}/remover`, { versao: primeira.versao }));
    assert.equal(r.removida, primeira.id);
    assert.deepEqual([r.atividade.areas_count, r.atividade.area_id, r.atividade.area_planejada], [2, s.pasto2.id, '65.5000']);
    assert.equal(await prisma().atividadeArea.count({ where: { id: primeira.id } }), 0);
    // Iniciada → 409.
    await s.H.ok(s.iniciar(a, s.pasto2.id));
    const iniciada = await s.areaDe(a, s.pasto2.id);
    const r2 = await s.areaReq(a, 'POST', `/${iniciada.id}/remover`, { versao: iniciada.versao });
    assert.deepEqual([r2.statusCode, r2.json().code, r2.json().details.acao], [409, 'ATIVIDADE_STATUS_INVALIDO', 'remover_area']);
    // Com lançamento (cancelado) e de volta a PLANEJADA por fora → 409 ATIVIDADE_AREA_COM_LANCAMENTOS, nada apagado.
    const ap = await s.apontar({ atividade_area_id: iniciada.id }, { a });
    await s.H.ok(s.H.req('POST', `${s.baseAp(a)}/${ap.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: ap.versao, motivo: 'lançado errado' }));
    await prisma().atividadeArea.update({ where: { id: iniciada.id }, data: { status: 'PLANEJADA', data_inicio: null } });
    const r3 = await s.areaReq(a, 'POST', `/${iniciada.id}/remover`, { versao: iniciada.versao });
    assert.deepEqual([r3.statusCode, r3.json().code, r3.json().details], [409, 'ATIVIDADE_AREA_COM_LANCAMENTOS', { confirmados: 0, cancelados: 1 }]);
    assert.equal(await prisma().atividadeArea.count({ where: { id: iniciada.id } }), 1);
    // A última área de um tipo que exige área.
    await prisma().tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_area: true } });
    const b = await s.abrirVarias([{ area_id: s.area1.id }]);
    const unica = b.areas[0];
    assert.deepEqual(erro(await s.areaReq(b, 'POST', `/${unica.id}/remover`, { versao: unica.versao })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'area_id', 'exige_area']);
  });

  test('o PATCH antigo do cabeçalho: com várias áreas, área e planejada mudam pelo card (422 varias_areas); com uma, troca a área sem lançamento', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id }]);
    const patch = (at, corpo) => s.H.req('PATCH', `/atividades/${at.id}`, s.token, { versao: at.versao, ...corpo });
    assert.deepEqual(erro(await patch(a, { area_id: s.pasto3.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'varias_areas']);
    assert.deepEqual(erro(await patch(a, { area_planejada: '1' })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_planejada', 'varias_areas']);
    assert.equal((await s.H.ok(patch(a, { nome: 'Renomeada', area_id: s.area1.id }))).nome, 'Renomeada', 'manter a área não é trocar');
    const b = await s.abrirVarias([{ area_id: s.area1.id }]);
    const trocada = await s.H.ok(patch(b, { area_id: s.pasto3.id, area_planejada: '7' }));
    assert.deepEqual(trocada.areas.map((x) => [x.area_id, x.area_planejada]), [[s.pasto3.id, '7.0000']]);
  });
});

describe('concluir e reabrir a atividade; totais por área; lista', () => {
  test('concluir a atividade conclui junto as áreas EM ANDAMENTO (mesma data, nunca antes do início delas); as PLANEJADAS ficam não iniciadas; reabrir desfaz', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id }, { area_id: s.pasto3.id }]);
    await s.H.ok(s.iniciar(a, s.area1.id, '2027-06-02'));
    await s.H.ok(s.iniciar(a, s.pasto2.id, '2027-06-10'));
    const v = (await s.detalhe(a)).versao;
    assert.deepEqual(erro(await s.H.req('POST', `/atividades/${a.id}/concluir`, s.token, { empresa_id: a.empresa_id, versao: v, data_conclusao: '2027-06-08' })),
      [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_inicio_da_area']);
    const c = await s.H.ok(s.H.req('POST', `/atividades/${a.id}/concluir`, s.token, { empresa_id: a.empresa_id, versao: v, data_conclusao: '2027-06-12' }));
    assert.deepEqual(c.areas.map((x) => [x.status, x.data_conclusao]), [['CONCLUIDA', '2027-06-12'], ['CONCLUIDA', '2027-06-12'], ['PLANEJADA', null]]);
    const r = await s.H.ok(s.H.req('POST', `/atividades/${a.id}/reabrir`, s.token, { empresa_id: a.empresa_id, versao: c.versao, motivo: 'faltou um pasto' }));
    assert.deepEqual(r.areas.map((x) => x.status), ['EM_ANDAMENTO', 'EM_ANDAMENTO', 'PLANEJADA']);
  });

  test('por_area: feita, %, custo por tipo, custo/ha, combustível e último lançamento de cada área; o total da atividade é a soma; a lista traz areas_count e filtra por qualquer área', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }, { area_id: s.pasto2.id, area_planejada: '20' }, { area_id: s.pasto3.id }]);
    await s.H.ok(s.iniciar(a, s.area1.id, '2027-06-02'));
    await s.H.ok(s.iniciar(a, s.pasto2.id, '2027-06-02'));
    const [a1, a2] = (await s.detalhe(a)).areas;
    const servico = (area, dia, ha, valor) =>
      s.apontar({ atividade_area_id: area.id, data_operacional: dia, area_executada_dia: ha, operation_id: opId(), servicos: [{ servico_id: s.gradagem.id, quantidade: '1', valor_unitario: valor }] }, { a });
    await servico(a1, '2027-06-03', '4', '100');
    await servico(a1, '2027-06-07', '6', '50');
    await servico(a2, '2027-06-05', '5', '80');
    const t = await s.totais(a);
    assert.equal(t.por_area.length, 3);
    const [p1, p2, p3] = t.por_area;
    assert.deepEqual([p1.area.id, p1.status, p1.area_planejada, p1.area_executada, p1.percentual, p1.custo_total, p1.custo_por_ha, p1.ultimo_lancamento, p1.lancamentos_confirmados],
      [s.area1.id, 'EM_ANDAMENTO', '10.0000', '10.0000', '100.00', '150.0000', '15.0000', '2027-06-07', 2]);
    assert.deepEqual(p1.custo_por_tipo, { maquinas: null, produtos: null, mao_obra: null, servicos: '150.0000', combustivel: null });
    assert.deepEqual([p2.area_executada, p2.percentual, p2.custo_total, p2.custo_por_ha], ['5.0000', '25.00', '80.0000', '16.0000']);
    assert.deepEqual([p3.status, p3.area_executada, p3.custo_total, p3.ultimo_lancamento, p3.percentual], ['PLANEJADA', null, null, null, null]);
    assert.deepEqual(p3.combustivel, { quantidade_l: null, quantidade_kg: null, custo_total: null });
    assert.equal(t.custo_total, '230.0000', 'o total da atividade é a soma das áreas');
    assert.equal(t.area_executada, '15.0000');
    // Lista: areas_count, o custo total e o filtro por qualquer área (a 3ª também acha).
    const lista = await s.H.ok(s.H.req('GET', `/atividades?empresa_id=${s.e1.id}&area_id=${s.pasto3.id}`, s.token));
    assert.deepEqual(lista.items.map((i) => [i.id, i.areas_count, i.custo_total]), [[a.id, 3, '230.0000']]);
    assert.deepEqual(lista.items[0].areas.map((x) => x.status), ['EM_ANDAMENTO', 'EM_ANDAMENTO', 'PLANEJADA']);
  });

  test('tenant e fazenda: área de outra atividade, de outro tenant ou de outra fazenda → 404 ATIVIDADE_AREA_NOT_FOUND / ATIVIDADE_NOT_FOUND; sem a permissão de editar → 403', async () => {
    const s = await montar();
    const a = await s.abrirVarias([{ area_id: s.area1.id }]);
    const b = await s.abrirVarias([{ area_id: s.pasto2.id }]);
    const r = await s.areaReq(a, 'POST', `/${b.areas[0].id}/iniciar`, { versao: 1 });
    assert.deepEqual([r.statusCode, r.json().code], [404, 'ATIVIDADE_AREA_NOT_FOUND']);
    const outro = await montarLinhasCusto(app);
    const r2 = await outro.H.req('POST', `/atividades/${a.id}/areas/${a.areas[0].id}/iniciar`, outro.token, { empresa_id: outro.e1.id, versao: 1 });
    assert.deepEqual([r2.statusCode, r2.json().code], [404, 'ATIVIDADE_NOT_FOUND']);
    const so = await s.contaTela({ visualizar: true });
    const r3 = await s.areaReq(a, 'POST', `/${a.areas[0].id}/iniciar`, { versao: 1 }, so.token);
    assert.equal(r3.statusCode, 403);
    assert.equal((await s.areaDe(a, s.area1.id)).status, 'PLANEJADA');
  });
});
