/**
 * D-PROD-159 — FE8: regras PURAS da tela Abastecimentos (`src/lib/abastecimentoRegras.js`).
 *
 *  - `estimarKg` = TODOS os vetores compartilhados com o servidor
 *    (`fixtures/abastecimentoVetores.json`, lidos também pelo teste PG);
 *  - `montarCorpo*` exatos (decimais canônicos em texto, nada de número);
 *  - `validarFormulario` / `validarConversao` com mensagens em pt-BR;
 *  - `conferirRespostaAbastecimento` aceita as formas do §6.1 e aponta violações;
 *  - totais exatos (BigInt): 0,1 + 0,2 = 0,3.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LIMITES_ABASTECIMENTO,
  PADRAO_OPERATION_ID,
  assinaturaDoFormulario,
  conferirRespostaAbastecimento,
  estimarKg,
  formatarLitrosCurto,
  formularioVazio,
  kgDaBaixaNaPrevia,
  medidorExigeLeitura,
  montarCorpoCancelamento,
  montarCorpoConfirmacao,
  montarCorpoConversao,
  montarCorpoPrevia,
  opcaoNoFormulario,
  produtoAutomatico,
  situacaoDaEscolha,
  tanqueDoFormulario,
  totaisConfirmados,
  validarConversao,
  validarFormulario,
} from '@/lib/abastecimentoRegras';
import { criarEstadoAbastecimentos, detalheDe, rotearAbastecimentos, semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';

// Mesmo arquivo do teste PG (cópia exata do contrato, escrita pelo núcleo backend).
const VETORES = JSON.parse(readFileSync(process.env.ABASTECIMENTO_VETORES || 'tests/smoke/fixtures/abastecimentoVetores.json', 'utf8'));

const BEM_TRATOR = { id: 'b1', numero: '7', codigo_frota: 'TP-02', nome: 'Trator TP-02', natureza: 'MAQUINA', ativo: true, medidor: { tipo: 'HORIMETRO', unidade: 'h' } };
const BEM_GERADOR = { ...BEM_TRATOR, id: 'b3', codigo_frota: 'GR-01', nome: 'Gerador', natureza: 'EQUIPAMENTO', medidor: { tipo: 'SEM_MEDIDOR', unidade: null } };
const PRODUTO = { id: 'p1', nome: 'Diesel S10 granel', unidade_principal_estoque: 'KG', conversao: { id: 'f1', versao: 1, sequencia: 1, kg_por_litro: '0.840000' } };

const formTrator = (extra = {}) => ({
  ...formularioVazio('2026-06-15'),
  bem: BEM_TRATOR,
  tanque_id: 'tq1',
  tipo_combustivel_id: 'c1',
  produto: PRODUTO,
  local_estoque_id: 'l1',
  quantidade_litros: '1.234,5',
  medidor_leitura: '1.550,5',
  tanque_cheio: true,
  observacao: '  completou na sede  ',
  referencia_externa: '',
  ...extra,
});

describe('estimarKg = vetores do servidor (ROUND_HALF_UP 4 casas, uma vez)', () => {
  it.each(VETORES.conversao)('$litros L × $kg_por_litro → $kg ($recusa)', (v) => {
    expect(estimarKg(v.litros, v.kg_por_litro)).toBe(v.kg);
  });

  it('FIFO do vetor: kg do abastecimento de 80 L', () => {
    expect(estimarKg(VETORES.fifo.litros, VETORES.fifo.kg_por_litro)).toBe(VETORES.fifo.kg);
  });

  it('entrada que não é texto canônico não vira número', () => {
    expect(estimarKg(80, '0.84')).toBeNull();
    expect(estimarKg('80,5', '0.84')).toBeNull();
    expect(estimarKg('80', null)).toBeNull();
  });
});

describe('corpos montados (decimais como TEXTO canônico)', () => {
  it('prévia: litros e leitura do pt-BR para o canônico; textos aparados ou null', () => {
    expect(montarCorpoPrevia('emp-1', formTrator())).toEqual({
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: '2026-06-15', quantidade_litros: '1234.5', medidor_leitura: '1550.5', tanque_cheio: true,
      observacao: 'completou na sede', referencia_externa: null,
    });
  });

  it('bem sem medidor: leitura null mesmo se algo foi digitado; litros inválido recusa (fail-closed)', () => {
    expect(montarCorpoPrevia('emp-1', formTrator({ bem: BEM_GERADOR, medidor_leitura: '10' })).medidor_leitura).toBeNull();
    expect(() => montarCorpoPrevia('emp-1', formTrator({ quantidade_litros: '1,23456' }))).toThrow(RangeError);
    expect(() => montarCorpoPrevia('emp-1', formTrator({ quantidade_litros: '' }))).toThrow(RangeError);
  });

  it('confirmação = prévia + fator do PLANO (sem operation_id); sem fator no plano não monta', () => {
    const plano = { conversao: { id: 'f2', versao: 3, sequencia: 2, kg_por_litro: '0.850000' } };
    expect(montarCorpoConfirmacao('emp-1', formTrator(), plano)).toEqual({ ...montarCorpoPrevia('emp-1', formTrator()), conversao_id: 'f2', conversao_versao: 3 });
    expect(montarCorpoConfirmacao('emp-1', formTrator(), plano)).not.toHaveProperty('operation_id');
    expect(() => montarCorpoConfirmacao('emp-1', formTrator(), { conversao: null })).toThrow(RangeError);
  });

  it('cancelamento e fator', () => {
    expect(montarCorpoCancelamento('emp-1', { id: 'ab-1', versao: 2 }, '  duplicado  ')).toEqual({ empresa_id: 'emp-1', versao: 2, motivo: 'duplicado' });
    expect(montarCorpoConversao('emp-1', { tipo_combustivel_id: 'c1', produto_id: 'p1', kg_por_litro: '0,84', declara_estoque_em_kg: true }, 'f1')).toEqual({
      empresa_id: 'emp-1', tipo_combustivel_id: 'c1', produto_id: 'p1', kg_por_litro: '0.84', declara_estoque_em_kg: true, conversao_vigente_id: 'f1',
    });
    expect(montarCorpoConversao('emp-1', { tipo_combustivel_id: 'c1', produto_id: 'p1', kg_por_litro: '9,999999', declara_estoque_em_kg: false }, null)).toMatchObject({
      kg_por_litro: '9.999999', declara_estoque_em_kg: false, conversao_vigente_id: null,
    });
    expect(() => montarCorpoConversao('emp-1', { tipo_combustivel_id: 'c1', produto_id: 'p1', kg_por_litro: '0,1234567', declara_estoque_em_kg: true }, null)).toThrow(RangeError);
  });

  it('assinatura muda quando o que a prévia viu muda (litros, leitura, produto, tanque cheio)', () => {
    const base = assinaturaDoFormulario(formTrator());
    expect(assinaturaDoFormulario(formTrator({ quantidade_litros: '1234,5' }))).toBe(base);
    expect(assinaturaDoFormulario(formTrator({ quantidade_litros: '1.234,6' }))).not.toBe(base);
    expect(assinaturaDoFormulario(formTrator({ tanque_cheio: false }))).not.toBe(base);
    expect(assinaturaDoFormulario(formTrator({ produto: { ...PRODUTO, id: 'p9' } }))).not.toBe(base);
  });

  it('operation_id no formato do servidor; contadores exigem leitura', () => {
    expect(PADRAO_OPERATION_ID.test('lanc-0b7f6a1e-9c2d-4c47-a1f3-1d2e3f4a5b6c')).toBe(true);
    expect(PADRAO_OPERATION_ID.test('curto')).toBe(false);
    expect(['HORIMETRO', 'ODOMETRO', 'CICLOS'].every(medidorExigeLeitura)).toBe(true);
    expect(medidorExigeLeitura('SEM_MEDIDOR')).toBe(false);
    expect(LIMITES_ABASTECIMENTO.FATOR).toEqual({ inteiros: 2, casas: 6 });
  });
});

describe('validação local', () => {
  it('formulário completo passa; cada falta tem mensagem em pt-BR', () => {
    expect(validarFormulario(formTrator({ quantidade_litros: '80' }), { hoje: '2026-06-15', capacidadeLitros: '180.0000' }).erros).toEqual({});
    expect(validarFormulario(formularioVazio('2026-06-15'), { hoje: '2026-06-15' }).erros).toMatchObject({ bem: 'Escolha a máquina ou veículo.', produto: 'Escolha o Produto.' });
    // UX-02: sem Produto, só "Escolha o Produto." (tanque e local dependem dele; nunca "Escolha o combustível.").
    const { erros } = validarFormulario({ ...formularioVazio('2026-06-15'), bem: BEM_TRATOR }, { hoje: '2026-06-15' });
    expect(erros).toEqual({
      produto: 'Escolha o Produto.',
      quantidade_litros: 'Informe os litros abastecidos.',
      medidor_leitura: 'Informe a leitura do medidor.',
    });
    // Produto sem tipo (opção incompleta) também é "Escolha o Produto.".
    expect(validarFormulario(formTrator({ tipo_combustivel_id: null, quantidade_litros: '80' }), { hoje: '2026-06-15' }).erros).toEqual({ produto: 'Escolha o Produto.' });
    // Com Produto: tanque (multi-tanque) e local (vários locais) com os textos novos.
    expect(validarFormulario(formTrator({ tanque_id: null, local_estoque_id: null, quantidade_litros: '80' }), { hoje: '2026-06-15' }).erros).toEqual({
      tanque_id: 'Escolha qual tanque será abastecido.',
      local_estoque_id: 'Escolha de qual local do estoque sai o combustível.',
    });
  });

  it('litros: zero, casas demais, acima da capacidade; data futura; textos longos', () => {
    const ctx = { hoje: '2026-06-15', capacidadeLitros: '180.0000' };
    expect(validarFormulario(formTrator({ quantidade_litros: '0' }), ctx).erros.quantidade_litros).toBe('Informe litros maiores que zero.');
    expect(validarFormulario(formTrator({ quantidade_litros: '1,23456' }), ctx).erros.quantidade_litros).toBe('No máximo 4 casas decimais.');
    expect(validarFormulario(formTrator({ quantidade_litros: '180,0001' }), ctx).erros.quantidade_litros).toBe('Os litros passam da capacidade nominal do tanque.');
    expect(validarFormulario(formTrator({ quantidade_litros: '180' }), ctx).erros.quantidade_litros).toBeUndefined();
    expect(validarFormulario(formTrator({ quantidade_litros: '80', data_operacional: '2026-06-16' }), ctx).erros.data_operacional).toBe('A data não pode ser posterior a hoje na fazenda.');
    expect(validarFormulario(formTrator({ quantidade_litros: '80', observacao: 'x'.repeat(501), referencia_externa: 'r'.repeat(65) }), ctx).erros).toEqual({
      observacao: 'No máximo 500 caracteres.',
      referencia_externa: 'No máximo 64 caracteres.',
    });
  });

  it('fator: > 0, ≤ 10, até 6 casas, declaração', () => {
    const base = { tipo_combustivel_id: 'c1', produto_id: 'p1', declara_estoque_em_kg: true };
    expect(validarConversao({ ...base, kg_por_litro: '0,84' }).erros).toEqual({});
    expect(validarConversao({ ...base, kg_por_litro: '10' }).erros).toEqual({});
    expect(validarConversao({ ...base, kg_por_litro: '10,000001' }).erros.kg_por_litro).toBe('Informe um fator maior que zero e até 10.');
    expect(validarConversao({ ...base, kg_por_litro: '0' }).erros.kg_por_litro).toBe('Informe um fator maior que zero e até 10.');
    expect(validarConversao({ ...base, kg_por_litro: '0,1234567' }).erros.kg_por_litro).toBe('No máximo 6 casas decimais.');
    expect(validarConversao({ ...base, kg_por_litro: '0,84', declara_estoque_em_kg: false }).erros.declara_estoque_em_kg).toBe('Marque a declaração de que o estoque está em KG.');
  });
});

describe('conferirRespostaAbastecimento (§6.1)', () => {
  it('detalhe, lista, prévia, consumo e fator do backend falso são conformes', async () => {
    const e = criarEstadoAbastecimentos();
    const corpo = { bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade_litros: '80', medidor_leitura: '1550.5', tanque_cheio: true };
    const detalhe = await semearAbastecimento(e, corpo);
    expect(conferirRespostaAbastecimento(detalhe)).toEqual([]);
    const q = (s) => new URLSearchParams(s);
    const lista = await rotearAbastecimentos(e, { method: 'GET', path: '/patrimonio-abastecimentos', query: q('empresa_id=emp-1'), body: null });
    expect(conferirRespostaAbastecimento(lista.body)).toEqual([]);
    const previa = await rotearAbastecimentos(e, { method: 'POST', path: '/patrimonio-abastecimentos-previa', query: q(''), body: { empresa_id: 'emp-1', ...corpo, medidor_leitura: '1560' } });
    expect(conferirRespostaAbastecimento(previa.body)).toEqual([]);
    const consumo = await rotearAbastecimentos(e, { method: 'GET', path: '/patrimonio-abastecimentos-consumo', query: q('empresa_id=emp-1&bem_id=b1'), body: null });
    expect(conferirRespostaAbastecimento(consumo.body)).toEqual([]);
    const fatores = await rotearAbastecimentos(e, { method: 'GET', path: '/patrimonio-conversoes-combustivel', query: q('empresa_id=emp-1'), body: null });
    expect(conferirRespostaAbastecimento(fatores.body)).toEqual([]);
    expect(conferirRespostaAbastecimento(fatores.body.items[0])).toEqual([]);
  });

  it('aponta casas erradas, número no lugar de texto, status e chaves ausentes', () => {
    const e = criarEstadoAbastecimentos();
    return semearAbastecimento(e, { bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1', data_operacional: '2026-06-10', quantidade_litros: '80', medidor_leitura: '1550.5' }).then((d) => {
      const base = detalheDe(e, e.abastecimentos[0]);
      expect(conferirRespostaAbastecimento({ ...base, quantidade_litros: '80' })).toEqual([expect.stringContaining('abastecimento.quantidade_litros')]);
      expect(conferirRespostaAbastecimento({ ...base, kg_por_litro: '0.8400' })).toEqual([expect.stringContaining('abastecimento.kg_por_litro')]);
      expect(conferirRespostaAbastecimento({ ...base, custo_total: 354.6 })).toEqual([expect.stringContaining('abastecimento.custo_total')]);
      expect(conferirRespostaAbastecimento({ ...base, status: 'RASCUNHO' })).toEqual([expect.stringContaining('abastecimento.status')]);
      expect(conferirRespostaAbastecimento({ ...base, data_operacional: '10/06/2026' })).toEqual([expect.stringContaining('abastecimento.data_operacional')]);
      const { fatias, ...semFatias } = base;
      expect(fatias.length).toBeGreaterThan(0);
      expect(conferirRespostaAbastecimento(semFatias)).toEqual(expect.arrayContaining([expect.stringContaining('abastecimento.fatias')]));
      expect(d.replay).toBe(false);
    });
  });
});

describe('totais exatos', () => {
  it('0,1 L + 0,2 L = 0,3000 L (BigInt), cancelados não contam', () => {
    const itens = [
      { status: 'CONFIRMADO', quantidade_litros: '0.1000', quantidade_kg: '0.0840' },
      { status: 'CONFIRMADO', quantidade_litros: '0.2000', quantidade_kg: '0.1680' },
      { status: 'CANCELADO', quantidade_litros: '9.0000', quantidade_kg: '7.5600' },
    ];
    expect(totaisConfirmados(itens)).toEqual({ litros: '0.3000', kg: '0.2520', quantidade: 2 });
    expect(totaisConfirmados([{ status: 'CONFIRMADO', quantidade_litros: '9999999999.9999', quantidade_kg: '0.0001' }, { status: 'CONFIRMADO', quantidade_litros: '0.0001', quantidade_kg: '0.0001' }]).litros).toBe('10000000000.0000');
  });
});

describe('kgDaBaixaNaPrevia — o KG do plano só aparece como baixa sem bloqueio de quantidade', () => {
  const bloqueio = (reason) => ({ code: 'OPERACAO_VALORES_INVALIDOS', field: 'quantidade_litros', reason, details: {} });
  it('sem bloqueio: o kg do plano; com outro bloqueio (saldo, medidor): ainda o kg', () => {
    expect(kgDaBaixaNaPrevia({ plano: { quantidade_kg: '67.2000' }, bloqueios: [] })).toBe('67.2000');
    expect(kgDaBaixaNaPrevia({ plano: { quantidade_kg: '67.2000' }, bloqueios: [{ code: 'ESTOQUE_SALDO_INSUFICIENTE', reason: 'saldo_lote_insuficiente' }] })).toBe('67.2000');
  });
  it('0 kg arredondado ou acima do teto do estoque: null (nada de "baixa de 0,0000 kg")', () => {
    expect(kgDaBaixaNaPrevia({ plano: { quantidade_kg: '0.0000' }, bloqueios: [bloqueio('quantidade_estoque_zero')] })).toBeNull();
    expect(kgDaBaixaNaPrevia({ plano: { quantidade_kg: '0.0000' }, bloqueios: [] })).toBeNull();
    expect(kgDaBaixaNaPrevia({ plano: { quantidade_kg: '99999999999.9990' }, bloqueios: [bloqueio('valor_excede_limite_estoque')] })).toBeNull();
    expect(kgDaBaixaNaPrevia({ plano: { quantidade_kg: null }, bloqueios: [] })).toBeNull();
    expect(kgDaBaixaNaPrevia(null)).toBeNull();
  });
});

// ─── UX-02 (D-PROD-160): opção de PRODUTO do bem → formulário ────────────
const ITEM_DIESEL = {
  id: 'p1',
  produto: { id: 'p1', nome: 'Diesel S10 granel', codigo_interno: 'DS10', unidade_principal_estoque: 'KG' },
  tipo_combustivel: { id: 'c1', codigo: 'DIESEL_S10', nome: 'Diesel S10' },
  conversao: { id: 'f1', versao: 1, sequencia: 1, kg_por_litro: '0.840000' },
  tanques: [{ id: 'tq1', identificador: 'Tanque principal', capacidade_litros: '180.0000' }],
  bloqueios: [],
  pronto: true,
};
const DOIS_TANQUES = [
  { id: 'tqA', identificador: 'Tanque A', capacidade_litros: '180.0000' },
  { id: 'tqB', identificador: 'Tanque B', capacidade_litros: '60.0000' },
];
const resposta = (itens, extra = {}) => ({ bem: { id: 'b1' }, itens, has_more: false, next_cursor: null, resumo: { motivo_sem_opcao: itens.length ? null : 'nenhum_produto_associado', total: itens.length, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] }, ...extra });

describe('opcaoNoFormulario — o tipo e os tanques vêm da opção do servidor; o corpo da API não muda', () => {
  it('um tanque: tanque e tipo da opção; o corpo da prévia é o MESMO de sempre', () => {
    const base = { ...formularioVazio('2026-06-15'), bem: BEM_TRATOR, quantidade_litros: '80', medidor_leitura: '1.550,5' };
    const form = opcaoNoFormulario(base, ITEM_DIESEL);
    expect(form.produto).toEqual({ ...ITEM_DIESEL.produto, conversao: ITEM_DIESEL.conversao, tipo_combustivel: ITEM_DIESEL.tipo_combustivel, tanques: ITEM_DIESEL.tanques, pronto: true });
    expect([form.tipo_combustivel_id, form.tanque_id, form.local_estoque_id]).toEqual(['c1', 'tq1', null]);
    expect(Object.keys(form).sort()).toEqual(Object.keys(base).sort());
    expect(montarCorpoPrevia('emp-1', { ...form, local_estoque_id: 'l1' })).toEqual({
      empresa_id: 'emp-1', bem_id: 'b1', tanque_id: 'tq1', tipo_combustivel_id: 'c1', produto_id: 'p1', local_estoque_id: 'l1',
      data_operacional: '2026-06-15', quantidade_litros: '80', medidor_leitura: '1550.5', tanque_cheio: false, observacao: null, referencia_externa: null,
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

  it('sem fator: conversao null e pronto false (a confirmação não monta)', () => {
    const f = opcaoNoFormulario(formularioVazio('2026-06-15'), { ...ITEM_DIESEL, conversao: null, bloqueios: ['sem_fator'], pronto: false });
    expect(f.produto).toMatchObject({ conversao: null, pronto: false });
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

describe('situacaoDaEscolha — ausente só com resposta completa sem o par do formulário', () => {
  const form = opcaoNoFormulario({ ...formularioVazio('2026-06-15'), bem: BEM_TRATOR }, ITEM_DIESEL);
  it('presente / ausente / indeterminado', () => {
    expect(situacaoDaEscolha(resposta([ITEM_DIESEL]), form)).toBe('presente');
    expect(situacaoDaEscolha(resposta([]), form)).toBe('ausente');
    expect(situacaoDaEscolha(resposta([{ ...ITEM_DIESEL, tipo_combustivel: { id: 'c9', codigo: 'X', nome: 'X' } }]), form)).toBe('ausente');
    expect(situacaoDaEscolha(resposta([], { has_more: true, next_cursor: 'x' }), form)).toBe('indeterminado');
    expect(situacaoDaEscolha({ ...resposta([]), bem: { id: 'b2' } }, form)).toBe('indeterminado');
    expect(situacaoDaEscolha(resposta([]), { ...form, produto: null })).toBe('indeterminado');
    expect(situacaoDaEscolha(null, form)).toBe('indeterminado');
  });
});

describe('formatarLitrosCurto', () => {
  it('sem zeros à direita e sem float', () => {
    expect(formatarLitrosCurto('180.0000')).toBe('180');
    expect(formatarLitrosCurto('80.5000')).toBe('80,5');
    expect(formatarLitrosCurto('1234.5678')).toBe('1.234,5678');
  });
});
