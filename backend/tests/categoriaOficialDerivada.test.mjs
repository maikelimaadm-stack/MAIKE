/**
 * MAIKE-CATEGORIA-MANEJO-ENXUGAR — categoria oficial DERIVADA de sexo + faixa
 * de idade da categoria de manejo. Função pura: sem banco.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAIXAS_CATEGORIA_OFICIAL,
  categoriaOficialDaCategoriaManejo as derivar,
  derivaCategoriaOficial,
  sexoOficial,
  FAIXAS_IDADE_CATEGORIA_MANEJO,
  faixaIdadeDaLista,
  faixaContemIdade,
} from '../src/modules/movimentacoesMapa/categoriaOficialDerivada.js';

/** [sexo, idade_minima_meses, idade_maxima_meses, oficial esperada] — a mesma tabela do smoke do frontend. */
const CASOS = [
  ['Macho', 9, 12, 'Bezerro 0 a 12 meses'],
  ['Macho', 0, 12, 'Bezerro 0 a 12 meses'],
  ['Macho', null, 12, 'Bezerro 0 a 12 meses'],
  ['Macho', 13, 24, 'Garrote 13 a 24 meses'],
  ['Macho', 25, 36, 'Boi 25 a 36 meses'],
  ['Macho', 37, null, 'Touro + 36 meses'],
  ['MACHO', 40, 120, 'Touro + 36 meses'],
  ['Fêmea', 0, 12, 'Bezerra 0 a 12 meses'],
  ['FEMEA', 13, 24, 'Novilha 13 a 24 meses'],
  ['Femea', 25, 36, 'Vaca 25 a 36 meses'],
  ['fêmea', 37, null, 'Vaca + 36 meses'],
  ['Macho', 10, 20, null],
  ['Macho', null, null, null],
  ['Macho', '', '', null],
  ['Macho', 25, null, null],
  ['Macho', 0, null, null],
  ['Macho', 12, 13, null],
  ['Macho', 36, 37, null],
  ['Macho', 20, 15, null],
  ['Macho', -1, 12, null],
  ['Macho', 1.5, 12, null],
  ['Macho', 'abc', 12, null],
  [null, 0, 12, null],
  ['Misto', 0, 12, null],
];

describe('categoria oficial derivada de sexo + faixa de idade', () => {
  test('D1: tabela de exemplos (faixas 0–12, 13–24, 25–36, +36; atravessar faixa, sem idade ou idade inválida → null)', () => {
    for (const [sexo, idade_minima_meses, idade_maxima_meses, esperada] of CASOS) {
      assert.equal(derivar({ sexo, idade_minima_meses, idade_maxima_meses }), esperada, JSON.stringify({ sexo, idade_minima_meses, idade_maxima_meses }));
    }
  });

  test('D2: o nome nunca é a chave — "BOI + 36 MESES" vira Touro; nome igual ao texto oficial sem faixa não deriva nada', () => {
    assert.equal(derivar({ nome: 'BOI + 36 MESES', sexo: 'Macho', idade_minima_meses: 37, idade_maxima_meses: null }), 'Touro + 36 meses');
    assert.equal(derivar({ nome: 'BEZERRO 09 A 12 MESES', sexo: 'MACHO', idade_minima_meses: 9, idade_maxima_meses: 12 }), 'Bezerro 0 a 12 meses');
    assert.equal(derivar({ nome: 'Touro + 36 meses', sexo: 'Macho' }), null);
    assert.equal(derivar(null), null);
    assert.equal(derivar(undefined), null);
  });

  test('D3: idade como texto inteiro é aceita (formulário); números como texto inválido não', () => {
    assert.equal(derivar({ sexo: 'Macho', idade_minima_meses: '13', idade_maxima_meses: '24' }), 'Garrote 13 a 24 meses');
    assert.equal(derivar({ sexo: 'Macho', idade_minima_meses: '13.5', idade_maxima_meses: '24' }), null);
  });

  test('D4: derivaCategoriaOficial compara sem acento e sem caixa; não derivável nunca casa (nem com vazio)', () => {
    const boi36 = { sexo: 'Macho', idade_minima_meses: 37, idade_maxima_meses: null };
    assert.equal(derivaCategoriaOficial(boi36, 'TOURO + 36 MESES'), true);
    assert.equal(derivaCategoriaOficial(boi36, 'Boi 25 a 36 meses'), false);
    assert.equal(derivaCategoriaOficial({ sexo: 'Macho' }, ''), false);
    assert.equal(derivaCategoriaOficial({ sexo: 'Macho' }, null), false);
  });

  test('D5: sexo normalizado (NFD, sem acento, caixa alta)', () => {
    assert.deepEqual(['Macho', 'MACHO', ' macho ', 'Fêmea', 'FEMEA', 'Femea', 'FÊMEA', 'x', null].map(sexoOficial), ['MACHO', 'MACHO', 'MACHO', 'FEMEA', 'FEMEA', 'FEMEA', 'FEMEA', null, null]);
  });

  test('D6: a tabela cobre as 8 oficiais, faixas contíguas a partir de 0, a última aberta', () => {
    assert.equal(FAIXAS_CATEGORIA_OFICIAL.length, 4);
    FAIXAS_CATEGORIA_OFICIAL.forEach((f, i) => {
      assert.equal(f.de, i === 0 ? 0 : FAIXAS_CATEGORIA_OFICIAL[i - 1].ate + 1);
      assert.equal(f.ate === null, i === FAIXAS_CATEGORIA_OFICIAL.length - 1);
    });
    assert.equal(new Set(FAIXAS_CATEGORIA_OFICIAL.flatMap((f) => [f.MACHO, f.FEMEA])).size, 8);
  });

  test('as cinco faixas fixas do cadastro cabem cada uma numa faixa oficial; faixaIdadeDaLista casa só o par exato', () => {
    assert.deepEqual(
      FAIXAS_IDADE_CATEGORIA_MANEJO.map((f) => derivar({ sexo: 'Macho', ...f })),
      ['Bezerro 0 a 12 meses', 'Bezerro 0 a 12 meses', 'Garrote 13 a 24 meses', 'Boi 25 a 36 meses', 'Touro + 36 meses']
    );
    for (const f of FAIXAS_IDADE_CATEGORIA_MANEJO) assert.equal(faixaIdadeDaLista(f.idade_minima_meses, f.idade_maxima_meses), f);
    assert.equal(faixaIdadeDaLista('37', undefined)?.rotulo, 'Maior que 36 meses');
    for (const [min, max] of [[0, 12], [10, 20], [24, 12], [null, null], [37, 120], [8, 0], [1.5, 8]]) {
      assert.equal(faixaIdadeDaLista(min, max), null, JSON.stringify([min, max]));
    }
  });

  test('faixaContemIdade: limites inclusivos, mínima ausente = 0, máxima ausente = sem teto, sem idade nunca contém', () => {
    assert.equal(faixaContemIdade({ idade_minima_meses: 0, idade_maxima_meses: 8 }, 0), true);
    assert.equal(faixaContemIdade({ idade_minima_meses: 0, idade_maxima_meses: 8 }, 8), true);
    assert.equal(faixaContemIdade({ idade_minima_meses: 9, idade_maxima_meses: 12 }, 0), false);
    assert.equal(faixaContemIdade({ idade_minima_meses: null, idade_maxima_meses: 12 }, 0), true);
    assert.equal(faixaContemIdade({ idade_minima_meses: 37, idade_maxima_meses: null }, 400), true);
    assert.equal(faixaContemIdade({ idade_minima_meses: null, idade_maxima_meses: null }, 0), false);
    assert.equal(faixaContemIdade(null, 0), false);
  });
});
