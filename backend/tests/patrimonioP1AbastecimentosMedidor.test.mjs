/**
 * D-PROD-159, revisto pela D-PROD-162 — Patrimônio P1-02: medidor operacional
 * e consumo (M1–M9, PostgreSQL real + HTTP autenticado).
 *
 *  - M1/M2: consumo pelo método do tanque cheio com os vetores `consumo` de
 *    `tests/smoke/fixtures/abastecimentoVetores.json` (L/h do horímetro do
 *    TP-02, km/L do odômetro da caminhonete) e "dados insuficientes"; CICLOS
 *    sem métrica; A6 com intervalos (métrica por intervalo) e metodologia;
 *  - M3: SEM_MEDIDOR (gerador com tanque) recusa leitura e grava sem leitura;
 *  - M4: série monotônica por data (D4): obrigatória, regressiva ao cadastro e
 *    a abastecimento, acima de ponto posterior (abastecimento ou cadastro),
 *    retroativo coerente, mesma data, data futura; só CONFIRMADOS contam;
 *  - M5: cancelar o último muda a leitura operacional (resposta, auditoria,
 *    `efeito_cancelamento_medidor`), sem tocar no `BemPatrimonial`;
 *  - M6: X2 — PATCH do bem respeita o piso operacional; sem abastecimento
 *    CONFIRMADO o medidor volta ao comportamento da P1-01 (B4);
 *  - M7: tanque cheio de OUTRO tanque não fecha intervalo; flex soma gasolina
 *    e etanol no mesmo tanque;
 *  - M8: o abastecimento não muda `BemPatrimonial.versao` (PATCH aberto antes grava);
 *  - M9 (D-PROD-162, P-03): Produto em KG → kg/h e km/kg (vetores `horimetro_kg`
 *    e `odometro_kg`); litros e quilos no mesmo intervalo → `unidades_misturadas`.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento, erro, fotoAbastecimento, montarAbastecimento, opId, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { corpoGerador, corpoTrator } from './patrimonioP1Cenario.mjs';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/abastecimentoVetores.json', import.meta.url), 'utf8'));
const vetor = (caso) => VETORES.consumo.find((c) => c.caso === caso);

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const bemCru = (id) => prisma().bemPatrimonial.findUnique({ where: { id } });
const ponto = (leitura, data, origem, abastecimento = null) => ({
  leitura, data, origem, abastecimento_id: abastecimento?.id ?? null, numero: abastecimento?.numero ?? null,
});
const consumoDe = async (s, d) => (await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id))).consumo;
const cancelarOk = (s, d, versao = 1) => A.ok(A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, versao, motivo: 'leitura lançada errada', operation_id: opId() }));
/** Corpo do abastecimento da caminhonete flex (odômetro) com o Produto aceito dado. */
const corpoCaminhonete = (s, qual, extra = {}) => {
  const prod = qual === 'ETANOL' ? s.etanol : s.gasolina;
  return corpoAbastecimento(s, { bem_id: s.caminhonete.id, tanque_id: s.caminhonete.tanques[0].id, produto_id: prod.id, ...extra });
};
const patchBem = (s, bemId, corpo) => A.req('PATCH', `/bens-patrimoniais/${bemId}`, s.token, { empresa_id: s.e1.id, ...corpo });

/**
 * Confirma a sequência do vetor e confere o consumo de cada abastecimento.
 * `produtoDa(unidade)` escolhe o Produto aceito na unidade do abastecimento (L ou KG).
 */
const aplicarVetor = async (s, caso, corpoDe, produtoDa = (u) => (u === 'KG' ? s.dieselKg : s.diesel)) => {
  const v = vetor(caso);
  const feitos = [];
  for (const a of v.abastecimentos) {
    feitos.push(await A.confirmarOk(s.operador.token, corpoDe({
      produto_id: produtoDa(a.unidade).id, data_operacional: a.data, medidor_leitura: a.leitura, quantidade: a.quantidade, tanque_cheio: a.tanque_cheio,
    })));
    assert.equal(feitos.at(-1).unidade, a.unidade, `${caso}: unidade do abastecimento #${a.ordem}`);
  }
  for (const esp of v.esperado) {
    const c = await consumoDe(s, feitos[esp.ordem - 1]);
    assert.deepEqual([c.situacao, c.motivo, c.valor], [esp.situacao, esp.motivo, esp.valor], `${caso} #${esp.ordem}`);
    if (esp.situacao === 'CALCULADO') {
      assert.deepEqual([c.metrica, c.unidade_metrica, c.intervalo, c.quantidade, c.unidade, c.abastecimento_inicial_id],
        [esp.metrica, esp.unidade_metrica, esp.intervalo, esp.quantidade, esp.unidade, feitos[0].id], `${caso} #${esp.ordem}`);
    } else if (esp.metrica !== undefined) {
      assert.deepEqual([c.metrica, c.unidade_metrica], [esp.metrica, esp.unidade_metrica], `${caso} #${esp.ordem}: sem métrica`);
    }
    assert.ok(c.metodologia.startsWith('Método do tanque cheio'), 'a resposta traz a metodologia');
  }
  return { v, feitos };
};

describe('P1-02 — consumo pelo método do tanque cheio', () => {
  test('M1: horímetro TP-02 (vetor horimetro_tp02) — leitura obrigatória, série crescente, 5,0000 L/h no 3º, dados insuficientes no 1º e no 2º; A6', async () => {
    const s = await montarAbastecimento(app);
    await s.lote(s.e1, s.diesel, s.local, { quantidade: '100.0000', custo: '5.8000', dia: '2027-06-04' });
    const antes = await fotoAbastecimento(s.c);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s, { medidor_leitura: null }))), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'obrigatoria']);
    const rp = await A.ok(A.previa(s.operador.token, { ...corpoAbastecimento(s, { medidor_leitura: null }), operation_id: undefined }));
    assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason]), [['MEDIDOR_LEITURA_INVALIDA', 'obrigatoria']]);
    assert.deepEqual(rp.plano.medidor.anterior, ponto('1520.5000', '2027-06-01', 'CADASTRO'), 'a tela mostra a leitura anterior antes de digitar');
    assert.equal(await fotoAbastecimento(s.c), antes);

    const { v, feitos } = await aplicarVetor(s, 'horimetro_tp02', (x) => corpoAbastecimento(s, x));
    assert.equal(v.cadastro.leitura, '1520.5000');
    const r = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.trator.id));
    assert.deepEqual([r.bem.id, r.bem.medidor_tipo, r.bem.medidor_unidade, r.situacao_geral], [s.trator.id, 'HORIMETRO', 'h', 'DISPONIVEL']);
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'metrica'), false, 'D-PROD-162: a métrica vem em cada intervalo (depende da unidade)');
    assert.ok(r.metodologia.includes('L/h ou kg/h = quantidade ÷ horas'));
    const [ultimo, primeiro] = r.intervalos;
    assert.equal(r.intervalos.length, 2, 'só os tanques cheios entram na janela');
    assert.deepEqual(ultimo, {
      abastecimento_id: feitos[2].id, numero: feitos[2].numero, tanque: { id: s.trator.tanques[0].id, identificador: 'Tanque principal' }, abastecimento_inicial_id: feitos[0].id,
      data_inicial: '2027-06-05', data_final: '2027-06-10', leitura_inicial: '1530.5000', leitura_final: '1550.5000', intervalo: '20.0000', quantidade: '100.0000', unidade: 'L',
      metrica: 'LITROS_POR_HORA', unidade_metrica: 'L/h', valor: '5.0000', situacao: 'CALCULADO', motivo: null,
    });
    assert.deepEqual([primeiro.abastecimento_id, primeiro.situacao, primeiro.motivo, primeiro.data_inicial, primeiro.leitura_inicial, primeiro.valor], [feitos[0].id, 'DADOS_INSUFICIENTES', 'sem_tanque_cheio_anterior', null, null, null]);
    assert.deepEqual((await A.ok(A.consumo(s.leitor.token, s.e1.id, s.trator.id, '&limit=1'))).intervalos.map((i) => i.abastecimento_id), [feitos[2].id]);

    // cancelar o 3º desfaz o intervalo; o 2º (não cheio) continua sem métrica
    await cancelarOk(s, feitos[2]);
    const depois = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.trator.id));
    assert.deepEqual(depois.intervalos.map((i) => [i.abastecimento_id, i.situacao]), [[feitos[0].id, 'DADOS_INSUFICIENTES']]);
    assert.deepEqual([(await consumoDe(s, feitos[2])).situacao, (await consumoDe(s, feitos[2])).motivo], ['NAO_APLICAVEL', 'cancelado']);
  });

  test('M2: odômetro da caminhonete (vetor odometro_caminhonete) — 8,7500 km/L; CICLOS → NAO_APLICAVEL; A6 com intervalos e metodologia; erros do A6', async () => {
    const s = await montarAbastecimento(app);
    const { feitos } = await aplicarVetor(s, 'odometro_caminhonete', (x) => corpoCaminhonete(s, 'GASOLINA', x), () => s.gasolina);
    const r = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.caminhonete.id));
    assert.equal(r.situacao_geral, 'DISPONIVEL');
    assert.ok(r.metodologia.includes('km/L ou km/kg = distância do odômetro ÷ quantidade'));
    assert.deepEqual(r.intervalos.map((i) => [i.abastecimento_id, i.situacao, i.intervalo, i.quantidade, i.unidade, i.metrica, i.unidade_metrica, i.valor]), [
      [feitos[1].id, 'CALCULADO', '350.0000', '40.0000', 'L', 'KM_POR_LITRO', 'km/L', '8.7500'],
      [feitos[0].id, 'DADOS_INSUFICIENTES', null, null, null, 'KM_POR_LITRO', 'km/L', null],
    ]);

    // bem com contador de CICLOS e tanque: sem métrica de consumo
    const ciclos = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoGerador(s, {
      nome: 'Bomba de irrigação', medidor: { tipo: 'CICLOS', leitura_inicial: '1000', data_leitura: '2027-06-01' },
      tanques: [{ identificador: 'Tanque da bomba', capacidade_litros: '50', produto_ids: [s.diesel.id] }],
    })), 201);
    const corpoCiclos = (extra) => corpoAbastecimento(s, { bem_id: ciclos.id, tanque_id: ciclos.tanques[0].id, quantidade: '10', ...extra });
    const c1 = await A.confirmarOk(s.operador.token, corpoCiclos({ data_operacional: '2027-06-05', medidor_leitura: '1010' }));
    const c2 = await A.confirmarOk(s.operador.token, corpoCiclos({ data_operacional: '2027-06-09', medidor_leitura: '1030' }));
    assert.deepEqual(c2.medidor, { tipo: 'CICLOS', unidade: 'ciclos', leitura: '1030.0000', origem: 'ABASTECIMENTO' });
    for (const d of [c1, c2]) {
      const c = await consumoDe(s, d);
      assert.deepEqual([c.situacao, c.motivo, c.metrica, c.valor], ['NAO_APLICAVEL', 'medidor_ciclos', null, null]);
    }
    const rc = await A.ok(A.consumo(s.leitor.token, s.e1.id, ciclos.id));
    assert.deepEqual([rc.situacao_geral, rc.intervalos], ['NAO_APLICAVEL', []]);
    // CICLOS ainda é contador: regressão recusada
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoCiclos({ data_operacional: '2027-06-12', medidor_leitura: '1020' }))), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);

    assert.deepEqual(erro(await A.consumo(s.leitor.token, s.e2.id, s.caminhonete.id)), [404, 'BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem_id', 'bem_inexistente']);
    assert.deepEqual(erro(await A.consumo(s.leitor.token, s.e1.id, s.caminhonete.id, `&tanque_id=${s.trator.tanques[0].id}`)), [422, 'ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inexistente']);
    assert.equal(erro(await A.consumo(s.leitor.token, s.e1.id, s.caminhonete.id, '&limit=51'))[0], 400);
  });

  test('M3: SEM_MEDIDOR (gerador com tanque) — leitura → 422 sem_medidor; sem leitura → 201 com medidor SEM_MEDIDOR e consumo NAO_APLICAVEL', async () => {
    const s = await montarAbastecimento(app);
    const corpo = (extra) => corpoAbastecimento(s, { bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, quantidade: '30', ...extra });
    const antes = await fotoAbastecimento(s.c);
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo({ medidor_leitura: '10' }))), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'sem_medidor']);
    assert.equal(await fotoAbastecimento(s.c), antes);
    const tq = await A.ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.gerador.id}`));
    assert.deepEqual([tq.bem.medidor, tq.bem.leitura_vigente], [{ tipo: 'SEM_MEDIDOR', unidade: null }, null]);
    const bemAntes = await bemCru(s.gerador.id);
    const d = await A.confirmarOk(s.operador.token, corpo({ medidor_leitura: null }));
    assert.deepEqual(d.medidor, { tipo: 'SEM_MEDIDOR', unidade: null, leitura: null, origem: null });
    assert.deepEqual([d.consumo.situacao, d.consumo.motivo, d.efeito_cancelamento_medidor], ['NAO_APLICAVEL', 'sem_medidor', null]);
    const linha = await prisma().abastecimentoBem.findUnique({ where: { id: d.id } });
    assert.deepEqual([linha.medidor_tipo, linha.medidor_unidade, linha.medidor_leitura, linha.medidor_origem], ['SEM_MEDIDOR', null, null, null]);
    const r = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.gerador.id));
    assert.deepEqual([r.situacao_geral, r.intervalos], ['NAO_APLICAVEL', []]);
    assert.equal(JSON.stringify(await bemCru(s.gerador.id)), JSON.stringify(bemAntes));
    assert.equal((await A.bem(s.token, s.e1.id, s.gerador.id)).medidor_operacional, null, 'sem leitura não há leitura operacional');
    // cancelar: sem leitura operacional antes nem depois
    const extra = await A.confirmarOk(s.operador.token, corpo({ medidor_leitura: null, quantidade: '5', tanque_cheio: false }));
    const k = await cancelarOk(s, extra);
    assert.deepEqual([k.leitura_operacional_antes, k.leitura_operacional_depois], [null, null]);

    // o gerador ganha um horímetro DEPOIS (SEM_MEDIDOR → contador é livre: sem leitura operacional não há piso).
    // O cheio sem medidor não fecha intervalo com o primeiro cheio medido (medidor_trocado); o seguinte calcula.
    const g = await A.bem(s.token, s.e1.id, s.gerador.id);
    await A.ok(patchBem(s, s.gerador.id, { versao: g.versao, medidor: { tipo: 'HORIMETRO', leitura_inicial: '100', data_leitura: '2027-06-11' } }));
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpo({ data_operacional: '2027-06-12', medidor_leitura: null }))), [422, 'MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'obrigatoria']);
    const h1 = await A.confirmarOk(s.operador.token, corpo({ data_operacional: '2027-06-12', medidor_leitura: '110', quantidade: '10' }));
    const h2 = await A.confirmarOk(s.operador.token, corpo({ data_operacional: '2027-06-14', medidor_leitura: '125', quantidade: '20' }));
    const c1 = await consumoDe(s, h1);
    assert.deepEqual([c1.situacao, c1.motivo, c1.abastecimento_inicial_id, c1.valor], ['DADOS_INSUFICIENTES', 'medidor_trocado', d.id, null]);
    const c2 = await consumoDe(s, h2);
    assert.deepEqual([c2.situacao, c2.abastecimento_inicial_id, c2.intervalo, c2.quantidade, c2.unidade, c2.valor], ['CALCULADO', h1.id, '15.0000', '20.0000', 'L', '1.3333'], '20 L ÷ 15 h, 4 casas HALF_UP');
    assert.deepEqual([(await consumoDe(s, d)).situacao, (await consumoDe(s, d)).motivo], ['NAO_APLICAVEL', 'sem_medidor'], 'o snapshot do histórico não muda');
    assert.deepEqual((await A.bem(s.token, s.e1.id, s.gerador.id)).medidor_operacional, { leitura: '125.0000', data: '2027-06-14', abastecimento_id: h2.id });
    const r2 = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.gerador.id));
    assert.deepEqual([r2.situacao_geral, r2.intervalos[0].metrica], ['DISPONIVEL', 'LITROS_POR_HORA']);
    assert.deepEqual(r2.intervalos.map((i) => [i.abastecimento_id, i.situacao, i.motivo, i.valor]), [
      [h2.id, 'CALCULADO', null, '1.3333'],
      [h1.id, 'DADOS_INSUFICIENTES', 'medidor_trocado', null],
      [d.id, 'DADOS_INSUFICIENTES', 'sem_medidor', null],
    ]);
  });
});

describe('P1-02 — série monotônica do medidor (D4)', () => {
  test('M4: regressão ao cadastro e a abastecimento; acima de ponto posterior; retroativo coerente; mesma data; data futura; só CONFIRMADOS contam', async () => {
    const s = await montarAbastecimento(app);
    const c = (extra) => corpoAbastecimento(s, { quantidade: '10', ...extra });
    const recusa = async (corpo, esperado) => {
      const antes = await fotoAbastecimento(s.c);
      const r = await A.confirmar(s.operador.token, corpo);
      assert.deepEqual(erro(r), esperado, r.body);
      assert.equal(await fotoAbastecimento(s.c), antes, 'nada gravado');
      return r.json().details;
    };
    const reg = await recusa(c({ medidor_leitura: '1500' }), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);
    assert.deepEqual([reg.leitura_referencia, reg.data_referencia, reg.origem_referencia, reg.abastecimento_id], ['1520.5000', '2027-06-01', 'CADASTRO', null]);
    const fut = await recusa(c({ data_operacional: '2027-06-16', medidor_leitura: '1600' }), [422, 'ABASTECIMENTO_DATA_FUTURA', 'data_operacional', 'data_futura']);
    assert.deepEqual([fut.hoje, fut.fuso], ['2027-06-15', 'America/Sao_Paulo']);
    await recusa(c({ data_operacional: '2027-02-30' }), [422, 'PATRIMONIO_DATA_INVALIDA', 'data_operacional', 'data_inexistente']);
    // antes do cadastro, acima da leitura do cadastro → acima de ponto POSTERIOR (o cadastro)
    const acimaCad = await recusa(c({ data_operacional: '2027-05-20', medidor_leitura: '1530' }), [422, 'MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior']);
    assert.deepEqual([acimaCad.leitura_posterior, acimaCad.data_posterior, acimaCad.origem_posterior], ['1520.5000', '2027-06-01', 'CADASTRO']);

    const hoje = await A.confirmarOk(s.operador.token, c({ data_operacional: '2027-06-15', medidor_leitura: '1580' }));
    const a1 = await A.confirmarOk(s.operador.token, c({ data_operacional: '2027-06-10', medidor_leitura: '1550.5' }));
    const regAb = await recusa(c({ data_operacional: '2027-06-12', medidor_leitura: '1540' }), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);
    assert.deepEqual([regAb.leitura_referencia, regAb.origem_referencia, regAb.abastecimento_id], ['1550.5000', 'ABASTECIMENTO', a1.id]);
    const acima = await recusa(c({ data_operacional: '2027-06-05', medidor_leitura: '1560' }), [422, 'MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior']);
    assert.deepEqual([acima.leitura_posterior, acima.data_posterior, acima.origem_posterior, acima.abastecimento_id], ['1550.5000', '2027-06-10', 'ABASTECIMENTO', a1.id]);
    await recusa(c({ data_operacional: '2027-06-12', medidor_leitura: '1590' }), [422, 'MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior']);

    // retroativo coerente (entre o cadastro e o abastecimento de 06-10): a prévia mostra os dois vizinhos
    const corpoRetro = c({ data_operacional: '2027-06-05', medidor_leitura: '1530' });
    const rp = await A.ok(A.previa(s.operador.token, { ...corpoRetro, operation_id: undefined }));
    assert.deepEqual([rp.bloqueios, rp.plano.medidor.anterior, rp.plano.medidor.posterior], [[], ponto('1520.5000', '2027-06-01', 'CADASTRO'), ponto('1550.5000', '2027-06-10', 'ABASTECIMENTO', a1)]);
    await A.confirmarOk(s.operador.token, corpoRetro);
    await A.confirmarOk(s.operador.token, c({ data_operacional: '2027-05-20', medidor_leitura: '1500' })); // antes do cadastro, abaixo dele
    await A.confirmarOk(s.operador.token, c({ data_operacional: '2027-06-10', medidor_leitura: '1550.5' })); // mesma data e mesma leitura
    const vigente = await A.ok(A.opcoes(s.operador.token, 'tanques', `empresa_id=${s.e1.id}&bem_id=${s.trator.id}`));
    assert.deepEqual(vigente.bem.leitura_vigente, ponto('1580.0000', '2027-06-15', 'ABASTECIMENTO', hoje));

    // só CONFIRMADOS: cancelado o de hoje, 1570 em 06-14 passa a ser coerente
    await recusa(c({ data_operacional: '2027-06-14', medidor_leitura: '1590' }), [422, 'MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior']);
    await cancelarOk(s, hoje);
    await A.confirmarOk(s.operador.token, c({ data_operacional: '2027-06-14', medidor_leitura: '1590' }));
  });

  test('M5: cancelar o último — leitura_operacional_antes/depois na resposta e na auditoria; efeito_cancelamento_medidor no detalhe; BemPatrimonial intocado', async () => {
    const s = await montarAbastecimento(app);
    const bemAntes = await bemCru(s.trator.id);
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '20', data_operacional: '2027-06-05', medidor_leitura: '1530.5' }));
    const a2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '20', data_operacional: '2027-06-10', medidor_leitura: '1550.5' }));
    const p1 = ponto('1530.5000', '2027-06-05', 'ABASTECIMENTO', a1);
    const p2 = ponto('1550.5000', '2027-06-10', 'ABASTECIMENTO', a2);
    const cad = ponto('1520.5000', '2027-06-01', 'CADASTRO');
    const efeito = async (d) => (await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id))).efeito_cancelamento_medidor;
    assert.deepEqual(await efeito(a1), { muda: false, leitura_operacional_antes: p2, leitura_operacional_depois: p2 }, 'cancelar um do meio não muda a leitura vigente');
    assert.deepEqual(await efeito(a2), { muda: true, leitura_operacional_antes: p2, leitura_operacional_depois: p1 });

    const k2 = await cancelarOk(s, a2);
    assert.deepEqual([k2.leitura_operacional_antes, k2.leitura_operacional_depois, k2.efeito_cancelamento_medidor], [p2, p1, null]);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, acao: 'abastecimento_bem.cancelar', entidade_id: a2.id } });
    assert.deepEqual([audit.dados_novos.leitura_operacional_antes, audit.dados_novos.leitura_operacional_depois], [p2, p1]);
    assert.deepEqual([audit.dados_anteriores.status, audit.dados_novos.status, audit.dados_novos.versao], ['CONFIRMADO', 'CANCELADO', 2]);
    assert.deepEqual((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, { leitura: '1530.5000', data: '2027-06-05', abastecimento_id: a1.id });
    assert.deepEqual(await efeito(a1), { muda: true, leitura_operacional_antes: p1, leitura_operacional_depois: cad });

    const k1 = await cancelarOk(s, a1);
    assert.deepEqual([k1.leitura_operacional_antes, k1.leitura_operacional_depois], [p1, cad]);
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).medidor_operacional, null);
    assert.equal(JSON.stringify(await bemCru(s.trator.id)), JSON.stringify(bemAntes), 'nem o abastecimento nem o cancelamento gravam o bem');
  });

  test('M6: X2 — com abastecimento CONFIRMADO com leitura o PATCH do bem respeita o piso; tipo e leitura inicial imutáveis; sem abastecimento confirmado = B4', async () => {
    const s = await montarAbastecimento(app);
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const bem = await A.bem(s.token, s.e1.id, s.trator.id);
    assert.deepEqual(bem.medidor_operacional, { leitura: '1550.5000', data: '2027-06-10', abastecimento_id: a1.id });
    const v = bem.versao;
    const antes = JSON.stringify(await bemCru(s.trator.id));
    const recusa = async (medidor, esperado) => {
      const r = await patchBem(s, s.trator.id, { versao: v, medidor, nome: 'nome que não pode gravar' });
      assert.deepEqual(erro(r), esperado, r.body);
      assert.equal(JSON.stringify(await bemCru(s.trator.id)), antes, 'nada gravado (nem o nome)');
      return r.json().details;
    };
    const abaixo = await recusa({ tipo: 'HORIMETRO', leitura_atual: '1540', data_leitura: '2027-06-14' }, [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor.leitura_atual', 'leitura_regressiva']);
    assert.deepEqual([abaixo.leitura_atual, abaixo.origem_referencia, abaixo.abastecimento_id], ['1550.5000', 'ABASTECIMENTO', a1.id]);
    const antesData = await recusa({ tipo: 'HORIMETRO', leitura_atual: '1560', data_leitura: '2027-06-09' }, [422, 'MEDIDOR_DATA_REGRESSIVA', 'medidor.data_leitura', 'data_regressiva']);
    assert.deepEqual([antesData.data_leitura, antesData.origem_referencia], ['2027-06-10', 'ABASTECIMENTO']);
    await recusa({ tipo: 'ODOMETRO', leitura_inicial: '100', data_leitura: '2027-06-01' }, [409, 'MEDIDOR_TIPO_IMUTAVEL', 'medidor.tipo', 'medidor_com_abastecimento']);
    await recusa({ tipo: 'SEM_MEDIDOR' }, [409, 'MEDIDOR_TIPO_IMUTAVEL', 'medidor.tipo', 'medidor_com_abastecimento']);
    await recusa({ tipo: 'HORIMETRO', leitura_inicial: '1500' }, [409, 'MEDIDOR_LEITURA_INICIAL_IMUTAVEL', 'medidor.leitura_inicial', 'medidor_com_abastecimento']);
    await recusa({ tipo: 'HORIMETRO', data_leitura: '2027-05-01' }, [422, 'MEDIDOR_DATA_REGRESSIVA', 'medidor.data_leitura', 'data_regressiva']);

    const ajuste = await A.ok(patchBem(s, s.trator.id, { versao: v, medidor: { tipo: 'HORIMETRO', leitura_atual: '1560', data_leitura: '2027-06-12' } }));
    assert.deepEqual([ajuste.versao, ajuste.medidor.leitura_atual, ajuste.medidor.data_leitura, ajuste.medidor.origem], [v + 1, '1560.0000', '2027-06-12', 'AJUSTE_CADASTRO']);
    assert.deepEqual(ajuste.medidor_operacional, { leitura: '1550.5000', data: '2027-06-10', abastecimento_id: a1.id });
    // o ajuste vira ponto da série: abaixo dele depois de 06-12 é regressão (origem CADASTRO); entre 06-10 e 06-12, coerente
    const reg = await A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-13', medidor_leitura: '1555' }));
    assert.deepEqual(erro(reg), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva']);
    assert.deepEqual([reg.json().details.origem_referencia, reg.json().details.leitura_referencia], ['CADASTRO', '1560.0000']);
    await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '10', data_operacional: '2027-06-11', medidor_leitura: '1555' }));

    // sem abastecimento CONFIRMADO com leitura: comportamento da P1-01 (correção de cadastro do tipo)
    const g = await A.confirmarOk(s.operador.token, corpoCaminhonete(s, 'GASOLINA', { quantidade: '20', medidor_leitura: '35300' }));
    const cam = await A.bem(s.token, s.e1.id, s.caminhonete.id);
    const troca = { tipo: 'HORIMETRO', leitura_inicial: '10', data_leitura: '2027-06-01' };
    assert.deepEqual(erro(await patchBem(s, s.caminhonete.id, { versao: cam.versao, medidor: troca })), [409, 'MEDIDOR_TIPO_IMUTAVEL', 'medidor.tipo', 'medidor_com_abastecimento']);
    await cancelarOk(s, g);
    const camDepois = await A.bem(s.token, s.e1.id, s.caminhonete.id);
    assert.equal(camDepois.medidor_operacional, null);
    const corrigido = await A.ok(patchBem(s, s.caminhonete.id, { versao: camDepois.versao, medidor: troca }));
    assert.deepEqual([corrigido.medidor.tipo, corrigido.medidor.leitura_inicial, corrigido.medidor.origem], ['HORIMETRO', '10.0000', 'CADASTRO_INICIAL']);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade_id: s.caminhonete.id, acao: 'bem_patrimonial.corrigir_medidor' } }), 1);
  });
});

describe('P1-02 — tanques e versão do bem', () => {
  test('M7: tanque cheio de OUTRO tanque não fecha intervalo; A6 por tanque; flex soma gasolina + etanol no mesmo tanque', async () => {
    const s = await montarAbastecimento(app);
    await s.lote(s.e1, s.diesel, s.local, { quantidade: '100.0000', custo: '5.8000', dia: '2027-06-04' });
    const dois = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      nome: 'Trator TP-05', codigo_frota: 'TP-05', medidor: { tipo: 'HORIMETRO', leitura_inicial: '1500', data_leitura: '2027-06-01' },
      tanques: [
        { identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [s.diesel.id] },
        { identificador: 'Tanque auxiliar', capacidade_litros: '60', produto_ids: [s.diesel.id] },
      ],
    })), 201);
    const tanque = (identificador) => dois.tanques.find((t) => t.identificador === identificador);
    const [principal, auxiliar] = [tanque('Tanque principal'), tanque('Tanque auxiliar')];
    const corpo = (t, data, leitura, litros) => corpoAbastecimento(s, { bem_id: dois.id, tanque_id: t.id, data_operacional: data, medidor_leitura: leitura, quantidade: litros });
    const p1 = await A.confirmarOk(s.operador.token, corpo(principal, '2027-06-02', '1510', '50'));
    const x1 = await A.confirmarOk(s.operador.token, corpo(auxiliar, '2027-06-05', '1520', '40'));
    const p2 = await A.confirmarOk(s.operador.token, corpo(principal, '2027-06-08', '1530', '50'));
    assert.deepEqual([(await consumoDe(s, x1)).situacao, (await consumoDe(s, x1)).motivo], ['DADOS_INSUFICIENTES', 'sem_tanque_cheio_anterior'], 'o cheio do principal não fecha o auxiliar');
    const cp2 = await consumoDe(s, p2);
    assert.deepEqual([cp2.situacao, cp2.abastecimento_inicial_id, cp2.intervalo, cp2.quantidade, cp2.valor], ['CALCULADO', p1.id, '20.0000', '50.0000', '2.5000'], 'os 40 L do auxiliar não entram no principal');
    const soAux = await A.ok(A.consumo(s.leitor.token, s.e1.id, dois.id, `&tanque_id=${auxiliar.id}`));
    assert.deepEqual(soAux.intervalos.map((i) => [i.abastecimento_id, i.tanque.identificador]), [[x1.id, 'Tanque auxiliar']]);
    const todos = await A.ok(A.consumo(s.leitor.token, s.e1.id, dois.id));
    assert.deepEqual(todos.intervalos.map((i) => i.abastecimento_id), [p2.id, x1.id, p1.id]);

    // flex: um tanque, gasolina (cheio) → etanol (parcial) → gasolina (cheio): 350 km ÷ (20 + 30) L
    const g1 = await A.confirmarOk(s.operador.token, corpoCaminhonete(s, 'GASOLINA', { data_operacional: '2027-06-02', medidor_leitura: '35300', quantidade: '50' }));
    const e1 = await A.confirmarOk(s.operador.token, corpoCaminhonete(s, 'ETANOL', { data_operacional: '2027-06-04', medidor_leitura: '35450', quantidade: '20', tanque_cheio: false }));
    const g2 = await A.confirmarOk(s.operador.token, corpoCaminhonete(s, 'GASOLINA', { data_operacional: '2027-06-06', medidor_leitura: '35650', quantidade: '30' }));
    const cg2 = await consumoDe(s, g2);
    assert.deepEqual([cg2.situacao, cg2.abastecimento_inicial_id, cg2.intervalo, cg2.quantidade, cg2.valor], ['CALCULADO', g1.id, '350.0000', '50.0000', '7.0000']);
    assert.deepEqual([(await consumoDe(s, e1)).motivo], ['nao_e_tanque_cheio']);
    // um etanol cheio fecha o intervalo do mesmo tanque, qualquer que seja o Produto (ambos em L)
    const e2 = await A.confirmarOk(s.operador.token, corpoCaminhonete(s, 'ETANOL', { data_operacional: '2027-06-09', medidor_leitura: '35950', quantidade: '45' }));
    const ce2 = await consumoDe(s, e2);
    assert.deepEqual([ce2.abastecimento_inicial_id, ce2.intervalo, ce2.quantidade, ce2.valor], [g2.id, '300.0000', '45.0000', '6.6667'], '300 km ÷ 45 L, 4 casas HALF_UP');
    // um cheio RETROATIVO entre g1 e g2 redistribui os intervalos (a janela é por data e leitura, não por ordem de gravação)
    const r1 = await A.confirmarOk(s.operador.token, corpoCaminhonete(s, 'GASOLINA', { data_operacional: '2027-06-05', medidor_leitura: '35500', quantidade: '10' }));
    const cr1 = await consumoDe(s, r1);
    assert.deepEqual([cr1.abastecimento_inicial_id, cr1.intervalo, cr1.quantidade, cr1.valor], [g1.id, '200.0000', '30.0000', '6.6667'], 'g1 → r1: 20 L de etanol + 10 L de gasolina');
    const cg2b = await consumoDe(s, g2);
    assert.deepEqual([cg2b.abastecimento_inicial_id, cg2b.intervalo, cg2b.quantidade, cg2b.valor], [r1.id, '150.0000', '30.0000', '5.0000']);
  });

  test('M8: o abastecimento não muda BemPatrimonial.versao — o PATCH do bem aberto antes grava sem 409', async () => {
    const s = await montarAbastecimento(app);
    const aberto = await A.bem(s.token, s.e1.id, s.trator.id);
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    await cancelarOk(s, await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '5', medidor_leitura: '1551' })));
    assert.equal((await bemCru(s.trator.id)).versao, aberto.versao, 'confirmar e cancelar não sobem a versão do bem');
    const salvo = await A.ok(patchBem(s, s.trator.id, { versao: aberto.versao, nome: 'Trator TP-02 revisado' }));
    assert.deepEqual([salvo.versao, salvo.nome, salvo.medidor.leitura_atual], [aberto.versao + 1, 'Trator TP-02 revisado', '1520.5000']);
    assert.deepEqual(salvo.medidor_operacional, { leitura: '1550.5000', data: '2027-06-10', abastecimento_id: d.id });
    assert.equal((await A.ok(A.detalhe(s.leitor.token, d.id, s.e1.id))).bem.nome, 'Trator TP-02 revisado');
  });
});

describe('D-PROD-162 — consumo na unidade do Produto (P-03)', () => {
  test('M9: Produto em KG → kg/h (horimetro_kg) e km/kg (odometro_kg); L e KG no mesmo intervalo → unidades_misturadas sem métrica', async () => {
    const s = await montarAbastecimento(app);
    await s.lote(s.e1, s.diesel, s.local, { quantidade: '100.0000', custo: '5.8000', dia: '2027-06-04' });
    // kg/h no trator (o tanque aceita o diesel em kg)
    await aplicarVetor(s, 'horimetro_kg', (x) => corpoAbastecimento(s, x));
    const rh = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.trator.id));
    assert.deepEqual(rh.intervalos.map((i) => [i.situacao, i.quantidade, i.unidade, i.metrica, i.unidade_metrica, i.valor]), [
      ['CALCULADO', '60.0000', 'KG', 'KG_POR_HORA', 'kg/h', '3.0000'],
      ['DADOS_INSUFICIENTES', null, null, 'KG_POR_HORA', 'kg/h', null],
    ]);
    // km/kg na caminhonete (o Produto em kg passa a ser aceito no tanque dela)
    await A.ok(s.patchAceites(s.caminhonete, [[s.gasolina.id, s.etanol.id, s.dieselKg.id]]));
    await aplicarVetor(s, 'odometro_kg', (x) => corpoCaminhonete(s, 'GASOLINA', x));
    const ro = await A.ok(A.consumo(s.leitor.token, s.e1.id, s.caminhonete.id));
    assert.deepEqual(ro.intervalos[0].metrica, 'KM_POR_KG');
    // L e KG misturados entre dois cheios: não soma litro com quilo
    const outro = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, {
      nome: 'Trator TP-07', codigo_frota: 'TP-07', tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [s.diesel.id, s.dieselKg.id] }],
    })), 201);
    const { feitos } = await aplicarVetor(s, 'unidades_misturadas', (x) => corpoAbastecimento(s, { bem_id: outro.id, tanque_id: outro.tanques[0].id, ...x }));
    const rm = await A.ok(A.consumo(s.leitor.token, s.e1.id, outro.id));
    assert.deepEqual(rm.intervalos.map((i) => [i.abastecimento_id, i.situacao, i.motivo, i.metrica, i.quantidade, i.valor]), [
      [feitos[2].id, 'DADOS_INSUFICIENTES', 'unidades_misturadas', null, null, null],
      [feitos[0].id, 'DADOS_INSUFICIENTES', 'sem_tanque_cheio_anterior', 'LITROS_POR_HORA', null, null],
    ]);
    const cm = await consumoDe(s, feitos[1]);
    assert.deepEqual([cm.motivo, cm.metrica, cm.unidade_metrica], ['nao_e_tanque_cheio', 'KG_POR_HORA', 'kg/h'], 'o parcial em kg tem a métrica da própria unidade');
  });
});
