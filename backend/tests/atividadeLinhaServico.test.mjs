/**
 * D-PROD-203 (Fatia 4 do Lançamento de Atividades) — LINHAS DE SERVIÇO (de
 * terceiro) do apontamento (`/atividades/:id/apontamentos/:apontamentoId/servicos…`),
 * os seletores `/atividades-opcoes/{servicos,parceiros-servico}`, o
 * lançamento/repetição com `servicos[]` e o parceiro "em uso", contra
 * PostgreSQL real e HTTP autenticado (`app.inject`). Contrato:
 * docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md §4, §5, §6 e §9.
 *
 * Cobre: unidade SNAPSHOT da sigla da unidade de medida do serviço;
 * `valor_total = quantidade × valor_unitario`; `valor_unitario` obrigatório;
 * `permite_servico` desligado recusa; serviço inativo, de outra fazenda e de
 * outro tenant; o parceiro (prestador ativo da fazenda, com alias do papel) e
 * a recusa UNIFORME (sem papel, só fornecedor, inativo, de outra fazenda, de
 * outro tenant, inexistente); editar e cancelar; cascatas; idempotência e
 * replay; a data travada; lançar e repetir com `servicos[]`; parceiro usado em
 * linha não é excluído (409 `PARCEIRO_EM_USO`); os seletores sem documento do
 * parceiro; isolamento por tenant; nada de financeiro.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, foto, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { corpoErro, montarPatrimonio } from './patrimonioP1Cenario.mjs';

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

/** Os campos da linha de serviço, na ordem da forma pública. */
const CAMPOS_LINHA = [
  'id', 'empresa_id', 'apontamento_id', 'ordem', 'status', 'servico_id', 'servico', 'fornecedor_parceiro_id', 'parceiro',
  'quantidade', 'unidade', 'valor_unitario', 'valor_total', 'documento_referencia', 'observacao',
  'cancelado_em', 'cancelado_por', 'motivo_cancelamento', 'cancelamento_origem', 'criado_por', 'createdAt', 'updatedAt',
];

const montar = async () => {
  const s = await montarLinhasCusto(app);
  return { ...s, S: s.acoesDaLinha('servicos') };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('lançar', () => {
  test('201: forma pública, unidade snapshot da sigla, valor total, parceiro só com id e nome, versão + 1, auditoria sem texto livre; a sigla mudar depois não muda a linha', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const c = await s.S.lancarOk(ap, {
      servico_id: s.gradagem.id, quantidade: '2.5', valor_unitario: '150', fornecedor_parceiro_id: s.prestador.id, documento_referencia: 'NF 123', observacao: 'texto secreto',
    });
    assert.deepEqual(Object.keys(c), ['apontamento', 'atividade', 'alertas', 'servico']);
    assert.deepEqual(Object.keys(c.servico), CAMPOS_LINHA);
    const l = c.servico;
    assert.deepEqual(
      [l.status, l.ordem, l.quantidade, l.unidade, l.valor_unitario, l.valor_total, l.documento_referencia, l.fornecedor_parceiro_id],
      ['CONFIRMADO', 1, '2.5000', 'ha', '150.0000', '375.0000', 'NF 123', s.prestador.id]
    );
    assert.deepEqual(l.servico, { id: s.gradagem.id, numero: s.gradagem.numero, nome: 'Gradagem terceirizada' });
    assert.deepEqual(l.parceiro, { id: s.prestador.id, nome: 'Prestadora Terra Boa' });
    assert.equal(c.apontamento.versao, 2);
    assert.deepEqual(c.apontamento.servicos.map((x) => x.id), [l.id]);
    await prisma().unidadeMedida.update({ where: { id: s.unidade.id }, data: { sigla: 'HA' } });
    const detalhe = await s.H.ok(s.H.req('GET', `${s.baseAp(s.atividade)}/${ap.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(detalhe.servicos[0].unidade, 'ha', 'snapshot');
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoServico' } });
    assert.deepEqual(au.map((x) => [x.acao, x.entidade_id]), [['atividade_servico.lancar', l.id]]);
    assert.ok(!JSON.stringify(au).includes('texto secreto') && !JSON.stringify(au).includes('NF 123'));
    assert.deepEqual([au[0].dados_novos.tem_observacao, au[0].dados_novos.tem_documento_referencia], [true, true]);
    assert.deepEqual([await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), await prisma().tituloFinanceiro.count({ where: { cliente_id: s.c } })], [0, 0], 'nada de financeiro');
    const sem = (await s.S.lancarOk(ap, { servico_id: s.horaTrator.id, quantidade: '3', valor_unitario: '0' })).servico;
    assert.deepEqual([sem.unidade, sem.valor_total, sem.parceiro, sem.fornecedor_parceiro_id], ['h', '0.0000', null, null]);
  });

  test('valor_unitario obrigatório; permite_servico desligado; serviço inativo, de outra fazenda e de outro tenant; número → 400; unidade no corpo → 400', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const f = await foto(s.c);
    assert.deepEqual(erro(await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: null })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'valor_unitario', 'obrigatorio']);
    assert.equal((await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1' })).statusCode, 400, 'schema exige valor_unitario');
    assert.deepEqual(erro(await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '0', valor_unitario: '1' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'quantidade', 'nao_positiva']);
    assert.deepEqual(erro(await s.S.lancar(ap, { servico_id: s.servicoInativo.id, quantidade: '1', valor_unitario: '1' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'servico_id', 'inativo']);
    assert.deepEqual(erro(await s.S.lancar(ap, { servico_id: s.servicoE2.id, quantidade: '1', valor_unitario: '1' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'servico_id', 'outra_empresa']);
    const b = await montarPatrimonio(app);
    const ub = await prisma().unidadeMedida.create({ data: { cliente_id: b.c, numero_unidade: 'UB', sigla: 'un', descricao: 'Unidade' } });
    const sb = await prisma().servico.create({ data: { cliente_id: b.c, empresa_id: b.e1.id, numero: 'SB-1', nome: 'Serviço B', unidade_medida_id: ub.id } });
    assert.deepEqual(erro(await s.S.lancar(ap, { servico_id: sb.id, quantidade: '1', valor_unitario: '1' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'servico_id', 'inexistente']);
    assert.deepEqual(erro(await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: 150 })), [400, 'REQUEST_VALIDATION_FAILED', 'valor_unitario', 'valor_deve_ser_texto']);
    assert.equal((await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1', unidade: 'kg' })).statusCode, 400, 'a unidade é do serviço');
    assert.equal((await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1', documento_referencia: 'x'.repeat(121) })).statusCode, 400);
    assert.equal(await foto(s.c), f, 'nada gravado');
    const semFlag = await s.abrir({ tipo_atividade_id: s.tipoSem.id });
    const apSem = await s.apontar({}, { a: semFlag });
    const r = await s.S.lancar(apSem, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1' }, { a: semFlag });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'servico_id', 'permite_servico']);
    assert.equal(r.json().details.entidade, 'linha_servico');
  });

  test('parceiro: prestador ativo da fazenda (também pelo alias do papel); qualquer outro caso → a MESMA recusa, sem oráculo', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const base = { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '10' };
    assert.equal((await s.S.lancarOk(ap, { ...base, fornecedor_parceiro_id: s.prestadorAlias.id })).servico.parceiro.nome, 'Empreiteira Alias');
    const b = await montarPatrimonio(app);
    const deB = await prisma().fornecedor.create({ data: { cliente_id: b.c, empresa_id: b.e1.id, numero_cadastro: 'PB-1', tipo_pessoa: 'Jurídica', nome: 'Prestadora B', tipos: ['prestador_servico'] } });
    const f = await foto(s.c);
    const recusas = [];
    for (const id of [s.soFornecedor.id, s.semPapel.id, s.prestadorInativo.id, s.prestadorE2.id, deB.id, 'nao-existe']) {
      const r = await s.S.lancar(ap, { ...base, fornecedor_parceiro_id: id });
      assert.deepEqual(erro(r), [422, 'ATIVIDADE_LINHA_INVALIDA', 'fornecedor_parceiro_id', 'parceiro_invalido'], r.body);
      recusas.push(corpoErro(r));
    }
    assert.ok(recusas.every((x) => JSON.stringify(x) === JSON.stringify(recusas[0])), 'o corpo da recusa é idêntico em todos os casos');
    assert.equal(await foto(s.c), f);
  });
});

describe('editar e cancelar', () => {
  test('editar = cancelar (EDICAO) + nova; manter o parceiro depois inativado pode; trocar por um sem papel → 422; limpar o parceiro; a cancelada não edita', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l1 = (await s.S.lancarOk(ap, { servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '100', fornecedor_parceiro_id: s.prestador.id })).servico;
    await prisma().fornecedor.update({ where: { id: s.prestador.id }, data: { ativo: false } });
    const r = await s.S.editar(ap, l1.id, { quantidade: '3' });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    assert.deepEqual([c.servico.ordem, c.servico.quantidade, c.servico.valor_total, c.servico.fornecedor_parceiro_id], [2, '3.0000', '300.0000', s.prestador.id]);
    const velha = c.apontamento.servicos.find((x) => x.id === l1.id);
    assert.deepEqual([velha.status, velha.cancelamento_origem], ['CANCELADO', 'EDICAO']);
    assert.deepEqual(erro(await s.S.editar(ap, c.servico.id, { fornecedor_parceiro_id: s.soFornecedor.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'fornecedor_parceiro_id', 'parceiro_invalido']);
    const r2 = await s.H.ok(s.S.editar(ap, c.servico.id, { fornecedor_parceiro_id: null, servico_id: s.horaTrator.id, valor_unitario: '80' }));
    assert.deepEqual([r2.servico.fornecedor_parceiro_id, r2.servico.unidade, r2.servico.valor_total], [null, 'h', '240.0000']);
    assert.deepEqual(erro(await s.S.editar(ap, l1.id, { quantidade: '9' })).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoServico' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(au.map((x) => x.acao), ['atividade_servico.lancar', 'atividade_servico.editar', 'atividade_servico.editar']);
  });

  test('cancelar com motivo (origem LINHA); 404 em outro apontamento; cascatas do apontamento e da atividade', async () => {
    const s = await montar();
    const ap1 = await s.apontar();
    const ap2 = await s.apontar({ data_operacional: '2027-06-11' });
    const l = (await s.S.lancarOk(ap1, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '10' })).servico;
    const nf = await s.S.cancelar(ap2, l.id);
    assert.deepEqual([...erro(nf).slice(0, 2), nf.json().details.entidade], [404, 'ATIVIDADE_LINHA_NOT_FOUND', 'linha_servico']);
    const c = await s.H.ok(s.S.cancelar(ap1, l.id, { motivo: 'serviço errado' }));
    assert.deepEqual([c.servico.status, c.servico.cancelamento_origem, c.servico.motivo_cancelamento], ['CANCELADO', 'LINHA', 'serviço errado']);
    await s.S.lancarOk(ap1, { servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '10' });
    await s.S.lancarOk(ap2, { servico_id: s.gradagem.id, quantidade: '3', valor_unitario: '10' });
    const ca = await s.H.ok(s.H.req('POST', `${s.baseAp(s.atividade)}/${ap1.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: await s.versaoDe(ap1.id), motivo: 'dia errado' }));
    assert.deepEqual(ca.apontamento.servicos.map((x) => [x.status, x.cancelamento_origem]), [['CANCELADO', 'LINHA'], ['CANCELADO', 'APONTAMENTO']]);
    const atv = await s.H.ok(s.H.req('GET', `/atividades/${s.atividade.id}?empresa_id=${s.e1.id}`, s.token));
    await s.H.ok(s.H.req('POST', `/atividades/${s.atividade.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: atv.versao, motivo: 'atividade cancelada' }));
    const l2 = await prisma().atividadeApontamentoServico.findMany({ where: { cliente_id: s.c, apontamento_id: ap2.id } });
    assert.deepEqual(l2.map((x) => [x.status, x.cancelamento_origem]), [['CANCELADO', 'ATIVIDADE']]);
  });
});

describe('proteções', () => {
  test('idempotência e replay; corpo diferente → 409; data travada com linha de serviço; CAS', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const operation_id = opId('sv');
    const corpo = { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '10' };
    const r1 = await s.S.lancar(ap, corpo, { operation_id, versao: 1 });
    assert.equal(r1.statusCode, 201, r1.body);
    const r2 = await s.S.lancar(ap, corpo, { operation_id, versao: 1 });
    assert.deepEqual([r2.statusCode, r2.json()], [201, r1.json()]);
    assert.deepEqual(erro(await s.S.lancar(ap, { ...corpo, valor_unitario: '11' }, { operation_id, versao: 1 })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal(await prisma().atividadeApontamentoServico.count({ where: { cliente_id: s.c } }), 1);
    assert.deepEqual(erro(await s.S.lancar(ap, corpo, { versao: 1 })).slice(0, 2), [409, 'ATIVIDADE_VERSAO_CONFLITO']);
    const patch = await s.H.req('PATCH', `${s.baseAp(s.atividade)}/${ap.id}`, s.token, { empresa_id: s.e1.id, versao: await s.versaoDe(ap.id), data_operacional: '2027-06-12' });
    assert.deepEqual(erro(patch), [409, 'ATIVIDADE_DATA_COM_LINHAS', 'data_operacional', 'data_com_linhas']);
    assert.deepEqual([patch.json().details.linhas_mao_obra, patch.json().details.linhas_servico], [0, 1]);
  });

  test('isolamento: outro tenant → 404; sem a ação → 403; seletores da guarda de ver: serviços ativos com a unidade e parceiros prestadores só com id e nome', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const b = await montarPatrimonio(app);
    const f = await foto(s.c);
    const r = await s.H.req('POST', `${s.baseAp(s.atividade)}/${ap.id}/servicos`, b.token, { empresa_id: b.e1.id, versao: 1, operation_id: opId(), servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1' });
    assert.deepEqual(erro(r).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    assert.equal(await foto(s.c), f);
    const leitor = await s.contaTela();
    assert.equal((await s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1' }, { tok: leitor.token })).statusCode, 403);
    const sv = await s.H.ok(s.H.req('GET', `/atividades-opcoes/servicos?empresa_id=${s.e1.id}`, leitor.token));
    assert.deepEqual(sv.itens, [
      { id: s.gradagem.id, numero: s.gradagem.numero, nome: 'Gradagem terceirizada', unidade: 'ha', valor_referencia: '150.0000' },
      { id: s.horaTrator.id, numero: s.horaTrator.numero, nome: 'Hora de trator alugado', unidade: 'h', valor_referencia: null },
    ]);
    const pa = await s.H.ok(s.H.req('GET', `/atividades-opcoes/parceiros-servico?empresa_id=${s.e1.id}`, leitor.token));
    assert.deepEqual(pa.itens, [{ id: s.prestadorAlias.id, nome: 'Empreiteira Alias' }, { id: s.prestador.id, nome: 'Prestadora Terra Boa' }]);
    const pq = await s.H.ok(s.H.req('GET', `/atividades-opcoes/parceiros-servico?empresa_id=${s.e1.id}&q=terra`, s.token));
    assert.deepEqual(pq.itens.map((x) => x.id), [s.prestador.id]);
    // O `q` casa SÓ o nome (o que a opção mostra): nem a razão social nem o número de cadastro.
    await prisma().fornecedor.update({ where: { id: s.prestador.id }, data: { razao_social: 'Razao Oculta Ltda' } });
    const porRazao = await s.H.ok(s.H.req('GET', `/atividades-opcoes/parceiros-servico?empresa_id=${s.e1.id}&q=oculta`, s.token));
    const numero = (await prisma().fornecedor.findUnique({ where: { id: s.prestador.id } })).numero_cadastro;
    const porNumero = await s.H.ok(s.H.req('GET', `/atividades-opcoes/parceiros-servico?empresa_id=${s.e1.id}&q=${encodeURIComponent(numero)}`, s.token));
    assert.deepEqual([porRazao.itens, porNumero.itens], [[], []]);
    assert.equal((await s.H.req('GET', `/atividades-opcoes/servicos?empresa_id=${s.e1.id}`, b.token)).statusCode, 404);
    assert.equal((await s.H.req('GET', `/atividades-opcoes/parceiros-servico?empresa_id=${s.e1.id}&papel=cliente`, s.token)).statusCode, 400, 'query fechada');
  });
});

describe('lançar e repetir com servicos[]', () => {
  test('POST …/apontamentos com servicos[] (chaves :s<n>), replay, recusa com linha_indice; duplicar com servicos[]', async () => {
    const s = await montar();
    const op = opId('lanc');
    const corpo = {
      operation_id: op,
      servicos: [
        { servico_id: s.gradagem.id, quantidade: '4', valor_unitario: '150', fornecedor_parceiro_id: s.prestador.id },
        { servico_id: s.horaTrator.id, quantidade: '2', valor_unitario: '90.5' },
      ],
    };
    const c = await s.H.ok(s.lancarAp(corpo), 201);
    assert.deepEqual(c.apontamento.servicos.map((l) => [l.ordem, l.unidade, l.valor_total]), [[1, 'ha', '600.0000'], [2, 'h', '181.0000']]);
    const ops = (await prisma().atividadeApontamentoServico.findMany({ where: { cliente_id: s.c }, orderBy: { ordem: 'asc' } })).map((l) => l.operation_id);
    assert.deepEqual(ops, [`${op}:s1`, `${op}:s2`]);
    const re = await s.lancarAp(corpo);
    assert.deepEqual([re.statusCode, re.json().replay], [200, true]);
    const f = await foto(s.c);
    const ruim = await s.lancarAp({ operation_id: opId(), servicos: [corpo.servicos[1], { ...corpo.servicos[0], fornecedor_parceiro_id: s.semPapel.id }] });
    assert.deepEqual([...erro(ruim), ruim.json().details.linha_indice], [422, 'ATIVIDADE_LINHA_INVALIDA', 'fornecedor_parceiro_id', 'parceiro_invalido', 1]);
    assert.equal(await foto(s.c), f);
    assert.deepEqual(erro(await s.lancarAp({ operation_id: opId(), servicos: [{ ...corpo.servicos[1], valor_unitario: 1 }] })), [400, 'REQUEST_VALIDATION_FAILED', 'servicos[0].valor_unitario', 'valor_deve_ser_texto']);
    const dup = await s.H.ok(
      s.H.req('POST', `${s.baseAp(s.atividade)}/${c.apontamento.id}/duplicar`, s.token, {
        empresa_id: s.e1.id, data_operacional: '2027-06-11', operation_id: opId('dup'), servicos: [corpo.servicos[0]], mao_obra: [{ funcionario_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1' }],
      }),
      201
    );
    assert.deepEqual([dup.apontamento.servicos.length, dup.apontamento.mao_obra.length, dup.apontamento.servicos[0].valor_total], [1, 1, '600.0000']);
  });
});

describe('parceiro em uso', () => {
  test('parceiro usado em linha de serviço (mesmo cancelada) não é excluído: 409 PARCEIRO_EM_USO com details.servicos_atividade; sem linha, sai', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l = (await s.S.lancarOk(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '10', fornecedor_parceiro_id: s.prestador.id })).servico;
    await s.H.ok(s.S.cancelar(ap, l.id));
    const r = await s.H.req('DELETE', `/fornecedores/${s.prestador.id}`, s.token);
    assert.deepEqual([r.statusCode, r.json().code, r.json().details.servicos_atividade], [409, 'PARCEIRO_EM_USO', 1], r.body);
    assert.ok(await prisma().fornecedor.findUnique({ where: { id: s.prestador.id } }));
    const livre = await s.H.req('DELETE', `/fornecedores/${s.prestadorAlias.id}`, s.token);
    assert.ok([200, 204].includes(livre.statusCode), livre.body);
    assert.equal(await prisma().fornecedor.findUnique({ where: { id: s.prestadorAlias.id } }), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('revisões: PATCH sem mudança e corrida', () => {
  test('PATCH sem mudança real → 422 ATIVIDADE_LINHA_INVALIDA (corpo, sem_alteracao): nada cancelado nem recriado, versão e auditoria iguais', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const l = (await s.S.lancarOk(ap, { servico_id: s.gradagem.id, quantidade: '2', valor_unitario: '150', fornecedor_parceiro_id: s.prestador.id, documento_referencia: 'NF 1' })).servico;
    const f = await foto(s.c);
    const auditorias = () => prisma().auditLog.count({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoServico' } });
    const antes = await auditorias();
    for (const corpo of [
      { quantidade: '2' },
      { quantidade: '2.0000', valor_unitario: '150.0', servico_id: s.gradagem.id, fornecedor_parceiro_id: s.prestador.id, documento_referencia: 'NF 1', observacao: null },
    ]) {
      const r = await s.S.editar(ap, l.id, corpo);
      assert.deepEqual(erro(r), [422, 'ATIVIDADE_LINHA_INVALIDA', 'corpo', 'sem_alteracao'], JSON.stringify(corpo));
      assert.equal(r.json().details.entidade, 'linha_servico');
    }
    assert.equal(await foto(s.c), f, 'nada cancelado, nada recriado, a versão não subiu');
    assert.equal(await auditorias(), antes);
    assert.equal((await s.S.editar(ap, l.id, { documento_referencia: null })).statusCode, 200, 'limpar o documento é mudança');
  });

  test('corrida: a inativação do serviço em voo termina antes e a linha nova vê o inativo (422), sem gravar', async () => {
    const s = await montar();
    const ap = await s.apontar();
    const f = await foto(s.c);
    /** @type {() => void} */
    let soltar = () => {};
    const segura = new Promise((r) => (soltar = /** @type {any} */ (r)));
    /** @type {() => void} */
    let travou = () => {};
    const travado = new Promise((r) => (travou = /** @type {any} */ (r)));
    const inativar = prisma().$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE "Servico" SET ativo = false WHERE cliente_id = ${s.c} AND id = ${s.gradagem.id}`;
        travou();
        await segura;
      },
      { timeout: 20000 }
    );
    await travado;
    let respondeu = false;
    const linha = s.S.lancar(ap, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '10' }).then((r) => {
      respondeu = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(respondeu, false, 'a linha espera a inativação (FOR SHARE no serviço)');
    soltar();
    await inativar;
    assert.deepEqual(erro(await linha), [422, 'ATIVIDADE_LINHA_INVALIDA', 'servico_id', 'inativo']);
    assert.equal(await foto(s.c), f, 'nada gravado');
  });
});
