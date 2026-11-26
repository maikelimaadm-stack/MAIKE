/**
 * D-PROD-276 (MAIKE-ENTREGA3) — a REFORMA DE PASTAGEM como agrupador, contra PostgreSQL real e HTTP autenticado.
 *
 * Cobre: o "Planejar" da reforma (`POST /planejamentos`: as áreas com hectares — sem hectares, o tamanho —, o tipo, o
 * capim que vai ficar do Cadastro de Culturas da fazenda e o início previsto; o nome "Reforma · <Área> · <safra>" e a
 * safra do servidor; as recusas de forma, de área e de capim); o "Faz parte de" no `POST /atividades/registrar`
 * (`planejamento_id`: a atividade nova nasce ligada, a que continua só é ligada se não tinha reforma e uma ligação
 * diferente nunca é trocada; a reforma de outra fazenda, de outro tenant, fechada ou sem a área → 422; sem área → 400; o
 * fingerprint byte a byte o de antes sem o campo, e com ele o campo entra); o filtro "Reforma" da lista e o CUSTO da
 * reforma calculado na leitura (total = Σ dos custos da lista, R$/ha = total ÷ hectares da reforma, por tipo, os serviços
 * em ordem de data, a cancelada fora da soma; nada gravado); o resumo da área (as reformas abertas, o `planejamento_id`
 * de cada atividade); a conclusão (com e sem a troca do capim das áreas pelo caminho da área, auditada; as datas; a
 * versão; o status) e o cancelamento (nada apagado); as permissões (ver, criar, concluir — e a troca do capim, que pede
 * também o editar do Mapa Cadastro —, cancelar) e o tenant.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma, MODULO, TELA } from './atividadeLinhaCustoCenario.mjs';
import { fingerprintDePayload } from '../src/shared/idempotency/operacaoIdempotenteService.js';
import { VAZIO, camposDoCorpo, canonico, linhasDoCorpo, linhasNovasDoFingerprint, origemDoCorpo } from '../src/modules/atividades/atividadeApontamentoService.js';
import { TIPO_OPERACAO_REGISTRAR } from '../src/modules/atividades/atividadeRegistroService.js';
import { NOME_MAXIMO } from '../src/modules/atividades/atividadeService.js';
import {
  AREAS_NO_PLANEJAMENTO_MAXIMO, PREFIXO_DO_TIPO, STATUS_PLANEJAMENTO, TIPOS_PLANEJAMENTO, nomeDoPlanejamento,
} from '../src/modules/atividades/planejamentoService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
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

const dia = (d) => (d ? d.toISOString().slice(0, 10) : null);

const montar = async () => {
  const s = await montarLinhasCusto(app);
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  let n = 0;
  /** Uma operação de um tipo fixo, com as quatro seções permitidas (como a tela cria). */
  const operacao = (categoria, extra = {}) =>
    p.tipoAtividade.create({
      data: {
        cliente_id: s.c, nome_tipo: `${categoria} ${suf} ${(n += 1)}`, grupo_atividade_id: s.grupo.id, grupo_atividade_nome: s.grupo.nome_grupo, categoria,
        exige_area: true, permite_produto: true, permite_mao_obra: true, permite_servico: true, permite_implemento: true, ...extra,
      },
    });
  const preparo = await operacao('PREPARO_SOLO');
  const fertilizacao = await operacao('TRATO_CULTURAL');
  const aplicacao = await operacao('APLICACAO');
  const rocada = await operacao('PASTAGEM');
  const manutencao = await operacao('BENFEITORIA');
  /** Uma cultura do cadastro (CADCULTURAS) numa fazenda. */
  const cultura = (empresa, nome, extra = {}) =>
    p.cultura.create({ data: { cliente_id: s.c, empresa_id: empresa.id, codigo: `C${(n += 1)}`, tipo: 'PASTAGEM', nome, ...extra } });
  const mombaca = await cultura(s.e1, `MOMBAÇA ${suf}`, { especie: 'Megathyrsus maximus', cultivar: 'Mombaça' });
  const braquiarinha = await cultura(s.e1, `BRAQUIARINHA ${suf}`);
  const inativa = await cultura(s.e1, `CAPIM ANTIGO ${suf}`, { ativo: false });
  const daFazenda2 = await cultura(s.e2, `MOMBAÇA DA FAZENDA 2 ${suf}`);
  // A área da reforma (40 ha, BRAQUIARINHA hoje) e uma segunda área (12 ha, já MOMBAÇA).
  const novaArea = async (nome, tamanho, culturaId = null) =>
    p.areaPastagem.create({
      data: {
        cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: tamanho,
        ...(culturaId ? { cultura_id: culturaId } : {}),
      },
    });
  const aroeira = await novaArea('PASTO DA AROEIRA', '40', braquiarinha.id);
  const sede = await novaArea('PASTO DA SEDE', '12', mombaca.id);
  const fora = await novaArea('PASTO DE FORA', '20');

  const planejar = (corpo = {}, tok = s.token) =>
    s.H.req('POST', '/planejamentos', tok, { empresa_id: s.e1.id, tipo: 'REFORMA', areas: [{ area_id: aroeira.id }], cultura_alvo_id: mombaca.id, data_inicio: '2026-09-10', ...corpo });
  const reforma = async (corpo = {}, tok = s.token) => s.H.ok(planejar(corpo, tok), 201);
  const ler = (id, tok = s.token, empresa = s.e1) => s.H.req('GET', `/planejamentos/${id}?empresa_id=${empresa.id}`, tok);
  const corpoBase = (corpo = {}) => ({
    empresa_id: s.e1.id, area_id: aroeira.id, tipo_atividade_id: preparo.id, data_operacional: '2027-06-10', operation_id: opId('rf'), ...corpo,
  });
  const registrar = (corpo = {}, tok = s.token) => s.H.req('POST', '/atividades/registrar', tok, corpoBase(corpo));
  const ok = async (corpo, tok) => {
    const r = await registrar(corpo, tok);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const atividade = (id) => p.atividade.findUnique({ where: { id } });
  /** Nada do registro foi gravado (fora a atividade do cenário). */
  const nada = async () => assert.equal(await p.atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: { not: s.atividade.id } } }), 0);
  const concluir = (r, extra = {}, tok = s.token) => s.H.req('POST', `/planejamentos/${r.id}/concluir`, tok, { empresa_id: s.e1.id, versao: r.versao, ...extra });
  const cancelar = (r, extra = {}, tok = s.token) => s.H.req('POST', `/planejamentos/${r.id}/cancelar`, tok, { empresa_id: s.e1.id, versao: r.versao, ...extra });
  const auditoria = (acao, entidadeId) => p.auditLog.findMany({ where: { cliente_id: s.c, acao, ...(entidadeId ? { entidade_id: entidadeId } : {}) }, orderBy: { createdAt: 'asc' } });
  /** Conta do tenant com as ações dadas na tela `op-atividades` (e, se pedido, o Mapa Cadastro). */
  const contaCom = (acoes = {}, mapaCadastro = null) =>
    s.conta({
      modulos_permitidos: [MODULO, ...(mapaCadastro ? ['mapa'] : [])],
      permissoes_telas: [
        { modulo_id: MODULO, tela_id: TELA, visualizar: true, ...acoes },
        ...(mapaCadastro ? [{ modulo_id: 'mapa', tela_id: 'pec-mapa-cadastro', visualizar: true, ...mapaCadastro }] : []),
      ],
    });
  return {
    ...s, preparo, fertilizacao, aplicacao, rocada, manutencao, mombaca, braquiarinha, inativa, daFazenda2, aroeira, sede, fora,
    planejar, reforma, ler, corpoBase, registrar, ok, atividade, nada, concluir, cancelar, auditoria, contaCom, cultura, novaArea,
  };
};

describe('as regras puras', () => {
  test('o nome sugerido: "<Tipo> · <Área> · <safra>", "+N" com mais áreas, a safra de julho a junho, sempre dentro do teto (a área encurta)', () => {
    assert.deepEqual(TIPOS_PLANEJAMENTO, ['REFORMA', 'FORMACAO', 'OUTRO']);
    assert.deepEqual(STATUS_PLANEJAMENTO, { ABERTO: 'ABERTO', CONCLUIDO: 'CONCLUIDO', CANCELADO: 'CANCELADO' });
    assert.deepEqual(PREFIXO_DO_TIPO, { REFORMA: 'Reforma', FORMACAO: 'Formação', OUTRO: 'Planejamento' });
    assert.equal(AREAS_NO_PLANEJAMENTO_MAXIMO, 20);
    assert.equal(nomeDoPlanejamento('REFORMA', ['PASTO DA AROEIRA'], '2026-09-10'), 'Reforma · PASTO DA AROEIRA · 2026/27');
    assert.equal(nomeDoPlanejamento('REFORMA', ['PASTO DA AROEIRA'], '2027-06-30'), 'Reforma · PASTO DA AROEIRA · 2026/27');
    assert.equal(nomeDoPlanejamento('FORMACAO', ['PASTO NOVO', 'B', 'C'], '2027-07-01'), 'Formação · PASTO NOVO +2 · 2027/28');
    assert.equal(nomeDoPlanejamento('OUTRO', ['X'], '2026-01-05'), 'Planejamento · X · 2025/26');
    const longo = nomeDoPlanejamento('REFORMA', ['A'.repeat(300), 'B'], '2026-09-10');
    assert.equal(longo.length, NOME_MAXIMO);
    assert.ok(longo.startsWith('Reforma · AAAA') && longo.endsWith(' +1 · 2026/27'), longo);
  });
});

describe('Planejar a reforma (POST /planejamentos)', () => {
  test('cria com o nome e a safra do servidor, o número da sequência, as áreas (sem hectares = o tamanho) e o capim que vai ficar; auditado', async () => {
    const s = await montar();
    const r = await s.reforma({ areas: [{ area_id: s.aroeira.id }, { area_id: s.sede.id, hectares: '10.5' }] });
    assert.equal(r.nome, 'Reforma · PASTO DA AROEIRA +1 · 2026/27');
    assert.equal(r.tipo, 'REFORMA');
    assert.equal(r.safra_ciclo, '2026/27');
    assert.equal(r.status, 'ABERTO');
    assert.equal(r.data_inicio, '2026-09-10');
    assert.equal(r.data_conclusao, null);
    assert.equal(r.versao, 1);
    assert.match(r.numero, /^\d+$/);
    assert.equal(r.cultura_alvo_id, s.mombaca.id);
    assert.equal(r.cultura_alvo.nome, s.mombaca.nome);
    assert.equal(r.hectares, '50.5000');
    assert.deepEqual(
      r.areas.map((a) => [a.area_id, a.nome, a.hectares, a.tamanho_hectares, a.cultura_id]),
      [[s.aroeira.id, 'PASTO DA AROEIRA', '40.0000', '40.0000', s.braquiarinha.id], [s.sede.id, 'PASTO DA SEDE', '10.5000', '12.0000', s.mombaca.id]]
    );
    // Sem realização nenhuma: o custo é vazio, nada inventado.
    assert.deepEqual(r.custo, { custo_total: null, hectares: '50.5000', custo_por_ha: null, por_tipo: [], servicos: [] });
    const banco = await prisma().planejamento.findUnique({ where: { id: r.id }, include: { areas: true } });
    assert.equal(banco.cliente_id, s.c);
    assert.equal(banco.empresa_id, s.e1.id);
    assert.equal(banco.areas.length, 2);
    const [evento] = await s.auditoria('planejamento.criar', r.id);
    assert.equal(evento.dados_novos.nome, r.nome);
    assert.deepEqual(evento.dados_novos.areas, [{ area_id: s.aroeira.id, hectares: '40.0000' }, { area_id: s.sede.id, hectares: '10.5000' }]);
    // O segundo planejamento ganha o número seguinte; o capim é opcional; o início pode ser futuro (é previsto).
    const r2 = await s.reforma({ tipo: 'FORMACAO', cultura_alvo_id: null, areas: [{ area_id: s.fora.id }], data_inicio: '2027-08-01' });
    assert.equal(Number(r2.numero), Number(r.numero) + 1);
    assert.equal(r2.nome, 'Formação · PASTO DE FORA · 2027/28');
    assert.equal(r2.cultura_alvo, null);
  });

  test('recusas de forma (400): tipo fora da lista, sem áreas, hectares número/zero/negativo, sem início, campos do servidor e cliente_id no corpo', async () => {
    const s = await montar();
    const casos = [
      [{ tipo: 'COLHEITA' }, 400],
      [{ areas: [] }, 400],
      [{ areas: [{ area_id: s.aroeira.id, hectares: 10 }] }, 400],
      [{ areas: [{ area_id: s.aroeira.id, hectares: '0' }] }, 400],
      [{ areas: [{ area_id: s.aroeira.id, hectares: '-1' }] }, 400],
      [{ data_inicio: undefined }, 400],
      [{ data_inicio: '2026-02-30' }, 422],
      [{ nome: 'OUTRO NOME' }, 400],
      [{ numero: '9' }, 400],
      [{ status: 'CONCLUIDO' }, 400],
      [{ safra_ciclo: '2030/31' }, 400],
      [{ cliente_id: s.c }, 400],
    ];
    for (const [corpo, status] of casos) {
      const r = await s.planejar(corpo);
      assert.equal(r.statusCode, status, `${JSON.stringify(corpo)} ${r.body}`);
    }
    assert.equal(await prisma().planejamento.count({ where: { cliente_id: s.c } }), 0);
  });

  test('recusas de referência (422): área repetida, de outra fazenda, inexistente ou inativa; capim de outra fazenda, inexistente ou inativo', async () => {
    const s = await montar();
    const inativa = await prisma().areaPastagem.update({ where: { id: s.fora.id }, data: { ativo: false } });
    const casos = [
      [{ areas: [{ area_id: s.aroeira.id }, { area_id: s.aroeira.id }] }, 'areas[1].area_id', 'duplicada'],
      [{ areas: [{ area_id: s.area2.id }] }, 'areas[0].area_id', 'outra_empresa'],
      [{ areas: [{ area_id: 'nao-existe' }] }, 'areas[0].area_id', 'inexistente'],
      [{ areas: [{ area_id: inativa.id }] }, 'areas[0].area_id', 'inativo'],
      [{ cultura_alvo_id: s.daFazenda2.id }, 'cultura_alvo_id', 'inexistente'],
      [{ cultura_alvo_id: 'nao-existe' }, 'cultura_alvo_id', 'inexistente'],
      [{ cultura_alvo_id: s.inativa.id }, 'cultura_alvo_id', 'inativo'],
    ];
    for (const [corpo, campo, reason] of casos) assert.deepEqual(erro(await s.planejar(corpo)), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', campo, reason], JSON.stringify(corpo));
    assert.equal(await prisma().planejamento.count({ where: { cliente_id: s.c } }), 0);
  });

  test('a lista: abertas primeiro, filtros por status e área; o detalhe de outra fazenda ou de outro tenant é 404', async () => {
    const s = await montar();
    const a = await s.reforma();
    const b = await s.reforma({ areas: [{ area_id: s.sede.id }], data_inicio: '2026-10-01' });
    await s.H.ok(s.cancelar(b));
    const c = await s.reforma({ areas: [{ area_id: s.fora.id }], data_inicio: '2026-08-01' });
    const lista = await s.H.ok(s.H.req('GET', `/planejamentos?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(lista.items.map((x) => x.id), [a.id, c.id, b.id], 'abertas (início mais recente primeiro) e depois a cancelada');
    const abertas = await s.H.ok(s.H.req('GET', `/planejamentos?empresa_id=${s.e1.id}&status=ABERTO`, s.token));
    assert.deepEqual(abertas.items.map((x) => x.id), [a.id, c.id]);
    const daSede = await s.H.ok(s.H.req('GET', `/planejamentos?empresa_id=${s.e1.id}&area_id=${s.sede.id}`, s.token));
    assert.deepEqual(daSede.items.map((x) => x.id), [b.id]);
    assert.equal((await s.H.req('GET', `/planejamentos?empresa_id=${s.e1.id}&cliente_id=${s.c}`, s.token)).statusCode, 400);
    assert.deepEqual(erro(await s.ler(a.id, s.token, s.e2)).slice(0, 2), [404, 'PLANEJAMENTO_NOT_FOUND']);
    const outro = await montarLinhasCusto(app);
    assert.deepEqual(erro(await s.H.req('GET', `/planejamentos/${a.id}?empresa_id=${outro.e1.id}`, outro.token)).slice(0, 2), [404, 'PLANEJAMENTO_NOT_FOUND']);
    assert.deepEqual((await outro.H.ok(outro.H.req('GET', `/planejamentos?empresa_id=${outro.e1.id}`, outro.token))).items, []);
  });
});

describe('"Faz parte de" no registro de campo (planejamento_id)', () => {
  test('a atividade NOVA nasce ligada à reforma; a resposta, a forma pública e a auditoria dizem qual', async () => {
    const s = await montar();
    const ref = await s.reforma();
    const r = await s.ok({ area_executada_dia: '8', planejamento_id: ref.id });
    assert.equal(r.registro.atividade_criada, true);
    assert.equal(r.registro.planejamento_id, ref.id);
    assert.equal(r.registro.planejamento_ligacao, 'criada');
    assert.equal(r.atividade.planejamento_id, ref.id);
    assert.deepEqual(r.atividade.planejamento, { id: ref.id, numero: ref.numero, nome: ref.nome, status: 'ABERTO' });
    assert.equal((await s.atividade(r.registro.atividade_id)).planejamento_id, ref.id);
    const [abrir] = await s.auditoria('atividade.abrir', r.registro.atividade_id);
    assert.equal(abrir.dados_novos.planejamento_id, ref.id);
  });

  test('sem planejamento_id: a atividade fica sem reforma, como sempre (mesmo com a reforma aberta na área)', async () => {
    const s = await montar();
    await s.reforma();
    const r = await s.ok({ area_executada_dia: '8' });
    assert.equal(r.registro.planejamento_id, null);
    assert.equal(r.registro.planejamento_ligacao, null);
    assert.equal(r.atividade.planejamento_id, null);
    assert.equal(r.atividade.planejamento, null);
  });

  test('CONTINUAR: a atividade sem reforma é ligada (auditado); a ligada a OUTRA reforma nunca é trocada; sem o campo, a ligação fica', async () => {
    const s = await montar();
    const a = await s.reforma();
    const b = await s.reforma({ data_inicio: '2026-10-01' });
    // 1º dia sem "Faz parte de" (o "tirar"): a atividade nasce sem reforma.
    const d1 = await s.ok({ area_executada_dia: '5', data_operacional: '2027-06-08' });
    assert.equal(d1.atividade.planejamento_id, null);
    // 2º dia com a reforma A: continua a mesma atividade e a liga.
    const d2 = await s.ok({ area_executada_dia: '5', data_operacional: '2027-06-09', planejamento_id: a.id });
    assert.equal(d2.registro.atividade_id, d1.registro.atividade_id);
    assert.equal(d2.registro.atividade_criada, false);
    assert.deepEqual([d2.registro.planejamento_id, d2.registro.planejamento_ligacao], [a.id, 'completada']);
    assert.equal(d2.atividade.planejamento_id, a.id);
    const [ligou] = await s.auditoria('atividade.planejamento', d1.registro.atividade_id);
    assert.deepEqual([ligou.dados_anteriores, ligou.dados_novos], [{ planejamento_id: null }, { planejamento_id: a.id, origem_registro_de_campo: true }]);
    // 3º dia com a reforma B: a ligação com A fica.
    const d3 = await s.ok({ area_executada_dia: '5', data_operacional: '2027-06-10', planejamento_id: b.id });
    assert.equal(d3.registro.atividade_id, d1.registro.atividade_id);
    assert.deepEqual([d3.registro.planejamento_id, d3.registro.planejamento_ligacao], [a.id, 'mantida_outra']);
    // 4º dia com A de novo: já ligada; 5º sem o campo: continua ligada.
    const d4 = await s.ok({ area_executada_dia: '5', data_operacional: '2027-06-11', planejamento_id: a.id });
    assert.equal(d4.registro.planejamento_ligacao, 'ja_ligada');
    const d5 = await s.ok({ area_executada_dia: '5', data_operacional: '2027-06-12' });
    assert.deepEqual([d5.registro.planejamento_id, d5.registro.planejamento_ligacao], [a.id, null]);
    assert.equal((await s.atividade(d1.registro.atividade_id)).planejamento_id, a.id);
    assert.equal((await s.auditoria('atividade.planejamento')).length, 1, 'só a ligação do 2º dia');
  });

  test('várias áreas: a reforma tem de ter TODAS as áreas do registro (senão 422 area_fora com a área); com todas, a atividade nasce ligada', async () => {
    const s = await montar();
    const so = await s.reforma();
    const ambas = await s.reforma({ areas: [{ area_id: s.aroeira.id }, { area_id: s.sede.id }] });
    const areas = [{ area_id: s.aroeira.id, hectares: '4' }, { area_id: s.sede.id, hectares: '2' }];
    const r = await s.registrar({ area_id: undefined, areas, planejamento_id: so.id });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'planejamento_id', 'area_fora']);
    assert.equal(r.json().details.area_id, s.sede.id);
    await s.nada();
    const ok = await s.ok({ area_id: undefined, areas, planejamento_id: ambas.id });
    assert.equal(ok.atividade.planejamento_id, ambas.id);
    assert.equal(ok.atividade.areas.length, 2);
  });

  test('recusas: reforma de outra fazenda ou inexistente (inexistente), concluída ou cancelada (fechado), sem a área (area_fora), sem área (400); nada gravado', async () => {
    const s = await montar();
    const daOutraArea = await s.reforma({ areas: [{ area_id: s.fora.id }] });
    const fechada = await s.reforma();
    await s.H.ok(s.concluir(fechada, { data_conclusao: '2027-06-01' }));
    const cancelada = await s.reforma();
    await s.H.ok(s.cancelar(cancelada));
    // A reforma de outra fazenda (E2) do mesmo tenant.
    const e2 = await s.H.ok(s.H.req('POST', '/planejamentos', s.token, { empresa_id: s.e2.id, tipo: 'REFORMA', areas: [{ area_id: s.area2.id }], data_inicio: '2026-09-10' }), 201);
    const casos = [
      [e2.id, 'inexistente'],
      ['nao-existe', 'inexistente'],
      [fechada.id, 'fechado'],
      [cancelada.id, 'fechado'],
      [daOutraArea.id, 'area_fora'],
    ];
    for (const [id, reason] of casos) {
      assert.deepEqual(erro(await s.registrar({ area_executada_dia: '3', planejamento_id: id })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'planejamento_id', reason], `${id}`);
    }
    // Manutenção sem área (com o local): não faz parte de reforma.
    const semArea = await s.registrar({ area_id: undefined, tipo_atividade_id: s.manutencao.id, local: 'DIVISA NORTE', planejamento_id: daOutraArea.id });
    assert.deepEqual(erro(semArea), [400, 'REQUEST_VALIDATION_FAILED', 'planejamento_id', 'sem_area']);
    // Número no lugar do id: vira texto como os outros ids do registro (a coerção do schema) e não acha reforma nenhuma.
    assert.deepEqual(erro(await s.registrar({ area_executada_dia: '3', planejamento_id: 7 })).slice(2), ['planejamento_id', 'inexistente']);
    await s.nada();
    assert.equal(await prisma().atividade.count({ where: { cliente_id: s.c, planejamento_id: { not: null } } }), 0);
  });

  test('idempotência: sem planejamento_id o fingerprint é byte a byte o de antes; com ele, ele entra (o mesmo envio repete, outro valor → 409)', async () => {
    const s = await montar();
    const ref = await s.reforma();
    const operation_id = opId('fp');
    const corpo = s.corpoBase({
      operation_id, tipo_atividade_id: s.fertilizacao.id, area_executada_dia: '3', turno: 'MANHA', observacao: 'adubou',
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '2' }],
    });
    const um = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(um.statusCode, 201, um.body);
    const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
    const linhas = linhasDoCorpo(corpo);
    const antes = fingerprintDePayload({
      v: 1, empresa_id: corpo.empresa_id, area_id: corpo.area_id, tipo_atividade_id: corpo.tipo_atividade_id, safra_ciclo: null, estado, origem: origemDoCorpo(corpo.origem),
      produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas),
    });
    const recibo = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, operation_key: operation_id, tipo_operacao: TIPO_OPERACAO_REGISTRAR } });
    assert.equal(recibo.fingerprint, antes, 'a fórmula de antes: o reenvio pendente feito antes do deploy ainda casa');
    // Reenvio igual (e com planejamento_id nulo) → replay; com a reforma → corpo diferente → 409.
    for (const extra of [{}, { planejamento_id: null }]) {
      const r = await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo, ...extra });
      assert.equal(r.statusCode, 200, `${JSON.stringify(extra)} ${r.body}`);
      assert.equal(r.json().replay, true);
    }
    assert.equal((await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo, planejamento_id: ref.id })).statusCode, 409);
    // Com a reforma desde o 1º envio: ela entra no fingerprint (depois de tudo o que já entrava).
    const op2 = opId('fp2');
    const corpo2 = s.corpoBase({ operation_id: op2, area_id: s.sede.id, area_executada_dia: '2', planejamento_id: undefined });
    const ref2 = await s.reforma({ areas: [{ area_id: s.sede.id }] });
    const dois = await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo2, planejamento_id: ref2.id });
    assert.equal(dois.statusCode, 201, dois.body);
    const est2 = { ...VAZIO, ...camposDoCorpo(corpo2) };
    const lin2 = linhasDoCorpo(corpo2);
    const com = fingerprintDePayload({
      v: 1, empresa_id: corpo2.empresa_id, area_id: corpo2.area_id, tipo_atividade_id: corpo2.tipo_atividade_id, safra_ciclo: null, estado: est2,
      planejamento_id: ref2.id, origem: origemDoCorpo(corpo2.origem), produtos: lin2.produtos, maquinas: canonico(lin2.maquinas), ...linhasNovasDoFingerprint(lin2),
    });
    const recibo2 = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, operation_key: op2, tipo_operacao: TIPO_OPERACAO_REGISTRAR } });
    assert.equal(recibo2.fingerprint, com);
    const rep = await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo2, planejamento_id: ref2.id });
    assert.equal(rep.statusCode, 200, rep.body);
    assert.equal((await s.H.req('POST', '/atividades/registrar', s.token, corpo2)).statusCode, 409, 'sem a reforma é outro corpo');
  });
});

describe('o custo da reforma (calculado na leitura) e o filtro "Reforma" da lista', () => {
  test('custo total = Σ dos custos da lista; R$/ha = total ÷ hectares da reforma; por tipo; serviços em ordem de data; a cancelada aparece mas não soma; nada gravado', async () => {
    const s = await montar();
    const ref = await s.reforma({ areas: [{ area_id: s.aroeira.id }, { area_id: s.sede.id, hectares: '10' }] });
    const insumo = (q) => [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: q }];
    // Preparo (20 un × R$ 5 = R$ 100), Fertilização (30 un = R$ 150) nas duas áreas, Aplicação (10 un = R$ 50), e uma
    // Roçada (4 un = R$ 20) que depois é CANCELADA (não soma).
    const prep = await s.ok({ data_operacional: '2027-06-05', area_executada_dia: '10', produtos: insumo('20'), planejamento_id: ref.id });
    const fert = await s.ok({
      data_operacional: '2027-06-07', tipo_atividade_id: s.fertilizacao.id, area_id: undefined,
      areas: [{ area_id: s.aroeira.id, hectares: '30' }, { area_id: s.sede.id, hectares: '10' }], produtos: insumo('30'), planejamento_id: ref.id,
    });
    const apl = await s.ok({ data_operacional: '2027-06-03', tipo_atividade_id: s.aplicacao.id, area_executada_dia: '40', produtos: insumo('10'), planejamento_id: ref.id });
    // Uma realização da área FORA da reforma (o "tirar"): não entra.
    await s.ok({ data_operacional: '2027-06-06', tipo_atividade_id: s.rocada.id, area_id: s.sede.id, area_executada_dia: '1', produtos: insumo('6') });
    // D-PROD-314: a Roçada cancelada é a ÚLTIMA lançada no depósito do herbicida (com outra linha de produto lançada
    // depois no mesmo depósito, o cancelamento seria 409 ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR).
    const roc = await s.ok({ data_operacional: '2027-06-09', tipo_atividade_id: s.rocada.id, area_executada_dia: '2', produtos: insumo('4'), planejamento_id: ref.id });
    const rocAtual = await s.atividade(roc.registro.atividade_id);
    await s.H.ok(s.H.req('POST', `/atividades/${rocAtual.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: rocAtual.versao, motivo: 'lançado errado' }));

    const antes = await prisma().planejamento.findUnique({ where: { id: ref.id } });
    const d = await s.H.ok(s.ler(ref.id));
    // Os mesmos números da lista ("Reuse o custo que a lista já mostra"): o filtro "Reforma".
    const lista = await s.H.ok(s.H.req('GET', `/atividades?empresa_id=${s.e1.id}&planejamento_id=${ref.id}`, s.token));
    const daLista = new Map(lista.items.map((i) => [i.id, i.custo_total]));
    assert.equal(lista.items.length, 4, 'as 4 ligadas (inclusive a cancelada), nenhuma de fora');
    assert.ok(lista.items.every((i) => i.planejamento_id === ref.id));
    const somaDaLista = lista.items.filter((i) => i.status !== 'CANCELADA').reduce((t, i) => t + Number(i.custo_total ?? 0), 0);
    assert.equal(Number(d.custo.custo_total), somaDaLista);
    assert.equal(d.custo.custo_total, '300.0000');
    assert.equal(d.custo.hectares, '50.0000');
    assert.equal(d.custo.custo_por_ha, '6.0000', 'R$ 300 ÷ 50 ha');
    assert.deepEqual(d.custo.por_tipo, [
      { tipo_fixo: 'PREPARO_SOLO', rotulo: 'Preparo do solo', custo_total: '100.0000', servicos: 1 },
      { tipo_fixo: 'TRATO_CULTURAL', rotulo: 'Fertilização', custo_total: '150.0000', servicos: 1 },
      { tipo_fixo: 'APLICACAO', rotulo: 'Aplicação', custo_total: '50.0000', servicos: 1 },
    ]);
    assert.deepEqual(
      d.custo.servicos.map((x) => [x.atividade_id, x.tipo_fixo, x.situacao, x.primeiro_dia, x.custo_total, x.conta_no_custo]),
      [
        [apl.registro.atividade_id, 'APLICACAO', 'EM_ANDAMENTO', '2027-06-03', daLista.get(apl.registro.atividade_id), true],
        [prep.registro.atividade_id, 'PREPARO_SOLO', 'EM_ANDAMENTO', '2027-06-05', daLista.get(prep.registro.atividade_id), true],
        [fert.registro.atividade_id, 'TRATO_CULTURAL', 'EM_ANDAMENTO', '2027-06-07', daLista.get(fert.registro.atividade_id), true],
        [roc.registro.atividade_id, 'PASTAGEM', 'CANCELADA', null, daLista.get(roc.registro.atividade_id) ?? null, false],
      ]
    );
    // Nada de custo é gravado na reforma (a leitura não muda a linha).
    const depois = await prisma().planejamento.findUnique({ where: { id: ref.id } });
    assert.deepEqual(depois, antes);
    // O filtro da lista sem reforma de outro tenant / id qualquer: lista vazia, nunca erro.
    assert.deepEqual((await s.H.ok(s.H.req('GET', `/atividades?empresa_id=${s.e1.id}&planejamento_id=nao-existe`, s.token))).items, []);
  });
});

describe('o resumo da área (o "Faz parte de" e o "Em reforma desde")', () => {
  test('as reformas ABERTAS da área (com todas as áreas de cada uma) e o planejamento_id de cada atividade; a concluída sai', async () => {
    const s = await montar();
    const a = await s.reforma({ areas: [{ area_id: s.aroeira.id }, { area_id: s.sede.id }] });
    const b = await s.reforma({ cultura_alvo_id: null, data_inicio: '2026-11-01' });
    await s.reforma({ areas: [{ area_id: s.fora.id }] });
    const reg = await s.ok({ area_executada_dia: '3', planejamento_id: a.id });
    const resumo = await s.H.ok(s.H.req('GET', `/atividades-por-area/${s.aroeira.id}/resumo?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(
      resumo.planejamentos.map((x) => [x.id, x.nome, x.data_inicio, x.cultura_alvo?.id ?? null, [...x.area_ids].sort(), x.hectares_na_area]),
      [
        [a.id, a.nome, '2026-09-10', s.mombaca.id, [s.aroeira.id, s.sede.id].sort(), '40.0000'],
        [b.id, b.nome, '2026-11-01', null, [s.aroeira.id], '40.0000'],
      ]
    );
    assert.equal(resumo.atividades.find((x) => x.atividade_id === reg.registro.atividade_id).planejamento_id, a.id);
    await s.H.ok(s.concluir(a, { data_conclusao: '2027-06-12' }));
    const depois = await s.H.ok(s.H.req('GET', `/atividades-por-area/${s.aroeira.id}/resumo?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(depois.planejamentos.map((x) => x.id), [b.id]);
  });
});

describe('Concluir e cancelar a reforma', () => {
  test('concluir SEM trocar o capim: CONCLUIDO na data (padrão hoje), versão +1, o capim das áreas fica; auditado', async () => {
    const s = await montar();
    const ref = await s.reforma();
    const r = await s.H.ok(s.concluir(ref));
    assert.equal(r.status, 'CONCLUIDO');
    assert.equal(r.data_conclusao, '2027-06-15', 'o hoje da fazenda');
    assert.equal(r.versao, 2);
    assert.deepEqual(r.capim_trocado_nas_areas, []);
    assert.equal((await prisma().areaPastagem.findUnique({ where: { id: s.aroeira.id } })).cultura_id, s.braquiarinha.id);
    const [ev] = await s.auditoria('planejamento.concluir', ref.id);
    assert.equal(ev.dados_novos.trocar_capim, false);
    assert.equal(ev.dados_anteriores.status, 'ABERTO');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, acao: 'update', entidade: 'AreaPastagem' } }), 0);
  });

  test('concluir COM a troca do capim: só as áreas com outro capim mudam, pelo caminho da área (tipo_pastagem = o nome da cultura; auditoria update da área)', async () => {
    const s = await montar();
    const ref = await s.reforma({ areas: [{ area_id: s.aroeira.id }, { area_id: s.sede.id }, { area_id: s.fora.id }] });
    const r = await s.H.ok(s.concluir(ref, { data_conclusao: '2027-06-14', trocar_capim: true }));
    assert.equal(r.status, 'CONCLUIDO');
    assert.deepEqual([...r.capim_trocado_nas_areas].sort(), [s.aroeira.id, s.fora.id].sort(), 'a Sede já era MOMBAÇA');
    for (const id of [s.aroeira.id, s.sede.id, s.fora.id]) assert.equal((await prisma().areaPastagem.findUnique({ where: { id } })).cultura_id, s.mombaca.id, id);
    // O caminho da área deriva o tipo de pastagem do nome da cultura (nas que mudaram).
    for (const id of [s.aroeira.id, s.fora.id]) assert.equal((await prisma().areaPastagem.findUnique({ where: { id } })).tipo_pastagem, s.mombaca.nome, id);
    const updates = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'update', entidade: 'AreaPastagem' } });
    assert.deepEqual(updates.map((u) => u.entidade_id).sort(), [s.aroeira.id, s.fora.id].sort());
    const daAroeira = updates.find((u) => u.entidade_id === s.aroeira.id);
    assert.deepEqual([daAroeira.dados_anteriores.cultura_id, daAroeira.dados_novos.cultura_id], [s.braquiarinha.id, s.mombaca.id]);
    const [ev] = await s.auditoria('planejamento.concluir', ref.id);
    assert.equal(ev.dados_novos.trocar_capim, true);
    assert.deepEqual([...ev.dados_novos.capim_trocado_nas_areas].sort(), [s.aroeira.id, s.fora.id].sort());
  });

  test('recusas da conclusão: trocar o capim sem capim definido (422), no futuro ou antes do início (422), versão velha (409), já concluída (409); nada muda', async () => {
    const s = await montar();
    const semCapim = await s.reforma({ cultura_alvo_id: null });
    assert.deepEqual(erro(await s.concluir(semCapim, { trocar_capim: true })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'trocar_capim', 'sem_capim']);
    const ref = await s.reforma({ data_inicio: '2027-06-01' });
    assert.deepEqual(erro(await s.concluir(ref, { data_conclusao: '2027-06-16' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'futura']);
    assert.deepEqual(erro(await s.concluir(ref, { data_conclusao: '2027-05-31' })), [422, 'ATIVIDADE_DATA_INVALIDA', 'data_conclusao', 'antes_do_inicio']);
    assert.deepEqual(erro(await s.concluir({ ...ref, versao: 9 })).slice(0, 2), [409, 'ATIVIDADE_VERSAO_CONFLITO']);
    assert.equal((await s.concluir(ref, { trocar_capim: 'true' })).statusCode, 400, 'sem coerção');
    const r = await s.H.ok(s.concluir(ref, { trocar_capim: true }));
    const de = await s.concluir(r);
    assert.deepEqual(erro(de).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.equal(de.json().details.entidade, 'planejamento');
    assert.deepEqual(erro(await s.cancelar(r)).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.equal((await prisma().planejamento.findUnique({ where: { id: semCapim.id } })).status, 'ABERTO');
    assert.equal((await prisma().areaPastagem.findUnique({ where: { id: s.aroeira.id } })).cultura_id, s.mombaca.id, 'só a conclusão que passou trocou');
  });

  test('a troca do capim recusada pelo caminho da área desfaz a conclusão inteira (uso sem cultura)', async () => {
    const s = await montar();
    const ref = await s.reforma({ areas: [{ area_id: s.aroeira.id }, { area_id: s.fora.id }] });
    await prisma().areaPastagem.update({ where: { id: s.fora.id }, data: { tipo_cultura: 'Reserva' } });
    const r = await s.concluir(ref, { trocar_capim: true });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'uso_sem_cultura');
    assert.equal((await prisma().planejamento.findUnique({ where: { id: ref.id } })).status, 'ABERTO');
    assert.equal((await prisma().areaPastagem.findUnique({ where: { id: s.aroeira.id } })).cultura_id, s.braquiarinha.id, 'nada mudou: ou tudo ou nada');
  });

  test('cancelar: CANCELADO, nada apagado (as realizações continuam ligadas e com custo); não recebe realização nova', async () => {
    const s = await montar();
    const ref = await s.reforma();
    const reg = await s.ok({ area_executada_dia: '3', planejamento_id: ref.id, produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '2' }] });
    const c = await s.H.ok(s.cancelar(ref));
    assert.deepEqual([c.status, c.data_conclusao, c.versao], ['CANCELADO', null, 2]);
    assert.equal((await s.atividade(reg.registro.atividade_id)).planejamento_id, ref.id);
    assert.equal(c.custo.custo_total, '10.0000');
    assert.equal(await prisma().planejamentoArea.count({ where: { planejamento_id: ref.id } }), 1);
    assert.deepEqual(erro(await s.registrar({ area_executada_dia: '1', planejamento_id: ref.id })).slice(2), ['planejamento_id', 'fechado']);
    const [ev] = await s.auditoria('planejamento.cancelar', ref.id);
    assert.deepEqual([ev.dados_anteriores.status, ev.dados_novos.status], ['ABERTO', 'CANCELADO']);
  });
});

describe('permissões (tela op-atividades) e tenant', () => {
  test('ver = visualizar; criar = novo|salvar; concluir = editar|salvar (+ editar do Mapa Cadastro para trocar o capim); cancelar = excluir; o "Faz parte de" só pede lançar', async () => {
    const s = await montar();
    const ref = await s.reforma();
    const sem = await s.conta(null);
    assert.equal((await s.H.req('GET', `/planejamentos?empresa_id=${s.e1.id}`, sem.token)).statusCode, 403);
    const ver = await s.contaCom();
    assert.equal((await s.H.req('GET', `/planejamentos?empresa_id=${s.e1.id}`, ver.token)).statusCode, 200);
    assert.equal((await s.ler(ref.id, ver.token)).statusCode, 200);
    assert.equal((await s.planejar({}, ver.token)).statusCode, 403);
    assert.equal((await s.concluir(ref, {}, ver.token)).statusCode, 403);
    assert.equal((await s.cancelar(ref, {}, ver.token)).statusCode, 403);
    const novo = await s.contaCom({ novo: true });
    assert.equal((await s.planejar({}, novo.token)).statusCode, 201);
    const editar = await s.contaCom({ editar: true });
    const r1 = await s.reforma();
    assert.equal((await s.concluir(r1, { trocar_capim: true }, editar.token)).statusCode, 403, 'trocar o capim pede o Mapa Cadastro');
    assert.equal((await s.concluir(r1, {}, editar.token)).statusCode, 200);
    const editarComMapa = await s.contaCom({ salvar: true }, { editar: true });
    const r2 = await s.reforma();
    assert.equal((await s.concluir(r2, { trocar_capim: true }, editarComMapa.token)).statusCode, 200);
    const excluir = await s.contaCom({ excluir: true });
    const r3 = await s.reforma();
    assert.equal((await s.cancelar(r3, {}, editar.token)).statusCode, 403);
    assert.equal((await s.cancelar(r3, {}, excluir.token)).statusCode, 200);
    const lancar = await s.contaCom({ lancar_apontamento: true });
    const r4 = await s.reforma();
    const reg = await s.registrar({ area_executada_dia: '2', planejamento_id: r4.id }, lancar.token);
    assert.equal(reg.statusCode, 201, reg.body);
    assert.equal(reg.json().atividade.planejamento_id, r4.id);
  });

  test('o tenant vem da sessão: outro tenant não cria reforma com a área deste nem lê, conclui ou liga a reforma deste', async () => {
    const s = await montar();
    const ref = await s.reforma();
    const outro = await montarLinhasCusto(app);
    assert.deepEqual(
      erro(await outro.H.req('POST', '/planejamentos', outro.token, { empresa_id: outro.e1.id, tipo: 'REFORMA', areas: [{ area_id: s.aroeira.id }], data_inicio: '2026-09-10' })),
      [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'areas[0].area_id', 'inexistente']
    );
    assert.deepEqual(
      erro(await outro.H.req('POST', `/planejamentos/${ref.id}/concluir`, outro.token, { empresa_id: outro.e1.id, versao: 1 })).slice(0, 2),
      [404, 'PLANEJAMENTO_NOT_FOUND']
    );
    assert.deepEqual(erro(await outro.H.req('POST', `/planejamentos/${ref.id}/cancelar`, outro.token, { empresa_id: s.e1.id, versao: 1 })).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    const tipoOutro = await prisma().tipoAtividade.create({
      data: { cliente_id: outro.c, nome_tipo: 'PREPARO X', grupo_atividade_id: outro.grupo.id, grupo_atividade_nome: outro.grupo.nome_grupo, categoria: 'PREPARO_SOLO', permite_produto: true },
    });
    const r = await outro.H.req('POST', '/atividades/registrar', outro.token, {
      empresa_id: outro.e1.id, area_id: outro.area1.id, tipo_atividade_id: tipoOutro.id, data_operacional: '2027-06-10', operation_id: opId('t'), planejamento_id: ref.id,
    });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'planejamento_id', 'inexistente']);
    assert.equal((await prisma().planejamento.findUnique({ where: { id: ref.id } })).status, 'ABERTO');
    assert.equal(dia((await prisma().planejamento.findUnique({ where: { id: ref.id } })).data_inicio), '2026-09-10');
  });
});
