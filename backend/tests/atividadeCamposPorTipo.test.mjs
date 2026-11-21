/**
 * D-PROD-270 (MAIKE-ENTREGA2) — os CAMPOS DE CADA TIPO da "Nova realização de <Tipo>" no `POST /atividades/registrar`,
 * contra PostgreSQL real e HTTP autenticado.
 *
 * Cobre: Plantio de pastagem com o capim OBRIGATÓRIO (do Cadastro de Culturas da fazenda, ativo; outra fazenda ou outro
 * tenant = inexistente), os opcionais (forma, incrustada, cobertura, consórcio) e o capim diferente abrindo OUTRA
 * atividade (o mesmo capim continua; continuar só completa o vazio); a SAFRA automática de 1º de julho a 30 de junho
 * (Plantio, Fertilização e `exige_safra`; a do corpo vale; os outros tipos ficam sem); o fingerprint byte a byte o de antes
 * sem os campos novos; o VC % na linha do insumo (faixa e forma); a carência do produto (cadastro) e o "pasto liberado em"
 * da resposta; o nº do receituário (só Aplicação); Manutenção e Outros SEM ÁREA com o local obrigatório (busca e trava
 * pelo local, a unidade da quantidade feita, concluir, parado) e com área (local recusado); a quantidade feita repartida
 * entre várias áreas; o alvo no cadastro da operação; a lista de referência de capins (os novos, o Marandu 35/20 e a
 * cultura que a fazenda já tem intocada); tenant só da sessão.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { fingerprintDePayload } from '../src/shared/idempotency/operacaoIdempotenteService.js';
import { VAZIO, camposDoCorpo, canonico, linhasDoCorpo, linhasNovasDoFingerprint, origemDoCorpo } from '../src/modules/atividades/atividadeApontamentoService.js';
import {
  FORMAS_PLANTIO, TIPOS_COM_SAFRA, TIPOS_SEM_AREA, TIPO_OPERACAO_REGISTRAR, UNIDADES_FEITAS, pastoLiberadoEm, safraDoDia, tipoFixoDaCategoria,
} from '../src/modules/atividades/atividadeRegistroService.js';
import { LISTA_REFERENCIA } from '../src/modules/culturas/culturaService.js';

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
  const plantio = await operacao('PLANTIO');
  const fertilizacao = await operacao('TRATO_CULTURAL');
  const aplicacao = await operacao('APLICACAO');
  const rocada = await operacao('PASTAGEM');
  const preparo = await operacao('PREPARO_SOLO');
  const manutencao = await operacao('BENFEITORIA');
  const outros = await operacao('OUTROS');
  /** Uma cultura do cadastro (CADCULTURAS) numa fazenda. */
  const cultura = (empresa, nome, extra = {}) =>
    p.cultura.create({ data: { cliente_id: s.c, empresa_id: empresa.id, codigo: `C${(n += 1)}`, tipo: 'PASTAGEM', nome, ...extra } });
  const mombaca = await cultura(s.e1, `PANICUM CV. MOMBAÇA ${suf}`, { especie: 'Megathyrsus maximus', cultivar: 'Mombaça' });
  const marandu = await cultura(s.e1, `BRACHIARIA MARANDU ${suf}`);
  const milho = await cultura(s.e1, `MILHO ${suf}`, { tipo: 'LAVOURA' });
  const inativa = await cultura(s.e1, `CAPIM ANTIGO ${suf}`, { ativo: false });
  const daFazenda2 = await cultura(s.e2, `MOMBAÇA DA FAZENDA 2 ${suf}`);
  /** Semente com estoque (kg). */
  const semente = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SM-${suf}`, nome_produto: `Semente Mombaça ${suf}`, unidade_principal_estoque: 'KG' } });
  await s.lote(s.e1, semente, s.local, { quantidade: '500.0000', custo: '30.0000', dia: '2026-10-01' });
  const corpoBase = (corpo = {}) => ({
    empresa_id: s.e1.id, area_id: s.area1.id, tipo_atividade_id: plantio.id, data_operacional: '2027-06-10', operation_id: opId('cpt'), ...corpo,
  });
  const registrar = (corpo = {}, tok = s.token) => s.H.req('POST', '/atividades/registrar', tok, corpoBase(corpo));
  const ok = async (corpo, tok) => {
    const r = await registrar(corpo, tok);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const novaArea = (nome, tamanho = '40') =>
    p.areaPastagem.create({
      data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome, tamanho_hectares: tamanho },
    });
  /** As atividades do registro de campo (a do cenário fica de fora). */
  const atividades = () => p.atividade.findMany({ where: { cliente_id: s.c, id: { not: s.atividade.id } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const atividade = (id) => p.atividade.findUnique({ where: { id } });
  const plantioDe = (atividadeId) => p.atividadePlantio.findFirst({ where: { atividade_id: atividadeId } });
  const nada = async () => assert.equal(await p.atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: { not: s.atividade.id } } }), 0);
  return {
    ...s, plantio, fertilizacao, aplicacao, rocada, preparo, manutencao, outros, mombaca, marandu, milho, inativa, daFazenda2, semente,
    corpoBase, registrar, ok, novaArea, atividades, atividade, plantioDe, nada, cultura,
  };
};

describe('as regras puras', () => {
  test('safra do dia: de 1º de julho a 30 de junho, "AAAA/AA"', () => {
    assert.deepEqual(
      ['2026-11-28', '2027-01-15', '2027-06-30', '2027-07-01', '2026-07-01', '2026-06-30', '1999-12-31'].map(safraDoDia),
      ['2026/27', '2026/27', '2026/27', '2027/28', '2026/27', '2025/26', '1999/00']
    );
  });

  test('pasto liberado: fim + a MAIOR carência; sem carência, nulo (nada inventado); zero libera no dia', () => {
    assert.deepEqual(pastoLiberadoEm('2026-11-12', [21, null, 3]), { pasto_liberado_em: '2026-12-03', carencia_dias: 21 });
    assert.deepEqual(pastoLiberadoEm('2026-12-20', [15]), { pasto_liberado_em: '2027-01-04', carencia_dias: 15 });
    assert.deepEqual(pastoLiberadoEm('2026-11-12', [0]), { pasto_liberado_em: '2026-11-12', carencia_dias: 0 });
    assert.deepEqual(pastoLiberadoEm('2026-11-12', [null, undefined]), { pasto_liberado_em: null, carencia_dias: null });
    assert.deepEqual(pastoLiberadoEm('2026-11-12', []), { pasto_liberado_em: null, carencia_dias: null });
  });

  test('as listas fechadas e o tipo fixo da categoria', () => {
    assert.deepEqual(FORMAS_PLANTIO, ['A_LANCO', 'EM_LINHA', 'AEREA', 'MUDA']);
    assert.deepEqual(TIPOS_SEM_AREA, ['BENFEITORIA', 'OUTROS']);
    assert.deepEqual(TIPOS_COM_SAFRA, ['PLANTIO', 'TRATO_CULTURAL']);
    assert.deepEqual(UNIDADES_FEITAS, ['KM', 'M', 'UN']);
    assert.deepEqual([tipoFixoDaCategoria('PLANTIO'), tipoFixoDaCategoria(null), tipoFixoDaCategoria('COLHEITA')], ['PLANTIO', 'OUTROS', 'OUTROS']);
  });
});

describe('Plantio de pastagem: o capim', () => {
  test('capim OBRIGATÓRIO: sem plantio → 400 plantio.cultura_id; nada gravado', async () => {
    const s = await montar();
    assert.deepEqual(erro(await s.registrar({ area_executada_dia: '10' })), [400, 'REQUEST_VALIDATION_FAILED', 'plantio.cultura_id', 'obrigatorio']);
    assert.equal((await s.registrar({ plantio: {} })).statusCode, 400, 'o objeto sem o capim é recusado pelo schema');
    await s.nada();
  });

  test('grava o capim e os opcionais na AtividadePlantio (1 para 1) e devolve na atividade', async () => {
    const s = await montar();
    const r = await s.ok({
      area_executada_dia: '40', data_operacional: '2026-11-28',
      plantio: { cultura_id: s.mombaca.id, forma_plantio: 'A_LANCO', semente_incrustada: false, cobertura: true, consorcio_cultura_id: s.milho.id },
    });
    const pl = await s.plantioDe(r.registro.atividade_id);
    assert.deepEqual(
      [pl.cultura_id, pl.forma_plantio, pl.semente_incrustada, pl.cobertura, pl.consorcio_cultura_id, pl.cliente_id, pl.empresa_id],
      [s.mombaca.id, 'A_LANCO', false, true, s.milho.id, s.c, s.e1.id]
    );
    assert.equal(r.atividade.plantio.cultura.nome, s.mombaca.nome);
    assert.equal(r.atividade.plantio.cultura.cultivar, 'Mombaça');
    assert.equal(r.atividade.plantio.consorcio.nome, s.milho.nome);
    // A leitura da atividade (detalhe e lista) também traz o plantio.
    const det = await s.H.ok(s.H.req('GET', `/atividades/${r.registro.atividade_id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(det.plantio.cultura_id, s.mombaca.id);
    const lista = await s.H.ok(s.H.req('GET', `/atividades?empresa_id=${s.e1.id}`, s.token));
    assert.equal(lista.items.find((x) => x.id === r.registro.atividade_id).plantio.forma_plantio, 'A_LANCO');
    // O resumo da área traz o capim (a prévia "Entra em…" usa a mesma regra).
    const resumo = await s.H.ok(s.H.req('GET', `/atividades-por-area/${s.area1.id}/resumo?empresa_id=${s.e1.id}`, s.token));
    assert.equal(resumo.atividades.find((x) => x.atividade_id === r.registro.atividade_id).plantio_cultura_id, s.mombaca.id);
  });

  test('o MESMO capim continua a atividade aberta; capim DIFERENTE abre outra; continuar só completa o vazio (nunca sobrescreve)', async () => {
    const s = await montar();
    const um = await s.ok({ area_executada_dia: '10', data_operacional: '2027-06-01', plantio: { cultura_id: s.mombaca.id, forma_plantio: 'A_LANCO' } });
    const dois = await s.ok({ area_executada_dia: '10', data_operacional: '2027-06-02', plantio: { cultura_id: s.mombaca.id, forma_plantio: 'EM_LINHA', cobertura: true } });
    assert.deepEqual([dois.registro.atividade_criada, dois.registro.atividade_id], [false, um.registro.atividade_id]);
    const pl = await s.plantioDe(um.registro.atividade_id);
    assert.deepEqual([pl.forma_plantio, pl.cobertura], ['A_LANCO', true], 'a forma gravada fica; a cobertura (vazia) foi completada');
    assert.deepEqual(dois.registro.plantio_completado, ['cobertura']);
    const outro = await s.ok({ area_executada_dia: '5', data_operacional: '2027-06-03', plantio: { cultura_id: s.marandu.id } });
    assert.equal(outro.registro.atividade_criada, true, 'capim diferente abre outra atividade');
    assert.notEqual(outro.registro.atividade_id, um.registro.atividade_id);
    assert.equal((await s.atividades()).length, 2);
    // E o Mombaça segue entrando na dele.
    assert.equal((await s.ok({ area_executada_dia: '1', data_operacional: '2027-06-04', plantio: { cultura_id: s.mombaca.id } })).registro.atividade_id, um.registro.atividade_id);
  });

  test('capim de OUTRA fazenda, de OUTRO tenant ou inexistente → 422 inexistente; inativo → 422 inativo; consórcio igual ao capim → 400; nada gravado', async () => {
    const s = await montar();
    const outro = await montarLinhasCusto(app);
    const deOutroTenant = await prisma().cultura.create({ data: { cliente_id: outro.c, empresa_id: outro.e1.id, codigo: 'X1', tipo: 'PASTAGEM', nome: 'DE OUTRO TENANT' } });
    for (const id of [s.daFazenda2.id, deOutroTenant.id, 'nao-existe']) {
      assert.deepEqual(erro(await s.registrar({ plantio: { cultura_id: id } })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'plantio.cultura_id', 'inexistente'], id);
    }
    assert.deepEqual(erro(await s.registrar({ plantio: { cultura_id: s.inativa.id } })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'plantio.cultura_id', 'inativo']);
    assert.deepEqual(erro(await s.registrar({ plantio: { cultura_id: s.mombaca.id, consorcio_cultura_id: s.daFazenda2.id } })), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'plantio.consorcio_cultura_id', 'inexistente']);
    assert.deepEqual(erro(await s.registrar({ plantio: { cultura_id: s.mombaca.id, consorcio_cultura_id: s.mombaca.id } })), [400, 'REQUEST_VALIDATION_FAILED', 'plantio.consorcio_cultura_id', 'igual_ao_capim']);
    await s.nada();
  });

  test('forma fora da lista, booleano em texto, campo a mais ou plantio fora do Plantio → 400; nada gravado', async () => {
    const s = await montar();
    for (const plantio of [
      { cultura_id: s.mombaca.id, forma_plantio: 'JOGADO' },
      { cultura_id: s.mombaca.id, semente_incrustada: 'true' },
      { cultura_id: s.mombaca.id, cobertura: 1 },
      { cultura_id: s.mombaca.id, especie: 'digitada' },
    ]) {
      const r = await s.registrar({ plantio });
      assert.equal(r.statusCode, 400, `${JSON.stringify(plantio)} ${r.body}`);
    }
    assert.deepEqual(erro(await s.registrar({ tipo_atividade_id: s.rocada.id, plantio: { cultura_id: s.mombaca.id } })), [400, 'REQUEST_VALIDATION_FAILED', 'plantio', 'tipo_sem_plantio']);
    await s.nada();
  });
});

describe('safra automática (1º de julho a 30 de junho)', () => {
  test('Plantio: 28/11/2026 e 15/01/2027 → 2026/27 (a mesma safra); a do corpo vale; Fertilização também; Roçada não', async () => {
    const s = await montar();
    const nov = await s.ok({ data_operacional: '2026-11-28', plantio: { cultura_id: s.mombaca.id } });
    assert.equal(nov.atividade.safra_ciclo, '2026/27');
    const jan = await s.ok({ area_id: (await s.novaArea('PASTO JAN')).id, data_operacional: '2027-01-15', plantio: { cultura_id: s.mombaca.id } });
    assert.equal(jan.atividade.safra_ciclo, '2026/27');
    const fronteira = await s.ok({ area_id: (await s.novaArea('PASTO JUN')).id, data_operacional: '2026-06-30', plantio: { cultura_id: s.marandu.id } });
    assert.equal(fronteira.atividade.safra_ciclo, '2025/26', '30 de junho ainda é a safra anterior');
    const julho = await s.ok({ area_id: (await s.novaArea('PASTO JUL')).id, data_operacional: '2026-07-01', plantio: { cultura_id: s.marandu.id } });
    assert.equal(julho.atividade.safra_ciclo, '2026/27', '1º de julho começa a safra');
    const doCorpo = await s.ok({ area_id: (await s.novaArea('PASTO CORPO')).id, data_operacional: '2026-11-28', safra_ciclo: 'SAFRA ESPECIAL', plantio: { cultura_id: s.mombaca.id } });
    assert.equal(doCorpo.atividade.safra_ciclo, 'SAFRA ESPECIAL');
    const adubo = await s.ok({ tipo_atividade_id: s.fertilizacao.id, data_operacional: '2026-10-28' });
    assert.equal(adubo.atividade.safra_ciclo, '2026/27');
    const rocada = await s.ok({ tipo_atividade_id: s.rocada.id, data_operacional: '2026-10-28' });
    assert.equal(rocada.atividade.safra_ciclo, null);
    // Operação com `exige_safra` (de qualquer tipo): antes, 422 sem a safra; agora, a safra do dia.
    const comFlag = await prisma().tipoAtividade.create({
      data: { cliente_id: s.c, nome_tipo: `COM SAFRA ${randomUUID().slice(0, 4)}`, grupo_atividade_id: s.grupo.id, grupo_atividade_nome: s.grupo.nome_grupo, categoria: 'PREPARO_SOLO', exige_safra: true },
    });
    assert.equal((await s.ok({ tipo_atividade_id: comFlag.id, data_operacional: '2027-01-02' })).atividade.safra_ciclo, '2026/27');
    // A abertura é auditada com a safra automática marcada.
    const [ev] = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade.abrir', entidade_id: nov.registro.atividade_id } });
    assert.equal(ev.dados_novos.safra_automatica, true);
  });

  test('continuar a atividade não troca a safra dela', async () => {
    const s = await montar();
    const um = await s.ok({ tipo_atividade_id: s.fertilizacao.id, data_operacional: '2027-06-01' });
    assert.equal(um.atividade.safra_ciclo, '2026/27');
    const dois = await s.ok({ tipo_atividade_id: s.fertilizacao.id, data_operacional: '2027-06-02', safra_ciclo: 'OUTRA' });
    assert.equal(dois.registro.atividade_id, um.registro.atividade_id);
    assert.equal((await s.atividade(um.registro.atividade_id)).safra_ciclo, '2026/27');
  });
});

describe('idempotência: o fingerprint de antes, byte a byte', () => {
  test('sem os campos novos (plantio, receituário, local, unidade, VC), o recibo guarda a fórmula de ANTES da D-PROD-270 — inclusive com a safra calculada no servidor; com eles, eles entram', async () => {
    const s = await montar();
    // A Fertilização ganha a safra no servidor: o fingerprint continua com `safra_ciclo: null` (o do corpo).
    const operation_id = opId('fp');
    const corpo = s.corpoBase({
      operation_id, tipo_atividade_id: s.fertilizacao.id, area_executada_dia: '3', turno: 'MANHA', observacao: 'adubou',
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '2' }],
    });
    const um = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(um.statusCode, 201, um.body);
    assert.equal(um.json().atividade.safra_ciclo, '2026/27');
    const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
    const linhas = linhasDoCorpo(corpo);
    const antes = fingerprintDePayload({
      v: 1, empresa_id: corpo.empresa_id, area_id: corpo.area_id, tipo_atividade_id: corpo.tipo_atividade_id, safra_ciclo: null, estado, origem: origemDoCorpo(corpo.origem),
      produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas),
    });
    const recibo = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: s.c, operation_key: operation_id, tipo_operacao: TIPO_OPERACAO_REGISTRAR } });
    assert.equal(recibo.fingerprint, antes, 'a fórmula de antes: o reenvio pendente feito antes do deploy ainda casa');
    // Reenvio igual (e com os campos novos nulos) → replay.
    for (const extra of [{}, { numero_receituario: null, unidade_producao_sigla: null, plantio: null, local: null }]) {
      const r = await s.H.req('POST', '/atividades/registrar', s.token, { ...corpo, ...extra });
      assert.equal(r.statusCode, 200, `${JSON.stringify(extra)} ${r.body}`);
      assert.equal(r.json().replay, true);
    }
    // O VC na linha (só quando vem) muda o corpo: a mesma chave → 409.
    const comVc = { ...corpo, produtos: [{ ...corpo.produtos[0], vc_percentual: '50' }] };
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, comVc)).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    // Com o plantio, ele entra: o reenvio igual casa; outro capim com a mesma chave → 409.
    const op2 = opId('fp2');
    const comPlantio = s.corpoBase({ operation_id: op2, plantio: { cultura_id: s.mombaca.id } });
    assert.equal((await s.H.req('POST', '/atividades/registrar', s.token, comPlantio)).statusCode, 201);
    assert.equal((await s.H.req('POST', '/atividades/registrar', s.token, comPlantio)).statusCode, 200);
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, { ...comPlantio, plantio: { cultura_id: s.marandu.id } })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
  });
});

describe('VC % na linha do insumo', () => {
  test('grava com 2 casas e devolve na linha; zero, acima de 100, 3 casas, texto ou número → 400; nada gravado', async () => {
    const s = await montar();
    const linha = (vc, quantidade = '400') => ({ produto_id: s.semente.id, local_estoque_id: s.local.id, quantidade, ...(vc === undefined ? {} : { vc_percentual: vc }) });
    for (const [vc, reason] of [['0', 'fora_da_faixa'], ['100.01', 'fora_da_faixa'], ['50.555', 'formato'], ['abc', 'formato'], [50, 'valor_deve_ser_texto']]) {
      const r = await s.registrar({ area_executada_dia: '40', plantio: { cultura_id: s.mombaca.id }, produtos: [linha(vc)] });
      assert.equal(r.statusCode, 400, `${vc} ${r.body}`);
      assert.equal(r.json().reason, reason, `${vc} ${r.body}`);
    }
    await s.nada();
    const r = await s.ok({ area_executada_dia: '40', plantio: { cultura_id: s.mombaca.id }, produtos: [linha('50')] });
    assert.equal(r.apontamento.produtos[0].vc_percentual, '50.00');
    assert.equal(r.apontamento.produtos[0].dose_ha, '10.0000');
    const [l] = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c, produto_id: s.semente.id } });
    assert.equal(l.vc_percentual.toFixed(2), '50.00');
    // Sem VC: nulo (a linha de sempre).
    const sem = await s.ok({ area_executada_dia: '1', plantio: { cultura_id: s.mombaca.id }, produtos: [linha(undefined, '5')] });
    assert.equal(sem.apontamento.produtos[0].vc_percentual, null);
    // 100 vale; com várias áreas, cada parte leva o VC.
    const b = await s.novaArea('PASTO B', '20');
    const corpo = s.corpoBase({ plantio: { cultura_id: s.marandu.id }, produtos: [linha('100', '20')], areas: [{ area_id: s.area1.id, hectares: '10' }, { area_id: b.id, hectares: '10' }] });
    delete corpo.area_id;
    const varias = await s.H.req('POST', '/atividades/registrar', s.token, corpo);
    assert.equal(varias.statusCode, 201, varias.body);
    assert.deepEqual(varias.json().apontamentos.map((a) => a.produtos[0].vc_percentual), ['100.00', '100.00']);
  });
});

describe('carência do produto e "pasto liberado em"', () => {
  test('o cadastro do produto aceita a carência (0..365, null limpa) e a devolve; fora da faixa → 400', async () => {
    const s = await montar();
    const url = `/produtos/${s.herbicida.id}`;
    const r = await s.H.ok(s.H.req('PATCH', url, s.token, { carencia_dias: 21 }));
    assert.equal(r.carencia_dias, 21);
    const lista = await s.H.ok(s.H.req('GET', `/produtos?empresa_id=${s.e1.id}`, s.token));
    assert.equal((Array.isArray(lista) ? lista : lista.items ?? lista.data).find((x) => x.id === s.herbicida.id).carencia_dias, 21);
    for (const ruim of [-1, 366, 2.5]) assert.equal((await s.H.req('PATCH', url, s.token, { carencia_dias: ruim })).statusCode, 400, String(ruim));
    assert.equal((await s.H.ok(s.H.req('PATCH', url, s.token, { carencia_dias: null }))).carencia_dias, null);
    assert.equal((await s.H.ok(s.H.req('PATCH', url, s.token, { carencia_dias: 0 }))).carencia_dias, 0);
  });

  test('Aplicação: pasto liberado = término (ou o dia) + a MAIOR carência dos produtos lançados; sem carência, nulo; a opção do produto traz a carência', async () => {
    const s = await montar();
    await prisma().produto.update({ where: { id: s.herbicida.id }, data: { carencia_dias: 21 } });
    await prisma().produto.update({ where: { id: s.semente.id }, data: { carencia_dias: 3 } });
    const r = await s.ok({
      tipo_atividade_id: s.aplicacao.id, area_executada_dia: '27', data_operacional: '2027-06-01', data_termino: '2027-06-03', numero_receituario: '0187/2026',
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '10' }, { produto_id: s.semente.id, local_estoque_id: s.local.id, quantidade: '1' }],
    });
    assert.deepEqual([r.registro.pasto_liberado_em, r.registro.carencia_dias], ['2027-06-24', 21]);
    assert.equal(r.apontamento.numero_receituario, '0187/2026');
    const [ap] = await prisma().atividadeApontamento.findMany({ where: { cliente_id: s.c, atividade_id: r.registro.atividade_id } });
    assert.equal(ap.numero_receituario, '0187/2026');
    // Sem término: o dia.
    const sem = await s.ok({ tipo_atividade_id: s.aplicacao.id, area_executada_dia: '1', data_operacional: '2027-06-05', produtos: [{ produto_id: s.semente.id, local_estoque_id: s.local.id, quantidade: '1' }] });
    assert.equal(sem.registro.pasto_liberado_em, '2027-06-08');
    // Sem carência cadastrada (nem produto): nulo.
    await prisma().produto.update({ where: { id: s.semente.id }, data: { carencia_dias: null } });
    const nulo = await s.ok({ tipo_atividade_id: s.aplicacao.id, area_executada_dia: '1', data_operacional: '2027-06-06', produtos: [{ produto_id: s.semente.id, local_estoque_id: s.local.id, quantidade: '1' }] });
    assert.deepEqual([nulo.registro.pasto_liberado_em, nulo.registro.carencia_dias], [null, null]);
    assert.equal((await s.ok({ tipo_atividade_id: s.aplicacao.id, area_executada_dia: '1', data_operacional: '2027-06-07' })).registro.pasto_liberado_em, null);
    const opcoes = await s.H.ok(s.H.req('GET', `/atividades-opcoes/produtos?empresa_id=${s.e1.id}&q=Herbicida`, s.token));
    assert.equal(opcoes.itens.find((o) => o.id === s.herbicida.id).carencia_dias, 21);
  });

  test('o nº do receituário só vale na Aplicação (400 nos outros); longo demais → 400; vazio = sem', async () => {
    const s = await montar();
    assert.deepEqual(erro(await s.registrar({ tipo_atividade_id: s.rocada.id, numero_receituario: '123' })), [400, 'REQUEST_VALIDATION_FAILED', 'numero_receituario', 'tipo_sem_receituario']);
    assert.equal((await s.registrar({ tipo_atividade_id: s.aplicacao.id, numero_receituario: 'x'.repeat(41) })).statusCode, 400);
    await s.nada();
    assert.equal((await s.ok({ tipo_atividade_id: s.aplicacao.id, numero_receituario: '   ' })).apontamento.numero_receituario, null);
  });
});

describe('Manutenção e Outros sem área: o local', () => {
  const semArea = (s, corpo = {}) => {
    const c = s.corpoBase({ tipo_atividade_id: s.manutencao.id, ...corpo });
    delete c.area_id;
    return c;
  };

  test('cria a atividade sem área com o local (em MAIÚSCULAS), mesmo com exige_area na operação; a quantidade feita e a unidade', async () => {
    const s = await montar();
    const r = await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: '  divisa   norte ', quantidade_produzida_dia: '1.2', unidade_producao_sigla: 'KM', data_operacional: '2027-06-01', data_termino: '2027-06-02' }));
    assert.equal(r.statusCode, 201, r.body);
    const j = r.json();
    assert.equal(j.registro.local, 'DIVISA NORTE');
    assert.deepEqual(j.registro.areas, []);
    const a = await s.atividade(j.registro.atividade_id);
    assert.deepEqual([a.local, a.area_id, a.unidade_producao_sigla, a.quantidade_produzida.toFixed(4)], ['DIVISA NORTE', null, 'KM', '1.2000']);
    assert.equal(a.nome, `${s.manutencao.nome_tipo} · DIVISA NORTE · jun/27`);
    assert.equal(await prisma().atividadeArea.count({ where: { atividade_id: a.id } }), 0);
    assert.equal(j.atividade.local, 'DIVISA NORTE');
    assert.equal(j.apontamento.atividade_area_id, null);
    assert.equal(j.apontamento.area_executada_dia, null);
  });

  test('o MESMO local continua; outro local abre outra; a unidade diferente da do serviço → 422; a mesma soma a quantidade', async () => {
    const s = await montar();
    const um = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'DIVISA NORTE', quantidade_produzida_dia: '0.5', unidade_producao_sigla: 'KM', data_operacional: '2027-06-01' })), 201);
    const dois = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'divisa norte', quantidade_produzida_dia: '0.7', unidade_producao_sigla: 'KM', data_operacional: '2027-06-02' })), 201);
    assert.deepEqual([dois.registro.atividade_criada, dois.registro.atividade_id], [false, um.registro.atividade_id]);
    assert.equal((await s.atividade(um.registro.atividade_id)).quantidade_produzida.toFixed(4), '1.2000');
    assert.deepEqual(
      erro(await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'DIVISA NORTE', quantidade_produzida_dia: '100', unidade_producao_sigla: 'M', data_operacional: '2027-06-03' }))),
      [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'unidade_producao_sigla', 'diferente_da_atividade']
    );
    const outro = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'CURRAL', data_operacional: '2027-06-03' })), 201);
    assert.equal(outro.registro.atividade_criada, true);
    // Sem unidade no serviço, o registro seguinte a completa.
    const tres = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'CURRAL', quantidade_produzida_dia: '3', unidade_producao_sigla: 'UN', data_operacional: '2027-06-04' })), 201);
    assert.equal(tres.registro.atividade_id, outro.registro.atividade_id);
    assert.equal((await s.atividade(outro.registro.atividade_id)).unidade_producao_sigla, 'UN');
  });

  test('sem área e sem local → 400 local; local com área → 400 com_area; sem área num tipo que exige área → 400 area_id; hectares sem área → 400; nada gravado', async () => {
    const s = await montar();
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, semArea(s))), [400, 'REQUEST_VALIDATION_FAILED', 'local', 'obrigatorio']);
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { tipo_atividade_id: s.outros.id, local: '   ' }))), [400, 'REQUEST_VALIDATION_FAILED', 'local', 'obrigatorio']);
    assert.deepEqual(erro(await s.registrar({ tipo_atividade_id: s.manutencao.id, local: 'SEDE' })), [400, 'REQUEST_VALIDATION_FAILED', 'local', 'com_area']);
    for (const tipo of [s.preparo, s.plantio, s.aplicacao, s.fertilizacao, s.rocada]) {
      assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { tipo_atividade_id: tipo.id, local: 'SEDE' }))), [400, 'REQUEST_VALIDATION_FAILED', 'area_id', 'obrigatorio'], tipo.nome_tipo);
    }
    assert.deepEqual(erro(await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'SEDE', area_executada_dia: '2' }))), [400, 'REQUEST_VALIDATION_FAILED', 'area_executada_dia', 'sem_area']);
    assert.equal((await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'SEDE', unidade_producao_sigla: 'LEGUA' }))).statusCode, 400);
    await s.nada();
  });

  test('Outros: o mesmo mecanismo (com insumo e equipe, sem área); "Concluída" conclui a atividade sem área no término', async () => {
    const s = await montar();
    const r = await s.H.ok(
      s.H.req('POST', '/atividades/registrar', s.token, semArea(s, {
        tipo_atividade_id: s.outros.id, local: 'sede', data_operacional: '2027-06-10', data_termino: '2027-06-11', concluir: true,
        mao_obra: [{ parceiro_id: s.joao.id, tipo_medida: 'DIARIA', quantidade: '1' }],
      })),
      201
    );
    assert.deepEqual([r.registro.local, r.registro.atividade_concluida, r.atividade.status, r.atividade.data_conclusao], ['SEDE', true, 'CONCLUIDA', '2027-06-11']);
    const [ev] = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'atividade.concluir', entidade_id: r.registro.atividade_id } });
    assert.equal(ev.dados_novos.sem_area, true);
    // Concluída, a próxima no mesmo local abre outra.
    assert.equal((await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { tipo_atividade_id: s.outros.id, local: 'SEDE', data_operacional: '2027-06-12' })), 201)).registro.atividade_criada, true);
  });

  test('parado sem área: mais de 30 dias → 409 com o local; nova_atividade true conclui a antiga no último dia e abre outra', async () => {
    const s = await montar();
    const antiga = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'AÇUDE', data_operacional: '2027-04-01' })), 201);
    const operation_id = opId('parado');
    const r = await s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'AÇUDE', data_operacional: '2027-06-10', operation_id }));
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual([r.json().code, r.json().details.local, r.json().details.area_id, r.json().details.ultimo_dia], ['ATIVIDADE_SERVICO_PARADO', 'AÇUDE', null, '2027-04-01']);
    const nova = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, semArea(s, { local: 'AÇUDE', data_operacional: '2027-06-10', operation_id, nova_atividade: true })), 201);
    assert.equal(nova.registro.atividade_criada, true);
    assert.deepEqual(nova.registro.atividade_anterior, { atividade_id: antiga.registro.atividade_id, atividade_nome: antiga.registro.atividade_nome, ultimo_dia: '2027-04-01', areas_concluidas: 0, atividade_concluida: true });
    const velha = await s.atividade(antiga.registro.atividade_id);
    assert.deepEqual([velha.status, dia(velha.data_conclusao)], ['CONCLUIDA', '2027-04-01']);
  });

  test('Manutenção COM área continua como sempre (o local não é pedido); com várias áreas a quantidade feita é repartida pelos hectares', async () => {
    const s = await montar();
    const r = await s.ok({ tipo_atividade_id: s.manutencao.id, area_executada_dia: '2', quantidade_produzida_dia: '1' });
    assert.equal(r.atividade.local, null);
    const b = await s.novaArea('PASTO B', '30');
    const corpo = s.corpoBase({ tipo_atividade_id: s.manutencao.id, quantidade_produzida_dia: '10', unidade_producao_sigla: 'M', areas: [{ area_id: s.area1.id, hectares: '1' }, { area_id: b.id, hectares: '3' }] });
    delete corpo.area_id;
    const v = await s.H.ok(s.H.req('POST', '/atividades/registrar', s.token, corpo), 201);
    assert.deepEqual(v.apontamentos.map((a) => a.quantidade_produzida_dia), ['2.5000', '7.5000']);
  });
});

describe('o alvo no cadastro da operação', () => {
  test('grava em MAIÚSCULAS, devolve na operação, limpa com null ou vazio; longo demais → 400', async () => {
    const s = await montar();
    const url = `/tipos-atividade/${s.aplicacao.id}`;
    const r = await s.H.ok(s.H.req('PATCH', url, s.token, { alvo: ' cigarrinha ' }));
    assert.equal(r.alvo, 'CIGARRINHA');
    assert.equal((await s.H.ok(s.H.req('GET', url, s.token))).alvo, 'CIGARRINHA');
    assert.equal((await s.H.req('PATCH', url, s.token, { alvo: 'x'.repeat(61) })).statusCode, 400);
    assert.equal((await s.H.ok(s.H.req('PATCH', url, s.token, { alvo: '' }))).alvo, null);
    assert.equal((await s.H.ok(s.H.req('PATCH', url, s.token, { alvo: 'MATO (FOLHA LARGA)' }))).alvo, 'MATO (FOLHA LARGA)');
    assert.equal((await s.H.ok(s.H.req('PATCH', url, s.token, { alvo: null }))).alvo, null);
  });
});

describe('lista de referência de capins (Doc 397)', () => {
  test('os capins que faltavam entram com as alturas do Doc 397; Marandu 35/20; a cultura que a fazenda já tem NÃO é alterada', async () => {
    const s = await montar();
    const nomes = LISTA_REFERENCIA.map((c) => c.nome);
    for (const nome of ['BRACHIARIA HÍBRIDA BRS RB331 IPYPORÃ', 'BRACHIARIA RUZIZIENSIS BRS INTEGRA', 'PANICUM BRS TAMANI', 'PANICUM BRS QUÊNIA', 'BRACHIARIA HUMIDICOLA BRS TUPI', 'ESTILOSANTES CAMPO GRANDE']) {
      assert.ok(nomes.includes(nome), nome);
    }
    const ref = (nome) => LISTA_REFERENCIA.find((c) => c.nome === nome);
    assert.deepEqual([ref('BRACHIARIA BRIZANTHA CV. MARANDU').entrada, ref('BRACHIARIA BRIZANTHA CV. MARANDU').saida], [35, 20]);
    assert.deepEqual([ref('PANICUM BRS QUÊNIA').entrada, ref('PANICUM BRS QUÊNIA').saida], [65, 35]);
    assert.deepEqual([ref('ESTILOSANTES CAMPO GRANDE').entrada, ref('ESTILOSANTES CAMPO GRANDE').saida], [null, null]);
    assert.equal(new Set(LISTA_REFERENCIA.map((c) => c.codigo)).size, LISTA_REFERENCIA.length, 'códigos sem repetir');
    // A fazenda já tem um Marandu copiado da lista antiga (25/15): o comando não o altera.
    const antigo = await prisma().cultura.create({
      data: { cliente_id: s.c, empresa_id: s.e2.id, codigo: '001', tipo: 'PASTAGEM', nome: 'BRACHIARIA BRIZANTHA CV. MARANDU', altura_entrada_cm: '25.0', altura_saida_cm: '15.0' },
    });
    const r = await s.H.ok(s.H.req('POST', '/culturas/comandos/lista-referencia', s.token, { empresa_id: s.e2.id }));
    assert.equal(r.ja_existiam, 1);
    assert.equal(r.criadas, LISTA_REFERENCIA.length - 1);
    const marandu = await prisma().cultura.findUnique({ where: { id: antigo.id } });
    assert.deepEqual([marandu.altura_entrada_cm.toFixed(1), marandu.altura_saida_cm.toFixed(1)], ['25.0', '15.0']);
    const estilosantes = r.culturas.find((c) => c.nome === 'ESTILOSANTES CAMPO GRANDE');
    assert.deepEqual([estilosantes.altura_entrada_cm, estilosantes.altura_saida_cm, estilosantes.dias_descanso], [null, null, null]);
    const tupi = r.culturas.find((c) => c.nome === 'BRACHIARIA HUMIDICOLA BRS TUPI');
    assert.deepEqual([tupi.altura_entrada_cm, tupi.altura_saida_cm, tupi.cultivar], [20, 10, 'BRS Tupi']);
  });
});

describe('tenant', () => {
  test('o tenant vem da sessão: cliente_id no corpo → 400; outro tenant não enxerga o capim nem a atividade (inexistente)', async () => {
    const s = await montar();
    assert.equal((await s.registrar({ cliente_id: s.c, plantio: { cultura_id: s.mombaca.id } })).statusCode, 400);
    const outro = await montarLinhasCusto(app);
    const tipoOutro = await prisma().tipoAtividade.create({
      data: { cliente_id: outro.c, nome_tipo: 'PLANTIO X', grupo_atividade_id: outro.grupo.id, grupo_atividade_nome: outro.grupo.nome_grupo, categoria: 'PLANTIO', permite_produto: true },
    });
    const r = await s.H.req('POST', '/atividades/registrar', outro.token, {
      empresa_id: outro.e1.id, area_id: outro.area1.id, tipo_atividade_id: tipoOutro.id, data_operacional: '2027-06-10', operation_id: opId('t'), plantio: { cultura_id: s.mombaca.id },
    });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_REFERENCIA_INVALIDA', 'plantio.cultura_id', 'inexistente']);
    assert.equal(await prisma().atividadePlantio.count({ where: { cliente_id: outro.c } }), 0);
    // O registro dele (com o capim dele) não entra na atividade deste tenant.
    const dele = await outro.H.ok(outro.H.req('POST', '/atividades/registrar', outro.token, {
      empresa_id: outro.e1.id, area_id: outro.area1.id, tipo_atividade_id: tipoOutro.id, data_operacional: '2027-06-10', operation_id: opId('t2'),
      plantio: { cultura_id: (await prisma().cultura.create({ data: { cliente_id: outro.c, empresa_id: outro.e1.id, codigo: 'Z1', tipo: 'PASTAGEM', nome: 'CAPIM DELE' } })).id },
    }), 201);
    const pl = await prisma().atividadePlantio.findFirst({ where: { atividade_id: dele.registro.atividade_id } });
    assert.equal(pl.cliente_id, outro.c);
  });
});
