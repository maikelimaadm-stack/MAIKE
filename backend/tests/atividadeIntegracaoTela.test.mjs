/**
 * D-PROD-198 (Fatia 2) — integração REAL tela ↔ servidor do Lançamento de
 * Atividades. Os testes de tela (`tests/smoke/lancamentoAtividades.test.jsx`)
 * usam um servidor falso; os do backend mandam corpos escritos à mão. Aqui o
 * caminho inteiro do navegador roda no Node contra o Fastify e o PostgreSQL
 * reais: as regras do formulário (`corpoDaAtividade`, `camposAlterados…`,
 * `corpoDoApontamento`) → o service da tela (`lancamentoAtividadesService.js`,
 * que injeta a fazenda) → a API (`atividadesApi.js`, que normaliza os
 * envelopes) → a porta (`lancamentoAtividadePort.js`, as allowlists) → o
 * cliente HTTP (`nativeHttpClient.js`, o prefixo `/api/native` e o token) →
 * `app.inject`. Toda divergência de rota, método, query × corpo, nome de
 * campo, `null` para limpar, `versao`, formato de data/decimal ou envelope
 * quebra aqui.
 *
 * Como o código de `src/` roda no Node: um hook de módulos (`module.register`)
 * resolve o alias `@/` e os imports sem extensão do Vite e troca
 * `import.meta.env` por um objeto global; o `fetch` global entrega o pedido
 * ao `app.inject`. Um `.jsx` puxado pelo grafo de imports é transformado pelo
 * esbuild (o mesmo do Vite). Nada do código de produção é substituído.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { pathToFileURL } from 'node:url';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { HOJE, http, montarPatrimonio, prisma, corpoTrator, corpoImplemento } from './patrimonioP1Cenario.mjs';

const SRC = new URL('../../src/', import.meta.url).href;
const HOOKS = `
let SRC;
let ESBUILD;
export async function initialize(d) { SRC = d.src; ESBUILD = await import(d.esbuild); }
const CANDIDATOS = ['', '.js', '.jsx', '/index.js'];
export async function resolve(spec, ctx, next) {
  const alvo = spec.startsWith('@/') ? SRC + spec.slice(2) : spec;
  const doSrc = alvo.startsWith(SRC) || (Boolean(ctx.parentURL?.startsWith(SRC)) && alvo.startsWith('.'));
  if (!doSrc) return next(alvo, ctx);
  let ultimo;
  for (const ext of CANDIDATOS) {
    try { return await next(alvo + ext, ctx); } catch (e) { ultimo = e; }
  }
  throw ultimo;
}
export async function load(url, ctx, next) {
  if (url.startsWith(SRC) && url.endsWith('.jsx')) {
    const { source } = await next(url, { ...ctx, format: 'module' });
    const { code } = await ESBUILD.transform(String(source), { loader: 'jsx', jsx: 'automatic', format: 'esm' });
    return { format: 'module', source: code, shortCircuit: true };
  }
  const r = await next(url, ctx);
  if (!url.startsWith(SRC) || r.format !== 'module' || r.source == null) return r;
  const fonte = String(r.source).replace(/import\\.meta\\.env/g, '(globalThis.__VITE_ENV__ ?? {})');
  return { ...r, source: fonte };
}
`;
const ESBUILD = pathToFileURL(createRequire(import.meta.url).resolve('esbuild')).href;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, { data: { src: SRC, esbuild: ESBUILD } });

const BASE = 'http://tela.teste';
globalThis.__VITE_ENV__ = { VITE_MAIKE_API_URL: BASE };

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
/** Módulos da tela (carregados depois do hook). */
let S;
let R;
let T;
/** Pedidos que a tela mandou (método, caminho, corpo), para conferir a forma exata. */
let enviados = [];

before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    assert.equal(u.origin, BASE);
    const corpo = init.body === undefined ? undefined : JSON.parse(String(init.body));
    enviados.push({ metodo: init.method ?? 'GET', caminho: `${u.pathname}${u.search}`, corpo });
    const r = await app.inject({ method: init.method ?? 'GET', url: `${u.pathname}${u.search}`, headers: init.headers, ...(init.body !== undefined ? { payload: String(init.body) } : {}) });
    return new Response(r.statusCode === 204 ? null : r.body, { status: r.statusCode, headers: { 'content-type': String(r.headers['content-type'] ?? 'application/json') } });
  };
  S = await import('../../src/services/lancamentoAtividadesService.js');
  R = await import('../../src/lib/atividadeApontamentoRegras.js');
  T = await import('../../src/lib/auth/nativeTokenStorage.js');
});
after(async () => {
  T?.clearNativeToken();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  enviados = [];
});

/** Cenário: tenant com 2 fazendas, tipo com padrões, tipo com as flags e com `exige_producao`, trator, implemento, tarefa. */
const montar = async () => {
  const s = await montarPatrimonio(app);
  const p = prisma();
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: 'PASTAGEM' } });
  const un = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: 'U-1', sigla: 'HA', descricao: 'Hectare' } });
  const tipo = await p.tipoAtividade.create({
    data: { cliente_id: s.c, nome_tipo: 'CIGARRINHA', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, centro_custo_padrao_id: s.centro1.id, unidade_producao_id: un.id, exige_area: true, exige_producao: true },
  });
  const trator = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s)), 201);
  const implemento = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
  const tipoTarefa = await p.tipoTarefa.create({ data: { cliente_id: s.c, nome_tipo: 'ROÇAR', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
  const tarefa = await H.ok(H.req('POST', '/lancamentos-tarefa', s.token, { empresa_id: s.e1.id, titulo: 'Roçar o retiro', tipo: 'Manejo', tipo_tarefa_id: tipoTarefa.id, data_pedido: '2027-06-01' }), 201);
  T.setNativeToken(s.token);
  S.definirFazendaDaTela(s.e1.id);
  return { ...s, grupo, un, tipo, trator, implemento, tarefa };
};

/** Formulário da atividade como o usuário preenche (pt-BR, opções escolhidas). */
const formCheio = (s) => ({
  ...R.formularioAtividadeVazio(HOJE),
  nome: '  Cigarrinha Pasto 01 ',
  tipo_atividade_id: s.tipo.id,
  area_id: s.area1.id,
  bem: { id: s.trator.id, rotulo: 'Trator' },
  safra_ciclo: '2026/2027',
  data_inicio: '2027-06-10',
  data_prevista_fim: '2027-06-12',
  area_planejada: '1.234,5',
  lancamento_tarefa_id: s.tarefa.id,
  observacao: 'aplicar nas bordas',
});

/** O último pedido de escrita mandado pela tela. */
const ultimoEnvio = () => enviados.filter((e) => e.metodo !== 'GET').at(-1);

test('opções de máquina: só MAQUINA, VEICULO e EQUIPAMENTO, envelope { itens, has_more, next_cursor }; operadores ativos', async () => {
  const s = await montar();
  const bens = await S.listarOpcoesBens();
  assert.deepEqual(Object.keys(bens).sort(), ['has_more', 'itens', 'next_cursor']);
  assert.deepEqual(bens.itens.map((b) => b.id), [s.trator.id], 'o implemento não é máquina da atividade');
  assert.deepEqual(Object.keys(bens.itens[0]).sort(), ['codigo_frota', 'id', 'natureza', 'nome', 'numero']);
  assert.equal(bens.itens[0].natureza, 'MAQUINA');
  assert.match(enviados.at(-1).caminho, /^\/api\/native\/atividades-opcoes\/bens\?empresa_id=[^&]+&natureza=MAQUINA&natureza=VEICULO&natureza=EQUIPAMENTO$/);
  // Busca e limite viajam na query.
  assert.deepEqual((await S.listarOpcoesBens({ q: 'TP-02', limit: 5 })).itens.map((b) => b.id), [s.trator.id]);
  // Paginação do seletor: o cursor devolvido leva à página seguinte, com o mesmo filtro de natureza.
  const outro = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { nome: 'Trator TP-09', codigo_frota: 'TP-09' })), 201);
  const p1 = await S.listarOpcoesBens({ limit: 1 });
  assert.equal(p1.has_more, true);
  const p2 = await S.listarOpcoesBens({ limit: 1, cursor: p1.next_cursor });
  assert.deepEqual([...p1.itens, ...p2.itens].map((b) => b.id).sort(), [s.trator.id, outro.id].sort());
  assert.equal(p2.has_more, false);
  const ops = await S.listarOpcoesOperadores({ q: s.adm.usuario.nome });
  assert.ok(ops.itens.some((u) => u.id === s.adm.usuario.id));
  assert.deepEqual(Object.keys(ops.itens[0]).sort(), ['id', 'nome']);
});

test('abrir, editar (inclusive null para limpar), concluir, reabrir, cancelar e duplicar pelo caminho da tela', async () => {
  const s = await montar();
  // ── abrir: o corpo do formulário, sem nada herdado.
  const form = formCheio(s);
  assert.deepEqual(R.validarFormularioAtividade(form, { hoje: HOJE, novo: true, exigencias: R.exigenciasDoTipo(s.tipo) }), {});
  const aberta = await S.criarAtividade(R.corpoDaAtividade(form, { novo: true }));
  const envio = ultimoEnvio();
  assert.deepEqual([envio.metodo, envio.caminho], ['POST', '/api/native/atividades']);
  assert.deepEqual(envio.corpo, {
    empresa_id: s.e1.id,
    tipo_atividade_id: s.tipo.id,
    nome: 'Cigarrinha Pasto 01',
    area_id: s.area1.id,
    bem_id: s.trator.id,
    safra_ciclo: '2026/2027',
    data_inicio: '2027-06-10',
    data_prevista_fim: '2027-06-12',
    area_planejada: '1234.5',
    lancamento_tarefa_id: s.tarefa.id,
    observacao: 'aplicar nas bordas',
  });
  assert.deepEqual([aberta.numero, aberta.status, aberta.versao, aberta.area_planejada], ['1', 'ABERTA', 1, '1234.5000']);
  assert.deepEqual([aberta.setor_id, aberta.centro_custo_id, aberta.unidade_producao_sigla], [s.area1.setor_id, s.centro1.id, 'HA']);
  assert.deepEqual(aberta.lancamento_tarefa, { id: s.tarefa.id, titulo: 'Roçar o retiro', status: s.tarefa.status });
  assert.deepEqual(aberta.totais, { apontamentos_confirmados: 0, apontamentos_cancelados: 0, dias_com_apontamento: 0 });
  // O formulário relido da resposta não acusa mudança (PATCH mínimo vazio).
  assert.deepEqual(R.camposAlteradosDaAtividade(aberta, R.corpoDaAtividade(R.formularioDaAtividade(aberta), { novo: false })), {});

  // ── editar: limpar os opcionais (o formulário manda null) e trocar o nome.
  const editado = { ...R.formularioDaAtividade(aberta), nome: 'Cigarrinha Pasto 01 (bordas)', bem: null, safra_ciclo: '', data_prevista_fim: '', area_planejada: '', lancamento_tarefa_id: '', observacao: '' };
  const mudancas = R.camposAlteradosDaAtividade(aberta, R.corpoDaAtividade(editado, { novo: false }));
  const salva = await S.editarAtividade(aberta.id, { ...mudancas, versao: aberta.versao });
  const envioPatch = ultimoEnvio();
  assert.deepEqual([envioPatch.metodo, envioPatch.caminho], ['PATCH', `/api/native/atividades/${aberta.id}`]);
  assert.deepEqual(envioPatch.corpo, {
    versao: 1,
    nome: 'Cigarrinha Pasto 01 (bordas)',
    bem_id: null,
    safra_ciclo: null,
    data_prevista_fim: null,
    area_planejada: null,
    lancamento_tarefa_id: null,
    observacao: null,
  });
  assert.deepEqual(
    [salva.nome, salva.versao, salva.bem_id, salva.bem, salva.safra_ciclo, salva.data_prevista_fim, salva.area_planejada, salva.lancamento_tarefa_id, salva.observacao],
    ['Cigarrinha Pasto 01 (bordas)', 2, null, null, null, null, null, null, null]
  );
  assert.equal(salva.area_id, s.area1.id, 'área exigida pelo tipo continua');
  assert.ok(salva.totais, 'a escrita devolve o detalhe');

  // ── a lista com os filtros da tela e o detalhe.
  const pagina = await S.listarAtividades({ status: 'ABERTA', tipo_atividade_id: s.tipo.id, area_id: s.area1.id, data_de: '2027-06-01', data_ate: HOJE });
  assert.deepEqual(pagina.items.map((a) => a.id), [aberta.id]);
  assert.equal(pagina.has_more, false);
  assert.deepEqual((await S.obterAtividade(aberta.id)).versao, 2);

  // ── concluir exige produção (tipo com exige_produção): lança um apontamento com produção antes.
  await S.criarApontamento(aberta.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio(HOJE), quantidade_produzida_dia: '3,5' }));
  const concluida = await S.concluirAtividade(aberta.id, { versao: salva.versao, data_conclusao: HOJE });
  assert.deepEqual(ultimoEnvio().corpo, { empresa_id: s.e1.id, versao: 2, data_conclusao: HOJE });
  assert.deepEqual([concluida.status, concluida.data_conclusao, concluida.quantidade_produzida], ['CONCLUIDA', HOJE, '3.5000']);
  assert.equal(concluida.concluida_por.id, s.adm.usuario.id);

  // ── reabrir e cancelar com motivo.
  const reaberta = await S.reabrirAtividade(aberta.id, { versao: concluida.versao, motivo: '  faltou a borda norte ' });
  assert.deepEqual(ultimoEnvio().corpo, { empresa_id: s.e1.id, versao: concluida.versao, motivo: 'faltou a borda norte' });
  assert.deepEqual([reaberta.status, reaberta.data_conclusao, reaberta.motivo_reabertura], ['ABERTA', null, 'faltou a borda norte']);
  const cancelada = await S.cancelarAtividade(aberta.id, { versao: reaberta.versao, motivo: 'chuva forte' });
  assert.deepEqual([cancelada.status, cancelada.motivo_cancelamento, cancelada.quantidade_produzida], ['CANCELADA', 'chuva forte', null]);
  assert.deepEqual(cancelada.totais, { apontamentos_confirmados: 0, apontamentos_cancelados: 1, dias_com_apontamento: 0 });

  // ── duplicar como a página chama (sem corpo além da empresa).
  const nova = await S.duplicarAtividade(cancelada.id);
  assert.deepEqual(ultimoEnvio(), { metodo: 'POST', caminho: `/api/native/atividades/${aberta.id}/duplicar`, corpo: { empresa_id: s.e1.id } });
  assert.deepEqual([nova.numero, nova.status, nova.nome, nova.data_inicio, nova.area_id], ['2', 'ABERTA', 'Cigarrinha Pasto 01 (bordas)', HOJE, s.area1.id]);
  assert.notEqual(nova.id, aberta.id);
});

test('apontamentos: lançar, duas passadas, alerta fora do período, editar com null, repetir, cancelar e listar pelo caminho da tela', async () => {
  const s = await montar();
  const a = await S.criarAtividade(R.corpoDaAtividade(formCheio(s), { novo: true }));

  // ── lançar: o formulário completo (dia, turno, operador, área e produção em pt-BR, observação).
  const form = { ...R.formularioApontamentoVazio(HOJE), data_operacional: '2027-06-11', turno: 'MANHA', operador: { id: s.adm.usuario.id, rotulo: 'x' }, area_executada_dia: '2,25', quantidade_produzida_dia: '10', observacao: 'borda sul' };
  assert.deepEqual(R.validarFormularioApontamento(form, { hoje: HOJE }), {});
  const r1 = await S.criarApontamento(a.id, R.corpoDoApontamento(form));
  assert.deepEqual(ultimoEnvio(), {
    metodo: 'POST',
    caminho: `/api/native/atividades/${a.id}/apontamentos`,
    corpo: { empresa_id: s.e1.id, data_operacional: '2027-06-11', turno: 'MANHA', operador_usuario_id: s.adm.usuario.id, area_executada_dia: '2.25', quantidade_produzida_dia: '10', observacao: 'borda sul' },
  });
  assert.deepEqual(Object.keys(r1).sort(), ['alertas', 'apontamento', 'atividade']);
  assert.deepEqual([r1.apontamento.sequencia, r1.apontamento.origem, r1.apontamento.status, r1.apontamento.area_executada_dia], [1, 'WEB', 'CONFIRMADO', '2.2500']);
  assert.deepEqual(r1.apontamento.operador, { id: s.adm.usuario.id, nome: s.adm.usuario.nome });
  assert.deepEqual(r1.alertas, []);
  assert.deepEqual([r1.atividade.area_executada, r1.atividade.quantidade_produzida, r1.atividade.totais.apontamentos_confirmados], ['2.2500', '10.0000', 1]);

  // ── segunda passada no mesmo dia e turno: sequência 2. O "mínimo" da tela (só a data): os vazios não vão.
  const r2 = await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), turno: 'MANHA' }));
  assert.deepEqual(ultimoEnvio().corpo, { empresa_id: s.e1.id, data_operacional: '2027-06-11', turno: 'MANHA' });
  assert.equal(r2.apontamento.sequencia, 2);

  // ── fora do período (antes do início): grava com o alerta.
  const r3 = await S.criarApontamento(a.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-01')));
  assert.equal(r3.apontamento.sequencia, 1);
  assert.deepEqual(r3.alertas.map((x) => [x.codigo, x.data_inicio, x.data_prevista_fim]), [['FORA_DO_INTERVALO', '2027-06-10', '2027-06-12']]);
  assert.equal(R.foraDoPeriodo('2027-06-01', r3.atividade), true, 'a regra da tela concorda com o servidor');

  // ── editar o primeiro: limpar operador, área e observação (null), trocar o turno.
  const ap1 = r1.apontamento;
  const editado = { ...R.formularioDoApontamento(ap1), turno: 'TARDE', operador: null, area_executada_dia: '', observacao: '' };
  const mudancas = R.camposAlteradosDoApontamento(ap1, R.corpoDoApontamento(editado));
  const r4 = await S.editarApontamento(a.id, ap1.id, { ...mudancas, versao: ap1.versao });
  assert.deepEqual(ultimoEnvio(), {
    metodo: 'PATCH',
    caminho: `/api/native/atividades/${a.id}/apontamentos/${ap1.id}`,
    corpo: { versao: 1, turno: 'TARDE', operador_usuario_id: null, area_executada_dia: null, observacao: null },
  });
  assert.deepEqual(
    [r4.apontamento.turno, r4.apontamento.sequencia, r4.apontamento.operador, r4.apontamento.area_executada_dia, r4.apontamento.observacao, r4.apontamento.versao],
    ['TARDE', 1, null, null, null, 2]
  );
  assert.deepEqual([r4.atividade.area_executada, r4.atividade.quantidade_produzida], [null, '10.0000'], 'totais recalculados');
  // O formulário relido não acusa mudança.
  assert.deepEqual(R.camposAlteradosDoApontamento(r4.apontamento, R.corpoDoApontamento(R.formularioDoApontamento(r4.apontamento))), {});

  // ── repetir sem ajuste: a tela usa o duplicar do servidor (só a data).
  const base = r4.apontamento;
  const formRepetir = R.formularioDaBase(base, HOJE);
  assert.equal(R.mesmoConteudoDaBase(formRepetir, base), true);
  const r5 = await S.duplicarApontamento(a.id, base.id, { data_operacional: formRepetir.data_operacional });
  assert.deepEqual(ultimoEnvio(), { metodo: 'POST', caminho: `/api/native/atividades/${a.id}/apontamentos/${base.id}/duplicar`, corpo: { empresa_id: s.e1.id, data_operacional: HOJE } });
  assert.deepEqual([r5.apontamento.data_operacional, r5.apontamento.turno, r5.apontamento.quantidade_produzida_dia, r5.apontamento.sequencia], [HOJE, 'TARDE', '10.0000', 1]);
  assert.deepEqual(r5.alertas.map((x) => x.codigo), ['FORA_DO_INTERVALO'], 'depois do fim previsto');

  // ── cancelar o repetido.
  const r6 = await S.cancelarApontamento(a.id, r5.apontamento.id, { versao: r5.apontamento.versao, motivo: 'lançado em dobro' });
  assert.deepEqual(ultimoEnvio().corpo, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado em dobro' });
  assert.deepEqual([r6.apontamento.status, r6.apontamento.motivo_cancelamento, r6.alertas], ['CANCELADO', 'lançado em dobro', []]);
  assert.equal(r6.apontamento.cancelado_por.id, s.adm.usuario.id);
  assert.deepEqual([r6.atividade.quantidade_produzida, r6.atividade.totais.apontamentos_cancelados], ['10.0000', 1]);

  // ── listar: { items } na ordem do contrato (dia desc, turno, sequência) e obter um.
  const lista = await S.listarApontamentos(a.id);
  assert.deepEqual(Object.keys(lista), ['items']);
  assert.deepEqual(
    lista.items.map((x) => [x.data_operacional, x.turno, x.sequencia, x.status]),
    [[HOJE, 'TARDE', 1, 'CANCELADO'], ['2027-06-11', 'MANHA', 2, 'CONFIRMADO'], ['2027-06-11', 'TARDE', 1, 'CONFIRMADO'], ['2027-06-01', null, 1, 'CONFIRMADO']]
  );
  assert.deepEqual((await S.obterApontamento(a.id, ap1.id)).id, ap1.id);
});

test('a origem do apontamento é gravada no lançamento e a edição não a manda (o servidor a recusaria)', async () => {
  const s = await montar();
  const a = await S.criarAtividade(R.corpoDaAtividade(formCheio(s), { novo: true }));
  const r = await S.criarApontamento(a.id, { ...R.corpoDoApontamento(R.formularioApontamentoVazio(HOJE)), origem: 'APP' });
  assert.equal(r.apontamento.origem, 'APP');
  const e = await S.editarApontamento(a.id, r.apontamento.id, { origem: 'WEB', observacao: 'x', versao: r.apontamento.versao });
  assert.deepEqual(ultimoEnvio().corpo, { versao: 1, observacao: 'x' });
  assert.equal(e.apontamento.origem, 'APP');
});

test('recusas do servidor chegam à tela com o código, o campo e a frase certos', async () => {
  const s = await montar();
  const L = await import('../../src/lib/lancamentoAtividadesRegras.js');
  /** @param {Promise<unknown>} p */
  const recusa = async (p) => {
    try {
      await p;
    } catch (e) {
      return { code: L.codigoDoErroAtividade(e), campo: L.campoDoErroAtividade(e), mensagem: L.mensagemDeErroAtividade(e) };
    }
    assert.fail('deveria recusar');
  };
  // Flag do tipo (área exigida): 422 com o campo.
  const semArea = await recusa(S.criarAtividade(R.corpoDaAtividade({ ...formCheio(s), area_id: '' }, { novo: true })));
  assert.deepEqual([semArea.code, semArea.campo], ['ATIVIDADE_EXIGIDA_PELO_TIPO', 'area_id']);
  assert.match(semArea.mensagem, /exige a área/);
  const a = await S.criarAtividade(R.corpoDaAtividade(formCheio(s), { novo: true }));
  // Concluir sem produção (exige_producao).
  const semProducao = await recusa(S.concluirAtividade(a.id, { versao: a.versao, data_conclusao: HOJE }));
  assert.deepEqual([semProducao.code, semProducao.campo], ['ATIVIDADE_EXIGIDA_PELO_TIPO', 'quantidade_produzida']);
  // Versão velha.
  await S.editarAtividade(a.id, { nome: 'outro nome', versao: a.versao });
  const velha = await recusa(S.editarAtividade(a.id, { nome: 'mais um', versao: a.versao }));
  assert.equal(velha.code, 'ATIVIDADE_VERSAO_CONFLITO');
  assert.ok(L.CODIGOS_RELER_ATIVIDADE.includes(velha.code));
  // Data futura no apontamento.
  const futura = await recusa(S.criarApontamento(a.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-16'))));
  assert.deepEqual([futura.code, futura.campo], ['ATIVIDADE_DATA_INVALIDA', 'data_operacional']);
  assert.match(futura.mensagem, /não pode ser futura \(hoje na fazenda: 15\/06\/2027\)/);
  // Atividade cancelada não aceita apontamento.
  const atual = await S.obterAtividade(a.id);
  await S.cancelarAtividade(a.id, { versao: atual.versao, motivo: 'chuva forte' });
  const naCancelada = await recusa(S.criarApontamento(a.id, R.corpoDoApontamento(R.formularioApontamentoVazio(HOJE))));
  assert.equal(naCancelada.code, 'ATIVIDADE_STATUS_INVALIDO');
  assert.match(naCancelada.mensagem, /está cancelada/);
  // Outra fazenda: 404, nunca 403.
  S.definirFazendaDaTela(s.e2.id);
  assert.equal((await recusa(S.obterAtividade(a.id))).code, 'ATIVIDADE_NOT_FOUND');
  assert.equal((await recusa(S.listarApontamentos(a.id))).code, 'ATIVIDADE_NOT_FOUND');
});
