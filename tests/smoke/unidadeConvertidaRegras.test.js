/**
 * D-PROD-310 — a quantidade numa unidade de conversão do produto no cocho, nas transferências e na atividade: as regras
 * da tela (a prévia da conta, o seletor e o corpo). Quem decide é o servidor (pelo cadastro); a tela faz a mesma conta
 * (uma vez, 4 casas, meio para cima) para mostrar "= 250 kg" e mandar a quantidade de estoque que ele confere.
 */
import { describe, expect, it } from 'vitest';
import {
  rotuloDoEstoque,
  unidadeDeEstoqueDoProduto,
  canonicoDigitado,
  conversaoEscolhida,
  corpoDaUnidade,
  opcoesDeUnidade,
  quantidadeEmEstoque,
  temConversoes,
  textoDaConversao,
} from '@/lib/unidadeLancamentoRegras';
import { camposAlteradosDaLinhaProduto, corpoDaLinhaProduto, formularioDaLinhaProduto, validarLinhaProduto } from '@/lib/atividadeLinhasRegras';
import { dadosDaTransferencia, quantidadeDaTransferencia } from '@/lib/estoqueEntradasRegras';

const conv = (sigla, operacao, fator, extra = {}) => ({ id: `c-${sigla}`, sigla, operacao, fator, uso_compra: true, uso_venda: true, ativa: true, ...extra });
const RACAO = {
  id: 'p1', unidade_estoque: 'KG', unidade_principal_estoque: 'KG',
  unidades_conversao: [conv('SACO', 'MULTIPLICA', '25.000000', { equivalencia: '1 SACO = 25 KG' }), conv('TERCO', 'DIVIDE', '3.000000'), conv('BALDE', 'MULTIPLICA', '20', { ativa: false }), conv('CX', 'MULTIPLICA', '10', { uso_venda: false })],
};
const SEM = { id: 'p2', unidade_estoque: 'KG', unidades_conversao: [] };

describe('UCR-1 — o seletor e a conta', () => {
  it('opções: a de estoque e as conversões ATIVAS com o uso (venda tira a só de compra); produto sem conversão = só a de estoque', () => {
    expect(opcoesDeUnidade(RACAO, { uso: 'venda' }).map((o) => o.value)).toEqual(['KG', 'SACO', 'TERCO']);
    expect(opcoesDeUnidade(RACAO).map((o) => o.value)).toEqual(['KG', 'SACO', 'TERCO', 'CX']);
    expect(opcoesDeUnidade(RACAO, { uso: 'venda' })[1].label).toBe('SACO (1 SACO = 25 KG)');
    expect(opcoesDeUnidade(SEM)).toEqual([{ value: 'KG', label: 'Quilos (kg)' }]);
    expect(temConversoes(SEM)).toBe(false);
    expect(temConversoes(RACAO, 'venda')).toBe(true);
    expect(opcoesDeUnidade({ unidade_principal_estoque: 'L', unidades_conversao: [] }, { rotuloEstoque: 'sigla' })).toEqual([{ value: 'L', label: 'L' }]);
  });

  it('a conta: SACO ×25; TERCO ÷3 arredonda UMA vez em 4 casas (2 ÷ 3 = 0,6667); a de estoque não converte; ilegível = null', () => {
    expect(quantidadeEmEstoque(RACAO, 'SACO', '10')).toBe('250.0000');
    expect(quantidadeEmEstoque(RACAO, 'TERCO', '2')).toBe('0.6667');
    expect(quantidadeEmEstoque(RACAO, 'KG', '7.5')).toBe('7.5000');
    expect(quantidadeEmEstoque(RACAO, 'SACO', null)).toBeNull();
    expect(textoDaConversao(RACAO, 'SACO', '10')).toBe('= 250 kg');
    expect(textoDaConversao(RACAO, 'KG', '10')).toBe('');
    expect(textoDaConversao({ unidade_estoque: 'L', unidades_conversao: [conv('GALAO', 'MULTIPLICA', '5')] }, 'GALAO', '3')).toBe('= 15 L');
  });

  it('a edição usa o fator GRAVADO (o cadastro mudou depois): 3 SACO = 75 kg (gravado 25), não 90 (cadastro 30); a sigla gravada desativada continua oferecida', () => {
    const mudou = { ...RACAO, unidades_conversao: [conv('SACO', 'MULTIPLICA', '30', { ativa: false })] };
    const gravado = { unidade: 'SACO', fator: '25.0000' };
    expect(quantidadeEmEstoque(mudou, 'SACO', '3', { gravado })).toBe('75.0000');
    expect(opcoesDeUnidade(mudou, { gravado }).map((o) => o.value)).toEqual(['KG', 'SACO']);
    expect(conversaoEscolhida(mudou, 'SACO', { gravado })).toBe('SACO');
    expect(conversaoEscolhida(mudou, 'SACO')).toBe('');
  });

  it('conversão escolhida, texto digitado e o corpo: só com uma conversão (nada novo sem ela)', () => {
    expect(conversaoEscolhida(RACAO, 'KG')).toBe('');
    expect(conversaoEscolhida(RACAO, 'BALDE')).toBe('', 'desativada');
    expect(conversaoEscolhida(RACAO, 'SACO')).toBe('SACO');
    expect(canonicoDigitado('12,5')).toBe('12.5');
    expect(canonicoDigitado('12.5')).toBe('12.5');
    expect(canonicoDigitado('1.234,5')).toBe('1234.5');
    expect(canonicoDigitado('abc')).toBeNull();
    expect(corpoDaUnidade('', '10')).toEqual({});
    expect(corpoDaUnidade('SACO', '10')).toEqual({ unidade_lancamento: 'SACO', quantidade_lancamento: '10' });
  });
});

describe('UCR-2 — a transferência da tela Estoque', () => {
  const form = (extra = {}) => ({ data: '2026-11-25', produto: { id: 'p1', rotulo: 'Ração', ...RACAO }, origem: { id: 'o' }, destino: { id: 'd' }, quantidade: '2', unidade: '', observacao: '', ...extra });
  it('sem unidade: os dados de sempre; com SACO: a quantidade em kg, a unidade e a digitada', () => {
    expect(dadosDaTransferencia(form(), 'op')).toEqual({ operationId: 'op', produtoId: 'p1', origemId: 'o', destinoId: 'd', quantidade: 2, data: '2026-11-25', observacao: null });
    expect(quantidadeDaTransferencia(form({ unidade: 'SACO' }))).toEqual({ quantidade: '50.0000', unidade: 'SACO', digitada: '2' });
    expect(dadosDaTransferencia(form({ unidade: 'SACO' }), 'op')).toMatchObject({ quantidade: 50, unidadeLancamento: 'SACO', quantidadeLancamento: '2' });
  });
});

describe('UCR-3 — a linha de produto da atividade', () => {
  const produto = { id: 'p1', rotulo: 'Ração', unidade_principal_estoque: 'KG', unidades_conversao: RACAO.unidades_conversao };
  it('o corpo leva a quantidade em kg (a conta) e, numa conversão, a unidade e a digitada; o saldo se compara em kg', () => {
    const base = { produto, local_estoque_id: 'l1', quantidade: '4', observacao: '' };
    expect(corpoDaLinhaProduto(base)).toEqual({ produto_id: 'p1', local_estoque_id: 'l1', quantidade: '4', observacao: null });
    expect(corpoDaLinhaProduto({ ...base, unidade: 'SACO' })).toEqual({ produto_id: 'p1', local_estoque_id: 'l1', quantidade: '100.0000', observacao: null, unidade_lancamento: 'SACO', quantidade_lancamento: '4' });
    expect(validarLinhaProduto({ ...base, unidade: 'SACO' }, { disponivel: '80.0000' }).aviso).toMatch(/disponível 80 kg, pedido 100 kg/);
    expect(validarLinhaProduto({ ...base, unidade: 'SACO' }, { disponivel: '120.0000' }).aviso).toBeNull();
  });

  it('a linha gravada numa conversão reabre nela, com o fator gravado; o PATCH manda as três juntas quando algo da quantidade muda, nada dela quando só a observação muda, e a quantidade em kg quando volta para kg', () => {
    const linha = { id: 'x', produto_id: 'p1', produto: { id: 'p1', nome: 'Ração' }, local_estoque_id: 'l1', quantidade: '50.0000', unidade: 'KG', unidade_lancamento: 'SACO', quantidade_lancamento: '2.0000', fator_lancamento: '25.0000', observacao: null };
    const f = formularioDaLinhaProduto(linha);
    expect(f).toMatchObject({ unidade: 'SACO', gravado: { unidade: 'SACO', fator: '25.0000' }, quantidade: '2' });
    expect(camposAlteradosDaLinhaProduto(linha, corpoDaLinhaProduto({ ...f, observacao: 'ok' }))).toEqual({ observacao: 'ok' });
    expect(camposAlteradosDaLinhaProduto(linha, corpoDaLinhaProduto({ ...f, quantidade: '3' }))).toEqual({ quantidade: '75.0000', unidade_lancamento: 'SACO', quantidade_lancamento: '3' });
    expect(camposAlteradosDaLinhaProduto(linha, corpoDaLinhaProduto({ ...f, unidade: '', quantidade: '50' }))).toEqual({ quantidade: '50' });
  });
});

describe('UCR-SC — D-PROD-369: a unidade de estoque real do cadastro', () => {
  const MILHO = { id: 'p9', unidade_estoque: 'SC', unidade_principal_estoque: 'SC', unidades_conversao: [conv('KG', 'DIVIDE', '25.000000', { equivalencia: '1 KG = 0,04 SC' })] };
  it('a sigla real (SACO legado e vazio = KG); o rótulo kg/L/sigla; o seletor e a conta em SC', () => {
    expect(['KG', 'L', 'SC', 'UN', 'SACO', '', null, ' sc '].map((u) => unidadeDeEstoqueDoProduto({ unidade_principal_estoque: u }))).toEqual(['KG', 'L', 'SC', 'UN', 'KG', 'KG', 'KG', 'SC']);
    expect([{ unidade_estoque: 'KG' }, { unidade_estoque: 'L' }, { unidade_estoque: 'SC' }, { unidade_principal_estoque: 'SACO' }].map(rotuloDoEstoque)).toEqual(['kg', 'L', 'SC', 'kg']);
    expect(opcoesDeUnidade(MILHO)).toEqual([{ value: 'SC', label: 'SC' }, { value: 'KG', label: 'KG (1 KG = 0,04 SC)' }]);
    expect(quantidadeEmEstoque(MILHO, 'KG', '500')).toBe('20.0000');
    expect(textoDaConversao(MILHO, 'KG', '500')).toBe('= 20 SC');
    expect(textoDaConversao(MILHO, 'SC', '3')).toBe('');
    expect(conversaoEscolhida(MILHO, 'KG')).toBe('KG');
    expect(conversaoEscolhida(MILHO, 'SC')).toBe('');
  });
});
