/**
 * PR174-R2 (D-PROD-107) — fechamento de três lacunas de integridade do ledger:
 *  A) reset de teste × respostas idempotentes órfãs e documentos vinculados;
 *  B) POST genérico (unitário/lote/alias) não registra fato material em empresa ativada;
 *  C) causalidade de PESO: cancelamento/retroativo que mudaria peso derivado posterior.
 * Tudo em PostgreSQL real + HTTP autenticado; cada recusa confere ZERO mudança.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, transferenciaComDerivadoLegado, baixaLegada } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';
import { executarReset, planejarReset } from '../../scripts/ops/resetRebanhoEmpresaTesteLib.mjs';
import { criarEmLote as criarMovMapaEmLote } from '../src/modules/movimentacoesMapa/movimentacaoMapaService.js';
import { criarEmLote as criarMovPecEmLote } from '../src/modules/movimentacoesPecuaria/movimentacaoPecuariaService.js';

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

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
};
const entrada = async (c, { nome = 'LOTE', qtd = 40, area = c.A, data = '2026-10-25', categoria = BOI, sexo = 'Macho', peso = 400 } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** Empresa reconstruída pelas entradas (linha do tempo completa desde cada entrada). */
const ativar = async (c) => {
  const r = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens;
const pos = async (c, filtro) => (await posicoes(c)).find(filtro);
const daEntrada = (lote, area) => (p) => p.lote_entrada_id === lote.id && p.area_atual_id === area.id;
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const verificar = async (c) => {
  const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
  assert.equal(v.integro, true, JSON.stringify(v));
  return v;
};
const loteFixo = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, l.status, l.area_atual_id, l.categoria, l.origem]);
const contagem = async (c) => {
  const p = prisma();
  const w = { cliente_id: c.cliente.id };
  return {
    lotes: await loteFixo(c),
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
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await contagem(c), antes, 'nada pode ser gravado');
  return r;
};
const cancelar = (c, movId, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${movId}/cancelamento`, c.tok, { operation_id, motivo: 'teste do ledger' });
const rebanho = (c, tipo, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const juntar = (c, principal, origens, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: '2026-11-02', ...extra });
const transferir = (c, itens, destino, dia) =>
  req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}`, itens });


const legado = async () => {
  const c = await cenario();
  return c;
};
const manejoLote = (c, body) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, body);
const corpoTransfLegada = (c, lote, quantidade, destino) => ({
  operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: lote.id, quantidade_animais: quantidade,
  data_movimentacao: '2026-10-28', area_destino_id: destino.id, categoria_animal: BOI,
});
/**
 * PR174-R4: o manejo não fabrica mais lote derivado. Transferência legada com
 * derivado = DADO LEGADO pré-existente (fixture compartilhada); devolve o corpo
 * do comando (para replay) e a resposta.
 */
const transfComDerivadoLegado = async (c, lote, quantidade, destino) => {
  const r = await transferenciaComDerivadoLegado(app, {
    token: c.tok, empresaId: c.empresa.id, setorId: c.setor.id, origem: lote, quantidade, areaDestinoId: destino.id, data: '2026-10-28', corpoExtra: { categoria_animal: BOI },
  });
  return { body: r.corpo, t: r, derivadoId: r.derivadoId };
};
/** Destino genuíno (ENTRADA compatível já cadastrada) para a transferência parcial legada unificar. */
const destinoEntrada = (c, lote, destino, qtd = 1) => entrada(c, { nome: lote.nome, qtd, area: destino });
const corpoMorteLegada = (c, quantidade) => ({
  operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-29', linhas: [{ categoria: BOI, quantidade, causa_morte: 'Doença' }],
});
const resetar = (c, extra = {}) => executarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, confirmarEmpresaNome: 'Fazenda', gravarBackup: () => {}, ...extra });
const pesoObs = async (posicaoId) => (await prisma().pesoRebanho.findMany({ where: { posicao_id: posicaoId, ativa: true }, orderBy: [{ data_operacional: 'asc' }, { createdAt: 'asc' }] })).map((w) => [w.data_operacional.toISOString().slice(0, 10), w.peso_medio_kg === null ? null : Number(w.peso_medio_kg)]);
const posDb = (id) => prisma().posicaoRebanho.findUnique({ where: { id } });

// ═══ A: reset × idempotência × vínculos ════════════════════════════════════

describe('R2 A — reset de teste não deixa replay órfão nem vínculo inválido', () => {
  test('A1: replay da MESMA chave depois do reset → 409 estável (nunca 201 com movimento apagado); outra empresa e outro tenant seguem com replay', async () => {
    const c = await legado();
    const l = await entrada(c, { nome: 'COMPRA', qtd: 500 });
    const { body: tBody, t } = await transfComDerivadoLegado(c, l, 120, c.B);
    // PR174-R5: os movimentos legados são DADO pré-existente (base anterior ao cutover).
    const m = await baixaLegada({ lote: l, quantidade: 5 });
    const mBody = { ...corpoMorteLegada(c, 5), operation_id: m.operationKey };
    // Controles: outra empresa do mesmo tenant e outro tenant, com chaves próprias.
    const outra = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'OUT', nome: 'Outra' } });
    const setor2 = await prisma().setor.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, numero_setor: '9', nome: 'S9' } });
    const a2 = await prisma().areaPastagem.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, setor_id: setor2.id, setor_nome: 'S9', numero_area: '9', nome: 'PASTO X', tamanho_hectares: 5 } });
    const b2 = await prisma().areaPastagem.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, setor_id: setor2.id, setor_nome: 'S9', numero_area: '10', nome: 'PASTO Y', tamanho_hectares: 5 } });
    const c2 = { ...c, empresa: outra, setor: setor2, A: a2, B: b2 };
    const l2 = await entrada(c2, { nome: 'OUTRA', qtd: 50 });
    const { body: oBody } = await transfComDerivadoLegado(c2, l2, 10, b2);
    const viz = await legado();
    const lv = await entrada(viz, { nome: 'VIZ', qtd: 30 });
    const { body: vBody } = await transfComDerivadoLegado(viz, lv, 5, viz.B);

    await resetar(c);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { id: { in: [t.movimentacao.id, m.movimentacao.id] } } }), 0, 'movimentos apagados pelo reset');

    for (const body of [tBody, mBody]) {
      const url = body.tipo === 'Morte' && body.linhas ? '/movimentacoes-mapa/comandos/baixa-rebanho' : '/movimentacoes-mapa/comandos/manejo-lote';
      const antes = await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } });
      const r = await req('POST', url, c.tok, body);
      assert.equal(r.statusCode, 409, `replay órfão: ${r.body}`);
      assert.equal(r.json().code, 'IDEMPOTENCY_EFEITO_DESFEITO', r.body);
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), antes, 'nada gravado');
    }
    // Controles intactos: replay normal.
    const ro = await manejoLote(c2, oBody);
    assert.equal(ro.statusCode, 201, ro.body);
    assert.equal(ro.json().replay, true);
    const rv = await manejoLote(viz, vBody);
    assert.equal(rv.statusCode, 201, rv.body);
    assert.equal(rv.json().replay, true);
  });

  test('A2: documento (suplementação/sanidade/anexo; tarefas pela mesma varredura) que cita lote derivado ou movimento apagado → reset RECUSA e nada muda', async () => {
    const c = await legado();
    const l = await entrada(c, { nome: 'COMPRA', qtd: 500 });
    const { t, derivadoId } = await transfComDerivadoLegado(c, l, 120, c.B);
    const derivado = (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, NOT: { id: l.id } } }))[0];
    assert.ok(derivado && derivado.id === derivadoId && derivado.origem === 'MOVIMENTAÇÃO', 'derivado legado da transferência parcial');
    const casos = [
      () => prisma().suplementacaoLote.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: derivado.id, lote_nome: derivado.nome } } }),
      () => prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_ids: [derivado.id] } } }),
      () => prisma().registroAnexo.create({ data: { cliente_id: c.cliente.id, entidade: 'MovimentacaoMapa', entidade_id: t.movimentacao.id, storage_key: `k-${randomUUID()}`, nome_original: 'a.pdf', mime_type: 'application/pdf', tamanho_bytes: 10, criado_por: 'teste' } }),
    ];
    for (const criarVinculo of casos) {
      const v = await criarVinculo();
      const antes = await contagem(c);
      await assert.rejects(resetar(c), (e) => e.codigo === 'RESET_VINCULOS_PENDENTES' && e.detalhes.vinculos.length > 0, 'reset recusa');
      assert.deepEqual(await contagem(c), antes, 'nada mudou');
      const modelo = v.storage_key ? 'registroAnexo' : v.dados?.lote_ids ? 'eventoSanitario' : 'suplementacaoLote';
      await prisma()[modelo].delete({ where: { id: v.id } });
    }
    // Sem vínculo pendente o reset segue.
    const resumo = await resetar(c);
    assert.equal(resumo.movimentacoes_apagadas, 1);
  });

  test('A3: reset reexecutado é no-op (sem nova auditoria, sem perda); AuditLog preservado e o do reset cita movimentos e chaves', async () => {
    const c = await legado();
    const l = await entrada(c, { nome: 'COMPRA', qtd: 500 });
    const { body: tBody, t } = await transfComDerivadoLegado(c, l, 120, c.B);
    const auditsAntes = await prisma().auditLog.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
    const r1 = await resetar(c);
    assert.equal(r1.movimentacoes_apagadas, 1);
    assert.equal(r1.operacoes_invalidadas, 1);
    const depois1 = await prisma().auditLog.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(depois1.filter((a) => a.acao !== 'reset_rebanho_teste').map((a) => a.id), auditsAntes.map((a) => a.id), 'auditoria anterior intacta');
    const auditReset = depois1.find((a) => a.acao === 'reset_rebanho_teste');
    assert.deepEqual(auditReset.dados_novos.movimentacao_ids, [t.movimentacao.id]);
    assert.deepEqual(auditReset.dados_novos.operacoes_invalidadas.map((o) => o.operation_key), [tBody.operation_id]);
    const loteDepois = await prisma().lote.findUnique({ where: { cliente_id_id: { cliente_id: c.cliente.id, id: l.id } } });
    assert.deepEqual([loteDepois.quantidade_cabecas, loteDepois.area_atual_id, loteDepois.status, loteDepois.categoria], [500, c.A.id, 'Ativo', BOI]);
    const antes2 = await contagem(c);
    let backup2 = 0;
    const r2 = await resetar(c, { gravarBackup: () => { backup2 += 1; } });
    assert.deepEqual(r2, { sem_alteracoes: true, movimentacoes_apagadas: 0, lotes_restaurados: 0, lotes_retirados: 0, operacoes_invalidadas: 0, lotes_de_entrada: 1 });
    assert.equal(backup2, 0, 'nada a fazer: nem backup');
    assert.deepEqual(await contagem(c), antes2, 'reexecução não muda nada');
    assert.equal((await planejarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id })).movimentacoes_a_apagar, 0);
  });

  test('A4: concorrência 3× — reset × comando do mapa numa empresa NÃO migrada: o comando é 409 REBANHO_CUTOVER_PENDENTE (nunca grava, nunca reserva chave), o reset conclui, sem 500', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await legado();
      const l = await entrada(c, { nome: 'COMPRA', qtd: 500 });
      await transfComDerivadoLegado(c, l, 50, c.B);
      const destino = await destinoEntrada(c, l, c.B, 10);
      const body = { ...corpoTransfLegada(c, l, 30, c.B), lote_destino_id: destino.id };
      const [rr, rc] = await Promise.allSettled([resetar(c), manejoLote(c, body)]);
      assert.equal(rr.status, 'fulfilled', String(rr.reason?.message ?? ''));
      assert.equal(rc.value.statusCode, 409, rc.value.body);
      assert.equal(rc.value.json().code, 'REBANHO_CUTOVER_PENDENTE', rc.value.body);
      assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: c.cliente.id, operation_key: body.operation_id } }), 0, `rodada ${rodada}: recusa não reserva a chave`);
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id, empresa_id: c.empresa.id } }), 0, 'reset apagou o legado; o comando não gravou nada');
      const replay = await manejoLote(c, body);
      assert.equal(replay.statusCode, 409, replay.body);
      assert.equal(replay.json().code, 'REBANHO_CUTOVER_PENDENTE');
    }
  });
});

// ═══ B: POST genérico × ledger ═════════════════════════════════════════════

const MATERIAIS = ['Transferência de Área', 'Morte', 'Abate', 'Nascimento', 'Pesagem', 'Mudança de Categoria', 'Entrada', 'Saída', 'Venda'];
describe('R2 B — POST genérico não registra fato material numa empresa ativada', () => {
  test('B1: unitário, lote (service), alias pecuária, com id de cadastro OU de posição → 409 REBANHO_LEDGER_SOMENTE_POR_COMANDO, nada gravado; junção segue com o código próprio; renomear (informativo) passa', async () => {
    const c = await cenario();
    const l = await entrada(c, { nome: 'L', qtd: 100 });
    await ativar(c);
    const p = await pos(c, daEntrada(l, c.A));
    for (const tipo of MATERIAIS) {
      for (const loteId of [l.id, p.id]) {
        await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo, lote_id: loteId, quantidade_animais: 5, area_origem_id: c.A.id, data_movimentacao: '2026-11-02' }), 409, 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
      }
    }
    // Empresa informada errada (outra empresa / ausente) não contorna: o lote citado é da empresa ativada.
    const outra = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'OUT', nome: 'Outra' } });
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: outra.id, tipo: 'Morte', lote_id: l.id, quantidade_animais: 1 }), 409, 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: outra.id, tipo: 'Transferência de Área', posicao_id: p.id, quantidade_animais: 1 }), 409, 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
    // Junção continua com o código próprio (anterior ao ledger).
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Junção de Lotes', lote_id: l.id }), 409, 'JUNCAO_SOMENTE_POR_COMANDO');
    // Alias: MovimentacaoPecuaria.
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-pecuaria', c.tok, { empresa_id: c.empresa.id, tipo: 'Morte', lote_id: l.id, quantidade: 3 }), 409, 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
    // Lote via service (não há rota HTTP de lote).
    const usuario = await prisma().usuario.findFirst({ where: { cliente_id: c.cliente.id } });
    const contexto = { auth: { clienteId: c.cliente.id, usuarioId: usuario.id, papelTenant: 'administrador' }, requestId: 'r2-b1' };
    for (const criar of [criarMovMapaEmLote, criarMovPecEmLote]) {
      const antes = await contagem(c);
      await assert.rejects(criar(contexto, [{ empresa_id: c.empresa.id, tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: 1 }]), (e) => e.code === 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
      assert.deepEqual(await contagem(c), antes);
    }
    assert.equal((await req('POST', '/movimentacoes-mapa/bulk', c.tok, [{ tipo: 'Morte' }])).statusCode, 404, 'não existe rota HTTP de lote');
    // Informativo declarado: renomear lote (sem efeito em saldo) continua.
    const ren = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Entrada', motivo: 'Renomear Lote', lote_id: l.id, lote: 'L2', observacoes: 'Renomear Lote: "L" → "L2"' });
    assert.equal(ren.statusCode, 201, ren.body);
    assert.equal(await prisma().partidaRebanho.count({ where: { cliente_id: c.cliente.id, NOT: { evento: { tipo: 'ENTRADA' } } } }), 0, 'nenhuma partida além das entradas');
    await verificar(c);
  });

  test('B2: empresa LEGADA conserva o POST genérico aprovado; PATCH/DELETE seguem recusados', async () => {
    const c = await cenario();
    const l = await entrada(c, { nome: 'L', qtd: 100 });
    const r = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Morte', lote_id: l.id, quantidade_animais: 1, data_movimentacao: '2026-11-02' });
    assert.equal(r.statusCode, 201, r.body);
    const rp = await req('POST', '/movimentacoes-pecuaria', c.tok, { empresa_id: c.empresa.id, tipo: 'Morte', lote_id: l.id, quantidade: 1 });
    assert.equal(rp.statusCode, 201, rp.body);
    assert.equal((await req('PATCH', `/movimentacoes-mapa/${r.json().id}`, c.tok, { quantidade_animais: 2 })).statusCode, 409);
    assert.equal((await req('DELETE', `/movimentacoes-mapa/${r.json().id}`, c.tok)).statusCode, 409);
  });

  test('B3: concorrência 3× — ativação (entradas) × POST genérico material: nunca os dois aceitos', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await cenario();
      const l = await entrada(c, { nome: 'L', qtd: 100 });
      const [ra, rp] = await Promise.all([
        req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' }),
        req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Morte', lote_id: l.id, quantidade_animais: 1, data_movimentacao: '2026-11-02' }),
      ]);
      assert.ok(![ra.statusCode, rp.statusCode].includes(500), `${ra.body} / ${rp.body}`);
      assert.ok(!(ra.statusCode === 201 && rp.statusCode === 201), `rodada ${rodada}: ativação ${ra.statusCode} e POST ${rp.statusCode} ambos aceitos`);
      const movs = await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } });
      const ativa = await prisma().rebanhoLedgerAtivacao.count({ where: { cliente_id: c.cliente.id } });
      assert.ok(!(movs > 0 && ativa > 0), `rodada ${rodada}: movimento genérico gravado numa empresa ativada`);
    }
  });
});

// ═══ C: causalidade de peso ════════════════════════════════════════════════

const pesagem = (c, posicao, peso, dia) => rebanho(c, 'Pesagem', [{ lote_id: posicao.id, peso_medio_kg: peso }], { data_movimentacao: `2026-11-${dia}` });
const causal = 'REBANHO_PESO_DEPENDENCIA_CAUSAL';
describe('R2 C — peso causal em retroativo e cancelamento', () => {
  test('C1: cancelar pesagem que alimentou a transferência posterior → 409 causal com evento/posição/data/pesos; desfazendo na ordem inversa, funciona', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    const pes = await ok(pesagem(c, pA, 500, '01'));
    const tr = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 10 }], c.B, '02'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.deepEqual(await pesoObs(pB.id), [['2026-11-02', 500]]);
    const r = await exigirNadaGravado(c, () => cancelar(c, pes.movimentacao.id), 409, causal);
    const d = r.json().details;
    assert.deepEqual([d.evento_id, d.tipo, d.data, d.posicao_id, d.peso_registrado_kg, d.peso_recalculado_kg], [tr.evento.id, 'TRANSFERENCIA', '2026-11-02', pB.id, 500, 400]);
    await ok(cancelar(c, tr.movimentacao.id), 200);
    await ok(cancelar(c, pes.movimentacao.id), 200);
    assert.equal(Number((await posDb(pA.id)).peso_medio_kg), 400);
    const dup = await cancelar(c, pes.movimentacao.id);
    assert.equal(dup.statusCode, 409);
    await verificar(c);
  });

  test('C2: pesagem RETROATIVA antes de transferência que usou outro peso → 409; pesagem posterior (outro dia ou mesmo dia registrada depois) é independente e passa', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    const tr = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 10 }], c.B, '02'));
    const r = await exigirNadaGravado(c, () => pesagem(c, pA, 500, '01'), 409, causal);
    assert.equal(r.json().details.evento_id, tr.evento.id);
    await ok(pesagem(c, pA, 520, '03'));
    await ok(pesagem(c, pA, 510, '02'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.deepEqual(await pesoObs(pB.id), [['2026-11-02', 400]], 'B mantém o peso que tinha na data');
    await verificar(c);
  });

  test('C3: transferir dia 02 e depois dia 01 com o MESMO peso → aceito (fluxo principal); outra linhagem para B vira posição própria (sem interferência de peso)', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100, peso: 400 });
    const l2 = await entrada(c, { nome: 'OUTRO', qtd: 50, peso: 300, area: c.C ?? c.A });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 30 }], c.B, '02'));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 20 }], c.B, '01'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.equal(Number((await posDb(pB.id)).peso_medio_kg), 400);
    assert.equal((await posDb(pB.id)).quantidade_cabecas, 50);
    // Outra linhagem (300 kg) para a MESMA posição não acontece (identidade por origem); peso diferente só afeta via pesagem.
    const p2 = await pos(c, daEntrada(l2, c.A));
    await ok(transferir(c, [{ posicao_id: p2.id, quantidade: 10 }], c.B, '03'));
    await verificar(c);
  });

  test('C4: cancelar junção cujo peso alimentou transferência posterior → 409; ordem inversa funciona; cadeia A→B→C idem', async () => {
    const c = await cenario();
    const l1 = await entrada(c, { nome: 'L1', qtd: 30, peso: 400 });
    const l2 = await entrada(c, { nome: 'L2', qtd: 10, peso: 300 });
    await ativar(c);
    const p1 = await pos(c, daEntrada(l1, c.A));
    const p2 = await pos(c, daEntrada(l2, c.A));
    const jn = await ok(juntar(c, p1, [p2], { data_movimentacao: '2026-11-02' }));
    assert.equal(Number((await posDb(p1.id)).peso_medio_kg), 375);
    const t1 = await ok(transferir(c, [{ posicao_id: p1.id, quantidade: 8 }], c.B, '03'));
    const pB = await pos(c, daEntrada(l1, c.B));
    assert.deepEqual(await pesoObs(pB.id), [['2026-11-03', 375]]);
    const t2 = await ok(transferir(c, [{ posicao_id: pB.id, quantidade: 4 }], c.A, '04'));
    const r = await exigirNadaGravado(c, () => cancelar(c, jn.movimentacao.id), 409, causal);
    assert.equal(r.json().details.evento_id, t1.evento.id);
    // Cadeia: o dia 04 consome cabeças de B — a regra de saldo recusa antes (as duas protegem).
    await exigirNadaGravado(c, () => cancelar(c, t1.movimentacao.id), 409, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO');
    // Dependência SÓ de peso na cadeia: uma pesagem de B no dia 03 mudaria o peso que t2 (dia 04, B→A) levou.
    const rB = await exigirNadaGravado(c, () => rebanho(c, 'Pesagem', [{ lote_id: pB.id, peso_medio_kg: 390 }], { area_id: c.B.id, data_movimentacao: '2026-11-03' }), 409, causal);
    assert.equal(rB.json().details.evento_id, t2.evento.id, 'cadeia: a transferência do dia 04 usou o peso de B');
    await ok(cancelar(c, t2.movimentacao.id), 200);
    await ok(cancelar(c, t1.movimentacao.id), 200);
    await ok(cancelar(c, jn.movimentacao.id), 200);
    assert.equal(Number((await posDb(p1.id)).peso_medio_kg), 400);
    await verificar(c);
  });

  test('C5: origem SEM peso → destino null (nunca zero); pesagem retroativa que tornaria o destino conhecido → 409; sem dependência, pesagem e cancelamento funcionam', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: null });
    const solo = await entrada(c, { nome: 'SOLO', qtd: 10, peso: 350 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 10 }], c.B, '02'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.deepEqual(await pesoObs(pB.id), [['2026-11-02', null]]);
    await exigirNadaGravado(c, () => pesagem(c, pA, 450, '01'), 409, causal);
    const pS = await pos(c, daEntrada(solo, c.A));
    const ps = await ok(pesagem(c, pS, 360, '01'));
    await ok(cancelar(c, ps.movimentacao.id), 200);
    assert.equal(Number((await posDb(pS.id)).peso_medio_kg), 350);
    await verificar(c);
  });

  test('C6: concorrência 3× — cancelar pesagem × transferência que lê esse peso: serializa, sem 500, B sempre coerente com A na data', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await cenario();
      const l = await entrada(c, { qtd: 40, peso: 400 });
      await ativar(c);
      const pA = await pos(c, daEntrada(l, c.A));
      const pes = await ok(pesagem(c, pA, 500, '01'));
      const [rc, rt] = await Promise.all([cancelar(c, pes.movimentacao.id), transferir(c, [{ posicao_id: pA.id, quantidade: 10 }], c.B, '02')]);
      assert.ok([200, 409].includes(rc.statusCode) && [201].includes(rt.statusCode), `${rc.statusCode} ${rc.body} / ${rt.statusCode} ${rt.body}`);
      const pB = await pos(c, daEntrada(l, c.B));
      const esperado = rc.statusCode === 200 ? 400 : 500;
      assert.deepEqual(await pesoObs(pB.id), [['2026-11-02', esperado]], `rodada ${rodada}`);
      await verificar(c);
    }
  });
  test('C7: MESMO dia — pesagem registrada ANTES da transferência alimenta o destino; cancelá-la → 409; desempate é a ordem de registro', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    const pes = await ok(pesagem(c, pA, 480, '02'));
    const tr = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 10 }], c.B, '02'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.deepEqual(await pesoObs(pB.id), [['2026-11-02', 480]]);
    const r = await exigirNadaGravado(c, () => cancelar(c, pes.movimentacao.id), 409, causal);
    assert.equal(r.json().details.evento_id, tr.evento.id);
    await verificar(c);
  });

  test('C8: falha injetada depois da verificação causal (transferência e manejo) → ZERO mudança, inclusive a reserva idempotente', async () => {
    for (const [passo, acao] of [
      ['apos_segunda_posicao', (c, pA) => transferir(c, [{ posicao_id: pA.id, quantidade: 5 }], c.B, '03')],
      ['apos_validar_manejo', (c, pA) => pesagem(c, pA, 470, '04')],
    ]) {
      await limparBanco();
      const c = await cenario();
      const l = await entrada(c, { qtd: 40, peso: 400 });
      await ativar(c);
      const pA = await pos(c, daEntrada(l, c.A));
      await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 10 }], c.B, '02'));
      const antes = await contagem(c);
      definirFalhaInjetadaLedger(passo);
      const r = await acao(c, pA);
      definirFalhaInjetadaLedger(null);
      assert.equal(r.statusCode, 500, `${passo}: ${r.body}`);
      assert.deepEqual(await contagem(c), antes, passo);
    }
  });
});

