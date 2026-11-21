/**
 * D-PROD-200 (Fatia 2 do Lançamento de Atividades) — os APONTAMENTOS da
 * atividade (`/atividades/:id/apontamentos…`), contra PostgreSQL real e HTTP
 * autenticado (`app.inject`). Contrato:
 * docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md (§3, §4, §5, §8, §10).
 *
 * Cobre: a forma pública do §10 e a auditoria sem texto livre; as passadas (a
 * sequência é máx + 1 por atividade, dia e turno, calculada no servidor, com
 * turno nulo como um grupo próprio) e os dias não contíguos; a data (futura e
 * inexistente recusam; fora do período só alerta); o travamento (o corpo recusa
 * área, setor, safra, centros, unidade e máquina, que são do cabeçalho); o
 * operador; o status (só em atividade ABERTA; só apontamento CONFIRMADO edita
 * ou cancela); o CAS por versão; o cancelamento com motivo; o "repetir"; os
 * totais do cabeçalho como a soma dos CONFIRMADOS, recalculados a cada escrita;
 * o isolamento por atividade, fazenda e tenant (404, nunca 403); as permissões
 * extras da tela; o fuso; a concorrência; e as duas funções que o cabeçalho
 * chama ao cancelar a atividade.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { HOJE, erro, http, montarPatrimonio, prisma } from './patrimonioP1Cenario.mjs';
import { cancelarApontamentosDaAtividade, recalcularTotaisDaAtividade } from '../src/modules/atividades/atividadeApontamentoService.js';
import { emTransacao, TRANSACAO_CURTA } from '../src/shared/prisma/transacaoConcorrente.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

/** Os campos do apontamento, na ordem do contrato (§10). */
const CAMPOS_APONTAMENTO = [
  'id', 'empresa_id', 'atividade_id', 'data_operacional', 'turno', 'sequencia',
  'operador_usuario_id', 'operador',
  'area_executada_dia', 'quantidade_produzida_dia', 'observacao',
  // D-PROD-249: a área da atividade do lançamento.
  'atividade_area_id', 'atividade_area',
  // D-PROD-265: o último dia do serviço (só o registro de campo grava; nulo aqui).
  'data_termino',
  // D-PROD-270: o nº do receituário da Aplicação (só o registro de campo grava; nulo aqui).
  'numero_receituario',
  'origem', 'status', 'versao',
  'cancelado_em', 'cancelado_por', 'motivo_cancelamento',
  'criado_por', 'createdAt', 'updatedAt',
  // D-PROD-202 (Fatia 3): as linhas de produto e de máquina, inclusive as canceladas.
  'produtos', 'maquinas', 'mao_obra', 'servicos',
];

const MODULO = 'suporte-mapa';
const TELA = 'op-atividades';

/**
 * Cenário: tenant com 2 fazendas (fuso de São Paulo), um grupo e um tipo com os
 * padrões (centro de custo da fazenda 1, unidade HA), e o atalho `abrir` para
 * criar atividades pela API do cabeçalho.
 */
const montar = async () => {
  const s = await montarPatrimonio(app, { catalogo: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const un = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: `U-${suf}`, sigla: 'HA', descricao: 'Hectare' } });
  const tipo = await p.tipoAtividade.create({
    data: { cliente_id: s.c, nome_tipo: 'PULVERIZAÇÃO', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, centro_custo_padrao_id: s.centro1.id, unidade_producao_id: un.id },
  });
  /** Abre uma atividade pela API (período padrão 2027-06-01 a 2027-06-30). */
  const abrir = async (extra = {}) => {
    const r = await H.req('POST', '/atividades', s.token, {
      empresa_id: s.e1.id, nome: 'Cigarrinha Pasto 01', tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30', area_id: s.area1.id, ...extra,
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const base = (a) => `/atividades/${a.id}/apontamentos`;
  const A = {
    lista: (a, tok = s.token, empresaId = a.empresa_id) => H.req('GET', `${base(a)}?empresa_id=${empresaId}`, tok),
    detalhe: (a, id, tok = s.token, empresaId = a.empresa_id) => H.req('GET', `${base(a)}/${id}?empresa_id=${empresaId}`, tok),
    lancar: (a, corpo, tok = s.token) => H.req('POST', base(a), tok, { empresa_id: a.empresa_id, ...corpo }),
    editar: (a, id, corpo, tok = s.token) => H.req('PATCH', `${base(a)}/${id}`, tok, corpo),
    cancelar: (a, id, corpo, tok = s.token) => H.req('POST', `${base(a)}/${id}/cancelar`, tok, { empresa_id: a.empresa_id, ...corpo }),
    duplicar: (a, id, corpo = {}, tok = s.token) => H.req('POST', `${base(a)}/${id}/duplicar`, tok, { empresa_id: a.empresa_id, ...corpo }),
  };
  /** Lança e devolve o corpo `{apontamento, atividade, alertas}` (201). */
  const lancarOk = async (a, corpo) => {
    const r = await A.lancar(a, corpo);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  /** Conta do tenant com a linha da tela e as ações dadas. */
  const contaTela = (acoes) => s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [{ modulo_id: MODULO, tela_id: TELA, visualizar: true, ...acoes }] });
  return { ...s, grupo, un, tipo, abrir, A, lancarOk, contaTela };
};

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** Atividades, apontamentos e auditoria do tenant: prova de "nada gravado". */
const foto = async (c) => {
  const p = prisma();
  return JSON.stringify({
    ap: await p.atividadeApontamento.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    at: await p.atividade.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    au: await p.auditLog.findMany({ where: { cliente_id: c, entidade: 'AtividadeApontamento' }, orderBy: { id: 'asc' } }),
  }, replacer);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('lançar', () => {
  test('201: forma do §10, sequência 1, origem, operador, totais no cabeçalho (sem mexer na versão dele) e auditoria sem texto livre', async () => {
    const s = await montar();
    const a = await s.abrir();
    const r = await s.A.lancar(a, {
      data_operacional: '2027-06-10', turno: 'MANHA', operador_usuario_id: s.adm.usuario.id,
      area_executada_dia: '12.5', quantidade_produzida_dia: '3', observacao: 'texto secreto do operador', origem: 'APP',
    });
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c), ['apontamento', 'atividade', 'alertas']);
    assert.deepEqual(Object.keys(c.apontamento), CAMPOS_APONTAMENTO);
    const ap = c.apontamento;
    assert.deepEqual(
      [ap.empresa_id, ap.atividade_id, ap.data_operacional, ap.turno, ap.sequencia, ap.area_executada_dia, ap.quantidade_produzida_dia, ap.origem, ap.status, ap.versao],
      [s.e1.id, a.id, '2027-06-10', 'MANHA', 1, '12.5000', '3.0000', 'APP', 'CONFIRMADO', 1]
    );
    assert.deepEqual(ap.operador, { id: s.adm.usuario.id, nome: 'Operador de Teste' });
    assert.deepEqual(ap.criado_por, { id: s.adm.usuario.id, nome: 'Operador de Teste' });
    assert.deepEqual([ap.cancelado_em, ap.cancelado_por, ap.motivo_cancelamento], [null, null, null]);
    assert.deepEqual(c.alertas, []);
    assert.deepEqual([c.atividade.id, c.atividade.area_executada, c.atividade.quantidade_produzida, c.atividade.versao], [a.id, '12.5000', '3.0000', 1], 'a versão do cabeçalho não muda');
    assert.deepEqual(c.atividade.totais, { apontamentos_confirmados: 1, apontamentos_cancelados: 0, dias_com_apontamento: 1 });
    const linha = await prisma().atividadeApontamento.findUnique({ where: { id: ap.id } });
    assert.deepEqual([linha.cliente_id, linha.empresa_id], [s.c, s.e1.id], 'tenant da sessão; fazenda da atividade');
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamento' } });
    assert.deepEqual(au.map((x) => [x.acao, x.entidade_id]), [['atividade_apontamento.lancar', ap.id]]);
    assert.ok(!JSON.stringify(au).includes('texto secreto'), 'auditoria sem texto livre');
    assert.equal(au[0].dados_novos.tem_observacao, true);
    // Origem padrão WEB; turno nulo.
    const r2 = await s.lancarOk(a, { data_operacional: '2027-06-10' });
    assert.deepEqual([r2.apontamento.origem, r2.apontamento.turno, r2.apontamento.operador, r2.apontamento.area_executada_dia], ['WEB', null, null, null]);
  });

  test('travamento: o corpo recusa área, setor, safra, centros, unidade, máquina e o que o servidor deriva → 400; decimal como número → 400; nada gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const antes = await foto(s.c);
    const herdados = {
      area_id: s.area1.id, setor_id: s.area1.setor_id, safra_ciclo: '26/27', centro_custo_id: s.centro1.id, centro_resultado_id: 'cr',
      unidade_producao_id: s.un.id, unidade_producao_sigla: 'HA', bem_id: 'bem', tipo_atividade_id: s.tipo.id,
      sequencia: 1, status: 'CONFIRMADO', versao: 1, atividade_id: a.id, criado_por_usuario_id: s.adm.usuario.id, cliente_id: s.c, id: 'x',
      cancelado_em: '2027-06-01T00:00:00.000Z', motivo_cancelamento: 'x',
    };
    for (const [campo, valor] of Object.entries(herdados)) {
      const r = await s.A.lancar(a, { data_operacional: '2027-06-10', [campo]: valor });
      assert.deepEqual(erro(r).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], `${campo}: ${r.body}`);
    }
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10', area_executada_dia: 12.5 })), [400, 'REQUEST_VALIDATION_FAILED', 'area_executada_dia', 'valor_deve_ser_texto']);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10', quantidade_produzida_dia: 3 })), [400, 'REQUEST_VALIDATION_FAILED', 'quantidade_produzida_dia', 'valor_deve_ser_texto']);
    for (const corpo of [
      { data_operacional: '2027-06-10', quantidade_produzida_dia: '-1' },
      { data_operacional: '2027-06-10', area_executada_dia: '-0.5' },
      { data_operacional: '2027-06-10', turno: 'MADRUGADA' },
      { data_operacional: '2027-06-10', origem: 'SMS' },
      { data_operacional: '10/06/2027' },
      {},
    ]) {
      assert.deepEqual(erro(await s.A.lancar(a, corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], JSON.stringify(corpo));
    }
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // O que é herdado continua no cabeçalho e o apontamento não o tem.
    const ok = await s.lancarOk(a, { data_operacional: '2027-06-10', area_executada_dia: '0', quantidade_produzida_dia: '0' });
    for (const k of ['area_id', 'setor_id', 'safra_ciclo', 'centro_custo_id', 'unidade_producao_id', 'bem_id']) assert.equal(k in ok.apontamento, false, k);
    assert.deepEqual([ok.atividade.centro_custo_id, ok.atividade.unidade_producao_sigla, ok.atividade.setor_id], [s.centro1.id, 'HA', s.area1.setor_id]);
    assert.equal(ok.atividade.area_executada, '0.0000', 'zero vale');
  });

  test('operador: inexistente, de outro tenant ou inativo → 422; manter o gravado que ficou inativo pode; repetir com ele não', async () => {
    const s = await montar();
    const outro = await montar();
    const a = await s.abrir();
    const p = prisma();
    const inativo = await p.usuario.create({ data: { cliente_id: s.c, nome: 'Inativo', login: `ina-${randomUUID().slice(0, 8)}`, senha_hash: 'x', ativo: false } });
    const ativo = await p.usuario.create({ data: { cliente_id: s.c, nome: 'Ativo', login: `ati-${randomUUID().slice(0, 8)}`, senha_hash: 'x' } });
    const antes = await foto(s.c);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10', operador_usuario_id: 'naoexiste' })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'operador_usuario_id', 'inexistente']);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10', operador_usuario_id: outro.adm.usuario.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'operador_usuario_id', 'inexistente']);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10', operador_usuario_id: inativo.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'operador_usuario_id', 'inativo']);
    assert.equal(await foto(s.c), antes);
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10', operador_usuario_id: ativo.id })).apontamento;
    await p.usuario.update({ where: { id: ativo.id }, data: { ativo: false } });
    const e = await s.A.editar(a, ap.id, { versao: 1, observacao: 'ok', operador_usuario_id: ativo.id });
    assert.equal(e.statusCode, 200, e.body);
    assert.deepEqual(erro(await s.A.editar(a, ap.id, { versao: 2, operador_usuario_id: inativo.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'operador_usuario_id', 'inativo']);
    assert.deepEqual(erro(await s.A.duplicar(a, ap.id, { data_operacional: '2027-06-11' })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'operador_usuario_id', 'inativo']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('passadas e dias', () => {
  test('duas passadas no mesmo dia: mesma data, sequência 1 e 2 — com turno e sem turno (o turno nulo é um grupo próprio)', async () => {
    const s = await montar();
    const a = await s.abrir();
    const seq = async (corpo) => (await s.lancarOk(a, { data_operacional: '2027-06-02', ...corpo })).apontamento.sequencia;
    assert.deepEqual([await seq({ turno: 'TARDE' }), await seq({ turno: 'TARDE' })], [1, 2], 'com turno');
    assert.deepEqual([await seq({}), await seq({ turno: null })], [1, 2], 'sem turno: nulo conta como valor (NULLS NOT DISTINCT)');
    assert.deepEqual([await seq({ turno: 'MANHA' }), await seq({ turno: 'NOITE' }), await seq({ turno: 'TARDE' })], [1, 1, 3], 'cada turno é um grupo');
    // No banco: o unique (atividade, dia, turno, sequência) segura as duas sem turno.
    const semTurno = await prisma().atividadeApontamento.findMany({ where: { atividade_id: a.id, turno: null }, orderBy: { sequencia: 'asc' } });
    assert.deepEqual(semTurno.map((x) => x.sequencia), [1, 2]);
    await assert.rejects(
      () => prisma().atividadeApontamento.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, atividade_id: a.id, data_operacional: new Date('2027-06-02T00:00:00Z'), sequencia: 2 } }),
      (e) => /** @type {any} */ (e).code === 'P2002',
      'turno nulo repetido colide no unique'
    );
  });

  test('dias não contíguos aceitos; a sequência reinicia por dia; a lista vem por dia desc, turno (manhã → tarde → noite → sem turno) e sequência', async () => {
    const s = await montar();
    const a = await s.abrir();
    const lancar = async (dia, turno) => (await s.lancarOk(a, { data_operacional: dia, ...(turno !== undefined ? { turno } : {}) })).apontamento;
    const x = [];
    x.push(await lancar('2027-06-02', 'TARDE')); // 1
    x.push(await lancar('2027-06-02', 'TARDE')); // 2
    x.push(await lancar('2027-06-02', 'MANHA')); // 1
    x.push(await lancar('2027-06-02', null)); // 1
    x.push(await lancar('2027-06-02')); // 2 (sem turno)
    x.push(await lancar('2027-06-02', 'NOITE')); // 1
    x.push(await lancar('2027-06-09', 'MANHA')); // 1 (dia não contíguo)
    x.push(await lancar('2027-06-05', 'MANHA')); // 1 (dia anterior ao último lançado)
    assert.deepEqual(x.map((p) => p.sequencia), [1, 2, 1, 1, 2, 1, 1, 1]);
    const l = await H.ok(s.A.lista(a));
    assert.deepEqual(Object.keys(l), ['items']);
    assert.deepEqual(
      l.items.map((p) => `${p.data_operacional}|${p.turno}|${p.sequencia}`),
      ['2027-06-09|MANHA|1', '2027-06-05|MANHA|1', '2027-06-02|MANHA|1', '2027-06-02|TARDE|1', '2027-06-02|TARDE|2', '2027-06-02|NOITE|1', '2027-06-02|null|1', '2027-06-02|null|2']
    );
    assert.deepEqual(Object.keys(l.items[0]), CAMPOS_APONTAMENTO);
    const cab = await H.ok(H.req('GET', `/atividades/${a.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(cab.totais.dias_com_apontamento, 3);
    // Detalhe igual ao item da lista.
    assert.deepEqual(await H.ok(s.A.detalhe(a, x[1].id)), x[1]);
    assert.deepEqual(erro(await s.A.detalhe(a, 'nao-existe')), [404, 'ATIVIDADE_APONTAMENTO_NOT_FOUND', null, null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('data do apontamento', () => {
  test('data futura → 422 (nada gravado); data inexistente → 422; hoje vale', async () => {
    const s = await montar();
    const a = await s.abrir();
    const antes = await foto(s.c);
    const f = await s.A.lancar(a, { data_operacional: '2027-06-16' });
    assert.deepEqual(erro(f), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_operacional', 'futura']);
    assert.equal(f.json().details.hoje, HOJE);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2028-01-01' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_operacional', 'futura']);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-02-30' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_operacional', 'data_inexistente']);
    assert.equal(await foto(s.c), antes, 'nada gravado');
    assert.equal((await s.lancarOk(a, { data_operacional: HOJE })).apontamento.data_operacional, HOJE);
    // Editar e repetir também recusam o futuro.
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    assert.deepEqual(erro(await s.A.editar(a, ap.id, { versao: 1, data_operacional: '2027-06-20' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_operacional', 'futura']);
    assert.deepEqual(erro(await s.A.duplicar(a, ap.id, { data_operacional: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_operacional', 'futura']);
  });

  test('fora de [data_inicio, data_prevista_fim]: só alerta FORA_DO_INTERVALO, sem bloquear (antes do início, depois do fim; período aberto não alerta)', async () => {
    const s = await montar();
    const a = await s.abrir({ data_inicio: '2027-06-05', data_prevista_fim: '2027-06-12' });
    const depois = await s.lancarOk(a, { data_operacional: HOJE });
    assert.deepEqual(depois.alertas.map((x) => [x.codigo, x.data_inicio, x.data_prevista_fim]), [['FORA_DO_INTERVALO', '2027-06-05', '2027-06-12']]);
    assert.deepEqual(Object.keys(depois.alertas[0]), ['codigo', 'mensagem', 'data_inicio', 'data_prevista_fim']);
    assert.match(depois.alertas[0].mensagem, /posterior ao fim previsto/);
    assert.equal(depois.apontamento.status, 'CONFIRMADO', 'gravado mesmo assim');
    const cedo = await s.lancarOk(a, { data_operacional: '2027-06-01' });
    assert.match(cedo.alertas[0].mensagem, /anterior ao início/);
    assert.deepEqual((await s.lancarOk(a, { data_operacional: '2027-06-05' })).alertas, [], 'no início');
    assert.deepEqual((await s.lancarOk(a, { data_operacional: '2027-06-12' })).alertas, [], 'no fim');
    // Editar para fora também só alerta.
    const e = await H.ok(s.A.editar(a, cedo.apontamento.id, { versao: 1, data_operacional: '2027-06-03' }));
    assert.equal(e.alertas[0].codigo, 'FORA_DO_INTERVALO');
    assert.equal((await H.ok(s.A.lista(a))).items.length, 4);
    // Período aberto (sem fim previsto): depois do início não alerta.
    const b = await s.abrir({ data_inicio: '2027-06-05', data_prevista_fim: null });
    assert.deepEqual((await s.lancarOk(b, { data_operacional: HOJE })).alertas, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('totais do cabeçalho', () => {
  test('area_executada e quantidade_produzida = soma dos CONFIRMADOS, recalculadas ao lançar, editar, cancelar e repetir; nenhum confirmado com valor → nulo', async () => {
    const s = await montar();
    const a = await s.abrir();
    const totais = (c) => [c.atividade.area_executada, c.atividade.quantidade_produzida];
    const l1 = await s.lancarOk(a, { data_operacional: '2027-06-02', area_executada_dia: '10', quantidade_produzida_dia: '2.5' });
    assert.deepEqual(totais(l1), ['10.0000', '2.5000'], 'lançar');
    const l2 = await s.lancarOk(a, { data_operacional: '2027-06-03', area_executada_dia: '5.25' });
    assert.deepEqual(totais(l2), ['15.2500', '2.5000'], 'lançar sem produção');
    const e = await H.ok(s.A.editar(a, l2.apontamento.id, { versao: 1, area_executada_dia: '7', quantidade_produzida_dia: '1' }));
    assert.deepEqual(totais(e), ['17.0000', '3.5000'], 'editar');
    const d = await H.ok(s.A.duplicar(a, l1.apontamento.id, { data_operacional: '2027-06-04' }), 201);
    assert.deepEqual(totais(d), ['27.0000', '6.0000'], 'repetir');
    const x = await H.ok(s.A.cancelar(a, l1.apontamento.id, { versao: 1, motivo: 'lançado em dobro' }));
    assert.deepEqual(totais(x), ['17.0000', '3.5000'], 'cancelar');
    const n = await H.ok(s.A.editar(a, l2.apontamento.id, { versao: 2, area_executada_dia: null, quantidade_produzida_dia: null }));
    assert.deepEqual(totais(n), ['10.0000', '2.5000'], 'null limpa o dia');
    await H.ok(s.A.cancelar(a, d.apontamento.id, { versao: 1, motivo: 'repetido por engano' }));
    const ultimo = await H.ok(s.A.cancelar(a, l2.apontamento.id, { versao: 3, motivo: 'chuva, não foi feito' }));
    assert.deepEqual(totais(ultimo), [null, null], 'nenhum confirmado → nulo');
    assert.deepEqual(ultimo.atividade.totais, { apontamentos_confirmados: 0, apontamentos_cancelados: 3, dias_com_apontamento: 0 });
    // O cabeçalho no banco bate com a resposta; a versão dele não andou.
    const linha = await prisma().atividade.findUnique({ where: { id: a.id } });
    assert.deepEqual([linha.area_executada, linha.quantidade_produzida, linha.versao], [null, null, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status da atividade e do apontamento', () => {
  test('concluir bloqueia novo apontamento, edição, cancelamento e repetição (409); reabrir libera; cancelada também bloqueia; nada gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    const tentativas = async () => [
      [await s.A.lancar(a, { data_operacional: '2027-06-10' }), 'lancar_apontamento'],
      [await s.A.editar(a, ap.id, { versao: 1, observacao: 'x' }), 'editar_apontamento'],
      [await s.A.cancelar(a, ap.id, { versao: 1, motivo: 'engano no lançamento' }), 'cancelar_apontamento'],
      [await s.A.duplicar(a, ap.id), 'lancar_apontamento'],
    ];
    const c = await H.ok(H.req('POST', `/atividades/${a.id}/concluir`, s.token, { empresa_id: s.e1.id, versao: 1 }));
    let antes = await foto(s.c);
    for (const [r, acao] of await tentativas()) {
      assert.deepEqual(erro(r), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null], r.body);
      assert.deepEqual(r.json().details, { status: 'CONCLUIDA', acao, entidade: 'atividade' });
    }
    assert.equal(await foto(s.c), antes, 'concluída: nada gravado');
    // A leitura segue.
    assert.equal((await H.ok(s.A.lista(a))).items.length, 1);
    // Reabrir libera o lançamento.
    const r = await H.ok(H.req('POST', `/atividades/${a.id}/reabrir`, s.token, { empresa_id: s.e1.id, versao: c.versao, motivo: 'faltou um dia' }));
    assert.equal((await s.A.lancar(a, { data_operacional: '2027-06-11' })).statusCode, 201);
    await H.ok(H.req('POST', `/atividades/${a.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: r.versao, motivo: 'atividade errada' }));
    antes = await foto(s.c);
    for (const [resp, acao] of await tentativas()) {
      assert.deepEqual(erro(resp), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null], resp.body);
      assert.deepEqual(resp.json().details, { status: 'CANCELADA', acao, entidade: 'atividade' });
    }
    assert.equal(await foto(s.c), antes, 'cancelada: nada gravado');
  });

  test('cancelar o apontamento: motivo (ausente, vazio, nulo, curto, longo → 422); quem, quando e motivo gravados; de novo → 409; cancelado não edita; sequência não é reaproveitada', async () => {
    const s = await montar();
    const a = await s.abrir();
    const p1 = (await s.lancarOk(a, { data_operacional: '2027-06-10', area_executada_dia: '10', quantidade_produzida_dia: '2' })).apontamento;
    const antes = await foto(s.c);
    for (const [motivo, reason] of [[undefined, 'obrigatorio'], ['   ', 'obrigatorio'], [null, 'obrigatorio'], [' ab ', 'curto'], ['x'.repeat(501), 'longo']]) {
      const corpo = { versao: 1, ...(motivo === undefined ? {} : { motivo }) };
      assert.deepEqual(erro(await s.A.cancelar(a, p1.id, corpo)), [422, 'ATIVIDADE_MOTIVO_INVALIDO', 'motivo', reason], String(motivo));
    }
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // 500 úteis valem (aparado).
    const r = await H.ok(s.A.cancelar(a, p1.id, { versao: 1, motivo: `  ${'x'.repeat(500)}  ` }));
    assert.deepEqual(Object.keys(r), ['apontamento', 'atividade', 'alertas']);
    assert.deepEqual([r.apontamento.status, r.apontamento.versao, r.apontamento.motivo_cancelamento], ['CANCELADO', 2, 'x'.repeat(500)]);
    assert.deepEqual(r.apontamento.cancelado_por, { id: s.adm.usuario.id, nome: 'Operador de Teste' });
    assert.equal(r.apontamento.cancelado_em, '2027-06-15T15:00:00.000Z', 'o relógio do servidor');
    assert.deepEqual(r.alertas, []);
    assert.deepEqual(erro(await s.A.cancelar(a, p1.id, { versao: 2, motivo: 'de novo' })), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null]);
    const c = await s.A.editar(a, p1.id, { versao: 2, observacao: 'x' });
    assert.deepEqual(erro(c), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null]);
    assert.deepEqual(c.json().details, { status: 'CANCELADO', acao: 'editar_apontamento', entidade: 'apontamento' });
    const novo = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    assert.equal(novo.sequencia, 2, 'a sequência do cancelado não volta');
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade_apontamento.cancelar' } });
    assert.equal(au.length, 1);
    assert.ok(!JSON.stringify(au).includes('xxxxxxxxxx'), 'motivo fora da auditoria');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('editar (PATCH, CAS por versão)', () => {
  test('conflito de versão: 409 com versao_atual, versao_informada e entidade "apontamento"; nada muda', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    await H.ok(s.A.editar(a, ap.id, { versao: 1, observacao: 'primeira' }));
    const antes = await foto(s.c);
    for (const [r, informada] of [
      [await s.A.editar(a, ap.id, { versao: 1, observacao: 'velha' }), 1],
      [await s.A.editar(a, ap.id, { versao: 9, observacao: 'futura' }), 9],
      [await s.A.cancelar(a, ap.id, { versao: 1, motivo: 'motivo válido' }), 1],
    ]) {
      assert.deepEqual(erro(r), [409, 'ATIVIDADE_VERSAO_CONFLITO', null, null], r.body);
      assert.deepEqual(r.json().details, { versao_atual: 2, versao_informada: informada, entidade: 'apontamento' });
    }
    assert.equal(await foto(s.c), antes);
  });

  test('trocar turno ou data refaz a sequência; manter não; corpo fechado (área, origem, só a versão → 400); auditoria com os campos alterados', async () => {
    const s = await montar();
    const a = await s.abrir();
    await s.lancarOk(a, { data_operacional: '2027-06-10', turno: 'MANHA', area_executada_dia: '10' });
    const p2 = (await s.lancarOk(a, { data_operacional: '2027-06-10', turno: 'MANHA', area_executada_dia: '5' })).apontamento;
    await s.lancarOk(a, { data_operacional: '2027-06-10', turno: 'TARDE' });
    assert.equal(p2.sequencia, 2);
    const antes = await foto(s.c);
    for (const corpo of [{ versao: 1 }, { versao: 1, area_id: s.area1.id }, { versao: 1, origem: 'APP' }, { versao: 1, sequencia: 5 }, { versao: 1, centro_custo_id: s.centro1.id }, { observacao: 'sem versão' }]) {
      assert.deepEqual(erro(await s.A.editar(a, p2.id, corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], JSON.stringify(corpo));
    }
    assert.equal(await foto(s.c), antes);
    const t = await H.ok(s.A.editar(a, p2.id, { versao: 1, turno: 'TARDE', area_executada_dia: '7.25' }));
    assert.deepEqual([t.apontamento.turno, t.apontamento.sequencia, t.apontamento.versao], ['TARDE', 2, 2], 'vai para TARDE como segunda passada');
    const mesma = await H.ok(s.A.editar(a, p2.id, { versao: 2, observacao: 'sem sequência nova', data_operacional: '2027-06-10' }));
    assert.equal(mesma.apontamento.sequencia, 2, 'mesmo dia e turno: mantém');
    const dia = await H.ok(s.A.editar(a, p2.id, { versao: 3, data_operacional: '2027-06-08' }));
    assert.deepEqual([dia.apontamento.data_operacional, dia.apontamento.sequencia], ['2027-06-08', 1]);
    const sem = await H.ok(s.A.editar(a, p2.id, { versao: 4, turno: null }));
    assert.deepEqual([sem.apontamento.turno, sem.apontamento.sequencia], [null, 1]);
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade_apontamento.editar' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(au[0].dados_novos.campos_alterados, ['area_executada_dia', 'sequencia', 'turno']);
  });

  test('PATCH sem empresa_id: vale a fazenda da atividade; com a fazenda errada ou de outro tenant → 404', async () => {
    const s = await montar();
    const outro = await montar();
    const a = await s.abrir({ empresa_id: s.e2.id, area_id: s.area2.id });
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10', area_executada_dia: '2' })).apontamento;
    const r = await H.ok(s.A.editar(a, ap.id, { versao: 1, area_executada_dia: '4' }));
    assert.deepEqual([r.apontamento.empresa_id, r.atividade.area_executada], [s.e2.id, '4.0000']);
    const antes = await foto(s.c);
    assert.deepEqual(erro(await s.A.editar(a, ap.id, { empresa_id: s.e1.id, versao: 2, observacao: 'x' })), [404, 'ATIVIDADE_NOT_FOUND', null, null]);
    assert.deepEqual(erro(await s.A.editar(a, ap.id, { versao: 2, observacao: 'x' }, outro.token)), [404, 'ATIVIDADE_NOT_FOUND', null, null]);
    assert.equal(await foto(s.c), antes);
    assert.equal((await s.A.editar(a, ap.id, { empresa_id: s.e2.id, versao: 2, observacao: 'com a empresa certa' })).statusCode, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('repetir (duplicar apontamento)', () => {
  test('copia turno, operador, área do dia, produção e observação; dia padrão hoje; sequência nova; origem WEB; corpo fechado; auditoria', async () => {
    const s = await montar();
    const a = await s.abrir();
    const base = (await s.lancarOk(a, {
      data_operacional: '2027-06-10', turno: 'NOITE', operador_usuario_id: s.adm.usuario.id,
      area_executada_dia: '3.5', quantidade_produzida_dia: '1.25', observacao: 'passada 1', origem: 'APP',
    })).apontamento;
    const r = await H.ok(s.A.duplicar(a, base.id), 201);
    assert.deepEqual(Object.keys(r), ['apontamento', 'atividade', 'alertas']);
    const c = r.apontamento;
    assert.notEqual(c.id, base.id);
    assert.deepEqual(
      [c.data_operacional, c.turno, c.operador_usuario_id, c.area_executada_dia, c.quantidade_produzida_dia, c.observacao, c.origem, c.sequencia, c.status, c.versao],
      [HOJE, 'NOITE', s.adm.usuario.id, '3.5000', '1.2500', 'passada 1', 'WEB', 1, 'CONFIRMADO', 1]
    );
    assert.equal(r.atividade.area_executada, '7.0000');
    const r2 = await H.ok(s.A.duplicar(a, base.id, { data_operacional: '2027-06-10' }), 201);
    assert.equal(r2.apontamento.sequencia, 2, 'mesmo dia e turno: segunda passada');
    for (const corpo of [{ turno: 'MANHA' }, { area_executada_dia: '1' }, { observacao: 'x' }, { origem: 'APP' }]) {
      assert.deepEqual(erro(await s.A.duplicar(a, base.id, corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], JSON.stringify(corpo));
    }
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade_apontamento.duplicar' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(au.map((x) => x.dados_novos.duplicado_de), [base.id, base.id]);
    assert.ok(!JSON.stringify(au).includes('passada 1'), 'sem texto livre');
    // A base não muda.
    assert.deepEqual(await H.ok(s.A.detalhe(a, base.id)), base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isolamento e permissões', () => {
  test('apontamento de outra atividade, atividade de outra fazenda e de outro tenant → 404 (nunca 403); nada muda', async () => {
    const s = await montar();
    const outro = await montar();
    const a = await s.abrir();
    const b = await s.abrir({ nome: 'Outra' });
    const e2 = await s.abrir({ empresa_id: s.e2.id, area_id: s.area2.id });
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    const antes = await foto(s.c);
    // Apontamento de outra atividade.
    for (const r of [
      await s.A.detalhe(b, ap.id),
      await s.A.editar(b, ap.id, { versao: 1, observacao: 'x' }),
      await s.A.cancelar(b, ap.id, { versao: 1, motivo: 'motivo válido' }),
      await s.A.duplicar(b, ap.id),
    ]) {
      assert.deepEqual(erro(r), [404, 'ATIVIDADE_APONTAMENTO_NOT_FOUND', null, null], r.body);
    }
    // Atividade da fazenda 1 pedida com a fazenda 2.
    const errada = { ...a, empresa_id: s.e2.id };
    for (const r of [
      await s.A.lista(a, s.token, s.e2.id),
      await s.A.detalhe(a, ap.id, s.token, s.e2.id),
      await s.A.lancar(errada, { data_operacional: '2027-06-10' }),
      await s.A.cancelar(errada, ap.id, { versao: 1, motivo: 'motivo válido' }),
      await s.A.duplicar(errada, ap.id),
    ]) {
      assert.deepEqual(erro(r), [404, 'ATIVIDADE_NOT_FOUND', null, null], r.body);
    }
    assert.deepEqual((await H.ok(s.A.lista(e2))).items, []);
    // Outro tenant: com a empresa do dono, a empresa não é dele; com a dele, a atividade não existe.
    assert.deepEqual(erro(await s.A.lista(a, outro.token)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    const alheia = { ...a, empresa_id: outro.e1.id };
    for (const r of [
      await s.A.lista(alheia, outro.token),
      await s.A.detalhe(alheia, ap.id, outro.token),
      await s.A.lancar(alheia, { data_operacional: '2027-06-10' }, outro.token),
      await s.A.editar(alheia, ap.id, { versao: 1, observacao: 'x' }, outro.token),
      await s.A.cancelar(alheia, ap.id, { versao: 1, motivo: 'motivo válido' }, outro.token),
      await s.A.duplicar(alheia, ap.id, {}, outro.token),
    ]) {
      assert.deepEqual(erro(r), [404, 'ATIVIDADE_NOT_FOUND', null, null], r.body);
    }
    assert.equal(await foto(s.c), antes, 'nada mudou no dono');
  });

  test('permissões: só visualizar lê e não escreve; lancar_apontamento lança e repete; editar_apontamento edita; cancelar_apontamento cancela; as ações padrão não bastam; sem a tela → 403', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    // Todas as ações padrão (e reabrir), sem as extras do apontamento.
    const padrao = await s.contaTela({ novo: true, salvar: true, editar: true, excluir: true, importar: true, exportar: true, reabrir: true });
    assert.equal((await s.A.lista(a, padrao.token)).statusCode, 200);
    assert.equal((await s.A.detalhe(a, ap.id, padrao.token)).statusCode, 200);
    const antes = await foto(s.c);
    for (const r of [
      await s.A.lancar(a, { data_operacional: '2027-06-10' }, padrao.token),
      await s.A.duplicar(a, ap.id, {}, padrao.token),
      await s.A.editar(a, ap.id, { versao: 1, observacao: 'x' }, padrao.token),
      await s.A.cancelar(a, ap.id, { versao: 1, motivo: 'motivo válido' }, padrao.token),
    ]) {
      assert.deepEqual(erro(r).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], r.body);
    }
    assert.equal(await foto(s.c), antes);
    const lanca = await s.contaTela({ lancar_apontamento: true });
    assert.equal((await s.A.lancar(a, { data_operacional: '2027-06-10' }, lanca.token)).statusCode, 201);
    assert.equal((await s.A.duplicar(a, ap.id, {}, lanca.token)).statusCode, 201);
    assert.equal((await s.A.editar(a, ap.id, { versao: 1, observacao: 'x' }, lanca.token)).statusCode, 403);
    assert.equal((await s.A.cancelar(a, ap.id, { versao: 1, motivo: 'motivo válido' }, lanca.token)).statusCode, 403);
    const edita = await s.contaTela({ editar_apontamento: true });
    assert.equal((await s.A.editar(a, ap.id, { versao: 1, observacao: 'x' }, edita.token)).statusCode, 200);
    assert.equal((await s.A.lancar(a, { data_operacional: '2027-06-10' }, edita.token)).statusCode, 403);
    const cancela = await s.contaTela({ cancelar_apontamento: true });
    assert.equal((await s.A.cancelar(a, ap.id, { versao: 2, motivo: 'motivo válido' }, cancela.token)).statusCode, 200);
    assert.equal((await s.A.editar(a, ap.id, { versao: 3, observacao: 'x' }, cancela.token)).statusCode, 403);
    // Extra sem visualizar não vale; sem a tela, nem a leitura.
    const semVer = await s.contaTela({ visualizar: false, lancar_apontamento: true });
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10' }, semVer.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await s.A.lista(a, semVer.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    const semTela = await s.conta(null);
    assert.deepEqual(erro(await s.A.lista(a, semTela.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    assert.deepEqual(erro(await s.A.lancar(a, { data_operacional: '2027-06-10' }, semTela.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
  });

  test('fazenda sem fuso: lançar, editar, cancelar e repetir falham fechados (409); a leitura segue', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10' })).apontamento;
    await prisma().empresa.update({ where: { id: s.e1.id }, data: { fuso_horario: null } });
    const antes = await foto(s.c);
    for (const r of [
      await s.A.lancar(a, { data_operacional: '2027-06-10' }),
      await s.A.editar(a, ap.id, { versao: 1, observacao: 'x' }),
      await s.A.cancelar(a, ap.id, { versao: 1, motivo: 'motivo válido' }),
      await s.A.duplicar(a, ap.id),
    ]) {
      assert.deepEqual(erro(r).slice(0, 2), [409, 'EMPRESA_FUSO_NAO_CONFIGURADO'], r.body);
    }
    assert.equal(await foto(s.c), antes);
    assert.equal((await s.A.lista(a)).statusCode, 200, 'a leitura não depende do fuso');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('concorrência', () => {
  test('lançamentos simultâneos no mesmo dia e turno recebem sequências distintas e os totais somam todos', async () => {
    const s = await montar();
    const a = await s.abrir();
    const rs = await Promise.all(Array.from({ length: 6 }, () => s.A.lancar(a, { data_operacional: '2027-06-10', turno: 'MANHA', area_executada_dia: '1' })));
    for (const r of rs) assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(rs.map((r) => r.json().apontamento.sequencia).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);
    const at = await prisma().atividade.findUnique({ where: { id: a.id } });
    assert.equal(at.area_executada.toFixed(4), '6.0000');
  });

  test('dois PATCH com a mesma versão: um ganha, o outro 409; cancelar a atividade × lançar: o estado final é coerente', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = (await s.lancarOk(a, { data_operacional: '2027-06-10', area_executada_dia: '1' })).apontamento;
    const rs = await Promise.all([s.A.editar(a, ap.id, { versao: 1, area_executada_dia: '2' }), s.A.editar(a, ap.id, { versao: 1, area_executada_dia: '3' })]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' | '));
    assert.equal(rs.find((r) => r.statusCode === 409).json().code, 'ATIVIDADE_VERSAO_CONFLITO');
    const [cancelada, lancado] = await Promise.all([
      H.req('POST', `/atividades/${a.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: 1, motivo: 'corrida' }),
      s.A.lancar(a, { data_operacional: '2027-06-11', area_executada_dia: '5' }),
    ]);
    assert.equal(cancelada.statusCode, 200, cancelada.body);
    assert.ok([201, 409].includes(lancado.statusCode), lancado.body);
    // Cancelada: nenhum apontamento confirmado sobra e os totais são nulos.
    const filhos = await prisma().atividadeApontamento.findMany({ where: { atividade_id: a.id } });
    assert.ok(filhos.every((f) => f.status === 'CANCELADO'), JSON.stringify(filhos.map((f) => f.status)));
    const at = await prisma().atividade.findUnique({ where: { id: a.id } });
    assert.deepEqual([at.status, at.area_executada, at.quantidade_produzida], ['CANCELADA', null, null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('as funções que o cabeçalho chama ao cancelar a atividade', () => {
  test('cancelarApontamentosDaAtividade: um UPDATE só dos CONFIRMADOS (mesmo motivo, instante e usuário; versão + 1), recalcula os totais; outro tenant não toca; motivo vazio recusa', async () => {
    const s = await montar();
    const a = await s.abrir();
    const p1 = (await s.lancarOk(a, { data_operacional: '2027-06-10', area_executada_dia: '10' })).apontamento;
    await s.lancarOk(a, { data_operacional: '2027-06-11', area_executada_dia: '5', quantidade_produzida_dia: '2' });
    await H.ok(s.A.cancelar(a, p1.id, { versao: 1, motivo: 'abc' }));
    const agora = new Date('2027-06-15T15:30:00.000Z');
    const n = await emTransacao(TRANSACAO_CURTA, (tx) =>
      cancelarApontamentosDaAtividade(tx, { clienteId: s.c, empresaId: s.e1.id, atividadeId: a.id, usuarioId: s.adm.usuario.id, motivo: 'atividade cancelada', agora }));
    assert.equal(n, 1, 'só o confirmado');
    const aps = await prisma().atividadeApontamento.findMany({ where: { atividade_id: a.id }, orderBy: { data_operacional: 'asc' } });
    assert.deepEqual(aps.map((x) => [x.status, x.versao, x.motivo_cancelamento]), [['CANCELADO', 2, 'abc'], ['CANCELADO', 2, 'atividade cancelada']]);
    assert.deepEqual([aps[1].cancelado_em.toISOString(), aps[1].cancelado_por_usuario_id], [agora.toISOString(), s.adm.usuario.id]);
    const at = await prisma().atividade.findUnique({ where: { id: a.id } });
    assert.deepEqual([at.area_executada, at.quantidade_produzida, at.versao], [null, null, 1], 'totais nulos; versão do cabeçalho intacta');
    // Recalcular avulso.
    await prisma().atividadeApontamento.update({ where: { id: aps[1].id }, data: { status: 'CONFIRMADO', cancelado_em: null } });
    const somas = await emTransacao(TRANSACAO_CURTA, (tx) => recalcularTotaisDaAtividade(tx, { clienteId: s.c, empresaId: s.e1.id, atividadeId: a.id }));
    assert.deepEqual(somas, { area_executada: '5.0000', quantidade_produzida: '2.0000' });
    // Outro tenant não toca.
    const outro = await montar();
    const m = await emTransacao(TRANSACAO_CURTA, (tx) =>
      cancelarApontamentosDaAtividade(tx, { clienteId: outro.c, empresaId: s.e1.id, atividadeId: a.id, usuarioId: null, motivo: 'x', agora }));
    assert.equal(m, 0);
    assert.equal((await prisma().atividadeApontamento.findUnique({ where: { id: aps[1].id } })).status, 'CONFIRMADO');
    await assert.rejects(() => emTransacao(TRANSACAO_CURTA, (tx) =>
      cancelarApontamentosDaAtividade(tx, { clienteId: s.c, empresaId: s.e1.id, atividadeId: a.id, usuarioId: null, motivo: '', agora })));
  });
});
