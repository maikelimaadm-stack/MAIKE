/**
 * D-PROD-324 (MAIKE-DIARIO-GPS, fase 1) — o trajeto da máquina no Diário.
 *
 *  - regras puras, sem banco: haversine, distância da linha (salto > 60 km/h fora), amostragem da linha (≤ 500),
 *    validação do lote (1..200, coordenadas, horário, seq repetido dentro do lote);
 *  - integração com PostgreSQL (DATABASE_URL, migrations aplicadas): abrir (201 e replay 200, 409 de payload diferente),
 *    uma máquina aberta por atividade, lote com reenvio e seq repetido (não duplica), encerrar (distância, replay,
 *    trajeto encerrado recusa ponto), GET do dia (linha ≤ 500), tenant isolado, validação do corpo.
 *
 * Rodar em série com os outros testes de banco (`--test-concurrency=1`): cada teste limpa o banco.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  amostrarLinha,
  distanciaDaLinhaM,
  haversineM,
  LINHA_MAXIMA,
  LOTE_MAXIMO,
  pontoTemCoordenadaValida,
  validarLotePontos,
} from '../src/modules/atividades/atividadeTrajetoService.js';
import { autenticarNoApp, criarApp, criarTenant, encerrar, limparBanco } from './helpers.mjs';
import { corpoImplemento, corpoTrator, erro, http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';

const DIA = '2027-06-15';
const OUTRO_DIA = '2027-06-16';
const T0 = Date.parse('2027-06-15T10:00:00.000Z');

/** Ponto do aparelho: seq, lat, lng e o instante (ms) em ISO. */
const ponto = (seq, lat, lng, t) => ({ seq, lat, lng, precisao_m: 5, velocidade_ms: 2.5, capturado_em: new Date(t).toISOString() });

/** Caminhada em linha reta para o norte: cada ponto ~55,6 m ao sul/norte do anterior, a cada 10 s. */
const linhaReta = (de, quantos) =>
  Array.from({ length: quantos }, (_, i) => ponto(de + i, -20 + (de + i) * 0.0005, -54, T0 + (de + i - 1) * 10000));

/** Soma dos trechos consecutivos pelo haversine (referência independente do serviço). */
const somaReferencia = (pontos) => {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) total += haversineM(pontos[i - 1], pontos[i]);
  return total;
};

describe('D-PROD-324 — regras puras do trajeto (sem banco)', () => {
  test('GPS-P1: haversine — 0,001° de latitude ≈ 111,2 m; mesmo ponto = 0', () => {
    assert.ok(Math.abs(haversineM({ lat: -20, lng: -54 }, { lat: -20.001, lng: -54 }) - 111.19) < 0.5);
    assert.equal(haversineM({ lat: -20, lng: -54 }, { lat: -20, lng: -54 }), 0);
  });

  test('GPS-P2: a distância ignora o salto impossível (> 60 km/h) e o trecho sem tempo positivo', () => {
    const pontos = [
      { lat: -20, lng: -54, t: T0 },
      { lat: -20.0009, lng: -54, t: T0 + 10000 }, // ~100 m em 10 s (36 km/h): conta
      { lat: -21, lng: -54, t: T0 + 20000 }, // ~111 km em 10 s: salto de GPS, não conta
      { lat: -21.0009, lng: -54, t: T0 + 30000 }, // ~100 m em 10 s: conta
      { lat: -21.0009, lng: -54, t: T0 + 30000 }, // mesmo instante: não conta
    ];
    assert.ok(Math.abs(distanciaDaLinhaM(pontos) - 200.16) < 0.5, String(distanciaDaLinhaM(pontos)));
    assert.equal(distanciaDaLinhaM([]), 0);
    assert.equal(distanciaDaLinhaM([{ lat: 0, lng: 0, t: T0 }]), 0);
  });

  test('GPS-P3: amostragem — linha longa vira no máximo 500 pontos, com o primeiro e o último; linha curta fica igual', () => {
    const longa = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const amostra = amostrarLinha(longa);
    assert.equal(amostra.length, LINHA_MAXIMA);
    assert.equal(amostra[0], longa[0]);
    assert.equal(amostra.at(-1), longa[999]);
    assert.ok(amostra.every((p, k) => k === 0 || p.i > amostra[k - 1].i), 'em ordem, sem repetir');
    const curta = longa.slice(0, 300);
    assert.equal(amostrarLinha(curta), curta);
  });

  test('GPS-P4: coordenada — faixa do globo e nada de NaN', () => {
    assert.equal(pontoTemCoordenadaValida({ lat: -90, lng: 180 }), true);
    assert.equal(pontoTemCoordenadaValida({ lat: 90.0001, lng: 0 }), false);
    assert.equal(pontoTemCoordenadaValida({ lat: 0, lng: -180.5 }), false);
    assert.equal(pontoTemCoordenadaValida({ lat: Number.NaN, lng: 0 }), false);
    assert.equal(pontoTemCoordenadaValida({ lat: '1', lng: 0 }), false);
  });

  test('GPS-P5: lote — 1..200; coordenada, horário e seq conferidos; seq repetido dentro do lote fica com o primeiro', () => {
    const ok = validarLotePontos([ponto(1, -20, -54, T0), ponto(2, -20.0001, -54, T0 + 10000)]);
    assert.equal(ok.length, 2);
    assert.ok(ok[0].capturado_em instanceof Date);

    const dup = validarLotePontos([ponto(5, -20, -54, T0), ponto(5, -21, -55, T0 + 10000)]);
    assert.equal(dup.length, 1);
    assert.equal(dup[0].lat, -20, 'fica o primeiro');

    const erroDe = (fn) => {
      try {
        fn();
      } catch (e) {
        return e;
      }
      assert.fail('esperava recusa');
    };
    const e1 = erroDe(() => validarLotePontos([ponto(1, -20, -54, T0), ponto(2, 91, -54, T0)]));
    assert.deepEqual([e1.code, e1.details.index, e1.details.field], ['TRAJETO_PONTOS_INVALIDOS', 1, 'coordenada']);
    const e2 = erroDe(() => validarLotePontos([{ ...ponto(1, -20, -54, T0), capturado_em: 'ontem' }]));
    assert.deepEqual([e2.code, e2.details.field], ['TRAJETO_PONTOS_INVALIDOS', 'capturado_em']);
    const e3 = erroDe(() => validarLotePontos([ponto(-1, -20, -54, T0)]));
    assert.deepEqual([e3.code, e3.details.field], ['TRAJETO_PONTOS_INVALIDOS', 'seq']);
    const e4 = erroDe(() => validarLotePontos(Array.from({ length: LOTE_MAXIMO + 1 }, (_, i) => ponto(i, -20, -54, T0))));
    assert.deepEqual([e4.code, e4.details.field], ['TRAJETO_PONTOS_INVALIDOS', 'pontos']);
    assert.equal(erroDe(() => validarLotePontos([])).code, 'TRAJETO_PONTOS_INVALIDOS');
  });
});

describe('D-PROD-324 — integração com PostgreSQL: trajeto da máquina', () => {
  let app;
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

  /** Tenant com fazenda, área, um trator (máquina), um implemento e uma atividade ABERTA (Pulverização). */
  const montar = async () => {
    const s = await montarAbastecimento(app, { lotes: false });
    const p = prisma();
    const suf = randomUUID().slice(0, 6);
    const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO GPS ${suf}` } });
    const tipo = await p.tipoAtividade.create({
      data: { cliente_id: s.c, nome_tipo: `ROÇADA GPS ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: false },
    });
    const trator = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: `TR-${suf}`, nome: `Trator ${suf}` })), 201);
    const implemento = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { numero_serie: `IMP-${suf}` })), 201);
    const atividade = await H.ok(H.req('POST', '/atividades', s.token, {
      empresa_id: s.e1.id, nome: 'Roçada GPS', tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
      areas: [{ area_id: s.area1.id }],
    }), 201);
    const base = `/atividades/${atividade.id}`;
    const abrir = (corpo = {}, op = opId(), token = s.token) =>
      H.req('POST', `${base}/trajetos`, token, { empresa_id: s.e1.id, bem_id: trator.id, data_operacional: DIA, operation_id: op, ...corpo });
    const abrirOk = async (corpo = {}) => (await H.ok(abrir(corpo), 201)).trajeto;
    const enviar = (trajetoId, pontos, token = s.token, empresaId = s.e1.id) =>
      H.req('POST', `${base}/trajetos/${trajetoId}/pontos`, token, { empresa_id: empresaId, pontos });
    const encerrarTr = (trajetoId, token = s.token) => H.req('POST', `${base}/trajetos/${trajetoId}/encerrar`, token, { empresa_id: s.e1.id });
    const listar = (dia = DIA, token = s.token) => H.req('GET', `${base}/trajetos?empresa_id=${s.e1.id}&dia=${dia}`, token);
    const contaPontos = (trajetoId) => prisma().atividadeTrajetoPonto.count({ where: { cliente_id: s.c, trajeto_id: trajetoId } });
    return { ...s, trator, implemento, atividade, abrir, abrirOk, enviar, encerrarTr, listar, contaPontos };
  };

  test('GPS-01: abrir 201 ABERTO; mesma operation_id → 200 replay, sem trajeto novo; payload diferente → 409 IDEMPOTENCY_CONFLICT', async () => {
    const s = await montar();
    const op = opId();
    const r1 = await s.abrir({}, op);
    assert.equal(r1.statusCode, 201, r1.body);
    const t = r1.json().trajeto;
    assert.deepEqual([t.status, t.pontos_total, t.distancia_m, t.data_operacional, t.bem_id, t.encerrado_em], ['ABERTO', 0, null, DIA, s.trator.id, null]);

    const re = await s.abrir({}, op);
    assert.equal(re.statusCode, 200, re.body);
    assert.equal(re.json().replay, true);
    assert.equal(re.json().trajeto.id, t.id);

    const dif = await s.abrir({ data_operacional: OUTRO_DIA }, op);
    assert.deepEqual(erro(dif).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT'], dif.body);
    assert.equal(await prisma().atividadeTrajeto.count({ where: { cliente_id: s.c } }), 1);
  });

  test('GPS-02: uma máquina só tem um trajeto aberto na atividade (409 TRAJETO_ABERTO com o id do aberto); máquina que não é máquina → 422', async () => {
    const s = await montar();
    const aberto = await s.abrirOk();
    const r = await s.abrir();
    assert.deepEqual(erro(r).slice(0, 2), [409, 'TRAJETO_ABERTO'], r.body);
    assert.equal(r.json().details.trajeto_id, aberto.id);

    const impl = await s.abrir({ bem_id: s.implemento.id });
    assert.deepEqual(erro(impl).slice(0, 4), [422, 'TRAJETO_INVALIDO', 'bem_id', 'nao_maquina'], impl.body);
    assert.equal(await prisma().atividadeTrajeto.count({ where: { cliente_id: s.c } }), 1, 'nada gravado na recusa');
  });

  test('GPS-03: lote — novos e reenvio: o seq repetido não duplica (ON CONFLICT DO NOTHING); repetido dentro do lote conta uma vez', async () => {
    const s = await montar();
    const t = await s.abrirOk();
    const r1 = await s.enviar(t.id, [ponto(1, -20, -54, T0), ponto(2, -20.0005, -54, T0 + 10000), ponto(3, -20.001, -54, T0 + 20000)]);
    assert.equal(r1.statusCode, 200, r1.body);
    assert.deepEqual(r1.json(), { recebidos: 3, novos: 3 });

    const r2 = await s.enviar(t.id, [ponto(2, -20.0005, -54, T0 + 10000), ponto(3, -20.001, -54, T0 + 20000), ponto(4, -20.0015, -54, T0 + 30000)]);
    assert.deepEqual(r2.json(), { recebidos: 3, novos: 1 });
    assert.equal(await s.contaPontos(t.id), 4);

    const r3 = await s.enviar(t.id, [ponto(5, -20.002, -54, T0 + 40000), ponto(5, -20.0025, -54, T0 + 40000)]);
    assert.deepEqual(r3.json(), { recebidos: 2, novos: 1 });
    assert.equal(await s.contaPontos(t.id), 5);
    const linhaBanco = await prisma().atividadeTrajeto.findFirst({ where: { cliente_id: s.c, id: t.id } });
    assert.equal(linhaBanco.pontos_total, 5, 'pontos_total acompanha os novos');
  });

  test('GPS-04: encerrar grava a distância (soma dos trechos) e o encerrado_em; replay 200 sem regravar; encerrado recusa ponto (409) e nada entra', async () => {
    const s = await montar();
    const t = await s.abrirOk();
    const pontos = linhaReta(1, 10);
    assert.equal((await s.enviar(t.id, pontos)).statusCode, 200);

    const e1 = await s.encerrarTr(t.id);
    assert.equal(e1.statusCode, 200, e1.body);
    const body = e1.json();
    assert.equal(body.replay, false);
    assert.equal(body.trajeto.status, 'ENCERRADO');
    assert.ok(body.trajeto.encerrado_em, 'encerrado_em preenchido');
    assert.ok(Math.abs(body.trajeto.distancia_m - Math.round(somaReferencia(pontos) * 100) / 100) < 0.01, String(body.trajeto.distancia_m));
    assert.equal(body.trajeto.pontos_total, 10);

    const e2 = await s.encerrarTr(t.id);
    assert.equal(e2.statusCode, 200);
    assert.equal(e2.json().replay, true);
    assert.equal(e2.json().trajeto.distancia_m, body.trajeto.distancia_m);

    const antes = await s.contaPontos(t.id);
    const tarde = await s.enviar(t.id, linhaReta(11, 2));
    assert.deepEqual(erro(tarde).slice(0, 2), [409, 'TRAJETO_STATUS_INVALIDO'], tarde.body);
    assert.equal(await s.contaPontos(t.id), antes, 'nenhum ponto entrou');
  });

  test('GPS-05: GET do dia — trajeto com distância e linha de no máximo 500 pontos (primeiro e último); outro dia vem vazio', async () => {
    const s = await montar();
    const t = await s.abrirOk();
    const todos = linhaReta(1, 600);
    for (let i = 0; i < todos.length; i += LOTE_MAXIMO) {
      assert.equal((await s.enviar(t.id, todos.slice(i, i + LOTE_MAXIMO))).statusCode, 200);
    }

    const r = await s.listar();
    assert.equal(r.statusCode, 200, r.body);
    const [item] = r.json().trajetos;
    assert.equal(r.json().trajetos.length, 1);
    assert.equal(item.id, t.id);
    assert.equal(item.status, 'ABERTO');
    assert.ok(Math.abs(item.distancia_m - Math.round(somaReferencia(todos) * 100) / 100) < 0.01, 'distância calculada na hora (trajeto aberto)');
    assert.equal(item.linha.length, LINHA_MAXIMA);
    assert.deepEqual(item.linha[0], { lat: todos[0].lat, lng: todos[0].lng });
    assert.deepEqual(item.linha.at(-1), { lat: todos.at(-1).lat, lng: todos.at(-1).lng });

    const outro = await s.listar(OUTRO_DIA);
    assert.deepEqual(outro.json().trajetos, []);
    const semDia = await H.req('GET', `/atividades/${s.atividade.id}/trajetos?empresa_id=${s.e1.id}`, s.token);
    assert.equal(semDia.statusCode, 400, 'dia é obrigatório');
  });

  test('GPS-06: tenant isolado — outro tenant não abre, não envia pontos e não lê o trajeto (nada gravado)', async () => {
    const s = await montar();
    const t = await s.abrirOk();
    const outro = await criarTenant({ papelTenant: 'administrador' });
    const tokenOutro = (await autenticarNoApp(app, outro.credenciais)).corpo.token;

    const abre = await s.abrir({}, opId(), tokenOutro);
    assert.ok(abre.statusCode >= 400 && abre.statusCode < 500, `abrir: ${abre.statusCode}`);
    const envia = await s.enviar(t.id, linhaReta(1, 3), tokenOutro);
    assert.ok(envia.statusCode >= 400 && envia.statusCode < 500, `pontos: ${envia.statusCode}`);
    const enc = await s.encerrarTr(t.id, tokenOutro);
    assert.ok(enc.statusCode >= 400 && enc.statusCode < 500, `encerrar: ${enc.statusCode}`);
    const lista = await s.listar(DIA, tokenOutro);
    assert.ok(lista.statusCode >= 400 && lista.statusCode < 500, `listar: ${lista.statusCode}`);

    assert.equal(await prisma().atividadeTrajeto.count({ where: { cliente_id: outro.cliente.id } }), 0);
    assert.equal(await s.contaPontos(t.id), 0);
    const mesmo = await prisma().atividadeTrajeto.findFirst({ where: { cliente_id: s.c, id: t.id } });
    assert.equal(mesmo.status, 'ABERTO');
  });

  test('GPS-07: corpo fechado — latitude fora da faixa, campo sobrando, lote acima de 200 → 400; trajeto inexistente → 404', async () => {
    const s = await montar();
    const t = await s.abrirOk();
    const fora = await s.enviar(t.id, [ponto(1, 91, -54, T0)]);
    assert.equal(fora.statusCode, 400, fora.body);
    const sobra = await H.req('POST', `/atividades/${s.atividade.id}/trajetos/${t.id}/pontos`, s.token, { empresa_id: s.e1.id, pontos: [ponto(1, -20, -54, T0)], extra: 1 });
    assert.equal(sobra.statusCode, 400, sobra.body);
    const grande = await s.enviar(t.id, Array.from({ length: LOTE_MAXIMO + 1 }, (_, i) => ponto(i + 1, -20, -54, T0)));
    assert.equal(grande.statusCode, 400, grande.body);
    assert.equal(await s.contaPontos(t.id), 0);

    const naoExiste = await H.req('POST', `/atividades/${s.atividade.id}/trajetos/trj-inexistente-1/encerrar`, s.token, { empresa_id: s.e1.id });
    assert.deepEqual(erro(naoExiste).slice(0, 2), [404, 'TRAJETO_NOT_FOUND'], naoExiste.body);
  });
});
