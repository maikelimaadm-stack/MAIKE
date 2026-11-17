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
import { definirFabricaClienteAssistente, MAX_ITERACOES, PROMPT_SISTEMA } from '../src/modules/assistente/assistenteService.js';
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
        // Imita o MessageStream do SDK: `.on('text', cb)` e `finalMessage()`.
        stream: (params) => {
          pedidos.push(structuredClone(params));
          const r = typeof respostas === 'function' ? respostas(i) : respostas[Math.min(i, respostas.length - 1)];
          i += 1;
          const ouvintes = [];
          return {
            on(evento, cb) {
              if (evento === 'text') ouvintes.push(cb);
              return this;
            },
            async finalMessage() {
              if (r instanceof Error) throw r;
              for (const b of r.content ?? []) {
                if (b.type !== 'text') continue;
                // Dois pedaços por bloco, como chegaria da API.
                const meio = Math.ceil(b.text.length / 2);
                for (const pedaco of [b.text.slice(0, meio), b.text.slice(meio)]) if (pedaco) ouvintes.forEach((cb) => cb(pedaco));
              }
              return r;
            },
          };
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
    assert.deepEqual([...NOMES_FERRAMENTAS].sort(), ['calcular', 'leituras_cocho_recentes', 'listar_pastos', 'medicoes_do_pasto', 'rebanho_por_pasto', 'resumo_agrupado', 'resumo_rebanho']);
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
    const pastos = resultadoDe(pedidos[1]).pastos;
    assert.deepEqual(pastos.map((p) => p.nome), ['PASTO DO A']);
    assert.equal(pastos[0].forragem.situacao, 'Pronto');
    assert.equal(pastos[0].dias_descanso, 30);
    // 2ª ferramenta: a IA pediu o pasto do tenant B pelo id — volta vazio.
    assert.deepEqual(resultadoDe(pedidos[2]).medicoes, []);
    assert.equal(resultadoDe(pedidos[2]).total, 0);
    // O texto de nenhum pedido contém dados do tenant B.
    assert.doesNotMatch(JSON.stringify(pedidos), /PASTO DO B/);
    // A pergunta leva o dia da fazenda; modelo, ferramentas e fallback estão no pedido.
    assert.match(pedidos[0].messages.at(-1).content, /^Hoje é 2027-06-15\./);
    assert.equal(pedidos[0].model, 'claude-opus-5-5');
    assert.equal(pedidos[0].fallbacks, 'default');

    const depois = { medicoes: await prisma().medicaoForragem.count(), auditoria: await prisma().auditLog.count(), areas: await prisma().areaPastagem.count() };
    assert.deepEqual(depois, antes);
  });

  test('última medição de CADA pasto (sem corte global) e lote inativo fora do rebanho', async () => {
    const a = await tenantComPasto('PASTO 1');
    const outro = await prisma().areaPastagem.create({
      data: { cliente_id: a.clienteId, empresa_id: a.empresa.id, setor_id: a.pasto.setor_id, setor_nome: a.pasto.setor_nome, numero_area: `AS-X-${randomUUID().slice(0, 6)}`, nome: 'PASTO 2', tamanho_hectares: 5, cultura_id: a.pasto.cultura_id, tipo_pastagem: 'MARANDU' },
    });
    // O PASTO 1 tem várias medições mais novas; a do PASTO 2 é a mais antiga da fazenda.
    for (const d of ['2027-06-11', '2027-06-12', '2027-06-13']) {
      await prisma().medicaoForragem.create({ data: { id: randomUUID(), cliente_id: a.clienteId, empresa_id: a.empresa.id, area_id: a.pasto.id, data_medicao: new Date(`${d}T00:00:00Z`), metodo: 'OLHO', situacao: 'DESCANSO', updatedAt: new Date() } });
    }
    await prisma().medicaoForragem.create({ data: { id: randomUUID(), cliente_id: a.clienteId, empresa_id: a.empresa.id, area_id: outro.id, data_medicao: new Date('2027-06-05T00:00:00Z'), metodo: 'OLHO', situacao: 'PRONTO', updatedAt: new Date() } });
    const base = { cliente_id: a.clienteId, empresa_id: a.empresa.id, quantidade_entrada: 10, motivo_entrada: 'Compra' };
    await prisma().lote.create({ data: { ...base, numero_lote: 'L1', nome: 'LOTE ATIVO', quantidade_cabecas: 10, status: 'Ativo' } });
    await prisma().lote.create({ data: { ...base, numero_lote: 'L2', nome: 'LOTE INATIVO', quantidade_cabecas: 7, status: 'Inativo' } });

    const pedidos = roteiro([usar('listar_pastos'), usar('resumo_rebanho'), final('ok')]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'Como estão os pastos e o rebanho?' });
    assert.equal(r.statusCode, 200, r.body);
    const pastos = resultadoDe(pedidos[1]).pastos;
    const porNome = Object.fromEntries(pastos.map((p) => [p.nome, p.forragem]));
    assert.equal(porNome['PASTO 1'].data_medicao, '2027-06-13');
    assert.equal(porNome['PASTO 2'].data_medicao, '2027-06-05');
    assert.equal(porNome['PASTO 2'].situacao, 'Pronto');
    assert.doesNotMatch(JSON.stringify(resultadoDe(pedidos[2])), /LOTE INATIVO/);
    assert.match(JSON.stringify(resultadoDe(pedidos[2])), /"cabecas":10/);
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

  /** Lê o corpo SSE em [{evento, dados}]. */
  const eventosSse = (corpo) =>
    corpo
      .split('\n\n')
      .filter((b) => b.trim())
      .map((b) => {
        const evento = b.match(/^event: (.+)$/m)?.[1];
        const dados = JSON.parse(b.match(/^data: (.+)$/m)?.[1] ?? 'null');
        return { evento, dados };
      });

  test('stream: ferramenta, pedaços e fim, na ordem; só a própria fazenda; nada gravado', async () => {
    const a = await tenantComPasto('PASTO DO A');
    await tenantComPasto('PASTO DO B');
    const antes = await prisma().medicaoForragem.count();
    const pedidos = roteiro([usar('listar_pastos'), final('O **PASTO DO A** está pronto.')]);
    const r = await req('POST', '/assistente/perguntar/stream', a.token, { empresa_id: a.empresa.id, pergunta: 'Quais pastos estão prontos?' });
    assert.equal(r.statusCode, 200, r.body);
    assert.match(r.headers['content-type'], /^text\/event-stream/);
    assert.match(r.headers['cache-control'], /no-store/);
    assert.equal(r.headers['x-accel-buffering'], 'no');
    const ev = eventosSse(r.body);
    assert.deepEqual(ev.map((e) => e.evento), ['ferramenta', 'delta', 'delta', 'fim']);
    assert.equal(ev[0].dados.nome, 'listar_pastos');
    assert.equal(ev[1].dados.texto + ev[2].dados.texto, 'O **PASTO DO A** está pronto.');
    assert.equal(ev[3].dados.resposta, 'O **PASTO DO A** está pronto.');
    assert.equal(ev[3].dados.recusada, false);
    assert.deepEqual(resultadoDe(pedidos[1]).pastos.map((p) => p.nome), ['PASTO DO A']);
    assert.doesNotMatch(JSON.stringify(pedidos), /PASTO DO B/);
    assert.equal(await prisma().medicaoForragem.count(), antes);
  });

  test('stream: auth e corpo conferidos antes de abrir o fluxo', async () => {
    const a = await tenantComPasto('PASTO DO A');
    const b = await tenantComPasto('PASTO DO B');
    roteiro([final('x')]);
    assert.equal((await req('POST', '/assistente/perguntar/stream', null, { empresa_id: a.empresa.id, pergunta: 'oi' })).statusCode, 401);
    assert.equal((await req('POST', '/assistente/perguntar/stream', a.token, { empresa_id: a.empresa.id, pergunta: 'oi', cliente_id: b.clienteId })).statusCode, 400);
    // Fazenda de outro tenant: o fluxo abre e termina com `erro`, sem dado nenhum.
    const outra = await req('POST', '/assistente/perguntar/stream', a.token, { empresa_id: b.empresa.id, pergunta: 'oi' });
    const ev = eventosSse(outra.body);
    assert.deepEqual(ev.map((e) => e.evento), ['erro']);
    assert.doesNotMatch(outra.body, /PASTO DO B/);
  });

  test('stream: recusa vira fim com recusada, falha vira erro ASSISTENTE_INDISPONIVEL', async () => {
    const a = await tenantComPasto('PASTO DO A');
    roteiro([{ stop_reason: 'refusal', content: [] }]);
    let ev = eventosSse((await req('POST', '/assistente/perguntar/stream', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' })).body);
    assert.equal(ev.at(-1).evento, 'fim');
    assert.equal(ev.at(-1).dados.recusada, true);
    roteiro([new Error('rede')]);
    ev = eventosSse((await req('POST', '/assistente/perguntar/stream', a.token, { empresa_id: a.empresa.id, pergunta: 'oi' })).body);
    assert.deepEqual(ev.map((e) => e.evento), ['erro']);
    assert.equal(ev[0].dados.code, 'ASSISTENTE_INDISPONIVEL');
  });

  test('o prompt manda perguntar de volta quando a pergunta é ambígua', () => {
    assert.match(PROMPT_SISTEMA, /ambígua/);
    assert.match(PROMPT_SISTEMA, /2 a 4 opções/);
  });

  // ---- Filtros, agrupamento e calculadora --------------------------------
  const resultadoBruto = (pedido) => pedido.messages.at(-1).content[0];

  /** Fazenda A com 3 pastos e 3 lotes; tenant B com o mesmo nome de pasto. */
  const fazendaComDados = async () => {
    const a = await tenantComPasto('PASTO 1');
    const base = { cliente_id: a.clienteId, empresa_id: a.empresa.id, setor_id: a.pasto.setor_id, setor_nome: a.pasto.setor_nome, cultura_id: a.pasto.cultura_id, tipo_pastagem: 'MARANDU' };
    await prisma().areaPastagem.create({ data: { ...base, numero_area: `F2-${randomUUID().slice(0, 6)}`, nome: 'PASTO 2', tamanho_hectares: 25 } });
    await prisma().areaPastagem.create({ data: { ...base, numero_area: `F3-${randomUUID().slice(0, 6)}`, nome: 'RESERVA NORTE', tamanho_hectares: 40, tipo_cultura: 'Reserva' } });
    const lote = { cliente_id: a.clienteId, empresa_id: a.empresa.id, quantidade_entrada: 10, motivo_entrada: 'Compra', status: 'Ativo' };
    await prisma().lote.create({ data: { ...lote, numero_lote: 'G1', nome: 'GARROTE A', quantidade_cabecas: 100, categoria: 'Garrote', sexo: 'Macho', peso_medio_kg: 300 } });
    await prisma().lote.create({ data: { ...lote, numero_lote: 'G2', nome: 'GARROTE B', quantidade_cabecas: 50, categoria: 'Garrote', sexo: 'Macho', peso_medio_kg: 280 } });
    await prisma().lote.create({ data: { ...lote, numero_lote: 'V1', nome: 'VACAS', quantidade_cabecas: 20, categoria: 'Vaca', sexo: 'Fêmea', peso_medio_kg: 450 } });
    const b = await tenantComPasto('PASTO 2');
    await prisma().lote.create({ data: { cliente_id: b.clienteId, empresa_id: b.empresa.id, quantidade_entrada: 1, motivo_entrada: 'Compra', status: 'Ativo', numero_lote: 'X', nome: 'GARROTE DO B', quantidade_cabecas: 999, categoria: 'Garrote', sexo: 'Macho', peso_medio_kg: 999 } });
    return a;
  };

  test('filtros: pastos e lotes estreitam, ordenam, cortam e não veem outro tenant', async () => {
    const a = await fazendaComDados();
    const pedidos = roteiro([
      usar('listar_pastos', { nome: 'pasto', ordenar_por: 'hectares', ordem: 'desc', limite: 1 }),
      usar('rebanho_por_pasto', { categoria: 'garrote', peso_min: 290 }),
      usar('rebanho_por_pasto', { sexo: 'femea', ordenar_por: 'peso' }),
      final('ok'),
    ]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'filtros' });
    assert.equal(r.statusCode, 200, r.body);
    const pastos = resultadoDe(pedidos[1]);
    assert.equal(pastos.total, 2);
    assert.equal(pastos.mostrados, 1);
    assert.equal(pastos.cortado, true);
    assert.equal(pastos.pastos[0].nome, 'PASTO 2');
    const garrotes = resultadoDe(pedidos[2]);
    assert.deepEqual(garrotes.lotes.map((l) => l.nome), ['GARROTE A']);
    assert.equal(garrotes.cabecas_no_filtro, 100);
    const femeas = resultadoDe(pedidos[3]);
    assert.deepEqual(femeas.lotes.map((l) => l.nome), ['VACAS']);
    assert.doesNotMatch(JSON.stringify(pedidos), /GARROTE DO B|999/);
  });

  test('filtros fora do schema voltam como erro da ferramenta, sem derrubar a pergunta', async () => {
    const a = await fazendaComDados();
    const pedidos = roteiro([
      usar('listar_pastos', { cliente_id: 'outro' }),
      usar('rebanho_por_pasto', { peso_min: -5 }),
      usar('leituras_cocho_recentes', { escore: 'TALVEZ' }),
      usar('medicoes_do_pasto', { area_id: a.pasto.id, data_de: '2027-06-20', data_ate: '2027-06-01' }),
      final('ok'),
    ]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'x' });
    assert.equal(r.statusCode, 200, r.body);
    for (const i of [1, 2, 3, 4]) {
      const bloco = resultadoBruto(pedidos[i]);
      assert.equal(bloco.is_error, true, `pedido ${i}: ${JSON.stringify(bloco)}`);
    }
    assert.match(resultadoBruto(pedidos[1]).content, /parâmetro desconhecido "cliente_id"/);
  });

  test('resumo_agrupado: contas do rebanho e dos pastos feitas no servidor', async () => {
    const a = await fazendaComDados();
    const pedidos = roteiro([
      usar('resumo_agrupado', { origem: 'rebanho', agrupar_por: 'categoria' }),
      usar('resumo_agrupado', { origem: 'pastos', agrupar_por: 'situacao' }),
      usar('resumo_agrupado', { origem: 'pastos', agrupar_por: 'sexo' }),
      final('ok'),
    ]);
    await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'x' });
    const rebanho = resultadoDe(pedidos[1]);
    assert.equal(rebanho.cabecas, 170);
    const garrote = rebanho.grupos.find((g) => g.grupo === 'Garrote');
    assert.deepEqual(garrote, { grupo: 'Garrote', itens: 2, cabecas: 150, peso_medio_kg: 293.3, peso_total_kg: 44000 });
    assert.equal(rebanho.grupos[0].grupo, 'Garrote');
    const pastos = resultadoDe(pedidos[2]);
    assert.equal(pastos.pastos, 3);
    assert.equal(pastos.grupos.reduce((s, g) => s + g.itens, 0), 3);
    assert.equal(resultadoBruto(pedidos[3]).is_error, true);
  });

  test('calcular: contas exatas, várias de uma vez, e recusa o que não é conta', async () => {
    const a = await fazendaComDados();
    const contas = [
      '1 + 2 * 3',
      'media_ponderada([300, 280], [100, 50])',
      'arred(4425 / 73, 1)',
      'pct(38, 4425)',
      '(410 - 380) / 30',
      'process.exit(1)',
      'constructor',
      '1 / 0',
      'soma(',
    ];
    const pedidos = roteiro([usar('calcular', { contas }), usar('calcular', { contas: 'não é lista' }), final('ok')]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: a.empresa.id, pergunta: 'contas' });
    assert.equal(r.statusCode, 200, r.body);
    const res = resultadoDe(pedidos[1]);
    assert.deepEqual(res.slice(0, 5).map((x) => x.resultado), [7, 293.333333, 60.6, 0.858757, 1]);
    for (const x of res.slice(5)) assert.ok(x.erro && x.resultado === undefined, JSON.stringify(x));
    assert.equal(resultadoBruto(pedidos[2]).is_error, true);
  });

  test('o prompt manda usar calcular e os filtros em vez de conta de cabeça', () => {
    assert.match(PROMPT_SISTEMA, /calcular/);
    assert.match(PROMPT_SISTEMA, /UA = peso vivo \(kg\) ÷ 450/);
    assert.match(PROMPT_SISTEMA, /GMD/);
    assert.match(PROMPT_SISTEMA, /Filtros/);
  });

  test('filtros no banco: leituras e medições antigas, fora de qualquer janela de corte, são achadas', async () => {
    const a = await fazendaComDados();
    const c = a.clienteId;
    const e = a.empresa.id;
    const ponto = await prisma().pontoSuplementacao.create({ data: { cliente_id: c, empresa_id: e, numero_ponto: `C-${randomUUID().slice(0, 6)}`, nome_ponto: 'COCHO VELHO' } });
    const outro = await prisma().pontoSuplementacao.create({ data: { cliente_id: c, empresa_id: e, numero_ponto: `C-${randomUUID().slice(0, 6)}`, nome_ponto: 'COCHO NOVO' } });
    const base = { cliente_id: c, empresa_id: e, escore: 'ADEQUADO', acesso: 'BOM', estrutura: 'BOA', updatedAt: new Date() };
    // 600 leituras recentes de outro cocho; 1 leitura antiga e CHEIA no COCHO VELHO.
    await prisma().leituraCocho.createMany({
      data: Array.from({ length: 600 }, (_, i) => ({ ...base, id: randomUUID(), ponto_suplementacao_id: outro.id, data_leitura: new Date(Date.UTC(2027, 5, 14) - (i % 30) * 86400000) })),
    });
    await prisma().leituraCocho.create({ data: { ...base, id: randomUUID(), ponto_suplementacao_id: ponto.id, escore: 'CHEIO', data_leitura: new Date('2026-01-10T00:00:00Z') } });
    // 600 medições recentes no pasto; 1 antiga.
    const med = { cliente_id: c, empresa_id: e, area_id: a.pasto.id, metodo: 'OLHO', situacao: 'DESCANSO', updatedAt: new Date() };
    await prisma().medicaoForragem.createMany({ data: Array.from({ length: 600 }, (_, i) => ({ ...med, id: randomUUID(), data_medicao: new Date(Date.UTC(2027, 5, 14) - (i % 60) * 86400000) })) });
    await prisma().medicaoForragem.create({ data: { ...med, id: randomUUID(), situacao: 'PRONTO', data_medicao: new Date('2025-12-01T00:00:00Z') } });

    const pedidos = roteiro([
      usar('leituras_cocho_recentes', { escore: 'CHEIO' }),
      usar('leituras_cocho_recentes', { cocho: 'velho' }),
      usar('medicoes_do_pasto', { area_id: a.pasto.id, data_ate: '2026-01-01' }),
      usar('leituras_cocho_recentes', { limite: 5 }),
      final('ok'),
    ]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: e, pergunta: 'x' });
    assert.equal(r.statusCode, 200, r.body);
    const cheias = resultadoDe(pedidos[1]);
    assert.equal(cheias.total, 1);
    assert.deepEqual(cheias.leituras.map((l) => [l.data, l.cocho, l.escore]), [['2026-01-10', 'COCHO VELHO', 'CHEIO']]);
    assert.equal(resultadoDe(pedidos[2]).total, 1);
    const antigas = resultadoDe(pedidos[3]);
    assert.equal(antigas.total, 1);
    assert.equal(antigas.medicoes[0].data, '2025-12-01');
    const ultimas = resultadoDe(pedidos[4]);
    assert.deepEqual([ultimas.total, ultimas.mostrados, ultimas.cortado], [601, 5, true]);
  });

  test('dias no pasto: grupo transferido conta desde a transferência; implantação fica desconhecida', async () => {
    const a = await tenantComPasto('PASTO ORIGEM');
    const c = a.clienteId;
    const e = a.empresa.id;
    const destino = await prisma().areaPastagem.create({
      data: { cliente_id: c, empresa_id: e, setor_id: a.pasto.setor_id, setor_nome: a.pasto.setor_nome, numero_area: `D-${randomUUID().slice(0, 6)}`, nome: 'PASTO DESTINO', tamanho_hectares: 12 },
    });
    await prisma().rebanhoLedgerAtivacao.create({ data: { cliente_id: c, empresa_id: e, data_corte: new Date('2027-06-01T00:00:00Z'), modo: 'saldo_abertura' } });
    const pos = (area, nome, qtd) =>
      prisma().posicaoRebanho.create({ data: { cliente_id: c, empresa_id: e, area_id: area, chave_identidade: `${nome}-${area}`, nome, categoria: 'Garrote', sexo: 'Macho', quantidade_cabecas: qtd } });
    const pOrigem = await pos(a.pasto.id, 'LOTE X', 20);
    const pDestino = await pos(destino.id, 'LOTE X', 30);
    const evento = (tipo, data, dados = {}) =>
      prisma().eventoRebanho.create({ data: { cliente_id: c, empresa_id: e, tipo, data_operacional: new Date(`${data}T00:00:00Z`), operation_id: randomUUID(), dados } });
    const partida = (ev, posicao, data, delta) =>
      prisma().partidaRebanho.create({ data: { cliente_id: c, empresa_id: e, evento_id: ev.id, posicao_id: posicao.id, data_operacional: new Date(`${data}T00:00:00Z`), delta } });
    const abertura = await evento('SALDO_ABERTURA', '2027-06-01');
    await partida(abertura, pOrigem, '2027-06-01', 50);
    const transf = await evento('TRANSFERENCIA', '2027-06-10');
    await partida(transf, pOrigem, '2027-06-10', -30);
    await partida(transf, pDestino, '2027-06-10', 30);

    const pedidos = roteiro([usar('rebanho_por_pasto', { ordenar_por: 'pasto' }), usar('rebanho_por_pasto', { dias_no_pasto_max: 10 }), final('ok')]);
    const r = await req('POST', '/assistente/perguntar', a.token, { empresa_id: e, pergunta: 'x' });
    assert.equal(r.statusCode, 200, r.body);
    const porPasto = Object.fromEntries(resultadoDe(pedidos[1]).lotes.map((l) => [l.pasto, l]));
    assert.equal(porPasto['PASTO DESTINO'].no_pasto_desde, '2027-06-10');
    assert.equal(porPasto['PASTO DESTINO'].dias_no_pasto, 5);
    assert.equal(porPasto['PASTO ORIGEM'].no_pasto_desde, null);
    assert.equal(porPasto['PASTO ORIGEM'].dias_no_pasto, null);
    const filtrado = resultadoDe(pedidos[2]);
    assert.deepEqual(filtrado.lotes.map((l) => l.pasto), ['PASTO DESTINO']);
    assert.equal(filtrado.fora_por_dias_desconhecidos, 1);
  });
});
