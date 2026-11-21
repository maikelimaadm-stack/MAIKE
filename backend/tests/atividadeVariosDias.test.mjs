/**
 * D-PROD-267 — SERVIÇO DE VÁRIOS DIAS ("abre uma vez e vai somando os dias") e a SITUAÇÃO da lista, contra PostgreSQL real
 * e HTTP autenticado (`app.inject`). Proposta aprovada: docs/engineering/MAIKE-PROPOSTA-REFORMA-E-VARIOS-DIAS.md (Partes 2 e 3).
 *
 * Cobre: a regra do mês saiu (a roçada de 28/05 a 07/06 é UMA atividade, com o nome do mês do início) e a trava por área
 * sem o mês (dois registros paralelos em meses diferentes → uma atividade); o "parado" (mais de 30 dias: 409
 * `ATIVIDADE_SERVICO_PARADO` sem recibo, o reenvio com a mesma chave e `nova_atividade` false continua, true conclui a
 * antiga no último dia e abre outra; o limite de 30 dias conta o término); `concluir` (as áreas do registro concluem no
 * término ou no dia e, com todas concluídas, a atividade; sem ele nada conclui, nem aos 100%); "todas as áreas concluídas
 * ⇒ atividade concluída" também no "Concluir área"; a data nunca antes do último dia lançado (área e atividade); a guarda
 * (concluir pede editar); o fingerprint byte a byte o de antes sem os campos novos; o "Concluir" da lista
 * (`POST /atividades/:id/concluir`); o `andamento` e a `situacao` da lista (números e filtros) e o `ultimo_dia` do resumo.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { fingerprintDePayload } from '../src/shared/idempotency/operacaoIdempotenteService.js';
import { VAZIO, camposDoCorpo, canonico, linhasDoCorpo, linhasNovasDoFingerprint, origemDoCorpo } from '../src/modules/atividades/atividadeApontamentoService.js';
import { DIAS_PARADO_MAXIMO, TIPO_OPERACAO_REGISTRAR, diasEntre } from '../src/modules/atividades/atividadeRegistroService.js';

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

const dia = (d) => d.toISOString().slice(0, 10);

const montar = async () => {
  const s = await montarLinhasCusto(app);
  const p = prisma();
  const corpoBase = (corpo = {}) => ({
    empresa_id: s.e1.id, area_id: s.area1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10', operation_id: opId('vd'), ...corpo,
  });
  const registrar = (corpo = {}, tok = s.token) => s.H.req('POST', '/atividades/registrar', tok, corpoBase(corpo));
  const ok = async (corpo, tok) => {
    const r = await registrar(corpo, tok);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const novaArea = (nome, tamanho = '40') =>
    p.areaPastagem.create({
      data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: tamanho },
    });
  /** As atividades do registro de campo (a do cenário, sem área, fica de fora). */
  const atividades = () => p.atividade.findMany({ where: { cliente_id: s.c, id: { not: s.atividade.id } }, orderBy: { createdAt: 'asc' } });
  const atividade = (id) => p.atividade.findUnique({ where: { id } });
  const areasDe = (id) => p.atividadeArea.findMany({ where: { atividade_id: id }, orderBy: { ordem: 'asc' } });
  const lista = (qs = '') => s.H.ok(s.H.req('GET', `/atividades?empresa_id=${s.e1.id}${qs}`, s.token));
  return { ...s, corpoBase, registrar, ok, novaArea, atividades, atividade, areasDe, lista };
};

describe('sem a regra do mês', () => {
  test('28/05 → 02/06 → 07/06: UMA atividade (o nome fica com o mês do início), 3 dias somando', async () => {
    const s = await montar();
    const um = await s.ok({ data_operacional: '2027-05-28', area_executada_dia: '4' });
    const dois = await s.ok({ data_operacional: '2027-06-02', area_executada_dia: '4' });
    const tres = await s.ok({ data_operacional: '2027-06-07', area_executada_dia: '2' });
    assert.deepEqual([um.registro.atividade_criada, dois.registro.atividade_criada, tres.registro.atividade_criada], [true, false, false]);
    assert.equal(dois.registro.atividade_id, um.registro.atividade_id);
    assert.equal(tres.registro.atividade_id, um.registro.atividade_id);
    const [a] = await s.atividades();
    assert.equal((await s.atividades()).length, 1);
    assert.equal(a.nome, `${s.tipo.nome_tipo} · ${s.area1.nome} · mai/27`);
    assert.equal(a.area_executada.toFixed(4), '10.0000');
    assert.equal(a.status, 'ABERTA', 'nada conclui sozinho, nem aos 100%');
    assert.equal(await prisma().atividadeApontamento.count({ where: { atividade_id: a.id } }), 3);
  });

  test('a trava por área não tem mais o mês: dois registros paralelos, em meses diferentes, na mesma área → UMA atividade', async () => {
    const s = await montar();
    const [a, b] = await Promise.all([s.registrar({ data_operacional: '2027-05-28' }), s.registrar({ data_operacional: '2027-06-02' })]);
    assert.deepEqual([a.statusCode, b.statusCode], [201, 201], `${a.body} ${b.body}`);
    assert.equal(a.json().registro.atividade_id, b.json().registro.atividade_id);
    assert.equal((await s.atividades()).length, 1);
    assert.deepEqual([a, b].map((x) => x.json().registro.atividade_criada).sort(), [false, true]);
  });
});

describe('serviço parado (mais de 30 dias)', () => {
  test('a constante e a conta dos dias', () => {
    assert.equal(DIAS_PARADO_MAXIMO, 30);
    assert.deepEqual([diasEntre('2027-04-01', '2027-05-01'), diasEntre('2027-04-01', '2027-05-02'), diasEntre('2027-06-10', '2027-06-01')], [30, 31, -9]);
  });

  test('409 ATIVIDADE_SERVICO_PARADO sem decisão: nada gravado e NENHUM recibo; o reenvio com a mesma chave e nova_atividade false continua nela', async () => {
    const s = await montar();
    const antiga = await s.ok({ data_operacional: '2027-04-01', area_executada_dia: '3' });
    const operation_id = opId('parado');
    const r = await s.registrar({ data_operacional: '2027-06-10', area_executada_dia: '2', operation_id });
    assert.equal(r.statusCode, 409, r.body);
    const corpo = r.json();
    assert.equal(corpo.code, 'ATIVIDADE_SERVICO_PARADO');
    assert.deepEqual(
      [corpo.details.atividade_id, corpo.details.atividade_nome, corpo.details.ultimo_dia, corpo.details.area_id, corpo.details.dias_parado, corpo.details.limite_dias],
      [antiga.registro.atividade_id, antiga.registro.atividade_nome, '2027-04-01', s.area1.id, 70, 30]
    );
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), 1);
    assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: operation_id } }), 0, 'a recusa não deixa recibo');
    // "Continuar este serviço": a MESMA chave, agora com a decisão.
    const cont = await s.ok({ data_operacional: '2027-06-10', area_executada_dia: '2', operation_id, nova_atividade: false });
    assert.deepEqual([cont.registro.atividade_criada, cont.registro.atividade_id, cont.registro.atividade_anterior], [false, antiga.registro.atividade_id, null]);
    assert.equal((await s.atividades()).length, 1);
    // O reenvio igual é replay; e, com o dia novo lançado, ela não está mais parada: o próximo entra sem perguntar.
    assert.equal((await s.registrar({ data_operacional: '2027-06-10', area_executada_dia: '2', operation_id, nova_atividade: false })).json().replay, true);
    assert.equal((await s.ok({ data_operacional: '2027-06-12' })).registro.atividade_id, antiga.registro.atividade_id);
  });

  test('nova_atividade true ("é um serviço novo"): a antiga conclui no último dia lançado (área e atividade) e uma NOVA é criada', async () => {
    const s = await montar();
    const antiga = await s.ok({ data_operacional: '2027-04-01', area_executada_dia: '3' });
    await s.ok({ data_operacional: '2027-04-05', area_executada_dia: '3' });
    const operation_id = opId('novo');
    assert.equal((await s.registrar({ data_operacional: '2027-06-10', operation_id })).statusCode, 409);
    const nova = await s.ok({ data_operacional: '2027-06-10', operation_id, nova_atividade: true, area_executada_dia: '1' });
    assert.equal(nova.registro.atividade_criada, true);
    assert.notEqual(nova.registro.atividade_id, antiga.registro.atividade_id);
    assert.match(nova.registro.atividade_nome, /jun\/27$/);
    assert.deepEqual(nova.registro.atividade_anterior, {
      atividade_id: antiga.registro.atividade_id, atividade_nome: antiga.registro.atividade_nome, ultimo_dia: '2027-04-05', areas_concluidas: 1, atividade_concluida: true,
    });
    const velha = await s.atividade(antiga.registro.atividade_id);
    assert.deepEqual([velha.status, dia(velha.data_conclusao)], ['CONCLUIDA', '2027-04-05']);
    const [ar] = await s.areasDe(velha.id);
    assert.deepEqual([ar.status, dia(ar.data_conclusao)], ['CONCLUIDA', '2027-04-05']);
    const [ev] = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade.concluir', entidade_id: velha.id } });
    assert.equal(ev.dados_novos.conclusao_automatica, true);
  });

  test('o limite conta o término: 30 dias depois do último dia ainda entra; 31 pergunta', async () => {
    const s = await montar();
    const antiga = await s.ok({ data_operacional: '2027-03-25', data_termino: '2027-04-01' });
    assert.equal((await s.ok({ data_operacional: '2027-05-01' })).registro.atividade_id, antiga.registro.atividade_id);
    // O dia lançado agora (01/05) é o novo "último dia": 31 dias depois dele, pergunta.
    assert.deepEqual(erro(await s.registrar({ data_operacional: '2027-06-01' })).slice(0, 2), [409, 'ATIVIDADE_SERVICO_PARADO']);
    // Um dia esquecido ANTES do último (dia anterior) nunca é "parado".
    assert.equal((await s.ok({ data_operacional: '2027-04-20' })).registro.atividade_id, antiga.registro.atividade_id);
  });

  test('a atividade planejada sem nenhum dia lançado não está parada (o primeiro dia entra nela)', async () => {
    const s = await montar();
    const planejada = await s.abrir({ areas: [{ area_id: s.area1.id }], data_inicio: '2027-03-01' });
    const r = await s.ok({ data_operacional: '2027-06-10' });
    assert.deepEqual([r.registro.atividade_criada, r.registro.atividade_id], [false, planejada.id]);
  });
});

describe('concluir ("Como fica depois de salvar?")', () => {
  test('concluir true: a área conclui no término e, sendo a única, a atividade também; sem ele nada conclui', async () => {
    const s = await montar();
    const sem = await s.ok({ data_operacional: '2027-06-01', area_executada_dia: '10' });
    assert.deepEqual([sem.registro.areas_concluidas, sem.registro.atividade_concluida, sem.atividade.status], [0, false, 'ABERTA']);
    const fim = await s.ok({ data_operacional: '2027-06-08', data_termino: '2027-06-09', area_executada_dia: '1', concluir: true });
    assert.equal(fim.registro.atividade_id, sem.registro.atividade_id);
    assert.deepEqual([fim.registro.areas_concluidas, fim.registro.atividade_concluida, fim.atividade.status, fim.atividade.data_conclusao], [1, true, 'CONCLUIDA', '2027-06-09']);
    const [ar] = await s.areasDe(sem.registro.atividade_id);
    assert.deepEqual([ar.status, dia(ar.data_conclusao)], ['CONCLUIDA', '2027-06-09']);
    // Sem término: conclui no dia.
    const outra = await s.ok({ area_id: (await s.novaArea('PASTO 05')).id, data_operacional: '2027-06-11', concluir: true });
    assert.deepEqual([outra.registro.atividade_criada, outra.atividade.status, outra.atividade.data_conclusao], [true, 'CONCLUIDA', '2027-06-11']);
  });

  test('várias áreas: conclui só as do registro; a atividade fica ABERTA até a última área concluir', async () => {
    const s = await montar();
    const pasto2 = await s.novaArea('PASTO 02', '20');
    const a = await s.abrir({ areas: [{ area_id: s.area1.id }, { area_id: pasto2.id }], data_inicio: '2027-06-01' });
    const r1 = await s.ok({ data_operacional: '2027-06-05', area_executada_dia: '10', concluir: true });
    assert.equal(r1.registro.atividade_id, a.id);
    assert.deepEqual([r1.registro.areas_concluidas, r1.registro.atividade_concluida, r1.atividade.status], [1, false, 'ABERTA']);
    assert.deepEqual((await s.areasDe(a.id)).map((x) => x.status), ['CONCLUIDA', 'PLANEJADA']);
    // A outra área (ainda planejada) é iniciada e concluída pelo registro dela: era a última, a atividade conclui.
    const r2 = await s.ok({ area_id: pasto2.id, data_operacional: '2027-06-08', area_executada_dia: '20', concluir: true });
    assert.equal(r2.registro.atividade_id, a.id);
    assert.deepEqual([r2.registro.atividade_concluida, r2.atividade.status, r2.atividade.data_conclusao], [true, 'CONCLUIDA', '2027-06-08']);
  });

  test('concluir antes do último dia lançado na área → 422 antes_do_ultimo_dia; nada gravado', async () => {
    const s = await montar();
    await s.ok({ data_operacional: '2027-06-03' });
    await s.ok({ data_operacional: '2027-06-09' });
    const antes = await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } });
    assert.deepEqual(erro(await s.registrar({ data_operacional: '2027-06-05', concluir: true })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_ultimo_dia']);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), antes);
  });

  test('a guarda: concluir ou nova_atividade true pedem também editar (403 só com lançar); false passa; texto → 400', async () => {
    const s = await montar();
    const lanca = await s.contaTela({ lancar_apontamento: true });
    assert.deepEqual(erro(await s.registrar({ concluir: true }, lanca.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await s.registrar({ nova_atividade: true }, lanca.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await s.registrar({ concluir: false, nova_atividade: false }, lanca.token)).statusCode, 201);
    const comEditar = await s.contaTela({ lancar_apontamento: true, editar: true });
    assert.equal((await s.registrar({ data_operacional: '2027-06-11', concluir: true }, comEditar.token)).statusCode, 201);
    for (const v of ['true', 1, null]) {
      assert.deepEqual(erro(await s.registrar({ concluir: v })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], String(v));
    }
  });

  test('fingerprint: sem concluir e nova_atividade é byte a byte o de antes; com eles, as chaves entram (mesma chave → 409)', async () => {
    const s = await montar();
    const corpo = s.corpoBase({ area_executada_dia: '3', observacao: 'roçou' });
    const r = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(r.statusCode, 201, r.body);
    // A fórmula de ANTES da D-PROD-267 (v1, uma área), reconstruída com as mesmas peças do serviço.
    const linhas = linhasDoCorpo(corpo);
    const antes = fingerprintDePayload({
      v: 1, empresa_id: corpo.empresa_id, area_id: corpo.area_id, tipo_atividade_id: corpo.tipo_atividade_id, safra_ciclo: null,
      estado: { ...VAZIO, ...camposDoCorpo(corpo) }, origem: origemDoCorpo(corpo.origem),
      produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas),
    });
    const recibo = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, operation_key: corpo.operation_id, tipo_operacao: TIPO_OPERACAO_REGISTRAR } });
    assert.equal(recibo.fingerprint, antes);
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo, concluir: false })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal((await s.H.req('POST', '/atividades/registrar', s.token, corpo)).json().replay, true);
  });
});

describe('todas as áreas concluídas ⇒ atividade concluída; o "Concluir" da lista', () => {
  test('"Concluir área": a última área em aberto conclui a atividade (no dia da última), com auditoria; nunca antes do último dia lançado', async () => {
    const s = await montar();
    const pasto2 = await s.novaArea('PASTO 02', '20');
    const a = await s.abrir({ areas: [{ area_id: s.area1.id }, { area_id: pasto2.id }], data_inicio: '2027-06-01' });
    await s.ok({ data_operacional: '2027-06-03', area_executada_dia: '5' });
    await s.ok({ area_id: pasto2.id, data_operacional: '2027-06-06', data_termino: '2027-06-07' });
    const [a1, a2] = await s.areasDe(a.id);
    const concluirArea = (ar, data_conclusao) =>
      s.H.req('POST', `/atividades/${a.id}/areas/${ar.id}/concluir`, s.token, { empresa_id: s.e1.id, versao: ar.versao, data_conclusao });
    assert.deepEqual(erro(await concluirArea(a2, '2027-06-06')), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_ultimo_dia']);
    const r1 = await s.H.ok(concluirArea(a1, '2027-06-04'));
    assert.deepEqual([r1.area.status, r1.atividade_concluida, r1.atividade.status], ['CONCLUIDA', false, 'ABERTA']);
    const r2 = await s.H.ok(concluirArea(a2, '2027-06-09'));
    assert.deepEqual([r2.area.status, r2.atividade_concluida, r2.atividade.status, r2.atividade.data_conclusao], ['CONCLUIDA', true, 'CONCLUIDA', '2027-06-09']);
    const evs = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade.concluir', entidade_id: a.id } });
    assert.equal(evs.length, 1);
    assert.equal(evs[0].dados_novos.motivo, 'todas_as_areas_concluidas');
    // Reabrir a atividade desfaz: a área concluída no dia da atividade volta; a outra fica.
    const re = await s.H.ok(s.H.req('POST', `/atividades/${a.id}/reabrir`, s.token, { empresa_id: s.e1.id, versao: r2.atividade.versao, motivo: 'faltou repasse' }));
    assert.deepEqual(re.areas.map((x) => x.status), ['CONCLUIDA', 'EM_ANDAMENTO']);
  });

  test('tipo que exige produção sem produção: as áreas concluem e a atividade fica ABERTA (o "Concluir atividade" explica)', async () => {
    const s = await montar();
    await prisma().tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_producao: true } });
    const r = await s.ok({ data_operacional: '2027-06-05', concluir: true });
    assert.deepEqual([r.registro.areas_concluidas, r.registro.atividade_concluida, r.atividade.status], [1, false, 'ABERTA']);
  });

  test('"Concluir" da lista = POST /atividades/:id/concluir: futura, antes do início e antes do último dia recusam; no dia certo conclui as áreas e a atividade numa transação', async () => {
    const s = await montar();
    const pasto2 = await s.novaArea('PASTO 02', '20');
    const a = await s.abrir({ areas: [{ area_id: s.area1.id }, { area_id: pasto2.id }], data_inicio: '2027-06-01' });
    await s.ok({ data_operacional: '2027-06-03', area_executada_dia: '5' });
    await s.ok({ area_id: pasto2.id, data_operacional: '2027-06-06', data_termino: '2027-06-08' });
    const versao = (await s.atividade(a.id)).versao;
    const concluir = (data_conclusao) => s.H.req('POST', `/atividades/${a.id}/concluir`, s.token, { empresa_id: s.e1.id, versao, data_conclusao });
    assert.deepEqual(erro(await concluir('2027-06-16')), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'futura']);
    assert.deepEqual(erro(await concluir('2027-05-30')), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_inicio']);
    const r = await concluir('2027-06-07');
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_ultimo_dia']);
    assert.equal(r.json().details.ultimo_dia, '2027-06-08');
    assert.equal((await s.atividade(a.id)).status, 'ABERTA', 'nada mudou');
    const c = await s.H.ok(concluir('2027-06-08'));
    assert.deepEqual([c.status, c.data_conclusao, c.areas.map((x) => [x.status, x.data_conclusao])], ['CONCLUIDA', '2027-06-08', [['CONCLUIDA', '2027-06-08'], ['CONCLUIDA', '2027-06-08']]]);
    // Permissão: a do "Concluir" (editar); só lançar → 403.
    const lanca = await s.contaTela({ lancar_apontamento: true });
    const b = await s.abrir({ areas: [{ area_id: pasto2.id }] });
    assert.deepEqual(erro(await s.H.req('POST', `/atividades/${b.id}/concluir`, lanca.token, { empresa_id: s.e1.id, versao: b.versao })).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
  });
});

describe('a lista: andamento e situação', () => {
  test('hectares feitos e da área, %, primeiro e último dia (com o término), lançamentos, por área; situação das 4 formas; filtros', async () => {
    const s = await montar();
    await prisma().tipoAtividade.update({ where: { id: s.tipo.id }, data: { categoria: 'PASTAGEM' } });
    const aroeira = await s.novaArea('PASTO DA AROEIRA', '40');
    // Em andamento, 2 áreas: Aroeira (40 ha) e area1 (planejada 5 de 10 ha).
    const andamento = await s.abrir({ areas: [{ area_id: aroeira.id }, { area_id: s.area1.id, area_planejada: '5' }], data_inicio: '2027-05-28' });
    await s.ok({ area_id: aroeira.id, data_operacional: '2027-05-28', area_executada_dia: '4' });
    await s.ok({ area_id: aroeira.id, data_operacional: '2027-05-30', data_termino: '2027-06-02', area_executada_dia: '8' });
    const cancelado = await s.ok({ area_id: aroeira.id, data_operacional: '2027-06-05', area_executada_dia: '9' });
    await s.H.ok(s.H.req('POST', `/atividades/${andamento.id}/apontamentos/${cancelado.apontamento.id}/cancelar`, s.token, {
      empresa_id: s.e1.id, versao: cancelado.apontamento.versao, motivo: 'lançado errado',
    }));
    // Planejada (sem dia), concluída e cancelada.
    const planejada = await s.abrir({ areas: [{ area_id: (await s.novaArea('PASTO DA MATA', '30')).id }], data_inicio: '2027-06-10' });
    const concluida = await s.ok({ area_id: (await s.novaArea('PASTO DO CÓRREGO', '30')).id, data_operacional: '2027-06-01', data_termino: '2027-06-10', area_executada_dia: '30', concluir: true });
    const cancelada = await s.abrir({ areas: [{ area_id: (await s.novaArea('PIQUETE', '6')).id }], data_inicio: '2027-06-12' });
    await s.H.ok(s.H.req('POST', `/atividades/${cancelada.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: cancelada.versao, motivo: 'não vai mais' }));

    const pagina = await s.lista();
    const de = (id) => pagina.items.find((i) => i.id === id).andamento;
    const e = de(andamento.id);
    assert.deepEqual(
      [e.tipo_fixo, e.situacao, e.situacao_rotulo, e.hectares_feitos, e.hectares_area, e.percentual, e.primeiro_dia, e.ultimo_dia, e.lancamentos],
      ['PASTAGEM', 'EM_ANDAMENTO', 'Em andamento', '12.0000', '45.0000', '26.67', '2027-05-28', '2027-06-02', 2]
    );
    assert.deepEqual(e.areas.map((x) => [x.area_id, x.status, x.hectares_feitos, x.ultimo_dia]), [
      [aroeira.id, 'EM_ANDAMENTO', '12.0000', '2027-06-02'],
      [s.area1.id, 'PLANEJADA', null, null],
    ]);
    const p = de(planejada.id);
    assert.deepEqual([p.situacao, p.situacao_rotulo, p.hectares_feitos, p.hectares_area, p.percentual, p.lancamentos], ['PLANEJADA', 'Planejada', null, '30.0000', null, 0]);
    const c = de(concluida.registro.atividade_id);
    assert.deepEqual([c.situacao, c.situacao_rotulo, c.hectares_feitos, c.percentual, c.ultimo_dia], ['CONCLUIDA', 'Concluída', '30.0000', '100.00', '2027-06-10']);
    assert.deepEqual([de(cancelada.id).situacao, de(cancelada.id).situacao_rotulo], ['CANCELADA', 'Cancelada']);
    // O custo de sempre continua na linha.
    assert.ok('custo_total' in pagina.items[0]);

    // Só as atividades deste teste (o cenário já traz outras, sem área).
    const deste = new Set([andamento.id, planejada.id, concluida.registro.atividade_id, cancelada.id]);
    const ids = async (qs) => (await s.lista(qs)).items.map((i) => i.id).filter((id) => deste.has(id)).sort();
    assert.deepEqual(await ids('&situacao=EM_ANDAMENTO'), [andamento.id]);
    assert.deepEqual(await ids('&situacao=PLANEJADA'), [planejada.id]);
    assert.deepEqual(await ids('&situacao=CONCLUIDA'), [concluida.registro.atividade_id]);
    assert.deepEqual(await ids('&situacao=CANCELADA'), [cancelada.id]);
    assert.deepEqual(await ids('&situacao=PLANEJADA&status=CONCLUIDA'), []);
    assert.equal((await ids('&tipo_fixo=PASTAGEM')).length, 4);
    assert.deepEqual(await ids('&tipo_fixo=APLICACAO'), []);
    assert.equal((await s.H.req('GET', `/atividades?empresa_id=${s.e1.id}&situacao=PARADA`, s.token)).statusCode, 400);
  });

  test('o resumo da área traz o último dia lançado em cada atividade (a prévia do "+ Lançar dia")', async () => {
    const s = await montar();
    const r = await s.ok({ data_operacional: '2027-06-03', data_termino: '2027-06-05' });
    const j = await s.H.ok(s.H.req('GET', `/atividades-por-area/${s.area1.id}/resumo?empresa_id=${s.e1.id}`, s.token));
    const a = j.atividades.find((x) => x.atividade_id === r.registro.atividade_id);
    assert.equal(a.ultimo_dia, '2027-06-05');
  });
});
