/**
 * MapaGeral e MapaCadastro — o que dá para provar sem montar o mapa (P1.2).
 *
 * `MapaGeral.jsx` depende do SDK do Google Maps, de `navigator.onLine` e de
 * IndexedDB. Renderizar a página inteira testaria o ambiente, não o produto.
 * Aqui se testa o que a página **decide**: permissão, origem do dado, chave de
 * cache e os efeitos que a UI continua obrigada a disparar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Provider substituído: importar `mapaCacheService` puxa a cadeia inteira de
 * APIs até o provider, e o SDK real tenta rede já na carga do módulo. Aqui só
 * interessa a lista de capacidades, então nada precisa sair da máquina.
 */
vi.mock('@/apis/_providers/base44Provider.js', () => ({
  empresaProvider: {}, mapaProvider: {}, lotesProvider: {}, estoqueProvider: {},
  tarefasProvider: {}, sessionProvider: {}, rebanhoProvider: {}, arquivosProvider: {},
}));

import { normalizeMapaGeralPermissions, DEFAULT_MAPA_GERAL_PERMISSIONS } from '@/lib/mapaGeralPermissions';
import { CACHE_KEYS } from '@/services/mapaCacheService';

/** Fonte sem comentários: comentário explicativo não é código. */
const codigoDe = (rel) =>
  readFileSync(rel, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const MAPA_GERAL = 'src/pages/MapaGeral.jsx';
const MAPA_CADASTRO = 'src/pages/MapaCadastro.jsx';

/**
 * Réplica da decisão de permissão de `MapaGeral` (linhas 198–207).
 *
 * A página combina `currentUser.role`, `permissaoAtual.is_admin` e
 * `canAccessPage` num `useMemo`. Reproduzir a combinação aqui permite testar
 * MG3/MG4 sem React; o teste seguinte garante que a página não mudou a regra
 * por baixo — se mudar, a réplica deixa de valer e o teste reprova.
 */
const permissoesDaPagina = ({ currentUser, permissaoAtual, podeAcessarPagina }) => {
  if (currentUser?.role === 'admin' || permissaoAtual?.is_admin) {
    return normalizeMapaGeralPermissions({}, true);
  }
  return normalizeMapaGeralPermissions(permissaoAtual?.mapa_geral_permissoes, podeAcessarPagina);
};

describe('MG3/MG4 — permissões', () => {
  it('MG3 — admin recebe todas as permissões, mesmo sem registro próprio', () => {
    const admin = permissoesDaPagina({ currentUser: { role: 'admin' }, permissaoAtual: null, podeAcessarPagina: false });
    expect(Object.values(admin).every(Boolean)).toBe(true);
    expect(Object.keys(admin)).toEqual(Object.keys(DEFAULT_MAPA_GERAL_PERMISSIONS));
  });

  it('MG3b — is_admin no registro equivale ao role admin', () => {
    expect(permissoesDaPagina({ currentUser: { role: 'user' }, permissaoAtual: { is_admin: true }, podeAcessarPagina: false }))
      .toEqual(permissoesDaPagina({ currentUser: { role: 'admin' }, permissaoAtual: null, podeAcessarPagina: true }));
  });

  it('MG4 — usuário comum sem acesso à página não recebe nenhuma permissão', () => {
    const comum = permissoesDaPagina({
      currentUser: { role: 'user' },
      permissaoAtual: { mapa_geral_permissoes: { visualizar_tarefas: true } },
      podeAcessarPagina: false,
    });
    expect(Object.values(comum).every((valor) => valor === false)).toBe(true);
  });

  it('MG4b — usuário comum com acesso recebe apenas o que foi concedido', () => {
    const comum = permissoesDaPagina({
      currentUser: { role: 'user' },
      permissaoAtual: { mapa_geral_permissoes: { visualizar_tarefas: false } },
      podeAcessarPagina: true,
    });
    expect(comum.visualizar_tarefas).toBe(false);
    // As demais chaves continuam existindo, com o padrão do produto.
    expect(Object.keys(comum)).toEqual(Object.keys(DEFAULT_MAPA_GERAL_PERMISSIONS));
  });

  it('a página continua usando exatamente esta combinação', () => {
    const fonte = codigoDe(MAPA_GERAL);
    expect(fonte).toContain("currentUser?.role === 'admin' || permissaoAtual?.is_admin");
    expect(fonte).toContain('normalizeMapaGeralPermissions({}, true)');
    expect(fonte).toContain("canAccessPage(permissaoAtual, 'pec-mapa-geral', 'pecuaria')");
  });
});

describe('MG5/MG6 — origem do dado das queries do mapa', () => {
  const fonte = codigoDe(MAPA_GERAL);

  it('MG5 — a query lê o cache local antes de qualquer rede', () => {
    expect(fonte).toContain('const cached = await getMapaCachedData(cacheKey, cacheEmpresa)');
    // offline: devolve o cache e não chama refresh
    expect(fonte).toMatch(/if \(navigator\.onLine\)/);
  });

  it('MG6 — com cache quente, o refresh acontece em segundo plano e não bloqueia', () => {
    const trecho = fonte.slice(fonte.indexOf('const createMapaQuery'), fonte.indexOf('const createMapaQuery') + 1200);
    // o refresh é encadeado com .then e o retorno é o cache, não a promise da rede
    expect(trecho).toMatch(/refreshMapaCacheEntry\(cacheKey, cacheEmpresa\)\s*\.then\(/);
    expect(trecho).toMatch(/return cached;/);
    // e falha de refresh em segundo plano não derruba a query
    expect(trecho).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('ícones e permissões usam a chave global, o resto usa a empresa', () => {
    expect(fonte).toContain("cacheKey === 'icones' || cacheKey === 'permissoes' ? '__GLOBAL__' : empresaSelecionadaId");
  });
});

describe('MG7 — clique em bebedouro', () => {
  const fonte = codigoDe(MAPA_GERAL);

  it('offline reaproveita o que useBebedouros já carregou', () => {
    expect(fonte).toMatch(/navigator\.onLine\s*\?\s*await listarBebedourosAtivos\(empresaSelecionadaId\)/);
    expect(fonte).toMatch(/:\s*bebedouros\.filter\(/);
  });

  it('online passa pelo service, nunca pelo provider', () => {
    expect(fonte).toContain('listarBebedourosAtivos');
    expect(fonte).not.toMatch(/@\/apis\/[a-z]+\/[A-Za-z]/);
    expect(fonte).not.toContain('base44');
  });
});

describe('MG8 — chave do Google Maps ausente', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('sem chave, o carregador se declara não configurado e há mensagem pública', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const { isGoogleMapsConfigured } = await import('@/config/runtimeConfig');
    const { GOOGLE_MAPS_MISSING_KEY_MESSAGE } = await import('@/lib/googleMaps');
    expect(isGoogleMapsConfigured()).toBe(false);
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE).toEqual(expect.any(String));
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE.trim()).not.toBe('');
  });

  it('a página nasce com o erro de mapa preenchido em vez de tentar carregar', () => {
    const fonte = codigoDe(MAPA_GERAL);
    expect(fonte).toContain('isGoogleMapsConfigured() ? null : GOOGLE_MAPS_MISSING_KEY_MESSAGE');
  });

  it('a mensagem pública não carrega valor de chave', async () => {
    const { GOOGLE_MAPS_MISSING_KEY_MESSAGE } = await import('@/lib/googleMaps');
    expect(GOOGLE_MAPS_MISSING_KEY_MESSAGE).not.toMatch(/AIza|key=/i);
  });
});

describe('MG9 — nenhuma query do mapa pede uma chave sem fetcher', () => {
  it('toda chave usada em createMapaQuery existe no cache do mapa', () => {
    const fonte = codigoDe(MAPA_GERAL);
    const chaves = [...fonte.matchAll(/createMapaQuery\('([^']+)'/g)].map((m) => m[1]);
    expect(chaves.length).toBeGreaterThan(0);
    const orfas = chaves.filter((chave) => !CACHE_KEYS.includes(chave));
    expect(orfas).toEqual([]);
  });

  it('produtos — a chave que voltava vazia em silêncio — tem capacidade', () => {
    expect(codigoDe(MAPA_GERAL)).toContain("createMapaQuery('produtos')");
    expect(CACHE_KEYS).toContain('produtos');
  });
});

describe('MC11/MC12 — efeitos que a UI continua obrigada a disparar', () => {
  const fonte = codigoDe(MAPA_CADASTRO);

  it('MC11 — a invalidação de query sobreviveu à migração', () => {
    for (const entidade of ['areas', 'linhas']) {
      expect(fonte).toContain(`q.queryKey[0] === "${entidade}"`);
    }
    expect(fonte).toMatch(/queryKey\[0\]\)/);
    expect(fonte).toContain('pontos-suplementacao');
  });

  it('MC12 — o evento atualizar-mapa continua sendo disparado', () => {
    expect(fonte).toMatch(/window\.dispatchEvent\(new CustomEvent\(["']atualizar-mapa["']\)\)/);
  });

  it('o service não assumiu a invalidação: ela é da UI', () => {
    const service = codigoDe('src/services/mapaService.js');
    expect(service).not.toContain('invalidateQueries');
    expect(service).not.toContain('atualizar-mapa');
  });
});
