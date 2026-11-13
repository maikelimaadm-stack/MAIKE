/**
 * MAIKE-CATEGORIA-MANEJO-ENXUGAR — espelho no frontend da categoria oficial
 * DERIVADA de sexo + faixa de idade da categoria de manejo. Mesma tabela de
 * exemplos do teste de backend (`backend/tests/categoriaOficialDerivada.test.mjs`)
 * e prova de que front e back concordam (tabela e função).
 */
import { describe, it, expect } from 'vitest';
import {
  FAIXAS_CATEGORIA_OFICIAL,
  CATEGORIAS_OFICIAIS,
  categoriaOficialDaCategoriaManejo as derivar,
  derivaCategoriaOficial,
} from '@/domain/lotes/categoriaOficialDerivada';
import { CATEGORIAS_MATERNAS } from '@/domain/lotes/manejoRebanho';

/** [sexo, idade_minima_meses, idade_maxima_meses, oficial esperada] */
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

describe('categoria oficial derivada (frontend)', () => {
  it('tabela de exemplos: faixa inteira dentro de uma oficial deriva; atravessar faixa, sem idade ou inválida → null', () => {
    for (const [sexo, idade_minima_meses, idade_maxima_meses, esperada] of CASOS) {
      expect(derivar({ sexo, idade_minima_meses, idade_maxima_meses }), JSON.stringify([sexo, idade_minima_meses, idade_maxima_meses])).toBe(esperada);
    }
  });

  it('o nome nunca é a chave: "BOI + 36 MESES" Macho 37+ → Touro; nome igual ao texto oficial sem faixa → null', () => {
    expect(derivar({ nome: 'BOI + 36 MESES', sexo: 'Macho', idade_minima_meses: 37, idade_maxima_meses: null })).toBe('Touro + 36 meses');
    expect(derivar({ nome: 'BEZERRO 09 A 12 MESES', sexo: 'MACHO', idade_minima_meses: 9, idade_maxima_meses: 12 })).toBe('Bezerro 0 a 12 meses');
    expect(derivar({ nome: 'Touro + 36 meses', sexo: 'Macho' })).toBeNull();
    expect(derivaCategoriaOficial({ sexo: 'Macho' }, '')).toBe(false);
    expect(derivaCategoriaOficial({ sexo: 'Macho', idade_minima_meses: 37 }, 'TOURO + 36 MESES')).toBe(true);
  });

  it('as 8 oficiais na ordem do servidor; as categorias maternas são todas fêmeas derivadas da tabela', () => {
    expect(CATEGORIAS_OFICIAIS).toEqual([
      'Bezerro 0 a 12 meses', 'Bezerra 0 a 12 meses', 'Garrote 13 a 24 meses', 'Novilha 13 a 24 meses',
      'Boi 25 a 36 meses', 'Vaca 25 a 36 meses', 'Touro + 36 meses', 'Vaca + 36 meses',
    ]);
    const femeas = FAIXAS_CATEGORIA_OFICIAL.map((f) => f.FEMEA);
    for (const materna of CATEGORIAS_MATERNAS) expect(femeas).toContain(materna);
  });

  it('frontend e backend concordam: mesma tabela de faixas, mesma lista oficial e mesmo resultado em todos os casos', async () => {
    const back = await import('../../backend/src/modules/movimentacoesMapa/categoriaOficialDerivada.js');
    expect(JSON.parse(JSON.stringify(back.FAIXAS_CATEGORIA_OFICIAL))).toEqual(JSON.parse(JSON.stringify(FAIXAS_CATEGORIA_OFICIAL)));
    expect(back.FAIXAS_CATEGORIA_OFICIAL.flatMap((f) => [f.MACHO, f.FEMEA])).toEqual([...CATEGORIAS_OFICIAIS]);
    for (const [sexo, idade_minima_meses, idade_maxima_meses] of CASOS) {
      const c = { sexo, idade_minima_meses, idade_maxima_meses };
      expect(back.categoriaOficialDaCategoriaManejo(c)).toBe(derivar(c));
    }
  });
});
