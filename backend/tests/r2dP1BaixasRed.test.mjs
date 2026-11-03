/**
 * R2D-P1 (D-PROD-105) — RED: baixa (Morte/Abate) de VÁRIOS lotes da mesma
 * categoria pelo laço do navegador (`DetalhesLote.handleMorte/handleAbate`):
 * um comando R2A `manejo-lote` POR LOTE, cada um na sua transação. Este
 * arquivo reproduz o laço exatamente como o handler faz (ordem dos lotes da
 * tela, `quantidadeAplicavel`, chave por envio+lote) e prova o que fica
 * gravado quando uma chamada do meio falha.
 *
 * PostgreSQL real, HTTP autenticado, dados sintéticos.
 *
 * É a reprodução RED da main 52bc804 (evidência em
 * docs/engineering/evidencias/r2d-p1-baixas-multilotes/red-main.txt). O laço
 * legado continua não atômico por natureza — a correção é a tela não usá-lo
 * mais —, então a suíte só roda com R2D_RED=1. A proteção equivalente no
 * comando (agora só no ledger, PR174-R5) está em r2eR5ComandosLedgerConvertidos.test.mjs (A1, A2, B1, K1).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { quantidadeAplicavel } from '../../src/domain/lotes/movimentacaoLote.js';

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
const DATA = '2026-10-30T12:00:00.000Z';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const A = await p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: '1', nome: 'PASTO A', tamanho_hectares: 10 } });
  const lote = async (nome, qtd) => {
    const r = await req('POST', '/lotes', tok, {
      empresa_id: empresa.id, nome, quantidade_cabecas: qtd, categoria: BOI, sexo: 'Macho', setor_id: setor.id,
      area_entrada_id: A.id, area_atual_id: A.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const lotes = [await lote('L40', 40), await lote('L30', 30), await lote('L20', 20)];
  return { cliente: adm.cliente, tok, empresa, A, lotes };
};

const foto = async (c) => {
  const p = prisma();
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { nome: 'asc' } });
  return {
    lotes: lotes.map((l) => `${l.nome}:${l.quantidade_cabecas}/${l.status}`).join(' '),
    total: lotes.filter((l) => l.status === 'Ativo').reduce((t, l) => t + l.quantidade_cabecas, 0),
    movs: await p.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }),
    audits: await p.auditLog.count({ where: { cliente_id: c.cliente.id } }),
    ops: await p.operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }),
  };
};

/**
 * Laço do handler (main 52bc804, DetalhesLote.jsx handleMorte/handleAbate):
 * para cada lote da categoria (ordem da tela, saldo LIDO NA RENDERIZAÇÃO),
 * `quantidadeAplicavel` e UM POST manejo-lote. `antesDaChamada(n)` simula
 * a rede: lançar = a chamada n não chegou ao servidor.
 */
const lacoLegado = async (c, { tipo, quantidade, lotesDaTela = c.lotes, envio = randomUUID(), antesDaChamada = async () => {} }) => {
  let restante = quantidade;
  let n = 0;
  const respostas = [];
  for (const lote of lotesDaTela) {
    const qtd = quantidadeAplicavel(restante, lote);
    if (qtd <= 0) continue;
    n += 1;
    await antesDaChamada(n, lote);
    const r = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
      operation_id: `manejo-${envio}-${tipo.toLowerCase()}-${lote.id}`, tipo, empresa_id: c.empresa.id, lote_id: lote.id,
      quantidade_animais: qtd, data_movimentacao: DATA, observacoes: `Categoria: ${BOI}.`,
    });
    respostas.push(r.statusCode);
    if (r.statusCode >= 400) throw Object.assign(new Error(`HTTP ${r.statusCode} ${r.json().code}`), { respostas });
    restante -= qtd;
    if (restante <= 0) break;
  }
  return { respostas, restante };
};

const registrar = (rotulo, antes, depois, extra = '') =>
  console.log(`  [${rotulo}]\n  ANTES  ${JSON.stringify(antes)}\n  DEPOIS ${JSON.stringify(depois)}${extra ? `\n  ${extra}` : ''}`);

/** Propriedade exigida: tudo ou nada. */
const exigirNadaGravado = (antes, depois) => assert.deepEqual(depois, antes, 'falha numa parte da confirmação não pode deixar baixa parcial');

describe('R2D RED — baixa multi-lote pelo laço do navegador', { skip: process.env.R2D_RED === '1' ? false : 'reprodução RED da main; rode com R2D_RED=1' }, () => {
  test('R0: o comando atômico novo não existe na main → 404', async () => {
    const c = await cenario();
    const r = await req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: 'op-r0-00000001' });
    console.log(`  POST /movimentacoes-mapa/comandos/baixa-rebanho → HTTP ${r.statusCode}`);
    assert.notEqual(r.statusCode, 404, 'endpoint de baixa multi-lote ausente');
  });

  test('R1: MORTE 60 em 40+30+20, falha de rede na 2ª chamada → 40 já baixadas', async () => {
    const c = await cenario();
    const antes = await foto(c);
    const erro = await lacoLegado(c, { tipo: 'Morte', quantidade: 60, antesDaChamada: async (n) => { if (n === 2) throw new Error('rede caiu na 2ª chamada'); } }).catch((e) => e);
    const depois = await foto(c);
    registrar('R1', antes, depois, `tela: ${erro?.message}`);
    exigirNadaGravado(antes, depois);
  });

  test('R2: ABATE 60, 2ª linha recusada pelo servidor (lote excluído do cadastro entre a tela e o envio) → 40 já baixadas', async () => {
    const c = await cenario();
    const antes = await foto(c);
    const erro = await lacoLegado(c, {
      tipo: 'Abate', quantidade: 60,
      antesDaChamada: async (n, lote) => { if (n === 2) await prisma().lote.update({ where: { id: lote.id }, data: { excluido_em: new Date() } }); },
    }).catch((e) => e);
    const depois = await foto(c);
    registrar('R2', antes, depois, `tela: ${erro?.message}`);
    exigirNadaGravado({ ...antes, lotes: undefined, total: undefined }, { ...depois, lotes: undefined, total: undefined });
  });

  test('R3: MORTE 80 em três lotes, 3ª linha falha (lote inativado entre a tela e o envio) → 70 já baixadas', async () => {
    const c = await cenario();
    const antes = await foto(c);
    const erro = await lacoLegado(c, {
      tipo: 'Morte', quantidade: 80,
      antesDaChamada: async (n, lote) => { if (n === 3) await prisma().lote.update({ where: { id: lote.id }, data: { status: 'Inativo' } }); },
    }).catch((e) => e);
    const depois = await foto(c);
    registrar('R3', antes, depois, `tela: ${erro?.message}`);
    assert.equal(depois.movs, 0, 'nenhum movimento deveria existir');
  });

  test('R4: duplo clique (dois envios do formulário, chaves diferentes) → baixa repetida ou erro depois de baixa', async () => {
    const c = await cenario();
    const antes = await foto(c);
    const [x, y] = await Promise.allSettled([lacoLegado(c, { tipo: 'Morte', quantidade: 30 }), lacoLegado(c, { tipo: 'Morte', quantidade: 30 })]);
    const depois = await foto(c);
    registrar('R4', antes, depois, `envio1: ${x.status} ${x.reason?.message ?? ''} | envio2: ${y.status} ${y.reason?.message ?? ''}`);
    assert.equal(antes.total - depois.total, 30, 'um clique pedido = 30 baixadas');
  });

  test('R5: timeout com resposta perdida na 1ª chamada; usuário reenvia (novo envio) → erro com 40 já baixadas', async () => {
    const c = await cenario();
    const antes = await foto(c);
    // 1ª tentativa: o servidor grava a 1ª linha, a resposta da 2ª se perde (timeout) antes de chegar.
    const t1 = await lacoLegado(c, { tipo: 'Morte', quantidade: 60, antesDaChamada: async (n) => { if (n === 2) throw new Error('timeout'); } }).catch((e) => e);
    // Reenvio: a tela ainda mostra os saldos antigos (40/30/20) e o formulário gera chave nova.
    const t2 = await lacoLegado(c, { tipo: 'Morte', quantidade: 60 }).catch((e) => e);
    const depois = await foto(c);
    registrar('R5', antes, depois, `tentativa1: ${t1?.message} | reenvio: ${t2?.message ?? 'ok'}`);
    assert.equal(antes.total - depois.total, 60);
    assert.equal(depois.movs, 1, 'uma confirmação = um movimento');
  });

  test('R6: quantidade acima do disponível (100 em 90) → baixa 90 e "sucesso", sem recusa', async () => {
    const c = await cenario();
    const antes = await foto(c);
    const r = await lacoLegado(c, { tipo: 'Abate', quantidade: 100 }).catch((e) => e);
    const depois = await foto(c);
    registrar('R6', antes, depois, `tela: ${r instanceof Error ? r.message : `sucesso; restante não baixado = ${r.restante}`}`);
    exigirNadaGravado(antes, depois);
  });
});
