/**
 * D-PROD-154 — dinheiro no navegador SEM float (`src/lib/dinheiroDecimal.js`),
 * dias civis em UTC (`src/lib/diaCivil.js`) e o modelo puro do formulário
 * (rateio ao centavo, parcelas com resto na última, corpo DOC canônico).
 * Vetores iguais aos do servidor (§8.7), inclusive o caso em que
 * `Prisma.Decimal` com precisão 20 erraria (…568.61 em vez de …568.60).
 */
import { describe, it, expect } from 'vitest';
import {
  LOCALES_FINANCEIROS,
  comparar,
  deUnidades,
  dividirComRestoNaUltima,
  formatarMoeda,
  formatarNumero,
  lerNumeroLocal,
  multiplicarArredondar,
  naEscala,
  paraUnidades,
  percentualDe,
  ratearPercentual,
  separadoresDoLocale,
  somar,
  subtrair,
} from '@/lib/dinheiroDecimal';
import { diasEntre, ehDiaValido, formatarDia, hojeNoFuso, somarDias } from '@/lib/diaCivil';
import { calcularResumo, formularioVazio, gerarParcelas, montarDocumento } from '@/components/financeiroGestao/lancamentoModelo';

describe('DIN-1 — multiplicação HALF_UP exata (vetores do servidor)', () => {
  it.each([
    ['7984815747.9459', '219.522662', 2, '1752848008568.60'],
    ['2.5', '33.3333', 4, '83.3333'],
    ['0.005', '1', 2, '0.01'],
    ['1.005', '1', 2, '1.01'],
    ['10', '0.335', 2, '3.35'],
    ['3', '0.333333', 2, '1.00'],
    ['1', '0.0049', 2, '0.00'],
    ['9999999999.9999', '99999.999999', 4, '999999999989990.0000'],
    ['123', '1000', 0, '123000'],
    ['0.5', '0.5', 0, '0'],
    ['1.5', '1', 0, '2'],
    ['2.0005', '1', 3, '2.001'],
  ])('%s × %s em %i casas = %s', (q, vu, casas, esperado) => {
    expect(multiplicarArredondar(q, vu, casas)).toBe(esperado);
  });

  it('nunca passa por float: 0.1 + 0.2 = 0.3 e 7984815747.9459 × 219.522662 tem os 16 dígitos', () => {
    expect(somar(['0.1', '0.2'], 2)).toBe('0.30');
    expect(multiplicarArredondar('7984815747.9459', '219.522662', 2)).toBe('1752848008568.60');
    expect(subtrair('0.30', '0.31', 2)).toBe('-0.01');
    expect(comparar('1.10', '1.1')).toBe(0);
    expect(comparar('99999999999999.9999', '99999999999999.9998')).toBe(1);
  });

  it('unidades mínimas: casa decimal significativa além da escala é erro (nada arredonda em silêncio)', () => {
    expect(paraUnidades('1234.50', 2)).toBe(123450n);
    expect(paraUnidades('1234.500', 2)).toBe(123450n);
    expect(() => paraUnidades('1234.505', 2)).toThrow('casas_excedidas');
    expect(deUnidades(-1n, 2)).toBe('-0.01');
    expect(deUnidades(5n, 0)).toBe('5');
    expect(naEscala('7', 3)).toBe('7.000');
  });
});

describe('DIN-2 — leitura localizada com formatToParts (latn)', () => {
  it.each([
    ['pt-BR', '1.234,56', 2, '1234.56'],
    ['pt-BR', '1234,56', 2, '1234.56'],
    ['pt-BR', '1.234.567,8', 2, '1234567.8'],
    ['pt-BR', '0,05', 2, '0.05'],
    ['pt-BR', ',5', 2, '0.5'],
    ['pt-BR', '1.234', 2, '1234'],
    ['en-US', '1,234.56', 2, '1234.56'],
    ['en-US', '1234.56', 2, '1234.56'],
    ['ja-JP', '1,234', 0, '1234'],
    ['es-ES', '1.234,56', 2, '1234.56'],
    ['es-ES', '1234,56', 2, '1234.56'],
    ['es-AR', '12.345,6', 2, '12345.6'],
    ['pt-PT', '1 234,56', 2, '1234.56'],
    ['pt-PT', '1 234,56', 2, '1234.56'],
    ['pt-BR', '1,500', 2, '1.5'],
  ])('%s: "%s" → %s', (locale, texto, casas, esperado) => {
    expect(lerNumeroLocal(texto, locale, { casas, inteiros: 14 })).toEqual({ ok: true, valor: esperado });
  });

  it.each([
    ['pt-BR', '1,234.56', 'formato'],
    ['pt-BR', '1.5', 'formato'],
    ['pt-BR', '12.34,5', 'formato'],
    ['en-US', '1.234,56', 'formato'],
    ['pt-BR', '-5', 'formato'],
    ['pt-BR', '1e5', 'formato'],
    ['pt-BR', 'abc', 'formato'],
    ['pt-BR', '٣', 'formato'],
    ['pt-BR', '', 'vazio'],
    ['pt-BR', '1,234', 'casas'],
    ['pt-BR', '123456789012345', 'limite'],
  ])('%s: "%s" recusado (%s)', (locale, texto, motivo) => {
    expect(lerNumeroLocal(texto, locale, { casas: 2, inteiros: 14 })).toEqual({ ok: false, motivo });
  });

  it('PYG (0 casas) recusa centavos; KWD (3 casas) aceita milésimos', () => {
    expect(lerNumeroLocal('1.000,5', 'es-PY', { casas: 0, inteiros: 14 })).toEqual({ ok: false, motivo: 'casas' });
    expect(lerNumeroLocal('1.000', 'es-PY', { casas: 0, inteiros: 14 })).toEqual({ ok: true, valor: '1000' });
    expect(lerNumeroLocal('1.005', 'en-US', { casas: 3, inteiros: 14 })).toEqual({ ok: true, valor: '1.005' });
    // Em en-US a vírgula é milhar: "1,005" é mil e cinco — nunca "adivinhado" como decimal.
    expect(lerNumeroLocal('1,005', 'en-US', { casas: 3, inteiros: 14 })).toEqual({ ok: true, valor: '1005' });
  });

  it('separadores de todos os locales do catálogo vêm em dígitos latinos', () => {
    for (const l of LOCALES_FINANCEIROS) {
      const s = separadoresDoLocale(l);
      expect(s.decimal === ',' || s.decimal === '.').toBe(true);
      expect(/\d/.test(s.grupo)).toBe(false);
    }
  });
});

describe('DIN-3 — formatação exata no locale (string → Intl, conferida dígito a dígito)', () => {
  it('moedas e escalas do catálogo', () => {
    expect(formatarMoeda('1234.5', { locale: 'pt-BR', moeda: 'BRL', casas: 2 })).toMatch(/^R\$\s1\.234,50$/);
    expect(formatarMoeda('12345678901234.56', { locale: 'pt-BR', moeda: 'BRL', casas: 2 })).toMatch(/12\.345\.678\.901\.234,56/);
    expect(formatarMoeda('1234.56', { locale: 'en-US', moeda: 'USD', casas: 2 })).toBe('$1,234.56');
    expect(formatarMoeda('1234567', { locale: 'es-PY', moeda: 'PYG', casas: 0 })).toMatch(/1\.234\.567/);
    expect(formatarMoeda('-0.005', { locale: 'en-US', moeda: 'KWD', casas: 3 })).toMatch(/0\.005/);
    expect(formatarMoeda('', { locale: 'pt-BR' })).toBe('—');
    expect(formatarMoeda('abc', { locale: 'pt-BR' })).toBe('—');
  });

  it('número com casas mínimas/máximas (quantidade e preço)', () => {
    expect(formatarNumero('10.5000', { locale: 'pt-BR', casasMin: 0, casasMax: 4 })).toBe('10,5');
    expect(formatarNumero('1234.567891', { locale: 'en-US', casasMin: 2, casasMax: 6 })).toBe('1,234.567891');
    expect(formatarNumero('0.000049', { locale: 'pt-BR', casasMin: 0, casasMax: 4 })).toBe('0');
    expect(formatarNumero('25', { locale: 'pt-BR', casasMin: 2, casasMax: 2 })).toBe('25,00');
  });

  it('percentual informativo e divisão com resto na última', () => {
    expect(percentualDe('0.01', '3000000.00', 2, 6)).toBe('0.000000');
    expect(percentualDe('25.00', '100.00', 2, 2)).toBe('25.00');
    expect(dividirComRestoNaUltima('100.00', 3, 2)).toEqual(['33.33', '33.33', '33.34']);
    expect(dividirComRestoNaUltima('1000', 3, 0)).toEqual(['333', '333', '334']);
    expect(dividirComRestoNaUltima('10.000', 3, 3)).toEqual(['3.333', '3.333', '3.334']);
  });
});

describe('DIN-4 — rateio PERCENTUAL igual ao servidor (piso + maior resto, empate pela ordem)', () => {
  it('5,00 em 99,9% / 0,1%: o centavo vai para a 1ª linha e a 2ª fica zero (o servidor recusa valor_linha_zero)', () => {
    const r = ratearPercentual('5.00', ['99.9', '0.1'], 2);
    expect(r.valores).toEqual(['5.00', '0.00']);
    expect(r.linhasZeradas).toEqual([1]);
  });

  it('100,00 em três terços: resto para o MAIOR resto fracionário', () => {
    const r = ratearPercentual('100.00', ['33.333333', '33.333333', '33.333334'], 2);
    expect(r.fecha100).toBe(true);
    expect(r.valores).toEqual(['33.33', '33.33', '33.34']);
    expect(somar(r.valores, 2)).toBe('100.00');
  });

  it('empate de resto: ganha a menor ordem', () => {
    expect(ratearPercentual('0.03', ['50', '50'], 2).valores).toEqual(['0.02', '0.01']);
    expect(ratearPercentual('10.00', ['33.333333', '33.333333', '33.333334'], 2).valores).toEqual(['3.33', '3.33', '3.34']);
  });

  it('soma ≠ 100 não fecha', () => {
    expect(ratearPercentual('10.00', ['60', '30'], 2)).toMatchObject({ fecha100: false, somaPercentual: '90.000000' });
  });
});

describe('DIN-5 — dias civis em UTC e "hoje" no fuso da empresa', () => {
  it('soma de dias atravessa mês, ano bissexto e horário de verão sem pular dia', () => {
    expect(somarDias('2026-03-28', 1)).toBe('2026-03-29');
    expect(somarDias('2026-03-29', 1)).toBe('2026-03-30');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-01-31', 30)).toBe('2026-03-02');
    expect(diasEntre('2026-01-01', '2026-03-01')).toBe(59);
  });

  it('dia inválido é recusado', () => {
    expect(ehDiaValido('2026-02-30')).toBe(false);
    expect(ehDiaValido('2026-13-01')).toBe(false);
    expect(ehDiaValido('26-01-01')).toBe(false);
    expect(somarDias('2026-02-30', 1)).toBe('');
  });

  it('hoje no fuso: 23h de 07/11 em São Paulo já é 08/11 em Tóquio', () => {
    const instante = new Date('2026-11-08T02:00:00.000Z');
    expect(hojeNoFuso('America/Sao_Paulo', instante)).toBe('2026-11-07');
    expect(hojeNoFuso('Asia/Tokyo', instante)).toBe('2026-11-08');
    expect(hojeNoFuso('Fuso/Inexistente', instante)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatarDia('2026-11-08', 'pt-BR')).toBe('08/11/2026');
    expect(formatarDia('2026-11-08', 'en-US')).toBe('11/08/2026');
  });
});

describe('DIN-6 — modelo do formulário (rateio ao centavo, gerador, corpo canônico)', () => {
  const ctx = { locale: 'pt-BR', casas: 2, hoje: '2026-11-08' };
  const base = () => ({
    ...formularioVazio({ hoje: '2026-11-08' }),
    parceiro: { id: 'pa1', rotulo: 'AGRO' },
    valor_bruto: '1.000,00',
  });

  it('VALOR com 2 linhas: diferença de R$ 0,01 aparece e bloqueia', () => {
    const f = base();
    f.rateios = [
      { chave: 'a', natureza: { id: 'n1', rotulo: 'A' }, centro_custo: null, centro_resultado: null, valor: '600,00', percentual: '' },
      { chave: 'b', natureza: { id: 'n2', rotulo: 'B' }, centro_custo: null, centro_resultado: null, valor: '399,99', percentual: '' },
    ];
    const r = calcularResumo(f, ctx);
    expect(r.rateio.diferenca).toBe('0.01');
    expect(r.valido).toBe(false);
    f.rateios[1].valor = '400,00';
    const ok = calcularResumo(f, ctx);
    expect(ok.rateio.diferenca).toBe('0.00');
    expect(ok.valido).toBe(true);
  });

  it('uma linha de rateio = 100% automático do TOTAL (depois de desconto e acréscimo)', () => {
    const f = { ...base(), valor_desconto: '10,00', valor_acrescimo: '0,50', rateios: [{ chave: 'a', natureza: { id: 'n1', rotulo: 'A' }, centro_custo: null, centro_resultado: null, valor: '', percentual: '' }] };
    const r = calcularResumo(f, ctx);
    expect(r.total).toBe('990.50');
    expect(r.rateio.valores).toEqual(['990.50']);
    const doc = montarDocumento(f, r);
    expect(doc).toMatchObject({ valor_bruto: '1000.00', valor_desconto: '10.00', valor_acrescimo: '0.50', rateios: [{ natureza_id: 'n1', valor: '990.50' }], parcelas: [{ vencimento: '2026-11-08', valor: '990.50' }] });
    expect(JSON.stringify(doc)).not.toMatch(/\d,\d/);
  });

  it('gerador: 3 parcelas de 1.000,00 com resto na última e intervalo em dias UTC', () => {
    const r = gerarParcelas({ total: '1000.00', casas: 2, locale: 'pt-BR', dataEmissao: '2026-11-08', quantidade: '3', primeiroVencimento: '2026-12-08', intervalo: '30', entrada: '' });
    expect(r).toEqual({
      ok: true,
      parcelas: [
        { vencimento: '2026-12-08', valor: '333.33' },
        { vencimento: '2027-01-07', valor: '333.33' },
        { vencimento: '2027-02-06', valor: '333.34' },
      ],
    });
  });

  it('gerador com entrada: entrada vence na emissão e o resto divide o saldo', () => {
    const r = gerarParcelas({ total: '1000.00', casas: 2, locale: 'pt-BR', dataEmissao: '2026-11-08', quantidade: '2', primeiroVencimento: '2026-12-08', intervalo: '30', entrada: '100,01' });
    expect(r.parcelas).toEqual([
      { vencimento: '2026-11-08', valor: '100.01' },
      { vencimento: '2026-12-08', valor: '449.99' },
      { vencimento: '2027-01-07', valor: '450.00' },
    ]);
  });

  it('gerador recusa entrada ≥ total, parcelas zeradas e 1º vencimento antes da emissão', () => {
    const g = (extra) => gerarParcelas({ total: '0.02', casas: 2, locale: 'pt-BR', dataEmissao: '2026-11-08', quantidade: '3', primeiroVencimento: '2026-12-08', intervalo: '30', entrada: '', ...extra });
    expect(g({}).ok).toBe(false);
    expect(g({ total: '10.00', entrada: '10,00' }).erro).toMatch(/entrada/i);
    expect(g({ total: '10.00', primeiroVencimento: '2026-11-01' }).erro).toMatch(/antes da emissão/);
  });

  it('item: subtotal HALF_UP e kg do saco convertido UMA vez (4 casas)', () => {
    const f = {
      ...base(),
      conteudo: 'COM_PRODUTOS',
      valor_bruto: '',
      data_operacional: '2026-11-07',
      efeito_fisico_confirmado: true,
      itens: [{ chave: 'i', tipo_item: 'MERCADORIA', produto: { id: 'pr1', rotulo: 'SAL', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '33.3333' }, local: { id: 'lo1', rotulo: 'D' }, descricao: '', unidade: 'SACO', quantidade: '2,5', valor_unitario: '45,125' }],
      rateios: [{ chave: 'a', natureza: { id: 'n1', rotulo: 'A' }, centro_custo: null, centro_resultado: null, valor: '', percentual: '' }],
    };
    const r = calcularResumo(f, ctx);
    expect(r.itens[0].subtotal).toBe('112.81');
    expect(r.itens[0].kg).toBe('83.3333');
    expect(r.valido).toBe(true);
    expect(montarDocumento(f, r).itens).toEqual([{ tipo_item: 'MERCADORIA', unidade: 'SACO', quantidade: '2.5', valor_unitario: '45.125', produto_id: 'pr1', local_estoque_id: 'lo1' }]);
  });

  it('mercadoria exige data operacional não futura e a declaração', () => {
    const f = {
      ...base(),
      conteudo: 'COM_PRODUTOS',
      itens: [{ chave: 'i', tipo_item: 'MERCADORIA', produto: { id: 'pr2', rotulo: 'MILHO' }, local: { id: 'lo1', rotulo: 'D' }, descricao: '', unidade: 'KG', quantidade: '10', valor_unitario: '2' }],
      data_operacional: '2026-11-09',
    };
    const r = calcularResumo(f, ctx);
    expect(r.erros.data_operacional).toMatch(/futuro/);
    expect(r.erros.efeito_fisico_confirmado).toBeTruthy();
  });
});
