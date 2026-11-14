/**
 * D-PROD-195 (Fatia 1, §3.5 do contrato `MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`)
 * — "preparar o terreno": o módulo PURO `tipoAtividadePadroes.js` (sem Prisma,
 * sem I/O) que a Fatia 2 usa no "Abrir atividade".
 *
 *  - `CATEGORIAS_TIPO_ATIVIDADE` (as 9, congeladas) e `FLAGS_TIPO_ATIVIDADE`
 *    (as 8, na ordem do contrato);
 *  - `padroesParaAtividade(tipo, { empresaId })` → `{ centro_custo_id,
 *    centro_resultado_id, unidade_producao_id, coeficiente }`: o centro só vale
 *    se existir, estiver ATIVO e for da MESMA empresa da atividade; a unidade só
 *    vale se ATIVA; senão `null`. Recebe o tipo como o repository devolve (com
 *    os 3 objetos incluídos);
 *  - `regrasDoTipo(tipo)` → só as 8 flags, booleanas.
 *
 * A maior parte é unidade pura (sem banco). O último bloco lê o tipo pelo
 * repository real (PostgreSQL) e prova que o módulo entende a forma devolvida.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import {
  CATEGORIAS_TIPO_ATIVIDADE,
  FLAGS_TIPO_ATIVIDADE,
  padroesParaAtividade,
  regrasDoTipo,
} from '../src/modules/tiposAtividade/tipoAtividadePadroes.js';
import { buscarTipo, listarTipos } from '../src/modules/tiposAtividade/tipoAtividadeRepository.js';
import { limparBanco, encerrar } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

const FLAGS = Object.freeze([
  'exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento', 'permite_produto', 'permite_servico', 'permite_mao_obra', 'exige_producao',
]);
const CATEGORIAS = Object.freeze(['PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'COLHEITA', 'PASTAGEM', 'BENFEITORIA', 'MANEJO_ANIMAL', 'OUTROS']);
const CHAVES_PADROES = Object.freeze(['centro_custo_id', 'centro_resultado_id', 'coeficiente', 'unidade_producao_id']);
const TUDO_NULL = Object.freeze({ centro_custo_id: null, centro_resultado_id: null, unidade_producao_id: null, coeficiente: null });

const EMPRESA = 'empresa-da-atividade';
const OUTRA_EMPRESA = 'empresa-vizinha';

/** Resumo do centro como o repository inclui (select aninhado do Prisma). */
const centro = (id, { empresa_id = EMPRESA, ativo = true } = {}) => ({ id, numero: '1', nome: `CENTRO ${id}`, empresa_id, ativo });
/** Resumo da unidade como o repository inclui. */
const unidade = (id, { ativo = true } = {}) => ({ id, sigla: 'HA', descricao: 'HECTARE', ativo });

/**
 * Tipo na forma que o repository devolve: colunas + os 3 objetos incluídos
 * (nomes das relações do schema: `centroCustoPadrao`, `centroResultadoPadrao`,
 * `unidadeProducao`) e o coeficiente como `Prisma.Decimal`.
 */
const tipoDoRepositorio = ({ custo = null, resultado = null, un = null, coeficiente = null, flags = {}, ids = {} } = {}) => ({
  id: 'tipo-1',
  cliente_id: 'cliente-1',
  nome_tipo: 'PULVERIZAÇÃO',
  grupo_atividade_id: 'grupo-1',
  grupo_atividade_nome: 'LAVOURA',
  ativo: true,
  descricao: null,
  categoria: 'APLICACAO',
  centro_custo_padrao_id: ids.custo !== undefined ? ids.custo : custo?.id ?? null,
  centro_resultado_padrao_id: ids.resultado !== undefined ? ids.resultado : resultado?.id ?? null,
  unidade_producao_id: ids.unidade !== undefined ? ids.unidade : un?.id ?? null,
  coeficiente_padrao: coeficiente === null ? null : new Prisma.Decimal(coeficiente),
  ...Object.fromEntries(FLAGS.map((f) => [f, false])),
  ...flags,
  centroCustoPadrao: custo,
  centroResultadoPadrao: resultado,
  unidadeProducao: un,
  createdAt: new Date('2027-06-01T12:00:00.000Z'),
  updatedAt: new Date('2027-06-01T12:00:00.000Z'),
});

/** O coeficiente devolvido, comparado pelo VALOR (Decimal, string ou número). */
const valorDe = (v) => (v === null || v === undefined ? v : new Prisma.Decimal(String(v)).toFixed(4));

describe('D-PROD-195 — tipoAtividadePadroes: constantes', () => {
  test('CATEGORIAS_TIPO_ATIVIDADE: exatamente as 9 do CHECK, congeladas', () => {
    assert.ok(Array.isArray(CATEGORIAS_TIPO_ATIVIDADE));
    assert.deepEqual([...CATEGORIAS_TIPO_ATIVIDADE].sort(), [...CATEGORIAS].sort());
    assert.equal(new Set(CATEGORIAS_TIPO_ATIVIDADE).size, 9, 'sem repetição');
    assert.ok(Object.isFrozen(CATEGORIAS_TIPO_ATIVIDADE), 'congeladas');
    assert.throws(() => /** @type {any} */ (CATEGORIAS_TIPO_ATIVIDADE).push('NOVA'), TypeError);
  });

  test('FLAGS_TIPO_ATIVIDADE: exatamente as 8 flags, na ordem do contrato', () => {
    assert.deepEqual([...FLAGS_TIPO_ATIVIDADE], [...FLAGS]);
  });
});

describe('D-PROD-195 — padroesParaAtividade(tipo, { empresaId })', () => {
  test('centros ATIVOS da MESMA empresa e unidade ATIVA são herdados; o coeficiente vem junto', () => {
    const tipo = tipoDoRepositorio({ custo: centro('cc-1'), resultado: centro('cr-1'), un: unidade('un-1'), coeficiente: '1.5' });
    const p = padroesParaAtividade(tipo, { empresaId: EMPRESA });
    assert.deepEqual(Object.keys(p).sort(), [...CHAVES_PADROES], 'exatamente as 4 chaves do contrato');
    assert.deepEqual([p.centro_custo_id, p.centro_resultado_id, p.unidade_producao_id], ['cc-1', 'cr-1', 'un-1']);
    assert.equal(valorDe(p.coeficiente), '1.5000');
  });

  test('centro de OUTRA empresa → null (cada centro decide por si); a unidade, do tenant, não depende da empresa', () => {
    const tipo = tipoDoRepositorio({
      custo: centro('cc-1', { empresa_id: OUTRA_EMPRESA }), resultado: centro('cr-1'), un: unidade('un-1'), coeficiente: '2',
    });
    const p = padroesParaAtividade(tipo, { empresaId: EMPRESA });
    assert.deepEqual([p.centro_custo_id, p.centro_resultado_id, p.unidade_producao_id], [null, 'cr-1', 'un-1']);
    assert.equal(valorDe(p.coeficiente), '2.0000');

    const ambos = padroesParaAtividade(
      tipoDoRepositorio({ custo: centro('cc-1', { empresa_id: OUTRA_EMPRESA }), resultado: centro('cr-1', { empresa_id: OUTRA_EMPRESA }), un: unidade('un-1') }),
      { empresaId: EMPRESA }
    );
    assert.deepEqual(ambos, { ...TUDO_NULL, unidade_producao_id: 'un-1' });
    const naVizinha = padroesParaAtividade(
      tipoDoRepositorio({ custo: centro('cc-1', { empresa_id: OUTRA_EMPRESA }), resultado: centro('cr-1') }),
      { empresaId: OUTRA_EMPRESA }
    );
    assert.deepEqual([naVizinha.centro_custo_id, naVizinha.centro_resultado_id], ['cc-1', null], 'a mesma regra vista da outra fazenda');
  });

  test('centro ou unidade INATIVO → null (mesma empresa não basta)', () => {
    const tipo = tipoDoRepositorio({
      custo: centro('cc-1', { ativo: false }), resultado: centro('cr-1', { ativo: false }), un: unidade('un-1', { ativo: false }), coeficiente: '0.5',
    });
    const p = padroesParaAtividade(tipo, { empresaId: EMPRESA });
    assert.deepEqual([p.centro_custo_id, p.centro_resultado_id, p.unidade_producao_id], [null, null, null]);
    assert.equal(valorDe(p.coeficiente), '0.5000', 'o coeficiente não depende dos cadastros');

    const soUnidadeInativa = padroesParaAtividade(tipoDoRepositorio({ custo: centro('cc-1'), un: unidade('un-1', { ativo: false }) }), { empresaId: EMPRESA });
    assert.deepEqual(soUnidadeInativa, { ...TUDO_NULL, centro_custo_id: 'cc-1' });
  });

  test('sem padrões → tudo null', () => {
    assert.deepEqual(padroesParaAtividade(tipoDoRepositorio(), { empresaId: EMPRESA }), TUDO_NULL);
  });

  test('id gravado sem o objeto incluído (o cadastro não existe) → null', () => {
    const tipo = tipoDoRepositorio({ ids: { custo: 'cc-sumiu', resultado: 'cr-sumiu', unidade: 'un-sumiu' } });
    assert.deepEqual(padroesParaAtividade(tipo, { empresaId: EMPRESA }), TUDO_NULL);
  });

  test('não altera o tipo recebido', () => {
    const tipo = tipoDoRepositorio({ custo: centro('cc-1', { empresa_id: OUTRA_EMPRESA }), resultado: centro('cr-1', { ativo: false }), un: unidade('un-1'), coeficiente: '3' });
    const antes = JSON.stringify(tipo);
    padroesParaAtividade(tipo, { empresaId: EMPRESA });
    regrasDoTipo(tipo);
    assert.equal(JSON.stringify(tipo), antes);
  });
});

describe('D-PROD-195 — regrasDoTipo(tipo)', () => {
  test('exatamente as 8 flags, booleanas, com o valor do tipo (sem os demais campos)', () => {
    const ligadas = { exige_maquina: true, permite_implemento: true, permite_mao_obra: true };
    const tipo = tipoDoRepositorio({ custo: centro('cc-1'), un: unidade('un-1'), coeficiente: '1', flags: ligadas });
    const regras = regrasDoTipo(tipo);
    assert.deepEqual(Object.keys(regras).sort(), [...FLAGS].sort());
    assert.deepEqual(regras, { ...Object.fromEntries(FLAGS.map((f) => [f, false])), ...ligadas });
    for (const f of FLAGS) assert.equal(typeof regras[f], 'boolean', f);

    for (const f of FLAGS) {
      assert.deepEqual(regrasDoTipo(tipoDoRepositorio({ flags: { [f]: true } })), { ...Object.fromEntries(FLAGS.map((x) => [x, false])), [f]: true }, `só ${f}`);
    }
    const todas = Object.fromEntries(FLAGS.map((f) => [f, true]));
    assert.deepEqual(regrasDoTipo(tipoDoRepositorio({ flags: todas })), todas);
  });

  test('flag ausente no objeto recebido sai false (o resultado é sempre booleano)', () => {
    const regras = regrasDoTipo({ id: 'parcial', exige_area: true });
    assert.deepEqual(Object.keys(regras).sort(), [...FLAGS].sort());
    for (const f of FLAGS) assert.equal(typeof regras[f], 'boolean', f);
    assert.equal(regras.exige_area, true);
    assert.equal(regras.exige_producao, false);
  });
});

describe('D-PROD-195 — tipoAtividadePadroes é puro', () => {
  test('sem Prisma e sem I/O: nenhum import de banco, @prisma/client, fs, rede ou processo', () => {
    const fonte = readFileSync(new URL('../src/modules/tiposAtividade/tipoAtividadePadroes.js', import.meta.url), 'utf8');
    const imports = [...fonte.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1] ?? m[2] ?? m[3]);
    const proibidos = imports.filter((m) => /prisma|database|^(node:)?(fs|fs\/promises|net|http|https|child_process|dgram|tls)$/.test(m));
    assert.deepEqual(proibidos, [], `imports proibidos: ${imports.join(', ')}`);
    assert.doesNotMatch(fonte, /getPrismaClient|\$transaction|\$queryRaw|fetch\(/, 'nada de banco ou rede no módulo');
  });
});

describe('D-PROD-195 — padroesParaAtividade com o tipo lido pelo repository (PostgreSQL)', () => {
  const p = () => getPrismaClient();

  before(async () => {
    await limparBanco();
  });
  after(async () => {
    await encerrar();
  });

  test('detalhe e lista do repository: herda na fazenda do centro; na outra fazenda, centros null e unidade mantida; inativado, null', async () => {
    const sufixo = randomUUID().slice(0, 8);
    const cliente = await p().cliente.create({ data: { codigo: `tap-${sufixo}`, nome: `Tenant ${sufixo}` } });
    const c = cliente.id;
    const e1 = await p().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'F1', nome: `Fazenda 1 ${sufixo}` } });
    const e2 = await p().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'F2', nome: `Fazenda 2 ${sufixo}` } });
    const grupo = await p().grupoAtividade.create({ data: { cliente_id: c, nome_grupo: 'LAVOURA' } });
    const cc = await p().centroCusto.create({ data: { cliente_id: c, empresa_id: e1.id, numero: '1', nome: 'MAQUINAS' } });
    const cr = await p().centroResultado.create({ data: { cliente_id: c, empresa_id: e1.id, numero: '1', nome: 'SOJA' } });
    const un = await p().unidadeMedida.create({ data: { cliente_id: c, numero_unidade: '1', sigla: 'HA', descricao: 'HECTARE' } });
    const criado = await p().tipoAtividade.create({
      data: {
        cliente_id: c, nome_tipo: 'PULVERIZAÇÃO', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo,
        categoria: 'APLICACAO', centro_custo_padrao_id: cc.id, centro_resultado_padrao_id: cr.id, unidade_producao_id: un.id,
        coeficiente_padrao: '1.25', exige_maquina: true, permite_produto: true,
      },
    });

    const detalhe = await buscarTipo(c, criado.id);
    const [daLista] = await listarTipos(c);
    for (const [rotulo, tipo] of [['detalhe', detalhe], ['lista', daLista]]) {
      const naF1 = padroesParaAtividade(tipo, { empresaId: e1.id });
      assert.deepEqual([naF1.centro_custo_id, naF1.centro_resultado_id, naF1.unidade_producao_id], [cc.id, cr.id, un.id], `${rotulo}: fazenda do centro herda`);
      assert.equal(valorDe(naF1.coeficiente), '1.2500', `${rotulo}: coeficiente`);
      const naF2 = padroesParaAtividade(tipo, { empresaId: e2.id });
      assert.deepEqual([naF2.centro_custo_id, naF2.centro_resultado_id, naF2.unidade_producao_id], [null, null, un.id], `${rotulo}: outra fazenda`);
      assert.deepEqual(regrasDoTipo(tipo), { ...Object.fromEntries(FLAGS.map((f) => [f, false])), exige_maquina: true, permite_produto: true }, `${rotulo}: regras`);
    }

    await p().centroCusto.update({ where: { id: cc.id }, data: { ativo: false } });
    await p().unidadeMedida.update({ where: { id: un.id }, data: { ativo: false } });
    const depois = padroesParaAtividade(await buscarTipo(c, criado.id), { empresaId: e1.id });
    assert.deepEqual([depois.centro_custo_id, depois.centro_resultado_id, depois.unidade_producao_id], [null, cr.id, null], 'inativados deixam de ser herdados');

    const vazio = await p().tipoAtividade.create({ data: { cliente_id: c, nome_tipo: 'CAPINA', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
    assert.deepEqual(padroesParaAtividade(await buscarTipo(c, vazio.id), { empresaId: e1.id }), TUDO_NULL, 'sem padrão: tudo null');
    assert.deepEqual(regrasDoTipo(await buscarTipo(c, vazio.id)), Object.fromEntries(FLAGS.map((f) => [f, false])));
  });
});
