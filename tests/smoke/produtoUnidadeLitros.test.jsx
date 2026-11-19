/**
 * D-PROD-162 (F4, §5.3) — Produto em LITROS na tela Produtos.
 *
 *  PL-1. formulário: a unidade principal de estoque oferece "LITROS (L)"
 *        (KG e SACOS como antes); em leitura, "LITROS (L)"; escolher L com
 *        uma unidade de medida que não é de litros mostra o aviso (não
 *        bloqueia); com "L"/"LT"/"LITRO" não há aviso;
 *  PL-2. ficha: Produto em L mostra o estoque com "L"; KG e SACO mostram a
 *        unidade de medida, como antes;
 *  PL-3. mensagens do service (nativeHttpClient real, mock só do `fetch`; os
 *        casos úteis do antigo `produtosBloqueioCombustivel`):
 *        - excluir Produto aceito em tanque (409 PRODUTO_DELETE_BLOCKED,
 *          `vinculo: 'tanques do patrimônio'`) → frase que manda tirá-lo dos
 *          Produtos aceitos ou inativar; movimentações e lançamentos como antes;
 *        - mudar de fazenda Produto aceito em tanque (409
 *          PRODUTO_EM_TANQUE_PATRIMONIO) → frase do que fazer;
 *        - mudar a unidade (409 PRODUTO_UNIDADE_EM_USO) → frase por `reason`
 *          (padrão P-10: "Cadastre um Produto novo em litros"), e
 *          `aceito_em_tanque` → tirar dos Produtos aceitos.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/apis/categorias', () => ({ listCategorias: vi.fn(async () => []) }));
vi.mock('@/apis/unidades-medida', () => ({
  listUnidades: vi.fn(async () => [
    { sigla: 'KG', descricao: 'QUILOGRAMA', ativo: true },
    { sigla: 'LT', descricao: 'LITRO', ativo: true },
    { sigla: 'UN', descricao: 'UNIDADE', ativo: true },
  ]),
}));
vi.mock('@/apis/estoque', () => ({ listLocais: vi.fn(async () => []) }));
vi.mock('@/services/marcaService', () => ({ listarMarcasAtivas: vi.fn(async () => []) }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const comConsulta = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

// ─── PL-1 ────────────────────────────────────────────────────────────────────
describe('PL-1 — formulário do Produto', () => {
  const PRODUTO = { id: 'p1', nome_produto: 'DIESEL S10', codigo_interno: 'DS10', unidade_medida: 'KG', categoria: 'COMBUSTIVEL', local_estoque: 'TANQUE', unidade_principal_estoque: 'KG', ativo: true };
  const renderizar = async (props) => {
    const { default: FormularioProduto } = await import('@/components/produtos/FormularioProduto');
    return comConsulta(<FormularioProduto onSubmit={vi.fn()} onCancel={vi.fn()} isEditing {...props} />);
  };
  const seletorUnidadePrincipal = () => screen.getAllByRole('combobox').find((b) => /QUILOGRAMAS|SACOS|LITROS/.test(b.textContent));
  // Desde a #339 a unidade principal de estoque vive na guia "Unidade de Estoque" (só a guia ativa é visível).
  const abrirGuiaEstoque = () => fireEvent.click(screen.getByRole('tab', { name: 'Unidade de Estoque' }));

  it('oferece KG, SACOS e LITROS (L); escolher L com unidade de medida KG mostra o aviso, que não bloqueia', async () => {
    const onSubmit = vi.fn();
    await renderizar({ initialData: PRODUTO, onSubmit });
    abrirGuiaEstoque();
    const seletor = seletorUnidadePrincipal();
    expect(seletor.textContent).toContain('QUILOGRAMAS (KG)');
    expect(screen.queryByTestId('aviso-unidade-litros')).toBeNull();
    fireEvent.click(seletor);
    expect(screen.getAllByRole('option').map((o) => o.textContent.trim())).toEqual(['QUILOGRAMAS (KG)', 'SACOS', 'LITROS (L)']);
    fireEvent.click(screen.getByRole('option', { name: 'LITROS (L)' }));
    await waitFor(() => expect(seletorUnidadePrincipal().textContent).toContain('LITROS (L)'));
    expect(screen.getByTestId('aviso-unidade-litros')).toHaveTextContent('A unidade de medida do cadastro não é de litros; confira.');
    // Aviso não bloqueia: salvar manda a unidade L.
    fireEvent.submit(screen.getByTestId('b1-form-produto'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ unidade_principal_estoque: 'L', unidade_medida: 'KG' });
    expect(onSubmit.mock.calls[0][0].peso_por_saco_kg).toBeUndefined();
  });

  it('com unidade de medida de litros (LT, L, LITROS) não há aviso; em leitura mostra "LITROS (L)"', async () => {
    for (const unidade of ['LT', 'L', 'LITROS']) {
      const r = await renderizar({ initialData: { ...PRODUTO, unidade_medida: unidade, unidade_principal_estoque: 'L' } });
      abrirGuiaEstoque();
      expect(seletorUnidadePrincipal().textContent).toContain('LITROS (L)');
      expect(screen.queryByTestId('aviso-unidade-litros')).toBeNull();
      r.unmount();
    }
    await renderizar({ initialData: { ...PRODUTO, unidade_principal_estoque: 'L' }, readOnly: true });
    expect(screen.getByDisplayValue('LITROS (L)')).toBeTruthy();
  });

  it('KG e SACO: leitura e opção como antes', async () => {
    const r = await renderizar({ initialData: PRODUTO, readOnly: true });
    expect(screen.getByDisplayValue('QUILOGRAMAS (KG)')).toBeTruthy();
    r.unmount();
    await renderizar({ initialData: { ...PRODUTO, unidade_principal_estoque: 'SACO', peso_por_saco_kg: 30 }, readOnly: true });
    expect(screen.getByDisplayValue('SACOS')).toBeTruthy();
  });
});

// ─── PL-2 ────────────────────────────────────────────────────────────────────
describe('PL-2 — ficha do Produto', () => {
  const ficha = async (produto) => {
    const { default: FichaProduto } = await import('@/components/produtos/FichaProduto');
    return comConsulta(<FichaProduto produto={produto} open onClose={() => {}} empresa={{ id: 'emp-1', nome: 'FAZENDA' }} />);
  };
  const base = { id: 'p1', nome_produto: 'X', numero_produto: '1', estoque_atual: 120.5, estoque_minimo: 10, preco_custo: 1, preco_venda: 2 };

  it('Produto em L: estoque e mínimo com "L"', async () => {
    await ficha({ ...base, unidade_medida: 'KG', unidade_principal_estoque: 'L' });
    expect(screen.getByText('120,50 L')).toBeTruthy();
    expect(screen.getByText('10,00 L')).toBeTruthy();
  });

  it('KG e SACO: a unidade de medida, como antes', async () => {
    const r = await ficha({ ...base, unidade_medida: 'KG', unidade_principal_estoque: 'KG' });
    expect(screen.getByText('120,50 KG')).toBeTruthy();
    r.unmount();
    await ficha({ ...base, unidade_medida: 'SC', unidade_principal_estoque: 'SACO' });
    expect(screen.getByText('120,50 SC')).toBeTruthy();
  });
});

// ─── PL-3 ────────────────────────────────────────────────────────────────────
describe('PL-3 — mensagens do service', () => {
  let respostaFake;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
    window.localStorage.clear();
    const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
    setNativeToken('jwt.teste');
    respostaFake = undefined;
    instalarBackendFake(async ({ path }) => (path === '/produtos/p1' ? respostaFake : undefined));
  });
  const bloqueio = (vinculo, quantidade) => ({
    status: 409,
    body: { code: 'PRODUTO_DELETE_BLOCKED', message: 'srv', request_id: 'r1', details: { id: 'p1', vinculo, quantidade } },
  });
  const falhaAoSalvar = async (corpo) => {
    respostaFake = { status: 409, body: { message: 'srv', request_id: 'r2', ...corpo } };
    const { updateProduto } = await import('@/apis/produtos');
    return updateProduto('p1', { empresa_id: 'emp-2' }).then(() => null, (e) => e);
  };

  it('excluir Produto aceito em tanque: frase dos Produtos aceitos; movimentações e lançamentos como antes', async () => {
    const svc = await import('@/services/produtoService');
    respostaFake = bloqueio('tanques do patrimônio', 2);
    const tanque = (await svc.excluirProdutos(['p1'])).falhas[0].erro;
    expect(svc.isProdutoDeleteBlockedError(tanque)).toBe(true);
    expect(svc.mensagemExclusaoProdutoBloqueada(tanque)).toBe(
      'Este produto está nos Produtos aceitos de 2 tanque(s) de bens patrimoniais e não pode ser excluído. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais ou inative o produto.',
    );
    respostaFake = bloqueio('movimentações de estoque', 3);
    const estoque = (await svc.excluirProdutos(['p1'])).falhas[0].erro;
    expect(svc.mensagemExclusaoProdutoBloqueada(estoque)).toBe('Este produto já possui 3 registro(s) lançados em movimentações de estoque e não pode ser excluído.');
    respostaFake = bloqueio('lançamentos financeiros', 2);
    const financeiro = (await svc.excluirProdutos(['p1'])).falhas[0].erro;
    expect(svc.mensagemExclusaoProdutoBloqueada(financeiro)).toBe(
      'Este produto possui 2 registro(s) em lançamentos financeiros e não pode ser excluído. Inative o produto em vez de excluí-lo.',
    );
    respostaFake = { status: 404, body: { code: 'PRODUTO_NOT_FOUND', message: 'x', request_id: 'r3' } };
    expect(svc.isProdutoDeleteBlockedError((await svc.excluirProdutos(['p1'])).falhas[0].erro)).toBe(false);
  });

  it('mudar de fazenda Produto aceito em tanque: a frase manda tirá-lo dos Produtos aceitos', async () => {
    const svc = await import('@/services/produtoService');
    const erro = await falhaAoSalvar({ code: 'PRODUTO_EM_TANQUE_PATRIMONIO', field: 'empresa_id', reason: 'aceito_em_tanque', details: { id: 'p1', tanques: [] } });
    expect(svc.mensagemErroSalvarProduto(erro)).toBe(
      'Este produto está nos Produtos aceitos de um tanque de bem patrimonial: ele não pode mudar de fazenda. Tire-o dos Produtos aceitos do tanque em Bens Patrimoniais antes. Nada foi gravado.',
    );
  });

  it('mudar a unidade de estoque: frase por reason (P-10) e aceito em tanque', async () => {
    const svc = await import('@/services/produtoService');
    const NOVO = 'a unidade de estoque não muda de ou para litros. Cadastre um Produto novo em litros, ex.: “Diesel S10 (L)”. Nada foi gravado.';
    for (const [reason, inicio] of [
      ['estoque', 'Este produto tem estoque'],
      ['lotes', 'Este produto tem lotes de estoque'],
      ['movimentos', 'Este produto tem movimentações de estoque'],
      ['lancamentos', 'Este produto está em lançamentos financeiros'],
    ]) {
      const erro = await falhaAoSalvar({ code: 'PRODUTO_UNIDADE_EM_USO', field: 'unidade_principal_estoque', reason, details: { id: 'p1', de: 'KG', para: 'L' } });
      expect(svc.mensagemErroSalvarProduto(erro)).toBe(`${inicio}: ${NOVO}`);
    }
    // Saindo de litros (L → KG/SACO): a sugestão é cadastrar o Produto novo na unidade de destino, não em litros.
    const saindoDeLitros = await falhaAoSalvar({ code: 'PRODUTO_UNIDADE_EM_USO', field: 'unidade_principal_estoque', reason: 'estoque', details: { id: 'p1', de: 'L', para: 'KG' } });
    expect(svc.mensagemErroSalvarProduto(saindoDeLitros)).toBe(
      'Este produto tem estoque: a unidade de estoque não muda de ou para litros. Cadastre um Produto novo em quilos (KG). Nada foi gravado.',
    );
    const paraSaco = await falhaAoSalvar({ code: 'PRODUTO_UNIDADE_EM_USO', field: 'unidade_principal_estoque', reason: 'lotes', details: { id: 'p1', de: 'L', para: 'SACO' } });
    expect(svc.mensagemErroSalvarProduto(paraSaco)).toMatch(/Cadastre um Produto novo em sacos \(SACO\)\./);
    // D-PROD-169: o tanque aceita L, KG e SACO; o 409 por tanque só vem para unidade fora delas.
    const tanque = await falhaAoSalvar({ code: 'PRODUTO_UNIDADE_EM_USO', field: 'unidade_principal_estoque', reason: 'aceito_em_tanque', details: { id: 'p1', de: 'KG', para: 'UN', tanques: [] } });
    expect(svc.mensagemErroSalvarProduto(tanque)).toMatch(/Produtos aceitos de um tanque.*litros \(L\), quilos \(KG\) ou sacos \(SACO\)/);
    respostaFake = { status: 500, body: { code: 'INTERNAL_ERROR', message: 'erro interno', request_id: 'r4' } };
    const { updateProduto } = await import('@/apis/produtos');
    const generico = await updateProduto('p1', { nome_produto: 'X' }).then(() => null, (e) => e);
    expect(svc.mensagemErroSalvarProduto(generico)).not.toMatch(/Produtos aceitos|litros/);
  });
});
