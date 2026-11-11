/**
 * D-PROD-162 (F4, §5.3) — item da Gestão P3 em LITROS, só para Produto em L.
 *
 *  LIT-1. modelo: escolher um Produto em L põe a unidade `L`; os outros, `KG`
 *         (como antes); o detalhe do servidor preserva `L` e marca o Produto;
 *  LIT-2. validação: Produto em L só com item L ("Este produto é controlado em
 *         litros (L)"); item L só com Produto em L ("Use KG ou SACO"); KG e
 *         SACO com Produto não-L: as mesmas mensagens de antes; quantidade em
 *         estoque de um item L = a quantidade (fator 1);
 *  LIT-3. telas fora do lançamento (achado D2): a consulta mostra "L" e
 *         "L a R$/L" no FIFO para o item em L, sem o "(… kg)"; KG, SACO e UN
 *         com o texto de antes; o rateio mostra "Custo/L (líquido) …/L" e a
 *         nota do resíduo sem kg para documento com item em L; sem item em L,
 *         o texto de antes;
 *  LIT-4. seção de itens: Produto em L só oferece a unidade L e o resumo diz
 *         "Entra no estoque: … L"; Produto KG/SACO: KG (+SACO) e "kg" como antes.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/operacaoFinanceiraService', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, buscarOpcoesLancamento: vi.fn(async () => ({ itens: [], has_more: false, next_cursor: null })), listarSaldosProduto: vi.fn(async () => []) };
});

import {
  calcularResumo,
  formularioDoDetalhe,
  formularioVazio,
  itemVazio,
  produtoEmLitros,
  unidadeAoEscolherProduto,
} from '@/components/financeiroGestao/lancamentoModelo';
import { NotaResiduoCusto, ValoresRateadosDoItem } from '@/components/financeiroGestao/RateioItensLancamento';
import ConsultaLancamento from '@/components/financeiroGestao/ConsultaLancamento';
import { SecaoItens } from '@/components/financeiroGestao/SecoesLancamento';

afterEach(() => cleanup());

const ctx = { locale: 'pt-BR', casas: 2, hoje: '2026-11-08' };
const PRODUTO_L = { id: 'pl', rotulo: 'DIESEL S10 (L)', unidade_principal_estoque: 'L', peso_por_saco_kg: null };
const PRODUTO_KG = { id: 'pk', rotulo: 'SAL', unidade_principal_estoque: 'KG', peso_por_saco_kg: null };
const PRODUTO_SACO = { id: 'ps', rotulo: 'RAÇÃO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30' };

/** Formulário COM_PRODUTOS com um item de mercadoria. */
const comItem = (produto, unidade, quantidade = '1.000', valor = '6,00') => {
  const f = {
    ...formularioVazio({ hoje: ctx.hoje }),
    conteudo: 'COM_PRODUTOS',
    parceiro: { id: 'pa1', rotulo: 'AGRO' },
    data_operacional: ctx.hoje,
    efeito_fisico_confirmado: true,
  };
  f.itens = [{ ...itemVazio('MERCADORIA'), produto, local: { id: 'lo1', rotulo: 'DEPÓSITO' }, unidade, quantidade, valor_unitario: valor }];
  return f;
};

describe('LIT-1 — unidade ao escolher o produto e detalhe do servidor', () => {
  it('Produto em L → L; KG, SACO e nenhum → KG (como antes)', () => {
    expect(unidadeAoEscolherProduto(PRODUTO_L)).toBe('L');
    expect(unidadeAoEscolherProduto(PRODUTO_KG)).toBe('KG');
    expect(unidadeAoEscolherProduto(PRODUTO_SACO)).toBe('KG');
    expect(unidadeAoEscolherProduto(null)).toBe('KG');
    expect(produtoEmLitros({ unidade_principal_estoque: 'L' })).toBe(true);
    expect(produtoEmLitros({ unidade_principal_estoque: 'KG' })).toBe(false);
  });

  it('o detalhe preserva o item L (e marca o Produto em L); KG, SACO e UN como antes', () => {
    const d = {
      direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', data_emissao: '2026-11-08', rateio_modo: 'VALOR', rateios: [], parcelas: [],
      itens: [
        { tipo_item: 'MERCADORIA', produto_id: 'pl', produto_nome: 'DIESEL', local_estoque_id: 'lo1', unidade: 'L', quantidade: '1000.0000', valor_unitario: '6.000000', fator_kg: '1.0000' },
        { tipo_item: 'MERCADORIA', produto_id: 'pk', produto_nome: 'SAL', local_estoque_id: 'lo1', unidade: 'KG', quantidade: '10.0000', valor_unitario: '3.000000', fator_kg: '1.0000' },
        { tipo_item: 'MERCADORIA', produto_id: 'ps', produto_nome: 'RAÇÃO', local_estoque_id: 'lo1', unidade: 'SACO', quantidade: '2.0000', valor_unitario: '90.000000', fator_kg: '30.0000' },
        { tipo_item: 'SERVICO', descricao: 'FRETE', unidade: 'UN', quantidade: '1.0000', valor_unitario: '50.000000' },
      ],
    };
    const f = formularioDoDetalhe(d, ctx);
    expect(f.itens.map((i) => i.unidade)).toEqual(['L', 'KG', 'SACO', 'UN']);
    expect(f.itens[0].produto).toMatchObject({ id: 'pl', unidade_principal_estoque: 'L' });
    expect(f.itens[1].produto).toEqual({ id: 'pk', rotulo: 'SAL' });
    expect(f.itens[2].produto).toEqual({ id: 'ps', rotulo: 'RAÇÃO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30.0000' });
  });
});

describe('LIT-2 — validação da unidade do item', () => {
  const erroUnidade = (produto, unidade) => calcularResumo(comItem(produto, unidade), ctx).erros['itens.0.unidade'];

  it('Produto em L só com item L; item L só com Produto em L', () => {
    expect(erroUnidade(PRODUTO_L, 'L')).toBeUndefined();
    expect(erroUnidade(PRODUTO_L, 'KG')).toBe('Este produto é controlado em litros (L)');
    expect(erroUnidade(PRODUTO_L, 'SACO')).toBe('Este produto é controlado em litros (L)');
    expect(erroUnidade(PRODUTO_KG, 'L')).toBe('Use KG ou SACO');
    expect(erroUnidade(PRODUTO_SACO, 'L')).toBe('Use KG ou SACO');
  });

  it('KG e SACO com Produto não-L: as mensagens de antes', () => {
    expect(erroUnidade(PRODUTO_KG, 'KG')).toBeUndefined();
    expect(erroUnidade(PRODUTO_SACO, 'SACO')).toBeUndefined();
    expect(erroUnidade(PRODUTO_SACO, 'KG')).toBeUndefined();
    expect(erroUnidade(PRODUTO_KG, 'SACO')).toBe('Este produto não é controlado em sacos');
    expect(erroUnidade(PRODUTO_KG, 'UN')).toBe('Use KG ou SACO');
  });

  it('item L: fator 1 — a quantidade em estoque é a quantidade (4 casas), sem conversão', () => {
    const r = calcularResumo(comItem(PRODUTO_L, 'L', '1.234,5678', '6,00'), ctx);
    expect(r.itens[0].kg).toBe('1234.5678');
    const saco = calcularResumo(comItem(PRODUTO_SACO, 'SACO', '2', '90,00'), ctx);
    expect(saco.itens[0].kg).toBe('60.0000');
  });
});

describe('LIT-3 — consulta e rateio mostram a unidade do item', () => {
  const PERFIL = { locale: 'pt-BR', moeda: 'BRL', moeda_casas: 2, pais: 'BR' };
  const ACOES = { liquidar: false, estornar_liquidacao: false, cancelar: false, excluir: false };
  const item = (ordem, extra) => ({
    id: `i${ordem}`, ordem, tipo_item: 'MERCADORIA', local_estoque_nome: 'DEPÓSITO', valor_unitario: '1.000000', valor_total: '10.00',
    valor_desconto_rateado: '0.00', valor_acrescimo_rateado: '0.00', valor_liquido: '10.00', movimentacao_estoque_id: `m${ordem}`, ...extra,
  });
  const detalhe = (itens, direcao = 'RECEBER') => ({
    id: 'op1', numero: '7', status: 'CONFIRMADO', direcao, conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', moeda: 'BRL', moeda_casas: 2,
    data_emissao: '2026-11-08', data_operacional: '2026-11-08', valor_bruto: '40.00', valor_desconto: '0.00', valor_acrescimo: '0.00', valor_total: '40.00',
    rateio_modo: 'VALOR', rateios: [], titulos: [], itens,
  });
  const renderizar = (d) =>
    render(<ConsultaLancamento detalhe={d} perfil={PERFIL} fuso="America/Sao_Paulo" acoes={ACOES} onLiquidar={() => {}} onEstornar={() => {}} onCancelar={() => {}} />);

  it('item L: "10 L", sem "(… kg)", e FIFO "L a R$/L"; KG, SACO e UN com o texto de antes', () => {
    renderizar(detalhe([
      item(1, { produto_nome: 'DIESEL S10 (L)', unidade: 'L', quantidade: '10.0000', quantidade_estoque: '10.0000', consumos: [{ estoque_lote_nota_id: 'lt1', quantidade: '10.0000', custo_unitario: '6.0000' }] }),
      item(2, { produto_nome: 'SAL', unidade: 'KG', quantidade: '10.0000', quantidade_estoque: '10.0000', consumos: [{ estoque_lote_nota_id: 'lt2', quantidade: '10.0000', custo_unitario: '2.5000' }] }),
      item(3, { produto_nome: 'RAÇÃO', unidade: 'SACO', quantidade: '2.0000', quantidade_estoque: '60.0000', consumos: [{ estoque_lote_nota_id: 'lt3', quantidade: '60.0000', custo_unitario: '3.0000' }] }),
      { id: 'i4', ordem: 4, tipo_item: 'SERVICO', descricao: 'FRETE', unidade: 'UN', quantidade: '1.0000', valor_unitario: '10.000000', valor_total: '10.00', valor_liquido: '10.00' },
    ]));
    const l = screen.getByTestId('consulta-item-1');
    expect(l).toHaveTextContent('10 L');
    expect(l.textContent).not.toMatch(/kg/);
    expect(l).toHaveTextContent('lote lt1 10 L a 6,00/L');
    const kg = screen.getByTestId('consulta-item-2');
    expect(kg).toHaveTextContent('10 KG');
    expect(kg.textContent).not.toMatch(/\(10 kg\)/);
    expect(kg).toHaveTextContent('lote lt2 10 kg a 2,50/kg');
    const saco = screen.getByTestId('consulta-item-3');
    expect(saco).toHaveTextContent('2 SACO (60 kg)');
    expect(saco).toHaveTextContent('lote lt3 60 kg a 3,00/kg');
    const un = screen.getByTestId('consulta-item-4');
    expect(un).toHaveTextContent('1 UN');
    expect(un.textContent).not.toMatch(/kg/);
  });

  it('rateio: "Custo/L (líquido) …/L" para item L; KG e SACO com "Custo/kg (líquido) …/kg"', () => {
    const c = { locale: 'pt-BR', moeda: 'BRL', casas: 2 };
    const { unmount } = render(<ValoresRateadosDoItem item={{ ordem: 1, unidade: 'L', valor_total: '6000.00', custo_kg: '6.0000', residuo_custo: '0.00000000' }} c={c} prefixo="x" />);
    const celulaL = screen.getByTestId('x-custo-kg');
    expect(celulaL).toHaveTextContent(/^R\$\s6,00\/L$/);
    expect(celulaL.previousElementSibling).toHaveTextContent('Custo/L (líquido)');
    unmount();
    for (const unidade of ['KG', 'SACO', undefined]) {
      const r = render(<ValoresRateadosDoItem item={{ ordem: 1, unidade, valor_total: '10.00', custo_kg: '2.5000', residuo_custo: null }} c={c} prefixo="y" />);
      const celula = screen.getByTestId('y-custo-kg');
      expect(celula).toHaveTextContent(/^R\$\s2,50\/kg$/);
      expect(celula.previousElementSibling).toHaveTextContent('Custo/kg (líquido)');
      r.unmount();
    }
  });

  it('nota do resíduo: sem kg com item L; o texto de antes sem item L', () => {
    const { unmount } = render(<NotaResiduoCusto testId="n1" comLitros />);
    expect(screen.getByTestId('n1')).toHaveTextContent('Diferença de arredondamento do custo = líquido − quantidade × custo unitário.');
    expect(screen.getByTestId('n1').textContent).not.toMatch(/kg/);
    unmount();
    render(<NotaResiduoCusto testId="n2" />);
    expect(screen.getByTestId('n2').textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Diferença de arredondamento do custo = líquido − kg × custo/kg. O custo por kg do estoque tem 4 casas: essa diferença fica fora do custo FIFO (não entra no lote) e o título continua com o valor total.',
    );
  });

  it('consulta de documento SÓ com KG/SACO: nota do resíduo com o texto de antes', () => {
    renderizar(detalhe([
      item(1, { produto_nome: 'SAL', unidade: 'KG', quantidade: '3.0000', quantidade_estoque: '3.0000', custo_kg: '3.3333', residuo_custo: '0.00010000' }),
    ], 'PAGAR'));
    const nota = screen.getByTestId('consulta-rateio-nota-residuo');
    expect(nota).toHaveTextContent('líquido − kg × custo/kg');
    expect(within(screen.getByTestId('consulta-item-1')).getByTestId('consulta-item-1-custo-kg')).toHaveTextContent(/\/kg/);
  });
});

describe('LIT-4 — seção de itens do lançamento', () => {
  const renderizarItens = (form) => {
    const resumo = calcularResumo(form, ctx);
    const secaoCtx = { empresaId: 'emp-1', locale: 'pt-BR', moeda: 'BRL', casas: 2, readOnly: false, erroDe: (/** @type {string} */ k) => resumo.erros[k] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <div className="b1 mg-b1-form-grid">
          <SecaoItens form={form} resumo={resumo} ctx={secaoCtx} setForm={() => {}} />
        </div>
      </QueryClientProvider>,
    );
  };
  /** Abre o seletor de unidade do item 1 e lê as opções; fecha de novo. */
  const opcoes = () => {
    const botao = screen.getByRole('combobox', { name: 'Unidade do item 1' });
    fireEvent.click(botao);
    const lista = screen.getAllByRole('option').map((o) => o.textContent.trim());
    fireEvent.click(botao);
    return lista;
  };

  it('Produto em L: só a unidade L e "Entra no estoque: 1.000 L"', () => {
    renderizarItens(comItem(PRODUTO_L, 'L'));
    expect(opcoes()).toEqual(['L']);
    expect(screen.getByTestId('item-0-kg')).toHaveTextContent('Entra no estoque: 1.000 L');
    expect(screen.getByTestId('item-0-kg').textContent).not.toMatch(/kg/);
  });

  it('Produto KG: só KG e "kg"; Produto SACO: KG e SACO, convertido pelo peso do saco (como antes)', () => {
    const { unmount } = renderizarItens(comItem(PRODUTO_KG, 'KG', '10', '3,00'));
    expect(opcoes()).toEqual(['KG']);
    expect(screen.getByTestId('item-0-kg').textContent).toBe('Entra no estoque: 10 kg');
    unmount();
    renderizarItens(comItem(PRODUTO_SACO, 'SACO', '2', '90,00'));
    expect(opcoes()).toEqual(['KG', 'SACO']);
    expect(screen.getByTestId('item-0-kg').textContent).toBe('Entra no estoque: 60 kg (convertido pelo peso do saco)');
  });
});
