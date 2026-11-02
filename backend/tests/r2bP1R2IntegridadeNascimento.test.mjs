/**
 * PR168-R2 (D-PROD-101, complemento) — integridade do Nascimento.
 *
 * P0-A: a categoria da mãe precisa ser MATERNA (oficial) e o lote, FÊMEA.
 * P0-B: o lote de filhotes existente só recebe nascidos do MESMO sexo; dois
 *       compatíveis = ambíguo (sem unificação implícita).
 * P0-C: os lotes de matrizes citados pelo nascimento (`linhas[].maes_lote_ids`)
 *       contam para histórico, dependências de cancelamento e exclusão (#167).
 *
 * PostgreSQL real, HTTP autenticado, dados sintéticos.
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
const DATA = '2026-10-30T12:00:00.000Z';

const VACA36 = 'Vaca + 36 meses';
const VACA25 = 'Vaca 25 a 36 meses';
const NOVILHA = 'Novilha 13 a 24 meses';
const BOI = 'Boi 25 a 36 meses';
const BEZERRO = 'Bezerro 0 a 12 meses';
const BEZERRA = 'Bezerra 0 a 12 meses';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const setor2 = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: outraEmpresa.id, numero_setor: '2', nome: 'Setor 2' } });
  const area = async (n, nome, emp = empresa, st = setor) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: st.id, setor_nome: st.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tok, empresa, outraEmpresa, setor, setor2, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), X: await area(9, 'PASTO X', outraEmpresa, setor2) };
};

const criarLote = async (c, { nome = 'L', qtd, area, categoria, sexo, peso = null, emp = c.empresa, setor = c.setor, ident = null }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: emp.id, nome, quantidade_cabecas: qtd, categoria, ...(sexo ? { sexo } : {}), setor_id: setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo',
    ...(peso !== null ? { peso_medio_kg: peso } : {}),
    ...(ident ? { identificador_nome: ident, identificador_sigla: 'ID', identificador_cor: '#123456' } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const nascimento = (c, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, {
    operation_id: opId(), tipo: 'Nascimento', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: DATA, linhas, ...extra,
  });
const ok = async (r) => {
  const x = await r;
  assert.equal(x.statusCode, 201, x.body);
  return x.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const peso = (l) => (l.peso_medio_kg === null ? null : Number(l.peso_medio_kg));
const cancelar = (c, id, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tok, { operation_id, motivo: 'lançado por engano' });
const cancelarOk = async (c, id) => {
  const r = await cancelar(c, id);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const historicoIds = async (c, loteId, cursor) =>
  req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${loteId}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, c.tok);
const eleg = async (c, id) => (await req('GET', `/lotes/${id}/elegibilidade-exclusao`, c.tok)).json();

const contagem = async (c) => {
  const p = prisma();
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
  return {
    lotes: lotes.map((l) => [l.id, l.quantidade_cabecas, l.status, l.categoria, l.sexo, peso(l)]),
    movs: await p.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }),
    audits: await p.auditLog.count({ where: { cliente_id: c.cliente.id } }),
    ops: await p.operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await contagem(c), antes, 'nada pode ser gravado');
  return r;
};

// ═══ P0-A — mãe precisa ser lote FÊMEA de categoria MATERNA ═════════════════

describe('PR168-R2 P0-A — validação materna no servidor', () => {
  test('A1: lote de BOIS machos como "categoria mãe" → 409 e nada gravado', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'BOIS', qtd: 80, area: c.A, categoria: BOI, sexo: 'Macho' });
    await exigirNadaGravado(c, () => nascimento(c, [{ sexo: 'Macho', categoria_mae: BOI, quantidade: 10 }]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
  });

  test('A2: lote de categoria Vaca cadastrado com sexo Macho não é mãe → 409', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'VACA ERRADA', qtd: 40, area: c.A, categoria: VACA36, sexo: 'Macho' });
    await exigirNadaGravado(c, () => nascimento(c, [{ sexo: 'Fêmea', categoria_mae: VACA36, quantidade: 3 }]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
  });

  test('A3: categoria não materna (Bezerra) ou inexistente → recusa sem gravar', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'BZA', qtd: 30, area: c.A, categoria: BEZERRA, sexo: 'Fêmea' });
    await criarLote(c, { nome: 'VACAS', qtd: 30, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    await exigirNadaGravado(c, () => nascimento(c, [{ sexo: 'Macho', categoria_mae: BEZERRA, quantidade: 1 }]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
    await exigirNadaGravado(c, () => nascimento(c, [{ sexo: 'Macho', categoria_mae: 'Vaca qualquer', quantidade: 1 }]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
  });

  test('A4: matriz excluída do Cadastro, em outra área, de outra empresa ou de outro tenant não vale', async () => {
    const c = await cenario();
    const excluida = await criarLote(c, { nome: 'VACAS EXCL', qtd: 30, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    await prisma().lote.update({ where: { id: excluida.id }, data: { excluido_em: new Date() } });
    await criarLote(c, { nome: 'VACAS B', qtd: 30, area: c.B, categoria: VACA36, sexo: 'Fêmea' });
    const linhas = [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 2 }];
    await exigirNadaGravado(c, () => nascimento(c, linhas), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
    await exigirNadaGravado(c, () => nascimento(c, linhas, { area_id: c.X.id }), 404, 'AREA_NOT_FOUND');
    const outro = await cenario();
    await exigirNadaGravado(c, () => nascimento(outro, linhas, { empresa_id: c.empresa.id, area_id: c.A.id }), 404);
  });

  test('A5: Vaca 25-36, Vaca +36 e Novilha 13-24 (fêmeas) são mães válidas; mães intactas', async () => {
    const c = await cenario();
    const ls = [
      await criarLote(c, { nome: 'V25', qtd: 30, area: c.A, categoria: VACA25, sexo: 'Fêmea' }),
      await criarLote(c, { nome: 'V36', qtd: 40, area: c.A, categoria: VACA36, sexo: 'Fêmea' }),
      await criarLote(c, { nome: 'NOV', qtd: 20, area: c.A, categoria: NOVILHA, sexo: 'Fêmea' }),
    ];
    const r = await ok(nascimento(c, [
      { sexo: 'Macho', categoria_mae: VACA25, quantidade: 2 },
      { sexo: 'Macho', categoria_mae: 'vaca + 36 MESES', quantidade: 3 },
      { sexo: 'Fêmea', categoria_mae: NOVILHA, quantidade: 1 },
    ]));
    assert.deepEqual(r.movimentacao.linhas.map((l) => l.maes_lote_ids), [[ls[0].id], [ls[1].id], [ls[2].id]]);
    for (const [l, q] of [[ls[0], 30], [ls[1], 40], [ls[2], 20]]) assert.equal((await lote(l.id)).quantidade_cabecas, q);
  });

  test('A6: confirmação com linha válida + linha de mãe masculina → NADA gravado', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    await criarLote(c, { nome: 'BOIS', qtd: 50, area: c.A, categoria: BOI, sexo: 'Macho' });
    await exigirNadaGravado(c, () => nascimento(c, [
      { sexo: 'Macho', categoria_mae: VACA36, quantidade: 5 },
      { sexo: 'Fêmea', categoria_mae: BOI, quantidade: 5 },
    ]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
  });
});

// ═══ P0-B — destino de filhotes compatível em sexo ═════════════════════════

describe('PR168-R2 P0-B — seleção segura do lote de filhotes', () => {
  test('B1: lote "Bezerro" marcado Fêmea NÃO recebe machos; cria lote coerente e não toca o incompatível', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    const errado = await criarLote(c, { nome: 'BZ ERRADO', qtd: 12, area: c.A, categoria: BEZERRO, sexo: 'Fêmea', peso: 90 });
    const antes = await lote(errado.id);
    const r = await ok(nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 5, peso_medio_kg: 30 }]));
    const linha = r.movimentacao.linhas[0];
    assert.equal(linha.lote_criado, true);
    assert.notEqual(linha.lote_id, errado.id);
    const novo = await lote(linha.lote_id);
    assert.deepEqual([novo.categoria, novo.sexo, novo.quantidade_cabecas], [BEZERRO, 'Macho', 5]);
    const depois = await lote(errado.id);
    assert.deepEqual([depois.quantidade_cabecas, peso(depois), depois.sexo, depois.updatedAt.getTime()], [antes.quantidade_cabecas, 90, 'Fêmea', antes.updatedAt.getTime()]);
  });

  test('B2: compatível e incompatível na mesma área → usa só o compatível (saldo, peso ponderado, entrada e identificação preservadas)', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    const errado = await criarLote(c, { nome: 'BZ F', qtd: 7, area: c.A, categoria: BEZERRO, sexo: 'Fêmea' });
    const certo = await criarLote(c, { nome: 'BZ M', qtd: 20, area: c.A, categoria: BEZERRO, sexo: 'Macho', peso: 100, ident: 'MANUAL' });
    const r = await ok(nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 10, peso_medio_kg: 40 }]));
    assert.equal(r.movimentacao.linhas[0].lote_id, certo.id);
    const d = await lote(certo.id);
    assert.deepEqual([d.quantidade_cabecas, peso(d), d.quantidade_entrada, d.area_entrada_id, d.identificador_nome, d.identificador_cor], [30, 80, 20, c.A.id, 'MANUAL', '#123456']);
    assert.equal((await lote(errado.id)).quantidade_cabecas, 7);
    // Cancelar devolve o estado exato.
    await cancelarOk(c, r.movimentacao.id);
    const v = await lote(certo.id);
    assert.deepEqual([v.quantidade_cabecas, peso(v), v.identificador_nome], [20, 100, 'MANUAL']);
  });

  test('B3: dois lotes compatíveis → 409 MANEJO_DESTINO_AMBIGUO, sem unificação implícita, nada gravado', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    await criarLote(c, { nome: 'BZ 1', qtd: 10, area: c.A, categoria: BEZERRO, sexo: 'Macho' });
    await criarLote(c, { nome: 'BZ 2', qtd: 11, area: c.A, categoria: BEZERRO, sexo: 'Macho' });
    await exigirNadaGravado(c, () => nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 3 }]), 409, 'MANEJO_DESTINO_AMBIGUO');
  });

  test('B4: lote de filhotes sem sexo cadastrado não é destino (não se adivinha); cria lote coerente', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    const semSexo = await criarLote(c, { nome: 'BZA ?', qtd: 9, area: c.A, categoria: BEZERRA });
    const r = await ok(nascimento(c, [{ sexo: 'Fêmea', categoria_mae: VACA36, quantidade: 4 }]));
    assert.notEqual(r.movimentacao.linhas[0].lote_id, semSexo.id);
    assert.equal((await lote(semSexo.id)).quantidade_cabecas, 9);
  });
});

// ═══ P0-C — vínculo com os lotes de matrizes ═══════════════════════════════

describe('PR168-R2 P0-C — histórico, dependências e exclusão pelos lotes de matrizes', () => {
  test('C1: nascimento ATIVO que cita a matriz bloqueia a exclusão (movimentacao_ativa); lote não some', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    await ok(nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 4 }]));
    const e = await eleg(c, vacas.id);
    assert.deepEqual([e.tipo, e.motivo], ['bloqueado', 'movimentacao_ativa'], JSON.stringify(e));
    const r = await req('DELETE', `/lotes/${vacas.id}`, c.tok);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().details?.motivo, 'movimentacao_ativa');
    assert.ok(await lote(vacas.id), 'nenhuma exclusão física com vínculo ativo');
  });

  test('C2: nascimento cancelado com prova → exclusão LÓGICA da matriz (linha preservada)', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    const r = await ok(nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 4 }]));
    await cancelarOk(c, r.movimentacao.id);
    assert.equal((await eleg(c, vacas.id)).tipo, 'exclusao_logica');
    const d = await req('DELETE', `/lotes/${vacas.id}`, c.tok);
    assert.equal(d.statusCode, 204, d.body);
    const l = await lote(vacas.id);
    assert.ok(l && l.excluido_em, 'linha preservada como referência histórica');
    // Histórico da matriz excluída continua achando o nascimento cancelado.
    const h = await historicoIds(c, vacas.id);
    assert.deepEqual(h.json().items.map((m) => [m.id, m.situacao]), [[r.movimentacao.id, 'cancelado']]);
  });

  test('C3: histórico pela matriz acha o nascimento; homônimo (outro id), outra empresa e outro tenant não', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    const homonimo = await criarLote(c, { nome: 'VACAS', qtd: 10, area: c.B, categoria: VACA36, sexo: 'Fêmea' });
    const r = await ok(nascimento(c, [{ sexo: 'Fêmea', categoria_mae: VACA36, quantidade: 4 }]));
    assert.deepEqual((await historicoIds(c, vacas.id)).json().items.map((m) => m.id), [r.movimentacao.id]);
    assert.deepEqual((await historicoIds(c, homonimo.id)).json().items, []);
    const outra = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.outraEmpresa.id}&lote_ids=${vacas.id}`, c.tok);
    assert.deepEqual(outra.json().items, []);
    const outro = await cenario();
    const vazamento = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${vacas.id}`, outro.tok);
    assert.deepEqual(vazamento.json().items ?? [], []);
  });

  test('C4: mais de 600 eventos citando a matriz → paginação completa, sem duplicar, total correto', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
    const real = await ok(nascimento(c, [{ sexo: 'Fêmea', categoria_mae: VACA36, quantidade: 1 }]));
    // Eventos sintéticos de leitura (gravação direta, só para volume): 300 ativos + 310 cancelados.
    const base = Date.now() - 10_000_000;
    await prisma().movimentacaoMapa.createMany({
      data: Array.from({ length: 610 }, (_, i) => ({
        cliente_id: c.cliente.id, empresa_id: c.empresa.id, createdAt: new Date(base + i * 1000),
        dados: { tipo: 'Nascimento', lote_ids: [], linhas: [{ maes_lote_ids: [vacas.id] }], ...(i % 2 ? { situacao: 'cancelado' } : {}) },
      })),
    });
    const vistos = [];
    let cursor = null;
    let total = null;
    for (let guarda = 0; guarda < 10; guarda += 1) {
      const pagina = (await historicoIds(c, vacas.id, cursor)).json();
      total = pagina.total;
      vistos.push(...pagina.items.map((m) => m.id));
      if (!pagina.has_more) break;
      cursor = pagina.next_cursor;
    }
    assert.equal(total, 611);
    assert.equal(vistos.length, 611);
    assert.equal(new Set(vistos).size, 611, 'sem duplicação');
    assert.ok(vistos.includes(real.movimentacao.id));
  });

  test('C5: nascimento ATIVO posterior que cita a matriz bloqueia cancelar a transferência anterior dela; cancelado não bloqueia', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.B, categoria: VACA36, sexo: 'Fêmea' });
    const t = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
      operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: vacas.id, quantidade_animais: 50, area_destino_id: c.A.id, data_movimentacao: DATA,
    });
    assert.equal(t.statusCode, 201, t.body);
    const n = await ok(nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 3 }]));
    const recusa = await cancelar(c, t.json().movimentacao.id);
    assert.equal(recusa.statusCode, 409, recusa.body);
    assert.equal(recusa.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal((await lote(vacas.id)).area_atual_id, c.A.id);
    await cancelarOk(c, n.movimentacao.id);
    await cancelarOk(c, t.json().movimentacao.id);
    assert.equal((await lote(vacas.id)).area_atual_id, c.B.id);
  });
});

describe('PR168-R2 P0-C — dependência só pelo vínculo materno', () => {
  test('C6: mudança Novilha→Vaca, depois nascimento usando a vaca → cancelar a mudança é BLOQUEADO (só o elo materno liga os dois)', async () => {
    const c = await cenario();
    const nov = await criarLote(c, { nome: 'NOVILHAS', qtd: 30, area: c.A, categoria: NOVILHA, sexo: 'Fêmea' });
    const m = await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, {
      operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: DATA,
      linhas: [{ categoria_atual: NOVILHA, categoria_nova: VACA25, quantidade: 30 }],
    }));
    const n = await ok(nascimento(c, [{ sexo: 'Fêmea', categoria_mae: VACA25, quantidade: 2 }]));
    assert.deepEqual(n.movimentacao.linhas[0].maes_lote_ids, [nov.id]);
    const r = await cancelar(c, m.movimentacao.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal((await lote(nov.id)).categoria, VACA25);
    // Cancelado o nascimento, a mudança volta a ser cancelável (cancelado não bloqueia).
    await cancelarOk(c, n.movimentacao.id);
    await cancelarOk(c, m.movimentacao.id);
    assert.equal((await lote(nov.id)).categoria, NOVILHA);
  });
});

// ═══ Concorrência (3 rodadas) ══════════════════════════════════════════════

describe('PR168-R2 concorrência — quem trava primeiro decide; nunca órfão nem 500', () => {
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`K1.${rodada}: DELETE da matriz × nascimento`, async () => {
      const c = await cenario();
      const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.A, categoria: VACA36, sexo: 'Fêmea' });
      const ordem = rodada % 2 === 0;
      const [del, nas] = ordem
        ? (await Promise.all([nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 4 }]), req('DELETE', `/lotes/${vacas.id}`, c.tok)])).reverse()
        : await Promise.all([req('DELETE', `/lotes/${vacas.id}`, c.tok), nascimento(c, [{ sexo: 'Macho', categoria_mae: VACA36, quantidade: 4 }])]);
      assert.ok([204, 409].includes(del.statusCode), del.body);
      assert.ok([201, 409].includes(nas.statusCode), nas.body);
      const existe = await lote(vacas.id);
      if (nas.statusCode === 201) {
        assert.equal(del.statusCode, 409, 'nascimento gravado ⇒ matriz não pode sumir');
        assert.ok(existe && !existe.excluido_em);
      } else {
        assert.equal(del.statusCode, 204);
        assert.equal(nas.json().code, 'MANEJO_CATEGORIA_MAE_INVALIDA');
        assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 0, 'sem nascimento órfão');
      }
    });

    test(`K2.${rodada}: cancelar a transferência da matriz × nascimento nela`, async () => {
      const c = await cenario();
      const vacas = await criarLote(c, { nome: 'VACAS', qtd: 50, area: c.B, categoria: VACA36, sexo: 'Fêmea' });
      const t = (await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
        operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: vacas.id, quantidade_animais: 50, area_destino_id: c.A.id, data_movimentacao: DATA,
      })).json();
      const [canc, nas] = await Promise.all([cancelar(c, t.movimentacao.id), nascimento(c, [{ sexo: 'Fêmea', categoria_mae: VACA36, quantidade: 2 }])]);
      assert.ok([200, 409].includes(canc.statusCode), canc.body);
      assert.ok([201, 409].includes(nas.statusCode), nas.body);
      assert.ok(!(canc.statusCode === 200 && nas.statusCode === 201), 'os dois não podem valer: o nascimento usaria uma matriz que saiu da área');
      const l = await lote(vacas.id);
      assert.equal(l.area_atual_id, canc.statusCode === 200 ? c.B.id : c.A.id);
      assert.equal(l.quantidade_cabecas, 50);
    });
  }
});
