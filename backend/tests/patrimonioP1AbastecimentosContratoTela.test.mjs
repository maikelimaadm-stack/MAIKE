/**
 * D-PROD-159 — Patrimônio P1-02: INTEGRAÇÃO TELA × API (INT-1, contrato §9.3).
 *
 * Importa o módulo PURO da tela (`src/lib/abastecimentoRegras.js`, só imports
 * relativos) e manda à API REAL (Fastify `app.inject` + PostgreSQL local) os
 * corpos que a TELA monta a partir do formulário como o usuário o preenche:
 * texto pt-BR com vírgula decimal ("80,0", "1550,5", "0,84"), as OPÇÕES do
 * próprio servidor (A7 bens, A8 tanques, A10 produtos, A12 locais) e a chave
 * `lanc-<uuid>` do serviço. Percorre A3 sem fator (fail-closed) → A14 → A13 →
 * A3 → A4 → replay → A1 (`operation_id`) → A2 → A6 → A5 → replay do A5 → A15,
 * e exige em TODA resposta `conferirRespostaAbastecimento(body) = []` (a forma
 * que a tela lê). O KG que a tela estima (`estimarKg`) tem de ser o KG que o
 * servidor converte, para todos os vetores de `abastecimentoVetores.json`
 * (prévia e confirmação; recusas sem número na tela e 422 na API). Os
 * bloqueios/erros reais têm de trazer os `details` que as mensagens da tela
 * (`patrimonioErros.js`) leem; o consumo CALCULADO tem a forma do painel.
 *
 * Se este arquivo falhar, a tela e a API divergem: corrija o lado errado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, fotoAbastecimento, montarAbastecimento, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { FUSO, HOJE } from './patrimonioP1Cenario.mjs';
import {
  assinaturaDoFormulario,
  canonicoDoDigitado,
  conferirRespostaAbastecimento,
  estimarKg,
  formularioVazio,
  kgDaBaixaNaPrevia,
  LIMITES_ABASTECIMENTO,
  montarCorpoCancelamento,
  montarCorpoConfirmacao,
  montarCorpoConversao,
  montarCorpoPrevia,
  validarFormulario,
} from '../../src/lib/abastecimentoRegras.js';
import { hojeNoFuso } from '../../src/lib/diaCivil.js';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/abastecimentoVetores.json', import.meta.url), 'utf8'));

/** Chave como o serviço da tela gera (`operacaoFinanceiraService.novaChave`). */
const chaveDaTela = () => `lanc-${randomUUID()}`;
/** Canônico ("123.4567") → o que o usuário digita no Brasil ("123,4567"). */
const digitado = (canonico) => canonico.replace('.', ',');

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

/** A resposta tem de estar na forma do §6.1 que a tela lê. */
const conforme = (body, onde) => assert.deepEqual(conferirRespostaAbastecimento(body), [], `${onde}: ${JSON.stringify(conferirRespostaAbastecimento(body))}`);

/**
 * Preenche o formulário COMO A TELA: bem → tanque → combustível → produto →
 * local, sempre a partir das opções do servidor (`FormularioAbastecimento.jsx`).
 * @param {any} s @param {string} tok
 * @param {{ bemId: string, tipoId: string, produtoId: string, litros: string, leitura?: string, tanqueCheio?: boolean, data?: string }} p
 */
const preencher = async (s, tok, p) => {
  const bens = await A.ok(A.opcoes(tok, 'bens', `empresa_id=${s.e1.id}`));
  const bem = bens.itens.find((b) => b.id === p.bemId);
  assert.ok(bem, 'o bem aparece no seletor do formulário');
  const tanques = await A.ok(A.opcoes(tok, 'tanques', `empresa_id=${s.e1.id}&bem_id=${bem.id}`));
  assert.equal(tanques.itens.length, 1, 'tanque único → a tela auto-seleciona');
  const tanque = tanques.itens[0];
  assert.ok(tanque.combustiveis.some((c) => c.id === p.tipoId), 'o combustível aparece entre os do tanque');
  const produtos = await A.ok(A.opcoes(tok, 'produtos', `empresa_id=${s.e1.id}&tipo_combustivel_id=${p.tipoId}`));
  const produto = produtos.itens.find((x) => x.id === p.produtoId);
  assert.ok(produto, 'o produto aparece no seletor do combustível');
  const locais = await A.ok(A.opcoes(tok, 'locais', `empresa_id=${s.e1.id}&produto_id=${produto.id}`));
  assert.equal(locais.itens.length, 1, 'um local com saldo → a tela auto-seleciona');
  const hoje = hojeNoFuso(FUSO, new Date(String(process.env.MAIKE_TESTE_AGORA)));
  assert.equal(hoje, HOJE);
  const form = {
    ...formularioVazio(hoje),
    bem,
    tanque_id: tanque.id,
    tipo_combustivel_id: p.tipoId,
    produto,
    local_estoque_id: String(locais.itens[0].local_estoque_id),
    data_operacional: p.data ?? '2027-06-10',
    quantidade_litros: p.litros,
    medidor_leitura: p.leitura ?? '',
    tanque_cheio: p.tanqueCheio === true,
  };
  assert.deepEqual(validarFormulario(form, { hoje, capacidadeLitros: tanque.capacidade_litros }).erros, {}, 'formulário válido para a tela');
  return { form, tanque, produto, hoje };
};

describe('INT-1 — corpos da tela na API real (TP-02 e flex)', () => {
  test('TP-02 diesel S10: A3 sem fator → A14 → A13 → A3 → A4 → replay → A1 → A2 → A6 → A5 → replay → A15; respostas na forma da tela', async () => {
    const s = await montarAbastecimento(app, { fatores: false });
    const tok = s.contaCancelar.token;

    // 1) sem fator: a prévia aponta o bloqueio e a tela NÃO consegue montar a confirmação (fail-closed)
    const sem = await preencher(s, tok, { bemId: s.trator.id, tipoId: s.comb.DIESEL_S10, produtoId: s.diesel.id, litros: '80,0', leitura: '1550,5', tanqueCheio: true });
    assert.equal(sem.produto.conversao, null);
    const p0 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, sem.form)));
    conforme(p0, 'A3 sem fator');
    assert.deepEqual(p0.bloqueios.map((b) => b.code), ['ABASTECIMENTO_CONVERSAO_AUSENTE']);
    assert.throws(() => montarCorpoConfirmacao(s.e1.id, sem.form, p0.plano), /conversao_ausente_no_plano/);

    // 2) A14: o fator digitado como na tela ("0,84"), sem vigente (null) → 201
    const corpoFator = montarCorpoConversao(s.e1.id, { tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: s.diesel.id, kg_por_litro: '0,84', declara_estoque_em_kg: true }, null);
    assert.equal(corpoFator.kg_por_litro, '0.84');
    const fator = await A.ok(A.req('POST', '/patrimonio-conversoes-combustivel', s.contaFator.token, corpoFator), 201);
    conforme(fator, 'A14');
    assert.deepEqual([fator.kg_por_litro, fator.sequencia, fator.ativo], ['0.840000', 1, true]);
    const fatores = await A.ok(A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}&situacao=VIGENTES`, tok));
    conforme(fatores, 'A13');

    // 3) A3 com o formulário relido (o produto agora traz o fator): kg da tela = kg do servidor
    const { form, tanque } = await preencher(s, tok, { bemId: s.trator.id, tipoId: s.comb.DIESEL_S10, produtoId: s.diesel.id, litros: '80,0', leitura: '1550,5', tanqueCheio: true });
    assert.deepEqual(form.produto.conversao, { id: fator.id, versao: fator.versao, sequencia: 1, kg_por_litro: '0.840000' });
    const corpoPrevia = montarCorpoPrevia(s.e1.id, form);
    assert.deepEqual([corpoPrevia.quantidade_litros, corpoPrevia.medidor_leitura], ['80', '1550.5']);
    const antesPrevia = await fotoAbastecimento(s.c);
    const previa = await A.ok(A.previa(tok, corpoPrevia));
    assert.equal(await fotoAbastecimento(s.c), antesPrevia, 'prévia não grava nada');
    conforme(previa, 'A3');
    assert.deepEqual(previa.bloqueios, []);
    const kgDaTela = estimarKg(canonicoDoDigitado(form.quantidade_litros, LIMITES_ABASTECIMENTO.LITROS), form.produto.conversao.kg_por_litro);
    assert.deepEqual([kgDaTela, previa.plano.quantidade_kg, previa.plano.quantidade_litros, previa.plano.hoje], ['67.2000', '67.2000', '80.0000', HOJE]);
    assert.deepEqual([previa.plano.conversao.id, previa.plano.conversao.versao], [fator.id, fator.versao]);
    assert.deepEqual([previa.plano.tanque.capacidade_litros, tanque.capacidade_litros], ['180.0000', '180.0000']);
    const assinatura = assinaturaDoFormulario(form);

    // 4) A4 com o corpo da tela (fator VISTO na prévia + chave do serviço) → 201
    const corpo = { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: chaveDaTela() };
    assert.equal(assinaturaDoFormulario(form), assinatura, 'montar o corpo não muda o formulário');
    const r4 = await A.confirmar(tok, corpo);
    assert.equal(r4.statusCode, 201, r4.body);
    const det = r4.json();
    conforme(det, 'A4');
    assert.deepEqual([det.replay, det.status, det.quantidade_litros, det.quantidade_kg, det.kg_por_litro, det.custo_total, det.custo_unitario_kg],
      [false, 'CONFIRMADO', '80.0000', kgDaTela, '0.840000', VETORES.fifo.custo_total, VETORES.fifo.custo_unitario_kg]);
    assert.deepEqual(det.fatias.map((f) => [f.quantidade_kg, f.custo_unitario, f.valor]), VETORES.fifo.fatias.map((f) => [f.quantidade_kg, f.custo_unitario, f.valor]));
    assert.deepEqual([det.medidor.tipo, det.medidor.leitura, det.movimentacao.quantidade_kg], ['HORIMETRO', '1550.5000', kgDaTela]);

    // 5) replay: a tela repete o MESMO corpo (mesma chave) → 200 replay, 1 baixa só
    const r4b = await A.confirmar(tok, corpo);
    assert.equal(r4b.statusCode, 200, r4b.body);
    conforme(r4b.json(), 'A4 replay');
    assert.deepEqual([r4b.json().replay, r4b.json().id], [true, det.id]);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, origem_sistema: 'abastecimento_patrimonio' } }), 1);

    // 6) "Consultar" depois de resultado incerto: lista pela chave pendente (C6) e lista do período
    const porChave = await A.ok(A.lista(tok, s.e1.id, `&operation_id=${encodeURIComponent(corpo.operation_id)}`));
    conforme(porChave, 'A1 operation_id');
    assert.deepEqual(porChave.items.map((i) => i.id), [det.id]);
    const lista = await A.ok(A.lista(tok, s.e1.id, '&status=CONFIRMADO&data_de=2027-06-01&data_ate=2027-06-15'));
    conforme(lista, 'A1');

    // 7) A2 e A6
    const det2 = await A.ok(A.detalhe(tok, det.id, s.e1.id));
    conforme(det2, 'A2');
    assert.equal(det2.quantidade_kg, kgDaTela);
    const consumo = await A.ok(A.consumo(tok, s.e1.id, s.trator.id));
    conforme(consumo, 'A6');

    // 8) A5 com o corpo da tela (versão do detalhe aberto) → 200; replay → mesma resposta
    const corpoCancel = { ...montarCorpoCancelamento(s.e1.id, det2, '  lançado no bem errado  '), operation_id: chaveDaTela() };
    assert.deepEqual([corpoCancel.versao, corpoCancel.motivo], [1, 'lançado no bem errado']);
    const r5 = await A.cancelar(tok, det.id, corpoCancel);
    assert.equal(r5.statusCode, 200, r5.body);
    const canc = r5.json();
    conforme(canc, 'A5');
    assert.deepEqual([canc.status, canc.replay, canc.estorno.quantidade_kg, canc.versao], ['CANCELADO', false, kgDaTela, 2]);
    const r5b = await A.cancelar(tok, det.id, corpoCancel);
    assert.equal(r5b.statusCode, 200, r5b.body);
    conforme(r5b.json(), 'A5 replay');
    assert.equal(r5b.json().replay, true);
    conforme(await A.ok(A.detalhe(tok, det.id, s.e1.id)), 'A2 cancelado');
    const lotes = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: s.diesel.id }, orderBy: { data_documento: 'asc' } });
    assert.deepEqual(lotes.map((l) => l.quantidade_disponivel.toFixed(4)), ['50.0000', '100.0000'], 'devolução exata aos lotes de origem');

    // 9) A15 com o corpo do serviço da tela (`encerrarConversao`: {empresa_id, versao}) → 200; A13 TODAS; a prévia volta a bloquear
    const encerrado = await A.ok(A.req('POST', `/patrimonio-conversoes-combustivel/${fator.id}/encerrar`, s.contaFator.token, { empresa_id: s.e1.id, versao: fator.versao }));
    conforme(encerrado, 'A15');
    assert.equal(encerrado.ativo, false);
    conforme(await A.ok(A.req('GET', `/patrimonio-conversoes-combustivel?empresa_id=${s.e1.id}&situacao=TODAS`, tok)), 'A13 TODAS');
    const p9 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, form)));
    assert.deepEqual([p9.bloqueios.map((b) => b.code), p9.plano.conversao], [['ABASTECIMENTO_CONVERSAO_AUSENTE'], null]);
  });

  test('flex (um tanque, gasolina e etanol) e TODOS os vetores L→kg: estimarKg da tela = quantidade_kg do servidor', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.contaCancelar.token;

    // flex: cada combustível só oferece o seu produto; leitura digitada com milhar ("35.300,0")
    const gas = await A.ok(A.opcoes(tok, 'produtos', `empresa_id=${s.e1.id}&tipo_combustivel_id=${s.comb.GASOLINA}`));
    const eta = await A.ok(A.opcoes(tok, 'produtos', `empresa_id=${s.e1.id}&tipo_combustivel_id=${s.comb.ETANOL}`));
    assert.deepEqual([gas.itens.map((p) => p.id), eta.itens.map((p) => p.id)], [[s.gasolina.id], [s.etanol.id]]);
    const { form } = await preencher(s, tok, { bemId: s.caminhonete.id, tipoId: s.comb.ETANOL, produtoId: s.etanol.id, litros: '37,25', leitura: '35.300,0', tanqueCheio: true, data: '2027-06-02' });
    const previa = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, form)));
    conforme(previa, 'A3 flex');
    assert.deepEqual(previa.bloqueios, []);
    const r = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: chaveDaTela() });
    assert.equal(r.statusCode, 201, r.body);
    conforme(r.json(), 'A4 flex');
    assert.deepEqual([r.json().quantidade_kg, r.json().medidor.leitura, r.json().tipo_combustivel.id], ['29.3940', '35300.0000', s.comb.ETANOL]);

    // vetores: bem SEM_MEDIDOR com tanque enorme (a capacidade nunca mascara a recusa de kg) e saldo de sobra
    const grande = await A.ok(A.req('POST', '/bens-patrimoniais', s.token, {
      empresa_id: s.e1.id, nome: 'Grupo gerador de prova', familia_id: s.fam.EQUIPAMENTOS, tipo_id: s.tip.GERADOR, medidor: { tipo: 'SEM_MEDIDOR' },
      tanques: [{ identificador: 'Tanque de prova', capacidade_litros: '9999999999.9999', combustivel_ids: [s.comb.DIESEL_S10] }],
    }), 201);
    await s.lote(s.e1, s.diesel, s.local, { kg: '20000.0000', custo: '5.0000', dia: '2027-06-05' });
    let vigenteId = s.fator.diesel.id;
    let vigenteFator = s.fator.diesel.kg_por_litro;
    for (const v of VETORES.conversao) {
      if (vigenteFator !== v.kg_por_litro) {
        // "Alterar" na tela de fatores: o texto digitado + o vigente lido para o par
        const corpoFator = montarCorpoConversao(s.e1.id, { tipo_combustivel_id: s.comb.DIESEL_S10, produto_id: s.diesel.id, kg_por_litro: digitado(v.kg_por_litro), declara_estoque_em_kg: true }, vigenteId);
        const f = await A.ok(A.req('POST', '/patrimonio-conversoes-combustivel', s.contaFator.token, corpoFator), 201);
        conforme(f, `A14 ${v.kg_por_litro}`);
        [vigenteId, vigenteFator] = [f.id, f.kg_por_litro];
      }
      assert.equal(vigenteFator, v.kg_por_litro);
      const p = await preencher(s, tok, { bemId: grande.id, tipoId: s.comb.DIESEL_S10, produtoId: s.diesel.id, litros: digitado(v.litros) });
      const kgDaTela = estimarKg(canonicoDoDigitado(p.form.quantidade_litros, LIMITES_ABASTECIMENTO.LITROS), p.form.produto.conversao.kg_por_litro);
      assert.equal(kgDaTela, v.kg, `estimarKg ${v.litros} × ${v.kg_por_litro}`);
      const rp = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, p.form)));
      conforme(rp, `A3 ${v.litros} × ${v.kg_por_litro}`);
      if (v.recusa) {
        // a tela não promete número (estimativa null); o plano traz o kg arredondado que o bloqueio B8b recusa (details.quantidade_kg)
        assert.deepEqual(rp.bloqueios.map((b) => [b.code, b.reason, b.details.quantidade_kg]), [['OPERACAO_VALORES_INVALIDOS', v.recusa, rp.plano.quantidade_kg]], `${v.litros} × ${v.kg_por_litro}`);
        // …e a prévia da tela NÃO mostra esse kg como baixa (nem "baixa de 0,0000 kg" ao lado do bloqueio)
        assert.equal(kgDaBaixaNaPrevia(rp), null, `kg da baixa na prévia ${v.litros} × ${v.kg_por_litro}`);
        // mesmo que o corpo da tela chegasse à API (o botão Confirmar não aparece com bloqueio), nada é gravado
        const antes = await fotoAbastecimento(s.c);
        const rc = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, p.form, rp.plano), operation_id: chaveDaTela() });
        assert.deepEqual([rc.statusCode, rc.json().code, rc.json().reason], [422, 'OPERACAO_VALORES_INVALIDOS', v.recusa]);
        assert.equal(await fotoAbastecimento(s.c), antes);
        continue;
      }
      assert.deepEqual([rp.bloqueios, rp.plano.quantidade_kg, kgDaBaixaNaPrevia(rp)], [[], kgDaTela, kgDaTela], `prévia ${v.litros} × ${v.kg_por_litro}`);
      const rc = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, p.form, rp.plano), operation_id: chaveDaTela() });
      assert.equal(rc.statusCode, 201, rc.body);
      conforme(rc.json(), `A4 ${v.litros} × ${v.kg_por_litro}`);
      assert.deepEqual([rc.json().quantidade_kg, rc.json().movimentacao.quantidade_kg, rc.json().medidor.leitura], [kgDaTela, kgDaTela, null]);
    }
  });

  test('bloqueios e erros reais trazem os campos que as mensagens da tela leem (patrimonioErros.js)', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.contaCancelar.token;
    const base = { bemId: s.trator.id, tipoId: s.comb.DIESEL_S10, produtoId: s.diesel.id, tanqueCheio: true };
    const { form } = await preencher(s, tok, { ...base, litros: '80', leitura: '1550,5' });
    /** prévia do formulário com `mudar` aplicado (a tela recusa parte disso localmente; o servidor é a autoridade) */
    const bloqueios = async (mudar) => (await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, { ...form, ...mudar })))).bloqueios;
    const so = (lista, code) => {
      const b = lista.find((x) => x.code === code);
      assert.ok(b, `${code} em ${JSON.stringify(lista)}`);
      return b;
    };
    // "Os litros passam da capacidade nominal do tanque ({capacidade_litros} L)."
    const cap = so(await bloqueios({ quantidade_litros: '180,0001' }), 'ABASTECIMENTO_EXCEDE_CAPACIDADE');
    assert.deepEqual([cap.field, cap.reason, cap.details.capacidade_litros], ['quantidade_litros', 'excede_capacidade_tanque', '180.0000']);
    // "A data é posterior a hoje na fazenda ({hoje})."
    const fut = so(await bloqueios({ data_operacional: '2027-06-16' }), 'ABASTECIMENTO_DATA_FUTURA');
    assert.deepEqual([fut.field, fut.reason, fut.details.hoje], ['data_operacional', 'data_futura', HOJE]);
    // "Saldo insuficiente…: disponível {disponivel} kg, pedido {solicitado} kg."
    const sal = so(await bloqueios({ quantidade_litros: '179' }), 'ESTOQUE_SALDO_INSUFICIENTE');
    assert.deepEqual([sal.reason, sal.details.disponivel, sal.details.solicitado], ['saldo_lote_insuficiente', '150.0000', '150.3600']);
    // "A leitura é menor que a registrada em {data_referencia} ({leitura_referencia})."
    const reg = so(await bloqueios({ medidor_leitura: '1500' }), 'MEDIDOR_LEITURA_REGRESSIVA');
    assert.deepEqual([reg.field, reg.details.data_referencia, reg.details.leitura_referencia], ['medidor_leitura', '2027-06-01', '1520.5000']);
    // "Informe a leitura do medidor." (contador sem leitura; a tela também recusa localmente)
    assert.equal(so(await bloqueios({ medidor_leitura: '' }), 'MEDIDOR_LEITURA_INVALIDA').reason, 'obrigatoria');

    // retroativo acima de um ponto posterior: "…maior que a registrada depois, em {data_posterior} ({leitura_posterior})."
    const previa = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, form)));
    const r = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: chaveDaTela() });
    assert.equal(r.statusCode, 201, r.body);
    const pos = so(await bloqueios({ data_operacional: '2027-06-05', medidor_leitura: '1560', quantidade_litros: '10' }), 'MEDIDOR_LEITURA_ACIMA_POSTERIOR');
    assert.deepEqual([pos.details.data_posterior, pos.details.leitura_posterior], ['2027-06-10', '1550.5000']);

    // erro de comando: `field`/`reason` no topo e `details` com o que a mensagem lê (o mesmo texto do bloqueio)
    const { form: f2 } = await preencher(s, tok, { ...base, litros: '20', leitura: '1560' });
    const p2 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, f2)));
    const corpo = { ...montarCorpoConfirmacao(s.e1.id, { ...f2, quantidade_litros: '180,0001' }, p2.plano), operation_id: chaveDaTela() };
    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(tok, corpo);
    assert.deepEqual([rc.statusCode, rc.json().code, rc.json().field, rc.json().reason, rc.json().details?.capacidade_litros],
      [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade_litros', 'excede_capacidade_tanque', '180.0000']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    // consumo CALCULADO (dois tanques cheios): detalhe e A6 na forma que o painel de consumo lê
    const { form: f3 } = await preencher(s, tok, { ...base, litros: '50', leitura: '1.560,5', data: '2027-06-12' });
    const p3 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, f3)));
    const r3 = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, f3, p3.plano), operation_id: chaveDaTela() });
    assert.equal(r3.statusCode, 201, r3.body);
    conforme(r3.json(), 'A4 consumo');
    assert.deepEqual([r3.json().consumo.situacao, r3.json().consumo.metrica, r3.json().consumo.valor, r3.json().consumo.intervalo, r3.json().consumo.litros],
      ['CALCULADO', 'LITROS_POR_HORA', '5.0000', '10.0000', '50.0000']);
    const consumo = await A.ok(A.consumo(tok, s.e1.id, s.trator.id));
    conforme(consumo, 'A6 calculado');
    assert.deepEqual(consumo.intervalos.map((i) => [i.situacao, i.valor]).sort(), [['CALCULADO', '5.0000'], ['DADOS_INSUFICIENTES', null]]);
  });
});
