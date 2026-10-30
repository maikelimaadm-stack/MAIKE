/**
 * Ledger pecuário L1 — serviço transacional contra PostgreSQL REAL.
 *
 * As tabelas do ledger vivem num esquema DESCARTÁVEL `ledger_l1_<hex>` criado
 * aqui a partir da DDL proposta e destruído no fim — o schema Prisma não é
 * tocado (L1 isolado da PR #145). Empresa, áreas, categoria, Lote e
 * OperacaoIdempotente são as tabelas reais do schema Prisma.
 *
 * R2: toda ENTRADA referencia um Lote real (cadastro = entrada histórica) cujo
 * snapshot (quantidade_entrada, area_entrada_id, categoria_manejo_entrada_id)
 * precisa bater; entradas concorrentes do mesmo lote são serializadas pela
 * trava do Lote.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarLedgerPecuario, TIPO_OPERACAO_IDEMPOTENTE } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioComandoService.js';
import { ddlLedgerPecuario, ddlRemoverLedgerPecuario, gerarEsquemaDescartavel } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioDdl.js';
import { CODIGOS_LEDGER_PECUARIO as C, ehErroLedger } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioErros.js';
import { CATEGORIA_SEM } from '../src/modules/estoquePecuarioLedger/ledgerPecuarioContrato.js';
import { criarTenant, encerrar, limparBanco } from './helpers.mjs';

const ESQUEMA = gerarEsquemaDescartavel();
const DATA = '2026-10-29';
const op = () => `op-${randomUUID()}`;

/** @type {ReturnType<typeof getPrismaClient>} */
let prisma;
/** @type {ReturnType<typeof criarLedgerPecuario>} */
let ledger;
/** @type {string[]} */
let esquemasL1Antes = [];
let numeroLote = 0;

const esquemasL1 = async () =>
  (await prisma.$queryRawUnsafe(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'ledger_l1_%' ORDER BY 1`)).map((r) => r.schema_name);

/** Tenant + empresa + setor + N áreas + categorias de manejo. */
const criarCenario = async (opcoes = {}) => {
  const { cliente, usuario } = await criarTenant();
  const ctx = { auth: { clienteId: cliente.id, usuarioId: usuario.id, login: 'operador' }, requestId: `req-${randomUUID()}` };
  const empresa = await prisma.empresa.create({ data: { cliente_id: cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda L1' } });
  const setor = await prisma.setor.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const areas = [];
  for (let i = 0; i < (opcoes.areas ?? 4); i += 1) {
    areas.push(
      await prisma.areaPastagem.create({
        data: { cliente_id: cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(i + 1), nome: `Área ${String.fromCharCode(65 + i)}`, tamanho_hectares: 10 },
      })
    );
  }
  const boi = await prisma.categoriaManejo.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, nome: 'BOI' } });
  const vaca = await prisma.categoriaManejo.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, nome: 'VACA' } });
  return { cliente, usuario, ctx, empresa, setor, areas, boi, vaca };
};

/**
 * Cadastro de lote (snapshot histórico de entrada).
 * @param {any} cen
 * @param {{ quantidade: number, areaId: string, categoriaId?: string | null, origem?: string, status?: string, quantidadeCabecas?: number, categoriaAtualId?: string | null, categoriaTexto?: string | null }} o
 */
const criarLote = async (cen, o) => {
  numeroLote += 1;
  const catEntrada = o.categoriaId === undefined ? cen.boi.id : o.categoriaId;
  return prisma.lote.create({
    data: {
      cliente_id: cen.cliente.id,
      empresa_id: cen.empresa.id,
      numero_lote: `L${numeroLote}`,
      nome: `Lote ${numeroLote}`,
      quantidade_entrada: o.quantidade,
      quantidade_cabecas: o.quantidadeCabecas ?? o.quantidade,
      categoria_manejo_entrada_id: catEntrada,
      categoria_manejo_id: o.categoriaAtualId === undefined ? catEntrada : o.categoriaAtualId,
      categoria: o.categoriaTexto ?? (catEntrada ? 'BOI' : null),
      area_entrada_id: o.areaId,
      area_atual_id: o.areaId,
      motivo_entrada: 'Compra',
      origem: o.origem ?? 'Compra',
      status: o.status ?? 'Ativo',
    },
  });
};

/** ENTRADA coerente com o lote recém-cadastrado. */
const entrar = async (cen, areaId, quantidade, categoriaId = cen.boi.id, extra = {}) => {
  const lote = await criarLote(cen, { quantidade, areaId, categoriaId });
  const r = await ledger.registrarEntrada(cen.ctx, {
    operation_id: op(), empresa_id: cen.empresa.id, area_id: areaId, quantidade,
    ...(categoriaId ? { categoria_manejo_id: categoriaId } : { sem_categoria: true }),
    lote_referencia_id: lote.id, data_operacional: DATA, ...extra,
  });
  return { lote, r };
};

const transferir = (cen, origem, destino, quantidade, categoriaId = cen.boi.id, extra = {}) =>
  ledger.registrarTransferencia(cen.ctx, {
    operation_id: op(), empresa_id: cen.empresa.id, area_origem_id: origem, area_destino_id: destino,
    quantidade, categoria_manejo_id: categoriaId, data_operacional: DATA, ...extra,
  });

/** Mapa área→saldo (só a categoria pedida) para asserts legíveis. */
const saldosPorArea = async (cen, categoriaChave) => {
  /** @type {Record<string, number>} */
  const mapa = {};
  for (const p of await ledger.listarPosicoes(cen.ctx, cen.empresa.id)) if (p.categoria_chave === categoriaChave) mapa[p.area_id] = p.saldo;
  return mapa;
};

const total = async (cen) => (await ledger.listarPosicoes(cen.ctx, cen.empresa.id)).reduce((t, p) => t + p.saldo, 0);

const contarEventos = async (clienteId, tipo = null) => {
  const r = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "${ESQUEMA}".ledger_pecuario_evento WHERE cliente_id = $1 AND ($2::text IS NULL OR tipo = $2)`,
    clienteId,
    tipo
  );
  return Number(r[0].n);
};

const assertProjecaoConsistente = async (cen) => {
  assert.deepEqual(await ledger.listarPosicoes(cen.ctx, cen.empresa.id), await ledger.reconstruirPosicoes(cen.ctx, cen.empresa.id));
};

const rejeitaCom = (promessa, codigo) => assert.rejects(promessa, (e) => ehErroLedger(e, codigo) || assert.fail(`esperava ${codigo}, veio ${e?.code ?? e}`));

before(async () => {
  prisma = getPrismaClient();
  await limparBanco();
  esquemasL1Antes = await esquemasL1();
  for (const sql of ddlLedgerPecuario(ESQUEMA)) await prisma.$executeRawUnsafe(sql);
  ledger = criarLedgerPecuario({ prisma, esquema: ESQUEMA });
});

after(async () => {
  await prisma.$executeRawUnsafe(ddlRemoverLedgerPecuario(ESQUEMA));
  // A suíte só cria e só remove o PRÓPRIO esquema (P1-5 R2).
  assert.deepEqual(await esquemasL1(), esquemasL1Antes);
  await limparBanco();
  await encerrar();
});

describe('ledger pecuário L1 — cenário do proprietário', () => {
  test('1000 em A, distribui 400/350/250, depois B→C; entrada histórica e Lote intactos', async () => {
    const cen = await criarCenario();
    const [A, B, C2, D] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    const { lote, r: entrada } = await entrar(cen, A, 1000, cen.boi.id, { motivo: 'Compra NF 123' });
    assert.equal(entrada.evento.tipo, 'ENTRADA');
    assert.equal(entrada.evento.quantidade, 1000);
    for (const [destino, q] of [[B, 400], [C2, 350], [D, 250]]) await transferir(cen, A, destino, q);
    assert.deepEqual(await saldosPorArea(cen, cat), { [B]: 400, [C2]: 350, [D]: 250 });
    await transferir(cen, B, C2, 100);
    assert.deepEqual(await saldosPorArea(cen, cat), { [B]: 300, [C2]: 450, [D]: 250 });
    assert.equal(await total(cen), 1000, 'conservação: total da empresa não muda com transferências');
    await assertProjecaoConsistente(cen);
    const ev = await prisma.$queryRawUnsafe(`SELECT quantidade, area_destino_id FROM "${ESQUEMA}".ledger_pecuario_evento WHERE cliente_id = $1 AND tipo = 'ENTRADA'`, cen.cliente.id);
    assert.deepEqual(ev.map((e) => [Number(e.quantidade), e.area_destino_id]), [[1000, A]]);
    const loteDepois = await prisma.lote.findUnique({ where: { id: lote.id } });
    assert.equal(loteDepois.quantidade_entrada, 1000);
    assert.equal(loteDepois.quantidade_cabecas, 1000);
    assert.equal(loteDepois.area_atual_id, A);
    assert.equal(loteDepois.updatedAt.getTime(), lote.updatedAt.getTime(), 'o ledger não escreve no Lote');
  });

  test('mistura de entradas distintas agrega na posição, sem vínculo animal→compra', async () => {
    const cen = await criarCenario();
    const [A, B, C2] = cen.areas.map((a) => a.id);
    await entrar(cen, A, 300);
    await entrar(cen, B, 200);
    await transferir(cen, A, B, 300);
    const t = await transferir(cen, B, C2, 450);
    assert.equal(t.evento.lote_referencia_id, null, 'transferência não carrega proveniência de compra');
    assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [B]: 50, [C2]: 450 });
    assert.equal(await total(cen), 500);
    await assertProjecaoConsistente(cen);
  });
});

describe('R2 P0 — entradas concorrentes do MESMO lote (operation_id diferentes)', () => {
  test('10 rodadas: exatamente 1 entrada ativa; sem dupla contagem; idempotência/posição consistentes', async () => {
    for (let rodada = 0; rodada < 10; rodada += 1) {
      const cen = await criarCenario({ areas: 2 });
      const [A] = cen.areas.map((a) => a.id);
      const lote = await criarLote(cen, { quantidade: 100, areaId: A });
      const pedido = () => ({ operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 100, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
      const [p1, p2] = [pedido(), pedido()];
      const rs = await Promise.allSettled([ledger.registrarEntrada(cen.ctx, p1), ledger.registrarEntrada(cen.ctx, p2)]);
      const ok = rs.filter((r) => r.status === 'fulfilled');
      const recusas = rs.filter((r) => r.status === 'rejected').map((r) => /** @type {any} */ (r).reason?.code);
      assert.equal(ok.length, 1, `rodada ${rodada}: ${JSON.stringify(recusas)}`);
      assert.deepEqual(recusas, [C.LOTE_REFERENCIA_INVALIDO], `rodada ${rodada}: a 2ª vê a entrada da 1ª`);
      assert.equal(await contarEventos(cen.cliente.id, 'ENTRADA'), 1);
      assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [A]: 100 });
      await assertProjecaoConsistente(cen);
      // Idempotência: só a vencedora ficou "committed"; a perdedora não deixou linha presa.
      const idem = await prisma.operacaoIdempotente.findMany({ where: { cliente_id: cen.cliente.id, operation_key: { in: [p1.operation_id, p2.operation_id] } } });
      assert.deepEqual(idem.map((i) => i.status), ['committed']);
    }
  });

  test('payload com OUTRA área para o mesmo lote não passa (diverge do snapshot), nem em paralelo', async () => {
    const cen = await criarCenario({ areas: 2 });
    const [A, B] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, { quantidade: 50, areaId: A });
    const pedido = (area) => ({ operation_id: op(), empresa_id: cen.empresa.id, area_id: area, quantidade: 50, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
    const rs = await Promise.allSettled([ledger.registrarEntrada(cen.ctx, pedido(A)), ledger.registrarEntrada(cen.ctx, pedido(B))]);
    assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(/** @type {any} */ (rs[1]).reason?.code, C.ENTRADA_DIVERGENTE_DO_LOTE);
    assert.equal(await contarEventos(cen.cliente.id, 'ENTRADA'), 1);
    assert.equal(await total(cen), 50);
  });

  test('mesma entrada em lotes distintos é permitida (concorrente)', async () => {
    const cen = await criarCenario({ areas: 2 });
    const [A] = cen.areas.map((a) => a.id);
    const [l1, l2] = [await criarLote(cen, { quantidade: 30, areaId: A }), await criarLote(cen, { quantidade: 30, areaId: A })];
    const pedido = (lote) => ({ operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 30, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
    const rs = await Promise.allSettled([ledger.registrarEntrada(cen.ctx, pedido(l1)), ledger.registrarEntrada(cen.ctx, pedido(l2))]);
    assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal(await total(cen), 60);
  });

  test('lote de outro tenant não passa', async () => {
    const t1 = await criarCenario({ areas: 1 });
    const t2 = await criarCenario({ areas: 1 });
    const loteT1 = await criarLote(t1, { quantidade: 10, areaId: t1.areas[0].id });
    await rejeitaCom(
      ledger.registrarEntrada(t2.ctx, { operation_id: op(), empresa_id: t2.empresa.id, area_id: t2.areas[0].id, quantidade: 10, categoria_manejo_id: t2.boi.id, lote_referencia_id: loteT1.id, data_operacional: DATA }),
      C.LOTE_REFERENCIA_INVALIDO
    );
    assert.equal(await contarEventos(t2.cliente.id), 0);
  });
});

describe('R2 — entrada = snapshot histórico do cadastro', () => {
  test('lote_referencia_id é obrigatório (sem entrada "solta")', async () => {
    const cen = await criarCenario({ areas: 1 });
    await rejeitaCom(
      ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: cen.areas[0].id, quantidade: 5, categoria_manejo_id: cen.boi.id, data_operacional: DATA }),
      C.LOTE_REFERENCIA_INVALIDO
    );
  });

  test('quantidade, área ou categoria divergentes do snapshot são recusadas (nunca normalizadas)', async () => {
    const cen = await criarCenario({ areas: 2 });
    const [A, B] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, { quantidade: 80, areaId: A, quantidadeCabecas: 65 });
    const base = { empresa_id: cen.empresa.id, area_id: A, quantidade: 80, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA };
    for (const [desvio, campo] of [[{ quantidade: 65 }, 'quantidade'], [{ area_id: B }, 'area_id'], [{ categoria_manejo_id: cen.vaca.id }, 'categoria_manejo_id']]) {
      await assert.rejects(
        ledger.registrarEntrada(cen.ctx, { ...base, ...desvio, operation_id: op() }),
        (e) => ehErroLedger(e, C.ENTRADA_DIVERGENTE_DO_LOTE) && e.details.field === campo
      );
    }
    assert.equal(await contarEventos(cen.cliente.id), 0);
    // A quantidade ATUAL (65) não precisa bater — só a de entrada (80).
    await ledger.registrarEntrada(cen.ctx, { ...base, operation_id: op() });
    assert.equal(await total(cen), 80);
  });

  test('lote que mudou de categoria entra pela categoria HISTÓRICA; sem ID histórico com texto = recusa', async () => {
    const cen = await criarCenario({ areas: 1 });
    const [A] = cen.areas.map((a) => a.id);
    const mudou = await criarLote(cen, { quantidade: 12, areaId: A, categoriaId: cen.boi.id, categoriaAtualId: cen.vaca.id });
    const pedido = (lote, cat) => ({ operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 12, ...cat, lote_referencia_id: lote.id, data_operacional: DATA });
    await rejeitaCom(ledger.registrarEntrada(cen.ctx, pedido(mudou, { categoria_manejo_id: cen.vaca.id })), C.ENTRADA_DIVERGENTE_DO_LOTE);
    await ledger.registrarEntrada(cen.ctx, pedido(mudou, { categoria_manejo_id: cen.boi.id }));
    const soTexto = await criarLote(cen, { quantidade: 12, areaId: A, categoriaId: null, categoriaAtualId: null, categoriaTexto: 'BOI' });
    await rejeitaCom(ledger.registrarEntrada(cen.ctx, pedido(soTexto, { sem_categoria: true })), C.ENTRADA_DIVERGENTE_DO_LOTE);
    const semNada = await criarLote(cen, { quantidade: 12, areaId: A, categoriaId: null, categoriaAtualId: null, categoriaTexto: null });
    await ledger.registrarEntrada(cen.ctx, pedido(semNada, { sem_categoria: true }));
    assert.deepEqual(await saldosPorArea(cen, CATEGORIA_SEM), { [A]: 12 });
  });

  test('origem derivada do legado e nascimento: fora do L1 (recusados, nada gravado)', async () => {
    const cen = await criarCenario({ areas: 1 });
    const [A] = cen.areas.map((a) => a.id);
    for (const [origem, classe] of [['MOVIMENTAÇÃO', 'derivado_movimento'], ['REVERSÃO MOVIMENTAÇÃO', 'derivado_reversao'], ['Mudança de Categoria', 'derivado_categoria'], ['Nascimento', 'nascimento']]) {
      const lote = await criarLote(cen, { quantidade: 7, areaId: A, origem });
      await assert.rejects(
        ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 7, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA }),
        (e) => ehErroLedger(e, C.LOTE_ORIGEM_NAO_SUPORTADA) && e.details.origem_classe === classe
      );
    }
    assert.equal(await contarEventos(cen.cliente.id), 0);
  });

  test('lote Inativo (todos saíram) ainda pode ter a entrada histórica lançada; área de entrada inativa idem', async () => {
    const cen = await criarCenario({ areas: 1 });
    const [A] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, { quantidade: 40, areaId: A, status: 'Inativo', quantidadeCabecas: 0 });
    await prisma.areaPastagem.update({ where: { id: A }, data: { ativo: false } });
    await ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 40, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
    assert.equal(await total(cen), 40);
  });
});

describe('ledger pecuário L1 — invariantes e recusas sem gravação parcial', () => {
  test('origem == destino recusada (por ID), nada gravado', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    await rejeitaCom(transferir(cen, A, A, 1), C.ORIGEM_IGUAL_DESTINO);
    assert.equal(await contarEventos(cen.cliente.id), 0);
  });

  test('saldo insuficiente recusado; saldos e contagem de eventos inalterados', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await entrar(cen, A, 10);
    const antes = await contarEventos(cen.cliente.id);
    await rejeitaCom(transferir(cen, A, B, 11), C.SALDO_INSUFICIENTE);
    assert.equal(await contarEventos(cen.cliente.id), antes);
    assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [A]: 10 });
  });

  test('categoria distinta é outra posição; categoria de outra empresa recusada; SEM_CATEGORIA explícita', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await entrar(cen, A, 100);
    await rejeitaCom(transferir(cen, A, B, 1, cen.vaca.id), C.SALDO_INSUFICIENTE);
    await entrar(cen, A, 7, null);
    assert.deepEqual(await saldosPorArea(cen, CATEGORIA_SEM), { [A]: 7 });
    const outra = await prisma.empresa.create({ data: { cliente_id: cen.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    const catOutra = await prisma.categoriaManejo.create({ data: { cliente_id: cen.cliente.id, empresa_id: outra.id, nome: 'BOI' } });
    await rejeitaCom(transferir(cen, A, B, 1, catOutra.id), C.CATEGORIA_INVALIDA);
  });

  test('tenant cruzado e empresa cruzada recusados; posições isoladas por tenant', async () => {
    const t1 = await criarCenario();
    const t2 = await criarCenario();
    const [A1, B1] = t1.areas.map((a) => a.id);
    await entrar(t1, A1, 50);
    await rejeitaCom(
      ledger.registrarTransferencia(t2.ctx, { operation_id: op(), empresa_id: t1.empresa.id, area_origem_id: A1, area_destino_id: B1, quantidade: 1, categoria_manejo_id: t1.boi.id, data_operacional: DATA }),
      C.EMPRESA_INVALIDA
    );
    assert.deepEqual(await ledger.listarPosicoes(t2.ctx, t1.empresa.id), []);
    await rejeitaCom(transferir(t1, A1, t2.areas[0].id, 1), C.DESTINO_INVALIDO);
    const outra = await prisma.empresa.create({ data: { cliente_id: t1.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    const setor2 = await prisma.setor.create({ data: { cliente_id: t1.cliente.id, empresa_id: outra.id, numero_setor: '2', nome: 'S2' } });
    const areaOutra = await prisma.areaPastagem.create({ data: { cliente_id: t1.cliente.id, empresa_id: outra.id, setor_id: setor2.id, setor_nome: 'S2', numero_area: '99', nome: 'X', tamanho_hectares: 1 } });
    await rejeitaCom(transferir(t1, A1, areaOutra.id, 1), C.DESTINO_INVALIDO);
    assert.equal(await total(t1), 50);
  });

  test('área de destino inativa recusada; origem inativa pode ser esvaziada', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await entrar(cen, A, 5);
    await prisma.areaPastagem.update({ where: { id: B }, data: { ativo: false } });
    await rejeitaCom(transferir(cen, A, B, 1), C.DESTINO_INVALIDO);
    await prisma.areaPastagem.update({ where: { id: A }, data: { ativo: false } });
    await prisma.areaPastagem.update({ where: { id: B }, data: { ativo: true } });
    await transferir(cen, A, B, 5);
    assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [B]: 5 });
  });

  test('falha simulada após o 1º débito → rollback total (sem evento, saldo, nem idempotência presa)', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    await entrar(cen, A, 20);
    const quebrado = criarLedgerPecuario({ prisma, esquema: ESQUEMA, ganchoTeste: { aposPrimeiraPartida: () => { throw new Error('falha simulada no meio'); } } });
    const chave = op();
    const pedido = { operation_id: chave, empresa_id: cen.empresa.id, area_origem_id: A, area_destino_id: B, quantidade: 8, categoria_manejo_id: cen.boi.id, data_operacional: DATA };
    const antes = await contarEventos(cen.cliente.id);
    await assert.rejects(quebrado.registrarTransferencia(cen.ctx, pedido), /falha simulada/);
    assert.equal(await contarEventos(cen.cliente.id), antes);
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 20 });
    assert.equal(await prisma.operacaoIdempotente.count({ where: { cliente_id: cen.cliente.id, operation_key: chave } }), 0);
    await ledger.registrarTransferencia(cen.ctx, pedido);
    assert.deepEqual(await saldosPorArea(cen, cat), { [A]: 12, [B]: 8 });
  });

  test('fatos são append-only no banco: UPDATE/DELETE em evento e partida falham', async () => {
    const cen = await criarCenario();
    await entrar(cen, cen.areas[0].id, 3);
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "${ESQUEMA}".ledger_pecuario_evento SET quantidade = 999 WHERE cliente_id = $1`, cen.cliente.id), /append-only/);
    await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "${ESQUEMA}".ledger_pecuario_partida WHERE cliente_id = $1`, cen.cliente.id), /append-only/);
  });

  test('esquemas fora do namespace ledger_l1_<hex> são recusados (nunca public/auth/storage…)', () => {
    for (const s of ['public', 'auth', 'storage', 'pg_catalog', 'information_schema', 'prisma', '', 'ledger_l1_', 'ledger_l1_xyz', 'x"; drop']) {
      assert.throws(() => criarLedgerPecuario({ prisma, esquema: s }), (e) => ehErroLedger(e, C.ESQUEMA_INVALIDO), s);
    }
  });
});

describe('ledger pecuário L1 — idempotência', () => {
  test('mesma operation_id + mesmo payload = replay do resultado gravado (1 evento só)', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, { quantidade: 40, areaId: A });
    const pedido = { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 40, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA };
    const r1 = await ledger.registrarEntrada(cen.ctx, pedido);
    const r2 = await ledger.registrarEntrada(cen.ctx, { ...pedido });
    assert.equal(r1.replay, false);
    assert.equal(r2.replay, true);
    assert.equal(r2.evento.id, r1.evento.id);
    assert.equal(await contarEventos(cen.cliente.id), 1);
    const idem = await prisma.operacaoIdempotente.findFirst({ where: { cliente_id: cen.cliente.id, operation_key: pedido.operation_id } });
    assert.equal(idem.tipo_operacao, TIPO_OPERACAO_IDEMPOTENTE);
    assert.equal(idem.status, 'committed');
  });

  test('mesma operation_id + payload diferente (ou outro comando) = conflito, nada gravado', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, { quantidade: 40, areaId: A });
    const chave = op();
    const base = { operation_id: chave, empresa_id: cen.empresa.id, area_id: A, quantidade: 40, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA };
    await ledger.registrarEntrada(cen.ctx, base);
    await rejeitaCom(ledger.registrarEntrada(cen.ctx, { ...base, motivo: 'outro' }), C.IDEMPOTENCIA_CONFLITO);
    await rejeitaCom(transferir(cen, A, B, 1, cen.boi.id, { operation_id: chave }), C.IDEMPOTENCIA_CONFLITO);
    assert.equal(await contarEventos(cen.cliente.id), 1);
    assert.equal(await total(cen), 40);
  });

  test('mesma operation_id disparada em paralelo: um grava, o outro devolve replay', async () => {
    const cen = await criarCenario();
    const [A] = cen.areas.map((a) => a.id);
    const lote = await criarLote(cen, { quantidade: 9, areaId: A });
    const pedido = { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 9, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA };
    const rs = await Promise.allSettled([ledger.registrarEntrada(cen.ctx, pedido), ledger.registrarEntrada(cen.ctx, { ...pedido })]);
    const ok = rs.filter((r) => r.status === 'fulfilled').map((r) => /** @type {any} */ (r).value);
    const falhas = rs.filter((r) => r.status === 'rejected').map((r) => /** @type {any} */ (r).reason?.code);
    assert.equal(ok.filter((r) => r.replay === false).length, 1, JSON.stringify({ ok: ok.map((r) => r.replay), falhas }));
    for (const f of falhas) assert.ok([C.IDEMPOTENCIA_EM_PROCESSAMENTO, C.CONCORRENCIA_ESGOTADA].includes(f), `falha inesperada: ${f}`);
    assert.equal(await contarEventos(cen.cliente.id), 1);
    assert.equal(await total(cen), 9);
  });
});

describe('ledger pecuário L1 — concorrência de saldo', () => {
  test('duas saídas concorrentes pelo mesmo saldo: só uma passa, nunca negativo (10 rodadas)', async () => {
    const cen = await criarCenario();
    const [A, B, C2] = cen.areas.map((a) => a.id);
    const cat = `cm:${cen.boi.id}`;
    for (let rodada = 0; rodada < 10; rodada += 1) {
      await entrar(cen, A, 100);
      const antesA = (await saldosPorArea(cen, cat))[A];
      const rs = await Promise.allSettled([transferir(cen, A, B, antesA - 30), transferir(cen, A, C2, antesA - 30)]);
      assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1, `rodada ${rodada}`);
      assert.equal(rs.filter((r) => r.status === 'rejected' && ehErroLedger(/** @type {any} */ (r).reason, C.SALDO_INSUFICIENTE)).length, 1, `rodada ${rodada}`);
      assert.equal((await saldosPorArea(cen, cat))[A], 30);
    }
    assert.equal(await total(cen), 1000);
    await assertProjecaoConsistente(cen);
  });

  test('A→B e B→A concorrentes não entram em deadlock (trava em ordem determinística)', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await entrar(cen, A, 500);
    await entrar(cen, B, 500);
    const lances = [];
    for (let i = 0; i < 8; i += 1) lances.push(i % 2 === 0 ? transferir(cen, A, B, 10) : transferir(cen, B, A, 10));
    const rs = await Promise.allSettled(lances);
    assert.equal(rs.filter((r) => r.status === 'rejected').length, 0);
    assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [A]: 500, [B]: 500 });
    await assertProjecaoConsistente(cen);
  });
});

describe('ledger pecuário L1 — estorno append-only', () => {
  test('estorno de transferência devolve saldos; original preservado; 2º estorno e estorno de estorno recusados', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    await entrar(cen, A, 100);
    const t = await transferir(cen, A, B, 60);
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: t.evento.id, data_operacional: DATA }), C.ESTORNO_INVALIDO);
    const e = await ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: t.evento.id, motivo: 'lançado errado', data_operacional: DATA });
    assert.equal(e.evento.tipo, 'ESTORNO');
    assert.equal(e.evento.estorno_de_evento_id, t.evento.id);
    assert.deepEqual(await saldosPorArea(cen, `cm:${cen.boi.id}`), { [A]: 100 });
    assert.equal(await contarEventos(cen.cliente.id), 3);
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: t.evento.id, motivo: 'de novo', data_operacional: DATA }), C.ESTORNO_DUPLICADO);
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: e.evento.id, motivo: 'x', data_operacional: DATA }), C.ESTORNO_INVALIDO);
    await assertProjecaoConsistente(cen);
  });

  test('estorno de entrada exige saldo; depois de estornada, o MESMO lote pode ser relançado (1 entrada ativa)', async () => {
    const cen = await criarCenario();
    const [A, B] = cen.areas.map((a) => a.id);
    const { lote, r: ent } = await entrar(cen, A, 30);
    const relancar = () => ledger.registrarEntrada(cen.ctx, { operation_id: op(), empresa_id: cen.empresa.id, area_id: A, quantidade: 30, categoria_manejo_id: cen.boi.id, lote_referencia_id: lote.id, data_operacional: DATA });
    await rejeitaCom(relancar(), C.LOTE_REFERENCIA_INVALIDO);
    await transferir(cen, A, B, 20);
    await rejeitaCom(ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: ent.evento.id, motivo: 'compra cancelada', data_operacional: DATA }), C.SALDO_INSUFICIENTE);
    await transferir(cen, B, A, 20);
    await ledger.registrarEstorno(cen.ctx, { operation_id: op(), evento_id: ent.evento.id, motivo: 'compra cancelada', data_operacional: DATA });
    assert.equal(await total(cen), 0);
    await relancar();
    assert.equal(await total(cen), 30);
    await assertProjecaoConsistente(cen);
  });

  test('estorno de evento de outro tenant: não encontrado', async () => {
    const t1 = await criarCenario();
    const t2 = await criarCenario();
    const { r: e } = await entrar(t1, t1.areas[0].id, 5);
    await rejeitaCom(ledger.registrarEstorno(t2.ctx, { operation_id: op(), evento_id: e.evento.id, motivo: 'x', data_operacional: DATA }), C.EVENTO_NAO_ENCONTRADO);
    assert.equal(await total(t1), 5);
  });
});
