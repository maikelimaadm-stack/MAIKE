/**
 * D-PROD-301 — pente-fino do que os formulários de manejo leem sem internet.
 *
 * Com internet, o app baixa os dados (`baixarDadosParaOffline`). Depois, SEM
 * internet (rede caída), cada leitura que os formulários do cocho e do depósito
 * fazem ao abrir tem de responder com o que foi baixado — nunca falhar nem vir
 * vazia. Uma leitura nova num formulário, sem registrar na porta do módulo,
 * quebra este teste (foi o caso da formulação do lançamento, D-PROD-299).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';
const EMP = 'emp-1';

let online = true;

// Um registro que passa nos filtros dos formulários (fazenda, cocho, ativo, disponível).
const ITEM = {
  id: 'x1', empresa_id: EMP, cliente_id: 'cli_pf', ponto_suplementacao_id: 'x1', categoria_ponto: 'COCHO',
  ativo: true, status: 'Ativo', nome: 'X', nome_ponto: 'X', produto_id: 'x1', local_estoque_id: 'x1',
  quantidade_disponivel: '10', data_documento: '2026-11-01', data_lancamento: '2026-11-01',
};

const servidor = vi.fn(async (url, init = {}) => {
  if (!online) throw new TypeError('Failed to fetch');
  const metodo = init.method ?? 'GET';
  if (metodo !== 'GET') return { ok: false, status: 405, text: async () => '{}' };
  return { ok: true, status: 200, text: async () => JSON.stringify([ITEM]) };
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.localStorage.clear();
  window.sessionStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  vi.stubGlobal('fetch', servidor);
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_pf');
  (await import('@/lib/offline/sincronizacao/motorDeSincronizacao')).definirSessaoDaFila({ cliente_id: 'cli_pf', usuario_id: 'usr_pf' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** As leituras que cada formulário faz ao abrir (as mesmas funções das telas). */
const leiturasDosFormularios = async () => {
  const sup = await import('@/services/suplementacaoService');
  const estoque = await import('@/services/estoqueMapaService');
  const mapa = await import('@/services/mapaService');
  const empresas = await import('@/services/empresaService');
  return {
    'lançamento do cocho: empresas': () => empresas.listEmpresas(),
    'lançamento do cocho: cocho atualizado': () => sup.carregarPontoAtualizado('x1'),
    'lançamento do cocho: áreas': () => sup.listarAreasDaEmpresa(EMP),
    'lançamento do cocho: rebanho': () => sup.listarRebanhoParaSuplementacao(EMP),
    'lançamento do cocho: último lançamento': () => sup.ultimoEventoDoPonto({ empresaId: EMP, pontoId: 'x1' }),
    'lançamento do cocho: formulações': () => sup.listarFormulacoesParaLancamento(EMP),
    'lançamento do cocho: produtos': () => sup.listarProdutosDaEmpresa(EMP),
    'lançamento do cocho: depósito': () => sup.listarPontosDaEmpresa(EMP),
    'lançamento do cocho: saldo do depósito': () => sup.listarLotesNotaDaEmpresa(EMP),
    'lançamento do cocho: últimos lançamentos': () => sup.listarEventosDoPonto({ empresaId: EMP, pontoId: 'x1', limit: 12 }),
    'lançamento do cocho: movimentações do rebanho': () => sup.listarMovimentacoesPecuariasDaEmpresa(EMP),
    'entrada/saída do depósito: locais': () => estoque.listarTodosLocais(),
    'entrada/saída do depósito: produtos': () => estoque.listarTodosProdutos(),
    'entrada/saída do depósito: saldo': () => estoque.listarTodosLotesNota(),
    'detalhe do depósito: cochos': () => mapa.listarPontosSuplementacaoAtivos(EMP),
    'detalhe do depósito: áreas': () => mapa.listarAreasAtivas(EMP),
    'detalhe do depósito: movimentações': () => estoque.listarTodasMovimentacoes(),
  };
};

describe('D-PROD-301 — pente-fino: formulários de manejo sem internet', () => {
  it('PF-01 depois de baixar os dados, cada leitura dos formulários responde sem internet (nem erro, nem vazia)', async () => {
    const { baixarDadosParaOffline } = await import('@/services/dadosOfflineService');
    await baixarDadosParaOffline({ empresaId: EMP });

    online = false;
    const leituras = await leiturasDosFormularios();
    const problemas = [];
    for (const [nome, ler] of Object.entries(leituras)) {
      try {
        const r = await ler();
        const vazio = r === null || r === undefined || (Array.isArray(r) && r.length === 0);
        if (vazio) problemas.push(`${nome}: veio vazia`);
      } catch (erro) {
        problemas.push(`${nome}: ${/** @type {any} */ (erro)?.code || /** @type {any} */ (erro)?.message}`);
      }
    }
    expect(problemas).toEqual([]);
  });
});

describe('D-PROD-301 — telas não ficam "carregando" sem internet', () => {
  it('PF-02 a consulta das telas roda sem internet (lê do celular), em vez de pausar esperando a rede', async () => {
    online = false;
    const { queryClientInstance } = await import('@/lib/query-client');
    const resultado = await Promise.race([
      queryClientInstance.fetchQuery({ queryKey: ['pf-02-saldo-deposito'], queryFn: async () => [{ saldo: 10 }] }),
      new Promise((resolve) => setTimeout(() => resolve('pausou'), 500)),
    ]);
    expect(resultado).toEqual([{ saldo: 10 }]);
  });
});
