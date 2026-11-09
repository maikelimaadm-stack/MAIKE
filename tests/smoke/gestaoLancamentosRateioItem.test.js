/**
 * D-PROD-156 (P3-02) — rateio gerencial POR ITEM, do lado da tela, sem float.
 *
 *  RI-1  conta pura (src/lib/rateioPorItem.js): PERCENTUAL pelos maiores restos
 *        sobre o LÍQUIDO do item (BRL 2, PYG 0, KWD 3; empate → menor ordem),
 *        VALOR exato, linha repetida no MESMO item, inicialização proporcional e
 *        resumo consolidado por natureza/centros (Σ = total, sem duplicar).
 *  RI-2  modelo do formulário (lancamentoModelo.js): escopo GERAL|POR_ITEM,
 *        estado preso à CHAVE estável do item (reordenar/remover leva junto),
 *        erros apontando item e linha, corpo DOC (rateio_escopo sempre).
 *  RI-3  mensagens dos reasons novos (gestaoErros.js) com item e linha.
 *  RI-4  backend FALSO espelhando o contrato do SPEC §3–§5.
 *  RI-5  paridade com o backend: tests/smoke/fixtures/rateioPorItemVetores.json.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { comparar, multiplicarArredondar, somar } from '@/lib/dinheiroDecimal';
import { ratearCabecalho } from '@/lib/rateioCabecalho';
import {
  MAX_RATEIOS_POR_ITEM,
  consolidarRateio,
  distribuirProporcional,
  escopoDoRateio,
  planejarRateioDoItem,
} from '@/lib/rateioPorItem';
import {
  alvoDoErroDoRateioPorItem,
  calcularResumo,
  classificacaoParaTodos,
  formularioDoDetalhe,
  formularioVazio,
  inicializacaoProporcional,
  itemVazio,
  linhasDoItem,
  montarDocumento,
  moverItemDoFormulario,
  rateioVazio,
  removerItemDoFormulario,
  temDadosPorItem,
  adicionarItemAoFormulario,
} from '@/components/financeiroGestao/lancamentoModelo';
import { mensagemErroGestao, mensagemDoBloqueio } from '@/lib/gestaoErros';
import { criarEstadoLancamentos, rotearLancamentos, semearDocumento, PERFIL_BR } from './fixtures/lancamentosFakeCore.js';

const CTX = { locale: 'pt-BR', casas: 2, hoje: '2026-11-08', moeda: 'BRL' };
const NAT = {
  nd1: { id: 'nd1', rotulo: 'INSUMOS / NUTRIÇÃO' },
  nd2: { id: 'nd2', rotulo: 'INSUMOS / SANIDADE' },
  nd3: { id: 'nd3', rotulo: 'ENERGIA ELÉTRICA' },
};
const CC1 = { id: 'cc1', rotulo: 'CRIA' };
const CC2 = { id: 'cc2', rotulo: 'RECRIA' };

/** Linha do formulário (texto digitado). */
const linha = (natureza, extra = {}) => ({ ...rateioVazio(), natureza, ...extra });

/** Compra: milho 100 kg × 6,00 (600,00) + frete 1 × 400,00. */
const formCompra = (extra = {}) => {
  const f = formularioVazio({ hoje: '2026-11-08' });
  Object.assign(f, {
    conteudo: 'COM_PRODUTOS',
    parceiro: { id: 'pa1', rotulo: 'AGROPECUÁRIA BOA VISTA' },
    data_operacional: '2026-11-08',
    efeito_fisico_confirmado: true,
    itens: [
      { ...itemVazio('MERCADORIA'), produto: { id: 'pr2', rotulo: 'MILHO MOÍDO' }, local: { id: 'lo1', rotulo: 'DEPÓSITO SEDE' }, quantidade: '100', valor_unitario: '6' },
      { ...itemVazio('SERVICO'), descricao: 'FRETE', quantidade: '1', valor_unitario: '400' },
    ],
  });
  f.rateios = [linha(NAT.nd1)];
  return Object.assign(f, extra);
};

/** A mesma compra no modo POR_ITEM: milho 100% NUTRIÇÃO; frete 250 SANIDADE/CRIA + 150 ENERGIA. */
const formPorItem = (extra = {}) => {
  const f = formCompra();
  f.rateio_escopo = 'POR_ITEM';
  f.rateios_itens = {
    [f.itens[0].chave]: [linha(NAT.nd1)],
    [f.itens[1].chave]: [linha(NAT.nd2, { centro_custo: CC1, valor: '250,00' }), linha(NAT.nd3, { valor: '150,00' })],
  };
  return Object.assign(f, extra);
};

describe('RI-1 — conta pura do rateio por item (BigInt, maiores restos)', () => {
  it('PERCENTUAL em BRL, PYG e KWD: piso + maior resto sobre o LÍQUIDO do item; Σ = líquido exato', () => {
    const brl = planejarRateioDoItem({ modo: 'PERCENTUAL', liquido: '100.00', casas: 2, linhas: [{ percentual: '33.333333' }, { percentual: '33.333333' }, { percentual: '33.333334' }] });
    expect(brl.erro).toBeNull();
    expect(brl.valores).toEqual(['33.33', '33.33', '33.34']);
    const pyg = planejarRateioDoItem({ modo: 'PERCENTUAL', liquido: '1000', casas: 0, linhas: [{ percentual: '33.333333' }, { percentual: '33.333333' }, { percentual: '33.333334' }] });
    expect(pyg.valores).toEqual(['333', '333', '334']);
    const kwd = planejarRateioDoItem({ modo: 'PERCENTUAL', liquido: '10.000', casas: 3, linhas: [{ percentual: '33.333333' }, { percentual: '66.666667' }] });
    expect(kwd.valores).toEqual(['3.333', '6.667']);
    for (const [r, liq, casas] of [[brl, '100.00', 2], [pyg, '1000', 0], [kwd, '10.000', 3]]) expect(comparar(somar(r.valores, casas), liq)).toBe(0);
  });

  it('empate de resto: a unidade vai para a MENOR ordem; a linha que fica zero é recusada com o subíndice', () => {
    const r = planejarRateioDoItem({ modo: 'PERCENTUAL', liquido: '0.01', casas: 2, linhas: [{ percentual: '50' }, { percentual: '50' }] });
    expect(r.valores).toEqual(['0.01', '0.00']);
    expect(r.erro).toMatchObject({ reason: 'valor_linha_zero', field: 'percentual', subindice: 1 });
  });

  it('PERCENTUAL que não soma 100 e VALOR que não fecha com o líquido: soma_diferente com esperado/informado/diferença', () => {
    const p = planejarRateioDoItem({ modo: 'PERCENTUAL', liquido: '100.00', casas: 2, linhas: [{ percentual: '60' }, { percentual: '30' }] });
    expect(p.erro).toMatchObject({ reason: 'soma_diferente', field: 'rateios', details: { modo: 'PERCENTUAL', esperado: '100.000000', informado: '90.000000', diferenca: '10.000000' } });
    const v = planejarRateioDoItem({ modo: 'VALOR', liquido: '400.00', casas: 2, linhas: [{ valor: '250.00' }, { valor: '149.99' }] });
    expect(v.erro).toMatchObject({ reason: 'soma_diferente', details: { modo: 'VALOR', esperado: '400.00', informado: '399.99', diferenca: '0.01' } });
    expect(v.erro.subindice).toBeUndefined();
    const zero = planejarRateioDoItem({ modo: 'VALOR', liquido: '400.00', casas: 2, linhas: [{ valor: '400.00' }, { valor: '0.00' }] });
    expect(zero.erro).toMatchObject({ reason: 'valor_linha_zero', field: 'valor', subindice: 1 });
    const ok = planejarRateioDoItem({ modo: 'VALOR', liquido: '400.00', casas: 2, linhas: [{ valor: '250.00' }, { valor: '150.00' }] });
    expect(ok).toMatchObject({ erro: null, fecha: true, valores: ['250.00', '150.00'], percentuais: ['62.500000', '37.500000'] });
  });

  it('linha repetida (mesma natureza e centros) só vale DENTRO do item', () => {
    const r = planejarRateioDoItem({
      modo: 'VALOR', liquido: '10.00', casas: 2,
      linhas: [{ natureza_id: 'nd1', centro_custo_id: 'cc1', valor: '5.00' }, { natureza_id: 'nd1', centro_custo_id: 'cc2', valor: '2.00' }, { natureza_id: 'nd1', centro_custo_id: 'cc1', valor: '3.00' }],
    });
    expect(r.erro).toMatchObject({ reason: 'linha_duplicada', field: 'natureza_id', subindice: 2, details: { repete_subindice: 0 } });
    expect(MAX_RATEIOS_POR_ITEM).toBe(20);
  });

  it('inicialização proporcional: as MESMAS proporções do geral sobre o líquido do item (maiores restos, empate → menor ordem)', () => {
    expect(distribuirProporcional({ liquido: '100.00', pesos: ['600.00', '400.00'], casas: 2, casasPeso: 2 })).toEqual(['60.00', '40.00']);
    expect(distribuirProporcional({ liquido: '10.00', pesos: ['1', '1', '1'], casas: 2, casasPeso: 0 })).toEqual(['3.34', '3.33', '3.33']);
    expect(distribuirProporcional({ liquido: '7', pesos: ['33.333333', '66.666667'], casas: 0, casasPeso: 6 })).toEqual(['2', '5']);
    expect(distribuirProporcional({ liquido: '0.00', pesos: ['1'], casas: 2, casasPeso: 0 })).toBeNull();
  });

  it('consolidado: soma por (natureza, CC, CR) na ordem da 1ª aparição, % sobre o total com 6 casas, Σ = total (sem duplicar)', () => {
    const c = consolidarRateio(
      [
        { natureza_id: 'nd1', natureza_nome: 'NUTRIÇÃO', valor: '600.00' },
        { natureza_id: 'nd2', natureza_nome: 'SANIDADE', centro_custo_id: 'cc1', centro_custo_nome: 'CRIA', valor: '250.00' },
        { natureza_id: 'nd1', natureza_nome: 'NUTRIÇÃO', valor: '50.00' },
        { natureza_id: 'nd2', natureza_nome: 'SANIDADE', valor: '100.00' },
      ],
      '1000.00',
      2,
    );
    expect(c).toEqual([
      { natureza_id: 'nd1', natureza_nome: 'NUTRIÇÃO', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: null, centro_resultado_nome: null, valor: '650.00', percentual: '65.000000' },
      { natureza_id: 'nd2', natureza_nome: 'SANIDADE', centro_custo_id: 'cc1', centro_custo_nome: 'CRIA', centro_resultado_id: null, centro_resultado_nome: null, valor: '250.00', percentual: '25.000000' },
      { natureza_id: 'nd2', natureza_nome: 'SANIDADE', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: null, centro_resultado_nome: null, valor: '100.00', percentual: '10.000000' },
    ]);
    expect(somar(c.map((l) => l.valor), 2)).toBe('1000.00');
  });

  it('escopo ausente/NULL (documento da P3-01) é GERAL', () => {
    expect(escopoDoRateio(undefined)).toBe('GERAL');
    expect(escopoDoRateio(null)).toBe('GERAL');
    expect(escopoDoRateio('GERAL')).toBe('GERAL');
    expect(escopoDoRateio('POR_ITEM')).toBe('POR_ITEM');
  });
});

describe('RI-2 — modelo do formulário no escopo POR_ITEM', () => {
  it('formulário novo e rascunho antigo (sem rateio_escopo) abrem como GERAL', () => {
    expect(formularioVazio({ hoje: '2026-11-08' })).toMatchObject({ rateio_escopo: 'GERAL', rateios_itens: {} });
    const antigo = { id: 'op1', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', itens: [{ ordem: 1, tipo_item: 'SERVICO', descricao: 'FRETE', quantidade: '1', valor_unitario: '10' }], rateio_modo: 'VALOR', rateios: [{ natureza_id: 'nd1', natureza_nome: 'N', valor: '10.00' }] };
    const f = formularioDoDetalhe(antigo, { locale: 'pt-BR', casas: 2, hoje: '2026-11-08' });
    expect(f.rateio_escopo).toBe('GERAL');
    expect(f.rateios_itens).toEqual({});
    expect(f.rateios[0].natureza).toEqual({ id: 'nd1', rotulo: 'N' });
  });

  it('rascunho POR_ITEM do servidor: as linhas ficam presas à chave estável de cada item', () => {
    const d = {
      id: 'op1', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', rateio_escopo: 'POR_ITEM', rateio_modo: 'VALOR', rateios: [],
      itens: [
        { ordem: 1, tipo_item: 'SERVICO', descricao: 'A', quantidade: '1', valor_unitario: '10', rateios: [{ ordem: 1, natureza_id: 'nd1', natureza_nome: 'NUTRIÇÃO', valor: '10.00' }] },
        { ordem: 2, tipo_item: 'SERVICO', descricao: 'B', quantidade: '1', valor_unitario: '5', rateios: [{ ordem: 1, natureza_id: 'nd2', natureza_nome: 'SANIDADE', centro_custo_id: 'cc1', centro_custo_nome: 'CRIA', valor: '2.00' }, { ordem: 2, natureza_id: 'nd3', natureza_nome: 'ENERGIA', valor: '3.00' }] },
      ],
    };
    const f = formularioDoDetalhe(d, { locale: 'pt-BR', casas: 2, hoje: '2026-11-08' });
    expect(f.rateio_escopo).toBe('POR_ITEM');
    expect(Object.keys(f.rateios_itens)).toEqual(f.itens.map((i) => i.chave));
    expect(linhasDoItem(f, f.itens[1].chave).map((l) => [l.natureza.id, l.centro_custo?.id ?? null, l.valor])).toEqual([['nd2', 'cc1', '2,00'], ['nd3', null, '3,00']]);
    expect(f.rateios).toHaveLength(1); // o geral fica com a linha vazia de sempre
  });

  it('VALOR: uma linha = 100% do LÍQUIDO automático; várias linhas mostram a diferença por item e no total', () => {
    const f = formPorItem();
    const r = calcularResumo(f, CTX);
    const [milho, frete] = r.rateioItens.porItem;
    expect(milho).toMatchObject({ chave: f.itens[0].chave, liquido: '600.00', valores: ['600.00'], fecha: true });
    expect(frete).toMatchObject({ liquido: '400.00', valores: ['250.00', '150.00'], diferenca: '0.00', fecha: true });
    expect(r.rateioItens).toMatchObject({ fecha: true, diferencaTotal: '0.00', totalLinhas: 3, problemas: [] });
    expect(r.valido).toBe(true);
    f.rateios_itens[f.itens[1].chave][1].valor = '149,99';
    const r2 = calcularResumo(f, CTX);
    expect(r2.rateioItens.porItem[1].diferenca).toBe('0.01');
    expect(r2.rateioItens.diferencaTotal).toBe('0.01');
    expect(r2.erros['itens.1.rateio']).toMatch(/líquido do item/);
    expect(r2.rateioItens.fecha).toBe(false);
    expect(r2.rateioItens.problemas[0]).toMatchObject({ chave: 'itens.1.rateio', item: 1, linha: null });
  });

  it('base é o LÍQUIDO (desconto e acréscimo rateados como o servidor), não o subtotal', () => {
    const f = formPorItem({ valor_desconto: '100,00' });
    // desconto 100 rateado 60/40 → milho 540, frete 360
    f.rateios_itens[f.itens[1].chave] = [linha(NAT.nd2, { valor: '200,00' }), linha(NAT.nd3, { valor: '160,00' })];
    const r = calcularResumo(f, CTX);
    expect(r.rateioItens.porItem.map((i) => i.liquido)).toEqual(['540.00', '360.00']);
    expect(r.rateioItens.fecha).toBe(true);
    expect(r.total).toBe('900.00');
  });

  it('PERCENTUAL: soma 100 por item, valores pelos maiores restos; linha zerada e linha sem natureza apontam item e linha', () => {
    const f = formPorItem({ rateio_modo: 'PERCENTUAL' });
    f.rateios_itens[f.itens[1].chave] = [linha(NAT.nd2, { percentual: '33,333333' }), linha(NAT.nd3, { percentual: '66,666667' })];
    const r = calcularResumo(f, CTX);
    expect(r.rateioItens.porItem[0].valores).toEqual(['600.00']);
    expect(r.rateioItens.porItem[1].valores).toEqual(['133.33', '266.67']);
    expect(r.rateioItens.fecha).toBe(true);
    f.rateios_itens[f.itens[1].chave] = [linha(null, { percentual: '60' }), linha(NAT.nd3, { percentual: '30' })];
    const r2 = calcularResumo(f, CTX);
    expect(r2.erros['itens.1.rateios.0.natureza']).toBe('Escolha a natureza');
    expect(r2.erros['itens.1.rateio']).toMatch(/somar exatamente 100%/);
    expect(r2.rateioItens.porItem[1].somaPercentual).toBe('90.000000');
  });

  it('item sem linha, linha repetida no MESMO item e mais de 20 linhas são apontados; em itens diferentes repetir é permitido', () => {
    const f = formPorItem();
    f.rateios_itens[f.itens[1].chave] = [];
    let r = calcularResumo(f, CTX);
    expect(r.erros['itens.1.rateio']).toMatch(/pelo menos uma linha/);
    f.rateios_itens[f.itens[1].chave] = [linha(NAT.nd1, { valor: '200,00' }), linha(NAT.nd1, { valor: '200,00' })];
    r = calcularResumo(f, CTX);
    expect(r.erros['itens.1.rateios.1.natureza']).toMatch(/Linha repetida \(igual à linha 1\)/);
    expect(Object.keys(r.erros).some((k) => k.startsWith('itens.0.'))).toBe(false); // nd1 no item 1 também: permitido
    f.rateios_itens[f.itens[1].chave] = Array.from({ length: 21 }, () => linha(NAT.nd1, { valor: '1,00' }));
    r = calcularResumo(f, CTX);
    expect(r.erros['itens.1.rateio']).toMatch(/No máximo 20 linhas/);
  });

  it('corpo DOC: rateio_escopo SEMPRE; GERAL leva o rateio no topo e itens sem rateios; POR_ITEM leva [] no topo e itens[].rateios', () => {
    const geral = formCompra();
    const rg = calcularResumo(geral, CTX);
    const docGeral = montarDocumento(geral, rg);
    expect(docGeral).toMatchObject({ rateio_escopo: 'GERAL', rateio_modo: 'VALOR', rateios: [{ natureza_id: 'nd1', valor: '1000.00' }] });
    expect(docGeral.itens.every((i) => !('rateios' in i))).toBe(true);
    const semProdutos = formularioVazio({ hoje: '2026-11-08' });
    semProdutos.valor_bruto = '10';
    expect(montarDocumento(semProdutos, calcularResumo(semProdutos, CTX)).rateio_escopo).toBe('GERAL');

    const f = formPorItem();
    const doc = montarDocumento(f, calcularResumo(f, CTX));
    expect(doc.rateio_escopo).toBe('POR_ITEM');
    expect(doc.rateios).toEqual([]);
    expect(doc.itens.map((i) => i.rateios)).toEqual([
      [{ natureza_id: 'nd1', valor: '600.00' }],
      [{ natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '250.00' }, { natureza_id: 'nd3', valor: '150.00' }],
    ]);
    const fp = formPorItem({ rateio_modo: 'PERCENTUAL' });
    fp.rateios_itens[fp.itens[1].chave] = [linha(NAT.nd2, { percentual: '62,5' }), linha(NAT.nd3, { percentual: '37,5' })];
    const docP = montarDocumento(fp, calcularResumo(fp, CTX));
    expect(docP.itens.map((i) => i.rateios)).toEqual([[{ natureza_id: 'nd1', percentual: '100' }], [{ natureza_id: 'nd2', percentual: '62.5' }, { natureza_id: 'nd3', percentual: '37.5' }]]);
  });

  it('reordenar leva as linhas junto (chave, nunca índice); remover o item remove as linhas dele', () => {
    const f = formPorItem();
    const [milho, frete] = f.itens.map((i) => i.chave);
    const movido = moverItemDoFormulario(f, 1, -1);
    expect(movido.itens.map((i) => i.chave)).toEqual([frete, milho]);
    const doc = montarDocumento(movido, calcularResumo(movido, CTX));
    expect(doc.itens[0]).toMatchObject({ tipo_item: 'SERVICO', rateios: [{ natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '250.00' }, { natureza_id: 'nd3', valor: '150.00' }] });
    expect(doc.itens[1]).toMatchObject({ tipo_item: 'MERCADORIA', rateios: [{ natureza_id: 'nd1', valor: '600.00' }] });
    expect(moverItemDoFormulario(f, 0, -1)).toBe(f); // fora dos limites: nada muda
    const removido = removerItemDoFormulario(f, 0);
    expect(removido.itens.map((i) => i.chave)).toEqual([frete]);
    expect(Object.keys(removido.rateios_itens)).toEqual([frete]);
    const comNovo = adicionarItemAoFormulario(f, 'SERVICO');
    const novaChave = comNovo.itens[2].chave;
    expect(linhasDoItem(comNovo, novaChave)).toHaveLength(1); // POR_ITEM: item novo nasce com 1 linha vazia
    expect(adicionarItemAoFormulario(formCompra(), 'SERVICO').rateios_itens).toEqual({});
  });

  it('GERAL → POR_ITEM proporcional: mesmas naturezas e proporções do geral sobre o líquido; o geral não muda', () => {
    const f = formCompra();
    f.rateios = [linha(NAT.nd1, { valor: '700,00' }), linha(NAT.nd2, { centro_custo: CC2, valor: '300,00' })];
    const r = calcularResumo(f, CTX);
    const ini = inicializacaoProporcional(f, r, CTX);
    expect(ini.possivel).toBe(true);
    const comItens = { ...f, rateio_escopo: 'POR_ITEM', rateios_itens: ini.rateios_itens };
    expect(linhasDoItem(comItens, f.itens[0].chave).map((l) => [l.natureza.id, l.centro_custo?.id ?? null, l.valor])).toEqual([['nd1', null, '420,00'], ['nd2', 'cc2', '180,00']]);
    expect(linhasDoItem(comItens, f.itens[1].chave).map((l) => l.valor)).toEqual(['280,00', '120,00']);
    expect(calcularResumo(comItens, CTX).rateioItens.fecha).toBe(true);
    expect(f.rateios.map((l) => l.valor)).toEqual(['700,00', '300,00']);
    // Geral incompleto (não fecha): só "começar em branco".
    f.rateios[1].valor = '200,00';
    const sem = inicializacaoProporcional(f, calcularResumo(f, CTX), CTX);
    expect(sem.possivel).toBe(false);
    expect(sem.motivo).toMatch(/rateio geral/i);
  });

  it('GERAL → POR_ITEM proporcional em PERCENTUAL copia os percentuais; "aplicar a todos" deixa 1 linha de 100% por item', () => {
    const f = formCompra({ rateio_modo: 'PERCENTUAL' });
    f.rateios = [linha(NAT.nd1, { percentual: '75' }), linha(NAT.nd2, { percentual: '25' })];
    const ini = inicializacaoProporcional(f, calcularResumo(f, CTX), CTX);
    expect(ini.possivel).toBe(true);
    const g = { ...f, rateio_escopo: 'POR_ITEM', rateios_itens: ini.rateios_itens };
    expect(linhasDoItem(g, f.itens[0].chave).map((l) => l.percentual)).toEqual(['75', '25']);
    expect(calcularResumo(g, CTX).rateioItens.porItem[0].valores).toEqual(['450.00', '150.00']);
    const todos = classificacaoParaTodos(g, { natureza: NAT.nd3, centro_custo: CC1, centro_resultado: null });
    const h = { ...g, rateios_itens: todos };
    expect(h.itens.map((i) => linhasDoItem(h, i.chave).map((l) => [l.natureza.id, l.centro_custo.id]))).toEqual([[['nd3', 'cc1']], [['nd3', 'cc1']]]);
    expect(calcularResumo(h, CTX).rateioItens.porItem.map((i) => i.valores)).toEqual([['600.00'], ['400.00']]);
    expect(temDadosPorItem(h)).toBe(true);
    expect(temDadosPorItem({ ...h, rateios_itens: { [h.itens[0].chave]: [rateioVazio()] } })).toBe(false);
  });

  it('erro do servidor com indice + subindice vira o alvo exato (item, linha e campo)', () => {
    expect(alvoDoErroDoRateioPorItem({ field: 'natureza_id', details: { colecao: 'itens', indice: 1, subcolecao: 'rateios', subindice: 0 } })).toEqual({ indice: 1, subindice: 0, campo: 'natureza' });
    expect(alvoDoErroDoRateioPorItem({ field: 'centro_custo_id', details: { colecao: 'itens', indice: 0, subcolecao: 'rateios', subindice: 2 } })).toEqual({ indice: 0, subindice: 2, campo: 'centro_custo' });
    expect(alvoDoErroDoRateioPorItem({ field: 'rateios', details: { colecao: 'itens', indice: 2, subcolecao: 'rateios' } })).toEqual({ indice: 2, subindice: null, campo: 'rateio' });
    expect(alvoDoErroDoRateioPorItem({ field: 'valor', details: { colecao: 'rateios', indice: 0 } })).toBeNull();
    expect(alvoDoErroDoRateioPorItem({ field: 'valor_unitario', details: { colecao: 'itens', indice: 0 } })).toBeNull();
  });
});

describe('RI-3 — mensagens dos reasons novos apontam item e linha', () => {
  const c = { locale: 'pt-BR', moeda: 'BRL', casas: 2 };
  const e = (reason, details = {}, field = 'rateios') => ({ cause: { code: 'OPERACAO_RATEIO_INVALIDO', field, reason, details: { field, reason, ...details } } });
  const naLinha = { colecao: 'itens', indice: 1, subcolecao: 'rateios', subindice: 2 };
  const noItem = { colecao: 'itens', indice: 1, subcolecao: 'rateios' };

  it.each([
    ['escopo_invalido', {}, /escopo do rateio é inválido/i],
    ['escopo_por_item_exige_produtos', {}, /rateio por item só existe no lançamento com produtos/i],
    ['rateio_geral_e_por_item', {}, /rateio geral e rateio por item ao mesmo tempo/i],
    ['rateio_geral_obrigatorio', {}, /rateio geral precisa de pelo menos uma linha/i],
    ['item_sem_rateio', noItem, /item 2.*sem classificação/i],
    ['rateio_item_excede_limite', { ...noItem, limite: 20 }, /item 2.*20 linhas/i],
    ['rateio_itens_excede_limite', { ...noItem, limite: 1000 }, /1000 linhas de rateio somando todos os itens/i],
    ['linha_duplicada', naLinha, /repetidas.*item 2, linha 3 do rateio/i],
    ['valor_linha_zero', { ...naLinha, modo: 'VALOR' }, /valor zero.*item 2, linha 3 do rateio/i],
  ])('%s', (reason, details, re) => {
    const msg = mensagemErroGestao(e(reason, details), 'x', c);
    expect(msg).toMatch(re);
    expect(msg).toMatch(/Nada foi gravado\.$/);
    expect(msg).not.toMatch(/texto do servidor/);
  });

  it('soma_diferente por item: VALOR em dinheiro (esperado = líquido do item) e PERCENTUAL em %', () => {
    const v = mensagemErroGestao(e('soma_diferente', { ...noItem, modo: 'VALOR', esperado: '400.00', informado: '399.99', diferenca: '0.01' }), 'x', c);
    expect(v).toMatch(/item 2/);
    expect(v).toMatch(/líquido do item.*R\$\s400,00.*R\$\s399,99.*R\$\s0,01/);
    const p = mensagemErroGestao(e('soma_diferente', { ...noItem, modo: 'PERCENTUAL', esperado: '100.000000', informado: '90.000000', diferenca: '10.000000' }), 'x', c);
    expect(p).toMatch(/item 2.*100%.*90%.*10%/);
    expect(p).not.toMatch(/R\$/);
  });

  it('referência inválida numa linha do item (natureza inativa) e bloqueio da prévia apontam item e linha', () => {
    const ref = mensagemErroGestao({ cause: { code: 'OPERACAO_REFERENCIA_INVALIDA', field: 'natureza_id', reason: 'natureza_inativa', details: naLinha } }, 'x', c);
    expect(ref).toMatch(/natureza escolhida está inativa.*\(item 2, linha 3 do rateio\)/);
    const bloqueio = mensagemDoBloqueio({ code: 'OPERACAO_REFERENCIA_INVALIDA', field: 'centro_custo_id', reason: 'centro_custo_inativo', details: { colecao: 'itens', indice: 0, subcolecao: 'rateios', subindice: 0 } }, c);
    expect(bloqueio).toMatch(/centro de custo escolhido está inativo.*\(item 1, linha 1 do rateio\)/);
    expect(bloqueio).not.toMatch(/Nada foi/);
  });
});

/** Corpo DOC POR_ITEM da compra milho + frete. */
const corpoPorItem = (extra = {}) => ({
  empresa_id: 'emp-1', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', parceiro_id: 'pa1', data_emissao: '2026-11-08',
  data_operacional: '2026-11-08', efeito_fisico_confirmado: true, valor_desconto: '100.00', rateio_escopo: 'POR_ITEM', rateio_modo: 'VALOR', rateios: [],
  itens: [
    { tipo_item: 'MERCADORIA', produto_id: 'pr2', local_estoque_id: 'lo1', unidade: 'KG', quantidade: '100', valor_unitario: '6', rateios: [{ natureza_id: 'nd1', valor: '540.00' }] },
    { tipo_item: 'SERVICO', unidade: 'UN', descricao: 'FRETE', quantidade: '1', valor_unitario: '400', rateios: [{ natureza_id: 'nd2', centro_custo_id: 'cc1', valor: '200.00' }, { natureza_id: 'nd1', valor: '160.00' }] },
  ],
  parcelas: [{ vencimento: '2026-11-08', valor: '900.00' }],
  ...extra,
});
const chamar = (estado, method, path, body = null, query = '') => rotearLancamentos(estado, { method, path, query: new URLSearchParams(query), body });

describe('RI-4 — backend falso espelha o contrato (SPEC §3–§5)', () => {
  it('POST POR_ITEM: detalhe com rateio_escopo, itens[].rateios (% sobre o líquido do item) e rateio_consolidado (Σ = total)', async () => {
    const estado = criarEstadoLancamentos();
    const r = await chamar(estado, 'POST', '/operacoes-financeiras', { ...corpoPorItem(), operation_id: 'op-ri4-1' });
    expect(r.status).toBe(201);
    const d = r.body;
    expect(d.rateio_escopo).toBe('POR_ITEM');
    expect(d.rateios).toEqual([]);
    expect(d.itens[0].rateios).toEqual([
      { ordem: 1, natureza_id: 'nd1', natureza_nome: 'NUTRIÇÃO', natureza_tipo: 'DESPESA', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: null, centro_resultado_nome: null, percentual: '100.000000', valor: '540.00' },
    ]);
    expect(d.itens[1].rateios.map((l) => [l.ordem, l.natureza_id, l.centro_custo_nome, l.valor, l.percentual])).toEqual([
      [1, 'nd2', 'CRIA', '200.00', '55.555556'],
      [2, 'nd1', null, '160.00', '44.444444'],
    ]);
    expect(d.rateio_consolidado.map((l) => [l.natureza_id, l.centro_custo_id, l.valor, l.percentual])).toEqual([
      ['nd1', null, '700.00', '77.777778'],
      ['nd2', 'cc1', '200.00', '22.222222'],
    ]);
    expect(somar(d.rateio_consolidado.map((l) => l.valor), 2)).toBe(d.valor_total);
    const lista = await chamar(estado, 'GET', '/operacoes-financeiras', null, 'empresa_id=emp-1');
    expect(lista.body.items[0].rateio_escopo).toBe('POR_ITEM');
    const previa = await chamar(estado, 'POST', `/operacoes-financeiras/${d.id}/previa`, { empresa_id: 'emp-1' });
    expect(previa.body.plano.rateio_escopo).toBe('POR_ITEM');
    expect(previa.body.plano.rateios).toEqual([]);
    expect(previa.body.plano.itens[1].rateios.map((l) => l.valor)).toEqual(['200.00', '160.00']);
    expect(previa.body.plano.rateio_consolidado).toEqual(d.rateio_consolidado);
  });

  it('GERAL: itens[].rateios sempre [] e o consolidado é igual às linhas do geral; documento antigo (NULL) é GERAL', async () => {
    const estado = criarEstadoLancamentos();
    const doc = semearDocumento(estado, { ...corpoPorItem(), rateio_escopo: undefined, rateios: [{ natureza_id: 'nd1', valor: '900.00' }], itens: corpoPorItem().itens.map(({ rateios: _r, ...i }) => i) });
    doc.rateio_escopo = null; // linha antiga da P3-01
    const d = (await chamar(estado, 'GET', `/operacoes-financeiras/${doc.id}`, null, 'empresa_id=emp-1')).body;
    expect(d.rateio_escopo).toBe('GERAL');
    expect(d.itens.map((i) => i.rateios)).toEqual([[], []]);
    expect(d.rateio_consolidado).toEqual([{ natureza_id: 'nd1', natureza_nome: 'NUTRIÇÃO', centro_custo_id: null, centro_custo_nome: null, centro_resultado_id: null, centro_resultado_nome: null, valor: '900.00', percentual: '100.000000' }]);
  });

  it.each([
    ['escopo inválido', { rateio_escopo: 'TUDO' }, { reason: 'escopo_invalido', field: 'rateio_escopo' }],
    ['POR_ITEM sem produtos', { conteudo: 'SEM_PRODUTOS', valor_bruto: '900.00', itens: undefined, data_operacional: undefined, efeito_fisico_confirmado: undefined, valor_desconto: undefined }, { reason: 'escopo_por_item_exige_produtos' }],
    ['geral e por item juntos', { rateios: [{ natureza_id: 'nd1', valor: '900.00' }] }, { reason: 'rateio_geral_e_por_item' }],
    ['GERAL com rateios no item', { rateio_escopo: 'GERAL', rateios: [{ natureza_id: 'nd1', valor: '900.00' }] }, { reason: 'rateio_geral_e_por_item' }],
    ['GERAL sem linha no topo', { rateio_escopo: 'GERAL', rateios: [], itens: corpoPorItem().itens.map(({ rateios: _r, ...i }) => i) }, { reason: 'rateio_geral_obrigatorio' }],
  ])('recusa: %s', async (_nome, extra, esperado) => {
    const estado = criarEstadoLancamentos();
    const r = await chamar(estado, 'POST', '/operacoes-financeiras', { ...corpoPorItem(extra), operation_id: `op-${esperado.reason}` });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'OPERACAO_RATEIO_INVALIDO', ...esperado });
    expect(estado.documentos).toHaveLength(0);
  });

  it('recusas por item trazem colecao/indice/subcolecao/subindice (soma, sem linha, repetida, valor zero, limite)', async () => {
    const itens = corpoPorItem().itens;
    const casos = [
      [[itens[0], { ...itens[1], rateios: [{ natureza_id: 'nd2', valor: '200.00' }, { natureza_id: 'nd1', valor: '159.99' }] }], { reason: 'soma_diferente', details: { colecao: 'itens', indice: 1, subcolecao: 'rateios', modo: 'VALOR', esperado: '360.00', informado: '359.99', diferenca: '0.01' } }],
      [[{ ...itens[0], rateios: [] }, itens[1]], { reason: 'item_sem_rateio', details: { colecao: 'itens', indice: 0, subcolecao: 'rateios' } }],
      [[itens[0], { ...itens[1], rateios: [{ natureza_id: 'nd2', valor: '200.00' }, { natureza_id: 'nd2', valor: '160.00' }] }], { reason: 'linha_duplicada', details: { colecao: 'itens', indice: 1, subcolecao: 'rateios', subindice: 1 } }],
      [[itens[0], { ...itens[1], rateios: [{ natureza_id: 'nd2', valor: '360.00' }, { natureza_id: 'nd1', valor: '0.00' }] }], { reason: 'valor_linha_zero', details: { colecao: 'itens', indice: 1, subcolecao: 'rateios', subindice: 1 } }],
      [[itens[0], { ...itens[1], rateios: Array.from({ length: 21 }, (_, k) => ({ natureza_id: 'nd1', centro_custo_id: k % 2 ? 'cc1' : 'cc2', valor: '1.00' })) }], { reason: 'rateio_item_excede_limite', details: { colecao: 'itens', indice: 1, subcolecao: 'rateios', limite: 20 } }],
    ];
    for (const [its, esperado] of casos) {
      const estado = criarEstadoLancamentos();
      const r = await chamar(estado, 'POST', '/operacoes-financeiras', { ...corpoPorItem({ itens: its }), operation_id: `op-${esperado.reason}` });
      expect(r.status, esperado.reason).toBe(422);
      expect(r.body, esperado.reason).toMatchObject({ code: 'OPERACAO_RATEIO_INVALIDO', reason: esperado.reason, details: esperado.details });
    }
  });

  it('PUT: item removido leva as linhas dele; reordenar leva as linhas junto (associação pela ordem do item na MESMA requisição)', async () => {
    const estado = criarEstadoLancamentos();
    const criado = (await chamar(estado, 'POST', '/operacoes-financeiras', { ...corpoPorItem({ valor_desconto: undefined, parcelas: [{ vencimento: '2026-11-08', valor: '1000.00' }] , itens: [{ ...corpoPorItem().itens[0], rateios: [{ natureza_id: 'nd1', valor: '600.00' }] }, { ...corpoPorItem().itens[1], rateios: [{ natureza_id: 'nd2', valor: '400.00' }] }] }), operation_id: 'op-put-1' })).body;
    const [milho, frete] = corpoPorItem().itens;
    const r = await chamar(estado, 'PUT', `/operacoes-financeiras/${criado.id}`, {
      ...corpoPorItem({ valor_desconto: undefined, parcelas: [{ vencimento: '2026-11-08', valor: '400.00' }], data_operacional: undefined, efeito_fisico_confirmado: undefined, itens: [{ ...frete, rateios: [{ natureza_id: 'nd3', valor: '400.00' }] }] }),
      versao: criado.versao,
    });
    expect(r.status).toBe(200);
    expect(r.body.itens).toHaveLength(1);
    expect(r.body.itens[0].rateios.map((l) => l.natureza_id)).toEqual(['nd3']);
    expect(r.body.rateio_consolidado.map((l) => [l.natureza_id, l.valor])).toEqual([['nd3', '400.00']]);
    expect(milho).toBeTruthy();
  });
});

// ─── RI-5 — paridade com o backend (vetores gerados a partir do servidor) ───

const CAMINHO_VETORES = resolve(process.cwd(), 'tests/smoke/fixtures/rateioPorItemVetores.json');
const vetores = existsSync(CAMINHO_VETORES) ? JSON.parse(readFileSync(CAMINHO_VETORES, 'utf8')) : null;

/** Igualdade POR VALOR (a escala do texto pode variar); null só bate com null. */
const mesmoValor = (obtido, esperado) => {
  if (esperado === null || esperado === undefined) return obtido === null || obtido === undefined;
  return typeof obtido === 'string' && comparar(obtido, String(esperado)) === 0;
};

/** Símbolos do vetor (N1..N3, C1|C2, R1) → cadastros do backend falso. */
const NATUREZA_DO_VETOR = { N1: 'nd1', N2: 'nd2', N3: 'nd3' };
const CC_DO_VETOR = { C1: 'cc1', C2: 'cc2' };
const CR_DO_VETOR = { R1: 'cr1' };
const textoOuNulo = (v) => (v == null ? null : String(v));
/** Linha do vetor no formato do contrato (ids do backend falso). */
const linhaDoVetor = (l) => ({
  natureza_id: NATUREZA_DO_VETOR[l.natureza] ?? l.natureza ?? l.natureza_id,
  centro_custo_id: l.centro_custo ? CC_DO_VETOR[l.centro_custo] ?? l.centro_custo : l.centro_custo_id ?? null,
  centro_resultado_id: l.centro_resultado ? CR_DO_VETOR[l.centro_resultado] ?? l.centro_resultado : l.centro_resultado_id ?? null,
  valor: textoOuNulo(l.valor),
  percentual: textoOuNulo(l.percentual),
});
/** Chave de comparação do consolidado (símbolos do vetor ou ids do contrato). */
const chaveConsolidada = (l) =>
  `${NATUREZA_DO_VETOR[l.natureza] ?? l.natureza ?? l.natureza_id}|${(l.centro_custo ? CC_DO_VETOR[l.centro_custo] : l.centro_custo_id) ?? ''}|${(l.centro_resultado ? CR_DO_VETOR[l.centro_resultado] : l.centro_resultado_id) ?? ''}`;

/** Subtotal do item do vetor (`subtotal` = 1 × valor unitário). */
const subtotalDoVetor = (it, casas) => String(it.subtotal ?? it.valor_total ?? multiplicarArredondar(String(it.quantidade), String(it.valor_unitario), casas));

/** Líquido de cada item pelo motor da P3-01 da tela (`ratearCabecalho`, BigInt). */
const rateioDoCabecalho = (caso, casas) =>
  ratearCabecalho({
    direcao: caso.direcao ?? 'PAGAR',
    casas,
    valor_desconto: caso.valor_desconto ?? '0',
    valor_acrescimo: caso.valor_acrescimo ?? '0',
    itens: (caso.itens ?? []).map((it, k) => ({ ordem: k + 1, tipo_item: it.tipo_item ?? 'SERVICO', valor_total: subtotalDoVetor(it, casas), quantidade_estoque: null })),
  });

const conferirConsolidado = (obtido, esperado, onde) => {
  expect(obtido.map(chaveConsolidada), `${onde}: chaves/ordem do consolidado`).toEqual(esperado.map(chaveConsolidada));
  esperado.forEach((e, j) => {
    expect(mesmoValor(obtido[j].valor, e.valor), `${onde}: consolidado ${j + 1} valor ${obtido[j].valor} (esperado ${e.valor})`).toBe(true);
    expect(mesmoValor(obtido[j].percentual, e.percentual), `${onde}: consolidado ${j + 1} % ${obtido[j].percentual} (esperado ${e.percentual})`).toBe(true);
  });
};

/** Corpo DOC POR_ITEM do vetor para o backend falso (serviços de 1 × subtotal). */
const corpoDoVetor = (caso, casas) => ({
  empresa_id: 'emp-1', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', parceiro_id: 'pa1', data_emissao: '2026-11-08',
  ...(caso.valor_desconto ? { valor_desconto: String(caso.valor_desconto) } : {}),
  ...(caso.valor_acrescimo ? { valor_acrescimo: String(caso.valor_acrescimo) } : {}),
  rateio_escopo: 'POR_ITEM', rateio_modo: caso.rateio_modo ?? 'VALOR', rateios: [],
  itens: (caso.itens ?? []).map((it, k) => ({
    tipo_item: 'SERVICO', unidade: 'UN', descricao: `SERVIÇO ${k + 1}`, quantidade: '1', valor_unitario: subtotalDoVetor(it, casas),
    rateios: (it.rateios ?? []).map((l) => {
      const x = linhaDoVetor(l);
      return { natureza_id: x.natureza_id, ...(x.centro_custo_id ? { centro_custo_id: x.centro_custo_id } : {}), ...(x.centro_resultado_id ? { centro_resultado_id: x.centro_resultado_id } : {}), ...((caso.rateio_modo ?? 'VALOR') === 'PERCENTUAL' ? { percentual: x.percentual } : { valor: x.valor }) };
    }),
  })),
  parcelas: [{ vencimento: '2026-11-08', valor: caso.esperado?.valor_total ?? somar((rateioDoCabecalho(caso, casas)?.itens ?? []).map((i) => i.valor_liquido), casas) }],
});

describe('RI-5 — vetores de paridade do rateio por item (backend × tela)', () => {
  const casos = Array.isArray(vetores?.casos) ? vetores.casos : [];
  it('o arquivo tem casos', () => {
    expect(casos.length, 'rateioPorItemVetores.json sem `casos`').toBeGreaterThan(0);
  });
  for (const caso of casos) {
    it(`função pura: ${caso.id}`, () => {
      const casas = caso.casas;
      const modo = caso.rateio_modo ?? 'VALOR';
      const cab = rateioDoCabecalho(caso, casas);
      expect(cab?.erro ?? null, 'rateio do cabeçalho').toBeNull();
      const liquidos = cab.itens.map((i) => i.valor_liquido);
      const esperado = caso.esperado ?? {};
      (esperado.itens ?? []).forEach((esp, k) => {
        for (const campo of ['valor_desconto_rateado', 'valor_acrescimo_rateado', 'valor_liquido']) {
          if (esp[campo] != null) expect(mesmoValor(cab.itens[k][campo], esp[campo]), `item ${k + 1}: ${campo} ${cab.itens[k][campo]} (esperado ${esp[campo]})`).toBe(true);
        }
      });
      let erro = null;
      const todas = [];
      (caso.itens ?? []).forEach((it, k) => {
        const linhas = (it.rateios ?? []).map(linhaDoVetor);
        const r = planejarRateioDoItem({ modo, liquido: liquidos[k], casas, linhas });
        if (r.erro && !erro) erro = { ...r.erro, indice: k };
        const esp = esperado.itens?.[k]?.rateios;
        if (!r.erro && Array.isArray(esp)) {
          expect(r.valores).toHaveLength(esp.length);
          esp.forEach((e, j) => {
            expect(mesmoValor(r.valores[j], e.valor), `item ${k + 1} linha ${j + 1}: valor ${r.valores[j]} (esperado ${e.valor})`).toBe(true);
            expect(mesmoValor(r.percentuais[j], e.percentual), `item ${k + 1} linha ${j + 1}: % ${r.percentuais[j]} (esperado ${e.percentual})`).toBe(true);
          });
        }
        linhas.forEach((l, j) => todas.push({ ...l, valor: r.valores[j] }));
      });
      if (esperado.erro) {
        expect(erro, 'deveria recusar').toBeTruthy();
        expect(erro.reason).toBe(esperado.erro.reason);
        expect(erro.field).toBe(esperado.erro.field);
        const det = esperado.erro.details ?? {};
        expect(erro.indice).toBe(det.indice);
        if (Number.isInteger(det.subindice)) expect(erro.subindice).toBe(det.subindice);
        else expect(erro.subindice).toBeUndefined();
        if (det.modo != null) expect(erro.details.modo).toBe(det.modo);
        for (const campo of ['esperado', 'informado', 'diferenca']) {
          if (det[campo] != null) expect(mesmoValor(erro.details[campo], det[campo]), `details.${campo} = ${erro.details[campo]} (esperado ${det[campo]})`).toBe(true);
        }
        return;
      }
      expect(erro, `não deveria recusar: ${erro?.reason}`).toBeNull();
      expect(comparar(somar(todas.map((l) => l.valor), casas), esperado.valor_total), 'Σ das linhas = valor_total').toBe(0);
      conferirConsolidado(consolidarRateio(todas, esperado.valor_total, casas), esperado.rateio_consolidado ?? [], 'pura');
    });

    it(`backend falso: ${caso.id}`, async () => {
      const casas = caso.casas;
      const perfil = { ...PERFIL_BR, pais: caso.perfil?.pais ?? 'BR', moeda: caso.perfil?.moeda ?? 'BRL', locale: caso.perfil?.locale ?? 'pt-BR', moeda_casas: casas };
      const estado = criarEstadoLancamentos({ perfil });
      const r = await chamar(estado, 'POST', '/operacoes-financeiras', { ...corpoDoVetor(caso, casas), operation_id: `op-vet-${caso.id}`.replace(/[^A-Za-z0-9_.:-]/g, '-') });
      const esperado = caso.esperado ?? {};
      if (esperado.erro) {
        expect(r.status).toBe(esperado.erro.status);
        expect(r.body).toMatchObject({ code: esperado.erro.code, field: esperado.erro.field, reason: esperado.erro.reason });
        const det = esperado.erro.details;
        for (const campo of ['colecao', 'indice', 'subcolecao', 'subindice', 'item_ordem', 'modo']) expect(r.body.details?.[campo], `details.${campo}`).toEqual(det[campo]);
        for (const campo of ['esperado', 'informado', 'diferenca', 'valor_liquido']) if (det[campo] != null) expect(mesmoValor(r.body.details?.[campo], det[campo]), `details.${campo}`).toBe(true);
        return;
      }
      expect(r.status).toBe(201);
      expect(r.body.rateio_escopo).toBe('POR_ITEM');
      expect(mesmoValor(r.body.valor_total, esperado.valor_total)).toBe(true);
      esperado.itens.forEach((esp, k) => {
        const item = r.body.itens[k];
        expect(mesmoValor(item.valor_liquido, esp.valor_liquido), `item ${k + 1}: líquido`).toBe(true);
        expect(item.rateios).toHaveLength(esp.rateios.length);
        esp.rateios.forEach((e, j) => {
          expect(item.rateios[j].ordem).toBe(j + 1);
          expect(mesmoValor(item.rateios[j].valor, e.valor), `item ${k + 1} linha ${j + 1}: valor`).toBe(true);
          expect(mesmoValor(item.rateios[j].percentual, e.percentual), `item ${k + 1} linha ${j + 1}: %`).toBe(true);
        });
      });
      conferirConsolidado(r.body.rateio_consolidado, esperado.rateio_consolidado, 'backend falso');
    });
  }
});

describe('RI-5b — o arquivo de vetores é obrigatório', () => {
  it('o arquivo existe (o backend o confere no gestaoP3RateioItem.test.mjs) e o formato é o do backend: sem ele a paridade falha, nunca passa por engano', () => {
    expect(existsSync(CAMINHO_VETORES), 'tests/smoke/fixtures/rateioPorItemVetores.json ausente').toBe(true);
    expect(vetores.formato?.entrada).toMatch(/rateio_modo/);
    expect(vetores.casos.every((c) => Number.isInteger(c.casas) && Array.isArray(c.itens))).toBe(true);
  });
});
