/**
 * PR174-R5 (D-PROD-107) — cutover sem legado: empresa nova nasce ativada,
 * empresa não migrada recebe 409 REBANHO_CUTOVER_PENDENTE (o modelo antigo de
 * saldo em Lote não roda mais) e o cutover administrativo (scripts/ops/
 * cutover-rebanho.mjs) migra uma empresa por vez, preservando acesso.
 * PostgreSQL real + HTTP autenticado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger, ativarEmpresaNaTransacao } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';
import { diagnosticarEmpresa, executarCutover } from '../../scripts/ops/cutoverRebanhoLib.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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





const VACA = 'Vaca + 36 meses';
const CUTOVER = 'REBANHO_CUTOVER_PENDENTE';
const qtdLotes = (c) => prisma().lote.count({ where: { cliente_id: c.cliente.id } });
const adminDe = async (c) => (await prisma().usuario.findFirst({ where: { cliente_id: c.cliente.id, papel_tenant: 'administrador' } })).id;
const acessos = async (c) => ({
  usuarios: await prisma().usuario.findMany({ where: { cliente_id: c.cliente.id }, select: { id: true, login: true, senha_hash: true, papel_tenant: true, ativo: true }, orderBy: { id: 'asc' } }),
  permissoes: await prisma().permissao.count({ where: { cliente_id: c.cliente.id } }),
  empresas: await prisma().empresa.findMany({ where: { cliente_id: c.cliente.id }, select: { id: true, nome: true }, orderBy: { id: 'asc' } }),
  areas: await prisma().areaPastagem.count({ where: { cliente_id: c.cliente.id } }),
});
/** Movimento legado pré-existente (base antiga), escrito direto no banco. */
const legadoTransferido = async (c, l, qtd) => {
  await prisma().lote.update({ where: { id: l.id }, data: { quantidade_cabecas: l.quantidade_cabecas - qtd } });
  return prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: qtd, data_movimentacao: '2026-10-28' } } });
};

describe('R5 — sem legado: guarda única, empresa nova ativada, cutover administrativo', () => {
  test('G1: empresa NÃO migrada → todo comando do mapa 409 REBANHO_CUTOVER_PENDENTE, nada gravado; nenhum Lote alterado', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100 });
    const corpos = [
      ['/movimentacoes-mapa/comandos/manejo-lote', { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: l.id, quantidade_animais: 100, data_movimentacao: '2026-10-28', area_destino_id: c.B.id, categoria_animal: BOI }],
      ['/movimentacoes-mapa/comandos/baixa-rebanho', { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-29', linhas: [{ categoria: BOI, quantidade: 2, causa_morte: 'Doença' }] }],
      ['/movimentacoes-mapa/comandos/manejo-rebanho', { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-29', linhas: [{ lote_id: l.id, peso_medio_kg: 420 }] }],
    ];
    for (const [url, body] of corpos) await exigirNadaGravado(c, () => req('POST', url, c.tok, body), 409, CUTOVER);
    const cad = await prisma().lote.findUnique({ where: { id: l.id } });
    assert.deepEqual([cad.quantidade_cabecas, cad.area_atual_id], [100, c.A.id]);
  });

  test('G2: empresa criada pela API nasce ATIVADA; transferência parcial para pasto VAZIO, nascimento e mudança parcial → 201, nenhum Lote criado', async () => {
    const c = await cenario();
    const r = await req('POST', '/empresas', c.tok, { nome: 'Nova Fazenda', apelido: 'NOVA' });
    assert.equal(r.statusCode, 201, r.body);
    const emp = r.json();
    const setor = await prisma().setor.create({ data: { cliente_id: c.cliente.id, empresa_id: emp.id, numero_setor: '1', nome: 'S1' } });
    const area = (n) => prisma().areaPastagem.create({ data: { cliente_id: c.cliente.id, empresa_id: emp.id, setor_id: setor.id, setor_nome: 'S1', numero_area: String(n), nome: `P${n}`, tamanho_hectares: 10 } });
    const n = { ...c, empresa: emp, setor, A: await area(1), B: await area(2) };
    assert.equal((await req('GET', `/rebanho/posicoes?empresa_id=${emp.id}`, c.tok)).json().ativo, true);
    const l = await entrada(n, { qtd: 500, peso: 400 });
    await entrada(n, { nome: 'VACAS', qtd: 20, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    const antes = await qtdLotes(n);
    const pA = await pos(n, daEntrada(l, n.A));
    await ok(req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: emp.id, area_destino_id: n.B.id, data_movimentacao: '2026-11-02', itens: [{ posicao_id: pA.id, quantidade: 200 }] }));
    await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Nascimento', empresa_id: emp.id, area_id: n.A.id, data_movimentacao: '2026-11-03', linhas: [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 3 }] }));
    await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: emp.id, area_id: n.A.id, data_movimentacao: '2026-11-04', linhas: [{ categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 50 }] }));
    assert.equal(await qtdLotes(n), antes, 'nenhum Lote criado por manejo');
    const cad = await prisma().lote.findUnique({ where: { id: l.id } });
    assert.deepEqual([cad.quantidade_cabecas, cad.area_atual_id], [500, n.A.id]);
  });

  test('C1: cutover `entradas` de empresa limpa → ativa, posições = entradas, Lote intacto; reexecução JA_ATIVA', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 80 });
    const d = await diagnosticarEmpresa(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id });
    assert.deepEqual([d.ativa, d.apto_para_entradas, d.recomendacao], [false, true, 'entradas']);
    const r = await executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'entradas', usuarioId: await adminDe(c), confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao });
    assert.equal(r.resultado, 'ATIVADA');
    assert.equal((await pos(c, daEntrada(l, c.A))).quantidade_cabecas, 80);
    assert.equal((await executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'entradas', usuarioId: await adminDe(c), confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao })).resultado, 'JA_ATIVA');
    await verificar(c);
  });

  test('C2: empresa com histórico legado: `entradas` RECUSA sem mudar nada; `reset_e_entradas` autorizado zera lançamentos, preserva usuários/senhas/permissões/empresas/áreas e não toca outra empresa nem outro tenant', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100 });
    await legadoTransferido(c, l, 30);
    const outra = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, dados: { tipo: 'Morte' } } });
    const viz = await cenario();
    const lv = await entrada(viz, { qtd: 10 });
    await legadoTransferido(viz, lv, 1);
    const acessoAntes = await acessos(c);
    const vizAntes = [await prisma().movimentacaoMapa.count({ where: { cliente_id: viz.cliente.id } }), await prisma().lote.findUnique({ where: { id: lv.id } })];
    const antes = await contagem(c);
    await assert.rejects(executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'entradas', usuarioId: await adminDe(c), confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao }), (e) => e.codigo === 'REBANHO_ATIVACAO_ENTRADAS_COM_HISTORICO');
    assert.deepEqual(await contagem(c), antes, 'recusa não muda nada');
    let backup = null;
    const r = await executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'reset_e_entradas', usuarioId: await adminDe(c), confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao, gravarBackup: (b) => { backup = b; } });
    assert.equal(r.resultado, 'ATIVADA');
    assert.equal(backup.movimentacoes_mapa.length, 1);
    assert.ok(!JSON.stringify(backup).includes('senha_hash'), 'backup sem segredos de acesso');
    assert.equal((await pos(c, daEntrada(l, c.A))).quantidade_cabecas, 100);
    assert.deepEqual(await acessos(c), acessoAntes, 'acesso, empresas e áreas preservados');
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id, empresa_id: outra.id } }), 1, 'outra empresa intacta');
    assert.deepEqual([await prisma().movimentacaoMapa.count({ where: { cliente_id: viz.cliente.id } }), await prisma().lote.findUnique({ where: { id: lv.id } })], vizAntes, 'outro tenant intacto');
    // Login continua funcionando depois do cutover
    assert.ok((await autenticarNoApp(app, c.credenciais ?? { login: acessoAntes.usuarios[0].login, senha: 'senha-de-teste-1' })).corpo.token);
    await verificar(c);
  });

  test('C3: `saldo_abertura` preserva o histórico legado (corte ≥ último movimento); travas: nome divergente, não-administrador → recusa sem mudar nada', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100 });
    await legadoTransferido(c, l, 30);
    const antes = await contagem(c);
    await assert.rejects(executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'saldo_abertura', dataCorte: '2026-10-30', usuarioId: await adminDe(c), confirmarEmpresaNome: 'fazenda', ativarEmpresaNaTransacao }), (e) => e.codigo === 'CONFIRMACAO_DIVERGENTE');
    await assert.rejects(executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'saldo_abertura', dataCorte: '2026-10-30', usuarioId: 'nao-existe', confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao }), (e) => e.codigo === 'ADMINISTRADOR_OBRIGATORIO');
    assert.deepEqual(await contagem(c), antes);
    const r = await executarCutover(prisma(), { clienteId: c.cliente.id, empresaId: c.empresa.id, estrategia: 'saldo_abertura', dataCorte: '2026-10-30', usuarioId: await adminDe(c), confirmarEmpresaNome: 'Fazenda', ativarEmpresaNaTransacao });
    assert.equal(r.resultado, 'ATIVADA');
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1, 'histórico legado preservado');
    await verificar(c);
  });

  test('C4: CLI — alvo com system_identifier divergente FALHA FECHADO (exit 3, nada alterado); diagnóstico é só leitura', async () => {
    const c = await cenario();
    await entrada(c, { qtd: 10 });
    const cli = fileURLToPath(new URL('../../scripts/ops/cutover-rebanho.mjs', import.meta.url));
    const base = { ...process.env, CUTOVER_DATABASE_URL: process.env.DATABASE_URL };
    const antes = await contagem(c);
    const div = spawnSync(process.execPath, [cli, '--cliente-id', c.cliente.id, '--empresa-id', c.empresa.id, '--executar', '--estrategia', 'entradas', '--confirmar-empresa', 'Fazenda', '--usuario-admin-id', await adminDe(c)], { env: { ...base, CUTOVER_EXPECTED_SYSTEM_IDENTIFIER: '1' }, encoding: 'utf8' });
    assert.equal(div.status, 3, div.stderr);
    assert.match(div.stderr, /system_identifier do alvo não confere/);
    assert.ok(!/postgresql:\/\//.test(div.stdout + div.stderr), 'nunca imprime a URL');
    const diag = spawnSync(process.execPath, [cli, '--cliente-id', c.cliente.id, '--empresa-id', c.empresa.id], { env: base, encoding: 'utf8' });
    assert.equal(diag.status, 0, diag.stderr);
    assert.match(diag.stdout, /"apto_para_entradas": true/);
    assert.deepEqual(await contagem(c), antes);
    assert.equal(await prisma().rebanhoLedgerAtivacao.count({ where: { cliente_id: c.cliente.id } }), 0);
  });
});
