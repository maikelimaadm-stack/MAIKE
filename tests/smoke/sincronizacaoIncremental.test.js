/**
 * D-PROD-309 — leitura incremental das listas grandes (dentro de `nativeRequest`).
 *
 * SI-01 primeira leitura: páginas de /lotes/mudancas (sem `desde`), lista na ordem do servidor, marca guardada
 * SI-02 próxima leitura: só `desde=marca`; junta alterados e novos, tira excluídos; não baixa a lista inteira
 * SI-03 sem internet: a cópia guardada
 * SI-04 servidor sem a rota de mudanças (versões fora de ordem): a lista inteira, como antes
 * SI-05 o servidor pede recarga (exclusões demais): baixa tudo de novo, sem `desde`
 * SI-06 três leituras ao mesmo tempo (cadastros, mapa, telas): uma sincronização só
 * SI-07 cópia gravada por leitura comum (sem marca) ou de formato antigo: começa do zero
 * SI-08 cada conta tem a sua marca
 * Revisão independente:
 * SI-09 a tela que acabou de salvar vê o que salvou (não pega carona numa sincronização de antes)
 * SI-10 com cópia, a tela espera no máximo 6 s no total (não por página); a sincronização termina por trás
 * SI-11 a conta trocou no meio das páginas: nada é gravado na cópia da conta anterior
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
  json: async () => corpo,
  headers: { get: () => 'application/json' },
});

let online = true;

/** Servidor falso de lotes com a rota de mudanças (contrato da D-PROD-309). */
const servidor = ({ semRotaDeMudancas = false } = {}) => {
  let relogio = Date.parse('2026-11-25T12:00:00Z');
  const s = {
    lotes: new Map(),
    apagados: [],
    chamadas: [],
    recarregar: false,
    avancar: (ms = 1000) => {
      relogio += ms;
    },
    gravar: (lote) => {
      relogio += 1;
      s.lotes.set(lote.id, { ...s.lotes.get(lote.id), ...lote, updated_ms: relogio, created_date: s.lotes.get(lote.id)?.created_date ?? new Date(relogio).toISOString() });
    },
    apagar: (id) => {
      relogio += 1;
      s.lotes.delete(id);
      s.apagados.push({ id, em: relogio });
    },
  };
  const publico = ({ updated_ms: _u, ...l }) => l;
  s.fetch = vi.fn(async (url) => {
    const u = new URL(String(url));
    const caminho = u.pathname.replace('/api/native', '');
    s.chamadas.push(`${caminho}${u.search}`);
    if (caminho === '/lotes') return respostaJson(200, [...s.lotes.values()].sort((a, b) => (a.created_date < b.created_date ? 1 : -1)).map(publico));
    if (caminho === '/lotes/mudancas') {
      if (semRotaDeMudancas) return respostaJson(404, { code: 'ROUTE_NOT_FOUND', message: 'não encontrada' });
      const agora = new Date(relogio).toISOString();
      if (s.recarregar && u.searchParams.get('desde')) return respostaJson(200, { agora, itens: [], excluidos: [], proximo: null, recarregar: true });
      const desde = u.searchParams.get('desde') ? Date.parse(u.searchParams.get('desde')) - 60_000 : null;
      const limite = Number(u.searchParams.get('limite')) || 500;
      const depois = u.searchParams.get('cursor') ? JSON.parse(atob(u.searchParams.get('cursor'))) : null;
      const todos = [...s.lotes.values()]
        .filter((l) => desde === null || l.updated_ms >= desde)
        .sort((a, b) => a.updated_ms - b.updated_ms || (a.id < b.id ? -1 : 1))
        .filter((l) => !depois || l.updated_ms > depois.u || (l.updated_ms === depois.u && l.id > depois.i));
      const pagina = todos.slice(0, limite);
      const ultimo = pagina[pagina.length - 1];
      return respostaJson(200, {
        agora,
        itens: pagina.map(publico),
        excluidos: desde === null || depois ? [] : s.apagados.filter((a) => a.em >= desde).map((a) => a.id),
        proximo: todos.length > limite ? btoa(JSON.stringify({ u: ultimo.updated_ms, i: ultimo.id })) : null,
        recarregar: false,
      });
    }
    return respostaJson(200, []);
  });
  return s;
};

/** Cada teste com a sua conta: as cópias guardadas são por conta (e o IndexedDB fica aberto). */
let contaDoTeste = 'cli_0';
const carregar = async (tenant = contaDoTeste) => {
  (await import('@/lib/auth/nativeTokenStorage')).setNativeToken('jwt.sintetico', { lembrar: true });
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant(tenant);
  // A porta de lotes registra a lista (aqui, direto: o teste não carrega a porta inteira).
  const inc = await import('@/lib/offline/sincronizacaoIncremental');
  inc.registrarListaIncremental('/lotes', { mudancas: '/lotes/mudancas', ordem: inc.ordemPorCriacao });
  const { nativeRequest } = await import('@/apis/_core/nativeHttpClient.js');
  const ler = () => nativeRequest('/lotes', { autenticado: true }, { operation: 'listLotes', resource: 'Lote' });
  return { nativeRequest, ler };
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.localStorage.clear();
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  contaDoTeste = `cli_${Math.random().toString(36).slice(2, 10)}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('D-PROD-309 — leitura incremental', () => {
  it('SI-01 primeira leitura: páginas sem `desde`, ordem do servidor, marca guardada', async () => {
    const srv = servidor();
    for (let i = 1; i <= 2500; i += 1) srv.gravar({ id: `l${String(i).padStart(5, '0')}`, nome: `L${i}` });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    const lista = await ler();
    expect(lista).toHaveLength(2500);
    expect(lista[0].id).toBe('l02500'); // createdAt DESC, como a listagem
    expect(srv.chamadas.filter((c) => c.startsWith('/lotes/mudancas'))).toHaveLength(3); // 1000 + 1000 + 500
    expect(srv.chamadas.some((c) => c.includes('desde='))).toBe(false);
    expect(srv.chamadas).not.toContain('/lotes');
    const { lerResposta } = await import('@/lib/offline/respostasOffline');
    const guardada = await lerResposta(contaDoTeste, '/lotes');
    expect(guardada.marca).toBeTruthy();
    expect(guardada.corpo).toHaveLength(2500);
  });

  it('SI-02 próxima leitura: só o que mudou; junta e tira; não baixa a lista inteira', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    srv.gravar({ id: 'b', nome: 'B' });
    srv.gravar({ id: 'c', nome: 'C' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    await ler();
    srv.avancar(10 * 60 * 1000); // dez minutos depois
    srv.gravar({ id: 'b', nome: 'B ALTERADO' });
    srv.gravar({ id: 'd', nome: 'D' });
    srv.apagar('a');
    srv.chamadas.length = 0;
    const lista = await ler();
    expect(lista.map((l) => [l.id, l.nome])).toEqual([
      ['d', 'D'],
      ['c', 'C'],
      ['b', 'B ALTERADO'],
    ]);
    expect(srv.chamadas).toHaveLength(1);
    expect(srv.chamadas[0]).toMatch(/^\/lotes\/mudancas\?desde=/);
  });

  it('SI-03 sem internet: a cópia guardada', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    await ler();
    online = false;
    srv.chamadas.length = 0;
    expect((await ler()).map((l) => l.id)).toEqual(['a']);
    expect(srv.chamadas).toEqual([]);
  });

  it('SI-04 servidor sem a rota de mudanças: a lista inteira, como antes', async () => {
    const srv = servidor({ semRotaDeMudancas: true });
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    expect((await ler()).map((l) => l.id)).toEqual(['a']);
    expect(srv.chamadas).toContain('/lotes');
  });

  it('SI-05 o servidor pede recarga: baixa tudo de novo, sem `desde`', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    await ler();
    srv.avancar(10 * 60 * 1000);
    srv.apagar('a');
    srv.gravar({ id: 'b', nome: 'B' });
    srv.recarregar = true;
    srv.chamadas.length = 0;
    expect((await ler()).map((l) => l.id)).toEqual(['b']);
    expect(srv.chamadas.map((c) => c.includes('desde='))).toEqual([true, false]);
  });

  it('SI-06 três leituras ao mesmo tempo: uma sincronização só', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    const [x, y, z] = await Promise.all([ler(), ler(), ler()]);
    expect(x).toEqual(y);
    expect(y).toEqual(z);
    expect(srv.chamadas.filter((c) => c.startsWith('/lotes/mudancas'))).toHaveLength(1);
  });

  it('SI-07 cópia sem marca (leitura comum) ou de formato antigo: começa do zero', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    const { guardarResposta } = await import('@/lib/offline/respostasOffline');
    await guardarResposta(contaDoTeste, '/lotes', [{ id: 'velho', nome: 'DE ANTES' }]);
    expect((await ler()).map((l) => l.id)).toEqual(['a']);
    expect(srv.chamadas[0]).not.toMatch(/desde=/);
    await guardarResposta(contaDoTeste, '/lotes', [{ id: 'velho' }], { marca: '2026-11-25T12:00:00.000Z', formato: 0 });
    srv.chamadas.length = 0;
    expect((await ler()).map((l) => l.id)).toEqual(['a']);
    expect(srv.chamadas[0]).not.toMatch(/desde=/);
  });

  it('SI-08 cada conta tem a sua marca', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const um = await carregar(`${contaDoTeste}_1`);
    await um.ler();
    const dois = await carregar(`${contaDoTeste}_2`);
    srv.chamadas.length = 0;
    await dois.ler();
    expect(srv.chamadas[0]).not.toMatch(/desde=/);
  });

  it('SI-09 a tela que acabou de salvar vê o que salvou', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    let soltar;
    const original = srv.fetch.getMockImplementation();
    let segurar = true;
    srv.fetch.mockImplementation(async (url) => {
      if (segurar && String(url).includes('/lotes/mudancas')) {
        segurar = false;
        await new Promise((r) => (soltar = r));
      }
      return original(url);
    });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    const antiga = ler(); // o mapa abriu: sincronização no ar
    await vi.waitFor(() => expect(soltar).toBeTypeOf('function'));
    srv.gravar({ id: 'b', nome: 'SALVO AGORA' }); // a pessoa salvou
    const depoisDeSalvar = ler(); // a tela relê
    soltar();
    await antiga;
    expect((await depoisDeSalvar).map((l) => l.id)).toContain('b');
  });

  it('SI-10 com cópia, no máximo 6 s no total; a sincronização termina por trás', async () => {
    const srv = servidor();
    srv.gravar({ id: 'a', nome: 'A' });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    await ler();
    srv.avancar(10 * 60 * 1000);
    srv.gravar({ id: 'b', nome: 'B' });
    let soltar;
    const original = srv.fetch.getMockImplementation();
    srv.fetch.mockImplementation(async (url) => {
      await new Promise((r) => (soltar = r)); // rede muito lenta
      return original(url);
    });
    const inicio = Date.now();
    const lista = await ler();
    expect(Date.now() - inicio).toBeLessThan(9000);
    expect(lista.map((l) => l.id)).toEqual(['a']); // a cópia
    soltar();
    const { lerResposta } = await import('@/lib/offline/respostasOffline');
    await vi.waitFor(async () => expect((await lerResposta(contaDoTeste, '/lotes')).corpo.map((l) => l.id)).toEqual(['b', 'a']));
  }, 20000);

  it('SI-11 a conta trocou no meio das páginas: nada gravado na cópia da conta anterior', async () => {
    const srv = servidor();
    for (let i = 1; i <= 1500; i += 1) srv.gravar({ id: `l${String(i).padStart(5, '0')}`, nome: `L${i}` });
    const original = srv.fetch.getMockImplementation();
    let paginas = 0;
    const { setOfflineTenant } = await import('@/lib/offline/offlineTenant');
    srv.fetch.mockImplementation(async (url) => {
      paginas += 1;
      const r = await original(url);
      if (paginas === 1) setOfflineTenant('outra_conta'); // saiu e outra conta entrou
      return r;
    });
    vi.stubGlobal('fetch', srv.fetch);
    const { ler } = await carregar();
    await expect(ler()).rejects.toBeTruthy();
    const { lerResposta } = await import('@/lib/offline/respostasOffline');
    expect(await lerResposta(contaDoTeste, '/lotes')).toBeUndefined();
    expect(paginas).toBe(1);
  });

  it('SI-12 as quatro portas registram a sua lista', async () => {
    await import('@/apis/lotes/loteNativePort');
    await import('@/apis/pontos-suplementacao/pontoSuplementacaoNativePort');
    await import('@/apis/leituras-cocho/leituraCochoNativePort');
    await import('@/apis/suplementacao-eventos/suplementacaoEventoNativePort');
    const { incrementalDe } = await import('@/lib/offline/sincronizacaoIncremental');
    for (const caminho of ['/lotes', '/pontos-suplementacao', '/leituras-cocho', '/suplementacao-eventos']) {
      expect(incrementalDe(caminho)?.mudancas).toBe(`${caminho}/mudancas`);
    }
    expect(incrementalDe('/suplementacao-lotes?limit=500')).toBeNull();
  });
});
