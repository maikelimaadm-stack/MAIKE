/**
 * Transporte e sessão nativos (P4.0, D-PROD-24).
 *
 * O que estes casos protegem, em uma frase: o navegador fala com o backend
 * MAIKE usando credencial do MAIKE, e nada do que o servidor escreve chega à
 * tela como texto.
 *
 * `fetch` é substituído para que os casos sejam determinísticos e não dependam
 * de rede. O que **não** é substituído é a cadeia real —
 * `nativeSessionApi → nativeHttpClient → ApiError` roda inteira: o valor do
 * teste está em observar o que a cadeia produz, não em conferir um mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const API = 'https://backend.exemplo.invalido';

/** Importa a cadeia com o ambiente já preparado. */
const carregar = async () => {
  const storage = await import('@/lib/auth/nativeTokenStorage');
  const sessao = await import('@/apis/session/nativeSessionApi');
  const erros = await import('@/apis/_core/ApiError');
  return { ...sessao, ...storage, ...erros };
};

const respostaJson = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});

const LOGIN_OK = {
  token: 'jwt.nativo.sintetico',
  usuario: { id: 'usr_1', login: 'joao', nome: 'João' },
  cliente_id: 'cli_1',
};

const CONTEXTO_OK = {
  cliente_id: 'cli_1',
  usuario_id: 'usr_1',
  login: 'joao',
  request_id: 'req_1',
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

describe('P4T — configuração do transporte nativo', () => {
  it('P4T-01 runtimeConfig lê VITE_MAIKE_API_URL e normaliza a barra final', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', `${API}/`);
    const { getNativeApiUrl, isNativeApiConfigured } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBe(API);
    expect(isNativeApiConfigured()).toBe(true);
  });

  it('P4T-01b variável ausente devolve null, sem inventar destino', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', '');
    const { getNativeApiUrl } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBeNull();
  });

  it('P4T-02 a URL do MAIKE e a da Base44 são independentes', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', API);
    vi.stubEnv('VITE_BASE44_BACKEND_URL', 'https://base44.exemplo.invalido');
    const { getNativeApiUrl, getDataProviderConfig } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBe(API);
    expect(getDataProviderConfig().serverUrl).toBe('https://base44.exemplo.invalido');
    expect(getNativeApiUrl()).not.toBe(getDataProviderConfig().serverUrl);
  });

  // ── P4.2: base sem esquema (D-PROD-26) ──────────────────────────────────
  //
  // Regressão de produção. `VITE_MAIKE_API_URL=maike-production.up.railway.app`
  // não falhou: `fetch('maike-...app/auth/login')` é URL **relativa**, o
  // navegador resolveu contra a origem do frontend e o POST de login — com a
  // senha no corpo — foi para a Vercel, que respondeu 404 em text/plain. Na
  // tela virou um erro genérico, sem nenhuma pista do destino errado.

  it('P4T-01c host puro recebe https:// em vez de virar caminho relativo', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', 'backend.exemplo.invalido');
    const { getNativeApiUrl } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBe('https://backend.exemplo.invalido');
  });

  it('P4T-01d host puro com porta também vira absoluto', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', 'backend.exemplo.invalido:8443');
    const { getNativeApiUrl } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBe('https://backend.exemplo.invalido:8443');
  });

  it('P4T-01e http:// explícito é preservado, para o backend local', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', 'http://localhost:3333');
    const { getNativeApiUrl } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBe('http://localhost:3333');
  });

  it.each([
    ['//outro.host', 'protocol-relative aponta para outro host mantendo o esquema'],
    ['javascript:alert(1)', 'esquema executável'],
    ['ftp://backend.exemplo.invalido', 'esquema que o fetch não usa'],
    ['/api', 'caminho relativo — o defeito original, em outra forma'],
    ['backend.exemplo.invalido/api', 'host com caminho: concatenar geraria /api/auth/login'],
  ])('P4T-01f base inaceitável devolve null: %s', async (valor) => {
    vi.stubEnv('VITE_MAIKE_API_URL', valor);
    const { getNativeApiUrl, isNativeApiConfigured } = await import('@/config/runtimeConfig');
    expect(getNativeApiUrl()).toBeNull();
    expect(isNativeApiConfigured()).toBe(false);
  });

  it('P4T-01g com base recusada o login falha sem tocar na rede', async () => {
    // O ponto não é só recusar: é **não** mandar a senha para lugar nenhum.
    vi.stubEnv('VITE_MAIKE_API_URL', '//outro.host');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { login, API_ERROR_CODES } = await carregar();
    await expect(login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' })).rejects.toMatchObject({
      code: API_ERROR_CODES.PROVIDER_UNAVAILABLE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('P4T-01h host puro produz URL absoluta no fetch, não same-origin', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', 'backend.exemplo.invalido');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { login } = await carregar();
    await login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' });

    expect(fetchMock.mock.calls[0][0]).toBe('https://backend.exemplo.invalido/auth/login');
  });

  it('P4T-02b describeRuntimeConfig informa presença, nunca a URL', async () => {
    const { describeRuntimeConfig } = await import('@/config/runtimeConfig');
    const descricao = describeRuntimeConfig();
    expect(descricao.hasNativeApiUrl).toBe(true);
    expect(JSON.stringify(descricao)).not.toContain(API);
  });
});

describe('P4T — login', () => {
  it('P4T-03 envia exatamente cliente, login e senha — nunca cliente_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { login } = await carregar();
    await login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' });

    const [url, opcoes] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/auth/login`);
    const corpo = JSON.parse(opcoes.body);
    expect(Object.keys(corpo).sort()).toEqual(['cliente', 'login', 'senha']);
    expect(corpo).not.toHaveProperty('cliente_id');
    expect(corpo).not.toHaveProperty('usuario_id');
  });

  it('P4T-04 o token do MAIKE vira Bearer na chamada de contexto', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { login } = await carregar();
    await login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' });

    const [url, opcoes] = fetchMock.mock.calls[1];
    expect(url).toBe(`${API}/auth/contexto`);
    expect(opcoes.headers.Authorization).toBe(`Bearer ${LOGIN_OK.token}`);
  });

  it('P4T-04b o login não vai autenticado: não há token antes dele', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { login } = await carregar();
    await login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' });

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('P4T-05 o token da Base44 nunca aparece numa requisição MAIKE', async () => {
    // O token do SDK vive no localStorage sob o prefixo `base44_`. Se a
    // fronteira nativa o lesse, ele apareceria aqui.
    window.localStorage.setItem('base44_access_token', 'TOKEN-DA-BASE44');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { login } = await carregar();
    await login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' });

    const tudo = JSON.stringify(fetchMock.mock.calls);
    expect(tudo).not.toContain('TOKEN-DA-BASE44');
  });

  it('P4T-06 o token do MAIKE fica em sessionStorage, nunca em localStorage', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { login, NATIVE_TOKEN_STORAGE_KEY } = await carregar();
    await login({ cliente: 'FAZENDA', login: 'joao', senha: 's3nh4' });

    expect(window.sessionStorage.getItem(NATIVE_TOKEN_STORAGE_KEY)).toBe(LOGIN_OK.token);
    expect(window.localStorage.getItem(NATIVE_TOKEN_STORAGE_KEY)).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain(LOGIN_OK.token);
  });

  it('P4T-06b login com contexto recusado não deixa sessão pela metade', async () => {
    // Sessão pela metade é pior que sessão ausente: a tela acha que entrou.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaJson(200, LOGIN_OK))
      .mockResolvedValueOnce(respostaJson(401, { code: 'TENANT_CONTEXT_REQUIRED' }));
    vi.stubGlobal('fetch', fetchMock);

    const { login, NATIVE_TOKEN_STORAGE_KEY } = await carregar();
    await expect(login({ cliente: 'F', login: 'j', senha: 's' })).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_REQUIRED',
    });
    expect(window.sessionStorage.getItem(NATIVE_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe('P4T — restauração e logout', () => {
  it('P4T-07 o reload restaura a sessão e a VALIDA no servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(200, CONTEXTO_OK));
    vi.stubGlobal('fetch', fetchMock);

    const { setNativeToken, restaurarSessao } = await carregar();
    setNativeToken('jwt.guardado');

    const veredito = await restaurarSessao();

    expect(veredito.autenticado).toBe(true);
    expect(veredito.contexto.cliente_id).toBe('cli_1');
    // A presença do token não basta: o servidor foi consultado.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API}/auth/contexto`);
  });

  it('P4T-08 / P4R1-T04 token RECUSADO é removido do storage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(401, { code: 'TENANT_CONTEXT_REQUIRED' })));

    const { setNativeToken, restaurarSessao, NATIVE_TOKEN_STORAGE_KEY } = await carregar();
    setNativeToken('jwt.expirado');

    const veredito = await restaurarSessao();

    expect(veredito.autenticado).toBe(false);
    expect(veredito.contexto).toBeNull();
    expect(window.sessionStorage.getItem(NATIVE_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('P4T-08b / P4R1-T05 sem token, a restauração nem chama o servidor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { restaurarSessao } = await carregar();
    expect((await restaurarSessao()).autenticado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('P4T-09 logout remove a sessão nativa', async () => {
    const { setNativeToken, logout, temSessaoLocal, NATIVE_TOKEN_STORAGE_KEY } = await carregar();
    setNativeToken('jwt.vivo');
    expect(temSessaoLocal()).toBe(true);

    logout();

    expect(temSessaoLocal()).toBe(false);
    expect(window.sessionStorage.getItem(NATIVE_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

/**
 * P4.0-R1 — falha de autenticação ≠ falha de disponibilidade.
 *
 * A primeira versão apagava o JWT para **qualquer** erro no restore. Um backend
 * fora do ar por trinta segundos destruía a sessão de quem estava trabalhando e
 * exigia senha de novo — punindo o usuário por uma falha de infraestrutura, e
 * apagando a única credencial que ele tinha.
 *
 * Cada caso aqui separa as duas classes. O que se prova não é só o veredito: é
 * que **o token continua no storage** quando ninguém disse que ele é inválido.
 */
describe('P4R1 — restore preserva a sessão em falha transitória', () => {
  const comTokenGuardado = async (respostaOuErro) => {
    const fetchMock =
      respostaOuErro instanceof Error
        ? vi.fn().mockRejectedValue(respostaOuErro)
        : vi.fn().mockResolvedValue(respostaOuErro);
    vi.stubGlobal('fetch', fetchMock);

    const modulo = await carregar();
    modulo.setNativeToken('jwt.valido.guardado');
    return { ...modulo, fetchMock };
  };

  it('P4R1-T01 falha de rede: propaga indisponibilidade e PRESERVA o token', async () => {
    const { restaurarSessao, getNativeToken, NATIVE_TOKEN_STORAGE_KEY } = await comTokenGuardado(
      new TypeError('Failed to fetch')
    );

    // Não devolve "não autenticado": isso seria indistinguível de logout.
    const erro = await restaurarSessao().then(
      (v) => new Error(`deveria ter lançado, devolveu ${JSON.stringify(v)}`),
      (e) => e
    );

    expect(erro.code).toBe('API_PROVIDER_UNAVAILABLE');
    expect(getNativeToken()).toBe('jwt.valido.guardado');
    expect(window.sessionStorage.getItem(NATIVE_TOKEN_STORAGE_KEY)).toBe('jwt.valido.guardado');
  });

  it('P4R1-T02 abort/timeout: token preservado, nenhuma limpeza', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const { restaurarSessao, getNativeToken } = await comTokenGuardado(abort);

    await expect(restaurarSessao()).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
    expect(getNativeToken()).toBe('jwt.valido.guardado');
  });

  it('P4R1-T03 HTTP 500 / INTERNAL_ERROR: token preservado', async () => {
    const { restaurarSessao, getNativeToken } = await comTokenGuardado(
      respostaJson(500, { code: 'INTERNAL_ERROR', message: 'boom' })
    );

    const erro = await restaurarSessao().catch((e) => e);

    // Erro seguro, do catálogo local — nunca a mensagem do servidor.
    expect(erro.code).toBe('API_OPERATION_FAILED');
    expect(erro.message).not.toContain('boom');
    expect(getNativeToken()).toBe('jwt.valido.guardado');
  });

  it('P4R1-T03b 503 do servidor também preserva o token', async () => {
    const { restaurarSessao, getNativeToken } = await comTokenGuardado(respostaJson(503, null));

    await expect(restaurarSessao()).rejects.toMatchObject({ code: 'API_PROVIDER_UNAVAILABLE' });
    expect(getNativeToken()).toBe('jwt.valido.guardado');
  });

  it('P4R1-T03c só TENANT_CONTEXT_REQUIRED limpa — 403 de escopo não limpa', async () => {
    // A distinção é por **código**, não por faixa de status. Um 403 de escopo
    // não diz que a credencial é inválida.
    const { restaurarSessao, getNativeToken } = await comTokenGuardado(
      respostaJson(403, { code: 'TENANT_SCOPE_VIOLATION' })
    );

    await expect(restaurarSessao()).rejects.toMatchObject({ code: 'TENANT_SCOPE_VIOLATION' });
    expect(getNativeToken()).toBe('jwt.valido.guardado');
  });
});

describe('P4T — tradução de erro', () => {
  it('P4T-10 a mensagem crua do backend não chega à UI', async () => {
    // Mensagem hostil de propósito: URL, cabeçalho, SQL e token falso.
    const venenosa =
      'falha em https://interno.exemplo/db?token=SEGREDO — Authorization: Bearer abc123 — SELECT * FROM usuario';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaJson(403, { code: 'TENANT_SCOPE_VIOLATION', message: venenosa }))
    );

    const { setNativeToken, obterContexto, getApiErrorMessage } = await carregar();
    setNativeToken('jwt');

    const erro = await obterContexto().catch((e) => e);

    expect(erro.code).toBe('TENANT_SCOPE_VIOLATION');
    for (const fragmento of ['https://interno', 'SEGREDO', 'Authorization', 'Bearer', 'SELECT']) {
      expect(erro.message).not.toContain(fragmento);
      expect(getApiErrorMessage(erro)).not.toContain(fragmento);
    }
    expect(erro.message).toBe('Você não tem acesso a este registro.');
  });

  it('P4T-11 os oito códigos do contrato atravessam com o próprio nome', async () => {
    const { setNativeToken, obterContexto } = await carregar();
    const codigos = [
      'TENANT_CONTEXT_REQUIRED',
      'TENANT_SCOPE_VIOLATION',
      'SEQUENCE_SCOPE_INVALID',
      'SEQUENCE_CONFLICT',
      'ATTACHMENT_INVALID',
      'ATTACHMENT_OWNER_INVALID',
      'AUDIT_WRITE_FAILED',
      'CONCURRENCY_CONFLICT',
    ];

    for (const code of codigos) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(400, { code, message: 'cru' })));
      setNativeToken('jwt');
      const erro = await obterContexto().catch((e) => e);
      expect(erro.code, `código ${code}`).toBe(code);
      // Cada um tem mensagem pública própria: nenhum cai no texto padrão.
      expect(erro.message, `mensagem de ${code}`).not.toBe('Não foi possível concluir a operação.');
    }
  });

  it('P4T-12 AUTH_INVALID_CREDENTIALS tem mensagem pública única', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaJson(401, { code: 'AUTH_INVALID_CREDENTIALS', message: 'usuario nao existe' }))
    );

    const { login } = await carregar();
    const erro = await login({ cliente: 'F', login: 'j', senha: 's' }).catch((e) => e);

    expect(erro.code).toBe('AUTH_INVALID_CREDENTIALS');
    // O texto não distingue cliente, usuário ou senha: distinguir desfaria a
    // proteção contra enumeração que o backend construiu com tempo constante.
    expect(erro.message).toBe('Cliente, usuário ou senha inválidos.');
    expect(erro.message).not.toContain('usuario nao existe');
  });

  it('P4T-13 falha de rede vira API_PROVIDER_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const { login } = await carregar();
    const erro = await login({ cliente: 'F', login: 'j', senha: 's' }).catch((e) => e);

    expect(erro.code).toBe('API_PROVIDER_UNAVAILABLE');
    expect(erro.retryable).toBe(true);
  });

  it('P4T-13b URL nativa ausente também vira indisponibilidade, sem chamar a rede', async () => {
    vi.stubEnv('VITE_MAIKE_API_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { login } = await carregar();
    const erro = await login({ cliente: 'F', login: 'j', senha: 's' }).catch((e) => e);

    expect(erro.code).toBe('API_PROVIDER_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('P4T-14 código desconhecido do backend cai em fallback seguro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaJson(418, { code: 'CODIGO_QUE_NAO_EXISTE', message: 'x' }))
    );

    const { login } = await carregar();
    const erro = await login({ cliente: 'F', login: 'j', senha: 's' }).catch((e) => e);

    expect(erro.code).toBe('API_OPERATION_FAILED');
  });

  it('P4T-14b os códigos backend-only viram vocabulário do frontend', async () => {
    const esperado = {
      REQUEST_VALIDATION_FAILED: 'API_INVALID_ARGUMENT',
      REQUEST_REJECTED: 'API_INVALID_ARGUMENT',
      INTERNAL_ERROR: 'API_OPERATION_FAILED',
    };

    const { login } = await carregar();
    for (const [doBackend, noFrontend] of Object.entries(esperado)) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaJson(400, { code: doBackend })));
      const erro = await login({ cliente: 'F', login: 'j', senha: 's' }).catch((e) => e);
      expect(erro.code, doBackend).toBe(noFrontend);
    }
  });

  it('P4T-17 nenhum token aparece no JSON.stringify de um erro público', async () => {
    // `cause` é definido como não enumerável no `ApiError` exatamente para
    // isto: o corpo cru do servidor não pode vazar no primeiro log.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaJson(403, { code: 'TENANT_SCOPE_VIOLATION', message: 'tok=jwt.super.secreto', request_id: 'req_9' })
      )
    );

    const { setNativeToken, obterContexto } = await carregar();
    setNativeToken('jwt.super.secreto');

    const erro = await obterContexto().catch((e) => e);
    const serializado = JSON.stringify(erro);

    expect(serializado).not.toContain('jwt.super.secreto');
    expect(Object.keys(erro)).not.toContain('cause');
    // `request_id` é o único detalhe do servidor que vale guardar.
    expect(erro.details.requestId).toBe('req_9');
  });
});
