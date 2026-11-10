/**
 * D-PROD-157 (R2) — contrato de LEITURA para a P1-02: produtos elegíveis de um
 * bem (por tanque), exposto no service de bens (`produtosElegiveisDoBem`).
 * Service, API, porta e nativeHttpClient reais; mock só do `fetch`.
 *
 *  - rota `GET /bens-patrimoniais/:id/produtos-elegiveis?empresa_id&tanque_id?`
 *    (empresa da sessão da tela; tenant só no JWT);
 *  - itens reduzidos aos campos do contrato (nada de preço, saldo ou custo
 *    passa adiante, mesmo que venha no corpo);
 *  - sem vínculo → lista vazia (nunca "todos os produtos"); sem empresa → nada
 *    é lido.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_FAKE, instalarBackendFake } from './fixtures/gestaoBackendFake.js';

const ELEGIVEIS = [
  {
    tanque_id: 'tq1', tanque_identificador: 'PRINCIPAL', tipo_combustivel_id: 'c1', tipo_combustivel_nome: 'Diesel S10',
    produto_id: 'pr1', produto_nome: 'DIESEL S10 A GRANEL', unidade_principal_estoque: 'KG', empresa_id: 'emp-1',
    preco: '6.1900', saldo: '1000', custo_medio: '5.5000',
  },
  {
    tanque_id: 'tq1', tanque_identificador: 'PRINCIPAL', tipo_combustivel_id: 'c1', tipo_combustivel_nome: 'Diesel S10',
    produto_id: 'pr2', produto_nome: 'DIESEL S10 POSTO', unidade_principal_estoque: 'KG', empresa_id: 'emp-1',
  },
];

let backend;
let resposta;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API_FAKE);
  window.localStorage.clear();
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken('jwt.teste');
  resposta = { status: 200, body: { itens: ELEGIVEIS } };
  backend = instalarBackendFake(async ({ method, path }) => (method === 'GET' && path === '/bens-patrimoniais/b1/produtos-elegiveis' ? resposta : undefined));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('produtosElegiveisDoBem — contrato de leitura para a P1-02', () => {
  it('lê do bem na empresa, só do tanque pedido; itens só com os campos do contrato (sem preço, saldo ou custo)', async () => {
    const { produtosElegiveisDoBem } = await import('@/services/bemPatrimonialService');
    const r = await produtosElegiveisDoBem('emp-1', 'b1', { tanqueId: 'tq1' });
    expect(backend.chamadas).toEqual([{ method: 'GET', path: '/bens-patrimoniais/b1/produtos-elegiveis', query: { empresa_id: 'emp-1', tanque_id: 'tq1' }, body: null }]);
    expect(r).toEqual({
      itens: [
        { tanque_id: 'tq1', tanque_identificador: 'PRINCIPAL', tipo_combustivel_id: 'c1', tipo_combustivel_nome: 'Diesel S10', produto_id: 'pr1', produto_nome: 'DIESEL S10 A GRANEL', unidade_principal_estoque: 'KG', empresa_id: 'emp-1' },
        { tanque_id: 'tq1', tanque_identificador: 'PRINCIPAL', tipo_combustivel_id: 'c1', tipo_combustivel_nome: 'Diesel S10', produto_id: 'pr2', produto_nome: 'DIESEL S10 POSTO', unidade_principal_estoque: 'KG', empresa_id: 'emp-1' },
      ],
    });
  });

  it('sem tanque: todos os tanques ativos do bem (a query não leva tanque_id)', async () => {
    const { produtosElegiveisDoBem } = await import('@/services/bemPatrimonialService');
    await produtosElegiveisDoBem('emp-1', 'b1');
    expect(backend.chamadas.map((c) => c.query)).toEqual([{ empresa_id: 'emp-1' }]);
  });

  it('sem vínculo: lista vazia — nunca "todos os produtos"', async () => {
    resposta = { status: 200, body: { itens: [] } };
    const { produtosElegiveisDoBem } = await import('@/services/bemPatrimonialService');
    expect(await produtosElegiveisDoBem('emp-1', 'b1', { tanqueId: 'tq1' })).toEqual({ itens: [] });
  });

  it('sem empresa: lista vazia e nada é lido', async () => {
    const { produtosElegiveisDoBem } = await import('@/services/bemPatrimonialService');
    expect(await produtosElegiveisDoBem(null, 'b1')).toEqual({ itens: [] });
    expect(backend.chamadas).toEqual([]);
  });

  it('tanque de outro bem (404 do servidor): o erro sobe para a tela (sem lista inventada)', async () => {
    resposta = { status: 404, body: { code: 'BEM_PATRIMONIAL_NAO_ENCONTRADO', message: 'x', request_id: 'r' } };
    const { produtosElegiveisDoBem } = await import('@/services/bemPatrimonialService');
    await expect(produtosElegiveisDoBem('emp-1', 'b1', { tanqueId: 'tq-de-outro-bem' })).rejects.toBeTruthy();
  });
});
