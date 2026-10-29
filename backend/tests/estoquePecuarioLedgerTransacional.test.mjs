/**
 * Ledger pecuário L1 — serviço transacional contra PostgreSQL REAL.
 *
 * As tabelas do ledger vivem num esquema DESCARTÁVEL criado aqui a partir da
 * DDL proposta (`ledgerPecuarioDdl.js`) e destruído no fim — o schema Prisma
 * não é tocado (L1 isolado da PR #145). Empresa, áreas, categoria, lote e
 * OperacaoIdempotente são as tabelas reais do schema Prisma.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarLedgerPecuario, TIPO_OPERACAO_IDEMPOTENTE } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioComandoService.js';
import { ddlLedgerPecuario, ddlRemoverLedgerPecuario } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioDdl.js';
import { CODIGOS_LEDGER_PECUARIO as C, ehErroLedger } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioErros.js';
import { CATEGORIA_SEM } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioContrato.js';
import { criarTenant, encerrar, limparBanco } from './helpers.mjs';

const ESQUEMA = `ledger_l1_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const DATA = '2026-10-29';
const op = () => `op-${randomUUID()}`;

/** @type {ReturnType<typeof getPrismaClient>} */
let prisma;
/** @type {ReturnType<typeof criarLedgerPecuario>} */
let ledger;

/**
 * Tenant + empresa + setor + N áreas + categoria de manejo.
 * @param {{ areas?: number }} [opcoes]
 */
const criarCenario = async (opcoes = {}) => {
  const { cliente, usuario } = await criarTenant();
  const ctx = { auth: { clienteId: cliente.id, usuarioId: usuario.id, login: 'operador' }, requestId: `req-${randomUUID()}` };
  const empresa = await prisma.empresa.create({ data: { cliente_id: cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda L1' } });
  const setor = await prisma.setor.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const areas = [];
  for (let i = 0; i < (opcoes.areas ?? 4); i += 1) {
    areas.push(
      await prisma.areaPastagem.create({
        data: {
          cliente_id: cliente.id,
          empresa_id: empresa.id,
          setor_id: setor.id,
          setor_nome: setor.nome,
          numero_area: String(i + 1),
          nome: `Área ${String.fromCharCode(65 + i)}`,
          tamanho_hectares: 10,
        },
      })
    );
  }
  const boi = await prisma.categoriaManejo.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, nome: 'BOI' } });
  const vaca = await prisma.categoriaManejo.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, nome: 'VACA' } });
  return { cliente, usuario, ctx, empresa, setor, areas, boi, vaca };
};

/** Lote legado (cadastro histórico) para provar que o ledger não o reescreve. */
const criarLote = async (cen, quantidade, areaId, numero = '1') =>
  prisma.lote.create({
    data: {
      cliente_id: cen.cliente.id,
      empresa_id: cen.empresa.id,
      numero_lote: numero,
      nome: `Lote ${numero}`,
      quantidade_cabecas: quantidade,
      quantidade_entrada: quantidade,
      categoria: 'BOI',
      categoria_manejo_id: cen.boi.id,
      area_entrada_id: areaId,
      area_atual_id: areaId,
      motivo_entrada: 'Compra',
    },
  });

/** Mapa área→saldo (só a categoria pedida) para asserts legíveis. */
const saldosPorArea = async (cen, categoriaChave) => {
  const posicoes = await ledger.listarPosicoes(cen.ctx, cen.empresa.id);
  /** @type {Record<string, number>} */
  const mapa = {};
  for (const p of posicoes) if (p.categoria_chave === categoriaChave) mapa[p.area_id] = p.saldo;
  return mapa;
};

const total = async (cen) => (await ledger.listarPosicoes(cen.ctx, cen.empresa.id)).reduce((t, p) => t + p.saldo, 0);

const contarEventos = async (clienteId) => {
  const r = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${ESQUEMA}".ledger_pecuario_evento WHERE cliente_id = $1`, clienteId);
  return Number(r[0].n);
};

/** Projeção materializada == soma dos fatos (prova de reconstrução). */
const assertProjecaoConsistente = async (cen) => {
  assert.deepEqual(await ledger.listarPosicoes(cen.ctx, cen.empresa.id), await ledger.reconstruirPosicoes(cen.ctx, cen.empresa.id));
};

/**
 * @param {Promise<unknown>} promessa
 * @param {string} codigo
 */
const rejeitaCom = (promessa, codigo) => assert.rejects(promessa, (e) => ehErroLedger(e, codigo) || assert.fail(`esperava ${codigo}, veio ${e?.code ?? e}`));

before(async () => {
  prisma = getPrismaClient();
  await limparBanco();
  for (const sql of ddlLedgerPecuario(ESQUEMA)) await prisma.$executeRawUnsafe(sql);
  ledger = criarLedgerPecuario({ prisma, esquema: ESQUEMA });
});

after(async () => {
  await prisma.$executeRawUnsafe(ddlRemoverLedgerPecuario(ESQUEMA));
  await limparBanco();
  await encerrar();
});

describe('ledger pecuário L1 — cenário do proprietário', () => {
  test('1000 em A, distribui 400/350/250, depois B→C; entrada histórica e Lote intactos', async () => {
    const cen = await criarCenario();
    const [A, B, C2, D] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    const lote = await criarLote(cen, 1000, A);

    const entrada = await ledger.registrarEntrada(cen.ctx, {
      operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 1000,
      categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA, motivo: 'Compra NF 123',
    });
    assert.equal(entrada.evento.tipo, 'ENTRADA');
    assert.equal(entrada.evento.quantidade, 1000);

    for (const [destino, q] of [[B, 400], [C2, 350], [D, 250]]) {
      await ledger.registrarTransferencia(cen.ctx, {
        operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: destino,
        quantidade: q, categoria_manejo_id: cen.boi.id, data_operacional: DATA,
      });
    }
    assert.deepEqual(await saldosPorArea(cen, cat), { [B]: 400, [C2]: 350, [D]: 250 });

    await ledger.registrarTransferencia(cen.ctx, {
      operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: B, area_destino_id: C2,
      quantidade: 100, categoria_manejo_id: cen.boi.id, data_operacional: DATA,
    });
    assert.deepEqual(await saldosPorArea(cen, cat), { [B]: 300, [C2]: 450, [D]: 250 });
    assert.equal(await total(cen), 1000, 'conservação: total da empresa não muda com transferências');
    await assertProjecaoConsistente(cen);

    // A entrada histórica continua dizendo 1000 em A — mesmo com A vazia.
    const ev = await prisma.$queryRawUnsafe(
      `SELECT quantidade, area_destino_id FROM "${ESQUEMA}".ledger_pecuario_evento WHERE cliente_id = $1 AND tipo = 'ENTRADA'`,
      cen.cliente.id
    );
    assert.deepEqual(ev.map((e) => [Number(e.quantidade), e.area_destino_id]), [[1000, A]]);
    // O ledger não escreve no cadastro legado.
    const loteDepois = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(loteDepois.quantidade_entrada, 1000);
    assert.equal(loteDepois.quantidade_cabecas, 1000);
    assert.equal(loteDepois.area_atual_id, A);
    assert.equal(loteDepois.updatedAt.getTime(), lote.updatedAt.getTime());
  });

  test('mistura de entradas distintas agrega na posição, sem vínculo animal→compra', async () => {
    const cen = await criarCenario();
    const [A, B, C2] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 300, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: B, quantidade: 200, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 300, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    const t = await ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: B, area_destino_id: C2, quantidade: 450, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    assert.equal(t.evento.lote_referencia_id, null, 'transferência não carrega proveniência de compra');
    assert.deepEqual(await saldosPorArea(cen, cat), { [B]: 50, [C2]: 450 });
    assert.equal(await total(cen), 500);
    await assertProjecaoConsistente(cen);
  });
});

describe('ledger pecuário L1 — invariantes e recusas sem gravação parcial', () => {
  test('origem == destino recusada (por ID), nada gravado', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    await rejeitaCom(
      ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: A, quantidade: 1, categoria_manejo_id: cen.boi.id, data_operacional: DATA }),
      C.ORIGEM_IGUAL_DESTINO
    );
    assert.equal(await contarEventos(cen.cliente.id), 0);
  });

  test('saldo insuficiente recusado; saldos e contagem de eventos inalterados', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 10, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    const antes = await contarEventos(cen.cliente.id);
    await rejeitaCom(
      ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 11, categoria_manejo_id: cen.boi.id, data_operacional: DATA }),
      C.SALDO_INSUFICIENTE
    );
    assert.equal(await contarEventos(cen.cliente.id), antes);
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 10 });
  });

  test('categoria distinta é outra posição; categoria de outra empresa recusada; SEM_CATEGORIA explícita', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 100, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await rejeitaCom(
      ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 1, categoria_manejo_id: cen.vaca.id, data_operacional: DATA }),
      C.SALDO_INSUFICIENTE
    );
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 7, sem_categoria: true, data_operacional: DATA });
    assert.deepEqual(await saldosPorArea(cen, CATEGORIA_SEM), { [A]: 7 });
    const outra = await prisma.empresa.create({ data: { cliente_id: cen.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    const catOutra = await prisma.categoriaManejo.create({ data: { cliente_id: cen.cliente.id, empresa_id: outra.id, nome: 'BOI' } });
    await rejeitaCom(
      ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 1, categoria_manejo_id: catOutra.id, data_operacional: DATA }),
      C.CATEGORIA_INVALIDA
    );
  });

  test('tenant cruzado e empresa cruzada recusados; posições isoladas por tenant', async () => {
    const t1 = await criarCenario();
    const t2 = await criarCenario();
    const [A1, B1] = t1.areas.map((a) => a.id);
    await ledger.registrarEntrada(t1.ctx, { operation_id: op(), empresa_id: t1.empresa.id, area_id: A1, quantidade: 50, categoria_manejo_id: t1.boi.id, data_operacional: DATA });
    // t2 tentando operar a empresa/áreas do t1 (IDs válidos, tenant errado).
    await rejeitaCom(
      ledger.registrarTransferencia(t2.ctx, { operation_id: op(), empresa_id: t1.empresa.id, area_origem_id: A1, area_destino_id: B1, quantidade: 1, categoria_manejo_id: t1.boi.id, data_operacional: DATA }),
      C.EMPRESA_INVALIDA
    );
    assert.deepEqual(await ledger.listarPosicoes(t2.ctx, t1.empresa.id), []);
    // Área do tenant 2 como destino de evento do tenant 1.
    await rejeitaCom(
      ledger.registrarTransferencia(t1.ctx, { operation_id: op(), empresa_id: t1.empresa.id, area_origem_id: A1, area_destino_id: t2.areas[0].id, quantidade: 1, categoria_manejo_id: t1.boi.id, data_operacional: DATA }),
      C.DESTINO_INVALIDO
    );
    // Área de outra empresa do mesmo tenant.
    const outra = await prisma.empresa.create({ data: { cliente_id: t1.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    const setor2 = await prisma.setor.create({ data: { cliente_id: t1.cliente.id, empresa_id: outra.id, numero_setor: '2', nome: 'S2' } });
    const areaOutra = await prisma.areaPastagem.create({ data: { cliente_id: t1.cliente.id, empresa_id: outra.id, setor_id: setor2.id, setor_nome: 'S2', numero_area: '99', nome: 'X', tamanho_hectares: 1 } });
    await rejeitaCom(
      ledger.registrarTransferencia(t1.ctx, { operation_id: op(), empresa_id: t1.empresa.id, area_origem_id: A1, area_destino_id: areaOutra.id, quantidade: 1, categoria_manejo_id: t1.boi.id, data_operacional: DATA }),
      C.DESTINO_INVALIDO
    );
    assert.equal(await total(t1), 50);
  });

  test('área de destino inativa recusada; origem inativa pode ser esvaziada', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 5, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await prisma.areaPastagem.update({ where: { id: B }, data: { ativo: false } });
    await rejeitaCom(
      ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 1, categoria_manejo_id: cen.boi.id, data_operacional: DATA }),
      C.DESTINO_INVALIDO
    );
    await prisma.areaPastagem.update({ where: { id: A }, data: { ativo: false } });
    await prisma.areaPastagem.update({ where: { id: B }, data: { ativo: true } });
    await ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 5, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [B]: 5 });
  });

  test('falha simulada após o 1º débito → rollback total (sem evento, saldo, nem idempotência presa)', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 20, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    const quebrado = criarLedgerPecuario({ prisma, esquema: ESQUEMA, ganchoTeste: { aposPrimeiraPartida: () => { throw new Error('falha simulada no meio'); } } });
    const chave = op();
    const pedido = { operation_id: chave, empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 8, categoria_manejo_id: cen.boi.id, data_operacional: DATA };
    const antes = await contarEventos(cen.cliente.id);
    await assert.rejects(quebrado.registrarTransferencia(cen.ctx, pedido), /falha simulada/);
    assert.equal(await contarEventos(cen.cliente.id), antes);
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 20 });
    assert.equal(await prisma.operacaoIdempotente.count({ where: { cliente_id: cen.cliente.id, operation_key: chave } }), 0);
    // A mesma chave funciona depois (não ficou "processing" pendurada).
    await ledger.registrarTransferencia(cen.ctx, pedido);
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 12, [B]: 8 });
  });

  test('fatos são append-only no banco: UPDATE/DELETE em evento e partida falham', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 3, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "${ESQUEMA}".ledger_pecuario_evento SET quantidade = 999 WHERE cliente_id = $1`, cen.cliente.id), /append-only/);
    await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "${ESQUEMA}".ledger_pecuario_partida WHERE cliente_id = $1`, cen.cliente.id), /append-only/);
  });

  test('esquema public é recusado (L1 não cria tabela fora do schema Prisma)', () => {
    assert.throws(() => criarLedgerPecuario({ prisma, esquema: 'public' }), (e) => ehErroLedger(e, C.ESQUEMA_INVALIDO));
    assert.throws(() => criarLedgerPecuario({ prisma, esquema: 'x"; drop' }), (e) => ehErroLedger(e, C.ESQUEMA_INVALIDO));
  });
});

describe('ledger pecuário L1 — idempotência', () => {
  test('mesma operation_id + mesmo payload = replay do resultado gravado (1 evento só)', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    const pedido = { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 40, categoria_manejo_id: cen.boi.id, data_operacional: DATA };
    const r1 = await ledger.registrarEntrada(cen.ctx, pedido);
    const r2 = await ledger.registrarEntrada(cen.ctx, { ...pedido });
    assert.equal(r1.replay, false);
    assert.equal(r2.replay, true);
    assert.equal(r2.evento.id, r1.evento.id);
    assert.equal(await contarEventos(cen.cliente.id), 1);
    assert.equal(await total(cen), 40);
    const idem = await prisma.operacaoIdempotente.findFirst({ where: { cliente_id: cen.cliente.id, operation_key: pedido.operation_id } });
    assert.equal(idem.tipo_operacao, TIPO_OPERACAO_IDEMPOTENTE);
    assert.equal(idem.status, 'committed');
  });

  test('mesma operation_id + payload diferente (ou outro comando) = conflito, nada gravado', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const chave = op();
    await ledger.registrarEntrada(cen.ctx, { operation_id: chave, empresa_id: cen.empresa.id, area_id: A, quantidade: 40, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await rejeitaCom(
      ledger.registrarEntrada(cen.ctx, { operation_id: chave, empresa_id: cen.empresa.id, area_id: A, quantidade: 41, categoria_manejo_id: cen.boi.id, data_operacional: DATA }),
      C.IDEMPOTENCIA_CONFLITO
    );
    await rejeitaCom(
      ledger.registrarTransferencia(cen.ctx, { operation_id: chave, empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 1, categoria_manejo_id: cen.boi.id, data_operacional: DATA }),
      C.IDEMPOTENCIA_CONFLITO
    );
    assert.equal(await contarEventos(cen.cliente.id), 1);
    assert.equal(await total(cen), 40);
  });

  test('mesma operation_id disparada em paralelo: um grava, o outro devolve replay', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    const pedido = { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 9, categoria_manejo_id: cen.boi.id, data_operacional: DATA };
    const rs = await Promise.allSettled([ledger.registrarEntrada(cen.ctx, pedido), ledger.registrarEntrada(cen.ctx, { ...pedido })]);
    const ok = rs.filter((r) => r.status === 'fulfilled').map((r) => /** @type {any} */ (r).value);
    const falhas = rs.filter((r) => r.status === 'rejected').map((r) => /** @type {any} */ (r).reason?.code);
    // Aceitável: 1 gravação + 1 replay; ou 1 gravação + EM_PROCESSAMENTO. Nunca 2 eventos.
    assert.equal(ok.filter((r) => r.replay === false).length, 1, `resultados: ${JSON.stringify({ ok: ok.map((r) => r.replay), falhas })}`);
    for (const f of falhas) assert.ok([C.IDEMPOTENCIA_EM_PROCESSAMENTO, C.CONCORRENCIA_ESGOTADA].includes(f), `falha inesperada: ${f}`);
    assert.equal(await contarEventos(cen.cliente.id), 1);
    assert.equal(await total(cen), 9);
  });
});

describe('ledger pecuário L1 — concorrência', () => {
  test('duas saídas concorrentes pelo mesmo saldo: só uma passa, nunca negativo (10 rodadas)', async () => {
    const cen = await criarCenario();
    const [A, B, C2] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    for (let rodada = 0; rodada < 10; rodada += 1) {
      await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 100, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
      const antesA = (await saldosPorArea(cen, cat))[A];
      const pedido = (destino) => ({ operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: destino, quantidade: antesA - 30, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
      const rs = await Promise.allSettled([ledger.registrarTransferencia(cen.ctx, pedido(B)), ledger.registrarTransferencia(cen.ctx, pedido(C2))]);
      const ok = rs.filter((r) => r.status === 'fulfilled').length;
      const insuf = rs.filter((r) => r.status === 'rejected' && ehErroLedger(/** @type {any} */ (r).reason, C.SALDO_INSUFICIENTE)).length;
      assert.equal(ok, 1, `rodada ${rodada}: exatamente uma transferência passa`);
      assert.equal(insuf, 1, `rodada ${rodada}: a outra cai em saldo insuficiente`);
      assert.equal((await saldosPorArea(cen, cat))[A], 30);
    }
    assert.equal(await total(cen), 1000);
    await assertProjecaoConsistente(cen);
  });

  test('A→B e B→A concorrentes não entram em deadlock (trava em ordem determinística)', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 500, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: B, quantidade: 500, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    const lances = [];
    for (let i = 0; i < 8; i += 1) {
      const [o, d] = i % 2 === 0 ? [A, B] : [B, A];
      lances.push(ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: o, area_destino_id: d, quantidade: 10, categoria_manejo_id: cen.boi.id, data_operacional: DATA }));
    }
    const rs = await Promise.allSettled(lances);
    assert.equal(rs.filter((r) => r.status === 'rejected').length, 0, JSON.stringify(rs.filter((r) => r.status === 'rejected').map((r) => /** @type {any} */ (r).reason?.code ?? String(/** @type {any} */ (r).reason))));
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 500, [B]: 500 });
    await assertProjecaoConsistente(cen);
  });
});

describe('ledger pecuário L1 — estorno append-only', () => {
  test('estorno de transferência devolve saldos; original preservado; 2º estorno e estorno de estorno recusados', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 100, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    const t = await ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 60, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: t.evento.id, data_operacional: DATA }), C.ESTORNO_INVALIDO); // sem motivo
    const e = await ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: t.evento.id, motivo: 'lançado errado', data_operacional: DATA });
    assert.equal(e.evento.tipo, 'ESTORNO');
    assert.equal(e.evento.estorno_de_evento_id, t.evento.id);
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 100 });
    assert.equal(await contarEventos(cen.cliente.id), 3, 'entrada + transferência + estorno: nada apagado');
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: t.evento.id, motivo: 'de novo', data_operacional: DATA }), C.ESTORNO_DUPLICADO);
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: e.evento.id, motivo: 'x', data_operacional: DATA }), C.ESTORNO_INVALIDO);
    await assertProjecaoConsistente(cen);
  });

  test('estorno de entrada exige saldo na área; após estornar, o lote pode ser lançado de novo (só 1 entrada ativa)', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, 30, A);
    const ent = await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 30, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
    await rejeitaCom(
      ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 30, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA }),
      C.LOTE_REFERENCIA_INVALIDO
    );
    await ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 20, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: ent.evento.id, motivo: 'compra cancelada', data_operacional: DATA }), C.SALDO_INSUFICIENTE);
    await ledger.registrarTransferencia(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: B, area_destino_id: A, quantidade: 20, categoria_manejo_id: cen.boi.id, data_operacional: DATA });
    await ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: ent.evento.id, motivo: 'compra cancelada', data_operacional: DATA });
    assert.equal(await total(cen), 0);
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 28, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
    assert.equal(await total(cen), 28);
    await assertProjecaoConsistente(cen);
  });

  test('estorno de evento de outro tenant: não encontrado', async () => {
    const t1 = await criarCenario();
    const t2 = await criarCenario();
    const e = await ledger.registrarEntrada(t1.ctx, { operation_id: op(), empresa_id: t1.empresa.id, area_id: t1.areas[0].id, quantidade: 5, categoria_manejo_id: t1.boi.id, data_operacional: DATA });
    await rejeitaCom(ledger.registrarEstorno(t2.ctx, { operation_id: op(), evento_id: e.evento.id, motivo: 'x', data_operacional: DATA }), C.EVENTO_NAO_ENCONTRADO);
    assert.equal(await total(t1), 5);
  });
});
