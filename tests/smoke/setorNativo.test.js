/**
 * Setor nativo, do lado do navegador (P4.1, D-PROD-25).
 *
 * O que estes casos protegem, em uma frase: a tela de setores fala com o
 * backend MAIKE, manda só o que é dela, e quando o backend não responde ela
 * **falha** — não cai calada para a Base44.
 *
 * Como em `sessaoNativa.test.js`, o que é substituído é o `fetch`; a cadeia real
 * roda inteira — `setorService → @/apis/setores → setorNativePort →
 * nativeHttpClient → ApiError`. O valor do teste está em observar o que a cadeia
 * coloca no fio, não em conferir um mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://backend.exemplo.invalido';
const TOKEN = 'jwt.nativo.sintetico';
const EMPRESA = 'empresa-legada-1';

const RAIZ = process.cwd();
/** Sem comentários: a prosa deste repositório cita as formas proibidas. */
const codigoDe = (rel) =>
  readFileSync(join(RAIZ, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

const SETOR = {
  id: 'set_1',
  empresa_id: EMPRESA,
  numero_setor: '1',
  nome: 'FAZENDA SANTA CLARA',
  sigla: 'FSC',
  tipo: 'Próprio',
  ativo: true,
};

/** Instala o token nativo pela porta oficial e devolve a cadeia carregada. */
const carregar = async () => {
  const { setNativeToken } = await import('@/lib/auth/nativeTokenStorage');
  setNativeToken(TOKEN);
  return {
    setores: await import('@/apis/setores'),
    porta: await import('@/apis/setores/setorNativePort'),
    servico: await import('@/services/setorService'),
    erros: await import('@/apis/_core/ApiError'),
  };
};

/** Última requisição observada no `fetch`. */
const ultimaChamada = () => {
  const chamadas = /** @type {any} */ (globalThis.fetch).mock.calls;
  const [url, opcoes] = chamadas[chamadas.length - 1];
  return { url, opcoes, corpo: opcoes.body ? JSON.parse(opcoes.body) : null };
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_MAIKE_API_URL', API);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('FE-P41 — leitura', () => {
  it('FE-P41-01 listSetores chama GET /setores com o Bearer do MAIKE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, [SETOR])));
    const { setores } = await carregar();

    const lista = await setores.listSetores();

    expect(lista).toEqual([SETOR]);
    const { url, opcoes } = ultimaChamada();
    expect(url).toBe(`${API}/setores`);
    expect(opcoes.method ?? 'GET').toBe('GET');
    expect(opcoes.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('FE-P41-02 o mapa e o cadastro usam a MESMA função de leitura', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, [SETOR])));
    const setores = await import('@/apis/setores');
    const mapa = await import('@/apis/mapa');

    // Identidade, não equivalência: duas funções que "fazem o mesmo" divergem
    // na primeira vez que uma das duas ganha um campo.
    expect(mapa.listSetores).toBe(setores.listSetores);
  });

  it('FE-P41-03 resposta que não é lista vira lista vazia, nunca undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, { nao: 'e uma lista' })));
    const { setores } = await carregar();
    expect(await setores.listSetores()).toEqual([]);
  });
});

describe('FE-P41 — o que vai para o fio na criação', () => {
  it('FE-P41-04 createSetor envia POST /setores só com os campos do cadastro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(201, SETOR)));
    const { setores } = await carregar();

    await setores.createSetor({
      empresa_id: EMPRESA,
      nome: 'FAZENDA SANTA CLARA',
      sigla: 'FSC',
      tipo: 'Próprio',
      area_total: 120.5,
      capacidade_animais: 300,
      ativo: true,
    });

    const { url, opcoes, corpo } = ultimaChamada();
    expect(url).toBe(`${API}/setores`);
    expect(opcoes.method).toBe('POST');
    expect(corpo).toEqual({
      empresa_id: EMPRESA,
      nome: 'FAZENDA SANTA CLARA',
      sigla: 'FSC',
      tipo: 'Próprio',
      area_total: 120.5,
      capacidade_animais: 300,
      ativo: true,
    });
  });

  /**
   * O caso que o replay da fila offline produz.
   *
   * `syncOfflineEntityQueue` tira `id` e `_isOffline` antes de chamar a
   * operação, mas `created_date` e `updated_date` continuam no registro — e o
   * objeto da tela de edição carrega `id` e `numero_setor` por cima. O backend
   * recusa todos com 400 (`additionalProperties: false`). Sem a filtragem na
   * porta, TODO setor criado sem rede falharia no replay.
   */
  it('FE-P41-05 id, numero_setor e metadado offline NÃO chegam ao POST', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(201, SETOR)));
    const { porta } = await carregar();

    await porta.operacoesNativas.create({
      id: 'offline_Setor_1730000000000_ab12cd',
      _isOffline: true,
      created_date: '2026-01-01T00:00:00.000Z',
      updated_date: '2026-01-01T00:00:00.000Z',
      numero_setor: '99',
      cliente_id: 'tenant-alheio',
      empresa_id: EMPRESA,
      nome: 'CRIADO SEM REDE',
      tipo: 'Próprio',
    });

    const { corpo } = ultimaChamada();
    expect(corpo).toEqual({ empresa_id: EMPRESA, nome: 'CRIADO SEM REDE', tipo: 'Próprio' });
    for (const proibido of ['id', 'numero_setor', 'cliente_id', '_isOffline', 'created_date', 'updated_date']) {
      expect(corpo, `"${proibido}" vazou para o POST`).not.toHaveProperty(proibido);
    }
  });

  it('FE-P41-06 string vazia vira null; campo ausente continua ausente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(201, SETOR)));
    const { porta } = await carregar();

    await porta.operacoesNativas.create({
      empresa_id: EMPRESA,
      nome: 'X',
      tipo: 'Próprio',
      sigla: '   ',
    });

    const { corpo } = ultimaChamada();
    expect(corpo.sigla).toBeNull();
    // Mandar `null` para tudo que a tela não tocou apagaria dado na atualização.
    expect(corpo).not.toHaveProperty('observacoes');
  });
});

describe('FE-P41 — o que vai para o fio na atualização', () => {
  it('FE-P41-07 updateSetor usa PATCH no id, e não reenvia empresa_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, SETOR)));
    const { setores } = await carregar();

    await setores.updateSetor('set_1', {
      id: 'set_1',
      empresa_id: EMPRESA,
      numero_setor: '1',
      nome: 'FAZENDA NOVA',
      created_date: '2026-01-01T00:00:00.000Z',
    });

    const { url, opcoes, corpo } = ultimaChamada();
    expect(url).toBe(`${API}/setores/set_1`);
    expect(opcoes.method).toBe('PATCH');
    expect(corpo).toEqual({ nome: 'FAZENDA NOVA' });
    // Mover um setor de empresa mudaria, por vínculo denormalizado, todas as
    // áreas, tarefas e movimentações que o citam. Não é campo de formulário.
    expect(corpo).not.toHaveProperty('empresa_id');
  });

  it('FE-P41-08 o id vai codificado na URL, nunca concatenado cru', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, SETOR)));
    const { porta } = await carregar();

    await porta.operacoesNativas.update('a/../b?x=1', { nome: 'X' });

    expect(ultimaChamada().url).toBe(`${API}/setores/${encodeURIComponent('a/../b?x=1')}`);
  });
});

describe('FE-P41 — a numeração saiu do navegador', () => {
  it('FE-P41-09 criarSetor não carrega a lista e não envia numero_setor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(201, SETOR)));
    const { servico } = await carregar();

    await servico.criarSetor({ nome: 'nova fazenda', tipo: 'Próprio' }, { empresaId: EMPRESA });

    const chamadas = /** @type {any} */ (globalThis.fetch).mock.calls;
    // Uma requisição só: a leitura da lista existia para calcular o `MAX + 1`.
    expect(chamadas.length).toBe(1);
    expect(chamadas[0][1].method).toBe('POST');
    expect(ultimaChamada().corpo).not.toHaveProperty('numero_setor');
    expect(ultimaChamada().corpo.nome).toBe('NOVA FAZENDA');
  });

  it('FE-P41-10 nenhuma forma de MAX+1 sobrou no caminho de Setor', () => {
    for (const rel of [
      'src/services/setorService.js',
      'src/apis/setores/setoresApi.js',
      'src/apis/setores/setorNativePort.js',
    ]) {
      const fonte = codigoDe(rel);
      expect(fonte, `${rel} usa Math.max`).not.toMatch(/Math\s*\.\s*max\s*\(/);
      expect(fonte, `${rel} reintroduziu proximoNumeroSetor`).not.toMatch(/proximoNumeroSetor/);
    }
  });
});

describe('FE-P41 — erro do backend, sem fallback', () => {
  it('FE-P41-11 404 do backend chega como SETOR_NOT_FOUND, com mensagem do catálogo local', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaJson(404, {
          code: 'SETOR_NOT_FOUND',
          // Mensagem do servidor, com detalhe interno. Precisa ser descartada.
          message: 'setor cli_9/set_777 não encontrado em public."Setor"',
          request_id: 'req_9',
        })
      )
    );
    const { setores, erros } = await carregar();

    const erro = await setores.updateSetor('set_777', { nome: 'X' }).catch((e) => e);

    expect(erro.code).toBe(erros.API_ERROR_CODES.SETOR_NOT_FOUND);
    expect(erro.message).toBe('Este setor não foi encontrado. Atualize a lista e tente novamente.');
    expect(erro.message).not.toMatch(/public\.|cli_9|set_777/);
    expect(erro.details.requestId).toBe('req_9');
  });

  it('FE-P41-12 400 de validação vira argumento inválido, não sucesso silencioso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respostaJson(400, { code: 'REQUEST_VALIDATION_FAILED', request_id: 'req_2' }))
    );
    const { setores, erros } = await carregar();

    const erro = await setores.createSetor({ nome: 'X' }).catch((e) => e);
    expect(erro.code).toBe(erros.API_ERROR_CODES.INVALID_ARGUMENT);
  });

  it('FE-P41-13 backend fora do ar FALHA — não devolve lista vazia nem consulta a Base44', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
    const { setores, erros } = await carregar();
    const { getRegisteredEntityNames } = await import('@/apis/_providers/base44Provider');

    const erro = await setores.listSetores().catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.code).toBe(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE);
    // Lista vazia seria a pior resposta possível: a tela mostraria "nenhum
    // setor" e o usuário concluiria que o cadastro sumiu.
    expect(Array.isArray(erro)).toBe(false);
    // E a Base44 não é mais dona da entidade, nem em caso de falha.
    expect(getRegisteredEntityNames()).not.toContain('Setor');
  });

  it('FE-P41-14 sem URL nativa configurada, a leitura falha em vez de chamar o host do frontend', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', '');
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, [])));
    const { setores, erros } = await carregar();

    const erro = await setores.listSetores().catch((e) => e);
    expect(erro.code).toBe(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE);
    expect(/** @type {any} */ (globalThis.fetch)).not.toHaveBeenCalled();
  });
});

describe('FE-P41 — exclusão fechada', () => {
  it('FE-P41-15 o módulo não expõe deleteSetor', async () => {
    const setores = await import('@/apis/setores');
    expect(setores.deleteSetor).toBeUndefined();
    expect(codigoDe('src/apis/setores/index.js')).not.toMatch(/deleteSetor/);
  });

  it('FE-P41-16 excluirSetor recusa sem nenhuma requisição', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, [])));
    const { servico, erros } = await carregar();

    const erro = await servico.excluirSetor('set_1').catch((e) => e);

    expect(erro.code).toBe(erros.API_ERROR_CODES.SETOR_DELETE_UNAVAILABLE);
    expect(/** @type {any} */ (globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('FE-P41-17 a recusa tem mensagem própria e diz que nada foi alterado', async () => {
    const { erros } = await carregar();
    const texto = new erros.ApiError(erros.API_ERROR_CODES.SETOR_DELETE_UNAVAILABLE, {}).message;
    expect(texto).toMatch(/indispon/i);
    expect(texto).toMatch(/Nenhum dado foi alterado/i);
  });
});

describe('FE-P41 — offline e fronteira', () => {
  it('FE-P41-18 a porta compõe o runtime offline e NÃO oferece exclusão', () => {
    const fonte = codigoDe('src/apis/setores/setorNativePort.js');
    expect(fonte).toMatch(/createOfflineEntityAdapter\s*\(/);
    expect(fonte).toMatch(/entityName:\s*ENTIDADE_OFFLINE/);
    // Sem operação `delete`, o adapter não cria `adapter.delete` e a fila nunca
    // enfileira uma exclusão que o servidor recusaria para sempre.
    expect(fonte).not.toMatch(/\bdelete\s*:/);
  });

  it('FE-P41-19 o Setor saiu do provider da Base44 por completo', () => {
    const provider = codigoDe('src/apis/_providers/base44Provider.js');
    expect(provider).not.toMatch(/base44\.entities\.Setor\b/);
    expect(provider).not.toMatch(/endpointOf\(\s*['"`]Setor['"`]\s*\)/);
    expect(provider).not.toMatch(/setoresProvider/);
  });

  it('FE-P41-20 só a porta monta o caminho HTTP /setores', () => {
    for (const rel of [
      'src/apis/setores/setoresApi.js',
      'src/apis/mapa/mapaApi.js',
      'src/services/setorService.js',
      'src/services/mapaService.js',
      'src/pages/CadastroSetores.jsx',
    ]) {
      expect(codigoDe(rel), `${rel} monta /setores por conta própria`).not.toMatch(/['"`]\/setores/);
    }
    expect(codigoDe('src/apis/setores/setorNativePort.js')).toMatch(/'\/setores'/);
  });
});
