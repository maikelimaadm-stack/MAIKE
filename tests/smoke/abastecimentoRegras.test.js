/**
 * D-PROD-159, revisto pela D-PROD-162 — FE8: regras PURAS da tela
 * Abastecimentos (`src/lib/abastecimentoRegras.js`).
 *
 *  - quantidade = TODOS os vetores compartilhados com o servidor
 *    (`fixtures/abastecimentoVetores.json`, lidos também pelo teste PG): a
 *    baixa é EXATAMENTE o número digitado, na unidade do Produto (L ou KG);
 *  - capacidade só para Produto em L (vetores);
 *  - `montarCorpo*` exatos (decimais canônicos em texto, nada de número, sem
 *    `tipo_combustivel_id`/`quantidade_litros`/`conversao_*`);
 *  - `validarFormulario` com mensagens em pt-BR;
 *  - `conferirRespostaAbastecimento` aceita as formas novas e aponta violações
 *    (inclusive campo antigo de fator/litros/KG);
 *  - totais exatos (BigInt) POR UNIDADE: 0,1 + 0,2 = 0,3; litros e quilos nunca se somam.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as regras from '@/lib/abastecimentoRegras';
import {
  LIMITES_ABASTECIMENTO,
  PADRAO_OPERATION_ID,
  assinaturaDoFormulario,
  canonicoDoDigitado,
  conferirRespostaAbastecimento,
  formatarLitrosCurto,
  formatarQuantidade,
  formatarQuantidadeCurta,
  formularioVazio,
  medidorExigeLeitura,
  montarCorpoCancelamento,
  montarCorpoConfirmacao,
  montarCorpoPrevia,
  opcaoNoFormulario,
  produtoAutomatico,
  quantidadeDaBaixaNaPrevia,
  DICA_PRODUTO_EM_KG,
  DICA_PRODUTO_EM_SACO,
  UNIDADES_ABASTECIMENTO,
  UNIDADES_PRODUTO_ABASTECIMENTO,
  dicaDaUnidadeDoProduto,
  rotuloDaUnidade,
  situacaoDaEscolha,
  tanqueDoFormulario,
  totaisConfirmados,
  unidadeDoAbastecimentoDoProduto,
  unidadeDoFormulario,
  validarFormulario,
} from '@/lib/abastecimentoRegras';
import { acrescentarProduto, criarEstadoAbastecimentos, detalheDe, rotearAbastecimentos, semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';

// Mesmo arquivo do teste PG (escrito pela frente do backend de abastecimento, F3).
const VETORES = JSON.parse(readFileSync(process.env.ABASTECIMENTO_VETORES || 'tests/smoke/fixtures/abastecimentoVetores.json', 'utf8'));

const BEM_TRATOR = { id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: { tipo: 'HORIMETRO', unidade: 'h' } };
const BEM_GERADOR = { ...BEM_TRATOR, id: 'b3', codigo_frota: 'GR-01', nome: 'Gerador', natureza: 'EQUIPAMENTO', medidor: { tipo: 'SEM_MEDIDOR', unidade: null } };
const TANQUE = { id: 'tq1', identificador: 'Tanque principal', capacidade_litros: '180.0000' };
const PRODUTO_L = { id: 'p1', nome: 'Diesel S10 granel', codigo_interno: 'DS10', unidade_principal_estoque: 'L', tanques: [TANQUE], pronto: true };
const PRODUTO_KG = { ...PRODUTO_L, id: 'p6', nome: 'Diesel pesado (kg)', unidade_principal_estoque: 'KG' };

const formTrator = (extra = {}) => ({
  ...formularioVazio('2026-06-15'),
  bem: BEM_TRATOR,
  tanque_id: 'tq1',
  produto: PRODUTO_L,
  local_estoque_id: 'l1',
  quantidade: '1.234,5',
  medidor_leitura: '1.550,5',
  tanque_cheio: true,
  observacao: '  completou na sede  ',
  referencia_externa: '',
  ...extra,
});

describe('quantidade = vetores do servidor (a baixa é o número digitado, sem conversão)', () => {
  // O vetor usa o texto CANÔNICO (o que o corpo leva); o servidor recusa o resto com 400 ou com o bloqueio.
  it.each(VETORES.quantidade.filter((v) => v.recusa === null))('$digitado ($unidade) → baixa $baixa', (v) => {
    const form = formTrator({ produto: v.unidade === 'L' ? PRODUTO_L : PRODUTO_KG, quantidade: v.digitado.replace('.', ',') });
    const corpo = montarCorpoPrevia('emp-1', form);
    // O corpo leva o MESMO número (sem fator, sem arredondar): o servidor só fixa 4 casas.
    expect(corpo.quantidade).toBe(canonicoDoDigitado(v.digitado.replace('.', ','), LIMITES_ABASTECIMENTO.QUANTIDADE));
    expect(Number.isNaN(Number(corpo.quantidade))).toBe(false);
    expect(typeof corpo.quantidade).toBe('string');
    expect(validarFormulario(form, { hoje: '2026-06-15', capacidadeLitros: '99999.0000' }).erros.quantidade).toBeUndefined();
    // A revisão mostra como baixa exatamente o número do plano (o servidor devolve com 4 casas).
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: v.baixa, unidade: v.unidade }, bloqueios: [] })).toBe(v.baixa);
  });

  it.each(VETORES.quantidade.filter((v) => v.recusa === 'quantidade_nao_positiva'))('$digitado → recusa local "maior que zero" ($recusa)', (v) => {
    expect(validarFormulario(formTrator({ quantidade: v.digitado.replace('.', ',') }), { hoje: '2026-06-15' }).erros.quantidade).toBe('Informe uma quantidade maior que zero.');
  });

  it.each(VETORES.quantidade.filter((v) => v.recusa === 'formato'))('$digitado → a tela não monta o corpo ($recusa no servidor)', (v) => {
    // "1,5" no vetor é formato do SERVIDOR (vírgula no JSON); na tela, a vírgula é o decimal pt-BR e o ponto é milhar.
    if (v.digitado === '1,5') {
      expect(montarCorpoPrevia('emp-1', formTrator({ quantidade: '1,5' })).quantidade).toBe('1.5');
      return;
    }
    const digitado = v.digitado.replace('.', ',');
    expect(validarFormulario(formTrator({ quantidade: digitado }), { hoje: '2026-06-15' }).erros.quantidade).toBeTruthy();
    expect(() => montarCorpoPrevia('emp-1', formTrator({ quantidade: digitado }))).toThrow(RangeError);
  });

  it.each(VETORES.capacidade.casos)('capacidade 180 L: $quantidade $unidade → excede $excede', (c) => {
    const form = formTrator({ produto: c.unidade === 'L' ? PRODUTO_L : PRODUTO_KG, quantidade: c.quantidade.replace('.', ',') });
    const ctx = { hoje: '2026-06-15', capacidadeLitros: VETORES.capacidade.capacidade_litros };
    expect(validarFormulario(form, ctx).erros.quantidade === 'Os litros passam da capacidade nominal do tanque.').toBe(c.excede);
    // A unidade explícita no contexto (a do servidor) prevalece sobre a do formulário.
    expect(validarFormulario(formTrator({ quantidade: c.quantidade.replace('.', ',') }), { ...ctx, unidade: c.unidade }).erros.quantidade === 'Os litros passam da capacidade nominal do tanque.').toBe(c.excede);
  });
});

describe('corpos montados (decimais como TEXTO canônico; D-PROD-162 sem tipo, sem fator)', () => {
  it('prévia: quantidade e leitura do pt-BR para o canônico; textos aparados ou null; nenhum campo removido', () => {
    const corpo = montarCorpoPrevia('emp-1', formTrator());
    expect(corpo).toEqual({
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: '2026-06-15', quantidade: '1234.5', medidor_leitura: '1550.5', tanque_cheio: true,
      observacao: 'completou na sede', referencia_externa: null,
    });
    for (const campo of ['tipo_combustivel_id', 'quantidade_litros', 'conversao_id', 'conversao_versao']) expect(corpo).not.toHaveProperty(campo);
  });

  it('bem sem medidor: leitura null mesmo se algo foi digitado; quantidade inválida recusa (fail-closed)', () => {
    expect(montarCorpoPrevia('emp-1', formTrator({ bem: BEM_GERADOR, medidor_leitura: '10' })).medidor_leitura).toBeNull();
    expect(() => montarCorpoPrevia('emp-1', formTrator({ quantidade: '1,23456' }))).toThrow(RangeError);
    expect(() => montarCorpoPrevia('emp-1', formTrator({ quantidade: '' }))).toThrow(RangeError);
  });

  it('confirmação = EXATAMENTE a prévia (sem operation_id, sem fator); sem plano não monta', () => {
    const plano = { quantidade: '1234.5000', unidade: 'L' };
    expect(montarCorpoConfirmacao('emp-1', formTrator(), plano)).toEqual(montarCorpoPrevia('emp-1', formTrator()));
    expect(montarCorpoConfirmacao('emp-1', formTrator(), plano)).not.toHaveProperty('operation_id');
    expect(() => montarCorpoConfirmacao('emp-1', formTrator(), null)).toThrow(RangeError);
  });

  it('cancelamento', () => {
    expect(montarCorpoCancelamento('emp-1', { id: 'ab-1', versao: 2 }, '  duplicado  ')).toEqual({ empresa_id: 'emp-1', versao: 2, motivo: 'duplicado' });
  });

  it('assinatura muda quando o que a prévia viu muda (quantidade, leitura, produto, tanque cheio)', () => {
    const base = assinaturaDoFormulario(formTrator());
    expect(assinaturaDoFormulario(formTrator({ quantidade: '1234,5' }))).toBe(base);
    expect(assinaturaDoFormulario(formTrator({ quantidade: '1.234,6' }))).not.toBe(base);
    expect(assinaturaDoFormulario(formTrator({ tanque_cheio: false }))).not.toBe(base);
    expect(assinaturaDoFormulario(formTrator({ produto: { ...PRODUTO_L, id: 'p9' } }))).not.toBe(base);
  });

  it('operation_id no formato do servidor; contadores exigem leitura; sem limite de fator', () => {
    expect(PADRAO_OPERATION_ID.test('lanc-0b7f6a1e-9c2d-4c47-a1f3-1d2e3f4a5b6c')).toBe(true);
    expect(PADRAO_OPERATION_ID.test('curto')).toBe(false);
    expect(['HORIMETRO', 'ODOMETRO', 'CICLOS'].every(medidorExigeLeitura)).toBe(true);
    expect(medidorExigeLeitura('SEM_MEDIDOR')).toBe(false);
    expect(LIMITES_ABASTECIMENTO).toEqual({ QUANTIDADE: { inteiros: 10, casas: 4 }, LEITURA: { inteiros: 10, casas: 4 } });
  });

  it('nada de fator kg/L nem de conversão no módulo (D-PROD-162)', () => {
    for (const nome of ['estimarKg', 'kgDaBaixaNaPrevia', 'montarCorpoConversao', 'validarConversao', 'formatarKg', 'formatarFator', 'FATOR_MAXIMO']) expect(regras).not.toHaveProperty(nome);
  });
});

describe('validação local', () => {
  it('formulário completo passa; cada falta tem mensagem em pt-BR', () => {
    expect(validarFormulario(formTrator({ quantidade: '80' }), { hoje: '2026-06-15', capacidadeLitros: '180.0000' }).erros).toEqual({});
    expect(validarFormulario(formularioVazio('2026-06-15'), { hoje: '2026-06-15' }).erros).toMatchObject({ bem: 'Escolha a máquina ou veículo.', produto: 'Escolha o Produto.' });
    // Sem Produto, só "Escolha o Produto." (tanque e local dependem dele).
    const { erros } = validarFormulario({ ...formularioVazio('2026-06-15'), bem: BEM_TRATOR }, { hoje: '2026-06-15' });
    expect(erros).toEqual({
      produto: 'Escolha o Produto.',
      quantidade: 'Informe a quantidade abastecida.',
      medidor_leitura: 'Informe a leitura do medidor.',
    });
    // Com Produto: tanque (multi-tanque) e local (vários locais).
    expect(validarFormulario(formTrator({ tanque_id: null, local_estoque_id: null, quantidade: '80' }), { hoje: '2026-06-15' }).erros).toEqual({
      tanque_id: 'Escolha qual tanque será abastecido.',
      local_estoque_id: 'Escolha de qual local do estoque sai o Produto.',
    });
  });

  it('quantidade: zero, casas demais; acima da capacidade só em L; data futura; textos longos', () => {
    const ctx = { hoje: '2026-06-15', capacidadeLitros: '180.0000' };
    expect(validarFormulario(formTrator({ quantidade: '0' }), ctx).erros.quantidade).toBe('Informe uma quantidade maior que zero.');
    expect(validarFormulario(formTrator({ quantidade: '1,23456' }), ctx).erros.quantidade).toBe('No máximo 4 casas decimais.');
    expect(validarFormulario(formTrator({ quantidade: '180,0001' }), ctx).erros.quantidade).toBe('Os litros passam da capacidade nominal do tanque.');
    expect(validarFormulario(formTrator({ quantidade: '180' }), ctx).erros.quantidade).toBeUndefined();
    // Produto em KG: o número da capacidade (litros) NÃO limita os quilos.
    expect(validarFormulario(formTrator({ produto: PRODUTO_KG, quantidade: '500' }), ctx).erros.quantidade).toBeUndefined();
    // D-PROD-163: Produto em SACO baixa em kg — a capacidade (litros) também não limita.
    expect(validarFormulario(formTrator({ produto: { ...PRODUTO_L, unidade_principal_estoque: 'SACO' }, quantidade: '500' }), ctx).erros.quantidade).toBeUndefined();
    expect(validarFormulario(formTrator({ produto: { ...PRODUTO_L, unidade_principal_estoque: 'SACO' }, quantidade: '500' }), { ...ctx, unidade: 'SACO' }).erros.quantidade).toBeUndefined();
    // Unidade desconhecida (Produto fora de L/KG/SACO): a tela não promete capacidade; o servidor bloqueia o Produto.
    expect(validarFormulario(formTrator({ produto: { ...PRODUTO_L, unidade_principal_estoque: 'UN' }, quantidade: '500' }), ctx).erros.quantidade).toBeUndefined();
    expect(validarFormulario(formTrator({ quantidade: '80', data_operacional: '2026-06-16' }), ctx).erros.data_operacional).toBe('A data não pode ser posterior a hoje na fazenda.');
    expect(validarFormulario(formTrator({ quantidade: '80', observacao: 'x'.repeat(501), referencia_externa: 'r'.repeat(65) }), ctx).erros).toEqual({
      observacao: 'No máximo 500 caracteres.',
      referencia_externa: 'No máximo 64 caracteres.',
    });
  });

  it('unidade do formulário: a unidade EFETIVA do estoque do Produto (L; KG e SACO → KG, D-PROD-163), senão null', () => {
    expect(unidadeDoFormulario(formTrator())).toBe('L');
    expect(unidadeDoFormulario(formTrator({ produto: PRODUTO_KG }))).toBe('KG');
    expect(unidadeDoFormulario(formTrator({ produto: { ...PRODUTO_L, unidade_principal_estoque: 'SACO' } }))).toBe('KG');
    expect(unidadeDoFormulario(formTrator({ produto: { ...PRODUTO_L, unidade_principal_estoque: 'UN' } }))).toBeNull();
    expect(unidadeDoFormulario(formularioVazio('2026-06-15'))).toBeNull();
  });

  it('D-PROD-163: unidades do Produto (L, KG, SACO) × unidade gravada (L, KG); dica por unidade do Produto', () => {
    expect([...UNIDADES_PRODUTO_ABASTECIMENTO]).toEqual(['L', 'KG', 'SACO']);
    expect([...UNIDADES_ABASTECIMENTO]).toEqual(['L', 'KG']);
    expect(['L', 'KG', 'SACO', 'UN', null].map(unidadeDoAbastecimentoDoProduto)).toEqual(['L', 'KG', 'KG', null, null]);
    expect(dicaDaUnidadeDoProduto('L')).toBeNull();
    expect(dicaDaUnidadeDoProduto('KG')).toBe(DICA_PRODUTO_EM_KG);
    expect(dicaDaUnidadeDoProduto('SACO')).toBe(DICA_PRODUTO_EM_SACO);
    expect(DICA_PRODUTO_EM_SACO).toBe('Este Produto é em sacos, com estoque em quilos: digite kg (não sacos nem os litros da bomba).');
    expect(dicaDaUnidadeDoProduto('UN')).toBeNull();
    // A baixa da prévia de um Produto em SACO vem em KG (unidade efetiva) e aparece como baixa.
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '25.0000', unidade: 'KG' }, bloqueios: [] })).toBe('25.0000');
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '25.0000', unidade: null }, bloqueios: [] })).toBeNull();
  });
});

describe('conferirRespostaAbastecimento (§6.1 revisto pela D-PROD-162)', () => {
  it('detalhe, lista, prévia e consumo do backend falso são conformes (L e KG)', async () => {
    const e = criarEstadoAbastecimentos();
    acrescentarProduto(e, 'p6', 'Diesel pesado (kg)', { unidade: 'KG', lote: '500.0000', tanques: [['b1', 'tq1']] });
    const corpo = { bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: true };
    const detalhe = await semearAbastecimento(e, corpo);
    expect(conferirRespostaAbastecimento(detalhe)).toEqual([]);
    expect([detalhe.quantidade, detalhe.unidade, detalhe.movimentacao.quantidade, detalhe.movimentacao.unidade]).toEqual(['80.0000', 'L', '80.0000', 'L']);
    const kg = await semearAbastecimento(e, { ...corpo, produto_id: 'p6', quantidade: '250', medidor_leitura: '1560', data_operacional: '2026-06-11' });
    expect(conferirRespostaAbastecimento(kg)).toEqual([]);
    expect([kg.quantidade, kg.unidade]).toEqual(['250.0000', 'KG']);
    const q = (s) => new URLSearchParams(s);
    const lista = await rotearAbastecimentos(e, { method: 'GET', path: '/patrimonio-abastecimentos', query: q('empresa_id=emp-1'), body: null });
    expect(conferirRespostaAbastecimento(lista.body)).toEqual([]);
    const previa = await rotearAbastecimentos(e, { method: 'POST', path: '/patrimonio-abastecimentos-previa', query: q(''), body: { empresa_id: 'emp-1', ...corpo, medidor_leitura: '1570' } });
    expect(conferirRespostaAbastecimento(previa.body)).toEqual([]);
    const consumo = await rotearAbastecimentos(e, { method: 'GET', path: '/patrimonio-abastecimentos-consumo', query: q('empresa_id=emp-1&bem_id=b1'), body: null });
    expect(conferirRespostaAbastecimento(consumo.body)).toEqual([]);
    // As rotas de fator e de tipo não existem mais no fake (D-PROD-162).
    for (const path of ['/patrimonio-conversoes-combustivel', '/patrimonio-abastecimentos-opcoes/tipos', '/patrimonio-abastecimentos-opcoes/produtos']) {
      expect(await rotearAbastecimentos(e, { method: 'GET', path, query: q('empresa_id=emp-1'), body: null })).toBeUndefined();
    }
  });

  it('aponta casas erradas, número no lugar de texto, unidade inválida, status, chaves ausentes e campos removidos', async () => {
    const e = criarEstadoAbastecimentos();
    const d = await semearAbastecimento(e, { bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade: '80', medidor_leitura: '1550.5' });
    const base = detalheDe(e, e.abastecimentos[0]);
    expect(conferirRespostaAbastecimento({ ...base, quantidade: '80' })).toEqual([expect.stringContaining('abastecimento.quantidade')]);
    expect(conferirRespostaAbastecimento({ ...base, unidade: 'SACO' })).toEqual([expect.stringContaining('abastecimento.unidade')]);
    expect(conferirRespostaAbastecimento({ ...base, custo_total: 354.6 })).toEqual([expect.stringContaining('abastecimento.custo_total')]);
    expect(conferirRespostaAbastecimento({ ...base, status: 'RASCUNHO' })).toEqual([expect.stringContaining('abastecimento.status')]);
    expect(conferirRespostaAbastecimento({ ...base, data_operacional: '10/06/2026' })).toEqual([expect.stringContaining('abastecimento.data_operacional')]);
    expect(conferirRespostaAbastecimento({ ...base, kg_por_litro: '0.840000' })).toEqual([expect.stringContaining('abastecimento.kg_por_litro: campo removido')]);
    expect(conferirRespostaAbastecimento({ ...base, quantidade_kg: '67.2000' })).toEqual([expect.stringContaining('abastecimento.quantidade_kg: campo removido')]);
    const { fatias, ...semFatias } = base;
    expect(fatias.length).toBeGreaterThan(0);
    expect(conferirRespostaAbastecimento(semFatias)).toEqual(expect.arrayContaining([expect.stringContaining('abastecimento.fatias')]));
    expect(conferirRespostaAbastecimento({ plano: { quantidade: '80.0000', unidade: 'KG', confere_capacidade: true }, bloqueios: [] })).toEqual(
      expect.arrayContaining(['plano.confere_capacidade: só vale para Produto em L']),
    );
    expect(d.replay).toBe(false);
  });
});

describe('totais exatos, por unidade', () => {
  it('0,1 L + 0,2 L = 0,3000 L (BigInt); quilos à parte; cancelados não contam', () => {
    const itens = [
      { status: 'CONFIRMADO', quantidade: '0.1000', unidade: 'L' },
      { status: 'CONFIRMADO', quantidade: '0.2000', unidade: 'L' },
      { status: 'CONFIRMADO', quantidade: '45.5000', unidade: 'KG' },
      { status: 'CANCELADO', quantidade: '9.0000', unidade: 'L' },
    ];
    expect(totaisConfirmados(itens)).toEqual({ quantidade: 3, totais: [{ unidade: 'L', total: '0.3000' }, { unidade: 'KG', total: '45.5000' }] });
    expect(totaisConfirmados([{ status: 'CONFIRMADO', quantidade: '9999999999.9999', unidade: 'L' }, { status: 'CONFIRMADO', quantidade: '0.0001', unidade: 'L' }]).totais).toEqual([
      { unidade: 'L', total: '10000000000.0000' },
    ]);
    expect(totaisConfirmados([{ status: 'CONFIRMADO', quantidade: '3.0000', unidade: 'KG' }])).toEqual({ quantidade: 1, totais: [{ unidade: 'KG', total: '3.0000' }] });
    expect(totaisConfirmados([])).toEqual({ quantidade: 0, totais: [] });
  });
});

describe('quantidadeDaBaixaNaPrevia — a quantidade do plano só aparece como baixa sem bloqueio de quantidade', () => {
  const bloqueio = (reason) => ({ code: 'OPERACAO_VALORES_INVALIDOS', field: 'quantidade', reason, details: {} });
  it('sem bloqueio: a quantidade do plano (L e KG); com outro bloqueio (saldo, medidor): ainda a quantidade', () => {
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '80.0000', unidade: 'L' }, bloqueios: [] })).toBe('80.0000');
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '250.0000', unidade: 'KG' }, bloqueios: [] })).toBe('250.0000');
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '80.0000', unidade: 'L' }, bloqueios: [{ code: 'ESTOQUE_SALDO_INSUFICIENTE', reason: 'saldo_lote_insuficiente' }] })).toBe('80.0000');
  });
  it('zero, acima do teto, Produto fora de L/KG (unidade null) ou sem plano: null (nada de "baixa de 0 L")', () => {
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '0.0000', unidade: 'L' }, bloqueios: [bloqueio('quantidade_nao_positiva')] })).toBeNull();
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '0.0000', unidade: 'L' }, bloqueios: [] })).toBeNull();
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '9999999999.9999', unidade: 'L' }, bloqueios: [bloqueio('valor_excede_limite_estoque')] })).toBeNull();
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: '80.0000', unidade: null }, bloqueios: [] })).toBeNull();
    expect(quantidadeDaBaixaNaPrevia({ plano: { quantidade: null, unidade: 'L' }, bloqueios: [] })).toBeNull();
    expect(quantidadeDaBaixaNaPrevia(null)).toBeNull();
  });
});

// ─── Opção de PRODUTO do bem → formulário (A16) ─────────────────────────
const ITEM_DIESEL = {
  id: 'p1',
  produto: { id: 'p1', nome: 'Diesel S10 granel', codigo_interno: 'DS10', unidade_principal_estoque: 'L' },
  tanques: [TANQUE],
  pronto: true,
};
const DOIS_TANQUES = [
  { id: 'tqA', identificador: 'Tanque A', capacidade_litros: '180.0000' },
  { id: 'tqB', identificador: 'Tanque B', capacidade_litros: '60.0000' },
];
const resposta = (itens, extra = {}) => ({
  bem: { id: 'b1' }, itens, has_more: false, next_cursor: null,
  resumo: { motivo_sem_opcao: itens.length ? null : 'tanque_sem_produto', total: itens.length, fora_de_unidade: 0, inativos_ou_outra_fazenda: 0 }, ...extra,
});

describe('opcaoNoFormulario — os tanques vêm da opção do servidor; sem tipo de combustível', () => {
  it('um tanque: tanque da opção; as chaves do formulário não mudam; o corpo da prévia não tem tipo', () => {
    const base = { ...formularioVazio('2026-06-15'), bem: BEM_TRATOR, quantidade: '80', medidor_leitura: '1.550,5' };
    const form = opcaoNoFormulario(base, ITEM_DIESEL);
    expect(form.produto).toEqual({ ...ITEM_DIESEL.produto, tanques: ITEM_DIESEL.tanques, pronto: true });
    expect([form.tanque_id, form.local_estoque_id]).toEqual(['tq1', null]);
    expect(Object.keys(form).sort()).toEqual(Object.keys(base).sort());
    expect(form).not.toHaveProperty('tipo_combustivel_id');
    expect(montarCorpoPrevia('emp-1', { ...form, local_estoque_id: 'l1' })).toEqual({
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: '2026-06-15', quantidade: '80', medidor_leitura: '1550.5', tanque_cheio: false, observacao: null, referencia_externa: null,
    });
  });

  it('multi-tanque: pergunta o tanque; mantém o escolhido só para o MESMO Produto e se continua aceito; local só sobrevive no mesmo Produto', () => {
    const item = { ...ITEM_DIESEL, tanques: DOIS_TANQUES };
    const f1 = opcaoNoFormulario(formularioVazio('2026-06-15'), item);
    expect(f1.tanque_id).toBeNull();
    const escolhido = { ...f1, tanque_id: 'tqB', local_estoque_id: 'l1' };
    expect(opcaoNoFormulario(escolhido, item)).toMatchObject({ tanque_id: 'tqB', local_estoque_id: 'l1' });
    expect(opcaoNoFormulario(escolhido, { ...item, tanques: [DOIS_TANQUES[0], { id: 'tqC', identificador: 'C', capacidade_litros: null }] }).tanque_id).toBeNull();
    const outro = { ...item, id: 'p5', produto: { ...item.produto, id: 'p5', nome: 'Diesel S10 posto' } };
    expect(opcaoNoFormulario(escolhido, outro)).toMatchObject({ tanque_id: null, local_estoque_id: null });
    expect(tanqueDoFormulario(escolhido)).toEqual(DOIS_TANQUES[1]);
    expect(tanqueDoFormulario({ ...escolhido, tanque_id: 'tqX' })).toBeNull();
    expect(tanqueDoFormulario(formularioVazio('2026-06-15'))).toBeNull();
  });
});

describe('produtoAutomatico — só resposta COMPLETA, do bem atual, com 1 opção', () => {
  it('1 opção e has_more=false → a opção', () => {
    expect(produtoAutomatico(resposta([ITEM_DIESEL]), 'b1')).toBe(ITEM_DIESEL);
  });
  it('página parcial (has_more=true), 2 opções, nenhuma, outro bem ou resposta vazia → null', () => {
    expect(produtoAutomatico(resposta([ITEM_DIESEL], { has_more: true, next_cursor: 'x' }), 'b1')).toBeNull();
    expect(produtoAutomatico(resposta([ITEM_DIESEL], { has_more: undefined }), 'b1')).toBeNull();
    expect(produtoAutomatico(resposta([ITEM_DIESEL, { ...ITEM_DIESEL, id: 'p5' }]), 'b1')).toBeNull();
    expect(produtoAutomatico(resposta([]), 'b1')).toBeNull();
    expect(produtoAutomatico(resposta([ITEM_DIESEL]), 'b2')).toBeNull();
    expect(produtoAutomatico(null, 'b1')).toBeNull();
    expect(produtoAutomatico(resposta([ITEM_DIESEL]), null)).toBeNull();
  });
});

describe('situacaoDaEscolha — ausente só com resposta completa sem o Produto do formulário', () => {
  const form = opcaoNoFormulario({ ...formularioVazio('2026-06-15'), bem: BEM_TRATOR }, ITEM_DIESEL);
  it('presente / ausente / indeterminado', () => {
    expect(situacaoDaEscolha(resposta([ITEM_DIESEL]), form)).toBe('presente');
    expect(situacaoDaEscolha(resposta([]), form)).toBe('ausente');
    expect(situacaoDaEscolha(resposta([{ ...ITEM_DIESEL, id: 'p9', produto: { ...ITEM_DIESEL.produto, id: 'p9' } }]), form)).toBe('ausente');
    expect(situacaoDaEscolha(resposta([], { has_more: true, next_cursor: 'x' }), form)).toBe('indeterminado');
    expect(situacaoDaEscolha({ ...resposta([]), bem: { id: 'b2' } }, form)).toBe('indeterminado');
    expect(situacaoDaEscolha(resposta([]), { ...form, produto: null })).toBe('indeterminado');
    expect(situacaoDaEscolha(null, form)).toBe('indeterminado');
  });
});

describe('formatação (sem float)', () => {
  it('litros sem zeros à direita; quantidade com a unidade do Produto', () => {
    expect(formatarLitrosCurto('180.0000')).toBe('180');
    expect(formatarLitrosCurto('80.5000')).toBe('80,5');
    expect(formatarLitrosCurto('1234.5678')).toBe('1.234,5678');
    expect(formatarQuantidade('120.0000', 'L')).toBe('120,0000 L');
    expect(formatarQuantidade('80.0000', 'KG')).toBe('80,0000 kg');
    expect(formatarQuantidade('80.0000', 'SACO')).toBe('80,0000 kg');
    expect(formatarQuantidade('80.0000', 'UN')).toBe('80,0000');
    expect(formatarQuantidadeCurta('80.0000', 'L')).toBe('80 L');
    expect(formatarQuantidadeCurta('1200.5000', 'KG')).toBe('1.200,5 kg');
    expect([rotuloDaUnidade('L'), rotuloDaUnidade('KG'), rotuloDaUnidade('SACO'), rotuloDaUnidade('UN'), rotuloDaUnidade(null)]).toEqual(['L', 'kg', 'kg', '', '']);
  });
});
