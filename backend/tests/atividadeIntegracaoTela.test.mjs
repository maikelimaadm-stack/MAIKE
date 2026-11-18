/**
 * D-PROD-200 (Fatia 2) — integração REAL tela ↔ servidor do Lançamento de
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
 * Fatia 3 (D-PROD-202): linhas de produto e de máquina. Fatia 4 (D-PROD-207): linhas de mão de obra e de serviço —
 * os seletores (mão de obra — funcionário ou terceiro, D-PROD-208 —, serviços, parceiros prestadores), lançar/editar/cancelar, a prévia do custo da janela
 * contra o gravado, os totais com as quatro linhas, o "Repetir" com `mao_obra[]`/`servicos[]` e as cascatas. As
 * respostas cruas ficam em `recebidos` (ex.: a linha escrita em `mao_obra`/`servico`, no singular).
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
/** O que o servidor respondeu a cada pedido (status e corpo cru, antes da API da tela normalizar). */
let recebidos = [];
/** Simula a rede caindo na VOLTA: o servidor grava, a tela não recebe a resposta (resultado incerto). */
let perderProximaResposta = false;

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
    recebidos.push({ status: r.statusCode, corpo: r.statusCode === 204 || !r.body ? null : JSON.parse(r.body) });
    if (perderProximaResposta) {
      perderProximaResposta = false;
      throw new TypeError('Failed to fetch');
    }
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
  recebidos = [];
  perderProximaResposta = false;
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

// ─── D-PROD-202 (Fatia 3): linhas de produto e de máquina pelo caminho da tela ────────────────

/**
 * Cenário das linhas: o da Fatia 2 e, na fazenda 1, um tipo que PERMITE produto e implemento, o herbicida em L com
 * dois lotes FIFO (A: 06-01, 50 L a 5,20; B: 06-03, 100 L a 5,50) num local ativo e a atividade aberta com o trator
 * (horímetro 1520,5 no cadastro).
 */
const montarLinhas = async () => {
  const s = await montar();
  const p = prisma();
  const tipoLinhas = await p.tipoAtividade.create({
    data: { cliente_id: s.c, nome_tipo: 'PULVERIZAÇÃO', grupo_atividade_id: s.grupo.id, grupo_atividade_nome: s.grupo.nome_grupo, permite_produto: true, permite_implemento: true },
  });
  const herbicida = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: 'HB-TELA-1', nome_produto: 'Herbicida glifosato', unidade_principal_estoque: 'L' } });
  const local = await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: 'LT-1', nome: 'Galpão de defensivos' } });
  const lote = async (quantidade, custo, dia) => {
    const l = await p.estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, produto_id: herbicida.id, produto_nome: herbicida.nome_produto, local_estoque_id: local.id, local_estoque_nome: local.nome,
        data_documento: new Date(`${dia}T00:00:00.000Z`), custo_unitario: custo, quantidade_entrada: quantidade, quantidade_disponivel: quantidade, status: 'Disponivel',
      },
    });
    await p.produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: herbicida.id } }, data: { estoque_atual: { increment: quantidade } } });
    return l;
  };
  const loteA = await lote('50.0000', '5.2000', '2027-06-01');
  const loteB = await lote('100.0000', '5.5000', '2027-06-03');
  const a = await S.criarAtividade(R.corpoDaAtividade({ ...formCheio(s), tipo_atividade_id: tipoLinhas.id }, { novo: true }));
  const saldo = async () => {
    const [la, lb, pr] = await Promise.all([
      p.estoqueLoteNota.findUnique({ where: { id: loteA.id } }),
      p.estoqueLoteNota.findUnique({ where: { id: loteB.id } }),
      p.produto.findUnique({ where: { id: herbicida.id } }),
    ]);
    return [la.quantidade_disponivel.toFixed(4), lb.quantidade_disponivel.toFixed(4), pr.estoque_atual.toFixed(4)];
  };
  return { ...s, tipoLinhas, herbicida, local, loteA, loteB, a, saldo };
};

/** Opções das janelas: escopo da pendência e sem perguntas (a tela as faz por diálogo). */
const OPCOES_LINHA = Object.freeze({ escopo: 'tela-teste:adm', confirmarDescarte: () => true, confirmarNovoEnvio: () => true });

test('linhas: seletores, lançar/editar/cancelar produto e máquina, totais e medidor pelo caminho da tela', async () => {
  const s = await montarLinhas();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  const r0 = await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), area_executada_dia: '2' }));
  let ap = r0.apontamento;
  assert.deepEqual([ap.produtos, ap.maquinas], [[], []], 'o apontamento traz as listas de linhas, vazias');

  // ── seletores: produtos (com a atividade), locais com saldo, implementos e o medidor.
  const produtos = await S.listarOpcoesProdutos(a.id);
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades-opcoes/produtos?empresa_id=${s.e1.id}&atividade_id=${a.id}`);
  assert.deepEqual(produtos.itens.map((x) => [x.id, x.unidade, x.favorito]), [[s.herbicida.id, 'L', false]]);
  const locais = await S.listarLocaisDoProduto(s.herbicida.id);
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.herbicida.id}`);
  assert.deepEqual(locais.itens.map((x) => [x.local_estoque_id, x.disponivel, x.unidade]), [[s.local.id, '150.0000', 'L']]);
  const implementos = await S.listarOpcoesImplementos();
  assert.match(enviados.at(-1).caminho, /^\/api\/native\/atividades-opcoes\/implementos\?empresa_id=[^&]+$/);
  assert.deepEqual(implementos.itens.map((x) => x.id), [s.implemento.id]);
  const medidor = LR.medidorDaResposta(await S.obterMedidorDoBem(s.trator.id, ap.data_operacional));
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades-opcoes/medidor?empresa_id=${s.e1.id}&bem_id=${s.trator.id}&data=2027-06-11`);
  assert.deepEqual([medidor.tipo, medidor.contador, medidor.vigente?.leitura, medidor.vigente?.origem], ['HORIMETRO', true, '1520.5000', 'CADASTRO']);

  // ── produto: lançar (a janela: produto, local, quantidade em pt-BR).
  const formP = { ...LR.formularioProdutoVazio(), produto: LR.produtoEscolhido(produtos.itens[0]), local_estoque_id: s.local.id, quantidade: '30' };
  assert.deepEqual(LR.validarLinhaProduto(formP, { disponivel: locais.itens[0].disponivel }).erros, {});
  const rp1 = await S.adicionarLinha('produtos', a.id, ap, LR.corpoDaLinhaProduto(formP), OPCOES_LINHA);
  const envP1 = ultimoEnvio();
  assert.deepEqual([envP1.metodo, envP1.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/produtos`]);
  const { operation_id: op1, ...restoP1 } = envP1.corpo;
  assert.match(op1, /^[A-Za-z0-9_.:-]{8,128}$/);
  assert.deepEqual(restoP1, { produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '30', empresa_id: s.e1.id, versao: 1 });
  ap = rp1.apontamento;
  const linhaP1 = ap.produtos[0];
  assert.deepEqual(
    [ap.versao, linhaP1.status, linhaP1.quantidade, linhaP1.unidade, linhaP1.dose_ha, linhaP1.custo_unitario, linhaP1.custo_total],
    [2, 'CONFIRMADO', '30.0000', 'L', '15.0000', '5.2000', '156.0000']
  );
  assert.deepEqual(await s.saldo(), ['20.0000', '100.0000', '120.0000']);
  // O produto usado vira favorito no seletor.
  assert.deepEqual((await S.listarOpcoesProdutos(a.id)).itens.map((x) => [x.id, x.favorito]), [[s.herbicida.id, true]]);

  // ── produto: editar só a quantidade (PATCH mínimo) = estorno exato + nova saída.
  const mudancasP = LR.camposAlteradosDaLinha(linhaP1, LR.corpoDaLinhaProduto({ ...LR.formularioDaLinhaProduto(linhaP1), quantidade: '60' }));
  assert.deepEqual(mudancasP, { quantidade: '60' });
  const rp2 = await S.editarLinha('produtos', a.id, ap, linhaP1, mudancasP, OPCOES_LINHA);
  const envP2 = ultimoEnvio();
  assert.deepEqual([envP2.metodo, envP2.caminho], ['PATCH', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/produtos/${linhaP1.id}`]);
  const { operation_id: op2, ...restoP2 } = envP2.corpo;
  assert.notEqual(op2, op1);
  assert.deepEqual(restoP2, { quantidade: '60', empresa_id: s.e1.id, versao: 2 });
  ap = rp2.apontamento;
  assert.deepEqual(ap.produtos.map((l) => [l.status, l.quantidade, l.custo_total, l.cancelamento_origem]), [
    ['CANCELADO', '30.0000', '156.0000', 'EDICAO'],
    ['CONFIRMADO', '60.0000', '315.0000', null], // 50 × 5,20 + 10 × 5,50
  ]);
  assert.deepEqual(await s.saldo(), ['0.0000', '90.0000', '90.0000']);

  // ── máquina: lançar com implemento e as leituras (a inicial sugerida pela vigente).
  const formM = { ...LR.formularioMaquinaVazio(a.bem), implemento: LR.bemEscolhido(implementos.itens[0]), leitura_inicial: '1520,5', leitura_final: '1528' };
  const pede = LR.passaDoTeto(LR.usoDaLinha(formM, medidor), medidor.teto);
  assert.deepEqual(LR.validarLinhaMaquina(formM, { medidor, permiteImplemento: true, pedeJustificativa: pede }), {});
  const rm1 = await S.adicionarLinha('maquinas', a.id, ap, LR.corpoDaLinhaMaquina(formM, medidor, { comJustificativa: pede }), OPCOES_LINHA);
  const envM1 = ultimoEnvio();
  assert.deepEqual([envM1.metodo, envM1.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/maquinas`]);
  const { operation_id: om1, ...restoM1 } = envM1.corpo;
  assert.notEqual(om1, op2, 'cada ação leva a sua chave');
  assert.deepEqual(restoM1, {
    bem_id: s.trator.id, implemento_bem_id: s.implemento.id, sem_medidor: false, leitura_inicial: '1520.5', leitura_final: '1528', empresa_id: s.e1.id, versao: 3,
  });
  ap = rm1.apontamento;
  const linhaM1 = ap.maquinas[0];
  assert.deepEqual(
    [ap.versao, linhaM1.status, linhaM1.medidor_tipo, linhaM1.leitura_inicial, linhaM1.leitura_final, linhaM1.quantidade_uso, linhaM1.implemento_bem_id],
    [4, 'CONFIRMADO', 'HORIMETRO', '1520.5000', '1528.0000', '7.5000', s.implemento.id]
  );

  // ── máquina: editar só a leitura final (PATCH mínimo) = cancela a linha (EDICAO) e cria outra.
  const mudancasM = LR.camposAlteradosDaLinha(linhaM1, LR.corpoDaLinhaMaquina({ ...LR.formularioDaLinhaMaquina(linhaM1), leitura_final: '1530' }, medidor, { comJustificativa: false }));
  // O uso da linha com medidor é do servidor: a tela manda `quantidade_uso: null` (o servidor o ignora e recalcula).
  assert.deepEqual(mudancasM, { leitura_final: '1530', quantidade_uso: null });
  const rm2 = await S.editarLinha('maquinas', a.id, ap, linhaM1, mudancasM, OPCOES_LINHA);
  const { operation_id: om2, ...restoM2 } = ultimoEnvio().corpo;
  assert.notEqual(om2, om1);
  assert.deepEqual(restoM2, { leitura_final: '1530', quantidade_uso: null, empresa_id: s.e1.id, versao: 4 });
  ap = rm2.apontamento;
  assert.deepEqual(ap.maquinas.map((l) => [l.status, l.quantidade_uso, l.cancelamento_origem]), [['CANCELADO', '7.5000', 'EDICAO'], ['CONFIRMADO', '9.5000', null]]);
  // A leitura da linha passa a ser a vigente do bem (sem gravar o bem).
  const depois = LR.medidorDaResposta(await S.obterMedidorDoBem(s.trator.id, HOJE));
  assert.deepEqual([depois.vigente?.leitura, depois.vigente?.origem], ['1530.0000', 'ATIVIDADE']);
  assert.equal((await prisma().bemPatrimonial.findUnique({ where: { id: s.trator.id } })).medidor_leitura_atual.toFixed(4), '1520.5000');

  // ── totais (o totalizador): produto, máquina, custo e custo/ha (área do dia 2 ha).
  const totais = await S.obterTotaisAtividade(a.id);
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades/${a.id}/totais?empresa_id=${s.e1.id}`);
  assert.deepEqual(
    [totais.area_executada, totais.produtos.map((x) => [x.produto_id, x.unidade, x.quantidade, x.custo_total]), totais.maquinas.map((x) => [x.bem_id, x.quantidade_uso, x.custo_total])],
    ['2.0000', [[s.herbicida.id, 'L', '60.0000', '315.0000']], [[s.trator.id, '9.5000', null]]]
  );
  assert.deepEqual([totais.custo_total, totais.custo_por_ha], ['315.0000', '157.5000']);

  // ── cancelar as linhas (motivo aparado), cada uma com a versão relida: o estoque volta exato.
  const linhaP2 = ap.produtos[1];
  const rc1 = await S.cancelarLinha('produtos', a.id, ap, linhaP2, '  lançado errado ', OPCOES_LINHA);
  const envC1 = ultimoEnvio();
  assert.deepEqual([envC1.metodo, envC1.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/produtos/${linhaP2.id}/cancelar`]);
  const { operation_id: oc1, ...restoC1 } = envC1.corpo;
  assert.match(oc1, /^[A-Za-z0-9_.:-]{8,128}$/);
  assert.deepEqual(restoC1, { empresa_id: s.e1.id, versao: 5, motivo: 'lançado errado' });
  ap = rc1.apontamento;
  assert.deepEqual(ap.produtos.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'EDICAO'], ['CANCELADO', 'LINHA']]);
  assert.deepEqual(await s.saldo(), ['50.0000', '100.0000', '150.0000']);
  const rc2 = await S.cancelarLinha('maquinas', a.id, ap, ap.maquinas[1], 'leitura errada', OPCOES_LINHA);
  ap = rc2.apontamento;
  assert.deepEqual(ap.maquinas.map((l) => l.status), ['CANCELADO', 'CANCELADO']);
  assert.equal(LR.medidorDaResposta(await S.obterMedidorDoBem(s.trator.id, HOJE)).vigente?.leitura, '1520.5000', 'a leitura cancelada sai da série');
  const zerado = await S.obterTotaisAtividade(a.id);
  assert.deepEqual([zerado.produtos, zerado.maquinas, zerado.custo_total, zerado.custo_por_ha], [[], [], null, null]);
  // A lista traz as linhas canceladas.
  const lista = await S.listarApontamentos(a.id);
  assert.deepEqual(lista.items[0].produtos.map((l) => l.status), ['CANCELADO', 'CANCELADO']);
  assert.deepEqual(lista.items[0].maquinas.map((l) => l.status), ['CANCELADO', 'CANCELADO']);
});

test('linhas: "Repetir" com as linhas numa transação, reenvio sem resposta com a MESMA chave (sem baixa dupla) e cancelar o apontamento estorna', async () => {
  const s = await montarLinhas();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  // Base: um apontamento com uma linha de cada.
  const r0 = await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), turno: 'MANHA', area_executada_dia: '4' }));
  let base = (await S.adicionarLinha('produtos', a.id, r0.apontamento, { produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '20' }, OPCOES_LINHA)).apontamento;
  base = (await S.adicionarLinha('maquinas', a.id, base, { bem_id: s.trator.id, sem_medidor: false, leitura_inicial: '1520.5', leitura_final: '1526' }, OPCOES_LINHA)).apontamento;
  assert.deepEqual(await s.saldo(), ['30.0000', '100.0000', '130.0000']);

  // ── "Repetir": as linhas confirmadas da base preenchidas; o operador ajusta a quantidade e a leitura final.
  const rasc = LR.linhasParaRepetir(base);
  assert.equal(rasc.produtos.length, 1);
  assert.equal(rasc.maquinas.length, 1);
  assert.deepEqual([rasc.maquinas[0].form.leitura_inicial, rasc.maquinas[0].form.leitura_final], ['', ''], 'a leitura não é copiada');
  const medidor = LR.medidorDaResposta(await S.obterMedidorDoBem(s.trator.id, HOJE));
  assert.equal(medidor.vigente?.leitura, '1526.0000');
  const formDia = R.formularioDaBase(base, HOJE);
  const corpo = {
    ...R.corpoDoApontamento(formDia),
    produtos: [LR.corpoDaLinhaProduto({ ...rasc.produtos[0].form, quantidade: '40' })],
    maquinas: [LR.corpoDaLinhaMaquina({ ...rasc.maquinas[0].form, leitura_inicial: '1526', leitura_final: '1531,5' }, medidor, { comJustificativa: false })],
  };
  // O envio se perde DEPOIS de o servidor gravar (rede caiu na volta): resultado incerto.
  perderProximaResposta = true;
  await assert.rejects(S.criarApontamento(a.id, corpo, OPCOES_LINHA));
  const perdido = ultimoEnvio();
  assert.deepEqual([perdido.metodo, perdido.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos`]);
  const { operation_id: opL, ...restoL } = perdido.corpo;
  assert.match(opL, /^[A-Za-z0-9_.:-]{8,120}$/);
  assert.deepEqual(restoL, {
    empresa_id: s.e1.id,
    data_operacional: HOJE,
    turno: 'MANHA',
    area_executada_dia: '4',
    produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '40' }],
    maquinas: [{ bem_id: s.trator.id, sem_medidor: false, leitura_inicial: '1526', leitura_final: '1531.5' }],
  });
  assert.deepEqual(await s.saldo(), ['0.0000', '90.0000', '90.0000'], 'o servidor gravou');
  // "Repetir o mesmo envio": a MESMA chave; o servidor devolve o gravado, sem baixar de novo.
  const r1 = await S.criarApontamento(a.id, corpo, { ...OPCOES_LINHA, retentativa: true });
  assert.equal(ultimoEnvio().corpo.operation_id, opL);
  assert.deepEqual(await s.saldo(), ['0.0000', '90.0000', '90.0000'], 'nenhuma baixa a mais');
  const novo = r1.apontamento;
  assert.deepEqual([novo.data_operacional, novo.turno, novo.status], [HOJE, 'MANHA', 'CONFIRMADO']);
  assert.deepEqual(novo.produtos.map((l) => [l.status, l.quantidade, l.custo_total, l.dose_ha]), [['CONFIRMADO', '40.0000', '211.0000', '10.0000']]); // 30 × 5,20 + 10 × 5,50
  assert.deepEqual(novo.maquinas.map((l) => [l.status, l.leitura_inicial, l.leitura_final, l.quantidade_uso]), [['CONFIRMADO', '1526.0000', '1531.5000', '5.5000']]);
  assert.equal((await prisma().atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: a.id } })), 2, 'um apontamento só do "Repetir"');

  // ── a data do apontamento com linhas não muda: a recusa chega à tela com o código.
  const L = await import('../../src/lib/lancamentoAtividadesRegras.js');
  let recusa = null;
  try {
    await S.editarApontamento(a.id, novo.id, { data_operacional: '2027-06-14', versao: novo.versao });
  } catch (e) {
    recusa = L.codigoDoErroAtividade(e);
  }
  assert.equal(recusa, 'ATIVIDADE_DATA_COM_LINHAS');

  // ── cancelar o apontamento: as duas linhas caem (origem APONTAMENTO) e o estoque volta exato.
  const rc = await S.cancelarApontamento(a.id, novo.id, { versao: novo.versao, motivo: 'repetido por engano' });
  assert.deepEqual(rc.apontamento.produtos.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'APONTAMENTO']]);
  assert.deepEqual(rc.apontamento.maquinas.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'APONTAMENTO']]);
  assert.deepEqual(await s.saldo(), ['30.0000', '100.0000', '130.0000']);
  assert.equal(LR.medidorDaResposta(await S.obterMedidorDoBem(s.trator.id, HOJE)).vigente?.leitura, '1526.0000');

  // ── cancelar a atividade: as linhas da base também caem (origem ATIVIDADE) e o estoque volta inteiro.
  const atual = await S.obterAtividade(a.id);
  await S.cancelarAtividade(a.id, { versao: atual.versao, motivo: 'chuva forte' });
  const baseRelida = await S.obterApontamento(a.id, base.id);
  assert.deepEqual(baseRelida.produtos.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'ATIVIDADE']]);
  assert.deepEqual(baseRelida.maquinas.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'ATIVIDADE']]);
  assert.deepEqual(await s.saldo(), ['50.0000', '100.0000', '150.0000']);
});

test('linhas: o salto do medidor conta da leitura vigente — a recusa chega à janela com a frase e o campo, e o reenvio com justificativa grava', async () => {
  const s = await montarLinhas();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  const tipoBem = await H.ok(H.req('GET', `/patrimonio-tipos/${s.trator.tipo.id}`, s.token));
  await H.ok(H.req('PATCH', `/patrimonio-tipos/${s.trator.tipo.id}`, s.token, { versao: tipoBem.versao, salto_maximo_medidor: '10' }));
  const ap = (await S.criarApontamento(a.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-11')))).apontamento;
  const medidor = LR.medidorDaResposta(await S.obterMedidorDoBem(s.trator.id, ap.data_operacional));
  assert.equal(medidor.teto, '10.0000');
  // O operador digita 9000 na inicial (a sugerida era 1520,5): o uso é 5 h, mas o medidor saltaria 7484,5 h.
  const form = { ...LR.formularioMaquinaVazio(a.bem), leitura_inicial: '9000', leitura_final: '9005' };
  const pede = LR.passaDoTeto(LR.usoDaLinha(form, medidor), medidor.teto);
  assert.equal(pede, false, 'pelo uso, a tela não pediria a justificativa');
  let recusa = null;
  try {
    await S.adicionarLinha('maquinas', a.id, ap, LR.corpoDaLinhaMaquina(form, medidor, { comJustificativa: pede }), OPCOES_LINHA);
  } catch (e) {
    recusa = e;
  }
  assert.ok(recusa, 'o servidor recusa');
  assert.equal(LR.ehSaltoDoMedidor(recusa), true);
  assert.equal(LR.campoDaLinhaRecusada(recusa), 'justificativa_salto');
  assert.match(LR.mensagemDeErroLinha(recusa, ''), /^O medidor anda 7\.484,5 h desde a última leitura \(1\.520,5\) neste lançamento e passa do teto de salto \(10 h\)\./);
  // Com a justificativa (a janela a pede depois da recusa), grava.
  const ok = await S.adicionarLinha('maquinas', a.id, ap, LR.corpoDaLinhaMaquina({ ...form, justificativa_salto: ' horímetro trocado ' }, medidor, { comJustificativa: true }), OPCOES_LINHA);
  assert.deepEqual(ok.apontamento.maquinas.map((l) => [l.quantidade_uso, l.justificativa_salto]), [['5.0000', 'horímetro trocado']]);
});

// ─── D-PROD-207 (Fatia 4): linhas de mão de obra e de serviço pelo caminho da tela ────────────

/**
 * Cenário de custo: o das linhas (Fatia 3) com o tipo da atividade passando a permitir mão de obra e serviço; na
 * fazenda 1, parceiros-funcionário (João mensalista com custo de hora 25,5 e de diária 180; Pedro diarista sem custo; Tião
 * terceirizado, D-PROD-209), um inativo e um da fazenda 2; serviços (gradagem em HA com referência 150, frete em UN sem
 * referência), um inativo e um da fazenda 2; parceiros prestador de serviço, só fornecedor, prestador inativo e
 * prestador da fazenda 2. Criados direto pelo Prisma (o CRUD dos cadastros é outro módulo).
 */
const montarCusto = async () => {
  const s = await montarLinhas();
  const p = prisma();
  await p.tipoAtividade.updateMany({ where: { cliente_id: s.c, id: s.tipoLinhas.id }, data: { permite_mao_obra: true, permite_servico: true } });
  const un = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: 'U-2', sigla: 'UN', descricao: 'Unidade' } });
  let n = 0;
  // D-PROD-208: o funcionário é um PARCEIRO com o papel `funcionario` e os dados dele nas colunas `funcionario_*`.
  const funcionario = (empresa, { cargo = null, tipo, custo_hora = null, custo_diaria = null, ...dados }) =>
    p.fornecedor.create({
      data: {
        cliente_id: s.c, empresa_id: empresa.id, numero_cadastro: `F-${(n += 1)}`, tipo_pessoa: 'Física', tipos: ['funcionario'],
        funcionario_tipo: tipo, funcionario_cargo: cargo, funcionario_custo_hora: custo_hora, funcionario_custo_diaria: custo_diaria, ...dados,
      },
    });
  const servico = (empresa, dados) => p.servico.create({ data: { cliente_id: s.c, empresa_id: empresa.id, numero: `S-${(n += 1)}`, unidade_medida_id: s.un.id, ...dados } });
  const parceiro = (empresa, nome, tipos, ativo = true) =>
    p.fornecedor.create({ data: { cliente_id: s.c, empresa_id: empresa.id, numero_cadastro: `PS-${(n += 1)}`, tipo_pessoa: 'Jurídica', nome, tipos, ativo } });
  const joao = await funcionario(s.e1, { nome: 'João Mensalista', cargo: 'Tratorista', tipo: 'MENSALISTA', custo_hora: '25.5', custo_diaria: '180' });
  const pedro = await funcionario(s.e1, { nome: 'Pedro Diarista', tipo: 'DIARISTA' });
  const tiao = await funcionario(s.e1, { nome: 'Tião Terceirizado', tipo: 'TERCEIRIZADO' });
  await funcionario(s.e1, { nome: 'Antigo Inativo', tipo: 'DIARISTA', custo_hora: '10', ativo: false });
  await funcionario(s.e2, { nome: 'Funcionário da Fazenda 2', tipo: 'DIARISTA', custo_hora: '10' });
  const gradagem = await servico(s.e1, { nome: 'Gradagem terceirizada', valor_referencia: '150' });
  const frete = await servico(s.e1, { nome: 'Frete de calcário', unidade_medida_id: un.id });
  await servico(s.e1, { nome: 'Serviço antigo', ativo: false });
  await servico(s.e2, { nome: 'Serviço da Fazenda 2' });
  const prestador = await parceiro(s.e1, 'Prestadora Terra Boa', ['prestador_servico']);
  const soFornecedor = await parceiro(s.e1, 'Só Fornecedor', ['fornecedor']);
  const prestadorInativo = await parceiro(s.e1, 'Prestadora Fechada', ['prestador_servico'], false);
  const prestadorE2 = await parceiro(s.e2, 'Prestadora da Fazenda 2', ['prestador_servico']);
  /** Linhas gravadas do tenant (prova de "nada a mais"). */
  const contagem = async () => [
    await p.atividadeApontamento.count({ where: { cliente_id: s.c } }),
    await p.atividadeApontamentoMaoObra.count({ where: { cliente_id: s.c } }),
    await p.atividadeApontamentoServico.count({ where: { cliente_id: s.c } }),
  ];
  return { ...s, un2: un, joao, pedro, tiao, gradagem, frete, prestador, soFornecedor, prestadorInativo, prestadorE2, contagem };
};

/** Recusa de uma promessa (falha se ela gravar). @param {Promise<unknown>} pr */
const recusaDe = async (pr) => {
  try {
    await pr;
  } catch (e) {
    return e;
  }
  return assert.fail('deveria recusar');
};

test('mão de obra: flags do tipo, seletor de funcionários e terceiros, lançar (hora do cadastro, tarefa digitada, sem custo, terceiro com custo digitado), editar trocando a medida e cancelar pelo caminho da tela', async () => {
  const s = await montarCusto();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  // O bloco aparece pela lista de tipos (a mesma leitura da ListaApontamentos).
  const tipos = await S.listarTiposAtividade();
  assert.deepEqual(LR.flagsDoTipoDaAtividade(a, tipos), { permiteProduto: true, permiteImplemento: true, permiteMaoObra: true, permiteServico: true });
  let ap = (await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), area_executada_dia: '2' }))).apontamento;
  assert.deepEqual([ap.mao_obra, ap.servicos], [[], []], 'o apontamento traz as listas novas, vazias');

  // ── seletor (D-PROD-208): parceiros ativos da fazenda com o papel funcionário ou prestador de serviço (terceiro), em
  // ordem de nome; o funcionário com o tipo e os custos do cadastro, o terceiro sem eles.
  const opcoes = await S.listarOpcoesMaoObra();
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades-opcoes/mao-obra?empresa_id=${s.e1.id}`);
  assert.deepEqual(opcoes.itens.map((f) => [f.id, f.origem]), [
    [s.joao.id, 'FUNCIONARIO'], [s.pedro.id, 'FUNCIONARIO'], [s.prestador.id, 'TERCEIRO'], [s.tiao.id, 'FUNCIONARIO'],
  ]);
  assert.deepEqual(Object.keys(opcoes.itens[0]).sort(), ['funcionario_custo_diaria', 'funcionario_custo_hora', 'funcionario_tipo', 'id', 'nome', 'origem']);
  assert.deepEqual((await S.listarOpcoesMaoObra({ q: 'terra' })).itens.map((f) => f.id), [s.prestador.id], 'a busca vê o nome');
  const porId = (/** @type {string} */ id) => opcoes.itens.find((f) => f.id === id);
  const joao = LR.maoObraEscolhida(porId(s.joao.id));
  assert.deepEqual(joao, { id: s.joao.id, rotulo: 'João Mensalista', origem: 'FUNCIONARIO', tipo: 'MENSALISTA', custo_hora: '25.5000', custo_diaria: '180.0000' });
  const terceiro = LR.maoObraEscolhida(porId(s.prestador.id));
  assert.deepEqual(terceiro, { id: s.prestador.id, rotulo: 'Prestadora Terra Boa', origem: 'TERCEIRO', tipo: null, custo_hora: null, custo_diaria: null });

  // ── lançar HORA: a medida sugerida pelo tipo, o custo do cadastro (a prévia da janela = o gravado).
  const formH = { ...LR.formularioMaoObraVazio(), parceiro: joao, tipo_medida: LR.medidaSugeridaDaMaoObra(joao), quantidade: '8' };
  assert.equal(formH.tipo_medida, 'HORA');
  assert.deepEqual(LR.validarLinhaMaoObra(formH), {});
  const previaH = LR.custoDaLinhaMaoObra(formH);
  assert.deepEqual(previaH, { unitario: '25.5000', total: '204.0000' });
  const rh = await S.adicionarLinha('mao-obra', a.id, ap, LR.corpoDaLinhaMaoObra(formH), OPCOES_LINHA);
  const envH = ultimoEnvio();
  assert.deepEqual([envH.metodo, envH.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/mao-obra`]);
  const { operation_id: oh, ...restoH } = envH.corpo;
  assert.match(oh, /^[A-Za-z0-9_.:-]{8,128}$/);
  assert.deepEqual(restoH, { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8', empresa_id: s.e1.id, versao: 1 }, 'hora: o custo não vai (o servidor o recusaria)');
  // A resposta crua traz a linha escrita em `mao_obra` (singular); a tela lê o apontamento relido.
  const cruH = recebidos.at(-1);
  assert.equal(cruH.status, 201);
  assert.deepEqual(Object.keys(cruH.corpo).sort(), ['alertas', 'apontamento', 'atividade', 'mao_obra']);
  assert.deepEqual(Object.keys(rh).sort(), ['alertas', 'apontamento', 'atividade']);
  ap = rh.apontamento;
  const lH = ap.mao_obra[0];
  assert.deepEqual(cruH.corpo.mao_obra, lH);
  assert.deepEqual(
    [ap.versao, lH.status, lH.parceiro_id, lH.tipo_medida, lH.quantidade, lH.custo_unitario, lH.custo_total],
    [2, 'CONFIRMADO', s.joao.id, 'HORA', '8.0000', previaH.unitario, previaH.total]
  );
  assert.deepEqual([LR.rotuloDaMaoObraDaLinha(lH), lH.origem, LR.formatarQuantidadeMaoObra(lH.quantidade, lH.tipo_medida)], ['João Mensalista', 'FUNCIONARIO', '8 h']);
  // O formulário relido da linha não acusa mudança e mostra o mesmo custo.
  assert.deepEqual(LR.camposAlteradosDaLinhaMaoObra(lH, LR.corpoDaLinhaMaoObra(LR.formularioDaLinhaMaoObra(lH))), {});
  assert.deepEqual(LR.custoDaLinhaMaoObra(LR.formularioDaLinhaMaoObra(lH)), previaH);

  // ── TAREFA digitada (Tião) e HORA sem custo no cadastro (Pedro): a linha entra sem custo. D-PROD-209: o terceirizado
  // sugere HORA (a medida TAREFA continua existindo; o operador a escolhe na linha).
  const tiao = LR.maoObraEscolhida(porId(s.tiao.id));
  assert.equal(LR.medidaSugeridaDaMaoObra(tiao), 'HORA');
  const formT = { ...LR.formularioMaoObraVazio(), parceiro: tiao, tipo_medida: 'TAREFA', quantidade: '3', custo_unitario: '35,5' };
  assert.deepEqual([formT.tipo_medida, LR.validarLinhaMaoObra(formT)], ['TAREFA', {}]);
  ap = (await S.adicionarLinha('mao-obra', a.id, ap, LR.corpoDaLinhaMaoObra(formT), OPCOES_LINHA)).apontamento;
  const restoT = { ...ultimoEnvio().corpo };
  delete restoT.operation_id;
  assert.deepEqual(restoT, { parceiro_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '3', custo_unitario: '35.5', empresa_id: s.e1.id, versao: 2 });
  assert.deepEqual([ap.mao_obra[1].custo_unitario, ap.mao_obra[1].custo_total], ['35.5000', LR.custoDaLinhaMaoObra(formT).total]);
  const formP = { ...LR.formularioMaoObraVazio(), parceiro: LR.maoObraEscolhida(porId(s.pedro.id)), tipo_medida: 'HORA', quantidade: '4' };
  assert.deepEqual(LR.custoDaLinhaMaoObra(formP), { unitario: null, total: null }, 'a janela avisa: sem custo no cadastro');
  ap = (await S.adicionarLinha('mao-obra', a.id, ap, LR.corpoDaLinhaMaoObra(formP), OPCOES_LINHA)).apontamento;
  assert.deepEqual([ap.mao_obra[2].parceiro_id, ap.mao_obra[2].custo_unitario, ap.mao_obra[2].custo_total], [s.pedro.id, null, null]);

  // ── editar trocando a medida HORA → DIÁRIA: o custo vem do cadastro (o corpo não leva custo) e a prévia concorda.
  const formD = { ...LR.formularioDaLinhaMaoObra(lH), tipo_medida: 'DIARIA', quantidade: '1' };
  const mudD = LR.camposAlteradosDaLinhaMaoObra(lH, LR.corpoDaLinhaMaoObra(formD));
  assert.deepEqual(mudD, { tipo_medida: 'DIARIA', quantidade: '1' });
  const rd = await S.editarLinha('mao-obra', a.id, ap, lH, mudD, OPCOES_LINHA);
  const envD = ultimoEnvio();
  assert.deepEqual([envD.metodo, envD.caminho], ['PATCH', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/mao-obra/${lH.id}`]);
  const { operation_id: od, ...restoD } = envD.corpo;
  assert.notEqual(od, oh);
  assert.deepEqual(restoD, { tipo_medida: 'DIARIA', quantidade: '1', empresa_id: s.e1.id, versao: 4 });
  assert.equal(recebidos.at(-1).corpo.mao_obra.id, rd.apontamento.mao_obra.at(-1).id, 'a escrita devolve a linha NOVA');
  ap = rd.apontamento;
  const lD = ap.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.joao.id);
  assert.deepEqual(
    ap.mao_obra.filter((l) => l.parceiro_id === s.joao.id).map((l) => [l.status, l.tipo_medida, l.quantidade, l.custo_unitario, l.custo_total, l.cancelamento_origem]),
    [['CANCELADO', 'HORA', '8.0000', '25.5000', '204.0000', 'EDICAO'], ['CONFIRMADO', 'DIARIA', '1.0000', '180.0000', '180.0000', null]]
  );
  assert.deepEqual(LR.custoDaLinhaMaoObra(formD), { unitario: lD.custo_unitario, total: lD.custo_total }, 'a prévia da janela = o gravado');

  // ── DIÁRIA → TAREFA com o MESMO valor do snapshot (180): o custo digitado vai assim mesmo.
  const formT2 = { ...LR.formularioDaLinhaMaoObra(lD), tipo_medida: 'TAREFA', custo_unitario: '180', quantidade: '2' };
  const mudT2 = LR.camposAlteradosDaLinhaMaoObra(lD, LR.corpoDaLinhaMaoObra(formT2));
  assert.deepEqual(mudT2, { tipo_medida: 'TAREFA', quantidade: '2', custo_unitario: '180' });
  ap = (await S.editarLinha('mao-obra', a.id, ap, lD, mudT2, OPCOES_LINHA)).apontamento;
  const lT2 = ap.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.joao.id);
  assert.deepEqual([lT2.tipo_medida, lT2.custo_unitario, lT2.custo_total], ['TAREFA', '180.0000', '360.0000']);
  // TAREFA: só a quantidade muda; o custo digitado continua (não vai de novo).
  const mudQ = LR.camposAlteradosDaLinhaMaoObra(lT2, LR.corpoDaLinhaMaoObra({ ...LR.formularioDaLinhaMaoObra(lT2), quantidade: '3' }));
  assert.deepEqual(mudQ, { quantidade: '3' });
  ap = (await S.editarLinha('mao-obra', a.id, ap, lT2, mudQ, OPCOES_LINHA)).apontamento;
  const lT3 = ap.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.joao.id);
  assert.deepEqual([lT3.tipo_medida, lT3.custo_unitario, lT3.custo_total], ['TAREFA', '180.0000', '540.0000']);
  // TAREFA → HORA: o custo volta a ser o do cadastro (a prévia concorda).
  const formH2 = { ...LR.formularioDaLinhaMaoObra(lT3), tipo_medida: 'HORA' };
  const mudH2 = LR.camposAlteradosDaLinhaMaoObra(lT3, LR.corpoDaLinhaMaoObra(formH2));
  assert.deepEqual(mudH2, { tipo_medida: 'HORA' });
  ap = (await S.editarLinha('mao-obra', a.id, ap, lT3, mudH2, OPCOES_LINHA)).apontamento;
  const lH2 = ap.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.joao.id);
  assert.deepEqual([lH2.tipo_medida, lH2.quantidade, lH2.custo_unitario, lH2.custo_total], ['HORA', '3.0000', '25.5000', '76.5000']);
  assert.deepEqual(LR.custoDaLinhaMaoObra(formH2), { unitario: lH2.custo_unitario, total: lH2.custo_total }, 'a prévia da janela = o gravado');

  // O custo de hora sai do cadastro: editar SEM trocar funcionário nem medida mantém o snapshot gravado (só o total
  // segue a quantidade nova), e a prévia da janela concorda; trocar a medida mostraria o cadastro atual.
  await prisma().fornecedor.updateMany({ where: { cliente_id: s.c, id: s.joao.id }, data: { funcionario_custo_hora: null } });
  ap = await S.obterApontamento(a.id, ap.id);
  const lH2b = ap.mao_obra.find((l) => l.id === lH2.id);
  assert.deepEqual([lH2b.custo_unitario, lH2b.parceiro.funcionario_custo_hora], ['25.5000', null], 'a linha guarda o snapshot; o resumo, o cadastro atual');
  const formSem = { ...LR.formularioDaLinhaMaoObra(lH2b), quantidade: '2' };
  assert.deepEqual(LR.custoDaLinhaMaoObra(formSem), { unitario: '25.5000', total: '51.0000' }, 'mesmo funcionário e medida: o gravado');
  assert.deepEqual(LR.custoDaLinhaMaoObra({ ...formSem, tipo_medida: 'DIARIA' }), { unitario: '180.0000', total: '360.0000' }, 'outra medida: o cadastro');
  ap = (await S.editarLinha('mao-obra', a.id, ap, lH2b, LR.camposAlteradosDaLinhaMaoObra(lH2b, LR.corpoDaLinhaMaoObra(formSem)), OPCOES_LINHA)).apontamento;
  const lH3 = ap.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.joao.id);
  assert.deepEqual([lH3.quantidade, lH3.custo_unitario, lH3.custo_total], ['2.0000', '25.5000', '51.0000']);
  assert.deepEqual(LR.custoDaLinhaMaoObra(formSem), { unitario: lH3.custo_unitario, total: lH3.custo_total }, 'a prévia da janela = o gravado');
  // Sem mudança real (o formulário relido): a tela nem envia; se enviar, o servidor responde `sem_alteracao` e nada grava.
  assert.deepEqual(LR.camposAlteradosDaLinhaMaoObra(lH3, LR.corpoDaLinhaMaoObra(LR.formularioDaLinhaMaoObra(lH3))), {});
  const eSem = await recusaDe(S.editarLinha('mao-obra', a.id, ap, lH3, { quantidade: '2' }, OPCOES_LINHA));
  assert.equal(LR.ehSemAlteracaoDaLinha(eSem), true);
  assert.equal(LR.mensagemDeErroLinha(eSem, ''), 'Os dados são os mesmos da linha gravada: não há o que alterar. Nada foi gravado.');
  ap = await S.obterApontamento(a.id, ap.id);

  // ── cancelar a linha (motivo aparado).
  const rc = await S.cancelarLinha('mao-obra', a.id, ap, lH3, '  lançada errada ', OPCOES_LINHA);
  const envC = ultimoEnvio();
  assert.deepEqual([envC.metodo, envC.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/mao-obra/${lH3.id}/cancelar`]);
  const restoC = { ...envC.corpo };
  delete restoC.operation_id;
  assert.deepEqual(restoC, { empresa_id: s.e1.id, versao: ap.versao, motivo: 'lançada errada' });
  const cancelada = rc.apontamento.mao_obra.find((l) => l.id === lH3.id);
  assert.deepEqual([cancelada.status, cancelada.cancelamento_origem, cancelada.motivo_cancelamento, cancelada.cancelado_por?.id], ['CANCELADO', 'LINHA', 'lançada errada', s.adm.usuario.id]);
  assert.equal(LR.statusDaLinha(cancelada), 'CANCELADO');
  // A lista traz as linhas (canceladas inclusive), por ordem.
  const lista = await S.listarApontamentos(a.id);
  assert.deepEqual(LR.linhasDoApontamento(lista.items[0]).mao_obra.map((l) => [l.ordem, l.status]), [
    [1, 'CANCELADO'], [2, 'CONFIRMADO'], [3, 'CONFIRMADO'], [4, 'CANCELADO'], [5, 'CANCELADO'], [6, 'CANCELADO'], [7, 'CANCELADO'], [8, 'CANCELADO'],
  ]);

  // ── recusas chegam à janela: parceiro inativo, de outra fazenda ou sem papel de mão de obra — recusa UNIFORME no campo
  // `parceiro` (sem dizer o porquê) — e tipo sem mão de obra.
  const inativo = await prisma().fornecedor.findFirst({ where: { cliente_id: s.c, ativo: false, tipos: { has: 'funcionario' } } });
  const daFazenda2 = await prisma().fornecedor.findFirst({ where: { cliente_id: s.c, empresa_id: s.e2.id, tipos: { has: 'funcionario' } } });
  const antesRecusas = await s.contagem();
  for (const outro of [inativo, daFazenda2, s.soFornecedor, s.prestadorInativo, s.prestadorE2]) {
    const e = await recusaDe(S.adicionarLinha('mao-obra', a.id, rc.apontamento, { parceiro_id: outro.id, tipo_medida: 'HORA', quantidade: '1' }, OPCOES_LINHA));
    assert.equal(LR.campoDaLinhaRecusada(e), 'parceiro', outro.nome);
    assert.equal(
      LR.mensagemDeErroLinha(e, ''),
      'O funcionário ou terceiro escolhido não pode ser usado: ele precisa ser um parceiro ativo desta fazenda com o papel funcionário ou prestador de serviço. Nada foi gravado.',
      outro.nome
    );
  }
  assert.deepEqual(await s.contagem(), antesRecusas, 'nada gravado nas recusas');

  // ── terceiro (D-PROD-208): prestador de serviço sem sugestão de medida (hora); o custo unitário é SEMPRE digitado e
  // obrigatório — a janela não envia sem ele e o servidor também recusa.
  let apT = rc.apontamento;
  const formX = { ...LR.formularioMaoObraVazio(), parceiro: terceiro, tipo_medida: LR.medidaSugeridaDaMaoObra(terceiro), quantidade: '6' };
  assert.equal(formX.tipo_medida, 'HORA');
  assert.deepEqual(LR.custoDaLinhaMaoObra(formX), { unitario: null, total: null }, 'nada vem de cadastro');
  assert.deepEqual(LR.validarLinhaMaoObra(formX), { custo_unitario: 'Informe o custo unitário: para terceiro ele é sempre digitado.' });
  const eSemCusto = await recusaDe(S.adicionarLinha('mao-obra', a.id, apT, LR.corpoDaLinhaMaoObra(formX), OPCOES_LINHA));
  assert.equal(LR.campoDaLinhaRecusada(eSemCusto), 'custo_unitario');
  assert.deepEqual(await s.contagem(), antesRecusas, 'terceiro sem custo: nada gravado');
  const formX2 = { ...formX, custo_unitario: '42,75' };
  assert.deepEqual(LR.validarLinhaMaoObra(formX2), {});
  const previaX = LR.custoDaLinhaMaoObra(formX2);
  assert.equal(previaX.total, '256.5000');
  apT = (await S.adicionarLinha('mao-obra', a.id, apT, LR.corpoDaLinhaMaoObra(formX2), OPCOES_LINHA)).apontamento;
  const restoX = { ...ultimoEnvio().corpo };
  delete restoX.operation_id;
  assert.deepEqual(restoX, { parceiro_id: s.prestador.id, tipo_medida: 'HORA', quantidade: '6', custo_unitario: '42.75', empresa_id: s.e1.id, versao: apT.versao - 1 });
  const lX = apT.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.prestador.id);
  assert.deepEqual([lX.origem, lX.tipo_medida, lX.custo_unitario, lX.custo_total], ['TERCEIRO', 'HORA', '42.7500', previaX.total], 'a prévia da janela = o gravado');
  assert.equal(LR.comMarcaDeTerceiro(LR.rotuloDaMaoObraDaLinha(lX), lX), 'Prestadora Terra Boa (terceiro)');
  // Editar: o relido traz o custo digitado (nada muda = nada vai); trocar a medida leva o custo de novo.
  const relX = LR.formularioDaLinhaMaoObra(lX);
  assert.deepEqual([relX.parceiro?.origem, LR.custoMantidoDaLinha(relX)], ['TERCEIRO', false]);
  assert.deepEqual(LR.camposAlteradosDaLinhaMaoObra(lX, LR.corpoDaLinhaMaoObra(relX)), {});
  const mudX = LR.camposAlteradosDaLinhaMaoObra(lX, LR.corpoDaLinhaMaoObra({ ...relX, tipo_medida: 'DIARIA', quantidade: '1' }));
  assert.deepEqual(mudX, { tipo_medida: 'DIARIA', quantidade: '1', custo_unitario: '42.75' });
  apT = (await S.editarLinha('mao-obra', a.id, apT, lX, mudX, OPCOES_LINHA)).apontamento;
  const lX2 = apT.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === s.prestador.id);
  assert.deepEqual([lX2.origem, lX2.tipo_medida, lX2.custo_unitario, lX2.custo_total], ['TERCEIRO', 'DIARIA', '42.7500', '42.7500']);
  // O totalizador da tela marca o terceiro.
  const tX = await S.obterTotaisAtividade(a.id);
  assert.deepEqual(tX.mao_obra.filter((x) => x.origem === 'TERCEIRO').map((x) => [x.parceiro_id, x.tipo_medida, x.custo_total]), [[s.prestador.id, 'DIARIA', '42.7500']]);
  assert.ok(LR.totaisParaExibir(tX, await S.obterAtividade(a.id)).maoObra.some((x) => x.nome === 'Prestadora Terra Boa (terceiro)'));
  const semFlag = await S.criarAtividade(R.corpoDaAtividade(formCheio(s), { novo: true }));
  assert.deepEqual(LR.flagsDoTipoDaAtividade(semFlag, await S.listarTiposAtividade()).permiteMaoObra, false);
  const apSem = (await S.criarApontamento(semFlag.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-11')))).apontamento;
  const eFlag = await recusaDe(S.adicionarLinha('mao-obra', semFlag.id, apSem, LR.corpoDaLinhaMaoObra(formH), OPCOES_LINHA));
  assert.equal(LR.mensagemDeErroLinha(eFlag, ''), 'O tipo desta atividade não permite mão de obra. Nada foi gravado.');
  assert.equal(LR.campoDaLinhaRecusada(eFlag), 'parceiro');
});

test('serviço: seletores de serviços e de parceiros prestadores, lançar com e sem parceiro, editar (tirar o parceiro, trocar o valor), parceiro sem o papel recusado e cancelar pelo caminho da tela', async () => {
  const s = await montarCusto();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  let ap = (await S.criarApontamento(a.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-11')))).apontamento;

  // ── seletores: serviços ativos da fazenda (unidade = sigla) e só os parceiros prestadores ativos dela.
  const servs = await S.listarOpcoesServicos();
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades-opcoes/servicos?empresa_id=${s.e1.id}`);
  assert.deepEqual(Object.keys(servs.itens[0]).sort(), ['id', 'nome', 'numero', 'unidade', 'valor_referencia']);
  assert.deepEqual(servs.itens.map((x) => [x.id, x.unidade, x.valor_referencia]), [[s.frete.id, 'UN', null], [s.gradagem.id, 'HA', '150.0000']]);
  const parcs = await S.listarOpcoesParceirosServico();
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades-opcoes/parceiros-servico?empresa_id=${s.e1.id}`);
  assert.deepEqual(parcs.itens, [{ id: s.prestador.id, nome: 'Prestadora Terra Boa' }]);
  assert.deepEqual((await S.listarOpcoesParceirosServico({ q: 'terra' })).itens.map((x) => x.id), [s.prestador.id]);

  // ── lançar com parceiro: o valor unitário vem da referência; a prévia do total = o gravado.
  const escolha = LR.mudancaDoServicoEscolhido(servs.itens[1]);
  assert.deepEqual(escolha, { servico: { id: s.gradagem.id, rotulo: 'Gradagem terceirizada', unidade: 'HA', valor_referencia: '150.0000' }, valor_unitario: '150' });
  const formS = { ...LR.formularioServicoVazio(), ...escolha, parceiro: LR.parceiroEscolhido(parcs.itens[0]), quantidade: '2,5', documento_referencia: ' NF 123 ' };
  assert.deepEqual(LR.validarLinhaServico(formS), {});
  const previa = LR.valorDaLinhaServico(formS);
  assert.equal(previa, '375.0000');
  const r1 = await S.adicionarLinha('servicos', a.id, ap, LR.corpoDaLinhaServico(formS), OPCOES_LINHA);
  const env1 = ultimoEnvio();
  assert.deepEqual([env1.metodo, env1.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/servicos`]);
  const { operation_id: o1, ...resto1 } = env1.corpo;
  assert.match(o1, /^[A-Za-z0-9_.:-]{8,128}$/);
  assert.deepEqual(resto1, {
    servico_id: s.gradagem.id, fornecedor_parceiro_id: s.prestador.id, quantidade: '2.5', valor_unitario: '150', documento_referencia: 'NF 123', empresa_id: s.e1.id, versao: 1,
  });
  // A resposta crua traz a linha escrita em `servico` (singular).
  const cru = recebidos.at(-1);
  assert.equal(cru.status, 201);
  assert.deepEqual(Object.keys(cru.corpo).sort(), ['alertas', 'apontamento', 'atividade', 'servico']);
  ap = r1.apontamento;
  const l1 = ap.servicos[0];
  assert.deepEqual(cru.corpo.servico, l1);
  assert.deepEqual(
    [ap.versao, l1.status, l1.servico_id, l1.unidade, l1.quantidade, l1.valor_unitario, l1.valor_total, l1.documento_referencia, l1.fornecedor_parceiro_id],
    [2, 'CONFIRMADO', s.gradagem.id, 'HA', '2.5000', '150.0000', previa, 'NF 123', s.prestador.id]
  );
  assert.deepEqual(l1.parceiro, { id: s.prestador.id, nome: 'Prestadora Terra Boa' }, 'só id e nome do parceiro');
  assert.deepEqual(
    [LR.rotuloDoServicoDaLinha(l1), LR.rotuloDoParceiroDaLinha(l1), LR.formatarQuantidadeServico(l1.quantidade, l1.unidade)],
    ['Gradagem terceirizada', 'Prestadora Terra Boa', '2,5 HA']
  );
  // O formulário relido não acusa mudança e tem a unidade e o parceiro.
  const relido = LR.formularioDaLinhaServico(l1);
  assert.deepEqual([relido.servico?.unidade, relido.parceiro], ['HA', { id: s.prestador.id, rotulo: 'Prestadora Terra Boa' }]);
  assert.deepEqual(LR.camposAlteradosDaLinha(l1, LR.corpoDaLinhaServico(relido)), {});

  // ── editar: tirar o parceiro (null) e trocar o valor.
  const mudE = LR.camposAlteradosDaLinha(l1, LR.corpoDaLinhaServico({ ...relido, parceiro: null, valor_unitario: '160' }));
  assert.deepEqual(mudE, { fornecedor_parceiro_id: null, valor_unitario: '160' });
  const r2 = await S.editarLinha('servicos', a.id, ap, l1, mudE, OPCOES_LINHA);
  const env2 = ultimoEnvio();
  assert.deepEqual([env2.metodo, env2.caminho], ['PATCH', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/servicos/${l1.id}`]);
  const { operation_id: o2, ...resto2 } = env2.corpo;
  assert.notEqual(o2, o1);
  assert.deepEqual(resto2, { fornecedor_parceiro_id: null, valor_unitario: '160', empresa_id: s.e1.id, versao: 2 });
  ap = r2.apontamento;
  assert.deepEqual(ap.servicos.map((l) => [l.status, l.fornecedor_parceiro_id, l.parceiro?.nome ?? null, l.valor_unitario, l.valor_total, l.documento_referencia, l.cancelamento_origem]), [
    ['CANCELADO', s.prestador.id, 'Prestadora Terra Boa', '150.0000', '375.0000', 'NF 123', 'EDICAO'],
    ['CONFIRMADO', null, null, '160.0000', '400.0000', 'NF 123', null],
  ]);
  assert.equal(LR.rotuloDoParceiroDaLinha(ap.servicos[1]), '', 'sem parceiro');

  // ── lançar sem parceiro (serviço sem referência: o valor é digitado); a unidade é a do serviço.
  const esc2 = LR.mudancaDoServicoEscolhido(servs.itens[0]);
  assert.equal(esc2.valor_unitario, '');
  const formS2 = { ...LR.formularioServicoVazio(), ...esc2, quantidade: '3', valor_unitario: '90,5' };
  ap = (await S.adicionarLinha('servicos', a.id, ap, LR.corpoDaLinhaServico(formS2), OPCOES_LINHA)).apontamento;
  const resto3 = { ...ultimoEnvio().corpo };
  delete resto3.operation_id;
  assert.deepEqual(resto3, { servico_id: s.frete.id, quantidade: '3', valor_unitario: '90.5', empresa_id: s.e1.id, versao: 3 }, 'sem parceiro e sem documento: nada vai');
  assert.deepEqual([ap.servicos[2].unidade, ap.servicos[2].valor_total, ap.servicos[2].fornecedor_parceiro_id], ['UN', LR.valorDaLinhaServico(formS2), null]);

  // ── parceiro sem o papel, inativo ou de outra fazenda: a recusa é uniforme e a janela aponta o campo parceiro.
  const antes = await s.contagem();
  for (const outro of [s.soFornecedor, s.prestadorInativo, s.prestadorE2]) {
    const e = await recusaDe(S.adicionarLinha('servicos', a.id, ap, LR.corpoDaLinhaServico({ ...formS2, parceiro: LR.parceiroEscolhido(outro) }), OPCOES_LINHA));
    assert.equal(LR.campoDaLinhaRecusada(e), 'parceiro');
    assert.equal(LR.mensagemDeErroLinha(e, ''), 'O parceiro escolhido não pode ser usado: ele precisa ser um prestador de serviço ativo desta fazenda. Nada foi gravado.');
  }
  // Na edição também.
  const eEd = await recusaDe(S.editarLinha('servicos', a.id, ap, ap.servicos[2], { fornecedor_parceiro_id: s.soFornecedor.id }, OPCOES_LINHA));
  assert.equal(LR.campoDaLinhaRecusada(eEd), 'parceiro');
  assert.deepEqual(await s.contagem(), antes, 'nada gravado nas recusas');

  // ── cancelar a linha.
  const linha = ap.servicos[2];
  const rc = await S.cancelarLinha('servicos', a.id, ap, linha, ' feito por engano ', OPCOES_LINHA);
  const envC = ultimoEnvio();
  assert.deepEqual([envC.metodo, envC.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos/${ap.id}/servicos/${linha.id}/cancelar`]);
  const restoC = { ...envC.corpo };
  delete restoC.operation_id;
  assert.deepEqual(restoC, { empresa_id: s.e1.id, versao: ap.versao, motivo: 'feito por engano' });
  assert.deepEqual(rc.apontamento.servicos.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'EDICAO'], ['CONFIRMADO', null], ['CANCELADO', 'LINHA']]);

  // ── tipo sem serviço: a recusa diz o porquê.
  const semFlag = await S.criarAtividade(R.corpoDaAtividade(formCheio(s), { novo: true }));
  const apSem = (await S.criarApontamento(semFlag.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-11')))).apontamento;
  const eFlag = await recusaDe(S.adicionarLinha('servicos', semFlag.id, apSem, LR.corpoDaLinhaServico(formS2), OPCOES_LINHA));
  assert.equal(LR.mensagemDeErroLinha(eFlag, ''), 'O tipo desta atividade não permite serviço. Nada foi gravado.');
});

test('totais com as quatro linhas: produto, máquina, mão de obra e serviço somam no custo e no custo/ha, só as confirmadas de apontamentos confirmados; o totalizador da tela mostra os quatro blocos', async () => {
  const s = await montarCusto();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  await prisma().bemPatrimonial.updateMany({ where: { cliente_id: s.c, id: s.trator.id }, data: { custo_uso_unitario: '100' } });
  let ap = (await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), area_executada_dia: '4' }))).apontamento;
  const lancar = async (tipo, corpo) => {
    ap = (await S.adicionarLinha(tipo, a.id, ap, corpo, OPCOES_LINHA)).apontamento;
    return ap;
  };
  await lancar('produtos', { produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '10' }); // 10 × 5,20 = 52
  await lancar('maquinas', { bem_id: s.trator.id, sem_medidor: false, leitura_inicial: '1520.5', leitura_final: '1522.5' }); // 2 h × 100 = 200
  await lancar('mao-obra', { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' }); // 204
  await lancar('mao-obra', { parceiro_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1' }); // 180
  await lancar('mao-obra', { parceiro_id: s.pedro.id, tipo_medida: 'HORA', quantidade: '4' }); // sem custo
  await lancar('servicos', { servico_id: s.gradagem.id, fornecedor_parceiro_id: s.prestador.id, quantidade: '4', valor_unitario: '150' }); // 600
  await lancar('servicos', { servico_id: s.frete.id, quantidade: '1', valor_unitario: '999' });
  ap = (await S.cancelarLinha('servicos', a.id, ap, ap.servicos[1], 'não houve frete', OPCOES_LINHA)).apontamento; // cancelada: não conta
  // Linhas de um apontamento CANCELADO não contam.
  let ap2 = (await S.criarApontamento(a.id, R.corpoDoApontamento(R.formularioApontamentoVazio('2027-06-12')))).apontamento;
  ap2 = (await S.adicionarLinha('mao-obra', a.id, ap2, { parceiro_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '1', custo_unitario: '1000' }, OPCOES_LINHA)).apontamento;
  ap2 = (await S.adicionarLinha('servicos', a.id, ap2, { servico_id: s.gradagem.id, quantidade: '1', valor_unitario: '1000' }, OPCOES_LINHA)).apontamento;
  await S.cancelarApontamento(a.id, ap2.id, { versao: ap2.versao, motivo: 'dia errado' });

  const t = await S.obterTotaisAtividade(a.id);
  assert.equal(enviados.at(-1).caminho, `/api/native/atividades/${a.id}/totais?empresa_id=${s.e1.id}`);
  assert.deepEqual(Object.keys(recebidos.at(-1).corpo).sort(), [
    'area_executada', 'area_planejada', 'combustivel', 'consumo_por_bem', 'custo_combustivel_por_ha', 'custo_por_ha', 'custo_por_tipo', 'custo_total',
    'litros_combustivel_por_ha', 'mao_obra', 'maquinas', 'por_area', 'produtos', 'servicos', 'unidade_area',
  ]);
  assert.deepEqual(t.mao_obra.map((x) => [x.parceiro_id, x.nome, x.origem, x.tipo_medida, x.quantidade, x.custo_total]), [
    [s.joao.id, 'João Mensalista', 'FUNCIONARIO', 'DIARIA', '1.0000', '180.0000'],
    [s.joao.id, 'João Mensalista', 'FUNCIONARIO', 'HORA', '8.0000', '204.0000'],
    [s.pedro.id, 'Pedro Diarista', 'FUNCIONARIO', 'HORA', '4.0000', null],
  ]);
  assert.deepEqual(t.servicos.map((x) => [x.servico_id, x.nome, x.unidade, x.quantidade, x.custo_total]), [[s.gradagem.id, 'Gradagem terceirizada', 'HA', '4.0000', '600.0000']]);
  assert.deepEqual([t.produtos.map((x) => x.custo_total), t.maquinas.map((x) => x.custo_total)], [['52.0000'], ['200.0000']]);
  // 52 + 200 + 204 + 180 + 600 = 1236 em 4 ha.
  assert.deepEqual([t.area_executada, t.custo_total, t.custo_por_ha], ['4.0000', '1236.0000', '309.0000']);
  // D-PROD-234: as parcelas do custo por tipo (a atividade aberta e a tabela dos lançamentos); sem combustível, nulos.
  assert.deepEqual(t.custo_por_tipo, { maquinas: '200.0000', produtos: '52.0000', mao_obra: '384.0000', servicos: '600.0000', combustivel: null });
  assert.equal(t.litros_combustivel_por_ha, null);
  // D-PROD-234: a lista traz o custo total de cada atividade, o MESMO dos totais (uma consulta agrupada pela página).
  const pagina = await S.listarAtividades();
  const naLista = pagina.items.find((x) => x.id === a.id);
  assert.equal(naLista.custo_total, '1236.0000');
  assert.ok(pagina.items.filter((x) => x.id !== a.id).every((x) => x.custo_total === null), 'sem nenhum custo, nulo');

  // ── o totalizador da tela (os quatro blocos, o custo e o custo/ha).
  const tela = LR.totaisParaExibir(t, await S.obterAtividade(a.id));
  assert.deepEqual(tela.maoObra.map((x) => [x.nome, x.quantidade, x.custo]), [
    ['João Mensalista', '1 diária(s)', LR.formatarCustoLinha('180.0000')],
    ['João Mensalista', '8 h', LR.formatarCustoLinha('204.0000')],
    ['Pedro Diarista', '4 h', ''],
  ]);
  assert.equal(new Set(tela.maoObra.map((x) => x.chave)).size, 3, 'a chave separa o mesmo funcionário por medida');
  assert.deepEqual(tela.servicos.map((x) => [x.nome, x.quantidade, x.custo]), [['Gradagem terceirizada', '4 HA', LR.formatarCustoLinha('600.0000')]]);
  assert.deepEqual([tela.produtos.length, tela.maquinas.length], [1, 1]);
  assert.equal(tela.custo, LR.formatarCustoLinha('1236.0000'));
  assert.match(tela.custo, /1\.236,00/);
  assert.match(tela.custoPorHa, /309,00\/ha$/i);
});

test('mão de obra e serviço: "Repetir" com mao_obra[] e servicos[] (rede cai depois de gravar: a MESMA chave, sem duplicar), o duplicar do servidor com as linhas, a trava da data e a cascata do cancelamento', async () => {
  const s = await montarCusto();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const L = await import('../../src/lib/lancamentoAtividadesRegras.js');
  const API = await import('../../src/apis/atividades/atividadesApi.js');
  const { a } = s;
  // Base: duas linhas de mão de obra (hora e tarefa), um serviço com parceiro e um serviço cancelado.
  let base = (await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), turno: 'MANHA', area_executada_dia: '3' }))).apontamento;
  const lancar = async (tipo, corpo) => {
    base = (await S.adicionarLinha(tipo, a.id, base, corpo, OPCOES_LINHA)).apontamento;
  };
  await lancar('mao-obra', { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' });
  await lancar('mao-obra', { parceiro_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '2', custo_unitario: '40' });
  await lancar('servicos', { servico_id: s.gradagem.id, fornecedor_parceiro_id: s.prestador.id, quantidade: '3', valor_unitario: '150', documento_referencia: 'NF 9' });
  await lancar('servicos', { servico_id: s.frete.id, quantidade: '1', valor_unitario: '10' });
  base = (await S.cancelarLinha('servicos', a.id, base, base.servicos[1], 'não houve frete', OPCOES_LINHA)).apontamento;
  assert.deepEqual(await s.contagem(), [1, 2, 2]);

  // O custo de hora do João sobe no cadastro: a linha gravada guarda o snapshot; o resumo do funcionário, o atual.
  await prisma().fornecedor.updateMany({ where: { cliente_id: s.c, id: s.joao.id }, data: { funcionario_custo_hora: '30' } });
  base = await S.obterApontamento(a.id, base.id);
  assert.deepEqual([base.mao_obra[0].custo_unitario, base.mao_obra[0].parceiro.funcionario_custo_hora], ['25.5000', '30.0000']);

  // ── "Repetir": as linhas CONFIRMADAS da base preenchidas (o documento do serviço não); o operador ajusta as horas.
  const rasc = LR.linhasParaRepetir(base);
  assert.deepEqual([rasc.produtos.length, rasc.maquinas.length, rasc.mao_obra.length, rasc.servicos.length], [0, 0, 2, 1]);
  assert.equal(rasc.servicos[0].form.documento_referencia, '', 'o documento é do dia');
  assert.deepEqual(rasc.servicos[0].form.parceiro, { id: s.prestador.id, rotulo: 'Prestadora Terra Boa' });
  for (const r of rasc.mao_obra) assert.deepEqual(LR.validarLinhaMaoObra(r.form), {});
  assert.deepEqual(LR.validarLinhaServico(rasc.servicos[0].form), {});
  // O corpo como o FormularioApontamento monta (as listas vazias de produto e máquina não vão).
  const corpo = {
    ...R.corpoDoApontamento(R.formularioDaBase(base, HOJE)),
    produtos: [],
    maquinas: [],
    mao_obra: rasc.mao_obra.map((r, i) => LR.corpoDaLinhaMaoObra(i === 0 ? { ...r.form, quantidade: '6' } : r.form)),
    servicos: rasc.servicos.map((r) => LR.corpoDaLinhaServico({ ...r.form, documento_referencia: 'NF 10' })),
  };
  perderProximaResposta = true;
  await assert.rejects(S.criarApontamento(a.id, corpo, OPCOES_LINHA));
  const perdido = ultimoEnvio();
  assert.deepEqual([perdido.metodo, perdido.caminho], ['POST', `/api/native/atividades/${a.id}/apontamentos`]);
  const { operation_id: opL, ...restoL } = perdido.corpo;
  assert.match(opL, /^[A-Za-z0-9_.:-]{8,120}$/);
  assert.deepEqual(restoL, {
    empresa_id: s.e1.id,
    data_operacional: HOJE,
    turno: 'MANHA',
    area_executada_dia: '3',
    mao_obra: [
      { parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '6' },
      { parceiro_id: s.tiao.id, tipo_medida: 'TAREFA', quantidade: '2', custo_unitario: '40' },
    ],
    servicos: [{ servico_id: s.gradagem.id, fornecedor_parceiro_id: s.prestador.id, quantidade: '3', valor_unitario: '150', documento_referencia: 'NF 10' }],
  });
  assert.deepEqual(await s.contagem(), [2, 4, 3], 'o servidor gravou');
  // "Repetir o mesmo envio": a MESMA chave; o servidor devolve o gravado, sem duplicar.
  const r1 = await S.criarApontamento(a.id, corpo, { ...OPCOES_LINHA, retentativa: true });
  assert.equal(ultimoEnvio().corpo.operation_id, opL);
  assert.deepEqual(await s.contagem(), [2, 4, 3], 'nada a mais');
  const novo = r1.apontamento;
  assert.deepEqual([novo.data_operacional, novo.turno, novo.status], [HOJE, 'MANHA', 'CONFIRMADO']);
  assert.deepEqual(novo.mao_obra.map((l) => [l.status, l.parceiro_id, l.tipo_medida, l.quantidade, l.custo_unitario, l.custo_total]), [
    ['CONFIRMADO', s.joao.id, 'HORA', '6.0000', '30.0000', '180.0000'],
    ['CONFIRMADO', s.tiao.id, 'TAREFA', '2.0000', '40.0000', '80.0000'],
  ]);
  assert.deepEqual(novo.servicos.map((l) => [l.status, l.servico_id, l.parceiro?.nome, l.unidade, l.quantidade, l.valor_total, l.documento_referencia]), [
    ['CONFIRMADO', s.gradagem.id, 'Prestadora Terra Boa', 'HA', '3.0000', '450.0000', 'NF 10'],
  ]);
  // A prévia de cada rascunho (com as horas ajustadas) = o gravado: hora pelo cadastro ATUAL, tarefa pelo digitado.
  assert.deepEqual(
    rasc.mao_obra.map((r, i) => LR.custoDaLinhaMaoObra(i === 0 ? { ...r.form, quantidade: '6' } : r.form).total),
    novo.mao_obra.map((l) => l.custo_total)
  );
  assert.deepEqual(LR.temLinhaConfirmada(novo), true);

  // ── o duplicar do servidor (pela API da tela) aceita as linhas com a chave; resposta perdida + reenvio = um só.
  const opD = 'tela-dup-0001';
  const corpoDup = {
    empresa_id: s.e1.id,
    data_operacional: HOJE,
    operation_id: opD,
    mao_obra: [LR.corpoDaLinhaMaoObra(rasc.mao_obra[0].form)],
    servicos: [LR.corpoDaLinhaServico({ ...rasc.servicos[0].form, parceiro: null })],
  };
  perderProximaResposta = true;
  await assert.rejects(API.duplicateAtividadeApontamento(a.id, base.id, corpoDup));
  assert.deepEqual(ultimoEnvio(), {
    metodo: 'POST',
    caminho: `/api/native/atividades/${a.id}/apontamentos/${base.id}/duplicar`,
    corpo: {
      empresa_id: s.e1.id,
      data_operacional: HOJE,
      operation_id: opD,
      mao_obra: [{ parceiro_id: s.joao.id, tipo_medida: 'HORA', quantidade: '8' }],
      servicos: [{ servico_id: s.gradagem.id, quantidade: '3', valor_unitario: '150' }],
    },
  });
  assert.deepEqual(await s.contagem(), [3, 5, 4]);
  const dup = await API.duplicateAtividadeApontamento(a.id, base.id, corpoDup);
  assert.deepEqual(await s.contagem(), [3, 5, 4], 'o reenvio não duplica');
  assert.deepEqual([dup.apontamento.turno, dup.apontamento.sequencia], ['MANHA', 2]);
  assert.deepEqual(dup.apontamento.mao_obra.map((l) => [l.tipo_medida, l.custo_total]), [['HORA', '240.0000']]);
  assert.deepEqual(dup.apontamento.servicos.map((l) => [l.fornecedor_parceiro_id, l.valor_total]), [[null, '450.0000']]);

  // ── a data do apontamento com mão de obra/serviço confirmados não muda.
  const eData = await recusaDe(S.editarApontamento(a.id, novo.id, { data_operacional: '2027-06-14', versao: novo.versao }));
  assert.equal(L.codigoDoErroAtividade(eData), 'ATIVIDADE_DATA_COM_LINHAS');
  assert.match(LR.mensagemDeErroLinha(eData, ''), /mão de obra ou serviço confirmada/);

  // ── cancelar o apontamento: as linhas caem (origem APONTAMENTO), o resto não.
  const rc = await S.cancelarApontamento(a.id, novo.id, { versao: novo.versao, motivo: 'repetido por engano' });
  assert.deepEqual(rc.apontamento.mao_obra.map((l) => [l.status, l.cancelamento_origem, l.motivo_cancelamento]), [
    ['CANCELADO', 'APONTAMENTO', 'repetido por engano'],
    ['CANCELADO', 'APONTAMENTO', 'repetido por engano'],
  ]);
  assert.deepEqual(rc.apontamento.servicos.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'APONTAMENTO']]);
  assert.equal(LR.temLinhaConfirmada(rc.apontamento), false);
  assert.equal((await S.obterTotaisAtividade(a.id)).custo_total, '1424.0000', 'só a base (204 + 80 + 450) e o duplicado (240 + 450)');

  // ── cancelar a atividade: as linhas confirmadas da base e do duplicado caem (origem ATIVIDADE); a cancelada antes fica LINHA.
  const atual = await S.obterAtividade(a.id);
  await S.cancelarAtividade(a.id, { versao: atual.versao, motivo: 'chuva forte' });
  const baseRelida = await S.obterApontamento(a.id, base.id);
  assert.deepEqual(baseRelida.mao_obra.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'ATIVIDADE'], ['CANCELADO', 'ATIVIDADE']]);
  assert.deepEqual(baseRelida.servicos.map((l) => [l.status, l.cancelamento_origem]), [['CANCELADO', 'ATIVIDADE'], ['CANCELADO', 'LINHA']]);
  const dupRelido = await S.obterApontamento(a.id, dup.apontamento.id);
  assert.deepEqual([...dupRelido.mao_obra, ...dupRelido.servicos].map((l) => l.cancelamento_origem), ['ATIVIDADE', 'ATIVIDADE']);
  const zerado = await S.obterTotaisAtividade(a.id);
  assert.deepEqual([zerado.mao_obra, zerado.servicos, zerado.custo_total, zerado.custo_por_ha], [[], [], null, null]);
});

test('mão de obra (D-PROD-208): parceiro que muda de papel — a linha guarda a origem gravada, o resumo traz a origem ATUAL; o "Repetir" parte dela (virou terceiro → custo digitado; perdeu o papel → escolher) e a edição mantém a gravada', async () => {
  const s = await montarCusto();
  const LR = await import('../../src/lib/atividadeLinhasRegras.js');
  const { a } = s;
  const p = prisma();
  const novoFuncionario = (numero, nome) =>
    p.fornecedor.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, numero_cadastro: numero, tipo_pessoa: 'Física', nome, tipos: ['funcionario'],
        funcionario_tipo: 'MENSALISTA', funcionario_custo_hora: '20',
      },
    });
  const mudou = await novoFuncionario('F-MUDOU', 'Maria Mudou de Papel');
  const saiu = await novoFuncionario('F-SAIU', 'Zé Saiu');
  let base = (await S.criarApontamento(a.id, R.corpoDoApontamento({ ...R.formularioApontamentoVazio('2027-06-11'), area_executada_dia: '1' }))).apontamento;
  base = (await S.adicionarLinha('mao-obra', a.id, base, { parceiro_id: mudou.id, tipo_medida: 'HORA', quantidade: '5' }, OPCOES_LINHA)).apontamento;
  base = (await S.adicionarLinha('mao-obra', a.id, base, { parceiro_id: saiu.id, tipo_medida: 'HORA', quantidade: '2' }, OPCOES_LINHA)).apontamento;
  assert.deepEqual(base.mao_obra.map((l) => [l.origem, l.parceiro.origem_atual, l.custo_unitario]), [['FUNCIONARIO', 'FUNCIONARIO', '20.0000'], ['FUNCIONARIO', 'FUNCIONARIO', '20.0000']]);

  // Maria vira só prestadora de serviço (terceiro); o Zé fica só fornecedor.
  await p.fornecedor.update({ where: { id: mudou.id }, data: { tipos: ['prestador_servico'], funcionario_tipo: null, funcionario_custo_hora: null } });
  await p.fornecedor.update({ where: { id: saiu.id }, data: { tipos: ['fornecedor'], funcionario_tipo: null, funcionario_custo_hora: null } });
  base = await S.obterApontamento(a.id, base.id);
  assert.deepEqual(base.mao_obra.map((l) => [l.origem, l.parceiro.origem_atual]), [['FUNCIONARIO', 'TERCEIRO'], ['FUNCIONARIO', null]]);
  assert.deepEqual(Object.keys(base.mao_obra[0].parceiro).sort(), ['funcionario_cargo', 'funcionario_custo_diaria', 'funcionario_custo_hora', 'funcionario_tipo', 'id', 'nome', 'origem_atual']);

  // ── "Repetir": Maria volta como TERCEIRO, com o custo a digitar; o Zé volta sem parceiro.
  const rasc = LR.linhasParaRepetir(base);
  const [rMaria, rZe] = rasc.mao_obra.map((r) => r.form);
  assert.deepEqual([rMaria.parceiro?.id, rMaria.parceiro?.origem, rMaria.tipo_medida, rMaria.custo_unitario, rMaria.gravado], [mudou.id, 'TERCEIRO', 'HORA', '', null]);
  assert.deepEqual(LR.validarLinhaMaoObra(rMaria), { custo_unitario: 'Informe o custo unitário: para terceiro ele é sempre digitado.' });
  assert.equal(rZe.parceiro, null);
  assert.deepEqual(Object.keys(LR.validarLinhaMaoObra(rZe)), ['parceiro']);
  // A origem GRAVADA (o comportamento antigo) daria a hora sem custo, e o servidor recusaria: 422 custo_unitario obrigatório.
  const antes = await s.contagem();
  const eVelho = await recusaDe(
    S.criarApontamento(a.id, { ...R.corpoDoApontamento(R.formularioDaBase(base, HOJE)), mao_obra: [LR.corpoDaLinhaMaoObra(LR.formularioDaLinhaMaoObra(base.mao_obra[0]))] }, OPCOES_LINHA)
  );
  assert.equal(LR.campoDaLinhaRecusada(eVelho), 'custo_unitario');
  assert.deepEqual(await s.contagem(), antes, 'nada gravado');
  // Com a origem atual e o custo digitado (o Zé trocado pelo João), grava.
  const corpo = {
    ...R.corpoDoApontamento(R.formularioDaBase(base, HOJE)),
    mao_obra: [
      LR.corpoDaLinhaMaoObra({ ...rMaria, custo_unitario: '33' }),
      LR.corpoDaLinhaMaoObra({ ...rZe, ...LR.mudancaDaMaoObraEscolhida({ id: s.joao.id, nome: 'João Mensalista', origem: 'FUNCIONARIO', funcionario_tipo: 'MENSALISTA', funcionario_custo_hora: '25.5000', funcionario_custo_diaria: '180.0000' }, rZe) }),
    ],
  };
  const novo = (await S.criarApontamento(a.id, corpo, OPCOES_LINHA)).apontamento;
  assert.deepEqual(novo.mao_obra.map((l) => [l.parceiro_id, l.origem, l.tipo_medida, l.custo_unitario, l.custo_total]), [
    [mudou.id, 'TERCEIRO', 'HORA', '33.0000', '165.0000'],
    [s.joao.id, 'FUNCIONARIO', 'HORA', '25.5000', '51.0000'],
  ]);

  // ── Editar a linha antiga da Maria: o parceiro gravado fica com a origem GRAVADA (funcionário) e o custo gravado.
  const lM = base.mao_obra[0];
  const fM = LR.formularioDaLinhaMaoObra(lM);
  assert.deepEqual([fM.parceiro?.origem, LR.custoMantidoDaLinha({ ...fM, quantidade: '6' })], ['FUNCIONARIO', true]);
  // Trocar pelo João e voltar à Maria pelo seletor (a opção diz TERCEIRO): a origem e o custo gravados voltam.
  const fJ = { ...fM, ...LR.mudancaDaMaoObraEscolhida({ id: s.joao.id, nome: 'João Mensalista', origem: 'FUNCIONARIO', funcionario_tipo: 'MENSALISTA' }, fM) };
  const fVolta = { ...fJ, ...LR.mudancaDaMaoObraEscolhida({ id: mudou.id, nome: 'Maria Mudou de Papel', origem: 'TERCEIRO' }, fJ), quantidade: '6' };
  assert.deepEqual([fVolta.parceiro?.origem, fVolta.tipo_medida, LR.custoDaLinhaMaoObra(fVolta)], ['FUNCIONARIO', 'HORA', { unitario: '20.0000', total: '120.0000' }]);
  const mud = LR.camposAlteradosDaLinhaMaoObra(lM, LR.corpoDaLinhaMaoObra(fVolta));
  assert.deepEqual(mud, { quantidade: '6' });
  const ed = (await S.editarLinha('mao-obra', a.id, base, lM, mud, OPCOES_LINHA)).apontamento;
  const lM2 = ed.mao_obra.find((l) => l.status === 'CONFIRMADO' && l.parceiro_id === mudou.id);
  assert.deepEqual([lM2.origem, lM2.custo_unitario, lM2.custo_total], ['FUNCIONARIO', '20.0000', '120.0000'], 'a prévia da janela = o gravado');
});
