/**
 * D-PROD-257 — tipos fixos: (1) o mapeamento puro categoria antiga → um dos 7 tipos fixos; (2) o script de dados
 * (`scripts/ops/tipos-fixos-atividade-dados.mjs`) em dry-run (não grava) e aplicado (grava, idempotente, com o valor anterior).
 * Banco descartável do teste; nada aponta para produção.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  CATEGORIAS_TIPO_FIXO,
  FLAGS_PADRAO_OPERACAO,
  FLAGS_TIPO_ATIVIDADE,
  TIPOS_FIXOS_ATIVIDADE,
  tipoFixoDaOperacaoExistente,
} from '../src/modules/tiposAtividade/tipoAtividadePadroes.js';
import { executar, planejarMudancas } from '../../scripts/ops/tipos-fixos-atividade-dados.mjs';
import { limparBanco, encerrar } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

describe('D-PROD-257 — os 7 tipos fixos (puro)', () => {
  test('lista fechada: 7 tipos, sem COLHEITA nem MANEJO_ANIMAL, todos com rótulo', () => {
    assert.deepEqual(CATEGORIAS_TIPO_FIXO, ['PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'PASTAGEM', 'BENFEITORIA', 'OUTROS']);
    assert.deepEqual(TIPOS_FIXOS_ATIVIDADE.map((t) => t.rotulo), [
      'Preparo do solo', 'Formação de pastagem (plantio)', 'Fertilização', 'Aplicação', 'Roçada e tratos', 'Manutenção', 'Outros',
    ]);
  });

  test('chaves padrão: área e 4 seções ligadas; as 3 que exigem dado desligadas; cobre exatamente as 8', () => {
    assert.deepEqual(Object.keys(FLAGS_PADRAO_OPERACAO).sort(), [...FLAGS_TIPO_ATIVIDADE].sort());
    for (const f of ['exige_area', 'permite_implemento', 'permite_produto', 'permite_servico', 'permite_mao_obra']) assert.equal(FLAGS_PADRAO_OPERACAO[f], true, f);
    for (const f of ['exige_safra', 'exige_maquina', 'exige_producao']) assert.equal(FLAGS_PADRAO_OPERACAO[f], false, f);
  });

  test('mapeamento: os 6 valores aceitos ficam; TRATO_CULTURAL por nome; fora de escopo e vazio → OUTROS', () => {
    for (const c of CATEGORIAS_TIPO_FIXO.filter((c) => c !== 'TRATO_CULTURAL')) assert.equal(tipoFixoDaOperacaoExistente(c, 'qualquer').categoria, c);
    assert.equal(tipoFixoDaOperacaoExistente('TRATO_CULTURAL', 'Adubação de cobertura').categoria, 'TRATO_CULTURAL');
    assert.equal(tipoFixoDaOperacaoExistente('TRATO_CULTURAL', 'Calcário').categoria, 'TRATO_CULTURAL');
    assert.equal(tipoFixoDaOperacaoExistente('TRATO_CULTURAL', 'Combate à cigarrinha').categoria, 'APLICACAO');
    assert.equal(tipoFixoDaOperacaoExistente('COLHEITA', 'Silagem').categoria, 'OUTROS');
    assert.equal(tipoFixoDaOperacaoExistente('MANEJO_ANIMAL', 'Vacinação').categoria, 'OUTROS');
    assert.equal(tipoFixoDaOperacaoExistente(null, 'Cerca').categoria, 'OUTROS');
    assert.equal(tipoFixoDaOperacaoExistente(undefined, undefined).categoria, 'OUTROS');
    assert.equal(tipoFixoDaOperacaoExistente('QUALQUER', 'x').categoria, 'OUTROS', 'valor desconhecido também vai a Outros');
  });

  test('planejarMudancas é puro e pula o que já está certo', () => {
    const certo = { cliente_id: 'c', id: 'a', nome_tipo: 'OK', categoria: 'APLICACAO', ...FLAGS_PADRAO_OPERACAO };
    const errado = { cliente_id: 'c', id: 'b', nome_tipo: 'X', categoria: null, ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((f) => [f, false])) };
    const m = planejarMudancas([certo, errado]);
    assert.equal(m.length, 1);
    assert.equal(m[0].id, 'b');
    assert.deepEqual(m[0].depois, {
      categoria: 'OUTROS', exige_area: true, permite_implemento: true, permite_produto: true, permite_servico: true, permite_mao_obra: true,
    });
    assert.equal(m[0].antes.categoria, null);
    // Só entram os campos que MUDAM: categoria já certa não aparece.
    const soChaves = planejarMudancas([{ ...errado, categoria: 'APLICACAO' }])[0];
    assert.equal(soChaves.campos.includes('categoria'), false);
    assert.deepEqual(Object.keys(soChaves.depois).sort(), ['exige_area', 'permite_implemento', 'permite_mao_obra', 'permite_produto', 'permite_servico']);
  });
});

describe('D-PROD-257 — script de dados contra o banco descartável', () => {
  const prisma = () => getPrismaClient();
  /** @type {{ cliente: string, outro: string, grupo: string, grupo2: string }} */
  let ids;
  const flagsDe = (t) => Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((f) => [f, t[f]]));

  const tipo = (cliente, grupo, nome, extra = {}) =>
    prisma().tipoAtividade.create({ data: { cliente_id: cliente, grupo_atividade_id: grupo, grupo_atividade_nome: 'G', nome_tipo: nome, ...extra } });

  before(async () => {
    await limparBanco();
    const mk = async (nome) => (await prisma().cliente.create({ data: { id: randomUUID(), codigo: `c-${randomUUID().slice(0, 8)}`, nome } })).id;
    const cliente = await mk('A');
    const outro = await mk('B');
    const grupo = (await prisma().grupoAtividade.create({ data: { cliente_id: cliente, nome_grupo: 'G' } })).id;
    const grupo2 = (await prisma().grupoAtividade.create({ data: { cliente_id: outro, nome_grupo: 'G' } })).id;
    ids = { cliente, outro, grupo, grupo2 };
    await tipo(cliente, grupo, 'GRADEAÇÃO', { categoria: 'PREPARO_SOLO' });
    await tipo(cliente, grupo, 'ADUBAÇÃO', { categoria: 'TRATO_CULTURAL', exige_maquina: true, exige_safra: true });
    await tipo(cliente, grupo, 'CIGARRINHA', { categoria: 'TRATO_CULTURAL' });
    await tipo(cliente, grupo, 'SILAGEM', { categoria: 'COLHEITA', exige_producao: true });
    await tipo(cliente, grupo, 'VACINAÇÃO', { categoria: 'MANEJO_ANIMAL' });
    await tipo(cliente, grupo, 'CERCA');
    await tipo(outro, grupo2, 'ROÇADA', { categoria: 'PASTAGEM' });
  });
  after(async () => {
    await limparBanco();
    await encerrar();
  });

  const lerTudo = async () => Object.fromEntries((await prisma().tipoAtividade.findMany()).map((t) => [t.nome_tipo, t]));

  test('DRY-RUN (padrão) lista o que mudaria e NÃO grava nada', async () => {
    const antes = await lerTudo();
    const r = await executar(prisma());
    assert.equal(r.aplicado, false);
    assert.equal(r.total, 7);
    assert.equal(r.mudancas.length, 7, 'todos os 7 têm chaves a ligar');
    const porNome = Object.fromEntries(r.mudancas.map((m) => [m.nome_tipo, m]));
    assert.equal(porNome['SILAGEM'].depois.categoria, 'OUTROS');
    assert.equal(porNome['CIGARRINHA'].depois.categoria, 'APLICACAO');
    assert.equal(porNome['CERCA'].depois.categoria, 'OUTROS');
    assert.equal(porNome['ADUBAÇÃO'].campos.includes('categoria'), false, 'adubação segue Fertilização');
    assert.equal(porNome['ADUBAÇÃO'].depois.exige_maquina, false, 'chave que exige dado é desligada');
    assert.equal(porNome['GRADEAÇÃO'].campos.includes('categoria'), false, 'categoria já certa não muda');
    assert.deepEqual(await lerTudo(), antes, 'o banco ficou exatamente igual');
  });

  test('--cliente limita o alcance', async () => {
    const r = await executar(prisma(), { clienteId: ids.outro });
    assert.equal(r.total, 1);
    assert.equal(r.mudancas[0].nome_tipo, 'ROÇADA');
  });

  test('APLICAR grava categoria e chaves, não toca em nome/grupo/ativo, e a 2ª rodada não acha nada (idempotente)', async () => {
    const antes = await lerTudo();
    const r = await executar(prisma(), { aplicar: true });
    assert.equal(r.mudancas.length, 7);
    const depois = await lerTudo();
    for (const [nome, t] of Object.entries(depois)) {
      assert.deepEqual(flagsDe(t), FLAGS_PADRAO_OPERACAO, `${nome}: chaves`);
      assert.ok(CATEGORIAS_TIPO_FIXO.includes(t.categoria), `${nome}: categoria fixa`);
      assert.equal(t.grupo_atividade_id, antes[nome].grupo_atividade_id);
      assert.equal(t.ativo, antes[nome].ativo);
    }
    assert.equal(depois['SILAGEM'].categoria, 'OUTROS');
    assert.equal(depois['CIGARRINHA'].categoria, 'APLICACAO');
    assert.equal(depois['ADUBAÇÃO'].categoria, 'TRATO_CULTURAL');
    assert.equal(depois['GRADEAÇÃO'].categoria, 'PREPARO_SOLO');
    assert.equal(depois['ROÇADA'].categoria, 'PASTAGEM');
    const de2 = await executar(prisma(), { aplicar: true });
    assert.equal(de2.mudancas.length, 0, 'idempotente');
  });
});
