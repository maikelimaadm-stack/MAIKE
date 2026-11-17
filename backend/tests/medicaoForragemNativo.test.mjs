/**
 * Medição de Forragem (D-PROD-219), tabela física "MEDICAOFORRAGEM" — PostgreSQL real.
 *
 * Régua: leituras em cm → média (1 casa) e situação pelas alturas da cultura da área
 * (RAPADO < saída ≤ DESCANSO < entrada ≤ PRONTO ≤ entrada × 1,2 < PASSOU); sem cultura
 * ou sem alturas → sem situação. Amostra de corte opcional → matéria verde (kg/ha),
 * MS (%) pelo peso seco ou digitada, massa seca (kg MS/ha). No olho: só a situação.
 * Derivados são do servidor (corpo fechado). Só pasto DESTA fazenda; infraestrutura não.
 * Listar é só autenticado; criar e excluir com a chave do mapa `medir_forragem`.
 * Relógio de teste: MAIKE_TESTE_AGORA = 2027-06-15T15:00:00Z (12:00 em São Paulo).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { situacaoPelaAltura, calcularAmostra, lerLeituras, mediaDasLeituras } from '../src/modules/medicoesForragem/medicaoForragemCalculo.js';
import * as daTela from '../../src/domain/pastagem/medicaoForragem.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

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

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

const CAMPOS_PUBLICOS = [
  'altura_entrada_cm', 'altura_media_cm', 'altura_saida_cm', 'area_id', 'created_date', 'cultura_id', 'data_medicao', 'empresa_id', 'id',
  'leituras_cm', 'massa_seca_kg_ha', 'massa_verde_kg_ha', 'materia_seca_pct', 'metodo', 'observacoes', 'peso_seco_g', 'peso_verde_g',
  'qtd_amostras', 'qtd_leituras', 'quadro_m2', 'registrado_por_nome', 'situacao', 'updated_date',
].sort();

let seq = 0;
const area = async (clienteId, empresaId, setor, extra = {}) => {
  seq += 1;
  return prisma().areaPastagem.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, setor_id: setor.id, setor_nome: setor.nome, numero_area: `MF${seq}-${randomUUID().slice(0, 6)}`, nome: `PASTO ${seq}`, tamanho_hectares: 8, ...extra },
  });
};

/** Tenant administrador com duas fazendas: pasto com Marandu (25/15), pasto sem cultura e infraestrutura na 1; pasto na 2. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}`, fuso_horario: 'America/Sao_Paulo' } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const s1 = await prisma().setor.create({ data: { cliente_id: c, empresa_id: e1.id, numero_setor: '1', nome: 'SETOR 1' } });
  const s2 = await prisma().setor.create({ data: { cliente_id: c, empresa_id: e2.id, numero_setor: '2', nome: 'SETOR 2' } });
  const marandu = await prisma().cultura.create({ data: { cliente_id: c, empresa_id: e1.id, codigo: '001', tipo: 'PASTAGEM', nome: 'BRACHIARIA BRIZANTHA CV. MARANDU', altura_entrada_cm: 25, altura_saida_cm: 15 } });
  const pasto = await area(c, e1.id, s1, { cultura_id: marandu.id, tipo_pastagem: marandu.nome });
  const semCultura = await area(c, e1.id, s1);
  const infra = await area(c, e1.id, s1, { tipo_cultura: 'Infraestrutura', tipo_pastagem: 'Curral', tamanho_hectares: 0 });
  const pastoE2 = await area(c, e2.id, s2);
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, e1, e2, adm, marandu, pasto, semCultura, infra, pastoE2 };
};

const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), ...a });
const verMapa = (chaves = {}) => ({
  permissoes_telas: [linha('mapa', 'pec-mapa-geral', { visualizar: true }), linha('mapa', 'pec-mapa-cadastro', {})],
  mapa_geral_permissoes: { visualizar_areas: true, lancar_suplementacao: false, mover_lotes: false, medir_forragem: false, ...chaves },
});
const contaCom = async (cen, extra = {}) => {
  const senha = cen.adm.credenciais.senha;
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.clienteId, nome: 'Gerente Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.clienteId, user_email: login, user_nome: 'Gerente Op', modulos_permitidos: ['mapa'], ...extra } });
  const { corpo } = await autenticarNoApp(app, { login, senha });
  assert.ok(corpo.token, 'login da conta comum');
  return corpo.token;
};

const regua = (cen, extra = {}) => ({ empresa_id: cen.e1.id, area_id: cen.pasto.id, data_medicao: '2027-06-15', metodo: 'REGUA', leituras_cm: '22 26 24 20 28 25 23 27 24 21', ...extra });
const olho = (cen, extra = {}) => ({ empresa_id: cen.e1.id, area_id: cen.pasto.id, data_medicao: '2027-06-15', metodo: 'OLHO', situacao: 'PRONTO', ...extra });

describe('D-PROD-219 — contas da medição (servidor e tela iguais)', () => {
  test('MF-00 leituras pt-BR, média, situação pelos limites e amostra; a cópia da tela dá o mesmo', () => {
    for (const m of [{ situacaoPelaAltura, calcularAmostra, lerLeituras, mediaDasLeituras }, daTela]) {
      assert.deepEqual(m.lerLeituras('22 26,5;24/ 20'), { valores: [22, 26.5, 24, 20], invalidas: [] });
      assert.deepEqual(m.lerLeituras('22 abc 600 -1'), { valores: [22], invalidas: ['abc', '600', '-1'] });
      assert.equal(m.mediaDasLeituras([22, 26, 24, 20, 28, 25, 23, 27, 24, 21]), 24);
      assert.equal(m.mediaDasLeituras([10, 10, 11]), 10.3);
      assert.deepEqual(
        [14.9, 15, 24.9, 25, 30, 30.1].map((x) => m.situacaoPelaAltura(x, 25, 15)),
        ['RAPADO', 'DESCANSO', 'DESCANSO', 'PRONTO', 'PRONTO', 'PASSOU'],
      );
      assert.equal(m.situacaoPelaAltura(20, null, 15), null, 'sem altura de entrada: sem situação');
      assert.deepEqual(m.calcularAmostra({ quadro_m2: 0.25, peso_verde_g: 450, peso_seco_g: 112.5 }), { massa_verde_kg_ha: 18000, materia_seca_pct: 25, massa_seca_kg_ha: 4500 });
      assert.deepEqual(m.calcularAmostra({ quadro_m2: 1, peso_verde_g: 1200, materia_seca_pct: 22.5 }), { massa_verde_kg_ha: 12000, materia_seca_pct: 22.5, massa_seca_kg_ha: 2700 });
      assert.deepEqual(m.calcularAmostra({ quadro_m2: 0.5, peso_verde_g: 300 }), { massa_verde_kg_ha: 6000, materia_seca_pct: null, massa_seca_kg_ha: null });
    }
    assert.equal(daTela.toneladasNoPasto(4500, 8), 36);
  });
});

describe('D-PROD-219 — medição de forragem (API)', () => {
  test('MF-01 régua com amostra: média, situação pela cultura (retrato), matéria verde/seca calculadas; quem registrou vem da conta; formato público fechado', async () => {
    const cen = await cenario();
    const r = await req('POST', '/medicoes-forragem', cen.token, regua(cen, { quadro_m2: '0,25', qtd_amostras: 3, peso_verde_g: 450, peso_seco_g: '112,5', observacoes: '  depois da chuva  ' }));
    assert.equal(r.statusCode, 201, r.body);
    const m = r.json();
    assert.deepEqual(Object.keys(m).sort(), CAMPOS_PUBLICOS);
    assert.deepEqual(
      [m.metodo, m.qtd_leituras, m.altura_media_cm, m.situacao, m.altura_entrada_cm, m.altura_saida_cm, m.cultura_id],
      ['REGUA', 10, 24, 'DESCANSO', 25, 15, cen.marandu.id],
    );
    assert.deepEqual(m.leituras_cm, [22, 26, 24, 20, 28, 25, 23, 27, 24, 21]);
    assert.deepEqual([m.quadro_m2, m.qtd_amostras, m.peso_verde_g, m.peso_seco_g, m.materia_seca_pct, m.massa_verde_kg_ha, m.massa_seca_kg_ha], [0.25, 3, 450, 112.5, 25, 18000, 4500]);
    assert.equal(m.observacoes, 'depois da chuva');
    const usuario = await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } });
    assert.equal(m.registrado_por_nome, usuario.nome);
    const banco = await prisma().medicaoForragem.findUnique({ where: { id: m.id } });
    assert.equal(banco.cliente_id, cen.clienteId);
    // O retrato não muda quando a cultura muda depois.
    await prisma().cultura.update({ where: { id: cen.marandu.id }, data: { altura_entrada_cm: 30 } });
    const lista = (await req('GET', `/medicoes-forragem?area_id=${cen.pasto.id}`, cen.token)).json();
    assert.equal(lista[0].altura_entrada_cm, 25);
  });

  test('MF-02 régua sem amostra, MS% digitada sem peso seco; pasto sem cultura → sem situação; PRONTO e PASSOU pelos limites', async () => {
    const cen = await cenario();
    const casos = [
      [regua(cen, { leituras_cm: [30, 30] }), 'PRONTO'],
      [regua(cen, { leituras_cm: ['30,1'] }), 'PASSOU'],
      [regua(cen, { leituras_cm: '10 12' }), 'RAPADO'],
      [regua(cen, { area_id: cen.semCultura.id }), null],
    ];
    for (const [corpo, situacao] of casos) {
      const r = await req('POST', '/medicoes-forragem', cen.token, corpo);
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().situacao, situacao, JSON.stringify(corpo));
      assert.equal(r.json().massa_seca_kg_ha, null);
    }
    const lab = await req('POST', '/medicoes-forragem', cen.token, regua(cen, { quadro_m2: 1, peso_verde_g: 1200, materia_seca_pct: '22,5' }));
    assert.equal(lab.statusCode, 201, lab.body);
    assert.deepEqual([lab.json().massa_verde_kg_ha, lab.json().materia_seca_pct, lab.json().massa_seca_kg_ha, lab.json().peso_seco_g, lab.json().qtd_amostras], [12000, 22.5, 2700, null, 1]);
    const semCultura = (await req('GET', `/medicoes-forragem?area_id=${cen.semCultura.id}`, cen.token)).json()[0];
    assert.deepEqual([semCultura.cultura_id, semCultura.altura_entrada_cm, semCultura.altura_saida_cm], [null, null, null]);
  });

  test('MF-03 no olho: situação obrigatória e fechada; leitura ou amostra junto → 400; régua não aceita situação', async () => {
    const cen = await cenario();
    const ok = await req('POST', '/medicoes-forragem', cen.token, olho(cen, { situacao: 'PASSOU' }));
    assert.equal(ok.statusCode, 201, ok.body);
    assert.deepEqual([ok.json().metodo, ok.json().situacao, ok.json().altura_media_cm, ok.json().leituras_cm, ok.json().cultura_id], ['OLHO', 'PASSOU', null, null, cen.marandu.id]);
    for (const [corpo, field, reason] of [
      [olho(cen, { situacao: undefined }), 'situacao', 'obrigatorio'],
      [olho(cen, { leituras_cm: '20 22' }), 'leituras_cm', 'nao_aceita'],
      [olho(cen, { peso_verde_g: 100 }), 'peso_verde_g', 'nao_aceita'],
      [regua(cen, { situacao: 'PRONTO' }), 'situacao', 'nao_aceita'],
    ]) {
      for (const [k, v] of Object.entries(corpo)) if (v === undefined) delete corpo[k];
      const r = await req('POST', '/medicoes-forragem', cen.token, corpo);
      assert.equal(r.statusCode, 400, `${JSON.stringify(corpo)} → ${r.body}`);
      assert.deepEqual([r.json().field, r.json().reason], [field, reason], r.body);
    }
    const fora = await req('POST', '/medicoes-forragem', cen.token, olho(cen, { situacao: 'OTIMO' }));
    assert.equal(fora.statusCode, 400, fora.body);
    assert.equal(await prisma().medicaoForragem.count(), 1);
  });

  test('MF-04 validação: leituras, amostra incompleta ou incoerente, data inválida/futura, corpo fechado (derivados, cliente_id, cultura_id)', async () => {
    const cen = await cenario();
    const casos = [
      [{ leituras_cm: '' }, 'leituras_cm', 'obrigatorio'],
      [{ leituras_cm: '20 abc' }, 'leituras_cm', 'leitura_invalida'],
      [{ leituras_cm: '20 501' }, 'leituras_cm', 'leitura_invalida'],
      [{ peso_verde_g: 450 }, 'quadro_m2', 'obrigatorio_na_amostra'],
      [{ quadro_m2: 0.25 }, 'peso_verde_g', 'obrigatorio_na_amostra'],
      [{ quadro_m2: 0.25, peso_verde_g: 100, peso_seco_g: 150 }, 'peso_seco_g', 'maior_que_verde'],
      [{ quadro_m2: 0.25, peso_verde_g: 100, materia_seca_pct: 101 }, 'materia_seca_pct', 'valor_fora_da_faixa'],
      [{ quadro_m2: '0,2501', peso_verde_g: 100 }, 'quadro_m2', 'casas_decimais'],
      [{ data_medicao: '2027-02-30' }, 'data_medicao', 'data_invalida'],
      [{ data_medicao: '2027-06-16' }, 'data_medicao', 'data_futura'],
      [{ altura_media_cm: 40 }, null, null],
      [{ massa_seca_kg_ha: 9999 }, null, null],
      [{ cliente_id: 'outro' }, null, null],
      [{ cultura_id: cen.marandu.id }, null, null],
      [{ registrado_por_nome: 'Fulano' }, null, null],
      [{ metodo: 'LASER' }, null, null],
    ];
    for (const [extra, field, reason] of casos) {
      const r = await req('POST', '/medicoes-forragem', cen.token, regua(cen, extra));
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)} → ${r.body}`);
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED', r.body);
      if (field) assert.deepEqual([r.json().field, r.json().reason], [field, reason], r.body);
    }
    assert.equal(await prisma().medicaoForragem.count(), 0, 'nada gravado');
  });

  test('MF-05 pasto: de outra fazenda, de outro tenant, inexistente ou infraestrutura → 400; fazenda de outro tenant → 404', async () => {
    const cen = await cenario();
    const outro = await cenario();
    for (const [corpo, reason] of [
      [regua(cen, { area_id: cen.pastoE2.id }), 'area_de_outra_fazenda'],
      [regua(cen, { area_id: outro.pasto.id }), 'area_inexistente'],
      [regua(cen, { area_id: 'nao-existe' }), 'area_inexistente'],
      [olho(cen, { area_id: cen.infra.id }), 'area_sem_forragem'],
    ]) {
      const r = await req('POST', '/medicoes-forragem', cen.token, corpo);
      assert.equal(r.statusCode, 400, r.body);
      assert.deepEqual([r.json().field, r.json().reason], ['area_id', reason], r.body);
    }
    const alheia = await req('POST', '/medicoes-forragem', cen.token, regua(cen, { empresa_id: outro.e1.id, area_id: outro.pasto.id }));
    assert.equal(alheia.statusCode, 404, alheia.body);
    assert.equal(alheia.json().code, 'EMPRESA_NOT_FOUND');
    assert.equal(await prisma().medicaoForragem.count(), 0);
  });

  test('MF-06 tenancy e lista: mais recente primeiro, filtra por fazenda e por pasto; outro tenant não vê nem exclui', async () => {
    const cen = await cenario();
    const outro = await cenario();
    for (const dia of ['2027-06-10', '2027-06-14', '2027-06-12']) {
      assert.equal((await req('POST', '/medicoes-forragem', cen.token, olho(cen, { data_medicao: dia }))).statusCode, 201);
    }
    const daE2 = (await req('POST', '/medicoes-forragem', cen.token, { empresa_id: cen.e2.id, area_id: cen.pastoE2.id, data_medicao: '2027-06-15', metodo: 'OLHO', situacao: 'RAPADO' })).json();
    const alheia = (await req('POST', '/medicoes-forragem', outro.token, olho(outro))).json();
    const doPasto = (await req('GET', `/medicoes-forragem?area_id=${cen.pasto.id}`, cen.token)).json();
    assert.deepEqual(doPasto.map((m) => m.data_medicao), ['2027-06-14', '2027-06-12', '2027-06-10']);
    assert.deepEqual((await req('GET', `/medicoes-forragem?empresa_id=${cen.e2.id}`, cen.token)).json().map((m) => m.id), [daE2.id]);
    assert.equal((await req('GET', '/medicoes-forragem', cen.token)).json().length, 4);
    assert.deepEqual((await req('GET', `/medicoes-forragem?empresa_id=${outro.e1.id}`, cen.token)).json(), [], 'fazenda de outro tenant não vaza');
    const r = await req('DELETE', `/medicoes-forragem/${alheia.id}`, cen.token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'MEDICAO_FORRAGEM_NOT_FOUND');
    assert.equal(await prisma().medicaoForragem.count({ where: { id: alheia.id } }), 1);
  });

  test('MF-07 exclusão física e auditoria; repetir dá 404; pasto ou cultura com medição não são apagados (RESTRICT)', async () => {
    const cen = await cenario();
    const m = (await req('POST', '/medicoes-forragem', cen.token, regua(cen))).json();
    await assert.rejects(() => prisma().areaPastagem.delete({ where: { id: cen.pasto.id } }), /Foreign key|foreign key|violates/i);
    await prisma().areaPastagem.update({ where: { id: cen.pasto.id }, data: { cultura_id: null } });
    await assert.rejects(() => prisma().cultura.delete({ where: { id: cen.marandu.id } }), /Foreign key|foreign key|violates/i);
    assert.equal((await req('DELETE', `/medicoes-forragem/${m.id}`, cen.token)).statusCode, 204);
    assert.equal(await prisma().medicaoForragem.count(), 0);
    assert.equal((await req('DELETE', `/medicoes-forragem/${m.id}`, cen.token)).statusCode, 404);
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: cen.clienteId, entidade: 'MedicaoForragem' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audit.map((a) => a.acao), ['create', 'delete']);
  });

  test('MF-08 permissão: listar só autenticado; criar e excluir exigem medir_forragem no mapa (gravadora: ausente = negado)', async () => {
    const cen = await cenario();
    const semChave = await contaCom(cen, verMapa());
    assert.equal((await req('GET', '/medicoes-forragem', semChave)).statusCode, 200);
    const negado = await req('POST', '/medicoes-forragem', semChave, olho(cen));
    assert.equal(negado.statusCode, 403, negado.body);
    assert.equal(negado.json().code, 'ACAO_NAO_PERMITIDA');
    const ausente = await contaCom(cen, { permissoes_telas: verMapa().permissoes_telas, mapa_geral_permissoes: { visualizar_areas: true } });
    assert.equal((await req('POST', '/medicoes-forragem', ausente, olho(cen))).statusCode, 403, 'chave ausente não libera');
    const comChave = await contaCom(cen, verMapa({ medir_forragem: true }));
    const ok = await req('POST', '/medicoes-forragem', comChave, olho(cen));
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(ok.json().registrado_por_nome, 'Gerente Op');
    assert.equal((await req('DELETE', `/medicoes-forragem/${ok.json().id}`, semChave)).statusCode, 403);
    assert.equal((await req('DELETE', `/medicoes-forragem/${ok.json().id}`, comChave)).statusCode, 204);
    assert.equal((await req('GET', '/medicoes-forragem')).statusCode, 401, 'sem sessão');
  });

  test('MF-09 o banco é a última barreira: CHECKs de método, situação, campos do método e valores', async () => {
    const cen = await cenario();
    const base = { cliente_id: cen.clienteId, empresa_id: cen.e1.id, area_id: cen.pasto.id, data_medicao: new Date('2027-06-15T00:00:00Z'), metodo: 'OLHO', situacao: 'PRONTO' };
    for (const ruim of [
      { metodo: 'LASER' },
      { situacao: 'OTIMO' },
      { situacao: null },
      { altura_media_cm: 20, qtd_leituras: 1 },
      { metodo: 'REGUA', situacao: null },
      { metodo: 'REGUA', altura_media_cm: 20, qtd_leituras: 0 },
      { metodo: 'REGUA', altura_media_cm: 20, qtd_leituras: 1, materia_seca_pct: 120 },
      { metodo: 'REGUA', altura_media_cm: 20, qtd_leituras: 1, quadro_m2: 0 },
    ]) {
      await assert.rejects(() => prisma().medicaoForragem.create({ data: { ...base, ...ruim } }), /check constraint|violates/i, JSON.stringify(ruim));
    }
    await assert.rejects(
      () => prisma().medicaoForragem.create({ data: { ...base, area_id: cen.pastoE2.id, cultura_id: cen.marandu.id, empresa_id: cen.e2.id } }),
      /Foreign key|foreign key/i,
      'cultura de outra fazenda não entra (FK pela fazenda)',
    );
  });

  test('MF-10 (D-PROD-223) descanso dos pastos pelo ledger: ocupado agora, dia da saída do último lote, pasto sem histórico fora da lista; partida cancelada não conta; empresa de outro tenant → 404', async () => {
    const { token, clienteId: c, e1, e2, pasto, semCultura, infra } = await cenario();
    const p = prisma();
    const dia = (d) => new Date(`${d}T00:00:00.000Z`);
    let n = 0;
    const lancar = async (area, movimentos) => {
      n += 1;
      const pos = await p.posicaoRebanho.create({ data: { cliente_id: c, empresa_id: e1.id, area_id: area.id, chave_identidade: `k${n}`, nome: `LOTE ${n}`, quantidade_cabecas: 0 } });
      for (const [d, delta, ativa = true] of movimentos) {
        n += 1;
        const ev = await p.eventoRebanho.create({ data: { cliente_id: c, empresa_id: e1.id, tipo: 'TRANSFERENCIA', data_operacional: dia(d), operation_id: `op${n}` } });
        await p.partidaRebanho.create({ data: { cliente_id: c, empresa_id: e1.id, evento_id: ev.id, posicao_id: pos.id, data_operacional: dia(d), delta, ativa } });
      }
    };
    // Pasto: dois lotes entram e saem; o último sai em 2027-05-20. Uma volta cancelada depois não conta.
    await lancar(pasto, [['2027-05-01', 10], ['2027-05-10', -10]]);
    await lancar(pasto, [['2027-05-05', 7], ['2027-05-20', -7], ['2027-06-01', 3, false]]);
    // Sem cultura: entrou e não saiu.
    await lancar(semCultura, [['2027-06-10', 5]]);
    const r = await req('GET', `/medicoes-forragem/descanso?empresa_id=${e1.id}`, token);
    assert.equal(r.statusCode, 200, r.body);
    const porArea = Object.fromEntries(r.json().map((x) => [x.area_id, x]));
    assert.deepEqual(porArea[pasto.id], { area_id: pasto.id, ocupada: false, ultima_saida: '2027-05-20' });
    assert.deepEqual(porArea[semCultura.id], { area_id: semCultura.id, ocupada: true, ultima_saida: null });
    assert.equal(porArea[infra.id], undefined, 'sem histórico no ledger: fora da lista');
    const outra = await req('GET', `/medicoes-forragem/descanso?empresa_id=${e2.id}`, token);
    assert.deepEqual(outra.json(), [], 'outra fazenda do mesmo tenant: só os pastos dela');
    const estranho = await criarTenant({ papelTenant: 'administrador' });
    const { corpo } = await autenticarNoApp(app, estranho.credenciais);
    const alheia = await req('GET', `/medicoes-forragem/descanso?empresa_id=${e1.id}`, corpo.token);
    assert.equal(alheia.statusCode, 404, 'fazenda de outro tenant');
    assert.equal((await req('GET', '/medicoes-forragem/descanso', token)).statusCode, 400, 'empresa_id obrigatório');
  });
});
