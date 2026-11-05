/**
 * PR174-R5 (D-PROD-107) — riscos dos comandos R2B (Nascimento, Pesagem,
 * Mudança de Categoria), R2C (Junção) e R2D (Baixa multi-lote) convertidos do
 * motor legado (que escrevia saldo em Lote) para o ledger de posições.
 *
 * Por comando: atomicidade sob falha injetada, idempotência (replay e
 * conflito), concorrência real, validação multi-linha "tudo ou nada", tenant
 * e empresa, permissão de registrar, filtro e política determinística da
 * baixa, histórico por qualquer participante e a regra #167 (participante de
 * fato ativo não sai do Cadastro; cancelado o fato, exclusão lógica).
 * Cada prova confere o BANCO; Lote (cadastro de entrada) nunca muda.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';
import { distribuirBaixa, ordemDeAlocacao } from '../src/modules/movimentacoesMapa/manejoBaixaComandoService.js';

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
  definirFalhaInjetadaLedger(null);
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  definirFalhaInjetadaLedger(null);
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';
const GARROTE = 'Garrote 13 a 24 meses';
const VACA = 'Vaca + 36 meses';
const NOVILHA = 'Novilha 13 a 24 meses';

/** Empresa com bois (2 entradas), vacas e novilhas em A; ativada pelas entradas. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const comum = await p.usuario.create({
    data: {
      cliente_id: adm.cliente.id, nome: 'Comum', login: `comum-${randomUUID().slice(0, 8)}`,
      senha_hash: (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash, papel_tenant: 'usuario',
    },
  });
  // Operador com permissão de manejo concedida (Permissões → acesso total às telas).
  await p.permissao.create({ data: { cliente_id: adm.cliente.id, user_email: comum.login, user_nome: 'Comum', is_admin: true } });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tok, tokComum, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  c.bois1 = await entrada(c, { nome: 'BOIS 1', qtd: 40, peso: 400 });
  c.bois2 = await entrada(c, { nome: 'BOIS 2', qtd: 30, peso: 420 });
  c.vacas = await entrada(c, { nome: 'VACAS', qtd: 20, categoria: VACA, sexo: 'Fêmea', peso: 450 });
  c.garrotes = await entrada(c, { nome: 'GARROTES', qtd: 50, categoria: GARROTE, peso: 300 });
  const a = await req('POST', '/rebanho/ativacao', tok, { operation_id: opId(), empresa_id: empresa.id, modo: 'entradas' });
  assert.equal(a.statusCode, 201, a.body);
  return c;
};
const entrada = async (c, { nome, qtd, area = c.A, categoria = BOI, sexo = 'Macho', peso = 400 }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens;
const pos = async (c, lote, area = c.A, categoria = null) =>
  (await posicoes(c)).find((p) => p.lote_entrada_id === lote.id && p.area_atual_id === area.id && (!categoria || p.categoria === categoria));
const total = async (c) => (await posicoes(c)).reduce((t, p) => t + p.quantidade_cabecas, 0);
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const foto = async (c) => {
  const p = prisma();
  const w = { cliente_id: c.cliente.id };
  return {
    lotes: (await p.lote.findMany({ where: w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.status, l.area_atual_id, l.categoria, l.peso_medio_kg === null ? null : Number(l.peso_medio_kg), l.excluido_em ? 'X' : '-']),
    posicoes: (await p.posicaoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg), JSON.stringify(x.linhagem)]),
    eventos: await p.eventoRebanho.count({ where: w }),
    partidas: await p.partidaRebanho.count({ where: w }),
    pesos: await p.pesoRebanho.count({ where: w }),
    movs: await p.movimentacaoMapa.count({ where: w }),
    audits: await p.auditLog.count({ where: w }),
    ops: await p.operacaoIdempotente.count({ where: w }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await foto(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await foto(c), antes, 'nada pode ser gravado');
  return r;
};
const cancelar = (c, movId, token = c.tok) => req('POST', `/movimentacoes-mapa/${movId}/cancelamento`, token, { operation_id: opId(), motivo: 'teste do ledger' });
const rebanho = (c, tipo, linhas, extra = {}, token = c.tok) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', token, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const baixa = (c, tipo, linhas, extra = {}, token = c.tok) =>
  req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', token, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const juntar = (c, principal, origens, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: '2026-11-02', ...extra });
const morteBoi = (q) => [{ categoria: BOI, quantidade: q, causa_morte: 'Doença' }];

/** Um corpo válido de cada comando (url + corpo), relido do cenário. */
const comandos = async (c) => {
  const [b1, b2, g] = [await pos(c, c.bois1), await pos(c, c.bois2), await pos(c, c.garrotes)];
  const base = { empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02' };
  return {
    nascimento: ['/movimentacoes-mapa/comandos/manejo-rebanho', { ...base, tipo: 'Nascimento', linhas: [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 3, peso_medio_kg: 30 }, { categoria_mae: VACA, sexo: 'Fêmea', quantidade: 2 }] }],
    pesagem: ['/movimentacoes-mapa/comandos/manejo-rebanho', { ...base, tipo: 'Pesagem', linhas: [{ lote_id: b1.id, peso_medio_kg: 410 }, { lote_id: b2.id, peso_medio_kg: 430 }, { lote_id: g.id, peso_medio_kg: 310 }] }],
    mudanca: ['/movimentacoes-mapa/comandos/manejo-rebanho', { ...base, tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20 }, { categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 10 }] }],
    juncao: ['/movimentacoes-mapa/comandos/juncao-lotes', { ...base, lote_principal_id: b1.id, lote_origem_ids: [b2.id] }],
    baixa: ['/movimentacoes-mapa/comandos/baixa-rebanho', { ...base, tipo: 'Morte', linhas: [...morteBoi(45), { categoria: GARROTE, quantidade: 5, causa_morte: 'Predador' }] }],
  };
};

describe('R5 conv. — atomicidade e idempotência de cada comando', () => {
  test('A1: falha injetada (após validar, após 1ª partida, antes da auditoria) em nascimento, pesagem, mudança, junção e baixa multi-linha → 500 e ZERO mudança (inclusive reserva idempotente); retry da mesma chave conclui', async () => {
    const c = await cenario();
    for (const [nome, [url, corpo]] of Object.entries(await comandos(c))) {
      const body = { ...corpo, operation_id: opId() };
      for (const passo of ['apos_primeira_partida', 'apos_validar_manejo', 'antes_auditoria_manejo']) {
        definirFalhaInjetadaLedger(passo);
        try {
          await exigirNadaGravado(c, () => req('POST', url, c.tok, body), 500);
        } finally {
          definirFalhaInjetadaLedger(null);
        }
      }
      const r = await req('POST', url, c.tok, body);
      assert.equal(r.statusCode, 201, `${nome}: ${r.body}`);
      // Desfaz para o próximo comando partir do mesmo estado.
      assert.equal((await cancelar(c, r.json().movimentacao.id)).statusCode, 200, nome);
    }
    assert.equal(await total(c), 140);
  });

  test('A2: replay da mesma chave → mesma resposta e UM efeito; mesma chave com conteúdo diferente → 409 IDEMPOTENCY_CONFLICT; recusa de negócio não reserva a chave', async () => {
    const c = await cenario();
    for (const [nome, [url, corpo]] of Object.entries(await comandos(c))) {
      const body = { ...corpo, operation_id: opId() };
      const r1 = await ok(req('POST', url, c.tok, body));
      const antes = await foto(c);
      const r2 = await ok(req('POST', url, c.tok, body));
      assert.equal(r2.replay, true, nome);
      assert.equal(r2.movimentacao.id, r1.movimentacao.id, nome);
      assert.deepEqual(await foto(c), antes, `${nome}: replay não grava`);
      await exigirNadaGravado(c, () => req('POST', url, c.tok, { ...body, observacoes: 'outro conteúdo' }), 409, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await cancelar(c, r1.movimentacao.id)).statusCode, 200, nome);
    }
    // Recusa de negócio (saldo) não reserva: o mesmo pedido continua recusado, nunca vira replay.
    const corpo = { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: morteBoi(500) };
    for (let i = 0; i < 2; i += 1) await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, corpo), 409, 'BAIXA_SALDO_INSUFICIENTE');
  });

  test('A3: tudo ou nada multi-linha — 2ª linha inválida (mãe inexistente; saldo disputado entre linhas; categoria sem posição) → 409 e NADA gravado', async () => {
    const c = await cenario();
    await exigirNadaGravado(c, () => rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 3 }, { categoria_mae: NOVILHA, sexo: 'Fêmea', quantidade: 2 }]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 30 }, { categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 30 }]), 409, 'MANEJO_SALDO_INSUFICIENTE');
    await exigirNadaGravado(c, () => baixa(c, 'Morte', [...morteBoi(5), { categoria: NOVILHA, quantidade: 1, causa_morte: 'Doença' }]), 409, 'BAIXA_SALDO_INSUFICIENTE');
    const [b1, v] = [await pos(c, c.bois1), await pos(c, c.vacas)];
    await exigirNadaGravado(c, () => rebanho(c, 'Pesagem', [{ lote_id: b1.id, peso_medio_kg: 410 }, { lote_id: 'nao-existe', peso_medio_kg: 400 }]), 404);
    await exigirNadaGravado(c, () => juntar(c, b1, [v]), 409, 'JUNCAO_CLASSIFICACAO_DIVERGENTE');
  });

  test('A4: contrato de forma → 400 antes de qualquer gravação (sexo, quantidade, peso, data impossível, linhas vazias, campo reservado, principal entre origens)', async () => {
    const c = await cenario();
    const b1 = await pos(c, c.bois1);
    const casos = [
      rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'X', quantidade: 1 }]),
      rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 0 }]),
      rebanho(c, 'Pesagem', [{ lote_id: b1.id, peso_medio_kg: -1 }]),
      rebanho(c, 'Pesagem', [{ lote_id: b1.id, peso_medio_kg: 400 }], { data_movimentacao: '2026-02-30' }),
      rebanho(c, 'Nascimento', []),
      baixa(c, 'Morte', [{ categoria: BOI, quantidade: 1 }]),
      baixa(c, 'Morte', morteBoi(1), { efeito_servidor: { comando: 'x' } }),
      juntar(c, b1, [b1]),
    ];
    for (const r of casos) await exigirNadaGravado(c, () => r, 400);
  });
});

describe('R5 conv. — tenant, empresa e permissão', () => {
  test('T1: área de outra empresa do mesmo tenant, área inexistente e posição de outro tenant → 404 sem gravar, em cada comando', async () => {
    const c = await cenario();
    const outro = await cenario();
    const outra = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'OUT', nome: 'Outra' } });
    const s2 = await prisma().setor.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, numero_setor: '9', nome: 'S9' } });
    const alheia = await prisma().areaPastagem.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, setor_id: s2.id, setor_nome: 'S9', numero_area: '9', nome: 'ALHEIA', tamanho_hectares: 1 } });
    const pOutro = await pos(outro, outro.bois1, outro.A);
    for (const [, [url, corpo]] of Object.entries(await comandos(c))) {
      for (const areaId of [alheia.id, 'area-inexistente']) {
        await exigirNadaGravado(c, () => req('POST', url, c.tok, { ...corpo, operation_id: opId(), area_id: areaId }), 404);
      }
    }
    await exigirNadaGravado(c, () => rebanho(c, 'Pesagem', [{ lote_id: pOutro.id, peso_medio_kg: 400 }]), 404);
    const pb2 = await pos(c, c.bois2);
    await exigirNadaGravado(c, () => juntar(c, { id: pOutro.id }, [pb2]), 404);
    await exigirNadaGravado(c, () => baixa(c, 'Morte', morteBoi(1), { lotes_selecionados: [pOutro.id] }), 404);
    assert.equal((await pos(outro, outro.bois1, outro.A)).quantidade_cabecas, 40, 'outro tenant intacto');
  });

  test('T2: usuário comum registra manejo (permissão de manejo); só administrador cancela; sem token → 401', async () => {
    const c = await cenario();
    const m = await ok(baixa(c, 'Morte', morteBoi(2), {}, c.tokComum));
    const p = await ok(rebanho(c, 'Pesagem', [{ lote_id: (await pos(c, c.bois1)).id, peso_medio_kg: 405 }], {}, c.tokComum));
    for (const id of [m.movimentacao.id, p.movimentacao.id]) await exigirNadaGravado(c, () => cancelar(c, id, c.tokComum), 403, 'TENANT_ADMIN_REQUIRED');
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', null, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: morteBoi(1) }), 401);
    assert.equal((await cancelar(c, p.movimentacao.id)).statusCode, 200);
    assert.equal((await cancelar(c, m.movimentacao.id)).statusCode, 200);
  });
});

describe('R5 conv. — baixa: alocação determinística, filtro e metadados', () => {
  test('B1: 45 bois em duas posições (40 + 30) → política numero_lote crescente; saldo insuficiente informa o disponível; metadados do abate são TOTAIS da linha', async () => {
    const c = await cenario();
    const [b1, b2] = [await pos(c, c.bois1), await pos(c, c.bois2)];
    const m = await ok(baixa(c, 'Morte', morteBoi(45)));
    const primeiro = [b1, b2].sort((x, y) => Number(x.numero_lote) - Number(y.numero_lote))[0];
    const segundo = primeiro.id === b1.id ? b2 : b1;
    assert.equal(m.movimentacao.baixa.politica_alocacao, 'numero_lote_crescente_depois_id');
    assert.deepEqual(m.movimentacao.linhas[0].distribuicao.map((d) => [d.posicao_id, d.quantidade]), [[primeiro.id, primeiro.quantidade_cabecas], [segundo.id, 45 - primeiro.quantidade_cabecas]]);
    const r = await exigirNadaGravado(c, () => baixa(c, 'Morte', morteBoi(26)), 409, 'BAIXA_SALDO_INSUFICIENTE');
    assert.deepEqual([r.json().details.disponivel, r.json().details.pedido], [25, 26]);
    const ab = await ok(baixa(c, 'Abate', [{ categoria: GARROTE, quantidade: 10, peso_vivo_total_kg: 3000, peso_carcaca_total_kg: 1600, destino: 'Frigorífico', destino_nome: 'frigo x' }]));
    assert.deepEqual([ab.movimentacao.linhas[0].peso_vivo_total_kg, ab.movimentacao.linhas[0].destino_nome], [3000, 'FRIGO X']);
    assert.equal(Number((await pos(c, c.garrotes)).peso_medio_kg), 300, 'peso médio da posição não muda com o abate');
    assert.equal(await total(c), 140 - 45 - 10);
  });

  test('B2: lotes_selecionados é só FILTRO (posição fora da seleção não é baixada); mesma categoria em duas linhas baixa cada posição uma vez; sexo contrário → 409 BAIXA_CLASSIFICACAO_DIVERGENTE', async () => {
    const c = await cenario();
    const [b1, b2] = [await pos(c, c.bois1), await pos(c, c.bois2)];
    await exigirNadaGravado(c, () => baixa(c, 'Morte', morteBoi(31), { lotes_selecionados: [b2.id] }), 409, 'BAIXA_SALDO_INSUFICIENTE');
    const m = await ok(baixa(c, 'Morte', [{ categoria: BOI, quantidade: 3, causa_morte: 'Doença' }, { categoria: BOI, quantidade: 2, causa_morte: 'Predador' }], { lotes_selecionados: [b2.id] }));
    assert.deepEqual(m.movimentacao.baixa.lotes.map((l) => [l.posicao_id, l.quantidade]), [[b2.id, 5]]);
    assert.deepEqual([(await pos(c, c.bois1)).quantidade_cabecas, (await pos(c, c.bois2)).quantidade_cabecas], [b1.quantidade_cabecas, 25]);
    // Fêmea classificada numa categoria oficial masculina: a baixa por categoria recusa às cegas.
    const r = await req('POST', '/lotes', c.tok, {
      empresa_id: c.empresa.id, nome: 'ERRADO', quantidade_cabecas: 5, categoria: BOI, sexo: 'Fêmea', setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id,
      data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo',
    });
    assert.equal(r.statusCode, 201, r.body);
    await exigirNadaGravado(c, () => baixa(c, 'Morte', morteBoi(1)), 409, 'BAIXA_CLASSIFICACAO_DIVERGENTE');
  });
});

describe('R5 conv. — regras de cada comando sobre posições', () => {
  test('R1: política determinística pura (usada pela baixa do ledger) — numero_lote crescente (numérico antes de texto/vazio), depois id; independe da ordem de criação', () => {
    const itens = [
      { id: 'c', numero_lote: '10', categoria: BOI, quantidade_cabecas: 5 },
      { id: 'b', numero_lote: '2', categoria: BOI, quantidade_cabecas: 5 },
      { id: 'a', numero_lote: 'X1', categoria: BOI, quantidade_cabecas: 5 },
      { id: 'd', numero_lote: null, categoria: BOI, quantidade_cabecas: 5 },
      { id: 'e', numero_lote: '2', categoria: BOI, quantidade_cabecas: 5 },
    ];
    assert.deepEqual([...itens].sort(ordemDeAlocacao).map((l) => l.id), ['b', 'e', 'c', 'd', 'a']);
    const [linha] = distribuirBaixa(itens, [{ categoria: BOI, quantidade: 12 }]);
    assert.deepEqual(linha.distribuicao, [{ lote_id: 'b', quantidade: 5 }, { lote_id: 'e', quantidade: 5 }, { lote_id: 'c', quantidade: 2 }]);
  });

  test('R2: nascimento — duas linhas do mesmo sexo vão para a MESMA posição de nascidos; peso ponderado só com todos os pesos conhecidos (desconhecido nunca vale zero)', async () => {
    const c = await cenario();
    await ok(rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 20, peso_medio_kg: 100 }, { categoria_mae: VACA, sexo: 'Macho', quantidade: 10, peso_medio_kg: 40 }]));
    const nascidos = () => posicoes(c).then((ps) => ps.filter((p) => !p.lote_entrada_id && p.sexo === 'Macho'));
    let ps = await nascidos();
    assert.equal(ps.length, 1);
    assert.deepEqual([ps[0].quantidade_cabecas, Number(ps[0].peso_medio_kg)], [30, 80]);
    await ok(rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 5 }], { data_movimentacao: '2026-11-03' }));
    ps = await nascidos();
    assert.equal(ps.length, 1);
    assert.equal(ps[0].quantidade_cabecas, 35);
    assert.ok(ps[0].peso_medio_kg === null || Number(ps[0].peso_medio_kg) === 80, `peso desconhecido nunca vira zero na média: ${ps[0].peso_medio_kg}`);
  });

  test('R3: pesagem muda peso e nunca cabeças; categoria informada divergente da posição → 409; posição de outra área → 404; nada gravado', async () => {
    const c = await cenario();
    const b1 = await pos(c, c.bois1);
    await exigirNadaGravado(c, () => rebanho(c, 'Pesagem', [{ lote_id: b1.id, categoria: VACA, peso_medio_kg: 410 }]), 409, 'MANEJO_ESTADO_INVALIDO');
    await exigirNadaGravado(c, () => rebanho(c, 'Pesagem', [{ lote_id: b1.id, peso_medio_kg: 410 }], { area_id: c.B.id }), 404);
    await ok(rebanho(c, 'Pesagem', [{ lote_id: b1.id, categoria: BOI, peso_medio_kg: 412 }]));
    const depois = await pos(c, c.bois1);
    assert.deepEqual([depois.quantidade_cabecas, Number(depois.peso_medio_kg)], [40, 412]);
  });

  test('R4: mudança de categoria — uma linha de 70 sobre duas posições (40 + 30) conserva 70; categoria de manejo de outra categoria oficial → 409 MANEJO_CATEGORIA_INVALIDA; duas ativas da mesma oficial sem escolha → 409 MANEJO_CATEGORIA_AMBIGUA', async () => {
    const c = await cenario();
    const cm = (nome, oficial) => prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome, categoria_oficial: oficial, ativo: true } });
    const deGarrote = await cm('GARROTE X', GARROTE);
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 5, categoria_manejo_id_novo: deGarrote.id }]), 409, 'MANEJO_CATEGORIA_INVALIDA');
    await cm('TOURO A', 'Touro + 36 meses');
    await cm('TOURO B', 'Touro + 36 meses');
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 5 }]), 409, 'MANEJO_CATEGORIA_AMBIGUA');
    await prisma().categoriaManejo.updateMany({ where: { cliente_id: c.cliente.id, nome: { in: ['TOURO A', 'TOURO B'] } }, data: { ativo: false } });
    const m = await ok(rebanho(c, 'Mudança de Categoria', [{ categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 70 }]));
    assert.equal(m.movimentacao.linhas[0].partes.reduce((t, p) => t + p.quantidade, 0), 70);
    assert.equal(new Set(m.movimentacao.linhas[0].partes.map((p) => p.de_posicao_id)).size, 2);
    const ps = await posicoes(c);
    assert.equal(ps.filter((p) => p.categoria === BOI).reduce((t, p) => t + p.quantidade_cabecas, 0), 0);
    assert.equal(ps.filter((p) => p.categoria === 'Touro + 36 meses').reduce((t, p) => t + p.quantidade_cabecas, 0), 70);
    assert.equal(await total(c), 140);
  });

  test('R5: junção — posição zerada, de entrada excluída ou de outra área → recusa estável (JUNCAO_LOTE_INELEGIVEL), nada gravado', async () => {
    const c = await cenario();
    const [b1, b2] = [await pos(c, c.bois1), await pos(c, c.bois2)];
    await ok(baixa(c, 'Morte', morteBoi(30), { lotes_selecionados: [b2.id] }));
    await exigirNadaGravado(c, () => juntar(c, b1, [b2]), 409, 'JUNCAO_LOTE_INELEGIVEL');
    const outraArea = await entrada(c, { nome: 'BOIS B', qtd: 10, area: c.B });
    await exigirNadaGravado(c, () => pos(c, outraArea, c.B).then((pb) => juntar(c, b1, [pb])), 409, 'JUNCAO_LOTE_INELEGIVEL');
    const excl = await entrada(c, { nome: 'BOIS EXCL', qtd: 10 });
    const pe = await pos(c, excl);
    assert.equal((await req('DELETE', `/lotes/${excl.id}`, c.tok)).statusCode, 204);
    await exigirNadaGravado(c, () => juntar(c, b1, [pe]), 409, 'JUNCAO_LOTE_INELEGIVEL');
  });
});

describe('R5 conv. — concorrência real (3 rodadas)', () => {
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`K1.${rodada}: mesma chave em paralelo (nascimento, pesagem, baixa) → um efeito; nascimentos DISTINTOS em paralelo → os dois contados na mesma posição de nascidos`, async () => {
      const c = await cenario();
      const cmds = await comandos(c);
      for (const nome of ['nascimento', 'pesagem', 'baixa']) {
        const [url, corpo] = cmds[nome];
        const body = { ...corpo, operation_id: opId() };
        const rs = await Promise.all([req('POST', url, c.tok, body), req('POST', url, c.tok, body)]);
        assert.ok(rs.every((r) => [201, 409].includes(r.statusCode)), rs.map((r) => r.body).join(' / '));
        assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, operation_id: body.operation_id } }), 1, nome);
      }
      const antes = await total(c);
      const [n1, n2] = await Promise.all([
        rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 2 }]),
        rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 4 }]),
      ]);
      assert.deepEqual([n1.statusCode, n2.statusCode], [201, 201], `${n1.body} / ${n2.body}`);
      assert.equal(await total(c), antes + 6);
      const nascidos = (await posicoes(c)).filter((p) => p.origem === 'nascimento' || (Array.isArray(p.linhagem) && p.linhagem[0]?.classe === 'nascimento'));
      assert.equal(nascidos.filter((p) => p.sexo === 'Macho').length, 1, 'uma posição de nascidos machos na área');
    });

    test(`K2.${rodada}: mudanças competindo pelo mesmo saldo (50 + 50 de 50); baixas 70 + 70 de 120; junções com origem compartilhada → uma aceita, a outra 409; conservação, sem 500`, async () => {
      const c = await cenario();
      const [m1, m2] = await Promise.all([
        rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 50 }]),
        rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 50 }]),
      ]);
      assert.deepEqual([m1.statusCode, m2.statusCode].sort(), [201, 409], `${m1.body} / ${m2.body}`);
      assert.equal(await total(c), 140);
      const [b1, b2] = await Promise.all([baixa(c, 'Morte', morteBoi(70)), baixa(c, 'Morte', morteBoi(70))]);
      assert.deepEqual([b1.statusCode, b2.statusCode].sort(), [201, 409], `${b1.body} / ${b2.body}`);
      assert.equal(await total(c), 70);
      const c2 = await cenario();
      const [p1, p2, g] = [await pos(c2, c2.bois1), await pos(c2, c2.bois2), await pos(c2, c2.garrotes)];
      const [j1, j2] = await Promise.all([juntar(c2, p1, [p2]), juntar(c2, g, [p2])]);
      assert.ok(![j1.statusCode, j2.statusCode].includes(500), `${j1.body} / ${j2.body}`);
      assert.ok(!(j1.statusCode === 201 && j2.statusCode === 201), 'a mesma origem não é absorvida duas vezes');
      assert.equal(await total(c2), 140);
    });

    test(`K3.${rodada}: cancelar pesagem × nova pesagem posterior em paralelo; dois cancelamentos simultâneos da baixa → nunca reverte por cima, reversão única`, async () => {
      const c = await cenario();
      const b1 = await pos(c, c.bois1);
      const p = await ok(rebanho(c, 'Pesagem', [{ lote_id: b1.id, peso_medio_kg: 410 }]));
      const [rc, rp] = await Promise.all([cancelar(c, p.movimentacao.id), rebanho(c, 'Pesagem', [{ lote_id: b1.id, peso_medio_kg: 420 }], { data_movimentacao: '2026-11-03' })]);
      assert.ok(![rc.statusCode, rp.statusCode].includes(500), `${rc.body} / ${rp.body}`);
      if (rp.statusCode === 201) assert.equal(Number((await pos(c, c.bois1)).peso_medio_kg), 420, 'a pesagem nova nunca é revertida pelo cancelamento');
      const m = await ok(baixa(c, 'Morte', morteBoi(10)));
      const rs = await Promise.all([cancelar(c, m.movimentacao.id), cancelar(c, m.movimentacao.id)]);
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' / '));
      assert.equal(await total(c), 140);
    });
  }
});

describe('R5 conv. — histórico e exclusão do Cadastro (#167)', () => {
  test('H1: histórico pela ENTRADA e pela área acha o movimento agregado (baixa multi-posição, junção) por QUALQUER participante; não-participante não', async () => {
    const c = await cenario();
    const [b1, b2] = [await pos(c, c.bois1), await pos(c, c.bois2)];
    const m = await ok(baixa(c, 'Morte', [...morteBoi(5), { categoria: GARROTE, quantidade: 5, causa_morte: 'Doença' }]));
    const j = await ok(juntar(c, b1, [b2], { data_movimentacao: '2026-11-03' }));
    const hist = async (filtro) => (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&${filtro}&limit=50`, c.tok)).json().items.map((x) => x.id);
    for (const [filtro, esperados] of [[`lote_ids=${c.bois1.id}`, [m, j]], [`lote_ids=${c.garrotes.id}`, [m]], [`lote_ids=${c.bois2.id}`, [j]], [`lote_ids=${b2.id}`, [j]], [`area_id=${c.A.id}`, [m, j]]]) {
      const ids = await hist(filtro);
      assert.ok(esperados.every((x) => ids.includes(x.movimentacao.id)), `${filtro}: ${JSON.stringify(ids)}`);
    }
    const ids = await hist(`lote_ids=${c.vacas.id}`);
    assert.ok(!ids.includes(m.movimentacao.id) && !ids.includes(j.movimentacao.id), 'vacas não participaram');
  });

  test('H2: #167 — participante de pesagem, mudança, junção ou baixa ATIVA não sai do Cadastro; cancelado o fato, sai por exclusão lógica (histórico preservado)', async () => {
    const c = await cenario();
    const eleg = async (lote) => (await req('GET', `/lotes/${lote.id}/elegibilidade-exclusao`, c.tok)).json();
    const casos = [
      [c.bois1, async () => ok(rebanho(c, 'Pesagem', [{ lote_id: (await pos(c, c.bois1)).id, peso_medio_kg: 410 }]))],
      [c.garrotes, async () => ok(rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 10 }]))],
      [c.bois2, async () => ok(juntar(c, await pos(c, c.bois1), [await pos(c, c.bois2)]))],
    ];
    for (const [lote, fazer] of casos) {
      const m = await fazer();
      assert.deepEqual([(await eleg(lote)).tipo, (await eleg(lote)).motivo], ['bloqueado', 'movimentacao_ativa'], lote.nome);
      const d = await req('DELETE', `/lotes/${lote.id}`, c.tok);
      assert.equal(d.statusCode, 409, d.body);
      assert.equal((await cancelar(c, m.movimentacao.id)).statusCode, 200, lote.nome);
    }
    const m = await ok(baixa(c, 'Morte', morteBoi(45)));
    assert.equal((await eleg(c.bois2)).tipo, 'bloqueado', 'participante da baixa');
    assert.equal((await cancelar(c, m.movimentacao.id)).statusCode, 200);
    for (const lote of [c.bois1, c.bois2, c.garrotes]) {
      assert.equal((await eleg(lote)).tipo, 'exclusao_logica', lote.nome);
      assert.equal((await req('DELETE', `/lotes/${lote.id}`, c.tok)).statusCode, 204, lote.nome);
      assert.ok((await prisma().lote.findUnique({ where: { id: lote.id } })).excluido_em, lote.nome);
    }
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id, dados: { path: ['situacao'], equals: 'cancelado' } } }), 4, 'histórico cancelado preservado');
  });
});
