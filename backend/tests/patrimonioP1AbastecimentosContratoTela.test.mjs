/**
 * D-PROD-159, revisto pela D-PROD-162 — Patrimônio P1-02: INTEGRAÇÃO TELA × API
 * (INT-1).
 *
 * Importa o módulo PURO da tela (`src/lib/abastecimentoRegras.js`, só imports
 * relativos) e manda à API REAL (Fastify `app.inject` + PostgreSQL local) os
 * corpos que a TELA monta a partir do formulário como o usuário o preenche:
 * texto pt-BR com vírgula decimal ("80,0", "1550,5"), as OPÇÕES do próprio
 * servidor (A7 bens, A16 produtos do bem — os Produtos aceitos pelos tanques,
 * aplicados ao formulário pelo helper real `opcaoNoFormulario` —, A12 locais)
 * e a chave `lanc-<uuid>` do serviço. Percorre A3 → A4 → replay → A1
 * (`operation_id`) → A2 → A6 → A5 → replay do A5, em LITROS e em QUILOS, e
 * exige em TODA resposta `conferirRespostaAbastecimento(body) = []` (a forma
 * que a tela lê). D-PROD-162: a quantidade que a tela mostra como baixa
 * (`quantidadeDaBaixaNaPrevia`) é EXATAMENTE a do servidor, na unidade do
 * Produto, sem conversão; a capacidade só vale para Produto em L. Os
 * bloqueios/erros reais têm de trazer os `details` que as mensagens da tela
 * (`patrimonioErros.js`) leem; o consumo CALCULADO tem a forma do painel.
 *
 * Contrato da tela (F5c, D-PROD-162 §5.4): o formulário guarda a quantidade em
 * `quantidade` (texto digitado) e `montarCorpoPrevia`/`montarCorpoConfirmacao`
 * mandam `quantidade` sem `tipo_combustivel_id`/`conversao_*`.
 *
 * Se este arquivo falhar, a tela e a API divergem: corrija o lado errado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoPrevia as corpoPreviaDoCenario, fotoAbastecimento, montarAbastecimento, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { FUSO, HOJE } from './patrimonioP1Cenario.mjs';
import {
  assinaturaDoFormulario,
  conferirRespostaAbastecimento,
  formularioVazio,
  montarCorpoCancelamento,
  montarCorpoConfirmacao,
  montarCorpoPrevia,
  opcaoNoFormulario,
  produtoAutomatico,
  quantidadeDaBaixaNaPrevia,
  situacaoDaEscolha,
  tanqueDoFormulario,
  validarFormulario,
} from '../../src/lib/abastecimentoRegras.js';
import { hojeNoFuso } from '../../src/lib/diaCivil.js';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/abastecimentoVetores.json', import.meta.url), 'utf8'));

/** Chave como o serviço da tela gera (`operacaoFinanceiraService.novaChave`). */
const chaveDaTela = () => `lanc-${randomUUID()}`;

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

/** A resposta tem de estar na forma que a tela lê. */
const conforme = (body, onde) => assert.deepEqual(conferirRespostaAbastecimento(body), [], `${onde}: ${JSON.stringify(conferirRespostaAbastecimento(body))}`);

/**
 * Preenche o formulário COMO A TELA: bem → PRODUTO (A16: os Produtos aceitos
 * pelos tanques ativos do bem, cada um com os seus tanques) → local, sempre a
 * partir das opções do servidor. O mapeamento opção → formulário é o HELPER
 * REAL da tela (`opcaoNoFormulario`), a auto-escolha é `produtoAutomatico` e a
 * capacidade que a validação local usa vem de `tanqueDoFormulario`.
 * `unico: true`: a resposta tem de ser completa com 1 opção (a tela
 * auto-seleciona); senão nada é auto-escolhido e o item é escolhido pelo `produto.id`.
 * @param {any} s @param {string} tok
 * @param {{ bemId: string, produtoId: string, quantidade: string, leitura?: string, tanqueCheio?: boolean, data?: string, unico?: boolean }} p
 */
const preencher = async (s, tok, p) => {
  const bens = await A.ok(A.opcoes(tok, 'bens', `empresa_id=${s.e1.id}`));
  const bem = bens.itens.find((b) => b.id === p.bemId);
  assert.ok(bem, 'o bem aparece no seletor do formulário');
  const opcoes = await A.ok(A.produtosDoBem(tok, s.e1.id, bem.id));
  assert.equal(opcoes.bem.id, bem.id, 'a resposta é do bem do formulário');
  const automatico = produtoAutomatico(opcoes, bem.id);
  let item;
  if (p.unico === true) {
    assert.deepEqual([opcoes.itens.length, opcoes.has_more], [1, false], 'resposta completa com 1 Produto → a tela auto-seleciona');
    assert.ok(automatico, 'a tela escolhe sozinha o Produto único');
    item = automatico;
  } else {
    assert.equal(automatico, null, 'mais de uma opção → a tela NÃO escolhe sozinha (o operador escolhe)');
    item = opcoes.itens.find((x) => x.produto.id === p.produtoId);
  }
  assert.ok(item, 'o Produto aparece entre os do bem');
  assert.equal(item.produto.id, p.produtoId, 'o Produto escolhido é o esperado');
  for (const campo of ['tipo_combustivel', 'conversao', 'bloqueios']) assert.equal(Object.prototype.hasOwnProperty.call(item, campo), false, `a opção não traz ${campo} (D-PROD-162)`);
  assert.equal(item.tanques.length, 1, 'um tanque aceita o Produto → a tela não pergunta o tanque');
  const hoje = hojeNoFuso(FUSO, new Date(String(process.env.MAIKE_TESTE_AGORA)));
  assert.equal(hoje, HOJE);
  const comProduto = opcaoNoFormulario({ ...formularioVazio(hoje), bem }, item);
  assert.equal(comProduto.local_estoque_id, null, 'Produto novo no formulário → o local é escolhido depois dele');
  const tanque = tanqueDoFormulario(comProduto);
  assert.deepEqual(tanque, item.tanques[0], 'o tanque do formulário é o único da opção do servidor');
  const locais = await A.ok(A.opcoes(tok, 'locais', `empresa_id=${s.e1.id}&produto_id=${comProduto.produto.id}`));
  assert.equal(locais.itens.length, 1, 'um local com saldo → a tela auto-seleciona');
  assert.equal(locais.itens[0].unidade, item.produto.unidade_principal_estoque, 'o saldo do local vem na unidade do Produto');
  const form = {
    ...comProduto,
    local_estoque_id: String(locais.itens[0].local_estoque_id),
    data_operacional: p.data ?? '2027-06-10',
    quantidade: p.quantidade,
    medidor_leitura: p.leitura ?? '',
    tanque_cheio: p.tanqueCheio === true,
  };
  assert.equal(situacaoDaEscolha(opcoes, form), 'presente', 'a escolha segue entre as opções do servidor (a tela não a limpa)');
  const ctx = { hoje, capacidadeLitros: tanqueDoFormulario(form)?.capacidade_litros ?? null, unidade: item.produto.unidade_principal_estoque };
  assert.deepEqual(validarFormulario(form, ctx).erros, {}, 'formulário válido para a tela');
  const corpo = montarCorpoPrevia(s.e1.id, form);
  assert.deepEqual([corpo.bem_id, corpo.tanque_id, corpo.produto_id], [p.bemId, tanque.id, p.produtoId], 'ids do corpo = os da opção do servidor');
  for (const campo of ['tipo_combustivel_id', 'quantidade_litros', 'conversao_id', 'conversao_versao']) {
    assert.equal(Object.prototype.hasOwnProperty.call(corpo, campo), false, `o corpo da tela não manda ${campo} (o servidor recusaria com 400)`);
  }
  return { form, tanque, produto: form.produto, hoje };
};

describe('INT-1 — corpos da tela na API real (L, KG e flex)', () => {
  test('TP-02 diesel em L: A3 → A4 → replay → A1 → A2 → A6 → A5 → replay; a baixa mostrada = a do servidor; respostas na forma da tela', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.contaCancelar.token;

    const { form, tanque } = await preencher(s, tok, { bemId: s.trator.id, produtoId: s.diesel.id, quantidade: '80,0', leitura: '1550,5', tanqueCheio: true });
    const corpoPrevia = montarCorpoPrevia(s.e1.id, form);
    assert.deepEqual([corpoPrevia.quantidade, corpoPrevia.medidor_leitura], ['80', '1550.5']);
    assert.deepEqual(Object.keys(corpoPrevia).sort(), Object.keys(corpoPreviaDoCenario(s)).sort(), 'o corpo da tela tem as mesmas chaves do contrato da API');
    const antesPrevia = await fotoAbastecimento(s.c);
    const previa = await A.ok(A.previa(tok, corpoPrevia));
    assert.equal(await fotoAbastecimento(s.c), antesPrevia, 'prévia não grava nada');
    conforme(previa, 'A3');
    assert.deepEqual(previa.bloqueios, []);
    assert.deepEqual([quantidadeDaBaixaNaPrevia(previa), previa.plano.quantidade, previa.plano.unidade, previa.plano.hoje], ['80.0000', '80.0000', 'L', HOJE]);
    assert.deepEqual([previa.plano.tanque.capacidade_litros, tanque.capacidade_litros], ['180.0000', '180.0000']);
    const assinatura = assinaturaDoFormulario(form);

    // A4 com o corpo da tela (+ chave do serviço) → 201
    const corpo = { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: chaveDaTela() };
    assert.equal(assinaturaDoFormulario(form), assinatura, 'montar o corpo não muda o formulário');
    const r4 = await A.confirmar(tok, corpo);
    assert.equal(r4.statusCode, 201, r4.body);
    const det = r4.json();
    conforme(det, 'A4');
    assert.deepEqual([det.replay, det.status, det.quantidade, det.unidade, det.custo_total, det.custo_unitario],
      [false, 'CONFIRMADO', VETORES.fifo.quantidade, VETORES.fifo.unidade, VETORES.fifo.custo_total, VETORES.fifo.custo_unitario]);
    assert.deepEqual(det.fatias.map((f) => [f.quantidade, f.custo_unitario, f.valor]), VETORES.fifo.fatias.map((f) => [f.quantidade, f.custo_unitario, f.valor]));
    assert.deepEqual([det.medidor.tipo, det.medidor.leitura, det.movimentacao.quantidade], ['HORIMETRO', '1550.5000', '80.0000']);

    // replay: a tela repete o MESMO corpo (mesma chave) → 200 replay, 1 baixa só
    const r4b = await A.confirmar(tok, corpo);
    assert.equal(r4b.statusCode, 200, r4b.body);
    conforme(r4b.json(), 'A4 replay');
    assert.deepEqual([r4b.json().replay, r4b.json().id], [true, det.id]);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, origem_sistema: 'abastecimento_patrimonio' } }), 1);

    // "Consultar" depois de resultado incerto: lista pela chave pendente (C6) e lista do período
    const porChave = await A.ok(A.lista(tok, s.e1.id, `&operation_id=${encodeURIComponent(corpo.operation_id)}`));
    conforme(porChave, 'A1 operation_id');
    assert.deepEqual(porChave.items.map((i) => i.id), [det.id]);
    conforme(await A.ok(A.lista(tok, s.e1.id, '&status=CONFIRMADO&data_de=2027-06-01&data_ate=2027-06-15')), 'A1');

    // A2 e A6
    const det2 = await A.ok(A.detalhe(tok, det.id, s.e1.id));
    conforme(det2, 'A2');
    assert.deepEqual([det2.quantidade, det2.unidade], ['80.0000', 'L']);
    conforme(await A.ok(A.consumo(tok, s.e1.id, s.trator.id)), 'A6');

    // A5 com o corpo da tela (versão do detalhe aberto) → 200; replay → mesma resposta
    const corpoCancel = { ...montarCorpoCancelamento(s.e1.id, det2, '  lançado no bem errado  '), operation_id: chaveDaTela() };
    assert.deepEqual([corpoCancel.versao, corpoCancel.motivo], [1, 'lançado no bem errado']);
    const r5 = await A.cancelar(tok, det.id, corpoCancel);
    assert.equal(r5.statusCode, 200, r5.body);
    const canc = r5.json();
    conforme(canc, 'A5');
    assert.deepEqual([canc.status, canc.replay, canc.estorno.quantidade, canc.versao], ['CANCELADO', false, '80.0000', 2]);
    const r5b = await A.cancelar(tok, det.id, corpoCancel);
    assert.equal(r5b.statusCode, 200, r5b.body);
    conforme(r5b.json(), 'A5 replay');
    assert.equal(r5b.json().replay, true);
    conforme(await A.ok(A.detalhe(tok, det.id, s.e1.id)), 'A2 cancelado');
    const lotes = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: s.diesel.id }, orderBy: { data_documento: 'asc' } });
    assert.deepEqual(lotes.map((l) => l.quantidade_disponivel.toFixed(4)), ['50.0000', '100.0000'], 'devolução exata aos lotes de origem');
  });

  test('Produto em KG no tanque de 180 L (250 kg passa: a capacidade é só para L) e flex (gasolina e etanol no mesmo tanque); a baixa mostrada = a do servidor', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.contaCancelar.token;
    // KG: o número digitado é a baixa em kg; a tela não compara com a capacidade em litros
    const kg = await preencher(s, tok, { bemId: s.trator.id, produtoId: s.dieselKg.id, quantidade: '250', leitura: '1550,5' });
    assert.equal(kg.produto.unidade_principal_estoque, 'KG');
    const pk = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, kg.form)));
    conforme(pk, 'A3 KG');
    assert.deepEqual([pk.bloqueios, quantidadeDaBaixaNaPrevia(pk), pk.plano.unidade, pk.plano.confere_capacidade], [[], '250.0000', 'KG', false]);
    const rk = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, kg.form, pk.plano), operation_id: chaveDaTela() });
    assert.equal(rk.statusCode, 201, rk.body);
    conforme(rk.json(), 'A4 KG');
    assert.deepEqual([rk.json().quantidade, rk.json().unidade, rk.json().movimentacao.quantidade, rk.json().fatias.map((f) => f.quantidade)], ['250.0000', 'KG', '250.0000', ['250.0000']]);

    // flex: o operador escolhe o etanol; leitura digitada com milhar ("35.300,0")
    const { form } = await preencher(s, tok, { bemId: s.caminhonete.id, produtoId: s.etanol.id, quantidade: '37,25', leitura: '35.300,0', tanqueCheio: true, data: '2027-06-02' });
    const previa = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, form)));
    conforme(previa, 'A3 flex');
    assert.deepEqual([previa.bloqueios, quantidadeDaBaixaNaPrevia(previa)], [[], '37.2500']);
    const r = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: chaveDaTela() });
    assert.equal(r.statusCode, 201, r.body);
    conforme(r.json(), 'A4 flex');
    assert.deepEqual([r.json().quantidade, r.json().unidade, r.json().medidor.leitura, r.json().produto.id], ['37.2500', 'L', '35300.0000', s.etanol.id]);
  });

  test('bloqueios e erros reais trazem os campos que as mensagens da tela leem (patrimonioErros.js)', async () => {
    const s = await montarAbastecimento(app);
    const tok = s.contaCancelar.token;
    const base = { bemId: s.trator.id, produtoId: s.diesel.id, tanqueCheio: true };
    const { form } = await preencher(s, tok, { ...base, quantidade: '80', leitura: '1550,5' });
    /** prévia do formulário com `mudar` aplicado (a tela recusa parte disso localmente; o servidor é a autoridade) */
    const bloqueios = async (mudar, corpoExtra = {}) => (await A.ok(A.previa(tok, { ...montarCorpoPrevia(s.e1.id, { ...form, ...mudar }), ...corpoExtra }))).bloqueios;
    const so = (lista, code) => {
      const b = lista.find((x) => x.code === code);
      assert.ok(b, `${code} em ${JSON.stringify(lista)}`);
      return b;
    };
    // "A quantidade em litros passa da capacidade do tanque ({capacidade_litros} L)."
    const cap = so(await bloqueios({ quantidade: '180,0001' }), 'ABASTECIMENTO_EXCEDE_CAPACIDADE');
    assert.deepEqual([cap.field, cap.reason, cap.details.capacidade_litros], ['quantidade', 'excede_capacidade_tanque', '180.0000']);
    // "A data é posterior a hoje na fazenda ({hoje})."
    const fut = so(await bloqueios({ data_operacional: '2027-06-16' }), 'ABASTECIMENTO_DATA_FUTURA');
    assert.deepEqual([fut.field, fut.reason, fut.details.hoje], ['data_operacional', 'data_futura', HOJE]);
    // "Saldo insuficiente…: disponível {disponivel} {unidade}, pedido {solicitado} {unidade}."
    const sal = so(await bloqueios({ quantidade: '151' }), 'ESTOQUE_SALDO_INSUFICIENTE');
    assert.deepEqual([sal.reason, sal.details.disponivel, sal.details.solicitado, sal.details.unidade], ['saldo_lote_insuficiente', '150.0000', '151.0000', 'L']);
    // "A leitura é menor que a registrada em {data_referencia} ({leitura_referencia})."
    const reg = so(await bloqueios({ medidor_leitura: '1500' }), 'MEDIDOR_LEITURA_REGRESSIVA');
    assert.deepEqual([reg.field, reg.details.data_referencia, reg.details.leitura_referencia], ['medidor_leitura', '2027-06-01', '1520.5000']);
    // "Informe a leitura do medidor." (contador sem leitura; a tela também recusa localmente)
    assert.equal(so(await bloqueios({ medidor_leitura: '' }), 'MEDIDOR_LEITURA_INVALIDA').reason, 'obrigatoria');
    // "O tanque escolhido não aceita este Produto…" (o Produto mudou entre a abertura e a prévia)
    const naoAceito = so(await bloqueios({}, { produto_id: s.arla.id }), 'ABASTECIMENTO_PRODUTO_NAO_ACEITO');
    assert.deepEqual([naoAceito.field, naoAceito.reason], ['produto_id', 'nao_aceito_pelo_tanque']);
    // "O Produto não está em L, KG nem SACO ({unidade})." — D-PROD-163: SACO abastece (em kg); só unidade legada fora delas recusa.
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'UN' WHERE id = ${s.emSaco.id}`;
    const unidade = so(await bloqueios({}, { produto_id: s.emSaco.id }), 'ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL');
    assert.deepEqual([unidade.field, unidade.reason, unidade.details.unidade], ['produto_id', 'unidade_nao_aceita', 'UN']);

    // retroativo acima de um ponto posterior: "…maior que a registrada depois, em {data_posterior} ({leitura_posterior})."
    const previa = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, form)));
    const r = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, form, previa.plano), operation_id: chaveDaTela() });
    assert.equal(r.statusCode, 201, r.body);
    const pos = so(await bloqueios({ data_operacional: '2027-06-05', medidor_leitura: '1560', quantidade: '10' }), 'MEDIDOR_LEITURA_ACIMA_POSTERIOR');
    assert.deepEqual([pos.details.data_posterior, pos.details.leitura_posterior], ['2027-06-10', '1550.5000']);

    // erro de comando: `field`/`reason` no topo e `details` com o que a mensagem lê (o mesmo texto do bloqueio)
    const { form: f2 } = await preencher(s, tok, { ...base, quantidade: '20', leitura: '1560' });
    const p2 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, f2)));
    const corpo = { ...montarCorpoConfirmacao(s.e1.id, { ...f2, quantidade: '180,0001' }, p2.plano), operation_id: chaveDaTela() };
    const antes = await fotoAbastecimento(s.c);
    const rc = await A.confirmar(tok, corpo);
    assert.deepEqual([rc.statusCode, rc.json().code, rc.json().field, rc.json().reason, rc.json().details?.capacidade_litros],
      [422, 'ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque', '180.0000']);
    assert.equal(await fotoAbastecimento(s.c), antes);

    // consumo CALCULADO (dois tanques cheios): detalhe e A6 na forma que o painel de consumo lê
    const { form: f3 } = await preencher(s, tok, { ...base, quantidade: '50', leitura: '1.560,5', data: '2027-06-12' });
    const p3 = await A.ok(A.previa(tok, montarCorpoPrevia(s.e1.id, f3)));
    const r3 = await A.confirmar(tok, { ...montarCorpoConfirmacao(s.e1.id, f3, p3.plano), operation_id: chaveDaTela() });
    assert.equal(r3.statusCode, 201, r3.body);
    conforme(r3.json(), 'A4 consumo');
    const c = r3.json().consumo;
    assert.deepEqual([c.situacao, c.metrica, c.unidade_metrica, c.valor, c.intervalo, c.quantidade, c.unidade], ['CALCULADO', 'LITROS_POR_HORA', 'L/h', '5.0000', '10.0000', '50.0000', 'L']);
    const consumo = await A.ok(A.consumo(tok, s.e1.id, s.trator.id));
    conforme(consumo, 'A6 calculado');
    assert.deepEqual(consumo.intervalos.map((i) => [i.situacao, i.valor, i.unidade_metrica]).sort(), [['CALCULADO', '5.0000', 'L/h'], ['DADOS_INSUFICIENTES', null, 'L/h']]);
  });
});
