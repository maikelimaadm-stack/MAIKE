/**
 * D-PROD-161 — MAIKE-ESTOQUE-P0-01, fatia F3 (SPEC §2 W27/W28, §4, §7.2 item 10).
 *
 * Movimento e lote de estoque só nascem/somem pelos comandos do motor físico.
 * No navegador isso quer dizer: as portas de MovimentacaoEstoque e de
 * EstoqueLoteNota não têm mais `create` nem `delete` — nem crus, nem no
 * adaptador offline (que só expõe as operações que existem, então não há como
 * enfileirar a escrita) —, os wrappers sem chamador saem das APIs públicas e a
 * reversão pelo navegador (`suplementacaoHistoricoService`) falha fechada SEM
 * I/O. Ficam: leitura, `update` (a renomeação do depósito do FormularioPonto)
 * e os comandos transacionais.
 *
 * Portas e serviços REAIS; só o IndexedDB vira memória (mesma API do
 * `IndexedDBManager`) e só o HTTP é falso (`nativeRequest` grava cada chamada).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const banco = vi.hoisted(() => {
  const stores = new Map();
  let seq = 1;
  const loja = (nome) => { if (!stores.has(nome)) stores.set(nome, new Map()); return stores.get(nome); };
  const chave = (nome, item) => (nome === 'entity_cache' ? item.cache_key : item.id);
  return {
    stores,
    reset: () => { stores.clear(); seq = 1; },
    api: {
      STORES_NAMES: { ENTITY_CACHE: 'entity_cache', ENTITY_QUEUE: 'entity_queue' },
      getItem: async (nome, k) => loja(nome).get(k),
      putItem: async (nome, item) => { loja(nome).set(chave(nome, item), item); },
      getAllItems: async (nome) => [...loja(nome).values()],
      addItem: async (nome, item) => { const id = seq++; loja(nome).set(id, { ...item, id }); return id; },
      deleteItem: async (nome, k) => { loja(nome).delete(k); },
    },
  };
});
const http = vi.hoisted(() => ({ chamadas: [] }));

vi.mock('@/components/offline/IndexedDBManager', () => banco.api);
vi.mock('@/apis/_core/nativeHttpClient.js', () => ({
  nativeRequest: async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    http.chamadas.push(`${metodo} ${caminho}`);
    if (metodo === 'GET') return [];
    return { id: 'x', ...(opcoes.body || {}) };
  },
}));

// O jsdom não tem IndexedDB: sem isto o runtime devolveria as operações cruas
// (essa variante é provada à parte, em P2).
globalThis.indexedDB = globalThis.indexedDB || /** @type {any} */ ({});

const portaMov = await import('@/apis/movimentacoes-estoque/movimentacaoEstoqueNativePort.js');
const portaLote = await import('@/apis/estoque-lotes-nota/estoqueLoteNotaNativePort.js');
const apiMov = await import('@/apis/movimentacoes-estoque');
const apiLote = await import('@/apis/estoque-lotes-nota');
const apiSup = await import('@/apis/suplementacao');
const historico = await import('@/services/suplementacaoHistoricoService');
const estoqueMapa = await import('@/services/estoqueMapaService');
const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
const { setOfflineTenant, clearOfflineTenant } = await import('@/lib/offline/offlineTenant');

const RAIZ = resolve(__dirname, '../..');
const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
const fila = () => [...(banco.stores.get('entity_queue')?.values() || [])];
const escritasHttp = () => http.chamadas.filter((c) => !c.startsWith('GET '));

beforeEach(() => {
  banco.reset();
  http.chamadas = [];
  online(true);
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  setOfflineTenant('cli-a');
});
afterEach(() => {
  online(true);
  clearOfflineTenant();
});

describe('P1/P2 — portas de movimento e de lote: sem create/delete', () => {
  it('P1 — adaptador offline (com IndexedDB): movimento só list/update; lote só list/filter/update', () => {
    expect(Object.keys(portaMov.movimentacaoEstoquePort).sort()).toEqual(['list', 'update']);
    expect(Object.keys(portaLote.estoqueLoteNotaPort).sort()).toEqual(['filter', 'list', 'update']);
    for (const porta of [portaMov.movimentacaoEstoquePort, portaLote.estoqueLoteNotaPort]) {
      expect(typeof porta.create).toBe('undefined');
      expect(typeof porta.delete).toBe('undefined');
      expect(typeof porta.update).toBe('function');
    }
  });

  it('P2 — sem IndexedDB (operações nativas cruas): a mesma superfície', async () => {
    const guardado = globalThis.indexedDB;
    try {
      // @ts-ignore — simula navegador sem IndexedDB
      delete globalThis.indexedDB;
      vi.resetModules();
      const mov = await import('@/apis/movimentacoes-estoque/movimentacaoEstoqueNativePort.js');
      const lote = await import('@/apis/estoque-lotes-nota/estoqueLoteNotaNativePort.js');
      expect(mov.movimentacaoEstoquePort).not.toBe(portaMov.movimentacaoEstoquePort);
      expect(Object.keys(mov.movimentacaoEstoquePort).sort()).toEqual(['list', 'update']);
      expect(Object.keys(lote.estoqueLoteNotaPort).sort()).toEqual(['filter', 'list', 'update']);
    } finally {
      globalThis.indexedDB = guardado;
      vi.resetModules();
    }
  });

  it('P1b — offline, a única escrita que sobra (renomeação) é o PATCH; nada de POST/DELETE na fila nem no HTTP', async () => {
    online(false);
    await portaLote.estoqueLoteNotaPort.update('lote-1', { local_estoque_nome: 'GALPAO' });
    await portaMov.movimentacaoEstoquePort.update('mov-1', { local_origem: 'GALPAO' });
    expect(escritasHttp()).toEqual([]);
    expect(fila().map((f) => [f.entity_name, f.operation])).toEqual([['EstoqueLoteNota', 'update'], ['MovimentacaoEstoque', 'update']]);
  });
});

describe('P3 — APIs públicas sem os wrappers de escrita genérica', () => {
  it('@/apis/movimentacoes-estoque: sem create/delete; list, update e os comandos ficam', () => {
    expect(apiMov.createMovimentacaoEstoque).toBeUndefined();
    expect(apiMov.deleteMovimentacaoEstoque).toBeUndefined();
    for (const nome of ['listMovimentacoesEstoque', 'updateMovimentacaoEstoque', 'comandoSaidaSuplementacao', 'comandoTransferenciaEntreLocais']) {
      expect(typeof apiMov[nome], nome).toBe('function');
    }
  });

  it('@/apis/estoque-lotes-nota: sem create/delete; list, filter e update ficam', () => {
    expect(apiLote.createLoteNotaEstoque).toBeUndefined();
    expect(apiLote.deleteLoteNotaEstoque).toBeUndefined();
    for (const nome of ['listLotesNotaEstoque', 'filterLotesNotaEstoque', 'updateLoteNotaEstoque']) {
      expect(typeof apiLote[nome], nome).toBe('function');
    }
  });

  it('@/apis/suplementacao: sem escrita de movimento, lote ou estoque_atual; as leituras ficam', () => {
    for (const nome of ['createMovimentacaoEstoque', 'updateMovimentacaoEstoque', 'deleteMovimentacaoEstoque', 'createLoteNota', 'updateLoteNota', 'deleteLoteNota', 'updateProduto']) {
      expect(apiSup[nome], nome).toBeUndefined();
    }
    for (const nome of ['listMovimentacoesEstoque', 'listLotesNota', 'filterLotesNota', 'listProdutos']) {
      expect(typeof apiSup[nome], nome).toBe('function');
    }
  });
});

describe('P4 — reversão pelo navegador: fail-closed sem I/O', () => {
  const chamadas = [
    ['restaurarEstoqueNoLocal', () => historico.restaurarEstoqueNoLocal({
      empresaId: 'emp-1', produtoId: 'prod-1', produtoNome: 'MILHO', quantidade: 10, localEstoqueId: 'loc-1', localEstoqueNome: 'GALPAO', custoUnitario: 2,
    })],
    ['excluirEventoSuplementacaoComReversao', () => historico.excluirEventoSuplementacaoComReversao({
      evento: { id: 'e2', empresa_id: 'emp-1', ponto_suplementacao_id: 'p1', movimentacao_estoque_id: 'mov-9' }, ponto: { deposito_origem_id: 'd1' },
    })],
    ['excluirTransferenciaDeposito', () => historico.excluirTransferenciaDeposito({
      movimentacao: { id: 'mov-in', tipo_movimentacao: 'Entrada', movimento_pai_id: 'mov-out' },
    })],
  ];
  for (const [nome, chamar] of chamadas) {
    it(`${nome}: rejeita com ApiError e ZERO chamada HTTP (nem leitura), ZERO fila`, async () => {
      const erro = await chamar().then(() => null, (e) => e);
      expect(erro).toBeInstanceOf(ApiError);
      expect(erro.code).toBe(API_ERROR_CODES.OPERATION_FAILED);
      expect(erro.operation).toBe(nome);
      expect(erro.details).toEqual(expect.objectContaining({ motivo: 'estorno_suspenso_motor_unico' }));
      expect(http.chamadas).toEqual([]);
      expect(fila()).toEqual([]);
    });
  }

  it('o serviço de reversão não importa mais nenhuma API de dados (só o catálogo de erro)', () => {
    const fonte = readFileSync(join(RAIZ, 'src/services/suplementacaoHistoricoService.js'), 'utf8');
    const origens = [...fonte.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(origens).toEqual(['@/apis/_core/ApiError']);
    expect(fonte).not.toMatch(/\b(createLoteNota|deleteLoteNota|updateLoteNota|deleteMovimentacaoEstoque|updateProduto)\b/);
  });
});

describe('P5 — o que continua ativo mantém o contrato', () => {
  it('renomeação do depósito (FormularioPonto → estoqueMapaService): PATCH do lote e do movimento', async () => {
    await estoqueMapa.atualizarLoteNota('lote-1', { local_estoque_nome: 'GALPAO NOVO' });
    await estoqueMapa.atualizarMovimentacao('mov-1', { local_origem: 'GALPAO NOVO' });
    expect(escritasHttp()).toEqual(['PATCH /estoque-lotes-nota/lote-1', 'PATCH /movimentacoes-estoque/mov-1']);
  });

  it('comandos transacionais de suplementação e transferência: mesmo caminho e método', async () => {
    await apiMov.comandoSaidaSuplementacao({ operation_id: 'op-12345678', quantidade: 1 });
    await apiMov.comandoTransferenciaEntreLocais({ operation_id: 'op-87654321', quantidade: 1 });
    expect(escritasHttp()).toEqual([
      'POST /movimentacoes-estoque/comandos/saida-suplementacao',
      'POST /movimentacoes-estoque/comandos/transferencia-locais',
    ]);
  });
});

describe('P6 — fonte: nada de escrita genérica de estoque em src/', () => {
  /** @param {string} dir @returns {string[]} */
  const arquivos = (dir) => readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.(js|jsx|ts|tsx)$/.test(nome) ? [caminho] : [];
  });

  it('nenhuma referência a createLoteNota/deleteLoteNota/createMovimentacaoEstoque/deleteMovimentacaoEstoque em src/', () => {
    const achados = arquivos(join(RAIZ, 'src'))
      .filter((f) => /createLoteNota|deleteLoteNota|createMovimentacaoEstoque|deleteMovimentacaoEstoque/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(achados).toEqual([]);
  });

  it('as portas continuam existindo, com nativeRequest( (gate p54), sem POST nem DELETE', () => {
    for (const rel of ['src/apis/movimentacoes-estoque/movimentacaoEstoqueNativePort.js', 'src/apis/estoque-lotes-nota/estoqueLoteNotaNativePort.js']) {
      const fonte = readFileSync(join(RAIZ, rel), 'utf8');
      expect(fonte, rel).toMatch(/nativeRequest\s*\(/);
      expect(fonte, rel).not.toMatch(/method:\s*['"](POST|DELETE)['"]/);
    }
  });
});
