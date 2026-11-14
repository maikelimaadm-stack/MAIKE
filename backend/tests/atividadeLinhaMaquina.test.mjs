/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades) — LINHAS DE MÁQUINA do
 * apontamento (`/atividades/:id/apontamentos/:apontamentoId/maquinas…`), os
 * seletores `/atividades-opcoes/{implementos,medidor}` e os dois campos novos
 * de cadastro (`BemPatrimonial.custo_uso_unitario`,
 * `TipoPatrimonial.salto_maximo_medidor`), contra PostgreSQL real e HTTP
 * autenticado (`app.inject`). Contrato:
 * docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md §3 e §4.
 *
 * Cobre: o medidor (snapshot do bem, leitura inicial sugerida pela vigente,
 * para trás recusado, final < inicial, acima de leitura posterior); a leitura
 * vigente do bem atualizada pela linha (detalhe do bem e seletor do medidor)
 * SEM gravar o bem; o abastecimento respeitando as leituras das linhas e vice-
 * versa; o piso do PATCH do bem; cancelar a linha tira a leitura; implemento
 * (permite_implemento, natureza, igual à máquina); natureza da máquina; salto
 * com e sem justificativa; sem medidor; custo snapshot; editar = cancelar +
 * nova; idempotência; CAS; status; isolamento por fazenda e tenant; as funções
 * que o serviço do apontamento chama (lançar com `maquinas[]` e a cascata do
 * cancelamento); e os campos de cadastro.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento, erro, montarAbastecimento, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { corpoImplemento, corpoTrator, montarPatrimonio } from './patrimonioP1Cenario.mjs';
import {
  cancelarLinhasMaquinaDoApontamento,
  criarLinhasMaquina,
  totaisDasMaquinasDaAtividade,
} from '../src/modules/atividades/atividadeApontamentoMaquinaService.js';
import { registrarAtividadeApontamentoMaquinaRoutes } from '../src/modules/atividades/atividadeApontamentoMaquinaRoutes.js';
import { emTransacao, TRANSACAO_CURTA } from '../src/shared/prisma/transacaoConcorrente.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
const ROTA_LINHA = '/atividades/:id/apontamentos/:apontamentoId/maquinas';

/** As linhas de máquina seguram apontamento e bem por FK RESTRICT: saem antes da limpeza geral. */
const limparLinhas = () => prisma().atividadeApontamentoMaquina.deleteMany({});

before(async () => {
  app = await criarApp();
  // O registro em `app.js` é do serviço do apontamento; sem ele (ainda), o teste registra o plugin.
  if (!app.hasRoute({ method: 'POST', url: ROTA_LINHA })) await app.register(registrarAtividadeApontamentoMaquinaRoutes);
  await app.ready();
  A = acoesAbastecimento(app);
});
after(async () => {
  await limparLinhas();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparLinhas();
  await limparBanco();
});

const opId = () => `maq-${randomUUID()}`;
let sequencia = 0;

/**
 * Cenário: o do abastecimento (trator TP-02 com horímetro 1520.5 h em
 * 2027-06-01, caminhonete com odômetro, gerador sem medidor, diesel com lotes)
 * + um implemento, dois tipos de atividade (com e sem `permite_implemento`) e
 * uma atividade ABERTA.
 */
const montar = async () => {
  const s = await montarAbastecimento(app);
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const implemento = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({
    data: { cliente_id: s.c, nome_tipo: `GRADAGEM ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_implemento: true },
  });
  const tipoSemImplemento = await p.tipoAtividade.create({
    data: { cliente_id: s.c, nome_tipo: `ROÇADA ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo },
  });
  /** Abre uma atividade pela API do cabeçalho. */
  const abrir = async (extra = {}) =>
    A.ok(
      A.req('POST', '/atividades', s.token, {
        empresa_id: s.e1.id, nome: `Gradagem ${randomUUID().slice(0, 4)}`, tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30', ...extra,
      }),
      201
    );
  const atividade = await abrir();
  /** Apontamento CONFIRMADO do dia (direto no banco: o lançamento é de outro serviço). */
  const apontar = async (dia, a = atividade) => {
    sequencia += 1;
    return p.atividadeApontamento.create({
      data: {
        cliente_id: s.c, empresa_id: a.empresa_id, atividade_id: a.id, data_operacional: new Date(`${dia}T00:00:00.000Z`),
        sequencia, origem: 'WEB', status: 'CONFIRMADO', versao: 1, criado_por_usuario_id: s.adm.usuario.id,
      },
    });
  };
  const versaoDe = async (apId) => (await p.atividadeApontamento.findUnique({ where: { id: apId } })).versao;
  const url = (a, ap, linhaId = null, sufixo = '') => `/atividades/${a.id}/apontamentos/${ap.id}/maquinas${linhaId ? `/${linhaId}` : ''}${sufixo}`;
  const L = {
    lancar: async (ap, corpo, { tok = s.token, a = atividade, versao, operation_id = opId() } = {}) =>
      A.req('POST', url(a, ap), tok, { empresa_id: a.empresa_id, versao: versao ?? (await versaoDe(ap.id)), operation_id, ...corpo }),
    editar: async (ap, linhaId, corpo, { tok = s.token, a = atividade, versao, operation_id = opId() } = {}) =>
      A.req('PATCH', url(a, ap, linhaId), tok, { empresa_id: a.empresa_id, versao: versao ?? (await versaoDe(ap.id)), operation_id, ...corpo }),
    cancelar: async (ap, linhaId, corpo = {}, { tok = s.token, a = atividade, versao, operation_id = opId() } = {}) =>
      A.req('POST', url(a, ap, linhaId, '/cancelar'), tok, { empresa_id: a.empresa_id, versao: versao ?? (await versaoDe(ap.id)), operation_id, motivo: 'lançada errada', ...corpo }),
  };
  /** Lança e devolve o corpo (201). */
  const lancarOk = async (ap, corpo, opcoes) => {
    const r = await L.lancar(ap, corpo, opcoes);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const medidor = (bemId, data, tok = s.token) =>
    A.req('GET', `/atividades-opcoes/medidor?empresa_id=${s.e1.id}&bem_id=${bemId}${data ? `&data=${data}` : ''}`, tok);
  /** PATCH do bem (versão atual). */
  const patchBem = async (bem, corpo) => {
    const atual = await A.bem(s.token, bem.empresa_id, bem.id);
    return A.req('PATCH', `/bens-patrimoniais/${bem.id}`, s.token, { empresa_id: bem.empresa_id, versao: atual.versao, ...corpo });
  };
  /** PATCH do tipo patrimonial (versão atual). */
  const patchTipo = async (tipoId, corpo) => {
    const atual = await A.ok(A.req('GET', `/patrimonio-tipos/${tipoId}`, s.token));
    return A.req('PATCH', `/patrimonio-tipos/${tipoId}`, s.token, { versao: atual.versao, ...corpo });
  };
  const linhasDoBanco = (where = {}) => p.atividadeApontamentoMaquina.findMany({ where: { cliente_id: s.c, ...where }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return { ...s, implemento, grupo, tipo, tipoSemImplemento, abrir, atividade, apontar, versaoDe, L, lancarOk, medidor, patchBem, patchTipo, linhasDoBanco };
};

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** Linhas, apontamentos, bens, abastecimentos, recibos e auditoria do tenant: prova de "nada gravado". */
const foto = async (c) => {
  const p = prisma();
  return JSON.stringify({
    l: await p.atividadeApontamentoMaquina.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    ap: await p.atividadeApontamento.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    b: await p.bemPatrimonial.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    ab: await p.abastecimentoBem.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    au: await p.auditLog.findMany({ where: { cliente_id: c, entidade: 'AtividadeApontamentoMaquina' }, orderBy: { id: 'asc' } }),
  }, replacer);
};

/** Os campos da linha de máquina, na ordem da forma pública. */
const CAMPOS_LINHA = [
  'id', 'empresa_id', 'apontamento_id', 'ordem', 'status', 'bem_id', 'bem', 'implemento_bem_id', 'implemento',
  'medidor_tipo', 'medidor_unidade', 'sem_medidor', 'leitura_inicial', 'leitura_final', 'quantidade_uso',
  'justificativa_salto', 'custo_unitario_uso', 'custo_total', 'observacao',
  'cancelado_em', 'cancelado_por', 'motivo_cancelamento', 'cancelamento_origem', 'criado_por', 'createdAt', 'updatedAt',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('lançar com medidor', () => {
  test('201: inicial sugerida pela vigente, uso = final − inicial, snapshot do medidor e do custo, CAS do apontamento, auditoria sem texto livre; o bem não é gravado', async () => {
    const s = await montar();
    assert.equal((await s.patchBem(s.trator, { custo_uso_unitario: '150.5' })).statusCode, 200);
    const bemAntes = await prisma().bemPatrimonial.findUnique({ where: { id: s.trator.id } });
    const ap = await s.apontar('2027-06-10');
    const c = await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530', observacao: 'texto secreto' });
    assert.deepEqual(Object.keys(c), ['apontamento', 'atividade', 'alertas', 'maquina']);
    assert.deepEqual(Object.keys(c.maquina), CAMPOS_LINHA);
    const m = c.maquina;
    assert.deepEqual(
      [m.status, m.ordem, m.medidor_tipo, m.medidor_unidade, m.sem_medidor, m.leitura_inicial, m.leitura_final, m.quantidade_uso, m.custo_unitario_uso, m.custo_total],
      ['CONFIRMADO', 1, 'HORIMETRO', 'h', false, '1520.5000', '1530.0000', '9.5000', '150.5000', '1429.7500']
    );
    assert.deepEqual(m.bem, { id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA' });
    assert.equal(c.apontamento.id, ap.id);
    assert.equal(c.apontamento.versao, 2, 'a versão do apontamento sobe uma vez');
    assert.deepEqual(c.apontamento.maquinas.map((x) => x.id), [m.id]);
    assert.equal(c.atividade.id, s.atividade.id);
    assert.deepEqual(c.alertas, []);
    const bemDepois = await prisma().bemPatrimonial.findUnique({ where: { id: s.trator.id } });
    assert.deepEqual(JSON.stringify(bemDepois, replacer), JSON.stringify(bemAntes, replacer), 'nada é gravado em BemPatrimonial');
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoMaquina' } });
    assert.deepEqual(au.map((x) => [x.acao, x.entidade_id]), [['atividade_maquina.lancar', m.id]]);
    assert.ok(!JSON.stringify(au).includes('texto secreto'));
    assert.equal(au[0].dados_novos.tem_observacao, true);
  });

  test('a leitura vigente do bem é atualizada pela linha: detalhe do bem, seletor do medidor e o 2º lançamento do dia', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null);
    const l1 = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530' })).maquina;
    const bem = await A.bem(s.token, s.e1.id, s.trator.id);
    assert.deepEqual(bem.medidor_operacional, { leitura: '1530.0000', data: '2027-06-10', abastecimento_id: null, origem: 'ATIVIDADE', linha_maquina_id: l1.id });
    assert.equal(bem.medidor.leitura_atual, '1520.5000', 'o cadastro do bem não muda');
    const med = await A.ok(s.medidor(s.trator.id, '2027-06-12'));
    assert.deepEqual(Object.keys(med), [
      'bem', 'data', 'medidor_tipo', 'medidor_unidade', 'sem_medidor', 'leitura_vigente', 'leitura_sugerida', 'leitura_posterior', 'leitura_atual', 'salto_maximo_medidor', 'custo_uso_unitario',
    ]);
    assert.deepEqual([med.medidor_tipo, med.medidor_unidade, med.sem_medidor, med.leitura_sugerida, med.leitura_posterior, med.salto_maximo_medidor, med.custo_uso_unitario], ['HORIMETRO', 'h', false, '1530.0000', null, null, null]);
    assert.deepEqual([med.leitura_vigente.origem, med.leitura_vigente.linha_maquina_id, med.leitura_atual.leitura], ['ATIVIDADE', l1.id, '1530.0000']);
    const antes = await A.ok(s.medidor(s.trator.id, '2027-06-05'));
    assert.deepEqual([antes.leitura_sugerida, antes.leitura_vigente.origem, antes.leitura_posterior.leitura, antes.leitura_posterior.origem], ['1520.5000', 'CADASTRO', '1520.5000', 'ATIVIDADE']);
    // Duas passadas no mesmo dia: a 2ª começa onde a 1ª terminou.
    const l2 = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1534' })).maquina;
    assert.deepEqual([l2.ordem, l2.leitura_inicial, l2.quantidade_uso], [2, '1530.0000', '4.0000']);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional.leitura, '1534.0000');
  });

  test('medidor para trás: inicial abaixo da vigente na data → 422, nada gravado', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const l1 = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530' })).maquina;
    const ap2 = await s.apontar('2027-06-02');
    const f = await foto(s.c);
    const r = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_inicial: '1525', leitura_final: '1540' });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_inicial', 'abaixo_da_vigente']);
    const d = r.json().details;
    assert.deepEqual([d.entidade, d.leitura_vigente, d.data_vigente, d.origem_vigente, d.linha_maquina_id], ['linha_maquina', '1530.0000', '2027-06-10', 'ATIVIDADE', l1.id]);
    // Abaixo do CADASTRO do bem também.
    const r2 = await s.L.lancar(ap2, { bem_id: s.trator.id, leitura_inicial: '1500', leitura_final: '1510' });
    assert.deepEqual(erro(r2), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_inicial', 'abaixo_da_vigente']);
    assert.equal(r2.json().details.origem_vigente, 'CADASTRO');
    assert.equal(await foto(s.c), f);
  });

  test('final < inicial → 422; final obrigatória → 422; acima de uma leitura posterior → 422', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, leitura_inicial: '1530', leitura_final: '1529.9' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_final', 'menor_que_inicial']);
    const semFinal = await s.L.lancar(ap, { bem_id: s.trator.id });
    assert.deepEqual(erro(semFinal), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_final', 'obrigatoria']);
    assert.equal(semFinal.json().details.leitura_sugerida, '1520.5000');
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1530', quantidade_uso: '9.5' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'quantidade_uso', 'nao_aceita']);
    const l = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1540' })).maquina;
    const ap0 = await s.apontar('2027-06-08');
    const r = await s.L.lancar(ap0, { bem_id: s.trator.id, leitura_final: '1545' });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_final', 'acima_de_posterior']);
    assert.deepEqual([r.json().details.leitura_posterior, r.json().details.data_posterior, r.json().details.linha_maquina_id], ['1520.5000', '2027-06-10', l.id], 'o ponto posterior da linha é a leitura INICIAL dela');
    // Antes da linha, cabendo no trecho [cadastro, inicial da linha]: zero de uso também vale.
    const ok = (await s.lancarOk(ap0, { bem_id: s.trator.id, leitura_final: '1520.5' })).maquina;
    assert.equal(ok.quantidade_uso, '0.0000');
  });
});

describe('abastecimento × linha de máquina', () => {
  test('o abastecimento respeita as leituras das linhas (anterior e posterior) e cancelar a linha as tira da conta', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const l = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_inicial: '1530', leitura_final: '1560' })).maquina;
    const regressivo = await A.confirmar(s.token, corpoAbastecimento(s, { data_operacional: '2027-06-10', medidor_leitura: '1550.5' }));
    assert.deepEqual(erro(regressivo), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);
    assert.deepEqual([regressivo.json().details.leitura_referencia, regressivo.json().details.origem_referencia, regressivo.json().details.linha_maquina_id], ['1560.0000', 'ATIVIDADE', l.id]);
    const acima = await A.confirmar(s.token, corpoAbastecimento(s, { data_operacional: '2027-06-05', medidor_leitura: '1535' }));
    assert.deepEqual(erro(acima), [422, 'MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior']);
    assert.deepEqual([acima.json().details.leitura_posterior, acima.json().details.origem_posterior], ['1530.0000', 'ATIVIDADE']);
    // A prévia usa as mesmas regras.
    const previa = await A.ok(A.previa(s.token, { ...corpoAbastecimento(s, { medidor_leitura: '1550.5' }), operation_id: undefined }));
    assert.equal(previa.bloqueios[0].code, 'MEDIDOR_LEITURA_REGRESSIVA');
    assert.equal((await s.L.cancelar(ap, l.id)).statusCode, 200);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null, 'cancelar a linha tira a leitura dela');
    await A.confirmarOk(s.token, corpoAbastecimento(s, { data_operacional: '2027-06-10', medidor_leitura: '1550.5' }));
  });

  test('a linha respeita as leituras do abastecimento: inicial sugerida, para trás e acima de posterior', async () => {
    const s = await montar();
    const ab = await A.confirmarOk(s.token, corpoAbastecimento(s, { data_operacional: '2027-06-10', medidor_leitura: '1550.5' }));
    const ap = await s.apontar('2027-06-10');
    const r = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_inicial: '1540', leitura_final: '1560' });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_inicial', 'abaixo_da_vigente']);
    assert.deepEqual([r.json().details.origem_vigente, r.json().details.abastecimento_id], ['ABASTECIMENTO', ab.id]);
    const l = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1556' })).maquina;
    assert.deepEqual([l.leitura_inicial, l.quantidade_uso], ['1550.5000', '5.5000'], 'a inicial sugerida é a leitura do abastecimento');
    const ap0 = await s.apontar('2027-06-08');
    const acima = await s.L.lancar(ap0, { bem_id: s.trator.id, leitura_final: '1551' });
    assert.deepEqual(erro(acima), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_final', 'acima_de_posterior']);
    assert.deepEqual([acima.json().details.origem_posterior, acima.json().details.abastecimento_id], ['ABASTECIMENTO', ab.id]);
    // O efeito do cancelamento do abastecimento já enxerga a linha: a vigente continua a da linha.
    const det = await A.ok(A.detalhe(s.token, ab.id, s.e1.id));
    assert.equal(det.efeito_cancelamento_medidor.muda, false);
  });

  test('o PATCH do bem respeita o piso das linhas (leitura e data)', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const l = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1560' })).maquina;
    const abaixo = await s.patchBem(s.trator, { medidor: { tipo: 'HORIMETRO', leitura_atual: '1555', data_leitura: '2027-06-14' } });
    assert.deepEqual(erro(abaixo), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor.leitura_atual', 'leitura_regressiva']);
    assert.deepEqual([abaixo.json().details.leitura_atual, abaixo.json().details.origem_referencia, abaixo.json().details.linha_maquina_id], ['1560.0000', 'ATIVIDADE', l.id]);
    const antesData = await s.patchBem(s.trator, { medidor: { tipo: 'HORIMETRO', leitura_atual: '1570', data_leitura: '2027-06-09' } });
    assert.deepEqual(erro(antesData), [422, 'MEDIDOR_DATA_REGRESSIVA', 'medidor.data_leitura', 'data_regressiva']);
    const tipoFixo = await s.patchBem(s.trator, { medidor: { tipo: 'ODOMETRO', leitura_inicial: '10', data_leitura: '2027-06-14' } });
    assert.deepEqual(erro(tipoFixo).slice(0, 2), [409, 'MEDIDOR_TIPO_IMUTAVEL'], 'com leitura operacional o medidor deixa de ser corrigível');
    const ajuste = await A.ok(s.patchBem(s.trator, { medidor: { tipo: 'HORIMETRO', leitura_atual: '1570', data_leitura: '2027-06-14' } }));
    assert.equal(ajuste.medidor.leitura_atual, '1570.0000');
  });
});

describe('implemento e natureza', () => {
  test('implemento igual à máquina recusado; natureza da máquina e do implemento; permite_implemento', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, implemento_bem_id: s.trator.id, leitura_final: '1530' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'implemento_bem_id', 'igual_a_maquina']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.implemento.id, leitura_final: '1530' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'bem_id', 'natureza']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, implemento_bem_id: s.caminhonete.id, leitura_final: '1530' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'implemento_bem_id', 'natureza']);
    const c = await s.lancarOk(ap, { bem_id: s.trator.id, implemento_bem_id: s.implemento.id, leitura_final: '1530' });
    assert.deepEqual([c.maquina.implemento_bem_id, c.maquina.implemento.natureza], [s.implemento.id, 'IMPLEMENTO']);
    // Tipo sem permite_implemento: a máquina entra (qualquer tipo), o implemento não.
    const outra = await s.abrir({ tipo_atividade_id: s.tipoSemImplemento.id });
    const ap2 = await s.apontar('2027-06-11', outra);
    const r = await s.L.lancar(ap2, { bem_id: s.trator.id, implemento_bem_id: s.implemento.id, leitura_final: '1540' }, { a: outra });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'implemento_bem_id', 'permite_implemento']);
    await s.lancarOk(ap2, { bem_id: s.trator.id, leitura_final: '1540' }, { a: outra });
  });

  test('máquina inativa (vínculo novo) e de outra fazenda recusadas; opções de implementos', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    await prisma().bemPatrimonial.update({ where: { id: s.caminhonete.id }, data: { ativo: false } });
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.caminhonete.id, leitura_final: '40000' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'bem_id', 'inativo']);
    const daF2 = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { empresa_id: s.e2.id, codigo_frota: 'TP-99', tanques: [] })), 201);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: daF2.id, leitura_final: '1530' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'bem_id', 'outra_empresa']);
    const op = await A.ok(A.req('GET', `/atividades-opcoes/implementos?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(op.itens.map((x) => x.id), [s.implemento.id]);
    assert.deepEqual(Object.keys(op), ['itens', 'has_more', 'next_cursor']);
  });
});

describe('salto do medidor', () => {
  test('acima do teto do tipo patrimonial pede justificativa (3..500) e aceita com ela', async () => {
    const s = await montar();
    assert.equal((await s.patchTipo(s.trator.tipo.id, { salto_maximo_medidor: '10' })).statusCode, 200);
    const ap = await s.apontar('2027-06-10');
    const f = await foto(s.c);
    const r = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1535.5' });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_SALTO_MEDIDOR', 'justificativa_salto', 'salto_acima_do_teto']);
    assert.deepEqual([r.json().details.teto, r.json().details.salto, r.json().details.salto_maximo, r.json().details.quantidade_uso, r.json().details.medidor_unidade], ['10.0000', '15.0000', '10.0000', '15.0000', 'h']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1535.5', justificativa_salto: ' ok ' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'justificativa_salto', 'curta']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1535.5', justificativa_salto: 'x'.repeat(501) })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'justificativa_salto', 'longa']);
    assert.equal(await foto(s.c), f);
    const c = await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1535.5', justificativa_salto: 'trabalho dobrado' });
    assert.deepEqual([c.maquina.quantidade_uso, c.maquina.justificativa_salto], ['15.0000', 'trabalho dobrado']);
    // No teto, sem justificativa: aceita. O teto também vale para o uso digitado.
    await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1545.5' });
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, sem_medidor: true, quantidade_uso: '10.5' })).slice(0, 2), [422, 'ATIVIDADE_SALTO_MEDIDOR']);
    assert.equal((await A.ok(s.medidor(s.trator.id))).salto_maximo_medidor, '10.0000');
  });

  test('o salto conta da leitura vigente: inicial digitada acima dela (o "vão") também pede justificativa', async () => {
    const s = await montar();
    assert.equal((await s.patchTipo(s.trator.tipo.id, { salto_maximo_medidor: '10' })).statusCode, 200);
    const ap = await s.apontar('2027-06-10');
    const f = await foto(s.c);
    // Vigente 1520,5 (cadastro); a inicial 9000 (erro de digitação) com uso de só 5 h: o medidor saltaria 7484,5 h.
    const r = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_inicial: '9000', leitura_final: '9005' });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_SALTO_MEDIDOR', 'justificativa_salto', 'salto_acima_do_teto']);
    assert.deepEqual([r.json().details.quantidade_uso, r.json().details.salto, r.json().details.teto, r.json().details.leitura_vigente], ['5.0000', '7484.5000', '10.0000', '1520.5000']);
    assert.equal(await foto(s.c), f, 'nada gravado: a série do bem não muda');
    // Vão pequeno (vigente 1520,5 → inicial 1524 → final 1530 = 9,5 h de salto) passa sem justificativa.
    const ok = await s.lancarOk(ap, { bem_id: s.trator.id, leitura_inicial: '1524', leitura_final: '1530' });
    assert.deepEqual([ok.maquina.quantidade_uso, ok.maquina.justificativa_salto], ['6.0000', null]);
    // Com a justificativa, o vão grande é aceito.
    const j = await s.lancarOk(ap, { bem_id: s.trator.id, leitura_inicial: '9000', leitura_final: '9005', justificativa_salto: 'horímetro trocado' });
    assert.deepEqual([j.maquina.quantidade_uso, j.maquina.justificativa_salto], ['5.0000', 'horímetro trocado']);
  });
});

describe('sem medidor', () => {
  test('bem sem medidor: leituras recusadas, uso digitado; contador com "sem medidor" fica fora da série', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.gerador.id, leitura_final: '10' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'sem_medidor', 'medidor_obrigatorio']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.gerador.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'quantidade_uso', 'obrigatoria']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.gerador.id, quantidade_uso: '0' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'quantidade_uso', 'nao_positiva']);
    const g = (await s.lancarOk(ap, { bem_id: s.gerador.id, quantidade_uso: '3.5' })).maquina;
    assert.deepEqual([g.medidor_tipo, g.medidor_unidade, g.sem_medidor, g.leitura_inicial, g.leitura_final, g.quantidade_uso], ['SEM_MEDIDOR', null, true, null, null, '3.5000']);
    const med = await A.ok(s.medidor(s.gerador.id, '2027-06-10'));
    assert.deepEqual([med.sem_medidor, med.leitura_vigente, med.leitura_atual], [true, null, null]);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: s.trator.id, sem_medidor: true, quantidade_uso: '2', leitura_final: '1530' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'leitura_final', 'nao_aceita']);
    const t = (await s.lancarOk(ap, { bem_id: s.trator.id, sem_medidor: true, quantidade_uso: '2' })).maquina;
    assert.deepEqual([t.medidor_tipo, t.medidor_unidade, t.sem_medidor, t.leitura_inicial, t.quantidade_uso], ['HORIMETRO', 'h', true, null, '2.0000']);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null, 'sem leitura, a linha não entra na série do medidor');
  });
});

describe('custo', () => {
  test('snapshot do custo por uso do bem: mudar o cadastro depois não muda a linha; sem custo → nulo; totais por bem', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const sem = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1525' })).maquina;
    assert.deepEqual([sem.custo_unitario_uso, sem.custo_total], [null, null]);
    assert.equal((await s.patchBem(s.trator, { custo_uso_unitario: '120.3333' })).statusCode, 200);
    const com = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1528.3' })).maquina;
    assert.deepEqual([com.quantidade_uso, com.custo_unitario_uso, com.custo_total], ['3.3000', '120.3333', '397.0999']);
    assert.equal((await s.patchBem(s.trator, { custo_uso_unitario: '999' })).statusCode, 200);
    const gravada = await prisma().atividadeApontamentoMaquina.findUnique({ where: { id: com.id } });
    assert.equal(gravada.custo_unitario_uso.toFixed(4), '120.3333');
    const totais = await totaisDasMaquinasDaAtividade(prisma(), s.c, s.e1.id, s.atividade.id);
    assert.deepEqual(totais, {
      maquinas: [{ bem_id: s.trator.id, nome: 'Trator TP-02', medidor_unidade: 'h', quantidade_uso: '7.8000', custo_total: '397.0999' }],
      custo_total: '397.0999',
    });
  });
});

describe('editar e cancelar', () => {
  test('editar = cancelar a linha (EDICAO) + linha nova na mesma transação; a série segue a nova; a cancelada não edita', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const l1 = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530' })).maquina;
    const r = await s.L.editar(ap, l1.id, { leitura_final: '1535', observacao: 'corrigido' });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    assert.notEqual(c.maquina.id, l1.id);
    assert.deepEqual([c.maquina.status, c.maquina.ordem, c.maquina.leitura_inicial, c.maquina.leitura_final, c.maquina.quantidade_uso, c.maquina.observacao], ['CONFIRMADO', 2, '1520.5000', '1535.0000', '14.5000', 'corrigido']);
    const velha = c.apontamento.maquinas.find((x) => x.id === l1.id);
    assert.deepEqual([velha.status, velha.cancelamento_origem, velha.motivo_cancelamento], ['CANCELADO', 'EDICAO', 'linha editada: substituída por uma linha nova']);
    assert.equal(c.apontamento.versao, 3);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional.linha_maquina_id, c.maquina.id);
    // Baixar a final abaixo da antiga: a antiga já saiu da série.
    const r2 = await s.L.editar(ap, c.maquina.id, { leitura_final: '1522' });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().maquina.quantidade_uso, '1.5000');
    assert.deepEqual(erro(await s.L.editar(ap, l1.id, { leitura_final: '1540' })).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    // Trocar a máquina descarta as leituras do medidor da outra.
    const r3 = await s.L.editar(ap, r2.json().maquina.id, { bem_id: s.gerador.id, quantidade_uso: '4' });
    assert.equal(r3.statusCode, 200, r3.body);
    assert.deepEqual([r3.json().maquina.bem_id, r3.json().maquina.sem_medidor, r3.json().maquina.leitura_inicial], [s.gerador.id, true, null]);
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoMaquina' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(au.map((x) => x.acao), ['atividade_maquina.lancar', 'atividade_maquina.editar', 'atividade_maquina.editar', 'atividade_maquina.editar']);
  });

  test('cancelar com motivo (3..500), origem LINHA; linha de outro apontamento → 404', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const l = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530' })).maquina;
    assert.deepEqual(erro(await s.L.cancelar(ap, l.id, { motivo: 'x' })), [422, 'ATIVIDADE_MOTIVO_INVALIDO', 'motivo', 'curto']);
    const outro = await s.apontar('2027-06-11');
    assert.deepEqual(erro(await s.L.cancelar(outro, l.id)).slice(0, 2), [404, 'ATIVIDADE_LINHA_NOT_FOUND']);
    const c = (await A.ok(s.L.cancelar(ap, l.id, { motivo: 'lançada no trator errado' })));
    assert.deepEqual([c.maquina.status, c.maquina.cancelamento_origem, c.maquina.motivo_cancelamento, c.maquina.cancelado_por.id], ['CANCELADO', 'LINHA', 'lançada no trator errado', s.adm.usuario.id]);
    assert.deepEqual(erro(await s.L.cancelar(ap, l.id)).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
  });
});

describe('proteções', () => {
  test('idempotência: reenvio igual devolve a resposta gravada (uma linha só); corpo diferente → 409', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const operation_id = opId();
    const r1 = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1530' }, { operation_id, versao: 1 });
    assert.equal(r1.statusCode, 201, r1.body);
    const r2 = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1530' }, { operation_id, versao: 1 });
    assert.equal(r2.statusCode, 201);
    assert.deepEqual(r2.json(), r1.json());
    assert.equal((await s.linhasDoBanco()).length, 1);
    const r3 = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1531' }, { operation_id, versao: 1 });
    assert.deepEqual(erro(r3).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    // A mesma chave numa operação de outro tipo bate na unique da linha: 409, nunca 500.
    const r4 = await s.L.editar(ap, r1.json().maquina.id, { leitura_final: '1532' }, { operation_id });
    assert.deepEqual(erro(r4).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal((await s.linhasDoBanco()).length, 1);
  });

  test('CAS pela versão do apontamento; status da atividade e do apontamento', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530' });
    const r = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1535' }, { versao: 1 });
    assert.deepEqual(erro(r).slice(0, 2), [409, 'ATIVIDADE_VERSAO_CONFLITO']);
    assert.deepEqual([r.json().details.versao_atual, r.json().details.entidade], [2, 'apontamento']);
    await prisma().atividadeApontamento.update({
      where: { id: ap.id },
      data: { status: 'CANCELADO', cancelado_em: new Date(), cancelado_por_usuario_id: s.adm.usuario.id, motivo_cancelamento: 'teste' },
    });
    const r2 = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1535' });
    assert.deepEqual(erro(r2).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.equal(r2.json().details.entidade, 'apontamento');
    const ap2 = await s.apontar('2027-06-11');
    await prisma().atividade.update({ where: { id: s.atividade.id }, data: { status: 'CONCLUIDA', data_conclusao: new Date('2027-06-12T00:00:00Z'), concluida_em: new Date(), concluida_por_usuario_id: s.adm.usuario.id } });
    const r3 = await s.L.lancar(ap2, { bem_id: s.trator.id, leitura_final: '1535' });
    assert.deepEqual(erro(r3).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.equal(r3.json().details.entidade, 'atividade');
  });

  test('isolamento: outro tenant → 404; bem de outro tenant → inexistente; sem a ação extra → 403; decimal como número → 400', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const l = (await s.lancarOk(ap, { bem_id: s.trator.id, leitura_final: '1530' })).maquina;
    const b = await montarPatrimonio(app);
    const tratorB = await A.ok(A.req('POST', '/bens-patrimoniais', b.token, corpoTrator(b)), 201);
    const f = await foto(s.c);
    // Outro tenant com os ids deste: a empresa da URL/corpo não é dele.
    const r = await A.req('POST', `/atividades/${s.atividade.id}/apontamentos/${ap.id}/maquinas`, b.token, {
      empresa_id: b.e1.id, versao: 2, operation_id: opId(), bem_id: s.trator.id, leitura_final: '1540',
    });
    assert.deepEqual(erro(r).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    const r2 = await A.req('POST', `/atividades/${s.atividade.id}/apontamentos/${ap.id}/maquinas/${l.id}/cancelar`, b.token, {
      empresa_id: b.e1.id, versao: 2, operation_id: opId(), motivo: 'invasão',
    });
    assert.deepEqual(erro(r2).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    assert.deepEqual(erro(await s.L.lancar(ap, { bem_id: tratorB.id, leitura_final: '1540' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'bem_id', 'inexistente']);
    assert.deepEqual(erro(await A.req('GET', `/atividades-opcoes/medidor?empresa_id=${s.e1.id}&bem_id=${tratorB.id}`, s.token)), [422, 'ATIVIDADE_LINHA_INVALIDA', 'bem_id', 'inexistente']);
    assert.equal((await A.req('GET', `/atividades-opcoes/medidor?empresa_id=${s.e1.id}&bem_id=${s.trator.id}`, b.token)).statusCode, 404);
    assert.equal(await foto(s.c), f);
    const leitor = await s.conta({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'op-atividades', visualizar: true }] });
    assert.equal((await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1540' }, { tok: leitor.token })).statusCode, 403);
    assert.equal((await s.medidor(s.trator.id, null, leitor.token)).statusCode, 200, 'o seletor é da guarda de ver');
    const num = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: 1540 });
    assert.deepEqual(erro(num), [400, 'REQUEST_VALIDATION_FAILED', 'leitura_final', 'valor_deve_ser_texto']);
    const fora = await s.L.lancar(ap, { bem_id: s.trator.id, leitura_final: '1540', medidor_tipo: 'ODOMETRO' });
    assert.equal(fora.statusCode, 400, 'schema fechado: o medidor é do bem');
  });
});

describe('funções do serviço do apontamento', () => {
  test('criarLinhasMaquina (lançar com maquinas[]) e a cascata do cancelamento tiram as leituras da série', async () => {
    const s = await montar();
    const ap = await s.apontar('2027-06-10');
    const contexto = { requestId: 'teste', auth: { clienteId: s.c, usuarioId: s.adm.usuario.id } };
    const criadas = await emTransacao(TRANSACAO_CURTA, (tx) =>
      criarLinhasMaquina(tx, contexto, {
        apontamento: ap,
        atividade: s.atividade,
        operationId: 'lanc-0001',
        linhas: [{ bem_id: s.trator.id, leitura_final: '1530' }, { bem_id: s.trator.id, leitura_final: '1532' }, { bem_id: s.gerador.id, quantidade_uso: '1' }],
      })
    );
    assert.deepEqual(criadas.map((l) => [l.ordem, l.leitura_inicial, l.quantidade_uso]), [[1, '1520.5000', '9.5000'], [2, '1530.0000', '2.0000'], [3, null, '1.0000']]);
    assert.deepEqual((await s.linhasDoBanco()).map((l) => l.operation_id), ['lanc-0001:m1', 'lanc-0001:m2', 'lanc-0001:m3']);
    await assert.rejects(
      emTransacao(TRANSACAO_CURTA, (tx) => criarLinhasMaquina(tx, contexto, { apontamento: ap, atividade: s.atividade, linhas: [{ bem_id: s.gerador.id }, { bem_id: s.gerador.id, leitura_final: '1' }] })),
      (e) => e.code === 'ATIVIDADE_LINHA_INVALIDA' && e.details.linha_indice === 0 && e.details.field === 'quantidade_uso'
    );
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional.leitura, '1532.0000');
    const n = await emTransacao(TRANSACAO_CURTA, (tx) =>
      cancelarLinhasMaquinaDoApontamento(tx, { clienteId: s.c, empresaId: s.e1.id, apontamentoIds: [ap.id], usuarioId: s.adm.usuario.id, motivo: 'apontamento cancelado', agora: new Date(), origem: 'APONTAMENTO' })
    );
    assert.equal(n, 3);
    assert.deepEqual([...new Set((await s.linhasDoBanco()).map((l) => `${l.status}/${l.cancelamento_origem}`))], ['CANCELADO/APONTAMENTO']);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null);
    const vazio = await totaisDasMaquinasDaAtividade(prisma(), s.c, s.e1.id, s.atividade.id);
    assert.deepEqual(vazio, { maquinas: [], custo_total: null });
  });
});

describe('cadastros: custo por uso do bem e teto de salto do tipo', () => {
  test('custo_uso_unitario no bem (criar, PATCH, limpar, GET) e salto_maximo_medidor no tipo (criar, PATCH, limpar); número → 400', async () => {
    const s = await montar();
    const criado = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: 'TP-50', tanques: [], custo_uso_unitario: '85.25' })), 201);
    assert.equal(criado.custo_uso_unitario, '85.2500');
    assert.equal((await A.bem(s.token, s.e1.id, criado.id)).custo_uso_unitario, '85.2500');
    assert.equal((await A.ok(s.patchBem(criado, { custo_uso_unitario: '0' }))).custo_uso_unitario, '0.0000');
    assert.equal((await A.ok(s.patchBem(criado, { custo_uso_unitario: null }))).custo_uso_unitario, null);
    assert.deepEqual(erro(await s.patchBem(criado, { custo_uso_unitario: 12 })), [400, 'REQUEST_VALIDATION_FAILED', 'custo_uso_unitario', 'valor_deve_ser_texto']);
    assert.equal((await s.patchBem(criado, { custo_uso_unitario: '-1' })).statusCode, 400);
    const tipo = await A.ok(A.req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', nome: 'Pulverizador autopropelido', salto_maximo_medidor: '24' }), 201);
    assert.equal(tipo.salto_maximo_medidor, '24.0000');
    assert.equal((await A.ok(s.patchTipo(tipo.id, { salto_maximo_medidor: '12.5' }))).salto_maximo_medidor, '12.5000');
    assert.equal((await A.ok(s.patchTipo(tipo.id, { salto_maximo_medidor: null }))).salto_maximo_medidor, null);
    assert.deepEqual(erro(await s.patchTipo(tipo.id, { salto_maximo_medidor: 5 })), [400, 'REQUEST_VALIDATION_FAILED', 'salto_maximo_medidor', 'valor_deve_ser_texto']);
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'TipoPatrimonial', entidade_id: tipo.id, acao: 'update' } });
    assert.ok(au.every((x) => x.dados_novos.campos_alterados.includes('salto_maximo_medidor')));
  });
});
