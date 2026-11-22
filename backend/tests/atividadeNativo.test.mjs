/**
 * D-PROD-200 (Fatia 2 do Lançamento de Atividades) — o CABEÇALHO da atividade
 * (`/atividades`), contra PostgreSQL real e HTTP autenticado (`app.inject`).
 * Contrato: docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md (§3, §4, §5,
 * §8 e §10).
 *
 * Cobre: abrir com os snapshots do tipo (centros só da mesma fazenda e ativos,
 * unidade com a sigla) e o setor herdado da área; o travamento (corpo recusa o
 * que é herdado, tipo imutável, centros e unidade nunca mudam, snapshot nunca
 * relido); as flags do tipo na abertura, na edição e na conclusão; tipo e grupo
 * inativos; datas; numeração contínua com o contador `Atividade` (inclusive o
 * que a conversão deixou em 3); concluir, reabrir (permissão própria, motivo,
 * auditoria a cada reabertura), cancelar (propaga aos apontamentos e zera os
 * totais) e duplicar; CAS por versão e corridas; lista keyset com filtros;
 * isolamento por tenant (404, nunca 403) e por fazenda; opções; e a exclusão
 * de cadastro usado por atividade (409, nunca o 403 genérico — lição da #259).
 *
 * Os apontamentos têm a suíte própria (`atividadeApontamentoNativo.test.mjs`);
 * aqui eles entram só onde mexem no cabeçalho.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { HOJE, erro, http, montarPatrimonio, prisma, corpoCaminhonete, corpoGerador, corpoImplemento, corpoTrator } from './patrimonioP1Cenario.mjs';
import { normalizarErro } from '../src/shared/errors/errorHandler.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

/** Os campos da atividade, na ordem do contrato (§10). */
const CAMPOS_PUBLICOS = [
  'id', 'empresa_id', 'numero', 'nome', 'status', 'versao',
  'tipo_atividade_id', 'tipo_atividade_nome', 'grupo_atividade_id', 'grupo_atividade_nome',
  'area_id', 'area', 'setor_id', 'setor_nome',
  'bem_id', 'bem', 'safra_ciclo',
  'centro_custo_id', 'centro_custo', 'centro_resultado_id', 'centro_resultado',
  'unidade_producao_id', 'unidade_producao_sigla', 'unidade_producao',
  'data_inicio', 'data_prevista_fim', 'data_conclusao',
  'area_planejada', 'area_executada', 'quantidade_produzida',
  'lancamento_tarefa_id', 'lancamento_tarefa', 'observacao',
  'concluida_em', 'concluida_por', 'cancelada_em', 'cancelado_por', 'motivo_cancelamento',
  'reaberta_em', 'reaberta_por', 'motivo_reabertura', 'criado_por', 'createdAt', 'updatedAt',
  // D-PROD-249: as áreas da atividade (várias áreas) e quantas são.
  'areas', 'areas_count',
  // D-PROD-273: o local do serviço sem área (Manutenção e Outros) e os dados do Plantio de pastagem (nulos aqui).
  'local', 'plantio',
];
const TOTAIS_VAZIOS = Object.freeze({ apontamentos_confirmados: 0, apontamentos_cancelados: 0, dias_com_apontamento: 0 });
// O DETALHE é a forma pública + `totais` e, D-PROD-273 (ajuste do teste de ponta a ponta), o "pasto liberado em"
// calculado na leitura (`pasto_liberado_em`, `carencia_dias`; nulos sem produto com carência).

const MODULO = 'suporte-mapa';
const TELA = 'op-atividades';
const ACOES = ['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar', 'reabrir', 'lancar_apontamento', 'editar_apontamento', 'cancelar_apontamento'];
/** Linha da tela `op-atividades` com só as ações dadas ligadas. */
const linhaAtividades = (ligadas = {}) => ({ modulo_id: MODULO, tela_id: TELA, ...Object.fromEntries(ACOES.map((a) => [a, false])), ...ligadas });

/**
 * Cenário: tenant com 2 fazendas (fuso de São Paulo), área com setor em cada
 * uma, centro de custo da fazenda 1, centro de resultado da fazenda 1, unidade
 * HA, um grupo e quatro tipos (com padrões; livre; com as 3 flags da abertura;
 * com `exige_producao`), um trator em cada fazenda e uma tarefa em cada fazenda.
 */
const montar = async () => {
  const s = await montarPatrimonio(app);
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `PASTAGEM ${suf}` } });
  const cr1 = await p.centroResultado.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: `CR1-${suf}`, nome: 'Pecuária' } });
  const un = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: `U-${suf}`, sigla: 'HA', descricao: 'Hectare' } });
  const tipoDe = (nome_tipo, extra = {}) =>
    p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, ...extra } });
  const tipo = await tipoDe('CIGARRINHA', { centro_custo_padrao_id: s.centro1.id, centro_resultado_padrao_id: cr1.id, unidade_producao_id: un.id });
  const tipoLivre = await tipoDe('ROÇADA');
  const tipoExige = await tipoDe('PLANTIO', { exige_area: true, exige_safra: true, exige_maquina: true });
  const tipoProducao = await tipoDe('COLHEITA', { exige_producao: true });
  const trator = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s)), 201);
  const trator2 = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { empresa_id: s.e2.id, codigo_frota: 'TP-09' })), 201);
  // Implemento (natureza IMPLEMENTO), ativo e da mesma fazenda: não é máquina da atividade.
  const implemento = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s)), 201);
  const tipoTarefa = await p.tipoTarefa.create({ data: { cliente_id: s.c, nome_tipo: `ROÇAR ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
  const tarefa = (empresa, titulo) =>
    H.ok(H.req('POST', '/lancamentos-tarefa', s.token, { empresa_id: empresa.id, titulo, tipo: 'Manejo', tipo_tarefa_id: tipoTarefa.id, data_pedido: '2027-06-01' }), 201);
  const tarefa1 = await tarefa(s.e1, 'Roçar o retiro');
  const tarefa2 = await tarefa(s.e2, 'Roçar a sede 2');
  return { ...s, grupo, cr1, un, tipo, tipoLivre, tipoExige, tipoProducao, trator, trator2, implemento, tarefa1, tarefa2 };
};

/** @typedef {Awaited<ReturnType<typeof montar>>} Cenario */

/** @param {Cenario} s */
const abrir = (s, extra = {}, token = s.token) => H.req('POST', '/atividades', token, { empresa_id: s.e1.id, nome: 'Cigarrinha Pasto 01', tipo_atividade_id: s.tipo.id, ...extra });
/** @param {Cenario} s */
const abrirOk = async (s, extra = {}) => {
  const r = await abrir(s, extra);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const patch = (s, a, corpo, token = s.token) => H.req('PATCH', `/atividades/${a.id}`, token, corpo);
const acao = (s, a, nome, corpo = {}, token = s.token) => H.req('POST', `/atividades/${a.id}/${nome}`, token, { empresa_id: a.empresa_id, ...corpo });
const detalhe = (s, a, token = s.token) => H.ok(H.req('GET', `/atividades/${a.id}?empresa_id=${a.empresa_id}`, token));

/** Apontamento gravado direto no banco (só para o que mexe no cabeçalho). */
const apontar = (s, atividade, extra = {}) =>
  prisma().atividadeApontamento.create({
    data: { cliente_id: s.c, empresa_id: atividade.empresa_id, atividade_id: atividade.id, data_operacional: new Date('2027-06-10T00:00:00Z'), sequencia: 1, ...extra },
  });

const contarAtividades = (c) => prisma().atividade.count({ where: { cliente_id: c } });
const auditoria = (c, acaoAuditada) => prisma().auditLog.findMany({ where: { cliente_id: c, acao: acaoAuditada }, orderBy: { createdAt: 'asc' } });
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** Atividades, apontamentos, sequências e auditoria do tenant: prova de "nada gravado". */
const foto = async (c) => {
  const p = prisma();
  return JSON.stringify({
    at: await p.atividade.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    ap: await p.atividadeApontamento.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    sq: await p.entidadeCodigoSequencia.findMany({ where: { cliente_id: c, entidade: 'Atividade' } }),
    au: await p.auditLog.findMany({ where: { cliente_id: c, entidade: 'Atividade' }, orderBy: { id: 'asc' } }),
  }, replacer);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('abrir: herança do tipo e setor da área', () => {
  test('201: forma do §10, número do contador, snapshots do tipo, setor herdado da área, hoje da fazenda, auditoria sem texto livre', async () => {
    const s = await montar();
    const a = await abrirOk(s, { area_id: s.area1.id, bem_id: s.trator.id, safra_ciclo: '2026/2027', area_planejada: '12.5', lancamento_tarefa_id: s.tarefa1.id, observacao: 'texto do operador' });
    assert.deepEqual(Object.keys(a), [...CAMPOS_PUBLICOS, 'totais', 'pasto_liberado_em', 'carencia_dias']);
    assert.deepEqual([a.numero, a.status, a.versao, a.empresa_id, a.data_inicio, a.data_prevista_fim, a.data_conclusao], ['1', 'ABERTA', 1, s.e1.id, HOJE, null, null]);
    // Snapshots do tipo e do grupo.
    assert.deepEqual([a.tipo_atividade_id, a.tipo_atividade_nome, a.grupo_atividade_id, a.grupo_atividade_nome], [s.tipo.id, 'CIGARRINHA', s.grupo.id, s.grupo.nome_grupo]);
    // Herança dos padrões do tipo: centros da mesma fazenda e ativos; unidade com a sigla.
    assert.equal(a.centro_custo_id, s.centro1.id);
    assert.deepEqual(a.centro_custo, { id: s.centro1.id, numero: s.centro1.numero, nome: s.centro1.nome });
    assert.equal(a.centro_resultado_id, s.cr1.id);
    assert.deepEqual(a.centro_resultado, { id: s.cr1.id, numero: s.cr1.numero, nome: 'Pecuária' });
    assert.deepEqual([a.unidade_producao_id, a.unidade_producao_sigla], [s.un.id, 'HA']);
    assert.deepEqual(a.unidade_producao, { id: s.un.id, sigla: 'HA', descricao: 'Hectare' });
    // Setor herdado da área (nunca vem no corpo).
    assert.deepEqual([a.setor_id, a.setor_nome], [s.area1.setor_id, s.area1.setor_nome]);
    assert.deepEqual(a.area, { id: s.area1.id, numero_area: s.area1.numero_area, nome: 'Retiro' });
    assert.deepEqual(a.bem, { id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA' });
    assert.deepEqual([a.safra_ciclo, a.area_planejada, a.area_executada, a.quantidade_produzida, a.observacao], ['2026/2027', '12.5000', null, null, 'texto do operador']);
    assert.deepEqual(a.lancamento_tarefa, { id: s.tarefa1.id, titulo: 'Roçar o retiro', status: s.tarefa1.status });
    assert.deepEqual(a.totais, TOTAIS_VAZIOS);
    assert.deepEqual(a.criado_por, { id: s.adm.usuario.id, nome: s.adm.usuario.nome });
    for (const k of ['concluida_em', 'concluida_por', 'cancelada_em', 'cancelado_por', 'motivo_cancelamento', 'reaberta_em', 'reaberta_por', 'motivo_reabertura']) assert.equal(a[k], null, k);
    // Linha no banco: tenant da sessão.
    const linha = await prisma().atividade.findUnique({ where: { id: a.id } });
    assert.equal(linha.cliente_id, s.c);
    assert.equal(linha.criado_por_usuario_id, s.adm.usuario.id);
    // Auditoria: sem o texto livre.
    const eventos = await auditoria(s.c, 'atividade.abrir');
    assert.equal(eventos.length, 1);
    assert.deepEqual([eventos[0].entidade, eventos[0].entidade_id], ['Atividade', a.id]);
    assert.equal(eventos[0].dados_novos.tem_observacao, true);
    assert.equal(JSON.stringify(eventos[0]).includes('texto do operador'), false, 'sem texto livre na auditoria');
  });

  test('herança: centro de outra fazenda e centro/unidade inativos não são herdados (ficam nulos)', async () => {
    const s = await montar();
    const p = prisma();
    // Na fazenda 2, os centros padrão do tipo (da fazenda 1) não valem; a unidade é do tenant e vale.
    const e2 = await abrirOk(s, { empresa_id: s.e2.id });
    assert.deepEqual([e2.centro_custo_id, e2.centro_custo, e2.centro_resultado_id, e2.centro_resultado, e2.unidade_producao_id, e2.unidade_producao_sigla], [null, null, null, null, s.un.id, 'HA']);
    // Centro de custo e unidade inativos: nulos; o centro de resultado ativo segue.
    await p.centroCusto.update({ where: { id: s.centro1.id }, data: { ativo: false } });
    await p.unidadeMedida.update({ where: { id: s.un.id }, data: { ativo: false } });
    const a = await abrirOk(s);
    assert.deepEqual([a.centro_custo_id, a.centro_resultado_id, a.unidade_producao_id, a.unidade_producao_sigla, a.unidade_producao], [null, s.cr1.id, null, null, null]);
    // Centro de resultado inativo também.
    await p.centroResultado.update({ where: { id: s.cr1.id }, data: { ativo: false } });
    const b = await abrirOk(s);
    assert.deepEqual([b.centro_custo_id, b.centro_resultado_id], [null, null]);
    // Tipo sem padrões: tudo nulo.
    const livre = await abrirOk(s, { tipo_atividade_id: s.tipoLivre.id });
    assert.deepEqual([livre.centro_custo_id, livre.centro_resultado_id, livre.unidade_producao_id, livre.unidade_producao_sigla], [null, null, null, null]);
  });

  test('travamento: o corpo recusa o que é herdado ou derivado (setor, centros, unidade, snapshots, número, status, autoria, totais, tenant) → 400, nada gravado', async () => {
    const s = await montar();
    const antes = await foto(s.c);
    const herdados = {
      setor_id: s.area1.setor_id, setor_nome: 'x', centro_custo_id: s.centro1.id, centro_resultado_id: s.cr1.id,
      unidade_producao_id: s.un.id, unidade_producao_sigla: 'HA', tipo_atividade_nome: 'x', grupo_atividade_id: s.grupo.id, grupo_atividade_nome: 'x',
      numero: '99', status: 'CONCLUIDA', versao: 7, criado_por_usuario_id: s.adm.usuario.id, area_executada: '1', quantidade_produzida: '1',
      cliente_id: s.c, id: 'atv_x', concluida_em: '2027-06-01T00:00:00.000Z',
    };
    for (const [campo, valor] of Object.entries(herdados)) {
      const r = await abrir(s, { [campo]: valor });
      assert.deepEqual(erro(r).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], `${campo}: ${r.body}`);
    }
    // Decimal só como texto (sem coerção do AJV); negativo e lixo também são 400.
    assert.deepEqual(erro(await abrir(s, { area_planejada: 12.5 })), [400, 'REQUEST_VALIDATION_FAILED', 'area_planejada', 'valor_deve_ser_texto']);
    for (const v of ['-1', 'abc', '1,5']) assert.deepEqual(erro(await abrir(s, { area_planejada: v })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], v);
    // Obrigatórios.
    for (const campo of ['empresa_id', 'nome', 'tipo_atividade_id']) {
      const corpo = { empresa_id: s.e1.id, nome: 'x', tipo_atividade_id: s.tipo.id };
      delete corpo[campo];
      assert.deepEqual(erro(await H.req('POST', '/atividades', s.token, corpo)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], campo);
    }
    assert.deepEqual(erro(await abrir(s, { nome: '   ' })), [400, 'REQUEST_VALIDATION_FAILED', 'nome', 'obrigatorio']);
    assert.deepEqual(erro(await abrir(s, { nome: 'x'.repeat(121) })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.equal(await foto(s.c), antes, 'nada gravado, nenhum número consumido');
  });

  test('tipo inexistente, inativo ou de grupo inativo recusa; referências de outra fazenda, inexistentes ou inativas recusam; nenhum número consumido', async () => {
    const s = await montar();
    const p = prisma();
    const outro = await montarPatrimonio(app, { catalogo: false });
    const grupoOutro = await p.grupoAtividade.create({ data: { cliente_id: outro.c, nome_grupo: 'G' } });
    const tipoOutro = await p.tipoAtividade.create({ data: { cliente_id: outro.c, nome_tipo: 'DE FORA', grupo_atividade_id: grupoOutro.id, grupo_atividade_nome: 'G' } });
    await p.tipoAtividade.update({ where: { id: s.tipoLivre.id }, data: { ativo: false } });
    const antes = await foto(s.c);
    const casos = [
      [{ tipo_atividade_id: 'nao-existe' }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'tipo_atividade_id', 'inexistente']],
      [{ tipo_atividade_id: tipoOutro.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'tipo_atividade_id', 'inexistente']],
      [{ tipo_atividade_id: s.tipoLivre.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'tipo_atividade_id', 'inativo']],
      [{ area_id: s.area2.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'outra_empresa']],
      [{ area_id: outro.area1.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'inexistente']],
      [{ area_id: 'nao-existe' }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'inexistente']],
      [{ bem_id: s.trator2.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'outra_empresa']],
      [{ bem_id: 'nao-existe' }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'inexistente']],
      [{ bem_id: s.implemento.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'natureza']],
      [{ lancamento_tarefa_id: s.tarefa2.id }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'lancamento_tarefa_id', 'outra_empresa']],
      [{ lancamento_tarefa_id: 'nao-existe' }, [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'lancamento_tarefa_id', 'inexistente']],
    ];
    for (const [extra, esperado] of casos) {
      const r = await abrir(s, extra);
      assert.deepEqual(erro(r), esperado, `${JSON.stringify(extra)} ${r.body}`);
    }
    // Grupo do tipo inativo.
    await p.grupoAtividade.update({ where: { id: s.grupo.id }, data: { ativo: false } });
    assert.deepEqual(erro(await abrir(s)), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'tipo_atividade_id', 'grupo_inativo']);
    await p.grupoAtividade.update({ where: { id: s.grupo.id }, data: { ativo: true } });
    // Área e máquina inativas.
    await p.areaPastagem.update({ where: { id: s.area1.id }, data: { ativo: false } });
    assert.deepEqual(erro(await abrir(s, { area_id: s.area1.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'inativo']);
    await p.bemPatrimonial.update({ where: { id: s.trator.id }, data: { ativo: false } });
    assert.deepEqual(erro(await abrir(s, { bem_id: s.trator.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'inativo']);
    assert.equal(await foto(s.c), antes, 'nada gravado');
    assert.equal((await abrirOk(s)).numero, '1', 'nenhuma recusa consumiu número');
  });

  test('flags na abertura: exige_area, exige_safra e exige_maquina → 422 ATIVIDADE_EXIGIDA_PELO_TIPO; satisfeitas, abre', async () => {
    const s = await montar();
    const corpo = { tipo_atividade_id: s.tipoExige.id };
    assert.deepEqual(erro(await abrir(s, corpo)), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'area_id', 'exige_area']);
    assert.deepEqual(erro(await abrir(s, { ...corpo, area_id: s.area1.id })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'safra_ciclo', 'exige_safra']);
    assert.deepEqual(erro(await abrir(s, { ...corpo, area_id: s.area1.id, safra_ciclo: '   ' })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'safra_ciclo', 'exige_safra'], 'safra só de espaços não vale');
    assert.deepEqual(erro(await abrir(s, { ...corpo, area_id: s.area1.id, safra_ciclo: '26/27' })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'bem_id', 'exige_maquina']);
    // Cada flag sozinha.
    const p = prisma();
    for (const [flag, campo] of [['exige_area', 'area_id'], ['exige_safra', 'safra_ciclo'], ['exige_maquina', 'bem_id']]) {
      const t = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `SO ${flag}`, grupo_atividade_id: s.grupo.id, grupo_atividade_nome: s.grupo.nome_grupo, [flag]: true } });
      assert.deepEqual(erro(await abrir(s, { tipo_atividade_id: t.id })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', campo, flag]);
    }
    assert.equal(await contarAtividades(s.c), 0);
    const a = await abrirOk(s, { ...corpo, area_id: s.area1.id, safra_ciclo: '26/27', bem_id: s.trator.id });
    assert.deepEqual([a.status, a.area_id, a.safra_ciclo, a.bem_id], ['ABERTA', s.area1.id, '26/27', s.trator.id]);
  });

  test('datas: data_inicio padrão hoje e nunca futura; data_prevista_fim ≥ data_inicio; data inexistente → 422', async () => {
    const s = await montar();
    assert.deepEqual(erro(await abrir(s, { data_inicio: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'futura']);
    assert.deepEqual(erro(await abrir(s, { data_inicio: '2027-02-30' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'data_inexistente']);
    assert.deepEqual(erro(await abrir(s, { data_inicio: '2027-06-10', data_prevista_fim: '2027-06-09' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_prevista_fim', 'periodo_invertido']);
    assert.deepEqual(erro(await abrir(s, { data_inicio: '15/06/2027' })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.equal(await contarAtividades(s.c), 0);
    // Hoje vale; fim previsto pode ser futuro; fim = início vale.
    const hoje = await abrirOk(s, { data_inicio: HOJE, data_prevista_fim: '2027-12-31' });
    assert.deepEqual([hoje.data_inicio, hoje.data_prevista_fim], [HOJE, '2027-12-31']);
    const igual = await abrirOk(s, { data_inicio: '2027-06-01', data_prevista_fim: '2027-06-01' });
    assert.equal(igual.data_prevista_fim, '2027-06-01');
  });

  test('"hoje" é o dia no fuso da fazenda; sem fuso, falha fechado (409 EMPRESA_FUSO_NAO_CONFIGURADO) e nada é gravado', async () => {
    const s = await montar();
    const p = prisma();
    // 2027-06-15T15:00Z: em Tóquio já é dia 16, então 16 não é futuro lá.
    await p.empresa.update({ where: { id: s.e2.id }, data: { fuso_horario: 'Asia/Tokyo' } });
    const toquio = await abrirOk(s, { empresa_id: s.e2.id });
    assert.equal(toquio.data_inicio, '2027-06-16');
    assert.equal((await abrirOk(s, { empresa_id: s.e2.id, data_inicio: '2027-06-16' })).data_inicio, '2027-06-16');
    await p.empresa.update({ where: { id: s.e1.id }, data: { fuso_horario: null } });
    const antes = await foto(s.c);
    assert.deepEqual(erro(await abrir(s)).slice(0, 2), [409, 'EMPRESA_FUSO_NAO_CONFIGURADO']);
    assert.equal(await foto(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('numeração contínua com o contador "Atividade"', () => {
  test('1, 2, 3… por tenant; o contador é a linha "Atividade" (escopo tenant); outro tenant começa em 1', async () => {
    const s = await montar();
    const numeros = [];
    for (let k = 0; k < 3; k += 1) numeros.push((await abrirOk(s, { nome: `A${k}` })).numero);
    assert.deepEqual(numeros, ['1', '2', '3']);
    const seq = await prisma().entidadeCodigoSequencia.findMany({ where: { cliente_id: s.c, entidade: 'Atividade' } });
    assert.deepEqual(seq.map((x) => [x.escopo_tipo, x.escopo_id, x.proximo_valor]), [['tenant', s.c, 4]]);
    // A fazenda não reinicia a numeração (escopo tenant).
    assert.equal((await abrirOk(s, { empresa_id: s.e2.id })).numero, '4');
    // Duplicar também usa o mesmo contador.
    const [primeira] = (await H.ok(H.req('GET', `/atividades?empresa_id=${s.e1.id}`, s.token))).items.slice(-1);
    assert.equal((await H.ok(acao(s, primeira, 'duplicar'), 201)).numero, '5');
    const outro = await montarPatrimonio(app, { catalogo: false });
    const g = await prisma().grupoAtividade.create({ data: { cliente_id: outro.c, nome_grupo: 'G' } });
    const t = await prisma().tipoAtividade.create({ data: { cliente_id: outro.c, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    const r = await H.req('POST', '/atividades', outro.token, { empresa_id: outro.e1.id, nome: 'x', tipo_atividade_id: t.id });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().numero, '1');
  });

  test('continua o contador que a conversão deixou (as 2 convertidas mantêm 1 e 2; a próxima é 3); recusa não consome número', async () => {
    const s = await montar();
    // Estado depois da migration: o contador antigo virou o da entidade "Atividade" com o próximo = 3.
    await prisma().entidadeCodigoSequencia.create({ data: { cliente_id: s.c, entidade: 'Atividade', escopo_tipo: 'tenant', escopo_id: s.c, proximo_valor: 3 } });
    assert.equal(erro(await abrir(s, { data_inicio: '2027-06-16' }))[0], 422);
    assert.equal(erro(await abrir(s, { tipo_atividade_id: s.tipoExige.id }))[0], 422);
    assert.equal((await abrirOk(s)).numero, '3');
    assert.equal((await abrirOk(s)).numero, '4');
    // A sequência antiga (se sobrasse) não é lida.
    assert.equal(await prisma().entidadeCodigoSequencia.count({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividade' } }), 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('editar (PATCH, CAS por versão)', () => {
  test('trocar a área refaz o setor; limpar a área limpa o setor; centros e unidade nunca mudam; tipo imutável', async () => {
    const s = await montar();
    const p = prisma();
    const setor2 = await p.setor.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_setor: 'SX', nome: 'Setor Novo' } });
    const areaB = await p.areaPastagem.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: setor2.id, setor_nome: setor2.nome, numero_area: 'AX', nome: 'Baixada', tamanho_hectares: 5 } });
    const a = await abrirOk(s, { area_id: s.area1.id });
    const e = await H.ok(patch(s, a, { versao: 1, area_id: areaB.id, nome: 'Renomeada' }));
    assert.deepEqual([e.versao, e.area_id, e.setor_id, e.setor_nome, e.nome], [2, areaB.id, setor2.id, 'Setor Novo', 'Renomeada']);
    assert.deepEqual(Object.keys(e), [...CAMPOS_PUBLICOS, 'totais', 'pasto_liberado_em', 'carencia_dias'], 'toda escrita devolve o detalhe');
    assert.deepEqual([e.centro_custo_id, e.centro_resultado_id, e.unidade_producao_id, e.unidade_producao_sigla], [a.centro_custo_id, a.centro_resultado_id, a.unidade_producao_id, 'HA']);
    // Limpar a área limpa o setor.
    const sem = await H.ok(patch(s, e, { versao: 2, area_id: null }));
    assert.deepEqual([sem.area_id, sem.area, sem.setor_id, sem.setor_nome], [null, null, null, null]);
    // O corpo do PATCH recusa tipo, centros, unidade, setor, snapshots, status, número e tenant (400; nada muda).
    const antes = await foto(s.c);
    for (const [campo, valor] of [
      ['tipo_atividade_id', s.tipoLivre.id], ['centro_custo_id', null], ['centro_resultado_id', s.cr1.id], ['unidade_producao_id', null],
      ['unidade_producao_sigla', 'KM'], ['setor_id', setor2.id], ['setor_nome', 'x'], ['tipo_atividade_nome', 'x'], ['grupo_atividade_id', s.grupo.id],
      ['status', 'CONCLUIDA'], ['numero', '9'], ['cliente_id', s.c], ['area_executada', '1'],
    ]) {
      const r = await patch(s, a, { versao: 3, [campo]: valor });
      assert.deepEqual(erro(r).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], `${campo}: ${r.body}`);
    }
    // Só a versão (e a empresa) não é edição.
    assert.deepEqual(erro(await patch(s, a, { versao: 3 })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.deepEqual(erro(await patch(s, a, { versao: 3, empresa_id: s.e1.id })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.deepEqual(erro(await patch(s, a, { nome: 'sem versão' })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.equal(await foto(s.c), antes);
    const linha = await p.atividade.findUnique({ where: { id: a.id } });
    assert.deepEqual([linha.tipo_atividade_id, linha.centro_custo_id, linha.unidade_producao_id], [s.tipo.id, s.centro1.id, s.un.id]);
    // Auditoria com os campos alterados.
    const eventos = await auditoria(s.c, 'atividade.editar');
    assert.deepEqual(eventos.map((x) => x.dados_novos.campos_alterados), [['area_id', 'nome', 'setor_id', 'setor_nome'], ['area_id', 'setor_id', 'setor_nome']]);
  });

  test('snapshot nunca relido: mudar os padrões, o nome do tipo, o grupo e o setor da área depois não muda a atividade aberta; editar outro campo também não', async () => {
    const s = await montar();
    const p = prisma();
    const a = await abrirOk(s, { area_id: s.area1.id });
    const centroNovo = await p.centroCusto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: 'CCN', nome: 'Novo centro' } });
    const un2 = await p.unidadeMedida.create({ data: { cliente_id: s.c, numero_unidade: 'U-2', sigla: 'TON', descricao: 'Tonelada' } });
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { nome_tipo: 'CIGARRINHA RENOMEADA', centro_custo_padrao_id: centroNovo.id, centro_resultado_padrao_id: null, unidade_producao_id: un2.id } });
    await p.grupoAtividade.update({ where: { id: s.grupo.id }, data: { nome_grupo: 'GRUPO RENOMEADO' } });
    await p.unidadeMedida.update({ where: { id: s.un.id }, data: { sigla: 'HECT' } });
    const d = await detalhe(s, a);
    assert.deepEqual(
      [d.tipo_atividade_nome, d.grupo_atividade_nome, d.centro_custo_id, d.centro_resultado_id, d.unidade_producao_id, d.unidade_producao_sigla],
      ['CIGARRINHA', s.grupo.nome_grupo, s.centro1.id, s.cr1.id, s.un.id, 'HA']
    );
    const e = await H.ok(patch(s, a, { versao: 1, observacao: 'só a observação' }));
    assert.deepEqual(
      [e.tipo_atividade_nome, e.grupo_atividade_nome, e.centro_custo_id, e.centro_resultado_id, e.unidade_producao_id, e.unidade_producao_sigla, e.setor_id],
      ['CIGARRINHA', s.grupo.nome_grupo, s.centro1.id, s.cr1.id, s.un.id, 'HA', s.area1.setor_id]
    );
    // O objeto `unidade_producao` mostra o cadastro de hoje; a sigla gravada é o snapshot.
    assert.equal(e.unidade_producao.sigla, 'HECT');
  });

  test('flags valem de novo na edição: exige_area, exige_safra e exige_maquina sobre o estado final', async () => {
    const s = await montar();
    const p = prisma();
    const a = await abrirOk(s, { area_id: s.area1.id, safra_ciclo: '26/27', bem_id: s.trator.id });
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_area: true, exige_safra: true, exige_maquina: true } });
    // Tirar o que o tipo exige → 422; nada muda.
    const antes = await foto(s.c);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, area_id: null })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'area_id', 'exige_area']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, safra_ciclo: null })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'safra_ciclo', 'exige_safra']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, bem_id: null })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'bem_id', 'exige_maquina']);
    assert.equal(await foto(s.c), antes);
    // Mantendo, outra edição passa.
    const ok = await H.ok(patch(s, a, { versao: 1, nome: 'Com tudo' }));
    assert.equal(ok.versao, 2);
    // Tipo que passou a exigir algo que falta: qualquer PATCH pede o campo; com o campo, passa.
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_area: false, exige_safra: false, exige_maquina: false } });
    const b = await abrirOk(s, { nome: 'Sem área' });
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_area: true } });
    assert.deepEqual(erro(await patch(s, b, { versao: 1, nome: 'y' })), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'area_id', 'exige_area']);
    assert.equal((await H.ok(patch(s, b, { versao: 1, area_id: s.area1.id }))).setor_id, s.area1.setor_id);
  });

  test('referências e datas na edição: área de outra fazenda, máquina inativa, tarefa alheia, data futura, período invertido → 422; manter a referência gravada que ficou inativa pode', async () => {
    const s = await montar();
    const p = prisma();
    const a = await abrirOk(s, { area_id: s.area1.id, bem_id: s.trator.id, data_inicio: '2027-06-10' });
    const antes = await foto(s.c);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, area_id: s.area2.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'area_id', 'outra_empresa']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, bem_id: s.trator2.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'outra_empresa']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, bem_id: s.implemento.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'natureza']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, lancamento_tarefa_id: s.tarefa2.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'lancamento_tarefa_id', 'outra_empresa']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, data_inicio: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'futura']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, data_prevista_fim: '2027-06-01' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_prevista_fim', 'periodo_invertido']);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, data_inicio: '2027-06-20' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'futura']);
    assert.equal(await foto(s.c), antes);
    // Área e máquina gravadas que ficaram inativas: só a referência nova ou trocada é conferida.
    await p.areaPastagem.update({ where: { id: s.area1.id }, data: { ativo: false } });
    await p.bemPatrimonial.update({ where: { id: s.trator.id }, data: { ativo: false } });
    assert.equal((await H.ok(patch(s, a, { versao: 1, nome: 'Mantém' }))).area_id, s.area1.id);
    const t2 = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: 'TP-03' })), 201);
    await p.bemPatrimonial.update({ where: { id: t2.id }, data: { ativo: false } });
    assert.deepEqual(erro(await patch(s, a, { versao: 2, bem_id: t2.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'inativo']);
  });

  test('máquina da atividade só de natureza MAQUINA, VEICULO ou EQUIPAMENTO: implemento → 422 natureza na abertura e na edição; trator, caminhonete e gerador aceitos', async () => {
    const s = await montar();
    const caminhonete = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoCaminhonete(s)), 201);
    const gerador = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoGerador(s)), 201);
    assert.deepEqual([s.trator.natureza, caminhonete.natureza, gerador.natureza, s.implemento.natureza], ['MAQUINA', 'VEICULO', 'EQUIPAMENTO', 'IMPLEMENTO']);
    const antes = await foto(s.c);
    assert.deepEqual(erro(await abrir(s, { bem_id: s.implemento.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'natureza']);
    assert.equal(await foto(s.c), antes, 'nada gravado');
    for (const bem of [s.trator, caminhonete, gerador]) {
      const a = await abrirOk(s, { bem_id: bem.id });
      assert.deepEqual([a.bem_id, a.bem.natureza], [bem.id, bem.natureza]);
    }
    // Edição: trocar para o implemento é recusado e nada muda; trocar para outra máquina pode.
    const a = await abrirOk(s, { bem_id: s.trator.id });
    const antesDaEdicao = await foto(s.c);
    assert.deepEqual(erro(await patch(s, a, { versao: 1, bem_id: s.implemento.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'bem_id', 'natureza']);
    assert.equal(await foto(s.c), antesDaEdicao);
    assert.equal((await H.ok(patch(s, a, { versao: 1, bem_id: gerador.id }))).bem_id, gerador.id);
  });

  test('conflito de versão: 409 ATIVIDADE_VERSAO_CONFLITO com versao_atual e versao_informada; nada muda', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    await H.ok(patch(s, a, { versao: 1, nome: 'Primeira' }));
    const antes = await foto(s.c);
    for (const [r, informada] of [
      [await patch(s, a, { versao: 1, nome: 'Velha' }), 1],
      [await patch(s, a, { versao: 7, nome: 'Futura' }), 7],
      [await acao(s, a, 'concluir', { versao: 1 }), 1],
      [await acao(s, a, 'cancelar', { versao: 1, motivo: 'motivo válido' }), 1],
    ]) {
      assert.deepEqual(erro(r), [409, 'ATIVIDADE_VERSAO_CONFLITO', null, null], r.body);
      assert.deepEqual([r.json().details.versao_atual, r.json().details.versao_informada, r.json().details.entidade], [2, informada, 'atividade']);
    }
    assert.equal(await foto(s.c), antes);
    // Reabrir também confere a versão.
    const c = await H.ok(acao(s, a, 'concluir', { versao: 2 }));
    const r = await acao(s, a, 'reabrir', { versao: 2, motivo: 'motivo válido' });
    assert.deepEqual(erro(r), [409, 'ATIVIDADE_VERSAO_CONFLITO', null, null]);
    assert.equal(r.json().details.versao_atual, c.versao);
  });

  test('PATCH: empresa opcional (ausente vale a da atividade; presente tem de ser a dela; outra fazenda → 404 sem oráculo)', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    assert.equal((await H.ok(patch(s, a, { empresa_id: s.e1.id, versao: 1, nome: 'Com empresa' }))).versao, 2);
    const antes = await foto(s.c);
    assert.deepEqual(erro(await patch(s, a, { empresa_id: s.e2.id, versao: 2, nome: 'x' })), [404, 'ATIVIDADE_NOT_FOUND', null, null]);
    assert.deepEqual(erro(await patch(s, a, { empresa_id: 'emp-nao-existe', versao: 2, nome: 'x' })).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    assert.equal(await foto(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('concluir', () => {
  test('hoje por padrão; nunca futura nem antes do início; grava concluida_em/por; auditoria', async () => {
    const s = await montar();
    const a = await abrirOk(s, { data_inicio: '2027-06-10' });
    assert.deepEqual(erro(await acao(s, a, 'concluir', { versao: 1, data_conclusao: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'futura']);
    assert.deepEqual(erro(await acao(s, a, 'concluir', { versao: 1, data_conclusao: '2027-06-09' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_inicio']);
    assert.deepEqual(erro(await acao(s, a, 'concluir', { versao: 1, data_conclusao: '2027-02-30' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'data_inexistente']);
    assert.equal((await auditoria(s.c, 'atividade.concluir')).length, 0);
    const c = await H.ok(acao(s, a, 'concluir', { versao: 1 }));
    assert.deepEqual([c.status, c.versao, c.data_conclusao], ['CONCLUIDA', 2, HOJE]);
    assert.deepEqual(c.concluida_por, { id: s.adm.usuario.id, nome: s.adm.usuario.nome });
    assert.equal(c.concluida_em, '2027-06-15T15:00:00.000Z', 'o relógio do servidor');
    const b = await abrirOk(s, { data_inicio: '2027-06-10' });
    assert.equal((await H.ok(acao(s, b, 'concluir', { versao: 1, data_conclusao: '2027-06-10' }))).data_conclusao, '2027-06-10', 'o próprio dia do início vale');
    const ev = await auditoria(s.c, 'atividade.concluir');
    assert.deepEqual(ev.map((x) => x.entidade_id), [a.id, b.id]);
  });

  test('exige_producao: exige produção > 0 somada dos apontamentos CONFIRMADOS (cancelado e zero não contam)', async () => {
    const s = await montar();
    const a = await abrirOk(s, { tipo_atividade_id: s.tipoProducao.id, nome: 'Colheita', data_inicio: '2027-06-01' });
    const exige = [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'quantidade_produzida', 'exige_producao'];
    assert.deepEqual(erro(await acao(s, a, 'concluir', { versao: 1 })), exige, 'sem apontamento');
    await apontar(s, a, { quantidade_produzida_dia: '0', area_executada_dia: '5' });
    assert.deepEqual(erro(await acao(s, a, 'concluir', { versao: 1 })), exige, 'produção zero');
    await apontar(s, a, { quantidade_produzida_dia: '3.5', sequencia: 2, status: 'CANCELADO', cancelado_em: new Date() });
    assert.deepEqual(erro(await acao(s, a, 'concluir', { versao: 1 })), exige, 'cancelado não conta');
    await apontar(s, a, { quantidade_produzida_dia: '0.0001', sequencia: 3 });
    const c = await H.ok(acao(s, a, 'concluir', { versao: 1 }));
    assert.equal(c.status, 'CONCLUIDA');
    // Sem a flag, conclui sem produção.
    const livre = await abrirOk(s, { tipo_atividade_id: s.tipoLivre.id });
    assert.equal((await H.ok(acao(s, livre, 'concluir', { versao: 1 }))).status, 'CONCLUIDA');
  });

  test('concluída bloqueia: PATCH, concluir de novo, cancelar, novo apontamento e edição de apontamento → 409 ATIVIDADE_STATUS_INVALIDO', async () => {
    const s = await montar();
    const a = await abrirOk(s, { data_inicio: '2027-06-01' });
    const ap = await H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-10', area_executada_dia: '2' });
    assert.equal(ap.statusCode, 201, ap.body);
    const c = await H.ok(acao(s, a, 'concluir', { versao: a.versao }));
    const antes = await foto(s.c);
    const casos = [
      [await patch(s, a, { versao: c.versao, nome: 'x' }), 'atividade', 'editar'],
      [await acao(s, a, 'concluir', { versao: c.versao }), 'atividade', 'concluir'],
      [await acao(s, a, 'cancelar', { versao: c.versao, motivo: 'reabra antes' }), 'atividade', 'cancelar'],
      [await H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-11' }), 'atividade', 'lancar_apontamento'],
      [await H.req('PATCH', `/atividades/${a.id}/apontamentos/${ap.json().apontamento.id}`, s.token, { versao: 1, observacao: 'x' }), 'atividade', 'editar_apontamento'],
      [await H.req('POST', `/atividades/${a.id}/apontamentos/${ap.json().apontamento.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: 1, motivo: 'motivo' }), 'atividade', 'cancelar_apontamento'],
      [await H.req('POST', `/atividades/${a.id}/apontamentos/${ap.json().apontamento.id}/duplicar`, s.token, { empresa_id: s.e1.id }), 'atividade', 'lancar_apontamento'],
    ];
    for (const [r, entidade, nome] of casos) {
      assert.deepEqual(erro(r), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null], `${nome}: ${r.body}`);
      assert.deepEqual(r.json().details, { status: 'CONCLUIDA', acao: nome, entidade });
    }
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // A leitura segue.
    assert.equal((await H.ok(H.req('GET', `/atividades/${a.id}/apontamentos?empresa_id=${s.e1.id}`, s.token))).items.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reabrir', () => {
  test('exige a ação extra "reabrir" (as ações padrão não bastam) e motivo (ausente, curto, longo → 422); só CONCLUIDA', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    assert.deepEqual(erro(await acao(s, a, 'reabrir', { versao: 1, motivo: 'ainda aberta' })), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null]);
    await H.ok(acao(s, a, 'concluir', { versao: 1 }));
    const antes = await foto(s.c);
    // Todas as ações padrão e as outras extras ligadas, sem "reabrir": 403.
    const semReabrir = await s.conta({
      modulos_permitidos: [MODULO],
      permissoes_telas: [linhaAtividades({ visualizar: true, novo: true, salvar: true, editar: true, excluir: true, importar: true, exportar: true, lancar_apontamento: true, editar_apontamento: true, cancelar_apontamento: true })],
    });
    assert.deepEqual(erro(await acao(s, a, 'reabrir', { versao: 2, motivo: 'faltou um dia' }, semReabrir.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    // "reabrir" sem "visualizar" não vale.
    const semVer = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ reabrir: true })] });
    assert.deepEqual(erro(await acao(s, a, 'reabrir', { versao: 2, motivo: 'faltou um dia' }, semVer.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    const comReabrir = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ visualizar: true, reabrir: true })] });
    for (const [motivo, reason] of [[undefined, 'obrigatorio'], [null, 'obrigatorio'], ['    ', 'obrigatorio'], [' ab ', 'curto'], ['x'.repeat(501), 'longo']]) {
      const corpo = { versao: 2, ...(motivo === undefined ? {} : { motivo }) };
      assert.deepEqual(erro(await acao(s, a, 'reabrir', corpo, comReabrir.token)), [422, 'ATIVIDADE_MOTIVO_INVALIDO', 'motivo', reason], String(motivo));
    }
    assert.equal(await foto(s.c), antes, 'nada gravado');
    const r = await H.ok(acao(s, a, 'reabrir', { versao: 2, motivo: '  faltou um dia  ' }, comReabrir.token));
    assert.deepEqual([r.status, r.versao, r.data_conclusao, r.concluida_em, r.concluida_por, r.motivo_reabertura], ['ABERTA', 3, null, null, null, 'faltou um dia']);
    assert.deepEqual(r.reaberta_por, { id: comReabrir.id, nome: comReabrir.nome });
    assert.equal(r.reaberta_em, '2027-06-15T15:00:00.000Z');
    // Quem só reabre não edita nem conclui.
    assert.deepEqual(erro(await patch(s, a, { versao: 3, nome: 'x' }, comReabrir.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
  });

  test('auditoria a cada reabertura, com o motivo; a linha guarda a última; reaberta aceita apontamento de novo', async () => {
    const s = await montar();
    const a = await abrirOk(s, { data_inicio: '2027-06-01' });
    await H.ok(acao(s, a, 'concluir', { versao: 1 }));
    await H.ok(acao(s, a, 'reabrir', { versao: 2, motivo: 'primeira vez' }));
    await H.ok(acao(s, a, 'concluir', { versao: 3 }));
    const r = await H.ok(acao(s, a, 'reabrir', { versao: 4, motivo: 'segunda vez' }));
    assert.equal(r.motivo_reabertura, 'segunda vez');
    const eventos = await auditoria(s.c, 'atividade.reabrir');
    assert.deepEqual(eventos.map((e) => [e.entidade, e.entidade_id, e.dados_novos.motivo_reabertura]), [['Atividade', a.id, 'primeira vez'], ['Atividade', a.id, 'segunda vez']]);
    const l = await H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-12' });
    assert.equal(l.statusCode, 201, l.body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cancelar', () => {
  test('motivo obrigatório; cancela os CONFIRMADOS no mesmo instante, motivo e usuário; zera os totais; o já cancelado não muda; auditoria', async () => {
    const s = await montar();
    const a = await abrirOk(s, { data_inicio: '2027-06-01' });
    const lancar = (corpo) => H.ok(H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, ...corpo }), 201);
    const l1 = await lancar({ data_operacional: '2027-06-02', area_executada_dia: '2', quantidade_produzida_dia: '1' });
    await lancar({ data_operacional: '2027-06-03', area_executada_dia: '3' });
    const l3 = await lancar({ data_operacional: '2027-06-04', area_executada_dia: '4' });
    const x = await H.ok(H.req('POST', `/atividades/${a.id}/apontamentos/${l3.apontamento.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: 1, motivo: 'antigo' }));
    assert.deepEqual([x.atividade.area_executada, x.atividade.quantidade_produzida], ['5.0000', '1.0000']);
    const antes = await foto(s.c);
    for (const [motivo, reason] of [[undefined, 'obrigatorio'], ['', 'obrigatorio'], ['a', 'curto'], ['x'.repeat(501), 'longo']]) {
      const corpo = { versao: 1, ...(motivo === undefined ? {} : { motivo }) };
      assert.deepEqual(erro(await acao(s, a, 'cancelar', corpo)), [422, 'ATIVIDADE_MOTIVO_INVALIDO', 'motivo', reason]);
    }
    assert.equal(await foto(s.c), antes);
    const c = await H.ok(acao(s, a, 'cancelar', { versao: 1, motivo: 'lançada errada' }));
    assert.deepEqual([c.status, c.versao, c.motivo_cancelamento, c.area_executada, c.quantidade_produzida], ['CANCELADA', 2, 'lançada errada', null, null]);
    assert.deepEqual(c.cancelado_por, { id: s.adm.usuario.id, nome: s.adm.usuario.nome });
    assert.equal(c.cancelada_em, '2027-06-15T15:00:00.000Z');
    assert.deepEqual(c.totais, { apontamentos_confirmados: 0, apontamentos_cancelados: 3, dias_com_apontamento: 0 });
    const filhos = await prisma().atividadeApontamento.findMany({ where: { atividade_id: a.id }, orderBy: { data_operacional: 'asc' } });
    assert.deepEqual(filhos.map((f) => [f.status, f.motivo_cancelamento, f.versao]), [['CANCELADO', 'lançada errada', 2], ['CANCELADO', 'lançada errada', 2], ['CANCELADO', 'antigo', 2]]);
    assert.deepEqual(filhos.slice(0, 2).map((f) => [f.cancelado_em.toISOString(), f.cancelado_por_usuario_id]), [[c.cancelada_em, s.adm.usuario.id], [c.cancelada_em, s.adm.usuario.id]]);
    assert.equal(filhos[0].id, l1.apontamento.id);
    const ev = await auditoria(s.c, 'atividade.cancelar');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].dados_novos.apontamentos_cancelados, 2);
    assert.equal(JSON.stringify(ev[0]).includes('lançada errada'), false, 'motivo fora da auditoria');
    // Cancelada: nada mais (cancelar, concluir, reabrir, editar).
    for (const [r, nome] of [
      [await acao(s, a, 'cancelar', { versao: 2, motivo: 'de novo' }), 'cancelar'],
      [await acao(s, a, 'concluir', { versao: 2 }), 'concluir'],
      [await acao(s, a, 'reabrir', { versao: 2, motivo: 'de novo' }), 'reabrir'],
      [await patch(s, a, { versao: 2, nome: 'x' }), 'editar'],
    ]) {
      assert.deepEqual(erro(r), [409, 'ATIVIDADE_STATUS_INVALIDO', null, null], nome);
      assert.deepEqual(r.json().details, { status: 'CANCELADA', acao: nome, entidade: 'atividade' });
    }
  });

  test('cancelar sem apontamento: 0 cancelados; a "excluir" da tela é a permissão; editar não cancela', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    const editor = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ visualizar: true, novo: true, salvar: true, editar: true })] });
    assert.deepEqual(erro(await acao(s, a, 'cancelar', { versao: 1, motivo: 'motivo válido' }, editor.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    const quemCancela = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ visualizar: true, excluir: true })] });
    const c = await H.ok(acao(s, a, 'cancelar', { versao: 1, motivo: 'motivo válido' }, quemCancela.token));
    assert.deepEqual([c.status, c.totais], ['CANCELADA', TOTAIS_VAZIOS]);
    assert.equal((await auditoria(s.c, 'atividade.cancelar'))[0].dados_novos.apontamentos_cancelados, 0);
    // Sem DELETE físico.
    assert.equal((await H.req('DELETE', `/atividades/${a.id}`, s.token)).statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('duplicar atividade', () => {
  test('abertura nova: copia nome, tipo, área, máquina, safra, área planejada, tarefa e observação; padrões relidos do tipo; setor relido da área; sem apontamentos', async () => {
    const s = await montar();
    const p = prisma();
    const a = await abrirOk(s, { area_id: s.area1.id, bem_id: s.trator.id, safra_ciclo: '26/27', area_planejada: '7', lancamento_tarefa_id: s.tarefa1.id, observacao: 'obs', data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30' });
    await H.ok(H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-02', area_executada_dia: '2' }), 201);
    await H.ok(acao(s, a, 'concluir', { versao: 1 }));
    // O tipo e a área mudaram depois: a cópia relê os padrões e o setor.
    const centroNovo = await p.centroCusto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero: 'CCN', nome: 'Novo centro' } });
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { centro_custo_padrao_id: centroNovo.id, nome_tipo: 'CIGARRINHA NOVA', unidade_producao_id: null } });
    const setor2 = await p.setor.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_setor: 'S9', nome: 'Setor Trocado' } });
    await p.areaPastagem.update({ where: { id: s.area1.id }, data: { setor_id: setor2.id, setor_nome: setor2.nome } });
    const d = await H.ok(acao(s, a, 'duplicar'), 201);
    assert.notEqual(d.id, a.id);
    assert.deepEqual(Object.keys(d), [...CAMPOS_PUBLICOS, 'totais', 'pasto_liberado_em', 'carencia_dias']);
    assert.deepEqual([d.numero, d.status, d.versao, d.nome, d.data_inicio, d.data_prevista_fim, d.data_conclusao], ['2', 'ABERTA', 1, a.nome, HOJE, null, null]);
    assert.deepEqual([d.tipo_atividade_id, d.area_id, d.bem_id, d.safra_ciclo, d.area_planejada, d.lancamento_tarefa_id, d.observacao], [s.tipo.id, a.area_id, a.bem_id, '26/27', '7.0000', a.lancamento_tarefa_id, 'obs']);
    assert.deepEqual([d.centro_custo_id, d.centro_resultado_id, d.unidade_producao_id, d.unidade_producao_sigla, d.tipo_atividade_nome], [centroNovo.id, s.cr1.id, null, null, 'CIGARRINHA NOVA']);
    assert.deepEqual([d.setor_id, d.setor_nome], [setor2.id, 'Setor Trocado']);
    assert.deepEqual([d.area_executada, d.quantidade_produzida, d.totais], [null, null, TOTAIS_VAZIOS]);
    assert.equal(await p.atividadeApontamento.count({ where: { atividade_id: d.id } }), 0, 'não copia apontamentos');
    // A origem não muda.
    const origem = await detalhe(s, a);
    assert.deepEqual([origem.status, origem.versao, origem.tipo_atividade_nome, origem.centro_custo_id], ['CONCLUIDA', 2, 'CIGARRINHA', s.centro1.id]);
    // Corpo opcional: nome e datas.
    const d2 = await H.ok(acao(s, a, 'duplicar', { nome: 'Cigarrinha Pasto 02', data_inicio: '2027-06-05', data_prevista_fim: '2027-06-20' }), 201);
    assert.deepEqual([d2.nome, d2.data_inicio, d2.data_prevista_fim, d2.numero], ['Cigarrinha Pasto 02', '2027-06-05', '2027-06-20', '3']);
    const ev = await auditoria(s.c, 'atividade.duplicar');
    assert.deepEqual(ev.map((x) => [x.entidade_id, x.dados_novos.duplicada_de]), [[d.id, a.id], [d2.id, a.id]]);
    // O corpo do duplicar é fechado: o resto vem da origem.
    assert.deepEqual(erro(await acao(s, a, 'duplicar', { area_id: s.area1.id })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
  });

  test('mesmas regras da abertura: tipo inativo, flag nova, data futura, área que ficou inativa → recusa; cancelada também duplica; nada gravado na recusa', async () => {
    const s = await montar();
    const p = prisma();
    const a = await abrirOk(s, { area_id: s.area1.id });
    await H.ok(acao(s, a, 'cancelar', { versao: 1, motivo: 'motivo válido' }));
    const antes = await foto(s.c);
    assert.deepEqual(erro(await acao(s, a, 'duplicar', { data_inicio: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_inicio', 'futura']);
    assert.deepEqual(erro(await acao(s, a, 'duplicar', { data_inicio: '2027-06-10', data_prevista_fim: '2027-06-01' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_prevista_fim', 'periodo_invertido']);
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_safra: true } });
    assert.deepEqual(erro(await acao(s, a, 'duplicar')), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'safra_ciclo', 'exige_safra']);
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { exige_safra: false } });
    await p.areaPastagem.update({ where: { id: s.area1.id }, data: { ativo: false } });
    // D-PROD-249: a duplicação copia as ÁREAS da origem (areas[]): o campo do erro é o da área na lista.
    assert.deepEqual(erro(await acao(s, a, 'duplicar')), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'areas[0].area_id', 'inativo']);
    await p.areaPastagem.update({ where: { id: s.area1.id }, data: { ativo: true } });
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { ativo: false } });
    assert.deepEqual(erro(await acao(s, a, 'duplicar')), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'tipo_atividade_id', 'inativo']);
    assert.equal(await foto(s.c), antes);
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { ativo: true } });
    const d = await H.ok(acao(s, a, 'duplicar'), 201);
    assert.deepEqual([d.status, d.numero], ['ABERTA', '2']);
    // Duplicar exige "novo" ou "salvar"; "editar" não basta.
    const editor = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ visualizar: true, editar: true })] });
    assert.deepEqual(erro(await acao(s, a, 'duplicar', {}, editor.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('leitura: lista keyset, filtros e detalhe', () => {
  test('lista keyset createdAt desc, id desc com filtros (status, tipo, área, período sobre data_inicio, q no número e no nome) e cursor', async () => {
    const s = await montar();
    const a1 = await abrirOk(s, { nome: 'Cigarrinha Pasto 01', area_id: s.area1.id, data_inicio: '2027-06-01' });
    const a2 = await abrirOk(s, { nome: 'Roçada', tipo_atividade_id: s.tipoLivre.id, data_inicio: '2027-06-10' });
    const a3 = await abrirOk(s, { nome: 'cigarrinha baixada', data_inicio: '2027-06-12' });
    await H.ok(acao(s, a3, 'concluir', { versao: 1 }));
    const a4 = await abrirOk(s, { nome: 'Cancelada', data_inicio: '2027-06-05' });
    await H.ok(acao(s, a4, 'cancelar', { versao: 1, motivo: 'motivo válido' }));
    await abrirOk(s, { empresa_id: s.e2.id, nome: 'Fazenda 2' });
    const lista = (extra = '') => H.ok(H.req('GET', `/atividades?empresa_id=${s.e1.id}${extra}`, s.token));
    const todas = await lista();
    assert.deepEqual(Object.keys(todas).sort(), ['has_more', 'items', 'limit', 'next_cursor', 'total']);
    assert.deepEqual(todas.items.map((i) => i.id), [a4.id, a3.id, a2.id, a1.id], 'createdAt desc; só a fazenda pedida');
    assert.deepEqual([todas.total, todas.has_more, todas.next_cursor], [4, false, null]);
    // D-PROD-267: e o `andamento` (situação, hectares, %, dias), lido para a página numa consulta agrupada.
    assert.deepEqual(Object.keys(todas.items[0]), [...CAMPOS_PUBLICOS, 'custo_total', 'andamento'], 'a lista não traz os totais; traz o custo total (D-PROD-234) e o andamento (D-PROD-267)');
    assert.ok(todas.items.every((i) => i.custo_total === null), 'sem lançamento, sem custo');
    assert.deepEqual((await lista('&status=CONCLUIDA')).items.map((i) => i.id), [a3.id]);
    assert.deepEqual((await lista('&status=CANCELADA')).items.map((i) => i.id), [a4.id]);
    assert.deepEqual((await lista('&status=ABERTA')).items.map((i) => i.id), [a2.id, a1.id]);
    assert.deepEqual((await lista(`&tipo_atividade_id=${s.tipoLivre.id}`)).items.map((i) => i.id), [a2.id]);
    assert.deepEqual((await lista(`&area_id=${s.area1.id}`)).items.map((i) => i.id), [a1.id]);
    assert.deepEqual((await lista('&data_de=2027-06-05&data_ate=2027-06-11')).items.map((i) => i.id), [a4.id, a2.id]);
    assert.deepEqual((await lista('&data_de=2027-06-12')).items.map((i) => i.id), [a3.id]);
    assert.deepEqual((await lista('&data_ate=2027-06-01')).items.map((i) => i.id), [a1.id]);
    assert.deepEqual((await lista('&q=CIGARRINHA')).items.map((i) => i.id), [a3.id, a1.id], 'q no nome, sem caixa');
    assert.deepEqual((await lista(`&q=${a2.numero}`)).items.map((i) => i.id), [a2.id], 'q no número');
    assert.deepEqual((await lista(`&status=ABERTA&tipo_atividade_id=${s.tipo.id}`)).items.map((i) => i.id), [a1.id], 'filtros combinados');
    // Keyset: páginas sem repetição nem buraco.
    const p1 = await lista('&limit=3');
    assert.deepEqual([p1.items.length, p1.has_more, p1.limit, p1.total], [3, true, 3, 4]);
    const p2 = await lista(`&limit=3&cursor=${encodeURIComponent(p1.next_cursor)}`);
    assert.deepEqual([...p1.items, ...p2.items].map((i) => i.id), [a4.id, a3.id, a2.id, a1.id]);
    assert.equal(p2.has_more, false);
    // Recusas da consulta.
    assert.deepEqual(erro(await H.req('GET', `/atividades?empresa_id=${s.e1.id}&data_de=2027-06-11&data_ate=2027-06-05`, s.token)), [400, 'REQUEST_VALIDATION_FAILED', 'data_ate', 'periodo_invertido']);
    for (const extra of ['&status=FEITA', '&cliente_id=x', '&limit=0', '&limit=501', '&data_de=amanha']) {
      assert.deepEqual(erro(await H.req('GET', `/atividades?empresa_id=${s.e1.id}${extra}`, s.token)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], extra);
    }
    assert.deepEqual(erro(await H.req('GET', '/atividades', s.token)).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], 'empresa obrigatória');
  });

  test('detalhe: cabeçalho, resumos e totais (confirmados, cancelados, dias com apontamento confirmado)', async () => {
    const s = await montar();
    const a = await abrirOk(s, { area_id: s.area1.id, data_inicio: '2027-06-01' });
    const lancar = (corpo) => H.ok(H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, ...corpo }), 201);
    await lancar({ data_operacional: '2027-06-02', area_executada_dia: '1.5' });
    await lancar({ data_operacional: '2027-06-02', area_executada_dia: '2', quantidade_produzida_dia: '3' });
    const l3 = await lancar({ data_operacional: '2027-06-07', area_executada_dia: '4' });
    await H.ok(H.req('POST', `/atividades/${a.id}/apontamentos/${l3.apontamento.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: 1, motivo: 'motivo válido' }));
    const d = await detalhe(s, a);
    assert.deepEqual(Object.keys(d), [...CAMPOS_PUBLICOS, 'totais', 'pasto_liberado_em', 'carencia_dias']);
    assert.deepEqual([d.area_executada, d.quantidade_produzida], ['3.5000', '3.0000']);
    assert.deepEqual(d.totais, { apontamentos_confirmados: 2, apontamentos_cancelados: 1, dias_com_apontamento: 1 });
    assert.deepEqual(erro(await H.req('GET', `/atividades/nao-existe?empresa_id=${s.e1.id}`, s.token)), [404, 'ATIVIDADE_NOT_FOUND', null, null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isolamento por tenant e por fazenda; permissões', () => {
  test('outro tenant: toda leitura e escrita na atividade alheia → 404 (nunca 403), sem oráculo; nada muda', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    const outro = await montarPatrimonio(app, { catalogo: false });
    const antes = await foto(s.c);
    const E = outro.e1.id;
    const casos = [
      ['GET detalhe', H.req('GET', `/atividades/${a.id}?empresa_id=${E}`, outro.token)],
      ['PATCH', H.req('PATCH', `/atividades/${a.id}`, outro.token, { versao: 1, nome: 'x' })],
      ['PATCH com empresa', H.req('PATCH', `/atividades/${a.id}`, outro.token, { empresa_id: E, versao: 1, nome: 'x' })],
      ['concluir', H.req('POST', `/atividades/${a.id}/concluir`, outro.token, { empresa_id: E, versao: 1 })],
      ['reabrir', H.req('POST', `/atividades/${a.id}/reabrir`, outro.token, { empresa_id: E, versao: 1, motivo: 'motivo válido' })],
      ['cancelar', H.req('POST', `/atividades/${a.id}/cancelar`, outro.token, { empresa_id: E, versao: 1, motivo: 'motivo válido' })],
      ['duplicar', H.req('POST', `/atividades/${a.id}/duplicar`, outro.token, { empresa_id: E })],
      ['apontamentos', H.req('GET', `/atividades/${a.id}/apontamentos?empresa_id=${E}`, outro.token)],
      ['lançar', H.req('POST', `/atividades/${a.id}/apontamentos`, outro.token, { empresa_id: E, data_operacional: '2027-06-10' })],
    ];
    for (const [nome, pr] of casos) {
      const r = await pr;
      assert.deepEqual(erro(r), [404, 'ATIVIDADE_NOT_FOUND', null, null], `${nome}: ${r.body}`);
    }
    // Com a empresa do dono: a empresa não é do tenant da sessão (404 da empresa, também sem 403).
    for (const r of [
      await H.req('GET', `/atividades?empresa_id=${s.e1.id}`, outro.token),
      await H.req('GET', `/atividades/${a.id}?empresa_id=${s.e1.id}`, outro.token),
      await H.req('POST', `/atividades/${a.id}/concluir`, outro.token, { empresa_id: s.e1.id, versao: 1 }),
      await H.req('POST', '/atividades', outro.token, { empresa_id: s.e1.id, nome: 'x', tipo_atividade_id: s.tipo.id }),
    ]) {
      assert.deepEqual(erro(r).slice(0, 2), [404, 'EMPRESA_NOT_FOUND'], r.body);
    }
    // Abrir no próprio tenant com o tipo, a área, a máquina ou a tarefa alheios: o alheio não existe.
    const g = await prisma().grupoAtividade.create({ data: { cliente_id: outro.c, nome_grupo: 'G' } });
    const t = await prisma().tipoAtividade.create({ data: { cliente_id: outro.c, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    const corpo = { empresa_id: E, nome: 'x', tipo_atividade_id: t.id };
    assert.deepEqual(erro(await H.req('POST', '/atividades', outro.token, { ...corpo, tipo_atividade_id: s.tipo.id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'tipo_atividade_id', 'inexistente']);
    for (const [campo, valor] of [['area_id', s.area1.id], ['bem_id', s.trator.id], ['lancamento_tarefa_id', s.tarefa1.id]]) {
      assert.deepEqual(erro(await H.req('POST', '/atividades', outro.token, { ...corpo, [campo]: valor })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', campo, 'inexistente'], campo);
    }
    // A lista do outro tenant não mostra a atividade.
    assert.deepEqual((await H.ok(H.req('GET', `/atividades?empresa_id=${E}`, outro.token))).items, []);
    assert.equal(await foto(s.c), antes, 'nada mudou no dono');
  });

  test('outra fazenda do mesmo tenant: leitura e ações pela fazenda errada → 404; a lista é por fazenda', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    const b = await abrirOk(s, { empresa_id: s.e2.id, nome: 'Fazenda 2' });
    const antes = await foto(s.c);
    assert.deepEqual(erro(await H.req('GET', `/atividades/${a.id}?empresa_id=${s.e2.id}`, s.token)), [404, 'ATIVIDADE_NOT_FOUND', null, null]);
    for (const [nome, corpo] of [['concluir', {}], ['reabrir', { motivo: 'motivo válido' }], ['cancelar', { motivo: 'motivo válido' }], ['duplicar', {}]]) {
      const r = await H.req('POST', `/atividades/${a.id}/${nome}`, s.token, { empresa_id: s.e2.id, ...(nome === 'duplicar' ? {} : { versao: 1 }), ...corpo });
      assert.deepEqual(erro(r), [404, 'ATIVIDADE_NOT_FOUND', null, null], `${nome}: ${r.body}`);
    }
    assert.equal(await foto(s.c), antes);
    assert.deepEqual((await H.ok(H.req('GET', `/atividades?empresa_id=${s.e2.id}`, s.token))).items.map((i) => i.id), [b.id]);
  });

  test('permissões: sem a tela → 403 na leitura; só visualizar lê e não escreve; "novo" cria; "editar" edita e conclui; "excluir" cancela', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    const conta = (acoes) => s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ visualizar: true, ...acoes })] });
    const semTela = await s.conta(null);
    for (const url of [`/atividades?empresa_id=${s.e1.id}`, `/atividades/${a.id}?empresa_id=${s.e1.id}`, `/atividades-opcoes/bens?empresa_id=${s.e1.id}`, `/atividades-opcoes/operadores?empresa_id=${s.e1.id}`]) {
      assert.deepEqual(erro(await H.req('GET', url, semTela.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], url);
    }
    const leitor = await conta({});
    assert.equal((await H.req('GET', `/atividades?empresa_id=${s.e1.id}`, leitor.token)).statusCode, 200);
    assert.equal((await H.req('GET', `/atividades/${a.id}?empresa_id=${s.e1.id}`, leitor.token)).statusCode, 200);
    const antes = await foto(s.c);
    for (const r of [
      await abrir(s, {}, leitor.token),
      await patch(s, a, { versao: 1, nome: 'x' }, leitor.token),
      await acao(s, a, 'concluir', { versao: 1 }, leitor.token),
      await acao(s, a, 'cancelar', { versao: 1, motivo: 'motivo válido' }, leitor.token),
      await acao(s, a, 'duplicar', {}, leitor.token),
    ]) {
      assert.deepEqual(erro(r).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA'], r.body);
    }
    assert.equal(await foto(s.c), antes);
    const criador = await conta({ novo: true });
    assert.equal((await abrir(s, {}, criador.token)).statusCode, 201);
    assert.equal((await patch(s, a, { versao: 1, nome: 'x' }, criador.token)).statusCode, 403);
    const editor = await conta({ editar: true });
    assert.equal((await patch(s, a, { versao: 1, nome: 'Editada' }, editor.token)).statusCode, 200);
    assert.equal((await acao(s, a, 'concluir', { versao: 2 }, editor.token)).statusCode, 200);
    assert.equal((await abrir(s, {}, editor.token)).statusCode, 403);
    // A tela antiga (inerte) não libera nada.
    const antiga = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [{ modulo_id: MODULO, tela_id: 'op-apontamentos-atividade', visualizar: true, novo: true, salvar: true, editar: true, excluir: true }] });
    assert.equal((await H.req('GET', `/atividades?empresa_id=${s.e1.id}`, antiga.token)).statusCode, 403);
    assert.equal((await abrir(s, {}, antiga.token)).statusCode, 403);
  });

  test('opções: máquinas ATIVAS da fazenda (só o resumo) e operadores ATIVOS do tenant ({id, nome}), com a guarda "ver"', async () => {
    const s = await montar();
    const p = prisma();
    const leitor = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAtividades({ visualizar: true })] });
    // A tela pede só as naturezas que servem de máquina (MAQUINA, VEICULO, EQUIPAMENTO); sem o filtro vem também o implemento.
    const MAQUINAS = '&natureza=MAQUINA&natureza=VEICULO&natureza=EQUIPAMENTO';
    const bens = await H.ok(H.req('GET', `/atividades-opcoes/bens?empresa_id=${s.e1.id}${MAQUINAS}`, leitor.token));
    assert.deepEqual(Object.keys(bens).sort(), ['has_more', 'itens', 'next_cursor']);
    assert.deepEqual(bens.itens, [{ id: s.trator.id, numero: s.trator.numero, codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA' }]);
    assert.deepEqual((await H.ok(H.req('GET', `/atividades-opcoes/bens?empresa_id=${s.e1.id}`, leitor.token))).itens.map((b) => b.id).sort(), [s.trator.id, s.implemento.id].sort());
    assert.deepEqual((await H.ok(H.req('GET', `/atividades-opcoes/bens?empresa_id=${s.e2.id}`, leitor.token))).itens.map((b) => b.id), [s.trator2.id]);
    await p.bemPatrimonial.update({ where: { id: s.trator.id }, data: { ativo: false } });
    assert.deepEqual((await H.ok(H.req('GET', `/atividades-opcoes/bens?empresa_id=${s.e1.id}${MAQUINAS}`, leitor.token))).itens, []);
    const inativo = await s.conta(null, { ativo: false, nome: 'Responsável Inativo' }).catch(() => null);
    const ops = await H.ok(H.req('GET', `/atividades-opcoes/operadores?empresa_id=${s.e1.id}&q=Respons`, leitor.token));
    assert.ok(ops.itens.some((u) => u.id === leitor.id));
    assert.ok(ops.itens.every((u) => Object.keys(u).sort().join() === 'id,nome'), 'o login nunca sai');
    if (inativo) assert.ok(!ops.itens.some((u) => u.id === inativo.id), 'inativo fora');
    assert.ok(!JSON.stringify(ops).includes(leitor.login));
    const outro = await montarPatrimonio(app, { catalogo: false });
    assert.ok(!(await H.ok(H.req('GET', `/atividades-opcoes/operadores?empresa_id=${outro.e1.id}`, outro.token))).itens.some((u) => u.id === leitor.id), 'outro tenant não vê');
    assert.deepEqual(erro(await H.req('GET', `/atividades-opcoes/bens?empresa_id=${s.e1.id}`, outro.token)).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('concorrência', () => {
  test('dois PATCH com a mesma versão: um ganha, o outro 409; concluir × cancelar: um ganha; aberturas simultâneas não repetem número', async () => {
    const s = await montar();
    const a = await abrirOk(s);
    const rs = await Promise.all([patch(s, a, { versao: 1, nome: 'A' }), patch(s, a, { versao: 1, nome: 'B' })]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' | '));
    assert.equal(rs.find((r) => r.statusCode === 409).json().code, 'ATIVIDADE_VERSAO_CONFLITO');
    assert.equal((await prisma().atividade.findUnique({ where: { id: a.id } })).versao, 2);
    const ds = await Promise.all([acao(s, a, 'concluir', { versao: 2 }), acao(s, a, 'cancelar', { versao: 2, motivo: 'corrida' })]);
    assert.deepEqual(ds.map((r) => r.statusCode).sort(), [200, 409], ds.map((r) => r.body).join(' | '));
    const final = await prisma().atividade.findUnique({ where: { id: a.id } });
    assert.equal(final.versao, 3);
    assert.ok(['CONCLUIDA', 'CANCELADA'].includes(final.status));
    const abs = await Promise.all(Array.from({ length: 5 }, (_, k) => abrir(s, { nome: `Paralela ${k}` })));
    assert.ok(abs.every((r) => r.statusCode === 201), abs.map((r) => r.body).join(' | '));
    assert.deepEqual(abs.map((r) => Number(r.json().numero)).sort((x, y) => x - y), [2, 3, 4, 5, 6]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('exclusão de cadastro usado por atividade: 409, nunca o 403 genérico (#259)', () => {
  test('tipo, grupo e unidade (rotas com código próprio) e tarefa (ATIVIDADE_VINCULADA) usados por atividade → 409; nada apagado', async () => {
    const s = await montar();
    const p = prisma();
    // A unidade e os centros vêm do tipo; tirá-los do tipo deixa só a atividade segurando (snapshot).
    const a = await abrirOk(s, { lancamento_tarefa_id: s.tarefa1.id });
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { unidade_producao_id: null, centro_custo_padrao_id: null, centro_resultado_padrao_id: null } });
    // Um grupo segurado só pela atividade (o snapshot do grupo).
    const grupoSo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: 'SÓ DA ATIVIDADE' } });
    await p.atividade.update({ where: { id: a.id }, data: { grupo_atividade_id: grupoSo.id, grupo_atividade_nome: grupoSo.nome_grupo } });

    const tipo = await H.req('DELETE', `/tipos-atividade/${s.tipo.id}`, s.token);
    assert.deepEqual(erro(tipo).slice(0, 2), [409, 'TIPO_ATIVIDADE_DELETE_BLOCKED'], tipo.body);
    const grupo = await H.req('DELETE', `/grupos-atividade/${grupoSo.id}`, s.token);
    assert.deepEqual(erro(grupo).slice(0, 2), [409, 'GRUPO_ATIVIDADE_DELETE_BLOCKED'], grupo.body);
    const unidade = await H.req('DELETE', `/unidades-medida/${s.un.id}`, s.token);
    assert.deepEqual(erro(unidade).slice(0, 2), [409, 'UNIDADE_MEDIDA_DELETE_BLOCKED'], unidade.body);
    assert.equal(unidade.json().details?.vinculo, 'atividade');
    const tarefa = await H.req('DELETE', `/lancamentos-tarefa/${s.tarefa1.id}`, s.token);
    assert.deepEqual(erro(tarefa).slice(0, 2), [409, 'ATIVIDADE_VINCULADA'], tarefa.body);
    assert.deepEqual(tarefa.json().details, { vinculo: 'lancamento_tarefa_id', entidade: 'atividade' });
    // Nada apagado.
    assert.ok(await p.tipoAtividade.findUnique({ where: { id: s.tipo.id } }));
    assert.ok(await p.grupoAtividade.findUnique({ where: { id: grupoSo.id } }));
    assert.ok(await p.unidadeMedida.findUnique({ where: { id: s.un.id } }));
    assert.ok(await p.lancamentoTarefa.findUnique({ where: { id: s.tarefa1.id } }));
    // Sem a atividade, o mesmo tipo sem uso sai (o 409 era da atividade).
    const livre = await H.req('DELETE', `/tipos-atividade/${s.tipoLivre.id}`, s.token);
    assert.equal(livre.statusCode, 204, livre.body);
  });

  test('área, setor, bem, centros e usuários (sem DELETE pela API) barrados pela FK da atividade ou do apontamento → 409 ATIVIDADE_VINCULADA com o campo', async () => {
    const s = await montar();
    const p = prisma();
    const operador = await p.usuario.create({ data: { cliente_id: s.c, nome: 'Operador do dia', login: `op-${randomUUID().slice(0, 8)}`, senha_hash: 'x' } });
    const a = await abrirOk(s, { area_id: s.area1.id, bem_id: s.trator.id, data_inicio: '2027-06-01' });
    const l = await H.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-02', operador_usuario_id: operador.id });
    assert.equal(l.statusCode, 201, l.body);
    // Setor e área seguros só pela atividade: a área sai do caminho (outra área para o setor não ter área).
    const setorSo = await p.setor.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_setor: 'SS', nome: 'Setor só da atividade' } });
    const b = await abrirOk(s, { nome: 'Sem área' });
    await p.atividade.update({ where: { id: b.id }, data: { setor_id: setorSo.id, setor_nome: setorSo.nome } });
    /** Erro real do Prisma ao apagar, traduzido pelo errorHandler. @param {() => Promise<unknown>} apagar */
    const traduzido = async (apagar) => {
      const e = await apagar().then(() => null, (x) => x);
      assert.ok(e, 'a FK RESTRICT barra');
      const app = normalizarErro(e);
      return [app.status, app.code, app.details];
    };
    const v = (vinculo, entidade = 'atividade') => [409, 'ATIVIDADE_VINCULADA', { vinculo, entidade }];
    assert.deepEqual(await traduzido(() => p.areaPastagem.delete({ where: { id: s.area1.id } })), v('area_id'));
    assert.deepEqual(await traduzido(() => p.setor.delete({ where: { id: setorSo.id } })), v('setor_id'));
    // Os tanques do trator também seguram o bem: saem antes, para só a atividade segurar.
    await p.tanqueBemProduto.deleteMany({ where: { cliente_id: s.c } });
    await p.tanqueBem.deleteMany({ where: { cliente_id: s.c, bem_id: s.trator.id } });
    assert.deepEqual(await traduzido(() => p.bemPatrimonial.delete({ where: { id: s.trator.id } })), v('bem_id'));
    // Os padrões do tipo também seguram os centros (tradutor da Fatia 1): soltos, só o snapshot da atividade segura.
    await p.tipoAtividade.update({ where: { id: s.tipo.id }, data: { centro_custo_padrao_id: null, centro_resultado_padrao_id: null } });
    assert.deepEqual(await traduzido(() => p.centroCusto.delete({ where: { id: s.centro1.id } })), v('centro_custo_id'));
    assert.deepEqual(await traduzido(() => p.centroResultado.delete({ where: { id: s.cr1.id } })), v('centro_resultado_id'));
    assert.deepEqual(await traduzido(() => p.usuario.delete({ where: { id: operador.id } })), v('operador_usuario_id', 'apontamento'));
    // O SQL bruto (P2010/23503) também é reconhecido.
    assert.deepEqual(await traduzido(() => p.$executeRawUnsafe('DELETE FROM "AreaPastagem" WHERE id = $1', s.area1.id)), v('area_id'));
    // A exclusão da fazenda conta a atividade nos vínculos.
    const r = await H.req('DELETE', `/empresas/${s.e1.id}`, s.token);
    assert.deepEqual(erro(r).slice(0, 2), [409, 'EMPRESA_COM_VINCULOS'], r.body);
    assert.ok(r.json().details.vinculos.some((x) => x.entidade === 'Atividade'), r.body);
    // Tudo continua lá.
    assert.ok(await p.areaPastagem.findUnique({ where: { id: s.area1.id } }));
    assert.equal(await p.atividade.count({ where: { cliente_id: s.c } }), 2);
  });
});
