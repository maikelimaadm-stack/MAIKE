/**
 * D-PROD-157 (R2) — a tela Produtos explica as recusas que o vínculo com
 * combustível do Patrimônio provoca. Service, API, porta e nativeHttpClient
 * reais; mock só do `fetch`.
 *
 * O nativeHttpClient troca códigos não catalogados por API_OPERATION_FAILED e
 * guarda o corpo do servidor em `cause`. Por isso o service lê o código do
 * servidor (`cause.code`) para:
 *  - excluir produto vinculado (409 PRODUTO_DELETE_BLOCKED, details.vinculo =
 *    'combustíveis do patrimônio') → frase com o vínculo real e "inative";
 *  - mudar de fazenda produto com vínculo ATIVO (409
 *    PRODUTO_VINCULADO_COMBUSTIVEL) → frase que manda inativar o vínculo antes;
 *  - o bloqueio por movimentações de estoque mantém a frase de antes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

let resposta;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  resposta = undefined;
  instalarBackendFake(async ({ path }) => (path === '/produtos/p1' ? resposta : undefined));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const bloqueio = (vinculo, quantidade) => ({
  status: 409,
  body: { code: 'PRODUTO_DELETE_BLOCKED', message: 'srv', request_id: 'r1', details: { id: 'p1', vinculo, quantidade } },
});

describe('Produtos × vínculo com combustível do Patrimônio', () => {
  it('excluir produto vinculado: o bloqueio é reconhecido e a frase diz o vínculo real e para inativar', async () => {
    resposta = bloqueio('combustíveis do patrimônio', 1);
    const svc = await import('@/services/produtoService');
    const { excluidas, falhas } = await svc.excluirProdutos(['p1']);
    expect(excluidas).toEqual([]);
    expect(falhas).toHaveLength(1);
    const { erro } = falhas[0];
    expect(svc.isProdutoDeleteBlockedError(erro)).toBe(true);
    const frase = svc.mensagemExclusaoProdutoBloqueada(erro);
    expect(frase).toContain('1 registro(s) em combustíveis do patrimônio');
    expect(frase).toMatch(/Inative o produto/);
    expect(frase).not.toMatch(/movimentações de estoque/);
  });

  it('bloqueio por movimentações de estoque mantém a frase de antes; lançamentos financeiros dizem o vínculo', async () => {
    const svc = await import('@/services/produtoService');
    resposta = bloqueio('movimentações de estoque', 3);
    const estoque = (await svc.excluirProdutos(['p1'])).falhas[0].erro;
    expect(svc.isProdutoDeleteBlockedError(estoque)).toBe(true);
    expect(svc.mensagemExclusaoProdutoBloqueada(estoque)).toBe(
      'Este produto já possui 3 registro(s) lançados em movimentações de estoque e não pode ser excluído.'
    );
    resposta = bloqueio('lançamentos financeiros', 2);
    const financeiro = (await svc.excluirProdutos(['p1'])).falhas[0].erro;
    expect(svc.mensagemExclusaoProdutoBloqueada(financeiro)).toContain('2 registro(s) em lançamentos financeiros');
  });

  it('outro erro na exclusão não vira bloqueio', async () => {
    resposta = { status: 404, body: { code: 'PRODUTO_NOT_FOUND', message: 'x', request_id: 'r2' } };
    const svc = await import('@/services/produtoService');
    const { erro } = (await svc.excluirProdutos(['p1'])).falhas[0];
    expect(svc.isProdutoDeleteBlockedError(erro)).toBe(false);
  });

  it('mudar de fazenda produto com vínculo ATIVO: a frase manda inativar o vínculo na tela Combustíveis; outros erros seguem a mensagem pública', async () => {
    resposta = {
      status: 409,
      body: { code: 'PRODUTO_VINCULADO_COMBUSTIVEL', message: 'srv', request_id: 'r3', details: { id: 'p1', vinculos: 1 } },
    };
    const svc = await import('@/services/produtoService');
    const { updateProduto } = await import('@/apis/produtos');
    const erro = await updateProduto('p1', { empresa_id: 'emp-2' }).then(
      () => null,
      (e) => e
    );
    expect(erro).toBeTruthy();
    const frase = svc.mensagemErroSalvarProduto(erro);
    expect(frase).toMatch(/vinculado a um combustível do Patrimônio/);
    expect(frase).toMatch(/Inative o vínculo na tela Combustíveis/);
    expect(frase).toMatch(/Nada foi gravado\./);

    resposta = { status: 500, body: { code: 'INTERNAL_ERROR', message: 'erro interno', request_id: 'r4' } };
    const generico = await updateProduto('p1', { nome_produto: 'X' }).then(
      () => null,
      (e) => e
    );
    expect(svc.mensagemErroSalvarProduto(generico)).not.toMatch(/Combustíveis/);
  });
});
