/**
 * D-PROD-122 (S1/H1) — integridade temporal do rebanho.
 *
 * Fato REALIZADO com data_operacional posterior ao "hoje" da FAZENDA (fuso
 * IANA da Empresa, relógio do servidor) é recusado antes de qualquer escrita,
 * em todos os caminhos que gravam fatos do ledger. Sem fuso configurado, a
 * escrita nova falha fechada; leitura, exclusão segura e replay não mudam.
 *
 * O "agora" vem de um relógio de teste por contexto (AsyncLocalStorage), só em
 * NODE_ENV=test: nada aqui depende da data real da máquina.
 *
 * Cada recusa confere a FOTOGRAFIA completa do tenant: lotes, posições,
 * eventos, partidas, pesos, movimentos, recibos e auditoria.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

// RED na main: o módulo ainda não existe; os testes de API então rodam com o
// relógio real e mostram o defeito (data futura aceita).
const tempo = await import('../src/modules/rebanhoLedger/rebanhoLedgerTempo.js').catch(() => null);
const inventario = await import('../../scripts/ops/inventarioFuturosRebanhoLib.mjs').catch(() => null);

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
before(async () => {
  process.env.NODE_ENV = 'test';
  app = await criarApp();
  await app.ready();
});
after(async () => {
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const SP = 'America/Sao_Paulo';
const CUIABA = 'America/Cuiaba';
const RIO_BRANCO = 'America/Rio_Branco';
/** 12:00 em São Paulo de 04/11/2026: hoje = 2026-11-04 nos três fusos testados. */
const MEIO_DIA_04 = '2026-11-04T15:00:00.000Z';
const HOJE = '2026-11-04';
const AMANHA = '2026-11-05';
const ONTEM = '2026-11-03';

const noRelogio = (agora, fn) => (tempo ? tempo.comRelogioDeTeste(agora, fn) : fn());

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';
const VACA = 'Vaca + 36 meses';
const BEZERRO = 'Bezerro 0 a 12 meses';
const TOURO = 'Touro + 36 meses';

const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};

/** Fuso pela rota administrativa (na main a rota não existe: segue sem fuso). */
const configurarFuso = async (c, fuso, motivo) => {
  const r = await req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tok, { fuso_horario: fuso, ...(motivo ? { motivo } : {}) });
  if (r.statusCode === 404 && !tempo) return null;
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

const cenario = async ({ fuso = SP, papelTenant = 'administrador' } = {}) => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const comum = await p.usuario.create({
    data: { cliente_id: adm.cliente.id, nome: 'Comum', login: `comum-${randomUUID().slice(0, 8)}`, senha_hash: (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash, papel_tenant: 'usuario' },
  });
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const c = { cliente: adm.cliente, tok, tokComum, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  if (fuso) await configurarFuso(c, fuso);
  return c;
};
const entrada = async (c, { nome = 'LOTE', qtd = 40, area = c.A, data = '2026-10-25', categoria = BOI, sexo = 'Macho', peso = 400 } = {}) =>
  ok(req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  }));
const ativar = (c, corpo = { modo: 'entradas' }) => req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, ...corpo });
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens;
const posDe = async (c, lote, area) => (await posicoes(c)).find((p) => p.lote_entrada_id === lote.id && p.area_atual_id === area.id);

const fotografia = async (c) => {
  const p = prisma();
  const w = { cliente_id: c.cliente.id };
  return {
    lotes: (await p.lote.findMany({ where: w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.status, l.area_atual_id, l.data_entrada?.toISOString?.() ?? null]),
    posicoes: (await p.posicaoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg), x.categoria]),
    ativacoes: await p.rebanhoLedgerAtivacao.count({ where: w }),
    eventos: await p.eventoRebanho.count({ where: w }),
    partidas: await p.partidaRebanho.count({ where: w }),
    pesos: await p.pesoRebanho.count({ where: w }),
    movs: await p.movimentacaoMapa.count({ where: w }),
    audits: await p.auditLog.count({ where: w }),
    ops: await p.operacaoIdempotente.count({ where: w }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await fotografia(c);
  const r = await acao();
  assert.equal(r.statusCode, status, `${codigo}: ${r.body}`);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await fotografia(c), antes, 'nada pode ser gravado (lotes, posições, eventos, partidas, pesos, movimentos, recibos, auditoria)');
  return r;
};
const exigirFuturoRecusado = async (c, acao, { data = AMANHA, hoje = HOJE, fuso = SP } = {}) => {
  const r = await exigirNadaGravado(c, acao, 409, 'REBANHO_DATA_FUTURA');
  assert.deepEqual(r.json().details, { data, hoje, fuso }, r.body);
  return r;
};

/** Empresa ativada pelas entradas, com 2 lotes de bois, 1 de vacas e 1 de garrotes em A. */
const empresaAtiva = async (opcoes = {}) => {
  const c = await cenario(opcoes);
  c.l1 = await entrada(c, { nome: 'L1', qtd: 40 });
  c.l2 = await entrada(c, { nome: 'L2', qtd: 30 });
  c.vacas = await entrada(c, { nome: 'VACAS', qtd: 20, categoria: VACA, sexo: 'Fêmea' });
  await ok(ativar(c));
  c.p1 = await posDe(c, c.l1, c.A);
  c.p2 = await posDe(c, c.l2, c.A);
  return c;
};

// Caminhos que gravam fatos novos do ledger (cada um recebe a data).
const CAMINHOS = {
  'transferência (comando)': (c, data) => req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: data, itens: [{ posicao_id: c.p1.id, quantidade: 2 }] }),
  'transferência (manejo-lote legado)': (c, data) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, tipo: 'Transferência de Área', lote_id: c.p1.id, quantidade_animais: 2, area_destino_id: c.B.id, data_movimentacao: data }),
  'morte (manejo-lote legado)': (c, data) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, tipo: 'Morte', lote_id: c.p1.id, quantidade_animais: 1, data_movimentacao: data }),
  'morte (baixa)': (c, data) => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: data, linhas: [{ categoria: BOI, quantidade: 1, causa_morte: 'Doença' }] }),
  'abate (baixa)': (c, data) => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo: 'Abate', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: data, linhas: [{ categoria: BOI, quantidade: 1, destino: 'Consumo Próprio' }] }),
  nascimento: (c, data) => req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Nascimento', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: data, linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 2, peso_medio_kg: 35 }] }),
  pesagem: (c, data) => req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: data, linhas: [{ lote_id: c.p1.id, peso_medio_kg: 420 }] }),
  'mudança de categoria': (c, data) => req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: data, linhas: [{ categoria_atual: BOI, categoria_nova: TOURO, quantidade: 2 }] }),
  junção: (c, data) => req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: c.p1.id, lote_origem_ids: [c.p2.id], data_movimentacao: data }),
  'entrada (cadastro de Lote em empresa ativada)': (c, data) => req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome: `NOVO-${randomUUID().slice(0, 6)}`, quantidade_cabecas: 5, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 380,
  }),
};

// ═══ Funções puras: dia no fuso, validação IANA, relógio de teste ═════════

describe('D-PROD-122 — tempo da fazenda (funções puras)', () => {
  test('P1: 23:59 / 00:00 em São Paulo, Cuiabá e Rio Branco com o processo em UTC', () => {
    assert.ok(tempo, 'módulo rebanhoLedgerTempo ausente');
    const casos = [
      [SP, '2026-11-05T02:59:59.999Z', '2026-11-04'], [SP, '2026-11-05T03:00:00.000Z', '2026-11-05'],
      [CUIABA, '2026-11-05T03:59:59.999Z', '2026-11-04'], [CUIABA, '2026-11-05T04:00:00.000Z', '2026-11-05'],
      [RIO_BRANCO, '2026-11-05T04:59:59.999Z', '2026-11-04'], [RIO_BRANCO, '2026-11-05T05:00:00.000Z', '2026-11-05'],
      // Virada do dia UTC: 00:30 UTC de 05/11 ainda é 04/11 nos três.
      [SP, '2026-11-05T00:30:00.000Z', '2026-11-04'], [CUIABA, '2026-11-05T00:30:00.000Z', '2026-11-04'], [RIO_BRANCO, '2026-11-05T00:30:00.000Z', '2026-11-04'],
      // Bissexto.
      [SP, '2028-02-29T12:00:00.000Z', '2028-02-29'], [SP, '2028-03-01T02:59:00.000Z', '2028-02-29'], [SP, '2028-03-01T03:00:00.000Z', '2028-03-01'],
      ['UTC', '2026-11-04T23:59:59.000Z', '2026-11-04'],
    ];
    for (const [fuso, instante, dia] of casos) assert.equal(tempo.diaNoFuso(new Date(instante), fuso), dia, `${fuso} ${instante}`);
  });

  test('P2: fuso IANA — válidos canonizados; inválidos recusados', () => {
    assert.ok(tempo, 'módulo rebanhoLedgerTempo ausente');
    assert.equal(tempo.normalizarFusoIana('America/Sao_Paulo'), SP);
    assert.equal(tempo.normalizarFusoIana('america/sao_paulo'), SP);
    assert.equal(tempo.normalizarFusoIana(' America/Cuiaba '), CUIABA);
    assert.equal(tempo.normalizarFusoIana('America/Rio_Branco'), RIO_BRANCO);
    for (const ruim of [null, undefined, '', ' ', 'Mars/Phobos', '+03:00', '-0300', 'GMT-3x', 'America/Sao_Paulo; DROP TABLE x', 'A'.repeat(65), 42, {}, 'America/../etc']) {
      assert.equal(tempo.normalizarFusoIana(ruim), null, `deveria recusar ${String(ruim)}`);
    }
  });

  test('P3: relógio de teste isolado por contexto (concorrente) e restaurado ao sair', async () => {
    assert.ok(tempo, 'módulo rebanhoLedgerTempo ausente');
    const vistos = await Promise.all(['2026-01-01T12:00:00Z', '2027-06-15T12:00:00Z', '2028-02-29T12:00:00Z'].map((agora) =>
      tempo.comRelogioDeTeste(agora, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return tempo.agoraDoServidor().toISOString();
      })));
    assert.deepEqual(vistos, ['2026-01-01T12:00:00.000Z', '2027-06-15T12:00:00.000Z', '2028-02-29T12:00:00.000Z']);
    const fora = tempo.agoraDoServidor();
    assert.ok(!vistos.includes(fora.toISOString()), 'fora do contexto o relógio não vaza');
  });

  test('P4: fora de NODE_ENV=test o relógio de teste é recusado e a variável de teste é ignorada', () => {
    assert.ok(tempo, 'módulo rebanhoLedgerTempo ausente');
    const anterior = process.env.NODE_ENV;
    const fixo = process.env.MAIKE_TESTE_AGORA;
    try {
      for (const amb of ['production', 'development', '']) {
        process.env.NODE_ENV = amb;
        process.env.MAIKE_TESTE_AGORA = '2001-01-01T00:00:00Z';
        assert.throws(() => tempo.comRelogioDeTeste('2001-01-01T00:00:00Z', () => 1), /NODE_ENV=test/);
        const agora = tempo.agoraDoServidor().getTime();
        assert.ok(Math.abs(agora - Date.now()) < 60_000, `${amb || 'vazio'}: deve usar o relógio real`);
      }
    } finally {
      process.env.NODE_ENV = anterior;
      if (fixo === undefined) delete process.env.MAIKE_TESTE_AGORA;
      else process.env.MAIKE_TESTE_AGORA = fixo;
    }
  });
});

// ═══ Todos os caminhos de fato: hoje passa, amanhã 409 sem escrita ═══════

describe('D-PROD-122 — fato realizado com data futura é recusado em todos os caminhos', () => {
  for (const [nome, chamar] of Object.entries(CAMINHOS)) {
    test(`F: ${nome} — amanhã → 409 REBANHO_DATA_FUTURA sem escrita; hoje → aceito`, () => noRelogio(MEIO_DIA_04, async () => {
      const c = await empresaAtiva();
      await exigirFuturoRecusado(c, () => chamar(c, AMANHA));
      const r = await chamar(c, HOJE);
      assert.equal(r.statusCode, 201, r.body);
    }));
  }

  test('F-R: retroativo (ontem) continua aceito pelas regras temporais de sempre', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await empresaAtiva();
    await ok(CAMINHOS['transferência (comando)'](c, ONTEM));
    await ok(CAMINHOS['morte (baixa)'](c, ONTEM));
    await ok(CAMINHOS.pesagem(c, ONTEM));
  }));

  test('F-ISO: data com hora/offset vale pelo DIA literal informado (sem conversão silenciosa)', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await empresaAtiva();
    // 01:00 de 05/11 em -03:00 seria 04:00Z de 05/11: o dia de negócio é 05/11 → futuro.
    await exigirFuturoRecusado(c, () => CAMINHOS['transferência (comando)'](c, '2026-11-05T01:00:00-03:00'));
    // 23:00 de 04/11 em -03:00 é 02:00Z de 05/11 em UTC: o dia informado é 04/11 → hoje.
    const r = await ok(CAMINHOS['transferência (comando)'](c, '2026-11-04T23:00:00-03:00'));
    assert.equal((await prisma().eventoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: c.cliente.id, id: r.evento.id } } })).data_operacional.toISOString().slice(0, 10), HOJE);
  }));

  test('F-borda: 23:59/00:00 no fuso da fazenda decide hoje × amanhã (SP, Cuiabá, Rio Branco)', async () => {
    for (const [fuso, antes, depois] of [
      [SP, '2026-11-05T02:59:00Z', '2026-11-05T03:00:00Z'],
      [CUIABA, '2026-11-05T03:59:00Z', '2026-11-05T04:00:00Z'],
      [RIO_BRANCO, '2026-11-05T04:59:00Z', '2026-11-05T05:00:00Z'],
    ]) {
      await limparBanco();
      const c = await noRelogio(MEIO_DIA_04, () => empresaAtiva({ fuso }));
      await noRelogio(antes, () => exigirFuturoRecusado(c, () => CAMINHOS['morte (baixa)'](c, AMANHA), { fuso }));
      await noRelogio(depois, async () => {
        const r = await CAMINHOS['morte (baixa)'](c, AMANHA);
        assert.equal(r.statusCode, 201, `${fuso} ${depois}: ${r.body}`);
      });
    }
  });

  test('F-fuso: o mesmo instante é "amanhã" em Rio Branco e já "hoje" em São Paulo', () => noRelogio('2026-11-05T04:30:00Z', async () => {
    // 01:30 em SP (05/11) | 23:30 em Rio Branco (04/11)
    const sp = await empresaAtiva({ fuso: SP });
    await ok(CAMINHOS['morte (baixa)'](sp, AMANHA));
    await limparBanco();
    const rb = await empresaAtiva({ fuso: RIO_BRANCO });
    await exigirFuturoRecusado(rb, () => CAMINHOS['morte (baixa)'](rb, AMANHA), { fuso: RIO_BRANCO });
  }));

  test('F-troca: troca de fuso em andamento × manejo na virada — o manejo espera a troca e decide pelo fuso NOVO', () => noRelogio('2026-11-05T04:30:00Z', async () => {
    // 01:30 de 05/11 em SP (05/11 é hoje) | 23:30 de 04/11 em Rio Branco (05/11 é amanhã).
    const c = await empresaAtiva({ fuso: SP });
    const antes = await fotografia(c);
    let sinalizar;
    const trocaComTrava = new Promise((r) => { sinalizar = r; });
    const troca = prisma().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Empresa" WHERE cliente_id = ${c.cliente.id} AND id = ${c.empresa.id} FOR UPDATE`;
      await tx.empresa.update({ where: { id: c.empresa.id }, data: { fuso_horario: RIO_BRANCO } });
      sinalizar();
      await new Promise((r) => setTimeout(r, 600));
    }, { timeout: 10_000 });
    await trocaComTrava;
    const r = await CAMINHOS['morte (baixa)'](c, AMANHA);
    await troca;
    assert.equal(r.statusCode, 409, `a troca já em andamento tem de valer para o manejo concorrente: ${r.body}`);
    assert.equal(r.json().code, 'REBANHO_DATA_FUTURA');
    assert.equal(r.json().details.fuso, RIO_BRANCO);
    const depois = await fotografia(c);
    assert.deepEqual({ ...depois, audits: antes.audits }, antes, 'nenhum fato gravado');
  }));

  test('F-conc: 3 pedidos futuros simultâneos → todos 409, nada gravado', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await empresaAtiva();
    const antes = await fotografia(c);
    const rs = await Promise.all([1, 2, 3].map(() => CAMINHOS['morte (baixa)'](c, AMANHA)));
    assert.deepEqual(rs.map((r) => [r.statusCode, r.json().code]), Array(3).fill([409, 'REBANHO_DATA_FUTURA']));
    assert.deepEqual(await fotografia(c), antes);
  }));
});

// ═══ Ativação ═══════════════════════════════════════════════════════════════

describe('D-PROD-122 — ativação do ledger', () => {
  test('A1: saldo_abertura com data_corte futura → 409 sem escrita; corte hoje → ativa', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await cenario();
    await entrada(c, { nome: 'L1', qtd: 10 });
    await exigirFuturoRecusado(c, () => ativar(c, { modo: 'saldo_abertura', data_corte: AMANHA }));
    await ok(ativar(c, { modo: 'saldo_abertura', data_corte: HOJE }));
  }));

  test('A2: entradas com uma entrada futura no cadastro (empresa ainda legada) → 409 sem escrita', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await cenario();
    await entrada(c, { nome: 'PASSADO', qtd: 10, data: '2026-10-25' });
    // Empresa sem ledger: o cadastro legado não é fato do ledger e segue o contrato atual.
    const futuro = await entrada(c, { nome: 'FUTURO', qtd: 5, data: '2026-11-20' });
    const r = await exigirNadaGravado(c, () => ativar(c), 409, 'REBANHO_DATA_FUTURA');
    assert.equal(r.json().details.hoje, HOJE);
    assert.equal(r.json().details.fuso, SP);
    assert.deepEqual(r.json().details.lotes.map((l) => [l.lote_id, l.data]), [[futuro.id, '2026-11-20']]);
  }));

  test('A3: entradas todas até hoje → ativa (data_corte efetiva = entrada mais antiga)', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await cenario();
    await entrada(c, { nome: 'HOJE', qtd: 5, data: HOJE });
    await entrada(c, { nome: 'ANTES', qtd: 5, data: '2026-10-01' });
    const r = await ok(ativar(c));
    assert.equal(r.data_corte, '2026-10-01');
  }));

  test('A4: entradas sem nenhuma entrada viva → data de corte = hoje DA FAZENDA (não o dia UTC)', () => noRelogio('2026-11-05T02:30:00Z', async () => {
    // 23:30 de 04/11 em SP; em UTC já é 05/11.
    const c = await cenario();
    const r = await ok(ativar(c));
    assert.equal(r.data_corte, HOJE);
  }));

  test('A5: ativação sem fuso configurado → 409 EMPRESA_FUSO_NAO_CONFIGURADO, rollback sem sobras', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await cenario({ fuso: null });
    await entrada(c, { nome: 'L1', qtd: 10 });
    await exigirNadaGravado(c, () => ativar(c), 409, 'EMPRESA_FUSO_NAO_CONFIGURADO');
    await exigirNadaGravado(c, () => ativar(c, { modo: 'saldo_abertura', data_corte: HOJE }), 409, 'EMPRESA_FUSO_NAO_CONFIGURADO');
  }));
});

// ═══ Sem fuso: escrita nova falha fechada; leitura e reparo seguem ═════════

describe('D-PROD-122 — empresa ativada sem fuso (legado anterior à migration)', () => {
  test('S1: escrita nova → 409 EMPRESA_FUSO_NAO_CONFIGURADO sem escrita; leitura, histórico e exclusão seguem', () => noRelogio(MEIO_DIA_04, async () => {
    const c = await empresaAtiva();
    const mov = (await ok(CAMINHOS['morte (baixa)'](c, ONTEM))).movimentacao;
    // Simula empresa ativada antes da coluna existir (fuso nulo).
    await prisma().empresa.update({ where: { id: c.empresa.id }, data: { fuso_horario: null } });
    for (const [nome, chamar] of Object.entries(CAMINHOS)) {
      const r = await exigirNadaGravado(c, () => chamar(c, HOJE), 409, 'EMPRESA_FUSO_NAO_CONFIGURADO');
      assert.equal(r.json().details.empresa_id, c.empresa.id, nome);
    }
    assert.equal((await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}`, c.tok)).statusCode, 200);
    assert.equal((await req('GET', `/rebanho/saldos?empresa_id=${c.empresa.id}&data=${HOJE}`, c.tok)).statusCode, 200);
    assert.equal((await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).statusCode, 200);
    assert.equal((await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}`, c.tok)).statusCode, 200);
    const eleg = (await req('GET', `/movimentacoes-mapa/${mov.id}/elegibilidade-exclusao`, c.tok)).json();
    assert.equal(eleg.elegivel, true, JSON.stringify(eleg));
    await ok(req('POST', `/movimentacoes-mapa/${mov.id}/exclusao`, c.tok, { operation_id: opId(), motivo: 'reparo sem fuso' }), 200);
  }));
});

// ═══ Replay idempotente e exclusão de futuro legado ═══════════════════════

describe('D-PROD-122 — futuro legado: replay e reparo', () => {
  /** Grava uma morte em 27/11 com o relógio em 30/11 (como se fosse legado anterior à regra). */
  const futuroLegado = async () => {
    const c = await noRelogio(MEIO_DIA_04, () => empresaAtiva());
    const posicoesAntes = (await posicoes(c)).map((p) => [p.id, p.quantidade_cabecas]).sort();
    const corpo = { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-27', linhas: [{ categoria: BOI, quantidade: 1, causa_morte: 'Doença' }] };
    const original = await noRelogio('2026-11-30T15:00:00Z', () => ok(req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, corpo)));
    return { c, corpo, original, posicoesAntes };
  };

  test('R1: replay idêntico de operação committed com data futura → mesma resposta, sem 409 e sem nova linha', async () => {
    const { c, corpo, original } = await futuroLegado();
    await noRelogio(MEIO_DIA_04, async () => {
      const antes = await fotografia(c);
      const r = await req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, corpo);
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().replay, true);
      assert.equal(r.json().movimentacao.id, original.movimentacao.id);
      assert.deepEqual(await fotografia(c), antes);
      // Replay não depende de fuso: segue igual mesmo sem fuso configurado.
      await prisma().empresa.update({ where: { id: c.empresa.id }, data: { fuso_horario: null } });
      const r2 = await req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, corpo);
      assert.equal(r2.statusCode, 201, r2.body);
      assert.equal(r2.json().replay, true);
    });
  });

  test('R2: operação NOVA com a mesma data futura → 409 e nenhum recibo criado', async () => {
    const { c, corpo } = await futuroLegado();
    await noRelogio(MEIO_DIA_04, async () => {
      const novo = { ...corpo, operation_id: opId() };
      await exigirFuturoRecusado(c, () => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, novo), { data: '2026-11-27' });
      assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: c.cliente.id, operation_key: novo.operation_id } }), 0);
    });
  });

  test('R3: exclusão segura do futuro legado não é bloqueada por data nem por fuso; restaura o estado', async () => {
    const { c, original, posicoesAntes } = await futuroLegado();
    await noRelogio(MEIO_DIA_04, async () => {
      const id = original.movimentacao.id;
      await prisma().empresa.update({ where: { id: c.empresa.id }, data: { fuso_horario: null } });
      const eleg = (await req('GET', `/movimentacoes-mapa/${id}/elegibilidade-exclusao`, c.tok)).json();
      assert.equal(eleg.elegivel, true, JSON.stringify(eleg));
      await ok(req('POST', `/movimentacoes-mapa/${id}/exclusao`, c.tok, { operation_id: opId(), motivo: 'data futura lançada por engano' }), 200);
      assert.deepEqual((await posicoes(c)).map((p) => [p.id, p.quantidade_cabecas]).sort(), posicoesAntes, 'restauração exata das posições');
      assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, tipo: 'MORTE' } }), 0);
      const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
      assert.equal(v.integro, true, JSON.stringify(v));
      assert.equal(v.conservacao.saldo, 90);
    });
  });
});

// ═══ Configuração administrativa do fuso ═══════════════════════════════════

describe('D-PROD-122 — configuração do fuso da Empresa (admin, auditada)', () => {
  test('C1: admin configura; inválido 400; usuário comum 403; PATCH genérico não aceita o campo; leitura expõe', async () => {
    const c = await cenario({ fuso: null });
    const auditsAntes = await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'Empresa' } });
    const inval = await req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tok, { fuso_horario: 'Mars/Phobos' });
    assert.equal(inval.statusCode, 400, inval.body);
    assert.equal(inval.json().code, 'EMPRESA_FUSO_INVALIDO');
    const r = await ok(req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tok, { fuso_horario: 'america/cuiaba' }), 200);
    assert.equal(r.fuso_horario, CUIABA);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'Empresa' } }), auditsAntes + 1);
    // Mesmo valor: nada muda, nenhuma auditoria nova.
    await ok(req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tok, { fuso_horario: CUIABA }), 200);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'Empresa' } }), auditsAntes + 1);
    const patch = await req('PATCH', `/empresas/${c.empresa.id}`, c.tok, { fuso_horario: SP });
    assert.equal(patch.statusCode, 400, patch.body);
    const lista = (await req('GET', '/empresas', c.tok)).json();
    const itens = Array.isArray(lista) ? lista : lista.itens;
    assert.equal(itens.find((e) => e.id === c.empresa.id).fuso_horario, CUIABA);
    const r403 = await exigirNadaGravado(c, () => req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tokComum, { fuso_horario: SP }), 403, 'TENANT_ADMIN_REQUIRED');
    assert.ok(r403);
    assert.equal((await prisma().empresa.findUnique({ where: { id: c.empresa.id } })).fuso_horario, CUIABA);
  });

  test('C2: troca de fuso já configurado exige motivo e registra anterior/novo na auditoria', async () => {
    const c = await cenario({ fuso: SP });
    const sem = await req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tok, { fuso_horario: RIO_BRANCO });
    assert.equal(sem.statusCode, 400, sem.body);
    assert.equal(sem.json().code, 'REQUEST_VALIDATION_FAILED');
    await ok(req('PUT', `/empresas/${c.empresa.id}/fuso-horario`, c.tok, { fuso_horario: RIO_BRANCO, motivo: 'fazenda fica no Acre' }), 200);
    const log = await prisma().auditLog.findFirst({ where: { cliente_id: c.cliente.id, entidade: 'Empresa', entidade_id: c.empresa.id }, orderBy: { createdAt: 'desc' } });
    const texto = JSON.stringify(log);
    assert.match(texto, /America\/Sao_Paulo/);
    assert.match(texto, /America\/Rio_Branco/);
    assert.match(texto, /fazenda fica no Acre/);
  });

  test('C3: tenant B não enxerga nem configura a empresa de A; o fuso de B não afeta o relógio de A', () => noRelogio('2026-11-05T04:30:00Z', async () => {
    const a = await empresaAtiva({ fuso: SP });
    const b = await cenario({ fuso: RIO_BRANCO });
    const cruz = await req('PUT', `/empresas/${a.empresa.id}/fuso-horario`, b.tok, { fuso_horario: RIO_BRANCO, motivo: 'tentativa' });
    assert.equal(cruz.statusCode, 404, cruz.body);
    assert.equal((await prisma().empresa.findUnique({ where: { id: a.empresa.id } })).fuso_horario, SP);
    // 01:30 de 05/11 em SP: A aceita 05/11 mesmo com B (Rio Branco, ainda 04/11) existindo.
    await ok(CAMINHOS['morte (baixa)'](a, AMANHA));
  }));

  test('C5: POST /empresas sem fuso cria e ativa (sem fato); escrita nova falha fechada até configurar; com fuso válido, canonizado; inválido 400', () => noRelogio(MEIO_DIA_04, async () => {
    const adm = await criarTenant({ papelTenant: 'administrador' });
    const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
    const sem = await ok(req('POST', '/empresas', tok, { apelido: 'SEM', nome: 'SEM FUSO', tipo_pessoa: 'Jurídica' }));
    assert.equal(sem.fuso_horario, null);
    const ativ = await prisma().rebanhoLedgerAtivacao.findUnique({ where: { cliente_id_empresa_id: { cliente_id: adm.cliente.id, empresa_id: sem.id } } });
    assert.ok(ativ, 'empresa nova nasce ativada (D-PROD-107)');
    assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: adm.cliente.id } }), 0);
    const p = prisma();
    const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: sem.id, numero_setor: '1', nome: 'S' } });
    const area = await p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: sem.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: '1', nome: 'A', tamanho_hectares: 10 } });
    const corpoLote = { empresa_id: sem.id, nome: 'L', quantidade_cabecas: 5, categoria: BOI, sexo: 'Macho', setor_id: setor.id, area_entrada_id: area.id, area_atual_id: area.id, data_entrada: HOJE, motivo_entrada: 'Compra', status: 'Ativo' };
    const c = { cliente: adm.cliente };
    await exigirNadaGravado(c, () => req('POST', '/lotes', tok, corpoLote), 409, 'EMPRESA_FUSO_NAO_CONFIGURADO');
    await ok(req('PUT', `/empresas/${sem.id}/fuso-horario`, tok, { fuso_horario: SP }), 200);
    await ok(req('POST', '/lotes', tok, corpoLote));
    const com = await ok(req('POST', '/empresas', tok, { apelido: 'COM', nome: 'COM FUSO', tipo_pessoa: 'Jurídica', fuso_horario: 'america/cuiaba' }));
    assert.equal(com.fuso_horario, CUIABA);
    const ruim = await req('POST', '/empresas', tok, { apelido: 'RUIM', nome: 'RUIM', tipo_pessoa: 'Jurídica', fuso_horario: '-03:00' });
    assert.equal(ruim.statusCode, 400, ruim.body);
    assert.equal(ruim.json().code, 'EMPRESA_FUSO_INVALIDO');
  }));

  test('C4: empresa de outro tenant → 404; empresa inexistente → 404', async () => {
    const c = await cenario({ fuso: SP });
    const r = await req('PUT', '/empresas/nao-existe/fuso-horario', c.tok, { fuso_horario: SP });
    assert.equal(r.statusCode, 404, r.body);
  });
});

// ═══ KM-06 sintético + inventário somente leitura ══════════════════════════

describe('D-PROD-122 — inventário READ-ONLY de fatos futuros (KM-06 sintético)', () => {
  test('K1: 50 bezerros, morte em +23 dias, pesagem 50 e reclassificação 49 → projeção 49 × as-of 50; inventário aponta sem alterar', async () => {
    assert.ok(inventario, 'inventarioFuturosRebanhoLib ausente');
    const c = await noRelogio(MEIO_DIA_04, async () => {
      const x = await cenario();
      x.bez = await entrada(x, { nome: 'BEZERROS', qtd: 50, categoria: BEZERRO, sexo: 'Macho', peso: 320, data: '2026-10-25' });
      await ok(ativar(x));
      x.pb = await posDe(x, x.bez, x.A);
      return x;
    });
    // Morte registrada "antes", mas com data 27/11 (como no incidente): só foi possível sem a regra.
    await noRelogio('2026-11-30T15:00:00Z', () => ok(req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, {
      operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-27', linhas: [{ categoria: BEZERRO, quantidade: 1, causa_morte: 'Doença' }],
    })));
    await noRelogio(MEIO_DIA_04, async () => {
      await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: HOJE, linhas: [{ lote_id: c.pb.id, peso_medio_kg: 350 }] }));
      await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: HOJE, linhas: [{ categoria_atual: BEZERRO, categoria_nova: TOURO, quantidade: 49 }] }));
    });
    const ps = await posicoes(c);
    const proj = (cat) => ps.filter((p) => p.categoria === cat).reduce((t, p) => t + p.quantidade_cabecas, 0);
    assert.deepEqual([proj(BEZERRO), proj(TOURO)], [0, 49], 'projeção materializada inclui a morte futura');
    const asOf = await noRelogio(MEIO_DIA_04, async () => (await req('GET', `/rebanho/saldos?empresa_id=${c.empresa.id}&data=${HOJE}`, c.tok)).json());
    const totalAsOf = (asOf.itens ?? asOf.posicoes ?? asOf).reduce((t, p) => t + (p.quantidade_cabecas ?? p.saldo ?? 0), 0);
    assert.equal(totalAsOf, 50, `as-of 04/11 = 50: ${JSON.stringify(asOf)}`);

    const antes = await fotografia(c);
    const updatedAntes = (await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } })).map((p) => p.updatedAt.toISOString());
    const rel = await inventario.inventariarFuturosRebanho(prisma(), { agora: new Date(MEIO_DIA_04), mostrarIds: true });
    assert.deepEqual(await fotografia(c), antes, 'inventário não escreve');
    assert.deepEqual((await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } })).map((p) => p.updatedAt.toISOString()), updatedAntes);

    const emp = rel.empresas.find((e) => e.empresa_id === c.empresa.id);
    assert.ok(emp, JSON.stringify(rel));
    assert.equal(emp.fuso, SP);
    assert.equal(emp.hoje, HOJE);
    assert.deepEqual(emp.eventos_futuros.map((e) => [e.tipo, e.data_operacional]), [['MORTE', '2026-11-27']]);
    const div = emp.posicoes_divergentes.find((d) => d.posicao_id === c.pb.id);
    assert.deepEqual([div.projecao, div.ate_hoje, div.futuro], [0, 1, -1]);
    assert.equal(div.causa, 'fato_futuro');
    assert.equal(emp.total_projecao, 49);
    assert.equal(emp.total_ate_hoje, 50);
  });

  test('K2: inventário roda em transação READ ONLY (escrita dentro dela é recusada pelo PostgreSQL)', async () => {
    assert.ok(inventario, 'inventarioFuturosRebanhoLib ausente');
    await assert.rejects(
      inventario.executarSomenteLeitura(prisma(), (tx) => tx.$executeRawUnsafe(`UPDATE "Empresa" SET nome = nome WHERE false`).then(() => tx.$executeRawUnsafe(`CREATE TEMP TABLE t_inv (x int)`))),
      /read-only|somente leitura|25006/i,
    );
  });

  test('K3: empresa sem fuso aparece como pendente de configuração, sem inventariar por um fuso inventado', async () => {
    assert.ok(inventario, 'inventarioFuturosRebanhoLib ausente');
    const c = await noRelogio(MEIO_DIA_04, () => empresaAtiva());
    await prisma().empresa.update({ where: { id: c.empresa.id }, data: { fuso_horario: null } });
    const rel = await inventario.inventariarFuturosRebanho(prisma(), { agora: new Date(MEIO_DIA_04), mostrarIds: true });
    assert.ok(rel.empresas_sem_fuso.some((e) => e.empresa_id === c.empresa.id), JSON.stringify(rel));
    assert.ok(!rel.empresas.some((e) => e.empresa_id === c.empresa.id));
  });

  test('K4: sem --mostrar-ids a saída usa hash curto (sem ids nem nomes crus)', async () => {
    assert.ok(inventario, 'inventarioFuturosRebanhoLib ausente');
    const c = await noRelogio(MEIO_DIA_04, () => empresaAtiva());
    const rel = await inventario.inventariarFuturosRebanho(prisma(), { agora: new Date(MEIO_DIA_04) });
    const texto = JSON.stringify(rel);
    assert.ok(!texto.includes(c.empresa.id) && !texto.includes(c.cliente.id) && !texto.includes('Fazenda'), texto);
  });
});
