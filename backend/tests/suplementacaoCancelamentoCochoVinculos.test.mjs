/**
 * D-PROD-268 — o cancelamento do lançamento de cocho visto pelos OUTROS módulos que leem o rateio
 * e os recibos dele. PostgreSQL real + HTTP autenticado.
 *
 *  V1. ledger do rebanho: a transferência cuja posição nova é citada só pelo rateio de N fica
 *      bloqueada (REBANHO_CANCELAMENTO_VINCULO_POSTERIOR); cancelado N, o rateio cancelado deixa de
 *      contar (FONTES_JSON_CAUSAIS filtra `situacao = 'cancelado'`) e a transferência cancela;
 *  V2. financeiro: a compra cuja camada foi baixada pelo cocho continua com a exclusão bloqueada
 *      depois do cancelamento (a baixa e o recibo `saida_suplementacao` seguem 'committed').
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { acoes, docCom, montarTenant } from './gestaoP3Cenario.mjs';

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

const req = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const op = (p = 'op') => `${p}-${randomUUID()}`;
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
const cancelarCocho = (token, empresaId, id) =>
  req('POST', `/suplementacao-eventos/${id}/cancelamento`, token, { empresa_id: empresaId, operation_id: op('canc'), motivo: 'lançado por engano' });

/** Lançamento do cocho como o formulário (baixa opcional com a MESMA chave + comando). */
const lancarCocho = async (token, { empresaId, ponto, data, kg, areaId, loteId, saida = null }) => {
  const chave = op('lanc');
  let movimentacao = null;
  if (saida) {
    movimentacao = ok(await req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', token, {
      operation_id: chave, empresa_id: empresaId, produto_id: saida.produtoId, local_origem_id: saida.localId, quantidade: kg, ponto_suplementacao_id: ponto, data_movimentacao: data,
    }), 201).movimentacao;
  }
  const r = ok(await req('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', token, {
    operation_id: chave,
    evento: {
      empresa_id: empresaId, ponto_suplementacao_id: ponto, ponto_nome: 'Cocho 1', area_id: areaId, area_ids: [areaId], data_lancamento: data,
      produto: 'Sal', produto_id: saida?.produtoId ?? null, quantidade_total_kg: kg, sobra_kg: 0, dias_periodo: null, total_cabecas_afetadas: 100,
      movimentacao_estoque_id: movimentacao?.id ?? null, custo_unitario_kg: movimentacao ? Number(movimentacao.valor_unitario) : null,
    },
    lotes: [{ empresa_id: empresaId, lote_id: loteId, lote_nome: 'L', data_lancamento: data, percentual_consumo_lote: 1, dias_periodo: null }],
    evento_anterior_id: null,
  }), 201);
  return { evento: r.evento, movimentacao };
};

describe('V1 — ledger do rebanho: o rateio cancelado deixa de bloquear o cancelamento da transferência', () => {
  test('bloqueada pelo rateio de N; cancelado N, a transferência cancela', async () => {
    const p = prisma();
    const adm = await criarTenant({ papelTenant: 'administrador' });
    const c = adm.cliente.id;
    const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
    const empresa = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: `Fazenda ${c}` } });
    const setor = await p.setor.create({ data: { cliente_id: c, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
    const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: c, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
    const A = await area(1, 'PASTO A');
    const B = await area(2, 'PASTO B');
    ok(await req('POST', '/lotes', tok, {
      empresa_id: empresa.id, nome: 'LOTE', quantidade_cabecas: 500, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id, area_entrada_id: A.id, area_atual_id: A.id,
      data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
    }), 201);
    ok(await req('POST', '/rebanho/ativacao', tok, { operation_id: op(), empresa_id: empresa.id, modo: 'entradas' }), 201);
    const posA = await p.posicaoRebanho.findFirst({ where: { cliente_id: c, area_id: A.id } });
    const transf = ok(await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', tok, {
      operation_id: op(), tipo: 'Transferência de Área', empresa_id: empresa.id, lote_id: posA.id, quantidade_animais: 100, area_destino_id: B.id, data_movimentacao: '2026-10-10',
    }), 201).movimentacao;
    const posB = await p.posicaoRebanho.findFirst({ where: { cliente_id: c, area_id: B.id } });

    const n = await lancarCocho(tok, { empresaId: empresa.id, ponto: 'cocho-b', data: '2026-10-15', kg: 10, areaId: B.id, loteId: posB.id });
    const cancelarTransf = () => req('POST', `/movimentacoes-mapa/${transf.id}/cancelamento`, tok, { operation_id: op(), motivo: 'lançado por engano' });

    const bloqueada = await cancelarTransf();
    assert.equal(bloqueada.statusCode, 409, bloqueada.body);
    assert.equal(bloqueada.json().code, 'REBANHO_CANCELAMENTO_VINCULO_POSTERIOR');
    const rateio = (await p.suplementacaoLote.findMany({ where: { cliente_id: c } })).filter((l) => l.dados?.suplementacao_evento_id === n.evento.id);
    assert.deepEqual(bloqueada.json().details.bloqueadores.map((b) => b.tipo).sort(), ['SuplementacaoLote'], 'só o rateio de N bloqueia');
    assert.deepEqual(bloqueada.json().details.bloqueadores.map((b) => b.id), rateio.map((l) => l.id));

    ok(await cancelarCocho(tok, empresa.id, n.evento.id));
    assert.ok((await p.suplementacaoLote.findMany({ where: { cliente_id: c } })).filter((l) => l.dados?.suplementacao_evento_id === n.evento.id).every((l) => l.dados.situacao === 'cancelado'));
    ok(await cancelarTransf());
    assert.equal((await p.posicaoRebanho.findUnique({ where: { id: posA.id } })).quantidade_cabecas, 500, 'o saldo voltou ao pasto A');
  });
});

describe('V2 — financeiro: a exclusão da compra baixada pelo cocho continua bloqueada depois do cancelamento', () => {
  test('lote_consumido antes e depois do cancelamento; nada muda na recusa', async () => {
    const A = acoes(app);
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '100', valor_unitario: '2.00' }]));
    const n = await lancarCocho(s.token, { empresaId: e.id, ponto: 'cocho-1', data: '2027-06-12', kg: 10, areaId: 'area-1', loteId: 'lote-a', saida: { produtoId: e.sal.id, localId: s.local.id } });
    const elegibilidade = async () => ok(await req('GET', `/operacoes-financeiras/${compra.id}/elegibilidade?empresa_id=${e.id}`, s.token));
    const antes = await elegibilidade();
    assert.equal(antes.excluir.permitido, false);
    assert.ok(antes.excluir.motivos.some((m) => m.codigo === 'lote_consumido'), JSON.stringify(antes.excluir.motivos));

    const canc = ok(await cancelarCocho(s.token, e.id, n.evento.id));
    assert.equal(canc.estorno.movimentacao_original_id, n.movimentacao.id);
    const recibo = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, tipo_operacao: 'saida_suplementacao' } });
    assert.equal(recibo.status, 'committed', 'o recibo da baixa continua committed');

    const depois = await elegibilidade();
    assert.equal(depois.excluir.permitido, false, JSON.stringify(depois.excluir));
    assert.ok(depois.excluir.motivos.some((m) => m.codigo === 'lote_consumido'), JSON.stringify(depois.excluir.motivos));
    const atual = await A.detalhe(s.token, compra.id, e.id);
    const camadas = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } });
    const r = await req('POST', `/operacoes-financeiras/${compra.id}/excluir`, s.token, { empresa_id: e.id, versao: atual.versao, operation_id: op(), motivo: 'exclusão de teste' });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'OPERACAO_EXCLUSAO_BLOQUEADA');
    assert.deepEqual(await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }), camadas, 'nada mudou');
  });
});
