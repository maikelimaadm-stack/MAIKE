/**
 * D-PROD-156 — Gestão P3-02: rateio gerencial POR ITEM na Central Única de
 * Lançamentos. PostgreSQL real, HTTP autenticado, prova pelas linhas gravadas.
 *
 * No COM_PRODUTOS, `rateio_escopo: 'POR_ITEM'` dá a cada item (MERCADORIA ou
 * SERVICO) as SUAS linhas de natureza + centros, sobre o `valor_liquido` do
 * item (subtotal − desconto rateado + acréscimo rateado), por VALOR ou
 * PERCENTUAL (maiores restos, os mesmos do rateio geral). GERAL (padrão; NULL
 * no banco) continua idêntico à P3-01. Os modos são exclusivos.
 *
 * Vetores compartilhados com a tela: tests/smoke/fixtures/rateioPorItemVetores.json.
 *
 *  RI0. plano puro: vetores; maiores restos comuns = algoritmo da P3-01 no geral;
 *  RI1. vetores no PostgreSQL (rascunho, detalhe, prévia, confirmação; BRL/PYG/KWD);
 *  RI2. fluxos: compra 3 itens × 3 naturezas, 1 item em 2 centros, mercadoria +
 *       serviço, desconto e acréscimo, parcelado → 1 título por parcela e 1
 *       movimento por item físico, sem custo duplicado; venda; à vista; listagem;
 *  RI3. escopo inválido, exclusões e recusas da linha com item e linha exatos;
 *  RI4. referências: inativa, outra empresa, outro tenant, tipo × direção,
 *       sintética; prévia e confirmação; retrato dos nomes;
 *  RI5. rascunho: alterar, remover e reordenar itens; trocar de escopo; trocar
 *       a direção; descartar;
 *  RI6. idempotência (replay); RI7. documento duplicado; RI8. cancelamento e
 *       imutabilidade; RI9. documento antigo (`rateio_escopo` NULL) = GERAL;
 *  RI10. o banco é a última rede (documento adulterado, CHECK/FK/RLS);
 *  RI11. concorrência focada (PUT × PUT, PUT × confirmar, confirmar × PUT);
 *  RI12. volume: 1000 linhas por item no documento.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docSem, foto, loteLegado, montarTenant, motivo, opId, prisma } from './gestaoP3Cenario.mjs';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/rateioPorItemVetores.json', import.meta.url), 'utf8'));
/** Plano carregado na hora (no RED as exportações novas ainda não existem: falha o teste, não o arquivo). */
const plano = () => import('../src/modules/financeiro/operacaoFinanceiraPlano.js');
const decimais = () => import('../src/modules/financeiro/decimalFinanceiro.js');

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** Cliente do TESTE (pool próprio) para portões e observação de travas. @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

// ─── apoio ──────────────────────────────────────────────────────────────────
const D = (v) => new Prisma.Decimal(v);
const MEIO = Prisma.Decimal.ROUND_HALF_UP;
const pct = (valor, base) => D(valor).times(100).dividedBy(D(base)).toDecimalPlaces(6, MEIO).toFixed(6);

const post = (s, doc, chave = opId()) => A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: chave });
const put = (s, d, doc) => A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...doc, versao: d.versao });
const recusa = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  assert.equal(codigo(r), code, r.body);
  if (reason !== undefined) assert.equal(motivo(r), reason, r.body);
  return r.json();
};
/** A recusa aponta o item `indice` e (se dada) a linha `subindice` do rateio dele. */
const naPosicao = (corpo, indice, subindice) => {
  assert.equal(corpo.details.colecao, 'itens', JSON.stringify(corpo));
  assert.equal(corpo.details.indice, indice, JSON.stringify(corpo));
  assert.equal(corpo.details.subcolecao, 'rateios', JSON.stringify(corpo));
  if (subindice === undefined) assert.equal('subindice' in corpo.details, false, JSON.stringify(corpo));
  else assert.equal(corpo.details.subindice, subindice, JSON.stringify(corpo));
};

/** Linha do rateio de um item. */
const linha = (natureza, x = {}) => ({ natureza_id: natureza.id, ...x });
const servico = (valor_unitario, rateios, extra = {}) => ({ tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario, descricao: 'SERVICO DE TESTE', rateios, ...extra });
const mercadoria = (s, produto, quantidade, valor_unitario, rateios, extra = {}) => ({
  tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: s.local.id, unidade: 'KG', quantidade, valor_unitario, rateios, ...extra,
});

/** Σ HALF_UP(quantidade × valor unitário) − desconto + acréscimo, na escala `casas`. */
const totalDe = (itens, { valor_desconto, valor_acrescimo } = {}, casas = 2) =>
  itens
    .reduce((t, i) => t.plus(D(i.quantidade).times(D(i.valor_unitario)).toDecimalPlaces(casas, MEIO)), D(0))
    .minus(D(valor_desconto ?? '0'))
    .plus(D(valor_acrescimo ?? '0'))
    .toFixed(casas);

/** COM_PRODUTOS POR_ITEM (PRAZO, 1 parcela com o total; VALOR salvo indicação). */
const docItens = (e, itens, extra = {}) => {
  const direcao = extra.direcao ?? 'PAGAR';
  const casas = extra.casas ?? 2;
  const resto = { ...extra };
  delete resto.casas;
  const temMercadoria = itens.some((i) => i.tipo_item === 'MERCADORIA');
  return {
    empresa_id: e.id,
    direcao,
    conteudo: 'COM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: (direcao === 'PAGAR' ? e.forn : e.cli).id,
    data_emissao: '2027-06-10',
    ...(temMercadoria ? { data_operacional: '2027-06-10', efeito_fisico_confirmado: true } : {}),
    itens,
    rateio_modo: 'VALOR',
    rateio_escopo: 'POR_ITEM',
    rateios: [],
    parcelas: [{ vencimento: '2027-07-10', valor: totalDe(itens, extra, casas) }],
    ...resto,
  };
};

/** Linhas por item gravadas, item a item (ordem do item, depois da linha). */
const linhasGravadas = async (operacaoId) => {
  const itens = await prisma().operacaoFinanceiraItem.findMany({ where: { operacao_id: operacaoId }, orderBy: { ordem: 'asc' }, include: { rateios: { orderBy: { ordem: 'asc' } } } });
  return itens.map((i) => i.rateios.map((r) => [r.natureza_id, r.centro_custo_id, r.centro_resultado_id, r.valor.toFixed(4), r.percentual?.toFixed(6) ?? null]));
};
/** Toda linha por item do documento pertence a um item DESTE documento, da mesma empresa e direção. */
const linhasCoerentes = async (operacaoId) => {
  const p = prisma();
  const op = await p.operacaoFinanceira.findUnique({ where: { id: operacaoId } });
  const itens = new Set((await p.operacaoFinanceiraItem.findMany({ where: { operacao_id: operacaoId }, select: { id: true } })).map((i) => i.id));
  const linhas = await p.operacaoFinanceiraItemRateio.findMany({ where: { operacao_id: operacaoId } });
  for (const l of linhas) {
    assert.ok(itens.has(l.item_id), `linha ${l.id} aponta item fora do documento`);
    assert.deepEqual([l.empresa_id, l.operacao_direcao, l.cliente_id], [op.empresa_id, op.direcao, op.cliente_id]);
  }
  const orfas = await p.operacaoFinanceiraItemRateio.count({ where: { cliente_id: op.cliente_id, item_id: { notIn: [...itens] }, operacao_id: operacaoId } });
  assert.equal(orfas, 0);
  return linhas.length;
};
const valoresDoDetalhe = (d) => d.itens.map((i) => i.rateios.map((r) => r.valor));
const somaDe = (lista, casas = 2) => lista.reduce((t, v) => t.plus(D(v)), D(0)).toFixed(casas);
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });

const tenants = new Map();
/** Tenant por moeda, reaproveitado entre vetores. */
const tenantDe = async (perfil) => {
  const chave = `${perfil.pais}|${perfil.moeda}`;
  if (!tenants.has(chave)) tenants.set(chave, await montarTenant(app, { perfil }));
  return tenants.get(chave);
};

// ─── vetores ────────────────────────────────────────────────────────────────
/** Corpo HTTP de um vetor (N1..N3 → naturezas; C1/C2 → centros de custo; R1 → centro de resultado). */
const corpoDoVetor = (s, e, caso) => {
  const nat = { N1: e.desp.id, N2: e.desp2.id, N3: e.desp3.id };
  const cc = { C1: e.cc.id, C2: e.cc2.id };
  const cr = { R1: e.cr.id };
  const produtos = [e.sal, e.milho];
  let k = 0;
  const itens = caso.itens.map((it) => {
    const rateios = it.rateios.map((r) => ({
      natureza_id: nat[r.natureza],
      centro_custo_id: r.centro_custo ? cc[r.centro_custo] : null,
      centro_resultado_id: r.centro_resultado ? cr[r.centro_resultado] : null,
      ...(caso.rateio_modo === 'VALOR' ? { valor: r.valor } : { percentual: r.percentual }),
    }));
    if (it.tipo_item === 'SERVICO') return servico(it.subtotal, rateios, { descricao: 'SERVICO DO VETOR' });
    const produto = produtos[k % produtos.length];
    k += 1;
    return mercadoria(s, produto, '1', it.subtotal, rateios);
  });
  return docItens(e, itens, {
    casas: caso.casas,
    rateio_modo: caso.rateio_modo,
    ...(caso.valor_desconto ? { valor_desconto: caso.valor_desconto } : {}),
    ...(caso.valor_acrescimo ? { valor_acrescimo: caso.valor_acrescimo } : {}),
  });
};
const rotulos = (e) => ({
  [e.desp.id]: 'N1', [e.desp2.id]: 'N2', [e.desp3.id]: 'N3', [e.cc.id]: 'C1', [e.cc2.id]: 'C2', [e.cr.id]: 'R1',
});
const consolidadoEmRotulos = (e, lista) => {
  const r = rotulos(e);
  return lista.map((g) => ({
    natureza: r[g.natureza_id], centro_custo: g.centro_custo_id ? r[g.centro_custo_id] : null, centro_resultado: g.centro_resultado_id ? r[g.centro_resultado_id] : null,
    valor: g.valor, percentual: g.percentual,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
describe('RI0 — plano puro (sem banco)', () => {
  test(`vetores: o plano do backend produz exatamente rateioPorItemVetores.json (${VETORES.casos.length} casos, 0/2/3 casas, VALOR e PERCENTUAL, empates, desconto + acréscimo, erros)`, async () => {
    const { normalizarDocumento, planejarOperacao } = await plano();
    assert.ok(VETORES.casos.length >= 12);
    const ids = { N1: 'n1', N2: 'n2', N3: 'n3', C1: 'c1', C2: 'c2', R1: 'r1' };
    const volta = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    for (const caso of VETORES.casos) {
      const casas = caso.casas;
      const itens = caso.itens.map((it) => ({
        tipo_item: it.tipo_item, unidade: it.tipo_item === 'MERCADORIA' ? 'KG' : 'UN', quantidade: '1', valor_unitario: it.subtotal,
        ...(it.tipo_item === 'MERCADORIA' ? { produto_id: 'prod', local_estoque_id: 'loc' } : { descricao: 'SERVICO' }),
        rateios: it.rateios.map((r) => ({
          natureza_id: ids[r.natureza], centro_custo_id: r.centro_custo ? ids[r.centro_custo] : null, centro_resultado_id: r.centro_resultado ? ids[r.centro_resultado] : null,
          ...(caso.rateio_modo === 'VALOR' ? { valor: r.valor } : { percentual: r.percentual }),
        })),
      }));
      const corpo = docItens({ id: 'e', forn: { id: 'p' }, cli: { id: 'p' } }, itens, {
        casas, rateio_modo: caso.rateio_modo, ...(caso.valor_desconto ? { valor_desconto: caso.valor_desconto } : {}), ...(caso.valor_acrescimo ? { valor_acrescimo: caso.valor_acrescimo } : {}),
      });
      const executar = () => planejarOperacao(normalizarDocumento(corpo, casas), { casas, moeda: caso.perfil.moeda, produtos: new Map() });
      if (caso.esperado.erro) {
        assert.throws(executar, (erro) => {
          const { field, reason, ...det } = /** @type {any} */ (erro).details;
          assert.deepEqual([/** @type {any} */ (erro).code, field, reason, det], [caso.esperado.erro.code, caso.esperado.erro.field, caso.esperado.erro.reason, caso.esperado.erro.details], caso.id);
          return true;
        }, caso.id);
        continue;
      }
      const p = executar();
      assert.equal(p.rateio_escopo, 'POR_ITEM', caso.id);
      assert.deepEqual(p.rateios, [], caso.id);
      const obtido = {
        valor_total: p.valor_total.toFixed(casas),
        itens: p.itens.map((i) => ({
          valor_desconto_rateado: i.valor_desconto_rateado.toFixed(casas), valor_acrescimo_rateado: i.valor_acrescimo_rateado.toFixed(casas), valor_liquido: i.valor_liquido.toFixed(casas),
          rateios: i.rateios.map((r) => ({ valor: r.valor.toFixed(casas), percentual: (r.percentual ?? D(r.valor.toString()).times(100).dividedBy(D(i.valor_liquido.toString())).toDecimalPlaces(6, MEIO)).toFixed(6) })),
        })),
        rateio_consolidado: p.rateio_consolidado.map((g) => ({
          natureza: volta[g.natureza_id], centro_custo: g.centro_custo_id ? volta[g.centro_custo_id] : null, centro_resultado: g.centro_resultado_id ? volta[g.centro_resultado_id] : null,
          valor: g.valor.toFixed(casas), percentual: g.percentual.toFixed(6),
        })),
      };
      assert.deepEqual(obtido, caso.esperado, caso.id);
      // invariantes: Σ linhas do item = líquido; Σ consolidado = total
      for (const i of obtido.itens) assert.equal(somaDe(i.rateios.map((r) => r.valor), casas), i.valor_liquido, caso.id);
      assert.equal(somaDe(obtido.rateio_consolidado.map((g) => g.valor), casas), obtido.valor_total, caso.id);
    }
  });

  test('maiores restos COMUNS: o rateio PERCENTUAL geral dá exatamente o resultado do algoritmo da P3-01 (6000 casos determinísticos, 0/2/3 casas, percentuais de 0 a 6 casas, empates)', async () => {
    const { distribuirPercentuais } = await plano();
    const { CEM, piso, somar, unidadeMinima, dec } = await decimais();
    /** O algoritmo da P3-01 (operacaoFinanceiraPlano.js na main f2b81e1b), copiado como referência. */
    const referencia = (total, percentuais, casas) => {
      const u = unidadeMinima(casas);
      const exatos = percentuais.map((p) => total.times(p).dividedBy(CEM));
      const valores = exatos.map((x) => piso(x, casas));
      const restos = exatos.map((x, i) => x.minus(valores[i]));
      const faltam = total.minus(somar(valores)).dividedBy(u).toNumber();
      const ordem = percentuais.map((_, i) => i).sort((a, b) => (restos[b].cmp(restos[a]) || a - b));
      for (let k = 0; k < faltam; k += 1) valores[ordem[k]] = valores[ordem[k]].plus(u);
      return valores;
    };
    let semente = 156n;
    const proximo = (n) => {
      semente = (semente * 6364136223846793005n + 1442695040888963407n) % 18446744073709551616n;
      return Number((semente >> 33n) % BigInt(n));
    };
    for (let k = 0; k < 6000; k += 1) {
      const casas = [0, 2, 3][proximo(3)];
      const escalaP = proximo(7); // casas do percentual
      const n = 1 + proximo(7);
      const unidades = 10n ** BigInt(escalaP);
      const alvo = 100n * unidades;
      // n pesos inteiros (na escala do percentual) que somam exatamente 100; empates frequentes
      const pesos = [];
      let resto = alvo;
      for (let i = 0; i < n - 1; i += 1) {
        const igual = proximo(3) === 0 && pesos.length ? pesos[pesos.length - 1] : BigInt(proximo(Number(alvo / BigInt(n)) + 1));
        const p = igual <= resto ? igual : resto;
        pesos.push(p);
        resto -= p;
      }
      pesos.push(resto);
      const percentuais = pesos.map((p) => dec(p.toString()).dividedBy(dec(unidades.toString())));
      const unidadesTotal = BigInt(proximo(3) === 0 ? 1 + proximo(9) : 1 + proximo(2_000_000_000));
      const total = dec(unidadesTotal.toString()).dividedBy(dec((10n ** BigInt(casas)).toString()));
      const novo = distribuirPercentuais(total, percentuais, casas).map((v) => v.toFixed(casas));
      const antigo = referencia(total, percentuais, casas).map((v) => v.toFixed(casas));
      assert.deepEqual(novo, antigo, `caso ${k}: total ${total.toFixed(casas)} × [${percentuais.map((p) => p.toString())}]`);
    }
  });

  test('GERAL (rateio_escopo ausente): itens[i].rateios = [] e o consolidado é o próprio rateio geral; POR_ITEM: Σ de todas as linhas = valor_total', async () => {
    const { normalizarDocumento, planejarOperacao } = await plano();
    const base = {
      empresa_id: 'e', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: 'p', data_emissao: '2027-06-10',
      itens: [{ tipo_item: 'SERVICO', unidade: 'UN', quantidade: '3', valor_unitario: '33.333333', descricao: 'X' }, { tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario: '0.01', descricao: 'Y' }],
      rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: 'a', percentual: '33.333333' }, { natureza_id: 'b', percentual: '66.666667' }],
      valor_desconto: '0.01', parcelas: [{ vencimento: '2027-07-10', valor: '100.00' }],
    };
    const g = planejarOperacao(normalizarDocumento(base, 2), { casas: 2, moeda: 'BRL', produtos: new Map() });
    assert.equal(g.rateio_escopo, 'GERAL');
    assert.deepEqual(g.itens.map((i) => i.rateios), [[], []]);
    assert.deepEqual(g.rateios.map((r) => r.valor.toFixed(2)), ['33.33', '66.67']);
    assert.deepEqual(g.rateio_consolidado.map((c) => [c.natureza_id, c.valor.toFixed(2), c.percentual.toFixed(6)]), [['a', '33.33', '33.333333'], ['b', '66.67', '66.666667']]);
  });

  test('paridade ALEATÓRIA backend × tela: 3000 documentos POR_ITEM determinísticos (0/2/3 casas, VALOR e PERCENTUAL, desconto/acréscimo, mercadoria + serviço, linha repetida/zero/soma errada) — mesmos valores, percentuais, consolidado e a MESMA recusa', async () => {
    const { normalizarDocumento, planejarOperacao, percentualDe } = await plano();
    // As funções PURAS da tela (BigInt), as mesmas do formulário e do backend falso.
    const { ratearCabecalho } = await import('../../src/lib/rateioCabecalho.js');
    const { planejarRateioDoItem, consolidarRateio } = await import('../../src/lib/rateioPorItem.js');
    const { deUnidades, paraUnidades } = await import('../../src/lib/dinheiroDecimal.js');
    let semente = 15602n;
    const int = (a, b) => {
      semente = (semente * 6364136223846793005n + 1442695040888963407n) % 18446744073709551616n;
      return a + Number((semente >> 11n) % BigInt(b - a + 1));
    };
    const chance = (p) => int(0, 999) < p * 1000;
    /** `total` (BigInt ≥ 1) em `k` partes ≥ 0 com cortes aleatórios (cortes repetidos dão linha zero). */
    const partir = (total, k) => {
      const cortes = Array.from({ length: k - 1 }, () => (total * BigInt(int(0, 1_000_000))) / 1_000_000n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return [...cortes, total].map((c, i) => c - (i ? cortes[i - 1] : 0n));
    };
    const COMBOS = ['n1', 'n2', 'n3'].flatMap((n) => [null, 'c1', 'c2'].flatMap((cc) => [null, 'r1'].map((cr) => [n, cc, cr])));
    const contagem = { ok: 0, recusas: 0, cabecalho: 0, linhas: 0 };
    for (let caso = 0; caso < 3000; caso += 1) {
      const casas = [0, 2, 2, 3][int(0, 3)];
      const modo = chance(0.5) ? 'PERCENTUAL' : 'VALOR';
      const n = int(1, 5);
      const subtotais = Array.from({ length: n }, () => BigInt(int(1, chance(0.2) ? 9 : 999_999)));
      const bruto = subtotais.reduce((t, x) => t + x, 0n);
      const desconto = chance(0.6) ? BigInt(int(0, Number(bruto / 3n))) : 0n;
      const acrescimo = chance(0.5) ? BigInt(int(0, Number(bruto / 4n))) : 0n;
      const tipos = subtotais.map(() => (chance(0.5) ? 'MERCADORIA' : 'SERVICO'));
      const din = (u) => deUnidades(u, casas);
      const cab = ratearCabecalho({
        direcao: 'PAGAR', casas, valor_desconto: din(desconto), valor_acrescimo: din(acrescimo),
        itens: subtotais.map((x, k) => ({ ordem: k + 1, tipo_item: tipos[k], valor_total: din(x), quantidade_estoque: tipos[k] === 'MERCADORIA' ? '1' : null })),
      });
      const linhasPorItem = subtotais.map((_, k) => {
        const nl = int(1, 4);
        // Fisher–Yates com a semente: classificações distintas no item.
        const combos = [...COMBOS];
        for (let i = combos.length - 1; i > 0; i -= 1) {
          const j = int(0, i);
          [combos[i], combos[j]] = [combos[j], combos[i]];
        }
        combos.length = nl;
        if (nl > 1 && chance(0.04)) combos[nl - 1] = combos[0]; // linha repetida no MESMO item
        const ls = combos.map(([natureza_id, centro_custo_id, centro_resultado_id]) => ({ natureza_id, centro_custo_id, centro_resultado_id }));
        if (modo === 'VALOR') {
          const liquido = paraUnidades(cab.itens[k].valor_liquido, casas);
          const partes = partir(liquido > 0n ? liquido : 1n, nl);
          if (chance(0.05)) partes[int(0, nl - 1)] += 1n; // soma ≠ líquido por 1 unidade
          ls.forEach((l, j) => Object.assign(l, { valor: din(partes[j]) }));
        } else {
          const escala = int(0, 6);
          const partes = partir(100n * 10n ** BigInt(escala), nl);
          if (chance(0.04)) partes[0] += 1n; // soma ≠ 100
          ls.forEach((l, j) => Object.assign(l, { percentual: deUnidades(partes[j], escala) }));
        }
        return ls;
      });
      const corpo = {
        empresa_id: 'e', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: 'p', data_emissao: '2027-06-10',
        ...(tipos.includes('MERCADORIA') ? { data_operacional: '2027-06-10', efeito_fisico_confirmado: true } : {}),
        rateio_escopo: 'POR_ITEM', rateio_modo: modo, rateios: [],
        ...(desconto ? { valor_desconto: din(desconto) } : {}),
        ...(acrescimo ? { valor_acrescimo: din(acrescimo) } : {}),
        itens: subtotais.map((x, k) => ({
          tipo_item: tipos[k], unidade: tipos[k] === 'MERCADORIA' ? 'KG' : 'UN', quantidade: '1', valor_unitario: din(x),
          ...(tipos[k] === 'MERCADORIA' ? { produto_id: 'prod', local_estoque_id: 'loc' } : { descricao: 'SERVICO' }),
          rateios: linhasPorItem[k],
        })),
        parcelas: [{ vencimento: '2027-07-10', valor: din(bruto - desconto + acrescimo) }],
      };
      // Backend (Decimal) × tela (BigInt), item a item, na ordem de checagem do servidor.
      let back = null;
      let erroBack = null;
      try {
        back = planejarOperacao(normalizarDocumento(corpo, casas), { casas, moeda: 'X', produtos: new Map() });
      } catch (e) {
        erroBack = e;
      }
      if (cab.erro) {
        // Desconto que zera um item pequeno: a recusa é do CABEÇALHO (P3-01), igual nos dois lados.
        assert.deepEqual([erroBack?.details?.reason, erroBack?.details?.indice], [cab.erro.reason, cab.erro.details.indice], `caso ${caso}: recusa do cabeçalho`);
        contagem.cabecalho += 1;
        continue;
      }
      let erroTela = null;
      const planos = [];
      for (let k = 0; k < n && !erroTela; k += 1) {
        const r = planejarRateioDoItem({ modo, liquido: cab.itens[k].valor_liquido, casas, linhas: linhasPorItem[k].map((l) => ({ valor: null, percentual: null, ...l })) });
        if (r.erro) erroTela = { ...r.erro, indice: k };
        planos.push(r);
      }
      if (erroTela || erroBack) {
        assert.ok(erroTela && erroBack?.details, `caso ${caso}: tela ${erroTela?.reason ?? 'aceita'} × backend ${erroBack?.details?.reason ?? erroBack?.message ?? 'aceita'}`);
        const d = erroBack.details;
        assert.deepEqual(
          [erroTela.reason, erroTela.field, erroTela.indice, erroTela.subindice ?? null],
          [d.reason, d.field, d.indice, d.subindice ?? null],
          `caso ${caso}: a mesma recusa, no mesmo item e linha`,
        );
        for (const campo of ['modo', 'esperado', 'informado', 'diferenca', 'repete_subindice']) assert.equal(erroTela.details[campo], d[campo], `caso ${caso}: details.${campo}`);
        contagem.recusas += 1;
        continue;
      }
      contagem.ok += 1;
      back.itens.forEach((it, k) => {
        assert.equal(it.valor_liquido.toFixed(casas), cab.itens[k].valor_liquido, `caso ${caso}: líquido do item ${k}`);
        it.rateios.forEach((r, j) => {
          contagem.linhas += 1;
          assert.equal(r.valor.toFixed(casas), planos[k].valores[j], `caso ${caso}: item ${k} linha ${j}: valor`);
          assert.equal((r.percentual ?? percentualDe(r.valor, it.valor_liquido)).toFixed(6), planos[k].percentuais[j], `caso ${caso}: item ${k} linha ${j}: %`);
        });
      });
      const total = back.valor_total.toFixed(casas);
      const todas = linhasPorItem.flatMap((ls, k) => ls.map((l, j) => ({ ...l, valor: planos[k].valores[j] })));
      assert.deepEqual(
        consolidarRateio(todas, total, casas).map((g) => [g.natureza_id, g.centro_custo_id, g.centro_resultado_id, g.valor, g.percentual]),
        back.rateio_consolidado.map((g) => [g.natureza_id, g.centro_custo_id, g.centro_resultado_id, g.valor.toFixed(casas), g.percentual.toFixed(6)]),
        `caso ${caso}: consolidado`,
      );
    }
    // A amostra exercita os dois lados (aceita e recusa) de verdade.
    assert.ok(contagem.ok > 1000 && contagem.recusas > 500 && contagem.linhas > 5000, JSON.stringify(contagem));
    console.log(`paridade aleatória backend × tela: ${JSON.stringify(contagem)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI1 — vetores no PostgreSQL (rascunho, detalhe, prévia e confirmação)', () => {
  for (const caso of VETORES.casos) {
    test(`vetor ${caso.id}: ${caso.descricao}`, async () => {
      const s = await tenantDe(caso.perfil);
      const e = s.e1;
      const doc = corpoDoVetor(s, e, caso);
      const esp = caso.esperado;
      if (esp.erro) {
        const antes = await foto(s.c);
        const r = await post(s, doc);
        const corpo = recusa(r, esp.erro.status, esp.erro.code, esp.erro.reason);
        assert.equal(corpo.field, esp.erro.field);
        const det = { ...corpo.details };
        delete det.field;
        delete det.reason;
        assert.deepEqual(det, esp.erro.details, r.body);
        assert.equal(await foto(s.c), antes, 'nada gravado');
        return;
      }
      const conferir = (d, rotulo) => {
        assert.deepEqual([d.rateio_escopo, d.valor_total, d.rateios], ['POR_ITEM', esp.valor_total, []], rotulo);
        if (rotulo !== 'prévia') assert.equal(d.rateio_modo, caso.rateio_modo);
        assert.deepEqual(d.itens.map((i) => i.valor_liquido), esp.itens.map((i) => i.valor_liquido), rotulo);
        assert.deepEqual(d.itens.map((i) => i.rateios.map((r) => ({ valor: r.valor, percentual: r.percentual }))), esp.itens.map((i) => i.rateios), rotulo);
        assert.deepEqual(consolidadoEmRotulos(e, d.rateio_consolidado), esp.rateio_consolidado, rotulo);
      };
      const d = await A.criar(s.token, doc);
      conferir(d, 'rascunho');
      const prev = await A.previa(s.token, d.id, e.id);
      assert.deepEqual(prev.bloqueios, []);
      conferir(prev.plano, 'prévia');
      // linhas gravadas: valor na escala da coluna (4 casas); percentual só no modo PERCENTUAL
      const gravadas = await linhasGravadas(d.id);
      assert.deepEqual(gravadas.map((ls) => ls.map((l) => D(l[3]).toFixed(caso.casas))), esp.itens.map((i) => i.rateios.map((r) => r.valor)));
      assert.ok(gravadas.flat().every((l) => (caso.rateio_modo === 'VALOR' ? l[4] === null : l[4] !== null)));
      assert.equal(await prisma().operacaoFinanceiraRateio.count({ where: { operacao_id: d.id } }), 0, 'POR_ITEM não grava rateio geral');
      const conf = await A.confirmar(s.token, d, e.id);
      conferir(conf, 'confirmado');
      assert.deepEqual(await linhasGravadas(d.id), gravadas, 'a confirmação não muda as linhas');
      assert.equal(conf.titulos.length, 1);
      const fisicos = caso.itens.filter((i) => i.tipo_item === 'MERCADORIA').length;
      assert.equal(await prisma().movimentacaoEstoque.count({ where: { lancamento_origem_id: d.id } }), fisicos, '1 movimento por item físico');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI2 — fluxos com rateio por item', () => {
  test('compra BRL PARCELADA: 3 itens × 3 naturezas, mercadoria + serviço, 1 item em 2 centros, desconto 10,00 e acréscimo 0,05 (PERCENTUAL sobre o líquido) → 1 título por parcela, 1 movimento por item físico, lote com o custo LÍQUIDO, sem custo duplicado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const itens = [
      mercadoria(s, e.sal, '100', '3.00', [linha(e.desp, { centro_custo_id: e.cc.id, percentual: '100' })]),
      mercadoria(s, e.milho, '50', '2.10', [linha(e.desp2, { centro_custo_id: e.cc.id, percentual: '60' }), linha(e.desp2, { centro_custo_id: e.cc2.id, percentual: '40' })]),
      servico('45.00', [linha(e.desp3, { percentual: '70' }), linha(e.desp, { centro_custo_id: e.cc.id, percentual: '30' })], { descricao: 'FRETE' }),
    ];
    const doc = docItens(e, itens, {
      rateio_modo: 'PERCENTUAL', valor_desconto: '10.00', valor_acrescimo: '0.05', condicao: 'PARCELADO',
      parcelas: [{ vencimento: '2027-07-10', valor: '220.03' }, { vencimento: '2027-08-10', valor: '220.02' }],
    });
    const estoqueAntes = [await estoqueAtual(e.sal), await estoqueAtual(e.milho)];
    const d = await A.criar(s.token, doc);
    assert.deepEqual([d.valor_total, d.rateio_escopo, d.rateios], ['440.05', 'POR_ITEM', []]);
    assert.deepEqual(d.itens.map((i) => [i.valor_desconto_rateado, i.valor_acrescimo_rateado, i.valor_liquido]), [['6.67', '0.03', '293.36'], ['2.33', '0.01', '102.68'], ['1.00', '0.01', '44.01']]);
    assert.deepEqual(valoresDoDetalhe(d), [['293.36'], ['61.61', '41.07'], ['30.81', '13.20']]);
    assert.deepEqual(d.itens[1].rateios.map((r) => [r.natureza_nome, r.natureza_tipo, r.centro_custo_nome, r.percentual]), [['FRETE 1', 'DESPESA', 'REBANHO 1', '60.000000'], ['FRETE 1', 'DESPESA', 'LAVOURA 1', '40.000000']]);
    for (const i of d.itens) assert.equal(somaDe(i.rateios.map((r) => r.valor)), i.valor_liquido, 'Σ das linhas do item = líquido do item');
    // consolidado: INSUMOS|REBANHO aparece no item 1 e no item 3 → uma linha só, sem duplicar montante
    const consolidado = [['INSUMOS 1', 'REBANHO 1', '306.56'], ['FRETE 1', 'REBANHO 1', '61.61'], ['FRETE 1', 'LAVOURA 1', '41.07'], ['ENERGIA 1', null, '30.81']];
    assert.deepEqual(d.rateio_consolidado.map((g) => [g.natureza_nome, g.centro_custo_nome, g.valor]), consolidado);
    assert.deepEqual(d.rateio_consolidado.map((g) => g.percentual), consolidado.map(([, , v]) => pct(v, '440.05')));
    assert.equal(somaDe(d.rateio_consolidado.map((g) => g.valor)), '440.05', 'Σ consolidado = valor_total');
    assert.deepEqual(Object.keys(d.rateio_consolidado[0]).sort(), ['centro_custo_id', 'centro_custo_nome', 'centro_resultado_id', 'centro_resultado_nome', 'natureza_id', 'natureza_nome', 'percentual', 'valor']);
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).rateio_escopo, 'POR_ITEM', 'discriminador explícito no banco');
    assert.equal(await linhasCoerentes(d.id), 5);

    const conf = await A.confirmar(s.token, d, e.id);
    assert.equal(conf.status, 'CONFIRMADO');
    assert.deepEqual(valoresDoDetalhe(conf), valoresDoDetalhe(d), 'as linhas por item não mudam na confirmação');
    assert.deepEqual(conf.titulos.map((t) => [t.numero_parcela, t.valor, t.status]), [[1, '220.03', 'ABERTO'], [2, '220.02', 'ABERTO']], '1 título por parcela');
    assert.equal(await p.tituloFinanceiro.count({ where: { operacao_id: d.id } }), 2);
    const movimentos = await p.movimentacaoEstoque.findMany({ where: { lancamento_origem_id: d.id }, orderBy: { produto_nome: 'asc' } });
    assert.equal(movimentos.length, 2, '1 movimento por item físico (o serviço não mexe no estoque; o rateio não cria movimento)');
    assert.deepEqual(movimentos.map((m) => [m.produto_id, m.quantidade.toFixed(4), m.valor_total.toFixed(4)]), [[e.milho.id, '50.0000', '102.6800'], [e.sal.id, '100.0000', '293.3600']]);
    const lotes = await p.estoqueLoteNota.findMany({ where: { id: { in: conf.itens.filter((i) => i.estoque_lote_nota_id).map((i) => i.estoque_lote_nota_id) } }, orderBy: { produto_nome: 'asc' } });
    assert.deepEqual(lotes.map((l) => [l.custo_unitario.toFixed(4), l.quantidade_entrada.toFixed(4)]), [['2.0536', '50.0000'], ['2.9336', '100.0000']], 'custo do lote = líquido / kg (uma vez só)');
    assert.deepEqual([await estoqueAtual(e.sal), await estoqueAtual(e.milho)], [D(estoqueAntes[0]).plus(100).toFixed(4), D(estoqueAntes[1]).plus(50).toFixed(4)]);
    assert.equal(await p.operacaoFinanceiraRateio.count({ where: { operacao_id: d.id } }), 0);
    assert.equal(await p.operacaoFinanceiraItemRateio.count({ where: { operacao_id: d.id } }), 5);
    // listagem: só o escopo a mais
    const lista = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}`, s.token));
    const naLista = lista.items.find((x) => x.id === d.id);
    assert.equal(naLista.rateio_escopo, 'POR_ITEM');
    assert.equal('rateio_consolidado' in naLista, false);
    // auditoria: contagens, sem nome
    const log = await p.auditLog.findFirst({ where: { entidade_id: d.id, acao: 'operacao_financeira.confirmar' } });
    assert.deepEqual([log.dados_novos.rateio_escopo, log.dados_novos.rateios_n, log.dados_novos.rateios_itens_n], ['POR_ITEM', 0, 5]);
    assert.doesNotMatch(JSON.stringify(log.dados_novos), /INSUMOS|FRETE|REBANHO/);
  });

  test('venda (RECEBER) VALOR por item com natureza RECEITA e centro de resultado: saída FIFO, 1 movimento, linhas exatas; à vista com baixa no ato quita o único título', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '100', custo: '2.0000' });
    await definirEstoqueAtual(e.sal, '100');
    const venda = docItens(e, [
      mercadoria(s, e.sal, '10', '5.00', [linha(e.rec, { valor: '30.00' }), linha(e.rec2, { centro_resultado_id: e.cr.id, valor: '20.00' })]),
      servico('20.00', [linha(e.rec2, { valor: '20.00' })], { descricao: 'ENTREGA' }),
    ], { direcao: 'RECEBER' });
    const d = await A.criarConfirmar(s.token, venda);
    assert.deepEqual([d.status, d.rateio_escopo, valoresDoDetalhe(d)], ['CONFIRMADO', 'POR_ITEM', [['30.00', '20.00'], ['20.00']]]);
    assert.deepEqual(d.itens[0].rateios.map((r) => [r.natureza_tipo, r.centro_resultado_nome, r.percentual]), [['RECEITA', null, '60.000000'], ['RECEITA', 'CRIA 1', '40.000000']]);
    assert.deepEqual(d.rateio_consolidado.map((g) => [g.natureza_nome, g.centro_resultado_nome, g.valor]), [['VENDA 1', null, '30.00'], ['SERVICOS 1', 'CRIA 1', '20.00'], ['SERVICOS 1', null, '20.00']]);
    assert.equal(await p.movimentacaoEstoque.count({ where: { lancamento_origem_id: d.id } }), 1);
    assert.equal(await estoqueAtual(e.sal), '90.0000');
    assert.equal(d.titulos.length, 1);
    // à vista, só serviço, baixa no ato
    const avista = docItens(e, [servico('80.00', [linha(e.desp, { valor: '50.00' }), linha(e.desp2, { centro_custo_id: e.cc2.id, valor: '30.00' })])], {
      condicao: 'AVISTA', parcelas: [{ vencimento: '2027-06-10', valor: '80.00' }],
    });
    const quitado = await A.confirmar(s.token, await A.criar(s.token, avista), e.id, { baixa_no_ato: { metodo: 'PIX', data: '2027-06-10' } });
    assert.deepEqual([quitado.titulos.length, quitado.titulos[0].status, valoresDoDetalhe(quitado)], [1, 'QUITADO', [['50.00', '30.00']]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI3 — escopo, exclusões e recusas da linha (item e linha exatos)', () => {
  test('escopo inválido, POR_ITEM sem produtos, geral + por item, geral sem linha, item sem linha, tetos (20 por item, 1000 no documento), duplicada no MESMO item, valor zero, soma por item, recusas 400 da linha: nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const ok = () => [servico('100.00', [linha(e.desp, { valor: '100.00' })]), servico('50.00', [linha(e.desp2, { valor: '30.00' }), linha(e.desp3, { valor: '20.00' })])];
    const antes = await foto(s.c);

    for (const escopo of ['MISTO', 'por_item', 'geral', '']) {
      const r = recusa(await post(s, { ...docItens(e, ok()), rateio_escopo: escopo }), 422, 'OPERACAO_RATEIO_INVALIDO', 'escopo_invalido');
      assert.deepEqual([r.field, r.details.permitidos], ['rateio_escopo', ['GERAL', 'POR_ITEM']]);
    }
    recusa(await post(s, docSem(e, { rateio_escopo: 'POR_ITEM', rateios: [] })), 422, 'OPERACAO_RATEIO_INVALIDO', 'escopo_por_item_exige_produtos');
    recusa(await post(s, docSem(e, { rateio_escopo: 'POR_ITEM' })), 422, 'OPERACAO_RATEIO_INVALIDO', 'escopo_por_item_exige_produtos');
    // os dois modos juntos, em qualquer escopo
    const topo = [linha(e.desp, { valor: '150.00' })];
    const ambosPorItem = recusa(await post(s, docItens(e, ok(), { rateios: topo })), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_geral_e_por_item');
    assert.deepEqual([ambosPorItem.field, ambosPorItem.details.colecao, ambosPorItem.details.indice, ambosPorItem.details.escopo], ['rateios', 'rateios', 0, 'POR_ITEM']);
    const soItem2 = [servico('100.00', []), servico('50.00', [linha(e.desp2, { valor: '50.00' })])];
    const ambosGeral = recusa(await post(s, docItens(e, soItem2, { rateio_escopo: 'GERAL', rateios: topo })), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_geral_e_por_item');
    naPosicao(ambosGeral, 1);
    const geralComItem = recusa(await post(s, docItens(e, soItem2, { rateio_escopo: undefined, rateios: [] })), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_geral_e_por_item');
    naPosicao(geralComItem, 1);
    // GERAL sem linha (sem escopo = GERAL): agora 422 preciso, não 400 do schema
    const semLinha = recusa(await post(s, docItens(e, [servico('150.00', [])], { rateio_escopo: 'GERAL', rateios: [] })), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_geral_obrigatorio');
    assert.equal(semLinha.field, 'rateios');
    const semRateios = docSem(e);
    delete semRateios.rateios;
    recusa(await post(s, semRateios), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_geral_obrigatorio');
    // item sem linha (lista vazia ou ausente)
    const semNoItem = [servico('100.00', [linha(e.desp, { valor: '100.00' })]), { ...servico('50.00', []), rateios: undefined }];
    naPosicao(recusa(await post(s, docItens(e, semNoItem)), 422, 'OPERACAO_RATEIO_INVALIDO', 'item_sem_rateio'), 1);
    naPosicao(recusa(await post(s, docItens(e, [servico('100.00', [])])), 422, 'OPERACAO_RATEIO_INVALIDO', 'item_sem_rateio'), 0);
    // teto por item (20) e do documento (1000)
    const vinteUma = Array.from({ length: 21 }, () => linha(e.desp, { valor: '1.00' }));
    const teto = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '100.00' })]), servico('21.00', vinteUma)])), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_item_excede_limite');
    naPosicao(teto, 1);
    assert.deepEqual([teto.details.limite, teto.details.informado], [20, 21]);
    const vinte = Array.from({ length: 20 }, () => linha(e.desp, { valor: '1.00' }));
    const tetoDoc = recusa(await post(s, docItens(e, Array.from({ length: 51 }, () => servico('20.00', vinte)))), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_itens_excede_limite');
    naPosicao(tetoDoc, 50);
    assert.deepEqual([tetoDoc.details.limite, tetoDoc.details.informado], [1000, 1020]);
    // linha repetida no MESMO item (em itens diferentes é permitido: ver abaixo)
    const dup = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '100.00' })]), servico('50.00', [linha(e.desp, { centro_custo_id: e.cc.id, valor: '25.00' }), linha(e.desp, { centro_custo_id: e.cc.id, valor: '25.00' })])])), 422, 'OPERACAO_RATEIO_INVALIDO', 'linha_duplicada');
    naPosicao(dup, 1, 1);
    assert.deepEqual([dup.field, dup.details.repete_subindice], ['natureza_id', 0]);
    // valor zero; soma por item (VALOR e PERCENTUAL)
    const zero = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '100.00' })]), servico('50.00', [linha(e.desp2, { valor: '50.00' }), linha(e.desp3, { valor: '0.00' })])])), 422, 'OPERACAO_RATEIO_INVALIDO', 'valor_linha_zero');
    naPosicao(zero, 1, 1);
    const soma = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '100.00' })]), servico('50.00', [linha(e.desp2, { valor: '30.00' }), linha(e.desp3, { valor: '19.99' })])])), 422, 'OPERACAO_RATEIO_INVALIDO', 'soma_diferente');
    naPosicao(soma, 1);
    assert.deepEqual([soma.details.modo, soma.details.esperado, soma.details.informado, soma.details.diferenca, soma.details.valor_liquido], ['VALOR', '50.00', '49.99', '0.01', '50.00']);
    const somaP = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { percentual: '60' }), linha(e.desp2, { percentual: '40.000001' })])], { rateio_modo: 'PERCENTUAL' })), 422, 'OPERACAO_RATEIO_INVALIDO', 'soma_diferente');
    naPosicao(somaP, 0);
    assert.deepEqual([somaP.details.modo, somaP.details.esperado, somaP.details.informado, somaP.details.diferenca], ['PERCENTUAL', '100.000000', '100.000001', '-0.000001']);
    // 400 da linha do item: obrigatório, casas da moeda, coerção de tipo, campo desconhecido
    const obrig = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '60.00' }), linha(e.desp2)])])), 400, 'REQUEST_VALIDATION_FAILED', 'obrigatorio');
    naPosicao(obrig, 0, 1);
    const casas = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '99.999' }), linha(e.desp2, { valor: '0.001' })])])), 400, 'REQUEST_VALIDATION_FAILED', 'casas_decimais_excedidas');
    naPosicao(casas, 0, 0);
    const numero = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '50.00' }), linha(e.desp2, { valor: 50 })])])), 400, 'REQUEST_VALIDATION_FAILED', 'valor_deve_ser_texto');
    naPosicao(numero, 0, 1);
    assert.equal(numero.details.campo, 'itens.0.rateios.1.valor');
    const pctNumero = recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { percentual: 100 })])], { rateio_modo: 'PERCENTUAL' })), 400, 'REQUEST_VALIDATION_FAILED', 'valor_deve_ser_texto');
    assert.equal(pctNumero.details.campo, 'itens.0.rateios.0.percentual');
    recusa(await post(s, docItens(e, [servico('100.00', [linha(e.desp, { valor: '100.00', item_id: 'x' })])])), 400, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await foto(s.c), antes, 'nenhuma recusa gravou nada');

    // a mesma natureza + centros em itens DIFERENTES é permitida (e somada no consolidado)
    const doisItens = await A.criar(s.token, docItens(e, [servico('100.00', [linha(e.desp, { centro_custo_id: e.cc.id, valor: '100.00' })]), servico('50.00', [linha(e.desp, { centro_custo_id: e.cc.id, valor: '50.00' })])]));
    assert.deepEqual(doisItens.rateio_consolidado.map((g) => [g.natureza_nome, g.centro_custo_nome, g.valor, g.percentual]), [['INSUMOS 1', 'REBANHO 1', '150.00', '100.000000']]);
    // PUT recusado não toca nas linhas
    const linhas = await linhasGravadas(doisItens.id);
    recusa(await put(s, doisItens, docItens(e, [servico('100.00', [linha(e.desp, { valor: '99.99' })])])), 422, 'OPERACAO_RATEIO_INVALIDO', 'soma_diferente');
    assert.deepEqual(await linhasGravadas(doisItens.id), linhas);
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: doisItens.id } })).versao, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI4 — referências das linhas por item', () => {
  test('natureza/centros inativos, de outra empresa, de outro tenant, tipo × direção (pagar e receber) e sintética → 422 OPERACAO_REFERENCIA_INVALIDA com item e linha; nada gravado', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const base = { cliente_id: s.c, empresa_id: e.id };
    const inativa = await p.naturezaFinanceira.create({ data: { ...base, numero: '81', tipo: 'DESPESA', nome: 'INATIVA', ativo: false } });
    const pai = await p.naturezaFinanceira.create({ data: { ...base, numero: '82', tipo: 'DESPESA', nome: 'PAI SINTETICA' } });
    await p.naturezaFinanceira.create({ data: { ...base, numero: '83', tipo: 'DESPESA', nome: 'FILHA ATIVA', pai_id: pai.id } });
    const ccInativo = await p.centroCusto.create({ data: { ...base, numero: '8', nome: 'CC INATIVO', ativo: false } });
    const crInativo = await p.centroResultado.create({ data: { ...base, numero: '8', nome: 'CR INATIVO', ativo: false } });
    const antes = await foto([s.c, outro.c]);
    const com = (l, direcao = 'PAGAR') => {
      const nat = direcao === 'PAGAR' ? e.desp : e.rec;
      return docItens(e, [servico('100.00', [linha(nat, { valor: '100.00' })]), servico('50.00', [linha(nat, { valor: '10.00' }), { ...l, valor: '40.00' }])], { direcao });
    };
    for (const [l, field, reason, extra] of [
      [linha(inativa), 'natureza_id', 'natureza_inativa'],
      [linha(pai), 'natureza_id', 'natureza_sintetica'],
      [linha(e.rec), 'natureza_id', 'natureza_tipo_incompativel', { esperado: 'DESPESA' }],
      [linha(s.e2.desp), 'natureza_id', 'natureza_nao_encontrada'],
      [linha(outro.e1.desp), 'natureza_id', 'natureza_nao_encontrada'],
      [linha(e.desp2, { centro_custo_id: ccInativo.id }), 'centro_custo_id', 'centro_custo_inativo'],
      [linha(e.desp2, { centro_custo_id: s.e2.cc.id }), 'centro_custo_id', 'centro_custo_nao_encontrado'],
      [linha(e.desp2, { centro_custo_id: outro.e1.cc.id }), 'centro_custo_id', 'centro_custo_nao_encontrado'],
      [linha(e.desp2, { centro_resultado_id: crInativo.id }), 'centro_resultado_id', 'centro_resultado_inativo'],
      [linha(e.desp2, { centro_resultado_id: outro.e1.cr.id }), 'centro_resultado_id', 'centro_resultado_nao_encontrado'],
    ]) {
      const r = recusa(await post(s, com(l)), 422, 'OPERACAO_REFERENCIA_INVALIDA', reason);
      assert.equal(r.field, field, reason);
      naPosicao(r, 1, 1);
      if (extra) assert.equal(r.details.esperado, extra.esperado);
    }
    const receber = recusa(await post(s, com(linha(e.desp), 'RECEBER')), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'natureza_tipo_incompativel');
    naPosicao(receber, 1, 1);
    assert.equal(receber.details.esperado, 'RECEITA');
    assert.equal(await foto([s.c, outro.c]), antes, 'nada gravado');
  });

  test('referência que fica inativa depois do rascunho: a prévia mostra TODAS (item e linha) e a confirmação recusa sem efeito; o nome é retratado na confirmação', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docItens(e, [
      mercadoria(s, e.sal, '10', '2.00', [linha(e.desp, { valor: '20.00' })]),
      servico('30.00', [linha(e.desp2, { valor: '10.00' }), linha(e.desp3, { centro_custo_id: e.cc2.id, valor: '20.00' })]),
    ]));
    await p.naturezaFinanceira.update({ where: { id: e.desp3.id }, data: { ativo: false } });
    await p.centroCusto.update({ where: { id: e.cc2.id }, data: { ativo: false } });
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.reason, b.details.colecao, b.details.indice, b.details.subcolecao, b.details.subindice]), [
      ['natureza_inativa', 'itens', 1, 'rateios', 1], ['centro_custo_inativo', 'itens', 1, 'rateios', 1],
    ]);
    const antes = await foto(s.c);
    const r = recusa(await A.confirmarReq(s.token, d, e.id), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'natureza_inativa');
    naPosicao(r, 1, 1);
    assert.equal(await foto(s.c), antes, 'confirmação recusada não deixa efeito');
    // reativa e renomeia: a confirmação retrata o nome ATUAL nas linhas por item
    await p.naturezaFinanceira.update({ where: { id: e.desp3.id }, data: { ativo: true, nome: 'ENERGIA RENOMEADA' } });
    await p.centroCusto.update({ where: { id: e.cc2.id }, data: { ativo: true, nome: 'LAVOURA RENOMEADA' } });
    assert.deepEqual(d.itens[1].rateios[1].natureza_nome, 'ENERGIA 1', 'o rascunho guardou o nome da época');
    const conf = await A.confirmar(s.token, d, e.id);
    assert.deepEqual([conf.itens[1].rateios[1].natureza_nome, conf.itens[1].rateios[1].centro_custo_nome], ['ENERGIA RENOMEADA', 'LAVOURA RENOMEADA']);
    await p.naturezaFinanceira.update({ where: { id: e.desp3.id }, data: { nome: 'OUTRO NOME DEPOIS' } });
    const det = await A.detalhe(s.token, d.id, e.id);
    assert.equal(det.itens[1].rateios[1].natureza_nome, 'ENERGIA RENOMEADA', 'confirmado guarda o retrato');
    assert.equal(det.rateio_consolidado.find((g) => g.natureza_id === e.desp3.id).natureza_nome, 'ENERGIA RENOMEADA');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI5 — rascunho: itens e escopo mudam, as linhas acompanham', () => {
  test('alterar as linhas de um item, remover um item, reordenar, trocar POR_ITEM ↔ GERAL, trocar a direção e descartar: as linhas por item acompanham o SEU item na mesma transação', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const itemSal = (rateios) => mercadoria(s, e.sal, '10', '2.00', rateios);
    const itemMilho = (rateios) => mercadoria(s, e.milho, '5', '4.00', rateios);
    const itemFrete = (rateios) => servico('30.00', rateios, { descricao: 'FRETE' });
    let d = await A.criar(s.token, docItens(e, [itemSal([linha(e.desp, { valor: '20.00' })]), itemMilho([linha(e.desp2, { valor: '20.00' })]), itemFrete([linha(e.desp3, { valor: '30.00' })])]));
    assert.equal(await linhasCoerentes(d.id), 3);
    // (1) o item 2 passa a ter 2 linhas
    d = await A.ok(put(s, d, docItens(e, [itemSal([linha(e.desp, { valor: '20.00' })]), itemMilho([linha(e.desp2, { valor: '15.00' }), linha(e.desp, { centro_custo_id: e.cc.id, valor: '5.00' })]), itemFrete([linha(e.desp3, { valor: '30.00' })])])));
    assert.deepEqual(valoresDoDetalhe(d), [['20.00'], ['15.00', '5.00'], ['30.00']]);
    assert.equal(await linhasCoerentes(d.id), 4);
    // (2) remove o item do sal: as linhas dele somem; nenhuma órfã
    const idsAntes = (await p.operacaoFinanceiraItemRateio.findMany({ where: { operacao_id: d.id }, select: { id: true } })).map((x) => x.id);
    d = await A.ok(put(s, d, docItens(e, [itemMilho([linha(e.desp2, { valor: '15.00' }), linha(e.desp, { centro_custo_id: e.cc.id, valor: '5.00' })]), itemFrete([linha(e.desp3, { valor: '30.00' })])])));
    assert.deepEqual([d.itens.map((i) => i.produto_id ?? i.descricao), valoresDoDetalhe(d)], [[e.milho.id, 'FRETE'], [['15.00', '5.00'], ['30.00']]]);
    assert.equal(await linhasCoerentes(d.id), 3);
    assert.equal(await p.operacaoFinanceiraItemRateio.count({ where: { id: { in: idsAntes } } }), 0, 'o PUT recria: nenhuma linha antiga sobra');
    // (3) reordena: as linhas vão com o item (associação pela ordem do item NA MESMA requisição)
    d = await A.ok(put(s, d, docItens(e, [itemFrete([linha(e.desp3, { valor: '30.00' })]), itemMilho([linha(e.desp2, { valor: '15.00' }), linha(e.desp, { centro_custo_id: e.cc.id, valor: '5.00' })])])));
    const banco = await p.operacaoFinanceiraItem.findMany({ where: { operacao_id: d.id }, orderBy: { ordem: 'asc' }, include: { rateios: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual(banco.map((i) => [i.ordem, i.descricao ?? i.produto_id, i.rateios.map((r) => [r.natureza_id, r.valor.toFixed(2)])]), [
      [1, 'FRETE', [[e.desp3.id, '30.00']]], [2, e.milho.id, [[e.desp2.id, '15.00'], [e.desp.id, '5.00']]],
    ]);
    // (4) POR_ITEM → GERAL: linhas por item apagadas, rateio geral gravado; consolidado = geral
    d = await A.ok(put(s, d, docItens(e, [itemFrete([]), itemMilho([])], { rateio_escopo: 'GERAL', rateios: [linha(e.desp, { valor: '50.00' })] })));
    assert.deepEqual([d.rateio_escopo, d.itens.map((i) => i.rateios), d.rateios.map((r) => r.valor)], ['GERAL', [[], []], ['50.00']]);
    assert.deepEqual(d.rateio_consolidado, [{ natureza_id: e.desp.id, natureza_nome: 'INSUMOS 1', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: null, centro_resultado_nome: null, valor: '50.00', percentual: '100.000000' }]);
    assert.deepEqual([await p.operacaoFinanceiraItemRateio.count({ where: { operacao_id: d.id } }), (await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).rateio_escopo], [0, 'GERAL']);
    // (5) GERAL → POR_ITEM: o geral some
    d = await A.ok(put(s, d, docItens(e, [itemFrete([linha(e.desp3, { valor: '30.00' })]), itemMilho([linha(e.desp2, { valor: '20.00' })])])));
    assert.deepEqual([d.rateio_escopo, d.rateios, await p.operacaoFinanceiraRateio.count({ where: { operacao_id: d.id } }), await linhasCoerentes(d.id)], ['POR_ITEM', [], 0, 2]);
    // (6) troca a direção com linhas por item gravadas (FK com a direção é ON UPDATE RESTRICT: apaga antes)
    d = await A.ok(put(s, d, docItens(e, [servico('30.00', [linha(e.rec, { valor: '10.00' }), linha(e.rec2, { valor: '20.00' })])], { direcao: 'RECEBER' })));
    assert.deepEqual([d.direcao, d.itens[0].rateios.map((r) => r.natureza_tipo)], ['RECEBER', ['RECEITA', 'RECEITA']]);
    assert.equal(await linhasCoerentes(d.id), 2);
    // (7) descarta: linhas por item, itens e cabeçalho somem
    await A.ok(A.req('DELETE', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}&versao=${d.versao}`, s.token), 204);
    assert.deepEqual([await p.operacaoFinanceiraItemRateio.count({ where: { operacao_id: d.id } }), await p.operacaoFinanceiraItem.count({ where: { operacao_id: d.id } }), await p.operacaoFinanceira.count({ where: { id: d.id } })], [0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI6/RI7 — idempotência e documento duplicado', () => {
  test('POST e confirmar com a mesma chave: replay idêntico sem novas linhas; mesma chave com linhas diferentes → 409 IDEMPOTENCY_CONFLICT', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const doc = docItens(e, [mercadoria(s, e.sal, '10', '3.00', [linha(e.desp, { valor: '10.00' }), linha(e.desp2, { valor: '20.00' })])]);
    const chave = opId();
    const r1 = await A.ok(post(s, doc, chave), 201);
    const r2 = await A.ok(post(s, doc, chave), 200);
    const { replay: rp1, ...c1 } = r1;
    const { replay: rp2, ...c2 } = r2;
    assert.deepEqual([rp1, rp2], [false, true]);
    assert.deepEqual(c2, c1, 'replay devolve o MESMO corpo (com as linhas por item)');
    assert.equal(await p.operacaoFinanceira.count({ where: { cliente_id: s.c } }), 1);
    assert.equal(await p.operacaoFinanceiraItemRateio.count({ where: { cliente_id: s.c } }), 2);
    const outroCorpo = docItens(e, [mercadoria(s, e.sal, '10', '3.00', [linha(e.desp, { valor: '15.00' }), linha(e.desp2, { valor: '15.00' })])]);
    recusa(await post(s, outroCorpo, chave), 409, 'IDEMPOTENCY_CONFLICT');
    const chaveConf = opId();
    const k1 = await A.confirmar(s.token, r1, e.id, { operation_id: chaveConf });
    const k2 = await A.confirmar(s.token, r1, e.id, { operation_id: chaveConf });
    assert.deepEqual([k1.replay, k2.replay], [false, true]);
    assert.deepEqual(valoresDoDetalhe(k2), valoresDoDetalhe(k1));
    assert.deepEqual([await p.movimentacaoEstoque.count({ where: { lancamento_origem_id: r1.id } }), await p.tituloFinanceiro.count({ where: { operacao_id: r1.id } }), await p.operacaoFinanceiraItemRateio.count({ where: { cliente_id: s.c } })], [1, 1, 2]);
  });

  test('dois POR_ITEM com o mesmo documento e parceiro: o segundo rascunho existe, a prévia aponta a duplicidade e a confirmação recusa 409 sem efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const doc = (valor) => docItens(e, [servico(valor, [linha(e.desp, { valor })])], { documento_referencia: 'nf-156' });
    await A.criarConfirmar(s.token, doc('10.00'));
    const d2 = await A.criar(s.token, doc('12.00'));
    const prev = await A.previa(s.token, d2.id, e.id);
    assert.deepEqual(prev.bloqueios.map((b) => b.code), ['OPERACAO_DOCUMENTO_DUPLICADO']);
    const antes = await foto(s.c);
    recusa(await A.confirmarReq(s.token, d2, e.id), 409, 'OPERACAO_DOCUMENTO_DUPLICADO');
    assert.equal(await foto(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI8 — cancelamento e imutabilidade', () => {
  test('confirmado POR_ITEM não aceita PUT; cancelar estorna o estoque, cancela os títulos e PRESERVA as linhas por item e o consolidado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    // desconto 0,30 sobre 30,00 + 10,00: 22,5 e 7,5 centavos, empate de restos → o centavo vai para o item 1.
    const doc = docItens(e, [
      mercadoria(s, e.sal, '20', '1.50', [linha(e.desp, { centro_custo_id: e.cc.id, valor: '17.82' }), linha(e.desp, { centro_custo_id: e.cc2.id, valor: '11.95' })]),
      servico('10.00', [linha(e.desp3, { valor: '9.93' })]),
    ], { valor_desconto: '0.30' });
    const conf = await A.criarConfirmar(s.token, doc);
    assert.deepEqual(conf.itens.map((i) => i.valor_liquido), ['29.77', '9.93']);
    const linhas = await linhasGravadas(conf.id);
    const antesPut = await foto(s.c);
    recusa(await put(s, conf, doc), 409, 'OPERACAO_STATUS_INVALIDO');
    assert.equal(await foto(s.c), antesPut, 'confirmado é imutável');
    const canc = await A.ok(A.cancelarReq(s.token, conf.id, e.id));
    assert.equal(canc.status, 'CANCELADO');
    assert.deepEqual(canc.titulos.map((t) => t.status), ['CANCELADO']);
    assert.deepEqual(await linhasGravadas(conf.id), linhas, 'as linhas por item ficam (histórico)');
    assert.deepEqual([valoresDoDetalhe(canc), canc.rateio_consolidado], [valoresDoDetalhe(conf), conf.rateio_consolidado]);
    assert.ok(canc.itens[0].movimentacao_estorno_id, 'estorno do item físico');
    assert.equal(await p.movimentacaoEstoque.count({ where: { lancamento_origem_id: conf.id } }), 2, 'entrada + estorno, nada do rateio');
    recusa(await put(s, canc, doc), 409, 'OPERACAO_STATUS_INVALIDO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI9 — documento antigo (rateio_escopo NULL) = GERAL', () => {
  test('NULL no banco: detalhe, prévia, listagem e confirmação iguais a um GERAL explícito; POST sem rateio_escopo grava GERAL explícito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const com = {
      empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: e.forn.id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
      efeito_fisico_confirmado: true, valor_desconto: '0.01',
      itens: [{ tipo_item: 'MERCADORIA', produto_id: e.sal.id, local_estoque_id: s.local.id, unidade: 'KG', quantidade: '10', valor_unitario: '3.00' }, { tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario: '10.00', descricao: 'FRETE' }],
      rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: e.desp.id, percentual: '33.333333' }, { natureza_id: e.desp2.id, centro_custo_id: e.cc.id, percentual: '66.666667' }],
      parcelas: [{ vencimento: '2027-07-10', valor: '39.99' }],
    };
    const explicito = await A.criar(s.token, { ...com, rateio_escopo: 'GERAL' });
    const antigo = await A.criar(s.token, com);
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: antigo.id } })).rateio_escopo, 'GERAL', 'POST sem escopo grava GERAL');
    await p.operacaoFinanceira.update({ where: { id: antigo.id }, data: { rateio_escopo: null } });
    const semIds = (x) => {
      const y = JSON.parse(JSON.stringify(x));
      for (const k of ['id', 'numero', 'created_date', 'updated_date', 'historico']) delete y[k];
      for (const i of y.itens ?? []) delete i.id;
      for (const t of y.titulos ?? []) delete t.id;
      return y;
    };
    const dAntigo = await A.detalhe(s.token, antigo.id, e.id);
    const dExplicito = await A.detalhe(s.token, explicito.id, e.id);
    assert.equal(dAntigo.rateio_escopo, 'GERAL');
    assert.deepEqual(semIds(dAntigo), semIds(dExplicito));
    assert.deepEqual(dAntigo.itens.map((i) => i.rateios), [[], []]);
    assert.deepEqual(dAntigo.rateio_consolidado, dAntigo.rateios.map((r) => ({
      natureza_id: r.natureza_id, natureza_nome: r.natureza_nome, centro_custo_id: r.centro_custo_id, centro_custo_nome: r.centro_custo_nome,
      centro_resultado_id: r.centro_resultado_id, centro_resultado_nome: r.centro_resultado_nome, valor: r.valor, percentual: r.percentual,
    })), 'GERAL: consolidado = rateio geral');
    const [pA, pE] = [await A.previa(s.token, antigo.id, e.id), await A.previa(s.token, explicito.id, e.id)];
    assert.deepEqual(pA, pE, 'prévia idêntica');
    assert.equal(pA.plano.rateio_escopo, 'GERAL');
    const lista = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}`, s.token));
    assert.deepEqual(lista.items.filter((x) => [antigo.id, explicito.id].includes(x.id)).map((x) => x.rateio_escopo), ['GERAL', 'GERAL']);
    const cA = await A.confirmar(s.token, dAntigo, e.id);
    const cE = await A.confirmar(s.token, dExplicito, e.id);
    assert.deepEqual([cA.rateios.map((r) => r.valor), cA.rateio_escopo], [cE.rateios.map((r) => r.valor), 'GERAL']);
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: antigo.id } })).rateio_escopo, null, 'a confirmação não reescreve o discriminador antigo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI10 — o banco é a última rede', () => {
  test('documento POR_ITEM adulterado fora da API: a prévia bloqueia e a confirmação recusa (sem linha, soma errada, geral + por item, escopo desconhecido, POR_ITEM sem produtos) sem efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const novo = () => A.criar(s.token, docItens(e, [mercadoria(s, e.sal, '10', '2.00', [linha(e.desp, { valor: '20.00' })]), servico('30.00', [linha(e.desp2, { valor: '10.00' }), linha(e.desp3, { valor: '20.00' })])]));
    const casos = [
      ['item_sem_rateio', async (d) => p.operacaoFinanceiraItemRateio.deleteMany({ where: { operacao_id: d.id, item_id: d.itens[1].id } }), 1],
      ['soma_diferente', async (d) => p.operacaoFinanceiraItemRateio.updateMany({ where: { operacao_id: d.id, item_id: d.itens[1].id, ordem: 2 }, data: { valor: '20.01' } }), 1],
      ['rateio_geral_e_por_item', async (d) => p.operacaoFinanceiraRateio.create({ data: { cliente_id: s.c, empresa_id: e.id, operacao_id: d.id, operacao_direcao: 'PAGAR', ordem: 1, natureza_id: e.desp.id, natureza_tipo: 'DESPESA', natureza_nome: 'X', valor: '50.00' } }), null],
      ['escopo_invalido', async (d) => p.operacaoFinanceira.update({ where: { id: d.id }, data: { rateio_escopo: 'XYZ' } }), null],
    ];
    for (const [reason, adulterar, indice] of casos) {
      const d = await novo();
      await adulterar(d);
      const prev = await A.previa(s.token, d.id, e.id);
      assert.deepEqual([prev.plano, prev.bloqueios.map((b) => b.reason)], [null, [reason]], reason);
      const antes = await foto(s.c);
      const r = recusa(await A.confirmarReq(s.token, d, e.id), 422, 'OPERACAO_RATEIO_INVALIDO', reason);
      if (indice !== null) naPosicao(r, indice);
      assert.equal(await foto(s.c), antes, `${reason}: nada mudou`);
    }
    // GERAL com linha por item enfiada; SEM_PRODUTOS marcado POR_ITEM
    const geral = await A.criar(s.token, { ...docItens(e, [servico('30.00', [])], { rateio_escopo: 'GERAL', rateios: [linha(e.desp, { valor: '30.00' })] }) });
    await p.operacaoFinanceiraItemRateio.create({ data: { cliente_id: s.c, empresa_id: e.id, operacao_id: geral.id, operacao_direcao: 'PAGAR', item_id: geral.itens[0].id, ordem: 1, natureza_id: e.desp.id, natureza_tipo: 'DESPESA', natureza_nome: 'X', valor: '30.00' } });
    naPosicao(recusa(await A.confirmarReq(s.token, geral, e.id), 422, 'OPERACAO_RATEIO_INVALIDO', 'rateio_geral_e_por_item'), 0);
    const sem = await A.criar(s.token, docSem(e));
    await p.operacaoFinanceira.update({ where: { id: sem.id }, data: { rateio_escopo: 'POR_ITEM' } });
    recusa(await A.confirmarReq(s.token, sem, e.id), 422, 'OPERACAO_RATEIO_INVALIDO', 'escopo_por_item_exige_produtos');
  });

  test('CHECK/FK/UNIQUE da tabela nova recusam INSERT/UPDATE direto incoerente; RLS ligado e zero grants para PUBLIC/anon/authenticated', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docItens(e, [servico('30.00', [linha(e.desp, { valor: '30.00' })])]));
    const dE2 = await A.criar(s.token, docItens(s.e2, [servico('30.00', [linha(s.e2.desp, { valor: '30.00' })])]));
    const item = d.itens[0].id;
    const recusaSql = async (sql, padrao, rotulo) => {
      await assert.rejects(() => p.$executeRawUnsafe(sql), (erro) => {
        const x = /** @type {any} */ (erro);
        assert.match(`${x.message} ${JSON.stringify(x.meta ?? {})}`, padrao, rotulo);
        return true;
      }, rotulo);
    };
    const novoId = () => `x${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const ins = (o = {}) => {
      const v = {
        cliente_id: s.c, empresa_id: e.id, operacao_id: d.id, operacao_direcao: 'PAGAR', item_id: item, ordem: 9, natureza_id: e.desp.id, natureza_tipo: 'DESPESA', valor: '1', percentual: null, ...o,
      };
      return `INSERT INTO "OperacaoFinanceiraItemRateio" (id, cliente_id, empresa_id, operacao_id, operacao_direcao, item_id, ordem, natureza_id, natureza_tipo, natureza_nome, valor, percentual, "createdAt", "updatedAt")
        VALUES ('${novoId()}', '${v.cliente_id}', '${v.empresa_id}', '${v.operacao_id}', '${v.operacao_direcao}', '${v.item_id}', ${v.ordem}, '${v.natureza_id}', '${v.natureza_tipo}', 'x', ${v.valor}, ${v.percentual ?? 'NULL'}, now(), now())`;
    };
    const antes = await foto([s.c, outro.c]);
    await recusaSql(ins({ natureza_id: e.rec.id, natureza_tipo: 'RECEITA' }), /OperacaoFinanceiraItemRateio_tipo_direcao_check/, 'PAGAR × RECEITA');
    await recusaSql(ins({ natureza_id: e.rec.id }), /foreign key|natureza_fkey/i, 'tipo declarado ≠ tipo real da natureza');
    await recusaSql(ins({ operacao_direcao: 'RECEBER', natureza_id: e.rec.id, natureza_tipo: 'RECEITA' }), /foreign key|operacao_fkey/i, 'direção da linha ≠ direção do documento');
    await recusaSql(ins({ valor: '0' }), /OperacaoFinanceiraItemRateio_valores_check/, 'valor zero');
    await recusaSql(ins({ ordem: 0 }), /OperacaoFinanceiraItemRateio_valores_check/, 'ordem 0');
    await recusaSql(ins({ percentual: '0' }), /OperacaoFinanceiraItemRateio_valores_check/, 'percentual 0');
    await recusaSql(ins({ percentual: '100.000001' }), /OperacaoFinanceiraItemRateio_valores_check|numeric field overflow/, 'percentual > 100');
    await recusaSql(ins({ ordem: 1 }), /23505|unique|already exists/i, 'mesma ordem no mesmo item');
    await recusaSql(ins({ cliente_id: outro.c }), /foreign key/i, 'outro tenant apontando o documento');
    await recusaSql(ins({ item_id: dE2.itens[0].id }), /foreign key|item_fkey/i, 'item de OUTRA empresa');
    await recusaSql(ins({ natureza_id: s.e2.desp.id }), /foreign key|natureza_fkey/i, 'natureza de outra empresa');
    await recusaSql(`UPDATE "OperacaoFinanceiraItemRateio" SET centro_custo_id = '${s.e2.cc.id}' WHERE operacao_id = '${d.id}'`, /foreign key|centro_custo_fkey/i, 'centro de custo de outra empresa');
    await recusaSql(`UPDATE "OperacaoFinanceiraItemRateio" SET centro_resultado_id = '${outro.e1.cr.id}' WHERE operacao_id = '${d.id}'`, /foreign key|centro_resultado_fkey/i, 'centro de resultado de outro tenant');
    await recusaSql(`UPDATE "OperacaoFinanceira" SET direcao = 'RECEBER' WHERE id = '${d.id}'`, /foreign key|violates/i, 'trocar a direção do cabeçalho com linha por item gravada');
    await recusaSql(`DELETE FROM "OperacaoFinanceiraItem" WHERE id = '${item}'`, /foreign key|violates/i, 'apagar o item com linha por item (RESTRICT)');
    assert.equal(await foto([s.c, outro.c]), antes, 'nada mudou');
    // RLS e grants
    const [rls] = /** @type {any[]} */ (await p.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relname = 'OperacaoFinanceiraItemRateio'`);
    assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, false]);
    const grants = /** @type {any[]} */ (await p.$queryRaw`
      SELECT a.grantee::regrole::text AS grantee, a.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
       WHERE c.relname = 'OperacaoFinanceiraItemRateio'
         AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`);
    assert.deepEqual(grants, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concorrência: portão (gatilho que espera um advisory lock do teste) no INSERT
// da linha por item ou do movimento, e observação de quem espera quem.
const PORTAO = 'p302_portao';
const instalarPortao = async (s, tabela) => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(156, 1); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}') EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(156, 1)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 156 AND objid = 1 AND objsubid = 2 AND NOT granted`);
  return l.length ? l.map((r) => r.pid) : null;
};
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const acompanhar = (pedido) => {
  /** @type {{ feito: boolean, r: any, p: Promise<any> }} */
  const a = { feito: false, r: null, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => {
    Object.assign(a, { feito: true, r });
    return r;
  });
  return a;
};

describe('RI11 — concorrência focada nos pontos novos', () => {
  test('PUT × PUT no mesmo rascunho: o 1º parado no INSERT das linhas por item segura o cabeçalho; o 2º espera e recebe 409 OPERACAO_VERSAO_CONFLITO; ficam só as linhas do vencedor', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criar(s.token, docItens(e, [servico('30.00', [linha(e.desp, { valor: '30.00' })]), servico('20.00', [linha(e.desp2, { valor: '20.00' })])]));
    const vencedor = docItens(e, [servico('30.00', [linha(e.desp, { valor: '10.00' }), linha(e.desp3, { valor: '20.00' })]), servico('20.00', [linha(e.desp2, { valor: '20.00' })])]);
    const perdedor = docItens(e, [servico('50.00', [linha(e.desp3, { valor: '50.00' })])]);
    await instalarPortao(s, 'OperacaoFinanceiraItemRateio');
    /** @type {any[]} */
    const pend = [];
    let a1;
    let a2;
    try {
      await comPortaoFechado(async () => {
        a1 = acompanhar(put(s, d, vencedor));
        pend.push(a1);
        const [pid1] = await esperar(paradosNoPortao, '1º PUT parado no INSERT das linhas por item');
        a2 = acompanhar(put(s, d, perdedor));
        pend.push(a2);
        await esperar(async () => (await bloqueadosPor(pid1)).length > 0, '2º PUT esperando a trava do cabeçalho');
        assert.equal(a2.feito, false);
      });
    } finally {
      await Promise.allSettled(pend.map((x) => x.p));
      await removerPortao('OperacaoFinanceiraItemRateio');
    }
    assert.equal(a1.r.statusCode, 200, a1.r.body);
    recusa(a2.r, 409, 'OPERACAO_VERSAO_CONFLITO');
    const det = await A.detalhe(s.token, d.id, e.id);
    assert.deepEqual([det.versao, valoresDoDetalhe(det)], [2, [['10.00', '20.00'], ['20.00']]]);
    assert.equal(await linhasCoerentes(d.id), 3);
  });

  test('PUT × confirmar: o PUT parado no INSERT das linhas segura o cabeçalho; a confirmação espera e recebe 409 OPERACAO_VERSAO_CONFLITO sem efeito; confirmar × PUT: o PUT espera e recebe 409 OPERACAO_STATUS_INVALIDO; linhas, título e movimento únicos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const base = () => docItens(e, [mercadoria(s, e.sal, '10', '2.00', [linha(e.desp, { valor: '20.00' })]), servico('10.00', [linha(e.desp2, { valor: '10.00' })])]);
    // (a) PUT primeiro
    const d = await A.criar(s.token, base());
    const novo = docItens(e, [mercadoria(s, e.sal, '10', '2.00', [linha(e.desp, { valor: '15.00' }), linha(e.desp3, { valor: '5.00' })]), servico('10.00', [linha(e.desp2, { valor: '10.00' })])]);
    await instalarPortao(s, 'OperacaoFinanceiraItemRateio');
    /** @type {any[]} */
    const pend = [];
    let aPut;
    let aConf;
    try {
      await comPortaoFechado(async () => {
        aPut = acompanhar(put(s, d, novo));
        pend.push(aPut);
        const [pid] = await esperar(paradosNoPortao, 'PUT parado no INSERT das linhas por item');
        aConf = acompanhar(A.confirmarReq(s.token, d, e.id));
        pend.push(aConf);
        await esperar(async () => (await bloqueadosPor(pid)).length > 0, 'confirmação esperando a trava do cabeçalho');
      });
    } finally {
      await Promise.allSettled(pend.map((x) => x.p));
      await removerPortao('OperacaoFinanceiraItemRateio');
    }
    assert.equal(aPut.r.statusCode, 200, aPut.r.body);
    recusa(aConf.r, 409, 'OPERACAO_VERSAO_CONFLITO');
    assert.deepEqual([await p.movimentacaoEstoque.count({ where: { lancamento_origem_id: d.id } }), (await A.detalhe(s.token, d.id, e.id)).status], [0, 'RASCUNHO']);
    // (b) confirmar primeiro (parado no INSERT do movimento, já com o cabeçalho travado)
    const atual = await A.detalhe(s.token, d.id, e.id);
    await instalarPortao(s, 'MovimentacaoEstoque');
    const pend2 = [];
    let bConf;
    let bPut;
    try {
      await comPortaoFechado(async () => {
        bConf = acompanhar(A.confirmarReq(s.token, atual, e.id));
        pend2.push(bConf);
        const [pid] = await esperar(paradosNoPortao, 'confirmação parada no INSERT do movimento');
        bPut = acompanhar(put(s, atual, base()));
        pend2.push(bPut);
        await esperar(async () => (await bloqueadosPor(pid)).length > 0, 'PUT esperando a trava do cabeçalho');
      });
    } finally {
      await Promise.allSettled(pend2.map((x) => x.p));
      await removerPortao('MovimentacaoEstoque');
    }
    assert.equal(bConf.r.statusCode, 200, bConf.r.body);
    recusa(bPut.r, 409, 'OPERACAO_STATUS_INVALIDO');
    const conf = bConf.r.json();
    assert.deepEqual(valoresDoDetalhe(conf), [['15.00', '5.00'], ['10.00']], 'confirmou as linhas do PUT que venceu');
    assert.deepEqual([await p.movimentacaoEstoque.count({ where: { lancamento_origem_id: d.id } }), await p.tituloFinanceiro.count({ where: { operacao_id: d.id } }), await linhasCoerentes(d.id)], [1, 1, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RI12 — volume', () => {
  test('50 itens × 20 linhas = 1000 linhas por item (o teto do documento): rascunho, prévia e confirmação gravam exatamente 1000 linhas, cada item fechando no seu líquido', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const naturezas = [];
    for (let k = 0; k < 20; k += 1) naturezas.push(await p.naturezaFinanceira.create({ data: { cliente_id: s.c, empresa_id: e.id, numero: `7${String(k).padStart(2, '0')}`, tipo: 'DESPESA', nome: `VOLUME ${k}` } }));
    // 50 itens iguais de 20,00 e desconto de 0,01: empate de restos → o centavo cai no item 1 (líquido 19,99).
    const itens = Array.from({ length: 50 }, (_, i) => {
      const linhas = naturezas.map((n, k) => linha(n, { valor: i === 0 && k === 19 ? '0.99' : '1.00' }));
      return servico('20.00', linhas, { descricao: `SERVICO ${i}` });
    });
    const t0 = Date.now();
    const d = await A.criar(s.token, docItens(e, itens, { valor_desconto: '0.01' }));
    const msCriar = Date.now() - t0;
    assert.equal(await p.operacaoFinanceiraItemRateio.count({ where: { operacao_id: d.id } }), 1000);
    assert.deepEqual([d.valor_total, d.itens[0].valor_liquido, d.itens[1].valor_liquido], ['999.99', '19.99', '20.00']);
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual([prev.bloqueios, prev.plano.itens.reduce((t, i) => t + i.rateios.length, 0)], [[], 1000]);
    assert.equal(somaDe(prev.plano.rateio_consolidado.map((g) => g.valor)), '999.99');
    const conf = await A.confirmar(s.token, d, e.id);
    assert.deepEqual([conf.status, conf.rateio_consolidado.length, conf.rateio_consolidado[19].valor, conf.rateio_consolidado[0].valor], ['CONFIRMADO', 20, '49.99', '50.00']);
    assert.equal(await linhasCoerentes(d.id), 1000);
    assert.ok(msCriar < 15000, `rascunho com 1000 linhas em ${msCriar} ms`);
  });
});
