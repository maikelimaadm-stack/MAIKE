/**
 * ApontamentoAtividade nativo (D-PROD-190, Fatia C) — PostgreSQL real + HTTP
 * autenticado (`app.inject`).
 *
 * A TAREFA (`LancamentoTarefa`) é a demanda; o APONTAMENTO é a EXECUÇÃO de um
 * Tipo de Atividade (D-PROD-182). Os itens de custo (D-PROD-193, Fatia D) estão
 * em `apontamentoAtividadeItensNativo.test.mjs`; aqui fica o cabeçalho, com o que
 * a Fatia D mudou nele: o detalhe traz `itens` e `custo_itens` (a lista não) e o
 * cancelamento exige `operation_id` (D-2), é idempotente e trava a linha. Prova,
 * regra a regra, o comportamento especificado:
 *  - R-k número pela sequência do tenant (1, 2, 3…; outro tenant recomeça;
 *    recusa não consome número; criações simultâneas não repetem);
 *  - R-h snapshots do tipo (nome do tipo, id e nome do grupo) gravados na
 *    criação e na TROCA do tipo; renomear tipo/grupo, mover o tipo de grupo e
 *    sincronizar referências depois não mudam o apontamento;
 *  - R-e centro de CUSTO (regra acordada com o proprietário): na criação,
 *    nulo ou ausente com bem → copia o centro ATIVO do cadastro do bem
 *    (inativo fica nulo; o informado vence); depois é snapshot: trocar o
 *    centro do bem, editar outro campo ou trocar o bem nunca relê; na edição
 *    só muda o explícito. Centro de RESULTADO: só o escolhido, nunca do bem.
 *    As opções de bens trazem o centro de custo só quando ativo;
 *  - R-a tipo inativo não entra em apontamento novo; editar mantendo o tipo
 *    inativo pode; trocar para outro tipo inativo, não;
 *  - R-b hora_fim < hora_inicio recusada (instantes, não texto; iguais pode);
 *  - R-c data futura recusada pelo "hoje" no fuso da FAZENDA; sem fuso, 409;
 *    horas: nenhuma depois de "agora"; início e fim no dia local da data
 *    operacional (sem turno que vira o dia); na edição, sobre o estado final;
 *  - R-d implemento exige bem e não pode ser o próprio bem;
 *  - R-f produção: quantidade e unidade juntas, > 0, unidade ∈ {HA, CAB, TON, KM};
 *  - R-i bem, implemento, área, tarefa e centros da MESMA fazenda;
 *  - R-j/R-g cancelar (sem DELETE físico) grava quem, quando e motivo e
 *    incrementa a versão; cancelado não edita nem cancela de novo; o CAS do
 *    repositório (versão + status no WHERE) provado sem corrida; D-PROD-193:
 *    `operation_id` obrigatório (D-2), replay e chave reaproveitada;
 *  - R-l exclusão de tipo, grupo, tarefa, empresa, área, bem e centros com
 *    apontamento barrada pela FK RESTRICT (409 próprio pela API, P2003 no
 *    banco); sem a tabela nova (código antes da migration) os módulos antigos
 *    seguem excluindo (lição do hotfix #259);
 *  - isolamento por tenant e por fazenda (404 sem oráculo), permissão da tela
 *    `op-apontamentos-atividade` (403 sem ela) e a lista keyset com filtros.
 *
 * Toda recusa prova "nada gravado" pelas linhas completas do apontamento, da
 * sequência e da auditoria do tenant. "Hoje" padrão = relógio de teste do
 * cenário do Patrimônio (2027-06-15 em São Paulo); os casos de fuso fixam o
 * próprio instante (`comRelogioDeTeste`, só em NODE_ENV=test).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  HOJE, corpoGerador, corpoImplemento, corpoTrator, erro, http, montarPatrimonio, prisma,
} from './patrimonioP1Cenario.mjs';
import { comRelogioDeTeste } from '../src/modules/rebanhoLedger/rebanhoLedgerTempo.js';
import { atualizarComVersao } from '../src/modules/apontamentosAtividade/apontamentoAtividadeRepository.js';
import { normalizarErro } from '../src/shared/errors/errorHandler.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoes(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const TELA = 'op-apontamentos-atividade';
const MODULO = 'suporte-mapa';
const ACOES_TELA = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar']);
/** Linha de permissão da tela de apontamentos com só as ações dadas ligadas. */
const linhaApontamento = (acoes = {}, tela = TELA) => ({ modulo_id: MODULO, tela_id: tela, ...Object.fromEntries(ACOES_TELA.map((a) => [a, false])), ...acoes });

/** Dia operacional padrão (passado em relação ao "hoje" de teste, 2027-06-15). */
const DIA = '2027-06-10';

/** Forma pública do apontamento (lista e detalhe): nunca `cliente_id`, nunca as flags antigas. */
const CAMPOS_PUBLICOS = Object.freeze([
  'area', 'area_id', 'bem', 'bem_id', 'cancelamento', 'centro_custo', 'centro_custo_id', 'centro_resultado', 'centro_resultado_id', 'created_date',
  'criado_por', 'data_operacional', 'empresa_id', 'grupo_atividade_id', 'grupo_atividade_nome', 'hora_fim', 'hora_inicio', 'horas_trabalhadas', 'id',
  'implemento', 'implemento_bem_id', 'lancamento_tarefa', 'lancamento_tarefa_id', 'numero', 'observacao', 'operador', 'operador_usuario_id',
  'quantidade_produzida', 'safra_ciclo', 'status', 'tipo_atividade_id', 'tipo_atividade_nome', 'unidade_producao', 'updated_date', 'versao',
]);
/** D-PROD-193: o DETALHE (e a resposta do cancelamento) acrescenta os itens e o custo deles; a lista não. */
const CAMPOS_DETALHE = Object.freeze([...CAMPOS_PUBLICOS, 'custo_itens', 'itens'].sort());
/** Custo dos itens de um apontamento sem item (D-PROD-193 §3.4). */
const SEM_ITENS = Object.freeze({ itens: [], custo_itens: { total: '0.0000', produto: '0.0000', servico: '0.0000', outro: '0.0000', itens_confirmados: 0 } });
/** Chave de idempotência nova (D-PROD-193, D-2: o cancelamento exige `operation_id`). */
const opId = () => `cancelar-${randomUUID()}`;
/** Resposta do comando sem `replay` (a forma do detalhe). */
const semReplay = (r) => {
  const resto = { ...r };
  delete resto.replay;
  return resto;
};
/** Chaves do antigo Tipo de Tarefa (D-PROD-181): nunca voltam. */
const FLAGS_ANTIGAS = Object.freeze(['exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento']);

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/**
 * Prova de "nada gravado": linhas COMPLETAS do apontamento, a sequência do
 * número e a auditoria do apontamento no tenant.
 * @param {string} clienteId
 */
const foto = async (clienteId) => {
  const p = prisma();
  return JSON.stringify({
    apontamentos: await p.apontamentoAtividade.findMany({ where: { cliente_id: clienteId }, orderBy: { id: 'asc' } }),
    sequencias: await p.entidadeCodigoSequencia.findMany({ where: { cliente_id: clienteId, entidade: 'ApontamentoAtividade' }, orderBy: { id: 'asc' } }),
    auditoria: await p.auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'ApontamentoAtividade' }, orderBy: { id: 'asc' } }),
  }, replacer);
};

const linhaDe = (id) => prisma().apontamentoAtividade.findUnique({ where: { id } });

/** Ações HTTP da tela. */
const acoes = (aplicacao) => {
  const { req, ok } = http(aplicacao);
  return {
    req,
    ok,
    criar: (tok, corpo) => req('POST', '/apontamentos-atividade', tok, corpo),
    editar: (tok, id, corpo) => req('PATCH', `/apontamentos-atividade/${id}`, tok, corpo),
    // D-PROD-193 (D-2): o cancelamento leva `operation_id`; sem a chave no corpo, uma nova a cada envio.
    cancelar: (tok, id, corpo) => req('POST', `/apontamentos-atividade/${id}/cancelar`, tok, { operation_id: opId(), ...corpo }),
    cancelarCru: (tok, id, corpo) => req('POST', `/apontamentos-atividade/${id}/cancelar`, tok, corpo),
    detalhe: (tok, id, empresaId) => req('GET', `/apontamentos-atividade/${id}?empresa_id=${empresaId}`, tok),
    lista: (tok, empresaId, extra = '') => req('GET', `/apontamentos-atividade?empresa_id=${empresaId}${extra}`, tok),
    opcoes: (tok, recurso, query) => req('GET', `/apontamentos-atividade-opcoes/${recurso}?${query}`, tok),
  };
};

const criarOk = async (tok, corpo) => {
  const r = await A.criar(tok, corpo);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const editarOk = async (tok, id, corpo) => {
  const r = await A.editar(tok, id, corpo);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

/** Troca o centro de custo NO CADASTRO do bem, pela API de Bens (null tira). */
const trocarCentroDoBem = async (s, bemId, centroId, empresaId = s.e1.id) => {
  const bem = await A.ok(A.req('GET', `/bens-patrimoniais/${bemId}?empresa_id=${empresaId}`, s.token));
  const depois = await A.ok(A.req('PATCH', `/bens-patrimoniais/${bemId}`, s.token, { empresa_id: empresaId, versao: bem.versao, centro_custo_id: centroId }));
  assert.equal(depois.centro_custo?.id ?? null, centroId, 'o cadastro do bem trocou de centro');
  return depois;
};

/**
 * Recusa com `[status, code, field, reason]` exatos e nada gravado no tenant.
 * @param {{ c: string }} s @param {() => Promise<any>} pedir @param {Array<unknown>} esperado
 */
const recusa = async (s, pedir, esperado) => {
  const antes = await foto(s.c);
  const r = await pedir();
  assert.deepEqual(erro(r), esperado, r.body);
  assert.equal(await foto(s.c), antes, `nada gravado (${esperado[1]})`);
  return r;
};

/**
 * Cenário: o tenant do Patrimônio (2 fazendas com fuso, centros de custo e
 * áreas por fazenda) + grupos e tipos de atividade (pela API do cadastro),
 * bens pela API do cadastro de Bens (trator com centro de custo NO CADASTRO,
 * roçadeira, gerador e um trator da fazenda 2), centros de resultado, um tipo
 * de tarefa e uma tarefa por fazenda (a demanda) e um operador do tenant.
 * @param {import('fastify').FastifyInstance} aplicacao
 */
const montar = async (aplicacao) => {
  const s = await montarPatrimonio(aplicacao);
  const { req, ok } = http(aplicacao);
  const p = prisma();
  const sufixo = randomUUID().slice(0, 6);
  const grupo = await ok(req('POST', '/grupos-atividade', s.token, { nome_grupo: 'Pastagem' }), 201);
  const grupo2 = await ok(req('POST', '/grupos-atividade', s.token, { nome_grupo: 'Cercas' }), 201);
  const tipo = await ok(req('POST', '/tipos-atividade', s.token, { nome_tipo: 'Roçada mecanizada', grupo_atividade_id: grupo.id }), 201);
  const tipo2 = await ok(req('POST', '/tipos-atividade', s.token, { nome_tipo: 'Conserto de cerca', grupo_atividade_id: grupo2.id }), 201);
  const bem = (corpo) => ok(req('POST', '/bens-patrimoniais', s.token, corpo), 201);
  const trator = await bem(corpoTrator(s, { centro_custo_id: s.centro1.id }));
  const rocadeira = await bem(corpoImplemento(s));
  const gerador = await bem(corpoGerador(s));
  const trator2 = await bem(corpoTrator(s, { empresa_id: s.e2.id, codigo_frota: 'TP-09', centro_custo_id: s.centro2.id }));
  const centroB = await p.centroCusto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: `CCB-${sufixo}`, nome: 'Pastagens e capineiras' } });
  const cr1 = await p.centroResultado.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: `CR1-${sufixo}`, nome: 'Pecuária de corte' } });
  const cr2 = await p.centroResultado.create({ data: { cliente_id: s.c, empresa_id: s.e2.id, numero: `CR2-${sufixo}`, nome: 'Recria da fazenda 2' } });
  const tipoTarefa = await ok(req('POST', '/tipos-tarefa', s.token, { nome_tipo: 'Roçar pasto', grupo_atividade_id: grupo.id }), 201);
  const tarefa = (empresa, titulo) =>
    ok(req('POST', '/lancamentos-tarefa', s.token, { empresa_id: empresa.id, titulo, tipo: 'Manejo', tipo_tarefa_id: tipoTarefa.id, data_pedido: '2027-06-01' }), 201);
  const tarefa1 = await tarefa(s.e1, 'Roçar o retiro');
  const tarefa2 = await tarefa(s.e2, 'Roçar a sede 2');
  const operador = await s.conta(null);
  /** Conta com a linha da tela de apontamentos (visualizar + as ações dadas). */
  const contaApontamento = (acoesLigadas = {}) =>
    s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaApontamento({ visualizar: true, ...acoesLigadas })] });
  return { ...s, grupo, grupo2, tipo, tipo2, trator, rocadeira, gerador, trator2, centroB, cr1, cr2, tipoTarefa, tarefa1, tarefa2, operador, contaApontamento };
};

/** Corpo mínimo da criação na fazenda 1. */
const corpo = (s, extra = {}) => ({ empresa_id: s.e1.id, tipo_atividade_id: s.tipo.id, data_operacional: DIA, ...extra });

// ═══ Criação e número (R-k) ═════════════════════════════════════════════════

describe('D-PROD-190 — criação e número (R-k)', () => {
  test('AA1: POST completo (201) — número 1, 2, 3 da sequência do tenant; snapshots do tipo; CONFIRMADO v1; tenant e autor da sessão; auditado', async () => {
    const s = await montar(app);
    const a1 = await criarOk(s.token, corpo(s, {
      hora_inicio: '2027-06-10T07:00:00-03:00',
      hora_fim: '2027-06-10T14:15:00-03:00',
      bem_id: s.trator.id,
      implemento_bem_id: s.rocadeira.id,
      operador_usuario_id: s.operador.id,
      area_id: s.area1.id,
      centro_custo_id: s.centroB.id,
      centro_resultado_id: s.cr1.id,
      safra_ciclo: '2026/2027',
      quantidade_produzida: '12.5',
      unidade_producao: 'HA',
      horas_trabalhadas: '7.25',
      lancamento_tarefa_id: s.tarefa1.id,
      observacao: 'Roçada do retiro',
    }));
    assert.deepEqual(Object.keys(a1).sort(), [...CAMPOS_PUBLICOS]);
    assert.equal(a1.numero, '1');
    assert.equal(a1.status, 'CONFIRMADO');
    assert.equal(a1.versao, 1);
    assert.equal(a1.empresa_id, s.e1.id);
    assert.equal(a1.data_operacional, DIA);
    assert.equal(a1.hora_inicio, '2027-06-10T10:00:00.000Z');
    assert.equal(a1.hora_fim, '2027-06-10T17:15:00.000Z');
    assert.deepEqual([a1.tipo_atividade_id, a1.tipo_atividade_nome, a1.grupo_atividade_id, a1.grupo_atividade_nome], [s.tipo.id, 'ROÇADA MECANIZADA', s.grupo.id, 'PASTAGEM']);
    assert.deepEqual(a1.bem, { id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA' });
    assert.equal(a1.implemento.id, s.rocadeira.id);
    assert.deepEqual(a1.operador, { id: s.operador.id, nome: s.operador.nome });
    assert.ok(!JSON.stringify(a1).includes(s.operador.login), 'o login do operador nunca sai');
    assert.deepEqual(a1.area, { id: s.area1.id, numero_area: s.area1.numero_area, nome: 'Retiro' });
    assert.deepEqual(a1.centro_custo, { id: s.centroB.id, numero: s.centroB.numero, nome: s.centroB.nome });
    assert.deepEqual(a1.centro_resultado, { id: s.cr1.id, numero: s.cr1.numero, nome: s.cr1.nome });
    assert.equal(a1.lancamento_tarefa.id, s.tarefa1.id);
    assert.deepEqual([a1.quantidade_produzida, a1.unidade_producao, a1.horas_trabalhadas, a1.safra_ciclo], ['12.5000', 'HA', '7.2500', '2026/2027']);
    assert.equal(a1.cancelamento, null);
    assert.deepEqual(a1.criado_por, { id: s.adm.usuario.id, nome: s.adm.usuario.nome });
    for (const f of FLAGS_ANTIGAS) assert.equal(Object.prototype.hasOwnProperty.call(a1, f), false, f);

    const linha = await linhaDe(a1.id);
    assert.equal(linha.cliente_id, s.c, 'tenant do auth_context');
    assert.equal(linha.criado_por_usuario_id, s.adm.usuario.id, 'autor da sessão');
    assert.equal(linha.quantidade_produzida.toFixed(4), '12.5000');

    const det = await A.detalhe(s.token, a1.id, s.e1.id);
    assert.equal(det.statusCode, 200, det.body);
    assert.deepEqual(det.json(), { ...a1, ...SEM_ITENS }, 'o detalhe = a forma pública + itens e custo (D-PROD-193)');

    const a2 = await criarOk(s.token, corpo(s));
    const a3 = await criarOk(s.token, corpo(s, { tipo_atividade_id: s.tipo2.id }));
    assert.deepEqual([a2.numero, a3.numero], ['2', '3']);
    // Mínimo (sem bem): tudo o que é opcional sai null (R-e só copia o centro de custo do BEM).
    for (const c of ['hora_inicio', 'hora_fim', 'bem_id', 'implemento_bem_id', 'operador_usuario_id', 'area_id', 'centro_custo_id', 'centro_resultado_id',
      'safra_ciclo', 'quantidade_produzida', 'unidade_producao', 'horas_trabalhadas', 'lancamento_tarefa_id', 'observacao']) {
      assert.equal(a2[c], null, c);
    }

    const seq = await prisma().entidadeCodigoSequencia.findMany({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividade' } });
    assert.equal(seq.length, 1, 'uma sequência por tenant');
    assert.equal(seq[0].proximo_valor, 4);
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividade' } });
    assert.deepEqual(audit.map((x) => x.acao), Array(3).fill('apontamento_atividade.criar'));
    assert.deepEqual(audit.map((x) => x.entidade_id).sort(), [a1.id, a2.id, a3.id].sort());
  });

  test('AA2: número por TENANT (outro tenant recomeça em 1); recusa não consome número; criações simultâneas não repetem', async () => {
    const s = await montar(app);
    const b = await montar(app);
    assert.equal((await criarOk(s.token, corpo(s))).numero, '1');
    assert.equal((await criarOk(b.token, corpo(b))).numero, '1', 'a sequência é do tenant');
    // Recusas dentro da transação (área e tarefa de outra fazenda): tudo volta, inclusive a sequência.
    await recusa(s, () => A.criar(s.token, corpo(s, { area_id: s.area2.id })), [422, 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'outra_empresa']);
    await recusa(s, () => A.criar(s.token, corpo(s, { lancamento_tarefa_id: s.tarefa2.id })), [422, 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA', 'lancamento_tarefa_id', 'outra_empresa']);
    assert.equal((await criarOk(s.token, corpo(s))).numero, '2', 'a recusa voltou inteira: sem buraco');

    const rs = await Promise.all([1, 2, 3, 4].map(() => A.criar(s.token, corpo(s))));
    for (const r of rs) assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(rs.map((r) => Number(r.json().numero)).sort((x, y) => x - y), [3, 4, 5, 6]);
    assert.equal(await prisma().apontamentoAtividade.count({ where: { cliente_id: s.c } }), 6);
    assert.equal(await prisma().apontamentoAtividade.count({ where: { cliente_id: b.c } }), 1);
  });

  test('AA3: corpo fechado — cliente_id, campos derivados pelo servidor e as flags antigas → 400 no POST e no PATCH; decimal como número → 400', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s));
    const derivados = {
      cliente_id: 'outro-tenant', numero: '99', status: 'CANCELADO', versao: 7, tipo_atividade_nome: 'X', grupo_atividade_id: s.grupo2.id, grupo_atividade_nome: 'X',
      criado_por_usuario_id: s.operador.id, cancelado_por_usuario_id: s.operador.id, cancelado_em: '2027-06-10T10:00:00Z', motivo_cancelamento: 'x',
    };
    for (const [chave, valor] of [...Object.entries(derivados), ...FLAGS_ANTIGAS.map((f) => [f, true])]) {
      const antes = await foto(s.c);
      const r = await A.criar(s.token, corpo(s, { [chave]: valor }));
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `POST ${chave}: ${r.body}`);
      if (chave !== 'versao') {
        const p = await A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, [chave]: valor });
        assert.deepEqual([p.statusCode, p.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `PATCH ${chave}: ${p.body}`);
      }
      assert.equal(await foto(s.c), antes, `${chave}: nada gravado`);
    }
    for (const campo of ['quantidade_produzida', 'horas_trabalhadas']) {
      await recusa(s, () => A.criar(s.token, corpo(s, { quantidade_produzida: '10', unidade_producao: 'HA', [campo]: 10 })),
        [400, 'REQUEST_VALIDATION_FAILED', campo, 'valor_deve_ser_texto']);
    }
    const sem = await A.criar(s.token, { empresa_id: s.e1.id, data_operacional: DIA });
    assert.deepEqual([sem.statusCode, sem.json().code], [400, 'REQUEST_VALIDATION_FAILED'], 'tipo obrigatório');
    const vazio = await A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1 });
    assert.deepEqual([vazio.statusCode, vazio.json().code], [400, 'REQUEST_VALIDATION_FAILED'], 'PATCH sem campo');
  });
});

// ═══ Snapshots do tipo (R-h) e centros escolhidos (R-e) ═══════════════════

describe('D-PROD-190 — snapshots (R-h) e centros do apontamento (R-e)', () => {
  test('AH1: renomear tipo e grupo, mover o tipo de grupo e sincronizar referências NÃO mudam o apontamento; só a TROCA do tipo regrava', async () => {
    const s = await montar(app);
    const { req, ok } = A;
    const a = await criarOk(s.token, corpo(s));
    const linhaAntes = JSON.stringify(await linhaDe(a.id), replacer);

    await ok(req('PATCH', `/tipos-atividade/${s.tipo.id}`, s.token, { nome_tipo: 'Roçada costal' }));
    await ok(req('PATCH', `/grupos-atividade/${s.grupo.id}`, s.token, { nome_grupo: 'Pastos e capineiras' }));
    await ok(req('POST', '/referencias/sincronizar', s.token, { event: { type: 'update', entity_name: 'GrupoAtividade' }, data: { id: s.grupo.id } }));
    await ok(req('PATCH', `/tipos-atividade/${s.tipo.id}`, s.token, { grupo_atividade_id: s.grupo2.id }));
    assert.equal(JSON.stringify(await linhaDe(a.id), replacer), linhaAntes, 'a linha do apontamento não foi tocada (nem updatedAt)');
    const det = (await A.detalhe(s.token, a.id, s.e1.id)).json();
    assert.deepEqual([det.tipo_atividade_nome, det.grupo_atividade_id, det.grupo_atividade_nome], ['ROÇADA MECANIZADA', s.grupo.id, 'PASTAGEM']);

    // Editar outro campo, ou reenviar o MESMO tipo, não relê o tipo.
    const e1 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'conferido' });
    assert.deepEqual([e1.tipo_atividade_nome, e1.grupo_atividade_id, e1.grupo_atividade_nome, e1.versao], ['ROÇADA MECANIZADA', s.grupo.id, 'PASTAGEM', 2]);
    const e2 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 2, tipo_atividade_id: s.tipo.id });
    assert.deepEqual([e2.tipo_atividade_nome, e2.grupo_atividade_id, e2.grupo_atividade_nome], ['ROÇADA MECANIZADA', s.grupo.id, 'PASTAGEM']);

    // TROCAR o tipo regrava os três snapshots a partir do tipo novo…
    const e3 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 3, tipo_atividade_id: s.tipo2.id });
    assert.deepEqual([e3.tipo_atividade_id, e3.tipo_atividade_nome, e3.grupo_atividade_id, e3.grupo_atividade_nome], [s.tipo2.id, 'CONSERTO DE CERCA', s.grupo2.id, 'CERCAS']);
    // …e voltar ao primeiro grava o nome e o grupo DE AGORA (renomeado e movido).
    const e4 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 4, tipo_atividade_id: s.tipo.id });
    assert.deepEqual([e4.tipo_atividade_nome, e4.grupo_atividade_id, e4.grupo_atividade_nome], ['ROÇADA COSTAL', s.grupo2.id, 'CERCAS']);
    const linha = await linhaDe(a.id);
    assert.deepEqual([linha.tipo_atividade_nome, linha.grupo_atividade_id, linha.grupo_atividade_nome], ['ROÇADA COSTAL', s.grupo2.id, 'CERCAS']);
  });

  test('AE1: CRIAÇÃO — centro de custo nulo ou ausente + bem com centro ATIVO → copia o do bem; o informado vence; centro do bem INATIVO → nulo; sem bem (ou bem sem centro) → nulo; o implemento não conta', async () => {
    const s = await montar(app);
    const p = prisma();
    assert.equal((await p.bemPatrimonial.findUnique({ where: { id: s.trator.id } })).centro_custo_id, s.centro1.id, 'o trator tem centro ATIVO no cadastro');
    const centro1 = { id: s.centro1.id, numero: s.centro1.numero, nome: s.centro1.nome };

    const ausente = await criarOk(s.token, corpo(s, { bem_id: s.trator.id }));
    assert.deepEqual([ausente.centro_custo_id, ausente.centro_custo, ausente.centro_resultado_id, ausente.centro_resultado], [s.centro1.id, centro1, null, null], 'ausente: copiado do bem');
    assert.equal((await linhaDe(ausente.id)).centro_custo_id, s.centro1.id, 'gravado na linha, não só na resposta');
    const nulo = await criarOk(s.token, corpo(s, { bem_id: s.trator.id, centro_custo_id: null }));
    assert.deepEqual([nulo.centro_custo_id, nulo.centro_resultado_id], [s.centro1.id, null], 'null na criação também copia');
    const escolhido = await criarOk(s.token, corpo(s, { bem_id: s.trator.id, centro_custo_id: s.centroB.id }));
    assert.deepEqual([escolhido.centro_custo_id, escolhido.centro_resultado_id], [s.centroB.id, null], 'o informado vence o do bem');
    const soResultado = await criarOk(s.token, corpo(s, { bem_id: s.trator.id, centro_resultado_id: s.cr1.id }));
    assert.deepEqual([soResultado.centro_custo_id, soResultado.centro_resultado_id], [s.centro1.id, s.cr1.id], 'o resultado é só o escolhido');
    const semBem = await criarOk(s.token, corpo(s));
    assert.deepEqual([semBem.centro_custo_id, semBem.centro_resultado_id], [null, null], 'sem bem: nulo');
    // A fonte é só o bem (máquina/veículo): o centro do implemento não conta.
    await trocarCentroDoBem(s, s.rocadeira.id, s.centroB.id);
    const bemSemCentro = await criarOk(s.token, corpo(s, { bem_id: s.gerador.id, implemento_bem_id: s.rocadeira.id }));
    assert.deepEqual([bemSemCentro.centro_custo_id, bemSemCentro.centro_resultado_id], [null, null], 'bem sem centro: nulo');

    // Centro do bem INATIVO não é copiado; reativado, volta a ser (controle).
    const antigo = await p.centroCusto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: `CCA-${randomUUID().slice(0, 6)}`, nome: 'Centro desativado' } });
    await trocarCentroDoBem(s, s.gerador.id, antigo.id);
    await p.centroCusto.update({ where: { id: antigo.id }, data: { ativo: false } });
    const inativo = await criarOk(s.token, corpo(s, { bem_id: s.gerador.id }));
    assert.deepEqual([inativo.centro_custo_id, inativo.centro_resultado_id], [null, null], 'centro do bem inativo: fica nulo');
    assert.equal((await linhaDe(inativo.id)).centro_custo_id, null);
    await p.centroCusto.update({ where: { id: antigo.id }, data: { ativo: true } });
    assert.equal((await criarOk(s.token, corpo(s, { bem_id: s.gerador.id }))).centro_custo_id, antigo.id, 'reativado, copia');

    // A auditoria da criação registra se o centro veio do bem.
    const audit = await p.auditLog.findMany({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividade', acao: 'apontamento_atividade.criar' } });
    const doBem = Object.fromEntries(audit.map((x) => [x.entidade_id, /** @type {any} */ (x.dados_novos).centro_custo_copiado_do_bem]));
    assert.deepEqual([ausente, nulo, escolhido, soResultado, semBem, bemSemCentro, inativo].map((x) => doBem[x.id]), [true, true, false, true, false, false, false]);
  });

  test('AE2: depois da criação o centro de custo é SNAPSHOT — o bem trocar de centro (ou perdê-lo) não muda o apontamento; editar outro campo ou reenviar o bem não relê', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s, { bem_id: s.trator.id }));
    assert.equal(a.centro_custo_id, s.centro1.id, 'copiado na criação');
    const linhas = async () => JSON.stringify(await prisma().apontamentoAtividade.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }), replacer);
    const antes = await linhas();
    await trocarCentroDoBem(s, s.trator.id, s.centroB.id);
    assert.equal(await linhas(), antes, 'o cadastro do bem trocou de centro: a linha do apontamento não foi tocada');

    const e1 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'o bem trocou de centro' });
    assert.deepEqual([e1.centro_custo_id, e1.centro_resultado_id], [s.centro1.id, null], 'editar outro campo não relê o centro novo do bem');
    const e2 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 2, bem_id: s.trator.id });
    assert.equal(e2.centro_custo_id, s.centro1.id, 'reenviar o mesmo bem não relê');
    await trocarCentroDoBem(s, s.trator.id, null);
    const e3 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 3, data_operacional: '2027-06-11' });
    assert.equal(e3.centro_custo_id, s.centro1.id, 'o bem sem centro não apaga o snapshot');
    assert.equal((await linhaDe(a.id)).centro_custo_id, s.centro1.id);
  });

  test('AE3: EDIÇÃO — centro nulo continua nulo ao editar outro campo e ao TROCAR o bem por um com centro; só o centro explícito no PATCH muda; o de resultado nunca se preenche sozinho', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s, { bem_id: s.gerador.id }));
    assert.deepEqual([a.centro_custo_id, a.centro_resultado_id], [null, null], 'gerador sem centro: nulo');
    await trocarCentroDoBem(s, s.gerador.id, s.centroB.id);

    const x1 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'o gerador ganhou centro' });
    assert.deepEqual([x1.centro_custo_id, x1.centro_resultado_id], [null, null], 'editar outro campo não copia do bem');
    const x2 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 2, bem_id: s.trator.id });
    assert.deepEqual([x2.bem_id, x2.centro_custo_id, x2.centro_resultado_id], [s.trator.id, null, null], 'trocar para um bem COM centro não copia');
    const x3 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 3, centro_custo_id: s.centroB.id });
    assert.deepEqual([x3.centro_custo_id, x3.centro_resultado_id], [s.centroB.id, null], 'o explícito no PATCH muda');
    const x4 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 4, centro_custo_id: null });
    assert.deepEqual([x4.bem_id, x4.centro_custo_id], [s.trator.id, null], 'null explícito na edição limpa: não volta ao do bem');
    const x5 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 5, centro_custo_id: s.centro1.id, centro_resultado_id: s.cr1.id });
    assert.deepEqual([x5.centro_custo_id, x5.centro_resultado_id], [s.centro1.id, s.cr1.id]);
    const x6 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 6, centro_resultado_id: null });
    assert.deepEqual([x6.centro_custo_id, x6.centro_resultado_id, x6.centro_resultado], [s.centro1.id, null, null]);
    const linha = await linhaDe(a.id);
    assert.deepEqual([linha.bem_id, linha.centro_custo_id, linha.centro_resultado_id, linha.versao], [s.trator.id, s.centro1.id, null, 7]);
  });

  test('AE4: centro de outra fazenda, inexistente ou inativo → 422 da coluna, nada gravado (na criação e na edição)', async () => {
    const s = await montar(app);
    const inativo = await prisma().centroCusto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: `CCI-${randomUUID().slice(0, 6)}`, nome: 'Centro antigo', ativo: false } });
    const R = 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA';
    await recusa(s, () => A.criar(s.token, corpo(s, { centro_custo_id: s.centro2.id })), [422, R, 'centro_custo_id', 'outra_empresa']);
    await recusa(s, () => A.criar(s.token, corpo(s, { centro_resultado_id: s.cr2.id })), [422, R, 'centro_resultado_id', 'outra_empresa']);
    await recusa(s, () => A.criar(s.token, corpo(s, { centro_custo_id: 'centro-que-nao-existe' })), [422, R, 'centro_custo_id', 'inexistente']);
    await recusa(s, () => A.criar(s.token, corpo(s, { centro_custo_id: inativo.id })), [422, R, 'centro_custo_id', 'inativo']);
    const a = await criarOk(s.token, corpo(s));
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, centro_resultado_id: s.cr2.id }), [422, R, 'centro_resultado_id', 'outra_empresa']);
  });
});

// ═══ Regras de negócio (R-a, R-b, R-c, R-d, R-f, R-i) ═══════════════════════

describe('D-PROD-190 — regras de negócio do apontamento', () => {
  test('AR-a: tipo inativo não entra em apontamento NOVO; editar mantendo o tipo (inativo agora) pode; trocar para outro tipo inativo, não', async () => {
    const s = await montar(app);
    const { req, ok } = A;
    const R = 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA';
    const a = await criarOk(s.token, corpo(s));
    await ok(req('PATCH', `/tipos-atividade/${s.tipo.id}`, s.token, { ativo: false }));
    await ok(req('PATCH', `/tipos-atividade/${s.tipo2.id}`, s.token, { ativo: false }));

    await recusa(s, () => A.criar(s.token, corpo(s)), [422, R, 'tipo_atividade_id', 'inativo']);
    const e1 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'tipo inativo mantido' });
    assert.equal(e1.tipo_atividade_id, s.tipo.id);
    const e2 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 2, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-11' });
    assert.deepEqual([e2.tipo_atividade_id, e2.data_operacional, e2.versao], [s.tipo.id, '2027-06-11', 3]);
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 3, tipo_atividade_id: s.tipo2.id }), [422, R, 'tipo_atividade_id', 'inativo']);
    await recusa(s, () => A.criar(s.token, corpo(s, { tipo_atividade_id: 'tipo-que-nao-existe' })), [422, R, 'tipo_atividade_id', 'inexistente']);

    // Reativado, volta a valer para apontamento novo.
    await ok(req('PATCH', `/tipos-atividade/${s.tipo2.id}`, s.token, { ativo: true }));
    const e3 = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 3, tipo_atividade_id: s.tipo2.id });
    assert.equal(e3.tipo_atividade_id, s.tipo2.id);
  });

  test('AR-b: hora_fim anterior a hora_inicio → 422 (compara INSTANTES, com fuso); iguais pode; hora sem fuso → 400; o PATCH vale sobre o estado final', async () => {
    const s = await montar(app);
    const H = 'APONTAMENTO_ATIVIDADE_HORARIO_INVALIDO';
    await recusa(s, () => A.criar(s.token, corpo(s, { hora_inicio: '2027-06-10T08:00:00-03:00', hora_fim: '2027-06-10T07:59:00-03:00' })), [422, H, 'hora_fim', 'fim_antes_do_inicio']);
    // 08:00 em -03:00 = 11:00Z; 10:30Z é ANTES, ainda que o texto "10:30" pareça depois de "08:00".
    await recusa(s, () => A.criar(s.token, corpo(s, { hora_inicio: '2027-06-10T08:00:00-03:00', hora_fim: '2027-06-10T10:30:00Z' })), [422, H, 'hora_fim', 'fim_antes_do_inicio']);
    for (const h of ['2027-06-10T08:00:00', '2027-06-10 08:00', '08:00']) {
      const antes = await foto(s.c);
      const r = await A.criar(s.token, corpo(s, { hora_inicio: h }));
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${h}: ${r.body}`);
      assert.equal(await foto(s.c), antes);
    }
    const iguais = await criarOk(s.token, corpo(s, { hora_inicio: '2027-06-10T08:00:00-03:00', hora_fim: '2027-06-10T11:00:00Z' }));
    assert.equal(iguais.hora_inicio, iguais.hora_fim, 'iguais pode');
    const soInicio = await criarOk(s.token, corpo(s, { hora_inicio: '2027-06-10T08:00:00-03:00' }));
    await recusa(s, () => A.editar(s.token, soInicio.id, { empresa_id: s.e1.id, versao: 1, hora_fim: '2027-06-10T07:00:00-03:00' }), [422, H, 'hora_fim', 'fim_antes_do_inicio']);
    const fim = await editarOk(s.token, soInicio.id, { empresa_id: s.e1.id, versao: 1, hora_fim: '2027-06-10T17:00:00-03:00' });
    assert.equal(fim.hora_fim, '2027-06-10T20:00:00.000Z');
    await recusa(s, () => A.editar(s.token, soInicio.id, { empresa_id: s.e1.id, versao: 2, hora_inicio: '2027-06-10T18:00:00-03:00' }), [422, H, 'hora_fim', 'fim_antes_do_inicio']);
  });

  test('AR-c: data posterior a "hoje" no fuso da fazenda → 422 DATA_FUTURA (details hoje/fuso), na criação e na edição; hoje passa', () =>
    comRelogioDeTeste('2027-06-15T15:00:00Z', async () => {
      const s = await montar(app);
      const F = 'APONTAMENTO_ATIVIDADE_DATA_FUTURA';
      const r = await recusa(s, () => A.criar(s.token, corpo(s, { data_operacional: '2027-06-16' })), [422, F, 'data_operacional', 'data_futura']);
      assert.deepEqual(r.json().details, { data: '2027-06-16', hoje: HOJE, fuso: 'America/Sao_Paulo' });
      const hoje = await criarOk(s.token, corpo(s, { data_operacional: HOJE }));
      assert.equal(hoje.data_operacional, HOJE);
      await recusa(s, () => A.editar(s.token, hoje.id, { empresa_id: s.e1.id, versao: 1, data_operacional: '2027-06-16' }), [422, F, 'data_operacional', 'data_futura']);
      const inexistente = await A.criar(s.token, corpo(s, { data_operacional: '2027-02-30' }));
      assert.deepEqual([inexistente.statusCode, inexistente.json().code, inexistente.json().field], [400, 'REQUEST_VALIDATION_FAILED', 'data_operacional']);
    }));

  test('AR-c (fuso): o mesmo instante é "amanhã" em Rio Branco e já "hoje" em São Paulo; fazenda sem fuso → 409 EMPRESA_FUSO_NAO_CONFIGURADO', async () => {
    const s = await montar(app);
    const sufixo = randomUUID().slice(0, 6);
    const acre = await prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: 3, fuso_horario: 'America/Rio_Branco', apelido: 'F3', nome: `Fazenda Acre ${sufixo}` } });
    const semFuso = await prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: 4, fuso_horario: null, apelido: 'F4', nome: `Fazenda sem fuso ${sufixo}` } });
    await comRelogioDeTeste('2026-11-05T04:30:00Z', async () => {
      // São Paulo: 01:30 de 05/11 (hoje); Rio Branco: 23:30 de 04/11.
      assert.equal((await criarOk(s.token, corpo(s, { data_operacional: '2026-11-05' }))).data_operacional, '2026-11-05');
      const r = await recusa(s, () => A.criar(s.token, corpo(s, { empresa_id: acre.id, data_operacional: '2026-11-05' })),
        [422, 'APONTAMENTO_ATIVIDADE_DATA_FUTURA', 'data_operacional', 'data_futura']);
      assert.deepEqual(r.json().details, { data: '2026-11-05', hoje: '2026-11-04', fuso: 'America/Rio_Branco' });
      assert.equal((await criarOk(s.token, corpo(s, { empresa_id: acre.id, data_operacional: '2026-11-04' }))).empresa_id, acre.id);
      await recusa(s, () => A.criar(s.token, corpo(s, { empresa_id: semFuso.id, data_operacional: '2026-11-01' })), [409, 'EMPRESA_FUSO_NAO_CONFIGURADO', null, null]);
    });
  });

  test('AR-c (horas): nenhuma hora depois de "agora"; início e fim no dia LOCAL da data operacional (sem virar o dia); na edição, sobre o estado final; sem horas segue aceito', () =>
    comRelogioDeTeste('2027-06-15T15:00:00Z', async () => {
      // Agora = 12:00 de 15/06 em São Paulo (fuso das fazendas do cenário).
      const s = await montar(app);
      const H = 'APONTAMENTO_ATIVIDADE_HORARIO_INVALIDO';
      const e1 = s.e1.id;

      // Hora futura, mesmo dentro do dia de hoje (criação).
      await recusa(s, () => A.criar(s.token, corpo(s, { data_operacional: HOJE, hora_inicio: `${HOJE}T12:30:00-03:00` })), [422, H, 'hora_inicio', 'hora_futura']);
      const fut = await recusa(s, () => A.criar(s.token, corpo(s, { data_operacional: HOJE, hora_inicio: `${HOJE}T08:00:00-03:00`, hora_fim: `${HOJE}T12:00:01-03:00` })),
        [422, H, 'hora_fim', 'hora_futura']);
      assert.equal(fut.json().details.agora, '2027-06-15T15:00:00.000Z', 'o "agora" é o mesmo relógio do "hoje"');
      // Limite: exatamente agora pode.
      const hoje = await criarOk(s.token, corpo(s, { data_operacional: HOJE, hora_inicio: `${HOJE}T08:00:00-03:00`, hora_fim: '2027-06-15T15:00:00Z' }));
      assert.equal(hoje.hora_fim, '2027-06-15T15:00:00.000Z');
      // Hora futura (edição).
      await recusa(s, () => A.editar(s.token, hoje.id, { empresa_id: e1, versao: 1, hora_fim: `${HOJE}T12:30:00-03:00` }), [422, H, 'hora_fim', 'hora_futura']);
      await recusa(s, () => A.editar(s.token, hoje.id, { empresa_id: e1, versao: 1, hora_inicio: `${HOJE}T12:00:30-03:00`, hora_fim: null }), [422, H, 'hora_inicio', 'hora_futura']);

      // Início fora do dia: vale o dia LOCAL da fazenda, não o texto nem o UTC.
      await recusa(s, () => A.criar(s.token, corpo(s, { hora_inicio: '2027-06-09T23:30:00-03:00' })), [422, H, 'hora_inicio', 'hora_fora_do_dia']);
      const fora = await recusa(s, () => A.criar(s.token, corpo(s, { hora_inicio: '2027-06-10T01:00:00Z' })), [422, H, 'hora_inicio', 'hora_fora_do_dia']);
      const d = fora.json().details;
      assert.deepEqual([d.data, d.dia, d.fuso], [DIA, '2027-06-09', 'America/Sao_Paulo'], '01:00Z de 10/06 é 22:00 de 09/06 na fazenda');
      const virada = await criarOk(s.token, corpo(s, { hora_inicio: '2027-06-11T02:00:00Z' }));
      assert.equal(virada.hora_inicio, '2027-06-11T02:00:00.000Z', '02:00Z de 11/06 é 23:00 de 10/06 na fazenda');

      // Fim: também no dia LOCAL da data (sem turno que vira o dia; um turno noturno vira dois apontamentos).
      const ateMeiaNoite = await criarOk(s.token, corpo(s, { hora_inicio: '2027-06-10T22:00:00-03:00', hora_fim: '2027-06-10T23:59:00-03:00' }));
      assert.equal(ateMeiaNoite.hora_fim, '2027-06-11T02:59:00.000Z', '23:59 de 10/06 na fazenda ainda é o dia da data (02:59Z de 11/06)');
      const meiaNoite = await recusa(s, () => A.criar(s.token, corpo(s, { hora_inicio: '2027-06-10T22:00:00-03:00', hora_fim: '2027-06-11T00:00:00-03:00' })),
        [422, H, 'hora_fim', 'hora_fora_do_dia']);
      assert.equal(meiaNoite.json().details.dia, '2027-06-11', 'meia-noite já é o dia seguinte');
      await recusa(s, () => A.criar(s.token, corpo(s, { hora_inicio: '2027-06-10T22:00:00-03:00', hora_fim: '2027-06-11T05:30:00-03:00' })), [422, H, 'hora_fim', 'hora_fora_do_dia']);
      await recusa(s, () => A.criar(s.token, corpo(s, { hora_fim: '2027-06-09T18:00:00-03:00' })), [422, H, 'hora_fim', 'hora_fora_do_dia']);
      await recusa(s, () => A.criar(s.token, corpo(s, { hora_fim: '2027-06-11T06:00:00-03:00' })), [422, H, 'hora_fim', 'hora_fora_do_dia']);
      assert.equal((await criarOk(s.token, corpo(s, { hora_fim: '2027-06-10T18:00:00-03:00' }))).hora_inicio, null, 'só o fim, no dia da data, pode');

      // Edição: mudar a data deixando as horas no dia antigo → recusado (estado final).
      const a = await criarOk(s.token, corpo(s, { hora_inicio: '2027-06-10T08:00:00-03:00', hora_fim: '2027-06-10T10:00:00-03:00' }));
      await recusa(s, () => A.editar(s.token, a.id, { empresa_id: e1, versao: 1, data_operacional: '2027-06-11' }), [422, H, 'hora_inicio', 'hora_fora_do_dia']);
      await recusa(s, () => A.editar(s.token, a.id, { empresa_id: e1, versao: 1, data_operacional: '2027-06-09' }), [422, H, 'hora_inicio', 'hora_fora_do_dia']);
      await recusa(s, () => A.editar(s.token, a.id, { empresa_id: e1, versao: 1, hora_fim: '2027-06-12T01:00:00-03:00' }), [422, H, 'hora_fim', 'hora_fora_do_dia']);
      const movido = await editarOk(s.token, a.id, { empresa_id: e1, versao: 1, data_operacional: '2027-06-11', hora_inicio: '2027-06-11T08:00:00-03:00', hora_fim: '2027-06-11T09:00:00-03:00' });
      assert.deepEqual([movido.data_operacional, movido.hora_inicio, movido.versao], ['2027-06-11', '2027-06-11T11:00:00.000Z', 2], 'data e horas juntas, coerentes');
      const semHoras = await editarOk(s.token, a.id, { empresa_id: e1, versao: 2, hora_inicio: null, hora_fim: null, data_operacional: '2027-06-01' });
      assert.deepEqual([semHoras.hora_inicio, semHoras.hora_fim, semHoras.data_operacional], [null, null, '2027-06-01'], 'sem horas, nada a conferir');
      // Apontamento sem horas: criar e mudar a data continuam aceitos.
      const b = await criarOk(s.token, corpo(s));
      assert.equal((await editarOk(s.token, b.id, { empresa_id: e1, versao: 1, data_operacional: '2027-06-02' })).data_operacional, '2027-06-02');
    }));

  test('AR-d: implemento igual ao bem e implemento sem bem → 422 (criação e edição sobre o estado final)', async () => {
    const s = await montar(app);
    const I = 'APONTAMENTO_ATIVIDADE_IMPLEMENTO_INVALIDO';
    await recusa(s, () => A.criar(s.token, corpo(s, { bem_id: s.trator.id, implemento_bem_id: s.trator.id })), [422, I, 'implemento_bem_id', 'implemento_igual_ao_bem']);
    await recusa(s, () => A.criar(s.token, corpo(s, { implemento_bem_id: s.rocadeira.id })), [422, I, 'implemento_bem_id', 'implemento_sem_bem']);
    await recusa(s, () => A.criar(s.token, corpo(s, { bem_id: null, implemento_bem_id: s.rocadeira.id })), [422, I, 'implemento_bem_id', 'implemento_sem_bem']);
    const a = await criarOk(s.token, corpo(s, { bem_id: s.trator.id, implemento_bem_id: s.rocadeira.id }));
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, bem_id: null }), [422, I, 'implemento_bem_id', 'implemento_sem_bem']);
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, implemento_bem_id: s.trator.id }), [422, I, 'implemento_bem_id', 'implemento_igual_ao_bem']);
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, bem_id: s.rocadeira.id }), [422, I, 'implemento_bem_id', 'implemento_igual_ao_bem']);
    const sem = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, bem_id: null, implemento_bem_id: null });
    assert.deepEqual([sem.bem_id, sem.implemento_bem_id], [null, null], 'tirar os dois juntos pode');
  });

  test('AR-f: produção — quantidade e unidade andam juntas, > 0; horas > 0; unidade só HA, CAB, TON ou KM', async () => {
    const s = await montar(app);
    const P = 'APONTAMENTO_ATIVIDADE_PRODUCAO_INVALIDA';
    await recusa(s, () => A.criar(s.token, corpo(s, { quantidade_produzida: '10' })), [422, P, 'unidade_producao', 'quantidade_sem_unidade']);
    await recusa(s, () => A.criar(s.token, corpo(s, { unidade_producao: 'HA' })), [422, P, 'quantidade_produzida', 'unidade_sem_quantidade']);
    await recusa(s, () => A.criar(s.token, corpo(s, { quantidade_produzida: '0', unidade_producao: 'HA' })), [422, P, 'quantidade_produzida', 'quantidade_nao_positiva']);
    await recusa(s, () => A.criar(s.token, corpo(s, { quantidade_produzida: '0.0000', unidade_producao: 'CAB' })), [422, P, 'quantidade_produzida', 'quantidade_nao_positiva']);
    await recusa(s, () => A.criar(s.token, corpo(s, { horas_trabalhadas: '0' })), [422, P, 'horas_trabalhadas', 'horas_nao_positivas']);
    for (const [campo, valor] of [['unidade_producao', 'LT'], ['unidade_producao', 'ha'], ['unidade_producao', ''], ['quantidade_produzida', '-1'], ['quantidade_produzida', '1,5'], ['horas_trabalhadas', '1.23456']]) {
      const antes = await foto(s.c);
      const r = await A.criar(s.token, corpo(s, { quantidade_produzida: '10', unidade_producao: 'HA', [campo]: valor }));
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${campo}=${valor}: ${r.body}`);
      assert.equal(await foto(s.c), antes);
    }
    for (const unidade of ['HA', 'CAB', 'TON', 'KM']) {
      const a = await criarOk(s.token, corpo(s, { quantidade_produzida: '0.0001', unidade_producao: unidade, horas_trabalhadas: '9999999999.9999' }));
      assert.deepEqual([a.quantidade_produzida, a.unidade_producao, a.horas_trabalhadas], ['0.0001', unidade, '9999999999.9999']);
    }
    const a = await criarOk(s.token, corpo(s, { quantidade_produzida: '40', unidade_producao: 'CAB' }));
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, unidade_producao: null }), [422, P, 'unidade_producao', 'quantidade_sem_unidade']);
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, quantidade_produzida: null }), [422, P, 'quantidade_produzida', 'unidade_sem_quantidade']);
    const limpo = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, quantidade_produzida: null, unidade_producao: null });
    assert.deepEqual([limpo.quantidade_produzida, limpo.unidade_producao], [null, null]);
  });

  test('AR-i: bem, implemento, área e tarefa de OUTRA fazenda (ou inexistentes) → 422 da coluna, nada gravado; na edição também', async () => {
    const s = await montar(app);
    const R = 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA';
    await recusa(s, () => A.criar(s.token, corpo(s, { bem_id: s.trator2.id })), [422, R, 'bem_id', 'outra_empresa']);
    await recusa(s, () => A.criar(s.token, corpo(s, { bem_id: s.trator.id, implemento_bem_id: s.trator2.id })), [422, R, 'implemento_bem_id', 'outra_empresa']);
    await recusa(s, () => A.criar(s.token, corpo(s, { area_id: s.area2.id })), [422, R, 'area_id', 'outra_empresa']);
    await recusa(s, () => A.criar(s.token, corpo(s, { lancamento_tarefa_id: s.tarefa2.id })), [422, R, 'lancamento_tarefa_id', 'outra_empresa']);
    for (const campo of ['bem_id', 'area_id', 'lancamento_tarefa_id', 'operador_usuario_id']) {
      await recusa(s, () => A.criar(s.token, corpo(s, { [campo]: 'id-que-nao-existe' })), [422, R, campo, 'inexistente']);
    }
    // A mesma regra vale da fazenda 2 para a 1.
    await recusa(s, () => A.criar(s.token, corpo(s, { empresa_id: s.e2.id, bem_id: s.trator.id, area_id: s.area2.id })), [422, R, 'bem_id', 'outra_empresa']);
    const doisOk = await criarOk(s.token, corpo(s, { empresa_id: s.e2.id, bem_id: s.trator2.id, area_id: s.area2.id, lancamento_tarefa_id: s.tarefa2.id, centro_resultado_id: s.cr2.id }));
    assert.equal(doisOk.empresa_id, s.e2.id);

    const a = await criarOk(s.token, corpo(s, { bem_id: s.trator.id, area_id: s.area1.id, lancamento_tarefa_id: s.tarefa1.id }));
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, area_id: s.area2.id }), [422, R, 'area_id', 'outra_empresa']);
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, lancamento_tarefa_id: s.tarefa2.id }), [422, R, 'lancamento_tarefa_id', 'outra_empresa']);
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, bem_id: s.trator2.id }), [422, R, 'bem_id', 'outra_empresa']);
    // O apontamento não muda de fazenda: com a empresa 2 no PATCH, o da fazenda 1 não existe.
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e2.id, versao: 1, observacao: 'x' }), [404, 'APONTAMENTO_ATIVIDADE_NOT_FOUND', null, null]);
  });

  test('AR-a (cadastros): vínculo NOVO com bem ou área inativos é recusado; manter o que foi inativado depois é permitido', async () => {
    const s = await montar(app);
    const { req, ok } = A;
    const R = 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA';
    const a = await criarOk(s.token, corpo(s, { bem_id: s.gerador.id, area_id: s.area1.id }));
    const g = await ok(req('GET', `/bens-patrimoniais/${s.gerador.id}?empresa_id=${s.e1.id}`, s.token));
    await ok(req('PATCH', `/bens-patrimoniais/${s.gerador.id}`, s.token, { empresa_id: s.e1.id, versao: g.versao, ativo: false }));
    await prisma().areaPastagem.update({ where: { id: s.area1.id }, data: { ativo: false } });
    await recusa(s, () => A.criar(s.token, corpo(s, { bem_id: s.gerador.id })), [422, R, 'bem_id', 'inativo']);
    await recusa(s, () => A.criar(s.token, corpo(s, { area_id: s.area1.id })), [422, R, 'area_id', 'inativo']);
    const mantido = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'bem e área inativados depois' });
    assert.deepEqual([mantido.bem_id, mantido.area_id], [s.gerador.id, s.area1.id]);
  });
});

// ═══ Cancelamento (R-j) e cancelado imutável (R-g) ═══════════════════════════

describe('D-PROD-190 — cancelamento sem DELETE físico (R-j) e cancelado imutável (R-g)', () => {
  test('AJ1: cancelar grava CANCELADO, quem, quando e motivo e incrementa a versão; a linha continua; depois nada edita nem cancela de novo', async () => {
    const s = await montar(app);
    const quem = await s.contaApontamento({ excluir: true });
    const a = await criarOk(s.token, corpo(s, { bem_id: s.trator.id }));
    const e = await editarOk(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'ajuste' });
    assert.equal(e.versao, 2);

    // CAS: versão velha → 409, nada gravado.
    const v = await recusa(s, () => A.cancelar(quem.token, a.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado em dobro' }), [409, 'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO', null, null]);
    assert.deepEqual(v.json().details, { versao_atual: 2, versao_informada: 1 });
    await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, observacao: 'velha' }), [409, 'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO', null, null]);
    // Motivo obrigatório (mínimo de 3 caracteres úteis).
    for (const motivo of ['', '   ', 'ab']) {
      const antes = await foto(s.c);
      const r = await A.cancelar(quem.token, a.id, { empresa_id: s.e1.id, versao: 2, motivo });
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `motivo "${motivo}": ${r.body}`);
      assert.equal(await foto(s.c), antes);
    }

    const c = await A.cancelar(quem.token, a.id, { empresa_id: s.e1.id, versao: 2, motivo: '  lançado em dobro  ' });
    assert.equal(c.statusCode, 200, c.body);
    const cancelado = c.json();
    assert.deepEqual(Object.keys(cancelado).sort(), [...CAMPOS_DETALHE, 'replay'].sort(), 'D-PROD-193: o cancelamento responde o detalhe + replay');
    assert.deepEqual([cancelado.status, cancelado.versao, cancelado.replay], ['CANCELADO', 3, false]);
    assert.deepEqual([cancelado.itens, cancelado.custo_itens], [SEM_ITENS.itens, SEM_ITENS.custo_itens]);
    assert.deepEqual(cancelado.cancelamento.cancelado_por, { id: quem.id, nome: quem.nome });
    assert.equal(cancelado.cancelamento.motivo, 'lançado em dobro');
    assert.ok(Number.isFinite(Date.parse(cancelado.cancelamento.cancelado_em)), 'instante do cancelamento gravado');
    assert.deepEqual(cancelado.criado_por, { id: s.adm.usuario.id, nome: s.adm.usuario.nome }, 'o autor não muda');
    const linha = await linhaDe(a.id);
    assert.deepEqual(
      [linha.status, linha.versao, linha.cancelado_por_usuario_id, linha.motivo_cancelamento, linha.cancelado_em?.toISOString()],
      ['CANCELADO', 3, quem.id, 'lançado em dobro', cancelado.cancelamento.cancelado_em]
    );
    assert.equal(linha.bem_id, s.trator.id, 'o histórico fica inteiro');

    // R-g: nenhum campo edita, e não cancela de novo (nem com a versão atual).
    const S = 'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO';
    for (const campos of [{ observacao: 'depois' }, { data_operacional: '2027-06-01' }, { tipo_atividade_id: s.tipo2.id }, { bem_id: null }, { centro_custo_id: s.centroB.id }]) {
      const r = await recusa(s, () => A.editar(s.token, a.id, { empresa_id: s.e1.id, versao: 3, ...campos }), [409, S, 'status', 'status_invalido']);
      assert.equal(r.json().details.status, 'CANCELADO');
    }
    await recusa(s, () => A.cancelar(quem.token, a.id, { empresa_id: s.e1.id, versao: 3, motivo: 'de novo' }), [409, S, 'status', 'status_invalido']);
    await recusa(s, () => A.cancelar(quem.token, a.id, { empresa_id: s.e1.id, versao: 2, motivo: 'de novo' }), [409, S, 'status', 'status_invalido']);

    // Sem DELETE físico: a rota não existe e a linha continua.
    const del = await A.req('DELETE', `/apontamentos-atividade/${a.id}?empresa_id=${s.e1.id}`, s.token);
    assert.equal(del.statusCode, 404, del.body);
    assert.equal(await prisma().apontamentoAtividade.count({ where: { id: a.id } }), 1);
    const det = (await A.detalhe(s.token, a.id, s.e1.id)).json();
    assert.deepEqual(det, semReplay(cancelado), 'o detalhe mostra o cancelamento');

    const acoesAuditadas = (await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividade', entidade_id: a.id }, orderBy: { createdAt: 'asc' } })).map((x) => x.acao);
    assert.deepEqual(acoesAuditadas, ['apontamento_atividade.criar', 'apontamento_atividade.editar', 'apontamento_atividade.cancelar']);
  });

  test('AJ2: dois cancelamentos simultâneos da mesma versão (chaves diferentes) → exatamente um 200, o outro 409 STATUS_INVALIDO (D-PROD-193: o cancelamento trava a linha); versão 2', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s));
    const rs = await Promise.all([1, 2].map((i) => A.cancelar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, motivo: `corrida ${i}` })));
    const status = rs.map((r) => r.statusCode).sort();
    assert.deepEqual(status, [200, 409], rs.map((r) => r.body).join(' | '));
    const perdedor = rs.find((r) => r.statusCode === 409).json().code;
    // Com o FOR UPDATE (I-c), o 2º espera o 1º e relê: CANCELADO (a situação vem antes da versão).
    assert.equal(perdedor, 'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO');
    const linha = await linhaDe(a.id);
    assert.deepEqual([linha.status, linha.versao], ['CANCELADO', 2]);
    assert.equal((await prisma().auditLog.count({ where: { cliente_id: s.c, acao: 'apontamento_atividade.cancelar' } })), 1);
  });

  test('AJ4 (D-PROD-193, D-2): sem operation_id → 400 e nada gravado; mesma chave e corpo → 200 replay sem efeito novo; mesma chave com outro motivo → 409 IDEMPOTENCY_CONFLICT', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s));
    for (const chave of [undefined, 'curta', '']) {
      const c = { empresa_id: s.e1.id, versao: 1, motivo: 'sem chave válida', ...(chave === undefined ? {} : { operation_id: chave }) };
      const antes = await foto(s.c);
      const r = await A.cancelarCru(s.token, a.id, c);
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `operation_id ${JSON.stringify(chave)}: ${r.body}`);
      assert.equal(await foto(s.c), antes, 'nada gravado');
    }
    const c = { empresa_id: s.e1.id, versao: 1, motivo: 'lançado em dobro', operation_id: opId() };
    const r1 = await A.cancelarCru(s.token, a.id, c);
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(r1.json().replay, false);
    const antes = await foto(s.c);
    const r2 = await A.cancelarCru(s.token, a.id, c);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().replay, true);
    assert.deepEqual(semReplay(r2.json()), semReplay(r1.json()), 'o corpo gravado');
    assert.equal(await foto(s.c), antes, 'o replay não grava nada');
    const r3 = await A.cancelarCru(s.token, a.id, { ...c, motivo: 'outro motivo' });
    assert.deepEqual([r3.statusCode, r3.json().code], [409, 'IDEMPOTENCY_CONFLICT'], r3.body);
    const linha = await linhaDe(a.id);
    assert.deepEqual([linha.status, linha.versao, linha.motivo_cancelamento], ['CANCELADO', 2, 'lançado em dobro']);
  });

  test('AJ3: CAS do repositório, sem corrida — versão velha → 0 linhas; CANCELADO com a versão CERTA → 0; outra fazenda ou tenant → 0; o caminho feliz → 1 (versão +1)', async () => {
    const s = await montar(app);
    const p = prisma();
    const a = await criarOk(s.token, corpo(s));
    /** UPDATE com versão direto no repositório (o mesmo do serviço), sobre o apontamento `a`. */
    const cas = (extra = {}) =>
      atualizarComVersao(p, { clienteId: s.c, empresaId: s.e1.id, id: a.id, versao: 1, statusEsperado: 'CONFIRMADO', dados: { observacao: 'cas' }, ...extra });
    const linha = async () => JSON.stringify(await linhaDe(a.id), replacer);

    const antes = await linha();
    assert.equal(await cas({ versao: 2 }), 0, 'versão diferente da gravada');
    assert.equal(await cas({ empresaId: s.e2.id }), 0, 'outra fazenda');
    assert.equal(await cas({ clienteId: `outro-${randomUUID().slice(0, 6)}` }), 0, 'outro tenant');
    assert.equal(await linha(), antes, 'nada mudou');

    assert.equal(await cas(), 1, 'versão e status certos: 1 linha');
    let l = await linhaDe(a.id);
    assert.deepEqual([l.versao, l.status, l.observacao], [2, 'CONFIRMADO', 'cas'], 'versão incrementada uma vez');
    const v2 = await linha();
    assert.equal(await cas({ dados: { observacao: 'velha' } }), 0, 'a versão 1 ficou velha');
    assert.equal(await linha(), v2);

    // Cancelado (como o serviço cancela) e, depois, a versão CERTA não passa pelo status.
    assert.equal(await cas({ versao: 2, dados: { status: 'CANCELADO', cancelado_em: new Date(), motivo_cancelamento: 'cas' } }), 1);
    const cancelado = await linha();
    assert.equal(await cas({ versao: 3, dados: { observacao: 'depois de cancelado' } }), 0, 'CANCELADO com a versão certa: 0 linhas');
    assert.equal(await cas({ versao: 3, dados: { status: 'CONFIRMADO' } }), 0, 'nem para "descancelar"');
    assert.equal(await linha(), cancelado);
    l = await linhaDe(a.id);
    assert.deepEqual([l.versao, l.status, l.observacao], [3, 'CANCELADO', 'cas']);
  });
});

// ═══ Isolamento ═════════════════════════════════════════════════════════════

describe('D-PROD-190 — isolamento por tenant e por fazenda', () => {
  test('AI1: outro tenant não lista, não lê, não edita e não cancela (404 sem oráculo) e não aponta cadastros alheios', async () => {
    const A1 = await montar(app);
    const B = await montar(app);
    const a = await criarOk(A1.token, corpo(A1, { bem_id: A1.trator.id, area_id: A1.area1.id }));
    const fotoA = await foto(A1.c);

    const lista = await A.lista(B.token, B.e1.id);
    assert.equal(lista.statusCode, 200, lista.body);
    assert.deepEqual([lista.json().items, lista.json().total], [[], 0]);
    for (const r of [
      await A.detalhe(B.token, a.id, B.e1.id),
      await A.editar(B.token, a.id, { empresa_id: B.e1.id, versao: 1, observacao: 'invasão' }),
      await A.cancelar(B.token, a.id, { empresa_id: B.e1.id, versao: 1, motivo: 'invasão' }),
    ]) assert.deepEqual([r.statusCode, r.json().code], [404, 'APONTAMENTO_ATIVIDADE_NOT_FOUND'], r.body);
    // A fazenda de A pedida por B: a empresa não existe no tenant de B.
    for (const r of [
      await A.lista(B.token, A1.e1.id),
      await A.detalhe(B.token, a.id, A1.e1.id),
      await A.editar(B.token, a.id, { empresa_id: A1.e1.id, versao: 1, observacao: 'invasão' }),
      await A.cancelar(B.token, a.id, { empresa_id: A1.e1.id, versao: 1, motivo: 'invasão' }),
      await A.criar(B.token, corpo(A1)),
    ]) assert.deepEqual([r.statusCode, r.json().code], [404, 'EMPRESA_NOT_FOUND'], r.body);
    // Cadastros de A apontados por B: não existem no tenant de B (mesmo 422 do id inventado).
    const R = 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA';
    await recusa(B, () => A.criar(B.token, corpo(B, { tipo_atividade_id: A1.tipo.id })), [422, R, 'tipo_atividade_id', 'inexistente']);
    for (const [campo, id] of [['bem_id', A1.trator.id], ['area_id', A1.area1.id], ['lancamento_tarefa_id', A1.tarefa1.id], ['operador_usuario_id', A1.operador.id], ['centro_custo_id', A1.centro1.id], ['centro_resultado_id', A1.cr1.id]]) {
      await recusa(B, () => A.criar(B.token, corpo(B, { [campo]: id })), [422, R, campo, 'inexistente']);
    }
    assert.equal(await foto(A1.c), fotoA, 'nada de A mudou');
  });

  test('AI2: no mesmo tenant, o apontamento é da SUA fazenda: com a fazenda 2 não aparece na lista nem no detalhe', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s));
    const outra = await criarOk(s.token, corpo(s, { empresa_id: s.e2.id }));
    assert.deepEqual((await A.lista(s.token, s.e2.id)).json().items.map((x) => x.id), [outra.id]);
    const r = await A.detalhe(s.token, a.id, s.e2.id);
    assert.deepEqual([r.statusCode, r.json().code], [404, 'APONTAMENTO_ATIVIDADE_NOT_FOUND']);
    await recusa(s, () => A.cancelar(s.token, a.id, { empresa_id: s.e2.id, versao: 1, motivo: 'fazenda errada' }), [404, 'APONTAMENTO_ATIVIDADE_NOT_FOUND', null, null]);
  });
});

// ═══ Exclusão de cadastro com apontamento (R-l) ═════════════════════════════

/**
 * O banco recusa a exclusão (FK RESTRICT do apontamento) e o `errorHandler`
 * traduz o erro REAL em 409 `APONTAMENTO_ATIVIDADE_VINCULADO`, nunca no 403
 * genérico do P2003.
 * @param {Promise<unknown>} promessa @param {string} constraint @param {string} vinculo
 */
const exigirRestrict = async (promessa, constraint, vinculo) => {
  let pego = null;
  try {
    await promessa;
  } catch (e) {
    pego = e;
  }
  assert.ok(pego, `${constraint}: o banco devia recusar`);
  assert.ok(['P2003', 'P2010'].includes(pego.code), `${constraint}: ${pego.code} ${pego.message}`);
  assert.ok(`${JSON.stringify(pego.meta ?? {})} ${pego.message}`.includes(constraint), `${constraint}: ${pego.message}`);
  const traduzido = normalizarErro(pego);
  assert.deepEqual([traduzido.status, traduzido.code, traduzido.details?.vinculo], [409, 'APONTAMENTO_ATIVIDADE_VINCULADO', vinculo]);
};

/** Troca o nome da tabela nova durante `fn` (código no ar antes da migration) e o devolve no fim. */
const semTabelaApontamento = async (fn) => {
  await prisma().$executeRawUnsafe('ALTER TABLE "ApontamentoAtividade" RENAME TO "ApontamentoAtividade_hotfix_tmp"');
  try {
    await fn();
  } finally {
    await prisma().$executeRawUnsafe('ALTER TABLE "ApontamentoAtividade_hotfix_tmp" RENAME TO "ApontamentoAtividade"');
  }
};

describe('D-PROD-190 — exclusão de cadastro com apontamento: FK RESTRICT (R-l)', () => {
  test('AL1: tipo usado → DELETE 409 TIPO_ATIVIDADE_DELETE_BLOCKED (mesmo com o apontamento cancelado); direto no banco, FK RESTRICT', async () => {
    const s = await montar(app);
    const { req } = A;
    const a = await criarOk(s.token, corpo(s));
    assert.equal((await A.cancelar(s.token, a.id, { empresa_id: s.e1.id, versao: 1, motivo: 'cancelado continua sendo histórico' })).statusCode, 200);
    const r = await req('DELETE', `/tipos-atividade/${s.tipo.id}`, s.token);
    assert.deepEqual([r.statusCode, r.json().code], [409, 'TIPO_ATIVIDADE_DELETE_BLOCKED'], r.body);
    assert.equal(await prisma().tipoAtividade.count({ where: { id: s.tipo.id } }), 1);
    await exigirRestrict(prisma().tipoAtividade.delete({ where: { cliente_id_id: { cliente_id: s.c, id: s.tipo.id } } }), 'ApontamentoAtividade_cliente_id_tipo_atividade_id_fkey', 'tipo_atividade_id');
    // Sem apontamento, o outro tipo sai normalmente.
    assert.equal((await req('DELETE', `/tipos-atividade/${s.tipo2.id}`, s.token)).statusCode, 204);
  });

  test('AL2: o grupo do SNAPSHOT continua preso depois que o tipo mudou de grupo → 409 GRUPO_ATIVIDADE_DELETE_BLOCKED', async () => {
    const s = await montar(app);
    const { req, ok } = A;
    const g3 = await ok(req('POST', '/grupos-atividade', s.token, { nome_grupo: 'Aceiros' }), 201);
    const t3 = await ok(req('POST', '/tipos-atividade', s.token, { nome_tipo: 'Aceiro', grupo_atividade_id: g3.id }), 201);
    const a = await criarOk(s.token, corpo(s, { tipo_atividade_id: t3.id }));
    assert.equal(a.grupo_atividade_id, g3.id);
    await ok(req('PATCH', `/tipos-atividade/${t3.id}`, s.token, { grupo_atividade_id: s.grupo2.id }));
    const r = await req('DELETE', `/grupos-atividade/${g3.id}`, s.token);
    assert.deepEqual([r.statusCode, r.json().code], [409, 'GRUPO_ATIVIDADE_DELETE_BLOCKED'], r.body);
    assert.match(r.json().message, /apontamentos de atividade/);
    assert.equal(await prisma().grupoAtividade.count({ where: { id: g3.id } }), 1);
    assert.equal((await linhaDe(a.id)).grupo_atividade_id, g3.id);
  });

  test('AL3: tarefa (a demanda) apontada → DELETE 409 APONTAMENTO_ATIVIDADE_VINCULADO; fazenda com apontamento → 409 EMPRESA_COM_VINCULOS', async () => {
    const s = await montar(app);
    const { req } = A;
    await criarOk(s.token, corpo(s, { lancamento_tarefa_id: s.tarefa1.id }));
    const r = await req('DELETE', `/lancamentos-tarefa/${s.tarefa1.id}`, s.token);
    assert.deepEqual([r.statusCode, r.json().code, r.json().details?.vinculo], [409, 'APONTAMENTO_ATIVIDADE_VINCULADO', 'lancamento_tarefa_id'], r.body);
    assert.equal(await prisma().lancamentoTarefa.count({ where: { id: s.tarefa1.id } }), 1);
    await exigirRestrict(prisma().lancamentoTarefa.delete({ where: { cliente_id_id: { cliente_id: s.c, id: s.tarefa1.id } } }), 'ApontamentoAtividade_cliente_id_lancamento_tarefa_id_fkey', 'lancamento_tarefa_id');

    // Fazenda só com um apontamento: o EMP-01 conta a tabela nova e recusa.
    const so = await prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: 5, fuso_horario: 'America/Sao_Paulo', apelido: 'F5', nome: `Fazenda só apontamento ${randomUUID().slice(0, 6)}` } });
    await criarOk(s.token, corpo(s, { empresa_id: so.id }));
    const e = await req('DELETE', `/empresas/${so.id}`, s.token);
    assert.deepEqual([e.statusCode, e.json().code], [409, 'EMPRESA_COM_VINCULOS'], e.body);
    assert.deepEqual(e.json().details.vinculos, [{ entidade: 'ApontamentoAtividade', total: 1 }]);
    assert.equal(await prisma().empresa.count({ where: { id: so.id } }), 1);
  });

  test('AL4: área, bem, implemento e centros (sem DELETE na API): o banco recusa pela FK RESTRICT e o errorHandler traduz em 409', async () => {
    const s = await montar(app);
    await criarOk(s.token, corpo(s, { bem_id: s.gerador.id, implemento_bem_id: s.rocadeira.id, area_id: s.area1.id, centro_custo_id: s.centroB.id, centro_resultado_id: s.cr1.id }));
    const p = prisma();
    const chave = (id) => ({ cliente_id_id: { cliente_id: s.c, id } });
    await exigirRestrict(p.areaPastagem.delete({ where: chave(s.area1.id) }), 'ApontamentoAtividade_cliente_id_area_id_fkey', 'area_id');
    await exigirRestrict(p.bemPatrimonial.delete({ where: chave(s.gerador.id) }), 'ApontamentoAtividade_bem_fkey', 'bem_id');
    await exigirRestrict(p.bemPatrimonial.delete({ where: chave(s.rocadeira.id) }), 'ApontamentoAtividade_implemento_fkey', 'implemento_bem_id');
    await exigirRestrict(p.centroCusto.delete({ where: chave(s.centroB.id) }), 'ApontamentoAtividade_centro_custo_fkey', 'centro_custo_id');
    await exigirRestrict(p.centroResultado.delete({ where: chave(s.cr1.id) }), 'ApontamentoAtividade_centro_resultado_fkey', 'centro_resultado_id');
    // SQL bruto (P2010/23503) também é reconhecido.
    await exigirRestrict(p.$executeRawUnsafe(`DELETE FROM "AreaPastagem" WHERE cliente_id = '${s.c}' AND id = '${s.area1.id}'`), 'ApontamentoAtividade_cliente_id_area_id_fkey', 'area_id');
    for (const [m, id] of [['areaPastagem', s.area1.id], ['bemPatrimonial', s.gerador.id], ['bemPatrimonial', s.rocadeira.id], ['centroCusto', s.centroB.id], ['centroResultado', s.cr1.id]]) {
      assert.equal(await /** @type {any} */ (p)[m].count({ where: { id } }), 1, `${m} continua`);
    }
  });

  test('AL5 (hotfix #259): sem a tabela nova (código no ar antes da migration), excluir tipo, grupo, tarefa e fazenda segue funcionando', async () => {
    const s = await montar(app);
    const { req, ok } = A;
    const g3 = await ok(req('POST', '/grupos-atividade', s.token, { nome_grupo: 'Sem uso' }), 201);
    const vazia = await prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: 6, fuso_horario: 'America/Sao_Paulo', apelido: 'F6', nome: `Fazenda vazia ${randomUUID().slice(0, 6)}` } });
    await semTabelaApontamento(async () => {
      for (const [rotulo, url] of [
        ['tipo', `/tipos-atividade/${s.tipo2.id}`],
        ['grupo', `/grupos-atividade/${g3.id}`],
        ['tarefa', `/lancamentos-tarefa/${s.tarefa2.id}`],
        ['fazenda', `/empresas/${vazia.id}`],
      ]) {
        const r = await req('DELETE', url, s.token);
        assert.equal(r.statusCode, 204, `${rotulo}: ${r.body}`);
      }
    });
    assert.equal(await prisma().tipoAtividade.count({ where: { id: s.tipo2.id } }), 0);
    assert.equal(await prisma().empresa.count({ where: { id: vazia.id } }), 0);
    assert.equal((await criarOk(s.token, corpo(s))).numero, '1', 'a tabela voltou e o apontamento segue funcionando');
  });

  test('AL6 (hotfix #259): nenhum código fora do módulo do apontamento consulta a tabela nova (nem pelo Prisma, nem por SQL)', () => {
    const raiz = new URL('../src/', import.meta.url);
    const arquivos = /** @type {string[]} */ (readdirSync(raiz, { recursive: true })).filter((f) => /\.(m?js)$/.test(f));
    assert.ok(arquivos.length > 50, 'varreu o backend');
    const consulta = /\.apontamentoAtividade\s*\.|"ApontamentoAtividade"/;
    const fora = arquivos.filter((f) => !f.replaceAll('\\', '/').startsWith('modules/apontamentosAtividade/') && consulta.test(readFileSync(new URL(f, raiz), 'utf8')));
    assert.deepEqual(fora, [], 'módulos antigos dependem da FK RESTRICT, nunca de SELECT na tabela nova');
  });
});

// ═══ Permissão da tela ══════════════════════════════════════════════════════

describe('D-PROD-190 — permissão da tela op-apontamentos-atividade', () => {
  /** Todas as rotas da tela, com corpos VÁLIDOS (o schema roda antes da guarda: 403 = só a autorização barrou). */
  const rotas = (s, id) => [
    ['lista', () => A.lista(s.__tok, s.e1.id)],
    ['detalhe', () => A.detalhe(s.__tok, id, s.e1.id)],
    ['criar', () => A.criar(s.__tok, corpo(s))],
    ['editar', () => A.editar(s.__tok, id, { empresa_id: s.e1.id, versao: 1, observacao: 'x' })],
    ['cancelar', () => A.cancelar(s.__tok, id, { empresa_id: s.e1.id, versao: 1, motivo: 'sem permissão' })],
    ['opções: bens', () => A.opcoes(s.__tok, 'bens', `empresa_id=${s.e1.id}`)],
    ['opções: operadores', () => A.opcoes(s.__tok, 'operadores', `empresa_id=${s.e1.id}`)],
    ['opções: centros de custo', () => A.opcoes(s.__tok, 'centros-custo', `empresa_id=${s.e1.id}`)],
    ['opções: centros de resultado', () => A.opcoes(s.__tok, 'centros-resultado', `empresa_id=${s.e1.id}`)],
  ];

  test('AP1: sem a tela (sem linha, só Tipos de Atividade, ou módulo não liberado) → 403 ACAO_NAO_PERMITIDA em todas as rotas, nada gravado', async () => {
    const s = await montar(app);
    const a = await criarOk(s.token, corpo(s));
    const contas = {
      'sem linha': await s.conta(null),
      'só sup-tipos-atividade': await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaApontamento(Object.fromEntries(ACOES_TELA.map((x) => [x, true])), 'sup-tipos-atividade')] }),
      'módulo não liberado': await s.conta({ modulos_permitidos: ['mapa'], permissoes_telas: [linhaApontamento(Object.fromEntries(ACOES_TELA.map((x) => [x, true])))] }),
      'linha sem visualizar': await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaApontamento({ novo: true, salvar: true, editar: true, excluir: true })] }),
    };
    for (const [nome, conta] of Object.entries(contas)) {
      for (const [rota, chamar] of rotas({ ...s, __tok: conta.token }, a.id)) {
        const antes = await foto(s.c);
        const r = await chamar();
        assert.deepEqual([r.statusCode, r.json().code], [403, 'ACAO_NAO_PERMITIDA'], `${nome} / ${rota}: ${r.body}`);
        assert.equal(await foto(s.c), antes, `${nome} / ${rota}: nada gravado`);
      }
    }
    const sem = await A.lista(null, s.e1.id);
    assert.equal(sem.statusCode, 401, 'sem token');
  });

  test('AP2: visualizar só lê; "novo" cria; "editar" edita; "excluir" cancela; "salvar" cria e edita', async () => {
    const s = await montar(app);
    const leitor = await s.contaApontamento({});
    const criador = await s.contaApontamento({ novo: true });
    const editor = await s.contaApontamento({ editar: true });
    const cancelador = await s.contaApontamento({ excluir: true });
    const salvador = await s.contaApontamento({ salvar: true });
    const a = await criarOk(s.token, corpo(s));

    for (const [rota, chamar] of rotas({ ...s, __tok: leitor.token }, a.id)) {
      const r = await chamar();
      const leitura = ['lista', 'detalhe'].includes(rota) || rota.startsWith('opções');
      assert.equal(r.statusCode, leitura ? 200 : 403, `leitor / ${rota}: ${r.body}`);
    }
    const nego = (r, rotulo) => assert.deepEqual([r.statusCode, r.json().code], [403, 'ACAO_NAO_PERMITIDA'], `${rotulo}: ${r.body}`);

    const c = await criarOk(criador.token, corpo(s));
    assert.equal(c.criado_por.id, criador.id);
    nego(await A.editar(criador.token, c.id, { empresa_id: s.e1.id, versao: 1, observacao: 'x' }), 'novo não edita');
    nego(await A.cancelar(criador.token, c.id, { empresa_id: s.e1.id, versao: 1, motivo: 'não pode' }), 'novo não cancela');

    nego(await A.criar(editor.token, corpo(s)), 'editar não cria');
    assert.equal((await editarOk(editor.token, c.id, { empresa_id: s.e1.id, versao: 1, observacao: 'editado' })).versao, 2);
    nego(await A.cancelar(editor.token, c.id, { empresa_id: s.e1.id, versao: 2, motivo: 'não pode' }), 'editar não cancela');

    nego(await A.criar(cancelador.token, corpo(s)), 'excluir não cria');
    nego(await A.editar(cancelador.token, c.id, { empresa_id: s.e1.id, versao: 2, observacao: 'x' }), 'excluir não edita');
    const cancelado = await A.cancelar(cancelador.token, c.id, { empresa_id: s.e1.id, versao: 2, motivo: 'cancelado por quem pode' });
    assert.equal(cancelado.statusCode, 200, cancelado.body);

    const d = await criarOk(salvador.token, corpo(s));
    assert.equal((await editarOk(salvador.token, d.id, { empresa_id: s.e1.id, versao: 1, observacao: 'salvo' })).observacao, 'salvo');
    nego(await A.cancelar(salvador.token, d.id, { empresa_id: s.e1.id, versao: 2, motivo: 'não pode' }), 'salvar não cancela');
  });
});

// ═══ Lista keyset, filtros e opções ═════════════════════════════════════════

describe('D-PROD-190 — lista keyset com filtros e opções da tela', () => {
  test('AK1: keyset (createdAt desc, id desc) com limit e cursor; total; filtros por período, bem, implemento, tipo, área, tarefa, status e número', async () => {
    const s = await montar(app);
    const a1 = await criarOk(s.token, corpo(s, { data_operacional: '2027-06-01', bem_id: s.trator.id, area_id: s.area1.id }));
    const a2 = await criarOk(s.token, corpo(s, { data_operacional: '2027-06-05', tipo_atividade_id: s.tipo2.id, bem_id: s.trator.id, implemento_bem_id: s.rocadeira.id, lancamento_tarefa_id: s.tarefa1.id }));
    const a3 = await criarOk(s.token, corpo(s, { data_operacional: '2027-06-10' }));
    const a4 = await criarOk(s.token, corpo(s, { data_operacional: '2027-06-12', tipo_atividade_id: s.tipo2.id, bem_id: s.gerador.id }));
    const a5 = await criarOk(s.token, corpo(s, { data_operacional: HOJE, area_id: s.area1.id }));
    await criarOk(s.token, corpo(s, { empresa_id: s.e2.id, bem_id: s.trator2.id }));
    assert.equal((await A.cancelar(s.token, a5.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado errado' })).statusCode, 200);

    const ordem = (await prisma().apontamentoAtividade.findMany({ where: { cliente_id: s.c, empresa_id: s.e1.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } })).map((x) => x.id);
    assert.deepEqual(ordem, [a5.id, a4.id, a3.id, a2.id, a1.id], 'criados em sequência');

    // Paginação: 2 + 2 + 1, sem repetir nem pular.
    const vistos = [];
    let cursor = null;
    let paginas = 0;
    do {
      const r = await A.lista(s.token, s.e1.id, `&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(r.statusCode, 200, r.body);
      const pg = r.json();
      assert.equal(pg.total, 5);
      assert.equal(pg.limit, 2);
      for (const item of pg.items) assert.deepEqual(Object.keys(item).sort(), [...CAMPOS_PUBLICOS]);
      vistos.push(...pg.items.map((x) => x.id));
      assert.equal(pg.has_more, Boolean(pg.next_cursor));
      cursor = pg.next_cursor;
      paginas += 1;
    } while (cursor && paginas < 10);
    assert.equal(paginas, 3);
    assert.deepEqual(vistos, ordem);

    const ids = async (filtro) => {
      const r = await A.lista(s.token, s.e1.id, filtro);
      assert.equal(r.statusCode, 200, `${filtro}: ${r.body}`);
      return r.json().items.map((x) => x.id);
    };
    assert.deepEqual(await ids('&data_de=2027-06-05&data_ate=2027-06-12'), [a4.id, a3.id, a2.id]);
    assert.deepEqual(await ids('&data_de=2027-06-12'), [a5.id, a4.id]);
    assert.deepEqual(await ids('&data_ate=2027-06-01'), [a1.id]);
    assert.deepEqual(await ids(`&bem_id=${s.trator.id}`), [a2.id, a1.id]);
    assert.deepEqual(await ids(`&implemento_bem_id=${s.rocadeira.id}`), [a2.id]);
    assert.deepEqual(await ids(`&tipo_atividade_id=${s.tipo2.id}`), [a4.id, a2.id]);
    assert.deepEqual(await ids(`&area_id=${s.area1.id}`), [a5.id, a1.id]);
    assert.deepEqual(await ids(`&lancamento_tarefa_id=${s.tarefa1.id}`), [a2.id]);
    assert.deepEqual(await ids('&status=CANCELADO'), [a5.id]);
    assert.deepEqual(await ids('&status=CONFIRMADO'), [a4.id, a3.id, a2.id, a1.id]);
    assert.deepEqual(await ids(`&q=${a3.numero}`), [a3.id]);
    assert.deepEqual(await ids(`&tipo_atividade_id=${s.tipo2.id}&data_ate=2027-06-10`), [a2.id]);
    assert.deepEqual(await ids(`&bem_id=${s.trator2.id}`), [], 'bem da outra fazenda: nada nesta');
    const filtrada = (await A.lista(s.token, s.e1.id, `&bem_id=${s.trator.id}&limit=1`)).json();
    assert.deepEqual([filtrada.total, filtrada.has_more, filtrada.items.map((x) => x.id)], [2, true, [a2.id]], 'total e keyset respeitam o filtro');
  });

  test('AK2: período invertido, data inexistente, cursor adulterado, status fora do domínio, cliente_id e empresa ausente → 400', async () => {
    const s = await montar(app);
    await criarOk(s.token, corpo(s));
    for (const filtro of ['&data_de=2027-06-10&data_ate=2027-06-01', '&data_de=2027-02-30', '&cursor=nao-e-cursor', '&status=APAGADO', '&cliente_id=outro', '&limit=0', '&limit=501']) {
      const r = await A.lista(s.token, s.e1.id, filtro);
      assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${filtro}: ${r.body}`);
    }
    const semEmpresa = await A.req('GET', '/apontamentos-atividade', s.token);
    assert.deepEqual([semEmpresa.statusCode, semEmpresa.json().code], [400, 'REQUEST_VALIDATION_FAILED']);
  });

  test('AO1: opções da tela — bens ATIVOS da fazenda com o centro de custo do cadastro só quando ATIVO; operadores só {id, nome}; centros ATIVOS da fazenda', async () => {
    const s = await montar(app);
    const { req, ok } = A;
    const g = await ok(req('GET', `/bens-patrimoniais/${s.gerador.id}?empresa_id=${s.e1.id}`, s.token));
    await ok(req('PATCH', `/bens-patrimoniais/${s.gerador.id}`, s.token, { empresa_id: s.e1.id, versao: g.versao, ativo: false }));
    const bens = await ok(A.opcoes(s.token, 'bens', `empresa_id=${s.e1.id}`));
    assert.deepEqual(bens.itens.map((b) => b.id).sort(), [s.trator.id, s.rocadeira.id].sort(), 'só ativos da fazenda 1');
    for (const b of bens.itens) assert.deepEqual(Object.keys(b).sort(), ['centro_custo', 'codigo_frota', 'id', 'natureza', 'nome', 'numero']);
    const opcao = (lista, id) => lista.itens.find((b) => b.id === id);
    assert.deepEqual(opcao(bens, s.trator.id), {
      id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA',
      centro_custo: { id: s.centro1.id, numero: s.centro1.numero, nome: s.centro1.nome },
    }, 'bem com centro ATIVO: {id, numero, nome} do centro');
    assert.equal(opcao(bens, s.rocadeira.id).centro_custo, null, 'bem sem centro: null');
    const bens2 = await ok(A.opcoes(s.token, 'bens', `empresa_id=${s.e2.id}`));
    assert.deepEqual(bens2.itens.map((b) => [b.id, b.centro_custo?.id ?? null]), [[s.trator2.id, s.centro2.id]], 'fazenda 2: o centro da fazenda 2');
    // Centro do bem inativado: a opção sai sem centro (e a criação não o copia); reativado, volta.
    await prisma().centroCusto.update({ where: { id: s.centro1.id }, data: { ativo: false } });
    assert.equal(opcao(await ok(A.opcoes(s.token, 'bens', `empresa_id=${s.e1.id}`)), s.trator.id).centro_custo, null, 'centro inativo: null');
    assert.equal((await criarOk(s.token, corpo(s, { bem_id: s.trator.id }))).centro_custo_id, null, 'a criação segue a mesma regra');
    await prisma().centroCusto.update({ where: { id: s.centro1.id }, data: { ativo: true } });
    assert.equal(opcao(await ok(A.opcoes(s.token, 'bens', `empresa_id=${s.e1.id}`)), s.trator.id).centro_custo?.id, s.centro1.id, 'reativado: volta');
    const implementos = await ok(A.opcoes(s.token, 'bens', `empresa_id=${s.e1.id}&natureza=${encodeURIComponent(bens.itens.find((b) => b.id === s.rocadeira.id).natureza)}`));
    assert.deepEqual(implementos.itens.map((b) => b.id), [s.rocadeira.id]);

    const operadores = await ok(A.opcoes(s.token, 'operadores', `empresa_id=${s.e1.id}`));
    assert.ok(operadores.itens.some((u) => u.id === s.operador.id));
    for (const u of operadores.itens) assert.deepEqual(Object.keys(u).sort(), ['id', 'nome']);
    assert.ok(!JSON.stringify(operadores).includes(s.operador.login), 'login nunca sai');

    const custo = await ok(A.opcoes(s.token, 'centros-custo', `empresa_id=${s.e1.id}`));
    assert.deepEqual(custo.itens.map((c) => c.id).sort(), [s.centro1.id, s.centroB.id].sort());
    const resultado = await ok(A.opcoes(s.token, 'centros-resultado', `empresa_id=${s.e1.id}`));
    assert.deepEqual(resultado.itens.map((c) => c.id), [s.cr1.id]);
    assert.deepEqual(Object.keys(resultado.itens[0]).sort(), ['id', 'nome', 'numero']);
  });
});

// ═══ O banco é a última rede ════════════════════════════════════════════════

describe('D-PROD-190 — o banco é a última rede', () => {
  test('AS1: escrita DIRETA com bem, implemento ou centros de outra fazenda, ou tipo de outro tenant, é recusada pelas FKs compostas', async () => {
    const s = await montar(app);
    const p = prisma();
    const sufixo = randomUUID().slice(0, 6);
    const outro = await p.cliente.create({ data: { codigo: `ap-${sufixo}`, nome: `Outro tenant ${sufixo}` } });
    const gOutro = await p.grupoAtividade.create({ data: { cliente_id: outro.id, nome_grupo: 'G' } });
    const tOutro = await p.tipoAtividade.create({ data: { cliente_id: outro.id, nome_tipo: 'T', grupo_atividade_id: gOutro.id, grupo_atividade_nome: 'G' } });
    const base = {
      cliente_id: s.c, empresa_id: s.e1.id, numero: `X-${sufixo}`, tipo_atividade_id: s.tipo.id, tipo_atividade_nome: 'X', grupo_atividade_id: s.grupo.id,
      grupo_atividade_nome: 'X', data_operacional: new Date(`${DIA}T00:00:00.000Z`),
    };
    const antes = await foto(s.c);
    for (const [campo, valor, fk] of [
      ['bem_id', s.trator2.id, 'ApontamentoAtividade_bem_fkey'],
      ['implemento_bem_id', s.trator2.id, 'ApontamentoAtividade_implemento_fkey'],
      ['centro_custo_id', s.centro2.id, 'ApontamentoAtividade_centro_custo_fkey'],
      ['centro_resultado_id', s.cr2.id, 'ApontamentoAtividade_centro_resultado_fkey'],
      ['tipo_atividade_id', tOutro.id, 'ApontamentoAtividade_cliente_id_tipo_atividade_id_fkey'],
      ['grupo_atividade_id', gOutro.id, 'ApontamentoAtividade_cliente_id_grupo_atividade_id_fkey'],
      ['operador_usuario_id', 'usuario-que-nao-existe', 'ApontamentoAtividade_operador_fkey'],
    ]) {
      await assert.rejects(
        p.apontamentoAtividade.create({ data: { ...base, [campo]: valor } }),
        (e) => e?.code === 'P2003' && `${JSON.stringify(e.meta ?? {})} ${e.message}`.includes(fk),
        `${campo}: ${fk}`
      );
    }
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // Controle positivo: a mesma linha, coerente, entra.
    const ok = await p.apontamentoAtividade.create({ data: base });
    assert.deepEqual([ok.status, ok.versao], ['CONFIRMADO', 1], 'defaults do banco');
  });

  test('AS2: RLS ligado sem FORCE e zero grants para PUBLIC/anon/authenticated; o DO EXATO da migration revoga o GRANT hostil e cria maike_backend_all só para maike_vercel (transação desfeita)', async () => {
    const p = prisma();
    const T = 'ApontamentoAtividade';
    const [rls] = /** @type {any[]} */ (await p.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = ${T}`);
    assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, false]);
    const grants = /** @type {any[]} */ (await p.$queryRaw`
      SELECT a.grantee::regrole::text AS grantee, a.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ${T}
         AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`);
    assert.deepEqual(grants, [], 'nenhum privilégio para PUBLIC, anon ou authenticated');

    const sql = readFileSync(new URL('../prisma/migrations/20261113700000_apontamento_atividade/migration.sql', import.meta.url), 'utf8');
    const blocos = (sql.match(/^DO \$\$[\s\S]*?^END \$\$;/gm) ?? []).filter((b) => b.includes("pol_name constant text := 'maike_backend_all'"));
    assert.equal(blocos.length, 1, 'a migration tem exatamente um bloco DO de REVOKE/RLS');
    assert.ok(blocos[0].includes(`ARRAY['${T}']`), 'o DO cobre exatamente a tabela nova');
    const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
    const papeisAntes = /** @type {any[]} */ (await p.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'maike_vercel') ORDER BY 1`);
    const DESFAZER = new Error('rollback proposital do AS2');
    /** @type {any} */
    let visto = null;
    const pode = async (tx) => {
      const linhas = [];
      for (const papel of ['anon', 'authenticated']) {
        const [r] = /** @type {any[]} */ (await tx.$queryRawUnsafe(`SELECT has_table_privilege('${papel}', 'public."${T}"', '${PRIVS}') AS pode`));
        linhas.push([papel, r.pode]);
      }
      return linhas;
    };
    await p
      .$transaction(async (tx) => {
        for (const papel of ['anon', 'authenticated', 'maike_vercel']) {
          await tx.$executeRawUnsafe(`DO $papel$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${papel}') THEN CREATE ROLE ${papel} NOLOGIN; END IF; END $papel$`);
        }
        await tx.$executeRawUnsafe(`GRANT ALL ON TABLE public."${T}" TO anon, authenticated`);
        const controle = await pode(tx);
        await tx.$executeRawUnsafe(blocos[0]);
        const depois = await pode(tx);
        const politicas = /** @type {any[]} */ (await tx.$queryRaw`SELECT cmd, array_to_string(roles, ',') AS roles, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'maike_backend_all' AND tablename = ${T}`);
        visto = { controle, depois, politicas };
        throw DESFAZER;
      }, { timeout: 20000 })
      .catch((e) => {
        if (e !== DESFAZER) throw e;
      });
    assert.ok(visto, 'a transação chegou ao fim');
    assert.deepEqual(visto.controle, [['anon', true], ['authenticated', true]], 'controle negativo: o GRANT simulado vale antes do DO');
    assert.deepEqual(visto.depois, [['anon', false], ['authenticated', false]], 'o DO revoga anon/authenticated');
    assert.deepEqual(visto.politicas.map((x) => [x.cmd, x.roles, x.qual, x.with_check]), [['ALL', 'maike_vercel', 'true', 'true']]);
    const papeisDepois = /** @type {any[]} */ (await p.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'maike_vercel') ORDER BY 1`);
    assert.deepEqual(papeisDepois, papeisAntes, 'nenhum papel criado sobrevive ao ROLLBACK');
  });
});
