/**
 * D-PROD-155 (P3-01, rodada 4) — política "custo de aquisição líquido".
 *
 * Os MESMOS vetores do teste PG do backend (tests/smoke/fixtures/rateioCabecalhoVetores.json)
 * passam aqui por dois caminhos da tela:
 *  1. a função pura `ratearCabecalho` (src/lib/rateioCabecalho.js, BigInt em
 *     unidades mínimas), usada pelo formulário para apontar a linha antes de salvar;
 *  2. o backend FALSO do contrato (POST/PUT do rascunho, prévia, confirmação e
 *     detalhe), que os testes RTL e o roteiro visual usam.
 * Os dois têm de dar exatamente o resultado do vetor (comparação por valor).
 */
import { describe, it, expect } from 'vitest';
import vetores from './fixtures/rateioCabecalhoVetores.json';
import { criarEstadoLancamentos, rotearLancamentos, PERFIL_BR } from './fixtures/lancamentosFakeCore.js';
import { comparar, multiplicarArredondar, somar, subtrair } from '../../src/lib/dinheiroDecimal.js';

// Import tardio: um caminho que falha não derruba os vetores do backend falso (VET-2).
const MODULO_PURO = '../../src/lib/rateioCabecalho.js';

const CAMPOS = ['valor_total', 'valor_desconto_rateado', 'valor_acrescimo_rateado', 'valor_liquido', 'quantidade_estoque', 'custo_kg', 'residuo_custo'];

/** Igualdade POR VALOR (a escala do texto pode variar); null só bate com null. */
const mesmoValor = (obtido, esperado) => {
  if (esperado === null || esperado === undefined) return obtido === null || obtido === undefined;
  return typeof obtido === 'string' && comparar(obtido, esperado) === 0;
};

const conferirItens = (obtidos, esperados, onde) => {
  expect(obtidos, `${onde}: quantidade de itens`).toHaveLength(esperados.length);
  esperados.forEach((esp, k) => {
    const item = obtidos.find((i) => i.ordem === esp.ordem) ?? obtidos[k];
    for (const campo of CAMPOS) {
      expect(mesmoValor(item?.[campo], esp[campo]), `${onde}: item ${esp.ordem}.${campo} = ${item?.[campo]} (esperado ${esp[campo]})`).toBe(true);
    }
  });
};

const conferirDetails = (obtido, esperado, onde) => {
  for (const [chave, valor] of Object.entries(esperado)) {
    if (typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor)) expect(mesmoValor(obtido?.[chave], valor), `${onde}: details.${chave} = ${obtido?.[chave]} (esperado ${valor})`).toBe(true);
    else expect(obtido?.[chave], `${onde}: details.${chave}`).toEqual(valor);
  }
};

const subtotalDe = (it, casas) => multiplicarArredondar(it.quantidade, it.valor_unitario, casas);

/** Documento DOC do vetor (produto de saco com o peso do vetor; KG usa o produto pr2). */
const montarCaso = (caso) => {
  const casas = caso.casas;
  const pagar = caso.direcao === 'PAGAR';
  const perfil = { ...PERFIL_BR, pais: caso.perfil.pais, moeda: caso.perfil.moeda, locale: caso.perfil.locale, moeda_casas: casas };
  const estado = criarEstadoLancamentos({ perfil });
  const itens = caso.itens.map((it, k) => {
    if (it.tipo_item === 'SERVICO') return { tipo_item: 'SERVICO', unidade: it.unidade, descricao: it.descricao ?? 'SERVIÇO', quantidade: it.quantidade, valor_unitario: it.valor_unitario };
    let produto = 'pr2';
    if (it.unidade === 'SACO') {
      produto = `pv-saco-${k}`;
      estado.produtosExtras.push({ id: produto, numero: String(90 + k), nome: `SACO ${it.peso_por_saco_kg} KG`, unidade_principal_estoque: 'SACO', peso_por_saco_kg: it.peso_por_saco_kg, estoque_atual: '0.0000' });
    }
    return { tipo_item: 'MERCADORIA', produto_id: produto, local_estoque_id: 'lo1', unidade: it.unidade, quantidade: it.quantidade, valor_unitario: it.valor_unitario };
  });
  const bruto = somar(caso.itens.map((it) => subtotalDe(it, casas)), casas);
  const total = somar([subtrair(bruto, caso.valor_desconto, casas), caso.valor_acrescimo], casas);
  const corpo = {
    empresa_id: 'emp-1',
    direcao: caso.direcao,
    conteudo: 'COM_PRODUTOS',
    condicao: 'AVISTA',
    parceiro_id: pagar ? 'pa1' : 'pa2',
    data_emissao: '2026-11-08',
    data_operacional: '2026-11-08',
    efeito_fisico_confirmado: true,
    valor_desconto: caso.valor_desconto,
    valor_acrescimo: caso.valor_acrescimo,
    itens,
    rateio_modo: 'VALOR',
    rateios: [{ natureza_id: pagar ? 'nd1' : 'nr1', valor: total }],
    parcelas: [{ vencimento: '2026-11-08', valor: total }],
    operation_id: `op-${caso.id}`,
  };
  return { estado, corpo, total, casas };
};

const chamar = (estado, method, path, body = null) => rotearLancamentos(estado, { method, path, query: new URLSearchParams(), body });

describe('VET-1 — vetores compartilhados: função pura da tela (BigInt)', () => {
  for (const caso of vetores.casos) {
    it(`${caso.id}`, async () => {
      const { ratearCabecalho } = await import(/* @vite-ignore */ MODULO_PURO);
      const casas = caso.casas;
      const r = ratearCabecalho({
        direcao: caso.direcao,
        casas,
        valor_desconto: caso.valor_desconto,
        valor_acrescimo: caso.valor_acrescimo,
        itens: caso.itens.map((it, k) => ({
          ordem: k + 1,
          tipo_item: it.tipo_item,
          valor_total: subtotalDe(it, casas),
          quantidade_estoque: it.tipo_item === 'MERCADORIA' ? multiplicarArredondar(it.quantidade, it.unidade === 'SACO' ? it.peso_por_saco_kg : '1', 4) : null,
        })),
      });
      if (caso.esperado.erro) {
        const e = caso.esperado.erro;
        expect(r.erro, 'deveria recusar').toBeTruthy();
        expect(r.erro.reason).toBe(e.reason);
        expect(r.erro.field).toBe(e.field);
        conferirDetails(r.erro.details, e.details, 'pura');
        return;
      }
      expect(r.erro).toBeNull();
      const esperadosSemSubtotal = caso.esperado.itens.map(({ quantidade_estoque: _q, valor_total: _v, ...x }) => ({ ...x }));
      esperadosSemSubtotal.forEach((esp, k) => {
        for (const campo of ['valor_desconto_rateado', 'valor_acrescimo_rateado', 'valor_liquido', 'custo_kg', 'residuo_custo']) {
          expect(mesmoValor(r.itens[k][campo], esp[campo]), `pura: item ${esp.ordem}.${campo} = ${r.itens[k][campo]} (esperado ${esp[campo]})`).toBe(true);
        }
      });
      expect(mesmoValor(r.residuo_total, caso.esperado.residuo_total), `residuo_total = ${r.residuo_total}`).toBe(true);
      // Σ líquido = total do documento, exato na escala da moeda.
      expect(comparar(somar(r.itens.map((i) => i.valor_liquido), casas), caso.esperado.valor_total)).toBe(0);
    });
  }
});

describe('VET-2 — vetores compartilhados: backend falso (rascunho, prévia, confirmação, detalhe)', () => {
  for (const caso of vetores.casos) {
    it(`${caso.id}`, async () => {
      const { estado, corpo, casas } = montarCaso(caso);
      const criado = await chamar(estado, 'POST', '/operacoes-financeiras', corpo);
      if (caso.esperado.erro) {
        const e = caso.esperado.erro;
        expect(criado.status, 'o rascunho é recusado como no backend real').toBe(e.status);
        expect(criado.body.code).toBe(e.code);
        expect(criado.body.reason).toBe(e.reason);
        expect(criado.body.field).toBe(e.field);
        conferirDetails(criado.body.details, e.details, 'POST');
        expect(estado.documentos).toHaveLength(0);
        return;
      }
      expect(criado.status).toBe(201);
      expect(comparar(criado.body.valor_bruto, caso.esperado.valor_bruto)).toBe(0);
      expect(comparar(criado.body.valor_total, caso.esperado.valor_total)).toBe(0);
      conferirItens(criado.body.itens, caso.esperado.itens, 'rascunho');

      const previa = await chamar(estado, 'POST', `/operacoes-financeiras/${criado.body.id}/previa`, {});
      expect(previa.status).toBe(200);
      const { plano, bloqueios } = previa.body;
      expect(bloqueios).toEqual([]);
      conferirItens(plano.itens, caso.esperado.itens, 'prévia');
      expect(plano.avisos.map((a) => a.codigo)).toEqual(caso.esperado.avisos);
      expect(plano.avisos.map((a) => a.codigo)).not.toContain('custo_sem_desconto_acrescimo');
      const avisoResiduo = plano.avisos.find((a) => a.codigo === 'residuo_custo_estoque');
      if (avisoResiduo) expect(mesmoValor(avisoResiduo.residuo_total, caso.esperado.residuo_total)).toBe(true);
      expect(comparar(somar(plano.itens.map((i) => i.valor_liquido), casas), plano.valor_total)).toBe(0);
      // Mesmo formato do servidor: chaves EXATAS de entradas e saídas (sem campo
      // a mais que a tela pudesse usar e o backend real não manda).
      const chaves = vetores.formato.efeitos_estoque_chaves;
      for (const entrada of plano.efeitos_estoque.entradas) expect(Object.keys(entrada).sort(), 'chaves da entrada').toEqual([...chaves.entradas].sort());
      for (const saida of plano.efeitos_estoque.saidas) expect(Object.keys(saida).sort(), 'chaves da saída').toEqual([...chaves.saidas].sort());
      expect(plano.efeitos_estoque.entradas.length + plano.efeitos_estoque.saidas.length, 'um efeito por mercadoria').toBe(caso.itens.filter((i) => i.tipo_item === 'MERCADORIA').length);
      // Entrada de estoque: o efeito leva o custo LÍQUIDO por kg (como `planejarOperacao`).
      for (const entrada of plano.efeitos_estoque.entradas) {
        const esp = caso.esperado.itens.find((i) => i.ordem === entrada.item_ordem);
        expect(mesmoValor(entrada.custo_kg, esp.custo_kg)).toBe(true);
      }

      const confirmado = await chamar(estado, 'POST', `/operacoes-financeiras/${criado.body.id}/confirmar`, { operation_id: `conf-${caso.id}`, versao: criado.body.versao, baixa_no_ato: null });
      expect(confirmado.status).toBe(200);
      const detalhe = await chamar(estado, 'GET', `/operacoes-financeiras/${criado.body.id}`);
      conferirItens(detalhe.body.itens, caso.esperado.itens, 'detalhe confirmado');
    });
  }

  it('PUT do rascunho com política violada também é recusado (422 com a linha) e não altera o rascunho', async () => {
    const caso = vetores.casos.find((c) => c.esperado.erro?.reason === 'custo_kg_nao_representavel');
    const valido = vetores.casos.find((c) => c.id === 'brl_compra_desconto_saco');
    const base = montarCaso(valido);
    const criado = await chamar(base.estado, 'POST', '/operacoes-financeiras', base.corpo);
    expect(criado.status).toBe(201);
    const ruim = montarCaso(caso);
    base.estado.produtosExtras.push(...ruim.estado.produtosExtras);
    const { operation_id: _op, ...corpoRuim } = ruim.corpo;
    const r = await chamar(base.estado, 'PUT', `/operacoes-financeiras/${criado.body.id}`, { ...corpoRuim, versao: criado.body.versao });
    expect(r.status).toBe(422);
    expect(r.body.reason).toBe('custo_kg_nao_representavel');
    conferirDetails(r.body.details, caso.esperado.erro.details, 'PUT');
    expect(base.estado.documentos[0].versao).toBe(criado.body.versao);
  });
});

describe('VET-3 — ordem da recusa igual à do servidor (linha a linha: líquido, depois custo)', () => {
  it('linha 1 com custo não representável e linha 2 com líquido zero: volta a linha 1 (a primeira recusada)', async () => {
    const { ratearCabecalho } = await import(/* @vite-ignore */ MODULO_PURO);
    // 2,50 (20.000 kg) + 0,01; desconto 2,51 → 2,50 + 0,01; acréscimo 1,20 → 1,20 + 0,00 (sobra ao maior resto).
    // Líquidos 1,20 e 0,00: a linha 1 dá 0,0001/kg (resíduo −0,80) e a linha 2 fica zerada.
    const r = ratearCabecalho({
      direcao: 'PAGAR',
      casas: 2,
      valor_desconto: '2.51',
      valor_acrescimo: '1.20',
      itens: [
        { ordem: 1, tipo_item: 'MERCADORIA', valor_total: '2.50', quantidade_estoque: '20000.0000' },
        { ordem: 2, tipo_item: 'MERCADORIA', valor_total: '0.01', quantidade_estoque: '1.0000' },
      ],
    });
    expect(r.itens.map((i) => i.valor_liquido)).toEqual(['1.20', '0.00']);
    expect(r.erro.reason).toBe('custo_kg_nao_representavel');
    expect(r.erro.details).toMatchObject({ indice: 0, item_ordem: 1, custo_kg: '0.0001', residuo_custo: '-0.80000000' });
  });
});
