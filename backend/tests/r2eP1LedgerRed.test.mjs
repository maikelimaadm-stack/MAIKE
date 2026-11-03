/**
 * R2E-P1 (D-PROD-107) — RED na main f7a8ea3: Lote mistura cadastro de entrada
 * com saldo operacional. PostgreSQL real, HTTP autenticado, dados sintéticos.
 *
 * Reprodução documental (evidência em
 * docs/engineering/evidencias/r2e-p1-lotes-ssot/red-main.txt). Empresas que
 * NÃO ativaram o ledger continuam no modelo legado por desenho (fase expand),
 * então esta suíte só roda com R2E_RED=1. O comportamento correto, no ledger,
 * está em r2eP1LedgerRebanho.test.mjs.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { existeLancamentoPosterior } from '../../src/domain/lotes/ordemTemporal.js';

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
const BOI = 'Boi 25 a 36 meses';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const [A, B, C] = [await area(1, 'PASTO A'), await area(2, 'PASTO B'), await area(3, 'PASTO C')];
  const r = await req('POST', '/lotes', tok, {
    empresa_id: empresa.id, nome: 'LOTE 001', quantidade_cabecas: 500, categoria: BOI, sexo: 'Macho', setor_id: setor.id,
    area_entrada_id: A.id, area_atual_id: A.id, data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
  });
  assert.equal(r.statusCode, 201, r.body);
  return { cliente: adm.cliente, tok, empresa, A, B, C, lote: r.json() };
};
const transferir = (c, loteId, qtd, destino, dia) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
    operation_id: `op-${randomUUID()}`, tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: loteId,
    quantidade_animais: qtd, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}T12:00:00.000Z`,
  });
const lotes = async (c) =>
  (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { createdAt: 'asc' } })).map(
    (l) => `${l.nome}|${l.origem ?? '-'}|${l.quantidade_cabecas}|${l.area_atual_nome ?? l.area_atual_id}|entrada=${l.quantidade_entrada}`
  );

describe('R2E RED — cadastro e saldo misturados em Lote', { skip: process.env.R2E_RED === '1' ? false : 'reprodução RED da main; rode com R2E_RED=1' }, () => {
  test('R1: 500 em A; transfere 100 no dia 02 e depois 100 no dia 01 → cada parcial fabrica um Lote "MOVIMENTAÇÃO" no cadastro', async () => {
    const c = await cenario();
    const r02 = await transferir(c, c.lote.id, 100, c.B, '02');
    const r01 = await transferir(c, c.lote.id, 100, c.B, '01');
    const linhas = await lotes(c);
    console.log(`  dia 02: HTTP ${r02.statusCode} ${r02.json().movimentacao?.modo_transferencia ?? r02.json().code}`);
    console.log(`  dia 01: HTTP ${r01.statusCode} ${r01.json().movimentacao?.modo_transferencia ?? r01.json().code}`);
    console.log(`  Lote (${linhas.length} linhas):\n    ${linhas.join('\n    ')}`);
    // A tela, antes de enviar o dia 01, consulta a ordem temporal no navegador:
    const movs = (await req('GET', `/movimentacoes-mapa?empresa_id=${c.empresa.id}`, c.tok)).json();
    const lista = Array.isArray(movs) ? movs : movs.items ?? [];
    const daOrigem = lista.filter((m) => m.lote_id === c.lote.id && m.data_movimentacao?.startsWith('2026-11-02'));
    console.log(`  navegador (validarOrdemTemporalLote) recusaria o dia 01? ${existeLancamentoPosterior(daOrigem, '2026-11-01')}`);
    assert.equal(linhas.length, 1, 'o cadastro deveria ter só a entrada de 500');
  });

  test('R2: segunda transferência no MESMO dia 02 → o comparador do navegador acusa "posterior" (meia-noite × meio-dia)', async () => {
    const c = await cenario();
    const r = await transferir(c, c.lote.id, 100, c.B, '02');
    const mov = r.json().movimentacao;
    const bloqueia = existeLancamentoPosterior([{ ...mov, created_date: mov.created_date ?? new Date().toISOString() }], '2026-11-02');
    console.log(`  já existe transferência 2026-11-02T12:00Z; nova no dia "2026-11-02" é bloqueada pela tela? ${bloqueia}`);
    assert.equal(bloqueia, false, 'mesmo dia não é posterior');
  });

  test('R3: origem SEM estoque na data (B só recebeu no dia 05) aceita transferência B→C no dia 01 porque o servidor só olha o saldo de hoje', async () => {
    const c = await cenario();
    const r05 = await transferir(c, c.lote.id, 100, c.B, '05');
    const derivado = r05.json().lotes.find((l) => l.area_atual_id === c.B.id);
    const r01 = await transferir(c, derivado.id, 50, c.C, '01');
    console.log(`  A→B dia 05: HTTP ${r05.statusCode}; B→C dia 01: HTTP ${r01.statusCode} ${r01.json().code ?? ''}`);
    console.log(`  Lote:\n    ${(await lotes(c)).join('\n    ')}`);
    assert.equal(r01.statusCode, 409, 'no dia 01 a área B não tinha nenhuma cabeça');
  });
});
