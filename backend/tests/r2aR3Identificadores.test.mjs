/**
 * R2A-R3 (D-PROD-99c) — reversão completa dos identificadores em transferência
 * com UNIFICAÇÃO. A unificação copia identificador_nome/sigla/cor da origem
 * para o destino; o cancelamento tem de devolver os do destino — sem destruir
 * edição legítima feita depois. PostgreSQL real, HTTP, auth.
 *
 * (Base herdada do teste R2A-R2:)
 *
 * O CAS de `PATCH /lotes` (R2A-R1) impede escrita OBSOLETA, mas permite uma
 * escrita VÁLIDA (com `estado_esperado` correto) depois do movimento. Antes
 * desta correção, o cancelamento somava `antes − depois` sobre a quantidade
 * atual e devolvia animais sem prova. Aqui: PostgreSQL real, HTTP, auth.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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
const opId = () => `op-${randomUUID()}`;

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = async (n, nome, emp = empresa) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tokAdm, empresa, outraEmpresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), C: await area(3, 'PASTO C') };
};

const criarLote = async (c, { nome = 'NELORE', qtd = 500, area, categoria = 'BOI', ident = {} }) => {
  const r = await req('POST', '/lotes', c.tokAdm, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo: 'Macho', setor_id: c.setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', ...ident,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const mov = (id) => prisma().movimentacaoMapa.findUnique({ where: { id } });
const patch = (c, id, corpo) => req('PATCH', `/lotes/${id}`, c.tokAdm, corpo);
const manejo = (c, corpo) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tokAdm, {
    operation_id: opId(), empresa_id: c.empresa.id, data_movimentacao: '2026-10-30T12:00:00.000Z', ...corpo,
  });
const transferir = async (c, l, q, area, loteDestinoId) => {
  const r = await manejo(c, {
    tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: q, area_destino_id: area.id,
    ...(loteDestinoId ? { lote_destino_id: loteDestinoId } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const cancelar = (c, id, operation_id = opId()) =>
  req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tokAdm, { operation_id, motivo: 'lançado por engano' });




const ORIG = { identificador_nome: 'ORIGEM', identificador_sigla: 'ORG', identificador_cor: '#445566' };
const DEST = { identificador_nome: 'DESTINO', identificador_sigla: 'DST', identificador_cor: '#112233' };
const NULOS = { identificador_nome: null, identificador_sigla: null, identificador_cor: null };

/** Todos os campos que importam: saldo, situação, área, identificação, entrada histórica e empresa. */
const ficha = async (id) => {
  const l = await lote(id);
  return {
    quantidade_cabecas: l.quantidade_cabecas, status: l.status, area_atual_id: l.area_atual_id,
    identificador_nome: l.identificador_nome, identificador_sigla: l.identificador_sigla, identificador_cor: l.identificador_cor,
    quantidade_entrada: l.quantidade_entrada, area_entrada_id: l.area_entrada_id, categoria_entrada: l.categoria_entrada,
    numero_lote: l.numero_lote, empresa_id: l.empresa_id, categoria: l.categoria,
  };
};

describe('R2A-R3 P0 — unificação: cancelar devolve os identificadores do destino', () => {
  for (const [modo, q] of [['parcial_unificado', 50], ['total_unificado', 500]]) {
    for (const [rotulo, identOrigem] of [['origem identificada', ORIG], ['origem SEM identificador (nulos)', NULOS]]) {
      test(`${modo}, ${rotulo}: destino volta a DESTINO/DST/#112233; todos os campos iguais ao pré-movimento`, async () => {
        const c = await cenario();
        const o = await criarLote(c, { area: c.A, qtd: 500, ident: identOrigem });
        const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
        const antesO = await ficha(o.id);
        const antesD = await ficha(d.id);
        const t = await transferir(c, o, q, c.B, d.id);
        assert.equal(t.movimentacao.efeito_servidor.modo, modo);
        // Semântica atual da unificação (preservada): o destino recebe a identificação da origem.
        const durante = await ficha(d.id);
        assert.deepEqual(
          [durante.identificador_nome, durante.identificador_sigla, durante.identificador_cor],
          [identOrigem.identificador_nome, identOrigem.identificador_sigla, identOrigem.identificador_cor]
        );
        const k = opId();
        const r = await cancelar(c, t.movimentacao.id, k);
        assert.equal(r.statusCode, 200, r.body);
        assert.deepEqual(await ficha(o.id), antesO, 'origem idêntica ao pré-movimento');
        assert.deepEqual(await ficha(d.id), antesD, 'destino idêntico ao pré-movimento, inclusive identificação');
        const replay = await cancelar(c, t.movimentacao.id, k);
        assert.equal(replay.json().replay, true);
        assert.deepEqual(await ficha(d.id), antesD, 'replay não muda nada');
      });
    }
  }
});

describe('R2A-R3 P0 — edição legítima POSTERIOR do identificador do destino é preservada', () => {
  test('usuário renomeia o identificador do destino depois da unificação: o saldo volta, a edição fica (auditada)', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    const p = await patch(c, d.id, { identificador_nome: 'EDITADO', identificador_sigla: 'EDT' });
    assert.equal(p.statusCode, 200, p.body);
    const r = await cancelar(c, t.movimentacao.id);
    assert.equal(r.statusCode, 200, r.body);
    const fd = await ficha(d.id);
    assert.deepEqual([fd.quantidade_cabecas, fd.identificador_nome, fd.identificador_sigla, fd.identificador_cor], [100, 'EDITADO', 'EDT', '#445566']);
    const efeitoDestino = r.json().movimentacao.cancelamento.efeitos.find((e) => e.lote_id === d.id);
    assert.equal(efeitoDestino.identificacao, 'preservada_edicao_posterior');
    assert.equal((await ficha(o.id)).quantidade_cabecas, 500);
  });

  test('ida e volta do identificador (ORIGEM → X → ORIGEM) também conta como edição: nada é sobrescrito', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    assert.equal((await patch(c, d.id, { identificador_nome: 'X' })).statusCode, 200);
    assert.equal((await patch(c, d.id, { identificador_nome: 'ORIGEM' })).statusCode, 200);
    const r = await cancelar(c, t.movimentacao.id);
    assert.equal(r.statusCode, 200, r.body);
    const fd = await ficha(d.id);
    assert.deepEqual([fd.quantidade_cabecas, fd.identificador_nome, fd.identificador_sigla], [100, 'ORIGEM', 'ORG']);
    assert.equal(r.json().movimentacao.cancelamento.efeitos.find((e) => e.lote_id === d.id).identificacao, 'preservada_edicao_posterior');
  });
});

describe('R2A-R3 D — modos que não unificam não escrevem identificador no cancelamento', () => {
  test('total no lugar e parcial com lote novo: identificação intacta; derivado 0/Inativo, entrada histórica intacta', async () => {
    const c = await cenario();
    const l = await criarLote(c, { nome: 'L1', area: c.A, qtd: 40, ident: ORIG });
    const antes = await ficha(l.id);
    const t = await transferir(c, l, 40, c.B);
    assert.equal((await cancelar(c, t.movimentacao.id)).statusCode, 200);
    assert.deepEqual(await ficha(l.id), antes);

    const l2 = await criarLote(c, { nome: 'L2', area: c.A, qtd: 100, ident: ORIG });
    const antes2 = await ficha(l2.id);
    const t2 = await transferir(c, l2, 30, c.C);
    const deriv = t2.lotes.find((x) => x.id !== l2.id);
    const derivAntes = await ficha(deriv.id);
    assert.equal((await cancelar(c, t2.movimentacao.id)).statusCode, 200);
    assert.deepEqual(await ficha(l2.id), antes2);
    const dv = await ficha(deriv.id);
    assert.deepEqual(dv, { ...derivAntes, quantidade_cabecas: 0, status: 'Inativo' }, 'derivado: só saldo e situação mudam');
    assert.equal(dv.quantidade_entrada, 30);
  });
});

describe('R2A-R3 P1 — prova, concorrência e regressão', () => {
  /** Segura a linha do lote numa transação à parte até `soltar()`. */
  const segurarLote = async (loteId) => {
    let soltar;
    const liberado = new Promise((r) => { soltar = r; });
    let travado;
    const pronto = new Promise((r) => { travado = r; });
    const tx = prisma().$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "Lote" WHERE id = ${loteId} FOR UPDATE`;
      travado();
      await liberado;
    }, { timeout: 20000 });
    await pronto;
    return async () => { soltar(); await tx; };
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  test('ordem A — cancelamento pega a trava antes da edição do identificador: restaura DESTINO e depois a edição vale', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    const soltar = await segurarLote(d.id);
    const pc = cancelar(c, t.movimentacao.id);
    await espera(300);
    const pp = patch(c, d.id, { identificador_nome: 'EDITADO' });
    await espera(300);
    await soltar();
    const [rc, rp] = await Promise.all([pc, pp]);
    assert.equal(rc.statusCode, 200, rc.body);
    assert.equal(rp.statusCode, 200, rp.body);
    assert.equal(rc.json().movimentacao.cancelamento.efeitos.find((e) => e.lote_id === d.id).identificacao, 'restaurada');
    const fd = await ficha(d.id);
    assert.deepEqual([fd.quantidade_cabecas, fd.identificador_nome, fd.identificador_sigla, fd.identificador_cor], [100, 'EDITADO', 'DST', '#112233']);
  });

  test('ordem B — edição pega a trava primeiro: o cancelamento devolve o saldo e PRESERVA a edição', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    const soltar = await segurarLote(d.id);
    const pp = patch(c, d.id, { identificador_nome: 'EDITADO' });
    await espera(300);
    const pc = cancelar(c, t.movimentacao.id);
    await espera(300);
    await soltar();
    const [rp, rc] = await Promise.all([pp, pc]);
    assert.equal(rp.statusCode, 200, rp.body);
    assert.equal(rc.statusCode, 200, rc.body);
    assert.equal(rc.json().movimentacao.cancelamento.efeitos.find((e) => e.lote_id === d.id).identificacao, 'preservada_edicao_posterior');
    const fd = await ficha(d.id);
    assert.deepEqual([fd.quantidade_cabecas, fd.identificador_nome, fd.identificador_sigla], [100, 'EDITADO', 'ORG']);
  });

  test('unificação gravada SEM snapshot de identificação (formato R2) → 409 EFEITO_NAO_COMPROVADO; nada muda, sem reserva', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    // Simula registro do formato anterior (só existe em ambiente de teste): remove o snapshot.
    const m = await mov(t.movimentacao.id);
    const ef = m.dados.efeito_servidor;
    await prisma().movimentacaoMapa.update({
      where: { id: m.id },
      data: { dados: { ...m.dados, efeito_servidor: { ...ef, efeitos: ef.efeitos.map((e) => { const resto = { ...e }; delete resto.identificacao; return resto; }) } } },
    });
    const antes = [await ficha(o.id), await ficha(d.id)];
    const k = opId();
    const r = await cancelar(c, m.id, k);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    assert.deepEqual([await ficha(o.id), await ficha(d.id)], antes);
    assert.equal(await prisma().operacaoIdempotente.count({ where: { operation_key: k } }), 0);
    assert.equal(await prisma().auditLog.count({ where: { acao: 'cancelamento', entidade_id: m.id } }), 0);
  });

  test('duas unificações no mesmo destino, canceladas da mais recente para a mais antiga: DESTINO volta exato', async () => {
    const c = await cenario();
    const o1 = await criarLote(c, { nome: 'NELORE', area: c.A, qtd: 300, ident: ORIG });
    const o2 = await criarLote(c, { nome: 'NELORE', area: c.C, qtd: 200, ident: { identificador_nome: 'SEGUNDA', identificador_sigla: 'SEG', identificador_cor: '#778899' } });
    const d = await criarLote(c, { nome: 'NELORE', area: c.B, qtd: 100, ident: DEST });
    const antesD = await ficha(d.id);
    const t1 = await transferir(c, o1, 30, c.B, d.id);
    const t2 = await transferir(c, o2, 20, c.B, d.id);
    assert.equal((await ficha(d.id)).identificador_nome, 'SEGUNDA');
    assert.equal((await cancelar(c, t1.movimentacao.id)).json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal((await cancelar(c, t2.movimentacao.id)).statusCode, 200);
    assert.equal((await ficha(d.id)).identificador_nome, 'ORIGEM');
    assert.equal((await cancelar(c, t1.movimentacao.id)).statusCode, 200);
    assert.deepEqual(await ficha(d.id), antesD);
    assert.deepEqual([(await ficha(o1.id)).quantidade_cabecas, (await ficha(o2.id)).quantidade_cabecas], [300, 200]);
  });

  test('regressão R2: PATCH material depois da unificação continua bloqueando (409), sem tocar identificação', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    assert.equal((await patch(c, d.id, { quantidade_cabecas: 140, estado_esperado: { quantidade_cabecas: 150 } })).statusCode, 200);
    const antes = await ficha(d.id);
    const r = await cancelar(c, t.movimentacao.id);
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'CANCELAMENTO_ALTERACAO_POSTERIOR');
    assert.deepEqual(await ficha(d.id), antes);
  });

  test('outro tenant não cancela nem enxerga a unificação (404)', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500, ident: ORIG });
    const d = await criarLote(c, { area: c.B, qtd: 100, ident: DEST });
    const t = await transferir(c, o, 50, c.B, d.id);
    const outro = await cenario();
    const r = await req('POST', `/movimentacoes-mapa/${t.movimentacao.id}/cancelamento`, outro.tokAdm, { operation_id: opId(), motivo: 'tentativa' });
    assert.equal(r.statusCode, 404);
    assert.equal((await ficha(d.id)).identificador_nome, 'ORIGEM');
  });
});
