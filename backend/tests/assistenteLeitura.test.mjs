/**
 * Assistente só de leitura (D-PROD-230) — PostgreSQL real, API da Anthropic FALSA.
 *
 * O cliente da API é trocado por um roteiro (`definirFabricaClienteAssistente`): cada
 * chamada devolve a próxima resposta e guarda o pedido. Prova: tenant só da sessão
 * (corpo com cliente_id é 400; fazenda de outro tenant é recusada; as ferramentas só
 * veem o próprio cliente), nada é gravado, chave ausente → ASSISTENTE_NAO_CONFIGURADO,
 * recusa da IA vira mensagem amigável e o laço termina em MAX_ITERACOES.
 * Relógio de teste: MAIKE_TESTE_AGORA = 2027-06-15T15:00:00Z.
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFabricaClienteAssistente, MAX_ITERACOES } from '../src/modules/assistente/assistenteService.js';
import { NOMES_FERRAMENTAS, estimarPorDescanso } from '../src/modules/assistente/assistenteFerramentas.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  definirFabricaClienteAssistente(null);
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});
afterEach(() => definirFabricaClienteAssistente(null));

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

/** Roteiro: lista de respostas; guarda os pedidos feitos à API. */
const roteiro = (respostas) => {
  const pedidos = [];
  let i = 0;
  definirFabricaClienteAssistente(() => ({
    beta: {
      messages: {
        create: async (params) => {
          pedidos.push(structuredClone(params));
          const r = typeof respostas === 'function' ? respostas(i) : respostas[Math.min(i, respostas.length - 1)];
          i += 1;
          return r;
        },
      },
    },
  }));
  return pedidos;
};
const usar = (nome, input = {}, id = `tu_${randomUUID().slice(0, 8)}`) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: nome, input }] });
const final = (texto) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] });
const resultadoDe = (pedido) => JSON.parse(pedido.messages.at(-1).content[0].content);

let seq = 0;
const tenantComPasto = async (nomePasto) => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda ${c}`, fuso_horario: 'America/Sao_Paulo' } });
  const s = await prisma().setor.create({ data: { cliente_id: c, empresa_id: e.id, numero_setor: '1', nome: 'SETOR 1' } });
  const cultura = await prisma().cultura.create({ data: { cliente_id: c, empresa_id: e.id, codigo: '001', tipo: 'PASTAGEM', nome: 'MARANDU', altura_entrada_cm: 25, altura_saida_cm: 15, dias_descanso: 30 } });
  seq += 1;
  const pasto = await prisma().areaPastagem.create({
    data: { cliente_id: c, empresa_id: e.id, setor_id: s.id, setor_nome: s.nome, numero_area: `AS${seq}-${randomUUID().slice(0, 6)}`, nome: nomePasto, tamanho_hectares: 10, cultura_id: cultura.id, tipo_pastagem: cultura.nome },
  });
  await prisma().medicaoForragem.create({
    data: { id: randomUUID(), cliente_id: c, empresa_id: e.id, area_id: pasto.id, cultura_id: cultura.id, data_medicao: new Date('2027-06-10T00:00:00Z'), metodo: 'REGUA', leituras_cm: [26, 28], qtd_leituras: 2, altura_media_cm: 27, situacao: 'PRONTO', altura_entrada_cm: 25, altura_saida_cm: 15, updatedAt: new Date() },
  });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { token: corpo.token, clienteId: c, empresa: e, pasto };
};

describe('assistente só de leitura (D-PROD-230)', () => {
  test('as ferramentas são um conjunto fechado e só de leitura', () => {
    assert.deepEqual([...NOMES_FERRAMENTAS].sort(), ['leituras_cocho_recentes', 'listar_pastos', 'medicoes_do_pasto', 'rebanho_por_pasto', 'resumo_rebanho']);
    for (const nome of NOMES_FERRAMENTAS) assert.doesNotMatch(nome, /criar|gravar|excluir|alterar|atualizar|mover|lancar|sql/i);
  });

  test('a estimativa por descanso é a mesma regra da tela', () => {
    // Espelho de estimarSituacaoPorDescanso (src/domain/pastagem/farolForragem.js, D-PROD-223).
    const casos = [[0, 30, 'DESCANSO'], [29, 30, 'DESCANSO'], [30, 30, 'PRONTO'], [45, 30, 'PRONTO'], [46, 30, 'PASSOU'], [10, null, null], [null, 30, null]];
    for (const [d, D, esperado] of casos) assert.equal(estimarPorDescanso(d, D), esperado, `d=${d} D=${D}`);
  });

  test('responde com os dados da PRÓPRIA fazenda; outro tenant não aparece; nada é gravado', async () => {
    const a = await tenantComPasto('PASTO DO A');
    const b = await tenantComPasto('PASTO DO B');
    const antes = { medicoes: await prisma().medicaoForragem.count(), auditoria: await prisma().auditLog.count(), areas: await prisma().areaPastagem.count() };
    const pedidos = roteiro([usar('listar_pastos'), usar('medicoes_do_pasto', { area_id: b.pasto.id }), final('O PASTO DO A está pronto.')]);

    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'Quais pastos estão prontos?' });
    assert.equal(r.statusCode, 200, r.body);
    const corpo = r.json();
    assert.equal(corpo.resposta, 'O PASTO DO A está pronto.');
    assert.deepEqual(corpo.ferramentas, ['listar_pastos', 'medicoes_do_pasto']);

    // 1ª ferramenta: só o pasto do tenant A, com a situação da medição válida.
    const pastos = resultadoDe(pedidos[1]);
    assert.deepEqual(pastos.map((p) => p.nome), ['PASTO DO A']);
    assert.equal(pastos[0].forragem.situacao, 'Pronto');
    assert.equal(pastos[0].dias_descanso, 30);
    // 2ª ferramenta: a IA pediu o pasto do tenant B pelo id — volta vazio.
    assert.deepEqual(resultadoDe(pedidos[2]), []);
    // O texto de nenhum pedido contém dados do tenant B.
    assert.doesNotMatch(JSON.stringify(pedidos), /PASTO DO B/);
    // A pergunta leva o dia da fazenda; modelo, ferramentas e fallback estão no pedido.
    assert.match(pedidos[0].messages.at(-1).content, /^Hoje é 2027-06-15\./);
    assert.equal(pedidos[0].model, 'claude-opus-5-5');
    assert.equal(pedidos[0].fallbacks, 'default');

    const depois = { medicoes: await prisma().medicaoForragem.count(), auditoria: await prisma().auditLog.count(), areas: await prisma().areaPastagem.count() };
    assert.deepEqual(depois, antes);
  });

  test('tenant só da sessão: cliente_id no corpo é 400 e fazenda de outro tenant é recusada', async () => {
    const a = await tenantComPasto('PASTO DO A');
    const b = await tenantComPasto('PASTO DO B');
    const pedidos = roteiro([final('x')]);
    const comCliente = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, cliente_id: b.clienteId, pergunta: 'oi' });
    assert.equal(comCliente.statusCode, 400);
    const outra = await req('POST', '/assistente/perguntar', a.token, { empresa_id: b.empresa.id, pergunta: 'oi' });
    assert.ok(outra.statusCode >= 400 && outra.statusCode < 500, outra.body);
    assert.equal(pedidos.length, 0, 'a IA nem é chamada');
    const semLogin = await req('POST', '/assistente/perguntar', null, { empresa_id: a.empresa.id, pergunta: 'oi' });
    assert.equal(semLogin.statusCode, 401);
  });

  test('histórico validado e limitado', async () => {
    const a = await tenantComPasto('PASTO DO A');
    const pedidos = roteiro([final('ok')]);
    const longo = Array.from({ length: 11 }, () => ({ papel: 'usuario', texto: 'x' }));
    assert.equal((await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi', historico: longo })).statusCode, 400);
    assert.equal((await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi', historico: [{ papel: 'sistema', texto: 'x' }] })).statusCode, 400);
    const ok = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'e agora?', historico: [{ papel: 'usuario', texto: 'oi' }, { papel: 'assistente', texto: 'olá' }] });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi', tela: 'x y' })).statusCode, 400);
    const comTela = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi', tela: 'CadastroLotes' });
    assert.equal(comTela.statusCode, 200);
    assert.match(pedidos.at(-1).messages.at(-1).content, /Tela aberta: CadastroLotes\./);
    assert.deepEqual(pedidos[0].messages.slice(0, 2), [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }]);
  });

  test('sem chave da API → 503 ASSISTENTE_NAO_CONFIGURADO', async () => {
    const a = await tenantComPasto('PASTO DO A');
    definirFabricaClienteAssistente(null);
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' });
      assert.equal(r.statusCode, 503);
      assert.equal(r.json().code, 'ASSISTENTE_NAO_CONFIGURADO');
    } finally {
      if (chave !== undefined) process.env.ANTHROPIC_API_KEY = chave;
    }
  });

  test('recusa da IA vira mensagem amigável', async () => {
    const a = await tenantComPasto('PASTO DO A');
    roteiro([{ stop_reason: 'refusal', content: [] }]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().recusada, true);
    assert.match(r.json().resposta, /Não consigo responder/);
  });

  test('falha da API → 503 ASSISTENTE_INDISPONIVEL', async () => {
    const a = await tenantComPasto('PASTO DO A');
    definirFabricaClienteAssistente(() => ({ beta: { messages: { create: async () => { throw new Error('rede'); } } } }));
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' });
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().code, 'ASSISTENTE_INDISPONIVEL');
  });

  test('o laço termina em MAX_ITERACOES mesmo se a IA nunca parar de pedir ferramentas', async () => {
    const a = await tenantComPasto('PASTO DO A');
    const pedidos = roteiro(() => usar('resumo_rebanho'));
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(pedidos.length, MAX_ITERACOES);
    assert.match(r.json().resposta, /grande demais/);
  });

  test('ferramenta desconhecida não executa nada', async () => {
    const a = await tenantComPasto('PASTO DO A');
    const pedidos = roteiro([usar('apagar_tudo'), final('ok')]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(resultadoDe(pedidos[1]), { erro: 'ferramenta desconhecida: apagar_tudo' });
  });
});
