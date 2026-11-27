/**
 * D-PROD-288 — telas das unidades de conversão do produto:
 *  UC-1. o formulário do produto não mostra preço de custo, preço de venda, local de estoque nem o bloco de consumo;
 *        o código interno é só leitura;
 *  UC-2. a aba "Conversão de unidades" lista as conversões com a prévia ("1 SACO = 25 KG", "1 G = 0,001 KG") e envia a lista;
 *  UC-3. a unidade de estoque não pode ser conversão (erro na tela, nada enviado);
 *  UC-4. entrada/saída/ajuste oferecem as conversões e mostram a equivalência ("10 SACO = 250 kg"); a conta é a do
 *        servidor (multiplica/divide, 4 casas);
 *  UC-5. a Formulação envia o consumo mínimo e máximo.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/produtoService', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, carregarFontesDoFormulario: vi.fn(async () => ({ categorias: [], unidades: [], locais: [], marcas: [] })) };
});
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/lib/maikeNotify', () => ({ notifySuccess: vi.fn(), notifyWarning: vi.fn(), notifyError: vi.fn(), notifyExclusoesEmpilhadas: vi.fn() }));

const { default: FormularioProduto, FORMULARIO_PRODUTO_ID } = await import('@/components/produtos/FormularioProduto');
const { previaDaConversao, errosDasConversoes } = await import('@/components/produtos/UnidadesConversaoProduto');
const { unidadesDoProduto, emUnidadeDeEstoque, equivalenciaDaLinha } = await import('@/lib/estoqueEntradasRegras');
const { contadoEmEstoque } = await import('@/lib/estoqueAjustesRegras');
const { validarFormulacao } = await import('@/services/formulacaoCadastroService');

const PRODUTO = {
  id: 'p1', empresa_id: 'emp-1', numero_produto: '7', codigo_interno: '7', nome_produto: 'SAL MINERAL', unidade_medida: 'KG',
  categoria: 'MINERAL', tipo_uso: 'Nutrição Animal', unidade_principal_estoque: 'KG', estoque_atual: 250, ativo: true,
  unidades_conversao: [
    { id: 'u1', sigla: 'SACO', operacao: 'MULTIPLICA', fator: '25.000000', uso_compra: true, uso_venda: true, ativa: true },
    { id: 'u2', sigla: 'G', operacao: 'DIVIDE', fator: '1000.000000', uso_compra: false, uso_venda: true, ativa: true },
  ],
};

const montar = (props) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FormularioProduto variant="embedded" toolbarActions onCancel={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
};
afterEach(() => cleanup());

describe('UC — cadastro do produto', () => {
  it('UC-1 — sem preços, local e consumo; código interno só leitura', () => {
    montar({ onSubmit: vi.fn(), isEditing: true, initialData: PRODUTO });
    expect(screen.queryByText('Preço de Custo')).toBeNull();
    expect(screen.queryByText('Preço de Venda')).toBeNull();
    expect(screen.queryByText('Local de Estoque')).toBeNull();
    expect(screen.queryByText('%PV mínimo')).toBeNull();
    expect(screen.getByTestId('aviso-consumo-formulacao')).toBeTruthy();
    const codigo = screen.getByTestId('produto-codigo-interno');
    expect(codigo.readOnly).toBe(true);
    expect(codigo.value).toBe('7');
  });

  it('UC-2 — aba Conversão de unidades: prévia e envio da lista', () => {
    const onSubmit = vi.fn();
    montar({ onSubmit, isEditing: true, initialData: PRODUTO });
    fireEvent.click(screen.getByRole('tab', { name: 'Conversão de unidades' }));
    expect(screen.getByTestId('produto-unidade-0-previa').textContent).toContain('1 SACO = 25 KG');
    expect(screen.getByTestId('produto-unidade-1-previa').textContent).toContain('1 G = 0,001 KG');
    fireEvent.click(screen.getByTestId('produto-unidade-adicionar'));
    fireEvent.change(screen.getByTestId('produto-unidade-2-sigla'), { target: { value: 'gl 20' } });
    fireEvent.change(screen.getByTestId('produto-unidade-2-fator'), { target: { value: '20' } });
    expect(screen.getByTestId('produto-unidade-2-previa').textContent).toContain('1 GL 20 = 20 KG');
    fireEvent.submit(document.getElementById(FORMULARIO_PRODUTO_ID));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const corpo = onSubmit.mock.calls[0][0];
    expect(corpo.unidades_conversao.map((u) => [u.sigla, u.operacao, u.fator, u.uso_compra])).toEqual([
      ['SACO', 'MULTIPLICA', 25, true], ['G', 'DIVIDE', 1000, false], ['GL 20', 'MULTIPLICA', 20, true],
    ]);
    expect(corpo).not.toHaveProperty('preco_custo');
    expect(corpo).not.toHaveProperty('local_estoque');
    expect(corpo).not.toHaveProperty('codigo_interno');
  });

  it('UC-3 — a unidade de estoque (KG) não é conversão: erro e nada enviado', () => {
    expect(errosDasConversoes([{ sigla: 'KG', operacao: 'MULTIPLICA', fator: '1' }], 'KG')['0.sigla']).toMatch(/unidade de estoque/);
    expect(errosDasConversoes([{ sigla: 'X', operacao: 'DIVIDE', fator: '20000' }], 'KG')['0.fator']).toMatch(/divide/);
    expect(errosDasConversoes([{ sigla: 'X', operacao: 'MULTIPLICA', fator: '2', uso_compra: false, uso_venda: false }], 'KG')['0.uso']).toBeTruthy();
    expect(previaDaConversao({ sigla: 'sc 50', operacao: 'MULTIPLICA', fator: '50' }, 'KG')).toBe('1 SC 50 = 50 KG');
    const onSubmit = vi.fn();
    montar({ onSubmit, isEditing: true, initialData: { ...PRODUTO, unidades_conversao: [{ sigla: 'KG', operacao: 'MULTIPLICA', fator: '1' }] } });
    fireEvent.submit(document.getElementById(FORMULARIO_PRODUTO_ID));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('UC-3b — D-PROD-369: KG, L e UN valem como conversão; só KG ↔ L é recusado; produto em SC com "1 KG = 0,04 SC"', () => {
    expect(errosDasConversoes([{ sigla: 'UN', operacao: 'MULTIPLICA', fator: '2' }], 'KG')).toEqual({});
    expect(errosDasConversoes([{ sigla: 'L', operacao: 'MULTIPLICA', fator: '1' }], 'KG')['0.sigla']).toBe('Conversão entre KG e L não é permitida');
    expect(errosDasConversoes([{ sigla: 'KG', operacao: 'MULTIPLICA', fator: '1' }], 'L')['0.sigla']).toBe('Conversão entre KG e L não é permitida');
    expect(errosDasConversoes([{ sigla: 'KG', operacao: 'DIVIDE', fator: '25' }, { sigla: 'L', operacao: 'MULTIPLICA', fator: '50' }], 'SC')).toEqual({});
    expect(errosDasConversoes([{ sigla: 'SC', operacao: 'MULTIPLICA', fator: '1' }], 'SC')['0.sigla']).toMatch(/unidade de estoque \(SC\)/);
    expect(previaDaConversao({ sigla: 'KG', operacao: 'DIVIDE', fator: '25' }, 'SC')).toBe('1 KG = 0,04 SC');
    const onSubmit = vi.fn();
    montar({ onSubmit, isEditing: true, initialData: { ...PRODUTO, unidade_medida: 'SC', unidade_principal_estoque: 'SC', unidades_conversao: [{ id: 'k1', sigla: 'KG', operacao: 'DIVIDE', fator: '25.000000', ativa: true }] } });
    fireEvent.click(screen.getByRole('tab', { name: 'Conversão de unidades' }));
    expect(screen.getByTestId('produto-unidades-conversao').textContent).toContain('Saldo e custo ficam sempre em SC');
    expect(screen.getByTestId('produto-unidade-0-previa').textContent).toContain('1 KG = 0,04 SC');
    fireEvent.submit(document.getElementById(FORMULARIO_PRODUTO_ID));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ unidade_medida: 'SC', unidade_principal_estoque: 'SC' });
  });
});

describe('UC — lançamentos', () => {
  const produto = { id: 'p1', rotulo: 'SAL', unidade_estoque: 'KG', unidades_conversao: PRODUTO.unidades_conversao.map((c) => ({ ...c, equivalencia: c.sigla === 'SACO' ? '1 SACO = 25 KG' : '1 G = 0,001 KG' })) };

  it('UC-4 — o seletor traz a de estoque e as conversões com o uso; a equivalência da linha', () => {
    expect(unidadesDoProduto(produto, 'compra').map((u) => u.value)).toEqual(['KG', 'SACO']);
    expect(unidadesDoProduto(produto, 'venda').map((u) => u.value)).toEqual(['KG', 'SACO', 'G']);
    expect(unidadesDoProduto(produto, 'compra')[1].label).toBe('SACO (1 SACO = 25 KG)');
    expect(emUnidadeDeEstoque(produto, 'SACO', '10')).toBe('250.0000');
    expect(emUnidadeDeEstoque(produto, 'G', '1')).toBe('0.0010');
    expect(equivalenciaDaLinha({ produto, unidade: 'SACO', quantidade: '10' })).toBe('10 SACO = 250 kg');
    expect(equivalenciaDaLinha({ produto, unidade: 'KG', quantidade: '10' })).toBe('');
    expect(contadoEmEstoque({ produto, unidade: 'SACO', contado: '8' })).toBe('200.0000');
  });

  it('UC-4b — D-PROD-369: produto em SC — o seletor traz SC e a conversão KG; 500 KG = 20 SC; a equivalência com a sigla real', () => {
    const sc = { id: 'p2', rotulo: 'MILHO', unidade_estoque: 'SC', unidades_conversao: [{ sigla: 'KG', operacao: 'DIVIDE', fator: '25', ativa: true, equivalencia: '1 KG = 0,04 SC' }] };
    expect(unidadesDoProduto(sc, 'compra')).toEqual([{ value: 'SC', label: 'SC' }, { value: 'KG', label: 'KG (1 KG = 0,04 SC)' }]);
    expect(emUnidadeDeEstoque(sc, 'KG', '500')).toBe('20.0000');
    expect(emUnidadeDeEstoque(sc, 'SC', '3')).toBe('3.0000');
    expect(equivalenciaDaLinha({ produto: sc, unidade: 'KG', quantidade: '500' })).toBe('500 KG = 20 SC');
    expect(contadoEmEstoque({ produto: sc, unidade: 'KG', contado: '250' })).toBe('10.0000');
  });
});

describe('UC — Formulação', () => {
  it('UC-5 — consumo mínimo e máximo vão no corpo; máximo menor que o mínimo é recusado', () => {
    const base = { nome: 'F', tipo: 'PRONTO', produto_id: 'p1', base_consumo: 'PV', percentual_pv_padrao: '0,1', consumo_objetivo_g_cab_dia: '', faixa_tolerancia_percentual: '', observacoes: '', ativo: true, ingredientes: [], regras: [] };
    const ok = validarFormulacao({ ...base, consumo_minimo_pv: '0,05', consumo_maximo_pv: '0,2' });
    expect(ok.corpo).toMatchObject({ consumo_minimo_pv: 0.05, consumo_maximo_pv: 0.2 });
    const ruim = validarFormulacao({ ...base, consumo_minimo_pv: '0,3', consumo_maximo_pv: '0,2' });
    expect(ruim.erros.consumo_maximo_pv).toBeTruthy();
    expect(validarFormulacao(base).corpo).not.toHaveProperty('consumo_minimo_pv');
  });
});
