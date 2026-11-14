/**
 * PR #199 / R2 — guarda de tela/ação nas rotas de escrita que só autenticavam
 * (suplementação, cochos/depósitos, estoque, bebedouros, tarefas, cadastros,
 * anexos, upload, referências e rotas sem tela). PostgreSQL descartável.
 *
 * Auto-validação: o schema do Fastify roda ANTES do preHandler; um 403
 * significa que o corpo era válido e que só a autorização barrou.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

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
  const p = prisma();
  await p.pesoRebanho.deleteMany({});
  await p.lancamentoTarefa.updateMany({ where: { posicao_id: { not: null } }, data: { posicao_id: null } });
  await p.partidaRebanho.deleteMany({});
  await p.eventoRebanho.deleteMany({});
  await p.posicaoRebanho.deleteMany({});
  await p.rebanhoLedgerAtivacao.deleteMany({});
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), ...a });

/** Configuração real do proprietário: só ver o Mapa Geral; ações do mapa desligadas. */
const SO_VER_MAPA = {
  modulos_permitidos: ['mapa'],
  permissoes_telas: [linha('mapa', 'pec-mapa-geral', { visualizar: true }), linha('mapa', 'pec-mapa-cadastro', {})],
  mapa_geral_permissoes: { visualizar_lotes: true, lancar_suplementacao: false, movimentar_depositos: false, mover_lotes: false },
};

/** Todas as tabelas do tenant (todo model com cliente_id): prova de "nada gravado". */
const MODELOS = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'cliente_id')).map((m) => m.name[0].toLowerCase() + m.name.slice(1));
const fotografia = async (clienteId) => {
  const p = prisma();
  const out = [];
  for (const m of MODELOS) out.push(`${m}:${await p[m].count({ where: { cliente_id: clienteId } })}`);
  return out.join(',');
};

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const senhaHash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const login = `oper-${randomUUID().slice(0, 8)}`;
  await p.usuario.create({ data: { cliente_id: adm.cliente.id, nome: 'Operador', login, senha_hash: senhaHash, papel_tenant: 'usuario' } });
  const tokOp = (await autenticarNoApp(app, { login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const permitir = (dados) =>
    p.permissao.upsert({
      where: { cliente_id_user_email: { cliente_id: adm.cliente.id, user_email: login } },
      create: { cliente_id: adm.cliente.id, user_email: login, user_nome: 'Operador', ...dados },
      update: dados,
    });
  return { cliente: adm.cliente, tokAdm, tokOp, empresa, permitir };
};

const ID = 'id-inexistente-1';
/** [nome, método, url, corpo] — uma escrita de cada rota antes desprotegida. */
const ESCRITAS = (c) => {
  const E = c.empresa.id;
  return [
    ['suplementação: lote (POST)', 'POST', '/suplementacao-lotes', { empresa_id: E, observacoes: 'x' }],
    ['suplementação: lote (bulk)', 'POST', '/suplementacao-lotes/bulk', { registros: [{ empresa_id: E, observacoes: 'x' }] }],
    ['suplementação: lote (PATCH)', 'PATCH', `/suplementacao-lotes/${ID}`, { observacoes: 'x' }],
    ['suplementação: lote (DELETE)', 'DELETE', `/suplementacao-lotes/${ID}`],
    ['suplementação: evento (POST)', 'POST', '/suplementacao-eventos', { empresa_id: E, observacoes: 'x' }],
    ['suplementação: lançamento com lotes', 'POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', { operation_id: opId(), evento: { empresa_id: E } }],
    ['suplementação: evento (DELETE)', 'DELETE', `/suplementacao-eventos/${ID}`],
    ['estoque: saída de suplementação', 'POST', '/movimentacoes-estoque/comandos/saida-suplementacao', { operation_id: opId(), empresa_id: E, produto_id: 'p', local_origem_id: 'l', quantidade: 5 }],
    ['estoque: transferência entre depósitos', 'POST', '/movimentacoes-estoque/comandos/transferencia-locais', { operation_id: opId(), empresa_id: E, produto_id: 'p', local_origem_id: 'l', local_destino_id: 'm', quantidade: 5 }],
    ['estoque: movimentação (DELETE)', 'DELETE', `/movimentacoes-estoque/${ID}`],
    ['estoque: lote de nota (DELETE)', 'DELETE', `/estoque-lotes-nota/${ID}`],
    ['cocho/depósito (POST)', 'POST', '/pontos-suplementacao', { empresa_id: E, nome: 'COCHO HACK' }],
    ['cocho/depósito (DELETE)', 'DELETE', `/pontos-suplementacao/${ID}`],
    ['bebedouro: histórico (POST)', 'POST', '/bebedouros-historico', { empresa_id: E, observacoes: 'x' }],
    ['bebedouro: histórico (DELETE)', 'DELETE', `/bebedouros-historico/${ID}`],
    ['bebedouro: alerta (POST)', 'POST', '/bebedouros-alertas', { empresa_id: E, observacoes: 'x' }],
    ['bebedouro: sanidade (POST)', 'POST', '/bebedouros-sanidade', { empresa_id: E, observacoes: 'x' }],
    ['tarefa (POST)', 'POST', '/lancamentos-tarefa', { empresa_id: E, titulo: 'HACK', tipo: 'Manejo', tipo_tarefa_id: 'tt-1', data_pedido: '2026-10-27' }],
    ['tarefa (DELETE)', 'DELETE', `/lancamentos-tarefa/${ID}`],
    ['setor (POST)', 'POST', '/setores', { empresa_id: E, nome: 'SETOR HACK', tipo: 'Próprio' }],
    ['categoria de manejo (DELETE)', 'DELETE', `/categorias-manejo/${ID}`],
    ['bebedouro (DELETE)', 'DELETE', `/bebedouros/${ID}`],
    ['produto (POST)', 'POST', '/produtos', { empresa_id: E, nome_produto: 'HACK' }],
    ['marca (POST)', 'POST', '/marcas', { empresa_id: E, nome: 'HACK' }],
    ['local de estoque (POST)', 'POST', '/locais-estoque', { nome: 'HACK' }],
    ['categoria (DELETE)', 'DELETE', `/categorias/${ID}`],
    ['unidade de medida (DELETE)', 'DELETE', `/unidades-medida/${ID}`],
    ['tipo de tarefa (DELETE)', 'DELETE', `/tipos-tarefa/${ID}`],
    // D-PROD-182 — Tipo de Atividade: escrita guardada pela tela sup-tipos-atividade.
    ['tipo de atividade (POST)', 'POST', '/tipos-atividade', { nome_tipo: 'HACK', grupo_atividade_id: 'ga-1' }],
    ['tipo de atividade (PATCH)', 'PATCH', `/tipos-atividade/${ID}`, { nome_tipo: 'HACK' }],
    ['tipo de atividade (DELETE)', 'DELETE', `/tipos-atividade/${ID}`],
    // D-PROD-188 — Estações da fazenda: escrita guardada pela tela pec-estacoes.
    ['estação (POST)', 'POST', '/estacoes', { empresa_id: E, nome: 'HACK', tipo: 'SECA', data_inicio: '2026-06-01', data_fim: '2026-09-30' }],
    ['estação (PATCH)', 'PATCH', `/estacoes/${ID}`, { empresa_id: E, nome: 'HACK' }],
    ['estação (DELETE)', 'DELETE', `/estacoes/${ID}?empresa_id=${E}`],
    // D-PROD-189 — Curvas de Ganho de Peso: escrita guardada pela tela pec-curvas-ganho (12 GMD mensais, D-PROD-194).
    ['curva de ganho (POST)', 'POST', '/curvas-ganho', { empresa_id: E, nome: 'HACK', ...Object.fromEntries(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].map((m) => [`gmd_${m}`, 0.5])) }],
    ['curva de ganho (PATCH)', 'PATCH', `/curvas-ganho/${ID}`, { empresa_id: E, nome: 'HACK' }],
    ['curva de ganho (DELETE)', 'DELETE', `/curvas-ganho/${ID}?empresa_id=${E}`],
    ['grupo de atividade (DELETE)', 'DELETE', `/grupos-atividade/${ID}`],
    // D-PROD-200 — Lançamento de Atividades: escrita guardada pela tela
    // op-atividades (cabeçalho pelas ações padrão; reabrir e os apontamentos
    // pelas ações EXTRAS da mesma linha). Cancelar = ação "excluir"; não há
    // DELETE físico. Os corpos são válidos: um 403 é só da autorização.
    ['atividade (POST)', 'POST', '/atividades', { empresa_id: E, nome: 'HACK', tipo_atividade_id: 'ta-1' }],
    ['atividade (duplicar)', 'POST', `/atividades/${ID}/duplicar`, { empresa_id: E }],
    ['atividade (PATCH)', 'PATCH', `/atividades/${ID}`, { versao: 1, nome: 'HACK' }],
    ['atividade (concluir)', 'POST', `/atividades/${ID}/concluir`, { empresa_id: E, versao: 1 }],
    ['atividade (cancelar)', 'POST', `/atividades/${ID}/cancelar`, { empresa_id: E, versao: 1, motivo: 'HACK' }],
    ['atividade (reabrir)', 'POST', `/atividades/${ID}/reabrir`, { empresa_id: E, versao: 1, motivo: 'HACK' }],
    ['apontamento da atividade (POST)', 'POST', `/atividades/${ID}/apontamentos`, { empresa_id: E, data_operacional: '2026-10-27' }],
    ['apontamento da atividade (duplicar)', 'POST', `/atividades/${ID}/apontamentos/${ID}/duplicar`, { empresa_id: E }],
    ['apontamento da atividade (PATCH)', 'PATCH', `/atividades/${ID}/apontamentos/${ID}`, { versao: 1, observacao: 'HACK' }],
    ['apontamento da atividade (cancelar)', 'POST', `/atividades/${ID}/apontamentos/${ID}/cancelar`, { empresa_id: E, versao: 1, motivo: 'HACK' }],
    ['fornecedor (DELETE)', 'DELETE', `/fornecedores/${ID}`],
    ['medicamento (POST)', 'POST', '/aplicacoes-medicamento', { empresa_id: E, observacoes: 'x' }],
    ['evento sanitário (POST)', 'POST', '/eventos-sanitarios', { empresa_id: E, observacoes: 'x' }],
    ['manejo técnico (POST)', 'POST', '/manejos-tecnico-rebanho', { empresa_id: E, observacoes: 'x' }],
    ['movimentação pecuária (POST)', 'POST', '/movimentacoes-pecuaria', { empresa_id: E, observacoes: 'x' }],
    ['anexo (DELETE)', 'DELETE', `/registros-anexo/${ID}`],
    ['empresa (PATCH)', 'PATCH', `/empresas/${c.empresa.id}`, { nome: 'FAZENDA HACK' }],
    ['empresa (DELETE)', 'DELETE', `/empresas/${c.empresa.id}`],
  ];
};

describe('R2-ROT — escrita direta com a configuração real (só ver o mapa) → 403, nada gravado', () => {
  test('todas as rotas antes desprotegidas', async () => {
    const c = await cenario();
    await c.permitir(SO_VER_MAPA);
    const passaram = [];
    for (const [nome, metodo, url, corpo] of ESCRITAS(c)) {
      const antes = await fotografia(c.cliente.id);
      const r = await req(metodo, url, c.tokOp, corpo);
      if (r.statusCode !== 403) passaram.push(`${nome}: ${r.statusCode} ${r.body.slice(0, 120)}`);
      else assert.ok(['ACAO_NAO_PERMITIDA', 'TENANT_ADMIN_REQUIRED'].includes(r.json().code), `${nome}: ${r.body}`);
      assert.equal(await fotografia(c.cliente.id), antes, `${nome}: nada gravado`);
    }
    assert.deepEqual(passaram, [], 'nenhuma escrita sem permissão passa');
  });

  test('operador SEM linha também é barrado', async () => {
    const c = await cenario();
    for (const [nome, metodo, url, corpo] of ESCRITAS(c)) {
      const r = await req(metodo, url, c.tokOp, corpo);
      assert.equal(r.statusCode, 403, `${nome}: ${r.body}`);
    }
  });

  test('administrador real: nenhuma rota responde 403 (pode haver recusa de negócio/404)', async () => {
    const c = await cenario();
    for (const [nome, metodo, url, corpo] of ESCRITAS(c).filter(([n]) => !n.startsWith('empresa'))) {
      const r = await req(metodo, url, c.tokAdm, corpo);
      assert.notEqual(r.statusCode, 403, `${nome}: ${r.body}`);
    }
  });
});

describe('R2-ROT — concessão explícita libera exatamente a ação da interface', () => {
  test('lançar suplementação libera o lançamento e a saída de estoque; não libera a transferência entre depósitos', async () => {
    const c = await cenario();
    await c.permitir({ ...SO_VER_MAPA, mapa_geral_permissoes: { lancar_suplementacao: true } });
    const [, , urlL, corpoL] = ESCRITAS(c).find(([n]) => n === 'suplementação: lançamento com lotes');
    assert.notEqual((await req('POST', urlL, c.tokOp, corpoL)).statusCode, 403);
    const [, , urlS, corpoS] = ESCRITAS(c).find(([n]) => n === 'estoque: saída de suplementação');
    assert.notEqual((await req('POST', urlS, c.tokOp, corpoS)).statusCode, 403);
    const [, , urlT, corpoT] = ESCRITAS(c).find(([n]) => n === 'estoque: transferência entre depósitos');
    assert.equal((await req('POST', urlT, c.tokOp, corpoT)).statusCode, 403);
  });

  test('setor rápido pelo Cadastro de Lotes ("novo" em pec-lotes) cria; sem nenhuma tela, não', async () => {
    const c = await cenario();
    await c.permitir({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-lotes', { visualizar: true, novo: true })] });
    const r = await req('POST', '/setores', c.tokOp, { empresa_id: c.empresa.id, nome: 'SETOR RÁPIDO', tipo: 'Próprio' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal((await req('POST', '/produtos', c.tokOp, { empresa_id: c.empresa.id, nome_produto: 'X' })).statusCode, 403);
  });

  test('cocho pelo Mapa Cadastro ("salvar") passa; tarefa só com acesso total', async () => {
    const c = await cenario();
    await c.permitir({ modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-cadastro', { visualizar: true, salvar: true })] });
    assert.notEqual((await req('POST', '/pontos-suplementacao', c.tokOp, { empresa_id: c.empresa.id, nome: 'COCHO' })).statusCode, 403);
    const tarefa = { empresa_id: c.empresa.id, titulo: 'T', tipo: 'Manejo', tipo_tarefa_id: 'tt-1', data_pedido: '2026-10-27' };
    assert.equal((await req('POST', '/lancamentos-tarefa', c.tokOp, tarefa)).statusCode, 403);
    await c.permitir({ is_admin: true });
    assert.notEqual((await req('POST', '/lancamentos-tarefa', c.tokOp, tarefa)).statusCode, 403);
  });

  test('D-PROD-200 — Lançamento de Atividades: só a tela op-atividades libera, ação por ação; reabrir e os apontamentos exigem as ações extras; a leitura também exige a tela', async () => {
    const c = await cenario();
    const E = c.empresa.id;
    const leituras = ['/atividades', `/atividades/${ID}`, `/atividades/${ID}/apontamentos`, `/atividades/${ID}/apontamentos/${ID}`,
      '/atividades-opcoes/bens', '/atividades-opcoes/operadores'].map((u) => `${u}?empresa_id=${E}`);
    /** As 10 escritas da tela, na ordem de ESCRITAS. */
    const escritas = ESCRITAS(c).filter(([n]) => n.startsWith('atividade (') || n.startsWith('apontamento da atividade ('));
    assert.equal(escritas.length, 10);
    /** `{nome: passou da guarda}` (404/422 do id inexistente não é 403); nada gravado em nenhum caso. */
    const passa = async () => {
      /** @type {Record<string, boolean>} */
      const out = {};
      for (const [nome, metodo, url, corpo] of escritas) {
        const antes = await fotografia(c.cliente.id);
        const r = await req(metodo, url, c.tokOp, corpo);
        if (r.statusCode === 403) assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA', `${nome}: ${r.body}`);
        assert.equal(await fotografia(c.cliente.id), antes, `${nome}: nada gravado`);
        out[nome] = r.statusCode !== 403;
      }
      return out;
    };
    /** Só as escritas nomeadas passam. @param {string[]} nomes */
    const soEstas = (...nomes) => Object.fromEntries(escritas.map(([n]) => [n, nomes.includes(n)]));
    const padroes = ['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'];
    const todas = Object.fromEntries(padroes.map((a) => [a, true]));
    const comAcoes = (acoesDaTela) => c.permitir({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'op-atividades', { visualizar: true, ...acoesDaTela })] });

    // A tela vizinha (Tipos de Atividade) e a tela antiga (op-apontamentos-atividade, inerte), com tudo ligado, não liberam nada aqui.
    for (const tela of ['sup-tipos-atividade', 'op-apontamentos-atividade']) {
      await c.permitir({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', tela, { ...todas, reabrir: true, lancar_apontamento: true })] });
      for (const url of leituras) assert.equal((await req('GET', url, c.tokOp)).statusCode, 403, `${tela}: ${url}`);
      assert.deepEqual(await passa(), soEstas(), tela);
    }

    // Só visualizar: lê (404 do id inexistente não é 403), não grava nada.
    await comAcoes({});
    for (const url of leituras) assert.notEqual((await req('GET', url, c.tokOp)).statusCode, 403, url);
    assert.deepEqual(await passa(), soEstas(), 'só visualizar');

    // Cada ação padrão libera só a sua parte do cabeçalho; nenhuma libera reabrir nem apontamento.
    await comAcoes({ novo: true });
    assert.deepEqual(await passa(), soEstas('atividade (POST)', 'atividade (duplicar)'), 'novo');
    await comAcoes({ editar: true });
    assert.deepEqual(await passa(), soEstas('atividade (PATCH)', 'atividade (concluir)'), 'editar');
    await comAcoes({ salvar: true });
    assert.deepEqual(await passa(), soEstas('atividade (POST)', 'atividade (duplicar)', 'atividade (PATCH)', 'atividade (concluir)'), 'salvar');
    await comAcoes({ excluir: true });
    assert.deepEqual(await passa(), soEstas('atividade (cancelar)'), 'excluir');
    await comAcoes(todas);
    assert.deepEqual(await passa(), soEstas('atividade (POST)', 'atividade (duplicar)', 'atividade (PATCH)', 'atividade (concluir)', 'atividade (cancelar)'), 'todas as ações padrão');

    // As extras: cada uma libera só a sua escrita.
    await comAcoes({ reabrir: true });
    assert.deepEqual(await passa(), soEstas('atividade (reabrir)'), 'reabrir');
    await comAcoes({ lancar_apontamento: true });
    assert.deepEqual(await passa(), soEstas('apontamento da atividade (POST)', 'apontamento da atividade (duplicar)'), 'lancar_apontamento');
    await comAcoes({ editar_apontamento: true });
    assert.deepEqual(await passa(), soEstas('apontamento da atividade (PATCH)'), 'editar_apontamento');
    await comAcoes({ cancelar_apontamento: true });
    assert.deepEqual(await passa(), soEstas('apontamento da atividade (cancelar)'), 'cancelar_apontamento');

    // Extra sem visualizar não vale (a linha da tela exige visualizar).
    await c.permitir({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'op-atividades', { reabrir: true, lancar_apontamento: true, editar_apontamento: true, cancelar_apontamento: true })] });
    assert.deepEqual(await passa(), soEstas(), 'extras sem visualizar');

    // Sem DELETE físico, e as rotas antigas não existem mais: 404 para todos.
    for (const url of [`/atividades/${ID}`, `/atividades/${ID}/apontamentos/${ID}`]) assert.equal((await req('DELETE', url, c.tokAdm)).statusCode, 404, url);
    for (const url of ['/apontamentos-atividade', `/apontamentos-atividade/${ID}`]) assert.equal((await req('GET', `${url}?empresa_id=${E}`, c.tokAdm)).statusCode, 404, url);
  });

  test('D-PROD-197 — opções de centro padrão do Tipo de Atividade: criar OU editar (novo|salvar|editar) de sup-tipos-atividade; visualizar, excluir e as telas de centros não', async () => {
    const c = await cenario();
    const urls = ['centros-custo', 'centros-resultado'].map((lado) => `/tipos-atividade/opcoes/${lado}?empresa_id=${c.empresa.id}`);
    /** `[centros de custo, centros de resultado]`: true = passou da guarda. */
    const passa = async () => {
      const out = [];
      for (const url of urls) {
        const r = await req('GET', url, c.tokOp);
        if (r.statusCode === 403) assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA', `${url}: ${r.body}`);
        else assert.equal(r.statusCode, 200, `${url}: ${r.body}`);
        out.push(r.statusCode !== 403);
      }
      return out;
    };
    const todas = Object.fromEntries(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'].map((a) => [a, true]));
    assert.deepEqual(await passa(), [false, false], 'sem linha');
    // As telas de centros, com tudo ligado, não liberam (as opções não dependem delas).
    await c.permitir({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha('gestao-rural', 'ges-centros-custo', todas), linha('gestao-rural', 'ges-centros-resultado', todas)] });
    assert.deepEqual(await passa(), [false, false], 'telas de centros');
    const comAcao = (acoesDaTela) => c.permitir({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-tipos-atividade', { visualizar: true, ...acoesDaTela })] });
    await comAcao({});
    assert.deepEqual(await passa(), [false, false], 'só visualizar');
    await comAcao({ excluir: true });
    assert.deepEqual(await passa(), [false, false], 'excluir não cria nem edita');
    for (const acao of ['novo', 'salvar', 'editar']) {
      await comAcao({ [acao]: true });
      assert.deepEqual(await passa(), [true, true], acao);
    }
    for (const url of urls) assert.equal((await req('GET', url, c.tokAdm)).statusCode, 200, `administrador real: ${url}`);
  });

  test('D-PROD-195 — opções de curva da Categoria de Manejo: quem cria OU edita categoria (inclui o cadastro rápido do Cadastro de Lotes); a tela de curvas sozinha não lê', async () => {
    const c = await cenario();
    const url = `/categorias-manejo-opcoes/curvas-ganho?empresa_id=${c.empresa.id}`;
    const todas = Object.fromEntries(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar'].map((a) => [a, true]));
    /** true = passou da guarda; 403 sempre ACAO_NAO_PERMITIDA e nada gravado. */
    const passa = async () => {
      const antes = await fotografia(c.cliente.id);
      const r = await req('GET', url, c.tokOp);
      if (r.statusCode === 403) assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA', r.body);
      else assert.equal(r.statusCode, 200, r.body);
      assert.equal(await fotografia(c.cliente.id), antes, 'nada gravado');
      return r.statusCode !== 403;
    };
    assert.equal(await passa(), false, 'sem linha');
    await c.permitir(SO_VER_MAPA);
    assert.equal(await passa(), false, 'só ver o mapa');
    const casos = [
      [linha('manejo', 'pec-curvas-ganho', todas), false],
      [linha('manejo', 'pec-categorias-manejo', { visualizar: true, excluir: true }), false],
      [linha('manejo', 'pec-categorias-manejo', { visualizar: true, novo: true }), true],
      [linha('manejo', 'pec-categorias-manejo', { visualizar: true, salvar: true }), true],
      [linha('manejo', 'pec-categorias-manejo', { visualizar: true, editar: true }), true],
      [linha('manejo', 'pec-lotes', { visualizar: true }), false],
      [linha('manejo', 'pec-lotes', { visualizar: true, novo: true }), true],
      [linha('manejo', 'pec-lotes', { visualizar: true, salvar: true }), true],
    ];
    for (const [l, esperado] of casos) {
      await c.permitir({ modulos_permitidos: ['manejo'], permissoes_telas: [l] });
      assert.equal(await passa(), esperado, `${l.tela_id} ${JSON.stringify(l)}`);
    }
    await c.permitir({ is_admin: true, permissoes_telas: [] });
    assert.equal(await passa(), true, 'is_admin');
    assert.equal((await req('GET', url, c.tokAdm)).statusCode, 200, 'administrador real');
  });

  test('sem tela no produto (medicamento, sanitário…): nem a concessão is_admin grava — só o administrador real', async () => {
    const c = await cenario();
    await c.permitir({ is_admin: true });
    const r = await req('POST', '/aplicacoes-medicamento', c.tokOp, { empresa_id: c.empresa.id, observacoes: 'x' });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'TENANT_ADMIN_REQUIRED');
  });
});
