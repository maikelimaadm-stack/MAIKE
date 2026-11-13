/**
 * MAIKE-ESTOQUE-P1-02 (D-PROD-177) — M2: parametrização ADITIVA do motor
 * (contrato §6.2 itens 1–6). PostgreSQL real; o motor é chamado direto,
 * dentro de transações reais com a trava canônica do produto.
 *
 *  P1. sem os parâmetros novos, a entrada grava exatamente o de antes
 *      (`compra_financeiro`, motivo do financeiro, origem e exclusão do
 *      financeiro, procedência do lote vinda de documento/parceiro); e é
 *      idêntica, coluna a coluna, à entrada com os padrões passados explícitos;
 *      a compra pela Central (HTTP) continua com os mesmos rótulos;
 *  P2. `ORIGEM_ENTRADA_ESTOQUE` + `entrada_doacao` + motivo + procedência →
 *      colunas gravadas (movimento com o parceiro, lote com a procedência);
 *      procedência parcial sobrepõe só as chaves passadas;
 *  P3. recusas fail-closed (erro de programação, 500) ANTES de qualquer
 *      escrita: tipo inválido, `compra_financeiro` com a origem nova,
 *      `entrada_*` fora dela, motivo ausente/vazio, chave de procedência fora
 *      da allowlist, valor não texto, objeto não simples, origem desconhecida;
 *  P4. `estornarEmLote` com efeito ENTRADA + origem nova + `ESTORNO_ENTRADA_*`
 *      grava esses rótulos (original 'Estornada', lote 'Estornado', cache volta);
 *  P5. `estornarEmLote` sem os parâmetros novos: `estorno_compra` /
 *      `estorno_venda` e os textos de antes; `efeito` explícito igual à direção;
 *  P6. recusas fail-closed do estorno em lote (antes de qualquer escrita,
 *      inclusive com `itens` vazio).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, docCom, montarTenant, prisma } from './gestaoP3Cenario.mjs';
import {
  argsEntrada, argsEstornoEmLote, conferirInvariantes, contagens, ctxDe, entrar, estornarLote, itemDaEntrada, itemDaSaida, q4,
  recusaAntesDeEscrever, resumoErro, sairFifo,
} from './estoqueP1MCenario.mjs';
import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
});
after(async () => {
  await app.close();
  await encerrar();
});

const MOTIVO_FINANCEIRO = 'Entrada por lançamento financeiro confirmado';
const MOTIVO_ESTORNO_COMPRA = 'Estorno de compra por cancelamento do lançamento financeiro';
const MOTIVO_ESTORNO_VENDA = 'Estorno de venda por cancelamento do lançamento financeiro';
const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });

/** Colunas da linha sem o que varia por chamada (ids, números, instantes, vínculo entre as duas linhas). */
const semIdentidade = (linha) => {
  const resto = { ...linha };
  for (const k of ['id', 'numero_movimentacao', 'createdAt', 'updatedAt', 'movimentacao_entrada_id']) delete resto[k];
  return JSON.parse(JSON.stringify(resto));
};

describe('P1 — sem os parâmetros novos a entrada é a de antes', () => {
  test('rótulos, origem, exclusão e procedência do financeiro; idêntica coluna a coluna à entrada com os padrões explícitos; compra pela Central com os mesmos rótulos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    assert.deepEqual(
      [motor.ORIGEM_ENTRADA_ESTOQUE, motor.ESTORNO_ENTRADA_REVISAO, motor.ESTORNO_ENTRADA_EXCLUSAO, motor.EFEITO_ENTRADA, motor.EFEITO_SAIDA],
      ['entrada_estoque', 'estorno_entrada_revisao', 'estorno_entrada_exclusao', 'ENTRADA', 'SAIDA'],
    );

    const r = await entrar(s, e, e.sal);
    const m = await movimento(r.movimento.id);
    const l = await lote(r.lote.id);
    assert.deepEqual(
      [m.tipo_movimentacao, m.tipo_detalhado, m.motivo_movimentacao, m.origem_sistema, m.exclusao_somente_em, m.fornecedor_id, m.fornecedor_nome, m.numero_documento, m.status],
      ['Entrada', 'compra_financeiro', MOTIVO_FINANCEIRO, 'operacao_financeira', 'operacao_financeira', e.forn.id, e.forn.nome, 'NF-100', 'Ativa'],
    );
    assert.deepEqual([l.fornecedor_id, l.fornecedor_nome, l.numero_documento, l.serie_documento], [e.forn.id, e.forn.nome, 'NF-100', null], 'procedência do lote = documento/parceiro');
    assert.deepEqual([q4(l.quantidade_entrada), q4(l.custo_unitario), l.status, l.movimentacao_entrada_id], ['10.0000', '2.5000', 'Disponivel', m.id]);
    assert.match(m.numero_movimentacao, /^\d+$/);

    // os padrões passados explicitamente geram as MESMAS colunas
    const explicito = await entrar(s, e, e.sal, {
      origem: { operacaoId: 'op-motor-p102', sistema: motor.ORIGEM_SISTEMA, tipoDetalhado: 'compra_financeiro', motivo: MOTIVO_FINANCEIRO },
      procedencia: undefined,
    });
    const m2 = await movimento(explicito.movimento.id);
    const l2 = await lote(explicito.lote.id);
    const mov1 = semIdentidade(m);
    const mov2 = semIdentidade(m2);
    // saldo antes/depois corre (2ª entrada no mesmo local)
    assert.deepEqual([q4(m.saldo_antes), q4(m.saldo_depois), q4(m2.saldo_antes), q4(m2.saldo_depois)], ['0.0000', '10.0000', '10.0000', '20.0000']);
    for (const k of ['saldo_antes', 'saldo_depois']) {
      delete mov1[k];
      delete mov2[k];
    }
    assert.deepEqual(mov2, mov1, 'movimento: sem parâmetros novos = padrões explícitos');
    assert.deepEqual(semIdentidade(l2), semIdentidade(l), 'lote: sem parâmetros novos = padrões explícitos');

    // procedência null/undefined = ausente (nada sobrepõe)
    const nulo = await entrar(s, e, e.sal, { procedencia: null });
    const l3 = await lote(nulo.lote.id);
    assert.deepEqual([l3.fornecedor_id, l3.fornecedor_nome, l3.numero_documento], [e.forn.id, e.forn.nome, 'NF-100']);

    // a Central (HTTP) continua gravando os rótulos da compra
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.milho, quantidade: '4', valor_unitario: '3' }]));
    const mc = await movimento(compra.itens[0].movimentacao_estoque_id);
    assert.deepEqual([mc.tipo_detalhado, mc.motivo_movimentacao, mc.origem_sistema, mc.exclusao_somente_em], ['compra_financeiro', MOTIVO_FINANCEIRO, 'operacao_financeira', 'operacao_financeira']);
    await conferirInvariantes(s, 'P1');
  });
});

describe('P2 — entrada documentada (origem nova) grava os rótulos e a procedência', () => {
  test('entrada_estoque + entrada_doacao + motivo + procedência: movimento com os rótulos e o parceiro; lote com a procedência informada; cache +kg; procedência parcial sobrepõe só a chave dada', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const antes = await contagens(s, e.sal);
    const r = await entrar(s, e, e.sal, {
      origem: { operacaoId: 'entrada-doc-1', sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: 'entrada_doacao', motivo: 'Doação recebida do vizinho' },
      procedencia: { fornecedor_id: null, fornecedor_nome: 'DOADOR JOAO', numero_documento: 'TERMO-7' },
    });
    const m = await movimento(r.movimento.id);
    const l = await lote(r.lote.id);
    assert.deepEqual(
      [m.tipo_movimentacao, m.tipo_detalhado, m.motivo_movimentacao, m.origem_sistema, m.exclusao_somente_em, m.lancamento_origem_id, m.bloqueado_exclusao_estoque, m.status],
      ['Entrada', 'entrada_doacao', 'Doação recebida do vizinho', 'entrada_estoque', 'entrada_estoque', 'entrada-doc-1', true, 'Ativa'],
    );
    assert.deepEqual([m.fornecedor_id, m.fornecedor_nome, m.numero_documento], [e.forn.id, e.forn.nome, 'NF-100'], 'o movimento continua com o parceiro e o documento');
    assert.deepEqual([l.fornecedor_id, l.fornecedor_nome, l.numero_documento], [null, 'DOADOR JOAO', 'TERMO-7'], 'o lote leva a procedência informada (null sobrepõe)');
    assert.deepEqual([q4(l.quantidade_entrada), q4(l.quantidade_disponivel), q4(l.custo_unitario), l.status], ['10.0000', '10.0000', '2.5000', 'Disponivel']);
    const depois = await contagens(s, e.sal);
    assert.deepEqual([depois.lotes - antes.lotes, depois.movimentos - antes.movimentos, depois.estoque_atual], [1, 1, '10.0000']);

    // procedência parcial: só o número do documento muda; fornecedor vem do parceiro
    const parcial = await entrar(s, e, e.sal, {
      origem: { operacaoId: 'entrada-doc-2', sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: 'entrada_saldo_implantacao', motivo: 'Saldo de implantação' },
      procedencia: { numero_documento: 'INV-2027' },
    });
    const lp = await lote(parcial.lote.id);
    assert.deepEqual([lp.fornecedor_id, lp.fornecedor_nome, lp.numero_documento], [e.forn.id, e.forn.nome, 'INV-2027']);
    assert.equal((await movimento(parcial.movimento.id)).tipo_detalhado, 'entrada_saldo_implantacao');

    // sem parceiro nem documento: o movimento fica sem fornecedor; o lote só com a procedência
    const semParceiro = await entrar(s, e, e.sal, {
      parceiro: undefined, documento: undefined,
      origem: { operacaoId: 'entrada-doc-3', sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: 'entrada_outra', motivo: 'Outra com justificativa' },
      procedencia: { fornecedor_nome: 'ORIGEM DECLARADA' },
    });
    const ms = await movimento(semParceiro.movimento.id);
    const ls = await lote(semParceiro.lote.id);
    assert.deepEqual([ms.fornecedor_id, ms.fornecedor_nome, ms.numero_documento], [null, null, null]);
    assert.deepEqual([ls.fornecedor_id, ls.fornecedor_nome, ls.numero_documento], [null, 'ORIGEM DECLARADA', null]);
    await conferirInvariantes(s, 'P2');
  });
});

describe('P3 — recusas fail-closed da entrada, antes de qualquer escrita', () => {
  test('tipo inválido, compra_financeiro com a origem nova, entrada_* fora dela, motivo ausente/vazio, procedência fora da allowlist/não texto/não objeto simples, origem desconhecida → erro de programação (500); nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await entrar(s, e, e.sal); // estado prévio não vazio
    const NOVA = motor.ORIGEM_ENTRADA_ESTOQUE;
    const comMotivo = { operacaoId: 'x', sistema: NOVA, motivo: 'Doação' };
    /** @type {Array<[string, Record<string, unknown>, RegExp]>} */
    const casos = [
      ['tipo ausente na origem nova', { origem: { ...comMotivo } }, /exige tipoDetalhado entrada_<motivo>/],
      ['tipo sem prefixo', { origem: { ...comMotivo, tipoDetalhado: 'doacao' } }, /exige tipoDetalhado entrada_<motivo>/],
      ['tipo só com o prefixo', { origem: { ...comMotivo, tipoDetalhado: 'entrada_' } }, /exige tipoDetalhado entrada_<motivo>/],
      ['tipo em maiúsculas', { origem: { ...comMotivo, tipoDetalhado: 'ENTRADA_DOACAO' } }, /exige tipoDetalhado entrada_<motivo>/],
      ['tipo com acento', { origem: { ...comMotivo, tipoDetalhado: 'entrada_doação' } }, /exige tipoDetalhado entrada_<motivo>/],
      ['tipo com espaço', { origem: { ...comMotivo, tipoDetalhado: 'entrada_doacao ' } }, /exige tipoDetalhado entrada_<motivo>/],
      ['tipo longo demais (41 após o prefixo)', { origem: { ...comMotivo, tipoDetalhado: `entrada_${'a'.repeat(41)}` } }, /exige tipoDetalhado entrada_<motivo>/],
      ['compra_financeiro com a origem nova', { origem: { ...comMotivo, tipoDetalhado: 'compra_financeiro' } }, /exige tipoDetalhado entrada_<motivo>/],
      ['compra_financeiro com outra origem do motor', { origem: { operacaoId: 'x', sistema: motor.ORIGEM_DEPOSITO, tipoDetalhado: 'compra_financeiro' } }, /compra_financeiro só com a origem operacao_financeira/],
      ['compra padrão com origem do abastecimento', { origem: { operacaoId: 'x', sistema: motor.ORIGEM_ABASTECIMENTO } }, /compra_financeiro só com a origem operacao_financeira/],
      ['entrada_* com a origem do financeiro', { origem: { operacaoId: 'x', tipoDetalhado: 'entrada_doacao' } }, /entrada_<motivo> só com a origem entrada_estoque/],
      ['motivo ausente na origem nova', { origem: { operacaoId: 'x', sistema: NOVA, tipoDetalhado: 'entrada_doacao' } }, /exige origem\.motivo/],
      ['motivo vazio', { origem: { ...comMotivo, tipoDetalhado: 'entrada_doacao', motivo: '   ' } }, /origem\.motivo, quando informado, é texto não vazio/],
      ['motivo não texto (financeiro)', { origem: { operacaoId: 'x', motivo: 12 } }, /origem\.motivo, quando informado, é texto não vazio/],
      ['procedência: serie_documento fora da allowlist', { procedencia: { serie_documento: '1' } }, /campo de procedência não permitido: serie_documento/],
      ['procedência: cliente_id (tenant pelo corpo)', { procedencia: { cliente_id: 'outro-tenant' } }, /campo de procedência não permitido: cliente_id/],
      ['procedência: empresa_id', { procedencia: { empresa_id: s.e2.id } }, /campo de procedência não permitido: empresa_id/],
      ['procedência: status', { procedencia: { status: 'Esgotado' } }, /campo de procedência não permitido: status/],
      ['procedência: valor numérico', { procedencia: { numero_documento: 7 } }, /procedência numero_documento deve ser texto ou nulo/],
      ['procedência: array', { procedencia: ['fornecedor_nome'] }, /procedencia deve ser um objeto simples/],
      ['procedência: texto', { procedencia: 'DOADOR' }, /procedencia deve ser um objeto simples/],
      ['procedência: objeto sem protótipo', { procedencia: Object.assign(Object.create(null), { fornecedor_nome: 'X' }) }, /procedencia deve ser um objeto simples/],
      ['origem desconhecida', { origem: { operacaoId: 'x', sistema: 'manual' } }, /origem de estoque desconhecida: manual/],
    ];
    for (const [rotulo, extra, msg] of casos) {
      const erro = await recusaAntesDeEscrever(s, e.id, [e.sal.id], async (tx) => {
        const lido = await tx.produto.findUnique({ where: { id: e.sal.id } });
        await motor.aplicarEntradaEstoque(tx, ctxDe(s), argsEntrada(s, e, lido, extra));
      });
      const [status, mensagem] = resumoErro(erro);
      assert.equal(status, '500', `${rotulo}: erro de programação (nunca AppError): ${mensagem}`);
      assert.match(mensagem, msg, rotulo);
    }
    // o limite exato do tipo (40 após o prefixo) passa
    const r = await entrar(s, e, e.sal, { origem: { ...comMotivo, tipoDetalhado: `entrada_${'a'.repeat(40)}` } });
    assert.equal((await movimento(r.movimento.id)).tipo_detalhado, `entrada_${'a'.repeat(40)}`);
    await conferirInvariantes(s, 'P3');
  });

  test('produto de outra empresa continua 404 PRODUTO_NOT_FOUND ANTES da validação dos parâmetros novos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const erro = await recusaAntesDeEscrever(s, e.id, [s.e2.sal.id], async (tx) => {
      const outro = await tx.produto.findUnique({ where: { id: s.e2.sal.id } });
      await motor.aplicarEntradaEstoque(tx, ctxDe(s), argsEntrada(s, e, outro, { origem: { operacaoId: 'x', sistema: 'xpto' }, procedencia: { cliente_id: 'y' } }));
    });
    assert.deepEqual(resumoErro(erro), [404, 'PRODUTO_NOT_FOUND', null, null]);
  });
});

describe('P4 — estorno em lote da entrada documentada', () => {
  test('efeito ENTRADA + origem nova + ESTORNO_ENTRADA_EXCLUSAO / REVISAO: Saída com os rótulos; original Estornada com filho; lote Estornado; cache volta', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const origemEntrada = (id) => ({ operacaoId: id, sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: 'entrada_doacao', motivo: 'Doação' });
    const r1 = await entrar(s, e, e.sal, { origem: origemEntrada('doc-1') });
    const r2 = await entrar(s, e, e.sal, { origem: origemEntrada('doc-2'), quantidadeKg: '4.0000', valorTotal: '10.0000' });
    assert.equal((await contagens(s, e.sal)).estoque_atual, '14.0000');

    const casos = [
      [r1, motor.ESTORNO_ENTRADA_EXCLUSAO, 'Exclusão da entrada de estoque', '4.0000'],
      [r2, motor.ESTORNO_ENTRADA_REVISAO, 'Revisão da entrada de estoque', '0.0000'],
    ];
    for (const [r, tipo, motivoTexto, cacheDepois] of casos) {
      const [id] = await estornarLote(s, e, [itemDaEntrada(r)], {
        efeito: motor.EFEITO_ENTRADA,
        origem: { operacaoId: r.movimento.lancamento_origem_id, sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhadoEstorno: tipo, motivoEstorno: motivoTexto },
      });
      const est = await movimento(id);
      const orig = await movimento(r.movimento.id);
      const l = await lote(r.lote.id);
      assert.deepEqual(
        [est.tipo_movimentacao, est.tipo_detalhado, est.motivo_movimentacao, est.origem_sistema, est.exclusao_somente_em, est.movimento_pai_id, q4(est.quantidade), q4(est.valor_total), est.local_estoque_origem],
        ['Saída', tipo, motivoTexto, 'entrada_estoque', 'entrada_estoque', orig.id, q4(r.lote.quantidade_entrada), q4(orig.valor_total), s.local.id],
      );
      assert.match(est.numero_movimentacao, /^\d+$/);
      assert.deepEqual([orig.status, orig.movimento_filho_id], ['Estornada', est.id]);
      assert.deepEqual([l.status, q4(l.quantidade_disponivel)], ['Estornado', '0.0000']);
      assert.equal((await contagens(s, e.sal)).estoque_atual, cacheDepois);
    }
    await conferirInvariantes(s, 'P4');
  });
});

describe('P5 — estorno em lote sem os parâmetros novos é o de antes', () => {
  test('compra (direcao PAGAR) → estorno_compra; venda (RECEBER) → estorno_venda; efeito explícito igual à direção dá o mesmo; textos de antes', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c1 = await entrar(s, e, e.sal);
    const [id1] = await estornarLote(s, e, [itemDaEntrada(c1)], { direcao: 'PAGAR' });
    const m1 = await movimento(id1);
    assert.deepEqual([m1.tipo_movimentacao, m1.tipo_detalhado, m1.motivo_movimentacao, m1.origem_sistema], ['Saída', 'estorno_compra', MOTIVO_ESTORNO_COMPRA, 'operacao_financeira']);

    const c2 = await entrar(s, e, e.sal);
    const [id2] = await estornarLote(s, e, [itemDaEntrada(c2)], { direcao: 'PAGAR', efeito: motor.EFEITO_ENTRADA });
    assert.deepEqual([(await movimento(id2)).tipo_detalhado, (await movimento(id2)).motivo_movimentacao], ['estorno_compra', MOTIVO_ESTORNO_COMPRA]);

    const c3 = await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '6.0000');
    const [id3] = await estornarLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER', parceiro: { id: e.cli.id, nome: e.cli.nome } });
    const m3 = await movimento(id3);
    assert.deepEqual([m3.tipo_movimentacao, m3.tipo_detalhado, m3.motivo_movimentacao, m3.cliente_nome], ['Entrada', 'estorno_venda', MOTIVO_ESTORNO_VENDA, e.cli.nome]);
    assert.deepEqual([(await lote(c3.lote.id)).status, q4((await lote(c3.lote.id)).quantidade_disponivel)], ['Disponivel', '10.0000']);

    const v2 = await sairFifo(s, e, e.sal, '2.0000');
    const [id4] = await estornarLote(s, e, [itemDaSaida(v2, e.sal, s.local)], { efeito: motor.EFEITO_SAIDA });
    assert.deepEqual([(await movimento(id4)).tipo_detalhado, (await movimento(id4)).motivo_movimentacao], ['estorno_venda', MOTIVO_ESTORNO_VENDA]);
    await conferirInvariantes(s, 'P5');
  });
});

describe('P6 — recusas fail-closed do estorno em lote, antes de qualquer escrita', () => {
  test('efeito fora do domínio, efeito × direção divergentes, origem nova com SAIDA/sem tipo/sem motivo, ESTORNO_ENTRADA_* fora da origem nova, textos vazios → 500; inclusive com itens vazio', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const r = await entrar(s, e, e.sal, { origem: { operacaoId: 'doc', sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: 'entrada_doacao', motivo: 'Doação' } });
    const NOVA = motor.ORIGEM_ENTRADA_ESTOQUE;
    /** @type {Array<[string, Record<string, unknown>, RegExp]>} */
    const casos = [
      ['efeito fora do domínio', { efeito: 'entrada' }, /efeito inválido: entrada/],
      ['efeito ENTRADA × direção RECEBER', { efeito: 'ENTRADA', direcao: 'RECEBER' }, /efeito ENTRADA diverge da direção RECEBER/],
      ['efeito SAIDA × direção PAGAR', { efeito: 'SAIDA', direcao: 'PAGAR' }, /efeito SAIDA diverge da direção PAGAR/],
      ['origem nova com efeito SAIDA', { efeito: 'SAIDA', origem: { operacaoId: 'doc', sistema: NOVA, tipoDetalhadoEstorno: motor.ESTORNO_ENTRADA_EXCLUSAO, motivoEstorno: 'x' } }, /só estorna efeito ENTRADA/],
      ['origem nova sem tipo', { efeito: 'ENTRADA', origem: { operacaoId: 'doc', sistema: NOVA, motivoEstorno: 'x' } }, /exige tipoDetalhadoEstorno/],
      ['origem nova com estorno_compra', { efeito: 'ENTRADA', origem: { operacaoId: 'doc', sistema: NOVA, tipoDetalhadoEstorno: 'estorno_compra', motivoEstorno: 'x' } }, /exige tipoDetalhadoEstorno/],
      ['origem nova sem motivo', { efeito: 'ENTRADA', origem: { operacaoId: 'doc', sistema: NOVA, tipoDetalhadoEstorno: motor.ESTORNO_ENTRADA_REVISAO } }, /exige motivoEstorno/],
      ['ESTORNO_ENTRADA_EXCLUSAO com a origem do financeiro', { direcao: 'PAGAR', origem: { operacaoId: 'doc', tipoDetalhadoEstorno: motor.ESTORNO_ENTRADA_EXCLUSAO } }, /só com a origem entrada_estoque/],
      ['tipo vazio', { direcao: 'PAGAR', origem: { operacaoId: 'doc', tipoDetalhadoEstorno: '' } }, /tipoDetalhadoEstorno, quando informado, é texto não vazio/],
      ['motivo vazio', { direcao: 'PAGAR', origem: { operacaoId: 'doc', motivoEstorno: ' ' } }, /motivoEstorno, quando informado, é texto não vazio/],
      ['origem desconhecida', { direcao: 'PAGAR', origem: { operacaoId: 'doc', sistema: 'manual' } }, /origem de estoque desconhecida/],
    ];
    for (const [rotulo, extra, msg] of casos) {
      for (const itens of [[itemDaEntrada(r)], []]) {
        const erro = await recusaAntesDeEscrever(s, e.id, [e.sal.id], (tx) => motor.estornarEmLote(tx, ctxDe(s), argsEstornoEmLote(s, e, itens, extra)));
        const [status, mensagem] = resumoErro(erro);
        assert.equal(status, '500', `${rotulo} (${itens.length} itens): ${mensagem}`);
        assert.match(mensagem, msg, `${rotulo} (${itens.length} itens)`);
      }
    }
    // o original segue Ativa e o lote intocado: o estorno correto ainda passa
    assert.deepEqual([(await movimento(r.movimento.id)).status, (await lote(r.lote.id)).status], ['Ativa', 'Disponivel']);
    const [id] = await estornarLote(s, e, [itemDaEntrada(r)], { efeito: 'ENTRADA', origem: { operacaoId: 'doc', sistema: NOVA, tipoDetalhadoEstorno: motor.ESTORNO_ENTRADA_EXCLUSAO, motivoEstorno: 'Exclusão' } });
    assert.equal((await movimento(id)).tipo_detalhado, 'estorno_entrada_exclusao');
    await conferirInvariantes(s, 'P6');
  });
});

describe('P7 — a origem nova não tem escritor público até a P1-05a', () => {
  test('nenhum arquivo de backend/src fora do motor cita entrada_estoque / ORIGEM_ENTRADA_ESTOQUE (sem rota, sem reconciliação)', () => {
    const raiz = new URL('../src/', import.meta.url).pathname;
    /** @param {string} d @returns {string[]} */
    const arquivos = (d) => readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? arquivos(p) : (/\.(m?js)$/.test(n) ? [p] : []);
    });
    const citam = arquivos(raiz)
      .filter((p) => !p.endsWith('estoqueFisico/estoqueFisicoMotor.js'))
      .filter((p) => /ORIGEM_ENTRADA_ESTOQUE|['"`]entrada_estoque['"`]/.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(raiz.length));
    assert.deepEqual(citam, [], 'a origem entrada_estoque só ganha escritor na P1-05a');
  });
});
