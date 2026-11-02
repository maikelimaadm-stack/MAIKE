/**
 * PR174-R1 (D-PROD-107) — reset CONTROLADO de dados de TESTE de UMA empresa
 * (scripts/ops/reset-rebanho-empresa-teste.mjs), para a ativação em modo
 * `entradas` reconstruir a linha do tempo a partir das entradas reais.
 * Prova: escopo fechado (outra empresa do mesmo cliente e outro cliente
 * intactos), backup antes de alterar, travas (nome, ledger ativo, backup) e
 * rollback total em falha.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';
import { planejarReset, executarReset, ResetRecusado } from '../../scripts/ops/resetRebanhoEmpresaTesteLib.mjs';

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
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
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

const ativar = (c) => req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
const transferirLegado = (c, lote, quantidade, destino) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
    operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: lote.id, quantidade_animais: quantidade,
    data_movimentacao: '2026-10-28', area_destino_id: destino.id, categoria_animal: BOI,
  });
const morteLegada = (c, quantidade) =>
  req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, {
    operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-29', linhas: [{ categoria: BOI, quantidade, causa_morte: 'Doença' }],
  });
const foto = async (clienteId, empresaId) => {
  const p = prisma();
  const w = { cliente_id: clienteId, ...(empresaId ? { empresa_id: empresaId } : {}) };
  return {
    lotes: (await p.lote.findMany({ where: w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.area_atual_id, l.status, l.categoria, l.excluido_em ? 'X' : '-']),
    movs: (await p.movimentacaoMapa.findMany({ where: w, orderBy: { id: 'asc' } })).map((m) => m.id),
    audits: empresaId ? null : await p.auditLog.count({ where: { cliente_id: clienteId } }),
  };
};
/** Empresa de teste com histórico legado: transferência parcial (cria derivado) + morte. */
const comHistorico = async () => {
  const c = await cenario();
  const l = await entrada(c, { nome: 'COMPRA', qtd: 100 });
  const r1 = await transferirLegado(c, l, 30, c.B);
  assert.equal(r1.statusCode, 201, r1.body);
  const r2 = await morteLegada(c, 5);
  assert.equal(r2.statusCode, 201, r2.body);
  return { c, l };
};

describe('R1 reset controlado de dados de teste (escopo fechado)', () => {
  test('RS1: sem reset a ativação por entradas recusa; reset → entradas restauradas, derivado retirado, outra empresa e outro cliente intactos; ativação 201', async () => {
    const { c, l } = await comHistorico();
    // Outra empresa do MESMO cliente e outro cliente: não podem mudar.
    const outraEmpresa = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: outraEmpresa.id, dados: { tipo: 'Transferência de Área' } } });
    const vizinho = await comHistorico();
    const antesOutra = await foto(c.cliente.id, outraEmpresa.id);
    const antesVizinho = await foto(vizinho.c.cliente.id);

    const recusa = await ativar(c);
    assert.equal(recusa.statusCode, 409, recusa.body);
    assert.equal(recusa.json().code, 'REBANHO_ATIVACAO_ENTRADAS_COM_HISTORICO');

    const plano = await planejarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id });
    assert.deepEqual(plano, { empresa_nome: 'Fazenda', movimentacoes_a_apagar: 2, lotes_de_entrada: 1, lotes_a_restaurar: 1, lotes_derivados_ou_nascidos_a_retirar: 1, operacoes_a_invalidar: 2, vinculos_pendentes: 0 });
    let backup = null;
    const resumo = await executarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, confirmarEmpresaNome: 'Fazenda', gravarBackup: (b) => { backup = b; } });
    assert.deepEqual(resumo, { movimentacoes_apagadas: 2, lotes_restaurados: 1, lotes_retirados: 1, operacoes_invalidadas: 2, lotes_de_entrada: 1 });
    assert.equal(backup.movimentacoes_mapa.length, 2);
    assert.equal(backup.lotes.length, 2);
    assert.deepEqual(backup.escopo, { cliente_id: c.cliente.id, empresa_id: c.empresa.id });

    const depois = await prisma().lote.findUnique({ where: { cliente_id_id: { cliente_id: c.cliente.id, id: l.id } } });
    assert.deepEqual([depois.quantidade_cabecas, depois.area_atual_id, depois.status, depois.excluido_em], [100, c.A.id, 'Ativo', null]);
    const derivados = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, NOT: { id: l.id } } });
    assert.equal(derivados.length, 1);
    assert.ok(derivados[0].excluido_em, 'derivado sai por exclusão lógica (linha preservada)');
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id, empresa_id: c.empresa.id } }), 0);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, acao: 'reset_rebanho_teste' } }), 1);

    assert.deepEqual(await foto(c.cliente.id, outraEmpresa.id), antesOutra, 'outra empresa do mesmo cliente intacta');
    assert.deepEqual(await foto(vizinho.c.cliente.id), antesVizinho, 'outro cliente intacto');

    const ok = await ativar(c);
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(ok.json().total_cabecas, 100);
    assert.equal(ok.json().data_corte, '2026-10-25');
  });

  test('RS2: travas — nome divergente, backup que falha e ledger já ativo → RECUSA e nada muda', async () => {
    const { c } = await comHistorico();
    const antes = await foto(c.cliente.id);
    await assert.rejects(
      executarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, confirmarEmpresaNome: 'fazenda', gravarBackup: () => {} }),
      (e) => e instanceof ResetRecusado && e.codigo === 'CONFIRMACAO_DIVERGENTE',
    );
    await assert.rejects(
      executarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, confirmarEmpresaNome: 'Fazenda', gravarBackup: () => { throw new Error('disco cheio'); } }),
      /disco cheio/,
    );
    await assert.rejects(executarReset(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, confirmarEmpresaNome: 'Fazenda' }), (e) => e.codigo === 'BACKUP_OBRIGATORIO');
    await assert.rejects(planejarReset(prisma(), { clienteId: c.cliente.id, empresaId: '' }), (e) => e.codigo === 'ESCOPO_OBRIGATORIO');
    assert.deepEqual(await foto(c.cliente.id), antes, 'nada alterado');

    // Empresa de OUTRO cliente pelo id: fora do escopo.
    const vizinho = await cenario();
    await assert.rejects(planejarReset(prisma(), { clienteId: c.cliente.id, empresaId: vizinho.empresa.id }), (e) => e.codigo === 'EMPRESA_FORA_DO_ESCOPO');

    // Ledger já ativo: o reset é só antes da ativação.
    const limpa = await cenario();
    await entrada(limpa, { qtd: 10 });
    assert.equal((await ativar(limpa)).statusCode, 201);
    const antesAtiva = await foto(limpa.cliente.id);
    await assert.rejects(planejarReset(prisma(), { clienteId: limpa.cliente.id, empresaId: limpa.empresa.id }), (e) => e.codigo === 'LEDGER_JA_ATIVO');
    assert.deepEqual(await foto(limpa.cliente.id), antesAtiva);
  });
});
