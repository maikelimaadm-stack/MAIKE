/**
 * D-PROD-265 — DATA DE TÉRMINO do registro de campo ("Nova realização de <Tipo>": Data de início = `data_operacional`,
 * Data de término = `data_termino`), contra PostgreSQL real e HTTP autenticado.
 *
 * Cobre: o término aceito e gravado (e devolvido no apontamento e no histórico da área); término igual ao início vale;
 * antes do início → 400 `data_termino` (e o CHECK do banco também recusa); no futuro da fazenda → 422 `futura`; formato
 * errado → 400 do schema; com várias áreas, TODAS as áreas com o mesmo término; sem o campo, o fingerprint é BYTE A BYTE o
 * de antes da D-PROD-265 (a fórmula antiga, recalculada aqui, é a que fica no recibo) e o reenvio casa (também com
 * `data_termino: null`); o término mexido com a mesma chave → 409; a edição do lançamento não leva a data para depois do
 * término; o `POST …/apontamentos` não recebe o campo.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { fingerprintDePayload } from '../src/shared/idempotency/operacaoIdempotenteService.js';
import { VAZIO, camposDoCorpo, canonico, linhasDoCorpo, linhasNovasDoFingerprint, origemDoCorpo } from '../src/modules/atividades/atividadeApontamentoService.js';
import { TIPO_OPERACAO_REGISTRAR } from '../src/modules/atividades/atividadeRegistroService.js';

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
  const base = { empresa_id: s.e1.id, area_id: s.area1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10' };
  const registrar = (corpo = {}, tok = s.token) => s.H.req('POST', '/atividades/registrar', tok, { ...base, operation_id: opId('reg'), ...corpo });
  const ok = async (corpo) => {
    const r = await registrar(corpo);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const novaArea = (nome, tamanho = '10') =>
    p.areaPastagem.create({
      data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: tamanho },
    });
  const apontamentos = () => p.atividadeApontamento.findMany({ where: { cliente_id: s.c, atividade_id: { not: s.atividade.id } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const dia = (d) => (d ? d.toISOString().slice(0, 10) : null);
  const nada = async () => assert.equal((await apontamentos()).length, 0);
  return { ...s, base, registrar, ok, novaArea, apontamentos, dia, nada };
};

describe('data de término (D-PROD-265)', () => {
  test('aceita e grava: o término vai para o apontamento, volta na resposta e no histórico da área; igual ao início também vale', async () => {
    const s = await montar();
    const r = await s.ok({ area_executada_dia: '3', data_termino: '2027-06-12' });
    assert.equal(r.apontamento.data_operacional, '2027-06-10');
    assert.equal(r.apontamento.data_termino, '2027-06-12');
    assert.equal(r.apontamentos[0].data_termino, '2027-06-12');
    const [ap] = await s.apontamentos();
    assert.deepEqual([s.dia(ap.data_operacional), s.dia(ap.data_termino)], ['2027-06-10', '2027-06-12']);
    // A leitura do lançamento devolve o término; o histórico de registros da área também.
    const lido = await s.H.ok(s.H.req('GET', `/atividades/${r.registro.atividade_id}/apontamentos/${ap.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(lido.data_termino, '2027-06-12');
    const hist = await s.H.ok(s.H.req('GET', `/atividades-por-area/${s.area1.id}/registros?empresa_id=${s.e1.id}`, s.token));
    const item = (hist.items ?? hist.registros ?? hist.data ?? []).find((x) => (x.apontamento_id ?? x.id) === ap.id);
    assert.ok(item, JSON.stringify(hist).slice(0, 400));
    assert.equal(item.data_termino, '2027-06-12');
    // Término no mesmo dia do início: vale.
    const r2 = await s.ok({ area_executada_dia: '1', data_termino: '2027-06-10' });
    assert.equal(r2.apontamento.data_termino, '2027-06-10');
    // Sem término (e com null explícito): nulo, como sempre.
    assert.equal((await s.ok({ area_executada_dia: '1' })).apontamento.data_termino, null);
    assert.equal((await s.ok({ area_executada_dia: '1', data_termino: null })).apontamento.data_termino, null);
  });

  test('antes do início → 400 data_termino; no futuro da fazenda → 422 futura; formato errado → 400; dia inexistente → 422; nada gravado', async () => {
    const s = await montar();
    assert.deepEqual(erro(await s.registrar({ area_executada_dia: '3', data_termino: '2027-06-09' })), [400, 'REQUEST_VALIDATION_FAILED', 'data_termino', 'periodo_invertido']);
    assert.deepEqual(erro(await s.registrar({ area_executada_dia: '3', data_termino: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_termino', 'futura']);
    for (const ruim of ['12/06/2027', '2027-6-12', 7]) {
      const r = await s.registrar({ area_executada_dia: '3', data_termino: ruim });
      assert.equal(r.statusCode, 400, `${ruim} ${r.body}`);
    }
    assert.equal((await s.registrar({ area_executada_dia: '3', data_termino: '2027-02-30' })).statusCode, 422);
    await s.nada();
  });

  test('o CHECK do banco também recusa término antes do início (a regra não depende só da API)', async () => {
    const s = await montar();
    const r = await s.ok({ area_executada_dia: '3' });
    await assert.rejects(
      prisma().$executeRawUnsafe(`UPDATE "AtividadeApontamento" SET "data_termino" = DATE '2027-06-09' WHERE id = $1`, r.apontamento.id),
      /AtividadeApontamento_data_termino_check/,
    );
  });

  test('várias áreas: todos os apontamentos ficam com o MESMO término', async () => {
    const s = await montar();
    const a = await s.novaArea('PASTO DA AROEIRA', '38');
    const b = await s.novaArea('PASTO DO AÇUDE', '27.3');
    const corpo = { ...s.base, operation_id: opId('reg'), data_termino: '2027-06-14', areas: [{ area_id: a.id, hectares: '38' }, { area_id: b.id, hectares: '10' }, { area_id: s.area1.id, hectares: '5' }] };
    delete corpo.area_id;
    const r = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(r.statusCode, 201, r.body);
    const j = r.json();
    assert.equal(j.apontamentos.length, 3);
    assert.deepEqual(j.apontamentos.map((x) => x.data_termino), ['2027-06-14', '2027-06-14', '2027-06-14']);
    const aps = await s.apontamentos();
    assert.deepEqual(aps.map((x) => s.dia(x.data_termino)), ['2027-06-14', '2027-06-14', '2027-06-14']);
    // Reenvio igual (várias áreas, com término) → replay, nada novo.
    const de_novo = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(de_novo.statusCode, 200, de_novo.body);
    assert.equal(de_novo.json().replay, true);
    assert.equal((await s.apontamentos()).length, 3);
  });

  test('idempotência: sem o campo, o recibo guarda o fingerprint da fórmula de ANTES (byte a byte) e o reenvio casa — também com null; com o término mexido → 409', async () => {
    const s = await montar();
    const operation_id = opId('idem');
    const corpo = { ...s.base, operation_id, area_executada_dia: '3', turno: 'MANHA', observacao: 'gradeou', produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '2' }] };
    const um = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(um.statusCode, 201, um.body);
    // A fórmula de antes da D-PROD-265 (copiada do serviço daquela época), sem nenhuma chave nova.
    const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
    const linhas = linhasDoCorpo(corpo);
    const antes = fingerprintDePayload({
      v: 1, empresa_id: corpo.empresa_id, area_id: corpo.area_id, tipo_atividade_id: corpo.tipo_atividade_id, safra_ciclo: null, estado, origem: origemDoCorpo(corpo.origem),
      produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas),
    });
    const recibo = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, operation_key: operation_id, tipo_operacao: TIPO_OPERACAO_REGISTRAR } });
    assert.ok(recibo);
    assert.equal(recibo.fingerprint, antes, 'sem data_termino, o fingerprint é o de antes: o reenvio pendente feito antes do deploy ainda casa');
    // Simula o recibo gravado ANTES do deploy (o mesmo valor) e reenvia: replay, sem nada novo — com e sem `data_termino: null`.
    for (const extra of [{}, { data_termino: null }]) {
      const r = await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo, ...extra });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().replay, true);
    }
    assert.equal((await s.apontamentos()).length, 1);
    // A mesma chave com término → corpo diferente → 409.
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo, data_termino: '2027-06-11' })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    // Com término, ele entra no fingerprint: o reenvio igual casa, outro término com a mesma chave → 409.
    const op2 = opId('idem2');
    const dois = await s.H.req('POST', '/atividades/registrar', s.token, { ...s.base, operation_id: op2, area_executada_dia: '1', data_termino: '2027-06-11' });
    assert.equal(dois.statusCode, 201, dois.body);
    const tres = await s.H.req('POST', '/atividades/registrar', s.token, { ...s.base, operation_id: op2, area_executada_dia: '1', data_termino: '2027-06-11' });
    assert.equal(tres.statusCode, 200, tres.body);
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, { ...s.base, operation_id: op2, area_executada_dia: '1', data_termino: '2027-06-12' })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, { ...s.base, operation_id: op2, area_executada_dia: '1' })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
  });

  test('editar o lançamento: a data não passa do término gravado (422 depois_do_termino); até o término vale; o POST …/apontamentos não recebe o campo', async () => {
    const s = await montar();
    const r = await s.ok({ area_executada_dia: '3', data_termino: '2027-06-12' });
    const ap = r.apontamento;
    const url = `/atividades/${r.registro.atividade_id}/apontamentos/${ap.id}`;
    assert.deepEqual(erro(await s.H.req('PATCH', url, s.token, { empresa_id: s.e1.id, versao: ap.versao, data_operacional: '2027-06-13' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_operacional', 'depois_do_termino']);
    const editado = await s.H.ok(s.H.req('PATCH', url, s.token, { empresa_id: s.e1.id, versao: ap.versao, data_operacional: '2027-06-12' }));
    assert.equal((editado.apontamento ?? editado).data_operacional, '2027-06-12');
    assert.equal((editado.apontamento ?? editado).data_termino, '2027-06-12');
    // O lançamento direto na atividade (fora do registro de campo) continua sem o campo: 400 do corpo fechado.
    const direto = await s.H.req('POST', `/atividades/${r.registro.atividade_id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-10', data_termino: '2027-06-11' });
    assert.equal(direto.statusCode, 400, direto.body);
  });
});
