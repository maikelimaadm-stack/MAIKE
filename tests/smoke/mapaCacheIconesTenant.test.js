/**
 * D-PROD-137 (frente M4b, GET-06) — cache offline dos ícones do mapa é do TENANT.
 *
 * Defeito: `ConfiguracaoIcone` é dado da fazenda (cliente_id obrigatório no
 * servidor), mas o cache do mapa o guardava em `mapa_icones::__GLOBAL__`, sem
 * dono, e o logout não o apagava. No mesmo aparelho, a fazenda B abria o mapa
 * offline — ou online antes de o refresh terminar — com os ícones, cores e
 * descrições da fazenda A. A política em memória (`icones:__GLOBAL__`) ainda
 * fazia o refresh de B, dentro de 60 s, devolver o cache de A sem ir à rede.
 *
 * Contrato: ícones (e permissões) ficam em `cli:<tenant>`, o tenant da sessão
 * nativa (P4.1-R1); sem tenant conhecido, nada é lido nem gravado no cache. No
 * logout, o cache do tenant que sai e o legado `__GLOBAL__` são apagados e a
 * política em memória é zerada. Fila e pendências NÃO são tocadas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const armazenamento = new Map();
const chave = (k, e) => `${k}::${e || '__GLOBAL__'}`;

vi.mock('@/components/offline/IndexedDBManager', () => ({
  getEntityCacheItems: vi.fn(async (k, e) => armazenamento.get(chave(k, e))?.items || []),
  getEntityCacheRecord: vi.fn(async (k, e) => armazenamento.get(chave(k, e))),
  setEntityCacheItems: vi.fn(async (k, e, items) => { armazenamento.set(chave(k, e), { items, updated_at: 'agora' }); }),
  deleteEntityCacheRecord: vi.fn(async (k, e) => { armazenamento.delete(chave(k, e)); }),
}));

const listIcones = vi.fn();
const listAreas = vi.fn(async () => []);
vi.mock('@/apis/mapa', () => ({
  listAreas: (...a) => listAreas(...a),
  listPontos: async () => [],
  listPontosSuplementacao: async () => [],
  listLinhas: async () => [],
  listIcones: (...a) => listIcones(...a),
}));

const { getMapaCachedData, refreshMapaCacheEntry, __resetMapaCachePolicy } = await import('@/services/mapaCacheService');
const { setOfflineTenant, clearOfflineTenant, getOfflineTenant } = await import('@/lib/offline/offlineTenant');
const { sairDaSessaoNativa } = await import('@/services/sessionService');

const ICONES_A = [{ id: 'ia', ativo: true, nome: 'Cocho da fazenda A', icone_url: 'https://a/cocho.png' }];
const ICONES_B = [{ id: 'ib', ativo: true, nome: 'Cocho da fazenda B', icone_url: 'https://b/cocho.png' }];
const ICONES_LEGADO = 'mapa_icones::__GLOBAL__';
const doTenant = (t) => `mapa_icones::cli:${t}`;

beforeEach(() => {
  armazenamento.clear();
  __resetMapaCachePolicy();
  clearOfflineTenant();
  listIcones.mockReset();
});

describe('GET-06 — ícones do mapa no cache por tenant', () => {
  it('A atualiza e sai; B entra no mesmo aparelho em menos de 60 s: B não recebe os ícones de A (cache nem política)', async () => {
    setOfflineTenant('cli-A');
    listIcones.mockResolvedValueOnce(ICONES_A);
    expect(await refreshMapaCacheEntry('icones', 'emp-a1')).toEqual(ICONES_A);
    expect(armazenamento.get(doTenant('cli-A'))?.items, 'gravado com dono').toEqual(ICONES_A);
    expect(armazenamento.has(ICONES_LEGADO), 'nada na chave sem dono').toBe(false);

    clearOfflineTenant();
    setOfflineTenant('cli-B');
    listIcones.mockResolvedValueOnce(ICONES_B);
    expect(await getMapaCachedData('icones', 'emp-b1'), 'leitura offline de B').toEqual([]);
    expect(await refreshMapaCacheEntry('icones', 'emp-b1'), 'refresh de B vai à rede').toEqual(ICONES_B);
    expect(listIcones).toHaveBeenCalledTimes(2);
    expect(armazenamento.get(doTenant('cli-A'))?.items, 'A continua isolado').toEqual(ICONES_A);
  });

  it('a empresa não muda o dono: outra empresa do MESMO tenant lê o mesmo cache de ícones', async () => {
    setOfflineTenant('cli-A');
    listIcones.mockResolvedValueOnce(ICONES_A);
    await refreshMapaCacheEntry('icones', 'emp-a1');
    expect(await getMapaCachedData('icones', 'emp-a2')).toEqual(ICONES_A);
  });

  it('sem tenant conhecido: não lê o legado `__GLOBAL__` nem grava nada; o dado vem da rede', async () => {
    armazenamento.set(ICONES_LEGADO, { items: ICONES_A });
    listIcones.mockResolvedValueOnce(ICONES_B);
    expect(await getMapaCachedData('icones', null)).toEqual([]);
    expect(await refreshMapaCacheEntry('icones', null)).toEqual(ICONES_B);
    expect([...armazenamento.keys()]).toEqual([ICONES_LEGADO]);
    expect(armazenamento.get(ICONES_LEGADO)?.items, 'legado não foi reescrito').toEqual(ICONES_A);
  });

  it('controle: dado de empresa continua na chave da empresa', async () => {
    setOfflineTenant('cli-A');
    listAreas.mockResolvedValueOnce([{ id: 'x1', empresa_id: 'emp-a1', ativo: true }]);
    await refreshMapaCacheEntry('areas', 'emp-a1');
    expect(armazenamento.get('mapa_areas::emp-a1')?.items).toEqual([{ id: 'x1', empresa_id: 'emp-a1', ativo: true }]);
  });
});

describe('GET-06 — logout limpa o cache do tenant que sai', () => {
  it('sairDaSessaoNativa apaga os ícones do tenant e o legado sem dono; cache por empresa e de outro tenant ficam', async () => {
    setOfflineTenant('cli-A');
    listIcones.mockResolvedValueOnce(ICONES_A);
    await refreshMapaCacheEntry('icones', 'emp-a1');
    armazenamento.set(ICONES_LEGADO, { items: ICONES_A });
    armazenamento.set(doTenant('cli-B'), { items: ICONES_B });
    armazenamento.set('mapa_areas::emp-a1', { items: [{ id: 'x1' }] });

    sairDaSessaoNativa();

    expect(getOfflineTenant(), 'dono da fila descartado como antes').toBeNull();
    await vi.waitFor(() => expect(armazenamento.has(doTenant('cli-A'))).toBe(false));
    expect(armazenamento.has(ICONES_LEGADO)).toBe(false);
    expect(armazenamento.get(doTenant('cli-B'))?.items).toEqual(ICONES_B);
    expect(armazenamento.has('mapa_areas::emp-a1')).toBe(true);
  });

  it('o mesmo tenant que volta em menos de 60 s busca de novo (a política em memória foi zerada com o cache)', async () => {
    setOfflineTenant('cli-A');
    listIcones.mockResolvedValue(ICONES_A);
    await refreshMapaCacheEntry('icones', 'emp-a1');

    sairDaSessaoNativa();
    await vi.waitFor(() => expect(armazenamento.has(doTenant('cli-A'))).toBe(false));

    setOfflineTenant('cli-A');
    expect(await refreshMapaCacheEntry('icones', 'emp-a1')).toEqual(ICONES_A);
    expect(listIcones).toHaveBeenCalledTimes(2);
  });
});
