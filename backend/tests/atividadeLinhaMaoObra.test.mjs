/**
 * D-PROD-203 (Fatia 4 do Lançamento de Atividades) — LINHAS DE MÃO DE OBRA do
 * apontamento (`/atividades/:id/apontamentos/:apontamentoId/mao-obra…`), o
 * seletor `/atividades-opcoes/funcionarios`, o lançamento/repetição com
 * `mao_obra[]` e o totalizador com as QUATRO linhas, contra PostgreSQL real e
 * HTTP autenticado (`app.inject`). Contrato:
 * docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md §3, §5, §6 e §9.
 *
 * Cobre: hora e diária com custo SNAPSHOT do cadastro (o corpo não aceita
 * custo); tarefa com custo digitado (obrigatório); funcionário sem custo →
 * linha sem custo; `permite_mao_obra` desligado recusa; funcionário inativo,
 * de outra fazenda e de outro tenant; editar = cancelar + nova; cancelar com
 * motivo; cascatas do apontamento e da atividade; idempotência e replay; CAS e
 * status; a data travada com linha; lançar e repetir com `mao_obra[]`; os
 * totais e o custo/ha com produto + máquina + mão de obra + serviço; isolamento
 * por tenant; nada de financeiro.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, foto, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { montarPatrimonio } from './patrimonioP1Cenario.mjs';

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

/** Os campos da linha de mão de obra, na ordem da forma pública. */
const CAMPOS_LINHA = [
  'id', 'empresa_id', 'apontamento_id', 'ordem', 'status', 'funcionario_id', 'funcionario', 'tipo_medida', 'quantidade',
  'custo_unitario', 'custo_total', 'observacao', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento', 'cancelamento_origem',
  'criado_por', 'createdAt', 'updatedAt',
];

const montar = async () => {
  const s = await montarLinhasCusto(app);
  return { ...s, M: s.acoesDaLinha('mao-obra') };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('custo da mão de obra', () => {
  test('HORA: 201, forma pública, custo snapshot do custo_hora, versão + 1, auditoria sem texto livre; o cadastro mudar depois não muda a linha; lista e detalhe trazem mao_obra[]', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const c = await s.M.lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8', observacao: 'texto secreto' });
    assert.deepEqual(Object.keys(c), ['apontamento', 'atividade', 'alertas', 'mao_obra']);
    assert.deepEqual(Object.keys(c.mao_obra), CAMPOS_LINHA);
    const l = c.mao_obra;
    assert.deepEqual(
      [l.status, l.ordem, l.tipo_medida, l.quantidade, l.custo_unitario, l.custo_total, l.empresa_id, l.criado_por.id],
      ['CONFIRMADO', 1, 'HORA', '8.0000', '25.5000', '204.0000', s.e1.id, s.adm.usuario.id]
    );
    assert.deepEqual(l.funcionario, { id: s.joao.id, numero: s.joao.numero, nome: 'João Diarista', cargo: 'Tratorista', tipo: 'DIARISTA', custo_hora: '25.5000', custo_diaria: '180.0000' });
    assert.equal(c.apontamento.versao, 2, 'a versão do apontamento sobe uma vez');
    assert.deepEqual(c.apontamento.mao_obra.map((x) => x.id), [l.id]);
    assert.deepEqual([c.apontamento.servicos, c.apontamento.produtos, c.apontamento.maquinas], [[], [], []]);
    assert.deepEqual(c.alertas, []);
    assert.equal(c.atividade.id, s.atividade.id);
    await prisma().funcionario.update({ where: { id: s.joao.id }, data: { custo_hora: '99' } });
    const detalhe = await s.H.ok(s.H.req('GET', `${s.baseAp(s.atividade)}/${ap.id}?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual([detalhe.mao_obra[0].custo_unitario, detalhe.mao_obra[0].custo_total], ['25.5000', '204.0000'], 'snapshot');
    assert.equal(detalhe.mao_obra[0].funcionario.custo_hora, '99.0000', 'o resumo do funcionário traz o custo ATUAL do cadastro (a prévia da tela)');
    const lista = await s.H.ok(s.H.req('GET', `${s.baseAp(s.atividade)}?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(lista.items[0].mao_obra.map((x) => x.id), [l.id]);
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoMaoObra' } });
    assert.deepEqual(au.map((x) => [x.acao, x.entidade_id]), [['atividade_mao_obra.lancar', l.id]]);
    assert.ok(!JSON.stringify(au).includes('texto secreto'));
    assert.equal(au[0].dados_novos.tem_observacao, true);
    assert.deepEqual([await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), await prisma().tituloFinanceiro.count({ where: { cliente_id: s.c } })], [0, 0], 'nada de financeiro');
  });

  test('DIARIA: snapshot do custo_diaria; sem custo no cadastro → custo nulo; hora/diária não aceitam custo no corpo; TAREFA exige custo digitado', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const d = (await s.M.lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1.5' })).mao_obra;
    assert.deepEqual([d.tipo_medida, d.quantidade, d.custo_unitario, d.custo_total], ['DIARIA', '1.5000', '180.0000', '270.0000']);
    const sem = (await s.M.lancarOk(ap, { funcionario_id: s.pedro.id, tipo_medida: 'HORA', quantidade: '8' })).mao_obra;
    assert.deepEqual([sem.custo_unitario, sem.custo_total], [null, null], 'a linha entra, sem custo');
    const f = await foto(s.c);
    assert.deepEqual(
      erro(await s.M.lancar(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8', custo_unitario: '1' })),
      [422, 'ATIVIDADE_LINHA_INVALIDA', 'custo_unitario', 'nao_aceito']
    );
    assert.deepEqual(
      erro(await s.M.lancar(ap, { funcionario_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '3' })),
      [422, 'ATIVIDADE_LINHA_INVALIDA', 'custo_unitario', 'obrigatorio']
    );
    assert.deepEqual(erro(await s.M.lancar(ap, { funcionario_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '0', custo_unitario: '5' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'quantidade', 'nao_positiva']);
    assert.equal(await foto(s.c), f, 'nada gravado nas recusas');
    const t = (await s.M.lancarOk(ap, { funcionario_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '3', custo_unitario: '35.5' })).mao_obra;
    assert.deepEqual([t.tipo_medida, t.custo_unitario, t.custo_total], ['TAREFA', '35.5000', '106.5000']);
    const zero = (await s.M.lancarOk(ap, { funcionario_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '1', custo_unitario: '0' })).mao_obra;
    assert.deepEqual([zero.custo_unitario, zero.custo_total], ['0.0000', '0.0000']);
    // CHECK: custo unitário e total andam juntos.
    const linhas = await prisma().atividadeApontamentoMaoObra.findMany({ where: { cliente_id: s.c } });
    assert.ok(linhas.every((x) => (x.custo_unitario === null) === (x.custo_total === null)));
  });

  test('permite_mao_obra desligado → 422 ATIVIDADE_EXIGIDA_PELO_TIPO; funcionário inativo, de outra fazenda ou de outro tenant; decimal como número e campo fora do schema → 400', async () => {
    const s = await montar();
    const semFlag = await s.abrir({ tipo_atividade_id: s.tipoSem.id });
    const apSem = await s.apontar({}, { a: semFlag });
    const f = await foto(s.c);
    const r = await s.M.lancar(apSem, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' }, { a: semFlag });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'funcionario_id', 'permite_mao_obra']);
    assert.equal(r.json().details.entidade, 'linha_mao_obra');
    const ap = await s.apontar();
    const f2 = await foto(s.c);
    assert.deepEqual(erro(await s.M.lancar(ap, { funcionario_id: s.inativo.id, tipo_medida: 'HORA', quantidade: '8' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'funcionario_id', 'inativo']);
    assert.deepEqual(erro(await s.M.lancar(ap, { funcionario_id: s.daE2.id, tipo_medida: 'HORA', quantidade: '8' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'funcionario_id', 'outra_empresa']);
    const b = await montarPatrimonio(app);
    const deB = await prisma().funcionario.create({ data: { cliente_id: b.c, empresa_id: b.e1.id, numero: 'FB-1', nome: 'Funcionário do outro tenant', tipo: 'DIARISTA', custo_hora: '1' } });
    assert.deepEqual(erro(await s.M.lancar(ap, { funcionario_id: deB.id, tipo_medida: 'HORA', quantidade: '8' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'funcionario_id', 'inexistente']);
    assert.deepEqual(erro(await s.M.lancar(ap, { funcionario_id: 'nao-existe', tipo_medida: 'HORA', quantidade: '8' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'funcionario_id', 'inexistente']);
    assert.deepEqual(erro(await s.M.lancar(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: 8 })), [400, 'REQUEST_VALIDATION_FAILED', 'quantidade', 'valor_deve_ser_texto']);
    assert.equal((await s.M.lancar(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8', custo_total: '1' })).statusCode, 400, 'schema fechado');
    assert.equal((await s.M.lancar(ap, { funcionario_id: s.joao.id, tipo_medida: 'MENSAL', quantidade: '8' })).statusCode, 400);
    assert.equal(await foto(s.c), f2);
    assert.notEqual(f, f2, 'só o apontamento novo mudou entre as fotos');
  });
});

describe('editar e cancelar', () => {
  test('editar = cancelar a linha (EDICAO) + linha nova; trocar para HORA descarta o custo da tarefa; funcionário gravado e depois inativado pode ficar; a cancelada não edita', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l1 = (await s.M.lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'TAREFA', quantidade: '2', custo_unitario: '50' })).mao_obra;
    const r = await s.M.editar(ap, l1.id, { tipo_medida: 'HORA', quantidade: '4', observacao: 'corrigido' });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    assert.notEqual(c.mao_obra.id, l1.id);
    assert.deepEqual([c.mao_obra.status, c.mao_obra.ordem, c.mao_obra.tipo_medida, c.mao_obra.custo_unitario, c.mao_obra.custo_total, c.mao_obra.observacao], ['CONFIRMADO', 2, 'HORA', '25.5000', '102.0000', 'corrigido']);
    const velha = c.apontamento.mao_obra.find((x) => x.id === l1.id);
    assert.deepEqual([velha.status, velha.cancelamento_origem, velha.motivo_cancelamento], ['CANCELADO', 'EDICAO', 'linha editada: substituída por uma linha nova']);
    assert.equal(c.apontamento.versao, 3);
    assert.deepEqual(erro(await s.M.editar(ap, c.mao_obra.id, { custo_unitario: '10' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'custo_unitario', 'nao_aceito']);
    await prisma().funcionario.update({ where: { id: s.joao.id }, data: { ativo: false } });
    const r2 = await s.M.editar(ap, c.mao_obra.id, { quantidade: '5' });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().mao_obra.custo_total, '127.5000');
    assert.deepEqual(erro(await s.M.editar(ap, r2.json().mao_obra.id, { funcionario_id: s.inativo.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'funcionario_id', 'inativo'], 'vínculo NOVO tem de estar ativo');
    assert.deepEqual(erro(await s.M.editar(ap, l1.id, { quantidade: '9' })).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoMaoObra' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(au.map((x) => x.acao), ['atividade_mao_obra.lancar', 'atividade_mao_obra.editar', 'atividade_mao_obra.editar']);
    assert.equal(au[1].dados_novos.substitui_linha_id, l1.id);
  });

  test('cancelar com motivo (3..500), origem LINHA; linha de outro apontamento → 404; cancelada de novo → 409', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l = (await s.M.lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' })).mao_obra;
    assert.deepEqual(erro(await s.M.cancelar(ap, l.id, { motivo: 'x' })), [422, 'ATIVIDADE_MOTIVO_INVALIDO', 'motivo', 'curto']);
    const outro = await s.apontar({ data_operacional: '2027-06-11' });
    const nf = await s.M.cancelar(outro, l.id);
    assert.deepEqual(erro(nf).slice(0, 2), [404, 'ATIVIDADE_LINHA_NOT_FOUND']);
    assert.equal(nf.json().details.entidade, 'linha_mao_obra');
    const c = await s.H.ok(s.M.cancelar(ap, l.id, { motivo: 'funcionário errado' }));
    assert.deepEqual([c.mao_obra.status, c.mao_obra.cancelamento_origem, c.mao_obra.motivo_cancelamento, c.mao_obra.cancelado_por.id], ['CANCELADO', 'LINHA', 'funcionário errado', s.adm.usuario.id]);
    const de = await s.M.cancelar(ap, l.id);
    assert.deepEqual(erro(de).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.equal(de.json().details.entidade, 'linha_mao_obra');
  });

  test('cascatas: cancelar o apontamento cancela as linhas (APONTAMENTO); cancelar a atividade cancela as dos outros apontamentos (ATIVIDADE)', async () => {
    const s = await montar();
    const ap1 = await s.apontar();
    const ap2 = await s.apontar({ data_operacional: '2027-06-11' });
    await s.M.lancarOk(ap1, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' });
    await s.M.lancarOk(ap1, { funcionario_id: s.pedro.id, tipo_medida: 'DIARIA', quantidade: '1' });
    await s.M.lancarOk(ap2, { funcionario_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1' });
    const c = await s.H.ok(s.H.req('POST', `${s.baseAp(s.atividade)}/${ap1.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: await s.versaoDe(ap1.id), motivo: 'dia lançado errado' }));
    assert.deepEqual(c.apontamento.mao_obra.map((x) => [x.status, x.cancelamento_origem, x.motivo_cancelamento]), [['CANCELADO', 'APONTAMENTO', 'dia lançado errado'], ['CANCELADO', 'APONTAMENTO', 'dia lançado errado']]);
    const au = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, acao: 'atividade_apontamento.cancelar', entidade_id: ap1.id } });
    assert.equal(au.dados_novos.linhas_canceladas.mao_obra, 2);
    const atv = await s.H.ok(s.H.req('GET', `/atividades/${s.atividade.id}?empresa_id=${s.e1.id}`, s.token));
    await s.H.ok(s.H.req('POST', `/atividades/${s.atividade.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: atv.versao, motivo: 'atividade cancelada' }));
    const l2 = await prisma().atividadeApontamentoMaoObra.findMany({ where: { cliente_id: s.c, apontamento_id: ap2.id } });
    assert.deepEqual(l2.map((x) => [x.status, x.cancelamento_origem, x.motivo_cancelamento]), [['CANCELADO', 'ATIVIDADE', 'atividade cancelada']]);
  });
});

describe('proteções', () => {
  test('idempotência: reenvio igual devolve a resposta gravada (uma linha só); corpo diferente → 409; a mesma chave em outra operação → 409', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const operation_id = opId('mo');
    const corpo = { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' };
    const r1 = await s.M.lancar(ap, corpo, { operation_id, versao: 1 });
    assert.equal(r1.statusCode, 201, r1.body);
    const r2 = await s.M.lancar(ap, corpo, { operation_id, versao: 1 });
    assert.equal(r2.statusCode, 201);
    assert.deepEqual(r2.json(), r1.json(), 'o recibo é conferido antes da versão');
    assert.equal(await prisma().atividadeApontamentoMaoObra.count({ where: { cliente_id: s.c } }), 1);
    assert.deepEqual(erro(await s.M.lancar(ap, { ...corpo, quantidade: '9' }, { operation_id, versao: 1 })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.deepEqual(erro(await s.M.editar(ap, r1.json().mao_obra.id, { quantidade: '7' }, { operation_id })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal(await prisma().atividadeApontamentoMaoObra.count({ where: { cliente_id: s.c } }), 1);
    const conflito = await prisma().auditLog.count({ where: { cliente_id: s.c, acao: 'atividade_mao_obra.reenvio_conflitante' } });
    assert.ok(conflito >= 1);
  });

  test('CAS pela versão do apontamento; status do apontamento e da atividade', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const corpo = { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' };
    await s.M.lancarOk(ap, corpo);
    const r = await s.M.lancar(ap, corpo, { versao: 1 });
    assert.deepEqual(erro(r).slice(0, 2), [409, 'ATIVIDADE_VERSAO_CONFLITO']);
    assert.deepEqual([r.json().details.versao_atual, r.json().details.entidade], [2, 'apontamento']);
    await prisma().atividadeApontamento.update({
      where: { id: ap.id },
      data: { status: 'CANCELADO', cancelado_em: new Date(), cancelado_por_usuario_id: s.adm.usuario.id, motivo_cancelamento: 'teste' },
    });
    const r2 = await s.M.lancar(ap, corpo);
    assert.deepEqual([...erro(r2).slice(0, 2), r2.json().details.entidade], [409, 'ATIVIDADE_STATUS_INVALIDO', 'apontamento']);
    const ap2 = await s.apontar({ data_operacional: '2027-06-11' });
    await prisma().atividade.update({ where: { id: s.atividade.id }, data: { status: 'CONCLUIDA', data_conclusao: new Date('2027-06-12T00:00:00Z'), concluida_em: new Date(), concluida_por_usuario_id: s.adm.usuario.id } });
    const r3 = await s.M.lancar(ap2, corpo);
    assert.deepEqual([...erro(r3).slice(0, 2), r3.json().details.entidade], [409, 'ATIVIDADE_STATUS_INVALIDO', 'atividade']);
  });

  test('a data do apontamento não muda com linha de mão de obra confirmada (409); cancelada a linha, muda', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l = (await s.M.lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' })).mao_obra;
    const patch = async (dia) => s.H.req('PATCH', `${s.baseAp(s.atividade)}/${ap.id}`, s.token, { empresa_id: s.e1.id, versao: await s.versaoDe(ap.id), data_operacional: dia });
    const r = await patch('2027-06-12');
    assert.deepEqual(erro(r), [409, 'ATIVIDADE_DATA_COM_LINHAS', 'data_operacional', 'data_com_linhas']);
    assert.deepEqual(
      [r.json().details.linhas_produto, r.json().details.linhas_maquina, r.json().details.linhas_mao_obra, r.json().details.linhas_servico],
      [0, 0, 1, 0]
    );
    await s.H.ok(s.M.cancelar(ap, l.id));
    assert.equal((await patch('2027-06-12')).statusCode, 200);
  });

  test('isolamento: outro tenant → 404; sem a ação de lançar → 403; o seletor é da guarda de ver e só traz ativos da fazenda', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l = (await s.M.lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' })).mao_obra;
    const b = await montarPatrimonio(app);
    const f = await foto(s.c);
    const r = await s.H.req('POST', `${s.baseAp(s.atividade)}/${ap.id}/mao-obra`, b.token, {
      empresa_id: b.e1.id, versao: 2, operation_id: opId(), funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '1',
    });
    assert.deepEqual(erro(r).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    const r2 = await s.H.req('POST', `${s.baseAp(s.atividade)}/${ap.id}/mao-obra/${l.id}/cancelar`, b.token, { empresa_id: b.e1.id, versao: 2, operation_id: opId(), motivo: 'invasão' });
    assert.deepEqual(erro(r2).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    assert.equal((await s.H.req('GET', `/atividades-opcoes/funcionarios?empresa_id=${s.e1.id}`, b.token)).statusCode, 404, 'a empresa não é do tenant da sessão');
    assert.equal(await foto(s.c), f);
    const leitor = await s.contaTela();
    assert.equal((await s.M.lancar(ap, { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '1' }, { tok: leitor.token })).statusCode, 403);
    const op = await s.H.ok(s.H.req('GET', `/atividades-opcoes/funcionarios?empresa_id=${s.e1.id}`, leitor.token));
    assert.deepEqual(Object.keys(op), ['itens', 'has_more', 'next_cursor']);
    assert.deepEqual(op.itens.map((x) => x.nome), ['João Diarista', 'Pedro Sem Custo', 'Tião Tarefeiro']);
    assert.deepEqual(op.itens[0], { id: s.joao.id, numero: s.joao.numero, nome: 'João Diarista', cargo: 'Tratorista', tipo: 'DIARISTA', custo_hora: '25.5000', custo_diaria: '180.0000' });
    assert.deepEqual(op.itens[1].custo_hora, null);
    const busca = await s.H.ok(s.H.req('GET', `/atividades-opcoes/funcionarios?empresa_id=${s.e1.id}&q=trator`, s.token));
    assert.deepEqual(busca.itens.map((x) => x.id), [s.joao.id], 'q também no cargo');
    const p1 = await s.H.ok(s.H.req('GET', `/atividades-opcoes/funcionarios?empresa_id=${s.e1.id}&limit=2`, s.token));
    const p2 = await s.H.ok(s.H.req('GET', `/atividades-opcoes/funcionarios?empresa_id=${s.e1.id}&limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`, s.token));
    assert.deepEqual([p1.has_more, p2.itens.map((x) => x.nome), p2.has_more], [true, ['Tião Tarefeiro'], false]);
  });
});

describe('lançar e repetir com mao_obra[]', () => {
  test('POST …/apontamentos com mao_obra[]: tudo numa transação com UMA operation_id (chaves :o<n>); replay; linha recusada não grava nem o apontamento; sem chave → 400', async () => {
    const s = await montar();
    const op = opId('lanc');
    const corpo = {
      operation_id: op,
      mao_obra: [
        { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' },
        { funcionario_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '2', custo_unitario: '40' },
      ],
    };
    const r = await s.lancarAp(corpo);
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(c.apontamento.mao_obra.map((l) => [l.ordem, l.funcionario_id, l.custo_total]), [[1, s.joao.id, '204.0000'], [2, s.tiao.id, '80.0000']]);
    assert.equal(c.apontamento.versao, 1);
    const ops = (await prisma().atividadeApontamentoMaoObra.findMany({ where: { cliente_id: s.c }, orderBy: { ordem: 'asc' } })).map((l) => l.operation_id);
    assert.deepEqual(ops, [`${op}:o1`, `${op}:o2`]);
    const re = await s.lancarAp(corpo);
    assert.deepEqual([re.statusCode, re.json().replay, re.json().apontamento.id], [200, true, c.apontamento.id]);
    assert.deepEqual(erro(await s.lancarAp({ ...corpo, mao_obra: [corpo.mao_obra[0]] })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    const f = await foto(s.c);
    const ruim = await s.lancarAp({ operation_id: opId('lanc'), mao_obra: [corpo.mao_obra[0], { funcionario_id: s.daE2.id, tipo_medida: 'HORA', quantidade: '1' }] });
    assert.deepEqual(erro(ruim), [422, 'ATIVIDADE_LINHA_INVALIDA', 'funcionario_id', 'outra_empresa']);
    assert.equal(ruim.json().details.linha_indice, 1);
    assert.equal(await foto(s.c), f, 'nada gravado: nem o apontamento');
    assert.deepEqual(erro(await s.lancarAp({ mao_obra: corpo.mao_obra })), [400, 'REQUEST_VALIDATION_FAILED', 'operation_id', 'obrigatorio']);
    assert.deepEqual(erro(await s.lancarAp({ operation_id: opId(), mao_obra: [{ ...corpo.mao_obra[0], quantidade: 8 }] })), [400, 'REQUEST_VALIDATION_FAILED', 'mao_obra[0].quantidade', 'valor_deve_ser_texto']);
    assert.equal((await s.lancarAp({ operation_id: opId(), mao_obra: [{ ...corpo.mao_obra[0], custo_total: '1' }] })).statusCode, 400, 'item fechado');
    const semFlag = await s.abrir({ tipo_atividade_id: s.tipoSem.id });
    assert.deepEqual(erro(await s.lancarAp({ operation_id: opId(), mao_obra: [corpo.mao_obra[0]] }, { a: semFlag })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'funcionario_id', 'permite_mao_obra']);
  });

  test('repetir (duplicar) com mao_obra[]: apontamento novo com as linhas do corpo; replay', async () => {
    const s = await montar();
    const base = await s.apontar({ operation_id: opId(), mao_obra: [{ funcionario_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1' }] });
    const op = opId('dup');
    const corpo = { empresa_id: s.e1.id, data_operacional: '2027-06-11', operation_id: op, mao_obra: [{ funcionario_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '2' }] };
    const r = await s.H.req('POST', `${s.baseAp(s.atividade)}/${base.id}/duplicar`, s.token, corpo);
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.notEqual(c.apontamento.id, base.id);
    assert.deepEqual(c.apontamento.mao_obra.map((l) => [l.quantidade, l.custo_total]), [['2.0000', '360.0000']]);
    const re = await s.H.req('POST', `${s.baseAp(s.atividade)}/${base.id}/duplicar`, s.token, corpo);
    assert.deepEqual([re.statusCode, re.json().replay, re.json().apontamento.id], [200, true, c.apontamento.id]);
    const au = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, acao: 'atividade_apontamento.duplicar' } });
    assert.deepEqual(au.dados_novos.linhas_mao_obra, [c.apontamento.mao_obra[0].id]);
  });
});

describe('totais da atividade com as quatro linhas', () => {
  test('custo_total e custo_por_ha somam produto + máquina + mão de obra + serviço; só linhas confirmadas de apontamentos confirmados', async () => {
    const s = await montar();
    await prisma().bemPatrimonial.update({ where: { id: s.gerador.id }, data: { custo_uso_unitario: '40' } });
    const ap = await s.apontar({
      area_executada_dia: '10',
      operation_id: opId('tot'),
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '10' }],
      maquinas: [{ bem_id: s.gerador.id, quantidade_uso: '2' }],
      mao_obra: [
        { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' },
        { funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '2' },
        { funcionario_id: s.pedro.id, tipo_medida: 'DIARIA', quantidade: '1' },
      ],
      servicos: [{ servico_id: s.gradagem.id, quantidade: '10', valor_unitario: '150' }],
    });
    assert.deepEqual([ap.produtos.length, ap.maquinas.length, ap.mao_obra.length, ap.servicos.length], [1, 1, 3, 1]);
    // Fora da soma: a linha cancelada e o apontamento cancelado.
    const extra = (await s.acoesDaLinha('mao-obra').lancarOk(ap, { funcionario_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1' })).mao_obra;
    await s.H.ok(s.acoesDaLinha('mao-obra').cancelar(ap, extra.id));
    const ap2 = await s.apontar({ data_operacional: '2027-06-11', operation_id: opId(), mao_obra: [{ funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '100' }] });
    await s.H.ok(s.H.req('POST', `${s.baseAp(s.atividade)}/${ap2.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: ap2.versao, motivo: 'dia errado' }));
    const t = await s.totais();
    assert.deepEqual(Object.keys(t), ['area_executada', 'area_planejada', 'unidade_area', 'produtos', 'maquinas', 'mao_obra', 'servicos', 'custo_total', 'custo_por_ha']);
    assert.deepEqual(t.produtos.map((x) => x.custo_total), ['50.0000']);
    assert.deepEqual(t.maquinas.map((x) => x.custo_total), ['80.0000']);
    assert.deepEqual(t.mao_obra, [
      { funcionario_id: s.joao.id, nome: 'João Diarista', tipo_medida: 'HORA', quantidade: '10.0000', custo_total: '255.0000' },
      { funcionario_id: s.pedro.id, nome: 'Pedro Sem Custo', tipo_medida: 'DIARIA', quantidade: '1.0000', custo_total: null },
    ]);
    assert.deepEqual(t.servicos, [{ servico_id: s.gradagem.id, nome: 'Gradagem terceirizada', unidade: 'ha', quantidade: '10.0000', custo_total: '1500.0000' }]);
    assert.deepEqual([t.area_executada, t.custo_total, t.custo_por_ha], ['10.0000', '1885.0000', '188.5000']);
  });

  test('só mão de obra sem custo: custo_total nulo; sem área: custo_por_ha nulo', async () => {
    const s = await montar();
    await s.apontar({ operation_id: opId(), mao_obra: [{ funcionario_id: s.pedro.id, tipo_medida: 'HORA', quantidade: '3' }] });
    const t = await s.totais();
    assert.deepEqual([t.mao_obra.length, t.mao_obra[0].custo_total, t.custo_total, t.custo_por_ha], [1, null, null, null]);
    await s.apontar({ data_operacional: '2027-06-11', operation_id: opId(), mao_obra: [{ funcionario_id: s.joao.id, tipo_medida: 'HORA', quantidade: '2' }] });
    const t2 = await s.totais();
    assert.deepEqual([t2.custo_total, t2.custo_por_ha], ['51.0000', null]);
  });
});
