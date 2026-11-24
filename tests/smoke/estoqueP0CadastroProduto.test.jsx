/**
 * D-PROD-161 — Estoque P0 (fatia F2): o Cadastro de Produtos não lança estoque.
 *
 *  F2-UI1. o formulário (novo, edição e leitura) mostra o aviso fixo e não tem
 *          campo de estoque atual;
 *  F2-UI2. o envio do formulário (novo e edição) nunca leva `estoque_atual`,
 *          mesmo com o cache lido do servidor no estado do formulário;
 *  F2-P1.  a porta nativa tira `estoque_atual` do corpo do POST e do PATCH
 *          (inclusive quando um chamador antigo ainda manda);
 *  F2-S1.  o saldo transferível do Mapa vem só dos lotes do local: sem lote,
 *          o cache `estoque_atual` do cadastro não vira saldo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const http = vi.hoisted(() => ({ chamadas: [] }));
vi.mock('@/apis/_core/nativeHttpClient.js', () => ({
  nativeRequest: async (caminho, opcoes = {}) => {
    http.chamadas.push({ caminho, metodo: opcoes.method || 'GET', corpo: opcoes.body });
    return { id: 'p1' };
  },
}));

vi.mock('@/services/produtoService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    carregarFontesDoFormulario: vi.fn(async () => ({ categorias: [], unidades: [], locais: [], marcas: [] })),
  };
});
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/lib/maikeNotify', () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

const { default: FormularioProduto, FORMULARIO_PRODUTO_ID } = await import('@/components/produtos/FormularioProduto');
const { operacoesNativas } = await import('@/apis/produtos/produtoNativePort');
const { obterSaldoTransferivelProduto } = await import('@/components/suplementacao/estoqueSuplementacaoUtils');

const AVISO = 'Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos';

const PRODUTO_LIDO = {
  id: 'p1',
  empresa_id: 'emp-1',
  numero_produto: '7',
  nome_produto: 'SAL MINERAL',
  codigo_interno: 'S1',
  unidade_medida: 'KG',
  categoria: 'MINERAL',
  local_estoque: 'DEPOSITO',
  estoque_atual: 250,
  estoque_minimo: 10,
  ativo: true,
};

const montar = (props) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FormularioProduto variant="embedded" toolbarActions onCancel={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  http.chamadas = [];
});
afterEach(() => cleanup());

describe('F2-UI — FormularioProduto', () => {
  it.each([
    ['novo', { isEditing: false }],
    ['edição', { isEditing: true, initialData: PRODUTO_LIDO }],
    ['leitura', { isEditing: true, readOnly: true, initialData: PRODUTO_LIDO }],
  ])('F2-UI1 — %s: aviso fixo visível e nenhum campo de estoque atual', (_rotulo, props) => {
    montar({ onSubmit: vi.fn(), ...props });
    expect(screen.getByText(AVISO)).toBeTruthy();
    // D-PROD-288: o estoque atual aparece só para leitura (nunca é campo editável nem vai no envio).
    const atual = screen.getByTestId('produto-estoque-atual');
    expect(atual.readOnly).toBe(true);
    // o mínimo continua (é cadastro, não saldo)
    expect(screen.getByText('Estoque Mínimo')).toBeTruthy();
  });

  it('F2-UI2 — edição com o cache lido (250) no estado: o envio não leva estoque_atual', () => {
    const onSubmit = vi.fn();
    montar({ onSubmit, isEditing: true, initialData: PRODUTO_LIDO });
    fireEvent.submit(document.getElementById(FORMULARIO_PRODUTO_ID));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).not.toHaveProperty('estoque_atual');
    expect(payload.nome_produto).toBe('SAL MINERAL');
  });

  it('F2-UI2 — cadastro novo: o envio não leva estoque_atual (o servidor grava 0)', () => {
    const onSubmit = vi.fn();
    const novo = { ...PRODUTO_LIDO };
    delete novo.id;
    montar({ onSubmit, isEditing: false, initialData: novo });
    fireEvent.submit(document.getElementById(FORMULARIO_PRODUTO_ID));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('estoque_atual');
  });
});

describe('F2-P1 — porta nativa de Produto', () => {
  it('POST e PATCH nunca levam estoque_atual, mesmo quando o chamador manda', async () => {
    await operacoesNativas.create({ empresa_id: 'emp-1', nome_produto: 'SAL', estoque_atual: 100, estoque_minimo: 2 });
    await operacoesNativas.update('p1', { nome_produto: 'SAL', estoque_atual: 100, estoque_minimo: 3 });
    expect(http.chamadas.map((c) => [c.metodo, c.caminho])).toEqual([['POST', '/produtos'], ['PATCH', '/produtos/p1']]);
    for (const { corpo } of http.chamadas) {
      expect(corpo).not.toHaveProperty('estoque_atual');
      expect(corpo.nome_produto).toBe('SAL');
    }
    expect(http.chamadas[0].corpo.estoque_minimo).toBe(2);
    expect(http.chamadas[1].corpo.estoque_minimo).toBe(3);
  });
});

describe('F2-M1 — mensagens das recusas novas ao salvar', () => {
  const erroDoServidor = (corpo) => Object.assign(new Error('srv'), { code: 'API_OPERATION_FAILED', cause: corpo });

  it('409 PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA e 422 PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL dizem o que fazer; outros erros seguem a mensagem pública', async () => {
    const svc = await import('@/services/produtoService');
    const empresa = svc.mensagemErroSalvarProduto(erroDoServidor({ code: 'PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA', details: { id: 'p1', lotes: 1, movimentos: 1 } }));
    expect(empresa).toMatch(/não pode mudar de fazenda/);
    expect(empresa).toMatch(/Nada foi gravado\./);
    const estoque = svc.mensagemErroSalvarProduto(erroDoServidor({ code: 'PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL', field: 'estoque_atual', reason: 'somente_leitura' }));
    expect(estoque).toMatch(new RegExp(AVISO));
    const outro = svc.mensagemErroSalvarProduto(erroDoServidor({ code: 'PRODUTO_NAME_CONFLICT' }));
    expect(outro).not.toMatch(/fazenda|Entradas/);
  });
});

describe('F2-S1 — saldo transferível (Mapa) vem só dos lotes', () => {
  const produto = { id: 'p1', local_estoque: 'DEPOSITO', estoque_atual: 500 };

  it('sem lote no local: 0, mesmo com o cadastro apontando o local e estoque_atual 500', () => {
    expect(obterSaldoTransferivelProduto({ produto, lotesNota: [], localEstoqueId: 'l1', localEstoqueNome: 'DEPOSITO' })).toBe(0);
  });

  it('com lotes: Σ disponível dos lotes do produto naquele local (o cache não entra)', () => {
    const lotesNota = [
      { produto_id: 'p1', local_estoque_id: 'l1', quantidade_disponivel: 30 },
      { produto_id: 'p1', local_estoque_id: 'l1', quantidade_disponivel: 12.5 },
      { produto_id: 'p1', local_estoque_id: 'l2', quantidade_disponivel: 99 },
      { produto_id: 'p2', local_estoque_id: 'l1', quantidade_disponivel: 7 },
    ];
    expect(obterSaldoTransferivelProduto({ produto, lotesNota, localEstoqueId: 'l1', localEstoqueNome: 'DEPOSITO' })).toBe(42.5);
  });
});
